// The priority badges of the transitions leaving AnyState (preProcess()'s, numbered by their order there): each one on
// its edge, clear of the AnyState node (its edges start inside the small rounded node), not on top of another
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
  for (const sample of ['table-manager-202', 'feed-manager-237']) {
    await p.select('#sample-selector', sample);
    await h.sleep(4000);
    const r = await p.evaluate(() => {
      const svg = document.querySelector('#mermaid-diagram-svg-container svg');
      const any = svg.querySelector('g.node[data-state-id="AnyState"]');
      const box = any ? (any.querySelector('rect, path, polygon') ?? any).getBoundingClientRect() : null;
      const badges = [...svg.querySelectorAll('.tc-priority-badge')].filter((b) => /^AnyState->/.test(b.getAttribute('data-edge-key') || '') || (b.getAttribute('data-edge-id') || '').startsWith('AnyState') || svg.querySelector(`path[data-edge-id="${b.getAttribute('data-edge-id')}"]`)?.getAttribute('data-from') === 'AnyState')
        .map((b) => { const q = b.getBoundingClientRect(); const k = svg.getScreenCTM()?.a || 1; return { x: q.x + q.width / 2, y: q.y + q.height / 2, r: q.width / 2, k, n: b.textContent.trim() }; });
      const inside = box ? badges.filter((b) => b.x + b.r > box.left && b.x - b.r < box.right && b.y + b.r > box.top && b.y - b.r < box.bottom) : [];
      const overlap = badges.filter((a, i) => badges.some((b, j) => j > i && Math.hypot(a.x - b.x, a.y - b.y) / a.k < 12));
      return { box: box ? [box.left, box.top, box.right, box.bottom].map(Math.round) : null, badges: badges.map((b) => `${b.n}@${Math.round(b.x / b.k)},${Math.round(b.y / b.k)}`), inside: inside.map((b) => b.n), overlap: overlap.map((b) => b.n) };
    });
    expect(!!r.box && r.badges.length >= 2 && r.inside.length === 0 && r.overlap.length === 0, `${sample}: AnyState's badges clear of it and of each other (${JSON.stringify(r)})`);
  }
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
