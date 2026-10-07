/**
 * Sub-machines' statistics (the Statistics panel's summary, the Complexity Report): each sub-machine (a method with a
 * state machine of its own, called from a state's branch; one inside another's state too): where it runs, its states
 * and transitions, the states nothing goes to, its states' complexity (each scored from its branch of the method)
 */
import React, { useMemo } from 'react';
import { Layers } from 'lucide-react';
import { subMachinesOf } from '../generator.ts';
import { calculateStateComplexityHeatmap } from '../utils/complexityHeatmap.ts';
import type { EdgeInfo, StateNodeInfo } from '../types.ts';

export interface SubMachineStat {
  /** Its states' ids' prefix (<state>__<method>__) */
  prefix: string;
  parent: string;
  method: string;
  /** 1: called from a state of doState(); 2: from a state of another sub-machine, ... */
  depth: number;
  states: string[];
  transitions: number;
  start: string | null;
  when: string | null;
  unreachable: string[];
  /** Its states' scores (those drawn: a collapsed one's are not) */
  scores: { name: string; score: number }[];
}

/** The POU's sub-machines, with their states' scores from the drawn chart's states and transitions */
export function subMachineStats(pou: string | undefined, availableStates: StateNodeInfo[], availableEdges: EdgeInfo[]): SubMachineStat[] {
  if (!pou) return [];
  let subs: ReturnType<typeof subMachinesOf> = [];
  try {
    subs = subMachinesOf(pou);
  } catch {
    return [];
  }
  if (!subs.length) return [];
  const heat = calculateStateComplexityHeatmap(availableStates, availableEdges, pou);
  return subs.map((m) => {
    const prefix = `${m.parent}__${m.method}__`;
    const reached = new Set([m.start, ...m.transitions.map((t) => t.to)].filter(Boolean));
    return {
      prefix,
      parent: m.parent,
      method: m.method,
      depth: (m.parent.match(/__/g)?.length ?? 0) / 2 + 1,
      states: m.states,
      transitions: m.transitions.length,
      start: m.start,
      when: m.when,
      unreachable: m.states.filter((s) => !reached.has(s)),
      scores: m.states.flatMap((s) => {
        const metric = heat.metrics.get(`${prefix}${s}`);
        return metric ? [{ name: s, score: metric.score }] : [];
      }),
    };
  });
}

export const SubMachineStats: React.FC<{
  pou?: string;
  availableStates: StateNodeInfo[];
  availableEdges: EdgeInfo[];
  /** A state of it clicked: selected (its full id) */
  onSelectState?: (stateId: string) => void;
  id?: string;
}> = ({ pou, availableStates, availableEdges, onSelectState, id = 'sub-machine-stats' }) => {
  const stats = useMemo(() => subMachineStats(pou, availableStates, availableEdges), [pou, availableStates, availableEdges]);
  if (!stats.length) return null;
  return (
    <div id={id} className="space-y-1.5">
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
        <Layers className="w-3.5 h-3.5 text-violet-400" />
        <span>Sub-machines</span>
        <span className="text-[10px] font-mono text-violet-300">{stats.length}</span>
      </div>
      {stats.map((s) => {
        const max = s.scores.length ? Math.max(...s.scores.map((x) => x.score)) : null;
        const avg = s.scores.length ? s.scores.reduce((a, x) => a + x.score, 0) / s.scores.length : null;
        const worst = max !== null ? s.scores.find((x) => x.score === max)?.name : undefined;
        return (
          <div key={s.prefix} data-sub-machine={s.prefix} className="rounded-lg border border-violet-800/50 bg-violet-950/20 p-2 space-y-1" style={{ marginLeft: `${(s.depth - 1) * 12}px` }}>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="font-mono font-semibold text-violet-200">{s.method}()</span>
              <span className="text-slate-500">in</span>
              <span className="font-mono text-slate-300 truncate" title={s.parent}>{s.parent.split('__').pop()}</span>
              {s.depth > 1 && <span className="ml-auto text-[10px] text-slate-500">level {s.depth}</span>}
            </div>
            {s.when && <div className="text-[10px] text-slate-500 font-mono truncate" title={`Runs while ${s.when}`}>while {s.when}</div>}
            <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
              <span className="px-1.5 rounded bg-slate-800/80 text-slate-300" data-stat="states">{s.states.length} states</span>
              <span className="px-1.5 rounded bg-slate-800/80 text-slate-300" data-stat="transitions">{s.transitions} transitions</span>
              {max !== null && (
                <span className="px-1.5 rounded bg-slate-800/80 text-amber-300" data-stat="max" title={`Its most complex state: ${worst} (average M=${avg!.toFixed(1)})`}>
                  max M={max}
                </span>
              )}
              {avg !== null && <span className="px-1.5 rounded bg-slate-800/80 text-slate-400" data-stat="avg">avg M={avg.toFixed(1)}</span>}
              {s.unreachable.length > 0 && (
                <span className="px-1.5 rounded bg-rose-950/60 text-rose-300" data-stat="unreachable" title={`Nothing goes to: ${s.unreachable.join(', ')}`}>
                  {s.unreachable.length} never reached
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {s.states.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onSelectState?.(`${s.prefix}${n}`)}
                  className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${s.unreachable.includes(n) ? 'border-dashed border-slate-700 text-slate-500' : 'border-slate-700 text-slate-300 hover:border-sky-600 hover:text-sky-200'}`}
                  title={`${n}${s.start === n ? ' (its start)' : ''}${s.unreachable.includes(n) ? ': never reached' : ''}: select it`}
                >
                  {s.start === n ? '▸ ' : ''}
                  {n}
                  {s.scores.find((x) => x.name === n) ? <span className="ml-1 text-slate-500">M={s.scores.find((x) => x.name === n)!.score}</span> : null}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
