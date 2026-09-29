import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Pencil, RefreshCw, Star, X } from 'lucide-react';
import type { AddRouteBoth, AddRouteResult, FoundPlc, PlcScanResult, RememberedPlc } from '../utils/plcDiscovery.ts';
import type { CheckRequest, CheckResult } from '../utils/connectionCheck.ts';

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
  return { checks, checkingAll, checkAll, every, setEvery, lost };
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
}

const rowClass = (current: boolean) =>
  `w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-800 ${current ? 'bg-sky-950/60' : ''}`;

/** The Live tab's Browse: the remembered PLCs and the TwinCAT devices found on the network; a click picks one */
export const PlcBrowser: React.FC<PlcBrowserProps> = ({ mode, remembered, currentNetId, onPick, onFound, onForget, onClose, scan, addRoute, onRename, checkPlc, checker }) => {
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
        {scan && (
          <button id="live-plc-rescan" onClick={run} disabled={scanning} className="flex items-center gap-1 px-1.5 rounded text-slate-300 hover:bg-slate-800 disabled:opacity-50" title="Search the network again">
            <RefreshCw className="w-3 h-3" /> Search again
          </button>
        )}
        <button id="live-plc-browser-close" onClick={onClose} className="p-0.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800" title="Close">
          <X className="w-3 h-3" />
        </button>
      </div>
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
                    title="Check them all again every few minutes (while this app is open): a PLC that stops answering is marked"
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
                {checkMark(p.netId)}
              </div>
            ))}
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
                  </div>
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
                          <label className="flex items-center gap-1.5 text-slate-300" title={`TwinCAT runs on this PC too (${result.localTwinCat}): the route pair XAE's Add Route makes, so XAE and StateScope both reach the PLC`}>
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
