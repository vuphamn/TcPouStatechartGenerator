// Gateway, round three (simulated PLC symbols-plc.cjs): the audit log (entries, the setup page's search); planned
// maintenance (announced, on the board, starts by itself); the shift report (sent, on the board, CSV); recordings:
// variables recorded and replayed, past days compressed (and still read), a size limit, the daily slowdown check
// (a 🐢 alert and its webhook), availability; the startup task (dry run: the command only); the board: kiosk
// rotation, the escalated count, the planned window, the report.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8469;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'more-test-token';
const dayOf = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const api = (method, p, body) =>
  new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: `/admin/api/${p}`, method, headers: { host: `localhost:${PORT}`, origin: BASE, 'content-type': 'application/json' } }, (res) => {
      let t = '';
      res.on('data', (d) => (t += d));
      res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(t); } catch { return null; } })() }));
    });
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
function client() {
  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  const ready = new Promise((r) => ws.on('open', r)).then(() => ws.send(JSON.stringify({ type: 'hello', token: TOKEN })));
  const wait = async (test, ms = 8000) => {
    for (let t = 0; t < ms; t += 100) {
      const hit = got.find(test);
      if (hit) return hit;
      await h.sleep(100);
    }
    return null;
  };
  return { ws, got, ready, wait, send: (m) => ws.send(JSON.stringify(m)) };
}

(async () => {
  const posts = [];
  const hook = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      posts.push({ path: req.url, body: JSON.parse(b || '{}') });
      res.end('1');
    });
  });
  await new Promise((r) => hook.listen(48984, '127.0.0.1', r));
  const hookUrl = (p) => `http://127.0.0.1:48984/${p}`;
  const cfg = writeSymbolsPlc('fake-ams2-more.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48983', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-more');
  fs.rmSync(dir, { recursive: true, force: true });
  // A recording's past days: smTable1's state 3 slower the last three days; one old big day (the size limit)
  const machine = `${R}.smTable1`;
  const recDir = path.join(dir, 'recordings', 'r1');
  fs.mkdirSync(recDir, { recursive: true });
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  for (let k = 8; k >= 1; k--) {
    const start = noon.getTime() - k * 86400000;
    const lines = [];
    let t = start;
    for (let c = 0; c < 4; c++) {
      lines.push({ t, m: machine, v: 2 });
      t += 5000;
      lines.push({ t, m: machine, v: 3 });
      t += k <= 3 ? 30000 : 10000;
    }
    lines.push({ t, m: machine, v: 2 });
    fs.writeFileSync(path.join(recDir, `${dayOf(start)}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  }
  const old = dayOf(noon.getTime() - 20 * 86400000);
  fs.writeFileSync(path.join(recDir, `${old}.jsonl`), JSON.stringify({ t: noon.getTime() - 20 * 86400000, m: machine, v: 2, pad: crypto.randomBytes(1600000).toString('base64') }) + '\n');
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000, escalationCheckMs: 500,
    plcs: [{ id: 'line202', name: 'Line 202', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48983', port: 851 }],
    tokens: [{ name: 'operator', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    alerts: [{ id: 'a1', name: 'Line 202', enabled: true, plc: 'line202', root: R, stateVar: 'machineState', stuckAfterMs: null, stateLimits: {}, onError: true, errorPattern: 'ERROR', notifyRecovery: true, webhook: hookUrl('alerts'), format: 'json', escalateAfterMin: 0.05 }],
    boards: [{ id: 'b1', title: 'Board one', plcs: ['line202'], root: R, stuck: null }, { id: 'b2', title: 'Board two', plcs: ['line202'], root: R, stuck: null }],
    recordings: [{ id: 'r1', name: 'Line 202', enabled: true, plc: 'line202', root: R, stateVar: 'machineState', days: 30, vars: [`${R}.smTable1.bHomed`, `${R}.nCount`], maxMB: 1, compress: true, slowerPct: 50, slowerWebhook: hookUrl('slower'), slowerFormat: 'teams' }],
    shifts: [{ name: 'All day', from: '00:00', to: '23:59' }],
    reports: { webhook: hookUrl('reports'), format: 'json' },
  }, null, 2));
  const logFile = h.out('gw-more-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], {
    env: { ...process.env, KSS_SERVICE_DRYRUN: '1', KSS_RECORDING_CHECK_MS: '1500' },
    stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')],
  });
  await h.waitForText(logFile, /Setup page/);

  const a = client();
  await a.ready;
  await a.wait((m) => m.type === 'welcome');
  a.send({ type: 'alertsList' });
  a.send({ type: 'boardWatch', plcs: ['line202'], root: R });

  // Recordings: compressed past days, the size limit, the variables
  await h.sleep(4000);
  const files = fs.readdirSync(recDir);
  expect(files.filter((f) => f.endsWith('.jsonl.gz')).length === 8 && files.includes(`${dayOf(Date.now())}.jsonl`), `past days compressed: ${files.filter((f) => f.endsWith('.gz')).length} .gz, today plain`);
  expect(!files.some((f) => f.startsWith(old)) && /over 1 MB/.test(fs.readFileSync(logFile, 'utf8')), 'the size limit: the oldest (big) day deleted');
  const today = fs.readFileSync(path.join(recDir, `${dayOf(Date.now())}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  expect(today.some((l) => l.x === `${R}.smTable1.bHomed`) && today.some((l) => l.x === `${R}.nCount` && l.v === 42), `variables recorded: ${[...new Set(today.filter((l) => l.x).map((l) => l.x))].join(', ')}`);
  a.send({ type: 'recordingQuery', requestId: 1, id: 'r1', machine, from: Date.now() - 3600000, to: Date.now() });
  const q = await a.wait((m) => m.type === 'recordingData' && m.requestId === 1);
  expect(q?.vars.some((v) => v.id === 'bhomed') && q.vars.some((v) => v.id === `${R}.ncount`.toLowerCase()) && q.watched.bhomed?.symbol === `${R}.smTable1.bHomed`, `replay with the variables: ${[...new Set(q?.vars.map((v) => v.id))].join(', ')}`);
  a.send({ type: 'recordingStats', requestId: 2, id: 'r1', machine, days: 14 });
  const st = await a.wait((m) => m.type === 'recordingStats' && m.requestId === 2);
  expect(st?.days.filter((d) => d.states['3']).length >= 8, `trends read the compressed days: ${st?.days.length} days`);

  // The daily slowdown check: 🐢 on the webhook and as an alert
  const slower = await a.wait((m) => m.type === 'alertEvent' && m.event.event === 'slower', 8000);
  await h.sleep(400);
  const sp = posts.find((p) => p.path === '/slower');
  expect(!!slower && /smTable1 is getting slower in #3: \+200%/.test(slower.event.text) && /getting slower/.test(sp?.body.text ?? '') && Object.keys(sp.body).length === 1, `slowdown: ${slower?.event.text}`);
  expect((await api('POST', 'recordings/check', { id: 'r1' })).json?.found.length === 0, 'checked again the same day: not sent again');

  // Availability today: aDoors[2] in error all the time, the others normal
  const from = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  a.send({ type: 'recordingAvailability', requestId: 3, id: 'r1', windows: [{ label: 'today', from, to: Date.now() }] });
  const av = await a.wait((m) => m.type === 'recordingAvailability' && m.requestId === 3);
  const d2 = av?.windows[0].machines.find((m) => m.machine === `${R}.aDoors[2]`);
  const main = av?.windows[0].machines.find((m) => m.machine === R);
  expect(d2 && d2.errorMs > 0 && d2.normalMs === 0 && d2.noDataMs > 0 && main && main.normalMs > 0 && main.errorMs === 0, `availability: aDoors[2] error ${Math.round((d2?.errorMs ?? 0) / 1000)} s, main normal ${Math.round((main?.normalMs ?? 0) / 1000)} s`);

  // Planned maintenance: in 35 s, for 30 min
  a.send({ type: 'maintenanceSet', requestId: 4, plc: 'line202', minutes: 30, note: 'sensor swap', from: Date.now() + 35000 });
  const mr = await a.wait((m) => m.type === 'maintenanceResult' && m.requestId === 4);
  const planned = await a.wait((m) => m.type === 'boardState' && m.plcs[0].planned?.length === 1 && !m.plcs[0].maintenance);
  await h.sleep(400);
  expect(mr?.ok && mr.planned.length === 1 && !!planned && posts.some((p) => p.path === '/alerts' && /🗓️ Line 202: maintenance planned .* \(operator: sensor swap\)/.test(p.body.text)), 'planned: on the board, announced');

  // The shift report: sent from the setup page, and on the board (CSV)
  const sent = await api('POST', 'reports/send', { which: 'today' });
  await h.sleep(500);
  const rp = posts.find((p) => p.path === '/reports');
  expect(sent.json?.ok && rp?.body.event === 'report' && /📋 /.test(rp.body.text) && rp.body.alerts >= 1, `report sent: ${rp?.body.text}`);
  a.send({ type: 'report', requestId: 5, which: 'today' });
  const rep = await a.wait((m) => m.type === 'reportResult' && m.requestId === 5);
  expect(/^report,Today,/.test(rep?.csv ?? '') && /aDoors\[2\]/.test(rep?.csv ?? ''), 'report on the board: CSV with the alerts');

  // The startup task: the command (dry run), nothing installed
  const svc = await api('GET', 'service');
  const inst = await api('POST', 'service/install', {});
  expect(svc.json?.supported && /Register-ScheduledTask -TaskName 'Kval StateScope gateway'/.test(inst.json?.dry ?? '') && /-AtStartup/.test(inst.json.dry) && /RestartCount 999/.test(inst.json.dry), 'startup task: the command (dry run)');

  // The audit log
  await h.sleep(1500);
  const au = await api('POST', 'audit/search', { q: '', from: Date.now() - 3600000, to: Date.now() });
  const actions = new Set(au.json?.events.map((e) => e.action));
  expect(['sign-in', 'replay', 'availability', 'maintenance.set', 'report', 'setup.service/install', 'setup.reports/send'].every((x) => actions.has(x)), `audit: ${[...actions].join(', ')}`);
  const only = await api('POST', 'audit/search', { q: 'sensor swap', from: Date.now() - 3600000, to: Date.now() });
  expect(only.json?.events.length === 1 && only.json.events[0].action === 'maintenance.set', 'audit search: by text');

  // In a browser: the board (kiosk rotation, escalated, planned, report); the setup page's new sections
  const built = fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('board-kiosk'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/`, { waitUntil: 'load' });
    await p.evaluate((t) => { localStorage.clear(); localStorage.setItem('kss.gateway.token', t); }, TOKEN);
    await p.goto(`${BASE}/?board&cycle=3`, { waitUntil: 'load' });
    await p.waitForSelector('#board-kiosk', { timeout: 10000 }).catch(() => {});
    const t1 = await p.$eval('#board-title', (e) => e.textContent).catch(() => '');
    await h.sleep(3500);
    const t2 = await p.$eval('#board-title', (e) => e.textContent).catch(() => '');
    expect(/^Board (one|two)$/.test(t1) && /^Board (one|two)$/.test(t2) && t1 !== t2 && /[12] \/ 2/.test(await p.$eval('#board-kiosk', (e) => e.textContent)), `kiosk: ${t1} -> ${t2}`);
    expect(/1 escalated/.test(await p.$eval('#board-escalated-count', (e) => e.textContent).catch(() => '')), 'the escalated count');
    expect(/Planned .* \(operator: sensor swap\)/.test(await p.$eval('.board-planned-item', (e) => e.textContent).catch(() => '')), 'the planned window on the board');
    await p.select('#board-report', 'today');
    await p.waitForSelector('#board-report-panel', { timeout: 5000 }).catch(() => {});
    expect(/📋 Today/.test(await p.$eval('#board-report-panel', (e) => e.textContent).catch(() => '')) && !!(await p.$('#board-report-csv')), 'the report on the board, with Download CSV');
    // The planned window starts by itself (35 s after it was set)
    await p.waitForSelector('.board-maintenance', { timeout: 40000 }).catch(() => {});
    expect(/Maintenance until .*sensor swap/.test(await p.$eval('.board-maintenance', (e) => e.textContent).catch(() => '')) && posts.some((x) => /planned maintenance until/.test(x.body.text ?? '')), 'the planned window started: on the board, announced');
    await p.screenshot({ path: h.out('board-more.png') });
    // The setup page: audit, reports, startup
    await p.goto(`${BASE}/admin`, { waitUntil: 'load' });
    await p.waitForSelector('.admin-audit-row', { timeout: 8000 }).catch(() => {});
    expect((await p.$$('.admin-audit-row')).length >= 5 && /Not installed/.test(await p.$eval('#admin-service-status', (e) => e.textContent)), 'setup page: the audit rows, the startup task');
    await p.type('#admin-audit-q', 'sensor swap');
    await p.click('#admin-audit-search');
    await h.sleep(600);
    expect((await p.$$('.admin-audit-row')).length === 1, 'setup page: the audit search');
    expect((await p.$$('.admin-shift')).length === 1 && (await p.$eval('#admin-report-webhook', (e) => e.value)) === hookUrl('reports'), 'setup page: the shifts and the reports webhook');
    expect(errors.length === 0, `no page errors ${errors.slice(0, 2).join(' | ')}`);
    await browser.close();
  }
  a.ws.close();
  gw.kill();
  plc.kill();
  hook.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
