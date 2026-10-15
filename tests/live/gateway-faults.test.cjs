// The fault recorder (gateway/faults.cjs; simulated PLC symbols-plc.cjs; the web app from dist/): a machine that goes
// into an error state (aDoors[1] to DOOR_DASHER_ERROR, seconds after the start) is kept by itself: the seconds before
// (every machine, the signals chosen) and after; one already in an error state at the start (aDoors[2]) makes none.
// The board: its Faults list, the alert's Fault record, the viewer (a lane per machine, the moment marked, the
// signals); the I/O page's "Keep with fault records"; the PLC's TwinCAT logged events imported (the setup page) and
// shown with the record (its window's only); a work order made of it, listed with it, linking back.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8493;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'faults-test-token';
const post = (p, body) =>
  new Promise((resolve) => {
    const r = require('http').request({ host: '127.0.0.1', port: PORT, path: `/admin/api/${p}`, method: 'POST', headers: { host: `localhost:${PORT}`, origin: BASE, 'content-type': 'application/json' } }, (res) => {
      let t = '';
      res.on('data', (d) => (t += d));
      res.on('end', () => resolve((() => { try { return JSON.parse(t); } catch { return { status: res.statusCode }; } })()));
    });
    r.on('error', () => resolve(null));
    r.end(JSON.stringify(body));
  });
// (a time as the Logged Events window of an en-US XAE writes it)
const usTime = (t) => { const d = new Date(t); const h = d.getHours() % 12 || 12; const p = (n, k = 2) => String(n).padStart(k, '0'); return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${h}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)} ${d.getHours() < 12 ? 'AM' : 'PM'}`; };

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-faults.json', [], { sources: true });
  const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  // (aDoors[1]: DISABLED, ENABLING after 3 s, then its error state 3 s later)
  c.script = [...c.script, { hold: 3000, set: { [`${R}.aDoors[1].machineState`]: 7, [`${R}.nCount`]: 99 } }];
  fs.writeFileSync(cfg, JSON.stringify(c));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48987', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-faults');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 5', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48987', port: 851 }],
    tokens: [{ name: 'tech', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    alerts: [{ id: 'a1', name: 'Line 5', enabled: true, plc: 'line', root: R, stateVar: 'machineState', stuckAfterMs: null, stateLimits: {}, onError: true, errorPattern: 'ERROR', notifyRecovery: false, webhook: null, format: 'json' }],
    faults: { preSeconds: 5, postSeconds: 5, signals: { line: [`${R}.nCount`, `${R}.fSpeed`] } },
    drives: { enabled: false },
    projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-faults-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token: TOKEN }));
  await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
  ws.send(JSON.stringify({ type: 'boardList' }));
  // 1. The fault: kept, then complete
  const done = await h.until(() => got.find((m) => m.type === 'faultEvent' && m.kind === 'complete')?.fault, 30000);
  expect(done?.machine === `${R}.aDoors[1]` && done.state === 'DOOR_DASHER_ERROR' && done.complete, `a fault kept: ${done?.machine} ${done?.state}`);
  ws.send(JSON.stringify({ type: 'faultsList', requestId: 1 }));
  const list = await h.until(() => got.find((m) => m.type === 'faultsListResult' && m.requestId === 1), 5000);
  expect(list?.faults?.length === 1 && !list.faults.some((f) => /aDoors\[2\]/.test(f.machine)) && list.signals?.line?.length === 2, `one fault only (not the machine in error from the start): ${list?.faults?.map((f) => f.machine).join(', ')}`);
  ws.send(JSON.stringify({ type: 'faultGet', requestId: 2, id: done?.id }));
  const rec = (await h.until(() => got.find((m) => m.type === 'faultGetResult' && m.requestId === 2), 5000))?.fault;
  const door = rec?.machines?.[`${R}.aDoors[1]`] ?? [];
  expect(rec && rec.to - rec.from === 10000 && rec.from === rec.at - 5000 && door[0]?.t >= rec.from && door.some((p) => p.v === 7 && p.t === rec.at) && door.some((p) => p.v === 1 && p.t < rec.at), `its record: ${Object.keys(rec?.machines ?? {}).length} machines, aDoors[1] ${door.map((p) => p.v).join(' > ')}, ${rec?.stateNames?.[`${R}.aDoors[1]`]?.['7']}`);
  expect((rec?.signals?.[`${R}.nCount`] ?? []).some((p) => p.v === 99) && (rec?.signals?.[`${R}.fSpeed`] ?? []).length >= 1, `its signals: nCount ${(rec?.signals?.[`${R}.nCount`] ?? []).map((p) => p.v).join(' > ')}`);
  expect(fs.existsSync(path.join(dir, 'faults', 'line')), 'kept in faults/line/<day>/<id>.json');
  // (its TwinCAT logged events: two in its window, one an hour before)
  const csv = ['"Severity","Event Class","Event Id","Source","Time Raised","Text"', `"Error","DoorEvents","3","Door1","${usTime(rec.at - 1500)}","Door 1, sensor S12 lost"`, `"Warning","DoorEvents","5","Door1","${usTime(rec.at + 500)}","Door 1 stopped"`, `"Info","Main","1","Main","${usTime(rec.at - 3600000)}","Shift started"`, '"x","y","z","w","not a time","?"'].join('\r\n');
  const imported = await post('eventlog', { plc: 'line', csv });
  const again = await post('eventlog', { plc: 'line', csv });
  ws.send(JSON.stringify({ type: 'workCreate', requestId: 5, order: { title: 'Door 1 sensor', plc: 'line', machine: `${R}.aDoors[1]`, priority: 'high', source: { kind: 'fault', id: done?.id, text: 'fault record' } } }));
  await h.until(() => got.find((m) => m.type === 'workResult' && m.requestId === 5), 5000);
  ws.send(JSON.stringify({ type: 'faultGet', requestId: 6, id: done?.id }));
  const linked = (await h.until(() => got.find((m) => m.type === 'faultGetResult' && m.requestId === 6), 5000))?.fault;
  expect(imported?.read === 3 && imported.added === 3 && imported.skipped === 1 && again?.added === 0 && linked?.events?.length === 2 && linked.events[0].text === 'Door 1, sensor S12 lost' && linked.events[0].severity === 'Error' && Math.abs(linked.events[0].t - (rec.at - 1500)) < 2 && linked.orders?.[0]?.title === 'Door 1 sensor', `logged events: ${imported?.read} read (${imported?.skipped} not), again ${again?.added} new; the record's ${linked?.events?.map((e) => e.text).join(' | ')}; its work orders ${linked?.orders?.map((o) => o.title)}`);
  // 2. The signals kept with the faults: changed from the board
  ws.send(JSON.stringify({ type: 'faultSignalsSet', requestId: 3, plc: 'line', signals: [`${R}.bEnable`] }));
  const set = await h.until(() => got.find((m) => m.type === 'faultSignalsResult' && m.requestId === 3), 5000);
  expect(set?.ok === true && JSON.parse(fs.readFileSync(configPath, 'utf8')).faults.signals.line[0] === `${R}.bEnable`, 'the signals kept with the faults changed (config.json)');
  ws.close();

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('fault-viewer'));
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
    // 3. The alert's Fault record
    const button = await h.until(() => p.$('.board-alert-fault'), 15000);
    await button?.click();
    await p.waitForSelector('#fault-viewer .board-playback-lane', { timeout: 10000 });
    const view = await h.until(() => p.evaluate(() => ({ title: document.querySelector('#fault-viewer-title')?.textContent ?? '', lanes: document.querySelectorAll('#fault-viewer .board-playback-lane').length, marks: document.querySelectorAll('#fault-viewer .board-playback-mark').length, signals: document.querySelectorAll('#fault-viewer .board-trend-lane').length, events: document.querySelectorAll('#fault-events .fault-event').length, orders: document.querySelector('#fault-orders')?.textContent ?? '', work: !!document.querySelector('#fault-work') })).then((x) => (x.signals ? x : null)), 8000);
    expect(/aDoors\[1\] went into DOOR_DASHER_ERROR/.test(view?.title ?? '') && view.lanes >= 1 && view.marks >= 3 && view.signals === 2 && view.events === 2 && /Door 1 sensor/.test(view.orders) && view.work, `the viewer: ${JSON.stringify(view)}`);
    await p.click('#fault-viewer button[title^="Close"]');
    // 4. The Faults list
    await p.click('#board-aside-faults');
    const listed = await p.$$eval('.board-fault', (fs2) => fs2.length);
    expect(listed === 1, `the board's Faults list: ${listed}`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
