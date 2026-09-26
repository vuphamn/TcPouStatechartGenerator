// (tests/unit: bundled with esbuild and run by tests/run.cjs)
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { diffCharts } from '../../src/utils/chartDiff.ts';
import { renameState, addState, addTransition } from '../../src/utils/stateEdits.ts';
import { getMethodCodeFromPou, updateMethodCodeInPou } from '../../src/utils/pouStateEditor.ts';
let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const tm = (SAMPLES as any[])[0];
const base = { pou: tm.pouContent, dut: tm.dutContent };
expect(diffCharts(base, base).total === 0, 'identical versions: no changes');
// guard change + state code change
let pou = updateMethodCodeInPou(tm.pouContent, 'doState', getMethodCodeFromPou(tm.pouContent, 'doState').code.replace('IF (cmd_bHome) THEN', 'IF (cmd_bHome AND bSafe) THEN')).updatedPou;
let d = diffCharts(base, { pou, dut: tm.dutContent });
console.log('   guard edit:', JSON.stringify({ changed: d.statesChanged, guards: d.guardsChanged.map((g) => `${g.from}->${g.to}`) }));
expect(d.statesChanged.includes('TABLEMANAGER_HOMMING_READY_TO_START') && d.guardsChanged.length >= 1 && d.transitionsAdded.length === 0, 'guard edit: state code changed, guard changed');
// add a state + transition
const add = addState(tm.pouContent, tm.dutContent, 'TABLEMANAGER_NEW_STEP')!;
pou = updateMethodCodeInPou(tm.pouContent, 'doState', add.pouCode).updatedPou;
pou = updateMethodCodeInPou(pou, 'doState', addTransition(pou, 'TABLEMANAGER_CLAMPED', 'TABLEMANAGER_NEW_STEP', 'bGo', 'machineState')!).updatedPou;
d = diffCharts(base, { pou, dut: add.dut! });
expect(d.statesAdded.join() === 'TABLEMANAGER_NEW_STEP' && d.transitionsAdded.some((t) => t.from === 'TABLEMANAGER_CLAMPED' && t.to === 'TABLEMANAGER_NEW_STEP' && /bGo/.test(t.guard)), `added state and transition (${d.total} changes)`);
// rename: one removed, one added
const r = renameState(tm.pouContent, tm.dutContent, 'TABLEMANAGER_HOMMING', 'TABLEMANAGER_HOMING');
d = diffCharts(base, { pou: r.pou, dut: r.dut });
expect(d.statesRemoved.join() === 'TABLEMANAGER_HOMMING' && d.statesAdded.join() === 'TABLEMANAGER_HOMING', 'rename shows as removed + added');
console.log(`${fails} failures`);

if (typeof fails === 'number' && fails > 0) process.exitCode = 1;
