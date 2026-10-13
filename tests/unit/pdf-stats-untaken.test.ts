// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The commissioning report as PDF (textPdf.ts: its structure: every xref offset at its object, startxref at the xref);
// the events' statistics (EventLog.tsx); test paths to the transitions never taken (statePaths.ts); TcUnit step
// limits as measured (tcunitTest.ts); the project's settings store (shared/projectStore.cjs)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pdfAscii, textPdf } from '../../src/utils/textPdf.ts';
import { commissioningReportPdf } from '../../src/utils/commissioningReport.ts';
import { eventStats, eventStatsCsv, type LiveEvent } from '../../src/components/EventLog.tsx';
import { untakenPaths } from '../../src/utils/statePaths.ts';
import { generateTcUnitTest } from '../../src/utils/tcunitTest.ts';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readStore, saveStore } = require('../../shared/projectStore.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// ---- A PDF of text ----
const checkPdf = (pdf: string) => {
  const xrefAt = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)?.[1]);
  const table = pdf.slice(xrefAt).split('\n');
  const count = Number(/^0 (\d+)$/.exec(table[1])?.[1]);
  const offsets = table.slice(3, 2 + count).map((l) => Number(l.slice(0, 10)));
  const bad = offsets.filter((o, i) => !pdf.startsWith(`${i + 1} 0 obj`, o));
  const streams = [...pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)].filter((m) => pdf.slice(m.index! + m[0].length + Number(m[1]), m.index! + m[0].length + Number(m[1]) + 10) !== '\nendstream');
  return { ok: pdf.startsWith('%PDF-1.4') && table[0] === 'xref' && offsets.length === count - 1 && !bad.length && !streams.length && /^[\x09\x0a\x0d\x20-\x7e]*$/.test(pdf), objects: count - 1, bad: bad.length, streams: streams.length };
};
const lines = ['Title', ...Array.from({ length: 150 }, (_, i) => `line ${i} (a paren) \\ back → arrow ✓ ${'x'.repeat(i % 3 === 0 ? 140 : 10)}`)];
const pdf = textPdf(lines);
const c = checkPdf(pdf);
expect(c.ok, `a valid PDF: ${c.objects} objects, ${c.bad} bad offsets, ${c.streams} bad stream lengths`);
const pageCount = (pdf.match(/\/Type \/Page /g) ?? []).length;
expect(pageCount >= 3 && pdf.includes(`/Count ${pageCount}`) && pdf.includes(`(Page ${pageCount} of ${pageCount}) Tj`) && !pdf.includes(`(Page ${pageCount + 1} of`), `pages: 150 lines (a third wrapped) on ${pageCount} A4 pages, numbered`);
expect(pdf.includes('line 1 \\(a paren\\) \\\\ back -> arrow v') && pdfAscii('Ü→✗') === 'Ue->x', 'parentheses and backslashes escaped; arrows and marks as ASCII');
const report = commissioningReportPdf({ pouType: 'SM_A', allowed: ['IDLE'], where: 'project', made: new Date(Date.UTC(2026, 9, 13)), log: [{ t: '2026-10-13T08:00:00.000Z', user: 'ann', state: 'RUN', from: 'IDLE', plc: '5.1.2.3.1.1:851', ok: true, reason: 'after the valve' }] });
expect(checkPdf(report).ok && report.includes('(Commissioning: SM_A) Tj') && report.includes('ann: IDLE -> RUN on 5.1.2.3.1.1:851  \\"after the valve\\"'.replace('\\"', '"').replace('\\"', '"')), 'the commissioning report as PDF');

// ---- The events' statistics ----
const at = (h: number) => new Date(2026, 9, 13, h, 5).getTime();
const events: LiveEvent[] = [
  { t: at(7), kind: 'alert', text: 'a', state: 'RUN' },
  { t: at(8), kind: 'alert', text: 'b', state: 'RUN' },
  { t: at(15), kind: 'stuck', text: 'c', state: 'IDLE' },
  { t: at(23), kind: 'write', text: 'd' },
];
const s = eventStats(events);
expect(JSON.stringify(s.byKind) === '[["alert",2],["stuck",1],["write",1]]' && JSON.stringify(s.byState) === '[["RUN",2],["IDLE",1],["(not known)",1]]', 'by kind and by the state then');
expect(JSON.stringify(s.byShift) === '[["06–14",2],["14–22",1],["22–06",1]]' && s.byHour[7] === 1 && s.byHour[23] === 1 && s.total === 4, 'by shift and hour');
expect(eventStatsCsv(events).split('\n')[0] === 'section;key;count' && eventStatsCsv(events).includes('\nshift;22–06;1'), 'as CSV');

// ---- Paths to the transitions never taken ----
const E = (from: string, to: string, condition: string) => ({ id: `${from}->${to}`, from, to, condition, label: condition }) as never;
const edges = [E('A', 'B', 'bGo'), E('B', 'C', 'nX >= 3'), E('C', 'A', 'bBack'), E('B', 'D', 'bOther')];
const u = untakenPaths(edges, 'A', [{ from: 'B', to: 'D' }, { from: 'A', to: 'B' }, { from: 'X', to: 'Y' }]);
expect(u.length === 2 && u[0].path.map((p) => `${p.from}>${p.to}`).join(' ') === 'A>B B>D' && u[0].path[1].guard === 'bOther' && u[1].path.length === 1 && u[0].start === 'A', `the shortest way there, then the transition (${u.map((x) => x.path.map((p) => p.to).join('')).join(', ')})`);
const u2 = untakenPaths([...edges, E('Z', 'Q', 'bQ')], ['NOWHERE', 'C'], [{ from: 'B', to: 'D' }, { from: 'Z', to: 'Q' }]);
expect(u2[0].start === 'C' && u2[0].path.map((p) => p.to).join('') === 'ABD' && u2[1].start === 'Z' && u2[1].path.length === 1, `a start that leads there, else the transition alone (${u2.map((x) => x.start).join(', ')})`);

// ---- TcUnit step limits as measured ----
const t = generateTcUnitTest({ pou: 'P', enumType: 'E', stateVar: 's', stateName: (v) => ['A', 'B', 'C'][v], run: { values: [{ t: 0, value: 0 }, { t: 100, value: 1 }, { t: 200, value: 2 }], vars: [], watched: {} }, limitMs: { A: 5000 } });
expect(/aMaxCycles : ARRAY\[1\.\.2\] OF UDINT := \[500, 100\];/.test(t.declaration), `the limits: A as measured (5 s: 500 cycles), B as recorded (at least 100): ${/aMaxCycles[^;]*;/.exec(t.declaration)?.[0]}`);

// ---- The project's settings store ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-store-'));
try {
  fs.writeFileSync(path.join(dir, 'P.plcproj'), '<Project/>');
  const pou = path.join(dir, 'SM_A.TcPOU');
  expect(readStore(pou, 'alerts', 'SM_A').value === null, 'nothing yet');
  saveStore(pou, 'alerts', 'SM_A', { Night: { exprs: ['= x > 1'], alerts: [], forMs: {} } });
  expect(readStore(pou, 'alerts', 'SM_A').value.Night.exprs[0] === '= x > 1' && fs.existsSync(path.join(dir, 'MachineScope.alerts.json')), 'kept beside the project (MachineScope.alerts.json)');
  expect(!!saveStore(pou, 'secrets', 'SM_A', {}).error && !!saveStore(pou, 'alerts', 'a/b', {}).error && !!saveStore(pou, 'alerts', 'SM_A', 'x').error, 'only its kinds, POU types and objects');
  saveStore(pou, 'alerts', 'SM_A', null);
  expect(readStore(pou, 'alerts', 'SM_A').value === null, 'removed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
