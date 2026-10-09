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
