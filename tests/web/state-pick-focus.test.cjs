// A state picked on the canvas or in Identified States while the Enum Editor (floating beside the canvas) has the
// focus, its caret on another member: its caret and highlighted row move to the picked state's member, and no other
// card in Identified States keeps the frame of the editors' caret state. The same with the Method Editor's caret in
// a state's CASE branch
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
  await p.evaluate(() => document.querySelector('#diagram-minimap-container button[title^="Close Minimap"]')?.click());
  for (const t of ['method', 'enum', 'diagram']) {
    await p.click(`#dock-tab-${t}`);
    await h.sleep(600);
  }
  // The Enum Editor floating (its tab double-clicked), the canvas shown beside it
  const tab = await p.$('#dock-tab-enum');
  const r = await tab.boundingBox();
  await p.mouse.click(r.x + r.width / 2, r.y + r.height / 2, { clickCount: 2 });
  await h.sleep(1200);
  await p.click('#dock-tab-diagram').catch(() => {});
  await h.sleep(800);
  const enumShown = await p.evaluate(() => { const ta = document.getElementById('st-dut-editor'); return !!ta && ta.clientHeight > 0; });
  expect(enumShown, 'the Enum Editor floating, shown with the canvas');

  const A = 'TABLEMANAGER_REFEED_UNCLAMP';

  const enumLook = (s) => p.evaluate((s) => {
    const ta = document.getElementById('st-dut-editor');
    const line = ta.value.split('\n').findIndex((l) => new RegExp(`^\\s*,?\\s*${s}\\b`).test(l)) + 1;
    const caret = ta.value.slice(0, ta.selectionStart).split('\n').length;
    let root = ta.parentElement;
    while (root && !root.querySelector('div.st-gutter-row')) root = root.parentElement;
    const hl = root?.querySelector('[data-highlighted-line]')?.getAttribute('data-highlighted-line');
    return { line, caret, highlighted: hl ? Number(hl) : null };
  }, s);
  const framed = () => p.$$eval('[data-code-focus="true"]', (e) => e.map((x) => x.id.replace(/^state-list-item-/, '')));
  const selected = () => p.evaluate(() => document.querySelector('#mermaid-canvas-area g.node.selected, #mermaid-canvas-area g.node[data-selected="true"]')?.getAttribute('data-state-id') ?? null);

  // 1. The caret in the Enum Editor on A (as a click there would): A the editors' caret state
  await p.evaluate((A) => {
    const ta = document.getElementById('st-dut-editor');
    ta.focus();
    const lines = ta.value.split('\n');
    const i = lines.findIndex((l) => new RegExp(`^\\s*,?\\s*${A}\\b`).test(l));
    const at = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0) + 2;
    ta.setSelectionRange(at, at);
  }, A);
  await h.sleep(900);
  expect((await framed()).includes(A), `the caret on ${A} in the Enum Editor: its card framed (${await framed()})`);

  // 2. Another state, B, clicked on the canvas (the focus where it was): one the floating editor leaves uncovered
  const at = await p.evaluate((A) => {
    for (const g of document.querySelectorAll('#mermaid-canvas-area g.node[data-state-id]')) {
      const id = g.getAttribute('data-state-id');
      if (id === A || !/^TABLEMANAGER_/.test(id) || !document.getElementById(`state-list-item-${id}`)) continue;
      const q = (g.querySelector('rect, path, polygon') ?? g).getBoundingClientRect();
      const x = q.x + q.width / 2, y = q.y + q.height / 2;
      if (document.elementFromPoint(x, y)?.closest('g.node') === g) return { x, y, id };
    }
    return null;
  }, A);
  const B = at?.id;
  expect(!!at, `a state on the canvas, not under the Enum Editor: ${B}`);
  if (at) {
    await p.mouse.click(at.x, at.y);
    await h.sleep(1200);
    const e = await enumLook(B);
    expect(e.line > 0 && e.caret === e.line && e.highlighted === e.line, `${B} clicked on the canvas: the Enum Editor's caret and highlight on it (${JSON.stringify(e)})`);
    const f = await framed();
    expect(!f.some((x) => x !== B), `${B} clicked: no other card framed (${f})`);
  }

  // 3. Another state, C, clicked in Identified States
  const C = B === 'TABLEMANAGER_CLAMPED' ? 'TABLEMANAGER_HOMMING' : 'TABLEMANAGER_CLAMPED';
  await p.evaluate((C) => document.getElementById(`state-list-item-${C}`)?.scrollIntoView({ block: 'center' }), C);
  await h.sleep(300);
  const card = await p.$(`#state-list-item-${C}`);
  const cr = await card.boundingBox();
  // (on its description: not its code icon)
  await p.mouse.click(cr.x + 60, cr.y + 28);
  await h.sleep(1200);
  const e2 = await enumLook(C);
  expect(e2.line > 0 && e2.caret === e2.line && e2.highlighted === e2.line, `${C} clicked in Identified States: the Enum Editor's caret and highlight on it (${JSON.stringify(e2)})`);
  const f2 = await framed();
  expect(!f2.some((x) => x !== C), `${C} clicked: no other card framed (${f2})`);

  // 4. The Method Editor floating too, its caret in D's CASE branch (doState()), then a state clicked on the canvas
  const mt = await p.$('#dock-tab-method');
  const mr = await mt.boundingBox();
  await p.mouse.click(mr.x + mr.width / 2, mr.y + mr.height / 2, { clickCount: 2 });
  await h.sleep(1200);
  await p.click('#dock-tab-diagram').catch(() => {});
  await h.sleep(800);
  const D = 'TABLEMANAGER_AUTOFEED_INIT_RESTART';
  const methodLook = (s) => p.evaluate((s) => {
    const ta = document.getElementById('method-implementation-editor');
    if (!ta || ta.clientHeight === 0) return null;
    const line = ta.value.split('\n').findIndex((l) => new RegExp(`^\\s*(\\w+\\.)?${s}\\s*:`).test(l)) + 1;
    const caret = ta.value.slice(0, ta.selectionStart).split('\n').length;
    const hl = document.querySelector('#method-implementation-editor-gutter [data-highlighted-line]')?.getAttribute('data-highlighted-line');
    return { line, caret, highlighted: hl ? Number(hl) : null };
  }, s);
  const placed = await p.evaluate((D) => {
    const ta = document.getElementById('method-implementation-editor');
    if (!ta || ta.clientHeight === 0) return false;
    ta.focus();
    const lines = ta.value.split('\n');
    const i = lines.findIndex((l) => new RegExp(`^\\s*(\\w+\\.)?${D}\\s*:`).test(l));
    if (i < 0) return false;
    // (a line inside its branch)
    const at = lines.slice(0, i + 1).reduce((n, l) => n + l.length + 1, 0) + 4;
    ta.setSelectionRange(at, at);
    return true;
  }, D);
  await h.sleep(900);
  expect(placed && (await framed()).join() === D, `the caret in ${D}'s branch in the Method Editor: its card framed (${await framed()})`);
  const at2 = await p.evaluate((D) => {
    for (const g of document.querySelectorAll('#mermaid-canvas-area g.node[data-state-id]')) {
      const id = g.getAttribute('data-state-id');
      if (id === D || !/^TABLEMANAGER_/.test(id) || !document.getElementById(`state-list-item-${id}`)) continue;
      const q = (g.querySelector('rect, path, polygon') ?? g).getBoundingClientRect();
      const x = q.x + q.width / 2, y = q.y + q.height / 2;
      if (document.elementFromPoint(x, y)?.closest('g.node') === g) return { x, y, id };
    }
    return null;
  }, D);
  expect(!!at2, `a state on the canvas, not under the editors: ${at2?.id}`);
  if (at2) {
    await p.mouse.click(at2.x, at2.y);
    await h.sleep(1200);
    const f = await framed();
    expect(!f.some((x) => x !== at2.id), `${at2.id} clicked: ${D}'s card no longer framed (${f})`);
    const m = await methodLook(at2.id);
    expect(!!m && m.line > 0 && m.caret === m.line && m.highlighted === m.line, `${at2.id} clicked: the Method Editor's caret and highlight on its CASE label (${JSON.stringify(m)})`);
  }

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
