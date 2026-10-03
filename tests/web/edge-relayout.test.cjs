// Re-layout edge (a transition's right-click menu): the transition with the most turns laid out again on its own:
// fewer turns (or as few), clear of the other states, square into its state, its label on it; nothing else moved (the
// states, the other transitions and their labels as they were); Undo (the palette's) puts its route back, Redo lays it
// out again; a state of it moved afterwards: still attached; not offered for a transition back to its own state.
// Re-layout transitions (a state's menu): all its transitions laid out again, none with more turns, the others as they
// were; one Undo puts them all back. The same for a selection of states (their menu: Re-layout their transitions) and
// for a composite (its title's menu: Re-layout its transitions)
const h = require('../lib/harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await sleep(2500);

  // Each transition's line: its turns (its direction, sampled along it, horizontal / vertical), its states
  const lines = () => page.evaluate(() => {
    const out = [];
    for (const p of document.querySelectorAll('#mermaid-diagram-svg-container svg g.edgePaths path.tc-edge-path')) {
      if (p.classList.contains('tc-edge-hitbox') || !p.getAttribute('d')) continue;
      const len = p.getTotalLength();
      let dir = null;
      let turns = 0;
      let last = p.getPointAtLength(0);
      for (let s = 3; s <= len; s += 3) {
        const q = p.getPointAtLength(s);
        const dx = q.x - last.x;
        const dy = q.y - last.y;
        if (Math.hypot(dx, dy) < 2) continue;
        const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U';
        if (dir && d !== dir) turns++;
        dir = d;
        last = q;
      }
      out.push({ key: p.getAttribute('data-path-id'), from: p.getAttribute('data-source-id'), to: p.getAttribute('data-target-id'), d: p.getAttribute('d'), turns, len });
    }
    return out;
  });
  const snapshot = () => page.evaluate(() => ({
    nodes: Object.fromEntries([...document.querySelectorAll('#mermaid-diagram-svg-container svg g.node')].map((n) => [n.getAttribute('data-state-id') || n.id, n.getAttribute('transform')])),
    labels: Object.fromEntries([...document.querySelectorAll('#mermaid-diagram-svg-container svg g.edgeLabel')].map((l, i) => [`${l.getAttribute('data-linked-path-id') || i}`, l.getAttribute('transform')])),
  }));
  const menuOn = (key) => page.evaluate((key) => {
    const p = document.querySelector(`#mermaid-diagram-svg-container svg path.tc-edge-path[data-path-id="${key}"]:not(.tc-edge-hitbox)`);
    const q = p.getPointAtLength(p.getTotalLength() / 2);
    const m = p.getScreenCTM();
    const at = new DOMPoint(q.x, q.y).matrixTransform(m);
    const el = document.querySelector(`#mermaid-diagram-svg-container svg path.tc-edge-hitbox[data-path-id="${key}"]`) ?? p;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 2 }));
    return true;
  }, key);

  const before = await lines();
  const candidates = before.filter((l) => l.from && l.to && l.from !== l.to).sort((a, b) => b.turns - a.turns);
  const e = candidates[0];
  expect(!!e && e.turns >= 2, `a transition with turns: ${e ? `${e.from} → ${e.to}, ${e.turns} turns` : 'none'}`);
  const was = await snapshot();
  await menuOn(e.key);
  await page.waitForSelector('#context-menu-relayout-edge', { timeout: 4000 }).catch(() => {});
  const header = await page.evaluate(() => document.getElementById('diagram-context-menu')?.textContent ?? document.body.textContent);
  expect(header.includes(`${e.from} → ${e.to}`) || header.includes(e.from), 'its menu (right-click on it)');
  const offered = await page.evaluate(() => !!document.getElementById('context-menu-relayout-edge'));
  expect(offered, 'Re-layout edge in it');
  await page.evaluate(() => document.getElementById('context-menu-relayout-edge')?.click());
  await sleep(800);

  const after = await lines();
  const a = after.find((l) => l.key === e.key);
  expect(!!a && a.d !== e.d && a.turns <= e.turns, `laid out again: ${e.turns} → ${a?.turns} turns`);
  // (clear of the other states: no point of it inside one; its ends at its own two)
  const clear = await page.evaluate((key, from, to) => {
    const svg = document.querySelector('#mermaid-diagram-svg-container svg');
    const p = svg.querySelector(`path.tc-edge-path[data-path-id="${key}"]:not(.tc-edge-hitbox)`);
    const m = p.getScreenCTM();
    const rects = [...svg.querySelectorAll('g.node')].filter((n) => ![from, to].includes(n.getAttribute('data-state-id'))).map((n) => (n.querySelector('rect, path, polygon, circle') ?? n).getBoundingClientRect());
    const len = p.getTotalLength();
    const hits = [];
    for (let s = 0; s <= len; s += 4) {
      const q = new DOMPoint(p.getPointAtLength(s).x, p.getPointAtLength(s).y).matrixTransform(m);
      if (rects.some((r) => q.x > r.left + 2 && q.x < r.right - 2 && q.y > r.top + 2 && q.y < r.bottom - 2)) hits.push(Math.round(s));
    }
    const near = (id, s) => {
      const n = svg.querySelector(`g.node[data-state-id="${id}"]`);
      const r = (n?.querySelector('rect, path, polygon, circle') ?? n)?.getBoundingClientRect();
      const q = new DOMPoint(p.getPointAtLength(s).x, p.getPointAtLength(s).y).matrixTransform(m);
      return !!r && q.x > r.left - 12 && q.x < r.right + 12 && q.y > r.top - 12 && q.y < r.bottom + 12;
    };
    return { hits, ends: near(from, 0) && near(to, len) };
  }, e.key, e.from, e.to);
  expect(clear.hits.length === 0, `clear of the other states (${clear.hits.length ? `inside one at ${clear.hits.slice(0, 5)}` : 'yes'})`);
  expect(clear.ends, 'from its state to the other one');
  const now = await snapshot();
  const movedNodes = Object.keys(was.nodes).filter((k) => was.nodes[k] !== now.nodes[k]);
  const otherLines = before.filter((l) => l.key !== e.key && after.find((x) => x.key === l.key)?.d !== l.d);
  const otherLabels = Object.keys(was.labels).filter((k) => k !== e.key && was.labels[k] !== now.labels[k]);
  expect(!movedNodes.length && !otherLines.length && !otherLabels.length, `nothing else moved (states ${movedNodes.length}, lines ${otherLines.length}, labels ${otherLabels.length})`);
  const toast = await page.evaluate(() => document.getElementById('status-message')?.textContent ?? '');
  expect(/laid out again/.test(toast), `said (${toast.trim()})`);
  // (its label on it: at its middle)
  const labelOn = await page.evaluate((key) => {
    const svg = document.querySelector('#mermaid-diagram-svg-container svg');
    const l = svg.querySelector(`g.edgeLabel[data-linked-path-id="${key}"]`);
    if (!l || !l.textContent.trim()) return null;
    const r = l.getBoundingClientRect();
    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const p = svg.querySelector(`path.tc-edge-path[data-path-id="${key}"]:not(.tc-edge-hitbox)`);
    const m = p.getScreenCTM();
    const len = p.getTotalLength();
    let best = Infinity;
    for (let s = 0; s <= len; s += 2) {
      const q = new DOMPoint(p.getPointAtLength(s).x, p.getPointAtLength(s).y).matrixTransform(m);
      best = Math.min(best, Math.hypot(q.x - c.x, q.y - c.y));
    }
    return best;
  }, e.key);
  if (labelOn !== null) expect(labelOn < 6, `its label on it (${labelOn.toFixed(1)} px off)`);

  // Undo: its route as it was; Redo: laid out again (the drawing as it is: nothing else moves)
  const lineOf = (key) => page.evaluate((key) => document.querySelector(`#mermaid-diagram-svg-container svg path.tc-edge-path[data-path-id="${key}"]:not(.tc-edge-hitbox)`)?.getAttribute('d'), key);
  const laidOut = await lineOf(e.key);
  await page.evaluate(() => document.getElementById('palette-undo')?.click());
  await sleep(800);
  const undone = await lineOf(e.key);
  const others = async () => (await lines()).filter((l) => l.key !== e.key).map((l) => l.d).join('|');
  const othersNow = await others();
  expect(undone === e.d, `Undo: its route as it was (${undone === e.d ? 'the same' : 'changed'})`);
  await page.evaluate(() => document.getElementById('palette-redo')?.click());
  await sleep(800);
  expect((await lineOf(e.key)) === laidOut && (await others()) === othersNow, 'Redo: laid out again, the others as they were');

  // A state of it moved afterwards: still attached (its route follows)
  const tgtBox = await page.evaluate((id) => { const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`); n?.scrollIntoView?.(); const r = (n?.querySelector('rect, path') ?? n)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width } : null; }, e.to);
  const area = await page.evaluate(() => { const r = document.getElementById('mermaid-canvas-area').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
  if (tgtBox && tgtBox.x > area.l + 40 && tgtBox.x < area.r - 80 && tgtBox.y > area.t + 40 && tgtBox.y < area.b - 80) {
    await page.mouse.move(tgtBox.x, tgtBox.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(tgtBox.x + 5 * i, tgtBox.y + 4 * i);
    await page.mouse.up();
    await sleep(800);
    const end = await page.evaluate((key, to) => {
      const svg = document.querySelector('#mermaid-diagram-svg-container svg');
      const p = svg.querySelector(`path.tc-edge-path[data-path-id="${key}"]:not(.tc-edge-hitbox)`);
      if (!p) return null;
      const q = new DOMPoint(p.getPointAtLength(p.getTotalLength()).x, p.getPointAtLength(p.getTotalLength()).y).matrixTransform(p.getScreenCTM());
      const n = svg.querySelector(`g.node[data-state-id="${to}"]`);
      const r = (n.querySelector('rect, path, polygon, circle') ?? n).getBoundingClientRect();
      return q.x > r.left - 12 && q.x < r.right + 12 && q.y > r.top - 12 && q.y < r.bottom + 12;
    }, e.key, e.to);
    expect(end === true, 'its state moved afterwards: still into it');
  } else console.log('(its state off screen: the move not tried)');

  // Re-layout transitions (a state's menu): all its transitions, one Undo step
  const hub = [...new Set(after.flatMap((l) => (l.from && l.to && l.from !== l.to ? [l.from, l.to] : [])))]
    .map((id) => ({ id, n: after.filter((l) => l.from !== l.to && (l.from === id || l.to === id)).length }))
    .filter((x) => x.id !== e.from && x.id !== e.to)
    .sort((a, b) => b.n - a.n)[0];
  if (hub) {
    await page.keyboard.press('Escape');
    const before2 = await lines();
    const mine = (ls) => ls.filter((l) => l.from !== l.to && (l.from === hub.id || l.to === hub.id));
    const notMine = (ls) => ls.filter((l) => !(l.from !== l.to && (l.from === hub.id || l.to === hub.id))).map((l) => `${l.key}=${l.d}`).sort().join('|');
    await page.evaluate((id) => {
      const n = document.querySelector(`#mermaid-diagram-svg-container svg g.node[data-state-id="${id}"]`);
      const r = n.getBoundingClientRect();
      n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 2 }));
    }, hub.id);
    const item = await page.waitForSelector('#context-menu-relayout-state-edges', { timeout: 4000 }).catch(() => null);
    expect(!!item, `${hub.id}'s menu: Re-layout transitions (${hub.n} transitions)`);
    if (item) {
      await page.evaluate(() => document.getElementById('context-menu-relayout-state-edges')?.click());
      await sleep(1000);
      const after2 = await lines();
      const was = Object.fromEntries(mine(before2).map((l) => [l.key, l.turns]));
      const changed = mine(after2).filter((l) => before2.find((b) => b.key === l.key)?.d !== l.d).length;
      const worse = mine(after2).filter((l) => l.turns > (was[l.key] ?? 99));
      expect(changed >= 1 && worse.length === 0, `its transitions laid out again (${changed} of ${mine(after2).length} changed, none with more turns: ${mine(before2).map((l) => l.turns).join(',')} -> ${mine(after2).map((l) => l.turns).join(',')})`);
      expect(notMine(after2) === notMine(before2), 'the other transitions as they were');
      const said = await page.evaluate(() => document.getElementById('status-message')?.textContent ?? '');
      expect(/laid out again/.test(said), `said (${said.trim()})`);
      await page.evaluate(() => document.getElementById('palette-undo')?.click());
      await sleep(900);
      const back = await lines();
      const same = mine(before2).every((l) => back.find((b) => b.key === l.key)?.d === l.d);
      expect(same, 'one Undo: all of them as they were');
    }
  }

  // A selection (Ctrl+click two states), and a composite: their transitions laid out again, the others as they were,
  // none turning more; one Undo each
  const check = async (label, ids, open, itemId) => {
    await page.keyboard.press('Escape');
    await sleep(300);
    const before3 = await lines();
    const touches = (l) => l.from && l.to && l.from !== l.to && l.from !== '[*]' && (ids.includes(l.from) || ids.includes(l.to));
    const rest = (ls) => ls.filter((l) => !touches(l)).map((l) => `${l.key}=${l.d}`).sort().join('|');
    await open();
    const item = await page.waitForSelector(`#${itemId}`, { timeout: 4000 }).catch(() => null);
    expect(!!item, `${label}: Re-layout in its menu`);
    if (!item) return;
    await page.evaluate((id) => document.getElementById(id)?.click(), itemId);
    await sleep(1500);
    const after3 = await lines();
    const was = Object.fromEntries(before3.map((l) => [l.key, l]));
    const mine = after3.filter(touches);
    const changed = mine.filter((l) => was[l.key]?.d !== l.d).length;
    const worse = mine.filter((l) => l.turns > (was[l.key]?.turns ?? 99));
    expect(changed >= 1 && worse.length === 0, `${label}: ${changed} of ${mine.length} transitions laid out again, none turning more`);
    expect(rest(after3) === rest(before3), `${label}: the other transitions as they were`);
    await page.evaluate(() => document.getElementById('palette-undo')?.click());
    await sleep(1200);
    const back = await lines();
    expect(before3.filter(touches).every((l) => back.find((b) => b.key === l.key)?.d === l.d), `${label}: one Undo: all of them as they were`);
  };
  // (two states with turning transitions, on screen and not covered: Ctrl+clicked)
  const pickable = await page.evaluate(() => {
    const out = [];
    for (const n of document.querySelectorAll('#mermaid-diagram-svg-container svg g.node[data-state-id]')) {
      const r = n.getBoundingClientRect();
      const [x, y] = [r.x + r.width / 2, r.y + r.height / 2];
      if (document.elementFromPoint(x, y)?.closest('g.node') === n) out.push({ id: n.getAttribute('data-state-id'), x, y });
    }
    return out;
  });
  const turning = (id) => after.filter((l) => l.from !== l.to && (l.from === id || l.to === id) && l.turns >= 2).length;
  const two = pickable.filter((q) => q.id !== hub?.id && q.id !== e.from && q.id !== e.to && /^TABLEMANAGER_/.test(q.id)).sort((a, b) => turning(b.id) - turning(a.id)).slice(0, 2);
  if (two.length === 2) {
    await check(`${two[0].id} and ${two[1].id} selected`, two.map((q) => q.id), async () => {
      await page.mouse.click(two[0].x, two[0].y);
      await sleep(300);
      await page.keyboard.down('Control');
      await page.mouse.click(two[1].x, two[1].y);
      await page.keyboard.up('Control');
      await sleep(400);
      await page.mouse.click(two[0].x, two[0].y, { button: 'right' });
    }, 'context-menu-multi-relayout-btn');
  } else expect(false, `two states to select (${pickable.length} on screen)`);
  // (a composite: the one with the fewest states, its title right-clicked)
  const comp = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('#mermaid-diagram-svg-container svg g.cluster')].map((c) => ({ label: (c.querySelector('.cluster-label')?.textContent ?? '').trim(), r: (c.querySelector(':scope > rect') ?? c).getBoundingClientRect() }));
    const nodes = [...document.querySelectorAll('#mermaid-diagram-svg-container svg g.node[data-state-id]')].map((n) => ({ id: n.getAttribute('data-state-id'), r: n.getBoundingClientRect() }));
    const inside = (c) => nodes.filter((n) => n.r.left >= c.r.left && n.r.right <= c.r.right && n.r.top >= c.r.top && n.r.bottom <= c.r.bottom).map((n) => n.id);
    return cs.filter((c) => c.label).map((c) => ({ label: c.label, states: inside(c) })).filter((c) => c.states.length >= 2).sort((a, b) => a.states.length - b.states.length)[0] ?? null;
  });
  if (comp) {
    await check(`the composite ${comp.label} (${comp.states.length} states)`, comp.states, async () => {
      await page.evaluate((label) => {
        const c = [...document.querySelectorAll('#mermaid-diagram-svg-container svg g.cluster')].find((x) => (x.querySelector('.cluster-label')?.textContent ?? '').trim() === label);
        const t = c.querySelector('.cluster-label');
        const r = t.getBoundingClientRect();
        t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 2 }));
      }, comp.label);
    }, 'context-menu-composite-relayout-btn');
  } else expect(false, 'a composite with states');

  // A transition back to its own state: not offered
  const loop = after.find((l) => l.from && l.from === l.to);
  if (loop) {
    await page.keyboard.press('Escape');
    await menuOn(loop.key);
    await sleep(500);
    expect(!(await page.evaluate(() => !!document.getElementById('context-menu-relayout-edge'))), 'a loop back to its own state: not offered');
  }

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
