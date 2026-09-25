import React from 'react';
import { AlertOctagon, AlertTriangle, ArrowLeft, CheckCircle2, CircleDot, FileCode, GitCompare, X } from 'lucide-react';

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
  /** Compare mode: number of differences to the baseline */
  changes?: number | null;
  onOpenChanges: () => void;
  host: 'XAE' | 'Desktop' | 'Web';
  /** Details follow the selection (state -> Documentation, transition -> guard window) */
  followSelection: boolean;
  onFollowSelectionChange: (on: boolean) => void;
  /** The chart opened before this one (a referenced state machine was opened) */
  backTo?: { name: string; onClick: () => void } | null;
}

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
  changes,
  onOpenChanges,
  host,
  followSelection,
  onFollowSelectionChange,
  backTo,
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
      title="Details follow the selection: a state shows its documentation, a transition opens its guard on the first click"
    >
      <input id="status-follow-selection" type="checkbox" className="w-3 h-3" checked={followSelection} onChange={(e) => onFollowSelectionChange(e.target.checked)} />
      Follow selection
    </label>
    <span className="flex items-center gap-1 shrink-0 text-slate-500" title="Where Kval StateScope runs">
      <CircleDot className="w-3 h-3" /> {host}
    </span>
  </footer>
);
