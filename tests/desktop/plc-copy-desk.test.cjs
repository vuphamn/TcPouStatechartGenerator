const h = require('../lib/harness.cjs');
// Desktop app: going live on a PLC that runs another project (the fake PLC's "Plant") than the loaded POU's ("Mini"):
// the PLC's whole project downloaded into Documents\Kval StateScope\PLC projects\Plant; its SM_TableManager instance
// (the same name as the loaded POU, another type: Plant's own) opened with Plant's SM_TableManager from that copy.
// Going live again with the copy there but the PLC's differing: asked, Keep local (left as it is), Override (the
// PLC's written over it), Save to a different location (another folder, remembered for the PLC)
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APP = h.REPO;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// The loaded POU's project: Mini (the sample's SM_TableManager)
const proj = path.join(h.OUT, 'copy-proj');
fs.rmSync(proj, { recursive: true, force: true });
fs.mkdirSync(path.join(proj, 'POUs'), { recursive: true });
fs.writeFileSync(path.join(proj, 'Mini.plcproj'), '<Project/>');
for (const f of ['SM_TableManager.TcPOU', 'E_TableManager_States.TcDUT']) fs.copyFileSync(path.join(h.FIXTURES, 'sample0', f), path.join(proj, 'POUs', f));
const table = path.join(proj, 'POUs', 'SM_TableManager.TcPOU');
// Documents (KSS_DOCUMENTS) and a folder for Save to a different location (KSS_PICK_FOLDER)
const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-copy-docs-'));
const elsewhere = path.join(docs, 'Elsewhere');
const copy = path.join(docs, 'Kval StateScope', 'PLC projects', 'Plant');
const copiedPou = path.join(copy, 'Plant', 'POUs', 'Table', 'SM_TableManager.TcPOU');

const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
const cfg = writeSymbolsPlc('fake-ams2-copy.json', [], { sources: true });

(async () => {
  const plcLog = path.join(h.OUT, 'fake-ams2-copy.txt');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48985', cfg], { stdio: ['ignore', fs.openSync(plcLog, 'w'), fs.openSync(plcLog, 'a')] });
  const env = (() => { const e = { ...process.env, VITE_DEV_SERVER_URL: h.APP_ORIGIN, KSS_DOCUMENTS: docs, KSS_PICK_FOLDER: elsewhere }; delete e.ELECTRON_RUN_AS_NODE; return e; })();
  const profile = path.join(h.OUT, 'electron-prof-copy-' + Date.now());
  const app = spawn(path.join(APP, 'node_modules/electron/dist/electron.exe'), ['.', '--remote-debugging-port=9598', `--user-data-dir=${profile}`, table], { cwd: APP, env, stdio: 'ignore' });
  let browser;
  for (let i = 0; i < 80 && !browser; i++) { await sleep(250); browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9598', defaultViewport: null }).catch(() => null); }
  const appPages = async () => (await browser.pages()).filter((p) => p.url().startsWith(h.APP_ORIGIN));
  const waitPages = async (n) => { for (let i = 0; i < 80; i++) { const ps = await appPages(); if (ps.length >= n) return ps; await sleep(250); } return appPages(); };
  const set = (p, id, v) => p.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  const status = (p) => p.$eval('#status-message', (e) => e.textContent).catch(() => '');
  const waitStatus = async (p, rx, ms = 20000) => { let s = ''; for (let i = 0; i < ms / 250 && !rx.test(s); i++) { await sleep(250); s = await status(p); } return s; };
  const waitFor = async (test, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { if (test()) return true; await sleep(250); } return test(); };

  let pages = await waitPages(1);
  const w1 = pages[0];
  for (let i = 0; i < 60 && !/SM_TableManager/.test(await w1.title()); i++) await sleep(250);
  await w1.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  const goLive = async () => {
    await w1.bringToFront();
    await w1.click('#dock-tab-live');
    await sleep(400);
    await set(w1, 'live-instance-input', `${R}.smTable1`);
    await set(w1, 'live-netid-input', '127.0.0.1.1.1');
    await set(w1, 'live-ip-input', '127.0.0.1:48985');
    await set(w1, 'live-port-input', '');
    await w1.click('#live-guards-off').catch(() => {});
    await w1.click('#live-start-btn');
    await w1.waitForSelector('#live-symbols-btn', { timeout: 20000 }).catch(() => {});
  };
  const stopLive = async () => {
    await w1.bringToFront();
    await w1.click('#dock-tab-live').catch(() => {});
    await w1.click('#live-stop-btn').catch(() => {});
    await sleep(1500);
  };

  // 1. Live on the PLC (Plant): its project downloaded
  await goLive();
  const said = await waitStatus(w1, /Plant: the PLC's project downloaded/);
  expect(/Plant: the PLC's project downloaded/.test(said), `going live: "${said}"`);
  expect(await waitFor(() => fs.existsSync(copiedPou)) && fs.existsSync(path.join(copy, 'Plant.tsproj')) && fs.existsSync(path.join(copy, '.kss-plc-project.json')), 'the whole project in Documents\\Kval StateScope\\PLC projects\\Plant (its .tsproj, its PLC project, the manifest)');
  expect(/TABLE_PLC_IDLE/.test(fs.readFileSync(copiedPou, 'utf8')), 'with Plant\'s own SM_TableManager (TABLE_PLC_IDLE)');
  // (edited in the copy: its instances' POU is read from there, not from the PLC)
  fs.writeFileSync(copiedPou, fs.readFileSync(copiedPou, 'utf8').replace('machineState := E_TableManager_States.TABLE_PLC_READY;', 'machineState := E_TableManager_States.TABLE_PLC_READY_HERE;'));

  // 2. Symbols: smTable2 is Plant's SM_TableManager, not this window's (Mini's): Open, from the copy
  await w1.click('#live-symbols-btn');
  await w1.waitForSelector('#symbol-browser-window', { timeout: 10000 }).catch(() => {});
  await w1.click('#symbol-browser-type-clear').catch(() => {});
  let t1 = null;
  for (let i = 0; i < 50 && !t1; i++) { await sleep(200); t1 = await w1.evaluate((p) => { const r = document.querySelector(`.symbol-row[data-path="${p}"]`); return r ? { text: r.textContent, other: !!r.querySelector('.symbol-open-other') } : null; }, `${R}.smTable2`); }
  expect(!!t1 && t1.other && !/this window/.test(t1.text), `smTable2: another type here (Plant's), Open offered (${t1 ? t1.text.slice(0, 80) : 'no row'})`);
  await w1.evaluate((p) => document.querySelector(`.symbol-row[data-path="${p}"] .symbol-open-other`)?.click(), `${R}.smTable2`);
  pages = await waitPages(2);
  const w2 = pages.find((p) => p !== w1);
  let title = '';
  for (let i = 0; i < 60 && w2 && !/smTable2/.test(title); i++) { await sleep(250); title = await w2.title(); }
  let states = '';
  if (w2) {
    await w2.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 }).catch(() => {});
    states = await w2.evaluate(() => [...document.querySelectorAll('#mermaid-canvas-area g.node[data-state-id]')].map((n) => n.getAttribute('data-state-id')).join(','));
  }
  const file = w2 ? await w2.$eval('#status-file', (e) => e.getAttribute('title') || e.textContent).catch(() => '') : '';
  expect(/SM_TableManager \(MAIN\.mainStateMachine\.smTable2\)/.test(title) && /TABLE_PLC_IDLE/.test(states) && !/TABLEMANAGER_/.test(states), `a window with Plant's SM_TableManager, live on smTable2: "${title}" [${states}]`);
  expect(/TABLE_PLC_READY_HERE/.test(states), `opened from the copy (its edit there: ${file})`);
  if (w2) await w2.close().catch(() => {});
  await stopLive();

  // 3. The PLC's project changed since (its fingerprint), and an edit here: asked; Keep local
  const manifestFile = path.join(copy, '.kss-plc-project.json');
  const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  fs.writeFileSync(manifestFile, JSON.stringify({ ...m, hash: 'older' }));
  fs.writeFileSync(copiedPou, fs.readFileSync(copiedPou, 'utf8').replace('TABLE_PLC_IDLE:', 'TABLE_PLC_IDLE: (* edited here *)'));
  await goLive();
  const ask = await w1.waitForSelector('#text-prompt-cancel', { timeout: 20000 }).catch(() => null);
  const text = ask ? await w1.evaluate(() => document.querySelector('#text-prompt-submit')?.closest('[role="dialog"], .fixed')?.textContent ?? document.body.innerText) : '';
  expect(!!ask && /differs from your local copy/.test(text) && /Plant\/POUs\/Table\/SM_TableManager\.TcPOU/.test(text), `going live again: asked, the edit listed (${text.slice(0, 160)})`);
  const cancelLabel = ask ? await w1.$eval('#text-prompt-cancel', (e) => e.textContent.trim()) : '';
  const buttons = ask ? await w1.evaluate(() => [...document.querySelectorAll('#text-prompt-submit, #plc-copy-elsewhere-btn')].map((b) => b.textContent.trim()).join(' | ')) : '';
  expect(cancelLabel === 'Keep local' && /Override/.test(buttons) && /Save to a different location/.test(buttons), `its choices: ${buttons} | ${cancelLabel}`);
  // Show the differences: the PLC's version and the local one, the question still open under it
  if (ask && (await w1.$('#plc-copy-show-diff-btn'))) {
    await w1.click('#plc-copy-show-diff-btn');
    await w1.waitForSelector('#diff-dialog', { timeout: 5000 }).catch(() => {});
    const parts = await w1.$$eval('#diff-dialog [data-diff-part]', (d) => d.map((x) => x.getAttribute('data-diff-part')));
    expect(parts.some((x) => /SM_TableManager\.TcPOU/.test(x)), `Show the differences: ${parts.join(', ')}`);
    await w1.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 400));
    expect(!(await w1.$('#diff-dialog')) && !!(await w1.$('#text-prompt-cancel')), 'Esc: the differences closed, the question still there');
  } else expect(false, 'Show the differences offered');
  if (ask) await w1.click('#text-prompt-cancel');
  const kept = await waitStatus(w1, /local copy kept/);
  expect(/local copy kept/.test(kept) && /edited here/.test(fs.readFileSync(copiedPou, 'utf8')), `Keep local: "${kept}", the edit still there`);
  await stopLive();

  // 4. Again: Override
  await goLive();
  if (await w1.waitForSelector('#text-prompt-submit', { timeout: 20000 }).catch(() => null)) await w1.click('#text-prompt-submit');
  const over = await waitStatus(w1, /written over the local copy/);
  expect(/written over the local copy/.test(over) && !/edited here/.test(fs.readFileSync(copiedPou, 'utf8')), `Override: "${over}", the PLC's file back`);
  await stopLive();

  // 5. Changed again: Save to a different location (the folder picked; remembered for the PLC)
  fs.writeFileSync(manifestFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifestFile, 'utf8')), hash: 'older' }));
  await goLive();
  if (await w1.waitForSelector('#plc-copy-elsewhere-btn', { timeout: 20000 }).catch(() => null)) await w1.click('#plc-copy-elsewhere-btn');
  const there = await waitStatus(w1, /the PLC's project downloaded/);
  expect(/downloaded/.test(there) && await waitFor(() => fs.existsSync(path.join(elsewhere, 'Plant', 'POUs', 'Table', 'SM_TableManager.TcPOU')) || fs.existsSync(path.join(elsewhere, 'Plant', 'Plant', 'POUs', 'Table', 'SM_TableManager.TcPOU'))), `Save to a different location: "${there}" (${elsewhere})`);
  const remembered = await w1.evaluate(() => localStorage.getItem('kss.plcCopy.folder.127.0.0.1.1.1'));
  expect(remembered === elsewhere, `remembered for this PLC (${remembered})`);
  await stopLive();

  await browser.close().catch(() => {});
  app.kill();
  plc.kill();
  fs.rmSync(docs, { recursive: true, force: true });
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
