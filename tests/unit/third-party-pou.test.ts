// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// A POU written by another company (tests/fixtures/third-party-pou.cjs): its state machine in Execute(), CASE State
// OF, State an enum, labels qualified; transitions through helper methods given the next state as an argument
// (MoveAndAdvance(…, NextState := E_ScanState.ResetData) over several lines, AdvanceWhenDone(NextState := …)), which
// set State := NextState behind their own IF. The state method found (Kval's doState() still first), any state
// variable name, the helpers written out with their arguments (their IF the guard), the Method Editor's doState()
// meaning Execute(), the declared type of the state variable (its enum looked for by it)
import { generateStatechartModel } from '../../src/generator.ts';
import { stateMethodName, declaredTypeOf } from '../../src/utils/stateMethod.ts';
import { getMethodCodeFromPou, updateMethodCodeInPou } from '../../src/utils/pouStateEditor.ts';
import { extractIdentifiedStatesFromPou } from '../../src/utils/pouStateExtractor.ts';
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { extractPouHierarchyMetadata } from '../../src/utils/pouHierarchy.ts';
import { lintStateMachine } from '../../src/utils/stateMachineLint.ts';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pou, dut } = require('../fixtures/third-party-pou.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// The state method and variable
expect(stateMethodName(pou) === 'Execute', `the state method: Execute() (${stateMethodName(pou)})`);
expect(declaredTypeOf(pou, 'State') === 'E_ScanState', `State's declared type: its enum (${declaredTypeOf(pou, 'State')})`);
expect(SAMPLES.every((s) => stateMethodName(s.pouContent) === 'doState'), "Kval's POUs: doState() as before");

// The chart: every transition, those through the helpers too (their arguments put in)
const model = generateStatechartModel(dut, pou, {});
const pairs = model.edges.flatMap((e) => (e.members.length ? e.members : [{ from: e.from, to: e.to }])).map((t) => `${t.from}->${t.to}`);
const want = [
  'InitializeScan->MoveToStart',
  'MoveToStart->ResetData',
  'ResetData->FastScan',
  'FastScan->ProcessFastScan',
  'ProcessFastScan->ComputeResult',
  'ComputeResult->InitializeScan',
];
expect(want.every((w) => pairs.includes(w)), `the transitions, through the helpers too: ${pairs.join(', ')}`);
expect(!pairs.some((p) => /NextState/.test(p)), 'no transition to the parameter itself (NextState)');

// The guards: the helper's IF (robot idle) for AdvanceWhenDone, the move started for MoveAndAdvance
const guardOf = (from: string, to: string) => {
  // (its IFs around it: the member's frames, and the label drawn)
  for (const e of model.edges) for (const m of e.members) if (m.from === from && m.to === to) return `${e.label} ${JSON.stringify(m.frames)}`;
  return '';
};
expect(/RobotState\s*=\s*E_RobotState\.Idle/.test(guardOf('FastScan', 'ProcessFastScan')), `FastScan → ProcessFastScan: the helper's IF as its guard (${guardOf('FastScan', 'ProcessFastScan')})`);
expect(/StartMove/.test(guardOf('MoveToStart', 'ResetData')), `MoveToStart → ResetData: the move started (${guardOf('MoveToStart', 'ResetData')})`);

// The identified states: State, the enum's members
const ids = extractIdentifiedStatesFromPou(pou, dut);
expect(ids.stateVarName === 'State' && ['InitializeScan', 'MoveToStart', 'ComputeResult'].every((s) => ids.states.some((x) => x.id === s)), `the states, State as the variable (${ids.stateVarName}: ${ids.states.map((s) => s.id).join(', ')})`);

// The Method Editor / edits asking for doState(): Execute()
const code = getMethodCodeFromPou(pou, 'doState');
expect(code.methodFound && code.methodName === 'Execute' && /CASE State OF/.test(code.code), `doState() asked: Execute()'s code (${code.methodName})`);
const edited = updateMethodCodeInPou(pou, 'doState', code.code.replace('_Count := _Count + 1;', '_Count := _Count + 2;'));
expect(edited.success && /<Method Name="Execute"[\s\S]*?_Count := _Count \+ 2;/.test(edited.updatedPou) && !/<Method Name="doState"/.test(edited.updatedPou), 'an edit of doState(): written into Execute(), no doState() added');

// The Method Editor's breadcrumb and list: Execute() the state method (no doState() added)
const meta = extractPouHierarchyMetadata(pou, 'FB_ScanSequencer.TcPOU');
expect(meta.stateMethod === 'Execute' && meta.methodSignatures.Execute?.isStateMethod === true && !meta.allMethods.some((m) => /^doState/i.test(m)), `the hierarchy: Execute the state method (${meta.stateMethod}; ${meta.allMethods.join(', ')})`);
// The checks (Problems) run on Execute()'s CASE: a state the enum has with no branch would be said (none here)
const findings = lintStateMachine(pou, dut, model.edges.map((e) => ({ from: e.from, to: e.to, label: e.label })) as never);
expect(!findings.some((f) => f.rule === 'unknown-target') && !findings.some((f) => /no CASE branch/i.test(f.message)), `the checks read Execute()'s CASE (${findings.length} finding(s): ${findings.slice(0, 3).map((f) => f.rule).join(', ')})`);
const noBranch = lintStateMachine(pou, dut.replace('ComputeResult\n', 'ComputeResult,\n\tParked\n'), []);
expect(noBranch.some((f) => /Parked/.test(f.message)), `an enum member without a branch in Execute(): said (${noBranch.map((f) => f.message).find((m) => /Parked/.test(m)) ?? 'not said'})`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
