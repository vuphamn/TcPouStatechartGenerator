/**
 * Two sessions compared (two PLCs live, or two recordings) kept as one file: each side's label and its transitions as
 * the comparison had them, the POU, when. Opened again in Compare (either side's file picker, or Open comparison):
 * both sides at once.
 */
import type { LiveTransition } from './liveView.ts';

export interface ComparisonSide {
  label: string;
  transitions: LiveTransition[];
}

export interface LiveComparison {
  kind: 'kss-live-comparison';
  version: 1;
  savedAt: string;
  pou?: string;
  a: ComparisonSide;
  b: ComparisonSide;
}

/** The comparison as its file's text */
export function comparisonText(a: ComparisonSide, b: ComparisonSide, pou?: string, now = new Date()): string {
  const file: LiveComparison = { kind: 'kss-live-comparison', version: 1, savedAt: now.toISOString(), ...(pou ? { pou } : {}), a, b };
  return JSON.stringify(file, null, 1);
}

/** A file name for it: <POU> <A> vs <B>.comparison.json */
export function comparisonFileName(a: ComparisonSide, b: ComparisonSide, pou?: string): string {
  const clean = (s: string) => s.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 40);
  return `${pou ? `${clean(pou)}_` : ''}${clean(a.label)}_vs_${clean(b.label)}.comparison.json`;
}

const isSide = (s: unknown): s is ComparisonSide =>
  !!s &&
  typeof (s as ComparisonSide).label === 'string' &&
  Array.isArray((s as ComparisonSide).transitions) &&
  (s as ComparisonSide).transitions.every((t) => t && typeof t.from === 'string' && typeof t.to === 'string' && typeof t.t === 'number' && typeof t.dwellMs === 'number');

export interface FirstDifference {
  /** The transitions both took the same, in the same order, before it */
  same: number;
  /** The state both were in when they parted (null: they share no state to start from) */
  state: string | null;
  /** What each one did next (null: that session ends there) */
  a: LiveTransition | null;
  b: LiveTransition | null;
  /** Where each started being compared (the transitions before, from another state, left out) */
  startA: number;
  startB: number;
}

/**
 * Where two sessions part: aligned from the first state both leave (the earliest such pair), then step by step; the
 * first step where one goes elsewhere (or one ends). null when they took the same transitions in the same order
 */
export function firstDifference(a: LiveTransition[], b: LiveTransition[]): FirstDifference | null {
  if (!a.length && !b.length) return null;
  let start: [number, number] | null = null;
  for (let sum = 0; sum < a.length + b.length - 1 && !start; sum++) {
    for (let i = Math.max(0, sum - b.length + 1); i <= Math.min(sum, a.length - 1); i++) {
      const j = sum - i;
      if (a[i].from === b[j].from) {
        start = [i, j];
        break;
      }
    }
  }
  if (!start) return { same: 0, state: null, a: a[0] ?? null, b: b[0] ?? null, startA: 0, startB: 0 };
  const [i0, j0] = start;
  let k = 0;
  while (i0 + k < a.length && j0 + k < b.length && a[i0 + k].from === b[j0 + k].from && a[i0 + k].to === b[j0 + k].to) k++;
  const x = a[i0 + k] ?? null;
  const y = b[j0 + k] ?? null;
  if (!x && !y) return null;
  return { same: k, state: (x ?? y)!.from, a: x, b: y, startA: i0, startB: j0 };
}

/** A comparison file read: its two sides; null when the text is not one (a recording, say); an error when broken */
export function parseComparison(text: string): LiveComparison | { error: string } | null {
  let f: Partial<LiveComparison>;
  try {
    f = JSON.parse(text) as Partial<LiveComparison>;
  } catch {
    return null;
  }
  if (f?.kind !== 'kss-live-comparison') return null;
  if (f.version !== 1) return { error: `A comparison of another version (${String(f.version)})` };
  if (!isSide(f.a) || !isSide(f.b)) return { error: 'A comparison without its two sides' };
  return f as LiveComparison;
}
