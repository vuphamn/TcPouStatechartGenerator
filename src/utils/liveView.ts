/**
 * Live view (TwinCAT XAE extension): turns the values of the state variable read from the running PLC into
 * states and transitions, checked against the diagram's transitions.
 */

import type { EdgeInfo } from '../types.ts';
import { blankComments, enumListRange } from './stateMachineLint.ts';

/** Numeric value -> member name of the enum in a .TcDUT (implicit values count up from the previous one) */
export function enumValueMap(dutContent: string): Map<number, string> {
  const map = new Map<number, string>();
  if (!dutContent?.trim()) return map;
  const decl = dutContent.match(/<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1] ?? dutContent;
  const range = enumListRange(decl);
  if (!range) return map;
  let next: number | null = 0;
  for (const part of blankComments(decl).slice(range.start + 1, range.end).split(',')) {
    const m = part.match(/^\s*([A-Za-z_]\w*)\s*(?::=\s*([^\s]+))?/);
    if (!m) continue;
    let value: number | null = next;
    if (m[2] !== undefined) value = parseIntegerLiteral(m[2]);
    if (value !== null && !map.has(value)) map.set(value, m[1]);
    next = value === null ? null : value + 1;
  }
  return map;
}

/** IEC integer literal: 12, -3, 16#FF, 2#1010, 8#17 (underscores allowed); null when not a literal */
export function parseIntegerLiteral(text: string): number | null {
  const t = text.replace(/_/g, '').replace(/^[A-Z_]+#(?=[-\d])/i, '');
  const based = t.match(/^(2|8|16)#([0-9A-F]+)$/i);
  if (based) return parseInt(based[2], Number(based[1]));
  return /^-?\d+$/.test(t) ? parseInt(t, 10) : null;
}

export interface LiveTransition {
  /** PLC time, ms since 1970 */
  t: number;
  from: string;
  to: string;
  /** Time spent in `from` */
  dwellMs: number;
  /** The diagram has this transition */
  inModel: boolean;
}

export interface LiveSession {
  current: { state: string; value: number; since: number } | null;
  transitions: LiveTransition[];
  /** Transitions not in the diagram */
  unexpected: number;
  /** PC clock minus PLC clock (ms), from the latest sample: the time in state is shown on the PC clock */
  clockOffset?: number;
}

export const EMPTY_LIVE_SESSION: LiveSession = { current: null, transitions: [], unexpected: 0 };

/** Transitions kept per session (the oldest are dropped) */
export const MAX_LIVE_TRANSITIONS = 5000;

export const liveStateName = (value: number, names: Map<number, string>) => names.get(value) ?? `#${value}`;

/** Applies new samples: a changed value is a transition from the current state */
export function applyLiveSamples(
  session: LiveSession,
  samples: { t: number; value: number }[],
  names: Map<number, string>,
  edges: EdgeInfo[]
): LiveSession {
  let { current, unexpected } = session;
  let transitions = session.transitions;
  let added: LiveTransition[] | null = null;
  for (const s of samples) {
    if (current && current.value === s.value) continue;
    const state = liveStateName(s.value, names);
    if (current) {
      const inModel = edges.some((e) => e.from === current!.state && e.to === state);
      if (!inModel) unexpected++;
      (added ??= []).push({ t: s.t, from: current.state, to: state, dwellMs: Math.max(0, s.t - current.since), inModel });
    }
    current = { state, value: s.value, since: s.t };
  }
  if (added) {
    transitions = transitions.concat(added);
    if (transitions.length > MAX_LIVE_TRANSITIONS) transitions = transitions.slice(transitions.length - MAX_LIVE_TRANSITIONS);
  }
  const clockOffset = samples.length ? Date.now() - samples[samples.length - 1].t : session.clockOffset;
  return current === session.current && !added && clockOffset === session.clockOffset
    ? session
    : { current, transitions, unexpected, clockOffset };
}

/** "14:23:05.120" in local time */
export function formatClock(t: number): string {
  const d = new Date(t);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** "850 ms", "12.4 s", "3 min 05 s", "2 h 07 min" */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(Math.floor(s % 60)).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
