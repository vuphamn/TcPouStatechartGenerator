import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  ListTree,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Target,
  ArrowRight,
  ArrowDownLeft,
  ArrowUpRight,
  Activity,
  Filter,
  ArrowDownAZ,
  ArrowDown01,
  Layers,
  Code2,
  AlertCircle,
  Play,
} from 'lucide-react';
import { IdentifiedPouState } from '../utils/pouStateExtractor.ts';
import { CustomNodeStylesMap } from '../types.ts';

export interface IdentifiedStatesSidebarSectionProps {
  states: IdentifiedPouState[];
  selectedStateId?: string | null;
  /** Live: the PLC's current state (marked, never scrolled to: the list stays where it is) */
  liveStateId?: string | null;
  /** Live: Follow (the Live tab's setting): on, the list shows each new live state (the canvas pans to it too) */
  liveFollow?: boolean;
  onLiveFollowChange?: (follow: boolean) => void;
  onJumpToState: (stateId: string, label?: string) => void;
  /** An item click with Follow off: select the state without moving the canvas (else onJumpToState) */
  onSelectState?: (stateId: string, label?: string) => void;
  customStyles?: CustomNodeStylesMap;
  stateVarName?: string;
  onOpenEnumEditor?: () => void;
  onOpenComplexityReport?: () => void;
  /** Grow into the free height of the parent column; the state list scrolls instead of stopping at a fixed height */
  fill?: boolean;
}

type FilterMode = 'all' | 'logic' | 'errors';
type SortMode = 'enum' | 'alpha' | 'complexity';

export const IdentifiedStatesSidebarSection: React.FC<IdentifiedStatesSidebarSectionProps> = ({
  states,
  selectedStateId,
  liveStateId,
  liveFollow = false,
  onLiveFollowChange,
  onJumpToState,
  onSelectState,
  customStyles,
  stateVarName = 'machineState',
  onOpenEnumEditor,
  onOpenComplexityReport,
  fill = false,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [sortMode, setSortMode] = useState<SortMode>('enum');
  const [recentlyNavigatedStateId, setRecentlyNavigatedStateId] = useState<string | null>(null);
  const navigatedTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (navigatedTimerRef.current) clearTimeout(navigatedTimerRef.current);
    };
  }, []);

  // An item click: selects the state; with Follow on it also pans the canvas there (as Go to State does)
  const handleItemClick = (stateId: string, label?: string) => {
    if (liveFollow || !onSelectState) {
      handleTriggerGoToState(stateId, label);
      return;
    }
    setRecentlyNavigatedStateId(stateId);
    if (navigatedTimerRef.current) clearTimeout(navigatedTimerRef.current);
    navigatedTimerRef.current = setTimeout(() => setRecentlyNavigatedStateId(null), 2600);
    onSelectState(stateId, label);
  };

  const handleTriggerGoToState = (stateId: string, label?: string) => {
    setRecentlyNavigatedStateId(stateId);
    if (navigatedTimerRef.current) {
      clearTimeout(navigatedTimerRef.current);
    }
    navigatedTimerRef.current = setTimeout(() => {
      setRecentlyNavigatedStateId(null);
    }, 2600);
    onJumpToState(stateId, label);
  };

  // Calculate incoming, outgoing and total transition counts for each state
  const stateTransitionsMap = useMemo(() => {
    const map = new Map<
      string,
      {
        incoming: string[];
        outgoing: string[];
        incomingCount: number;
        outgoingCount: number;
        totalCount: number;
      }
    >();

    // 1. Initialize with explicit arrays from states
    const incomingSetMap = new Map<string, Set<string>>();
    const outgoingSetMap = new Map<string, Set<string>>();

    states.forEach((s) => {
      incomingSetMap.set(s.id, new Set(s.incomingTransitions || []));
      outgoingSetMap.set(s.id, new Set(s.outgoingTransitions || []));
    });

    // 2. Cross-verify bidirectional transitions across all states
    states.forEach((s) => {
      const outList = s.outgoingTransitions || [];
      outList.forEach((targetId) => {
        if (!incomingSetMap.has(targetId)) {
          incomingSetMap.set(targetId, new Set());
        }
        incomingSetMap.get(targetId)!.add(s.id);
      });

      const inList = s.incomingTransitions || [];
      inList.forEach((srcId) => {
        if (!outgoingSetMap.has(srcId)) {
          outgoingSetMap.set(srcId, new Set());
        }
        outgoingSetMap.get(srcId)!.add(s.id);
      });
    });

    // 3. Assemble complete stats
    states.forEach((s) => {
      const inArray = Array.from(incomingSetMap.get(s.id) || []);
      const outArray = Array.from(outgoingSetMap.get(s.id) || []);
      map.set(s.id, {
        incoming: inArray,
        outgoing: outArray,
        incomingCount: inArray.length,
        outgoingCount: outArray.length,
        totalCount: inArray.length + outArray.length,
      });
    });

    return map;
  }, [states]);

  const totalTransitionsSum = useMemo(() => {
    let sum = 0;
    stateTransitionsMap.forEach((val) => {
      sum += val.outgoingCount;
    });
    return sum;
  }, [stateTransitionsMap]);

  // Extract distinct composite groups
  const availableGroups = useMemo(() => {
    const set = new Set<string>();
    states.forEach((s) => {
      if (s.compositeGroup) set.add(s.compositeGroup);
    });
    return Array.from(set).sort();
  }, [states]);

  // Filter and sort the states
  const filteredStates = useMemo(() => {
    let list = [...states];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          (s.description && s.description.toLowerCase().includes(q)) ||
          (s.compositeGroup && s.compositeGroup.toLowerCase().includes(q))
      );
    }

    // Filter mode
    if (filterMode === 'logic') {
      list = list.filter((s) => s.hasCaseBranch);
    } else if (filterMode === 'errors') {
      list = list.filter((s) => s.isErrorSink);
    }

    // Group filter
    if (selectedGroup !== 'all') {
      list = list.filter((s) => s.compositeGroup === selectedGroup);
    }

    // Sort mode
    if (sortMode === 'alpha') {
      list.sort((a, b) => a.id.localeCompare(b.id));
    } else if (sortMode === 'complexity') {
      list.sort((a, b) => {
        const statsA = stateTransitionsMap.get(a.id);
        const statsB = stateTransitionsMap.get(b.id);
        const totalA = statsA ? statsA.totalCount : 0;
        const totalB = statsB ? statsB.totalCount : 0;
        if (totalB !== totalA) return totalB - totalA;
        return a.enumIndex - b.enumIndex;
      });
    } else {
      list.sort((a, b) => a.enumIndex - b.enumIndex);
    }

    return list;
  }, [states, searchQuery, filterMode, selectedGroup, sortMode, stateTransitionsMap]);

  const logicCount = useMemo(() => states.filter((s) => s.hasCaseBranch).length, [states]);
  const scrollListRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to selected state/node when selected from Diagram Canvas
  useEffect(() => {
    if (!selectedStateId) return;

    // 1. Ensure section is expanded
    if (!isExpanded) {
      setIsExpanded(true);
    }

    // 2. Ensure the state is not hidden by filters
    const stateExists = states.some((s) => s.id === selectedStateId);
    if (!stateExists) return;

    const isVisible = filteredStates.some((s) => s.id === selectedStateId);
    if (!isVisible) {
      setSearchQuery('');
      setFilterMode('all');
      setSelectedGroup('all');
    }

    // 3. Scroll to state item after render
    const timer = setTimeout(() => {
      const itemEl = document.getElementById(`state-list-item-${selectedStateId}`);
      if (itemEl) {
        // Ensure parent sidebar also brings this section into view if scrolled away
        const sidebar = document.getElementById('source-files-sidebar');
        if (sidebar) {
          const itemRect = itemEl.getBoundingClientRect();
          const sRect = sidebar.getBoundingClientRect();
          if (itemRect.top < sRect.top || itemRect.bottom > sRect.bottom) {
            itemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }

        // Auto-scroll inside identified states list
        itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // Add visual pulse indicator
        itemEl.classList.remove('state-selected-pulse');
        void itemEl.offsetWidth; // force DOM reflow
        itemEl.classList.add('state-selected-pulse');
      }
    }, 60);

    return () => clearTimeout(timer);
  }, [selectedStateId, isExpanded, filteredStates, states]);


  // Live, Follow on: the list shows each new live state (the selection stays as it is)
  useEffect(() => {
    if (!liveFollow || !liveStateId || !isExpanded) return;
    const t = window.setTimeout(() => {
      document.getElementById(`state-list-item-${liveStateId}`)?.scrollIntoView({ block: 'nearest' });
    }, 50);
    return () => window.clearTimeout(t);
  }, [liveFollow, liveStateId, isExpanded]);

  return (
    <section
      id="identified-states-sidebar-section"
      className={`flex flex-col bg-slate-900/70 border border-slate-800/80 rounded-xl overflow-hidden shadow-sm ${
        fill && isExpanded ? 'flex-1 min-h-[360px]' : 'shrink-0'
      }`}
    >
      {/* Section Header */}
      <div
        className="flex items-center justify-between px-3.5 py-2.5 bg-slate-900/90 hover:bg-slate-800/50 cursor-pointer select-none transition-colors border-b border-slate-800/60"
        onClick={() => setIsExpanded(!isExpanded)}
        title={isExpanded ? 'Collapse section' : 'Expand section'}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-md bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
            <ListTree className="w-3.5 h-3.5" />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-xs font-bold text-slate-200 tracking-wide whitespace-nowrap">
              Identified States
            </h3>
            <span
              id="states-count-badge"
              className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-medium bg-sky-950/90 text-sky-400 border border-sky-800/50 shrink-0"
              title={`${states.length} total states identified in POU`}
            >
              {states.length}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Always shown (before going live it sets the preference); brighter while live */}
          {onLiveFollowChange && (
            <label
              className={`flex items-center gap-1 text-[10px] cursor-pointer select-none ${liveStateId ? 'text-emerald-300' : 'text-slate-400'}`}
              title={`Live: show each new live state here and pan the canvas to it (the same setting as Follow in the Live tab)${liveStateId ? '' : '. Applies once you go live.'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <input id="states-live-follow-toggle" type="checkbox" checked={liveFollow} onChange={(e) => onLiveFollowChange(e.target.checked)} />
              <Crosshair className="w-3 h-3" /> Follow
            </label>
          )}
          {states.length > 0 && (
            <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
              {logicCount} in doState()
            </span>
          )}
          <button
            type="button"
            className="p-1 text-slate-400 hover:text-slate-200 rounded transition-colors"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className={`flex flex-col p-3 gap-2.5 ${fill ? 'flex-1 min-h-0' : ''}`}>
          {/* Controls: Search, Filters & Sorting */}
          {states.length > 0 && (
            <div className="flex flex-col gap-2">
              {/* Search Bar */}
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 pointer-events-none" />
                <input
                  id="state-search-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter states by name or description..."
                  className="w-full pl-8 pr-7 py-1.5 bg-slate-950/80 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500/70 focus:ring-1 focus:ring-sky-500/30 transition-all font-mono"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 text-slate-400 hover:text-slate-200 p-0.5 rounded"
                    title="Clear filter"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Quick 'Go to State' Dropdown Jump Selector */}
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-950/70 border border-slate-800/90 text-xs">
                <Target className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <label htmlFor="quick-goto-state-select" className="text-[11px] font-semibold text-slate-300 shrink-0 select-none">
                  Go to:
                </label>
                <select
                  id="quick-goto-state-select"
                  value={selectedStateId || ''}
                  onChange={(e) => {
                    const targetId = e.target.value;
                    if (targetId) {
                      const st = states.find((s) => s.id === targetId);
                      handleTriggerGoToState(targetId, st?.label);
                    }
                  }}
                  className="flex-1 bg-transparent text-[11px] font-mono text-sky-300 border-none outline-none cursor-pointer truncate py-0.5 focus:ring-0"
                  title="Select any state to automatically pan and center it on the canvas with highlight animation"
                >
                  <option value="" disabled className="bg-slate-900 text-slate-400">
                    Jump to state...
                  </option>
                  {states.map((s) => (
                    <option key={s.id} value={s.id} className="bg-slate-900 text-slate-200">
                      {s.id} {s.compositeGroup ? `(${s.compositeGroup})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Quick Filters and Sort Toolbar */}
              <div className="flex items-center justify-between gap-1 text-[11px] text-slate-400 pt-0.5">
                {/* Filter Pills */}
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
                  <button
                    type="button"
                    onClick={() => setFilterMode('all')}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      filterMode === 'all'
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                        : 'bg-slate-950 hover:bg-slate-800 text-slate-400 border border-slate-800/80'
                    }`}
                  >
                    All ({states.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('logic')}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      filterMode === 'logic'
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                        : 'bg-slate-950 hover:bg-slate-800 text-slate-400 border border-slate-800/80'
                    }`}
                    title="States with an explicit CASE branch in doState()"
                  >
                    Logic ({logicCount})
                  </button>
                  {availableGroups.length > 0 && (
                    <div className="relative inline-block">
                      <select
                        value={selectedGroup}
                        onChange={(e) => setSelectedGroup(e.target.value)}
                        className="text-[10px] bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800/80 rounded px-1.5 py-0.5 focus:outline-none focus:border-sky-500/50 cursor-pointer"
                        title="Filter by composite group / category"
                      >
                        <option value="all">All Groups</option>
                        {availableGroups.map((g) => (
                          <option key={g} value={g} className="bg-slate-900 text-slate-200">
                            {g}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Sort Mode Button */}
                <button
                  type="button"
                  onClick={() => {
                    if (sortMode === 'enum') setSortMode('alpha');
                    else if (sortMode === 'alpha') setSortMode('complexity');
                    else setSortMode('enum');
                  }}
                  className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800/80 transition-colors shrink-0"
                  title={
                    sortMode === 'enum'
                      ? 'Ordered by Enum / Cycle index. Click to sort A-Z'
                      : sortMode === 'alpha'
                      ? 'Sorted Alphabetically A-Z. Click to sort by Complexity (highest transitions first)'
                      : 'Sorted by Transition Complexity. Click to sort by Enum order'
                  }
                >
                  {sortMode === 'enum' ? (
                    <>
                      <ArrowDown01 className="w-3 h-3 text-sky-400" />
                      <span>Enum</span>
                    </>
                  ) : sortMode === 'alpha' ? (
                    <>
                      <ArrowDownAZ className="w-3 h-3 text-sky-400" />
                      <span>A-Z</span>
                    </>
                  ) : (
                    <>
                      <Activity className="w-3 h-3 text-amber-400" />
                      <span>Complexity</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* States Scrollable List */}
          <div
            ref={scrollListRef}
            id="identified-states-scrollable-list"
            className={`flex flex-col gap-1 overflow-y-auto pr-0.5 custom-scrollbar ${fill ? 'flex-1 min-h-0' : 'max-h-[340px]'}`}
          >
            {states.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 px-3 text-center border border-dashed border-slate-800 rounded-lg bg-slate-950/40 text-slate-400">
                <AlertCircle className="w-5 h-5 text-slate-500 mb-1.5" />
                <p className="text-xs font-medium text-slate-300">No states identified</p>
                <p className="text-[11px] text-slate-500 mt-1 max-w-[240px]">
                  Load a TwinCAT <code className="text-sky-400">.TcPOU</code> file containing <code className="text-sky-400">doState()</code> or state transitions.
                </p>
              </div>
            ) : filteredStates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 px-3 text-center border border-dashed border-slate-800 rounded-lg bg-slate-950/40 text-slate-400">
                <Search className="w-4 h-4 text-slate-500 mb-1" />
                <p className="text-xs text-slate-300">No matching states</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setFilterMode('all');
                    setSelectedGroup('all');
                  }}
                  className="mt-2 text-[11px] text-sky-400 hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              filteredStates.map((state) => {
                const isSelected = selectedStateId === state.id;
                const isJustNavigated = recentlyNavigatedStateId === state.id;
                const isLive = !!liveStateId && liveStateId === state.id;
                const customStyle = customStyles ? customStyles[state.id] : undefined;
                const transStats = stateTransitionsMap.get(state.id) || {
                  incoming: [],
                  outgoing: [],
                  incomingCount: 0,
                  outgoingCount: 0,
                  totalCount: 0,
                };

                return (
                  <div
                    key={state.id}
                    id={`state-list-item-${state.id}`}
                    data-live={isLive ? 'true' : undefined}
                    onClick={() => handleItemClick(state.id, state.label)}
                    className={`group relative flex items-start justify-between p-2 rounded-lg cursor-pointer transition-all border select-none ${isLive ? 'outline outline-2 outline-emerald-400/90 outline-offset-1 ' : ''}${
                      isJustNavigated
                        ? 'bg-sky-950/80 border-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.35)] ring-2 ring-sky-400/80 text-white'
                        : isSelected
                        ? 'bg-sky-950/60 border-sky-500/60 shadow-[0_0_12px_rgba(56,189,248,0.15)] ring-1 ring-sky-500/30'
                        : 'bg-slate-950/50 hover:bg-slate-800/70 border-slate-800/70 hover:border-slate-700 text-slate-300'
                    }`}
                    title={liveFollow ? 'Click to select this state and center it in the Diagram Canvas (Follow is on)' : 'Click to select this state (Go to State centers it in the Diagram Canvas; with Follow on, a click does too)'}
                  >
                    {isLive && (
                      <span className="absolute -top-2 right-2 z-10 flex items-center gap-1 px-1.5 rounded-full bg-emerald-600 text-[9px] font-bold tracking-wide text-white shadow" title="The PLC's current state">
                        <span className="live-dot" /> LIVE
                      </span>
                    )}
                    {/* Left Indicator & Info */}
                    <div className="flex items-start gap-2 min-w-0 pr-2">
                      {/* Status Icon */}
                      <div className="mt-0.5 shrink-0">
                        {customStyle?.fill ? (
                          <span
                            className="w-2.5 h-2.5 rounded-full inline-block border border-white/20 mt-0.5"
                            style={{
                              backgroundColor: customStyle.fill,
                              borderColor: customStyle.stroke || '#fff',
                            }}
                            title={`Custom styling applied (${customStyle.fill})`}
                          />
                        ) : state.isInitial ? (
                          <span title="Initial state">
                            <Play className="w-3 h-3 text-emerald-400 fill-emerald-400/20" />
                          </span>
                        ) : state.isErrorSink ? (
                          <span title="Error / Fault state">
                            <AlertCircle className="w-3 h-3 text-rose-400" />
                          </span>
                        ) : state.hasCaseBranch ? (
                          <span title="Implemented in doState()">
                            <Code2 className="w-3 h-3 text-sky-400" />
                          </span>
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-600 block mt-1.5 mx-0.5" />
                        )}
                      </div>

                      {/* State Details */}
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`font-mono text-xs font-semibold leading-tight break-all ${
                              isJustNavigated
                                ? 'text-sky-200'
                                : isSelected
                                ? 'text-sky-300'
                                : 'text-slate-200 group-hover:text-white'
                            }`}
                          >
                            {state.id}
                          </span>
                          {isJustNavigated && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-medium bg-sky-500 text-white shadow-xs animate-pulse">
                              <Target className="w-2.5 h-2.5" />
                              <span>Centered</span>
                            </span>
                          )}
                        </div>

                        {/* Description (if available) */}
                        {state.description && (
                          <span className="text-[11px] text-slate-400 truncate mt-0.5 font-sans">
                            {state.description}
                          </span>
                        )}

                        {/* Meta Tags: Group, Incoming / Outgoing Transitions count, Complexity */}
                        <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-slate-500 font-mono flex-wrap">
                          {state.compositeGroup && (
                            <span
                              className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 truncate max-w-[110px]"
                              title={`Composite Group: ${state.compositeGroup}`}
                            >
                              {state.compositeGroup}
                            </span>
                          )}

                          {/* Incoming Transitions Count Badge */}
                          <span
                            id={`state-${state.id}-incoming-badge`}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border transition-colors ${
                              transStats.incomingCount > 0
                                ? 'bg-indigo-950/70 text-indigo-300 border-indigo-800/60 shadow-sm'
                                : 'bg-slate-900/60 text-slate-500 border-slate-800/60'
                            }`}
                            title={
                              transStats.incomingCount > 0
                                ? `Incoming transitions (${transStats.incomingCount}) from: ${transStats.incoming.join(', ')}`
                                : '0 incoming transitions (Possible initial entry or unreachable state)'
                            }
                          >
                            <ArrowDownLeft className={`w-2.5 h-2.5 ${transStats.incomingCount > 0 ? 'text-indigo-400' : 'text-slate-600'}`} />
                            <span>{transStats.incomingCount} in</span>
                          </span>

                          {/* Outgoing Transitions Count Badge */}
                          <span
                            id={`state-${state.id}-outgoing-badge`}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border transition-colors ${
                              transStats.outgoingCount > 0
                                ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60 shadow-sm'
                                : 'bg-slate-900/60 text-slate-500 border-slate-800/60'
                            }`}
                            title={
                              transStats.outgoingCount > 0
                                ? `Outgoing transitions (${transStats.outgoingCount}) to: ${transStats.outgoing.join(', ')}`
                                : '0 outgoing transitions (Terminal or sink state)'
                            }
                          >
                            <ArrowUpRight className={`w-2.5 h-2.5 ${transStats.outgoingCount > 0 ? 'text-emerald-400' : 'text-slate-600'}`} />
                            <span>{transStats.outgoingCount} out</span>
                          </span>

                          {/* Quick Complexity Tag */}
                          {transStats.totalCount > 0 && (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border ${
                                transStats.totalCount >= 6
                                  ? 'bg-rose-950/60 text-rose-300 border-rose-800/60'
                                  : transStats.totalCount >= 4
                                  ? 'bg-amber-950/60 text-amber-300 border-amber-800/60'
                                  : 'bg-slate-900/80 text-slate-400 border-slate-800/60'
                              }`}
                              title={`Total transition complexity: ${transStats.totalCount} transitions (${transStats.incomingCount} in + ${transStats.outgoingCount} out)`}
                            >
                              {transStats.totalCount} tot
                            </span>
                          )}

                          {state.hasCaseBranch && (
                            <span
                              className="px-1 py-0.2 rounded text-[9px] font-mono bg-sky-950/60 text-sky-400 border border-sky-800/40"
                              title="Has explicit logic in doState() CASE"
                            >
                              doState
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right 'Go to State' Action Button */}
                    <div className="shrink-0 flex items-center self-center pl-1">
                      <button
                        type="button"
                        id={`btn-goto-state-${state.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTriggerGoToState(state.id, state.label);
                        }}
                        className={`group/btn flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                          isJustNavigated
                            ? 'bg-sky-500 text-white shadow-md shadow-sky-500/40 ring-1 ring-sky-300'
                            : isSelected
                            ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-400'
                            : 'bg-slate-900/90 hover:bg-sky-600/25 text-slate-300 hover:text-white border border-slate-700/70 hover:border-sky-500/60'
                        }`}
                        title="Go to State: pan diagram and center on this node with highlight animation"
                      >
                        <Target
                          className={`w-3.5 h-3.5 ${
                            isJustNavigated
                              ? 'animate-spin text-white'
                              : 'text-sky-400 group-hover/btn:text-sky-300 group-hover/btn:scale-110 transition-transform'
                          } shrink-0`}
                        />
                        <span className="font-semibold text-[11px] whitespace-nowrap">
                          {isJustNavigated ? 'Centered' : 'Go to State'}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Quick Stats Summary Footer */}
          {states.length > 0 && (
            <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/60 text-[10px] text-slate-500">
              <div className="flex items-center gap-2">
                <span>
                  Showing {filteredStates.length} of {states.length} states
                </span>
                <span className="text-slate-600">•</span>
                <span title="Total transitions identified across states">
                  {totalTransitionsSum} transitions
                </span>
              </div>
              <div className="flex items-center gap-2">
                {onOpenComplexityReport && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenComplexityReport();
                    }}
                    className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 font-medium transition-colors"
                    title="Open POU Complexity & Transition Density Report"
                  >
                    <Activity className="w-3 h-3" />
                    <span>Report</span>
                  </button>
                )}
                <span className="font-mono text-slate-400">{stateVarName}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
