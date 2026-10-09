/**
 * Transition coverage (Live): which of the chart's transitions the PLC has taken (seenTransitions: per POU type, kept
 * across sessions), how often and when last; the ones never taken. For commissioning sign-off: exported as CSV.
 */
import { seenKey, type SeenMap } from './seenTransitions.ts';
import { toCsv } from './csv.ts';

export interface CoverageRow {
  from: string;
  to: string;
  /** Times taken (0: never) */
  n: number;
  /** When last (ms; null: never) */
  last: number | null;
}

export interface Coverage {
  rows: CoverageRow[];
  taken: number;
  total: number;
  /** Counted since a reset (ms; absent: all the time this app has seen) */
  since?: number;
  /** Counted until the next reset (ms; absent: up to now) */
  until?: number;
}

/** A reset of the coverage: when, and each transition's count then (counted from there; the seen ones kept) */
export interface CoverageStart {
  at: number;
  counts: Record<string, number>;
}

const startKey = (pouType: string) => `kss.coverageStart.${pouType}`;

export function loadCoverageStart(pouType: string | undefined): CoverageStart | null {
  if (!pouType) return null;
  try {
    const s = JSON.parse(localStorage.getItem(startKey(pouType)) || 'null') as CoverageStart | null;
    return s && typeof s.at === 'number' && s.counts && typeof s.counts === 'object' ? s : null;
  } catch {
    return null;
  }
}

/** The reset kept (null: counted from the start again) */
export function saveCoverageStart(pouType: string | undefined, start: CoverageStart | null): void {
  if (!pouType) return;
  try {
    if (start) localStorage.setItem(startKey(pouType), JSON.stringify(start));
    else localStorage.removeItem(startKey(pouType));
  } catch {
    // per-viewer convenience only
  }
}

const resetsKey = (pouType: string) => `kss.coverageResets.${pouType}`;
const MAX_RESETS = 50;

/** Every reset of a POU type's coverage, oldest first (the commissioning sessions' starts) */
export function loadCoverageResets(pouType: string | undefined): CoverageStart[] {
  if (!pouType) return [];
  let list: CoverageStart[] = [];
  try {
    const l = JSON.parse(localStorage.getItem(resetsKey(pouType)) || '[]') as CoverageStart[];
    if (Array.isArray(l)) list = l.filter((s) => s && typeof s.at === 'number' && s.counts && typeof s.counts === 'object');
  } catch {
    // (none kept)
  }
  // (a reset from before the list was kept: the current start)
  const current = loadCoverageStart(pouType);
  if (current && !list.some((s) => s.at === current.at)) list.push(current);
  return list.sort((a, b) => a.at - b.at);
}

/** A reset added to the list (the newest MAX_RESETS kept) */
export function addCoverageReset(pouType: string | undefined, start: CoverageStart): CoverageStart[] {
  if (!pouType) return [];
  const list = [...loadCoverageResets(pouType).filter((s) => s.at !== start.at), start].sort((a, b) => a.at - b.at).slice(-MAX_RESETS);
  try {
    localStorage.setItem(resetsKey(pouType), JSON.stringify(list));
  } catch {
    // per-viewer convenience only
  }
  return list;
}

export interface CoverageSession {
  /** Its start (ms; null: before the first reset) and end (ms; null: now) */
  from: number | null;
  to: number | null;
  coverage: Coverage;
}

/**
 * The commissioning sessions: before the first reset, from each reset to the next, from the last one to now (newest
 * first); each one's coverage: the counts at its end above those at its start
 */
export function coverageSessions(transitions: { from: string; to: string }[], seen: SeenMap, resets: CoverageStart[]): CoverageSession[] {
  if (!resets.length) return [];
  const sessions: CoverageSession[] = [];
  const bounds: (CoverageStart | null)[] = [null, ...resets];
  for (let k = 0; k < bounds.length; k++) {
    const start = bounds[k];
    const end = resets[k] ?? null;
    // (a past session's end: the counts then, no time of each; the current one: as seen now)
    const endSeen: SeenMap = end ? Object.fromEntries(Object.entries(end.counts).map(([key, n]) => [key, { n, last: 0 }])) : seen;
    const c = transitionCoverage(transitions, endSeen, start);
    const coverage: Coverage = {
      ...c,
      rows: end ? c.rows.map((r) => ({ ...r, last: null })) : c.rows,
      ...(start ? { since: start.at } : {}),
      ...(end ? { until: end.at } : {}),
    };
    if (!start) delete coverage.since;
    sessions.push({ from: start?.at ?? null, to: end?.at ?? null, coverage });
  }
  return sessions.reverse();
}

/** A reset now: each seen transition's count kept as its starting point */
export function coverageStartNow(seen: SeenMap, at = Date.now()): CoverageStart {
  return { at, counts: Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.n])) };
}

/**
 * The chart's transitions (from -> to, each once; the initial one left out) against the ones the PLC took (since a
 * reset: the counts above its starting point)
 */
export function transitionCoverage(transitions: { from: string; to: string }[], seen: SeenMap, start?: CoverageStart | null): Coverage {
  const unique = new Map<string, { from: string; to: string }>();
  for (const t of transitions) {
    if (!t.from || !t.to || t.from === '[*]' || t.to === '[*]' || t.from === t.to) continue;
    unique.set(seenKey(t.from, t.to), { from: t.from, to: t.to });
  }
  const rows = [...unique.entries()]
    .map(([k, t]) => {
      const n = Math.max(0, (seen[k]?.n ?? 0) - (start?.counts[k] ?? 0));
      return { ...t, n, last: n > 0 ? (seen[k]?.last ?? null) : null };
    })
    // (never taken first, then the least taken)
    .sort((a, b) => a.n - b.n || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { rows, taken: rows.filter((r) => r.n > 0).length, total: rows.length, ...(start ? { since: start.at } : {}) };
}

/** The coverage as CSV: from, to, times taken, last taken (ISO), taken (yes / no) */
export function coverageCsv(c: Coverage): string {
  return toCsv(
    ['From', 'To', 'Times taken', 'Last taken', 'Taken', 'Counted since', 'Counted until'],
    c.rows.map((r) => [r.from, r.to, r.n, r.last ? new Date(r.last).toISOString() : '', r.n > 0 ? 'yes' : 'no', c.since ? new Date(c.since).toISOString() : '', c.until ? new Date(c.until).toISOString() : ''])
  );
}
