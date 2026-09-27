import React, { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { ChoiceRow } from '../utils/statechartEdits.ts';

export interface ChoiceRequest {
  from: string;
  states: string[];
  onSubmit: (rows: ChoiceRow[], elseTo: string | null) => void;
}

/** A choice from a state: conditions and their targets (checked in this order), and a target otherwise (ELSE) */
export const ChoiceDialog: React.FC<{ request: ChoiceRequest; onClose: () => void }> = ({ request, onClose }) => {
  const targets = request.states.filter((s) => s !== request.from);
  const [rows, setRows] = useState<ChoiceRow[]>([
    { condition: '', to: targets[0] ?? '' },
    { condition: '', to: targets[1] ?? targets[0] ?? '' },
  ]);
  const [elseTo, setElseTo] = useState('');
  const valid = rows.filter((r) => r.condition.trim() && r.to);
  const setRow = (i: number, r: Partial<ChoiceRow>) => setRows((all) => all.map((x, k) => (k === i ? { ...x, ...r } : x)));
  const submit = () => {
    if (!valid.length) return;
    request.onSubmit(valid, elseTo || null);
    onClose();
  };
  const select = (value: string, onChange: (v: string) => void, id: string, none?: string) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="w-56 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 font-mono text-slate-100">
      {none !== undefined && <option value="">{none}</option>}
      {targets.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
  return (
    <div id="choice-overlay" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        id="choice-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Choice from ${request.from}`}
        className="w-[640px] max-w-[94vw] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') submit();
          e.stopPropagation();
        }}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
          <span className="font-semibold text-slate-100">
            Choice from <span className="font-mono">{request.from}</span>
          </span>
          <button onClick={onClose} className="p-0.5 text-slate-400 hover:text-white rounded" title="Cancel (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-2">
          <div className="text-slate-400">The conditions are checked in this order (IF / ELSIF); the first that holds decides. Added at the end of the state's branch in doState().</div>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-10 text-right font-mono text-slate-500">{i === 0 ? 'IF' : 'ELSIF'}</span>
              <input
                id={`choice-condition-${i}`}
                value={r.condition}
                autoFocus={i === 0}
                placeholder="condition (Structured Text)"
                onChange={(e) => setRow(i, { condition: e.target.value })}
                className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
              />
              <span className="text-slate-500">→</span>
              {select(r.to, (v) => setRow(i, { to: v }), `choice-target-${i}`)}
              <button
                onClick={() => setRows((all) => all.filter((_, k) => k !== i))}
                disabled={rows.length <= 1}
                className="p-1 text-slate-500 hover:text-rose-300 disabled:opacity-30"
                title="Remove this branch"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button id="choice-add-row" onClick={() => setRows((all) => [...all, { condition: '', to: targets[0] ?? '' }])} className="ml-12 flex items-center gap-1 text-sky-300 hover:text-sky-200">
            <Plus className="w-3.5 h-3.5" /> Add a branch
          </button>
          <div className="flex items-center gap-2 pt-1">
            <span className="w-10 text-right font-mono text-slate-500">ELSE</span>
            <span className="flex-1 text-slate-500">otherwise (optional)</span>
            <span className="text-slate-500">→</span>
            {select(elseTo, setElseTo, 'choice-else-target', '— stay —')}
            <span className="w-6" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-2.5 border-t border-slate-800">
          <button onClick={onClose} className="px-3 py-1 rounded-md text-slate-300 hover:bg-slate-800">
            Cancel
          </button>
          <button id="choice-submit" onClick={submit} disabled={!valid.length} className="px-3 py-1 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-semibold disabled:opacity-40">
            Add choice
          </button>
        </div>
      </div>
    </div>
  );
};
