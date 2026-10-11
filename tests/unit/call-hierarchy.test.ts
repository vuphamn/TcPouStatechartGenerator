// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The app's Call Hierarchy and Go to Implementation (src/utils/callHierarchy.ts) on a project: an interface I_Mover
// (Move), FB_Base implementing it (Move, Reset), FB_Axis extending it (its own Move calling SUPER^.Move and Reset), a
// function F_Log, MAIN (fbAxis(), fbAxis.Move(), F_Log()), PRG_Cell (itfMover.Move(), fbBase.Reset()); calls in
// comments and strings not counted; the units of a POU (body, methods, actions, property accessors)
import { PouIndex, callsIn, implementationsOf, incomingCalls, nodeLabel, outgoingCalls, parsePou } from '../../src/utils/callHierarchy.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const method = (name: string, decl: string, impl?: string) => `\n    <Method Name="${name}" Id="{1}">\n      <Declaration><![CDATA[${decl}]]></Declaration>${impl !== undefined ? `\n      <Implementation>\n        <ST><![CDATA[${impl}]]></ST>\n      </Implementation>` : ''}\n    </Method>`;
const pou = (name: string, decl: string, body: string, members = '') => `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <POU Name="${name}" Id="{2}">\n    <Declaration><![CDATA[${decl}]]></Declaration>\n    <Implementation>\n      <ST><![CDATA[${body}]]></ST>\n    </Implementation>${members}\n  </POU>\n</TcPlcObject>\n`;

const files = [
  { path: 'I_Mover.TcIO', content: `<TcPlcObject><Itf Name="I_Mover" Id="{3}">\n<Declaration><![CDATA[INTERFACE I_Mover\n]]></Declaration>${method('Move', 'METHOD Move : BOOL\nVAR_INPUT\n\tfPos : LREAL;\nEND_VAR\n')}\n</Itf></TcPlcObject>` },
  { path: 'FB_Base.TcPOU', content: pou('FB_Base', 'FUNCTION_BLOCK FB_Base IMPLEMENTS I_Mover\nVAR\n\tbBusy : BOOL;\nEND_VAR\n', '', method('Move', 'METHOD Move : BOOL\n', 'Move := TRUE;\n') + method('Reset', 'METHOD Reset\n', "F_Log('reset');\nbBusy := FALSE;\n")) },
  { path: 'FB_Axis.TcPOU', content: pou('FB_Axis', 'FUNCTION_BLOCK FB_Axis EXTENDS FB_Base\nVAR\n\tnState : INT;\nEND_VAR\n', 'IF nState = 10 THEN\n\tMove(fPos := 1.0);\nEND_IF\n', method('Move', 'METHOD Move : BOOL\n', 'SUPER^.Move(fPos := fPos);\nReset();\n(* Reset() in a comment *)\n') + `\n    <Property Name="Busy" Id="{4}">\n      <Declaration><![CDATA[PROPERTY Busy : BOOL]]></Declaration>\n      <Get Name="Get" Id="{5}">\n        <Declaration><![CDATA[VAR\nEND_VAR\n]]></Declaration>\n        <Implementation>\n          <ST><![CDATA[Busy := THIS^.Move(fPos := 0);]]></ST>\n        </Implementation>\n      </Get>\n    </Property>`) },
  { path: 'F_Log.TcPOU', content: pou('F_Log', 'FUNCTION F_Log : BOOL\nVAR_INPUT\n\tsText : STRING;\nEND_VAR\n', 'F_Log := TRUE;\n') },
  { path: 'MAIN.TcPOU', content: pou('MAIN', 'PROGRAM MAIN\nVAR\n\tfbAxis : FB_Axis;\n\tbOk : BOOL;\nEND_VAR\n', "fbAxis();\nbOk := fbAxis.Move(fPos := 2.0);\nF_Log('cycle'); // F_Log('not a call')\nF_Log(sText := 'Move()');\n") },
  { path: 'PRG_Cell.TcPOU', content: pou('PRG_Cell', 'PROGRAM PRG_Cell\nVAR\n\titfMover : I_Mover;\n\tfbBase : FB_Base;\nEND_VAR\n', 'itfMover.Move(fPos := 3.0);\nfbBase.Reset();\n') },
];
const index = new PouIndex(files);
const show = (ns: { pou: string; member: string; kind?: string; sites: { line: number }[] }[]) => ns.map((n) => `${nodeLabel(n)}@${n.sites.map((s) => s.line).join('+')}`).sort().join(', ');

// 1. Parsing
const axis = parsePou(files[2].content)!;
expect(axis.name === 'FB_Axis' && axis.kind === 'FUNCTION_BLOCK' && axis.extends === 'FB_Base' && axis.units.map((u) => `${u.member || '(body)'}:${u.kind}`).join() === '(body):body,Move:method,Busy.Get:property', `FB_Axis's units: ${axis.units.map((u) => `${u.member || '(body)'}:${u.kind}`).join()}`);
const base = parsePou(files[1].content)!;
expect(base.implements.join() === 'I_Mover' && parsePou(files[0].content)!.kind === 'INTERFACE', 'FB_Base implements I_Mover; I_Mover an interface');
expect(callsIn("F_Log('cycle'); // F_Log('x')\nIF NOT (a) THEN x := 'Move()'; END_IF").map((c) => c.name).join() === 'F_Log', 'calls: not in comments and strings, no keywords');

// 2. Who calls
expect(show(incomingCalls(index, { pou: 'FB_Axis', member: 'Move' })) === 'FB_Axis.Busy.Get@1, FB_Axis@2, MAIN@2, PRG_Cell@1', `FB_Axis.Move's callers: its body, its property (THIS^), MAIN (fbAxis.Move), PRG_Cell (through I_Mover) (${show(incomingCalls(index, { pou: 'FB_Axis', member: 'Move' }))})`);
expect(show(incomingCalls(index, { pou: 'FB_Base', member: 'Move' })) === 'FB_Axis.Move()@1, PRG_Cell@1', `FB_Base.Move's callers: SUPER^.Move, itfMover.Move (not fbAxis.Move: FB_Axis has its own) (${show(incomingCalls(index, { pou: 'FB_Base', member: 'Move' }))})`);
expect(show(incomingCalls(index, { pou: 'FB_Base', member: 'Reset' })) === 'FB_Axis.Move()@2, PRG_Cell@2', `FB_Base.Reset's callers: inherited Reset() in FB_Axis.Move (not the comment), fbBase.Reset (${show(incomingCalls(index, { pou: 'FB_Base', member: 'Reset' }))})`);
expect(show(incomingCalls(index, { pou: 'F_Log', member: '' })) === 'FB_Base.Reset()@1, MAIN@3+4', `F_Log's callers (${show(incomingCalls(index, { pou: 'F_Log', member: '' }))})`);
expect(show(incomingCalls(index, { pou: 'FB_Axis', member: '' })) === 'MAIN@1', `FB_Axis's body: fbAxis() in MAIN (${show(incomingCalls(index, { pou: 'FB_Axis', member: '' }))})`);

// 3. What it calls
expect(show(outgoingCalls(index, { pou: 'FB_Axis', member: 'Move' })) === 'FB_Base.Move()@1, FB_Base.Reset()@2', `FB_Axis.Move calls (${show(outgoingCalls(index, { pou: 'FB_Axis', member: 'Move' }))})`);
expect(show(outgoingCalls(index, { pou: 'MAIN', member: '' })) === 'FB_Axis.Move()@2, FB_Axis@1, F_Log@3+4', `MAIN calls (${show(outgoingCalls(index, { pou: 'MAIN', member: '' }))})`);
expect(show(outgoingCalls(index, { pou: 'PRG_Cell', member: '' })) === 'FB_Axis.Move()@1, FB_Base.Move()@1, FB_Base.Reset()@2', `PRG_Cell calls: through I_Mover, each implementation's Move (${show(outgoingCalls(index, { pou: 'PRG_Cell', member: '' }))})`);

// 4. Implementations
expect(implementationsOf(index, 'I_Mover').map((n) => n.pou).join() === 'FB_Axis,FB_Base', 'I_Mover: FB_Axis (by its base), FB_Base');
expect(implementationsOf(index, 'I_Mover', 'Move').map((n) => nodeLabel(n)).join() === 'FB_Axis.Move(),FB_Base.Move()', "I_Mover.Move: each implementation's");
expect(implementationsOf(index, 'FB_Base', 'Move').map((n) => nodeLabel(n)).join() === 'FB_Axis.Move()' && implementationsOf(index, 'FB_Base', 'Reset').length === 0, "FB_Base.Move: FB_Axis's override; Reset: none");

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
