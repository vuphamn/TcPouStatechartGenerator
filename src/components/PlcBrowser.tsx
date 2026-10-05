import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Pencil, RefreshCw, Star, X } from 'lucide-react';
import type { AddRouteBoth, AddRouteResult, FoundPlc, PlcScanResult, RememberedPlc } from '../utils/plcDiscovery.ts';
import { firewallCommands, type CheckRequest, type CheckResult } from '../utils/connectionCheck.ts';
import { ALL_PLC_CONTROLS, PlcActionButtons, PlcActionConfirm, PlcActionHistory, PlcStateBadge, RenewLicenseSteps, needsRenew, plcActionDone, plcActions, plcStateText, stateChanges, type PlcControlMode, type PlcControlResult, type PlcState } from './PlcControls.tsx';
import { addPlcAction, loadPlcActions, type PlcActionEntry } from '../utils/plcActionLog.ts';

export interface PickedPlc {
  name: string;
  netId: string;
  ip: string;
  /** Found on the network: its TwinCAT and OS (kept when it is remembered) */
  twincat?: string;
  os?: string;
  port?: string;
  localNetId?: string;
}

/** A check's verdict: true (all steps pass), false (one fails), null (none yet) */
const checkOk = (r: CheckResult | null | undefined) => (r ? r.steps.length > 0 && !r.steps.some((s) => s.ok === false) : null);
/** Its PLC runs (answers, and no step about its PLC's state: that one is there only when it is not in Run) */
export const checkRuns = (r: CheckResult | null | undefined) => (r ? checkOk(r) === true && !r.steps.some((s) => s.id === 'plc') : null);
const EVERY_KEY = 'kss.plcCheckEvery';

/**
 * Check all, kept by the Live tab (so it runs again while Browse is closed): each remembered PLC in turn; again every
 * few minutes when chosen (minutes, 0: off; remembered in this browser); a PLC that answered and then no longer does
 * is marked with the time it stopped (until it answers again)
 */
export function useRememberedChecks(remembered: RememberedPlc[], checkPlc?: (req: CheckRequest) => Promise<CheckResult>) {
  // (NetId: its last result; while running: null)
  const [checks, setChecks] = useState<Record<string, CheckResult | null>>({});
  const [checkingAll, setCheckingAll] = useState(false);
  const [lost, setLost] = useState<Record<string, number>>({});
  // (those that ran and answer with their PLC not in Run now: when, and what the check said)
  const [stopped, setStopped] = useState<Record<string, { at: number; why: string }>>({});
  const [every, setEveryState] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(EVERY_KEY)) || 0;
    } catch {
      return 0;
    }
  });
  const setEvery = (minutes: number) => {
    setEveryState(minutes);
    try {
      localStorage.setItem(EVERY_KEY, String(minutes));
    } catch {
      // (not kept)
    }
  };
  const last = useRef<Record<string, CheckResult | null>>({});
  const running = useRef(false);
  const checkAll = useCallback(async () => {
    if (!checkPlc || running.current) return;
    running.current = true;
    setCheckingAll(true);
    for (const p of remembered) {
      setChecks((c) => ({ ...c, [p.netId]: null }));
      const r = await checkPlc({ netId: p.netId, ip: p.ip, port: parseInt(p.port, 10) || undefined, localNetId: p.localNetId || undefined }).catch((e: unknown) => ({ steps: [], verdict: e instanceof Error ? e.message : String(e) }) as CheckResult);
      const was = checkOk(last.current[p.netId]);
      const now = checkOk(r);
      // (it ran, and answers with its PLC not in Run now: stopped, or no program; Notify says so. One that stopped
      // answering: lost)
      const plcStep = r.steps.find((s) => s.id === 'plc');
      if (checkRuns(last.current[p.netId]) === true && plcStep) setStopped((x) => ({ ...x, [p.netId]: { at: Date.now(), why: plcStep.title } }));
      else if (checkRuns(r) === true) setStopped((x) => (p.netId in x ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== p.netId)) : x));
      last.current[p.netId] = r;
      setChecks((c) => ({ ...c, [p.netId]: r }));
      setLost((l) => {
        if (now === true && p.netId in l) {
          const { [p.netId]: _gone, ...rest } = l;
          return rest;
        }
        return was === true && now === false ? { ...l, [p.netId]: Date.now() } : l;
      });
    }
    running.current = false;
    setCheckingAll(false);
  }, [checkPlc, remembered]);
  const checkAllRef = useRef(checkAll);
  checkAllRef.current = checkAll;
  useEffect(() => {
    if (!every || !checkPlc) return;
    const t = window.setInterval(() => void checkAllRef.current(), every * 60000);
    return () => window.clearInterval(t);
  }, [every, checkPlc]);
  return { checks, checkingAll, checkAll, every, setEvery, lost, stopped };
}
export type RememberedChecks = ReturnType<typeof useRememberedChecks>;

interface PlcBrowserProps {
  /** xae: XAE goes live through this computer's TwinCAT router, so a device needs a route there */
  mode: 'xae' | 'desktop' | 'web';
  remembered: RememberedPlc[];
  currentNetId: string;
  onPick: (plc: PickedPlc) => void;
  /** Check all: each remembered PLC's connection check (desktop, Link) */
  checkPlc?: (req: CheckRequest) => Promise<CheckResult>;
  /** Check all's results, kept by the Live tab (its timer runs while Browse is closed) */
  checker?: RememberedChecks;
  /** A search's result (the remembered PLCs are kept up to date with it) */
  onFound?: (r: PlcScanResult) => void;
  onForget: (netId: string) => void;
  onClose: () => void;
  /** Searches the network (absent: only the remembered PLCs are listed) */
  scan?: (addresses: string[]) => Promise<PlcScanResult>;
  /** Add Route to a found PLC with its user name and password (absent: not offered) */
  addRoute?: (plc: FoundPlc, user: string, password: string, both?: AddRouteBoth) => Promise<AddRouteResult>;
  /** Renames a remembered PLC */
  onRename?: (netId: string, name: string) => void;
  /** A found PLC started, not live, after a confirmation: its PLC from Stop ('plc'), TwinCAT from Config to Run mode
   * ('run') (absent: not offered) */
  startPlc?: (plc: FoundPlc, mode: PlcControlMode) => Promise<PlcControlResult>;
  /** What startPlc may do here (an older Link: start and Run mode only) */
  controlModes?: PlcControlMode[];
  /** A found PLC used and gone live on at once (absent: not offered) */
  onGoLive?: (plc: PickedPlc) => void;
  /** The found PLCs' states again, every few seconds while open (absent: as the search found them) */
  refreshStates?: (devices: FoundPlc[]) => Promise<FoundPlc[]>;
  /** TwinCAT XAE opened on this computer (a PLC that runs no program: its project activated, its program downloaded) */
  openXae?: () => Promise<{ ok: boolean; message: string }>;
}

/** How often the found PLCs' states are read again while Browse is open */
export const PLC_STATES_REFRESH_MS = 5000;
/** How long a state that changed is marked */
const CHANGE_SHOWN_MS = 30000;

const rowClass = (current: boolean) =>
  `w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-800 ${current ? 'bg-sky-950/60' : ''}`;

/** The Live tab's Browse: the remembered PLCs and the TwinCAT devices found on the network; a click picks one */
export const PlcBrowser: React.FC<PlcBrowserProps> = ({ mode, remembered, currentNetId, onPick, onFound, onForget, onClose, scan, addRoute, onRename, checkPlc, checker, startPlc, refreshStates, openXae, controlModes = ALL_PLC_CONTROLS, onGoLive }) => {
  // Check all: each remembered PLC in turn (the Live tab's, else this list's own)
  const own = useRememberedChecks(remembered, checker ? undefined : checkPlc);
  const { checks, checkingAll, checkAll, every, setEvery, lost } = checker ?? own;
  const checkMark = (netId: string) => {
    if (!(netId in checks)) return null;
    const r = checks[netId];
    const ok = checkOk(r);
    const stopped = lost[netId];
    return (
      <span className="live-plc-check-mark shrink-0 ml-1 font-mono text-[11px]" data-ok={r ? String(ok) : 'running'} data-lost={stopped ? 'true' : undefined} title={r ? `${stopped ? `Stopped answering at ${new Date(stopped).toLocaleTimeString()}. ` : ''}${r.verdict}` : 'Checking…'}>
        {r ? (ok ? <span className="text-emerald-400">✓</span> : <span className="text-rose-400">✗{stopped ? <span className="live-plc-lost-at ml-1 font-sans text-[10px]">since {new Date(stopped).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> : null}</span>) : <Loader2 className="inline w-3 h-3 animate-spin text-slate-400" />}
      </span>
    );
  };
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<PlcScanResult | null>(null);
  const [addresses, setAddresses] = useState('');
  // Add Route: the PLC it is for, the credentials (only in this form), the answer
  const [routeFor, setRouteFor] = useState<string | null>(null);
  const [routeUser, setRouteUser] = useState('Administrator');
  const [routePassword, setRoutePassword] = useState('');
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeResult, setRouteResult] = useState<AddRouteResult | null>(null);
  // TwinCAT on this computer too: the route both ways (XAE's pair), with this computer's Windows user
  const [routeBoth, setRouteBoth] = useState(true);
  const [localUser, setLocalUser] = useState('');
  const [localPassword, setLocalPassword] = useState('');
  const [renaming, setRenaming] = useState<{ netId: string; name: string } | null>(null);

  const run = useCallback(() => {
    if (!scan) return;
    setScanning(true);
    void scan(addresses.split(/[\s,;]+/).filter(Boolean)).then((r) => {
      setResult(r);
      setScanning(false);
      onFound?.(r);
    });
  }, [scan, addresses, onFound]);
  // Searches once when opened
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => run(), []);

  // Their states read again every few seconds while open: a PLC started (here or elsewhere) or stopped shown as it is;
  // one that changed marked for a while (what it was, since when)
  const resultRef = useRef(result);
  resultRef.current = result;
  const refreshingRef = useRef(false);
  const [changed, setChanged] = useState<Record<string, { from: string; at: number }>>({});
  // (the remembered ones too, by their NetId: each with its state, as on the network)
  const [rememberedStates, setRememberedStates] = useState<Record<string, PlcState>>({});
  const rememberedStatesRef = useRef(rememberedStates);
  rememberedStatesRef.current = rememberedStates;
  const rememberedRef = useRef(remembered);
  rememberedRef.current = remembered;
  const refreshNow = useCallback(() => {
    const found = (resultRef.current?.devices ?? []).filter((d) => d.state && d.ip && d.source !== 'project');
    const known = new Set(found.map((d) => d.netId));
    const kept = rememberedRef.current.filter((p) => !known.has(p.netId)).map((p): FoundPlc => ({ netId: p.netId, ip: p.ip ?? '', name: p.name, twincat: '', os: '', fingerprint: '' } as FoundPlc));
    const devices = [...found, ...kept];
    if (!refreshStates || refreshingRef.current || !devices.length) return;
    refreshingRef.current = true;
    const before = new Map<string, string>();
    for (const d of found) before.set(d.netId, plcStateText(d.state!));
    for (const [netId, st] of Object.entries(rememberedStatesRef.current)) if (!before.has(netId)) before.set(netId, plcStateText(st));
    void refreshStates(devices)
      .then((list) => {
        const states = new Map(list.filter((d) => d.state).map((d) => [d.netId, d.state!]));
        const now = stateChanges(before, [...states.entries()], Date.now());
        if (Object.keys(now).length) setChanged((c) => ({ ...c, ...now }));
        setResult((r) => (r ? { ...r, devices: r.devices.map((d) => (states.has(d.netId) ? { ...d, state: states.get(d.netId) } : d)) } : r));
        setRememberedStates(Object.fromEntries(states));
      })
      .catch(() => {})
      .finally(() => {
        refreshingRef.current = false;
      });
  }, [refreshStates]);
  useEffect(() => {
    if (!refreshStates) return;
    // (the remembered ones at once, then all every few seconds)
    refreshNow();
    const t = setInterval(refreshNow, PLC_STATES_REFRESH_MS);
    return () => clearInterval(t);
  }, [refreshStates, refreshNow]);
  // (a change shown for half a minute)
  useEffect(() => {
    const keys = Object.keys(changed);
    if (!keys.length) return;
    const t = setTimeout(() => setChanged((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => Date.now() - v.at < CHANGE_SHOWN_MS))), CHANGE_SHOWN_MS);
    return () => clearTimeout(t);
  }, [changed]);

  // A found PLC started, stopped or restarted from here (or TwinCAT to Run mode): which one, how (asked first: what it
  // drives may move), what it answered
  const [startFor, setStartFor] = useState<{ netId: string; mode: PlcControlMode } | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [startResult, setStartResult] = useState<{ netId: string; ok: boolean; text: string } | null>(null);
  const [xaeText, setXaeText] = useState<{ netId: string; text: string } | null>(null);
  // Renew license (its trial ran out): the steps under its row; History: what was done from here
  const [renewFor, setRenewFor] = useState<string | null>(null);
  const [history, setHistory] = useState<PlcActionEntry[] | null>(null);
  const renewButton = (netId: string, st: PlcState | undefined) =>
    needsRenew(st) ? (
      <button className="live-plc-renew shrink-0 ml-1 px-1.5 rounded border border-rose-800 text-[10px] text-rose-300 hover:bg-slate-800" data-netid={netId} onClick={() => setRenewFor(renewFor === netId ? null : netId)} aria-expanded={renewFor === netId} title="Its TwinCAT trial license ran out (or runs out soon): how to renew it">
        Renew license
      </button>
    ) : null;
  const renewSteps = (netId: string, st: PlcState | undefined) =>
    renewFor === netId && needsRenew(st) ? <RenewLicenseSteps idPrefix="live-plc-renew" openXae={openXae} onRecheck={refreshNow} className="ml-2 mr-1 my-1 p-1.5 rounded border border-rose-900 bg-slate-900 space-y-1 text-slate-300" /> : null;
  const doStart = (d: FoundPlc, how: PlcControlMode) => {
    if (!startPlc) return;
    setStartBusy(true);
    setStartResult(null);
    void startPlc(d, how)
      .then((r) => {
        const list = addPlcAction({ t: Date.now(), netId: d.netId, name: d.name || d.netId, mode: how, ok: r.ok, state: r.state, ...(r.error ? { error: r.error } : {}) });
        if (history) setHistory(list);
        setStartResult({ netId: d.netId, ok: r.ok, text: plcActionDone(how, r, d.name || d.netId) });
        if (r.ok) setStartFor(null);
      })
      .finally(() => {
        setStartBusy(false);
        refreshNow();
      });
  };

  const routeBadge = (d: FoundPlc) =>
    mode !== 'xae' ? null : d.route ? (
      <span className="shrink-0 px-1 rounded bg-emerald-900/60 text-emerald-300 text-[10px]" title="The TwinCAT router of this computer has a route to it: XAE can go live on it">
        route
      </span>
    ) : (
      <span
        className="shrink-0 px-1 rounded bg-amber-900/60 text-amber-300 text-[10px]"
        title="No route from this computer yet: add one in XAE (the target selector's Choose Target > Search (Ethernet) > Add Route), then go live"
      >
        no route
      </span>
    );

  const found = result?.devices ?? [];
  return (
    <div id="live-plc-browser" className="rounded border border-slate-700 bg-slate-950/80 text-[11px]">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-slate-800">
        <span className="font-semibold text-slate-300">PLCs</span>
        <span className="flex-1" />
        {startPlc && (
          <button id="live-plc-history-btn" onClick={() => setHistory(history ? null : loadPlcActions())} aria-expanded={!!history} className="px-1.5 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800" title="What was started, stopped or restarted from here">
            History
          </button>
        )}
        {scan && (
          <button id="live-plc-rescan" onClick={run} disabled={scanning} className="flex items-center gap-1 px-1.5 rounded text-slate-300 hover:bg-slate-800 disabled:opacity-50" title="Search the network again">
            <RefreshCw className="w-3 h-3" /> Search again
          </button>
        )}
        <button id="live-plc-browser-close" onClick={onClose} className="p-0.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800" title="Close">
          <X className="w-3 h-3" />
        </button>
      </div>
      {history && <PlcActionHistory id="live-plc-history" entries={history} />}
      <div className="max-h-64 overflow-y-auto p-1 space-y-1">
        {remembered.length > 0 && (
          <div>
            <div className="flex items-center px-2 pt-0.5">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Remembered</span>
              {checkPlc && (
                <span className="ml-auto flex items-center gap-1">
                  <button id="live-plc-check-all" type="button" disabled={checkingAll} onClick={() => void checkAll()} className="px-1.5 rounded text-[10px] text-slate-300 hover:text-sky-300 hover:bg-slate-800 disabled:opacity-50" title="Check each remembered PLC: does it answer, with the right NetId and a route (nothing is changed)">
                    {checkingAll ? 'Checking…' : 'Check all'}
                  </button>
                  <select
                    id="live-plc-check-every"
                    value={String(every)}
                    onChange={(e) => setEvery(Number(e.target.value))}
                    className="bg-slate-950 border border-slate-700 rounded text-[10px] text-slate-300 px-0.5"
                    title="Check them all again every few minutes (while this app is open): a PLC that stops answering is marked; with Notify on, one that stops answering or stops running is said with a notification"
                  >
                    <option value="0">once</option>
                    <option value="1">every minute</option>
                    <option value="5">every 5 min</option>
                    <option value="15">every 15 min</option>
                    {![0, 1, 5, 15].includes(every) && <option value={String(every)}>every {every} min</option>}
                  </select>
                </span>
              )}
            </div>
            {remembered.map((p) => (
              <div key={p.netId} className="live-plc-remembered flex items-center" data-netid={p.netId}>
                {renaming?.netId === p.netId ? (
                  <input
                    className="live-plc-rename-input flex-1 min-w-0 mx-1 bg-slate-950 border border-sky-700 rounded px-1.5 py-0.5 text-[11px] text-slate-200"
                    autoFocus
                    value={renaming.name}
                    onChange={(e) => setRenaming({ netId: p.netId, name: e.target.value })}
                    onBlur={() => {
                      if (renaming.name.trim()) onRename?.(p.netId, renaming.name.trim().slice(0, 60));
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <button className={rowClass(p.netId === currentNetId)} onClick={() => onPick({ name: p.name, netId: p.netId, ip: p.ip, port: p.port, localNetId: p.localNetId })} title="Use this PLC">
                    <Star className="w-3 h-3 shrink-0 text-amber-300" />
                    <span className="truncate text-slate-200">{p.name}</span>
                    <span className="ml-auto shrink-0 font-mono text-slate-400">{p.netId}{p.port ? `:${p.port}` : ''}</span>
                    {p.ip && <span className="shrink-0 font-mono text-slate-500">{p.ip}</span>}
                    <PlcStateBadge state={rememberedStates[p.netId]} changed={changed[p.netId]} />
                    {(p.twincat || p.seen) && (
                      <span className="live-plc-remembered-seen shrink-0 text-[10px] text-slate-500" title={[p.twincat && `TwinCAT ${p.twincat}`, p.os, p.seen && `last found ${new Date(p.seen).toLocaleString()}`].filter(Boolean).join(', ')}>
                        {p.twincat ? `TC ${p.twincat}` : ''}{p.twincat && p.seen ? ' · ' : ''}{p.seen ? `seen ${new Date(p.seen).toLocaleDateString() === new Date().toLocaleDateString() ? new Date(p.seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(p.seen).toLocaleDateString()}` : ''}
                      </span>
                    )}
                  </button>
                )}
                {onRename && renaming?.netId !== p.netId && (
                  <button className="live-plc-rename shrink-0 p-0.5 ml-1 rounded text-slate-500 hover:text-sky-300 hover:bg-slate-800" onClick={() => setRenaming({ netId: p.netId, name: p.name })} title="Rename">
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
                <button className="live-plc-forget shrink-0 p-0.5 ml-1 rounded text-slate-500 hover:text-rose-300 hover:bg-slate-800" onClick={() => onForget(p.netId)} title="Forget this PLC">
                  <X className="w-3 h-3" />
                </button>
                {renewButton(p.netId, rememberedStates[p.netId])}
                {checkMark(p.netId)}
              </div>
            ))}
            {remembered.map((p) => <React.Fragment key={`renew-${p.netId}`}>{renewSteps(p.netId, rememberedStates[p.netId])}</React.Fragment>)}
          </div>
        )}
        {scan && (
          <div>
            <div className="px-2 pt-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
              {mode === 'xae' ? 'Routes and network' : 'On the network'}
              {scanning && <Loader2 className="w-3 h-3 animate-spin" />}
            </div>
            {!scanning && result && found.length === 0 && (
              <div id="live-plc-none" className="px-2 py-1 text-slate-500">
                None found. A firewall may block UDP 48899, or the PLC is behind a router: enter its address below.
              </div>
            )}
            {found.map((d) => {
              // Add Route: desktop / Link ask the PLC for a route to this computer; XAE adds one both ways (offered
              // where XAE has none yet)
              const canRoute = !!addRoute && !!d.ip && d.source !== 'project' && (mode !== 'xae' || !d.route);
              return (
                <div key={d.netId} className="live-plc-found-row">
                  <div className="flex items-center">
                    <button className={`live-plc-found ${rowClass(d.netId === currentNetId)}`} data-netid={d.netId} onClick={() => onPick({ name: d.name || d.ip || d.netId, netId: d.netId, ip: d.ip, twincat: d.twincat, os: d.os })} title={[d.os, d.twincat && `TwinCAT ${d.twincat}`].filter(Boolean).join(', ') || 'Use this PLC'}>
                      <span className="truncate text-slate-200">{d.name || '(no name)'}</span>
                      <span className="ml-auto shrink-0 font-mono text-slate-400">{d.netId}</span>
                      {d.ip && <span className="shrink-0 font-mono text-slate-500">{d.ip}</span>}
                      {d.twincat && <span className="shrink-0 text-slate-500">{d.twincat}</span>}
                      <PlcStateBadge state={d.state} changed={changed[d.netId]} />
                      {routeBadge(d)}
                    </button>
                    {canRoute && (
                      <button
                        className="live-plc-add-route shrink-0 ml-1 px-1.5 rounded border border-slate-700 text-[10px] text-slate-300 hover:text-sky-300 hover:bg-slate-800"
                        data-netid={d.netId}
                        onClick={() => {
                          setRouteFor(routeFor === d.netId ? null : d.netId);
                          setRouteResult(null);
                        }}
                        title={mode === 'xae' ? 'Add a route to this PLC, both ways (as XAE\'s Add Route dialog does)' : 'Ask the PLC for an ADS route to this computer'}
                      >
                        Add route
                      </button>
                    )}
                    {startPlc && (
                      <PlcActionButtons
                        modes={plcActions(d.state, controlModes)}
                        className="live-plc-start"
                        state={d.state}
                        netId={d.netId}
                        onPick={(how) => {
                          setStartFor(startFor?.netId === d.netId && startFor.mode === how ? null : { netId: d.netId, mode: how });
                          setStartResult(null);
                        }}
                      />
                    )}
                    {renewButton(d.netId, d.state)}
                    {openXae && d.state?.plc === 'Invalid' && d.state.system !== 'Config' && !needsRenew(d.state) && (
                      <button
                        className="live-plc-open-xae shrink-0 ml-1 px-1.5 rounded border border-slate-700 text-[10px] text-slate-300 hover:text-sky-300 hover:bg-slate-800"
                        data-netid={d.netId}
                        onClick={() => void openXae().then((r) => setXaeText({ netId: d.netId, text: r.message }))}
                        title="Its PLC runs no program: in XAE, open its project, activate the configuration and download the program (Login), or renew its license"
                      >
                        Open in XAE
                      </button>
                    )}
                    {onGoLive && d.state && !d.state.error && d.source !== 'project' && (
                      <button
                        className="live-plc-go-live shrink-0 ml-1 px-1.5 rounded border border-emerald-700 text-[10px] text-emerald-300 hover:bg-slate-800"
                        data-netid={d.netId}
                        onClick={() => onGoLive({ name: d.name || d.ip || d.netId, netId: d.netId, ip: d.ip, twincat: d.twincat, os: d.os })}
                        title="Use this PLC and go live on it"
                      >
                        Go live
                      </button>
                    )}
                  </div>
                  {xaeText?.netId === d.netId && <div className="live-plc-xae-result ml-2 my-0.5 text-slate-400">{xaeText.text}</div>}
                  {renewSteps(d.netId, d.state)}
                  {startFor?.netId === d.netId && (
                    <PlcActionConfirm idPrefix="live-plc-start" mode={startFor.mode} name={d.name || d.netId} state={d.state} busy={startBusy} onConfirm={() => doStart(d, startFor.mode)} onCancel={() => setStartFor(null)} />
                  )}
                  {startResult?.netId === d.netId && (
                    <div id="live-plc-start-result" data-ok={String(startResult.ok)} className={`ml-2 my-0.5 ${startResult.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {startResult.text}
                    </div>
                  )}
                  {routeFor === d.netId && (
                    <div className="live-plc-route-form ml-2 mr-1 my-1 p-1.5 rounded border border-slate-700 bg-slate-900 space-y-1">
                      <div className="text-slate-400">
                        The PLC's Windows / TwinCAT/BSD user (often Administrator). The password is only sent to the PLC{mode === 'xae' ? ' through XAE' : ''}, never kept.
                      </div>
                      <div className="flex items-center gap-1">
                        <input id="live-route-user" value={routeUser} onChange={(e) => setRouteUser(e.target.value)} placeholder="user" autoComplete="off" className="w-28 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-200" />
                        <input id="live-route-password" type="password" value={routePassword} onChange={(e) => setRoutePassword(e.target.value)} placeholder="password" autoComplete="off" className="w-28 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-200" />
                      </div>
                      {result?.localTwinCat && mode !== 'xae' && (
                        <div className="space-y-1">
                          <label className="flex items-center gap-1.5 text-slate-300" title={`TwinCAT runs on this PC too (${result.localTwinCat}): the route pair XAE's Add Route makes, so XAE and MachineScope both reach the PLC`}>
                            <input id="live-route-both" type="checkbox" checked={routeBoth} onChange={(e) => setRouteBoth(e.target.checked)} />
                            Both ways, for this PC's TwinCAT too (XAE)
                          </label>
                          {routeBoth && (
                            <div className="flex items-center gap-1">
                              <span className="text-slate-400">This PC:</span>
                              <input id="live-route-local-user" value={localUser} onChange={(e) => setLocalUser(e.target.value)} placeholder="its Windows user" autoComplete="off" className="w-28 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-200" />
                              <input id="live-route-local-password" type="password" value={localPassword} onChange={(e) => setLocalPassword(e.target.value)} placeholder="password" autoComplete="off" className="w-28 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-200" />
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <button
                          id="live-route-add"
                          disabled={routeBusy || !routeUser.trim() || (!!result?.localTwinCat && mode !== 'xae' && routeBoth && !localUser.trim())}
                          onClick={() => {
                            setRouteBusy(true);
                            const both = result?.localTwinCat && mode !== 'xae' && routeBoth ? { both: true, localUser: localUser.trim(), localPassword } : undefined;
                            void addRoute!(d, routeUser.trim(), routePassword, both).then((r) => {
                              setRouteBusy(false);
                              setRouteResult(r);
                              if (r.ok) {
                                setRoutePassword('');
                                setLocalPassword('');
                                if (mode === 'xae') run();
                              }
                            });
                          }}
                          className="px-2 rounded bg-sky-800 hover:bg-sky-700 text-white disabled:opacity-50"
                        >
                          {routeBusy ? 'Adding...' : 'Add'}
                        </button>
                      </div>
                      {routeResult && !routeResult.ok && (
                        <details id="live-route-firewall" className="text-slate-400">
                          <summary className="cursor-pointer">It did not answer? Commands for that computer (PowerShell as administrator)</summary>
                          <pre className="mt-1 max-h-32 overflow-auto rounded bg-slate-950 border border-slate-800 p-1 text-[10px] whitespace-pre-wrap">{firewallCommands()}</pre>
                        </details>
                      )}
                      {routeResult && (
                        <div id="live-route-result" className={routeResult.ok ? 'text-emerald-300' : 'text-rose-300'}>
                          {routeResult.message}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {result && result.errors.length > 0 && <div className="px-2 py-0.5 text-[10px] text-slate-500">{result.errors.join('; ')}</div>}
            <div className="flex items-center gap-1 px-2 pt-1">
              <input
                id="live-plc-addresses"
                value={addresses}
                onChange={(e) => setAddresses(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') run();
                }}
                placeholder="Also ask these addresses (PLCs behind a router)"
                className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
              />
            </div>
          </div>
        )}
        {!scan && remembered.length === 0 && <div className="px-2 py-1 text-slate-500">No remembered PLCs yet: enter one, then tick Remember.</div>}
      </div>
    </div>
  );
};
