import React, { useEffect } from 'react';
import { X, Search } from 'lucide-react';
import type { Reference } from '../utils/renameVariable.ts';

/** Find All References: every use of a name in the POU, by method; a click opens it at the line */
export const ReferencesDialog: React.FC<{ name: string; refs: Reference[]; onOpen: (ref: Reference) => void; onClose: () => void }> = ({ name, refs, onOpen, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const groups: { where: string; refs: Reference[] }[] = [];
  for (const r of refs) {
    const g = groups.find((x) => x.where === r.where);
    if (g) g.refs.push(r);
    else groups.push({ where: r.where, refs: [r] });
  }
  const mark = (r: Reference) => {
    const raw = r.text;
    // (the text is trimmed: the use is found again in it)
    const at = raw.toLowerCase().search(new RegExp(`\\b${name.toLowerCase()}\\b`));
    if (at < 0) return raw;
    return (
      <>
        {raw.slice(0, at)}
        <mark className="bg-amber-500/30 text-amber-100 rounded-sm">{raw.slice(at, at + name.length)}</mark>
        {raw.slice(at + name.length)}
      </>
    );
  };
  const writes = refs.filter((r) => r.kind === 'write').length;
  return (
    <div id="references-dialog" role="dialog" aria-label={`References to ${name}`} className="fixed right-4 top-20 z-[70] w-[560px] max-w-[92vw] max-h-[70vh] flex flex-col rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-800">
        <span className="flex items-center gap-2 font-semibold text-slate-100 min-w-0">
          <Search className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="truncate">
            References to <span className="font-mono text-amber-200">{name}</span>
          </span>
          <span id="references-count" className="text-[10px] font-normal text-slate-400 shrink-0">
            {refs.length} in {groups.length} place{groups.length === 1 ? '' : 's'}{writes ? ` · ${writes} written` : ''}
          </span>
        </span>
        <button onClick={onClose} className="p-0.5 text-slate-400 hover:text-white rounded" title="Close (Esc)">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="overflow-y-auto p-2 space-y-2">
        {refs.length === 0 && <div className="text-slate-500 px-1">No uses of {name} in the POU.</div>}
        {groups.map((g) => (
          <div key={g.where}>
            <div className="px-1 pb-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{g.where}</div>
            {g.refs.map((r, i) => (
              <button
                key={`${r.line}-${r.column}-${i}`}
                type="button"
                className="reference-row w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-slate-800 font-mono"
                data-where={r.where}
                data-line={r.line}
                onClick={() => onOpen(r)}
                title="Open it at this line"
              >
                <span className="w-9 text-right text-slate-500 shrink-0">{r.line}</span>
                <span className={`text-[9px] px-1 rounded shrink-0 font-sans ${r.kind === 'write' ? 'bg-rose-900/60 text-rose-200' : r.kind === 'declaration' ? 'bg-sky-900/60 text-sky-200' : 'bg-slate-800 text-slate-400'}`}>
                  {r.kind === 'write' ? 'write' : r.kind === 'declaration' ? 'decl' : 'read'}
                </span>
                <span className="truncate text-slate-200">{mark(r)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
