// A choice's arm (AUTOFEED_OUTSTOP's choice): selected, its priority badge marked amber (hover is sky blue); its label
// hovered, its edge and badge lit; its start dragged by the diamond: back on the diamond's corner nearest the drop, square to
// it; every priority badge of a re-routed edge still on its own edge
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
  await h.sleep(800);
  await p.click('#choice-nodes-checkbox');
  await h.sleep(2500);
  await p.evaluate(() => [...document.getElementById('state-list-item-TABLEMANAGER_AUTOFEED_OUTSTOP').querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click());
  await h.sleep(1800);
  const choice = await p.evaluate(() => { const n = [...document.querySelectorAll('#mermaid-canvas-area g.node')].find((x) => /^choice_TABLEMANAGER_AUTOFEED_OUTSTOP_\d+$/.test(x.getAttribute('data-state-id') ?? '')); return n ? { id: n.id, sid: n.getAttribute('data-state-id') } : null; });
  if (!choice) throw new Error('no choice for AUTOFEED_OUTSTOP');
  const at = await p.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, choice.id);
  await p.mouse.move(at.x, at.y);
  await p.keyboard.down('Control');
  for (let i = 0; i < 10; i++) { await p.mouse.wheel({ deltaY: -120 }); await h.sleep(40); }
  await p.keyboard.up('Control');
  await h.sleep(900);

  // An arm of the choice: its path, a point on it that is its own on screen
  const arm = await p.evaluate((sid) => {
    for (const el of document.querySelectorAll(`#mermaid-canvas-area path.tc-edge-path[data-source-id="${sid}"]`)) {
      const len = el.getTotalLength(); const m = el.getScreenCTM();
      for (const f of [0.5, 0.4, 0.6, 0.3, 0.7]) {
        const q = el.getPointAtLength(len * f); const x = q.x * m.a + q.y * m.c + m.e; const y = q.x * m.b + q.y * m.d + m.f;
        if (document.elementFromPoint(x, y)?.closest('path')?.getAttribute('data-path-id') === el.getAttribute('data-path-id')) return { x, y, pathId: el.getAttribute('data-path-id') };
      }
    }
    return null;
  }, choice.sid);
  expect(!!arm, `an arm of ${choice.sid} on screen`);
  const fill = (sel) => p.evaluate((sel) => { const c = document.querySelector('#mermaid-canvas-area g.node').ownerSVGElement.querySelector(sel.replace('#mermaid-canvas-area ', '')); return c ? getComputedStyle(c).fill : ''; }, sel);
  if (arm) {
    // Hovered (not selected yet): the edge lit a lighter sky blue, and its badge with it
    await p.mouse.move(arm.x, arm.y);
    await h.sleep(300);
    const hovered = await p.evaluate((pid) => {
      const svg = document.querySelector('#mermaid-canvas-area g.node').ownerSVGElement;
      const e = svg.querySelector(`path.tc-edge-path[data-path-id="${pid}"]`);
      const b = svg.querySelector(`.tc-priority-badge[data-path-id="${pid}"]`);
      return { edge: e?.classList.contains('tc-edge-pointer-hover'), stroke: e ? getComputedStyle(e).stroke : '', badge: b ? b.classList.contains('tc-priority-badge-pointer-hover') : null, others: svg.querySelectorAll('.tc-edge-pointer-hover').length };
    }, arm.pathId);
    expect(hovered.edge && hovered.stroke === 'rgb(125, 211, 252)' && hovered.badge !== false && hovered.others === 1, `the edge hovered: lit (${hovered.stroke}), its badge too (${hovered.badge}), nothing else (${hovered.others})`);
    // ... and its two ends (the choice, the state it goes to)
    const ends = await p.evaluate((pid) => {
      const svg = document.querySelector('#mermaid-canvas-area g.node').ownerSVGElement;
      const e = svg.querySelector(`path.tc-edge-path[data-path-id="${pid}"]`);
      const lit = [...svg.querySelectorAll('.tc-end-pointer-hover')].map((n) => n.getAttribute('data-state-id') ?? n.id);
      return { lit, want: [e.getAttribute('data-source-id'), e.getAttribute('data-target-id')] };
    }, arm.pathId);
    expect(ends.lit.length === 2 && ends.want.every((w) => ends.lit.includes(w)), `... and its two ends: ${ends.lit.join(', ')}`);
    await p.mouse.move(5, 500);
    await h.sleep(200);
    const cleared = await p.evaluate(() => document.querySelectorAll('#mermaid-canvas-area .tc-edge-pointer-hover, #mermaid-canvas-area .tc-priority-badge-pointer-hover').length);
    expect(cleared === 0, `the mouse away: unlit (${cleared})`);
    await p.mouse.click(arm.x, arm.y);
    await h.sleep(700);
    const marked = await p.evaluate((pid) => [...(document.querySelector('#mermaid-canvas-area g.node').ownerSVGElement).querySelectorAll('.tc-priority-badge-selected')].map((b) => b.getAttribute('data-path-id') === pid), arm.pathId);
    const selectedFill = await fill(`#mermaid-canvas-area .tc-priority-badge[data-path-id="${arm.pathId}"] circle`);
    // (another badge hovered: sky blue, not the selected one's amber)
    const other = await p.evaluate((pid) => { const b = [...document.querySelector('#mermaid-canvas-area g.node').ownerSVGElement.querySelectorAll('.tc-priority-badge')].find((x) => { if (x.getAttribute('data-path-id') === pid) return false; const r = x.querySelector('circle').getBoundingClientRect(); return r.width > 4 && r.top > 0 && r.bottom < 1000 && r.left > 0 && r.right < 1600 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.tc-priority-badge') === x; }); if (!b) return null; b.setAttribute('data-test-other', '1'); const r = b.querySelector('circle').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, arm.pathId);
    let hoverFill = '';
    if (other) {
      await p.mouse.move(other.x, other.y);
      await h.sleep(300);
      hoverFill = await fill('#mermaid-canvas-area [data-test-other] circle');
      await p.mouse.move(5, 500);
    }
    expect(marked.length === 1 && marked[0] && selectedFill === 'rgb(245, 158, 11)' && hoverFill === 'rgb(125, 211, 252)', `selected: only its badge marked (${marked.length}), amber ${selectedFill}; another hovered: ${hoverFill}`);
    await p.screenshot({ path: h.out('choice-edge-selected.png') });

    // Its start dragged a little, dropped by the diamond's right corner: on that corner, square to it
    const hs = await p.evaluate(() => { const el = [...document.querySelectorAll('#mermaid-canvas-area .tc-edge-handle[data-handle-type="start"]')].find((x) => x.getBoundingClientRect().width > 0); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const dia = await p.evaluate((id) => { const r = document.getElementById(id).querySelector('polygon').getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, hw: r.width / 2, hh: r.height / 2 }; }, choice.id);
    expect(!!hs, 'its start handle');
    if (hs) {
      // (by the lower right side, nearer the right corner: the box around the diamond would take it half way down)
      const drop = { x: dia.cx + dia.hw * 0.75, y: dia.cy + dia.hh * 0.45 };
      await p.mouse.move(hs.x, hs.y);
      await p.mouse.down();
      for (let i = 1; i <= 12; i++) await p.mouse.move(hs.x + ((drop.x - hs.x) * i) / 12, hs.y + ((drop.y - hs.y) * i) / 12);
      await h.sleep(150);
      await p.mouse.up();
      await h.sleep(900);
      const start = await p.evaluate((pid) => { const el = document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-path-id="${pid}"]`); const q = el.getPointAtLength(0); const q2 = el.getPointAtLength(6); const m = el.getScreenCTM(); const t = (a) => ({ x: a.x * m.a + a.y * m.c + m.e, y: a.x * m.b + a.y * m.d + m.f }); return { a: t(q), b: t(q2) }; }, arm.pathId);
      // (on the right corner: its middle's height, right at the diamond's edge; the line leaves square: horizontal)
      const atCorner = Math.abs(start.a.y - dia.cy) < 2.5 && Math.abs(start.a.x - (dia.cx + dia.hw)) < 5;
      const square = Math.abs(start.b.y - start.a.y) < 1;
      expect(atCorner && square, `its start dropped by the right corner: on it (${(start.a.x - dia.cx).toFixed(1)}, ${(start.a.y - dia.cy).toFixed(1)} from the middle, ${dia.hw.toFixed(1)} wide), square to it: ${square}`);
      await p.screenshot({ path: h.out('choice-edge-start.png') });
    }
  }

  // Every priority badge of a re-routed edge on its own edge (not left where the edge used to leave)
  const off = await p.evaluate(() => {
    const svg = document.querySelector('#mermaid-canvas-area g.node').ownerSVGElement;
    const out = [];
    for (const b of svg.querySelectorAll('.tc-priority-badge')) {
      const path = svg.querySelector(`path.tc-edge-path[data-path-id="${b.getAttribute('data-path-id')}"]`);
      if (!path || path.getAttribute('d') === path.getAttribute('data-orig-d')) continue;
      const c = b.querySelector('circle');
      const q = new DOMPoint(Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))).matrixTransform(svg.getScreenCTM().inverse().multiply(c.getScreenCTM()));
      const mp = svg.getScreenCTM().inverse().multiply(path.getScreenCTM());
      const len = path.getTotalLength();
      let best = Infinity;
      for (let d = 0; d <= len; d += 2) { const r = new DOMPoint(path.getPointAtLength(d).x, path.getPointAtLength(d).y).matrixTransform(mp); best = Math.min(best, Math.hypot(r.x - q.x, r.y - q.y)); }
      if (best > 3) out.push(`${b.getAttribute('data-from')}#${b.textContent} ${best.toFixed(0)} off`);
    }
    return out;
  });
  expect(off.length === 0, `the re-routed edges' badges on their edges (${off.slice(0, 3).join(', ') || 'all on'})`);

  // A label hovered: its edge's badge lit (as the badge hovered)
  const lab = await p.evaluate(() => { const svg = document.querySelector('#mermaid-canvas-area g.node').ownerSVGElement; const l = [...svg.querySelectorAll('g.edgeLabel[data-linked-path-id]')].find((x) => { const r = x.getBoundingClientRect(); return r.width > 10 && r.top > 0 && r.bottom < 1000 && r.left > 0 && r.right < 1600 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('g.edgeLabel') === x && svg.querySelector(`.tc-priority-badge[data-path-id="${x.getAttribute('data-linked-path-id')}"]`); }); if (!l) return null; const r = l.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, pid: l.getAttribute('data-linked-path-id') }; });
  if (lab) {
    await p.mouse.move(lab.x, lab.y);
    await h.sleep(400);
  }
  const lit = await p.evaluate(() => [...document.querySelector('#mermaid-canvas-area g.node').ownerSVGElement.querySelectorAll('.tc-priority-badge-hover')].map((b) => b.getAttribute('data-path-id')));
  const litEdge = lab ? await p.evaluate((pid) => { const svg = document.querySelector('#mermaid-canvas-area g.node').ownerSVGElement; const e = [...svg.querySelectorAll('path.tc-edge-hover')]; return { n: e.length, own: e.every((x) => x.getAttribute('data-path-id') === pid), stroke: e[0] ? getComputedStyle(e[0]).stroke : '' }; }, lab.pid) : null;
  const litFill = lab ? await fill(`#mermaid-canvas-area .tc-priority-badge[data-path-id="${lab.pid}"] circle`) : '';
  expect(!!lab && lit.length === 1 && lit[0] === lab.pid && (litFill === 'rgb(125, 211, 252)' || litFill === 'rgb(245, 158, 11)'), `a label hovered: its badge lit (${lit.length}, ${litFill})`);
  expect(litEdge?.n === 1 && litEdge.own && litEdge.stroke === 'rgb(125, 211, 252)', `... and its edge (${litEdge?.n}, ${litEdge?.stroke})`);

  // Every label on screen hovered (with a badge or without): its own edge lit, and only it
  const labels = await p.evaluate(() => {
    const svg = document.querySelector('#mermaid-canvas-area g.node').ownerSVGElement;
    return [...svg.querySelectorAll('g.edgeLabel[data-linked-path-id]')].map((x) => ({ x, r: x.getBoundingClientRect() }))
      .filter(({ x, r }) => r.width > 10 && r.top > 0 && r.bottom < window.innerHeight && r.left > 0 && r.right < window.innerWidth && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('g.edgeLabel') === x)
      .slice(0, 15).map(({ x, r }) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2, pid: x.getAttribute('data-linked-path-id'), badge: !!svg.querySelector(`.tc-priority-badge[data-path-id="${x.getAttribute('data-linked-path-id')}"]`) }));
  });
  const unlit = [];
  for (const l of labels) {
    await p.mouse.move(5, 500);
    await h.sleep(150);
    await p.mouse.move(l.x, l.y);
    await h.sleep(300);
    const lit2 = await p.evaluate(() => [...document.querySelector('#mermaid-canvas-area g.node').ownerSVGElement.querySelectorAll('path.tc-edge-hover')].map((e) => e.getAttribute('data-path-id')));
    if (lit2.length !== 1 || lit2[0] !== l.pid) unlit.push(`${l.pid?.replace(/^.*?-L_/, '')} (${l.badge ? 'badge' : 'no badge'}): ${lit2.length} lit`);
  }
  // (and HOMMING -> IDLE_FEED_OFF's "else AND ..." label, as it was reported)
  await p.evaluate(() => [...document.getElementById('state-list-item-TABLEMANAGER_HOMMING').querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click());
  await h.sleep(1500);
  const homming = await p.evaluate(() => {
    const svg = document.querySelector('#mermaid-canvas-area g.node').ownerSVGElement;
    const l = [...svg.querySelectorAll('g.edgeLabel[data-linked-path-id]')].find((x) => x.getAttribute('data-from') === 'TABLEMANAGER_HOMMING' && x.getAttribute('data-to') === 'TABLEMANAGER_IDLE_FEED_OFF');
    if (!l) return null;
    const r = l.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, pid: l.getAttribute('data-linked-path-id'), top: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('g.edgeLabel') === l };
  });
  if (homming) {
    await p.mouse.move(5, 500);
    await h.sleep(150);
    await p.mouse.move(homming.x, homming.y);
    await h.sleep(400);
    const lit3 = await p.evaluate(() => [...document.querySelector('#mermaid-canvas-area g.node').ownerSVGElement.querySelectorAll('path.tc-edge-hover')].map((e) => e.getAttribute('data-path-id')));
    if (lit3.length !== 1 || lit3[0] !== homming.pid) unlit.push(`HOMMING->IDLE_FEED_OFF (on top: ${homming.top}): ${lit3.length} lit`);
  } else unlit.push('HOMMING->IDLE_FEED_OFF: no label');
  expect(labels.length >= 5 && unlit.length === 0, `${labels.length} labels hovered (${labels.filter((l) => !l.badge).length} without a badge): each lights its own edge (${unlit.slice(0, 2).join('; ') || 'all'})`);

  // The guard popup of a label near the bottom (the lowest labels on screen): never over its label
  const low = await p.evaluate(() => {
    const svg = document.querySelector('#mermaid-canvas-area g.node').ownerSVGElement;
    return [...svg.querySelectorAll('g.edgeLabel')].map((x) => ({ x, r: x.getBoundingClientRect() }))
      .filter(({ x, r }) => r.width > 10 && r.top > 0 && r.bottom < window.innerHeight && r.left > 0 && r.right < window.innerWidth && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('g.edgeLabel') === x)
      .sort((a, b) => b.r.bottom - a.r.bottom).slice(0, 5).map(({ r }) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2, box: [r.left, r.top, r.right, r.bottom] }));
  });
  const covered = [];
  for (const l of low) {
    await p.mouse.move(5, 500);
    await h.sleep(200);
    await p.mouse.move(l.x, l.y);
    await h.sleep(400);
    const pop = await p.evaluate(() => { const e = document.getElementById('edge-guard-condition-hover-badge'); if (!e || getComputedStyle(e).visibility !== 'visible') return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
    if (!pop) { covered.push(`no popup at ${l.y.toFixed(0)}`); continue; }
    const [a, b] = [l.box, pop];
    if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) covered.push(`label at ${a[1].toFixed(0)}-${a[3].toFixed(0)} under the popup ${b[1].toFixed(0)}-${b[3].toFixed(0)}`);
  }
  // (it appears where it stays: not flying in from the canvas's corner)
  let moved = null;
  if (low[0]) {
    await p.mouse.move(5, 500);
    await h.sleep(300);
    await p.evaluate(() => {
      window.__popAt = [];
      const t0 = performance.now();
      const f = () => { const e = document.getElementById('edge-guard-condition-hover-badge'); if (e && getComputedStyle(e).visibility === 'visible') { const r = e.getBoundingClientRect(); window.__popAt.push(`${Math.round(r.left)},${Math.round(r.top)}`); } if (performance.now() - t0 < 700) requestAnimationFrame(f); };
      requestAnimationFrame(f);
    });
    await p.mouse.move(low[0].x, low[0].y);
    await h.sleep(800);
    moved = [...new Set(await p.evaluate(() => window.__popAt))];
  }
  expect(!!moved && moved.length === 1, `the popup appears where it stays (${moved?.length} places while shown: ${moved?.slice(0, 3).join(' ')})`);
  expect(low.length >= 3 && covered.length === 0, `the guard popup of the ${low.length} lowest labels: none over its label (${covered.slice(0, 2).join('; ') || 'clear'})`);
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
