// A state clicked in Identified States: the Method Editor's caret on its CASE label and the Enum Editor's on its
// member, each row highlighted and still highlighted later (until another state is chosen); another state: they move
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
  // (both editors opened once: their tabs mounted)
  for (const t of ['method', 'enum', 'diagram']) {
    await p.click(`#dock-tab-${t}`);
    await h.sleep(600);
  }

  const clickCard = (s) => p.evaluate((s) => {
    const el = document.getElementById(`state-list-item-${s}`);
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    (el.querySelector('[data-state-name], .font-mono, span') ?? el).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, s);
  // An editor: the caret's line, the highlighted row, the line of a text
  const look = (id, src) => p.evaluate((id, src) => {
    const ta = document.getElementById(id);
    if (!ta) return null;
    const line = ta.value.split('\n').findIndex((l) => new RegExp(src).test(l)) + 1;
    const caret = ta.value.slice(0, ta.selectionStart).split('\n').length;
    let root = ta.parentElement;
    while (root && !root.querySelector('div.st-gutter-row')) root = root.parentElement;
    const hl = root?.querySelector('[data-highlighted-line]')?.getAttribute('data-highlighted-line');
    return { line, caret, highlighted: hl ? Number(hl) : null };
  }, id, src);
  const check = async (s, what) => {
    await p.click('#dock-tab-method');
    await h.sleep(700);
    const m = await look('method-implementation-editor', `^\\s*${s}\\s*:`);
    expect(!!m && m.line > 0 && m.caret === m.line && m.highlighted === m.line, `${what}: the Method Editor's caret and highlight on ${s}'s CASE label (${JSON.stringify(m)})`);
    await p.click('#dock-tab-enum');
    await h.sleep(700);
    const e = await look('st-dut-editor', `^\\s*,?\\s*${s}\\b`);
    expect(!!e && e.line > 0 && e.caret === e.line && e.highlighted === e.line, `${what}: the Enum Editor's caret and highlight on ${s} (${JSON.stringify(e)})`);
    return { m, e };
  };

  const S1 = 'TABLEMANAGER_HOMMING';
  const S2 = 'TABLEMANAGER_CLAMPED';
  expect(await clickCard(S1), `clicked ${S1} in Identified States`);
  await h.sleep(800);
  await check(S1, S1);
  // Later: still highlighted
  await h.sleep(4000);
  await p.click('#dock-tab-method');
  await h.sleep(300);
  const later = await look('method-implementation-editor', `^\\s*${S1}\\s*:`);
  expect(!!later && later.highlighted === later.line, `4 s later: still highlighted (${JSON.stringify(later)})`);
  // Another state: both move
  expect(await clickCard(S2), `clicked ${S2}`);
  await h.sleep(800);
  await check(S2, S2);

  // A click on another row of the Enum Editor: no row highlighted but the caret's own (its band)
  await p.click('#dock-tab-enum');
  await h.sleep(500);
  const moved = await p.evaluate(() => {
    const ta = document.getElementById('st-dut-editor');
    ta.focus();
    const lines = ta.value.split('\n');
    const i = lines.findIndex((l) => /TABLEMANAGER_AUTOFEED_INSTOP_HALT/.test(l));
    const pos = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0) + 3;
    ta.setSelectionRange(pos, pos);
    return i + 1;
  });
  await h.sleep(600);
  const after = await look('st-dut-editor', '^\\s*,?\\s*TABLEMANAGER_AUTOFEED_INSTOP_HALT\\b');
  expect(!!after && after.caret === moved && (after.highlighted === null || after.highlighted === moved), `a click on another row: the old highlight gone (${JSON.stringify(after)})`);
  // ... the Method Editor too
  await p.click('#dock-tab-method');
  await h.sleep(500);
  const mline = await p.evaluate(() => {
    const ta = document.getElementById('method-implementation-editor');
    ta.focus();
    const lines = ta.value.split('\n');
    const i = lines.findIndex((l) => /^\s*TABLEMANAGER_HALT_FEED\s*:/.test(l)) + 2;
    const pos = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0) + 2;
    ta.setSelectionRange(pos, pos);
    return i + 1;
  });
  await h.sleep(600);
  const m2 = await look('method-implementation-editor', '^\\s*TABLEMANAGER_HALT_FEED\\s*:');
  expect(!!m2 && m2.caret === mline && (m2.highlighted === null || m2.highlighted === mline), `the Method Editor: the old highlight gone (${JSON.stringify(m2)})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
