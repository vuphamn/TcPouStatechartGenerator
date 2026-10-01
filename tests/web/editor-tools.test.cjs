// This round (XAE stand-in bridge, a small POU): Go to Symbol (Ctrl+T) to a method, the method outline, and the
// Problems tab's fixes: "FB never called" (the call put in), "never runs" (the lines after a RETURN removed), no ELSE
// (an ELSE put in), a PRIVATE method nobody calls (removed); Extract Property; the header's Save and Save All
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const cdata = (s) => `<![CDATA[${s}]]>`;
const ID = 'method-implementation-editor';

const DO_STATE = [
  'CASE machineState OF',
  '\tS_IDLE:',
  '\t\tIF cmd_bStart THEN',
  '\t\t\tmachineState := E_S.S_RUN;',
  '\t\tEND_IF',
  '\tS_RUN:',
  '\t\tIF fbWait.Q THEN',
  '\t\t\tmachineState := E_S.S_IDLE;',
  '\t\tEND_IF',
  'END_CASE',
  'helper();',
].join('\n');
const HELPER = ['RETURN;', 'nCycles := 5;', 'nCycles := 6;'].join('\n');
const SPARE = 'nCycles := 0;';
const TIMERS = 'fbNoTime(IN := cmd_bStart);';
const DESC = ['CASE machineState OF', '\tE_S.S_IDLE: getStateDescription := \'Idle\';', 'END_CASE'].join('\n');
const DECL = ['FUNCTION_BLOCK SM_X', 'VAR_INPUT', '\tcmd_bStart : BOOL;', 'END_VAR', 'VAR', '\tmachineState : E_S;', '\tnCycles : INT;', '\tfbWait : TON;', '\tfbNoTime : TON;', 'END_VAR'].join('\n');
const method = (name, decl, code) => `    <Method Name="${name}" Id="{${name}}">\n      <Declaration>${cdata(decl)}</Declaration>\n      <Implementation>\n        <ST>${cdata(code)}</ST>\n      </Implementation>\n    </Method>`;
const POU = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <POU Name="SM_X" Id="{1}" SpecialFunc="None">\n    <Declaration>${cdata(DECL)}</Declaration>\n    <Implementation>\n      <ST>${cdata('doState();')}</ST>\n    </Implementation>\n${method('doState', 'METHOD doState : BOOL', DO_STATE)}\n${method('helper', 'METHOD helper : BOOL', HELPER)}\n${method('spare', 'METHOD PRIVATE spare', SPARE)}\n${method('timers', 'METHOD timers', TIMERS)}\n${method('getStateDescription', 'METHOD getStateDescription : STRING', DESC)}\n  </POU>\n</TcPlcObject>`;
const DUT = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <DUT Name="E_S" Id="{2}">\n    <Declaration>${cdata("{attribute 'qualified_only'}\nTYPE E_S :\n(\n\tS_IDLE := 0,\n\tS_RUN\n);\nEND_TYPE")}</Declaration>\n  </DUT>\n</TcPlcObject>`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const toApp = (m) => p.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  const sent = [];
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') await toApp({ type: 'loadPou', source: { name: 'SM_X.TcPOU', path: 'C:\\proj\\SM_X.TcPOU', content: POU, dutCandidates: [{ name: 'E_S.TcDUT', relativePath: 'E_S.TcDUT', path: 'C:\\proj\\E_S.TcDUT', content: DUT }] } });
    else if (m.type === 'projectPous') await toApp({ type: 'projectPous', project: 'P', pous: [], duts: [] });
    // XAE's own build (the stand-in: an error in timers(), a warning elsewhere)
    else if (m.type === 'buildProject') {
      await toApp({ type: 'plcBuildProgress', requestId: m.requestId, text: 'Building in XAE' });
      await toApp({ type: 'xaeBuildResult', requestId: m.requestId, ok: false, errors: 1, warnings: 1, items: [
        { level: 'error', text: "Identifier 'nope' not defined", file: 'C:\\proj\\SM_X.TcPOU@timers (Impl)', line: 1, column: 1, project: 'P' },
        { level: 'warning', text: 'Some warning', file: 'C:\\proj\\Other.TcPOU (Impl)', line: 3, column: 1, project: 'P' },
      ] });
    }
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
  const code = () => p.$eval(`#${ID}`, (e) => e.value).catch(() => '');
  const goToSymbol = async (text) => {
    for (let i = 0; i < 3 && (await p.$('#symbol-search')); i++) {
      await p.evaluate(() => document.getElementById('symbol-search-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
      await h.sleep(150);
    }
    await p.evaluate(() => document.activeElement?.blur());
    await p.keyboard.down('Control'); await p.keyboard.press('KeyT'); await p.keyboard.up('Control');
    await p.waitForSelector('#symbol-search-input', { timeout: 3000 }).catch(() => {});
    await p.keyboard.type(text, { delay: 5 });
    await h.sleep(150);
    const first = await p.$eval('#symbol-search .command-palette-item', (e) => e.textContent.trim()).catch(() => '');
    await p.keyboard.press('Enter');
    await h.sleep(800);
    return first;
  };

  // 1. Go to Symbol: a method opens in the Method Editor
  const first = await goToSymbol('helper');
  expect(/Method\s*helper\(\)/.test(first) && (await code()).startsWith('RETURN;'), `Ctrl+T "helper": ${first} → the Method Editor on helper()`);

  // 2. The outline of doState(): its blocks and calls, a click goes there
  await goToSymbol('dostate');
  await p.waitForSelector('#method-outline-btn', { timeout: 3000 }).catch(() => {});
  if (!(await p.$('#method-outline'))) await p.click('#method-outline-btn').catch(() => {});
  await h.sleep(400);
  const items = await p.$$eval('#method-outline .method-outline-item', (r) => r.map((x) => `${x.getAttribute('data-kind')}:${x.getAttribute('data-line')}:${x.textContent.trim()}`));
  expect(items.some((i) => /S_RUN/.test(i)) && items.some((i) => /helper/.test(i)), `the outline: ${items.join(' | ')}`);
  const run = await p.$$eval('#method-outline .method-outline-item', (r) => { const x = r.find((e) => /S_RUN/.test(e.textContent)); x?.click(); return x?.getAttribute('data-line'); });
  await h.sleep(400);
  const caretLine = await p.$eval(`#${ID}`, (e) => e.value.slice(0, e.selectionStart).split('\n').length);
  expect(String(caretLine) === run, `a click on S_RUN: the caret on its line (${caretLine} / ${run})`);

  // 3. The Problems tab's fixes
  await p.evaluate(() => document.getElementById('dock-tab-problems')?.click());
  await h.sleep(700);
  const clickFix = (text) => p.evaluate((text) => {
    const row = [...document.querySelectorAll('#problems-panel *')].filter((x) => x.textContent.includes(text) && x.querySelector('.problems-fix')).sort((a, b) => a.textContent.length - b.textContent.length)[0];
    const b = row?.querySelector('.problems-fix');
    b?.click();
    return b?.textContent ?? '';
  }, text);
  expect(/Insert call/.test(await clickFix('fbWait : TON is read but never called')), 'fbWait never called: Insert call');
  await p.waitForSelector('#text-prompt-submit', { timeout: 3000 }).catch(() => {});
  await p.click('#text-prompt-submit').catch(() => {});
  await h.sleep(1200);
  await goToSymbol('dostate');
  expect(/\t\tfbWait\(IN := FALSE, PT := T#0S\);\n\t\tIF fbWait\.Q THEN/.test(await code()), 'the call put in above its first use');
  await p.evaluate(() => document.getElementById('dock-tab-problems')?.click());
  await h.sleep(700);
  expect(/Remove the lines/.test(await clickFix('comes right after a RETURN')), 'after a RETURN: Remove the lines');
  await p.waitForSelector('#text-prompt-submit', { timeout: 3000 }).catch(() => {});
  await p.click('#text-prompt-submit').catch(() => {});
  await h.sleep(1200);
  await goToSymbol('helper');
  const helper = await code();
  expect(helper.trim() === 'RETURN;', `helper(): the lines that never ran removed (${JSON.stringify(helper)})`);

  // 4. No ELSE: Add ELSE; spare() nobody calls: Remove method
  await p.evaluate(() => document.getElementById('dock-tab-problems')?.click());
  await h.sleep(700);
  expect(/Add ELSE/.test(await clickFix('has no ELSE branch')), 'no ELSE: Add ELSE');
  await p.waitForSelector('#text-prompt-submit', { timeout: 3000 }).catch(() => {});
  await p.click('#text-prompt-submit').catch(() => {});
  await h.sleep(1200);
  await goToSymbol('dostate');
  expect(/\tELSE\n\t\t\/\/ a value of machineState not listed above\n\t\t;\nEND_CASE/.test(await code()), 'an ELSE branch before END_CASE, at the labels\' indentation');
  await p.evaluate(() => document.getElementById('dock-tab-problems')?.click());
  await h.sleep(700);
  expect(/Remove method/.test(await clickFix('spare() is PRIVATE and nothing in the POU calls it')), 'spare(): Remove method');
  await p.waitForSelector('#text-prompt-submit', { timeout: 3000 }).catch(() => {});
  await p.click('#text-prompt-submit').catch(() => {});
  await h.sleep(1200);
  const syms = await (async () => {
    await p.evaluate(() => document.activeElement?.blur());
    await p.keyboard.down('Control'); await p.keyboard.press('KeyT'); await p.keyboard.up('Control');
    await p.waitForSelector('#symbol-search-input', { timeout: 3000 }).catch(() => {});
    await p.keyboard.type('spare', { delay: 5 });
    await h.sleep(200);
    const r = await p.$$eval('#symbol-search .command-palette-item', (x) => x.map((e) => e.textContent.trim()));
    await p.keyboard.press('Escape');
    return r;
  })();
  expect(!syms.some((s) => /spare\(\)/.test(s)), `spare() removed (Go to Symbol: ${syms.join(', ') || 'nothing'})`);

  // 5. Extract Property: fbWait.Q selected in "IF fbWait.Q THEN" (its type guessed: BOOL)
  await goToSymbol('dostate');
  await p.evaluate((id) => {
    const ta = document.getElementById(id);
    const at = ta.value.indexOf('fbWait.Q THEN');
    ta.focus();
    ta.setSelectionRange(at, at + 'fbWait.Q'.length);
    ta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400, button: 2 }));
  }, ID);
  await h.sleep(400);
  const propItem = await p.$eval('#editor-menu-extract-property', (e) => e.textContent.trim()).catch(() => '');
  await p.click('#editor-menu-extract-property').catch(() => {});
  await p.waitForSelector('#text-prompt-input', { timeout: 3000 }).catch(() => {});
  const initialProp = await p.$eval('#text-prompt-input', (e) => e.value).catch(() => '');
  await p.click('#text-prompt-submit').catch(() => {});
  await h.sleep(1200);
  await goToSymbol('dostate');
  expect(/Extract Property… \(fbWait\.Q\)/.test(propItem) && initialProp === 'bNewProperty : BOOL' && /IF bNewProperty THEN/.test(await code()), `${propItem}: "${initialProp}", the line: IF bNewProperty THEN`);

  // 6. The header: Save All shows the editors with edits not in the POU yet; Save puts the Method Editor's in and saves
  await goToSymbol('helper');
  await p.evaluate((id) => { const ta = document.getElementById(id); ta.focus(); ta.setSelectionRange(0, 0); }, ID);
  await p.keyboard.type('// saved from the header\n', { delay: 3 });
  await h.sleep(300);
  const count = await p.$eval('#header-save-all-count', (e) => e.textContent).catch(() => '');
  const allTitle = await p.$eval('#header-save-all-btn', (e) => e.title).catch(() => '');
  const before = sent.filter((m) => m.type === 'save').length;
  await p.click('#header-save-btn');
  await h.sleep(800);
  const save = sent.filter((m) => m.type === 'save')[before];
  expect(count === '1' && /helper\(\)/.test(allTitle) && !!save && save.files.some((x) => /saved from the header/.test(x.content)), `the header: Save All (${count}: ${allTitle.slice(0, 60)}); Save: the Method Editor's edit in the POU, the POU written (${save ? save.files.map((x) => x.path.split(/[\\\\/]/).pop()).join(', ') : 'no save'})`);
  expect(!(await p.$('#header-save-all-count')), 'nothing left to put in');
  expect(!!save && save.files.some((x) => /<Property Name="bNewProperty"[\s\S]*PROPERTY PRIVATE bNewProperty : BOOL[\s\S]*bNewProperty := fbWait\.Q;/.test(x.content)), 'the property written with the POU (its Get: bNewProperty := fbWait.Q;)');

  // 7. Go to Symbol lists the property: its Get opens in the Method Editor, edited and saved like a method
  const propFirst = await goToSymbol('bnewproperty');
  const getCode = await code();
  expect(/Property\s*bNewProperty\.Get/.test(propFirst) && getCode.trim() === 'bNewProperty := fbWait.Q;', `Ctrl+T "bnewproperty": ${propFirst} → the Method Editor on its Get (${JSON.stringify(getCode.trim())})`);
  await p.evaluate((id) => { const ta = document.getElementById(id); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, ID);
  await p.keyboard.type(' // its value', { delay: 3 });
  await p.keyboard.down('Control'); await p.keyboard.press('s'); await p.keyboard.up('Control');
  await h.sleep(500);
  // (XAE: the editor's Ctrl+S puts it into the POU; Save writes the project)
  await p.click('#header-save-btn').catch(() => {});
  await h.sleep(900);
  const saved2 = sent.filter((m) => m.type === 'save').pop();
  expect(!!saved2 && saved2.files.some((x) => /<Get Name="Get"[\s\S]*bNewProperty := fbWait\.Q; \/\/ its value/.test(x.content)), 'its Get changed and saved (in the property, not as a method)');

  // 8. A timer without PT: Add PT; S_RUN without a description: Add description
  await p.evaluate(() => document.getElementById('dock-tab-problems')?.click());
  await h.sleep(700);
  expect(/Add PT/.test(await clickFix('fbNoTime : TON is called without PT')), 'fbNoTime without PT: Add PT');
  await p.waitForSelector('#text-prompt-submit', { timeout: 3000 }).catch(() => {});
  await p.click('#text-prompt-submit').catch(() => {});
  await h.sleep(1000);
  await goToSymbol('timers');
  expect((await code()).trim() === 'fbNoTime(PT := T#1S, IN := cmd_bStart);', `its call given PT := T#1S (${JSON.stringify((await code()).trim())})`);
  await p.evaluate(() => document.getElementById('dock-tab-problems')?.click());
  await h.sleep(700);
  expect(/Add description/.test(await clickFix('S_RUN has no line in getStateDescription()')), 'S_RUN without description: Add description');
  await p.waitForSelector('#text-prompt-submit', { timeout: 3000 }).catch(() => {});
  await p.click('#text-prompt-submit').catch(() => {});
  await h.sleep(1000);
  await goToSymbol('getstatedescription');
  expect(/\tE_S\.S_IDLE: getStateDescription := 'Idle';\n\tE_S\.S_RUN: getStateDescription := 'Run';\nEND_CASE/.test(await code()), `a line for S_RUN, like the others (${JSON.stringify((await code()).split('\n').slice(1, 3).join(' | '))})`);

  // 9. Shift+F6: rename in place (the field at the name, its uses highlighted while it is open)
  await goToSymbol('timers');
  await p.evaluate((id) => { const ta = document.getElementById(id); const at = ta.value.indexOf('fbNoTime'); ta.focus(); ta.setSelectionRange(at + 2, at + 2); }, ID);
  await p.keyboard.down('Shift'); await p.keyboard.press('F6'); await p.keyboard.up('Shift');
  await p.waitForSelector('#text-prompt-input', { timeout: 3000 }).catch(() => {});
  const inline = await p.evaluate((id) => {
    const ta = document.getElementById(id);
    const box = document.querySelector('#text-prompt-dialog')?.getBoundingClientRect();
    const r = ta.getBoundingClientRect();
    const marks = [...(ta.parentElement?.querySelectorAll('mark') ?? [])].filter((m) => /^fbnotime$/i.test(m.textContent));
    return { value: document.getElementById('text-prompt-input')?.value, inside: !!box && box.top >= r.top - 40 && box.top <= r.bottom, marks: marks.length };
  }, ID);
  expect(inline.value === 'fbNoTime' && inline.inside && inline.marks === 1, `Shift+F6 on fbNoTime: the field in the editor ("${inline.value}"), ${inline.marks} use highlighted`);
  await p.click('#text-prompt-input', { clickCount: 3 });
  await p.keyboard.type('fbDelay', { delay: 5 });
  await p.keyboard.press('Enter');
  await h.sleep(1000);
  const renamed = await code();
  const marksAfter = await p.evaluate((id) => [...(document.getElementById(id)?.parentElement?.querySelectorAll('mark') ?? [])].length, ID);
  expect(renamed.trim() === 'fbDelay(PT := T#1S, IN := cmd_bStart);' && marksAfter === 0, `renamed in place: ${JSON.stringify(renamed.trim())}, the highlights gone (${marksAfter})`);

  // 10. Build (XAE edition): XAE's own build of its solution, its Error List here (a click opens it), no write
  await p.click('#header-save-btn').catch(() => {});
  await h.sleep(600);
  await p.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await h.sleep(400);
  await p.waitForSelector('#live-build-btn', { timeout: 5000 }).catch(() => {});
  await p.click('#live-build-btn').catch(() => {});
  await p.waitForSelector('#plc-build-status[data-phase="done"]', { timeout: 5000 }).catch(() => {});
  const xb = await p.evaluate(() => ({ status: document.getElementById('plc-build-status')?.textContent.trim() ?? '', errs: [...document.querySelectorAll('#plc-build-errors .plc-build-item')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()), write: !!document.getElementById('plc-build-online') }));
  xb.asked = sent.some((m) => m.type === 'buildProject');
  expect(xb.asked && /1 error, 1 warning/.test(xb.status) && xb.errs.length === 1 && /SM_X\.timers\(\) line 1/.test(xb.errs[0]) && !xb.write, `Build in XAE: "${xb.status}" ${xb.errs.join(' | ')} (no write: ${!xb.write})`);
  await p.click('#plc-build-errors .plc-build-item').catch(() => {});
  await h.sleep(900);
  const onTimers = await p.evaluate(() => /fbDelay\(PT := T#1S/.test(document.getElementById('method-implementation-editor')?.value ?? ''));
  expect(onTimers, 'its error opened: the Method Editor on timers()');

  // 11. The word at the caret: its uses marked (machineState, each of its uses in doState()); a keyword: none
  await goToSymbol('doState');
  const occurrences = async (word) => {
    await p.evaluate((id, w) => { const ta = document.getElementById(id); const at = ta.value.indexOf(w); ta.focus(); ta.setSelectionRange(at + 2, at + 2); ta.dispatchEvent(new Event('select')); }, ID, word);
    await h.sleep(300);
    return p.evaluate((id) => {
      const ta = document.getElementById(id);
      const marks = [...(ta?.parentElement?.querySelectorAll('mark.word-occurrence') ?? [])].map((m) => m.textContent);
      return { marks, uses: ((ta?.value ?? '').match(/\bmachineState\b/gi) ?? []).length };
    }, ID);
  };
  const onState = await occurrences('machineState := E_S.S_RUN');
  // (readable: the word in its own colour, not a <mark>'s black; a frame, hardly a fill)
  const look = await p.evaluate((id) => {
    const m = document.getElementById(id)?.parentElement?.querySelector('mark.word-occurrence');
    if (!m) return null;
    const cs = getComputedStyle(m);
    const alpha = +(cs.backgroundColor.match(/rgba?\([^)]*,\s*([\d.]+)\)/)?.[1] ?? (cs.backgroundColor === 'transparent' ? 0 : 1));
    return { color: cs.color, parent: getComputedStyle(m.parentElement).color, alpha, outline: cs.outlineStyle };
  }, ID);
  expect(!!look && look.color === look.parent && look.color !== 'rgb(0, 0, 0)' && look.alpha <= 0.1 && look.outline === 'solid', `the uses marked readably: ${JSON.stringify(look)}`);
  const onKeyword = await occurrences('THEN');
  expect(onState.uses >= 3 && onState.marks.length === onState.uses && onState.marks.every((t) => /^machineState$/i.test(t)) && onKeyword.marks.length === 0, `the caret in machineState: ${onState.marks.length} of its ${onState.uses} uses marked; in THEN: ${onKeyword.marks.length}`);


  // 12. Save All between XAE tabs, relayed by the extension: another tab's request answered once (it may come on
  // the browser channel too), and this tab's Save All sent to the extension as well
  const before12 = sent.length;
  await toApp({ type: 'saveAll', id: 'relay-1', relayed: true });
  await toApp({ type: 'saveAll', id: 'relay-1', relayed: true });
  await h.sleep(500);
  const answers = sent.slice(before12).filter((m) => m.type === 'saveAllDoneRelay');
  expect(answers.length === 1 && answers[0].id === 'relay-1' && answers[0].name === 'SM_X.TcPOU' && typeof answers[0].count === 'number', `a relayed Save All: answered once (${JSON.stringify(answers)})`);
  const before12b = sent.length;
  await p.click('#header-save-all-btn').catch(() => {});
  await h.sleep(500);
  const asked = sent.slice(before12b).find((m) => m.type === 'saveAllRelay');
  expect(!!asked && /^\d+-\w+$/.test(asked.id), `this tab's Save All: to the other tabs through the extension too (${JSON.stringify(asked)})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
