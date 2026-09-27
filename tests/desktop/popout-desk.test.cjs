const h = require('../lib/harness.cjs');
// Desktop app: Move to New Window opens the app's window.html as a window of the app (not in the web browser), the tab
// in it; closing it brings the tab back
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');
const sleep = h.sleep;
const APP = h.REPO;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const env = (() => { const e = { ...process.env, VITE_DEV_SERVER_URL: h.APP_ORIGIN }; delete e.ELECTRON_RUN_AS_NODE; return e; })();
  const electron = spawn(path.join(APP, 'node_modules/electron/dist/electron.exe'), ['.', '--remote-debugging-port=9576', `--user-data-dir=${path.join(h.OUT, 'electron-prof-popout-' + Date.now())}`], { cwd: APP, env, stdio: 'ignore' });
  let browser;
  for (let i = 0; i < 80 && !browser; i++) { await sleep(250); browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9576', defaultViewport: null }).catch(() => null); }
  let p;
  for (let i = 0; i < 60 && !p; i++) { p = (await browser.pages()).find((x) => x.url().startsWith(h.APP_ORIGIN) && !/window\.html/.test(x.url())); if (!p) await sleep(250); }
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await p.setViewport({ width: 1600, height: 1000 });
  await sleep(800);
  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-implementation-editor');
  const tab = await (await p.$('#dock-tab-method')).boundingBox();
  await p.mouse.click(tab.x + tab.width / 2, tab.y + tab.height / 2, { button: 'right' });
  await sleep(300);
  await p.click('#dock-menu-new-window');
  let w = null;
  for (let i = 0; i < 40 && !w; i++) {
    await sleep(250);
    for (const pg of await browser.pages()) if (/window\.html\?Method-Editor/.test(pg.url()) && (await pg.evaluate(() => !!document.getElementById('method-implementation-editor')).catch(() => false))) w = pg;
  }
  expect(!!w, `a window of the app: ${w ? w.url().replace(h.APP_ORIGIN, '') : 'none'}`);
  expect(!(await p.$('#method-implementation-editor')), 'the tab left the main window');
  if (w) {
    await w.close();
    await sleep(1500);
    expect(!!(await p.$('#dock-float-method #method-implementation-editor')), 'closed: back in the app, floating');
  }
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close().catch(() => {});
  electron.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
