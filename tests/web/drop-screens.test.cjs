// Screenshot comparisons of drops (tests/lib/screens.cjs: against tests/baselines; not compared on CI): a transition's
// start dropped on another state, zoomed in on it: after the drop (its new route, the others as they were) and after
// its Ctrl+Z. Table Manager (flowchart) and K-Power-Supply (state diagram), dark theme
const h = require('../lib/harness.cjs');
const { compareShot } = require('../lib/screens.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const CASES = [
  { name: 'drop-table-manager', sample: 'table-manager-202', format: '#format-flowchart-btn', from: 'TABLEMANAGER_AUTOFEED_WAIT_FOR_DATA', badge: '2', onto: 'TABLEMANAGER_AUTOFEED_FEED_OUT', zoom: 4 },
  { name: 'drop-power-supply', sample: 'k-power-supply-ax86x0', format: '#format-statediagram-btn', from: 'ENABLED', badge: '1', onto: 'DISABLED', zoom: 1 },
];

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => void d.accept().catch(() => {}));
  for (const c of CASES) {
    await p.goto(h.APP_URL, { waitUntil: 'load' });
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
    await p.select('#sample-selector', c.sample);
    await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${c.from}"]`, { timeout: 60000 });
    await h.sleep(1500);
    await p.click(c.format);
    await h.sleep(2500);
    // (no caret blinking, no animation, no minimap, palette or chip over the chart)
    await p.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; caret-color: transparent !important; } #diagram-minimap-container, #diagram-minimap-collapsed, #statechart-palette, #statechart-palette-expand, #layout-kept-chip { visibility: hidden !important; }' });
    await p.evaluate((s) => document.getElementById(`btn-goto-state-${s}`)?.click(), c.from);
    await h.sleep(1500);
    for (let i = 0; i < c.zoom; i++) { await p.click('#zoom-in-button').catch(() => {}); await h.sleep(300); }
    await p.evaluate((s) => document.getElementById(`btn-goto-state-${s}`)?.click(), c.from);
    await h.sleep(1800);
    await p.mouse.click(5, 5);
    await p.mouse.move(2, 998);
    await h.sleep(600);

    // Its transition with that badge: grabbed, its start handle dragged onto the other state
    const t = await p.evaluate((f, badge) => {
      const svg = document.querySelector('#mermaid-diagram-svg-container svg');
      const b = [...svg.querySelectorAll('.tc-priority-badge')].find((x) => x.textContent.trim() === badge && svg.querySelector(`path.tc-edge-path[data-path-id="${x.getAttribute('data-path-id')}"]`)?.getAttribute('data-source-id') === f);
      const path = b && svg.querySelector(`path.tc-edge-path[data-path-id="${b.getAttribute('data-path-id')}"]`);
      if (!path) return null;
      const L = path.getTotalLength();
      for (const k of [0.5, 0.4, 0.6, 0.3, 0.7]) {
        const q = path.getPointAtLength(L * k).matrixTransform(path.getScreenCTM());
        const e = document.elementFromPoint(q.x, q.y);
        if (e && (e === path || e.classList.contains('tc-edge-hitbox'))) return { x: q.x, y: q.y, to: path.getAttribute('data-target-id') };
      }
      return null;
    }, c.from, c.badge);
    expect(!!t, `${c.name}: ${c.from}'s transition ${c.badge} on screen`);
    if (!t) continue;
    await p.mouse.click(t.x, t.y);
    await h.sleep(700);
    const hd = await p.evaluate(() => { const x = document.querySelector('#mermaid-canvas-area .tc-edge-handle[data-handle-type="start"]'); const q = x?.getBoundingClientRect(); return q ? { x: q.x + q.width / 2, y: q.y + q.height / 2 } : null; });
    const tg = await p.evaluate((s) => { const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${s}"]`); const q = n?.getBoundingClientRect(); return q ? { x: q.x + q.width / 2, y: q.y + q.height / 2 } : null; }, c.onto);
    expect(!!hd && !!tg, `${c.name}: its start handle, and ${c.onto} to drop it on`);
    if (!hd || !tg) continue;
    await p.mouse.move(hd.x, hd.y);
    await p.mouse.down();
    for (let i = 1; i <= 16; i++) await p.mouse.move(hd.x + ((tg.x - hd.x) * i) / 16, hd.y + ((tg.y - hd.y) * i) / 16);
    await h.sleep(150);
    await p.mouse.up();
    await h.sleep(3000);
    await p.keyboard.press('Escape');
    await p.mouse.move(2, 998);
    await h.sleep(800);

    // The view: the moved transition and its states, with a margin, inside the canvas
    const clip = await p.evaluate((from, onto, to) => {
      const svg = document.querySelector('#mermaid-diagram-svg-container svg');
      const area = document.getElementById('mermaid-canvas-area').getBoundingClientRect();
      const rs = [...svg.querySelectorAll('g.edgePaths path.tc-edge-path')].filter((x) => x.getAttribute('data-source-id') === onto && x.getAttribute('data-target-id') === to).map((x) => x.getBoundingClientRect());
      for (const id of [from, onto, to]) { const n = svg.querySelector(`g.node[data-state-id="${id}"]`); if (n) rs.push(n.getBoundingClientRect()); }
      if (!rs.length) return null;
      const m = 40;
      const x0 = Math.max(area.left, Math.min(...rs.map((r) => r.left)) - m);
      const y0 = Math.max(area.top, Math.min(...rs.map((r) => r.top)) - m);
      const x1 = Math.min(area.right, Math.max(...rs.map((r) => r.right)) + m);
      const y1 = Math.min(area.bottom, Math.max(...rs.map((r) => r.bottom)) + m);
      return { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
    }, c.from, c.onto, t.to);
    expect(!!clip && clip.width > 40 && clip.height > 40, `${c.name}: the moved transition on screen (${JSON.stringify(clip)})`);
    if (!clip) continue;
    const shot = async (name) => {
      const r = await compareShot(browser, name, Buffer.from(await p.screenshot({ clip, type: 'png' })));
      console.log(`   ${r.note}`);
      expect(r.status !== 'differs', `${name}: ${r.status}`);
    };
    await shot(`${c.name}-after`);
    // Ctrl+Z: as it was
    await p.click('#mermaid-canvas-area', { offset: { x: 5, y: 5 } }).catch(() => {});
    await p.keyboard.down('Control'); await p.keyboard.press('KeyZ'); await p.keyboard.up('Control');
    await h.sleep(3000);
    await p.mouse.move(2, 998);
    await h.sleep(600);
    await shot(`${c.name}-undone`);
  }
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
