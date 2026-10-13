// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Guard coverage (guardCoverage.ts: each condition seen true / false live, the gaps); the test report (testReport.ts:
// HTML and PDF); a recording's notes (liveRecording.ts: kept in the file, read back)
import { addGuardResults, guardCoverageSummary, type GuardCoverage } from '../../src/utils/guardCoverage.ts';
import { testReportHtml, testReportPdf } from '../../src/utils/testReport.ts';
import { LiveRecorder, parseRecording } from '../../src/utils/liveRecording.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// ---- Guard coverage ----
const edges = [
  { edgeId: 'e1', from: 'A', to: 'B', conditional: true },
  { edgeId: 'e2', from: 'B', to: 'C', conditional: true },
  { edgeId: 'e3', from: 'C', to: 'A', conditional: false },
];
let cov: GuardCoverage = {};
const step = (r: Record<string, string>) => {
  const next = addGuardResults(cov, edges, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { result: v }])), 1000);
  if (next) cov = next;
  return next;
};
expect(!!step({ e1: 'false', e2: 'unknown' }) && cov['A->B']?.f === 1000 && !cov['A->B']?.t && !cov['B->C'], 'a condition seen false; unknown ones not counted');
expect(step({ e1: 'false' }) === null, 'seen the same way again: nothing new');
step({ e1: 'true', e2: 'true', e3: 'true' });
const s = guardCoverageSummary(cov, [...edges, { from: 'A', to: 'B', conditional: true }]);
expect(s.total === 2 && s.both === 1 && s.neverTrue.length === 0 && s.neverFalse.map((e) => `${e.from}>${e.to}`).join() === 'B>C', `the summary: ${s.both} of ${s.total} both ways, never false: ${s.neverFalse.map((e) => e.to).join()} (an unconditional one and a repeat not counted)`);

// ---- The test report ----
const input = {
  pou: 'SM_A',
  plc: '5.1.2.3.1.1:851',
  made: new Date(Date.UTC(2026, 9, 13)),
  suites: [{ name: 'FB_A_Test', steps: 3, result: 1 }, { name: 'FB_A_Path1_Test', steps: 4, result: 2, failedStep: 2 }, { name: 'FB_A_Untaken1_Test', steps: 2, error: 'not in the PLC' }],
  coverage: { rows: [{ from: 'A', to: 'B', n: 3 }, { from: 'B', to: '<C>', n: 0 }], taken: 1, total: 2 },
  guards: s,
};
const html = testReportHtml(input);
expect(html.includes('<b>1 / 3</b><br>TcUnit suites passed') && html.includes('<b>1 / 2</b><br>transitions taken (50%)') && html.includes('<b>1 / 2</b><br>conditions seen both ways (50%)'), 'the summary: suites passed, transitions taken, conditions both ways');
expect(html.includes('<td class="failed">failed at step 2</td>') && html.includes('not on the PLC') && html.includes('<li>B → &lt;C&gt;</li>') && html.includes('Approved by'), 'each suite, the gaps (escaped), a place to sign');
const pdf = testReportPdf(input);
expect(pdf.startsWith('%PDF-1.4') && pdf.includes('(Test report: SM_A) Tj') && pdf.includes('FB_A_Path1_Test \\(4 states\\): failed at step 2') && pdf.includes('B -> <C>'), 'as PDF');
expect(testReportHtml({ pou: 'X', suites: [], coverage: null, guards: null }).includes('none added here'), 'nothing yet: said');

// ---- A recording's notes ----
const rec = new LiveRecorder();
rec.reset();
rec.addValues([{ t: 100, value: 0 }, { t: 200, value: 1 }]);
rec.notes.push({ t: 150, text: 'jam cleared here' });
const file = JSON.stringify(rec.toRecording({ stateVar: 'machineState' }));
const back = parseRecording(file);
expect(!('error' in back) && back.notes?.length === 1 && back.notes[0].text === 'jam cleared here' && back.notes[0].t === 150, 'notes kept in the recording file, read back');
const bad = parseRecording(JSON.stringify({ ...JSON.parse(file), notes: [{ t: 'x', text: 1 }, { t: 5, text: 'ok' }] }));
expect(!('error' in bad) && bad.notes?.length === 1 && bad.notes[0].text === 'ok', 'bad notes left out');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
