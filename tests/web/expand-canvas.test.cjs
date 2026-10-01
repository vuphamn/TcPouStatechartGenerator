// Expand (the canvas toolbar): the canvas fills the window (the header and the side panels hidden), its toolbar on the
// canvas itself, the whole chart fitted in it; Esc: the panels and the header back, the toolbar in the header again
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
  await p.select('#sample-selector', 'k-power-supply-ax86x0');
  await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="RESET"]', { timeout: 60000 });
  await h.sleep(1500);

  const state = () => p.evaluate(() => {
    const header = document.getElementById('app-header');
    const area = document.getElementById('mermaid-canvas-area').getBoundingClientRect();
    const btn = document.getElementById('fullscreen-button');
    const nodes = [...document.querySelectorAll('#mermaid-diagram-svg-container g.node[data-state-id]')].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0);
    const inside = nodes.filter((r) => r.left >= area.left - 1 && r.right <= area.right + 1 && r.top >= area.top - 1 && r.bottom <= area.bottom + 1).length;
    return {
      header: !!header && getComputedStyle(header).display !== 'none' && header.getBoundingClientRect().height > 0,
      area: { w: Math.round(area.width), h: Math.round(area.height) },
      toolbarOnCanvas: !!btn && !!btn.closest('#mermaid-viewer-container'),
      nodes: nodes.length,
      inside,
    };
  });
  const before = await state();
  expect(before.header && !before.toolbarOnCanvas, `as it was: the header, the toolbar in it (${JSON.stringify(before)})`);
  // (Expand: on the toolbar, or in its Hidden menu)
  if (await p.$('#fullscreen-button')) await p.click('#fullscreen-button');
  else {
    await p.click('#toolbar-hidden-controls-btn');
    await p.waitForSelector('#toolbar-hidden-controls-menu', { timeout: 3000 });
    await p.evaluate(() => [...document.querySelectorAll('#toolbar-hidden-controls-menu button')].find((b) => /Fullscreen|Expand/i.test(b.textContent + (b.title || '')))?.click());
  }
  await h.sleep(1200);
  const big = await state();
  expect(!big.header && big.toolbarOnCanvas, `expanded: no header, the toolbar on the canvas (${JSON.stringify(big)})`);
  expect(big.area.w > before.area.w && big.area.h > before.area.h, `the canvas bigger (${before.area.w}x${before.area.h} -> ${big.area.w}x${big.area.h})`);
  expect(big.nodes > 0 && big.inside === big.nodes, `the whole chart in it (${big.inside} of ${big.nodes} states)`);
  await p.keyboard.press('Escape');
  await h.sleep(1000);
  const back = await state();
  expect(back.header && !back.toolbarOnCanvas, `Esc: the header back, the toolbar in it (${JSON.stringify(back)})`);
  // The wide chart (Table Manager): all of it in the expanded canvas too
  await p.select('#sample-selector', 'table-manager-202');
  await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_DISABLED"]', { timeout: 60000 });
  await h.sleep(2000);
  await p.keyboard.press('z');
  await h.sleep(1500);
  const wide = await state();
  expect(!wide.header && wide.toolbarOnCanvas && wide.nodes > 20 && wide.inside === wide.nodes, `Z on the wide chart: the toolbar on the canvas, all ${wide.nodes} states in it (${wide.inside})`);
  await p.keyboard.press('Escape');
  await h.sleep(800);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
