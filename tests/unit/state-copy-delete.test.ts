// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// A state copied (enum member, doState() branch with its transitions, getStateDescription) and deleted (the
// transitions into it, its branches, its enum member; what still refers to it listed); transitions deleted
import { generateStatechartModel } from '../../src/generator.ts';
import { extractEdgesFromMermaid } from '../../src/utils/diagramNotes.ts';
import { getMethodCodeFromPou, updateMethodCodeInPou } from '../../src/utils/pouStateEditor.ts';
import { enumMembers } from '../../src/utils/stateMachineLint.ts';
import { copyName, copyState, deleteState, removeEnumMember } from '../../src/utils/stateCopyDelete.ts';
import { deleteTransition } from '../../src/utils/transitionEdits.ts';
import { SAMPLES } from '../../src/samples/samplesData.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const DO_STATE = [
  'CASE machineState OF',
  '\tS_A:',
  '\t\tIF a THEN',
  '\t\t\tmachineState := S_B;',
  '\t\tELSIF b THEN',
  '\t\t\tmachineState := S_C;',
  '\t\tEND_IF',
  '',
  '\tS_B:',
  '\t\tn := n + 1;',
  '\t\tIF n > 3 THEN',
  '\t\t\tmachineState := S_A;',
  '\t\tELSE',
  '\t\t\tmachineState := S_B;',
  '\t\tEND_IF',
  '',
  '\tS_C, S_D:',
  '\t\tmachineState := S_A;',
  '',
  'END_CASE',
].join('\r\n');
const PRE = ['IF bFault THEN', '\tmachineState := S_C;', 'END_IF', 'IF machineState >= S_B AND machineState <= S_C THEN', '\tbBusy := TRUE;', 'END_IF'].join('\r\n');
const DESC = ['CASE machineState OF', "\tS_A: getStateDescription := 'Idle';", "\tS_B: getStateDescription := 'Busy';", "\tS_C: getStateDescription := 'Done';", 'END_CASE'].join('\r\n');
const method = (name: string, code: string) => `    <Method Name="${name}" Id="{${name}}">\r\n      <Declaration><![CDATA[METHOD ${name}]]></Declaration>\r\n      <Implementation>\r\n        <ST><![CDATA[${code}]]></ST>\r\n      </Implementation>\r\n    </Method>`;
const POU = `<?xml version="1.0" encoding="utf-8"?>\r\n<TcPlcObject Version="1.1.0.1">\r\n  <POU Name="SM_X" Id="{1}" SpecialFunc="None">\r\n    <Declaration><![CDATA[FUNCTION_BLOCK SM_X\r\nVAR\r\n\tmachineState : E_S;\r\nEND_VAR]]></Declaration>\r\n    <Implementation>\r\n      <ST><![CDATA[preProcess();\r\ndoState();]]></ST>\r\n    </Implementation>\r\n${method('doState', DO_STATE)}\r\n${method('preProcess', PRE)}\r\n${method('getStateDescription', DESC)}\r\n  </POU>\r\n</TcPlcObject>`;
const DUT = `<?xml version="1.0" encoding="utf-8"?>\r\n<TcPlcObject Version="1.1.0.1">\r\n  <DUT Name="E_S" Id="{2}">\r\n    <Declaration><![CDATA[TYPE E_S :\r\n(\r\n\tS_A := 0,\r\n\tS_B, // busy\r\n\tS_C,\r\n\tS_D\r\n);\r\nEND_TYPE]]></Declaration>\r\n  </DUT>\r\n</TcPlcObject>`;
const V = 'machineState';
const code = (pou: string, m = 'doState') => getMethodCodeFromPou(pou, m).code;
const edges = (pou: string, dut: string) => extractEdgesFromMermaid(generateStatechartModel(dut, pou, {}).markdown).filter((e) => e.from !== '[*]').map((e) => `${e.from}->${e.to}`).sort().join(' ');

// Copy
const name = copyName(POU, DUT, 'S_B');
expect(name === 'S_B_COPY', `the copy's name: ${name}`);
const c = copyState(POU, DUT, 'S_B', name, V);
if ('error' in c) throw new Error(c.error);
expect(c.methods.join() === 'doState,getStateDescription', `copied in ${c.methods.join(', ')}`);
expect(enumMembers(c.dut!).join() === 'S_A,S_B,S_C,S_D,S_B_COPY', `the enum: ${enumMembers(c.dut!).join(', ')} (at the end: no value changes)`);
const d = code(c.pou);
expect(d.includes('\t\tEND_IF\r\n\r\n\tS_B_COPY:\r\n\t\tn := n + 1;\r\n\t\tIF n > 3 THEN\r\n\t\t\tmachineState := S_A;\r\n\t\tELSE\r\n\t\t\tmachineState := S_B_COPY;\r\n\t\tEND_IF\r\n\r\n\tS_C, S_D:'), 'doState(): the branch copied after S_B, re-entering the copy');
expect(code(c.pou, 'getStateDescription').includes("\tS_B: getStateDescription := 'Busy';\r\n\tS_B_COPY: getStateDescription := 'Busy (copy)';\r\n"), 'getStateDescription: the copy with its text');
expect(code(c.pou, 'preProcess') === PRE, 'preProcess() unchanged');
const e1 = edges(c.pou, c.dut!);
expect(e1.includes('S_B_COPY->S_A') && !e1.includes('->S_B_COPY') && !e1.includes('S_B_COPY->S_B '), `the chart: the copy has S_B's transitions out, none in (${e1})`);
expect(copyName(c.pou, c.dut!, 'S_B') === 'S_B_COPY2', 'a second copy: S_B_COPY2');
const cq = copyState(POU, DUT, 'S_C', 'S_E', V);
expect(!('error' in cq) && code(cq.pou).includes('\tS_E:\r\n\t\tmachineState := S_A;\r\n'), 'a shared label: the copy has a label of its own');
expect('error' in copyState(POU, DUT, 'S_B', 'S_A', V), 'a used name is refused');

// Delete
const del = deleteState(POU, DUT, 'S_C', V);
if ('error' in del) throw new Error(del.error);
expect(del.transitions.join() === 'S_A → S_C,preProcess() → S_C', `transitions into it deleted: ${del.transitions.join(', ')}`);
expect(del.methods.join() === 'doState,getStateDescription', `branches: ${del.methods.join(', ')}`);
const dd = code(del.pou);
expect(dd.includes('\tS_A:\r\n\t\tIF a THEN\r\n\t\t\tmachineState := S_B;\r\n\t\tEND_IF') && dd.includes('\tS_D:\r\n\t\tmachineState := S_A;'), 'doState(): the ELSIF gone, S_D keeps the shared branch');
expect(code(del.pou, 'preProcess').startsWith('IF machineState >= S_B AND machineState <= S_C THEN'), 'preProcess(): its IF gone');
expect(!code(del.pou, 'getStateDescription').includes('S_C'), 'getStateDescription: its line gone');
expect(enumMembers(del.dut!).join() === 'S_A,S_B,S_D' && del.renumbered, `the enum: ${enumMembers(del.dut!).join(', ')}, S_D renumbered`);
expect(del.remaining.length === 1 && /preProcess\(\) line 1: .*<= S_C/.test(del.remaining[0]), `still referring to it: ${del.remaining.join(' | ')}`);
expect(del.kept.length === 0, 'none kept');
// S_B: the ELSE of S_B's own IF is its self-transition (gone with the branch); S_A → S_B is the IF arm with an ELSIF
const db = deleteState(POU, DUT, 'S_B', V);
if ('error' in db) throw new Error(db.error);
expect(code(db.pou).includes('\tS_A:\r\n\t\tIF b THEN\r\n\t\t\tmachineState := S_C;\r\n\t\tEND_IF\r\n\r\n\tS_C, S_D:'), 'S_B deleted: S_A keeps its ELSIF (now the IF), S_B\'s branch gone');
expect(/\(\r\n\tS_A := 0,\r\n\tS_C,/.test(db.dut!), 'the enum: its line (and comment) gone');
const dl = removeEnumMember(DUT, 'S_D');
expect(!!dl && /\tS_C\r\n\);/.test(dl.dut) && !dl.renumbered, 'the last member: the comma before it too');
expect(removeEnumMember(DUT.replace(/\r\n\tS_B, \/\/ busy\r\n\tS_C,\r\n\tS_D/, ''), 'S_A') === null, 'the only member is not removed');

// Delete a transition
const dt = deleteTransition(POU, { from: 'S_B', to: 'S_A', priority: 1 }, V);
expect(!('error' in dt) && updateMethodCodeInPou(POU, 'doState', (dt as any).code).success, `S_B → S_A: ${'error' in dt ? dt.error : dt.message}`);
if (!('error' in dt)) expect(dt.code.includes('\tS_B:\r\n\t\tn := n + 1;\r\n\t\tIF n > 3 THEN\r\n\t\tELSE') || dt.code.includes('\tS_B:\r\n\t\tn := n + 1;\r\n\t\tIF n > 3 THEN\r\n\t\t\r\n'), 'the IF arm with an ELSE: only the assignment goes');

// Samples: each state copied and deleted gives a chart (no generator error), the copy has the same way out
let n = 0;
for (const s of SAMPLES as any[]) {
  let model;
  try { model = generateStatechartModel(s.dutContent || '', s.pouContent, {}); } catch { continue; }
  const states = [...new Set(extractEdgesFromMermaid(model.markdown).map((e) => e.from))].filter((x) => x !== '[*]' && /^[A-Z0-9_]+$/.test(x)).slice(0, 3);
  for (const st of states) {
    const cp = copyState(s.pouContent, s.dutContent || '', st, copyName(s.pouContent, s.dutContent || '', st), model.stateVar);
    if ('error' in cp) continue;
    try { generateStatechartModel(cp.dut ?? s.dutContent ?? '', cp.pou, {}); n++; } catch (e) { expect(false, `${s.title}: copy of ${st}: ${(e as Error).message}`); }
    const dl2 = deleteState(s.pouContent, s.dutContent || '', st, model.stateVar);
    if ('error' in dl2) { expect(false, `${s.title}: delete ${st}: ${dl2.error}`); continue; }
    try { generateStatechartModel(dl2.dut ?? s.dutContent ?? '', dl2.pou, {}); n++; } catch (e) { expect(false, `${s.title}: delete ${st}: ${(e as Error).message}`); }
  }
}
expect(n > 10, `samples: ${n} copies / deletions generate`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
