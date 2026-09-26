const h = require('../lib/harness.cjs');
const cfg = require('../fakes/symbols-plc.cjs').writeSymbolsPlc();
// Gateway: liveBrowse (protocol level) against fake-ams2.cjs with data types; allowBrowse: false turns it off
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
const REPO = h.REPO;
const R = 'MAIN.mainStateMachine';
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

async function run(allowBrowse, port) {
  const gwDir = path.join(h.OUT, 'gw-sym-test');
  fs.mkdirSync(gwDir, { recursive: true });
  const gwConfig = path.join(gwDir, `config-${port}.json`);
  fs.writeFileSync(gwConfig, JSON.stringify({
    port, insecure: true, appDir: path.join(REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], maxViewers: 5, maxWatchedVariables: 100,
    ...(allowBrowse === false ? { allowBrowse: false } : {}),
    plcs: [{ id: 'line', name: 'Line', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48953', port: 851 }], tokens: [],
  }, null, 1));
  const token = execFileSync(process.execPath, [path.join(REPO, 'gateway', 'gateway.cjs'), 'add-token', 'tester', '--config', gwConfig], { encoding: 'utf8' }).match(/\n\s+(\S+)\s*\n/)[1];
  const gw = spawn(process.execPath, [path.join(REPO, 'gateway', 'gateway.cjs'), 'start', '--config', gwConfig], { stdio: ['ignore', fs.openSync(path.join(h.OUT, `gw-sym-${port}.txt`), 'w'), 'ignore'] });
  await sleep(1500);
  const got = [];
  const ws = new WebSocket(`ws://localhost:${port}/live`, { headers: { Origin: `http://localhost:${port}` } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token }));
  await sleep(400);
  // Before going live: refused
  ws.send(JSON.stringify({ type: 'liveBrowse', requestId: 1, path: R, stateVar: 'machineState' }));
  ws.send(JSON.stringify({ type: 'liveStart', plc: 'line', stateVar: 'machineState', instance: `${R}.smTable1` }));
  await sleep(2000);
  ws.send(JSON.stringify({ type: 'liveBrowse', requestId: 2, path: R, stateVar: 'machineState' }));
  ws.send(JSON.stringify({ type: 'liveBrowse', requestId: 3, path: `${R}.aDoors`, stateVar: 'machineState' }));
  ws.send(JSON.stringify({ type: 'liveBrowse', requestId: 4, path: 'MAIN.x; DROP', stateVar: 'machineState' }));
  await sleep(1500);
  ws.close();
  gw.kill();
  return (id) => got.find((m) => m.type === 'liveBrowseResult' && m.requestId === id);
}

(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48953', cfg], { stdio: 'ignore' });
  let r = await run(true, 8456);
  expect(r(1)?.error === 'Not connected', `before going live: "${r(1)?.error}"`);
  const root = r(2);
  const names = (root?.children ?? []).map((c) => `${c.name}:${c.kind}${c.stateMachine ? '*' : ''}`);
  expect(root?.symbolType === 'FB_MainStateMachine' && names.includes('nCount:value') && names.includes('smTable2:struct*') && names.includes('pTarget:other'), `root: ${root?.symbolType}: ${names.join(' ')}`);
  expect((r(3)?.children ?? []).map((c) => c.path).join() === `${R}.aDoors[1],${R}.aDoors[2]`, `array: ${(r(3)?.children ?? []).map((c) => c.name).join(' ')}`);
  expect(r(4)?.error === 'Not a symbol path', `malformed path refused: "${r(4)?.error}"`);
  r = await run(false, 8457);
  expect(/turned off/.test(r(2)?.error ?? ''), `allowBrowse: false: "${r(2)?.error}"`);
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
