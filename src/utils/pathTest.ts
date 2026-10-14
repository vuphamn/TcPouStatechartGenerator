/**
 * A TcUnit test from a path of the chart (the Paths tab), with no recording: each step's guard read for the inputs
 * that make it true (bStart → TRUE, NOT bStop → FALSE, nCount >= 10 → 10, eMode = E_Mode.Auto → that member; of an
 * OR its first side), written before the step; what cannot be set from outside (another block's output, a call, a
 * timer's Q) said in a comment there. The test as generateTcUnitTest makes it from a recording.
 */
import { parseExpr } from './watchExpr.ts';
import { generateTcUnitTest } from './tcunitTest.ts';
import type { PathStep } from './statePaths.ts';

type N = Extract<ReturnType<typeof parseExpr>, { node: unknown }>['node'];

export interface GuardInputs {
  /** name → the value written (a number, TRUE / FALSE, or an enum member / literal as ST text) */
  set: { name: string; value: boolean | number | string }[];
  /** What cannot be set from outside, or not understood */
  notes: string[];
}

const literalOf = (n: N): boolean | number | string | null => (n.k === 'num' ? n.v : n.k === 'bool' ? n.v : n.k === 'var' && /\./.test(n.name) && /^[A-Z]_?\w*\./.test(n.name) ? n.name : null);

/** A guard (ST) → the inputs that make it true */
export function guardInputs(guard: string): GuardInputs {
  const out: GuardInputs = { set: [], notes: [] };
  const g = guard.trim();
  if (!g || /^\(?always\)?$/i.test(g)) return out;
  const p = parseExpr(g);
  if ('error' in p) {
    out.notes.push(`not understood: ${g}`);
    return out;
  }
  const settable = (name: string) => !name.includes('.');
  const put = (name: string, value: boolean | number | string) => {
    if (!settable(name)) return out.notes.push(`set by its block, not from outside: ${name} = ${String(value)}`);
    if (!out.set.some((s) => s.name.toLowerCase() === name.toLowerCase())) out.set.push({ name, value });
  };
  const walk = (n: N): void => {
    if (n.k === 'var') return void put(n.name, true);
    if (n.k === 'un' && n.op === 'NOT' && n.a.k === 'var') return void put(n.a.name, false);
    if (n.k === 'bin' && n.op === 'AND') {
      walk(n.a);
      walk(n.b);
      return;
    }
    // (an OR: its first side)
    if (n.k === 'bin' && n.op === 'OR') return walk(n.a);
    if (n.k === 'bin' && ['=', '>=', '>', '<=', '<'].includes(n.op)) {
      const [v, lit, flip] = n.a.k === 'var' && literalOf(n.b) !== null ? [n.a.name, literalOf(n.b)!, false] : n.b.k === 'var' && literalOf(n.a) !== null ? [n.b.name, literalOf(n.a)!, true] : [null, null, false];
      if (v === null || lit === null) return void out.notes.push(`not set: ${g}`);
      const op = flip ? ({ '>': '<', '<': '>', '>=': '<=', '<=': '>=', '=': '=' } as Record<string, string>)[n.op] : n.op;
      const value = typeof lit === 'number' ? (op === '>' ? lit + 1 : op === '<' ? lit - 1 : lit) : lit;
      return void put(v, value);
    }
    out.notes.push(`not set: ${g}`);
  };
  walk(p.node);
  return out;
}

/**
 * A guard (ST) → the inputs that make it false (its other branch): bStart → FALSE, NOT bStop → TRUE, of an AND its first
 * side false, of an OR both, nCount >= 10 → 9, n = 5 → 6; an enum compared equal: said, not set (which other member?)
 */
export function guardFalseInputs(guard: string): GuardInputs {
  const out: GuardInputs = { set: [], notes: [] };
  const g = guard.trim();
  if (!g || /^\(?always\)?$/i.test(g)) {
    out.notes.push('no condition: it cannot be false');
    return out;
  }
  const p = parseExpr(g);
  if ('error' in p) {
    out.notes.push(`not understood: ${g}`);
    return out;
  }
  const put = (name: string, value: boolean | number | string) => {
    if (name.includes('.')) return out.notes.push(`set by its block, not from outside: ${name} = ${String(value)}`);
    if (!out.set.some((s) => s.name.toLowerCase() === name.toLowerCase())) out.set.push({ name, value });
  };
  const walk = (n: N): void => {
    if (n.k === 'var') return void put(n.name, false);
    if (n.k === 'un' && n.op === 'NOT') return walkTrue(n.a);
    // (an AND: its first side false; an OR: both)
    if (n.k === 'bin' && n.op === 'AND') return walk(n.a);
    if (n.k === 'bin' && n.op === 'OR') {
      walk(n.a);
      walk(n.b);
      return;
    }
    if (n.k === 'bin' && ['=', '>=', '>', '<=', '<', '<>'].includes(n.op)) {
      const [v, lit, flip] = n.a.k === 'var' && literalOf(n.b) !== null ? [n.a.name, literalOf(n.b)!, false] : n.b.k === 'var' && literalOf(n.a) !== null ? [n.b.name, literalOf(n.a)!, true] : [null, null, false];
      if (v === null || lit === null) return void out.notes.push(`not set: ${g}`);
      const op = flip ? ({ '>': '<', '<': '>', '>=': '<=', '<=': '>=', '=': '=', '<>': '<>' } as Record<string, string>)[n.op] : n.op;
      if (typeof lit !== 'number') return void (op === '<>' ? put(v, lit) : out.notes.push(`not set: ${v} another value than ${String(lit)}`));
      const value = op === '>=' ? lit - 1 : op === '>' ? lit : op === '<=' ? lit + 1 : op === '<' ? lit : op === '=' ? lit + 1 : lit;
      return void put(v, value);
    }
    out.notes.push(`not set: ${g}`);
  };
  // (NOT x false: x true)
  const walkTrue = (n: N): void => {
    const t = guardInputs(exprText(n));
    for (const s of t.set) put(s.name, s.value);
    out.notes.push(...t.notes);
  };
  walk(p.node);
  return out;
}

/** An expression's text again (for NOT (…): its inside made true) */
const exprText = (n: N): string =>
  n.k === 'var' ? n.name : n.k === 'num' ? String(n.v) : n.k === 'bool' ? (n.v ? 'TRUE' : 'FALSE') : n.k === 'un' ? `${n.op} (${exprText(n.a)})` : n.k === 'bin' ? `(${exprText(n.a)}) ${n.op} (${exprText(n.b)})` : '?';

/** The test suite for a path (its states one after another) → as generateTcUnitTest returns it */
export function generateTcUnitPathTest(o: {
  pou: string;
  enumType: string;
  stateVar: string;
  path: PathStep[];
  title?: string;
  started?: number;
  suiteName?: string;
  limitMs?: Record<string, number>;
  /** The first state when the path is empty (the hold's state is the start) */
  start?: string;
  /** At the path's end: a guard made false, the POU must not take its transition (a condition never seen false) */
  hold?: { to: string; guard: string };
}) {
  const states = [o.path[0]?.from ?? o.start ?? '', ...o.path.map((s) => s.to)];
  const values = states.map((_, i) => ({ t: (i + 1) * 1000, value: i }));
  const vars: { id: string; t: number; v: boolean | number | string | null }[] = [];
  const watched: Record<string, { symbol?: string }> = {};
  const notes: Record<number, string[]> = {};
  o.path.forEach((step, k) => {
    const g = guardInputs(step.guard);
    for (const s of g.set) {
      const id = s.name.toLowerCase();
      watched[id] = { symbol: `U.${s.name}` };
      vars.push({ id, t: (k + 2) * 1000 - 1, v: s.value });
    }
    if (g.notes.length) notes[k + 1] = g.notes;
  });
  return generateTcUnitTest({
    pou: o.pou,
    enumType: o.enumType,
    stateVar: o.stateVar,
    stateName: (v) => states[v] ?? String(v),
    run: { values, vars, watched, instance: 'U', started: o.started ?? Date.now() },
    title: o.title ?? `The path ${states.join(' → ')}`,
    rawStrings: true,
    limitMs: o.limitMs,
    notes,
    methodPrefix: 'Path',
    suiteName: o.suiteName,
    hold: o.hold
      ? (() => {
          const f = guardFalseInputs(o.hold.guard);
          return { to: o.hold.to, set: f.set, notes: f.notes, why: `${o.hold.guard} made false` };
        })()
      : undefined,
  });
}
