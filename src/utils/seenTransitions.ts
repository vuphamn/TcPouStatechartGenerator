/**
 * The transitions the running PLC has taken (live view, replayed recordings), per POU type and kept in this app:
 * an edit that deletes or retargets one of them, or a Save that no longer has it, is pointed out first.
 */

import { generateStatechartModel } from '../generator.ts';

export interface SeenTransition {
  /** How often it was taken */
  n: number;
  /** Last time (PLC ms since 1970) */
  last: number;
  /** The watched values that changed just before it (within a second), and how many times: candidates for its
   * condition (a learned diagram's) */
  before?: Record<string, number>;
  /** Its condition, as chosen from the candidates (a learned diagram draws it instead of an unknown one) */
  condition?: string;
}

export type SeenMap = Record<string, SeenTransition>;

export const seenKey = (from: string, to: string) => `${from}->${to}`;
const storageKey = (pouType: string) => `kss.seen.${pouType}`;

export function loadSeen(pouType: string | undefined): SeenMap {
  if (!pouType) return {};
  try {
    const m = JSON.parse(localStorage.getItem(storageKey(pouType)) || '{}') as SeenMap;
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}

export function saveSeen(pouType: string | undefined, seen: SeenMap): void {
  if (!pouType) return;
  try {
    localStorage.setItem(storageKey(pouType), JSON.stringify(seen));
  } catch {
    // per-viewer convenience only
  }
}

/** seen with these transitions added (before: the watched values that changed just before each) */
export function addSeen(seen: SeenMap, transitions: { from: string; to: string; t: number; before?: string[] }[]): SeenMap {
  if (!transitions.length) return seen;
  const next = { ...seen };
  for (const tr of transitions) {
    const k = seenKey(tr.from, tr.to);
    const was = next[k];
    const before = { ...(was?.before ?? {}) };
    for (const id of tr.before ?? []) before[id] = (before[id] ?? 0) + 1;
    next[k] = { ...(was?.condition ? { condition: was.condition } : {}), n: (was?.n ?? 0) + 1, last: Math.max(was?.last ?? 0, tr.t), ...(Object.keys(before).length ? { before } : {}) };
  }
  return next;
}

/** seen without a transition (seen by mistake: a test, a manual jump) */
export function forgetSeen(seen: SeenMap, from: string, to: string): SeenMap {
  const k = seenKey(from, to);
  if (!(k in seen)) return seen;
  const next = { ...seen };
  delete next[k];
  return next;
}

/** seen with a transition's condition chosen (null: not known again) */
export function setSeenCondition(seen: SeenMap, from: string, to: string, condition: string | null): SeenMap {
  const k = seenKey(from, to);
  const was = seen[k];
  if (!was) return seen;
  const next = { ...was };
  if (condition) next.condition = condition;
  else delete next.condition;
  return { ...seen, [k]: next };
}

/** A transition's candidates for its condition: the values that changed just before it, the most often first */
export function candidatesOf(s: SeenTransition | undefined, max = 3): { id: string; n: number }[] {
  return Object.entries(s?.before ?? {})
    .map(([id, n]) => ({ id, n }))
    .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id))
    .slice(0, max);
}

/** How often the PLC was in (entered or left) a state */
export function stateSeen(seen: SeenMap, state: string): { n: number; last: number } {
  let n = 0;
  let last = 0;
  for (const [k, v] of Object.entries(seen)) {
    const [from, to] = k.split('->');
    if (from !== state && to !== state) continue;
    n += v.n;
    last = Math.max(last, v.last);
  }
  return { n, last };
}

const transitionsOf = (dut: string, pou: string): Set<string> => {
  const out = new Set<string>();
  try {
    for (const e of generateStatechartModel(dut, pou, {}).edges) {
      for (const m of e.members.length ? e.members : [{ from: e.from, to: e.to }]) out.add(seenKey(m.from, m.to));
    }
  } catch {
    // an unreadable version: nothing to compare
  }
  return out;
};

/** The transitions the saved version has, the edited one no longer has, and the PLC took (most taken first) */
export function removedSeenTransitions(savedDut: string, savedPou: string, dut: string, pou: string, seen: SeenMap): { from: string; to: string; n: number; last: number }[] {
  if (!savedPou || !Object.keys(seen).length) return [];
  const now = transitionsOf(dut, pou);
  return [...transitionsOf(savedDut, savedPou)]
    .filter((k) => !now.has(k) && seen[k])
    .map((k) => {
      const [from, to] = k.split('->');
      return { from, to, ...seen[k] };
    })
    .sort((a, b) => b.n - a.n);
}

export const seenText = (s: { n: number; last: number }) =>
  `${s.n} time${s.n === 1 ? '' : 's'}${s.last ? `, last ${new Date(s.last).toLocaleString()}` : ''}`;
