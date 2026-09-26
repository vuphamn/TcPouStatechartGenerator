const h = require('../lib/harness.cjs');
// App side of live guard values inside XAE, with a stand-in bridge: liveWatch is answered like the extension does
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const tmFile = path.join(h.REPO, 'src/samples/SM_TableManager.TcPOU');

(async () => {
  const edge = { kill() {} }; // (the harness launches the browser)
  let browser;
  browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const sent = [];
  const toApp = (m) => page.evaluate((m) => window.__fromHost(m), m);
  // The Table Manager sample's sources, as the extension would send them
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  const sample = await page.evaluate(async () => {
    const mod = await import('/src/samples/samplesData.ts');
    const s = mod.SAMPLES[0];
    return { pou: s.pouContent, dut: s.dutContent };
  });
  const I = 'MAIN.mainStateMachine.smTableManager';
  const values = { cmd_bhome: true, 'smoutfeedstopaxis.config_fhomeposition': 0, 'smoutfeedstopaxis.status_bhomed': false };
  await page.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') {
      await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: 'C:\\\\proj\\\\SM_TableManager.TcPOU', content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\\\proj\\\\E_TableManager_States.TcDUT', content: sample.dut }] } });
    } else if (m.type === 'navigate') {
      await toApp({ type: 'navigateResult', ok: false });
    } else if (m.type === 'liveStart') {
      await toApp({ type: 'liveStatus', state: 'connected', message: `${I}.machineState on 5.1.2.3.1.1:851 (PLC Run)`, target: '5.1.2.3.1.1:851', plcState: 'Run', instance: I, instances: [I] });
      await toApp({ type: 'liveValues', events: [{ t: Date.now(), value: 2 }] });
    } else if (m.type === 'liveWatch') {
      await toApp({ type: 'liveWatchResult', vars: m.vars.map((v) => (v.id in values ? { id: v.id, symbol: v.candidates[0], type: /fhome/.test(v.id) ? 'LREAL' : 'BOOL' } : { id: v.id, error: 'not in the PLC (a local of the method, a property or a method?)' })) });
      await toApp({ type: 'liveVars', values: m.vars.filter((v) => v.id in values).map((v) => ({ id: v.id, t: Date.now(), v: values[v.id] })) });
    } else if (m.type === 'projectPous') {
      await toApp({ type: 'projectPous', project: 'Commander_3', pous: [], duts: [{ name: 'E_FeedMode.TcDUT', relativePath: 'E_FeedMode.TcDUT', content: '<DUT Name="E_FeedMode"><Declaration><![CDATA[TYPE E_FeedMode : (FEEDMODE_OFF := 0, FEEDMODE_AUTO, FEEDMODE_FEEDTHRU); END_TYPE]]></Declaration></DUT>' }] });
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
  await page.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 30000 });
  await sleep(800);
  await page.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await sleep(500);
  await page.click('#live-start-btn');
  await sleep(2500);
  const watch = sent.filter((m) => m.type === 'liveWatch').pop();
  console.log('   liveWatch:', watch && watch.vars.map((v) => `${v.id} <- ${v.candidates.join(' | ')}`).join('\n              '));
  expect(watch && watch.vars.some((v) => v.id === 'cmd_bhome' && v.candidates[0] === `${I}.cmd_bHome`), 'liveWatch sent to the extension with instance paths');
  expect(watch && watch.vars.some((v) => v.id === 'smoutfeedstopaxis.config_fhomeposition' && v.candidates.includes('smOutfeedStopAxis.config_fHomePosition')), 'dotted variables also tried as a global path');
  expect(sent.some((m) => m.type === 'projectPous'), 'the project\'s enums are loaded for literals');
  const list = await page.$$eval('#mermaid-canvas-area g.edgeLabel[data-edge-id] g.live-guard', (gs) => gs.map((g) => `${g.closest('g.edgeLabel').getAttribute('data-edge-id')}=${g.getAttribute('data-guard-result')}`));
  console.log('   ', list.join('  '));
  expect(list.some((x) => /HOMMING_READY_TO_START->TABLEMANAGER_ERROR.*=true/.test(x)) && list.some((x) => /->TABLEMANAGER_HOMMING=false/.test(x)), 'badges from the extension\'s values (IF true: ERROR fires)');
  // The state changes: the new state's variables are asked for
  const before = sent.filter((m) => m.type === 'liveWatch').length;
  await toApp({ type: 'liveValues', events: [{ t: Date.now(), value: 33 }] });
  await sleep(1500);
  const w2 = sent.filter((m) => m.type === 'liveWatch').pop();
  expect(sent.filter((m) => m.type === 'liveWatch').length > before && w2.vars.some((v) => v.id === 'cmd_efeedmode') && !w2.vars.some((v) => v.id === 'cmd_bhome'), `new state, new set: ${w2.vars.map((v) => v.id).join(', ')}`);
  expect(!w2.vars.some((v) => v.id === 'feedmode_off'), 'FEEDMODE_OFF is a literal (from the project\'s E_FeedMode), not a variable');
  // Off: an empty set releases them
  await page.click('#live-guards-off');
  await sleep(800);
  expect(sent.filter((m) => m.type === 'liveWatch').pop().vars.length === 0, 'off: an empty liveWatch');
  console.log('page errors:', errors.slice(0, 5));
  await browser.close().catch(() => {});
  edge.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
