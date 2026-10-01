// Dagre: a state dragged keeps its edges apart (each end where it was on the state, or on the side facing the other
// end: not all at one point of its border); a choice dragged keeps its edges on its diamond (not on its box)
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
  await p.addStyleTag({ content: '#diagram-minimap-container, #diagram-minimap-collapsed { visibility: hidden !important; }' });
  await p.click('#layout-engine-dagre');
  await h.sleep(2500);
  if (await p.$eval('#choice-nodes-checkbox', (e) => !e.checked)) await p.click('#choice-nodes-checkbox');
  await h.sleep(2500);
  for (let i = 0; i < 3; i++) { await p.click('#zoom-in-button'); await h.sleep(150); }

  // A node's box and the ends of its edges on the screen
  const ends = (id) => p.evaluate((id) => {
    const svg = document.querySelector('#mermaid-diagram-svg-container svg');
    const node = svg.querySelector(`g.node[data-state-id="${id}"]`);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    const pts = [];
    for (const path of svg.querySelectorAll('path.tc-edge-path')) {
      const s = path.getAttribute('data-source-id');
      const t = path.getAttribute('data-target-id');
      if (s !== id && t !== id) continue;
      const m = path.getScreenCTM();
      const at = (len) => { const q = path.getPointAtLength(len); return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f }; };
      if (s === id) pts.push(at(0));
      if (t === id) pts.push(at(path.getTotalLength()));
    }
    return { box: { l: r.left, t: r.top, r: r.right, b: r.bottom, cx: r.x + r.width / 2, cy: r.y + r.height / 2, hw: r.width / 2, hh: r.height / 2 }, pts };
  }, id);
  const drag = async (id, dx, dy) => {
    await p.evaluate((s) => [...(document.getElementById(`state-list-item-${s}`)?.querySelectorAll('button') ?? [])].find((b) => /Go to State/.test(b.textContent))?.click(), id);
    await h.sleep(1200);
    const e = await ends(id);
    if (!e) return null;
    await p.mouse.move(e.box.cx, e.box.cy);
    await p.mouse.down();
    for (let i = 1; i <= 15; i++) await p.mouse.move(e.box.cx + (dx * i) / 15, e.box.cy + (dy * i) / 15);
    await p.mouse.up();
    await h.sleep(1500);
    return ends(id);
  };

  // The state with the most edges
  const busy = await p.evaluate(() => {
    const n = new Map();
    for (const path of document.querySelectorAll('#mermaid-diagram-svg-container path.tc-edge-path')) for (const k of [path.getAttribute('data-source-id'), path.getAttribute('data-target-id')]) if (k && !/^choice_/.test(k)) n.set(k, (n.get(k) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
  });
  // (the pairs of ends on top of each other, relative to the state: as Dagre laid them out, and after the drag)
  const together = (e) => {
    let n = 0;
    for (let i = 0; i < e.pts.length; i++) for (let j = i + 1; j < e.pts.length; j++) if (Math.hypot(e.pts[i].x - e.pts[j].x, e.pts[i].y - e.pts[j].y) < 2) n++;
    return n;
  };
  await p.evaluate((s) => [...(document.getElementById(`state-list-item-${s}`)?.querySelectorAll('button') ?? [])].find((b) => /Go to State/.test(b.textContent))?.click(), busy);
  await h.sleep(1200);
  const before = await ends(busy);
  const moved = await drag(busy, 120, 60);
  expect(!!moved && moved.pts.length >= 4, `${busy} dragged, ${moved?.pts.length} edge ends`);
  if (moved && before) {
    const off = moved.pts.filter((q) => q.x < moved.box.l - 12 || q.x > moved.box.r + 12 || q.y < moved.box.t - 12 || q.y > moved.box.b + 12).length;
    expect(together(moved) <= together(before), `its edges kept apart as laid out, not brought to one point (${together(moved)} pairs together; ${together(before)} as laid out)`);
    // (each where it was on the state: moved with it)
    const kept = moved.pts.filter((q, i) => before.pts[i] && Math.hypot(q.x - moved.box.cx - (before.pts[i].x - before.box.cx), q.y - moved.box.cy - (before.pts[i].y - before.box.cy)) < 4).length;
    expect(kept >= moved.pts.length - 2, `each end where it was on the state (${kept} of ${moved.pts.length})`);
    expect(off === 0, `each on its border (${off} away from it)`);
  }

  // A choice dragged: its edges on the diamond
  const choice = await p.evaluate(() => document.querySelector('#mermaid-diagram-svg-container g.node[data-state-id^="choice_"]')?.getAttribute('data-state-id'));
  expect(!!choice, `a choice (${choice})`);
  if (choice) {
    const e0 = await ends(choice);
    await p.mouse.move(e0.box.cx, e0.box.cy);
    await p.mouse.down();
    for (let i = 1; i <= 15; i++) await p.mouse.move(e0.box.cx - (90 * i) / 15, e0.box.cy + (30 * i) / 15);
    await p.mouse.up();
    await h.sleep(1500);
    const e = await ends(choice);
    // (the diamond's border: |x / hw| + |y / hh| = 1, a little off for the arrowheads)
    const onDiamond = e.pts.map((q) => Math.abs((q.x - e.box.cx) / e.box.hw) + Math.abs((q.y - e.box.cy) / e.box.hh));
    expect(e.pts.length >= 2 && onDiamond.every((v) => v > 0.8 && v < 1.35), `the choice dragged: its ${e.pts.length} edges end on its diamond (${onDiamond.map((v) => v.toFixed(2)).join(', ')})`);
  }

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
