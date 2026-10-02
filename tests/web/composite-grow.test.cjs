// Lock Layout on, the flowchart and the state diagram: a state dragged into a composite's box is moved into the
// composite in the code; drawn again, it stays where it was dropped and the composite's box holds it (grown if the
// layout's box would not). Dragged out again: out of the composite, where it was dropped
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  // (leaving with the edits unsaved: yes)
  p.on('dialog', (d) => void d.accept().catch(() => {}));
  const S = 'KANALOGMEASURE_DISABLED';
  const C = 'KAnalogMeasureEnabled';
  const look = () => p.evaluate((s, c) => {
    const svg = document.querySelector('#mermaid-diagram-svg-container svg');
    const n = svg.querySelector(`g.node[data-state-id="${s}"]`);
    const g = [...svg.querySelectorAll('g.cluster, g.statediagram-cluster')].find((x) => new RegExp(c).test(x.id) || x.getAttribute('data-id') === c);
    const box = (e) => { const r = e?.getBoundingClientRect(); return r ? [r.left, r.top, r.right, r.bottom].map(Math.round) : null; };
    return { node: box(n?.querySelector(':scope > rect, :scope > path') ?? n), cluster: box(g?.querySelector(':scope > rect:not(.inner), :scope > g > rect.outer')) };
  }, S, C);
  const inside = (n, c) => n[0] >= c[0] - 1 && n[1] >= c[1] - 1 && n[2] <= c[2] + 1 && n[3] <= c[3] + 1;
  const status = () => p.evaluate(() => document.querySelector('#status-bar, footer')?.innerText.split('\n')[0].slice(0, 160) ?? '');
  const drag = async (from, to) => {
    await p.mouse.move(from.x, from.y);
    await p.mouse.down();
    for (let i = 1; i <= 16; i++) await p.mouse.move(from.x + ((to.x - from.x) * i) / 16, from.y + ((to.y - from.y) * i) / 16);
    await h.sleep(150);
    await p.mouse.up();
    await h.sleep(3500);
  };
  const centre = (b) => ({ x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 });

  for (const [view, btn] of [['flowchart', '#format-flowchart-btn'], ['state diagram', '#format-statediagram-btn']]) {
    await p.goto(h.APP_URL, { waitUntil: 'load' });
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
    await p.select('#sample-selector', 'k-analog-measure');
    await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${S}"]`, { timeout: 60000 });
    await h.sleep(2000);
    await p.click(btn);
    await h.sleep(2500);
    await p.evaluate(() => document.querySelector('#diagram-minimap-container button[title^="Close Minimap"]')?.click());
    await p.click('#lock-diagram-layout-toggle-btn');
    await h.sleep(800);

    const a = await look();
    expect(!!a.node && !!a.cluster && !inside(a.node, a.cluster), `${view}: ${S} outside ${C} at first (${JSON.stringify(a)})`);
    if (!a.node || !a.cluster) continue;
    // 1. Into it: dropped near its bottom-right corner, clear of its states
    const spot = await p.evaluate((c) => {
      for (let y = c[3] - 30; y > c[1] + 30; y -= 12) {
        for (let x = c[2] - 60; x > c[0] + 60; x -= 12) {
          const e = document.elementFromPoint(x, y);
          if (e && !e.closest('g.node, g.edgeLabel, path')) return { x, y };
        }
      }
      return null;
    }, a.cluster);
    expect(!!spot, `${view}: a free spot in ${C}`);
    if (!spot) continue;
    await drag(centre(a.node), spot);
    const b = await look();
    const msg = await status();
    expect(new RegExp(`${S} is in ${C}`).test(msg), `${view}: moved into ${C} (${msg})`);
    expect(!!b.node && Math.hypot(centre(b.node).x - spot.x, centre(b.node).y - spot.y) < 12, `${view}: ${S} where it was dropped (${JSON.stringify(b.node)} at ${JSON.stringify(spot)})`);
    expect(!!b.node && !!b.cluster && inside(b.node, b.cluster), `${view}: ${C}'s box holds it (${JSON.stringify(b)})`);
    // 2. Out of it again: dropped on a free spot left of the composite
    const out = await p.evaluate((c) => {
      for (let x = c[0] - 160; x > 300; x -= 20) {
        for (let y = c[1] + 20; y < c[3] + 200; y += 20) {
          const e = document.elementFromPoint(x, y);
          if (e && e.closest('#mermaid-canvas-area') && !e.closest('g.node, g.edgeLabel, path, g.cluster, g.statediagram-cluster')) return { x, y };
        }
      }
      return null;
    }, b.cluster);
    expect(!!out, `${view}: a free spot outside ${C}`);
    if (!out) continue;
    await drag(centre(b.node), out);
    const c = await look();
    const msg2 = await status();
    expect(new RegExp(`${S} is in no composite`).test(msg2), `${view}: moved out of ${C} (${msg2})`);
    expect(!!c.node && Math.hypot(centre(c.node).x - out.x, centre(c.node).y - out.y) < 12 && !inside(c.node, c.cluster), `${view}: ${S} where it was dropped, outside ${C} (${JSON.stringify(c)} at ${JSON.stringify(out)})`);
  }

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
