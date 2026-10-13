/**
 * Watch expressions (the Live tab's watched list, an entry starting with "="): computed here from the watched values,
 * e.g. "= bA AND NOT bB", "= fPos - fTarget", "= nCount >= 10". Structured Text's operators: NOT, AND / AND_THEN, OR /
 * OR_ELSE, XOR, comparisons (=, <>, <, >, <=, >=), + - * / MOD, unary minus, parentheses; TRUE / FALSE, numbers,
 * variables (a path: fbAxis.nCount). The variables it reads are watched with it.
 */
export type ExprValue = boolean | number | string;
type Node =
  | { k: 'num'; v: number }
  | { k: 'bool'; v: boolean }
  | { k: 'var'; name: string }
  | { k: 'un'; op: 'NOT' | '-'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node };

const TOKEN = /\s*(?:(\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*|\[\d+\])*)|(<>|<=|>=|:=|[-+*/()=<>]))/y;

function tokens(src: string): string[] {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m || m.index !== i) throw new Error(`Not understood at "${src.slice(i).trim().slice(0, 12)}"`);
    out.push(m[1] ?? m[2] ?? m[3]);
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
    if (/^\d/.test(tk)) return { k: 'num', v: Number(tk) };
    if (/^(TRUE|FALSE)$/i.test(tk)) return { k: 'bool', v: /^TRUE$/i.test(tk) };
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

/** A watched entry that is an expression: "= …" */
export const isWatchExpr = (entry: string) => /^\s*=/.test(entry);
export const exprText = (entry: string) => entry.replace(/^\s*=\s*/, '');
