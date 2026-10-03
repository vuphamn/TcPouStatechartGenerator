import React, { useEffect, useRef, useState } from 'react';
import { AlertOctagon, AlertTriangle, ArrowLeft, CheckCircle2, CircleDot, Cpu, FileCode, GitCompare, X, FileJson } from 'lucide-react';

export interface StatusMessage {
  text: string;
  type: 'success' | 'error';
}

interface StatusBarProps {
  /** The latest message (what used to pop up as a toast); cleared after a while */
  message: StatusMessage | null;
  onDismissMessage: () => void;
  fileName: string;
  /** XAE: files edited but not saved to the project yet */
  unsavedCount?: number;
  /** XAE: the file changed in XAE while edited here */
  changedInXae?: boolean;
  statesCount: number;
  transitionsCount: number;
  errors: number;
  warnings: number;
  onOpenProblems: () => void;
  live?: { state: string | null; message?: string } | null;
  onOpenLive: () => void;
  /**
   * Where the canvas' layout, notes and documentation are kept: the POU's layout file beside it (for git; its name, and
   * its state), or this browser (no host has the POU's folder)
   */
  layout?: LayoutStatus | null;
  /** The layout badge's menu: a folder for it (web), the file read again, the chart's look kept as this user's own */
  layoutMenu?: LayoutMenu | null;
  /** The I/O's health while live (the I/O tab's boxes: how many known, how many not in OP) */
  io?: { known: number; down: string[] } | null;
  onOpenIo?: () => void;
  /** Compare mode: number of differences to the baseline */
  changes?: number | null;
  onOpenChanges: () => void;
  host: 'XAE' | 'Desktop' | 'Web';
  /** Details follow the selection (state -> Documentation, transition -> guard window) */
  followSelection: boolean;
  onFollowSelectionChange: (on: boolean) => void;
  /** The chart opened before this one (a referenced state machine was opened) */
  backTo?: { name: string; onClick: () => void } | null;
  /** This edition's version (the release notes open on a click) */
  version?: string;
  onOpenReleaseNotes?: () => void;
}

export interface LayoutStatus {
  file: string | null;
  state: 'loaded' | 'saved' | 'new' | 'other-engine' | 'error' | 'browser';
  detail?: string;
}
export interface LayoutMenu {
  /** The web edition: a folder chosen for the layout file (the POU's own, or one above it) */
  onPickFolder?: () => void;
  /** The file read again (changed on disk: git) */
  onReload?: () => void;
  /** The chart's look (colours, collapsed composites): this user's own, not the file's */
  ownLook: boolean;
  onOwnLookChange?: (on: boolean) => void;
}

/** Where the layout is kept (the file beside the POU, or this browser), and its menu */
const LayoutBadge: React.FC<{ layout: LayoutStatus; menu?: LayoutMenu | null }> = ({ layout, menu }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const kept = layout.state !== 'browser';
  const item = 'block w-full text-left px-3 py-1.5 hover:bg-slate-700 text-slate-200 disabled:text-slate-500 disabled:hover:bg-transparent';
  return (
    <span ref={ref} className="relative shrink-0">
      <button
        id="status-layout"
        type="button"
        data-state={layout.state}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 ${layout.state === 'error' || layout.state === 'other-engine' ? 'text-amber-300 hover:text-amber-200' : 'text-slate-400 hover:text-slate-200'}`}
        title={
          !kept
            ? "The states' places, the notes and the documentation are kept in this browser only: opened from its project folder (the desktop app, XAE, Link, or a folder chosen here), they are kept in a file beside the POU, for git"
            : `${layout.file}: the states' places, the transitions' routes, the notes, the documentation and the chart's look, kept beside the POU. Commit it to share them; your theme, presets and recordings stay yours${layout.detail ? `\n${layout.detail}` : ''}`
        }
      >
        <FileJson className="w-3 h-3" />
        <span className="font-mono truncate max-w-[220px]">{!kept ? 'Layout: this browser' : `${layout.file}${layout.state === 'error' ? ' (not written)' : layout.state === 'other-engine' ? ' (another engine)' : ''}`}</span>
      </button>
      {open && (
        <div id="status-layout-menu" className="absolute bottom-6 right-0 z-50 w-72 rounded border border-slate-700 bg-slate-800 shadow-xl py-1 text-[11px]">
          <div className="px-3 py-1.5 text-slate-400 whitespace-normal">
            {kept ? `${layout.file}, beside the POU: commit it to share the layout with the team.` : 'Kept in this browser only.'}
            {layout.detail && <div className="mt-1 text-amber-300">{layout.detail}</div>}
          </div>
          {menu?.onPickFolder && (
            <button id="status-layout-pick" type="button" className={item} onClick={() => { setOpen(false); menu.onPickFolder!(); }}>
              {kept ? 'Choose another folder for it…' : 'Keep it beside the POU (choose its folder)…'}
            </button>
          )}
          {kept && menu?.onReload && (
            <button id="status-layout-reload" type="button" className={item} onClick={() => { setOpen(false); menu.onReload!(); }}>
              Read the file again
            </button>
          )}
          {kept && menu?.onOwnLookChange && (
            <label className="flex items-start gap-2 px-3 py-1.5 hover:bg-slate-700 text-slate-200 cursor-pointer" title="The states' and transitions' colours and the collapsed composites: yours, kept in this browser; the file's look is left as it is">
              <input id="status-layout-own-look" type="checkbox" className="w-3 h-3 mt-0.5" checked={menu.ownLook} onChange={(e) => menu.onOwnLookChange!(e.target.checked)} />
              <span>My own look (colours, collapsed composites), not the team's</span>
            </label>
          )}
        </div>
      )}
    </span>
  );
};

/** One quiet line at the bottom: messages, the file and its save state, counts, problems and the live view */
export const StatusBar: React.FC<StatusBarProps> = ({
  message,
  onDismissMessage,
  fileName,
  unsavedCount = 0,
  changedInXae = false,
  statesCount,
  transitionsCount,
  errors,
  warnings,
  onOpenProblems,
  live,
  onOpenLive,
  io,
  onOpenIo,
  layout,
  layoutMenu,
  changes,
  onOpenChanges,
  host,
  followSelection,
  onFollowSelectionChange,
  backTo,
  version,
  onOpenReleaseNotes,
}) => (
  <footer
    id="status-bar"
    className="flex items-center gap-3 px-3 h-6 shrink-0 bg-slate-900 border-t border-slate-800 text-[11px] text-slate-400 select-none"
  >
    <div id="status-message" className="flex items-center gap-1.5 min-w-0 flex-1" aria-live="polite">
      {message ? (
        <>
          {message.type === 'success' ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          )}
          <span className={`truncate ${message.type === 'error' ? 'text-rose-300' : 'text-slate-200'}`} title={message.text}>
            {message.text}
          </span>
          <button type="button" onClick={onDismissMessage} className="p-0.5 rounded hover:bg-slate-800 hover:text-white shrink-0" title="Dismiss">
            <X className="w-3 h-3" />
          </button>
        </>
      ) : (
        <span className="text-slate-500">Ready</span>
      )}
    </div>

    {live && (
      <button id="status-live" type="button" onClick={onOpenLive} className="flex items-center gap-1.5 hover:text-emerald-200 text-emerald-300 shrink-0" title={live.message}>
        <span className="live-dot" />
        <span className="font-mono truncate max-w-[220px]">{live.state ?? 'LIVE'}</span>
      </button>
    )}
    {layout && <LayoutBadge layout={layout} menu={layoutMenu} />}
    {io && io.known > 0 && (
      <button
        id="status-io"
        type="button"
        onClick={onOpenIo}
        data-down={io.down.length || undefined}
        className={`flex items-center gap-1 shrink-0 ${io.down.length ? 'text-rose-300 hover:text-rose-200 font-semibold' : 'text-emerald-300 hover:text-emerald-200'}`}
        title={io.down.length ? `Not in OP:\n${io.down.slice(0, 12).join('\n')}${io.down.length > 12 ? '\n…' : ''}\n(the I/O tab)` : `All ${io.known} boxes in OP (the I/O tab)`}
      >
        <Cpu className="w-3 h-3" />
        {io.down.length ? `I/O: ${io.down.length} not OP` : 'I/O OK'}
      </button>
    )}
    {changes != null && (
      <button id="status-changes" type="button" onClick={onOpenChanges} className="flex items-center gap-1 hover:text-sky-200 text-sky-300 shrink-0" title="Differences to the compared version">
        <GitCompare className="w-3 h-3" />
        {changes === 0 ? 'no changes' : `${changes} change${changes === 1 ? '' : 's'}`}
      </button>
    )}
    <button
      id="status-problems"
      type="button"
      onClick={onOpenProblems}
      className="flex items-center gap-2 hover:text-slate-200 shrink-0"
      title="Open the Problems tab"
    >
      <span className={`flex items-center gap-0.5 ${errors ? 'text-rose-300' : ''}`}>
        <AlertOctagon className="w-3 h-3" /> {errors}
      </span>
      <span className={`flex items-center gap-0.5 ${warnings ? 'text-amber-300' : ''}`}>
        <AlertTriangle className="w-3 h-3" /> {warnings}
      </span>
    </button>
    <span id="status-counts" className="shrink-0" title="States and transitions in the diagram">
      {statesCount} states · {transitionsCount} transitions
    </span>
    {backTo && (
      <button id="status-back" type="button" onClick={backTo.onClick} className="flex items-center gap-1 text-sky-300 hover:text-sky-200 shrink-0" title={`Back to ${backTo.name}`}>
        <ArrowLeft className="w-3 h-3" /> {backTo.name.replace(/\.TcPOU$/i, '')}
      </button>
    )}
    <span id="status-file" className="flex items-center gap-1 min-w-0 shrink" title={fileName}>
      <FileCode className="w-3 h-3 shrink-0" />
      <span className="truncate max-w-[200px]">{fileName || 'no file'}</span>
      {changedInXae ? (
        <span className="text-amber-300 shrink-0">· changed in XAE</span>
      ) : unsavedCount > 0 ? (
        <span className="text-amber-300 shrink-0">· {unsavedCount} unsaved</span>
      ) : null}
    </span>
    <label
      className="flex items-center gap-1 shrink-0 cursor-pointer hover:text-slate-200"
      title="Details follow the selection: a selected state brings its documentation forward"
    >
      <input id="status-follow-selection" type="checkbox" className="w-3 h-3" checked={followSelection} onChange={(e) => onFollowSelectionChange(e.target.checked)} />
      Follow selection
    </label>
    <button
      id="status-version"
      type="button"
      onClick={onOpenReleaseNotes}
      className="flex items-center gap-1 shrink-0 text-slate-500 hover:text-slate-200"
      title={`Kval MachineScope ${host} edition${version ? ` ${version}` : ''}: the release notes (change history)`}
    >
      <CircleDot className="w-3 h-3" /> {host}
      {version && <span className="font-mono">{version}</span>}
    </button>
  </footer>
);
