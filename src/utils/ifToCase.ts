/**
 * Convert to CASE (the code editors' menu): an IF / ELSIF chain whose every condition compares the same variable with
 * a value (x = A, x = B OR x = C, (x = 5)) becomes CASE x OF A: … B, C: … ELSE … END_CASE, its arms' code as it was
 * (the labels a step in, each arm's code a step further). Anything else (another variable, <, AND, a call): not converted, why said.
 */
const strip = (l: string) => l.replace(/\/\/.*$/, '').replace(/\(\*.*?\*\)/g, '');

/** The arms of the IF at a line (0-based): each condition's line, its code lines; the END_IF's line */
function armsOf(lines: string[], at: number): { arms: { cond: string | null; start: number; end: number }[]; endIf: number } | null {
  if (!/^\s*IF\b/i.test(strip(lines[at]))) return null;
  const arms: { cond: string | null; start: number; end: number }[] = [];
  let depth = 0;
  let condLines = '';
  let collecting = true;
  let armStart = at;
  let cond: string | null = null;
  for (let i = at; i < lines.length; i++) {
    const l = strip(lines[i]);
    if (i > at && depth === 0 && /^\s*(ELSIF\b|ELSE\b|END_IF\b)/i.test(l)) {
      arms.push({ cond, start: armStart + 1, end: i });
      if (/^\s*END_IF\b/i.test(l)) return { arms, endIf: i };
      armStart = i;
      if (/^\s*ELSE\b/i.test(l)) {
        cond = null;
        collecting = false;
        continue;
      }
      condLines = '';
      collecting = true;
    }
    if (collecting) {
      condLines += ` ${l}`;
      const m = /^\s*(?:IF|ELSIF)\b([\s\S]*?)\bTHEN\b/i.exec(condLines);
      if (m) {
        cond = m[1].trim();
        collecting = false;
        armStart = i;
      }
      continue;
    }
    // (a nested IF: its END_IF anywhere on a line, a one-line IF … END_IF too)
    if (/^\s*IF\b/i.test(l)) depth++;
    depth -= (l.match(/\bEND_IF\b/gi) ?? []).length;
  }
  return null;
}

/** "x = A OR x = B" → { variable, labels } (one variable, values only), or null */
function labelsOf(cond: string): { variable: string; labels: string[] } | null {
  let c = cond.trim();
  while (/^\((.*)\)$/s.test(c) && balanced(c.slice(1, -1))) c = c.slice(1, -1).trim();
  const parts = splitTop(c, /\bOR\b|\bOR_ELSE\b/i);
  let variable: string | null = null;
  const labels: string[] = [];
  for (let p of parts) {
    p = p.trim();
    while (/^\((.*)\)$/s.test(p) && balanced(p.slice(1, -1))) p = p.slice(1, -1).trim();
    const m = /^([A-Za-z_][\w.]*)\s*=\s*([A-Za-z_][\w.]*|-?\d+)$/.exec(p) ?? /^([A-Za-z_][\w.]*|-?\d+)\s*=\s*([A-Za-z_][\w.]*)$/.exec(p);
    if (!m) return null;
    // (the variable: the side seen on every part)
    const [l, r] = [m[1], m[2]];
    const v: string = variable ??(/^-?\d/.test(l) ? r : l);
    const value = l.toLowerCase() === v.toLowerCase() ? r : r.toLowerCase() === v.toLowerCase() ? l : null;
    if (!value) return null;
    if (variable && variable.toLowerCase() !== v.toLowerCase()) return null;
    variable = v;
    labels.push(value);
  }
  return variable ? { variable, labels } : null;
}
const balanced = (s: string) => {
  let d = 0;
  for (const ch of s) {
    if (ch === '(') d++;
    if (ch === ')' && --d < 0) return false;
  }
  return d === 0;
};
function splitTop(s: string, sep: RegExp): string[] {
  const out: string[] = [];
  let d = 0;
  let cur = '';
  const re = new RegExp(`^(?:${sep.source})`, 'i');
  for (let i = 0; i < s.length; ) {
    const ch = s[i];
    if (ch === '(') d++;
    if (ch === ')') d--;
    const rest = s.slice(i);
    const m = d === 0 && /^\s/.test(s[i - 1] ?? ' ') ? re.exec(rest) : null;
    if (m && /^(\s|$)/.test(rest.slice(m[0].length))) {
      out.push(cur);
      cur = '';
      i += m[0].length;
      continue;
    }
    cur += ch;
    i++;
  }
  out.push(cur);
  return out;
}

/**
 * The code editors' menu item (the caret's line, 1-based, starting an IF): Convert to CASE, the new code given to
 * `apply`, or why not to `fail`; null when the line is no IF
 */
export function ifToCaseItem(code: string, line: number, apply: (code: string) => void, fail: (message: string) => void): { id: string; label: string; title: string; onSelect: () => void } | null {
  const text = code.split(/\r?\n/)[line - 1];
  if (text === undefined || !/^\s*IF\b/i.test(strip(text))) return null;
  return {
    id: 'editor-menu-if-to-case',
    label: 'Convert to CASE',
    title: 'This IF / ELSIF chain as a CASE (every condition comparing the same variable with a value); Ctrl+Z undoes',
    onSelect: () => {
      const r = ifToCase(code, line - 1);
      if ('error' in r) fail(`Not converted: ${r.error}`);
      else apply(r.code);
    },
  };
}

/** The IF at a line (0-based) as a CASE → the new code, or { error } (why not) */
export function ifToCase(code: string, line: number): { code: string; variable: string } | { error: string } {
  const eol = code.includes('\r\n') ? '\r\n' : '\n';
  const lines = code.split(/\r?\n/);
  const found = armsOf(lines, line);
  if (!found) return { error: 'No IF … END_IF starts on this line' };
  const conds = found.arms.filter((a) => a.cond !== null);
  if (conds.length < 2) return { error: 'An IF with one condition: nothing to make a CASE of' };
  const parsed = conds.map((a) => labelsOf(a.cond!));
  if (parsed.some((p) => !p)) return { error: 'Every condition must compare the same variable with a value (x = A, x = B OR x = C)' };
  const variable = parsed[0]!.variable;
  if (parsed.some((p) => p!.variable.toLowerCase() !== variable.toLowerCase())) return { error: `The conditions compare different variables (${[...new Set(parsed.map((p) => p!.variable))].join(', ')})` };
  const seen = new Set<string>();
  for (const p of parsed) for (const l of p!.labels) {
    if (seen.has(l.toLowerCase())) return { error: `${l} is tested twice: a CASE can have it once` };
    seen.add(l.toLowerCase());
  }
  const indent = lines[line].match(/^[ \t]*/)![0];
  const step = indent.includes('\t') || !indent ? '\t' : '  ';
  const out: string[] = [`${indent}CASE ${variable} OF`];
  let k = 0;
  for (const a of found.arms) {
    out.push(a.cond === null ? `${indent}ELSE` : `${indent}${step}${parsed[k++]!.labels.join(', ')}:`);
    const body = lines.slice(a.start, a.end);
    // (the arm's code a step further in: under its label; ELSE's as it was, ELSE being at the CASE's level)
    const deeper = a.cond === null ? '' : step;
    out.push(...(body.length ? body.map((l) => (l.trim() ? deeper + l : l)) : [`${indent}${step}${deeper};`]));
  }
  out.push(`${indent}END_CASE`);
  const next = [...lines.slice(0, line), ...out, ...lines.slice(found.endIf + 1)];
  return { code: next.join(eol), variable };
}
