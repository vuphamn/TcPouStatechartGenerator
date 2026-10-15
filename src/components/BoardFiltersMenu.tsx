import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Filter, Pencil, Save, Trash2, X } from 'lucide-react';

/** A saved filter of the operator board (gateway/boardFilters.cjs) */
export interface BoardSavedFilter {
  id: string;
  name: string;
  audience: Audience;
  note: string;
  text: string;
  problemsOnly: boolean;
  layout: 'tree' | 'flat';
  plcs: string[];
  /** "<plc>|<path>": only these machines */
  machines: string[];
  /** "<plc>|<path>": the I/O signals charted */
  signals: string[];
  alerts: boolean;
  page: 'machines' | 'io' | 'drives' | 'risk';
  by?: string;
  at?: string;
  changedBy?: string;
}

export type Audience = 'engineering' | 'operators' | 'managers' | 'maintenance' | 'other';
export const AUDIENCES: { id: Audience; label: string }[] = [
  { id: 'operators', label: 'Operators' },
  { id: 'engineering', label: 'Engineering' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'managers', label: 'Office / production managers' },
  { id: 'other', label: 'Other' },
];

/** What "Save" keeps: the board's settings now, the chosen machines, signals and PLCs as asked */
export interface FilterDraft {
  id?: string;
  name: string;
  audience: Audience;
  note: string;
  withMachines: boolean;
  withPlcs: boolean;
}

/**
 * The board's saved filters, for the people who look at it (operators, engineering, maintenance, managers): one
 * applies its view (the filter's words, problems only, tree or flat, its PLCs and machines, its signals, the alerts
 * panel); Save keeps the board as it is now for everyone on the gateway (those it lets edit the board: boardEditors).
 * Wall screens open one by its link (&saved=<id>)
 */
export const BoardFiltersMenu: React.FC<{
  filters: BoardSavedFilter[];
  active: BoardSavedFilter | null;
  canEdit: boolean;
  narrow: boolean;
  /** What is chosen now (machines, PLCs shown) for the save form */
  selectedCount: number;
  shownPlcs: number;
  onApply: (f: BoardSavedFilter | null) => void;
  onSave: (d: FilterDraft) => Promise<string | null>;
  onDelete: (f: BoardSavedFilter) => Promise<string | null>;
  linkOf: (f: BoardSavedFilter) => string;
}> = ({ filters, active, canEdit, narrow, selectedCount, shownPlcs, onApply, onSave, onDelete, linkOf }) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FilterDraft | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        setForm(null);
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const startSave = (f?: BoardSavedFilter) => {
    setError('');
    setForm(f ? { id: f.id, name: f.name, audience: f.audience, note: f.note, withMachines: f.machines.length > 0 || selectedCount > 0, withPlcs: f.plcs.length > 0 } : { name: '', audience: 'operators', note: '', withMachines: selectedCount > 0, withPlcs: false });
  };
  const submit = async () => {
    if (!form) return;
    if (!form.name.trim()) return setError('Name it');
    const err = await onSave(form);
    if (err) setError(err);
    else setForm(null);
  };
  const copy = (f: BoardSavedFilter) => {
    void navigator.clipboard?.writeText(linkOf(f)).then(() => {
      setCopied(f.id);
      window.setTimeout(() => setCopied(''), 1500);
    });
  };
  return (
    <div ref={box} className="relative">
      <span className="flex items-center">
        <button
          id="board-filters-btn"
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`flex items-center gap-1 px-2 py-1 rounded-l border text-sm ${active ? 'border-sky-600 bg-sky-900/50 text-sky-100' : 'border-slate-700 text-slate-300 hover:bg-slate-800'} ${active ? '' : 'rounded-r'}`}
          title="Saved filters: views of this board for operators, engineering, maintenance, managers"
          aria-expanded={open}
        >
          <Filter className="w-4 h-4" />
          <span id="board-filter-active" className={`${narrow ? 'max-w-[6rem]' : 'max-w-[12rem]'} truncate`}>{active ? active.name : 'Filters'}</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        {active && (
          <button id="board-filter-off" type="button" onClick={() => onApply(null)} className="px-1.5 py-1 rounded-r border border-l-0 border-sky-600 bg-sky-900/50 text-sky-100 hover:bg-sky-800" title="Show the whole board">
            <X className="w-4 h-4" />
          </button>
        )}
      </span>
      {open && (
        <div id="board-filters-menu" className={`absolute z-30 mt-1 ${narrow ? 'left-0 w-[19rem]' : 'right-0 w-[26rem]'} max-h-[70vh] overflow-y-auto rounded border border-slate-700 bg-slate-900 shadow-xl text-sm`}>
          {!filters.length && <div className="px-3 py-3 text-slate-400">No saved filters yet.{canEdit ? ' Set the board up (filter, tree or flat, machines chosen), then save it here for the people it is for.' : ''}</div>}
          {AUDIENCES.map((a) => {
            const list = filters.filter((f) => f.audience === a.id);
            if (!list.length) return null;
            return (
              <div key={a.id} className="board-filters-group" data-audience={a.id}>
                <div className="px-3 pt-2 pb-1 text-xs uppercase tracking-wide text-slate-500">{a.label}</div>
                {list.map((f) => (
                  <div key={f.id} className={`board-saved-filter group flex items-start gap-2 px-3 py-1.5 hover:bg-slate-800 ${active?.id === f.id ? 'bg-sky-950/60' : ''}`} data-filter-id={f.id}>
                    <button
                      type="button"
                      className="board-saved-filter-apply flex-1 min-w-0 text-left"
                      onClick={() => {
                        onApply(f);
                        setOpen(false);
                      }}
                    >
                      <div className="flex items-center gap-1.5 text-slate-100">
                        {active?.id === f.id && <Check className="w-3.5 h-3.5 text-sky-300" />}
                        <span className="truncate font-medium">{f.name}</span>
                      </div>
                      <div className="text-xs text-slate-400 truncate">
                        {[f.layout === 'tree' ? 'tree' : 'flat', f.page === 'io' ? 'I/O page' : f.page === 'drives' ? 'Drives page' : f.page === 'risk' ? 'Risk page' : '', f.problemsOnly ? 'problems only' : '', f.text ? `"${f.text}"` : '', f.machines.length ? `${f.machines.length} machines` : '', f.signals.length ? `${f.signals.length} signals` : '', f.plcs.length ? `${f.plcs.length} PLC${f.plcs.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}
                        {f.note ? ` — ${f.note}` : ''}
                      </div>
                    </button>
                    <button type="button" className="p-1 rounded text-slate-400 hover:text-white" title="Copy its link (for a wall screen)" onClick={() => copy(f)}>
                      {copied === f.id ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    {canEdit && (
                      <>
                        <button type="button" className="board-saved-filter-update p-1 rounded text-slate-400 hover:text-white" title="Save the board as it is now under this name" onClick={() => startSave(f)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="board-saved-filter-delete p-1 rounded text-slate-400 hover:text-rose-300"
                          title="Delete it (for everyone)"
                          onClick={() => {
                            if (window.confirm(`Delete the saved filter "${f.name}" for everyone?`)) void onDelete(f).then((e) => e && setError(e));
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
          {canEdit && !form && (
            <button id="board-filter-save-new" type="button" onClick={() => startSave()} className="w-full flex items-center gap-1.5 px-3 py-2 border-t border-slate-800 text-sky-300 hover:bg-slate-800">
              <Save className="w-4 h-4" /> Save the board as it is now…
            </button>
          )}
          {form && (
            <form
              id="board-filter-form"
              className="flex flex-col gap-2 px-3 py-3 border-t border-slate-800 bg-slate-950/60"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="text-slate-300">{form.id ? 'Save the board as it is now under this name' : 'Save the board as it is now'}</div>
              <input id="board-filter-name" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name (e.g. Line 202 operators)" className="bg-slate-900 border border-slate-700 rounded px-2 py-1 select-text" maxLength={60} />
              <label className="flex items-center gap-2">
                For
                <select id="board-filter-audience" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as Audience })} className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1">
                  {AUDIENCES.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Note (optional): what it is for" className="bg-slate-900 border border-slate-700 rounded px-2 py-1 select-text" maxLength={200} />
              <label className="flex items-center gap-2 text-slate-300">
                <input id="board-filter-with-machines" type="checkbox" checked={form.withMachines} disabled={!selectedCount} onChange={(e) => setForm({ ...form, withMachines: e.target.checked })} />
                Only the {selectedCount} machine{selectedCount === 1 ? '' : 's'} chosen{!selectedCount ? ' (none: choose some with Select)' : ''}
              </label>
              <label className="flex items-center gap-2 text-slate-300">
                <input type="checkbox" checked={form.withPlcs} onChange={(e) => setForm({ ...form, withPlcs: e.target.checked })} />
                Only the {shownPlcs} PLC{shownPlcs === 1 ? '' : 's'} shown now
              </label>
              <div className="text-xs text-slate-500">Kept with it: the filter's words, problems only, tree or flat, the page (machines, I/O or drives), its signals, the alerts panel.</div>
              {error && <div className="text-rose-300">{error}</div>}
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setForm(null)} className="px-3 py-1 rounded border border-slate-700 hover:bg-slate-800">
                  Cancel
                </button>
                <button id="board-filter-save" className="px-3 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white">
                  Save
                </button>
              </div>
            </form>
          )}
          {error && !form && <div className="px-3 py-2 text-rose-300">{error}</div>}
        </div>
      )}
    </div>
  );
};
