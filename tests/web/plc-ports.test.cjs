const h = require('../lib/harness.cjs');
// Web edition through Link: a PLC whose runtime is on ADS port 852, gone live on 851: the Live tab says which port it
// runs on, Use port 852 fills it in, then live. Check on an address where nothing answers: the commands for the
// PLC's computer (its firewall), ready to copy
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const I = 'MAIN.mainStateMachine.smTable';

(async () => {
  const cfg = h.out('fake-ams2-ports.json');
  fs.writeFileSync(cfg, JSON.stringify({ symbols: { [`${I}.machineState`]: { type: 'E_TableManager_States', dataType: 2, size: 2, value: 2 } }, plcPorts: [852] }));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48984', cfg], { stdio: 'ignore' });
  const linkOut = path.join(h.OUT, 'link-ports-run.txt');
  const out = fs.openSync(linkOut, 'w');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48988'], { env: { ...process.env, APPDATA: path.join(h.OUT, 'link-ports-appdata'), KSS_LOCAL_TWINCAT_NETID: 'none', KSS_DISCOVERY_PORT: '48989', KSS_DISCOVERY_BROADCAST: '0' }, stdio: ['ignore', out, out] });
  const code = (await h.waitForText(linkOut, /Pairing code:\s+(\S+)/))?.[1];
  if (!code) throw new Error('Link did not start (no pairing code)');
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const errors = [];
  const set = async (p, id, v) => {
    await p.waitForSelector(`#${id}`, { timeout: 10000 }).catch(() => {});
    return p.evaluate((id, v) => { const el = document.getElementById(id); if (!el) throw new Error(`no #${id}`); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  };
  const a = await browser.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  await a.goto(h.APP_URL, { waitUntil: 'load' });
  await a.evaluate(() => localStorage.clear());
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await a.click('#dock-tab-live');
  await sleep(400);
  await set(a, 'live-token-input', code);
  await set(a, 'live-link-port-input', '48988');
  await set(a, 'live-netid-input', '127.0.0.2.1.1');
  await set(a, 'live-ip-input', '127.0.0.1:48984');
  await set(a, 'live-instance-input', I);
  await a.click('#live-guards-off').catch(() => {});

  // Live on 851: nothing there, its PLC on 852
  await a.click('#live-start-btn');
  await a.waitForSelector('#live-ports .live-port-use', { timeout: 20000 }).catch(() => {});
  const said = await a.$eval('#live-status', (e) => e.textContent).catch(() => '');
  const offered = await a.$$eval('#live-ports .live-port-use', (b) => b.map((x) => x.getAttribute('data-port')));
  expect(/nothing is on ADS port 851: its PLC runs on port 852 \(Run\)/.test(said) && offered.join() === '852', `live on 851: "${said.slice(0, 100)}" (offered: ${offered.join()})`);
  await a.click('#live-ports .live-port-use');
  await sleep(200);
  const port = await a.$eval('#live-port-input', (e) => e.value).catch(() => '');
  await a.click('#live-start-btn');
  let status = '';
  for (let i = 0; i < 60 && !/on 127\.0\.0\.1/.test(status); i++) { await sleep(300); status = await a.$eval('#live-status', (e) => e.textContent).catch(() => ''); }
  expect(port === '852' && /:852\)/.test(status), `Use port 852: the port "${port}", then live ("${status.slice(0, 90)}")`);
  await a.click('#live-stop-btn').catch(() => {});
  await sleep(500);

  // Check where nothing answers: the commands for that computer
  await set(a, 'live-ip-input', '127.0.0.1:48989');
  await a.click('#live-plc-check');
  await a.waitForSelector('#live-check-firewall', { timeout: 30000 }).catch(() => {});
  const cmds = await a.$eval('#live-check-firewall pre', (e) => e.textContent).catch(() => '');
  expect(/New-NetFirewallRule -DisplayName "TwinCAT ADS \(TCP 48898\)" -Direction Inbound -Protocol TCP -LocalPort 48898/.test(cmds) && /UDP 48899/.test(cmds) && /Get-NetConnectionProfile/.test(cmds), `Check, nothing there: the firewall's commands offered (${cmds.split('\n').length} lines)`);
  await a.screenshot({ path: h.out('plc-ports.png') });
  await a.evaluate(() => document.querySelector('#live-check-panel button[title="Close"]')?.click());

  // Live on a PLC in Stop: Start PLC…, off until its box is ticked, then it runs
  const cfgStop = h.out('fake-ams2-stopped.json');
  fs.writeFileSync(cfgStop, JSON.stringify({ symbols: { [`${I}.machineState`]: { type: 'E_TableManager_States', dataType: 2, size: 2, value: 2 } }, adsState: 6 }));
  const stopped = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48982', cfgStop], { stdio: 'ignore' });
  await sleep(500);
  await set(a, 'live-ip-input', '127.0.0.1:48982');
  await set(a, 'live-port-input', '851');
  await a.click('#live-start-btn');
  await a.waitForSelector('#live-start-plc', { timeout: 20000 }).catch(() => {});
  const inStop = await a.$eval('#live-status', (e) => e.textContent).catch(() => '');
  await a.click('#live-start-plc');
  const off = await a.$eval('#live-start-plc-confirm', (e) => e.disabled).catch(() => null);
  await a.click('#live-start-plc-safe');
  await a.click('#live-start-plc-confirm');
  await a.waitForSelector('#live-start-plc-result', { timeout: 15000 }).catch(() => {});
  const result = await a.$eval('#live-start-plc-result', (e) => e.getAttribute('data-ok') + '|' + e.textContent).catch(() => '');
  let running = '';
  for (let i = 0; i < 20 && !/PLC Run/.test(running); i++) { await sleep(300); running = await a.$eval('#live-status', (e) => e.textContent).catch(() => ''); }
  expect(/PLC Stop/.test(inStop) && off === true && /^true\|Started: the PLC runs/.test(result) && /PLC Run/.test(running), `live, in Stop: Start PLC… (off until ticked: ${off}), "${result.split('|')[1]?.trim()}", then "${running.slice(-12)}"`);
  await a.click('#live-stop-btn').catch(() => {});
  stopped.kill();

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close().catch(() => {});
  link.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
