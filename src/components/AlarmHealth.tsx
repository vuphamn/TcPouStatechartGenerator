import React, { useEffect, useState } from 'react';
import type { GatewayConnection } from '../utils/liveGateway.ts';
import { formatDuration } from '../utils/liveView.ts';

interface AlarmRow {
  plc: string;
  plcName: string;
  machine: string;
  state: string;
}
export interface AlarmHealthReport {
  from: number;
  to: number;
  total: number;
  muted: number;
  perHour: number;
  rating: 'acceptable' | 'manageable' | 'overloaded';
  peak10: { at: number | null; count: number };
  floods: { from: number; to: number; count: number }[];
  floodPct: number;
  top: (AlarmRow & { event: string; count: number; share: number })[];
  topShare: number;
  chattering: (AlarmRow & { count: number; inAMinute: number })[];
  stale: (AlarmRow & { id: string; at: number; acked: boolean })[];
  ack: { count: number; notAcked: number; medianMs: number | null; p90Ms: number | null };
  days: { day: number; count: number }[];
  error?: string;
}

const RATING = { acceptable: 'text-emerald-300', manageable: 'text-amber-300', overloaded: 'text-rose-300' } as const;
const pct = (x: number) => `${x < 10 ? x.toFixed(1) : Math.round(x)} %`;
const short = (p: string, root: string) => (root && p.toLowerCase().startsWith(`${root.toLowerCase()}.`) ? p.slice(root.length + 1) : p);

/**
 * The Risk page's Alarm health (gateway/alarmHealth.cjs), as ISA-18.2 measures an alarm system: alarms an hour against
 * its targets, the busiest 10 minutes, floods, the bad actors, chattering and stale alarms, time to acknowledge
 */
export const AlarmHealth: React.FC<{ conn: GatewayConnection | null; connected: boolean; plcIds: string[]; root: string }> = ({ conn, connected, plcIds, root }) => {
  const [days, setDays] = useState(7);
  const [r, setR] = useState<AlarmHealthReport | null>(null);
  const plcKey = plcIds.join();
  useEffect(() => {
    if (!conn || !connected) return;
    setR(null);
    void conn.request<AlarmHealthReport>({ type: 'alarmHealth', days, plcs: plcKey ? plcKey.split(',') : [] }, 'alarmHealthResult', 60000).then(setR).catch((e: unknown) => setR({ error: e instanceof Error ? e.message : String(e) } as AlarmHealthReport));
  }, [conn, connected, days, plcKey]);
  const max = Math.max(1, ...(r?.days ?? []).map((d) => d.count));
  const kpi = (id: string, label: string, value: React.ReactNode, sub: React.ReactNode, cls = '') => (
    <div className="alarm-kpi rounded-lg border border-slate-800 bg-slate-900 px-4 py-2" data-kpi={id}>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-2xl font-bold ${cls}`}>{value}</div>
      <div className="text-xs text-slate-400">{sub}</div>
    </div>
  );
  return (
    <div id="alarm-health" className="space-y-4 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-slate-400">The alert history, as ISA-18.2 measures an alarm system, over the last</span>
        <select id="alarm-days" value={days} onChange={(e) => setDays(Number(e.target.value))} className="bg-slate-900 border border-slate-700 rounded px-2 py-1">
          <option value={1}>24 hours</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
        </select>
      </div>
      {r?.error && <div className="text-rose-300">{r.error}</div>}
      {!r && <div className="text-slate-400">Counting…</div>}
      {r && !r.error && (
        <>
          <div className="flex flex-wrap gap-3">
            {kpi('rate', 'Alarms an hour', r.perHour.toFixed(1), <span>{r.total} alarms; target about 6, over 12 overloaded</span>, RATING[r.rating])}
            {kpi('peak', 'Busiest 10 minutes', r.peak10.count, r.peak10.at ? new Date(r.peak10.at).toLocaleString() : '—', r.peak10.count > 10 ? 'text-rose-300' : '')}
            {kpi('flood', 'In flood', pct(r.floodPct), <span>{r.floods.length} flood{r.floods.length === 1 ? '' : 's'} (over 10 in 10 min); target under 1 %</span>, r.floodPct >= 1 ? 'text-rose-300' : 'text-emerald-300')}
            {kpi('top', 'Top 10 alarms', pct(r.topShare * 100), 'of all alarms: the bad actors', r.topShare > 0.5 ? 'text-amber-300' : '')}
            {kpi('stale', 'Stale', r.stale.length, 'open over 24 hours', r.stale.length ? 'text-amber-300' : 'text-emerald-300')}
            {kpi('ack', 'Acknowledged in', r.ack.medianMs === null ? '—' : formatDuration(r.ack.medianMs), <span>median; 90 % in {r.ack.p90Ms === null ? '—' : formatDuration(r.ack.p90Ms)}; {r.ack.notAcked} not acknowledged</span>)}
          </div>
          <div className="rating text-base">
            The alarm load is <b className={RATING[r.rating]}>{r.rating}</b>
            {r.muted > 0 && <span className="text-slate-400"> · {r.muted} more muted in maintenance windows</span>}
          </div>
          {r.days.length > 1 && (
            <div className="rounded border border-slate-800 bg-slate-900 p-3">
              <div className="mb-2 font-semibold">By day</div>
              <div id="alarm-days-chart" className="flex items-end gap-1 h-24">
                {r.days.map((d) => (
                  <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full" title={`${new Date(d.day).toLocaleDateString()}: ${d.count}`}>
                    <div className={`w-full rounded-t ${d.count / 24 > 12 ? 'bg-rose-600' : d.count / 24 > 6 ? 'bg-amber-500' : 'bg-sky-600'}`} style={{ height: `${(d.count / max) * 100}%` }} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded border border-slate-800 bg-slate-900 p-3">
              <div className="mb-2 font-semibold">Bad actors (the alarms raised most)</div>
              {!r.top.length && <div className="text-slate-400">No alarms.</div>}
              <table id="alarm-top" className="w-full text-xs">
                <tbody>
                  {r.top.map((a) => (
                    <tr key={`${a.plc}|${a.machine}|${a.state}`} className="alarm-top border-t border-slate-800">
                      <td className="py-1">{short(a.machine, root)} <span className="text-slate-500">{a.plcName}</span></td>
                      <td className="text-slate-300">{a.state}</td>
                      <td className="text-right font-mono">{a.count}</td>
                      <td className="text-right font-mono text-slate-400">{pct(a.share * 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded border border-slate-800 bg-slate-900 p-3 space-y-3">
              <div>
                <div className="mb-1 font-semibold">Chattering (3 or more within a minute)</div>
                {!r.chattering.length ? (
                  <div className="text-slate-400">None.</div>
                ) : (
                  <ul id="alarm-chatter" className="text-xs space-y-0.5">
                    {r.chattering.map((a) => (
                      <li key={`${a.plc}|${a.machine}|${a.state}`} className="alarm-chatter">
                        {short(a.machine, root)} {a.state}: <b className="text-amber-300">{a.inAMinute}</b> in a minute, {a.count} in all <span className="text-slate-500">(a delay or a deadband on it, in the PLC)</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="mb-1 font-semibold">Stale (open over 24 hours)</div>
                {!r.stale.length ? (
                  <div className="text-slate-400">None.</div>
                ) : (
                  <ul id="alarm-stale" className="text-xs space-y-0.5">
                    {r.stale.map((a) => (
                      <li key={a.id} className="alarm-stale">
                        {short(a.machine, root)} {a.state} <span className="text-slate-500">({a.plcName}) since {new Date(a.at).toLocaleString()}{a.acked ? ', acknowledged' : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {r.floods.length > 0 && (
                <div>
                  <div className="mb-1 font-semibold">Floods</div>
                  <ul className="text-xs space-y-0.5">
                    {r.floods.slice(-10).map((f) => (
                      <li key={f.from}>
                        {new Date(f.from).toLocaleString()}: {f.count} alarms in {Math.round((f.to - f.from) / 60000)} min
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
