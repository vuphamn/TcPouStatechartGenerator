const h = require('../lib/harness.cjs');
// Web edition through Kval StateScope Link: Live > Symbols, values, Watch (same POU: a new tab with the connection)
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
const APP = h.REPO;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const R = 'MAIN.mainStateMachine';
const cfg = require('../fakes/symbols-plc.cjs').writeSymbolsPlc();

(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48960', cfg], { stdio: ['ignore', fs.openSync(path.join(h.OUT, 'fake-ams2-sym-web.txt'), 'w'), 'ignore'] });
  const out = fs.openSync(path.join(h.OUT, 'link-sym-run.txt'), 'w');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48964'], { env: { ...process.env, APPDATA: path.join(h.OUT, 'link-appdata') }, stdio: ['ignore', out, out] });
  await sleep(2500);
  const code = (await h.waitForText(path.join(h.OUT, 'link-sym-run.txt'), /Pairing code:\s+(\S+)/))?.[1];
  if (!code) throw new Error('Link did not start (no pairing code)');
  const edge = { kill() {} }; // (the harness launches the browser)
  let browser;
  browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const errors = [];
  const set = (p, id, v) => p.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  const row = (p, pth) => p.evaluate((pth) => { const r = document.querySelector(`.symbol-row[data-path="${pth}"]`); return r ? { text: r.textContent, value: r.querySelector('.symbol-value')?.textContent ?? null, watch: !!r.querySelector('.symbol-watch') } : null; }, pth);
  const waitRow = async (p, pth, test = () => true) => { let r = null; for (let i = 0; i < 50 && !(r && test(r)); i++) { await sleep(200); r = await row(p, pth); } return r; };
  const pages = async () => (await browser.pages()).filter((p) => p.url().startsWith(h.APP_ORIGIN));

  const a = await browser.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  await a.goto(h.APP_URL, { waitUntil: 'load' });
  await a.evaluate(() => localStorage.clear());
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 30000 });
  await a.click('#dock-tab-live');
  await sleep(400);
  await set(a, 'live-token-input', code);
  await a.click('#live-token-remember');
  await set(a, 'live-link-port-input', '48964');
  await set(a, 'live-netid-input', '127.0.0.1.1.1');
  await set(a, 'live-ip-input', '127.0.0.1:48960');
  await set(a, 'live-instance-input', `${R}.smTable1`);
  await a.click('#live-guards-off').catch(() => {});
  await a.click('#live-start-btn');
  await a.waitForSelector('#live-symbols-btn', { timeout: 20000 }).catch(() => {});
  await a.click('#live-symbols-btn');
  const n = await waitRow(a, `${R}.nCount`, (r) => /^4[23]$/.test(r.value));
  const t2 = await row(a, `${R}.smTable2`);
  expect(/^4[23]$/.test(n?.value ?? '') && t2?.watch, `through Link: nCount=${n?.value}, smTable2 has Watch`);
  const watchTitle = await a.$eval('.symbol-watch', (e) => e.getAttribute('title'));
  expect(/new tab/.test(watchTitle), `Watch says "tab": ${watchTitle}`);

  // Watch smTable2 (the same POU, a sample here): a new tab with the connection, live on it
  await a.evaluate((p) => document.querySelector(`.symbol-row[data-path="${p}"] .symbol-watch`).click(), `${R}.smTable2`);
  let b;
  for (let i = 0; i < 40 && !b; i++) { await sleep(300); b = (await pages()).find((p) => p !== a); }
  let s2 = '';
  if (b) {
    b.on('pageerror', (e) => errors.push(e.message));
    await b.bringToFront();
    await b.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 }).catch(() => {});
    await b.click('#dock-tab-live').catch(() => {});
    for (let i = 0; i < 60 && !s2; i++) { await sleep(300); s2 = await b.$eval('#live-current-state', (e) => e.textContent).catch(() => ''); }
  }
  const title = b ? await b.title() : '';
  expect(/SM_TableManager \(MAIN\.mainStateMachine\.smTable2\)/.test(title) && /TABLEMANAGER_HOMMING$/.test(s2), `a new tab: "${title}", live ${s2}`);

  // Closing the window stops following its values; a bad root is reported
  await a.bringToFront();
  await set(a, 'symbol-browser-root', 'MAIN.nothingHere');
  await a.click('#symbol-browser-root');
  await a.keyboard.press('Enter');
  let err = '';
  for (let i = 0; i < 40 && !err; i++) { await sleep(200); err = await a.$eval('#symbol-browser-error', (e) => e.textContent).catch(() => ''); }
  expect(/not in the PLC/.test(err), `unknown root: "${err}"`);
  await set(a, 'symbol-browser-root', R);
  await a.click('#symbol-browser-root');
  await a.keyboard.press('Enter');
  await waitRow(a, `${R}.nCount`);
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);

  await browser.close().catch(() => {});
  edge.kill();
  link.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
