import React, { useState } from 'react';
import { Camera, Download, Trash2, X } from 'lucide-react';

export type SnapshotValue = boolean | number | string;
export interface LiveSnapshot {
  id: string;
  /** This computer's time (ms) */
  t: number;
  label: string;
  state: string | null;
  /** The values then: variable (as watched) → value */
  values: Record<string, SnapshotValue>;
}

const text = (v: SnapshotValue | undefined) => (v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));

/** Two snapshots compared: each variable either has, the ones that differ first */
export function compareSnapshots(a: LiveSnapshot, b: LiveSnapshot): { name: string; a?: SnapshotValue; b?: SnapshotValue; same: boolean }[] {
  const names = [...new Set([...Object.keys(a.values), ...Object.keys(b.values)])].sort((x, y) => x.localeCompare(y));
  const rows = names.map((name) => ({ name, a: a.values[name], b: b.values[name], same: text(a.values[name]) === text(b.values[name]) }));
  return [...rows.filter((r) => !r.same), ...rows.filter((r) => r.same)];
}

/** Snapshots as CSV: variable; then each snapshot's value (its label in the header); the state first */
export function snapshotsCsv(list: LiveSnapshot[]): string {
  const names = [...new Set(list.flatMap((s) => Object.keys(s.values)))].sort((x, y) => x.localeCompare(y));
  const esc = (s: string) => s.replace(/[;\r\n]+/g, ' ');
  return [
    ['variable', ...list.map((s) => esc(`${s.label} (${new Date(s.t).toISOString()})`))].join(';'),
    ['(state)', ...list.map((s) => esc(s.state ?? ''))].join(';'),
    ...names.map((n) => [n, ...list.map((s) => esc(text(s.values[n])))].join(';')),
  ].join('\n');
}

/**
 * Snapshots (the Live tab): the watched values and the state at a moment, kept to compare (before and after a
 * change at the machine, a good cycle and a bad one): two ticked → the variables that differ first; CSV of all
 */
export const LiveSnapshots: React.FC<{
  list: LiveSnapshot[];
  live: boolean;
  onTake: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onExport: () => void;
}> = ({ list, live, onTake, onRemove, onClear, onExport }) => {
  const [picked, setPicked] = useState<string[]>([]);
  const pair = picked.map((id) => list.find((s) => s.id === id)).filter((s): s is LiveSnapshot => !!s);
  const rows = pair.length === 2 ? compareSnapshots(pair[0], pair[1]) : [];
  return (
    <div id="live-snapshots" className="rounded border border-slate-700/70 bg-slate-900/40 px-2 py-1 text-[11px] space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-1 text-slate-300 font-semibold" title="The watched values and the state at a moment, kept to compare">
          <Camera className="w-3 h-3 text-sky-300" /> Snapshots <span className="font-normal text-slate-500">{list.length}</span>
        </span>
        <button id="live-snapshot-take" type="button" onClick={onTake} disabled={!live} className="px-1.5 py-0.5 rounded border border-sky-700 text-sky-200 hover:bg-sky-900/50 disabled:opacity-40" title="The watched values and the state now">
          Take
        </button>
        {list.length > 0 && (
          <>
            <button id="live-snapshots-csv" type="button" onClick={onExport} className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800" title="All snapshots as CSV: a column each">
              <Download className="w-3 h-3" /> CSV
            </button>
            <button id="live-snapshots-clear" type="button" onClick={() => { setPicked([]); onClear(); }} className="p-0.5 rounded text-slate-400 hover:text-rose-300" title="Remove all snapshots">
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {list.map((s) => (
            <label key={s.id} className={`live-snapshot flex items-center gap-1 pl-1 pr-0.5 rounded border font-mono text-[10px] ${picked.includes(s.id) ? 'border-sky-600 bg-sky-950/60 text-sky-100' : 'border-slate-700 text-slate-300'}`} data-id={s.id} title={`${new Date(s.t).toLocaleString()}${s.state ? `, in ${s.state}` : ''}: ${Object.keys(s.values).length} values (tick two to compare)`}>
              <input type="checkbox" className="w-3 h-3" checked={picked.includes(s.id)} onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur.filter((x) => x !== s.id), s.id].slice(-2) : cur.filter((x) => x !== s.id)))} />
              {s.label}
              <button type="button" className="text-slate-500 hover:text-white" onClick={(e) => { e.preventDefault(); setPicked((cur) => cur.filter((x) => x !== s.id)); onRemove(s.id); }} title="Remove it">
                <X className="w-3 h-3" />
              </button>
            </label>
          ))}
        </div>
      )}
      {pair.length === 2 && (
        <table id="live-snapshots-compare" className="w-full font-mono text-[10px]">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left font-normal">variable</th>
              <th className="text-left font-normal">{pair[0].label}</th>
              <th className="text-left font-normal">{pair[1].label}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="text-slate-400">
              <td>(state)</td>
              <td>{pair[0].state ?? '—'}</td>
              <td className={pair[0].state !== pair[1].state ? 'text-amber-200' : ''}>{pair[1].state ?? '—'}</td>
            </tr>
            {rows.map((r) => (
              <tr key={r.name} className={`live-snapshot-row ${r.same ? 'text-slate-500' : 'text-amber-200'}`} data-name={r.name} data-same={r.same ? 'true' : 'false'}>
                <td className="pr-2">{r.name}</td>
                <td className="pr-2">{text(r.a)}</td>
                <td>{text(r.b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
