// Undo / Redo in the right-click menus: a code editor's (its own undo: the typing taken back, then put in again) and
// the canvas's (a state's move undone); the Diff popup's text size by Ctrl+wheel (the code editors' size; Ctrl+0: 100%)
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

  // 1. The Method Editor: typed in, its right-click menu's Undo takes it back, Redo puts it in again
  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-implementation-editor', { timeout: 10000 });
  await h.sleep(600);
  const ID = 'method-implementation-editor';
  const text = () => p.$eval(`#${ID}`, (t) => t.value);
  const original = await text();
  await p.evaluate((id) => { const ta = document.getElementById(id); ta.focus(); ta.setSelectionRange(0, 0); }, ID);
  // (the editor's undo, as Ctrl+Z in it: a key at a time)
  await p.keyboard.type('undoMe');
  await h.sleep(400);
  expect((await text()).startsWith('undoMe'), 'typed in the Method Editor');
  const menuAt = async () => {
    const pt = await p.evaluate((id) => { const ta = document.getElementById(id); ta.focus(); const r = ta.getBoundingClientRect(); return { x: r.x + 120, y: r.y + 60 }; }, ID);
    await p.mouse.click(pt.x, pt.y, { button: 'right' });
    return p.waitForSelector('#editor-menu-undo', { timeout: 3000 }).catch(() => null);
  };
  let item = await menuAt();
  expect(!!item && !!(await p.$('#editor-menu-redo')), 'its right-click menu: Undo and Redo');
  if (item) await item.click();
  await h.sleep(500);
  // (as Ctrl+Z in this editor: the last key typed)
  const undone = await text();
  expect(undone.startsWith('undoM') && !undone.startsWith('undoMe') && undone.slice(5) === original, `Undo: the last typing taken back (${JSON.stringify(undone.slice(0, 20))})`);
  item = await menuAt();
  if (item) await p.click('#editor-menu-redo');
  await h.sleep(500);
  expect((await text()).startsWith('undoMe'), 'Redo: put in again');

  // 2. The Diff popup: Ctrl+wheel over it makes its text bigger; Ctrl+0 back to 100%
  await p.click('#method-diff-btn');
  await p.waitForSelector('#diff-body', { timeout: 3000 }).catch(() => {});
  const size = () => p.evaluate(() => ({ px: parseFloat(document.getElementById('diff-body')?.style.fontSize || '0'), label: document.getElementById('diff-zoom')?.textContent.trim() }));
  const s0 = await size();
  const box = await p.evaluate(() => { const r = document.getElementById('diff-body').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 40 }; });
  await p.mouse.move(box.x, box.y);
  await p.keyboard.down('Control');
  for (let i = 0; i < 3; i++) { await p.mouse.wheel({ deltaY: -100 }); await h.sleep(80); }
  await p.keyboard.up('Control');
  await h.sleep(300);
  const s1 = await size();
  expect(s0.label === '100%' && s1.px > s0.px && s1.label === '130%', `Ctrl+wheel: the text bigger (${s0.label} ${s0.px}px -> ${s1.label} ${s1.px}px)`);
  const pageZoom = await p.evaluate(() => window.devicePixelRatio);
  expect(pageZoom === 1, `the page itself not zoomed (${pageZoom})`);
  await p.keyboard.down('Control'); await p.keyboard.press('0'); await p.keyboard.up('Control');
  await h.sleep(300);
  expect((await size()).label === '100%', `Ctrl+0: 100% (${(await size()).label})`);
  await p.keyboard.press('Escape');
  await h.sleep(300);

  // 3. The canvas: a state moved, its right-click menu's Undo puts it back
  await p.click('#dock-tab-diagram').catch(() => {});
  await h.sleep(500);
  const S = 'TABLEMANAGER_HALT_FEED';
  await p.evaluate((s) => [...document.getElementById(`state-list-item-${s}`).querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click(), S);
  await h.sleep(1500);
  const at = () => p.evaluate((s) => { const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${s}"]`); const r = n?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, S);
  const a0 = await at();
  await p.mouse.move(a0.x, a0.y);
  await p.mouse.down();
  await p.mouse.move(a0.x + 90, a0.y + 50, { steps: 8 });
  await p.mouse.up();
  await h.sleep(800);
  const a1 = await at();
  expect(Math.hypot(a1.x - a0.x, a1.y - a0.y) > 40, `${S} moved`);
  // (an empty spot of the drawing: no state, edge or label under it, nor the minimap)
  const empty = await p.evaluate(() => {
    // (anywhere in the drawing's area, the chart's empty parts or around it: no state, edge, label or handle there)
    const area = document.getElementById('mermaid-canvas-area');
    const r = area.getBoundingClientRect();
    for (let fy = 0.08; fy < 0.92; fy += 0.04) for (let fx = 0.08; fx < 0.75; fx += 0.04) {
      const x = r.x + r.width * fx, y = r.y + r.height * fy;
      const ok = [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]].every(([dx, dy]) => { const e = document.elementFromPoint(x + dx, y + dy); return e && area.contains(e) && !e.closest('g.node, g.edgeLabel, g.edgePaths, g.cluster, path, line, polyline, text, foreignObject, .tc-edge-handle, button, [id*="minimap"]'); });
      if (ok && x > 0 && y > 0 && x < innerWidth && y < innerHeight) return { x, y };
    }
    return { x: r.x + 5, y: r.y + 5 };
  });
  await p.mouse.click(empty.x, empty.y);
  await h.sleep(200);
  await p.mouse.click(empty.x, empty.y, { button: 'right' });
  const undo = await p.waitForSelector('#context-menu-undo-btn', { timeout: 3000 }).catch(() => null);
  expect(!!undo, `the canvas's right-click menu: Undo (${await p.evaluate(() => [...document.querySelectorAll('[id^=context-menu-]')].map((e) => e.id).slice(0, 12).join(', '))})`);
  if (undo) await undo.click();
  await h.sleep(1500);
  const a2 = await at();
  expect(!!a2 && Math.hypot(a2.x - a0.x, a2.y - a0.y) < 4, `Undo: ${S} back where it was (${a2 ? `${(a2.x - a0.x).toFixed(1)},${(a2.y - a0.y).toFixed(1)} off` : 'gone'})`);
  await p.mouse.click(empty.x, empty.y, { button: 'right' });
  expect(!!(await p.waitForSelector('#context-menu-redo-btn', { timeout: 3000 }).catch(() => null)), 'then Redo in it');
  await p.keyboard.press('Escape');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
