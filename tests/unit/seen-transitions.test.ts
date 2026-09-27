// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Transitions the PLC took: counted, per state, and a Save that drops one of them found (the sample's edge deleted)
import { generateStatechartModel } from '../../src/generator.ts';
import { deleteTransition } from '../../src/utils/transitionEdits.ts';
import { addSeen, removedSeenTransitions, seenKey, stateSeen } from '../../src/utils/seenTransitions.ts';
import { SAMPLES } from '../../src/samples/samplesData.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const s = SAMPLES[0];
const model = generateStatechartModel(s.dutContent, s.pouContent, {});
const edge = model.edges.find((e) => e.members.length === 1 && e.from !== e.to && !/\[\*\]/.test(e.from + e.to) && !(e.from in model.composites) && !(e.to in model.composites))!;
expect(!!edge, `an edge of the sample: ${edge?.from} -> ${edge?.to}`);

let seen = addSeen({}, [{ from: edge.from, to: edge.to, t: 1000 }, { from: edge.from, to: edge.to, t: 3000 }, { from: 'X', to: edge.from, t: 2000 }]);
expect(seen[seenKey(edge.from, edge.to)]?.n === 2 && seen[seenKey(edge.from, edge.to)]?.last === 3000, 'counted twice, last time kept');
const st = stateSeen(seen, edge.from);
expect(st.n === 3 && st.last === 3000, `the state: in or out ${st.n} times`);

expect(removedSeenTransitions(s.dutContent, s.pouContent, s.dutContent, s.pouContent, seen).length === 0, 'unchanged: nothing removed');
const r = deleteTransition(s.pouContent, { from: edge.from, to: edge.to, priority: 1 }, model.stateVar);
if ('error' in r) {
  expect(false, `deleted: ${r.error}`);
} else {
  const removed = removedSeenTransitions(s.dutContent, s.pouContent, s.dutContent, r.pou, seen);
  expect(removed.length === 1 && removed[0].from === edge.from && removed[0].to === edge.to && removed[0].n === 2, `the edit drops it: ${JSON.stringify(removed)}`);
  seen = addSeen({}, [{ from: 'A', to: 'B', t: 1 }]);
  expect(removedSeenTransitions(s.dutContent, s.pouContent, s.dutContent, r.pou, seen).length === 0, 'not taken by the PLC: not reported');
}

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
