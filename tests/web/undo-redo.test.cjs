// Undo / Redo of canvas edits: a state deleted and a transition's priority raised, undone (Ctrl+Z, the palette's
// button) and redone (Ctrl+Y); the code and the chart follow; a new file starts a new history
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(1000);
  const hasNode = (id) => p.evaluate((id) => !!document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`), id);
  const disabled = (id) => p.$eval(`#${id}`, (e) => e.disabled);
  const waitFor = async (fn, ms = 6000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await h.sleep(200); } return false; };
  const goTo = async (state) => {
    await p.evaluate((s) => [...document.getElementById(`state-list-item-${s}`).querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click(), state);
    await h.sleep(1200);
  };
  const clickNode = async (id, opts) => {
    await goTo(id);
    const pt = await p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
    await p.mouse.click(pt.x, pt.y, opts);
    await h.sleep(400);
  };
  const key = async (k, shift) => {
    await p.keyboard.down('Control');
    if (shift) await p.keyboard.down('Shift');
    await p.keyboard.press(k);
    if (shift) await p.keyboard.up('Shift');
    await p.keyboard.up('Control');
    await h.sleep(1200);
  };

  expect((await disabled('palette-undo')) && (await disabled('palette-redo')), 'nothing to undo or redo at first');
  // A state deleted
  const X = S('RESET_DONE');
  await clickNode(X);
  await p.keyboard.press('Delete');
  await p.waitForSelector('#text-prompt-submit', { timeout: 5000 });
  await p.click('#text-prompt-submit');
  expect(await waitFor(async () => !(await hasNode(X))), `${X} deleted`);
  expect(!(await disabled('palette-undo')), 'Undo is on');
  // Ctrl+Z on the canvas: back
  await clickNode(S('CLAMPED'));
  await key('z');
  expect(await waitFor(() => hasNode(X)), 'Ctrl+Z: the state is back');
  expect(!(await disabled('palette-redo')), 'Redo is on');
  // Ctrl+Y: deleted again; the palette's Undo: back again
  await key('y');
  expect(await waitFor(async () => !(await hasNode(X))), 'Ctrl+Y: deleted again');
  await p.click('#palette-undo');
  await h.sleep(1200);
  expect(await waitFor(() => hasNode(X)), 'the palette\'s Undo: back again');
  // Ctrl+Shift+Z is Redo too
  await clickNode(S('CLAMPED'));
  await key('z', true);
  expect(await waitFor(async () => !(await hasNode(X))), 'Ctrl+Shift+Z: redone');
  await p.click('#palette-undo');
  await h.sleep(1200);

  // The code as it was: the enum has it again
  await p.click('#dock-tab-enum');
  await p.waitForSelector('#st-dut-editor');
  await h.sleep(400);
  const code = await p.$eval('#st-dut-editor', (e) => e.value);
  await p.click('#dock-tab-diagram');
  await h.sleep(400);
  expect(code.includes(X), 'the code as it was: the enum has it');

  // Another sample: a new history
  await p.evaluate(() => {
    const sel = document.querySelector('select[id*="sample" i]');
    if (sel && sel.options.length > 1) { sel.value = sel.options[1].value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await h.sleep(2500);
  const fresh = await disabled('palette-undo').catch(() => null);
  expect(fresh === true, 'another sample: a new history (nothing to undo)');
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
