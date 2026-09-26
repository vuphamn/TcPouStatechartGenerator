const h = require('../lib/harness.cjs');
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
(async () => {
  const edge = { kill() {} }; // (the harness launches the browser)
  let b; b = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await b.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
  const a = await p.$eval('#readme-link', (e) => ({ href: e.href, target: e.target, rel: e.rel, title: e.title }));
  expect(a.href === 'https://github.com/vuphamn/TcPouStatechartGenerator#readme' && a.target === '_blank' && /noopener/.test(a.rel), `link: ${a.href} (${a.target}, ${a.rel})`);
  const opened = new Promise((r) => b.once('targetcreated', (t) => r(t.url())));
  await p.click('#readme-link');
  const url = await Promise.race([opened, sleep(5000).then(() => null)]);
  expect(/github\.com\/vuphamn\/TcPouStatechartGenerator/.test(url || ''), `a click opens a new tab: ${url}`);
  // The new tab came to the front: close it, the app's tab renders again
  await p.bringToFront();
  for (const w of [1600, 1100]) {
    await p.setViewport({ width: w, height: 900 }); await sleep(1800);
    const r = await p.evaluate(() => {
      const row = document.getElementById('header-row-1').getBoundingClientRect();
      const link = document.getElementById('readme-link').getBoundingClientRect();
      const help = document.getElementById('help-btn').getBoundingClientRect();
      const dbg = { inner: window.innerWidth, docW: document.documentElement.scrollWidth, bodyW: document.body.scrollWidth, rowW: Math.round(row.width), rowScroll: document.getElementById('header-row-1').scrollWidth, bar: Math.round(document.getElementById('header-action-bar').getBoundingClientRect().width) };
      return { dbg, fits: link.right <= help.left + 1 && help.right <= row.right && link.width > 0, link: Math.round(link.left), help: Math.round(help.right), row: Math.round(row.right) };
    });
    expect(r.fits, `${w} px: README link and Help both in the header (${JSON.stringify(r)})`);
  }
  await p.screenshot({ path: path.join(__dirname, 'readme-link.png'), clip: { x: 0, y: 0, width: 1100, height: 60 } });
  console.log('page errors:', errors.slice(0, 3));
  await b.close().catch(() => {}); edge.kill();
  console.log(`${fails} failures`); process.exit(fails ? 1 : 0);
})();
