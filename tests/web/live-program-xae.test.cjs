// XAE stand-in: live on a PLC whose followed instance is of another type than the loaded POU (MAIN.mainStateMachine
// a TransferTable, SM_TableManager loaded): the Live tab says so, Open TransferTable asks XAE to open it; the XAE's
// build shown as its Remote Manager's ("XAE 4024.59"). Another program downloaded while connected (programChanged):
// Live stops and connects again; the instance now of the loaded POU's type: no warning
const h = require('../lib/harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const errors = [];
  const I = 'MAIN.mainStateMachine';
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const toApp = (m) => page.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  const sample = await page.evaluate(async () => {
    const mod = await import('/src/samples/samplesData.ts');
    const s = mod.SAMPLES[0];
    return { pou: s.pouContent, dut: s.dutContent };
  });
  const sent = [];
  // (the PLC's program: TransferTable, then SM_TableManager once "downloaded")
  let plcType = 'TransferTable';
  await page.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') {
      await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: 'C:\\proj\\SM_TableManager.TcPOU', content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] } });
    } else if (m.type === 'liveStart') {
      await toApp({ type: 'liveStatus', state: 'connected', message: `${I}.machineState on 5.1.2.3.1.1:851 (PLC Run)`, target: '5.1.2.3.1.1:851', plcState: 'Run', instance: I, instances: [I], instanceType: plcType, twinCatBuild: 4024, xaeBuild: 4024, xaeVersion: '4024.59' });
      await toApp({ type: 'liveValues', events: [{ t: Date.now(), value: 2 }] });
    } else if (m.type === 'liveStop') {
      await toApp({ type: 'liveStatus', state: 'stopped', message: 'Stopped' });
    } else if (m.type === 'liveWatch') {
      await toApp({ type: 'liveWatchResult', vars: [] });
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
  await sleep(600);
  await page.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await sleep(400);
  await page.click('#live-start-btn');

  // Another type than the loaded POU: said
  await page.waitForSelector('#live-type-mismatch', { timeout: 8000 }).catch(() => {});
  const warn = await page.evaluate(() => {
    const e = document.getElementById('live-type-mismatch');
    return e ? { text: e.textContent.replace(/\s+/g, ' ').trim(), type: e.getAttribute('data-plc-type'), open: !!document.getElementById('live-type-mismatch-open') } : null;
  });
  expect(!!warn && warn.type === 'TransferTable' && /MAIN\.mainStateMachine on this PLC is a TransferTable, not SM_TableManager/.test(warn.text) && warn.open, `another type: said, Open offered (${warn?.text.slice(0, 120)})`);
  const versions = await page.evaluate(() => document.getElementById('live-versions')?.textContent.trim() ?? '');
  expect(/XAE 4024\.59/.test(versions), `the XAE's build as its Remote Manager's (${versions})`);
  await page.click('#live-type-mismatch-open').catch(() => {});
  await sleep(500);
  expect(sent.some((m) => m.type === 'openPou' && m.typeName === 'TransferTable'), `Open TransferTable: XAE asked to open it (${JSON.stringify(sent.filter((m) => m.type === 'openPou'))})`);

  // Another program downloaded: stopped, connected again; the instance now the loaded POU's type
  plcType = 'SM_TableManager';
  const starts = () => sent.filter((m) => m.type === 'liveStart').length;
  const before = starts();
  await toApp({ type: 'liveStatus', state: 'programChanged', plcState: 'Run', message: "The PLC's program changed (a download or an activation)" });
  for (let t = 0; t < 6000 && starts() === before; t += 200) await sleep(200);
  expect(sent.some((m) => m.type === 'liveStop') && starts() === before + 1, `another program: Live stopped and connected again (${before} -> ${starts()} starts)`);
  await sleep(800);
  expect(!(await page.$('#live-type-mismatch')), 'connected again on the loaded POU\'s type: no warning');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
