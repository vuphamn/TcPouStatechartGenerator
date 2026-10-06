// A sub-machine live (web edition through Link, fake-ams2.cjs): the KAnalogMeasure sample, KANALOGMEASURE_ENABLING
// calling readDiagnostics() (its own state machine on iDiagReadState, a VAR_INST). The PLC keeps it under a name of
// its own (__readDiagnostics__iDiagReadState: not <instance>.readDiagnostics.iDiagReadState): found by the method's
// and the variable's names; its states named by the PLC's enum (the sample has no .TcDUT of it). While ENABLING is
// current, the state glows and its sub-machine's state is marked inside it, moving as the PLC's does; ENABLING left:
// neither
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// (the sample and its enum's values, from the app's own code)
const entry = path.join(h.OUT, 'sub-live-entry.ts');
const bundle = path.join(h.OUT, 'sub-live-entry.cjs');
const src = (f) => JSON.stringify(path.join(h.REPO, 'src', f).replace(/\\/g, '/'));
fs.writeFileSync(entry, `export { SAMPLES } from ${src('samples/samplesData.ts')};\nexport { enumValueMap } from ${src('utils/liveView.ts')};\n`);
require('esbuild').buildSync({ entryPoints: [entry], bundle: true, platform: 'node', outfile: bundle, logLevel: 'silent' });
const { SAMPLES, enumValueMap } = require(bundle);
const sample = SAMPLES.find((s) => s.id === 'k-analog-measure');
const valueOf = (name) => [...enumValueMap(sample.dutContent)].find(([, n]) => n === name)?.[0];
const ENABLING = valueOf('KANALOGMEASURE_ENABLING');
const READY = valueOf('KANALOGMEASURE_READY');
const DIAG = { 0: 'DIAG_READ_START', 1: 'DIAG_READ_ADR_OF_NEW_MESSAGE', 2: 'DIAG_READ_FINISH_ADR', 3: 'DIAG_READ_NEW_MESSAGE', 4: 'DIAG_READ_FINISH_MESSAGE' };
const I = 'MAIN.kam';
const DIAG_VAR = `${I}.__readDiagnostics__iDiagReadState`;
const sym = (type, dataType, size, value) => ({ type, dataType, size, value });
const cfgFile = path.join(h.OUT, 'fake-ams2-sub-live.json');
fs.writeFileSync(cfgFile, JSON.stringify({
  symbols: {
    [I]: sym('SM_KAnalogMeasure', 65, 16, 0),
    [`${I}.machineState`]: sym('E_KAnalogMeasure_States', 2, 2, ENABLING),
    [DIAG_VAR]: sym('E_KAnalogMeasure_DiagReadStates', 2, 2, 0),
  },
  types: {
    SM_KAnalogMeasure: { size: 16, dataType: 65, type: '', subItems: [
      { name: 'machineState', type: 'E_KAnalogMeasure_States', size: 2, dataType: 2 },
      { name: '__readDiagnostics__iDiagReadState', type: 'E_KAnalogMeasure_DiagReadStates', size: 2, dataType: 2 },
    ] },
    E_KAnalogMeasure_DiagReadStates: { size: 2, dataType: 2, type: 'INT', subItems: [], enumValues: DIAG },
  },
  upload: [{ name: I, type: 'SM_KAnalogMeasure' }],
  // (its diagnostics reading moves on, then ENABLING is left)
  script: [{ hold: 6000, set: { [DIAG_VAR]: 2 } }, { hold: 6000, set: { [`${I}.machineState`]: READY } }, { hold: 600000, set: {} }],
}));

(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48921', cfgFile], { stdio: 'ignore' });
  const outFile = path.join(h.OUT, 'link-sub-live.txt');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48920'], { env: { ...process.env, APPDATA: path.join(h.OUT, 'link-appdata-sublive'), KSS_LINK_UPDATES: 'off' }, stdio: ['ignore', fs.openSync(outFile, 'w'), 'ignore'] });
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  try {
    const code = (await h.waitForText(outFile, /Pairing code:\s+(\S+)/))?.[1];
    if (!code) throw new Error('Link did not start (no pairing code)');
    const a = await browser.newPage();
    const errors = [];
    a.on('pageerror', (e) => errors.push(e.message));
    const set = (id, v) => a.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
    await a.goto(h.APP_URL, { waitUntil: 'load' });
    await a.evaluate(() => localStorage.clear());
    await a.reload({ waitUntil: 'load' });
    await a.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
    await a.select('#sample-selector', 'k-analog-measure');
    await a.waitForSelector('#mermaid-canvas-area g.node[data-state-id="KANALOGMEASURE_ENABLING__readDiagnostics__DIAG_READ_START"]', { timeout: 30000 }).catch(() => {});
    await a.click('#dock-tab-live');
    await sleep(400);
    await set('live-token-input', code);
    await set('live-link-port-input', '48920');
    await set('live-netid-input', '127.0.0.1.1.1');
    await set('live-ip-input', '127.0.0.1:48921');
    await set('live-local-netid-input', '127.0.0.1.1.1').catch(() => {});
    await set('live-instance-input', I).catch(() => {});
    await a.click('#live-guards-off').catch(() => {});
    await a.click('#live-start-btn');
    const marks = () => a.evaluate(() => ({
      box: [...document.querySelectorAll('#mermaid-diagram-svg-container g.live-active-cluster')].map((c) => (c.getAttribute('data-id') || c.id).replace(/^.*?render-[a-z0-9]+-/i, '')),
      inner: [...document.querySelectorAll('#mermaid-diagram-svg-container g.node.live-region-node')].map((n) => n.getAttribute('data-state-id').split('__').pop()),
      active: [...document.querySelectorAll('#mermaid-diagram-svg-container g.node.live-active-node')].map((n) => n.getAttribute('data-state-id')),
    }));
    const waitFor = async (ok, ms) => {
      let m = await marks();
      for (let t = 0; t < ms && !ok(m); t += 250) { await sleep(250); m = await marks(); }
      return m;
    };
    const m1 = await waitFor((m) => m.inner.includes('DIAG_READ_START'), 15000);
    expect(m1.box.includes('KANALOGMEASURE_ENABLING') && m1.inner.join() === 'DIAG_READ_START', `ENABLING current: it glows, its sub-machine's state inside it (${JSON.stringify(m1)})`);
    const m2 = await waitFor((m) => m.inner.includes('DIAG_READ_FINISH_ADR'), 12000);
    expect(m2.box.includes('KANALOGMEASURE_ENABLING') && m2.inner.join() === 'DIAG_READ_FINISH_ADR', `its sub-machine moves on: DIAG_READ_FINISH_ADR marked (${JSON.stringify(m2)})`);
    const m3 = await waitFor((m) => m.active.includes('KANALOGMEASURE_READY'), 12000);
    expect(m3.active.includes('KANALOGMEASURE_READY') && !m3.box.includes('KANALOGMEASURE_ENABLING') && m3.inner.length === 0, `ENABLING left: READY glows, no sub-machine state marked (${JSON.stringify(m3)})`);
    expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    link.kill();
    plc.kill();
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
