const h = require('../lib/harness.cjs');
// POU Editor tab: declaration on top, body below; caret line, zoom, find, fold, save (Ctrl+S), reset, split
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const edge = { kill() {} }; // (the harness launches the browser)
  let browser;
  browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  // A layout saved before this tab existed: the tab is added next to the Method Editor
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('tc_statechart_dock_layout_v1', JSON.stringify({ version: 1, revision: 2, middle: { groups: [{ id: 'middle-main', tabs: ['diagram', 'method', 'enum'], active: 'diagram', size: 1 }], floating: [] }, right: { groups: [{ id: 'right-main', tabs: ['docs'], active: 'docs', size: 1 }], floating: [] }, leftWidth: 400, rightWidth: 400, leftVisible: true, rightVisible: true, lastGroup: {}, knownTabs: ['diagram', 'method', 'enum', 'docs'] }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 30000 });
  const tabs = await page.$$eval('[id^="dock-tab-"]', (t) => t.map((x) => x.id.replace('dock-tab-', '')));
  expect(tabs.indexOf('pou') === tabs.indexOf('method') - 1, `a saved layout gets the tab before the Method Editor: ${tabs.slice(0, 5).join(', ')}`);
  // A layout saved with the POU Editor after the Method Editor: moved before it once
  await page.evaluate(() => {
    localStorage.setItem('tc_statechart_dock_layout_v1', JSON.stringify({ version: 1, revision: 2, middle: { groups: [{ id: 'middle-main', tabs: ['diagram', 'method', 'pou', 'enum'], active: 'diagram', size: 1 }], floating: [] }, right: { groups: [{ id: 'right-main', tabs: ['docs'], active: 'docs', size: 1 }], floating: [] }, leftWidth: 400, rightWidth: 400, leftVisible: true, rightVisible: true, lastGroup: {}, knownTabs: ['diagram', 'method', 'pou', 'enum', 'docs'] }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
  let order = await page.$$eval('[id^="dock-tab-"]', (x) => x.map((e) => e.id.replace('dock-tab-', '')));
  expect(order.slice(0, 4).join() === 'diagram,pou,method,enum', `saved with it after the Method Editor: moved before (${order.slice(0, 4).join(', ')})`);
  // ...once: moved back by the user, it stays there
  await page.evaluate(() => {
    const l = JSON.parse(localStorage.getItem('tc_statechart_dock_layout_v1'));
    l.middle.groups[0].tabs = ['diagram', 'method', 'pou', 'enum'];
    localStorage.setItem('tc_statechart_dock_layout_v1', JSON.stringify(l));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
  order = await page.$$eval('[id^="dock-tab-"]', (x) => x.map((e) => e.id.replace('dock-tab-', '')));
  expect(order.slice(0, 4).join() === 'diagram,method,pou,enum', `a place the user chose afterwards is kept (${order.slice(0, 4).join(', ')})`);
  await page.click('#dock-tab-pou');
  await page.waitForSelector('#pou-declaration-editor', { timeout: 10000 });
  await sleep(400);
  const title = await page.$eval('#dock-tab-pou', (e) => e.textContent.trim());
  const decl = await page.$eval('#pou-declaration-editor', (e) => e.value);
  const impl = await page.$eval('#pou-implementation-editor', (e) => e.value);
  const head = await page.$eval('#pou-editor', (e) => e.innerText.split('\n').slice(0, 6).join(' | '));
  expect(/POU Editor/.test(title) && /^FUNCTION_BLOCK SM_TableManager EXTENDS KvalStateMachineBase/.test(decl.trim()) && /VAR_INPUT[\s\S]*END_VAR/.test(decl) && !/METHOD /.test(decl), `declaration on top: "${decl.trim().split('\n')[0]}" (${decl.split('\n').length} lines, VAR_INPUT ... END_VAR)`);
  expect(!/METHOD /.test(impl) && impl.length > 0, `the body below (${impl.split('\n').length} lines): "${impl.trim().split('\n')[0]}"`);
  expect(/FUNCTION_BLOCK/.test(head) && /EXTENDS/.test(head), `header: ${head}`);
  // Caret line in both panels
  await page.evaluate(() => { const ta = document.getElementById('pou-declaration-editor'); ta.focus(); ta.setSelectionRange(40, 40); });
  await sleep(150);
  const band = await page.$('#pou-declaration-editor-caret-line');
  expect(!!band, 'the caret line is highlighted in the declaration');
  // Zoom (shared with the other editors)
  const box = await page.evaluate(() => { const b = document.getElementById('pou-declaration-editor').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel({ deltaY: -100 });
  await page.keyboard.up('Control');
  await sleep(250);
  const z = await page.evaluate(() => [getComputedStyle(document.getElementById('pou-declaration-editor')).fontSize, getComputedStyle(document.getElementById('pou-implementation-editor')).fontSize]);
  expect(z[0] === '13.2px' && z[1] === '13.2px', `Ctrl+wheel zooms both panels: ${z.join(', ')}`);
  await page.keyboard.down('Control'); await page.keyboard.press('Digit0'); await page.keyboard.up('Control');
  // Find in both panels
  await page.click('#pou-editor-find');
  await page.keyboard.type('END_VAR');
  await sleep(200);
  const count = await page.$eval('#pou-editor-find-count', (e) => e.textContent).catch(() => '');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await sleep(200);
  const count2 = await page.$eval('#pou-editor-find-count', (e) => e.textContent).catch(() => '');
  expect(/^1\/[2-9]\d*$/.test(count) && /^2\//.test(count2), `find END_VAR: ${count}, Enter, Enter: ${count2}`);
  await page.click('#pou-editor-find', { clickCount: 3 });
  await page.keyboard.press('Escape');
  // Edit the declaration and save with Ctrl+S
  await page.evaluate(() => { const ta = document.getElementById('pou-declaration-editor'); ta.focus(); const end = ta.value.indexOf('END_VAR'); ta.setSelectionRange(end, end); });
  await page.keyboard.type('\tbTestFromPouEditor : BOOL;\n');
  await sleep(150);
  const unsaved = await page.$eval('#pou-editor-state', (e) => e.textContent);
  expect(/Unsaved/.test(unsaved), `edited: "${unsaved}"`);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyS'); await page.keyboard.up('Control');
  await sleep(500);
  const saved = await page.$eval('#pou-editor-state', (e) => e.textContent);
  expect(/Saved to SM_TableManager/.test(saved), `Ctrl+S: "${saved}"`);
  // The Method Editor still shows doState, and the POU has the new variable
  await page.click('#dock-tab-method');
  await page.waitForSelector('#method-declaration-editor');
  await sleep(400);
  const mdecl = await page.$eval('#method-declaration-editor', (e) => e.value);
  expect(/METHOD doState/.test(mdecl), 'the Method Editor still shows doState()');
  await page.click('#dock-tab-pou');
  await sleep(300);
  expect((await page.$eval('#pou-declaration-editor', (e) => e.value)).includes('bTestFromPouEditor : BOOL;'), 'the saved declaration is shown again');
  // Reset undoes unsaved edits
  await page.evaluate(() => { const ta = document.getElementById('pou-implementation-editor'); ta.focus(); ta.setSelectionRange(0, 0); });
  await page.keyboard.type('// scratch\n');
  await sleep(100);
  await page.click('#pou-editor-reset');
  await sleep(200);
  expect(!(await page.$eval('#pou-implementation-editor', (e) => e.value)).includes('// scratch') && /Saved to|SM_TableManager/.test(await page.$eval('#pou-editor-state', (e) => e.textContent)), 'Reset drops unsaved edits');
  // Fold all
  await page.evaluate(() => [...document.querySelectorAll('#pou-editor button')].find((b) => b.textContent.trim() === 'Fold All')?.click());
  await sleep(200);
  // Split: drag the separator down
  const sep = await page.evaluate(() => { const b = document.querySelector('#pou-editor [role="separator"]').getBoundingClientRect(); return { x: b.x + 100, y: b.y + 2 }; });
  const h0 = await page.$eval('#pou-declaration-editor', (e) => e.getBoundingClientRect().height);
  await page.mouse.move(sep.x, sep.y);
  await page.mouse.down();
  await page.mouse.move(sep.x, sep.y + 120, { steps: 5 });
  await page.mouse.up();
  await sleep(200);
  const h1 = await page.$eval('#pou-declaration-editor', (e) => e.getBoundingClientRect().height);
  expect(h1 > h0 + 80, `drag the separator: declaration ${Math.round(h0)} -> ${Math.round(h1)} px`);
  await page.screenshot({ path: path.join(h.OUT, 'pou-editor.png') });
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  console.log(`${fails} failures`);
  await browser.close().catch(() => {});
  edge.kill();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
