// Nested sub-machines live (web edition through Link, fake-ams2.cjs): the K-Test Station sample, KTESTSTATION_CALIBRATING
// calling Calibrate() (on eCalState), whose CAL_MEASURE calls Measure() (on eMeasureState). The PLC keeps each method's
// variable under a name of its own (found by the method's and the variable's names), its states named by the PLC's
// enums. While CALIBRATING is current and Calibrate() in CAL_MEASURE: CALIBRATING and CAL_MEASURE glow (both boxes),
// Measure()'s state marked inside; Measure() moves on: its new state marked; Calibrate() leaves CAL_MEASURE: Measure()'s
// marks gone, Calibrate()'s CAL_CHECK marked; CALIBRATING left: none
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// (the sample and its enum's values, from the app's own code)
const entry = path.join(h.OUT, 'nested-live-entry.ts');
const bundle = path.join(h.OUT, 'nested-live-entry.cjs');
const src = (f) => JSON.stringify(path.join(h.REPO, 'src', f).replace(/\\/g, '/'));
fs.writeFileSync(entry, `export { SAMPLES } from ${src('samples/samplesData.ts')};\nexport { enumValueMap } from ${src('utils/liveView.ts')};\n`);
require('esbuild').buildSync({ entryPoints: [entry], bundle: true, platform: 'node', outfile: bundle, logLevel: 'silent' });
const { SAMPLES, enumValueMap } = require(bundle);
const sample = SAMPLES.find((s) => s.id === 'k-test-station');
const valueOf = (name) => [...enumValueMap(sample.dutContent)].find(([, n]) => n === name)?.[0];
const CALIBRATING = valueOf('KTESTSTATION_CALIBRATING');
const IDLE = valueOf('KTESTSTATION_IDLE');
const CAL = { 0: 'CAL_ZERO', 1: 'CAL_MEASURE', 2: 'CAL_CHECK', 3: 'CAL_DONE' };
const MEAS = { 0: 'MEAS_SETTLE', 1: 'MEAS_READ', 2: 'MEAS_STORE' };
const I = 'MAIN.station';
const CAL_VAR = `${I}.__Calibrate__eCalState`;
const MEAS_VAR = `${I}.__Measure__eMeasureState`;
const P = 'KTESTSTATION_CALIBRATING';
const CM = `${P}__Calibrate__CAL_MEASURE`;
const sym = (type, dataType, size, value) => ({ type, dataType, size, value });
const cfgFile = path.join(h.OUT, 'fake-ams2-nested-live.json');
fs.writeFileSync(cfgFile, JSON.stringify({
  symbols: {
    [I]: sym('SM_KTestStation', 65, 16, 0),
    [`${I}.machineState`]: sym('E_KTestStation_States', 2, 2, CALIBRATING),
    [CAL_VAR]: sym('E_KTestStation_CalStates', 2, 2, 1),
    [MEAS_VAR]: sym('E_KTestStation_MeasureStates', 2, 2, 0),
  },
  types: {
    SM_KTestStation: { size: 16, dataType: 65, type: '', subItems: [
      { name: 'machineState', type: 'E_KTestStation_States', size: 2, dataType: 2 },
      { name: '__Calibrate__eCalState', type: 'E_KTestStation_CalStates', size: 2, dataType: 2 },
      { name: '__Measure__eMeasureState', type: 'E_KTestStation_MeasureStates', size: 2, dataType: 2 },
    ] },
    E_KTestStation_CalStates: { size: 2, dataType: 2, type: 'INT', subItems: [], enumValues: CAL },
    E_KTestStation_MeasureStates: { size: 2, dataType: 2, type: 'INT', subItems: [], enumValues: MEAS },
  },
  upload: [{ name: I, type: 'SM_KTestStation' }],
  // (Measure() moves on; Calibrate() leaves CAL_MEASURE; then CALIBRATING is left)
  script: [{ hold: 6000, set: { [MEAS_VAR]: 1 } }, { hold: 6000, set: { [CAL_VAR]: 2 } }, { hold: 6000, set: { [`${I}.machineState`]: IDLE } }, { hold: 600000, set: {} }],
}));

(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48927', cfgFile], { stdio: 'ignore' });
  const outFile = path.join(h.OUT, 'link-nested-live.txt');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48926'], { env: { ...process.env, APPDATA: path.join(h.OUT, 'link-appdata-nestedlive'), KSS_LINK_UPDATES: 'off' }, stdio: ['ignore', fs.openSync(outFile, 'w'), 'ignore'] });
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
    await a.select('#sample-selector', 'k-test-station');
    await a.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${CM}__Measure__MEAS_READ"]`, { timeout: 30000 }).catch(() => {});
    await a.click('#dock-tab-live');
    await sleep(400);
    await set('live-token-input', code);
    await set('live-link-port-input', '48926');
    await set('live-netid-input', '127.0.0.1.1.1');
    await set('live-ip-input', '127.0.0.1:48927');
    await set('live-local-netid-input', '127.0.0.1.1.1').catch(() => {});
    await set('live-instance-input', I).catch(() => {});
    await a.click('#live-guards-off').catch(() => {});
    await a.click('#live-start-btn');
    const name = (c) => (c.getAttribute('data-id') || c.id).replace(/^.*?render-[a-z0-9]+-/i, '').replace(/^state-/, '').replace(/-\d+$/, '');
    const marks = () => a.evaluate((nameSrc) => {
      const name = eval(nameSrc);
      return {
        boxes: [...document.querySelectorAll('#mermaid-diagram-svg-container g.live-active-cluster')].map(name),
        inner: [...document.querySelectorAll('#mermaid-diagram-svg-container g.node.live-region-node')].map((n) => n.getAttribute('data-state-id').split('__').slice(-2).join('.')),
        cards: [...document.querySelectorAll('[id^="state-list-item-"][data-live="true"]')].map((e) => e.id.replace('state-list-item-', '').split('__').pop()),
      };
    }, name.toString());
    const waitFor = async (ok, ms) => {
      let m = await marks();
      for (let t = 0; t < ms && !ok(m); t += 250) { await sleep(250); m = await marks(); }
      return m;
    };
    const m1 = await waitFor((m) => m.inner.includes('Measure.MEAS_SETTLE'), 15000);
    expect(m1.boxes.includes(P) && m1.boxes.includes(CM) && m1.inner.join() === 'Measure.MEAS_SETTLE', `CALIBRATING and CAL_MEASURE glow, Measure()'s MEAS_SETTLE inside (${JSON.stringify(m1)})`);
    expect(['KTESTSTATION_CALIBRATING', 'CAL_MEASURE', 'MEAS_SETTLE'].every((c) => m1.cards.includes(c)), `Identified States: each level's card marked (${m1.cards.join(', ')})`);
    const m2 = await waitFor((m) => m.inner.includes('Measure.MEAS_READ'), 12000);
    expect(m2.inner.join() === 'Measure.MEAS_READ' && m2.boxes.includes(CM), `Measure() moves on: MEAS_READ marked (${JSON.stringify(m2)})`);
    const m3 = await waitFor((m) => m.inner.includes('Calibrate.CAL_CHECK'), 12000);
    expect(m3.inner.join() === 'Calibrate.CAL_CHECK' && !m3.boxes.includes(CM) && m3.boxes.includes(P), `Calibrate() leaves CAL_MEASURE: CAL_CHECK marked, Measure()'s gone (${JSON.stringify(m3)})`);
    const m4 = await waitFor((m) => !m.boxes.includes(P), 12000);
    expect(!m4.boxes.includes(P) && m4.inner.length === 0, `CALIBRATING left: no sub-machine marked (${JSON.stringify(m4)})`);
    expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    link.kill();
    plc.kill();
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
