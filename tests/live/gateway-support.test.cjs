// The support bundle (gateway/support.cjs; simulated PLC symbols-plc.cjs; the web app from dist/): made from the
// protocol, fetched by its link (its files: the gateway, its settings without secrets, the alerts, faults, drives,
// fleet, projects, work orders, recordings, audit log); a wrong key gets nothing; a display may not make one; the
// board's Support bundle dialog gives its link.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
const { unzip } = require('../../shared/tcSources.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8507;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'support-test-token';
const WALL = 'support-wall-token';
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const get = (p) => new Promise((resolve) => http.get({ host: '127.0.0.1', port: PORT, path: p, headers: { host: `localhost:${PORT}` } }, (res) => {
  const parts = [];
  res.on('data', (d) => parts.push(d));
  res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(parts) }));
}).on('error', () => resolve({ status: 0 })));

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-support.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48994', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-support');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 12', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48994', port: 851 }],
    tokens: [{ name: 'eng', sha256: sha(TOKEN) }, { name: 'wall', sha256: sha(WALL), view: true }],
    alerts: [{ id: 'a1', name: 'Line 12', enabled: true, plc: 'line', root: 'MAIN.mainStateMachine', stateVar: 'machineState', stuckAfterMs: null, stateLimits: {}, onError: true, errorPattern: 'ERROR', notifyRecovery: false, webhook: 'https://hooks.example/secret-path', format: 'json' }],
    drives: { enabled: false }, fleet: { enabled: false }, projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-support-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);
  await h.sleep(3000);

  const session = async (token) => {
    const got = [];
    const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'hello', token }));
    await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
    return { ws, got };
  };
  // 1. Made, fetched by its link
  const eng = await session(TOKEN);
  eng.ws.send(JSON.stringify({ type: 'supportCreate', requestId: 1, hours: 24, days: 1, faults: true }));
  const made = await h.until(() => eng.got.find((m) => m.type === 'supportResult' && m.requestId === 1), 30000);
  const zip = await get(made?.url ?? '/x');
  const files = zip.status === 200 ? unzip(zip.body, () => true) : [];
  const names = files.map((f) => f.path);
  const conf = files.find((f) => f.path === 'config.json')?.data.toString('utf8') ?? '';
  expect(made?.ok && zip.status === 200 && /zip/.test(zip.type ?? '') && ['gateway.json', 'config.json', 'alerts.json', 'faults.json', 'drives.json', 'fleet.json', 'projects.json', 'workorders.json', 'recordings.json', 'audit.jsonl', 'load.json'].every((n) => names.includes(n)), `a bundle: ${made?.size} bytes, ${names.join(', ')}`);
  expect(!/secret-path/.test(conf) && !conf.includes(sha(TOKEN)) && /"name": "eng"/.test(conf), 'its settings without their secrets (the webhook, the token)');
  const wrong = await get((made?.url ?? '/support/0000000000000000.zip?key=x').replace(/key=.*/, 'key=wrong'));
  expect(wrong.status === 404, `a wrong key: ${wrong.status}`);
  eng.ws.close();
  // 2. A display may not make one
  const wall = await session(WALL);
  wall.ws.send(JSON.stringify({ type: 'supportCreate', requestId: 2 }));
  const refused = await h.until(() => wall.got.find((m) => m.requestId === 2), 5000);
  expect(refused && refused.ok === false, `a display: refused (${refused?.error})`);
  wall.ws.close();

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('board-support-dialog'));
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
    await p.waitForSelector('#board-support', { timeout: 15000 });
    await p.click('#board-support');
    await p.click('#board-support-make');
    const link = await h.until(() => p.$eval('#board-support-link', (e) => e.textContent).catch(() => null), 30000);
    const url = /http\S+\.zip\?key=\S+?(?=\d+ KB|$)/.exec(link ?? '')?.[0] ?? '';
    const again = url ? await get(url.replace(BASE, '')) : { status: 0 };
    expect(/\/support\/[a-f0-9]{16}\.zip\?key=/.test(link ?? '') && again.status === 200, `the board's dialog: its link works (${again.status})`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
