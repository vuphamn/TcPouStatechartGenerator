// Shift handover (gateway/handover.cjs; simulated PLC symbols-plc.cjs; the web app from dist/): the shift so far
// summed up (its alerts by kind and machine, the alerts still open, the work orders opened); a technician hands over
// with a note (told to the channel that wants handovers); someone without a role may not; the next shift's operator
// sees it unread on the board, reads it (who read it, kept), and hands over from the board.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8510;
const HOOK = 8511;
const BASE = `http://localhost:${PORT}`;
const tok = (n) => `handover-${n}-token`;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const M = `${R}.aDoors[2]`;

(async () => {
  const posted = [];
  const hook = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      try { posted.push(JSON.parse(b)); } catch { /* not JSON */ }
      res.end('ok');
    });
  }).listen(HOOK);
  const cfg = writeSymbolsPlc('fake-ams2-handover.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48997', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-handover');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // (this shift: two errors of aDoors[2], one still open; a call for maintenance)
  const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  fs.writeFileSync(path.join(dir, 'alerts-history.json'), JSON.stringify([
    { id: 'e1', event: 'error', plc: 'line', plcName: 'Line 5', machine: M, state: 'DOOR_DASHER_ERROR', text: 'Line 5: aDoors[2] in DOOR_DASHER_ERROR', at: at(3), ack: null, resolvedAt: at(2) },
    { id: 'e2', event: 'error', plc: 'line', plcName: 'Line 5', machine: M, state: 'DOOR_DASHER_ERROR', text: 'Line 5: aDoors[2] in DOOR_DASHER_ERROR again', at: at(1), ack: null, resolvedAt: null },
    { id: 'c1', event: 'call', plc: 'line', plcName: 'Line 5', machine: M, state: 'Mechanical', text: 'Line 5: maintenance called', at: at(2), ack: null, resolvedAt: at(1) },
  ]));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 5', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48997', port: 851 }],
    tokens: ['ann', 'tim', 'zed'].map((n) => ({ name: n, sha256: sha(tok(n)) })),
    roles: { users: { ann: 'operator', tim: 'technician' }, groups: {}, default: '', startPages: {}, notify: [{ role: 'supervisor', webhook: `http://127.0.0.1:${HOOK}/hook`, format: 'json', events: ['handover'], onCall: [] }] },
    shifts: [{ name: 'Day', from: '00:00', to: '12:00' }, { name: 'Night', from: '12:00', to: '00:00' }],
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-handover-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  const session = async (name) => {
    const got = [];
    const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: tok(name) }));
    await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
    let id = 100;
    const ask = async (msg, reply) => {
      const requestId = ++id;
      ws.send(JSON.stringify({ ...msg, requestId }));
      return h.until(() => got.find((m) => m.type === reply && m.requestId === requestId), 15000);
    };
    return { ws, got, ask };
  };
  const tim = await session('tim');
  // 1. The shift so far
  const order = await tim.ask({ type: 'workCreate', order: { title: 'Tighten the door 2 sensor', plc: 'line', machine: M, priority: 'high' } }, 'workResult');
  const draft = await tim.ask({ type: 'handoverDraft', plcs: ['line'] }, 'handoverDraftResult');
  const s = draft?.summary;
  expect(/^(Day|Night)$/.test(draft?.shift?.name ?? '') && s?.alerts?.total === 3 && s.alerts.counts.error === 2 && s.alerts.counts.call === 1 && s.alerts.machines[0]?.count === 3 && s.open.length === 1 && s.open[0].id === 'e2' && order?.ok && s.work.opened.some((o) => o.title === 'Tighten the door 2 sensor') && s.work.open.length === 1, `the shift so far (${draft?.shift?.name}): ${s?.alerts?.total} alerts ${JSON.stringify(s?.alerts?.counts)}, open ${s?.open?.map((x) => x.id)}, work opened ${s?.work?.opened?.length}`);
  // 2. Handed over, told; someone without a role may not
  const saved = await tim.ask({ type: 'handoverSave', note: 'Door 2 sensor loose: watch it', plcs: ['line'] }, 'handoverResult');
  const zed = await session('zed');
  const denied = await zed.ask({ type: 'handoverSave', note: 'x' }, 'handoverResult');
  const told = await h.until(() => posted.find((p) => p.event === 'handover'), 8000);
  expect(saved?.ok && denied?.ok === false && /handed over by tim: 3 alert\(s\)/.test(told?.text ?? '') && /Door 2 sensor loose/.test(told?.text ?? ''), `handed over (${saved?.ok}); zed may not (${denied?.message ?? denied?.error}); told: ${told?.text}`);
  const health = await tim.ask({ type: 'alarmHealth', days: 1, plcs: ['line'] }, 'alarmHealthResult');
  expect(health?.total === 2 && health.top[0]?.count === 2 && health.top[0].machine === M && health.ack.notAcked === 2 && health.rating === 'acceptable', `alarm health of the same history: ${health?.total} alarms (the call not one), worst ${health?.top?.[0]?.count}, ${health?.rating}`);
  zed.ws.close();
  tim.ws.send(JSON.stringify({ type: 'handoverWatch' }));
  await h.until(() => tim.got.find((m) => m.type === 'handoverState' && m.list?.length), 5000);

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('board-handover'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1400, height: 950 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    // 3. The next shift's operator: unread on the board; read
    await p.goto(`${BASE}/?board&lang=en`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', tok('ann'));
    await p.keyboard.press('Enter');
    const dot = await h.until(() => p.$('#board-handover-unread'), 20000);
    await p.click('#board-handover');
    await p.waitForSelector('#board-handover-dialog', { timeout: 5000 });
    const shown = await h.until(() => p.evaluate(() => ({ note: document.querySelector('#handover-note-shown')?.textContent, alerts: document.querySelector('#handover-last [data-part="alerts"]')?.textContent, now: document.querySelector('#handover-now [data-part="work"]')?.textContent })).then((x) => (x.note && x.now ? x : null)), 10000);
    await p.click('#handover-read');
    const read = await h.until(() => p.$('#board-handover-unread').then((x) => (x ? null : true)), 8000);
    const file = JSON.parse(fs.readFileSync(path.join(dir, 'handover.json'), 'utf8'));
    expect(!!dot && /sensor loose/.test(shown?.note ?? '') && /3 alerts/.test(shown?.alerts ?? '') && /1 open/.test(shown?.now ?? '') && read && file[0]?.reads?.[0]?.by === 'ann', `the board: unread ${!!dot}; shown ${JSON.stringify(shown)}; read by ${file[0]?.reads?.map((r) => r.by)}`);
    // 4. Handed over from the board; the technician's board told
    await p.type('#handover-note', 'All quiet after 2 pm');
    await p.click('#handover-save');
    const msg = await h.until(() => p.$eval('#handover-msg', (e) => e.textContent).catch(() => null), 8000);
    const timSees = await h.until(() => [...tim.got].reverse().find((m) => m.type === 'handoverState' && m.list?.length === 2), 8000);
    expect(/Handed over/.test(msg ?? '') && timSees?.list?.[0]?.by === 'ann' && timSees.list[0].note === 'All quiet after 2 pm' && timSees.list[1].reads.some((r) => r.by === 'ann'), `from the board: ${msg}; the technician sees ${timSees?.list?.map((x) => `${x.by} (${x.reads.length} read)`).join(', ')}`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  tim.ws.close();
  gw.kill();
  plc.kill();
  hook.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
