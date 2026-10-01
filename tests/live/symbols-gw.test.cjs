const h = require('../lib/harness.cjs');
const cfg = require('../fakes/symbols-plc.cjs').writeSymbolsPlc('fake-ams2-sym-gw.json', [], { sources: true });
// Gateway: liveBrowse and plcSources (the PLC project's sources from its boot folder) (protocol level) against
// fake-ams2.cjs with data types and the project downloaded with its sources; allowBrowse: false turns them off;
// plcBuild only with allowBuild (the stand-in compiler: KSS_BUILD_DRYRUN), writing only with allowWrite too
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
    ...(allowBrowse === false ? { allowBrowse: false } : { allowBuild: true, allowWrite: true, writeUsers: ['alice'] }),
    plcs: [{ id: 'line', name: 'Line', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48953', port: 851 }], tokens: [],
  }, null, 1));
  const token = execFileSync(process.execPath, [path.join(REPO, 'gateway', 'gateway.cjs'), 'add-token', 'tester', '--config', gwConfig], { encoding: 'utf8' }).match(/\n\s+(\S+)\s*\n/)[1];
  const gw = spawn(process.execPath, [path.join(REPO, 'gateway', 'gateway.cjs'), 'start', '--config', gwConfig], { env: { ...process.env, KSS_BUILD_DRYRUN: '1' }, stdio: ['ignore', fs.openSync(path.join(h.OUT, `gw-sym-${port}.txt`), 'w'), 'ignore'] });
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
  ws.send(JSON.stringify({ type: 'plcSources', requestId: 5 }));
  // (another PLC project on the target)
  ws.send(JSON.stringify({ type: 'plcSources', requestId: 6, plcProject: 'Line2' }));
  // The I/O tree (read-only: its boot folder's TwinCAT project)
  ws.send(JSON.stringify({ type: 'ioTree', requestId: 10 }));
  // The EtherCAT master's slave states: the PLC's own device; another system's refused
  ws.send(JSON.stringify({ type: 'ecatStates', requestId: 11, netIds: ['127.0.0.1.2.1', '10.9.9.9.2.1'] }));
  // Build with an edit (its error from the stand-in compiler); a write (not allowed); a path outside the project
  const conveyor = require('../fakes/symbols-plc.cjs').PLANT_SOURCES['POUs/Conveyor/SM_Conveyor.TcPOU'];
  ws.send(JSON.stringify({ type: 'plcBuild', requestId: 7, edits: [{ plcProject: 'Plant', path: 'POUs/Conveyor/SM_Conveyor.TcPOU', content: conveyor.replace('doState();', 'doState();\nnoSuchVar := 1;') }] }));
  ws.send(JSON.stringify({ type: 'plcBuild', requestId: 8, edits: [], write: 'online' }));
  ws.send(JSON.stringify({ type: 'plcBuild', requestId: 9, edits: [{ path: '../../x.TcPOU', content: 'x' }] }));
  await sleep(1500);
  ws.close();
  gw.kill();
  return (id) => got.find((m) => (m.type === 'liveBrowseResult' || m.type === 'plcSourcesResult' || m.type === 'plcBuildResult' || m.type === 'ioTreeResult' || m.type === 'ecatStatesResult') && m.requestId === id);
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
  const src = r(5);
  expect(src?.project === 'Plant' && (src.files ?? []).map((x) => x.path).sort().join() === 'POUs/Conveyor/E_Conveyor_States.TcDUT,POUs/Conveyor/SM_Conveyor.TcPOU,POUs/MAIN.TcPOU,POUs/Table/E_TableManager_States.TcDUT,POUs/Table/SM_TableManager.TcPOU', `plcSources: ${src?.error ?? `${src?.project}: ${(src?.files ?? []).map((x) => x.path).join(', ')}`}`);
  expect(src?.projects?.map((x) => `${x.name}:${x.port}`).join() === 'Plant:851,Line2:852' && src?.libraryTypes?.sm_doordasher === 'Tc3_Doors', `its PLC projects: ${JSON.stringify(src?.projects)}, library types: ${JSON.stringify(src?.libraryTypes)}`);
  expect(/differs from its sources \(SM_Conveyor: machineState not in the PLC's\)/.test(src?.stale ?? ''), `older than the running code: ${src?.stale}`);
  // The I/O tree: its EtherCAT device, the coupler and the terminal nested, the PLC variable linked to its channel
  const io = r(10);
  const term = io?.devices?.[0]?.boxes?.[0]?.boxes?.[0];
  expect(io?.project === 'Plant' && io.devices?.[0]?.name === 'Device 1 (EtherCAT)' && io.devices[0].boxes[0].product === 'EK1100' && term?.product === 'EL1008', `the I/O tree: ${io?.error ?? `${io?.devices?.[0]?.name} > ${io?.devices?.[0]?.boxes?.[0]?.name} > ${term?.name}`}`);
  expect(term?.pdos?.[0]?.entries?.[0]?.link === `${R}.bEnable` && term.pdos[1].entries[0].link === 'MAIN.conveyor.bStart', `its channels linked to ${term?.pdos?.map((p) => p.entries[0].link).join(', ')}`);
  // (the cabling: each box's Id, its place among the slaves, its port A)
  const coupler = io?.devices?.[0]?.boxes?.[0];
  const t3 = coupler?.boxes?.[1];
  expect(io?.devices?.[0]?.netId === '127.0.0.1.2.1' && coupler?.id === 1 && coupler.slave === 0 && coupler.portA?.master === true && term?.slave === 1 && term.portA?.box === 1 && term.portA.port === 1 && t3?.portA?.box === 2 && t3.slave === 2, `the cabling: ${JSON.stringify([coupler?.portA, term?.portA, t3?.portA])}`);
  const ec = r(11);
  const mine = ec?.masters?.['127.0.0.1.2.1'];
  expect(mine?.count === 3 && mine.slaves?.map((x) => x.name).join() === 'OP,OP,OP' && mine.slaves.every((x) => x.ok) && mine.slaves.map((x) => x.address).join() === '1001,1002,1003' && mine.slaves.every((x) => x.crc?.join() === '0,0,0,0') && /Not a device of the connected PLC/.test(ec.masters['10.9.9.9.2.1']?.error ?? ''), `ecatStates: ${JSON.stringify(ec)}`);
  const line2 = r(6);
  expect(line2?.plcProject === 'Line2' && (line2.files ?? []).map((x) => x.path).join() === 'POUs/SM_Line2.TcPOU' && !line2.stale, `plcProject Line2: ${line2?.error ?? (line2?.files ?? []).map((x) => x.path).join()}`);
  const b = r(7);
  expect(b?.ok === false && b.errors === 1 && b.items?.[0]?.text === "Identifier 'noSuchVar' not defined" && b.items[0].place?.path === 'POUs/Conveyor/SM_Conveyor.TcPOU' && b.items[0].place?.line === 2, `plcBuild (allowBuild): ${b?.fatal ?? JSON.stringify(b?.items?.[0]?.place)}`);
  expect(/tester may not write to the PLCs of this gateway \(writeUsers\)/.test(r(8)?.fatal ?? '') && /Not a PLC source path/.test(r(9)?.fatal ?? ''), `a write by someone not in writeUsers: "${r(8)?.fatal}"; outside the project: "${r(9)?.fatal}"`);
  const auditFile = fs.readdirSync(path.join(h.OUT, 'gw-sym-test')).find((f) => /^audit-.*\.jsonl$/.test(f));
  expect(!!auditFile && /"plc\.build"/.test(fs.readFileSync(path.join(h.OUT, 'gw-sym-test', auditFile), 'utf8')), 'the build in the audit log');
  r = await run(false, 8457);
  expect(/Building the PLC's project is turned off/.test(r(7)?.fatal ?? ''), `without allowBuild: "${r(7)?.fatal}"`);
  expect(/turned off/.test(r(2)?.error ?? '') && /turned off/.test(r(5)?.error ?? '') && /turned off/.test(r(10)?.error ?? '') && /turned off/.test(r(11)?.error ?? ''), `allowBrowse: false: "${r(2)?.error}", "${r(5)?.error}", "${r(10)?.error}", "${r(11)?.error}"`);
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
