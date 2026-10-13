/**
 * More refactorings of the code editors: Inline Method (a call `Name();` replaced by the method's code, for a method
 * that takes, keeps and returns nothing) and state names for numbers (`machineState := 30;`, `CASE machineState OF
 * 30:` → the enum's member, as the state's enum names them).
 */
import { getMethodCodeFromPou, updateMethodCodeInPou } from './pouStateEditor.ts';

const stripComments = (s: string) => s.replace(/\(\*[\s\S]*?\*\)/g, ' ').replace(/\/\/[^\n]*/g, ' ');

function reindent(code: string[], indent: string): string[] {
  const body = [...code];
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const ind = body.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)![0]);
  const common = ind.length ? ind.reduce((m, x) => (x.length < m.length ? x : m)) : '';
  return body.map((l) => (l.trim() ? indent + (l.startsWith(common) ? l.slice(common.length) : l.trimStart()) : ''));
}

/** Why a method cannot be inlined (its declaration and code), or null */
export function inlineBlocker(name: string, declaration: string, code: string): string | null {
  const decl = stripComments(declaration);
  if (/^\s*METHOD\b[^\n]*\)?\s*:\s*[A-Za-z_]/im.test(decl.split('\n').find((l) => /\bMETHOD\b/i.test(l)) ?? '')) return `${name}() returns a value`;
  for (const m of decl.matchAll(/\bVAR(?:_INPUT|_OUTPUT|_IN_OUT|_INST|_STAT|_TEMP)?\b([\s\S]*?)\bEND_VAR\b/gi)) {
    const inside = m[1].replace(/\b(CONSTANT|RETAIN|PERSISTENT)\b/gi, '').trim();
    if (inside) return `${name}() has variables of its own (inputs, outputs or locals)`;
  }
  const body = stripComments(code);
  if (/\bRETURN\b/i.test(body)) return `${name}() has a RETURN`;
  if (new RegExp(`\\b${name}\\s*:=`, 'i').test(body)) return `${name}() sets its own result`;
  return null;
}

/** A call `Name();` (or `THIS^.Name();`) on its own line: the name called, or null */
export function callOnLine(text: string): string | null {
  return /^\s*(?:THIS\^\.)?([A-Za-z_]\w*)\s*\(\s*\)\s*;\s*(?:\/\/.*|\(\*.*\*\))?\s*$/i.exec(text)?.[1] ?? null;
}

/**
 * The call on a line (1-based) of a method replaced by the called method's code → { pou, name, lines, calls } (calls:
 * the calls of it left in the POU) or { error }
 */
export function inlineMethod(pouXml: string, inMethod: string, line: number): { pou: string; name: string; lines: number; calls: number } | { error: string } {
  const host = getMethodCodeFromPou(pouXml, inMethod);
  if (!host.success || !host.methodFound) return { error: `${inMethod}() was not found` };
  const lines = host.code.split(/\r?\n/);
  const text = lines[line - 1];
  const name = text !== undefined ? callOnLine(text) : null;
  if (!name) return { error: 'The line is no call of a method on its own (Name();)' };
  const target = getMethodCodeFromPou(pouXml, name);
  if (!target.success || !target.methodFound) return { error: `${name}() is no method of this POU` };
  if (target.methodName.toLowerCase() === host.methodName.toLowerCase()) return { error: `${name}() calls itself` };
  const why = inlineBlocker(name, target.declaration, target.code);
  if (why) return { error: `${why}: it cannot be inlined` };
  const indent = text.match(/^[ \t]*/)![0];
  const body = reindent(target.code.split(/\r?\n/), indent);
  const eol = host.code.includes('\r\n') ? '\r\n' : '\n';
  const next = [...lines.slice(0, line - 1), ...(body.length ? body : [`${indent};`]), ...lines.slice(line)].join(eol);
  const u = updateMethodCodeInPou(pouXml, inMethod, next);
  if (!u.success) return { error: u.error || `Could not write ${inMethod}()` };
  const calls = (stripComments(u.updatedPou.replace(/<Method\b[^>]*\bName="([^"]+)"[\s\S]*?<\/Method>/gi, (m, n: string) => (n.toLowerCase() === name.toLowerCase() ? '' : m))).match(new RegExp(`\\b${name}\\s*\\(`, 'gi')) ?? []).length;
  return { pou: u.updatedPou, name: target.methodName, lines: body.filter((l) => l.trim()).length, calls };
}

/** The code editors' menu item: state names for the state variable's numbers in the code shown (null: none) */
export function numbersToEnumItem(code: string, names: { stateVar: string; enumType: string; names: Map<number, string> } | null | undefined, apply: (code: string) => void): { id: string; label: string; title: string; onSelect: () => void } | null {
  if (!names || !names.enumType || !names.names.size) return null;
  const r = numbersToEnum(code, names.stateVar, names.enumType, names.names);
  if (!r.count) return null;
  return {
    id: 'editor-menu-numbers-to-enum',
    label: `Use state names for numbers (${r.count})`,
    title: `${names.stateVar}'s numbers (:= 30, = 30, CASE labels) as ${names.enumType}'s members; Ctrl+Z undoes`,
    onSelect: () => apply(r.code),
  };
}

/**
 * The state variable's numbers as the enum's names: `stateVar := 30;`, `stateVar = 30`, `stateVar <> 30` and the
 * labels of `CASE stateVar OF` (30:, 30, 40:, 30..40 left as it is) → { code, count }
 */
export function numbersToEnum(code: string, stateVar: string, enumType: string, names: Map<number, string>): { code: string; count: number } {
  let count = 0;
  const name = (n: string) => {
    const s = names.get(Number(n));
    return s ? `${enumType}.${s}` : null;
  };
  const sv = stateVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const eol = code.includes('\r\n') ? '\r\n' : '\n';
  const lines = code.split(/\r?\n/);
  const assign = new RegExp(`(\\b${sv}\\s*(?::=|<>|=)\\s*)(-?\\d+)\\b(?![.#])`, 'gi');
  let caseDepth = -1;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const plain = stripComments(l);
    // (a label line of CASE stateVar OF, at its own level)
    if (caseDepth === depth && !/^\s*(ELSE|END_CASE)\b/i.test(plain)) {
      const lab = /^(\s*)([\d\s,]+)(:(?!=).*)$/.exec(l);
      if (lab && /\d/.test(lab[2]) && lab[2].split(',').every((x) => names.has(Number(x.trim())))) {
        lines[i] = lab[1] + lab[2].split(',').map((x) => name(x.trim())).join(', ') + lab[3];
        count += lab[2].split(',').length;
        continue;
      }
    }
    lines[i] = l.replace(assign, (m, pre: string, n: string) => {
      const s = name(n);
      if (!s) return m;
      count++;
      return pre + s;
    });
    if (new RegExp(`^\\s*CASE\\s+${sv}\\s+OF\\b`, 'i').test(plain)) {
      depth++;
      caseDepth = depth;
      continue;
    }
    if (/^\s*(IF|CASE|FOR|WHILE|REPEAT)\b/i.test(plain)) depth++;
    const closes = (plain.match(/\b(END_IF|END_CASE|END_FOR|END_WHILE|UNTIL)\b/gi) ?? []).length;
    for (let k = 0; k < closes; k++) {
      if (depth === caseDepth && /\bEND_CASE\b/i.test(plain)) caseDepth = -1;
      depth--;
    }
  }
  return { code: lines.join(eol), count };
}
