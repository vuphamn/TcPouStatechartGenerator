// Live on two PLCs at once (Compare…: the same POU live in another tab): two XAE stand-ins in one browser, live on
// 5.1.2.3.1.1 and 5.9.9.9.1.1. Each Live tab shows the other PLC with its current state (the same state as here: green)
// and Differences… compares the two sessions (Compare PLCs: time per state, the transitions only one took), kept
// current as the other PLC moves on; the other tab closed: gone from the list. Coverage on the chart: the transitions
// never taken dashed and dimmed while the Coverage strip's "On the chart" is on
const h = require('../lib/harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const errors = [];
  const I = 'MAIN.mainStateMachine';

  // An XAE stand-in live on that PLC: its state values sent on liveStart
  const open = async (target, values) => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(`${target}: ${e.message}`));
    const toApp = (m) => page.evaluate((m) => window.__fromHost(m), m).catch(() => {});
    await page.goto(h.APP_URL, { waitUntil: 'load' });
    const sample = await page.evaluate(async () => {
      const mod = await import('/src/samples/samplesData.ts');
      const s = mod.SAMPLES[0];
      const live = await import('/src/utils/liveView.ts');
      return { pou: s.pouContent, dut: s.dutContent, values: [...live.enumValueMap(s.dutContent)].map(([v, n]) => ({ v, n })) };
    });
    await page.exposeFunction('__hostPost', async (m) => {
      if (m.type === 'ready') {
        await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: 'C:\\proj\\SM_TableManager.TcPOU', content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] } });
      } else if (m.type === 'liveStart') {
        await toApp({ type: 'liveStatus', state: 'connected', message: `${I}.machineState on ${target}:851 (PLC Run)`, target: `${target}:851`, plcState: 'Run', instance: I, instances: [I], instanceType: 'SM_TableManager' });
        const t0 = Date.now() - values.length * 1000;
        await toApp({ type: 'liveValues', events: values.map((value, k) => ({ t: t0 + k * 1000, value })) });
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
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 60000 });
    await sleep(600);
    await page.evaluate(() => document.getElementById('dock-tab-live')?.click());
    await sleep(400);
    await page.click('#live-start-btn');
    await sleep(800);
    return { page, toApp, sample };
  };

  const a = await open('5.1.2.3.1.1', [1, 2]);
  await a.page.evaluate(() => localStorage.clear());
  const names = a.sample.values;
  const nameOf = (v) => names.find((x) => x.v === v)?.n;
  // (B: a longer session, ending in the state A is in)
  const b = await open('5.9.9.9.1.1', [1, 3, 1, 2]);

  // A's Live tab: B's PLC and its state (the same as A's: green)
  const peerOf = (page, plc) => page.evaluate((plc) => {
    const e = document.querySelector(`.live-peer[data-plc="${plc}"]`);
    return e ? { state: e.getAttribute('data-state'), same: !!e.querySelector('.text-emerald-300'), text: e.textContent.replace(/\s+/g, ' ').trim() } : null;
  }, plc);
  let peer = null;
  for (let t = 0; t < 8000 && !peer; t += 250) {
    peer = await peerOf(a.page, '5.9.9.9.1.1:851');
    if (!peer) await sleep(250);
  }
  expect(peer?.state === nameOf(2) && peer.same && /4 transitions|3 transitions/.test(peer.text), `A shows B live, in the same state (${peer?.text})`);
  let back = null;
  for (let t = 0; t < 8000 && !back; t += 250) {
    back = await peerOf(b.page, '5.1.2.3.1.1:851');
    if (!back) await sleep(250);
  }
  expect(back?.state === nameOf(2), `and B shows A (${back?.text})`);

  // Differences…: Compare PLCs, A this PLC, B the other
  await a.page.bringToFront();
  await sleep(300);
  await a.page.click('.live-peer-diff').catch(() => {});
  await a.page.waitForSelector('#compare-dialog', { timeout: 4000 }).catch(() => {});
  const dlg = await a.page.evaluate(() => ({
    title: document.querySelector('#compare-dialog .font-semibold')?.textContent ?? '',
    a: document.getElementById('compare-a')?.textContent ?? '',
    b: document.getElementById('compare-b')?.textContent ?? '',
    rows: document.querySelectorAll('#compare-table tbody tr').length,
  }));
  expect(dlg.title === 'Compare PLCs' && /^5\.1\.2\.3\.1\.1:851 \(1 transitions\)/.test(dlg.a) && /^5\.9\.9\.9\.1\.1:851 \(3 transitions\)/.test(dlg.b) && dlg.rows > 0, `Differences…: the two sessions compared (${JSON.stringify(dlg)})`);
  // (B moves on: the dialog follows)
  await b.toApp({ type: 'liveValues', events: [{ t: Date.now(), value: 3 }] });
  let bNow = '';
  for (let t = 0; t < 6000 && !/\(4 transitions\)/.test(bNow); t += 250) {
    await sleep(250);
    bNow = await a.page.evaluate(() => document.getElementById('compare-b')?.textContent ?? '');
  }
  expect(/\(4 transitions\)/.test(bNow), `kept current as B moves on (${bNow})`);
  peer = await peerOf(a.page, '5.9.9.9.1.1:851');
  expect(peer?.state === nameOf(3) && !peer.same, `B in another state than A: shown so (${peer?.text})`);
  await a.page.keyboard.press('Escape');
  await a.page.evaluate(() => document.querySelector('#compare-dialog button[title="Close"]')?.click());
  await sleep(300);

  // B closed: gone from A's list
  await b.page.close();
  for (let t = 0; t < 9000 && (await peerOf(a.page, '5.9.9.9.1.1:851')); t += 250) await sleep(250);
  expect(!(await peerOf(a.page, '5.9.9.9.1.1:851')) && !(await a.page.$('#live-peers')), 'B closed: gone from the list');

  // Coverage on the chart: the never-taken transitions dashed and dimmed while "On the chart" is on
  const cov = await a.page.evaluate(() => { const e = document.getElementById('live-coverage'); return e ? { taken: Number(e.getAttribute('data-taken')), total: Number(e.getAttribute('data-total')) } : null; });
  await a.page.click('#live-coverage-on-chart').catch(() => {});
  await sleep(500);
  const dashed = await a.page.evaluate(() => ({
    paths: document.querySelectorAll('#mermaid-canvas-area path.coverage-never').length,
    labels: document.querySelectorAll('#mermaid-canvas-area g.edgeLabel.coverage-never').length,
    dash: (() => { const p = document.querySelector('#mermaid-canvas-area path.coverage-never'); return p ? getComputedStyle(p).strokeDasharray : null; })(),
    pressed: document.getElementById('live-coverage-on-chart')?.getAttribute('aria-pressed'),
  }));
  expect(!!cov && cov.total - cov.taken > 0 && dashed.paths > 0 && dashed.paths <= cov.total - cov.taken && dashed.labels > 0 && /2px,\s*5px/.test(dashed.dash ?? '') && dashed.pressed === 'true', `on the chart: the never-taken dashed (${JSON.stringify({ cov, ...dashed })})`);
  await a.page.click('#live-coverage-on-chart').catch(() => {});
  await sleep(400);
  const after = await a.page.evaluate(() => document.querySelectorAll('#mermaid-canvas-area .coverage-never').length);
  expect(after === 0, `off: drawn as before (${after})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
