const h = require('../lib/harness.cjs');
// Desktop app: a window per POU, each with its own live session
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
const APP = h.REPO;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const door = path.join(h.FIXTURES, 'sample1', 'SM_DoorDasher.TcPOU');
const table = path.join(h.FIXTURES, 'sample0', 'SM_TableManager.TcPOU');
const profile = path.join(h.OUT, 'electron-prof-multi-' + Date.now());
const env = (() => { const e = { ...process.env, VITE_DEV_SERVER_URL: h.APP_ORIGIN }; delete e.ELECTRON_RUN_AS_NODE; return e; })();
const launch = (args, port) => spawn(path.join(APP, 'node_modules/electron/dist/electron.exe'), ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...args], { cwd: APP, env, stdio: 'ignore' });

// A PLC with both state machines
const TMI = 'MAIN.mainStateMachine.smTableManager';
const DDI = 'MAIN.mainStateMachine.smDoorDasher';
fs.writeFileSync(path.join(h.OUT, 'fake-ams2-multi.json'), JSON.stringify({
  symbols: {
    [`${TMI}.machineState`]: { type: 'E_TableManager_States', dataType: 2, size: 2, value: 2 },
    [`${DDI}.machineState`]: { type: 'E_DoorDasher_States', dataType: 2, size: 2, value: 0 },
  },
  script: [{ hold: 4000, set: { [`${TMI}.machineState`]: 3, [`${DDI}.machineState`]: 1 } }, { hold: 4000, set: { [`${DDI}.machineState`]: 0 } }],
}));

(async () => {
  const plcLog = path.join(h.OUT, 'fake-ams2-multi.txt');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48955', path.join(h.OUT, 'fake-ams2-multi.json')], { stdio: ['ignore', fs.openSync(plcLog, 'w'), fs.openSync(plcLog, 'a')] });
  const first = launch([door], 9589);
  let browser;
  for (let i = 0; i < 80 && !browser; i++) { await sleep(250); browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9589', defaultViewport: null }).catch(() => null); }
  const appPages = async () => (await browser.pages()).filter((p) => p.url().startsWith(h.APP_ORIGIN));
  const waitPages = async (n) => { for (let i = 0; i < 60; i++) { const ps = await appPages(); if (ps.length >= n) return ps; await sleep(250); } return appPages(); };
  const fileOf = (p) => p.$eval('#status-file', (e) => e.textContent).catch(() => '');
  const waitFile = async (p, rx) => { let f = ''; for (let i = 0; i < 60 && !rx.test(f); i++) { await sleep(300); f = await fileOf(p); } return f; };

  let pages = await waitPages(1);
  const w1 = pages[0];
  expect(/SM_DoorDasher/.test(await waitFile(w1, /SM_DoorDasher/)), 'first start: Door Dasher in window 1');
  // Explorer opens another POU: a second window
  const second = launch([table], 9590);
  await new Promise((r) => { second.on('exit', r); setTimeout(r, 15000); });
  pages = await waitPages(2);
  const w2 = pages.find((p) => p !== w1);
  expect(pages.length === 2 && w2 && /SM_TableManager/.test(await waitFile(w2, /SM_TableManager/)), `another POU opens a second window (${pages.length} windows)`);
  expect(/SM_DoorDasher/.test(await fileOf(w1)), 'window 1 still shows Door Dasher');
  // The same POU again: its window comes forward, no third window
  const third = launch([door], 9591);
  await new Promise((r) => { third.on('exit', r); setTimeout(r, 15000); });
  await sleep(1500);
  expect((await appPages()).length === 2, 'the same POU again: no new window');
  const titles = await Promise.all((await appPages()).map((p) => p.title()));
  expect(titles.includes('SM_DoorDasher - Kval StateScope') && titles.includes('SM_TableManager - Kval StateScope'), `window titles: ${titles.join(' | ')}`);

  // Live in both windows at once
  const goLive = async (p, instance) => {
    await p.bringToFront();
    await p.click('#dock-tab-live');
    await sleep(400);
    const set = (id, v) => p.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
    await set('live-instance-input', instance);
    await set('live-netid-input', '127.0.0.1.1.1');
    await set('live-ip-input', '127.0.0.1:48955');
    await set('live-port-input', '');
    await p.click('#live-guards-off').catch(() => {});
    await p.click('#live-start-btn');
  };
  const current = (p) => p.$eval('#live-current-state', (e) => e.textContent).catch(() => '');
  await goLive(w1, DDI);
  await goLive(w2, TMI);
  let s1 = '', s2 = '';
  for (let i = 0; i < 40 && !(s1 && s2); i++) { await sleep(300); s1 = await current(w1); s2 = await current(w2); }
  expect(/DOOR_DASHER/.test(s1) && /TABLEMANAGER_HOMMING_READY_TO_START/.test(s2), `both windows live at once: ${s1} | ${s2}`);
  // Stopping window 1 leaves window 2 live
  await w1.bringToFront();
  await w1.click('#live-stop-btn');
  for (let i = 0; i < 30 && !/TABLEMANAGER_HOMMING$/.test(s2); i++) { await sleep(400); s2 = await current(w2); }
  const w2running = await w2.$('#live-stop-btn');
  expect(/TABLEMANAGER_HOMMING$/.test(s2) && !!w2running, `window 1 stopped, window 2 still follows its PLC (${s2})`);
  // Closing window 2 ends its session
  const before = (fs.readFileSync(plcLog, 'utf8').match(/delete notification/g) || []).length;
  await w2.close();
  await sleep(2500);
  const after = (fs.readFileSync(plcLog, 'utf8').match(/delete notification/g) || []).length;
  expect(after > before && (await appPages()).length === 1, `closing window 2 ended its live session (${after - before} notification(s) deleted)`);

  // Window menu > New Window
  await w1.bringToFront();
  await w1.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Window'))?.click());
  await sleep(400);
  await w1.evaluate(() => [...document.querySelectorAll('button, [role="menuitem"]')].find((x) => /New Window/.test(x.textContent))?.click());
  pages = await waitPages(2);
  expect(pages.length === 2, `Window > New Window opens another window (${pages.length})`);

  await browser.close().catch(() => {});
  first.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
