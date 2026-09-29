const h = require('../lib/harness.cjs');
// Web edition through a gateway (allowBuild, allowWrite): Build from the TwinCAT project's folder (a stand-in folder in
// the page): its files sent to the gateway, built there (its stand-in compiler, KSS_BUILD_DRYRUN), written (online
// change): the new compile information written into the folder
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { fakeFolder } = require('../lib/fake-folder.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8472;
const I = 'MAIN.mainStateMachine.smTable1';

(async () => {
  const cfg = require('../fakes/symbols-plc.cjs').writeSymbolsPlc('fake-ams2-gwbuild.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48962', cfg], { stdio: 'ignore' });
  const gwDir = h.out('gw-webbuild');
  fs.rmSync(gwDir, { recursive: true, force: true });
  fs.mkdirSync(gwDir, { recursive: true });
  const gwConfig = path.join(gwDir, 'config.json');
  fs.writeFileSync(gwConfig, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [h.APP_ORIGIN, h.APP_ORIGIN.replace('localhost', '127.0.0.1')],
    allowBuild: true, allowWrite: true,
    plcs: [{ id: 'line', name: 'Line', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48962', port: 851 }], tokens: [],
  }, null, 1));
  const token = execFileSync(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'add-token', 'tester', '--config', gwConfig], { encoding: 'utf8' }).match(/\n\s+(\S+)\s*\n/)[1];
  const gwLog = h.out('gw-webbuild-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', gwConfig], { env: { ...process.env, KSS_BUILD_DRYRUN: '1', KSS_BUILD_RUN_WAIT_MS: '800' }, stdio: ['ignore', fs.openSync(gwLog, 'w'), fs.openSync(gwLog, 'a')] });
  await sleep(1500);

  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const errors = [];
  const set = async (p, id, v) => {
    await p.waitForSelector(`#${id}`, { timeout: 10000 }).catch(() => {});
    return p.evaluate((id, v) => { const el = document.getElementById(id); if (!el) throw new Error(`no #${id}`); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  };
  const a = await browser.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  const pou = '<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject><POU Name="SM_TableManager"><Declaration><![CDATA[FUNCTION_BLOCK SM_TableManager]]></Declaration></POU></TcPlcObject>';
  await a.evaluateOnNewDocument(fakeFolder, {
    name: 'Plant',
    files: {
      'Plant.tsproj': '<TcSmProject/>',
      'Plant/Plant.plcproj': '<Project/>',
      'Plant/POUs/SM_TableManager.TcPOU': pou,
      'Plant/POUs/E_TableManager_States.TcDUT': '<TcPlcObject><DUT Name="E_TableManager_States"/></TcPlcObject>',
    },
  });
  await a.goto(h.APP_URL, { waitUntil: 'load' });
  await a.evaluate(() => localStorage.clear());
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await a.click('#dock-tab-live');
  await sleep(400);
  await a.click('#live-via-gateway').catch(() => {});
  await sleep(200);
  await set(a, 'live-gateway-input', `http://localhost:${PORT}`);
  await set(a, 'live-token-input', token);
  await set(a, 'live-instance-input', I);
  await a.click('#live-guards-off').catch(() => {});
  await a.click('#live-start-btn');
  await a.waitForSelector('#live-build-btn', { timeout: 20000 }).catch(() => {});
  const live = await a.$eval('#live-status', (e) => e.textContent).catch(() => '');
  expect(!!(await a.$('#live-build-btn')), `live through the gateway ("${live.slice(0, 70)}"), a POU not from the PLC: Build offered`);

  const status = () => a.$eval('#plc-build-status', (e) => ({ phase: e.getAttribute('data-phase'), ok: e.getAttribute('data-ok'), text: e.textContent.trim() })).catch(() => ({ phase: '', ok: '', text: '' }));
  const waitDone = async () => { let s = await status(); for (let i = 0; i < 150 && s.phase !== 'done'; i++) { await sleep(200); s = await status(); } return s; };
  await a.click('#live-build-btn');
  let s = await waitDone();
  const intro = await a.$eval('#plc-build-dialog', (e) => e.innerText).catch(() => '');
  expect(s.ok === 'true' && /sent to the gateway/.test(intro) && /the gateway's computer/.test(intro) && /built for line from a project folder: ok/.test(fs.readFileSync(gwLog, 'utf8')), `built on the gateway from the folder: "${s.text}"`);
  await a.click('#plc-build-online');
  await a.click('#plc-build-safe');
  await a.click('#plc-build-confirm-btn');
  s = await waitDone();
  const written = await a.evaluate(() => window.__fakeFs.written);
  const info = Object.keys(written).filter((p) => /^Plant\/_CompileInfo\/StandIn-\d+\.compileinfo$/.test(p));
  expect(s.ok === 'true' && /Written to the PLC \(online change\)/.test(s.text) && info.length === 1, `written through the gateway: "${s.text.slice(0, 50)}"; into the folder: ${info.join(', ') || 'nothing'}`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close().catch(() => {});
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
