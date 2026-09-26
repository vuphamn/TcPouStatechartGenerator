/**
 * Edits made from the diagram: rename a state everywhere, add a state, add a transition. They work on the .TcPOU
 * and the .TcDUT text and return the new versions (the app saves them like its editors do).
 */

import { addCaseBranch, addEnumMember, blankComments, enumMembers } from './stateMachineLint.ts';
import { stateQualifier } from './stateNames.ts';
import { getMethodCodeFromPou } from './pouStateEditor.ts';
import { escapeRx } from './sourceLocation.ts';

export const isIdentifier = (name: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);

/** Why the new state name cannot be used (null: it can) */
export function checkNewStateName(pouXml: string, dutContent: string, name: string, oldName?: string): string | null {
  if (!isIdentifier(name)) return 'A state name is letters, digits and _ (not starting with a digit)';
  if (name === oldName) return 'That is the current name';
  if (dutContent && enumMembers(dutContent).some((m) => m.toLowerCase() === name.toLowerCase())) return `${name} is already in the enum`;
  if (new RegExp(`\\b${escapeRx(name)}\\b`, 'i').test(blankComments(pouXml))) return `${name} is already used in the POU`;
  return null;
}

const countAndReplace = (text: string, oldName: string, newName: string) => {
  const rx = new RegExp(`\\b${escapeRx(oldName)}\\b`, 'g');
  let count = 0;
  const next = text.replace(rx, () => {
    count++;
    return newName;
  });
  return { next, count };
};

/**
 * Renames a state in the POU (CASE labels, assignments, comparisons, getStateDescription, comments) and the
 * enum. Only whole identifiers change: X_HOMMING does not touch X_HOMMING_READY.
 */
export function renameState(pouXml: string, dutContent: string, oldName: string, newName: string) {
  const pou = countAndReplace(pouXml, oldName, newName);
  const dut = dutContent ? countAndReplace(dutContent, oldName, newName) : { next: dutContent, count: 0 };
  return { pou: pou.next, dut: dut.next, pouCount: pou.count, dutCount: dut.count };
}

/** Keys of a state-keyed map renamed (styles, notes, positions) */
export function renameKey<T>(map: Record<string, T> | undefined, oldName: string, newName: string): Record<string, T> | undefined {
  if (!map || !(oldName in map)) return map;
  const next = { ...map };
  next[newName] = next[oldName];
  delete next[oldName];
  return next;
}

/** Keys of a transition-keyed map ("FROM->TO", optionally "#n") renamed at either end */
export function renameEdgeKeys<T>(map: Record<string, T> | undefined, oldName: string, newName: string): Record<string, T> | undefined {
  if (!map) return map;
  let changed = false;
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(map)) {
    const m = key.match(/^(.*?)->(.*?)(#\d+)?$/);
    if (!m || (m[1] !== oldName && m[2] !== oldName)) {
      next[key] = value;
      continue;
    }
    changed = true;
    next[`${m[1] === oldName ? newName : m[1]}->${m[2] === oldName ? newName : m[2]}${m[3] ?? ''}`] = value;
  }
  return changed ? next : map;
}

/** Adds a state: an enum member (when there is a .TcDUT) and an empty CASE branch in doState() */
export function addState(pouXml: string, dutContent: string, name: string): { pouCode: string; dut: string | null } | null {
  const pouCode = addCaseBranch(pouXml, name);
  if (!pouCode) return null;
  const dut = dutContent?.trim() ? addEnumMember(dutContent, name) : null;
  return { pouCode, dut };
}

/**
 * doState()'s ST with a transition added at the end of the source state's branch:
 *   IF <condition> THEN
 *       <stateVar> := <TARGET>;
 *   END_IF
 * null when the source state has no branch (or doState has no CASE).
 */
export function addTransition(pouXml: string, from: string, to: string, condition: string, stateVar: string): string | null {
  const method = getMethodCodeFromPou(pouXml, 'doState');
  if (!method.methodFound) return null;
  const eol = method.code.includes('\r\n') ? '\r\n' : '\n';
  const lines = method.code.split(/\r?\n/);
  const code = blankComments(lines.join('\n')).split('\n');
  // The branch: from its label to the next label / ELSE / END_CASE of the same CASE (nesting counted)
  const labelRx = new RegExp(`^\\s*(?:[A-Za-z_][\\w.]*\\s*,\\s*)*(?:[A-Za-z_]\\w*\\.)?${escapeRx(from)}\\s*(?:,\\s*[A-Za-z_][\\w.]*\\s*)*:(?!=)`);
  const start = code.findIndex((l) => labelRx.test(l));
  if (start < 0) return null;
  let depth = 0;
  let end = code.length;
  for (let i = start + 1; i < code.length; i++) {
    const l = code[i];
    const opens = (l.match(/\b(CASE|IF|FOR|WHILE|REPEAT)\b/gi) ?? []).length;
    const closes = (l.match(/\bEND_(CASE|IF|FOR|WHILE|REPEAT)\b/gi) ?? []).length;
    if (depth === 0 && (/^\s*(ELSE|END_CASE)\b/i.test(l) || (/^\s*(?:[A-Za-z_][\w.]*\s*,\s*)*[A-Za-z_][\w.]*\s*:(?!=)/.test(l) && !/^\s*(ELSE|ELSIF|END_\w+)\b/i.test(l)))) {
      end = i;
      break;
    }
    depth += opens - closes;
    if (depth < 0) {
      end = i;
      break;
    }
  }
  // Insert after the branch's last non-empty line, indented like the branch body
  let last = end - 1;
  while (last > start && !lines[last].trim()) last--;
  const labelIndent = lines[start].match(/^[ \t]*/)![0];
  const body = lines.slice(start + 1, end).find((l) => l.trim());
  const indent = body ? body.match(/^[ \t]*/)![0] : labelIndent + '\t';
  const cond = condition.trim() || 'TRUE';
  // The target like the other assignments (a qualified_only enum needs "E_X.STATE")
  const target = `${stateQualifier(method.code, stateVar)}${to}`;
  lines.splice(last + 1, 0, `${indent}IF ${cond} THEN`, `${indent}\t${stateVar} := ${target};`, `${indent}END_IF`);
  return lines.join(eol);
}
