// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Measured state times: count, average, median, 90%, longest, total per state; levels quick (0) to slow (4)
import { stateTimeLevels, stateTimes } from '../../src/utils/stateTimes.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const tr = (from: string, dwellMs: number) => ({ from, dwellMs });
const times = stateTimes([tr('A', 1000), tr('A', 3000), tr('A', 2000), tr('B', 10000), tr('C', 100), tr('C', 300), tr('A', 4000), tr('X', NaN)]);
const a = times.find((t) => t.state === 'A')!;
expect(times.length === 3 && !times.some((t) => t.state === 'X'), `three states measured (no NaN): ${times.map((t) => t.state).join(',')}`);
expect(a.n === 4 && a.avgMs === 2500 && a.medianMs === 2500 && a.minMs === 1000 && a.maxMs === 4000 && a.totalMs === 10000, `A: n ${a.n}, avg ${a.avgMs}, median ${a.medianMs}`);
expect(Math.abs(a.p90Ms - 3700) < 1e-9, `A: 90% ${a.p90Ms}`);
expect(times[0].state === 'A' || times[0].state === 'B', 'most time in total first (A and B: 10 s each)');
const levels = stateTimeLevels(times);
expect(levels.C.level === 0 && levels.B.level === 4 && levels.A.level > 0 && levels.A.level < 4, `levels: C ${levels.C.level}, A ${levels.A.level}, B ${levels.B.level}`);
expect(/⌀ 2\.50 s · 4×/.test(levels.A.label) && /median 2\.50 s/.test(levels.A.title), `badge: ${levels.A.label}`);
expect(stateTimeLevels(stateTimes([tr('Only', 5)])).Only.level === 0, 'a single state: level 0');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
