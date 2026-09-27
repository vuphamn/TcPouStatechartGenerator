import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Binary, ChevronDown, ChevronRight, Eye, ListTree, Loader2, RefreshCw, Search } from 'lucide-react';
import type { LiveBrowseResult, SymbolChild } from '../utils/xaeHost.ts';
import type { LiveValue, WatchedVar } from '../utils/liveGuards.ts';
import { sameInstance } from '../utils/instanceLaunch.ts';

/**
 * PLC Symbols tab (Live, while connected): the PLC's symbols from a root (default MAIN.mainStateMachine), one level at
 * a time, with the values of numbers, booleans and strings. A member that holds the state variable is a state
 * machine: Watch follows it in its own tab / window, live, recording its transitions.
 */

export const DEFAULT_SYMBOL_ROOT = 'MAIN.mainStateMachine';
/** Most values followed at once for this window (the host also follows the guard variables) */
export const MAX_SYMBOL_VALUES = 60;

interface SymbolBrowserWindowProps {
  connected: boolean;
  root: string;
  onRootChange: (root: string) => void;
  /** A symbol's members, one level */
  browse: (path: string) => Promise<LiveBrowseResult>;
  /** Values and lookups by watch id (see symbolWatchId) */
  values: Record<string, LiveValue>;
  watched: Record<string, WatchedVar>;
  /** The value symbols on show (the host follows them) */
  onVisibleValues: (paths: string[]) => void;
  /** The instance this window follows */
  currentInstance?: string;
  stateVar: string;
  onWatch: (node: SymbolChild) => void;
  openTarget: 'tab' | 'window';
}

export const symbolWatchId = (path: string) => `sym:${path.toLowerCase()}`;

type Loaded = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ok'; node: LiveBrowseResult };


function formatValue(v: LiveValue | undefined): { text: string; cls: string } {
  if (v === undefined) return { text: '…', cls: 'text-slate-600' };
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', cls: v ? 'text-emerald-300' : 'text-slate-400' };
  if (typeof v === 'string') return { text: `'${v}'`, cls: 'text-amber-200' };
  return { text: Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(7))), cls: 'text-sky-200' };
}

export const SymbolBrowserWindow: React.FC<SymbolBrowserWindowProps> = ({
  connected,
  root,
  onRootChange,
  browse,
  values,
  watched,
  onVisibleValues,
  currentInstance,
  stateVar,
  onWatch,
  openTarget,
}) => {
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState('');
  const [rootDraft, setRootDraft] = useState(root);
  const boxRef = useRef<HTMLDivElement>(null);
  // Latest load per path (a reload replaces an answer still on its way)
  const seqRef = useRef(new Map<string, number>());

  const load = useCallback(
    (path: string) => {
      const seq = (seqRef.current.get(path) ?? 0) + 1;
      seqRef.current.set(path, seq);
      setLoaded((prev) => ({ ...prev, [path]: prev[path]?.state === 'ok' ? prev[path] : { state: 'loading' } }));
      void browse(path).then((r) => {
        if (seqRef.current.get(path) !== seq) return;
        setLoaded((prev) => ({ ...prev, [path]: r.error ? { state: 'error', error: r.error } : { state: 'ok', node: r } }));
      });
    },
    [browse]
  );

  // The root, when connected (again) or changed
  useEffect(() => {
    setRootDraft(root);
    if (!connected || !root) return;
    setExpanded(new Set([root]));
    setLoaded({});
    load(root);
  }, [root, connected, load]);

  const toggle = (path: string) => {
    const opening = !expanded.has(path);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (opening) next.add(path);
      else next.delete(path);
      return next;
    });
    if (opening && (!loaded[path] || loaded[path].state === 'error')) load(path);
  };
  const refresh = () => {
    for (const p of expanded) load(p);
  };

  // What is on show, in tree order (filtered: matches and the members leading to them)
  const needle = filter.trim().toLowerCase();
  const rows = useMemo(() => {
    const out: { child: SymbolChild; depth: number }[] = [];
    const matches = (c: SymbolChild): boolean => {
      if (!needle || c.name.toLowerCase().includes(needle) || c.type.toLowerCase().includes(needle)) return true;
      const l = loaded[c.path];
      return expanded.has(c.path) && l?.state === 'ok' && (l.node.children ?? []).some(matches);
    };
    const walk = (path: string, depth: number) => {
      const l = loaded[path];
      if (l?.state !== 'ok') return;
      for (const c of l.node.children ?? []) {
        if (!matches(c)) continue;
        out.push({ child: c, depth });
        if (expanded.has(c.path)) walk(c.path, depth + 1);
      }
    };
    walk(root, 0);
    return out;
  }, [loaded, expanded, root, needle]);

  // Follow the values on show (the first ones: the host has a limit)
  const visibleKey = useMemo(
    () =>
      rows
        .filter((r) => r.child.kind === 'value')
        .slice(0, MAX_SYMBOL_VALUES)
        .map((r) => r.child.path)
        .join('\n'),
    [rows]
  );
  useEffect(() => {
    onVisibleValues(visibleKey ? visibleKey.split('\n') : []);
  }, [visibleKey, onVisibleValues]);
  useEffect(() => () => onVisibleValues([]), [onVisibleValues]);
  const valueCount = rows.filter((r) => r.child.kind === 'value').length;

  const rootLoad = loaded[root];

  return (
    <div
      id="symbol-browser-window"
      ref={boxRef}
      aria-label="PLC symbols"
      className="flex-1 min-h-0 flex flex-col bg-slate-950 text-xs overflow-hidden"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 bg-slate-900/80 select-none">
        <ListTree className="w-3.5 h-3.5 text-sky-400" />
        <span className="font-semibold text-slate-200">PLC Symbols</span>
        {connected ? (
          <span className="flex items-center gap-1 text-[10px] text-emerald-300">
            <span className="live-dot" /> live
          </span>
        ) : (
          <span className="text-[10px] text-slate-500">not connected</span>
        )}
        <button id="symbol-browser-refresh" onClick={refresh} disabled={!connected} className="ml-auto p-1 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800 disabled:opacity-40" title="Read the members again (after a download)">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-2 space-y-1.5 border-b border-slate-800 shrink-0">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const r = rootDraft.trim();
            if (r && r !== root) onRootChange(r);
            else if (r) {
              setLoaded({});
              load(r);
            }
          }}
        >
          <label htmlFor="symbol-browser-root" className="text-slate-400 shrink-0">
            Root
          </label>
          <input
            id="symbol-browser-root"
            value={rootDraft}
            onChange={(e) => setRootDraft(e.target.value)}
            placeholder={DEFAULT_SYMBOL_ROOT}
            spellCheck={false}
            className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
          />
          <button type="submit" className="px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">
            Browse
          </button>
        </form>
        <div className="flex items-center gap-1.5">
          <Search className="w-3 h-3 text-slate-500 shrink-0" />
          <input
            id="symbol-browser-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter the opened members by name or type"
            className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-200 placeholder:text-slate-600"
          />
        </div>
      </div>

      <div id="symbol-browser-tree" className="flex-1 min-h-0 overflow-auto py-1 font-mono text-[11px]">
        {!connected ? (
          <div id="symbol-browser-not-live" className="flex flex-col items-center justify-center gap-2 h-full p-6 text-center text-slate-400 font-sans text-xs">
            <ListTree className="w-7 h-7 text-slate-600" />
            <p>Go live (Live tab) to browse the PLC's symbols and their values.</p>
            <p className="text-slate-500">The tree starts at {root}. Watch opens a state machine found in it, live.</p>
          </div>
        ) : !rootLoad || rootLoad.state === 'loading' ? (
          <div className="p-4 flex items-center justify-center gap-2 text-slate-400 font-sans">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading {root}...
          </div>
        ) : rootLoad.state === 'error' ? (
          <div id="symbol-browser-error" className="p-4 text-center text-rose-300 font-sans">
            {rootLoad.error}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5 px-2 py-0.5 text-slate-300">
              <ListTree className="w-3 h-3 text-slate-500" />
              <span className="font-semibold">{root}</span>
              <span className="text-slate-500 truncate">{rootLoad.node.symbolType}</span>
            </div>
            {rows.length === 0 && <div className="px-6 py-2 text-slate-500 font-sans">{needle ? 'Nothing matches the filter.' : 'No members.'}</div>}
            {rows.map(({ child: c, depth }) => {
              const open = expanded.has(c.path);
              const l = loaded[c.path];
              const canOpen = c.kind === 'struct' || c.kind === 'array';
              const id = symbolWatchId(c.path);
              const value = c.kind === 'value' ? formatValue(values[id]) : null;
              const lookupError = c.kind === 'value' ? watched[id]?.error : undefined;
              const here = c.stateMachine && sameInstance(c.path, currentInstance);
              return (
                <React.Fragment key={c.path}>
                  <div
                    className={`symbol-row group flex items-center gap-1.5 pr-2 py-[1px] hover:bg-slate-800/60 ${c.stateMachine ? 'bg-sky-950/20' : ''}`}
                    style={{ paddingLeft: 8 + depth * 14 }}
                    data-path={c.path}
                    data-kind={c.kind}
                  >
                    {canOpen ? (
                      <button onClick={() => toggle(c.path)} className="symbol-toggle p-0.5 rounded text-slate-500 hover:text-slate-200" title={open ? 'Close' : 'Open'}>
                        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </button>
                    ) : (
                      <span className="w-4 flex justify-center text-slate-600">{c.kind === 'value' ? <Binary className="w-2.5 h-2.5" /> : '·'}</span>
                    )}
                    <span
                      className={`truncate ${c.stateMachine ? 'text-sky-200 font-semibold' : 'text-slate-200'} ${canOpen ? 'cursor-pointer' : ''}`}
                      onClick={canOpen ? () => toggle(c.path) : undefined}
                      title={c.path}
                    >
                      {c.name}
                    </span>
                    <span className="text-slate-500 truncate min-w-0 flex-1" title={c.type}>
                      {c.type}
                    </span>
                    {value && (
                      <span className={`symbol-value shrink-0 max-w-[45%] truncate text-right ${lookupError ? 'text-amber-300/80' : value.cls}`} title={lookupError ?? `${c.path} = ${value.text}`}>
                        {lookupError ? '?' : value.text}
                      </span>
                    )}
                    {c.stateMachine &&
                      (here ? (
                        <span className="shrink-0 font-sans text-[10px] text-emerald-300">this {openTarget}</span>
                      ) : (
                        <button
                          onClick={() => onWatch(c)}
                          className="symbol-watch shrink-0 flex items-center gap-1 px-1.5 rounded font-sans text-[11px] text-sky-300 hover:bg-slate-700"
                          title={`Follow ${c.path} (${c.type}) in a new ${openTarget}: its diagram, live, with its transitions recorded`}
                        >
                          <Eye className="w-3 h-3" /> Watch
                        </button>
                      ))}
                  </div>
                  {open && l?.state === 'loading' && (
                    <div className="flex items-center gap-1.5 py-0.5 text-slate-500 font-sans" style={{ paddingLeft: 30 + depth * 14 }}>
                      <Loader2 className="w-3 h-3 animate-spin" /> reading...
                    </div>
                  )}
                  {open && l?.state === 'error' && (
                    <div className="py-0.5 text-rose-300/90 font-sans" style={{ paddingLeft: 30 + depth * 14 }}>
                      {l.error}
                    </div>
                  )}
                  {open && l?.state === 'ok' && l.node.truncated && (
                    <div className="py-0.5 text-slate-500 font-sans" style={{ paddingLeft: 30 + depth * 14 }}>
                      (only the first {l.node.children?.length} are listed)
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-slate-800 text-[10px] text-slate-500 shrink-0">
        {valueCount > MAX_SYMBOL_VALUES
          ? `Values of the first ${MAX_SYMBOL_VALUES} of ${valueCount} shown (close members to see others). `
          : ''}
        State machines (with {stateVar}) have <span className="text-sky-300">Watch</span>: their diagram in a new {openTarget}, live.
      </div>
    </div>
  );
};
