import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Hammer, Loader2, Upload, X, XCircle } from 'lucide-react';
import type { PlcBuildItem, PlcBuildResult, PlcWrite } from '../utils/plcBuild.ts';
import { buildItemWhere } from '../utils/plcBuild.ts';
import type { PartDiff } from '../utils/pouDiff.ts';

export interface PlcBuildState {
  /** building / writing: running (step: what XAE does now); done: the build's (or the write's) result */
  phase: 'building' | 'writing' | 'done';
  step?: string;
  /** Build only, or the write it went on with */
  write: PlcWrite | null;
  result?: PlcBuildResult;
  /** The files put in (their PLC paths) */
  files: string[];
  /** The PLC: its project, the connection's target */
  project?: string;
  target?: string;
  /** What a write changes on the PLC: each file sent against the PLC's own, part by part */
  changes?: { file: string; parts: PartDiff[] }[];
}

const WRITE_TEXT: Record<PlcWrite, { title: string; label: string; warning: string }> = {
  online: {
    title: 'Write to the PLC: online change',
    label: 'Online change',
    warning: 'The PLC takes the new code while it runs (an online change). Variables keep their values. The machine may behave differently at once: make sure it is safe.',
  },
  download: {
    title: 'Write to the PLC: download',
    label: 'Download',
    warning: 'The online change was not possible, so the PLC application stops, takes the new code and starts again (TwinCAT keeps running). Variables not persistent start from their initial values, and the outputs of this PLC stop while it restarts. Only when the machine may stop.',
  },
  activate: {
    title: 'Write to the PLC: activate the configuration',
    label: 'Activate configuration',
    warning: 'TwinCAT restarts on the target: the PLC stops, its outputs drop, then it starts again with the new code. Variables not persistent start from their initial values. Only when the machine may stop.',
  },
};

/**
 * The PLC's project rebuilt with the POUs edited here (TwinCAT XAE through its Automation Interface): what it is
 * doing, then its errors and warnings (a click opens the place when it is in this POU); without errors, the project
 * written to the PLC after a confirmation (online change; activating the configuration only with its own warning)
 */
export const PlcBuildDialog: React.FC<{
  state: PlcBuildState;
  onOpenItem: (item: PlcBuildItem) => boolean;
  canOpen: (item: PlcBuildItem) => boolean;
  onRebuild: () => void;
  onWrite: (write: PlcWrite) => void;
  onClose: () => void;
  /** XAE edition: its own Login / Activate Configuration write it (no write here) */
  canWrite?: boolean;
  /** Close the XAE kept open for the next build now */
  onCloseXae?: () => Promise<boolean>;
}> = ({ state, onOpenItem, canOpen, onRebuild, onWrite, onClose, canWrite = true, onCloseXae }) => {
  const [xaeClosed, setXaeClosed] = useState(false);
  const [confirming, setConfirming] = useState<PlcWrite | null>(null);
  const [safe, setSafe] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const running = state.phase !== 'done';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !running) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, running]);
  useEffect(() => {
    setConfirming(null);
    setSafe(false);
    setXaeClosed(false);
  }, [state.result]);
  const r = state.result;
  const items = r?.items ?? [];
  const errors = items.filter((i) => i.level === 'error');
  const warnings = items.filter((i) => i.level === 'warning');
  const built = !!r && !r.fatal && errors.length === 0 && r.ok;
  const written = !!r?.written && r.ok;
  // (an online change refused, no build error: the download offered, with its own confirmation)
  const onlineRefused = !running && state.write === 'online' && !!r?.fatal && !r.written && errors.length === 0;
  const row = (i: PlcBuildItem, k: number) => {
    const open = canOpen(i);
    return (
      <button
        key={k}
        type="button"
        disabled={!open}
        className={`plc-build-item w-full flex items-start gap-2 px-2 py-1 rounded text-left ${open ? 'hover:bg-slate-800 cursor-pointer' : 'cursor-default'}`}
        data-level={i.level}
        onClick={() => open && onOpenItem(i)}
        title={open ? 'Open it at this line' : 'In another POU of the project (open it from the PLC to edit it)'}
      >
        {i.level === 'error' ? <XCircle className="w-3.5 h-3.5 mt-px text-rose-400 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-px text-amber-300 shrink-0" />}
        <span className="min-w-0">
          <span className={`block ${i.level === 'error' ? 'text-rose-100' : 'text-slate-200'}`}>{i.text.trim()}</span>
          <span className={`block font-mono text-[10px] ${open ? 'text-sky-300' : 'text-slate-500'}`}>{buildItemWhere(i)}</span>
        </span>
      </button>
    );
  };
  return (
    <div id="plc-build-dialog" role="dialog" aria-label="Build for the PLC" className="fixed right-4 top-20 z-[70] w-[560px] max-w-[94vw] max-h-[78vh] flex flex-col rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-800">
        <span className="flex items-center gap-2 font-semibold text-slate-100">
          <Hammer className="w-3.5 h-3.5 text-amber-300" />
          Build {state.project ?? 'the PLC project'}
          {state.target && <span className="text-[10px] font-normal text-slate-400 font-mono">{state.target}</span>}
        </span>
        <button onClick={onClose} disabled={running} className="p-0.5 text-slate-400 hover:text-white rounded disabled:opacity-40" title={running ? 'Running: wait for it to end' : 'Close (Esc)'}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="px-3 py-2 border-b border-slate-800 text-slate-400">
        {canWrite ? (
          <>
            The project as the PLC keeps it, with {state.files.length === 1 ? 'this file' : `these ${state.files.length} files`} as edited here: <span className="font-mono text-slate-300">{state.files.join(', ')}</span>. Built by TwinCAT XAE on this computer, in the background.
          </>
        ) : (
          <>The solution open in XAE, built by XAE (this POU's edits saved to the project first). To write it to the PLC: XAE's Login, or Activate Configuration.</>
        )}
      </div>
      <div id="plc-build-status" className="px-3 py-2 flex items-center gap-2" data-phase={state.phase} data-ok={r ? String(!!r.ok) : undefined}>
        {running ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-sky-300" />
            <span className="text-slate-200">{state.step ?? (state.phase === 'writing' ? 'Writing…' : 'Building…')}</span>
            <span className="text-slate-500">(opening a project in XAE takes a few minutes)</span>
          </>
        ) : r?.fatal ? (
          <>
            <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="text-rose-200">{r.fatal}</span>
          </>
        ) : written ? (
          <>
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-emerald-200">
              Written to the PLC ({WRITE_TEXT[r!.written!].label.toLowerCase()}){r?.plcState ? `: the PLC is ${r.plcState}` : ''}.{' '}
              {r?.verified ? (r.verified.ok ? `${r.verified.text}.` : <span className="text-amber-200">But: {r.verified.text}</span>) : 'From PLC reads the new sources.'}
            </span>
          </>
        ) : built ? (
          <>
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-emerald-200">Built: no errors{warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}.</span>
          </>
        ) : (
          <>
            <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="text-rose-200">
              {errors.length} error{errors.length === 1 ? '' : 's'}
              {warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}: fix them, then Build again.
            </span>
          </>
        )}
      </div>
      {!running && r?.xaeOpenUntil && !xaeClosed && (
        <div id="plc-build-xae" className="px-3 pb-2 -mt-1 flex items-center gap-2 text-slate-400">
          <span>
            XAE stays open with the project until {new Date(r.xaeOpenUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, so the next build is quicker.
          </span>
          {onCloseXae && (
            <button type="button" id="plc-build-xae-close" onClick={() => void onCloseXae().then(() => setXaeClosed(true))} className="px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">
              Close XAE now
            </button>
          )}
        </div>
      )}
      {!running && xaeClosed && (
        <div id="plc-build-xae-closed" className="px-3 pb-2 -mt-1 text-slate-500">XAE closed: the next build opens the project again.</div>
      )}
      {items.length > 0 && (
        <div className="overflow-y-auto px-2 pb-2 space-y-1 min-h-0">
          {errors.length > 0 && (
            <div id="plc-build-errors">
              <div className="px-1 pb-0.5 text-[10px] font-semibold text-rose-300 uppercase tracking-wide">Errors</div>
              {errors.map(row)}
            </div>
          )}
          {warnings.length > 0 && (
            <div id="plc-build-warnings">
              <button type="button" id="plc-build-warnings-toggle" onClick={() => setShowWarnings((v) => !v)} className="px-1 pb-0.5 text-[10px] font-semibold text-amber-300 uppercase tracking-wide hover:text-amber-200">
                {showWarnings ? '▾' : '▸'} Warnings ({warnings.length})
              </button>
              {showWarnings && warnings.map(row)}
            </div>
          )}
        </div>
      )}
      {confirming ? (
        <div id="plc-build-confirm" className="px-3 py-2 border-t border-slate-800 space-y-2" data-write={confirming}>
          <div className="font-semibold text-slate-100">{WRITE_TEXT[confirming].title}</div>
          <div className={`flex gap-2 ${confirming === 'activate' ? 'text-rose-200' : 'text-amber-200'}`}>
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              {WRITE_TEXT[confirming].warning} Target: <span className="font-mono">{state.target ?? 'the connected PLC'}</span>. Its sources are downloaded with it.
            </span>
          </div>
          {state.changes && (
            <div id="plc-build-changes" className="max-h-40 overflow-y-auto rounded bg-slate-950 border border-slate-800 px-2 py-1 font-mono text-[11px] space-y-1">
              <div className="font-sans text-slate-400">What changes on the PLC:</div>
              {state.changes.every((c) => !c.parts.length) && <div className="text-slate-500">Nothing: the same code as the PLC's.</div>}
              {state.changes
                .filter((c) => c.parts.length)
                .map((c) => (
                  <div key={c.file} className="plc-build-change" data-file={c.file}>
                    <div className="text-sky-200">{c.file}</div>
                    {c.parts.map((p) => (
                      <div key={p.part} className="pl-2">
                        <span className="text-slate-300">{p.part}:</span> <span className="text-slate-500">{p.only ? (p.only === 'after' ? 'new' : 'removed') : `${p.added} line${p.added === 1 ? '' : 's'} in, ${p.removed} out`}</span>
                        {p.rows.filter((r) => /^[+-]/.test(r)).slice(0, 12).map((r, i) => (
                          <div key={i} className={`pl-2 whitespace-pre ${r.startsWith('+') ? 'text-emerald-300' : 'text-rose-300'}`}>{r}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-slate-200">
            <input id="plc-build-safe" type="checkbox" checked={safe} onChange={(e) => setSafe(e.target.checked)} />
            The machine is safe for this, and I may change its PLC
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirming(null)} className="px-3 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">
              Cancel
            </button>
            <button
              type="button"
              id="plc-build-confirm-btn"
              disabled={!safe}
              onClick={() => onWrite(confirming)}
              className={`px-3 py-1 rounded text-white disabled:opacity-40 ${confirming === 'activate' ? 'bg-rose-700 hover:bg-rose-600' : 'bg-amber-700 hover:bg-amber-600'}`}
            >
              {WRITE_TEXT[confirming].label}
            </button>
          </div>
        </div>
      ) : (
        <div className="px-3 py-2 border-t border-slate-800 flex items-center justify-end gap-2">
          <button type="button" id="plc-build-again" disabled={running} onClick={onRebuild} className="px-3 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40">
            Build again
          </button>
          {onlineRefused && canWrite && (
            <>
              <button type="button" id="plc-build-activate" onClick={() => setConfirming('activate')} className="px-3 py-1 rounded border border-rose-800 text-rose-200 hover:bg-slate-800" title="Activate the configuration: TwinCAT restarts (the PLC stops)">
                Activate configuration…
              </button>
              <button type="button" id="plc-build-download" onClick={() => setConfirming('download')} className="flex items-center gap-1 px-3 py-1 rounded bg-rose-800 hover:bg-rose-700 text-white" title="Download: the PLC application stops, takes the new code and starts again">
                <Upload className="w-3.5 h-3.5" /> Download…
              </button>
            </>
          )}
          {built && !written && canWrite && (
            <>
              <button type="button" id="plc-build-activate" onClick={() => setConfirming('activate')} className="px-3 py-1 rounded border border-rose-800 text-rose-200 hover:bg-slate-800" title="Activate the configuration: TwinCAT restarts (the PLC stops)">
                Activate configuration…
              </button>
              <button type="button" id="plc-build-online" onClick={() => setConfirming('online')} className="flex items-center gap-1 px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white" title="Online change: the PLC keeps running">
                <Upload className="w-3.5 h-3.5" /> Write to PLC…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
