import { resolveStateMethod } from './stateMethod.ts';
/**
 * Where a state or a transition is written in the .TcPOU: the method (doState / preProcess) and the 1-based line in
 * that method's ST implementation. Used to open TwinCAT's editor at that line (XAE extension).
 */

export interface SourceLocation {
  method: string;
  line: number;
  /** The source line, for messages */
  text: string;
}

export const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The ST implementation (CDATA text) of a method, split into lines */
export function methodLines(pouXml: string, methodAsked: string): string[] | null {
  const method = resolveStateMethod(pouXml, methodAsked);
  const rx = new RegExp(`<Method[^>]*\\bName=["']${escapeRx(method)}["'][^>]*>([\\s\\S]*?)</Method>`, 'i');
  const m = pouXml.match(rx);
  if (!m) return null;
  const st = m[1].match(/<ST[^>]*>([\s\S]*?)<\/ST>/i);
  if (!st) return null;
  const cdata = st[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
  const text = cdata ? cdata[1] : st[1];
  return text.replace(/\r\n/g, '\n').split('\n');
}

/** A CASE label line: identifiers / qualified names separated by commas (or ranges), then ':' that is not ':=' */
export const LABEL_RX = /^\s*((?:[A-Za-z_][\w.]*|\d+)(?:\s*(?:,|\.\.)\s*(?:[A-Za-z_][\w.]*|\d+))*)\s*:(?!=)/;

export function labelNames(line: string): string[] {
  const m = line.match(LABEL_RX);
  if (!m) return [];
  return m[1].split(/\s*(?:,|\.\.)\s*/).map((n) => n.split('.').pop() || n);
}

/** Code before a comment starts ((* *) and // comments are ignored when matching) */
const stripComment = (line: string) => line.replace(/\(\*.*?\*\)/g, '').replace(/\/\/.*$/, '');

export function caseVariable(lines: string[]): string | null {
  for (const l of lines) {
    const m = stripComment(l).match(/\bCASE\b\s*\(?\s*([A-Za-z_][\w.]*)\s*\)?\s*\bOF\b/i);
    if (m) return m[1];
  }
  return null;
}

/**
 * A sub-machine's state (a method's state machine drawn inside the state that calls it: its id <state>__<method>__<name>):
 * its method and name, when the POU has that method; else null
 */
export function subMachineId(pouXml: string, id: string): { parent: string; method: string; name: string } | null {
  const parts = id.split('__');
  // (the innermost: a nested sub-machine's parent is a sub-machine's state, <state>__<method>__<name>)
  for (let i = parts.length - 2; i >= 1; i--) {
    if (methodLines(pouXml, parts[i])) return { parent: parts.slice(0, i).join('__'), method: parts[i], name: parts.slice(i + 1).join('__') };
  }
  return null;
}

/** A label's line in a method's CASE (after its CASE line), 0-based; -1 when not there */
function labelLineIn(lines: string[], name: string, from = 0): number {
  for (let i = from; i < lines.length; i++) if (labelNames(stripComment(lines[i])).includes(name)) return i;
  return -1;
}
const caseLineIn = (lines: string[]) => lines.findIndex((l) => /\bCASE\b\s*\(?\s*[A-Za-z_][\w.]*\s*\)?\s*\bOF\b/i.test(stripComment(l)));

/** The CASE branch of a state in doState() */
export function locateState(pouXml: string, stateId: string): SourceLocation | null {
  // (a sub-machine's state: its label in its method's CASE)
  const sub = subMachineId(pouXml, stateId);
  if (sub) {
    const sl = methodLines(pouXml, sub.method)!;
    const at = labelLineIn(sl, sub.name, Math.max(0, caseLineIn(sl)));
    return at < 0 ? null : { method: sub.method, line: at + 1, text: sl[at].trim() };
  }
  const lines = methodLines(pouXml, 'doState');
  if (!lines) return null;
  for (let i = 0; i < lines.length; i++) {
    if (labelNames(stripComment(lines[i])).includes(stateId)) return { method: 'doState', line: i + 1, text: lines[i].trim() };
  }
  return null;
}

const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/**
 * The assignment that makes a transition: "<stateVar> := <to>" inside the source state's branch of doState(), or in
 * preProcess() for guards shown as "[preProcess] ...". With several candidates, the one whose preceding lines contain
 * the guard wins.
 */
export function locateTransition(
  pouXml: string,
  edge: { from: string; to: string; condition?: string; label?: string }
): SourceLocation | null {
  const guard = (edge.condition || edge.label || '').replace(/<br\s*\/?>/gi, ' ').trim();
  // A sub-machine's transition: in its method; its entry ([*] to its first state): where its start is set, before its CASE
  const subTo = subMachineId(pouXml, edge.to);
  // (its label without its priority: "② cmd_bTestStart")
  if (subTo) return locateSubTransition(pouXml, subTo.method, subMachineId(pouXml, edge.from)?.name ?? null, subTo.name, guard.replace(/^(?:[①-⑳]|\[\d+\]|\(\d+\))\s*/, ''));
  // (set in a method outside the CASE, another company's Reset(): "[Reset()] …", from any state)
  const entryMethod = /^\[([A-Za-z_]\w*)\(\)\]/.exec(guard)?.[1] ?? null;
  const fromPreProcess = !entryMethod && (/^\[preProcess\]/i.test(guard) || edge.from === 'AnyState');
  const method = entryMethod ?? (fromPreProcess ? 'preProcess' : 'doState');
  const lines = methodLines(pouXml, method);
  if (!lines) return null;
  const variable = caseVariable(methodLines(pouXml, 'doState') ?? lines);
  const varRx = variable ? escapeRx(variable) : '[A-Za-z_][\\w.]*';
  const assignRx = new RegExp(`\\b${varRx}\\s*:=\\s*(?:[A-Za-z_]\\w*\\.)?${escapeRx(edge.to)}\\b`);

  // Search range: the source state's branch in doState(); all of preProcess()
  let start = 0;
  let end = lines.length;
  if (!fromPreProcess && !entryMethod) {
    const label = locateState(pouXml, edge.from);
    if (!label) return null;
    start = label.line - 1;
    for (let i = start + 1; i < lines.length; i++) {
      const code = stripComment(lines[i]);
      if (/^\s*END_CASE\b/i.test(code) || labelNames(code).length > 0) {
        end = i;
        break;
      }
    }
  }

  const guardKey = squash(guard.replace(/^\[(?:preProcess|[A-Za-z_]\w*\(\))\]\s*/i, '')).slice(0, 40);
  let best: SourceLocation | null = null;
  let bestScore = -1;
  for (let i = start; i < end; i++) {
    if (!assignRx.test(stripComment(lines[i]))) continue;
    // Score: guard text in this or the 6 lines before, and (preProcess) the source state mentioned nearby
    const context = squash(lines.slice(Math.max(start, i - 6), i + 1).join(' '));
    let score = 0;
    if (guardKey && context.includes(guardKey)) score += 2;
    if (fromPreProcess && context.includes(squash(edge.from))) score += 1;
    if (score > bestScore) {
      best = { method, line: i + 1, text: lines[i].trim() };
      bestScore = score;
    }
  }
  return best;
}

/** A sub-machine's transition in its method: "<variable> := <to>" in <from>'s branch of its CASE (no from: its entry) */
function locateSubTransition(pouXml: string, method: string, from: string | null, to: string, guard: string): SourceLocation | null {
  const lines = methodLines(pouXml, method);
  if (!lines) return null;
  const caseAt = caseLineIn(lines);
  const variable = caseVariable(lines);
  if (caseAt < 0 || !variable) return null;
  const assignRx = new RegExp(`\\b${escapeRx(variable)}\\s*:=\\s*(?:[A-Za-z_]\\w*\\.)?${escapeRx(to)}\\b`);
  let start = 0;
  let end = caseAt;
  if (from) {
    start = labelLineIn(lines, from, caseAt + 1);
    if (start < 0) return null;
    end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      const code = stripComment(lines[i]);
      if (/^\s*END_CASE\b/i.test(code) || labelNames(code).length > 0) {
        end = i;
        break;
      }
    }
  }
  const guardKey = squash(guard).slice(0, 40);
  let best: SourceLocation | null = null;
  let bestScore = -1;
  for (let i = start; i < end; i++) {
    if (!assignRx.test(stripComment(lines[i]))) continue;
    const score = guardKey && squash(lines.slice(Math.max(start, i - 6), i + 1).join(' ')).includes(guardKey) ? 2 : 0;
    if (score > bestScore) {
      best = { method, line: i + 1, text: lines[i].trim() };
      bestScore = score;
    }
  }
  // (an entry whose start is not set before the CASE: the CASE itself)
  return best ?? (from ? null : { method, line: caseAt + 1, text: lines[caseAt].trim() });
}
