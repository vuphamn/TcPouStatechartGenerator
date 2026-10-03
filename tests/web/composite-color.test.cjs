// The composites' colour: Composites (next to Theme) changes all of them (sand by default, kept in this browser); a
// composite's title right-clicked: its own colour (a preset or a #hex), written as "// @color" on its {region} line in
// the enum; the Composites colour again takes it out. The other composites keep theirs; stateDiagram-v2 too
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;
const MIME = 'application/x-kss-statechart-element';

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  // (the reload at the end: the unsaved enum's leave-the-page question answered)
  p.on('dialog', (d) => d.accept().catch(() => {}));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(800);
  const goTo = async (state) => {
    await p.evaluate((s) => [...document.getElementById(`state-list-item-${s}`).querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click(), state);
    await h.sleep(1200);
  };
  const box = (id) => p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, id);
  const enumText = async () => {
    await p.click('#dock-tab-enum');
    await p.waitForSelector('#st-dut-editor');
    await h.sleep(400);
    const v = await p.$eval('#st-dut-editor', (e) => e.value);
    await p.click('#dock-tab-diagram');
    await h.sleep(800);
    return v;
  };
  // Two composites from the palette: Clamp around CLAMPED, Unclamp around UNCLAMP_START
  const addComposite = async (state, name) => {
    await goTo(state);
    // (a slow machine: the canvas may still be panning to it when its place is read: read again, dropped again)
    let prompt = null;
    for (let k = 0; k < 3 && !prompt; k++) {
      if (k) await h.sleep(800);
      const b = await box(state);
      await p.evaluate((x, y, MIME) => {
        const dt = new DataTransfer();
        dt.setData(MIME, 'composite');
        const el = document.elementFromPoint(x, y);
        for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
      }, b.x, b.y, MIME);
      prompt = await p.waitForSelector('#text-prompt-input', { timeout: 5000 }).catch(() => null);
    }
    if (!prompt) await p.waitForSelector('#text-prompt-input', { timeout: 1000 });
    await p.evaluate(() => document.getElementById('text-prompt-input').select());
    await p.keyboard.type(name);
    await p.keyboard.press('Enter');
    await h.sleep(1800);
  };
  await addComposite(S('CLAMPED'), 'Clamp');
  await addComposite(S('UNCLAMP_START'), 'Unclamp');
  // A composite's box: its border colour (flowchart: g.cluster > rect; stateDiagram-v2: its outer box) and its title's
  const look = (label) => p.evaluate((label) => {
    const c = [...document.querySelectorAll('#mermaid-canvas-area svg g.cluster, #mermaid-canvas-area svg .statediagram-cluster')].find((x) => (x.querySelector('.cluster-label')?.textContent ?? '').trim() === label);
    const r = c?.querySelector(':scope > rect, :scope > g > rect.outer');
    const t = c?.querySelector('.cluster-label :is(p, span, text)');
    if (!r) return null;
    const b = r.getBoundingClientRect();
    return { stroke: getComputedStyle(r).stroke, title: t ? getComputedStyle(t).color : '', x: b.x + b.width / 2, y: b.y + 1, titleAt: t ? (() => { const q = t.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })() : null };
  }, label);
  let a = await look('Clamp');
  let u = await look('Unclamp');
  expect(a?.stroke === 'rgb(200, 184, 138)' && u?.stroke === 'rgb(200, 184, 138)', `sand by default (${a?.stroke}, ${u?.stroke})`);

  // Composites: slate, for all of them, at once (no new drawing)
  const drawn = await p.evaluate(() => { const s = document.querySelector('#mermaid-canvas-area svg'); s.__mark = 1; return true; });
  await p.select('#composite-color-select', 'slate');
  await h.sleep(500);
  a = await look('Clamp');
  u = await look('Unclamp');
  const same = await p.evaluate(() => document.querySelector('#mermaid-canvas-area svg').__mark === 1);
  expect(drawn && a?.stroke === 'rgb(148, 163, 184)' && u?.stroke === 'rgb(148, 163, 184)' && same, `Composites: slate: both slate, the same drawing (${a?.stroke}, ${u?.stroke}, same: ${same})`);
  expect(await p.evaluate(() => localStorage.getItem('kss.compositeColor')) === 'slate', 'kept in this browser');

  // Clamp's title right-clicked: its menu, Colour: rose
  const menu = async (label, item) => {
    const l = await look(label);
    if (!l?.titleAt) return false;
    await p.mouse.click(l.titleAt.x, l.titleAt.y, { button: 'right' });
    const btn = await p.waitForSelector(`#context-menu-${item}`, { timeout: 4000 }).catch(() => null);
    if (!btn) return false;
    // (the item itself clicked, not the screen spot it was at: on CI's slow runner the menu was placed again between
    // and the click took the item below it)
    await p.evaluate((id) => document.getElementById(id)?.click(), `context-menu-${item}`);
    await h.sleep(1800);
    return true;
  };
  expect(await menu('Clamp', 'composite-color-rose'), "Clamp's title right-clicked: Colour: rose in its menu");
  let dut = await enumText();
  expect(/\{region "Clamp"\} \/\/ @color rose/.test(dut), `written on its {region} line (${(dut.match(/\{region "Clamp"\}[^\n]*/) ?? [''])[0]})`);
  a = await look('Clamp');
  u = await look('Unclamp');
  expect(a?.stroke === 'rgb(232, 160, 180)' && u?.stroke === 'rgb(148, 163, 184)', `Clamp rose, Unclamp still slate (${a?.stroke}, ${u?.stroke})`);
  expect(a?.title === 'rgb(242, 196, 208)', `its title too (${a?.title})`);

  // A #hex of its own
  if (await menu('Clamp', 'composite-color-custom')) {
    await p.waitForSelector('#text-prompt-input', { timeout: 5000 });
    await p.evaluate(() => document.getElementById('text-prompt-input').select());
    await p.keyboard.type('#3366cc');
    await p.keyboard.press('Enter');
    await h.sleep(1800);
  }
  a = await look('Clamp');
  dut = await enumText();
  expect(a?.stroke === 'rgb(51, 102, 204)' && /\{region "Clamp"\} \/\/ @color #3366cc/.test(dut), `Colour: custom #3366cc (${a?.stroke})`);

  // stateDiagram-v2: the same
  await p.click('#format-statediagram-btn');
  await h.sleep(3000);
  a = await look('Clamp');
  u = await look('Unclamp');
  expect(a?.stroke === 'rgb(51, 102, 204)' && u?.stroke === 'rgb(148, 163, 184)', `stateDiagram-v2: Clamp its own, Unclamp slate (${a?.stroke}, ${u?.stroke})`);
  await p.click('#format-flowchart-btn').catch(() => {});
  await h.sleep(3000);

  // The Composites colour again: its mark out of the enum
  expect(await menu('Clamp', 'composite-color-default'), 'its menu: The Composites colour');
  dut = await enumText();
  a = await look('Clamp');
  expect(!/@color/.test(dut) && a?.stroke === 'rgb(148, 163, 184)', `taken out: slate as the others (${a?.stroke})`);

  // After a reload: slate still
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(1500);
  expect((await p.$eval('#composite-color-select', (e) => e.value)) === 'slate', 'after a reload: Composites slate');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
