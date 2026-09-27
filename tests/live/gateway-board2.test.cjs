// Operator board, round two (simulated PLC symbols-plc.cjs; the web app from a current dist/):
// - state-time trends from the gateway's recordings (recordingStats; synthetic days with one state getting slower)
//   and the Trends tab of Gateway recordings in the web app;
// - the board: a new alert chimes (Web Audio, counted) and its tile flashes; sound can be switched off;
// - the board on a phone: Machines / Alerts tabs;
// - a tile opens the machine's diagram live (?watch=, a sample of that type) and, for a type without a sample, the
//   banner asking for its .TcPOU.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8467;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'board2-test-token';
const dayOf = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-board2.json');
  const plcConfig = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  // (aDoors[1] stays DISABLED for a minute: its stuck alert, at 35 s, comes once the board is open)
  plcConfig.script[0].hold = 60000;
  fs.writeFileSync(cfg, JSON.stringify(plcConfig));
  const dir = h.out('gw-board2');
  fs.rmSync(dir, { recursive: true, force: true });
  // Ten days of a recording: smTable1 cycles 2 -> 3 -> 2; its stay in 3 takes 10 s, the last three days 20 s
  const machine = `${R}.smTable1`;
  const recDir = path.join(dir, 'recordings', 'r1');
  fs.mkdirSync(recDir, { recursive: true });
  const DAY = 86400000;
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  for (let k = 10; k >= 1; k--) {
    const start = noon.getTime() - k * DAY;
    const slow = k <= 3;
    const lines = [];
    let t = start;
    for (let c = 0; c < 5; c++) {
      lines.push({ t, m: machine, v: 2 });
      t += 5000;
      lines.push({ t, m: machine, v: 3 });
      t += slow ? 20000 : 10000;
    }
    lines.push({ t, m: machine, v: 2 });
    fs.writeFileSync(path.join(recDir, `${dayOf(start)}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  }
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48981', cfg], { stdio: 'ignore' });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line202', name: 'Line 202', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48981', port: 851 }],
    tokens: [{ name: 'operator', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    alerts: [{ id: 'a1', name: 'Line 202', enabled: true, plc: 'line202', root: R, stateVar: 'machineState', stuckAfterMs: null, stateLimits: { DOOR_DASHER_DISABLED: 35000 }, onError: true, errorPattern: 'ERROR', notifyRecovery: true, webhook: null, format: 'json' }],
    recordings: [{ id: 'r1', name: 'Line 202 all day', enabled: true, plc: 'line202', root: R, stateVar: 'machineState', days: 30 }],
  }, null, 2));
  const logFile = h.out('gw-board2-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  // recordingStats over the protocol
  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token: TOKEN }));
  for (let i = 0; i < 50 && !got.some((m) => m.type === 'welcome'); i++) await h.sleep(100);
  await h.sleep(2500);
  ws.send(JSON.stringify({ type: 'recordingStats', requestId: 1, id: 'r1', machine, days: 14 }));
  let stats = null;
  for (let i = 0; i < 50 && !stats; i++) {
    stats = got.find((m) => m.type === 'recordingStats' && m.requestId === 1);
    await h.sleep(100);
  }
  const past = (stats?.days ?? []).filter((d) => d.day < dayOf(Date.now()));
  const s3 = past.map((d) => d.states['3']?.avgMs);
  expect(past.length === 10 && s3.slice(0, 7).every((v) => v === 10000) && s3.slice(7).every((v) => v === 20000) && past.every((d) => d.states['3'].n === 5), `recordingStats: 10 days, state 3: ${s3.join(', ')}`);
  // (state 2 also has the stay overnight, from the day before's last change: its median is the 5 s)
  expect(past.every((d) => d.states['2']?.medianMs === 5000) && past.slice(1).every((d) => d.states['2'].maxMs > 20 * 3600000), 'state 2: 5 s stays, and the one overnight');
  ws.close();

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('gw-rec-trends'));
  if (!built) {
    console.log('skip the browser part: dist/ is an older build (npm run build)');
  } else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 950 }, args: ['--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    // Count the chimes (oscillators started)
    await p.evaluateOnNewDocument(() => {
      window.__tones = 0;
      const orig = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        window.__tones++;
        return orig.call(this);
      };
    });
    await p.goto(`${BASE}/`, { waitUntil: 'load' });
    await p.evaluate((t) => { localStorage.clear(); localStorage.setItem('kss.gateway.token', t); }, TOKEN);

    // The Trends tab (the Table Manager sample: its enum names the states)
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
    await p.click('#dock-tab-live');
    await p.waitForSelector('#live-gw-recordings', { timeout: 8000 }).catch(() => {});
    await p.click('#live-gw-recordings');
    await p.waitForSelector('#gw-rec-machine option', { timeout: 8000 }).catch(() => {});
    await p.click('#gw-rec-tab-trends');
    await p.select('#gw-rec-machine', machine);
    await p.click('#gw-rec-trends-show');
    await p.waitForSelector('.gw-rec-trend-row', { timeout: 8000 }).catch(() => {});
    const rows = await p.$$eval('.gw-rec-trend-row', (r) => r.map((x) => `${x.getAttribute('data-state')}=${x.querySelector('.gw-rec-trend-change').textContent}`));
    expect(rows[0] === 'TABLEMANAGER_HOMMING=+100%' && rows.some((r) => /^TABLEMANAGER_HOMMING_READY_TO_START=/.test(r)), `Trends: slowing first, named from the .TcDUT: ${rows.join(' ')}`);
    expect(!!(await p.$('.gw-rec-trend-row[data-state="TABLEMANAGER_HOMMING"].bg-rose-950\\/40')) && (await p.$$('.gw-rec-trend-row svg circle')).length >= 10, 'the slowing state marked, with its daily line');
    await p.screenshot({ path: h.out('state-trends.png') });
    await p.keyboard.press('Escape');

    // The board: a new alert (aDoors[1] stuck in DISABLED after 35 s) chimes and flashes its tile
    await p.goto(`${BASE}/?board`, { waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelectorAll('.board-tile').length === 5, { timeout: 15000 }).catch(() => {});
    await p.mouse.click(400, 400); // (browsers play sound after a click)
    await p.waitForSelector('.board-tile-flash', { timeout: 40000 }).catch(() => {});
    const flashing = await p.$$eval('.board-tile-flash', (t) => t.map((x) => x.getAttribute('data-path')));
    const tones = await p.evaluate(() => window.__tones);
    expect(flashing.includes(`${R}.aDoors[1]`) && tones >= 2, `a new alert: its tile flashes (${flashing.join(', ')}), ${tones} tones`);
    expect(!(await p.$('.board-tile-flash[data-path="MAIN.mainStateMachine.aDoors[2]"]')), 'the alerts there when the board loaded do not flash');
    await p.click('#board-sound');
    expect((await p.evaluate(() => localStorage.getItem('kss.board.sound'))) === '0' && (await p.$eval('#board-sound', (e) => e.getAttribute('aria-pressed'))) === 'false', 'sound off: kept');
    await p.click('#board-sound');

    // A tile opens the diagram live: its link, then that page (SM_DoorDasher is a sample)
    const href = await p.$eval(`.board-tile[data-path="${R}.aDoors[2]"]`, (a) => a.getAttribute('href'));
    const u = new URL(href, BASE);
    expect(u.searchParams.get('watch') === 'SM_DoorDasher' && u.searchParams.get('instance') === `${R}.aDoors[2]` && u.searchParams.get('plc') === 'line202', `tile link: ${href}`);
    const w = await browser.newPage();
    w.on('pageerror', (e) => errors.push(e.message));
    await w.goto(new URL(href, BASE).toString(), { waitUntil: 'load' });
    await w.waitForFunction(() => /aDoors\[2\]\.machineState on Line 202/.test(document.getElementById('live-status')?.textContent || ''), { timeout: 20000 }).catch(() => {});
    const status = await w.$eval('#live-status', (e) => e.textContent).catch(() => '');
    expect(/aDoors\[2\]\.machineState on Line 202/.test(status) && (await w.evaluate(() => document.body.innerText.includes('SM_DoorDasher'))), `the diagram, live on that machine: ${status}`);
    await w.close();
    // A type without a sample: the banner asks for its .TcPOU
    const b2 = await browser.newPage();
    b2.on('pageerror', (e) => errors.push(e.message));
    await b2.goto(`${BASE}/?watch=SM_Unknown&instance=${encodeURIComponent(`${R}.stSettings`)}&plc=line202`, { waitUntil: 'load' });
    await b2.waitForSelector('#watch-banner', { timeout: 15000 }).catch(() => {});
    expect(/To watch MAIN\.mainStateMachine\.stSettings live, open SM_Unknown\.TcPOU/.test(await b2.$eval('#watch-banner', (e) => e.textContent).catch(() => '')) && !!(await b2.$('#watch-banner-browse')), 'no sample of that type: the banner, with Browse');
    await b2.close();

    // The board on a phone: Machines / Alerts tabs
    await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await h.sleep(800);
    expect(!!(await p.$('#board-phone-tabs')) && (await p.$$('.board-tile')).length === 5 && !(await p.$('#board-alerts')), 'phone: the tabs, the machines');
    await p.click('#board-tab-alerts');
    await h.sleep(300);
    expect(!!(await p.$('#board-alerts')) && !(await p.$('.board-tile')) && (await p.$$('.board-alert')).length >= 2, 'phone: the alerts tab');
    await p.screenshot({ path: h.out('board-phone.png') });
    await p.click('#board-tab-machines');
    await h.sleep(300);
    await p.screenshot({ path: h.out('board-phone-machines.png') });
    expect(errors.length === 0, `no page errors ${errors.slice(0, 2).join(' | ')}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
