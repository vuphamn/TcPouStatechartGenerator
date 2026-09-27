// Transitions edited on the canvas, written to doState(): the priority from the transition's menu and with
// Alt+Up / Alt+Down, the end handle dropped on another state (the target changes), the start handle dropped on
// another state (the IF moves to that state's branch); the Method Editor shows the new code
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(1000);
  // (the palette out of the way of the transitions clicked)
  await p.click('#statechart-palette-collapse').catch(() => {});
  await h.sleep(300);

  const doState = async () => {
    await p.click('#dock-tab-method');
    await p.waitForSelector('#method-implementation-editor');
    await h.sleep(400);
    const code = await p.$eval('#method-implementation-editor', (e) => e.value);
    await p.click('#dock-tab-diagram');
    await h.sleep(500);
    return code;
  };
  // A state's branch in the code: from its label to the next label
  const branch = (code, state) => {
    const lines = code.split('\n');
    const i = lines.findIndex((l) => new RegExp(`^\\s*${state}\\s*:\\s*$`).test(l));
    const j = lines.findIndex((l, k) => k > i && /^\s*[A-Z_][A-Z0-9_]*\s*:\s*$/.test(l));
    return lines.slice(i, j < 0 ? undefined : j).join('\n');
  };
  const goTo = async (state) => {
    await p.evaluate((s) => [...document.getElementById(`state-list-item-${s}`).querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click(), state);
    await h.sleep(1200);
  };
  // A point on an edge's line that is not covered
  const edgePoint = (key) => p.evaluate((key) => {
    const el = document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`);
    if (!el) return null;
    const len = el.getTotalLength(); const m = el.getScreenCTM();
    for (const f of [0.3, 0.4, 0.5, 0.6, 0.7, 0.2, 0.8, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.15, 0.85, 0.1, 0.9]) {
      const q = el.getPointAtLength(len * f); const x = q.x * m.a + q.y * m.c + m.e; const y = q.x * m.b + q.y * m.d + m.f;
      if (document.elementFromPoint(x, y)?.getAttribute('data-edge-key') === key) return { x, y };
    }
    return null;
  }, key);
  const priorityOf = (key) => p.evaluate((key) => document.querySelector(`#mermaid-canvas-area [data-edge-id="${key}"][data-priority]`)?.getAttribute('data-priority'), key);
  const selectEdge = async (key) => {
    const pt = await edgePoint(key);
    if (!pt) return false;
    await p.mouse.click(pt.x, pt.y);
    await h.sleep(700);
    return true;
  };

  // 1. The menu: CLAMPED → REFEED_START (the ELSIF, priority 2) raised
  await goTo(S('CLAMPED'));
  const refeed = `${S('CLAMPED')}->${S('REFEED_START')}`;
  const unclamp = `${S('CLAMPED')}->${S('UNCLAMP_START')}`;
  const code0 = await doState();
  expect((await priorityOf(refeed)) === '2' && (await priorityOf(unclamp)) === '1', 'CLAMPED: UNCLAMP_START 1, REFEED_START 2');
  const pt = await edgePoint(refeed);
  await p.mouse.click(pt.x, pt.y, { button: 'right' });
  await h.sleep(400);
  const label = await p.evaluate(() => document.getElementById('context-menu-priority-up-btn')?.textContent);
  expect(/Raise priority \(2 → 1\)/.test(label || ''), `the transition's menu: "${label}"`);
  expect(await p.evaluate(() => /Priority 2 of 2/.test(document.getElementById('context-menu-priority-set-btn')?.textContent || '')), 'and Priority 2 of 2…');
  await p.evaluate(() => document.getElementById('context-menu-priority-up-btn').click());
  await h.sleep(1200);
  expect((await priorityOf(refeed)) === '1' && (await priorityOf(unclamp)) === '2', 'the chart: REFEED_START 1, UNCLAMP_START 2');
  let code = await doState();
  let br = branch(code, S('CLAMPED'));
  expect(/IF \(cmd_bStartReClamp\) THEN[\s\S]*machineState := TABLEMANAGER_REFEED_START;[\s\S]*ELSIF \(cmd_bUnclamp\) THEN[\s\S]*machineState := TABLEMANAGER_UNCLAMP_START;\s*END_IF/.test(br), 'the Method Editor: the arms swapped in doState()');

  // 2. Alt+Down on the selected transition: back to 2, the code as it was
  await goTo(S('CLAMPED'));
  expect(await selectEdge(refeed), 'the transition selected');
  expect(!(await p.$('#transition-guard-inspector')), 'a click only selects: no Transition Guard window');
  const again = await edgePoint(refeed);
  await p.mouse.click(again.x, again.y, { clickCount: 1 });
  await h.sleep(900);
  expect(!(await p.$('#transition-guard-inspector')), 'nor a second, slow click');
  await p.mouse.click(again.x, again.y, { clickCount: 1 });
  await h.sleep(120);
  await p.mouse.click(again.x, again.y, { clickCount: 2 });
  await h.sleep(600);
  expect(!!(await p.$('#transition-guard-inspector')), 'a double-click opens it');
  await p.keyboard.press('Escape');
  await h.sleep(400);
  if (!(await p.$('#mermaid-canvas-area .tc-edge-handle'))) await selectEdge(refeed);
  await p.keyboard.down('Alt');
  await p.keyboard.press('ArrowDown');
  await p.keyboard.up('Alt');
  await h.sleep(1200);
  expect((await priorityOf(refeed)) === '2', `Alt+Down: priority ${await priorityOf(refeed)}`);
  code = await doState();
  expect(code === code0, 'the code as it was');

  // 3. The end handle dropped on another state
  await goTo(S('CLAMPED'));
  for (let i = 0; i < 3; i++) { await p.click('#zoom-out-button'); await h.sleep(150); }
  await h.sleep(500);
  expect(await selectEdge(unclamp), 'CLAMPED → UNCLAMP_START selected');
  const handle = (type) => p.evaluate((type) => {
    const el = [...document.querySelectorAll(`#mermaid-canvas-area .tc-edge-handle[data-handle-type="${type}"]`)].find((x) => { const q = x.getBoundingClientRect(); const e = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); return e && x.contains(e); });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, type);
  // The nearest other state on screen (its center not covered)
  const nearState = (from, not) => p.evaluate((from, not) => {
    const list = [...document.querySelectorAll('#mermaid-canvas-area g.node[data-state-id^="TABLEMANAGER_"]')].map((n) => {
      const r = n.getBoundingClientRect(); const x = r.x + r.width / 2; const y = r.y + r.height / 2;
      const e = document.elementFromPoint(x, y);
      return { id: n.getAttribute('data-state-id'), x, y, ok: !!e && n.contains(e) && x > 50 && y > 150 && x < innerWidth - 50 && y < innerHeight - 50 && !n.querySelector('g.cluster') };
    }).filter((n) => n.ok && !not.includes(n.id) && !/ERROR|SEQ/.test(n.id));
    list.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
    return list[0] ?? null;
  }, from, not);
  const drag = async (a, b) => {
    await p.mouse.move(a.x, a.y);
    await p.mouse.down();
    for (let i = 1; i <= 20; i++) await p.mouse.move(a.x + ((b.x - a.x) * i) / 20, a.y + ((b.y - a.y) * i) / 20);
    await h.sleep(200);
    const marked = await p.evaluate(() => document.querySelector('#mermaid-canvas-area g.node.edge-drop-target')?.getAttribute('data-state-id'));
    await p.mouse.up();
    await h.sleep(1300);
    return marked;
  };
  // The end handle released inside its own state: it snaps onto the state's border, the state flashes
  const e0 = await handle('end');
  const box = await p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height }; }, S('UNCLAMP_START'));
  if (e0) {
    const into = { x: box.left + box.w * 0.7, y: box.top + box.h * 0.35 };
    await p.mouse.move(e0.x, e0.y);
    await p.mouse.down();
    for (let i = 1; i <= 15; i++) await p.mouse.move(e0.x + ((into.x - e0.x) * i) / 15, e0.y + ((into.y - e0.y) * i) / 15);
    await h.sleep(150);
    await p.mouse.up();
    await h.sleep(200);
    const flashed = await p.evaluate((id) => document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`).classList.contains('edge-drop-snapped'), S('UNCLAMP_START'));
    await h.sleep(900);
    const tip = await p.evaluate((key) => {
      const el = document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`);
      const q = el.getPointAtLength(el.getTotalLength()); const m = el.getScreenCTM();
      return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f };
    }, unclamp);
    const off = Math.min(Math.abs(tip.x - box.left), Math.abs(tip.x - box.right), Math.abs(tip.y - box.top), Math.abs(tip.y - box.bottom));
    const inside = tip.x >= box.left - 3 && tip.x <= box.right + 3 && tip.y >= box.top - 3 && tip.y <= box.bottom + 3;
    expect(inside && off < 4 && flashed, `released inside UNCLAMP_START: the end on its border (${off.toFixed(1)} px), the state flashed (${flashed})`);
  }
  const end = await handle('end');
  const target = end && (await nearState(end, [S('CLAMPED'), S('UNCLAMP_START'), S('REFEED_START')]));
  expect(!!end && !!target, `the end handle and a state to drop it on (${target?.id})`);
  if (end && target) {
    const marked = await drag(end, target);
    expect(marked === target.id, `while dragging, ${target.id} is marked`);
    code = await doState();
    br = branch(code, S('CLAMPED'));
    expect(br.includes(`machineState := ${target.id};`) && !br.includes('machineState := TABLEMANAGER_UNCLAMP_START;'), `the end: CLAMPED → ${target.id} in doState()`);
    const moved = `${S('CLAMPED')}->${target.id}`;
    expect(!!(await p.$(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${moved}"]`)), 'the chart has the new transition');

    // 4. The start handle dropped on another state: the IF moves to its branch
    await goTo(S('CLAMPED'));
    expect(await selectEdge(moved), `${moved} selected`);
    const start = await handle('start');
    const source = start && (await nearState(start, [S('CLAMPED'), target.id, S('REFEED_START')]));
    expect(!!start && !!source, `the start handle and a state to drop it on (${source?.id})`);
    if (start && source) {
      await drag(start, source);
      code = await doState();
      const before = branch(code, S('CLAMPED'));
      const after = branch(code, source.id);
      expect(!before.includes('cmd_bUnclamp) THEN') && /\tIF \(cmd_bStartReClamp\) THEN/.test(before), 'the start: the arm left CLAMPED (the ELSIF is now the IF)');
      expect(/IF \(cmd_bUnclamp\) THEN[\s\S]*machineState := TABLEMANAGER_\w+;\s*\n\s*END_IF\s*$/.test(after.trimEnd()) && after.includes(`machineState := ${target.id};`), `and is the last IF of ${source.id}'s branch`);
      expect(!!(await p.$(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${source.id}->${target.id}"]`)), `the chart: ${source.id} → ${target.id}`);
    }
  }
  await p.screenshot({ path: h.out('transition-edit.png') });
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
