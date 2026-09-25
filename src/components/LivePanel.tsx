import React, { useEffect, useState } from 'react';
import { Radio, Play, Square, Trash2, History, Crosshair, AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';
import { LiveSession, formatClock, formatDuration } from '../utils/liveView.ts';

export interface LiveStatus {
  state: 'idle' | 'connecting' | 'connected' | 'error' | 'lost' | 'stopped';
  message?: string;
  target?: string;
  plcState?: string;
  instance?: string;
  instances: string[];
}

export interface LiveSettings {
  instance: string;
  netId: string;
  port: string;
}

interface LivePanelProps {
  /** Running in TwinCAT XAE with a POU from an open TwinCAT project */
  available: boolean;
  stateVar: string;
  status: LiveStatus;
  session: LiveSession;
  hasEnumNames: boolean;
  settings: LiveSettings;
  onSettingsChange: (settings: LiveSettings) => void;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
  onSelectState: (stateId: string) => void;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
  onOpenHistory: () => void;
}

const MAX_SHOWN = 200;

export const LivePanel: React.FC<LivePanelProps> = ({
  available,
  stateVar,
  status,
  session,
  hasEnumNames,
  settings,
  onSettingsChange,
  onStart,
  onStop,
  onClear,
  onSelectState,
  follow,
  onFollowChange,
  onOpenHistory,
}) => {
  const running = status.state === 'connecting' || status.state === 'connected';
  // Time in the current state ticks while connected
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status.state !== 'connected') return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [status.state]);

  if (!available) {
    return (
      <div id="live-panel" className="flex-1 min-h-0 w-full bg-slate-900 flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-slate-400">
        <Radio className="w-7 h-7 text-slate-600" />
        <p>The live view follows the state machine in the running PLC.</p>
        <p className="text-slate-500">
          It needs Kval StateScope inside TwinCAT XAE, with the POU opened from a TwinCAT project.
        </p>
      </div>
    );
  }

  const inState = session.current ? Math.max(0, now - (session.clockOffset ?? 0) - session.current.since) : 0;
  const shown = session.transitions.slice(-MAX_SHOWN).reverse();
  const statusColor =
    status.state === 'connected'
      ? 'text-emerald-300'
      : status.state === 'error' || status.state === 'lost'
        ? 'text-rose-300'
        : status.state === 'connecting'
          ? 'text-sky-300'
          : 'text-slate-400';

  return (
    <div id="live-panel" className="flex-1 min-h-0 w-full bg-slate-900 flex flex-col text-xs">
      {/* Connection */}
      <div className="p-2.5 border-b border-slate-800 space-y-2 shrink-0">
        <div className="flex items-center gap-2">
          {running ? (
            <button
              id="live-stop-btn"
              onClick={onStop}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-700/80 hover:bg-rose-600 text-white font-semibold"
            >
              <Square className="w-3 h-3" /> Stop
            </button>
          ) : (
            <button
              id="live-start-btn"
              onClick={onStart}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-700/80 hover:bg-emerald-600 text-white font-semibold"
              title={`Follow ${stateVar} in the running PLC`}
            >
              <Play className="w-3 h-3" /> Go live
            </button>
          )}
          <span id="live-status" className={`flex items-center gap-1 min-w-0 ${statusColor}`} title={status.message}>
            {status.state === 'connecting' && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
            {status.state === 'connected' && <span className="live-dot shrink-0" />}
            <span className="truncate">{status.message || 'Not connected'}</span>
          </span>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 items-center">
          <label htmlFor="live-instance-input" className="text-slate-400">
            Instance
          </label>
          <div className="flex gap-1 min-w-0">
            <input
              id="live-instance-input"
              list="live-instance-options"
              value={settings.instance}
              onChange={(e) => onSettingsChange({ ...settings, instance: e.target.value })}
              placeholder="found in the project (e.g. MAIN.fbLine.smTable)"
              className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
            />
            <datalist id="live-instance-options">
              {status.instances.map((i) => (
                <option key={i} value={i} />
              ))}
            </datalist>
          </div>
          <label htmlFor="live-netid-input" className="text-slate-400">
            Target
          </label>
          <div className="flex gap-1 min-w-0">
            <input
              id="live-netid-input"
              value={settings.netId}
              onChange={(e) => onSettingsChange({ ...settings, netId: e.target.value })}
              placeholder="XAE's target (AMS NetId)"
              className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
            />
            <input
              id="live-port-input"
              value={settings.port}
              onChange={(e) => onSettingsChange({ ...settings, port: e.target.value.replace(/\D/g, '') })}
              placeholder="port"
              title="ADS port of the PLC runtime (empty: from the project, usually 851)"
              className="w-14 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
            />
          </div>
        </div>
        {status.instances.length > 1 && status.state === 'connected' && (
          <div className="text-[11px] text-slate-500">
            {status.instances.length} instances in the PLC: pick one above and go live again to switch.
          </div>
        )}
      </div>

      {/* Current state */}
      <div className="p-2.5 border-b border-slate-800 shrink-0">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Current state</div>
        {session.current ? (
          <div className="flex items-center gap-2">
            <button
              id="live-current-state"
              onClick={() => onSelectState(session.current!.state)}
              className="font-mono font-bold text-sm text-emerald-300 hover:text-emerald-200 truncate"
              title="Show in the diagram"
            >
              {session.current.state}
            </button>
            <span className="text-slate-500 font-mono">= {session.current.value}</span>
            <span id="live-time-in-state" className="ml-auto text-slate-300 font-mono">
              {formatDuration(inState)}
            </span>
          </div>
        ) : (
          <div className="text-slate-500">—</div>
        )}
        {!hasEnumNames && session.current && (
          <div className="mt-1 text-[11px] text-amber-300/80">Load the .TcDUT enum to see state names instead of numbers.</div>
        )}
      </div>

      {/* Trail */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-slate-800 shrink-0">
        <span className="text-slate-300 font-semibold">Transitions</span>
        <span className="text-slate-500">{session.transitions.length}</span>
        {session.unexpected > 0 && (
          <span id="live-unexpected-count" className="flex items-center gap-1 px-1.5 rounded-full bg-rose-950/70 text-rose-300 border border-rose-800 text-[10px]">
            <AlertTriangle className="w-3 h-3" /> {session.unexpected} not in diagram
          </span>
        )}
        <label className="ml-auto flex items-center gap-1 text-slate-400 cursor-pointer" title="Pan the diagram to the active state">
          <input id="live-follow-toggle" type="checkbox" checked={follow} onChange={(e) => onFollowChange(e.target.checked)} />
          <Crosshair className="w-3 h-3" /> Follow
        </label>
        <button
          id="live-history-btn"
          onClick={onOpenHistory}
          disabled={session.transitions.length === 0}
          className="p-1 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800 disabled:opacity-40"
          title="Open these transitions in Transition History"
        >
          <History className="w-3.5 h-3.5" />
        </button>
        <button
          id="live-clear-btn"
          onClick={onClear}
          className="p-1 rounded text-slate-400 hover:text-rose-300 hover:bg-slate-800"
          title="Clear the transitions"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div id="live-trail" className="flex-1 min-h-0 overflow-y-auto">
        {shown.length === 0 ? (
          <div className="p-4 text-center text-slate-500">{running ? 'Waiting for a transition...' : 'No transitions yet'}</div>
        ) : (
          shown.map((tr, i) => (
            <div
              key={`${tr.t}-${i}`}
              className={`live-trail-row flex items-center gap-1.5 px-2.5 py-1 border-b border-slate-800/60 font-mono text-[11px] ${
                tr.inModel ? '' : 'bg-rose-950/30'
              }`}
              title={tr.inModel ? undefined : 'This transition is not in the diagram'}
            >
              <span className="text-slate-500 shrink-0">{formatClock(tr.t)}</span>
              <button onClick={() => onSelectState(tr.from)} className="text-slate-400 hover:text-sky-300 truncate min-w-0" title={tr.from}>
                {tr.from}
              </button>
              <ArrowRight className={`w-3 h-3 shrink-0 ${tr.inModel ? 'text-slate-500' : 'text-rose-400'}`} />
              <button onClick={() => onSelectState(tr.to)} className="text-slate-200 hover:text-sky-300 truncate min-w-0" title={tr.to}>
                {tr.to}
              </button>
              <span className="ml-auto text-slate-500 shrink-0" title={`Time in ${tr.from}`}>
                {formatDuration(tr.dwellMs)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
