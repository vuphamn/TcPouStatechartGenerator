/**
 * Bookmarks, as TwinCAT's PLC Bookmarks: on states (the canvas and Identified States show a badge; the Method
 * Editor marks the state's CASE label line) and on lines of a method's implementation. Kept per POU in this
 * browser. A line bookmark remembers its line's text, so it is found again when lines above it change.
 */
import { useEffect, useState } from 'react';
import { labelNames } from './sourceLocation.ts';
import { blankComments } from './stateMachineLint.ts';

export interface LineBookmark {
  method: string;
  /** 1-based line of the implementation when it was set */
  line: number;
  /** That line's text (trimmed) */
  text: string;
}

export interface PouBookmarks {
  states: string[];
  lines: LineBookmark[];
}

const EMPTY: PouBookmarks = { states: [], lines: [] };
const keyOf = (pou: string) => `kss.bookmarks.${(pou || 'POU').replace(/\.TcPOU$/i, '')}`;
const cache = new Map<string, PouBookmarks>();
const listeners = new Set<() => void>();

export function getBookmarks(pou: string): PouBookmarks {
  const key = keyOf(pou);
  const hit = cache.get(key);
  if (hit) return hit;
  let value = EMPTY;
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (raw && Array.isArray(raw.states) && Array.isArray(raw.lines)) value = { states: raw.states.filter((s: unknown) => typeof s === 'string'), lines: raw.lines.filter((l: LineBookmark) => l && typeof l.method === 'string' && typeof l.line === 'number') };
  } catch {
    // (none kept)
  }
  cache.set(key, value);
  return value;
}

function setBookmarks(pou: string, next: PouBookmarks): void {
  const key = keyOf(pou);
  cache.set(key, next);
  try {
    if (!next.states.length && !next.lines.length) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // (not kept: still shown in this session)
  }
  listeners.forEach((l) => l());
}

export function toggleStateBookmark(pou: string, state: string): boolean {
  const b = getBookmarks(pou);
  const on = !b.states.includes(state);
  setBookmarks(pou, { ...b, states: on ? [...b.states, state] : b.states.filter((s) => s !== state) });
  return on;
}

const sameMethod = (a: string, b: string) => a.replace(/\(\)$/, '').toLowerCase() === b.replace(/\(\)$/, '').toLowerCase();

/**
 * A line of a method's implementation bookmarked or not (a CASE label line: its state's bookmark). opts.labels false:
 * the line as it is (a declaration's "nCount : INT;" is no CASE label)
 */
export function toggleLineBookmark(pou: string, method: string, code: string, line: number, opts: { labels?: boolean } = {}): { on: boolean; state?: string } {
  const lines = code.split(/\r?\n/);
  const state = opts.labels === false ? undefined : labelStateAt(code, line);
  if (state) return { on: toggleStateBookmark(pou, state), state };
  const b = getBookmarks(pou);
  const at = resolveLines(b, method, code);
  const existing = at.find((x) => x.line === line);
  if (existing) {
    setBookmarks(pou, { ...b, lines: b.lines.filter((x) => x !== existing.bookmark) });
    return { on: false };
  }
  setBookmarks(pou, { ...b, lines: [...b.lines, { method: method.replace(/\(\)$/, ''), line, text: (lines[line - 1] ?? '').trim() }] });
  return { on: true };
}

/** The state whose CASE label is on this line (1-based), if any */
export function labelStateAt(code: string, line: number): string | undefined {
  const blanked = blankComments(code).split(/\r?\n/);
  const text = blanked[line - 1] ?? '';
  const names = labelNames(text).filter((n) => /^[A-Za-z_]\w*$/.test(n) && !/^(ELSE|END_CASE)$/i.test(n));
  return names[0];
}

/** Where a method's line bookmarks are now: the line with their text nearest to where they were */
function resolveLines(b: PouBookmarks, method: string, code: string): { line: number; bookmark: LineBookmark }[] {
  const lines = code.split(/\r?\n/).map((l) => l.trim());
  const out: { line: number; bookmark: LineBookmark }[] = [];
  for (const bm of b.lines) {
    if (!sameMethod(bm.method, method)) continue;
    let best = -1;
    lines.forEach((l, i) => {
      if (bm.text && l === bm.text && (best < 0 || Math.abs(i + 1 - bm.line) < Math.abs(best - bm.line))) best = i + 1;
    });
    if (best < 0) best = Math.min(Math.max(1, bm.line), lines.length);
    out.push({ line: best, bookmark: bm });
  }
  return out;
}

/** The bookmarked lines of a method's implementation (1-based, in order): its line bookmarks and the label lines of bookmarked states */
export function bookmarkedLines(pou: string, method: string, code: string): number[] {
  const b = getBookmarks(pou);
  const set = new Set(resolveLines(b, method, code).map((x) => x.line));
  if (b.states.length) {
    const states = new Set(b.states);
    blankComments(code).split(/\r?\n/).forEach((l, i) => {
      if (labelNames(l).some((n) => states.has(n))) set.add(i + 1);
    });
  }
  return [...set].sort((a, c) => a - c);
}

/** Clear a method's line bookmarks (and the states whose label lines it has), or all of the POU's */
export function clearBookmarks(pou: string, method?: string, code?: string): void {
  const b = getBookmarks(pou);
  if (!method) return setBookmarks(pou, EMPTY);
  const labels = new Set<string>();
  if (code) blankComments(code).split(/\r?\n/).forEach((l) => labelNames(l).forEach((n) => labels.add(n)));
  setBookmarks(pou, { states: b.states.filter((s) => !labels.has(s)), lines: b.lines.filter((l) => !sameMethod(l.method, method)) });
}

/** The POU's bookmarks, re-read when they change (in any view) */
export function useBookmarks(pou: string): PouBookmarks {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const l = () => setVersion((v) => v + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return getBookmarks(pou);
}

/** The POU's own body (the POU Editor's implementation), as a "method" of the line bookmarks */
export const BODY = '(body)';
/** A declaration's bookmarks: a method's, the POU's (BODY) */
export const declarationKey = (method: string) => `${method.replace(/\(\)$/, '')}#declaration`;
export const isDeclarationKey = (key: string) => key.endsWith('#declaration');
export const declarationOf = (key: string) => key.replace(/#declaration$/, '');
/** The enum's bookmarks (its declaration, in the Enum Editor) */
export const ENUM_KEY = '(enum)';

export interface BookmarkEntry {
  kind: 'state' | 'line';
  state?: string;
  /** The method (BODY: the POU's body) */
  method: string;
  /** 1-based line of the implementation, now */
  line: number;
  text: string;
}

/** Every bookmark of the POU, where it is now: the states (at their CASE label in doState()) and the lines */
export function listBookmarks(pou: string, codeOf: (method: string) => string | null): BookmarkEntry[] {
  const b = getBookmarks(pou);
  const out: BookmarkEntry[] = [];
  const doState = codeOf('doState') ?? '';
  const labels = blankComments(doState).split(/\r?\n/);
  const raw = doState.split(/\r?\n/);
  for (const s of b.states) {
    const i = labels.findIndex((l) => labelNames(l).includes(s));
    out.push({ kind: 'state', state: s, method: 'doState', line: i + 1, text: (raw[i] ?? s).trim() });
  }
  const methods = [...new Set(b.lines.map((l) => l.method))];
  for (const m of methods) {
    const code = codeOf(m);
    if (code === null) continue;
    for (const r of resolveLines(b, m, code)) out.push({ kind: 'line', method: m, line: r.line, text: (code.split(/\r?\n/)[r.line - 1] ?? r.bookmark.text).trim() });
  }
  return out;
}
