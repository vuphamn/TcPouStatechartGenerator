// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Pause on state (src/utils/pauseOnState.ts): the first sample entering a chosen state (not a repeat of the state shown
// already, case not counted); a replay's step stopped at the entry after its position, not at it (Play goes on)
import { firstEntryInto, replayStopIn } from '../../src/utils/pauseOnState.ts';

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

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
