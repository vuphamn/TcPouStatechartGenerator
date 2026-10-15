import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import type { GatewayConnection } from '../utils/liveGateway.ts';

/** A preventive maintenance plan (gateway/pm.cjs), with when it is due */
export interface PmPlan {
  id: string;
  title: string;
  plc: string;
  machine: string;
  everyDays: number | null;
  everyHours: number | null;
  counter: { kind: 'drive'; path: string } | { kind: 'var'; var: string; scale?: number } | null;
  leadDays: number;
  leadHours: number;
  steps: string;
  priority: string;
  lastDoneAt: number;
  lastDoneHours: number | null;
  hoursNow: number | null;
  openOrder: string | null;
  due: { nextAt: number | null; nextHours: number | null; hoursLeft: number | null; state: 'ok' | 'soon' | 'due'; why: string };
}

type Form = { id?: string; title: string; plc: string; machine: string; everyDays: string; everyHours: string; counterKind: 'drive' | 'var'; counter: string; scale: string; leadDays: string; leadHours: string; steps: string; priority: string; lastDoneAt: string };
const STATE = { due: 'bg-rose-700 text-white', soon: 'bg-amber-500 text-slate-950', ok: 'bg-emerald-900 text-emerald-200' } as const;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * The Work page's Preventive: the plans (every so many days, or operating hours of a drive or a PLC counter), when each
 * is due (overdue first), its work order made by itself when due; Work order now; written by those who assign work
 */
export const WorkPm: React.FC<{ conn: GatewayConnection | null; plans: PmPlan[]; plcs: { id: string; name: string }[]; orderNumber: (id: string) => number | null; canWork: boolean; canEdit: boolean; onOpenOrder: (id: string) => void }> = ({ conn, plans, plcs, orderNumber, canWork, canEdit, onOpenOrder }) => {
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  type R = { ok: boolean; error?: string; message?: string };
  const ask = async (m: Record<string, unknown>) => {
    setError('');
    const r: R | undefined = await conn?.request<R>(m, 'pmResult', 20000).catch((e: unknown): R => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!r?.ok) setError(r?.error ?? r?.message ?? 'Not done');
    return !!r?.ok;
  };
  const edit = (p?: PmPlan) =>
    setForm(
      p
        ? { id: p.id, title: p.title, plc: p.plc, machine: p.machine, everyDays: p.everyDays ? String(p.everyDays) : '', everyHours: p.everyHours ? String(p.everyHours) : '', counterKind: p.counter?.kind ?? 'drive', counter: p.counter ? (p.counter.kind === 'drive' ? p.counter.path : p.counter.var) : '', scale: p.counter?.kind === 'var' ? String(p.counter.scale ?? 1) : '1', leadDays: String(p.leadDays), leadHours: String(p.leadHours), steps: p.steps, priority: p.priority, lastDoneAt: '' }
        : { title: '', plc: plcs[0]?.id ?? '', machine: '', everyDays: '30', everyHours: '', counterKind: 'drive', counter: '', scale: '1', leadDays: '7', leadHours: '24', steps: '', priority: 'normal', lastDoneAt: day(Date.now()) }
    );
  const submit = async () => {
    if (!form) return;
    const f = form;
    const ok = await ask({
      type: 'pmSave',
      plan: { id: f.id, title: f.title, plc: f.plc, machine: f.machine, everyDays: Number(f.everyDays) || null, everyHours: Number(f.everyHours) || null, counter: Number(f.everyHours) ? (f.counterKind === 'drive' ? { kind: 'drive', path: f.counter } : { kind: 'var', var: f.counter, scale: Number(f.scale) || 1 }) : null, leadDays: Number(f.leadDays) || 7, leadHours: Number(f.leadHours) || 24, steps: f.steps, priority: f.priority, ...(f.lastDoneAt ? { lastDoneAt: f.lastDoneAt } : {}) },
    });
    if (ok) setForm(null);
  };
  const shown = [...plans].sort((a, b) => ({ due: 0, soon: 1, ok: 2 })[a.due.state] - ({ due: 0, soon: 1, ok: 2 })[b.due.state] || (a.due.nextAt ?? Infinity) - (b.due.nextAt ?? Infinity));
  const input = 'bg-slate-950 border border-slate-700 rounded px-2 py-1 select-text';
  return (
    <div id="work-pm" className="space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-slate-400">{plans.length} plans; their work orders made by themselves when due</span>
        {canEdit && (
          <button id="pm-new" type="button" onClick={() => edit()} className="ml-auto flex items-center gap-1 px-2 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white">
            <Plus className="w-4 h-4" /> New plan
          </button>
        )}
      </div>
      {error && <div id="pm-error" className="text-rose-300">{error}</div>}
      {!plans.length && <div className="text-slate-400">No preventive maintenance plans yet{canEdit ? ': New plan adds one (every so many days, or operating hours)' : ''}.</div>}
      <ul className="space-y-1.5">
        {shown.map((p) => {
          const n = p.openOrder ? orderNumber(p.openOrder) : null;
          return (
            <li key={p.id} className="pm-plan flex flex-wrap items-center gap-2 rounded border border-slate-800 bg-slate-900 px-3 py-2" data-plan={p.title} data-state={p.due.state}>
              <span className={`shrink-0 px-2 rounded-full text-xs font-semibold ${STATE[p.due.state]}`}>{p.due.state === 'due' ? 'Due' : p.due.state === 'soon' ? 'Soon' : 'OK'}</span>
              <span className="font-semibold">{p.title}</span>
              <span className="text-xs text-slate-400">
                {plcs.find((x) => x.id === p.plc)?.name ?? p.plc}
                {p.machine ? ` · ${p.machine.split('.').pop()}` : ''} · every {[p.everyDays ? `${p.everyDays} days` : '', p.everyHours ? `${p.everyHours} h of running` : ''].filter(Boolean).join(' or ')}
              </span>
              <span className="pm-next text-xs text-slate-300">next {p.due.why || '—'}{typeof p.hoursNow === 'number' ? ` · ${Math.round(p.hoursNow)} h now` : ''}</span>
              <span className="ml-auto flex items-center gap-2">
                {n !== null && p.openOrder ? (
                  <button type="button" className="pm-order underline text-sky-300 hover:text-white text-xs" onClick={() => onOpenOrder(p.openOrder!)}>
                    work order #{n}
                  </button>
                ) : (
                  canWork && (
                    <button type="button" className="pm-now px-2 py-0.5 rounded border border-slate-600 text-xs hover:bg-slate-800" onClick={() => void ask({ type: 'pmNow', id: p.id })}>
                      Work order now
                    </button>
                  )
                )}
                {canEdit && (
                  <button type="button" className="px-2 py-0.5 rounded border border-slate-600 text-xs hover:bg-slate-800" onClick={() => edit(p)}>
                    Edit
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {form && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => e.target === e.currentTarget && setForm(null)}>
          <form id="pm-form" className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-2 shadow-2xl" onSubmit={(e) => { e.preventDefault(); void submit(); }} onKeyDown={(e) => e.key === 'Escape' && setForm(null)}>
            <div className="text-base font-semibold">{form.id ? 'Preventive maintenance plan' : 'New preventive maintenance plan'}</div>
            <input name="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What (grease the table bearings)" className={`w-full ${input}`} />
            <div className="flex gap-2">
              <select name="plc" value={form.plc} onChange={(e) => setForm({ ...form, plc: e.target.value })} className={input}>
                {plcs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input name="machine" value={form.machine} onChange={(e) => setForm({ ...form, machine: e.target.value })} placeholder="Its machine (optional)" className={`flex-1 ${input}`} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              Every
              <input name="everyDays" type="number" min={0} value={form.everyDays} onChange={(e) => setForm({ ...form, everyDays: e.target.value })} className={`w-20 ${input}`} /> days, or
              <input name="everyHours" type="number" min={0} value={form.everyHours} onChange={(e) => setForm({ ...form, everyHours: e.target.value })} className={`w-24 ${input}`} /> h of running
            </div>
            {Number(form.everyHours) > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                Its hours:
                <select name="counterKind" value={form.counterKind} onChange={(e) => setForm({ ...form, counterKind: e.target.value as 'drive' | 'var' })} className={input}>
                  <option value="drive">a drive's own hours</option>
                  <option value="var">a PLC variable</option>
                </select>
                <input name="counter" value={form.counter} onChange={(e) => setForm({ ...form, counter: e.target.value })} placeholder={form.counterKind === 'drive' ? 'the drive (its name: Hinge 1 Router VFD)' : 'MAIN.fbSpindle.fRunHours'} className={`flex-1 ${input}`} />
                {form.counterKind === 'var' && <input name="scale" value={form.scale} onChange={(e) => setForm({ ...form, scale: e.target.value })} title="Its hours: the variable times this (seconds: 0.000277778)" className={`w-28 ${input}`} />}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              Its work order
              <input name="leadDays" type="number" min={0} value={form.leadDays} onChange={(e) => setForm({ ...form, leadDays: e.target.value })} className={`w-16 ${input}`} /> days or
              <input name="leadHours" type="number" min={0} value={form.leadHours} onChange={(e) => setForm({ ...form, leadHours: e.target.value })} className={`w-16 ${input}`} /> h before;
              <select name="priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={input}>
                {['urgent', 'high', 'normal', 'low'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </div>
            {!form.id && (
              <label className="flex items-center gap-2">
                Last done
                <input name="lastDoneAt" type="date" value={form.lastDoneAt} onChange={(e) => setForm({ ...form, lastDoneAt: e.target.value })} className={input} />
              </label>
            )}
            <textarea name="steps" value={form.steps} onChange={(e) => setForm({ ...form, steps: e.target.value })} rows={4} placeholder="Its steps (its work order's note)" className={`w-full ${input}`} />
            {error && <div className="text-rose-300">{error}</div>}
            <div className="flex justify-end gap-2">
              {form.id && (
                <button type="button" onClick={() => void ask({ type: 'pmDelete', id: form.id }).then((ok) => ok && setForm(null))} className="mr-auto px-3 py-1 rounded border border-rose-800 text-rose-300 hover:bg-rose-950">
                  Remove
                </button>
              )}
              <button type="button" onClick={() => setForm(null)} className="px-3 py-1 rounded border border-slate-700 hover:bg-slate-800">
                Cancel
              </button>
              <button id="pm-save" className="px-3 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white">
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
