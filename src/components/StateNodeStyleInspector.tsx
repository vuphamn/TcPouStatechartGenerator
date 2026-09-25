import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Palette,
  X,
  RotateCcw,
  Sparkles,
  ChevronDown,
  Trash2,
  Sliders,
  Eye,
  Check,
  Code2,
  FileCode,
  Move,
  BookOpen,
  FileText,
  Save,
  Copy,
  CheckCircle2,
  StickyNote,
  Edit3,
  ListPlus,
  Download,
  FileJson,
  PanelRightClose,
  PanelRightOpen,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  ColorPreset,
  CustomNodeStylesMap,
  NodeDisplayProperties,
  StateNodeInfo,
  DiagramNotes,
  ContextMenuTarget,
} from '../types.ts';
import {
  BORDER_WIDTH_OPTIONS,
  CURATED_COLOR_PRESETS,
  QUICK_BG_SWATCHES,
  QUICK_BORDER_SWATCHES,
  QUICK_TEXT_SWATCHES,
} from '../utils/nodeStyles.ts';
import { MethodStructuredTextEditor } from './MethodStructuredTextEditor.tsx';
import { DutEnumEditor } from './DutEnumEditor.tsx';
import {
  exportDocumentation,
  generateDocumentationMarkdown,
} from '../utils/documentationExport.ts';
import { useDockableWindow } from '../hooks/useDockableWindow.ts';
import { DockableResizeHandles } from './DockableResizeHandles.tsx';

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, pIdx) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={pIdx}
          className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-sky-300 font-mono text-[11px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={pIdx} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

function renderMarkdownBlock(text: string) {
  if (!text.trim()) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-500 text-center">
        <BookOpen className="w-8 h-8 mb-2 opacity-40 text-amber-400" />
        <p className="text-sm font-medium text-slate-300">No documentation written yet</p>
        <p className="text-xs text-slate-500 mt-1 max-w-sm">
          Use the "Edit" mode or choose an engineering template above to document this state's purpose, hardware actions, preconditions, and safety interlocks.
        </p>
      </div>
    );
  }

  const blocks = text.split(/\n\n+/);

  return (
    <div className="space-y-3 text-xs sm:text-sm text-slate-200 leading-relaxed font-sans">
      {blocks.map((block, idx) => {
        const trimmed = block.trim();
        if (trimmed.startsWith('### ')) {
          return (
            <h3
              key={idx}
              className="text-xs sm:text-sm font-bold text-sky-300 uppercase tracking-wider border-b border-slate-800 pb-1 pt-2 flex items-center gap-1.5"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              {trimmed.replace(/^###\s+/, '')}
            </h3>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h2
              key={idx}
              className="text-sm sm:text-base font-bold text-amber-300 border-b border-slate-800 pb-1 pt-2"
            >
              {trimmed.replace(/^##\s+/, '')}
            </h2>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h1
              key={idx}
              className="text-base sm:text-lg font-bold text-white pb-1 pt-2"
            >
              {trimmed.replace(/^#\s+/, '')}
            </h1>
          );
        }
        if (trimmed.startsWith('>')) {
          return (
            <blockquote
              key={idx}
              className="border-l-2 border-amber-500/80 bg-amber-950/20 pl-3 py-1.5 rounded-r text-amber-200 text-xs italic"
            >
              {trimmed.replace(/^>\s*/gm, '')}
            </blockquote>
          );
        }
        if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
          const lines = trimmed.split('\n');
          const codeLines = lines.slice(1, -1).join('\n');
          return (
            <pre
              key={idx}
              className="p-2.5 rounded bg-slate-950 border border-slate-800 font-mono text-xs text-sky-200 overflow-x-auto"
            >
              <code>{codeLines}</code>
            </pre>
          );
        }
        if (trimmed.split('\n').every((l) => l.trim().startsWith('- ') || l.trim().startsWith('* '))) {
          const items = trimmed.split('\n');
          return (
            <ul key={idx} className="space-y-1 pl-1">
              {items.map((it, itemIdx) => {
                const clean = it.trim().replace(/^[-*]\s+/, '');
                return (
                  <li key={itemIdx} className="flex items-start gap-2 text-slate-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 mt-1.5 shrink-0" />
                    <span>{renderInlineMarkdown(clean)}</span>
                  </li>
                );
              })}
            </ul>
          );
        }
        if (trimmed.split('\n').every((l) => /^\d+\.\s+/.test(l.trim()))) {
          const items = trimmed.split('\n');
          return (
            <ol key={idx} className="space-y-1 pl-1 list-decimal list-inside text-slate-300">
              {items.map((it, itemIdx) => {
                const clean = it.trim().replace(/^\d+\.\s+/, '');
                return (
                  <li key={itemIdx}>
                    <span>{renderInlineMarkdown(clean)}</span>
                  </li>
                );
              })}
            </ol>
          );
        }
        return (
          <p key={idx} className="whitespace-pre-wrap text-slate-300 leading-relaxed">
            {renderInlineMarkdown(trimmed)}
          </p>
        );
      })}
    </div>
  );
}

export interface StateNodeStyleInspectorProps {
  selectedStateId?: string | null;
  selectedStateLabel?: string;
  availableStates: StateNodeInfo[];
  customStyles: CustomNodeStylesMap;
  onStyleChange: (stateId: string, style: NodeDisplayProperties) => void;
  onResetStateStyle: (stateId: string) => void;
  onClearAllCustomStyles: () => void;
  onSelectState: (stateId: string, label?: string) => void;
  onClose: () => void;
  tcPouContent?: string;
  tcPouFileName?: string;
  tcDutContent?: string;
  tcDutFileName?: string;
  onSaveDutContent?: (newDutContent: string) => { success: boolean; error?: string };
  onSaveMethodCode?: (methodName: string, newCode: string, newDeclaration?: string) => { success: boolean; error?: string };
  onSaveStateCode?: (stateId: string, newCode: string) => { success: boolean; error?: string };
  onSavePreProcessCode?: (newCode: string, newDeclaration?: string) => { success: boolean; error?: string };
  initialMode?: 'enum' | 'method' | 'style' | 'code' | 'preprocess' | 'docs';
  initialMethod?: string;
  initialEnumMember?: string;
  // Documentation / Notes persistence
  notes?: DiagramNotes;
  onSaveNote?: (target: ContextMenuTarget, noteText: string) => void;
  onDeleteNote?: (target: ContextMenuTarget) => void;
  onUpdateNoteStyle?: (targetId: string, style: NodeDisplayProperties | null) => void;
  /** Render a single mode docked inside a workspace tab instead of the floating multi-tab window */
  panelMode?: InspectorPanelMode;
}

export type InspectorPanelMode = 'enum' | 'method' | 'style' | 'docs';

export const StateNodeStyleInspector: React.FC<StateNodeStyleInspectorProps> = ({
  selectedStateId,
  selectedStateLabel,
  availableStates,
  customStyles,
  onStyleChange,
  onResetStateStyle,
  onClearAllCustomStyles,
  onSelectState,
  onClose,
  tcPouContent,
  tcPouFileName,
  tcDutContent,
  tcDutFileName,
  onSaveDutContent,
  onSaveMethodCode,
  onSaveStateCode,
  onSavePreProcessCode,
  initialMode = 'method',
  initialMethod = 'doState()',
  initialEnumMember,
  notes,
  onSaveNote,
  onDeleteNote,
  onUpdateNoteStyle,
  panelMode,
}) => {
  const currentEffectiveStateId =
    selectedStateId || (availableStates.length > 0 ? availableStates[0].id : '');
  const currentEffectiveStateLabel =
    selectedStateLabel || (availableStates.length > 0 ? availableStates[0].label : currentEffectiveStateId);

  const normalizeMode = (mode?: string): 'enum' | 'method' | 'style' | 'docs' => {
    if (mode === 'enum') return 'enum';
    if (mode === 'style') return 'style';
    if (mode === 'docs') return 'docs';
    return 'method';
  };

  const [inspectorMode, setInspectorMode] = useState<'enum' | 'method' | 'style' | 'docs'>(() =>
    normalizeMode(panelMode ?? initialMode)
  );

  useEffect(() => {
    if (initialMode && !panelMode) {
      setInspectorMode(normalizeMode(initialMode));
    }
  }, [initialMode, panelMode]);

  const [activeTab, setActiveTab] = useState<'presets' | 'custom'>('custom');
  const [isStateDropdownOpen, setIsStateDropdownOpen] = useState(false);

  // Documentation tab state
  const currentDocText = (currentEffectiveStateId && notes?.nodes?.[currentEffectiveStateId]) || '';
  const [docText, setDocText] = useState<string>(currentDocText);
  const [docIsDirty, setDocIsDirty] = useState<boolean>(false);
  const [docSaveStatus, setDocSaveStatus] = useState<'idle' | 'saved' | 'copied'>('idle');
  const [docViewMode, setDocViewMode] = useState<'edit' | 'preview'>('edit');
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isFooterExportMenuOpen, setIsFooterExportMenuOpen] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);

  // Sync docText when selected state changes
  useEffect(() => {
    setDocText((currentEffectiveStateId && notes?.nodes?.[currentEffectiveStateId]) || '');
    setDocIsDirty(false);
    setDocSaveStatus('idle');
  }, [currentEffectiveStateId, notes]);

  const exportMenuRef = useRef<HTMLDivElement>(null);
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const footerExportMenuRef = useRef<HTMLDivElement>(null);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setIsExportMenuOpen(false);
      }
      if (templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node)) {
        setIsTemplateMenuOpen(false);
      }
      if (footerExportMenuRef.current && !footerExportMenuRef.current.contains(e.target as Node)) {
        setIsFooterExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExport = (format: 'markdown' | 'json') => {
    try {
      const result = exportDocumentation(format, {
        fileName: tcPouFileName,
        states: availableStates,
        notes,
        customStyles,
        currentEditingStateId: currentEffectiveStateId || undefined,
        currentEditingDocText: docText,
      });
      setExportFeedback(`Downloaded ${result.fileName}!`);
      setTimeout(() => setExportFeedback(null), 3500);
    } catch (err) {
      console.error('Failed to export documentation:', err);
    } finally {
      setIsExportMenuOpen(false);
      setIsFooterExportMenuOpen(false);
    }
  };

  const handleCopyAllMarkdown = async () => {
    try {
      const md = generateDocumentationMarkdown({
        fileName: tcPouFileName,
        states: availableStates,
        notes,
        customStyles,
        currentEditingStateId: currentEffectiveStateId || undefined,
        currentEditingDocText: docText,
      });
      await navigator.clipboard.writeText(md);
      setExportFeedback('Copied Markdown report to clipboard!');
      setTimeout(() => setExportFeedback(null), 3000);
    } catch (err) {
      console.error('Failed to copy documentation:', err);
    } finally {
      setIsExportMenuOpen(false);
      setIsFooterExportMenuOpen(false);
    }
  };

  // Sync documentation text when selected state or external notes update
  useEffect(() => {
    const text = (currentEffectiveStateId && notes?.nodes?.[currentEffectiveStateId]) || '';
    setDocText(text);
    setDocIsDirty(false);
  }, [currentEffectiveStateId, notes]);

  const hasDoc = Boolean((currentEffectiveStateId && (notes?.nodes?.[currentEffectiveStateId] || '')).trim());
  const docWordCount = useMemo(() => {
    const trimmed = docText.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [docText]);

  const handleSaveDoc = () => {
    if (!currentEffectiveStateId) return;
    const trimmed = docText.trim();
    if (trimmed) {
      onSaveNote?.(
        {
          type: 'node',
          id: currentEffectiveStateId,
          label: currentEffectiveStateLabel || currentEffectiveStateId,
        },
        trimmed
      );
    } else {
      onDeleteNote?.({
        type: 'node',
        id: currentEffectiveStateId,
        label: currentEffectiveStateLabel || currentEffectiveStateId,
      });
    }
    setDocIsDirty(false);
    setDocSaveStatus('saved');
    setTimeout(() => setDocSaveStatus('idle'), 2500);
  };

  const handleResetDoc = () => {
    const original = (currentEffectiveStateId && notes?.nodes?.[currentEffectiveStateId]) || '';
    setDocText(original);
    setDocIsDirty(false);
  };

  const handleClearDoc = () => {
    setDocText('');
    setDocIsDirty(Boolean(currentEffectiveStateId && notes?.nodes?.[currentEffectiveStateId]));
  };

  const handleCopyDoc = async () => {
    try {
      await navigator.clipboard.writeText(docText);
      setDocSaveStatus('copied');
      setTimeout(() => setDocSaveStatus('idle'), 2000);
    } catch {
      // fallback
    }
  };

  const insertTemplate = (templateType: 'full' | 'purpose' | 'safety' | 'io') => {
    let template = '';
    const stateTitle = selectedStateLabel || selectedStateId;
    if (templateType === 'full') {
      template = `### Purpose & Overview\nPrimary function and operating mode for \`${stateTitle}\`.\n\n### Entry Preconditions\n- All preceding interlocks satisfied\n- Required signals active\n\n### Actions & Sequence\n- Energize actuators / command motion\n- Monitor completion feedback\n\n### Exit Criteria & Next States\n- Normal completion -> Transition to Next State\n- Timeout / Fault -> Transition to Error / Halt\n\n### Safety & Interlocks\n- E-Stop and guard door monitoring active\n`;
    } else if (templateType === 'purpose') {
      template = `### State Purpose\nResponsible for controlling the \`${stateTitle}\` sequence during machine operation.\n`;
    } else if (templateType === 'safety') {
      template = `### Safety & Fault Recovery\n- Max timeout allowed: 5000ms\n- Interlock signals: \`bSafetyOk\`, \`bDoorClosed\`\n- Recovery action: Transition to \`STATE_ERROR\` on fault\n`;
    } else if (templateType === 'io') {
      template = `### Hardware I/O & Actuators\n- Outputs: \`q_bMotorRun\` := TRUE;\n- Inputs: \`i_bSensorReached\`\n`;
    }

    if (!docText.trim()) {
      setDocText(template);
    } else {
      setDocText((prev) => prev.trimEnd() + '\n\n' + template);
    }
    setDocIsDirty(true);
  };

  // Dockable, resizeable and moveable window hook
  const {
    isDocked,
    toggleDock,
    isMaximized,
    toggleMaximize,
    handleHeaderMouseDown,
    startResize,
    containerStyle,
  } = useDockableWindow({
    id: 'state_node_style_inspector',
    defaultWidth: 920,
    defaultHeight: 760,
    defaultDocked: false,
    minWidth: 420,
    minHeight: 320,
  });

  const currentStyle: NodeDisplayProperties =
    (currentEffectiveStateId ? customStyles[currentEffectiveStateId] : undefined) || {};
  const isCustomized = Boolean(
    currentStyle.fill || currentStyle.color || currentStyle.stroke || currentStyle.strokeWidth
  );

  const customizedCount = Object.values(customStyles).filter(
    (s) => s.fill || s.color || s.stroke || s.strokeWidth
  ).length;

  const handleUpdate = (updates: Partial<NodeDisplayProperties>) => {
    if (!currentEffectiveStateId) return;
    const nextStyle: NodeDisplayProperties = {
      ...currentStyle,
      ...updates,
    };
    if (!nextStyle.fill && !nextStyle.color && !nextStyle.stroke && !nextStyle.strokeWidth) {
      onResetStateStyle(currentEffectiveStateId);
    } else {
      onStyleChange(currentEffectiveStateId, nextStyle);
    }
  };

  const handleApplyPreset = (preset: ColorPreset) => {
    if (!currentEffectiveStateId) return;
    onStyleChange(currentEffectiveStateId, {
      fill: preset.fill,
      color: preset.color,
      stroke: preset.stroke,
      strokeWidth: preset.strokeWidth,
    });
  };

  const currentFill = currentStyle.fill || '#1e293b';
  const currentColor = currentStyle.color || '#f8fafc';
  const currentStroke = currentStyle.stroke || '#475569';
  const currentStrokeWidth = currentStyle.strokeWidth || '2px';

  // Content for the active mode, shared by the floating window and the docked tab panels
  const modeBody = (
    <>
        {/* State Switcher & Customization Status (Shown only when viewing Style tab) */}
        {inspectorMode === 'style' && (
          <div className="px-3.5 py-2 bg-slate-900/90 border-b border-slate-800/80 flex items-center justify-between gap-2 text-xs">
            {/* Dropdown to pick different state */}
            <div className="relative flex-1 min-w-0">
              <button
                type="button"
                id="state-selector-dropdown-btn"
                onClick={() => setIsStateDropdownOpen(!isStateDropdownOpen)}
                className="w-full flex items-center justify-between gap-1.5 px-2.5 py-1 bg-slate-950 border border-slate-700 hover:border-slate-600 rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500 transition-all"
                title="Switch state node"
              >
                <span className="truncate">{currentEffectiveStateId || 'Select State...'}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>
  
              {isStateDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-full max-h-48 overflow-y-auto bg-slate-950 border border-slate-700 rounded-lg shadow-xl py-1 z-40 text-xs font-mono">
                  {availableStates.map((s) => {
                    const hasStyle = Boolean(customStyles[s.id]);
                    const isSelected = s.id === currentEffectiveStateId;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          onSelectState(s.id, s.label);
                          setIsStateDropdownOpen(false);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-slate-800 transition-colors ${
                          isSelected ? 'bg-sky-950/60 text-sky-400 font-medium' : 'text-slate-300'
                        }`}
                      >
                        <span className="truncate">{s.id}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {hasStyle && (
                            <span
                              className="w-2 h-2 rounded-full bg-emerald-400 inline-block"
                              title="Customized style"
                            />
                          )}
                          {isSelected && <Check className="w-3 h-3 text-sky-400" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
  
            {/* Status Badge */}
            {isCustomized ? (
              <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 text-[10px] font-medium shrink-0">
                Custom Style
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] shrink-0">
                Default Theme
              </span>
            )}
          </div>
        )}
  
        {/* Main Content: Edit Enum OR Method Editor OR Documentation OR Appearance Customizer */}
        {inspectorMode === 'enum' ? (
          <div className="flex-1 min-h-0 flex flex-col bg-slate-950 overflow-hidden">
            {tcDutContent && onSaveDutContent ? (
              <DutEnumEditor
                dutContent={tcDutContent}
                dutFileName={tcDutFileName || 'EnumDeclaration.TcDUT'}
                pouContent={tcPouContent || ''}
                onSaveDutContent={onSaveDutContent}
                initialSelectedMember={initialEnumMember || (currentEffectiveStateId || undefined)}
                isModal={false}
                embedded={true}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
                <Code2 className="w-10 h-10 text-slate-600 mb-3" />
                <p className="text-sm font-semibold text-slate-300">No .TcDUT Enum File Loaded</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  Load or paste an Enum / DUT Data Type file in the sidebar to view and edit enum member declarations.
                </p>
              </div>
            )}
          </div>
        ) : inspectorMode === 'method' ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <MethodStructuredTextEditor
              tcPouContent={tcPouContent}
              tcPouFileName={tcPouFileName}
              initialMethod={initialMethod || 'doState()'}
              selectedStateId={currentEffectiveStateId}
              selectedStateLabel={currentEffectiveStateLabel}
              onSaveMethodCode={onSaveMethodCode}
              onSavePreProcessCode={onSavePreProcessCode}
              onJumpToState={(target) => onSelectState(target)}
              isModal={false}
              isDocked={panelMode ? undefined : isDocked}
              onToggleDock={panelMode ? undefined : toggleDock}
            />
          </div>
        ) : inspectorMode === 'docs' ? (
          <div className="flex-1 min-h-0 flex flex-col bg-slate-950 overflow-hidden">
            {/* Documentation Sub-toolbar */}
            <div className="px-3.5 py-2 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
              {/* State Picker Dropdown */}
              <div className="relative min-w-[200px] max-w-[280px]">
                <button
                  type="button"
                  id="doc-state-selector-dropdown-btn"
                  onClick={() => setIsStateDropdownOpen(!isStateDropdownOpen)}
                  className="w-full flex items-center justify-between gap-1.5 px-2.5 py-1 bg-slate-950 border border-slate-700 hover:border-slate-600 rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500 transition-all"
                  title="Switch state node documentation"
                >
                  <span className="truncate flex items-center gap-1.5">
                    <span className="text-slate-400 font-sans text-[11px]">State:</span>
                    <span className="font-semibold text-sky-400">{currentEffectiveStateId}</span>
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </button>
  
                {isStateDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 w-full max-h-56 overflow-y-auto bg-slate-950 border border-slate-700 rounded-lg shadow-xl py-1 z-40 text-xs font-mono">
                    {availableStates.map((s) => {
                      const hasNote = Boolean((notes?.nodes?.[s.id] || '').trim());
                      const isSelected = s.id === currentEffectiveStateId;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            onSelectState(s.id, s.label);
                            setIsStateDropdownOpen(false);
                          }}
                          className={`w-full text-left px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-slate-800 transition-colors ${
                            isSelected ? 'bg-sky-950/60 text-sky-400 font-medium' : 'text-slate-300'
                          }`}
                        >
                          <span className="truncate">{s.id}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            {hasNote && (
                              <span
                                className="w-2 h-2 rounded-full bg-amber-400 inline-block"
                                title="Has documentation"
                              />
                            )}
                            {isSelected && <Check className="w-3 h-3 text-sky-400" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
  
              {/* Quick Word & Char Counter */}
              <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono hidden sm:flex">
                <span>{docWordCount} words</span>
                <span>•</span>
                <span>{docText.length} chars</span>
              </div>
  
              {/* Right Controls: Export Documentation + Templates dropdown + Edit/Preview toggle */}
              <div className="flex items-center gap-1.5 ml-auto">
                {/* Export Documentation Dropdown */}
                <div className="relative" ref={exportMenuRef}>
                  <button
                    type="button"
                    id="export-doc-dropdown-btn"
                    onClick={() => {
                      setIsExportMenuOpen(!isExportMenuOpen);
                      setIsTemplateMenuOpen(false);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 hover:text-amber-200 border border-amber-500/40 rounded-lg text-xs font-medium transition-all shadow-sm group"
                    title="Export all state documentation as downloadable Markdown or JSON report"
                  >
                    <Download className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition-transform" />
                    <span className="font-semibold">Export Documentation</span>
                    <ChevronDown className="w-3 h-3 ml-0.5 opacity-70" />
                  </button>
  
                  {isExportMenuOpen && (
                    <div className="absolute right-0 top-full mt-1.5 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
                      <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800 flex items-center justify-between">
                        <span>Export Documentation Report</span>
                        <span className="text-amber-400 font-mono text-[9px]">{availableStates.length} states</span>
                      </div>
  
                      <button
                        type="button"
                        id="export-doc-markdown-btn"
                        onClick={() => handleExport('markdown')}
                        className="w-full text-left px-3 py-2 hover:bg-slate-800 text-slate-200 flex items-start gap-2.5 transition-colors group"
                      >
                        <div className="p-1.5 rounded-lg bg-sky-950/80 border border-sky-800/80 text-sky-400 group-hover:bg-sky-900 mt-0.5 shrink-0">
                          <FileText className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-semibold text-sky-300 flex items-center gap-1">
                            Markdown Report (.md)
                          </span>
                          <span className="text-[10px] text-slate-400 leading-normal">
                            Complete technical specification with TOC, state descriptions & metadata
                          </span>
                        </div>
                      </button>
  
                      <button
                        type="button"
                        id="export-doc-json-btn"
                        onClick={() => handleExport('json')}
                        className="w-full text-left px-3 py-2 hover:bg-slate-800 text-slate-200 flex items-start gap-2.5 transition-colors group border-t border-slate-800/60"
                      >
                        <div className="p-1.5 rounded-lg bg-emerald-950/80 border border-emerald-800/80 text-emerald-400 group-hover:bg-emerald-900 mt-0.5 shrink-0">
                          <FileJson className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-semibold text-emerald-300 flex items-center gap-1">
                            JSON Report (.json)
                          </span>
                          <span className="text-[10px] text-slate-400 leading-normal">
                            Structured machine-readable data with all states, styles & annotations
                          </span>
                        </div>
                      </button>
  
                      <button
                        type="button"
                        id="export-doc-copy-all-btn"
                        onClick={handleCopyAllMarkdown}
                        className="w-full text-left px-3 py-2 hover:bg-slate-800 text-slate-200 flex items-start gap-2.5 transition-colors group border-t border-slate-800/60"
                      >
                        <div className="p-1.5 rounded-lg bg-purple-950/80 border border-purple-800/80 text-purple-400 group-hover:bg-purple-900 mt-0.5 shrink-0">
                          <Copy className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-semibold text-purple-300 flex items-center gap-1">
                            Copy All as Markdown
                          </span>
                          <span className="text-[10px] text-slate-400 leading-normal">
                            Copy entire compiled documentation report to clipboard
                          </span>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
  
                {/* Templates Dropdown */}
                <div className="relative" ref={templateMenuRef}>
                  <button
                    type="button"
                    id="insert-template-dropdown-btn"
                    onClick={() => setIsTemplateMenuOpen(!isTemplateMenuOpen)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors"
                    title="Insert predefined engineering documentation template"
                  >
                    <ListPlus className="w-3.5 h-3.5 text-amber-400" />
                    <span className="hidden md:inline">Templates</span>
                    <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
                  </button>
  
                  {isTemplateMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-56 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1.5 z-40 text-xs">
                      <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                        Insert Template
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          insertTemplate('full');
                          setIsTemplateMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-200 flex flex-col"
                      >
                        <span className="font-semibold text-sky-400">Full State Specification</span>
                        <span className="text-[10px] text-slate-400">Purpose, Entry, Actions, Exit & Safety</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          insertTemplate('purpose');
                          setIsTemplateMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-200 flex flex-col"
                      >
                        <span className="font-semibold text-amber-400">Purpose & Overview</span>
                        <span className="text-[10px] text-slate-400">Brief high-level summary</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          insertTemplate('safety');
                          setIsTemplateMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-200 flex flex-col"
                      >
                        <span className="font-semibold text-rose-400">Safety & Fault Recovery</span>
                        <span className="text-[10px] text-slate-400">Timeouts, interlocks & error handling</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          insertTemplate('io');
                          setIsTemplateMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-200 flex flex-col"
                      >
                        <span className="font-semibold text-emerald-400">Hardware I/O & Signals</span>
                        <span className="text-[10px] text-slate-400">Physical actuators and sensor inputs</span>
                      </button>
                    </div>
                  )}
                </div>
  
                {/* Edit / Preview Segmented Control */}
                <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-700">
                  <button
                    type="button"
                    id="doc-mode-edit-btn"
                    onClick={() => setDocViewMode('edit')}
                    className={`flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium transition-all ${
                      docViewMode === 'edit'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    id="doc-mode-preview-btn"
                    onClick={() => setDocViewMode('preview')}
                    className={`flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium transition-all ${
                      docViewMode === 'preview'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Eye className="w-3 h-3" />
                    <span>Preview</span>
                  </button>
                </div>
              </div>
            </div>
  
            {/* Documentation Body */}
            <div className="flex-1 min-h-0 flex flex-col p-3 sm:p-4 overflow-hidden bg-slate-950">
              {docViewMode === 'edit' ? (
                <textarea
                  id="state-documentation-textarea"
                  value={docText}
                  onChange={(e) => {
                    setDocText(e.target.value);
                    setDocIsDirty(true);
                  }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                      e.preventDefault();
                      handleSaveDoc();
                    }
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const start = e.currentTarget.selectionStart;
                      const end = e.currentTarget.selectionEnd;
                      const val = docText;
                      const nextVal = val.substring(0, start) + '  ' + val.substring(end);
                      setDocText(nextVal);
                      setDocIsDirty(true);
                      setTimeout(() => {
                        if (e.target) {
                          (e.target as HTMLTextAreaElement).selectionStart = start + 2;
                          (e.target as HTMLTextAreaElement).selectionEnd = start + 2;
                        }
                      }, 0);
                    }
                  }}
                  placeholder={`Describe the purpose of state '${selectedStateLabel || selectedStateId}'...\n\nExample:\n### Purpose & Overview\nControls the idle sequence before feed cycle engages.\n\n### Entry Preconditions\n- Safety circuits closed (bSafetyOk = TRUE)\n- Axis homed\n\n### Actuators & Outputs\n- Clamps energized\n- Feed drive in standstill\n\n### Exit Criteria\n- Start button pressed -> Transition to FEED_ACTIVE`}
                  className="w-full h-full flex-1 p-3 bg-slate-900 text-slate-100 font-sans text-xs sm:text-sm leading-relaxed border border-slate-800 rounded-xl focus:border-sky-500 focus:ring-1 focus:ring-sky-500/40 outline-none resize-none custom-scrollbar placeholder:text-slate-600"
                />
              ) : (
                <div className="w-full h-full flex-1 p-4 bg-slate-900/90 border border-slate-800 rounded-xl overflow-y-auto custom-scrollbar">
                  {renderMarkdownBlock(docText)}
                </div>
              )}
            </div>
  
            {/* Diagram Annotation Color Theme Picker */}
            <div className="px-3.5 py-2 bg-slate-900/70 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
              <div className="flex items-center gap-2">
                <StickyNote className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-[11px] text-slate-300">
                  Canvas Annotation Badge / Sticky Note:
                </span>
                <div className="flex items-center gap-1.5 ml-1">
                  {[
                    { name: 'Amber', fill: '#fef08a', color: '#713f12', stroke: '#eab308' },
                    { name: 'Sky', fill: '#bae6fd', color: '#0369a1', stroke: '#38bdf8' },
                    { name: 'Emerald', fill: '#a7f3d0', color: '#047857', stroke: '#34d399' },
                    { name: 'Violet', fill: '#ddd6fe', color: '#6d28d9', stroke: '#a78bfa' },
                    { name: 'Slate', fill: '#334155', color: '#f8fafc', stroke: '#64748b' },
                  ].map((preset) => {
                    const currentNoteStyle = currentEffectiveStateId ? notes?.styles?.[currentEffectiveStateId] : undefined;
                    const isSelected = currentNoteStyle?.fill === preset.fill;
                    return (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => {
                          if (currentEffectiveStateId) {
                            onUpdateNoteStyle?.(currentEffectiveStateId, {
                              fill: preset.fill,
                              color: preset.color,
                              stroke: preset.stroke,
                            });
                          }
                        }}
                        className={`w-4 h-4 rounded-full border transition-all ${
                          isSelected ? 'ring-2 ring-sky-400 scale-110' : 'opacity-80 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: preset.fill, borderColor: preset.stroke }}
                        title={`${preset.name} note theme`}
                      />
                    );
                  })}
                </div>
              </div>
  
              <span className="text-[10px] text-slate-400 font-mono hidden md:inline">
                Persisted in project annotations & localStorage
              </span>
            </div>
  
            {/* Documentation Action / Footer Bar */}
            <div className="flex items-center justify-between px-3.5 py-2 bg-slate-950 border-t border-slate-800 text-xs shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {exportFeedback ? (
                  <span className="text-emerald-400 flex items-center gap-1.5 font-mono text-[11px] truncate animate-in fade-in duration-150">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="truncate">{exportFeedback}</span>
                  </span>
                ) : docSaveStatus === 'saved' ? (
                  <span className="text-emerald-400 flex items-center gap-1 font-mono text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    Documentation saved to project metadata
                  </span>
                ) : docSaveStatus === 'copied' ? (
                  <span className="text-sky-400 flex items-center gap-1 font-mono text-[11px]">
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    Copied to clipboard!
                  </span>
                ) : docIsDirty ? (
                  <span className="text-amber-400 flex items-center gap-1 font-mono text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block animate-pulse shrink-0" />
                    Unsaved changes in documentation
                  </span>
                ) : hasDoc ? (
                  <span className="text-slate-400 font-mono text-[11px] flex items-center gap-1">
                    <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                    Documentation saved in metadata
                  </span>
                ) : (
                  <span className="text-slate-400 font-mono text-[11px]">
                    No documentation saved for {currentEffectiveStateId || 'selected state'}
                  </span>
                )}
              </div>
  
              <div className="flex items-center gap-2 shrink-0">
                {/* Bottom Quick Export Menu */}
                <div className="relative" ref={footerExportMenuRef}>
                  <button
                    type="button"
                    id="doc-footer-export-btn"
                    onClick={() => setIsFooterExportMenuOpen(!isFooterExportMenuOpen)}
                    className="flex items-center gap-1 px-2.5 py-1 text-amber-300 hover:text-amber-200 bg-amber-950/40 hover:bg-amber-900/50 rounded-lg border border-amber-800/60 transition-colors text-xs font-medium"
                    title="Export all state documentation as Markdown or JSON report"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Export Report</span>
                    <ChevronDown className="w-3 h-3 opacity-70" />
                  </button>
  
                  {isFooterExportMenuOpen && (
                    <div className="absolute right-0 bottom-full mb-1.5 w-52 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1 z-50 text-xs animate-in fade-in duration-100">
                      <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                        Export Format
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          handleExport('markdown');
                          setIsFooterExportMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-sky-300 flex items-center gap-2"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Download Markdown (.md)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleExport('json');
                          setIsFooterExportMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-emerald-300 flex items-center gap-2 border-t border-slate-800/60"
                      >
                        <FileJson className="w-3.5 h-3.5" />
                        <span>Download JSON (.json)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleCopyAllMarkdown();
                          setIsFooterExportMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-purple-300 flex items-center gap-2 border-t border-slate-800/60"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Markdown</span>
                      </button>
                    </div>
                  )}
                </div>
  
                <button
                  type="button"
                  id="doc-copy-btn"
                  onClick={handleCopyDoc}
                  disabled={!docText.trim()}
                  className="flex items-center gap-1 px-2.5 py-1 text-slate-400 hover:text-slate-200 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-slate-900 rounded-lg border border-slate-700 transition-colors text-xs font-medium"
                  title="Copy current state documentation text to clipboard"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Copy</span>
                </button>
  
                <button
                  type="button"
                  id="doc-reset-btn"
                  onClick={handleResetDoc}
                  disabled={!docIsDirty}
                  className="flex items-center gap-1 px-2.5 py-1 text-slate-400 hover:text-slate-200 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-slate-900 rounded-lg border border-slate-700 transition-colors text-xs font-medium"
                  title="Discard edits and reload saved documentation"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
  
                {hasDoc && (
                  <button
                    type="button"
                    id="doc-clear-btn"
                    onClick={handleClearDoc}
                    className="flex items-center gap-1 px-2 py-1 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded-lg border border-rose-900/60 transition-colors text-xs"
                    title="Clear documentation for this state"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Clear</span>
                  </button>
                )}
  
                <button
                  type="button"
                  id="doc-save-btn"
                  onClick={handleSaveDoc}
                  disabled={!docIsDirty && !hasDoc}
                  className={`flex items-center gap-1.5 px-3 py-1 text-white rounded-lg transition-all text-xs font-semibold shadow-sm ${
                    docIsDirty
                      ? 'bg-amber-600 hover:bg-amber-500 ring-1 ring-amber-400/40'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700 cursor-default opacity-60'
                  }`}
                  title="Save documentation to project metadata (Ctrl+S)"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
  
        {/* Live Preview Box */}
        <div className="px-3.5 py-2.5 bg-slate-950/50 border-b border-slate-800/80">
          <div className="flex items-center justify-between mb-1 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <Eye className="w-3 h-3 text-sky-400" /> Live Preview
            </span>
            <span className="text-[10px] font-mono text-slate-500">
              {currentStyle.fill ? currentStyle.fill : 'Default fill'}
            </span>
          </div>
          <div className="flex items-center justify-center p-3 rounded-lg bg-slate-900/60 border border-slate-800/80 min-h-[64px]">
            <div
              id="state-node-live-preview"
              style={{
                backgroundColor: currentFill,
                color: currentColor,
                borderColor: currentStroke,
                borderWidth: currentStrokeWidth,
                borderStyle: 'solid',
              }}
              className="px-4 py-2 rounded-md font-sans text-xs font-medium shadow-md transition-all text-center max-w-full truncate"
            >
              {currentEffectiveStateLabel || currentEffectiveStateId}
            </div>
          </div>
        </div>
  
        {/* View Tabs: Custom Colors vs Presets */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('custom')}
            className={`flex-1 py-1.5 px-3 flex items-center justify-center gap-1.5 font-medium border-b-2 transition-colors ${
              activeTab === 'custom'
                ? 'border-sky-500 text-sky-400 bg-slate-900/70'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Colors</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('presets')}
            className={`flex-1 py-1.5 px-3 flex items-center justify-center gap-1.5 font-medium border-b-2 transition-colors ${
              activeTab === 'presets'
                ? 'border-sky-500 text-sky-400 bg-slate-900/70'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Quick Presets</span>
          </button>
        </div>
  
        {/* Tab Content */}
        <div className={`p-3.5 space-y-3.5 overflow-y-auto custom-scrollbar text-xs ${panelMode ? 'flex-1 min-h-0' : 'max-h-[360px]'}`}>
          {activeTab === 'custom' ? (
            <div className="space-y-3">
              {/* 1. Background Color (fill) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-semibold text-slate-200">
                    Background Color (Fill)
                  </label>
                  <span className="text-[10px] font-mono text-slate-400">
                    {currentStyle.fill || 'default'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    id="node-fill-color-picker"
                    type="color"
                    value={currentStyle.fill || '#1e293b'}
                    onChange={(e) => handleUpdate({ fill: e.target.value })}
                    className="w-7 h-7 rounded border border-slate-700 bg-slate-950 cursor-pointer p-0.5 shrink-0"
                    title="Choose exact fill color"
                  />
                  <input
                    id="node-fill-hex-input"
                    type="text"
                    value={currentStyle.fill || ''}
                    placeholder="#1e293b"
                    onChange={(e) => handleUpdate({ fill: e.target.value })}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                  />
                  {currentStyle.fill && (
                    <button
                      type="button"
                      onClick={() => handleUpdate({ fill: undefined })}
                      className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 transition-colors"
                      title="Clear background override"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {/* Quick Swatches */}
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_BG_SWATCHES.map((sw) => (
                    <button
                      key={sw.label}
                      type="button"
                      onClick={() => handleUpdate({ fill: sw.value || undefined })}
                      className={`w-5 h-5 rounded border transition-transform hover:scale-110 ${
                        currentStyle.fill === sw.value
                          ? 'ring-2 ring-sky-400 scale-105 border-white'
                          : 'border-slate-700'
                      }`}
                      style={{
                        backgroundColor: sw.value || '#334155',
                      }}
                      title={sw.label}
                    />
                  ))}
                </div>
              </div>
  
              {/* 2. Foreground / Text Color (color) */}
              <div className="pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-semibold text-slate-200">
                    Text Color (Foreground)
                  </label>
                  <span className="text-[10px] font-mono text-slate-400">
                    {currentStyle.color || 'default'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    id="node-text-color-picker"
                    type="color"
                    value={currentStyle.color || '#ffffff'}
                    onChange={(e) => handleUpdate({ color: e.target.value })}
                    className="w-7 h-7 rounded border border-slate-700 bg-slate-950 cursor-pointer p-0.5 shrink-0"
                    title="Choose exact text color"
                  />
                  <input
                    id="node-text-hex-input"
                    type="text"
                    value={currentStyle.color || ''}
                    placeholder="#ffffff"
                    onChange={(e) => handleUpdate({ color: e.target.value })}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                  />
                  {currentStyle.color && (
                    <button
                      type="button"
                      onClick={() => handleUpdate({ color: undefined })}
                      className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 transition-colors"
                      title="Clear text color override"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {/* Quick Text Swatches */}
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_TEXT_SWATCHES.map((sw) => (
                    <button
                      key={sw.label}
                      type="button"
                      onClick={() => handleUpdate({ color: sw.value || undefined })}
                      className={`w-5 h-5 rounded border transition-transform hover:scale-110 flex items-center justify-center text-[10px] font-bold ${
                        currentStyle.color === sw.value
                          ? 'ring-2 ring-sky-400 scale-105 border-white'
                          : 'border-slate-700'
                      }`}
                      style={{
                        backgroundColor: sw.value || '#475569',
                        color: sw.value === '#ffffff' || sw.value === '#fde047' ? '#0f172a' : '#ffffff',
                      }}
                      title={sw.label}
                    >
                      A
                    </button>
                  ))}
                </div>
              </div>
  
              {/* 3. Border Color & Width (stroke & stroke-width) */}
              <div className="pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-semibold text-slate-200">
                    Border (Stroke & Width)
                  </label>
                  <span className="text-[10px] font-mono text-slate-400">
                    {currentStyle.stroke || 'default'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    id="node-stroke-color-picker"
                    type="color"
                    value={currentStyle.stroke || '#475569'}
                    onChange={(e) => handleUpdate({ stroke: e.target.value })}
                    className="w-7 h-7 rounded border border-slate-700 bg-slate-950 cursor-pointer p-0.5 shrink-0"
                    title="Choose exact border color"
                  />
                  <input
                    id="node-stroke-hex-input"
                    type="text"
                    value={currentStyle.stroke || ''}
                    placeholder="#475569"
                    onChange={(e) => handleUpdate({ stroke: e.target.value })}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                  />
                  {/* Border width segmented selector */}
                  <div className="flex items-center bg-slate-950 border border-slate-700 rounded-lg p-0.5 text-[10px]">
                    {BORDER_WIDTH_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleUpdate({ strokeWidth: opt.value })}
                        className={`px-1.5 py-0.5 rounded transition-colors ${
                          currentStyle.strokeWidth === opt.value
                            ? 'bg-sky-600 text-white font-bold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
  
                {/* Quick Border Swatches */}
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_BORDER_SWATCHES.map((sw) => (
                    <button
                      key={sw.label}
                      type="button"
                      onClick={() => handleUpdate({ stroke: sw.value || undefined })}
                      className={`w-5 h-5 rounded border-2 transition-transform hover:scale-110 ${
                        currentStyle.stroke === sw.value
                          ? 'ring-2 ring-sky-400 scale-105 border-white'
                          : 'border-slate-700'
                      }`}
                      style={{
                        borderColor: sw.value || '#64748b',
                        backgroundColor: '#090d16',
                      }}
                      title={sw.label}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Presets Tab */
            <div className="space-y-2">
              <p className="text-[11px] text-slate-400 mb-1">
                Click a preset to apply coordinated background, text, and border styling:
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {CURATED_COLOR_PRESETS.map((preset) => {
                  const isActive =
                    currentStyle.fill === preset.fill &&
                    currentStyle.color === preset.color &&
                    currentStyle.stroke === preset.stroke;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleApplyPreset(preset)}
                      className={`flex items-center justify-between p-2 rounded-lg border text-left transition-all ${
                        isActive
                          ? 'border-sky-400 bg-sky-950/40 ring-1 ring-sky-400'
                          : 'border-slate-800 bg-slate-950/70 hover:border-slate-700 hover:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-6 h-6 rounded flex items-center justify-center font-bold text-[10px] shrink-0 border"
                          style={{
                            backgroundColor: preset.fill,
                            color: preset.color,
                            borderColor: preset.stroke,
                            borderWidth: preset.strokeWidth,
                          }}
                        >
                          S
                        </div>
                        <div>
                          <div className="font-semibold text-xs text-white">{preset.name}</div>
                          <div className="text-[10px] text-slate-400">{preset.description}</div>
                        </div>
                      </div>
                      {isActive && <Check className="w-4 h-4 text-sky-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
  
        {/* Footer Controls */}
        <div className="px-3.5 py-2.5 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between gap-2 text-xs">
          <button
            id="reset-state-style-btn"
            type="button"
            onClick={() => currentEffectiveStateId && onResetStateStyle(currentEffectiveStateId)}
            disabled={!isCustomized}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-amber-400 disabled:opacity-40 disabled:hover:text-slate-400 transition-colors"
            title="Reset this state to default theme"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset State</span>
          </button>
  
          <div className="flex items-center gap-2">
            {customizedCount > 1 && (
              <button
                id="clear-all-state-styles-btn"
                type="button"
                onClick={onClearAllCustomStyles}
                className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 transition-colors"
                title="Clear all customized states"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Reset All ({customizedCount})</span>
              </button>
            )}
  
            {!panelMode && (
<button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs shadow transition-colors"
            >
              Done
            </button>
)}
          </div>
        </div>
          </>
        )}
    </>
  );

  // Docked into a workspace tab: render only the selected mode, filling the tab
  if (panelMode) {
    return (
      <div
        id={`dock-inspector-${panelMode}`}
        className="h-full w-full flex flex-col bg-slate-900 text-slate-200 overflow-hidden"
      >
        {modeBody}
      </div>
    );
  }

  const inspectorContent = (
    <div
      id="state-style-inspector"
      onWheel={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={containerStyle}
      className={`fixed z-50 bg-slate-900/95 border border-slate-700/90 shadow-2xl backdrop-blur-md text-slate-200 overflow-hidden flex flex-col animate-in fade-in duration-150 transition-all ${
        isDocked
          ? 'rounded-none border-r-0 border-y-0 max-w-none'
          : isMaximized
          ? 'rounded-none border-0'
          : 'rounded-xl max-w-[calc(100vw-24px)]'
      }`}
    >
      {/* Drag & Resize handles */}
      <DockableResizeHandles
        isDocked={isDocked}
        isMaximized={isMaximized}
        onStartResize={startResize}
      />

      {/* Header - Click and drag to move panel when floating */}
      <div
        onMouseDown={handleHeaderMouseDown}
        className={`flex items-center justify-between px-3.5 py-2.5 bg-slate-950/80 border-b border-slate-800 select-none ${
          !isDocked && !isMaximized ? 'cursor-move' : ''
        }`}
        title={!isDocked && !isMaximized ? 'Click and drag to move window anywhere on screen' : isDocked ? 'Docked to right side of window' : 'Maximized'}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`p-1 rounded-md ${
              inspectorMode === 'enum'
                ? 'bg-sky-500/20 text-sky-400'
                : inspectorMode === 'method'
                ? 'bg-sky-500/20 text-sky-400'
                : inspectorMode === 'docs'
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-emerald-500/20 text-emerald-400'
            }`}
          >
            {inspectorMode === 'enum' ? (
              <Code2 className="w-4 h-4" />
            ) : inspectorMode === 'method' ? (
              <FileCode className="w-4 h-4" />
            ) : inspectorMode === 'docs' ? (
              <BookOpen className="w-4 h-4" />
            ) : (
              <Palette className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
              <span>
                {inspectorMode === 'enum'
                  ? 'Edit Enum (.TcDUT)'
                  : inspectorMode === 'method'
                  ? 'Method Editor'
                  : inspectorMode === 'docs'
                  ? 'State Documentation'
                  : 'State Node Appearance'}
              </span>
              {!isDocked && !isMaximized && <Move className="w-2.5 h-2.5 text-slate-500" />}
              {isDocked && (
                <span className="text-[9px] px-1 py-0.2 bg-sky-950 text-sky-300 rounded border border-sky-800/60 font-mono">
                  Docked
                </span>
              )}
            </h3>
            <p className="text-[10px] text-slate-400 truncate">
              {inspectorMode === 'enum'
                ? tcDutFileName || 'Enum Declaration'
                : inspectorMode === 'method'
                ? `Structured Text Methods in ${tcPouFileName || 'POU'}`
                : inspectorMode === 'docs'
                ? `Purpose & Notes for ${currentEffectiveStateLabel || currentEffectiveStateId || 'State'}`
                : currentEffectiveStateLabel || currentEffectiveStateId || 'Select a state'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Maximize / Restore Button */}
          <button
            id="maximize-inspector-btn"
            type="button"
            onClick={toggleMaximize}
            className="p-1 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition-colors cursor-pointer"
            title={isMaximized ? 'Restore window' : 'Maximize window'}
          >
            {isMaximized ? (
              <Minimize2 className="w-4 h-4 text-sky-400" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>

          {/* Dock / Undock Button */}
          <button
            id="dock-inspector-btn"
            type="button"
            onClick={toggleDock}
            className={`p-1 rounded-lg transition-colors cursor-pointer ${
              isDocked
                ? 'text-sky-400 bg-sky-950/80 border border-sky-800/80 hover:bg-sky-900/60 hover:text-white'
                : 'text-slate-400 hover:text-sky-300 hover:bg-slate-800'
            }`}
            title={isDocked ? 'Undock / Float window' : 'Dock to right side of window'}
            aria-label={isDocked ? 'Undock window' : 'Dock to right'}
          >
            {isDocked ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
          </button>

          {/* Close Button */}
          <button
            id="close-inspector-btn"
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-rose-950/80 hover:text-rose-300 transition-colors cursor-pointer"
            title="Close Inspector (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-950/60 p-1 gap-1 shrink-0">
        <button
          type="button"
          id="inspector-mode-enum-tab"
          onClick={() => setInspectorMode('enum')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
            inspectorMode === 'enum'
              ? 'bg-sky-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
          title="View and edit enum members in .TcDUT"
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>Edit Enum</span>
        </button>

        <button
          type="button"
          id="inspector-mode-method-tab"
          onClick={() => setInspectorMode('method')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
            inspectorMode === 'method'
              ? 'bg-sky-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
          title="View and edit methods in .TcPOU"
        >
          <FileCode className="w-3.5 h-3.5" />
          <span>Method Editor</span>
        </button>

        <button
          type="button"
          id="inspector-mode-docs-tab"
          onClick={() => setInspectorMode('docs')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
            inspectorMode === 'docs'
              ? 'bg-sky-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
          title="State Purpose, Notes & Documentation"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Documentation</span>
          {hasDoc && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block ml-0.5"
              title="Documentation present"
            />
          )}
        </button>

        <button
          type="button"
          id="inspector-mode-style-tab"
          onClick={() => setInspectorMode('style')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
            inspectorMode === 'style'
              ? 'bg-sky-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
          title="Customize fill, border, and text appearance"
        >
          <Palette className="w-3.5 h-3.5" />
          <span>Style</span>
          {isCustomized && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block ml-0.5" />
          )}
        </button>
      </div>

      {modeBody}
    </div>
  );

  return createPortal(inspectorContent, document.body);
};
