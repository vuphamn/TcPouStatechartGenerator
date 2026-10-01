import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, GitCompare, Pencil, Redo2, Undo2, X } from 'lucide-react';
import { diffChanges, diffCounts, diffHunkIndices, diffLines, undoChange, type DiffChange, type DiffRow } from '../utils/textDiff.ts';
import { useEditorZoom } from '../hooks/useEditorZoom.ts';

/** Asks an editor to show its changes ({ editor: 'method' | 'pou' | 'enum' }): the "*" on its tab */
export const SHOW_EDITOR_DIFF_EVENT = 'kss-show-editor-diff';
export const showEditorDiff = (editor: 'method' | 'pou' | 'enum') => window.dispatchEvent(new CustomEvent(SHOW_EDITOR_DIFF_EVENT, { detail: { editor } }));
/**
 * Asks the app for a file's changes since it was saved ({ file: 'pou' | 'enum' }): an editor's Diff with no edits of
 * its own (the canvas' edits, an editor's saved into the POU)
 */
export const SHOW_FILE_DIFF_EVENT = 'kss-show-file-diff';
export const showFileDiff = (file: 'pou' | 'enum') => window.dispatchEvent(new CustomEvent(SHOW_FILE_DIFF_EVENT, { detail: { file } }));

// Which files changed since they were saved (set by the app): an editor's Diff is enabled for its own edits or these
let fileChanged = { pou: false, enum: false };
const fileListeners = new Set<() => void>();
export function setFilesChanged(next: { pou: boolean; enum: boolean }) {
  if (next.pou === fileChanged.pou && next.enum === fileChanged.enum) return;
  fileChanged = next;
  fileListeners.forEach((l) => l());
}
/** Has the file changed since it was saved (re-rendered when that changes) */
export function useFileChanged(file: 'pou' | 'enum'): boolean {
  return useSyncExternalStore(
    (l) => {
      fileListeners.add(l);
      return () => fileListeners.delete(l);
    },
    () => fileChanged[file]
  );
}

/**
 * A part compared: its name ("Declaration", "Implementation") and its text before and after; apply: the after text
 * replaced (a change undone or redone; without it the part is read-only)
 */
export interface DiffPart {
  name: string;
  before: string;
  after: string;
  apply?: (after: string) => void;
}

/** A change of a part, in the order shown */
interface ShownChange {
  part: number;
  change: DiffChange;
}

/**
 * The changes of an editor (its text against what is in the POU / the enum) or of a file (against its saved version),
 * as a unified diff: the lines taken out in red, put in in green, a few lines around them; Esc closes. Its toolbar (and
 * a change's right-click menu): First / Last change (Alt+Home / Alt+End), Previous / Next change (Shift+F8 / F8,
 * Alt+↑ / Alt+↓), Undo change (its lines as
 * before) and Redo change (put back in). A line of the text after is edited in place: a double-click, F2 or Edit this
 * line (Enter puts it in, Shift+Enter a new line, Esc drops it). Its text size is the code editors' (Ctrl+wheel, Ctrl+= / Ctrl+-, Ctrl+0: 100%)
 */
export const DiffDialog: React.FC<{
  title: string;
  beforeLabel: string;
  afterLabel: string;
  /** The parts, or how to get them (read again after each change made here: the header's All changes) */
  parts: DiffPart[] | (() => DiffPart[]);
  onClose: () => void;
}> = ({ title, beforeLabel, afterLabel, parts: partsIn, onClose }) => {
  const [tick, setTick] = useState(0);
  const parts = typeof partsIn === 'function' ? partsIn() : partsIn;
  const key = parts.map((p) => `${p.name}\u0000${p.before.length}:${p.after.length}:${p.after}`).join('\u0001');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = useMemo(() => parts.map((p) => ({ ...p, rows: diffLines(p.before, p.after) })), [key, tick]);
  // (a change applied: the parts read again once the editor has it)
  const applied = () => window.setTimeout(() => setTick((t) => t + 1), 30);
  const changes = useMemo<ShownChange[]>(() => shown.flatMap((p, part) => diffChanges(p.rows).map((change) => ({ part, change }))), [shown]);
  const [cur, setCur] = useState(0);
  const at = changes.length ? Math.min(cur, changes.length - 1) : -1;
  // The changes undone, latest last: Redo change puts them back (while their part is still as the undo left it)
  const [undone, setUndone] = useState<{ part: string; text: string; left: string }[]>([]);
  // The lines shown around the changes: 3, 10, or the whole code (kept in this browser; the whole code by default)
  const [context, setContextState] = useState<'3' | '10' | 'all'>(() => {
    try {
      const v = localStorage.getItem('kss.diff.context');
      return v === '3' || v === '10' || v === 'all' ? v : 'all';
    } catch {
      return 'all';
    }
  });
  const setContext = (v: '3' | '10' | 'all') => {
    setContextState(v);
    try {
      localStorage.setItem('kss.diff.context', v);
    } catch {
      // (this session only)
    }
  };
  const shownRows = (rows: DiffRow[]) => (context === 'all' ? rows.map((_, i) => i) : diffHunkIndices(rows, Number(context)));
  const [menu, setMenu] = useState<{ x: number; y: number; line: { part: number; after: number } | null } | null>(null);
  // A line of a part's text after, edited in place (after: its 1-based line)
  const [editing, setEditing] = useState<{ part: number; after: number; draft: string } | null>(null);
  const [lastLine, setLastLine] = useState<{ part: number; after: number } | null>(null);
  const startEdit = (line: { part: number; after: number } | null) => {
    if (!line || !shown[line.part]?.apply) return;
    const text = shown[line.part].after.split(/\r?\n/)[line.after - 1] ?? '';
    setEditing({ ...line, draft: text });
  };
  const commitEdit = () => {
    if (!editing) return;
    const p = shown[editing.part];
    const eol = p.after.includes('\r\n') ? '\r\n' : '\n';
    const lines = p.after.split(/\r?\n/);
    const was = lines[editing.after - 1];
    setEditing(null);
    if (was === editing.draft) return;
    lines.splice(editing.after - 1, 1, ...editing.draft.split(/\r?\n/));
    p.apply?.(lines.join(eol));
    applied();
  };
  const [zoom, setZoom] = useEditorZoom();
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const bodyRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // (the focus here: Enter / Space no longer reach a dialog under this one, e.g. its Override button)
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const go = (dir: 1 | -1) => {
    if (!changes.length) return;
    setCur((c) => (Math.min(c, changes.length - 1) + dir + changes.length) % changes.length);
  };
  const goTo = (i: 'first' | 'last') => changes.length && setCur(i === 'first' ? 0 : changes.length - 1);
  const canUndo = at >= 0 && !!shown[changes[at].part].apply;
  const undoAt = () => {
    if (!canUndo) return;
    const { part, change } = changes[at];
    const p = shown[part];
    const left = undoChange(p.rows, change, p.after.includes('\r\n') ? '\r\n' : '\n');
    setUndone((u) => [...u, { part: p.name, text: p.after, left }]);
    p.apply!(left);
    applied();
  };
  const redoLast = () => {
    const last = undone[undone.length - 1];
    if (!last) return;
    setUndone((u) => u.slice(0, -1));
    const p = shown.find((x) => x.name === last.part);
    // (edited since in the editor: not put back over it)
    if (p?.apply && p.after === last.left) {
      p.apply(last.text);
      applied();
    }
  };
  // (F2: the line last clicked, else the current change's first line put in)
  const editTarget = () => {
    if (lastLine) return lastLine;
    if (at < 0) return null;
    const { part, change } = changes[at];
    const r = shown[part].rows.slice(change.start, change.end + 1).find((x) => x.after !== undefined) ?? shown[part].rows[change.end + 1];
    return r?.after !== undefined ? { part, after: r.after } : null;
  };
  const ref = useRef({ go, goTo, undoAt, redoLast, startEdit: () => {} });
  ref.current = { go, goTo, undoAt, redoLast, startEdit: () => startEdit(editTarget()) };

  // The current change in view (not while its menu is open: a scroll closes the menu)
  useEffect(() => {
    if (at < 0 || menu) return;
    bodyRef.current?.querySelector(`[data-change="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [at, changes, menu]);
  // Ctrl+wheel: the text size (not the page's zoom: a listener that may prevent it)
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(zoomRef.current + (e.deltaY < 0 ? 0.1 : -0.1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoom]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // (typing in a line: its own keys)
      if (editing) return;
      if (e.key === 'F2' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        ref.current.startEdit();
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (menu) setMenu(null);
        else onClose();
      } else if (e.ctrlKey && !e.altKey && ['=', '+', '-', '0'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        setZoom(e.key === '0' ? 1 : zoomRef.current + (e.key === '-' ? -0.1 : 0.1));
      } else if (e.altKey && (e.key === 'Home' || e.key === 'End')) {
        e.preventDefault();
        e.stopPropagation();
        ref.current.goTo(e.key === 'Home' ? 'first' : 'last');
      } else if (e.key === 'F8' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) {
        e.preventDefault();
        e.stopPropagation();
        ref.current.go(e.shiftKey || e.key === 'ArrowUp' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, setZoom, menu, editing]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  const total = shown.reduce((n, p) => { const c = diffCounts(p.rows); return { added: n.added + c.added, removed: n.removed + c.removed }; }, { added: 0, removed: 0 });
  const undoTitle = at < 0 ? 'No change left' : canUndo ? 'Undo change: its lines as they were (the lines taken out put back, those put in taken out)' : 'This part is read-only here';
  const tool = 'flex items-center gap-1 px-2 py-0.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent';
  // (the change a row is in, by part)
  const changeOf = (part: number, row: number) => changes.findIndex((c) => c.part === part && row >= c.change.start && row <= c.change.end);
  const menuItem = (id: string, label: string, keys: string, Icon: typeof Undo2, run: () => void, disabled = false) => (
    <button
      id={id}
      type="button"
      role="menuitem"
      disabled={disabled}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => {
        setMenu(null);
        run();
      }}
      className="w-full flex items-center justify-between gap-3 px-2.5 py-1.5 rounded text-left text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-slate-400" />
        {label}
      </span>
      {keys && <span className="text-[10px] font-mono text-slate-500">{keys}</span>}
    </button>
  );
  const row = (p: (typeof shown)[number], part: number, i: number, r: DiffRow) => {
    const c = r.type === 'same' ? -1 : changeOf(part, i);
    const current = c >= 0 && c === at;
    const isEditing = !!editing && editing.part === part && r.after !== undefined && editing.after === r.after;
    return (
      <tr
        key={i}
        data-change={c >= 0 ? c : undefined}
        data-part={part}
        data-after={r.after}
        onClick={() => {
          if (c >= 0) setCur(c);
          if (r.after !== undefined) setLastLine({ part, after: r.after });
        }}
        onDoubleClick={() => r.after !== undefined && startEdit({ part, after: r.after })}
        title={p.apply && r.after !== undefined ? 'Double-click (F2): edit this line' : undefined}
        className={`diff-row diff-${r.type} ${current ? 'diff-current' : ''} ${r.type === 'add' ? 'bg-emerald-950/60' : r.type === 'del' ? 'bg-rose-950/60' : ''}`}
        style={current ? { boxShadow: 'inset 3px 0 0 rgba(56, 189, 248, 0.9)' } : undefined}
      >
        <td className="w-[3.6em] px-2 text-right text-slate-500 select-none align-top">{r.before ?? ''}</td>
        <td className="w-[3.6em] px-2 text-right text-slate-500 select-none align-top">{r.after ?? ''}</td>
        <td className={`w-[1.4em] select-none align-top ${r.type === 'add' ? 'text-emerald-300' : r.type === 'del' ? 'text-rose-300' : 'text-slate-600'}`}>{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</td>
        <td className={`pr-3 whitespace-pre align-top ${r.type === 'add' ? 'text-emerald-100' : r.type === 'del' ? 'text-rose-100' : 'text-slate-300'}`}>
          {isEditing ? (
            <textarea
              id="diff-line-input"
              autoFocus
              value={editing!.draft}
              rows={Math.max(1, editing!.draft.split('\n').length)}
              spellCheck={false}
              onChange={(e) => setEditing((x) => (x ? { ...x, draft: e.target.value } : x))}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  commitEdit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(null);
                }
              }}
              onBlur={commitEdit}
              className="w-full block resize-none bg-slate-950 text-slate-100 outline outline-1 outline-sky-500 rounded-sm font-mono leading-[1.45] p-0"
              style={{ fontSize: 'inherit' }}
            />
          ) : (
            r.text || ' '
          )}
        </td>
      </tr>
    );
  };
  return (
    <div id="diff-overlay" className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="diff-dialog" ref={dialogRef} tabIndex={-1} role="dialog" aria-label={title} className="outline-none w-[60rem] max-w-[96vw] max-h-[86vh] flex flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl text-xs">
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <GitCompare className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="font-semibold text-slate-100 truncate">{title}</span>
            <span id="diff-counts" className="font-mono text-[11px] shrink-0">
              <span className="text-emerald-400">+{total.added}</span> <span className="text-rose-400">−{total.removed}</span>
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[10px] text-slate-400">
              <span className="text-rose-300">−</span> {beforeLabel} · <span className="text-emerald-300">+</span> {afterLabel}
            </span>
            <button type="button" onClick={onClose} className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800" title="Close (Esc)">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* The changes one by one, each undone (and redone) on its own */}
        <div id="diff-toolbar" role="toolbar" aria-label="Changes" className="flex items-center gap-1 px-3 py-1 border-b border-slate-800 bg-slate-950/40">
          <button id="diff-first" type="button" className={tool} disabled={!changes.length || at === 0} onClick={() => goTo('first')} title="First change (Alt+Home)">
            <ChevronsUp className="w-3.5 h-3.5" /> First
          </button>
          <button id="diff-prev" type="button" className={tool} disabled={!changes.length} onClick={() => go(-1)} title="Previous change (Shift+F8, Alt+↑)">
            <ChevronUp className="w-3.5 h-3.5" /> Previous
          </button>
          <button id="diff-next" type="button" className={tool} disabled={!changes.length} onClick={() => go(1)} title="Next change (F8, Alt+↓)">
            <ChevronDown className="w-3.5 h-3.5" /> Next
          </button>
          <button id="diff-last" type="button" className={tool} disabled={!changes.length || at === changes.length - 1} onClick={() => goTo('last')} title="Last change (Alt+End)">
            <ChevronsDown className="w-3.5 h-3.5" /> Last
          </button>
          <span id="diff-position" className="px-2 text-slate-400 font-mono text-[11px]">
            {changes.length ? `Change ${at + 1} of ${changes.length}` : 'No changes'}
          </span>
          <span className="mx-1 h-4 border-l border-slate-700" />
          <button id="diff-undo-change" type="button" className={tool} disabled={!canUndo} onClick={undoAt} title={undoTitle}>
            <Undo2 className="w-3.5 h-3.5" /> Undo change
          </button>
          <button id="diff-redo-change" type="button" className={tool} disabled={!undone.length} onClick={redoLast} title={undone.length ? `Redo change: the change undone last put back (${undone[undone.length - 1].part})` : 'No change undone'}>
            <Redo2 className="w-3.5 h-3.5" /> Redo change
          </button>
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-slate-500">Right-click a change for these too</span>
            <label className="flex items-center gap-1 text-[10px] text-slate-400" title="The lines shown around the changes">
              Context
              <select id="diff-context" value={context} onChange={(e) => setContext(e.target.value as '3' | '10' | 'all')} className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-slate-200">
                <option value="3">3 lines</option>
                <option value="10">10 lines</option>
                <option value="all">The whole code</option>
              </select>
            </label>
            <button
              id="diff-zoom"
              type="button"
              onClick={() => setZoom(1)}
              className="px-1.5 py-0.5 rounded font-mono text-[10px] text-slate-400 hover:text-white hover:bg-slate-800"
              title="Text size (Ctrl+wheel, Ctrl+= / Ctrl+-); a click: 100% (Ctrl+0). The same as the code editors'"
            >
              {Math.round(zoom * 100)}%
            </button>
          </span>
        </div>
        <div
          id="diff-body"
          ref={bodyRef}
          className="flex-1 min-h-0 overflow-auto p-3 space-y-3 font-mono leading-[1.45]"
          style={{ fontSize: `${(11.5 * zoom).toFixed(2)}px` }}
          onContextMenu={(e) => {
            e.preventDefault();
            const tr = (e.target as HTMLElement).closest('tr');
            const c = tr?.getAttribute('data-change');
            if (c != null) setCur(Number(c));
            const after = tr?.getAttribute('data-after');
            const line = after ? { part: Number(tr!.getAttribute('data-part')), after: Number(after) } : null;
            if (line) setLastLine(line);
            setMenu({ x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 250), line });
          }}
        >
          {!changes.length && <div id="diff-none" className="text-slate-400 font-sans">No changes.</div>}
          {shown.map((p, part) => {
            if (!p.rows.some((r) => r.type !== 'same')) return null;
            return (
              <div key={p.name} className="rounded-lg border border-slate-800 overflow-hidden" data-diff-part={p.name}>
                <div className="px-3 py-1 bg-slate-800/70 text-slate-300 font-sans font-semibold text-[11px]">
                  {p.name}
                  {!p.apply && <span className="ml-2 font-normal text-slate-500">read-only</span>}
                </div>
                <table className="w-full border-collapse">
                  <tbody>
                    {shownRows(p.rows).map((i, k) =>
                      i === null ? (
                        <tr key={`gap-${k}`} className="text-slate-600">
                          <td colSpan={4} className="px-3 py-0.5 select-none">⋯</td>
                        </tr>
                      ) : (
                        row(p, part, i, p.rows[i])
                      )
                    )}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
      {menu && (
        <div id="diff-menu" role="menu" className="fixed z-[86] w-56 p-1 rounded-lg border border-slate-700 bg-slate-900/95 shadow-2xl text-xs font-sans" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {menuItem('diff-menu-undo', 'Undo this change', '', Undo2, undoAt, !canUndo)}
          {menuItem('diff-menu-redo', 'Redo change', '', Redo2, redoLast, !undone.length)}
          {menuItem('diff-menu-edit', 'Edit this line', 'F2', Pencil, () => startEdit(menu.line), !menu.line || !shown[menu.line.part]?.apply)}
          <div className="my-1 border-t border-slate-800" />
          {menuItem('diff-menu-first', 'First change', 'Alt+Home', ChevronsUp, () => goTo('first'), !changes.length)}
          {menuItem('diff-menu-prev', 'Previous change', 'Shift+F8', ChevronUp, () => go(-1), !changes.length)}
          {menuItem('diff-menu-next', 'Next change', 'F8', ChevronDown, () => go(1), !changes.length)}
          {menuItem('diff-menu-last', 'Last change', 'Alt+End', ChevronsDown, () => goTo('last'), !changes.length)}
        </div>
      )}
    </div>
  );
};
