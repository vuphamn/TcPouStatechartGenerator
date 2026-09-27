/**
 * Transition edits made on the canvas, written back to the ST:
 * - priority: the order of a state's outgoing transitions in its doState() branch (the generator numbers them in
 *   assignment order), or the order of the transitions in preProcess(). Swaps IF / ELSIF arms of one IF, or whole
 *   statements of the branch;
 * - the end: "<stateVar> := OLD" becomes ":= NEW" (the qualifier kept);
 * - the start: the transition's IF block (or IF / ELSIF arm, as an IF of its own) moves to the end of another
 *   state's branch.
 * Each returns the method's new code (the app saves it like the Method Editor does) or why it cannot.
 */

import { blankComments } from './stateMachineLint.ts';
import { getMethodCodeFromPou } from './pouStateEditor.ts';
import { escapeRx, labelNames, locateTransition } from './sourceLocation.ts';
import { caseBranchRange } from './stateEdits.ts';

export interface EdgeRef {
  from: string;
  to: string;
  priority?: number;
  condition?: string;
  label?: string;
}

export type TransitionMethod = 'doState' | 'preProcess';
export type TransitionEditResult = { method: TransitionMethod; code: string; message: string; line: number; removed?: string[] } | { error: string };

/** One "<stateVar> := TARGET" of the scope, in order (0-based line in the method; col / len: the target name) */
interface Item {
  to: string;
  line: number;
  col: number;
  len: number;
}

interface Scope {
  method: TransitionMethod;
  eol: string;
  lines: string[];
  code: string[];
  /** doState: the label line of the branch */
  label: number;
  /** The statements: [start, end) */
  start: number;
  end: number;
  items: Item[];
}

export const isPreProcessEdge = (edge: EdgeRef) => /^\[preProcess\]/i.test((edge.condition || edge.label || '').trim());

const splitLines = (text: string) => text.split(/\r?\n/);
const blanked = (lines: string[]) => blankComments(lines.join('\n')).split('\n');

function scanItems(code: string[], label: number, start: number, end: number, from: string | null, stateVar: string): Item[] {
  const rx = new RegExp(`\\b${escapeRx(stateVar)}\\s*:=\\s*((?:[A-Za-z_]\\w*\\s*\\.\\s*)*)([A-Za-z_]\\w*)`, 'g');
  const items: Item[] = [];
  for (let i = label >= 0 ? label : start; i < end; i++) {
    let text = code[i];
    // The label line: only the code after "LABEL:"
    if (i === label) {
      const colon = text.search(/:(?!=)/);
      text = ' '.repeat(colon + 1) + text.slice(colon + 1);
    }
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      const to = m[2];
      // A state setting itself is not a transition (as in the generator)
      if (from && to === from) continue;
      items.push({ to, line: i, col: m.index + m[0].length - to.length, len: to.length });
    }
  }
  return items;
}

function scopeOf(pouXml: string, method: TransitionMethod, from: string | null, stateVar: string): Scope | { error: string } {
  const m = getMethodCodeFromPou(pouXml, method);
  if (!m.methodFound) return { error: `The POU has no ${method}() method` };
  const eol = m.code.includes('\r\n') ? '\r\n' : '\n';
  const lines = splitLines(m.code);
  const code = blanked(lines);
  let label = -1;
  let start = 0;
  let end = lines.length;
  if (method === 'doState') {
    const range = from ? caseBranchRange(code, from) : null;
    if (!range) return { error: `${from} has no CASE branch in doState()` };
    label = range.start;
    start = range.start + 1;
    end = range.end;
  }
  return { method, eol, lines, code, label, start, end, items: scanItems(code, label, start, end, method === 'doState' ? from : null, stateVar) };
}

const rescan = (s: Scope, lines: string[], stateVar: string, from: string | null): Scope => {
  const code = blanked(lines);
  return { ...s, lines, code, items: scanItems(code, s.label, s.start, s.end, s.method === 'doState' ? from : null, stateVar) };
};

/** The scope of an edge: its source state's branch in doState(), or preProcess() */
function edgeScope(pouXml: string, edge: EdgeRef, stateVar: string) {
  if (edge.from === '[*]' || edge.to === '[*]') return { error: 'The initial transition is the state variable’s initial value (in the declaration)' };
  return isPreProcessEdge(edge) ? scopeOf(pouXml, 'preProcess', null, stateVar) : scopeOf(pouXml, 'doState', edge.from, stateVar);
}

const notFound = (method: TransitionMethod, edge: EdgeRef, stateVar: string) => ({
  error: `${stateVar} := ${edge.to} was not found in ${method}()${method === 'doState' ? ` (in ${edge.from}’s branch)` : ''}: a composite state? Change it in the Method Editor`,
});

/** Which assignment an edge is: by its priority, else the only one to its target, else the one locateTransition finds */
function pick(pouXml: string, s: Scope, edge: EdgeRef): number {
  const candidates = s.items.map((t, i) => ({ t, i })).filter(({ t }) => t.to === edge.to);
  if (candidates.length === 0) return -1;
  if (s.method === 'doState' && edge.priority && s.items[edge.priority - 1]?.to === edge.to) return edge.priority - 1;
  if (candidates.length === 1) return candidates[0].i;
  const loc = locateTransition(pouXml, edge);
  return (loc && candidates.find(({ t }) => t.line === loc.line - 1)?.i) ?? candidates[0].i;
}

// Statements of a list of lines: a line of its own, or a block (IF / CASE / FOR / WHILE / REPEAT to its END_), and
// an IF's arms (IF / ELSIF / ELSE to the next one, the END_IF line excluded)
interface Arm {
  kw: 'IF' | 'ELSIF' | 'ELSE';
  /** From the comment lines right above its keyword (they belong to it) */
  start: number;
  /** The keyword's line */
  head: number;
  body: number;
  end: number;
}
interface Stmt {
  start: number;
  end: number;
  arms?: Arm[];
}

const count = (l: string, rx: RegExp) => (l.match(rx) ?? []).length;
const net = (l: string) => count(l, /\b(IF|CASE|FOR|WHILE|REPEAT)\b/gi) - count(l, /\bEND_(IF|CASE|FOR|WHILE|REPEAT)\b/gi);

function parseList(code: string[], lines: string[], a: number, b: number): Stmt[] {
  const out: Stmt[] = [];
  let i = a;
  // The comment lines right above a statement belong to it (they move with it)
  let lead: number | null = null;
  while (i < b) {
    if (!code[i].trim()) {
      lead = lines[i].trim() ? (lead ?? i) : null;
      i++;
      continue;
    }
    const first = lead ?? i;
    lead = null;
    let depth = net(code[i]);
    if (depth <= 0) {
      out.push({ start: first, end: i + 1 });
      i++;
      continue;
    }
    let j = i;
    const armStarts: number[] = [];
    while (depth > 0 && j + 1 < b) {
      j++;
      if (depth === 1 && /^\s*(ELSIF|ELSE)\b/i.test(code[j])) armStarts.push(j);
      depth += net(code[j]);
    }
    let arms: Arm[] | undefined;
    if (depth === 0 && /^\s*IF\b/i.test(code[i])) {
      // An ELSIF / ELSE arm starts at the comment lines right above it
      const heads = [i, ...armStarts];
      const starts = heads.map((hd, k) => {
        let st = k === 0 ? first : hd;
        while (k > 0 && st - 1 > heads[k - 1] && !code[st - 1].trim() && lines[st - 1].trim()) st--;
        return st;
      });
      arms = heads.map((s, k) => {
        const e = k + 1 < starts.length ? starts[k + 1] : j;
        const kw: Arm['kw'] = k === 0 ? 'IF' : /^\s*ELSIF\b/i.test(code[s]) ? 'ELSIF' : 'ELSE';
        let t = s;
        if (kw !== 'ELSE') while (t < e - 1 && !/\bTHEN\b/i.test(code[t])) t++;
        return { kw, start: starts[k], head: s, body: t + 1, end: e };
      });
    }
    out.push({ start: first, end: j + 1, arms });
    i = j + 1;
  }
  return out;
}

const inRange = (line: number, r: { start: number; end: number }) => line >= r.start && line < r.end;
const itemsIn = (s: Scope, r: { start: number; end: number }) => s.items.filter((t) => inRange(t.line, r)).length;
const setKeyword = (line: string, kw: 'IF' | 'ELSIF') => line.replace(/^(\s*)(IF|ELSIF)\b/i, `$1${kw}`);

/** Lines with [r1) and [r2) (r1 first, apart) swapped; where r1's text now starts */
function swapRanges(lines: string[], r1: { start: number; end: number }, r2: { start: number; end: number }) {
  const next = [...lines.slice(0, r1.start), ...lines.slice(r2.start, r2.end), ...lines.slice(r1.end, r2.start), ...lines.slice(r1.start, r1.end), ...lines.slice(r2.end)];
  return { next, r1At: r1.start + (r2.end - r2.start) + (r2.start - r1.end) };
}

const TOGETHER = 'it is in the same block as other transitions: change the order in the Method Editor';

/** The lines with transitions a and a + 1 swapped */
function swapAdjacent(s: Scope, a: number): string[] | { error: string } {
  const A = s.items[a];
  const B = s.items[a + 1];
  let from = s.start;
  let to = s.end;
  for (;;) {
    const stmts = parseList(s.code, s.lines, from, to);
    const sA = stmts.find((x) => inRange(A.line, x));
    const sB = stmts.find((x) => inRange(B.line, x));
    if (!sA || !sB) return { error: `The transitions to ${A.to} and ${B.to} could not be told apart in the code` };
    if (sA !== sB) {
      if (itemsIn(s, sA) !== 1 || itemsIn(s, sB) !== 1) return { error: `Cannot swap ${A.to} and ${B.to}: ${TOGETHER}` };
      return swapRanges(s.lines, sA, sB).next;
    }
    const aA = sA.arms?.find((x) => inRange(A.line, x));
    const aB = sA.arms?.find((x) => inRange(B.line, x));
    if (!aA || !aB) return { error: `Cannot swap ${A.to} and ${B.to}: they are in one statement (CASE, FOR, a single line…)` };
    if (aA !== aB) {
      if (aB.kw === 'ELSE') return { error: `Cannot move ${B.to} before ${A.to}: it is the ELSE of the IF` };
      if (itemsIn(s, aA) !== 1 || itemsIn(s, aB) !== 1) return { error: `Cannot swap ${A.to} and ${B.to}: ${TOGETHER}` };
      // The arms' conditions and code swap; the first keeps IF
      const { next, r1At } = swapRanges(s.lines, aA, aB);
      const firstHead = aA.start + (aB.head - aB.start);
      const secondHead = r1At + (aA.head - aA.start);
      next[firstHead] = setKeyword(next[firstHead], aA.kw as 'IF' | 'ELSIF');
      next[secondHead] = setKeyword(next[secondHead], 'ELSIF');
      return next;
    }
    from = aA.body;
    to = aA.end;
  }
}

/** The order of the edge's transition among its source state's (doState) or preProcess()'s transitions */
export function transitionOrder(pouXml: string, edge: EdgeRef, stateVar: string) {
  const s = edgeScope(pouXml, edge, stateVar);
  if ('error' in s) return s;
  const index = pick(pouXml, s, edge);
  if (index < 0) return notFound(s.method, edge, stateVar);
  return { method: s.method, priority: index + 1, count: s.items.length, targets: s.items.map((t) => t.to) };
}

/** Moves the edge's transition to the given priority (1 = checked first) */
export function setTransitionPriority(pouXml: string, edge: EdgeRef, priority: number, stateVar: string): TransitionEditResult {
  let s = edgeScope(pouXml, edge, stateVar);
  if ('error' in s) return s;
  let index = pick(pouXml, s, edge);
  if (index < 0) return notFound(s.method, edge, stateVar);
  const target = Math.max(0, Math.min(s.items.length - 1, Math.round(priority) - 1));
  if (target === index) return { error: `${edge.from} → ${edge.to} already has priority ${index + 1}` };
  const from = s.method === 'doState' ? edge.from : null;
  while (index !== target) {
    const a = target < index ? index - 1 : index;
    const next = swapAdjacent(s, a);
    if (!Array.isArray(next)) return next;
    s = rescan(s, next, stateVar, from);
    index = target < index ? index - 1 : index + 1;
  }
  const what = s.method === 'doState' ? `priority ${target + 1} of ${s.items.length} in ${edge.from}` : `position ${target + 1} of ${s.items.length} in preProcess()`;
  return { method: s.method, code: s.lines.join(s.eol), message: `${edge.from} → ${edge.to} now has ${what}`, line: s.items[target].line + 1 };
}

/** The edge's transition goes to another state: its assignment's target changes */
export function retargetTransition(pouXml: string, edge: EdgeRef, newTo: string, stateVar: string): TransitionEditResult {
  const s = edgeScope(pouXml, edge, stateVar);
  if ('error' in s) return s;
  if (newTo === edge.to) return { error: `It already goes to ${newTo}` };
  if (s.method === 'doState' && newTo === edge.from) return { error: `${edge.from} cannot go to itself: that is no transition` };
  const index = pick(pouXml, s, edge);
  if (index < 0) return notFound(s.method, edge, stateVar);
  const t = s.items[index];
  const lines = [...s.lines];
  const l = lines[t.line];
  lines[t.line] = l.slice(0, t.col) + newTo + l.slice(t.col + t.len);
  return { method: s.method, code: lines.join(s.eol), message: `${edge.from} → ${newTo} (was → ${edge.to}), in ${s.method}() line ${t.line + 1}`, line: t.line + 1 };
}


export const leading = (l: string) => l.match(/^[ \t]*/)![0];

/** Lines re-indented: their common indentation replaced by indent */
export function reindent(lines: string[], indent: string): string[] {
  const nonEmpty = lines.filter((l) => l.trim());
  const common = nonEmpty.map(leading).reduce((a, b) => {
    let k = 0;
    while (k < a.length && k < b.length && a[k] === b[k]) k++;
    return a.slice(0, k);
  }, nonEmpty.length ? leading(nonEmpty[0]) : '');
  return lines.map((l) => (l.trim() ? indent + l.slice(common.length) : l));
}

/**
 * The code of a transition, taken out of its scope: the largest statement / IF arm holding only this transition
 * (an arm becomes an IF of its own). move: only at the scope's top level, where its conditions are its own;
 * delete: also nested, else just the assignment's line.
 */
function takeTransition(s: Scope, t: Item, mode: 'move' | 'delete', edge: EdgeRef, stateVar: string): { lines: string[]; taken: string[]; removed: string[]; note: string } | { error: string } {
  const lines = [...s.lines];
  const name = `${edge.from} → ${edge.to}`;
  let from = s.start;
  let to = s.end;
  let nested = false;
  // Every assignment of the state variable counts here: a block setting the state to itself stays where it is
  const all = scanItems(s.code, s.label, s.start, s.end, null, stateVar);
  const assignsIn = (r: { start: number; end: number }) => all.filter((x) => inRange(x.line, r)).length;
  for (;;) {
    const st = parseList(s.code, s.lines, from, to).find((x) => inRange(t.line, x));
    if (!st) return { error: `${name} is on the state’s label line: change it in the Method Editor` };
    if (assignsIn(st) === 1) {
      if (nested && mode === 'move') return { error: `Cannot move ${name}: ${TOGETHER}` };
      const taken = lines.slice(st.start, st.end);
      return { lines: [...lines.slice(0, st.start), ...lines.slice(st.end)], taken, removed: taken, note: '' };
    }
    const arms = st.arms;
    const arm = arms?.find((x) => inRange(t.line, x));
    const nextArm = arm && arms![arms!.indexOf(arm) + 1];
    const alone = !!arm && assignsIn(arm) === 1;
    if (mode === 'move') {
      if (!arm || !alone || nested) return { error: `Cannot move ${name}: ${TOGETHER}` };
      if (arm.kw === 'ELSE') return { error: `${name} is the ELSE of an IF: move it in the Method Editor` };
      if (arm.kw === 'IF' && nextArm?.kw === 'ELSE') return { error: `The IF of ${name} has an ELSE: move it in the Method Editor` };
    }
    if (arm && alone && !(arm.kw === 'IF' && nextArm?.kw === 'ELSE')) {
      // The arm out of the IF; as an IF of its own
      const endIf = lines[st.end - 1].trim().match(/^END_IF\s*;?/i)?.[0] ?? 'END_IF';
      const taken = lines.slice(arm.start, arm.end);
      if (arm.kw !== 'ELSE') taken[arm.head - arm.start] = setKeyword(taken[arm.head - arm.start], 'IF');
      taken.push(`${leading(lines[arm.head])}${endIf}`);
      const rest = [...lines.slice(0, arm.start), ...lines.slice(arm.end)];
      if (arm.kw === 'IF') {
        const head = nextArm!.head - (arm.end - arm.start);
        rest[head] = setKeyword(rest[head], 'IF');
      }
      return { lines: rest, taken, removed: lines.slice(arm.start, arm.end), note: arm.kw === 'ELSIF' ? ' (as an IF of its own: the conditions before it in the IF no longer apply)' : '' };
    }
    if (arm && !alone) {
      from = arm.body;
      to = arm.end;
      nested = true;
      continue;
    }
    // delete: just the assignment, when its line holds nothing else
    const only = new RegExp(`^\\s*${escapeRx(stateVar)}\\s*:=\\s*(?:[A-Za-z_]\\w*\\s*\\.\\s*)*${escapeRx(t.to)}\\s*;?\\s*$`);
    if (!only.test(s.code[t.line])) return { error: `Cannot delete ${name}: ${TOGETHER}` };
    return { lines: [...lines.slice(0, t.line), ...lines.slice(t.line + 1)], taken: [lines[t.line]], removed: [lines[t.line]], note: '' };
  }
}

/** The edge's transition leaves another state: its code moves to the end of that state's branch (lowest priority) */
export function moveTransitionStart(pouXml: string, edge: EdgeRef, newFrom: string, stateVar: string): TransitionEditResult {
  if (isPreProcessEdge(edge)) return { error: 'A preProcess() transition leaves any state: change its condition in preProcess()' };
  if (newFrom === '[*]') return { error: 'The initial transition is the state variable’s initial value (in the declaration)' };
  if (newFrom === edge.from) return { error: `It already leaves ${newFrom}` };
  if (newFrom === edge.to) return { error: `${newFrom} cannot go to itself: that is no transition` };
  const s = edgeScope(pouXml, edge, stateVar);
  if ('error' in s) return s;
  const shared = labelNames(s.code[s.label]);
  if (shared.length > 1) return { error: `The branch of ${edge.from} is shared by ${shared.join(', ')}: move it in the Method Editor` };
  if (!caseBranchRange(s.code, newFrom)) return { error: `${newFrom} has no CASE branch in doState()` };
  const index = pick(pouXml, s, edge);
  if (index < 0) return notFound('doState', edge, stateVar);
  const took = takeTransition(s, s.items[index], 'move', edge, stateVar);
  if ('error' in took) return took;

  // At the end of the new branch, indented like its code
  let lines = took.lines;
  const range = caseBranchRange(blanked(lines), newFrom)!;
  let last = range.end - 1;
  while (last > range.start && !lines[last].trim()) last--;
  const body = lines.slice(range.start + 1, range.end).find((l) => l.trim());
  const indent = body ? leading(body) : leading(lines[range.start]) + '\t';
  lines = [...lines.slice(0, last + 1), ...reindent(took.taken, indent), ...lines.slice(last + 1)];
  return {
    method: 'doState',
    code: lines.join(s.eol),
    message: `${newFrom} → ${edge.to} (was ${edge.from} →), last in ${newFrom}’s branch${took.note}`,
    line: last + 2,
  };
}

/** The edge's transition deleted: its code block (its IF, IF arm, or the assignment) */
export function deleteTransition(pouXml: string, edge: EdgeRef, stateVar: string): TransitionEditResult {
  const s = edgeScope(pouXml, edge, stateVar);
  if ('error' in s) return s;
  const index = pick(pouXml, s, edge);
  if (index < 0) return notFound(s.method, edge, stateVar);
  const t = s.items[index];
  const took = takeTransition(s, t, 'delete', edge, stateVar);
  if ('error' in took) return took;
  const n = took.removed.filter((l) => l.trim()).length;
  return {
    method: s.method,
    code: took.lines.join(s.eol),
    message: `Deleted ${edge.from} → ${edge.to} from ${s.method}() (${n} line${n === 1 ? '' : 's'})`,
    line: t.line + 1,
    removed: took.removed,
  };
}

/** Where a transition's own condition is: the IF / ELSIF head right around its assignment */
interface ConditionHead {
  /** Lines of the head: from the keyword's line to the THEN's (inclusive) */
  first: number;
  last: number;
  keyword: 'IF' | 'ELSIF';
  /** The condition as written (lines joined) */
  condition: string;
  /** A composite's exception transition in preProcess(): the state range kept, only the part in ( ) edited */
  range?: { prefix: string };
}

/** The IF / ELSIF around a line of the scope (null: none, the assignment is unconditional; an error: in an ELSE) */
function conditionHead(s: Scope, line: number, col: number): ConditionHead | null | { error: string } {
  const head = (i: number): ConditionHead | { error: string } => {
    const kw = s.code[i].match(/^(\s*)(IF|ELSIF)\b/i)!;
    const startCol = kw[0].length;
    // From the keyword to THEN (a condition may take several lines)
    let j = i;
    let thenCol = -1;
    for (; j <= line; j++) {
      const from = j === i ? startCol : 0;
      const k = s.code[j].slice(from).search(/\bTHEN\b/i);
      if (k >= 0) {
        thenCol = from + k;
        break;
      }
    }
    if (thenCol < 0) return { error: 'Its IF has no THEN before it' };
    const parts: string[] = [];
    for (let k = i; k <= j; k++) {
      const text = s.lines[k].slice(k === i ? startCol : 0, k === j ? thenCol : undefined);
      parts.push(text.replace(/\/\/.*$/, '').replace(/\(\*[\s\S]*?\*\)/g, ' ').trim());
    }
    return { first: i, last: j, keyword: kw[2].toUpperCase() as 'IF' | 'ELSIF', condition: parts.filter(Boolean).join(' ') };
  };
  // On the assignment's line: "IF x THEN machineState := A;"
  if (/^\s*(IF|ELSIF)\b/i.test(s.code[line]) && s.code[line].slice(0, col).search(/\bTHEN\b/i) >= 0) return head(line);
  let depth = 0;
  const top = s.method === 'doState' ? s.start : 0;
  for (let i = line - 1; i >= top; i--) {
    const c = s.code[i];
    const opens = count(c, /\b(IF|CASE|FOR|WHILE|REPEAT)\b/gi);
    const closes = count(c, /\bEND_(IF|CASE|FOR|WHILE|REPEAT)\b/gi);
    // (a whole IF ... END_IF on one line is no enclosing block)
    if (closes > 0 && opens >= closes) continue;
    if (closes > opens) {
      depth += closes - opens;
      continue;
    }
    if (depth === 0 && /^\s*ELSE\b/i.test(c) && !/^\s*ELSE\s*IF\b/i.test(c)) return { error: 'It is in an ELSE: its condition is that the ones above are FALSE. Change it in the Method Editor' };
    if (depth === 0 && /^\s*ELSIF\b/i.test(c)) return head(i);
    if (opens > closes) {
      if (depth > 0) {
        depth -= opens - closes;
        continue;
      }
      if (/^\s*IF\b/i.test(c)) return head(i);
      // In a CASE / FOR / WHILE / REPEAT: no IF of its own
      return null;
    }
  }
  return null;
}

/** A transition's own condition as written (its IF / ELSIF), for editing; '' when it has none */
export function transitionCondition(pouXml: string, edge: EdgeRef, stateVar: string): { method: TransitionMethod; condition: string; line: number } | { error: string } {
  const s = edgeScope(pouXml, edge, stateVar);
  if ('error' in s) return s;
  const index = pick(pouXml, s, edge);
  if (index < 0) return notFound(s.method, edge, stateVar);
  const t = s.items[index];
  const h = conditionHead(s, t.line, t.col);
  if (h && 'error' in h) return h;
  if (!h) return { method: s.method, condition: '', line: t.line + 1 };
  const inner = compositeCondition(h.condition, stateVar);
  return { method: s.method, condition: inner ? inner.condition : h.condition, line: h.first + 1 };
}

/** "machineState >= A AND machineState <= B AND (x)": a composite's exception transition */
function compositeCondition(cond: string, stateVar: string): { prefix: string; condition: string } | null {
  const m = cond.match(new RegExp(`^(${escapeRx(stateVar)}\\s*>=\\s*[\\w.]+\\s+AND\\s+${escapeRx(stateVar)}\\s*<=\\s*[\\w.]+\\s+AND\\s+)\\(([\\s\\S]*)\\)$`, 'i'));
  return m ? { prefix: m[1], condition: m[2].trim() } : null;
}

/**
 * The edge's transition gets another condition: its IF / ELSIF head is rewritten on one line (a composite's
 * exception keeps its state range). Without an IF of its own, the assignment is put in one.
 */
export function setTransitionCondition(pouXml: string, edge: EdgeRef, condition: string, stateVar: string): TransitionEditResult {
  const cond = condition.trim();
  if (!cond) return { error: 'Enter a condition (TRUE for always)' };
  const s = edgeScope(pouXml, edge, stateVar);
  if ('error' in s) return s;
  const index = pick(pouXml, s, edge);
  if (index < 0) return notFound(s.method, edge, stateVar);
  const t = s.items[index];
  const h = conditionHead(s, t.line, t.col);
  if (h && 'error' in h) return h;
  const lines = [...s.lines];
  if (!h) {
    // An assignment of its own: into an IF, indented like it
    const l = lines[t.line];
    const indent = leading(l);
    if (!/^\s*[A-Za-z_][\w.]*\s*:=/.test(s.code[t.line]) || s.code[t.line].replace(/^\s*[^;]*;\s*/, '').trim()) return { error: 'The assignment shares its line with other code: change it in the Method Editor' };
    lines.splice(t.line, 1, `${indent}IF ${cond} THEN`, `${indent}\t${l.trim()}`, `${indent}END_IF`);
    return { method: s.method, code: lines.join(s.eol), message: `${edge.from} → ${edge.to} now has the condition ${cond}`, line: t.line + 1 };
  }
  const composite = compositeCondition(h.condition, stateVar);
  const written = composite ? `${composite.prefix}(${cond})` : cond;
  const firstLine = lines[h.first];
  const kwAt = firstLine.search(/\b(IF|ELSIF)\b/i);
  const lastCode = s.code[h.last];
  const thenAt = lastCode.search(/\bTHEN\b/i);
  const after = lines[h.last].slice(thenAt + 4);
  const head = `${firstLine.slice(0, kwAt)}${h.keyword} ${written} THEN${after}`;
  lines.splice(h.first, h.last - h.first + 1, head);
  const was = composite ? composite.condition : h.condition;
  return { method: s.method, code: lines.join(s.eol), message: `${edge.from} → ${edge.to}: condition ${was} → ${cond}`, line: h.first + 1 };
}
