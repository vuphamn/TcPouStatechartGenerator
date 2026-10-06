const h = require('../lib/harness.cjs');
// Desktop app: Save writes the edited .TcPOU and .TcDUT back to their files (their BOM kept); the header counts the
// unsaved files; a file changed on disk since it was opened is overwritten only after the user says so
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sleep = h.sleep;
const APP = h.REPO;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;

(async () => {
  // A copy of the sample to edit
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-save-desk-'));
  const pou = path.join(dir, 'SM_TableManager.TcPOU');
  const dut = path.join(dir, 'E_TableManager_States.TcDUT');
  fs.copyFileSync(path.join(h.FIXTURES, 'sample0', 'SM_TableManager.TcPOU'), pou);
  fs.copyFileSync(path.join(h.FIXTURES, 'sample0', 'E_TableManager_States.TcDUT'), dut);
  const bomOf = (f) => fs.readFileSync(f).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  const pouBom = bomOf(pou);

  const env = (() => { const e = { ...process.env, VITE_DEV_SERVER_URL: h.APP_ORIGIN }; delete e.ELECTRON_RUN_AS_NODE; return e; })();
  const electron = spawn(path.join(APP, 'node_modules/electron/dist/electron.exe'), ['.', '--remote-debugging-port=9574', `--user-data-dir=${h.profileDir('save')}`, pou], { cwd: APP, env, stdio: 'ignore' });
  let browser;
  for (let i = 0; i < 80 && !browser; i++) { await sleep(250); browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9574', defaultViewport: null }).catch(() => null); }
  let p;
  for (let i = 0; i < 60 && !p; i++) { p = (await browser.pages()).find((x) => x.url().startsWith(h.APP_ORIGIN)); if (!p) await sleep(250); }
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  let f = '';
  for (let i = 0; i < 60 && !/SM_TableManager/.test(f); i++) { await sleep(500); f = await p.$eval('#status-file', (e) => e.textContent).catch(() => ''); }
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await p.setViewport({ width: 1600, height: 1000 });
  await sleep(1200);
  const saveBtn = () => p.$eval('#save-sources-btn', (e) => ({ text: e.textContent.trim(), disabled: e.disabled })).catch(() => null);
  let b = await saveBtn();
  expect(!!b && b.disabled && b.text === 'Save', `the header's Save, nothing to save yet: ${JSON.stringify(b)}`);

  // An edit: a state deleted (its branch in doState(), its enum member)
  const del = async (state) => {
    await p.evaluate((s) => [...document.getElementById(`state-list-item-${s}`).querySelectorAll('button')].find((x) => /Go to State/.test(x.textContent))?.click(), state);
    await sleep(1200);
    const pt = await p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, state);
    await p.mouse.click(pt.x, pt.y);
    await sleep(400);
    await p.keyboard.press('Delete');
    await p.waitForSelector('#text-prompt-submit', { timeout: 5000 });
    await p.click('#text-prompt-submit');
    await sleep(1500);
  };
  await del(S('UNCLAMPING'));
  b = await saveBtn();
  expect(!!b && !b.disabled && /Save \(2\)/.test(b.text), `after the edit: ${b?.text}`);
  expect(/2 unsaved/.test(await p.evaluate(() => document.body.innerText)), 'the status bar: 2 unsaved');

  // Ctrl+S (on the canvas): both files written back
  const pt = await p.evaluate(() => { const r = document.getElementById('mermaid-canvas-area').getBoundingClientRect(); return { x: r.x + r.width - 30, y: r.y + r.height - 30 }; });
  await p.mouse.click(pt.x, pt.y);
  await p.keyboard.down('Control');
  await p.keyboard.press('s');
  await p.keyboard.up('Control');
  await sleep(1500);
  const pouText = fs.readFileSync(pou, 'utf8');
  const dutText = fs.readFileSync(dut, 'utf8');
  expect(!/TABLEMANAGER_UNCLAMPING\s*:/.test(pouText) && !/TABLEMANAGER_UNCLAMPING\b/.test(dutText), 'Ctrl+S: the files have the edit');
  expect(bomOf(pou) === pouBom, `the POU's BOM kept (${pouBom})`);
  b = await saveBtn();
  expect(!!b && b.disabled && b.text === 'Save', `saved: ${b?.text}`);

  // Changed on disk meanwhile (TwinCAT saved it): Save asks before overwriting
  fs.writeFileSync(pou, fs.readFileSync(pou, 'utf8').replace('</TcPlcObject>', '<!-- saved in TwinCAT -->\r\n</TcPlcObject>'), 'utf8');
  await del(S('RESET_DONE'));
  await p.click('#save-sources-btn');
  await p.waitForSelector('#text-prompt-dialog', { timeout: 5000 }).catch(() => {});
  const ask = await p.$eval('#text-prompt-dialog', (e) => e.innerText).catch(() => '');
  expect(/SM_TableManager\.TcPOU changed on disk/.test(ask), `changed on disk: asked (${ask.split('\n').slice(0, 2).join(' / ')})`);
  expect(/saved in TwinCAT/.test(fs.readFileSync(pou, 'utf8')), 'not written yet');
  // (the enum had not changed on disk: it is saved)
  expect(!/TABLEMANAGER_RESET_DONE\b/.test(fs.readFileSync(dut, 'utf8')), 'the enum (unchanged on disk) saved');
  await p.click('#text-prompt-submit');
  await sleep(1500);
  const after = fs.readFileSync(pou, 'utf8');
  expect(!/saved in TwinCAT/.test(after) && !/TABLEMANAGER_RESET_DONE\s*:/.test(after), 'Overwrite: our version');
  b = await saveBtn();
  expect(!!b && b.disabled, 'nothing left to save');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close().catch(() => {});
  electron.kill();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
