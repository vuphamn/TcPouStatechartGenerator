const h = require('../lib/harness.cjs');
// Method / Enum Editor: Ctrl+mouse wheel zooms the text (not the page); shared, remembered, Ctrl+0 resets
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

  const M = 'method-implementation-editor';
  const E = 'st-dut-editor';
  const info = (id) => page.evaluate((id) => {
    const ta = document.getElementById(id);
    if (!ta) return null;
    const pre = ta.previousElementSibling;
    const band = document.getElementById(`${id}-caret-line`);
    const row = ta.closest('.relative.flex-1.min-h-0.flex').querySelector('[data-caret-line]');
    const lh = parseFloat(getComputedStyle(ta).lineHeight);
    return {
      font: getComputedStyle(ta).fontSize, preFont: getComputedStyle(pre).fontSize, lh, preLh: parseFloat(getComputedStyle(pre).lineHeight),
      rowH: row ? row.getBoundingClientRect().height : null,
      bandLine: band ? Math.round((parseFloat(band.style.top) - 8 + ta.scrollTop) / lh) + 1 : null,
      badge: document.getElementById(`${id}-zoom`)?.textContent ?? null,
      pageZoom: window.visualViewport ? window.visualViewport.scale : 1, dpr: window.devicePixelRatio,
      scrollTop: ta.scrollTop,
    };
  }, id);
  const caretTo = (id, line) => page.evaluate((id, line) => {
    const ta = document.getElementById(id);
    ta.focus();
    const pos = ta.value.split('\n').slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + 1;
    ta.setSelectionRange(pos, pos);
  }, id, line);
  const ctrlWheel = async (id, deltaY, times = 1) => {
    const r = await page.evaluate((id) => { const b = document.getElementById(id).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, id);
    await page.mouse.move(r.x, r.y);
    await page.keyboard.down('Control');
    for (let i = 0; i < times; i++) { await page.mouse.wheel({ deltaY }); await sleep(60); }
    await page.keyboard.up('Control');
    await sleep(250);
  };

  await page.click('#dock-tab-method');
  await page.waitForSelector(`#${M}`);
  await sleep(500);
  // Line 31 at the top, the caret on line 35
  await caretTo(M, 35);
  await page.evaluate((id) => { const ta = document.getElementById(id); ta.scrollTop = 30 * 20; ta.dispatchEvent(new Event('scroll')); }, M);
  await sleep(200);
  let a = await info(M);
  expect(a.font === '12px' && a.lh === 20 && a.badge === null, `100% at start: ${a.font}/${a.lh}px, no badge`);
  const dpr0 = a.dpr;
  await ctrlWheel(M, -100, 3);
  a = await info(M);
  expect(a.font === '15.6px' && a.preFont === '15.6px' && a.lh === 26 && a.preLh === 26 && Math.round(a.rowH) === 26, `Ctrl+wheel up x3: text ${a.font}, lines ${a.lh}px (pre ${a.preLh}, gutter row ${a.rowH})`);
  expect(a.badge === '130%', `zoom badge: ${a.badge}`);
  expect(a.bandLine === 35 && Math.round(a.scrollTop / 26) === 30, `the caret band stays on line 35 (${a.bandLine}), line 31 stays at the top (${(a.scrollTop / 26).toFixed(1)} lines scrolled)`);
  const synced = await page.evaluate((id) => { const ta = document.getElementById(id); return [ta.scrollTop, ta.previousElementSibling.scrollTop, ta.closest('.relative.flex-1.min-h-0.flex').firstElementChild.scrollTop]; }, M);
  expect(synced[0] === synced[1] && synced[1] === synced[2], `text, highlighting and line numbers scroll together: ${synced.join(' / ')}`);
  expect(a.dpr === dpr0 && a.pageZoom === 1, `the page itself is not zoomed (dpr ${a.dpr})`);
  await page.screenshot({ path: path.join(h.OUT, 'zoom-method-130.png') });
  // A plain wheel still scrolls
  const before = a.scrollTop;
  await page.mouse.wheel({ deltaY: 200 });
  await sleep(300);
  expect((await info(M)).scrollTop > before, 'a wheel without Ctrl scrolls');
  // Out, down to the minimum
  await ctrlWheel(M, 100, 12);
  a = await info(M);
  expect(a.font === '6px' && a.badge === '50%', `Ctrl+wheel down to the minimum: ${a.font}, ${a.badge}`);
  // Keyboard: Ctrl+Shift+. in, Ctrl+0 back to 100%
  await caretTo(M, 6);
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('Period'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  await sleep(150);
  expect((await info(M)).badge === '60%', `Ctrl+Shift+. : ${(await info(M)).badge}`);
  await ctrlWheel(M, -100, 7);
  expect((await info(M)).badge === '130%', 'back to 130%');
  // The Enum Editor has the same size
  await page.click('#dock-tab-enum');
  await page.waitForSelector(`#${E}`);
  await sleep(400);
  let e = await info(E);
  expect(e.font === '15.6px' && e.badge === '130%', `the Enum Editor shares it: ${e.font}, ${e.badge}`);
  // Remembered after a reload
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
  await page.click('#dock-tab-enum');
  await page.waitForSelector(`#${E}`);
  await sleep(400);
  e = await info(E);
  expect(e.font === '15.6px', `remembered after a reload: ${e.font}`);
  // Ctrl+0: 100%, the badge goes away
  await caretTo(E, 3);
  await page.keyboard.down('Control'); await page.keyboard.press('Digit0'); await page.keyboard.up('Control');
  await sleep(1500);
  e = await info(E);
  expect(e.font === '12px' && e.badge === null, `Ctrl+0: ${e.font}, badge ${e.badge}`);
  // Clicking the badge resets too
  await ctrlWheel(E, -100, 2);
  await page.click(`#${E}-zoom`);
  await sleep(1500);
  expect((await info(E)).font === '12px', 'clicking the badge: 100%');
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  console.log(`${fails} failures`);
  await browser.close().catch(() => {});
  edge.kill();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
