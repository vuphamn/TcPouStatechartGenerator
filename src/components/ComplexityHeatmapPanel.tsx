import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Flame,
  X,
  ChevronDown,
  ChevronUp,
  Sliders,
  ShieldAlert,
  AlertTriangle,
  Sparkles,
  Search,
  ArrowRight,
  Target,
  GripHorizontal,
  RotateCcw,
  Code,
  Layers,
  HelpCircle,
  ExternalLink,
  CheckCircle2,
  Filter,
  Eye,
  EyeOff,
  Cpu,
} from 'lucide-react';
import {
  ComplexityHeatmapResult,
  StateComplexityMetric,
  ComplexityLevel,
  HeatmapPalette,
  HEATMAP_PALETTES,
} from '../utils/complexityHeatmap.ts';

export interface ComplexityHeatmapPanelProps {
  isOpen: boolean;
  onClose: () => void;
  heatmapResult: ComplexityHeatmapResult;
  isHeatmapActive: boolean;
  onToggleHeatmap: (active: boolean) => void;
  selectedPalette: HeatmapPalette;
  onChangePalette: (palette: HeatmapPalette) => void;
  onlyShowRefactorCandidates: boolean;
  onToggleOnlyShowRefactorCandidates: (onlyRefactor: boolean) => void;
  selectedStateId?: string | null;
  onSelectState?: (stateId: string) => void;
  onPanToState?: (stateId: string) => void;
  onOpenMethodEditorForState?: (stateId: string) => void;
  refactorThreshold?: number;
  onChangeRefactorThreshold?: (threshold: number) => void;
  showComplexityBadges?: boolean;
  onToggleShowComplexityBadges?: (show: boolean) => void;
  /** Fill a docked RightPanel tab: no floating position, drag handle, collapse or close controls */
  docked?: boolean;
}

export const ComplexityHeatmapPanel: React.FC<ComplexityHeatmapPanelProps> = ({
  isOpen,
  onClose,
  heatmapResult,
  isHeatmapActive,
  onToggleHeatmap,
  selectedPalette,
  onChangePalette,
  onlyShowRefactorCandidates,
  onToggleOnlyShowRefactorCandidates,
  selectedStateId,
  onSelectState,
  onPanToState,
  onOpenMethodEditorForState,
  refactorThreshold = 5,
  onChangeRefactorThreshold,
  showComplexityBadges = true,
  onToggleShowComplexityBadges,
  docked = false,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [selectedLevelFilter, setSelectedLevelFilter] = useState<ComplexityLevel | 'all'>('all');
  const [expandedStateId, setExpandedStateId] = useState<string | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [showExplanation, setShowExplanation] = useState<boolean>(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panelStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Handle Dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, a, [role="button"]')) {
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };

    if (panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect();
      panelStartPosRef.current = { x: rect.left, y: rect.top };
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      e.stopPropagation();
      const dx = e.clientX - dragStartPosRef.current.x;
      const dy = e.clientY - dragStartPosRef.current.y;

      const newX = Math.max(10, Math.min(window.innerWidth - 380, panelStartPosRef.current.x + dx));
      const newY = Math.max(10, Math.min(window.innerHeight - 80, panelStartPosRef.current.y + dy));

      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = (e: MouseEvent) => {
      e.stopPropagation();
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Filtered list of states
  const filteredMetrics = useMemo(() => {
    return heatmapResult.metricsList.filter((m) => {
      // Level filter
      if (selectedLevelFilter !== 'all' && m.level !== selectedLevelFilter) {
        return false;
      }
      // Refactor candidates only filter
      if (onlyShowRefactorCandidates && !m.refactorNeeded) {
        return false;
      }
      // Keyword search
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        return (
          m.stateId.toLowerCase().includes(q) ||
          m.stateLabel.toLowerCase().includes(q) ||
          m.refactorRecommendation.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [heatmapResult.metricsList, selectedLevelFilter, onlyShowRefactorCandidates, searchFilter]);

  if (!isOpen) return null;

  const stylePosition: React.CSSProperties = position
    ? {
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'none',
        zIndex: 40,
      }
    : {
        position: 'absolute',
        top: '72px',
        right: '16px',
        zIndex: 40,
      };

  return (
    <div
      ref={panelRef}
      id="complexity-heatmap-panel"
      style={docked ? undefined : stylePosition}
      onMouseDown={(e) => {
        // Prevent canvas panning or dragging from initiating when clicking anywhere inside panel
        e.stopPropagation();
      }}
      onWheel={(e) => {
        // Prevent canvas zoom in/out when scrolling wheel inside heatmap panel
        e.stopPropagation();
      }}
      className={
        docked
          ? 'flex-1 min-h-0 flex flex-col w-full bg-slate-900 overflow-y-auto select-none'
          : `w-96 max-w-[92vw] bg-slate-900/95 backdrop-blur-md border border-amber-500/30 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-all duration-200 select-none ${
              isDragging ? 'ring-2 ring-amber-500/60 shadow-amber-500/20' : ''
            }`
      }
    >
      {/* Panel Drag Header */}
      <div
        onMouseDown={docked ? undefined : handleMouseDown}
        className={`flex items-center justify-between px-3.5 py-2.5 bg-gradient-to-r from-amber-950/80 via-slate-900 to-slate-900 border-b border-amber-500/20 shrink-0 ${
          docked ? '' : 'cursor-move'
        }`}
      >
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${isHeatmapActive ? 'bg-amber-500/20 text-amber-400 animate-pulse' : 'bg-slate-800 text-slate-400'}`}>
            <Flame className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold tracking-wide text-slate-100">
                Complexity Heat-Map
              </span>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                  isHeatmapActive
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {isHeatmapActive ? 'ACTIVE' : 'OFF'}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 leading-tight">
              Cyclomatic complexity score from transition logic
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowExplanation(!showExplanation)}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
            title="How Cyclomatic Complexity is calculated"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
          {!docked && (
            <>
            <button
              type="button"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
              title={isCollapsed ? 'Expand panel' : 'Collapse panel'}
            >
              {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-rose-300 hover:bg-rose-950/40 rounded transition-colors"
              title="Close Heat-Map Panel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
              </>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <div className="flex-1 flex flex-col min-h-0 divide-y divide-slate-800/80">
          {/* Main Master Controls & Toggle */}
          <div className="p-3 bg-slate-950/40 flex flex-col gap-2.5">
            {/* Heatmap Active Switch */}
            <div className="flex items-center justify-between">
              <label
                htmlFor="heatmap-toggle-checkbox"
                className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-200"
              >
                <div
                  className={`w-9 h-5 flex items-center rounded-full p-0.5 duration-200 cursor-pointer transition-colors ${
                    isHeatmapActive ? 'bg-amber-500' : 'bg-slate-700'
                  }`}
                  onClick={() => onToggleHeatmap(!isHeatmapActive)}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ${
                      isHeatmapActive ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </div>
                <span>Color-Code Nodes by Complexity</span>
              </label>

              {/* Palette Switcher */}
              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-slate-400 text-[10px]">Palette:</span>
                <select
                  value={selectedPalette}
                  onChange={(e) => onChangePalette(e.target.value as HeatmapPalette)}
                  className="bg-slate-800 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-amber-500"
                >
                  <option value="traffic">Traffic Alert (Classic)</option>
                  <option value="plasma">Plasma Violet</option>
                  <option value="neon">Cyber Neon</option>
                </select>
              </div>
            </div>

            {/* Refactor Filter Switch */}
            <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded-lg px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                <span className="text-[11px] text-slate-300 font-medium">
                  Refactor Candidates Only
                </span>
                <span className="text-[10px] bg-rose-950/70 text-rose-300 px-1.5 py-0.2 rounded border border-rose-800/50 font-bold">
                  {heatmapResult.refactorCandidatesCount}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onToggleOnlyShowRefactorCandidates(!onlyShowRefactorCandidates)}
                className={`text-[10px] font-semibold px-2 py-0.5 rounded transition-all ${
                  onlyShowRefactorCandidates
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {onlyShowRefactorCandidates ? 'Filter On' : 'Show All'}
              </button>
            </div>

            {/* Visual Refactor Badges on Canvas Switch */}
            <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded-lg px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] text-slate-300 font-medium">
                  Visual Badges on Canvas
                </span>
                <span className="text-[10px] bg-amber-950/70 text-amber-300 px-1.5 py-0.2 rounded border border-amber-800/50 font-bold">
                  {heatmapResult.refactorCandidatesCount} Flagged
                </span>
              </div>
              {onToggleShowComplexityBadges && (
                <button
                  type="button"
                  onClick={() => onToggleShowComplexityBadges(!showComplexityBadges)}
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded transition-all ${
                    showComplexityBadges
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                  title="Toggle visual complexity badges displayed directly on diagram state nodes"
                >
                  {showComplexityBadges ? 'Badges ON' : 'Badges OFF'}
                </button>
              )}
            </div>

            {/* Refactor Complexity Threshold Selector */}
            <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-2 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-semibold text-slate-400 flex items-center gap-1">
                  <Sliders className="w-3 h-3 text-amber-400" />
                  Refactor Alert Threshold:
                </span>
                <span className="font-mono text-xs font-bold text-amber-300">
                  M ≥ {refactorThreshold}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {[3, 4, 5, 6, 8].map((th) => (
                  <button
                    key={th}
                    type="button"
                    onClick={() => onChangeRefactorThreshold && onChangeRefactorThreshold(th)}
                    className={`flex-1 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                      refactorThreshold === th
                        ? 'bg-amber-500 text-slate-950 shadow-sm ring-1 ring-amber-400'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                    }`}
                    title={`Flag states with cyclomatic complexity score ≥ ${th} for refactoring`}
                  >
                    ≥{th}
                  </button>
                ))}
              </div>
              <div className="text-[9.5px] text-slate-400 leading-tight">
                Nodes with cyclomatic complexity score ≥ {refactorThreshold} display a visual warning badge on the canvas flagging potential refactoring needs.
              </div>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-3 gap-2 px-3 py-2 bg-slate-900/60 text-center">
            <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/80">
              <div className="text-[10px] uppercase font-semibold text-slate-400">Avg Complexity</div>
              <div className="text-sm font-bold text-sky-400">{heatmapResult.avgComplexity}</div>
            </div>
            <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/80">
              <div className="text-[10px] uppercase font-semibold text-slate-400">Peak State</div>
              <div className="text-sm font-bold text-rose-400">
                M={heatmapResult.maxComplexity}
              </div>
            </div>
            <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/80">
              <div className="text-[10px] uppercase font-semibold text-slate-400">Needs Refactor</div>
              <div className="text-sm font-bold text-amber-400">
                {heatmapResult.refactorCandidatesCount} states
              </div>
            </div>
          </div>

          {/* Explanation Tooltip / Box */}
          {showExplanation && (
            <div className="p-3 bg-amber-950/30 border-b border-amber-500/20 text-[11px] text-amber-200/90 leading-relaxed flex flex-col gap-1.5">
              <div className="font-bold flex items-center gap-1.5 text-amber-300">
                <Cpu className="w-3.5 h-3.5" />
                How McCabe Complexity Is Evaluated:
              </div>
              <p>
                Each state has a base path of <strong>1</strong>. Decision branches on outgoing transitions
                (guards) add <strong>+1</strong>. Compound operators (<code>AND</code>, <code>OR</code>, <code>XOR</code>)
                add <strong>+1</strong> per predicate test. Internal Structured Text logic in <code>doState()</code>
                (<code>IF</code>, <code>ELSIF</code>, <code>CASE</code>) adds decision depth.
              </p>
              <div className="grid grid-cols-2 gap-1 text-[10px] pt-1">
                <div>• <span className="text-emerald-400 font-semibold">Low (M ≤ 2):</span> Clean, linear</div>
                <div>• <span className="text-sky-400 font-semibold">Moderate (M 3..4):</span> Normal</div>
                <div>• <span className="text-amber-400 font-semibold">High (M 5..7):</span> Complex branching</div>
                <div>• <span className="text-rose-400 font-semibold">Critical (M ≥ 8):</span> Refactor recommended</div>
              </div>
            </div>
          )}

          {/* Tier Legend & Filters */}
          <div className="px-3 py-2 bg-slate-950/30 flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>Complexity Tiers</span>
              <span className="text-[9px] text-slate-500">Click tier to filter</span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              <button
                type="button"
                onClick={() => setSelectedLevelFilter(selectedLevelFilter === 'low' ? 'all' : 'low')}
                className={`flex flex-col items-center py-1 px-1.5 rounded-lg border text-center transition-all ${
                  selectedLevelFilter === 'low'
                    ? 'bg-emerald-950/80 border-emerald-400 text-emerald-300 ring-1 ring-emerald-400'
                    : 'bg-emerald-950/40 border-emerald-800/40 text-emerald-400/80 hover:bg-emerald-950/60'
                }`}
              >
                <span className="text-[9px] font-bold">LOW (1-2)</span>
                <span className="text-xs font-extrabold">{heatmapResult.counts.low}</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedLevelFilter(selectedLevelFilter === 'moderate' ? 'all' : 'moderate')}
                className={`flex flex-col items-center py-1 px-1.5 rounded-lg border text-center transition-all ${
                  selectedLevelFilter === 'moderate'
                    ? 'bg-sky-950/80 border-sky-400 text-sky-300 ring-1 ring-sky-400'
                    : 'bg-sky-950/40 border-sky-800/40 text-sky-400/80 hover:bg-sky-950/60'
                }`}
              >
                <span className="text-[9px] font-bold">MOD (3-4)</span>
                <span className="text-xs font-extrabold">{heatmapResult.counts.moderate}</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedLevelFilter(selectedLevelFilter === 'high' ? 'all' : 'high')}
                className={`flex flex-col items-center py-1 px-1.5 rounded-lg border text-center transition-all ${
                  selectedLevelFilter === 'high'
                    ? 'bg-amber-950/80 border-amber-400 text-amber-300 ring-1 ring-amber-400'
                    : 'bg-amber-950/40 border-amber-800/40 text-amber-400/80 hover:bg-amber-950/60'
                }`}
              >
                <span className="text-[9px] font-bold">HIGH (5-7)</span>
                <span className="text-xs font-extrabold">{heatmapResult.counts.high}</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedLevelFilter(selectedLevelFilter === 'critical' ? 'all' : 'critical')}
                className={`flex flex-col items-center py-1 px-1.5 rounded-lg border text-center transition-all ${
                  selectedLevelFilter === 'critical'
                    ? 'bg-rose-950/80 border-rose-400 text-rose-300 ring-1 ring-rose-400'
                    : 'bg-rose-950/40 border-rose-800/40 text-rose-400/80 hover:bg-rose-950/60'
                }`}
              >
                <span className="text-[9px] font-bold">CRIT (8+)</span>
                <span className="text-xs font-extrabold">{heatmapResult.counts.critical}</span>
              </button>
            </div>
          </div>

          {/* Search Filter in State List */}
          <div className="px-3 pt-2 pb-1.5 flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search state name or refactor advice..."
                className="w-full bg-slate-950 border border-slate-800 rounded-md pl-7 pr-2 py-1 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
              {searchFilter && (
                <button
                  type="button"
                  onClick={() => setSearchFilter('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {selectedLevelFilter !== 'all' && (
              <button
                type="button"
                onClick={() => setSelectedLevelFilter('all')}
                className="text-[10px] text-slate-400 hover:text-slate-200 px-1.5 py-1 bg-slate-800 rounded"
              >
                Reset
              </button>
            )}
          </div>

          {/* Ranked States List */}
          <div className="flex-1 max-h-72 overflow-y-auto divide-y divide-slate-800/40 px-2 py-1 scrollbar-thin scrollbar-thumb-slate-700">
            {filteredMetrics.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                No states match current complexity filter.
              </div>
            ) : (
              filteredMetrics.map((item) => {
                const isSelected = selectedStateId === item.stateId;
                const isExpanded = expandedStateId === item.stateId;

                return (
                  <div
                    key={item.stateId}
                    className={`p-2 rounded-lg transition-colors group ${
                      isSelected
                        ? 'bg-slate-800/90 ring-1 ring-amber-400/50'
                        : 'hover:bg-slate-800/40'
                    }`}
                  >
                    {/* Header line */}
                    <div className="flex items-center justify-between gap-2">
                      <div
                        className="flex items-center gap-2 min-w-0 cursor-pointer flex-1"
                        onClick={() => {
                          if (onSelectState) onSelectState(item.stateId);
                          if (onPanToState) onPanToState(item.stateId);
                        }}
                      >
                        {/* Status color indicator */}
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
                          style={{ backgroundColor: item.color.stroke }}
                          title={`Complexity: ${item.level.toUpperCase()}`}
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-200 truncate group-hover:text-amber-300 transition-colors">
                            {item.stateLabel}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {item.outgoingTransitionsCount} exits • {item.guardedTransitionsCount} guards
                            {item.compoundConditionsCount > 0 && ` • ${item.compoundConditionsCount} compound ops`}
                          </div>
                        </div>
                      </div>

                      {/* Score badge & expand */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className="text-[11px] font-extrabold px-2 py-0.5 rounded-md text-white shadow-sm flex items-center gap-1"
                          style={{ backgroundColor: item.color.badgeBg, border: `1px solid ${item.color.badgeBorder}` }}
                        >
                          M={item.score}
                        </span>

                        <button
                          type="button"
                          onClick={() => setExpandedStateId(isExpanded ? null : item.stateId)}
                          className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 rounded"
                          title="Show breakdown & refactor suggestions"
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Quick Advice Snippet */}
                    <div className="mt-1 text-[10px] text-slate-300/80 leading-snug line-clamp-1">
                      {item.refactorRecommendation}
                    </div>

                    {/* Detailed Expanded Breakdown */}
                    {isExpanded && (
                      <div className="mt-2 pt-2 border-t border-slate-800/80 flex flex-col gap-2 bg-slate-950/50 p-2 rounded-md">
                        {/* Breakdown Metrics */}
                        <div className="grid grid-cols-4 gap-1 text-center text-[9px] bg-slate-900 p-1.5 rounded border border-slate-800">
                          <div>
                            <span className="text-slate-500 block">Base Path</span>
                            <span className="font-bold text-slate-200">1</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">Guards</span>
                            <span className="font-bold text-sky-400">+{item.guardedTransitionsCount}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">Compound</span>
                            <span className="font-bold text-amber-400">+{item.compoundConditionsCount}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">ST Logic</span>
                            <span className="font-bold text-indigo-400">+{item.internalDecisionsCount}</span>
                          </div>
                        </div>

                        {/* Refactor Advice */}
                        <div className="text-[10px] text-slate-300 leading-relaxed">
                          <span className="font-bold text-amber-400 block mb-0.5">
                            Refactoring Advice:
                          </span>
                          <ul className="list-disc list-inside space-y-0.5 text-slate-300">
                            {item.refactorSuggestions.map((sug, sIdx) => (
                              <li key={sIdx}>{sug}</li>
                            ))}
                          </ul>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center justify-end gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (onSelectState) onSelectState(item.stateId);
                              if (onPanToState) onPanToState(item.stateId);
                            }}
                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium"
                          >
                            <Target className="w-3 h-3 text-sky-400" />
                            Focus on Canvas
                          </button>
                          {onOpenMethodEditorForState && (
                            <button
                              type="button"
                              onClick={() => onOpenMethodEditorForState(item.stateId)}
                              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-indigo-950 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 font-medium"
                            >
                              <Code className="w-3 h-3 text-indigo-400" />
                              Inspect Logic
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer note */}
          <div className="px-3 py-1.5 bg-slate-950/60 flex items-center justify-between text-[10px] text-slate-400">
            <span>
              Showing {filteredMetrics.length} of {heatmapResult.totalStates} states
            </span>
            <button
              type="button"
              onClick={() => {
                if (heatmapResult.highestComplexityState && onPanToState) {
                  onPanToState(heatmapResult.highestComplexityState.stateId);
                  if (onSelectState) onSelectState(heatmapResult.highestComplexityState.stateId);
                }
              }}
              className="text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold"
            >
              <Target className="w-3 h-3" />
              Pan to Peak State
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
