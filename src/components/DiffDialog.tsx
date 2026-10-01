import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, Columns2, ExternalLink, GitCompare, PanelRight, Pencil, Redo2, RefreshCw, Rows3, Undo2, X } from 'lucide-react';
import { diffChanges, diffCounts, diffHunkIndices, diffLines, inlineDiff, undoChange, type DiffChange, type DiffRow, type InlineSeg } from '../utils/textDiff.ts';
import { useEditorZoom } from '../hooks/useEditorZoom.ts';

/** Asks an editor to show its changes ({ editor: 'method' | 'pou' | 'enum' }): the "*" on its tab */
export const SHOW_EDITOR_DIFF_EVENT = 'kss-show-editor-diff';
export const showEditorDiff = (editor: 'method' | 'pou' | 'enum') => window.dispatchEvent(new CustomEvent(SHOW_EDITOR_DIFF_EVENT, { detail: { editor } }));

/**
 * What a Diff shows (the app opens it, as a popup or in its dock tab): an editor's edits (its parts from the pending
 * saves' registry, by its id), a file's changes since it was saved, or all of them
 */
export type DiffRequest =
  | { source: 'editor'; editorId: string; title: string; beforeLabel: string; afterLabel: string }
  | { source: 'file'; file: 'pou' | 'enum' }
  | { source: 'all' };
export const OPEN_DIFF_EVENT = 'kss-open-diff';
export const openDiff = (request: DiffRequest) => window.dispatchEvent(new CustomEvent(OPEN_DIFF_EVENT, { detail: request }));
/** A file's changes since it was saved: an editor's Diff with no edits of its own (the canvas' edits, an editor's saved into the POU) */
export const showFileDiff = (file: 'pou' | 'enum') => openDiff({ source: 'file', file });

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

type ViewMode = 'split' | 'unified';
type Context = '3' | '10' | 'all';
const stored = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // (this session only)
  }
};
const keyOf = (parts: DiffPart[]) => parts.map((p) => `${p.name}\u0000${p.before}\u0000${p.after}`).join('\u0001');

export interface DiffPanelProps {
  title: string;
  beforeLabel: string;
  afterLabel: string;
  /** The parts as they are now (read again to find changes made elsewhere, e.g. typed in the editor) */
  getParts: () => DiffPart[];
  onClose: () => void;
  /** Docked: in the Diff tab (its keys only while it has the focus; Esc closes nothing) */
  docked?: boolean;
  /** Into the dock, beside the Diagram Canvas / back to a popup */
  onDock?: () => void;
  onFloat?: () => void;
}

/**
 * The changes of an editor (its text against what is in the POU / the enum) or of a file (against its saved version).
 * Split view (the default): the text before on the left, after on the right, line by line; Unified: one column, the
 * lines taken out in red, put in in green. Its toolbar (and a change's right-click menu): First / Previous / Next /
 * Last change (Alt+Home, Shift+F8, F8, Alt+End), Undo change (its lines as before) and Redo change. A line of the text
 * after is edited in place: a double-click, F2 or Edit this line (Enter puts it in, Shift+Enter a new line, Esc drops
 * it). Context: 3 lines, 10 or the whole code around the changes. Its text size is the code editors' (Ctrl+wheel).
 * The code changed meanwhile (typed in the editor, the canvas' edits): it says so, Reload shows it as it is now
 */
export const DiffPanel: React.FC<DiffPanelProps> = ({ title, beforeLabel, afterLabel, getParts, onClose, docked, onDock, onFloat }) => {
  const getRef = useRef(getParts);
  getRef.current = getParts;
  // What is shown: the parts when opened (or reloaded); the parts now: checked every second
  const [snapshot, setSnapshot] = useState<DiffPart[]>(() => getParts());
  const snapKey = useMemo(() => keyOf(snapshot), [snapshot]);
  const [liveKey, setLiveKey] = useState(snapKey);
  const reload = () => {
    const now = getRef.current();
    setSnapshot(now);
    setLiveKey(keyOf(now));
  };
  useEffect(() => {
    const t = window.setInterval(() => {
      const k = keyOf(getRef.current());
      setLiveKey((cur) => (cur === k ? cur : k));
    }, 900);
    return () => window.clearInterval(t);
  }, []);
  // (a new source: shown at once)
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);
  const stale = liveKey !== snapKey;
  // (a change made here: shown as it is then, once the editor has it)
  const applied = () => window.setTimeout(reload, 60);
  // (the part to change: as it is now, its own apply)
  const liveOf = (name: string) => getRef.current().find((p) => p.name === name);

  const shown = useMemo(() => snapshot.map((p) => ({ ...p, rows: diffLines(p.before, p.after) })), [snapshot]);
  const changes = useMemo<ShownChange[]>(() => shown.flatMap((p, part) => diffChanges(p.rows).map((change) => ({ part, change }))), [shown]);
  const [cur, setCur] = useState(0);
  const at = changes.length ? Math.min(cur, changes.length - 1) : -1;
  // The changes undone, latest last: Redo change puts them back (while their part is still as the undo left it)
  const [undone, setUndone] = useState<{ part: string; text: string; left: string }[]>([]);
  const [view, setViewState] = useState<ViewMode>(() => stored('kss.diff.view', ['split', 'unified'] as const, 'split'));
  const setView = (v: ViewMode) => {
    setViewState(v);
    store('kss.diff.view', v);
  };
  // The lines shown around the changes: 3, 10, or the whole code (kept in this browser; the whole code by default)
  const [context, setContextState] = useState<Context>(() => stored('kss.diff.context', ['3', '10', 'all'] as const, 'all'));
  const setContext = (v: Context) => {
    setContextState(v);
    store('kss.diff.context', v);
  };
  const shownRows = (rows: DiffRow[]) => (context === 'all' ? rows.map((_, i) => i) : diffHunkIndices(rows, Number(context)));
  const [menu, setMenu] = useState<{ x: number; y: number; line: { part: number; after: number } | null } | null>(null);
  // A line of a part's text after, edited in place (after: its 1-based line)
  const [editing, setEditing] = useState<{ part: number; after: number; draft: string } | null>(null);
  const [lastLine, setLastLine] = useState<{ part: number; after: number } | null>(null);
  const canEdit = (part: number) => !stale && !!shown[part] && !!liveOf(shown[part].name)?.apply;
  const startEdit = (line: { part: number; after: number } | null) => {
    if (!line || !canEdit(line.part)) return;
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
    liveOf(p.name)?.apply?.(lines.join(eol));
    applied();
  };
  const [zoom, setZoom] = useEditorZoom();
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const bodyRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // (a popup: the focus here, so Enter / Space no longer reach a dialog under this one, e.g. its Override button)
  useEffect(() => {
    if (!docked) rootRef.current?.focus();
  }, [docked]);

  const go = (dir: 1 | -1) => {
    if (!changes.length) return;
    setCur((c) => (Math.min(c, changes.length - 1) + dir + changes.length) % changes.length);
  };
  const goTo = (i: 'first' | 'last') => changes.length && setCur(i === 'first' ? 0 : changes.length - 1);
  const canUndo = at >= 0 && canEdit(changes[at].part);
  const undoAt = () => {
    if (!canUndo) return;
    const { part, change } = changes[at];
    const p = shown[part];
    const left = undoChange(p.rows, change, p.after.includes('\r\n') ? '\r\n' : '\n');
    setUndone((u) => [...u, { part: p.name, text: p.after, left }]);
    liveOf(p.name)?.apply?.(left);
    applied();
  };
  const redoLast = () => {
    const last = undone[undone.length - 1];
    if (!last) return;
    setUndone((u) => u.slice(0, -1));
    const p = liveOf(last.part);
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
  }, [at, changes, menu, view]);
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
      // (typing in a line: its own keys; docked: only while the focus is in it)
      if (editing) return;
      if (docked && !rootRef.current?.contains(document.activeElement)) return;
      if (e.key === 'F2' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        ref.current.startEdit();
        return;
      }
      if (e.key === 'Escape') {
        if (menu) {
          e.stopPropagation();
          setMenu(null);
        } else if (!docked) {
          e.stopPropagation();
          onClose();
        }
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
  }, [onClose, setZoom, menu, editing, docked]);
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
  const undoTitle = stale ? 'The code changed since this was shown: Reload first' : at < 0 ? 'No change left' : canUndo ? 'Undo change: its lines as they were (the lines taken out put back, those put in taken out)' : 'This part is read-only here';
  const tool = 'flex items-center gap-1 px-2 py-0.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent';
  // (the change a row is in, by part)
  const changeOf = (part: number, row: number | undefined) => (row === undefined ? -1 : changes.findIndex((c) => c.part === part && row >= c.change.start && row <= c.change.end));
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
  // A line of the text after, typed in place
  const lineInput = () => (
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
  );
  const isEditingLine = (part: number, r: DiffRow | undefined) => !!editing && !!r && editing.part === part && r.after !== undefined && editing.after === r.after;
  const rowEvents = (part: number, c: number, after: number | undefined) => ({
    'data-change': c >= 0 ? c : undefined,
    'data-part': part,
    'data-after': after,
    onClick: () => {
      if (c >= 0) setCur(c);
      if (after !== undefined) setLastLine({ part, after });
    },
    onDoubleClick: () => after !== undefined && startEdit({ part, after }),
  });
  const currentStyle = (current: boolean) => (current ? { boxShadow: 'inset 3px 0 0 rgba(56, 189, 248, 0.9)' } : undefined);

  // Unified: one row a line
  const unifiedRow = (p: (typeof shown)[number], part: number, i: number, r: DiffRow) => {
    const c = r.type === 'same' ? -1 : changeOf(part, i);
    const current = c >= 0 && c === at;
    return (
      <tr
        key={i}
        {...rowEvents(part, c, r.after)}
        title={p.apply && r.after !== undefined ? 'Double-click (F2): edit this line' : undefined}
        className={`diff-row diff-${r.type} ${current ? 'diff-current' : ''} ${r.type === 'add' ? 'bg-emerald-950/60' : r.type === 'del' ? 'bg-rose-950/60' : ''}`}
        style={currentStyle(current)}
      >
        <td className="w-[3.6em] px-2 text-right text-slate-500 select-none align-top">{r.before ?? ''}</td>
        <td className="w-[3.6em] px-2 text-right text-slate-500 select-none align-top">{r.after ?? ''}</td>
        <td className={`w-[1.4em] select-none align-top ${r.type === 'add' ? 'text-emerald-300' : r.type === 'del' ? 'text-rose-300' : 'text-slate-600'}`}>{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</td>
        <td className={`pr-3 whitespace-pre align-top ${r.type === 'add' ? 'text-emerald-100' : r.type === 'del' ? 'text-rose-100' : 'text-slate-300'}`}>{isEditingLine(part, r) ? lineInput() : r.text || ' '}</td>
      </tr>
    );
  };
  // Split: the line before on the left, after on the right (a change's lines taken out beside those put in)
  const splitPairs = (rows: DiffRow[]) => {
    const pairs: { l?: number; r?: number }[] = [];
    let i = 0;
    while (i < rows.length) {
      if (rows[i].type === 'same') {
        pairs.push({ l: i, r: i });
        i++;
        continue;
      }
      const dels: number[] = [];
      const adds: number[] = [];
      while (i < rows.length && rows[i].type !== 'same') (rows[i].type === 'del' ? dels : adds).push(i++);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) pairs.push({ l: dels[k], r: adds[k] });
    }
    return pairs;
  };
  const splitBody = (p: (typeof shown)[number], part: number) => {
    const visible = new Set(shownRows(p.rows).filter((x): x is number => x !== null));
    const out: React.ReactNode[] = [];
    let hidden = false;
    splitPairs(p.rows).forEach((pair, k) => {
      const show = (pair.l !== undefined && visible.has(pair.l)) || (pair.r !== undefined && visible.has(pair.r));
      if (!show) {
        hidden = true;
        return;
      }
      if (hidden || (out.length === 0 && k > 0)) out.push(<tr key={`gap-${k}`} className="diff-gap text-slate-600"><td colSpan={4} className="px-3 py-0.5 select-none">⋯</td></tr>);
      hidden = false;
      const L = pair.l !== undefined ? p.rows[pair.l] : undefined;
      const R = pair.r !== undefined ? p.rows[pair.r] : undefined;
      const changed = (L && L.type !== 'same') || (R && R.type !== 'same');
      const c = changed ? changeOf(part, L && L.type !== 'same' ? pair.l : pair.r) : -1;
      const current = c >= 0 && c === at;
      const del = L?.type === 'del';
      const add = R?.type === 'add';
      // (a line changed: what changed within it marked on both sides)
      // (two lines with little in common, paired only by place: the whole line is the change)
      const pairInline = del && add && L && R && (L.text || R.text) ? inlineDiff(L.text, R.text) : null;
      const kept = pairInline ? pairInline.right.filter((s) => !s.changed && /\S/.test(s.text)).reduce((n, s) => n + s.text.trim().length, 0) : 0;
      const inline = pairInline && kept >= 0.4 * Math.max(L!.text.trim().length, R!.text.trim().length) ? pairInline : null;
      const segs = (parts: InlineSeg[], cls: string) =>
        parts.map((s, i) => (s.changed ? <span key={i} data-diff-inline="" className={`${cls} rounded-sm`}>{s.text}</span> : <React.Fragment key={i}>{s.text}</React.Fragment>));
      out.push(
        <tr
          key={k}
          {...rowEvents(part, c, R?.after)}
          title={p.apply && R?.after !== undefined ? 'Double-click (F2): edit this line (the right side)' : undefined}
          className={`diff-row ${changed ? '' : 'diff-same'} ${del ? 'diff-del' : ''} ${add ? 'diff-add' : ''} ${current ? 'diff-current' : ''}`}
          style={currentStyle(current)}
        >
          <td className={`w-[3.6em] px-2 text-right text-slate-500 select-none align-top ${del ? 'bg-rose-950/60' : changed && !L ? 'bg-slate-800/30' : ''}`}>{L?.before ?? ''}</td>
          <td className={`diff-before px-2 whitespace-pre-wrap [overflow-wrap:anywhere] align-top border-r border-slate-800 ${del ? 'bg-rose-950/60 text-rose-100' : changed && !L ? 'bg-slate-800/30' : 'text-slate-300'}`}>{L ? (inline ? segs(inline.left, 'bg-rose-700/60 text-white') : L.text || ' ') : ''}</td>
          <td className={`w-[3.6em] px-2 text-right text-slate-500 select-none align-top ${add ? 'bg-emerald-950/60' : changed && !R ? 'bg-slate-800/30' : ''}`}>{R?.after ?? ''}</td>
          <td className={`diff-after px-2 whitespace-pre-wrap [overflow-wrap:anywhere] align-top ${add ? 'bg-emerald-950/60 text-emerald-100' : changed && !R ? 'bg-slate-800/30' : 'text-slate-300'}`}>{R ? (isEditingLine(part, R) ? lineInput() : inline ? segs(inline.right, 'bg-emerald-700/60 text-white') : R.text || ' ') : ''}</td>
        </tr>
      );
    });
    if (hidden) out.push(<tr key="gap-end" className="diff-gap text-slate-600"><td colSpan={4} className="px-3 py-0.5 select-none">⋯</td></tr>);
    return out;
  };

  const panel = (
    <div
      id="diff-dialog"
      ref={rootRef}
      tabIndex={-1}
      role={docked ? 'region' : 'dialog'}
      aria-label={title}
      data-docked={docked ? 'true' : undefined}
      data-view={view}
      className={`outline-none flex flex-col bg-slate-900 text-xs ${docked ? 'h-full w-full' : 'w-[72rem] max-w-[96vw] max-h-[86vh] rounded-xl border border-slate-700 shadow-2xl'}`}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <GitCompare className="w-4 h-4 text-sky-400 shrink-0" />
          <span id="diff-title" className="font-semibold text-slate-100 truncate">{title}</span>
          <span id="diff-counts" className="font-mono text-[11px] shrink-0">
            <span className="text-emerald-400">+{total.added}</span> <span className="text-rose-400">−{total.removed}</span>
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-slate-400">
            <span className="text-rose-300">−</span> {beforeLabel} · <span className="text-emerald-300">+</span> {afterLabel}
          </span>
          {onDock && (
            <button id="diff-dock-btn" type="button" onClick={onDock} className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800" title="Dock it: a tab beside the Diagram Canvas (Float brings it back as a popup)">
              <PanelRight className="w-4 h-4" />
            </button>
          )}
          {onFloat && (
            <button id="diff-float-btn" type="button" onClick={onFloat} className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800" title="Float it: a popup again">
              <ExternalLink className="w-4 h-4" />
            </button>
          )}
          <button id="diff-close-btn" type="button" onClick={onClose} className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800" title={docked ? 'Close' : 'Close (Esc)'}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      {/* The changes one by one, each undone (and redone) on its own */}
      <div id="diff-toolbar" role="toolbar" aria-label="Changes" className="flex flex-wrap items-center gap-1 px-3 py-1 border-b border-slate-800 bg-slate-950/40">
        <span className="flex items-center rounded border border-slate-700 overflow-hidden mr-1">
          <button id="diff-view-split" type="button" onClick={() => setView('split')} className={`flex items-center gap-1 px-2 py-0.5 ${view === 'split' ? 'bg-sky-900/70 text-sky-100' : 'text-slate-300 hover:bg-slate-800'}`} title="Split view: the text before on the left, after on the right">
            <Columns2 className="w-3.5 h-3.5" /> Split
          </button>
          <button id="diff-view-unified" type="button" onClick={() => setView('unified')} className={`flex items-center gap-1 px-2 py-0.5 border-l border-slate-700 ${view === 'unified' ? 'bg-sky-900/70 text-sky-100' : 'text-slate-300 hover:bg-slate-800'}`} title="Unified view: one column, the lines taken out and put in">
            <Rows3 className="w-3.5 h-3.5" /> Unified
          </button>
        </span>
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
        <button id="diff-redo-change" type="button" className={tool} disabled={!undone.length || stale} onClick={redoLast} title={undone.length ? `Redo change: the change undone last put back (${undone[undone.length - 1].part})` : 'No change undone'}>
          <Redo2 className="w-3.5 h-3.5" /> Redo change
        </button>
        <span className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-slate-400" title="The lines shown around the changes">
            Context
            <select id="diff-context" value={context} onChange={(e) => setContext(e.target.value as Context)} className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-slate-200">
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
            title="Text size (Ctrl+wheel, Ctrl+= / Ctrl+-); a click: 100% (Ctrl+0). The same as the code editors'. Right-click a change: its actions"
          >
            {Math.round(zoom * 100)}%
          </button>
        </span>
      </div>
      {/* The code changed meanwhile: shown as it was opened until Reload */}
      {stale && (
        <div id="diff-stale" className="flex items-center gap-2 px-3 py-1.5 border-b border-amber-800/60 bg-amber-950/50 text-amber-200 text-[11px] font-sans">
          <RefreshCw className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1">The code changed since this was shown (in the editor, or the file).</span>
          <button id="diff-reload" type="button" onClick={reload} className="px-2 py-0.5 rounded bg-amber-700/60 hover:bg-amber-600/70 text-amber-50 font-semibold" title="Show the changes as they are now">
            Reload
          </button>
        </div>
      )}
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
              {view === 'split' ? (
                <table className="w-full border-collapse table-fixed">
                  <colgroup>
                    <col style={{ width: '3.6em' }} />
                    <col />
                    <col style={{ width: '3.6em' }} />
                    <col />
                  </colgroup>
                  <thead>
                    <tr className="text-[10px] font-sans text-slate-500">
                      <th colSpan={2} className="text-left px-2 py-0.5 font-normal border-r border-slate-800">{beforeLabel}</th>
                      <th colSpan={2} className="text-left px-2 py-0.5 font-normal">{afterLabel}</th>
                    </tr>
                  </thead>
                  <tbody>{splitBody(p, part)}</tbody>
                </table>
              ) : (
                <table className="w-full border-collapse">
                  <tbody>
                    {shownRows(p.rows).map((i, k) =>
                      i === null ? (
                        <tr key={`gap-${k}`} className="diff-gap text-slate-600">
                          <td colSpan={4} className="px-3 py-0.5 select-none">⋯</td>
                        </tr>
                      ) : (
                        unifiedRow(p, part, i, p.rows[i])
                      )
                    )}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
      {menu && (
        <div id="diff-menu" role="menu" className="fixed z-[86] w-56 p-1 rounded-lg border border-slate-700 bg-slate-900/95 shadow-2xl text-xs font-sans" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {menuItem('diff-menu-undo', 'Undo this change', '', Undo2, undoAt, !canUndo)}
          {menuItem('diff-menu-redo', 'Redo change', '', Redo2, redoLast, !undone.length || stale)}
          {menuItem('diff-menu-edit', 'Edit this line', 'F2', Pencil, () => startEdit(menu.line), !menu.line || !canEdit(menu.line.part))}
          <div className="my-1 border-t border-slate-800" />
          {menuItem('diff-menu-first', 'First change', 'Alt+Home', ChevronsUp, () => goTo('first'), !changes.length)}
          {menuItem('diff-menu-prev', 'Previous change', 'Shift+F8', ChevronUp, () => go(-1), !changes.length)}
          {menuItem('diff-menu-next', 'Next change', 'F8', ChevronDown, () => go(1), !changes.length)}
          {menuItem('diff-menu-last', 'Last change', 'Alt+End', ChevronsDown, () => goTo('last'), !changes.length)}
          {stale && (
            <>
              <div className="my-1 border-t border-slate-800" />
              {menuItem('diff-menu-reload', 'Reload (the code changed)', '', RefreshCw, reload)}
            </>
          )}
        </div>
      )}
    </div>
  );
  if (docked) return panel;
  return (
    <div id="diff-overlay" className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {panel}
    </div>
  );
};

/** The Diff as a popup (parts: as they are, or how to get them as they are now) */
export const DiffDialog: React.FC<{
  title: string;
  beforeLabel: string;
  afterLabel: string;
  parts: DiffPart[] | (() => DiffPart[]);
  onClose: () => void;
  onDock?: () => void;
}> = ({ parts, ...rest }) => {
  const get = typeof parts === 'function' ? parts : () => parts;
  return <DiffPanel {...rest} getParts={get} />;
};
