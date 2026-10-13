/**
 * The test report (the Live tab, for sign-off): one page of a POU type's testing: the TcUnit suites added here and
 * their results as the PLC ran them, the transitions taken live (coverage) and the conditions seen both ways (guard
 * coverage); as HTML (printable) or PDF.
 */
import { textPdf } from './textPdf.ts';

export interface TestReportInput {
  pou: string;
  plc?: string;
  made?: Date;
  suites: { name: string; steps: number; result?: number; step?: number; failedStep?: number; error?: string }[];
  coverage: { rows: { from: string; to: string; n: number }[]; taken: number; total: number } | null;
  guards: { total: number; both: number; neverTrue: { from: string; to: string }[]; neverFalse: { from: string; to: string }[] } | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const resultText = (s: TestReportInput['suites'][number]) => (s.error ? 'not on the PLC' : s.result === 1 ? 'passed' : s.result === 2 ? `failed at step ${s.failedStep ?? '?'}` : s.result === 0 ? `running (step ${s.step ?? '?'})` : 'not read (not live)');
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export function testReportHtml(o: TestReportInput): string {
  const made = o.made ?? new Date();
  const passed = o.suites.filter((s) => s.result === 1).length;
  const untaken = o.coverage?.rows.filter((r) => r.n === 0) ?? [];
  const list = (rows: { from: string; to: string }[]) => (rows.length ? `<ul>${rows.map((r) => `<li>${esc(r.from)} → ${esc(r.to)}</li>`).join('')}</ul>` : '<p><i>none</i></p>');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Test report: ${esc(o.pou)}</title>
<style>
body{font:14px system-ui,Segoe UI,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 4px}.sub{color:#555;margin-bottom:16px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}th{background:#f1f5f9}
.passed{color:#166534}.failed{color:#b91c1c;font-weight:bold}.sum{display:flex;gap:28px;margin:10px 0}.sum div{border:1px solid #ccc;border-radius:6px;padding:8px 12px}
.sign{margin-top:32px;display:flex;gap:60px}.sign div{border-top:1px solid #333;padding-top:4px;width:220px}@media print{body{margin:0}}
</style></head><body>
<h1>Test report: ${esc(o.pou)}</h1>
<div class="sub">Made by Kval MachineScope ${esc(made.toLocaleString())}${o.plc ? `, on ${esc(o.plc)}` : ''}.</div>
<div class="sum"><div><b>${passed} / ${o.suites.length}</b><br>TcUnit suites passed</div><div><b>${o.coverage ? `${o.coverage.taken} / ${o.coverage.total}` : '—'}</b><br>transitions taken (${o.coverage ? pct(o.coverage.taken, o.coverage.total) : '—'})</div><div><b>${o.guards ? `${o.guards.both} / ${o.guards.total}` : '—'}</b><br>conditions seen both ways (${o.guards ? pct(o.guards.both, o.guards.total) : '—'})</div></div>
<h2>TcUnit suites</h2>
${o.suites.length ? `<table><thead><tr><th>Suite</th><th>States</th><th>Result</th></tr></thead><tbody>${o.suites.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.steps}</td><td class="${s.result === 1 ? 'passed' : s.result === 2 ? 'failed' : ''}">${esc(resultText(s))}</td></tr>`).join('')}</tbody></table>` : '<p><i>none added here</i></p>'}
<h2>Transitions never taken live</h2>
${o.coverage ? list(untaken) : '<p><i>no coverage yet</i></p>'}
<h2>Conditions never seen true</h2>
${o.guards ? list(o.guards.neverTrue) : '<p><i>no guard coverage yet</i></p>'}
<h2>Conditions never seen false</h2>
${o.guards ? list(o.guards.neverFalse) : '<p><i>no guard coverage yet</i></p>'}
<div class="sign"><div>Tested by</div><div>Approved by</div><div>Date</div></div>
</body></html>
`;
}

export function testReportPdf(o: TestReportInput): string {
  const made = o.made ?? new Date();
  const passed = o.suites.filter((s) => s.result === 1).length;
  const untaken = o.coverage?.rows.filter((r) => r.n === 0) ?? [];
  const rows = (list: { from: string; to: string }[]) => (list.length ? list.map((r) => `  ${r.from} -> ${r.to}`) : ['  none']);
  return textPdf([
    `Test report: ${o.pou}`,
    `Made by Kval MachineScope ${made.toLocaleString()}${o.plc ? `, on ${o.plc}` : ''}.`,
    '',
    `TcUnit suites passed: ${passed} / ${o.suites.length}`,
    `Transitions taken live: ${o.coverage ? `${o.coverage.taken} / ${o.coverage.total} (${pct(o.coverage.taken, o.coverage.total)})` : 'no coverage yet'}`,
    `Conditions seen both ways: ${o.guards ? `${o.guards.both} / ${o.guards.total} (${pct(o.guards.both, o.guards.total)})` : 'no guard coverage yet'}`,
    '',
    'TcUnit suites:',
    ...(o.suites.length ? o.suites.map((s) => `  ${s.name} (${s.steps} states): ${resultText(s)}`) : ['  none added here']),
    '',
    'Transitions never taken live:',
    ...(o.coverage ? rows(untaken) : ['  no coverage yet']),
    '',
    'Conditions never seen true:',
    ...(o.guards ? rows(o.guards.neverTrue) : ['  no guard coverage yet']),
    '',
    'Conditions never seen false:',
    ...(o.guards ? rows(o.guards.neverFalse) : ['  no guard coverage yet']),
    '',
    '',
    'Tested by: ______________________   Approved by: ______________________   Date: ____________',
  ]);
}
