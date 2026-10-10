// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The VS Code extension's Find All References and Go to Definition (vscode-extension/stReferences.cjs) on a project
// of three files: a POU (FB_ScanSequencer: its body's VAR, Execute(), helpers), its enum (E_ScanState) and a base POU
// it EXTENDS. Names in comments, strings and pragmas are no references; case is ignored; a definition is the nearest
// declaration: a method's own VAR, the POU's, a base's (EXTENDS), the enum named before a dot; a place in the file is
// found in its section (Go to code)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { blankCode, declarationsIn, createIndex, nameAt, findReferences, findDefinition } = require('../../vscode-extension/stReferences.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readSection, sectionAt } = require('../../vscode-extension/tcStSource.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pou, dut } = require('../fixtures/third-party-pou.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
type Hit = { file: string; key: string; section: string; line: number; column: number; declaration?: boolean };
const where = (r: Hit) => `${path.basename(r.file)}@${r.key || '(body)'}/${r.section}:${r.line + 1}`;

// Blanked: comments ((* *) nested, //, /* */), strings, pragmas; positions kept
const sample = "x := 1; // State\n(* a (* State *) b *) y := 'State';\n{attribute 'State'} z := State;";
const b = blankCode(sample);
expect(!/State.*State.*State/.test(b) && /z := State;$/.test(b) && b.split('\n').length === 3 && b.length === sample.length, `comments, strings, pragmas blanked (${JSON.stringify(b)})`);
// Declarations: header, variables (a, b), AT, enum members (inline and TYPE)
const d = declarationsIn(blankCode("METHOD Move : BOOL\nVAR_INPUT\n\ta, b : INT;\n\tx AT %I* : BOOL;\n\tPhase : (Idle, Busy := 5, Done) := Idle;\nEND_VAR"));
expect(JSON.stringify(d.map((x: { name: string; kind: string }) => `${x.kind}:${x.name}`)) === JSON.stringify(['header:Move', 'var:a', 'var:b', 'var:x', 'var:Phase', 'enum:Idle', 'enum:Busy', 'enum:Done']), `declarations (${d.map((x: { name: string; kind: string }) => `${x.kind}:${x.name}`).join(', ')})`);

// The project: the POU EXTENDS a base with _Base; its enum
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-refs-'));
fs.mkdirSync(path.join(root, 'Robot', 'POUs'), { recursive: true });
fs.writeFileSync(path.join(root, 'Cell.tsproj'), '<TcSmProject/>');
const fb = pou.replace(/FUNCTION_BLOCK FB_ScanSequencer/, 'FUNCTION_BLOCK FB_ScanSequencer EXTENDS FB_CellBase');
const pouFile = path.join(root, 'Robot', 'POUs', 'FB_ScanSequencer.TcPOU');
fs.writeFileSync(pouFile, fb);
fs.writeFileSync(path.join(root, 'Robot', 'POUs', 'E_ScanState.TcDUT'), dut);
fs.writeFileSync(path.join(root, 'Robot', 'POUs', 'FB_CellBase.TcPOU'), `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <POU Name="FB_CellBase" Id="{00000000-0000-0000-0000-0000000000b1}" SpecialFunc="None">
    <Declaration><![CDATA[FUNCTION_BLOCK FB_CellBase
VAR
	ErrorID : UDINT;
END_VAR]]></Declaration>
    <Implementation>
      <ST><![CDATA[]]></ST>
    </Implementation>
  </POU>
</TcPlcObject>`);
const files = createIndex().project(root);
expect(files.length === 3, `the project's files (${files.map((f: { file: string }) => path.basename(f.file)).join(', ')})`);

// References: State, every use (its declaration marked), none in comments
const refs: Hit[] = findReferences(files, 'state');
const code = (r: Hit) => (readSection(fb, r.key, r.section) ?? '').split('\n')[r.line].slice(r.column, r.column + 5);
expect(refs.length > 5 && refs.every((r) => code(r) === 'State' || code(r) === 'state') && refs.some((r) => r.declaration && r.key === '' && r.section === 'decl'), `State: ${refs.length} uses, its declaration among them (${refs.filter((r) => r.declaration).map(where).join(', ')})`);
expect(refs.some((r) => r.key === 'Method:Execute' && r.section === 'impl') && refs.some((r) => r.key === 'Method:Start'), 'in Execute() and Start()');
// Definitions: the POU's variable, a method's own parameter, a base's variable, the enum's member after a dot
const def = (key: string, name: string, qualifier: string | null = null) => findDefinition(files, { file: pouFile, key, name, qualifier }).map(where).join(', ');
expect(def('Method:Execute', 'State') === "FB_ScanSequencer.TcPOU@(body)/decl:" + (readSection(fb, '', 'decl').split('\n').findIndex((l: string) => /^\s*State\s*:/.test(l)) + 1), `State in Execute(): the POU's VAR (${def('Method:Execute', 'State')})`);
expect(/FB_ScanSequencer\.TcPOU@Method:MoveAndAdvance\/decl:/.test(def('Method:MoveAndAdvance', 'NextState')) && !/AdvanceWhenDone/.test(def('Method:MoveAndAdvance', 'NextState')), `NextState in MoveAndAdvance(): its own parameter (${def('Method:MoveAndAdvance', 'NextState')})`);
expect(def('Method:Execute', 'ErrorID').startsWith('FB_ScanSequencer') || def('Method:Execute', 'ErrorID').startsWith('FB_CellBase'), `ErrorID: declared here or in the base FB_CellBase (${def('Method:Execute', 'ErrorID')})`);
expect(/^E_ScanState\.TcDUT@\(body\)\/decl:\d+$/.test(def('Method:Execute', 'FastScan', 'E_ScanState')), `E_ScanState.FastScan: the enum's member (${def('Method:Execute', 'FastScan', 'E_ScanState')})`);
expect(/FB_ScanSequencer\.TcPOU@Method:Execute\/decl:/.test(def('', 'execute')), `Execute (any case): the method's header (${def('', 'execute')})`);
// (the name at a place, and before a dot)
const n = nameAt('\tState := E_ScanState.ResetData;', 0, 26);
expect(n?.name === 'ResetData' && n?.qualifier === 'E_ScanState', `the name at the caret, after a dot (${JSON.stringify(n)})`);

// Go to code: a place in the file, in its section
const lines = fb.split('\n');
const li = lines.findIndex((l: string) => /CASE State OF/.test(l));
const at = sectionAt(fb, li, 3);
const implLines = readSection(fb, 'Method:Execute', 'impl').split('\n');
expect(at?.key === 'Method:Execute' && at.section === 'impl' && implLines[at.line].includes('CASE State OF') && at.column === 3, `Go to code: Execute()'s implementation, line ${at ? at.line + 1 : '?'}`);
expect(sectionAt(fb, lines.findIndex((l: string) => /<Method Name="Execute"/.test(l))) === null, 'the XML around them: none');
fs.rmSync(root, { recursive: true, force: true });

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
