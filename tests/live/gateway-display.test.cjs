// A display (gateway, simulated PLC symbols-plc.cjs): a view-only token made on the setup page (its board link); signed
// in with it, the board's messages only (an acknowledge, going live: refused); the board's PLCs carry the notes written
// live through the gateway (the audit log's live.event "note"). In a browser (the build in dist/): ?board&view=<token>
// shows the board without asking for a token, says "view only", no Acknowledge, no Maintenance, tiles not links, the note.
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
const PORT = 8475;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'display-test-token';

const post = (p, body) =>
  new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'POST', headers: { host: `localhost:${PORT}`, origin: BASE, 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.on('data', (d) => (text += d));
      res.on('end', () => resolve((() => { try { return JSON.parse(text); } catch { return null; } })()));
    });
    req.on('error', () => resolve(null));
    req.write(JSON.stringify(body));
    req.end();
  });

function client(token) {
  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  const ready = new Promise((r) => ws.on('open', r)).then(() => ws.send(JSON.stringify({ type: 'hello', token })));
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
  const cfg = writeSymbolsPlc('fake-ams2-display.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48950', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-display');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // (a note written live a minute ago, as the gateway's audit log keeps it)
  const now = Date.now();
  const month = `${new Date(now).getFullYear()}-${String(new Date(now).getMonth() + 1).padStart(2, '0')}`;
  fs.writeFileSync(path.join(dir, `audit-${month}.jsonl`), `${JSON.stringify({ t: now - 60_000, user: 'ann', action: 'live.event', plc: 'line202', pou: 'SM_Door', instance: `${R}.aDoors[1]`, kind: 'note', text: 'jam cleared here', at: now - 60_000 })}\n`);
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [],
    plcs: [{ id: 'line202', name: 'Line 202', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48950', port: 851 }],
    tokens: [{ name: 'operator', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
  }, null, 2));
  const logFile = h.out('gw-display-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  // 1. The setup page: a view-only token, its board link
  const made = await post('/admin/api/tokens', { name: 'TV line 202', view: true });
  const viewToken = made?.token;
  expect(!!viewToken && made.view === true && new RegExp(`/\\?board&view=${viewToken}$`).test(made.boardUrl ?? '') && made.state.tokens.some((t) => t.name === 'TV line 202' && t.view === true), `a view-only token and its link: ${made?.boardUrl}`);
  const stored = JSON.parse(fs.readFileSync(configPath, 'utf8')).tokens.find((t) => t.name === 'TV line 202');
  expect(stored?.view === true && !!stored.sha256 && !JSON.stringify(stored).includes(viewToken), 'kept as a hash, marked view only');

  // 2. Signed in with it: the board and its notes; nothing else
  const d = client(viewToken);
  await d.ready;
  const welcome = await d.wait((m) => m.type === 'welcome');
  expect(welcome?.viewOnly === true && welcome.features.length === 0, `welcome: view only (${JSON.stringify(welcome?.features)})`);
  d.send({ type: 'boardWatch', plcs: ['line202'] });
  const board = await d.wait((m) => m.type === 'boardState' && m.plcs[0]?.machines.length > 0);
  const notes = board?.plcs[0].notes ?? [];
  expect(notes.length === 1 && notes[0].text === 'jam cleared here' && notes[0].user === 'ann' && notes[0].pou === 'SM_Door', `the board's notes: ${JSON.stringify(notes)}`);
  d.send({ type: 'alertAck', requestId: 7, id: 'x', note: 'n' });
  const ack = await d.wait((m) => m.type === 'alertAckResult');
  d.send({ type: 'liveStart', plc: 'line202', instance: `${R}.aDoors[1]`, stateVar: 'machineState' });
  const live = await d.wait((m) => m.type === 'liveStatus');
  d.send({ type: 'maintenanceSet', requestId: 8, plc: 'line202', minutes: 10 });
  const maint = await d.wait((m) => m.type === 'maintenanceSetResult');
  expect(ack?.ok === false && ack.requestId === 7 && /view-only/.test(ack.error) && live?.state === 'error' && /view-only/.test(live.message) && maint?.ok === false, 'an acknowledge, going live, maintenance: refused');
  d.ws.close();
  // (a full token: not view only)
  const o = client(TOKEN);
  await o.ready;
  const ow = await o.wait((m) => m.type === 'welcome');
  expect(ow && !ow.viewOnly && ow.features.length > 0, 'a full token: not view only');
  // (the shift report: the notes written in its window, in its text and CSV)
  o.send({ type: 'report', requestId: 9, which: 'today' });
  const rep = await o.wait((m) => m.type === 'reportResult' && m.requestId === 9);
  expect(rep?.summary.notes === 1 && /1 note: "jam cleared here" \(ann\)/.test(rep.summary.text) && /note at,by,plc,pou,note/.test(rep.csv) && /,ann,line202,SM_Door,jam cleared here/.test(rep.csv), `the report's notes: ${rep?.summary.text}`);
  o.ws.close();

  // 3. In a browser: the display link
  if (!fs.existsSync(path.join(h.REPO, 'dist', 'index.html'))) console.log('skipped the browser part: no dist/ (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 900 } });
    const p = await browser.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/?board&title=Line%20202&plcs=line202&view=${encodeURIComponent(viewToken)}`, { waitUntil: 'load' });
    const tile = await h.until(() => p.$eval('.board-tile', (e) => ({ tag: e.tagName, href: e.getAttribute('href') })).catch(() => null), 15000);
    const ui = await p.evaluate(() => ({
      viewOnly: !!document.getElementById('board-view-only'),
      signIn: !!document.getElementById('board-token'),
      maintenance: document.querySelectorAll('.board-maintenance-btn').length,
      report: !!document.getElementById('board-report'),
      note: document.querySelector('.board-note')?.textContent ?? '',
      status: document.getElementById('board-status')?.textContent ?? '',
    }));
    expect(!!tile && tile.href === null && ui.viewOnly && !ui.signIn && ui.maintenance === 0 && !ui.report, `the display: view only, no sign-in, no Maintenance, no report, tiles not links (${JSON.stringify(tile)})`);
    expect(/jam cleared here/.test(ui.note) && /ann/.test(ui.note), `the note on the board: ${ui.note}`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
