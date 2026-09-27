// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Code help for conditions and the editors: the syntax check, the scope (the POU's names, the project's GVLs,
// members of a.b. chains), a transition's condition read and changed, a state's entry / do / exit actions, a
// variable renamed, the variable checks (undeclared, unused, declared twice), declaring in a declaration
import { checkConditionSyntax } from '../../src/utils/conditionSyntax.ts';
import { buildProjectSymbols, completionAt, symbolScope } from '../../src/utils/projectSymbols.ts';
import { setTransitionCondition, transitionCondition } from '../../src/utils/transitionEdits.ts';
import { allStateActions, readStateActions, writeStateAction } from '../../src/utils/stateActions.ts';
import { checkRename, findReferences, renameMemberInFile, renameVariable, renameWordInFile } from '../../src/utils/renameVariable.ts';
import { formatST } from '../../src/utils/stFormat.ts';
import { expandSnippet, snippetFor, snippetsFromText, snippetsToText } from '../../src/utils/stSnippets.ts';
import { lintVariables } from '../../src/utils/variableLint.ts';
import { declareInDeclaration, declarationVariables } from '../../src/utils/pouVariables.ts';
import { getMethodCodeFromPou, updateMethodCodeInPou } from '../../src/utils/pouStateEditor.ts';
import { extractPouDeclaration } from '../../src/utils/stSymbolDefinition.ts';
import { generateStatechartModel } from '../../src/generator.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// 1. Syntax
const good = [
  'TRUE',
  'bA AND NOT bB',
  '(nCount >= 3) OR fbTimer.Q',
  'smAxis.status_bDone AND tElapsed > T#5S',
  'aDoors[2].bOpen = FALSE',
  'pAxis^.bBusy',
  'nMode.3',
  'fbRead(bExecute := TRUE, tTimeout := T#1S).bDone',
  "sName <> 'idle'",
  'E_States.IDLE = machineState',
  'ABS(rPos - rTarget) < 0.5',
  '-rSpeed > 16#FF',
  'a AND_THEN b OR_ELSE c',
  'x (* why *) AND y',
];
for (const g of good) expect(checkConditionSyntax(g) === null, `valid: ${g} (${checkConditionSyntax(g) ?? 'ok'})`);
const bad: [string, RegExp][] = [
  ['bA := TRUE', /compares with =/],
  ['a == b', /not ==/],
  ['a != b', /<>/],
  ['a && b', /AND/],
  ['a || b', /OR/],
  ['!a', /NOT/],
  ['a AND', /missing at the end|missing after AND/],
  ['(a AND b', /not closed/],
  ['a AND b)', /too many/],
  ['a b', /operator is missing/],
  ['AND a', /missing before AND/],
  ["sName = 'x", /string is not closed/],
  ['a;', /No ;/],
  ['IF a THEN', /statement word/],
  ['a.', /member name is missing/],
];
for (const [b, rx] of bad) {
  const e = checkConditionSyntax(b);
  expect(!!e && rx.test(e), `invalid: ${b} -> ${e}`);
}

// A small project: the POU, its base FB, another FB it holds, a GVL, a struct, an enum
const cdata = (s: string) => `<![CDATA[${s}]]>`;
const method = (name: string, decl: string, code: string) => `    <Method Name="${name}" Id="{${name}}">\n      <Declaration>${cdata(decl)}</Declaration>\n      <Implementation>\n        <ST>${cdata(code)}</ST>\n      </Implementation>\n    </Method>`;
const DO_STATE = [
  'CASE machineState OF',
  '\tS_IDLE:',
  '\t\tIF bFirstPass THEN',
  '\t\t\tstatus_bBusy := FALSE;',
  '\t\tEND_IF',
  '\t\tnCycles := nCycles + 1;',
  '\t\tIF cmd_bStart AND smAxis.status_bDone THEN',
  '\t\t\tmachineState := E_S.S_RUN;',
  '\t\tEND_IF',
  '\tS_RUN:',
  '\t\tIF cmd_bStop',
  '\t\t\tOR bFault THEN',
  '\t\t\tmachineState := E_S.S_IDLE;',
  '\t\tELSIF nCycles > 10 THEN',
  '\t\t\tmachineState := E_S.S_DONE;',
  '\t\tEND_IF',
  '\tS_DONE:',
  '\t\tmachineState := E_S.S_IDLE;',
  'END_CASE',
].join('\n');
const PRE = ['IF machineState >= E_S.S_IDLE AND machineState <= E_S.S_RUN AND (bEStop) THEN', '\tmachineState := E_S.S_DONE;', 'END_IF'].join('\n');
const POU_DECL = ['FUNCTION_BLOCK SM_X EXTENDS FB_Base', 'VAR_INPUT', '\tcmd_bStart : BOOL; // start', '\tcmd_bStop : BOOL;', 'END_VAR', 'VAR_OUTPUT', '\tstatus_bBusy : BOOL;', 'END_VAR', 'VAR', '\tmachineState : E_S;', '\tsmAxis : SM_KAxis;', '\tnCycles : INT;', '\tbFault : BOOL;', '\tnUnused : INT;', '\tnCycles : INT;', 'END_VAR'].join('\n');
const POU = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <POU Name="SM_X" Id="{1}" SpecialFunc="None">\n    <Declaration>${cdata(POU_DECL)}</Declaration>\n    <Implementation>\n      <ST>${cdata('preProcess();\ndoState();')}</ST>\n    </Implementation>\n${method('doState', 'METHOD doState : BOOL\nVAR\n\tnLocal : INT;\n\tbFault : BOOL;\nEND_VAR', DO_STATE)}\n${method('preProcess', 'METHOD preProcess', PRE)}\n  </POU>\n</TcPlcObject>`;
const DUT = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <DUT Name="E_S" Id="{2}">\n    <Declaration>${cdata("{attribute 'qualified_only'}\nTYPE E_S :\n(\n\tS_IDLE := 0,\n\tS_RUN,\n\tS_DONE\n);\nEND_TYPE")}</Declaration>\n  </DUT>\n</TcPlcObject>`;
const BASE = `<TcPlcObject><POU Name="FB_Base" Id="{3}"><Declaration>${cdata('FUNCTION_BLOCK FB_Base\nVAR\n\tbFirstPass : BOOL;\nEND_VAR')}</Declaration></POU></TcPlcObject>`;
const AXIS = `<TcPlcObject><POU Name="SM_KAxis" Id="{4}"><Declaration>${cdata('FUNCTION_BLOCK SM_KAxis\nVAR_INPUT\n\tcmd_bHome : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tstatus_bDone : BOOL;\n\tstatus_stData : ST_AxisData;\nEND_VAR\nVAR\n\tnInternal : INT;\nEND_VAR')}</Declaration>${method('home', 'METHOD PUBLIC home : BOOL', '')}${method('secret', 'METHOD PRIVATE secret', '')}</POU></TcPlcObject>`;
const GVL = `<TcPlcObject><GVL Name="GVL_IO" Id="{5}"><Declaration>${cdata("{attribute 'qualified_only'}\nVAR_GLOBAL\n\tbDoorClosed : BOOL;\nEND_VAR")}</Declaration></GVL></TcPlcObject>`;
const GVL2 = `<TcPlcObject><GVL Name="GVL_Main" Id="{6}"><Declaration>${cdata('VAR_GLOBAL\n\tbEStop : BOOL;\nEND_VAR')}</Declaration></GVL></TcPlcObject>`;
const STRUCT = `<TcPlcObject><DUT Name="ST_AxisData" Id="{7}"><Declaration>${cdata('TYPE ST_AxisData :\nSTRUCT\n\trPos : LREAL;\n\trSpeed : LREAL;\nEND_STRUCT\nEND_TYPE')}</Declaration></DUT></TcPlcObject>`;
const files = [
  { name: 'FB_Base.TcPOU', content: BASE },
  { name: 'SM_KAxis.TcPOU', content: AXIS },
  { name: 'GVL_IO.TcGVL', content: GVL },
  { name: 'GVL_Main.TcGVL', content: GVL2 },
  { name: 'ST_AxisData.TcDUT', content: STRUCT },
];
const symbols = buildProjectSymbols(files, [{ name: 'SM_X.TcPOU', content: POU }, { name: 'E_S.TcDUT', content: DUT }], 'P');
const states = ['S_IDLE', 'S_RUN', 'S_DONE'];

// 2. The scope: the method's, the POU's, the base's, the GVLs'
const scope = symbolScope(POU, symbols, { method: 'doState', states });
const names = scope.top.map((v) => v.name);
expect(['nLocal', 'cmd_bStart', 'smAxis', 'bFirstPass', 'bEStop', 'GVL_IO', 'GVL_Main', 'E_S'].every((n) => names.includes(n)), `top: ${names.join(', ')}`);
expect(!names.includes('bDoorClosed'), 'a qualified_only GVL: its variables only as GVL_IO.x');
expect(scope.top.find((v) => v.name === 'bFirstPass')?.scope === 'VAR (FB_Base)', 'inherited: marked with the base');
expect(scope.complete, 'the base class is known: the undeclared check is reliable');
const m = (chain: string[]) => (scope.members(chain) ?? []).map((v) => v.name).join(',');
expect(m(['smAxis']) === 'cmd_bHome,status_bDone,status_stData,home', `smAxis.: ${m(['smAxis'])} (inputs, outputs, public methods; no VAR, no private)`);
expect(m(['smAxis', 'status_stData']) === 'rPos,rSpeed', `smAxis.status_stData.: ${m(['smAxis', 'status_stData'])}`);
expect(m(['GVL_IO']) === 'bDoorClosed', `GVL_IO.: ${m(['GVL_IO'])}`);
expect(m(['E_S']) === 'S_IDLE,S_RUN,S_DONE', `E_S.: ${m(['E_S'])}`);
expect(scope.members(['nCycles']) === null && scope.typeOf(['smAxis'])?.name === 'SM_KAxis', 'an INT has no members; the type of smAxis');
const c1 = completionAt('bA AND smAxis.status_stData.rP', 30);
expect(c1.word === 'rP' && c1.chain?.join('.') === 'smAxis.status_stData', `completionAt: ${JSON.stringify(c1)}`);
const c2 = completionAt('aDoors[2].bO', 12);
expect(c2.chain?.join('.') === 'aDoors[2]' && c2.word === 'bO', `completionAt with an index: ${JSON.stringify(c2)}`);
const c3 = completionAt('cmd_b', 5);
expect(c3.chain === null && c3.word === 'cmd_b', 'no chain');
// Without the base in the project: not complete
const noBase = symbolScope(POU, buildProjectSymbols([], [{ name: 'SM_X.TcPOU', content: POU }]), { method: 'doState', states });
expect(!noBase.complete, 'the base unknown: not complete');

// 3. A transition's condition
const edge = (from: string, to: string, priority?: number, condition?: string) => ({ from, to, priority, condition });
let c = transitionCondition(POU, edge('S_IDLE', 'S_RUN'), 'machineState');
expect(!('error' in c) && c.condition === 'cmd_bStart AND smAxis.status_bDone' && c.method === 'doState', `read: ${JSON.stringify(c)}`);
c = transitionCondition(POU, edge('S_RUN', 'S_IDLE'), 'machineState');
expect(!('error' in c) && c.condition === 'cmd_bStop OR bFault', `a condition on two lines: ${JSON.stringify(c)}`);
c = transitionCondition(POU, edge('S_RUN', 'S_DONE', 2), 'machineState');
expect(!('error' in c) && c.condition === 'nCycles > 10', `an ELSIF: ${JSON.stringify(c)}`);
c = transitionCondition(POU, edge('S_DONE', 'S_IDLE'), 'machineState');
expect(!('error' in c) && c.condition === '', 'no IF: no condition');
c = transitionCondition(POU, edge('S_IDLE', 'S_DONE', undefined, '[preProcess] bEStop'), 'machineState');
expect(!('error' in c) && c.condition === 'bEStop' && c.method === 'preProcess', `a composite's exception: its own part (${JSON.stringify(c)})`);
const applied = (r: ReturnType<typeof setTransitionCondition>) => {
  if ('error' in r) throw new Error(r.error);
  const u = updateMethodCodeInPou(POU, r.method, r.code);
  return getMethodCodeFromPou(u.updatedPou, r.method).code;
};
let code = applied(setTransitionCondition(POU, edge('S_RUN', 'S_IDLE'), 'bFault', 'machineState'));
expect(code.includes('\t\tIF bFault THEN\n\t\t\tmachineState := E_S.S_IDLE;') && !code.includes('cmd_bStop') && code.split('\n').length === DO_STATE.split('\n').length - 1, 'two lines become one: IF bFault THEN');
code = applied(setTransitionCondition(POU, edge('S_RUN', 'S_DONE', 2), 'nCycles >= 20', 'machineState'));
expect(code.includes('\t\tELSIF nCycles >= 20 THEN'), 'the ELSIF keeps its keyword');
code = applied(setTransitionCondition(POU, edge('S_DONE', 'S_IDLE'), 'bReady', 'machineState'));
expect(code.includes('\tS_DONE:\n\t\tIF bReady THEN\n\t\t\tmachineState := E_S.S_IDLE;\n\t\tEND_IF'), 'no IF before: put in one');
code = applied(setTransitionCondition(POU, edge('S_IDLE', 'S_DONE', undefined, '[preProcess] bEStop'), 'bEStop OR GVL_IO.bDoorClosed = FALSE', 'machineState'));
expect(code.startsWith('IF machineState >= E_S.S_IDLE AND machineState <= E_S.S_RUN AND (bEStop OR GVL_IO.bDoorClosed = FALSE) THEN'), 'the composite range kept');
// The generator reads the new condition
const u = updateMethodCodeInPou(POU, 'doState', applied(setTransitionCondition(POU, edge('S_IDLE', 'S_RUN'), 'cmd_bStart AND NOT bFault', 'machineState')));
const model = generateStatechartModel(DUT, u.updatedPou, {});
expect(/cmd_bStart AND NOT bFault/.test(model.markdown), 'the chart shows the new condition');

// 4. Entry / do / exit
let a = readStateActions(POU, 'S_IDLE', 'machineState');
expect(!('error' in a) && a.entry.join('|') === 'status_bBusy := FALSE;' && a.do.join('|') === 'nCycles := nCycles + 1;' && a.exit.length === 0 && a.doEditable, `S_IDLE: ${JSON.stringify(a)}`);
let w = writeStateAction(POU, 'S_IDLE', 'machineState', 'exit', 'status_bBusy := TRUE;\nnCycles := 0;', 'E_S.');
if ('error' in w) throw new Error(w.error);
let ds = getMethodCodeFromPou(w.pou, 'doState').code;
expect(ds.includes('\t\tEND_IF\n\t\tIF machineState <> E_S.S_IDLE THEN\n\t\t\tstatus_bBusy := TRUE;\n\t\t\tnCycles := 0;\n\t\tEND_IF\n\tS_RUN:'), 'exit: at the end of the branch');
a = readStateActions(w.pou, 'S_IDLE', 'machineState');
expect(!('error' in a) && a.exit.join('|') === 'status_bBusy := TRUE;|nCycles := 0;', 'read back');
w = writeStateAction(w.pou, 'S_IDLE', 'machineState', 'entry', '', 'E_S.');
if ('error' in w) throw new Error(w.error);
ds = getMethodCodeFromPou(w.pou, 'doState').code;
expect(!ds.includes('bFirstPass') && ds.includes('\tS_IDLE:\n\t\tnCycles := nCycles + 1;'), 'entry emptied: removed');
w = writeStateAction(w.pou, 'S_IDLE', 'machineState', 'entry', 'status_bBusy := TRUE;', 'E_S.');
if ('error' in w) throw new Error(w.error);
w = writeStateAction(w.pou, 'S_IDLE', 'machineState', 'do', 'nCycles := nCycles + 2;\nfbTimer(IN := TRUE);', 'E_S.');
if ('error' in w) throw new Error(w.error);
ds = getMethodCodeFromPou(w.pou, 'doState').code;
expect(ds.includes('\tS_IDLE:\n\t\tIF bFirstPass THEN\n\t\t\tstatus_bBusy := TRUE;\n\t\tEND_IF\n\t\tnCycles := nCycles + 2;\n\t\tfbTimer(IN := TRUE);\n\t\tIF cmd_bStart'), `entry first, then do, then the transitions:\n${ds.split('\tS_RUN')[0]}`);
const all = allStateActions(w.pou);
expect(all.get('S_IDLE')?.entry === 'status_bBusy := TRUE;' && all.get('S_IDLE')?.exit === 'status_bBusy := TRUE;' && !all.has('S_DONE'), `all: ${JSON.stringify([...all])}`);
const shown = generateStatechartModel(DUT, w.pou, { stateActions: all }).markdown;
expect(/entry \/ status_bBusy \\?:= TRUE;/.test(shown) || shown.includes('entry / status_bBusy := TRUE;'), 'the chart shows entry / ...');

// 5. Rename
const rn = renameVariable(POU, 'nCycles', 'nCount');
expect(!('error' in rn) && rn.changes.length >= 3 && !/\bnCycles\b/.test(getMethodCodeFromPou((rn as { pou: string }).pou, 'doState').code), `nCycles -> nCount: ${'error' in rn ? rn.error : rn.changes.map((x) => `${x.where} ${x.line}`).join(', ')}`);
const rf = renameVariable(POU, 'bFault', 'bError');
expect(!('error' in rf) && rf.skipped.includes('doState()') && getMethodCodeFromPou(rf.pou, 'doState').code.includes('bFault'), `bFault: doState() has its own, left as it is (${'error' in rf ? rf.error : rf.skipped.join(',')})`);
const rs = renameVariable(POU, 'smAxis', 'smMainAxis');
expect(!('error' in rs) && getMethodCodeFromPou(rs.pou, 'doState').code.includes('smMainAxis.status_bDone'), 'a member access keeps the member, the variable renamed');
expect(checkRename(POU, 'cmd_bStart', 'cmd_bStop') !== null && checkRename(POU, 'cmd_bStart', 'IF') !== null && checkRename(POU, 'cmd_bStart', '1x') !== null, 'taken / keyword / invalid names refused');
const rl = renameVariable(POU, 'nLocal', 'nTemp', 'doState');
expect(!('error' in rl) && rl.changes.every((x) => x.where.startsWith('doState')), 'a method\'s own: in it only');
// Named parameters and members of others stay
const txt = `fb(nCycles := nCycles);\nother.nCycles := 1;\nTHIS^.nCycles := 2;`;
const onlyText = renameVariable(`<TcPlcObject><POU Name="P"><Declaration>${cdata('FUNCTION_BLOCK P\nVAR\n\tnCycles : INT;\nEND_VAR')}</Declaration><Implementation><ST>${cdata(txt)}</ST></Implementation></POU></TcPlcObject>`, 'nCycles', 'n');
const body = 'error' in onlyText ? '' : onlyText.pou.match(/<ST><!\[CDATA\[([\s\S]*?)\]\]>/)![1];
expect(body === 'fb(nCycles := n);\nother.nCycles := 1;\nTHIS^.n := 2;', `named parameter and other's member kept: ${JSON.stringify(body)}`);

// 6. The variable checks
const lint = lintVariables(POU, symbols, true, states);
const keys = lint.map((f) => `${f.rule}:${f.message}`);
expect(lint.some((f) => f.rule === 'duplicate-variable' && /nCycles is declared twice/.test(f.message)), 'declared twice');
expect(lint.some((f) => f.rule === 'duplicate-variable' && f.severity === 'warning' && /doState\(\) has its own bFault/.test(f.message)), 'hidden by a method\'s own');
expect(lint.some((f) => f.rule === 'unused-variable' && /nUnused/.test(f.message)) && !lint.some((f) => f.rule === 'unused-variable' && /nCycles|cmd_b/.test(f.message)), 'not used: nUnused (inputs not checked)');
expect(lint.some((f) => f.rule === 'unused-variable' && /nLocal/.test(f.message)), 'a method\'s own not used');
const und = lint.filter((f) => f.rule === 'undeclared-variable').map((f) => f.message);
expect(und.length === 0, `nothing undeclared: ${und.join('; ')}`);
const withTypo = updateMethodCodeInPou(POU, 'doState', DO_STATE.replace('nCycles > 10', 'nCyclez > 10')).updatedPou;
const und2 = lintVariables(withTypo, buildProjectSymbols(files, [{ name: 'SM_X.TcPOU', content: withTypo }, { name: 'E_S.TcDUT', content: DUT }]), true, states).filter((f) => f.rule === 'undeclared-variable');
expect(und2.length === 1 && /nCyclez is not declared \(in doState\(\)\)/.test(und2[0].message) && und2[0].line === 14, `a typo: ${und2.map((f) => `${f.message} line ${f.line}`).join('; ')}`);
expect(lintVariables(withTypo, symbols, false, states).every((f) => f.rule !== 'undeclared-variable'), 'without the project: no undeclared check');
console.log('   ' + keys.join('\n   '));

// 7. Declare
const d1 = declareInDeclaration(POU_DECL, [{ name: 'bNew', type: 'BOOL', scope: 'VAR_INPUT', comment: 'new one' }]);
expect(d1.includes('\tcmd_bStop : BOOL;\n\tbNew : BOOL; // new one\nEND_VAR'), 'at the end of VAR_INPUT, indented like it');
const d2 = declareInDeclaration('METHOD m : BOOL', [{ name: 'n', type: 'INT', scope: 'VAR', init: '5' }]);
expect(d2 === 'METHOD m : BOOL\nVAR\n\tn : INT := 5;\nEND_VAR', `a new block: ${JSON.stringify(d2)}`);
expect(declarationVariables(extractPouDeclaration(POU)).find((v) => v.name === 'cmd_bStart')?.comment === 'start', 'a variable\'s comment read');

// 8. Find All References
const refs = findReferences(POU, 'nCycles');
expect(refs.filter((r) => r.kind === 'declaration').length === 2 && refs.some((r) => r.kind === 'write' && r.where === 'doState()') && refs.filter((r) => r.where === 'doState()').length === 3, `nCycles: ${refs.map((r) => `${r.where} ${r.line} ${r.kind}`).join(', ')}`);
const stateRefs = findReferences(POU, 'S_RUN', ['E_S']);
expect(stateRefs.length === 3 && stateRefs.filter((r) => r.where === 'doState()').length === 2 && stateRefs.some((r) => r.where === 'preProcess()'), `a state, qualified E_S.S_RUN too: ${stateRefs.map((r) => `${r.line}`).join(', ')}`);
expect(findReferences(POU, 'S_RUN').length === 1, 'without the qualifier: only its CASE label');

// 9. A member renamed where another POU uses it
const other = `<TcPlcObject><POU Name="P"><Declaration>${cdata('PROGRAM P\nVAR\n\tsm : SM_X;\n\taSm : ARRAY[1..2] OF SM_X;\n\tpSm : POINTER TO SM_X;\n\tcmd_bStart : BOOL;\n\tother : FB_Other;\nEND_VAR')}</Declaration><Implementation><ST>${cdata('sm.cmd_bStart := TRUE;\naSm[1].cmd_bStart := cmd_bStart;\npSm^.cmd_bStart := FALSE;\nsm(cmd_bStart := TRUE, cmd_bStop := x);\nother.cmd_bStart := TRUE;\n// sm.cmd_bStart in a comment')}</ST></Implementation></POU></TcPlcObject>`;
const mr = renameMemberInFile(other, new Set(['sm', 'asm', 'psm']), 'cmd_bStart', 'cmd_bGo');
const st = mr.xml.match(/<ST><!\[CDATA\[([\s\S]*?)\]\]>/)![1];
expect(st === 'sm.cmd_bGo := TRUE;\naSm[1].cmd_bGo := cmd_bStart;\npSm^.cmd_bGo := FALSE;\nsm(cmd_bGo := TRUE, cmd_bStop := x);\nother.cmd_bStart := TRUE;\n// sm.cmd_bStart in a comment' && mr.changes.length === 4, `the other POU: ${JSON.stringify(st)} (${mr.changes.length} lines)`);
expect(/\tcmd_bStart : BOOL;/.test(mr.xml), "its own cmd_bStart kept");

// 10. The Input Assistant's catalog
const cat = scope.catalog();
const catNames = (c: string) => cat.find((x) => x.category === c)?.items.map((i) => i.name) ?? [];
expect(catNames('Variables').includes('nCycles') && catNames('Inherited').includes('bFirstPass') && catNames('Global variables').includes('bEStop') && catNames('Global variables').includes('GVL_IO.bDoorClosed') && catNames('Enum values').includes('E_S.S_RUN') && catNames('Types').includes('SM_KAxis') && catNames('States').includes('S_IDLE'), `catalog: ${cat.map((c) => `${c.category} ${c.items.length}`).join(', ')}`);

// 11. Parameter hints: what a call takes
const withTimer = buildProjectSymbols(files, [{ name: 'SM_X.TcPOU', content: POU.replace('\tnUnused : INT;', '\tfbWait : TON;') }, { name: 'E_S.TcDUT', content: DUT }]);
const sc2 = symbolScope(POU.replace('\tnUnused : INT;', '\tfbWait : TON;'), withTimer, { method: 'doState', states });
const sigTon = sc2.signature(['fbWait']);
expect(sigTon?.params.map((p) => `${p.name}:${p.scope}`).join() === 'IN:VAR_INPUT,PT:VAR_INPUT,Q:VAR_OUTPUT,ET:VAR_OUTPUT', `fbWait( (TON): ${sigTon?.params.map((p) => p.name).join(', ')}`);
expect((sc2.members(['fbWait']) ?? []).map((m) => m.name).join() === 'IN,PT,Q,ET', 'fbWait. : the TON\'s members');
const sigAxis = sc2.signature(['smAxis']);
expect(sigAxis?.params.map((p) => p.name).join() === 'cmd_bHome,status_bDone,status_stData', `smAxis( : ${sigAxis?.params.map((p) => p.name).join(', ')}`);
const sigHome = sc2.signature(['smAxis', 'home']);
expect(!!sigHome && sigHome.returns === 'BOOL' && sigHome.params.length === 0, `smAxis.home( : a method, returns ${sigHome?.returns}`);
expect(sc2.signature(['nCycles']) === null, 'an INT takes nothing');

// 12. More checks: an input written, a PRIVATE method not called, code after RETURN, an FB never called
const DO2 = ['CASE machineState OF', '\tS_IDLE:', '\t\tnLimit := 5;', '\t\tfb(nLimit := 3); cmd_bStart := FALSE; nLimit := FALSE;', '\t\tIF fbWait.Q THEN', '\t\t\tRETURN;', '\t\t\tnCycles := 0;', '\t\tEND_IF', '\tS_RUN:', '\t\tRETURN;', '\tS_DONE:', '\t\tmachineState := E_S.S_IDLE;', 'END_CASE'].join('\n');
const POU2 = POU.replace('\tnUnused : INT;', '\tfbWait : TON;').replace('\tcmd_bStop : BOOL;\n', '\tcmd_bStop : BOOL;\n\tnLimit : INT;\n').replace(DO_STATE, DO2).replace('  </POU>', `${method('helper', 'METHOD PRIVATE helper : BOOL', 'helper := TRUE;')}\n  </POU>`);
const l2 = lintVariables(POU2, null, false, states);
const by = (rule: string) => l2.filter((x) => x.rule === rule);
expect(by('input-written').length === 1 && /nLimit \(VAR_INPUT\) is written in doState\(\)/.test(by('input-written')[0].message) && by('input-written')[0].line === 3, `input written: ${by('input-written').map((x) => `${x.message} line ${x.line}`).join('; ')} (the named parameter is no write)`);
expect(by('unused-method').length === 1 && /helper\(\) is PRIVATE/.test(by('unused-method')[0].message), `PRIVATE method not called: ${by('unused-method').map((x) => x.message).join('; ')}`);
expect(by('unreachable-code').length === 1 && by('unreachable-code')[0].line === 7, `after RETURN: ${by('unreachable-code').map((x) => `line ${x.line}`).join(', ')} (not the next CASE label, not END_IF)`);
expect(by('fb-not-called').length === 1 && /fbWait : TON is read but never called/.test(by('fb-not-called')[0].message), `FB never called: ${by('fb-not-called').map((x) => x.message).join('; ')}`);
const called = lintVariables(POU2.replace('\t\tIF fbWait.Q THEN', '\t\tfbWait(IN := TRUE, PT := T#1S);\n\t\tIF fbWait.Q THEN'), null, false, states);
expect(!called.some((x) => x.rule === 'fb-not-called'), 'called: no finding');

// 13. Format Document
const messy = ['IF a THEN', 'b := 1;', '    IF c AND', 'd THEN', 'e := 2;', '  END_IF', 'ELSE', 'CASE s OF', 'S_A:', 'x := 1;', 'S_B, S_C:', 'IF y THEN z := 1; END_IF', 'ELSE', 'w := 0;', 'END_CASE', 'END_IF', '', '(* a comment', '   kept as it is *)', 'FOR i := 0 TO 9 DO', 'n := n + i;', 'END_FOR'].join('\n');
const neat = ['IF a THEN', '\tb := 1;', '\tIF c AND', '\t\td THEN', '\t\te := 2;', '\tEND_IF', 'ELSE', '\tCASE s OF', '\t\tS_A:', '\t\t\tx := 1;', '\t\tS_B, S_C:', '\t\t\tIF y THEN z := 1; END_IF', '\t\tELSE', '\t\t\tw := 0;', '\tEND_CASE', 'END_IF', '', '(* a comment', '   kept as it is *)', 'FOR i := 0 TO 9 DO', '\tn := n + i;', 'END_FOR'].join('\n');
const got = formatST(messy);
expect(got === neat, `formatted:\n${got}`);
expect(formatST(neat) === neat, 'formatting it again changes nothing');
expect(formatST('VAR\nx : INT;\n  y : BOOL;\nEND_VAR') === 'VAR\n\tx : INT;\n\ty : BOOL;\nEND_VAR', 'a VAR block');
expect(formatST('IF a THEN\r\nb := 1;\r\nEND_IF').includes('\r\n\tb := 1;\r\n'), 'CRLF kept');

// 14. Snippets
const sn = snippetFor('if');
const ex = sn ? expandSnippet(sn, '\t\t') : null;
expect(!!ex && ex.text === 'IF  THEN\n\t\t\t\n\t\tEND_IF' && ex.caret === 3, `if: ${JSON.stringify(ex)}`);
const parsed = snippetsFromText('mine // my one\n    fbX(bExecute := $1);\n    IF fbX.bDone THEN\n    \t\n    END_IF\n\nother\n    x := $1;');
expect(Array.isArray(parsed) && parsed.length === 2 && parsed[0].key === 'mine' && parsed[0].description === 'my one' && parsed[0].body === 'fbX(bExecute := $1);\nIF fbX.bDone THEN\n\t\nEND_IF' && parsed[1].body === 'x := $1;', `your snippets read: ${JSON.stringify(parsed)}`);
expect(Array.isArray(parsed) && JSON.stringify(snippetsFromText(snippetsToText(parsed))) === JSON.stringify(parsed), 'written and read back the same');
expect(typeof snippetsFromText('    no key first') === 'string', 'text without a key first: refused');

// 15. A state renamed in another POU (E_S.S_RUN, S_RUN)
const otherPou = `<TcPlcObject><POU Name="P"><Declaration>${cdata('PROGRAM P\nVAR\n\tsm : SM_X;\nEND_VAR')}</Declaration><Implementation><ST>${cdata('IF sm.machineState = E_S.S_RUN THEN\n\tx := 1;\nEND_IF\n// S_RUN in a comment\ny := S_RUNNING;')}</ST></Implementation></POU></TcPlcObject>`;
const rw = renameWordInFile(otherPou, 'S_RUN', 'S_WORK', ['E_S']);
expect(rw.changes.length === 1 && rw.xml.includes('E_S.S_WORK THEN') && rw.xml.includes('// S_RUN in a comment') && rw.xml.includes('S_RUNNING'), `another POU: ${rw.changes.map((c) => c.after).join(' | ')}`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
