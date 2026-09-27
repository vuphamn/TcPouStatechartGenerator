/**
 * Live recordings: every live session is recorded as it runs (the state variable's samples and the guard values, with
 * PLC time stamps). Save recording writes it to a file; Replay plays one back on the diagram, as if live, at a chosen
 * speed, with a slider to any moment (for what happened at night, or on another machine).
 */

import type { LiveValue } from './liveGuards.ts';

export const RECORDING_KIND = 'kval-statescope-recording';
const MAX_VALUES = 500000;
const MAX_VARS = 500000;

export interface LiveRecording {
  kind: typeof RECORDING_KIND;
  version: 1;
  /** The POU type, its file, the PLC instance and target followed */
  pou?: string;
  pouFile?: string;
  instance?: string;
  target?: string;
  stateVar: string;
  /** PC time the recording started / ended (ms since 1970) */
  started: number;
  ended: number;
  /** State variable samples (PLC time) */
  values: { t: number; value: number }[];
  /** Guard values (PLC time), and where each variable was found */
  vars: { id: string; t: number; v: LiveValue | null }[];
  watched: Record<string, { symbol?: string; type?: string; error?: string }>;
  /** Samples were dropped at the limit */
  truncated?: boolean;
}

export class LiveRecorder {
  values: LiveRecording['values'] = [];
  vars: LiveRecording['vars'] = [];
  watched: LiveRecording['watched'] = {};
  started = 0;
  truncated = false;

  reset(): void {
    this.values = [];
    this.vars = [];
    this.watched = {};
    this.started = Date.now();
    this.truncated = false;
  }

  addValues(events: { t: number; value: number }[]): void {
    if (!this.started) this.started = Date.now();
    for (const e of events) {
      if (this.values.length >= MAX_VALUES) {
        this.truncated = true;
        return;
      }
      this.values.push({ t: e.t, value: e.value });
    }
  }

  addVars(values: { id: string; t: number; v: LiveValue | null }[]): void {
    for (const s of values) {
      if (this.vars.length >= MAX_VARS) {
        this.truncated = true;
        return;
      }
      this.vars.push({ id: s.id, t: s.t, v: s.v ?? null });
    }
  }

  addWatched(vars: { id: string; symbol?: string; type?: string; error?: string }[]): void {
    for (const v of vars) this.watched[v.id] = { symbol: v.symbol, type: v.type, error: v.error };
  }

  get empty(): boolean {
    return this.values.length === 0;
  }

  toRecording(meta: Pick<LiveRecording, 'pou' | 'pouFile' | 'instance' | 'target' | 'stateVar'>): LiveRecording {
    return {
      kind: RECORDING_KIND, version: 1, ...meta, started: this.started, ended: Date.now(),
      values: this.values, vars: this.vars, watched: this.watched, ...(this.truncated ? { truncated: true } : {}),
    };
  }
}

/** A recording from a file's text, or why not */
export function parseRecording(text: string): LiveRecording | { error: string } {
  let r: Partial<LiveRecording>;
  try {
    r = JSON.parse(text) as Partial<LiveRecording>;
  } catch {
    return { error: 'Not a live recording (not JSON)' };
  }
  if (r?.kind !== RECORDING_KIND || !Array.isArray(r.values)) return { error: 'Not a Kval StateScope live recording' };
  const values = r.values.filter((v) => v && Number.isFinite(v.t) && Number.isFinite(v.value)).sort((a, b) => a.t - b.t);
  if (!values.length) return { error: 'The recording has no samples' };
  const vars = (Array.isArray(r.vars) ? r.vars : []).filter((v) => v && typeof v.id === 'string' && Number.isFinite(v.t)).sort((a, b) => a.t - b.t);
  return {
    kind: RECORDING_KIND, version: 1, pou: r.pou, pouFile: r.pouFile, instance: r.instance, target: r.target, stateVar: r.stateVar || 'machineState',
    started: Number(r.started) || values[0].t, ended: Number(r.ended) || values[values.length - 1].t, values, vars,
    watched: r.watched && typeof r.watched === 'object' ? r.watched : {}, truncated: !!r.truncated,
  };
}

/** The recording's time span (PLC time) */
export const recordingSpan = (r: LiveRecording) => ({ from: r.values[0].t, to: Math.max(r.values[r.values.length - 1].t, r.vars.length ? r.vars[r.vars.length - 1].t : 0) });

/** The file name for a recording: POU, instance's last part, date and time */
export function recordingFileName(pou: string | undefined, instance: string | undefined, at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}_${pad(at.getHours())}${pad(at.getMinutes())}`;
  const inst = instance?.split('.').pop();
  return `${[pou || 'live', inst].filter(Boolean).join('_')}_${stamp}.kssrec.json`.replace(/[^\w.[\]-]+/g, '_');
}

/** Index of the first item with t > time (binary search over t, ascending) */
export function upperBound(items: { t: number }[], time: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].t <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
