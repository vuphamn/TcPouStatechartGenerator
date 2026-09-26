const h = require('../lib/harness.cjs');
// Desktop app: a .TcPOU on the command line opens at start-up; a second start hands its file to the running app,
// which opens it in a window of its own (one per POU); a start without a file opens nothing new
// Usage: node open-file-test.cjs [path to Kval StateScope.exe]   (default: electron . against the dev server)
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
const APP = h.REPO;
const exe = process.argv[2];
const door = path.join(h.FIXTURES, 'sample1', 'SM_DoorDasher.TcPOU');
const table = path.join(h.FIXTURES, 'sample0', 'SM_TableManager.TcPOU');
const profile = path.join(h.OUT, 'electron-prof-open-' + Date.now());
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const env = (() => { const e = { ...process.env }; delete e.ELECTRON_RUN_AS_NODE; if (!exe) e.VITE_DEV_SERVER_URL = h.APP_ORIGIN; return e; })();
const launch = (file, port) => exe
  ? spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, file], { env, stdio: 'ignore' })
  : spawn(path.join(APP, 'node_modules/electron/dist/electron.exe'), ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, file], { cwd: APP, env, stdio: 'ignore' });

(async () => {
  const first = launch(door, 9570);
  let browser;
  for (let i = 0; i < 80 && !browser; i++) { await sleep(250); browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9570', defaultViewport: null }).catch(() => null); }
  let page;
  for (let i = 0; i < 60 && !page; i++) { page = (await browser.pages()).find((p) => (p.url().startsWith(h.APP_ORIGIN) || /index\.html/.test(p.url()))); if (!page) await sleep(250); }
  const file = () => page.$eval('#status-file', (e) => e.textContent).catch(() => '');
  let f = '';
  for (let i = 0; i < 60 && !/SM_DoorDasher/.test(f); i++) { await sleep(500); f = await file(); }
  expect(/SM_DoorDasher/.test(f), `opened at start-up: ${f.trim()}`);
  await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 }).catch(() => {});
  const dut = await page.evaluate(() => document.body.innerText.match(/E_DoorDasher\w*/)?.[0]);
  expect(!!dut, `its .TcDUT found next to it: ${dut}`);

  // Second start with another file: it hands the file over and exits
  const t0 = Date.now();
  const second = launch(table, 9571);
  const exited = await new Promise((r) => { second.on('exit', (code) => r({ code, ms: Date.now() - t0 })); setTimeout(() => r(null), 20000); });
  expect(exited && exited.ms < 15000, `the second start exits (${exited ? `${exited.ms} ms, code ${exited.code}` : 'still running'})`);
  // One window per POU: the second file opens in a window of its own
  const appPages = async () => (await browser.pages()).filter((p) => p.url().startsWith(h.APP_ORIGIN) || /index\.html/.test(p.url()));
  let page2 = null;
  for (let i = 0; i < 60 && !page2; i++) { await sleep(500); page2 = (await appPages()).find((p) => p !== page) ?? null; }
  let f2 = '';
  for (let i = 0; i < 60 && page2 && !/SM_TableManager/.test(f2); i++) { await sleep(500); f2 = await page2.$eval('#status-file', (e) => e.textContent).catch(() => ''); }
  expect(/SM_TableManager/.test(f2), `the second file opens in a window of its own: ${f2.trim()}`);
  expect(/SM_DoorDasher/.test(await file()), 'the first window keeps its POU');

  // A start without a file just focuses the window
  const third = launch('', 9572);
  const exited3 = await new Promise((r) => { third.on('exit', (code) => r(code)); setTimeout(() => r(null), 20000); });
  await sleep(1500);
  const windows = (await appPages()).length;
  expect(exited3 !== null && windows === 2 && /SM_DoorDasher/.test(await file()), `a start without a file opens nothing new (${windows} windows)`);

  await browser.close().catch(() => {});
  first.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
