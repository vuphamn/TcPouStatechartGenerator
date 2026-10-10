// runner-timeout: 1500
// The real-PLC check, on this computer's TwinCAT runtime (opt in: KSS_REAL_PLC=1; it activates a configuration of its
// own here, replacing the one active, and TwinCAT restarts):
//  1. a TwinCAT project made by a hidden XAE from TwinCAT's templates (create-project.ps1), its PLC given FB_TestCycle
//     (a state machine on E_TestState: Idle → Running (bStart) → Done (a 2 s timer)) and MAIN.fbTest
//  2. built, activated, downloaded (shared/tcBuild.cjs's buildFromProject, as the VS Code extension's Login does)
//  3. the extension's PLC parts against it: Login's check (the compile IDs), the instance, live values (an enum by
//     its name), Write Values (bStart := TRUE: Running, then Done), Stop and Start
//  4. the same through VS Code itself (real-plc.inside.cjs; this computer's VS Code, a profile of its own)
//  5. the PLC stopped at the end (its configuration stays active)
//   KSS_REAL_PLC=1 node tests/run.cjs plc
const h = require('../lib/harness.cjs');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

if (process.env.KSS_REAL_PLC !== '1') {
  console.log("skipped (KSS_REAL_PLC=1 runs it: it activates a configuration on this computer's TwinCAT runtime)");
  process.exit(0);
}
const R = h.REPO;
const b = require(path.join(R, 'shared', 'tcBuild.cjs'));
const { systemClient, localTwinCatNetId } = require(path.join(R, 'shared', 'liveSession.cjs'));
const { plcCompileId, projectBuilds, compareBuilds } = require(path.join(R, 'shared', 'tcCompileInfo.cjs'));
const { startPlc, stopPlc } = require(path.join(R, 'shared', 'tcAppInfo.cjs'));
const ads = require(path.join(R, 'shared', 'tcAds.cjs'));
const { valueText, parseValue } = require(path.join(R, 'vscode-extension', 'liveText.cjs'));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(R, 'tests', '.output', 'plc-real');

/** The test PLC's sources: FB_TestCycle, E_TestState, MAIN calling fbTest; added to the .plcproj */
function addSources(plc) {
  const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
  const guid = () => require('crypto').randomUUID();
  fs.writeFileSync(path.join(plc, 'DUTs', 'E_TestState.TcDUT'), crlf(`<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <DUT Name="E_TestState" Id="{${guid()}}">
    <Declaration><![CDATA[{attribute 'qualified_only'}
{attribute 'strict'}
TYPE E_TestState :
(
	Idle := 0,
	Running := 1,
	Done := 2
);
END_TYPE
]]></Declaration>
  </DUT>
</TcPlcObject>`));
  fs.writeFileSync(path.join(plc, 'POUs', 'FB_TestCycle.TcPOU'), crlf(`<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <POU Name="FB_TestCycle" Id="{${guid()}}" SpecialFunc="None">
    <Declaration><![CDATA[FUNCTION_BLOCK FB_TestCycle
VAR_INPUT
	bStart : BOOL;
END_VAR
VAR_OUTPUT
	bBusy : BOOL;
	nCycles : INT;
END_VAR
VAR
	State : E_TestState := E_TestState.Idle;
	tonRun : TON;
	fSpeed : LREAL := 1.5;
END_VAR
]]></Declaration>
    <Implementation>
      <ST><![CDATA[CASE State OF
	E_TestState.Idle:
		bBusy := FALSE;
		IF bStart THEN
			State := E_TestState.Running;
		END_IF
	E_TestState.Running:
		bBusy := TRUE;
		tonRun(IN := TRUE, PT := T#2S);
		IF tonRun.Q THEN
			tonRun(IN := FALSE);
			nCycles := nCycles + 1;
			State := E_TestState.Done;
		END_IF
	E_TestState.Done:
		IF NOT bStart THEN
			State := E_TestState.Idle;
		END_IF
END_CASE
]]></ST>
    </Implementation>
  </POU>
</TcPlcObject>`));
  const mainPath = path.join(plc, 'POUs', 'MAIN.TcPOU');
  const main = fs.readFileSync(mainPath, 'utf8').replace(/PROGRAM MAIN(\r?\n)VAR(\r?\n)/, 'PROGRAM MAIN$1VAR$2\tfbTest : FB_TestCycle;$2').replace('<ST><![CDATA[]]></ST>', '<ST><![CDATA[fbTest();]]></ST>');
  fs.writeFileSync(mainPath, main);
  const projPath = path.join(plc, 'KssPlc.plcproj');
  const { addToPlcproj } = require(path.join(R, 'vscode-extension', 'tcCreate.cjs'));
  let proj = fs.readFileSync(projPath, 'utf8');
  proj = addToPlcproj(addToPlcproj(proj, 'DUTs\\E_TestState.TcDUT'), 'POUs\\FB_TestCycle.TcPOU');
  fs.writeFileSync(projPath, proj);
  return main.includes('fbTest : FB_TestCycle');
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
  expect(/created/.test(made) && fs.existsSync(plcproj) && addSources(plcDir), `a project made by XAE from TwinCAT's templates, the test PLC added (${made.trim().split('\n').pop()})`);

  // 2. Built, activated, downloaded
  const t0 = Date.now();
  const onStep = (s) => console.log(`   ${((Date.now() - t0) / 1000).toFixed(0)}s ${s}`);
  const built = await b.buildFromProject(null, { file: plcproj, onStep });
  expect(built.ok && built.errors === 0, `built (${built.fatal ?? `${built.errors} errors`})`);
  let c = await systemClient({ netId, ip: '127.0.0.1' }, 851);
  const act = await b.buildFromProject(c, { file: plcproj, write: 'activate', netId, onStep });
  expect(act.ok && act.written === 'activate', `activated on this computer (${act.fatal ?? act.written})`);
  await c.disconnect().catch(() => {});
  await sleep(3000);
  c = await systemClient({ netId, ip: '127.0.0.1' }, 851);
  const dl = await b.buildFromProject(c, { file: plcproj, write: 'download', netId, onStep });
  expect(dl.ok && dl.plcRun?.state === 'Run', `downloaded, the PLC runs (${dl.fatal ?? JSON.stringify(dl.plcRun)})`);
  b.closeXae();

  // 3. The extension's PLC parts
  const cmp = compareBuilds(await plcCompileId(c), projectBuilds(plcproj));
  expect(cmp?.state === 'newest', `Login: the PLC runs the project's latest build (${cmp?.state})`);
  const inst = await ads.discoverInstances(c, 'FB_TestCycle');
  expect(inst.includes('MAIN.fbTest'), `the instance (${inst.join(', ')})`);
  const types = new Map();
  const read = async (name) => {
    const p = `MAIN.fbTest.${name}`;
    const info = await ads.probe(c, p);
    const hd = await ads.createHandle(c, p);
    const v = await ads.readTyped(c, hd, info);
    await ads.releaseHandle(c, hd);
    const dt = await ads.dataTypeInfo(c, info.type, types);
    return { value: v, text: valueText(v, { enumNames: dt?.enumValues ?? null }) };
  };
  const write = async (name, text) => {
    const p = `MAIN.fbTest.${name}`;
    const info = await ads.probe(c, p);
    const v = parseValue(text, info);
    const hd = await ads.createHandle(c, p);
    await ads.writeTyped(c, hd, info, v.value);
    await ads.releaseHandle(c, hd);
  };
  expect((await read('State')).text === 'Idle' && (await read('fSpeed')).text === '1.5', 'live values: State Idle (by its name), fSpeed 1.5');
  const n0 = (await read('nCycles')).value;
  await write('bStart', 'TRUE');
  await sleep(400);
  expect((await read('State')).text === 'Running', 'Write Values: bStart := TRUE: Running');
  await sleep(2600);
  expect((await read('State')).text === 'Done' && (await read('nCycles')).value === n0 + 1, 'after its timer: Done, one cycle more');
  await write('bStart', 'FALSE');
  await sleep(400);
  expect((await read('State')).text === 'Idle', 'bStart := FALSE: Idle');
  const st = await stopPlc(c);
  const go = await startPlc(c);
  expect(st.state === 'Stop' && go.state === 'Run', `Stop (${st.state}), Start (${go.state})`);

  // 4. Through VS Code itself (no stand-in)
  const codeExe = process.env.KSS_VSCODE || path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe');
  if (fs.existsSync(codeExe)) {
    const ext = path.join(OUT, 'ext');
    fs.mkdirSync(ext);
    require('esbuild').buildSync({ entryPoints: [path.join(R, 'vscode-extension', 'extension.js')], bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], outfile: path.join(ext, 'extension.js'), logLevel: 'warning' });
    fs.copyFileSync(path.join(R, 'vscode-extension', 'package.json'), path.join(ext, 'package.json'));
    for (const dir of ['syntaxes', 'media', 'snippets']) fs.cpSync(path.join(R, 'vscode-extension', dir), path.join(ext, dir), { recursive: true });
    const result = path.join(OUT, 'vscode.json');
    const env = { ...process.env, KSS_TEST_PROJECT: projDir, KSS_TEST_RESULT: result };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.KSS_LIVE_STANDIN;
    await new Promise((resolve) => {
      const child = spawn(codeExe, [projDir, `--extensionDevelopmentPath=${ext}`, `--extensionTestsPath=${path.join(__dirname, 'real-plc.inside.cjs')}`, `--user-data-dir=${path.join(OUT, 'user-data')}`, `--extensions-dir=${path.join(OUT, 'extensions')}`, '--disable-workspace-trust', '--skip-welcome', '--disable-gpu', '--new-window'], { env, stdio: 'ignore' });
      const t = setTimeout(() => child.kill(), 180000);
      child.on('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
    let results = [];
    try {
      results = JSON.parse(fs.readFileSync(result, 'utf8'));
    } catch {
      results = [[false, 'VS Code ran no checks']];
    }
    for (const [ok, what] of results) expect(ok, `VS Code: ${what}`);
  } else console.log('-    VS Code: not installed here (skipped)');

  // 5. Stopped
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
