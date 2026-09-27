const h = require('../lib/harness.cjs');
// Desktop app: the Live tab's Browse lists the TwinCAT devices found on the network (fake-discovery.cjs, asked by its
// address), a click fills in the target; Remember keeps the PLC for every POU (another POU starts with it); Forget
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');
const sleep = h.sleep;
const APP = h.REPO;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const finder = spawn(process.execPath, [path.join(h.FAKES, 'fake-discovery.cjs'), '48998'], { stdio: 'ignore' });
  const env = (() => {
    const e = { ...process.env, VITE_DEV_SERVER_URL: h.APP_ORIGIN, KSS_DISCOVERY_PORT: '48998', KSS_DISCOVERY_BROADCAST: '0' };
    delete e.ELECTRON_RUN_AS_NODE;
    return e;
  })();
  const electron = spawn(path.join(APP, 'node_modules/electron/dist/electron.exe'), ['.', '--remote-debugging-port=9577', `--user-data-dir=${path.join(h.OUT, 'electron-prof-plcs-' + Date.now())}`], { cwd: APP, env, stdio: 'ignore' });
  let browser;
  for (let i = 0; i < 80 && !browser; i++) { await sleep(250); browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9577', defaultViewport: null }).catch(() => null); }
  let p;
  for (let i = 0; i < 60 && !p; i++) { p = (await browser.pages()).find((x) => x.url().startsWith(h.APP_ORIGIN) && !/window\.html/.test(x.url())); if (!p) await sleep(250); }
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
  await p.setViewport({ width: 1600, height: 1000 });
  await sleep(800);
  await p.click('#dock-tab-live');
  await p.waitForSelector('#live-plc-browse', { timeout: 5000 }).catch(() => {});
  expect(!!(await p.$('#live-plc-browse')), 'Browse next to the target');

  // Browse: asked by address (no broadcast in the test), the devices listed
  await p.click('#live-plc-browse');
  await p.waitForSelector('#live-plc-browser');
  // (the search run on opening: nothing without broadcast)
  await p.waitForSelector('#live-plc-none', { timeout: 8000 }).catch(() => {});
  expect(!!(await p.$('#live-plc-none')), 'the first search (on opening) finished: none found without broadcast, with the hint');
  await p.type('#live-plc-addresses', '127.0.0.1');
  await p.click('#live-plc-rescan');
  await p.waitForFunction(() => document.querySelectorAll('.live-plc-found').length >= 2, { timeout: 8000 }).catch(() => {});
  const rows = await p.$$eval('.live-plc-found', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  expect(rows.length === 2 && /CX-<b>202<\/b> 127\.0\.0\.1\.1\.1 127\.0\.0\.1 3\.1\.4026/.test(rows[0]) && /CX-203 127\.0\.0\.2\.1\.1/.test(rows[1]), `found: ${rows.join(' | ')}`);
  // Add Route on a found PLC (the simulated device accepts Administrator / 1)
  await p.click('.live-plc-add-route[data-netid="127.0.0.2.1.1"]');
  await p.waitForSelector('#live-route-password');
  expect((await p.$eval('#live-route-user', (e) => e.value)) === 'Administrator', 'Add Route: the user is Administrator by default');
  await p.type('#live-route-password', '1');
  await p.click('#live-route-add');
  await p.waitForSelector('#live-route-result', { timeout: 8000 }).catch(() => {});
  const routeMsg = await p.$eval('#live-route-result', (e) => e.textContent).catch(() => '');
  expect(/Route added on 127\.0\.0\.1: ".+" to \d+\.\d+\.\d+\.\d+\.1\.[12] at \d+\.\d+\.\d+\.\d+/.test(routeMsg), `Add Route: ${routeMsg}`);
  await p.click('.live-plc-found[data-netid="127.0.0.2.1.1"]');
  await sleep(300);
  const fields = await p.evaluate(() => ({ netId: document.getElementById('live-netid-input').value, ip: document.getElementById('live-ip-input').value, open: !!document.getElementById('live-plc-browser') }));
  expect(fields.netId === '127.0.0.2.1.1' && fields.ip === '127.0.0.1' && !fields.open, `picked: NetId ${fields.netId}, IP ${fields.ip}, list closed`);

  // Remember: kept with its name; listed first in Browse
  expect(await p.$eval('#live-plc-remember', (e) => !e.checked && !e.disabled), 'Remember: not yet');
  await p.click('#live-plc-remember');
  await sleep(300);
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('kss.live.plcs') || '[]'));
  expect(stored.length === 1 && stored[0].name === 'CX-203' && stored[0].netId === '127.0.0.2.1.1' && stored[0].ip === '127.0.0.1', `remembered: ${JSON.stringify(stored.map((x) => `${x.name} ${x.netId} ${x.ip}`))}`);

  // Another POU (a sample without saved settings) starts with the remembered PLC
  await p.select('#sample-selector', 'k-power-supply-ax86x0');
  await sleep(2000);
  await p.click('#dock-tab-live');
  await sleep(400);
  const other = await p.evaluate(() => ({ netId: document.getElementById('live-netid-input').value, ip: document.getElementById('live-ip-input').value, remember: document.getElementById('live-plc-remember').checked }));
  expect(other.netId === '127.0.0.2.1.1' && other.ip === '127.0.0.1' && other.remember, `another POU starts with it: ${JSON.stringify(other)}`);
  await p.click('#live-plc-browse');
  await p.waitForSelector('#live-plc-browser');
  const rememberedRows = await p.$$eval('.live-plc-remembered', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  expect(rememberedRows.length === 1 && /CX-203/.test(rememberedRows[0]), `Browse lists it under Remembered: ${rememberedRows.join(' | ')}`);
  await p.screenshot({ path: h.out('plc-browse-desk.png') });

  // Forget
  await p.click('.live-plc-remembered .live-plc-forget');
  await sleep(300);
  expect((await p.$$('.live-plc-remembered')).length === 0 && !(await p.$eval('#live-plc-remember', (e) => e.checked)) && (await p.evaluate(() => localStorage.getItem('kss.live.plcs'))) === '[]', 'forgotten: gone from the list and the app');
  // Reachability (the PLC switcher) and the app's version (updates), through the main process
  const open = require('net').createServer((c) => c.destroy());
  await new Promise((r) => open.listen(48993, '127.0.0.1', r));
  const reach = await p.evaluate(() => window.tcDesktop.live.probePlcs([{ key: 'up', ip: '127.0.0.1:48993' }, { key: 'down', ip: '127.0.0.1:1' }]));
  open.close();
  expect(reach.up === true && reach.down === false, `reachability: ${JSON.stringify(reach)}`);
  const info = await p.evaluate(() => window.tcDesktop.appInfo());
  const pkgVersion = JSON.parse(require('fs').readFileSync(require('path').join(APP, 'package.json'), 'utf8')).version;
  expect(info?.version === pkgVersion, `app version: ${info?.version} (package.json ${pkgVersion})`);
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close().catch(() => {});
  electron.kill();
  finder.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
