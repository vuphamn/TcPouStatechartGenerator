import React from 'react';
import { ArrowDown, ArrowLeftRight, Route, X } from 'lucide-react';
import type { PathSearchResult } from '../utils/statePaths.ts';

interface PathsPanelProps {
  states: string[];
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  result: PathSearchResult;
  /** The path shown alone on the diagram, or null for all of them */
  selected: number | null;
  onSelect: (index: number | null) => void;
  onJumpToState: (stateId: string) => void;
  onClear: () => void;
}

export const PathsPanel: React.FC<PathsPanelProps> = ({ states, from, to, onChange, result, selected, onSelect, onJumpToState, onClear }) => {
  const select = (id: string, value: string, onPick: (v: string) => void, label: string) => (
    <label className="flex items-center gap-2 min-w-0">
      <span className="w-9 text-slate-400 shrink-0">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onPick(e.target.value)}
        className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 font-mono text-[11px] text-slate-200"
      >
        <option value="">Choose a state</option>
        {states.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
  const shortest = result.paths[0]?.length;
  return (
    <div id="paths-panel" className="flex-1 min-h-0 w-full bg-slate-900 flex flex-col text-xs">
      <div className="p-2.5 border-b border-slate-800 space-y-1.5 shrink-0">
        {select('paths-from-select', from, (v) => onChange(v, to), 'From')}
        <div className="flex items-center gap-2">
          <span className="w-9" />
          <button
            id="paths-swap-btn"
            onClick={() => onChange(to, from)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            title="Swap From and To"
          >
            <ArrowLeftRight className="w-3 h-3" /> Swap
          </button>
          {(from || to) && (
            <button
              id="paths-clear-btn"
              onClick={onClear}
              className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              title="Clear and show the whole diagram"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
        {select('paths-to-select', to, (v) => onChange(from, v), 'To')}
      </div>
      <div id="paths-summary" className="px-2.5 py-1.5 border-b border-slate-800 shrink-0 flex items-center gap-2 text-slate-400">
        {!from || !to ? (
          <span>Choose two states (or right-click a state: Paths from / to here)</span>
        ) : result.paths.length === 0 ? (
          <span className="text-amber-300">No path from {from} to {to}</span>
        ) : (
          <>
            <span className="text-slate-200">
              {result.paths.length}
              {result.truncated ? '+' : ''} path{result.paths.length === 1 ? '' : 's'}
            </span>
            <span>shortest {shortest} step{shortest === 1 ? '' : 's'}</span>
            {selected !== null && (
              <button id="paths-show-all-btn" onClick={() => onSelect(null)} className="ml-auto text-sky-300 hover:text-sky-200">
                Show all
              </button>
            )}
          </>
        )}
      </div>
      {result.truncated && (
        <div className="px-2.5 py-1 text-[11px] text-slate-500 border-b border-slate-800 shrink-0">
          There are more paths; the shortest ones are listed.
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
        {result.paths.map((path, i) => (
          <div
            key={i}
            data-path-index={i}
            onClick={() => onSelect(selected === i ? null : i)}
            className={`paths-item p-2 rounded-lg border cursor-pointer transition-colors ${
              selected === i ? 'border-violet-500 bg-violet-950/30' : 'border-slate-700/60 bg-slate-800/40 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1 text-slate-400">
              <Route className="w-3 h-3 text-violet-300" /> #{i + 1} · {path.length} step{path.length === 1 ? '' : 's'}
            </div>
            <div className="font-mono text-[11px] leading-snug">
              {path.map((step, k) => (
                <React.Fragment key={k}>
                  {k === 0 && (
                    <button onClick={(e) => { e.stopPropagation(); onJumpToState(step.from); }} className="text-slate-200 hover:text-sky-300 break-all text-left">
                      {step.from}
                    </button>
                  )}
                  <div className="flex items-start gap-1 pl-2 text-slate-500">
                    <ArrowDown className="w-3 h-3 mt-0.5 shrink-0" />
                    <span className="break-words" title={step.guard || 'no guard'}>{step.guard || '(always)'}</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); onJumpToState(step.to); }} className="text-slate-200 hover:text-sky-300 break-all text-left">
                    {step.to}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
