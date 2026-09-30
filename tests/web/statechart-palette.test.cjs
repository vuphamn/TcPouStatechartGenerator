// The canvas as a statechart editor: palette elements dropped on the canvas / a state / a composite become ST —
// a state (placed where dropped), a composite around it ({region} in the enum) and a state in it, the initial
// state (the declaration), a choice (IF / ELSIF), a final state (end node), a transition dragged onto a state
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;
const MIME = 'application/x-kss-statechart-element';

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
  expect(!!(await p.$('#statechart-palette')), 'the palette is on the canvas');
  const corner = await p.evaluate(() => { const a = document.getElementById('mermaid-canvas-area').getBoundingClientRect(); const r = document.getElementById('statechart-palette').getBoundingClientRect(); return { dx: r.left - a.left, dy: r.top - a.top }; });
  expect(corner.dx >= 0 && corner.dx < 16 && corner.dy >= 0 && corner.dy < 16, `at the canvas' top-left corner (${Math.round(corner.dx)}, ${Math.round(corner.dy)} px in)`);

  const editor = async (tab, id) => {
    await p.click(`#dock-tab-${tab}`);
    await p.waitForSelector(`#${id}`);
    await h.sleep(400);
    const v = await p.$eval(`#${id}`, (e) => e.value);
    await p.click('#dock-tab-diagram');
    await h.sleep(500);
    return v;
  };
  const drop = (kind, x, y) => p.evaluate((kind, x, y, MIME) => {
    const dt = new DataTransfer();
    dt.setData(MIME, kind);
    const el = document.elementFromPoint(x, y);
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
  }, kind, x, y, MIME);
  const nodeBox = (id) => p.evaluate((id) => {
    const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, id);
  const clusterBox = (label) => p.evaluate((label) => {
    const c = [...document.querySelectorAll('#mermaid-canvas-area g.cluster')].find((x) => (x.querySelector('.cluster-label, .nodeLabel, text')?.textContent ?? '').trim() === label);
    if (!c) return null;
    const r = (c.querySelector(':scope > rect') ?? c).getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, label);
  const hasEdge = (from, to) => p.evaluate((from, to) => !!document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${from}->${to}"]`), from, to);
  const waitFor = async (fn, ms = 6000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await h.sleep(200); } return false; };
  const answer = async (text) => {
    await p.waitForSelector('#text-prompt-input', { timeout: 5000 });
    await p.evaluate(() => document.getElementById('text-prompt-input').select());
    if (text !== undefined) { await p.keyboard.press('Backspace'); await p.keyboard.type(text); }
    await p.keyboard.press('Enter');
    await h.sleep(300);
  };
  const goTo = async (state) => {
    await p.evaluate((s) => [...document.getElementById(`state-list-item-${s}`).querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click(), state);
    await h.sleep(1200);
  };
  // An empty point of the canvas (no node, edge or cluster around it), in the chart's own box (a wide chart is
  // drawn letterboxed in the canvas: a state dropped beside that box is not drawn where it was dropped)
  const emptyPoint = () => p.evaluate(() => {
    const area = document.getElementById('mermaid-canvas-area').getBoundingClientRect();
    const svg = document.querySelector('#mermaid-diagram-svg-container svg')?.getBoundingClientRect();
    for (let fy = 0.2; fy < 0.9; fy += 0.05) for (let fx = 0.25; fx < 0.9; fx += 0.05) {
      const x = area.x + area.width * fx, y = area.y + area.height * fy;
      if (svg && (x < svg.left + 40 || x > svg.right - 40 || y < svg.top + 40 || y > svg.bottom - 40)) continue;
      const ok = [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30], [30, 30], [-30, -30]].every(([dx, dy]) => {
        const e = document.elementFromPoint(x + dx, y + dy);
        return e && document.getElementById('mermaid-canvas-area').contains(e) && !e.closest('g.node, g.edgeLabel, g.edgePaths, g.cluster, path, #statechart-palette, button, [role="dialog"]');
      });
      if (ok) return { x, y };
    }
    return null;
  });

  // 1. State: dropped on the empty canvas, placed there
  const NEW = S('NEW_STATE');
  let pt = await emptyPoint();
  expect(!!pt, 'an empty point on the canvas');
  await drop('state', pt.x, pt.y);
  const initialName = await p.$eval('#text-prompt-input', (e) => e.value).catch(() => '');
  expect(initialName === NEW, `the name offered: ${initialName}`);
  await answer();
  expect(await waitFor(() => nodeBox(NEW)), `${NEW} on the canvas`);
  await h.sleep(800);
  const box = await nodeBox(NEW);
  expect(Math.hypot(box.x - pt.x, box.y - pt.y) < 30, `placed where it was dropped (${Math.round(Math.hypot(box.x - pt.x, box.y - pt.y))} px off)`);
  let dut = await editor('enum', 'st-dut-editor');
  expect(dut.includes(NEW), 'the enum has it');
  let code = await editor('method', 'method-implementation-editor');
  expect(new RegExp(`\\n\\s*${NEW}:\\s*\\n`).test(code), 'doState() has its branch');

  // 2. Composite dropped on it: a {region} around it; a State dropped in the composite
  await goTo(NEW);
  let b = await nodeBox(NEW);
  await drop('composite', b.x, b.y);
  await answer('Waiting');
  expect(await waitFor(() => clusterBox('Waiting')), 'the composite Waiting is on the canvas');
  dut = await editor('enum', 'st-dut-editor');
  expect(/\{region "Waiting"\}\r?\n\s*TABLEMANAGER_NEW_STATE,?\r?\n\s*\{endregion\}/.test(dut), 'the enum: {region "Waiting"} around it');
  await goTo(NEW);
  const cb = await clusterBox('Waiting');
  b = await nodeBox(NEW);
  // A point in the composite, off the node
  const inside = { x: (cb.left + b.left) / 2 < b.left - 8 ? (cb.left + b.left) / 2 : b.x, y: b.bottom + (cb.bottom - b.bottom) / 2 };
  await drop('state', inside.x, inside.y);
  const NEW2 = S('NEW_STATE2');
  expect((await p.$eval('#text-prompt-dialog', (e) => e.innerText).catch(() => '')).includes('in Waiting'), 'the prompt: a new state in Waiting');
  await answer(NEW2);
  expect(await waitFor(() => nodeBox(NEW2)), `${NEW2} on the canvas`);
  dut = await editor('enum', 'st-dut-editor');
  expect(/\{region "Waiting"\}\r?\n\s*TABLEMANAGER_NEW_STATE,\r?\n\s*TABLEMANAGER_NEW_STATE2,?\r?\n\s*\{endregion\}/.test(dut), 'the enum: it is in the region');
  await goTo(NEW2);
  const cb2 = await clusterBox('Waiting');
  const b2 = await nodeBox(NEW2);
  expect(cb2 && b2.left >= cb2.left - 2 && b2.right <= cb2.right + 2 && b2.top >= cb2.top - 2 && b2.bottom <= cb2.bottom + 2, 'and in the composite on the canvas');

  // 3. Initial dropped on NEW_STATE (in Waiting): the composite's initial state, marked in the enum
  const mermaid = async () => {
    await p.click('#dock-tab-markdown');
    await p.waitForSelector('#markdown-code-scroll-container', { timeout: 10000 });
    await h.sleep(500);
    const text = await p.$eval('#markdown-code-scroll-container', (e) => e.innerText);
    await p.click('#dock-tab-diagram');
    await h.sleep(500);
    return text;
  };
  await goTo(NEW);
  b = await nodeBox(NEW);
  await drop('initial', b.x, b.y);
  await h.sleep(800);
  let status = await p.$eval('#status-message', (e) => e.textContent).catch(() => '');
  expect(/TABLEMANAGER_NEW_STATE is the initial state of Waiting/.test(status), `the composite's initial state: ${status}`);
  dut = await editor('enum', 'st-dut-editor');
  expect(/TABLEMANAGER_NEW_STATE,? \/\/ @initial/.test(dut), 'the enum: // @initial on its line');
  expect(/startNode_Waiting\(\(" "\)\) --> TABLEMANAGER_NEW_STATE\b/.test(await mermaid()), 'the chart: Waiting starts in it');
  // The machine's initial state: from the state's menu (SM_TableManager inherits machineState: set in initialize())
  await goTo(NEW);
  b = await nodeBox(NEW);
  await p.mouse.click(b.x, b.y, { button: 'right' });
  await h.sleep(400);
  expect(await p.evaluate(() => { const x = document.getElementById('context-menu-set-initial-btn'); x?.click(); return !!x; }), 'the state\'s menu: Set as initial state');
  await h.sleep(800);
  status = await p.$eval('#status-message', (e) => e.textContent).catch(() => '');
  expect(/TABLEMANAGER_NEW_STATE is the initial state: machineState := TABLEMANAGER_NEW_STATE in initialize\(\)/.test(status), `the machine's initial state: ${status}`);
  expect(/startNode\(\(" "\)\) --> TABLEMANAGER_NEW_STATE\b/.test(await mermaid()), 'the chart starts in it');

  // 4. Choice dropped on NEW_STATE: IF bA → NEW_STATE2, ELSIF bB → IDLE_FEED_OFF
  await goTo(NEW);
  b = await nodeBox(NEW);
  await drop('choice', b.x, b.y);
  await p.waitForSelector('#choice-dialog', { timeout: 5000 });
  await p.type('#choice-condition-0', 'bA');
  await p.select('#choice-target-0', NEW2);
  await p.type('#choice-condition-1', 'bB');
  await p.select('#choice-target-1', S('IDLE_FEED_OFF'));
  await p.click('#choice-submit');
  expect(await waitFor(async () => (await hasEdge(NEW, NEW2)) && (await hasEdge(NEW, S('IDLE_FEED_OFF')))), 'the choice: two transitions out of it');
  code = await editor('method', 'method-implementation-editor');
  expect(new RegExp(`\\n\\s*${NEW}:\\s*\\n\\s*IF bA THEN\\s*\\n\\s*machineState := TABLEMANAGER_NEW_STATE2;\\s*\\n\\s*ELSIF bB THEN\\s*\\n\\s*machineState := TABLEMANAGER_IDLE_FEED_OFF;\\s*\\n\\s*END_IF`).test(code), 'doState(): IF / ELSIF in its branch');

  // 5. Final dropped on the canvas: a new final state, an end node
  pt = await emptyPoint();
  await drop('final', pt.x, pt.y);
  const DONE = await p.$eval('#text-prompt-input', (e) => e.value).catch(() => '');
  expect(/^TABLEMANAGER_DONE\d*$/.test(DONE), `the final state's name: ${DONE}`);
  await answer();
  expect(await waitFor(() => nodeBox(DONE)), `${DONE} on the canvas`);
  expect(await p.evaluate(() => !!document.querySelector('#mermaid-canvas-area g.node[id*="endNode"]')), 'an end node');
  code = await editor('method', 'method-implementation-editor');
  dut = await editor('enum', 'st-dut-editor');
  expect(new RegExp(`\\n\\s*${DONE}\\s*,?\\s*// @final`).test(dut), 'the enum: // @final on its line');

  // 6. Transition dragged onto NEW_STATE2, then a click on DONE
  await goTo(NEW2);
  b = await nodeBox(NEW2);
  await drop('transition', b.x, b.y);
  expect(!!(await p.$('#connect-mode-hint')), 'connect mode from NEW_STATE2');
  await goTo(DONE);
  const d = await nodeBox(DONE);
  await p.mouse.click(d.x, d.y);
  await answer('bDone');
  // (the composite's last state: the generator draws its way out from the composite)
  expect(await waitFor(async () => (await hasEdge(NEW2, DONE)) || (await hasEdge('Waiting', DONE))), `the transition NEW_STATE2 → ${DONE}`);

  // 7. Note: dropped on the canvas, its card's corner where it was dropped
  pt = await emptyPoint();
  await drop('note', pt.x, pt.y);
  await p.waitForSelector('#note-textarea', { timeout: 5000 });
  await p.type('#note-textarea', 'Check the door sensor');
  await p.click('#note-dialog-save-btn');
  await h.sleep(800);
  const card = await p.evaluate(() => {
    const c = [...document.querySelectorAll('[id^="note-overlay-note_"]')].pop();
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, text: c.innerText };
  });
  expect(!!card && Math.abs(card.x - pt.x) <= 3 && Math.abs(card.y - pt.y) <= 3 && /Check the door sensor/.test(card.text), `the note is where it was dropped (${card ? `${Math.round(card.x - pt.x)}, ${Math.round(card.y - pt.y)} px off` : 'none'})`);

  // Its Style popover at screen size, however far the canvas is zoomed in
  for (let i = 0; i < 4; i++) { await p.click('#zoom-in-button'); await h.sleep(150); }
  await h.sleep(500);
  const noteId = await p.evaluate(() => [...document.querySelectorAll('[id^="note-overlay-note_"]')].pop()?.id.replace('note-overlay-', ''));
  await p.evaluate((id) => document.getElementById(`note-overlay-${id}`)?.scrollIntoView?.({ block: 'center', inline: 'center' }), noteId);
  await p.evaluate((id) => document.getElementById(`note-overlay-${id}`)?.click(), noteId);
  await h.sleep(300);
  await p.evaluate((id) => document.getElementById(`style-note-${id}`)?.click(), noteId);
  await h.sleep(500);
  const pop = await p.evaluate(() => { const e = document.querySelector('[id^="note-style-popover-"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top, bottom: r.bottom }; });
  expect(!!pop && Math.abs(pop.w - 288) < 12 && pop.top >= 0 && pop.bottom <= 1000, `the note's Style popover at screen size when zoomed in: ${pop ? `${Math.round(pop.w)}×${Math.round(pop.h)} px` : 'none'}`);
  await p.keyboard.press('Escape');
  for (let i = 0; i < 4; i++) { await p.click('#zoom-out-button'); await h.sleep(150); }
  await h.sleep(500);

  // 8. Completion transition: NEW_STATE2 → IDLE_FEED_OFF, no condition
  await goTo(NEW2);
  b = await nodeBox(NEW2);
  await drop('completion', b.x, b.y);
  await goTo(S('IDLE_FEED_OFF'));
  let t = await nodeBox(S('IDLE_FEED_OFF'));
  await p.mouse.click(t.x, t.y);
  await h.sleep(800);
  code = await editor('method', 'method-implementation-editor');
  expect(/machineState := TABLEMANAGER_IDLE_FEED_OFF; \/\/ completion transition/.test(code) && !(await p.$('#text-prompt-dialog')), 'completion: an assignment with no condition, no prompt');

  // 9. Exception transition from the composite Waiting → ERROR: in preProcess()
  await goTo(NEW);
  const cw = await clusterBox('Waiting');
  b = await nodeBox(NEW);
  // (a point in the composite off its states: its top edge, under the label)
  await drop('exception', cw.left + 4, cw.top + 3);
  const hintText = await p.$eval('#connect-mode-hint', (e) => e.textContent).catch(() => '');
  expect(/Waiting/.test(hintText), `connect mode from the composite: "${hintText.trim()}"`);
  await goTo(S('ERROR'));
  t = await nodeBox(S('ERROR'));
  await p.mouse.click(t.x, t.y);
  await answer('bAbortWaiting');
  expect(await waitFor(() => hasEdge('Waiting', S('ERROR'))), 'the chart: Waiting → ERROR');

  // 10. Fork / Join on CLAMPED: two parallel regions, then HALT_FEED; a transition drawn in region A
  const F = S('CLAMPED');
  await goTo(F);
  b = await nodeBox(F);
  await drop('forkjoin', b.x, b.y);
  await p.waitForSelector('#forkjoin-dialog', { timeout: 5000 });
  const vars = await p.$$eval('[id^="forkjoin-variable-"]', (e) => e.map((x) => x.value));
  const sts = await p.$$eval('[id^="forkjoin-states-"]', (e) => e.map((x) => x.value));
  expect(vars.join() === 'regionA,regionB' && sts[0] === `${F}_A_RUN, ${F}_A_DONE`, `the regions offered: ${vars.join(', ')} | ${sts.join(' | ')}`);
  await p.select('#forkjoin-target', S('HALT_FEED'));
  await p.click('#forkjoin-submit');
  expect(await waitFor(() => clusterBox('regionA')), 'the chart: region A in CLAMPED');
  const inRegion = async (state, region) => {
    const c = await clusterBox(region);
    const n = await nodeBox(state);
    return !!c && !!n && n.left >= c.left - 2 && n.right <= c.right + 2 && n.top >= c.top - 2 && n.bottom <= c.bottom + 2;
  };
  await goTo(`${F}_A_RUN`);
  expect((await inRegion(`${F}_A_RUN`, 'regionA')) && (await inRegion(`${F}_B_DONE`, 'regionB')), 'the regions\' states in their regions');
  expect(await waitFor(() => hasEdge(F, S('HALT_FEED'))), 'the join: CLAMPED → HALT_FEED');
  const inDoState = await p.evaluate(() => Number(document.body.innerText.match(/(\d+) in doState\(\)/)?.[1] ?? 0));
  expect(inDoState >= 33, `Identified States: the regions' CASEs do not end doState()'s (${inDoState} in doState())`);
  code = await editor('method', 'method-implementation-editor');
  expect(code.includes('// fork: regionA, regionB run in parallel') && code.includes(`IF regionA = ${F}_A_DONE AND regionB = ${F}_B_DONE THEN`), 'doState(): the fork and the join');
  dut = await editor('enum', 'st-dut-editor');
  expect(dut.includes(`${F}_A_RUN`) && dut.includes(`${F}_B_DONE`), 'the enum: the regions\' states');
  // A transition in region A: set with regionA
  await goTo(`${F}_A_RUN`);
  b = await nodeBox(`${F}_A_RUN`);
  await drop('transition', b.x, b.y);
  t = await nodeBox(`${F}_A_DONE`);
  await p.mouse.click(t.x, t.y);
  await answer('bClampDone');
  expect(await waitFor(() => hasEdge(`${F}_A_RUN`, `${F}_A_DONE`)), 'the region\'s transition on the canvas');
  code = await editor('method', 'method-implementation-editor');
  expect(new RegExp(`IF bClampDone THEN\\s*\\n\\s*regionA := ${F}_A_DONE;`).test(code), 'written with the region\'s variable: regionA := …');
  // Across regions: refused
  await goTo(`${F}_A_RUN`);
  b = await nodeBox(`${F}_A_RUN`);
  await drop('transition', b.x, b.y);
  t = await nodeBox(`${F}_B_DONE`);
  await p.mouse.click(t.x, t.y);
  await h.sleep(500);
  expect(/is not in .* region \(regionA\)/.test(await p.$eval('#status-message', (e) => e.textContent).catch(() => '')) && !(await p.$('#text-prompt-dialog')), 'a transition into another region: refused');


  // 11. Pointer ends connect mode
  await p.click('#palette-transition').catch(() => {});
  await p.click('#palette-pointer');
  await h.sleep(300);
  expect(!(await p.$('#connect-mode-hint')), 'Pointer: no connect mode');

  await p.screenshot({ path: h.out('statechart-palette.png') });
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
