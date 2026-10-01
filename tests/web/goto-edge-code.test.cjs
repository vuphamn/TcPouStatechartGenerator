// Go to code (an edge label's right-click menu, its Guard Condition popup): the Method Editor at its condition: in
// preProcess() for an AnyState edge, in doState() for a state's (its assignment's line, the caret there)
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
  await h.sleep(2000);
  await p.evaluate(() => document.querySelector('#diagram-minimap-container button[title^="Close Minimap"]')?.click());

  const labelAt = (from, to) => p.evaluate((from, to) => {
    const el = [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].find((x) => x.getAttribute('data-from') === from && x.getAttribute('data-to') === to && x.getBoundingClientRect().width > 0);
    const r = el?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, from, to);
  // (where the Method Editor is: its method, its caret's line)
  const where = () => p.evaluate(() => {
    const ta = document.getElementById('method-implementation-editor');
    const method = document.getElementById('method-selector-combobox')?.value ?? document.getElementById('method-selector-combobox')?.textContent ?? '';
    // (the line it marks: its condition's IF, its assignment a few lines on at most)
    const n = Number(document.querySelector('[data-highlighted-line]')?.getAttribute('data-highlighted-line'));
    if (!ta || !n) return { method: method.trim(), line: null };
    // (the caret on it, the editor focused: its gutter row the caret's, its band shown)
    const caret = ta.value.slice(0, ta.selectionStart).split('\n').length;
    const row = document.querySelector('#method-implementation-editor-gutter [data-highlighted-line]');
    return {
      method: method.trim(), line: ta.value.split('\n').slice(n - 1, n + 3).map((l) => l.trim()).join(' | '),
      caret: caret === n, focused: document.activeElement === ta, caretRow: row?.getAttribute('data-caret-line') ?? null,
      band: !!document.getElementById('method-implementation-editor-caret-line'),
    };
  });
  const back = async () => {
    await p.click('#dock-tab-diagram').catch(() => {});
    await h.sleep(1200);
  };

  // 1. AnyState → ERROR (preProcess()): its label's menu
  const CASES = [
    { from: 'AnyState', to: 'TABLEMANAGER_ERROR', method: /preProcess/ },
    { from: 'TABLEMANAGER_HALT_FEED', to: 'TABLEMANAGER_IDLE_FEED_OFF', method: /doState/ },
  ];
  for (const c of CASES) {
    const at = await labelAt(c.from, c.to);
    expect(!!at, `${c.from} → ${c.to}: its label on the canvas`);
    if (!at) continue;
    await p.mouse.click(at.x, at.y, { button: 'right' });
    await p.waitForSelector('#context-menu-goto-code-btn', { timeout: 3000 }).catch(() => {});
    const title = await p.$eval('#context-menu-goto-code-btn', (b) => b.getAttribute('title')).catch(() => null);
    await p.click('#context-menu-goto-code-btn').catch(() => {});
    await h.sleep(1500);
    const w = await where();
    expect(c.method.test(title ?? '') && c.method.test(w.method) && new RegExp(`:=\\s*(\\w+\\.)?${c.to}\\b`).test(w.line ?? ''), `${c.from} → ${c.to}, its menu's Go to code (${title}): ${w.method}, at "${w.line}"`);
    expect(w.caret && w.focused && w.caretRow === 'focused' && w.band, `${c.from} → ${c.to}: the caret there, the editor focused, its line number and band marked (${JSON.stringify({ caret: w.caret, focused: w.focused, row: w.caretRow, band: w.band })})`);
    // (still marked a while later: not a flash)
    await h.sleep(3500);
    const later = await where();
    expect(later.line === w.line, `${c.from} → ${c.to}: still marked 3.5 s later (${later.line})`);
    await back();
  }

  // 2. The Guard Condition popup's Go to code
  const at = await labelAt('TABLEMANAGER_HALT_FEED', 'TABLEMANAGER_IDLE_FEED_OFF');
  if (at) {
    await p.mouse.move(at.x, at.y, { steps: 3 });
    await p.waitForSelector('#guard-popup-goto-code', { visible: true, timeout: 8000 }).catch(() => {});
    await h.sleep(300);
    await p.click('#guard-popup-goto-code').catch(() => {});
    await h.sleep(1500);
    const w = await where();
    expect(/doState/.test(w.method) && /:=\s*(\w+\.)?TABLEMANAGER_IDLE_FEED_OFF\b/.test(w.line ?? ''), `the popup's Go to code: ${w.method}, at "${w.line}"`);
  }

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
