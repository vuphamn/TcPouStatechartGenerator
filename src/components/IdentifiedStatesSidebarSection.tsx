import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  ListTree,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  Crosshair,
  ArrowRight,
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
  onJumpToState: (stateId: string, label?: string) => void;
  customStyles?: CustomNodeStylesMap;
  stateVarName?: string;
  onOpenEnumEditor?: () => void;
}

type FilterMode = 'all' | 'logic' | 'errors';
type SortMode = 'enum' | 'alpha';

export const IdentifiedStatesSidebarSection: React.FC<IdentifiedStatesSidebarSectionProps> = ({
  states,
  selectedStateId,
  onJumpToState,
  customStyles,
  stateVarName = 'machineState',
  onOpenEnumEditor,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [sortMode, setSortMode] = useState<SortMode>('enum');

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
    } else {
      list.sort((a, b) => a.enumIndex - b.enumIndex);
    }

    return list;
  }, [states, searchQuery, filterMode, selectedGroup, sortMode]);

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

  return (
    <section
      id="identified-states-sidebar-section"
      className="flex flex-col bg-slate-900/70 border border-slate-800/80 rounded-xl overflow-hidden shrink-0 shadow-sm"
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
        <div className="flex flex-col p-3 gap-2.5">
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
                  onClick={() => setSortMode(sortMode === 'enum' ? 'alpha' : 'enum')}
                  className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800/80 transition-colors shrink-0"
                  title={sortMode === 'enum' ? 'Ordered by Enum / Cycle. Click to sort A-Z' : 'Sorted Alphabetically A-Z. Click to sort by Enum order'}
                >
                  {sortMode === 'enum' ? (
                    <>
                      <ArrowDown01 className="w-3 h-3 text-sky-400" />
                      <span>Enum</span>
                    </>
                  ) : (
                    <>
                      <ArrowDownAZ className="w-3 h-3 text-sky-400" />
                      <span>A-Z</span>
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
            className="flex flex-col gap-1 max-h-[340px] overflow-y-auto pr-0.5 custom-scrollbar"
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
                const customStyle = customStyles ? customStyles[state.id] : undefined;

                return (
                  <div
                    key={state.id}
                    id={`state-list-item-${state.id}`}
                    onClick={() => onJumpToState(state.id, state.label)}
                    className={`group relative flex items-start justify-between p-2 rounded-lg cursor-pointer transition-all border select-none ${
                      isSelected
                        ? 'bg-sky-950/60 border-sky-500/60 shadow-[0_0_12px_rgba(56,189,248,0.15)] ring-1 ring-sky-500/30'
                        : 'bg-slate-950/50 hover:bg-slate-800/70 border-slate-800/70 hover:border-slate-700 text-slate-300'
                    }`}
                    title="Click to jump and center on this state in the Diagram Canvas"
                  >
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
                              isSelected ? 'text-sky-300' : 'text-slate-200 group-hover:text-white'
                            }`}
                          >
                            {state.id}
                          </span>
                        </div>

                        {/* Description (if available) */}
                        {state.description && (
                          <span className="text-[11px] text-slate-400 truncate mt-0.5 font-sans">
                            {state.description}
                          </span>
                        )}

                        {/* Meta Tags: Group, Transitions count */}
                        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-500 font-mono">
                          {state.compositeGroup && (
                            <span
                              className="px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 text-slate-400 truncate max-w-[130px]"
                              title={`Composite Group: ${state.compositeGroup}`}
                            >
                              {state.compositeGroup}
                            </span>
                          )}

                          {state.outgoingTransitions.length > 0 && (
                            <span
                              className="flex items-center gap-0.5 text-slate-400"
                              title={`Transitions to: ${state.outgoingTransitions.join(', ')}`}
                            >
                              <ArrowRight className="w-2.5 h-2.5 text-sky-400/80" />
                              {state.outgoingTransitions.length}
                            </span>
                          )}

                          {state.hasCaseBranch && (
                            <span
                              className="px-1 py-0.1 rounded text-[9px] font-mono bg-sky-950/60 text-sky-400 border border-sky-800/40"
                              title="Has explicit logic in doState() CASE"
                            >
                              doState
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right Jump Action Button */}
                    <div className="shrink-0 flex items-center self-center pl-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onJumpToState(state.id, state.label);
                        }}
                        className={`p-1.5 rounded-md transition-all ${
                          isSelected
                            ? 'bg-sky-500 text-white shadow-sm'
                            : 'text-slate-400 hover:text-sky-400 hover:bg-slate-800 opacity-60 group-hover:opacity-100'
                        }`}
                        title="Jump and focus on diagram canvas"
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Quick Stats Summary Footer */}
          {states.length > 0 && (
            <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-[10px] text-slate-500">
              <span>
                Showing {filteredStates.length} of {states.length} states
              </span>
              <span className="font-mono text-slate-400">{stateVarName}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
