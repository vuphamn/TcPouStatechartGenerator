/**
 * The state the caret is in, in the Method Editor (the CASE branch of doState() around it) or the Enum Editor (the
 * member on its line): the other editor and Identified States always show it; the Diagram Canvas selects it and pans
 * to it only when the editor's Follow is on
 */
import { useCallback, useState } from 'react';

export const CODE_FOCUS_EVENT = 'kss-code-focus';

export interface CodeFocus {
  state: string;
  from: 'method' | 'enum';
  /** The editor's Follow: the canvas too */
  follow: boolean;
  /** When (each one new, the same state again too) */
  t: number;
}

export const publishCodeFocus = (focus: Omit<CodeFocus, 't'>) => window.dispatchEvent(new CustomEvent(CODE_FOCUS_EVENT, { detail: { ...focus, t: Date.now() } }));

/** An on / off kept in this browser */
export function usePersistedFlag(key: string, fallback: boolean): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v === '1';
    } catch {
      return fallback;
    }
  });
  const set = useCallback(
    (next: boolean) => {
      setOn(next);
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        // (this session only)
      }
    },
    [key]
  );
  return [on, set];
}

const stripComments = (l: string) => l.replace(/\(\*.*?\*\)/g, '').replace(/\/\/.*$/, '');
const LABEL_RX = /^\s*((?:[A-Za-z_][\w.]*\s*,\s*)*[A-Za-z_][\w.]*)\s*:(?!=)/;

/** The state whose CASE label is at or above the caret (text: doState()'s code; states: its CASE labels' names) */
export function caseStateAt(text: string, caret: number, states: Set<string>): string | null {
  const lines = text.slice(0, caret).split('\n');
  // (the caret's line counts from its start: a click on the label itself)
  lines[lines.length - 1] = text.split('\n')[lines.length - 1] ?? lines[lines.length - 1];
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = stripComments(lines[i]).match(LABEL_RX);
    if (!m) continue;
    const names = m[1].split(',').map((n) => n.trim().split('.').pop() ?? '');
    const hit = names.find((n) => states.has(n));
    if (hit) return hit;
  }
  return null;
}

const NOT_MEMBERS = new Set(['TYPE', 'END_TYPE', 'STRUCT', 'END_STRUCT', 'UNION', 'END_UNION']);
/** The enum member on the caret's line (text: the enum's declaration), or null */
export function enumMemberAt(text: string, caret: number): string | null {
  const start = text.lastIndexOf('\n', caret - 1) + 1;
  const endAt = text.indexOf('\n', caret);
  const line = stripComments(text.slice(start, endAt < 0 ? text.length : endAt));
  const m = line.match(/^\s*,?\s*([A-Za-z_]\w*)\s*(?::=|,|\)|$)/);
  if (!m || NOT_MEMBERS.has(m[1].toUpperCase())) return null;
  return m[1];
}
