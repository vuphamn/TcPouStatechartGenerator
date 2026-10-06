// Every sample: transitions' start endpoints (a spread of each chart's edges) dragged onto another state: the code
// moved (the status says so; the chart has the edge from the new state), every state where it was on the canvas
// (locked or not), every other transition drawn as it was (its route, its label), the moved one still into its state
// at the same spot and its label on it, Ctrl+Z puts the code back (the others still as they were)
// runner-timeout: 600 (5 drops in each of the samples, each undone)
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PER_SAMPLE = Number(process.env.KSS_ENDPOINT_PER_SAMPLE) || 5;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1700, height: 1100 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => void d.accept().catch(() => {}));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  const samples = await p.$$eval('#sample-selector option', (o) => o.map((x) => x.value).filter(Boolean));
  // (the minimap closed: it covers a corner of the canvas)
  await p.evaluate(() => document.querySelector('#diagram-minimap-container button[title^="Close Minimap"]')?.click());

  // The states' places (in the drawing's own coordinates), by id
  const places = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#mermaid-diagram-svg-container svg g.node[data-state-id]')].map((n) => [n.getAttribute('data-state-id'), [Math.round(n.getCTM().e), Math.round(n.getCTM().f)]])));
  // The transitions' routes and labels (rounded), by their states and label text (parallel ones numbered)
  const routes = () => p.evaluate(() => {
    const svg = document.querySelector('#mermaid-diagram-svg-container svg');
    const out = {};
    const round = (s) => (s || '').replace(/-?\d+(\.\d+)?(e-?\d+)?/g, (n) => String(Math.round(Number(n))));
    for (const path of svg.querySelectorAll('g.edgePaths path.tc-edge-path')) {
      if (path.classList.contains('tc-edge-hitbox')) continue;
      const from = path.getAttribute('data-source-id'), to = path.getAttribute('data-target-id');
      if (!from || !to) continue;
      const pid = path.getAttribute('data-path-id');
      const label = pid ? svg.querySelector(`g.edgeLabel[data-linked-path-id="${CSS.escape(pid)}"]`) : null;
      let k = `${from}->${to}|${(label?.textContent ?? '').replace(/\s+/g, ' ').trim()}`;
      for (let i = 2; out[k]; i++) k = k.replace(/#\d+$/, '') + `#${i}`;
      // (a label with no text: nothing seen, not compared)
      out[k] = `${round(path.getAttribute('d'))} @ ${label?.textContent?.trim() ? round(label.getAttribute('transform')) : ''}`;
    }
    // (the composites' boxes too)
    for (const c of svg.querySelectorAll('g.cluster, g.statediagram-cluster')) {
      const r = c.querySelector(':scope > rect:not(.inner), :scope > g > rect.outer');
      const b = r?.getBoundingClientRect();
      const name = c.getAttribute('data-id') || c.id.replace(/^.*?render-[a-z0-9]+-/i, '').replace(/^state-/, '').replace(/-\d+$/, '');
      if (b) out[`cluster:${name}`] =round(`${b.x},${b.y},${b.width},${b.height}`);
    }
    return out;
  });
  // The ones redrawn: in both, not between the edge's states (old or new), differing
  const redrawn = (a, b, pairs) => Object.keys(a).filter((k) => b[k] !== undefined && !pairs.some((pr) => k.startsWith(`${pr}|`)) && a[k] !== b[k]);
  // Where the transitions between two states end (their routes' last points, in the drawing's coordinates)
  const endsOf = (from, to) => p.evaluate((from, to) => [...document.querySelectorAll('#mermaid-diagram-svg-container svg g.edgePaths path.tc-edge-path')]
    .filter((x) => !x.classList.contains('tc-edge-hitbox') && x.getAttribute('data-source-id') === from && x.getAttribute('data-target-id') === to)
    .map((x) => { const n = (x.getAttribute('d') || '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []; return [n[n.length - 2], n[n.length - 1]]; }), from, to);
  // How far the transitions' labels between two states are from their own routes (screen px; those with a text)
  const labelGaps = (from, to) => p.evaluate((from, to) => {
    const svg = document.querySelector('#mermaid-diagram-svg-container svg');
    const out = [];
    for (const path of svg.querySelectorAll('g.edgePaths path.tc-edge-path')) {
      if (path.classList.contains('tc-edge-hitbox') || path.getAttribute('data-source-id') !== from || path.getAttribute('data-target-id') !== to) continue;
      const label = svg.querySelector(`g.edgeLabel[data-linked-path-id="${CSS.escape(path.getAttribute('data-path-id') || '')}"]`);
      if (!label?.textContent?.trim()) continue;
      const r = label.getBoundingClientRect();
      const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      const m = path.getScreenCTM();
      const L = path.getTotalLength();
      let best = Infinity;
      for (let i = 0; i <= 200; i++) { const q = path.getPointAtLength((L * i) / 200).matrixTransform(m); best = Math.min(best, Math.hypot(q.x - c.x, q.y - c.y)); }
      out.push(Math.round(best));
    }
    return out;
  }, from, to);
  const keys = () => p.evaluate(() => [...new Set([...document.querySelectorAll('#mermaid-diagram-svg-container svg path.tc-edge-path[data-edge-key]')].map((x) => x.getAttribute('data-edge-key')))]);
  // The edges whose start can be dragged: both ends states drawn (not the initial one, not a composite's border)
  const candidates = () => p.evaluate(() => {
    const svg = document.querySelector('#mermaid-diagram-svg-container svg');
    const state = (id) => !!svg.querySelector(`g.node[data-state-id="${CSS.escape(id)}"]`);
    return [...new Set([...svg.querySelectorAll('path.tc-edge-path[data-edge-key]')].map((x) => x.getAttribute('data-edge-key')))].filter((k) => {
      const [from, to] = k.split('->');
      // (a sub-machine's transitions, <state>__<method>__<name>: changed in its method, not by dragging)
      return from !== '[*]' && from !== 'AnyState' && to !== '[*]' && state(from) && state(to) && !from.includes('__') && !to.includes('__');
    });
  });
  // A point of the edge's own line on screen (not covered), and the state to drop on (near, not its ends)
  const plan = (key) => p.evaluate((key) => {
    const svg = document.querySelector('#mermaid-diagram-svg-container svg');
    const [from, to] = key.split('->');
    let pt = null;
    for (const el of svg.querySelectorAll(`path.tc-edge-path[data-edge-key="${CSS.escape(key)}"]`)) {
      const len = el.getTotalLength(); const m = el.getScreenCTM();
      for (const f of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
        const q = el.getPointAtLength(len * f); const x = q.x * m.a + q.y * m.c + m.e; const y = q.x * m.b + q.y * m.d + m.f;
        // (its line, or its wider hit area: the path just before it)
        const hit = document.elementFromPoint(x, y);
        const line = hit?.classList?.contains('tc-edge-hitbox') ? hit.previousElementSibling : hit;
        if (line?.getAttribute('data-edge-key') === key) { pt = { x, y }; break; }
      }
      if (pt) break;
    }
    const src = svg.querySelector(`g.node[data-state-id="${CSS.escape(from)}"]`)?.getBoundingClientRect();
    const area = document.getElementById('mermaid-canvas-area').getBoundingClientRect();
    const others = [...svg.querySelectorAll('g.node[data-state-id]')].filter((n) => { const id = n.getAttribute('data-state-id'); return id !== from && id !== to && id !== 'AnyState' && id !== '[*]' && !/startNode|endNode/.test(id) && !/_start$|_end$|^root_start$/.test(id) && !id.includes('__') && !n.classList.contains('choice'); })
      .map((n) => ({ id: n.getAttribute('data-state-id'), r: n.querySelector('rect, polygon')?.getBoundingClientRect() ?? n.getBoundingClientRect() }))
      .filter((o) => o.r.width > 6 && o.r.height > 4 && o.r.left > area.left && o.r.right < area.right && o.r.top > area.top && o.r.bottom < area.bottom)
      .map((o) => ({ ...o, d: src ? Math.hypot(o.r.x - src.x, o.r.y - src.y) : 0 }))
      .sort((a, b) => a.d - b.d);
    // (a point of the state not covered: its centre, else nearer its corners)
    const spot = (o) => [[0.5, 0.5], [0.25, 0.3], [0.75, 0.3], [0.25, 0.7], [0.75, 0.7]].map(([fx, fy]) => ({ x: o.r.x + o.r.width * fx, y: o.r.y + o.r.height * fy })).find((q) => document.elementFromPoint(q.x, q.y)?.closest('g.node')?.getAttribute('data-state-id') === o.id);
    const t = others.find((o) => spot(o));
    return pt && t ? { pt, target: t.id, tgt: spot(t) } : { pt, target: null };
  }, key);
  const status = () => p.$eval('#status-message', (e) => e.textContent.trim()).catch(() => '');
  // The canvas panned (dragged by an empty spot) to bring a state to its middle: as a user would, when an edge's start
  // is under a panel or its line covered
  const panTo = async (id) => {
    const r = await p.evaluate((id) => {
      const area = document.getElementById('mermaid-canvas-area').getBoundingClientRect();
      const n = document.querySelector(`#mermaid-diagram-svg-container svg g.node[data-state-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
      if (!n) return null;
      for (let gy = 0.3; gy <= 0.8; gy += 0.05) for (let gx = 0.3; gx <= 0.8; gx += 0.05) {
        const x = area.left + area.width * gx;
        const y = area.top + area.height * gy;
        const e = document.elementFromPoint(x, y);
        if (e && document.getElementById('mermaid-canvas-area').contains(e) && !e.closest('g.node, g.edgeLabel, g.cluster-label, path, .tc-edge-handle, button, [role="toolbar"]')) {
          return { x, y, dx: area.left + area.width / 2 - (n.x + n.width / 2), dy: area.top + area.height / 2 - (n.y + n.height / 2) };
        }
      }
      return null;
    }, id);
    if (!r) return false;
    await p.mouse.move(r.x, r.y);
    await p.mouse.down();
    for (let i = 1; i <= 10; i++) await p.mouse.move(r.x + (r.dx * i) / 10, r.y + (r.dy * i) / 10);
    await p.mouse.up();
    await h.sleep(500);
    return true;
  };
  // The edge selected, its start handle found (where a user can grab it: not under anything)
  const handleOf = () => p.evaluate(() => {
    const el = [...document.querySelectorAll('#mermaid-canvas-area .tc-edge-handle[data-handle-type="start"]')].find((x) => { const q = x.getBoundingClientRect(); const e = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); return q.width > 0 && e && x.contains(e); });
    const r = el?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });

  for (const sample of samples) {
    await p.select('#sample-selector', sample);
    await p.waitForFunction(() => document.querySelectorAll('#mermaid-diagram-svg-container svg g.node').length > 2, { timeout: 30000 }).catch(() => {});
    await h.sleep(3000);
    const all = await candidates();
    const step = Math.max(1, Math.floor(all.length / PER_SAMPLE));
    const picked = all.filter((_, i) => i % step === 0).slice(0, PER_SAMPLE);
    expect(picked.length > 0, `${sample}: ${all.length} transitions with a start to drag (trying ${picked.length})`);
    for (const key of picked) {
      const [from, to] = key.split('->');
      let pl = await plan(key);
      // (its line covered, or its start not to be grabbed there: the canvas panned to its state, then again)
      let hd = null;
      if (pl.pt && pl.target) {
        await p.mouse.click(pl.pt.x, pl.pt.y);
        await h.sleep(600);
        hd = await handleOf();
      }
      if (!hd) {
        await p.keyboard.press('Escape');
        // (Go to State: its source centred, zoomed in)
        await p.evaluate((id) => document.getElementById(`btn-goto-state-${id}`)?.click(), from);
        await h.sleep(1200);
        if (!(await plan(key)).pt) await panTo(from);
        pl = await plan(key);
        // (zoomed in too far for a state to drop on: out a step or two)
        for (let z = 0; z < 3 && pl.pt && !pl.target; z++) {
          await p.click('#zoom-out-button').catch(() => {});
          await h.sleep(500);
          pl = await plan(key);
        }
        if (pl.pt && pl.target) {
          await p.mouse.click(pl.pt.x, pl.pt.y);
          await h.sleep(600);
          hd = await handleOf();
        }
      }
      if (!pl.pt || !pl.target) {
        expect(false, `${sample} ${key}: on screen to grab and a state to drop on (${JSON.stringify(pl)})`);
        continue;
      }
      if (!hd) {
        const cover = await p.evaluate(() => [...document.querySelectorAll('#mermaid-canvas-area .tc-edge-handle[data-handle-type="start"]')].map((x) => { const q = x.getBoundingClientRect(); const e = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); return `${Math.round(q.width)}px under ${e?.tagName}.${e?.getAttribute('class') ?? ''} ${e?.closest('[data-state-id]')?.getAttribute('data-state-id') ?? ''}`; }).join(' | '));
        expect(false, `${sample} ${key}: its start handle shown when selected (${cover || 'no start handle'})`);
        await p.keyboard.press('Escape');
        continue;
      }
      const before = await places();
      const routesBefore = await routes();
      const endsBefore = await endsOf(from, to);
      const statusBefore = await status();
      await p.mouse.move(hd.x, hd.y);
      await p.mouse.down();
      for (let i = 1; i <= 16; i++) await p.mouse.move(hd.x + ((pl.tgt.x - hd.x) * i) / 16, hd.y + ((pl.tgt.y - hd.y) * i) / 16);
      await h.sleep(150);
      const drop = await p.evaluate(() => document.querySelector('.edge-drop-target')?.getAttribute('data-state-id') ?? null);
      await p.mouse.up();
      // (moved: the status says so; the chart has it from there)
      let msg = '';
      for (let i = 0; i < 20 && (msg === statusBefore || !msg); i++) { await h.sleep(250); msg = await status(); }
      await h.sleep(1500);
      const after = await places();
      const nowKeys = await keys();
      const moved = new RegExp(`\\(was ${from} →\\)`).test(msg);
      const drawn = nowKeys.some((k) => k.startsWith(`${pl.target}->`)) && (nowKeys.includes(`${pl.target}->${to}`) || nowKeys.some((k) => k.startsWith(`${pl.target}->`)));
      expect(drop === pl.target && moved && drawn, `${sample} ${key}: dropped on ${pl.target} (${drop}): ${msg.slice(0, 160)}`);
      // (every state where it was: the drop's place seen)
      const shifted = Object.keys(before).filter((id) => after[id] && (Math.abs(after[id][0] - before[id][0]) > 2 || Math.abs(after[id][1] - before[id][1]) > 2));
      expect(shifted.length === 0, `${sample} ${key}: no state moved on the canvas (${shifted.slice(0, 4).map((id) => `${id} ${before[id]}→${after[id]}`).join(', ') || 'none'})`);
      // (KSS_ENDPOINT_SHOTS=1: the canvas after each drop, in tests/.output)
      if (process.env.KSS_ENDPOINT_SHOTS) await p.screenshot({ path: h.out(`endpoint-${sample}-${key.replace(/[^\w]+/g, '_')}.png`) });
      // (the moved one: into its state at the same spot as before)
      const endsAfter = await endsOf(pl.target, to);
      const sameEnd = endsAfter.some((a) => endsBefore.some((b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 3));
      // (its label on its new route)
      const gaps = await labelGaps(pl.target, to);
      if (gaps.length) expect(gaps.some((g) => g <= 8), `${sample} ${key}: its label on its new route (${gaps.join(', ')} px off)`);
      // (drawn from its composite's border instead, merged with others: nothing of its own to compare)
      if (endsAfter.length) expect(sameEnd, `${sample} ${key}: from ${pl.target}, still into ${to} where it was (${JSON.stringify(endsBefore)} → ${JSON.stringify(endsAfter)})`);
      // (every other transition as it was drawn: its route and its label)
      const routesAfter = await routes();
      const pairs = [key, `${pl.target}->${to}`];
      const rerouted = redrawn(routesBefore, routesAfter, pairs);
      expect(rerouted.length === 0, `${sample} ${key}: no other transition redrawn (${rerouted.slice(0, 3).map((k) => `${k}: ${routesBefore[k]} → ${routesAfter[k]}`).join(' ; ') || 'none'})`);
      // (undone: the code as before, for the next one)
      await p.keyboard.press('Escape');
      await p.evaluate(() => document.activeElement?.blur());
      await p.click('#mermaid-canvas-area', { offset: { x: 5, y: 5 } }).catch(() => {});
      await p.keyboard.down('Control'); await p.keyboard.press('KeyZ'); await p.keyboard.up('Control');
      let back = false;
      for (let i = 0; i < 20 && !back; i++) { await h.sleep(250); back = (await keys()).includes(key); }
      await h.sleep(1500);
      const undone = await places();
      const strayed = Object.keys(before).filter((id) => undone[id] && (Math.abs(undone[id][0] - before[id][0]) > 2 || Math.abs(undone[id][1] - before[id][1]) > 2));
      expect(back && strayed.length === 0, `${sample} ${key}: Ctrl+Z: back from ${from}, every state where it was (${strayed.slice(0, 3).map((id) => `${id} ${before[id]}→${undone[id]}`).join(', ') || 'none moved'})`);
      const routesUndone = await routes();
      const reroutedBack = redrawn(routesBefore, routesUndone, pairs);
      expect(reroutedBack.length === 0, `${sample} ${key}: Ctrl+Z: no other transition redrawn (${reroutedBack.slice(0, 3).map((k) => `${k}: ${routesBefore[k]} → ${routesUndone[k]}`).join(' ; ') || 'none'})`);
      await h.sleep(800);
    }
  }

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
