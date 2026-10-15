// The andon and Call maintenance (simulated PLC symbols-plc.cjs, its sources with a commented enum; the web app from
// dist/): each state's "what to do" from the enum's comments (the PLC's sources) or the gateway's steps
// (config.andon.steps); a call for maintenance (an alert, in the alert history, its reason and note); the board's
// Andon page: the stopped machine big with what to do, the others small, Call maintenance, the open call shown.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
const { writeZip } = require('../lib/zip.cjs');
const { unzip } = require('../../shared/tcSources.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8499;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'andon-test-token';

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-andon.json', [], { sources: true });
  const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  // (the table's enum commented: its states' descriptions)
  const files = Object.fromEntries(unzip(Buffer.from(c.bootFiles['CurrentConfig/Plant.tpzip'], 'base64'), () => true).map((f) => [f.path, f.data.toString('utf8')]));
  const dut = 'POUs/Table/E_TableManager_States.TcDUT';
  files[dut] = files[dut].replace('TABLE_PLC_READY := 2', 'TABLE_PLC_READY := 2 // Ready: load the next panel');
  c.bootFiles['CurrentConfig/Plant.tpzip'] = writeZip(files).toString('base64');
  fs.writeFileSync(cfg, JSON.stringify(c));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48990', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-andon');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 8', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48990', port: 851 }],
    tokens: [{ name: 'ann', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    alerts: [{ id: 'a1', name: 'Line 8', enabled: true, plc: 'line', root: R, stateVar: 'machineState', stuckAfterMs: null, stateLimits: {}, onError: true, errorPattern: 'ERROR', notifyRecovery: false, webhook: null, format: 'json' }],
    andon: { steps: { DOOR_DASHER_ERROR: 'Check the door sensor S12, then press Reset' }, callReasons: ['Mechanical', 'Electrical', 'Material'] },
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-andon-run.txt');
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
    return h.until(() => got.find((m) => m.type === reply && m.requestId === requestId), 30000);
  };
  // 1. What to do: the enum's comment, the gateway's steps, the reasons to call for
  const info = await ask({ type: 'andonInfo', plc: 'line', types: ['SM_TableManager', 'SM_DoorDasher'] }, 'andonInfoResult');
  expect(info?.docs?.sm_tablemanager?.TABLE_PLC_READY === 'Ready: load the next panel' && /door sensor S12/.test(info.steps.DOOR_DASHER_ERROR) && info.reasons.join() === 'Mechanical,Electrical,Material', `what to do: "${info?.docs?.sm_tablemanager?.TABLE_PLC_READY}", steps ${Object.keys(info?.steps ?? {}).join()}, reasons ${info?.reasons?.join(', ')}${info?.error ? ` (${info.error})` : ''}`);
  // 2. A call: an alert
  const call = await ask({ type: 'callMaintenance', plc: 'line', machine: `${R}.aDoors[2]`, reason: 'Electrical', note: 'no light on S12' }, 'callMaintenanceResult');
  ws.send(JSON.stringify({ type: 'alertsList' }));
  const listed = await h.until(() => got.find((m) => m.type === 'alertsList')?.events?.find((e) => e.event === 'call'), 5000);
  expect(call?.ok === true && listed?.by === 'ann' && /ann calls maintenance for .*aDoors\[2\]: Electrical · no light on S12/.test(listed.text), `a call: ${listed?.text}`);
  ws.close();

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('andon-board'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 950 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/?board&page=andon`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', TOKEN);
    await p.keyboard.press('Enter');
    // 3. The Andon page: the stopped door big with what to do; the open call
    const down = await h.until(() => p.$eval(`.andon-down[data-path="${R}.aDoors[2]"]`, (e) => e.textContent).catch(() => null).then((t) => (t && /door sensor S12/.test(t) ? t : null)), 20000);
    const up = await p.$$eval('.andon-up', (x) => x.length);
    const calls = await p.$$eval('.andon-call', (x) => x.map((e) => e.textContent));
    expect(!!down && /DOOR_DASHER_ERROR/.test(down) && up >= 3 && calls.some((t) => /Electrical/.test(t ?? '')), `the Andon page: the door with what to do; ${up} running; calls: ${calls.length}`);
    // 4. Call maintenance from it
    await p.click(`.andon-down[data-path="${R}.aDoors[2]"] .andon-call-machine`);
    await p.waitForSelector('#andon-call-dialog', { timeout: 5000 });
    await p.click('#andon-call-dialog .andon-reason');
    const said = await h.until(() => p.$eval('#andon-said', (e) => e.textContent).catch(() => null), 5000);
    const callsNow = await h.until(() => p.$$eval('.andon-call', (x) => x.length).then((n) => (n >= 2 ? n : null)), 8000);
    expect(/Maintenance called: Mechanical/.test(said ?? '') && callsNow >= 2, `Call maintenance: "${said}", ${callsNow} open calls`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
