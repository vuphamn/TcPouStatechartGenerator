import React, { useMemo, useRef } from 'react';
import { History, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { changeTimes, PLAYBACK_SPEEDS, staysOf, type PlaybackMachine } from '../utils/boardPlayback.ts';

/** A state's colour on the lanes: red for an error state, else one of a few by its value */
const PALETTE = ['#0ea5e9', '#22c55e', '#a78bfa', '#14b8a6', '#eab308', '#f472b6', '#60a5fa', '#84cc16'];
export const stayColor = (name: string, value: number, isError: (name: string) => boolean) => (isError(name) ? '#e11d48' : PALETTE[Math.abs(value) % PALETTE.length]);

const clock = (t: number, withDate: boolean) => new Date(t).toLocaleString([], withDate ? { weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * The board's playback (utils/boardPlayback.ts): the chosen machines' recorded states over the window, a lane each
 * (a bar per stay, hover: its state and how long), the time cursor (click or drag on the lanes), play / pause at a
 * speed, the previous or next change of any of them. The board's tiles show their states at the cursor meanwhile.
 */
export const BoardPlayback: React.FC<{
  machines: PlaybackMachine[];
  from: number;
  to: number;
  t: number;
  playing: boolean;
  speed: number;
  loading: string;
  isError: (stateName: string) => boolean;
  labelOf: (m: PlaybackMachine) => string;
  onSeek: (t: number) => void;
  onPlay: (on: boolean) => void;
  onSpeed: (x: number) => void;
  onClose: () => void;
  narrow: boolean;
  /** Moments marked on every lane (a fault) */
  marks?: { t: number; label: string }[];
  title?: string;
  closeLabel?: string;
}> = ({ machines, from, to, t, playing, speed, loading, isError, labelOf, onSeek, onPlay, onSpeed, onClose, narrow, marks = [], title, closeLabel }) => {
  const lanes = useRef<HTMLDivElement | null>(null);
  const changes = useMemo(() => changeTimes(machines, from, to), [machines, from, to]);
  const span = Math.max(1, to - from);
  const days = new Date(from).toDateString() !== new Date(to).toDateString();
  const seekAt = (clientX: number) => {
    const r = lanes.current?.getBoundingClientRect();
    if (!r) return;
    onSeek(from + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span);
  };
  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? changes.find((c) => c > t + 1) : [...changes].reverse().find((c) => c < t - 1);
    if (next !== undefined) onSeek(next);
  };
  const pct = ((t - from) / span) * 100;
  const label = narrow ? 'w-24' : 'w-56';
  return (
    <section id="board-playback" className="border-t-2 border-violet-700 bg-slate-900/95 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <History className="w-4 h-4 text-violet-300" />
        <span className="font-semibold text-violet-200">{title ?? 'Playback'}</span>
        <span id="board-playback-time" className="font-mono text-lg text-white">{clock(t, days)}</span>
        <span className="text-slate-400 text-xs">
          {clock(from, true)} – {clock(to, true)}
        </span>
        <span className="flex items-center gap-1 ml-auto">
          <button type="button" onClick={() => step(-1)} className="p-1.5 rounded hover:bg-slate-800" title="The change before">
            <SkipBack className="w-4 h-4" />
          </button>
          <button id="board-playback-play" type="button" onClick={() => onPlay(!playing)} className="p-1.5 rounded bg-violet-700 hover:bg-violet-600 text-white" title={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button id="board-playback-next" type="button" onClick={() => step(1)} className="p-1.5 rounded hover:bg-slate-800" title="The next change">
            <SkipForward className="w-4 h-4" />
          </button>
          <select value={speed} onChange={(e) => onSpeed(Number(e.target.value))} className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1" title="Speed">
            {PLAYBACK_SPEEDS.map((x) => (
              <option key={x} value={x}>
                {x}×
              </option>
            ))}
          </select>
          <button id="board-playback-close" type="button" onClick={onClose} className="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 hover:bg-slate-800" title="Back to the live board">
            <X className="w-4 h-4" /> {closeLabel ?? 'Live'}
          </button>
        </span>
      </div>
      {loading && <div className="px-1 py-1 text-slate-400">{loading}</div>}
      <div className="max-h-[32vh] overflow-y-auto">
        {machines.map((m) => {
          const stays = staysOf(m, from, to);
          return (
            <div key={`${m.plc}|${m.path}`} className="board-playback-lane flex items-center gap-2 h-6" data-path={m.path}>
              <span className={`${label} shrink-0 truncate font-mono text-xs text-slate-300`} title={`${m.path} (${m.recording})`}>
                {labelOf(m)}
              </span>
              <div className="relative flex-1 h-4 rounded bg-slate-800 overflow-hidden" onMouseDown={(e) => seekAt(e.clientX)} onMouseMove={(e) => e.buttons === 1 && seekAt(e.clientX)}>
                {m.error ? (
                  <span className="absolute inset-0 px-2 text-[11px] leading-4 text-amber-300 truncate">{m.error}</span>
                ) : (
                  stays.map((s, i) => (
                    <span
                      key={i}
                      className="absolute top-0 bottom-0"
                      style={{ left: `${((s.from - from) / span) * 100}%`, width: `${Math.max(0.15, ((s.to - s.from) / span) * 100)}%`, background: stayColor(s.name, s.value, isError) }}
                      title={`${s.name}: ${clock(s.from, days)} – ${clock(s.to, days)} (${Math.round((s.to - s.from) / 1000)} s)`}
                    />
                  ))
                )}
                {marks.map((mk, i) => (
                  <span key={i} className="board-playback-mark absolute top-0 bottom-0 w-0.5 bg-rose-500" style={{ left: `${((mk.t - from) / span) * 100}%` }} title={mk.label} />
                ))}
                <span className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none" style={{ left: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        <div className="flex items-center gap-2 h-5">
          <span className={`${label} shrink-0`} />
          <div ref={lanes} className="relative flex-1 h-3 cursor-pointer" onMouseDown={(e) => seekAt(e.clientX)} onMouseMove={(e) => e.buttons === 1 && seekAt(e.clientX)}>
            <div className="absolute inset-x-0 top-1 h-1 rounded bg-slate-700" />
            <div className="absolute top-0 w-3 h-3 -ml-1.5 rounded-full bg-violet-400" style={{ left: `${pct}%` }} />
          </div>
        </div>
      </div>
    </section>
  );
};
