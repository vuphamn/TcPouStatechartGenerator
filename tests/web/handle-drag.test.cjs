const h = require('../lib/harness.cjs');
// Edge endpoint / waypoint handles: the line follows while dragging (only that edge), and keeps the result
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
  await sleep(1000);
  for (let i = 0; i < 4; i++) { await p.click('#zoom-in-button'); await sleep(120); }
  await p.evaluate(() => [...document.querySelectorAll('#identified-states-scrollable-list *')].find((e) => e.children.length === 0 && e.textContent.trim() === 'TABLEMANAGER_CLAMPED')?.click());
  await sleep(1500);
  const key = 'TABLEMANAGER_CLAMPED->TABLEMANAGER_UNCLAMP_START';
  // Select the edge with a click on its line
  const pt = await p.evaluate((key) => {
    const el = document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`);
    const len = el.getTotalLength(); const m = el.getScreenCTM();
    for (const f of [0.15, 0.2, 0.8, 0.85]) {
      const q = el.getPointAtLength(len * f); const x = q.x * m.a + q.y * m.c + m.e; const y = q.x * m.b + q.y * m.d + m.f;
      if (document.elementFromPoint(x, y)?.getAttribute('data-edge-key') === key) return { x, y };
    }
    return null;
  }, key);
  await p.mouse.click(pt.x, pt.y);
  await sleep(800);
  // The click opens the Transition Guard window (follow selection): close it, it covers the handles
  await p.keyboard.press('Escape');
  await sleep(400);
  console.log('   after click:', JSON.stringify(await p.evaluate((key) => ({ selected: document.querySelector('#mermaid-canvas-area path.tc-edge-path[data-edge-key="' + key + '"]').getAttribute('class'), handles: [...document.querySelectorAll('#mermaid-canvas-area .tc-edge-handle')].map((h) => h.getAttribute('data-handle-type') + ':' + (() => { const r = h.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e ? e.tagName + '.' + (e.getAttribute('class') || '').slice(0, 40) : 'none'; })()) }), key)));
  for (const type of ['end', 'mid']) {
    const hd = await p.evaluate((type) => {
      // The diagram's handle that is under the pointer (not the minimap's, not covered)
      const el = [...document.querySelectorAll(`#mermaid-canvas-area .tc-edge-handle[data-handle-type="${type}"]`)].find((x) => { const q = x.getBoundingClientRect(); const e = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); return e && x.contains(e); });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: el.getAttribute('data-edge-id') };
    }, type);
    if (!hd) { expect(false, `${type} handle shown`); continue; }
    const before = await p.evaluate((key) => document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`).getAttribute('d'), key);
    await p.mouse.move(hd.x, hd.y);
    await p.mouse.down();
    for (let i = 1; i <= 5; i++) await p.mouse.move(hd.x + i * 2, hd.y + i * 2);
    await sleep(300);
    const watch = await p.evaluate(() => {
      window.__changed = new Set();
      window.__o = new MutationObserver((rs) => rs.forEach((r) => { if (r.target.matches?.('path.tc-edge-path, g.node')) window.__changed.add(r.target.getAttribute('data-path-id') || r.target.getAttribute('data-state-id')); }));
      window.__o.observe(document.querySelector('#mermaid-canvas-area svg'), { attributes: true, subtree: true, attributeFilter: ['d', 'transform'] });
      return true;
    });
    for (let i = 6; i <= 30; i++) await p.mouse.move(hd.x + i * 2, hd.y + i * 2.5);
    await sleep(100);
    const live = await p.evaluate((key) => { window.__o.disconnect(); return { changed: window.__changed.size, d: document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`).getAttribute('d') }; }, key);
    await p.mouse.up();
    await sleep(900);
    const after = await p.evaluate((key) => document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`).getAttribute('d'), key);
    expect(live.d !== before && live.changed === 1 && after === live.d, `${type} handle: the line follows (${live.changed} element(s) changed while dragging) and keeps its shape after release`);
  }
  console.log('page errors:', errors.slice(0, 5));
  await b.close().catch(() => {}); edge.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
