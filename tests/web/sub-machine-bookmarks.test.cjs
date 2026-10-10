// A sub-machine state's bookmark (the KAnalogMeasure sample: KANALOGMEASURE_ENABLING calls readDiagnostics(), a state
// machine of its own): one bookmark by its name, wherever it is set. Ctrl+F2 on its member in the Enum Editor (the
// sub-machine's enum): its card inside the state's box in Identified States and its node on the canvas marked; a click
// on that card's bookmark: off there and in the Enum Editor; set from its card: the Enum Editor's member marked
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const P = 'KANALOGMEASURE_ENABLING';
const sub = (x) => `${P}__readDiagnostics__${x}`;
const S = 'DIAG_READ_START';

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await p.select('#sample-selector', 'k-analog-measure');
  await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${sub(S)}"]`, { timeout: 30000 }).catch(() => {});
  await h.sleep(1200);
  if (!(await p.$(`#state-list-item-${sub(S)}`))) {
    await p.click('#toggle-sidebar-btn').catch(() => {});
    await h.sleep(600);
  }

  const card = () => p.evaluate((id) => !!document.getElementById(`state-bookmark-${id}`), sub(S));
  const ribbon = () => p.evaluate((id) => !!document.querySelector(`#mermaid-canvas-area g.state-bookmark-marker[data-state-id="${id}"]`), sub(S));
  const stored = () => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('kss.bookmarks.')).map((k) => JSON.parse(localStorage.getItem(k)).states).flat());
  const member = new RegExp(`^\\s*,?\\s*${S}\\b`);
  const enumMarked = () => p.evaluate((src) => {
    const ta = document.getElementById('st-dut-editor');
    if (!ta) return null;
    const line = ta.value.split('\n').findIndex((l) => new RegExp(src).test(l)) + 1;
    const box = ta.closest('.relative.flex-1.min-h-0.flex') ?? ta.parentElement?.parentElement;
    return line > 0 && [...(box?.querySelectorAll('[data-bookmark-line]') ?? [])].some((e) => +e.getAttribute('data-bookmark-line') === line);
  }, member.source);
  const waitFor = async (get, ok, ms = 5000) => {
    let v = await get();
    for (let t = 0; t < ms && !ok(v); t += 250) { await h.sleep(250); v = await get(); }
    return v;
  };

  // 1. Ctrl+F2 on its member in the Enum Editor (its card selected: the sub-machine's enum shown)
  await p.click(`#state-list-item-${sub(S)}`);
  await h.sleep(600);
  await p.click('#dock-tab-enum').catch(() => {});
  await p.waitForSelector('#st-dut-editor', { timeout: 10000 }).catch(() => {});
  await h.sleep(800);
  const found = await p.evaluate((src) => {
    const ta = document.getElementById('st-dut-editor');
    const lines = ta?.value.split('\n') ?? [];
    const i = lines.findIndex((l) => new RegExp(src).test(l));
    if (i < 0) return false;
    ta.focus();
    const pos = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0) + 3;
    ta.setSelectionRange(pos, pos);
    return true;
  }, member.source);
  await p.keyboard.down('Control'); await p.keyboard.press('F2'); await p.keyboard.up('Control');
  await h.sleep(700);
  const e1 = await enumMarked();
  const c1 = await waitFor(card, (v) => v);
  await p.click('#dock-tab-diagram').catch(() => {});
  const r1 = await waitFor(ribbon, (v) => v);
  expect(found && e1 && c1 && r1 && (await stored()).includes(S), `set in the Enum Editor: its card and its node marked (member found ${found}, enum ${e1}, card ${c1}, canvas ${r1}, stored ${JSON.stringify(await stored())})`);

  // 2. Its card's bookmark clicked: off everywhere
  await p.click(`#state-bookmark-${sub(S)}`).catch(() => {});
  await h.sleep(600);
  const c2 = await card();
  const r2 = await waitFor(ribbon, (v) => !v);
  await p.click('#dock-tab-enum').catch(() => {});
  await h.sleep(700);
  const e2 = await enumMarked();
  expect(!c2 && !r2 && e2 === false && !(await stored()).includes(S), `removed on its card: off on the canvas and in the Enum Editor (card ${c2}, canvas ${r2}, enum ${e2})`);

  // 3. Set from its card's menu (right-click): the Enum Editor's member marked
  const box = await (await p.$(`#state-list-item-${sub(S)}`)).boundingBox();
  await p.mouse.click(box.x + 20, box.y + box.height / 2, { button: 'right' });
  await p.waitForSelector('#state-list-bookmark-btn', { timeout: 3000 }).catch(() => {});
  await p.click('#state-list-bookmark-btn').catch(() => {});
  await h.sleep(700);
  const e3 = await waitFor(enumMarked, (v) => v);
  expect((await card()) && e3 && (await stored()).filter((x) => x === S).length === 1, `set from its card: the Enum Editor's member marked (stored ${JSON.stringify(await stored())})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
