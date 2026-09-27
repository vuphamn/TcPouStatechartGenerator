// The code editors (XAE stand-in bridge, a small POU with no base class, so the undeclared check runs):
// Find All References (the editors' menu, Shift+F12, a state's menu on the canvas), completion (Ctrl+Space, after a
// dot), problems underlined in the code with the message on hover, and the Problems tab's Declare… / Remove fixes
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const MENU = '[aria-label="Editor Context Menu"]';
const cdata = (s) => `<![CDATA[${s}]]>`;

const DO_STATE = [
  'CASE machineState OF',
  '\tS_IDLE:',
  '\t\tnCycles := nCycles + 1;',
  '\t\tIF cmd_bStart AND bTypo THEN',
  '\t\t\tmachineState := E_S.S_RUN;',
  '\t\tEND_IF',
  '\tS_RUN:',
  '\t\tstData.rPos := 1.5;',
  '\t\tIF cmd_bStop THEN',
  '\t\t\tmachineState := E_S.S_IDLE;',
  '\t\tEND_IF',
  'END_CASE',
].join('\n');
const DECL = ['FUNCTION_BLOCK SM_X', 'VAR_INPUT', '\tcmd_bStart : BOOL; // start', '\tcmd_bStop : BOOL;', 'END_VAR', 'VAR', '\tmachineState : E_S;', '\tnCycles : INT;', '\tnSpare : INT;', '\tstData : ST_Pos;', '\tcmd_bStop : BOOL;', 'END_VAR'].join('\n');
const method = (name, decl, code) => `    <Method Name="${name}" Id="{${name}}">\n      <Declaration>${cdata(decl)}</Declaration>\n      <Implementation>\n        <ST>${cdata(code)}</ST>\n      </Implementation>\n    </Method>`;
const POU = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <POU Name="SM_X" Id="{1}" SpecialFunc="None">\n    <Declaration>${cdata(DECL)}</Declaration>\n    <Implementation>\n      <ST>${cdata('doState();')}</ST>\n    </Implementation>\n${method('doState', 'METHOD doState : BOOL', DO_STATE)}\n  </POU>\n</TcPlcObject>`;
const DUT = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <DUT Name="E_S" Id="{2}">\n    <Declaration>${cdata("{attribute 'qualified_only'}\nTYPE E_S :\n(\n\tS_IDLE := 0,\n\tS_RUN\n);\nEND_TYPE")}</Declaration>\n  </DUT>\n</TcPlcObject>`;
const STRUCT = `<TcPlcObject><DUT Name="ST_Pos" Id="{3}"><Declaration>${cdata('TYPE ST_Pos :\nSTRUCT\n\trPos : LREAL;\n\trSpeed : LREAL;\nEND_STRUCT\nEND_TYPE')}</Declaration></DUT></TcPlcObject>`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const toApp = (m) => p.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.exposeFunction('__hostPost', async (m) => {
    if (m.type === 'ready') await toApp({ type: 'loadPou', source: { name: 'SM_X.TcPOU', path: 'C:\\proj\\SM_X.TcPOU', content: POU, dutCandidates: [{ name: 'E_S.TcDUT', relativePath: 'E_S.TcDUT', path: 'C:\\proj\\E_S.TcDUT', content: DUT }] } });
    else if (m.type === 'projectSymbols') await toApp({ type: 'projectSymbols', project: 'P', files: [{ name: 'ST_Pos.TcDUT', path: 'C:\\proj\\ST_Pos.TcDUT', content: STRUCT }] });
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
  await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="S_IDLE"]', { timeout: 60000 });
  await h.sleep(1200);

  const caretAt = (id, text, offset = 1) => p.evaluate((id, text, offset) => {
    const ta = document.getElementById(id);
    const at = ta.value.indexOf(text);
    if (at < 0) throw new Error(`"${text}" not in ${id}`);
    ta.focus();
    ta.setSelectionRange(at + offset, at + offset);
  }, id, text, offset);
  const rightClickAt = async (id, text) => {
    await caretAt(id, text);
    for (let i = 0; i < 3; i++) {
      await h.sleep(400);
      await p.evaluate((id) => document.getElementById(id).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400, button: 2 })), id);
      await h.sleep(300);
      if (await p.$(MENU)) return true;
    }
    return false;
  };
  const refs = () => p.$$eval('#references-dialog .reference-row', (r) => r.map((x) => `${x.getAttribute('data-where')}:${x.getAttribute('data-line')}:${x.textContent.replace(/\s+/g, ' ').trim()}`));

  // 1. Find All References (the Method Editor's menu)
  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-implementation-editor');
  await h.sleep(600);
  expect(await rightClickAt('method-implementation-editor', 'nCycles'), 'the menu on nCycles');
  expect(await p.evaluate(() => { const b = document.getElementById('editor-menu-find-all-refs'); b?.click(); return !!b; }), 'Find All References to nCycles');
  await p.waitForSelector('#references-dialog', { timeout: 3000 }).catch(() => {});
  let rows = await refs();
  expect(rows.length === 3 && rows.some((r) => /^declaration:8:.*decl/.test(r)) && rows.filter((r) => /^doState\(\):3:/.test(r)).length === 2 && rows.some((r) => /write/.test(r)), `references: ${rows.join(' | ')}`);
  // A click: the method at the line
  await p.evaluate(() => [...document.querySelectorAll('#references-dialog .reference-row')].find((r) => r.getAttribute('data-where') === 'declaration')?.click());
  await h.sleep(800);
  expect((await p.$eval('#pou-declaration-editor', (e) => e.value).catch(() => '')).startsWith('FUNCTION_BLOCK SM_X'), 'the declaration\'s row: the POU Editor');
  await p.keyboard.press('Escape');
  await h.sleep(200);
  // Shift+F12 in the POU Editor
  await caretAt('pou-declaration-editor', 'cmd_bStart');
  await p.keyboard.down('Shift'); await p.keyboard.press('F12'); await p.keyboard.up('Shift');
  await p.waitForSelector('#references-dialog', { timeout: 3000 }).catch(() => {});
  rows = await refs();
  expect(rows.length === 2 && /References to cmd_bStart/.test(await p.$eval('#references-dialog', (e) => e.textContent)), `Shift+F12 on cmd_bStart: ${rows.join(' | ')}`);
  await p.keyboard.press('Escape');
  // A state's menu on the canvas
  await p.click('#dock-tab-diagram');
  await h.sleep(600);
  const pt = await p.evaluate(() => { const r = document.querySelector('#mermaid-canvas-area g.node[data-state-id="S_RUN"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.click(pt.x, pt.y, { button: 'right' });
  await h.sleep(400);
  await p.evaluate(() => document.getElementById('context-menu-find-refs-btn')?.click());
  await p.waitForSelector('#references-dialog', { timeout: 3000 }).catch(() => {});
  rows = await refs();
  expect(rows.length === 2 && rows.every((r) => /^doState\(\)/.test(r)), `the state S_RUN: ${rows.join(' | ')}`);
  await p.keyboard.press('Escape');

  // 2. Completion in the Method Editor: Ctrl+Space, after a dot
  await p.click('#dock-tab-method');
  await h.sleep(500);
  await caretAt('method-implementation-editor', '\tS_RUN:', 0);
  await p.keyboard.type('\t\tcmd_b', { delay: 10 });
  await p.keyboard.down('Control'); await p.keyboard.press('Space'); await p.keyboard.up('Control');
  await h.sleep(300);
  let items = await p.$$eval('#method-implementation-editor-completion .code-completion-item', (r) => r.map((x) => x.getAttribute('data-name')));
  expect(items.join() === 'cmd_bStart,cmd_bStop', `Ctrl+Space on "cmd_b": ${items.join(', ')}`);
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  await h.sleep(200);
  await p.keyboard.type(' := stData.', { delay: 10 });
  await h.sleep(400);
  items = await p.$$eval('#method-implementation-editor-completion .code-completion-item', (r) => r.map((x) => x.getAttribute('data-name')));
  expect(items.join() === 'rPos,rSpeed', `after "stData.": ${items.join(', ')} (ST_Pos from the project)`);
  await p.keyboard.type('rS', { delay: 10 });
  await h.sleep(250);
  await p.keyboard.press('Tab');
  await p.keyboard.type(';\n', { delay: 10 });
  await h.sleep(200);
  const typed = await p.$eval('#method-implementation-editor', (e) => e.value.split('\n').find((l) => l.includes(':= stData.')));
  expect(typed?.trim() === 'cmd_bStop := stData.rSpeed;', `inserted: "${typed?.trim()}"`);
  // Undo (the editor's own): the typing and the insert go again
  for (let i = 0; i < 4; i++) {
    await p.keyboard.down('Control'); await p.keyboard.press('z'); await p.keyboard.up('Control');
    await h.sleep(100);
  }
  expect(!(await p.$eval('#method-implementation-editor', (e) => e.value)).includes('stData.rSpeed'), 'Ctrl+Z undoes the insert');

  // 3. Problems in the code: underlined, with the message
  const marks = (id) => p.$$eval(`#${id}-markers .st-marker`, (m) => m.map((x) => `${x.getAttribute('data-line')}:${x.getAttribute('data-message')}`));
  let impl = await marks('method-implementation-editor');
  expect(impl.length === 1 && /^4:bTypo is not declared/.test(impl[0]), `doState(): ${impl.join(' | ')}`);
  await p.click('#dock-tab-pou');
  await h.sleep(600);
  const decl = await marks('pou-declaration-editor');
  expect(decl.some((m) => /^11:cmd_bStop is declared twice/.test(m)) && decl.some((m) => /^9:nSpare : INT \(VAR\) is not used/.test(m)), `the declaration: ${decl.join(' | ')}`);
  // Hover: the message as the tooltip
  const hover = await p.evaluate(() => {
    const m = [...document.querySelectorAll('#pou-declaration-editor-markers .st-marker')].find((x) => /nSpare/.test(x.getAttribute('data-message')));
    const r = m.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y - 6 };
  });
  await p.mouse.move(hover.x, hover.y);
  await h.sleep(200);
  expect(/nSpare : INT \(VAR\) is not used/.test(await p.$eval('#pou-declaration-editor', (e) => e.title)), 'hover: the message');
  await p.screenshot({ path: h.out('editor-intel.png') });

  // 4. The Problems tab's fixes: Declare… bTypo (in doState()), Remove nSpare
  await p.evaluate(() => document.getElementById('dock-tab-problems')?.click());
  await h.sleep(600);
  const clickFix = (text) => p.evaluate((text) => {
    // (the smallest element with the message and a fix button: the finding's row)
    const row = [...document.querySelectorAll('#problems-panel *')].filter((x) => x.textContent.includes(text) && x.querySelector('.problems-fix')).sort((a, b) => a.textContent.length - b.textContent.length)[0];
    const b = row?.querySelector('.problems-fix');
    b?.click();
    return b?.textContent.trim() ?? '';
  }, text);
  expect(/Declare/.test(await clickFix('bTypo is not declared')), 'bTypo: Declare…');
  await p.waitForSelector('#declare-variable-dialog', { timeout: 3000 }).catch(() => {});
  expect((await p.$eval('#text-prompt-declare-type', (e) => e.value).catch(() => '')) === 'BOOL', 'the form: BOOL guessed');
  await p.click('#text-prompt-declare-ok');
  await h.sleep(800);
  expect(/Remove/.test(await clickFix('nSpare : INT (VAR) is not used')), 'nSpare: Remove');
  await p.waitForSelector('#text-prompt-dialog', { timeout: 3000 }).catch(() => {});
  expect(/nSpare : INT;/.test(await p.$eval('#text-prompt-details', (e) => e.textContent).catch(() => '')), 'asked first, with its line');
  await p.click('#text-prompt-submit');
  await h.sleep(1000);
  const problems = await p.$eval('#problems-panel', (e) => e.innerText);
  expect(!/bTypo is not declared/.test(problems) && !/nSpare/.test(problems), 'both gone from Problems');
  await p.click('#dock-tab-method');
  await h.sleep(500);
  await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Method \(/.test(b.textContent.trim()))?.click());
  await h.sleep(300);
  expect(/bTypo : BOOL;/.test(await p.$eval('#method-declaration-editor', (e) => e.value)), 'bTypo declared in doState()');
  await p.click('#dock-tab-pou');
  await h.sleep(500);
  expect(!/nSpare/.test(await p.$eval('#pou-declaration-editor', (e) => e.value)), 'nSpare removed from the declaration');
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
