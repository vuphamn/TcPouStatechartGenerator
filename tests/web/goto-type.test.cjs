// Go to Definition on a type (XAE stand-in bridge): right-clicking a variable of another POU's type, or the type
// itself, in the POU Editor and the Method Editor offers "Open <Type> in MachineScope" (openPou, with Back) and "in the
// TwinCAT editor" (openInXae); Go to Definition (and F12) on the type opens it in MachineScope. Elementary types and
// the standard function blocks offer nothing; the web edition (no project to open from) neither
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const MENU = '[aria-label="Editor Context Menu"]';

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
    const s = mod.SAMPLES[0];
    return { pou: s.pouContent, dut: s.dutContent };
  });
  // The sample with members of other POUs' types
  const pou = sample.pou.replace(/VAR_INPUT\r?\n/, 'VAR_INPUT\n\tsmAxis : SM_KAxis;\n\taCylinders : ARRAY[1..3] OF REFERENCE TO SM_KCylinder;\n\ttonWait : TON;\n');
  const axis = sample.pou.replace(/SM_TableManager/g, 'SM_KAxis');
  const load = (name, content) => toApp({ type: 'loadPou', source: { name: `${name}.TcPOU`, path: `C:\\proj\\${name}.TcPOU`, content, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] } });
  await p.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') await load('SM_TableManager', pou);
    else if (m.type === 'openPou' && m.typeName === 'SM_KAxis') await load('SM_KAxis', axis);
    else if (m.type === 'openPou' && m.path) await load('SM_TableManager', pou);
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
  await h.sleep(800);

  // Right-click in an editor with the caret in a word (its nth occurrence)
  const rightClickAt = async (page, id, text, nth = 0) => {
    await page.evaluate((id, text, nth) => {
      const ta = document.getElementById(id);
      let at = -1;
      for (let i = 0; i <= nth; i++) at = ta.value.indexOf(text, at + 1);
      if (at < 0) throw new Error(`"${text}" not in ${id}`);
      ta.focus();
      ta.setSelectionRange(at + 1, at + 1);
    }, id, text, nth);
    for (let i = 0; i < 3; i++) {
      await h.sleep(500);
      await page.evaluate((id) => document.getElementById(id).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400, button: 2 })), id);
      await h.sleep(300);
      if (await page.$(MENU)) return true;
    }
    return false;
  };
  const items = (page) => page.$$eval(`${MENU} button`, (b) => b.map((x) => (x.id || '') + ':' + x.textContent.replace(/\s+/g, ' ').trim()));
  const closeMenu = async (page) => { await page.keyboard.press('Escape'); await h.sleep(200); };
  const waitSent = async (pred) => { for (let i = 0; i < 30 && !sent.some(pred); i++) await h.sleep(100); return sent.some(pred); };

  // POU Editor: the variable of type SM_KAxis
  await p.click('#dock-tab-pou');
  await p.waitForSelector('#pou-declaration-editor', { timeout: 10000 });
  await h.sleep(400);
  expect(await rightClickAt(p, 'pou-declaration-editor', 'smAxis'), 'POU Editor: the menu on smAxis');
  let list = await items(p);
  expect(list.some((x) => /^editor-menu-open-type-machinescope:Open SM_KAxis in MachineScope/.test(x)) && list.some((x) => /^editor-menu-open-type-xae:Open SM_KAxis in the TwinCAT editor/.test(x)), `smAxis : SM_KAxis offers its type: ${list.filter((x) => /open-type/.test(x)).join(' | ')}`);
  expect(list.some((x) => /Go to Definition.*Highlight in Top Panel/.test(x)), 'Go to Definition on the variable still goes to its declaration');
  await p.click('#editor-menu-open-type-xae');
  expect(await waitSent((m) => m.type === 'openInXae' && m.typeName === 'SM_KAxis'), 'Open in the TwinCAT editor: openInXae SM_KAxis sent');

  // ARRAY [..] OF REFERENCE TO T; TON (standard FB) and BOOL offer nothing
  await rightClickAt(p, 'pou-declaration-editor', 'aCylinders');
  list = await items(p);
  expect(list.some((x) => /Open SM_KCylinder in MachineScope/.test(x)), 'aCylinders : ARRAY[1..3] OF REFERENCE TO SM_KCylinder: SM_KCylinder');
  await closeMenu(p);
  await rightClickAt(p, 'pou-declaration-editor', 'tonWait');
  const tonItems = (await items(p)).filter((x) => /open-type/.test(x));
  await closeMenu(p);
  const boolVar = await p.$eval('#pou-declaration-editor', (e) => (e.value.match(/^\s*(\w+)\s*:\s*BOOL\b/m) || [])[1]);
  await rightClickAt(p, 'pou-declaration-editor', boolVar);
  const boolItems = (await items(p)).filter((x) => /open-type/.test(x));
  await closeMenu(p);
  expect(tonItems.length === 0 && boolItems.length === 0, `TON and ${boolVar} : BOOL: no type to open (${tonItems.length}, ${boolItems.length})`);

  // Go to Definition on the type itself (EXTENDS base, the type after ':'): opened here, in MachineScope, Back returns
  await rightClickAt(p, 'pou-declaration-editor', 'KvalStateMachineBase');
  list = await items(p);
  expect(list.some((x) => /Go to Definition.*Open KvalStateMachineBase in MachineScope/.test(x)), 'EXTENDS KvalStateMachineBase: Go to Definition opens it in MachineScope');
  await closeMenu(p);
  await rightClickAt(p, 'pou-declaration-editor', 'SM_KAxis');
  await p.evaluate(() => [...document.querySelectorAll('[aria-label="Editor Context Menu"] button')].find((b) => /Go to Definition/.test(b.textContent))?.click());
  expect(await waitSent((m) => m.type === 'openPou' && m.typeName === 'SM_KAxis'), 'Go to Definition on SM_KAxis: openPou SM_KAxis sent');
  await p.waitForFunction(() => /SM_KAxis/.test(document.getElementById('pou-declaration-editor')?.value || ''), { timeout: 8000 }).catch(() => {});
  await p.waitForSelector('#status-back', { timeout: 5000 }).catch(() => {});
  expect(/^FUNCTION_BLOCK SM_KAxis/.test((await p.$eval('#pou-declaration-editor', (e) => e.value)).trim()) && /SM_TableManager/.test(await p.$eval('#status-back', (e) => e.title).catch(() => '')), 'SM_KAxis loaded; Back to SM_TableManager');
  // Its own type is not offered
  await rightClickAt(p, 'pou-declaration-editor', 'SM_KAxis');
  const own = (await items(p)).filter((x) => /open-type/.test(x));
  await closeMenu(p);
  expect(own.length === 0, 'the loaded POU\'s own name: nothing to open');
  await p.click('#status-back');
  await p.waitForFunction(() => /smAxis : SM_KAxis/.test(document.getElementById('pou-declaration-editor')?.value || ''), { timeout: 8000 }).catch(() => {});
  expect(sent.some((m) => m.type === 'openPou' && /SM_TableManager\.TcPOU$/.test(m.path || '')), 'Back: openPou with the previous path');

  // Method Editor: the POU declaration tab, F12 on the type
  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-declaration-editor', { timeout: 10000 });
  await h.sleep(600);
  await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^POU \(/.test(b.textContent.trim()))?.click());
  await p.waitForFunction(() => /smAxis : SM_KAxis/.test(document.getElementById('method-declaration-editor')?.value || ''), { timeout: 5000 }).catch(() => {});
  expect(await rightClickAt(p, 'method-declaration-editor', 'smAxis'), 'Method Editor: the menu on smAxis');
  list = await items(p);
  expect(list.some((x) => /^editor-menu-open-type-machinescope:Open SM_KAxis/.test(x)) && list.some((x) => /^editor-menu-open-type-xae:/.test(x)), 'Method Editor: both ways offered');
  await closeMenu(p);
  const before = sent.filter((m) => m.type === 'openPou' && m.typeName === 'SM_KCylinder').length;
  await p.evaluate(() => {
    const ta = document.getElementById('method-declaration-editor');
    const at = ta.value.indexOf('SM_KCylinder');
    ta.focus();
    ta.setSelectionRange(at + 2, at + 2);
  });
  await p.keyboard.press('F12');
  expect(await waitSent((m) => m.type === 'openPou' && m.typeName === 'SM_KCylinder') && before === 0, 'F12 on SM_KCylinder: openPou SM_KCylinder sent');
  await p.screenshot({ path: h.out('goto-type.png') });
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);

  // The web edition: nothing to open from
  const w = await browser.newPage();
  await w.goto(h.APP_URL, { waitUntil: 'load' });
  await w.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await w.click('#dock-tab-pou');
  await w.waitForSelector('#pou-declaration-editor', { timeout: 10000 });
  await h.sleep(400);
  await rightClickAt(w, 'pou-declaration-editor', 'KvalStateMachineBase');
  const web = (await items(w)).filter((x) => /open-type/.test(x));
  expect(web.length === 0, 'web edition: no "Open ... in MachineScope"');
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
