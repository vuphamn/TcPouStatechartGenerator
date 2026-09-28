/**
 * Extract Method: lines of a method's implementation moved into a new PRIVATE method, a call left in their place.
 * The method's own variables the lines use become its inputs (VAR_INPUT), or in-outs (VAR_IN_OUT) when the lines
 * write them; the POU's members stay reachable as they are. Lines with a RETURN: the new method returns TRUE when
 * it RETURNed, and the call RETURNs too (IF New(...) THEN RETURN; END_IF), so the method still leaves there.
 * Extract Property: an expression of one line into a new PRIVATE property (its Get), its name in its place.
 */
import { getMethodCodeFromPou, updateMethodCodeInPou } from './pouStateEditor.ts';
import { declarationVariables } from './pouVariables.ts';
import { useOffsets } from './renameVariable.ts';

const KEYWORDS = new Set('IF THEN ELSE ELSIF END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT RETURN EXIT CONTINUE TRUE FALSE AND OR XOR NOT MOD'.split(' '));

const blank = (text: string) => text.replace(/\(\*[\s\S]*?\*\)/g, (c) => c.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, (c) => ' '.repeat(c.length)).replace(/'[^'\n]*'/g, (c) => ' '.repeat(c.length));

export interface ExtractPlan {
  inputs: { name: string; type: string }[];
  inOuts: { name: string; type: string }[];
  call: string;
  body: string[];
  declaration: string;
  /** The lines RETURN: the new method says so (BOOL), the call RETURNs after it */
  returns: boolean;
}

/** Why the lines cannot be extracted, or null */
export function checkExtract(pouXml: string, method: string, start: number, end: number, newName: string): string | null {
  if (!/^[A-Za-z_]\w*$/.test(newName) || KEYWORDS.has(newName.toUpperCase())) return 'A name is letters, digits and _ (not starting with a digit), not a keyword';
  if (new RegExp(`<(Method|Property|Action)\\b[^>]*\\bName="${newName}"`, 'i').test(pouXml)) return `${newName} is already a method, property or action of the POU`;
  const m = getMethodCodeFromPou(pouXml, method);
  if (!m.methodFound) return `The POU has no ${method}()`;
  const lines = m.code.split(/\r?\n/);
  if (start < 1 || end > lines.length || start > end) return 'Select the lines to extract';
  const code = blank(lines.slice(start - 1, end).join('\n'));
  if (!code.trim()) return 'The selection has no code';
  // (a RETURN: the new method tells the call to RETURN too; but not when the lines set the method's own result)
  if (/\bRETURN\b/i.test(code) && new RegExp(`(^|[^\\w.])${method.replace(/\(\)$/, '')}\\s*:=`, 'i').test(code)) return `The lines set ${method}'s result and RETURN: change it in the Method Editor`;
  const opens = (code.match(/\b(IF|CASE|FOR|WHILE|REPEAT)\b/gi) ?? []).length;
  const closes = (code.match(/\bEND_(IF|CASE|FOR|WHILE|REPEAT)\b/gi) ?? []).length;
  if (opens !== closes) return 'Select whole statements: every IF / CASE / FOR / WHILE / REPEAT with its END_';
  if (/^\s*(ELSE|ELSIF)\b/im.test(code)) return 'Select whole statements: not an ELSE / ELSIF without its IF';
  if (/^\s*(?:[A-Za-z_][\w.]*|\d+)(?:\s*,\s*(?:[A-Za-z_][\w.]*|\d+))*\s*:(?!=)/m.test(code)) return 'The lines have a CASE label: select the code inside a branch';
  return null;
}

/** What the extraction makes: the new method's declaration and body, the call */
export function planExtract(pouXml: string, method: string, start: number, end: number, newName: string): ExtractPlan {
  const m = getMethodCodeFromPou(pouXml, method);
  const lines = m.code.split(/\r?\n/);
  const sel = lines.slice(start - 1, end);
  const text = sel.join('\n');
  const masked = blank(text);
  const inputs: ExtractPlan['inputs'] = [];
  const inOuts: ExtractPlan['inOuts'] = [];
  for (const v of declarationVariables(m.declaration || '')) {
    if (!useOffsets(text, v.name).length) continue;
    const written = new RegExp(`(^|[^\\w.])${v.name}\\s*:=`, 'i').test(masked.replace(/\([^()]*\)/g, (c) => ' '.repeat(c.length)));
    (written ? inOuts : inputs).push({ name: v.name, type: v.type });
  }
  const indent = (sel.find((l) => l.trim()) ?? '').match(/^[ \t]*/)![0];
  const common = Math.min(...sel.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)![0].length));
  const returns = /\bRETURN\b/i.test(masked);
  // (each RETURN: the new method's result TRUE first, so the call knows)
  const body = sel.map((l, i) => {
    const line = l.trim() ? l.slice(common) : '';
    if (!returns) return line;
    const m = blank(line);
    const at = m.search(/\bRETURN\b/i);
    return at < 0 ? line : `${line.slice(0, at)}${newName} := TRUE; ${line.slice(at)}`;
  });
  const args = [...inputs, ...inOuts].map((p) => `${p.name} := ${p.name}`).join(', ');
  const block = (kw: string, list: { name: string; type: string }[]) => (list.length ? [kw, ...list.map((p) => `\t${p.name} : ${p.type};`), 'END_VAR'] : []);
  const declaration = [`METHOD PRIVATE ${newName}${returns ? ' : BOOL' : ''}`, ...block('VAR_INPUT', inputs), ...block('VAR_IN_OUT', inOuts)].join('\n');
  const call = returns ? `${indent}IF ${newName}(${args}) THEN\n${indent}\tRETURN;\n${indent}END_IF` : `${indent}${newName}(${args});`;
  return { inputs, inOuts, call, body, declaration, returns };
}

/** The POU with the lines extracted */
export function extractMethod(pouXml: string, method: string, start: number, end: number, newName: string): { pou: string; plan: ExtractPlan } | { error: string } {
  const err = checkExtract(pouXml, method, start, end, newName);
  if (err) return { error: err };
  const plan = planExtract(pouXml, method, start, end, newName);
  const m = getMethodCodeFromPou(pouXml, method);
  const eol = m.code.includes('\r\n') ? '\r\n' : '\n';
  const lines = m.code.split(/\r?\n/);
  lines.splice(start - 1, end - start + 1, ...plan.call.split('\n'));
  const u1 = updateMethodCodeInPou(pouXml, method, lines.join(eol));
  if (!u1.success) return { error: u1.error || `Could not change ${method}()` };
  const u2 = updateMethodCodeInPou(u1.updatedPou, newName, plan.body.join(eol), plan.declaration.replace(/\n/g, eol));
  if (!u2.success) return { error: u2.error || `Could not add ${newName}()` };
  return { pou: u2.updatedPou, plan };
}

// ---- Extract Property ----

export interface PropertyPlan {
  expression: string;
  /** The line with the property's name in the expression's place */
  line: string;
  type: string;
  xml: string;
}

const guid = () => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 3) | 8).toString(16);
  });
};

/** The type an expression likely has: BOOL for comparisons and logic, else a single name's declared type, else '' */
export function guessExpressionType(pouXml: string, method: string, expression: string): string {
  const e = blank(expression).trim();
  if (/(<>|<=|>=|[<>=])|\b(AND|OR|XOR|NOT|AND_THEN|OR_ELSE)\b|\bTRUE\b|\bFALSE\b/i.test(e)) return 'BOOL';
  // (a standard FB's output: its type; an instance before a dot is not the value's type)
  const member = e.match(/^[A-Za-z_]\w*(?:\[[^\]]*\])?\.([A-Za-z_]\w*)$/)?.[1]?.toUpperCase();
  if (member && ['Q', 'QU', 'QD'].includes(member)) return 'BOOL';
  if (member === 'ET') return 'TIME';
  if (member === 'CV') return 'INT';
  const names = [...e.matchAll(/(^|[^\w.])([A-Za-z_]\w*)(?![\w(.])/g)].map((m) => m[2]).filter((n) => !KEYWORDS.has(n.toUpperCase()));
  const m = getMethodCodeFromPou(pouXml, method);
  const vars = [...declarationVariables(m.declaration || ''), ...declarationVariables(pouXml.match(/<POU\b[\s\S]*?<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1] ?? '')];
  const types = [...new Set(names.map((n) => vars.find((v) => v.name.toLowerCase() === n.toLowerCase())?.type).filter((t): t is string => !!t))];
  if (types.length === 1) return types[0];
  if (types.some((t) => /^L?REAL$/i.test(t))) return types.some((t) => /^LREAL$/i.test(t)) ? 'LREAL' : 'REAL';
  if (/\//.test(e)) return 'LREAL';
  return types[0] ?? '';
}

/** Why the expression cannot become a property, or null */
export function checkExtractProperty(pouXml: string, method: string, line: number, from: number, to: number, name: string, type: string): string | null {
  if (!/^[A-Za-z_]\w*$/.test(name) || KEYWORDS.has(name.toUpperCase())) return 'A name is letters, digits and _ (not starting with a digit), not a keyword';
  if (new RegExp(`<(Method|Property|Action)\\b[^>]*\\bName="${name}"`, 'i').test(pouXml)) return `${name} is already a method, property or action of the POU`;
  if (!/^[A-Za-z_][\w.]*(\s*\(.*\))?(\s+OF\s+[A-Za-z_][\w.]*)?$|^ARRAY\b|^STRING(\(\d+\))?$/i.test(type.trim())) return 'Give its type (e.g. BOOL, INT, LREAL)';
  const m = getMethodCodeFromPou(pouXml, method);
  if (!m.methodFound) return `The POU has no ${method}()`;
  const text = m.code.split(/\r?\n/)[line - 1];
  if (text === undefined || from >= to) return 'Select an expression on one line';
  const expr = text.slice(from, to);
  const masked = blank(expr);
  if (!masked.trim()) return 'The selection has no code';
  if (/;|:=|\b(IF|THEN|END_IF|CASE|FOR|WHILE|REPEAT|RETURN)\b/i.test(masked)) return 'Select an expression (no statement, assignment or ;)';
  const depth = [...masked].reduce((d, c) => (d < 0 ? d : c === '(' ? d + 1 : c === ')' ? d - 1 : d), 0);
  if (depth !== 0) return 'Select whole brackets';
  // (the method's own variables: a property cannot see them)
  const own = declarationVariables(m.declaration || '').filter((v) => useOffsets(expr, v.name).length).map((v) => v.name);
  if (own.length) return `It uses ${method}()'s own ${own.join(', ')}: a property sees only the POU's members`;
  return null;
}

/** The plan: the property's XML (Get only), the line with its name in the expression's place */
export function planExtractProperty(pouXml: string, method: string, line: number, from: number, to: number, name: string, type: string): PropertyPlan {
  const m = getMethodCodeFromPou(pouXml, method);
  const text = m.code.split(/\r?\n/)[line - 1] ?? '';
  const expression = text.slice(from, to).trim();
  const eol = pouXml.includes('\r\n') ? '\r\n' : '\n';
  const xml = [
    `    <Property Name="${name}" Id="{${guid()}}">`,
    `      <Declaration><![CDATA[PROPERTY PRIVATE ${name} : ${type.trim()}]]></Declaration>`,
    `      <Get Name="Get" Id="{${guid()}}">`,
    `        <Declaration><![CDATA[VAR${eol}END_VAR${eol}]]></Declaration>`,
    '        <Implementation>',
    `          <ST><![CDATA[${name} := ${expression};]]></ST>`,
    '        </Implementation>',
    '      </Get>',
    '    </Property>',
  ].join(eol);
  return { expression, line: `${text.slice(0, from)}${name}${text.slice(to)}`, type: type.trim(), xml };
}

/** The POU with the expression extracted into a property */
export function extractProperty(pouXml: string, method: string, line: number, from: number, to: number, name: string, type: string): { pou: string; plan: PropertyPlan } | { error: string } {
  const err = checkExtractProperty(pouXml, method, line, from, to, name, type);
  if (err) return { error: err };
  const plan = planExtractProperty(pouXml, method, line, from, to, name, type);
  const m = getMethodCodeFromPou(pouXml, method);
  const eol = m.code.includes('\r\n') ? '\r\n' : '\n';
  const lines = m.code.split(/\r?\n/);
  lines[line - 1] = plan.line;
  const u = updateMethodCodeInPou(pouXml, method, lines.join(eol));
  if (!u.success) return { error: u.error || `Could not change ${method}()` };
  const end = u.updatedPou.search(/<\/POU>/i);
  if (end < 0) return { error: 'The POU has no </POU>' };
  const pEol = u.updatedPou.includes('\r\n') ? '\r\n' : '\n';
  return { pou: `${u.updatedPou.slice(0, end)}${plan.xml}${pEol}  ${u.updatedPou.slice(end)}`.replace(/\n {2}\s*<\/POU>/, `${pEol}  </POU>`), plan };
}
