// Every control of the header and of the canvas' toolbars (its options, its overflow menus) has a tooltip: its own
// title or its label's (the Help button: its own card on hover)
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(1500);
  // (the controls without a tooltip, in the visible part of a root)
  const missing = (roots, maxTop) => p.evaluate((roots, maxTop) => {
    const out = [];
    for (const sel of roots) {
      const root = sel === 'header' ? document.querySelector('header') ?? document.body.firstElementChild : document.querySelector(sel);
      if (!root) continue;
      for (const el of root.querySelectorAll('button, input, select, [role="button"]')) {
        if (el.id === 'help-btn' || el.closest('#mermaid-canvas-area svg, #diagram-minimap-container')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || (maxTop && r.top > maxTop)) continue;
        if (!(el.getAttribute('title') || el.closest('label')?.getAttribute('title'))) out.push(`${el.tagName.toLowerCase()}#${el.id || '-'} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`);
      }
    }
    return [...new Set(out)];
  }, roots, maxTop);
  const bars = await missing(['header', '#mermaid-toolbar', '#options-ribbon'], 240);
  expect(bars.length === 0, `the header and the canvas' toolbars: every control has a tooltip (${bars.join(', ') || 'all'})`);
  for (const [btn, menu, what] of [['#header-hidden-controls-btn', '#header-hidden-controls-menu', 'the header\'s'], ['#toolbar-hidden-controls-btn', '#toolbar-hidden-controls-menu', 'the canvas toolbar\'s']]) {
    const open = await p.$(btn);
    if (!open) continue;
    await open.click();
    await h.sleep(400);
    const m = await missing([menu], 0);
    expect(m.length === 0, `${what} overflow menu: every item has a tooltip (${m.join(', ') || 'all'})`);
    await p.keyboard.press('Escape');
    await p.mouse.click(5, 990);
    await h.sleep(300);
  }

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
