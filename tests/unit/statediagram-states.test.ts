// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The state diagram draws every state the flowchart draws: one with no transition and no description too (a state
// moved out of its composite and no longer the enum's first member, so no longer the initial one, stays on the canvas)
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { generateStatechartModel } from '../../src/generator.ts';
import { moveToComposite } from '../../src/utils/statechartEdits.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// The flowchart's states: its node declarations (ID["…"]), not the start symbol, choices or composites
const flowStates = (md: string) => [...md.matchAll(/^\s*([A-Za-z_]\w*)\["/gm)].map((m) => m[1]).filter((id) => id !== 'startNode');
const missingIn = (md: string, ids: string[]) => ids.filter((id) => !new RegExp(`(^|[^\\w])${id}([^\\w]|$)`, 'm').test(md));

const cases: { name: string; dut: string; pou: string }[] = SAMPLES.map((s) => ({ name: s.id, dut: s.dutContent, pou: s.pouContent }));
// (moved into a composite and out again: no longer the enum's first member)
const km = SAMPLES.find((s) => s.id === 'k-analog-measure');
if (km) {
  const a = moveToComposite(km.dutContent, ['KANALOGMEASURE_DISABLED'], 'KAnalogMeasureEnabled');
  const b = 'error' in a ? a : moveToComposite(a.dut, ['KANALOGMEASURE_DISABLED'], null);
  expect(!('error' in b), 'k-analog-measure: DISABLED moved into KAnalogMeasureEnabled and out again');
  if (!('error' in b)) cases.push({ name: 'k-analog-measure, DISABLED in and out of its composite', dut: b.dut, pou: km.pouContent });
}
for (const c of cases) {
  const flow = generateStatechartModel(c.dut, c.pou, { flowchartOutput: true }).markdown;
  const states = flowStates(flow);
  const sd = generateStatechartModel(c.dut, c.pou, { flowchartOutput: false }).markdown;
  const missing = missingIn(sd, states);
  expect(states.length > 0 && missing.length === 0, `${c.name}: the state diagram draws the flowchart's ${states.length} states (${missing.join(', ') || 'all'})`);
}

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
