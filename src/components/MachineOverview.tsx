import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Eye, LayoutGrid, Loader2, RefreshCw, Search } from 'lucide-react';
import type { LiveBrowseResult, SymbolChild } from '../utils/xaeHost.ts';
import type { LiveValue } from '../utils/liveGuards.ts';
import { formatDuration } from '../utils/liveView.ts';
import { sameInstance } from '../utils/instanceLaunch.ts';

/**
 * Machine Overview (MiddlePanel tab, while live): every state machine under a root (default MAIN.mainStateMachine),
 * found by walking the PLC's symbols, with its current state, time in state and the changes seen. Error states
 * stand out; Watch opens a machine's diagram in its own tab / window, live on it.
 */

export interface OverviewMachine {
  path: string;
  type: string;
  /** The state enum's names by value (from the PLC's data types, or the loaded .TcDUT for this POU's type) */
  stateNames?: Record<string, string>;
}

/** Most machines followed at once (the host also follows the guard variables and the Symbols window's values) */
export const MAX_OVERVIEW_MACHINES = 80;
/** Walking the symbols: how deep, and how many symbols are read at most */
const MAX_DEPTH = 5;
const MAX_BROWSES = 400;
/** Library blocks that hold no state machines: not walked into */
const LIBRARY_TYPE = /^(TON|TOF|TP|R_TRIG|F_TRIG|CTU|CTD|CTUD|RS|SR|LTON|LTOF|LTP|MC_\w+|AXIS_REF\w*|NCTOPLC\w*|PLCTONC\w*|FB_(?:Ads|File|Json|Log|Sql|Xml)\w*|T_\w+|ST_Lib\w*)$/i;
/** A state that is an error (red) */
export const ERROR_STATE = /ERROR|FAULT|ALARM|E_?STOP|ABORT/i;

export const overviewWatchId = (path: string) => `ov:${path.toLowerCase()}`;

interface MachineOverviewProps {
  connected: boolean;
  root: string;
  onRootChange: (root: string) => void;
  browse: (path: string) => Promise<LiveBrowseResult>;
  /** Values by watch id (overviewWatchId) */
  values: Record<string, LiveValue>;
  /** The machines to follow (their state variables) */
  onFollow: (paths: string[]) => void;
  stateVar: string;
  currentInstance?: string;
  /** This POU's type and its enum from the loaded .TcDUT (names when the PLC does not describe the enum) */
  pouTypeName?: string;
  pouStateNames?: Map<number, string>;
  onWatch: (machine: SymbolChild) => void;
  openTarget: 'tab' | 'window';
}

interface Track {
  value: number | null;
  since: number;
  changes: number;
  /** Known since the machine was first seen (the time in state is at least this) */
  sinceStart: boolean;
}

type SortKey = 'path' | 'state' | 'time';

const lastSegment = (t: string) => t.trim().split('.').pop() ?? t;

export const MachineOverview: React.FC<MachineOverviewProps> = ({
  connected,
  root,
  onRootChange,
  browse,
  values,
  onFollow,
  stateVar,
  currentInstance,
  pouTypeName,
  pouStateNames,
  onWatch,
  openTarget,
}) => {
  const [machines, setMachines] = useState<OverviewMachine[]>([]);
  const [scan, setScan] = useState<{ state: 'idle' | 'scanning' | 'done' | 'error'; read: number; message?: string; truncated?: boolean }>({ state: 'idle', read: 0 });
  const [rootDraft, setRootDraft] = useState(root);
  const [filter, setFilter] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('path');
  const scanRef = useRef(0);

  // Walk the symbols from the root: every member that holds the state variable is a machine (nested ones too)
  const discover = useCallback(async () => {
    const id = ++scanRef.current;
    setScan({ state: 'scanning', read: 0 });
    setMachines([]);
    const found = new Map<string, OverviewMachine>();
    const queue: { path: string; depth: number }[] = [{ path: root, depth: 0 }];
    const seen = new Set<string>();
    let read = 0;
    let truncated = false;
    let rootError: string | null = null;
    const step = async (item: { path: string; depth: number }) => {
      const r = await browse(item.path);
      read++;
      if (r.error) {
        if (item.path === root) rootError = r.error;
        return;
      }
      if (r.stateMachine && !found.has(r.path.toLowerCase())) found.set(r.path.toLowerCase(), { path: r.path, type: r.symbolType ?? '', stateNames: r.stateNames });
      for (const c of r.children ?? []) {
        if (c.stateMachine && !found.has(c.path.toLowerCase())) found.set(c.path.toLowerCase(), { path: c.path, type: c.type, stateNames: c.stateNames });
        const into = (c.kind === 'struct' || c.kind === 'array') && !LIBRARY_TYPE.test(lastSegment(c.type).replace(/^ARRAY.*OF\s+/i, ''));
        if (into && item.depth + 1 <= MAX_DEPTH && !seen.has(c.path.toLowerCase())) {
          seen.add(c.path.toLowerCase());
          queue.push({ path: c.path, depth: item.depth + 1 });
        }
      }
    };
    seen.add(root.toLowerCase());
    // A few symbols at a time
    while (queue.length && id === scanRef.current) {
      if (read >= MAX_BROWSES) {
        truncated = true;
        break;
      }
      const batch = queue.splice(0, 4);
      await Promise.all(batch.map(step));
      if (id !== scanRef.current) return;
      setScan({ state: 'scanning', read });
      setMachines([...found.values()]);
    }
    if (id !== scanRef.current) return;
    setMachines([...found.values()].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true })));
    setScan(rootError ? { state: 'error', read, message: rootError } : { state: 'done', read, truncated });
  }, [browse, root]);

  useEffect(() => {
    setRootDraft(root);
    if (!connected) {
      scanRef.current++;
      setScan({ state: 'idle', read: 0 });
      return;
    }
    void discover();
  }, [connected, root, discover]);

  // Follow the machines' state variables (the first ones: the host has a limit)
  const followed = useMemo(() => machines.slice(0, MAX_OVERVIEW_MACHINES), [machines]);
  const followKey = followed.map((m) => m.path).join('\n');
  useEffect(() => {
    onFollow(followKey ? followKey.split('\n') : []);
  }, [followKey, onFollow]);
  useEffect(() => () => onFollow([]), [onFollow]);

  // Changes seen, and since when each machine is in its state
  const tracks = useRef(new Map<string, Track>());
  const [, setTick] = useState(0);
  useEffect(() => {
    let changed = false;
    for (const m of followed) {
      const v = values[overviewWatchId(m.path)];
      const value = typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : null;
      const t = tracks.current.get(m.path);
      if (!t) {
        tracks.current.set(m.path, { value, since: Date.now(), changes: 0, sinceStart: true });
        changed = true;
      } else if (value !== t.value) {
        if (t.value !== null && value !== null) {
          t.changes++;
          t.sinceStart = false;
        }
        t.value = value;
        t.since = Date.now();
        changed = true;
      }
    }
    if (changed) setTick((n) => n + 1);
  }, [followed, values]);
  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [connected]);
  useEffect(() => {
    if (!connected) tracks.current.clear();
  }, [connected]);

  const stateName = (m: OverviewMachine, value: number | null) => {
    if (value === null) return null;
    const plc = m.stateNames?.[String(value)];
    if (plc) return plc;
    if (pouStateNames && pouTypeName && lastSegment(m.type).toLowerCase() === pouTypeName.toLowerCase()) return pouStateNames.get(value) ?? null;
    return null;
  };

  const now = Date.now();
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = followed.map((m) => {
      const t = tracks.current.get(m.path);
      const value = t?.value ?? null;
      const name = stateName(m, value);
      return { m, value, name, error: !!name && ERROR_STATE.test(name), since: t?.since ?? now, changes: t?.changes ?? 0, sinceStart: t?.sinceStart ?? true };
    });
    const shown = list.filter((r) => (!errorsOnly || r.error) && (!q || r.m.path.toLowerCase().includes(q) || r.m.type.toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q)));
    if (sort === 'state') shown.sort((a, b) => Number(b.error) - Number(a.error) || (a.name ?? `#${a.value}`).localeCompare(b.name ?? `#${b.value}`));
    else if (sort === 'time') shown.sort((a, b) => a.since - b.since);
    return shown;
    // (values / tick re-render this; tracks is a ref)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followed, values, filter, errorsOnly, sort, now]);
  const errorCount = followed.filter((m) => {
    const n = stateName(m, tracks.current.get(m.path)?.value ?? null);
    return !!n && ERROR_STATE.test(n);
  }).length;
  const relative = (p: string) => (p.toLowerCase().startsWith(root.toLowerCase() + '.') ? p.slice(root.length + 1) : p.toLowerCase() === root.toLowerCase() ? '(root)' : p);

  return (
    <div id="machine-overview" className="flex-1 min-h-0 w-full flex flex-col bg-slate-950 text-xs">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-800 shrink-0">
        <LayoutGrid className="w-4 h-4 text-sky-400" />
        <span className="font-semibold tracking-wide text-slate-300">MACHINE OVERVIEW</span>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const r = rootDraft.trim();
            if (r && r !== root) onRootChange(r);
            else if (r && connected) void discover();
          }}
        >
          <input
            id="overview-root"
            value={rootDraft}
            onChange={(e) => setRootDraft(e.target.value)}
            spellCheck={false}
            className="w-64 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200"
            title="Where the machines are looked for"
          />
          <button id="overview-rescan" type="submit" disabled={!connected || scan.state === 'scanning'} className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40" title="Look for the machines again (after a download)">
            <RefreshCw className={`w-3 h-3 ${scan.state === 'scanning' ? 'animate-spin' : ''}`} /> Rescan
          </button>
        </form>
        <div className="relative flex items-center">
          <Search className="w-3 h-3 text-slate-500 absolute left-1.5 pointer-events-none" />
          <input id="overview-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter machines, types, states" className="w-52 bg-slate-900 border border-slate-700 rounded pl-6 pr-1.5 py-0.5 text-[11px] text-slate-200 placeholder:text-slate-500" />
        </div>
        <label className="flex items-center gap-1 text-slate-400 cursor-pointer">
          <input id="overview-errors-only" type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Errors only
        </label>
        <label className="flex items-center gap-1 text-slate-400">
          Sort
          <select id="overview-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[11px] text-slate-200">
            <option value="path">by machine</option>
            <option value="state">errors first, by state</option>
            <option value="time">longest in state first</option>
          </select>
        </label>
        <span id="overview-summary" className="ml-auto text-slate-400">
          {machines.length} machine{machines.length === 1 ? '' : 's'}
          {errorCount > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 px-1.5 rounded-full bg-rose-950 border border-rose-800 text-rose-300">
              <AlertTriangle className="w-3 h-3" /> {errorCount} in error
            </span>
          )}
        </span>
      </div>

      {!connected ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400 p-6 text-center">
          <LayoutGrid className="w-7 h-7 text-slate-600" />
          <p>Go live (Live tab) to see every state machine of the PLC with its current state.</p>
          <p className="text-slate-500">The machines are looked for under {root}.</p>
        </div>
      ) : (
        <>
          {(scan.state === 'scanning' || scan.state === 'error' || scan.truncated || machines.length > MAX_OVERVIEW_MACHINES) && (
            <div id="overview-scan" className={`px-3 py-1 text-[11px] border-b shrink-0 ${scan.state === 'error' ? 'text-rose-300 border-rose-900 bg-rose-950/40' : 'text-slate-400 border-slate-800'}`}>
              {scan.state === 'scanning' && (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Looking for machines under {root}: {scan.read} symbols read, {machines.length} found...
                </span>
              )}
              {scan.state === 'error' && scan.message}
              {scan.truncated && `Stopped after ${MAX_BROWSES} symbols: set a root deeper in the program to see the rest. `}
              {machines.length > MAX_OVERVIEW_MACHINES && `The first ${MAX_OVERVIEW_MACHINES} of ${machines.length} machines are followed (filter or set a root to see others).`}
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left font-semibold px-3 py-1.5">Machine</th>
                  <th className="text-left font-semibold px-2 py-1.5">Type</th>
                  <th className="text-left font-semibold px-2 py-1.5">State</th>
                  <th className="text-right font-semibold px-2 py-1.5">In state</th>
                  <th className="text-right font-semibold px-2 py-1.5">Changes</th>
                  <th className="px-3 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const here = sameInstance(r.m.path, currentInstance);
                  return (
                    <tr
                      key={r.m.path}
                      className={`overview-row border-b border-slate-800/70 ${r.error ? 'bg-rose-950/40' : 'hover:bg-slate-900/60'}`}
                      data-path={r.m.path}
                      data-error={r.error ? 'true' : undefined}
                      onDoubleClick={() => !here && onWatch({ name: lastSegment(r.m.path), path: r.m.path, type: r.m.type, kind: 'struct', stateMachine: true })}
                    >
                      <td className="px-3 py-1 font-mono text-slate-200" title={r.m.path}>
                        {relative(r.m.path)}
                      </td>
                      <td className="px-2 py-1 font-mono text-slate-500">{r.m.type}</td>
                      <td className={`overview-state px-2 py-1 font-mono font-semibold ${r.error ? 'text-rose-300' : r.value === null ? 'text-slate-600' : 'text-emerald-300'}`} title={r.value === null ? `${r.m.path}.${stateVar}: no value yet` : `${r.m.path}.${stateVar} = ${r.value}`}>
                        {r.error && <AlertTriangle className="inline w-3 h-3 mr-1 -mt-0.5" />}
                        {r.value === null ? '…' : r.name ?? `#${r.value}`}
                      </td>
                      <td className="overview-time px-2 py-1 text-right font-mono text-slate-300" title={r.sinceStart ? 'At least this long: since the overview started following it' : undefined}>
                        {r.value === null ? '' : `${r.sinceStart ? '≥ ' : ''}${formatDuration(now - r.since)}`}
                      </td>
                      <td className="overview-changes px-2 py-1 text-right font-mono text-slate-400">{r.changes}</td>
                      <td className="px-3 py-1 text-right">
                        {here ? (
                          <span className="text-[10px] text-emerald-300">this {openTarget}</span>
                        ) : (
                          <button
                            onClick={() => onWatch({ name: lastSegment(r.m.path), path: r.m.path, type: r.m.type, kind: 'struct', stateMachine: true })}
                            className="overview-watch inline-flex items-center gap-1 px-1.5 rounded text-[11px] text-sky-300 hover:bg-slate-800"
                            title={`Open ${r.m.path}'s diagram in a new ${openTarget}, live on it`}
                          >
                            <Eye className="w-3 h-3" /> Watch
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && scan.state !== 'scanning' && (
              <div className="p-6 text-center text-slate-500">
                {machines.length === 0 ? `No state machines (members with ${stateVar}) under ${root}.` : 'No machine matches.'}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
