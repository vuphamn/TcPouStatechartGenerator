import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Activity,
  X,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  GripHorizontal,
  ArrowRight,
  LogIn,
  LogOut,
  Sliders,
  ShieldCheck,
  AlertTriangle,
  Zap,
  Info,
  Layers,
  Search,
  ExternalLink,
  Target,
  CornerDownRight,
  TrendingUp,
  Cpu,
  GitBranch,
  PieChart,
  Flame,
  Copy,
  Check,
} from 'lucide-react';
import { EdgeInfo, StateNodeInfo } from '../types.ts';
import {
  StateMachineStatistics,
  calculateStateMachineStats,
  EntryExitActionItem,
} from '../utils/stateMachineStats.ts';
import {
  StateMachineDistributionChart,
  DistributionViewMode,
} from './StateMachineDistributionChart.tsx';

export interface StateMachineStatsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  availableStates: StateNodeInfo[];
  availableEdges: EdgeInfo[];
  tcPouContent?: string;
  selectedStateId?: string | null;
  onSelectState?: (stateId: string) => void;
  onPanToState?: (stateId: string) => void;
  diagramVersionKey?: string | number;
  onOpenComplexityHeatmap?: () => void;
}

export type StatsTab = 'summary' | 'distribution' | 'complexity' | 'transitions' | 'actions';

export const StateMachineStatsPanel: React.FC<StateMachineStatsPanelProps> = ({
  isOpen,
  onClose,
  availableStates = [],
  availableEdges = [],
  tcPouContent,
  selectedStateId,
  onSelectState,
  onPanToState,
  diagramVersionKey,
  onOpenComplexityHeatmap,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<StatsTab>('summary');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [chartViewMode, setChartViewMode] = useState<DistributionViewMode>('types_and_actions');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [expandedConditionKey, setExpandedConditionKey] = useState<string | null>(null);
  const [copiedCondition, setCopiedCondition] = useState<string | null>(null);

  // Entrance animation trigger whenever diagram is regenerated or new file is loaded
  const [isAnimatingEntrance, setIsAnimatingEntrance] = useState<boolean>(true);
  const [showRefreshNotice, setShowRefreshNotice] = useState<boolean>(false);
  const prevVersionRef = useRef<string | number | undefined>(diagramVersionKey);

  useEffect(() => {
    if (!isOpen) return;

    // Check if diagramVersionKey changed or initially mounted
    if (prevVersionRef.current !== diagramVersionKey) {
      prevVersionRef.current = diagramVersionKey;
      setIsAnimatingEntrance(false);
      setShowRefreshNotice(true);

      const animRaf = requestAnimationFrame(() => {
        setIsAnimatingEntrance(true);
      });

      const noticeTimer = setTimeout(() => {
        setShowRefreshNotice(false);
      }, 1800);

      const animTimer = setTimeout(() => {
        setIsAnimatingEntrance(false);
      }, 420);

      return () => {
        cancelAnimationFrame(animRaf);
        clearTimeout(noticeTimer);
        clearTimeout(animTimer);
      };
    }
  }, [diagramVersionKey, isOpen]);

  const dragStartRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number }>({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });
  const panelRef = useRef<HTMLDivElement>(null);

  // Calculate real-time stats
  const stats: StateMachineStatistics = useMemo(() => {
    return calculateStateMachineStats(availableStates, availableEdges, tcPouContent);
  }, [availableStates, availableEdges, tcPouContent]);

  // Dragging logic so panel can be placed anywhere on the diagram canvas
  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    if (e.button !== 0) return; // Only primary mouse/touch button
    e.preventDefault();
    const rect = panelRef.current?.getBoundingClientRect();
    const currentX = position ? position.x : (rect?.left ?? 300);
    const currentY = position ? position.y : (rect?.top ?? 70);

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: currentX,
      initialY: currentY,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture unavailable
    }
    setIsDragging(true);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    setIsDragging(false);
  };

  // Drag start fallback for mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = panelRef.current?.getBoundingClientRect();
    const currentX = position ? position.x : (rect?.left ?? 300);
    const currentY = position ? position.y : (rect?.top ?? 70);

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: currentX,
      initialY: currentY,
    };
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e: PointerEvent | MouseEvent) => {
      const deltaX = e.clientX - dragStartRef.current.startX;
      const deltaY = e.clientY - dragStartRef.current.startY;
      const maxX = Math.max(8, window.innerWidth - 80);
      const maxY = Math.max(8, window.innerHeight - 60);
      const newX = Math.min(maxX, Math.max(8, dragStartRef.current.initialX + deltaX));
      const newY = Math.min(maxY, Math.max(8, dragStartRef.current.initialY + deltaY));
      setPosition({ x: newX, y: newY });
    };

    const handleRelease = () => {
      setIsDragging(false);
    };

    // Use capture: true on window so that any mouseup / pointerup is caught immediately
    // before any child or ancestor element's stopPropagation can block it
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

  const handleStateClick = (stateId: string) => {
    if (onSelectState) onSelectState(stateId);
    if (onPanToState) onPanToState(stateId);
  };

  const handleCopyCondition = (text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedCondition(text);
    setTimeout(() => {
      setCopiedCondition((curr) => (curr === text ? null : curr));
    }, 1800);
  };

  const matchesSearch = (text: string) => {
    if (!searchQuery.trim()) return true;
    return text.toLowerCase().includes(searchQuery.toLowerCase().trim());
  };

  if (!isOpen) return null;

  // Render collapsed floating pill
  if (isCollapsed) {
    return (
      <div
        id="diagram-stats-collapsed"
        style={position ? { left: `${position.x}px`, top: `${position.y}px` } : undefined}
        className={`z-30 select-none ${
          isAnimatingEntrance
            ? 'animate-stats-entrance'
            : 'animate-in fade-in zoom-in-95 duration-150'
        } ${position ? 'fixed' : 'absolute top-14 right-4'}`}
      >
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/95 hover:bg-slate-800 border border-slate-700/80 hover:border-sky-500/60 shadow-xl backdrop-blur-md text-xs font-medium text-slate-200 hover:text-white transition-all cursor-pointer group"
          title="Expand State Machine Statistics (Shortcut: S)"
        >
          <Activity className="w-3.5 h-3.5 text-sky-400 group-hover:scale-110 transition-transform" />
          <span>Machine Stats</span>
          <span className="px-1.5 py-0.2 rounded-full bg-sky-950 text-sky-300 font-mono text-[10px] border border-sky-800/60">
            {stats.totalTransitions} trans
          </span>
          <span
            className={`px-1.5 py-0.2 rounded-full font-mono text-[10px] border ${
              stats.cyclomaticRating === 'low'
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60'
                : stats.cyclomaticRating === 'moderate'
                ? 'bg-sky-950/80 text-sky-300 border-sky-800/60'
                : stats.cyclomaticRating === 'high'
                ? 'bg-amber-950/80 text-amber-300 border-amber-800/60'
                : 'bg-rose-950/80 text-rose-300 border-rose-800/60'
            }`}
          >
            M={stats.extendedCyclomaticScore}
          </span>
          {showRefreshNotice && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          )}
          <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      id="diagram-stats-panel"
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
          : undefined
      }
      className={`z-30 flex flex-col w-[380px] sm:w-[460px] max-w-[94vw] max-h-[84vh] rounded-xl bg-slate-900/95 border border-slate-700/80 shadow-2xl backdrop-blur-md overflow-hidden select-none ring-1 ring-black/40 ${
        isAnimatingEntrance
          ? 'animate-stats-entrance'
          : 'animate-in fade-in slide-in-from-top-2 duration-150'
      } ${position ? 'fixed' : 'absolute top-14 right-4'}`}
    >
      {/* Header with Drag Handle */}
      <div
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onMouseDown={handleMouseDown}
        className={`flex items-center justify-between px-3.5 py-2 bg-slate-950/90 border-b border-slate-800 text-xs text-slate-300 shrink-0 touch-none ${
          isDragging ? 'cursor-grabbing bg-slate-900' : 'cursor-grab'
        }`}
        title="Click and drag to reposition statistics panel"
      >
        <div className="flex items-center gap-2 min-w-0">
          <GripHorizontal className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <div className="flex items-center gap-1.5 min-w-0">
            <Activity className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="font-semibold text-xs text-slate-100">State Machine Real-Time Stats</span>
          </div>
          {showRefreshNotice ? (
            <span className="flex items-center gap-1 text-[10px] font-mono font-medium text-emerald-300 bg-emerald-950/90 px-1.5 py-0.5 rounded border border-emerald-700/80 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Regenerated
            </span>
          ) : (
            <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700/60 hidden sm:inline">
              Shortcut: S
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {position && (
            <button
              type="button"
              onClick={() => setPosition(null)}
              className="p-1 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition-colors cursor-pointer"
              title="Reset position to top-right dock"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsCollapsed(true)}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Minimize Statistics Panel"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer ml-0.5"
            title="Close Statistics Panel (S)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Hero Metrics Row (Total Transitions, Entry/Exit Actions, Cyclomatic Score) */}
      <div className="p-3 bg-slate-950/60 border-b border-slate-800/80 shrink-0">
        <div className="grid grid-cols-3 gap-2">
          {/* 1. Total Transitions Card */}
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-medium uppercase tracking-wider">Transitions</span>
              <ArrowRight className="w-3 h-3 text-sky-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold font-mono text-slate-100">
                {stats.totalTransitions}
              </span>
              <span className="text-[10px] text-slate-400">total</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[9px] text-slate-400 border-t border-slate-800/60 pt-1 font-mono">
              <span title="Guarded conditions">{stats.guardedTransitionsCount} guarded</span>
              <span title="Self loops" className="text-amber-400/90">{stats.selfLoopsCount} ↺</span>
            </div>
          </div>

          {/* 2. Entry / Exit Actions Card */}
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-medium uppercase tracking-wider">Entry / Exit</span>
              <div className="flex items-center gap-0.5">
                <LogIn className="w-2.5 h-2.5 text-emerald-400" />
                <LogOut className="w-2.5 h-2.5 text-indigo-400" />
              </div>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <div className="flex items-baseline gap-0.5" title="Entry actions defined">
                <span className="text-xl font-bold font-mono text-emerald-300">
                  {stats.entryActionsCount}
                </span>
                <span className="text-[9px] text-emerald-500 font-mono">in</span>
              </div>
              <span className="text-slate-600">/</span>
              <div className="flex items-baseline gap-0.5" title="Exit actions defined">
                <span className="text-xl font-bold font-mono text-indigo-300">
                  {stats.exitActionsCount}
                </span>
                <span className="text-[9px] text-indigo-400 font-mono">out</span>
              </div>
            </div>
            <div className="mt-1 text-[9px] text-slate-400 border-t border-slate-800/60 pt-1 truncate">
              {stats.entryActionsCount + stats.exitActionsCount} actions defined
            </div>
          </div>

          {/* 3. Cyclomatic Complexity Score Card */}
          <div
            className={`p-2.5 rounded-lg bg-slate-900/90 border flex flex-col justify-between ${
              stats.cyclomaticRating === 'low'
                ? 'border-emerald-800/60'
                : stats.cyclomaticRating === 'moderate'
                ? 'border-sky-800/60'
                : stats.cyclomaticRating === 'high'
                ? 'border-amber-800/60'
                : 'border-rose-800/60'
            }`}
          >
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-medium uppercase tracking-wider">Complexity</span>
              <GitBranch
                className={`w-3 h-3 ${
                  stats.cyclomaticRating === 'low'
                    ? 'text-emerald-400'
                    : stats.cyclomaticRating === 'moderate'
                    ? 'text-sky-400'
                    : stats.cyclomaticRating === 'high'
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span
                className={`text-xl font-bold font-mono ${
                  stats.cyclomaticRating === 'low'
                    ? 'text-emerald-300'
                    : stats.cyclomaticRating === 'moderate'
                    ? 'text-sky-300'
                    : stats.cyclomaticRating === 'high'
                    ? 'text-amber-300'
                    : 'text-rose-300'
                }`}
              >
                {stats.extendedCyclomaticScore}
              </span>
              <span className="text-[9px] text-slate-400 font-mono">McCabe</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[9px] border-t border-slate-800/60 pt-1">
              <span
                className={`font-semibold capitalize truncate ${
                  stats.cyclomaticRating === 'low'
                    ? 'text-emerald-400'
                    : stats.cyclomaticRating === 'moderate'
                    ? 'text-sky-400'
                    : stats.cyclomaticRating === 'high'
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {stats.cyclomaticRating} Risk
              </span>
              <span className="text-[9px] font-mono text-slate-500">
                {stats.cyclomaticDetails.averageBranchingFactor}x
              </span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 p-0.5 bg-slate-950 rounded-lg border border-slate-800 text-[11px] mt-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('summary')}
            className={`flex-1 py-1 rounded text-center font-medium transition-colors cursor-pointer ${
              activeTab === 'summary'
                ? 'bg-sky-950 text-sky-300 font-semibold shadow-xs border border-sky-800/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('distribution')}
            className={`flex-1 py-1 rounded text-center font-medium transition-colors cursor-pointer ${
              activeTab === 'distribution'
                ? 'bg-sky-950 text-sky-300 font-semibold shadow-xs border border-sky-800/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            D3 Chart
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('complexity')}
            className={`flex-1 py-1 rounded text-center font-medium transition-colors cursor-pointer ${
              activeTab === 'complexity'
                ? 'bg-sky-950 text-sky-300 font-semibold shadow-xs border border-sky-800/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Cyclomatic
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('transitions')}
            className={`flex-1 py-1 rounded text-center font-medium transition-colors cursor-pointer ${
              activeTab === 'transitions'
                ? 'bg-sky-950 text-sky-300 font-semibold shadow-xs border border-sky-800/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Transitions
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('actions')}
            className={`flex-1 py-1 rounded text-center font-medium transition-colors cursor-pointer ${
              activeTab === 'actions'
                ? 'bg-sky-950 text-sky-300 font-semibold shadow-xs border border-sky-800/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Actions ({stats.entryActionsCount + stats.exitActionsCount})
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3.5 text-xs text-slate-300 custom-scrollbar divide-y divide-slate-800/60">
        {/* =========================================================================
            TAB 1: OVERVIEW & ARCHITECTURE SUMMARY
           ========================================================================= */}
        {activeTab === 'summary' && (
          <div className="space-y-3 pt-1 first:pt-0">
            {/* Machine Architecture Overview Grid */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Architecture Breakdown</span>
                <span className="text-[10px] font-mono text-sky-400">
                  Health: {stats.healthScore}%
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800">
                  <span className="text-slate-400 text-[10px]">Total States (Nodes)</span>
                  <div className="text-base font-bold font-mono text-slate-100 mt-0.5">
                    {stats.totalStates}
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {stats.sourceStates.length} source • {stats.sinkStates.length} sink
                  </span>
                </div>

                <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800">
                  <span className="text-slate-400 text-[10px]">Average Branching</span>
                  <div className="text-base font-bold font-mono text-sky-300 mt-0.5">
                    {stats.cyclomaticDetails.averageBranchingFactor}
                  </div>
                  <span className="text-[10px] text-slate-500">
                    transitions / state
                  </span>
                </div>

                <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800">
                  <span className="text-slate-400 text-[10px]">Guarded Transitions</span>
                  <div className="text-base font-bold font-mono text-emerald-300 mt-0.5">
                    {stats.guardedTransitionsCount}
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {stats.totalTransitions > 0
                      ? `${Math.round((stats.guardedTransitionsCount / stats.totalTransitions) * 100)}% coverage`
                      : '0%'}
                  </span>
                </div>

                <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800">
                  <span className="text-slate-400 text-[10px]">Isolated Actions</span>
                  <div className="text-base font-bold font-mono text-indigo-300 mt-0.5">
                    {stats.entryActionsCount + stats.exitActionsCount}
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {stats.entryActionsCount} entry + {stats.exitActionsCount} exit
                  </span>
                </div>
              </div>
            </div>

            {/* D3.js Pie Chart Visualization of Transitions and Actions */}
            <StateMachineDistributionChart
              stats={stats}
              viewMode={chartViewMode}
              onViewModeChange={setChartViewMode}
            />

            {/* Health & Verification Observations */}
            {stats.healthObservations.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>State Machine Diagnostics</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1.5 text-[11px]">
                  {stats.healthObservations.map((obs, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-1.5 shrink-0" />
                      <span className="text-slate-300 leading-tight">{obs}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top Branching States */}
            {stats.cyclomaticDetails.maxBranchingStates.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Top Decision Hub States</span>
                  <span className="text-[10px] text-slate-500">Click to focus</span>
                </div>
                <div className="space-y-1">
                  {stats.cyclomaticDetails.maxBranchingStates.map((st) => (
                    <button
                      key={st.stateId}
                      type="button"
                      onClick={() => handleStateClick(st.stateId)}
                      className={`w-full flex items-center justify-between p-1.5 px-2 rounded-lg text-left transition-colors cursor-pointer border ${
                        selectedStateId === st.stateId
                          ? 'bg-sky-950/80 border-sky-600/80 text-sky-200'
                          : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-800 text-slate-300'
                      }`}
                    >
                      <span className="font-mono text-[11px] truncate max-w-[260px]">
                        {st.stateId}
                      </span>
                      <span className="px-1.5 py-0.2 rounded bg-slate-800 text-sky-300 font-mono text-[10px] border border-slate-700">
                        {st.outDegree} paths
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Top Guard Conditions Preview */}
            {stats.topGuardConditions.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5 text-sky-400" />
                    <span>Top Guard Conditions</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('transitions')}
                    className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-0.5 font-normal normal-case cursor-pointer hover:underline"
                  >
                    <span>View Top 5 in Transitions</span>
                    <ArrowRight className="w-2.5 h-2.5" />
                  </button>
                </div>
                <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1.5">
                  {stats.topGuardConditions.slice(0, 3).map((guard, idx) => (
                    <div
                      key={guard.normalizedKey}
                      className="flex items-center justify-between text-[11px] gap-2 p-1 rounded hover:bg-slate-900/80 transition-colors"
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span
                          className={`w-4 h-4 rounded-full text-[9px] font-mono font-bold flex items-center justify-center shrink-0 border ${
                            idx === 0
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : idx === 1
                              ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                              : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          }`}
                        >
                          #{idx + 1}
                        </span>
                        <code
                          className="font-mono text-slate-200 truncate hover:text-sky-300 cursor-pointer"
                          onClick={() => {
                            setActiveTab('transitions');
                            setExpandedConditionKey(guard.normalizedKey);
                          }}
                          title={`Click to inspect ${guard.condition} in Transitions tab`}
                        >
                          {guard.condition}
                        </code>
                        {guard.isCompound && (
                          <span className="px-1 py-0.1 rounded bg-purple-950/80 text-purple-300 text-[8px] font-mono border border-purple-800/60 shrink-0">
                            compound
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                        <span className="text-sky-300 font-bold">{guard.count}</span>
                        <span className="text-slate-500">({guard.percentage}%)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            TAB 2: D3 PIE CHART & DISTRIBUTION ANALYSIS
           ========================================================================= */}
        {activeTab === 'distribution' && (
          <div className="space-y-3 pt-1 first:pt-0">
            {/* Full interactive D3.js Pie Chart */}
            <StateMachineDistributionChart
              stats={stats}
              viewMode={chartViewMode}
              onViewModeChange={setChartViewMode}
            />

            {/* Distribution Breakdown Cards */}
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Transition Types & Action Semantics</span>
              </div>

              {/* 1. Guarded vs Unconditional */}
              <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="text-xs font-semibold text-slate-200">Guarded vs. Fallback Flow</span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-300">
                    {stats.guardedTransitionsCount} guarded / {stats.unconditionalTransitionsCount} fallback
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Guarded transitions define conditional decision paths evaluated each cycle. Fallback transitions (unconditional or ELSE branches) guarantee deterministic progression when no guard condition holds true.
                </p>
              </div>

              {/* 2. Entry vs Exit Actions */}
              <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" />
                    <span className="text-xs font-semibold text-slate-200">Entry & Exit Action Lifecycle</span>
                  </div>
                  <span className="text-[10px] font-mono text-cyan-300">
                    {stats.entryActionsCount} entry / {stats.exitActionsCount} exit
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Entry actions initialize timers and set actuator commands on the entry cycle. Exit actions clear flags, reset hardware references, and ensure clean state tear-down before switching state indices.
                </p>
              </div>

              {/* 3. Priority Hierarchy */}
              <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                    <span className="text-xs font-semibold text-slate-200">Priority Precedence Evaluation</span>
                  </div>
                  <span className="text-[10px] font-mono text-rose-300">
                    {stats.priorityBreakdown.priority1} Safety (P1)
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  IEC 61131-3 transition priority guarantees that safety interlocks and abort sequences (Priority 1) are evaluated before standard sequence steps (Priority 2) or retry loops (Priority 3+).
                </p>
              </div>
            </div>
          </div>
        )}


        {/* =========================================================================
            TAB 2: CYCLOMATIC COMPLEXITY ANALYSIS
           ========================================================================= */}
        {activeTab === 'complexity' && (
          <div className="space-y-3.5 pt-1 first:pt-0">
            {/* Heat-Map Quick Launcher Banner */}
            {onOpenComplexityHeatmap && (
              <button
                type="button"
                onClick={() => onOpenComplexityHeatmap()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-md transition-all cursor-pointer ring-1 ring-amber-400/40"
              >
                <Flame className="w-4 h-4 text-slate-950" />
                <span>Open Complexity Heat-Map & Refactoring on Canvas</span>
              </button>
            )}

            {/* Visual Refactor Badges Callout */}
            <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <div className="font-semibold text-slate-200 text-[11px]">Visual Refactor Badges on Canvas</div>
                  <div className="text-[10px] text-slate-400">Nodes exceeding cyclomatic complexity threshold (M ≥ 5) are visually flagged with badges</div>
                </div>
              </div>
              {onOpenComplexityHeatmap && (
                <button
                  type="button"
                  onClick={() => onOpenComplexityHeatmap()}
                  className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold text-[10px] border border-amber-500/40 transition-colors cursor-pointer"
                >
                  Configure
                </button>
              )}
            </div>

            {/* McCabe Formula Breakdown Banner */}
            <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-semibold text-slate-200 text-xs">
                  <GitBranch className="w-3.5 h-3.5 text-sky-400" />
                  <span>McCabe Cyclomatic Formula</span>
                </div>
                <span className="text-xs font-mono font-bold text-sky-300">
                  M = E - V + 2P
                </span>
              </div>

              <div className="p-2 rounded bg-slate-900/90 border border-slate-800/80 font-mono text-[11px] text-center text-slate-300">
                <span className="text-sky-300">{stats.cyclomaticDetails.edges} (Edges E)</span>
                <span className="text-slate-500"> - </span>
                <span className="text-amber-300">{stats.cyclomaticDetails.vertices} (Vertices V)</span>
                <span className="text-slate-500"> + </span>
                <span className="text-emerald-300">2 × {stats.cyclomaticDetails.connectedComponents} (Components P)</span>
                <span className="text-slate-500"> = </span>
                <span className="text-white font-bold">{stats.cyclomaticScore}</span>
              </div>

              {stats.cyclomaticDetails.compoundConditionOperators > 0 && (
                <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                  <span>Compound Condition Predicates (AND / OR):</span>
                  <span className="font-mono text-amber-300 font-bold">
                    +{stats.cyclomaticDetails.compoundConditionOperators}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between border-t border-slate-800/80 pt-2 text-xs">
                <span className="font-medium text-slate-300">Total Cyclomatic Score:</span>
                <span className="font-mono font-bold text-sm text-sky-300">
                  {stats.extendedCyclomaticScore}
                </span>
              </div>
            </div>

            {/* Risk Assessment Gauge & Standards */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Risk & Verification Assessment
              </div>
              <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">
                    {stats.cyclomaticRatingLabel}
                  </span>
                </div>

                {/* Progress bar visual */}
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden flex">
                  <div
                    style={{
                      width: `${Math.min(100, (stats.extendedCyclomaticScore / 50) * 100)}%`,
                    }}
                    className={`h-full transition-all duration-300 ${
                      stats.cyclomaticRating === 'low'
                        ? 'bg-emerald-500'
                        : stats.cyclomaticRating === 'moderate'
                        ? 'bg-sky-500'
                        : stats.cyclomaticRating === 'high'
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                    }`}
                  />
                </div>

                <div className="grid grid-cols-4 gap-1 text-[9px] font-mono text-slate-500 text-center">
                  <span>1-10 Low</span>
                  <span>11-20 Moderate</span>
                  <span>21-40 High</span>
                  <span>&gt;40 Critical</span>
                </div>
              </div>
            </div>

            {/* What this means for TwinCAT PLC Engineering */}
            <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/70 space-y-1.5 text-[11px] text-slate-400">
              <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-sky-400" />
                <span>Cyclomatic Meaning for IEC 61131-3 & SIL</span>
              </div>
              <p className="leading-relaxed">
                Cyclomatic complexity represents the minimum number of independent execution paths required to achieve full branch test coverage. A score ≤ 15 ensures high testability, determinism, and lower bug risk in PLC scan cycles.
              </p>
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 3: TRANSITIONS BREAKDOWN
           ========================================================================= */}
        {activeTab === 'transitions' && (
          <div className="space-y-3 pt-1 first:pt-0">
            {/* Summary badges */}
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800">
                <span className="text-slate-400 text-[10px]">Guarded Transitions</span>
                <div className="text-base font-bold font-mono text-emerald-300 mt-0.5">
                  {stats.guardedTransitionsCount}
                </div>
                <span className="text-[10px] text-slate-500">Require Boolean guard</span>
              </div>

              <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800">
                <span className="text-slate-400 text-[10px]">Unconditional / Fallback</span>
                <div className="text-base font-bold font-mono text-slate-200 mt-0.5">
                  {stats.unconditionalTransitionsCount}
                </div>
                <span className="text-[10px] text-slate-500">ELSE / unnumbered</span>
              </div>

              <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800">
                <span className="text-slate-400 text-[10px]">Self-Loop Transitions</span>
                <div className="text-base font-bold font-mono text-amber-300 mt-0.5">
                  {stats.selfLoopsCount}
                </div>
                <span className="text-[10px] text-slate-500">Wait / dwell timers</span>
              </div>

              <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800">
                <span className="text-slate-400 text-[10px]">preProcess Supervisor</span>
                <div className="text-base font-bold font-mono text-indigo-300 mt-0.5">
                  {stats.preProcessTransitionsCount}
                </div>
                <span className="text-[10px] text-slate-500">Global transitions</span>
              </div>
            </div>

            {/* Top 5 Most Frequently Occurring Guard Conditions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5 text-sky-400" />
                  <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                    Top 5 Guard Conditions
                  </span>
                  <span className="px-1.5 py-0.2 rounded-full bg-sky-950 text-sky-300 font-mono text-[9px] border border-sky-800/60">
                    Logic Drivers
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono">
                  {stats.totalGuardsExtracted} total / {stats.uniqueGuardsCount} unique
                </span>
              </div>

              {stats.topGuardConditions.length === 0 ? (
                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 text-center text-xs text-slate-500 italic">
                  No guarded transition conditions found in diagram
                </div>
              ) : (
                <div className="space-y-1.5">
                  {stats.topGuardConditions.map((guard, index) => {
                    const isExpanded = expandedConditionKey === guard.normalizedKey;
                    const rankColors = [
                      { badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40', bar: 'bg-amber-400' },
                      { badge: 'bg-sky-500/20 text-sky-300 border-sky-500/40', bar: 'bg-sky-400' },
                      { badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', bar: 'bg-emerald-400' },
                      { badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40', bar: 'bg-purple-400' },
                      { badge: 'bg-slate-700/40 text-slate-300 border-slate-600/40', bar: 'bg-slate-400' },
                    ][index] || { badge: 'bg-slate-700/40 text-slate-300 border-slate-600/40', bar: 'bg-slate-400' };

                    const categoryStyle = {
                      safety: { text: 'text-rose-400', bg: 'bg-rose-950/70 border-rose-800/60', label: 'Safety Interlock' },
                      fault: { text: 'text-amber-400', bg: 'bg-amber-950/70 border-amber-800/60', label: 'Fault Recovery' },
                      command: { text: 'text-sky-400', bg: 'bg-sky-950/70 border-sky-800/60', label: 'Command Trigger' },
                      timer: { text: 'text-indigo-400', bg: 'bg-indigo-950/70 border-indigo-800/60', label: 'Timer / Delay' },
                      progress: { text: 'text-emerald-400', bg: 'bg-emerald-950/70 border-emerald-800/60', label: 'Readiness / Done' },
                      general: { text: 'text-slate-400', bg: 'bg-slate-900 border-slate-800', label: 'Logic Branch' },
                    }[guard.category];

                    return (
                      <div
                        key={guard.normalizedKey}
                        className={`rounded-lg border transition-all ${
                          isExpanded
                            ? 'bg-slate-950/90 border-sky-700/70 shadow-md ring-1 ring-sky-500/20'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-950/80'
                        }`}
                      >
                        {/* Condition Header Item */}
                        <div
                          onClick={() => setExpandedConditionKey(isExpanded ? null : guard.normalizedKey)}
                          className="p-2 cursor-pointer flex flex-col gap-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              {/* Rank Badge */}
                              <span
                                className={`w-5 h-5 rounded-full flex items-center justify-center font-mono font-bold text-[10px] shrink-0 border ${rankColors.badge}`}
                                title={`Rank #${index + 1}`}
                              >
                                #{index + 1}
                              </span>

                              {/* Guard Condition Name */}
                              <code
                                className="font-mono text-xs font-semibold text-slate-100 hover:text-sky-300 truncate"
                                title={guard.condition}
                              >
                                {guard.condition}
                              </code>

                              {/* Compound tag */}
                              {guard.isCompound && (
                                <span
                                  className="px-1 py-0.2 rounded bg-purple-950/80 text-purple-300 text-[9px] font-mono border border-purple-800/60 shrink-0"
                                  title="Compound condition with boolean operators (AND, OR, NOT)"
                                >
                                  Compound
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {/* Frequency Badge */}
                              <div className="text-right">
                                <span className="font-mono font-bold text-xs text-sky-300">
                                  {guard.count}
                                </span>
                                <span className="text-[10px] text-slate-500 ml-1">
                                  ({guard.percentage}%)
                                </span>
                              </div>

                              {/* Copy Button */}
                              <button
                                type="button"
                                onClick={(e) => handleCopyCondition(guard.condition, e)}
                                className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                                title="Copy condition to clipboard"
                              >
                                {copiedCondition === guard.condition ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>

                              {/* Expand Chevron */}
                              <div className="text-slate-500 hover:text-slate-300 p-0.5">
                                {isExpanded ? (
                                  <ChevronUp className="w-3 h-3" />
                                ) : (
                                  <ChevronDown className="w-3 h-3" />
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Progress Bar & Role Tag */}
                          <div className="space-y-1">
                            <div className="w-full bg-slate-800/80 h-1.5 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${rankColors.bar}`}
                                style={{ width: `${Math.max(6, guard.percentage)}%` }}
                              />
                            </div>

                            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                              <span className={`px-1.5 py-0.2 rounded text-[9px] font-medium border ${categoryStyle.bg} ${categoryStyle.text}`}>
                                {categoryStyle.label}
                              </span>
                              <span className="text-slate-500 text-[10px] truncate max-w-[220px]">
                                {guard.sources.length} state{guard.sources.length === 1 ? '' : 's'} affected
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Expandable Details: Insights & Transition Paths */}
                        {isExpanded && (
                          <div className="px-2.5 pb-2.5 pt-1 border-t border-slate-800/80 space-y-2 text-[11px] bg-slate-900/60">
                            {/* Engineering Insight */}
                            <div className="flex items-start gap-1.5 text-slate-300 bg-slate-950/70 p-2 rounded border border-slate-800">
                              <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
                              <div className="leading-snug">
                                <span className="text-slate-400 text-[10px] block uppercase font-medium tracking-wider">Logic Insight:</span>
                                <span className="text-slate-200">{guard.insight}</span>
                              </div>
                            </div>

                            {/* Affected States tags */}
                            <div className="space-y-1">
                              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block">
                                Origin States ({guard.sources.length}):
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {guard.sources.map((src) => (
                                  <button
                                    key={src}
                                    type="button"
                                    onClick={() => handleStateClick(src)}
                                    className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-sky-950 text-slate-300 hover:text-sky-300 font-mono text-[9px] border border-slate-700 hover:border-sky-700 transition-colors cursor-pointer"
                                    title={`Focus source state ${src}`}
                                  >
                                    {src}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Governed Transitions */}
                            <div className="space-y-1">
                              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block">
                                Governed Transitions ({guard.transitions.length}):
                              </span>
                              <div className="max-h-28 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                                {guard.transitions.map((trans, tIdx) => (
                                  <div
                                    key={tIdx}
                                    className="flex items-center justify-between p-1.5 rounded bg-slate-950/80 border border-slate-800/80 text-[10px]"
                                  >
                                    <div className="flex items-center gap-1.5 min-w-0 font-mono">
                                      <button
                                        type="button"
                                        onClick={() => handleStateClick(trans.from)}
                                        className="text-slate-300 hover:text-sky-300 underline-offset-2 hover:underline truncate max-w-[120px]"
                                        title={`Focus ${trans.from}`}
                                      >
                                        {trans.from}
                                      </button>
                                      <ArrowRight className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                                      <button
                                        type="button"
                                        onClick={() => handleStateClick(trans.to)}
                                        className="text-slate-300 hover:text-sky-300 underline-offset-2 hover:underline truncate max-w-[120px]"
                                        title={`Focus ${trans.to}`}
                                      >
                                        {trans.to}
                                      </button>
                                    </div>

                                    {trans.priority && (
                                      <span
                                        className={`px-1 py-0.2 rounded font-mono text-[9px] border ${
                                          trans.priority === 1
                                            ? 'bg-rose-950/80 text-rose-300 border-rose-800/60'
                                            : trans.priority === 2
                                            ? 'bg-sky-950/80 text-sky-300 border-sky-800/60'
                                            : 'bg-amber-950/80 text-amber-300 border-amber-800/60'
                                        }`}
                                      >
                                        P{trans.priority}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Summary coverage notice */}
                  {stats.topGuardConditions.length > 0 && stats.totalGuardsExtracted > 0 && (
                    <div className="p-2 rounded-lg bg-sky-950/40 border border-sky-800/50 flex items-center justify-between text-[10px] text-sky-300">
                      <span>Top 5 conditions govern:</span>
                      <span className="font-bold font-mono">
                        {Math.min(
                          100,
                          stats.topGuardConditions.reduce((acc, g) => acc + g.percentage, 0)
                        )}
                        % of guarded branches
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Priority Distribution */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Priority Distribution
              </div>
              <div className="space-y-1 text-[11px]">
                <div className="flex items-center justify-between p-1.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-rose-950 text-rose-300 font-bold font-mono text-[10px] flex items-center justify-center border border-rose-700">
                      1
                    </span>
                    <span className="text-slate-200">Priority 1 (High / Safety / Abort)</span>
                  </div>
                  <span className="font-mono font-bold text-rose-300">
                    {stats.priorityBreakdown.priority1}
                  </span>
                </div>

                <div className="flex items-center justify-between p-1.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-sky-950 text-sky-300 font-bold font-mono text-[10px] flex items-center justify-center border border-sky-700">
                      2
                    </span>
                    <span className="text-slate-200">Priority 2 (Secondary / Progress)</span>
                  </div>
                  <span className="font-mono font-bold text-sky-300">
                    {stats.priorityBreakdown.priority2}
                  </span>
                </div>

                <div className="flex items-center justify-between p-1.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-amber-950 text-amber-300 font-bold font-mono text-[10px] flex items-center justify-center border border-amber-700">
                      3+
                    </span>
                    <span className="text-slate-200">Priority 3+ (Tertiary / Fallback)</span>
                  </div>
                  <span className="font-mono font-bold text-amber-300">
                    {stats.priorityBreakdown.priority3Plus}
                  </span>
                </div>
              </div>
            </div>

            {/* Sink and Source States */}
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Sink States ({stats.sinkStates.length})
                </span>
                <p className="text-[10px] text-slate-500 mt-0.5">States with out-degree 0:</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {stats.sinkStates.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleStateClick(s)}
                      className="px-1.5 py-0.5 rounded bg-slate-800 text-rose-300 font-mono text-[9px] hover:bg-slate-700 transition-colors cursor-pointer truncate max-w-[130px]"
                      title={`Focus sink state ${s}`}
                    >
                      {s}
                    </button>
                  ))}
                  {stats.sinkStates.length === 0 && (
                    <span className="text-[10px] text-slate-500 italic">None (cyclic)</span>
                  )}
                </div>
              </div>

              <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Source States ({stats.sourceStates.length})
                </span>
                <p className="text-[10px] text-slate-500 mt-0.5">States with in-degree 0:</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {stats.sourceStates.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleStateClick(s)}
                      className="px-1.5 py-0.5 rounded bg-slate-800 text-emerald-300 font-mono text-[9px] hover:bg-slate-700 transition-colors cursor-pointer truncate max-w-[130px]"
                      title={`Focus source state ${s}`}
                    >
                      {s}
                    </button>
                  ))}
                  {stats.sourceStates.length === 0 && (
                    <span className="text-[10px] text-slate-500 italic">None (all reachable)</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 4: ENTRY & EXIT ACTIONS INVENTORY
           ========================================================================= */}
        {activeTab === 'actions' && (
          <div className="space-y-3 pt-1 first:pt-0">
            {/* Search filter for actions */}
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search entry / exit actions..."
                className="w-full bg-slate-950/80 border border-slate-700/80 hover:border-slate-600 focus:border-sky-500 rounded-lg pl-8 pr-7 py-1 text-xs text-slate-200 placeholder:text-slate-500 outline-none transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 text-slate-500 hover:text-slate-300 p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Entry Actions List */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                <div className="flex items-center gap-1.5">
                  <LogIn className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Entry Actions ({stats.entryActions.length})</span>
                </div>
              </div>

              {stats.entryActions.length === 0 ? (
                <div className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/60 text-[11px] text-slate-500 text-center italic">
                  No explicit entry actions detected
                </div>
              ) : (
                <div className="space-y-1">
                  {stats.entryActions
                    .filter((act) => matchesSearch(act.name) || matchesSearch(act.stateId))
                    .map((act, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-lg bg-slate-950/70 border border-slate-800/80 hover:border-emerald-700/60 transition-colors flex items-start justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="px-1 py-0.2 rounded bg-emerald-950/90 text-emerald-300 font-mono text-[9px] border border-emerald-800/60">
                              ENTRY
                            </span>
                            <span className="font-mono text-xs font-semibold text-slate-200 truncate">
                              {act.name}
                            </span>
                          </div>
                          {act.description && (
                            <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                              {act.description}
                            </div>
                          )}
                        </div>

                        {act.stateId && (
                          <button
                            type="button"
                            onClick={() => handleStateClick(act.stateId)}
                            className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 font-mono text-[9px] border border-slate-700 cursor-pointer shrink-0 truncate max-w-[120px]"
                            title={`Focus state ${act.stateId}`}
                          >
                            {act.stateId}
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Exit Actions List */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                <div className="flex items-center gap-1.5">
                  <LogOut className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Exit Actions ({stats.exitActions.length})</span>
                </div>
              </div>

              {stats.exitActions.length === 0 ? (
                <div className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/60 text-[11px] text-slate-500 text-center italic">
                  No explicit exit actions detected
                </div>
              ) : (
                <div className="space-y-1">
                  {stats.exitActions
                    .filter((act) => matchesSearch(act.name) || matchesSearch(act.stateId))
                    .map((act, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-lg bg-slate-950/70 border border-slate-800/80 hover:border-indigo-700/60 transition-colors flex items-start justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="px-1 py-0.2 rounded bg-indigo-950/90 text-indigo-300 font-mono text-[9px] border border-indigo-800/60">
                              EXIT
                            </span>
                            <span className="font-mono text-xs font-semibold text-slate-200 truncate">
                              {act.name}
                            </span>
                          </div>
                          {act.description && (
                            <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                              {act.description}
                            </div>
                          )}
                        </div>

                        {act.stateId && (
                          <button
                            type="button"
                            onClick={() => handleStateClick(act.stateId)}
                            className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 font-mono text-[9px] border border-slate-700 cursor-pointer shrink-0 truncate max-w-[120px]"
                            title={`Focus state ${act.stateId}`}
                          >
                            {act.stateId}
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer Status Bar */}
      <div className="px-3 py-1.5 bg-slate-950 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 shrink-0 font-mono text-[10px]">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 inline-block" />
          <span className="font-sans text-[11px]">Real-Time Graph Metrics</span>
        </div>
        <div>
          <span>{stats.totalStates}V</span>
          <span className="mx-1">•</span>
          <span>{stats.totalTransitions}E</span>
          <span className="mx-1">•</span>
          <span className="text-sky-300 font-bold">M={stats.extendedCyclomaticScore}</span>
        </div>
      </div>
    </div>
  );
};
