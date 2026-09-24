import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  MoreHorizontal,
  ChevronDown,
  Printer,
  ExternalLink,
  Lock,
  Unlock,
  Settings2,
  CheckCircle2,
  Loader2,
  X,
  Palette,
  Check,
  RotateCcw,
  Copy,
  Download,
  Sparkles,
} from 'lucide-react';
import { FlowchartCurve, MermaidTheme } from './MermaidViewer.tsx';
import { PriorityFormat } from '../generator.ts';
import { DiagramPreset, PresetExportSettings } from '../types.ts';
import { DiagramOptionsState } from '../utils/diagramPresets.ts';
import { DiagramPresetManager } from './DiagramPresetManager.tsx';

export interface HeaderHiddenControlsProps {
  currentPresetOptions?: DiagramOptionsState;
  onApplyPreset?: (preset: DiagramPreset) => void;
  onExportSettingsChange?: (settings: PresetExportSettings) => void;
  flowchartOutput: boolean;
  setFlowchartOutput: (val: boolean) => void;
  collapseErrorSinkEdges: boolean;
  setCollapseErrorSinkEdges: (val: boolean) => void;
  includeStateDescriptions: boolean;
  setIncludeStateDescriptions: (val: boolean) => void;
  showTransitionPriorities: boolean;
  setShowTransitionPriorities: (val: boolean) => void;
  priorityFormat: PriorityFormat;
  setPriorityFormat: (format: PriorityFormat) => void;
  layoutEngine: 'dagre' | 'elk';
  setLayoutEngine: (engine: 'dagre' | 'elk') => void;
  flowchartCurve: FlowchartCurve;
  setFlowchartCurve: (curve: FlowchartCurve) => void;
  mermaidTheme: MermaidTheme;
  setMermaidTheme: (theme: MermaidTheme) => void;
  lockDiagramLayout: boolean;
  setLockDiagramLayout: React.Dispatch<React.SetStateAction<boolean>>;
  liveUpdate: boolean;
  setLiveUpdate: (val: boolean) => void;
  handlePrintToPdf: () => void;
  isPrintingPdf: boolean;
  handleOpenMermaidLive: () => void;
  generationStats: {
    linesCount: number;
    timeMs: number;
  } | null;
  outputMarkdown: string;
  customizedStatesCount?: number;
  onClearAllCustomStyles?: () => void;
  isSidebarOpen?: boolean;
  onCopyMarkdown?: () => void;
  copiedMarkdown?: boolean;
  onDownload?: () => void;
  onOpenExportDialog?: () => void;
}

export const HeaderHiddenControls: React.FC<HeaderHiddenControlsProps> = ({
  currentPresetOptions,
  onApplyPreset,
  onExportSettingsChange,
  flowchartOutput,
  setFlowchartOutput,
  collapseErrorSinkEdges,
  setCollapseErrorSinkEdges,
  includeStateDescriptions,
  setIncludeStateDescriptions,
  showTransitionPriorities,
  setShowTransitionPriorities,
  priorityFormat,
  setPriorityFormat,
  layoutEngine,
  setLayoutEngine,
  flowchartCurve,
  setFlowchartCurve,
  mermaidTheme,
  setMermaidTheme,
  lockDiagramLayout,
  setLockDiagramLayout,
  liveUpdate,
  setLiveUpdate,
  handlePrintToPdf,
  isPrintingPdf,
  handleOpenMermaidLive,
  generationStats,
  outputMarkdown,
  customizedStatesCount = 0,
  onClearAllCustomStyles,
  isSidebarOpen = true,
  onCopyMarkdown,
  copiedMarkdown,
  onDownload,
  onOpenExportDialog,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1920
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number; width: number }>({
    top: 50,
    left: 100,
    width: 384,
  });

  // Calculate and update dropdown coordinates anchored to the button
  const updateDropdownPosition = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const menuWidth = Math.min(384, window.innerWidth - 16);
    let left = rect.right - menuWidth;
    if (left < 8) left = 8;
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    setDropdownCoords({
      top: rect.bottom + 8,
      left: Math.round(left),
      width: Math.round(menuWidth),
    });
  };

  // Monitor screen width changes and reposition dropdown
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

  // Close on click outside (check both the trigger button and the portal dropdown)
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
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Compute count of packaged header & ribbon options accessible via this menu
  const hiddenCount = (() => {
    let count = 9; // Core diagram options (Format, Error-sinks, Descriptions, Priorities, Engine, Curve, Theme, Lock, Styles)
    if (windowWidth <= 1920) count += 3; // On 1920x1080 and below, options ribbon is condensed/wrapped and labels shrink
    if (windowWidth < 1280) count += 3;
    if (windowWidth < 1024) count += 1;
    if (windowWidth < 768) count += 1;
    return count;
  })();

  return (
    <div className="inline-flex items-center" id="header-hidden-controls-container">
      <button
        ref={buttonRef}
        id="header-hidden-controls-btn"
        type="button"
        onClick={() => {
          if (!isOpen) {
            updateDropdownPosition();
          }
          setIsOpen((prev) => !prev);
        }}
        className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shrink-0 ${
          isOpen
            ? 'bg-amber-500/25 text-amber-300 border border-amber-500/70 shadow-sm ring-1 ring-amber-500/40'
            : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 hover:text-amber-200 border border-amber-500/40 shadow-xs'
        }`}
        title={`Hidden controls menu (${hiddenCount} options/controls accessible here)`}
        aria-label="Hidden controls menu"
        aria-expanded={isOpen}
      >
        <MoreHorizontal className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="hidden sm:inline">Hidden</span>
        <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 font-mono font-bold text-[10px] leading-tight">
          {hiddenCount}
        </span>
        <ChevronDown
          className={`w-3 h-3 text-amber-400/80 transition-transform duration-200 shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Floating Dropdown for Hidden Header Controls - rendered via Portal to document.body so it appears in front of Diagram Canvas and all elements */}
      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            id="header-hidden-controls-menu"
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
                <Settings2 className="w-3.5 h-3.5" />
              </span>
              <div>
                <div className="font-semibold text-xs text-slate-100 flex items-center gap-1.5">
                  <span>Hidden Controls</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60">
                    Small Display
                  </span>
                </div>
                <div className="text-[10px] text-slate-400">
                  Quick access to all controls hidden on compact monitors
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

            {/* SECTION 1: Quick Action Buttons (Mermaid Live, PDF, Copy, Download, Export) */}
            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Header Actions
              </div>
              <div className="grid grid-cols-2 gap-2">
                {/* Print to PDF button */}
                <button
                  type="button"
                  onClick={() => {
                    handlePrintToPdf();
                    setIsOpen(false);
                  }}
                  disabled={!outputMarkdown || isPrintingPdf}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition-colors disabled:opacity-40 cursor-pointer text-left"
                  title="Print visible diagram to PDF"
                >
                  {isPrintingPdf ? (
                    <Loader2 className="w-3.5 h-3.5 text-rose-400 animate-spin shrink-0" />
                  ) : (
                    <Printer className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium text-xs truncate">Print to PDF</div>
                    <div className="text-[10px] text-slate-400 truncate">Visible area</div>
                  </div>
                </button>

                {/* Open in Mermaid Live */}
                <button
                  type="button"
                  onClick={() => {
                    handleOpenMermaidLive();
                    setIsOpen(false);
                  }}
                  disabled={!outputMarkdown}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-indigo-600/90 hover:bg-indigo-500 text-white font-medium shadow-sm transition-colors disabled:opacity-40 cursor-pointer text-left"
                  title="Open diagram in mermaid.live"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium text-xs truncate">Mermaid Live</div>
                    <div className="text-[10px] text-indigo-200 truncate">External editor</div>
                  </div>
                </button>

                {/* Copy Markdown */}
                {onCopyMarkdown && (
                  <button
                    type="button"
                    onClick={() => {
                      onCopyMarkdown();
                      setIsOpen(false);
                    }}
                    disabled={!outputMarkdown}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition-colors disabled:opacity-40 cursor-pointer text-left"
                    title="Copy Mermaid Markdown source"
                  >
                    {copiedMarkdown ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-xs truncate">
                        {copiedMarkdown ? 'Copied!' : 'Copy Markdown'}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">Clipboard</div>
                    </div>
                  </button>
                )}

                {/* Download File */}
                {onDownload && (
                  <button
                    type="button"
                    onClick={() => {
                      onDownload();
                      setIsOpen(false);
                    }}
                    disabled={!outputMarkdown}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition-colors disabled:opacity-40 cursor-pointer text-left"
                    title="Download .statechart.md"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-xs truncate">Download</div>
                      <div className="text-[10px] text-slate-400 truncate">.statechart.md</div>
                    </div>
                  </button>
                )}

                {/* Export Dialog */}
                {onOpenExportDialog && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenExportDialog();
                      setIsOpen(false);
                    }}
                    disabled={!outputMarkdown}
                    className="col-span-2 flex items-center gap-2 px-2.5 py-2 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/40 transition-colors disabled:opacity-40 cursor-pointer text-left"
                    title="Open high-resolution export dialog"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-xs truncate">High-Resolution Export Dialog...</div>
                      <div className="text-[10px] text-sky-400/80 truncate">Custom PNG scale 1x-4x, SVG, DPI & background</div>
                    </div>
                  </button>
                )}
              </div>
            </div>

          {/* SECTION 2: Diagram Notation Format */}
          <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-800">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Diagram Format
            </div>
            <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setFlowchartOutput(true)}
                className={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  flowchartOutput
                    ? 'bg-sky-600 text-white shadow-sm font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {flowchartOutput && <Check className="w-3 h-3" />}
                <span>flowchart TD</span>
              </button>
              <button
                type="button"
                onClick={() => setFlowchartOutput(false)}
                className={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  !flowchartOutput
                    ? 'bg-sky-600 text-white shadow-sm font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {!flowchartOutput && <Check className="w-3 h-3" />}
                <span>stateDiagram-v2</span>
              </button>
            </div>
          </div>

          {/* SECTION 3: Toggles (Error Sinks, Descriptions, Priorities) */}
          <div className="flex flex-col gap-2 pt-2 border-t border-slate-800">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Diagram Options
            </div>

            {/* Collapse error sink edges */}
            <label className="flex items-center justify-between cursor-pointer py-1 px-1.5 rounded hover:bg-slate-800/60 select-none">
              <span className="text-slate-200">Collapse error-sink edges</span>
              <input
                type="checkbox"
                checked={collapseErrorSinkEdges}
                onChange={(e) => setCollapseErrorSinkEdges(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700 text-sky-500 focus:ring-0 cursor-pointer"
              />
            </label>

            {/* Include state descriptions */}
            <label className="flex items-center justify-between cursor-pointer py-1 px-1.5 rounded hover:bg-slate-800/60 select-none">
              <span className="text-slate-200">Include state descriptions</span>
              <input
                type="checkbox"
                checked={includeStateDescriptions}
                onChange={(e) => setIncludeStateDescriptions(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700 text-sky-500 focus:ring-0 cursor-pointer"
              />
            </label>

            {/* Transition Priorities */}
            <div className="flex flex-col gap-1.5 py-1 px-1.5 rounded hover:bg-slate-800/40">
              <div className="flex items-center justify-between cursor-pointer select-none">
                <span className="text-slate-200">Show transition priorities</span>
                <input
                  type="checkbox"
                  checked={showTransitionPriorities}
                  onChange={(e) => setShowTransitionPriorities(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-700 text-sky-500 focus:ring-0 cursor-pointer"
                />
              </div>
              {showTransitionPriorities && (
                <div className="flex items-center gap-1.5 pl-2 pt-1">
                  <span className="text-[10px] text-slate-400">Format:</span>
                  <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setPriorityFormat('paren')}
                      className={`px-2 py-0.5 rounded font-mono transition-colors cursor-pointer ${
                        priorityFormat === 'paren'
                          ? 'bg-sky-600 text-white font-bold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      (1)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPriorityFormat('bracket')}
                      className={`px-2 py-0.5 rounded font-mono transition-colors cursor-pointer ${
                        priorityFormat === 'bracket'
                          ? 'bg-sky-600 text-white font-bold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      [1]
                    </button>
                    <button
                      type="button"
                      onClick={() => setPriorityFormat('circled')}
                      className={`px-2 py-0.5 rounded font-mono transition-colors cursor-pointer ${
                        priorityFormat === 'circled'
                          ? 'bg-sky-600 text-white font-bold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      ①
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* SECTION 4: Engine & Appearance */}
          <div className="flex flex-col gap-2 pt-2 border-t border-slate-800">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>Engine & Presets</span>
            </div>

            {/* Diagram Preset Selector if props provided */}
            {currentPresetOptions && onApplyPreset && (
              <div className="flex items-center justify-between py-1 px-1.5 rounded bg-slate-950/60 border border-slate-800/80">
                <span className="text-slate-300 font-medium">Preset:</span>
                <DiagramPresetManager
                  currentOptions={currentPresetOptions}
                  onApplyPreset={onApplyPreset}
                  onExportSettingsChange={onExportSettingsChange}
                />
              </div>
            )}

            {/* Layout Engine: Dagre vs ELK */}
            <div className="flex items-center justify-between">
              <span className="text-slate-300">Layout Engine:</span>
              <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]">
                <button
                  type="button"
                  onClick={() => setLayoutEngine('dagre')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                    layoutEngine === 'dagre'
                      ? 'bg-sky-600 text-white font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Dagre
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutEngine('elk')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                    layoutEngine === 'elk'
                      ? 'bg-sky-600 text-white font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ELK
                </button>
              </div>
            </div>

            {/* Flowchart Curve */}
            {flowchartOutput && (
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Curve Style:</span>
                <select
                  value={flowchartCurve}
                  onChange={(e) => setFlowchartCurve(e.target.value as FlowchartCurve)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
                >
                  <option value="basis">basis (Smooth Spline)</option>
                  <option value="linear">linear (Straight Lines)</option>
                  <option value="cardinal">cardinal (Pass-through)</option>
                  <option value="stepAfter">stepAfter (Stepped Orthogonal)</option>
                  <option value="monotoneX">monotoneX (Monotone Smooth)</option>
                  <option value="natural">natural (Natural Spline)</option>
                </select>
              </div>
            )}

            {/* Theme Preset */}
            <div className="flex items-center justify-between">
              <span className="text-slate-300">Mermaid Theme:</span>
              <select
                value={mermaidTheme}
                onChange={(e) => setMermaidTheme(e.target.value as MermaidTheme)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                <option value="dark">dark</option>
                <option value="base">base</option>
                <option value="forest">forest</option>
                <option value="neutral">neutral</option>
                <option value="default">default</option>
              </select>
            </div>

            {/* Lock Layout Button */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-300">Diagram Layout:</span>
              <button
                type="button"
                onClick={() => setLockDiagramLayout((prev) => !prev)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                  lockDiagramLayout
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/60'
                    : 'bg-slate-950/80 hover:bg-slate-800 text-slate-300 border border-slate-800'
                }`}
              >
                {lockDiagramLayout ? (
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                ) : (
                  <Unlock className="w-3.5 h-3.5 text-slate-400" />
                )}
                <span>{lockDiagramLayout ? 'Locked' : 'Unlocked'}</span>
              </button>
            </div>

            {/* Custom Styles count (if any) */}
            {customizedStatesCount > 0 && (
              <div className="flex items-center justify-between pt-1 text-[11px]">
                <span className="text-sky-300 flex items-center gap-1">
                  <Palette className="w-3 h-3 text-sky-400" />
                  {customizedStatesCount} custom styled state{customizedStatesCount > 1 ? 's' : ''}
                </span>
                {onClearAllCustomStyles && (
                  <button
                    type="button"
                    onClick={onClearAllCustomStyles}
                    className="text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    Reset styles
                  </button>
                )}
              </div>
            )}
          </div>

          {/* SECTION 5: Status & Live Auto-refresh */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-300 hover:text-white select-none">
              <input
                type="checkbox"
                checked={liveUpdate}
                onChange={(e) => setLiveUpdate(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700 text-sky-500 cursor-pointer"
              />
              <span>Live Auto-refresh</span>
            </label>

            {generationStats && (
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span>{generationStats.linesCount} lines</span>
                <span>•</span>
                <span>{generationStats.timeMs}ms</span>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
