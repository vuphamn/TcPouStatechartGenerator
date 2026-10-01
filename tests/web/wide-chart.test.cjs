// A chart wider than the canvas (Table Manager): drawn scaled as one to fit it (its box as wide and as tall as its
// drawing, not a narrow tall box with the drawing tiny in its middle); the zoom shows its real size (not 100%); a
// state dropped beside the chart's box is drawn where it was dropped, and can be clicked
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const MIME = 'application/x-kss-statechart-element';

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(2000);
  await p.addStyleTag({ content: '#diagram-minimap-container, #diagram-minimap-collapsed { visibility: hidden !important; }' });

  const box = await p.evaluate(() => {
    const s = document.querySelector('#mermaid-diagram-svg-container svg');
    const r = s.getBoundingClientRect();
    const a = document.getElementById('mermaid-canvas-area').getBoundingClientRect();
    const vb = s.viewBox.baseVal;
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, vbw: vb.width, vbh: vb.height, area: { l: a.left, t: a.top, r: a.right, b: a.bottom }, label: document.getElementById('mermaid-toolbar')?.innerText.match(/(\d+)%/)?.[1] };
  });
  const ratio = box.w / box.h;
  const vbRatio = box.vbw / box.vbh;
  expect(box.vbw > box.area.r - box.area.l, `a chart wider than the canvas (${Math.round(box.vbw)} px, the canvas ${Math.round(box.area.r - box.area.l)})`);
  expect(Math.abs(ratio - vbRatio) / vbRatio < 0.02, `drawn scaled as one: its box ${Math.round(box.w)}×${Math.round(box.h)}, its drawing ${Math.round(box.vbw)}×${Math.round(box.vbh)}`);
  const real = Math.round((box.w / box.vbw) * 100);
  expect(Number(box.label) === real && real < 100, `the zoom shows its real size: ${box.label}% (${real}%)`);

  // The zoom shown clicked: the chart at its own size (100%); again: fitted
  const label = () => p.$eval('#zoom-label-button', (e) => e.textContent.trim()).catch(() => '');
  await p.click('#zoom-label-button');
  await h.sleep(500);
  const own = await label();
  await p.click('#zoom-label-button');
  await h.sleep(500);
  const back = await label();
  expect(own === '100%' && back === `${real}%`, `the zoom clicked: its own size (${own}), again: fitted (${back})`);

  // A state dropped beside the chart's box (below it, in the canvas)
  const at = { x: Math.round((box.l + box.r) / 2), y: Math.round(Math.min(box.b + 90, box.area.b - 40)) };
  expect(at.y > box.b + 20, `a point beside the chart's box (${at.x}, ${at.y}; its box ends at ${Math.round(box.b)})`);
  await p.evaluate((x, y, MIME) => {
    const dt = new DataTransfer();
    dt.setData(MIME, 'state');
    const el = document.elementFromPoint(x, y);
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
  }, at.x, at.y, MIME);
  await p.waitForSelector('#text-prompt-input', { timeout: 5000 }).catch(() => {});
  const name = await p.$eval('#text-prompt-input', (e) => e.value).catch(() => '');
  await p.keyboard.press('Enter');
  // (drawn first where the layout puts it, then moved to the drop: waited for)
  let n = null;
  for (let i = 0; i < 40 && !(n && Math.hypot(n.x - at.x, n.y - at.y) < 30); i++) {
    await h.sleep(250);
    n = await p.evaluate((id) => {
      const el = document.querySelector(`#mermaid-diagram-svg-container g.node[data-state-id="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { x, y, hit: document.elementFromPoint(x, y)?.closest('g.node') === el };
    }, name);
  }
  expect(!!n && Math.hypot(n.x - at.x, n.y - at.y) < 30, `${name} drawn where it was dropped (${n ? Math.round(Math.hypot(n.x - at.x, n.y - at.y)) : '?'} px off)`);
  expect(!!n?.hit, '... visible and can be clicked there');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
