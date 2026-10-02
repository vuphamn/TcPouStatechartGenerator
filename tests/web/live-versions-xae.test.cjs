// XAE stand-in: live, the Live tab shows the PLC's TwinCAT build beside this XAE's (the extension reads it from the
// PLC's system service); amber, with why, when they are not of one family: a 4024 PLC in 4026's XAE (a project saved
// here may not open in 4024's XAE), a 4026 PLC in 4024's (it may not download); quiet when they match
const h = require('../lib/harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const errors = [];
  const I = 'MAIN.mainStateMachine.smTableManager';
  for (const [plc, xae, warns] of [[4024, 4026, true], [4024, 4024, false], [4026, 4024, true], [4026, 4026, false]]) {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const toApp = (m) => page.evaluate((m) => window.__fromHost(m), m).catch(() => {});
    await page.goto(h.APP_URL, { waitUntil: 'load' });
    const sample = await page.evaluate(async () => {
      const mod = await import('/src/samples/samplesData.ts');
      const s = mod.SAMPLES[0];
      return { pou: s.pouContent, dut: s.dutContent };
    });
    await page.exposeFunction('__hostPost', async (m) => {
      if (m.type === 'ready') {
        await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: 'C:\\proj\\SM_TableManager.TcPOU', content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] } });
      } else if (m.type === 'liveStart') {
        await toApp({ type: 'liveStatus', state: 'connected', message: `${I}.machineState on 5.1.2.3.1.1:851 (PLC Run)`, target: '5.1.2.3.1.1:851', plcState: 'Run', instance: I, instances: [I], twinCatBuild: plc, xaeBuild: xae });
        await toApp({ type: 'liveValues', events: [{ t: Date.now(), value: 2 }] });
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
    await page.waitForSelector('#live-versions', { timeout: 8000 }).catch(() => {});
    const v = await page.evaluate(() => { const e = document.getElementById('live-versions'); return e ? { text: e.textContent.trim(), warn: e.getAttribute('data-warn') === 'true', title: e.getAttribute('title') } : null; });
    const why = plc < xae ? /may no longer open in 4024's XAE/ : /may not download/;
    expect(!!v && v.text.includes(`TwinCAT 3.1.${plc}`) && v.text.includes(`XAE ${xae}`) && v.warn === warns && (!warns || why.test(v.title ?? '')), `a ${plc} PLC in ${xae}'s XAE: ${warns ? 'warned' : 'quiet'} (${JSON.stringify(v)})`);
    await page.close();
  }
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
