import React, { useEffect, useMemo } from 'react';
import { GitCompare, X } from 'lucide-react';
import { diffCounts, diffHunks, diffLines } from '../utils/textDiff.ts';

/** Asks an editor to show its changes ({ editor: 'method' | 'pou' | 'enum' }): the "*" on its tab */
export const SHOW_EDITOR_DIFF_EVENT = 'kss-show-editor-diff';
export const showEditorDiff = (editor: 'method' | 'pou' | 'enum') => window.dispatchEvent(new CustomEvent(SHOW_EDITOR_DIFF_EVENT, { detail: { editor } }));

/** A part compared: its name ("Declaration", "Implementation") and its text before and after */
export interface DiffPart {
  name: string;
  before: string;
  after: string;
}

/**
 * The changes of an editor (its text against what is in the POU / the enum) or of a file (against its saved version),
 * as a unified diff: the lines taken out in red, put in in green, a few lines around them; Esc closes
 */
export const DiffDialog: React.FC<{ title: string; beforeLabel: string; afterLabel: string; parts: DiffPart[]; onClose: () => void }> = ({ title, beforeLabel, afterLabel, parts, onClose }) => {
  const shown = useMemo(() => parts.map((p) => ({ ...p, rows: diffLines(p.before, p.after) })), [parts]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const total = shown.reduce((n, p) => { const c = diffCounts(p.rows); return { added: n.added + c.added, removed: n.removed + c.removed }; }, { added: 0, removed: 0 });
  return (
    <div id="diff-overlay" className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="diff-dialog" role="dialog" aria-label={title} className="w-[60rem] max-w-[96vw] max-h-[86vh] flex flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl text-xs">
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <GitCompare className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="font-semibold text-slate-100 truncate">{title}</span>
            <span id="diff-counts" className="font-mono text-[11px] shrink-0">
              <span className="text-emerald-400">+{total.added}</span> <span className="text-rose-400">−{total.removed}</span>
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[10px] text-slate-400">
              <span className="text-rose-300">−</span> {beforeLabel} · <span className="text-emerald-300">+</span> {afterLabel}
            </span>
            <button type="button" onClick={onClose} className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800" title="Close (Esc)">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3 font-mono text-[11.5px] leading-[1.45]">
          {shown.every((p) => !p.rows.some((r) => r.type !== 'same')) && <div id="diff-none" className="text-slate-400 font-sans">No changes.</div>}
          {shown.map((p) => {
            if (!p.rows.some((r) => r.type !== 'same')) return null;
            return (
              <div key={p.name} className="rounded-lg border border-slate-800 overflow-hidden" data-diff-part={p.name}>
                <div className="px-3 py-1 bg-slate-800/70 text-slate-300 font-sans font-semibold text-[11px]">{p.name}</div>
                <table className="w-full border-collapse">
                  <tbody>
                    {diffHunks(p.rows).map((r, i) =>
                      r === null ? (
                        <tr key={`gap-${i}`} className="text-slate-600">
                          <td colSpan={4} className="px-3 py-0.5 select-none">⋯</td>
                        </tr>
                      ) : (
                        <tr key={i} className={`diff-row diff-${r.type} ${r.type === 'add' ? 'bg-emerald-950/60' : r.type === 'del' ? 'bg-rose-950/60' : ''}`}>
                          <td className="w-10 px-2 text-right text-slate-500 select-none align-top">{r.before ?? ''}</td>
                          <td className="w-10 px-2 text-right text-slate-500 select-none align-top">{r.after ?? ''}</td>
                          <td className={`w-4 select-none align-top ${r.type === 'add' ? 'text-emerald-300' : r.type === 'del' ? 'text-rose-300' : 'text-slate-600'}`}>{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</td>
                          <td className={`pr-3 whitespace-pre align-top ${r.type === 'add' ? 'text-emerald-100' : r.type === 'del' ? 'text-rose-100' : 'text-slate-300'}`}>{r.text || ' '}</td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
