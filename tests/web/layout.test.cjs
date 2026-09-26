const h = require('../lib/harness.cjs');
// Layout items: one RightPanel group, minimap / legend as canvas overlays, old layout upgrade, status bar,
// Follow selection, focus mode, XAE's own compact layout
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
  const ready = () => page.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 30000 });
  const rightTabs = () => page.$$eval('#right-dock-panel [id^="dock-tab-"]', (t) => t.map((x) => x.id.replace('dock-tab-', '')));

  // 1. Old (revision 1) layout with the three RightPanel groups: upgraded once
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('tc_statechart_dock_layout_v1', JSON.stringify({
      version: 1,
      middle: { groups: [{ id: 'middle-main', tabs: ['diagram', 'method', 'enum', 'complexity', 'frequency', 'history'], active: 'diagram', size: 1 }], floating: [] },
      right: { groups: [
        { id: 'right-inspector', tabs: ['docs', 'problems', 'live', 'markdown'], active: 'docs', size: 1.3 },
        { id: 'right-search', tabs: ['search', 'stats', 'heatmap', 'legend', 'notes'], active: 'search', size: 1.2 },
        { id: 'right-minimap', tabs: ['minimap'], active: 'minimap', size: 0.6 },
      ], floating: [] },
      leftWidth: 330, rightWidth: 420, leftVisible: true, rightVisible: true, lastGroup: {},
      knownTabs: ['diagram', 'method', 'enum', 'complexity', 'frequency', 'history', 'docs', 'problems', 'live', 'markdown', 'search', 'stats', 'heatmap', 'legend', 'notes', 'minimap'],
    }));
  });
  await page.reload({ waitUntil: 'load' });
  await ready();
  await sleep(800);
  const groups = await page.$$eval('#right-dock-panel [data-dock-group], #right-dock-panel .dock-group', (g) => g.length).catch(() => -1);
  const tabs = await rightTabs();
  expect(!tabs.includes('minimap') && !tabs.includes('legend') && tabs.includes('changes') && tabs.includes('paths'), `RightPanel tabs: ${tabs.join(', ')}`);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tc_statechart_dock_layout_v1')));
  expect(saved.revision === 2 && saved.right.groups.length === 1 && saved.leftWidth === 330, `old layout upgraded: ${saved.right.groups.length} RightPanel group, left width kept (${saved.leftWidth})`);
  expect(!!(await page.$('#diagram-minimap-container, #diagram-minimap-collapsed')), 'minimap is a canvas overlay');

  // 2. Status bar
  const bar = await page.$eval('#status-bar', (e) => e.textContent).catch(() => null);
  expect(!!bar && /34 states/.test(bar) && /Web/.test(bar) && /SM_TableManager/.test(bar), `status bar: "${bar}"`);

  // 3. Follow selection: a state shows Documentation, a transition's first click opens its guard window
  await page.click('#dock-tab-search');
  await sleep(300);
  const np = await page.evaluate(() => {
    const n = document.querySelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]');
    n.scrollIntoView?.();
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + Math.min(8, r.height / 3) };
  });
  await page.mouse.click(np.x, np.y);
  await sleep(800);
  const docsActive = await page.$eval('#dock-tab-docs', (e) => e.getAttribute('aria-selected') === 'true' || /active|selected/.test(e.className)).catch(() => false);
  expect(docsActive, 'selecting a state brings Documentation forward');
  await page.evaluate(() => {
    const l = [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].find((e) => e.getAttribute('data-from') === 'TABLEMANAGER_HOMMING_READY_TO_START' && e.getAttribute('data-to') === 'TABLEMANAGER_HOMMING');
    l.scrollIntoView?.();
  });
  const lp = await page.evaluate(() => {
    const l = [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].find((e) => e.getAttribute('data-from') === 'TABLEMANAGER_HOMMING_READY_TO_START' && e.getAttribute('data-to') === 'TABLEMANAGER_HOMMING');
    const r = l.getBoundingClientRect();
    for (let fx = 0.5; fx < 0.95; fx += 0.1) for (let fy = 0.5; fy < 0.95; fy += 0.1) { const x = r.x + r.width * fx, y = r.y + r.height * fy; if (document.elementFromPoint(x, y)?.closest('g.edgeLabel') === l) return { x, y }; }
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(lp.x, lp.y);
  await sleep(900);
  expect(!!(await page.$('#guard-inspector-show-in-xae-btn, [id^="guard-inspector"], #transition-guard-inspector')), 'first click on a transition opens its guard window');
  await page.screenshot({ path: path.join(h.OUT, 'layout-default.png') });

  // 4. Focus mode
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 990);
  await page.keyboard.press('z');
  await sleep(600);
  const focus = await page.evaluate(() => ({
    header: document.getElementById('app-header')?.offsetParent !== null,
    right: !!document.getElementById('right-panel'),
    bar: !!document.getElementById('status-bar'),
    exit: !!document.getElementById('exit-focus-mode-btn'),
    canvasWidth: document.getElementById('mermaid-canvas-area')?.getBoundingClientRect().width,
  }));
  expect(!focus.header && !focus.right && !focus.bar && focus.exit && focus.canvasWidth > 1500, `focus mode: ${JSON.stringify(focus)}`);
  await page.screenshot({ path: path.join(h.OUT, 'layout-focus.png') });
  await page.keyboard.press('Escape');
  await sleep(500);
  const back = await page.evaluate(() => ({ header: document.getElementById('app-header')?.offsetParent !== null, right: !!document.getElementById('right-panel') }));
  expect(back.header && back.right, 'Esc leaves focus mode and restores the panels');

  // 5. XAE: its own compact layout (fake bridge)
  const xae = await browser.newPage();
  await xae.evaluateOnNewDocument(() => {
    window.chrome = window.chrome || {};
    window.chrome.webview = { postMessage: () => {}, addEventListener: () => {}, removeEventListener: () => {} };
  });
  await xae.goto(h.APP_URL, { waitUntil: 'load' });
  await sleep(1500);
  const x = await xae.evaluate(() => ({
    left: !!document.getElementById('left-panel') && document.getElementById('left-panel').offsetWidth > 0,
    key: !!localStorage.getItem('tc_statechart_dock_layout_v1_xae'),
  }));
  expect(!x.left && x.key, `XAE: compact layout (no left panel), stored separately ${JSON.stringify(x)}`);
  console.log('page errors:', errors);
  await browser.close().catch(() => {});
  edge.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
