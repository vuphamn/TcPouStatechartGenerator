/**
 * Pause on state (a breakpoint on the chart's states, as a debugger's): when the PLC enters one of the chosen states,
 * a replay stops right there and the live view holds that moment (the PLC runs on: its samples are kept and shown on
 * Resume). The states chosen are kept per POU in this browser.
 */
import { liveStateName } from './liveView.ts';
import { evalExpr, parseExpr } from './watchExpr.ts';

const KEY = (pou: string) => `kss.pauseOn|${pou.toLowerCase()}`;

export function loadPauseOn(pou: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(pou)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
export function savePauseOn(pou: string, states: string[]): void {
  try {
    if (states.length) localStorage.setItem(KEY(pou), JSON.stringify(states));
    else localStorage.removeItem(KEY(pou));
  } catch {
    // (not kept)
  }
}

/**
 * The first sample that enters a chosen state: its value differs from the one before it (the first sample: from
 * `before`, the value shown so far) and names a chosen state (case not counted) → its index, or -1
 */
export function firstEntryInto(samples: { t: number; value: number }[], names: Map<number, string>, states: Set<string>, before?: number | null): number {
  if (!states.size) return -1;
  let prev = before ?? null;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i].value;
    if (v !== prev && states.has(liveStateName(v, names).toLowerCase())) return i;
    prev = v;
  }
  return -1;
}

/**
 * A replay's step from `pos` to `next` (ms of the recording): the first entry into a chosen state after `pos` up to
 * `next` → { t, state }, or null (the samples sorted by time; the value at `pos`: the last one at or before it)
 */
export function replayStopIn(values: { t: number; value: number }[], pos: number, next: number, names: Map<number, string>, states: Set<string>): { t: number; state: string } | null {
  if (!states.size || next <= pos) return null;
  // (the first sample after pos: binary search)
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid].t <= pos) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end < values.length && values[end].t <= next) end++;
  const i = firstEntryInto(values.slice(lo, end), names, states, lo > 0 ? values[lo - 1].value : null);
  if (i < 0) return null;
  const s = values[lo + i];
  return { t: s.t, state: liveStateName(s.value, names) };
}

// ---- Pause on a condition: a watched variable compared with a value (bError = TRUE, nCount > 10, eMode <> Auto)

export type PauseOp = '=' | '<>' | '<' | '>' | '<=' | '>=';
export interface PauseCondition {
  /** As typed (shown) */
  text: string;
  /** The variable as watched (its name), its live id (lower case) */
  name: string;
  id: string;
  op: PauseOp;
  value: boolean | number | string;
  /** An expression (bA AND nCount > 3, fPos - fTarget > 2): its tree and every variable it reads (ids lower case) */
  expr?: ReturnType<typeof parseExpr> & { node: unknown };
  ids?: string[];
  names?: string[];
}

/** A Pause on entry that is a condition (a comparison or logic: bError = TRUE, bA AND NOT bB), not a state */
export const isPauseCondition = (s: string) => /[<>=]|\s(AND|OR|XOR|AND_THEN|OR_ELSE)\s|^\s*NOT\b/i.test(s);

/** "bError = TRUE", "fbAxis.nCount >= 10", "eMode <> E_Mode.Auto" → the condition, or { error } */
export function parsePauseCondition(text: string): PauseCondition | { error: string } {
  const m = /^\s*([A-Za-z_][\w.[\]]*)\s*(<>|<=|>=|==|!=|=|<|>)\s*([^()]+?)\s*$/.exec(text);
  // (more than one comparison: an expression, as the watch expressions: bA AND nCount > 3)
  if (!m || /\b(AND|OR|XOR|NOT|MOD|AND_THEN|OR_ELSE)\b|[-+*/()]/i.test(m[3])) {
    const e = parseExpr(text);
    if ('error' in e) return { error: m ? e.error : 'A variable, a comparison (=, <>, <, >, <=, >=) and a value (bError = TRUE), or an expression (bA AND nCount > 3)' };
    if (!e.vars.length) return { error: 'The condition reads no variable' };
    return { text: text.trim().replace(/\s+/g, ' '), name: e.vars[0], id: e.vars[0].toLowerCase(), op: '=', value: true, expr: e as never, ids: e.vars.map((v) => v.toLowerCase()), names: e.vars };
  }
  const op = (m[2] === '!=' ? '<>' : m[2] === '==' ? '=' : m[2]) as PauseOp;
  const raw = m[3].replace(/^'(.*)'$/, '$1');
  const value: boolean | number | string = /^(TRUE|FALSE)$/i.test(raw) ? /^TRUE$/i.test(raw) : /^[-+]?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(raw) ? Number(raw) : raw;
  return { text: `${m[1]} ${op} ${m[3]}`, name: m[1], id: m[1].toLowerCase(), op, value };
}

/** Does a value meet the condition (an enum's value by its name, the type's name before it not counted) */
export function meetsCondition(c: PauseCondition, v: boolean | number | string | null | undefined, all?: Record<string, boolean | number | string>): boolean {
  if (c.expr) {
    const r = evalExpr((c.expr as { node: Parameters<typeof evalExpr>[0] }).node, (n) => all?.[n]);
    return r === true || (typeof r === 'number' && r !== 0);
  }
  if (v === null || v === undefined) return false;
  const num = (x: unknown) => (typeof x === 'boolean' ? (x ? 1 : 0) : typeof x === 'number' ? x : Number.NaN);
  if (typeof c.value === 'boolean' || typeof v === 'boolean') {
    const a = typeof v === 'boolean' ? v : /^TRUE$/i.test(String(v)) || num(v) === 1;
    const b = typeof c.value === 'boolean' ? c.value : /^TRUE$/i.test(String(c.value)) || num(c.value) === 1;
    return c.op === '=' ? a === b : c.op === '<>' ? a !== b : false;
  }
  if (typeof c.value === 'number' && Number.isFinite(Number(v))) {
    const a = Number(v);
    const b = c.value;
    return { '=': a === b, '<>': a !== b, '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b }[c.op];
  }
  const tail = (s: string) => s.split('.').pop()!.toLowerCase();
  const eq = tail(String(v)) === tail(String(c.value));
  return c.op === '=' ? eq : c.op === '<>' ? !eq : false;
}

/**
 * Live values arriving: the first condition that becomes met (it was not met before: an edge, not a level) → it, or
 * null; before: the values shown so far (by id)
 */
export function conditionMetIn(values: { id: string; v: boolean | number | string | null }[], conditions: PauseCondition[], before: Record<string, boolean | number | string>): PauseCondition | null {
  if (!conditions.length) return null;
  const now = { ...before };
  for (const s of values) {
    const was = now[s.id];
    const before = { ...now };
    if (s.v === null) delete now[s.id];
    else now[s.id] = s.v;
    for (const c of conditions) if ((c.ids ?? [c.id]).includes(s.id) && !meetsCondition(c, was, before) && meetsCondition(c, s.v, now)) return c;
  }
  return null;
}

/** A replay's step from pos to next: the first moment a condition becomes met (its recorded values) → { t, text }, or null */
export function replayConditionStopIn(vars: { id: string; t: number; v: boolean | number | string | null }[], pos: number, next: number, conditions: PauseCondition[]): { t: number; text: string } | null {
  if (!conditions.length || next <= pos) return null;
  const ids = new Set(conditions.flatMap((c) => c.ids ?? [c.id]));
  const at: Record<string, boolean | number | string> = {};
  for (const s of vars) {
    if (s.t > next) break;
    if (!ids.has(s.id)) continue;
    const was = at[s.id];
    const before = { ...at };
    if (s.v === null) delete at[s.id];
    else at[s.id] = s.v;
    if (s.t <= pos) continue;
    for (const c of conditions) if ((c.ids ?? [c.id]).includes(s.id) && !meetsCondition(c, was, before) && meetsCondition(c, s.v, at)) return { t: s.t, text: c.text };
  }
  return null;
}
