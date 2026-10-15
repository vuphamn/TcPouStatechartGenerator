/**
 * The operator board's playback: the machines chosen, as the gateway recorded them over a time window, shown again
 * on the board (each tile's state at the playback time) and as lanes on a timeline (a bar per stay, coloured by its
 * kind). Values are { t, value } in time order, the first one the value when the window starts.
 */

export interface RecordedValue {
  t: number;
  value: number;
}

export interface PlaybackMachine {
  plc: string;
  path: string;
  /** The recording it came from */
  recording: string;
  stateNames: Record<string, string>;
  values: RecordedValue[];
  error?: string;
}

export interface Stay {
  from: number;
  to: number;
  value: number;
  name: string;
}

/** The last value at or before t (binary search); -1: none yet */
export function indexAt(values: { t: number }[], t: number): number {
  let lo = 0;
  let hi = values.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** The machine's state at t: its value, name and since when (null: nothing recorded yet) */
export function stateAt(m: PlaybackMachine, t: number): { value: number; name: string; since: number } | null {
  const i = indexAt(m.values, t);
  if (i < 0) return null;
  const v = m.values[i].value;
  // (since: the start of this stay, not a repeated sample of the same value)
  let s = i;
  while (s > 0 && m.values[s - 1].value === v) s--;
  return { value: v, name: m.stateNames[String(v)] ?? `#${v}`, since: m.values[s].t };
}

/** The stays between from and to (the same value repeated: one stay) */
export function staysOf(m: PlaybackMachine, from: number, to: number): Stay[] {
  const out: Stay[] = [];
  for (let i = 0; i < m.values.length; i++) {
    const a = m.values[i];
    if (a.t >= to) break;
    const end = Math.min(m.values[i + 1]?.t ?? to, to);
    const last = out[out.length - 1];
    if (last && last.value === a.value) {
      last.to = end;
      continue;
    }
    if (end <= from) continue;
    out.push({ from: Math.max(a.t, from), to: end, value: a.value, name: m.stateNames[String(a.value)] ?? `#${a.value}` });
  }
  return out.filter((s) => s.to > s.from);
}

/** Every change time of the machines in the window (the playback's "next change" and "previous change") */
export function changeTimes(ms: PlaybackMachine[], from: number, to: number): number[] {
  const set = new Set<number>();
  for (const m of ms) for (let i = 1; i < m.values.length; i++) if (m.values[i].value !== m.values[i - 1].value && m.values[i].t > from && m.values[i].t <= to) set.add(m.values[i].t);
  return [...set].sort((a, b) => a - b);
}

/** The playback window's presets: the last hour, 8 hours (a shift), a day */
export const PLAYBACK_WINDOWS = [
  { label: 'Last hour', ms: 3600_000 },
  { label: 'Last 8 h', ms: 8 * 3600_000 },
  { label: 'Last 24 h', ms: 24 * 3600_000 },
];

/** Playback speeds (times real time) */
export const PLAYBACK_SPEEDS = [1, 10, 60, 600];
