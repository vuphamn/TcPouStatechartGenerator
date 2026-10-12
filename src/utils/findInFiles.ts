/**
 * Find in Files (Ctrl+Shift+F) in the app's code editors: a text, a whole word or a regular expression found in the
 * POUs' code (their declarations and implementations, never the XML around them), each match with where it is (body,
 * a method, its declaration), its line and column; Replace changes only those matches (a regular expression's $1 …).
 */
import { sections } from './renameVariable.ts';

export interface FindOptions {
  query: string;
  matchCase?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}
export interface FindMatch {
  where: string;
  unit: string;
  part: 'declaration' | 'implementation';
  /** 1-based in that part */
  line: number;
  /** 0-based */
  column: number;
  length: number;
  /** The line's text (trimmed at its start: column counted from there) */
  text: string;
  /** Where the match starts in text */
  at: number;
}

/** The search as a global RegExp, or { error } (an invalid regular expression, nothing to find) */
export function findMatcher(o: FindOptions): RegExp | { error: string } {
  if (!o.query) return { error: 'Nothing to find' };
  let src = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (o.wholeWord) src = `(?<![\\w])(?:${src})(?![\\w])`;
  try {
    const rx = new RegExp(src, `g${o.matchCase ? '' : 'i'}`);
    if (rx.test('')) return { error: 'The expression matches nothing (an empty match): make it longer' };
    rx.lastIndex = 0;
    return rx;
  } catch (e) {
    return { error: `Not a regular expression: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The matches in a POU's (or a DUT's, a GVL's) code */
export function searchCode(xml: string, rx: RegExp): FindMatch[] {
  const out: FindMatch[] = [];
  for (const s of sections(xml)) {
    const text = xml.slice(s.start, s.end);
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    const r = new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : `${rx.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = r.exec(text))) {
      if (!m[0].length) {
        r.lastIndex++;
        continue;
      }
      let line = 0;
      while (line + 1 < starts.length && starts[line + 1] <= m.index) line++;
      const raw = text.slice(starts[line], line + 1 < starts.length ? starts[line + 1] - 1 : text.length).replace(/\r$/, '');
      const lead = raw.length - raw.trimStart().length;
      const column = m.index - starts[line];
      out.push({ where: s.where, unit: s.unit, part: s.kind === 'ST' ? 'implementation' : 'declaration', line: line + 1, column, length: m[0].length, text: raw.trim(), at: Math.max(0, column - lead) });
    }
  }
  return out;
}

/** Every match in the code replaced (a regular expression's groups: $1 …) → the new XML and how many */
export function replaceInCode(xml: string, rx: RegExp, replacement: string): { xml: string; count: number } {
  let count = 0;
  let out = xml;
  // (from the end: the earlier sections' offsets stay)
  for (const s of [...sections(xml)].reverse()) {
    const text = out.slice(s.start, s.end);
    const r = new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : `${rx.flags}g`);
    let here = 0;
    const next = text.replace(r, (...args) => {
      if (!String(args[0]).length) return String(args[0]);
      here++;
      // (the groups of a regular expression; a plain replacement's $ kept as typed)
      return String(args[0]).replace(new RegExp(r.source, r.flags.replace('g', '')), replacement);
    });
    // (a CDATA section cannot hold "]]>")
    if (next.includes(']]>')) continue;
    count += here;
    out = out.slice(0, s.start) + next + out.slice(s.end);
  }
  return { xml: out, count };
}

/** The word to look for in the project's other POUs (the hosts find files by a word): the query's longest name */
export function projectWordOf(o: FindOptions): string | null {
  const words = (o.regex ? o.query.replace(/\\./g, ' ') : o.query).match(/[A-Za-z_]\w{2,}/g) ?? [];
  // (the longest; of two as long, the later: inst.member's member)
  return words.reduce<string | null>((best, w) => (!best || w.length >= best.length ? w : best), null);
}
