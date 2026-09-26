const h = require('../lib/harness.cjs');
// Mermaid Markdown tab: current line (click, arrows, search), highlighted like the editors; Ctrl+wheel zoom (shared)
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
  await page.click('#dock-tab-markdown');
  await page.waitForSelector('#markdown-code-scroll-container [data-line="0"]', { timeout: 10000 });
  await sleep(400);
  const C = '#markdown-code-scroll-container';
  const cur = () => page.evaluate(() => {
    const r = document.querySelector('[data-current-line]');
    const el = document.getElementById('markdown-code-scroll-container');
    const row = r ? r.getBoundingClientRect() : null;
    const box = el.getBoundingClientRect();
    return r ? { line: Number(r.getAttribute('data-line')) + 1, state: r.getAttribute('data-current-line'), cls: r.className, num: r.firstElementChild.textContent, visible: row.top >= box.top - 1 && row.bottom <= box.bottom + 1 } : null;
  });
  const rowPoint = (line) => page.evaluate((i) => { const r = document.querySelector(`[data-line="${i}"]`); r.scrollIntoView({ block: 'center' }); const b = r.getBoundingClientRect(); return { x: b.x + 120, y: b.y + b.height / 2 }; }, line - 1);

  expect((await cur()) === null, 'no current line before a click');
  let p = await rowPoint(5);
  await page.mouse.click(p.x, p.y);
  await sleep(150);
  let c = await cur();
  expect(c?.line === 5 && c.state === 'focused' && /bg-slate-600/.test(c.cls) && c.num === '5', `click on line 5: current ${c?.line} (${c?.state})`);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await sleep(100);
  expect((await cur())?.line === 7, `two lines down: ${(await cur())?.line}`);
  await page.keyboard.press('PageDown');
  await sleep(150);
  c = await cur();
  expect(c.line > 12 && c.visible, `PageDown: line ${c.line}, in view ${c.visible}`);
  await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control');
  await sleep(200);
  const total = await page.$$eval('[data-line]', (r) => r.length);
  c = await cur();
  expect(c.line === total && c.visible, `Ctrl+End: the last line (${c.line}/${total}), in view`);
  await page.keyboard.down('Control'); await page.keyboard.press('Home'); await page.keyboard.up('Control');
  await sleep(200);
  expect((await cur())?.line === 1, 'Ctrl+Home: line 1');
  // Search jumps move it
  await page.click('#markdown-search-input');
  await page.keyboard.type('TABLEMANAGER_HOMMING');
  await page.keyboard.press('Enter');
  await sleep(300);
  c = await cur();
  expect(c && c.state === 'blurred' && /TABLEMANAGER_HOMMING/.test(await page.evaluate((i) => document.querySelector(`[data-line="${i}"]`).textContent, c.line - 1)), `a search jump moves it (line ${c?.line}, ${c?.state}: dimmer while the search box has the focus)`);
  await page.click('#markdown-search-input', { clickCount: 3 });
  await page.keyboard.press('Escape');

  // Zoom: Ctrl+wheel
  p = await rowPoint(10);
  await page.mouse.move(p.x, p.y);
  const fs0 = await page.$eval(C, (e) => getComputedStyle(e).fontSize);
  await page.keyboard.down('Control');
  for (let i = 0; i < 3; i++) { await page.mouse.wheel({ deltaY: -100 }); await sleep(60); }
  await page.keyboard.up('Control');
  await sleep(250);
  const z = await page.evaluate(() => ({ fs: getComputedStyle(document.getElementById('markdown-code-scroll-container')).fontSize, badge: document.getElementById('markdown-code-zoom')?.textContent, dpr: window.devicePixelRatio, stored: localStorage.getItem('kss.editor.zoom') }));
  expect(fs0 === '12px' && z.fs === '15.6px' && z.badge === '130%' && z.dpr === 1 && z.stored === '1.3', `Ctrl+wheel: ${fs0} -> ${z.fs}, badge ${z.badge}, page not zoomed, saved ${z.stored}`);
  await page.screenshot({ path: path.join(h.OUT, 'markdown-view.png') });
  // Shared with the Method Editor
  await page.click('#dock-tab-method');
  await page.waitForSelector('#method-implementation-editor');
  await sleep(300);
  expect((await page.$eval('#method-implementation-editor', (e) => getComputedStyle(e).fontSize)) === '15.6px', 'the Method Editor has the same size');
  await page.click('#dock-tab-markdown');
  await sleep(300);
  await page.focus(C);
  await page.keyboard.down('Control'); await page.keyboard.press('Digit0'); await page.keyboard.up('Control');
  await sleep(1500);
  const back = await page.evaluate(() => ({ fs: getComputedStyle(document.getElementById('markdown-code-scroll-container')).fontSize, badge: document.getElementById('markdown-code-zoom')?.textContent ?? null }));
  expect(back.fs === '12px' && back.badge === null, `Ctrl+0: ${back.fs}, badge ${back.badge}`);
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  console.log(`${fails} failures`);
  await browser.close().catch(() => {});
  edge.kill();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
