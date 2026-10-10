// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The VS Code extension's navigation (vscode-extension/stNavigation.cjs) on a project: an interface (I_Mover), a base
// FB implementing it (FB_Base), an FB extending that (FB_Axis: Move() overridden, SUPER^.Move()), a function (F_Log),
// a program (MAIN: fbAxis : FB_Axis, its calls), a GVL, an enum, structs (ST_Pos3 EXTENDS ST_Pos). The project's
// symbols (Ctrl+T), folding, the type hierarchy, calls in and out, implementations
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createIndex } = require('../../vscode-extension/stReferences.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nav = require('../../vscode-extension/stNavigation.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
type Loc = { file: string; key: string; section: string; line: number; column: number };
type Item = { name: string; kind: string; container: string; file: string; key: string; location: Loc };
const at = (l: Loc) => `${path.basename(l.file, path.extname(l.file))}${l.key ? `.${l.key.split(':').pop()}` : ''}:${l.line + 1}`;
const itemName = (i: Item) => `${i.container ? `${i.container}.` : ''}${i.name}`;

let n = 0;
const id = () => `{00000000-0000-0000-0000-${String(++n).padStart(12, '0')}}`;
const method = (name: string, decl: string, impl?: string) =>
  `\n    <Method Name="${name}" Id="${id()}">\n      <Declaration><![CDATA[${decl}]]></Declaration>${impl !== undefined ? `\n      <Implementation>\n        <ST><![CDATA[${impl}]]></ST>\n      </Implementation>` : ''}\n    </Method>`;
const pou = (name: string, decl: string, body: string, members = '') =>
  `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <POU Name="${name}" Id="${id()}" SpecialFunc="None">\n    <Declaration><![CDATA[${decl}]]></Declaration>\n    <Implementation>\n      <ST><![CDATA[${body}]]></ST>\n    </Implementation>${members}\n  </POU>\n</TcPlcObject>\n`;
const dut = (name: string, decl: string) => `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <DUT Name="${name}" Id="${id()}">\n    <Declaration><![CDATA[${decl}]]></Declaration>\n  </DUT>\n</TcPlcObject>\n`;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-nav-'));
const dir = path.join(root, 'Plc', 'POUs');
fs.mkdirSync(dir, { recursive: true });
const write = (name: string, text: string) => fs.writeFileSync(path.join(dir, name), text);
write('I_Mover.TcIO', `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <Itf Name="I_Mover" Id="${id()}">\n    <Declaration><![CDATA[INTERFACE I_Mover\n]]></Declaration>${method('Move', 'METHOD Move : BOOL\nVAR_INPUT\n\tfPos : LREAL;\nEND_VAR\n')}\n  </Itf>\n</TcPlcObject>\n`);
write('FB_Base.TcPOU', pou('FB_Base', 'FUNCTION_BLOCK FB_Base IMPLEMENTS I_Mover\nVAR\n\tbBusy : BOOL;\nEND_VAR\n', '', method('Move', 'METHOD Move : BOOL\nVAR_INPUT\n\tfPos : LREAL;\nEND_VAR\n', 'Move := TRUE;\n') + method('Reset', 'METHOD Reset\n', "F_Log('reset');\nbBusy := FALSE;\n")));
const axisBody = `{region "the steps"}
(* the axis's
   own steps *)
CASE nState OF
	0:
		IF bGo THEN
			nState := 10;
		END_IF
	10:
		Move(fPos := 1.0);
		nState := 0;
END_CASE
{endregion}
`;
write('FB_Axis.TcPOU', pou('FB_Axis', 'FUNCTION_BLOCK FB_Axis EXTENDS FB_Base\nVAR_INPUT\n\tbGo : BOOL;\nEND_VAR\nVAR\n\tnState : INT;\nEND_VAR\n', axisBody, method('Move', 'METHOD Move : BOOL\nVAR_INPUT\n\tfPos : LREAL;\nEND_VAR\n', 'SUPER^.Move(fPos := fPos);\nReset();\n')));
write('F_Log.TcPOU', pou('F_Log', 'FUNCTION F_Log : BOOL\nVAR_INPUT\n\tsText : STRING;\nEND_VAR\n', 'F_Log := TRUE;\n'));
write('MAIN.TcPOU', pou('MAIN', 'PROGRAM MAIN\nVAR\n\tfbAxis : FB_Axis;\n\tbOk : BOOL;\nEND_VAR\n', "fbAxis(bGo := TRUE);\nbOk := fbAxis.Move(fPos := 2.0);\nF_Log('cycle'); // F_Log('not a call')\n"));
write('GVL_Main.TcGVL', `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <GVL Name="GVL_Main" Id="${id()}">\n    <Declaration><![CDATA[VAR_GLOBAL\n\tgnCount : INT;\nEND_VAR\n]]></Declaration>\n  </GVL>\n</TcPlcObject>\n`);
write('E_State.TcDUT', dut('E_State', 'TYPE E_State :\n(\n\tIdle,\n\tBusy\n);\nEND_TYPE\n'));
write('ST_Pos.TcDUT', dut('ST_Pos', 'TYPE ST_Pos :\nSTRUCT\n\tfX : LREAL;\nEND_STRUCT\nEND_TYPE\n'));
write('ST_Pos3.TcDUT', dut('ST_Pos3', 'TYPE ST_Pos3 EXTENDS ST_Pos :\nSTRUCT\n\tfZ : LREAL;\nEND_STRUCT\nEND_TYPE\n'));

const files = createIndex().project(root);
const fileOf = (name: string) => files.find((f: { file: string }) => path.basename(f.file).startsWith(`${name}.`)).file as string;

// The types
const types = nav.typesOf(files) as { name: string; kind: string; extends: string[]; implements: string[] }[];
const kinds = Object.fromEntries(types.map((t) => [t.name, t.kind]));
expect(kinds.I_Mover === 'INTERFACE' && kinds.FB_Base === 'FUNCTION_BLOCK' && kinds.F_Log === 'FUNCTION' && kinds.MAIN === 'PROGRAM' && kinds.E_State === 'ENUM' && kinds.ST_Pos === 'STRUCT', `the types and their kinds (${JSON.stringify(kinds)})`);

// The project's symbols (Ctrl+T)
const sym = (q: string) => (nav.workspaceSymbols(files, q) as { name: string; kind: string; container: string; location: Loc }[]).map((s) => `${s.container ? `${s.container}.` : ''}${s.name}:${s.kind}`);
const mv = sym('move');
expect(['I_Mover.Move:method', 'FB_Base.Move:method', 'FB_Axis.Move:method'].every((x) => mv.includes(x)), `"move": the three Move() (${mv.join(', ')})`);
expect(sym('fbax')[0] === 'FB_Axis:class', `"fbax": FB_Axis first (${sym('fbax').slice(0, 3).join(', ')})`);
expect(sym('gncount').includes('GVL_Main.gnCount:variable') && sym('busy').includes('E_State.Busy:enumMember'), `a GVL's variable, an enum's member (${sym('gncount')}; ${sym('busy')})`);
expect(sym('Base.Reset').includes('FB_Base.Reset:method'), `"Base.Reset": by its POU too (${sym('Base.Reset')})`);
const gotoMove = (nav.workspaceSymbols(files, 'move') as { container: string; location: Loc }[]).find((s) => s.container === 'FB_Axis')!.location;
expect(gotoMove.key === 'Method:Move' && gotoMove.section === 'decl' && gotoMove.line === 0 && gotoMove.column === 7, `its place: the method's header (${at(gotoMove)}, column ${gotoMove.column})`);

// Folding
const ranges = nav.foldingRanges(axisBody) as { start: number; end: number; kind?: string }[];
const r = (start: number) => ranges.find((x) => x.start === start);
expect(r(0)?.kind === 'region' && r(0)?.end === 12, `{region} … {endregion} (${JSON.stringify(r(0))})`);
expect(r(1)?.kind === 'comment' && r(1)?.end === 2, `a comment over two lines (${JSON.stringify(r(1))})`);
expect(r(3)?.end === 10, `CASE … END_CASE: to the line before END_CASE (${JSON.stringify(r(3))})`);
expect(r(4)?.end === 7 && r(8)?.end === 10, `each CASE branch to the next (${JSON.stringify(r(4))}, ${JSON.stringify(r(8))})`);
expect(r(5)?.end === 6, `IF … END_IF (${JSON.stringify(r(5))})`);
const declRanges = nav.foldingRanges('FUNCTION_BLOCK FB_Axis\nVAR_INPUT\n\tbGo : BOOL;\n\tbStop : BOOL;\nEND_VAR\nVAR\n\tType : INT; // (a name, not TYPE)\nEND_VAR\n') as { start: number; end: number }[];
expect(JSON.stringify(declRanges) === JSON.stringify([{ start: 1, end: 3 }, { start: 5, end: 6 }]), `VAR blocks (${JSON.stringify(declRanges)})`);

// The type hierarchy
const names = (list: { name: string }[]) => list.map((t) => t.name).sort().join(',');
expect(names(nav.supertypes(files, 'FB_Axis')) === 'FB_Base' && names(nav.supertypes(files, 'FB_Base')) === 'I_Mover', `supertypes: FB_Axis → FB_Base → I_Mover`);
expect(names(nav.subtypes(files, 'I_Mover')) === 'FB_Base' && names(nav.allSubtypes(files, 'I_Mover')) === 'FB_Axis,FB_Base', `subtypes of I_Mover: FB_Base; all: FB_Axis too`);
expect(names(nav.supertypes(files, 'ST_Pos3')) === 'ST_Pos', 'a struct\'s EXTENDS');

// Implementations
const impl = (file: string, name: string) => (nav.implementations(files, { file, name }) as Loc[]).map(at).sort().join(', ');
expect(impl(fileOf('MAIN'), 'I_Mover') === 'FB_Axis:1, FB_Base:1', `the interface's: FB_Base, FB_Axis (${impl(fileOf('MAIN'), 'I_Mover')})`);
expect(impl(fileOf('I_Mover'), 'Move') === 'FB_Axis.Move:1, FB_Base.Move:1', `I_Mover.Move(): both Move() (${impl(fileOf('I_Mover'), 'Move')})`);
expect(impl(fileOf('FB_Base'), 'Move') === 'FB_Axis.Move:1', `FB_Base.Move(): its override (${impl(fileOf('FB_Base'), 'Move')})`);

// Calls
const callables = (file: string, name: string, qualifier?: string) => (nav.callablesNamed(files, { file, name, qualifier }) as Item[]).map(itemName).join(',');
expect(callables(fileOf('MAIN'), 'fbAxis') === 'FB_Axis' && callables(fileOf('MAIN'), 'Move', 'fbAxis') === 'FB_Axis.Move' && callables(fileOf('MAIN'), 'F_Log') === 'F_Log', 'a name\'s callables: an instance (its FB), inst.Method, a function');
expect(callables(fileOf('FB_Axis'), 'Move', 'SUPER^') === 'FB_Base.Move' && callables(fileOf('FB_Axis'), 'Reset') === 'FB_Base.Reset', `SUPER^.Move: the base's; Reset(): inherited (${callables(fileOf('FB_Axis'), 'Move', 'SUPER^')}, ${callables(fileOf('FB_Axis'), 'Reset')})`);
const item = (file: string, key: string) => nav.itemOfPlace(files, file, key) as Item;
const incoming = (i: Item) => (nav.incomingCalls(files, i) as { from: Item; ranges: { line: number }[] }[]).map((c) => `${itemName(c.from)}@${c.ranges.map((x) => x.line + 1).join('+')}`).sort().join(', ');
const outgoing = (i: Item) => (nav.outgoingCalls(files, i) as { to: Item }[]).map((c) => itemName(c.to)).sort().join(', ');
expect(incoming(item(fileOf('F_Log'), '')) === 'FB_Base.Reset@1, MAIN@3', `F_Log's callers: Reset(), MAIN (not in a comment) (${incoming(item(fileOf('F_Log'), ''))})`);
expect(incoming(item(fileOf('FB_Axis'), 'Method:Move')) === 'FB_Axis@10, MAIN@2', `FB_Axis.Move's callers: its body, MAIN (fbAxis.Move) (${incoming(item(fileOf('FB_Axis'), 'Method:Move'))})`);
expect(incoming(item(fileOf('FB_Base'), 'Method:Move')) === 'FB_Axis.Move@1', `FB_Base.Move's caller: SUPER^.Move (${incoming(item(fileOf('FB_Base'), 'Method:Move'))})`);
expect(incoming(item(fileOf('FB_Axis'), '')) === 'MAIN@1', `FB_Axis's body: called by MAIN (fbAxis()) (${incoming(item(fileOf('FB_Axis'), ''))})`);
expect(outgoing(item(fileOf('FB_Axis'), 'Method:Move')) === 'FB_Base.Move, FB_Base.Reset', `FB_Axis.Move calls (${outgoing(item(fileOf('FB_Axis'), 'Method:Move'))})`);
expect(outgoing(item(fileOf('MAIN'), '')) === 'FB_Axis, FB_Axis.Move, F_Log', `MAIN calls (${outgoing(item(fileOf('MAIN'), ''))})`);

fs.rmSync(root, { recursive: true, force: true });
console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
