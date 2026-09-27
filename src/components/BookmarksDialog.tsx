import React, { useEffect } from 'react';
import { Bookmark, X } from 'lucide-react';
import type { BookmarkEntry } from '../utils/bookmarks.ts';
import { BODY } from '../utils/bookmarks.ts';

/** Every bookmark of the POU (states and lines, by method); a click goes there */
export const BookmarksDialog: React.FC<{ entries: BookmarkEntry[]; onOpen: (e: BookmarkEntry) => void; onClear: () => void; onClose: () => void }> = ({ entries, onOpen, onClear, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const states = entries.filter((e) => e.kind === 'state');
  const lines = entries.filter((e) => e.kind === 'line');
  const methods = [...new Set(lines.map((l) => l.method))];
  const row = (e: BookmarkEntry, i: number) => (
    <button
      key={`${e.kind}-${e.state ?? e.method}-${e.line}-${i}`}
      type="button"
      className="bookmark-row w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-slate-800"
      data-kind={e.kind}
      data-state={e.state}
      data-method={e.method}
      data-line={e.line}
      onClick={() => onOpen(e)}
      title={e.kind === 'state' ? 'Go to the state (and its CASE label)' : 'Open it at this line'}
    >
      <Bookmark className="w-3 h-3 text-sky-300 fill-sky-400 shrink-0" />
      {e.kind === 'state' ? <span className="font-mono text-slate-100 shrink-0">{e.state}</span> : <span className="w-9 text-right text-slate-500 font-mono shrink-0">{e.line}</span>}
      <span className="truncate font-mono text-slate-400">{e.kind === 'state' ? (e.line > 0 ? `doState() line ${e.line}` : 'no CASE branch') : e.text}</span>
    </button>
  );
  return (
    <div id="bookmarks-dialog" role="dialog" aria-label="Bookmarks" className="fixed right-4 top-20 z-[70] w-[480px] max-w-[92vw] max-h-[70vh] flex flex-col rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-800">
        <span className="flex items-center gap-2 font-semibold text-slate-100">
          <Bookmark className="w-3.5 h-3.5 text-sky-300 fill-sky-400" />
          Bookmarks <span className="text-[10px] font-normal text-slate-400">{entries.length}</span>
        </span>
        <span className="flex items-center gap-1">
          {entries.length > 0 && (
            <button id="bookmarks-clear" type="button" onClick={onClear} className="px-2 py-0.5 rounded text-slate-300 hover:bg-slate-800" title="Clear all bookmarks of the POU">
              Clear all
            </button>
          )}
          <button onClick={onClose} className="p-0.5 text-slate-400 hover:text-white rounded" title="Close (Esc)">
            <X className="w-4 h-4" />
          </button>
        </span>
      </div>
      <div className="overflow-y-auto p-2 space-y-2">
        {entries.length === 0 && <div className="text-slate-500 px-1">No bookmarks yet: right-click a state, or a line in the Method Editor (PLC Bookmarks).</div>}
        {states.length > 0 && (
          <div>
            <div className="px-1 pb-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">States</div>
            {states.map(row)}
          </div>
        )}
        {methods.map((m) => (
          <div key={m}>
            <div className="px-1 pb-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{m === BODY ? 'The POU body' : `${m}()`}</div>
            {lines.filter((l) => l.method === m).map(row)}
          </div>
        ))}
      </div>
    </div>
  );
};
