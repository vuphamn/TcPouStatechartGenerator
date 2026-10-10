import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Binary, ChevronDown, ChevronRight, Eye, ExternalLink, Filter, ListTree, Loader2, Radio, RefreshCw, Search, Square, X } from 'lucide-react';
import type { LiveBrowseResult, SymbolChild } from '../utils/xaeHost.ts';
import type { LiveValue, WatchedVar } from '../utils/liveGuards.ts';
import { sameInstance } from '../utils/instanceLaunch.ts';

/**
 * PLC Symbols tab (Live, while connected): the PLC's symbols from a root (default MAIN.mainStateMachine), one level at
 * a time, with the values of numbers, booleans and strings. A member that holds the state variable is a state
 * machine: Watch follows it in its own tab / window, live, recording its transitions.
 * The type filter (at first the loaded POU's type): the instances of that type found under the root, searched
 * level by level, in one list; cleared, the whole tree. An instance of another type opens in a new MachineScope.
 */

export const DEFAULT_SYMBOL_ROOT = 'MAIN.mainStateMachine';
/** Most values followed at once for this window (the host also follows the guard variables) */
export const MAX_SYMBOL_VALUES = 60;
/** The type search: how deep under the root, and how many symbols it reads at most */
export const TYPE_SEARCH_DEPTH = 8;
export const TYPE_SEARCH_MAX_READS = 3000;
/** Reads in flight at once */
export const TYPE_SEARCH_PARALLEL = 12;
/** An array of plain values holds no instance: not opened */
const PLAIN_ARRAY = /^ARRAY\s*\[[^\]]*\]\s*OF\s+(BOOL|BYTE|WORD|DWORD|LWORD|SINT|USINT|INT|UINT|DINT|UDINT|LINT|ULINT|REAL|LREAL|TIME|LTIME|DATE|TOD|TIME_OF_DAY|DT|DATE_AND_TIME|BIT|W?STRING(\s*\(\s*\d+\s*\))?|POINTER\s+TO\s+.+|REFERENCE\s+TO\s+.+)\s*$/i;

// The last search's results for each PLC, root and type: shown at once the next time, while it searches again
const foundKey = (plc: string, root: string, type: string) => `kss.symbols.found.${plc}|${root.toLowerCase()}|${type}`;
function loadFound(key: string): SymbolChild[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? (v as SymbolChild[]).slice(0, 200) : [];
  } catch {
    return [];
  }
}
function saveFound(key: string, matches: SymbolChild[]) {
  try {
    localStorage.setItem(key, JSON.stringify(matches.slice(0, 200)));
  } catch {
    // per-viewer convenience only
  }
}

/** A symbol's type without its namespace (Lib.SM_X -> SM_X) */
export const bareType = (type: string) => type.trim().split('.').pop() ?? '';

interface SymbolBrowserWindowProps {
  connected: boolean;
  root: string;
  onRootChange: (root: string) => void;
  /** A symbol's members, one level */
  browse: (path: string) => Promise<LiveBrowseResult>;
  /** Values and lookups by watch id (see symbolWatchId) */
  values: Record<string, LiveValue>;
  watched: Record<string, WatchedVar>;
  /** A value written to the PLC (asked first); absent where values cannot be written */
  onWriteValue?: (v: { name: string; id: string; symbol?: string; type?: string; text: string }) => void;
  /** The value symbols on show (the host follows them) */
  onVisibleValues: (paths: string[]) => void;
  /** The instance this window follows */
  currentInstance?: string;
  stateVar: string;
  onWatch: (node: SymbolChild) => void;
  /** Another type's instance opened in this window instead of a new one (its POU replaces this one) */
  onOpenHere?: (node: SymbolChild) => void;
  openTarget: 'tab' | 'window';
  /** The loaded POU's type (SM_TableManager): the type filter starts with it */
  loadedType?: string;
  /** false: the PLC runs another project than the loaded POU's (its type of that name is its own: opened with its POU) */
  loadedIsLive?: boolean;
  /** Another instance of the loaded POU, followed here instead (live again on it) */
  onGoLiveHere?: (path: string) => void;
  /** The connected PLC (netId:port): the type search's results are remembered for it */
  plcKey?: string;
}

const typeKey = (t: string) => `kss.symbols.type.${t.toLowerCase()}`;
const readTypeFilter = (loaded?: string) => {
  if (!loaded) return '';
  try {
    const v = localStorage.getItem(typeKey(loaded));
    return v === null ? loaded : v;
  } catch {
    return loaded;
  }
};

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
  onWriteValue,
  onVisibleValues,
  currentInstance,
  stateVar,
  onWatch,
  onOpenHere,
  openTarget,
  loadedType,
  loadedIsLive = true,
  onGoLiveHere,
  plcKey,
}) => {
  // Another type: in this window too (its POU instead of this one)
  const openHereButton = (c: SymbolChild) =>
    onOpenHere ? (
      <button
        onClick={() => onOpenHere(c)}
        className="symbol-open-other-here shrink-0 flex items-center gap-1 px-1.5 rounded font-sans text-[11px] text-emerald-300 hover:bg-slate-700"
        title={`${bareType(c.type)} in this ${openTarget} instead of the loaded POU, live on ${c.path}`}
      >
        <Radio className="w-3 h-3" /> Here
      </button>
    ) : null;
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState('');
  const [rootDraft, setRootDraft] = useState(root);
  // The type filter: the loaded POU's type at first; what was typed here, kept for that POU type
  const [typeFilter, setTypeFilterState] = useState(() => readTypeFilter(loadedType));
  const typeTouchedRef = useRef(false);
  useEffect(() => {
    setTypeFilterState(readTypeFilter(loadedType));
  }, [loadedType]);
  const setTypeFilter = (v: string) => {
    typeTouchedRef.current = true;
    setTypeFilterState(v);
    if (!loadedType) return;
    try {
      // (the loaded type itself: the default, nothing kept)
      if (v.trim().toLowerCase() === loadedType.toLowerCase()) localStorage.removeItem(typeKey(loadedType));
      else localStorage.setItem(typeKey(loadedType), v);
    } catch {
      // per-viewer convenience only
    }
  };
  const typeNeedle = typeFilter.trim().toLowerCase();
  // Where the search starts: the Root, or all of MAIN
  const [searchMain, setSearchMain] = useState(false);
  const searchRoot = searchMain ? 'MAIN' : root;
  const [search, setSearch] = useState<{ matches: SymbolChild[]; reads: number; done: boolean; capped: boolean; errors: number; stopped?: boolean; remembered?: boolean }>({ matches: [], reads: 0, done: true, capped: false, errors: 0 });
  const searchMatchesRef = useRef<SymbolChild[]>([]);
  const searchGenRef = useRef(0);
  // (the search reads through the latest browse: a new function each render must not start it again)
  const browseRef = useRef(browse);
  browseRef.current = browse;
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
    if (typeNeedle) setSearchNonce((n) => n + 1);
  };

  // The type search: level by level from the root (a few reads at a time), every member whose type matches
  const [searchNonce, setSearchNonce] = useState(0);
  useEffect(() => {
    const gen = ++searchGenRef.current;
    if (!connected || !searchRoot || !typeNeedle) {
      setSearch({ matches: [], reads: 0, done: true, capped: false, errors: 0 });
      return;
    }
    // (typing: waits for a pause; shown as searching from now on, not "0 found"; what it found last time on this PLC
    // at once)
    const key = plcKey ? foundKey(plcKey, searchRoot, typeNeedle) : '';
    const before = key ? loadFound(key) : [];
    setSearch({ matches: before, reads: 0, done: false, capped: false, errors: 0, remembered: before.length > 0 });
    const timer = window.setTimeout(() => {
      const matches: SymbolChild[] = [];
      searchMatchesRef.current = matches;
      let reads = 0;
      let errors = 0;
      let capped = false;
      const alive = () => searchGenRef.current === gen;
      // (an array of them is not one: its elements are)
      const matchesType = (c: SymbolChild) => c.kind !== 'array' && bareType(c.type).toLowerCase().includes(typeNeedle);
      void (async () => {
        let level = [searchRoot];
        for (let depth = 0; depth < TYPE_SEARCH_DEPTH && level.length && alive(); depth++) {
          const next: string[] = [];
          for (let i = 0; i < level.length && alive(); i += TYPE_SEARCH_PARALLEL) {
            if (reads >= TYPE_SEARCH_MAX_READS) {
              capped = true;
              break;
            }
            const batch = level.slice(i, Math.min(i + TYPE_SEARCH_PARALLEL, i + TYPE_SEARCH_MAX_READS - reads));
            reads += batch.length;
            const results = await Promise.all(batch.map((p) => browseRef.current(p).catch((e: unknown) => ({ requestId: 0, path: p, error: String(e) }) as LiveBrowseResult)));
            if (!alive()) return;
            for (const r of results) {
              if (r.error) {
                errors++;
                continue;
              }
              for (const c of r.children ?? []) {
                if (matchesType(c)) matches.push(c);
                // (into FBs, structs and arrays: an instance can be in any of them)
                if (c.kind === 'struct' || (c.kind === 'array' && !PLAIN_ARRAY.test(c.type.trim()))) next.push(c.path);
              }
            }
            // (the remembered ones until this search has found some)
            setSearch({ matches: matches.length || !before.length ? [...matches] : before, reads, done: false, capped: false, errors, remembered: !matches.length && before.length > 0 });
          }
          if (capped) break;
          level = next;
        }
        if (!alive()) return;
        const sorted = [...matches].sort((a, b) => a.path.localeCompare(b.path));
        if (key && !errors) saveFound(key, sorted);
        setSearch({ matches: sorted, reads, done: true, capped, errors });
      })();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [connected, searchRoot, typeNeedle, searchNonce, plcKey]);
  const stopSearch = () => {
    searchGenRef.current++;
    setSearch((s) => ({ ...s, matches: [...searchMatchesRef.current].sort((a, b) => a.path.localeCompare(b.path)), done: true, stopped: true }));
  };
  const sameAsLoaded = (c: SymbolChild) => loadedIsLive && !!loadedType && bareType(c.type).toLowerCase() === loadedType.toLowerCase();

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
          <Filter className="w-3 h-3 text-slate-500 shrink-0" />
          <input
            id="symbol-browser-type-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            placeholder="Instances of a type (empty: the whole tree)"
            spellCheck={false}
            title={`Only the instances of this type under ${root} (at first the loaded POU's type). Clear it for the whole tree`}
            className={`flex-1 min-w-0 bg-slate-950 border rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 placeholder:font-sans ${typeNeedle ? 'border-sky-700' : 'border-slate-700'}`}
          />
          {typeFilter && (
            <button
              id="symbol-browser-type-clear"
              onClick={() => setTypeFilter('')}
              className="p-0.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              title="Clear: the whole tree, every type"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          {loadedType && typeFilter.trim().toLowerCase() !== loadedType.toLowerCase() && (
            <button
              id="symbol-browser-type-loaded"
              onClick={() => setTypeFilter(loadedType)}
              className="px-1.5 rounded border border-slate-700 text-[10px] text-slate-300 hover:bg-slate-800 shrink-0"
              title={`Only the instances of ${loadedType} (the loaded POU)`}
            >
              {loadedType}
            </button>
          )}
        </div>
        <div className={`flex items-center gap-1.5 ${typeNeedle ? 'hidden' : ''}`}>
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
        ) : typeNeedle ? (
          // The instances of the type, in one list
          <div id="symbol-browser-instances">
            <div id="symbol-browser-search-status" className="flex items-center gap-1.5 px-2 py-0.5 font-sans text-slate-400">
              {!search.done && <Loader2 className="w-3 h-3 animate-spin" />}
              <span>
                {search.done
                  ? `${search.matches.length} instance${search.matches.length === 1 ? '' : 's'} of ${typeFilter.trim()} under ${searchRoot}${search.stopped ? ' (stopped)' : ''}`
                  : search.remembered
                    ? `${search.matches.length} found last time; searching ${searchRoot} again… (${search.reads} read)`
                    : `Searching ${searchRoot} for ${typeFilter.trim()}… (${search.reads} read, ${search.matches.length} found)`}
                {search.done && search.capped && ` (stopped after ${search.reads} symbols: a narrower root finds the rest)`}
                {search.done && search.errors > 0 && ` (${search.errors} could not be read)`}
              </span>
            </div>
            {typeNeedle && (
              <div className="flex items-center gap-1.5 px-2 pb-1 font-sans text-[10px] text-slate-500">
                <span>Search in</span>
                <button id="symbol-browser-search-root" onClick={() => setSearchMain(false)} className={`px-1.5 rounded border ${!searchMain ? 'border-sky-700 text-sky-200' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`} title="From the Root above">
                  {root}
                </button>
                {root !== 'MAIN' && (
                  <button id="symbol-browser-search-main" onClick={() => setSearchMain(true)} className={`px-1.5 rounded border ${searchMain ? 'border-sky-700 text-sky-200' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`} title="All of MAIN (slower)">
                    MAIN
                  </button>
                )}
                {!search.done && (
                  <button id="symbol-browser-search-stop" onClick={stopSearch} className="ml-auto flex items-center gap-1 px-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800" title="Stop: keep what was found">
                    <Square className="w-2.5 h-2.5" /> Stop
                  </button>
                )}
              </div>
            )}
            {search.done && search.matches.length === 0 && (
              <div className="px-6 py-2 text-slate-500 font-sans">
                None found. Clear the filter for the whole tree, or change the Root.
              </div>
            )}
            {search.matches.map((c) => {
              const here = sameInstance(c.path, currentInstance);
              const other = !sameAsLoaded(c);
              const open = () => {
                if (!here) onWatch(c);
              };
              return (
                <div
                  key={c.path}
                  className={`symbol-row symbol-instance-row group flex items-center gap-1.5 px-2 py-[2px] hover:bg-slate-800/60 ${here ? '' : 'cursor-pointer'}`}
                  data-path={c.path}
                  data-kind={c.kind}
                  data-other-type={other ? 'true' : undefined}
                  onDoubleClick={open}
                  title={here ? `${c.path}: this ${openTarget} follows it` : other ? `${c.path} is a ${bareType(c.type)}: double-click or Open for a new MachineScope on it, live` : `${c.path}: double-click or Watch to follow it in a new ${openTarget}`}
                >
                  <span className={`truncate ${c.stateMachine ? 'text-sky-200 font-semibold' : 'text-slate-200'}`}>{c.path}</span>
                  <span className="text-slate-500 truncate min-w-0 flex-1">{c.type}</span>
                  {here ? (
                    <span className="shrink-0 font-sans text-[10px] text-emerald-300">this {openTarget}</span>
                  ) : other ? (
                    <>
                      {openHereButton(c)}
                      <button
                        onClick={open}
                        className="symbol-open-other shrink-0 flex items-center gap-1 px-1.5 rounded font-sans text-[11px] text-amber-200 hover:bg-slate-700"
                        title={`A new MachineScope for ${bareType(c.type)}, live on ${c.path}`}
                      >
                        <ExternalLink className="w-3 h-3" /> Open
                      </button>
                    </>
                  ) : (
                    <>
                      {onGoLiveHere && (
                        <button
                          onClick={() => onGoLiveHere(c.path)}
                          className="symbol-here shrink-0 flex items-center gap-1 px-1.5 rounded font-sans text-[11px] text-emerald-300 hover:bg-slate-700"
                          title={`Follow ${c.path} in this ${openTarget} instead (live again on it)`}
                        >
                          <Radio className="w-3 h-3" /> Here
                        </button>
                      )}
                    <button
                      onClick={open}
                      className="symbol-watch shrink-0 flex items-center gap-1 px-1.5 rounded font-sans text-[11px] text-sky-300 hover:bg-slate-700"
                      title={`Follow ${c.path} (${c.type}) in a new ${openTarget}: its diagram, live, with its transitions recorded`}
                    >
                      <Eye className="w-3 h-3" /> Watch
                    </button>
                    </>
                  )}
                </div>
              );
            })}
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
                    {value &&
                      (onWriteValue && !lookupError && values[id] !== undefined ? (
                        <button
                          className={`symbol-value symbol-write shrink-0 max-w-[45%] truncate text-right underline decoration-dotted decoration-slate-600 hover:text-sky-300 ${value.cls}`}
                          title={`${c.path} = ${value.text}: click to write a value…`}
                          onClick={() => onWriteValue({ name: c.path, id, symbol: watched[id]?.symbol ?? c.path, type: watched[id]?.type ?? c.type, text: value.text })}
                        >
                          {value.text}
                        </button>
                      ) : (
                        <span className={`symbol-value shrink-0 max-w-[45%] truncate text-right ${lookupError ? 'text-amber-300/80' : value.cls}`} title={lookupError ?? `${c.path} = ${value.text}`}>
                          {lookupError ? '?' : value.text}
                        </span>
                      ))}
                    {c.stateMachine &&
                      (here ? (
                        <span className="shrink-0 font-sans text-[10px] text-emerald-300">this {openTarget}</span>
                      ) : loadedType && !sameAsLoaded(c) ? (
                        <>
                          {openHereButton(c)}
                          <button
                            onClick={() => onWatch(c)}
                            className="symbol-open-other shrink-0 flex items-center gap-1 px-1.5 rounded font-sans text-[11px] text-amber-200 hover:bg-slate-700"
                            title={`A new MachineScope for ${bareType(c.type)}, live on ${c.path}`}
                          >
                            <ExternalLink className="w-3 h-3" /> Open
                          </button>
                        </>
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
        {loadedType && (
          <>
            {' '}
            Another type's have <span className="text-amber-200">Open</span>: a new MachineScope for that type, live on it (<span className="text-emerald-300">Here</span>: in this one instead).
          </>
        )}
      </div>
    </div>
  );
};
