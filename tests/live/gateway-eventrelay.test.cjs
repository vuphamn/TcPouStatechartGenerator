// The TwinCAT EventLogger live (gateway/eventRelay.cjs; the PLC's FB_KvalEventRelay simulated: its nSeq and its ring of
// 64 packed ST_KvalEvent, changed by the test): the events already in its ring kept at start; a new one waited for
// its text (the PLC asks for it), then kept; an error alarm raised: an alert ("plcEvent"), cleared: resolved; the
// setup page: its instance per PLC (a bad one refused), the function block's source to download, its state.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8539;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'relay-test-token';
const SIZE = 355;

(async () => {
  // (its ring: two events already)
  const ring = Buffer.alloc(64 * SIZE);
  const put = (seq, ms, kind, sev, id, source, text) => {
    const o = ((seq - 1) % 64) * SIZE;
    ring.fill(0, o, o + SIZE);
    ring.writeUInt32LE(seq, o);
    ring.writeBigUInt64LE(BigInt(ms + 11644473600000) * 10000n, o + 4);
    ring.writeUInt8(kind, o + 12);
    ring.writeUInt8(sev, o + 13);
    ring.writeUInt32LE(id, o + 14);
    ring.write(source, o + 18, 80, 'utf8');
    ring.write(text, o + 99, 255, 'utf8');
  };
  const t0 = Date.now() - 60000;
  put(1, t0, 1, 1, 1, 'MAIN', 'Cell started');
  put(2, t0 + 1000, 2, 2, 5, 'MAIN.fbCell.fbAir', 'Air pressure low');
  const cfg = writeSymbolsPlc('fake-ams2-eventrelay.json');
  const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  const controlFile = h.out('fake-ams2-eventrelay-control.json');
  fs.rmSync(controlFile, { force: true });
  c.controlFile = controlFile;
  c.script = [];
  c.symbols['MAIN.fbEventRelay.nSeq'] = { type: 'UDINT', dataType: 19, size: 4, value: 2 };
  c.symbols['MAIN.fbEventRelay.aEvents'] = { type: 'ARRAY [0..63] OF ST_KvalEvent', dataType: 65, size: 64 * SIZE, bytes: [...ring] };
  fs.writeFileSync(cfg, JSON.stringify(c));
  const setRing = (seq) => fs.writeFileSync(controlFile, JSON.stringify({ set: { 'MAIN.fbEventRelay.nSeq': seq, 'MAIN.fbEventRelay.aEvents': { bytes: [...ring] } } }));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48940', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-eventrelay');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 6', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48940', port: 851 }],
    tokens: [{ name: 'tech', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    eventlog: { live: { line: 'MAIN.fbEventRelay' } },
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false }, axes: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-eventrelay-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);
  const api = (method, p, body) =>
    new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { host: `localhost:${PORT}`, origin: BASE, 'content-type': 'application/json' } }, (res) => {
        let t = '';
        res.on('data', (d) => (t += d));
        res.on('end', () => resolve({ status: res.statusCode, text: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() }));
      });
      req.on('error', () => resolve({ status: 0 }));
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const kept = () => {
    try {
      return fs.readFileSync(path.join(dir, 'eventlog', 'line.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };
  // 1. Those already in its ring, kept
  const first = await h.until(() => (kept().length === 2 ? kept() : null), 15000);
  expect(first?.[0]?.text === 'Cell started' && first[1].text === 'Air pressure low' && first[1].severity === 'Warning' && first[1].state === 'raised' && Math.abs(first[1].t - (t0 + 1000)) < 2 && first[1].source === 'MAIN.fbCell.fbAir', `at start: ${first?.map((e) => `${e.state} ${e.severity} "${e.text}"`).join(' | ')}`);
  // 2. An error alarm raised, its text not there yet: waited for; then there
  put(3, Date.now(), 2, 3, 9, 'MAIN.fbCell.fbDoor', '');
  setRing(3);
  await h.sleep(3000);
  const before = kept().length;
  put(3, Date.now() - 3000, 2, 3, 9, 'MAIN.fbCell.fbDoor', 'Door 2 sensor lost');
  setRing(3);
  const third = await h.until(() => kept().find((e) => e.text === 'Door 2 sensor lost'), 10000);
  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token: TOKEN }));
  await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
  const history = async () => {
    got.length = 0;
    ws.send(JSON.stringify({ type: 'alertsList' }));
    return (await h.until(() => got.find((m) => m.type === 'alertsList')?.events, 5000)) ?? [];
  };
  const raised = (await history()).find((e) => e.event === 'plcEvent');
  expect(before === 2 && third?.severity === 'Error' && raised?.machine === 'MAIN.fbCell.fbDoor' && /Line 6: 🔔 MAIN.fbCell.fbDoor: Door 2 sensor lost \(Error\)/.test(raised.text) && !raised.resolvedAt && !(await history()).some((e) => e.event === 'plcEvent' && /Air pressure/.test(e.text)), `an error alarm: waited for its text (${before} kept meanwhile), then "${raised?.text}"; a warning one no alert`);
  // 3. Cleared: its alert resolved
  put(4, Date.now(), 3, 3, 9, 'MAIN.fbCell.fbDoor', 'Door 2 sensor lost');
  setRing(4);
  const resolved = await h.until(() => history().then((ev) => ev.find((e) => e.event === 'plcEvent' && e.resolvedAt)), 10000);
  expect(!!resolved && kept().some((e) => e.state === 'cleared'), `cleared: the alert resolved (${resolved?.resolvedAt})`);
  ws.close();
  // 4. The setup page: its state, its instance per PLC (a bad one refused), the function block's source
  const st = await api('GET', '/admin/api/eventlog');
  const bad = await api('POST', '/admin/api/eventlog/live', { live: { line: 'not a symbol!' } });
  const fb = await api('GET', '/admin/plc/FB_KvalEventRelay.st');
  expect(st.json?.live?.line === 'MAIN.fbEventRelay' && st.json.relay?.line?.seq === 4 && !st.json.relay.line.error && st.json.stats?.line?.count === 4 && bad.status >= 400 && /its instance/.test(bad.json?.error ?? '') && fb.status === 200 && /FUNCTION_BLOCK FB_KvalEventRelay EXTENDS FB_ListenerBase2/.test(fb.text) && /pack_mode/.test(fb.text), `the setup page: ${st.json?.live?.line}, read to event ${st.json?.relay?.line?.seq}, ${st.json?.stats?.line?.count} kept; a bad instance: ${bad.json?.error}; the FB's source (${fb.text?.length} chars)`);
  const off = await api('POST', '/admin/api/eventlog/live', { live: {} });
  expect(off.json?.ok && !JSON.parse(fs.readFileSync(configPath, 'utf8')).eventlog?.live, 'none live: taken out of config.json');
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
