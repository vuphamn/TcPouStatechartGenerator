// Machine Overview with several PLCs (web edition through Link): two simulated PLCs added under Other PLCs, each
// with its own connection and its machines' states, without the POU's own live session; kept after a reload;
// removed again. Also: Link's network search and Add Route from the Live tab's Browse (simulated device search)
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
const sleep = h.sleep;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-multi.json');
  const plcA = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48967', cfg], { stdio: 'ignore' });
  const plcB = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48968', cfg], { stdio: 'ignore' });
  const finder = spawn(process.execPath, [path.join(h.FAKES, 'fake-discovery.cjs'), '48995'], { stdio: 'ignore' });
  const linkOut = h.out('link-multi-run.txt');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48969', '--no-open'], {
    env: { ...process.env, APPDATA: h.out('link-appdata-multi'), KSS_DISCOVERY_PORT: '48995', KSS_DISCOVERY_BROADCAST: '0', KSS_LOCAL_TWINCAT_NETID: 'none' },
    stdio: ['ignore', fs.openSync(linkOut, 'w'), fs.openSync(linkOut, 'a')],
  });
  const code = (await h.waitForText(linkOut, /Pairing code:\s+(\S+)/))?.[1];
  if (!code) throw new Error('Link did not start (no pairing code)');

  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1100 } });
  const errors = [];
  const set = (p, id, v) => p.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  const a = await browser.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  await a.goto(h.APP_URL, { waitUntil: 'load' });
  await a.evaluate(() => localStorage.clear());
  await a.evaluate(() => localStorage.setItem('kss.live.plcs', JSON.stringify([
    { name: 'Line A', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48967', port: '', localNetId: '', used: 2 },
    { name: 'Line B', netId: '127.0.0.2.1.1', ip: '127.0.0.1:48968', port: '', localNetId: '', used: 1 },
  ])));
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 60000 });
  await a.click('#dock-tab-live');
  await sleep(300);
  await set(a, 'live-token-input', code);
  await a.click('#live-token-remember');
  await set(a, 'live-link-port-input', '48969');

  // Browse through Link: the device search runs in Link; Add Route there too
  await a.click('#live-plc-browse');
  await a.waitForSelector('#live-plc-browser');
  await a.waitForSelector('#live-plc-none', { timeout: 8000 }).catch(() => {});
  await a.type('#live-plc-addresses', '127.0.0.1');
  await a.click('#live-plc-rescan');
  await a.waitForFunction(() => document.querySelectorAll('.live-plc-found').length >= 2, { timeout: 8000 }).catch(() => {});
  expect((await a.$$('.live-plc-found')).length === 2, 'Browse through Link: the devices found by Link');
  await a.click('.live-plc-add-route[data-netid="127.0.0.2.1.1"]');
  await a.waitForSelector('#live-route-password');
  await a.type('#live-route-password', 'wrong');
  await a.click('#live-route-add');
  await a.waitForSelector('#live-route-result', { timeout: 8000 }).catch(() => {});
  const refused = await a.$eval('#live-route-result', (e) => e.textContent).catch(() => '');
  await a.click('#live-route-password', { clickCount: 3 });
  await a.type('#live-route-password', '1');
  await a.click('#live-route-add');
  await a.waitForFunction(() => /Route added/.test(document.getElementById('live-route-result')?.textContent || ''), { timeout: 8000 }).catch(() => {});
  const added = await a.$eval('#live-route-result', (e) => e.textContent).catch(() => '');
  expect(/refused the user name or password/.test(refused) && /Route added on 127\.0\.0\.1/.test(added) && (await a.$eval('#live-route-password', (e) => e.value)) === '', `Add Route: "${refused}" then "${added}", the password cleared`);
  expect(/route: .* asked 127\.0\.0\.1 for a route/.test(fs.readFileSync(linkOut, 'utf8')) && !/wrong/.test(fs.readFileSync(linkOut, 'utf8')), 'Link logs it (without the password)');
  await a.click('#live-plc-browser-close');

  // The PLC switcher: two remembered PLCs, a click takes the other
  expect(!!(await a.$('#live-plc-quick')), 'the PLC switcher, with two remembered PLCs');
  await a.select('#live-plc-quick', '127.0.0.2.1.1');
  await sleep(200);
  expect((await a.$eval('#live-netid-input', (e) => e.value)) === '127.0.0.2.1.1' && (await a.$eval('#live-ip-input', (e) => e.value)) === '127.0.0.1:48968', 'switched: Line B\'s NetId and address');

  // Overview: the POU's own PLC not live; two other PLCs added
  await a.evaluate(() => document.getElementById('dock-tab-overview')?.click());
  await sleep(400);
  const addPlc = async (key) => {
    await a.select('#other-plcs-pick', key);
    await a.click('#other-plcs-add');
    await sleep(300);
  };
  await addPlc('plc-127.0.0.1.1.1');
  await addPlc('plc-127.0.0.2.1.1');
  const machines = async (key) => a.$$eval(`.other-plc[data-plc="${key}"] .overview-row`, (r) => r.map((x) => `${x.getAttribute('data-path')}=${x.querySelector('.overview-state').textContent.trim()}`));
  let ma = [];
  let mb = [];
  for (let i = 0; i < 60 && (ma.length < 4 || mb.length < 4 || ma.some((m) => /=\s*$|…|\.\.\./.test(m))); i++) {
    await sleep(300);
    ma = await machines('plc-127.0.0.1.1.1');
    mb = await machines('plc-127.0.0.2.1.1');
  }
  console.log('   A:', ma.join('  '));
  expect(ma.length >= 4 && mb.length >= 4, `both PLCs' machines: ${ma.length} and ${mb.length}`);
  expect(ma.some((m) => /smTable2=.*TABLEMANAGER_HOMMING|smTable2=.*HOMMING/.test(m)) && mb.some((m) => /aDoors\[2\]=/.test(m)), 'their states (names from the .TcDUT / the PLC\'s enums)');
  const statuses = await a.$$eval('.other-plc-status', (s) => s.map((x) => x.textContent));
  expect(statuses.length === 2 && statuses.every((s) => /PLC Run/.test(s)), `connected: ${statuses.join(' | ')}`);
  await a.screenshot({ path: h.out('overview-multi.png'), fullPage: false });

  // Kept after a reload; removed
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await a.evaluate(() => document.getElementById('dock-tab-overview')?.click());
  await a.waitForFunction(() => document.querySelectorAll('.other-plc').length === 2, { timeout: 8000 }).catch(() => {});
  expect((await a.$$('.other-plc')).length === 2, 'after a reload: both again');
  await a.click('.other-plc[data-plc="plc-127.0.0.1.1.1"] .other-plc-remove');
  await sleep(500);
  expect((await a.$$('.other-plc')).length === 1 && JSON.parse(await a.evaluate(() => localStorage.getItem('kss.overview.plcs'))).length === 1, 'removed: one left');
  await sleep(1500);
  const linkLog = fs.readFileSync(linkOut, 'utf8');
  expect(/watches 127\.0\.0\.1\.1\.1:851 \(overview\)/.test(linkLog) && /watches 127\.0\.0\.2\.1\.1:851 \(overview\)/.test(linkLog), 'Link: the monitor sessions logged');
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  for (const p of [plcA, plcB, finder, link]) p.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
