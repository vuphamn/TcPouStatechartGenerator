const h = require('../lib/harness.cjs');
// Enum Editor: a state clicked in the LeftPanel scrolls to its enum member and briefly highlights the line
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
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
  await sleep(500);

  const clickCard = (name) => page.evaluate((name) => {
    const els = [...document.querySelectorAll('#identified-states-scrollable-list *')].filter((e) => e.children.length === 0 && e.textContent.trim() === name);
    const el = els[0];
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    return true;
  }, name).then(async (found) => {
    if (!found) return false;
    const box = await page.evaluate((name) => {
      const el = [...document.querySelectorAll('#identified-states-scrollable-list *')].find((e) => e.children.length === 0 && e.textContent.trim() === name);
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, name);
    await page.mouse.click(box.x, box.y);
    return true;
  });
  // The editor's highlighted line (gutter), the member's line in the text, and whether it is in view
  const state = (editorId, member) => page.evaluate((editorId, member) => {
    const ta = document.querySelector(`#${editorId} textarea`) || document.querySelector(`textarea#${editorId}`) || document.getElementById(editorId)?.querySelector('textarea');
    if (!ta) return null;
    const lines = ta.value.split('\n');
    const line = lines.findIndex((l) => new RegExp(`^\\s*,?\\s*${member}\\b`).test(l)) + 1;
    let root = ta.parentElement;
    while (root && !root.querySelector('div.st-gutter-row')) root = root.parentElement;
    if (!root) return { line, highlighted: null, inView: false, scrollTop: Math.round(ta.scrollTop) };
    const hl = [...root.querySelectorAll('div')].find((d) => /bg-sky-500\/30/.test(d.className) && /ring-sky-400/.test(d.className));
    const lineTop = (line - 1) * 20;
    return { line, highlighted: hl ? parseInt(hl.innerText.replace(/\D+/g, ''), 10) : null, inView: lineTop >= ta.scrollTop && lineTop < ta.scrollTop + ta.clientHeight, scrollTop: Math.round(ta.scrollTop) };
  }, editorId, member);

  // 1. Enum Editor in its own tab group, beside the diagram: the jump happens right away
  await page.evaluate(() => {
    const key = 'tc_statechart_dock_layout_v1';
    const l = JSON.parse(localStorage.getItem(key));
    const main = l.middle.groups[0];
    main.tabs = main.tabs.filter((t) => t !== 'enum');
    main.active = 'diagram';
    main.size = 1;
    l.middle.groups = [main, { id: 'middle-enum', tabs: ['enum'], active: 'enum', size: 1 }];
    localStorage.setItem(key, JSON.stringify(l));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
  await page.waitForSelector('#st-dut-editor', { timeout: 10000 });
  await sleep(800);
  expect(await clickCard('TABLEMANAGER_AUTOFEED_OUTSTOP_SLOW'), 'clicked a state near the end of the enum');
  await sleep(700);
  let s = await state('st-dut-editor', 'TABLEMANAGER_AUTOFEED_OUTSTOP_SLOW');
  console.log('   ', JSON.stringify(s));
  expect(s && s.line > 0 && s.highlighted === s.line && s.inView && s.scrollTop > 0, `Structured Text: scrolled to line ${s?.line} and highlighted it`);
  await page.screenshot({ path: path.join(h.OUT, 'enum-jump.png'), clip: { x: 800, y: 60, width: 800, height: 700 } });
  await sleep(3000);
  s = await state('st-dut-editor', 'TABLEMANAGER_AUTOFEED_OUTSTOP_SLOW');
  expect(s && s.highlighted === null, 'the highlight clears after 3 s');
  // Another state: a new jump
  await clickCard('TABLEMANAGER_HOMMING');
  await sleep(700);
  s = await state('st-dut-editor', 'TABLEMANAGER_HOMMING');
  expect(s && s.highlighted === s.line && s.inView, `another state: line ${s?.line} highlighted`);

  // 2. Grid view: the row scrolls into view and flashes
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^\s*Grid/i.test(b.textContent) || b.title?.includes('Grid'))?.click());
  await sleep(500);
  await clickCard('TABLEMANAGER_REFEED_TO_OUTFEED');
  await sleep(900);
  const row = await page.evaluate(() => {
    const r = document.querySelector('tr[data-member="TABLEMANAGER_REFEED_TO_OUTFEED"]');
    if (!r) return null;
    const box = r.getBoundingClientRect();
    const sc = r.closest('.overflow-auto').getBoundingClientRect();
    return { flash: r.classList.contains('enum-row-flash'), inView: box.top >= sc.top && box.bottom <= sc.bottom };
  });
  expect(row && row.flash && row.inView, `grid: the row is in view and flashes (${JSON.stringify(row)})`);

  // 3. XML view
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /TcDUT XML/.test(b.textContent))?.click());
  await sleep(500);
  await clickCard('TABLEMANAGER_AUTOFEED_FEED_OUT_DONE');
  await sleep(900);
  s = await state('raw-tcdut-xml-editor', 'TABLEMANAGER_AUTOFEED_FEED_OUT_DONE');
  expect(s && s.line > 0 && s.highlighted === s.line && s.inView, `XML: line ${s?.line} highlighted and in view`);

  // 4. Same tab group as the diagram (the default): the jump waits until the Enum Editor is shown
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
  await page.click('#dock-tab-enum');
  await sleep(600);
  await clickCard('TABLEMANAGER_AUTOFEED_INSTOP_BACK_TO_STOP');
  await sleep(500);
  const diagramActive = await page.evaluate(() => !!document.querySelector('#mermaid-canvas-area') && document.querySelector('#mermaid-canvas-area').getBoundingClientRect().width > 0);
  await page.click('#dock-tab-enum');
  await sleep(900);
  s = await state('st-dut-editor', 'TABLEMANAGER_AUTOFEED_INSTOP_BACK_TO_STOP');
  expect(diagramActive && s && s.highlighted === s.line && s.inView, `hidden while selecting, then shown: line ${s?.line} highlighted (${JSON.stringify(s)})`);

  console.log('page errors:', errors.slice(0, 5));
  await browser.close().catch(() => {});
  edge.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
