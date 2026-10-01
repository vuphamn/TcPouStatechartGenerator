// The Diff: Split view by default (the text before on the left, after on the right), Unified on its toggle (kept);
// docked (its Dock button): a tab beside the Diagram Canvas, both on screen; an edit in the editor meanwhile: the Diff
// says the code changed, Reload shows it; Float: a popup again
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1700, height: 1000 } });
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
  const insert = (text, atEnd) => p.evaluate((id, text, atEnd) => {
    const ta = document.getElementById(id);
    ta.focus();
    const at = atEnd ? ta.value.length : 0;
    ta.setSelectionRange(at, at);
    document.execCommand('insertText', false, text);
  }, ID, text, atEnd);
  await insert('// first\n', false);
  await h.sleep(300);
  await p.click('#method-diff-btn');
  await p.waitForSelector('#diff-dialog', { timeout: 3000 }).catch(() => {});

  // Split: the line put in on the right, nothing on its left
  const split = await p.evaluate(() => {
    const d = document.getElementById('diff-dialog');
    const row = d?.querySelector('tr.diff-add');
    return { view: d?.getAttribute('data-view'), before: row?.querySelector('.diff-before')?.textContent ?? null, after: row?.querySelector('.diff-after')?.textContent ?? null };
  });
  expect(split.view === 'split' && split.after === '// first' && split.before === '', `Split by default: before "${split.before}", after "${split.after}"`);
  await p.click('#diff-view-unified');
  await h.sleep(200);
  expect((await p.$eval('#diff-dialog', (d) => d.getAttribute('data-view'))) === 'unified' && !(await p.$('#diff-dialog .diff-before')), 'Unified: one column');
  expect((await p.evaluate(() => localStorage.getItem('kss.diff.view'))) === 'unified', 'the view kept');
  await p.click('#diff-view-split');
  await h.sleep(200);

  // Docked: beside the Diagram Canvas, both on screen
  await p.click('#diff-dock-btn');
  await h.sleep(1200);
  const docked = await p.evaluate(() => {
    const d = document.getElementById('diff-dialog')?.getBoundingClientRect();
    const c = document.getElementById('mermaid-canvas-area')?.getBoundingClientRect();
    return {
      docked: document.getElementById('diff-dialog')?.getAttribute('data-docked'),
      overlay: !!document.getElementById('diff-overlay'),
      d: d && { l: d.left, r: d.right, w: d.width },
      c: c && { l: c.left, r: c.right, w: c.width },
    };
  });
  expect(docked.docked === 'true' && !docked.overlay, 'docked: in its tab, no popup');
  expect(!!docked.d && !!docked.c && docked.d.w > 200 && docked.c.w > 200 && (docked.d.l >= docked.c.r - 2 || docked.d.r <= docked.c.l + 2), `beside the Diagram Canvas, both on screen (${JSON.stringify(docked)})`);

  // An edit in the Method Editor meanwhile: the Diff says so; Reload shows it
  await p.click('#dock-tab-method');
  await h.sleep(600);
  expect(!!(await p.$('#diff-dialog[data-docked="true"]')), 'still docked with the Method Editor shown');
  await insert('\n// second', true);
  const stale = await p.waitForSelector('#diff-stale', { timeout: 4000 }).catch(() => null);
  expect(!!stale, 'the code changed: said in the Diff, Reload offered');
  const counts = () => p.$eval('#diff-counts', (e) => e.textContent.replace(/\s+/g, ' ').trim());
  expect(/\+1 −0/.test(await counts()), `before Reload: as shown (${await counts()})`);
  await p.click('#diff-reload');
  await h.sleep(400);
  expect(/\+2 −0/.test(await counts()) && !(await p.$('#diff-stale')), `Reload: the new line in (${await counts()})`);

  // A change undone in the Diff: shown at once (no Reload asked)
  await p.click('#diff-last');
  await p.click('#diff-undo-change');
  await h.sleep(700);
  expect(/\+1 −0/.test(await counts()) && !(await p.$('#diff-stale')), `Undo change: shown at once (${await counts()})`);

  // Float: a popup again; Esc closes it
  await p.click('#diff-float-btn');
  await h.sleep(600);
  expect(!!(await p.$('#diff-overlay')) && !(await p.$('#diff-dialog[data-docked="true"]')), 'Float: a popup again');
  await p.keyboard.press('Escape');
  await h.sleep(300);
  expect(!(await p.$('#diff-dialog')), 'Esc: closed');

  // Split: within a changed line, what changed marked on both sides (here: a condition put in before a THEN)
  await p.evaluate((id) => {
    const ta = document.getElementById(id);
    ta.focus();
    const at = ta.value.indexOf(' THEN');
    ta.setSelectionRange(at, at);
    document.execCommand('insertText', false, ' AND TRUE');
  }, ID);
  await h.sleep(300);
  await p.click('#diff-view-split').catch(() => {});
  await p.click('#method-diff-btn');
  await p.waitForSelector('#diff-dialog', { timeout: 3000 }).catch(() => {});
  await p.click('#diff-view-split').catch(() => {});
  await h.sleep(300);
  const inline = await p.evaluate(() => {
    const row = [...document.querySelectorAll('#diff-dialog tr.diff-del.diff-add')].find((r) => /AND TRUE/.test(r.textContent));
    return row ? { left: [...row.querySelectorAll('.diff-before [data-diff-inline]')].map((s) => s.textContent), right: [...row.querySelectorAll('.diff-after [data-diff-inline]')].map((s) => s.textContent) } : null;
  });
  expect(inline?.left.length === 0 && inline.right.length === 1 && inline.right[0].trim() === 'AND TRUE', `the change within the line: ${JSON.stringify(inline)}`);
  await p.keyboard.press('Escape');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
