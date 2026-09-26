const h = require('../lib/harness.cjs');
// Edge line drag: only the dragged edge is re-routed while dragging, at most once per frame; the result is kept
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
(async () => {
  const edge = { kill() {} }; // (the harness launches the browser)
  let b; b = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await b.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
  await sleep(1200);
  // Zoom in so the line is easy to grab, and centre a well-separated edge
  for (let i = 0; i < 4; i++) { await p.click('#zoom-in-button'); await sleep(120); }
  const key = 'TABLEMANAGER_CLAMPED->TABLEMANAGER_UNCLAMP_START';
  const grab = async () => p.evaluate((key) => {
    const el = document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`);
    el.scrollIntoView?.({ block: 'center', inline: 'center' });
    const len = el.getTotalLength();
    const m = el.getScreenCTM();
    // A point of the line itself (not under its label or another element)
    for (const f of [0.15, 0.2, 0.25, 0.3, 0.7, 0.75, 0.8, 0.85, 0.1, 0.9]) {
      const pt = el.getPointAtLength(len * f);
      const x = pt.x * m.a + pt.y * m.c + m.e;
      const y = pt.x * m.b + pt.y * m.d + m.f;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.getAttribute('data-edge-key') === key && hit.tagName === 'path') return { x, y, id: el.getAttribute('data-path-id'), d: el.getAttribute('d'), f, hit: hit.getAttribute('class') };
    }
    return null;
  }, key);
  // Put the edge in view: jump to its source state
  await p.evaluate(() => [...document.querySelectorAll('#identified-states-scrollable-list *')].find((e) => e.children.length === 0 && e.textContent.trim() === 'TABLEMANAGER_CLAMPED')?.click());
  await sleep(1500);
  const start = await grab();
  console.log('   grab at', start && Math.round(start.x), start && Math.round(start.y), start?.f, start?.hit);

  await p.mouse.move(start.x, start.y);
  await p.mouse.down();
  // The press selects the edge (one full update); the drag starts after 3 px
  for (let i = 1; i <= 5; i++) await p.mouse.move(start.x + i * 1.5, start.y + i * 2);
  await sleep(400);
  // Watch the SVG while dragging
  await p.evaluate(() => {
    const svg = document.querySelector('#mermaid-canvas-area svg');
    window.__mut = { paths: new Set(), nodes: new Set(), labels: new Set(), applies: 0 };
    window.__frames = 0;
    let counting = true;
    const tick = () => { if (!counting) return; window.__frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    window.__stopFrames = () => { counting = false; };
    let lastBatch = -1;
    window.__obs = new MutationObserver((records) => {
      for (const r of records) {
        const t = r.target;
        if (t.matches?.('path.tc-edge-path')) window.__mut.paths.add(t.getAttribute('data-path-id'));
        else if (t.matches?.('g.node')) window.__mut.nodes.add(t.getAttribute('data-state-id'));
        else if (t.matches?.('g.edgeLabel')) window.__mut.labels.add(t.getAttribute('data-edge-id'));
      }
      // One callback per update batch (per animation frame at most with the fix)
      window.__mut.applies++;
      lastBatch = window.__frames;
    });
    window.__obs.observe(svg, { attributes: true, subtree: true, attributeFilter: ['d', 'transform'] });
  });
  // 60 pointer moves as fast as puppeteer sends them
  for (let i = 6; i <= 65; i++) await p.mouse.move(start.x + i * 1.5, start.y + i * 2);
  await sleep(100);
  const during = await p.evaluate(() => {
    window.__obs.takeRecords();
    const r = { paths: [...window.__mut.paths], nodes: window.__mut.nodes.size, labels: window.__mut.labels.size, applies: window.__mut.applies, frames: window.__frames };
    window.__obs.disconnect();
    window.__stopFrames();
    return r;
  });
  console.log('   while dragging:', JSON.stringify(during));
  expect(during.paths.length === 1 && during.paths[0] === start.id, `only the dragged edge is re-routed (${during.paths.length} path(s) changed)`);
  expect(during.nodes === 0, `no node is touched (${during.nodes})`);
  expect(during.applies <= during.frames + 1, `at most one update per frame (${during.applies} updates, ${during.frames} frames, 60 moves)`);
  // 50 moves within one frame (a fast mouse): one update
  const burst = await p.evaluate(async (x0, y0) => {
    const target = document.querySelector('#mermaid-canvas-area svg');
    // Count the changes to the dragged path itself (one callback can carry many records)
    let updates = 0;
    const obs = new MutationObserver((records) => {
      updates += records.filter((r) => r.target.matches?.('path.tc-edge-path.selected-edge, path.tc-edge-path.diagram-selected-edge')).length;
    });
    obs.observe(target, { attributes: true, subtree: true, attributeFilter: ['d'] });
    for (let i = 0; i < 50; i++) target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x0 + 100 + i, clientY: y0 + 130 + i }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    obs.disconnect();
    return updates;
  }, start.x, start.y);
  expect(burst === 1, `50 moves in one frame: ${burst} update(s)`);
  const mid = await p.evaluate((key) => document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`).getAttribute('d'), key);
  expect(mid !== start.d, 'the line follows the pointer');
  await p.mouse.up();
  await sleep(1200);
  const after = await p.evaluate((key) => document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`).getAttribute('d'), key);
  expect(after !== start.d && after === mid, 'released: the line stays where it was dropped');
  console.log('page errors:', errors.slice(0, 5));
  await b.close().catch(() => {}); edge.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
