import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

export interface PaletteCommand {
  id: string;
  label: string;
  /** "State", "Method", "Tab", "View", ... */
  group: string;
  hint?: string;
  run: () => void;
}

/**
 * The command palette (Ctrl+Shift+P): every command of the app with a filter, as in Visual Studio Code. The words
 * typed must all be in the command (any order); arrows and Enter run one, Esc closes.
 */
export const CommandPalette: React.FC<{ commands: PaletteCommand[]; onClose: () => void }> = ({ commands, onClose }) => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return commands;
    const hits = commands.filter((c) => {
      const text = `${c.group} ${c.label} ${c.hint ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    // (a label starting with what is typed first)
    const first = words[0];
    return [...hits.filter((c) => c.label.toLowerCase().startsWith(first)), ...hits.filter((c) => !c.label.toLowerCase().startsWith(first))];
  }, [commands, query]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const run = (i: number) => {
    const c = shown[i];
    if (!c) return;
    onClose();
    // (after the palette is gone: a command may open a dialog)
    setTimeout(() => c.run(), 0);
  };
  return (
    <div id="command-palette-overlay" className="fixed inset-0 z-[90] flex items-start justify-center pt-[12vh] bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="command-palette" role="dialog" aria-label="Command palette" className="w-[640px] max-w-[94vw] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
          <Search className="w-4 h-4 text-slate-500" />
          <input
            id="command-palette-input"
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (shown.length) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(active);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Type a command: a state, a method, a tab, an option…"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 outline-none"
          />
          <span className="text-slate-500 shrink-0">{shown.length}</span>
          <button onClick={onClose} className="p-0.5 text-slate-400 hover:text-white rounded" title="Close (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto py-1">
          {shown.length === 0 && <div className="px-3 py-2 text-slate-500">No command matches “{query.trim()}”</div>}
          {shown.map((c, i) => (
            <div
              key={c.id}
              data-row={i}
              data-id={c.id}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => run(i)}
              className={`command-palette-item flex items-center gap-2 px-3 py-1.5 cursor-pointer ${i === active ? 'bg-sky-700/40 text-white' : 'text-slate-200'}`}
            >
              <span className="text-[10px] w-16 shrink-0 text-slate-500 uppercase tracking-wide">{c.group}</span>
              <span className="truncate">{c.label}</span>
              {c.hint && <span className="ml-auto text-[10px] font-mono text-slate-500 shrink-0">{c.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
