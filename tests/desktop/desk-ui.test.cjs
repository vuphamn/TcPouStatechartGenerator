const h = require('../lib/harness.cjs');
// Desktop app (Electron, dev server) Live tab against fake-ams.cjs: desktop fields, route hint, go live, trail, stop
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
const APP = h.REPO;
const seq = JSON.parse(fs.readFileSync(path.join(h.FAKES, 'seq.json'), 'utf8'));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const plcOut = fs.openSync(path.join(h.OUT, 'fake-ams-ui.txt'), 'w');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams.cjs'), '48951', 'MAIN.mainStateMachine.smTableManager.machineState', seq.seq, '10.9.9.9.1.1'], { stdio: ['ignore', plcOut, plcOut] });
  const electron = spawn(path.join(APP, 'node_modules/electron/dist/electron.exe'), ['.', '--remote-debugging-port=9559', `--user-data-dir=${path.join(h.OUT, 'electron-prof-' + Date.now())}`], {
    cwd: APP, env: (() => { const e = { ...process.env, VITE_DEV_SERVER_URL: h.APP_ORIGIN }; delete e.ELECTRON_RUN_AS_NODE; return e; })(), stdio: 'ignore',
  });
  let browser;
  for (let i = 0; i < 80 && !browser; i++) { await sleep(250); browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9559', defaultViewport: null }).catch(() => null); }
  let page;
  for (let i = 0; i < 40 && !page; i++) { page = (await browser.pages()).find((p) => p.url().startsWith(h.APP_ORIGIN)); if (!page) await sleep(250); }
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 30000 });
  expect(await page.evaluate(() => !!window.tcDesktop?.live), 'desktop live API in the renderer');
  await page.click('#dock-tab-live');
  await sleep(500);
  expect(!!(await page.$('#live-ip-input')) && !!(await page.$('#live-local-netid-input')) && !!(await page.$('#live-route-hint')), 'desktop fields and route hint shown');
  const hidden = async () => !(await page.$('#live-ip-input'));
  const set = (id, v) => page.evaluate((id, v) => {
    const el = document.getElementById(id);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, id, v);
  await set('live-instance-input', 'MAIN.mainStateMachine.smTableManager');
  await set('live-netid-input', '127.0.0.1.1.1');
  await set('live-ip-input', '127.0.0.1:48951');
  await set('live-port-input', '');

  // Without the route first: the hint names this PC's NetId and address
  await set('live-local-netid-input', '10.9.9.7.1.1');
  await page.click('#live-start-btn');
  let status = '';
  for (let i = 0; i < 40 && !/route/i.test(status); i++) { await sleep(250); status = await page.$eval('#live-status', (e) => e.textContent); }
  const hint = await page.$eval('#live-route-hint', (e) => e.textContent);
  expect(/route/i.test(status) && hint.includes('10.9.9.7.1.1'), `no route: "${status}" | hint: "${hint}"`);

  await set('live-local-netid-input', '10.9.9.9.1.1');
  await page.click('#live-start-btn');
  for (let i = 0; i < 40 && !/smTableManager/.test(status); i++) { await sleep(250); status = await page.$eval('#live-status', (e) => e.textContent); }
  expect(/MAIN\.mainStateMachine\.smTableManager\.machineState on 127\.0\.0\.1/.test(status), `connected: "${status}"`);
  await sleep(seq.states.length * 700 + 2000);
  const states = await page.$$eval('.live-trail-row button', (b) => b.map((x) => x.textContent));
  const got = [];
  for (let i = states.length - 2; i >= 0; i -= 2) got.push(`${states[i]}→${states[i + 1]}`);
  const expected = seq.states.slice(1).map((to, i) => `${seq.states[i]}→${to}`);
  expect(JSON.stringify(got) === JSON.stringify(expected), `${got.length} transitions in order, incl. the 5 ms state`);
  const flags = (await page.$$eval('.live-trail-row', (r) => r.map((x) => !x.className.includes('rose')))).reverse();
  expect(JSON.stringify(flags) === JSON.stringify(seq.legal), '"not in diagram" flags');
  expect(await hidden(), 'settings hidden while connected');
  const rows = await page.$$eval('.live-trail-row', (r) => r.filter((x) => x.getBoundingClientRect().height > 0 && x.getBoundingClientRect().top < innerHeight).length);
  expect(rows >= 3, `trail rows visible (${rows})`);
  await page.screenshot({ path: path.join(h.OUT, 'desk-live-panel.png') });
  await page.click('#dock-tab-diagram');
  await sleep(1200);
  const active = await page.evaluate(() => [...document.querySelectorAll('g.node.live-active-node')].map((n) => n.getAttribute('data-state-id')).join());
  expect(active === 'TABLEMANAGER_ERROR', `diagram highlights ${active}`);
  await page.click('#dock-tab-live');
  await sleep(300);
  await page.click('#live-stop-btn');
  await sleep(1000);
  const log = fs.readFileSync(path.join(h.OUT, 'fake-ams-ui.txt'), 'utf8');
  expect(/delete notification/.test(log) && /release handle/.test(log), 'Stop deletes the notification and releases the handle');
  console.log('page errors:', errors);
  browser.disconnect();
  electron.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
