import React, { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { ForkRegion } from '../utils/statechartEdits.ts';

export interface ForkJoinRequest {
  from: string;
  states: string[];
  /** Suggested regions (names free in the POU and the enum) */
  regions: ForkRegion[];
  /** A suggested region for "Another region" */
  nextRegion: (index: number) => ForkRegion;
  onSubmit: (regions: ForkRegion[], target: string) => void;
}

const splitStates = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** A fork / join: the state's parallel regions (a state variable and its states each) and the state after the join */
export const ForkJoinDialog: React.FC<{ request: ForkJoinRequest; onClose: () => void }> = ({ request, onClose }) => {
  const targets = request.states.filter((s) => s !== request.from);
  const [rows, setRows] = useState(() => request.regions.map((r) => ({ variable: r.variable, states: r.states.join(', ') })));
  const [target, setTarget] = useState(targets[0] ?? '');
  const regions: ForkRegion[] = rows.map((r) => ({ variable: r.variable.trim(), states: splitStates(r.states) }));
  const ok = regions.length >= 2 && regions.every((r) => r.variable && r.states.length) && !!target;
  const setRow = (i: number, r: Partial<(typeof rows)[number]>) => setRows((all) => all.map((x, k) => (k === i ? { ...x, ...r } : x)));
  const submit = () => {
    if (!ok) return;
    request.onSubmit(regions, target);
    onClose();
  };
  const input = 'bg-slate-950 border border-slate-700 rounded px-1.5 py-1 font-mono text-slate-100';
  return (
    <div id="forkjoin-overlay" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        id="forkjoin-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Fork / Join in ${request.from}`}
        className="w-[820px] max-w-[96vw] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          e.stopPropagation();
        }}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
          <span className="font-semibold text-slate-100">
            Fork / Join in <span className="font-mono">{request.from}</span>
          </span>
          <button onClick={onClose} className="p-0.5 text-slate-400 hover:text-white rounded" title="Cancel (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-2">
          <div className="text-slate-400">
            Each region runs in parallel inside {request.from}: a state variable of the enum&apos;s type (declared in the POU) and its states (new enum members, a CASE in {request.from}&apos;s
            branch). On entry every region starts in its first state (fork); {request.from} goes on when every region is in its last, final state (join). Draw the regions&apos;
            transitions afterwards with Transition.
          </div>
          <div className="grid grid-cols-[12rem_1fr_auto] gap-x-2 gap-y-1 items-center">
            <span className="text-slate-500">Region variable</span>
            <span className="text-slate-500">Its states, in order (the last is final)</span>
            <span />
            {rows.map((r, i) => (
              <React.Fragment key={i}>
                <input id={`forkjoin-variable-${i}`} value={r.variable} onChange={(e) => setRow(i, { variable: e.target.value })} className={input} />
                <input id={`forkjoin-states-${i}`} value={r.states} onChange={(e) => setRow(i, { states: e.target.value })} className={input} />
                <button onClick={() => setRows((all) => all.filter((_, k) => k !== i))} disabled={rows.length <= 2} className="p-1 text-slate-500 hover:text-rose-300 disabled:opacity-30" title="Remove this region">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </React.Fragment>
            ))}
          </div>
          <button
            id="forkjoin-add-row"
            onClick={() => setRows((all) => {
              const r = request.nextRegion(all.length);
              return [...all, { variable: r.variable, states: r.states.join(', ') }];
            })}
            className="flex items-center gap-1 text-sky-300 hover:text-sky-200"
          >
            <Plus className="w-3.5 h-3.5" /> Another region
          </button>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-slate-400">Join: then to</span>
            <select id="forkjoin-target" value={target} onChange={(e) => setTarget(e.target.value)} className={`${input} w-72`}>
              {targets.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-slate-800">
          {!ok && <span className="mr-auto text-slate-500">At least two regions, each with a variable and a state</span>}
          <button onClick={onClose} className="px-3 py-1 rounded-md text-slate-300 hover:bg-slate-800">
            Cancel
          </button>
          <button id="forkjoin-submit" onClick={submit} disabled={!ok} className="px-3 py-1 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-semibold disabled:opacity-40">
            Add fork / join
          </button>
        </div>
      </div>
    </div>
  );
};
