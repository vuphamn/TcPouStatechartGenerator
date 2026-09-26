const h = require('../lib/harness.cjs');
// The Sample dropdown: the two qualified-enum KPowerSupply samples load and draw their states and transitions
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const edge = { kill() {} }; // (the harness launches the browser)
  let browser;
  browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 30000 });
  const options = await page.$$eval('#sample-selector option', (o) => o.map((x) => `${x.value}|${x.textContent.trim()}`));
  const cases = [
    { id: 'k-servo-supply-manager', states: ['DISABLED', 'ADD_CHILDREN', 'NO_CHILDREN', 'ENABLE_CHILDREN', 'ENABLED', 'ERROR'], minEdges: 4 },
    { id: 'k-power-supply-ax86x0', states: ['DISABLED', 'ENABLING', 'RESET', 'ENABLED', 'ERROR'], minEdges: 5 },
  ];
  for (const c of cases) {
    const opt = options.find((o) => o.startsWith(c.id + '|'));
    expect(!!opt, `dropdown lists ${opt || c.id}`);
    if (!opt) continue;
    await page.select('#sample-selector', c.id);
    await page.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${c.states[1]}"]`, { timeout: 30000 }).catch(() => null);
    await sleep(1200);
    const drawn = await page.evaluate(() => ({
      nodes: [...document.querySelectorAll('#mermaid-canvas-area g.node[data-state-id]')].map((n) => n.getAttribute('data-state-id')),
      edges: document.querySelectorAll('#mermaid-canvas-area path.transition, #mermaid-canvas-area .edgePaths path, #mermaid-canvas-area path[id^="edge"]').length,
      text: document.body.innerText,
    }));
    const missing = c.states.filter((s) => !drawn.nodes.includes(s));
    expect(missing.length === 0, `${c.id}: states drawn (${drawn.nodes.length})${missing.length ? ' missing ' + missing.join(',') : ''}`);
    expect(!drawn.nodes.some((n) => n.includes('.')), `${c.id}: no qualified names as node ids`);
    expect(drawn.edges >= c.minEdges, `${c.id}: ${drawn.edges} transitions drawn`);
    await page.screenshot({ path: path.join(h.OUT, `sample-${c.id}.png`) });
  }
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  console.log(`${fails} failures`);
  await browser.close().catch(() => {});
  edge.kill();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
