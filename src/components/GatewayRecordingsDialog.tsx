import React, { useEffect, useMemo, useState } from 'react';
import { Database, Loader2, Play, TrendingUp, X } from 'lucide-react';
import { RECORDING_KIND, type LiveRecording } from '../utils/liveRecording.ts';
import { formatDuration } from '../utils/liveView.ts';

interface DayStats {
  day: string;
  states: Record<string, { n: number; avgMs: number; medianMs: number; p90Ms: number; maxMs: number; totalMs: number }>;
}

/** A state's trend: the latest 3 days' average against the days before (null: not enough days) */
function trendOf(series: (number | null)[]): number | null {
  const vals = series.map((v, i) => ({ v, i })).filter((x) => x.v !== null) as { v: number; i: number }[];
  if (vals.length < 4) return null;
  const recent = vals.slice(-3);
  const before = vals.slice(0, -3);
  const avg = (xs: { v: number }[]) => xs.reduce((a, x) => a + x.v, 0) / xs.length;
  const b = avg(before);
  return b > 0 ? (avg(recent) - b) / b : null;
}

const tabClass = (on: boolean) =>
  `flex items-center gap-1 px-2 py-0.5 rounded border ${on ? 'bg-violet-900/60 border-violet-600 text-violet-100' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`;

/** A small line of the daily averages (gaps: days without a stay) */
const Sparkline: React.FC<{ series: (number | null)[]; days: string[]; slow: boolean }> = ({ series, days, slow }) => {
  const w = 120;
  const hgt = 22;
  const max = Math.max(...series.map((v) => v ?? 0), 1);
  const step = series.length > 1 ? w / (series.length - 1) : w;
  const pts = series.map((v, i) => (v === null ? null : [i * step, hgt - 2 - (v / max) * (hgt - 4)] as const));
  const path = pts.reduce((d, p, i) => (p ? `${d}${d && pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}` : d), '');
  return (
    <svg width={w} height={hgt} className="overflow-visible">
      <path d={path} fill="none" stroke={slow ? '#f87171' : '#38bdf8'} strokeWidth="1.5" />
      {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r="1.8" fill={slow ? '#f87171' : '#38bdf8'}><title>{`${days[i]}: ${formatDuration(series[i] ?? 0)}`}</title></circle>)}
    </svg>
  );
};

/**
 * Gateway recordings (Live tab, through a gateway): the gateway records the machines under a root all day; pick a
 * recording, a machine and a time window, and replay it on the diagram (as a saved recording). Only the state
 * variable is recorded there, not guard values.
 */

interface GatewayRecording {
  id: string;
  name: string;
  plc: string;
  plcName: string;
  root: string;
  stateVar: string;
  keepDays: number;
  days: string[];
  state: string;
  message: string;
  machines: { path: string; type: string }[];
}

interface Props {
  /** The machine's state names (this POU's enum when the machine is of its type), by value */
  stateName?: (machineType: string, value: string) => string | null;
  onClose: () => void;
  request: <T>(message: Record<string, unknown>, replyType: string) => Promise<T>;
  onReplay: (rec: LiveRecording, name: string) => void;
  /** This POU's type: its machines come first */
  pouTypeName?: string;
}

const local = (t: number) => {
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

export const GatewayRecordingsDialog: React.FC<Props> = ({ onClose, request, onReplay, pouTypeName, stateName }) => {
  const [tab, setTab] = useState<'replay' | 'trends'>('replay');
  const [trendDays, setTrendDays] = useState(14);
  const [trend, setTrend] = useState<{ machine: string; machineType: string; stateNames: Record<string, string>; days: DayStats[] } | null>(null);
  const [list, setList] = useState<GatewayRecording[] | null>(null);
  const [error, setError] = useState('');
  const [recId, setRecId] = useState('');
  const [machine, setMachine] = useState('');
  const [from, setFrom] = useState(() => local(Date.now() - 3600000));
  const [to, setTo] = useState(() => local(Date.now()));
  // "to" untouched (or a "last ..." button): now, when Replay is clicked (the field only has minutes)
  const [toIsNow, setToIsNow] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request<{ recordings: GatewayRecording[] }>({ type: 'recordingsList' }, 'recordingsList')
      .then((r) => {
        setList(r.recordings);
        if (r.recordings[0]) setRecId(r.recordings[0].id);
      })
      .catch((err: Error) => setError(err.message));
  }, [request]);

  const rec = list?.find((r) => r.id === recId) ?? null;
  const machines = useMemo(() => {
    const t = (pouTypeName ?? '').toLowerCase();
    return [...(rec?.machines ?? [])].sort((a, b) => Number((b.type.split('.').pop() ?? '').toLowerCase() === t) - Number((a.type.split('.').pop() ?? '').toLowerCase() === t) || a.path.localeCompare(b.path));
  }, [rec, pouTypeName]);
  useEffect(() => {
    if (machines.length && !machines.some((m) => m.path === machine)) setMachine(machines[0].path);
  }, [machines, machine]);

  const lastHours = (hours: number) => {
    setTo(local(Date.now()));
    setToIsNow(true);
    setFrom(local(Date.now() - hours * 3600000));
  };

  const replay = async () => {
    const f = new Date(from).getTime();
    const t = toIsNow ? Date.now() : new Date(to).getTime();
    if (!rec || !machine || !(f < t)) return setError('Choose a recording, a machine, and a time window');
    setBusy(true);
    setError('');
    try {
      const r = await request<{ values?: { t: number; value: number }[]; machineType?: string; stateVar?: string; plcName?: string; truncated?: boolean; error?: string }>(
        { type: 'recordingQuery', id: rec.id, machine, from: f, to: t },
        'recordingData'
      );
      if (r.error) throw new Error(r.error);
      if (!r.values?.length) throw new Error('No values of that machine in this time window');
      const recording: LiveRecording = {
        kind: RECORDING_KIND, version: 1, pou: r.machineType?.split('.').pop() || undefined, instance: machine, target: r.plcName, stateVar: r.stateVar || rec.stateVar,
        started: f, ended: t, values: r.values, vars: [], watched: {}, truncated: r.truncated,
      };
      onReplay(recording, `${rec.plcName} ${machine.split('.').pop()} ${from.replace('T', ' ')}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  const showTrends = async () => {
    if (!rec || !machine) return;
    setBusy(true);
    setError('');
    try {
      const r = await request<{ machine: string; machineType: string; stateNames: Record<string, string>; days: DayStats[]; error?: string }>({ type: 'recordingStats', id: rec.id, machine, days: trendDays }, 'recordingStats');
      if (r.error) throw new Error(r.error);
      setTrend(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };
  // Rows: every state seen, slowing down most first
  const trendRows = useMemo(() => {
    if (!trend) return [];
    const values = [...new Set(trend.days.flatMap((d) => Object.keys(d.states)))];
    return values
      .map((v) => {
        const series = trend.days.map((d) => d.states[v]?.avgMs ?? null);
        const n = trend.days.reduce((a, d) => a + (d.states[v]?.n ?? 0), 0);
        const total = trend.days.reduce((a, d) => a + (d.states[v]?.totalMs ?? 0), 0);
        const last = [...trend.days].reverse().find((d) => d.states[v]);
        const name = stateName?.(trend.machineType, v) ?? trend.stateNames[v] ?? `#${v}`;
        return { v, name, series, n, avg: n ? total / n : 0, lastAvg: last?.states[v].avgMs ?? 0, lastP90: last?.states[v].p90Ms ?? 0, change: trendOf(series) };
      })
      .sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity) || b.avg - a.avg);
  }, [trend, stateName]);

  return (
    <div id="gateway-recordings-overlay" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="gateway-recordings-dialog" className={`${tab === 'trends' ? 'w-[46rem]' : 'w-[34rem]'} max-w-[95vw] rounded-lg border border-slate-700 bg-slate-900 shadow-xl text-xs text-slate-200`}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
          <Database className="w-4 h-4 text-violet-300" />
          <span className="font-semibold">Gateway recordings</span>
          <div className="ml-3 flex gap-1" role="tablist">
            <button id="gw-rec-tab-replay" role="tab" aria-selected={tab === 'replay'} onClick={() => setTab('replay')} className={tabClass(tab === 'replay')}>
              <Play className="w-3 h-3" /> Replay
            </button>
            <button id="gw-rec-tab-trends" role="tab" aria-selected={tab === 'trends'} onClick={() => setTab('trends')} className={tabClass(tab === 'trends')}>
              <TrendingUp className="w-3 h-3" /> Trends
            </button>
          </div>
          <button className="ml-auto p-1 rounded hover:bg-slate-800" onClick={onClose} title="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-3 space-y-2">
          {!list && !error && (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Asking the gateway...
            </div>
          )}
          {list && list.length === 0 && <div className="text-slate-400">The gateway records nothing yet: add a recording on its setup page (Recordings).</div>}
          {list && list.length > 0 && (
            <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 items-center">
              <label className="text-slate-400" htmlFor="gw-rec-select">Recording</label>
              <select id="gw-rec-select" value={recId} onChange={(e) => setRecId(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1">
                {list.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.plcName}, {r.days.length ? `${r.days[0]} to ${r.days[r.days.length - 1]}` : 'no days yet'})
                  </option>
                ))}
              </select>
              <label className="text-slate-400" htmlFor="gw-rec-machine">Machine</label>
              <select id="gw-rec-machine" value={machine} onChange={(e) => setMachine(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 font-mono">
                {machines.map((m) => (
                  <option key={m.path} value={m.path}>
                    {m.path} ({m.type})
                  </option>
                ))}
              </select>
              {tab === 'trends' ? (
                <>
                  <label className="text-slate-400" htmlFor="gw-rec-days">Days</label>
                  <select id="gw-rec-days" value={trendDays} onChange={(e) => setTrendDays(Number(e.target.value))} className="w-24 bg-slate-950 border border-slate-700 rounded px-1.5 py-1">
                    {[7, 14, 30, 90].map((d) => (
                      <option key={d} value={d}>
                        last {d}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
              <>
              <label className="text-slate-400" htmlFor="gw-rec-from">From</label>
              <div className="flex items-center gap-1.5">
                <input id="gw-rec-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5" />
                <span className="text-slate-400">to</span>
                <input id="gw-rec-to" type="datetime-local" value={to} onChange={(e) => {
                    setTo(e.target.value);
                    setToIsNow(false);
                  }} className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5" />
              </div>
              <span />
              <div className="flex gap-1">
                {[1, 8, 24, 72].map((hrs) => (
                  <button key={hrs} className="gw-rec-window px-1.5 rounded border border-slate-700 hover:bg-slate-800" onClick={() => lastHours(hrs)}>
                    last {hrs < 24 ? `${hrs} h` : `${hrs / 24} d`}
                  </button>
                ))}
              </div>
              </>
              )}
            </div>
          )}
          {tab === 'trends' && trend && (
            <div className="max-h-80 overflow-y-auto rounded border border-slate-800">
              <table id="gw-rec-trends" className="w-full text-[11px]">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="text-slate-500 text-left">
                    <th className="font-normal px-2 py-1">State</th>
                    <th className="font-normal text-right" title="Stays in the days shown">stays</th>
                    <th className="font-normal text-right" title="Average over the days shown">average</th>
                    <th className="font-normal text-right" title="The latest day with a stay: average, 90%">latest day</th>
                    <th className="font-normal px-2" title="The daily average, oldest to newest">{trend.days.length} days</th>
                    <th className="font-normal text-right px-2" title="The latest 3 days against the days before">change</th>
                  </tr>
                </thead>
                <tbody>
                  {trendRows.map((r) => {
                    const slow = (r.change ?? 0) > 0.25;
                    return (
                      <tr key={r.v} className={`gw-rec-trend-row border-t border-slate-800 ${slow ? 'bg-rose-950/40' : ''}`} data-state={r.name}>
                        <td className="px-2 py-0.5 font-mono text-slate-200">{r.name}</td>
                        <td className="text-right font-mono text-slate-400">{r.n}</td>
                        <td className="text-right font-mono">{formatDuration(r.avg)}</td>
                        <td className="text-right font-mono text-slate-400">
                          {formatDuration(r.lastAvg)} / {formatDuration(r.lastP90)}
                        </td>
                        <td className="px-2">
                          <Sparkline series={r.series} days={trend.days.map((d) => d.day)} slow={slow} />
                        </td>
                        <td className={`gw-rec-trend-change text-right font-mono px-2 ${slow ? 'text-rose-300 font-bold' : (r.change ?? 0) < -0.25 ? 'text-emerald-300' : 'text-slate-400'}`}>
                          {r.change === null ? '-' : `${r.change > 0 ? '+' : ''}${Math.round(r.change * 100)}%`}
                        </td>
                      </tr>
                    );
                  })}
                  {!trendRows.length && (
                    <tr>
                      <td colSpan={6} className="px-2 py-2 text-slate-500">
                        No stays of this machine in these days.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {tab === 'trends' && (
            <p className="text-slate-500">Per day, the stays that ended that day. "change": the latest 3 days' average against the days before; above +25% (red) the state is getting slower, for example a wearing sensor or axis.</p>
          )}
          {rec && rec.state !== 'watching' && <div className="text-amber-300">The gateway's recording is {rec.state}: {rec.message}</div>}
          {error && <div id="gw-rec-error" className="text-rose-300">{error}</div>}
          {tab === 'replay' && <p className="text-slate-500">Only the state variable is recorded on the gateway (no guard values).</p>}
        </div>
        <div className="flex justify-end gap-2 px-3 py-2 border-t border-slate-800">
          <button className="px-3 py-1 rounded border border-slate-700 hover:bg-slate-800" onClick={onClose}>
            Cancel
          </button>
          {tab === 'replay' ? (
            <button id="gw-rec-replay" disabled={busy || !rec || !machine} onClick={() => void replay()} className="flex items-center gap-1 px-3 py-1 rounded bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-50">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Replay
            </button>
          ) : (
            <button id="gw-rec-trends-show" disabled={busy || !rec || !machine} onClick={() => void showTrends()} className="flex items-center gap-1 px-3 py-1 rounded bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-50">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />} Show trends
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
