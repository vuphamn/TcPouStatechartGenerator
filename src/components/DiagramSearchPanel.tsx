import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Search,
  X,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ArrowRight,
  ArrowLeft,
  Target,
  Sparkles,
  RotateCcw,
  Sliders,
  Maximize2,
  Minimize2,
  Tag,
  Activity,
  Layers,
  ShieldAlert,
} from 'lucide-react';
import { EdgeInfo, StateNodeInfo, SearchMatchItem } from '../types.ts';

export interface DiagramSearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onClearSearch: () => void;
  matches: SearchMatchItem[];
  activeMatchIndex: number;
  matchesBreakdown: { states: number; transitions: number };
  onSelectMatch: (index: number) => void;
  onNextMatch: () => void;
  onPrevMatch: () => void;
  availableStates: StateNodeInfo[];
  availableEdges: EdgeInfo[];
  onSelectState?: (stateId: string, label?: string) => void;
  onSelectEdge?: (edge: EdgeInfo) => void;
  onPanToElement?: (element: Element) => void;
  isStatsOpen?: boolean;
  diagramVersionKey?: string | number;
}

export type SearchFilterScope = 'all' | 'states' | 'transitions';

// Highlighted text helper
const HighlightedText: React.FC<{ text: string; query: string; className?: string }> = ({
  text,
  query,
  className = '',
}) => {
  const trimmed = query.trim();
  if (!trimmed) {
    return <span className={className}>{text}</span>;
  }

  try {
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);

    return (
      <span className={className}>
        {parts.map((part, i) =>
          part.toLowerCase() === trimmed.toLowerCase() ? (
            <mark
              key={i}
              className="bg-amber-400/30 text-amber-200 font-semibold px-0.5 rounded border-b border-amber-400/80"
            >
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </span>
    );
  } catch {
    return <span className={className}>{text}</span>;
  }
};

const POPULAR_SEARCH_PRESETS = [
  'INIT',
  'IDLE',
  'RUN',
  'ERROR',
  'WAIT',
  'DONE',
  'RESET',
  'bStart',
  'TRUE',
];

export const DiagramSearchPanel: React.FC<DiagramSearchPanelProps> = ({
  isOpen,
  onClose,
  searchQuery,
  onSearchChange,
  onClearSearch,
  matches,
  activeMatchIndex,
  matchesBreakdown,
  onSelectMatch,
  onNextMatch,
  onPrevMatch,
  availableStates,
  availableEdges,
  onSelectState,
  onSelectEdge,
  onPanToElement,
  isStatsOpen = false,
  diagramVersionKey,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [filterScope, setFilterScope] = useState<SearchFilterScope>('all');
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [autoDockTop, setAutoDockTop] = useState<number>(56);
  const [isAnimatingEntrance, setIsAnimatingEntrance] = useState<boolean>(true);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const activeItemRef = useRef<HTMLDivElement | null>(null);

  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  }>({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });

  // Calculate dynamic auto-dock position below the Statistics panel
  useEffect(() => {
    if (position !== null) return; // User has manually dragged the panel

    const updateDockPosition = () => {
      // Check for expanded statistics panel
      const statsPanelEl = document.getElementById('diagram-stats-panel');
      if (statsPanelEl) {
        const rect = statsPanelEl.getBoundingClientRect();
        // Position immediately below stats panel with 8px margin
        const targetTop = Math.min(rect.bottom + 8, window.innerHeight - 200);
        setAutoDockTop(Math.max(56, targetTop));
        return;
      }

      // Check for collapsed statistics badge
      const statsCollapsedEl = document.getElementById('diagram-stats-collapsed');
      if (statsCollapsedEl) {
        const rect = statsCollapsedEl.getBoundingClientRect();
        setAutoDockTop(rect.bottom + 8);
        return;
      }

      // Fallback if statistics panel is closed
      setAutoDockTop(56);
    };

    updateDockPosition();
    const interval = setInterval(updateDockPosition, 300);
    window.addEventListener('resize', updateDockPosition);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', updateDockPosition);
    };
  }, [position, isStatsOpen, isOpen]);

  // Entrance animation trigger when diagram changes or panel opens
  const prevVersionRef = useRef<string | number | undefined>(diagramVersionKey);
  useEffect(() => {
    if (!isOpen) return;

    if (prevVersionRef.current !== diagramVersionKey) {
      prevVersionRef.current = diagramVersionKey;
      setIsAnimatingEntrance(false);
      const animRaf = requestAnimationFrame(() => {
        setIsAnimatingEntrance(true);
      });
      const timer = setTimeout(() => {
        setIsAnimatingEntrance(false);
      }, 400);

      return () => {
        cancelAnimationFrame(animRaf);
        clearTimeout(timer);
      };
    }
  }, [diagramVersionKey, isOpen]);

  // Scroll active match into view within results list
  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeMatchIndex]);

  // Dragging logic
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input, a, [data-no-drag]')) {
      return;
    }
    if (e.button !== 0) return;

    setIsDragging(true);
    const initialPos = position || {
      x: window.innerWidth - (panelRef.current?.offsetWidth || 380) - 16,
      y: autoDockTop,
    };

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: initialPos.x,
      initialY: initialPos.y,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    setIsDragging(false);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input, a, [data-no-drag]')) {
      return;
    }
    if (e.button !== 0) return;

    setIsDragging(true);
    const initialPos = position || {
      x: window.innerWidth - (panelRef.current?.offsetWidth || 380) - 16,
      y: autoDockTop,
    };

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: initialPos.x,
      initialY: initialPos.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (moveEvent: PointerEvent | MouseEvent) => {
      const deltaX = moveEvent.clientX - dragStartRef.current.startX;
      const deltaY = moveEvent.clientY - dragStartRef.current.startY;

      const panelWidth = panelRef.current?.offsetWidth || 380;
      const panelHeight = panelRef.current?.offsetHeight || 300;

      const maxX = Math.max(10, window.innerWidth - panelWidth - 10);
      const maxY = Math.max(10, window.innerHeight - panelHeight - 10);

      const nextX = Math.max(10, Math.min(maxX, dragStartRef.current.initialX + deltaX));
      const nextY = Math.max(10, Math.min(maxY, dragStartRef.current.initialY + deltaY));

      setPosition({ x: nextX, y: nextY });
    };

    const handleRelease = () => {
      setIsDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('pointerup', handleRelease, { capture: true });
    window.addEventListener('mouseup', handleRelease, { capture: true });
    window.addEventListener('pointercancel', handleRelease, { capture: true });
    window.addEventListener('blur', handleRelease);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('pointerup', handleRelease, { capture: true });
      window.removeEventListener('mouseup', handleRelease, { capture: true });
      window.removeEventListener('pointercancel', handleRelease, { capture: true });
      window.removeEventListener('blur', handleRelease);
    };
  }, [isDragging]);

  // State Degree map for quick lookup
  const stateDegreeMap = useMemo(() => {
    const inMap: Record<string, number> = {};
    const outMap: Record<string, number> = {};
    availableEdges.forEach((e) => {
      outMap[e.from] = (outMap[e.from] || 0) + 1;
      inMap[e.to] = (inMap[e.to] || 0) + 1;
    });
    return { inMap, outMap };
  }, [availableEdges]);

  // Filter matches based on active filter scope
  const filteredMatches = useMemo(() => {
    return matches.map((item, originalIndex) => ({
      ...item,
      originalIndex,
    })).filter((item) => {
      if (filterScope === 'states') return item.type === 'state';
      if (filterScope === 'transitions') return item.type === 'transition';
      return true;
    });
  }, [matches, filterScope]);

  // Handle jump to a specific match
  const handleJumpToMatch = (matchItem: SearchMatchItem & { originalIndex: number }) => {
    onSelectMatch(matchItem.originalIndex);

    // If it's a state and we have onSelectState
    if (matchItem.type === 'state') {
      const targetState =
        availableStates.find((s) => s.id === matchItem.stateId || s.label === matchItem.name) ||
        availableStates.find((s) => matchItem.name.includes(s.id) || matchItem.name.includes(s.label));

      if (targetState && onSelectState) {
        onSelectState(targetState.id, targetState.label);
      }
    } else if (matchItem.type === 'transition') {
      if (matchItem.edgeInfo && onSelectEdge) {
        onSelectEdge(matchItem.edgeInfo);
      }
    }

    if (onPanToElement && matchItem.element) {
      onPanToElement(matchItem.element);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        onPrevMatch();
      } else {
        onNextMatch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClearSearch();
      searchInputRef.current?.blur();
    }
  };

  if (!isOpen) return null;

  // ---------------------------------------------------------------------------
  // COLLAPSED BADGE STATE (Positioned below statistics panel)
  // ---------------------------------------------------------------------------
  if (isCollapsed) {
    return (
      <div
        id="diagram-search-collapsed"
        style={
          position
            ? { left: `${position.x}px`, top: `${position.y}px` }
            : { top: `${autoDockTop}px`, right: '16px' }
        }
        className={`z-30 select-none ${
          isAnimatingEntrance
            ? 'animate-stats-entrance'
            : 'animate-in fade-in zoom-in-95 duration-150'
        } ${position ? 'fixed' : 'absolute'}`}
      >
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/95 hover:bg-slate-800 text-slate-200 border border-slate-700/80 shadow-lg backdrop-blur-md text-xs font-medium cursor-pointer transition-all hover:scale-105 active:scale-95 group"
          title="Expand Keyword Search & Highlighting Panel"
        >
          <Search className="w-3.5 h-3.5 text-amber-400 group-hover:text-amber-300" />
          <span className="font-semibold text-slate-100">Find:</span>
          {searchQuery.trim() ? (
            <span className="font-mono text-amber-300 max-w-[120px] truncate">
              "{searchQuery}"
            </span>
          ) : (
            <span className="text-slate-400">Search</span>
          )}
          <span
            className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold ${
              matches.length > 0
                ? 'bg-amber-950 text-amber-300 border border-amber-700/70'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {matches.length}
          </span>
          <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // EXPANDED SEARCH PANEL
  // ---------------------------------------------------------------------------
  return (
    <div
      ref={panelRef}
      id="diagram-search-panel"
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={() => {
        if (isDragging) setIsDragging(false);
      }}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      style={
        position
          ? { left: `${position.x}px`, top: `${position.y}px` }
          : { top: `${autoDockTop}px`, right: '16px' }
      }
      className={`z-30 flex flex-col w-[360px] sm:w-[420px] max-w-[94vw] max-h-[75vh] rounded-xl bg-slate-900/95 border border-slate-700/80 shadow-2xl backdrop-blur-md overflow-hidden select-none ring-1 ring-black/40 ${
        isAnimatingEntrance
          ? 'animate-stats-entrance'
          : 'animate-in fade-in slide-in-from-top-2 duration-150'
      } ${position ? 'fixed' : 'absolute'}`}
    >
      {/* Panel Header & Drag Handle */}
      <div
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onMouseDown={handleMouseDown}
        className={`px-3 py-2 border-b border-slate-800/80 flex items-center justify-between bg-slate-950/70 touch-none ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        title="Drag to reposition panel anywhere on canvas"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5">
            <Search className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="font-semibold text-xs text-slate-100">Keyword Search & Filter</span>
          </div>

          {searchQuery.trim() && (
            <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/80">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {matches.length} {matches.length === 1 ? 'match' : 'matches'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0" data-no-drag>
          {position && (
            <button
              type="button"
              onClick={() => setPosition(null)}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
              title="Reset position to default (dock below Statistics panel)"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsCollapsed(true)}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
            title="Collapse to compact badge"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800/60 transition-colors cursor-pointer"
            title="Close Search Panel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Search Input Bar with Controls */}
      <div className="p-3 bg-slate-900 border-b border-slate-800/70 space-y-2">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search state names, guards, labels... (Enter/Shift+Enter)"
            className="w-full bg-slate-950/90 border border-slate-700/80 rounded-lg pl-8 pr-22 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/50 transition-all font-sans"
            autoFocus
          />

          <div className="absolute right-1.5 flex items-center gap-1">
            {searchQuery.trim() && (
              <button
                type="button"
                onClick={onClearSearch}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                title="Clear search query (Esc)"
              >
                <X className="w-3 h-3" />
              </button>
            )}

            {matches.length > 0 && (
              <div className="flex items-center border-l border-slate-800 pl-1">
                <button
                  type="button"
                  onClick={onPrevMatch}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                  title="Previous match (Shift+Enter)"
                >
                  <ArrowLeft className="w-3 h-3" />
                </button>
                <span className="text-[10px] font-mono text-slate-400 px-0.5">
                  {activeMatchIndex + 1}/{matches.length}
                </span>
                <button
                  type="button"
                  onClick={onNextMatch}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                  title="Next match (Enter)"
                >
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Scope Filter Chips & Real-time Indicator */}
        <div className="flex items-center justify-between text-[11px]">
          <div className="flex items-center p-0.5 bg-slate-950/80 rounded-md border border-slate-800">
            <button
              type="button"
              onClick={() => setFilterScope('all')}
              className={`px-2 py-0.5 rounded transition-colors cursor-pointer font-medium ${
                filterScope === 'all'
                  ? 'bg-slate-800 text-slate-100 font-semibold shadow-2xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({matches.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterScope('states')}
              className={`px-2 py-0.5 rounded transition-colors cursor-pointer font-medium ${
                filterScope === 'states'
                  ? 'bg-sky-950 text-sky-300 font-semibold shadow-2xs border border-sky-800/60'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              States ({matchesBreakdown.states})
            </button>
            <button
              type="button"
              onClick={() => setFilterScope('transitions')}
              className={`px-2 py-0.5 rounded transition-colors cursor-pointer font-medium ${
                filterScope === 'transitions'
                  ? 'bg-emerald-950 text-emerald-300 font-semibold shadow-2xs border border-emerald-800/60'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Transitions ({matchesBreakdown.transitions})
            </button>
          </div>

          {searchQuery.trim() ? (
            <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              <span>Real-time SVG highlight</span>
            </div>
          ) : (
            <span className="text-[10px] text-slate-500">Shortcut: Ctrl+F</span>
          )}
        </div>
      </div>

      {/* Main Results Container (Scrollable) */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 divide-y divide-slate-800/40 text-xs">
        {/* Empty state when query is blank */}
        {!searchQuery.trim() && (
          <div className="py-3 text-center space-y-3">
            <div className="w-8 h-8 rounded-full bg-amber-950/60 border border-amber-800/60 flex items-center justify-center mx-auto text-amber-400">
              <Search className="w-4 h-4" />
            </div>
            <div>
              <p className="font-medium text-slate-300 text-xs">
                Instant Diagram Keyword Search
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                Type any keyword to highlight matching states, transitions, guards, and action labels in real-time.
              </p>
            </div>

            {/* Popular quick-search preset chips */}
            <div className="pt-1">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5 font-semibold">
                Quick Filter Presets
              </span>
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {POPULAR_SEARCH_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => onSearchChange(preset)}
                    className="px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 hover:border-amber-700/60 text-[10px] font-mono text-slate-300 hover:text-amber-300 transition-colors cursor-pointer"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* No matches state */}
        {searchQuery.trim() && filteredMatches.length === 0 && (
          <div className="py-6 text-center space-y-2">
            <div className="text-slate-500 text-xs">
              No matching {filterScope === 'all' ? 'states or transitions' : filterScope} found for
            </div>
            <div className="font-mono text-amber-300 font-semibold text-sm">
              "{searchQuery}"
            </div>
            <p className="text-[11px] text-slate-500">
              Check spelling or click below to clear the search filter.
            </p>
            <button
              type="button"
              onClick={onClearSearch}
              className="mt-2 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition-colors cursor-pointer"
            >
              Clear Search
            </button>
          </div>
        )}

        {/* Matches list */}
        {searchQuery.trim() && filteredMatches.length > 0 && (
          <div className="space-y-1.5 pt-0.5">
            {filteredMatches.map((item) => {
              const isActive = activeMatchIndex === item.originalIndex;

              if (item.type === 'state') {
                // Find matching state information
                const stateNode =
                  availableStates.find((s) => s.id === item.stateId || s.label === item.name) ||
                  availableStates.find((s) => item.name.includes(s.id) || item.name.includes(s.label));

                const stateId = stateNode?.id || item.stateId || item.name;
                const stateLabel = stateNode?.label || item.stateLabel || item.name;
                const inCount = stateDegreeMap.inMap[stateId] || 0;
                const outCount = stateDegreeMap.outMap[stateId] || 0;

                return (
                  <div
                    key={`state-match-${item.originalIndex}`}
                    ref={isActive ? activeItemRef : undefined}
                    onClick={() => handleJumpToMatch(item)}
                    className={`p-2 rounded-lg border transition-all cursor-pointer group ${
                      isActive
                        ? 'bg-sky-950/70 border-sky-500 shadow-md ring-1 ring-sky-500/40'
                        : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-850 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-1.5 min-w-0">
                        <span className="mt-0.5 px-1.5 py-0.2 rounded bg-sky-950 border border-sky-800/80 text-sky-400 font-mono text-[9px] font-semibold shrink-0">
                          STATE
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-200 truncate flex items-center gap-1">
                            <HighlightedText text={stateLabel} query={searchQuery} />
                          </div>
                          {stateId !== stateLabel && (
                            <div className="text-[10px] font-mono text-slate-400 truncate">
                              ID: <HighlightedText text={stateId} query={searchQuery} />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[9px] font-mono text-slate-500 bg-slate-900 px-1 py-0.5 rounded border border-slate-800">
                          {inCount} in / {outCount} out
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleJumpToMatch(item);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-sky-300 hover:bg-sky-950/80 transition-colors cursor-pointer"
                          title="Pan to state in diagram"
                        >
                          <Target className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              } else {
                // Transition item
                const edge = item.edgeInfo;
                const from = item.fromState || edge?.from || 'Unknown';
                const to = item.toState || edge?.to || 'Unknown';
                const label = item.name || edge?.label || edge?.condition || 'Transition';

                return (
                  <div
                    key={`trans-match-${item.originalIndex}`}
                    ref={isActive ? activeItemRef : undefined}
                    onClick={() => handleJumpToMatch(item)}
                    className={`p-2 rounded-lg border transition-all cursor-pointer group ${
                      isActive
                        ? 'bg-emerald-950/70 border-emerald-500 shadow-md ring-1 ring-emerald-500/40'
                        : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-850 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-1.5 min-w-0">
                        <span className="mt-0.5 px-1.5 py-0.2 rounded bg-emerald-950 border border-emerald-800/80 text-emerald-400 font-mono text-[9px] font-semibold shrink-0">
                          TRANSITION
                        </span>
                        <div className="min-w-0">
                          <div className="text-[10px] font-mono text-slate-400 flex items-center gap-1 truncate">
                            <span className="truncate">{from}</span>
                            <ArrowRight className="w-2.5 h-2.5 text-emerald-500 shrink-0" />
                            <span className="truncate text-slate-300">{to}</span>
                          </div>
                          <div className="text-slate-200 mt-0.5 font-sans leading-tight">
                            <HighlightedText text={label} query={searchQuery} />
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {item.priority !== undefined && (
                          <span className="text-[9px] font-mono font-bold text-amber-400 bg-amber-950/80 px-1 py-0.5 rounded border border-amber-800/80">
                            P{item.priority}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleJumpToMatch(item);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-emerald-300 hover:bg-emerald-950/80 transition-colors cursor-pointer"
                          title="Pan to transition edge in diagram"
                        >
                          <Target className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }
            })}
          </div>
        )}
      </div>

      {/* Footer Helper / Navigation Bar */}
      <div className="px-3 py-1.5 bg-slate-950/90 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
        <div className="flex items-center gap-1.5 truncate">
          <span>Non-matching elements are dimmed</span>
        </div>

        <div className="flex items-center gap-2 shrink-0 font-mono">
          <span>{matches.length} found</span>
          {matches.length > 1 && (
            <span className="text-slate-500">(Enter: Next)</span>
          )}
        </div>
      </div>
    </div>
  );
};
