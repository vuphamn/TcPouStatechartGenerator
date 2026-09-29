// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// A choice's arm (drawn from its diamond, choice_<state>_<IF id>): its transition is its state's, so an arm dragged to
// another state retargets that state's transition
import { armState } from '../../src/utils/choiceArms.ts';
import { retargetTransition, transitionCondition } from '../../src/utils/transitionEdits.ts';
import { SAMPLES } from '../../src/samples/samplesData.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

expect(armState('choice_TABLEMANAGER_CLAMPED_20') === 'TABLEMANAGER_CLAMPED' && armState('choice_S_1_2_7') === 'S_1_2' && armState('TABLEMANAGER_CLAMPED') === null && armState('choice_X') === null, 'armState: the state of a diamond, none for other nodes');

const pou = SAMPLES.find((s) => s.pouName === 'SM_TableManager.TcPOU')!.pouContent;
// (the arm as drawn, mapped to its state as the app does)
const drawn = { id: 'choice_TABLEMANAGER_CLAMPED_20->TABLEMANAGER_UNCLAMP_START', from: 'choice_TABLEMANAGER_CLAMPED_20', to: 'TABLEMANAGER_UNCLAMP_START' };
const from = armState(drawn.from)!;
const edge = { ...drawn, from, id: `${from}->${drawn.to}` };
const c = transitionCondition(pou, edge, 'machineState');
expect(!('error' in c) && c.condition === '(cmd_bUnclamp)', `its condition: ${'error' in c ? c.error : c.condition}`);
const r = retargetTransition(pou, edge, 'TABLEMANAGER_REFEED_START', 'machineState');
// (the line it changed: the arm's assignment, now to REFEED_START, still under its condition)
const at = 'error' in r ? '' : (r.code.split(/\r?\n/)[r.line - 1] ?? '');
expect(!('error' in r) && /TABLEMANAGER_REFEED_START/.test(at) && /cmd_bUnclamp/.test(r.code), `dragged onto REFEED_START: ${'error' in r ? r.error : `line ${r.line}: ${at.trim()}`}`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
