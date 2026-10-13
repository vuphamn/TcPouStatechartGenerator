/**
 * Guard coverage (the Live tab): for each transition's condition, whether it was seen true and seen false while live
 * (its guard values evaluated: the active state's transitions, or all of them); kept per POU type in this browser. A
 * condition seen only one way is a gap: its other branch never ran on the machine.
 */
export type GuardCoverage = Record<string, { t?: number; f?: number }>;
export const guardKey = (from: string, to: string) => `${from}->${to}`;

const KEY = (pou: string) => `kss.guardCoverage|${pou.toLowerCase()}`;
export function loadGuardCoverage(pou: string | undefined): GuardCoverage {
  if (!pou) return {};
  try {
    const v = JSON.parse(localStorage.getItem(KEY(pou)) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
export function saveGuardCoverage(pou: string | undefined, cov: GuardCoverage): void {
  if (!pou) return;
  try {
    localStorage.setItem(KEY(pou), JSON.stringify(cov));
  } catch {
    // (not kept)
  }
}

/** The guards' results now added (when one is seen a way not seen before) → the new coverage, or null: nothing new */
export function addGuardResults(cov: GuardCoverage, edges: { edgeId: string; from: string; to: string; conditional: boolean }[], results: Record<string, { result: string } | undefined>, now = Date.now()): GuardCoverage | null {
  let next: GuardCoverage | null = null;
  for (const e of edges) {
    if (!e.conditional) continue;
    const r = results[e.edgeId]?.result;
    if (r !== 'true' && r !== 'false') continue;
    const k = guardKey(e.from, e.to);
    const was: { t?: number; f?: number } = (next ?? cov)[k] ?? {};
    const side = r === 'true' ? 't' : 'f';
    if (was[side]) continue;
    next = { ...(next ?? cov), [k]: { ...was, [side]: now } };
  }
  return next;
}

/** The conditions (the chart's conditional transitions): how many seen both ways, the ones never true, never false */
export function guardCoverageSummary(cov: GuardCoverage, edges: { from: string; to: string; conditional: boolean; condition?: string }[]): { total: number; both: number; neverTrue: { from: string; to: string; condition?: string }[]; neverFalse: { from: string; to: string; condition?: string }[]; never: number } {
  const seen = new Set<string>();
  const list = edges.filter((e) => e.conditional && !seen.has(guardKey(e.from, e.to)) && seen.add(guardKey(e.from, e.to)));
  const neverTrue = list.filter((e) => !cov[guardKey(e.from, e.to)]?.t);
  const neverFalse = list.filter((e) => !cov[guardKey(e.from, e.to)]?.f);
  return { total: list.length, both: list.filter((e) => cov[guardKey(e.from, e.to)]?.t && cov[guardKey(e.from, e.to)]?.f).length, neverTrue, neverFalse, never: list.filter((e) => !cov[guardKey(e.from, e.to)]).length };
}
