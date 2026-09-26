const h = require('../lib/harness.cjs');
// Desktop app: Live > Symbols - the PLC's symbols from MAIN.mainStateMachine with values; Watch opens a state machine
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
const APP = h.REPO;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// A small PLC project folder (so Watch finds SM_DoorDasher.TcPOU in it)
const proj = path.join(h.OUT, 'sym-proj');
fs.mkdirSync(path.join(proj, 'POUs'), { recursive: true });
fs.writeFileSync(path.join(proj, 'Mini.plcproj'), '<Project/>');
for (const [from, f] of [['sample0', 'SM_TableManager.TcPOU'], ['sample0', 'E_TableManager_States.TcDUT'], ['sample1', 'SM_DoorDasher.TcPOU'], ['sample1', 'E_DoorDasher_States.TcDUT']]) {
  fs.copyFileSync(path.join(h.FIXTURES, from, f), path.join(proj, 'POUs', f));
}
const table = path.join(proj, 'POUs', 'SM_TableManager.TcPOU');

const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
const cfg = writeSymbolsPlc();

(async () => {
  const plcLog = path.join(h.OUT, 'fake-ams2-sym.txt');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48958', cfg], { stdio: ['ignore', fs.openSync(plcLog, 'w'), fs.openSync(plcLog, 'a')] });
  const env = (() => { const e = { ...process.env, VITE_DEV_SERVER_URL: h.APP_ORIGIN }; delete e.ELECTRON_RUN_AS_NODE; return e; })();
  const profile = path.join(h.OUT, 'electron-prof-sym-' + Date.now());
  const app = spawn(path.join(APP, 'node_modules/electron/dist/electron.exe'), ['.', '--remote-debugging-port=9594', `--user-data-dir=${profile}`, table], { cwd: APP, env, stdio: 'ignore' });
  let browser;
  for (let i = 0; i < 80 && !browser; i++) { await sleep(250); browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9594', defaultViewport: null }).catch(() => null); }
  const appPages = async () => (await browser.pages()).filter((p) => p.url().startsWith(h.APP_ORIGIN));
  const waitPages = async (n) => { for (let i = 0; i < 80; i++) { const ps = await appPages(); if (ps.length >= n) return ps; await sleep(250); } return appPages(); };
  const set = (p, id, v) => p.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  const row = (p, pth) => p.evaluate((pth) => {
    const r = document.querySelector(`.symbol-row[data-path="${pth}"]`);
    return r ? { kind: r.getAttribute('data-kind'), text: r.textContent, value: r.querySelector('.symbol-value')?.textContent ?? null, watch: !!r.querySelector('.symbol-watch') } : null;
  }, pth);
  const waitRow = async (p, pth, test = () => true) => { let r = null; for (let i = 0; i < 50 && !(r && test(r)); i++) { await sleep(200); r = await row(p, pth); } return r; };

  let pages = await waitPages(1);
  const w1 = pages[0];
  for (let i = 0; i < 60 && !/SM_TableManager/.test(await w1.title()); i++) await sleep(250);
  await w1.click('#dock-tab-live');
  await sleep(400);
  expect(!(await w1.$('#live-symbols-btn')), 'no Symbols button before going live');
  await set(w1, 'live-instance-input', `${R}.smTable1`);
  await set(w1, 'live-netid-input', '127.0.0.1.1.1');
  await set(w1, 'live-ip-input', '127.0.0.1:48958');
  await set(w1, 'live-port-input', '');
  await w1.click('#live-guards-off').catch(() => {});
  await w1.click('#live-start-btn');
  await w1.waitForSelector('#live-symbols-btn', { timeout: 20000 }).catch(() => {});
  expect(!!(await w1.$('#live-symbols-btn')), 'Symbols button once connected');
  await w1.click('#live-symbols-btn');
  await w1.waitForSelector('#symbol-browser-window', { timeout: 5000 }).catch(() => {});
  const rootField = await w1.$eval('#symbol-browser-root', (e) => e.value).catch(() => '');
  expect(rootField === R, `the window opens on ${rootField}`);

  // Members with values
  const count = await waitRow(w1, `${R}.nCount`, (r) => r.value === '42');
  const en = await row(w1, `${R}.bEnable`);
  const sp = await row(w1, `${R}.fSpeed`);
  const nm = await row(w1, `${R}.sName`);
  expect(count?.value === '42' && en?.value === 'TRUE' && sp?.value === '1.5' && nm?.value === "'hello'", `values: nCount=${count?.value} bEnable=${en?.value} fSpeed=${sp?.value} sName=${nm?.value}`);
  const ptr = await row(w1, `${R}.pTarget`);
  expect(ptr?.kind === 'other' && ptr.value === null, `a pointer is listed without a value (${ptr?.kind})`);
  // State machines: the followed one is "this window", the others have Watch (machineState from the base FB)
  const t1 = await row(w1, `${R}.smTable1`);
  const t2 = await row(w1, `${R}.smTable2`);
  expect(/this window/.test(t1?.text ?? '') && t2?.watch, `smTable1 is this window, smTable2 has Watch (inherited ${'machineState'})`);
  const st = await row(w1, `${R}.stSettings`);
  expect(st?.kind === 'struct' && !st.watch, 'a structure without machineState: no Watch');
  // Open a structure and an array
  await w1.evaluate((p) => document.querySelector(`.symbol-row[data-path="${p}"] .symbol-toggle`).click(), `${R}.stSettings`);
  const rt = await waitRow(w1, `${R}.stSettings.rTimeout`, (r) => r.value === '2.5');
  expect(rt?.value === '2.5', `open a structure: rTimeout = ${rt?.value}`);
  await w1.evaluate((p) => document.querySelector(`.symbol-row[data-path="${p}"] .symbol-toggle`).click(), `${R}.aDoors`);
  const d1 = await waitRow(w1, `${R}.aDoors[1]`);
  const d2 = await row(w1, `${R}.aDoors[2]`);
  expect(d1?.watch && !!d2, `open an array: [1], [2] (SM_DoorDasher, with Watch)`);
  // Values follow the PLC
  const later = await waitRow(w1, `${R}.nCount`, (r) => r.value === '43');
  expect(later?.value === '43' && (await row(w1, `${R}.bEnable`))?.value === 'FALSE', `values change live: nCount=${later?.value}`);
  // Filter
  await set(w1, 'symbol-browser-filter', 'timeout');
  await sleep(300);
  const shown = await w1.$$eval('.symbol-row', (r) => r.map((x) => x.getAttribute('data-path')));
  expect(shown.includes(`${R}.stSettings.rTimeout`) && shown.includes(`${R}.stSettings`) && !shown.includes(`${R}.nCount`), `filter "timeout": ${shown.join(', ')}`);
  await set(w1, 'symbol-browser-filter', '');
  await w1.screenshot({ path: path.join(h.OUT, 'symbols-desk.png') });

  // Watch smTable2 (same POU): a new window live on it
  await w1.evaluate((p) => document.querySelector(`.symbol-row[data-path="${p}"] .symbol-watch`).click(), `${R}.smTable2`);
  pages = await waitPages(2);
  const w2 = pages.find((p) => p !== w1);
  let t2title = '';
  for (let i = 0; i < 60 && w2 && !/smTable2/.test(t2title); i++) { await sleep(250); t2title = await w2.title(); }
  expect(/SM_TableManager \(MAIN\.mainStateMachine\.smTable2\)/.test(t2title), `Watch smTable2: a window "${t2title}"`);
  // Watch aDoors[1] (another POU, found in the project): its diagram, live on it
  await w1.bringToFront();
  await w1.evaluate((p) => document.querySelector(`.symbol-row[data-path="${p}"] .symbol-watch`).click(), `${R}.aDoors[1]`);
  pages = await waitPages(3);
  const w3 = pages.find((p) => p !== w1 && p !== w2);
  let t3 = '';
  for (let i = 0; i < 60 && w3 && !/aDoors/.test(t3); i++) { await sleep(250); t3 = await w3.title(); }
  let s3 = '';
  if (w3) {
    await w3.bringToFront();
    await w3.click('#dock-tab-live').catch(() => {});
    for (let i = 0; i < 60 && !s3; i++) { await sleep(300); s3 = await w3.$eval('#live-current-state', (e) => e.textContent).catch(() => ''); }
    s3 += ` [${await w3.$eval('#live-status', (e) => e.textContent).catch(() => '')}]`;
  }
  expect(/SM_DoorDasher \(MAIN\.mainStateMachine\.aDoors\[1\]\)/.test(t3) && s3.includes('aDoors[1].machineState on') && !s3.startsWith(' ['), `Watch aDoors[1]: "${t3}", live ${s3}`);

  // Closing the window stops following its values
  await w1.bringToFront();
  await w1.click('#symbol-browser-close');
  await sleep(1500);
  const released = fs.readFileSync(plcLog, 'utf8');
  expect(/release handle MAIN\.mainStateMachine\.nCount/.test(released), 'closing the window released its values');

  await browser.close().catch(() => {});
  app.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
