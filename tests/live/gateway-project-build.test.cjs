const h = require('../lib/harness.cjs');
// The gateway: Build from the page's TwinCAT project folder (protocol level; its stand-in compiler, KSS_BUILD_DRYRUN):
// its welcome says it can (allowBuild), the folder's files mirrored (one gzip-compressed, the second list needs none),
// built there; a write refused for a user not in writeUsers, and Start the PLC too
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const I = 'MAIN.mainStateMachine.smTable';

(async () => {
  const plcCfg = h.out('fake-ams2-gwproj.json');
  fs.writeFileSync(plcCfg, JSON.stringify({ symbols: { [`${I}.machineState`]: { type: 'E_States', dataType: 2, size: 2, value: 1 } } }));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48959', plcCfg], { stdio: 'ignore' });
  const gwDir = h.out('gw-proj-test');
  fs.rmSync(gwDir, { recursive: true, force: true });
  fs.mkdirSync(gwDir, { recursive: true });
  const gwConfig = path.join(gwDir, 'config.json');
  fs.writeFileSync(gwConfig, JSON.stringify({
    port: 8471, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [],
    allowBuild: true, allowWrite: true, writeUsers: ['someone-else'],
    plcs: [{ id: 'line', name: 'Line', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48959', port: 851 }], tokens: [],
  }, null, 1));
  const token = execFileSync(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'add-token', 'tester', '--config', gwConfig], { encoding: 'utf8' }).match(/\n\s+(\S+)\s*\n/)[1];
  const gwLog = h.out('gw-proj-test-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', gwConfig], { env: { ...process.env, KSS_BUILD_DRYRUN: '1', KSS_BUILD_RUN_WAIT_MS: '800' }, stdio: ['ignore', fs.openSync(gwLog, 'w'), fs.openSync(gwLog, 'a')] });
  await sleep(1500);

  const ws = new WebSocket('ws://localhost:8471/live');
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    inbox.push(m);
    for (const w of [...waiters]) if (w.test(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const next = (test, ms = 20000) => new Promise((resolve) => {
    const hit = inbox.find(test);
    if (hit) return resolve(hit);
    waiters.push({ test, resolve });
    setTimeout(() => resolve(null), ms);
  });
  let id = 1;
  const ask = (m, reply, ms) => { const requestId = id++; ws.send(JSON.stringify({ ...m, requestId })); return next((x) => x.type === reply && x.requestId === requestId, ms); };
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token }));
  const welcome = await next((m) => m.type === 'welcome');
  expect(welcome?.features?.includes('projectBuild') && welcome.features.includes('plcStart'), `welcome: ${JSON.stringify(welcome?.features)}`);
  ws.send(JSON.stringify({ type: 'liveStart', plc: 'line', stateVar: 'machineState', instance: I }));
  const live = await next((m) => m.type === 'liveStatus' && (m.state === 'connected' || m.state === 'error'));
  expect(live?.state === 'connected', `live: ${live?.state} ${live?.message ?? ''}`);

  // The folder: its list, the files needed (one compressed), built there
  const pou = Buffer.from(`<?xml version="1.0"?>\n<TcPlcObject><POU Name="SM_A">${'<!-- x -->'.repeat(400)}</POU></TcPlcObject>`);
  const files = { 'Plant.tsproj': Buffer.from('<TcSmProject/>'), 'Plant/Plant.plcproj': Buffer.from('<Project/>'), 'Plant/POUs/SM_A.TcPOU': pou };
  const t = Date.now() - 60000;
  const list = Object.entries(files).map(([p, b]) => ({ path: p, size: b.length, mtime: t }));
  const sync = await ask({ type: 'projectSync', project: 'Plant', files: list }, 'projectSyncResult');
  expect(!!sync?.uploadId && sync.need?.length === 3, `the list: ${sync?.need?.length} files needed`);
  for (const p of sync?.need ?? []) {
    const gz = p.endsWith('.TcPOU');
    const data = gz ? zlib.gzipSync(files[p]) : files[p];
    const r = await ask({ type: 'projectPut', uploadId: sync.uploadId, path: p, offset: 0, data: data.toString('base64'), size: files[p].length, mtime: t, done: true, ...(gz ? { encoding: 'gzip' } : {}) }, 'projectPutResult');
    if (!r?.ok) expect(false, `${p}: ${r?.error}`);
  }
  const again = await ask({ type: 'projectSync', project: 'Plant', files: list }, 'projectSyncResult');
  expect(again?.uploadId === sync?.uploadId && again.need?.length === 0, `listed again: ${again?.need?.length} needed (one sent compressed, ${zlib.gzipSync(pou).length} bytes for ${pou.length})`);
  const built = await ask({ type: 'projectBuild', uploadId: sync.uploadId, file: 'Plant/POUs/SM_A.TcPOU', edits: [{ file: 'Plant/POUs/SM_A.TcPOU', content: pou.toString() }] }, 'plcBuildResult', 60000);
  expect(built?.ok === true && /build: tester built for line from a project folder: ok/.test(fs.readFileSync(gwLog, 'utf8')), `built on the gateway: ${built?.ok ? 'ok' : built?.fatal}`);

  // Writes: not for this user (writeUsers)
  const write = await ask({ type: 'projectBuild', uploadId: sync.uploadId, file: 'Plant/POUs/SM_A.TcPOU', edits: [], write: 'online' }, 'plcBuildResult');
  const start = await ask({ type: 'plcStart' }, 'plcStartResult');
  expect(/tester may not write to the PLCs of this gateway \(writeUsers\)/.test(write?.fatal ?? '') && /may not write/.test(start?.error ?? ''), `a write refused ("${write?.fatal}"), Start too ("${start?.error}")`);
  const outside = await ask({ type: 'projectPut', uploadId: sync.uploadId, path: '../evil.TcPOU', offset: 0, data: '', done: true }, 'projectPutResult');
  expect(!!outside?.error, `a path outside the folder refused: ${outside?.error}`);

  ws.close();
  await sleep(300);
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
