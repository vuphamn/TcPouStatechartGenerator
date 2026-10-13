import React, { useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, GanttChart, X } from 'lucide-react';

export interface TimelineLane {
  /** This PLC, or a compared one, or a recording */
  label: string;
  transitions: { t: number; from: string; to: string; dwellMs: number }[];
  current: { state: string; since: number } | null;
  /** The lane ends here (a recording: its last sample), not now */
  end?: number;
  /** A lane added here (a recording): it can be taken off */
  removable?: boolean;
}
export interface TimelineSegment {
  state: string;
  from: number;
  to: number;
}

/** A lane's stays: each transition's state before it (its dwell), then the current one up to now (or its end) */
export function laneSegments(lane: TimelineLane, now: number): TimelineSegment[] {
  const out: TimelineSegment[] = [];
  for (const tr of [...lane.transitions].sort((a, b) => a.t - b.t)) out.push({ state: tr.from, from: tr.t - tr.dwellMs, to: tr.t });
  if (lane.current) out.push({ state: lane.current.state, from: lane.current.since, to: Math.max(Math.min(now, lane.end ?? now), lane.current.since) });
  return out.filter((s) => s.to > s.from);
}

/**
 * A recording's state samples as a lane (its state names from `name`), moved by `shift` ms (to start with another
 * lane: compared side by side)
 */
export function recordingLane(label: string, values: { t: number; value: number }[], name: (value: number) => string, shift = 0): TimelineLane {
  const transitions: TimelineLane['transitions'] = [];
  let state: string | null = null;
  let since = 0;
  for (const v of [...values].sort((a, b) => a.t - b.t)) {
    const s = name(v.value);
    if (state === null) {
      state = s;
      since = v.t;
      continue;
    }
    if (s === state) continue;
    transitions.push({ t: v.t + shift, from: state, to: s, dwellMs: v.t - since });
    state = s;
    since = v.t;
  }
  const last = values.length ? Math.max(...values.map((v) => v.t)) : since;
  return { label, transitions, current: state === null ? null : { state, since: since + shift }, end: last + shift, removable: true };
}

/** The lanes' stays in a window as CSV: lane; state; from; to (ISO); ms */
export function timelineCsv(lanes: TimelineLane[], now: number, from: number, to: number): string {
  const rows = ['lane;state;from;to;ms'];
  for (const l of lanes)
    for (const s of laneSegments(l, now)) {
      if (s.to <= from || s.from >= to) continue;
      rows.push(`${l.label.replace(/;/g, ',')};${s.state};${new Date(s.from).toISOString()};${new Date(s.to).toISOString()};${Math.round(s.to - s.from)}`);
    }
  return rows.join('\n');
}

/** A state's colour (the same on every lane) */
const colorOf = (state: string) => {
  let h = 0;
  for (const ch of state) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 45%)`;
};

/** The lanes in a window as an SVG picture (a bar per stay, its state written in it when it fits) */
export function timelineSvg(lanes: TimelineLane[], now: number, from: number, to: number): string {
  const W = 1200;
  const L = 160;
  const H = 26;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const x = (t: number) => L + ((Math.max(from, Math.min(to, t)) - from) / Math.max(1, to - from)) * (W - L - 10);
  const parts: string[] = [];
  lanes.forEach((l, i) => {
    const y = 10 + i * (H + 6);
    parts.push(`<text x="4" y="${y + 17}" font-size="12" fill="#cbd5e1">${esc(l.label)}</text>`);
    for (const s of laneSegments(l, now)) {
      if (s.to <= from || s.from >= to) continue;
      const a = x(s.from);
      const w = Math.max(1, x(s.to) - a);
      parts.push(`<rect x="${a.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${H}" fill="${colorOf(s.state)}"><title>${esc(s.state)}: ${Math.round(s.to - s.from)} ms</title></rect>`);
      if (w > s.state.length * 6.5) parts.push(`<text x="${(a + 3).toFixed(1)}" y="${y + 17}" font-size="11" fill="#fff">${esc(s.state)}</text>`);
    }
  });
  const h = 20 + lanes.length * (H + 6) + 14;
  parts.push(`<text x="${L}" y="${h - 4}" font-size="10" fill="#94a3b8">${new Date(from).toLocaleString()}</text>`);
  parts.push(`<text x="${W - 10}" y="${h - 4}" font-size="10" fill="#94a3b8" text-anchor="end">${new Date(to).toLocaleString()}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}"><rect width="100%" height="100%" fill="#0f172a"/>${parts.join('')}</svg>`;
}

const SPANS = [{ ms: 60_000, label: '1 min' }, { ms: 600_000, label: '10 min' }, { ms: 0, label: 'All' }];
const dur = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

/**
 * The state timeline (the Live tab): each PLC's states over time as bars (a Gantt chart), this one, the compared ones
 * and recordings added; the last minute, ten minutes or all; the wheel zooms, a drag pans (Now goes back to following);
 * a bar's state and time on hover, a click selects the state on the chart; CSV and SVG of the window shown
 */
export const StateTimeline: React.FC<{
  lanes: TimelineLane[];
  now: () => number;
  live: boolean;
  onSelectState?: (state: string) => void;
  onExport?: (kind: 'csv' | 'svg', text: string) => void;
  onAddRecording?: (file: File) => void;
  onRemoveLane?: (label: string) => void;
}> = ({ lanes, now: nowOf, live, onSelectState, onExport, onAddRecording, onRemoveLane }) => {
  const [span, setSpan] = useState(600_000);
  // (zoomed or panned: the window's own span and end; null: the span chosen, up to now)
  const [view, setView] = useState<{ span: number; end: number } | null>(null);
  const drag = useRef<{ x: number; end: number; width: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  // (the wheel: a native listener, not passive, so the page does not scroll while zooming)
  const zoomRef = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      zoomRef.current(e);
    };
    el.addEventListener('wheel', on, { passive: false });
    return () => el.removeEventListener('wheel', on);
  });
  // (live: the bars grow each second)
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [live]);
  const now = nowOf();
  const all = lanes.map((l) => ({ lane: l, segs: laneSegments(l, now) }));
  const first = Math.min(...all.flatMap((l) => l.segs.map((s) => s.from)), now);
  const last = Math.max(now, ...all.flatMap((l) => l.segs.map((s) => s.to)));
  const to = view ? view.end : live ? now : last;
  const from = view ? view.end - view.span : span ? to - span : first;
  const x = (t: number) => ((Math.max(from, Math.min(to, t)) - from) / Math.max(1, to - from)) * 100;
  if (!all.some((l) => l.segs.length)) return null;
  zoomRef.current = (e: WheelEvent) => {
    const r = lanesRef.current!.getBoundingClientRect();
    const at = from + ((e.clientX - r.left) / Math.max(1, r.width)) * (to - from);
    const k = e.deltaY > 0 ? 1.25 : 0.8;
    const nextSpan = Math.max(500, Math.min(24 * 3600_000, (to - from) * k));
    // (the time under the pointer stays where it is)
    const nextEnd = at + (to - at) * (nextSpan / Math.max(1, to - from));
    setView({ span: nextSpan, end: nextEnd });
  };
  return (
    <div id="live-timeline" className="rounded border border-slate-700/70 bg-slate-900/40 px-2 py-1.5 space-y-1">
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="flex items-center gap-1 text-slate-300 font-semibold" title="Each PLC's states over time: the time in each, one after another. The wheel zooms, a drag pans">
          <GanttChart className="w-3 h-3 text-sky-300" /> Timeline
        </span>
        {view && (
          <button id="live-timeline-now" type="button" onClick={() => setView(null)} className="px-1.5 py-0.5 rounded border border-sky-700 text-[10px] text-sky-200 hover:bg-sky-900/50" title="Back to the span chosen, following now">
            Now
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          {onAddRecording && (
            <>
              <button type="button" id="live-timeline-add-recording" onClick={() => fileRef.current?.click()} className="p-0.5 rounded text-slate-400 hover:text-sky-300" title="A recording (.kssrec.json) as a lane of its own, starting with this one: compared side by side">
                <FolderOpen className="w-3 h-3" />
              </button>
              <input
                ref={fileRef}
                id="live-timeline-recording-file"
                type="file"
                accept=".json,.kssrec.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onAddRecording(f);
                  e.target.value = '';
                }}
              />
            </>
          )}
          {onExport && (
            <>
              <button type="button" id="live-timeline-csv" onClick={() => onExport('csv', timelineCsv(lanes, now, from, to))} className="flex items-center gap-0.5 px-1 rounded text-[10px] text-slate-400 hover:text-sky-300" title="The stays shown as CSV (lane, state, from, to, ms)">
                <Download className="w-3 h-3" /> CSV
              </button>
              <button type="button" id="live-timeline-svg" onClick={() => onExport('svg', timelineSvg(lanes, now, from, to))} className="flex items-center gap-0.5 px-1 rounded text-[10px] text-slate-400 hover:text-sky-300" title="The timeline shown as a picture (SVG)">
                <Download className="w-3 h-3" /> SVG
              </button>
            </>
          )}
          <div className="flex rounded border border-slate-700 overflow-hidden text-[10px]" role="radiogroup" aria-label="Span">
            {SPANS.map((s) => (
              <button
                key={s.label}
                id={`live-timeline-span-${s.label.replace(/\s/g, '')}`}
                role="radio"
                aria-checked={!view && span === s.ms}
                onClick={() => {
                  setSpan(s.ms);
                  setView(null);
                }}
                className={`px-1.5 py-0.5 ${!view && span === s.ms ? 'bg-sky-800 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div
        id="live-timeline-lanes"
        ref={lanesRef}
        className="space-y-1 select-none"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { x: e.clientX, end: to, width: e.currentTarget.getBoundingClientRect().width - 88 };
        }}
        onMouseMove={(e) => {
          const d = drag.current;
          if (!d || Math.abs(e.clientX - d.x) < 3) return;
          setView({ span: to - from, end: d.end - ((e.clientX - d.x) / Math.max(1, d.width)) * (to - from) });
        }}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
      >
        {all.map(({ lane, segs }) => (
          <div key={lane.label} className="live-timeline-lane flex items-center gap-1.5 text-[10px]" data-lane={lane.label}>
            <span className="w-20 truncate text-slate-400 flex items-center gap-0.5" title={lane.label}>
              {lane.removable && onRemoveLane && (
                <button type="button" className="live-timeline-remove text-slate-500 hover:text-white" onClick={() => onRemoveLane(lane.label)} title="Take this lane off">
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
              {lane.label}
            </span>
            <div className="relative flex-1 h-4 bg-slate-950/70 rounded overflow-hidden">
              {segs
                .filter((s) => s.to > from && s.from < to)
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
      </div>
      <div className="flex justify-between text-[9px] text-slate-500 font-mono pl-[5.5rem]">
        <span id="live-timeline-from">{new Date(from).toLocaleTimeString()}</span>
        <span>{dur(to - from)}</span>
        <span id="live-timeline-to">{new Date(to).toLocaleTimeString()}</span>
      </div>
    </div>
  );
};
