// Alarm shelving (gateway/shelves.cjs; simulated PLC symbols-plc.cjs, its states changed by the test; the web app
// from dist/): one shelved needs a reason and at most the gateway's hours; while shelved, its error is kept muted
// ("shelved: why"), not posted to the rule's webhook, not open; another machine's error still is; unshelved, the
// next one is posted again; who did what in the audit log. On the board: Shelve… on an alert, the shelved list.
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
const PORT = 8533;
const BASE = `http://localhost:${PORT}`;
const D1 = `${R}.aDoors[1]`;
const D2 = `${R}.aDoors[2]`;
const TOKEN = 'shelve-test-token';

(async () => {
  // The rule's webhook
  const posts = [];
  const hook = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      try {
        posts.push(JSON.parse(b));
      } catch {
        posts.push(b);
      }
      res.writeHead(200);
      res.end('1');
    });
  });
  await new Promise((r) => hook.listen(8535, '127.0.0.1', r));
  // (aDoors[1] DISABLED, aDoors[2] in DOOR_DASHER_ERROR; the test moves them: a control file)
  const cfg = writeSymbolsPlc('fake-ams2-shelve.json');
  const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  const controlFile = h.out('fake-ams2-shelve-control.json');
  fs.rmSync(controlFile, { force: true });
  c.controlFile = controlFile;
  c.script = [];
  fs.writeFileSync(cfg, JSON.stringify(c));
  const set = (values) => fs.writeFileSync(controlFile, JSON.stringify({ set: values }));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48948', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-shelve');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 5', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48948', port: 851 }], tokens: [{ name: 'op', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    alerts: [{ id: 'a1', name: 'Line 5', enabled: true, plc: 'line', root: R, stateVar: 'machineState', stuckAfterMs: null, stateLimits: {}, onError: true, errorPattern: 'ERROR', notifyRecovery: false, webhook: 'http://127.0.0.1:8535/hook', format: 'json' }],
    alarms: { maxShelveHours: 8 },
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-shelve-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token: TOKEN }));
  await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
  let id = 100;
  const ask = async (msg, reply) => {
    const requestId = ++id;
    ws.send(JSON.stringify({ ...msg, requestId }));
    return h.until(() => got.find((m) => m.type === reply && m.requestId === requestId), 10000);
  };
  const history = async () => {
    ws.send(JSON.stringify({ type: 'alertsList' }));
    return h.until(() => [...got].reverse().find((m) => m.type === 'alertsList')?.events, 5000);
  };
  // 1. aDoors[2]'s error, posted; aDoors[1]'s error state shelved (before it is in it)
  await h.until(() => posts.find((p) => p.machine === D2 && p.event === 'error'), 20000);
  const noReason = await ask({ type: 'alarmShelve', shelf: { plc: 'line', machine: D1, state: 'DOOR_DASHER_ERROR', hours: 2, reason: '' } }, 'shelfResult');
  const tooLong = await ask({ type: 'alarmShelve', shelf: { plc: 'line', machine: D1, state: 'DOOR_DASHER_ERROR', hours: 24, reason: 'x' } }, 'shelfResult');
  const shelved = await ask({ type: 'alarmShelve', shelf: { plc: 'line', machine: D1, state: 'DOOR_DASHER_ERROR', hours: 2, reason: 'sensor S12 to replace' } }, 'shelfResult');
  ws.send(JSON.stringify({ type: 'shelvesWatch' }));
  const watching = await h.until(() => [...got].reverse().find((m) => m.type === 'shelves' && m.active?.length === 1), 5000);
  expect(noReason?.ok === false && /reason/.test(noReason.error) && tooLong?.ok === false && /at most 8 hours/.test(tooLong.error) && shelved?.ok && shelved.shelf.plcName === 'Line 5' && watching?.maxHours === 8, `shelved for 2 h (no reason: ${noReason?.error}; 24 h: ${tooLong?.error}); the list: ${watching?.active?.map((s) => `${s.machine} ${s.state}`)}`);
  // 2. aDoors[1] into its error: kept muted, not posted (aDoors[2]'s was)
  const before = posts.length;
  set({ [`${D1}.machineState`]: 7 });
  const seen = await h.until(() => fs.readFileSync(logFile, 'utf8').match(/error \S*aDoors\[1\] muted \(shelved/), 15000);
  await h.sleep(1500);
  const newPosts = posts.slice(before);
  got.length = 0;
  const events = (await history()) ?? [];
  const mutedOne = events.find((e) => e.machine === D1 && e.event === 'error' && e.muted);
  expect(!!seen && !newPosts.some((p) => p.machine === D1) && posts.some((p) => p.machine === D2) && mutedOne?.muted === 'shelved: sensor S12 to replace' && !!mutedOne.resolvedAt, `while shelved: aDoors[1]'s error kept muted (${mutedOne?.muted}), not posted (${newPosts.length} new posts); aDoors[2]'s posted`);
  // 3. Unshelved: its next error posted again; said in the history; in the audit log
  const un = await ask({ type: 'alarmUnshelve', id: shelved?.shelf?.id }, 'shelfResult');
  const again = await ask({ type: 'alarmUnshelve', id: shelved?.shelf?.id }, 'shelfResult');
  const before2 = posts.length;
  set({ [`${D1}.machineState`]: 0 });
  await h.sleep(1500);
  set({ [`${D1}.machineState`]: 7 });
  await h.until(() => posts.slice(before2).find((p) => p.machine === D1 && p.event === 'error'), 15000);
  got.length = 0;
  const events2 = (await history()) ?? [];
  const audit = fs.readdirSync(dir).filter((f) => /^audit-.*\.jsonl$/.test(f)).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
  expect(un?.ok && un.shelf.ended === 'unshelved' && again?.ok === false && posts.slice(before2).some((p) => p.machine === D1) && events2.some((e) => e.event === 'shelf' && /unshelved by/.test(e.text)) && /alarm\.shelve/.test(audit) && /alarm\.unshelve/.test(audit), `unshelved: its error posted again; "${events2.find((e) => e.event === 'shelf')?.text}"; the audit log`);
  ws.close();

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('board-alert-shelve'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1500, height: 900 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/?board`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', TOKEN);
    await p.keyboard.press('Enter');
    // (Shelve… on aDoors[2]'s open error: 1 h, why)
    const btn = await h.until(() => p.$$('.board-alert .board-alert-shelve').then((x) => (x.length ? x : null)), 20000);
    const card = await p.evaluateHandle((b) => b.closest('.board-alert'), btn?.[0]);
    const which = await card.evaluate((e) => e.textContent);
    await btn?.[0]?.click();
    await p.select('.board-shelve-hours', '1');
    await p.type('.board-shelve-reason', 'checking the hinge');
    await p.click('.board-shelve-ok');
    const list = await h.until(() => p.$eval('#board-shelved', (e) => e.textContent).catch(() => null), 8000);
    await p.click('#board-shelved button');
    const rows = await p.$$eval('.board-shelf', (x) => x.map((e) => e.textContent));
    expect(/1 alarm\(s\) shelved/.test(list ?? '') && rows.some((r) => /checking the hinge/.test(r ?? '')) && /aDoors/.test(which ?? ''), `the board: "${list}"; ${rows.join(' | ')}`);
    await p.click('.board-unshelve');
    const gone = await h.until(() => p.$('#board-shelved').then((x) => (x ? null : true)), 8000);
    expect(!!gone && !errors.length, `unshelved from the board; no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  hook.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
