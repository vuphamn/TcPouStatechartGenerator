import React, { useState } from 'react';
import { X } from 'lucide-react';
import { NewVariable, checkNewVariable } from '../utils/pouVariables.ts';

export const DEFAULT_SCOPES: NewVariable['scope'][] = ['VAR_INPUT', 'VAR_OUTPUT', 'VAR'];

export interface DeclareVariableFormProps {
  initial: NewVariable;
  /** Names already declared (the new one cannot be one of them) */
  known: { name: string }[];
  types: string[];
  scopes?: NewVariable['scope'][];
  /** Where the scopes go, shown next to them (e.g. "VAR: the method's own") */
  scopeHint?: (scope: NewVariable['scope']) => string | undefined;
  title?: string;
  onDone: (v: NewVariable) => void;
  onCancel: () => void;
}

/** A new variable: scope, name, type (suggestions), initial value and comment; Enter declares, Esc cancels */
export const DeclareVariableForm: React.FC<DeclareVariableFormProps> = ({ initial, known, types, scopes = DEFAULT_SCOPES, scopeHint, title, onDone, onCancel }) => {
  const [v, setV] = useState<NewVariable>({ init: '', comment: '', ...initial });
  const error = checkNewVariable(v, known);
  const done = () => {
    if (error) return;
    onDone({ ...v, init: v.init?.trim() || undefined, comment: v.comment?.trim() || undefined });
  };
  const field = 'bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono';
  const hint = scopeHint?.(v.scope);
  return (
    <div
      id="text-prompt-declare-form"
      className="rounded-md border border-emerald-800/70 bg-emerald-950/20 p-2.5 space-y-2 text-xs"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          done();
        }
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="text-emerald-200 font-semibold">{title ?? 'Declare a variable in the POU'}</div>
      <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-2 gap-y-1.5 items-center">
        <label htmlFor="text-prompt-declare-scope" className="text-slate-400">Scope</label>
        <select id="text-prompt-declare-scope" value={v.scope} onChange={(e) => setV({ ...v, scope: e.target.value as NewVariable['scope'] })} className={field}>
          {scopes.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label htmlFor="text-prompt-declare-name" className="text-slate-400">Name</label>
        <input id="text-prompt-declare-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value.trim() })} className={field} autoComplete="off" />
        <label htmlFor="text-prompt-declare-type" className="text-slate-400">Type</label>
        <input id="text-prompt-declare-type" list="text-prompt-types" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} className={field} autoFocus autoComplete="off" />
        <label htmlFor="text-prompt-declare-init" className="text-slate-400">Initial</label>
        <input id="text-prompt-declare-init" value={v.init} placeholder="(optional)" onChange={(e) => setV({ ...v, init: e.target.value })} className={field} autoComplete="off" />
        <label htmlFor="text-prompt-declare-comment" className="text-slate-400">Comment</label>
        <input id="text-prompt-declare-comment" value={v.comment} placeholder="(optional)" onChange={(e) => setV({ ...v, comment: e.target.value })} className={`${field} col-span-3 font-sans`} autoComplete="off" />
      </div>
      <datalist id="text-prompt-types">
        {types.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {hint && <div className="text-slate-500">{hint}</div>}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-slate-400 truncate">
          {v.scope} … {v.name} : {v.type || '?'}
          {v.init?.trim() ? ` := ${v.init.trim()}` : ''};
        </span>
        {error && <span id="text-prompt-declare-error" className="text-rose-300 truncate">{error}</span>}
        <button type="button" onClick={onCancel} className="ml-auto px-2 py-0.5 rounded text-slate-300 hover:bg-slate-800 shrink-0">
          Cancel
        </button>
        <button id="text-prompt-declare-ok" type="button" disabled={!!error} onClick={done} className="px-2.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-40 shrink-0">
          Declare
        </button>
      </div>
    </div>
  );
};

/** The form as a dialog of its own (the code editors' Declare variable…) */
export const DeclareVariableDialog: React.FC<DeclareVariableFormProps> = (props) => (
  <div id="declare-variable-overlay" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && props.onCancel()}>
    <div id="declare-variable-dialog" role="dialog" aria-label={props.title ?? 'Declare variable'} className="w-[560px] max-w-[92vw] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-3">
      <div className="flex justify-end -mt-1 -mr-1">
        <button onClick={props.onCancel} className="p-0.5 text-slate-400 hover:text-white rounded" title="Cancel (Esc)">
          <X className="w-4 h-4" />
        </button>
      </div>
      <DeclareVariableForm {...props} />
    </div>
  </div>
);
