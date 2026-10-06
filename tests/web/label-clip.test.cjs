// A selected state's transitions: their labels highlighted without getting wider (bold text is wider than the text
// Mermaid sized each label's box for: the last letters were cut off, "E_EFX_CONFIG_MODE.Non"); and a label's text that
// does not quite fit its box is shown, not cut off
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
  // (each label: its text's weight and width, its box's width, whether the box cuts it off)
  const labels = (cls) =>
    p.evaluate((cls) => [...document.querySelectorAll(`#mermaid-canvas-area g.edgeLabel${cls}`)].map((g) => {
      const fo = g.querySelector('foreignObject');
      const div = fo?.querySelector('div');
      const span = div?.querySelector('span, p') ?? div;
      return {
        text: (div?.textContent ?? '').trim(),
        weight: span ? getComputedStyle(span).fontWeight : '',
        width: div ? div.scrollWidth : 0,
        box: fo ? parseFloat(fo.getAttribute('width') || '0') : 0,
        overflow: fo ? getComputedStyle(fo).overflow : '',
      };
    }).filter((l) => l.text), cls);
  const before = await labels('');
  // The state with the most transitions out, selected
  const id = await p.evaluate(() => {
    const out = {};
    for (const g of document.querySelectorAll('#mermaid-canvas-area path.tc-edge-path')) {
      const s = g.getAttribute('data-source-id');
      if (s) out[s] = (out[s] ?? 0) + 1;
    }
    return Object.entries(out).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  });
  await p.click(`#mermaid-canvas-area g.node[data-state-id="${id}"]`);
  await p.waitForSelector('#mermaid-canvas-area g.edgeLabel.diagram-outgoing-edge-label', { timeout: 5000 }).catch(() => {});
  const out = await labels('.diagram-outgoing-edge-label');
  const normal = before[0]?.weight;
  expect(out.length > 0 && out.every((l) => l.weight === normal), `${id} selected: its ${out.length} labels highlighted, not bolder (${[...new Set(out.map((l) => l.weight))].join(', ')} vs ${normal})`);
  const widths = out.map((l) => ({ text: l.text, now: l.width, was: before.find((b) => b.text === l.text)?.width }));
  expect(widths.every((w) => w.was === undefined || Math.abs(w.now - w.was) <= 1), `no wider than before: ${widths.map((w) => `${w.was}→${w.now}`).join(' ')}`);
  expect(out.every((l) => l.overflow === 'visible'), `text that does not fit is shown, not cut off (${[...new Set(out.map((l) => l.overflow))].join(', ')})`);
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
