// Clicking a state on the canvas selects it and leaves the layout alone: the Method Editor is not brought forward,
// the canvas does not move; the Method Editor shows the selected state when it is opened
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser();
  const page = await browser.newPage();
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 60000 });
  await h.sleep(800);
  const state = () => page.evaluate(() => {
    const active = [...document.querySelectorAll('[id^="dock-tab-"]')].filter((t) => t.getAttribute('aria-selected') === 'true' || /active/.test(t.className)).map((t) => t.id.replace('dock-tab-', ''));
    const canvas = document.getElementById('mermaid-canvas-area').getBoundingClientRect();
    const node = document.querySelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_CLAMPED"]').getBoundingClientRect();
    return { active, canvas: [canvas.x, canvas.width].map(Math.round).join(','), node: [node.x, node.y].map(Math.round).join(','), selected: document.querySelector('#mermaid-canvas-area g.node.diagram-selected-node')?.getAttribute('data-state-id') };
  });
  const before = await state();
  const p = await page.evaluate(() => {
    const n = document.querySelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_CLAMPED"]');
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(p.x, p.y);
  await h.sleep(800);
  const after = await state();
  expect(after.selected === 'TABLEMANAGER_CLAMPED', `the state is selected (${after.selected})`);
  expect(!after.active.includes('method') && after.active.includes('diagram'), `the Method Editor is not brought forward (active: ${after.active.join(', ')})`);
  expect(after.canvas === before.canvas && after.node === before.node, `the canvas and the node stay where they were (${before.node} -> ${after.node})`);
  // Opened by hand, the Method Editor shows the selected state's code
  await page.click('#dock-tab-method');
  await h.sleep(800);
  const code = await page.$eval('#method-implementation-editor', (e) => e.value).catch(() => '');
  expect(/TABLEMANAGER_CLAMPED/.test(code), 'the Method Editor, opened, is on the selected state');

  // Identified States: with Follow off a click selects without moving the canvas; Go to State centers it
  await page.click('#dock-tab-diagram');
  await h.sleep(500);
  const nodeAt = (id) => page.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`).getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)}`; }, id);
  const clickItem = (id) => page.evaluate((id) => document.getElementById(`state-list-item-${id}`).click(), id);
  const goToState = (id) => page.evaluate((id) => [...document.getElementById(`state-list-item-${id}`).querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent)).click(), id);
  expect(!(await page.$eval('#states-live-follow-toggle', (e) => e.checked)), 'Follow is off');
  let n0 = await nodeAt('TABLEMANAGER_AUTOFEED_IDLE');
  await clickItem('TABLEMANAGER_AUTOFEED_IDLE');
  await h.sleep(1200);
  let s = await state();
  expect(s.selected === 'TABLEMANAGER_AUTOFEED_IDLE' && (await nodeAt('TABLEMANAGER_AUTOFEED_IDLE')) === n0, `a list click selects it (${s.selected}) and the canvas stays put`);
  const beforeGo = await nodeAt('TABLEMANAGER_AUTOFEED_IDLE');
  await goToState('TABLEMANAGER_REFEED_START');
  await h.sleep(1500);
  expect((await state()).selected === 'TABLEMANAGER_REFEED_START' && (await nodeAt('TABLEMANAGER_AUTOFEED_IDLE')) !== beforeGo, 'Go to State centers the state (the canvas moves)');
  // Follow on: a list click centers it too
  await page.click('#states-live-follow-toggle');
  await h.sleep(300);
  const n1 = await nodeAt('TABLEMANAGER_AUTOFEED_IDLE');
  await clickItem('TABLEMANAGER_DISABLED');
  await h.sleep(1500);
  expect((await state()).selected === 'TABLEMANAGER_DISABLED' && (await nodeAt('TABLEMANAGER_AUTOFEED_IDLE')) !== n1, 'with Follow on, a list click centers the state');
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
