import React, { useEffect, useState } from 'react';
import { Handshake, X } from 'lucide-react';
import type { GatewayConnection } from '../utils/liveGateway.ts';
import { formatDuration } from '../utils/liveView.ts';
import { t } from '../utils/boardLang.ts';

/** A summary of a shift, as the gateway makes it (gateway/handover.cjs) */
export interface HandoverSummary {
  from: number;
  to: number;
  alerts: { total: number; counts: Record<string, number>; machines: { plcName: string; machine: string; count: number }[] };
  stops: { count: number; downMs: number; availability: number | null; oee: number | null; reasons: { reason: string; ms: number; count: number }[]; noReason: number } | null;
  work: Record<'opened' | 'done' | 'open', { id: string; number: number; title: string; priority: string; status: string; plcName: string | null; machine: string | null; assignee: string | null }[]>;
  drives: { plcName: string; name: string; level: string; text: string }[];
  open: { id: string; at: string; plcName: string; machine: string; text: string; ack: boolean }[];
}
export interface Handover {
  id: string;
  shift: string;
  from: number;
  to: number;
  at: number;
  by: string;
  note: string;
  summary: HandoverSummary;
  reads: { by: string; at: number }[];
}

/** The latest handover this user has still to read (not their own) */
export const unreadHandover = (list: Handover[], me: string) => {
  const h = list[0];
  return h && h.by !== me && !h.reads.some((r) => r.by === me) ? h : null;
};

const time = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)} %`);
const short = (path: string, root: string) => (root && path.toLowerCase().startsWith(`${root.toLowerCase()}.`) ? path.slice(root.length + 1) : path);
const KINDS: Record<string, string> = { error: 'errors', stuck: 'stuck', plcStopped: 'PLC stopped', drive: 'drives', slower: 'slower', call: 'calls', workorder: 'work orders' };

function SummaryView({ s, root }: { s: HandoverSummary; root: string }) {
  const kinds = Object.entries(s.alerts.counts).map(([k, n]) => `${n} ${t(KINDS[k] ?? k)}`).join(', ');
  return (
    <div className="handover-summary space-y-2 text-sm">
      <div data-part="alerts">
        <b>{t(s.alerts.total === 1 ? '{n} alert' : '{n} alerts', { n: s.alerts.total })}</b>
        {kinds && <span className="text-slate-400"> ({kinds})</span>}
        {s.alerts.machines.length > 0 && <span className="text-slate-400">; {t('most')}: {s.alerts.machines.map((m) => `${short(m.machine, root) || m.plcName} ${m.count}`).join(', ')}</span>}
      </div>
      {s.stops && (
        <div data-part="stops">
          <b>{t(s.stops.count === 1 ? '{n} stop' : '{n} stops', { n: s.stops.count })}</b>, {t('{t} down', { t: formatDuration(s.stops.downMs) })} · {t('availability {a}, OEE {o}', { a: pct(s.stops.availability), o: pct(s.stops.oee) })}
          {s.stops.reasons.length > 0 && <span className="text-slate-400">; {s.stops.reasons.map((r) => `${t(r.reason)} ${formatDuration(r.ms)}`).join(', ')}</span>}
          {s.stops.noReason > 0 && <span className="text-amber-300"> · {t('{n} without a reason', { n: s.stops.noReason })}</span>}
        </div>
      )}
      <div data-part="work">
        {t('Work orders: {opened} opened, {done} done, {open} open', { opened: s.work.opened.length, done: s.work.done.length, open: s.work.open.length })}
        {s.work.open.length > 0 && (
          <ul className="ml-4 list-disc text-slate-300">
            {s.work.open.slice(0, 8).map((o) => (
              <li key={o.id}>
                #{o.number} {o.title} <span className={o.priority === 'urgent' ? 'text-rose-300' : o.priority === 'high' ? 'text-amber-300' : 'text-slate-400'}>({o.priority}{o.assignee ? `, ${o.assignee}` : ''})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {s.drives.length > 0 && (
        <div data-part="drives">
          <b>{t('Drives to watch:')}</b>
          <ul className="ml-4 list-disc text-slate-300">
            {s.drives.map((d) => (
              <li key={`${d.plcName}|${d.name}`}>
                <span className={d.level === 'alarm' ? 'text-rose-300' : 'text-amber-300'}>{d.name}</span> <span className="text-slate-400">({d.plcName})</span> {d.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.open.length > 0 && (
        <div data-part="open">
          <b>{t('Still open:')}</b>
          <ul className="ml-4 list-disc text-slate-300">
            {s.open.slice(0, 8).map((a) => (
              <li key={a.id}>
                {a.text} {!a.ack && <span className="text-rose-300">{t('(not acknowledged)')}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Shift handover (the board's header): the last handover (read it), the shift so far as the gateway sums it up, a
 * note, and Hand over; earlier ones
 */
export function HandoverDialog({ conn, list, me, root, plcIds, canWrite, onClose }: { conn: GatewayConnection | null; list: Handover[]; me: string; root: string; plcIds: string[]; canWrite: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState<{ shift: { name: string; from: number; to: number }; summary: HandoverSummary } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const plcKey = plcIds.join();
  useEffect(() => {
    let live = true;
    void conn
      ?.request<{ shift: { name: string; from: number; to: number }; summary: HandoverSummary }>({ type: 'handoverDraft', plcs: plcKey ? plcKey.split(',') : [] }, 'handoverDraftResult', 30000)
      .then((r) => live && setDraft(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [conn, plcKey]);
  const last = list[0] ?? null;
  const unread = unreadHandover(list, me);
  const read = async (id: string) => {
    await conn?.request({ type: 'handoverRead', id }, 'handoverResult', 15000).catch(() => undefined);
  };
  const handOver = async () => {
    setBusy(true);
    setMsg(null);
    type R = { ok: boolean; error?: string; message?: string };
    const r: R | undefined = await conn?.request<R>({ type: 'handoverSave', note, plcs: plcIds }, 'handoverResult', 30000).catch((e: unknown): R => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    setBusy(false);
    if (r?.ok) {
      setNote('');
      setMsg({ text: t('Handed over: the next shift sees it on the board'), ok: true });
    } else setMsg({ text: r?.error ?? r?.message ?? t('Not handed over'), ok: false });
  };
  const view = list.find((h) => h.id === shown) ?? last;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="board-handover-dialog" className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm space-y-4 shadow-2xl" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="flex items-center gap-2 text-base font-semibold">
          <Handshake className="w-5 h-5 text-sky-300" /> {t('Shift handover')}
          <button type="button" onClick={onClose} className="ml-auto p-1 rounded text-slate-400 hover:text-white" title={t('Close')}>
            <X className="w-4 h-4" />
          </button>
        </div>
        {view ? (
          <section id="handover-last" className={`rounded border p-3 space-y-2 ${unread && view.id === unread.id ? 'border-amber-600 bg-amber-950/30' : 'border-slate-700'}`} data-id={view.id}>
            <div className="flex flex-wrap items-center gap-2">
              <b>{t(view.shift)}</b>
              <span className="text-slate-400">
                {time(view.from)} – {time(view.to)} · {t('handed over by {who}', { who: view.by })}
              </span>
              {list.length > 1 && (
                <select value={view.id} onChange={(e) => setShown(e.target.value)} className="ml-auto bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-xs" title={t('Earlier handovers')}>
                  {list.map((h) => (
                    <option key={h.id} value={h.id}>
                      {t(h.shift)}, {time(h.at)} ({h.by})
                    </option>
                  ))}
                </select>
              )}
            </div>
            {view.note && <div id="handover-note-shown" className="whitespace-pre-wrap rounded bg-slate-950 border border-slate-800 p-2 select-text">{view.note}</div>}
            <SummaryView s={view.summary} root={root} />
            <div className="flex items-center gap-2 text-xs text-slate-400">
              {view.reads.length ? t('Read by {who}', { who: view.reads.map((r) => r.by).join(', ') }) : t('Not read yet')}
              {unread && view.id === unread.id && (
                <button id="handover-read" type="button" onClick={() => void read(view.id)} className="ml-auto px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-sm">
                  {t('Read it')}
                </button>
              )}
            </div>
          </section>
        ) : (
          <div className="text-slate-400">{t('No shift handed over yet.')}</div>
        )}
        <section id="handover-now" className="rounded border border-slate-700 p-3 space-y-2">
          <div>
            <b>{draft ? t(draft.shift.name) : t('This shift')}</b> <span className="text-slate-400">{draft ? `${time(draft.shift.from)} – ${t('now')}` : t('summing up…')}</span>
          </div>
          {draft && <SummaryView s={draft.summary} root={root} />}
          {canWrite ? (
            <>
              <textarea id="handover-note" value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder={t('For the next shift: what is running, what to watch, what is waiting (parts, a call back, a test)…')} className="w-full rounded bg-slate-950 border border-slate-700 p-2 select-text" />
              <div className="flex items-center gap-2">
                {msg && <span id="handover-msg" className={msg.ok ? 'text-emerald-300' : 'text-rose-300'}>{msg.text}</span>}
                <button id="handover-save" type="button" disabled={busy} onClick={() => void handOver()} className="ml-auto px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-50">
                  {t('Hand over')}
                </button>
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-500">{t('Your role may read handovers, not write them.')}</div>
          )}
        </section>
      </div>
    </div>
  );
}
