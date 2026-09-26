const h = require('../lib/harness.cjs');
// Problems tab: "Open code" shows the Method Editor at the finding's line, highlighted
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
  await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
  await sleep(500);

  const impl = () => page.evaluate(() => {
    const ta = document.querySelector('textarea#method-implementation-editor') || [...document.querySelectorAll('textarea')].find((t) => t.getAttribute('aria-label') === 'method-implementation-editor' || t.id === 'method-implementation-editor');
    const visible = [...document.querySelectorAll('textarea')].filter((t) => t.getBoundingClientRect().width > 0).find((t) => /implementation/i.test(t.id + (t.getAttribute('aria-label') || '')));
    const t = ta && ta.getBoundingClientRect().width > 0 ? ta : visible;
    if (!t) return null;
    let root = t.parentElement;
    while (root && !root.querySelector('div.st-gutter-row')) root = root.parentElement;
    const hl = root ? [...root.querySelectorAll('div.st-gutter-row')].find((d) => /bg-sky-500\/30/.test(d.className)) : null;
    const hlLine = hl ? parseInt(hl.innerText.replace(/\D+/g, ''), 10) : null;
    // The highlighted row on screen, inside the editor's visible box (the gutter scrolls with the text)
    const box = t.getBoundingClientRect();
    const r = hl ? hl.getBoundingClientRect() : null;
    const inView = !!r && r.top >= box.top - 1 && r.bottom <= box.bottom + 1 && r.bottom <= window.innerHeight;
    return { scrollTop: Math.round(t.scrollTop), hlLine, inView, rowY: r ? Math.round(r.top) : null, box: [Math.round(box.top), Math.round(box.bottom)], method: document.getElementById('method-selector-combobox')?.value.replace(/\(\)$/, '') };
  });
  const openCode = () => page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Open code/.test(b.textContent))?.click());
  const title = async () => page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Open code/.test(b.textContent))?.title);

  await page.click('#dock-tab-problems');
  await sleep(500);
  const t = await title();
  const line = Number(t?.match(/line (\d+)/)?.[1]);
  console.log('   finding:', t);

  // 1. The first click (the Method Editor was never shown)
  await openCode();
  await sleep(1200);
  let s = await impl();
  console.log('   ', JSON.stringify(s));
  expect(s && s.hlLine === line && s.inView && s.scrollTop > 0, `Open code: line ${line} highlighted and in view`);
  await page.screenshot({ path: path.join(h.OUT, 'opencode.png'), clip: { x: 0, y: 40, width: 1100, height: 700 } });

  // 2. Scrolled away, a second click jumps again
  await page.evaluate(() => { const ta = [...document.querySelectorAll('textarea')].find((t) => t.getBoundingClientRect().width > 0 && /implementation/i.test(t.id + (t.getAttribute('aria-label') || ''))); ta.scrollTop = 0; ta.dispatchEvent(new Event('scroll')); });
  await sleep(3200);
  await page.click('#dock-tab-problems');
  await sleep(300);
  await openCode();
  await sleep(1200);
  s = await impl();
  console.log('   ', JSON.stringify(s)); expect(s && s.hlLine === line && s.inView, 'a second click jumps again');

  // 3. Another method shown first: it switches back to doState and goes to the line
  const switched = await page.evaluate(() => {
    const sel = document.getElementById('method-selector-combobox');
    if (!sel) return false;
    const opt = [...sel.options].find((o) => /preProcess/.test(o.textContent));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, opt.value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  await sleep(600);
  const other = (await impl())?.method;
  await page.click('#dock-tab-problems');
  await sleep(300);
  await openCode();
  await sleep(1400);
  s = await impl();
  expect(switched && other === 'preProcess' && s && s.method === 'doState' && s.hlLine === line && s.inView, `from ${other}(): back to doState(), line ${s?.hlLine}`);

  // 4. The line inside folded code: unfolded
  await sleep(3200);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Fold All/.test(b.textContent))?.click());
  await sleep(500);
  await page.click('#dock-tab-problems');
  await sleep(300);
  await openCode();
  await sleep(1400);
  s = await impl();
  expect(s && s.hlLine === line && s.inView, `folded: unfolded and line ${s?.hlLine} highlighted`);

  console.log('page errors:', errors.slice(0, 5));
  await browser.close().catch(() => {});
  edge.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
