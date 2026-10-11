// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// What an online change would change (shared/onlineChangeCheck.cjs), as XAE's Online Change dialog's details: the
// PLC's project compared with the local one: tasks, libraries, RETAIN / PERSISTENT variables, changed declarations,
// added and removed objects; only code changed: nothing said; comments and spacing not counted
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { onlineChangeRisks, riskLines, retainVars, localProjectFiles } = require('../../shared/onlineChangeCheck.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const pou = (name: string, decl: string, body = 'x := x + 1;') => `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <POU Name="${name}" Id="{00000000-0000-0000-0000-000000000001}" SpecialFunc="None">
    <Declaration><![CDATA[${decl}]]></Declaration>
    <Implementation>
      <ST><![CDATA[${body}]]></ST>
    </Implementation>
    <Method Name="M_Reset" Id="{00000000-0000-0000-0000-000000000002}">
      <Declaration><![CDATA[METHOD M_Reset : BOOL]]></Declaration>
    </Method>
  </POU>
</TcPlcObject>`;
const gvl = (decl: string) => `<TcPlcObject><GVL Name="GVL_Machine" Id="{1}"><Declaration><![CDATA[${decl}]]></Declaration></GVL></TcPlcObject>`;
const tto = (cycle: number, calls: string[]) => `<TcPlcObject><Task Name="PlcTask" Id="{2}"><CycleTime>${cycle}</CycleTime><Priority>20</Priority>${calls.map((c) => `<PouCall><Name>${c}</Name></PouCall>`).join('')}</Task></TcPlcObject>`;
const proj = (std: string, extra = '') => `<Project><ItemGroup>
<PlaceholderReference Include="Tc2_Standard"><DefaultResolution>Tc2_Standard, ${std} (Beckhoff Automation GmbH)</DefaultResolution></PlaceholderReference>
${extra}</ItemGroup></Project>`;

const mainDecl = `PROGRAM MAIN
VAR
  x : INT; // a counter
END_VAR`;
const plc = [
  { path: 'Plc.plcproj', content: proj('3.3.3.0', '<LibraryReference Include="Tc2_MC2, 3.3.40.0 (Beckhoff Automation GmbH)"/>') },
  { path: 'PlcTask.TcTTO', content: tto(10000, ['MAIN']) },
  { path: 'POUs/MAIN.TcPOU', content: pou('MAIN', mainDecl) },
  { path: 'POUs/FB_Axis.TcPOU', content: pou('FB_Axis', 'FUNCTION_BLOCK FB_Axis\nVAR_INPUT\n  bEnable : BOOL;\nEND_VAR') },
  { path: 'POUs/FB_Old.TcPOU', content: pou('FB_Old', 'FUNCTION_BLOCK FB_Old') },
  { path: 'GVLs/GVL_Machine.TcGVL', content: gvl('VAR_GLOBAL PERSISTENT\n  nCycles, nParts : UDINT;\n  fOffset : REAL := 1.5;\nEND_VAR\nVAR_GLOBAL RETAIN\n  bHomed : BOOL;\nEND_VAR') },
];

// 1. Only code (and a comment, spacing) changed: nothing to say
const same = onlineChangeRisks(plc, plc.map((f) => (f.path === 'POUs/MAIN.TcPOU' ? { ...f, content: pou('MAIN', mainDecl.replace('// a counter', '(* counts *)').replace('x : INT', 'x  :  INT'), 'x := x + 2;') } : f)));
expect(riskLines(same).length === 0, `only code changed: nothing said (${JSON.stringify(same)})`);

// 2. Everything changed
const local = [
  { path: 'Plc.plcproj', content: proj('3.4.10.0', '<LibraryReference Include="Tc3_EventLogger, 3.1.30.0 (Beckhoff Automation GmbH)"/>') },
  { path: 'PlcTask.TcTTO', content: tto(5000, ['MAIN', 'PRG_Safety']) },
  { path: 'POUs/MAIN.TcPOU', content: pou('MAIN', mainDecl) },
  { path: 'POUs/FB_Axis.TcPOU', content: pou('FB_Axis', 'FUNCTION_BLOCK FB_Axis\nVAR_INPUT\n  bEnable : BOOL;\n  fVelocity : LREAL;\nEND_VAR') },
  { path: 'POUs/PRG_Safety.TcPOU', content: pou('PRG_Safety', 'PROGRAM PRG_Safety') },
  { path: 'GVLs/GVL_Machine.TcGVL', content: gvl('VAR_GLOBAL PERSISTENT\n  nCycles : UDINT;\n  nParts : ULINT;\n  fOffset : REAL := 1.5;\n  sRecipe : STRING;\nEND_VAR\nVAR_GLOBAL\n  bHomed : BOOL;\nEND_VAR') },
];
const r = onlineChangeRisks(plc, local);
expect(r.tasks.length === 1 && /cycle 10000 → 5000 µs/.test(r.tasks[0].change) && /calls MAIN → MAIN, PRG_Safety/.test(r.tasks[0].change), `tasks: ${JSON.stringify(r.tasks)}`);
const libs = Object.fromEntries(r.libraries.map((l: { name: string; from: string | null; to: string | null }) => [l.name, `${l.from}>${l.to}`]));
expect(libs.Tc2_Standard === '3.3.3.0>3.4.10.0' && libs.Tc2_MC2 === '3.3.40.0>null' && libs.Tc3_EventLogger === 'null>3.1.30.0' && r.libraries.length === 3, `libraries: ${JSON.stringify(libs)}`);
const ret = Object.fromEntries(r.retain.map((v: { name: string; change: string }) => [v.name, v.change]));
expect(ret.nParts === 'UDINT → ULINT' && ret.sRecipe === 'PERSISTENT added' && ret.bHomed === 'no longer RETAIN' && !('nCycles' in ret) && !('fOffset' in ret), `retain: ${JSON.stringify(ret)}`);
expect(r.interfaces.join() === 'FB_Axis,GVL_Machine', `declarations changed: ${r.interfaces.join()} (MAIN's only by its body: not; a method's declaration not the POU's)`);
expect(r.added.join() === 'PRG_Safety' && r.removed.join() === 'FB_Old', `added ${r.added.join()}, removed ${r.removed.join()}`);
const lines = riskLines(r);
expect(lines.length === 6 && /^⚠ Tasks changed/.test(lines[0]) && /^⚠ Libraries/.test(lines[1]) && /^⚠ RETAIN/.test(lines[2]) && /GVL_Machine\.nParts \(UDINT → ULINT\)/.test(lines[2]), `the lines, the warnings first:\n  ${lines.join('\n  ')}`);

// 3. An archive without task objects or .plcproj (an older PLC): nothing said about them
const bare = onlineChangeRisks(plc.filter((f) => /\.TcPOU$/.test(f.path)), local);
expect(bare.tasks.length === 0 && bare.libraries.length === 0, 'no task objects / .plcproj on the PLC: tasks and libraries not compared');

// 4. retainVars: AT addresses, initial values, several names, a pragma
const rv = retainVars('VAR RETAIN\n  {attribute \'hide\'}\n  a, b AT %MW0 : INT := 3;\n  c : ARRAY[1..3] OF REAL;\nEND_VAR\nVAR\n  d : BOOL;\nEND_VAR');
expect([...rv.keys()].join() === 'a,b,c' && rv.get('c').type === 'ARRAY[1..3] OF REAL', `retainVars: ${JSON.stringify([...rv.values()])}`);

// 5. The local project's files: its .plcproj, sources and task objects, not its library cache
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-oc-'));
fs.mkdirSync(path.join(dir, 'POUs'));
fs.mkdirSync(path.join(dir, '_Libraries', 'x'), { recursive: true });
fs.writeFileSync(path.join(dir, 'Plc.plcproj'), String.fromCharCode(0xfeff) + '<Project/>');
fs.writeFileSync(path.join(dir, 'POUs', 'MAIN.TcPOU'), pou('MAIN', mainDecl));
fs.writeFileSync(path.join(dir, 'PlcTask.TcTTO'), tto(1, []));
fs.writeFileSync(path.join(dir, '_Libraries', 'x', 'Lib.TcPOU'), 'no');
const files = localProjectFiles(path.join(dir, 'Plc.plcproj'));
expect(files.map((f: { path: string }) => f.path).sort().join() === 'POUs/MAIN.TcPOU,Plc.plcproj,PlcTask.TcTTO' && files[0].content === '<Project/>', `localProjectFiles: ${files.map((f: { path: string }) => f.path).join()}`);
fs.rmSync(dir, { recursive: true, force: true });

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
