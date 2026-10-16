import React, { useState } from 'react';
import { History } from 'lucide-react';
import type { GatewayConnection } from '../utils/liveGateway.ts';
import { formatDuration } from '../utils/liveView.ts';
import { t } from '../utils/boardLang.ts';

/** What the gateway knows of a machine in a state (gateway/lastTime.cjs) */
export interface LastTimeInfo {
  before: { count: number; days: number; last: { at: string; resolvedAt: string | null; ack: { by: string; note: string } | null } | null; recoverMs: number | null };
  orders: { id: string; number: number; title: string; rootCause: string; parts: string; doneAt: string; by: string | null; sameState: boolean; photos: number }[];
  causes: { cause: string; count: number }[];
  guide: { id: string; title: string; steps: number } | null;
  faults: number;
}

const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

/**
 * "Last time this happened" on an alert: a button; opened, the same machine in the same state before (how often in
 * 90 days, the last time, how long it took to recover, its note), the work orders done on it with their root causes,
 * its recovery guide, its earlier fault records
 */
export const LastTime: React.FC<{ conn: GatewayConnection | null; plc: string; machine: string; state: string; machineType?: string; at: number; alertId?: string; onOrder?: (id: string) => void; onGuide?: () => void }> = ({ conn, plc, machine, state, machineType, at, alertId, onOrder, onGuide }) => {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<LastTimeInfo | null>(null);
  const [error, setError] = useState('');
  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (info || !conn) return;
    try {
      const r = await conn.request<{ ok: boolean; error?: string } & Partial<LastTimeInfo>>({ type: 'lastTime', plc, machine, state, machineType, at, alertId }, 'lastTimeResult');
      if (!r.ok || !r.before) setError(r.error ?? t('Not answered'));
      else setInfo(r as LastTimeInfo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const b = info?.before;
  return (
    <>
      <button type="button" className="board-alert-last mt-2 ml-2 px-2 py-0.5 rounded border border-slate-600 hover:bg-slate-800 inline-flex items-center gap-1" onClick={() => void toggle()} aria-expanded={open} title={t('What happened the last times: its work orders, their root causes, its guide')}>
        <History className="w-3.5 h-3.5" /> {t('Last time')}
      </button>
      {open && (
        <div className="board-last-time mt-2 rounded border border-slate-700 bg-slate-950/70 px-2 py-1.5 text-xs space-y-1">
          {error && <div className="text-rose-300">{error}</div>}
          {!info && !error && <div className="text-slate-400">…</div>}
          {info && b && (
            <>
              <div className="board-last-before">
                {b.count
                  ? t('{n}× in the last {days} days; last {when}', { n: b.count, days: b.days, when: b.last ? day(b.last.at) : '' }) + (b.recoverMs !== null ? ` · ${t('recovered in {d}', { d: formatDuration(b.recoverMs) })}` : '') + (b.last?.ack?.note ? ` · ${b.last.ack.by}: “${b.last.ack.note}”` : '')
                  : t('Not seen in the last {days} days', { days: b.days })}
              </div>
              {info.orders.map((o) => (
                <div key={o.id} className="board-last-order">
                  <button type="button" className="underline decoration-dotted hover:text-white" onClick={() => onOrder?.(o.id)} disabled={!onOrder}>
                    #{o.number}
                  </button>{' '}
                  {day(o.doneAt)}
                  {o.by ? ` · ${o.by}` : ''}: <b>{o.rootCause}</b>
                  {o.parts ? ` (${o.parts})` : ''}
                  {o.photos ? ` · 📎 ${o.photos}` : ''}
                </div>
              ))}
              {!info.orders.length && <div className="text-slate-500">{t('No work order done on it yet')}</div>}
              {info.causes.length > 1 && <div className="text-slate-400">{t('Its root causes')}: {info.causes.map((c) => `${c.cause} (${c.count})`).join(', ')}</div>}
              {info.guide && (
                <div className="board-last-guide">
                  {t('Its guide')}:{' '}
                  <button type="button" className="underline decoration-dotted hover:text-white" onClick={() => onGuide?.()} disabled={!onGuide}>
                    {info.guide.title}
                  </button>{' '}
                  ({t('{n} steps', { n: info.guide.steps })})
                </div>
              )}
              {info.faults > 0 && <div className="text-slate-400">{t('{n} earlier fault record(s)', { n: info.faults })}</div>}
            </>
          )}
        </div>
      )}
    </>
  );
};
