// Servo axis health (gateway/axes.cjs; simulated PLC symbols-plc.cjs with two AXIS_REF; the web app from dist/): the
// axes found in the program; the one moving with a following error 150 % above its last 5 days (a warning, an alert);
// the one in an NC error (an alarm); kept per day; the Drives page's servo axes.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8520;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'axes-test-token';
const dayOf = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-axes.json');
  const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  // (two axes: the table moving, its lag 0.05; the lift standing, in an NC error)
  const axis = (name, f) => {
    c.symbols[name] = { type: 'AXIS_REF', dataType: 65, size: 1024, value: 0 };
    for (const [k, [type, dataType, size, value]] of Object.entries(f)) c.symbols[`${name}.NcToPlc.${k}`] = { type, dataType, size, value };
    c.upload.push({ name, type: 'AXIS_REF' });
  };
  axis('MAIN.axTable', { ErrorCode: ['UDINT', 19, 4, 0], AxisState: ['UDINT', 19, 4, 6], SetVelo: ['LREAL', 5, 8, 100], ActVelo: ['LREAL', 5, 8, 99.9], PosDiff: ['LREAL', 5, 8, -0.05], ActTorque: ['LREAL', 5, 8, 31] });
  axis('MAIN.axLift', { ErrorCode: ['UDINT', 19, 4, 0x4550], AxisState: ['UDINT', 19, 4, 1], SetVelo: ['LREAL', 5, 8, 0], ActVelo: ['LREAL', 5, 8, 0], PosDiff: ['LREAL', 5, 8, 0], ActTorque: ['LREAL', 5, 8, 0] });
  fs.writeFileSync(cfg, JSON.stringify(c));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48968', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-axes');
  fs.rmSync(dir, { recursive: true, force: true });
  // (its last 5 days: the table's lag 0.02, its torque 30)
  const days = {};
  for (let k = 5; k >= 1; k--) days[dayOf(Date.now() - k * 86400000)] = { 'MAIN.axTable': { lagP95: 0.02, torqueP95: 30, n: 1000 } };
  fs.mkdirSync(path.join(dir, 'axes', 'line'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'axes', 'line', 'summary.json'), JSON.stringify({ days }));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 6', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48968', port: 851 }],
    tokens: [{ name: 'eng', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    axes: { everySeconds: 2, limits: { minSamples: 3 } },
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-axes-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token: TOKEN }));
  await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
  ws.send(JSON.stringify({ type: 'axesWatch', plcs: [] }));
  // 1. The axes found, judged (after 3 samples moving)
  const state = await h.until(() => {
    const s = [...got].reverse().find((m) => m.type === 'axesState');
    const t = s?.plcs?.[0]?.axes?.find((a) => a.name === 'axTable');
    return t?.health?.level === 'warn' ? s : null;
  }, 30000);
  const axes = state?.plcs?.[0]?.axes ?? [];
  const table = axes.find((a) => a.name === 'axTable');
  const lift = axes.find((a) => a.name === 'axLift');
  expect(axes.length === 2 && Math.abs(table.today.lagP95 - 0.05) < 1e-9 && table.today.torqueP95 === 31 && table.health.baseline.lag === 0.02, `the axes: ${axes.map((a) => a.name).join(', ')}; the table's lag ${table?.today?.lagP95} (usual ${table?.health?.baseline?.lag}), torque ${table?.today?.torqueP95}`);
  expect(/Following error 150 % above its last 5 days/.test(table?.health?.findings?.[0]?.text ?? '') && !table.health.findings.some((f) => f.key === 'torque') && lift?.health?.level === 'alarm' && /NC error 0x4550/.test(lift.health.findings[0]?.text ?? ''), `judged: table "${table?.health?.findings?.[0]?.text}"; lift ${lift?.health?.level} "${lift?.health?.findings?.[0]?.text}"`);
  // 2. Their alerts
  ws.send(JSON.stringify({ type: 'alertsList' }));
  const alerts = await h.until(() => [...got].reverse().find((m) => m.type === 'alertsList')?.events, 5000);
  expect((alerts ?? []).some((e) => /axLift: NC error 0x4550/.test(e.text)) && (alerts ?? []).some((e) => /axTable: Following error/.test(e.text)), `alerts: ${(alerts ?? []).map((e) => e.text).join(' | ')}`);
  ws.close();

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('axes-list'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1400, height: 900 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/?board&page=drives&lang=en`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', TOKEN);
    await p.keyboard.press('Enter');
    const cards = await h.until(() => p.$$eval('.axis-card', (x) => x.map((e) => `${e.getAttribute('data-axis')}:${e.getAttribute('data-level')}`)).then((x) => (x.length === 2 ? x : null)), 20000);
    expect(cards?.[0] === 'MAIN.axLift:alarm' && cards[1] === 'MAIN.axTable:warn', `the Drives page's servo axes: ${cards?.join(', ')}`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
