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

// ---- Convert to IF: a CASE as an IF / ELSIF chain (the other way) ----

const OPENS = /^\s*(IF|CASE|FOR|WHILE|REPEAT)\b/i;
const CLOSES = /\b(END_IF|END_CASE|END_FOR|END_WHILE|UNTIL)\b/gi;
const LABEL_LINE = /^(\s*)((?:[A-Za-z_][\w.]*|-?\d[\w#]*)(?:\s*\.\.\s*(?:[A-Za-z_][\w.]*|-?\d[\w#]*))?(?:\s*,\s*(?:[A-Za-z_][\w.]*|-?\d[\w#]*)(?:\s*\.\.\s*(?:[A-Za-z_][\w.]*|-?\d[\w#]*))?)*)\s*:(?!=)(.*)$/;

/** The arms of the CASE at a line (0-based): each one's labels (null: ELSE) and code lines; END_CASE's line */
function caseArmsOf(lines: string[], at: number): { variable: string; arms: { labels: string[] | null; code: string[] }[]; end: number } | null {
  const head = /^\s*CASE\s+([\s\S]+?)\s+OF\s*$/i.exec(strip(lines[at]));
  if (!head) return null;
  const arms: { labels: string[] | null; code: string[] }[] = [];
  let depth = 0;
  for (let i = at + 1; i < lines.length; i++) {
    const l = strip(lines[i]);
    if (depth === 0) {
      if (/^\s*END_CASE\b/i.test(l)) return { variable: head[1].trim(), arms, end: i };
      if (/^\s*ELSE\b/i.test(l)) {
        const rest = lines[i].replace(/^\s*ELSE\b/i, '');
        arms.push({ labels: null, code: rest.trim() ? [rest.trim()] : [] });
        continue;
      }
      const lab = LABEL_LINE.exec(l);
      if (lab) {
        // (the code after "A:" on its line: the arm's first line)
        const rest = lines[i].slice(lines[i].indexOf(':', lab[1].length + lab[2].length) + 1);
        arms.push({ labels: lab[2].split(',').map((x) => x.trim()), code: rest.trim() ? [rest.trim()] : [] });
        continue;
      }
    }
    if (!arms.length) {
      if (l.trim()) return null;
      continue;
    }
    arms[arms.length - 1].code.push(lines[i]);
    if (OPENS.test(l)) depth++;
    depth -= (l.match(CLOSES) ?? []).length;
  }
  return null;
}

/** The lines re-indented to `indent` (their common indentation taken off) */
function reindent(code: string[], indent: string): string[] {
  const body = [...code];
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const ind = body.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)![0]);
  const common = ind.length ? ind.reduce((m, x) => (x.length < m.length ? x : m)) : '';
  return body.map((l) => (l.trim() ? indent + (l.startsWith(common) ? l.slice(common.length) : l.trimStart()) : ''));
}

/** The CASE at a line (0-based) as an IF / ELSIF chain → the new code, or { error } */
export function caseToIf(code: string, line: number): { code: string; variable: string } | { error: string } {
  const eol = code.includes('\r\n') ? '\r\n' : '\n';
  const lines = code.split(/\r?\n/);
  const found = caseArmsOf(lines, line);
  if (!found) return { error: 'No CASE … END_CASE starts on this line (or a label is not understood)' };
  const labelled = found.arms.filter((a) => a.labels);
  if (!labelled.length) return { error: 'The CASE has no labels' };
  const indent = lines[line].match(/^[ \t]*/)![0];
  const step = indent.includes(' ') && !indent.includes('\t') ? '  ' : '\t';
  const v = found.variable;
  const test = (label: string) => {
    const range = /^(.+?)\s*\.\.\s*(.+)$/.exec(label);
    return range ? `(${v} >= ${range[1]} AND ${v} <= ${range[2]})` : `${v} = ${label}`;
  };
  const out: string[] = [];
  let first = true;
  for (const a of found.arms) {
    if (a.labels) {
      out.push(`${indent}${first ? 'IF' : 'ELSIF'} ${a.labels.map(test).join(' OR ')} THEN`);
      first = false;
    } else out.push(`${indent}ELSE`);
    const body = reindent(a.code, indent + step);
    out.push(...(body.length ? body : [`${indent}${step};`]));
  }
  out.push(`${indent}END_IF`);
  return { code: [...lines.slice(0, line), ...out, ...lines.slice(found.end + 1)].join(eol), variable: v };
}

/** The code editors' menu item (the caret's line, 1-based, starting a CASE): Convert to IF */
export function caseToIfItem(code: string, line: number, apply: (code: string) => void, fail: (message: string) => void): { id: string; label: string; title: string; onSelect: () => void } | null {
  const text = code.split(/\r?\n/)[line - 1];
  if (text === undefined || !/^\s*CASE\b/i.test(strip(text))) return null;
  return {
    id: 'editor-menu-case-to-if',
    label: 'Convert to IF',
    title: 'This CASE as an IF / ELSIF chain (a range a..b as two comparisons); Ctrl+Z undoes',
    onSelect: () => {
      const r = caseToIf(code, line - 1);
      if ('error' in r) fail(`Not converted: ${r.error}`);
      else apply(r.code);
    },
  };
}
