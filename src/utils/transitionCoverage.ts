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
}

/** The chart's transitions (from -> to, each once; the initial one left out) against the ones the PLC took */
export function transitionCoverage(transitions: { from: string; to: string }[], seen: SeenMap): Coverage {
  const unique = new Map<string, { from: string; to: string }>();
  for (const t of transitions) {
    if (!t.from || !t.to || t.from === '[*]' || t.to === '[*]' || t.from === t.to) continue;
    unique.set(seenKey(t.from, t.to), { from: t.from, to: t.to });
  }
  const rows = [...unique.entries()]
    .map(([k, t]) => ({ ...t, n: seen[k]?.n ?? 0, last: seen[k]?.last ?? null }))
    // (never taken first, then the least taken)
    .sort((a, b) => a.n - b.n || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { rows, taken: rows.filter((r) => r.n > 0).length, total: rows.length };
}

/** The coverage as CSV: from, to, times taken, last taken (ISO), taken (yes / no) */
export function coverageCsv(c: Coverage): string {
  return toCsv(
    ['From', 'To', 'Times taken', 'Last taken', 'Taken'],
    c.rows.map((r) => [r.from, r.to, r.n, r.last ? new Date(r.last).toISOString() : '', r.n > 0 ? 'yes' : 'no'])
  );
}
