import React, { useEffect, useState } from 'react';
import { GanttChart } from 'lucide-react';

export interface TimelineLane {
  /** This PLC, or a compared one */
  label: string;
  transitions: { t: number; from: string; to: string; dwellMs: number }[];
  current: { state: string; since: number } | null;
}
export interface TimelineSegment {
  state: string;
  from: number;
  to: number;
}

/** A lane's stays: each transition's state before it (its dwell), then the current one up to now */
export function laneSegments(lane: TimelineLane, now: number): TimelineSegment[] {
  const out: TimelineSegment[] = [];
  for (const tr of [...lane.transitions].sort((a, b) => a.t - b.t)) out.push({ state: tr.from, from: tr.t - tr.dwellMs, to: tr.t });
  if (lane.current) out.push({ state: lane.current.state, from: lane.current.since, to: Math.max(now, lane.current.since) });
  return out.filter((s) => s.to > s.from);
}

/** A state's colour (the same on every lane) */
const colorOf = (state: string) => {
  let h = 0;
  for (const ch of state) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 45%)`;
};
const SPANS = [{ ms: 60_000, label: '1 min' }, { ms: 600_000, label: '10 min' }, { ms: 0, label: 'All' }];
const dur = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

/**
 * The state timeline (the Live tab): each PLC's states over time as bars (a Gantt chart), this one and the compared
 * ones, the last minute, ten minutes or all; a bar's state and time on hover, a click selects the state on the chart
 */
export const StateTimeline: React.FC<{ lanes: TimelineLane[]; now: () => number; live: boolean; onSelectState?: (state: string) => void }> = ({ lanes, now: nowOf, live, onSelectState }) => {
  const [span, setSpan] = useState(600_000);
  // (live: the bars grow each second)
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [live]);
  const now = nowOf();
  const all = lanes.map((l) => ({ label: l.label, segs: laneSegments(l, now) }));
  const first = Math.min(...all.flatMap((l) => l.segs.map((s) => s.from)), now);
  const from = span ? now - span : first;
  const w = 100;
  const x = (t: number) => ((Math.max(from, Math.min(now, t)) - from) / Math.max(1, now - from)) * w;
  if (!all.some((l) => l.segs.length)) return null;
  return (
    <div id="live-timeline" className="rounded border border-slate-700/70 bg-slate-900/40 px-2 py-1.5 space-y-1">
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="flex items-center gap-1 text-slate-300 font-semibold" title="Each PLC's states over time: the time in each, one after another">
          <GanttChart className="w-3 h-3 text-sky-300" /> Timeline
        </span>
        <div className="ml-auto flex rounded border border-slate-700 overflow-hidden text-[10px]" role="radiogroup" aria-label="Span">
          {SPANS.map((s) => (
            <button key={s.label} id={`live-timeline-span-${s.label.replace(/\s/g, '')}`} role="radio" aria-checked={span === s.ms} onClick={() => setSpan(s.ms)} className={`px-1.5 py-0.5 ${span === s.ms ? 'bg-sky-800 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {all.map((l) => (
        <div key={l.label} className="live-timeline-lane flex items-center gap-1.5 text-[10px]" data-lane={l.label}>
          <span className="w-20 truncate text-slate-400" title={l.label}>
            {l.label}
          </span>
          <div className="relative flex-1 h-4 bg-slate-950/70 rounded overflow-hidden">
            {l.segs
              .filter((s) => s.to > from)
              .map((s, i) => (
                <button
                  key={`${s.from}-${i}`}
                  type="button"
                  className="live-timeline-seg absolute top-0 h-full border-r border-slate-950/60"
                  data-state={s.state}
                  style={{ left: `${x(s.from)}%`, width: `${Math.max(0.3, x(s.to) - x(s.from))}%`, background: colorOf(s.state) }}
                  title={`${s.state}: ${dur(s.to - s.from)} (${new Date(s.from).toLocaleTimeString()} – ${new Date(s.to).toLocaleTimeString()})`}
                  onClick={() => onSelectState?.(s.state)}
                />
              ))}
          </div>
        </div>
      ))}
      <div className="flex justify-between text-[9px] text-slate-500 font-mono pl-[5.5rem]">
        <span>{new Date(from).toLocaleTimeString()}</span>
        <span>{new Date(now).toLocaleTimeString()}</span>
      </div>
    </div>
  );
};
