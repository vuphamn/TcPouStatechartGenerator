import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Download, Pause, Play, X } from 'lucide-react';

export type ScopePoint = { t: number; v: number | boolean | string };

/** A variable's value at a time: the last sample at or before it */
export const valueAt = (points: ScopePoint[], t: number): ScopePoint | null => {
  let found: ScopePoint | null = null;
  for (const p of points) {
    if (p.t > t) break;
    found = p;
  }
  return found;
};

/** The chosen variables' samples as CSV: time (ISO, PLC time), variable, value; in time order */
export function scopeCsv(history: Map<string, ScopePoint[]>, names: string[]): string {
  const rows: [number, string, string][] = [];
  for (const n of names) for (const p of history.get(n.toLowerCase()) ?? []) rows.push([p.t, n, String(p.v)]);
  rows.sort((a, b) => a[0] - b[0]);
  return ['time;variable;value', ...rows.map(([t, n, v]) => `${new Date(t).toISOString()};${n};${v}`)].join('\n');
}

const SPANS = [10_000, 60_000, 300_000];
const spanText = (ms: number) => (ms < 60_000 ? `${ms / 1000} s` : `${ms / 60_000} min`);

const Chart: React.FC<{ name: string; points: ScopePoint[]; from: number; to: number; cursor: number | null; onCursor: (t: number) => void; onRemove: () => void }> = ({ name, points, from, to, cursor, onCursor, onRemove }) => {
  const w = 300;
  const h = 46;
  const num = (v: ScopePoint['v']) => (typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? v : null);
  // (the value before the window starts the line at its left edge)
  const before = valueAt(points, from);
  const inside = points.filter((p) => p.t > from && p.t <= to);
  const shown = [...(before ? [{ ...before, t: from }] : []), ...inside];
  const nums = shown.map((p) => num(p.v)).filter((x): x is number => x !== null);
  const text = shown.length > 0 && nums.length === 0;
  const lo = nums.length ? Math.min(...nums) : 0;
  const hi = nums.length ? Math.max(...nums) : 1;
  const x = (t: number) => ((Math.max(from, Math.min(to, t)) - from) / (to - from || 1)) * w;
  const y = (v: number) => h - 4 - ((v - lo) / (hi - lo || 1)) * (h - 8);
  let d = '';
  let last: number | null = null;
  for (const p of shown) {
    const v = num(p.v);
    if (v === null) continue;
    d += last === null ? `M${x(p.t).toFixed(1)},${y(v).toFixed(1)}` : `H${x(p.t).toFixed(1)}V${y(v).toFixed(1)}`;
    last = v;
  }
  if (last !== null) d += `H${w}`;
  const at = cursor !== null ? valueAt(points, cursor) : (shown[shown.length - 1] ?? null);
  return (
    <div className="live-scope-chart flex items-center gap-2 text-[10px]" data-var={name}>
      <div className="w-28 shrink-0">
        <div className="flex items-center gap-1">
          <span className="truncate font-mono text-slate-300" title={name}>{name}</span>
          <button type="button" className="live-scope-remove p-0.5 text-slate-500 hover:text-white" onClick={onRemove} title={`Take ${name} off the scope`}>
            <X className="w-3 h-3" />
          </button>
        </div>
        <div className="live-scope-value font-mono text-emerald-200 truncate" title={cursor !== null ? 'At the cursor' : 'Now'}>{at ? String(at.v) : '—'}</div>
        {!text && nums.length > 0 && <div className="text-slate-500">{hi === lo ? lo : `${lo} … ${hi}`}</div>}
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        height={h}
        className="live-scope-svg flex-1 min-w-0 bg-slate-950/70 rounded cursor-crosshair"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onCursor(from + ((e.clientX - r.left) / r.width) * (to - from));
        }}
      >
        {text ? (
          <text x="4" y={h / 2 + 3} fill="#94a3b8" fontSize="10" textLength={undefined}>{inside.length} change{inside.length === 1 ? '' : 's'} (text values)</text>
        ) : (
          <path className="live-scope-line" d={d} fill="none" stroke="#34d399" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
        )}
        {cursor !== null && <line x1={x(cursor)} x2={x(cursor)} y1="0" y2={h} stroke="#f472b6" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
};

/**
 * The scope (a trace, as XAE's Scope View's quick look): the chosen watched variables over the last seconds or minutes,
 * live; Pause holds the window (values keep coming in); a click puts a cursor, every chart's value there; CSV exports
 * what was recorded (the last 10 minutes)
 */
export const LiveScope: React.FC<{
  watched: string[];
  chosen: string[];
  onChosenChange: (names: string[]) => void;
  history: () => Map<string, ScopePoint[]>;
  /** The PLC's clock now (ms) */
  now: () => number;
  live: boolean;
  onExport: (csv: string) => void;
}> = ({ watched, chosen, onChosenChange, history, now, live, onExport }) => {
  const [span, setSpan] = useState(60_000);
  const [paused, setPaused] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (paused !== null || !live || !chosen.length) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, [paused, live, chosen.length]);
  const to = paused ?? now();
  const from = to - span;
  const h = history();
  const offer = useMemo(() => watched.filter((n) => !chosen.some((c) => c.toLowerCase() === n.toLowerCase())), [watched, chosen]);
  return (
    <div id="live-scope" className="rounded border border-slate-700/70 bg-slate-900/40 px-2 py-1.5 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="flex items-center gap-1 text-slate-300 font-semibold" title="The chosen watched variables over time (the last 10 minutes kept)">
          <Activity className="w-3 h-3 text-emerald-400" /> Scope
        </span>
        <select id="live-scope-add" value="" onChange={(e) => e.target.value && onChosenChange([...chosen, e.target.value])} className="max-w-[180px] bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[11px] text-slate-300" title="A watched variable to chart (Watch one first)">
          <option value="">{offer.length ? '+ a watched variable…' : chosen.length ? 'all watched ones charted' : 'watch a variable first'}</option>
          {offer.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <div className="flex rounded border border-slate-700 overflow-hidden text-[10px]" role="radiogroup" aria-label="Time span">
          {SPANS.map((s) => (
            <button key={s} id={`live-scope-span-${s / 1000}`} role="radio" aria-checked={span === s} onClick={() => setSpan(s)} className={`px-1.5 py-0.5 ${span === s ? 'bg-emerald-800 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
              {spanText(s)}
            </button>
          ))}
        </div>
        <button
          id="live-scope-pause"
          type="button"
          onClick={() => {
            setPaused((p) => (p === null ? now() : null));
            if (paused !== null) setCursor(null);
          }}
          disabled={!chosen.length}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
          title={paused === null ? 'Hold the window here (the values keep being recorded)' : 'Back to now'}
        >
          {paused === null ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />} {paused === null ? 'Pause' : 'Resume'}
        </button>
        <button id="live-scope-csv" type="button" onClick={() => onExport(scopeCsv(h, chosen))} disabled={!chosen.length} className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40" title="The charted variables' recorded values (the last 10 minutes), as CSV">
          <Download className="w-3 h-3" /> CSV
        </button>
      </div>
      {cursor !== null && (
        <div id="live-scope-cursor" className="text-[10px] text-pink-300 font-mono">
          cursor {new Date(cursor).toLocaleTimeString()}.{String(Math.round(cursor) % 1000).padStart(3, '0')}{' '}
          <button type="button" className="text-slate-400 hover:text-white" onClick={() => setCursor(null)}>
            (clear)
          </button>
        </div>
      )}
      {chosen.map((n) => (
        <Chart key={n} name={n} points={h.get(n.toLowerCase()) ?? []} from={from} to={to} cursor={cursor} onCursor={setCursor} onRemove={() => onChosenChange(chosen.filter((c) => c !== n))} />
      ))}
    </div>
  );
};
