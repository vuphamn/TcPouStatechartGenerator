const h = require('../lib/harness.cjs');
// Desktop app (Electron, dev server) against fake-ams2.cjs: live guard badges and values for Table Manager
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
const APP = h.REPO;
const I = 'MAIN.mainStateMachine.smTableManager';
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const config = {
  symbols: {
    [`${I}.machineState`]: { type: 'E_TableManager_States', dataType: 2, size: 2, value: 2 },
    [`${I}.cmd_bHome`]: { type: 'BOOL', dataType: 33, size: 1, value: true },
    [`${I}.smOutfeedStopAxis.config_fHomePosition`]: { type: 'LREAL', dataType: 5, size: 8, value: 12.5 },
    [`${I}.smOutfeedStopAxis.status_bHomed`]: { type: 'BOOL', dataType: 33, size: 1, value: false },
    [`${I}.smOutfeedStopAxis.fbMC_MoveAbsolute`]: { type: 'MC_MoveAbsolute', dataType: 65, size: 120, value: 0 },
    [`${I}.cmd_eFeedMode`]: { type: 'E_FeedMode', dataType: 2, size: 2, value: 0 },
  },
  script: [
    { hold: 6000, set: { [`${I}.smOutfeedStopAxis.status_bHomed`]: true } },
    { hold: 3000, set: { [`${I}.machineState`]: 33 } },
  ],
};
fs.writeFileSync(path.join(h.OUT, 'fake-ams2-guards.json'), JSON.stringify(config, null, 1));

(async () => {
  const plcOut = fs.openSync(path.join(h.OUT, 'fake-ams2-guards.txt'), 'w');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48952', path.join(h.OUT, 'fake-ams2-guards.json')], { stdio: ['ignore', plcOut, plcOut] });
  const electron = spawn(path.join(APP, 'node_modules/electron/dist/electron.exe'), ['.', '--remote-debugging-port=9562', `--user-data-dir=${path.join(h.OUT, 'electron-prof-' + Date.now())}`], {
    cwd: APP, env: (() => { const e = { ...process.env, VITE_DEV_SERVER_URL: h.APP_ORIGIN }; delete e.ELECTRON_RUN_AS_NODE; return e; })(), stdio: 'ignore',
  });
  let browser;
  for (let i = 0; i < 80 && !browser; i++) { await sleep(250); browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9562', defaultViewport: null }).catch(() => null); }
  let page;
  for (let i = 0; i < 40 && !page; i++) { page = (await browser.pages()).find((p) => p.url().startsWith(h.APP_ORIGIN)); if (!page) await sleep(250); }
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 30000 });
  await page.setViewport({ width: 1600, height: 1000 });
  await sleep(500);
  await page.click('#dock-tab-live');
  await sleep(500);
  const set = (id, v) => page.evaluate((id, v) => {
    const el = document.getElementById(id);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, id, v);
  await set('live-instance-input', I);
  await set('live-netid-input', '127.0.0.1.1.1');
  await set('live-ip-input', '127.0.0.1:48952');
  await set('live-port-input', '');
  expect(await page.$eval('#live-guards-active', (b) => b.getAttribute('aria-checked') === 'true'), 'guard values default to the active state');
  await page.click('#live-start-btn');
  await page.waitForFunction(() => document.getElementById('live-current-state')?.textContent === 'TABLEMANAGER_HOMMING_READY_TO_START', { timeout: 15000 });
  await sleep(1500);

  const badges = () => page.evaluate(() => [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel[data-edge-id] g.live-guard')].map((g) => ({
    edge: g.closest('g.edgeLabel').getAttribute('data-edge-id'),
    result: g.getAttribute('data-guard-result'),
    values: [...(g.parentElement.querySelector('g.live-guard-values')?.querySelectorAll('text') ?? [])].map((t) => t.textContent),
  })));
  const from = (list, to) => list.find((b) => b.edge.startsWith(`TABLEMANAGER_HOMMING_READY_TO_START->${to}`));

  // 1. cmd_bHome TRUE, position 12.5, not homed: the ELSE branch (HOMMING) fires
  let list = await badges();
  console.log('   badges:', list.map((b) => `${b.edge.replace(/TABLEMANAGER_/g, '')}=${b.result} [${b.values.join('; ')}]`).join('\n           '));
  expect(from(list, 'TABLEMANAGER_ERROR')?.result === 'false' && from(list, 'TABLEMANAGER_IDLE_FEED_OFF')?.result === 'false' && from(list, 'TABLEMANAGER_HOMMING')?.result === 'true', 'IF / ELSIF / ELSE results on the canvas');
  const errVals = from(list, 'TABLEMANAGER_ERROR')?.values.join(' | ') ?? '';
  expect(/cmd_bHome = TRUE/.test(errVals) && /config_fHomePosition = 12\.5/.test(errVals), `values next to the condition: ${errVals}`);
  const pre = list.find((b) => b.edge.startsWith('TableManagerEnabled->TABLEMANAGER_ERROR'));
  expect(pre && pre.result === 'unknown' && pre.values.some((v) => /fbMC_MoveAbsolute\.Error = \?/.test(v)), `preProcess guard with an unreadable variable: ${pre?.result} ${pre?.values.join(' | ')}`);
  expect(list.length <= 8, `only the active state's transitions (${list.length} badges)`);
  const panel = await page.$eval('#live-guard-list', (e) => e.innerText).catch(() => '');
  expect(/TABLEMANAGER_HOMMING/.test(panel) && /cmd_bHome = TRUE/.test(panel), 'the Live tab lists them');
  // The variable that is not a simple value is reported
  const errNote = await page.evaluate(() => [...document.querySelectorAll('#live-guard-list [title]')].map((e) => e.getAttribute('title')).join(' | '));
  expect(/not in the PLC|not a simple value/.test(errNote), `why a variable is unknown: ${errNote.slice(0, 120)}`);
  await page.screenshot({ path: path.join(h.OUT, 'guards-1.png') });
  // Close-up: zoom in on the active state's labels
  for (let i = 0; i < 14; i++) { await page.click("#zoom-in-button"); await sleep(120); }
  await page.click('#live-current-state');
  await sleep(1200);
  const box = await page.evaluate(() => {
    const els = [...document.querySelectorAll('g.edgeLabel[data-edge-id^="TABLEMANAGER_HOMMING_READY_TO_START->"]')];
    const rs = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    if (!rs.length) return null;
    const x = Math.min(...rs.map((r) => r.x)) - 40, y = Math.min(...rs.map((r) => r.y)) - 30;
    return { x: Math.max(0, x), y: Math.max(0, y), width: Math.min(900, Math.max(...rs.map((r) => r.right)) - x + 40), height: Math.min(600, Math.max(...rs.map((r) => r.bottom)) - y + 90) };
  });
  if (box) await page.screenshot({ path: path.join(h.OUT, 'guards-closeup.png'), clip: box });

  // 2. status_bHomed becomes TRUE: now the ELSIF (IDLE_FEED_OFF) fires
  await page.waitForFunction(() => {
    const g = [...document.querySelectorAll('g.edgeLabel[data-edge-id^="TABLEMANAGER_HOMMING_READY_TO_START->TABLEMANAGER_IDLE_FEED_OFF"] g.live-guard')][0];
    return g?.getAttribute('data-guard-result') === 'true';
  }, { timeout: 10000 }).catch(() => {});
  list = await badges();
  expect(from(list, 'TABLEMANAGER_IDLE_FEED_OFF')?.result === 'true' && from(list, 'TABLEMANAGER_HOMMING')?.result === 'false', 'a value change updates the results');

  // 3. The state changes to ERROR: its transitions are followed now (FEEDMODE_OFF is not a known enum here)
  await page.waitForFunction(() => document.getElementById('live-current-state')?.textContent === 'TABLEMANAGER_ERROR', { timeout: 10000 });
  await sleep(1500);
  list = await badges();
  const e = list.find((b) => b.edge.startsWith('TABLEMANAGER_ERROR->TABLEMANAGER_IDLE_FEED_OFF'));
  expect(e && e.values.some((v) => /cmd_eFeedMode = 0/.test(v)) && !from(list, 'TABLEMANAGER_HOMMING'), `ERROR's transition followed: ${e?.result} [${e?.values.join('; ')}]`);
  await page.screenshot({ path: path.join(h.OUT, 'guards-3.png') });

  // 4. All transitions: badges everywhere, values only on the active state's
  await page.click('#live-guards-all');
  await sleep(2500);
  list = await badges();
  const withValues = list.filter((b) => b.values.length > 0).length;
  expect(list.length > 40 && withValues <= 3, `all transitions: ${list.length} badges, ${withValues} with values`);
  await page.screenshot({ path: path.join(h.OUT, 'guards-all.png') });

  // 5. Off: no badges, the PLC's notifications for the guard variables are deleted
  await page.click('#live-guards-off');
  await sleep(1500);
  list = await badges();
  expect(list.length === 0, 'off: no badges');
  const plcLog = fs.readFileSync(path.join(h.OUT, 'fake-ams2-guards.txt'), 'utf8');
  expect(/delete notification \d+ .*cmd_bHome/.test(plcLog) && /release handle .*cmd_bHome/.test(plcLog), 'guard variables released in the PLC');
  expect(/add notification \d+ for .*cmd_bHome \(cycle 100000\)/.test(plcLog), 'guard variables checked every 10 ms (100000 x 100 ns)');
  expect(!/add notification \d+ for .*fbMC_MoveAbsolute/.test(plcLog), 'no notification for the non-simple variable');

  await page.click('#live-stop-btn').catch(() => {});
  console.log('page errors:', errors.slice(0, 5));
  await browser.close().catch(() => {});
  electron.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
