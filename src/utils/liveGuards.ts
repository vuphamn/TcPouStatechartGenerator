/**
 * Live guard values: the conditions of the transitions (the IF / ELSIF / ELSE context around each assignment of the
 * state variable), their variables read from the PLC, and the result worked out here with three-valued logic
 * (TRUE, FALSE, unknown). A variable that cannot be read (a method or property call, a local of doState(), a
 * pointer) is unknown; AND / OR still decide when another operand does (FALSE AND ? = FALSE).
 */

import type { GuardFrame, ModelEdge } from '../generator.ts';
import type { EdgeInfo } from '../types.ts';
import { enumValueMap } from './liveView.ts';

export type LiveValue = boolean | number | string;

// ---------------------------------------------------------------------------------------------------------------
// Expressions

export type Expr =
  | { k: 'lit'; v: LiveValue }
  | { k: 'ref'; path: string }
  | { k: 'un'; op: 'NOT' | '-'; e: Expr }
  | { k: 'bin'; op: string; a: Expr; b: Expr }
  | { k: 'call'; name: string; args: Expr[] }
  /** Bit access x.3: read x, take the bit */
  | { k: 'bit'; e: Expr; bit: number }
  /** Not readable (method call, pointer, computed index): always unknown */
  | { k: 'opaque'; text: string };

type Token = { t: 'num' | 'str' | 'id' | 'op' | 'time'; v: string; n?: number };

const TIME_UNITS: Record<string, number> = { d: 86400000, h: 3600000, m: 60000, s: 1000, ms: 1, us: 0.001, ns: 0.000001 };

/** T#1h2m3s4ms, TIME#1.5s, LTIME#5us -> ms; null when not a duration */
export function parseTimeLiteral(text: string): number | null {
  const m = text.match(/^(?:L?TIME|L?T)#(-)?(.+)$/i);
  if (!m) return null;
  const body = m[2].replace(/_/g, '').toLowerCase();
  let total = 0;
  let rest = body;
  const part = /^(\d+(?:\.\d+)?)(ms|us|ns|d|h|m|s)/;
  if (!rest) return null;
  while (rest) {
    const p = rest.match(part);
    if (!p) return null;
    total += parseFloat(p[1]) * TIME_UNITS[p[2]];
    rest = rest.slice(p[0].length);
  }
  return m[1] ? -total : total;
}

function tokenize(src: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^(?:L?TIME|L?T)#-?[\d_.]+[a-z_\d.]*/i))) {
      const ms = parseTimeLiteral(m[0]);
      if (ms === null) return null;
      out.push({ t: 'time', v: m[0], n: ms });
      i += m[0].length;
    } else if ((m = rest.match(/^(?:[A-Za-z_]\w*#)?(2|8|16)#([0-9A-Fa-f_]+)/))) {
      out.push({ t: 'num', v: m[0], n: parseInt(m[2].replace(/_/g, ''), Number(m[1])) });
      i += m[0].length;
    } else if ((m = rest.match(/^(?:[A-Za-z_]\w*#)?(\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/))) {
      out.push({ t: 'num', v: m[0], n: parseFloat(m[1].replace(/_/g, '')) });
      i += m[0].length;
    } else if ((m = rest.match(/^BOOL#(TRUE|FALSE|0|1)\b/i))) {
      out.push({ t: 'id', v: /TRUE|1/i.test(m[1]) ? 'TRUE' : 'FALSE' });
      i += m[0].length;
    } else if ((m = rest.match(/^([A-Za-z_]\w*)#([A-Za-z_]\w*)/))) {
      // Typed enum literal E_Mode#MEMBER: the same as E_Mode.MEMBER
      out.push({ t: 'id', v: m[1] }, { t: 'op', v: '.' }, { t: 'id', v: m[2] });
      i += m[0].length;
    } else if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) return null;
      out.push({ t: 'str', v: src.slice(i + 1, end).replace(/\$(.)/g, '$1') });
      i = end + 1;
    } else if ((m = rest.match(/^[A-Za-z_]\w*/))) {
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else if ((m = rest.match(/^(<>|<=|>=|\*\*|[=<>+\-*/(),.[\]^&])/))) {
      out.push({ t: 'op', v: m[0] });
      i += m[0].length;
    } else {
      return null;
    }
  }
  return out;
}

const KEYWORD_OPS = new Set(['AND', 'OR', 'XOR', 'NOT', 'MOD', 'AND_THEN', 'OR_ELSE']);

class Parser {
  private i = 0;
  constructor(private readonly toks: Token[]) {}

  private peek(): Token | undefined {
    return this.toks[this.i];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return !!t && ((t.t === 'op' && t.v === v) || (t.t === 'id' && t.v.toUpperCase() === v));
  }
  private take(v: string): boolean {
    if (!this.isOp(v)) return false;
    this.i++;
    return true;
  }
  done() {
    return this.i >= this.toks.length;
  }

  // Precedence (IEC 61131-3), lowest first: OR / OR_ELSE, XOR, AND / & / AND_THEN, = <>, < > <= >=, + -, * / MOD,
  // ** , unary NOT / -
  expr(): Expr {
    let a = this.xor();
    while (this.isOp('OR') || this.isOp('OR_ELSE')) {
      this.i++;
      a = { k: 'bin', op: 'OR', a, b: this.xor() };
    }
    return a;
  }
  private xor(): Expr {
    let a = this.and();
    while (this.take('XOR')) a = { k: 'bin', op: 'XOR', a, b: this.and() };
    return a;
  }
  private and(): Expr {
    let a = this.eq();
    while (this.isOp('AND') || this.isOp('&') || this.isOp('AND_THEN')) {
      this.i++;
      a = { k: 'bin', op: 'AND', a, b: this.eq() };
    }
    return a;
  }
  private eq(): Expr {
    let a = this.cmp();
    for (;;) {
      if (this.take('=')) a = { k: 'bin', op: '=', a, b: this.cmp() };
      else if (this.take('<>')) a = { k: 'bin', op: '<>', a, b: this.cmp() };
      else return a;
    }
  }
  private cmp(): Expr {
    let a = this.add();
    for (;;) {
      const op = ['<=', '>=', '<', '>'].find((o) => this.isOp(o));
      if (!op) return a;
      this.i++;
      a = { k: 'bin', op, a, b: this.add() };
    }
  }
  private add(): Expr {
    let a = this.mul();
    for (;;) {
      const op = ['+', '-'].find((o) => this.isOp(o));
      if (!op) return a;
      this.i++;
      a = { k: 'bin', op, a, b: this.mul() };
    }
  }
  private mul(): Expr {
    let a = this.pow();
    for (;;) {
      const op = ['*', '/', 'MOD'].find((o) => this.isOp(o));
      if (!op) return a;
      this.i++;
      a = { k: 'bin', op, a, b: this.pow() };
    }
  }
  private pow(): Expr {
    const a = this.unary();
    return this.take('**') ? { k: 'bin', op: '**', a, b: this.pow() } : a;
  }
  private unary(): Expr {
    if (this.take('NOT')) return { k: 'un', op: 'NOT', e: this.unary() };
    if (this.take('-')) return { k: 'un', op: '-', e: this.unary() };
    if (this.take('+')) return this.unary();
    return this.primary();
  }
  private primary(): Expr {
    const t = this.peek();
    if (!t) throw new Error('unexpected end');
    if (t.t === 'op' && t.v === '(') {
      this.i++;
      const e = this.expr();
      if (!this.take(')')) throw new Error('missing )');
      return e;
    }
    this.i++;
    if (t.t === 'num' || t.t === 'time') return { k: 'lit', v: t.n! };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t !== 'id' || KEYWORD_OPS.has(t.v.toUpperCase())) throw new Error(`unexpected ${t.v}`);
    const upper = t.v.toUpperCase();
    if (upper === 'TRUE') return { k: 'lit', v: true };
    if (upper === 'FALSE') return { k: 'lit', v: false };
    return this.reference(t.v);
  }
  /** a.b[2].c, THIS^.x, F(args), obj.Method(), p^ */
  private reference(first: string): Expr {
    const start = this.i - 1;
    const segs: string[] = [];
    let opaque = false;
    if (/^(THIS|SUPER)$/i.test(first) && this.isOp('^')) {
      this.i++;
      if (!this.take('.')) throw new Error('THIS^ without member');
      const next = this.peek();
      if (!next || next.t !== 'id') throw new Error('THIS^. without member');
      this.i++;
      segs.push(next.v);
    } else {
      segs.push(first);
    }
    for (;;) {
      if (this.isOp('.')) {
        this.i++;
        const next = this.peek();
        // Bit access: iMode.1 (an integer's bit)
        if (next?.t === 'num' && /^\d+$/.test(next.v) && !opaque) {
          this.i++;
          return { k: 'bit', e: { k: 'ref', path: segs.join('.') }, bit: Number(next.v) };
        }
        if (!next || next.t !== 'id') throw new Error('. without member');
        this.i++;
        segs.push(next.v);
      } else if (this.isOp('[')) {
        this.i++;
        const index = this.expr();
        if (!this.take(']')) throw new Error('missing ]');
        if (index.k === 'lit' && typeof index.v === 'number' && Number.isInteger(index.v)) segs[segs.length - 1] += `[${index.v}]`;
        else opaque = true;
      } else if (this.isOp('^')) {
        // A dereferenced pointer: TwinCAT resolves p^ in symbol names too (unknown when the PLC does not)
        this.i++;
        segs[segs.length - 1] += '^';
      } else if (this.isOp('(')) {
        this.i++;
        const args: Expr[] = [];
        // Formal parameters (IN := x) do not tokenize: such a condition is unknown as a whole
        if (!this.isOp(')')) {
          do args.push(this.expr());
          while (this.take(','));
        }
        if (!this.take(')')) throw new Error('missing )');
        if (segs.length === 1 && !opaque) return { k: 'call', name: segs[0].toUpperCase(), args };
        opaque = true;
      } else {
        break;
      }
    }
    if (opaque) return { k: 'opaque', text: this.textOf(start, this.i) };
    return { k: 'ref', path: segs.join('.') };
  }
  private textOf(from: number, to: number): string {
    return this.toks
      .slice(from, to)
      .map((t) => (t.t === 'str' ? `'${t.v}'` : t.v))
      .join('')
      .replace(/\b(AND|OR|XOR|MOD)\b/g, ' $1 ');
  }
}

const parseCache = new Map<string, Expr>();

/** The condition as an expression tree; a condition that does not parse is one opaque (unknown) term */
export function parseCondition(text: string): Expr {
  const key = text.trim();
  const hit = parseCache.get(key);
  if (hit) return hit;
  let e: Expr;
  const toks = tokenize(key);
  try {
    if (!toks || toks.length === 0) throw new Error('no tokens');
    const p = new Parser(toks);
    e = p.expr();
    if (!p.done()) throw new Error('trailing tokens');
  } catch {
    e = { k: 'opaque', text: key };
  }
  if (parseCache.size > 5000) parseCache.clear();
  parseCache.set(key, e);
  return e;
}

/** The condition under which a transition fires: every IF level's condition, and none of its earlier branches */
export function frameExpression(frames: GuardFrame[]): Expr {
  const parts: Expr[] = [];
  for (const f of frames) {
    for (const p of f.prior) parts.push({ k: 'un', op: 'NOT', e: parseCondition(p) });
    if (f.cond) parts.push(parseCondition(f.cond));
  }
  if (parts.length === 0) return { k: 'lit', v: true };
  return parts.reduce((a, b) => ({ k: 'bin', op: 'AND', a, b }));
}

// ---------------------------------------------------------------------------------------------------------------
// Evaluation

export interface EvalContext {
  /** A variable's value (undefined: unknown) */
  value(path: string): LiveValue | undefined;
}

const num = (v: LiveValue | undefined): number | undefined =>
  typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : undefined;

export function evaluate(e: Expr, ctx: EvalContext): LiveValue | undefined {
  switch (e.k) {
    case 'lit':
      return e.v;
    case 'ref':
      return ctx.value(e.path);
    case 'opaque':
      return undefined;
    case 'un': {
      const v = evaluate(e.e, ctx);
      if (v === undefined) return undefined;
      if (e.op === 'NOT') return typeof v === 'boolean' ? !v : typeof v === 'number' ? ~v : undefined;
      return typeof v === 'number' ? -v : undefined;
    }
    case 'bin': {
      if (e.op === 'AND' || e.op === 'OR') {
        const a = evaluate(e.a, ctx);
        const b = evaluate(e.b, ctx);
        if (typeof a === 'number' && typeof b === 'number') return e.op === 'AND' ? a & b : a | b;
        const short = e.op === 'AND' ? false : true;
        if (a === short || b === short) return short;
        if (typeof a === 'boolean' && typeof b === 'boolean') return !short;
        return undefined;
      }
      const a = evaluate(e.a, ctx);
      const b = evaluate(e.b, ctx);
      if (a === undefined || b === undefined) return undefined;
      if (e.op === 'XOR') {
        if (typeof a === 'boolean' && typeof b === 'boolean') return a !== b;
        const x = num(a);
        const y = num(b);
        return x === undefined || y === undefined ? undefined : x ^ y;
      }
      if (e.op === '=' || e.op === '<>') {
        const same = typeof a === 'string' || typeof b === 'string' ? a === b : num(a) === num(b);
        return e.op === '=' ? same : !same;
      }
      if (typeof a === 'string' && typeof b === 'string') {
        if (e.op === '<') return a < b;
        if (e.op === '>') return a > b;
        if (e.op === '<=') return a <= b;
        if (e.op === '>=') return a >= b;
        return e.op === '+' ? a + b : undefined;
      }
      const x = num(a);
      const y = num(b);
      if (x === undefined || y === undefined) return undefined;
      switch (e.op) {
        case '<': return x < y;
        case '>': return x > y;
        case '<=': return x <= y;
        case '>=': return x >= y;
        case '+': return x + y;
        case '-': return x - y;
        case '*': return x * y;
        case '/': return y === 0 ? undefined : x / y;
        case 'MOD': return y === 0 ? undefined : x % y;
        case '**': return x ** y;
        default: return undefined;
      }
    }
    case 'bit': {
      const v = evaluate(e.e, ctx);
      return typeof v === 'number' && Number.isInteger(v) ? Math.floor(v / 2 ** e.bit) % 2 === 1 : undefined;
    }
    case 'call': {
      const args = e.args.map((a) => num(evaluate(a, ctx)));
      if (args.some((a) => a === undefined)) return undefined;
      const n = args as number[];
      switch (e.name) {
        case 'ABS': return Math.abs(n[0]);
        case 'MIN': return n.length ? Math.min(...n) : undefined;
        case 'MAX': return n.length ? Math.max(...n) : undefined;
        case 'LIMIT': return n.length === 3 ? Math.min(Math.max(n[1], n[0]), n[2]) : undefined;
        case 'SEL': return n.length === 3 ? (n[0] ? n[2] : n[1]) : undefined;
        case 'TRUNC': return Math.trunc(n[0]);
        default:
          // Type conversions (INT_TO_REAL, TO_DINT, ...) keep the value
          return /^(\w+_TO_\w+|TO_\w+)$/.test(e.name) && n.length === 1 ? n[0] : undefined;
      }
    }
  }
}

/** Every variable path the expression reads */
export function collectRefs(e: Expr, out: Set<string> = new Set()): Set<string> {
  switch (e.k) {
    case 'ref': out.add(e.path); break;
    case 'un': collectRefs(e.e, out); break;
    case 'bin': collectRefs(e.a, out); collectRefs(e.b, out); break;
    case 'call': e.args.forEach((a) => collectRefs(a, out)); break;
    case 'bit': collectRefs(e.e, out); break;
  }
  return out;
}

export function collectOpaque(e: Expr, out: Set<string> = new Set()): Set<string> {
  switch (e.k) {
    case 'opaque': out.add(e.text); break;
    case 'un': collectOpaque(e.e, out); break;
    case 'bin': collectOpaque(e.a, out); collectOpaque(e.b, out); break;
    case 'call': e.args.forEach((a) => collectOpaque(a, out)); break;
    case 'bit': collectOpaque(e.e, out); break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Enums: literal values for conditions, and names for values

export interface EnumTables {
  /** Member name (lower case) -> value, over all known enums (first one wins) */
  literals: Map<string, number>;
  /** Enum type name (lower case) -> value -> member name */
  types: Map<string, Map<number, string>>;
}

export function buildEnumTables(dutContents: string[]): EnumTables {
  const literals = new Map<string, number>();
  const types = new Map<string, Map<number, string>>();
  for (const content of dutContents) {
    if (!content) continue;
    const name = content.match(/<DUT\b[^>]*\bName="([^"]+)"/)?.[1] ?? content.match(/\bTYPE\s+([A-Za-z_]\w*)\s*:/i)?.[1];
    const values = enumValueMap(content);
    if (!name || values.size === 0) continue;
    if (!types.has(name.toLowerCase())) types.set(name.toLowerCase(), values);
    for (const [v, member] of values) if (!literals.has(member.toLowerCase())) literals.set(member.toLowerCase(), v);
  }
  return { literals, types };
}

// ---------------------------------------------------------------------------------------------------------------
// The live model of the diagram's transitions

export interface GuardMember {
  /** The state whose CASE branch has the transition, or "AnyState" for preProcess() */
  from: string;
  source: string;
  expr: Expr;
  /** IF levels that test the state variable (preProcess() scope): they decide whether the transition applies */
  scope: Expr | null;
}

export interface GuardEdge {
  edgeId: string;
  from: string;
  to: string;
  members: GuardMember[];
  /** Variable paths read by the condition (enum literals and the state variable excluded) */
  refs: string[];
  /** The edge has a condition to show (unconditional edges are left alone) */
  conditional: boolean;
}

/** The diagram's edges (by their ids) matched to the model's edges, with their conditions parsed */
export function buildGuardEdges(model: ModelEdge[], edges: EdgeInfo[], stateVar: string, enums: EnumTables): GuardEdge[] {
  const pool = model.slice();
  const out: GuardEdge[] = [];
  const stateVarRx = new RegExp(`\\b${stateVar}\\b`, 'i');
  for (const e of edges) {
    if (e.from === '[*]' || e.to === '[*]') continue;
    const label = (e.label ?? '').trim();
    const at = pool.findIndex((m) => m.from === e.from && m.to === e.to && m.label === label);
    if (at < 0) continue;
    const m = pool.splice(at, 1)[0];
    const members: GuardMember[] = m.members.map((mem) => {
      const scopeFrames = mem.frames.filter((f) => f.cond && stateVarRx.test(f.cond) && m.source === 'preProcess');
      return {
        from: mem.from,
        source: m.source,
        expr: frameExpression(mem.frames),
        scope: scopeFrames.length ? frameExpression(scopeFrames.map((f) => ({ cond: f.cond, prior: [] }))) : null,
      };
    });
    const refs = new Set<string>();
    for (const mem of members) collectRefs(mem.expr, refs);
    const readable = [...refs].filter((r) => !isLiteralOrStateVar(r, stateVar, enums));
    const conditional = m.members.some((mem) => mem.frames.length > 0);
    out.push({ edgeId: e.id, from: e.from, to: e.to, members, refs: readable, conditional });
  }
  return out;
}

export function isLiteralOrStateVar(path: string, stateVar: string, enums: EnumTables): boolean {
  const lower = path.toLowerCase();
  if (lower === stateVar.toLowerCase()) return true;
  if (!lower.includes('.')) return enums.literals.has(lower);
  const [type, member, ...rest] = lower.split('.');
  return rest.length === 0 && enums.types.has(type) && enums.literals.has(member);
}

/** Where to look for a variable in the PLC: a member of the instance, else (with a dot) a global path */
export function symbolCandidates(path: string, instance: string): string[] {
  const own = `${instance}.${path}`;
  return path.includes('.') ? [own, path] : [own];
}

// ---------------------------------------------------------------------------------------------------------------
// Results for the diagram

export type GuardResult = 'true' | 'false' | 'unknown';

export interface GuardVarView {
  name: string;
  text: string;
  known: boolean;
  /** Why it is unknown (not found in the PLC, not readable) */
  note?: string;
}

export interface EdgeGuardView {
  result: GuardResult;
  vars: GuardVarView[];
  /** Show the values next to the condition (the active state's transitions, or the selected one) */
  detail: boolean;
}

export interface WatchedVar {
  symbol?: string;
  type?: string;
  error?: string;
}

/** A value for display: TRUE / FALSE, enum member names, durations, rounded reals, quoted strings */
export function formatLiveValue(v: LiveValue, type: string | undefined, enums: EnumTables): string {
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return `'${v}'`;
  const t = (type ?? '').toLowerCase();
  const names = enums.types.get(t) ?? enums.types.get(t.split('.').pop() ?? '');
  if (names) return names.has(v) ? `${names.get(v)}` : `${v}`;
  if (t === 'time' || t === 'ltime') return formatDurationLiteral(v);
  if (/^(l?real)$/.test(t) || !Number.isInteger(v)) return String(Number(v.toPrecision(6)));
  return String(v);
}

/** 1250 -> "T#1s250ms" */
export function formatDurationLiteral(ms: number): string {
  if (ms === 0) return 'T#0ms';
  const neg = ms < 0;
  let rest = Math.abs(ms);
  const parts: string[] = [];
  for (const [unit, size] of [['d', 86400000], ['h', 3600000], ['m', 60000], ['s', 1000]] as const) {
    if (rest >= size) {
      parts.push(`${Math.floor(rest / size)}${unit}`);
      rest %= size;
    }
  }
  if (rest > 0 || parts.length === 0) parts.push(`${Number(rest.toFixed(3))}ms`);
  return `T#${neg ? '-' : ''}${parts.join('')}`;
}

export interface GuardInputs {
  /** Live values by variable path (lower case) */
  values: Record<string, LiveValue>;
  /** Lookup results by variable path (lower case) */
  watched: Record<string, WatchedVar>;
  stateVar: string;
  /** The state variable's current value */
  stateValue: number | null;
  currentState: string | null;
  enums: EnumTables;
}

/** Normalized value for evaluation: LTIME is read in ns, compared in ms like T# literals */
function contextFor(inputs: GuardInputs): EvalContext {
  return {
    value(path) {
      const lower = path.toLowerCase();
      if (lower === inputs.stateVar.toLowerCase()) return inputs.stateValue ?? undefined;
      if (!lower.includes('.') && inputs.enums.literals.has(lower)) return inputs.enums.literals.get(lower);
      if (lower.includes('.')) {
        const [type, member, ...rest] = lower.split('.');
        if (rest.length === 0 && inputs.enums.types.has(type) && inputs.enums.literals.has(member)) return inputs.enums.literals.get(member);
      }
      const v = inputs.values[lower];
      if (v === undefined) return undefined;
      return typeof v === 'number' && (inputs.watched[lower]?.type ?? '').toUpperCase() === 'LTIME' ? v / 1e6 : v;
    },
  };
}

/** Does a transition apply to the current state (its CASE branch, or a preProcess() scope that holds)? */
export function appliesToState(member: GuardMember, inputs: GuardInputs): boolean {
  if (member.source !== 'preProcess') return member.from === inputs.currentState;
  if (!member.scope) return true;
  return evaluate(member.scope, contextFor(inputs)) !== false;
}

const toResult = (v: LiveValue | undefined): GuardResult => (v === true ? 'true' : v === false ? 'false' : 'unknown');

/** Result and variable values of each edge (by edge id) */
export function evaluateGuards(
  edges: GuardEdge[],
  inputs: GuardInputs,
  showAll: boolean,
  detailEdgeId: string | null
): Record<string, EdgeGuardView> {
  const ctx = contextFor(inputs);
  const out: Record<string, EdgeGuardView> = {};
  for (const e of edges) {
    if (!e.conditional) continue;
    const applying = e.members.filter((m) => appliesToState(m, inputs));
    const active = applying.length > 0;
    if (!active && !showAll) continue;
    const members = active ? applying : e.members;
    // An edge that stands for several transitions fires when one of them does
    let result: GuardResult = 'false';
    for (const m of members) {
      const r = toResult(evaluate(m.expr, ctx));
      if (r === 'true') {
        result = 'true';
        break;
      }
      if (r === 'unknown') result = 'unknown';
    }
    const vars: GuardVarView[] = [];
    const opaque = new Set<string>();
    for (const m of members) collectOpaque(m.expr, opaque);
    for (const path of e.refs) {
      const lower = path.toLowerCase();
      const v = inputs.values[lower];
      const w = inputs.watched[lower];
      if (v !== undefined) vars.push({ name: path, text: formatLiveValue(v, w?.type, inputs.enums), known: true });
      else {
        // An all-caps name the PLC does not have is an enum value or a constant whose declaration was not found
        const literal = w?.error && !w.symbol && /^[A-Z][A-Z0-9]*_[A-Z0-9_]*$/.test(path);
        const note = literal ? 'an enum value or constant: its .TcDUT / GVL was not found with the POU' : w?.error ?? (w ? undefined : 'not read yet');
        vars.push({ name: path, text: '?', known: false, note });
      }
    }
    for (const text of opaque) vars.push({ name: text, text: '?', known: false, note: 'cannot be read over ADS (call, pointer or computed index)' });
    out[e.edgeId] = { result, vars, detail: active || e.edgeId === detailEdgeId };
  }
  return out;
}

/** The variables to follow: those of the active state's transitions, or of every transition */
export function variablesToWatch(edges: GuardEdge[], inputs: GuardInputs, showAll: boolean): string[] {
  const set = new Map<string, string>();
  for (const e of edges) {
    if (!e.conditional) continue;
    if (!showAll && !e.members.some((m) => appliesToState(m, inputs))) continue;
    for (const r of e.refs) if (!set.has(r.toLowerCase())) set.set(r.toLowerCase(), r);
  }
  return [...set.values()];
}
