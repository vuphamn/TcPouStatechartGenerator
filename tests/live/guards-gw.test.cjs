const h = require('../lib/harness.cjs');
// Gateway and Link: liveWatch -> liveWatchResult + liveVars against fake-ams2.cjs (protocol level)
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
const REPO = h.REPO;
const I = 'MAIN.mainStateMachine.smTableManager';
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const config = {
  symbols: {
    [`${I}.machineState`]: { type: 'E_TableManager_States', dataType: 2, size: 2, value: 2 },
    [`${I}.cmd_bHome`]: { type: 'BOOL', dataType: 33, size: 1, value: true },
    [`${I}.nCount`]: { type: 'DINT', dataType: 3, size: 4, value: -7 },
    [`${I}.fSpeed`]: { type: 'REAL', dataType: 4, size: 4, value: 1.5 },
    [`${I}.sName`]: { type: 'STRING(20)', dataType: 30, size: 21, value: 'door 42' },
    [`GVL.bGlobal`]: { type: 'BOOL', dataType: 33, size: 1, value: false },
    [`${I}.stCfg`]: { type: 'ST_Cfg', dataType: 65, size: 64, value: 0 },
  },
  script: [{ hold: 1500, set: { [`${I}.cmd_bHome`]: false, [`${I}.fSpeed`]: 2.25 } }],
};
const vars = [
  { id: 'cmd_bhome', candidates: [`${I}.cmd_bHome`] },
  { id: 'ncount', candidates: [`${I}.nCount`] },
  { id: 'fspeed', candidates: [`${I}.fSpeed`] },
  { id: 'sname', candidates: [`${I}.sName`] },
  { id: 'gvl.bglobal', candidates: [`${I}.GVL.bGlobal`, 'GVL.bGlobal'] },
  { id: 'stcfg', candidates: [`${I}.stCfg`] },
  { id: 'blocal', candidates: [`${I}.bLocal`] },
];

async function session(url, hello, start, label) {
  const got = [];
  const ws = new WebSocket(url, { headers: { Origin: url.replace(/^ws/, 'http').replace(/\/live$/, '') } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  ws.on('error', (e) => console.log(`   ${label} socket error: ${e.message}`));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify(hello));
  await sleep(500);
  ws.send(JSON.stringify(start));
  // Watch before the session is connected: applied once it is
  ws.send(JSON.stringify({ type: 'liveWatch', vars }));
  await sleep(3500);
  const results = got.filter((m) => m.type === 'liveWatchResult').flatMap((m) => m.vars);
  const values = got.filter((m) => m.type === 'liveVars').flatMap((m) => m.values);
  const last = (id) => values.filter((v) => v.id === id).pop()?.v;
  const res = (id) => results.find((r) => r.id === id);
  console.log(`   ${label}: status ${got.filter((m) => m.type === 'liveStatus').map((m) => m.state).join(' > ')}; results ${results.map((r) => `${r.id}${r.error ? '!' : ''}`).join(', ')}`);
  expect(res('cmd_bhome')?.type === 'BOOL' && last('cmd_bhome') === false && (label === 'link' || values.some((v) => v.id === 'cmd_bhome' && v.v === true)), `${label}: BOOL read${label === 'link' ? ' (the script already ran)' : ', then its change'}`);
  expect(last('ncount') === -7 && Math.abs(last('fspeed') - 2.25) < 1e-6 && last('sname') === 'door 42', `${label}: DINT ${last('ncount')}, REAL ${last('fspeed')}, STRING '${last('sname')}'`);
  expect(res('gvl.bglobal')?.symbol === 'GVL.bGlobal' && last('gvl.bglobal') === false, `${label}: a global path, second candidate (${res('gvl.bglobal')?.symbol})`);
  expect(/not a simple value/.test(res('stcfg')?.error || '') && /not in the PLC/.test(res('blocal')?.error || ''), `${label}: a structure and a missing variable are reported`);
  // A smaller set: the others are released
  ws.send(JSON.stringify({ type: 'liveWatch', vars: vars.slice(0, 1) }));
  await sleep(800);
  // Malformed: ignored
  ws.send(JSON.stringify({ type: 'liveWatch', vars: [{ id: 'x', candidates: ['MAIN.x; DROP'] }] }));
  await sleep(400);
  ws.send(JSON.stringify({ type: 'liveStop' }));
  await sleep(800);
  ws.close();
  return got;
}

(async () => {
  const plcLog = path.join(h.OUT, 'fake-ams2-gw.txt');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48954', path.join(h.OUT, 'fake-ams2-gw.json')], { stdio: ['ignore', fs.openSync(plcLog, 'w'), fs.openSync(plcLog, 'a')] });
  fs.writeFileSync(path.join(h.OUT, 'fake-ams2-gw.json'), JSON.stringify(config));

  // Gateway from the repository (shared/ one level up), plain HTTP for the test
  const gwDir = path.join(h.OUT, 'gw-test');
  fs.mkdirSync(gwDir, { recursive: true });
  const gwConfig = path.join(gwDir, 'config.json');
  fs.writeFileSync(gwConfig, JSON.stringify({
    port: 8455, insecure: true, appDir: path.join(REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], maxViewers: 5, maxWatchedVariables: 10,
    plcs: [{ id: 'line202', name: 'Line 202', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48954', port: 851 }], tokens: [],
  }, null, 1));
  const out = execFileSync(process.execPath, [path.join(REPO, 'gateway', 'gateway.cjs'), 'add-token', 'tester', '--config', gwConfig], { encoding: 'utf8' });
  const token = out.match(/\n\s+(\S+)\s*\n/)[1];
  const gwLog = path.join(h.OUT, 'gw-test-run.txt');
  const gw = spawn(process.execPath, [path.join(REPO, 'gateway', 'gateway.cjs'), 'start', '--config', gwConfig], { stdio: ['ignore', fs.openSync(gwLog, 'w'), fs.openSync(gwLog, 'a')] });
  await sleep(1500);
  await session('ws://localhost:8455/live', { type: 'hello', token }, { type: 'liveStart', plc: 'line202', stateVar: 'machineState', instance: I }, 'gateway');
  const plcText = fs.readFileSync(plcLog, 'utf8');
  expect(/release handle .*nCount/.test(plcText) && !/release handle .*cmd_bHome[\s\S]*add notification \d+ for .*cmd_bHome/.test(plcText.split('release handle')[0] ?? ''), 'gateway: dropped variables released');
  gw.kill();

  // Link (the desktop app's session code)
  const linkLog = path.join(h.OUT, 'link-test-run.txt');
  const link = spawn(process.execPath, [path.join(REPO, 'link', 'link.cjs'), '--port', '48961'], { stdio: ['ignore', fs.openSync(linkLog, 'w'), fs.openSync(linkLog, 'a')], env: { ...process.env, APPDATA: path.join(h.OUT, 'link-appdata') } });
  await sleep(1500);
  const code = (await h.waitForText(linkLog, /Pairing code:\s+(\S+)/))?.[1];
  await session('ws://127.0.0.1:48961/live', { type: 'hello', token: code }, { type: 'liveStart', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48954', stateVar: 'machineState', instance: I }, 'link');
  link.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
