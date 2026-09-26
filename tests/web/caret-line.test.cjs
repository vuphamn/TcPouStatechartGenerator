const h = require('../lib/harness.cjs');
// Method Editor and Enum Editor: the caret's line is highlighted (band + line number), dimmer when not focused
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

  // The band's line (from its top) and the gutter row marked as the caret line, for an editor
  const state = (id) => page.evaluate((id) => {
    const band = document.getElementById(`${id}-caret-line`);
    const ta = document.getElementById(id);
    if (!band || !ta) return null;
    const gutterRow = ta.closest('.relative.flex-1.min-h-0.flex')?.querySelector('[data-caret-line]');
    const line = Math.round((parseFloat(band.style.top) - 8 + ta.scrollTop) / 20) + 1;
    return { line, cls: band.className, gutter: gutterRow?.getAttribute('data-caret-line'), gutterNumber: gutterRow?.textContent.trim(), bg: getComputedStyle(band).backgroundColor };
  }, id);
  const caretTo = (id, line) => page.evaluate((id, line) => {
    const ta = document.getElementById(id);
    ta.focus();
    const lines = ta.value.split('\n');
    const pos = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + 1;
    ta.setSelectionRange(pos, pos);
  }, id, line);

  for (const [tab, id] of [['method', 'method-implementation-editor'], ['enum', 'st-dut-editor']]) {
    await page.click(`#dock-tab-${tab}`);
    await page.waitForSelector(`#${id}`, { timeout: 10000 });
    await sleep(500);
    expect((await state(id)) === null, `${tab}: no band before the editor has the caret`);
    await caretTo(id, 5);
    await sleep(200);
    let s = await state(id);
    expect(s?.line === 5 && s.gutter === 'focused' && s.gutterNumber === '5' && /bg-slate-600/.test(s.cls), `${tab}: caret on line 5: band on ${s?.line}, gutter ${s?.gutterNumber} (${s?.gutter}), ${s?.bg}`);
    // Keyboard moves
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await sleep(150);
    s = await state(id);
    expect(s?.line === 7 && s.gutterNumber === '7', `${tab}: two lines down: ${s?.line}`);
    // A click on another line (from the top: the Method Editor may have scrolled to the state)
    await page.evaluate((id) => { const ta = document.getElementById(id); ta.scrollTop = 0; ta.dispatchEvent(new Event('scroll')); }, id);
    await sleep(150);
    const box = await page.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x + 60, y: r.y + 8 + 2 * 20 + 10 }; }, id);
    await page.mouse.click(box.x, box.y);
    await sleep(150);
    s = await state(id);
    expect(s?.line === 3, `${tab}: click on line 3: ${s?.line}`);
    // Enter adds a line: the band follows
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await sleep(200);
    s = await state(id);
    expect(s?.line === 4, `${tab}: after Enter: ${s?.line}`);
    await page.keyboard.press('Backspace');
    await sleep(150);
    // Scrolled: the band stays on its line
    await caretTo(id, 40);
    await page.evaluate((id) => { document.getElementById(id).scrollTop = 300; document.getElementById(id).dispatchEvent(new Event('scroll')); }, id);
    await sleep(200);
    s = await state(id);
    expect(s?.line === 40, `${tab}: scrolled, caret on 40: band on ${s?.line}`);
    await page.screenshot({ path: path.join(h.OUT, `caret-${tab}.png`) });
    // Focus elsewhere: dimmer, still shown
    await page.click('#dock-tab-diagram').catch(() => {});
    await page.click(`#dock-tab-${tab}`);
    await page.evaluate(() => document.activeElement?.blur());
    await sleep(200);
    s = await state(id);
    expect(s && s.gutter === 'blurred' && /bg-slate-700/.test(s.cls), `${tab}: not focused: dimmer (${s?.gutter})`);
  }
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  console.log(`${fails} failures`);
  await browser.close().catch(() => {});
  edge.kill();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
