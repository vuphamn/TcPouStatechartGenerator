// (tests/unit: bundled with esbuild and run by tests/run.cjs)
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { generateStatechart } from '../../src/generator.ts';
import { extractEdgesFromMermaid } from '../../src/utils/diagramNotes.ts';
import { lintStateMachine, addEnumMember, addCaseBranch, enumMembers } from '../../src/utils/stateMachineLint.ts';
import { getMethodCodeFromPou, updateMethodCodeInPou } from '../../src/utils/pouStateEditor.ts';

const run = (pou: string, dut: string) => lintStateMachine(pou, dut, extractEdgesFromMermaid(generateStatechart(dut, pou, {})));
let fails = 0;
const expect = (cond: boolean, what: string) => { if (!cond) { fails++; console.log('  FAIL: ' + what); } };
const tm = (SAMPLES as any[])[0];
const setDoState = (pou: string, fn: (c: string) => string) => updateMethodCodeInPou(pou, 'doState', fn(getMethodCodeFromPou(pou, 'doState').code)).updatedPou;
const has = (f: ReturnType<typeof run>, key: string) => f.some((x) => x.key === key);

for (const s of SAMPLES as any[]) {
  const f = run(s.pouContent, s.dutContent || '');
  // the qualified-enum samples have real findings (ADD_CHILDREN set by the base class; ERROR left by reset)
  const known: Record<string, string> = {
    'k-servo-supply-manager': 'unreachable:ADD_CHILDREN, dead-end:NO_CHILDREN, dead-end:ENABLED, dead-end:ERROR, no-else',
    'k-power-supply-ax86x0': 'dead-end:ERROR, no-else',
  };
  const keys = f.map((x) => x.key).join(', ');
  expect(known[s.id] ? keys === known[s.id] : f.length === 1 && f[0].rule === 'no-else', `${s.title}: expected findings (${keys})`);
  const d = addEnumMember(s.dutContent, 'ZZ_NEW_STATE');
  expect(!!d && enumMembers(d).at(-1) === 'ZZ_NEW_STATE' && enumMembers(d).length === enumMembers(s.dutContent).length + 1, `${s.title}: addEnumMember`);
  const code = addCaseBranch(s.pouContent, 'ZZ_NEW_STATE');
  expect(!!code && /ZZ_NEW_STATE:/.test(code), `${s.title}: addCaseBranch`);
}
let pou = setDoState(tm.pouContent, (c) => c.replace('machineState := TABLEMANAGER_HOMMING;', 'machineState := TABLEMANAGER_BOGUS;'));
let f = run(pou, tm.dutContent);
expect(has(f, 'unknown-target:TABLEMANAGER_BOGUS'), 'unknown-target');
const d2 = addEnumMember(tm.dutContent, 'TABLEMANAGER_BOGUS')!;
f = run(pou, d2);
expect(!has(f, 'unknown-target:TABLEMANAGER_BOGUS') && has(f, 'missing-branch:TABLEMANAGER_BOGUS'), 'add-enum fix');
f = run(updateMethodCodeInPou(pou, 'doState', addCaseBranch(pou, 'TABLEMANAGER_BOGUS')!).updatedPou, d2);
expect(!has(f, 'missing-branch:TABLEMANAGER_BOGUS') && has(f, 'dead-end:TABLEMANAGER_BOGUS'), 'add-branch fix');
pou = setDoState(tm.pouContent, (c) => c.replace(/(\r?\n)(\s*)END_CASE/, '$1$2TABLEMANAGER_HALT_FEED:$1$2\tx := 1;$1$2END_CASE'));
expect(has(run(pou, tm.dutContent), 'duplicate-case:TABLEMANAGER_HALT_FEED'), 'duplicate-case');
pou = setDoState(tm.pouContent, (c) => c.replace(/^(\s*)TABLEMANAGER_HALT_FEED:/m, '$1TABLEMANAGER_HALT_FEED:\n\t\tmachineState := TABLEMANAGER_HALT_FEED;'));
expect(has(run(pou, tm.dutContent), 'self-transition:TABLEMANAGER_HALT_FEED'), 'self-transition');
pou = setDoState(tm.pouContent, (c) => c.replace(/^(\s*)TABLEMANAGER_HALT_FEED:/m, '$1(* TABLEMANAGER_HALT_FEED: *)'));
expect(has(run(pou, tm.dutContent), 'missing-branch:TABLEMANAGER_HALT_FEED'), 'missing-branch');
pou = setDoState(tm.pouContent, (c) => c.replace(/(\r?\n)(\s*)END_CASE/, '$1$2TABLEMANAGER_X:$1$2\tmachineState := TABLEMANAGER_ERROR;$1$2END_CASE'));
expect(has(run(pou, addEnumMember(tm.dutContent, 'TABLEMANAGER_X')!), 'unreachable:TABLEMANAGER_X'), 'unreachable');
expect(has(run(tm.pouContent, addEnumMember(tm.dutContent, 'TABLEMANAGER_UNUSED_X')!), 'unused-enum:TABLEMANAGER_UNUSED_X'), 'unused-enum');
pou = setDoState(tm.pouContent, (c) => c.replace(/^(\s*)TABLEMANAGER_HALT_FEED:/m, '$1TABLEMANAGER_HALT_FEED:\n\t\tCASE iSub OF\n\t\t\t1: x := 1;\n\t\t\tSUB_A: x := 2;\n\t\tELSE\n\t\t\tx := 3;\n\t\tEND_CASE'));
f = run(pou, tm.dutContent);
expect(!f.some((x) => x.stateId === 'SUB_A') && has(f, 'no-else') && f.length === 1, 'nested CASE ignored');
console.log(`${fails} failures`);

if (typeof fails === 'number' && fails > 0) process.exitCode = 1;
