import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Gauge, HeartPulse, Search, Thermometer, X, Zap } from 'lucide-react';
import type { GatewayConnection } from '../utils/liveGateway.ts';

/** The gateway's drive monitor as the board gets it (gateway/drives.cjs view()) */
export interface DriveView {
  path: string;
  name: string;
  box: string;
  device: string;
  netId: string;
  address: number;
  profile: string;
  vendor: string;
  product: string;
  firmware: string;
  latest: Record<string, { v: number | null; error?: string }>;
  health: { level: 'ok' | 'watch' | 'warn' | 'alarm' | 'unknown'; score: number | null; findings: { level: string; key: string | null; text: string }[]; baseline: Record<string, number> } | null;
  today: Record<string, { median: number; p90?: number; max?: number; n: number }> | null;
  spark: Record<string, { t: number; v: number }[]>;
  notAnswering: boolean;
}
interface DrivePlc {
  id: string;
  name: string;
  state: string;
  message: string;
  lastRound: number | null;
  drives: DriveView[];
}
interface ParamInfo {
  key: string;
  label: string;
  unit: string;
  verified: boolean;
  format?: string;
  counter?: boolean;
  slow?: boolean;
  trend?: boolean;
}
type Msg = { type: string; plcs?: DrivePlc[]; params?: Record<string, { name: string; params: ParamInfo[] }>; error?: string };

const LEVEL = {
  alarm: { text: 'Alarm', cls: 'bg-rose-700 text-white', border: 'border-rose-500' },
  warn: { text: 'Warning', cls: 'bg-amber-500 text-slate-950', border: 'border-amber-400' },
  watch: { text: 'Watch', cls: 'bg-sky-700 text-white', border: 'border-sky-600' },
  ok: { text: 'Healthy', cls: 'bg-emerald-800 text-emerald-100', border: 'border-emerald-900' },
  unknown: { text: 'Not read', cls: 'bg-slate-700 text-slate-200', border: 'border-slate-700' },
} as const;
const RANK = { alarm: 0, warn: 1, watch: 2, unknown: 3, ok: 4 } as const;
const RANGES = [
  { label: '24 h', ms: 24 * 3600_000 },
  { label: '7 days', ms: 7 * 86400_000 },
  { label: '30 days', ms: 30 * 86400_000 },
];
const CHART_KEYS = ['heatsink', 'current', 'currentPct', 'torque', 'dcBus', 'freq', 'velocity', 'motorI2t', 'deviceIxt'];
const FILTER_KEY = 'kss.drives.filter';

const num = (v: number | null | undefined, unit = '', d = 1) => (typeof v === 'number' ? `${Math.round(v * 10 ** d) / 10 ** d}${unit ? ` ${unit}` : ''}` : '—');
const shown = (p: ParamInfo | undefined, x: { v: number | null; error?: string } | undefined) => {
  if (!x) return '—';
  if (x.error) return 'n/a';
  if (typeof x.v !== 'number') return '—';
  if (p?.format === 'hex') return x.v ? `0x${x.v.toString(16).toUpperCase().padStart(4, '0')}` : '0';
  const d = p?.unit === 'h' || p?.counter ? 0 : Math.abs(x.v) >= 100 ? 0 : 1;
  return `${p?.verified === false ? '≈' : ''}${num(x.v, p?.unit, d)}`;
};

/** A small line of 24 hours (15-minute averages) */
const Spark: React.FC<{ points: { t: number; v: number }[]; color: string }> = ({ points, color }) => {
  if (points.length < 2) return <svg width={90} height={18} />;
  const lo = Math.min(...points.map((p) => p.v));
  const hi = Math.max(...points.map((p) => p.v));
  const t0 = points[0].t;
  const span = Math.max(1, points[points.length - 1].t - t0);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(((p.t - t0) / span) * 88 + 1).toFixed(1)},${(17 - ((p.v - lo) / (hi - lo || 1)) * 16).toFixed(1)}`).join('');
  return (
    <svg width={90} height={18}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.3} />
    </svg>
  );
};

/** A key's history over the range, its baseline (dashed) and limit (red) */
const Chart: React.FC<{ label: string; unit: string; points: { t: number; v: number }[]; from: number; to: number; baseline?: number; limit?: number | null }> = ({ label, unit, points, from, to, baseline, limit }) => {
  const h = 90;
  const vals = [...points.map((p) => p.v), ...(typeof baseline === 'number' ? [baseline] : []), ...(typeof limit === 'number' ? [limit] : [])];
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const y = (v: number) => h - 6 - ((v - lo) / (hi - lo || 1)) * (h - 12);
  const x = (t: number) => ((t - from) / Math.max(1, to - from)) * 1000;
  let d = '';
  points.forEach((p, i) => {
    const next = points[i + 1]?.t ?? Math.min(to, Date.now());
    d += `${d ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}L${x(next).toFixed(1)},${y(p.v).toFixed(1)}`;
  });
  return (
    <div className="drive-chart" data-key={label}>
      <div className="flex items-center gap-2 text-xs text-slate-300">
        <span className="font-semibold">{label}</span>
        <span className="text-slate-500">
          {num(lo, unit)} … {num(hi, unit)}
        </span>
        {typeof baseline === 'number' && <span className="text-slate-400">baseline {num(baseline, unit)}</span>}
        {typeof limit === 'number' && <span className="text-rose-300">limit {num(limit, unit)}</span>}
      </div>
      <div className="relative rounded bg-slate-950 border border-slate-800" style={{ height: h }}>
        {!points.length && <span className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">nothing kept in this range yet</span>}
        <svg viewBox={`0 0 1000 ${h}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
          {typeof baseline === 'number' && <line x1={0} x2={1000} y1={y(baseline)} y2={y(baseline)} stroke="#94a3b8" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />}
          {typeof limit === 'number' && <line x1={0} x2={1000} y1={y(limit)} y2={y(limit)} stroke="#f43f5e" vectorEffect="non-scaling-stroke" />}
          <path d={d} fill="none" stroke="#38bdf8" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </div>
  );
};

/**
 * The operator board's Drives page: every drive the gateway follows (gateway/drives.cjs), read from the drive itself
 * (its heatsink, current, DC bus, utilisation, hours, counters, error code), each judged against its limits, its own
 * last 14 days and its siblings: healthy, watch, warning, alarm, with why. A filter (name, PLC, model, finding),
 * problems only; a click opens its history (24 h, 7 days, 30 days) against its baseline, and every value it has.
 */
export const DrivesBoard: React.FC<{
  conn: GatewayConnection | null;
  connected: boolean;
  subscribe: (fn: (m: Msg) => void) => () => void;
  plcIds: string[];
  onlyPlcs: string[];
  narrow: boolean;
}> = ({ conn, connected, subscribe, plcIds, onlyPlcs, narrow }) => {
  const [plcs, setPlcs] = useState<DrivePlc[]>([]);
  const [params, setParams] = useState<Record<string, { name: string; params: ParamInfo[] }>>({});
  const [error, setError] = useState('');
  const [filter, setFilterState] = useState(() => {
    try {
      return localStorage.getItem(FILTER_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const setFilter = (v: string) => {
    setFilterState(v);
    try {
      localStorage.setItem(FILTER_KEY, v);
    } catch {
      // (this viewer only, this time)
    }
  };
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [open, setOpen] = useState<{ plc: string; path: string } | null>(null);
  useEffect(
    () =>
      subscribe((m) => {
        if (m.type !== 'drivesState') return;
        setPlcs(m.plcs ?? []);
        if (m.params) setParams(m.params);
        setError(m.error ?? '');
      }),
    [subscribe]
  );
  useEffect(() => {
    if (!connected || !conn) return;
    conn.send({ type: 'drivesWatch', plcs: plcIds });
    return () => {
      conn.send({ type: 'drivesStop' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, conn, plcIds.join(',')]);
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const pinfo = (d: DriveView, key: string) => params[d.profile]?.params.find((p) => p.key === key);
  const view = plcs
    .filter((p) => !onlyPlcs.length || onlyPlcs.includes(p.id))
    .map((p) => ({
      ...p,
      drives: p.drives
        .filter((d) => (!problemsOnly || ['alarm', 'warn', 'watch'].includes(d.health?.level ?? '') || d.notAnswering) && words.every((w) => `${p.name} ${d.name} ${d.box} ${d.vendor} ${d.product} ${d.firmware} ${(d.health?.findings ?? []).map((f) => f.text).join(' ')}`.toLowerCase().includes(w)))
        .sort((a, b) => RANK[a.health?.level ?? 'unknown'] - RANK[b.health?.level ?? 'unknown'] || a.name.localeCompare(b.name, undefined, { numeric: true })),
    }))
    .filter((p) => p.drives.length || (!words.length && !problemsOnly));
  const all = plcs.flatMap((p) => p.drives);
  const count = (l: string) => all.filter((d) => d.health?.level === l).length;
  const detail = open ? plcs.find((p) => p.id === open.plc)?.drives.find((d) => d.path === open.path) ?? null : null;
  return (
    <div id="drives-board" className="flex-1 min-h-0 flex flex-col">
      <div className={`flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/60 ${narrow ? 'px-2 py-1.5' : 'px-4 py-2'}`}>
        <span className="relative flex items-center">
          <Search className="absolute left-2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input
            id="drives-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFilter('');
                e.currentTarget.blur();
              }
            }}
            placeholder="Filter drives: name, PLC, model, finding…"
            className={`${narrow ? 'w-44' : 'w-80'} pl-7 pr-7 py-1 rounded bg-slate-950 border border-slate-700 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-600 select-text`}
          />
          {filter && (
            <button type="button" onClick={() => setFilter('')} className="absolute right-1.5 p-0.5 rounded text-slate-400 hover:text-white" title="Clear the filter">
              <X className="w-4 h-4" />
            </button>
          )}
        </span>
        <button id="drives-problems" type="button" aria-pressed={problemsOnly} onClick={() => setProblemsOnly((v) => !v)} className={`px-2 py-1 rounded border text-sm ${problemsOnly ? 'border-amber-500 bg-amber-500/20 text-amber-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`} title="Only the drives to look at (alarm, warning, watch, not answering)">
          Problems only
        </button>
        <span id="drives-counts" className="flex items-center gap-2 text-sm text-slate-400">
          {all.length} drives
          {(['alarm', 'warn', 'watch'] as const).map((l) =>
            count(l) ? (
              <span key={l} className={`px-2 rounded-full ${LEVEL[l].cls}`}>
                {count(l)} {LEVEL[l].text.toLowerCase()}
              </span>
            ) : null
          )}
        </span>
      </div>
      <div className={`flex-1 min-h-0 overflow-y-auto ${narrow ? 'p-2 space-y-3' : 'p-4 space-y-5'}`}>
        {error && <div className="px-4 py-2 rounded bg-rose-950 border border-rose-800 text-rose-200">{error}</div>}
        {!error && !plcs.length && <div className="text-slate-400">Reading the drives… (the gateway reads them every 30 seconds)</div>}
        {view.map((p) => (
          <section key={p.id} className="drives-plc" data-plc={p.id}>
            <h2 className="flex flex-wrap items-center gap-3 mb-2">
              <span className="text-xl font-semibold">{p.name}</span>
              <span className="text-sm text-slate-400">{p.drives.length} drive{p.drives.length === 1 ? '' : 's'}</span>
              {p.lastRound && <span className="text-xs text-slate-500">read {new Date(p.lastRound).toLocaleTimeString()}</span>}
              {(p.state !== 'watching' || p.message) && <span className={`text-sm ${p.state === 'error' ? 'text-rose-400' : 'text-sky-400'}`}>{p.message || p.state}</span>}
            </h2>
            <div className={`grid ${narrow ? 'gap-2 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]' : 'gap-3 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]'}`}>
              {p.drives.map((d) => {
                const lv = d.notAnswering ? 'unknown' : d.health?.level ?? 'unknown';
                const L = LEVEL[lv];
                const hs = d.latest.heatsink?.v;
                const limit = d.latest.heatsinkLimit?.v ?? 80;
                return (
                  <button key={d.path} type="button" onClick={() => setOpen({ plc: p.id, path: d.path })} className={`drive-card text-left rounded-lg border-2 ${L.border} bg-slate-900 hover:bg-slate-800/80 px-3 py-2`} data-drive={d.path} data-level={lv}>
                    <div className="flex items-center gap-2">
                      <Gauge className="w-4 h-4 shrink-0 text-sky-400" />
                      <span className="font-semibold truncate">{d.name}</span>
                      <span className={`drive-level ml-auto shrink-0 px-2 rounded-full text-xs font-semibold ${L.cls}`}>
                        {L.text}
                        {typeof d.health?.score === 'number' && lv !== 'ok' ? ` · ${d.health.score}` : ''}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {d.vendor} {d.firmware} · {d.device.replace(/\s*\(EtherCAT\)$/, '')} {d.address}
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-1 text-xs">
                      <span title={pinfo(d, 'heatsink')?.label} className={typeof hs === 'number' && hs >= limit - 5 ? 'text-amber-300' : ''}>
                        <Thermometer className="inline w-3.5 h-3.5 mr-0.5 text-slate-400" />
                        {shown(pinfo(d, 'heatsink'), d.latest.heatsink)}
                      </span>
                      <span title={pinfo(d, 'current')?.label ?? pinfo(d, 'currentPct')?.label}>
                        <Zap className="inline w-3.5 h-3.5 mr-0.5 text-slate-400" />
                        {d.latest.current ? shown(pinfo(d, 'current'), d.latest.current) : shown(pinfo(d, 'currentPct'), d.latest.currentPct)}
                      </span>
                      <span title={pinfo(d, 'dcBus')?.label}>DC {shown(pinfo(d, 'dcBus'), d.latest.dcBus)}</span>
                      {d.latest.freq && <span title={pinfo(d, 'freq')?.label}>{shown(pinfo(d, 'freq'), d.latest.freq)}</span>}
                      {d.latest.motorI2t && <span title={pinfo(d, 'motorI2t')?.label}>i²t {shown(pinfo(d, 'motorI2t'), d.latest.motorI2t)}</span>}
                      {d.latest.opHours && <span title={pinfo(d, 'opHours')?.label}>{shown(pinfo(d, 'opHours'), d.latest.opHours)}</span>}
                    </div>
                    <div className="mt-1 flex items-center gap-3">
                      {d.spark.heatsink && (
                        <span className="flex items-center gap-1 text-[10px] text-slate-500" title="Heatsink, the last 24 h">
                          <Spark points={d.spark.heatsink} color="#f59e0b" /> °C
                        </span>
                      )}
                      {(d.spark.current ?? d.spark.currentPct) && (
                        <span className="flex items-center gap-1 text-[10px] text-slate-500" title="Current, the last 24 h">
                          <Spark points={d.spark.current ?? d.spark.currentPct} color="#38bdf8" /> A
                        </span>
                      )}
                    </div>
                    {d.notAnswering && <div className="mt-1 text-xs text-amber-300">Not answering: {Object.values(d.latest).find((x) => x.error)?.error ?? 'no answer'}</div>}
                    {(d.health?.findings ?? []).slice(0, 3).map((f, i) => (
                      <div key={i} className={`drive-finding mt-1 flex gap-1 text-xs ${f.level === 'alarm' ? 'text-rose-300' : f.level === 'warn' ? 'text-amber-200' : f.level === 'watch' ? 'text-sky-300' : 'text-slate-400'}`}>
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                        <span>{f.text}</span>
                      </div>
                    ))}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {detail && open && <DriveDetail conn={conn} plc={open.plc} plcName={plcs.find((p) => p.id === open.plc)?.name ?? open.plc} drive={detail} params={params[detail.profile]?.params ?? []} onClose={() => setOpen(null)} />}
    </div>
  );
};

/** One drive: its history against its baseline, every value it has now (with its object, its scaling checked or not) */
const DriveDetail: React.FC<{ conn: GatewayConnection | null; plc: string; plcName: string; drive: DriveView; params: ParamInfo[]; onClose: () => void }> = ({ conn, plc, plcName, drive, params, onClose }) => {
  const [range, setRange] = useState(RANGES[0].ms);
  const [data, setData] = useState<{ from: number; to: number; series: Record<string, { t: number; v: number }[]>; baseline: Record<string, number>; error?: string } | null>(null);
  const keys = useMemo(() => CHART_KEYS.filter((k) => params.some((p) => p.key === k)), [params]);
  useEffect(() => {
    if (!conn) return;
    const to = Date.now();
    const from = to - range;
    let gone = false;
    void conn
      .request<{ series?: Record<string, { t: number; v: number }[]>; baseline?: Record<string, number>; error?: string }>({ type: 'driveHistory', plc, path: drive.path, keys, from, to }, 'driveHistoryResult', 60000)
      .then((r) => !gone && setData({ from, to, series: r.series ?? {}, baseline: r.baseline ?? {}, ...(r.error ? { error: r.error } : {}) }))
      .catch((e: unknown) => !gone && setData({ from, to, series: {}, baseline: {}, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      gone = true;
    };
  }, [conn, plc, drive.path, range, keys.join(',')]);
  const csv = () => {
    if (!data) return;
    const rows = ['time,value,key,label,unit', ...keys.flatMap((k) => (data.series[k] ?? []).map((p) => `${new Date(p.t).toISOString()},${p.v},${k},${params.find((x) => x.key === k)?.label ?? k},${params.find((x) => x.key === k)?.unit ?? ''}`))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\r\n') + '\r\n'], { type: 'text/csv' }));
    a.download = `drive-${drive.name.replace(/[^\w.-]+/g, '_')}-${new Date(data.from).toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  const L = LEVEL[drive.health?.level ?? 'unknown'];
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="drive-detail" className="w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 text-sm text-slate-200 shadow-2xl" onKeyDown={(e) => e.key === 'Escape' && onClose()} tabIndex={-1}>
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-800 bg-slate-900">
          <HeartPulse className="w-5 h-5 text-sky-300" />
          <span className="text-base font-semibold">{drive.name}</span>
          <span className={`px-2 rounded-full text-xs font-semibold ${L.cls}`}>
            {L.text}
            {typeof drive.health?.score === 'number' ? ` · ${drive.health.score}` : ''}
          </span>
          <span className="text-xs text-slate-400">
            {plcName} · {drive.vendor} {drive.firmware} · {drive.netId} : {drive.address}
          </span>
          <span className="ml-auto flex items-center gap-1">
            {RANGES.map((r) => (
              <button key={r.ms} type="button" onClick={() => setRange(r.ms)} className={`drive-range px-2 py-0.5 rounded border ${range === r.ms ? 'border-sky-500 bg-sky-900/60 text-sky-100' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>
                {r.label}
              </button>
            ))}
            <button type="button" onClick={csv} className="p-1 rounded hover:bg-slate-800" title="CSV of what is shown">
              <Download className="w-4 h-4" />
            </button>
            <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-800" title="Close (Esc)">
              <X className="w-4 h-4" />
            </button>
          </span>
        </div>
        <div className="px-4 py-3 space-y-3">
          {(drive.health?.findings ?? []).length > 0 && (
            <ul className="space-y-1">
              {drive.health!.findings.map((f, i) => (
                <li key={i} className={`flex gap-2 ${f.level === 'alarm' ? 'text-rose-300' : f.level === 'warn' ? 'text-amber-200' : 'text-sky-300'}`}>
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {f.text}
                </li>
              ))}
            </ul>
          )}
          {data?.error && <div className="text-rose-300">{data.error}</div>}
          <div className="grid gap-3 md:grid-cols-2">
            {data &&
              keys.map((k) => {
                const p = params.find((x) => x.key === k);
                return <Chart key={k} label={p?.label ?? k} unit={p?.unit ?? ''} points={data.series[k] ?? []} from={data.from} to={data.to} baseline={k === 'heatsink' ? data.baseline.heatsink : undefined} limit={k === 'heatsink' ? drive.latest.heatsinkLimit?.v ?? 80 : k === 'motorI2t' || k === 'deviceIxt' ? 95 : null} />;
              })}
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">Value</th>
                <th>Now</th>
                <th>Today (running)</th>
                <th>Its scaling</th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => (
                <tr key={p.key} className="drive-value border-t border-slate-800" data-key={p.key}>
                  <td className="py-1">{p.label}</td>
                  <td className="font-mono">{shown(p, drive.latest[p.key])}</td>
                  <td className="font-mono text-slate-400">{drive.today?.[p.key] ? `median ${num(drive.today[p.key].median, p.unit)}${drive.today[p.key].max !== undefined ? `, max ${num(drive.today[p.key].max, p.unit)}` : ''}` : ''}</td>
                  <td className={p.verified ? 'text-slate-500' : 'text-amber-300'}>{drive.latest[p.key]?.error ? `not read: ${drive.latest[p.key].error}` : p.verified ? 'as the manual gives it' : 'to check once against the drive\'s keypad'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
