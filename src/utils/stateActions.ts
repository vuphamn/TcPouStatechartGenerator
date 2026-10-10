/**
 * A state's entry, do and exit actions (as TwinCAT's UML editor shows them), in its doState() branch:
 * - entry: IF bFirstPass THEN ... END_IF, the first cycle in the state (bFirstPass from the base FB);
 * - exit: IF <stateVar> <> <STATE> THEN ... END_IF at the end of the branch, the cycle the state is left in
 *   (after its transitions changed the state);
 * - do: the other statements of the branch that are no transitions, run every cycle.
 * Reading them (for the diagram) and writing one back.
 */
import { blankComments } from './stateMachineLint.ts';
import { getMethodCodeFromPou, updateMethodCodeInPou } from './pouStateEditor.ts';
import { caseBranchRange } from './stateEdits.ts';
import { escapeRx, labelNames } from './sourceLocation.ts';

export type ActionKind = 'entry' | 'do' | 'exit';

export interface StateActions {
  entry: string[];
  do: string[];
  exit: string[];
  /** do can be rewritten (its statements are together, before or after the transitions) */
  doEditable: boolean;
}

interface Stmt {
  /** [start, end) lines, comment lines above it included */
  start: number;
  end: number;
  /** From its first code line */
  code: number;
  kind: 'entry' | 'exit' | 'transition' | 'do';
}

const count = (l: string, rx: RegExp) => (l.match(rx) ?? []).length;
const netBlocks = (l: string) => count(l, /\b(IF|CASE|FOR|WHILE|REPEAT)\b/gi) - count(l, /\bEND_(IF|CASE|FOR|WHILE|REPEAT)\b/gi);
const netParens = (l: string) => count(l, /\(/g) - count(l, /\)/g);

/** The top-level statements of a branch's body lines */
function statements(code: string[], a: number, b: number, state: string, stateVar: string): Stmt[] {
  const out: Stmt[] = [];
  const assign = new RegExp(`\\b${escapeRx(stateVar)}\\s*:=\\s*(?:[A-Za-z_]\\w*\\s*\\.\\s*)*([A-Za-z_]\\w*)`, 'g');
  // (with or without spaces around the brackets: IF (bFirstPass) THEN, IF(bFirstPass)THEN)
  const entryRx = /^\s*IF(?:\s*\(\s*bFirstPass\s*\)\s*|\s+bFirstPass\s+)THEN\b/i;
  const exitCmp = `${escapeRx(stateVar)}\\s*<>\\s*(?:[A-Za-z_]\\w*\\s*\\.\\s*)?${escapeRx(state)}`;
  const exitRx = new RegExp(`^\\s*IF(?:\\s*\\(\\s*${exitCmp}\\s*\\)\\s*|\\s+${exitCmp}\\s+)THEN\\b`, 'i');
  let i = a;
  let pending = -1;
  while (i < b) {
    if (!code[i].trim()) {
      if (pending < 0) pending = i;
      i++;
      continue;
    }
    const start = pending >= 0 ? pending : i;
    pending = -1;
    const first = i;
    let blocks = netBlocks(code[i]);
    let parens = netParens(code[i]);
    // (to its END_ and closing bracket; a line without ; goes on: "x := a AND" / a call's arguments)
    const ends = (l: string) => /;\s*$/.test(l) || /\bEND_(IF|CASE|FOR|WHILE|REPEAT)\b\s*;?\s*$/i.test(l);
    while (i + 1 < b && (blocks > 0 || parens > 0 || !ends(code[i]))) {
      i++;
      blocks += netBlocks(code[i]);
      parens += netParens(code[i]);
    }
    const end = i + 1;
    const text = code.slice(first, end).join('\n');
    const targets = [...text.matchAll(assign)].map((m) => m[1]).filter((t) => t !== state);
    const firstLine = code[first];
    let kind: Stmt['kind'] = 'do';
    const noElse = !/^\s*(ELSE|ELSIF)\b/im.test(code.slice(first + 1, end).join('\n'));
    if (entryRx.test(firstLine) && !targets.length && noElse) kind = 'entry';
    else if (exitRx.test(firstLine) && !targets.length && noElse) kind = 'exit';
    else if (targets.length) kind = 'transition';
    out.push({ start, end, code: first, kind });
    i = end;
  }
  return out;
}

interface Branch {
  lines: string[];
  code: string[];
  eol: string;
  label: number;
  bodyStart: number;
  bodyEnd: number;
  stmts: Stmt[];
  methodCode: string;
}

function branchOf(pouXml: string, state: string, stateVar: string): Branch | { error: string } {
  const m = getMethodCodeFromPou(pouXml, 'doState');
  if (!m.methodFound) return { error: 'The POU has no doState()' };
  const eol = m.code.includes('\r\n') ? '\r\n' : '\n';
  const lines = m.code.split(/\r?\n/);
  const code = blankComments(lines.join('\n')).split('\n');
  const range = caseBranchRange(code, state);
  if (!range) return { error: `${state} has no CASE branch in doState()` };
  // (code on the label line after "STATE:" is not supported)
  const afterLabel = code[range.start].slice(code[range.start].search(/:(?!=)/) + 1).trim();
  if (afterLabel) return { error: `${state}'s branch has code on its label line: change it in the Method Editor` };
  let bodyEnd = range.end;
  while (bodyEnd > range.start + 1 && !lines[bodyEnd - 1].trim()) bodyEnd--;
  return { lines, code, eol, label: range.start, bodyStart: range.start + 1, bodyEnd, stmts: statements(code, range.start + 1, bodyEnd, state, stateVar), methodCode: m.code };
}

const bodyOf = (b: Branch, s: Stmt) => {
  // The block's inner lines (IF ... THEN / END_IF left out)
  const inner = b.lines.slice(s.code + 1, s.end - 1);
  return dedent(inner);
};

function dedent(lines: string[]): string[] {
  const nonEmpty = lines.filter((l) => l.trim());
  if (!nonEmpty.length) return [];
  const common = Math.min(...nonEmpty.map((l) => l.match(/^[ \t]*/)![0].length));
  return lines.map((l) => l.slice(Math.min(common, l.match(/^[ \t]*/)![0].length)));
}

/** A state's actions as written (each a list of code lines, without indentation) */
export function readStateActions(pouXml: string, state: string, stateVar: string): StateActions | { error: string } {
  const b = branchOf(pouXml, state, stateVar);
  if ('error' in b) return b;
  const entry = b.stmts.find((s) => s.kind === 'entry');
  const exit = [...b.stmts].reverse().find((s) => s.kind === 'exit');
  const dos = b.stmts.filter((s) => s.kind === 'do');
  const lines = (s?: Stmt) => (s ? bodyOf(b, s) : []);
  const doLines = dedent(dos.flatMap((s) => b.lines.slice(s.start, s.end)));
  // Editable when its statements are together: none between transitions
  const order = b.stmts.filter((s) => s.kind !== 'entry' && s.kind !== 'exit').map((s) => s.kind);
  const firstT = order.indexOf('transition');
  const lastT = order.lastIndexOf('transition');
  const doEditable = firstT < 0 || !order.slice(firstT, lastT + 1).includes('do');
  return { entry: trimBlank(lines(entry)), do: trimBlank(doLines), exit: trimBlank(lines(exit)), doEditable };
}

const trimBlank = (l: string[]) => {
  let a = 0;
  let z = l.length;
  while (a < z && !l[a].trim()) a++;
  while (z > a && !l[z - 1].trim()) z--;
  return l.slice(a, z);
};

/** Every state's actions, from doState()'s ST (for the diagram): state -> the first line of each action */
export function actionSummaries(pouXml: string, states: Iterable<string>, stateVar: string): Map<string, { entry?: string; do?: string; exit?: string; lines: Record<ActionKind, number> }> {
  const out = new Map<string, { entry?: string; do?: string; exit?: string; lines: Record<ActionKind, number> }>();
  for (const state of states) {
    const a = readStateActions(pouXml, state, stateVar);
    if ('error' in a) continue;
    const first = (l: string[]) => l.map((x) => x.replace(/\/\/.*$/, '').replace(/\(\*.*?\*\)/g, '').trim()).find((x) => x);
    const entry = first(a.entry);
    const exit = first(a.exit);
    const doFirst = first(a.do);
    if (entry || exit || doFirst) out.set(state, { entry, do: doFirst, exit, lines: { entry: a.entry.filter((l) => l.trim()).length, do: a.do.filter((l) => l.trim()).length, exit: a.exit.filter((l) => l.trim()).length } });
  }
  return out;
}

/**
 * The POU with one of a state's actions set to the code (empty: the action removed): entry first in the branch,
 * do after it (before the transitions), exit last.
 */
export function writeStateAction(pouXml: string, state: string, stateVar: string, kind: ActionKind, code: string, qualifier = ''): { pou: string; message: string } | { error: string } {
  const b = branchOf(pouXml, state, stateVar);
  if ('error' in b) return b;
  if (code.includes(']]>')) return { error: 'The code cannot hold ]]>' };
  const lines = [...b.lines];
  const label = lines[b.label];
  const bodyIndent = (() => {
    const l = lines.slice(b.bodyStart, b.bodyEnd).find((x) => x.trim());
    return l ? l.match(/^[ \t]*/)![0] : `${label.match(/^[ \t]*/)![0]}\t`;
  })();
  const newLines = code.replace(/\r\n/g, '\n').split('\n');
  const content = trimBlank(newLines);
  const block = (head: string) => (content.length ? [`${bodyIndent}${head}`, ...content.map((l) => (l.trim() ? `${bodyIndent}\t${l}` : '')), `${bodyIndent}END_IF`] : []);
  const replace = (s: Stmt | undefined, withLines: string[], at: number) => {
    if (s) lines.splice(s.code, s.end - s.code, ...withLines);
    else if (withLines.length) lines.splice(at, 0, ...withLines);
  };
  if (kind === 'entry') {
    const s = b.stmts.find((x) => x.kind === 'entry');
    replace(s, block('IF bFirstPass THEN'), b.bodyStart);
  } else if (kind === 'exit') {
    const s = [...b.stmts].reverse().find((x) => x.kind === 'exit');
    replace(s, block(`IF ${stateVar} <> ${qualifier}${state} THEN`), b.bodyEnd);
  } else {
    const a = readStateActions(pouXml, state, stateVar);
    if ('error' in a) return a;
    if (!a.doEditable) return { error: `${state}'s do code is between its transitions: change it in the Method Editor` };
    const dos = b.stmts.filter((x) => x.kind === 'do');
    const entry = b.stmts.find((x) => x.kind === 'entry');
    const firstT = b.stmts.find((x) => x.kind === 'transition');
    const exit = [...b.stmts].reverse().find((x) => x.kind === 'exit');
    // Where it goes: where it was, else after the entry, before the transitions
    const at = dos.length ? dos[0].start : firstT ? firstT.start : exit ? exit.start : entry ? entry.end : b.bodyEnd;
    const written = content.map((l) => (l.trim() ? `${bodyIndent}${l}` : ''));
    // Remove the old do statements (from the last, so the lines above stay)
    for (const s of [...dos].reverse()) lines.splice(s.start, s.end - s.start);
    const shift = dos.filter((s) => s.start < at).reduce((n, s) => n + (s.end - s.start), 0);
    lines.splice(at - shift, 0, ...written);
  }
  const u = updateMethodCodeInPou(pouXml, 'doState', lines.join(b.eol));
  if (!u.success) return { error: u.error || 'Could not write doState()' };
  const what = { entry: 'entry', do: 'do', exit: 'exit' }[kind];
  return { pou: u.updatedPou, message: content.length ? `${state}: ${what} action set (${content.filter((l) => l.trim()).length} line${content.length === 1 ? '' : 's'})` : `${state}: ${what} action removed` };
}

/** The state variable: the state method's CASE (machineState, mainState; State in another company's POU) */
function stateVarOfPou(pouXml: string): string {
  const m = pouXml ? getMethodCodeFromPou(pouXml, 'doState') : null;
  return m?.methodFound ? m.code.match(/\bCASE\s*\(?\s*(\w+)/i)?.[1] ?? 'machineState' : 'machineState';
}

/** Every state's actions (for the diagram): the states are doState()'s CASE labels */
export function allStateActions(pouXml: string, stateVarGiven?: string): Map<string, { entry?: string; do?: string; exit?: string }> {
  const m = pouXml ? getMethodCodeFromPou(pouXml, 'doState') : null;
  if (!m?.methodFound) return new Map();
  const stateVar = stateVarGiven ?? m.code.match(/\bCASE\s*\(?\s*(\w+)/i)?.[1] ?? 'machineState';
  const states = new Set<string>();
  for (const line of blankComments(m.code).split(/\r?\n/)) for (const n of labelNames(line)) if (/^[A-Za-z_]\w*$/.test(n) && !/^(ELSE|END_CASE)$/i.test(n)) states.add(n);
  const out = new Map<string, { entry?: string; do?: string; exit?: string }>();
  for (const [s, a] of actionSummaries(pouXml, states, stateVar)) out.set(s, { entry: a.entry, do: a.do, exit: a.exit });
  return out;
}

/** A state's whole code (its CASE branch's body in doState(), as written, without its indentation) */
export function readStateCode(pouXml: string, state: string): string[] | { error: string } {
  const b = branchOf(pouXml, state, stateVarOfPou(pouXml));
  if ('error' in b) return b;
  return trimBlank(dedent(b.lines.slice(b.bodyStart, b.bodyEnd)));
}

/** The POU with a state's whole code (its CASE branch's body) replaced, indented as the branch's body was */
export function writeStateCode(pouXml: string, state: string, code: string): { pou: string; message: string } | { error: string } {
  const b = branchOf(pouXml, state, stateVarOfPou(pouXml));
  if ('error' in b) return b;
  if (code.includes(']]>')) return { error: 'The code cannot hold ]]>' };
  const lines = [...b.lines];
  const label = lines[b.label];
  const bodyIndent = (() => {
    // (the smallest indentation of its lines: what reading it took off)
    const ind = lines.slice(b.bodyStart, b.bodyEnd).filter((x) => x.trim()).map((x) => x.match(/^[ \t]*/)![0]);
    return ind.length ? ind.reduce((m, x) => (x.length < m.length ? x : m)) : `${label.match(/^[ \t]*/)![0]}\t`;
  })();
  const content = trimBlank(code.replace(/\r\n/g, '\n').split('\n'));
  lines.splice(b.bodyStart, b.bodyEnd - b.bodyStart, ...content.map((l) => (l.trim() ? `${bodyIndent}${l}` : '')));
  const u = updateMethodCodeInPou(pouXml, 'doState', lines.join(b.eol));
  if (!u.success) return { error: u.error || 'Could not write doState()' };
  const n = content.filter((l) => l.trim()).length;
  return { pou: u.updatedPou, message: `${state}: its code set (${n} line${n === 1 ? '' : 's'})` };
}
