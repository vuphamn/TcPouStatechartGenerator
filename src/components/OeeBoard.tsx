import React, { useEffect, useState } from 'react';
import { BarChart3, Download, Printer } from 'lucide-react';
import type { GatewayConnection } from '../utils/liveGateway.ts';

interface OeeMachine {
  plc: string;
  plcName: string;
  machine: string;
  type: string;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  good?: number | null;
  bad?: number | null;
  oee: number | null;
  cycles: number | null;
  idealCycleSec: number | null;
  runMs: number;
  plannedMs: number;
  downMs: number;
  stops: number;
}
interface OeeStop {
  plcName: string;
  machine: string;
  state: string;
  kind: 'error' | 'stuck';
  from: number;
  to: number;
  ms: number;
  reason: string | null;
  note: string;
  by: string | null;
}
interface Line {
  availability: number | null;
  performance: number | null;
  quality: number | null;
  good?: number | null;
  bad?: number | null;
  oee: number | null;
  downMs: number;
  stops: number;
}
interface OeeReport {
  from: number;
  to: number;
  by: string;
  line: Line;
  machines: OeeMachine[];
  stops: OeeStop[];
  pareto: Record<'reason' | 'machine' | 'state', { key: string; ms: number; count: number }[]>;
  windows: (Line & { label: string; from: number; to: number })[];
  recorded: number;
  error?: string;
}

const WINDOWS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'Last 30 days' },
];
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)} %`);
const dur = (ms: number) => (ms < 60000 ? `${Math.round(ms / 1000)} s` : ms < 3600000 ? `${Math.round(ms / 60000)} min` : `${(ms / 3600000).toFixed(1)} h`);
const short = (p: string, root: string) => (p.toLowerCase().startsWith(root.toLowerCase() + '.') ? p.slice(root.length + 1) : p);
const windowOf = (id: string) => {
  const now = Date.now();
  const midnight = new Date(new Date().toDateString()).getTime();
  if (id === 'yesterday') return { from: midnight - 86400000, to: midnight };
  if (id === 'week') return { from: now - 7 * 86400000, to: now };
  if (id === 'month') return { from: now - 30 * 86400000, to: now };
  return { from: midnight, to: now };
};

const Bar: React.FC<{ value: number | null }> = ({ value }) => (
  <div className="relative h-3 w-24 rounded bg-slate-800 overflow-hidden" title={pct(value)}>
    {value !== null && <div className={`absolute inset-y-0 left-0 ${value >= 0.85 ? 'bg-emerald-500' : value >= 0.6 ? 'bg-amber-400' : 'bg-rose-500'}`} style={{ width: `${Math.round(value * 100)}%` }} />}
  </div>
);

const Pareto: React.FC<{ title: string; rows: { key: string; ms: number; count: number }[]; label?: (k: string) => string }> = ({ title, rows, label }) => {
  const max = Math.max(1, ...rows.map((r) => r.ms));
  const total = rows.reduce((a, r) => a + r.ms, 0) || 1;
  let acc = 0;
  return (
    <div className="oee-pareto rounded border border-slate-800 bg-slate-900 p-3" data-pareto={title}>
      <div className="mb-2 font-semibold">{title}</div>
      {!rows.length && <div className="text-xs text-slate-500">No downtime</div>}
      {rows.slice(0, 10).map((r) => {
        acc += r.ms;
        return (
          <div key={r.key} className="flex items-center gap-2 text-xs py-0.5">
            <span className="w-40 shrink-0 truncate" title={r.key}>{label ? label(r.key) : r.key}</span>
            <div className="flex-1 h-3 rounded bg-slate-800 overflow-hidden">
              <div className="h-full bg-rose-500/80" style={{ width: `${(r.ms / max) * 100}%` }} />
            </div>
            <span className="w-28 shrink-0 text-right font-mono">{dur(r.ms)} · {r.count}×</span>
            <span className="w-10 shrink-0 text-right text-slate-500" title="Of all the downtime, with the ones above">{Math.round((acc / total) * 100)}%</span>
          </div>
        );
      })}
    </div>
  );
};

/**
 * The board's OEE page, for production and office managers: from the gateway's recordings (gateway/oee.cjs), over a
 * window (today, yesterday, 7 or 30 days), the line's availability, performance (where a machine's cycle is set) and
 * OEE, each machine's, the downtime's Pareto by the reasons operators gave, by machine and by state, the shifts (or
 * days) side by side, and the stops with their reasons. CSV, and a page to print or save as PDF.
 */
export const OeeBoard: React.FC<{ conn: GatewayConnection | null; connected: boolean; plcIds: string[]; root: string; narrow: boolean }> = ({ conn, connected, plcIds, root, narrow }) => {
  const [win, setWin] = useState(() => new URLSearchParams(window.location.search).get('window') ?? 'today');
  const [by, setBy] = useState<'shift' | 'day' | 'total'>('shift');
  const [r, setR] = useState<OeeReport | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!connected || !conn) return;
    let gone = false;
    setBusy(true);
    const w = windowOf(win);
    void conn
      .request<OeeReport>({ type: 'oeeReport', ...w, plcs: plcIds, by: win === 'month' && by === 'shift' ? 'day' : by }, 'oeeReportResult', 120000)
      .then((x) => !gone && setR(x))
      .catch((e: unknown) => !gone && setR({ error: e instanceof Error ? e.message : String(e) } as OeeReport))
      .finally(() => !gone && setBusy(false));
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, conn, win, by, plcIds.join(',')]);
  const csv = () => {
    if (!r?.machines) return;
    const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = ['plc,machine,availability,performance,quality,good,bad,oee,cycles,run h,down h,stops', ...r.machines.map((m) => [q(m.plcName), q(m.machine), m.availability ?? '', m.performance ?? '', m.quality ?? '', m.good ?? '', m.bad ?? '', m.oee ?? '', m.cycles ?? '', (m.runMs / 3600000).toFixed(2), (m.downMs / 3600000).toFixed(2), m.stops].join(',')), '', 'stop from,to,minutes,plc,machine,state,kind,reason,note,by', ...r.stops.map((s) => [new Date(s.from).toISOString(), new Date(s.to).toISOString(), (s.ms / 60000).toFixed(1), q(s.plcName), q(s.machine), q(s.state), s.kind, q(s.reason ?? ''), q(s.note), q(s.by ?? '')].join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\r\n') + '\r\n'], { type: 'text/csv' }));
    a.download = `oee-${win}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  return (
    <div id="oee-board" className="flex-1 min-h-0 flex flex-col">
      <div className={`oee-toolbar flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/60 ${narrow ? 'px-2 py-1.5' : 'px-4 py-2'}`}>
        <BarChart3 className="w-4 h-4 text-sky-400" />
        {WINDOWS.map((w) => (
          <button key={w.id} type="button" onClick={() => setWin(w.id)} className={`oee-window px-2 py-1 rounded border text-sm ${win === w.id ? 'border-sky-500 bg-sky-900/60 text-sky-100' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`} data-window={w.id}>
            {w.label}
          </button>
        ))}
        <select value={by} onChange={(e) => setBy(e.target.value as 'shift' | 'day' | 'total')} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm" title="Side by side">
          <option value="shift">by shift</option>
          <option value="day">by day</option>
          <option value="total">in total</option>
        </select>
        {busy && <span className="text-xs text-slate-400">reading the recordings…</span>}
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={csv} className="p-1 rounded hover:bg-slate-800" title="CSV: the machines and the stops">
            <Download className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => window.print()} className="p-1 rounded hover:bg-slate-800" title="Print, or save as PDF">
            <Printer className="w-4 h-4" />
          </button>
        </span>
      </div>
      <div className={`flex-1 min-h-0 overflow-y-auto ${narrow ? 'p-2 space-y-3' : 'p-4 space-y-4'}`}>
        {r?.error && <div className="px-4 py-2 rounded bg-rose-950 border border-rose-800 text-rose-200">{r.error}</div>}
        {r && !r.error && !r.recorded && <div className="text-slate-400">No recordings yet: OEE comes from the gateway's recordings. On the Machines page, Select the machines and Record… them.</div>}
        {r && !r.error && r.recorded > 0 && (
          <>
            <div id="oee-line" className="flex flex-wrap gap-3">
              {(
                [
                  ['OEE', r.line.oee],
                  ['Availability', r.line.availability],
                  ['Performance', r.line.performance],
                  ['Quality', r.line.quality],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="oee-kpi rounded-lg border border-slate-800 bg-slate-900 px-4 py-2" data-kpi={k}>
                  <div className="text-xs uppercase tracking-wide text-slate-400">{k}</div>
                  <div className={`text-3xl font-bold ${v === null ? 'text-slate-500' : v >= 0.85 ? 'text-emerald-300' : v >= 0.6 ? 'text-amber-300' : 'text-rose-300'}`} title={k === 'Quality' && v === null ? 'Set the good and bad part counters of a machine (the setup page: Monitoring, OEE)' : undefined}>{pct(v)}</div>
                  {k === 'Quality' && r.line.good != null && <div className="text-xs text-slate-400">{r.line.good} good{r.line.bad != null ? `, ${r.line.bad} bad` : ''}</div>}
                </div>
              ))}
              <div className="oee-kpi rounded-lg border border-slate-800 bg-slate-900 px-4 py-2" data-kpi="down">
                <div className="text-xs uppercase tracking-wide text-slate-400">Down</div>
                <div className="text-3xl font-bold text-rose-300">{dur(r.line.downMs)}</div>
                <div className="text-xs text-slate-400">{r.line.stops} stops</div>
              </div>
            </div>
            {r.windows.length > 0 && (
              <div className="rounded border border-slate-800 bg-slate-900 p-3 overflow-x-auto">
                <div className="mb-2 font-semibold">{r.by === 'day' ? 'By day' : 'By shift'}</div>
                <table id="oee-windows" className="text-xs">
                  <tbody>
                    {(['oee', 'availability', 'performance', 'quality'] as const).map((k) => (
                      <tr key={k}>
                        <th className="pr-3 text-left text-slate-400 capitalize">{k === 'oee' ? 'OEE' : k}</th>
                        {r.windows.map((w) => (
                          <td key={w.label} className="px-1">
                            <Bar value={w[k]} />
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <th className="pr-3 text-left text-slate-400">Down</th>
                      {r.windows.map((w) => (
                        <td key={w.label} className="px-1 font-mono text-rose-300">{dur(w.downMs)}</td>
                      ))}
                    </tr>
                    <tr>
                      <th />
                      {r.windows.map((w) => (
                        <td key={w.label} className="oee-window-label px-1 text-slate-400 whitespace-nowrap">{w.label}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <div className="grid gap-3 lg:grid-cols-3">
              <Pareto title="Downtime by reason" rows={r.pareto.reason} />
              <Pareto title="By machine" rows={r.pareto.machine} label={(k) => short(k, root)} />
              <Pareto title="By state" rows={r.pareto.state} />
            </div>
            <table id="oee-machines" className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1">Machine</th>
                  <th>OEE</th>
                  <th>Availability</th>
                  <th>Performance</th>
                  <th>Quality</th>
                  <th className="text-right">Cycles</th>
                  <th className="text-right">Down</th>
                  <th className="text-right">Stops</th>
                </tr>
              </thead>
              <tbody>
                {r.machines.map((m) => (
                  <tr key={`${m.plc}|${m.machine}`} className="oee-machine border-t border-slate-800" data-machine={m.machine}>
                    <td className="py-1">
                      {short(m.machine, root)} <span className="text-xs text-slate-500">{m.plcName}</span>
                    </td>
                    <td><span className="flex items-center gap-2"><Bar value={m.oee} /> {pct(m.oee)}</span></td>
                    <td><span className="flex items-center gap-2"><Bar value={m.availability} /> {pct(m.availability)}</span></td>
                    <td title={m.performance === null ? 'Set its cycle state and ideal cycle time (config.oee.machines)' : `${m.cycles} cycles of ${m.idealCycleSec} s`}>{pct(m.performance)}</td>
                    <td className="oee-quality" title={m.quality === null ? 'Set its good and bad part counters (the setup page: Monitoring, OEE)' : `${m.good ?? '?'} good, ${m.bad ?? '?'} bad`}>{pct(m.quality)}</td>
                    <td className="text-right font-mono">{m.cycles ?? ''}</td>
                    <td className="text-right font-mono">{dur(m.downMs)}</td>
                    <td className="text-right font-mono">{m.stops}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <div className="mb-1 font-semibold">Stops</div>
              <table id="oee-stops" className="w-full text-xs">
                <tbody>
                  {r.stops.slice(0, 200).map((s, i) => (
                    <tr key={i} className="oee-stop border-t border-slate-800">
                      <td className="py-0.5 font-mono text-slate-400 whitespace-nowrap">{new Date(s.from).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="font-mono">{dur(s.ms)}</td>
                      <td>{short(s.machine, root)}</td>
                      <td className={s.kind === 'error' ? 'text-rose-300' : 'text-amber-300'}>{s.state}</td>
                      <td className={s.reason ? '' : 'text-slate-500'}>{s.reason ?? 'no reason given'}{s.note ? ` — ${s.note}` : ''}{s.by ? ` (${s.by})` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
