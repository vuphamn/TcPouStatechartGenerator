// An edge's end handle dropped by a corner of its state (just inside the top-left): the end attaches to the side it
// is by, and the line comes in square to that side, so the arrow head touches the border (ELK and Dagre). Dragged
// away from its state, the end still follows the pointer.
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const KEY = 'TABLEMANAGER_CLAMPED->TABLEMANAGER_UNCLAMP_START';
const TARGET = 'TABLEMANAGER_UNCLAMP_START';

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });

  for (const engine of ['elk', 'dagre']) {
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
    await h.sleep(800);
    await p.click(`#layout-engine-${engine}`);
    await h.sleep(2000);
    for (let i = 0; i < 9; i++) {
      await p.click('#zoom-in-button');
      await h.sleep(120);
    }
    await p.evaluate(() => [...document.getElementById('state-list-item-TABLEMANAGER_UNCLAMP_START').querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click());
    await h.sleep(1500);
    // Select the edge, find its end handle
    const pt = await p.evaluate((key) => {
      const el = document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`);
      const len = el.getTotalLength(); const m = el.getScreenCTM();
      for (const f of [0.6, 0.7, 0.8, 0.5, 0.4, 0.3, 0.85]) {
        const q = el.getPointAtLength(len * f); const x = q.x * m.a + q.y * m.c + m.e; const y = q.x * m.b + q.y * m.d + m.f;
        if (document.elementFromPoint(x, y)?.getAttribute('data-edge-key') === key) return { x, y };
      }
      return null;
    }, KEY);
    if (!pt) {
      expect(false, `${engine}: the edge on screen`);
      continue;
    }
    await p.mouse.click(pt.x, pt.y);
    await h.sleep(700);
    const hd = await p.evaluate(() => {
      const el = [...document.querySelectorAll('#mermaid-canvas-area .tc-edge-handle[data-handle-type="end"]')].find((x) => { const q = x.getBoundingClientRect(); const e = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); return e && x.contains(e); });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!hd) {
      expect(false, `${engine}: the end handle`);
      continue;
    }
    // The target's box (its shape) and a spot just inside its top-left corner
    const box = await p.evaluate((id) => {
      const g = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`);
      const s = g.querySelector(':scope > .label-container, :scope > rect, :scope > polygon') || g;
      const r = s.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }, TARGET);
    const drop = { x: box.left + 4, y: box.top + 12 };
    await p.mouse.move(hd.x, hd.y);
    await p.mouse.down();
    const steps = 20;
    for (let i = 1; i <= steps; i++) await p.mouse.move(hd.x + ((drop.x - hd.x) * i) / steps, hd.y + ((drop.y - hd.y) * i) / steps);
    await h.sleep(200);
    await p.mouse.up();
    await h.sleep(1000);
    const end = await p.evaluate((key) => {
      const el = document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`);
      const len = el.getTotalLength(); const m = el.getScreenCTM();
      const sc = (q) => ({ x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f });
      return { end: sc(el.getPointAtLength(len)), before: sc(el.getPointAtLength(Math.max(0, len - 6))), scale: Math.hypot(m.a, m.b) };
    }, KEY);
    const tol = 9 * end.scale + 2;
    const onLeft = Math.abs(end.end.x - box.left) <= tol && end.end.y >= box.top - 1 && end.end.y <= box.bottom + 1;
    const onTop = Math.abs(end.end.y - box.top) <= tol && end.end.x >= box.left - 1 && end.end.x <= box.right + 1;
    const dx = end.end.x - end.before.x;
    const dy = end.end.y - end.before.y;
    const square = onLeft ? Math.abs(dy) < 0.6 && dx > 0 : onTop ? Math.abs(dx) < 0.6 && dy > 0 : false;
    expect(onLeft || onTop, `${engine}: the end on the ${onLeft ? 'left' : onTop ? 'top' : '?'} side (end ${Math.round(end.end.x)},${Math.round(end.end.y)}; box ${Math.round(box.left)},${Math.round(box.top)}–${Math.round(box.right)},${Math.round(box.bottom)})`);
    expect(square, `${engine}: the line comes in square to that side (last step ${dx.toFixed(1)}, ${dy.toFixed(1)})`);
    await p.screenshot({ path: h.out(`endpoint-attach-${engine}.png`), clip: { x: box.left - 120, y: box.top - 140, width: 360, height: 240 } });

    // Dragged far from its state (not released): the end follows the pointer
    const hd2 = await p.evaluate(() => {
      const el = [...document.querySelectorAll('#mermaid-canvas-area .tc-edge-handle[data-handle-type="end"]')].find((x) => { const q = x.getBoundingClientRect(); const e = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); return e && x.contains(e); });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (hd2) {
      await p.mouse.move(hd2.x, hd2.y);
      await p.mouse.down();
      const far = { x: box.left - 150, y: box.top - 60 };
      for (let i = 1; i <= steps; i++) await p.mouse.move(hd2.x + ((far.x - hd2.x) * i) / steps, hd2.y + ((far.y - hd2.y) * i) / steps);
      await h.sleep(200);
      const live = await p.evaluate((key) => {
        const el = document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`);
        const q = el.getPointAtLength(el.getTotalLength()); const m = el.getScreenCTM();
        return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f };
      }, KEY);
      expect(Math.hypot(live.x - far.x, live.y - far.y) < 30, `${engine}: far from its state, the end follows the pointer (${Math.round(Math.hypot(live.x - far.x, live.y - far.y))} px away)`);
      await p.keyboard.press('Escape');
      await p.mouse.up();
      await h.sleep(500);
    }
    // (ELK: every edge moved on the canvas still orthogonal, not only the one checked above; Dagre draws lines)
    if (engine === 'elk') {
      const slanted = await h.reroutedSlanted(p);
      expect(slanted.length === 0, `elk: the moved edges on the canvas orthogonal (${slanted.slice(0, 3).join(' | ') || 'none slanted'})`);
    }
  }
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
