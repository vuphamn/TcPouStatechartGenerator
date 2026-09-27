// The code editors (XAE stand-in bridge with the PLC project's types): Go to Definition on a member of another POU's
// instance (smOutfeedStopAxis.config_fHomePosition) opens that POU at the member's declaration, or TwinCAT's editor
// at its line; Rename a variable of the POU with a preview of the changes; Declare a name the code uses (Shift+F2,
// in the method; from the menu, in the POU); the Problems tab's variable checks
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const MENU = '[aria-label="Editor Context Menu"]';
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
  // SM_KAxis: a state machine too (the sample renamed), with the member
  const axis = sample.pou.replace(/SM_TableManager/g, 'SM_KAxis').replace(/VAR_INPUT\r?\n/, 'VAR_INPUT\n\tconfig_fHomePosition : LREAL; // home\n');
  const files = [{ name: 'SM_KAxis.TcPOU', path: 'C:\\proj\\SM_KAxis.TcPOU', content: axis }];
  const load = (name, content) => toApp({ type: 'loadPou', source: { name: `${name}.TcPOU`, path: `C:\\proj\\${name}.TcPOU`, content, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] } });
  await p.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') await load('SM_TableManager', sample.pou);
    else if (m.type === 'openPou' && m.typeName === 'SM_KAxis') await load('SM_KAxis', axis);
    else if (m.type === 'openPou' && m.path) await load('SM_TableManager', sample.pou);
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
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(1000);

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
  const items = () => p.$$eval(`${MENU} button`, (b) => b.map((x) => (x.id || '') + ':' + x.textContent.replace(/\s+/g, ' ').trim()));
  const waitSent = async (pred) => { for (let i = 0; i < 30 && !sent.some(pred); i++) await h.sleep(100); return sent.find(pred); };

  // 1. Method Editor, F12 on a member of another POU's instance: that POU, at the member
  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-implementation-editor');
  await h.sleep(600);
  expect(await rightClickAt('method-implementation-editor', 'config_fHomePosition'), 'the menu on smOutfeedStopAxis.config_fHomePosition');
  let list = await items();
  expect(list.some((x) => /Go to Definition.*Open SM_KAxis\.config_fHomePosition in StateScope/.test(x)) && list.some((x) => /^editor-menu-open-type-xae:Open SM_KAxis\.config_fHomePosition in the TwinCAT editor/.test(x)), `the member offered: ${list.filter((x) => /Open|Definition/.test(x)).join(' | ')}`);
  // In TwinCAT's editor: at its declaration line
  await p.click('#editor-menu-open-type-xae');
  const xae = await waitSent((m) => m.type === 'openInXae');
  expect(xae?.typeName === 'SM_KAxis' && xae.line > 1 && /config_fHomePosition : LREAL;/.test(xae.text || '') && !xae.method, `openInXae: ${JSON.stringify(xae)}`);
  // In StateScope: F12
  await caretAt('method-implementation-editor', 'config_fHomePosition');
  await p.keyboard.press('F12');
  expect(!!(await waitSent((m) => m.type === 'openPou' && m.typeName === 'SM_KAxis')), 'F12: openPou SM_KAxis');
  await p.waitForFunction(() => /SM_KAxis/.test(document.getElementById('pou-declaration-editor')?.value || ''), { timeout: 8000 }).catch(() => {});
  await h.sleep(800);
  const shownAt = await p.evaluate(() => document.body.innerText.match(/Found definition of 'config_fHomePosition' at line \d+/)?.[0] ?? '');
  const tab = await p.evaluate(() => document.querySelector('[id="dock-tab-pou"]')?.getAttribute('aria-selected') ?? document.querySelector('#dock-tab-pou')?.className ?? '');
  expect(!!shownAt && !!(await p.$('#pou-declaration-editor')), `SM_KAxis in the POU Editor, at the member: "${shownAt}" (${String(tab).slice(0, 30)})`);
  await p.click('#status-back');
  await p.waitForFunction(() => /FUNCTION_BLOCK SM_TableManager/.test(document.getElementById('pou-declaration-editor')?.value || ''), { timeout: 8000 }).catch(() => {});
  expect(/FUNCTION_BLOCK SM_TableManager/.test(await p.$eval('#pou-declaration-editor', (e) => e.value)), 'Back: SM_TableManager again');

  // 2. Rename (POU Editor): a preview, then everywhere
  await h.sleep(500);
  expect(await rightClickAt('pou-declaration-editor', 'cmd_bUnclamp'), 'the POU Editor\'s menu on cmd_bUnclamp');
  list = await items();
  expect(list.some((x) => /^editor-menu-rename:Rename cmd_bUnclamp…/.test(x)), 'Rename cmd_bUnclamp…');
  await p.click('#editor-menu-rename');
  await p.waitForSelector('#text-prompt-input', { timeout: 4000 });
  await p.evaluate(() => { const el = document.getElementById('text-prompt-input'); el.focus(); el.select(); });
  await p.keyboard.type('cmd_bRelease', { delay: 10 });
  await h.sleep(300);
  const preview = await p.$eval('#text-prompt-preview', (e) => e.innerText).catch(() => '');
  expect(/^\d+ lines? change:/.test(preview) && /declaration \d+:/.test(preview) && /doState\(\) \d+:/.test(preview) && /→\s+.*cmd_bRelease/.test(preview) && /(Looking for uses in the other POUs|No other POU of the project uses it)/.test(preview), `the preview:\n${preview.split('\n').slice(0, 5).join('\n')}`);
  // A taken name
  await p.evaluate(() => { const el = document.getElementById('text-prompt-input'); el.focus(); el.select(); });
  await p.keyboard.type('cmd_bHome', { delay: 10 });
  await h.sleep(200);
  expect(/already declared/.test(await p.$eval('#text-prompt-error', (e) => e.textContent).catch(() => '')), 'a taken name: refused');
  await p.evaluate(() => { const el = document.getElementById('text-prompt-input'); el.focus(); el.select(); });
  await p.keyboard.type('cmd_bRelease', { delay: 10 });
  await p.keyboard.press('Enter');
  await h.sleep(1200);
  const decl = await p.$eval('#pou-declaration-editor', (e) => e.value);
  await p.click('#dock-tab-method');
  await h.sleep(600);
  let code = await p.$eval('#method-implementation-editor', (e) => e.value);
  expect(/\bcmd_bRelease\b/.test(decl) && !/\bcmd_bUnclamp\b/.test(decl) && /\bcmd_bRelease\b/.test(code) && !/\bcmd_bUnclamp\b/.test(code), 'renamed in the declaration and in doState()');

  // 3. Declare (Method Editor): Shift+F2 in the method; the menu into the POU
  await caretAt('method-implementation-editor', 'CASE', 0);
  await p.keyboard.type('bNewFlag := TRUE;\n', { delay: 5 });
  await h.sleep(300);
  await caretAt('method-implementation-editor', 'bNewFlag');
  await p.keyboard.down('Shift'); await p.keyboard.press('F2'); await p.keyboard.up('Shift');
  await p.waitForSelector('#declare-variable-dialog', { timeout: 4000 }).catch(() => {});
  const form = await p.evaluate(() => ({ name: document.getElementById('text-prompt-declare-name')?.value, type: document.getElementById('text-prompt-declare-type')?.value, scope: document.getElementById('text-prompt-declare-scope')?.value }));
  expect(form.name === 'bNewFlag' && form.type === 'BOOL' && form.scope === 'VAR', `Shift+F2: ${JSON.stringify(form)}`);
  await p.click('#text-prompt-declare-ok');
  await h.sleep(500);
  await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Method \(/.test(b.textContent.trim()))?.click());
  await h.sleep(300);
  const mdecl = await p.$eval('#method-declaration-editor', (e) => e.value);
  expect(/\bbNewFlag : BOOL;/.test(mdecl), 'in doState()\'s declaration (unsaved)');
  // Another name, into the POU from the menu
  await caretAt('method-implementation-editor', 'bNewFlag := TRUE;', 0);
  await p.keyboard.type('nNewCount := 0;\n', { delay: 5 });
  await h.sleep(300);
  expect(await rightClickAt('method-implementation-editor', 'nNewCount'), 'the menu on nNewCount');
  list = await items();
  expect(list.some((x) => /^editor-menu-declare:Declare nNewCount in doState\(\)…/.test(x)) && list.some((x) => /^editor-menu-declare-pou:Declare nNewCount in the POU…/.test(x)), `Declare offered: ${list.filter((x) => /declare/.test(x)).join(' | ')}`);
  await p.click('#editor-menu-declare-pou');
  await p.waitForSelector('#declare-variable-dialog', { timeout: 4000 });
  expect((await p.$eval('#text-prompt-declare-type', (e) => e.value)) === 'INT', 'nX: INT guessed');
  await p.select('#text-prompt-declare-scope', 'VAR');
  await p.click('#text-prompt-declare-ok');
  await h.sleep(1200);
  await p.click('#dock-tab-pou');
  await h.sleep(500);
  const pdecl = await p.$eval('#pou-declaration-editor', (e) => e.value);
  expect(/\bnNewCount : INT;/.test(pdecl), 'in the POU\'s declaration (written at once)');

  // 4. Problems: nNewCount is not used in the saved code (the method's use is not saved yet)
  await p.evaluate(() => document.getElementById('dock-tab-problems')?.click());
  await h.sleep(800);
  const problems = await p.$eval('#problems-panel', (e) => e.innerText).catch(() => '');
  expect(/Not used/.test(problems) && /nNewCount : INT \(VAR\) is not used/.test(problems), `Problems: ${problems.split('\n').filter((l) => /nNewCount|Not used/.test(l)).slice(0, 2).join(' | ')}`);
  await p.screenshot({ path: h.out('editor-refactor.png') });
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
