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
  // (the state's box and its sub-machine's frame: their titles; flowchart: the frame's, stateDiagram: under the state's name)
  const boxTitle = () => p.evaluate((s) => [...document.querySelectorAll('#mermaid-canvas-area .statediagram-cluster, #mermaid-canvas-area g.cluster')].filter((c) => { const id = c.getAttribute('data-id') || c.id; return id.endsWith(s) || id.includes(`${s}__TestSequence`); }).map((c) => c.querySelector('.cluster-label')?.textContent || c.textContent || '').join(' | '), S);

  // Expanded by default
  const drawn = await p.evaluate((ids) => ids.map((id) => {
    const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`);
    // (its name: the label's first line, upper case)
    return n ? `${n.textContent.trim().match(/^[A-Z0-9_]+/)?.[0] ?? ''}${n.getAttribute('class')?.includes('kssUnreachable') ? '(dashed)' : ''}` : '-';
  }), ['INIT', 'WAITING', 'RUNNING', 'UNUSED'].map(inner));
  expect(drawn.join(' ') === 'INIT WAITING RUNNING UNUSED(dashed)' && /TestSequence · while cmd_bTestMode/.test(await boxTitle()), `drawn inside ${S} by default (${drawn.join(' ')})`);
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

  // stateDiagram-v2: the same, its title under the state's name (then back to flowchart)
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /stateDiagram/.test(x.textContent))?.click());
  for (let i = 0; i < 40 && (await innerCount()) < 4; i++) await h.sleep(250);
  await h.sleep(800);
  const sdCount = await innerCount();
  const sdTitle = await boxTitle();
  expect(sdCount >= 4 && /⊟ TestSequence/.test(sdTitle), `stateDiagram-v2: inside its box too (${sdCount} states; "${sdTitle.replace(/\s+/g, ' ').slice(0, 70)}")`);
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
