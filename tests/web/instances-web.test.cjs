const h = require('../lib/harness.cjs');
// Web edition (through Kval StateScope Link): Open instance opens a browser tab with the POU handed over, live on it
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
const APP = h.REPO;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const I = ['MAIN.smTable1', 'MAIN.smTable2', 'MAIN.smTable3'];
const cfg = path.join(h.OUT, 'fake-ams2-inst.json');
fs.writeFileSync(cfg, JSON.stringify({
  symbols: Object.fromEntries(I.map((p, k) => [`${p}.machineState`, { type: 'E_TableManager_States', dataType: 2, size: 2, value: [2, 3, 0][k] }])),
  upload: I.map((name) => ({ name, type: 'SM_TableManager' })),
  script: [],
}));

(async () => {
  const plcLog = path.join(h.OUT, 'fake-ams2-inst-web.txt');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48957', cfg], { stdio: ['ignore', fs.openSync(plcLog, 'w'), fs.openSync(plcLog, 'a')] });
  const out = fs.openSync(path.join(h.OUT, 'link-inst-run.txt'), 'w');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48963'], { env: { ...process.env, APPDATA: path.join(h.OUT, 'link-appdata') }, stdio: ['ignore', out, out] });
  await sleep(2500);
  const code = (await h.waitForText(path.join(h.OUT, 'link-inst-run.txt'), /Pairing code:\s+(\S+)/))?.[1];
  if (!code) throw new Error('Link did not start (no pairing code)');

  const edge = { kill() {} }; // (the harness launches the browser)
  let browser;
  browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const errors = [];
  const set = (p, id, v) => p.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  const current = (p) => p.$eval('#live-current-state', (e) => e.textContent).catch(() => '');
  const waitCurrent = async (p, rx) => { let s = ''; for (let i = 0; i < 60 && !rx.test(s); i++) { await sleep(300); s = await current(p); } return s; };
  const pages = async () => (await browser.pages()).filter((p) => p.url().startsWith(h.APP_ORIGIN));

  const a = await browser.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  await a.goto(h.APP_URL, { waitUntil: 'load' });
  await a.evaluate(() => localStorage.clear());
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 30000 });
  // A dropped POU (no .TcDUT: states show as numbers, #2 = smTable1, #3 = smTable2), not a sample, edited so the handed-over tab can be checked for the same POU
  const table = fs.readFileSync(path.join(h.FIXTURES, 'sample0', 'SM_TableManager.TcPOU'), 'utf8').replace('Homing', 'Homing (edited here)');
  await a.evaluate((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], "SM_TableManager.TcPOU", { type: "text/xml" }));
    document.getElementById("source-files-header").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, table);
  await sleep(1500);
  expect(await a.evaluate(() => document.body.innerText.includes("Homing (edited here)")), "tab 1 shows the dropped POU");
  await a.click('#dock-tab-live');
  await sleep(400);
  await set(a, 'live-token-input', code);
  await a.click('#live-token-remember');
  await set(a, 'live-link-port-input', '48963');
  await set(a, 'live-netid-input', '127.0.0.1.1.1');
  await set(a, 'live-ip-input', '127.0.0.1:48957');
  await a.click('#live-guards-off').catch(() => {});
  await a.click('#live-start-btn');
  const s1 = await waitCurrent(a, /TABLEMANAGER_|#d/);
  const rows = await a.$$eval('.live-instance-row', (r) => r.map((x) => x.getAttribute('data-instance')));
  expect(/^#2$/.test(s1) && rows.length === 3, `tab 1 follows smTable1 (${s1}); instances: ${rows.join(', ')}`);
  const openLabel = await a.$eval('.live-open-instance', (e) => e.getAttribute('title'));
  expect(/new tab/.test(openLabel), `Open says "tab": ${openLabel}`);

  await a.evaluate((inst) => document.querySelector(`.live-instance-row[data-instance="${inst}"] .live-open-instance`).click(), 'MAIN.smTable2');
  let b;
  for (let i = 0; i < 40 && !b; i++) { await sleep(300); b = (await pages()).find((p) => p !== a); }
  if (b) {
    b.on('pageerror', (e) => errors.push(e.message));
    await b.bringToFront();
    await b.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 }).catch(() => {});
    await b.click('#dock-tab-live').catch(() => {});
  }
  const s2 = b ? await waitCurrent(b, /TABLEMANAGER_|#d/) : '';
  const t2 = b ? await b.title() : '';
  expect(b && (await b.evaluate(() => document.body.innerText.includes('Homing (edited here)'))), 'tab 2 shows the handed-over POU (not a sample)');
  expect(!!b && /SM_TableManager \(MAIN\.smTable2\)/.test(t2), `a new tab for smTable2: "${t2}"`);
  expect(/^#3$/.test(s2), `it went live on smTable2 through Link: ${s2}`);
  expect(b && !/handoff/.test(b.url()), `handoff gone from the URL: ${b?.url()}`);
  const left = await a.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('kss.handoff.')).length);
  expect(left === 0, `the handoff entry was taken (${left} left)`);
  expect(/^#2$/.test(await current(a)), 'tab 1 still follows smTable1');
  if (b) await b.screenshot({ path: path.join(h.OUT, 'inst-web-b.png') });
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);

  await browser.close().catch(() => {});
  edge.kill();
  link.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
