const h = require('../lib/harness.cjs');
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const edge = { kill() {} }; // (the harness launches the browser)
  let b; b = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await b.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
  await p.click('#dock-tab-method'); await sleep(800);
  const text = await p.evaluate(() => document.body.innerText);
  console.log(/Found in POU/.test(text) ? 'FAIL label still shown' : 'ok   "Found in POU" is gone');
  console.log(/doState\(\)/.test(text) && (await p.$('#method-selector-combobox')) ? 'ok   the Method Editor shows doState()' : 'FAIL editor');
  await p.screenshot({ path: path.join(__dirname, 'method-header.png'), clip: { x: 400, y: 40, width: 800, height: 140 } });
  console.log('page errors:', errors);
  await b.close().catch(() => {}); edge.kill(); process.exit(0);
})();
