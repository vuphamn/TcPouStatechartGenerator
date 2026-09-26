import React, { useEffect, useState } from 'react';
import { Radio, Play, Square, Trash2, History, Crosshair, AlertTriangle, ArrowRight, Loader2, Layers, ExternalLink, ListTree, LayoutGrid } from 'lucide-react';
import { LiveSession, formatClock, formatDuration } from '../utils/liveView.ts';
import { sameInstance } from '../utils/instanceLaunch.ts';
import type { EdgeGuardView } from '../utils/liveGuards.ts';

export interface LiveStatus {
  state: 'idle' | 'connecting' | 'connected' | 'error' | 'lost' | 'stopped';
  message?: string;
  target?: string;
  plcState?: string;
  instance?: string;
  instances: string[];
  /** Desktop: the AMS NetId / IP this computer uses towards the PLC (the PLC needs a route for them) */
  route?: { localNetId: string; localIp: string };
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
  /** Web edition: through the local helper on this computer (Kval StateScope Link) or a gateway */
  via: 'link' | 'gateway' | '';
  /** Web edition: the local helper's port (empty: 48960) */
  linkPort: string;
}

interface LivePanelProps {
  /**
   * xae: TwinCAT XAE with a POU from an open TwinCAT project; desktop: the desktop app (ADS straight to the PLC);
   * web: the web edition, through the local helper (Kval StateScope Link) or a gateway (settings.via)
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
  /** Another instance of the POU in its own tab / window, live (a POU can be declared several times) */
  onOpenInstance?: (instance: string) => void;
  /** What Open makes: a tab (XAE, web) or a window (desktop) */
  openTarget?: 'tab' | 'window';
  /** Opens the Symbols window (the PLC's symbols and values) */
  onOpenSymbols?: () => void;
  /** Opens the Machine Overview tab */
  onOpenOverview?: () => void;
}

const GUARD_BADGE = {
  true: { symbol: '\u2713', cls: 'bg-emerald-400 text-slate-950', word: 'TRUE' },
  false: { symbol: '\u2717', cls: 'bg-slate-500 text-slate-950', word: 'FALSE' },
  unknown: { symbol: '?', cls: 'bg-amber-400 text-slate-950', word: 'unknown' },
} as const;

const MAX_SHOWN = 200;

export const LivePanel: React.FC<LivePanelProps> = ({
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
  onOpenInstance,
  openTarget = 'window',
  onOpenSymbols,
  onOpenOverview,
}) => {
  const running = status.state === 'connecting' || status.state === 'connected';
  // The instance this window follows (or will), and the others the PLC has
  const following = status.state === 'connected' || status.state === 'lost' ? status.instance ?? settings.instance : settings.instance || status.instances[0];
  const others = status.instances.filter((i) => !sameInstance(i, following));
  const via = settings.via || defaultVia;
  const viaGateway = mode === 'web' && via === 'gateway';
  // ADS from this computer: the desktop app, or the web edition through the local helper
  const direct = mode === 'desktop' || (mode === 'web' && via === 'link');
  // Time in the current state ticks while connected
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status.state !== 'connected') return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [status.state]);

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
        </div>
        {/* Settings apply on Go live: hidden while running, so the trail has the room */}
        {!running && (
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 items-center">
          {mode === 'web' && (
            <>
              <span className="text-slate-400">Via</span>
              <div className="flex gap-1" role="radiogroup" aria-label="How to reach the PLC">
                {(
                  [
                    ['link', 'This computer', 'Kval StateScope Link, the helper on this computer, talks to the PLC'],
                    ['gateway', 'Gateway', 'A Kval StateScope gateway on the PLC network talks to the PLC'],
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
                  placeholder="code shown by Kval StateScope Link"
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
              </div>
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
                placeholder={gatewayOrigin ? `this page's gateway (${new URL(gatewayOrigin).host})` : 'gateway address (e.g. statescope-gw:8443)'}
                title="The Kval StateScope gateway on the PLC network"
                className="min-w-0 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
              />
              <label htmlFor="live-token-input" className="text-slate-400">
                Token
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
            </>
          )}
          {!viaGateway && (
          <label htmlFor="live-netid-input" className="text-slate-400">
            Target
          </label>
          )}
          {!viaGateway && (
          <div className="flex gap-1 min-w-0">
            <input
              id="live-netid-input"
              value={settings.netId}
              onChange={(e) => onSettingsChange({ ...settings, netId: e.target.value })}
              placeholder={direct ? "PLC's AMS NetId (e.g. 192.168.1.20.1.1)" : "XAE's target (AMS NetId)"}
              title="AMS NetId of the PLC's TwinCAT system"
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
