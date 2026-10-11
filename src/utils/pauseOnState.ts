/**
 * Pause on state (a breakpoint on the chart's states, as a debugger's): when the PLC enters one of the chosen states,
 * a replay stops right there and the live view holds that moment (the PLC runs on: its samples are kept and shown on
 * Resume). The states chosen are kept per POU in this browser.
 */
import { liveStateName } from './liveView.ts';

const KEY = (pou: string) => `kss.pauseOn|${pou.toLowerCase()}`;

export function loadPauseOn(pou: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(pou)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
export function savePauseOn(pou: string, states: string[]): void {
  try {
    if (states.length) localStorage.setItem(KEY(pou), JSON.stringify(states));
    else localStorage.removeItem(KEY(pou));
  } catch {
    // (not kept)
  }
}

/**
 * The first sample that enters a chosen state: its value differs from the one before it (the first sample: from
 * `before`, the value shown so far) and names a chosen state (case not counted) → its index, or -1
 */
export function firstEntryInto(samples: { t: number; value: number }[], names: Map<number, string>, states: Set<string>, before?: number | null): number {
  if (!states.size) return -1;
  let prev = before ?? null;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i].value;
    if (v !== prev && states.has(liveStateName(v, names).toLowerCase())) return i;
    prev = v;
  }
  return -1;
}

/**
 * A replay's step from `pos` to `next` (ms of the recording): the first entry into a chosen state after `pos` up to
 * `next` → { t, state }, or null (the samples sorted by time; the value at `pos`: the last one at or before it)
 */
export function replayStopIn(values: { t: number; value: number }[], pos: number, next: number, names: Map<number, string>, states: Set<string>): { t: number; state: string } | null {
  if (!states.size || next <= pos) return null;
  // (the first sample after pos: binary search)
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid].t <= pos) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end < values.length && values[end].t <= next) end++;
  const i = firstEntryInto(values.slice(lo, end), names, states, lo > 0 ? values[lo - 1].value : null);
  if (i < 0) return null;
  const s = values[lo + i];
  return { t: s.t, state: liveStateName(s.value, names) };
}
