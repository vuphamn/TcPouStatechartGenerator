// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// A diagram learned live: the PLC's states (enum names and values) and the transitions seen, as a POU and enum the
// generator draws; drawn again as more are seen; the POU marked as learned (no source)
import { isLearnedPou, learnedInputOf, learnedSources } from '../../src/utils/learnedChart.ts';
import { generateStatechartModel } from '../../src/generator.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const names = { 0: 'DOOR_DASHER_DISABLED', 1: 'DOOR_DASHER_ENABLING', 7: 'DOOR_DASHER_ERROR' };
const input = { typeName: 'SM_DoorDasher', stateVar: 'machineState', enumType: 'E_DoorDasher_States', names };

// 1. Nothing seen yet: the states, no transitions
const first = learnedSources({ ...input, seen: {} });
if (!first) expect(false, 'learnedSources: null');
else {
  const m = generateStatechartModel(first.dut, first.pou, { flowchartOutput: true });
  const states = [...m.markdown.matchAll(/DOOR_DASHER_\w+/g)].map((x) => x[0]);
  expect(isLearnedPou(first.pou) && ['DOOR_DASHER_DISABLED', 'DOOR_DASHER_ENABLING', 'DOOR_DASHER_ERROR'].every((s) => states.includes(s)), `its states from the PLC: ${[...new Set(states)].join(', ')}`);
  expect(m.edges.length === 0, `no transition yet (${m.edges.length})`);
  expect(/DOOR_DASHER_ERROR := 7/.test(first.dut), 'the enum keeps the PLC\'s values');
}

// 2. Seen: DISABLED -> ENABLING twice, ENABLING -> ERROR once (and one to a state the PLC does not have: left out)
const seen = { 'DOOR_DASHER_DISABLED->DOOR_DASHER_ENABLING': { n: 2, last: 1 }, 'DOOR_DASHER_ENABLING->DOOR_DASHER_ERROR': { n: 1, last: 2 }, 'DOOR_DASHER_ENABLING->NOT_A_STATE': { n: 1, last: 3 } };
const second = learnedSources({ ...input, seen });
if (!second) expect(false, 'learnedSources (seen): null');
else {
  const m = generateStatechartModel(second.dut, second.pou, { flowchartOutput: true });
  const pairs = m.edges.map((e) => `${e.from}->${e.to}`).sort();
  // (a transition to the error state may be drawn from its group: Collapse error-sink edges)
  expect(pairs.length === 2 && pairs.includes('DOOR_DASHER_DISABLED->DOOR_DASHER_ENABLING') && pairs.some((p) => /->DOOR_DASHER_ERROR$|ENABLING->/.test(p)), `the transitions seen: ${pairs.join(', ')}`);
  expect(/\/\/ seen 2×/.test(second.pou), 'how often, as a comment');
  // Drawn again: the input read back from its own sources
  const again = learnedInputOf(second.pou, second.dut);
  expect(!!again && again.typeName === 'SM_DoorDasher' && again.stateVar === 'machineState' && again.enumType === 'E_DoorDasher_States' && Object.keys(again.names).length === 3 && again.names['7'] === 'DOOR_DASHER_ERROR', `read back: ${JSON.stringify(again)}`);
}
expect(learnedSources({ ...input, names: {}, seen: {} }) === null, 'no states from the PLC: none');
expect(!isLearnedPou('<POU Name="SM_X">'), 'a real POU is not learned');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
