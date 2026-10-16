// runner-timeout: 1500
// FB_KvalEventRelay on this computer's TwinCAT runtime (opt in: KSS_REAL_PLC=1; it activates a configuration of its own
// here, replacing the one active, and TwinCAT restarts):
//  1. a TwinCAT project made by a hidden XAE from TwinCAT's templates (create-project.ps1); Tc3_EventLogger added;
//     ST_KvalEvent, FB_KvalEventRelay and its methods from the gateway's own gateway/plc/FB_KvalEventRelay.st (what a
//     user downloads); MAIN: the relay, a message and an alarm of TwinCAT's own ADS event class to send, raise, clear
//  2. built, activated, downloaded, run
//  3. a gateway reading the relay live: the message kept with its text; the alarm raised an alert, cleared resolved
//  4. the PLC stopped at the end (its configuration stays active)
//   KSS_REAL_PLC=1 node tests/run.cjs plc --filter real-eventrelay
const h = require('../lib/harness.cjs');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');

if (process.env.KSS_REAL_PLC !== '1') {
  console.log("skipped (KSS_REAL_PLC=1 runs it: it activates a configuration on this computer's TwinCAT runtime)");
  process.exit(0);
}
const R = h.REPO;
const b = require(path.join(R, 'shared', 'tcBuild.cjs'));
const { systemClient, localTwinCatNetId } = require(path.join(R, 'shared', 'liveSession.cjs'));
const { stopPlc } = require(path.join(R, 'shared', 'tcAppInfo.cjs'));
const ads = require(path.join(R, 'shared', 'tcAds.cjs'));
const WebSocket = require(require.resolve('ws', { paths: [R] }));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(R, 'tests', '.output', 'plc-eventrelay');
const PORT = 8541;
const TOKEN = 'real-relay-token';

/** gateway/plc/FB_KvalEventRelay.st in its parts: the DUT, the FB's declaration, each method's declaration and body */
function partsOf(text) {
  const parts = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\/\/ ===== (DUT|POU|METHOD)[^=]*=====\s*$/.exec(line);
    if (m) {
      cur = { kind: m[1], lines: [] };
      parts.push(cur);
    } else if (cur) cur.lines.push(line);
  }
  return parts.map((p) => {
    const body = p.lines.join('\r\n').trim();
    if (p.kind !== 'METHOD') return { kind: p.kind, decl: body };
    const [decl, impl] = body.split(/\r?\n\/\/ ----- its implementation -----\r?\n/);
    return { kind: 'METHOD', name: /^METHOD\s+(?:PRIVATE\s+|PUBLIC\s+|PROTECTED\s+)?(\w+)/.exec(decl)[1], decl: decl.trim(), impl: (impl ?? '').trim() };
  });
}

function addSources(plc) {
  const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
  const guid = () => crypto.randomUUID();
  const parts = partsOf(fs.readFileSync(path.join(R, 'gateway', 'plc', 'FB_KvalEventRelay.st'), 'utf8'));
  const dut = parts.find((p) => p.kind === 'DUT');
  const pou = parts.find((p) => p.kind === 'POU');
  const methods = parts.filter((p) => p.kind === 'METHOD');
  fs.writeFileSync(path.join(plc, 'DUTs', 'ST_KvalEvent.TcDUT'), crlf(`<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <DUT Name="ST_KvalEvent" Id="{${guid()}}">
    <Declaration><![CDATA[${dut.decl}
]]></Declaration>
  </DUT>
</TcPlcObject>`));
  fs.writeFileSync(path.join(plc, 'POUs', 'FB_KvalEventRelay.TcPOU'), crlf(`<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <POU Name="FB_KvalEventRelay" Id="{${guid()}}" SpecialFunc="None">
    <Declaration><![CDATA[${pou.decl}
]]></Declaration>
    <Implementation>
      <ST><![CDATA[]]></ST>
    </Implementation>
${methods.map((m) => `    <Method Name="${m.name}" Id="{${guid()}}">
      <Declaration><![CDATA[${m.decl}
]]></Declaration>
      <Implementation>
        <ST><![CDATA[${m.impl}
]]></ST>
      </Implementation>
    </Method>`).join('\n')}
  </POU>
</TcPlcObject>`));
  const mainPath = path.join(plc, 'POUs', 'MAIN.TcPOU');
  const vars = ['\tfbEventRelay : FB_KvalEventRelay;', '\tfbMsg : FB_TcMessage;', '\tfbAlarm : FB_TcAlarm;', '\tbInit : BOOL := TRUE;', '\tbSend : BOOL;', '\tbRaise : BOOL;', '\tbClear : BOOL;', '\thrInit : HRESULT;'].join('\r\n');
  const body = [
    '// (once: a message and an alarm of TwinCAT\'s own ADS event class)',
    'IF bInit THEN',
    '\tbInit := FALSE;',
    '\thrInit := fbMsg.CreateEx(TC_EVENTS.TcGeneralAdsEventClass.DeviceTimeout, 0);',
    '\tfbAlarm.CreateEx(TC_EVENTS.TcGeneralAdsEventClass.NotReady, FALSE, 0);',
    'END_IF',
    'IF bSend THEN',
    '\tbSend := FALSE;',
    '\tfbMsg.Send(0);',
    'END_IF',
    'IF bRaise THEN',
    '\tbRaise := FALSE;',
    '\tfbAlarm.Raise(0);',
    'END_IF',
    'IF bClear THEN',
    '\tbClear := FALSE;',
    '\tfbAlarm.Clear(0, FALSE);',
    'END_IF',
    'fbEventRelay.Execute();',
  ].join('\r\n');
  const main = fs.readFileSync(mainPath, 'utf8').replace(/PROGRAM MAIN(\r?\n)VAR(\r?\n)/, (all, a, c) => `PROGRAM MAIN${a}VAR${c}${vars}${c}`).replace('<ST><![CDATA[]]></ST>', () => `<ST><![CDATA[${body}]]></ST>`);
  fs.writeFileSync(mainPath, main);
  const projPath = path.join(plc, 'KssPlc.plcproj');
  const { addToPlcproj } = require(path.join(R, 'vscode-extension', 'tcCreate.cjs'));
  let proj = fs.readFileSync(projPath, 'utf8');
  proj = addToPlcproj(addToPlcproj(proj, 'DUTs\\ST_KvalEvent.TcDUT'), 'POUs\\FB_KvalEventRelay.TcPOU');
  fs.writeFileSync(projPath, proj);
  const { addLibrary, editPlcproj } = require(path.join(R, 'vscode-extension', 'libraryEdit.cjs'));
  editPlcproj(projPath, (x) => addLibrary(x, { name: 'Tc3_EventLogger', vendor: 'Beckhoff Automation GmbH' }));
  return { methods: methods.map((m) => m.name), main: main.includes('fbEventRelay : FB_KvalEventRelay'), lib: fs.readFileSync(projPath, 'utf8').includes('Tc3_EventLogger') };
}

(async () => {
  const netId = localTwinCatNetId();
  if (!netId) {
    console.log('skipped (TwinCAT is not installed on this computer)');
    process.exit(0);
  }
  // 1. The project
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const projDir = path.join(OUT, 'proj');
  const made = execFileSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'create-project.ps1'), '-Dir', projDir], { encoding: 'utf8', timeout: 300000 });
  const plcDir = path.join(projDir, 'KssLocalTest', 'KssPlc');
  const plcproj = path.join(plcDir, 'KssPlc.plcproj');
  const added = /created/.test(made) && fs.existsSync(plcproj) ? addSources(plcDir) : null;
  expect(added?.main && added.lib && added.methods.join() === 'Execute,AddEvent,OnMessageSent,OnAlarmRaised,OnAlarmCleared,OnAlarmConfirmed', `a project made by XAE, FB_KvalEventRelay from gateway/plc/FB_KvalEventRelay.st (${added?.methods?.join(', ')}), Tc3_EventLogger added`);

  // 2. Built, activated, downloaded
  const t0 = Date.now();
  const onStep = (s) => console.log(`   ${((Date.now() - t0) / 1000).toFixed(0)}s ${s}`);
  const built = await b.buildFromProject(null, { file: plcproj, onStep });
  expect(built.ok && built.errors === 0, `built (${built.fatal ?? `${built.errors} errors`}${built.messages?.length ? `: ${built.messages.slice(0, 3).join(' | ')}` : ''})`);
  let c = await systemClient({ netId, ip: '127.0.0.1' }, 851, { allowNoPlc: true });
  const act = await b.buildFromProject(c, { file: plcproj, write: 'activate', netId, onStep });
  expect(act.ok && act.written === 'activate', `activated on this computer (${act.fatal ?? act.written})`);
  await c.disconnect().catch(() => {});
  await sleep(3000);
  c = await systemClient({ netId, ip: '127.0.0.1' }, 851, { allowNoPlc: true });
  const dl = await b.buildFromProject(c, { file: plcproj, write: 'download', netId, onStep });
  expect(dl.ok && dl.plcRun?.state === 'Run', `downloaded, the PLC runs (${dl.fatal ?? JSON.stringify(dl.plcRun)})`);
  b.closeXae();
  const read = async (p) => {
    const info = await ads.probe(c, p);
    const hd = await ads.createHandle(c, p);
    try {
      return await ads.readTyped(c, hd, info);
    } finally {
      await ads.releaseHandle(c, hd);
    }
  };
  const write = async (p, v) => {
    const info = await ads.probe(c, p);
    const hd = await ads.createHandle(c, p);
    try {
      await ads.writeTyped(c, hd, info, v);
    } finally {
      await ads.releaseHandle(c, hd);
    }
  };
  await sleep(1500);
  // 3. A gateway reading it live
  const dir = path.join(OUT, 'gw');
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(R, 'dist'), allowedOrigins: [],
    plcs: [{ id: 'local', name: 'This PC', netId, ip: '127.0.0.1', port: 851 }],
    tokens: [{ name: 'tech', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    eventlog: { live: { local: 'MAIN.fbEventRelay' } },
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false }, axes: { enabled: false },
  }, null, 2));
  const logFile = path.join(OUT, 'gw-run.txt');
  const gw = spawn(process.execPath, [path.join(R, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  try {
    await h.waitForText(logFile, /Setup page/);
    const kept = () => {
      try {
        return fs.readFileSync(path.join(dir, 'eventlog', 'local.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    };
    await sleep(3000);
    await write('MAIN.bSend', true);
    const msg = await h.until(() => kept().find((e) => e.state === 'message' && /timeout/i.test(e.text)), 20000);
    expect(!!msg && msg.source === 'MAIN' && /Device has a timeout/.test(msg.text) && msg.severity === 'Error' && Math.abs(msg.t - Date.now()) < 60000, `its message, live: ${msg ? `${msg.severity} "${msg.text}" from ${msg.source}` : 'none'} (${kept().length} kept)`);
    const got = [];
    const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: `http://localhost:${PORT}` } });
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: TOKEN }));
    await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
    const history = async () => {
      got.length = 0;
      ws.send(JSON.stringify({ type: 'alertsList' }));
      return (await h.until(() => got.find((m) => m.type === 'alertsList')?.events, 5000)) ?? [];
    };
    await write('MAIN.bRaise', true);
    const raised = await h.until(() => history().then((ev) => ev.find((e) => e.event === 'plcEvent')), 20000);
    expect(!!raised && raised.machine === 'MAIN: Device is not ready to operate.' && !raised.resolvedAt, `its alarm raised: an alert "${raised?.text}"`);
    await write('MAIN.bClear', true);
    const cleared = await h.until(() => history().then((ev) => ev.find((e) => e.event === 'plcEvent' && e.resolvedAt)), 20000);
    const seq = Number(await read('MAIN.fbEventRelay.nSeq'));
    expect(!!cleared && kept().some((e) => e.state === 'cleared') && seq >= 3, `cleared: its alert resolved (${cleared?.resolvedAt}); the relay's ring at event ${seq}`);
    ws.close();
  } finally {
    gw.kill();
  }

  // 4. Stopped
  const end = await stopPlc(c);
  expect(end.state === 'Stop', `the PLC stopped at the end (${end.state})`);
  await c.disconnect().catch(() => {});
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  b.closeXae();
  process.exit(2);
});
