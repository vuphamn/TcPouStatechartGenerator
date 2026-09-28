import { useEffect, useRef, useState } from 'react';

/**
 * Edits an editor keeps until its own Save (Ctrl+S in it): the Method Editor, the POU Editor, the Enum Editor, a
 * state's code. They register here, so the header's Save (the editor used last) and Save All (every one) can put
 * them into the POU before the files are written. The editor used last: the one that had the focus last
 * (its root carries data-save-scope with its id).
 */

interface PendingSave {
  label: string;
  dirty: () => boolean;
  save: () => void;
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

/** An editor's edits kept until its Save: registered while it is shown (dirty: whether it has any now) */
export function usePendingSave(id: string, label: string, dirty: boolean, save: () => void): void {
  const ref = useRef({ label, dirty, save });
  ref.current = { label, dirty, save };
  useEffect(() => {
    entries.set(id, { get label() { return ref.current.label; }, dirty: () => ref.current.dirty, save: () => ref.current.save() });
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
