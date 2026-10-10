// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Another company's POU that EXTENDS a base of its own, its states an enum written inline in its declaration
// (tests/fixtures/third-party-inline-enum.cjs: Phase : (Waiting, OffEdge, OnBest, OnLesser), CASE Phase OF in
// TrackSample()): its state method found by its CASE whatever its name, the inline enum read (and made a read-only
// enum for the chart), every transition of the CASE; a Kval POU that EXTENDS its base with a CASE of its own on an
// enum (a homing sequence) still Kval's: doState(), its base looked for
import { generateStatechartModel } from '../../src/generator.ts';
import { inlineEnumOf, inlineStateEnum, stateMethodName, stateEnumTypeOf } from '../../src/utils/stateMethod.ts';
import { hasOwnMethod } from '../../src/utils/pouInheritance.ts';
import { extractIdentifiedStatesFromPou } from '../../src/utils/pouStateExtractor.ts';
import { enumValueMap } from '../../src/utils/liveView.ts';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pou, kvalDerived } = require('../fixtures/third-party-inline-enum.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// The state method: TrackSample(), though the POU EXTENDS a base (not Kval's)
expect(stateMethodName(pou) === 'TrackSample', `the state method: TrackSample() (${stateMethodName(pou)})`);
expect(hasOwnMethod(pou, 'doState'), 'its own state method: no base looked for');
// The inline enum
expect(JSON.stringify(inlineEnumOf(pou, 'Phase')?.map((m) => m.name)) === '["Waiting","OffEdge","OnBest","OnLesser"]', `Phase's inline enum read (${inlineEnumOf(pou, 'Phase')?.map((m) => m.name).join(', ')})`);
expect(stateEnumTypeOf(pou) === null, 'no .TcDUT to look for (inline)');
const inline = inlineStateEnum(pou);
expect(!!inline && inline.varName === 'Phase' && inline.typeName === 'FB_StepTracker_Phase' && /TYPE FB_StepTracker_Phase :\s*\(\s*Waiting,\s*OffEdge,\s*OnBest,\s*OnLesser\s*\);/.test(inline.dut), "the enum made from it, a .TcDUT's text");
const values = inline ? enumValueMap(inline.dut) : new Map();
expect(values.get(0) === 'Waiting' && values.get(3) === 'OnLesser', `its values for live view (0: ${values.get(0)}, 3: ${values.get(3)})`);

// The chart: the CASE's transitions with the made enum
const model = generateStatechartModel(inline?.dut ?? '', pou, {});
const pairs = model.edges.flatMap((e) => (e.members.length ? e.members : [{ from: e.from, to: e.to }])).map((t) => `${t.from}->${t.to}`);
const want = ['Waiting->OffEdge', 'OffEdge->OnBest', 'OffEdge->OnLesser', 'OnBest->OffEdge', 'OnLesser->OffEdge'];
expect(want.every((w) => pairs.includes(w)) && model.stateVar === 'Phase', `its transitions (${pairs.join(', ')}; ${model.stateVar})`);
const ids = extractIdentifiedStatesFromPou(pou, inline?.dut ?? '');
expect(ids.stateVarName === 'Phase' && ['Waiting', 'OffEdge', 'OnBest', 'OnLesser'].every((s) => ids.states.some((x) => x.id === s)), `its states listed (${ids.states.map((s) => s.id).join(', ')})`);

// Kval's POU that EXTENDS its base, with a CASE of its own (a homing sequence): still doState(), its base looked for
expect(stateMethodName(kvalDerived) === 'doState' && !hasOwnMethod(kvalDerived, 'doState'), `Kval's derived POU: doState() (its base's), not homing() (${stateMethodName(kvalDerived)})`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
