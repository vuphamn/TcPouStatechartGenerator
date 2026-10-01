// All changes and the states changed since saved: a state's code edited in the Method Editor and put into the POU
// (Ctrl+S): an amber dot on it on the canvas and the minimap, "changed" in the canvas's search; then an edit in the
// POU Editor not in the POU yet: the header's Diff (All changes) shows both, the editor's and the file's, and a change
// undone there goes into the editor
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
  const S = 'TABLEMANAGER_DISABLED';
  expect(!(await p.$('#mermaid-canvas-area g.state-changed-marker')), 'nothing changed: no state marked');

  // A line put into the state's branch, into the POU (Ctrl+S in the Method Editor)
  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-implementation-editor', { timeout: 10000 });
  await h.sleep(600);
  await p.evaluate((s) => {
    const ta = document.getElementById('method-implementation-editor');
    const at = ta.value.indexOf('\n', ta.value.indexOf(`${s}:`)) + 1;
    ta.focus();
    ta.setSelectionRange(at, at);
    document.execCommand('insertText', false, '    // changed here\n');
  }, S);
  await h.sleep(300);
  await p.keyboard.down('Control'); await p.keyboard.press('s'); await p.keyboard.up('Control');
  await h.sleep(1500);
  await p.click('#dock-tab-diagram');
  await h.sleep(1500);
  // (the states marked: the canvas's drawing, and the minimap's copy of it)
  const marked = [...new Set(await p.$$eval('#mermaid-canvas-area g.state-changed-marker', (m) => m.map((x) => x.getAttribute('data-state-id'))))];
  expect(marked.length === 1 && marked[0] === S, `the canvas: ${S} marked changed (${marked.join(', ')})`);
  const mini = await p.$$eval('.minimap-changed-marker', (m) => m.map((x) => x.getAttribute('data-state-id'))).catch(() => []);
  expect(mini.includes(S), `the minimap: its dot (${mini.join(', ')})`);
  // The canvas's search: "changed" on its result
  await p.click('#diagram-search-input').catch(() => {});
  await p.keyboard.type('DISABLED');
  await h.sleep(1200);
  const tags = await p.$$eval('.search-changed-tag', (t) => t.length);
  expect(tags >= 1, `the search: its result tagged "changed" (${tags})`);
  await p.keyboard.press('Escape');

  // An edit in the POU Editor, not in the POU yet: All changes shows it and the file's
  await p.click('#dock-tab-pou');
  await p.waitForSelector('#pou-implementation-editor', { timeout: 10000 });
  await h.sleep(500);
  await p.evaluate(() => { const ta = document.getElementById('pou-implementation-editor'); ta.focus(); ta.setSelectionRange(0, 0); document.execCommand('insertText', false, '// pou edit\n'); });
  await h.sleep(500);
  // (the Save ▾ menu: All changes)
  await p.click('#save-sources-menu-btn');
  const btn = await p.waitForSelector('#dock-menu-save-menu-diff-all', { timeout: 3000 }).catch(() => null);
  expect(!!btn, "the Save menu: All changes");
  if (btn) await btn.click();
  await p.waitForSelector('#diff-dialog', { timeout: 3000 }).catch(() => {});
  const parts = await p.$$eval('#diff-dialog [data-diff-part]', (d) => d.map((x) => x.getAttribute('data-diff-part')));
  expect(parts.some((x) => /POU Editor.*Implementation.*in the editor/.test(x)) && parts.some((x) => /doState\(\) implementation \(since saved\)/.test(x)), `the editor's and the file's (${parts.join(' | ')})`);
  expect(/of 2$/.test(await p.$eval('#diff-position', (e) => e.textContent.trim())), 'two changes');
  // The first (the POU Editor's) undone: out of that editor
  await p.click('#diff-first');
  await p.click('#diff-undo-change');
  await h.sleep(600);
  const pou = await p.$eval('#pou-implementation-editor', (t) => t.value);
  expect(!pou.startsWith('// pou edit') && /of 1$/.test(await p.$eval('#diff-position', (e) => e.textContent.trim())), 'Undo change: out of the POU Editor, one left');
  await p.keyboard.press('Escape');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
