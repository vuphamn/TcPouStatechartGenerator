// After a transition's start is dropped on another state (the other transitions' routes kept), a state dragged: its
// transitions re-routed from their kept routes (each still at its other state where it was), every other one as it
// was; the composites' boxes kept too. A kept transition's middle dragged: bent from its kept route (its ends where
// they were). The canvas says the layout is kept; its Re-layout lays it all out again
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1700, height: 1100 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(1500);
  await p.evaluate(() => document.querySelector('#diagram-minimap-container button[title^="Close Minimap"]')?.click());
  const FROM = 'TABLEMANAGER_AUTOFEED_WAIT_FOR_DATA';
  const TO = 'TABLEMANAGER_AUTOFEED_FEED_OUT';
  const S = 'TABLEMANAGER_AUTOFEED_INIT';
  // (zoomed in on it)
  await p.evaluate((s) => document.getElementById(`btn-goto-state-${s}`)?.click(), FROM);
  await h.sleep(1500);
  for (let i = 0; i < 4; i++) { await p.click('#zoom-in-button').catch(() => {}); await h.sleep(300); }
  await p.evaluate((s) => document.getElementById(`btn-goto-state-${s}`)?.click(), FROM);
  await h.sleep(1800);
  await p.mouse.click(5, 5);
  await h.sleep(300);

  // Each transition: its route's points (rounded), by its states and label
  const routes = () => p.evaluate(() => {
    const svg = document.querySelector('#mermaid-diagram-svg-container svg');
    const out = {};
    for (const path of svg.querySelectorAll('g.edgePaths path.tc-edge-path')) {
      if (path.classList.contains('tc-edge-hitbox')) continue;
      const from = path.getAttribute('data-source-id'), to = path.getAttribute('data-target-id');
      const pid = path.getAttribute('data-path-id');
      const label = pid ? svg.querySelector(`g.edgeLabel[data-linked-path-id="${CSS.escape(pid)}"]`) : null;
      let k = `${from}->${to}|${(label?.textContent ?? '').replace(/\s+/g, ' ').trim()}`;
      for (let i = 2; out[k]; i++) k = k.replace(/#\d+$/, '') + `#${i}`;
      const n = (path.getAttribute('d') || '').match(/-?\d+(\.\d+)?/g)?.map((x) => Math.round(Number(x))) ?? [];
      out[k] = { from, to, d: n.join(','), start: [n[0], n[1]], end: [n[n.length - 2], n[n.length - 1]] };
    }
    return out;
  });

  // 1. A start dropped (the one with badge 2 out of FROM, onto TO)
  const pt = await p.evaluate((f) => {
    const svg = document.querySelector('#mermaid-diagram-svg-container svg');
    const b = [...svg.querySelectorAll('.tc-priority-badge')].find((x) => x.textContent.trim() === '2' && svg.querySelector(`path.tc-edge-path[data-path-id="${x.getAttribute('data-path-id')}"]`)?.getAttribute('data-source-id') === f);
    const path = b && svg.querySelector(`path.tc-edge-path[data-path-id="${b.getAttribute('data-path-id')}"]`);
    if (!path) return null;
    const q = path.getPointAtLength(path.getTotalLength() * 0.5).matrixTransform(path.getScreenCTM());
    return { x: q.x, y: q.y };
  }, FROM);
  expect(!!pt, `${FROM}'s transition 2 on screen`);
  await p.mouse.click(pt.x, pt.y);
  await h.sleep(700);
  const hd = await p.evaluate(() => { const x = document.querySelector('#mermaid-canvas-area .tc-edge-handle[data-handle-type="start"]'); const q = x?.getBoundingClientRect(); return q ? { x: q.x + q.width / 2, y: q.y + q.height / 2 } : null; });
  const centre = (id) => p.evaluate((id) => { const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`); const q = n?.getBoundingClientRect(); return q ? { x: q.x + q.width / 2, y: q.y + q.height / 2 } : null; }, id);
  const tg = await centre(TO);
  expect(!!hd && !!tg, 'its start handle, and the state to drop it on');
  await p.mouse.move(hd.x, hd.y);
  await p.mouse.down();
  for (let i = 1; i <= 16; i++) await p.mouse.move(hd.x + ((tg.x - hd.x) * i) / 16, hd.y + ((tg.y - hd.y) * i) / 16);
  await h.sleep(150);
  await p.mouse.up();
  await h.sleep(3000);
  await p.keyboard.press('Escape');
  await h.sleep(300);
  const before = await routes();
  const kept = await p.evaluate(() => document.querySelectorAll('#mermaid-diagram-svg-container svg path.tc-edge-path[data-frozen-d]').length);
  expect(kept > 10, `dropped: the other transitions' routes kept (${kept})`);
  const chip = await p.$eval('#layout-kept-chip', (e) => e.innerText).catch(() => '');
  expect(new RegExp(`Layout kept: ${kept} transitions as drawn`).test(chip), `the canvas says so: "${chip.replace(/\s+/g, ' ')}"`);

  // 2. S dragged a little
  const s0 = await centre(S);
  await p.mouse.move(s0.x, s0.y);
  await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(s0.x + 3 * i, s0.y + 2 * i);
  await p.mouse.up();
  await h.sleep(1200);
  const after = await routes();
  const s1 = await centre(S);
  expect(Math.hypot(s1.x - s0.x, s1.y - s0.y) > 20, `${S} moved`);
  // (its transitions: at their other states where they were)
  const own = Object.keys(before).filter((k) => after[k] && (before[k].from === S) !== (before[k].to === S));
  const strayed = own.filter((k) => {
    const [a, b] = before[k].from === S ? [before[k].end, after[k].end] : [before[k].start, after[k].start];
    return Math.hypot(a[0] - b[0], a[1] - b[1]) > 2;
  });
  expect(own.length >= 2 && strayed.length === 0, `${S}'s ${own.length} transitions: each at its other state where it was (${strayed.map((k) => `${k.split('|')[0]}: ${JSON.stringify(before[k].from === S ? before[k].end : before[k].start)} → ${JSON.stringify(before[k].from === S ? after[k].end : after[k].start)}`).join(' ; ') || 'all'})`);
  // (the others: as they were)
  const others = Object.keys(before).filter((k) => after[k] && before[k].from !== S && before[k].to !== S && before[k].d !== after[k].d);
  expect(others.length === 0, `the other transitions as they were (${others.slice(0, 3).join(' ; ') || 'all'})`);

  // 2b. A kept transition's middle dragged (one on screen with a few bends, not S's): bent from its kept route
  const mid = await p.evaluate((s) => {
    const svg = document.querySelector('#mermaid-diagram-svg-container svg');
    const area = document.getElementById('mermaid-canvas-area').getBoundingClientRect();
    for (const path of svg.querySelectorAll('g.edgePaths path.tc-edge-path[data-frozen-d]')) {
      if (path.classList.contains('tc-edge-hitbox') || path.getAttribute('data-source-id') === s || path.getAttribute('data-target-id') === s) continue;
      const n = (path.getAttribute('d') || '').match(/[QL]/g)?.length ?? 0;
      if (n < 5) continue;
      const q = path.getPointAtLength(path.getTotalLength() * 0.5).matrixTransform(path.getScreenCTM());
      if (q.x < area.left + 80 || q.x > area.right - 80 || q.y < area.top + 80 || q.y > area.bottom - 80) continue;
      const e = document.elementFromPoint(q.x, q.y);
      if (!e || !(e === path || e.classList.contains('tc-edge-hitbox'))) continue;
      return { x: q.x, y: q.y, from: path.getAttribute('data-source-id'), to: path.getAttribute('data-target-id'), pid: path.getAttribute('data-path-id') };
    }
    return null;
  }, S);
  expect(!!mid, `a kept transition with bends on screen (${mid ? `${mid.from} → ${mid.to}` : 'none'})`);
  if (mid) {
    const ends = () => p.evaluate((pid) => { const x = document.querySelector(`#mermaid-diagram-svg-container svg path.tc-edge-path[data-path-id="${CSS.escape(pid)}"]`); const n = (x?.getAttribute('d') || '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []; return { d: x?.getAttribute('d'), start: [n[0], n[1]], end: [n[n.length - 2], n[n.length - 1]] }; }, mid.pid);
    const e0 = await ends();
    await p.mouse.click(mid.x, mid.y);
    await h.sleep(600);
    const mh = await p.evaluate(() => { const x = [...document.querySelectorAll('#mermaid-canvas-area .tc-edge-handle[data-handle-type="mid"]')].find((m) => m.getBoundingClientRect().width > 0); const q = x?.getBoundingClientRect(); return q ? { x: q.x + q.width / 2, y: q.y + q.height / 2 } : null; });
    expect(!!mh, 'its middle handle shown when selected');
    if (mh) {
      await p.mouse.move(mh.x, mh.y);
      await p.mouse.down();
      for (let i = 1; i <= 8; i++) await p.mouse.move(mh.x + 3 * i, mh.y + 3 * i);
      await p.mouse.up();
      await h.sleep(800);
      const e1 = await ends();
      const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 3;
      expect(e1.d !== e0.d && near(e0.start, e1.start) && near(e0.end, e1.end), `${mid.from} → ${mid.to}: its middle moved, its ends where they were (${JSON.stringify([e0.start, e0.end])} → ${JSON.stringify([e1.start, e1.end])})`);
      // (bent from its kept route: most of its bends still there, not the layout's route)
      const corners = (d) => new Set((d || '').match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g)?.map((q) => q.split(',').map((v) => Math.round(Number(v))).join(',')) ?? []);
      const c0 = corners(e0.d);
      const c1 = corners(e1.d);
      const kept = [...c0].filter((q) => c1.has(q)).length;
      expect(kept >= c0.size / 2, `${mid.from} → ${mid.to}: bent from its kept route (${kept} of its ${c0.size} points still there)`);
    }
    await p.keyboard.press('Escape');
    await h.sleep(300);
  }

  // 3. Re-layout: laid out again, nothing kept
  await p.click('#layout-kept-relayout-btn');
  let left = -1;
  for (let i = 0; i < 20 && left !== 0; i++) { await h.sleep(400); left = await p.evaluate(() => document.querySelectorAll('#mermaid-diagram-svg-container svg path.tc-edge-path[data-frozen-d]').length); }
  await h.sleep(500);
  expect(left === 0 && !(await p.$('#layout-kept-chip')), `Re-layout: laid out again, no route kept (${left}), the chip gone`);
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
