// The canvas's hover popups (a state's code, a transition's guard on its label) on by default; the toolbar's Hover
// popups off: none on hover (kept after a reload); on again: back
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1700, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await p.select('#sample-selector', 'k-power-supply-ax86x0');
  await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="RESET"]', { timeout: 60000 });
  await h.sleep(2000);

  const center = (sel) => p.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.top > 0 && r.bottom < innerHeight; });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, sel);
  const away = async () => { await p.mouse.move(5, 995); await h.sleep(500); };
  // Hovered: what is shown (the state's code box, the guard popup)
  const hoverShows = async () => {
    await away();
    const s = await center('#mermaid-canvas-area g.node[data-state-id="RESET"]');
    if (s) await p.mouse.move(s.x, s.y, { steps: 3 });
    await h.sleep(700);
    const state = !!(await p.$('#state-actions-hover'));
    await away();
    const l = await center('#mermaid-canvas-area g.edgeLabel[data-linked-path-id]');
    if (l) await p.mouse.move(l.x, l.y, { steps: 3 });
    await h.sleep(900);
    const guard = await p.evaluate(() => { const el = document.getElementById('edge-guard-condition-hover-badge'); return !!el && getComputedStyle(el).visibility === 'visible'; });
    await away();
    return { state, guard };
  };
  // The toolbar's button, or its entry in the Hidden menu when the toolbar is too narrow
  const toggle = async () => {
    if (await p.$('#toolbar-hover-popups-btn')) return p.click('#toolbar-hover-popups-btn');
    await p.click('#toolbar-hidden-controls-btn');
    await p.waitForSelector('#hidden-hover-popups-btn', { timeout: 3000 });
    await p.click('#hidden-hover-popups-btn');
    await p.keyboard.press('Escape');
  };

  const on = await hoverShows();
  expect(on.state && on.guard, `on by default: the state's code ${on.state}, the guard ${on.guard}`);
  await toggle();
  await h.sleep(300);
  const off = await hoverShows();
  expect(!off.state && !off.guard, `off: none on hover (state ${off.state}, guard ${off.guard})`);
  expect((await p.evaluate(() => localStorage.getItem('kss.canvas.hoverPopups'))) === 'off', 'kept in this browser');
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await p.select('#sample-selector', 'k-power-supply-ax86x0');
  await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="RESET"]', { timeout: 60000 });
  await h.sleep(2000);
  const kept = await hoverShows();
  expect(!kept.state && !kept.guard, 'after a reload: still off');
  await toggle();
  await h.sleep(300);
  const back = await hoverShows();
  expect(back.state && back.guard, `on again: back (state ${back.state}, guard ${back.guard})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
