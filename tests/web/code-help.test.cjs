// Code help on the canvas (XAE stand-in bridge with the PLC project's types): the condition dialog lists the members
// after a dot (smOutfeedStopAxis. -> SM_KAxis's), a GVL's variables, the syntax checked while typing; a transition's
// condition changed from its menu, with F2, and from the Transition Guard window, the dialog by the label; a state's
// entry / do / exit actions edited from its menu (not drawn on it: its name and description only)
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;
const cdata = (s) => `<![CDATA[${s}]]>`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const sent = [];
  const toApp = (m) => p.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  const sample = await p.evaluate(async () => {
    const mod = await import('/src/samples/samplesData.ts');
    return { pou: mod.SAMPLES[0].pouContent, dut: mod.SAMPLES[0].dutContent };
  });
  const files = [
    { name: 'SM_KAxis.TcPOU', path: 'C:\\proj\\SM_KAxis.TcPOU', content: `<TcPlcObject><POU Name="SM_KAxis" Id="{a}"><Declaration>${cdata('FUNCTION_BLOCK SM_KAxis\nVAR_INPUT\n\tconfig_fHomePosition : LREAL;\n\tcmd_bHome : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tstatus_bHomed : BOOL;\nEND_VAR')}</Declaration></POU></TcPlcObject>` },
    { name: 'GVL_IO.TcGVL', path: 'C:\\proj\\GVL_IO.TcGVL', content: `<TcPlcObject><GVL Name="GVL_IO" Id="{b}"><Declaration>${cdata("{attribute 'qualified_only'}\nVAR_GLOBAL\n\tbDoorClosed : BOOL;\n\tbAirOk : BOOL;\nEND_VAR")}</Declaration></GVL></TcPlcObject>` },
  ];
  await p.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: 'C:\\proj\\SM_TableManager.TcPOU', content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] } });
    else if (m.type === 'projectSymbols') await toApp({ type: 'projectSymbols', project: 'P', files });
    else if (m.type === 'projectPous') await toApp({ type: 'projectPous', project: 'P', pous: [], duts: [] });
  });
  await p.evaluateOnNewDocument(() => {
    const listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = { postMessage: (m) => window.__hostPost(m), addEventListener: (t, fn) => listeners.push(fn), removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
    window.__fromHost = (m) => listeners.forEach((fn) => fn({ data: m }));
  });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${S('HOMMING')}"]`, { timeout: 60000 });
  await h.sleep(1000);
  // (XAE starts without the left panel: its state list is used to bring states into view)
  if (!(await p.$('[id^="state-list-item-"]'))) await p.click('#toggle-sidebar-btn');
  await p.waitForSelector('[id^="state-list-item-"]', { timeout: 5000 });
  await h.sleep(800);
  expect(sent.some((m) => m.type === 'projectSymbols'), 'the app asks XAE for the project\'s types');

  const goTo = async (state) => {
    await p.evaluate((s) => [...document.getElementById(`state-list-item-${s}`).querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click(), state);
    await h.sleep(1200);
  };
  const nodePoint = (id) => p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
  const edgePoint = (key) => p.evaluate((key) => {
    const el = document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`);
    if (!el) return null;
    const len = el.getTotalLength(); const m = el.getScreenCTM();
    for (const f of [0.3, 0.4, 0.6, 0.7, 0.2, 0.8, 0.5]) {
      const q = el.getPointAtLength(len * f); const x = q.x * m.a + q.y * m.c + m.e; const y = q.x * m.b + q.y * m.d + m.f;
      if (document.elementFromPoint(x, y)?.getAttribute('data-edge-key') === key) return { x, y };
    }
    return null;
  }, key);
  const listed = () => p.$$eval('#text-prompt-var-list .text-prompt-var', (r) => r.map((x) => x.getAttribute('data-name')));
  const value = () => p.$eval('#text-prompt-input', (e) => e.value);
  const doState = async () => {
    await p.click('#dock-tab-method');
    await p.waitForSelector('#method-implementation-editor');
    await h.sleep(400);
    const v = await p.$eval('#method-implementation-editor', (e) => e.value);
    await p.click('#dock-tab-diagram');
    await h.sleep(500);
    return v;
  };
  const clearField = async () => {
    await p.evaluate(() => { const el = document.getElementById('text-prompt-input'); el.focus(); el.select(); });
    await p.keyboard.press('Backspace');
  };

  // 1. New transition: members after a dot, a GVL's, the syntax
  await goTo(S('IDLE_FEED_OFF'));
  let pt = await nodePoint(S('IDLE_FEED_OFF'));
  await p.mouse.click(pt.x, pt.y, { button: 'right' });
  await h.sleep(400);
  await p.evaluate(() => document.getElementById('context-menu-add-transition-btn')?.click());
  await goTo(S('CLAMPPING'));
  pt = await nodePoint(S('CLAMPPING'));
  await p.mouse.click(pt.x, pt.y);
  await p.waitForSelector('#text-prompt-input', { timeout: 5000 });
  await h.sleep(300);
  await p.keyboard.type('smOutfeedStopAxis.', { delay: 15 });
  await h.sleep(300);
  let rows = await listed();
  const of = await p.$eval('#text-prompt-members-of', (e) => e.textContent).catch(() => '');
  expect(rows.join() === 'config_fHomePosition,cmd_bHome,status_bHomed' && /smOutfeedStopAxis : SM_KAxis/.test(of), `smOutfeedStopAxis.: ${rows.join(', ')} (${of})`);
  await p.keyboard.type('stat', { delay: 15 });
  await h.sleep(200);
  await p.keyboard.press('Enter');
  await h.sleep(200);
  expect((await value()) === 'smOutfeedStopAxis.status_bHomed', `picked: ${await value()}`);
  await p.keyboard.type(' AND GVL_IO.', { delay: 15 });
  await h.sleep(300);
  rows = await listed();
  expect(rows.join() === 'bDoorClosed,bAirOk', `GVL_IO. (qualified_only): ${rows.join(', ')}`);
  await p.keyboard.press('Escape');
  // The syntax while typing
  await clearField();
  await p.keyboard.type('bA := TRUE', { delay: 10 });
  await h.sleep(200);
  let err = await p.$eval('#text-prompt-error', (e) => e.textContent).catch(() => '');
  expect(/compares with =/.test(err) && (await p.$eval('#text-prompt-submit', (e) => e.disabled)), `":=": ${err}, Add transition disabled`);
  await clearField();
  await p.keyboard.type('(cmd_bHome AND', { delay: 10 });
  await h.sleep(200);
  err = await p.$eval('#text-prompt-error', (e) => e.textContent).catch(() => '');
  expect(/missing|not closed/.test(err), `"(cmd_bHome AND": ${err}`);
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await h.sleep(300);
  expect(!(await p.$('#text-prompt-dialog')), 'cancelled');

  // 2. Edit condition from the transition's menu: the dialog by its label, the condition as written
  const key = `${S('CLAMPED')}->${S('REFEED_START')}`;
  await goTo(S('CLAMPED'));
  let ep = await edgePoint(key);
  await p.mouse.click(ep.x, ep.y, { button: 'right' });
  await h.sleep(400);
  expect(await p.evaluate(() => { const b = document.getElementById('context-menu-edit-condition-btn'); b?.click(); return !!b; }), 'the transition\'s menu: Edit condition…');
  await p.waitForSelector('#text-prompt-input', { timeout: 5000 });
  const before = await value();
  const box = await p.$eval('#text-prompt-dialog', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const near = Math.abs(box.x + box.w / 2 - ep.x) < 400 && (Math.abs(box.y - ep.y) < 120 || Math.abs(box.y + box.h - ep.y) < 120);
  expect(before.length > 2 && near, `the condition as written: "${before}"; the dialog by the transition (${Math.round(box.x)},${Math.round(box.y)} vs ${Math.round(ep.x)},${Math.round(ep.y)})`);
  await clearField();
  await p.keyboard.type('cmd_bHome AND GVL_IO.bAirOk', { delay: 10 });
  await h.sleep(200);
  await p.keyboard.press('Escape'); // (closes the list)
  await p.keyboard.press('Enter');
  await h.sleep(1200);
  let code = await doState();
  expect(code.includes('IF cmd_bHome AND GVL_IO.bAirOk THEN') && !code.includes(`IF ${before} THEN`), 'doState(): the new condition');
  // The chart
  const labelNow = await p.evaluate((key) => [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].some((l) => /GVL_IO\.bAirOk/.test(l.textContent)), key);
  expect(labelNow, 'the label on the canvas shows it');

  // 3. F2 on the selected transition
  await goTo(S('CLAMPED'));
  ep = await edgePoint(key);
  await p.mouse.click(ep.x, ep.y);
  await h.sleep(400);
  await p.keyboard.press('F2');
  await p.waitForSelector('#text-prompt-input', { timeout: 4000 }).catch(() => {});
  expect((await value().catch(() => '')) === 'cmd_bHome AND GVL_IO.bAirOk', 'F2: the selected transition\'s condition');
  await p.keyboard.press('Escape');
  await h.sleep(300);

  // 4. The Transition Guard window's Edit condition
  await p.mouse.click(ep.x, ep.y);
  await h.sleep(120);
  await p.mouse.click(ep.x, ep.y);
  await p.waitForSelector('#guard-inspector-edit-condition-btn', { timeout: 4000 }).catch(() => {});
  expect(!!(await p.$('#guard-inspector-edit-condition-btn')), 'the Guard window: Edit condition');
  await p.click('#guard-inspector-edit-condition-btn').catch(() => {});
  await p.waitForSelector('#text-prompt-input', { timeout: 4000 }).catch(() => {});
  await clearField();
  await p.keyboard.type('cmd_bHome', { delay: 10 });
  await p.keyboard.press('Escape');
  await p.keyboard.press('Enter');
  await h.sleep(1200);
  code = await doState();
  expect(code.includes('IF cmd_bHome THEN') && !(await p.$('#guard-inspector-edit-condition-btn')), 'from the Guard window: changed (the window closed)');

  // 5. The state's code (its whole CASE branch, as written) from its menu: highlighted, written back
  await goTo(S('CLAMPED'));
  pt = await nodePoint(S('CLAMPED'));
  await p.mouse.click(pt.x, pt.y, { button: 'right' });
  await h.sleep(400);
  const actionItems = await p.$$eval('[id^="context-menu-action-"]', (b) => b.length);
  const codeItem = await p.$eval('#context-menu-edit-state-code-btn', (e) => e.textContent.trim()).catch(() => '');
  expect(actionItems === 0 && /^Edit the state's code… \(\d+ lines\)$/.test(codeItem), `the state's menu: ${codeItem} (no Entry / Do / Exit action items)`);
  await p.click('#context-menu-edit-state-code-btn');
  await p.waitForSelector('textarea#text-prompt-input', { timeout: 4000 });
  const whole = await p.$eval('#text-prompt-input', (e) => e.value);
  const hl = await p.evaluate(() => {
    const t = document.getElementById('text-prompt-input');
    const pre = document.getElementById('text-prompt-highlight');
    const a = t.getBoundingClientRect();
    const b = pre?.getBoundingClientRect();
    return { tokens: pre ? pre.querySelectorAll('.token').length : 0, same: !!b && Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1, clear: getComputedStyle(t).color, text: pre?.textContent === t.value + '\n' };
  });
  expect(/machineState :=/.test(whole) && !/^\s/.test(whole) && (await p.$$eval('#text-prompt-dialog textarea', (x) => x.length)) === 1, `all of it, as written, in one box (${whole.split('\n').length} lines)`);
  expect(hl.tokens > 5 && hl.same && hl.text && /rgba\(0, 0, 0, 0\)|transparent/.test(hl.clear), `highlighted behind the field, lined up (${hl.tokens} tokens, ${hl.clear})`);
  await p.screenshot({ path: h.out('edit-state-code.png') });
  // An exit block typed at the end (several lines: Enter adds a line, Ctrl+Enter sets it)
  await p.keyboard.down('Control'); await p.keyboard.press('End'); await p.keyboard.up('Control');
  for (const line of ['', 'IF machineState <> TABLEMANAGER_CLAMPED THEN', '\tstatus_bBusy := FALSE;', 'END_IF']) {
    await p.keyboard.press('Enter');
    await p.keyboard.type(line, { delay: 3 });
  }
  expect(!!(await p.$('#text-prompt-dialog')), 'Enter adds a line (the dialog stays)');
  await p.keyboard.down('Control'); await p.keyboard.press('Enter'); await p.keyboard.up('Control');
  await h.sleep(1200);
  code = await doState();
  const branch = code.split(`\t${S('CLAMPED')}:`)[1]?.split(/\n\t[A-Z_]+:/)[0] ?? '';
  expect(/END_IF\r?\n\r?\n\t\tIF machineState <> TABLEMANAGER_CLAMPED THEN\r?\n\t\t\tstatus_bBusy := FALSE;\r?\n\t\tEND_IF\s*$/.test(branch), `written back at the end of CLAMPED's branch, at its indentation:\n${branch.split('\n').slice(-5).join('\n')}`);
  // What changes, before Set code; Open in Method Editor: doState() at the state's CASE label
  await p.mouse.click(pt.x, pt.y, { button: 'right' });
  await h.sleep(400);
  await p.click('#context-menu-edit-state-code-btn');
  await p.waitForSelector('textarea#text-prompt-input', { timeout: 4000 });
  const noChange = !(await p.$('#text-prompt-preview'));
  await p.keyboard.down('Control'); await p.keyboard.press('Home'); await p.keyboard.up('Control');
  await p.keyboard.type('// first\n', { delay: 3 });
  await h.sleep(200);
  const diffRows = await p.$$eval('#text-prompt-preview li', (r) => r.map((x) => `${x.textContent}|${x.className.includes('emerald') ? 'green' : ''}`));
  expect(noChange && /^1 line in, 0 out/.test(diffRows[0] ?? '') && diffRows.some((r) => /^\+ \/\/ first\|green$/.test(r)), `the changes shown: ${diffRows.slice(0, 3).join(' / ')}`);
  await p.click('#text-prompt-open-method-btn');
  await h.sleep(1200);
  const caretAt = await p.$eval('#method-implementation-editor', (e) => e.value.slice(0, e.selectionStart).split('\n').pop() + '|' + e.value.split('\n')[e.value.slice(0, e.selectionStart).split('\n').length - 1]).catch(() => '');
  const methodOpen = !(await p.$('#text-prompt-dialog')) && !!(await p.$('#method-implementation-editor'));
  const typedKept = (await doState()).includes('// first');
  expect(methodOpen && !typedKept && /TABLEMANAGER_CLAMPED:/.test(await p.evaluate(() => document.querySelector('#method-implementation-editor')?.value.split('\n').find((l) => /TABLEMANAGER_CLAMPED:/.test(l)) ?? '')), `Open in Method Editor: doState() (what was typed not kept); caret line "${caretAt.split('|')[1]?.trim()}"`);
  await p.click('#dock-tab-diagram').catch(() => {});
  await h.sleep(600);
  // Not drawn on the state: its name and its description only (its actions in its hover preview)
  await h.sleep(2000);
  const nodeText = await p.$eval(`#mermaid-canvas-area g.node[data-state-id="${S('CLAMPED')}"]`, (e) => e.textContent).catch(() => '');
  expect(!/exit \/|entry \/|do \//.test(nodeText) && nodeText.includes(S('CLAMPED')) && !(await p.$('#state-actions-checkbox')), `the state shows its name (and description), no entry / do / exit (${nodeText.replace(/\s+/g, ' ').slice(0, 120)})`);
  await p.screenshot({ path: h.out('code-help.png') });
  // (a close look at the state)
  await p.mouse.move(pt.x, pt.y);
  await p.keyboard.down('Control');
  for (let i = 0; i < 10; i++) {
    await p.mouse.wheel({ deltaY: -120 });
    await h.sleep(50);
  }
  await p.keyboard.up('Control');
  await h.sleep(800);
  const clip = await p.evaluate((s) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${s}"]`).getBoundingClientRect(); return { x: Math.max(0, r.x - 20), y: Math.max(0, r.y - 20), width: r.width + 40, height: r.height + 40 }; }, S('CLAMPED'));
  await p.screenshot({ path: h.out('code-help-state.png'), clip });
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
