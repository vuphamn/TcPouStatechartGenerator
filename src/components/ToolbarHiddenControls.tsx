import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  MoreHorizontal,
  ChevronDown,
  SlidersHorizontal,
  Palette,
  Code2,
  FileCode,
  Workflow,
  Lock,
  Unlock,
  RotateCcw,
  StickyNote,
  Map,
  BookOpen,
  Activity,
  Flame,
  AlertTriangle,
  Magnet,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  X,
  Check,
  MousePointerClick,
} from 'lucide-react';
import { SnapConfig } from '../utils/snapToGrid.ts';

export interface ToolbarHiddenControlsProps {
  isInteractiveMode: boolean;
  setIsInteractiveMode: (valOrFn: boolean | ((prev: boolean) => boolean)) => void;
  isCompactLabels: boolean;
  setIsCompactLabels: React.Dispatch<React.SetStateAction<boolean>>;
  isInspectorOpen: boolean;
  handleToggleInspector: () => void;
  handleOpenMethodEditor: (methodName?: string) => void;
  handleOpenEnumEditor: (memberName?: string) => void;
  hasPouContent: boolean;
  hasDutContent: boolean;
  handleAutoAlign: () => void;
  isAutoAligning: boolean;
  isLayoutLocked: boolean;
  handleToggleLayoutLocked: () => void;
  movedElementsCount: number;
  handleResetLayout: () => void;
  totalNotesCount: number;
  onOpenNotesDrawer: () => void;
  isMinimapOpen: boolean;
  setIsMinimapOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isLegendOpen: boolean;
  setIsLegendOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isStatsOpen: boolean;
  setIsStatsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isHeatmapActive: boolean;
  setIsHeatmapActive: React.Dispatch<React.SetStateAction<boolean>>;
  setIsHeatmapPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  refactorCandidatesCount: number;
  complexityThreshold: number;
  snapConfig: SnapConfig;
  setSnapConfig: React.Dispatch<React.SetStateAction<SnapConfig>>;
  setShowSnapToast: (val: { message: string; timestamp: number } | null) => void;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  handleResetZoom: () => void;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  isSearchFocused?: boolean;
}

export const ToolbarHiddenControls: React.FC<ToolbarHiddenControlsProps> = ({
  isInteractiveMode,
  setIsInteractiveMode,
  isCompactLabels,
  setIsCompactLabels,
  isInspectorOpen,
  handleToggleInspector,
  handleOpenMethodEditor,
  handleOpenEnumEditor,
  hasPouContent,
  hasDutContent,
  handleAutoAlign,
  isAutoAligning,
  isLayoutLocked,
  handleToggleLayoutLocked,
  movedElementsCount,
  handleResetLayout,
  totalNotesCount,
  onOpenNotesDrawer,
  isMinimapOpen,
  setIsMinimapOpen,
  isLegendOpen,
  setIsLegendOpen,
  isStatsOpen,
  setIsStatsOpen,
  isHeatmapActive,
  setIsHeatmapActive,
  setIsHeatmapPanelOpen,
  refactorCandidatesCount,
  complexityThreshold,
  snapConfig,
  setSnapConfig,
  setShowSnapToast,
  zoom,
  setZoom,
  handleResetZoom,
  isFullscreen,
  toggleFullscreen,
  isSearchFocused = false,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1920
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number; width: number }>({
    top: 90,
    left: 100,
    width: 384,
  });

  // Calculate and update dropdown coordinates anchored to the toolbar button
  const updateDropdownPosition = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const menuWidth = Math.min(384, window.innerWidth - 16);
    let left = rect.left;
    // Align dropdown right edge with button right edge if button is in the right half of screen
    if (rect.left > window.innerWidth / 2) {
      left = rect.right - menuWidth;
    }
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    if (left < 8) left = 8;
    setDropdownCoords({
      top: rect.bottom + 8,
      left: Math.round(left),
      width: Math.round(menuWidth),
    });
  };

  // Monitor window resize & scroll
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
      if (isOpen) {
        updateDropdownPosition();
      }
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
    };
  }, [isOpen]);

  // Update position when opening
  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();
    }
  }, [isOpen]);

  // Click outside listener (check both the trigger button and the portal dropdown)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Escape key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Compute count of diagram tools accessible in this toolbar menu
  const hiddenCount = (() => {
    let count = 12; // Comprehensive diagram toolbar tools
    if (windowWidth <= 1920) count += 2; // On 1920x1080 and below, toolbar overflow/compacting occurs
    if (windowWidth < 1280) count += 4;
    if (windowWidth < 768) count += 2;
    if (isSearchFocused) count += 6; // Extra buttons tucked into Hidden list when search input expands
    return count;
  })();

  return (
    <div className="inline-flex items-center shrink-0" id="toolbar-hidden-controls-container">
      <button
        ref={buttonRef}
        id="toolbar-hidden-controls-btn"
        type="button"
        onClick={() => {
          if (!isOpen) {
            updateDropdownPosition();
          }
          setIsOpen((prev) => !prev);
        }}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
          isOpen
            ? 'bg-amber-500/25 text-amber-300 border border-amber-500/70 shadow-sm ring-1 ring-amber-500/40'
            : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 hover:text-amber-200 border border-amber-500/40 shadow-xs'
        }`}
        title={`Toolbar hidden controls menu (${hiddenCount} tools & options accessible here)`}
        aria-label="Toolbar hidden controls menu"
        aria-expanded={isOpen}
      >
        <MoreHorizontal className="w-3.5 h-3.5 text-amber-400" />
        <span>Hidden</span>
        <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 font-mono font-bold text-[10px] leading-tight">
          {hiddenCount}
        </span>
        <ChevronDown
          className={`w-3 h-3 text-amber-400/80 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Floating Dropdown for Hidden Toolbar Controls - rendered via Portal to document.body so it appears in front of Diagram Canvas and all elements */}
      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            id="toolbar-hidden-controls-menu"
            style={{
              position: 'fixed',
              top: `${dropdownCoords.top}px`,
              left: `${dropdownCoords.left}px`,
              width: `${dropdownCoords.width}px`,
              zIndex: 99999,
            }}
            className="max-h-[85vh] overflow-y-auto bg-slate-900/98 border border-slate-700/90 rounded-xl shadow-2xl backdrop-blur-md p-3.5 text-xs text-slate-200 flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-150"
          >
          {/* Header Titlebar */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded-md bg-amber-500/20 text-amber-400">
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </span>
              <div>
                <div className="font-semibold text-xs text-slate-100 flex items-center gap-1.5">
                  <span>Toolbar Controls</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60">
                    {isSearchFocused ? 'Search Expanded' : 'Hidden Tools'}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400">
                  {isSearchFocused
                    ? 'Controls protected inside this menu while search input is expanded'
                    : 'Full control access for buttons collapsed or hidden on smaller monitors'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
              title="Close menu (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* SECTION 1: Display Mode & Labels */}
          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Display & Editors
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {/* Interactive Mode Toggle */}
              <button
                type="button"
                onClick={() => setIsInteractiveMode((prev) => !prev)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  isInteractiveMode
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/70 shadow-xs'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <MousePointerClick className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Interactive</span>
                </div>
                <span className="text-[9px] font-bold px-1 rounded bg-slate-900 border border-slate-700">
                  {isInteractiveMode ? 'ON' : 'OFF'}
                </span>
              </button>

              {/* Compact Labels Toggle (hidden below md breakpoint in toolbar) */}
              <button
                type="button"
                onClick={() => setIsCompactLabels((prev) => !prev)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  isCompactLabels
                    ? 'bg-sky-950/80 text-sky-300 border-sky-600/70 shadow-xs'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
                title="Toggle between clean shortened condition labels and full condition text"
              >
                <div className="flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-sky-400" />
                  <span>Labels</span>
                </div>
                <span className="text-[9px] font-bold px-1 rounded bg-slate-900 border border-slate-700">
                  {isCompactLabels ? 'Clean' : 'Full'}
                </span>
              </button>

              {/* Node Styles Inspector */}
              <button
                type="button"
                onClick={() => {
                  handleToggleInspector();
                  setIsOpen(false);
                }}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  isInspectorOpen
                    ? 'bg-sky-950/80 text-sky-300 border-sky-600/70 shadow-xs'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5 text-sky-400" />
                  <span>Node Styles</span>
                </div>
                {isInspectorOpen && <Check className="w-3 h-3 text-sky-400" />}
              </button>

              {/* Fullscreen Toggle */}
              <button
                type="button"
                onClick={() => {
                  toggleFullscreen();
                  setIsOpen(false);
                }}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  isFullscreen
                    ? 'bg-sky-600 text-white border-sky-500 shadow-sm'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {isFullscreen ? (
                    <Minimize2 className="w-3.5 h-3.5" />
                  ) : (
                    <Maximize2 className="w-3.5 h-3.5" />
                  )}
                  <span>Fullscreen</span>
                </div>
                <span className="text-[9px] font-bold px-1 rounded bg-slate-900/60 border border-slate-700">
                  {isFullscreen ? 'Exit' : 'Enter'}
                </span>
              </button>
            </div>

            {/* Code Editors */}
            {(hasPouContent || hasDutContent) && (
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                {hasPouContent && (
                  <button
                    type="button"
                    onClick={() => {
                      handleOpenMethodEditor('doState()');
                      setIsOpen(false);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  >
                    <FileCode className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span className="truncate">Edit Methods POU</span>
                  </button>
                )}
                {hasDutContent && (
                  <button
                    type="button"
                    onClick={() => {
                      handleOpenEnumEditor(undefined);
                      setIsOpen(false);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  >
                    <Code2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span className="truncate">Edit ENUM DUT</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* SECTION 2: Diagram Layout & Auto-Align */}
          <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-800">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Layout & Positioning
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {/* Auto-Align */}
              <button
                type="button"
                onClick={() => {
                  handleAutoAlign();
                }}
                disabled={isAutoAligning}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  isAutoAligning
                    ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Workflow
                    className={`w-3.5 h-3.5 text-sky-400 ${
                      isAutoAligning ? 'animate-spin' : ''
                    }`}
                  />
                  <span>Auto-Align</span>
                </div>
                <span className="text-[9px] text-slate-500 font-mono">Key: A</span>
              </button>

              {/* Lock Layout */}
              <button
                type="button"
                onClick={handleToggleLayoutLocked}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  isLayoutLocked
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-xs'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {isLayoutLocked ? (
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <Unlock className="w-3.5 h-3.5 text-slate-400" />
                  )}
                  <span>Layout</span>
                </div>
                <span className="text-[9px] font-bold px-1 rounded bg-slate-900 border border-slate-700">
                  {isLayoutLocked ? 'Locked' : 'Unlocked'}
                </span>
              </button>
            </div>

            {/* Reset Layout button (if moved elements exist) */}
            {movedElementsCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  handleResetLayout();
                }}
                className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-medium transition-all cursor-pointer mt-1"
              >
                <div className="flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                  <span>Reset Diagram Layout</span>
                </div>
                <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 font-bold text-[10px]">
                  {movedElementsCount} moved
                </span>
              </button>
            )}
          </div>

          {/* SECTION 3: Overlays & Panels */}
          <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-800">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Panels & Diagnostics
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {/* Notes Drawer */}
              <button
                type="button"
                onClick={() => {
                  onOpenNotesDrawer();
                  setIsOpen(false);
                }}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  totalNotesCount > 0
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <StickyNote className="w-3.5 h-3.5 text-amber-400" />
                  <span>Notes</span>
                </div>
                {totalNotesCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 font-bold text-[10px]">
                    {totalNotesCount}
                  </span>
                )}
              </button>

              {/* Minimap */}
              <button
                type="button"
                onClick={() => setIsMinimapOpen((prev) => !prev)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  isMinimapOpen
                    ? 'bg-sky-950/80 text-sky-300 border-sky-600/70 shadow-xs'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Map className="w-3.5 h-3.5 text-sky-400" />
                  <span>Minimap</span>
                </div>
                <span className="text-[9px] font-bold px-1 rounded bg-slate-900 border border-slate-700">
                  {isMinimapOpen ? 'ON' : 'OFF'}
                </span>
              </button>

              {/* Legend */}
              <button
                type="button"
                onClick={() => setIsLegendOpen((prev) => !prev)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  isLegendOpen
                    ? 'bg-sky-950/80 text-sky-300 border-sky-600/70 shadow-xs'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-sky-400" />
                  <span>Legend</span>
                </div>
                <span className="text-[9px] font-bold px-1 rounded bg-slate-900 border border-slate-700">
                  {isLegendOpen ? 'ON' : 'OFF'}
                </span>
              </button>

              {/* Stats */}
              <button
                type="button"
                onClick={() => setIsStatsOpen((prev) => !prev)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  isStatsOpen
                    ? 'bg-sky-950/80 text-sky-300 border-sky-600/70 shadow-xs'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-sky-400" />
                  <span>Statistics</span>
                </div>
                <span className="text-[9px] font-bold px-1 rounded bg-slate-900 border border-slate-700">
                  {isStatsOpen ? 'ON' : 'OFF'}
                </span>
              </button>

              {/* Heat-map Mode */}
              <button
                type="button"
                onClick={() => {
                  if (!isHeatmapActive) {
                    setIsHeatmapActive(true);
                    setIsHeatmapPanelOpen(true);
                  } else {
                    setIsHeatmapPanelOpen((prev) => !prev);
                  }
                }}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  isHeatmapActive
                    ? 'bg-amber-950/80 text-amber-300 border-amber-500/70 shadow-xs'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Flame className={`w-3.5 h-3.5 ${isHeatmapActive ? 'text-amber-400' : 'text-amber-500'}`} />
                  <span>Heat-Map</span>
                </div>
                <span className="text-[9px] font-bold px-1 rounded bg-slate-900 border border-slate-700">
                  {isHeatmapActive ? 'ON' : 'OFF'}
                </span>
              </button>

              {/* Refactor Alert */}
              <button
                type="button"
                onClick={() => {
                  setIsHeatmapPanelOpen(true);
                  setIsOpen(false);
                }}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  refactorCandidatesCount > 0
                    ? 'bg-rose-950/80 text-rose-300 border-rose-500/60 shadow-xs'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                  <span>Refactor Alert</span>
                </div>
                {refactorCandidatesCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white font-extrabold text-[10px]">
                    {refactorCandidatesCount} (M≥{complexityThreshold})
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* SECTION 4: Grid, Snap & Zoom Navigation */}
          <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-800">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Snap to Grid & Zoom
            </div>

            {/* Snap Toggle + Resolution */}
            <div className="flex items-center justify-between bg-slate-950 p-1.5 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setSnapConfig((prev: SnapConfig) => {
                    const next = { ...prev, enabled: !prev.enabled };
                    setShowSnapToast({
                      message: next.enabled ? `Snap to Grid: ON (${next.gridSize}px)` : 'Snap to Grid: OFF',
                      timestamp: Date.now(),
                    });
                    return next;
                  });
                }}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                  snapConfig.enabled ? 'bg-sky-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Magnet className="w-3.5 h-3.5" />
                <span>Snap to Grid</span>
              </button>

              {/* Grid sizes */}
              <div className="flex items-center gap-1">
                {[10, 20, 40].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => {
                      setSnapConfig((prev: SnapConfig) => ({ ...prev, gridSize: size, enabled: true }));
                      setShowSnapToast({
                        message: `Grid resolution: ${size}px`,
                        timestamp: Date.now(),
                      });
                    }}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-mono cursor-pointer transition-colors ${
                      snapConfig.gridSize === size && snapConfig.enabled
                        ? 'bg-sky-500 text-white font-bold'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {size}px
                  </button>
                ))}
              </div>
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center justify-between bg-slate-950 p-1.5 rounded-lg border border-slate-800">
              <span className="text-slate-300 flex items-center gap-1">
                <span>Zoom Level:</span>
                <span className="font-mono text-sky-400 font-semibold">{Math.round(zoom * 100)}%</span>
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.2, z * 0.85))}
                  className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(5, z * 1.15))}
                  className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleResetZoom}
                  className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                  title="Reset Zoom to 100%"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
