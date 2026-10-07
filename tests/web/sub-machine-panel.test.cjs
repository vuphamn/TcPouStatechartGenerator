// A sub-machine in Identified States and the Enum Editor (the KAnalogMeasure sample: KANALOGMEASURE_ENABLING calls
// readDiagnostics(), its own state machine). Identified States: its states listed inside the state's box (its card and
// the sub-machine's), Expand / Collapse there and on the canvas the same setting. A sub-machine state selected on the
// canvas: its card selected and shown; its card clicked: the canvas selects it. The Enum Editor: its sub-machine's enum
// (made from its CASE labels: the sample has no .TcDUT of it; read-only), at its member; the caret on another member:
// the canvas, its card and the Method Editor (readDiagnostics() at its CASE label) follow; the Method Editor's caret in
// a branch of readDiagnostics(): its member and its card
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const P = 'KANALOGMEASURE_ENABLING';
const sub = (x) => `${P}__readDiagnostics__${x}`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await p.select('#sample-selector', 'k-analog-measure');
  await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${sub('DIAG_READ_START')}"]`, { timeout: 30000 }).catch(() => {});
  await h.sleep(1200);

  const panel = () => p.evaluate((P) => ({
    expanded: document.getElementById(`sub-machine-${P}`)?.getAttribute('data-expanded') ?? null,
    inBox: !!document.querySelector(`#state-box-${P} #state-list-item-${P}`) && !!document.querySelector(`#state-box-${P} #sub-machine-${P}`),
    cards: [...document.querySelectorAll(`#sub-machine-${P} [id^="state-list-item-"]`)].map((e) => e.id.replace(/^.*__/, '')),
    selected: [...document.querySelectorAll(`#sub-machine-${P} [aria-selected="true"]`)].map((e) => e.id.replace(/^.*__/, '')),
  }), P);
  const canvasSubs = () => p.$$eval('#mermaid-canvas-area g.node[data-state-id]', (els, pre) => els.filter((e) => e.getAttribute('data-state-id').startsWith(pre)).length, `${P}__readDiagnostics__`);
  const canvasSelected = () => p.evaluate(() => document.querySelector('#mermaid-canvas-area g.node.diagram-selected-node')?.getAttribute('data-state-id') ?? null);
  const waitFor = async (get, ok, ms = 8000) => {
    let v = await get();
    for (let t = 0; t < ms && !ok(v); t += 250) { await h.sleep(250); v = await get(); }
    return v;
  };

  // 1. Inside the state's box, expanded as the canvas
  const a = await panel();
  expect(a.inBox && a.expanded === 'true' && a.cards.length === 7 && a.cards.includes('DIAG_READ_START'), `Identified States: readDiagnostics()'s states inside ${P}'s box (${JSON.stringify(a)})`);

  // 2. Collapse there: the canvas too; Expand: both again
  await p.click(`#sub-machine-toggle-${P}`);
  const n0 = await waitFor(canvasSubs, (n) => n === 0);
  const b = await panel();
  expect(n0 === 0 && b.expanded === 'false' && b.cards.length === 0, `Collapse in Identified States: the canvas collapses it too (${n0} on the canvas; ${JSON.stringify(b)})`);
  await p.click(`#sub-machine-toggle-${P}`);
  const n1 = await waitFor(canvasSubs, (n) => n >= 6);
  expect(n1 >= 6 && (await panel()).expanded === 'true', `Expand: both again (${n1} on the canvas)`);

  // (the canvas' own Collapse, its box's title menu: Identified States too)
  await h.sleep(800);
  const title = await p.evaluate((id) => {
    const c = [...document.querySelectorAll('#mermaid-canvas-area g.cluster, #mermaid-canvas-area g.statediagram-cluster')].find((x) => (x.getAttribute('data-id') || x.id).replace(/^.*?render-[a-z0-9]+-/i, '').replace(/^state-/, '').replace(/-\d+$/, '') === id);
    const r = c?.querySelector('.cluster-label, g.label, text')?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, `${P}__readDiagnostics`);
  if (title) {
    await p.mouse.click(title.x, title.y, { button: 'right' });
    await p.waitForSelector('#submachine-collapse-btn, #context-menu-submachine-collapse-btn', { timeout: 3000 }).catch(() => {});
    await p.click('#submachine-collapse-btn').catch(() => p.click('#context-menu-submachine-collapse-btn').catch(() => {}));
  }
  const c = await waitFor(panel, (x) => x.expanded === 'false');
  expect(c.expanded === 'false', `the canvas' Collapse sub-machine: Identified States too (${JSON.stringify(c)}; title ${!!title})`);
  if (c.expanded === 'false') {
    await p.click(`#sub-machine-toggle-${P}`);
    await waitFor(canvasSubs, (n) => n >= 6);
    await h.sleep(800);
  }

  // 3. A sub-machine state clicked on the canvas: its card selected, in view
  const at = await p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`)?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; }, sub('DIAG_READ_FINISH_ADR'));
  if (at) await p.mouse.click(at.x, at.y);
  const d = await waitFor(panel, (x) => x.selected.includes('DIAG_READ_FINISH_ADR'));
  const inView = await p.evaluate((id) => { const e = document.getElementById(`state-list-item-${id}`); const r = e?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= innerHeight; }, sub('DIAG_READ_FINISH_ADR'));
  expect(d.selected.join() === 'DIAG_READ_FINISH_ADR' && inView, `the canvas selects DIAG_READ_FINISH_ADR: its card selected, in view (${JSON.stringify(d.selected)}; ${inView})`);

  // 4. Its card clicked: the canvas selects it
  await p.click(`#state-list-item-${sub('DIAG_READ_START')}`);
  const sel = await waitFor(canvasSelected, (x) => x === sub('DIAG_READ_START'));
  expect(sel === sub('DIAG_READ_START'), `its card clicked: the canvas selects DIAG_READ_START (${sel})`);

  // 5. The Enum Editor: readDiagnostics()'s enum (from its CASE labels, read-only), at the selected state's member
  await p.click('#dock-tab-enum');
  await p.waitForFunction(() => /DIAG_READ_START/.test(document.getElementById('st-dut-editor')?.value ?? ''), { timeout: 10000 }).catch(() => {});
  await h.sleep(800);
  const enumAt = () => p.evaluate(() => {
    const ta = document.getElementById('st-dut-editor');
    if (!ta) return null;
    return { line: ta.value.split('\n')[ta.value.slice(0, ta.selectionStart).split('\n').length - 1]?.trim() ?? '', note: document.getElementById('enum-readonly-note')?.textContent ?? '', machine: /KANALOGMEASURE_READY/.test(ta.value) };
  });
  const e1 = await enumAt();
  expect(!!e1 && /^DIAG_READ_START\b/.test(e1.line) && /readDiagnostics/.test(e1.note) && !e1.machine, `the Enum Editor: readDiagnostics()'s states, at DIAG_READ_START, read-only (${JSON.stringify(e1)})`);
  // (read-only: typing changes nothing)
  const before = await p.$eval('#st-dut-editor', (t) => t.value);
  await p.focus('#st-dut-editor');
  await p.keyboard.type('X');
  await h.sleep(300);
  expect((await p.$eval('#st-dut-editor', (t) => t.value)) === before, 'read-only: typing changes nothing');

  // 6. The caret on another member: the canvas, its card, the Method Editor follow
  await p.evaluate(() => {
    const ta = document.getElementById('st-dut-editor');
    const lines = ta.value.split('\n');
    const i = lines.findIndex((l) => /^\s*DIAG_READ_NEW_MESSAGE\b/.test(l));
    const pos = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0) + 3;
    ta.focus();
    ta.setSelectionRange(pos, pos);
  });
  await h.sleep(900);
  const f = await panel();
  await p.click('#dock-tab-method');
  await h.sleep(1200);
  const m = await p.evaluate(() => {
    const ta = document.getElementById('method-implementation-editor');
    const box = document.getElementById('method-selector-combobox');
    const n = Number(document.querySelector('[data-highlighted-line]')?.getAttribute('data-highlighted-line'));
    return { method: (box?.value || '').trim(), line: n && ta ? ta.value.split('\n')[n - 1]?.trim() ?? '' : '' };
  });
  await p.click('#dock-tab-diagram');
  await h.sleep(600);
  const s2 = await canvasSelected();
  expect(s2 === sub('DIAG_READ_NEW_MESSAGE') && f.selected.join() === 'DIAG_READ_NEW_MESSAGE', `the Enum Editor's caret on DIAG_READ_NEW_MESSAGE: the canvas and its card select it (${s2}; ${f.selected})`);
  expect(/readDiagnostics/.test(m.method) && /DIAG_READ_NEW_MESSAGE\s*:/.test(m.line), `the Method Editor: readDiagnostics() at its CASE label (${JSON.stringify(m)})`);

  // 7. The Method Editor's caret in DIAG_READ_FINISH_ADR's branch: its member in the Enum Editor, its card
  await p.click('#dock-tab-method');
  await h.sleep(600);
  await p.evaluate(() => {
    const ta = document.getElementById('method-implementation-editor');
    const lines = ta.value.split('\n');
    const i = lines.findIndex((l) => /DIAG_READ_FINISH_ADR\s*:/.test(l)) + 1;
    const pos = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0) + 2;
    ta.focus();
    ta.setSelectionRange(pos, pos);
  });
  await h.sleep(900);
  const g = await panel();
  const focused = await p.evaluate(() => document.querySelector('[data-code-focus="true"]')?.id ?? null);
  await p.click('#dock-tab-enum');
  await h.sleep(1000);
  const e2 = await enumAt();
  expect(g.selected.join() === 'DIAG_READ_FINISH_ADR' && focused === `state-list-item-${sub('DIAG_READ_FINISH_ADR')}`, `the Method Editor's caret in DIAG_READ_FINISH_ADR: its card (${g.selected}; ${focused})`);
  expect(!!e2 && /^DIAG_READ_FINISH_ADR\b/.test(e2.line), `the Enum Editor at DIAG_READ_FINISH_ADR (${JSON.stringify(e2)})`);

  // 8. A state of the chart again: the Enum Editor its enum, editable
  await p.click('#dock-tab-diagram');
  await p.click(`#state-list-item-KANALOGMEASURE_READY`).catch(() => {});
  await p.click('#dock-tab-enum');
  await h.sleep(1000);
  const e3 = await enumAt();
  expect(!!e3 && e3.machine && !e3.note && /^KANALOGMEASURE_READY\b/.test(e3.line), `KANALOGMEASURE_READY selected: the Enum Editor its enum again, editable (${JSON.stringify(e3)})`);

  // 8b. A sub-machine state's card, right-clicked: Go to code (its CASE label in its method), Add bookmark (its node)
  await p.click('#dock-tab-diagram').catch(() => {});
  await p.click(`#state-list-item-${sub('DIAG_READ_LOG_MESSAGE')}`, { button: 'right' });
  await p.waitForSelector('#state-list-goto-code-btn', { timeout: 3000 }).catch(() => {});
  await p.click('#state-list-goto-code-btn').catch(() => {});
  await h.sleep(1500);
  const went = await p.evaluate(() => {
    const ta = document.getElementById('method-implementation-editor');
    const box = document.getElementById('method-selector-combobox');
    const n = Number(document.querySelector('[data-highlighted-line]')?.getAttribute('data-highlighted-line'));
    return { method: (box?.value || '').trim(), line: n && ta ? ta.value.split('\n')[n - 1]?.trim() ?? '' : '' };
  });
  expect(/readDiagnostics/.test(went.method) && /DIAG_READ_LOG_MESSAGE\s*:/.test(went.line), `its card's Go to code: readDiagnostics() at its CASE label (${JSON.stringify(went)})`);
  await p.click('#dock-tab-diagram').catch(() => {});
  await p.click(`#state-list-item-${sub('DIAG_READ_LOG_MESSAGE')}`, { button: 'right' });
  await p.waitForSelector('#state-list-bookmark-btn', { timeout: 3000 }).catch(() => {});
  await p.click('#state-list-bookmark-btn').catch(() => {});
  const ribbon2 = await waitFor(() => p.evaluate((id) => !!document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"] g.state-bookmark-marker`), sub('DIAG_READ_LOG_MESSAGE')), (x) => x);
  expect(ribbon2, 'its card\'s Add bookmark: the ribbon on its node');

  // 9. Bookmarked, its sub-machine expanded (the state a box): its ribbon at the box's corner
  await p.click('#dock-tab-diagram').catch(() => {});
  await p.click(`#state-list-item-${P}`, { button: 'right' });
  await p.waitForSelector('#state-list-bookmark-btn', { timeout: 3000 }).catch(() => {});
  await p.click('#state-list-bookmark-btn').catch(() => {});
  const ribbon = await waitFor(() => p.evaluate((P) => {
    const r = document.querySelector(`#mermaid-canvas-area g.state-bookmark-marker[data-state-id="${P}"]`)?.getBoundingClientRect();
    const box = [...document.querySelectorAll('#mermaid-canvas-area g.cluster, #mermaid-canvas-area g.statediagram-cluster')].find((c) => (c.getAttribute('data-id') || c.id).replace(/^.*?render-[a-z0-9]+-/i, '').replace(/^state-/, '').replace(/-\d+$/, '') === P)?.getBoundingClientRect();
    return r && box ? { near: Math.abs(r.left - box.left) < 30 && Math.abs(r.top - box.top) < 30 } : null;
  }, P), (x) => !!x);
  expect(!!ribbon?.near, `bookmarked, its sub-machine expanded: its ribbon at its box's top-left corner (${JSON.stringify(ribbon)})`);

  // 10. Simulated: the sub-machine's current state's card marked, inside the state's
  await p.click('#dock-tab-simulate').catch(() => {});
  await p.waitForSelector('#sim-start-state', { timeout: 5000 }).catch(() => {});
  await p.select('#sim-start-state', P).catch(() => {});
  await p.$eval('#sim-start', (e) => e.click()).catch(() => {});
  await h.sleep(500);
  await p.$eval('#sim-var-status_bDiagnostics-true', (e) => e.click()).catch(() => {});
  const liveCards = () => p.evaluate(() => [...document.querySelectorAll('[id^="state-list-item-"][data-live="true"]')].map((e) => e.id.replace('state-list-item-', '')));
  const lv = await waitFor(liveCards, (x) => x.includes(sub('DIAG_READ_START')));
  expect(lv.includes(P) && lv.includes(sub('DIAG_READ_START')), `simulated: ${P}'s card and DIAG_READ_START's inside it marked (${lv.join(', ')})`);
  await p.$eval('#sim-stop', (e) => e.click()).catch(() => {});

  // 11. Nested (the K-Test Station sample: CALIBRATING calls Calibrate(), its CAL_MEASURE calls Measure()): Measure()'s
  // states inside CAL_MEASURE's box, inside CALIBRATING's; Measure() collapsed there: the canvas too
  await p.select('#sample-selector', 'k-test-station');
  const CM = 'KTESTSTATION_CALIBRATING__Calibrate__CAL_MEASURE';
  await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${CM}__Measure__MEAS_READ"]`, { timeout: 30000 }).catch(() => {});
  await h.sleep(1000);
  const nest = () => p.evaluate((CM) => ({
    outer: !!document.querySelector(`#state-box-KTESTSTATION_CALIBRATING #sub-machine-KTESTSTATION_CALIBRATING`),
    inner: [...document.querySelectorAll(`#state-box-KTESTSTATION_CALIBRATING #state-box-${CSS.escape(CM)} #sub-machine-${CSS.escape(CM)} [id^="state-list-item-"]`)].map((e) => e.id.split('__').pop()),
    expanded: document.getElementById(`sub-machine-${CM}`)?.getAttribute('data-expanded') ?? null,
    canvas: document.querySelectorAll(`#mermaid-canvas-area g.node[data-state-id^="${CM}__Measure__"]`).length,
  }), CM);
  const m0 = await nest();
  expect(m0.outer && m0.inner.join() === 'MEAS_SETTLE,MEAS_READ,MEAS_STORE' && m0.expanded === 'true' && m0.canvas >= 3, `nested: Measure()'s states inside CAL_MEASURE's box, inside CALIBRATING's (${JSON.stringify(m0)})`);
  await p.click(`#sub-machine-toggle-${CM.replace(/[^\w-]/g, '\\$&')}`).catch(() => p.evaluate((id) => document.getElementById(id)?.click(), `sub-machine-toggle-${CM}`));
  const m1 = await waitFor(nest, (x) => x.canvas === 0);
  expect(m1.canvas === 0 && m1.expanded === 'false' && m1.outer, `Measure() collapsed there: the canvas too, Calibrate() still shown (${JSON.stringify(m1)})`);
  await p.evaluate((id) => document.getElementById(id)?.click(), `sub-machine-toggle-${CM}`);
  const m2 = await waitFor(nest, (x) => x.canvas >= 3);
  expect(m2.canvas >= 3, `expanded again (${m2.canvas})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
