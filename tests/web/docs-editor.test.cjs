// Documentation tab: the caret's line is highlighted (the whole line, wrapped rows included), and Ctrl+mouse wheel
// zooms the text (shared with the code editors), in Edit and in Preview
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const ID = 'state-documentation-textarea';

(async () => {
  const browser = await h.launchBrowser();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 60000 });
  // A state to document
  await page.evaluate(() => document.getElementById('state-list-item-TABLEMANAGER_HOMMING').click());
  await page.click('#dock-tab-docs');
  await page.waitForSelector(`#${ID}`, { timeout: 10000 });
  await h.sleep(400);

  // The footer's status text stays beside the buttons (it used to run under Export Report)
  const footer = () => page.evaluate(() => {
    const st = document.getElementById('doc-footer-status').getBoundingClientRect();
    const btn = document.getElementById('doc-footer-export-btn').getBoundingClientRect();
    const text = document.getElementById('doc-footer-status').textContent.trim();
    // Beside the buttons (left of them) or above them (a narrow panel), wide enough to read
    const clear = btn.left >= st.right - 0.5 || btn.top >= st.bottom - 0.5;
    return { clear, width: Math.round(st.width), height: Math.round(st.height), text };
  });
  let ft = await footer();
  expect(ft.clear && ft.width >= 100 && ft.height <= 22, `footer "${ft.text}": clear of Export Report, readable (${ft.width} px wide), one line (${ft.height} px)`);

  // Text with a line long enough to wrap
  const long = 'This line is long enough to wrap in the Documentation panel, because it keeps going with more words about homing the axis before the feed cycle engages.';
  await page.focus(`#${ID}`);
  await page.keyboard.type(`### Purpose\nShort line\n${long}\nLast line`);
  await h.sleep(200);
  ft = await footer();
  expect(/Unsaved/.test(ft.text) && ft.clear && ft.width >= 100 && ft.height <= 22, `footer "${ft.text}": clear of Export Report, readable (${ft.width} px wide), one line (${ft.height} px)`);
  const band = () => page.evaluate((id) => {
    const ta = document.getElementById(id);
    const b = document.getElementById(`${id}-caret-line`);
    const cs = getComputedStyle(ta);
    return b ? { top: parseFloat(b.style.top) + ta.scrollTop, height: parseFloat(b.style.height), line: parseFloat(cs.lineHeight), pad: parseFloat(cs.paddingTop), cls: b.className, font: cs.fontSize } : null;
  }, ID);
  const caretToLine = (n) => page.evaluate((id, n) => {
    const ta = document.getElementById(id);
    ta.focus();
    const pos = ta.value.split('\n').slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0) + 1;
    ta.setSelectionRange(pos, pos);
  }, ID, n);

  await caretToLine(2);
  await h.sleep(150);
  let b = await band();
  expect(b && Math.abs(b.top - (b.pad + b.line)) <= 2 && Math.abs(b.height - b.line) <= 2, `line 2: one row high at row 2 (top ${b?.top}, height ${b?.height}, row ${b?.line})`);
  expect(/bg-slate-600/.test(b?.cls ?? ''), 'bright while focused');
  await caretToLine(3);
  await h.sleep(150);
  b = await band();
  const rows = b ? Math.round(b.height / b.line) : 0;
  expect(rows >= 2 && Math.abs(b.top - (b.pad + 2 * b.line)) <= 2, `the wrapped line 3: ${rows} rows, starting at row 3`);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await h.sleep(150);
  b = await band();
  expect(b && Math.abs(b.top - (b.pad + (2 + rows) * b.line)) <= 2 && Math.abs(b.height - b.line) <= 2, `down to the last line: the band follows (top ${b?.top})`);
  // Scrolled: the band stays on the caret's line
  await page.evaluate((id) => {
    const ta = document.getElementById(id);
    ta.value && ta.setSelectionRange(0, 0);
  }, ID);
  await page.keyboard.type('x\n'.repeat(30));
  await h.sleep(200);
  const aligned = await page.evaluate((id) => {
    const ta = document.getElementById(id);
    const bd = document.getElementById(`${id}-caret-line`).getBoundingClientRect();
    const cs = getComputedStyle(ta);
    const line = ta.value.slice(0, ta.selectionStart).split('\n').length;
    const expected = ta.getBoundingClientRect().top + parseFloat(cs.paddingTop) + (line - 1) * parseFloat(cs.lineHeight) - ta.scrollTop;
    return { scrolled: ta.scrollTop > 0, diff: Math.round(bd.top - expected) };
  }, ID);
  expect(aligned.scrolled && Math.abs(aligned.diff) <= 1, `scrolled: the band stays on the caret's line (off by ${aligned.diff} px)`);
  // Blurred: dimmer
  await page.evaluate(() => document.activeElement.blur());
  await h.sleep(150);
  expect(/bg-slate-700/.test((await band())?.cls ?? ''), 'dimmer when not focused');

  // Zoom (Ctrl+wheel), shared with the code editors
  const r = await page.evaluate((id) => { const x = document.getElementById(id).getBoundingClientRect(); return { x: x.x + x.width / 2, y: x.y + x.height / 2 }; }, ID);
  await page.mouse.move(r.x, r.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel({ deltaY: -100 });
  await page.mouse.wheel({ deltaY: -100 });
  await page.keyboard.up('Control');
  await h.sleep(300);
  const z = await page.evaluate((id) => ({ font: getComputedStyle(document.getElementById(id)).fontSize, badge: document.getElementById(`${id}-zoom`)?.textContent, stored: localStorage.getItem('kss.editor.zoom'), dpr: window.devicePixelRatio }), ID);
  expect(z.font === '16.8px' && z.badge === '120%' && z.stored === '1.2' && z.dpr === 1, `Ctrl+wheel: ${z.font}, badge ${z.badge}, saved ${z.stored}, page not zoomed`);
  // Preview: zoomed too
  await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Preview')?.click());
  await page.waitForSelector('#state-documentation-preview', { timeout: 5000 });
  const pz = await page.evaluate(() => document.querySelector('#state-documentation-preview > div').style.zoom);
  expect(pz === '1.2', `Preview is zoomed too (${pz})`);
  const pr = await page.evaluate(() => { const x = document.getElementById('state-documentation-preview').getBoundingClientRect(); return { x: x.x + x.width / 2, y: x.y + x.height / 2 }; });
  await page.mouse.move(pr.x, pr.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel({ deltaY: 100 });
  await page.keyboard.up('Control');
  await h.sleep(300);
  expect((await page.evaluate(() => document.querySelector('#state-documentation-preview > div').style.zoom)) === '1.1', 'Ctrl+wheel in Preview');
  await page.click('#state-documentation-preview-zoom');
  await h.sleep(200);
  expect((await page.evaluate(() => localStorage.getItem('kss.editor.zoom'))) === '1', 'the badge resets to 100%');
  await page.screenshot({ path: h.out('docs-editor.png') });
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
