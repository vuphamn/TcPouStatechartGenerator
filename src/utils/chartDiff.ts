/**
 * Differences between two versions of a state machine (e.g. the committed or saved one and the current edits):
 * states added / removed / with changed code, transitions added / removed / with a changed guard.
 */

import type { EdgeInfo } from '../types.ts';
import { generateStatechart } from '../generator.ts';
import { extractEdgesFromMermaid } from './diagramNotes.ts';
import { extractIdentifiedStatesFromPou } from './pouStateExtractor.ts';
import { guardOf } from './statePaths.ts';
import { getStateCodeFromPou } from './pouStateEditor.ts';

export interface ChartDiff {
  statesAdded: string[];
  statesRemoved: string[];
  /** Same state, different code in its doState() branch */
  statesChanged: string[];
  transitionsAdded: { from: string; to: string; guard: string }[];
  transitionsRemoved: { from: string; to: string; guard: string }[];
  /** Same from -> to, different guard(s) */
  guardsChanged: { from: string; to: string; before: string[]; after: string[] }[];
  total: number;
}

interface Model {
  states: Map<string, string>;
  edges: EdgeInfo[];
}

function model(pou: string, dut: string): Model {
  const extracted = extractIdentifiedStatesFromPou(pou, dut);
  // Each state's doState() branch, white space folded (only real code changes count)
  const states = new Map(
    extracted.states.map((s) => {
      let code = '';
      try {
        code = getStateCodeFromPou(pou, s.id).code ?? '';
      } catch {
        // no branch
      }
      return [s.id, code.replace(/\s+/g, ' ').trim()] as [string, string];
    })
  );
  let edges: EdgeInfo[] = [];
  try {
    edges = extractEdgesFromMermaid(generateStatechart(dut, pou, {})).filter((e) => e.from !== '[*]' && e.to !== '[*]');
  } catch {
    // an unparsable version: states only
  }
  return { states, edges };
}

export function diffCharts(before: { pou: string; dut: string }, after: { pou: string; dut: string }): ChartDiff {
  const a = model(before.pou, before.dut);
  const b = model(after.pou, after.dut);
  const statesAdded = [...b.states.keys()].filter((s) => !a.states.has(s));
  const statesRemoved = [...a.states.keys()].filter((s) => !b.states.has(s));
  const statesChanged = [...b.states.keys()].filter((s) => a.states.has(s) && a.states.get(s) !== b.states.get(s));

  const byPair = (edges: EdgeInfo[]) => {
    const m = new Map<string, string[]>();
    for (const e of edges) {
      const k = `${e.from}->${e.to}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(guardOf(e).replace(/^[①-⑳\d()[\]\s]+/, ''));
    }
    for (const v of m.values()) v.sort();
    return m;
  };
  const pa = byPair(a.edges);
  const pb = byPair(b.edges);
  const split = (k: string) => {
    const [from, to] = k.split('->');
    return { from, to };
  };
  const transitionsAdded = [...pb.keys()].filter((k) => !pa.has(k)).map((k) => ({ ...split(k), guard: pb.get(k)!.join(' | ') }));
  const transitionsRemoved = [...pa.keys()].filter((k) => !pb.has(k)).map((k) => ({ ...split(k), guard: pa.get(k)!.join(' | ') }));
  const guardsChanged = [...pb.keys()]
    .filter((k) => pa.has(k) && JSON.stringify(pa.get(k)) !== JSON.stringify(pb.get(k)))
    .map((k) => ({ ...split(k), before: pa.get(k)!, after: pb.get(k)! }));
  const total = statesAdded.length + statesRemoved.length + statesChanged.length + transitionsAdded.length + transitionsRemoved.length + guardsChanged.length;
  return { statesAdded, statesRemoved, statesChanged, transitionsAdded, transitionsRemoved, guardsChanged, total };
}
