// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The VS Code extension's help while writing Structured Text: the checks (a method's local never used; a plain name
// declared nowhere: not a keyword, an ALL_CAPS name, a call, a library's name, nor in a POU that extends a library's),
// IntelliSense (after a dot: an FB instance's inputs, outputs, methods; an enum's members; else the names visible),
// parameter hints (a method's VAR_INPUT …), the Solution tree of a .plcproj, a value typed for a variable and its bytes
// (Write Values), and what XAE did kept for the next time (its dialogs; a Remote Manager build that stopped it)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { checkSection, projectNames, extendsUnknown } = require('../../vscode-extension/stChecks.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { completionsAt, signatureAt } = require('../../vscode-extension/stCompletion.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createIndex } = require('../../vscode-extension/stReferences.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readPlcTree } = require('../../vscode-extension/plcTree.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseValue, valueText, ADST } = require('../../vscode-extension/liveText.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ads = require('../../shared/tcAds.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pou, dut } = require('../fixtures/third-party-pou.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// A project: FB_ScanSequencer, its enum, and FB_Cell that has an instance of it
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-assist-'));
const plc = path.join(root, 'Robot');
fs.mkdirSync(path.join(plc, 'POUs'), { recursive: true });
fs.writeFileSync(path.join(root, 'Cell.tsproj'), '<TcSmProject/>');
fs.writeFileSync(path.join(plc, 'POUs', 'FB_ScanSequencer.TcPOU'), pou);
fs.writeFileSync(path.join(plc, 'POUs', 'E_ScanState.TcDUT'), dut);
const cellFile = path.join(plc, 'POUs', 'FB_Cell.TcPOU');
fs.writeFileSync(cellFile, `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <POU Name="FB_Cell" Id="{00000000-0000-0000-0000-0000000000c1}" SpecialFunc="None">
    <Declaration><![CDATA[FUNCTION_BLOCK FB_Cell
VAR
	fbScan : FB_ScanSequencer;
	nCycles : INT;
END_VAR]]></Declaration>
    <Implementation>
      <ST><![CDATA[fbScan.Execute();]]></ST>
    </Implementation>
    <Method Name="Tick" Id="{00000000-0000-0000-0000-0000000000c2}">
      <Declaration><![CDATA[METHOD Tick : BOOL
VAR_INPUT
	bFast : BOOL;
END_VAR
VAR
	nUsed : INT;
	nNever : INT;
END_VAR]]></Declaration>
      <Implementation>
        <ST><![CDATA[nUsed := nCycles + 1;
IF bFast AND fbScan.Busy THEN
	nCyles := nUsed;
	MAX_SPEED := 2;
	F_Library(1);
	RETURN;
END_IF]]></ST>
      </Implementation>
    </Method>
  </POU>
</TcPlcObject>`);
const files = createIndex().project(root);
const tickDecl = 'METHOD Tick : BOOL\nVAR_INPUT\n\tbFast : BOOL;\nEND_VAR\nVAR\n\tnUsed : INT;\n\tnNever : INT;\nEND_VAR';
const tickImpl = 'nUsed := nCycles + 1;\nIF bFast AND fbScan.Busy THEN\n\tnCyles := nUsed;\n\tMAX_SPEED := 2;\n\tF_Library(1);\n\tRETURN;\nEND_IF';

// Checks: nNever unused (not bFast, an input); nCyles (a typo) undeclared; MAX_SPEED, F_Library(), RETURN not
const unused = checkSection({ section: 'decl', text: tickDecl, implText: tickImpl, files });
expect(JSON.stringify(unused.map((u: { message: string }) => u.message)) === JSON.stringify(['nNever is declared but never used']), `unused: the method's own variable only (${unused.map((u: { message: string }) => u.message).join('; ')})`);
const und = checkSection({ section: 'impl', text: tickImpl, declText: tickDecl, files, known: projectNames(files) });
expect(und.length === 1 && /^nCyles /.test(und[0].message) && und[0].line === 2, `undeclared: the typo only, not an ALL_CAPS name, a call or a keyword (${und.map((u: { message: string; line: number }) => `${u.line + 1}: ${u.message}`).join('; ')})`);
const withLib = projectNames(files);
withLib.add('ncyles');
expect(checkSection({ section: 'impl', text: tickImpl, declText: tickDecl, files, known: withLib }).length === 0, "a library's name: not flagged");
expect(checkSection({ section: 'impl', text: tickImpl, declText: tickDecl, files, baseUnknown: true }).length === 0 && extendsUnknown(files, cellFile) === false, "a POU that extends a library's: not checked (its members are not known)");

// IntelliSense after a dot: FB_ScanSequencer's outputs and methods (not its VAR); the enum's members
const at = (text: string, key = 'Method:Tick') => completionsAt(files, { file: cellFile, key, section: 'impl', text, offset: text.length }).map((c: { label: string }) => c.label);
const fb = at('fbScan.');
expect(['Busy', 'Done', 'State', 'Execute', 'Start'].every((n) => fb.includes(n)) && !fb.includes('_Count'), `fbScan.: its outputs and methods, not its own VAR (${fb.join(', ')})`);
const en = at('E_ScanState.');
expect(JSON.stringify(en.slice(0, 3)) === JSON.stringify(['InitializeScan', 'MoveToStart', 'ResetData']), `E_ScanState.: its members (${en.slice(0, 4).join(', ')})`);
const plain = at('n');
expect(['nUsed', 'bFast', 'fbScan', 'nCycles', 'Tick', 'FB_ScanSequencer', 'E_ScanState'].every((n) => plain.includes(n)), `else: the method's, the POU's, the types (${plain.length} names)`);
// Parameter hints: MoveAndAdvance( inside FB_ScanSequencer; the second parameter after a comma
const scanFile = path.join(plc, 'POUs', 'FB_ScanSequencer.TcPOU');
const sig = signatureAt(files, { file: scanFile, key: 'Method:Execute', text: 'MoveAndAdvance(ProgramNumber := 3, ', offset: 'MoveAndAdvance(ProgramNumber := 3, '.length });
expect(!!sig && sig.params.map((p: { name: string }) => p.name).slice(0, 2).join(',') === 'ProgramNumber,StartX' && sig.active === 1, `parameter hints: MoveAndAdvance's, the second (${JSON.stringify(sig)})`);

// The Solution tree of a .plcproj: folders, files, references
const plcproj = path.join(plc, 'Robot.plcproj');
fs.writeFileSync(plcproj, `<Project>
  <ItemGroup>
    <Folder Include="POUs" />
    <Folder Include="POUs\\Cell" />
    <Folder Include="DUTs" />
    <Compile Include="POUs\\Cell\\FB_Cell.TcPOU" />
    <Compile Include="POUs\\MAIN.TcPOU" />
    <Compile Include="DUTs\\E_ScanState.TcDUT" />
    <Compile Include="PlcTask.TcTTO" />
  </ItemGroup>
  <ItemGroup>
    <PlaceholderReference Include="Tc2_Standard" />
    <LibraryReference Include="Tc2_MC2, 3.3.75.0 (Beckhoff Automation GmbH)" />
  </ItemGroup>
</Project>`);
const tree = readPlcTree(plcproj);
type Node = { name: string; children?: Node[]; ext?: string };
const show = (l: Node[]): string => l.map((n) => (n.children ? `${n.name}[${show(n.children)}]` : `${n.name}.${n.ext}`)).join(' ');
expect(show(tree.children) === 'DUTs[E_ScanState.TcDUT] POUs[Cell[FB_Cell.TcPOU] MAIN.TcPOU] PlcTask.TcTTO' && tree.references.join(',') === 'Tc2_MC2,Tc2_Standard', `the PLC project's tree (${show(tree.children)}; ${tree.references.join(', ')})`);

// A value typed for a variable, and its bytes
const enumNames = { 0: 'InitializeScan', 3: 'FastScan' };
expect(parseValue('FastScan', { dataType: ADST.INT16, size: 2 }, enumNames).value === 3 && parseValue('E_ScanState.FastScan', { dataType: ADST.INT16, size: 2 }, enumNames).value === 3, 'an enum: by its member, qualified or not');
expect(parseValue('true', { dataType: ADST.BIT, size: 1 }).value === true && !!parseValue('yes', { dataType: ADST.BIT, size: 1 }).error, 'BOOL: TRUE / FALSE only');
expect(parseValue('16#FF', { dataType: ADST.UINT8, size: 1 }).value === 255 && !!parseValue('256', { dataType: ADST.UINT8, size: 1 }).error && parseValue('-3', { dataType: ADST.INT16, size: 2 }).value === -3, 'integers: 16#FF, the type\'s range');
expect(parseValue("'abc'", { dataType: ADST.STRING, size: 81 }).value === 'abc' && !!parseValue('x'.repeat(81), { dataType: ADST.STRING, size: 81 }).error, 'STRING: quotes optional, its length');
expect(valueText(parseValue('2.5', { dataType: ADST.REAL64, size: 8 }).value) === '2.5', 'LREAL');
const bytes = (v: unknown, dataType: number, size: number) => [...ads.encodeTyped(v, { dataType, size })].join(',');
expect(bytes(true, 33, 1) === '1' && bytes(-2, 2, 2) === '254,255' && bytes(1.5, 4, 4) === '0,0,192,63' && bytes('Hi', 30, 4) === '72,105,0,0', `encoded (BOOL, INT, REAL, STRING: ${bytes(-2, 2, 2)} | ${bytes('Hi', 30, 4)})`);
expect((() => { try { ads.encodeTyped(70000, { dataType: 2, size: 2 }); return false; } catch { return true; } })(), 'out of its range: refused');

// What XAE did, kept: its dialogs, a Remote Manager build that stopped it with a project
process.env.KSS_STATE_DIR = path.join(root, 'state');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tcBuild = require('../../shared/tcBuild.cjs');
tcBuild.noteRmBuild(path.join(root, 'Cell.tsproj'), '4026.3', true);
expect(!!tcBuild.rmCrashesFor(path.join(root, 'Cell.tsproj'))['4026.3'] && !tcBuild.rmCrashesFor('Other.tsproj')['4026.3'], 'a build that stopped XAE: remembered for that project');
tcBuild.noteRmBuild(path.join(root, 'Cell.tsproj'), '4026.3', false);
expect(!tcBuild.rmCrashesFor(path.join(root, 'Cell.tsproj'))['4026.3'], 'built with it later: forgotten');
fs.rmSync(root, { recursive: true, force: true });

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
