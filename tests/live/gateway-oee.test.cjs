// OEE and downtime (gateway/oee.cjs; simulated PLC symbols-plc.cjs; the web app from dist/): a recording of aDoors[1]
// over the last two hours (6 cycles through DOOR_DASHER_ENABLING, its error state for 10 minutes), a reason given for
// that stop (Jam): the report's availability, cycles, stops and Pareto by reason; quality from its part counters (6
// good with a counter reset, 2 bad: 75 %); by shift. The board: a machine
// going into its error state asks Why? (the reason given, the button gone); the OEE page.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8497;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'oee-test-token';
const M = `${R}.aDoors[1]`;
const dayOf = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-oee.json');
  const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  // (aDoors[1] goes into its error state 3 s after ENABLING, live: the board asks Why?)
  c.script = [...c.script, { hold: 3000, set: { [`${M}.machineState`]: 7 } }];
  // (its energy meter: a kWh counter)
  c.symbols['GVL.fEnergy'] = { type: 'LREAL', dataType: 5, size: 8, value: 125 };
  fs.writeFileSync(cfg, JSON.stringify(c));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48989', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-oee');
  fs.rmSync(dir, { recursive: true, force: true });
  // The recording: 2 hours ago, 6 cycles (DISABLED 5 min, ENABLING 5 min), then 10 minutes in its error state
  const T = Date.now() - 5000;
  const start = T - 120 * 60000;
  const lines = [];
  let t = start;
  for (let i = 0; i < 6; i++) {
    lines.push({ t, m: M, v: 0 });
    t += 5 * 60000;
    lines.push({ t, m: M, v: 1 });
    t += 5 * 60000;
  }
  const stopAt = t;
  lines.push({ t, m: M, v: 7 });
  t += 10 * 60000;
  lines.push({ t, m: M, v: 0 });
  // (its part counters: 6 good, the counter reset once; 2 bad)
  const G = `${R}.nCount`;
  const BAD = `${R}.fSpeed`;
  [100, 101, 102, 103, 104, 105, 0, 1].forEach((v, i) => lines.push({ t: start + i * 10 * 60000 + 1000, x: G, v }));
  [7, 8, 9].forEach((v, i) => lines.push({ t: stopAt + i * 60000, x: BAD, v }));
  // (its product: Door 36 for the first 30 minutes, then Door 42 (its own ideal cycle: 60 s))
  const P = `${R}.sName`;
  lines.push({ t: start, x: P, v: 'Door 36' }, { t: start + 30 * 60000, x: P, v: 'Door 42' });
  // (its energy: 10 kWh while Door 36, 15 kWh since)
  lines.push({ t: start, x: 'GVL.fEnergy', v: 100 }, { t: start + 30 * 60000, x: 'GVL.fEnergy', v: 110 }, { t: T - 60000, x: 'GVL.fEnergy', v: 125 });
  lines.sort((a, b) => a.t - b.t);
  const byDay = new Map();
  for (const l of lines) byDay.set(dayOf(l.t), [...(byDay.get(dayOf(l.t)) ?? []), JSON.stringify(l)]);
  fs.mkdirSync(path.join(dir, 'recordings', 'r1'), { recursive: true });
  for (const [d, ls] of byDay) fs.writeFileSync(path.join(dir, 'recordings', 'r1', `${d}.jsonl`), ls.join('\n') + '\n');
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 7', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48989', port: 851 }],
    tokens: [{ name: 'mgr', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    alerts: [{ id: 'a1', name: 'Line 7', enabled: true, plc: 'line', root: R, stateVar: 'machineState', stuckAfterMs: null, stateLimits: {}, onError: true, errorPattern: 'ERROR', notifyRecovery: false, webhook: null, format: 'json' }],
    recordings: [{ id: 'r1', name: 'Doors', enabled: true, plc: 'line', root: R, stateVar: 'machineState', days: 7, machines: [M] }],
    shifts: [{ name: 'Early', from: '06:00', to: '14:00' }, { name: 'Late', from: '14:00', to: '22:00' }, { name: 'Night', from: '22:00', to: '06:00' }],
    oee: { reasonAfterMin: 0, microStopMaxSec: 900, machines: [{ plc: 'line', machine: M, cycleState: 'DOOR_DASHER_ENABLING', idealCycleSec: 30, goodVar: G, badVar: BAD }], products: { line: { var: P, idealCycleSec: { 'Door 42': 60 } } } },
    energy: { meters: [{ plc: 'line', name: 'Main feed', var: 'GVL.fEnergy', unit: 'kWh' }], price: 0.2, currency: 'USD' },
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-oee-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token: TOKEN }));
  await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
  let id = 0;
  const ask = async (msg, reply) => {
    const requestId = ++id;
    ws.send(JSON.stringify({ ...msg, requestId }));
    return h.until(() => got.find((m) => m.type === reply && m.requestId === requestId), 60000);
  };
  // (the recording's machines known once it watches)
  await h.until(() => ask({ type: 'recordingsList' }, 'recordingsList').then((r) => (r?.recordings?.[0]?.machines?.length ? r : null)), 20000);
  // 1. A reason for the stop
  const given = await ask({ type: 'downtimeReason', plc: 'line', machine: M, from: stopAt + 20000, reason: 'Jam', note: 'infeed' }, 'downtimeReasonResult');
  const bad = await ask({ type: 'downtimeReason', plc: 'line', machine: M, from: stopAt, reason: 'Aliens' }, 'downtimeReasonResult');
  expect(given?.ok === true && bad?.ok === false && /One of/.test(bad.error), `a reason given (Jam); one not offered refused: ${bad?.error?.slice(0, 40)}`);
  // 2. The report
  const r = await ask({ type: 'oeeReport', from: start - 10 * 60000, to: T, plcs: [], by: 'shift' }, 'oeeReportResult');
  const m = r?.machines?.find((x) => x.machine === M);
  console.log(`   line ${JSON.stringify(r?.line)}; machine ${JSON.stringify(m)}`);
  expect(m && m.cycles === 6 && m.availability > 0.85 && m.availability < 0.95 && Math.abs(m.downMs - 10 * 60000) < 2000, `aDoors[1]: ${m?.cycles} cycles, availability ${m?.availability?.toFixed(3)}, down ${Math.round((m?.downMs ?? 0) / 60000)} min`);
  expect(m && m.performance > 0 && r.line.oee !== null && r.line.availability !== null, `performance ${m?.performance?.toFixed(3)}, OEE ${r?.line?.oee?.toFixed(3)}`);
  expect(m && m.good === 6 && m.bad === 2 && m.quality === 0.75 && r.line.quality === 0.75 && r.line.good === 6 && Math.abs(r.line.oee - r.line.availability * r.line.performance * 0.75) < 1e-9, `quality: ${m?.good} good, ${m?.bad} bad: ${m?.quality}; the line ${r?.line?.quality}`);
  // (its micro-stops: 5 gaps of 10 minutes between its cycles, each 570 s over its ideal 30 s; no slow cycle)
  expect(m?.microStops?.count === 5 && m.microStops.ms === 5 * 570000 && m.slowCycles?.count === 0 && r.line.microStops?.count === 5, `micro-stops: ${m?.microStops?.count} (${Math.round((m?.microStops?.ms ?? 0) / 60000)} min), slow cycles ${m?.slowCycles?.count}; the line ${r?.line?.microStops?.count}`);
  const stop = r?.stops?.find((s) => s.machine === M && s.kind === 'error');
  expect(stop?.reason === 'Jam' && stop.note === 'infeed' && stop.by === 'mgr' && r.pareto.reason[0]?.key === 'Jam', `its stop: ${stop?.state} ${Math.round((stop?.ms ?? 0) / 60000)} min, ${stop?.reason} (${stop?.note}); Pareto: ${r?.pareto?.reason?.map((x) => x.key).join(', ')}`);
  expect(r?.windows?.length >= 1 && r.windows.every((w) => /Early|Late|Night/.test(w.label)), `by shift: ${r?.windows?.map((w) => w.label).join(', ')}`);
  // (energy: 25 kWh over its 8 parts, 5 USD; by product: 10 kWh, 15 kWh)
  const meter = r?.energy?.[0];
  expect(meter?.name === 'Main feed' && meter.recorded && Math.abs(meter.kwh - 25) < 1e-6 && meter.parts === 8 && Math.abs(meter.kwhPerPart - 3.125) < 1e-6 && Math.abs(meter.cost - 5) < 1e-6 && r.energyTotal.currency === 'USD', `energy: ${meter?.kwh} kWh, ${meter?.parts} parts, ${meter?.kwhPerPart} kWh a part, ${meter?.cost} ${r?.energyTotal?.currency}`);
  // (by product: its two runs, each its cycles; Door 42 against its own ideal cycle)
  const p36 = r?.products?.find((p) => p.product === 'Door 36');
  const p42 = r?.products?.find((p) => p.product === 'Door 42');
  expect(r?.products?.length === 2 && Math.abs(p36.ms - 30 * 60000) < 2000 && p36.cycles === 3 && p36.idealCycleSec === null && p42.cycles === 3 && p42.idealCycleSec === 60 && p42.performance > 0 && p36.performance > 0 && p42.downMs > 0 && p36.downMs === 0 && Math.abs(p36.kwh - 10) < 1e-6 && Math.abs(p42.kwh - 15) < 1e-6 && p36.kwhPerPart > 0, `by product: ${r?.products?.map((p) => `${p.product} ${Math.round(p.ms / 60000)} min, ${p.cycles} cycles, performance ${p.performance?.toFixed(3)}, down ${Math.round(p.downMs / 60000)} min, ${p.kwh} kWh (${p.kwhPerPart} a part)`).join('; ')}`);
  ws.close();

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('oee-machines'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 950 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/?board`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', TOKEN);
    await p.keyboard.press('Enter');
    // 3. Why? on the machine gone into its error state
    const why = await h.until(() => p.$(`.board-tile[data-path="${M}"] .board-why`), 20000);
    await why?.click();
    await p.waitForSelector('#board-why', { timeout: 5000 }).catch(() => {});
    await p.type('#board-why input', 'door sensor');
    const pick = await p.$$('#board-why .board-why-reason');
    await pick[4]?.click();
    const gone = await h.until(() => p.$(`.board-tile[data-path="${M}"] .board-why`).then((x) => (x ? null : true)), 8000);
    const saved = fs.readFileSync(path.join(dir, 'downtime.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(!!why && gone && saved.some((e) => e.note === 'door sensor' && e.reason === 'Electrical fault'), `Why? on the tile: given (${saved.at(-1)?.reason}, ${saved.at(-1)?.note}), the button gone`);
    // 4. The OEE page
    await p.click('#board-page-oee');
    // (the last 7 days: its stop 2 hours ago in it, whatever the time of day)
    await p.click('.oee-window[data-window="week"]');
    const page = await h.until(() => p.evaluate(() => ({ kpis: document.querySelectorAll('.oee-kpi').length, machines: document.querySelectorAll('.oee-machine').length, quality: document.querySelector('.oee-quality')?.textContent, jam: [...document.querySelectorAll('.oee-pareto')].some((e) => /Jam/.test(e.textContent ?? '')) })).then((x) => (x.machines && x.jam ? x : null)), 30000);
    expect(page?.kpis === 5 && page.machines >= 1 && page.jam && /^\d+ %$/.test(page.quality ?? ''), `the OEE page: ${JSON.stringify(page)}`);
    // (the live PLC since: its own product too)
    const kwhCell = await p.$eval('.oee-meter[data-meter="Main feed"] .oee-kwh-part', (e) => e.textContent).catch(() => null);
    // (the live PLC since: its parts and energy counted too: a part's energy shown)
    expect(/Wh$/.test(kwhCell ?? ''), `the OEE page: Main feed ${kwhCell} a part`);
    const prows = await p.$$eval('.oee-product', (x) => x.map((e) => e.getAttribute('data-product')));
    const losses = await p.$eval('#oee-losses', (e) => e.textContent).catch(() => '');
    expect(/\d+ micro-stops/.test(losses) && /slow cycles/.test(losses), `the OEE page's losses: ${losses}`);
    expect(prows.includes('Door 36') && prows.includes('Door 42'), `the OEE page by product: ${prows.join(', ')}`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
