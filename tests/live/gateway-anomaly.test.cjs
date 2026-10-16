// Anomalies (gateway/anomaly.cjs; simulated PLC symbols-plc.cjs; a recording of the last hours): aDoors[1]'s stays of
// 5 minutes in each state, 30 times; live, it leaves ENABLING after 3 s (far shorter than usual) into its error state
// (a transition never seen): two anomalies, quiet (in the history, not open); the first stay (its start not seen) not
// judged; the unit rules (a stay far longer, one within its spread).
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
const { judgeStay } = require(path.join(h.REPO, 'gateway', 'anomaly.cjs'));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8521;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'anomaly-test-token';
const M = `${R}.aDoors[1]`;
const dayOf = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

(async () => {
  // 0. The rules
  const usual = Array.from({ length: 30 }, (_, i) => 300000 + (i % 5) * 1000);
  expect(judgeStay(900000, usual)?.kind === 'long' && judgeStay(3000, usual)?.kind === 'short' && judgeStay(303000, usual) === null && judgeStay(3000, usual.slice(0, 10)) === null, 'a stay far longer, far shorter, within its spread; too few stays to judge');
  const cfg = writeSymbolsPlc('fake-ams2-anomaly.json');
  const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  // (aDoors[1]: DISABLED, ENABLING after 3 s (the base script), its error state 3 s later)
  c.script = [...c.script, { hold: 3000, set: { [`${M}.machineState`]: 7 } }];
  fs.writeFileSync(cfg, JSON.stringify(c));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48969', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-anomaly');
  fs.rmSync(dir, { recursive: true, force: true });
  // (the last 5 hours: 30 cycles of DISABLED and ENABLING, 5 minutes each)
  const lines = [];
  let t = Date.now() - 6 * 3600000;
  for (let i = 0; i < 30; i++) {
    lines.push({ t, m: M, v: 0 });
    t += 300000;
    lines.push({ t, m: M, v: 1 });
    t += 300000;
  }
  lines.push({ t, m: M, v: 0 });
  const byDay = new Map();
  for (const l of lines) byDay.set(dayOf(l.t), [...(byDay.get(dayOf(l.t)) ?? []), JSON.stringify(l)]);
  fs.mkdirSync(path.join(dir, 'recordings', 'r1'), { recursive: true });
  for (const [d, ls] of byDay) fs.writeFileSync(path.join(dir, 'recordings', 'r1', `${d}.jsonl`), ls.join('\n') + '\n');
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 1', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48969', port: 851 }],
    tokens: [{ name: 'eng', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    recordings: [{ id: 'r1', name: 'Doors', enabled: true, plc: 'line', root: R, stateVar: 'machineState', days: 7, machines: [M] }],
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false }, axes: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-anomaly-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token: TOKEN }));
  await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
  // 1. Its two anomalies, quiet
  const found = await h.until(async () => {
    ws.send(JSON.stringify({ type: 'alertsList' }));
    await h.sleep(300);
    const ev = [...got].reverse().find((m) => m.type === 'alertsList')?.events ?? [];
    const an = ev.filter((e) => e.event === 'anomaly');
    return an.length >= 2 ? an : null;
  }, 25000);
  const short = found?.find((e) => /ENABLING lasted/.test(e.text));
  const fresh = found?.find((e) => /a transition not seen/.test(e.text));
  expect(/DOOR_DASHER_ENABLING lasted \d+(\.\d)? s, usually 5 min: far shorter than usual/.test(short?.text ?? '') && /DOOR_DASHER_ENABLING → DOOR_DASHER_ERROR: a transition not seen in its last 14 days/.test(fresh?.text ?? ''), `anomalies: ${found?.map((e) => e.text).join(' | ')}`);
  expect(found?.every((e) => e.resolvedAt && !e.ack) && !found.some((e) => /DISABLED lasted/.test(e.text)), 'quiet (in the history, not open); its first stay (its start not seen) not judged');
  ws.close();
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
