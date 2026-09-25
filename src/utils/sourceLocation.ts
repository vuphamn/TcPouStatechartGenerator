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
export function methodLines(pouXml: string, method: string): string[] | null {
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

/** The CASE branch of a state in doState() */
export function locateState(pouXml: string, stateId: string): SourceLocation | null {
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
  const fromPreProcess = /^\[preProcess\]/i.test(guard);
  const method = fromPreProcess ? 'preProcess' : 'doState';
  const lines = methodLines(pouXml, method);
  if (!lines) return null;
  const variable = caseVariable(methodLines(pouXml, 'doState') ?? lines);
  const varRx = variable ? escapeRx(variable) : '[A-Za-z_][\\w.]*';
  const assignRx = new RegExp(`\\b${varRx}\\s*:=\\s*(?:[A-Za-z_]\\w*\\.)?${escapeRx(edge.to)}\\b`);

  // Search range: the source state's branch in doState(); all of preProcess()
  let start = 0;
  let end = lines.length;
  if (!fromPreProcess) {
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

  const guardKey = squash(guard.replace(/^\[preProcess\]\s*/i, '')).slice(0, 40);
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
