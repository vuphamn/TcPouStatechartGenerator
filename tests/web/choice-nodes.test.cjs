// The Choices option: a state's IF / ELSIF / ELSE of transitions drawn as a choice (a diamond, no state); off again: gone
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
  const choices = () => p.evaluate(() => [...document.querySelectorAll('#mermaid-canvas-area g.node')].filter((n) => /choice_/.test(n.id)).map((n) => ({ id: n.id, state: n.getAttribute('data-state-id'), diamond: !!n.querySelector('polygon'), size: (() => { const b = n.querySelector('polygon')?.getBBox(); return b ? Math.round(b.width) : 0; })() })));
  expect((await choices()).length === 0, 'off: no choices');
  // The priority badges: none on top of another (two transitions leaving a state side by side: the second further
  // along its edge), in the diagram's own units (the minimap's copy left out)
  const crowded = await p.evaluate(() => {
    const svg = document.querySelector('#mermaid-canvas-area g.node')?.ownerSVGElement;
    const at = [...(svg?.querySelectorAll('.tc-priority-badge circle') ?? [])].map((c) => ({ x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')), id: c.parentElement.getAttribute('data-edge-id') }));
    const close = [];
    for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) if (Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y) < 18) close.push(`${at[i].id} / ${at[j].id}`);
    return { n: at.length, close };
  });
  expect(crowded.n > 20 && crowded.close.length === 0, `the ${crowded.n} priority badges: none on top of another (${crowded.close.slice(0, 2).join('; ') || 'none'})`);
  const crowdedNow = () => p.evaluate(() => {
    const svg = document.querySelector('#mermaid-canvas-area g.node')?.ownerSVGElement;
    const at = [...(svg?.querySelectorAll('.tc-priority-badge circle') ?? [])].map((c) => ({ x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')), id: c.parentElement.getAttribute('data-edge-id') }));
    const close = [];
    for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) if (Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y) < 18) close.push(`${at[i].id} / ${at[j].id}`);
    return { n: at.length, close };
  });
  await p.click('#choice-nodes-checkbox');
  await h.sleep(2500);
  const on = await choices();
  const clamped = on.find((c) => /choice_TABLEMANAGER_CLAMPED_/.test(c.id));
  expect(clamped?.size >= 40, `a diamond you can see and grab: ${clamped?.size} wide (SVG units)`);
  expect(on.length > 0 && !!clamped && clamped.diamond, `on: ${on.length} choices drawn as diamonds (CLAMPED's: ${clamped?.id.replace(/^.*?(choice_)/, '$1')})`);
  expect(!(await p.evaluate(() => /Mermaid Render Error/.test(document.body.innerText))), 'no render error');
  // (a choice's arms leave its corners close together: their badges apart too)
  const crowdedOn = await crowdedNow();
  expect(crowdedOn.n > 20 && crowdedOn.close.length === 0, `choices on: the ${crowdedOn.n} priority badges, none on top of another (${crowdedOn.close.slice(0, 2).join('; ') || 'none'})`);
  expect(await p.evaluate(() => localStorage.getItem('kss.choiceNodes')) === 'true', 'kept per viewer');
  // A choice dragged (ELK): its transitions stay orthogonal, their ends on the diamond's border
  const edgesOf = (id) => p.evaluate((id) => {
    const node = document.getElementById(id);
    const sid = node?.getAttribute('data-state-id');
    const svg = node?.ownerSVGElement;
    const paths = [...(svg?.querySelectorAll('path[data-source-id], path[data-target-id]') ?? [])].filter((e) => e.getAttribute('data-source-id') === sid || e.getAttribute('data-target-id') === sid);
    const diag = [];
    for (const e of paths) {
      const d = e.getAttribute('d') || '';
      const cmds = [...d.matchAll(/([MLQC])([^MLQCZ]*)/gi)].map((m) => ({ c: m[1].toUpperCase(), n: m[2].trim().split(/[\s,]+/).map(Number) }));
      let last = null;
      for (const k of cmds) {
        const end = { x: k.n[k.n.length - 2], y: k.n[k.n.length - 1] };
        if (k.c === 'L' && last && Math.abs(end.x - last.x) > 1 && Math.abs(end.y - last.y) > 1) diag.push(`${e.getAttribute('data-source-id')}->${e.getAttribute('data-target-id')}: (${last.x.toFixed(0)},${last.y.toFixed(0)})-(${end.x.toFixed(0)},${end.y.toFixed(0)})`);
        if (k.c === 'C') diag.push(`${e.getAttribute('data-source-id')}->${e.getAttribute('data-target-id')}: a curve`);
        last = end;
      }
    }
    return { sid, n: paths.length, diag };
  }, id);
  // (the view on CLAMPED: Go to State zooms in; its choice is by it)
  await p.evaluate(() => [...document.getElementById('state-list-item-TABLEMANAGER_CLAMPED').querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click());
  await h.sleep(1500);
  // (the zoom settled: the diamond at the same place on screen for a few reads, on a busy machine too)
  for (let i = 0, last = '', same = 0; i < 40 && same < 3; i++) {
    const at = await p.evaluate((id) => { const r = document.getElementById(id)?.getBoundingClientRect(); return r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}` : ''; }, clamped.id);
    same = at && at === last ? same + 1 : 0;
    last = at;
    await h.sleep(150);
  }
  const choiceGaps = () => p.evaluate(() => {
    const out = [];
    for (const n of document.querySelectorAll('#mermaid-canvas-area g.node')) {
      if (!/choice_/.test(n.id)) continue;
      const poly = n.querySelector('polygon');
      const svg = n.ownerSVGElement;
      const sid = n.getAttribute('data-state-id');
      // in the SVG's own units: the polygon's box
      const pm = poly.getCTM(); const sm = svg.getCTM ? svg.getScreenCTM() : null;
      const b = poly.getBBox();
      const toSvg = (x, y) => { const m = svg.getScreenCTM().inverse().multiply(poly.getScreenCTM()); return { x: x * m.a + y * m.c + m.e, y: x * m.b + y * m.d + m.f }; };
      const tl = toSvg(b.x, b.y); const br = toSvg(b.x + b.width, b.y + b.height);
      let worst = 0; let at = '';
      for (const pth of svg.querySelectorAll('path[data-source-id], path[data-target-id]')) {
        const isIn = pth.getAttribute('data-target-id') === sid; const isOut = pth.getAttribute('data-source-id') === sid;
        if (!isIn && !isOut) continue;
        const L = pth.getTotalLength(); const q0 = pth.getPointAtLength(isIn ? L : 0);
        const m = svg.getScreenCTM().inverse().multiply(pth.getScreenCTM());
        const q = { x: q0.x * m.a + q0.y * m.c + m.e, y: q0.x * m.b + q0.y * m.d + m.f };
        // (how far from the diamond's border itself: |x - cx| / hw + |y - cy| / hh = 1 on it)
        const cx = (tl.x + br.x) / 2; const cy = (tl.y + br.y) / 2; const hw = (br.x - tl.x) / 2; const hh = (br.y - tl.y) / 2;
        const d = Math.abs(Math.abs(q.x - cx) / hw + Math.abs(q.y - cy) / hh - 1) * Math.min(hw, hh) / Math.SQRT2;
        if (d > worst) { worst = d; at = (isIn ? 'in from ' + pth.getAttribute('data-source-id') : 'out to ' + pth.getAttribute('data-target-id')); }
      }
      out.push([sid.replace('choice_TABLEMANAGER_', ''), Math.round(br.x - tl.x), Math.round(worst), at]);
    }
    return out.sort((a, b) => b[2] - a[2]);
  });
  const fresh = await choiceGaps();
  expect(fresh.length > 20 && fresh[0][2] <= 6, `every choice's transitions end at its diamond (worst: ${fresh[0]?.[0]}, ${fresh[0]?.[2]} units off, ${fresh[0]?.[3]})`);
  const before = await edgesOf(clamped.id);
  const box = await p.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, clamped.id);
  const hit = await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('g.node')?.id ?? '', [box.x, box.y]);
  expect(hit === clamped.id, `the choice under the mouse (${hit || 'nothing'})`);
  await p.mouse.move(box.x, box.y);
  await p.mouse.down();
  await p.mouse.move(box.x + 70, box.y + 45, { steps: 8 });
  await p.mouse.up();
  await h.sleep(800);
  const after = await edgesOf(clamped.id);
  const draggedGaps = await choiceGaps();
  const ends = await p.evaluate((id) => {
    const n = document.getElementById(id);
    const sid = n.getAttribute('data-state-id');
    const svg = n.ownerSVGElement;
    return [...svg.querySelectorAll('path[data-edge-id]')].filter((e) => e.id && (e.getAttribute('data-source-id') === sid || e.getAttribute('data-target-id') === sid)).map((e) => {
      const L = e.getTotalLength(); const q = e.getPointAtLength(e.getAttribute('data-target-id') === sid ? L : 0);
      return `${Math.round(q.x / 4)},${Math.round(q.y / 4)}`;
    });
  }, clamped.id);
  expect(ends.length >= 3 && new Set(ends).size === ends.length, `the dragged choice's ${ends.length} transitions each on its own corner (${ends.join(' ')})`);
  expect(draggedGaps[0][2] <= 6, `... and after the drag (worst: ${draggedGaps[0]?.[0]}, ${draggedGaps[0]?.[2]} units off)`);
  const moved = await p.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, clamped.id);
  expect(Math.hypot(moved.x - box.x - 70, moved.y - box.y - 45) < 12, `the choice moved with the mouse (${(moved.x - box.x).toFixed(0)},${(moved.y - box.y).toFixed(0)} of 70,45)`);
  expect(before.n > 0 && after.n === before.n && after.diag.length === 0, `the choice dragged (ELK): its ${after.n} transitions orthogonal (${after.diag.slice(0, 3).join(' | ') || 'no diagonal'}; before: ${before.diag.length} diagonal)`);
  await p.screenshot({ path: h.out('choice-dragged.png') });
  // AUTOFEED_IDLE's choice moved a little sideways: its transitions still end on its sides (not beside it)
  const idleChoice = (await choices()).find((c) => /choice_TABLEMANAGER_AUTOFEED_IDLE_/.test(c.id));
  const ib = await p.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, idleChoice.id);
  await p.mouse.move(ib.x, ib.y);
  await p.mouse.down();
  await p.mouse.move(ib.x - 3, ib.y + 1, { steps: 4 });
  await p.mouse.up();
  await h.sleep(800);
  const sideways = (await choiceGaps()).find((g) => /^AUTOFEED_IDLE_/.test(g[0]));
  expect(!!sideways && sideways[2] <= 6,`AUTOFEED_IDLE's choice moved sideways: its transitions on its sides (${sideways?.[2]} units off, ${sideways?.[3]})`);
  // ... and further to the left, in steps: the transition from its state (a straight route of two points, drawn a
  // pixel or two off vertical) still ends on the diamond, square to it
  const leftGaps = [];
  for (let i = 0; i < 4; i++) {
    const at = await p.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, idleChoice.id);
    await p.mouse.move(at.x, at.y);
    await p.mouse.down();
    await p.mouse.move(at.x - 10, at.y, { steps: 4 });
    await p.mouse.up();
    await h.sleep(600);
    leftGaps.push((await choiceGaps()).find((g) => /^AUTOFEED_IDLE_/.test(g[0]))?.[2] ?? 99);
  }
  const leftEdges = await edgesOf(idleChoice.id);
  expect(Math.max(...leftGaps) <= 6 && leftEdges.diag.length === 0, `AUTOFEED_IDLE's choice moved left in steps: on its diamond (${leftGaps.join(', ')} units off), orthogonal (${leftEdges.diag.slice(0, 2).join(' | ') || 'no diagonal'})`);
  // A moved badge hovered: it grows where it is (no jump back to where it was: no flicker)
  const badge = await p.evaluate((sid) => {
    const b = [...document.querySelectorAll('#mermaid-canvas-area .tc-priority-badge')].find((x) => x.getAttribute('data-from') === sid && x.getAttribute('transform'));
    if (!b) return null;
    const r = b.querySelector('circle').getBoundingClientRect();
    b.setAttribute('data-test-badge', '1');
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, after.sid);
  let jumped = null;
  if (badge) {
    // (zoomed in on it, as when you look at it)
    await p.mouse.move(badge.x + 60, badge.y + 60);
    await p.keyboard.down('Control');
    for (let i = 0; i < 8; i++) {
      await p.mouse.wheel({ deltaY: -120 });
      await h.sleep(40);
    }
    await p.keyboard.up('Control');
    await h.sleep(700);
    const b2 = await p.evaluate(() => { const r = document.querySelector('[data-test-badge] circle').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    badge.x = b2.x;
    badge.y = b2.y;
    await p.evaluate(() => { window.__badgeAt = []; const t0 = performance.now(); const f = () => { const r = document.querySelector('[data-test-badge] circle')?.getBoundingClientRect(); if (r) window.__badgeAt.push(Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2)); if (performance.now() - t0 < 700) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await p.mouse.move(badge.x, badge.y);
    await h.sleep(800);
    const spots = [...new Set(await p.evaluate(() => window.__badgeAt))];
    const hovered = await p.evaluate(() => { const r = document.querySelector('[data-test-badge] circle').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, over: document.querySelector('[data-test-badge]').matches(':hover') }; });
    jumped = { d: Math.hypot(hovered.x - badge.x, hovered.y - badge.y), over: hovered.over, w: hovered.w, spots };
  }
  expect(!!jumped && jumped.d < 2 && jumped.over && jumped.spots.length === 1, `a moved priority badge hovered: stays under the mouse, no flicker (at ${jumped?.spots.join(' ')} while hovered; ${jumped?.w.toFixed(1)} px wide)`);
  // ... and the mouse away: it shrinks back where it is (about its middle, not drifting down-right and back)
  await p.evaluate(() => {
    window.__badgeLeave = [];
    const t0 = performance.now();
    const f = () => {
      const r = document.querySelector('[data-test-badge] circle')?.getBoundingClientRect();
      if (r) window.__badgeLeave.push({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
      if (performance.now() - t0 < 500) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await p.mouse.move(badge ? badge.x + 150 : 5, badge ? badge.y + 150 : 5);
  await h.sleep(650);
  const leave = await p.evaluate(() => window.__badgeLeave);
  const drift = leave.length ? Math.max(...leave.map((q) => Math.hypot(q.x - leave[leave.length - 1].x, q.y - leave[leave.length - 1].y))) : NaN;
  expect(leave.length > 5 && drift < 1, `the mouse away: the badge shrinks back in place (drifted at most ${drift.toFixed(1)} px over ${leave.length} frames)`);
  await p.mouse.move(5, 5);
  // Laid out again with the moves kept (the states' descriptions off: every state another size): still on their diamonds
  await p.click('#include-descriptions-checkbox').catch(() => {});
  await h.sleep(3000);
  const relaid = await choiceGaps();
  expect(relaid.length > 20 && relaid[0][2] <= 6, `laid out again, the moves kept: every choice's transitions on its diamond (worst: ${relaid[0]?.[0]}, ${relaid[0]?.[2]} units off, ${relaid[0]?.[3]})`);
  await p.screenshot({ path: h.out('choice-relaid.png') });
  await p.click('#include-descriptions-checkbox').catch(() => {});
  await h.sleep(3000);
  // (a close look)
  const ib2 = await p.evaluate((id) => { const r = [...document.querySelectorAll('#mermaid-canvas-area g.node')].find((n) => n.id.endsWith(id.replace(/^.*?(choice_)/, '$1'))).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, idleChoice.id);
  await p.mouse.move(ib2.x, ib2.y);
  await p.keyboard.down('Control');
  for (let i = 0; i < 22; i++) {
    await p.mouse.wheel({ deltaY: -120 });
    await h.sleep(40);
  }
  await p.keyboard.up('Control');
  await h.sleep(900);
  await p.mouse.move(5, 500);
  await h.sleep(400);
  const ib3 = await p.evaluate((id) => { const r = [...document.querySelectorAll('#mermaid-canvas-area g.node')].find((n) => n.id.endsWith(id.replace(/^.*?(choice_)/, '$1'))).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; }, idleChoice.id);
  await p.screenshot({ path: h.out('choice-sideways.png'), clip: { x: Math.max(0, ib3.x - 220), y: Math.max(0, ib3.y - 220), width: 440, height: 440 } });
  const sizeNow = async () => (await choices()).find((c) => /choice_TABLEMANAGER_CLAMPED_/.test(c.id))?.size ?? 0;
  const sizes = {};
  for (const v of ['small', 'large', 'medium']) {
    await p.select('#choice-size-select', v);
    await h.sleep(2500);
    sizes[v] = await sizeNow();
  }
  expect(sizes.small < sizes.medium && sizes.medium < sizes.large && (await p.evaluate(() => localStorage.getItem('kss.choiceSize'))) === 'medium', `the Choices size: small ${sizes.small}, medium ${sizes.medium}, large ${sizes.large} (kept)`);
  // An arm's condition: edited on its label (the transition is its state's, not the diamond's)
  await p.evaluate(() => [...document.getElementById('state-list-item-TABLEMANAGER_CLAMPED').querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click());
  await h.sleep(1500);
  const armLabel = await p.evaluate(() => {
    const l = [...document.querySelectorAll('#mermaid-diagram-svg-container g.edgeLabel')].find((x) => /^choice_TABLEMANAGER_CLAMPED_\d+->/.test(x.getAttribute('data-edge-id') || x.getAttribute('data-linked-path-id') || '') && x.getBoundingClientRect().width > 4);
    if (!l) return null;
    const r = l.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, key: l.getAttribute('data-edge-id') || l.getAttribute('data-linked-path-id'), text: l.textContent.trim() };
  });
  if (armLabel) {
    // (its label may be outside the view: the right-click sent to it)
    await p.evaluate((key) => { const l = [...document.querySelectorAll('#mermaid-diagram-svg-container g.edgeLabel')].find((x) => (x.getAttribute('data-edge-id') || x.getAttribute('data-linked-path-id')) === key); const r = l.getBoundingClientRect(); (l.querySelector('span, p, text, rect') ?? l).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.min(innerWidth - 50, Math.max(50, r.x)), clientY: Math.min(innerHeight - 50, Math.max(50, r.y)), button: 2 })); }, armLabel.key);
    await p.waitForSelector('#context-menu-edit-condition-btn', { timeout: 3000 }).catch(() => {});
    await p.evaluate(() => document.getElementById('context-menu-edit-condition-btn')?.click());
    await p.waitForSelector('#text-prompt-input', { timeout: 3000 }).catch(() => {});
  }
  const armPrompt = await p.evaluate(() => ({ title: document.getElementById('text-prompt-dialog')?.getAttribute('aria-label') ?? '', value: document.getElementById('text-prompt-input')?.value ?? '', inline: document.getElementById('text-prompt-dialog')?.getAttribute('data-inline') === 'true' }));
  const armTo = armLabel?.key?.split('->')[1];
  expect(!!armLabel && armPrompt.title === `Condition of TABLEMANAGER_CLAMPED → ${armTo}` && armPrompt.value.length > 0 && armPrompt.inline, `an arm (${armLabel?.key}): "${armPrompt.title}", on its label, its condition "${armPrompt.value}"`);
  await p.keyboard.press('Escape');
  await h.sleep(300);
  await p.click('#choice-nodes-checkbox');
  await h.sleep(2500);
  expect((await choices()).length === 0, 'off again: gone');
  // (every edge moved on the canvas still orthogonal, as ELK draws it: not only the ones checked above)
  const slantedLeft = await h.reroutedSlanted(p);
  expect(slantedLeft.length === 0, `the moved edges on the canvas orthogonal (${slantedLeft.slice(0, 3).join(" | ") || "none slanted"})`);
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
