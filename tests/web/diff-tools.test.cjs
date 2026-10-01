// The Diff popup's toolbar and its right-click menu: Previous / Next change (and F8), Undo change (the editor's text
// as before at that change only), Redo change (put back), a line edited in place (into the editor's text); a file's
// diff (its "*" with no editor edits): a change undone there goes into the POU (the "*" gone when nothing is left)
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

  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-implementation-editor', { timeout: 10000 });
  await h.sleep(600);
  const ID = 'method-implementation-editor';
  const text = () => p.$eval(`#${ID}`, (t) => t.value);
  const original = await text();
  // Two changes: a line put in at the top, one at the end
  await p.evaluate((id) => {
    const ta = document.getElementById(id);
    ta.focus();
    ta.setSelectionRange(0, 0);
    document.execCommand('insertText', false, '// first\n');
    ta.setSelectionRange(ta.value.length, ta.value.length);
    document.execCommand('insertText', false, '\n// second');
  }, ID);
  await h.sleep(400);
  expect((await text()).startsWith('// first') && (await text()).endsWith('// second'), 'two lines put in');

  await p.click('#method-diff-btn');
  await p.waitForSelector('#diff-toolbar', { timeout: 3000 }).catch(() => {});
  const pos = () => p.$eval('#diff-position', (e) => e.textContent.trim()).catch(() => '');
  const ids = await p.$$eval('#diff-toolbar button', (b) => b.map((x) => x.id));
  expect(['diff-first', 'diff-prev', 'diff-next', 'diff-last', 'diff-undo-change', 'diff-redo-change'].every((x) => ids.includes(x)), `the toolbar: ${ids.join(', ')}`);
  expect((await pos()) === 'Change 1 of 2', `at the first change (${await pos()})`);
  // Context: the whole code by default (no lines left out); 3 lines: the rest left out
  const rowsShown = () => p.$$eval('#diff-body tr', (r) => ({ rows: r.filter((x) => x.classList.contains('diff-row')).length, gaps: r.filter((x) => x.classList.contains('diff-gap')).length }));
  const whole = await rowsShown();
  expect((await p.$eval('#diff-context', (e) => e.value)) === 'all' && whole.gaps === 0 && whole.rows > 50, `the whole code shown (${whole.rows} lines, ${whole.gaps} gaps)`);
  await p.select('#diff-context', '3');
  await h.sleep(200);
  const few = await rowsShown();
  expect(few.gaps >= 1 && few.rows < whole.rows, `3 lines of context: ${few.rows} lines, ${few.gaps} gaps`);
  await p.select('#diff-context', 'all');
  await h.sleep(200);
  await p.click('#diff-next');
  await h.sleep(200);
  expect((await pos()) === 'Change 2 of 2', `Next: the second (${await pos()})`);
  await p.keyboard.press('F8');
  await h.sleep(200);
  expect((await pos()) === 'Change 1 of 2', `F8: round to the first (${await pos()})`);
  await p.keyboard.down('Shift'); await p.keyboard.press('F8'); await p.keyboard.up('Shift');
  await h.sleep(200);
  expect((await pos()) === 'Change 2 of 2', `Shift+F8: the previous (${await pos()})`);
  await p.click('#diff-first');
  await h.sleep(200);
  expect((await pos()) === 'Change 1 of 2', `First (${await pos()})`);
  await p.click('#diff-last');
  await h.sleep(200);
  expect((await pos()) === 'Change 2 of 2', `Last (${await pos()})`);
  await p.keyboard.down('Alt'); await p.keyboard.press('Home'); await p.keyboard.up('Alt');
  await h.sleep(200);
  expect((await pos()) === 'Change 1 of 2', `Alt+Home: the first (${await pos()})`);
  await p.keyboard.down('Alt'); await p.keyboard.press('End'); await p.keyboard.up('Alt');
  await h.sleep(200);
  expect((await pos()) === 'Change 2 of 2', `Alt+End: the last (${await pos()})`);

  // Undo change (the second): only it taken out of the editor; Redo change: back
  await p.click('#diff-undo-change');
  await h.sleep(500);
  let t = await text();
  expect(t.startsWith('// first') && !t.includes('// second') && (await pos()) === 'Change 1 of 1', `Undo change: the second taken out, the first kept (${await pos()})`);
  await p.click('#diff-redo-change');
  await h.sleep(500);
  t = await text();
  expect(t.startsWith('// first') && t.endsWith('// second') && /of 2$/.test(await pos()), `Redo change: put back (${await pos()})`);

  // The right-click menu on the first change: its items; Undo this change
  const firstRow = await p.$('#diff-body tr.diff-add');
  // (the whole code shown: the row scrolled into view first)
  await firstRow.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await h.sleep(250);
  const box = await firstRow.boundingBox();
  await p.mouse.click(box.x + 200, box.y + box.height / 2, { button: 'right' });
  await p.waitForSelector('#diff-menu', { timeout: 2000 }).catch(() => {});
  const menuIds = await p.$$eval('#diff-menu button', (b) => b.map((x) => x.id));
  expect(['diff-menu-undo', 'diff-menu-redo', 'diff-menu-edit', 'diff-menu-first', 'diff-menu-prev', 'diff-menu-next', 'diff-menu-last'].every((x) => menuIds.includes(x)), `the right-click menu: ${menuIds.join(', ')}`);
  await p.click('#diff-menu-undo');
  await h.sleep(500);
  t = await text();
  expect(!t.startsWith('// first') && t.endsWith('// second'), 'Undo this change (right-clicked): the first taken out');

  // A line edited in place: a double-click, typed, Enter: in the editor's text
  // (found, scrolled into view and measured at once: the Diff redraws after a change)
  await p.evaluate(() => document.querySelector('#diff-body tr.diff-add').scrollIntoView({ block: 'center' }));
  await h.sleep(250);
  const rb = await p.evaluate(() => { const r = document.querySelector('#diff-body tr.diff-add').getBoundingClientRect(); return { x: r.x, y: r.y, height: r.height }; });
  await p.mouse.click(rb.x + 200, rb.y + rb.height / 2, { clickCount: 2 });
  const input = await p.waitForSelector('#diff-line-input', { timeout: 2000 }).catch(() => null);
  expect(!!input, 'a double-click: the line edited in place');
  if (input) {
    await p.evaluate(() => { const i = document.getElementById('diff-line-input'); i.setSelectionRange(i.value.length, i.value.length); });
    await p.keyboard.type(' edited');
    await p.keyboard.press('Enter');
    await h.sleep(500);
  }
  t = await text();
  expect(t.endsWith('// second edited') && !(await p.$('#diff-line-input')), `Enter: the line in the editor (${JSON.stringify(t.slice(-20))})`);
  await p.keyboard.press('Escape');
  await h.sleep(300);
  expect(!(await p.$('#diff-dialog')), 'Esc: closed');

  // The file's diff: the editor's edit saved into the POU (Ctrl+S), the "*" clicked: a change undone there, into the POU
  await p.evaluate((id) => document.getElementById(id).focus(), ID);
  await p.keyboard.down('Control'); await p.keyboard.press('s'); await p.keyboard.up('Control');
  await h.sleep(1000);
  const mark = await p.$('#dock-tab-dirty-method');
  expect(!!mark, 'saved into the POU: its file changed ("*")');
  if (mark) {
    await mark.click();
    await p.waitForSelector('#diff-toolbar', { timeout: 3000 }).catch(() => {});
    expect(/of 1$/.test(await pos()), `the file's diff: one change (${await pos()})`);
    await p.click('#diff-undo-change');
    await h.sleep(800);
    expect((await pos()) === 'No changes', `Undo change: none left (${await pos()})`);
    await p.keyboard.press('Escape');
    await h.sleep(500);
    expect(!(await p.$('#dock-tab-dirty-method')) && (await text()) === original, 'the POU as saved: no "*", the editor as it was');
  }

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
