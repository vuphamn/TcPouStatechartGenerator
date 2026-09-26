const h = require('../lib/harness.cjs');
// Web edition: several StateScope tabs, each with its own POU; notes per POU, shared between tabs of the same POU
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const URL_ = h.APP_URL;
const TM = 'tc_statechart_diagram_notes_metadata:SM_TableManager.TcPOU';
const DD = 'tc_statechart_diagram_notes_metadata:SM_DoorDasher.TcPOU';

(async () => {
  const edge = { kill() {} }; // (the harness launches the browser)
  let b; b = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const errors = [];
  const open = async () => {
    const p = await b.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(URL_, { waitUntil: 'load' });
    await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
    await sleep(600);
    return p;
  };
  const addNote = async (p, stateId, text) => {
    await p.bringToFront();
    // The state if it is on screen, else the first state of that POU that is (the diagram may be larger than the view)
    const pt = await p.evaluate((id) => {
      const area = document.getElementById('mermaid-canvas-area').getBoundingClientRect();
      const prefix = id.split('_')[0];
      const nodes = [document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`), ...document.querySelectorAll(`#mermaid-canvas-area g.node[data-state-id^="${prefix}"]`)];
      for (const n of nodes) {
        if (!n) continue;
        const r = n.getBoundingClientRect();
        const x = r.x + r.width / 2, y = r.y + Math.min(8, r.height / 3);
        if (x > area.left + 20 && x < area.right - 20 && y > area.top + 60 && y < area.bottom - 20 && n.contains(document.elementFromPoint(x, y))) return { x, y };
      }
      return null;
    }, stateId);
    if (!pt) throw new Error(`no ${stateId.split('_')[0]} state on screen`);
    await p.mouse.click(pt.x, pt.y, { button: 'right' });
    await sleep(400);
    await p.click('#context-menu-add-note-btn');
    await p.waitForSelector('#note-textarea', { timeout: 5000 });
    await p.type('#note-textarea', text);
    await p.click('#note-dialog-save-btn');
    await sleep(600);
  };
  const stored = (p, key) => p.evaluate((key) => localStorage.getItem(key) || '', key);
  const shows = (p, text) => p.evaluate((t) => document.getElementById('mermaid-canvas-area')?.innerText.includes(t) || document.body.innerHTML.includes(t), text);

  // A fresh profile, with notes in the old single block (before notes were kept per POU)
  const a = await open();
  await a.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('tc_statechart_diagram_notes_metadata', JSON.stringify({ nodes: { TABLEMANAGER_CLAMPED: 'legacy clamp note' }, edges: {} }));
  });
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
  await sleep(800);
  expect(/legacy clamp note/.test(await stored(a, TM)) && !(await a.evaluate(() => localStorage.getItem('tc_statechart_diagram_notes_metadata'))), 'old notes moved to the Table Manager POU that they fit');
  expect(await shows(a, 'legacy clamp note'), 'and shown on its diagram');
  expect((await a.title()) === 'SM_TableManager - Kval StateScope', `tab title: "${await a.title()}"`);

  // Tab A: a note on Table Manager
  await addNote(a, 'TABLEMANAGER_HOMMING', 'homing note A');
  expect(/homing note A/.test(await stored(a, TM)), 'tab A: note saved for SM_TableManager');

  // Tab B: Door Dasher (it starts on Table Manager, the default sample)
  const bTab = await open();
  await bTab.select('#sample-selector', 'door-dasher-237');
  await bTab.waitForFunction(() => document.querySelector('#mermaid-canvas-area g.node[data-state-id^="DOOR_DASHER"]'), { timeout: 30000 });
  await sleep(800);
  expect(!(await shows(bTab, 'homing note A')), 'tab B (Door Dasher): no Table Manager note');
  await addNote(bTab, 'DOOR_DASHER_DISABLED', 'dasher note B');
  expect(/dasher note B/.test(await stored(bTab, DD)) && !/dasher note B/.test(await stored(bTab, TM)), 'tab B: note saved for SM_DoorDasher only');
  expect(/homing note A/.test(await stored(bTab, TM)) && /legacy clamp note/.test(await stored(bTab, TM)), 'switching sample did not overwrite the Table Manager notes');
  expect((await bTab.title()) === 'SM_DoorDasher - Kval StateScope', `tab B title: "${await bTab.title()}"`);

  // Tab C: Table Manager too: shows A's notes, and picks up a new one without reloading
  const c = await open();
  expect(await shows(c, 'homing note A'), 'tab C (Table Manager): shows tab A\'s note');
  await addNote(a, 'TABLEMANAGER_HALT_FEED', 'halt note A2');
  await c.bringToFront();
  await sleep(800);
  expect(await shows(c, 'halt note A2'), 'tab C picked up the note added in tab A (same POU), without reloading');
  expect(!(await shows(bTab, 'halt note A2')), 'tab B (another POU) did not');

  // Tab B back to Table Manager: its notes come back
  await bTab.bringToFront();
  await bTab.select('#sample-selector', 'table-manager-202');
  await bTab.waitForFunction(() => document.querySelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]'), { timeout: 30000 });
  await sleep(800);
  expect(await shows(bTab, 'homing note A') && /dasher note B/.test(await stored(bTab, DD)), 'switching back restores the POU\'s notes; Door Dasher\'s are kept');

  // Window menu: New Tab
  await a.bringToFront();
  const opened = new Promise((r) => b.once('targetcreated', (t) => r(t.url())));
  await a.click('#window-menu-btn').catch(async () => {
    await a.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Window'))?.click());
  });
  await sleep(300);
  await a.evaluate(() => [...document.querySelectorAll('button, [role="menuitem"]')].find((x) => /New Tab/.test(x.textContent))?.click());
  const url = await Promise.race([opened, sleep(4000).then(() => null)]);
  expect(url && url.startsWith(URL_), `Window > New Tab opens another StateScope: ${url}`);

  console.log('page errors:', errors.slice(0, 5));
  await b.close().catch(() => {}); edge.kill();
  console.log(`${fails} failures`); process.exit(fails ? 1 : 0);
})();
