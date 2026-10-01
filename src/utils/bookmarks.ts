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
  /** A bookmark's name (note), by its key (an entry's key) */
  notes?: Record<string, string>;
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
    if (raw && Array.isArray(raw.states) && Array.isArray(raw.lines)) value = { states: raw.states.filter((s: unknown) => typeof s === 'string'), lines: raw.lines.filter((l: LineBookmark) => l && typeof l.method === 'string' && typeof l.line === 'number'), notes: raw.notes && typeof raw.notes === 'object' ? (Object.fromEntries(Object.entries(raw.notes).filter(([, v]) => typeof v === 'string')) as Record<string, string>) : undefined };
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
    if (!next.states.length && !next.lines.length && !Object.keys(next.notes ?? {}).length) localStorage.removeItem(key);
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

/** The enum member a line of the enum's declaration declares (1-based), or null (a comment, a pragma, TYPE …) */
export function enumMemberOnLine(code: string, line: number): string | null {
  const text = (code.split(/\r?\n/)[line - 1] ?? '').replace(/\(\*.*?\*\)/g, '').replace(/\/\/.*$/, '');
  const m = text.match(/^\s*,?\s*([A-Za-z_]\w*)\s*(?::=|,|\)|$)/);
  return m && !/^(TYPE|END_TYPE|STRUCT|END_STRUCT|UNION|END_UNION)$/i.test(m[1]) ? m[1] : null;
}

/**
 * The enum's bookmarked lines: its own line bookmarks and the member lines of the bookmarked states (a state's
 * bookmark is one: Identified States, the canvas, the Method Editor's CASE label, the Enum Editor's member)
 */
export function enumBookmarkedLines(pou: string, code: string): number[] {
  const set = new Set(bookmarkedLines(pou, ENUM_KEY, code));
  const states = new Set(getBookmarks(pou).states);
  if (states.size) code.split(/\r?\n/).forEach((_, i) => {
    const m = enumMemberOnLine(code, i + 1);
    if (m && states.has(m)) set.add(i + 1);
  });
  return [...set].sort((a, c) => a - c);
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
  /** Its key (its name is kept under it), and its name if given */
  key: string;
  note?: string;
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
    out.push({ kind: 'state', key: `state:${s}`, note: b.notes?.[`state:${s}`], state: s, method: 'doState', line: i + 1, text: (raw[i] ?? s).trim() });
  }
  const methods = [...new Set(b.lines.map((l) => l.method))];
  for (const m of methods) {
    const code = codeOf(m);
    if (code === null) continue;
    for (const r of resolveLines(b, m, code)) {
      const key = `line:${m}:${r.bookmark.text}`;
      out.push({ kind: 'line', key, note: b.notes?.[key], method: m, line: r.line, text: (code.split(/\r?\n/)[r.line - 1] ?? r.bookmark.text).trim() });
    }
  }
  return out;
}

/** The POU's bookmarks as a file to share (Export in the Bookmarks list): kss-bookmarks, version 1 */
export function exportBookmarks(pou: string): string {
  const b = getBookmarks(pou);
  return JSON.stringify({ format: 'kss-bookmarks', version: 1, pou: (pou || 'POU').replace(/\.TcPOU$/i, ''), states: b.states, lines: b.lines, notes: b.notes ?? {} }, null, 1);
}

/**
 * A bookmarks file (Export's) put in with the POU's own: its states and lines added (the same ones once), its names
 * taken (over the ones here). { added } or { error }
 */
export function importBookmarks(pou: string, text: string): { added: number; error?: undefined } | { error: string; added?: undefined } {
  let raw: { format?: string; states?: unknown; lines?: unknown; notes?: unknown };
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'Not a bookmarks file (not JSON)' };
  }
  if (raw?.format !== 'kss-bookmarks' || !Array.isArray(raw.states) || !Array.isArray(raw.lines)) return { error: 'Not a bookmarks file (Export in the Bookmarks list writes one)' };
  const b = getBookmarks(pou);
  const states = [...b.states];
  const lines = [...b.lines];
  let added = 0;
  for (const s of raw.states) if (typeof s === 'string' && /^[A-Za-z_]\w*$/.test(s) && !states.includes(s)) {
    states.push(s);
    added++;
  }
  for (const l of raw.lines as LineBookmark[]) {
    if (!l || typeof l.method !== 'string' || typeof l.line !== 'number' || typeof l.text !== 'string') continue;
    if (lines.some((x) => sameMethod(x.method, l.method) && x.text === l.text)) continue;
    lines.push({ method: l.method, line: l.line, text: l.text });
    added++;
  }
  const notes = { ...(b.notes ?? {}) };
  if (raw.notes && typeof raw.notes === 'object') for (const [k, v] of Object.entries(raw.notes as Record<string, unknown>)) if (typeof v === 'string' && v.trim()) notes[k] = v.trim();
  setBookmarks(pou, { states, lines, notes });
  return { added };
}

/** A bookmark named (its note; empty: its name taken off) */
export function setBookmarkNote(pou: string, key: string, note: string): void {
  const b = getBookmarks(pou);
  const notes = { ...(b.notes ?? {}) };
  if (note.trim()) notes[key] = note.trim();
  else delete notes[key];
  setBookmarks(pou, { ...b, notes });
}
