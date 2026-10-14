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

/** A test report kept (MachineScope.reports/<POU>_test_report_<when>.json): its data, to compare two later */
export const keptTestReportName = (pou: string, made: Date) => `${pou.replace(/[^\w.-]/g, '_')}_test_report_${made.getFullYear()}-${String(made.getMonth() + 1).padStart(2, '0')}-${String(made.getDate()).padStart(2, '0')}-${String(made.getHours()).padStart(2, '0')}${String(made.getMinutes()).padStart(2, '0')}${String(made.getSeconds()).padStart(2, '0')}`;
export const keptTestReportJson = (o: TestReportInput) => JSON.stringify({ kind: 'kval-machinescope-test-report', version: 1, ...o, made: (o.made ?? new Date()).toISOString() });

/** A kept test report read back, or null (not one) */
export function parseKeptTestReport(text: string): TestReportInput | null {
  try {
    const j = JSON.parse(text);
    if (j?.kind !== 'kval-machinescope-test-report' || typeof j.pou !== 'string' || !Array.isArray(j.suites)) return null;
    const pairs = (x: unknown) => (Array.isArray(x) ? x.filter((r) => r && typeof r.from === 'string' && typeof r.to === 'string').map((r) => ({ from: r.from as string, to: r.to as string })) : []);
    return {
      pou: j.pou,
      plc: typeof j.plc === 'string' ? j.plc : undefined,
      made: typeof j.made === 'string' && !Number.isNaN(Date.parse(j.made)) ? new Date(j.made) : undefined,
      suites: j.suites.filter((s: { name?: unknown }) => s && typeof s.name === 'string'),
      coverage: j.coverage && Array.isArray(j.coverage.rows) ? { rows: j.coverage.rows.filter((r: { from?: unknown; to?: unknown; n?: unknown }) => r && typeof r.from === 'string' && typeof r.to === 'string' && typeof r.n === 'number'), taken: Number(j.coverage.taken) || 0, total: Number(j.coverage.total) || 0 } : null,
      guards: j.guards ? { total: Number(j.guards.total) || 0, both: Number(j.guards.both) || 0, neverTrue: pairs(j.guards.neverTrue), neverFalse: pairs(j.guards.neverFalse) } : null,
    };
  } catch {
    return null;
  }
}

/**
 * Two test reports compared (the older, the newer): the suites passed and each one's result that changed, the
 * transitions taken (first taken since), the conditions seen both ways (the gaps closed, the new ones) → its lines
 * and an HTML page
 */
export function compareTestReports(a: TestReportInput, b: TestReportInput): { lines: string[]; better: number; worse: number; html: string } {
  const lines: string[] = [];
  let better = 0;
  let worse = 0;
  const when = (o: TestReportInput) => (o.made ? o.made.toLocaleString() : '?');
  const passed = (o: TestReportInput) => o.suites.filter((s) => s.result === 1).length;
  const ratio = (x: number, y: number) => `${x} / ${y} (${pct(x, y)})`;
  lines.push(`TcUnit suites passed: ${passed(a)} / ${a.suites.length} → ${passed(b)} / ${b.suites.length}`);
  for (const s of b.suites) {
    const was = a.suites.find((x) => x.name === s.name);
    if (!was) {
      lines.push(`  + ${s.name}: ${resultText(s)}`);
      continue;
    }
    if (resultText(was) === resultText(s)) continue;
    lines.push(`  ${s.name}: ${resultText(was)} → ${resultText(s)}`);
    if (s.result === 1 && was.result !== 1) better++;
    else if (was.result === 1 && s.result !== 1) worse++;
  }
  for (const s of a.suites) if (!b.suites.some((x) => x.name === s.name)) lines.push(`  − ${s.name} (no longer added)`);
  if (a.coverage || b.coverage) {
    lines.push(`Transitions taken: ${a.coverage ? ratio(a.coverage.taken, a.coverage.total) : '—'} → ${b.coverage ? ratio(b.coverage.taken, b.coverage.total) : '—'}`);
    const takenIn = (o: TestReportInput) => new Set((o.coverage?.rows ?? []).filter((r) => r.n > 0).map((r) => `${r.from} → ${r.to}`));
    const ta = takenIn(a);
    const tb = takenIn(b);
    for (const k of tb) if (!ta.has(k)) {
      lines.push(`  taken now: ${k}`);
      better++;
    }
    for (const k of ta) if (!tb.has(k) && (b.coverage?.rows ?? []).some((r) => `${r.from} → ${r.to}` === k)) {
      lines.push(`  not taken now (a reset?): ${k}`);
      worse++;
    }
  }
  if (a.guards || b.guards) {
    lines.push(`Conditions seen both ways: ${a.guards ? ratio(a.guards.both, a.guards.total) : '—'} → ${b.guards ? ratio(b.guards.both, b.guards.total) : '—'}`);
    const gaps = (o: TestReportInput) => new Set([...(o.guards?.neverTrue ?? []).map((r) => `never true: ${r.from} → ${r.to}`), ...(o.guards?.neverFalse ?? []).map((r) => `never false: ${r.from} → ${r.to}`)]);
    const ga = gaps(a);
    const gb = gaps(b);
    for (const k of ga) if (!gb.has(k)) {
      lines.push(`  closed: ${k}`);
      better++;
    }
    for (const k of gb) if (!ga.has(k)) {
      lines.push(`  new gap: ${k}`);
      worse++;
    }
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Test reports compared: ${esc(b.pou)}</title>
<style>body{font:14px system-ui,Segoe UI,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 4px}.sub{color:#555;margin-bottom:14px}
li{margin:2px 0}.up{color:#166534}.down{color:#b91c1c}ul.sub-list{margin:0 0 6px}</style></head><body>
<h1>Test reports compared: ${esc(b.pou)}</h1>
<div class="sub">${esc(when(a))}${a.plc ? ` (${esc(a.plc)})` : ''} → ${esc(when(b))}${b.plc ? ` (${esc(b.plc)})` : ''}: <span class="up">${better} better</span>, <span class="down">${worse} worse</span>. Made by Kval MachineScope ${esc(new Date().toLocaleString())}.</div>
<ul>${lines.map((l) => `<li class="${/^ {2}(taken now|closed|\+)/.test(l) || / → passed$/.test(l) ? 'up' : /^ {2}(not taken now|new gap|−)/.test(l) || /→ failed/.test(l) ? 'down' : ''}">${esc(l.trim())}</li>`).join('')}</ul>
</body></html>
`;
  return { lines, better, worse, html };
}
