// More editor help (XAE stand-in bridge, a small POU and another POU of the project that uses it):
// hover info on a name, the Input Assistant (F2), a bookmark in the POU body and the list of all bookmarks, a
// condition edited right on its label, a state's actions as its tooltip, and an input renamed where the other POU
// uses it (instance.x, a named parameter), that POU written at once
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const MENU = '[aria-label="Editor Context Menu"]';
const cdata = (s) => `<![CDATA[${s}]]>`;

const DO_STATE = [
  'CASE machineState OF',
  '\tS_IDLE:',
  '\t\tnCycles := nCycles + 1;',
  '\t\tIF cmd_bStart THEN',
  '\t\t\tmachineState := E_S.S_RUN;',
  '\t\tEND_IF',
  '\tS_RUN:',
  '\t\tIF cmd_bStop THEN',
  '\t\t\tmachineState := E_S.S_IDLE;',
  '\t\tEND_IF',
  'END_CASE',
].join('\n');
const DECL = ['FUNCTION_BLOCK SM_X', 'VAR_INPUT', '\tcmd_bStart : BOOL; // go', '\tcmd_bStop : BOOL;', 'END_VAR', 'VAR', '\tmachineState : E_S;', '\tnCycles : INT; // how often', 'END_VAR'].join('\n');
const method = (name, decl, code) => `    <Method Name="${name}" Id="{${name}}">\n      <Declaration>${cdata(decl)}</Declaration>\n      <Implementation>\n        <ST>${cdata(code)}</ST>\n      </Implementation>\n    </Method>`;
const POU = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <POU Name="SM_X" Id="{1}" SpecialFunc="None">\n    <Declaration>${cdata(DECL)}</Declaration>\n    <Implementation>\n      <ST>${cdata('doState();\nnCycles := 0;')}</ST>\n    </Implementation>\n${method('doState', 'METHOD doState : BOOL', DO_STATE)}\n  </POU>\n</TcPlcObject>`;
const DUT = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <DUT Name="E_S" Id="{2}">\n    <Declaration>${cdata("{attribute 'qualified_only'}\nTYPE E_S :\n(\n\tS_IDLE := 0,\n\tS_RUN\n);\nEND_TYPE")}</Declaration>\n  </DUT>\n</TcPlcObject>`;
// Another POU of the project: an instance of SM_X, its input set and passed by name
const OTHER = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <POU Name="PRG_Line" Id="{9}" SpecialFunc="None">\n    <Declaration>${cdata('PROGRAM PRG_Line\nVAR\n\tsmX : SM_X;\n\tcmd_bStart : BOOL; // its own, not SM_X\'s\nEND_VAR')}</Declaration>\n    <Implementation>\n      <ST>${cdata('smX.cmd_bStart := cmd_bStart;\nsmX(cmd_bStart := TRUE, cmd_bStop := FALSE);')}</ST>\n    </Implementation>\n  </POU>\n</TcPlcObject>`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const sent = [];
  const toApp = (m) => p.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') await toApp({ type: 'loadPou', source: { name: 'SM_X.TcPOU', path: 'C:\\proj\\SM_X.TcPOU', content: POU, dutCandidates: [{ name: 'E_S.TcDUT', relativePath: 'E_S.TcDUT', path: 'C:\\proj\\E_S.TcDUT', content: DUT }] } });
    else if (m.type === 'projectSymbols') await toApp({ type: 'projectSymbols', project: 'P', files: [{ name: 'PRG_Line.TcPOU', path: 'C:\\proj\\PRG_Line.TcPOU', content: OTHER }] });
    else if (m.type === 'projectUses') await toApp({ type: 'projectUses', requestId: m.requestId, files: [{ name: 'PRG_Line.TcPOU', path: 'C:\\proj\\PRG_Line.TcPOU', content: OTHER }] });
    else if (m.type === 'saveOther') await toApp({ type: 'saveOtherResult', requestId: m.requestId, ok: true, message: 'Wrote 1 other POU(s): PRG_Line.TcPOU' });
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
  // The screen spot of a text in an editor (monospace, 8 px padding, tabs of 4)
  const spotOf = (id, text) => p.evaluate((id, text) => {
    const ta = document.getElementById(id);
    const lines = ta.value.split('\n');
    const li = lines.findIndex((l) => l.includes(text));
    const line = lines[li];
    let v = 0;
    for (let i = 0; i < line.indexOf(text); i++) v = line[i] === '\t' ? v + 4 - (v % 4) : v + 1;
    const cs = getComputedStyle(ta);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
    const cw = ctx.measureText('MMMMMMMMMM').width / 10;
    const lh = parseFloat(cs.lineHeight);
    const r = ta.getBoundingClientRect();
    return { x: r.left + 8 + (v + 1.5) * cw - ta.scrollLeft, y: r.top + 8 + li * lh + lh / 2 - ta.scrollTop };
  }, id, text);

  // 7. Hover: what a name is
  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-implementation-editor');
  await h.sleep(600);
  let spot = await spotOf('method-implementation-editor', 'nCycles :=');
  await p.mouse.move(spot.x, spot.y);
  await h.sleep(200);
  const tip = await p.$eval('#method-implementation-editor', (e) => e.title);
  expect(/^nCycles : INT {2}\(VAR\)\nhow often$/.test(tip), `hover on nCycles: ${JSON.stringify(tip)}`);

  // 10. The Input Assistant (F2): by category, a search, Enter inserts
  await caretAt('method-implementation-editor', '\tS_RUN:', 0);
  await p.keyboard.press('F2');
  await p.waitForSelector('#input-assistant', { timeout: 3000 }).catch(() => {});
  const cats = await p.$$eval('#input-assistant .input-assistant-category', (b) => b.map((x) => x.getAttribute('data-category')));
  expect(['All', 'Variables', 'States', 'Enum values', 'Types', 'Standard'].every((c) => cats.includes(c)), `categories: ${cats.join(', ')}`);
  await p.click('#input-assistant .input-assistant-category[data-category="Enum values"]');
  await h.sleep(150);
  const enums = await p.$$eval('#input-assistant .input-assistant-item', (r) => r.map((x) => x.getAttribute('data-name')));
  expect(enums.join() === 'E_S.S_IDLE,E_S.S_RUN', `Enum values: ${enums.join(', ')}`);
  await p.click('#input-assistant .input-assistant-category[data-category="All"]');
  await p.type('#input-assistant-search', 'S_RUN');
  await h.sleep(150);
  const found = await p.$$eval('#input-assistant .input-assistant-item', (r) => r.map((x) => x.getAttribute('data-name')));
  expect(found.join() === 'S_RUN,E_S.S_RUN', `search "S_RUN": ${found.join(', ')} (the state, the enum value)`);
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  await h.sleep(300);
  expect(!(await p.$('#input-assistant')) && (await p.$eval('#method-implementation-editor', (e) => e.value)).includes('E_S.S_RUN\tS_RUN:'), 'Enter: E_S.S_RUN inserted at the caret');
  await p.keyboard.down('Control'); await p.keyboard.press('z'); await p.keyboard.up('Control');
  await h.sleep(200);

  // 11. A bookmark in the POU body; the list of all
  await p.click('#dock-tab-pou');
  await p.waitForSelector('#pou-implementation-editor');
  await h.sleep(500);
  expect(await rightClickAt('pou-implementation-editor', 'nCycles := 0;'), 'the POU Editor\'s menu on the body');
  await p.click('#editor-menu-bookmarks');
  await h.sleep(150);
  await p.click('#editor-menu-bookmark-toggle');
  await h.sleep(400);
  const bodyMarks = await p.$$eval('#pou-implementation-editor-gutter .st-bookmark', (m) => m.map((x) => x.getAttribute('data-bookmark-line')));
  expect(bodyMarks.join() === '2', `the body's gutter: ${bodyMarks.join(', ')}`);
  await rightClickAt('pou-implementation-editor', 'doState');
  await p.click('#editor-menu-bookmarks');
  await h.sleep(150);
  await p.click('#editor-menu-bookmark-list');
  await p.waitForSelector('#bookmarks-dialog', { timeout: 3000 }).catch(() => {});
  const list = await p.$eval('#bookmarks-dialog', (e) => e.innerText).catch(() => '');
  expect(/The POU body/i.test(list) && /nCycles := 0;/.test(list), 'the list: the POU body\'s bookmark');
  await p.keyboard.press('Escape');

  // 13. A state's actions as its tooltip
  await p.click('#dock-tab-diagram');
  await h.sleep(600);
  const np = await p.evaluate(() => { const r = document.querySelector('#mermaid-diagram-svg-container g.node[data-state-id="S_IDLE"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.move(np.x, np.y);
  await h.sleep(250);
  const title = await p.$eval('#state-actions-hover', (e) => e.innerText).catch(() => '');
  expect(/^S_IDLE\nnCycles := nCycles \+ 1;\nIF cmd_bStart THEN\n\s+machineState := E_S\.S_RUN;\nEND_IF$/.test(title.trim()) && !(await p.$('#mermaid-diagram-svg-container g.node title.state-actions-title')), `S_IDLE's code on hover, whole and as written, at once (no browser tooltip): ${JSON.stringify(title)}`);
  await p.mouse.move(5, 5);
  await h.sleep(150);

  // 12. The condition edited right on its label
  const key = 'S_IDLE->S_RUN';
  const lp = await p.evaluate((key) => {
    const l = [...document.querySelectorAll('#mermaid-diagram-svg-container g.edgeLabel')].find((x) => x.getAttribute('data-linked-path-id') === key || x.getAttribute('data-edge-id') === key);
    const r = l.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, key);
  await p.mouse.click(lp.x, lp.y);
  await h.sleep(400);
  await p.keyboard.press('F2');
  await p.waitForSelector('#text-prompt-dialog[data-inline="true"]', { timeout: 3000 }).catch(() => {});
  const box = await p.$eval('#text-prompt-input', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }).catch(() => null);
  expect(!!box && Math.abs(box.y - lp.y) < 25 && Math.abs(box.x - lp.x) < 60 && (await p.$eval('#text-prompt-input', (e) => e.value)) === 'cmd_bStart', `F2: the field over the label (${box && Math.round(box.x)},${box && Math.round(box.y)} vs ${Math.round(lp.x)},${Math.round(lp.y)})`);
  await p.evaluate(() => { const el = document.getElementById('text-prompt-input'); el.focus(); el.select(); });
  await p.keyboard.type('cmd_bStart AND nCycles > 3', { delay: 10 });
  await p.keyboard.press('Enter');
  await h.sleep(1200);
  const labelText = await p.evaluate(() => [...document.querySelectorAll('#mermaid-diagram-svg-container g.edgeLabel')].map((l) => l.textContent).join(' | '));
  expect(/cmd_bStart AND nCycles > 3/.test(labelText), 'the label shows the new condition');

  // 14. Rename an input: in this POU and where PRG_Line uses it
  await p.click('#dock-tab-pou');
  await h.sleep(500);
  expect(await rightClickAt('pou-declaration-editor', 'cmd_bStart'), 'the menu on cmd_bStart');
  await p.click('#editor-menu-rename');
  await p.waitForSelector('#text-prompt-input', { timeout: 3000 });
  await p.evaluate(() => { const el = document.getElementById('text-prompt-input'); el.focus(); el.select(); });
  await p.keyboard.type('cmd_bGo', { delay: 10 });
  await p.waitForFunction(() => /PRG_Line\.TcPOU \(written at once\)/.test(document.getElementById('text-prompt-preview')?.innerText || ''), { timeout: 5000 }).catch(() => {});
  const preview = await p.$eval('#text-prompt-preview', (e) => e.innerText).catch(() => '');
  expect(/PRG_Line\.TcPOU \(written at once\)/.test(preview) && /smX\.cmd_bGo := cmd_bStart;/.test(preview) && /smX\(cmd_bGo := TRUE, cmd_bStop := FALSE\);/.test(preview), `the preview lists PRG_Line's lines:\n${preview.split('\n').filter((l) => /PRG_Line|smX/.test(l)).join('\n')}`);
  expect(sent.some((m) => m.type === 'projectUses' && m.name === 'cmd_bStart'), 'asked XAE for the uses');
  await p.keyboard.press('Enter');
  await h.sleep(1200);
  const save = sent.find((m) => m.type === 'saveOther');
  const written = save?.files?.[0]?.content ?? '';
  expect(!!save && save.files.length === 1 && /PRG_Line\.TcPOU$/.test(save.files[0].path) && save.files[0].baseline === OTHER && written.includes('smX.cmd_bGo := cmd_bStart;') && written.includes('smX(cmd_bGo := TRUE, cmd_bStop := FALSE);') && written.includes("cmd_bStart : BOOL; // its own"), 'PRG_Line written: its uses of SM_X\'s input renamed, its own cmd_bStart kept');
  const decl = await p.$eval('#pou-declaration-editor', (e) => e.value);
  expect(/cmd_bGo : BOOL; \/\/ go/.test(decl) && !/cmd_bStart/.test(decl), 'this POU: renamed (saved with Save)');
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
