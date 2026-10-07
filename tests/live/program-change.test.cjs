const h = require('../lib/harness.cjs');
// Gateway and Link (the desktop app's session code) against fake-ams2.cjs, at the protocol level: connected, the
// followed instance's own type is said (instanceType: the app compares it with the loaded POU); another program
// downloaded while connected (the PLC's symbol version changes): programChanged is said (the app connects again)
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPO = h.REPO;
const I = 'MAIN.mainStateMachine';
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const config = {
  symbolVersion: 7,
  symbols: {
    [I]: { type: 'TransferTable', dataType: 65, size: 1024, value: 0 },
    [`${I}.mainState`]: { type: 'INT', dataType: 2, size: 2, value: 0 },
  },
  // (once followed: another program downloaded 2.5 s later)
  script: [{ hold: 2500, symbolVersion: 8, retype: { [I]: 'EFX' } }],
};

/** A fake PLC of its own (its script runs once) */
function fakePlc(port, name) {
  const file = path.join(h.OUT, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(config));
  const log = path.join(h.OUT, `${name}.txt`);
  return spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), String(port), file], { stdio: ['ignore', fs.openSync(log, 'w'), fs.openSync(log, 'a')] });
}

async function session(url, hello, start, label) {
  const got = [];
  const ws = new WebSocket(url, { headers: { Origin: url.replace(/^ws/, 'http').replace(/\/live$/, '') } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  ws.on('error', (e) => console.log(`   ${label} socket error: ${e.message}`));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify(hello));
  await sleep(500);
  ws.send(JSON.stringify(start));
  const changed = () => got.some((m) => m.type === 'liveStatus' && m.state === 'programChanged');
  for (let t = 0; t < 12000 && !changed(); t += 250) await sleep(250);
  const statuses = got.filter((m) => m.type === 'liveStatus');
  console.log(`   ${label}: status ${statuses.map((m) => m.state).join(' > ')}`);
  const connected = statuses.find((m) => m.state === 'connected');
  expect(connected?.instance === I && connected.instanceType === 'TransferTable', `${label}: connected, the instance's own type said (${connected?.instanceType})`);
  const change = statuses.find((m) => m.state === 'programChanged');
  expect(!!change && /program changed/i.test(change.message ?? ''), `${label}: another program downloaded: said (${change?.message})`);
  ws.send(JSON.stringify({ type: 'liveStop' }));
  await sleep(500);
  ws.close();
}

(async () => {
  const plcs = [fakePlc(48956, 'fake-ams2-program-gw'), fakePlc(48957, 'fake-ams2-program-link')];
  try {
    // Gateway from the repository, plain HTTP for the test
    const gwDir = path.join(h.OUT, 'gw-program');
    fs.mkdirSync(gwDir, { recursive: true });
    const gwConfig = path.join(gwDir, 'config.json');
    fs.writeFileSync(gwConfig, JSON.stringify({
      port: 8457, insecure: true, appDir: path.join(REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], maxViewers: 5, maxWatchedVariables: 10,
      plcs: [{ id: 'efx', name: 'EFX', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48956', port: 851 }], tokens: [],
    }, null, 1));
    const out = execFileSync(process.execPath, [path.join(REPO, 'gateway', 'gateway.cjs'), 'add-token', 'tester', '--config', gwConfig], { encoding: 'utf8' });
    const token = out.match(/\n\s+(\S+)\s*\n/)[1];
    const gwLog = path.join(h.OUT, 'gw-program-run.txt');
    const gw = spawn(process.execPath, [path.join(REPO, 'gateway', 'gateway.cjs'), 'start', '--config', gwConfig], { stdio: ['ignore', fs.openSync(gwLog, 'w'), fs.openSync(gwLog, 'a')] });
    await sleep(1500);
    await session('ws://localhost:8457/live', { type: 'hello', token }, { type: 'liveStart', plc: 'efx', stateVar: 'mainState', instance: I }, 'gateway');
    gw.kill();

    // Link (the desktop app's session code)
    const linkLog = path.join(h.OUT, 'link-program-run.txt');
    const link = spawn(process.execPath, [path.join(REPO, 'link', 'link.cjs'), '--port', '48963'], { stdio: ['ignore', fs.openSync(linkLog, 'w'), fs.openSync(linkLog, 'a')], env: { ...process.env, APPDATA: path.join(h.OUT, 'link-program-appdata') } });
    await sleep(1500);
    const code = (await h.waitForText(linkLog, /Pairing code:\s+(\S+)/))?.[1];
    await session('ws://127.0.0.1:48963/live', { type: 'hello', token: code }, { type: 'liveStart', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48957', stateVar: 'mainState', instance: I }, 'link');
    link.kill();
  } finally {
    for (const p of plcs) p.kill();
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
