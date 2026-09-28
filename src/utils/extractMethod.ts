/**
 * Extract Method: lines of a method's implementation moved into a new PRIVATE method, a call left in their place.
 * The method's own variables the lines use become its inputs (VAR_INPUT), or in-outs (VAR_IN_OUT) when the lines
 * write them; the POU's members stay reachable as they are.
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
  if (/\bRETURN\b/i.test(code)) return 'The lines have a RETURN: in a method of its own it would only leave that method';
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
  const body = sel.map((l) => (l.trim() ? l.slice(common) : ''));
  const args = [...inputs, ...inOuts].map((p) => `${p.name} := ${p.name}`).join(', ');
  const block = (kw: string, list: { name: string; type: string }[]) => (list.length ? [kw, ...list.map((p) => `\t${p.name} : ${p.type};`), 'END_VAR'] : []);
  const declaration = [`METHOD PRIVATE ${newName}`, ...block('VAR_INPUT', inputs), ...block('VAR_IN_OUT', inOuts)].join('\n');
  return { inputs, inOuts, call: `${indent}${newName}(${args});`, body, declaration };
}

/** The POU with the lines extracted */
export function extractMethod(pouXml: string, method: string, start: number, end: number, newName: string): { pou: string; plan: ExtractPlan } | { error: string } {
  const err = checkExtract(pouXml, method, start, end, newName);
  if (err) return { error: err };
  const plan = planExtract(pouXml, method, start, end, newName);
  const m = getMethodCodeFromPou(pouXml, method);
  const eol = m.code.includes('\r\n') ? '\r\n' : '\n';
  const lines = m.code.split(/\r?\n/);
  lines.splice(start - 1, end - start + 1, plan.call);
  const u1 = updateMethodCodeInPou(pouXml, method, lines.join(eol));
  if (!u1.success) return { error: u1.error || `Could not change ${method}()` };
  const u2 = updateMethodCodeInPou(u1.updatedPou, newName, plan.body.join(eol), plan.declaration.replace(/\n/g, eol));
  if (!u2.success) return { error: u2.error || `Could not add ${newName}()` };
  return { pou: u2.updatedPou, plan };
}
