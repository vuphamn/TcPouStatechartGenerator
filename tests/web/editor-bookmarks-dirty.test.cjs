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
  await p.keyboard.press('Escape');
  await h.sleep(300);

  // An edit in the Method Editor: its tab marked; Ctrl+S in it: the mark gone
  await p.click('#dock-tab-method');
  await h.sleep(600);
  expect(!(await p.$('#dock-tab-dirty-method')), 'no edit yet: no "*" on the Method Editor tab');
  await p.evaluate(() => {
    const ta = document.getElementById('method-implementation-editor');
    ta.focus();
    ta.setSelectionRange(0, 0);
  });
  await p.keyboard.type('// note\n');
  await h.sleep(500);
  const mark = await p.$eval('#dock-tab-dirty-method', (e) => ({ text: e.textContent.trim(), title: e.getAttribute('title') })).catch(() => null);
  expect(mark?.text === '*' && /Method Editor/.test(mark.title), `an edit: "*" on the Method Editor tab (${mark?.title})`);
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

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
