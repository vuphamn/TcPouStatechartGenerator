import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';
import type { PouVariable } from '../utils/pouVariables.ts';

/**
 * The Input Assistant (F2, as in TwinCAT): every name the code can use, by category (variables, inherited, global
 * variables, states, enum values, types, the standard ones), with a search; Enter or a double-click inserts it
 */
export const InputAssistantDialog: React.FC<{
  catalog: { category: string; items: PouVariable[] }[];
  onInsert: (name: string) => void;
  onClose: () => void;
}> = ({ catalog, onInsert, onClose }) => {
  const [category, setCategory] = useState<string>('All');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => searchRef.current?.focus(), []);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = catalog.filter((c) => category === 'All' || c.category === category).flatMap((c) => c.items.map((v) => ({ ...v, category: c.category })));
    return q ? pool.filter((v) => v.name.toLowerCase().includes(q) || (v.type || '').toLowerCase().includes(q) || (v.comment || '').toLowerCase().includes(q)) : pool;
  }, [catalog, category, query]);
  useEffect(() => setActive(0), [category, query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const pick = (i: number) => {
    const v = items[i];
    if (!v) return;
    onInsert(v.name);
    onClose();
  };
  return (
    <div id="input-assistant-overlay" className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        id="input-assistant"
        role="dialog"
        aria-label="Input Assistant"
        className="w-[760px] max-w-[94vw] h-[520px] max-h-[86vh] flex flex-col rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, Math.min(items.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(active);
          }
        }}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
          <span className="font-semibold text-slate-100">Input Assistant</span>
          <button onClick={onClose} className="p-0.5 text-slate-400 hover:text-white rounded" title="Close (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-2 border-b border-slate-800 flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-slate-500" />
          <input
            id="input-assistant-search"
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search names, types, comments"
            className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono"
            autoComplete="off"
          />
          <span className="text-slate-500">{items.length} names</span>
        </div>
        <div className="flex-1 min-h-0 flex">
          <div className="w-44 shrink-0 border-r border-slate-800 overflow-y-auto py-1">
            {['All', ...catalog.map((c) => c.category)].map((c) => (
              <button
                key={c}
                type="button"
                data-category={c}
                onClick={() => setCategory(c)}
                className={`input-assistant-category w-full text-left px-3 py-1 ${category === c ? 'bg-sky-800/40 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
              >
                {c}
                <span className="float-right text-slate-500">{c === 'All' ? catalog.reduce((n, x) => n + x.items.length, 0) : catalog.find((x) => x.category === c)?.items.length}</span>
              </button>
            ))}
          </div>
          <div ref={listRef} className="flex-1 min-w-0 overflow-y-auto py-1" role="listbox">
            {items.map((v, i) => (
              <div
                key={`${v.category}-${v.name}`}
                data-row={i}
                data-name={v.name}
                role="option"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                onDoubleClick={() => pick(i)}
                className={`input-assistant-item flex items-center gap-2 px-3 py-1 cursor-pointer font-mono ${i === active ? 'bg-sky-700/40 text-white' : 'text-slate-200 hover:bg-slate-800/60'}`}
                title={v.comment}
              >
                <span className="truncate">{v.name}</span>
                {v.type && <span className="text-slate-400 truncate">: {v.type}</span>}
                <span className="ml-auto text-[10px] text-slate-500 shrink-0 font-sans">{category === 'All' ? v.category : v.scope}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-between items-center px-4 py-2 border-t border-slate-800 text-slate-500">
          <span>Enter or a double-click inserts it at the caret</span>
          <button id="input-assistant-insert" type="button" onClick={() => pick(active)} disabled={!items.length} className="px-3 py-1 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-semibold disabled:opacity-40">
            Insert
          </button>
        </div>
      </div>
    </div>
  );
};
