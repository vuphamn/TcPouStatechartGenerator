// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Canvas edits of transitions written to the ST: priority (IF / ELSIF arms, separate IFs, preProcess order), the end
// retargeted, the start moved to another state's branch; checked with the generator's own priorities
import { generateStatechartModel } from '../../src/generator.ts';
import { extractEdgesFromMermaid } from '../../src/utils/diagramNotes.ts';
import { getMethodCodeFromPou, updateMethodCodeInPou } from '../../src/utils/pouStateEditor.ts';
import { moveTransitionStart, retargetTransition, setTransitionPriority, transitionOrder } from '../../src/utils/transitionEdits.ts';
import { SAMPLES } from '../../src/samples/samplesData.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const DO_STATE = [
  'CASE machineState OF',
  '\tS_A:',
  '\t\tIF bFirst THEN',
  '\t\t\tn := 0;',
  '\t\tEND_IF',
  '\t\t// to B first',
  '\t\tIF a THEN',
  '\t\t\tmachineState := E_S.S_B;',
  '\t\tELSIF b AND',
  '\t\t\t\tc THEN',
  '\t\t\tmachineState := E_S.S_C; (* C *)',
  '\t\tELSE',
  '\t\t\tmachineState := E_S.S_D;',
  '\t\tEND_IF',
  '\t\tIF e THEN',
  '\t\t\tmachineState := E_S.S_E;',
  '\t\tEND_IF',
  '\tS_B:',
  '\t\tIF x THEN',
  '\t\t\tmachineState := E_S.S_A;',
  '\t\tEND_IF',
  '\tS_C, S_D:',
  '\t\tmachineState := E_S.S_A;',
  '\tS_E:',
  '\t\tIF y THEN',
  '\t\t\tIF z THEN',
  '\t\t\t\tmachineState := E_S.S_A;',
  '\t\t\tELSE',
  '\t\t\t\tmachineState := E_S.S_B;',
  '\t\t\tEND_IF',
  '\t\tEND_IF',
  'END_CASE',
].join('\r\n');
const PRE = ['IF bReset THEN', '\tmachineState := E_S.S_A;', 'END_IF', 'IF bFault THEN', '\tmachineState := E_S.S_E;', 'END_IF'].join('\r\n');
const method = (name: string, code: string) => `    <Method Name="${name}" Id="{${name}}">\r\n      <Declaration><![CDATA[METHOD ${name}]]></Declaration>\r\n      <Implementation>\r\n        <ST><![CDATA[${code}]]></ST>\r\n      </Implementation>\r\n    </Method>`;
const POU = `<?xml version="1.0" encoding="utf-8"?>\r\n<TcPlcObject Version="1.1.0.1">\r\n  <POU Name="SM_X" Id="{1}" SpecialFunc="None">\r\n    <Declaration><![CDATA[FUNCTION_BLOCK SM_X\r\nVAR\r\n\tmachineState : E_S;\r\nEND_VAR]]></Declaration>\r\n    <Implementation>\r\n      <ST><![CDATA[preProcess();\r\ndoState();]]></ST>\r\n    </Implementation>\r\n${method('doState', DO_STATE)}\r\n${method('preProcess', PRE)}\r\n  </POU>\r\n</TcPlcObject>`;
const DUT = `<?xml version="1.0" encoding="utf-8"?>\r\n<TcPlcObject Version="1.1.0.1">\r\n  <DUT Name="E_S" Id="{2}">\r\n    <Declaration><![CDATA[{attribute 'qualified_only'}\r\nTYPE E_S :\r\n(\r\n\tS_A := 0,\r\n\tS_B,\r\n\tS_C,\r\n\tS_D,\r\n\tS_E\r\n);\r\nEND_TYPE]]></Declaration>\r\n  </DUT>\r\n</TcPlcObject>`;
const V = 'machineState';

// The generator's priorities of a state's transitions, in order: "TO(p)"
const prios = (pou: string, from: string) =>
  extractEdgesFromMermaid(generateStatechartModel(DUT, pou, { showTransitionPriorities: true, priorityFormat: 'paren' }).markdown)
    .filter((e) => e.from === from && e.priority)
    .sort((a, b) => a.priority! - b.priority!)
    .map((e) => `${e.to}(${e.priority})`)
    .join(' ');
const apply = (pou: string, r: ReturnType<typeof setTransitionPriority>) => {
  if ('error' in r) throw new Error(r.error);
  const u = updateMethodCodeInPou(pou, r.method, r.code);
  if (!u.success) throw new Error(u.error);
  return u.updatedPou;
};
const doState = (pou: string) => getMethodCodeFromPou(pou, 'doState').code;
const edge = (from: string, to: string, priority?: number) => ({ from, to, priority });

expect(prios(POU, 'S_A') === 'S_B(1) S_C(2) S_D(3) S_E(4)', `the generator's order: ${prios(POU, 'S_A')}`);
const o = transitionOrder(POU, edge('S_A', 'S_C', 2), V);
expect(!('error' in o) && o.priority === 2 && o.count === 4 && o.targets.join() === 'S_B,S_C,S_D,S_E', `transitionOrder: ${JSON.stringify(o)}`);

// ELSIF arm before the IF arm: conditions and code swap, the first keeps IF
let p = apply(POU, setTransitionPriority(POU, edge('S_A', 'S_C', 2), 1, V));
expect(prios(p, 'S_A') === 'S_C(1) S_B(2) S_D(3) S_E(4)', `S_C to 1: ${prios(p, 'S_A')}`);
const d = doState(p);
expect(/IF b AND\r\n\t\t\t\tc THEN\r\n\t\t\tmachineState := E_S\.S_C; \(\* C \*\)\r\n\t\t\/\/ to B first\r\n\t\tELSIF a THEN/.test(d), 'the arms swapped, the multi-line condition kept, the comment above an arm moves with it');
expect(d.includes('\t\tIF bFirst THEN') && d.includes('// to B first') && d.split('\r\n').length === DO_STATE.split('\r\n').length, 'the other code and the line count unchanged');
// Back again
p = apply(p, setTransitionPriority(p, edge('S_A', 'S_C', 1), 2, V));
expect(doState(p) === DO_STATE, 'and back: the code as it was');

// A separate IF moved before the IF / ELSIF / ELSE: refused (that IF holds three transitions)
let r = setTransitionPriority(POU, edge('S_A', 'S_E', 4), 1, V);
expect('error' in r, `S_E to 1 across the IF / ELSIF / ELSE: ${'error' in r ? r.error : 'done'}`);
// The ELSE arm cannot go before the others
r = setTransitionPriority(POU, edge('S_A', 'S_D', 3), 2, V);
expect('error' in r && /ELSE/.test(r.error), `the ELSE: ${'error' in r ? r.error : 'done'}`);
// Arms nested inside an IF: found there (an ELSE stays last)
r = setTransitionPriority(POU, edge('S_E', 'S_B', 2), 1, V);
expect('error' in r && /ELSE/.test(r.error), `nested IF / ELSE: ${'error' in r ? r.error : 'done'}`);
const nested = POU.replace('\t\t\tELSE\r\n\t\t\t\tmachineState := E_S.S_B;', '\t\t\tELSIF w THEN\r\n\t\t\t\tmachineState := E_S.S_B;');
p = apply(nested, setTransitionPriority(nested, edge('S_E', 'S_B', 2), 1, V));
expect(prios(p, 'S_E') === 'S_B(1) S_A(2)' && /\t\tIF y THEN\r\n\t\t\tIF w THEN/.test(doState(p)), `nested IF / ELSIF swapped: ${prios(p, 'S_E')}`);

// Separate IFs swap as whole statements (a sample state with them)
const two = POU.replace('\t\tIF e THEN\r\n\t\t\tmachineState := E_S.S_E;\r\n\t\tEND_IF', '\t\tIF e THEN\r\n\t\t\tmachineState := E_S.S_E;\r\n\t\tEND_IF\r\n\t\tn := n + 1;\r\n\t\tIF f THEN machineState := E_S.S_B; END_IF');
expect(prios(two, 'S_A') === 'S_B(1) S_C(2) S_D(3) S_E(4) S_B(5)', `two separate IFs: ${prios(two, 'S_A')}`);
p = apply(two, setTransitionPriority(two, edge('S_A', 'S_B', 5), 4, V));
expect(prios(p, 'S_A') === 'S_B(1) S_C(2) S_D(3) S_B(4) S_E(5)' && /IF f THEN machineState := E_S\.S_B; END_IF\r\n\t\tn := n \+ 1;\r\n\t\tIF e THEN/.test(doState(p)), `the one-line IF before the other: ${prios(p, 'S_A')}`);

// preProcess(): its order
const pre = { from: 'AnyState', to: 'S_E', condition: '[preProcess] bFault' };
const po = transitionOrder(POU, pre, V);
expect(!('error' in po) && po.method === 'preProcess' && po.priority === 2 && po.count === 2, `preProcess order: ${JSON.stringify(po)}`);
p = apply(POU, setTransitionPriority(POU, pre, 1, V));
expect(getMethodCodeFromPou(p, 'preProcess').code === 'IF bFault THEN\r\n\tmachineState := E_S.S_E;\r\nEND_IF\r\nIF bReset THEN\r\n\tmachineState := E_S.S_A;\r\nEND_IF', 'preProcess: the IFs swapped');

// The end: the target changes, the qualifier stays
p = apply(POU, retargetTransition(POU, edge('S_A', 'S_C', 2), 'S_E', V));
expect(prios(p, 'S_A') === 'S_B(1) S_E(2) S_D(3) S_E(4)' && doState(p).includes('\t\t\tmachineState := E_S.S_E; (* C *)'), `S_A → S_C now → S_E: ${prios(p, 'S_A')}`);
p = apply(POU, retargetTransition(POU, pre, 'S_D', V));
expect(getMethodCodeFromPou(p, 'preProcess').code.includes('\tmachineState := E_S.S_D;') && !getMethodCodeFromPou(p, 'preProcess').code.includes('S_E'), 'preProcess: the end retargeted');
r = retargetTransition(POU, edge('S_A', 'S_B', 1), 'S_A', V);
expect('error' in r, `to itself: ${'error' in r ? r.error : 'done'}`);
r = retargetTransition(POU, edge('[*]', 'S_A'), 'S_B', V);
expect('error' in r, `the initial transition: ${'error' in r ? r.error : 'done'}`);

// The start: a whole IF moves to the end of the other branch
p = apply(POU, moveTransitionStart(POU, edge('S_A', 'S_E', 4), 'S_B', V));
expect(prios(p, 'S_A') === 'S_B(1) S_C(2) S_D(3)' && prios(p, 'S_B') === 'S_A(1) S_E(2)', `S_A → S_E now leaves S_B: ${prios(p, 'S_A')} | ${prios(p, 'S_B')}`);
expect(/\tS_B:\r\n\t\tIF x THEN\r\n\t\t\tmachineState := E_S\.S_A;\r\n\t\tEND_IF\r\n\t\tIF e THEN\r\n\t\t\tmachineState := E_S\.S_E;\r\n\t\tEND_IF\r\n\tS_C, S_D:/.test(doState(p)), 'moved as it was, indented like the branch');
// The IF arm of an IF / ELSIF: the ELSIF becomes the IF
p = apply(POU, moveTransitionStart(POU, edge('S_A', 'S_B', 1), 'S_E', V));
const d2 = doState(p);
expect(prios(p, 'S_A') === 'S_C(1) S_D(2) S_E(3)' && /\t\tIF b AND\r\n\t\t\t\tc THEN/.test(d2) && /\t\tEND_IF\r\n\t\t\/\/ to B first\r\n\t\tIF a THEN\r\n\t\t\tmachineState := E_S\.S_B;\r\n\t\tEND_IF\r\nEND_CASE/.test(d2), `the IF arm moved to S_E: ${prios(p, 'S_A')} | ${prios(p, 'S_E')}`);
// An ELSIF arm: its own IF
p = apply(POU, moveTransitionStart(POU, edge('S_A', 'S_C', 2), 'S_B', V));
expect(prios(p, 'S_A') === 'S_B(1) S_D(2) S_E(3)' && prios(p, 'S_B') === 'S_A(1) S_C(2)' && /\t\tIF b AND\r\n\t\t\t\tc THEN\r\n\t\t\tmachineState := E_S\.S_C; \(\* C \*\)\r\n\t\tEND_IF\r\n\tS_C, S_D:/.test(doState(p)), `an ELSIF arm moved: ${prios(p, 'S_B')}`);
// The ELSE of an IF / ELSIF / ELSE: as IF NOT (a) AND NOT (b AND c) of its own; the IF stays without it
r = moveTransitionStart(POU, edge('S_A', 'S_D', 3), 'S_B', V);
expect(!('error' in r), `the ELSE arm: moved (${'error' in r ? r.error : r.message})`);
if (!('error' in r)) {
  const d = doState(apply(POU, r));
  expect(/\tS_B:\r\n\t\tIF x THEN\r\n\t\t\tmachineState := E_S\.S_A;\r\n\t\tEND_IF\r\n\t\tIF NOT \(a\) AND NOT \(b AND c\) THEN\r\n\t\t\tmachineState := E_S\.S_D;\r\n\t\tEND_IF/.test(d) && !/\tS_A:[\s\S]*ELSE\r\n\t\t\tmachineState := E_S\.S_D;[\s\S]*\tS_B:/.test(d), `the ELSE arm: in S_B as IF NOT (a) AND NOT (b AND c), gone from S_A's IF (${d.slice(0, 400)})`);
  expect(prios(apply(POU, r), 'S_A') === 'S_B(1) S_C(2) S_E(3)', `the ELSE arm: S_A's others kept: ${prios(apply(POU, r), 'S_A')}`);
}
// Nested in IFs (an arm of an IF inside an ELSIF arm): moved inside IFs with their conditions, the next arm its IF
const NESTED = [
  'CASE machineState OF',
  '\tS_A:',
  '\t\tIF p THEN',
  '\t\t\tIF bFirst THEN',
  '\t\t\t\tn := 0;',
  '\t\t\tELSIF q THEN',
  '\t\t\t\tIF (r OR s) THEN',
  '\t\t\t\t\tmachineState := E_S.S_C;',
  '\t\t\t\t// next',
  '\t\t\t\tELSIF t THEN',
  '\t\t\t\t\tmachineState := E_S.S_B;',
  '\t\t\t\tEND_IF',
  '\t\t\tEND_IF',
  '\t\tEND_IF',
  '\tS_B:',
  '\t\tn := 1;',
  'END_CASE',
].join('\r\n');
const NPOU = POU.replace(/<Method Name="doState"[\s\S]*?<\/Method>/, method('doState', NESTED));
const nr = moveTransitionStart(NPOU, edge('S_A', 'S_C', 1), 'S_B', V);
expect(!('error' in nr), `nested: moved (${'error' in nr ? nr.error : nr.message})`);
if (!('error' in nr)) {
  p = apply(NPOU, nr);
  const d = doState(p);
  // (one transition each: no priorities; the chart's edges)
  const keys = extractEdgesFromMermaid(generateStatechartModel(DUT, p, {}).markdown).map((e) => `${e.from}->${e.to}`);
  expect(keys.includes('S_B->S_C') && keys.includes('S_A->S_B') && !keys.includes('S_A->S_C'), `nested: the chart ${keys.join(', ')}`);
  expect(/\tS_B:\r\n\t\tn := 1;\r\n\t\tIF p THEN\r\n\t\t\tIF q THEN\r\n\t\t\t\tIF \(r OR s\) THEN\r\n\t\t\t\t\tmachineState := E_S\.S_C;\r\n\t\t\t\tEND_IF\r\n\t\t\tEND_IF\r\n\t\tEND_IF\r\nEND_CASE/.test(d), 'nested: inside IF p, IF q, indented like the branch');
  expect(/\t\t\tELSIF q THEN\r\n\t\t\t\t\/\/ next\r\n\t\t\t\tIF t THEN\r\n\t\t\t\t\tmachineState := E_S\.S_B;\r\n\t\t\t\tEND_IF/.test(d), 'nested: the next arm (and its comment) now the IF');
  expect(/inside the IFs it was in: p, q/.test(nr.message), `nested: says so (${nr.message})`);
}
// An arm of an IF / ELSE (nested in IF y): moved as an IF of its own; the other arm stays, the ELSE as IF NOT (z)
const ie = moveTransitionStart(POU, edge('S_E', 'S_A', 1), 'S_B', V);
expect(!('error' in ie), `IF / ELSE, its IF arm: moved (${'error' in ie ? ie.error : ie.message})`);
if (!('error' in ie)) {
  const d = doState(apply(POU, ie));
  expect(/\tS_B:\r\n\t\tIF x THEN\r\n\t\t\tmachineState := E_S\.S_A;\r\n\t\tEND_IF\r\n\t\tIF y THEN\r\n\t\t\tIF z THEN\r\n\t\t\t\tmachineState := E_S\.S_A;\r\n\t\t\tEND_IF\r\n\t\tEND_IF\r\n\tS_C, S_D:/.test(d), 'IF / ELSE: the IF arm in S_B, inside IF y');
  expect(/\tS_E:\r\n\t\tIF y THEN\r\n\t\t\tIF NOT \(z\) THEN\r\n\t\t\t\tmachineState := E_S\.S_B;\r\n\t\t\tEND_IF\r\n\t\tEND_IF\r\nEND_CASE/.test(d), `IF / ELSE: the ELSE left as IF NOT (z) (${d.slice(d.indexOf('S_E:'))})`);
  expect(/ELSE stays in S_E as IF NOT \(z\)/.test(ie.message), `IF / ELSE: says so (${ie.message})`);
}
const ee2 = moveTransitionStart(POU, edge('S_E', 'S_B', 2), 'S_A', V);
expect(!('error' in ee2), `IF / ELSE, its ELSE: moved (${'error' in ee2 ? ee2.error : ee2.message})`);
if (!('error' in ee2)) {
  const d = doState(apply(POU, ee2));
  expect(/\t\tIF y THEN\r\n\t\t\tIF NOT \(z\) THEN\r\n\t\t\t\tmachineState := E_S\.S_B;\r\n\t\t\tEND_IF\r\n\t\tEND_IF\r\n\tS_B:/.test(d) && /\tS_E:\r\n\t\tIF y THEN\r\n\t\t\tIF z THEN\r\n\t\t\t\tmachineState := E_S\.S_A;\r\n\t\t\tEND_IF\r\n\t\tEND_IF\r\nEND_CASE/.test(d), `IF / ELSE: the ELSE moved as IF NOT (z), the IF kept (${d})`);
}
// The sample's HALT_FEED → IDLE_FEED_OFF (IF mode = OFF … ELSE … inside IF NOT moving): to HOMMING_READY_TO_START
{
  const tm = SAMPLES.find((x) => x.id === 'table-manager-202')!;
  const hr = moveTransitionStart(tm.pouContent, { from: 'TABLEMANAGER_HALT_FEED', to: 'TABLEMANAGER_IDLE_FEED_OFF', label: '' } as never, 'TABLEMANAGER_HOMMING_READY_TO_START', V);
  expect(!('error' in hr) && /IF NOT \(\(cmd_eFeedMode = FEEDMODE_OFF\)\) THEN|IF NOT \(cmd_eFeedMode = FEEDMODE_OFF\) THEN/.test(hr.code), `the sample's HALT_FEED → IDLE_FEED_OFF moved (${'error' in hr ? hr.error : hr.message})`);
}
// Inside an ELSE: moved inside IF NOT (its IF's condition), as in the IFs around it
const INELSE = NESTED.replace('\t\t\tELSIF q THEN', '\t\t\tELSE');
const er = moveTransitionStart(POU.replace(/<Method Name="doState"[\s\S]*?<\/Method>/, method('doState', INELSE)), edge('S_A', 'S_C', 1), 'S_B', V);
expect(!('error' in er) && /inside the IFs it was in: p, NOT \(bFirst\)/.test(er.message) && /IF p THEN\r\n\t\t\tIF NOT \(bFirst\) THEN\r\n\t\t\t\tIF \(r OR s\) THEN\r\n\t\t\t\t\tmachineState := E_S\.S_C;/.test(er.code), `inside an ELSE: moved inside IF p, IF NOT (bFirst) (${'error' in er ? er.error : er.message})`);
r = moveTransitionStart(POU, edge('S_C', 'S_A', 1), 'S_B', V);
expect('error' in r && /shared/.test(r.error), `a shared branch: ${'error' in r ? r.error : 'done'}`);
r = moveTransitionStart(POU, pre, 'S_B', V);
expect('error' in r, `a preProcess transition: ${'error' in r ? r.error : 'done'}`);
r = moveTransitionStart(POU, edge('S_A', 'S_B', 1), 'S_B', V);
expect('error' in r, `to its own target: ${'error' in r ? r.error : 'done'}`);

// Every sample: each state's transitions reversed and back leaves the code as it was (or is refused)
let swaps = 0;
let refused = 0;
for (const s of SAMPLES as any[]) {
  let model;
  try { model = generateStatechartModel(s.dutContent || '', s.pouContent, { showTransitionPriorities: true, priorityFormat: 'paren' }); } catch { continue; }
  const stateVar = model.stateVar;
  const edges = extractEdgesFromMermaid(model.markdown).filter((e) => e.priority && e.priority > 1 && !/^\[preProcess\]/.test(e.condition || ''));
  for (const e of edges.slice(0, 6)) {
    const up = setTransitionPriority(s.pouContent, e, e.priority! - 1, stateVar);
    if ('error' in up) { refused++; continue; }
    const pou2 = apply(s.pouContent, up);
    const before = prios(s.pouContent, e.from).split(' ');
    const after = prios(pou2, e.from).split(' ');
    const moved = before.map((x) => x.replace(/\(\d+\)$/, ''));
    const [i, j] = [e.priority! - 2, e.priority! - 1];
    [moved[i], moved[j]] = [moved[j], moved[i]];
    const ok = after.map((x) => x.replace(/\(\d+\)$/, '')).join() === moved.join();
    const back = setTransitionPriority(pou2, { ...e, priority: e.priority! - 1 }, e.priority!, stateVar);
    const same = !('error' in back) && getMethodCodeFromPou(apply(pou2, back), 'doState').code === getMethodCodeFromPou(s.pouContent, 'doState').code;
    if (!ok || !same) expect(false, `${s.title}: ${e.from} → ${e.to} (${e.priority}) up and back: ${after.join(' ')}${same ? '' : ', not the same code'}`);
    swaps++;
  }
}
expect(swaps > 5, `samples: ${swaps} priority changes up and back (${refused} refused)`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
