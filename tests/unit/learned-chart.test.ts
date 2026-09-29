// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// A diagram learned live: the PLC's states (enum names and values) and the transitions seen, as a POU and enum the
// generator draws; drawn again as more are seen; the POU marked as learned (no source)
import { isLearnedPou, learnedAsSource, learnedInputOf, learnedSources } from '../../src/utils/learnedChart.ts';
import { addSeen, candidatesOf, forgetSeen, setSeenCondition } from '../../src/utils/seenTransitions.ts';
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

// 5. What changed just before each transition (its candidates), counted; a transition forgotten; Save as source
let seen2 = addSeen({}, [{ from: 'DOOR_DASHER_DISABLED', to: 'DOOR_DASHER_ENABLING', t: 1, before: ['bEnable', 'nCount'] }]);
seen2 = addSeen(seen2, [{ from: 'DOOR_DASHER_DISABLED', to: 'DOOR_DASHER_ENABLING', t: 2, before: ['bEnable'] }, { from: 'DOOR_DASHER_ENABLING', to: 'DOOR_DASHER_ERROR', t: 3 }]);
expect(JSON.stringify(candidatesOf(seen2['DOOR_DASHER_DISABLED->DOOR_DASHER_ENABLING'])) === '[{"id":"bEnable","n":2},{"id":"nCount","n":1}]' && !seen2['DOOR_DASHER_ENABLING->DOOR_DASHER_ERROR'].before, 'candidates: bEnable twice, nCount once; none for the other');
const withC = learnedSources({ ...input, seen: seen2 })!;
expect(/\/\/ seen 2×; changed just before: bEnable \(2×\), nCount \(1×\)/.test(withC.pou), 'in the learned code: seen 2×; changed just before: bEnable (2×), nCount (1×)');
const forgot = forgetSeen(seen2, 'DOOR_DASHER_ENABLING', 'DOOR_DASHER_ERROR');
expect(Object.keys(forgot).join() === 'DOOR_DASHER_DISABLED->DOOR_DASHER_ENABLING' && forgetSeen(forgot, 'X', 'Y') === forgot, 'forgotten: gone (an unknown one: nothing changes)');
const src = learnedAsSource(withC.pou);
expect(!isLearnedPou(src) && !/seenLive/.test(src) && /IF FALSE \(\* its condition: write it \*\) THEN/.test(src) && /changed just before: bEnable/.test(src), 'as source: not learned, its conditions FALSE to write, the candidates kept in its comments');

// 6. A candidate chosen as its condition: drawn and declared; kept when seen again; not known again
let chosen = setSeenCondition(seen2, 'DOOR_DASHER_DISABLED', 'DOOR_DASHER_ENABLING', 'bEnable');
chosen = addSeen(chosen, [{ from: 'DOOR_DASHER_DISABLED', to: 'DOOR_DASHER_ENABLING', t: 4 }]);
const drawn = learnedSources({ ...input, seen: chosen })!;
expect(chosen['DOOR_DASHER_DISABLED->DOOR_DASHER_ENABLING'].condition === 'bEnable' && chosen['DOOR_DASHER_DISABLED->DOOR_DASHER_ENABLING'].n === 3, 'chosen, and kept when seen again');
expect(/IF bEnable THEN\s+machineState := E_DoorDasher_States\.DOOR_DASHER_ENABLING/.test(drawn.pou) && /\tbEnable : BOOL;/.test(drawn.pou) && /IF seenLive THEN\s+machineState := E_DoorDasher_States\.DOOR_DASHER_ERROR/.test(drawn.pou), 'drawn as IF bEnable THEN (declared); the other still unknown');
const edgeOf = generateStatechartModel(drawn.dut, drawn.pou, {}).edges.find((e) => e.from === 'DOOR_DASHER_DISABLED' && e.to === 'DOOR_DASHER_ENABLING');
expect(!!edgeOf, 'the diagram still has the transition');
const kept = learnedAsSource(drawn.pou);
expect(/IF bEnable THEN/.test(kept) && /IF FALSE \(\* its condition: write it \*\) THEN/.test(kept), 'as source: the chosen condition kept, the unknown one to write');
const member = learnedSources({ ...input, seen: setSeenCondition(seen2, 'DOOR_DASHER_DISABLED', 'DOOR_DASHER_ENABLING', 'fbStart.Q') })!;
expect(/IF fbStart\.Q THEN/.test(member.pou) && !/fbStart\.Q : BOOL/.test(member.pou), 'a member (fbStart.Q): drawn, not declared');
expect(!/IF 1 \+ 1/.test(learnedSources({ ...input, seen: setSeenCondition(seen2, 'DOOR_DASHER_DISABLED', 'DOOR_DASHER_ENABLING', '1 + 1; x := 2') })!.pou) && setSeenCondition(chosen, 'DOOR_DASHER_DISABLED', 'DOOR_DASHER_ENABLING', null)['DOOR_DASHER_DISABLED->DOOR_DASHER_ENABLING'].condition === undefined, 'not a name: not drawn (no code put in); cleared: not known again');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
