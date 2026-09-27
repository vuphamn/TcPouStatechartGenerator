import React from 'react';
import { FlaskConical, Play, RotateCcw, SkipForward, Square, Undo2 } from 'lucide-react';
import type { EdgeGuardView } from '../utils/liveGuards.ts';

export interface SimTransition {
  edgeId: string;
  to: string;
  priority?: number;
  label: string;
  source: string;
  /** true / false / unknown with the values set; always true without a condition */
  result: EdgeGuardView['result'] | 'always';
}

export interface SimulationPanelProps {
  live: boolean;
  active: boolean;
  states: string[];
  startState: string | null;
  current: string | null;
  history: { from: string; to: string; label: string }[];
  transitions: SimTransition[];
  /** The variables the transitions' conditions read, with the value set (undefined: unknown) */
  variables: { name: string; value: boolean | number | string | undefined }[];
  onStart: (state: string) => void;
  onStop: () => void;
  onTake: (edgeId: string) => void;
  onStep: () => void;
  onBack: () => void;
  onSetValue: (name: string, value: boolean | number | undefined) => void;
  onGoTo: (state: string) => void;
}

const chip = (r: SimTransition['result']) =>
  r === 'true' || r === 'always'
    ? 'bg-emerald-900/70 text-emerald-300 border-emerald-700'
    : r === 'false'
    ? 'bg-slate-800 text-slate-400 border-slate-700'
    : 'bg-amber-950/70 text-amber-300 border-amber-800';

/** Offline simulation: step through the chart without a PLC, choosing transitions or setting their conditions' values */
export const SimulationPanel: React.FC<SimulationPanelProps> = (p) => {
  const [start, setStart] = React.useState<string>(p.startState ?? p.states[0] ?? '');
  React.useEffect(() => {
    if (!start && (p.startState || p.states[0])) setStart(p.startState ?? p.states[0]);
  }, [p.startState, p.states, start]);
  const firing = p.transitions.find((t) => t.result === 'true' || t.result === 'always');
  return (
    <div id="simulation-panel" className="flex flex-col h-full min-h-0 text-xs text-slate-300 overflow-y-auto">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 bg-slate-900/60">
        <FlaskConical className="w-4 h-4 text-violet-400" />
        <span className="font-semibold text-slate-100">Simulation</span>
        {p.active ? (
          <button id="sim-stop" onClick={p.onStop} className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 hover:border-rose-600 hover:text-rose-300">
            <Square className="w-3 h-3" /> Stop
          </button>
        ) : null}
      </div>
      {p.live ? (
        <div className="p-4 text-slate-400">Live: the chart shows the PLC. Stop Live to simulate.</div>
      ) : !p.active ? (
        <div className="p-3 space-y-3">
          <p className="text-slate-400">
            Step through the state machine without a PLC. Pick a start, then take its transitions yourself or set the values their conditions read and press
            Step: the first transition that holds (by priority) is taken. The canvas shows the state and the conditions' results.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Start in</span>
            <select id="sim-start-state" value={start} onChange={(e) => setStart(e.target.value)} className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 font-mono">
              {p.states.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button id="sim-start" onClick={() => start && p.onStart(start)} className="flex items-center gap-1 px-2 py-1 rounded bg-violet-700 hover:bg-violet-600 text-white font-semibold">
              <Play className="w-3.5 h-3.5" /> Start
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">In</span>
            <button id="sim-current" onClick={() => p.current && p.onGoTo(p.current)} className="px-2 py-0.5 rounded bg-violet-900/60 border border-violet-700 text-violet-200 font-mono truncate" title="Show it on the canvas">
              {p.current}
            </button>
            <button id="sim-back" onClick={p.onBack} disabled={!p.history.length} className="ml-auto p-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-30" title="Back one step">
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button id="sim-restart" onClick={() => p.startState && p.onStart(p.history[0]?.from ?? p.current ?? p.startState)} className="p-1 rounded border border-slate-700 hover:bg-slate-800" title="Back to the start">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button id="sim-step" onClick={p.onStep} disabled={!firing} className="flex items-center gap-1 px-2 py-0.5 rounded bg-violet-700 hover:bg-violet-600 text-white font-semibold disabled:opacity-40" title={firing ? `Take → ${firing.to}` : 'No transition holds with these values'}>
              <SkipForward className="w-3.5 h-3.5" /> Step
            </button>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Transitions out (checked in this order)</div>
            {p.transitions.length === 0 ? (
              <div className="text-slate-500">None: a dead end{p.current ? '' : ''}.</div>
            ) : (
              <ul className="space-y-1">
                {p.transitions.map((t, i) => (
                  <li key={t.edgeId} className={`flex items-start gap-1.5 rounded border px-1.5 py-1 ${t === firing ? 'border-violet-600 bg-violet-950/40' : 'border-slate-800'}`}>
                    <span className="w-5 shrink-0 text-center text-slate-500">{t.priority ?? (t.source === 'preProcess' ? 'pre' : '')}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-slate-100 truncate">→ {t.to}</div>
                      {t.label && <div className="font-mono text-[10px] text-slate-400 break-words">{t.label}</div>}
                    </div>
                    <span className={`shrink-0 px-1 rounded border text-[9px] font-bold ${chip(t.result)}`}>{t.result === 'always' ? 'ALWAYS' : t.result.toUpperCase()}</span>
                    <button id={`sim-take-${i}`} onClick={() => p.onTake(t.edgeId)} className="shrink-0 px-1.5 py-0.5 rounded border border-slate-700 hover:border-violet-500 hover:text-violet-200">
                      Take
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {p.variables.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Values the conditions read</div>
              <ul className="space-y-1">
                {p.variables.map((v) => (
                  <li key={v.name} className="flex items-center gap-1.5">
                    <span className="flex-1 min-w-0 font-mono truncate" title={v.name}>
                      {v.name}
                    </span>
                    {(['?', 'TRUE', 'FALSE'] as const).map((opt) => {
                      const on = opt === '?' ? v.value === undefined : v.value === (opt === 'TRUE');
                      return (
                        <button
                          key={opt}
                          id={`sim-var-${v.name}-${opt === '?' ? 'unknown' : opt.toLowerCase()}`}
                          onClick={() => p.onSetValue(v.name, opt === '?' ? undefined : opt === 'TRUE')}
                          className={`px-1 rounded border text-[9px] ${on ? 'bg-violet-800 border-violet-600 text-white' : 'border-slate-700 text-slate-400 hover:text-white'}`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                    <input
                      aria-label={`${v.name} as a number`}
                      className="w-14 bg-slate-950 border border-slate-700 rounded px-1 font-mono"
                      placeholder="n"
                      value={typeof v.value === 'number' ? String(v.value) : ''}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        p.onSetValue(v.name, e.target.value.trim() === '' || !Number.isFinite(n) ? undefined : n);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {p.history.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Steps</div>
              <ol id="sim-history" className="space-y-0.5 font-mono text-[10px] text-slate-400">
                {p.history.map((h, i) => (
                  <li key={i} className="truncate" title={h.label}>
                    {i + 1}. {h.from} → {h.to}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
