// Screenshot comparisons of key views (tests/lib/screens.cjs: against tests/baselines; not compared on CI): the whole
// chart, a composite (its sand box, title, the badges of its edges), a selected transition (its line and amber
// badge) and the guard popup (a composite's collapsed edge: its list). KPowerSupply, dark theme, flowchart. Then the
// chart in a light theme (default), the Method Editor's caret line with the uses of the word at the caret (their
// contrast), and the Diff popup (its toolbar, the lines put in)
const h = require('../lib/harness.cjs');
const { compareShot } = require('../lib/screens.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await p.select('#sample-selector', 'k-power-supply-ax86x0');
  await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="RESET"]', { timeout: 60000 });
  if (await p.$eval('#collapse-errors-checkbox', (e) => !e.checked)) await p.click('#collapse-errors-checkbox');
  await h.sleep(2500);
  // (no caret blinking, no animation, no minimap over the chart in the shots)
  await p.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; caret-color: transparent !important; } #diagram-minimap-container, #diagram-minimap-collapsed { visibility: hidden !important; }' });
  const rest = async () => { await p.mouse.move(2, 998); await h.sleep(600); };
  await rest();

  // A box around elements (their union, a margin), inside the canvas
  const clipOf = (selectors, margin) => p.evaluate((selectors, margin) => {
    const area = document.getElementById('mermaid-canvas-area').getBoundingClientRect();
    const rs = selectors.flatMap((s) => [...document.querySelectorAll(s)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0));
    if (!rs.length) return null;
    const x0 = Math.max(area.left, Math.min(...rs.map((r) => r.left)) - margin);
    const y0 = Math.max(area.top, Math.min(...rs.map((r) => r.top)) - margin);
    const x1 = Math.min(area.right, Math.max(...rs.map((r) => r.right)) + margin);
    const y1 = Math.min(area.bottom, Math.max(...rs.map((r) => r.bottom)) + margin);
    return { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
  }, selectors, margin);
  const shot = async (name, clip) => {
    expect(!!clip && clip.width > 20 && clip.height > 20, `${name}: on screen ${clip ? `(${clip.width}x${clip.height})` : ''}`);
    if (!clip) return;
    const png = Buffer.from(await p.screenshot({ clip, type: 'png' }));
    const r = await compareShot(browser, name, png);
    console.log(`   ${r.note}`);
    expect(r.status !== 'differs', `${name}: ${r.status}`);
  };

  await shot('chart', await clipOf(['#mermaid-canvas-area svg g.node', '#mermaid-canvas-area svg g.cluster', '#mermaid-canvas-area svg g.edgeLabel'], 24));
  await shot('composite', await clipOf(['#mermaid-canvas-area svg g.cluster'], 16));

  // A transition selected: its line and its badge (amber)
  const pt = await p.evaluate(() => {
    const badge = document.querySelector('#mermaid-canvas-area .tc-priority-badge[data-path-id]');
    const el = badge && document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-path-id="${CSS.escape(badge.getAttribute('data-path-id'))}"]`);
    if (!el) return null;
    const len = el.getTotalLength(); const m = el.getScreenCTM();
    for (const f of [0.5, 0.6, 0.4, 0.7, 0.3]) {
      const q = el.getPointAtLength(len * f); const x = q.x * m.a + q.y * m.c + m.e; const y = q.x * m.b + q.y * m.d + m.f;
      if (document.elementFromPoint(x, y)?.closest('path')?.getAttribute('data-path-id') === el.getAttribute('data-path-id')) return { x, y, id: el.getAttribute('data-path-id') };
    }
    return null;
  });
  expect(!!pt, 'a transition with a badge to select');
  if (pt) {
    await p.mouse.click(pt.x, pt.y);
    await rest();
    const key = `[data-path-id="${pt.id}"]`;
    await shot('selection', await clipOf([`#mermaid-canvas-area path.tc-edge-path${key}`, `#mermaid-canvas-area .tc-priority-badge${key}`], 16));
    await p.keyboard.press('Escape');
    await rest();
  }

  // The guard popup of the composite's collapsed edge (its transitions listed)
  const l = await p.evaluate(() => {
    const el = [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].find((x) => x.getAttribute('data-from') === 'KPowerSupplyEnabled' && x.getAttribute('data-to') === 'ERROR' && x.getBoundingClientRect().width > 0);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  expect(!!l, 'the collapsed edge\'s label');
  if (l) {
    await p.mouse.move(l.x, l.y, { steps: 3 });
    // (shown: placed, and its list there; a busy machine takes longer)
    await p.waitForFunction(() => { const el = document.getElementById('edge-guard-condition-hover-badge'); return !!el && getComputedStyle(el).visibility === 'visible' && !!el.querySelector('#guard-popup-members'); }, { timeout: 8000 }).catch(() => {});
    await h.sleep(500);
    await shot('guard-popup', await p.evaluate(() => {
      const r = document.getElementById('edge-guard-condition-hover-badge')?.getBoundingClientRect();
      return r ? { x: Math.round(r.x - 4), y: Math.round(r.y - 4), width: Math.round(r.width + 8), height: Math.round(r.height + 8) } : null;
    }));
  }

  // The chart in a light theme
  await p.select('#mermaid-theme-select', 'default');
  await h.sleep(2500);
  await rest();
  await shot('chart-light', await clipOf(['#mermaid-canvas-area svg g.node', '#mermaid-canvas-area svg g.cluster', '#mermaid-canvas-area svg g.edgeLabel'], 24));
  await p.select('#mermaid-theme-select', 'dark');
  await h.sleep(1500);

  // The Method Editor: the caret's line, on a name used again (its uses framed)
  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-implementation-editor', { timeout: 10000 });
  await h.sleep(800);
  const band = await p.evaluate(() => {
    const ta = document.getElementById('method-implementation-editor');
    // (the state variable of its CASE, on the CASE line's next use)
    const v = ta.value.match(/CASE\s*\(?\s*([A-Za-z_]\w*)/)?.[1];
    if (!v) return null;
    const at = ta.value.indexOf(v, ta.value.indexOf(v) + v.length);
    ta.focus();
    ta.setSelectionRange(at + 2, at + 2);
    ta.dispatchEvent(new Event('select'));
    ta.scrollTop = 0;
    ta.dispatchEvent(new Event('scroll'));
    return v;
  });
  await h.sleep(600);
  expect(!!band, `a name used again at the caret (${band})`);
  await shot('editor-caret', await p.evaluate(() => {
    const b = document.getElementById('method-implementation-editor-caret-line')?.getBoundingClientRect();
    return b ? { x: Math.round(Math.max(0, b.x - 50)), y: Math.round(b.y - 60), width: 700, height: Math.round(b.height + 120) } : null;
  }));

  // The Diff popup: two lines put in
  await p.evaluate(() => {
    const ta = document.getElementById('method-implementation-editor');
    ta.focus();
    ta.setSelectionRange(0, 0);
    document.execCommand('insertText', false, '// first\n');
  });
  await h.sleep(300);
  await p.click('#method-diff-btn');
  await p.waitForSelector('#diff-dialog', { timeout: 3000 }).catch(() => {});
  await rest();
  await shot('diff-dialog', await p.evaluate(() => {
    const r = document.getElementById('diff-dialog')?.getBoundingClientRect();
    return r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null;
  }));
  await p.keyboard.press('Escape');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
