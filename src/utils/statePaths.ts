/**
 * Paths between two states of the diagram: every simple path (no state visited twice) from A to B over the
 * transitions, shortest first, with the guard of each step.
 */

import type { EdgeInfo } from '../types.ts';
import { extractCleanGuardText } from './stateMachineStats.ts';

export interface PathStep {
  from: string;
  to: string;
  guard: string;
  edgeId: string;
}

export interface PathSearchResult {
  paths: PathStep[][];
  /** More paths exist than were collected */
  truncated: boolean;
}

export const guardOf = (edge: EdgeInfo) => extractCleanGuardText(edge.condition || edge.label || '').replace(/\s+/g, ' ').trim();

export function findPaths(edges: EdgeInfo[], from: string, to: string, maxPaths = 25, maxDepth = 30): PathSearchResult {
  if (!from || !to) return { paths: [], truncated: false };
  const out = new Map<string, EdgeInfo[]>();
  const into = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.from || !e.to || e.from === e.to) continue;
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)!.push(e);
    if (!into.has(e.to)) into.set(e.to, []);
    into.get(e.to)!.push(e.from);
  }
  // States that can reach the target at all (prunes the search)
  const canReach = new Set<string>([to]);
  const queue = [to];
  while (queue.length) {
    const s = queue.shift()!;
    for (const p of into.get(s) ?? []) {
      if (!canReach.has(p)) {
        canReach.add(p);
        queue.push(p);
      }
    }
  }
  if (from !== to && !canReach.has(from)) return { paths: [], truncated: false };

  const paths: PathStep[][] = [];
  let truncated = false;
  // Work budget: dense machines have too many simple paths to walk them all
  let budget = 300000;
  const visited = new Set<string>([from]);
  const steps: PathStep[] = [];
  // Breadth-first by length keeps the shortest paths when the limit is reached
  for (let limit = 1; limit <= maxDepth && !truncated; limit++) {
    const walk = (state: string) => {
      if (truncated) return;
      if (--budget < 0) {
        truncated = true;
        return;
      }
      if (steps.length === limit) {
        if (state === to) {
          if (paths.length >= maxPaths) truncated = true;
          else paths.push([...steps]);
        }
        return;
      }
      if (state === to && steps.length > 0) return;
      for (const e of out.get(state) ?? []) {
        if (!canReach.has(e.to) || (visited.has(e.to) && e.to !== to)) continue;
        visited.add(e.to);
        steps.push({ from: e.from, to: e.to, guard: guardOf(e), edgeId: e.id });
        walk(e.to);
        steps.pop();
        if (e.to !== to) visited.delete(e.to);
        if (truncated) return;
      }
    };
    walk(from);
  }
  return { paths, truncated };
}
