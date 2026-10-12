import React, { useEffect, useState } from 'react';
import { Loader2, Network, X } from 'lucide-react';
import type { Reference } from '../utils/renameVariable.ts';

export interface CrossReferenceGroup {
  /** The POU's name; its file */
  pou: string;
  path?: string;
  /** The POU loaded here */
  self?: boolean;
  refs: Reference[];
}
type Filter = 'all' | 'writes' | 'reads';

/**
 * The Cross Reference List (XAE's): every place of a name in the project, by POU and where in it, each a declaration,
 * a write or a read with its line; a filter for the writes or the reads; a click opens it
 */
export const CrossReferenceDialog: React.FC<{
  name: string;
  groups: CrossReferenceGroup[];
  loading?: boolean;
  note?: string;
  onOpen: (group: CrossReferenceGroup, ref: Reference) => void;
  onClose: () => void;
}> = ({ name, groups, loading, note, onOpen, onClose }) => {
  const [filter, setFilter] = useState<Filter>('all');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const keep = (r: Reference) => filter === 'all' || (filter === 'writes' ? r.kind === 'write' : r.kind === 'read');
  const shown = groups.map((g) => ({ ...g, refs: g.refs.filter(keep) })).filter((g) => g.refs.length);
  const all = groups.flatMap((g) => g.refs);
  const n = (k: Reference['kind']) => all.filter((r) => r.kind === k).length;
  const mark = (r: Reference) => {
    const at = r.text.toLowerCase().search(new RegExp(`\\b${name.toLowerCase().replace(/[^\w]/g, '')}\\b`));
    if (at < 0) return r.text;
    return (
      <>
        {r.text.slice(0, at)}
        <mark className="bg-amber-500/30 text-amber-100 rounded-sm">{r.text.slice(at, at + name.length)}</mark>
        {r.text.slice(at + name.length)}
      </>
    );
  };
  const tab = (f: Filter, label: string, count: number) => (
    <button id={`xref-${f}`} role="radio" aria-checked={filter === f} onClick={() => setFilter(f)} className={`px-1.5 py-0.5 ${filter === f ? (f === 'writes' ? 'bg-rose-800 text-white' : 'bg-sky-700 text-white') : 'text-slate-400 hover:bg-slate-800'}`}>
      {label} {count}
    </button>
  );
  return (
    <div id="xref-dialog" role="dialog" aria-label={`Cross Reference List: ${name}`} className="fixed right-4 top-20 z-[70] w-[620px] max-w-[92vw] max-h-[72vh] flex flex-col rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
        <Network className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="font-semibold text-slate-100 truncate">
          Cross Reference List: <span className="font-mono text-amber-200">{name}</span>
        </span>
        <span id="xref-count" className="text-[10px] text-slate-400 shrink-0">
          {all.length} in {groups.filter((g) => g.refs.length).length} POU{groups.filter((g) => g.refs.length).length === 1 ? '' : 's'}
        </span>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
        <div className="ml-auto flex rounded-md border border-slate-700 overflow-hidden text-[10px] shrink-0" role="radiogroup" aria-label="Which uses">
          {tab('all', 'All', all.length)}
          {tab('writes', 'Writes', n('write'))}
          {tab('reads', 'Reads', n('read'))}
        </div>
        <button onClick={onClose} className="p-0.5 text-slate-400 hover:text-white rounded" title="Close (Esc)">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div id="xref-list" className="overflow-y-auto p-2 space-y-2">
        {!loading && shown.length === 0 && <div className="text-slate-500 px-1">{filter === 'all' ? `No uses of ${name} in the project.` : `${name} is ${filter === 'writes' ? 'written' : 'read'} nowhere in the project.`}</div>}
        {shown.map((g) => (
          <div key={g.path ?? g.pou} className="xref-pou" data-pou={g.pou}>
            <div className="px-1 pb-0.5 flex items-baseline gap-2">
              <span className="font-semibold text-slate-200">{g.pou}</span>
              {g.self && <span className="text-[9px] px-1 rounded bg-sky-900/60 text-sky-200">this POU</span>}
              <span className="text-[10px] text-slate-500">{g.refs.length}</span>
            </div>
            {g.refs.map((r, i) => (
              <button
                key={`${r.where}-${r.line}-${r.column}-${i}`}
                type="button"
                className="xref-row w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-slate-800 font-mono"
                data-pou={g.pou}
                data-where={r.where}
                data-line={r.line}
                data-kind={r.kind}
                onClick={() => onOpen(g, r)}
                title={`${g.pou} · ${r.where} line ${r.line}`}
              >
                <span className="w-28 truncate text-[10px] text-slate-400 font-sans shrink-0">{r.where}</span>
                <span className="w-8 text-right text-slate-500 shrink-0">{r.line}</span>
                <span className={`text-[9px] px-1 rounded shrink-0 font-sans ${r.kind === 'write' ? 'bg-rose-900/60 text-rose-200' : r.kind === 'declaration' ? 'bg-sky-900/60 text-sky-200' : 'bg-slate-800 text-slate-400'}`}>{r.kind === 'write' ? 'write' : r.kind === 'declaration' ? 'decl' : 'read'}</span>
                <span className="truncate text-slate-200">{mark(r)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      {note && <div id="xref-note" className="px-3 py-1.5 border-t border-slate-800 text-[10px] text-slate-500">{note}</div>}
    </div>
  );
};
