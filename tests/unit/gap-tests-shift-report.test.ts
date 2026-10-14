// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// TcUnit tests of the guard coverage's gaps (pathTest.ts: guardFalseInputs, a hold after the path); the shift report
// (shiftReport.ts); two test reports compared (testReport.ts); reports beside the PLC project (shared/reportsFile.cjs);
// saved sequences in the commissioning file (shared/commissioningFile.cjs)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { guardFalseInputs, generateTcUnitPathTest } from '../../src/utils/pathTest.ts';
import { shiftWindow, stateTimesIn, shiftReportHtml, shiftReportName } from '../../src/utils/shiftReport.ts';
import { compareTestReports, keptTestReportJson, parseKeptTestReport, keptTestReportName } from '../../src/utils/testReport.ts';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { saveReportFile, listReportFiles, readReportFile } = require('../../shared/reportsFile.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCommissioning, saveCommissioning } = require('../../shared/commissioningFile.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const sets = (g: string) => guardFalseInputs(g).set.map((s) => `${s.name}=${String(s.value)}`).join(' ');

// ---- A guard made false ----
expect(sets('bStart') === 'bStart=false' && sets('NOT bStop') === 'bStop=true', `a variable, NOT one: ${sets('bStart')}; ${sets('NOT bStop')}`);
expect(sets('bA AND bB') === 'bA=false' && sets('bA OR bB') === 'bA=false bB=false', `AND: its first side; OR: both (${sets('bA OR bB')})`);
expect(sets('nCount >= 10') === 'nCount=9' && sets('nCount > 10') === 'nCount=10' && sets('nCount = 5') === 'nCount=6' && sets('10 <= nCount') === 'nCount=9', `comparisons: ${sets('nCount >= 10')}, ${sets('nCount > 10')}, ${sets('nCount = 5')}, ${sets('10 <= nCount')}`);
const enumEq = guardFalseInputs('eMode = E_Mode.Auto');
expect(enumEq.set.length === 0 && /another value than E_Mode\.Auto/.test(enumEq.notes.join()), `an enum compared equal: said (${enumEq.notes.join()})`);
expect(guardFalseInputs('fbTimer.Q').notes.some((n) => /set by its block/.test(n)) && /cannot be false/.test(guardFalseInputs('').notes.join()), 'a block output, no condition: said');

// ---- A never-false test: the path to its state, then the hold ----
const t = generateTcUnitPathTest({ pou: 'SM_A', enumType: 'E_A', stateVar: 'machineState', path: [{ from: 'IDLE', to: 'READY', guard: 'bInit', edgeId: 'e1' }], hold: { to: 'RUN', guard: 'bStart AND bSafe' }, suiteName: 'FB_A_NeverFalse1_Test' });
expect(t.methodCode.includes('\t2: // bStart AND bSafe made false: in READY, not to RUN for 100 cycles') && t.methodCode.includes('\t\tfbUut.bStart := FALSE;') && t.methodCode.includes('\t1: // IDLE -> READY'), 'the hold step: its inputs made false, after the path');
expect(t.methodCode.includes('IF nStep = 2 THEN') && t.methodCode.includes('IF TO_DINT(fbUut.machineState) = TO_DINT(E_A.RUN) THEN') && t.methodCode.includes("Message := 'Step 2: went to RUN with its condition false'") && t.methodCode.includes('ELSIF nCycles >= 100 THEN') && t.methodCode.includes('IF nStep > 2 THEN'), 'fails when it goes to RUN, passes after 100 cycles');
expect(!t.methodCode.includes("The recorded run: its last state") && t.methodCode.includes('IF nStep > 1 THEN\n\tnStep := 2;'), 'the path done: on to the hold, not finished');
const one = generateTcUnitPathTest({ pou: 'SM_A', enumType: 'E_A', stateVar: 'machineState', path: [], start: 'IDLE', hold: { to: 'RUN', guard: 'bGo' } });
expect(one.declaration.includes('aExpected : ARRAY[0..1] OF E_A := [E_A.IDLE];') && one.methodCode.includes('\t1: // bGo made false: in IDLE, not to RUN') && one.methodCode.includes('IF nStep = 1 THEN'), 'the state is the start: held at once');
const plain = generateTcUnitPathTest({ pou: 'SM_A', enumType: 'E_A', stateVar: 'machineState', path: [{ from: 'IDLE', to: 'READY', guard: 'bInit', edgeId: 'e1' }] });
expect(plain.methodCode.includes("The recorded run: its last state") && !plain.methodCode.includes('nStep = 2'), 'without a hold: as before');

// ---- The shift report ----
const at = (h: number, m = 0, day = 14) => new Date(2026, 9, day, h, m).getTime();
const w1 = shiftWindow(at(9));
const w3 = shiftWindow(at(3));
const w4 = shiftWindow(at(23));
expect(w1.shift === '06–14' && w1.from === at(6) && w1.to === at(14) && shiftWindow(at(14)).shift === '14–22', 'the shifts: 06–14, 14–22');
expect(w3.shift === '22–06' && w3.from === at(22, 0, 13) && w3.to === at(6) && w4.from === at(22) && w4.to === at(6, 0, 15), 'the night shift: from 22:00 the day before, past midnight');
const values = [{ t: at(5), value: 1 }, { t: at(7), value: 2 }, { t: at(8), value: 1 }, { t: at(15), value: 3 }];
const times = stateTimesIn(values, at(6), at(14), (v) => ['', 'IDLE', 'RUN', 'DONE'][v]);
const ms = (s: string) => times.find((x) => x.state === s)?.ms;
expect(ms('IDLE') === 7 * 3600_000 && ms('RUN') === 3600_000 && !ms('DONE') && times[0].state === 'IDLE', `time in each state, within the shift: ${times.map((x) => `${x.state} ${x.ms / 3600_000} h`).join(', ')}`);
const upTo = stateTimesIn(values, at(6), at(14), (v) => String(v), at(9));
expect(upTo.reduce((a, x) => a + x.ms, 0) === 3 * 3600_000, 'so far (now): up to now only');
const html = shiftReportHtml({ pou: 'SM_A', plc: '5.1.2.3.1.1:851', shift: '06–14', from: at(6), to: at(14), states: times, events: [{ t: at(9), kind: 'note', text: 'jam <cleared>', state: 'IDLE' }, { t: at(10), kind: 'alert', text: 'nFeed > 10 became true' }], values: [{ name: 'nFeed', min: 1, max: 12, avg: 5.5, n: 40 }], coverage: { newly: [{ from: 'IDLE', to: 'RUN' }], taken: 4, total: 9 }, guards: { both: 3, total: 8, newly: 2 } });
expect(html.includes('<b>1</b> alerts') && html.includes('<b>1</b> notes') && html.includes('jam &lt;cleared&gt;') && html.includes('<li>IDLE → RUN</li>') && html.includes('(4 / 9 now)') && html.includes('<b>2</b> conditions first seen both ways') && html.includes('5.50'), 'the report: counts, notes (escaped), values, the transitions first taken');
expect(shiftReportName('SM A', at(6), '06–14') === 'SM_A_shift_2026-10-14_06-14.html' && /^[\w.-]+\.html$/.test(shiftReportName('SM_A', at(22), '22–06')), 'its file name');

// ---- Two test reports compared ----
const older = { pou: 'SM_A', made: new Date(Date.UTC(2026, 9, 1)), suites: [{ name: 'FB_A_Test', steps: 3, result: 2, failedStep: 2 }, { name: 'FB_A_Old_Test', steps: 2, result: 1 }], coverage: { rows: [{ from: 'A', to: 'B', n: 2 }, { from: 'B', to: 'C', n: 0 }], taken: 1, total: 2 }, guards: { total: 2, both: 0, neverTrue: [{ from: 'B', to: 'C' }], neverFalse: [{ from: 'A', to: 'B' }] } };
const newer = { pou: 'SM_A', made: new Date(Date.UTC(2026, 9, 10)), suites: [{ name: 'FB_A_Test', steps: 3, result: 1 }, { name: 'FB_A_New_Test', steps: 4, result: 1 }], coverage: { rows: [{ from: 'A', to: 'B', n: 3 }, { from: 'B', to: 'C', n: 1 }], taken: 2, total: 2 }, guards: { total: 2, both: 1, neverTrue: [], neverFalse: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }] } };
const back = parseKeptTestReport(keptTestReportJson(older));
expect(!!back && back.made?.getTime() === older.made.getTime() && back.suites.length === 2 && back.guards?.neverTrue[0].to === 'C' && parseKeptTestReport('{"kind":"other"}') === null && parseKeptTestReport('not json') === null, 'kept as JSON, read back; others not');
const c = compareTestReports(older, newer);
const L = c.lines.join('\n');
expect(L.includes('TcUnit suites passed: 1 / 2 → 2 / 2') && L.includes('FB_A_Test: failed at step 2 → passed') && L.includes('+ FB_A_New_Test: passed') && L.includes('− FB_A_Old_Test (no longer added)'), `the suites: ${c.lines.slice(0, 4).join(' | ')}`);
expect(L.includes('Transitions taken: 1 / 2 (50%) → 2 / 2 (100%)') && L.includes('taken now: B → C') && L.includes('closed: never true: B → C') && L.includes('new gap: never false: B → C') && c.better === 3 && c.worse === 1, `transitions and gaps: ${c.better} better, ${c.worse} worse`);
expect(c.html.includes('<span class="up">3 better</span>') && /<li class="up">taken now: B → C<\/li>/.test(c.html) && /<li class="down">new gap/.test(c.html), 'as HTML');
expect(/^SM_A_test_report_2026-10-\d\d-\d{6}$/.test(keptTestReportName('SM_A', new Date(2026, 9, 14, 8, 5, 9))), 'its kept name');

// ---- Reports beside the PLC project; saved sequences ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-reports-'));
try {
  fs.writeFileSync(path.join(dir, 'P.plcproj'), '<Project/>');
  fs.mkdirSync(path.join(dir, 'POUs'));
  const pou = path.join(dir, 'POUs', 'SM_A.TcPOU');
  const s1 = saveReportFile(pou, { name: 'SM_A_test_report_x.json', content: '{"a":1}' });
  const s2 = saveReportFile(pou, { name: '../evil.json', content: '{}' });
  const s3 = saveReportFile(pou, { name: 'a.txt', content: 'x' });
  expect(s1.ok && s1.path === path.join(dir, 'MachineScope.reports', 'SM_A_test_report_x.json') && !s2.ok && !s3.ok, 'a report saved in MachineScope.reports; a path or another kind not');
  const l = listReportFiles(pou);
  const r = readReportFile(pou, 'SM_A_test_report_x.json');
  expect(l.files.length === 1 && l.files[0].name === 'SM_A_test_report_x.json' && r.ok && r.content === '{"a":1}' && !readReportFile(pou, 'nope.json').ok && listReportFiles(path.join(os.tmpdir(), 'x', 'y.TcPOU')).error, 'listed, read back; none: said');
  const seq = saveCommissioning(pou, 'SM_A', { sequences: [{ name: 'Clamp test', states: ['IDLE', 'CLAMP', 'bad state!', 'UNCLAMP'] }, { name: 'clamp TEST', states: ['A', 'B'] }, { name: 'One', states: ['A'] }, { name: 'bad:name', states: ['A', 'B'] }] }, 'ann');
  saveCommissioning(pou, 'SM_A', { entry: { state: 'IDLE', ok: true } }, 'ann');
  const readBack = readCommissioning(pou, 'SM_A');
  expect(seq.sequences.length === 1 && seq.sequences[0].states.join() === 'IDLE,CLAMP,UNCLAMP' && readBack.sequences[0].name === 'Clamp test' && readBack.log.length === 1, `saved sequences: ${JSON.stringify(readBack.sequences)}`);
  expect(saveCommissioning(pou, 'SM_A', { sequences: [] }, 'ann').sequences.length === 0 && readCommissioning(pou, 'SM_B').sequences.length === 0, 'removed; none for another type');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
