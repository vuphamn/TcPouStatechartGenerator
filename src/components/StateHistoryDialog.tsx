import React, { useEffect, useState } from 'react';
import { History, Loader2, X } from 'lucide-react';
import { lineDiff } from '../utils/lineDiff.ts';

export interface StateVersion {
  hash: string;
  date: string;
  author: string;
  subject: string;
  /** The state's CASE branch then (null: none in that version) */
  code: string | null;
}

/**
 * The history of a state (its canvas menu): the commits that changed its CASE branch, newest first, each with its
 * author, date, message and what changed in the branch (against the version before it)
 */
export const StateHistoryDialog: React.FC<{ state: string; load: () => Promise<{ versions: StateVersion[]; error?: string }>; onClose: () => void }> = ({ state, load, onClose }) => {
  const [r, setR] = useState<{ versions: StateVersion[]; error?: string } | null>(null);
  useEffect(() => {
    void load().then(setR);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <div id="state-history-dialog" role="dialog" aria-label={`History of ${state}`} className="fixed right-4 top-20 z-[70] w-[640px] max-w-[92vw] max-h-[76vh] flex flex-col rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
        <History className="w-3.5 h-3.5 text-sky-300 shrink-0" />
        <span className="font-semibold text-slate-100 truncate">
          History of <span className="font-mono text-amber-200">{state}</span>
        </span>
        {!r && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
        <button onClick={onClose} className="ml-auto p-0.5 text-slate-400 hover:text-white rounded" title="Close (Esc)">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div id="state-history-list" className="overflow-y-auto p-2 space-y-2">
        {r?.error && <div className="text-slate-400 px-1">{r.error}</div>}
        {r && !r.error && r.versions.length === 0 && <div className="text-slate-500 px-1">No commit changed its branch (or the POU is not committed yet).</div>}
        {r?.versions.map((v, i) => {
          const older = r.versions[i + 1];
          const d = lineDiff((older?.code ?? '').split(/\r?\n/), (v.code ?? '').split(/\r?\n/), 1);
          return (
            <section key={v.hash} className="state-history-version rounded border border-slate-800 bg-slate-950/40" data-hash={v.hash}>
              <div className="flex items-baseline gap-2 px-2 py-1 border-b border-slate-800">
                <span className="font-mono text-sky-300">{v.hash}</span>
                <span className="truncate text-slate-200" title={v.subject}>{v.subject}</span>
                <span className="ml-auto shrink-0 text-[10px] text-slate-500">{v.author} · {v.date}</span>
              </div>
              <pre className="state-history-diff px-2 py-1 font-mono text-[10px] leading-snug whitespace-pre-wrap">
                {v.code === null
                  ? 'The state has no branch in this version (removed).'
                  : !older
                    ? 'Its branch first seen here.'
                    : d.rows.map((row, k) => (
                        <div key={k} className={row.startsWith('+') ? 'text-emerald-300' : row.startsWith('-') ? 'text-rose-300' : 'text-slate-500'}>
                          {row}
                        </div>
                      ))}
              </pre>
            </section>
          );
        })}
      </div>
    </div>
  );
};
