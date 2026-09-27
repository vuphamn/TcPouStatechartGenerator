/**
 * Measured state times: how long the PLC stayed in each state, from the live session's transitions (live, or a
 * replayed recording, e.g. a day from the gateway): count, average, median, 90th percentile, longest, total. The
 * diagram can show them: each state's border and a badge coloured from quick (green) to slow (red) by its average.
 */

import { formatDuration } from './liveView.ts';

export interface StateTime {
  state: string;
  /** Stays measured (a stay ends with a transition out) */
  n: number;
  avgMs: number;
  medianMs: number;
  p90Ms: number;
  minMs: number;
  maxMs: number;
  totalMs: number;
}

const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/** Per state, most time in total first */
export function stateTimes(transitions: { from: string; dwellMs: number }[]): StateTime[] {
  const by = new Map<string, number[]>();
  for (const t of transitions) {
    if (!Number.isFinite(t.dwellMs) || t.dwellMs < 0) continue;
    if (!by.has(t.from)) by.set(t.from, []);
    by.get(t.from)!.push(t.dwellMs);
  }
  return [...by.entries()]
    .map(([state, list]) => {
      const sorted = [...list].sort((a, b) => a - b);
      const total = sorted.reduce((s, x) => s + x, 0);
      return { state, n: sorted.length, avgMs: total / sorted.length, medianMs: quantile(sorted, 0.5), p90Ms: quantile(sorted, 0.9), minMs: sorted[0], maxMs: sorted[sorted.length - 1], totalMs: total };
    })
    .sort((a, b) => b.totalMs - a.totalMs || a.state.localeCompare(b.state));
}

/** Levels 0 (quickest) to 4 (slowest) by average, spread over the states measured (their rank), with a badge label */
export function stateTimeLevels(times: StateTime[]): Record<string, { level: number; label: string; title: string }> {
  const ranked = [...times].sort((a, b) => a.avgMs - b.avgMs);
  const out: Record<string, { level: number; label: string; title: string }> = {};
  ranked.forEach((t, i) => {
    const level = ranked.length === 1 ? 0 : Math.min(4, Math.floor((i / (ranked.length - 1)) * 4.999));
    out[t.state] = {
      level,
      label: `⌀ ${formatDuration(t.avgMs)} · ${t.n}×`,
      title: `${t.state}: ${t.n} stay${t.n === 1 ? '' : 's'}, average ${formatDuration(t.avgMs)}, median ${formatDuration(t.medianMs)}, 90% within ${formatDuration(t.p90Ms)}, longest ${formatDuration(t.maxMs)}`,
    };
  });
  return out;
}
