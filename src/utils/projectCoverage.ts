/**
 * Coverage of every state machine of the PLC project (commissioning sign-off): each POU's transitions (its model's,
 * each drawn edge's members: a composite's edge stands for its states' own) against the ones its PLC took (the
 * transitions seen in this app, per POU type, since its coverage reset if any); one table, its CSVs.
 */
import { generateStatechartModel } from '../generator.ts';
import { rankDutCandidates } from './dutMatcher.ts';
import { isStateMachinePou, type ProjectFiles } from './projectDocumentation.ts';
import { loadSeen, mergeSeenCounts } from './seenTransitions.ts';
import { loadCoverageStart, transitionCoverage, type Coverage } from './transitionCoverage.ts';
import { toCsv } from './csv.ts';
import { firstDifference, type ComparisonSide } from './liveComparison.ts';

export interface PouCoverage {
  /** Its type name (the POU's Name) and file */
  name: string;
  path?: string;
  coverage: Coverage;
  /** Its chart could not be made (then no transitions) */
  error?: string;
}

export interface ProjectCoverage {
  project: string;
  pous: PouCoverage[];
  taken: number;
  total: number;
}

/** Every state machine's coverage (yielding between POUs: a large project stays responsive); null when canceled */
export async function projectCoverage(
  files: ProjectFiles,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean,
  /** The project's coverage file (what anyone saw), per POU type: merged with this browser's */
  shared?: Record<string, Record<string, { n: number; last: number }>> | null
): Promise<ProjectCoverage | null> {
  const pous = files.pous.filter((p) => isStateMachinePou(p.content)).sort((a, b) => a.name.localeCompare(b.name));
  const out: PouCoverage[] = [];
  for (let i = 0; i < pous.length; i++) {
    if (isCancelled?.()) return null;
    onProgress?.(i, pous.length);
    await new Promise((r) => setTimeout(r, 0));
    const p = pous[i];
    const name = /<POU\b[^>]*\bName="([^"]+)"/.exec(p.content)?.[1] ?? p.name.replace(/\.TcPOU$/i, '');
    const best = rankDutCandidates(p.content, files.duts)[0];
    const dut = best && best.matched > 0 ? best.content : '';
    let edges: { from: string; to: string }[] = [];
    let error: string | undefined;
    try {
      // (as the Live tab counts them: each edge's members, a composite's or a collapsed one's own transitions)
      edges = generateStatechartModel(dut, p.content, {}).edges.flatMap((e) => (e.members.length ? e.members : [{ from: e.from, to: e.to }]));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    out.push({ name, path: p.path, coverage: transitionCoverage(edges, mergeSeenCounts(loadSeen(name), shared?.[name]), loadCoverageStart(name)), ...(error ? { error } : {}) });
  }
  onProgress?.(pous.length, pous.length);
  return { project: files.project, pous: out, taken: out.reduce((n, p) => n + p.coverage.taken, 0), total: out.reduce((n, p) => n + p.coverage.total, 0) };
}

const pct = (c: { taken: number; total: number }) => (c.total ? Math.round((c.taken / c.total) * 100) : 0);

/** One row per state machine: POU, taken, total, %, counted since */
export function projectCoverageCsv(p: ProjectCoverage): string {
  return toCsv(
    ['POU', 'Transitions taken', 'Transitions', 'Coverage %', 'Counted since', 'File'],
    [
      ...p.pous.map((x) => [x.name, x.coverage.taken, x.coverage.total, pct(x.coverage), x.coverage.since ? new Date(x.coverage.since).toISOString() : '', x.path ?? '']),
      ['All', p.taken, p.total, pct(p), '', ''],
    ]
  );
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The paths shown from where two sessions part, each */
const PATH_SHOWN = 6;

/**
 * Two PLCs compared (live on both: commissioning a line of machines alike), for the report: where they part (the
 * first difference, each one's path from there), and the transitions only one of them took
 */
function comparisonSection(a: ComparisonSide, b: ComparisonSide): string {
  const d = firstDifference(a.transitions, b.transitions);
  const count = (s: ComparisonSide) => {
    const m = new Map<string, number>();
    for (const t of s.transitions) m.set(`${t.from} → ${t.to}`, (m.get(`${t.from} → ${t.to}`) ?? 0) + 1);
    return m;
  };
  const ca = count(a);
  const cb = count(b);
  const only = (x: Map<string, number>, y: Map<string, number>) => [...x.entries()].filter(([k]) => !y.has(k));
  const onlyA = only(ca, cb);
  const onlyB = only(cb, ca);
  const path = (s: ComparisonSide, start: number) =>
    s.transitions
      .slice(start, start + PATH_SHOWN)
      .map((t) => `<div>${esc(t.from)} → ${esc(t.to)} <span class="muted">${(t.dwellMs / 1000).toFixed(1)} s</span></div>`)
      .join('') || '<div class="muted">ends there</div>';
  const part = !d
    ? `<p>The same transitions in the same order (${a.transitions.length}).</p>`
    : !d.state
      ? '<p>They share no state to start from.</p>'
      : `<p>First difference${d.same ? `, after ${d.same} transition${d.same === 1 ? '' : 's'} the same` : ''}: in <span class="mono">${esc(d.state)}</span>.</p>
<table><thead><tr><th>${esc(a.label)} from there</th><th>${esc(b.label)} from there</th></tr></thead><tbody><tr><td class="mono">${path(a, d.startA + d.same)}</td><td class="mono">${path(b, d.startB + d.same)}</td></tr></tbody></table>`;
  const list = (l: [string, number][]) => (l.length ? l.map(([k, n]) => `<div>${esc(k)} (${n}×)</div>`).join('') : '<div class="muted">none</div>');
  return `<section><h2>Compared live: ${esc(a.label)} and ${esc(b.label)}</h2>
<div class="muted">${a.transitions.length} and ${b.transitions.length} transitions, the same state machine on two PLCs.</div>
${part}
<table><thead><tr><th>Only ${esc(a.label)} took</th><th>Only ${esc(b.label)} took</th></tr></thead><tbody><tr><td class="mono">${list(onlyA)}</td><td class="mono">${list(onlyB)}</td></tr></tbody></table></section>`;
}

/**
 * The commissioning sign-off report (HTML, printable): the project, when, the coverage of each state machine and the
 * whole, each one's transitions never taken (what was not seen working), and lines to sign
 */
export function coverageReportHtml(p: ProjectCoverage, now = new Date(), comparisons: { a: ComparisonSide; b: ComparisonSide }[] = []): string {
  const rows = [...p.pous].sort((a, b) => pct(a.coverage) - pct(b.coverage) || a.name.localeCompare(b.name));
  const when = now.toLocaleString();
  const never = rows.filter((x) => x.coverage.taken < x.coverage.total);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(p.project)}: transition coverage</title>
<style>
  body { font: 13px/1.45 system-ui, sans-serif; color: #111; margin: 24px 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 15px; margin: 22px 0 6px; } .muted { color: #666; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0; } th, td { border-bottom: 1px solid #ddd; padding: 3px 6px; text-align: left; }
  th { font-weight: 600; background: #f4f4f4; } td.n { text-align: right; font-variant-numeric: tabular-nums; } .mono { font-family: Consolas, monospace; }
  .bar { display: inline-block; width: 120px; height: 8px; background: #e5e5e5; vertical-align: middle; } .bar > span { display: block; height: 100%; background: #2563eb; }
  .full > span { background: #16a34a; } .low > span { background: #d97706; }
  .never { columns: 2; font-family: Consolas, monospace; font-size: 12px; } .sign { margin-top: 36px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; }
  .sign div { border-top: 1px solid #333; padding-top: 4px; } section { break-inside: avoid; } @media print { body { margin: 12mm; } }
</style></head><body>
<h1>${esc(p.project)}: transition coverage</h1>
<div class="muted">Commissioning sign-off · ${esc(when)} · Kval MachineScope</div>
<p><b>${p.taken} of ${p.total}</b> transitions taken (${pct(p)}%) across ${p.pous.length} state machine${p.pous.length === 1 ? '' : 's'}: each transition of each chart against the ones its PLC took while followed live (or replayed), since that state machine's coverage reset if any.</p>
<table><thead><tr><th>State machine</th><th class="n">Taken</th><th class="n">Transitions</th><th>Coverage</th><th>Counted since</th></tr></thead><tbody>
${rows
  .map((x) => {
    const v = pct(x.coverage);
    return `<tr><td class="mono">${esc(x.name)}</td><td class="n">${x.coverage.taken}</td><td class="n">${x.coverage.total}</td><td><span class="bar ${v === 100 ? 'full' : v < 50 ? 'low' : ''}"><span style="width:${v}%"></span></span> ${v}%</td><td>${x.coverage.since ? esc(new Date(x.coverage.since).toLocaleDateString()) : ''}</td></tr>`;
  })
  .join('\n')}
<tr><th>All</th><th class="n">${p.taken}</th><th class="n">${p.total}</th><th>${pct(p)}%</th><th></th></tr>
</tbody></table>
${
  never.length
    ? `<h2>Never taken</h2><div class="muted">Not seen working: test these before signing, or note why they cannot be.</div>\n${never
        .map((x) => `<section><h2 class="mono">${esc(x.name)} <span class="muted">${x.coverage.total - x.coverage.taken} of ${x.coverage.total}</span></h2><div class="never">${x.coverage.rows
          .filter((r) => r.n === 0)
          .map((r) => `<div>${esc(r.from)} → ${esc(r.to)}</div>`)
          .join('')}</div></section>`)
        .join('\n')}`
    : '<h2>Never taken</h2><p>None: every transition of every state machine was taken.</p>'
}
${comparisons.map((c) => comparisonSection(c.a, c.b)).join('\n')}
<div class="sign"><div>Commissioned by</div><div>Signature</div><div>Date</div></div>
</body></html>
`;
}

/** Every transition of every state machine: POU, from, to, times taken, last taken, taken */
export function projectTransitionsCsv(p: ProjectCoverage): string {
  return toCsv(
    ['POU', 'From', 'To', 'Times taken', 'Last taken', 'Taken'],
    p.pous.flatMap((x) => x.coverage.rows.map((r) => [x.name, r.from, r.to, r.n, r.last ? new Date(r.last).toISOString() : '', r.n > 0 ? 'yes' : 'no']))
  );
}
