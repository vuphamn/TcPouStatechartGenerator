/**
 * Coverage of every state machine of the PLC project (commissioning sign-off): each POU's transitions (its model's,
 * each drawn edge's members: a composite's edge stands for its states' own) against the ones its PLC took (the
 * transitions seen in this app, per POU type, since its coverage reset if any); one table, its CSVs.
 */
import { generateStatechartModel } from '../generator.ts';
import { rankDutCandidates } from './dutMatcher.ts';
import { isStateMachinePou, type ProjectFiles } from './projectDocumentation.ts';
import { loadSeen } from './seenTransitions.ts';
import { loadCoverageStart, transitionCoverage, type Coverage } from './transitionCoverage.ts';
import { toCsv } from './csv.ts';

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
export async function projectCoverage(files: ProjectFiles, onProgress?: (done: number, total: number) => void, isCancelled?: () => boolean): Promise<ProjectCoverage | null> {
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
    out.push({ name, path: p.path, coverage: transitionCoverage(edges, loadSeen(name), loadCoverageStart(name)), ...(error ? { error } : {}) });
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

/** Every transition of every state machine: POU, from, to, times taken, last taken, taken */
export function projectTransitionsCsv(p: ProjectCoverage): string {
  return toCsv(
    ['POU', 'From', 'To', 'Times taken', 'Last taken', 'Taken'],
    p.pous.flatMap((x) => x.coverage.rows.map((r) => [x.name, r.from, r.to, r.n, r.last ? new Date(r.last).toISOString() : '', r.n > 0 ? 'yes' : 'no']))
  );
}
