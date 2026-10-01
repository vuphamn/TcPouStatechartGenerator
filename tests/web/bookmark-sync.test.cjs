// One bookmark for a state, wherever it is set: Ctrl+F2 on its member's line in the Enum Editor: its card in
// Identified States, its ribbon on the canvas, its CASE label in the Method Editor; set from Identified States /
// the canvas: its member's line in the Enum Editor; Ctrl+F2 on the Method Editor's CASE label: the Enum Editor too
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

  const cards = () => p.$$eval('[id^="state-bookmark-"]', (m) => m.map((x) => x.id.replace('state-bookmark-', '')).sort());
  const ribbons = () => p.$$eval('#mermaid-diagram-svg-container g.state-bookmark-marker', (m) => [...new Set(m.map((x) => x.getAttribute('data-state-id')))].sort());
  // An editor's bookmarked lines (its gutter) and the line of a text
  const gutter = (id, src) => p.evaluate((id, src) => {
    const ta = document.getElementById(id);
    if (!ta) return null;
    const line = ta.value.split('\n').findIndex((l) => new RegExp(src).test(l)) + 1;
    const box = ta.closest('.relative.flex-1.min-h-0.flex') ?? ta.parentElement?.parentElement;
    const marks = [...(box?.querySelectorAll('[data-bookmark-line]') ?? [])].map((e) => +e.getAttribute('data-bookmark-line'));
    return { line, marked: marks.includes(line) };
  }, id, src.source);
  const ctrlF2At = async (id, re) => {
    await p.evaluate((id, src) => {
      const ta = document.getElementById(id);
      ta.focus();
      const lines = ta.value.split('\n');
      const i = lines.findIndex((l) => new RegExp(src).test(l));
      const pos = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0) + 3;
      ta.setSelectionRange(pos, pos);
    }, id, re.source);
    await p.keyboard.down('Control'); await p.keyboard.press('F2'); await p.keyboard.up('Control');
    await h.sleep(600);
  };

  // 1. Ctrl+F2 on a member's line in the Enum Editor: the state's bookmark
  const S1 = 'TABLEMANAGER_HOMMING';
  const member = new RegExp(`^\\s*,?\\s*${S1}\\b`);
  const label = new RegExp(`^\\s*${S1}\\s*:`);
  await p.click('#dock-tab-enum');
  await p.waitForSelector('#st-dut-editor', { timeout: 10000 });
  await h.sleep(600);
  await ctrlF2At('st-dut-editor', member);
  expect((await gutter('st-dut-editor', member))?.marked, 'the Enum Editor: its line marked');
  expect((await cards()).includes(S1), `Identified States: its card's bookmark (${await cards()})`);
  await p.click('#dock-tab-diagram');
  await h.sleep(800);
  expect((await ribbons()).includes(S1), `the canvas: its ribbon (${await ribbons()})`);
  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-implementation-editor', { timeout: 10000 });
  await h.sleep(600);
  expect((await gutter('method-implementation-editor', label))?.marked, "the Method Editor: its CASE label's line marked");

  // 2. Ctrl+F2 on the Method Editor's CASE label: off everywhere (the Enum Editor too)
  await ctrlF2At('method-implementation-editor', label);
  expect(!(await cards()).includes(S1), 'off from the Method Editor: no card bookmark');
  await p.click('#dock-tab-enum');
  await h.sleep(500);
  expect(!(await gutter('st-dut-editor', member))?.marked, 'the Enum Editor: its line no longer marked');

  // 3. From Identified States (a card's menu): the Enum Editor's member line marked
  const S2 = 'TABLEMANAGER_CLAMPED';
  const card = await p.evaluate((s) => { const el = document.getElementById(`state-list-item-${s}`); el?.scrollIntoView({ block: 'center' }); const r = el?.getBoundingClientRect(); return r ? { x: r.x + 60, y: r.y + 12 } : null; }, S2);
  if (card) await p.evaluate((s) => document.getElementById(`state-list-item-${s}`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 400, button: 2 })), S2);
  const add = await p.waitForSelector('#state-list-bookmark-btn', { timeout: 3000 }).catch(() => null);
  expect(!!add, `its card's menu: Add bookmark (${await p.evaluate(() => [...document.querySelectorAll('[id*="context-menu"] [id], [role="menu"] [id]')].map((e) => e.id).slice(0, 8).join(', '))})`);
  if (add) await p.evaluate(() => document.getElementById('state-list-bookmark-btn')?.click());
  await h.sleep(600);
  expect((await cards()).includes(S2), `set from Identified States (${await cards()})`);
  expect((await gutter('st-dut-editor', new RegExp(`^\\s*,?\\s*${S2}\\b`)))?.marked, 'the Enum Editor: its member line marked');

  // 4. A click on a bookmark badge: off; on the margin's faint one: on (the editors, the canvas, Identified States)
  const S3 = 'TABLEMANAGER_HALT_FEED';
  // (Identified States: the faint one on, the mark off)
  await p.evaluate((s) => document.getElementById(`state-add-bookmark-${s}`)?.click(), S3);
  await h.sleep(400);
  expect((await cards()).includes(S3), `Identified States: a click on its faint bookmark: on (${await cards()})`);
  await p.evaluate((s) => document.getElementById(`state-bookmark-${s}`)?.click(), S3);
  await h.sleep(400);
  expect(!(await cards()).includes(S3), 'its bookmark clicked: off');
  // (the Enum Editor's margin)
  const memberS3 = new RegExp(`^\\s*,?\\s*${S3}\\b`);
  const lineOf = (id, re) => p.evaluate((id, src) => document.getElementById(id).value.split('\n').findIndex((l) => new RegExp(src).test(l)) + 1, id, re.source);
  const eLine = await lineOf('st-dut-editor', memberS3);
  await p.evaluate((n) => document.querySelector(`[data-bookmark-add-line="${n}"]`)?.click(), eLine);
  await h.sleep(400);
  expect((await cards()).includes(S3) && (await gutter('st-dut-editor', memberS3))?.marked, 'the Enum Editor: a click on its margin: on (the state too)');
  await p.evaluate((n) => document.querySelector(`[data-bookmark-line="${n}"]`)?.click(), eLine);
  await h.sleep(400);
  expect(!(await cards()).includes(S3), 'its mark clicked: off');
  // (the canvas: its ribbon clicked: off)
  await p.evaluate((s) => document.getElementById(`state-add-bookmark-${s}`)?.click(), S3);
  await p.click('#dock-tab-diagram');
  await h.sleep(800);
  await p.evaluate((s) => [...document.getElementById(`state-list-item-${s}`).querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click(), S3);
  await h.sleep(1500);
  const rib = await p.evaluate((s) => { const r = document.querySelector(`#mermaid-diagram-svg-container g.state-bookmark-marker[data-state-id="${s}"] path`)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 3 } : null; }, S3);
  expect(!!rib, 'the canvas: its ribbon');
  if (rib) await p.mouse.click(rib.x, rib.y);
  await h.sleep(500);
  expect(!(await cards()).includes(S3) && !(await ribbons()).includes(S3), `the canvas: its ribbon clicked: off (${await ribbons()})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
