import React, { useEffect, useState } from 'react';
import { Bookmark, ChevronDown, ChevronUp, Pencil, X } from 'lucide-react';
import type { BookmarkEntry } from '../utils/bookmarks.ts';
import { BODY, ENUM_KEY, declarationOf, isDeclarationKey } from '../utils/bookmarks.ts';

/** A section's heading: a method's implementation or declaration, the POU's, the enum */
const sectionName = (m: string) => {
  if (m === ENUM_KEY) return 'The enum';
  if (isDeclarationKey(m)) {
    const base = declarationOf(m);
    return base === BODY ? "The POU's declaration" : `${base}() declaration`;
  }
  return m === BODY ? 'The POU body' : `${m}()`;
};

/**
 * Every bookmark of the POU (states, and lines by section); a click goes there. Each can have a name (its pencil);
 * Previous / Next go through them all in this order (Shift+Alt+F2 / Alt+F2)
 */
export const BookmarksDialog: React.FC<{
  entries: BookmarkEntry[];
  onOpen: (e: BookmarkEntry) => void;
  onClear: () => void;
  onClose: () => void;
  onNote?: (e: BookmarkEntry, note: string) => void;
  onStep?: (dir: 1 | -1) => void;
}> = ({ entries, onOpen, onClear, onClose, onNote, onStep }) => {
  const [naming, setNaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !naming) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, naming]);
  const states = entries.filter((e) => e.kind === 'state');
  const lines = entries.filter((e) => e.kind === 'line');
  const methods = [...new Set(lines.map((l) => l.method))];
  const row = (e: BookmarkEntry, i: number) => (
    <div key={`${e.key}-${i}`} className="group flex items-center gap-1">
      {naming === e.key ? (
        <input
          id="bookmark-note-input"
          autoFocus
          value={draft}
          placeholder="Its name (Enter keeps it, Esc drops it)"
          onChange={(ev) => setDraft(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') {
              onNote?.(e, draft);
              setNaming(null);
            } else if (ev.key === 'Escape') {
              ev.stopPropagation();
              setNaming(null);
            }
          }}
          onBlur={() => setNaming(null)}
          className="flex-1 min-w-0 px-2 py-1 rounded bg-slate-950 border border-sky-600 text-slate-100 font-mono outline-none"
        />
      ) : (
        <button
          type="button"
          className="bookmark-row flex-1 min-w-0 flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-slate-800"
          data-kind={e.kind}
          data-state={e.state}
          data-method={e.method}
          data-line={e.line}
          data-key={e.key}
          onClick={() => onOpen(e)}
          title={e.kind === 'state' ? 'Go to the state (and its CASE label)' : 'Open it at this line'}
        >
          <Bookmark className="w-3 h-3 text-sky-300 fill-sky-400 shrink-0" />
          {e.kind === 'state' ? <span className="font-mono text-slate-100 shrink-0">{e.state}</span> : <span className="w-9 text-right text-slate-500 font-mono shrink-0">{e.line}</span>}
          {e.note && <span className="bookmark-note shrink-0 max-w-[45%] truncate px-1.5 rounded bg-amber-950/70 text-amber-200 border border-amber-800/60 font-sans">{e.note}</span>}
          <span className="truncate font-mono text-slate-400">{e.kind === 'state' ? (e.line > 0 ? `doState() line ${e.line}` : 'no CASE branch') : e.text}</span>
        </button>
      )}
      {onNote && naming !== e.key && (
        <button
          type="button"
          className="bookmark-name-btn shrink-0 p-1 rounded text-slate-500 hover:text-sky-300 hover:bg-slate-800 opacity-60 group-hover:opacity-100"
          title={e.note ? 'Rename it' : 'Give it a name'}
          onClick={() => {
            setDraft(e.note ?? '');
            setNaming(e.key);
          }}
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </div>
  );
  return (
    <div id="bookmarks-dialog" role="dialog" aria-label="Bookmarks" className="fixed right-4 top-20 z-[70] w-[520px] max-w-[92vw] max-h-[70vh] flex flex-col rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-800">
        <span className="flex items-center gap-2 font-semibold text-slate-100">
          <Bookmark className="w-3.5 h-3.5 text-sky-300 fill-sky-400" />
          Bookmarks <span className="text-[10px] font-normal text-slate-400">{entries.length}</span>
        </span>
        <span className="flex items-center gap-1">
          {onStep && entries.length > 0 && (
            <>
              <button id="bookmarks-prev" type="button" onClick={() => onStep(-1)} className="p-1 rounded text-slate-300 hover:bg-slate-800" title="The previous bookmark, of any section (Shift+Alt+F2)">
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button id="bookmarks-next" type="button" onClick={() => onStep(1)} className="p-1 rounded text-slate-300 hover:bg-slate-800" title="The next bookmark, of any section (Alt+F2)">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </>
          )}
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
        {entries.length === 0 && <div className="text-slate-500 px-1">No bookmarks yet: right-click a state, or a line of a code editor (Toggle Bookmark, Ctrl+F2).</div>}
        {states.length > 0 && (
          <div>
            <div className="px-1 pb-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">States</div>
            {states.map(row)}
          </div>
        )}
        {methods.map((m) => (
          <div key={m}>
            <div className="px-1 pb-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{sectionName(m)}</div>
            {lines.filter((l) => l.method === m).map(row)}
          </div>
        ))}
      </div>
    </div>
  );
};
