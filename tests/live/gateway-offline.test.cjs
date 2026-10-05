const h = require('../lib/harness.cjs');
// The gateway, before going live on one of its PLCs (protocol level, fake-ams2.cjs): a POU type's instances there
// (the one to follow chosen first), its PLCs' states, one stopped, started again, restarted (a write: allowWrite and
// writeUsers, as Start PLC; each in its audit log); the welcome says what it offers. Without allowWrite: refused
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PLC = 48934;
const cfg = require('../fakes/symbols-plc.cjs').writeSymbolsPlc('fake-ams2-gw-offline.json', [], { sources: true });

async function gateway(port, write) {
  const dir = path.join(h.OUT, 'gw-offline-test');
  fs.mkdirSync(dir, { recursive: true });
  const config = path.join(dir, `config-${port}.json`);
  fs.writeFileSync(config, JSON.stringify({
    port, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], maxViewers: 5, maxWatchedVariables: 100,
    ...(write ? { allowWrite: true, writeUsers: ['tester'] } : {}),
    plcs: [{ id: 'line', name: 'Line', netId: '127.0.0.1.1.1', ip: `127.0.0.1:${PLC}`, port: 851 }, { id: 'gone', name: 'Gone', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48933', port: 851 }], tokens: [],
  }, null, 1));
  const token = execFileSync(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'add-token', 'tester', '--config', config], { encoding: 'utf8' }).match(/\n\s+(\S+)\s*\n/)[1];
  const out = path.join(h.OUT, `gw-offline-${port}.txt`);
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', config], { env: { ...process.env, KSS_SERVICE_DRYRUN: '1' }, stdio: ['ignore', fs.openSync(out, 'w'), 'ignore'] });
  await h.waitForText(out, /listening|https?:\/\//i, 15000).catch(() => {});
  await sleep(500);
  const got = [];
  const ws = new WebSocket(`ws://localhost:${port}/live`, { headers: { Origin: `http://localhost:${port}` } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r, j) => (ws.on('open', r), ws.on('error', j)));
  ws.send(JSON.stringify({ type: 'hello', token }));
  const reply = async (type, requestId, ms = 20000) => {
    for (let t = 0; t < ms && !got.some((m) => m.type === type && (requestId === undefined || m.requestId === requestId)); t += 150) await sleep(150);
    return got.find((m) => m.type === type && (requestId === undefined || m.requestId === requestId));
  };
  const ask = (m, type) => (ws.send(JSON.stringify(m)), reply(type, m.requestId));
  return { gw, ws, reply, ask, dir, out };
}

(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), String(PLC), cfg], { stdio: 'ignore' });
  await sleep(1000);
  let a = null;
  let b = null;
  try {
    a = await gateway(48932, true);
    const welcome = await a.reply('welcome');
    const f = welcome?.features ?? [];
    expect(['instancesOffline', 'plcStatesRefresh', 'plcStartAt', 'plcStopAt'].every((x) => f.includes(x)), `the welcome says what it offers (${f.join(', ')})`);
    // Instances, not live
    const two = await a.ask({ type: 'liveInstances', requestId: 1, plc: 'line', typeName: 'SM_TableManager', stateVar: 'machineState' }, 'liveInstancesResult');
    expect((two?.instances ?? []).length === 2 && two.plcState === 'Run', `SM_TableManager's instances: ${two?.error ?? two?.instances?.join(', ')}`);
    const nope = await a.ask({ type: 'liveInstances', requestId: 2, plc: 'nope', typeName: 'SM_TableManager' }, 'liveInstancesResult');
    expect(/Choose one of the gateway/.test(nope?.error ?? ''), `a PLC it does not have: "${nope?.error}"`);
    // The states of its PLCs
    const st = await a.ask({ type: 'plcStates', requestId: 3, plcs: ['line', 'gone', 'nope'] }, 'plcStatesResult');
    const [line, gone] = st?.devices ?? [];
    expect(st?.devices?.length === 2 && line?.id === 'line' && line.state?.plc === 'Run' && line.state.project === 'Plant' && !!gone?.state?.error, `their states: ${JSON.stringify(st?.devices?.map((d) => [d.id, d.state]))}`);
    // Stopped, started again, restarted
    const stop = await a.ask({ type: 'plcStartAt', requestId: 4, plc: 'line', mode: 'stop' }, 'plcStartAtResult');
    expect(stop?.ok === true && stop.state === 'Stop', `stopped: ${JSON.stringify(stop)}`);
    const st2 = await a.ask({ type: 'plcStates', requestId: 5, plcs: ['line'] }, 'plcStatesResult');
    expect(st2?.devices?.[0]?.state?.plc === 'Stop', `its state now: ${st2?.devices?.[0]?.state?.plc}`);
    const start = await a.ask({ type: 'plcStartAt', requestId: 6, plc: 'line', mode: 'plc' }, 'plcStartAtResult');
    expect(start?.ok === true && start.state === 'Run', `started again: ${JSON.stringify(start)}`);
    const restart = await a.ask({ type: 'plcStartAt', requestId: 7, plc: 'line', mode: 'restart' }, 'plcStartAtResult');
    expect(restart?.ok === true && restart.state === 'Run', `restarted: ${JSON.stringify(restart)}`);
    const bad = await a.ask({ type: 'plcStartAt', requestId: 8, plc: 'line', mode: 'explode' }, 'plcStartAtResult');
    expect(bad?.ok === false && /Start, stop/.test(bad.error ?? ''), `an unknown mode refused: "${bad?.error}"`);
    await sleep(500);
    const audit = fs.readdirSync(a.dir).filter((x) => /^audit-.*\.jsonl$/.test(x)).map((x) => fs.readFileSync(path.join(a.dir, x), 'utf8')).join('');
    expect(['plc.stop', 'plc.start', 'plc.restart'].every((x) => audit.includes(`"${x}"`)), 'each in its audit log');
    const logged = fs.readFileSync(a.out, 'utf8').match(/plc: tester [^\n]*/g) ?? [];
    expect(logged.some((l) => /stopped line: Stop/.test(l)) && logged.some((l) => /restarted line: Run/.test(l)), `logged: ${logged.join(' | ')}`);
    a.ws.close();

    // Without allowWrite: the states, not a start
    b = await gateway(48931, false);
    const wb = await b.reply('welcome');
    expect(!(wb?.features ?? []).includes('plcStartAt') && (wb?.features ?? []).includes('plcStatesRefresh'), `without allowWrite: states only (${(wb?.features ?? []).join(', ')})`);
    const refused = await b.ask({ type: 'plcStartAt', requestId: 9, plc: 'line', mode: 'stop' }, 'plcStartAtResult');
    expect(refused?.ok === false && /allowWrite/.test(refused.error ?? ''), `a stop refused: "${refused?.error}"`);
    b.ws.close();
  } finally {
    a?.gw.kill();
    b?.gw.kill();
    plc.kill();
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
