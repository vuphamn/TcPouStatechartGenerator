/**
 * A condition's syntax, checked while it is typed (before it goes into doState()): brackets, operands and operators,
 * and the usual slips from other languages (:= / == / != / && / || / !). Lenient about what ST allows: calls with
 * named parameters, members, indexes, dereferences, bit access, typed and time literals.
 */

type Tok = { t: 'id' | 'num' | 'str' | 'op' | 'open' | 'close' | 'comma'; v: string; at: number };

const WORD_OPS = new Set(['AND', 'OR', 'XOR', 'MOD', 'AND_THEN', 'OR_ELSE']);
const BIN_OPS = new Set(['=', '<>', '<', '>', '<=', '>=', '+', '-', '*', '/', '**']);
const STATEMENT_WORDS = new Set(['IF', 'THEN', 'ELSE', 'ELSIF', 'END_IF', 'CASE', 'OF', 'END_CASE', 'FOR', 'WHILE', 'DO', 'REPEAT', 'UNTIL', 'RETURN']);

function tokenize(src: string): Tok[] | string {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const rest = src.slice(i);
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (rest.startsWith('(*')) {
      const end = src.indexOf('*)', i + 2);
      if (end < 0) return 'A comment (* is not closed with *)';
      i = end + 2;
      continue;
    }
    if (rest.startsWith('//')) break;
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) return `A string is not closed (${c})`;
      out.push({ t: 'str', v: src.slice(i, end + 1), at: i });
      i = end + 1;
      continue;
    }
    // Typed / time / based literals: T#5s, TIME#1h, 16#FF, INT#5, E_X#VALUE, 1.5E3, 2#1010
    let m = rest.match(/^(?:[A-Za-z_]\w*#[\w.:+-]+|\d+#[0-9A-Fa-f_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/);
    if (m && /^\d|#/.test(m[0])) {
      out.push({ t: 'num', v: m[0], at: i });
      i += m[0].length;
      continue;
    }
    m = rest.match(/^[A-Za-z_]\w*/);
    if (m) {
      out.push({ t: 'id', v: m[0], at: i });
      i += m[0].length;
      continue;
    }
    m = rest.match(/^(:=|=>|==|!=|<>|<=|>=|&&|\|\||\*\*|[=<>+\-*/.^&|!;:])/);
    if (m) {
      out.push({ t: 'op', v: m[0], at: i });
      i += m[0].length;
      continue;
    }
    if (c === '(' || c === '[') {
      out.push({ t: 'open', v: c, at: i });
      i++;
      continue;
    }
    if (c === ')' || c === ']') {
      out.push({ t: 'close', v: c, at: i });
      i++;
      continue;
    }
    if (c === ',') {
      out.push({ t: 'comma', v: c, at: i });
      i++;
      continue;
    }
    return `"${c}" is not ST`;
  }
  return out;
}

/** Why the condition is not a valid ST expression, or null */
export function checkConditionSyntax(text: string): string | null {
  const src = text.trim();
  if (!src) return null;
  const toks = tokenize(src);
  if (typeof toks === 'string') return toks;
  // The slips first: they read best
  let depth = 0;
  for (const t of toks) {
    if (t.t === 'open') depth++;
    if (t.t === 'close') depth--;
    if (t.t !== 'op') continue;
    // (a call's named parameters: fb(IN := x))
    if (t.v === ':=' && depth === 0) return 'A condition compares with = (:= assigns)';
    if (t.v === '==') return 'ST compares with =, not ==';
    if (t.v === '!=') return 'ST writes "not equal" as <>';
    if (t.v === '&&' || t.v === '&') return 'ST writes AND, not &&';
    if (t.v === '||' || t.v === '|') return 'ST writes OR, not ||';
    if (t.v === '!') return 'ST writes NOT, not !';
    if (t.v === ';') return 'No ; in a condition';
  }
  for (const t of toks) if (t.t === 'id' && STATEMENT_WORDS.has(t.v.toUpperCase())) return `${t.v.toUpperCase()} is a statement word: the condition is only the expression`;

  let p = 0;
  const peek = () => toks[p];
  const isBin = (t?: Tok) => !!t && ((t.t === 'op' && BIN_OPS.has(t.v)) || (t.t === 'id' && WORD_OPS.has(t.v.toUpperCase())));
  const show = (t?: Tok) => (t ? `"${t.v}"` : 'the end');
  const fail = (msg: string): never => {
    throw new Error(msg);
  };
  // An operand: NOT / - / + in front, a literal, a name with members / indexes / calls / ^, or ( expression )
  const operand = (): void => {
    const t = peek();
    if (!t) fail('An operand is missing at the end');
    if ((t.t === 'id' && t.v.toUpperCase() === 'NOT') || (t.t === 'op' && (t.v === '-' || t.v === '+'))) {
      p++;
      return operand();
    }
    if (t.t === 'num' || t.t === 'str') {
      p++;
      return;
    }
    if (t.t === 'open' && t.v === '(') {
      p++;
      expr(')');
      if (peek()?.v !== ')') fail('A "(" is not closed');
      p++;
      return postfix();
    }
    if (t.t === 'id') {
      if (WORD_OPS.has(t.v.toUpperCase())) fail(`An operand is missing before ${t.v.toUpperCase()}`);
      p++;
      return postfix();
    }
    if (t.t === 'close') fail(`An operand is missing before ${show(t)}`);
    if (isBin(t)) fail(`An operand is missing before ${show(t)}`);
    fail(`${show(t)} cannot start an operand`);
  };
  // .member, .3 (a bit), [index], (arguments), ^
  const postfix = (): void => {
    for (;;) {
      const t = peek();
      if (!t) return;
      if (t.t === 'op' && t.v === '.') {
        p++;
        const n = peek();
        if (!n || (n.t !== 'id' && !(n.t === 'num' && /^\d+$/.test(n.v)))) fail('A member name is missing after "."');
        p++;
        continue;
      }
      if (t.t === 'op' && t.v === '^') {
        p++;
        continue;
      }
      if (t.t === 'open' && t.v === '[') {
        p++;
        expr(']');
        while (peek()?.t === 'comma') {
          p++;
          expr(']');
        }
        if (peek()?.v !== ']') fail('A "[" is not closed');
        p++;
        continue;
      }
      if (t.t === 'open' && t.v === '(') {
        p++;
        if (peek()?.v === ')') {
          p++;
          continue;
        }
        for (;;) {
          // (named: IN := x, Q => y)
          if (peek()?.t === 'id' && toks[p + 1]?.t === 'op' && (toks[p + 1].v === ':=' || toks[p + 1].v === '=>')) p += 2;
          expr(')');
          if (peek()?.t === 'comma') {
            p++;
            continue;
          }
          break;
        }
        if (peek()?.v !== ')') fail('A "(" is not closed');
        p++;
        continue;
      }
      return;
    }
  };
  const expr = (closer?: string): void => {
    operand();
    for (;;) {
      const t = peek();
      if (!t) return;
      if (isBin(t)) {
        p++;
        if (!peek() || peek()!.t === 'close' || peek()!.t === 'comma') fail(`An operand is missing after ${t.t === 'id' ? t.v.toUpperCase() : t.v}`);
        operand();
        continue;
      }
      if (t.t === 'close' || t.t === 'comma') {
        if (!closer) fail(t.t === 'comma' ? 'A "," outside a call' : `A "${t.v}" too many`);
        if (t.t === 'close' && t.v !== closer) fail(`"${t.v}" where "${closer}" closes`);
        return;
      }
      fail(`An operator is missing before ${show(t)} (AND, OR, =, ...)`);
    }
  };
  // (named parameters are only allowed in calls: := was reported above)
  try {
    expr();
    if (p < toks.length) fail(`${show(peek())} too many`);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
}
