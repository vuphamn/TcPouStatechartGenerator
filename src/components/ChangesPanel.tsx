import React from 'react';
import { GitCompare, Loader2, Minus, Plus, PenLine } from 'lucide-react';
import type { ChartDiff } from '../utils/chartDiff.ts';

export type CompareBase = 'saved' | 'git';

interface ChangesPanelProps {
  base: CompareBase;
  onBaseChange: (base: CompareBase) => void;
  /** Label of the "saved" baseline: "saved in XAE" or "as loaded" */
  savedLabel: string;
  gitAvailable: boolean;
  loading: boolean;
  error: string | null;
  /** Shown when the enum could not be compared (only the POU) */
  note: string | null;
  diff: ChartDiff | null;
  showOnDiagram: boolean;
  onShowOnDiagramChange: (show: boolean) => void;
  onJumpToState: (stateId: string) => void;
}

const Section: React.FC<{ title: string; count: number; children: React.ReactNode }> = ({ title, count, children }) =>
  count === 0 ? null : (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 px-1 pt-1">
        {title} <span className="text-slate-400">{count}</span>
      </div>
      {children}
    </div>
  );

export const ChangesPanel: React.FC<ChangesPanelProps> = ({
  base,
  onBaseChange,
  savedLabel,
  gitAvailable,
  loading,
  error,
  note,
  diff,
  showOnDiagram,
  onShowOnDiagramChange,
  onJumpToState,
}) => {
  const row = (key: string, icon: React.ReactNode, cls: string, main: React.ReactNode, detail?: string, state?: string) => (
    <button
      key={key}
      onClick={() => state && onJumpToState(state)}
      className={`changes-item w-full text-left flex items-start gap-1.5 px-1.5 py-1 rounded hover:bg-slate-800 ${cls}`}
      title={detail}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="font-mono text-[11px] break-all">{main}</span>
        {detail && <span className="block text-[10.5px] text-slate-500 break-words">{detail}</span>}
      </span>
    </button>
  );
  const add = <Plus className="w-3 h-3 text-emerald-400" />;
  const del = <Minus className="w-3 h-3 text-rose-400" />;
  const mod = <PenLine className="w-3 h-3 text-amber-300" />;
  return (
    <div id="changes-panel" className="flex-1 min-h-0 w-full bg-slate-900 flex flex-col text-xs">
      <div className="p-2.5 border-b border-slate-800 space-y-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">Compare with</span>
          {(
            [
              ['saved', savedLabel, true],
              ['git', 'committed (git)', gitAvailable],
            ] as const
          ).map(([id, label, enabled]) => (
            <button
              key={id}
              id={`changes-base-${id}`}
              disabled={!enabled}
              onClick={() => onBaseChange(id)}
              title={enabled ? undefined : 'Needs the desktop app or TwinCAT XAE'}
              className={`px-2 py-0.5 rounded border text-[11px] ${
                base === id ? 'bg-sky-900/60 border-sky-600 text-sky-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'
              } disabled:opacity-40`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-slate-400 cursor-pointer">
          <input id="changes-show-on-diagram" type="checkbox" checked={showOnDiagram} onChange={(e) => onShowOnDiagramChange(e.target.checked)} />
          Show on the diagram (new: green, changed: amber)
        </label>
      </div>
      <div id="changes-summary" className="px-2.5 py-1.5 border-b border-slate-800 shrink-0 text-slate-400 flex items-center gap-1.5">
        {loading ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" /> Reading the committed version...
          </>
        ) : error ? (
          <span className="text-amber-300">{error}</span>
        ) : diff ? (
          <>
            <GitCompare className="w-3 h-3" />
            {diff.total === 0 ? 'No changes' : `${diff.total} change${diff.total === 1 ? '' : 's'}`}
          </>
        ) : null}
      </div>
      {note && <div className="px-2.5 py-1 text-[11px] text-slate-500 border-b border-slate-800 shrink-0">{note}</div>}
      {diff && !loading && !error && (
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
          <Section title="States added" count={diff.statesAdded.length}>
            {diff.statesAdded.map((s) => row(`sa-${s}`, add, 'text-emerald-200', s, undefined, s))}
          </Section>
          <Section title="States removed" count={diff.statesRemoved.length}>
            {diff.statesRemoved.map((s) => row(`sr-${s}`, del, 'text-rose-200', s, 'Not in the current diagram'))}
          </Section>
          <Section title="States with changed code" count={diff.statesChanged.length}>
            {diff.statesChanged.map((s) => row(`sc-${s}`, mod, 'text-amber-100', s, undefined, s))}
          </Section>
          <Section title="Transitions added" count={diff.transitionsAdded.length}>
            {diff.transitionsAdded.map((t) => row(`ta-${t.from}-${t.to}`, add, 'text-emerald-200', `${t.from} → ${t.to}`, t.guard || undefined, t.from))}
          </Section>
          <Section title="Transitions removed" count={diff.transitionsRemoved.length}>
            {diff.transitionsRemoved.map((t) => row(`tr-${t.from}-${t.to}`, del, 'text-rose-200', `${t.from} → ${t.to}`, t.guard || undefined, t.from))}
          </Section>
          <Section title="Guards changed" count={diff.guardsChanged.length}>
            {diff.guardsChanged.map((g) =>
              row(`gc-${g.from}-${g.to}`, mod, 'text-amber-100', `${g.from} → ${g.to}`, `was: ${g.before.join(' | ') || '(always)'}  now: ${g.after.join(' | ') || '(always)'}`, g.from)
            )}
          </Section>
        </div>
      )}
    </div>
  );
};
