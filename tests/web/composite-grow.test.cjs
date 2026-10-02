// Lock Layout on: a state dragged into a composite's box (it is moved into the composite in the code): drawn again,
// the state stays where it was dropped and the composite's box holds it (grown if the layout's box would not)
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
  await p.select('#sample-selector', 'k-analog-measure');
  await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="KANALOGMEASURE_DISABLED"]', { timeout: 60000 });
  await h.sleep(2500);
  await p.evaluate(() => document.querySelector('#diagram-minimap-container button[title^="Close Minimap"]')?.click());
  // (the flowchart: a drop in a composite's box moves the state into it there)
  await p.click('#format-flowchart-btn');
  await h.sleep(2500);
  await p.click('#lock-diagram-layout-toggle-btn');
  await h.sleep(800);

  const S = 'KANALOGMEASURE_DISABLED';
  const look = () => p.evaluate((s) => {
    const svg = document.querySelector('#mermaid-diagram-svg-container svg');
    const n = svg.querySelector(`g.node[data-state-id="${s}"]`);
    const c = [...svg.querySelectorAll('g.cluster, g.statediagram-cluster')].find((x) => /KAnalogMeasureEnabled/.test(x.id) || x.getAttribute('data-id') === 'KAnalogMeasureEnabled');
    const box = (e) => { const r = e?.getBoundingClientRect(); return r ? [r.left, r.top, r.right, r.bottom].map(Math.round) : null; };
    return { node: box(n?.querySelector(':scope > rect, :scope > path') ?? n), cluster: box(c?.querySelector(':scope > rect:not(.inner), :scope > g > rect.outer')) };
  }, S);
  const a = await look();
  expect(!!a.node && !!a.cluster, `${S} and the composite on screen (${JSON.stringify(a)})`);
  const inside = (n, c) => n[0] >= c[0] - 1 && n[1] >= c[1] - 1 && n[2] <= c[2] + 1 && n[3] <= c[3] + 1;
  expect(!inside(a.node, a.cluster), `${S} outside the composite at first`);
  // (dropped inside the composite's box, near its bottom-right corner, clear of its states)
  const spot = await p.evaluate((c) => {
    for (let y = c[3] - 30; y > c[1] + 30; y -= 12) {
      for (let x = c[2] - 60; x > c[0] + 60; x -= 12) {
        const e = document.elementFromPoint(x, y);
        if (e && !e.closest('g.node, g.edgeLabel, path')) return { x, y };
      }
    }
    return null;
  }, a.cluster);
  expect(!!spot, 'a free spot in the composite');
  const from = { x: (a.node[0] + a.node[2]) / 2, y: (a.node[1] + a.node[3]) / 2 };
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  for (let i = 1; i <= 16; i++) await p.mouse.move(from.x + ((spot.x - from.x) * i) / 16, from.y + ((spot.y - from.y) * i) / 16);
  await h.sleep(150);
  await p.mouse.up();
  await h.sleep(3500);
  const b = await look();
  const where = await p.evaluate(() => document.querySelector('#status-bar, footer')?.innerText.split('\n')[0].slice(0, 160));
  expect(!!b.node && Math.hypot((b.node[0] + b.node[2]) / 2 - spot.x, (b.node[1] + b.node[3]) / 2 - spot.y) < 12, `${S} where it was dropped (${JSON.stringify(b.node)} at ${JSON.stringify(spot)}; ${where})`);
  expect(!!b.node && !!b.cluster && inside(b.node, b.cluster), `the composite's box holds it (${JSON.stringify(b)})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
