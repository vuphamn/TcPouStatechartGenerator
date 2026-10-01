// Lock Layout and another chart: the start symbol and AnyState (the same ids in every chart) where the new chart's
// layout puts them, not where the previous chart had them
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
  // (each special node's place, and the other states' box: in the diagram's own coordinates)
  const where = () => p.evaluate(() => {
    const svg = document.querySelector('#mermaid-diagram-svg-container svg');
    const nodes = [...(svg?.querySelectorAll('g.node') ?? [])].map((n) => ({ id: n.getAttribute('data-state-id') || n.id, x: n.getCTM().e, y: n.getCTM().f }));
    const special = /startNode|AnyState/;
    const rest = nodes.filter((n) => !special.test(n.id));
    return {
      special: Object.fromEntries(nodes.filter((n) => special.test(n.id)).map((n) => [/startNode/.test(n.id) ? 'start' : 'any', Math.round(n.x)])),
      box: [Math.min(...rest.map((n) => n.x)), Math.max(...rest.map((n) => n.x))].map(Math.round),
    };
  });
  const SAMPLES = ['door-dasher-237', 'k-servo-supply-manager', 'table-manager-202'];
  const free = {};
  for (const s of SAMPLES) {
    await p.select('#sample-selector', s);
    await h.sleep(4000);
    free[s] = await where();
  }
  await p.click('#lock-diagram-layout-toggle-btn');
  await h.sleep(500);
  for (const s of SAMPLES) {
    await p.select('#sample-selector', s);
    await h.sleep(4000);
    const w = await where();
    const near = (a, b) => a !== undefined && b !== undefined && Math.abs(a - b) <= 30;
    expect(near(w.special.start, free[s].special.start) && (free[s].special.any === undefined || near(w.special.any, free[s].special.any)) && w.special.start >= w.box[0] - 200 && w.special.start <= w.box[1] + 200, `${s}, layout locked: the start symbol / AnyState in its own chart (${JSON.stringify(w)}; unlocked: ${JSON.stringify(free[s].special)})`);
  }
  await p.click('#lock-diagram-layout-toggle-btn');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
