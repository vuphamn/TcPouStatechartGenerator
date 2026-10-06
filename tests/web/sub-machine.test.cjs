// A sub-machine on the canvas (the POU through the XAE stand-in bridge): TABLEMANAGER_IDLE_FEED_OFF calls
// TestSequence(), a method with its own state machine (as EFX_IDLE calls RpsSimulation()): drawn inside it by default
// (its own names; UNUSED dashed, "never reached"), in both chart styles. Go to code on its transitions and its entry
// (↑ cmd_bTestMode), and on its states: the Method Editor at that line of TestSequence(). The box's title menu:
// Collapse sub-machine: one state, its label says so, kept after a reload; its menu: Expand sub-machine
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const METHOD = `    <Method Name="TestSequence" Id="{11111111-2222-3333-4444-555555555555}">
      <Declaration><![CDATA[METHOD TestSequence
VAR_INPUT
	bInit	: BOOL;
END_VAR
VAR_INST
	eTestState	: E_TEST_SEQ;
	tonStep		: TON;
END_VAR
]]></Declaration>
      <Implementation>
        <ST><![CDATA[IF (bInit) THEN
	eTestState := E_TEST_SEQ.INIT;
ELSE
	CASE eTestState OF
		E_TEST_SEQ.INIT:
			eTestState := E_TEST_SEQ.WAITING;
		E_TEST_SEQ.WAITING:
			IF (cmd_bTestStart) THEN
				eTestState := E_TEST_SEQ.RUNNING;
			END_IF
		E_TEST_SEQ.RUNNING:
			tonStep(IN:=TRUE, PT:=T#2S);
			IF (tonStep.Q) THEN
				tonStep(IN:=FALSE);
				eTestState := E_TEST_SEQ.WAITING;
			END_IF
		E_TEST_SEQ.UNUSED:
			;
	END_CASE
END_IF]]></ST>
      </Implementation>
    </Method>
`;
const S = 'TABLEMANAGER_IDLE_FEED_OFF';
const inner = (x) => `${S}__TestSequence__${x}`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const toApp = (m) => p.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  let source = null;
  await p.exposeFunction('__hostPost', async (m) => {
    if (m.type === 'ready' && source) await toApp({ type: 'loadPou', source });
  });
  await p.evaluateOnNewDocument(() => {
    const listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = { postMessage: (m) => window.__hostPost(m), addEventListener: (t, fn) => listeners.push(fn), removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
    window.__fromHost = (m) => listeners.forEach((fn) => fn({ data: m }));
  });
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  const sample = await p.evaluate(async () => {
    const mod = await import('/src/samples/samplesData.ts');
    const s = mod.SAMPLES.find((x) => x.id === 'table-manager-202');
    return { pou: s.pouContent, dut: s.dutContent };
  });
  const pou = sample.pou
    .replace(/(\tTABLEMANAGER_IDLE_FEED_OFF:\r?\n)/, '$1\t\trtrigTestMode(CLK:=cmd_bTestMode);\n\t\tIF (cmd_bTestMode) THEN\n\t\t\tTestSequence(rtrigTestMode.Q);\n\t\t\tRETURN;\n\t\tEND_IF\n')
    .replace('</POU>', `${METHOD}  </POU>`);
  source = { name: 'SM_TableManager.TcPOU', path: 'C:\\proj\\SM_TableManager.TcPOU', content: pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] };
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${inner('INIT')}"]`, { timeout: 60000 }).catch(() => {});
  await h.sleep(1500);
  const label = () => p.$eval(`#mermaid-canvas-area g.node[data-state-id="${S}"]`, (e) => e.textContent).catch(() => '');
  const innerCount = () => p.$$eval('#mermaid-canvas-area g.node', (els, pre) => new Set(els.map((e) => e.getAttribute('data-state-id')).filter((x) => x && x.startsWith(pre))).size, `${S}__TestSequence__`);
  // (the state's box and its sub-machine's: their titles)
  const boxTitle = () => p.evaluate((s) => [...document.querySelectorAll('#mermaid-canvas-area .statediagram-cluster, #mermaid-canvas-area g.cluster')].filter((c) => { const id = c.getAttribute('data-id') || c.id; return id.endsWith(s) || id.includes(`${s}__TestSequence`); }).map((c) => c.querySelector('.cluster-label')?.textContent || c.textContent || '').join(' | '), S);

  // Expanded by default
  const drawn = await p.evaluate((ids) => ids.map((id) => {
    const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`);
    // (its name: the label's first line, upper case)
    return n ? `${n.textContent.trim().match(/^[A-Z0-9_]+/)?.[0] ?? ''}${n.getAttribute('class')?.includes('kssUnreachable') ? '(dashed)' : ''}` : '-';
  }), ['INIT', 'WAITING', 'RUNNING', 'UNUSED'].map(inner));
  expect(drawn.join(' ') === 'INIT WAITING RUNNING UNUSED(dashed)' && /TestSequences*while cmd_bTestMode/.test(await boxTitle()), `drawn inside ${S} by default (${drawn.join(' ')})`);
  const unused = await p.$eval(`#mermaid-canvas-area g.node[data-state-id="${inner('UNUSED')}"]`, (e) => e.textContent).catch(() => '');
  expect(/never reached/.test(unused), `UNUSED: "${unused.trim()}"`);

  // Go to code: a transition inside it, its entry, a state: TestSequence() at that line
  const editorAt = async () => {
    await h.sleep(1500);
    // (the method shown, the line it marks)
    return p.evaluate(() => {
      const ta = document.getElementById('method-implementation-editor');
      const box = document.getElementById('method-selector-combobox');
      const n = Number(document.querySelector('[data-highlighted-line]')?.getAttribute('data-highlighted-line'));
      if (!ta || !n) return null;
      return { method: (box?.value || box?.textContent || '').trim(), line: n, text: ta.value.split('\n')[n - 1]?.trim() ?? '' };
    });
  };
  const goToEdge = async (from, to) => {
    await p.click('#dock-tab-diagram').catch(() => {});
    await h.sleep(500);
    const pt = await p.evaluate((from, to) => {
      const el = [...document.querySelectorAll('#mermaid-canvas-area path.tc-edge-path')].find((x) => x.getAttribute('data-target-id') === to && (!from || x.getAttribute('data-source-id') === from));
      if (!el) return null;
      const len = el.getTotalLength();
      const m = el.getScreenCTM();
      const q = el.getPointAtLength(len * 0.5);
      return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f, path: el.getAttribute('data-path-id') };
    }, from, to);
    if (!pt) return { error: 'no edge' };
    await p.evaluate((pt) => {
      const el = document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-path-id="${pt.path}"]`);
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: pt.x, clientY: pt.y }));
    }, pt);
    const go = await p.waitForSelector('#context-menu-goto-code-btn', { timeout: 3000 }).catch(() => null);
    if (!go) return { error: 'no Go to code' };
    const title = await go.evaluate((e) => e.getAttribute('title') ?? '');
    await go.evaluate((e) => e.click());
    return { title, at: await editorAt() };
  };
  const t1 = await goToEdge(inner('WAITING'), inner('RUNNING'));
  expect(/TestSequence\(\)/.test(t1.title ?? '') && t1.at?.text === 'eTestState := E_TEST_SEQ.RUNNING;', `Go to code, WAITING → RUNNING: ${JSON.stringify(t1)}`);
  const t2 = await goToEdge(null, inner('INIT'));
  expect(t2.at?.text === 'eTestState := E_TEST_SEQ.INIT;', `Go to code, its entry (↑ cmd_bTestMode): ${JSON.stringify(t2)}`);
  await p.click('#dock-tab-diagram').catch(() => {});
  await h.sleep(500);
  await p.evaluate((id) => {
    const el = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`);
    const q = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: q.x + q.width / 2, clientY: q.y + q.height / 2 }));
  }, inner('RUNNING'));
  const goState = await p.waitForSelector('#context-menu-goto-code-btn', { timeout: 3000 }).catch(() => null);
  if (goState) await goState.evaluate((e) => e.click());
  const t3 = goState ? await editorAt() : null;
  expect(t3?.text === 'E_TEST_SEQ.RUNNING:', `Go to code, the state RUNNING: ${JSON.stringify(t3)}`);
  await p.click('#dock-tab-diagram').catch(() => {});
  await h.sleep(800);

  // A click: on one of its states: the Method Editor on TestSequence(), at its CASE label; on the box's blank area: the
  // state itself selected (its branch in doState())
  const clickAt = async (pt) => {
    await p.click('#dock-tab-diagram').catch(() => {});
    await h.sleep(300);
    await p.mouse.click(pt.x, pt.y);
    await h.sleep(500);
    await p.click('#dock-tab-method').catch(() => {});
    return editorAt();
  };
  await p.click('#dock-tab-diagram').catch(() => {});
  await h.sleep(500);
  const waitingAt = await p.evaluate((id) => {
    const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`)?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, inner('WAITING'));
  const c1 = waitingAt ? await clickAt(waitingAt) : null;
  expect(c1?.method === 'TestSequence()' && c1.text === 'E_TEST_SEQ.WAITING:', `click on WAITING: the Method Editor at its label (${JSON.stringify(c1)})`);
  await p.click('#dock-tab-diagram').catch(() => {});
  await h.sleep(500);
  const blankAt = await p.evaluate((s) => {
    const c = [...document.querySelectorAll('#mermaid-canvas-area g.cluster')].find((x) => (x.getAttribute('data-id') || x.id).endsWith(s));
    const r = c?.getBoundingClientRect();
    return r ? { x: r.left + 6, y: r.bottom - 6 } : null;
  }, S);
  const c2 = blankAt ? await clickAt(blankAt) : null;
  // (Identified States: selected there too, where it is shown; this view, XAE's, may not show it)
  const listed = await p.evaluate((s) => { const el = document.getElementById('state-list-item-' + s); return el ? el.getAttribute('aria-selected') : 'missing'; }, S);
  expect(c2?.method === 'doState()' && /TABLEMANAGER_IDLE_FEED_OFF:/.test(c2.text) && (listed === 'true' || listed === 'missing'), `click on the box's blank area: ${S} selected, its branch in doState() (${JSON.stringify(c2)}; in Identified States: ${listed})`);
  await p.click('#dock-tab-diagram').catch(() => {});
  await h.sleep(500);

  // Its transitions moved among its own states, in TestSequence(): an end dragged onto another state; a start moved with
  // its menu's Move start to… (its list: its own states); Ctrl+Z undoes each
  // (the chart's own edges: the minimap has a copy of each)
  const drawnTo = (from) => p.evaluate((from) => [...document.querySelectorAll('#mermaid-diagram-svg-container path.tc-edge-path')].filter((x) => x.getAttribute('data-source-id') === from).map((x) => x.getAttribute('data-target-id')), from);
  const status = () => p.$eval('#status-message', (e) => e.textContent.trim()).catch(() => '');
  const midOf = (from, to) => p.evaluate((from, to) => {
    const el = [...document.querySelectorAll('#mermaid-canvas-area path.tc-edge-path')].find((x) => x.getAttribute('data-source-id') === from && x.getAttribute('data-target-id') === to);
    if (!el) return null;
    const len = el.getTotalLength();
    const m = el.getScreenCTM();
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const q = el.getPointAtLength(len * f);
      const x = q.x * m.a + q.y * m.c + m.e;
      const y = q.x * m.b + q.y * m.d + m.f;
      if (document.elementFromPoint(x, y)?.closest('path')?.getAttribute('data-path-id') === el.getAttribute('data-path-id')) return { x, y };
    }
    return null;
  }, from, to);
  const centreOf = (id) => p.evaluate((id) => {
    const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`)?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, id);
  await p.click('#dock-tab-diagram').catch(() => {});
  await h.sleep(600);
  // 1. The end of WAITING → RUNNING dragged onto UNUSED
  const mid = await midOf(inner('WAITING'), inner('RUNNING'));
  if (mid) await p.mouse.click(mid.x, mid.y);
  await h.sleep(600);
  const endHandle = await p.evaluate(() => {
    const el = [...document.querySelectorAll('#mermaid-canvas-area .tc-edge-handle[data-handle-type="end"]')].find((x) => x.getBoundingClientRect().width > 0);
    const r = el?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  const unusedAt = await centreOf(inner('UNUSED'));
  if (endHandle && unusedAt) {
    await p.mouse.move(endHandle.x, endHandle.y);
    await p.mouse.down();
    for (let i = 1; i <= 15; i++) await p.mouse.move(endHandle.x + ((unusedAt.x - endHandle.x) * i) / 15, endHandle.y + ((unusedAt.y - endHandle.y) * i) / 15);
    await p.mouse.up();
  }
  for (let i = 0; i < 30 && !(await drawnTo(inner('WAITING'))).includes(inner('UNUSED')); i++) await h.sleep(250);
  const moved = await drawnTo(inner('WAITING'));
  const said = await status();
  expect(moved.includes(inner('UNUSED')) && !moved.includes(inner('RUNNING')) && /WAITING → UNUSED \(was → RUNNING\), in TestSequence\(\)/.test(said), `its end dragged onto UNUSED: WAITING → UNUSED in TestSequence() ("${said}"; handle: ${!!endHandle})`);
  await p.keyboard.press('Escape');
  await p.keyboard.down('Control');
  await p.keyboard.press('z');
  await p.keyboard.up('Control');
  for (let i = 0; i < 30 && !(await drawnTo(inner('WAITING'))).includes(inner('RUNNING')); i++) await h.sleep(250);
  expect((await drawnTo(inner('WAITING'))).includes(inner('RUNNING')), 'Ctrl+Z: WAITING → RUNNING again');
  // 2. Move start to…: RUNNING → WAITING to leave INIT instead
  await h.sleep(800);
  const mid2 = await midOf(inner('RUNNING'), inner('WAITING'));
  if (mid2) await p.mouse.click(mid2.x, mid2.y, { button: 'right' });
  const moveStart = await p.waitForSelector('#context-menu-move-start-btn', { timeout: 3000 }).catch(() => null);
  if (moveStart) await moveStart.evaluate((e) => e.click());
  const pickerShown = await p.waitForSelector('#edge-end-picker-input', { timeout: 3000 }).catch(() => null);
  const offered = await p.$$eval('#edge-end-picker [data-id]', (els) => els.map((e) => e.getAttribute('data-id').replace(/^edge-end:/, ''))).catch(() => []);
  expect(!!pickerShown && offered.length === 3 && offered.every((x) => x.startsWith(`${S}__TestSequence__`)) && !offered.includes(inner('RUNNING')), `Move start to…: its own states offered (${offered.map((x) => x.split('__').pop()).join(', ')})`);
  if (pickerShown) {
    await p.type('#edge-end-picker-input', 'INIT');
    await h.sleep(200);
    await p.keyboard.press('Enter');
  }
  for (let i = 0; i < 30 && !(await drawnTo(inner('INIT'))).includes(inner('WAITING')) || i < 2; i++) await h.sleep(250);
  const fromInit = await drawnTo(inner('INIT'));
  const said2 = await status();
  expect(fromInit.includes(inner('WAITING')) && !(await drawnTo(inner('RUNNING'))).includes(inner('WAITING')) && /INIT → WAITING \(was RUNNING →\)/.test(said2), `its start moved to INIT ("${said2}"; from INIT: ${fromInit.map((x) => x.split('__').pop()).join(', ')})`);
  await p.keyboard.press('Escape');
  // (the canvas focused, as a click on it does: the list closed, the keys go to the page)
  const emptyAt = await p.evaluate(() => {
    const a = document.getElementById('mermaid-canvas-area').getBoundingClientRect();
    for (let y = a.top + 60; y < a.bottom - 40; y += 20) for (let x = a.left + 80; x < a.right - 80; x += 40) {
      const e = document.elementFromPoint(x, y);
      if (e && document.getElementById('mermaid-canvas-area').contains(e) && !e.closest('g.node, g.edgeLabel, g.cluster, .statediagram-cluster, path, button, [role="toolbar"]')) return { x, y };
    }
    return null;
  });
  if (emptyAt) await p.mouse.click(emptyAt.x, emptyAt.y);
  await h.sleep(300);
  await p.keyboard.down('Control');
  await p.keyboard.press('z');
  await p.keyboard.up('Control');
  for (let i = 0; i < 30 && !(await drawnTo(inner('RUNNING'))).includes(inner('WAITING')); i++) await h.sleep(250);
  expect((await drawnTo(inner('RUNNING'))).includes(inner('WAITING')), 'Ctrl+Z: RUNNING → WAITING again');
  // (one between it and the rest of the chart: refused)
  await p.click('#dock-tab-diagram').catch(() => {});
  await h.sleep(500);

  // stateDiagram-v2: the same, its sub-machine's box headed by its method (then back to flowchart)
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /stateDiagram/.test(x.textContent))?.click());
  for (let i = 0; i < 40 && (await innerCount()) < 4; i++) await h.sleep(250);
  await h.sleep(800);
  const sdCount = await innerCount();
  const sdTitle = await boxTitle();
  expect(sdCount >= 4 && /TestSequences*while cmd_bTestMode/.test(sdTitle) && !/⊟/.test(sdTitle), `stateDiagram-v2: inside its box too (${sdCount} states; "${sdTitle.replace(/\s+/g, ' ').slice(0, 70)}")`);
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^flowchart/.test(x.textContent.trim()))?.click());
  await h.sleep(1500);

  // Hover: an inner state's code (its branch in TestSequence())
  const np = await p.evaluate((id) => {
    const r = document.querySelector(`#mermaid-diagram-svg-container g.node[data-state-id="${id}"]`)?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, inner('RUNNING'));
  if (np) await p.mouse.move(np.x, np.y);
  await h.sleep(500);
  const hover = (await p.$eval('#state-actions-hover', (e) => e.innerText).catch(() => '')) || (await p.$eval('#heatmap-state-hover-tooltip', (e) => e.innerText).catch(() => ''));
  expect(/TestSequence\(\) · RUNNING/.test(hover) && /tonStep\(IN:=TRUE, PT:=T#2S\);/.test(hover) && /eTestState := E_TEST_SEQ\.WAITING;/.test(hover), `hover on RUNNING: its code ("${hover.replace(/\s+/g, ' ').slice(0, 90)}")`);
  await p.mouse.move(5, 5);
  await h.sleep(300);
  // Hover: the box's blank area (and its sub-machine's frame): the state's own code in doState()
  // (the state a box titled with its own name; its sub-machine a box of its own inside it, headed by its method)
  const heads = await p.evaluate((s) => [...document.querySelectorAll('#mermaid-canvas-area g.cluster, #mermaid-canvas-area g.statediagram-cluster')].map((c) => [(c.getAttribute('data-id') || c.id).replace(/^.*?render-[a-z0-9]+-/i, '').replace(/^state-/, '').replace(/-d+$/, ''), (c.querySelector('.cluster-label, g.label, text')?.textContent ?? '').trim()]).filter(([id]) => id === s || id === `${s}__TestSequence`), S);
  const headOf = (id) => heads.find(([x]) => x === id)?.[1] ?? '';
  expect(/^TABLEMANAGER_IDLE_FEED_OFF/.test(headOf(S)) && !/TestSequence|while/.test(headOf(S)) && /^TestSequences*while cmd_bTestMode/.test(headOf(`${S}__TestSequence`)), `the state's box titled with its name, its sub-machine's headed by its method (${JSON.stringify(heads)})`);
  const blanks = await p.evaluate((s) => {
    const c = [...document.querySelectorAll('#mermaid-canvas-area g.cluster')].find((x) => (x.getAttribute('data-id') || x.id).endsWith(s));
    const inner = [...document.querySelectorAll('#mermaid-canvas-area g.cluster')].find((x) => /__TestSequence/.test(x.getAttribute('data-id') || x.id));
    const r = c?.getBoundingClientRect();
    const q = inner?.getBoundingClientRect();
    return { outer: r ? { x: r.left + 6, y: r.bottom - 6 } : null, frame: q ? { x: q.left + 6, y: q.bottom - 6 } : null };
  }, S);
  const hoverAt = async (pt) => {
    if (!pt) return '';
    await p.mouse.move(pt.x, pt.y);
    await h.sleep(500);
    const t = (await p.$eval('#state-actions-hover', (e) => e.innerText).catch(() => '')) || (await p.$eval('#heatmap-state-hover-tooltip', (e) => e.innerText).catch(() => ''));
    await p.mouse.move(5, 5);
    await h.sleep(300);
    return t;
  };
  for (const [where, pt] of Object.entries(blanks)) {
    const t = await hoverAt(pt);
    expect(t.startsWith(S) && /TestSequence\(rtrigTestMode\.Q\);/.test(t), `hover on the box's ${where === 'outer' ? 'blank area' : 'sub-machine frame'}: ${S}'s code ("${t.replace(/\s+/g, ' ').slice(0, 80)}")`);
  }

  // The box's title: Collapse sub-machine
  const title = await p.evaluate((s) => {
    const c = [...document.querySelectorAll('#mermaid-canvas-area g.cluster')].find((x) => (x.getAttribute('data-id') || x.id).endsWith(s));
    const l = c?.querySelector('.cluster-label')?.getBoundingClientRect();
    return l ? { x: l.x + l.width / 2, y: l.y + l.height / 2 } : null;
  }, S);
  if (title) await p.mouse.click(title.x, title.y, { button: 'right' });
  const collapse = await p.waitForSelector('#context-menu-submachine-collapse-btn', { timeout: 3000 }).catch(() => null);
  expect(!!collapse, `the box's title menu: Collapse sub-machine (${JSON.stringify(title)})`);
  if (collapse) await collapse.evaluate((e) => e.click());
  for (let i = 0; i < 40 && (await innerCount()) > 0; i++) await h.sleep(250);
  expect((await innerCount()) === 0 && /⊞ TestSequence/.test(await label()), `collapsed: one state, its label says so ("${(await label()).slice(0, 60)}")`);
  const stored = await p.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('kss.collapsed.'))?.[1] ?? '');
  expect(stored.includes(`-${S}`), `kept for this POU (${stored})`);

  // Reloaded: still collapsed
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${S}"]`, { timeout: 30000 }).catch(() => {});
  await h.sleep(1500);
  expect((await innerCount()) === 0 && /⊞ TestSequence/.test(await label()), 'reloaded: still collapsed');

  // Its menu: Expand sub-machine
  await p.evaluate((s) => {
    const el = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${s}"]`);
    const q = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: q.x + q.width / 2, clientY: q.y + q.height / 2 }));
  }, S);
  const expand = await p.waitForSelector('#context-menu-submachine-expand-btn', { timeout: 3000 }).catch(() => null);
  expect(!!expand && /Expand sub-machine TestSequence/.test(await expand.evaluate((e) => e.textContent)), 'its menu: Expand sub-machine TestSequence');
  if (expand) await expand.evaluate((e) => e.click());
  for (let i = 0; i < 40 && (await innerCount()) < 4; i++) await h.sleep(250);
  expect((await innerCount()) >= 4, 'expanded again');

  // The Method Editor's caret in TestSequence(), under a CASE label: the canvas selects that sub-machine's state (Follow
  // on: and pans to it)
  {
    await p.click('#dock-tab-diagram').catch(() => {});
    await h.sleep(400);
    const at = await p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`)?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; }, inner('INIT'));
    if (at) await p.mouse.click(at.x, at.y);
    await p.click('#dock-tab-method').catch(() => {});
    // (TestSequence() chosen in the Method Editor)
    await p.waitForSelector('#method-selector-combobox', { timeout: 8000 }).catch(() => {});
    await p.evaluate(() => {
      const sel = document.getElementById('method-selector-combobox');
      const opt = sel && [...sel.options].find((o) => /TestSequence/.test(o.textContent));
      if (!opt) return;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, opt.value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await p.waitForFunction(() => /E_TEST_SEQ\.RUNNING\s*:/.test(document.getElementById('method-implementation-editor')?.value ?? ''), { timeout: 8000 }).catch(() => {});
    if (!(await p.$eval('#method-follow-checkbox', (e) => e.checked).catch(() => true))) await p.click('#method-follow-checkbox');
    const caretOn = await p.evaluate(() => {
      const ta = document.getElementById('method-implementation-editor');
      const lines = ta.value.split('\n');
      const i = lines.findIndex((l) => /^\s*E_TEST_SEQ\.RUNNING\s*:/.test(l)) + 1;
      const pos = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0) + 2;
      ta.focus();
      ta.setSelectionRange(pos, pos);
      const b = document.getElementById('method-selector-combobox');
      return `${(b?.value || b?.textContent || '').trim()}: ${(lines[i] ?? '').trim()}`;
    });
    await h.sleep(900);
    await p.click('#dock-tab-diagram').catch(() => {});
    await h.sleep(600);
    const sel = await p.evaluate(() => document.querySelector('#mermaid-canvas-area g.node.diagram-selected-node')?.getAttribute('data-state-id') ?? null);
    expect(sel === inner('RUNNING'), `the Method Editor's caret under E_TEST_SEQ.RUNNING: in TestSequence(): the canvas selects it (${sel}; caret in ${caretOn})`);
    await p.click("#dock-tab-method").catch(() => {});
    await p.click("#method-follow-checkbox").catch(() => {});
    await p.click("#dock-tab-diagram").catch(() => {});
  }

  // The simulation: in TABLEMANAGER_IDLE_FEED_OFF, cmd_bTestMode set: TestSequence() runs from INIT; the state glows and
  // its sub-machine's state inside it; its transitions offered, the state's own waiting (the RETURN after its call);
  // Step through it, Back; cmd_bTestMode off: it stops, the state's own transitions offered again
  await p.click('#dock-tab-diagram').catch(() => {});
  await p.click('#dock-tab-simulate');
  await p.waitForSelector('#sim-start', { timeout: 5000 }).catch(() => {});
  await p.select('#sim-start-state', S);
  await p.click('#sim-start');
  await h.sleep(800);
  const simNow = () => p.evaluate(() => ({
    running: document.getElementById('sim-sub-machine')?.getAttribute('data-running') ?? null,
    sub: document.getElementById('sim-sub-state')?.textContent ?? null,
    box: [...document.querySelectorAll('#mermaid-diagram-svg-container g.live-active-cluster')].map((c) => (c.getAttribute('data-id') || c.id).replace(/^.*?render-[a-z0-9]+-/i, '')),
    inner: [...document.querySelectorAll('#mermaid-diagram-svg-container g.node.live-region-node')].map((n) => n.getAttribute('data-state-id').split('__').pop()),
    offered: [...document.querySelectorAll('#simulation-panel li .font-mono')].map((x) => x.textContent.replace(/^→\s*/, '').trim()).filter((x) => /^[A-Z_]+$/.test(x)),
  }));
  const simWait = async (ok, ms = 5000) => {
    let m = await simNow();
    for (let t = 0; t < ms && !ok(m); t += 200) { await h.sleep(200); m = await simNow(); }
    return m;
  };
  const s0 = await simNow();
  expect(s0.running === 'false' && s0.offered.some((x) => x.startsWith('TABLEMANAGER_')) && s0.inner.length === 0, `simulation in ${S}: its sub-machine not running, its own transitions offered (${JSON.stringify(s0)})`);
  await p.$eval('#sim-var-cmd_bTestMode-true', (e) => e.click()).catch(() => {});
  const s1 = await simWait((m) => m.running === 'true' && m.inner.includes('INIT'));
  expect(s1.sub === 'INIT' && s1.box.includes(S) && s1.inner.join() === 'INIT' && s1.offered[0] === 'WAITING' && !s1.offered.some((x) => x.startsWith('TABLEMANAGER_')), `cmd_bTestMode TRUE: TestSequence() runs in INIT, ${S} glows with INIT inside it, its transitions offered first, the state's own waiting (preProcess()'s still checked) (${JSON.stringify(s1)})`);
  await p.$eval('#sim-step', (e) => e.click()).catch(() => {});
  const s2 = await simWait((m) => m.sub === 'WAITING');
  expect(s2.sub === 'WAITING' && s2.inner.join() === 'WAITING' && s2.box.includes(S), `Step: WAITING (${JSON.stringify(s2)})`);
  await p.$eval('#sim-var-cmd_bTestStart-true', (e) => e.click()).catch(() => {});
  await h.sleep(300);
  await p.$eval('#sim-step', (e) => e.click()).catch(() => {});
  const s3 = await simWait((m) => m.sub === 'RUNNING');
  expect(s3.sub === 'RUNNING' && s3.inner.join() === 'RUNNING', `cmd_bTestStart TRUE, Step: RUNNING (${JSON.stringify(s3)})`);
  await p.$eval('#sim-back', (e) => e.click()).catch(() => {});
  const s4 = await simWait((m) => m.sub === 'WAITING');
  expect(s4.sub === 'WAITING', `Back: WAITING again (${s4.sub})`);
  await p.$eval('#sim-var-cmd_bTestMode-false', (e) => e.click()).catch(() => {});
  const s5 = await simWait((m) => m.running === 'false' && m.inner.length === 0);
  expect(s5.running === 'false' && s5.inner.length === 0 && s5.offered.some((x) => x.startsWith('TABLEMANAGER_')), `cmd_bTestMode FALSE: it stops, ${S}'s own transitions offered again (${JSON.stringify(s5)})`);
  await p.click('#sim-stop').catch(() => {});
  await p.click('#dock-tab-diagram').catch(() => {});
  await h.sleep(500);

  // The heat map: its states scored from their own code (a badge each, WAITING's above INIT's); the statistics count
  // its states and transitions
  await p.click('#toolbar-heatmap-btn').catch(() => {});
  await h.sleep(1200);
  await p.screenshot({ path: require('path').join(h.OUT, 'sub-machine-heat.png') }).catch(() => {});
  const scores = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#mermaid-diagram-svg-container g[data-complexity-score]')].map((b) => [b.getAttribute('data-state-id'), Number(b.getAttribute('data-complexity-score'))])));
  expect(scores[inner('WAITING')] > scores[inner('INIT')] && scores[inner('RUNNING')] > 0 && scores[S] > 0, `heat map: its states scored (WAITING ${scores[inner('WAITING')]}, INIT ${scores[inner('INIT')]}, RUNNING ${scores[inner('RUNNING')]}; ${S} ${scores[S]})`);
  // (the box's blank area: the state's complexity, its own code under it)
  const boxPt = await p.evaluate((s) => {
    const r = [...document.querySelectorAll('#mermaid-canvas-area g.cluster')].find((x) => (x.getAttribute('data-id') || x.id).endsWith(s))?.getBoundingClientRect();
    return r ? { x: r.left + 6, y: r.bottom - 6 } : null;
  }, S);
  let heatTip = { tip: '', code: '' };
  if (boxPt) {
    await p.mouse.move(boxPt.x, boxPt.y);
    await h.sleep(600);
    heatTip = await p.evaluate((s) => {
      const tipEl = document.getElementById('heatmap-state-hover-tooltip');
      const t = tipEl?.getBoundingClientRect();
      const b = [...document.querySelectorAll('#mermaid-canvas-area g.cluster')].find((x) => (x.getAttribute('data-id') || x.id).endsWith(s))?.querySelector(':scope > rect')?.getBoundingClientRect();
      // (just below or above the state's box, not over its border)
      const clear = !!t && !!b && (t.top >= b.bottom - 1 || t.bottom <= b.top + 1);
      return { tip: tipEl?.innerText ?? '', code: document.getElementById('state-actions-in-heatmap')?.innerText ?? '', clear, at: t && b ? `${Math.round(t.top)}-${Math.round(t.bottom)} vs box ${Math.round(b.top)}-${Math.round(b.bottom)}` : '' };
    }, S);
    await p.mouse.move(5, 5);
    await h.sleep(300);
  }
  expect(heatTip.clear, `heat map, the box's blank area: its popup just below or above the box (${heatTip.at})`);
  expect(heatTip.tip.includes(S) && /M\s*=?\s*\d|complexity/i.test(heatTip.tip) && /TestSequence\(rtrigTestMode\.Q\)/.test(heatTip.code), `heat map, the box's blank area: the state's complexity and its code (${heatTip.tip.replace(/\s+/g, ' ').slice(0, 120)})`);
  await p.click('#toolbar-heatmap-btn').catch(() => {});
  await h.sleep(500);

  // Priorities: a second transition out of WAITING: both numbered, a badge each in its box; Raise priority on the
  // second reorders its method
  const two = pou.replace('\t\t\tIF (cmd_bTestStart) THEN\n', '\t\t\tIF (cmd_bTestAbort) THEN\n\t\t\t\teTestState := E_TEST_SEQ.INIT;\n\t\t\tEND_IF\n\t\t\tIF (cmd_bTestStart) THEN\n');
  expect(two !== pou, 'a second transition out of WAITING');
  await toApp({ type: 'loadPou', source: { ...source, content: two } });
  const badgesOf = () => p.evaluate((w) => [...document.querySelectorAll('#mermaid-diagram-svg-container .tc-priority-badge')].filter((b) => b.getAttribute('data-from') === w).map((b) => `${b.getAttribute('data-to').split('__').pop()}:${b.getAttribute('data-priority')}`).sort(), inner('WAITING'));
  let badges = await badgesOf();
  for (let t = 0; t < 8000 && badges.length < 2; t += 250) { await h.sleep(250); badges = await badgesOf(); }
  expect(badges.join() === 'INIT:1,RUNNING:2', `its priority badges: ${badges.join()}`);
  const badge = await p.$(`#mermaid-diagram-svg-container .tc-priority-badge[data-from="${inner('WAITING')}"][data-priority="2"]`);
  if (badge) {
    await badge.click({ button: 'right' });
    await p.waitForSelector('#context-menu-priority-up-btn', { timeout: 3000 }).catch(() => {});
    var menuIds = await p.evaluate(() => [...document.querySelectorAll('[role="menu"] [id], .context-menu [id], button[id$="-btn"]')].map((b) => b.id).filter((x) => /priority|goto|move/.test(x)).join(' '));
    await p.click('#context-menu-priority-up-btn').catch(() => {});
  }
  let after = await badgesOf();
  for (let t = 0; t < 8000 && after.join() !== 'INIT:2,RUNNING:1'; t += 250) { await h.sleep(250); after = await badgesOf(); }
  expect(after.join() === 'INIT:2,RUNNING:1', `Raise priority on its second: first now (${after.join()}; menu: ${menuIds ?? 'no badge'})`);
  // (the state itself: its own transitions numbered from its box)
  const own = await p.evaluate((s) => [...document.querySelectorAll('#mermaid-diagram-svg-container .tc-priority-badge')].filter((b) => b.getAttribute('data-from') === s).map((b) => b.getAttribute('data-priority')).sort().join(), S);
  expect(/^1,2/.test(own), `${S}'s own transitions: their priority badges from its box (${own})`);
  await toApp({ type: 'loadPou', source });
  await h.sleep(1500);

  // The KAnalogMeasure sample: KANALOGMEASURE_ENABLING (outside any composite) calls readDiagnostics(), a state machine
  // of its own: drawn in both styles, with and without the states' descriptions (declared once: no "Group nodes can
  // only have label")
  await p.click('#dock-tab-diagram').catch(() => {});
  await p.select('#sample-selector', 'k-analog-measure');
  const kam = 'KANALOGMEASURE_ENABLING__readDiagnostics__DIAG_READ_START';
  for (const style of ['flowchart', 'stateDiagram']) {
    await p.evaluate((st) => [...document.querySelectorAll('button')].find((x) => new RegExp(`^${st}`).test(x.textContent.trim()))?.click(), style);
    for (const desc of [false, true]) {
      await p.evaluate((on) => {
        const box = [...document.querySelectorAll('label')].find((l) => /Include state descriptions/.test(l.textContent))?.querySelector('input');
        if (box && box.checked !== on) box.click();
      }, desc);
      await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${kam}"]`, { timeout: 15000 }).catch(() => {});
      await h.sleep(800);
      const shown = !!(await p.$(`#mermaid-canvas-area g.node[data-state-id="${kam}"]`));
      const failed = await p.evaluate(() => /Mermaid Render Error/.test(document.body.innerText));
      expect(shown && !failed, `KAnalogMeasure, ${style}${desc ? ', with descriptions' : ''}: readDiagnostics inside KANALOGMEASURE_ENABLING (${shown}; render error: ${failed})`);
    }
  }

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
