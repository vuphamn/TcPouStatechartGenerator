import React, { useState } from 'react';
import { Archive } from 'lucide-react';
import type { GatewayConnection } from '../utils/liveGateway.ts';
import { t } from '../utils/boardLang.ts';

/** An alarm on the shelf (gateway/shelves.cjs) */
export interface Shelf {
  id: string;
  plc: string;
  plcName: string;
  machine: string;
  state: string;
  reason: string;
  by: string;
  at: number;
  until: number;
  endedAt: number | null;
  endedBy: string | null;
  ended: string | null;
}
export interface ShelvesState {
  active: Shelf[];
  recent: Shelf[];
  maxHours: number;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const short = (p: string, root: string) => (p.toLowerCase().startsWith(root.toLowerCase() + '.') ? p.slice(root.length + 1) : p);

/** The alarms on the shelf now, at the top of the alerts: each until when, by whom, why; Unshelve */
export const ShelvedList: React.FC<{ conn: GatewayConnection | null; shelves: ShelvesState | null; canUnshelve: boolean; root: string }> = ({ conn, shelves, canUnshelve, root }) => {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  if (!shelves?.active.length) return null;
  return (
    <div id="board-shelved" className="rounded border border-violet-800 bg-violet-950/40 px-3 py-1.5 text-sm">
      <button type="button" className="flex w-full items-center gap-1.5 text-violet-200" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Archive className="w-4 h-4" /> {t('{n} alarm(s) shelved', { n: shelves.active.length })}
        <span className="ml-auto text-xs text-violet-300">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ul className="mt-1 space-y-1 text-xs">
          {shelves.active.map((s) => (
            <li key={s.id} className="board-shelf flex flex-wrap items-center gap-1" data-shelf={s.id}>
              <span className="font-semibold">{short(s.machine, root)}</span>
              {s.state && <span className="text-slate-300">{s.state}</span>}
              <span className="text-slate-400">
                {t('until {time}, by {who}', { time: time(s.until), who: s.by })}: {s.reason}
              </span>
              {canUnshelve && (
                <button
                  type="button"
                  className="board-unshelve ml-auto px-1.5 rounded border border-violet-600 hover:bg-violet-900"
                  onClick={() =>
                    void conn
                      ?.request<{ ok: boolean; error?: string }>({ type: 'alarmUnshelve', id: s.id }, 'shelfResult')
                      .then((r) => setError(r.ok ? '' : r.error ?? ''))
                      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                  }
                >
                  {t('Unshelve')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <div className="text-xs text-rose-300">{error}</div>}
    </div>
  );
};

/** Shelve… on an alarm: for how long (at most the gateway's limit), why; then its alarms are muted until then */
export const ShelveButton: React.FC<{ conn: GatewayConnection | null; plc: string; machine: string; state: string; maxHours: number }> = ({ conn, plc, machine, state, maxHours }) => {
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(Math.min(4, maxHours));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const choices = [...new Set([1, 2, 4, 8, maxHours].filter((h) => h <= maxHours))].sort((a, b) => a - b);
  if (!open)
    return (
      <button type="button" className="board-alert-shelve mt-2 ml-2 px-2 py-0.5 rounded border border-violet-700 text-violet-200 hover:bg-violet-950" onClick={() => setOpen(true)} title={t('Set this alarm aside for a while, with why (ISA-18.2): its alarms muted until then')}>
        {t('Shelve…')}
      </button>
    );
  return (
    <form
      className="board-shelve-form mt-2 flex flex-wrap items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void conn
          ?.request<{ ok: boolean; error?: string }>({ type: 'alarmShelve', shelf: { plc, machine, state, hours, reason } }, 'shelfResult')
          .then((r) => {
            if (r.ok) setOpen(false);
            else setError(r.error ?? '');
          })
          .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
      }}
    >
      <select className="board-shelve-hours bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-xs" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
        {choices.map((h) => (
          <option key={h} value={h}>
            {t('{n} h', { n: h })}
          </option>
        ))}
      </select>
      <input autoFocus className="board-shelve-reason flex-1 min-w-[8rem] bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('Why (a sensor to replace, a test)')} maxLength={300} />
      <button className="board-shelve-ok px-2 rounded bg-violet-700 hover:bg-violet-600 text-xs">{t('Shelve')}</button>
      <button type="button" className="px-1 text-xs text-slate-400 hover:text-white" onClick={() => setOpen(false)}>
        ×
      </button>
      {error && <div className="w-full text-xs text-rose-300">{error}</div>}
    </form>
  );
};
