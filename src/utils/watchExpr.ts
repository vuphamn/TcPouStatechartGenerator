/**
 * Watch expressions (the Live tab's watched list, an entry starting with "="): computed here from the watched values,
 * e.g. "= bA AND NOT bB", "= fPos - fTarget", "= nCount >= 10". Structured Text's operators: NOT, AND / AND_THEN, OR /
 * OR_ELSE, XOR, comparisons (=, <>, <, >, <=, >=), + - * / MOD, unary minus, parentheses; TRUE / FALSE, numbers,
 * typed literals (16#FF, 2#1010, T#2S: in ms), functions (ABS, MIN, MAX, LIMIT, SEL, TRUNC, SQRT), variables (a path:
 * fbAxis.nCount). The variables it reads are watched with it.
 */
export type ExprValue = boolean | number | string;
type Node =
  | { k: 'num'; v: number }
  | { k: 'bool'; v: boolean }
  | { k: 'var'; name: string }
  | { k: 'un'; op: 'NOT' | '-'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] };

/** The functions an expression may call (Structured Text's): their names and how many arguments */
const FUNCTIONS: Record<string, [number, number]> = { ABS: [1, 1], MIN: [2, 8], MAX: [2, 8], LIMIT: [3, 3], SEL: [3, 3], TRUNC: [1, 1], SQRT: [1, 1] };

// (a typed literal first: 16#FF, 8#17, 2#1010, T#2S / TIME#1M30S; then a number, a name, an operator)
const TOKEN = /\s*(?:((?:16#[0-9A-Fa-f_]+|8#[0-7_]+|2#[01_]+)|(?:L?TIME|L?T)#-?[\d.a-zA-Z_]+)|(\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*|\[\d+\])*)|(<>|<=|>=|:=|[-+*/()=<>,]))/y;

/** A typed literal's value: 16#FF → 255, T#1s500ms → 1500 (ms); null when not one */
export function typedLiteral(tk: string): number | null {
  const t = tk.replace(/_/g, '');
  const b = /^(16|8|2)#([0-9a-f]+)$/i.exec(t);
  if (b) return parseInt(b[2], Number(b[1]));
  const d = /^(?:L?TIME|L?T)#(-)?(.+)$/i.exec(t);
  if (!d) return null;
  const units: Record<string, number> = { d: 86400000, h: 3600000, m: 60000, s: 1000, ms: 1 };
  let rest = d[2].toLowerCase();
  let total = 0;
  while (rest) {
    const p = /^(\d+(?:\.\d+)?)(ms|d|h|m|s)/.exec(rest);
    if (!p) return null;
    total += Number(p[1]) * units[p[2]];
    rest = rest.slice(p[0].length);
  }
  return d[1] ? -total : total;
}

function tokens(src: string): string[] {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m || m.index !== i) throw new Error(`Not understood at "${src.slice(i).trim().slice(0, 12)}"`);
    out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
    i = TOKEN.lastIndex;
  }
  return out;
}

/** An expression parsed → its tree, or { error } */
export function parseExpr(src: string): { node: Node; vars: string[] } | { error: string } {
  let t: string[];
  try {
    t = tokens(src);
  } catch (e) {
    return { error: (e as Error).message };
  }
  let p = 0;
  const vars = new Set<string>();
  const peek = () => (t[p] ?? '').toUpperCase();
  const next = () => t[p++];
  const level = (ops: string[], sub: () => Node) => (): Node => {
    let a = sub();
    while (ops.includes(peek())) {
      const op = next().toUpperCase();
      a = { k: 'bin', op: op === 'AND_THEN' ? 'AND' : op === 'OR_ELSE' ? 'OR' : op, a, b: sub() };
    }
    return a;
  };
  const primary = (): Node => {
    const tk = next();
    if (tk === undefined) throw new Error('Unfinished');
    if (tk === '(') {
      const e = expr();
      if (next() !== ')') throw new Error('A ) is missing');
      return e;
    }
    if (tk.toUpperCase() === 'NOT') return { k: 'un', op: 'NOT', a: unary() };
    if (tk.includes('#')) {
      const v = typedLiteral(tk);
      if (v === null) throw new Error(`Not a literal: ${tk}`);
      return { k: 'num', v };
    }
    if (/^\d/.test(tk)) return { k: 'num', v: Number(tk) };
    if (/^(TRUE|FALSE)$/i.test(tk)) return { k: 'bool', v: /^TRUE$/i.test(tk) };
    // (a function: ABS(x), MIN(a, b, …), LIMIT(mn, x, mx), SEL(g, a, b), TRUNC(x), SQRT(x))
    if (t[p] === '(' && FUNCTIONS[tk.toUpperCase()]) {
      const fn = tk.toUpperCase();
      next();
      const args: Node[] = [expr()];
      while (t[p] === ',') {
        next();
        args.push(expr());
      }
      if (next() !== ')') throw new Error('A ) is missing');
      const [lo, hi] = FUNCTIONS[fn];
      if (args.length < lo || args.length > hi) throw new Error(`${fn} takes ${lo === hi ? lo : `${lo} to ${hi}`} argument${hi === 1 ? '' : 's'}`);
      return { k: 'call', fn, args };
    }
    if (/^[A-Za-z_]/.test(tk)) {
      vars.add(tk);
      return { k: 'var', name: tk };
    }
    throw new Error(`Not understood: ${tk}`);
  };
  const unary = (): Node => (peek() === '-' ? (next(), { k: 'un', op: '-', a: unary() }) : primary());
  const mul = level(['*', '/', 'MOD'], unary);
  const add = level(['+', '-'], mul);
  const cmp = level(['=', '<>', '<', '>', '<=', '>='], add);
  const and = level(['AND', 'AND_THEN', '&'], cmp);
  const xor = level(['XOR'], and);
  const or = level(['OR', 'OR_ELSE'], xor);
  const expr = or;
  try {
    const node = expr();
    if (p < t.length) throw new Error(`Not understood at ${t[p]}`);
    return { node, vars: [...vars] };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const num = (v: ExprValue): number => (typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? v : Number(v));
const bool = (v: ExprValue): boolean => (typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : /^TRUE$/i.test(v));

/** Its value from the variables' (by lower-case name); null while one is not known */
export function evalExpr(node: Node, values: (name: string) => ExprValue | undefined): ExprValue | null {
  const ev = (n: Node): ExprValue | null => {
    switch (n.k) {
      case 'num':
        return n.v;
      case 'bool':
        return n.v;
      case 'var': {
        const v = values(n.name.toLowerCase());
        return v === undefined ? null : v;
      }
      case 'un': {
        const a = ev(n.a);
        if (a === null) return null;
        return n.op === 'NOT' ? (typeof a === 'number' ? ~a : !bool(a)) : -num(a);
      }
      case 'call': {
        const a = n.args.map(ev);
        if (a.some((x) => x === null)) return null;
        const v = a as ExprValue[];
        switch (n.fn) {
          case 'ABS':
            return Math.abs(num(v[0]));
          case 'MIN':
            return Math.min(...v.map(num));
          case 'MAX':
            return Math.max(...v.map(num));
          case 'LIMIT':
            return Math.min(num(v[2]), Math.max(num(v[0]), num(v[1])));
          case 'SEL':
            return bool(v[0]) ? v[2] : v[1];
          case 'TRUNC':
            return Math.trunc(num(v[0]));
          case 'SQRT':
            return num(v[0]) < 0 ? null : Math.sqrt(num(v[0]));
        }
        return null;
      }
      case 'bin': {
        let a = ev(n.a);
        let b = ev(n.b);
        // (eMode = Auto: a name that is no variable, compared with an enum's value, is its member)
        if ((n.op === '=' || n.op === '<>') && typeof b === 'string' && a === null && n.a.k === 'var') a = n.a.name;
        if ((n.op === '=' || n.op === '<>') && typeof a === 'string' && b === null && n.b.k === 'var') b = n.b.name;
        if (a === null || b === null) return null;
        switch (n.op) {
          case 'AND':
          case '&':
            return typeof a === 'number' && typeof b === 'number' ? a & b : bool(a) && bool(b);
          case 'OR':
            return typeof a === 'number' && typeof b === 'number' ? a | b : bool(a) || bool(b);
          case 'XOR':
            return typeof a === 'number' && typeof b === 'number' ? a ^ b : bool(a) !== bool(b);
          case '+':
            return num(a) + num(b);
          case '-':
            return num(a) - num(b);
          case '*':
            return num(a) * num(b);
          case '/':
            return num(b) === 0 ? null : num(a) / num(b);
          case 'MOD':
            return num(b) === 0 ? null : num(a) % num(b);
          case '=':
            return typeof a === 'string' || typeof b === 'string' ? String(a).split('.').pop()!.toLowerCase() === String(b).split('.').pop()!.toLowerCase() : num(a) === num(b);
          case '<>':
            return typeof a === 'string' || typeof b === 'string' ? String(a).split('.').pop()!.toLowerCase() !== String(b).split('.').pop()!.toLowerCase() : num(a) !== num(b);
          case '<':
            return num(a) < num(b);
          case '>':
            return num(a) > num(b);
          case '<=':
            return num(a) <= num(b);
          case '>=':
            return num(a) >= num(b);
        }
        return null;
      }
    }
  };
  return ev(node);
}

/**
 * The live state in an expression: _state (its name, compared as an enum member: _state = TABLEMANAGER_CLAMPED) and
 * _inState (how long the PLC is in it, ms: _inState > T#30S); not PLC variables (not asked of the PLC)
 */
export const isStateVar = (name: string) => /^_(state|instate)$/i.test(name);

/** The values an expression reads: the PLC's (by lower-case name), then _state and _inState */
export const withState = (values: (name: string) => ExprValue | undefined, state: { name: string; sinceMs: number } | null | undefined) => (name: string): ExprValue | undefined =>
  name === '_state' ? state?.name : name === '_instate' ? (state ? Math.max(0, Date.now() - state.sinceMs) : undefined) : values(name);

/** A watched entry that is an expression: "= …" */
export const isWatchExpr = (entry: string) => /^\s*=/.test(entry);
export const exprText = (entry: string) => entry.replace(/^\s*=\s*/, '');
