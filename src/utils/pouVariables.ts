/**
 * The variables of a declaration, and declaring new ones (in the POU's declaration, or a method's), as TwinCAT's UML
 * editor offers when a condition is edited.
 */
import { extractPouDeclaration } from './stSymbolDefinition.ts';
import { updatePouBody } from './pouBody.ts';

export type VariableScope = 'VAR_INPUT' | 'VAR_OUTPUT' | 'VAR_IN_OUT' | 'VAR' | 'VAR_STAT' | 'VAR_TEMP' | 'VAR_INST';

export interface PouVariable {
  name: string;
  type: string;
  /** The VAR block; "doState" for the method's own */
  scope: string;
  comment?: string;
  /** Its 1-based line in the declaration, and that line (trimmed) */
  line?: number;
  text?: string;
  /** A method's / function's inputs and outputs (parameter hints) */
  params?: PouVariable[];
}

/** A variable to declare in the POU (VAR_INPUT, VAR_OUTPUT or VAR) */
export interface NewVariable {
  name: string;
  type: string;
  /** VAR_INPUT, VAR_OUTPUT, VAR (a method's own: also VAR_INST, VAR_TEMP) */
  scope: 'VAR_INPUT' | 'VAR_OUTPUT' | 'VAR' | 'VAR_IN_OUT' | 'VAR_INST' | 'VAR_TEMP';
  init?: string;
  comment?: string;
}

/** Types offered for a new variable (the POU's own types are added to these) */
export const COMMON_TYPES = ['BOOL', 'INT', 'DINT', 'UINT', 'UDINT', 'REAL', 'LREAL', 'TIME', 'STRING', 'BYTE', 'WORD', 'DWORD', 'TON', 'R_TRIG'];

const KEYWORDS = new Set([
  'CASE', 'OF', 'END_CASE', 'IF', 'THEN', 'ELSE', 'ELSIF', 'END_IF', 'FOR', 'TO', 'BY', 'DO', 'END_FOR', 'WHILE',
  'END_WHILE', 'REPEAT', 'UNTIL', 'RETURN', 'TRUE', 'FALSE', 'AND', 'OR', 'XOR', 'NOT', 'MOD', 'EXIT', 'CONTINUE',
  'AND_THEN', 'OR_ELSE', 'THIS', 'SUPER',
]);

/** The variables of a declaration's VAR blocks, with their block (attributes skipped, a line's comment kept) */
export function declarationVariables(declaration: string, scopeName?: string): PouVariable[] {
  const out: PouVariable[] = [];
  const text = (declaration || '').replace(/\(\*[\s\S]*?\*\)/g, (c) => (c.includes('\n') ? '\n'.repeat(c.split('\n').length - 1) : c)).replace(/\{[^}]*\}/g, ' ');
  let scope: string | null = null;
  const rawLines = (declaration || '').split(/\r?\n/);
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    // (a GVL's VAR_GLOBAL, a DUT's STRUCT / UNION too)
    const block = line.match(/^(VAR(?:_INPUT|_OUTPUT|_IN_OUT|_STAT|_TEMP|_INST|_GLOBAL|_CONFIG)?|STRUCT|UNION)\b/i);
    if (block) {
      scope = block[1].toUpperCase();
      return;
    }
    if (/^END_(VAR|STRUCT|UNION)\b/i.test(line)) {
      scope = null;
      return;
    }
    if (!scope) return;
    const m = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?:AT\s+%\S+\s*)?:\s*([^;]+?)\s*(?::=[^;]*)?;\s*(?:\/\/\s*(.*)|\(\*\s*(.*?)\s*\*\))?$/i);
    if (!m) return;
    const type = m[2].split(':=')[0].trim().replace(/\s+/g, ' ');
    const comment = (m[3] ?? m[4] ?? '').trim() || undefined;
    for (const n of m[1].split(',')) out.push({ name: n.trim(), type, scope: scopeName ?? scope, comment, line: index + 1, text: rawLines[index]?.trim() });
  });
  return out;
}

/** The declaration with the variables added at the end of their VAR block (one added after the last when none) */
export function declareInDeclaration(declaration: string, vars: { name: string; type: string; scope: string; init?: string; comment?: string }[]): string {
  let decl = declaration;
  const eol = decl.includes('\r\n') ? '\r\n' : '\n';
  for (const v of vars) {
    const line = `${v.name} : ${v.type.trim()}${v.init?.trim() ? ` := ${v.init.trim()}` : ''};${v.comment?.trim() ? ` // ${v.comment.trim()}` : ''}`;
    const lines = decl.split(/\r?\n/);
    // The block: "VAR_INPUT" / "VAR" alone (not VAR CONSTANT, VAR RETAIN, ...), a comment after it allowed
    const opener = new RegExp(`^\\s*${v.scope}\\s*(?://.*|\\(\\*.*\\*\\))?$`, 'i');
    const start = lines.findIndex((l) => opener.test(l));
    const end = start >= 0 ? lines.findIndex((l, i) => i > start && /^\s*END_VAR\b/i.test(l)) : -1;
    if (start >= 0 && end > start) {
      const body = lines.slice(start + 1, end).filter((l) => l.trim());
      const indent = body.length ? body[body.length - 1].match(/^[ \t]*/)![0] : `${lines[start].match(/^[ \t]*/)![0]}\t`;
      lines.splice(end, 0, indent + line);
    } else {
      let last = -1;
      lines.forEach((l, i) => {
        if (/^\s*END_VAR\b/i.test(l)) last = i;
      });
      // (after the header when there is no VAR block yet; a trailing empty line kept last)
      let at = last >= 0 ? last + 1 : Math.max(1, lines.length);
      if (last < 0 && lines.length > 1 && !lines[lines.length - 1].trim()) at = lines.length - 1;
      lines.splice(at, 0, v.scope, `\t${line}`, 'END_VAR');
    }
    decl = lines.join(eol);
  }
  return decl;
}

/** A type guessed from the name's prefix (bX: BOOL, nX: INT, ...), as a start */
export function guessType(name: string): string {
  const m = name.match(/^(?:[a-z]+_)?([a-z]+)[A-Z0-9_]/);
  const p = m?.[1] ?? '';
  if (/^(b|x|is|has|cmd|di|do)$/.test(p) || /^(cmd|di|do)_b/i.test(name)) return 'BOOL';
  if (/^(n|i)$/.test(p)) return 'INT';
  if (p === 'dn') return 'DINT';
  if (/^(r|f|lr)$/.test(p)) return p === 'lr' ? 'LREAL' : 'REAL';
  if (/^(t|tim)$/.test(p)) return 'TIME';
  if (/^(s|str)$/.test(p)) return 'STRING';
  if (/^(ton)$/i.test(p)) return 'TON';
  return 'BOOL';
}

/** Why a new variable cannot be declared, or null */
export function checkNewVariable(v: NewVariable, known: { name: string }[]): string | null {
  if (!/^[A-Za-z_]\w*$/.test(v.name)) return 'A name is letters, digits and _ (not starting with a digit)';
  if (KEYWORDS.has(v.name.toUpperCase())) return `${v.name} is a keyword`;
  if (known.some((k) => k.name.toLowerCase() === v.name.toLowerCase())) return `${v.name} is already declared`;
  if (!v.type.trim() || /[;:]/.test(v.type)) return 'Enter a type (BOOL, INT, TON, ...)';
  if (/[;]|\]\]>/.test(v.init ?? '') || /\]\]>|\n/.test(v.comment ?? '')) return 'The initial value / comment cannot hold ; or ]]>';
  return null;
}

/**
 * The POU with the variables declared at the end of its VAR_INPUT / VAR_OUTPUT / VAR block (a block added after
 * the last one when there is none), indented like its other lines.
 */
export function declareVariables(pouXml: string, vars: NewVariable[]): { pou: string } | { error: string } {
  if (!vars.length) return { pou: pouXml };
  const decl = extractPouDeclaration(pouXml);
  if (!decl.trim()) return { error: 'The POU has no declaration' };
  const r = updatePouBody(pouXml, declareInDeclaration(decl, vars), null);
  return r.success ? { pou: r.updatedPou } : { error: r.error || 'Could not declare the variables' };
}

/**
 * Names a condition uses that are not declared (in the list, nor states, nor calls): the first part of a dotted
 * name (fbX.bDone: fbX), literals (T#5S, 16#FF, 1.5) and keywords skipped
 */
export function undeclaredNames(condition: string, known: PouVariable[], states: Iterable<string> = []): string[] {
  const names = new Set(known.map((k) => k.name.toLowerCase()));
  for (const s of states) names.add(s.toLowerCase());
  const text = condition.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ').replace(/\(\*[\s\S]*?\*\)/g, ' ').replace(/\/\/.*$/gm, ' ');
  const out: string[] = [];
  const rx = /[A-Za-z_][\w]*(?:#[\w.:]+)?/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    const word = m[0];
    const before = text[m.index - 1];
    const after = text.slice(m.index + word.length).match(/^\s*(\S)?/)?.[1];
    if (word.includes('#') || before === '.' || before === '#' || /\d/.test(before ?? '') || after === '(') continue;
    if (KEYWORDS.has(word.toUpperCase()) || names.has(word.toLowerCase())) continue;
    if (!out.some((o) => o.toLowerCase() === word.toLowerCase())) out.push(word);
  }
  return out;
}

/**
 * The declaration without a variable: its line removed, or its name taken out of "a, b : INT;". null: not declared
 * there. removed: the line as it was.
 */
export function removeFromDeclaration(declaration: string, name: string): { declaration: string; removed: string } | null {
  const v = declarationVariables(declaration).find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!v?.line) return null;
  const eol = declaration.includes('\r\n') ? '\r\n' : '\n';
  const lines = declaration.split(/\r?\n/);
  const line = lines[v.line - 1];
  const colon = line.search(/:(?!=)/);
  const names = line.slice(0, colon).split(',');
  if (names.length > 1) {
    const kept = names.filter((n) => n.trim().toLowerCase() !== name.toLowerCase());
    const lead = line.match(/^[ \t]*/)![0];
    lines[v.line - 1] = lead + kept.map((n) => n.trim()).join(', ') + ' ' + line.slice(colon).trimStart();
  } else lines.splice(v.line - 1, 1);
  return { declaration: lines.join(eol), removed: line.trim() };
}
