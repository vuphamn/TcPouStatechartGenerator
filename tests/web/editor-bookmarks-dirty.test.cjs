// The code editors' bookmarks in every section: the Method Editor's and the POU Editor's declarations, the Enum
// Editor (its right-click menu: Toggle Bookmark at once, the others in Bookmarks; Ctrl+F2), shown in the gutter and
// in the Bookmarks list (opening one goes to it). An editor's tab marked "*" while it has edits not saved (Ctrl+S in
// it: the mark gone)
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(1200);

  // The caret on a line of an editor (1-based), the editor right-clicked there
  const rightClickLine = async (id, line) => {
    const pt = await p.evaluate((id, line) => {
      const ta = document.getElementById(id);
      ta.focus();
      const lines = ta.value.split('\n');
      const pos = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + 1;
      ta.setSelectionRange(pos, pos);
      ta.scrollTop = 0;
      const r = ta.getBoundingClientRect();
      return { x: r.x + 80, y: r.y + 8 + (line - 1) * 20 + 10 };
    }, id, line);
    await p.mouse.click(pt.x, pt.y, { button: 'right' });
    return p.waitForSelector('#editor-menu-bookmark-quick', { timeout: 3000 }).catch(() => null);
  };
  const marks = (id) => p.evaluate((id) => {
    const box = document.getElementById(id)?.closest('.relative.flex-1.min-h-0.flex') ?? document.getElementById(id)?.parentElement?.parentElement;
    return [...(box?.querySelectorAll('[data-bookmark-line]') ?? [])].map((e) => +e.getAttribute('data-bookmark-line'));
  }, id);
  const quick = async (id, line, what) => {
    const item = await rightClickLine(id, line);
    expect(!!item, `${what}: its right-click menu has Toggle Bookmark`);
    if (!item) return;
    await item.click();
    await h.sleep(400);
    expect((await marks(id)).includes(line), `${what}: line ${line} bookmarked (the gutter: ${(await marks(id)).join(', ')})`);
  };

  // The Method Editor's declaration
  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-declaration-editor', { timeout: 10000 });
  await h.sleep(600);
  await quick('method-declaration-editor', 2, "the method's declaration");
  // The POU Editor's declaration
  await p.click('#dock-tab-pou');
  await p.waitForSelector('#pou-declaration-editor', { timeout: 10000 });
  await h.sleep(600);
  await quick('pou-declaration-editor', 3, "the POU's declaration");
  // The Enum Editor: the menu, and Ctrl+F2
  await p.click('#dock-tab-enum');
  await p.waitForSelector('#st-dut-editor', { timeout: 10000 });
  await h.sleep(600);
  await quick('st-dut-editor', 4, 'the enum');
  await p.evaluate(() => {
    const ta = document.getElementById('st-dut-editor');
    ta.focus();
    const lines = ta.value.split('\n');
    const pos = lines.slice(0, 5).reduce((n, l) => n + l.length + 1, 0) + 1;
    ta.setSelectionRange(pos, pos);
  });
  await p.keyboard.down('Control');
  await p.keyboard.press('F2');
  await p.keyboard.up('Control');
  await h.sleep(400);
  expect((await marks('st-dut-editor')).includes(6), `the enum: Ctrl+F2 on line 6 (${(await marks('st-dut-editor')).join(', ')})`);

  // The Bookmarks list: all of them; the enum's opened
  const item = await rightClickLine('st-dut-editor', 4);
  if (item) {
    await p.hover('#editor-menu-bookmarks');
    const list = await p.waitForSelector('#editor-menu-bookmark-list', { timeout: 3000 }).catch(() => null);
    if (list) await list.click();
  }
  await p.waitForSelector('#bookmarks-dialog', { timeout: 5000 }).catch(() => {});
  const rows = await p.$$eval('#bookmarks-dialog .bookmark-row', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  expect(rows.length >= 4, `the Bookmarks list: ${rows.length} (${rows.slice(0, 5).join(' | ')})`);
  // A bookmark named (its pencil): shown in the list
  await p.click('#bookmarks-dialog .bookmark-name-btn');
  await p.waitForSelector('#bookmark-note-input', { timeout: 3000 }).catch(() => {});
  await p.type('#bookmark-note-input', 'start here');
  await p.keyboard.press('Enter');
  await h.sleep(400);
  const named = await p.$$eval('#bookmarks-dialog .bookmark-note', (r) => r.map((x) => x.textContent.trim()));
  expect(named.includes('start here'), `named: ${named.join(', ')}`);
  // Shared: Export and Import; a file imported adds its bookmarks
  expect(!!(await p.$('#bookmarks-export')) && !!(await p.$('#bookmarks-import')), 'the list: Export and Import');
  const upload = require('path').join(h.OUT, 'shared.bookmarks.json');
  require('fs').mkdirSync(h.OUT, { recursive: true });
  require('fs').writeFileSync(upload, JSON.stringify({ format: 'kss-bookmarks', version: 1, pou: 'X', states: ['TABLEMANAGER_UNCLAMPING'], lines: [], notes: { 'state:TABLEMANAGER_UNCLAMPING': 'shared' } }));
  const input = await p.$('#bookmarks-import-file');
  if (input) await input.uploadFile(upload);
  await h.sleep(800);
  const said = await p.$eval('#bookmarks-said', (e) => e.textContent).catch(() => '');
  const rowsNow = await p.$$eval('#bookmarks-dialog .bookmark-row', (r) => r.length);
  expect(/Imported: 1 bookmark added/.test(said) && rowsNow === rows.length + 1, `Import: ${said} (${rowsNow} now)`);
  // Next (its button, Alt+F2): through every section in the list's order
  await p.click('#bookmarks-next');
  await h.sleep(800);
  const first = await p.$eval('#status-message', (e) => e.textContent).catch(() => '');
  // (the states first: the enum's member line bookmarked above is TABLEMANAGER_HOMMING's, then the one imported)
  expect(/Bookmark 1 of \d+/.test(first), `Next: the first (${first})`);
  await p.keyboard.press('Escape');
  await h.sleep(300);
  await p.keyboard.down('Alt'); await p.keyboard.press('F2'); await p.keyboard.up('Alt');
  await h.sleep(800);
  const second = await p.$eval('#status-message', (e) => e.textContent).catch(() => '');
  expect(/Bookmark 2 of \d+/.test(second), `Alt+F2: the next one (${second})`);
  await p.keyboard.down('Shift'); await p.keyboard.down('Alt'); await p.keyboard.press('F2'); await p.keyboard.up('Alt'); await p.keyboard.up('Shift');
  await h.sleep(800);
  expect(/Bookmark 1 of \d+/.test(await p.$eval('#status-message', (e) => e.textContent).catch(() => '')), 'Shift+Alt+F2: back to the first');

  // An edit in the Method Editor: its tab marked; Ctrl+S in it: the mark gone
  await p.click('#dock-tab-method');
  await h.sleep(600);
  expect(!(await p.$('#dock-tab-dirty-method')), 'no edit yet: no "*" on the Method Editor tab');
  expect(await p.$eval('#method-diff-btn', (b) => b.disabled), 'no edit yet (nor of its file): its Diff disabled');
  await p.evaluate(() => {
    const ta = document.getElementById('method-implementation-editor');
    ta.focus();
    ta.setSelectionRange(0, 0);
  });
  await p.keyboard.type('// note\n');
  await h.sleep(500);
  const mark = await p.$eval('#dock-tab-dirty-method', (e) => ({ text: e.textContent.trim(), title: e.getAttribute('title') })).catch(() => null);
  expect(mark?.text === '*' && /Method Editor/.test(mark.title), `an edit: "*" on the Method Editor tab (${mark?.title})`);
  // Its changes: the Diff button, and the "*" clicked
  const diffShown = async () => p.evaluate(() => {
    const d = document.getElementById('diff-dialog');
    if (!d) return null;
    return { counts: document.getElementById('diff-counts')?.textContent.replace(/\s+/g, ' ').trim(), added: [...d.querySelectorAll('.diff-add')].map((r) => r.textContent.trim()) };
  });
  await p.click('#method-diff-btn');
  await p.waitForSelector('#diff-dialog', { timeout: 3000 }).catch(() => {});
  let shownDiff = await diffShown();
  expect(!!shownDiff && /\+1 −0/.test(shownDiff.counts) && shownDiff.added.some((t) => /\/\/ note/.test(t)), `Diff: the line put in (${JSON.stringify(shownDiff)})`);
  await p.keyboard.press('Escape');
  await h.sleep(300);
  expect(!(await p.$('#diff-dialog')), 'Esc: closed');
  await p.click('#dock-tab-dirty-method');
  await p.waitForSelector('#diff-dialog', { timeout: 3000 }).catch(() => {});
  shownDiff = await diffShown();
  expect(!!shownDiff && shownDiff.added.some((t) => /\/\/ note/.test(t)), 'the "*" clicked: the same changes');
  await p.keyboard.press('Escape');
  await h.sleep(300);
  await p.evaluate(() => document.getElementById('method-implementation-editor').focus());
  await p.keyboard.down('Control');
  await p.keyboard.press('s');
  await p.keyboard.up('Control');
  await h.sleep(800);
  // (its edit in the POU now: no edit of its own left; the POU's file, changed since it was saved, may still be)
  const after = await p.$eval('#dock-tab-dirty-method', (e) => e.getAttribute('title')).catch(() => null);
  expect(!after || !/Method Editor/.test(after), `Ctrl+S in it: no edit of its own left (${after ?? 'no "*"'})`);
  // The Enum Editor too
  await p.click('#dock-tab-enum');
  await h.sleep(500);
  await p.evaluate(() => {
    const ta = document.getElementById('st-dut-editor');
    ta.focus();
    ta.setSelectionRange(0, 0);
  });
  await p.keyboard.type('// note\n');
  await h.sleep(500);
  expect(!!(await p.$('#dock-tab-dirty-enum')), 'an edit in the Enum Editor: "*" on its tab');
  // Save to file (one step): its edits in the enum, then the files written (the header's Save for it)
  await p.click('#enum-save-file-btn');
  await h.sleep(1200);
  const enumMark = await p.$eval('#dock-tab-dirty-enum', (e) => e.getAttribute('title')).catch(() => null);
  expect(!enumMark || !/Enum Editor/.test(enumMark), `Save to file: the Enum Editor's edits put in (${enumMark ?? 'no "*"'})`);
  // Ctrl+Alt+S in the POU Editor: the same
  await p.click('#dock-tab-pou');
  await h.sleep(500);
  await p.evaluate(() => { const ta = document.getElementById('pou-implementation-editor'); ta.focus(); ta.setSelectionRange(0, 0); });
  await p.keyboard.type('// note\n');
  await h.sleep(400);
  expect(/POU Editor/.test(await p.$eval('#dock-tab-dirty-pou', (e) => e.getAttribute('title')).catch(() => '')), 'an edit in the POU Editor: "*" on its tab');
  await p.keyboard.down('Control'); await p.keyboard.down('Alt'); await p.keyboard.press('s'); await p.keyboard.up('Alt'); await p.keyboard.up('Control');
  await h.sleep(1200);
  const pouMark = await p.$eval('#dock-tab-dirty-pou', (e) => e.getAttribute('title')).catch(() => null);
  expect(!pouMark || !/POU Editor/.test(pouMark), `Ctrl+Alt+S: the POU Editor's edits put in (${pouMark ?? 'no "*"'})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
