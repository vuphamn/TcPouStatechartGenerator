// XAE edition (stand-in bridge): PLC Symbols' type filter. At first the loaded POU's type (the instances of it under
// the root, searched level by level); another type's instance opens a new StateScope on it (openInstance with its
// type and path, the extension finds its POU in the PLC project)
const h = require('../lib/harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const R = 'MAIN.mainStateMachine';
const sm = (name, type, path) => ({ name, path, type, kind: 'struct', stateMachine: true });
const TREE = {
  [R]: { symbolType: 'FB_MainStateMachine', children: [
    { name: 'nCount', path: `${R}.nCount`, type: 'DINT', kind: 'value' },
    sm('smTableManager', 'SM_TableManager', `${R}.smTableManager`),
    { name: 'fbLine', path: `${R}.fbLine`, type: 'FB_Line', kind: 'struct' },
  ] },
  [`${R}.smTableManager`]: { symbolType: 'SM_TableManager', children: [] },
  [`${R}.fbLine`]: { symbolType: 'FB_Line', children: [
    sm('smTable2', 'Commander.SM_TableManager', `${R}.fbLine.smTable2`),
    sm('smDoor', 'SM_DoorDasher', `${R}.fbLine.smDoor`),
  ] },
  [`${R}.fbLine.smTable2`]: { symbolType: 'SM_TableManager', children: [] },
  [`${R}.fbLine.smDoor`]: { symbolType: 'SM_DoorDasher', children: [] },
};

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1500, height: 950 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const sent = [];
  const toApp = (m) => page.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  const sample = await page.evaluate(async () => {
    const mod = await import('/src/samples/samplesData.ts');
    const s = mod.SAMPLES[0];
    return { pou: s.pouContent, dut: s.dutContent };
  });
  const I = `${R}.smTableManager`;
  await page.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') {
      await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: 'C:\\proj\\SM_TableManager.TcPOU', content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] } });
    } else if (m.type === 'liveStart') {
      await toApp({ type: 'liveStatus', state: 'connected', message: `${I}.machineState on 5.1.2.3.1.1:851 (PLC Run)`, target: '5.1.2.3.1.1:851', plcState: 'Run', instance: I, instances: [I] });
      await toApp({ type: 'liveValues', events: [{ t: Date.now(), value: 2 }] });
    } else if (m.type === 'liveBrowse') {
      const n = TREE[m.path];
      await toApp(n ? { type: 'liveBrowseResult', requestId: m.requestId, path: m.path, symbolType: n.symbolType, kind: 'struct', children: n.children } : { type: 'liveBrowseResult', requestId: m.requestId, path: m.path, error: `${m.path} is not in the PLC` });
    } else if (m.type === 'liveWatch') {
      await toApp({ type: 'liveWatchResult', vars: m.vars.map((v) => ({ id: v.id, error: 'not in the PLC' })) });
    } else if (m.type === 'projectPous') {
      await toApp({ type: 'projectPous', project: 'P', pous: [], duts: [] });
    }
  });
  await page.evaluateOnNewDocument(() => {
    const listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = { postMessage: (m) => window.__hostPost(m), addEventListener: (t, fn) => listeners.push(fn), removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
    window.__fromHost = (m) => listeners.forEach((fn) => fn({ data: m }));
  });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 60000 });
  await sleep(800);
  await page.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await sleep(500);
  await page.click('#live-start-btn');
  await page.waitForSelector('#live-symbols-btn', { timeout: 20000 }).catch(() => {});
  await page.click('#live-symbols-btn');
  const set = (id, v) => page.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  const list = async () => {
    for (let i = 0; i < 50; i++) {
      await sleep(200);
      if (/^\d+ instances? of/.test(await page.$eval('#symbol-browser-search-status', (e) => e.textContent).catch(() => ''))) break;
    }
    return page.$$eval('.symbol-instance-row', (r) => r.map((x) => `${x.getAttribute('data-path')}${x.querySelector('.symbol-open-other') ? ':open' : x.querySelector('.symbol-watch') ? ':watch' : ':here'}`));
  };

  // 1. At first: the loaded POU's type, also a qualified one (Commander.SM_TableManager) two levels down
  const first = await list();
  expect((await page.$eval('#symbol-browser-type-filter', (e) => e.value)) === 'SM_TableManager' && first.join() === `${R}.fbLine.smTable2:watch,${R}.smTableManager:here`, `SM_TableManager's instances: ${first.join(', ')}`);
  await page.screenshot({ path: h.out('symbols-type-filter.png') });

  // 2. Cleared: the whole tree; another type's state machine says Open
  await page.click('#symbol-browser-type-clear');
  await sleep(300);
  await page.evaluate((p) => document.querySelector(`.symbol-row[data-path="${p}"] .symbol-toggle`)?.click(), `${R}.fbLine`);
  await sleep(500);
  const tree = await page.$$eval('#symbol-browser-tree .symbol-row', (r) => r.map((x) => x.getAttribute('data-path').split('.').pop()));
  const doorOpen = !!(await page.$(`.symbol-row[data-path="${R}.fbLine.smDoor"] .symbol-open-other`));
  expect(tree.includes('nCount') && tree.includes('smDoor') && doorOpen, `cleared: the whole tree (${tree.join(', ')}); smDoor (SM_DoorDasher): Open`);

  // 3. Another type in the filter; Open: a new StateScope for SM_DoorDasher, live on it
  await set('symbol-browser-type-filter', 'SM_DoorDasher');
  const doors = await list();
  expect(doors.join() === `${R}.fbLine.smDoor:open`, `SM_DoorDasher: ${doors.join(', ')}`);
  await page.click('.symbol-instance-row .symbol-open-other');
  await sleep(400);
  const open = sent.filter((m) => m.type === 'openInstance').pop();
  expect(open?.typeName === 'SM_DoorDasher' && open?.instance === `${R}.fbLine.smDoor`, `Open: openInstance ${open?.typeName} ${open?.instance} (the extension finds its POU, a new tab live on it)`);
  // The loaded type again, one click
  await page.click('#symbol-browser-type-loaded');
  expect((await list()).length === 2, 'the loaded type again: its 2 instances');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
