// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Semantic colours (vscode-extension/stSemantic.cjs) on a project: an enum (E_State), a function block (FB_Axis, its
// method Move), MAIN with fbAxis : FB_Axis, tonWait : TON, a constant; the tokens: types, FB instances (declared and
// used), their methods and properties after the dot, enum members (qualified and bare), the POU's own method called, a
// constant; elementary types, plain variables and comments get none
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createIndex } = require('../../vscode-extension/stReferences.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { semanticTokensOf, projectTables } = require('../../vscode-extension/stSemantic.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-sem-'));
const dir = path.join(root, 'Plc', 'POUs');
fs.mkdirSync(dir, { recursive: true });
let n = 0;
const id = () => `{00000000-0000-0000-0000-${String(++n).padStart(12, '0')}}`;
const pou = (name: string, decl: string, body: string, members = '') =>
  `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <POU Name="${name}" Id="${id()}">\n    <Declaration><![CDATA[${decl}]]></Declaration>\n    <Implementation>\n      <ST><![CDATA[${body}]]></ST>\n    </Implementation>${members}\n  </POU>\n</TcPlcObject>\n`;
fs.writeFileSync(path.join(dir, 'E_State.TcDUT'), `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <DUT Name="E_State" Id="${id()}">\n    <Declaration><![CDATA[TYPE E_State :\n(\n\tIdle,\n\tBusy\n);\nEND_TYPE\n]]></Declaration>\n  </DUT>\n</TcPlcObject>\n`);
fs.writeFileSync(path.join(dir, 'I_Mover.TcIO'), `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <Itf Name="I_Mover" Id="${id()}">\n    <Declaration><![CDATA[INTERFACE I_Mover\n]]></Declaration>\n  </Itf>\n</TcPlcObject>\n`);
fs.writeFileSync(path.join(dir, 'FB_Axis.TcPOU'), pou('FB_Axis', 'FUNCTION_BLOCK FB_Axis\nVAR_OUTPUT\n\tbDone : BOOL;\nEND_VAR\n', '', `\n    <Method Name="Move" Id="${id()}">\n      <Declaration><![CDATA[METHOD Move : BOOL\n]]></Declaration>\n      <Implementation>\n        <ST><![CDATA[Move := TRUE;]]></ST>\n      </Implementation>\n    </Method>`));
const decl = 'PROGRAM MAIN\nVAR\n\tfbAxis : FB_Axis;\n\titfMover : I_Mover;\n\ttonWait : TON;\n\teState : E_State;\n\tnCount : INT;\nEND_VAR\nVAR CONSTANT\n\tcMax : INT := 10;\nEND_VAR\n';
const body = "CASE eState OF\n\tE_State.Idle:\n\t\tfbAxis.Move();\n\t\titfMover.Move();\n\t\ttonWait(IN := TRUE, PT := T#1S);\n\t\tIF fbAxis.bDone AND nCount < cMax THEN\n\t\t\teState := Busy; // Idle in a comment\n\t\tEND_IF\n\tBusy:\n\t\tReset();\nEND_CASE\n";
fs.writeFileSync(path.join(dir, 'MAIN.TcPOU'), pou('MAIN', decl, body, `\n    <Action Name="Reset" Id="${id()}">\n      <Implementation>\n        <ST><![CDATA[nCount := 0;]]></ST>\n      </Implementation>\n    </Action>`));

const files = createIndex().project(root);
const tables = projectTables(files);
const main = path.join(dir, 'MAIN.TcPOU');
const show = (text: string, toks: { line: number; char: number; length: number; type: string; modifiers: string[] }[]) =>
  toks.map((t) => `${text.split('\n')[t.line].slice(t.char, t.char + t.length)}:${t.type}${t.modifiers.length ? `+${t.modifiers.join('+')}` : ''}`);
const d = show(decl, semanticTokensOf({ text: decl, file: main, key: '', files, tables }));
expect(JSON.stringify(d) === JSON.stringify(['MAIN:namespace', 'fbAxis:fbInstance+declaration', 'FB_Axis:class', 'itfMover:itfInstance+declaration', 'I_Mover:interface', 'tonWait:fbInstance+declaration', 'TON:class+defaultLibrary', 'E_State:enum', 'cMax:variable+readonly+declaration']), `the declaration (${d.join(' ')})`);
const b = show(body, semanticTokensOf({ text: body, file: main, key: '', files, tables }));
expect(JSON.stringify(b) === JSON.stringify(['E_State:enum', 'Idle:enumMember', 'fbAxis:fbInstance', 'Move:method', 'itfMover:itfInstance', 'Move:method', 'tonWait:fbInstance', 'fbAxis:fbInstance', 'bDone:property', 'cMax:variable+readonly', 'Busy:enumMember', 'Busy:enumMember', 'Reset:method']), `the body (${b.join(' ')})`);
// (an unsaved declaration: its own instance known)
const fresh = show('VAR\n\tfbNew : FB_Axis;\nEND_VAR\n', semanticTokensOf({ text: 'VAR\n\tfbNew : FB_Axis;\nEND_VAR\n', file: main, key: 'Method:X', files, tables }));
expect(fresh.join(' ') === 'fbNew:fbInstance+declaration FB_Axis:class', `an instance declared in the section itself (${fresh.join(' ')})`);

fs.rmSync(root, { recursive: true, force: true });
console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
