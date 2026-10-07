// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Extract to sub-machine: the K-Test Station's TESTING and DONE moved into Test(), a state machine of its own, called
// from a new state KTESTSTATION_TEST in their place. The chart reads it back as a sub-machine (their states, the step
// between them, its start); the new state's transitions are its exits (to IDLE, to ERROR); the transitions into them go
// into it; the enum has the new state, not theirs. Refused: one state, a name in use, a state used elsewhere (compared
// in preProcess()), states with no transition between them
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { generateStatechartModel, subMachinesOf } from '../../src/generator.ts';
import { extractSubMachine, checkExtractSubMachine, defaultSubMachineState } from '../../src/utils/extractSubMachine.ts';
import { getMethodCodeFromPou } from '../../src/utils/pouStateEditor.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const s = SAMPLES.find((x) => x.id === 'k-test-station')!;
const V = 'machineState';
const states = ['KTESTSTATION_TESTING', 'KTESTSTATION_DONE'];

expect(defaultSubMachineState(states, 'Test') === 'KTESTSTATION_TEST', `its state by default: ${defaultSubMachineState(states, 'Test')}`);
const r = extractSubMachine(s.pouContent, s.dutContent, states, 'Test', V);
expect(!('error' in r), `extracted (${'error' in r ? r.error : r.plan.state})`);
if (!('error' in r)) {
  const { pou, dut, plan } = r;
  expect(plan.entry === 'KTESTSTATION_TESTING' && plan.exits.map((e) => `${e.code}:${e.to}`).join() === '1:KTESTSTATION_IDLE,2:KTESTSTATION_ERROR' && plan.redirected === 1, `its start, its exits, the transitions redirected (${JSON.stringify(plan)})`);
  // (the chart: a sub-machine of the new state)
  const subs = subMachinesOf(pou).filter((m) => m.method === 'Test');
  expect(subs.length === 1 && subs[0].parent === 'KTESTSTATION_TEST' && subs[0].states.join() === states.join() && subs[0].start === 'KTESTSTATION_TESTING' && subs[0].transitions.some((t) => t.from === 'KTESTSTATION_TESTING' && t.to === 'KTESTSTATION_DONE'), `read back as a sub-machine of KTESTSTATION_TEST (${JSON.stringify(subs.map((m) => ({ parent: m.parent, states: m.states, start: m.start, t: m.transitions.map((t) => `${t.from}>${t.to}`) })))})`);
  const model = generateStatechartModel(dut, pou, {});
  const out = model.edges.filter((e) => e.from === 'KTESTSTATION_TEST').map((e) => `${e.to}:${e.label}`);
  expect(out.some((x) => /KTESTSTATION_IDLE:.*iTestExit = 1/.test(x)) && out.some((x) => /KTESTSTATION_ERROR:.*iTestExit = 2/.test(x)), `its exits: the new state's transitions (${out.join(' | ')})`);
  expect(model.edges.some((e) => e.from === 'KTESTSTATION_IDLE' && e.to === 'KTESTSTATION_TEST'), 'the transition into TESTING: into the new state');
  expect(!model.markdown.includes('as KTESTSTATION_TESTING\n') && model.markdown.includes('KTESTSTATION_TEST__Test__KTESTSTATION_DONE'), 'drawn: the new state with them inside it');
  expect(/KTESTSTATION_TEST\b/.test(dut) && !/KTESTSTATION_TESTING\b/.test(dut) && !/KTESTSTATION_DONE\b/.test(dut), 'the enum: the new state, not theirs');
  const m = getMethodCodeFromPou(pou, 'Test');
  expect(/CASE iTestStep OF/.test(m.code) && /eTestState := KTESTSTATION_DONE;/.test(m.code) && /Test := 1;/.test(m.code) && /KTESTSTATION_TESTING\s*: INT := 0;/.test(m.declaration ?? ''), 'the method: their code, the step, the exits, a constant per state');
  const ds = getMethodCodeFromPou(pou, 'doState');
  expect(/iTestExit := Test\(bStart := bFirstPass\);/.test(ds.code) && /iTestExit\s*: INT;/.test(ds.declaration ?? ''), 'doState(): the call, its exit variable declared');
}

// Refused
expect(!!checkExtractSubMachine(s.pouContent, s.dutContent, ['KTESTSTATION_TESTING'], 'Test', 'KTESTSTATION_TEST', V), 'one state: refused');
expect(/already a method/.test(checkExtractSubMachine(s.pouContent, s.dutContent, states, 'Calibrate', 'KTESTSTATION_X', V) ?? ''), 'a method name in use: refused');
expect(/used in preProcess/.test(checkExtractSubMachine(s.pouContent, s.dutContent, ['KTESTSTATION_ERROR', 'KTESTSTATION_DISABLED'], 'Fault', 'KTESTSTATION_FAULT', V) ?? ''), `a state compared in preProcess(): refused (${checkExtractSubMachine(s.pouContent, s.dutContent, ['KTESTSTATION_ERROR', 'KTESTSTATION_DISABLED'], 'Fault', 'KTESTSTATION_FAULT', V)})`);
expect(/No transition between them/.test(checkExtractSubMachine(s.pouContent, s.dutContent, ['KTESTSTATION_DONE', 'KTESTSTATION_CALIBRATING'], 'Pair', 'KTESTSTATION_PAIR', V) ?? ''), 'no transition between them: refused');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
