// Gateway operations (simulated PLC symbols-plc.cjs; aDoors[1] leaves DISABLED after 6 s, aDoors[2] is in error):
// escalation of an alert nobody acknowledged; quiet hours mute a rule; maintenance set on the board mutes the PLC,
// is announced on the webhook and shown on boards, and ends; saved boards (boardList, ?board=<id>); recordings on
// the gateway (the day's file, recordingsList, recordingQuery). In a browser (a current dist/): the saved board with
// its maintenance, and the web app replaying a gateway recording with the measured state times on the diagram.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
const { parseQuietHours, isQuiet } = require(path.join(h.REPO, 'gateway', 'alerts.cjs'));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8465;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'ops-test-token';

function client() {
  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  const ready = new Promise((r) => ws.on('open', r)).then(() => ws.send(JSON.stringify({ type: 'hello', token: TOKEN })));
  const wait = async (test, ms = 8000) => {
    for (let t = 0; t < ms; t += 100) {
      const hit = got.find(test);
      if (hit) return hit;
      await h.sleep(100);
    }
    return null;
  };
  return { ws, got, ready, wait, send: (m) => ws.send(JSON.stringify(m)) };
}

(async () => {
  // Quiet hours: the parser (days, ranges past midnight, whole days)
  const q = parseQuietHours('Mon-Fri 22:00-06:00; Sat,Sun');
  expect(isQuiet(q, new Date('2026-09-28T23:00')) && isQuiet(q, new Date('2026-09-29T05:59')) && !isQuiet(q, new Date('2026-09-29T06:00')) && isQuiet(q, new Date('2026-09-26T12:00')) && !isQuiet(q, new Date('2026-09-28T02:00')), 'quiet hours: Mon-Fri 22:00-06:00 and the weekend');

  const posts = [];
  const hook = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      posts.push({ path: req.url, body: JSON.parse(b || '{}') });
      res.end('1');
    });
  });
  await new Promise((r) => hook.listen(48980, '127.0.0.1', r));
  const cfg = writeSymbolsPlc('fake-ams2-ops.json');
  const plcConfig = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  plcConfig.script[0].hold = 6000;
  fs.writeFileSync(cfg, JSON.stringify(plcConfig));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48979', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-ops');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  const hookUrl = (p) => `http://127.0.0.1:48980/${p}`;
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000, escalationCheckMs: 500,
    plcs: [{ id: 'line202', name: 'Line 202', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48979', port: 851 }],
    tokens: [{ name: 'operator', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    alerts: [
      // (escalation after 3 s here; the setup page allows 1 minute and more)
      { id: 'a1', name: 'Line 202', enabled: true, plc: 'line202', root: R, stateVar: 'machineState', stuckAfterMs: null, stateLimits: {}, onError: true, errorPattern: 'ERROR', notifyRecovery: true, webhook: hookUrl('main'), format: 'json', escalateAfterMin: 0.05, escalateWebhook: hookUrl('supervisor'), escalateFormat: 'teams' },
      { id: 'a2', name: 'Quiet', enabled: true, plc: 'line202', root: R, stateVar: 'machineState', stuckAfterMs: null, stateLimits: {}, onError: true, errorPattern: 'ERROR', notifyRecovery: false, webhook: hookUrl('quiet'), format: 'json', quietHours: '00:00-24:00' },
    ],
    boards: [{ id: 'l202', title: 'Line 202 board', plcs: ['line202'], root: R, stuck: 5 }],
    recordings: [{ id: 'r1', name: 'Line 202 all day', enabled: true, plc: 'line202', root: R, stateVar: 'machineState', days: 7 }],
  }, null, 2));
  const logFile = h.out('gw-ops-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);
  const logText = () => fs.readFileSync(logFile, 'utf8');

  const a = client();
  await a.ready;
  await a.wait((m) => m.type === 'welcome');
  a.send({ type: 'alertsList' });
  a.send({ type: 'boardList' });
  const bl = await a.wait((m) => m.type === 'boardList');
  expect(bl?.boards.length === 1 && bl.boards[0].title === 'Line 202 board', 'saved boards: boardList');

  // Escalation: aDoors[2]'s error, not acknowledged: posted again to the supervisor webhook, once
  const err = await a.wait((m) => m.type === 'alertEvent' && m.event.event === 'error' && m.event.ruleId === 'a1');
  const esc = await a.wait((m) => m.type === 'alertEvent' && m.event.id === err?.event.id && m.event.escalatedAt, 8000);
  await h.sleep(1500);
  const sup = posts.filter((p) => p.path === '/supervisor');
  expect(!!esc && sup.length === 1 && /^⏰ Not acknowledged for 0\.05 min: Line 202: .*aDoors\[2\] is in DOOR_DASHER_ERROR/.test(sup[0].body.text) && Object.keys(sup[0].body).length === 1, `escalated once, Teams format to the supervisor: ${sup[0]?.body.text}`);
  // Quiet hours all day: the second rule sends nothing
  expect(!posts.some((p) => p.path === '/quiet') && /alerts: error .*aDoors\[2\] muted \(quiet hours\)/.test(logText()), 'quiet hours: the muted rule sends nothing (logged)');

  // Maintenance from the board: announced, shown, alerts muted; ended
  const board = client();
  await board.ready;
  await board.wait((m) => m.type === 'welcome');
  board.send({ type: 'boardWatch', plcs: ['line202'], root: R });
  board.send({ type: 'maintenanceSet', requestId: 3, plc: 'line202', minutes: 60, note: 'clamp sensor' });
  const mr = await board.wait((m) => m.type === 'maintenanceResult' && m.requestId === 3);
  const shown = await board.wait((m) => m.type === 'boardState' && m.plcs[0]?.maintenance?.by === 'operator');
  await h.sleep(500);
  expect(mr?.ok && shown?.plcs[0].maintenance.note === 'clamp sensor' && JSON.parse(fs.readFileSync(path.join(dir, 'maintenance.json'), 'utf8')).windows.some((w) => w.plc === 'line202' && w.by === 'operator'), 'maintenance: set, on the board, in maintenance.json');
  expect(posts.some((p) => p.path === '/main' && p.body.event === 'maintenance' && /in maintenance until .* \(operator: clamp sensor\); alerts are muted/.test(p.body.text)), 'announced on the webhook');
  // aDoors[1] leaves DISABLED at 6 s: its recovery is muted, like any alert
  const before = posts.filter((p) => p.path === '/main' && p.body.event !== 'maintenance').length;
  await h.sleep(4500);
  expect(posts.filter((p) => p.path === '/main' && p.body.event !== 'maintenance').length === before && /muted \(maintenance\)|maintenance/.test(logText()), 'in maintenance: no alerts posted');
  board.send({ type: 'maintenanceSet', requestId: 4, plc: 'line202', minutes: 0 });
  await board.wait((m) => m.type === 'maintenanceResult' && m.requestId === 4);
  await h.sleep(500);
  expect(posts.some((p) => p.body.event === 'maintenance' && /operator ended the maintenance/.test(p.body.text)) && !JSON.parse(fs.readFileSync(path.join(dir, 'maintenance.json'), 'utf8')).windows.length && JSON.parse(fs.readFileSync(path.join(dir, 'maintenance.json'), 'utf8')).history.some((w) => w.plc === 'line202'), 'ended: announced, moved to the history');
  expect((await board.wait((m) => m.type === 'maintenanceResult' && m.requestId === 5, 10)) === null && (board.send({ type: 'maintenanceSet', requestId: 5, plc: 'nope', minutes: 10 }), !!(await board.wait((m) => m.type === 'maintenanceResult' && m.requestId === 5 && !m.ok))), 'another PLC: refused');

  // Recordings: today's file, the list, one machine's window (DISABLED, then ENABLING at 6 s)
  const today = (() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();
  await h.sleep(2500);
  const file = path.join(dir, 'recordings', 'r1', `${today}.jsonl`);
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  expect(lines.length >= 6 && lines.some((l) => l.m === `${R}.aDoors[1]` && l.v === 1), `recorded to recordings/r1/${today}.jsonl (${lines.length} lines)`);
  a.send({ type: 'recordingsList', requestId: 9 });
  const list = await a.wait((m) => m.type === 'recordingsList' && m.requestId === 9);
  const r1 = list?.recordings[0];
  expect(r1?.id === 'r1' && r1.days.includes(today) && r1.machines.length === 5 && r1.state === 'watching', `recordingsList: ${r1?.machines.length} machines, days ${r1?.days.join(',')}`);
  a.send({ type: 'recordingQuery', requestId: 10, id: 'r1', machine: `${R}.aDoors[1]`, from: Date.now() - 3600000, to: Date.now() });
  const data = await a.wait((m) => m.type === 'recordingData' && m.requestId === 10);
  expect(data?.values.map((v) => v.value).join() === '0,1' && data.machineType === 'SM_DoorDasher' && data.stateVar === 'machineState', `recordingQuery: ${data?.values.map((v) => v.value).join()} (${data?.machineType})`);
  a.send({ type: 'recordingQuery', requestId: 11, id: 'r1', machine: 'MAIN;x', from: 0, to: 1 });
  expect(!!(await a.wait((m) => m.type === 'recordingData' && m.requestId === 11 && m.error)), 'a bad query: refused');
  a.ws.close();
  board.ws.close();

  // In a browser
  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('gw-rec-replay'));
  if (!built) {
    console.log('skip the browser part: dist/ is an older build (npm run build)');
  } else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 950 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/`, { waitUntil: 'load' });
    await p.evaluate((t) => { localStorage.clear(); localStorage.setItem('kss.gateway.token', t); }, TOKEN);
    // The saved board, its maintenance from the page
    await p.goto(`${BASE}/?board=l202`, { waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelectorAll('.board-tile').length === 5, { timeout: 15000 }).catch(() => {});
    expect(/Line 202 board/.test(await p.$eval('#board-title', (e) => e.textContent).catch(() => '')) && (await p.$eval('#board-switch', (e) => e.value).catch(() => '')) === 'l202', 'the saved board: its title, chosen in the switcher');
    await p.click('.board-maintenance-btn');
    await p.select('.board-maintenance-minutes', '30');
    await p.type('.board-maintenance-note', 'test run');
    await p.click('.board-maintenance-start');
    await p.waitForSelector('.board-maintenance', { timeout: 5000 }).catch(() => {});
    expect(/Maintenance until .* \(operator: test run\), alerts muted/.test(await p.$eval('.board-maintenance', (e) => e.textContent).catch(() => '')), 'maintenance from the board: shown');
    await p.screenshot({ path: h.out('board-maintenance.png') });
    await p.click('.board-maintenance-end');
    await p.waitForFunction(() => !document.querySelector('.board-maintenance'), { timeout: 5000 }).catch(() => {});
    expect(!(await p.$('.board-maintenance')), 'End: gone');

    // The web app: Gateway recordings -> replay a machine's window; the state times, on the diagram
    await p.goto(`${BASE}/`, { waitUntil: 'load' });
    await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
    await p.click('#dock-tab-live');
    await p.waitForSelector('#live-gw-recordings', { timeout: 5000 }).catch(() => {});
    await p.click('#live-gw-recordings');
    await p.waitForSelector('#gw-rec-machine option', { timeout: 8000 }).catch(() => {});
    await p.select('#gw-rec-machine', `${R}.aDoors[1]`);
    await p.click('#gw-rec-replay');
    await p.waitForSelector('#live-replay-bar', { timeout: 8000 }).catch(() => {});
    if (!(await p.$('#live-replay-bar'))) console.log('   the dialog says:', await p.$eval('#gateway-recordings-dialog', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '(no dialog)'));
    await p.select('#live-replay-speed', '600');
    await p.waitForFunction(() => document.querySelectorAll('.live-trail-row').length >= 1, { timeout: 15000 }).catch(() => {});
    const trail = await p.$$eval('.live-trail-row', (r) => r.length);
    const barText = await p.$eval('#live-replay-bar', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '(no bar)');
    const current = await p.$eval('#live-current-state', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '(none)');
    expect(!!(await p.$('#live-replay-bar')) && trail >= 1, `the gateway recording replayed: ${trail} transition(s) [${barText}] now: ${current}`);
    if (!trail) await p.screenshot({ path: h.out('state-times-fail.png') });
    const row = await p.$eval('.live-state-time-row', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
    expect(/TABLEMANAGER_DISABLED 1 [\d.]+ s/.test(row), `State times: ${row}`);
    await p.click('#live-state-times-diagram');
    await h.sleep(800);
    const badge = await p.$eval('#mermaid-canvas-area .state-time-badge[data-state-id="TABLEMANAGER_DISABLED"] text', (e) => e.textContent).catch(() => '');
    expect(/⌀ [\d.]+ s · 1×/.test(badge) && !!(await p.$('#mermaid-canvas-area g.node.state-time-l0[data-state-id="TABLEMANAGER_DISABLED"]')), `on the diagram: "${badge}"`);
    await p.screenshot({ path: h.out('state-times.png') });
    await p.click('#live-state-times-diagram');
    await h.sleep(500);
    expect(!(await p.$('#mermaid-canvas-area .state-time-badge')), 'off: the badges go');
    expect(errors.length === 0, `no page errors ${errors.slice(0, 2).join(' | ')}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  hook.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
