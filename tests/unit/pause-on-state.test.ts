// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Pause on state (src/utils/pauseOnState.ts): the first sample entering a chosen state (not a repeat of the state shown
// already, case not counted); a replay's step stopped at the entry after its position, not at it (Play goes on)
import { conditionMetIn, firstEntryInto, meetsCondition, parsePauseCondition, replayConditionStopIn, replayStopIn, type PauseCondition } from '../../src/utils/pauseOnState.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const names = new Map([[0, 'IDLE'], [10, 'CLAMPING'], [20, 'CLAMPED'], [30, 'ERROR']]);
const on = new Set(['clamped', 'error']);
const live = [{ t: 1, value: 10 }, { t: 2, value: 10 }, { t: 3, value: 20 }, { t: 4, value: 20 }, { t: 5, value: 30 }];
expect(firstEntryInto(live, names, on, 0) === 2, 'live: CLAMPED entered at the third sample');
expect(firstEntryInto(live.slice(3), names, on, 20) === 1, 'already in CLAMPED: not again; ERROR next');
expect(firstEntryInto(live, names, new Set(), 0) === -1 && firstEntryInto(live, names, new Set(['nowhere']), 0) === -1, 'nothing chosen / never entered: -1');

const rec = [{ t: 0, value: 0 }, { t: 1000, value: 10 }, { t: 2500, value: 20 }, { t: 4000, value: 0 }, { t: 6000, value: 30 }];
expect(JSON.stringify(replayStopIn(rec, 0, 3000, names, on)) === '{"t":2500,"state":"CLAMPED"}', 'replay: the step stops at CLAMPED');
expect(replayStopIn(rec, 2500, 5000, names, on) === null, 'from the stop: not stopped at it again (Play goes on)');
expect(JSON.stringify(replayStopIn(rec, 2500, 9000, names, on)) === '{"t":6000,"state":"ERROR"}', 'the next one: ERROR');
expect(replayStopIn(rec, 3000, 3000, names, on) === null, 'no step: nothing');

// Conditions: parsed (its variable watched by its lower-case id), met by values (BOOL, numbers, enum names), an edge
const c1 = parsePauseCondition('bError == TRUE') as PauseCondition;
const c2 = parsePauseCondition('fbAxis.nCount >= 10') as PauseCondition;
const c3 = parsePauseCondition("eMode <> E_Mode.Auto") as PauseCondition;
expect(c1.text === 'bError = TRUE' && c1.id === 'berror' && c2.id === 'fbaxis.ncount' && c2.value === 10 && c3.op === '<>', `parsed: ${JSON.stringify([c1, c2, c3])}`);
expect('error' in parsePauseCondition('just a name'), 'no comparison: refused');
expect(meetsCondition(c1, true) && !meetsCondition(c1, false) && meetsCondition(c2, 10) && !meetsCondition(c2, 9) && meetsCondition(c3, 'Manual') && !meetsCondition(c3, 'E_Mode.Auto') && !meetsCondition(c1, null), 'met: BOOL, a number, an enum by its name');
expect(conditionMetIn([{ id: 'berror', v: true }], [c1], { berror: true }) === null && conditionMetIn([{ id: 'berror', v: true }], [c1], { berror: false }) === c1, 'an edge: already true, not again');
const recVars = [{ id: 'fbaxis.ncount', t: 0, v: 8 }, { id: 'fbaxis.ncount', t: 1000, v: 9 }, { id: 'fbaxis.ncount', t: 2000, v: 10 }, { id: 'fbaxis.ncount', t: 3000, v: 11 }];
expect(JSON.stringify(replayConditionStopIn(recVars, 500, 5000, [c2])) === '{"t":2000,"text":"fbAxis.nCount >= 10"}' && replayConditionStopIn(recVars, 2000, 5000, [c2]) === null, 'a replay: stopped where it became met, not again from there');
console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
