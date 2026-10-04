import React, { useEffect, useRef, useState } from 'react';
import { Radio, Play, Square, Trash2, History, Crosshair, AlertTriangle, ArrowRight, Loader2, Layers, ExternalLink, ListTree, FolderDown, Hammer, LayoutGrid, Search, Download, FolderOpen, Pause, Database, Timer, GitCompare, ShieldCheck, Stethoscope } from 'lucide-react';
import { PlcBrowser, useRememberedChecks, type PickedPlc } from './PlcBrowser.tsx';
import type { StateTime } from '../utils/stateTimes.ts';
import { ipFieldFor, type AddRouteBoth, type AddRouteResult, type FoundPlc, type PlcScanResult, type RememberedPlc } from '../utils/plcDiscovery.ts';
import { checkAsText, firewallCommands, type CheckRequest, type CheckResult } from '../utils/connectionCheck.ts';
import { LiveSession, formatClock, formatDuration } from '../utils/liveView.ts';
import { sameInstance } from '../utils/instanceLaunch.ts';
import { formatLimit, notifyStuck, parseDuration } from '../utils/stateLimits.ts';
import type { EdgeGuardView } from '../utils/liveGuards.ts';
import { versionWarning } from '../utils/twincatVersions.ts';

export interface LiveStatus {
  state: 'idle' | 'connecting' | 'connected' | 'error' | 'lost' | 'stopped';
  message?: string;
  target?: string;
  plcState?: string;
  instance?: string;
  instances: string[];
  /** Desktop: the AMS NetId / IP this computer uses towards the PLC (the PLC needs a route for them) */
  route?: { localNetId: string; localIp: string };
  /** Nothing on the chosen ADS port: the ports that have a PLC */
  ports?: { port: number; state: string }[];
  /** XAE: the PLC's TwinCAT build and the XAE's (null: not known) */
  versions?: { plc: number | null; xae: number | null };
  /** Web edition: the PLCs the gateway offers, and who is signed in */
  plcs?: { id: string; name: string }[];
  user?: string;
}

export interface LiveSettings {
  instance: string;
  netId: string;
  port: string;
  /** Desktop: the PLC's IP (empty: from the NetId) */
  ip: string;
  /** Desktop: this computer's AMS NetId (empty: its IP + .1.1) */
  localNetId: string;
  /** Web edition: the gateway's address (empty: the gateway this page is served by) */
  gateway: string;
  /** Web edition: the gateway's PLC id */
  plc: string;
  /** Web edition: through the local helper on this computer (Kval MachineScope Link) or a gateway */
  via: 'link' | 'gateway' | '';
  /** Web edition: the local helper's port (empty: 48960) */
  linkPort: string;
}

interface LivePanelProps {
  /** The variables watched from the code (right-click > Watch in Live), with their values */
  watchList?: { name: string; value?: boolean | number | string }[];
  onUnwatch?: (name: string) => void;
  /**
   * xae: TwinCAT XAE with a POU from an open TwinCAT project; desktop: the desktop app (ADS straight to the PLC);
   * web: the web edition, through the local helper (Kval MachineScope Link) or a gateway (settings.via)
   */
  mode: 'xae' | 'desktop' | 'web' | null;
  /** Web edition: "link" or "gateway" when settings.via is not chosen yet */
  defaultVia?: 'link' | 'gateway';
  /** Web edition: the gateway serving this page (its default address) */
  gatewayOrigin?: string | null;
  /** Web edition: the gateway access token or the helper's pairing code, and whether it is remembered here */
  token?: string;
  onTokenChange?: (token: string) => void;
  rememberToken?: boolean;
  onRememberTokenChange?: (remember: boolean) => void;
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
  /** Guard values: the active state's transitions, every transition, or none */
  guardScope?: 'active' | 'all' | 'off';
  onGuardScopeChange?: (scope: 'active' | 'all' | 'off') => void;
  /** The active state's transitions with their guard result and values */
  guards?: (EdgeGuardView & { edgeId: string; to: string })[];
  /** Measured state times of the session (live or a replay), and whether the diagram shows them */
  stateTimes?: StateTime[];
  showStateTimes?: boolean;
  onShowStateTimesChange?: (on: boolean) => void;
  onExportStateTimes?: () => void;
  /** Path checks: keep this session's transitions as one; the kept ones with the transitions the diagram lacks */
  onKeepPathCheck?: () => void;
  pathChecks?: { id: string; name: string; transitions: number; missing: string[] }[];
  onRemovePathCheck?: (id: string) => void;
  /** Compare two recordings */
  onCompare?: () => void;
  /** During a replay: the recorded variables over time (a small chart each, the position marked) */
  replayVars?: { id: string; points: { t: number; v: number | boolean | string | null }[] }[];
  /** The remembered PLCs that answer on the network (null: not checked) */
  reachable?: Record<string, boolean | null>;
  /** Another instance of the POU in its own tab / window, live (a POU can be declared several times) */
  onOpenInstance?: (instance: string) => void;
  /** What Open makes: a tab (XAE, web) or a window (desktop) */
  openTarget?: 'tab' | 'window';
  /** Opens the Symbols window (the PLC's symbols and values) */
  onOpenSymbols?: () => void;
  /** A POU of the PLC's own sources (the project downloaded with its sources) opened here */
  onOpenFromPlc?: () => void;
  /** From PLC offered before going live too (a target entered: its sources read from its boot folder) */
  fromPlcOffline?: boolean;
  /** The POU from the PLC's sources, edited here: the PLC's project rebuilt with it, then written back */
  onBuildForPlc?: () => void;
  /** Build without a live connection (XAE edition: XAE's own project) */
  buildOffline?: boolean;
  /** This POU against the PLC's version (its sources), side by side */
  onCompareWithPlc?: () => void;
  /** The last build's result (its dialog closed): reopened */
  lastBuild?: { text: string; ok: boolean; onOpen: () => void };
  /** Opens the Machine Overview tab */
  onOpenOverview?: () => void;
  /** Stuck-state alert: the current state's time limit (ms; its own or the default), and whether it is over it */
  limitMs?: number | null;
  /** The current state's own limit (ms; null: none) and how to set it */
  stateLimitMs?: number | null;
  onStateLimitChange?: (ms: number | null) => void;
  defaultLimitMs?: number | null;
  onDefaultLimitChange?: (ms: number | null) => void;
  notify?: boolean;
  onNotifyChange?: (on: boolean) => void;
  /** The PLCs remembered in this app (any POU), newest first; Remember adds the target (name: from Browse) */
  rememberedPlcs?: RememberedPlc[];
  onRememberPlc?: (remember: boolean, name?: string, found?: { twincat?: string; os?: string }) => void;
  /** A Browse search's result: the remembered PLCs kept up to date */
  onPlcsFound?: (r: PlcScanResult) => void;
  onForgetPlc?: (netId: string) => void;
  /** Browse: searches the network for PLCs (desktop, XAE) */
  onScanPlcs?: (addresses: string[]) => Promise<PlcScanResult>;
  /** The PLC's TwinCAT trial license ran out, or runs out soon */
  licenseNotice?: { state: 'expired' | 'soon'; text: string } | null;
  /** The license read again (after renewing it) */
  onRecheckLicense?: () => void;
  /** TwinCAT XAE opened on this computer (desktop, Link): its license page renews a trial */
  onOpenXae?: () => Promise<{ ok: boolean; message: string }>;
  /** The PLC application started (live, the PLC in Stop; after a confirmation) */
  onStartPlc?: () => Promise<{ state: string | null; ok: boolean; error?: string }>;
  /** Link on this computer is another version than this page: what to do */
  linkNotice?: string | null;
  /** Check any PLC (Browse: Check all, the remembered ones) */
  onCheckPlc?: (req: CheckRequest) => Promise<CheckResult>;
  /** Check: why the PLC does not answer, step by step (desktop, Link) */
  onCheckConnection?: () => Promise<CheckResult>;
  /** Browse: Add Route to a found PLC (desktop, Link, XAE) */
  onAddRoute?: (plc: FoundPlc, user: string, password: string, both?: AddRouteBoth) => Promise<AddRouteResult>;
  onRenamePlc?: (netId: string, name: string) => void;
  /** The PLC switcher while live: stop, then go live on that remembered PLC */
  onSwitchPlc?: (plc: RememberedPlc) => void;
  /** Recording: the session so far to a file; a recording played back (replay: its position, PLC time) */
  canSaveRecording?: boolean;
  onSaveRecording?: () => void;
  onOpenRecording?: (file: File) => void;
  /** Web edition through a gateway: replay a machine's time window from the gateway's recordings */
  onOpenGatewayRecordings?: () => void;
  replay?: { file: string; from: number; to: number; pos: number; playing: boolean; speed: number; samples: number };
  onReplayPlay?: (playing: boolean) => void;
  onReplaySeek?: (pos: number) => void;
  onReplaySpeed?: (speed: number) => void;
  /** Web edition, the gateway serving this page: sign-in with company accounts (who is signed in; tokens accepted too) */
  sso?: { provider: string; user: string | null; name: string | null; tokens: boolean };
  onSignIn?: () => void;
  onSignOut?: () => void;
  /** Web edition through a gateway: the operator board's address */
  boardUrl?: string;
}

const REPLAY_SPEEDS = [1, 2, 5, 10, 60, 600];

/** A recorded variable over the replay's span: steps (booleans high / low, numbers scaled), the position marked */
const ReplayVarChart: React.FC<{ id: string; points: { t: number; v: number | boolean | string | null }[]; from: number; to: number; pos: number }> = ({ id, points, from, to, pos }) => {
  const w = 200;
  const h = 16;
  const num = (v: number | boolean | string | null) => (typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? v : null);
  const nums = points.map((p) => num(p.v)).filter((x): x is number => x !== null);
  const lo = Math.min(...nums, 0);
  const hi = Math.max(...nums, 1);
  const x = (t: number) => ((Math.max(from, Math.min(to, t)) - from) / (to - from)) * w;
  const y = (v: number) => h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4);
  let d = '';
  let last: number | null = null;
  for (const p of points) {
    const v = num(p.v);
    if (v === null) continue;
    d += last === null ? `M${x(p.t).toFixed(1)},${y(v).toFixed(1)}` : `H${x(p.t).toFixed(1)}V${y(v).toFixed(1)}`;
    last = v;
  }
  if (last !== null) d += `H${w}`;
  const now = [...points].reverse().find((p) => p.t <= pos);
  return (
    <div className="live-replay-var flex items-center gap-1.5 text-[10px]" data-var={id}>
      <span className="w-28 truncate font-mono text-slate-400" title={id}>{id}</span>
      <svg width={w} height={h} className="shrink-0 bg-slate-950/60 rounded">
        <path d={d} fill="none" stroke="#a78bfa" strokeWidth="1.2" />
        <line x1={x(pos)} x2={x(pos)} y1="0" y2={h} stroke="#f472b6" strokeWidth="1" />
      </svg>
      <span className="live-replay-var-value font-mono text-violet-200 truncate">{now ? String(now.v) : ''}</span>
    </div>
  );
};

/** A duration field ("30", "1.5 s", "2 min"): applied on Enter or when it loses focus; empty clears it */
const LimitField: React.FC<{ id: string; valueMs: number | null | undefined; onChange: (ms: number | null) => void; placeholder: string; title: string }> = ({ id, valueMs, onChange, placeholder, title }) => {
  const [text, setText] = useState(formatLimit(valueMs ?? null));
  useEffect(() => setText(formatLimit(valueMs ?? null)), [valueMs]);
  const commit = () => {
    const ms = text.trim() ? parseDuration(text) : null;
    if (text.trim() && ms === null) {
      setText(formatLimit(valueMs ?? null));
      return;
    }
    if (ms !== (valueMs ?? null)) onChange(ms);
    setText(formatLimit(ms));
  };
  return (
    <input
      id={id}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
      placeholder={placeholder}
      title={title}
      className="w-20 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
    />
  );
};

const GUARD_BADGE = {
  true: { symbol: '\u2713', cls: 'bg-emerald-400 text-slate-950', word: 'TRUE' },
  false: { symbol: '\u2717', cls: 'bg-slate-500 text-slate-950', word: 'FALSE' },
  unknown: { symbol: '?', cls: 'bg-amber-400 text-slate-950', word: 'unknown' },
} as const;

const MAX_SHOWN = 200;

export const LivePanel: React.FC<LivePanelProps> = ({
  watchList,
  onUnwatch,
  mode,
  defaultVia = 'link',
  gatewayOrigin,
  token = '',
  onTokenChange,
  rememberToken = false,
  onRememberTokenChange,
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
  guardScope = 'active',
  onGuardScopeChange,
  guards = [],
  stateTimes = [],
  showStateTimes = false,
  onShowStateTimesChange,
  onExportStateTimes,
  onKeepPathCheck,
  pathChecks = [],
  onRemovePathCheck,
  onCompare,
  replayVars = [],
  reachable = {},
  onOpenInstance,
  openTarget = 'window',
  onOpenSymbols,
  onOpenFromPlc,
  fromPlcOffline,
  onBuildForPlc,
  buildOffline,
  onCompareWithPlc,
  lastBuild,
  onOpenOverview,
  limitMs,
  stateLimitMs,
  onStateLimitChange,
  defaultLimitMs,
  onDefaultLimitChange,
  notify = false,
  onNotifyChange,
  rememberedPlcs = [],
  onRememberPlc,
  onPlcsFound,
  onForgetPlc,
  onScanPlcs,
  onAddRoute,
  onCheckConnection,
  onCheckPlc,
  linkNotice,
  licenseNotice,
  onRecheckLicense,
  onOpenXae,
  onStartPlc,
  onRenamePlc,
  onSwitchPlc,
  canSaveRecording = false,
  onSaveRecording,
  onOpenRecording,
  onOpenGatewayRecordings,
  replay,
  onReplayPlay,
  onReplaySeek,
  onReplaySpeed,
  sso,
  onSignIn,
  onSignOut,
  boardUrl,
}) => {
  const running = status.state === 'connecting' || status.state === 'connected';
  // The instance this window follows (or will), and the others the PLC has
  const following = status.state === 'connected' || status.state === 'lost' ? status.instance ?? settings.instance : settings.instance || status.instances[0];
  const others = status.instances.filter((i) => !sameInstance(i, following));
  const via = settings.via || defaultVia;
  const viaGateway = mode === 'web' && via === 'gateway';
  // ADS from this computer: the desktop app, or the web edition through the local helper
  const direct = mode === 'desktop' || (mode === 'web' && via === 'link');
  // The State times table: open or collapsed
  const [timesOpen, setTimesOpen] = useState(true);
  // Browse: the list of PLCs, and the name of the one picked from it (for Remember)
  const [browsing, setBrowsing] = useState(false);
  // Check all (Browse), kept here: its timer runs while Browse is closed; the PLCs that stopped answering
  const checker = useRememberedChecks(rememberedPlcs, onCheckPlc);
  const lostPlcs = rememberedPlcs.filter((p) => p.netId in checker.lost);
  // (Notify on: a notification too, once each time one stops answering)
  const notifiedLost = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!notify) return;
    for (const p of rememberedPlcs) {
      const since = checker.lost[p.netId];
      if (!since || notifiedLost.current[p.netId] === since) continue;
      notifiedLost.current[p.netId] = since;
      void notifyStuck(`Kval MachineScope: ${p.name || p.netId} stopped answering`, `Since ${new Date(since).toLocaleTimeString()}: ${checker.checks[p.netId]?.verdict ?? 'it no longer answers'}`, `kss-plc-lost-${p.netId}`);
    }
  }, [checker.lost, checker.checks, notify, rememberedPlcs]);
  // The license notice's Renew: the steps shown, what Open XAE said
  const [renewing, setRenewing] = useState(false);
  // Start the PLC (live, in Stop): asked (its box), running, what it did
  const [startPlc, setStartPlc] = useState<{ phase: 'ask' | 'running' | 'done'; safe: boolean; text?: string; ok?: boolean } | null>(null);
  useEffect(() => {
    if (status.plcState === 'Run' && startPlc?.phase !== 'done') setStartPlc(null);
  }, [status.plcState, startPlc?.phase]);
  const [xaeOpened, setXaeOpened] = useState('');
  // The connection check: running (no result yet) or its steps
  const [checking, setChecking] = useState<{ result: CheckResult | null } | null>(null);
  const [checkCopied, setCheckCopied] = useState('');
  const [pickedName, setPickedName] = useState<{ netId: string; name: string; twincat?: string; os?: string } | null>(null);
  const netIdNow = settings.netId.trim();
  const remembered = rememberedPlcs.some((p) => p.netId === netIdNow);
  const canBrowse = !viaGateway && (!!onScanPlcs || rememberedPlcs.length > 0);
  const pickPlc = (p: PickedPlc) => {
    onSettingsChange({
      ...settings,
      netId: p.netId,
      ip: mode === 'xae' ? settings.ip : ipFieldFor(p.netId, p.ip),
      port: p.port ?? settings.port,
      localNetId: p.localNetId ?? settings.localNetId,
    });
    setPickedName({ netId: p.netId, name: p.name, twincat: p.twincat, os: p.os });
    setBrowsing(false);
  };
  // Time in the current state ticks while connected
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // (a paused replay: the time in state stands still)
    if (status.state !== 'connected' || (replay && !replay.playing)) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [status.state, replay?.playing, !!replay]);

  if (!mode) {
    return (
      <div id="live-panel" className="flex-1 min-h-0 w-full bg-slate-900 flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-slate-400">
        <Radio className="w-7 h-7 text-slate-600" />
        <p>The live view follows the state machine in the running PLC.</p>
        <p className="text-slate-500">
          Inside TwinCAT XAE, open the POU from a TwinCAT project to use it.
        </p>
      </div>
    );
  }

  const inState = session.current ? Math.max(0, now - (session.clockOffset ?? 0) - session.current.since) : 0;
  const stuck = status.state === 'connected' && !!limitMs && !!session.current && inState > limitMs;
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
          {/* XAE: the PLC's TwinCAT build beside this XAE's; amber when they are not of one family (4024 / 4026) */}
          {status.state === 'connected' && status.versions?.plc && (() => {
            const warn = versionWarning(status.versions.plc, status.versions.xae);
            return (
              <span id="live-versions" data-plc={status.versions.plc} data-xae={status.versions.xae ?? undefined} data-warn={warn ? 'true' : undefined} className={`shrink-0 px-1.5 rounded border text-[11px] ${warn ? 'border-amber-500/70 bg-amber-950/60 text-amber-200' : 'border-slate-700 text-slate-400'}`} title={warn ?? `The PLC runs TwinCAT 3.1.${status.versions.plc}${status.versions.xae ? `; this XAE is TwinCAT ${status.versions.xae}'s` : ''}`}>
                {warn ? '⚠ ' : ''}TwinCAT 3.1.{status.versions.plc}{status.versions.xae ? ` · XAE ${status.versions.xae}` : ''}
              </span>
            );
          })()}
          {status.state === 'connected' && status.plcState === 'Stop' && onStartPlc && !startPlc && (
            <button type="button" id="live-start-plc" onClick={() => setStartPlc({ phase: 'ask', safe: false })} className="shrink-0 px-1.5 rounded bg-emerald-800 hover:bg-emerald-700 text-white text-[11px]" title="The PLC application is in Stop: start it (asks first)">
              Start PLC…
            </button>
          )}
          {startPlc && (
            <span id="live-start-plc-panel" className="shrink-0 flex items-center gap-1.5 text-[11px]" data-phase={startPlc.phase}>
              {startPlc.phase === 'ask' && (
                <>
                  <span className="text-amber-200">Its outputs act on the machine at once.</span>
                  <label className="flex items-center gap-1 text-slate-200">
                    <input id="live-start-plc-safe" type="checkbox" checked={startPlc.safe} onChange={(e) => setStartPlc({ ...startPlc, safe: e.target.checked })} /> Safe to start
                  </label>
                  <button
                    type="button"
                    id="live-start-plc-confirm"
                    disabled={!startPlc.safe}
                    onClick={() => {
                      setStartPlc({ phase: 'running', safe: true });
                      void onStartPlc!()
                        .catch((e: unknown) => ({ state: null, ok: false, error: e instanceof Error ? e.message : String(e) }))
                        .then((r) => setStartPlc({ phase: 'done', safe: true, ok: r.ok, text: r.ok ? 'Started: the PLC runs.' : r.error ?? `The PLC is in ${r.state ?? '?'}` }));
                    }}
                    className="px-1.5 rounded bg-emerald-800 hover:bg-emerald-700 text-white disabled:opacity-40"
                  >
                    Start
                  </button>
                  <button type="button" onClick={() => setStartPlc(null)} className="px-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
                </>
              )}
              {startPlc.phase === 'running' && <><Loader2 className="w-3 h-3 animate-spin" /> Starting…</>}
              {startPlc.phase === 'done' && (
                <span id="live-start-plc-result" data-ok={String(startPlc.ok)} className={startPlc.ok ? 'text-emerald-300' : 'text-rose-300'}>
                  {startPlc.text}{' '}
                  <button type="button" onClick={() => setStartPlc(null)} className="underline text-slate-400">OK</button>
                </span>
              )}
            </span>
          )}
          {status.state === 'error' && status.ports && status.ports.length > 0 && !viaGateway && (
            <span id="live-ports" className="shrink-0 flex items-center gap-1">
              {status.ports.map((x) => (
                <button key={x.port} type="button" className="live-port-use px-1.5 rounded bg-sky-800 hover:bg-sky-700 text-sky-50 text-[11px]" data-port={x.port} onClick={() => onSettingsChange({ ...settings, port: String(x.port) })} title={`Its PLC on ADS port ${x.port} (${x.state}): use it, then Go live`}>
                  Use port {x.port}
                </button>
              ))}
            </span>
          )}
          {/* One click to another remembered PLC (while live: stops and goes live on it) */}
          {!viaGateway && rememberedPlcs.length > 1 && (
            <select
              id="live-plc-quick"
              value={remembered ? netIdNow : ''}
              onChange={(e) => {
                const p = rememberedPlcs.find((x) => x.netId === e.target.value);
                if (!p) return;
                if (running && onSwitchPlc) onSwitchPlc(p);
                else pickPlc({ name: p.name, netId: p.netId, ip: p.ip, port: p.port, localNetId: p.localNetId });
              }}
              title={running ? 'Switch to another remembered PLC (goes live on it)' : 'Use another remembered PLC'}
              className="shrink-0 max-w-[10rem] bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[11px] text-slate-200"
            >
              {!remembered && <option value="">PLC...</option>}
              {rememberedPlcs.map((p) => (
                <option key={p.netId} value={p.netId}>
                  {reachable[p.netId] === true ? '● ' : reachable[p.netId] === false ? '○ ' : ''}
                  {p.name}
                  {reachable[p.netId] === false ? ' (not answering)' : ''}
                </option>
              ))}
            </select>
          )}
          {onOpenOverview && status.state === 'connected' && (
            <button
              id="live-overview-btn"
              onClick={onOpenOverview}
              className="ml-auto shrink-0 flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 text-slate-300 hover:text-sky-300 hover:bg-slate-800"
              title="Every state machine of the PLC with its current state (Machine Overview tab)"
            >
              <LayoutGrid className="w-3 h-3" /> Overview
            </button>
          )}
          {onOpenSymbols && status.state === 'connected' && (
            <button
              id="live-symbols-btn"
              onClick={onOpenSymbols}
              className={`${onOpenOverview ? '' : 'ml-auto '}shrink-0 flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 text-slate-300 hover:text-sky-300 hover:bg-slate-800`}
              title="Browse the PLC's symbols and their values; watch another state machine"
            >
              <ListTree className="w-3 h-3" /> Symbols
            </button>
          )}
          {onOpenFromPlc && (status.state === 'connected' || fromPlcOffline) && (
            <button
              id="live-open-from-plc-btn"
              onClick={onOpenFromPlc}
              className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 text-slate-300 hover:text-sky-300 hover:bg-slate-800"
              title={`Open a POU of the PLC's own sources (the project downloaded with its sources, as XAE's Open from Target reads them)${status.state === 'connected' ? '' : ': read from the Target, not live (its PLC need not run); go live on it afterwards'}`}
            >
              <FolderDown className="w-3 h-3" /> From PLC
            </button>
          )}
          {onCompareWithPlc && status.state === 'connected' && (
            <button
              id="live-compare-plc-btn"
              onClick={onCompareWithPlc}
              className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 text-slate-300 hover:text-sky-300 hover:bg-slate-800"
              title="This POU against the PLC's version of it (the sources it keeps), side by side"
            >
              <GitCompare className="w-3 h-3" /> vs PLC
            </button>
          )}
          {lastBuild && (
            <button
              id="live-last-build-btn"
              onClick={lastBuild.onOpen}
              className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] hover:bg-slate-800 ${lastBuild.ok ? 'border-emerald-800 text-emerald-300' : 'border-rose-800 text-rose-300'}`}
              title="The last build's messages (its errors open at their line)"
            >
              Last build: {lastBuild.text}
            </button>
          )}
          {onBuildForPlc && (status.state === 'connected' || buildOffline) && (
            <button
              id="live-build-btn"
              onClick={onBuildForPlc}
              className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md border border-amber-700/70 text-amber-200 hover:text-amber-100 hover:bg-slate-800"
              title="Rebuild the PLC's project with this POU as edited here (TwinCAT XAE on this computer), review its errors, then write it to the PLC"
            >
              <Hammer className="w-3 h-3" /> Build…
            </button>
          )}
        </div>
        {/* Recording: save the session so far; play a recording back */}
        {(canSaveRecording || (onOpenRecording && !running) || onKeepPathCheck) && (!replay || onKeepPathCheck) && (
          <div className="flex items-center gap-2">
            {canSaveRecording && onSaveRecording && (
              <button
                id="live-save-recording"
                onClick={onSaveRecording}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-700 text-[11px] text-slate-300 hover:text-sky-300 hover:bg-slate-800"
                title="Save this session's recording (state changes and guard values, with PLC time) to a file"
              >
                <Download className="w-3 h-3" /> Save recording
              </button>
            )}
            {onOpenRecording && !running && (
              <label
                className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-700 text-[11px] text-slate-300 hover:text-sky-300 hover:bg-slate-800 cursor-pointer"
                title="Play a saved recording back on the diagram, as if live"
              >
                <FolderOpen className="w-3 h-3" /> Replay...
                <input
                  id="live-open-recording"
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) onOpenRecording(f);
                  }}
                />
              </label>
            )}
            {onCompare && (
              <button id="live-compare" onClick={onCompare} className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-700 text-[11px] text-slate-300 hover:text-sky-300 hover:bg-slate-800" title="Compare two recordings (or this session with one): time per state, transitions only one took">
                <GitCompare className="w-3 h-3" /> Compare...
              </button>
            )}
            {onKeepPathCheck && (
              <button id="live-keep-path" onClick={onKeepPathCheck} className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-700 text-[11px] text-slate-300 hover:text-sky-300 hover:bg-slate-800" title="Keep this session's transitions as a path check: every edit is checked against them (Problems)">
                <ShieldCheck className="w-3 h-3" /> Keep as a path check
              </button>
            )}
            {onOpenGatewayRecordings && !running && (
              <button
                id="live-gw-recordings"
                onClick={onOpenGatewayRecordings}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-700 text-[11px] text-slate-300 hover:text-sky-300 hover:bg-slate-800"
                title="Replay a machine's time window from the gateway's recordings"
              >
                <Database className="w-3 h-3" /> Gateway recordings...
              </button>
            )}
          </div>
        )}
        {replay && (
          <div id="live-replay-bar" className="rounded border border-violet-800 bg-violet-950/40 px-2 py-1.5 space-y-1">
            <div className="flex items-center gap-2 min-w-0">
              <button
                id="live-replay-play"
                onClick={() => onReplayPlay?.(!replay.playing)}
                className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded bg-violet-700 hover:bg-violet-600 text-white text-[11px]"
                title={replay.playing ? 'Pause' : 'Play'}
              >
                {replay.playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />} {replay.playing ? 'Pause' : 'Play'}
              </button>
              <select
                id="live-replay-speed"
                value={replay.speed}
                onChange={(e) => onReplaySpeed?.(Number(e.target.value))}
                className="shrink-0 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[11px] text-slate-200"
                title="Replay speed"
              >
                {REPLAY_SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}x
                  </option>
                ))}
              </select>
              <span id="live-replay-time" className="font-mono text-[11px] text-violet-200 whitespace-nowrap">
                {formatClock(replay.pos)}
              </span>
              <span className="truncate text-[11px] text-slate-400" title={replay.file}>
                {replay.file}
              </span>
            </div>
            <input
              id="live-replay-seek"
              type="range"
              min={replay.from}
              max={Math.max(replay.to, replay.from + 1)}
              step={Math.max(1, Math.round((replay.to - replay.from) / 2000))}
              value={replay.pos}
              onChange={(e) => onReplaySeek?.(Number(e.target.value))}
              className="w-full accent-violet-400"
              title="Go to a moment of the recording"
            />
            {replayVars.length > 0 && (
              <div id="live-replay-vars" className="space-y-0.5 pt-0.5">
                {replayVars.map((v) => (
                  <ReplayVarChart key={v.id} id={v.id} points={v.points} from={replay.from} to={Math.max(replay.to, replay.from + 1)} pos={replay.pos} />
                ))}
              </div>
            )}
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>{formatClock(replay.from)}</span>
              <span>{formatDuration(replay.to - replay.from)}, {replay.samples} samples</span>
              <span>{formatClock(replay.to)}</span>
            </div>
          </div>
        )}
        {/* Settings apply on Go live: hidden while running, so the trail has the room */}
        {!running && (
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 items-center">
          {mode === 'web' && (
            <>
              <span className="text-slate-400">Via</span>
              <div className="flex gap-1" role="radiogroup" aria-label="How to reach the PLC">
                {(
                  [
                    ['link', 'This computer', 'Kval MachineScope Link, the helper on this computer, talks to the PLC'],
                    ['gateway', 'Gateway', 'A Kval MachineScope gateway on the PLC network talks to the PLC'],
                  ] as const
                ).map(([id, label, title]) => (
                  <button
                    key={id}
                    id={`live-via-${id}`}
                    role="radio"
                    aria-checked={via === id}
                    onClick={() => onSettingsChange({ ...settings, via: id })}
                    title={title}
                    className={`px-2 py-0.5 rounded border text-[11px] ${via === id ? 'bg-sky-900/60 border-sky-600 text-sky-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          {mode === 'web' && via === 'link' && (
            <>
              <label htmlFor="live-token-input" className="text-slate-400">
                Pairing
              </label>
              <div className="flex items-center gap-2 min-w-0">
                <input
                  id="live-token-input"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => onTokenChange?.(e.target.value.trim())}
                  placeholder="code shown by Kval MachineScope Link"
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
                />
                <input
                  id="live-link-port-input"
                  value={settings.linkPort}
                  onChange={(e) => onSettingsChange({ ...settings, linkPort: e.target.value.replace(/\D/g, '') })}
                  placeholder="48960"
                  title="The helper's port on this computer (empty: 48960)"
                  className="w-14 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
                />
                <label className="flex items-center gap-1 text-slate-400 shrink-0 cursor-pointer" title="Keep the pairing code in this browser">
                  <input id="live-token-remember" type="checkbox" checked={rememberToken} onChange={(e) => onRememberTokenChange?.(e.target.checked)} />
                  Remember
                </label>
                <a
                  id="live-link-page"
                  href={`http://127.0.0.1:${settings.linkPort || '48960'}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-sky-400 hover:text-sky-300 underline"
                  title="Link's page: the pairing code (to copy) and the pages paired with it"
                >
                  Open Link
                </a>
              </div>
              {linkNotice && (
                <div id="live-link-outdated" className="col-span-2 text-[11px] leading-snug text-amber-300">
                  {linkNotice}
                </div>
              )}
            </>
          )}
          <label htmlFor="live-instance-input" className="text-slate-400">
            Instance
          </label>
          <div className="flex gap-1 min-w-0">
            <input
              id="live-instance-input"
              list="live-instance-options"
              value={settings.instance}
              onChange={(e) => onSettingsChange({ ...settings, instance: e.target.value })}
              placeholder={mode === 'web' ? 'found in the PLC (e.g. MAIN.fbLine.smTable)' : 'found in the project (e.g. MAIN.fbLine.smTable)'}
              className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
            />
            <datalist id="live-instance-options">
              {status.instances.map((i) => (
                <option key={i} value={i} />
              ))}
            </datalist>
          </div>
          {viaGateway && (
            <>
              <label htmlFor="live-gateway-input" className="text-slate-400">
                Gateway
              </label>
              <input
                id="live-gateway-input"
                value={settings.gateway}
                onChange={(e) => onSettingsChange({ ...settings, gateway: e.target.value.trim() })}
                placeholder={gatewayOrigin ? `this page's gateway (${new URL(gatewayOrigin).host})` : 'gateway address (e.g. machinescope-gw:8443)'}
                title="The Kval MachineScope gateway on the PLC network"
                className="min-w-0 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
              />
              {sso && (
                <>
                  <span className="text-slate-400">Account</span>
                  <div id="live-sso" className="flex items-center gap-2 min-w-0">
                    {sso.user ? (
                      <>
                        <span id="live-sso-user" className="truncate text-emerald-300" title={sso.user}>
                          Signed in as {sso.name || sso.user}
                        </span>
                        <button id="live-sso-signout" onClick={onSignOut} className="shrink-0 px-1.5 rounded border border-slate-700 text-[11px] text-slate-300 hover:bg-slate-800">
                          Sign out
                        </button>
                      </>
                    ) : (
                      <button id="live-sso-signin" onClick={onSignIn} className="shrink-0 px-2 py-0.5 rounded bg-sky-800 hover:bg-sky-700 text-[11px] text-white" title="Sign in on this gateway with your company account">
                        Sign in with {sso.provider}
                      </button>
                    )}
                  </div>
                </>
              )}
              {(!sso || (sso.tokens && !sso.user)) && (
              <>
              <label htmlFor="live-token-input" className="text-slate-400">
                {sso ? 'or Token' : 'Token'}
              </label>
              <div className="flex items-center gap-2 min-w-0">
                <input
                  id="live-token-input"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => onTokenChange?.(e.target.value.trim())}
                  placeholder="access token from the gateway's admin"
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
                />
                <label className="flex items-center gap-1 text-slate-400 shrink-0 cursor-pointer" title="Keep the token in this browser">
                  <input id="live-token-remember" type="checkbox" checked={rememberToken} onChange={(e) => onRememberTokenChange?.(e.target.checked)} />
                  Remember
                </label>
              </div>
              </>
              )}
              <label htmlFor="live-plc-select" className="text-slate-400">
                PLC
              </label>
              <select
                id="live-plc-select"
                value={settings.plc}
                onChange={(e) => onSettingsChange({ ...settings, plc: e.target.value })}
                className="min-w-0 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[11px] text-slate-200"
                title={status.plcs ? 'The PLCs this gateway offers' : 'Go live once to load the gateway\'s PLCs'}
              >
                {!status.plcs && <option value={settings.plc}>{settings.plc || 'Go live to load the PLCs'}</option>}
                {status.plcs && !settings.plc && <option value="">Choose a PLC</option>}
                {status.plcs?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {boardUrl && (
                <>
                  <span />
                  <a id="live-board-link" href={boardUrl} target="_blank" rel="noreferrer" className="text-[11px] text-sky-400 hover:text-sky-300 underline" title="A full-screen view of the gateway's machines and alerts, for a screen by the line">
                    Operator board
                  </a>
                </>
              )}
            </>
          )}
          {!viaGateway && (
          <label htmlFor="live-netid-input" className="text-slate-400">
            Target
          </label>
          )}
          {!viaGateway && (
          <div className="flex flex-wrap gap-1 min-w-0">
            <input
              id="live-netid-input"
              value={settings.netId}
              onChange={(e) => onSettingsChange({ ...settings, netId: e.target.value })}
              placeholder={direct ? "PLC's AMS NetId (e.g. 192.168.1.20.1.1)" : "XAE's target (AMS NetId)"}
              title="AMS NetId of the PLC's TwinCAT system"
              className="flex-1 min-w-[8.5rem] bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
            />
            <input
              id="live-port-input"
              value={settings.port}
              onChange={(e) => onSettingsChange({ ...settings, port: e.target.value.replace(/\D/g, '') })}
              placeholder="port"
              title="ADS port of the PLC runtime (empty: from the project, usually 851)"
              className="w-14 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
            />
            {direct && (
              <button
                id="live-plc-local"
                type="button"
                onClick={() => onSettingsChange({ ...settings, netId: '127.0.0.1.1.1', ip: '127.0.0.1', localNetId: '' })}
                className="shrink-0 flex items-center gap-1 px-1.5 rounded border border-slate-700 text-[11px] text-slate-300 hover:text-sky-300 hover:bg-slate-800"
                title="The PLC on this computer (TwinCAT runtime here): 127.0.0.1.1.1 through this computer's TwinCAT router"
              >
                This PC
              </button>
            )}
            {onCheckConnection && !running && (
              <button
                id="live-plc-check"
                type="button"
                onClick={() => {
                  const run = { result: null as CheckResult | null };
                  setChecking(run);
                  void onCheckConnection()
                    .catch((err: unknown) => ({ steps: [], verdict: err instanceof Error ? err.message : String(err) }) as CheckResult)
                    .then((result) => setChecking((c) => (c === run ? { result } : c)));
                }}
                className="shrink-0 flex items-center gap-1 px-1.5 rounded border border-slate-700 text-[11px] text-slate-300 hover:text-sky-300 hover:bg-slate-800"
                title="Why doesn't the PLC answer? Checks this computer's network, the PLC's ports, its AMS NetId and the routes, step by step (nothing is changed)"
              >
                <Stethoscope className="w-3 h-3" /> Check
              </button>
            )}
            {canBrowse && (
              <button
                id="live-plc-browse"
                onClick={() => setBrowsing((b) => !b)}
                aria-expanded={browsing}
                className={`shrink-0 flex items-center gap-1 px-1.5 rounded border text-[11px] ${browsing ? 'bg-sky-900/60 border-sky-600 text-sky-200' : 'border-slate-700 text-slate-300 hover:text-sky-300 hover:bg-slate-800'}`}
                title={onScanPlcs ? 'Find the PLCs on the network, or pick a remembered one' : 'Pick a remembered PLC'}
              >
                <Search className="w-3 h-3" /> Browse
                {lostPlcs.length > 0 && (
                  <span id="live-plc-lost" className="ml-0.5 px-1 rounded bg-rose-900/70 text-rose-200 text-[10px]" title={`Stopped answering: ${lostPlcs.map((p) => `${p.name || p.netId} (since ${new Date(checker.lost[p.netId]).toLocaleTimeString()})`).join(', ')}`}>
                    {lostPlcs.length} down
                  </span>
                )}
              </button>
            )}
            {onRememberPlc && (
              <label className="shrink-0 flex items-center gap-1 text-slate-400 cursor-pointer" title="Remember this PLC in this app: Browse lists it, and new POUs start with it">
                <input
                  id="live-plc-remember"
                  type="checkbox"
                  checked={remembered}
                  disabled={!/^[0-9]+([.][0-9]+){5}$/.test(netIdNow)}
                  onChange={(e) => onRememberPlc(e.target.checked, pickedName?.netId === netIdNow ? pickedName.name : undefined, pickedName?.netId === netIdNow ? { twincat: pickedName.twincat, os: pickedName.os } : undefined)}
                />
                Remember
              </label>
            )}
          </div>
          )}
          {direct && (
            <>
              <label htmlFor="live-ip-input" className="text-slate-400">
                PLC IP
              </label>
              <input
                id="live-ip-input"
                value={settings.ip}
                onChange={(e) => onSettingsChange({ ...settings, ip: e.target.value.trim() })}
                placeholder="from the NetId (e.g. 192.168.1.20)"
                title="The PLC's IP address or host name (host:port for a forwarded ADS port)"
                className="min-w-0 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
              />
              <label htmlFor="live-local-netid-input" className="text-slate-400" title="The AMS NetId this computer uses towards the PLC">
                This PC
              </label>
              <input
                id="live-local-netid-input"
                value={settings.localNetId}
                onChange={(e) => onSettingsChange({ ...settings, localNetId: e.target.value.trim() })}
                placeholder="AMS NetId (empty: this PC's IP + .1.1)"
                title="The AMS NetId this computer uses towards the PLC: the PLC needs a route with it"
                className="min-w-0 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
              />
            </>
          )}
        </div>
        )}
        {licenseNotice && (
          <div id="live-license-notice" data-state={licenseNotice.state} className={`rounded border px-2 py-1 text-[11px] leading-snug ${licenseNotice.state === 'expired' ? 'border-rose-800 bg-rose-950/40 text-rose-200' : 'border-amber-800 bg-amber-950/30 text-amber-200'}`}>
            {licenseNotice.text}{' '}
            <button type="button" id="live-license-renew" onClick={() => setRenewing((r) => !r)} className="underline hover:text-white" aria-expanded={renewing}>
              {renewing ? 'Hide' : 'Renew…'}
            </button>
            {renewing && (
              <div id="live-license-steps" className="mt-1 space-y-1 text-slate-300">
                <ol className="list-decimal pl-4 space-y-0.5">
                  <li>In TwinCAT XAE, with this PLC chosen as the target: Solution Explorer › <b>SYSTEM › License</b>.</li>
                  <li><b>7 Days Trial License…</b>, and type the characters it shows (TwinCAT asks a person, so MachineScope cannot do it).</li>
                  <li>Activate the configuration, or restart TwinCAT on the target, so the PLC takes the new license.</li>
                </ol>
                <div className="flex items-center gap-2">
                  {onOpenXae && (
                    <button type="button" id="live-license-open-xae" onClick={() => void onOpenXae().then((r) => setXaeOpened(r.message))} className="px-1.5 rounded border border-slate-600 hover:bg-slate-800">
                      Open XAE
                    </button>
                  )}
                  {onRecheckLicense && (
                    <button type="button" id="live-license-recheck" onClick={onRecheckLicense} className="px-1.5 rounded border border-slate-600 hover:bg-slate-800" title="Read the PLC's license again">
                      Check again
                    </button>
                  )}
                  {xaeOpened && <span id="live-license-xae">{xaeOpened}</span>}
                </div>
              </div>
            )}
          </div>
        )}
        {checking && !running && (
          <div id="live-check-panel" className="rounded border border-slate-700 bg-slate-900/80 p-2 text-[11px] space-y-1" data-state={checking.result ? 'done' : 'running'}>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">Connection check</span>
              <button type="button" onClick={() => setChecking(null)} className="text-slate-500 hover:text-slate-200" title="Close">
                ×
              </button>
            </div>
            {!checking.result ? (
              <div className="flex items-center gap-1.5 text-slate-400">
                <Loader2 className="w-3 h-3 animate-spin" /> Checking this computer, the network, TwinCAT and the routes…
              </div>
            ) : (
              <>
                {checking.result.steps.map((s) => (
                  <div key={s.id} className="live-check-step flex items-start gap-1.5" data-step={s.id} data-ok={String(s.ok)}>
                    <span className={`mt-px shrink-0 font-mono ${s.ok === true ? 'text-emerald-400' : s.ok === false ? 'text-rose-400' : 'text-amber-300'}`}>{s.ok === true ? '✓' : s.ok === false ? '✗' : '!'}</span>
                    <span className="min-w-0">
                      <span className={s.ok === false ? 'text-rose-200' : 'text-slate-200'}>{s.title}</span>
                      {s.detail && s.ok !== true && <span className="block text-slate-400">{s.detail}</span>}
                    </span>
                  </div>
                ))}
                <div id="live-check-verdict" className={`pt-1 border-t border-slate-800 ${checking.result.steps.some((s) => s.ok === false) ? 'text-rose-200' : 'text-emerald-200'}`}>
                  {checking.result.verdict}
                </div>
                <button
                  type="button"
                  id="live-check-copy"
                  onClick={() => {
                    const text = checkAsText({ netId: settings.netId, ip: settings.ip }, checking.result!);
                    void navigator.clipboard.writeText(text).then(
                      () => setCheckCopied('Copied'),
                      () => setCheckCopied('Copying is blocked here: select the lines above'),
                    );
                    window.setTimeout(() => setCheckCopied(''), 2500);
                  }}
                  className="mr-2 px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
                  title="The check as text: for a message or a colleague"
                >
                  Copy
                </button>
                {checkCopied && <span id="live-check-copied" className="mr-2 text-slate-400">{checkCopied}</span>}
                {checking.result.suggest?.port && String(checking.result.suggest.port) !== settings.port && (
                  <button
                    type="button"
                    id="live-check-port-fix"
                    onClick={() => {
                      onSettingsChange({ ...settings, port: String(checking.result!.suggest!.port) });
                      setChecking(null);
                    }}
                    className="mr-2 px-2 py-0.5 rounded bg-sky-800 hover:bg-sky-700 text-sky-50"
                  >
                    Use port {checking.result.suggest.port}
                  </button>
                )}
                {checking.result.steps.some((s) => (s.id === 'search' || s.id === 'port') && s.ok === false) && (
                  <details id="live-check-firewall" className="mt-1">
                    <summary className="cursor-pointer text-slate-300">Commands for the PLC's computer (PowerShell as administrator)</summary>
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-950 border border-slate-800 p-1.5 text-[10px] text-slate-300 whitespace-pre-wrap">{firewallCommands()}</pre>
                    <button
                      type="button"
                      id="live-check-firewall-copy"
                      onClick={() => void navigator.clipboard.writeText(firewallCommands()).then(() => setCheckCopied('Commands copied'), () => setCheckCopied('Copying is blocked here: select the commands'))}
                      className="mt-1 px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
                    >
                      Copy the commands
                    </button>
                  </details>
                )}
                {checking.result.suggest?.netId && checking.result.suggest.netId !== settings.netId && (
                  <button
                    type="button"
                    id="live-check-fix"
                    onClick={() => {
                      onSettingsChange({ ...settings, netId: checking.result!.suggest!.netId! });
                      setChecking(null);
                    }}
                    className="px-2 py-0.5 rounded bg-sky-800 hover:bg-sky-700 text-sky-50"
                  >
                    Use {checking.result.suggest.netId}
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {browsing && !running && canBrowse && (
          <PlcBrowser
            mode={mode}
            remembered={rememberedPlcs}
            currentNetId={netIdNow}
            onPick={pickPlc}
            onFound={onPlcsFound}
            checkPlc={onCheckPlc}
            checker={checker}
            onForget={(netId) => onForgetPlc?.(netId)}
            onClose={() => setBrowsing(false)}
            scan={onScanPlcs}
            addRoute={onAddRoute}
            onRename={onRenamePlc}
          />
        )}
        {direct && !running && (
          <div id="live-route-hint" className="text-[11px] leading-snug text-slate-500">
            The PLC answers only computers it has an ADS route for.{' '}
            {status.route ? (
              <>
                Add a route on the PLC (TwinCAT on the PLC: Router &gt; Edit Routes, or its XAE project) to this PC:{' '}
                AMS NetId <span className="font-mono text-slate-300">{status.route.localNetId}</span>, address{' '}
                <span className="font-mono text-slate-300">{status.route.localIp}</span>.
              </>
            ) : (
              <>Go live once to see the AMS NetId and address to add on the PLC.</>
            )}
          </div>
        )}
        {status.instances.length > 1 && (
          <div id="live-instances" className="rounded border border-slate-800 bg-slate-950/50">
            <div className="flex items-center gap-2 px-2 py-1 border-b border-slate-800">
              <Layers className="w-3 h-3 text-slate-500" />
              <span className="text-slate-300 font-semibold">{status.instances.length} instances in the PLC</span>
              {onOpenInstance && others.length > 1 && (
                <button
                  id="live-open-all-instances"
                  onClick={() => others.forEach((i) => onOpenInstance(i))}
                  className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-sky-300 hover:bg-slate-800"
                  title={`Follow each of the other ${others.length} instances in its own ${openTarget}`}
                >
                  <ExternalLink className="w-3 h-3" /> Open all
                </button>
              )}
            </div>
            <div className="max-h-32 overflow-y-auto">
              {status.instances.map((i) => {
                const here = sameInstance(i, following);
                return (
                  <div key={i} className="live-instance-row flex items-center gap-1.5 px-2 py-0.5 font-mono text-[11px]" data-instance={i}>
                    <span className={`truncate min-w-0 ${here ? 'text-emerald-300' : 'text-slate-300'}`} title={i}>
                      {i}
                    </span>
                    {here ? (
                      <span className="ml-auto shrink-0 font-sans text-[10px] text-slate-500">this {openTarget}</span>
                    ) : (
                      <span className="ml-auto flex shrink-0 gap-0.5 font-sans">
                        {!running && (
                          <button
                            onClick={() => onSettingsChange({ ...settings, instance: i })}
                            className="px-1.5 rounded text-[11px] text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                            title={`Follow ${i} here (then Go live)`}
                          >
                            Use
                          </button>
                        )}
                        {onOpenInstance && (
                          <button
                            onClick={() => onOpenInstance(i)}
                            className="live-open-instance flex items-center gap-1 px-1.5 rounded text-[11px] text-sky-300 hover:bg-slate-800"
                            title={`Follow ${i} in a new ${openTarget}, next to this one`}
                          >
                            <ExternalLink className="w-3 h-3" /> Open
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
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
            <span className="text-slate-500 font-mono shrink-0 whitespace-nowrap">= {session.current.value}</span>
            {stuck && (
              <span id="live-stuck" className="ml-auto shrink-0 px-1.5 rounded-full bg-rose-600 text-[9px] font-bold tracking-wide text-white" title={`Longer in ${session.current.state} than its limit (${formatLimit(limitMs ?? null)})`}>
                STUCK
              </span>
            )}
            <span id="live-time-in-state" className={`${stuck ? '' : 'ml-auto '}shrink-0 whitespace-nowrap font-mono ${stuck ? 'text-rose-300 font-bold' : 'text-slate-300'}`} title={limitMs ? `Limit: ${formatLimit(limitMs)}` : undefined}>
              {formatDuration(inState)}
              {limitMs ? <span className="text-slate-500 font-normal"> / {formatLimit(limitMs)}</span> : null}
            </span>
          </div>
        ) : (
          <div className="text-slate-500">—</div>
        )}
        {/* Stuck-state alert: how long a state may last (per POU type, kept for this viewer) */}
        {onStateLimitChange && (
          <div id="live-limits" className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
            {session.current && (
              <label className="flex items-center gap-1" title={`How long ${session.current.state} may last before it counts as stuck`}>
                Limit
                <LimitField id="live-state-limit" valueMs={stateLimitMs} onChange={onStateLimitChange} placeholder={defaultLimitMs ? formatLimit(defaultLimitMs) : 'none'} title="This state's time limit, e.g. 30 s or 2 min (empty: the default)" />
              </label>
            )}
            {onDefaultLimitChange && (
              <label className="flex items-center gap-1" title="The limit of every state that has none of its own">
                Default
                <LimitField id="live-default-limit" valueMs={defaultLimitMs} onChange={onDefaultLimitChange} placeholder="none" title="The limit of the states without their own, e.g. 1 min (empty: none)" />
              </label>
            )}
            {onNotifyChange && (
              <label className="flex items-center gap-1 cursor-pointer" title="A notification when a machine goes over its limit (this one, and the Machine Overview's)">
                <input id="live-notify" type="checkbox" checked={notify} onChange={(e) => onNotifyChange(e.target.checked)} /> Notify
              </label>
            )}
          </div>
        )}
        {!hasEnumNames && session.current && (
          <div className="mt-1 text-[11px] text-amber-300/80">Load the .TcDUT enum to see state names instead of numbers.</div>
        )}
      </div>

      {/* Path checks kept for this POU type: each checked against the diagram (a broken one is a Problem) */}
      {pathChecks.length > 0 && (
        <div id="live-path-checks" className="border-b border-slate-800 shrink-0 px-2.5 py-1.5 space-y-0.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Path checks ({pathChecks.length})</div>
          {pathChecks.map((c) => (
            <div key={c.id} className="live-path-check flex items-center gap-1.5 text-[11px]" data-check={c.name} data-ok={c.missing.length === 0}>
              <span className={c.missing.length ? 'text-rose-300' : 'text-emerald-300'}>{c.missing.length ? '✗' : '✓'}</span>
              <span className="truncate text-slate-200">{c.name}</span>
              <span className="text-slate-500 shrink-0">{c.transitions} transitions</span>
              {c.missing.length > 0 && <span className="truncate text-rose-300" title={c.missing.join('\n')}>{c.missing.length} missing: {c.missing[0]}{c.missing.length > 1 ? ', ...' : ''}</span>}
              {onRemovePathCheck && (
                <button className="live-path-check-remove ml-auto shrink-0 px-1 rounded text-slate-500 hover:text-rose-300 hover:bg-slate-800" onClick={() => onRemovePathCheck(c.id)} title="Remove this path check">
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Measured state times: per state, how long the PLC stayed (from this session's transitions) */}
      {stateTimes.length > 0 && (
        <div id="live-state-times" className="border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <button id="live-state-times-toggle" onClick={() => setTimesOpen((o) => !o)} className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200" title="Show / hide the table">
              <Timer className="w-3 h-3" /> State times
              <span className="normal-case font-normal text-slate-500">({stateTimes.length} states, {stateTimes.reduce((n, t) => n + t.n, 0)} stays)</span>
            </button>
            {onExportStateTimes && (
              <button id="live-state-times-csv" onClick={onExportStateTimes} className="ml-auto flex items-center gap-1 px-1.5 rounded border border-slate-700 text-[10px] text-slate-300 hover:bg-slate-800" title="Save the table as CSV (Excel)">
                <Download className="w-3 h-3" /> CSV
              </button>
            )}
            {onShowStateTimesChange && (
              <label className={`${onExportStateTimes ? '' : 'ml-auto '}flex items-center gap-1 text-[11px] text-slate-400 cursor-pointer`} title="Colour the diagram's states by their average time, quick (green) to slow (red)">
                <input id="live-state-times-diagram" type="checkbox" checked={showStateTimes} onChange={(e) => onShowStateTimesChange(e.target.checked)} /> On the diagram
              </label>
            )}
          </div>
          {timesOpen && (
            <div className="max-h-48 overflow-y-auto px-2.5 pb-2">
              <table id="live-state-times-table" className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-500 text-left">
                    <th className="font-normal">State</th>
                    <th className="pl-1.5 font-normal text-right" title="Stays measured">n</th>
                    <th className="pl-1.5 font-normal text-right">average</th>
                    <th className="pl-1.5 font-normal text-right" title="90% of the stays are within this">90%</th>
                    <th className="pl-1.5 font-normal text-right">longest</th>
                    <th className="pl-1.5 font-normal text-right" title="All the time in this state">total</th>
                  </tr>
                </thead>
                <tbody>
                  {stateTimes.map((t) => (
                    <tr key={t.state} className="live-state-time-row hover:bg-slate-800 cursor-pointer" data-state={t.state} onClick={() => onSelectState(t.state)} title="Show on the diagram">
                      {/* (the name: the room the numbers leave, cut short; the numbers on one line) */}
                      <td className="w-full max-w-0 font-mono text-slate-200">
                        <div className="truncate" title={t.state}>{t.state}</div>
                      </td>
                      <td className="pl-1.5 text-right font-mono text-slate-400 whitespace-nowrap">{t.n}</td>
                      <td className="pl-1.5 text-right font-mono text-slate-200 whitespace-nowrap">{formatDuration(t.avgMs)}</td>
                      <td className="pl-1.5 text-right font-mono text-slate-400 whitespace-nowrap">{formatDuration(t.p90Ms)}</td>
                      <td className="pl-1.5 text-right font-mono text-slate-400 whitespace-nowrap">{formatDuration(t.maxMs)}</td>
                      <td className="pl-1.5 text-right font-mono text-slate-400 whitespace-nowrap">{formatDuration(t.totalMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* The variables watched from the code */}
      {watchList && watchList.length > 0 && (
        <div id="live-watch-list" className="border-b border-slate-800 shrink-0 px-2.5 py-1.5">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Watched</div>
          {watchList.map((w) => (
            <div key={w.name} className="live-watch-row flex items-center gap-2 font-mono text-[11px]" data-name={w.name}>
              <span className="text-slate-300 truncate">{w.name}</span>
              <span className="live-watch-value ml-auto text-emerald-300">{w.value === undefined ? '…' : typeof w.value === 'boolean' ? (w.value ? 'TRUE' : 'FALSE') : String(w.value)}</span>
              {onUnwatch && (
                <button type="button" onClick={() => onUnwatch(w.name)} className="text-slate-500 hover:text-white" title="Stop watching it">
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Guard values of the transitions out of the current state */}
      {onGuardScopeChange && (
        <div id="live-guards" className="border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2 px-2.5 pt-2 pb-1.5">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">Guard values</span>
            <div className="ml-auto flex rounded-md border border-slate-700 overflow-hidden text-[11px]" role="radiogroup" aria-label="Guard values">
              {(['off', 'active', 'all'] as const).map((s) => (
                <button
                  key={s}
                  id={`live-guards-${s}`}
                  role="radio"
                  aria-checked={guardScope === s}
                  onClick={() => onGuardScopeChange(s)}
                  className={`px-2 py-0.5 ${guardScope === s ? 'bg-sky-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
                  title={
                    s === 'off'
                      ? 'Read no guard variables'
                      : s === 'active'
                        ? 'Read the variables of the current state\u2019s transitions'
                        : 'Read the variables of every transition (badges on all of them, values on the current state\u2019s and the selected one)'
                  }
                >
                  {s === 'off' ? 'Off' : s === 'active' ? 'Active state' : 'All transitions'}
                </button>
              ))}
            </div>
          </div>
          {guardScope !== 'off' && status.state === 'connected' && session.current && (
            <div id="live-guard-list" className="max-h-56 overflow-y-auto px-2.5 pb-2 space-y-1">
              {guards.length === 0 ? (
                <div className="text-[11px] text-slate-500">No conditional transitions out of {session.current.state}.</div>
              ) : (
                guards.map((g) => {
                  const b = GUARD_BADGE[g.result];
                  return (
                    <div key={g.edgeId} className="live-guard-row rounded border border-slate-800 bg-slate-950/60 px-1.5 py-1" data-edge-id={g.edgeId}>
                      <div className="flex items-center gap-1.5">
                        <span className={`live-guard-result inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold shrink-0 ${b.cls}`} title={`Guard: ${b.word}`}>
                          {b.symbol}
                        </span>
                        <ArrowRight className="w-3 h-3 text-slate-500 shrink-0" />
                        <button onClick={() => onSelectState(g.to)} className="font-mono text-[11px] text-slate-200 hover:text-sky-300 truncate min-w-0" title={g.to}>
                          {g.to}
                        </button>
                      </div>
                      {g.vars.length > 0 && (
                        <div className="mt-0.5 pl-5 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px]">
                          {g.vars.map((v) => (
                            <span key={v.name} className={v.known ? 'text-slate-400' : 'text-amber-300/90'} title={v.note}>
                              {v.name} = <span className={v.known ? 'text-slate-100' : ''}>{v.text}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

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
