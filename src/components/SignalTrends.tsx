import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CircleDot, Download, History, Pause, Play, X } from 'lucide-react';
import { indexAt } from '../utils/boardPlayback.ts';

export interface SignalSeries {
  key: string;
  plc: string;
  plcName: string;
  /** The PLC variable (linked to the I/O) */
  path: string;
  /** Its I/O place (box, channel), for its label */
  where?: string;
  points: { t: number; v: unknown }[];
  error?: string | null;
  /** A recording keeps it (its id): the chart can go back in time */
  recording?: string | null;
}

export const TREND_WINDOWS = [
  { label: '1 min', ms: 60_000 },
  { label: '5 min', ms: 5 * 60_000 },
  { label: '15 min', ms: 15 * 60_000 },
];
export const HISTORY_WINDOWS = [
  { label: '1 h', ms: 3600_000 },
  { label: '8 h', ms: 8 * 3600_000 },
  { label: '24 h', ms: 24 * 3600_000 },
];

const COLORS = ['#38bdf8', '#f59e0b', '#22c55e', '#f472b6', '#a78bfa', '#2dd4bf', '#fb7185', '#facc15'];
const num = (v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : Number.NaN);
const show = (v: unknown) => (v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : String(v));
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * The I/O signals chosen on the I/O page, live as time series (the gateway keeps their last 15 minutes): a lane each,
 * a boolean as a band (high: TRUE), a number as a line with its range; a shared time axis, hover for every value at a
 * time. Pause freezes it; a recorded signal goes back (1 h, 8 h, 24 h) from the gateway's recording; CSV of what is
 * shown. Record… starts a recording of the chosen ones.
 */
export const SignalTrends: React.FC<{
  signals: SignalSeries[];
  /** Back in time: [from, to] read from a recording; null: live */
  history: { from: number; to: number; loading?: string } | null;
  onHistory: (windowMs: number | null) => void;
  onRemove: (key: string) => void;
  onRecord?: () => void;
  narrow: boolean;
}> = ({ signals, history, onHistory, onRemove, onRecord, narrow }) => {
  const [windowMs, setWindowMs] = useState(TREND_WINDOWS[1].ms);
  const [paused, setPaused] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [hover, setHover] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (paused !== null || history) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [paused, history]);
  const to = history ? history.to : paused ?? now;
  const from = history ? history.from : to - windowMs;
  const span = Math.max(1, to - from);
  const x = (t: number) => ((t - from) / span) * 1000;
  const lanes = useMemo(
    () =>
      signals.map((s, i) => {
        const pts = s.points;
        const start = Math.max(0, indexAt(pts, from));
        const shown = pts.slice(start).filter((p) => p.t <= to);
        if (pts[start] && pts[start].t < from) shown[0] = { t: from, v: pts[start].v };
        const kind = shown.some((p) => typeof p.v === 'boolean') ? 'bool' : shown.some((p) => Number.isFinite(num(p.v))) ? 'num' : 'text';
        const vals = shown.map((p) => num(p.v)).filter(Number.isFinite);
        const lo = vals.length ? Math.min(...vals) : 0;
        const hi = vals.length ? Math.max(...vals) : 1;
        return { s, color: COLORS[i % COLORS.length], shown, kind, lo, hi: hi === lo ? lo + 1 : hi };
      }),
    [signals, from, to]
  );
  const csv = () => {
    const rows = ['time,plc,signal,value', ...lanes.flatMap((l) => l.shown.map((p) => `${new Date(p.t).toISOString()},${l.s.plcName},${l.s.path},${show(p.v)}`))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\r\n') + '\r\n'], { type: 'text/csv' }));
    a.download = `signals-${new Date(from).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
  };
  const atHover = hover === null ? null : from + (hover / 1000) * span;
  const recorded = signals.some((s) => s.recording);
  return (
    <section id="board-signal-trends" className="border-t-2 border-sky-800 bg-slate-900/95 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="font-semibold text-sky-200">Signals</span>
        <span className="text-xs text-slate-400">{history ? `${clock(from)} – ${clock(to)}, from the recording${history.loading ? `: ${history.loading}` : ''}` : paused !== null ? `paused at ${clock(paused)}` : 'live'}</span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {!history && (
            <>
              {TREND_WINDOWS.map((w) => (
                <button key={w.ms} type="button" onClick={() => setWindowMs(w.ms)} className={`px-2 py-0.5 rounded border ${windowMs === w.ms ? 'border-sky-500 bg-sky-900/60 text-sky-100' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>
                  {w.label}
                </button>
              ))}
              <button id="board-trend-pause" type="button" onClick={() => setPaused((p) => (p === null ? Date.now() : null))} className="p-1 rounded hover:bg-slate-800" title={paused === null ? 'Pause' : 'Live again'}>
                {paused === null ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
            </>
          )}
          {recorded && (
            <span className="flex items-center gap-1 ml-1" title="Back in time, from the gateway's recording of these signals">
              <History className="w-4 h-4 text-violet-300" />
              {HISTORY_WINDOWS.map((w) => (
                <button key={w.ms} type="button" onClick={() => onHistory(w.ms)} className="board-trend-history px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">
                  {w.label}
                </button>
              ))}
              {history && (
                <button type="button" onClick={() => onHistory(null)} className="px-2 py-0.5 rounded border border-sky-600 text-sky-200 hover:bg-slate-800">
                  Live
                </button>
              )}
            </span>
          )}
          {onRecord && (
            <button id="board-trend-record" type="button" onClick={onRecord} className="flex items-center gap-1 px-2 py-0.5 rounded border border-rose-800 text-rose-200 hover:bg-rose-950" title="Record these signals on the gateway">
              <CircleDot className="w-4 h-4" /> Record…
            </button>
          )}
          <button type="button" onClick={csv} className="p-1 rounded hover:bg-slate-800" title="CSV of what is shown">
            <Download className="w-4 h-4" />
          </button>
        </span>
      </div>
      <div className="max-h-[38vh] overflow-y-auto">
        {lanes.map((l) => {
          const h = l.kind === 'num' ? 70 : 24;
          const val = atHover !== null ? l.s.points[indexAt(l.s.points, atHover)]?.v : l.s.points[l.s.points.length - 1]?.v;
          const y = (v: unknown) => (l.kind === 'bool' ? (num(v) ? 3 : h - 3) : h - 4 - ((num(v) - l.lo) / (l.hi - l.lo)) * (h - 8));
          let d = '';
          l.shown.forEach((p, i) => {
            if (!Number.isFinite(num(p.v)) && l.kind !== 'bool') return;
            const next = l.shown[i + 1]?.t ?? Math.min(to, Date.now());
            d += `${d ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}L${x(next).toFixed(1)},${y(p.v).toFixed(1)}`;
          });
          return (
            <div key={l.s.key} className="board-trend-lane flex items-stretch gap-2 py-0.5" data-signal={l.s.key}>
              <div className={`${narrow ? 'w-28' : 'w-64'} shrink-0 flex flex-col justify-center min-w-0`}>
                <div className="flex items-center gap-1 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: l.color }} />
                  <span className="truncate font-mono text-xs text-slate-200" title={`${l.s.plcName}: ${l.s.path}${l.s.where ? `\n${l.s.where}` : ''}`}>
                    {l.s.path}
                  </span>
                  {l.s.recording && <CircleDot className="w-3 h-3 shrink-0 text-rose-400" aria-label="recorded" />}
                  <button type="button" onClick={() => onRemove(l.s.key)} className="ml-auto p-0.5 rounded text-slate-500 hover:text-white" title="Remove it from the chart">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="board-trend-value font-mono text-white">{show(val)}</span>
                  {l.kind === 'num' && <span className="text-slate-500">{`${show(l.lo)} … ${show(l.hi)}`}</span>}
                  {l.s.error && <span className="text-amber-300 truncate" title={l.s.error}>{l.s.error}</span>}
                </div>
              </div>
              <div
                ref={plot}
                className="relative flex-1 rounded bg-slate-950 border border-slate-800"
                style={{ height: h }}
                onMouseMove={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setHover(((e.clientX - r.left) / r.width) * 1000);
                }}
                onMouseLeave={() => setHover(null)}
              >
                <svg viewBox={`0 0 1000 ${h}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                  {l.kind === 'bool' && d && <path d={`${d}L${x(Math.min(to, Date.now())).toFixed(1)},${h - 3}L${x(l.shown[0]?.t ?? from).toFixed(1)},${h - 3}Z`} fill={l.color} opacity={0.25} />}
                  <path d={d} fill="none" stroke={l.color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                  {hover !== null && <line x1={hover} x2={hover} y1={0} y2={h} stroke="#e2e8f0" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
                </svg>
              </div>
            </div>
          );
        })}
        <div className="flex gap-2 text-[11px] text-slate-500">
          <span className={`${narrow ? 'w-28' : 'w-64'} shrink-0`}>{atHover !== null ? <span className="text-slate-200">{clock(atHover)}</span> : null}</span>
          <span className="flex-1 flex justify-between">
            <span>{clock(from)}</span>
            <span>{clock(from + span / 2)}</span>
            <span>{clock(to)}</span>
          </span>
        </div>
      </div>
    </section>
  );
};
