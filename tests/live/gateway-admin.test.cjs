// The gateway's setup page (/admin): only from this computer and its own page; the TwinCAT search (fake-discovery.cjs)
// fills the PLC list, Test connects (fake-ams.cjs, with a route only for the gateway's NetId), Save writes config.json
// and the running gateway offers the PLCs at once; a token created there signs in, revoked it no longer does
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8457;
const ORIGIN = `http://localhost:${PORT}`;

const request = (method, p, { headers = {}, body, host = '127.0.0.1' } = {}) =>
  new Promise((resolve) => {
    const req = http.request({ host, port: PORT, path: p, method, headers: { host: `localhost:${PORT}`, ...headers } }, (res) => {
      let text = '';
      res.on('data', (d) => (text += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }));
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
const post = (p, body, headers = { origin: ORIGIN, 'content-type': 'application/json' }) => request('POST', p, { headers, body });
const hello = (token) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: ORIGIN } });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token })));
    ws.on('message', (m) => { resolve(JSON.parse(m.toString())); ws.close(); });
    ws.on('error', () => resolve(null));
    setTimeout(() => resolve(null), 4000);
  });

(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams.cjs'), '48986', 'MAIN.x.machineState', '1:10', '127.0.0.1.1.1'], { stdio: 'ignore' });
  const finder = spawn(process.execPath, [path.join(h.FAKES, 'fake-discovery.cjs'), '48999'], { stdio: 'ignore' });
  const dir = h.out('gw-admin');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], note: 'kept',
    discoveryPort: 48999, discoveryBroadcast: false, plcs: [], tokens: [],
  }, null, 2));
  const logFile = h.out('gw-admin-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  expect(!!(await h.waitForText(logFile, /Setup page .*http:\/\/localhost:8457\/admin/)), 'started: its setup page announced');

  // Access: this computer, its own host names, changes only from the page
  const page = await request('GET', '/admin');
  expect(page.status === 200 && /Gateway Setup/.test(page.body) && /script-src 'nonce-/.test(page.headers['content-security-policy'] || '') && page.headers['x-frame-options'] === 'DENY', 'the page, with a strict CSP');
  expect((await request('GET', '/admin/api/state', { headers: { host: `evil.example:${PORT}` } })).status === 421, 'another host name (DNS rebinding): refused');
  const lan = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
  if (lan) expect((await request('GET', '/admin', { host: lan, headers: { host: `${lan}:${PORT}` } })).status === 404, `from another address (${lan}): not there`);
  expect((await post('/admin/api/nope', {})).status === 404, 'a wrong path: 404');
  expect((await post('/admin/api/tokens', { name: 'x' }, { 'content-type': 'application/json' })).status === 403 && (await post('/admin/api/tokens', { name: 'x' }, { origin: 'https://evil.example', 'content-type': 'application/json' })).status === 403 && (await post('/admin/api/tokens', { name: 'x' }, { origin: ORIGIN, 'content-type': 'text/plain' })).status === 403, 'changes: refused without the page\'s origin and JSON');
  expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).tokens.length === 0, 'nothing written by those');
  const route = (await post('/admin/api/test', { netId: '127.0.0.1.1.1', ip: '127.0.0.1:48986', port: 851, localNetId: '10.9.9.9.1.1' })).json;
  expect(route && !route.ok && /ADS route to the gateway: AMS NetId 10\.9\.9\.9\.1\.1/.test(route.message), `test, no route for that NetId: "${route?.message}"`);
  expect(/the id is letters/.test((await post('/admin/api/plcs', { localNetId: '127.0.0.1.1.1', plcs: [{ id: 'a b', netId: '1.2.3.4.1.1' }] })).json?.error || ''), 'a bad PLC id: refused');

  // The page in a browser
  const browser = await h.launchBrowser({ defaultViewport: { width: 1200, height: 1100 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('dialog', (d) => d.accept());
  await p.goto(`${ORIGIN}/admin`, { waitUntil: 'load' });
  await p.waitForFunction(() => document.getElementById('admin-local-netid').value === '127.0.0.1.1.1', { timeout: 5000 }).catch(() => {});
  expect(await p.$eval('#admin-sub', (e) => /config\.json/.test(e.textContent)), 'loaded: its settings file named');

  await p.type('#admin-scan-addresses', '127.0.0.1');
  await p.click('#admin-scan');
  await p.waitForFunction(() => document.querySelectorAll('#admin-found tr').length >= 2, { timeout: 8000 }).catch(() => {});
  const found = await p.$$eval('#admin-found tr', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
  expect(found.length === 2 && /CX-<b>202<\/b> 127\.0\.0\.1\.1\.1 127\.0\.0\.1 3\.1\.4026 Windows 10\.0\.17763/.test(found.join(' | ')), `search: ${found.join(' | ')}`);
  expect(!(await p.$('#admin-found b')), 'a device name with markup: shown as text');
  await p.click('#admin-add-found');
  await h.sleep(200);
  let rows = await p.$$eval('#admin-plcs tr', (r) => r.map((x) => [...x.querySelectorAll('input')].map((i) => i.value)));
  expect(rows.length === 2 && rows[0][0] === 'cx-b-202-b' && rows[0][2] === '127.0.0.1.1.1' && rows[1][0] === 'cx-203' && rows[1][4] === '851', `added: ${JSON.stringify(rows)}`);
  expect(await p.$eval('#admin-found tr input', (e) => e.disabled), 'the search list marks them as in the list');

  // Edit the rows: the first to the fake PLC's forwarded ADS port, the second to nothing
  const setField = async (row, key, value) => {
    const sel = `#admin-plcs tr:nth-child(${row}) input[data-key=${key}]`;
    await p.click(sel, { clickCount: 3 });
    await p.type(sel, value);
  };
  await setField(1, 'id', 'line202');
  await setField(1, 'name', 'Line 202');
  await setField(1, 'ip', '127.0.0.1:48986');
  await setField(2, 'ip', '127.0.0.1:48987');
  await p.click('#admin-plcs tr:nth-child(1) .admin-test');
  await p.click('#admin-plcs tr:nth-child(2) .admin-test');
  await p.waitForFunction(() => [...document.querySelectorAll('#admin-plcs .status')].every((s) => !/Testing/.test(s.textContent) && s.textContent), { timeout: 10000 }).catch(() => {});
  const statuses = await p.$$eval('#admin-plcs .status', (s) => s.map((x) => `${x.className}: ${x.textContent}`));
  expect(/ok: OK: PLC on port 851 Run, TwinCAT Run \(FakePlc 3\.1\.4026\)/.test(statuses[0]), `test, the PLC: ${statuses[0]}`);
  expect(/bad: No TwinCAT router at 127\.0\.0\.1:48987/.test(statuses[1]), `test, nothing there: ${statuses[1]}`);

  // Save: config.json (the other settings kept), the running gateway offers them
  expect(await p.$eval('#admin-save', (b) => !b.disabled), 'Save enabled after the changes');
  await p.click('#admin-save');
  await p.waitForFunction(() => /Saved/.test(document.getElementById('admin-save-msg').textContent), { timeout: 5000 }).catch(() => {});
  const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  expect(saved.plcs.length === 2 && saved.plcs[0].id === 'line202' && saved.plcs[0].ip === '127.0.0.1:48986' && saved.note === 'kept' && saved.discoveryPort === 48999, `saved: ${JSON.stringify(saved.plcs.map((x) => `${x.id}@${x.ip}`))}, other settings kept`);
  expect(await p.$eval('#admin-save', (b) => b.disabled), 'Save disabled again');

  // Tokens: created (shown once), it signs in and sees the new PLCs; revoked, it no longer does
  await p.type('#admin-token-name', 'alice');
  await p.click('#admin-token-create');
  await p.waitForSelector('#admin-token-value', { timeout: 5000 }).catch(() => {});
  const token = await p.$eval('#admin-token-value', (e) => e.textContent).catch(() => '');
  const stored = JSON.parse(fs.readFileSync(configPath, 'utf8')).tokens;
  expect(token.length > 20 && stored.length === 1 && stored[0].name === 'alice' && !JSON.stringify(stored).includes(token), `token created, only its hash stored (${token.slice(0, 6)}...)`);
  const welcome = await hello(token);
  expect(welcome?.type === 'welcome' && welcome.user === 'alice' && welcome.plcs.map((x) => x.id).join() === 'line202,cx-203', `it signs in at once, with the saved PLCs: ${JSON.stringify(welcome?.plcs)}`);
  expect(/alice/.test(await p.$eval('#admin-tokens', (e) => e.innerText)), 'listed');
  await p.screenshot({ path: h.out('gateway-admin.png'), fullPage: true });
  await p.click('#admin-tokens .admin-revoke');
  await h.sleep(600);
  expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).tokens.length === 0 && !/alice/.test(await p.$eval('#admin-tokens', (e) => e.innerText)), 'revoked: gone from config.json and the list');
  expect((await hello(token))?.type === 'denied', 'the revoked token no longer signs in');
  expect(errors.length === 0, `no errors in the page ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();

  gw.kill();
  plc.kill();
  finder.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
