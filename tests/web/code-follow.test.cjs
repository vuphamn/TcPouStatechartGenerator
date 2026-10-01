// Follow in the code editors: the caret in a state's CASE branch (the Method Editor): its card in Identified States
// flashed, its member shown in the Enum Editor; the canvas only with the Method Editor's Follow on (selected there,
// panned to). The caret on an enum member (the Enum Editor): its card, its CASE label in the Method Editor; the canvas
// only with the Enum Editor's Follow on
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

  const canvasSelected = () => p.evaluate(() => document.querySelector('#mermaid-canvas-area g.node.diagram-selected-node')?.getAttribute('data-state-id') ?? null);
  const focusedCard = () => p.evaluate(() => document.querySelector('[data-code-focus="true"]')?.id?.replace('state-list-item-', '') ?? null);
  // An editor's highlighted line (its gutter) and the line of a text in it
  const highlighted = (id, re) => p.evaluate((id, src) => {
    const ta = document.getElementById(id);
    if (!ta) return null;
    const line = ta.value.split('\n').findIndex((l) => new RegExp(src).test(l)) + 1;
    let root = ta.parentElement;
    while (root && !root.querySelector('div.st-gutter-row')) root = root.parentElement;
    const hl = root && [...root.querySelectorAll('div')].find((d) => /bg-sky-500\/30/.test(d.className) && /ring-sky-400/.test(d.className));
    return { line, highlighted: hl ? parseInt(hl.innerText.replace(/\D+/g, ''), 10) : null };
  }, id, re.source);
  // The caret put on the line after a text's line (inside its branch / on its member line)
  const caretAt = (id, re, below) => p.evaluate((id, src, below) => {
    const ta = document.getElementById(id);
    const lines = ta.value.split('\n');
    const i = lines.findIndex((l) => new RegExp(src).test(l)) + (below ? 1 : 0);
    const pos = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0) + 2;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    return i + 1;
  }, id, re.source, below);

  const S1 = 'TABLEMANAGER_HOMMING';
  const S2 = 'TABLEMANAGER_CLAMPED';
  const before = await canvasSelected();

  // 1. The Method Editor, Follow off: the card and the enum follow, the canvas not
  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-implementation-editor', { timeout: 10000 });
  await h.sleep(600);
  expect(!!(await p.$('#method-follow-checkbox')) && !(await p.$eval('#method-follow-checkbox', (e) => e.checked)), "the Method Editor: Follow, off by default");
  await caretAt('method-implementation-editor', new RegExp(`^\\s*${S1}\\s*:`), true);
  await h.sleep(600);
  expect((await focusedCard()) === S1, `Identified States: ${S1}'s card flashed (${await focusedCard()})`);
  expect((await canvasSelected()) === before, `the canvas: not changed (${await canvasSelected()})`);
  await p.click('#dock-tab-enum');
  await p.waitForSelector('#st-dut-editor', { timeout: 10000 });
  await h.sleep(800);
  let hl = await highlighted('st-dut-editor', new RegExp(`^\\s*,?\\s*${S1}\\b`));
  expect(!!hl && hl.line > 0 && hl.highlighted === hl.line, `the Enum Editor: ${S1}'s line shown (${JSON.stringify(hl)})`);

  // 2. The Enum Editor, Follow on: the card, the CASE label, and the canvas too
  expect(!!(await p.$('#enum-follow-checkbox')), 'the Enum Editor: Follow');
  await p.click('#enum-follow-checkbox');
  await caretAt('st-dut-editor', new RegExp(`^\\s*,?\\s*${S2}\\b`), false);
  await h.sleep(800);
  expect((await focusedCard()) === S2, `Identified States: ${S2}'s card (${await focusedCard()})`);
  expect((await canvasSelected()) === S2, `Follow on: the canvas selects ${S2} (${await canvasSelected()})`);
  await p.click('#dock-tab-method');
  await h.sleep(800);
  hl = await highlighted('method-implementation-editor', new RegExp(`^\\s*${S2}\\s*:`));
  expect(!!hl && hl.line > 0 && hl.highlighted === hl.line, `the Method Editor: ${S2}'s CASE label shown (${JSON.stringify(hl)})`);

  // 3. The Method Editor, Follow on: the canvas selects the caret's state; the editor keeps its caret where it is
  await p.click('#method-follow-checkbox');
  const line = await caretAt('method-implementation-editor', new RegExp(`^\\s*${S1}\\s*:`), true);
  await h.sleep(800);
  expect((await canvasSelected()) === S1, `Follow on: the canvas selects ${S1} (${await canvasSelected()})`);
  const caretLine = await p.evaluate(() => { const ta = document.getElementById('method-implementation-editor'); return ta.value.slice(0, ta.selectionStart).split('\n').length; });
  expect(caretLine === line, `the caret stays where it was put (line ${caretLine}, put on ${line})`);
  expect((await p.evaluate(() => localStorage.getItem('kss.follow.method'))) === '1', 'Follow kept in this browser');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
