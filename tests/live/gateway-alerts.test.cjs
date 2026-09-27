// Gateway alerts: a rule saved from the setup page's API; the gateway finds the machines under the root by itself
// (simulated PLC, symbols-plc.cjs), and posts to a webhook (a local receiver): an error state (aDoors[2]), stuck
// machines (limit 1.5 s), a recovery (aDoors[1] leaves DISABLED after 6 s, limit 2 s); Teams format; the test message; the
// page shows the rule watching
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8459;
const ORIGIN = `http://localhost:${PORT}`;

const request = (method, p, body) =>
  new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { host: `localhost:${PORT}`, origin: ORIGIN, 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.on('data', (d) => (text += d));
      res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }));
    });
    req.on('error', (e) => resolve({ status: 0, json: { error: e.message } }));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });

(async () => {
  // The webhook receiver
  const posts = [];
  const hook = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      try {
        posts.push({ path: req.url, body: JSON.parse(b) });
      } catch {
        posts.push({ path: req.url, body: b });
      }
      res.writeHead(200);
      res.end('1');
    });
  });
  await new Promise((r) => hook.listen(48972, '127.0.0.1', r));

  // (aDoors[1] leaves DISABLED after 6 s here: time for its limit of 2 s to pass first)
  const cfg = writeSymbolsPlc('fake-ams2-alerts.json');
  const plcConfig = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  plcConfig.script[0].hold = 6000;
  fs.writeFileSync(cfg, JSON.stringify(plcConfig));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48971', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-alerts');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line202', name: 'Line 202', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48971', port: 851 }], tokens: [],
  }, null, 2));
  const logFile = h.out('gw-alerts-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  // A bad rule is refused; the test message reaches the webhook
  const bad = await request('POST', '/admin/api/alerts', { rules: [{ plc: 'nope', webhook: 'x' }] });
  expect(bad.status === 400 && /choose one of the gateway's PLCs/.test(bad.json?.error), `a bad rule: ${bad.json?.error}`);
  const t = await request('POST', '/admin/api/alerts/test', { webhook: 'http://127.0.0.1:48972/test', format: 'teams' });
  await h.sleep(300);
  expect(t.json?.ok && posts.some((p) => p.path === '/test' && /a test message/.test(p.body.text) && Object.keys(p.body).length === 1), 'Send a test message: { text } in the Teams format');

  const saved = await request('POST', '/admin/api/alerts', { rules: [{ id: 'a1', name: 'Line 202 stuck', plc: 'line202', root: R, stuckAfterMs: 1500, stateLimits: { MAIN_RUNNING: 3600000, DOOR_DASHER_DISABLED: 2000 }, webhook: 'http://127.0.0.1:48972/hook', format: 'json' }] });
  expect(saved.status === 200 && saved.json.rules[0].onError === true && JSON.parse(fs.readFileSync(configPath, 'utf8')).alerts.length === 1, 'saved to config.json');
  await h.sleep(8000);
  const events = posts.filter((p) => p.path === '/hook').map((p) => p.body);
  console.log('   ', events.map((e) => `${e.event} ${e.machine.replace(R, '')} ${e.state}`).join(' | '));
  expect(events.some((e) => e.event === 'error' && e.machine === `${R}.aDoors[2]` && e.state === 'DOOR_DASHER_ERROR' && e.plc === 'line202' && e.plcName === 'Line 202'), 'error state: aDoors[2] in DOOR_DASHER_ERROR (name from the PLC\'s enum)');
  expect(events.some((e) => e.event === 'stuck' && e.machine === `${R}.smTable1` && /stuck in #2 for more than 1.5 s/.test(e.text) && e.durationMs >= 1500), 'stuck: smTable1 after 1.5 s');
  expect(!events.some((e) => e.event === 'stuck' && e.machine === R), 'a state with its own limit (MAIN_RUNNING: 1 h): not stuck');
  expect(events.some((e) => e.event === 'recovered' && e.machine === `${R}.aDoors[1]` && /left DOOR_DASHER_DISABLED/.test(e.text)), 'recovered: aDoors[1] left DISABLED');
  expect(events.filter((e) => e.event === 'stuck' && e.machine === `${R}.smTable2`).length === 1, 'one message per stay (no repeats)');
  const st = (await request('GET', '/admin/api/alerts')).json?.status?.[0];
  expect(st?.state === 'watching' && st.machines === 5 && !!st.lastAlert, `status: ${st?.state}, ${st?.message}`);

  // The setup page shows it
  const browser = await h.launchBrowser({ defaultViewport: { width: 1200, height: 1500 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${ORIGIN}/admin`, { waitUntil: 'load' });
  await p.waitForSelector('.admin-alert', { timeout: 5000 }).catch(() => {});
  const card = await p.$eval('.admin-alert', (e) => e.innerText).catch(() => '');
  expect(/watching: 5 machines on Line 202/.test(card) && (await p.$eval('.admin-alert input[data-key="webhook"]', (e) => e.value)) === 'http://127.0.0.1:48972/hook', 'the page: the rule, watching');
  await p.evaluate(() => document.querySelector('.admin-alert').scrollIntoView());
  await p.screenshot({ path: h.out('gateway-alerts.png') });
  expect(errors.length === 0, `no page errors ${errors.slice(0, 2).join(' | ')}`);
  await browser.close();

  // Turned off: no more monitors
  await request('POST', '/admin/api/alerts', { rules: [] });
  const after = (await request('GET', '/admin/api/alerts')).json;
  expect(after.rules.length === 0 && after.status.length === 0, 'no rules: nothing followed');
  gw.kill();
  plc.kill();
  hook.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
