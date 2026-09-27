/**
 * Path checks ("a test from a recording"): the transitions of a live session or a replayed recording, kept per POU
 * type with a name. Each edit is checked against them: a transition of a check the diagram no longer has is a
 * Problem ("recorded path broken"), so an edit that would stop the machine doing what it did is seen at once.
 */

import type { LintFinding } from './stateMachineLint.ts';

export interface PathCheck {
  id: string;
  name: string;
  /** When it was kept, and from what (a live session, a file, a gateway recording) */
  created: number;
  source: string;
  /** The transitions in the order first taken, without repeats */
  transitions: { from: string; to: string }[];
  /** How many transitions the sequence had in all */
  steps: number;
}

const key = (pouType: string) => `kss.pathchecks.${pouType}`;

export function loadPathChecks(pouType: string | undefined): PathCheck[] {
  if (!pouType) return [];
  try {
    const list = JSON.parse(localStorage.getItem(key(pouType)) || '[]') as PathCheck[];
    return Array.isArray(list) ? list.filter((c) => c && Array.isArray(c.transitions)) : [];
  } catch {
    return [];
  }
}

export function savePathChecks(pouType: string | undefined, list: PathCheck[]): void {
  if (!pouType) return;
  try {
    localStorage.setItem(key(pouType), JSON.stringify(list.slice(0, 100)));
  } catch {
    // per-viewer convenience only
  }
}

/** A check from a session's transitions (unique, in the order first taken) */
export function pathCheckFrom(name: string, source: string, transitions: { from: string; to: string }[]): PathCheck {
  const seen = new Set<string>();
  const unique: { from: string; to: string }[] = [];
  for (const t of transitions) {
    const k = `${t.from}->${t.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push({ from: t.from, to: t.to });
  }
  return { id: Math.random().toString(36).slice(2, 10), name: name.trim().slice(0, 80) || 'Path', created: Date.now(), source, transitions: unique, steps: transitions.length };
}

/** The checks' transitions the diagram no longer has (edges: from -> to of the current diagram) */
export function runPathChecks(checks: PathCheck[], edges: { from: string; to: string }[]): { check: PathCheck; missing: { from: string; to: string }[] }[] {
  const have = new Set(edges.map((e) => `${e.from}->${e.to}`));
  return checks.map((check) => ({ check, missing: check.transitions.filter((t) => !have.has(`${t.from}->${t.to}`)) }));
}

/** The failures as Problems (one per missing transition; the state is the transition's start) */
export function pathCheckFindings(results: ReturnType<typeof runPathChecks>): LintFinding[] {
  return results.flatMap(({ check, missing }) =>
    missing.map((t) => ({
      key: `recorded-path:${check.id}:${t.from}->${t.to}`,
      rule: 'recorded-path' as const,
      severity: 'error' as const,
      message: `"${check.name}": ${t.from} → ${t.to} is no longer in the diagram (the machine took it; ${check.transitions.length} transitions checked)`,
      stateId: t.from,
    }))
  );
}
