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
    ['From', 'To', 'Times taken', 'Last taken', 'Taken', 'Counted since'],
    c.rows.map((r) => [r.from, r.to, r.n, r.last ? new Date(r.last).toISOString() : '', r.n > 0 ? 'yes' : 'no', c.since ? new Date(c.since).toISOString() : ''])
  );
}
