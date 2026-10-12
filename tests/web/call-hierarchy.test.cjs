// Call Hierarchy (Shift+Alt+H, the editors' menu) and Go to Implementation (Ctrl+F12) in the app's code editors, the
// web edition with its project folder (Chrome / Edge's folder access, stood in for: PRG_Line calls smTable.doState(),
// MAIN calls PRG_Line(), two POUs extend SM_TableManager with their own doState): the method's callers, a caller
// opened to its own callers, the Calls tab; the overrides of doState listed; asked for the folder once. The Cross
// Reference List of cmd_bUnclamp (an input): its places here and PRG_Line's write, the Writes filter
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const MENU = '[aria-label="Editor Context Menu"]';
const cdata = (s) => `<![CDATA[${s}]]>`;
const pou = (name, decl, body, members = '') => `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <POU Name="${name}" Id="{9}" SpecialFunc="None">\n    <Declaration>${cdata(decl)}</Declaration>\n    <Implementation>\n      <ST>${cdata(body)}</ST>\n    </Implementation>${members}\n  </POU>\n</TcPlcObject>`;
const method = (name, impl) => `\n    <Method Name="${name}" Id="{8}">\n      <Declaration>${cdata(`METHOD ${name} : BOOL`)}</Declaration>\n      <Implementation>\n        <ST>${cdata(impl)}</ST>\n      </Implementation>\n    </Method>`;
const FILES = {
  'PRG_Line.TcPOU': pou('PRG_Line', 'PROGRAM PRG_Line\nVAR\n\tsmTable : SM_TableManager;\nEND_VAR', 'smTable();\n// smTable.doState() in a comment\nIF smTable.doState() THEN\n\t;\nEND_IF\nsmTable.cmd_bUnclamp := bButton;'),
  'MAIN.TcPOU': pou('MAIN', 'PROGRAM MAIN', 'PRG_Line();'),
  'SM_TableA.TcPOU': pou('SM_TableA', 'FUNCTION_BLOCK SM_TableA EXTENDS SM_TableManager', '', method('doState', 'doState := SUPER^.doState();')),
  'SM_TableB.TcPOU': pou('SM_TableB', 'FUNCTION_BLOCK SM_TableB EXTENDS SM_TableManager', '', method('doState', 'doState := TRUE;')),
};

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.evaluateOnNewDocument((files) => {
    window.__picked = 0;
    const file = (name, text) => ({ kind: 'file', name, getFile: async () => new File([text], name), queryPermission: async () => 'granted', requestPermission: async () => 'granted' });
    const dir = (name, entries) => ({ kind: 'directory', name, values: async function* () { yield* entries; }, getDirectoryHandle: async () => { throw new Error('none'); }, resolve: async () => null });
    const pouDir = dir('POUs', Object.entries(files).map(([n, t]) => file(n, t)));
    window.showDirectoryPicker = async () => {
      window.__picked++;
      return dir('Line', [pouDir]);
    };
  }, FILES);
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(1000);

  // The Method Editor on doState
  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-implementation-editor', { timeout: 10000 });
  await h.sleep(800);
  const header = await p.$eval('#method-declaration-editor', (t) => t.value.split('\n')[0]).catch(() => '');
  // (the menu at a word of an editor: a slow machine's re-render may close it, opened again)
  const menuAt = async (id, word, item) => {
    for (let i = 0; i < 4; i++) {
      await p.evaluate((id, word) => {
        const ta = document.getElementById(id);
        const at = word ? ta.value.indexOf(word) + 1 : ta.value.length;
        ta.focus();
        ta.setSelectionRange(at, at);
        ta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 700, clientY: 400, button: 2 }));
      }, id, word);
      await h.sleep(400);
      if (await p.$(MENU)) {
        const clicked = await p.evaluate((item) => {
          const b = document.getElementById(item);
          b?.click();
          return b ? b.textContent.trim() : null;
        }, item);
        if (clicked) return clicked;
      }
      await p.keyboard.press('Escape');
    }
    return null;
  };

  // 1. Call Hierarchy of doState (the method's own name in its header)
  const label = await menuAt('method-declaration-editor', 'doState', 'editor-menu-call-hierarchy');
  expect(/^METHOD doState/.test(header) && label === 'Call Hierarchy: doState', `the menu on doState: ${label} (${header})`);
  await p.waitForSelector('#call-hierarchy-dialog', { timeout: 15000 }).catch(() => {});
  const rows = async () => p.$$eval('#call-hierarchy-list .call-hierarchy-row', (r) => r.map((x) => `${x.getAttribute('data-depth')}:${x.getAttribute('data-label')}${[...x.querySelectorAll('.call-hierarchy-site')].map((s) => `@${s.getAttribute('data-line')}`).join('')}`));
  const callers = await h.until(async () => ((await rows()).length > 1 ? rows() : null), 10000);
  expect(JSON.stringify(callers) === JSON.stringify(['0:SM_TableManager.doState()', '1:PRG_Line@3', '1:SM_TableA.doState()@1']), `its callers: PRG_Line (line 3, not the comment), SUPER^.doState in SM_TableA (${JSON.stringify(callers)})`);
  expect((await p.evaluate(() => window.__picked)) === 1, 'the project folder asked for once');

  // 2. A caller opened: its own callers (MAIN calls PRG_Line)
  await p.evaluate(() => [...document.querySelectorAll('#call-hierarchy-list .call-hierarchy-row')].find((r) => r.getAttribute('data-label') === 'PRG_Line')?.querySelector('.call-hierarchy-expand')?.click());
  const deeper = await h.until(async () => ((await rows()).some((r) => r.startsWith('2:')) ? rows() : null), 10000);
  expect(!!deeper && deeper.includes('2:MAIN@1'), `PRG_Line opened: MAIN calls it (${JSON.stringify(deeper)})`);

  // 3. A call site: the web edition opens no other POU (said)
  await p.evaluate(() => document.querySelector('#call-hierarchy-list .call-hierarchy-row[data-label="PRG_Line"] .call-hierarchy-site')?.click());
  const toast = await h.until(async () => { const t = await p.$eval('#status-message', (e) => e.textContent).catch(() => ''); return /open it in the TwinCAT editor/.test(t) ? t : null; }, 4000);
  expect(/PRG_Line line 3: open it in the TwinCAT editor/.test(toast ?? ''), `a call in another POU: said where (${toast})`);

  // 4. The Calls tab: doState calls nothing of the project here
  await p.click('#call-hierarchy-calls');
  await h.sleep(500);
  const none = await p.$eval('#call-hierarchy-list', (e) => e.textContent).catch(() => '');
  expect(/Calls nothing in the project/.test(none), `Calls: ${none.slice(0, 120)}`);
  await p.keyboard.press('Escape');
  await h.sleep(300);
  expect(!(await p.$('#call-hierarchy-dialog')), 'Esc closes it');

  // 5. Go to Implementation of doState: its overrides in SM_TableA and SM_TableB (Ctrl+F12)
  await p.evaluate(() => {
    const ta = document.getElementById('method-declaration-editor');
    const at = ta.value.indexOf('doState') + 2;
    ta.focus();
    ta.setSelectionRange(at, at);
  });
  await p.keyboard.down('Control');
  await p.keyboard.press('F12');
  await p.keyboard.up('Control');
  await p.waitForSelector('#call-hierarchy-dialog[data-mode="implementations"]', { timeout: 10000 }).catch(() => {});
  const impls = await p.$$eval('#call-hierarchy-list .call-hierarchy-row', (r) => r.map((x) => x.getAttribute('data-label'))).catch(() => []);
  expect(JSON.stringify(impls) === JSON.stringify(['SM_TableA.doState()', 'SM_TableB.doState()']), `Go to Implementation: the overrides (${JSON.stringify(impls)})`);
  await p.screenshot({ path: h.out('call-hierarchy.png') });

  // 6. The Cross Reference List of cmd_bUnclamp (the POU Editor's declaration): here and in PRG_Line (a write)
  await p.keyboard.press('Escape');
  await p.click('#dock-tab-pou');
  await p.waitForSelector('#pou-declaration-editor', { timeout: 10000 });
  await h.sleep(600);
  const xl = await menuAt('pou-declaration-editor', 'cmd_bUnclamp', 'editor-menu-cross-reference');
  await p.waitForSelector('#xref-dialog', { timeout: 10000 }).catch(() => {});
  const xrefDone = await h.until(() => p.evaluate(() => !document.querySelector('#xref-dialog .animate-spin') && document.querySelectorAll('.xref-pou').length > 1), 10000);
  const xrows = await p.$$eval('.xref-row', (r) => r.map((x) => `${x.getAttribute('data-pou')}:${x.getAttribute('data-kind')}`));
  expect(xl === 'Cross Reference List: cmd_bUnclamp' && xrefDone && xrows.some((x) => x === 'SM_TableManager:declaration') && xrows.includes('PRG_Line:write'), `the Cross Reference List: here and PRG_Line's write (${xl}; ${[...new Set(xrows)].join(', ')})`);
  await p.click('#xref-writes');
  await h.sleep(200);
  const wrows = await p.$$eval('.xref-row', (r) => r.map((x) => x.getAttribute('data-kind')));
  expect(wrows.length > 0 && wrows.every((k) => k === 'write'), `Writes: ${wrows.length}, all writes`);
  await p.keyboard.press('Escape');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
