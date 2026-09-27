// Operator board and alert history (gateway, simulated PLC symbols-plc.cjs): boardWatch sends the machines' states
// (error flagged, the rule's limit); alerts go to the history (alerts-history.json) and to open boards; Acknowledge
// with a note is sent to every board and posted to the rule's webhook; a recovery resolves the machine's alerts.
// In a browser (the build in dist/): ?board asks for a token, then shows the tiles (red error, amber stuck) and the
// alerts panel; Acknowledge there.
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
const PORT = 8463;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'board-test-token';

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
  const posts = [];
  const hook = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      posts.push(JSON.parse(b || '{}'));
      res.end('1');
    });
  });
  await new Promise((r) => hook.listen(48978, '127.0.0.1', r));
  // (aDoors[1] leaves DISABLED after 6 s: its stuck alert, then its recovery)
  const cfg = writeSymbolsPlc('fake-ams2-board.json');
  const plcConfig = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  plcConfig.script[0].hold = 6000;
  fs.writeFileSync(cfg, JSON.stringify(plcConfig));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48977', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-board');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line202', name: 'Line 202', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48977', port: 851 }],
    tokens: [{ name: 'operator', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    alerts: [{ id: 'a1', name: 'Line 202', enabled: true, plc: 'line202', root: R, stateVar: 'machineState', stuckAfterMs: null, stateLimits: { DOOR_DASHER_DISABLED: 2000 }, onError: true, errorPattern: 'ERROR', notifyRecovery: true, webhook: 'http://127.0.0.1:48978/hook', format: 'json' }],
  }, null, 2));
  const logFile = h.out('gw-board-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  // The board's protocol
  const a = client();
  await a.ready;
  await a.wait((m) => m.type === 'welcome');
  a.send({ type: 'boardWatch', plcs: ['line202'] });
  a.send({ type: 'alertsList' });
  const board = await a.wait((m) => m.type === 'boardState' && m.plcs[0]?.machines.length === 5 && m.plcs[0].machines.every((x) => x.state));
  const machines = board?.plcs[0].machines ?? [];
  const door2 = machines.find((x) => x.path === `${R}.aDoors[2]`);
  const door1 = machines.find((x) => x.path === `${R}.aDoors[1]`);
  expect(board?.plcs[0].name === 'Line 202' && typeof board.now === 'number', 'boardState: the PLC and the gateway\'s time');
  expect(door2?.error === true && door2.state === 'DOOR_DASHER_ERROR' && door1?.state === 'DOOR_DASHER_DISABLED' && door1.limitMs === 2000 && machines.every((x) => typeof x.since === 'number'), `machines: ${machines.map((x) => `${x.path.replace(R, '')}=${x.state}${x.error ? '!' : ''}`).join(' ')}`);
  expect(!!(await a.wait((m) => m.type === 'alertsList')), 'alertsList answered');
  const errorAlert = await a.wait((m) => m.type === 'alertEvent' && m.event.event === 'error' && m.event.machine === `${R}.aDoors[2]`);
  const stuckAlert = await a.wait((m) => m.type === 'alertEvent' && m.event.event === 'stuck' && m.event.machine === `${R}.aDoors[1]`, 6000);
  expect(!!errorAlert && !!stuckAlert && !!errorAlert.event.id, 'new alerts reach the open board (error, stuck)');

  // Acknowledge from a second board: both see it, the webhook gets it
  const b = client();
  await b.ready;
  await b.wait((m) => m.type === 'welcome');
  b.send({ type: 'alertsList' });
  const list = await b.wait((m) => m.type === 'alertsList' && m.events.length >= 2);
  expect(list && list.events[0].at >= list.events[list.events.length - 1].at, `the history, newest first (${list?.events.length})`);
  b.send({ type: 'alertAck', requestId: 7, id: stuckAlert.event.id, note: 'on my way' });
  const res = await b.wait((m) => m.type === 'alertAckResult' && m.requestId === 7);
  const seen = await a.wait((m) => m.type === 'alertEvent' && m.event.id === stuckAlert.event.id && m.event.ack);
  await h.sleep(500);
  expect(res?.ok && seen?.event.ack.by === 'operator' && seen.event.ack.note === 'on my way', 'acknowledged: the other board sees who and the note');
  expect(posts.some((p) => p.event === 'acknowledged' && /operator acknowledged: Line 202: .*aDoors\[1\] is stuck in DOOR_DASHER_DISABLED .* · on my way/.test(p.text)), 'posted to the rule\'s webhook');
  // The recovery (aDoors[1] leaves DISABLED at 6 s) resolves its stuck alert
  const resolved = await a.wait((m) => m.type === 'alertEvent' && m.event.id === stuckAlert.event.id && m.event.resolvedAt, 8000);
  expect(!!resolved, 'the recovery resolves the stuck alert');
  await h.sleep(800);
  const history = JSON.parse(fs.readFileSync(path.join(dir, 'alerts-history.json'), 'utf8'));
  expect(history.some((e) => e.id === stuckAlert.event.id && e.ack?.by === 'operator') && history.some((e) => e.event === 'recovered'), `kept in alerts-history.json (${history.length})`);
  expect(/alerts: operator acknowledged stuck .*aDoors\[1\] \("on my way"\)/.test(fs.readFileSync(logFile, 'utf8')), 'logged');
  a.ws.close();
  b.ws.close();

  // In a browser
  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('board-tile'));
  if (!built) {
    console.log('skip the browser part: dist/ is an older build (npm run build)');
  } else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 900 } });
    const p = await browser.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/?board&title=Line%20202&plcs=line202`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 }).catch(() => {});
    expect(!!(await p.$('#board-signin')) && !(await p.$('#mermaid-canvas-area')), '?board: the board (not the editor), asking for a token');
    await p.type('#board-token', TOKEN);
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelectorAll('.board-tile').length === 5, { timeout: 10000 }).catch(() => {});
    const tiles = await p.$$eval('.board-tile', (t) => t.map((x) => `${x.getAttribute('data-path').split('.').pop()}=${x.getAttribute('data-kind')}`));
    expect(tiles.length === 5 && tiles[0] === 'aDoors[2]=error', `tiles, problems first: ${tiles.join(' ')}`);
    expect(/Line 202/.test(await p.$eval('#board-title', (e) => e.textContent)) && /1 in error/.test(await p.$eval('#board-counts', (e) => e.textContent)), 'the title and the counts');
    const alertsShown = await p.$$eval('.board-alert', (a) => a.length);
    expect(alertsShown >= 3 && /operator/.test(await p.$eval('#board-alerts', (e) => e.innerText)), `the alerts panel: ${alertsShown}, with the acknowledgement`);
    // Acknowledge the open error alert there
    const openBtn = await p.$(`.board-alert[data-alert="${errorAlert.event.id}"] .board-ack-btn`);
    expect(!!openBtn, 'the open error alert has Acknowledge');
    if (openBtn) {
      await openBtn.click();
      await p.type('.board-ack-note', 'checking');
      await p.click('.board-ack-send');
      await p.waitForFunction(() => /checking/.test(document.getElementById('board-alerts').innerText), { timeout: 5000 }).catch(() => {});
      expect(/operator.*checking/.test(await p.$eval(`.board-alert[data-alert="${errorAlert.event.id}"]`, (e) => e.innerText)), 'Acknowledge on the board (with its note)');
      await h.sleep(500);
      expect(posts.some((x) => x.event === 'acknowledged' && /aDoors\[2\].* · checking/.test(x.text)), 'and posted to the webhook');
    }
    await p.screenshot({ path: h.out('operator-board.png') });
    expect(await p.evaluate(() => localStorage.getItem('kss.gateway.token')) === TOKEN, 'the token is kept for the wall screen');
    expect(errors.length === 0, `no page errors ${errors.slice(0, 2).join(' | ')}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  hook.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
