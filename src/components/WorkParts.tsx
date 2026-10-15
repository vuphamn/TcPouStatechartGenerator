import React, { useState } from 'react';
import { Download, Minus, Plus, Search } from 'lucide-react';
import type { GatewayConnection } from '../utils/liveGateway.ts';

/** A spare part (gateway/spares.cjs) */
export interface SparePart {
  id: string;
  number: string;
  name: string;
  location: string;
  qty: number;
  min: number;
  unit: string;
  fits: string;
  supplier: string;
  notes: string;
  low: boolean;
  updatedAt: number;
}
export interface SpareMove {
  at: number;
  part: string;
  number: string;
  delta: number;
  qty: number;
  by: string;
  why: string;
  order?: number;
}

const EMPTY = { number: '', name: '', location: '', qty: 0, min: 0, unit: '', fits: '', supplier: '', notes: '' };

/**
 * The Work page's Parts: the spare parts kept (low ones first and red), a filter (number, name, what it fits, where);
 * a part's stock received or taken (those who handle work orders), the catalogue written (those who assign work); its
 * latest changes of stock
 */
export const WorkParts: React.FC<{ conn: GatewayConnection | null; parts: SparePart[]; moves: SpareMove[]; canWork: boolean; canEdit: boolean }> = ({ conn, parts, moves, canWork, canEdit }) => {
  const [filter, setFilter] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [form, setForm] = useState<(typeof EMPTY & { id?: string }) | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [delta, setDelta] = useState(1);
  const [why, setWhy] = useState('');
  const [error, setError] = useState('');
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = parts
    .filter((p) => (!lowOnly || p.low) && words.every((w) => `${p.number} ${p.name} ${p.fits} ${p.location} ${p.supplier}`.toLowerCase().includes(w)))
    .sort((a, b) => Number(b.low) - Number(a.low) || a.number.localeCompare(b.number, undefined, { numeric: true }));
  type R = { ok: boolean; error?: string; message?: string };
  const ask = async (m: Record<string, unknown>) => {
    setError('');
    const r: R | undefined = await conn?.request<R>(m, 'spareResult', 15000).catch((e: unknown): R => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!r?.ok) setError(r?.error ?? r?.message ?? 'Not done');
    return !!r?.ok;
  };
  const csv = () => {
    const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = ['number,name,location,qty,unit,reorder at,fits,supplier,notes', ...parts.map((p) => [q(p.number), q(p.name), q(p.location), p.qty, q(p.unit), p.min, q(p.fits), q(p.supplier), q(p.notes)].join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\r\n')], { type: 'text/csv' }));
    a.download = 'spare-parts.csv';
    a.click();
  };
  const opened = parts.find((p) => p.id === openId) ?? null;
  const lowCount = parts.filter((p) => p.low).length;
  return (
    <div id="work-parts" className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative flex items-center">
          <Search className="absolute left-2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input id="parts-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter: number, name, what it fits (i550, EL1008), where" className="w-80 pl-7 pr-2 py-1 rounded bg-slate-950 border border-slate-700 select-text" />
        </span>
        <button type="button" onClick={() => setLowOnly((v) => !v)} aria-pressed={lowOnly} className={`px-2 py-1 rounded border ${lowOnly ? 'border-rose-500 bg-rose-500/20 text-rose-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>
          To reorder{lowCount ? ` (${lowCount})` : ''}
        </button>
        <span className="text-slate-400">{parts.length} parts</span>
        {canEdit && (
          <button id="parts-new" type="button" onClick={() => setForm({ ...EMPTY })} className="flex items-center gap-1 px-2 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white">
            <Plus className="w-4 h-4" /> New part
          </button>
        )}
        <button type="button" onClick={csv} className="ml-auto p-1 rounded hover:bg-slate-800" title="CSV of every part">
          <Download className="w-4 h-4" />
        </button>
      </div>
      {error && <div id="parts-error" className="text-rose-300">{error}</div>}
      {!parts.length && <div className="text-slate-400">No spare parts yet{canEdit ? ': New part adds one' : ''}.</div>}
      {parts.length > 0 && (
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1">Number</th>
              <th>Name</th>
              <th>Where</th>
              <th className="text-right">In stock</th>
              <th className="text-right">Reorder at</th>
              <th>Fits</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className={`spare-part border-t border-slate-800 cursor-pointer hover:bg-slate-900 ${openId === p.id ? 'bg-slate-900' : ''}`} data-part={p.number} data-low={p.low ? 'true' : ''} onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                <td className="py-1 font-mono">{p.number}</td>
                <td>{p.name}</td>
                <td className="text-slate-400">{p.location}</td>
                <td className={`spare-qty text-right font-mono ${p.low ? 'text-rose-300 font-bold' : ''}`}>
                  {p.qty} {p.unit}
                </td>
                <td className="text-right font-mono text-slate-400">{p.min || ''}</td>
                <td className="text-slate-400">{p.fits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {opened && (
        <div id="parts-detail" className="rounded border border-slate-700 bg-slate-900 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <b>{opened.number}</b> {opened.name}
            <span className="text-slate-400">{opened.supplier ? `· from ${opened.supplier}` : ''}</span>
            {canEdit && (
              <button type="button" onClick={() => setForm({ ...opened })} className="ml-auto px-2 py-0.5 rounded border border-slate-600 hover:bg-slate-800">
                Edit
              </button>
            )}
          </div>
          {opened.notes && <div className="text-slate-400 whitespace-pre-wrap">{opened.notes}</div>}
          {canWork && (
            <div className="flex flex-wrap items-center gap-2">
              <input id="parts-delta" type="number" min={1} value={delta} onChange={(e) => setDelta(Math.max(1, Number(e.target.value) || 1))} className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1" />
              <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why (a delivery, for a test …)" className="flex-1 min-w-[10rem] bg-slate-950 border border-slate-700 rounded px-2 py-1 select-text" />
              <button id="parts-receive" type="button" onClick={() => void ask({ type: 'spareMove', id: opened.id, delta, why }).then((ok) => ok && setWhy(''))} className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white">
                <Plus className="w-4 h-4" /> Received
              </button>
              <button id="parts-take" type="button" onClick={() => void ask({ type: 'spareMove', id: opened.id, delta: -delta, why }).then((ok) => ok && setWhy(''))} className="flex items-center gap-1 px-2 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white">
                <Minus className="w-4 h-4" /> Taken
              </button>
            </div>
          )}
          <ul className="text-xs text-slate-400">
            {moves
              .filter((m) => m.part === opened.id)
              .slice(0, 15)
              .map((m, i) => (
                <li key={i}>
                  {new Date(m.at).toLocaleString()} · <span className={m.delta < 0 ? 'text-amber-300' : 'text-emerald-300'}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span> → {m.qty} · {m.by} · {m.why}
                </li>
              ))}
          </ul>
        </div>
      )}
      {form && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => e.target === e.currentTarget && setForm(null)}>
          <form
            id="parts-form"
            className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-2 shadow-2xl"
            onSubmit={(e) => {
              e.preventDefault();
              void ask({ type: 'spareSave', part: form }).then((ok) => ok && setForm(null));
            }}
            onKeyDown={(e) => e.key === 'Escape' && setForm(null)}
          >
            <div className="text-base font-semibold">{form.id ? 'Spare part' : 'New spare part'}</div>
            {(
              [
                ['number', 'Part number'],
                ['name', 'Name (Lenze i550 0.75 kW inverter)'],
                ['location', 'Where it is kept (cabinet 3, shelf B)'],
                ['fits', 'What it fits: device types, machines (i550, EL1008, Door dasher)'],
                ['supplier', 'Supplier'],
                ['unit', 'Unit (pcs, m)'],
              ] as const
            ).map(([k, ph]) => (
              <input key={k} name={k} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder={ph} className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 select-text" />
            ))}
            <div className="flex gap-2">
              <label className="flex items-center gap-2">
                In stock
                <input name="qty" type="number" min={0} value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) || 0 })} className="w-24 bg-slate-950 border border-slate-700 rounded px-2 py-1" />
              </label>
              <label className="flex items-center gap-2">
                Reorder at
                <input name="min" type="number" min={0} value={form.min} onChange={(e) => setForm({ ...form, min: Number(e.target.value) || 0 })} className="w-24 bg-slate-950 border border-slate-700 rounded px-2 py-1" />
              </label>
            </div>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Notes (its settings, a replacement for it)" className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 select-text" />
            {error && <div className="text-rose-300">{error}</div>}
            <div className="flex justify-end gap-2">
              {form.id && (
                <button type="button" onClick={() => void ask({ type: 'spareDelete', id: form.id }).then((ok) => ok && (setForm(null), setOpenId(null)))} className="mr-auto px-3 py-1 rounded border border-rose-800 text-rose-300 hover:bg-rose-950">
                  Remove
                </button>
              )}
              <button type="button" onClick={() => setForm(null)} className="px-3 py-1 rounded border border-slate-700 hover:bg-slate-800">
                Cancel
              </button>
              <button id="parts-save" className="px-3 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
