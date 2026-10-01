import { useEffect, useRef, useState } from 'react';

/**
 * Edits an editor keeps until its own Save (Ctrl+S in it): the Method Editor, the POU Editor, the Enum Editor, a
 * state's code. They register here, so the header's Save (the editor used last) and Save All (every one) can put
 * them into the POU before the files are written. The editor used last: the one that had the focus last
 * (its root carries data-save-scope with its id).
 */

/** A part of an editor's edits, as the Diff shows it (its text in the POU, in the editor; apply: the editor's text set) */
export interface PendingPart {
  name: string;
  before: string;
  after: string;
  apply?: (after: string) => void;
}

interface PendingSave {
  label: string;
  dirty: () => boolean;
  save: () => void;
  parts?: () => PendingPart[];
}

const entries = new Map<string, PendingSave>();
let lastActive: string | null = null;
const EVENT = 'kss-pending-saves';
const changed = () => window.dispatchEvent(new CustomEvent(EVENT));

if (typeof window !== 'undefined') {
  window.addEventListener('focusin', (e) => {
    const scope = (e.target as HTMLElement | null)?.closest?.('[data-save-scope]')?.getAttribute('data-save-scope');
    if (scope && scope !== lastActive) {
      lastActive = scope;
      changed();
    }
  });
}

/**
 * An editor's edits kept until its Save: registered while it is shown (dirty: whether it has any now; parts: its
 * edits as the Diff shows them, for the header's All changes)
 */
export function usePendingSave(id: string, label: string, dirty: boolean, save: () => void, parts?: () => PendingPart[]): void {
  const ref = useRef({ label, dirty, save, parts });
  ref.current = { label, dirty, save, parts };
  useEffect(() => {
    entries.set(id, { get label() { return ref.current.label; }, dirty: () => ref.current.dirty, save: () => ref.current.save(), parts: () => ref.current.parts?.() ?? [] });
    changed();
    return () => {
      entries.delete(id);
      if (lastActive === id) lastActive = null;
      changed();
    };
  }, [id]);
  useEffect(() => {
    changed();
  }, [dirty, label]);
}

/** The editors with edits not yet in the POU, the one used last first */
export function pendingEditors(): { id: string; label: string; active: boolean }[] {
  const list = [...entries].filter(([, e]) => e.dirty()).map(([id, e]) => ({ id, label: e.label, active: id === lastActive }));
  return list.sort((a, b) => Number(b.active) - Number(a.active));
}

/** The edits of the editors that have some, by editor (their parts as the Diff shows them) */
export function pendingParts(): { label: string; parts: PendingPart[] }[] {
  return pendingEditors().map((e) => ({ label: e.label, parts: entries.get(e.id)?.parts?.() ?? [] }));
}

/** An editor's parts (as the Diff shows them) by its id, edits or not; [] when it is not shown */
export function editorParts(id: string): PendingPart[] {
  return entries.get(id)?.parts?.() ?? [];
}

/** Their edits put into the POU (the editor used last only, or all); how many */
export function savePendingEditors(which: 'active' | 'all'): number {
  const list = pendingEditors().filter((e) => which === 'all' || e.active);
  for (const e of list) entries.get(e.id)?.save();
  return list.length;
}

/** Re-renders when an editor's edits come or go */
export function usePendingEditors(): { id: string; label: string; active: boolean }[] {
  const [, setN] = useState(0);
  useEffect(() => {
    const on = () => setN((n) => n + 1);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return pendingEditors();
}
