const h = require('../lib/harness.cjs');
// Problems tab in the web app (dev server): findings, badge, diagram marker, fixes, ignore, open code
const puppeteer = require('puppeteer-core');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
let fails = 0;
const expect = (cond, what) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };

(async () => {
  const { spawn } = require('child_process');
  const edge = { kill() {} }; // (the harness launches the browser)
  let browser;
  browser = await h.launchBrowser({ defaultViewport: { width: 1700, height: 1000 }, args: ["--window-size=1700,1000"] });

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node[data-state-id]', { timeout: 30000 });

  const keys = () => page.$$eval('[data-problem-key]', (els) => els.map((e) => e.getAttribute('data-problem-key')));
  const badge = () => page.$eval('#problems-tab-badge', (e) => e.textContent).catch(() => null);

  await page.click('#dock-tab-problems');
  await sleep(500);
  expect(JSON.stringify(await keys()) === '["no-else"]', `clean sample: only no-else (${await keys()})`);
  expect((await badge()) === null, 'no badge for info only');

  // Break a transition in doState through the Method Editor
  await page.click('#dock-tab-method');
  await sleep(800);
  const changed = await page.evaluate(() => {
    const ta = document.querySelector('textarea#method-implementation-editor');
    if (!ta || !ta.value.includes('machineState := TABLEMANAGER_HOMMING;')) return false;
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, ta.value.replace('machineState := TABLEMANAGER_HOMMING;', 'machineState := TABLEMANAGER_BOGUS;'));
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  expect(changed, 'edited doState in the Method Editor');
  await sleep(300);
  await page.click('#method-save-btn');
  await sleep(1500);
  await page.click('#dock-tab-problems');
  await sleep(500);
  let k = await keys();
  expect(k.includes('unknown-target:TABLEMANAGER_BOGUS') && k.includes('unreachable:TABLEMANAGER_HOMMING'), `after edit: ${k.join(', ')}`);
  expect((await badge()) === '2', `badge shows 2 (${await badge()})`);
  await page.click('#dock-tab-diagram');
  await sleep(1200);
  const marker = await page.evaluate(() => !!document.querySelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"] g.lint-problem-marker.lint-problem-warning'));
  expect(marker, 'warning marker on TABLEMANAGER_HOMMING');
  await page.screenshot({ path: path.join(h.OUT, 'problems-marker.png') });
  const r = await page.evaluate(() => { const n = document.querySelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]'); const b = n.getBoundingClientRect(); return { x: b.x - 20, y: b.y - 20, width: b.width + 40, height: b.height + 40 }; });
  await page.setViewport({ width: 1700, height: 1000, deviceScaleFactor: 4 });
  await page.screenshot({ path: path.join(h.OUT, 'problems-marker-zoom.png'), clip: r });
  await page.setViewport({ width: 1700, height: 1000, deviceScaleFactor: 1 });

  // Fix: add to enum -> then the missing branch -> add CASE branch
  await page.click('#dock-tab-problems');
  await sleep(400);
  const clickFix = (key) => page.evaluate((key) => document.querySelector(`[data-problem-key="${key}"] .problems-fix`)?.click() ?? false, key);
  await clickFix('unknown-target:TABLEMANAGER_BOGUS');
  await sleep(1500);
  k = await keys();
  expect(!k.includes('unknown-target:TABLEMANAGER_BOGUS') && k.includes('missing-branch:TABLEMANAGER_BOGUS'), `after Add to enum: ${k.join(', ')}`);
  await clickFix('missing-branch:TABLEMANAGER_BOGUS');
  await sleep(1500);
  k = await keys();
  expect(!k.includes('missing-branch:TABLEMANAGER_BOGUS') && k.includes('dead-end:TABLEMANAGER_BOGUS'), `after Add CASE branch: ${k.join(', ')}`);

  // Ignore
  await page.evaluate(() => document.querySelector('[data-problem-key="dead-end:TABLEMANAGER_BOGUS"] .problems-ignore').click());
  await sleep(400);
  k = await keys();
  const ignoredBtn = await page.$eval('#problems-show-ignored', (e) => e.textContent).catch(() => null);
  expect(!k.includes('dead-end:TABLEMANAGER_BOGUS') && /1 ignored/.test(ignoredBtn || ''), `ignored (${ignoredBtn})`);
  const stored = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('kss.lint.ignored.')));
  expect(stored.length === 1 && stored[0][1].includes('dead-end:TABLEMANAGER_BOGUS'), `ignore remembered (${JSON.stringify(stored)})`);
  await page.screenshot({ path: path.join(h.OUT, 'problems-panel.png') });

  // Open code: Method Editor on doState
  await page.evaluate(() => document.querySelector('[data-problem-key="unreachable:TABLEMANAGER_HOMMING"] .problems-go-to-code').click());
  await sleep(800);
  const methodActive = await page.evaluate(() => document.querySelector('#dock-tab-method')?.getAttribute('aria-selected') ?? document.querySelector('#dock-tab-method')?.className);
  console.log('     method tab after Open code:', methodActive);
  console.log('page errors:', errors);
  await browser.close().catch(() => {});
  edge.kill();
  console.log(`${fails} failures`);
})();
