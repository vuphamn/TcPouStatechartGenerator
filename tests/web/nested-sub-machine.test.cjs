// A nested sub-machine on the canvas and simulated (the POU through the XAE stand-in bridge): TABLEMANAGER_IDLE_FEED_OFF
// calls Outer(), a state machine of its own, whose state B calls Inner(), another (while cmd_bInner). The canvas: B a
// box inside Outer's, Inner's box inside B, its states inside that; no render error, in both chart styles. Go to code on
// one of Inner's states: the Method Editor at its CASE label in Inner(). Simulated: Outer starts with the state, Inner
// when B is current and cmd_bInner holds; the state, B and Inner's state glow; the panel lists both; Step moves Inner's
// first (the innermost), Back puts both back; cmd_bInner off: Inner stops, B's own transitions offered
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const method = (name, id, decl, body) => `    <Method Name="${name}" Id="{${id}}">
      <Declaration><![CDATA[METHOD ${name}
${decl}]]></Declaration>
      <Implementation>
        <ST><![CDATA[${body}]]></ST>
      </Implementation>
    </Method>
`;
const OUTER = method('Outer', '11111111-2222-3333-4444-555555555501', 'VAR_INST\n\teOuter\t: E_OUTER;\nEND_VAR\n', `CASE eOuter OF
	E_OUTER.A:
		IF cmd_bGo THEN
			eOuter := E_OUTER.B;
		END_IF
	E_OUTER.B:
		IF cmd_bInner THEN
			Inner();
			RETURN;
		END_IF
		IF cmd_bBack THEN
			eOuter := E_OUTER.A;
		END_IF
END_CASE`);
const INNER = method('Inner', '11111111-2222-3333-4444-555555555502', 'VAR_INST\n\teInner\t: E_INNER;\nEND_VAR\n', `CASE eInner OF
	E_INNER.X:
		eInner := E_INNER.Y;
	E_INNER.Y:
		IF cmd_bZ THEN
			eInner := E_INNER.X;
		END_IF
END_CASE`);
const S = 'TABLEMANAGER_IDLE_FEED_OFF';
const B = `${S}__Outer__B`;
const X = `${B}__Inner__X`;
const Y = `${B}__Inner__Y`;

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
  const pou = sample.pou.replace(/(\tTABLEMANAGER_IDLE_FEED_OFF:\r?\n)/, '$1\t\tOuter();\n').replace('</POU>', `${OUTER}${INNER}  </POU>`);
  source = { name: 'SM_TableManager.TcPOU', path: 'C:\\proj\\SM_TableManager.TcPOU', content: pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] };
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${X}"]`, { timeout: 60000 }).catch(() => {});
  await h.sleep(1500);

  // 1. The canvas: boxes in boxes, both chart styles
  const boxesOf = () => p.evaluate(() => [...document.querySelectorAll('#mermaid-canvas-area g.cluster, #mermaid-canvas-area g.statediagram-cluster')].map((c) => (c.getAttribute('data-id') || c.id).replace(/^.*?render-[a-z0-9]+-/i, '').replace(/^state-/, '').replace(/-\d+$/, '')));
  const inside = (outer, inner) => p.evaluate((o, i) => {
    const name = (c) => (c.getAttribute('data-id') || c.id).replace(/^.*?render-[a-z0-9]+-/i, '').replace(/^state-/, '').replace(/-\d+$/, '');
    const box = [...document.querySelectorAll('#mermaid-canvas-area g.cluster, #mermaid-canvas-area g.statediagram-cluster')].find((c) => name(c) === o)?.querySelector(':scope > rect, :scope > g > rect.outer, rect')?.getBoundingClientRect();
    const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${i}"]`)?.getBoundingClientRect();
    return !!box && !!n && n.left >= box.left - 1 && n.right <= box.right + 1 && n.top >= box.top - 1 && n.bottom <= box.bottom + 1;
  }, outer, inner);
  for (const style of ['flowchart', 'stateDiagram']) {
    await p.evaluate((st) => [...document.querySelectorAll('button')].find((x) => new RegExp(`^${st}`).test(x.textContent.trim()))?.click(), style);
    await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${Y}"]`, { timeout: 15000 }).catch(() => {});
    await h.sleep(1000);
    const boxes = await boxesOf();
    const failed = await p.evaluate(() => /Mermaid Render Error/.test(document.body.innerText));
    expect(!failed && boxes.includes(B) && boxes.includes(`${B}__Inner`) && (await inside(B, X)) && (await inside(`${B}__Inner`, Y)), `${style}: B a box, Inner's box in it, X and Y inside (${boxes.filter((b) => b.startsWith(S)).join(', ')}; render error: ${failed})`);
  }

  // 2. Go to code on Inner's state Y: the Method Editor at its CASE label in Inner()
  // (the chart just redrawn in another style may still be moving: measured again, right-clicked again, until its menu)
  for (let tries = 0; tries < 4 && !(await p.$('#context-menu-goto-code-btn')); tries++) {
    await h.sleep(tries ? 700 : 300);
    const at = await p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`)?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; }, Y);
    if (!at) continue;
    await p.mouse.click(at.x, at.y, { button: 'right' });
    await p.waitForSelector('#context-menu-goto-code-btn', { timeout: 2000 }).catch(() => {});
  }
  await p.click('#context-menu-goto-code-btn').catch(() => {});
  const readCode = () => p.evaluate(() => {
    const ta = document.getElementById('method-implementation-editor');
    const box = document.getElementById('method-selector-combobox');
    const n = Number(document.querySelector('[data-highlighted-line]')?.getAttribute('data-highlighted-line'));
    return { method: (box?.value || '').trim(), line: n && ta ? ta.value.split('\n')[n - 1]?.trim() ?? '' : '' };
  });
  let code = await readCode();
  for (let i = 0; i < 25 && !(/Inner/.test(code.method) && /E_INNER\.Y\s*:/.test(code.line)); i++) {
    await h.sleep(200);
    code = await readCode();
  }
  expect(/Inner/.test(code.method) && /E_INNER\.Y\s*:/.test(code.line), `Go to code on Y: Inner() at its CASE label (${JSON.stringify(code)})`);

  // 3. Simulated
  await p.click('#dock-tab-diagram').catch(() => {});
  await p.click('#dock-tab-simulate');
  await p.waitForSelector('#sim-start', { timeout: 5000 }).catch(() => {});
  await p.select('#sim-start-state', S);
  await p.$eval('#sim-start', (e) => e.click());
  await h.sleep(800);
  const now = () => p.evaluate(() => ({
    outer: document.getElementById('sim-sub-state')?.textContent ?? null,
    inner: document.getElementById('sim-sub-state-1')?.textContent ?? null,
    boxes: [...document.querySelectorAll('#mermaid-diagram-svg-container g.live-active-cluster')].map((c) => (c.getAttribute('data-id') || c.id).replace(/^.*?render-[a-z0-9]+-/i, '').replace(/^state-/, '').replace(/-\d+$/, '')),
    marked: [...document.querySelectorAll('#mermaid-diagram-svg-container g.node.live-region-node')].map((n) => n.getAttribute('data-state-id')),
    offered: [...document.querySelectorAll('#simulation-panel li .font-mono')].map((x) => x.textContent.replace(/^→\s*/, '').trim()).filter((x) => /^[A-Z_]+$/.test(x)),
  }));
  const wait = async (ok, ms = 5000) => {
    let m = await now();
    for (let t = 0; t < ms && !ok(m); t += 200) { await h.sleep(200); m = await now(); }
    return m;
  };
  const click = (sel) => p.$eval(sel, (e) => e.click()).catch(() => {});
  const s0 = await wait((m) => m.outer === 'A');
  expect(s0.outer === 'A' && s0.inner === null && s0.marked.includes(`${S}__Outer__A`), `started: Outer in A, Inner not yet (${JSON.stringify(s0)})`);
  await click('#sim-var-cmd_bGo-true');
  await h.sleep(300);
  await click('#sim-step');
  const s1 = await wait((m) => m.outer === 'B');
  expect(s1.outer === 'B' && !s1.inner, `cmd_bGo, Step: Outer in B; Inner waits for cmd_bInner (${JSON.stringify(s1)})`);
  await click('#sim-var-cmd_bInner-true');
  const s2 = await wait((m) => m.inner === 'X');
  expect(s2.inner === 'X' && s2.boxes.includes(S) && s2.boxes.includes(B) && s2.marked.includes(X) && s2.offered[0] === 'Y', `cmd_bInner: Inner in X; the state and B glow, X inside; Inner's transition offered first (${JSON.stringify(s2)})`);
  expect(!s2.offered.includes('A') && s2.offered.includes('TABLEMANAGER_AUTOFEED_INIT'), `B's own transitions wait (a RETURN after Inner's call, in Outer()); the state's own still offered (no RETURN after Outer's call) (${s2.offered.join(',')})`);
  await click('#sim-step');
  const s3 = await wait((m) => m.inner === 'Y');
  expect(s3.inner === 'Y' && s3.outer === 'B' && s3.marked.includes(Y), `Step: Inner moves first, to Y (${JSON.stringify(s3)})`);
  await click('#sim-back');
  const s4 = await wait((m) => m.inner === 'X');
  expect(s4.inner === 'X' && s4.outer === 'B', `Back: X again, in B (${JSON.stringify(s4)})`);
  await click('#sim-var-cmd_bInner-false');
  await click('#sim-var-cmd_bBack-true');
  const s5 = await wait((m) => !m.inner && m.offered.includes('A'));
  expect(!s5.inner && s5.outer === 'B' && s5.offered.includes('A') && !s5.marked.includes(X), `cmd_bInner off: Inner stops, B's own transition offered (${JSON.stringify(s5)})`);
  await click('#sim-stop');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
