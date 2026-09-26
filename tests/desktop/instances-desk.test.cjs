const h = require('../lib/harness.cjs');
// Desktop app: several instances of one POU, each in its own window following its own PLC instance
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
const APP = h.REPO;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const table = path.join(h.FIXTURES, 'sample0', 'SM_TableManager.TcPOU');
const profile = path.join(h.OUT, 'electron-prof-inst-' + Date.now());
const env = (() => { const e = { ...process.env, VITE_DEV_SERVER_URL: h.APP_ORIGIN }; delete e.ELECTRON_RUN_AS_NODE; return e; })();
const launch = (args, port) => spawn(path.join(APP, 'node_modules/electron/dist/electron.exe'), ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...args], { cwd: APP, env, stdio: 'ignore' });

// Three Table Managers in the PLC, each in another state (2: HOMMING_READY_TO_START, 3: HOMMING, 0: first)
const I = ['MAIN.smTable1', 'MAIN.smTable2', 'MAIN.smTable3'];
const cfg = path.join(h.OUT, 'fake-ams2-inst.json');
fs.writeFileSync(cfg, JSON.stringify({
  symbols: Object.fromEntries(I.map((p, k) => [`${p}.machineState`, { type: 'E_TableManager_States', dataType: 2, size: 2, value: [2, 3, 0][k] }])),
  upload: I.map((name) => ({ name, type: 'SM_TableManager' })),
  script: [],
}));

(async () => {
  const plcLog = path.join(h.OUT, 'fake-ams2-inst.txt');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48956', cfg], { stdio: ['ignore', fs.openSync(plcLog, 'w'), fs.openSync(plcLog, 'a')] });
  const first = launch([table], 9592);
  let browser;
  for (let i = 0; i < 80 && !browser; i++) { await sleep(250); browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9592', defaultViewport: null }).catch(() => null); }
  const appPages = async () => (await browser.pages()).filter((p) => p.url().startsWith(h.APP_ORIGIN));
  const waitPages = async (n) => { for (let i = 0; i < 80; i++) { const ps = await appPages(); if (ps.length >= n) return ps; await sleep(250); } return appPages(); };
  const current = (p) => p.$eval('#live-current-state', (e) => e.textContent).catch(() => '');
  const waitCurrent = async (p, rx) => { let s = ''; for (let i = 0; i < 60 && !rx.test(s); i++) { await sleep(300); s = await current(p); } return s; };
  const waitTitle = async (p, rx) => { let t = ''; for (let i = 0; i < 60 && !rx.test(t); i++) { await sleep(250); t = await p.title(); } return t; };
  const set = (p, id, v) => p.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
const pickSample = async (p, title) => {
    if (await p.$("#sample-selector")) { await p.evaluate((t) => { const sel = document.querySelector("#sample-selector"); const o = [...sel.options].find((x) => x.textContent.trim() === t); sel.value = o.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }, title); return; }
    await p.click("#header-hidden-controls-btn");
    await sleep(400);
    await p.evaluate((t) => [...document.querySelectorAll("#header-hidden-controls-menu *")].find((x) => x.children.length === 0 && x.textContent.trim() === t)?.click(), title);
  };
  // The sample the page shows (Hidden menu or dropdown)
  const shownSample = async (p) => {
    if (await p.$("#sample-selector")) return p.$eval("#sample-selector", (e) => e.options[e.selectedIndex]?.textContent.trim());
    await p.click("#header-hidden-controls-btn");
    await sleep(400);
    const t = await p.evaluate(() => [...document.querySelectorAll("#header-hidden-controls-menu svg.lucide-check")].map((x) => x.closest("button, [role=menuitem], [role=menuitemcheckbox]")?.textContent.trim()).join(","));
    await p.keyboard.press("Escape");
    return t;
  };
  const openLive = async (p) => { await p.bringToFront(); await p.click('#dock-tab-live'); await sleep(400); };
  const openButton = (p, inst) => p.evaluate((inst) => { const b = document.querySelector(`.live-instance-row[data-instance="${inst}"] .live-open-instance`); b?.click(); return !!b; }, inst);

  let pages = await waitPages(1);
  const w1 = pages[0];
  await waitTitle(w1, /SM_TableManager/);
  // Window 1: go live with no instance entered: the first one the PLC has
  await openLive(w1);
  await set(w1, 'live-instance-input', '');
  await set(w1, 'live-netid-input', '127.0.0.1.1.1');
  await set(w1, 'live-ip-input', '127.0.0.1:48956');
  await set(w1, 'live-port-input', '');
  await w1.click('#live-guards-off').catch(() => {});
  await w1.click('#live-start-btn');
  const s1 = await waitCurrent(w1, /TABLEMANAGER_/);
  const rows = await w1.$$eval('.live-instance-row', (r) => r.map((x) => x.getAttribute('data-instance')));
  expect(/HOMMING_READY_TO_START/.test(s1) && rows.length === 3, `window 1 follows ${I[0]} (${s1}); instances listed: ${rows.join(', ')}`);
  expect(/SM_TableManager \(MAIN\.smTable1\)/.test(await waitTitle(w1, /smTable1/)), `window 1 title: ${await w1.title()}`);
  const here = await w1.$eval('.live-instance-row[data-instance="MAIN.smTable1"]', (e) => e.textContent);
  expect(/this window/.test(here), `its own instance is marked: "${here}"`);
  await w1.screenshot({ path: path.join(h.OUT, 'inst-desk-w1.png') });

  // Open smTable2: a second window, live on it at once
  expect(await openButton(w1, 'MAIN.smTable2'), 'Open on MAIN.smTable2');
  pages = await waitPages(2);
  const w2 = pages.find((p) => p !== w1);
  const t2 = w2 ? await waitTitle(w2, /smTable2/) : '';
  const s2 = w2 ? await (async () => { await w2.bringToFront(); await w2.click('#dock-tab-live').catch(() => {}); return waitCurrent(w2, /TABLEMANAGER_/); })() : '';
  expect(pages.length === 2 && /SM_TableManager \(MAIN\.smTable2\)/.test(t2), `a second window for MAIN.smTable2: "${t2}"`);
  expect(/TABLEMANAGER_HOMMING$/.test(s2), `it went live on its own instance: ${s2}`);
  expect(/HOMMING_READY_TO_START/.test(await current(w1)), 'window 1 still follows smTable1');
  const inst2 = w2 ? await w2.$eval('#live-instance-input', (e) => e.value).catch(() => '(running)') : '';
  // The saved settings of the POU keep no instance (window 1 went live without one)
  const stored = await w1.evaluate(() => JSON.parse(localStorage.getItem('kss.live.SM_TableManager.TcPOU') || '{}').instance ?? '');
  expect(stored === '', `window 2's instance is not saved for the POU (saved: "${stored}", window 2: ${inst2})`);

  // Open smTable2 again from window 1: its window comes forward, no third window
  await openLive(w1);
  await openButton(w1, 'MAIN.smTable2');
  await sleep(2500);
  expect((await appPages()).length === 2, `the same instance again: no new window (${(await appPages()).length})`);

  // Open all: only smTable3 is new
  await w1.bringToFront();
  await w1.click('#live-open-all-instances');
  pages = await waitPages(3);
  await sleep(2500);
  pages = await appPages();
  const titles = await Promise.all(pages.map((p) => p.title()));
  expect(pages.length === 3 && titles.some((t) => /smTable3/.test(t)), `Open all adds smTable3 only: ${titles.join(' | ')}`);
  const w3 = pages.find((p) => p !== w1 && p !== w2);
  if (w3) {
    await w3.bringToFront();
    await w3.click('#dock-tab-live').catch(() => {});
    const s3 = await waitCurrent(w3, /TABLEMANAGER_/);
    expect(/TABLEMANAGER_/.test(s3) && !/HOMMING/.test(s3), `window 3 follows smTable3: ${s3}`);
    await w3.screenshot({ path: path.join(h.OUT, 'inst-desk-w3.png') });
  }

  // Explorer opens the POU again (no instance): an existing window comes forward, no new one
  const again = launch([table], 9593);
  await new Promise((r) => { again.on('exit', r); setTimeout(r, 15000); });
  await sleep(1500);
  expect((await appPages()).length === 3, 'Explorer on the same POU: no new window');

  // A sample (no file): Open hands the POU over to the new window
  for (const p of (await appPages()).filter((p) => p !== w1)) await p.close();
  await sleep(1500);
  await w1.bringToFront();
  await w1.click('#live-stop-btn').catch(() => {});
  const sampleId = 'Table Manager (Line 202)';
  await pickSample(w1, sampleId);
  await sleep(1200);
  await openLive(w1);
  await w1.click('#live-start-btn').catch(() => {});
  await waitCurrent(w1, /TABLEMANAGER_/);
  expect(await openButton(w1, 'MAIN.smTable3'), `sample ${sampleId}: Open on MAIN.smTable3`);
  pages = await waitPages(2);
  const w4 = pages.find((p) => p !== w1);
  const t4 = w4 ? await waitTitle(w4, /smTable3/) : '';
  const sel4 = w4 ? await shownSample(w4) : '';
  let s4 = '';
  if (w4) { await w4.bringToFront(); await w4.click('#dock-tab-live').catch(() => {}); s4 = await waitCurrent(w4, /TABLEMANAGER_/); }
  expect(/smTable3/.test(t4) && sel4 === sampleId && /TABLEMANAGER_/.test(s4), `the sample in a new window, live on smTable3: "${t4}", sample ${sel4}, ${s4}`);
  expect(!/handoff/.test(w4 ? w4.url() : 'handoff'), `the handoff is gone from the URL (${w4?.url()})`);

  await browser.close().catch(() => {});
  first.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
