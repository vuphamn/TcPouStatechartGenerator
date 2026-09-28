/**
 * The Problems tab's variable checks: names used but declared nowhere (when the PLC project is known), variables
 * never used, and a name declared twice or hidden by a method's own.
 */
import { LintFinding, LINT_RULES, codeUnits } from './stateMachineLint.ts';
import { extractPouDeclaration } from './stSymbolDefinition.ts';
import { getMethodCodeFromPou } from './pouStateEditor.ts';
import { declarationVariables } from './pouVariables.ts';
import { ProjectSymbols, symbolScope } from './projectSymbols.ts';
import { renameInText, useOffsets } from './renameVariable.ts';
import { CALLED_FBS, STANDARD_FBS } from './stdSignatures.ts';
import { baseTypeName } from './projectSymbols.ts';

const KEYWORDS = new Set(
  (
    'IF THEN ELSE ELSIF END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT RETURN EXIT ' +
    'CONTINUE TRUE FALSE AND OR XOR NOT MOD AND_THEN OR_ELSE THIS SUPER JMP'
  ).split(' ')
);

/** Code with comments and strings blanked (same offsets) */
function masked(line: string): string {
  return line.replace(/'(?:\$.|[^'$])*'|"(?:\$.|[^"$])*"/g, (s) => ' '.repeat(s.length));
}

/** Names used in a unit's code (first use: line, text): calls, members, named parameters, literals left out */
function usedNames(code: string[], lines: string[]): Map<string, { name: string; line: number; text: string }> {
  const out = new Map<string, { name: string; line: number; text: string }>();
  let depth = 0;
  code.forEach((raw, i) => {
    const l = masked(raw);
    const rx = /[A-Za-z_]\w*|[()]/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(l))) {
      const w = m[0];
      if (w === '(') {
        depth++;
        continue;
      }
      if (w === ')') {
        depth = Math.max(0, depth - 1);
        continue;
      }
      const before = l.slice(0, m.index);
      const after = l.slice(m.index + w.length);
      if (/[.#]\s*$/.test(before) || /\d$/.test(before)) continue;
      if (/^\s*#/.test(after)) continue;
      if (/^\s*\(/.test(after)) continue;
      if (depth > 0 && /^\s*(:=|=>)/.test(after)) continue;
      // A CASE label: "STATE:" / "A, B:"
      if (/^\s*(,\s*[\w.]+\s*)*:(?!=)/.test(after) && /^\s*([\w.]+\s*,\s*)*$/.test(before)) continue;
      if (KEYWORDS.has(w.toUpperCase()) || w.startsWith('__')) continue;
      const k = w.toLowerCase();
      if (!out.has(k)) out.set(k, { name: w, line: i + 1, text: (lines[i] ?? '').trim() });
    }
  });
  return out;
}

/**
 * The findings. project: the PLC project's types, when the host read them (the undeclared check needs them: GVLs
 * and base classes are elsewhere); states: the state names.
 */
export function lintVariables(pouXml: string, project: ProjectSymbols | null, fromProject: boolean, states: string[]): LintFinding[] {
  if (!pouXml?.trim()) return [];
  const findings: LintFinding[] = [];
  const add = (f: Omit<LintFinding, 'severity'> & { severity?: LintFinding['severity'] }) => findings.push({ severity: LINT_RULES[f.rule].severity, ...f });
  const units = codeUnits(pouXml);
  const pouDecl = extractPouDeclaration(pouXml);
  const pouVars = declarationVariables(pouDecl);

  // Declared twice (in one declaration), and a method's own that hides a member of the POU
  const twice = (vars: { name: string; line?: number }[], where: string, method?: string) => {
    const seen = new Set<string>();
    for (const v of vars) {
      const k = v.name.toLowerCase();
      if (seen.has(k)) add({ key: `duplicate:${where}:${k}`, rule: 'duplicate-variable', method, message: `${v.name} is declared twice in ${where}`, mark: v.line ? { line: v.line, declaration: true, name: v.name } : undefined });
      seen.add(k);
    }
  };
  twice(pouVars, 'the POU declaration');
  const methodDecls = new Map<string, ReturnType<typeof declarationVariables>>();
  for (const u of units) {
    if (!u.method) continue;
    const m = getMethodCodeFromPou(pouXml, u.method);
    const vars = m.methodFound ? declarationVariables(m.declaration || '') : [];
    methodDecls.set(u.method, vars);
    twice(vars, `${u.method}()`, u.method);
    for (const v of vars) {
      const member = pouVars.find((p) => p.name.toLowerCase() === v.name.toLowerCase());
      if (member) add({ key: `shadow:${u.method}:${v.name.toLowerCase()}`, rule: 'duplicate-variable', severity: 'warning', method: u.method, message: `${u.method}() has its own ${v.name}: it hides the POU's ${v.name} (${member.scope}) there`, mark: v.line ? { line: v.line, declaration: true, name: v.name } : undefined });
    }
  }

  // Not used: the POU's VAR in all its code, a method's VAR / VAR_TEMP / VAR_INST in its own
  const allCode = [...units.map((u) => u.lines.join('\n')), ...[...pouXml.matchAll(/<Property\b[\s\S]*?<\/Property>/gi)].map((p) => p[0])].join('\n');
  const uses = (text: string, name: string) => renameInText(text, name, name).count;
  for (const v of pouVars) {
    if (v.scope !== 'VAR') continue;
    // (an initializer of another member counts too)
    const inDecl = uses(pouDecl, v.name) > 1;
    if (!inDecl && uses(allCode, v.name) === 0) add({ key: `unused:pou:${v.name.toLowerCase()}`, rule: 'unused-variable', message: `${v.name} : ${v.type} (VAR) is not used in the POU's code`, mark: v.line ? { line: v.line, declaration: true, name: v.name } : undefined, fix: { kind: 'remove-variable', name: v.name } });
  }
  for (const u of units) {
    if (!u.method) continue;
    for (const v of methodDecls.get(u.method) ?? []) {
      if (!/^(VAR|VAR_TEMP|VAR_INST)$/.test(v.scope)) continue;
      if (uses(u.lines.join('\n'), v.name) === 0) add({ key: `unused:${u.method}:${v.name.toLowerCase()}`, rule: 'unused-variable', method: u.method, message: `${v.name} : ${v.type} (${v.scope} of ${u.method}()) is not used there`, mark: v.line ? { line: v.line, declaration: true, name: v.name } : undefined, fix: { kind: 'remove-variable', name: v.name, method: u.method } });
    }
  }

  // An input written by the POU itself (name := ..., not a named parameter of a call). A command input (cmd_...)
  // is acknowledged by the POU resetting it, and so is any input reset to FALSE: that handshake is no finding
  for (const input of pouVars.filter((v) => v.scope === 'VAR_INPUT' && !/^cmd_/i.test(v.name))) {
    for (const u of units) {
      const hit = u.code.findIndex((raw) => {
        const l = masked(raw);
        const rx = new RegExp(`(^|[^\\w.])(${input.name})\\s*:=(?!\\s*FALSE\\s*;)`, 'gi');
        let m: RegExpExecArray | null;
        while ((m = rx.exec(l))) {
          const before = l.slice(0, m.index + m[1].length);
          if ((before.match(/\(/g) ?? []).length <= (before.match(/\)/g) ?? []).length) return true;
        }
        return false;
      });
      if (hit < 0) continue;
      add({ key: `input-written:${u.method ?? 'body'}:${input.name.toLowerCase()}`, rule: 'input-written', method: u.method ?? undefined, line: u.method ? hit + 1 : undefined, text: u.lines[hit]?.trim(), message: `${input.name} (VAR_INPUT) is written${u.method ? ` in ${u.method}()` : ' in the body'}: the caller's value overwrites it`, mark: { line: hit + 1, declaration: false, name: input.name } });
    }
  }

  // A PRIVATE method nothing calls
  for (const m of pouXml.matchAll(/<Method\b[^>]*\bName="([^"]+)"[^>]*>\s*<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>/gi)) {
    const head = m[2].split(/\r?\n/).find((l) => /^\s*METHOD\b/i.test(l)) ?? '';
    if (!/\bPRIVATE\b/i.test(head)) continue;
    const called = units.filter((u) => u.method?.toLowerCase() !== m[1].toLowerCase()).some((u) => useOffsets(u.lines.join('\n'), m[1]).length > 0);
    if (!called) add({ key: `unused-method:${m[1].toLowerCase()}`, rule: 'unused-method', method: m[1], message: `${m[1]}() is PRIVATE and nothing in the POU calls it`, fix: { kind: 'remove-method', name: m[1] } });
  }

  // Code after a RETURN, in the same block
  for (const u of units) {
    u.code.forEach((raw, i) => {
      if (!/^\s*RETURN\s*;?\s*$/i.test(raw)) return;
      let j = i + 1;
      while (j < u.code.length && !u.code[j].trim()) j++;
      const next = u.code[j];
      if (next === undefined) return;
      if (/^\s*(END_IF|ELSE|ELSIF|END_CASE|END_FOR|END_WHILE|UNTIL|END_REPEAT)\b/i.test(next)) return;
      if (/^\s*(?:[A-Za-z_][\w.]*|\d+)(?:\s*(?:,|\.\.)\s*(?:[A-Za-z_][\w.]*|\d+))*\s*:(?!=)/.test(next)) return;
      add({ key: `unreachable:${u.method ?? 'body'}:${j + 1}`, rule: 'unreachable-code', method: u.method ?? undefined, line: u.method ? j + 1 : undefined, text: u.lines[j]?.trim(), message: `Line ${j + 1}${u.method ? ` of ${u.method}()` : ' of the body'} comes right after a RETURN: it never runs`, mark: { line: j + 1, declaration: false, name: (next.match(/[A-Za-z_]\w*/) ?? [''])[0] }, fix: u.method ? { kind: 'remove-lines', name: `line ${j + 1}`, method: u.method, line: j + 1 } : undefined });
    });
  }

  // A timer / trigger / counter read but never called
  const bodyCode = units.map((u) => masked(u.code.join('\n'))).join('\n');
  for (const v of pouVars) {
    if (!CALLED_FBS.has(baseTypeName(v.type).toUpperCase())) continue;
    const used = new RegExp(`\\b${v.name}\\s*\\.`, 'i').test(bodyCode);
    const called = new RegExp(`\\b${v.name}\\s*(\\[[^\\]]*\\])?\\s*\\(`, 'i').test(bodyCode);
    if (used && !called) add({ key: `fb-not-called:${v.name.toLowerCase()}`, rule: 'fb-not-called', message: `${v.name} : ${v.type} is read but never called (${v.name}(...)): its outputs never change`, mark: v.line ? { line: v.line, declaration: true, name: v.name } : undefined, fix: { kind: 'insert-call', name: v.name, type: baseTypeName(v.type).toUpperCase() } });
  }

  // A timer called without its time (no PT in any call, none assigned): it runs out at once
  for (const v of pouVars) {
    if (!['TON', 'TOF', 'TP'].includes(baseTypeName(v.type).toUpperCase())) continue;
    const calls = new RegExp(`\\b${v.name}\\s*\\(([^()]*(?:\\([^()]*\\)[^()]*)*)\\)`, 'gi');
    let anyCall = false;
    let hasPt = new RegExp(`\\b${v.name}\\s*\\.\\s*PT\\s*:=`, 'i').test(bodyCode);
    for (const m of bodyCode.matchAll(calls)) {
      anyCall = true;
      const args = m[1].split(',');
      // (by name, or the second of positional arguments)
      if (args.some((a) => /^\s*PT\s*:=/i.test(a)) || (args.length >= 2 && !args.some((a) => /:=|=>/.test(a)))) hasPt = true;
    }
    if (!anyCall || hasPt) continue;
    // (the fix: in the first call, in a method)
    let at: { method: string; line: number } | null = null;
    for (const u of units) {
      if (!u.method || at) continue;
      const i = u.code.findIndex((l) => new RegExp(`\\b${v.name}\\s*\\(`, 'i').test(masked(l)));
      if (i >= 0) at = { method: u.method, line: i + 1 };
    }
    add({ key: `timer-no-pt:${v.name.toLowerCase()}`, rule: 'timer-no-pt', method: at?.method, line: at?.line, message: `${v.name} : ${v.type} is called without PT (its time): it runs out at once`, mark: v.line ? { line: v.line, declaration: true, name: v.name } : undefined, fix: at ? { kind: 'add-pt', name: v.name, method: at.method, line: at.line } : undefined });
  }

  // Not declared (the project known, the base class too)
  if (fromProject && project) {
    for (const u of units) {
      const scope = symbolScope(pouXml, project, { method: u.method ?? '__none__', states });
      if (!scope.complete) break;
      const known = new Set([...scope.top.map((v) => v.name.toLowerCase()), ...scope.knownNames.map((n) => n.toLowerCase())]);
      for (const [k, use] of usedNames(u.code, u.lines)) {
        if (known.has(k)) continue;
        add({ key: `undeclared:${u.method ?? 'body'}:${k}`, rule: 'undeclared-variable', method: u.method ?? undefined, line: u.method ? use.line : undefined, text: use.text, message: `${use.name} is not declared${u.method ? ` (in ${u.method}())` : ''}`, mark: { line: use.line, declaration: false, name: use.name }, fix: { kind: 'declare-variable', name: use.name, method: u.method ?? undefined } });
      }
    }
  }
  return findings;
}

/** An underline in a code editor (as CodeMarker) */
export interface FindingMarker {
  line: number;
  start: number;
  end: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

/**
 * The underlines of a code editor: the findings of its method (none: the POU's own) and part, on the line with
 * the name (found again nearby when the code was edited since)
 */
export function markersFor(findings: LintFinding[], code: string, where: { method?: string; declaration: boolean }): FindingMarker[] {
  const lines = code.split(/\r?\n/);
  const out: FindingMarker[] = [];
  const wordAt = (l: string, name: string) => {
    const rx = new RegExp(`(^|[^\\w.])(${name})\\b`, 'i');
    const m = l.replace(/\/\/.*$/, (c) => ' '.repeat(c.length)).match(rx);
    return m && m.index !== undefined ? m.index + m[1].length : -1;
  };
  for (const f of findings) {
    if (!f.mark || f.mark.declaration !== where.declaration) continue;
    if ((f.method ?? '').toLowerCase() !== (where.method ?? '').replace(/\(\)$/, '').toLowerCase()) continue;
    let line = f.mark.line;
    let col = wordAt(lines[line - 1] ?? '', f.mark.name);
    for (let d = 1; col < 0 && d < 30; d++) {
      for (const cand of [line - d, line + d]) {
        const c = wordAt(lines[cand - 1] ?? '', f.mark.name);
        if (c >= 0) {
          line = cand;
          col = c;
          break;
        }
      }
    }
    if (col < 0) continue;
    out.push({ line, start: col, end: col + f.mark.name.length, message: f.message, severity: f.severity });
  }
  return out;
}

/** A neutral value for a standard FB's input (the call's placeholder: the user sets the real one) */
const NEUTRAL: Record<string, string> = { BOOL: 'FALSE', TIME: 'T#0S', LTIME: 'LTIME#0S', WORD: '0', INT: '0' };

/** Where a never-called FB's call goes: before its first use (a method and a line), and the call */
export function plannedCall(pouXml: string, name: string, type: string): { method: string; line: number; text: string } | null {
  const inputs = (STANDARD_FBS[type] ?? []).filter((p) => p.scope === 'VAR_INPUT');
  for (const u of codeUnits(pouXml)) {
    if (!u.method) continue;
    const i = u.code.findIndex((l) => new RegExp(`\\b${name}\\s*\\.`, 'i').test(masked(l)));
    if (i < 0) continue;
    const indent = (u.lines[i].match(/^[ \t]*/) ?? [''])[0];
    return { method: u.method, line: i + 1, text: `${indent}${name}(${inputs.map((p) => `${p.name} := ${NEUTRAL[p.type] ?? '0'}`).join(', ')});` };
  }
  return null;
}

/** The lines that never run, from a line after a RETURN to the end of its block (1-based, inclusive) */
export function deadLines(code: string, from: number): { start: number; end: number } {
  const lines = code.split(/\r?\n/).map((l) => masked(l.replace(/\/\/.*$/, '')));
  let depth = 0;
  let end = from;
  for (let i = from - 1; i < lines.length; i++) {
    const l = lines[i];
    if (depth === 0 && i > from - 1 && (/^\s*(END_IF|ELSE|ELSIF|END_CASE|END_FOR|END_WHILE|UNTIL|END_REPEAT)\b/i.test(l) || /^\s*(?:[A-Za-z_][\w.]*|\d+)(?:\s*,\s*(?:[A-Za-z_][\w.]*|\d+))*\s*:(?!=)/.test(l))) break;
    if (depth === 0 && i === from - 1 && /^\s*(END_IF|ELSE|ELSIF|END_CASE|END_FOR|END_WHILE|UNTIL|END_REPEAT)\b/i.test(l)) break;
    depth += (l.match(/\b(IF|CASE|FOR|WHILE|REPEAT)\b/gi) ?? []).length - (l.match(/\bEND_(IF|CASE|FOR|WHILE|REPEAT)\b/gi) ?? []).length;
    end = i + 1;
    if (depth < 0) {
      end = i;
      break;
    }
  }
  // (trailing blank lines stay)
  while (end > from && !lines[end - 1].trim()) end--;
  return { start: from, end };
}
