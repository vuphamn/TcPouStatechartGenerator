// Roles on the gateway (gateway/roles.cjs; simulated PLC symbols-plc.cjs; the web app from dist/):
// - each role may do its own: an operator acknowledges but sets no maintenance and saves no filters; a technician sets
//   maintenance; a manager gets reports but acknowledges nothing; someone without a role (no default) does nothing;
// - the board: the role in its header, what it may not do hidden, its start page (a saved filter);
// - an alert told to the technicians' channel, naming who is on call;
// - the setup page's Roles: shown, saved.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8491;
const BASE = `http://localhost:${PORT}`;
const HOOK = 8492;
const tok = (n) => `roles-${n}-token`;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

(async () => {
  // The technicians' channel: a webhook here
  const posted = [];
  const hook = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      try { posted.push(JSON.parse(b)); } catch { /* not JSON */ }
      res.end('ok');
    });
  }).listen(HOOK);
  const cfg = writeSymbolsPlc('fake-ams2-roles.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48986', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-roles');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'board-filters.json'), JSON.stringify({ filters: [{ id: 'ops1', name: 'Tables', audience: 'operators', note: '', text: 'table', problemsOnly: false, layout: 'flat', plcs: [], machines: [], signals: [], alerts: true, page: 'machines', by: 'tim', at: new Date().toISOString() }] }));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 4', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48986', port: 851 }],
    tokens: ['ann', 'tim', 'mgr', 'zed'].map((n) => ({ name: n, sha256: sha(tok(n)) })),
    alerts: [{ id: 'a1', name: 'Line 4', enabled: true, plc: 'line', root: R, stateVar: 'machineState', stuckAfterMs: null, stateLimits: {}, onError: true, errorPattern: 'ERROR', notifyRecovery: false, webhook: null, format: 'json' }],
    roles: {
      users: { ann: 'operator', tim: 'technician', mgr: 'manager' }, groups: {}, default: '', startPages: { operator: 'ops1' },
      notify: [{ role: 'technician', webhook: `http://127.0.0.1:${HOOK}/hook`, format: 'json', events: ['error'], onCall: [{ name: 'Tim', days: '', from: '00:00', to: '24:00' }] }],
    },
    drives: { enabled: false },
    projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-roles-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  const session = async (name) => {
    const got = [];
    const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: tok(name) }));
    const welcome = await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
    let id = 100;
    const ask = async (msg, reply) => {
      const requestId = ++id;
      ws.send(JSON.stringify({ ...msg, requestId }));
      return h.until(() => got.find((m) => m.type === reply && m.requestId === requestId), 5000);
    };
    return { ws, got, welcome, ask };
  };
  // 1. An operator
  const ann = await session('ann');
  expect(ann.welcome?.role === 'operator' && ann.welcome.rolesOn === true && ann.welcome.can.includes('ack') && !ann.welcome.can.includes('maintenance'), `ann: ${ann.welcome?.roleLabel}, may ${ann.welcome?.can?.join(', ')}`);
  const annMaint = await ann.ask({ type: 'maintenanceSet', plc: 'line', minutes: 30, note: 'x' }, 'maintenanceResult');
  const annFilter = await ann.ask({ type: 'boardFilterSave', filter: { name: 'x', audience: 'operators' } }, 'boardFilterResult');
  expect(annMaint?.ok === false && /role \(Operator\) may not/.test(annMaint.message) && annFilter?.ok === false, `an operator sets no maintenance, saves no filter: ${annMaint?.message}`);
  // (its alerts: one to acknowledge)
  ann.ws.send(JSON.stringify({ type: 'alertsList' }));
  const open = await h.until(() => [...ann.got].reverse().find((m) => m.type === 'alertsList' && m.events?.length)?.events ?? (ann.ws.send(JSON.stringify({ type: 'alertsList' })), null), 20000);
  const ack = open ? await ann.ask({ type: 'alertAck', id: open[0].id, note: 'on it' }, 'alertAckResult') : null;
  expect(ack?.ok === true, `an operator acknowledges: ${ack?.message}`);
  // 2. A technician, a manager, someone without a role
  const tim = await session('tim');
  const timMaint = await tim.ask({ type: 'maintenanceSet', plc: 'line', minutes: 30, note: 'fan' }, 'maintenanceResult');
  await tim.ask({ type: 'maintenanceSet', plc: 'line', minutes: 0, note: '' }, 'maintenanceResult');
  const mgr = await session('mgr');
  const mgrReport = await mgr.ask({ type: 'report', which: 'today' }, 'reportResult');
  const mgrAck = await mgr.ask({ type: 'alertAck', id: open?.[0]?.id ?? 'x' }, 'alertAckResult');
  const zed = await session('zed');
  const zedAck = await zed.ask({ type: 'alertAck', id: open?.[0]?.id ?? 'x' }, 'alertAckResult');
  expect(timMaint?.ok === true && !mgrReport?.error && mgrAck?.ok === false && zed.welcome?.role === null && zed.welcome.can.length === 0 && zedAck?.ok === false, `technician maintenance ${timMaint?.ok}; manager report ${!mgrReport?.error}, ack ${mgrAck?.ok}; zed: no role, ack ${zedAck?.ok}`);
  for (const s of [ann, tim, mgr, zed]) s.ws.close();
  // 3. The technicians' channel, with who is on call
  const told = await h.until(() => posted.find((p) => p.event === 'error'), 10000);
  expect(!!told && told.role === 'technician' && /on call \(Service \/ maintenance technician\): Tim/.test(told.text) && told.onCall?.[0] === 'Tim', `told the technicians: ${told?.text}`);

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('board-role'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 950 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    // 4. The board as an operator: its role, its start page, no maintenance or reports
    await p.goto(`${BASE}/?board`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', tok('ann'));
    await p.keyboard.press('Enter');
    await p.waitForSelector('.board-tile', { timeout: 20000 });
    const seen = await h.until(() => p.evaluate(() => ({ role: document.querySelector('#board-role')?.textContent, start: document.querySelector('#board-filter-active')?.textContent, maint: !!document.querySelector('.board-maintenance-btn'), report: !!document.querySelector('#board-report'), filter: document.querySelector('#board-filter')?.value })).then((x) => (x.start === 'Tables' ? x : null)), 10000);
    expect(seen?.role === 'Operator' && seen.start === 'Tables' && seen.filter === 'table' && !seen.maint && !seen.report, `the board as an operator: ${JSON.stringify(seen)}`);
    // 5. The setup page's Roles
    await p.goto(`${BASE}/admin`, { waitUntil: 'load' });
    await p.waitForSelector('[data-role-user="ann"]', { timeout: 10000 });
    await p.select('[data-role-user="zed"] select', 'manager');
    await p.click('#admin-roles-save');
    const msg = await h.until(() => p.$eval('#admin-roles-msg', (e) => e.textContent).then((t) => (t ? t : null)), 5000);
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8')).roles;
    expect(/Saved/.test(msg ?? '') && saved?.users?.zed === 'manager' && saved.users.ann === 'operator' && saved.notify?.[0]?.onCall?.[0]?.name === 'Tim', `the setup page's Roles saved: zed ${saved?.users?.zed} (${msg})`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  hook.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
