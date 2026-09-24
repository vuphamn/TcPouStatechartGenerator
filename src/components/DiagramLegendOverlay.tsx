import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  BookOpen,
  X,
  ChevronDown,
  ChevronUp,
  Search,
  Palette,
  ArrowRight,
  HelpCircle,
  Sparkles,
  Info,
  Layers,
  StickyNote,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Maximize2,
  Minimize2,
  Clock,
  ShieldAlert,
  GripHorizontal,
  Sliders,
  ExternalLink,
} from 'lucide-react';
import {
  CustomNodeStylesMap,
  NodeDisplayProperties,
  StateNodeInfo,
  EdgeInfo,
  DiagramNotes,
} from '../types.ts';
import { CURATED_COLOR_PRESETS } from '../utils/nodeStyles.ts';

export type LegendTab = 'all' | 'colors' | 'priorities' | 'symbols';

export interface DiagramLegendOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  customStyles?: CustomNodeStylesMap;
  availableStates?: StateNodeInfo[];
  selectedStateId?: string | null;
  onSelectState?: (stateId: string) => void;
  priorityFormat?: 'circled' | 'bracket' | 'paren';
  availableEdges?: EdgeInfo[];
  notes?: DiagramNotes;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

interface CustomColorGroup {
  style: NodeDisplayProperties;
  states: { id: string; label: string }[];
  presetName?: string;
}

export const DiagramLegendOverlay: React.FC<DiagramLegendOverlayProps> = ({
  isOpen,
  onClose,
  customStyles = {},
  availableStates = [],
  selectedStateId,
  onSelectState,
  priorityFormat = 'circled',
  availableEdges = [],
  notes,
  containerRef,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<LegendTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number }>({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });
  const overlayRef = useRef<HTMLDivElement>(null);

  // Group active customized states in the diagram by color/style
  const customColorGroups = useMemo<CustomColorGroup[]>(() => {
    const groupsMap = new Map<string, CustomColorGroup>();

    Object.entries(customStyles).forEach(([stateId, style]) => {
      if (!style.fill && !style.stroke && !style.color) return;
      const key = `${style.fill || ''}-${style.stroke || ''}-${style.color || ''}`;
      const stateObj = availableStates.find((s) => s.id === stateId) || {
        id: stateId,
        label: stateId,
      };

      // Match preset name if available
      const matchedPreset = CURATED_COLOR_PRESETS.find(
        (p) => p.fill.toLowerCase() === (style.fill || '').toLowerCase()
      );

      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          style,
          states: [{ id: stateObj.id, label: stateObj.label }],
          presetName: matchedPreset?.name,
        });
      } else {
        groupsMap.get(key)!.states.push({ id: stateObj.id, label: stateObj.label });
      }
    });

    return Array.from(groupsMap.values());
  }, [customStyles, availableStates]);

  // Count priorities in the diagram
  const priorityStats = useMemo(() => {
    let p1 = 0;
    let p2 = 0;
    let p3Plus = 0;
    let preProcessCount = 0;

    availableEdges.forEach((edge) => {
      if (edge.priority === 1) p1++;
      else if (edge.priority === 2) p2++;
      else if (edge.priority && edge.priority >= 3) p3Plus++;

      if (edge.label?.includes('[preProcess]') || edge.condition?.includes('preProcess')) {
        preProcessCount++;
      }
    });

    return { p1, p2, p3Plus, preProcessCount, total: availableEdges.length };
  }, [availableEdges]);

  // Dragging support so user can freely place the legend anywhere on canvas
  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = overlayRef.current?.getBoundingClientRect();
    const currentX = position ? position.x : (rect?.left ?? 16);
    const currentY = position ? position.y : (rect?.top ?? 16);

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: currentX,
      initialY: currentY,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
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

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = overlayRef.current?.getBoundingClientRect();
    const currentX = position ? position.x : (rect?.left ?? 16);
    const currentY = position ? position.y : (rect?.top ?? 16);

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

  const handleResetPosition = () => {
    setPosition(null);
  };

  const matchesSearch = (text: string) => {
    if (!searchQuery.trim()) return true;
    return text.toLowerCase().includes(searchQuery.toLowerCase().trim());
  };

  if (!isOpen) return null;

  // Render priority preview badge
  const renderPriorityBadge = (num: number) => {
    if (priorityFormat === 'bracket') return `[${num}]`;
    if (priorityFormat === 'paren') return `(${num})`;
    // circled
    return String.fromCodePoint(0x2460 + num - 1);
  };

  // If collapsed: show compact bottom-left pill
  if (isCollapsed) {
    return (
      <div
        id="diagram-legend-collapsed"
        style={position ? { left: `${position.x}px`, top: `${position.y}px` } : undefined}
        className={`z-30 select-none animate-in fade-in zoom-in-95 duration-150 ${
          position ? 'fixed' : 'absolute bottom-4 left-4'
        }`}
      >
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/95 hover:bg-slate-800 border border-slate-700/80 hover:border-sky-500/60 shadow-xl backdrop-blur-md text-xs font-medium text-slate-200 hover:text-white transition-all cursor-pointer group"
          title="Expand Diagram Legend (Shortcut: L)"
        >
          <BookOpen className="w-3.5 h-3.5 text-sky-400 group-hover:scale-110 transition-transform" />
          <span>Diagram Legend</span>
          {customColorGroups.length > 0 && (
            <span
              className="px-1.5 py-0.2 rounded-full bg-emerald-950 text-emerald-300 font-mono text-[10px] border border-emerald-800/60"
              title={`${customColorGroups.length} custom color groups`}
            >
              {customColorGroups.length} colors
            </span>
          )}
          <ChevronUp className="w-3 h-3 text-slate-400 ml-0.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={overlayRef}
      id="diagram-legend-overlay"
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
      className={`z-30 flex flex-col w-[360px] sm:w-[410px] max-w-[94vw] max-h-[70vh] rounded-xl bg-slate-900/95 border border-slate-700/80 shadow-2xl backdrop-blur-md overflow-hidden select-none animate-in fade-in slide-in-from-bottom-2 duration-150 ring-1 ring-black/40 ${
        position ? 'fixed' : 'absolute bottom-4 left-4'
      }`}
    >
      {/* Header bar with drag handle */}
      <div
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onMouseDown={handleMouseDown}
        className={`flex items-center justify-between px-3 py-2 bg-slate-950/90 border-b border-slate-800 text-xs text-slate-300 shrink-0 touch-none ${
          isDragging ? 'cursor-grabbing bg-slate-900' : 'cursor-grab'
        }`}
        title="Click and drag to reposition legend"
      >
        <div className="flex items-center gap-2 min-w-0">
          <GripHorizontal className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <div className="flex items-center gap-1.5 min-w-0">
            <BookOpen className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="font-semibold text-xs text-slate-100">Diagram Legend</span>
          </div>
          <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700/60 hidden sm:inline">
            Shortcut: L
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {position && (
            <button
              type="button"
              onClick={handleResetPosition}
              className="p-1 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition-colors cursor-pointer"
              title="Reset position to bottom-left dock"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsCollapsed(true)}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Minimize Legend"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer ml-0.5"
            title="Close Legend (L)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Search and Navigation Tabs */}
      <div className="px-3 pt-2.5 pb-2 bg-slate-950/40 border-b border-slate-800/80 shrink-0 space-y-2">
        {/* Search input */}
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search colors, priorities, symbols..."
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

        {/* Tab Buttons */}
        <div className="flex items-center gap-1 p-0.5 bg-slate-950 rounded-lg border border-slate-800 text-[11px]">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`flex-1 py-1 rounded text-center font-medium transition-colors cursor-pointer ${
              activeTab === 'all'
                ? 'bg-sky-950 text-sky-300 font-semibold shadow-xs border border-sky-800/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('colors')}
            className={`flex-1 py-1 rounded text-center font-medium transition-colors cursor-pointer ${
              activeTab === 'colors'
                ? 'bg-sky-950 text-sky-300 font-semibold shadow-xs border border-sky-800/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🎨 Colors
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('priorities')}
            className={`flex-1 py-1 rounded text-center font-medium transition-colors cursor-pointer ${
              activeTab === 'priorities'
                ? 'bg-sky-950 text-sky-300 font-semibold shadow-xs border border-sky-800/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🔢 Priorities
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('symbols')}
            className={`flex-1 py-1 rounded text-center font-medium transition-colors cursor-pointer ${
              activeTab === 'symbols'
                ? 'bg-sky-950 text-sky-300 font-semibold shadow-xs border border-sky-800/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🔣 Symbols
          </button>
        </div>
      </div>

      {/* Legend Content Scroll Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs text-slate-300 custom-scrollbar divide-y divide-slate-800/60">
        {/* =========================================================================
            SECTION 1: CUSTOM NODE COLORS & INDUSTRY PRESETS
           ========================================================================= */}
        {(activeTab === 'all' || activeTab === 'colors') && (
          <div className="space-y-3 pt-1 first:pt-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-slate-200 text-xs">
                <Palette className="w-3.5 h-3.5 text-sky-400" />
                <span>Custom Node Colors & Semantics</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                {customColorGroups.length > 0 ? `${customColorGroups.length} active styles` : 'Presets'}
              </span>
            </div>

            {/* If diagram has active customized nodes */}
            {customColorGroups.length > 0 && matchesSearch('custom active color') && (
              <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5 space-y-2">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  <span>Active Custom Styles in Current Diagram</span>
                </div>
                <div className="space-y-1.5">
                  {customColorGroups.map((group, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2.5 p-1.5 rounded-lg bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-colors"
                    >
                      {/* Swatch preview */}
                      <div
                        className="w-5 h-5 rounded-md shrink-0 flex items-center justify-center text-[10px] font-bold shadow-xs mt-0.5 border"
                        style={{
                          backgroundColor: group.style.fill || '#1e293b',
                          borderColor: group.style.stroke || '#475569',
                          borderWidth: group.style.strokeWidth || '1.5px',
                          color: group.style.color || '#f8fafc',
                        }}
                      >
                        S
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold text-slate-200 text-[11px]">
                            {group.presetName || 'Custom Styled'}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {group.states.length} state{group.states.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {group.states.map((st) => (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => onSelectState && onSelectState(st.id)}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer truncate max-w-[170px] ${
                                selectedStateId === st.id
                                  ? 'bg-sky-950 text-sky-300 border border-sky-600/80 font-semibold'
                                  : 'bg-slate-800/90 text-slate-300 hover:bg-slate-700 border border-slate-700/60'
                              }`}
                              title={`Focus state ${st.label || st.id}`}
                            >
                              {st.label || st.id}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Standard Curated Industrial State Machine Colors */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Industrial State Machine Conventions
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {CURATED_COLOR_PRESETS.filter(
                  (preset) =>
                    matchesSearch(preset.name) ||
                    matchesSearch(preset.description) ||
                    matchesSearch(preset.id)
                ).map((preset) => (
                  <div
                    key={preset.id}
                    className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition-colors"
                  >
                    <div
                      className="w-4 h-4 rounded shrink-0 border shadow-xs"
                      style={{
                        backgroundColor: preset.fill,
                        borderColor: preset.stroke,
                        borderWidth: preset.strokeWidth,
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-200 text-[11px] truncate">
                        {preset.name}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate leading-tight">
                        {preset.description.split(' background')[0]}
                      </div>
                    </div>
                  </div>
                ))}

                {matchesSearch('default neutral') && (
                  <div className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
                    <div className="w-4 h-4 rounded shrink-0 bg-slate-800 border border-slate-600 shadow-xs" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-200 text-[11px] truncate">
                        Default State
                      </div>
                      <div className="text-[10px] text-slate-400 truncate leading-tight">
                        Standard theme state block
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
              <Info className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>
                Tip: Right-click any state on the diagram and select <strong>Customize Style</strong> to apply custom colors.
              </span>
            </div>
          </div>
        )}

        {/* =========================================================================
            SECTION 2: TRANSITION PRIORITIES
           ========================================================================= */}
        {(activeTab === 'all' || activeTab === 'priorities') && (
          <div className="space-y-3 pt-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-slate-200 text-xs">
                <ArrowRight className="w-3.5 h-3.5 text-sky-400" />
                <span>Transition Priorities & Evaluation Order</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                Format: {priorityFormat}
              </span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              In Beckhoff TwinCAT / IEC 61131-3, state transitions from a single state evaluate in conditional sequence (<code className="text-sky-300 font-mono text-[10px]">IF ... ELSIF ... ELSE</code>). Badges indicate execution precedence:
            </p>

            {/* Priority Level Cards */}
            <div className="space-y-2">
              {matchesSearch('priority 1 first emergency fault') && (
                <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 hover:border-slate-700 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-rose-950/90 text-rose-300 font-bold font-mono text-xs flex items-center justify-center border border-rose-600/70 shadow-xs shrink-0">
                        {renderPriorityBadge(1)}
                      </span>
                      <span className="font-semibold text-slate-100 text-[11px]">
                        Priority 1 — Highest Precedence
                      </span>
                    </div>
                    {priorityStats.p1 > 0 && (
                      <span className="text-[10px] font-mono text-rose-300 bg-rose-950/60 px-1.5 py-0.5 rounded border border-rose-800/60">
                        {priorityStats.p1} edge{priorityStats.p1 > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 leading-normal pl-8">
                    Evaluated first on every PLC scan. Always takes precedence over lower-priority transitions. Used for safety, emergency stops, alarm trips, and immediate faults.
                  </p>
                </div>
              )}

              {matchesSearch('priority 2 second normal') && (
                <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 hover:border-slate-700 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-sky-950/90 text-sky-300 font-bold font-mono text-xs flex items-center justify-center border border-sky-600/70 shadow-xs shrink-0">
                        {renderPriorityBadge(2)}
                      </span>
                      <span className="font-semibold text-slate-100 text-[11px]">
                        Priority 2 — Secondary Precedence
                      </span>
                    </div>
                    {priorityStats.p2 > 0 && (
                      <span className="text-[10px] font-mono text-sky-300 bg-sky-950/60 px-1.5 py-0.5 rounded border border-sky-800/60">
                        {priorityStats.p2} edge{priorityStats.p2 > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 leading-normal pl-8">
                    Evaluated second if Priority 1 condition evaluates to <code className="text-sky-300 font-mono text-[9px]">FALSE</code>. Typical primary operational flow or motion completion guard.
                  </p>
                </div>
              )}

              {matchesSearch('priority 3 lower third') && (
                <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 hover:border-slate-700 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-amber-950/90 text-amber-300 font-bold font-mono text-xs flex items-center justify-center border border-amber-600/70 shadow-xs shrink-0">
                        {renderPriorityBadge(3)}
                      </span>
                      <span className="font-semibold text-slate-100 text-[11px]">
                        Priority 3+ — Lower Precedence
                      </span>
                    </div>
                    {priorityStats.p3Plus > 0 && (
                      <span className="text-[10px] font-mono text-amber-300 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/60">
                        {priorityStats.p3Plus} edge{priorityStats.p3Plus > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 leading-normal pl-8">
                    Evaluated sequentially after all higher-priority guards fail. Frequently handles timeouts, retries, or alternate secondary branches.
                  </p>
                </div>
              )}

              {matchesSearch('fallback else unnumbered') && (
                <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 hover:border-slate-700 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-slate-800 text-slate-400 font-bold font-mono text-[10px] flex items-center justify-center border border-slate-700 shrink-0">
                      ELSE
                    </span>
                    <span className="font-semibold text-slate-100 text-[11px]">
                      Fallback / Unnumbered (Default)
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 leading-normal pl-8">
                    Default transition taken when no guarded conditions match. Guarantees deterministic state machine progression without deadlock.
                  </p>
                </div>
              )}

              {matchesSearch('preprocess global supervisor') && (
                <div className="p-2 rounded-lg bg-slate-950/70 border border-indigo-950/90 hover:border-indigo-800/80 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 font-mono text-[9px] border border-indigo-700/80 font-bold shrink-0">
                        [preProcess]
                      </span>
                      <span className="font-semibold text-slate-100 text-[11px]">
                        Supervisor / Global Transition
                      </span>
                    </div>
                    {priorityStats.preProcessCount > 0 && (
                      <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-800/60">
                        {priorityStats.preProcessCount} active
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 leading-normal pl-8">
                    Transition originated from <code className="text-indigo-300 font-mono text-[9px]">preProcess()</code>. Evaluated across all states before state-specific logic runs.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
              <Info className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>
                Click on any priority badge or edge label in the diagram to inspect its exact Boolean guard condition.
              </span>
            </div>
          </div>
        )}

        {/* =========================================================================
            SECTION 3: STATE SYMBOLS & FLOW MARKERS
           ========================================================================= */}
        {(activeTab === 'all' || activeTab === 'symbols') && (
          <div className="space-y-3 pt-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-slate-200 text-xs">
                <HelpCircle className="w-3.5 h-3.5 text-sky-400" />
                <span>State Symbols & Diagram Notation</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">UML Statechart</span>
            </div>

            <div className="space-y-2">
              {matchesSearch('start initial entry') && (
                <div className="flex items-start gap-2.5 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 mt-0.5 shadow-[0_0_8px_rgba(16,185,129,0.5)]">
                    <div className="w-2 h-2 rounded-full bg-emerald-100" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-200 text-[11px]">
                      Initial / Start Pseudo-State (<code className="text-emerald-300 font-mono text-[10px]">[*]</code>)
                    </div>
                    <div className="text-[10px] text-slate-400 leading-normal">
                      The power-on entry point of the state machine. Defines the boot state (e.g. <code className="text-slate-300 font-mono text-[9px]">INIT</code> or <code className="text-slate-300 font-mono text-[9px]">DISABLED</code>).
                    </div>
                  </div>
                </div>
              )}

              {matchesSearch('terminal final end completion') && (
                <div className="flex items-start gap-2.5 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="w-5 h-5 rounded-full border-2 border-slate-300 flex items-center justify-center shrink-0 mt-0.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-200 text-[11px]">
                      Terminal / Final Pseudo-State (<code className="text-slate-300 font-mono text-[10px]">[*]</code>)
                    </div>
                    <div className="text-[10px] text-slate-400 leading-normal">
                      Indicates completion of state cycle, operation sequence exit, or terminal shutdown state.
                    </div>
                  </div>
                </div>
              )}

              {matchesSearch('active selected current glow') && (
                <div className="flex items-start gap-2.5 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="w-5 h-5 rounded-md bg-sky-950 border-2 border-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.7)] flex items-center justify-center shrink-0 mt-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-200 text-[11px]">
                      Active Selected State
                    </div>
                    <div className="text-[10px] text-slate-400 leading-normal">
                      Surrounded by cyan glowing halo. Linked directly with Method Editor and State Style Inspector.
                    </div>
                  </div>
                </div>
              )}

              {matchesSearch('guarded condition transition arrow') && (
                <div className="flex items-start gap-2.5 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="w-5 h-5 flex items-center justify-center shrink-0 mt-0.5 text-sky-400 font-mono text-xs">
                    ──►
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-200 text-[11px]">
                      Guarded Transition (<code className="text-sky-300 font-mono text-[10px]">── [Condition] ──►</code>)
                    </div>
                    <div className="text-[10px] text-slate-400 leading-normal">
                      Transition only occurs when the guard expression evaluates to <code className="text-emerald-300 font-mono text-[9px]">TRUE</code>. Labeled along the edge path.
                    </div>
                  </div>
                </div>
              )}

              {matchesSearch('self loop dwell timer wait') && (
                <div className="flex items-start gap-2.5 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="w-5 h-5 rounded-full bg-amber-950/80 border border-amber-600/70 flex items-center justify-center shrink-0 mt-0.5 text-amber-300">
                    <RotateCcw className="w-3 h-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-200 text-[11px]">
                      Self-Loop / Dwell Transition
                    </div>
                    <div className="text-[10px] text-slate-400 leading-normal">
                      Curved edge returning to the originating state. State continues executing while waiting on timers (<code className="text-amber-300 font-mono text-[9px]">ton.Q</code>) or sensors.
                    </div>
                  </div>
                </div>
              )}

              {matchesSearch('note annotation sticky') && (
                <div className="flex items-start gap-2.5 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="w-5 h-5 rounded-md bg-amber-500/20 border border-amber-500/50 flex items-center justify-center shrink-0 mt-0.5 text-amber-400">
                    <StickyNote className="w-3 h-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-200 text-[11px]">
                      Annotated Node / Note Badge
                    </div>
                    <div className="text-[10px] text-slate-400 leading-normal">
                      Indicates documentation or engineering notes are attached to this state or edge.
                    </div>
                  </div>
                </div>
              )}

              {matchesSearch('composite substate group nested') && (
                <div className="flex items-start gap-2.5 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="w-5 h-5 rounded-md bg-slate-800 border-2 border-dashed border-slate-500 flex items-center justify-center shrink-0 mt-0.5">
                    <Layers className="w-2.5 h-2.5 text-slate-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-200 text-[11px]">
                      Composite / Substate Group
                    </div>
                    <div className="text-[10px] text-slate-400 leading-normal">
                      Grouped functional block enclosing nested substates (e.g. Infeed sequence or Homing routines).
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer Status Bar */}
      <div className="px-3 py-1.5 bg-slate-950 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
          <span>Interactive Legend</span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px]">
          <span>{availableStates.length} States</span>
          <span>•</span>
          <span>{availableEdges.length} Transitions</span>
        </div>
      </div>
    </div>
  );
};
