// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Another company's POU whose state is also set outside its CASE, in a method of its own (FB_StepTracker's Reset():
// Phase := Waiting; Seed(): Phase := OnBest; FB_ScanSequencer's Start(): State := E_ScanState.InitializeScan): each
// a transition from "any state", labeled with its method ([Reset()]), Go to code at its assignment there. Not a
// helper the CASE calls (MoveAndAdvance(): its State := NextState is the calling state's), not a Kval POU's methods
import { generateStatechartModel } from '../../src/generator.ts';
import { inlineStateEnum } from '../../src/utils/stateMethod.ts';
import { locateTransition } from '../../src/utils/sourceLocation.ts';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const inlineFx = require('../fixtures/third-party-inline-enum.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const scanFx = require('../fixtures/third-party-pou.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const entries = (m: ReturnType<typeof generateStatechartModel>) => m.edges.filter((e) => e.source === 'entryMethod').map((e) => `${e.from}->${e.to} ${e.label}`).sort();

// FB_StepTracker: Reset() and Seed()
const tracker = generateStatechartModel(inlineStateEnum(inlineFx.pou)?.dut ?? '', inlineFx.pou, {});
const t = entries(tracker);
expect(JSON.stringify(t) === JSON.stringify(['AnyState->OnBest [Seed()]', 'AnyState->Waiting [Reset()]']), `FB_StepTracker: Reset() and Seed() from any state (${JSON.stringify(t)})`);
expect(/AnyState\b/.test(tracker.markdown) && /\[Reset\(\)\]/.test(tracker.markdown), 'drawn: the "any state" node and the label');
// (the CASE's own transitions unchanged)
const pairs = tracker.edges.filter((e) => e.source !== 'entryMethod').flatMap((e) => e.members).map((m) => `${m.from}->${m.to}`);
expect(['Waiting->OffEdge', 'OffEdge->OnBest', 'OnLesser->OffEdge'].every((p) => pairs.includes(p)) && !pairs.some((p) => p.startsWith('AnyState')), `the CASE's transitions as before (${pairs.join(', ')})`);
// Go to code: the assignment in Reset()
const loc = locateTransition(inlineFx.pou, { from: 'AnyState', to: 'Waiting', label: '[Reset()]' });
expect(loc?.method === 'Reset', `Go to code: in Reset() (${JSON.stringify(loc)})`);

// FB_ScanSequencer: Start() (qualified), not MoveAndAdvance() / AdvanceWhenDone() (helpers Execute() calls)
const scan = generateStatechartModel(scanFx.dut, scanFx.pou, {});
const s = entries(scan);
expect(JSON.stringify(s) === JSON.stringify(['AnyState->InitializeScan [Start()]']), `FB_ScanSequencer: Start() only (${JSON.stringify(s)})`);
const sLoc = locateTransition(scanFx.pou, { from: 'AnyState', to: 'InitializeScan', label: '[Start()]' });
expect(sLoc?.method === 'Start', `Go to code: in Start() (${JSON.stringify(sLoc)})`);

// A Kval POU (doState()): no such transitions
const kval = (() => {
  try {
    return generateStatechartModel('', inlineFx.kvalDerived, {});
  } catch {
    return null;
  }
})();
expect(!kval || entries(kval).length === 0, 'a Kval POU: none');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
