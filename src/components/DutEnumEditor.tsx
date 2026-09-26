import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  FileCode,
  Save,
  RotateCcw,
  Copy,
  Check,
  Search,
  Sparkles,
  Maximize2,
  Minimize2,
  X,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowDownAZ,
  Hash,
  Download,
  AlertCircle,
  CheckCircle2,
  Layers,
  Code2,
  Table as TableIcon,
  FileText,
  ChevronRight,
  FolderPlus,
  HelpCircle,
  ExternalLink,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import {
  parseDutContent,
  updateDutDeclaration,
  formatStructuredTextDut,
  renumberEnumValues,
  sortEnumItemsInDeclaration,
  ParsedEnumItem,
  DutSyntaxDiagnostic,
} from '../utils/dutEnumEditor.ts';
import {
  StructuredTextCodeEditor,
  StructuredTextCodeEditorRef,
} from './StructuredTextCodeEditor.tsx';
import {
  findMatchesInCode,
  FindMatch,
  FindOptions,
} from '../utils/stFindHighlight.ts';
import { detectFoldableBlocks, FoldableBlock } from '../utils/stCodeFolding.ts';
import { copyTextToClipboard } from '../utils/diagramExport.ts';
import { useDockableWindow } from '../hooks/useDockableWindow.ts';
import { DockableResizeHandles } from './DockableResizeHandles.tsx';

export interface DutEnumEditorProps {
  /** Live: the PLC's current state (marked in the code, never scrolled to) */
  liveStateId?: string | null;
  dutContent: string;
  dutFileName?: string;
  pouContent?: string;
  onSaveDutContent: (newDutContent: string) => { success: boolean; error?: string };
  onClose?: () => void;
  isModal?: boolean;
  initialSelectedMember?: string;
  embedded?: boolean;
}

type EditorViewMode = 'st' | 'grid' | 'xml';

export const DutEnumEditor: React.FC<DutEnumEditorProps> = ({
  liveStateId,
  dutContent,
  dutFileName = 'EnumDeclaration.TcDUT',
  pouContent = '',
  onSaveDutContent,
  onClose,
  isModal = false,
  initialSelectedMember,
  embedded = false,
}) => {
  // Parse initial DUT structure
  const parsedDut = useMemo(() => {
    return parseDutContent(dutContent);
  }, [dutContent]);

  // Editor states
  const [viewMode, setViewMode] = useState<EditorViewMode>('st');
  const [stCode, setStCode] = useState<string>(parsedDut.declaration);
  const [initialStCode, setInitialStCode] = useState<string>(parsedDut.declaration);
  const [rawXmlCode, setRawXmlCode] = useState<string>(dutContent);
  const [initialRawXmlCode, setInitialRawXmlCode] = useState<string>(dutContent);

  const [selectedMemberName, setSelectedMemberName] = useState<string>(initialSelectedMember || '');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Jump to an enum member: the editor scrolls to its line and highlights it briefly (the grid: its row), like
  // the Method Editor does for the state's CASE label. While the tab is hidden it cannot scroll: the jump waits.
  const [flashLine, setFlashLine] = useState<{ view: 'st' | 'xml'; line: number } | null>(null);
  const [flashRow, setFlashRow] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingJumpRef = useRef<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const performJumpRef = useRef<(name: string) => void>(() => {});
  const isVisible = () => !!rootRef.current && rootRef.current.offsetParent !== null && rootRef.current.clientHeight > 0;
  const jumpToMember = (name: string) => {
    setSelectedMemberName(name);
    if (!isVisible()) {
      pendingJumpRef.current = name;
      return;
    }
    pendingJumpRef.current = null;
    // After this render: the view shows the current text
    requestAnimationFrame(() => performJumpRef.current(name));
  };
  useEffect(() => {
    if (initialSelectedMember) jumpToMember(initialSelectedMember);
    // Only when the selection changes, not on every edit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedMember]);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const name = pendingJumpRef.current;
      if (name && isVisible()) {
        pendingJumpRef.current = null;
        requestAnimationFrame(() => performJumpRef.current(name));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => {
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
  }, []);

  // Dockable, moveable, resizeable popup window hook when opened as modal
  const {
    isDocked,
    toggleDock,
    isMaximized,
    toggleMaximize,
    handleHeaderMouseDown,
    startResize,
    containerStyle,
  } = useDockableWindow({
    id: 'dut_enum_editor',
    defaultWidth: 860,
    defaultHeight: 760,
    defaultDocked: false,
    minWidth: 400,
    minHeight: 320,
  });
  const [saveStatus, setSaveStatus] = useState<{
    type: 'idle' | 'success' | 'error';
    message?: string;
  }>({ type: 'idle' });

  // Grid search filter
  const [gridFilter, setGridFilter] = useState<string>('');

  // Add Item Modal / Inline state
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [newItemName, setNewItemName] = useState<string>('');
  const [newItemValue, setNewItemValue] = useState<string>('');
  const [newItemComment, setNewItemComment] = useState<string>('');
  const [newItemGroup, setNewItemGroup] = useState<string>('');

  // Renumber menu state
  const [isRenumberMenuOpen, setIsRenumberMenuOpen] = useState<boolean>(false);

  // Editor refs
  const stEditorRef = useRef<StructuredTextCodeEditorRef>(null);
  const xmlEditorRef = useRef<StructuredTextCodeEditorRef>(null);

  // Synchronize when dutContent changes externally
  useEffect(() => {
    setStCode(parsedDut.declaration);
    setInitialStCode(parsedDut.declaration);
    setRawXmlCode(dutContent);
    setInitialRawXmlCode(dutContent);
    setSaveStatus({ type: 'idle' });
  }, [dutContent, parsedDut.declaration]);

  // Check if modified / dirty
  const isDirty = useMemo(() => {
    if (viewMode === 'xml') {
      return rawXmlCode !== initialRawXmlCode;
    }
    return stCode !== initialStCode;
  }, [viewMode, rawXmlCode, initialRawXmlCode, stCode, initialStCode]);

  // Current parsed model of actively edited code
  const activeParsed = useMemo(() => {
    if (viewMode === 'xml') {
      return parseDutContent(rawXmlCode);
    }
    return parseDutContent(stCode);
  }, [viewMode, rawXmlCode, stCode]);

  // Extract set of states present in the .TcPOU logic (to show whether state is referenced in doState / POU)
  const referencedStatesInPou = useMemo(() => {
    const set = new Set<string>();
    if (!pouContent) return set;
    activeParsed.enumItems.forEach((item) => {
      const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(`\\b${escaped}\\b`, 'i');
      if (rx.test(pouContent)) {
        set.add(item.name);
      }
    });
    return set;
  }, [pouContent, activeParsed.enumItems]);

  // Code folding blocks
  const foldableBlocks = useMemo<FoldableBlock[]>(() => {
    return detectFoldableBlocks(stCode);
  }, [stCode]);
  const [foldedBlockIds, setFoldedBlockIds] = useState<Set<string>>(new Set());

  const handleToggleFold = useCallback((blockId: string) => {
    setFoldedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }, []);

  // Find & Replace in ST code
  const [findQuery, setFindQuery] = useState<string>('');
  const [isFindBarOpen, setIsFindBarOpen] = useState<boolean>(false);
  const [findOptions, setFindOptions] = useState<FindOptions>({
    matchCase: false,
    wholeWord: false,
  });
  const [activeMatchIndex, setActiveMatchIndex] = useState<number>(0);

  const findMatches = useMemo<FindMatch[]>(() => {
    if (!findQuery.trim()) return [];
    const textToSearch = viewMode === 'xml' ? rawXmlCode : stCode;
    return findMatchesInCode(textToSearch, findQuery, 'implementation', findOptions);
  }, [viewMode, rawXmlCode, stCode, findQuery, findOptions]);

  // Synchronize active match index
  useEffect(() => {
    if (findMatches.length === 0) {
      setActiveMatchIndex(0);
    } else if (activeMatchIndex >= findMatches.length) {
      setActiveMatchIndex(0);
    }
  }, [findMatches.length, activeMatchIndex]);

  // Jump to next / previous search match
  const handleNextMatch = () => {
    if (findMatches.length === 0) return;
    const nextIdx = (activeMatchIndex + 1) % findMatches.length;
    setActiveMatchIndex(nextIdx);
    const match = findMatches[nextIdx];
    if (match) {
      if (viewMode === 'xml') {
        xmlEditorRef.current?.scrollToLine(match.originalLineNumber);
      } else {
        stEditorRef.current?.scrollToLine(match.originalLineNumber);
      }
    }
  };

  const handlePrevMatch = () => {
    if (findMatches.length === 0) return;
    const prevIdx = (activeMatchIndex - 1 + findMatches.length) % findMatches.length;
    setActiveMatchIndex(prevIdx);
    const match = findMatches[prevIdx];
    if (match) {
      if (viewMode === 'xml') {
        xmlEditorRef.current?.scrollToLine(match.originalLineNumber);
      } else {
        stEditorRef.current?.scrollToLine(match.originalLineNumber);
      }
    }
  };

  // The member's line in the Structured Text or the raw XML, 1-based (0: not found)
  const memberLine = (name: string, view: 'st' | 'xml'): number => {
    if (view === 'st') {
      const item = activeParsed.enumItems.find((i) => i.name.toLowerCase() === name.toLowerCase());
      return item && item.line > 0 ? item.line : 0;
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`^\\s*,?\\s*${escaped}\\b`, 'i');
    const lines = rawXmlCode.split(/\r?\n/);
    const start = Math.max(0, lines.findIndex((l) => /\bTYPE\b/i.test(l)));
    for (let i = start; i < lines.length; i++) if (rx.test(lines[i])) return i + 1;
    return 0;
  };
  // Highlights for 3 s (a line of the ST / XML editor, or a grid row)
  const flash = (show: () => void) => {
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    show();
    flashTimerRef.current = window.setTimeout(() => {
      setFlashLine(null);
      setFlashRow(null);
      flashTimerRef.current = null;
    }, 3000);
  };
  const flashEditorLine = (view: 'st' | 'xml', line: number) => {
    if (line <= 0) return;
    (view === 'xml' ? xmlEditorRef : stEditorRef).current?.scrollToLine(line);
    flash(() => {
      setFlashRow(null);
      setFlashLine({ view, line });
    });
  };
  // The syntax check numbers the declaration's lines: in the XML view the declaration starts on the CDATA line
  const declarationLineInView = (line: number) => {
    if (viewMode !== 'xml') return line;
    const at = rawXmlCode.split(/\r?\n/).findIndex((l) => /<Declaration>\s*<!\[CDATA\[/i.test(l));
    return at >= 0 ? at + line : line;
  };
  const jumpToDeclarationLine = (line: number) => flashEditorLine(viewMode === 'xml' ? 'xml' : 'st', declarationLineInView(line));
  performJumpRef.current = (name: string) => {
    if (viewMode === 'grid') {
      const row = rootRef.current?.querySelector(`tr[data-member="${CSS.escape(name)}"]`);
      if (!row) return;
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      flash(() => {
        setFlashLine(null);
        setFlashRow(name);
      });
      return;
    }
    const view = viewMode === 'xml' ? 'xml' : 'st';
    flashEditorLine(view, memberLine(name, view));
  };

  // Jump to specific enum member in editor
  const handleJumpToMember = (memberName: string) => {
    if (memberName) jumpToMember(memberName);
    else setSelectedMemberName('');
  };

  // Handle Save
  const handleSave = () => {
    setSaveStatus({ type: 'idle' });
    let finalDutText = '';

    if (viewMode === 'xml') {
      finalDutText = rawXmlCode;
    } else {
      // If user edited Structured Text, update declaration inside original XML (or raw)
      finalDutText = updateDutDeclaration(dutContent, stCode);
    }

    try {
      const res = onSaveDutContent(finalDutText);
      if (res.success) {
        setInitialStCode(stCode);
        setInitialRawXmlCode(finalDutText);
        setRawXmlCode(finalDutText);
        setSaveStatus({
          type: 'success',
          message: `Saved ${dutFileName} to project! Statechart diagram updated.`,
        });
        setTimeout(() => {
          setSaveStatus((prev) => (prev.type === 'success' ? { type: 'idle' } : prev));
        }, 4000);
      } else {
        setSaveStatus({
          type: 'error',
          message: res.error || `Failed to save ${dutFileName}`,
        });
      }
    } catch (err) {
      setSaveStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unknown error during save.',
      });
    }
  };

  // Revert / Reset
  const handleReset = () => {
    setStCode(initialStCode);
    setRawXmlCode(initialRawXmlCode);
    setSaveStatus({ type: 'idle' });
  };

  // Format ST code
  const handleFormat = () => {
    const formatted = formatStructuredTextDut(stCode);
    if (formatted) {
      setStCode(formatted);
      // Also sync XML if needed
      setRawXmlCode(updateDutDeclaration(rawXmlCode, formatted));
    }
  };

  // Renumber enum values
  const handleRenumber = (start: number, step: number, clearValues: boolean = false) => {
    const renumbered = renumberEnumValues(stCode, start, step, clearValues);
    setStCode(renumbered);
    setRawXmlCode(updateDutDeclaration(rawXmlCode, renumbered));
    setIsRenumberMenuOpen(false);
  };

  // Sort enum items
  const handleSort = (mode: 'alphabetical' | 'natural') => {
    const sorted = sortEnumItemsInDeclaration(stCode, mode);
    setStCode(sorted);
    setRawXmlCode(updateDutDeclaration(rawXmlCode, sorted));
  };

  // Add new member to declaration
  const handleAddNewMember = () => {
    if (!newItemName.trim()) return;
    const cleanName = newItemName.trim().toUpperCase().replace(/\s+/g, '_');

    // Build the line to insert
    let memberLine = `\t${cleanName}`;
    if (newItemValue.trim()) {
      memberLine += ` := ${newItemValue.trim()}`;
    }
    memberLine += ',';
    if (newItemComment.trim()) {
      memberLine += `\t\t(* ${newItemComment.trim()} *)`;
    }

    const lines = stCode.split(/\r?\n/);
    const closeParenIdx = lines.findLastIndex((l) => l.trim().startsWith(')') || l.trim().includes(')'));

    let newLines: string[] = [];
    if (closeParenIdx >= 0) {
      // If group is specified and doesn't exist yet, insert header comment
      const insertItems: string[] = [];
      if (newItemGroup.trim() && !stCode.includes(`(* ${newItemGroup.trim()} *)`)) {
        insertItems.push('');
        insertItems.push(`\t(* ${newItemGroup.trim()} *)`);
      }
      insertItems.push(memberLine);

      newLines = [
        ...lines.slice(0, closeParenIdx),
        ...insertItems,
        ...lines.slice(closeParenIdx),
      ];
    } else {
      newLines = [...lines, memberLine];
    }

    const updatedCode = newLines.join('\n');
    setStCode(updatedCode);
    setRawXmlCode(updateDutDeclaration(rawXmlCode, updatedCode));

    // Reset modal
    setNewItemName('');
    setNewItemValue('');
    setNewItemComment('');
    setNewItemGroup('');
    setIsAddModalOpen(false);
  };

  // Grid actions: Delete member
  const handleDeleteMember = (nameToDelete: string) => {
    const lines = stCode.split(/\r?\n/);
    const filtered = lines.filter((line) => {
      const trimmed = line.trim();
      // Match line starting with this identifier
      return !new RegExp(`^${nameToDelete}\\b`, 'i').test(trimmed) &&
             !new RegExp(`^[A-Za-z0-9_#]+\\s*:=\\s*.*\\b${nameToDelete}\\b`, 'i').test(trimmed);
    });
    const updated = filtered.join('\n');
    setStCode(updated);
    setRawXmlCode(updateDutDeclaration(rawXmlCode, updated));
  };

  // Grid actions: Move item up/down
  const handleMoveMember = (idx: number, direction: 'up' | 'down') => {
    const activeItems = activeParsed.enumItems.filter((i) => !i.isCommentedOut);
    if (direction === 'up' && idx <= 0) return;
    if (direction === 'down' && idx >= activeItems.length - 1) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    const reordered = [...activeItems];
    const temp = reordered[idx];
    reordered[idx] = reordered[targetIdx];
    reordered[targetIdx] = temp;

    // Reconstruct formatted declaration
    const formatted = formatStructuredTextDut(
      reordered
        .map((item) => {
          let s = `\t${item.name}`;
          if (item.value) s += ` := ${item.value}`;
          s += ',';
          if (item.comment) s += `\t(* ${item.comment} *)`;
          return s;
        })
        .join('\n')
    );
    setStCode(formatted);
    setRawXmlCode(updateDutDeclaration(rawXmlCode, formatted));
  };

  // Copy code
  const handleCopy = async () => {
    const textToCopy = viewMode === 'xml' ? rawXmlCode : stCode;
    const ok = await copyTextToClipboard(textToCopy);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Download .TcDUT file
  const handleDownload = () => {
    const contentToDownload = viewMode === 'xml' ? rawXmlCode : updateDutDeclaration(dutContent, stCode);
    const blob = new Blob([contentToDownload], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = dutFileName.endsWith('.TcDUT') ? dutFileName : `${dutFileName}.TcDUT`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Keyboard shortcut handler
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      handleSave();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      setIsFindBarOpen(true);
    } else if (e.key === 'Escape' && isModal && onClose) {
      onClose();
    }
  };

  // Filtered members for Table Grid View
  const filteredGridItems = useMemo(() => {
    if (!gridFilter.trim()) return activeParsed.enumItems;
    const q = gridFilter.toLowerCase().trim();
    return activeParsed.enumItems.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.value && item.value.toLowerCase().includes(q)) ||
        (item.comment && item.comment.toLowerCase().includes(q)) ||
        (item.group && item.group.toLowerCase().includes(q))
    );
  }, [activeParsed.enumItems, gridFilter]);

  const editorContent = (
    <div
      ref={rootRef}
      onKeyDown={handleKeyDown}
      style={isModal && !embedded ? containerStyle : undefined}
      className={`flex flex-col bg-slate-950 text-slate-200 font-sans transition-all duration-150 overflow-hidden ${
        embedded
          ? 'w-full h-full flex-1 min-h-0 border-0 rounded-none shadow-none'
          : isModal
          ? isDocked
            ? 'rounded-none border-r-0 border-y-0 max-w-none border border-slate-800 shadow-2xl'
            : isMaximized
            ? 'rounded-none border border-slate-800 shadow-2xl'
            : 'rounded-xl max-w-[calc(100vw-20px)] border border-slate-800 shadow-2xl'
          : 'w-full h-full rounded-xl flex-1 min-h-0 border border-slate-800 shadow-2xl'
      }`}
    >
      {!embedded && isModal && (
        <DockableResizeHandles
          isDocked={isModal && isDocked}
          isMaximized={isModal && isMaximized}
          onStartResize={startResize}
        />
      )}

      {/* 1. TwinCAT XAE Topmost Titlebar & Breadcrumbs */}
      <div
        onMouseDown={isModal ? handleHeaderMouseDown : undefined}
        className={`flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-800 select-none shrink-0 ${
          isModal && !isDocked ? 'cursor-move' : ''
        }`}
        title={isModal && !isDocked ? 'Click and drag to move window anywhere on screen' : undefined}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Beckhoff TwinCAT XAE DUT Badge */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-sky-950/80 border border-sky-800/80 text-sky-400 font-mono text-[11px] font-bold shrink-0">
            <FileCode className="w-3.5 h-3.5 text-sky-400" />
            <span>DUT</span>
          </div>

          {/* Document Title with Dirty Asterisk */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-semibold text-xs text-slate-100 truncate">
              {dutFileName}
            </span>
            {isDirty && (
              <span className="text-amber-400 font-bold text-sm leading-none" title="Unsaved changes">
                *
              </span>
            )}
            {isModal && isDocked && (
              <span className="text-[9px] px-1 py-0.2 bg-sky-950 text-sky-300 rounded border border-sky-800/60 font-mono">
                Docked
              </span>
            )}
          </div>

          {/* TwinCAT XAE Solution Explorer Breadcrumb Path */}
          <div className="hidden lg:flex items-center gap-1 text-[11px] text-slate-500 font-mono">
            <span>PLC</span>
            <ChevronRight className="w-3 h-3 text-slate-600" />
            <span>DUTs</span>
            <ChevronRight className="w-3 h-3 text-slate-600" />
            <span className="text-sky-300 font-semibold">{activeParsed.dutName}</span>
          </div>

          {/* Quick Member Jump Selector */}
          {activeParsed.enumItems.length > 0 && (
            <div className="hidden sm:flex items-center gap-1 ml-2">
              <select
                aria-label="Jump to enum member"
                value={selectedMemberName}
                onChange={(e) => handleJumpToMember(e.target.value)}
                className="bg-slate-950 border border-slate-700 hover:border-slate-600 rounded px-2 py-0.5 text-[11px] font-mono text-sky-300 outline-none cursor-pointer max-w-[180px] truncate"
                title="Jump to enum member"
              >
                <option value="">Jump to member ({activeParsed.enumItems.length})...</option>
                {activeParsed.enumItems.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Top-Right Window Controls */}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {/* Dock / Undock Button */}
          {isModal && (
            <button
              id="enum-editor-dock-btn"
              type="button"
              onClick={toggleDock}
              className={`p-1 rounded transition-colors cursor-pointer ${
                isDocked
                  ? 'text-sky-400 bg-sky-950/80 border border-sky-800/80 hover:bg-sky-900/60 hover:text-white'
                  : 'text-slate-400 hover:text-sky-300 hover:bg-slate-800'
              }`}
              title={isDocked ? 'Undock / Float window' : 'Dock to right side of window'}
              aria-label={isDocked ? 'Undock window' : 'Dock to right'}
            >
              {isDocked ? (
                <PanelRightOpen className="w-3.5 h-3.5" />
              ) : (
                <PanelRightClose className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {/* Maximize / Restore */}
          {!embedded && (
            <button
              type="button"
              onClick={isModal ? toggleMaximize : () => setIsExpanded(!isExpanded)}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
              title={(isModal ? isMaximized : isExpanded) ? 'Restore window' : 'Maximize window'}
            >
              {(isModal ? isMaximized : isExpanded) ? (
                <Minimize2 className="w-3.5 h-3.5 text-sky-400" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {/* Close Button (if modal or onClose provided) */}
          {!embedded && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-rose-950/80 hover:text-rose-300 transition-colors cursor-pointer"
              title="Close editor (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 2. TwinCAT XAE Command Bar / Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-3 py-1.5 bg-slate-950 border-b border-slate-800 gap-2 shrink-0 select-none">
        {/* Left: View Mode Tabs + Core Actions */}
        <div className="flex items-center flex-wrap gap-1.5 min-w-0">
          {/* Mode Switcher Segmented Control */}
          <div className="flex items-center gap-0.5 bg-slate-900 border border-slate-800 p-0.5 rounded-lg text-xs font-medium">
            <button
              type="button"
              onClick={() => setViewMode('st')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                viewMode === 'st'
                  ? 'bg-slate-800 text-sky-400 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Structured Text Declaration View (IEC 61131-3)"
            >
              <Code2 className="w-3.5 h-3.5 text-sky-400" />
              <span>ST Code</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-slate-800 text-sky-400 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="TwinCAT XAE Grid Table View"
            >
              <TableIcon className="w-3.5 h-3.5 text-sky-400" />
              <span>Members Grid</span>
              <span className="text-[10px] px-1 py-0.2 rounded bg-slate-950 text-slate-400 font-mono">
                {activeParsed.enumItems.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('xml')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                viewMode === 'xml'
                  ? 'bg-slate-800 text-sky-400 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Raw TwinCAT 3 .TcDUT XML Document"
            >
              <FileText className="w-3.5 h-3.5 text-sky-400" />
              <span>.TcDUT XML</span>
            </button>
          </div>

          <div className="h-4 w-px bg-slate-800 mx-0.5 hidden sm:block" />

          {/* Save Button */}
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty}
            className={`flex items-center gap-1 px-3 py-1 rounded-md text-xs font-semibold transition-all shadow-sm cursor-pointer ${
              isDirty
                ? 'bg-sky-600 hover:bg-sky-500 text-white ring-1 ring-sky-400'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
            }`}
            title="Save changes to .TcDUT and update Statechart Diagram (Ctrl+S)"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save</span>
            <kbd className="hidden md:inline px-1 py-0.2 bg-slate-950/60 rounded text-[9px] font-mono text-slate-300">
              Ctrl+S
            </kbd>
          </button>

          {/* Reset / Revert Button */}
          <button
            type="button"
            onClick={handleReset}
            disabled={!isDirty}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer ${
              isDirty
                ? 'text-slate-300 hover:text-white hover:bg-slate-800'
                : 'text-slate-600 cursor-not-allowed opacity-40'
            }`}
            title="Revert all unsaved changes"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Revert</span>
          </button>

          {/* Add Enum Member */}
          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-sky-400 hover:text-sky-300 hover:bg-sky-950/60 border border-sky-800/60 transition-colors cursor-pointer font-medium"
            title="Add a new Enum member to this DUT"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Member</span>
          </button>

          {/* Format ST */}
          <button
            type="button"
            onClick={handleFormat}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-slate-300 hover:text-sky-300 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Format Structured Text indentation and align comments"
          >
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden md:inline">Format ST</span>
          </button>

          {/* Renumber Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsRenumberMenuOpen(!isRenumberMenuOpen)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-slate-300 hover:text-sky-300 hover:bg-slate-800 transition-colors cursor-pointer"
              title="Renumber enum values (e.g. := 0, := 10, := 20...)"
            >
              <Hash className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden md:inline">Renumber</span>
            </button>
            {isRenumberMenuOpen && (
              <div className="absolute left-0 mt-1 w-48 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-20 py-1 text-xs">
                <button
                  type="button"
                  onClick={() => handleRenumber(0, 10)}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-200 transition-colors"
                >
                  Step by 10 (0, 10, 20...)
                </button>
                <button
                  type="button"
                  onClick={() => handleRenumber(0, 1)}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-200 transition-colors"
                >
                  Sequential (0, 1, 2, 3...)
                </button>
                <button
                  type="button"
                  onClick={() => handleRenumber(1, 1)}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-200 transition-colors"
                >
                  1-based (1, 2, 3, 4...)
                </button>
                <div className="h-px bg-slate-800 my-1" />
                <button
                  type="button"
                  onClick={() => handleRenumber(0, 0, true)}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-rose-400 transition-colors"
                >
                  Clear Explicit Values
                </button>
              </div>
            )}
          </div>

          {/* Sort Dropdown */}
          <button
            type="button"
            onClick={() => handleSort('alphabetical')}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-slate-300 hover:text-sky-300 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Sort members alphabetically"
          >
            <ArrowDownAZ className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden lg:inline">Sort A-Z</span>
          </button>
        </div>

        {/* Right: Find Bar Toggle, Copy, Download */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {/* Find Bar Toggle */}
          <button
            type="button"
            onClick={() => setIsFindBarOpen(!isFindBarOpen)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              isFindBarOpen
                ? 'bg-sky-950 text-sky-300 border border-sky-800'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Find & Highlight in code (Ctrl+F)"
          >
            <Search className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Find</span>
          </button>

          {/* Copy Code */}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Copy current content to clipboard"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Copy</span>
              </>
            )}
          </button>

          {/* Download File */}
          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Download .TcDUT file"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </div>

      {/* 3. Find & Match Toolbar Bar (Collapsible) */}
      {isFindBarOpen && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 gap-2 text-xs shrink-0 select-none">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative flex-1">
              <input
                type="text"
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                placeholder="Find state or text in DUT..."
                autoFocus
                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 placeholder-slate-500 font-mono outline-none focus:border-sky-500"
              />
              {findQuery && (
                <button
                  type="button"
                  onClick={() => setFindQuery('')}
                  className="absolute right-2 top-1.5 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono shrink-0">
              <span>
                {findMatches.length > 0 ? `${activeMatchIndex + 1}/${findMatches.length}` : 'No matches'}
              </span>
            </div>

            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={handlePrevMatch}
                disabled={findMatches.length === 0}
                className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
                title="Previous match (Shift+Enter)"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleNextMatch}
                disabled={findMatches.length === 0}
                className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
                title="Next match (Enter)"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFindOptions((prev) => ({ ...prev, matchCase: !prev.matchCase }))}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
                findOptions.matchCase
                  ? 'bg-sky-950 text-sky-300 border-sky-700'
                  : 'text-slate-500 border-transparent hover:text-slate-300'
              }`}
              title="Match Case"
            >
              Aa
            </button>
            <button
              type="button"
              onClick={() => setFindOptions((prev) => ({ ...prev, wholeWord: !prev.wholeWord }))}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
                findOptions.wholeWord
                  ? 'bg-sky-950 text-sky-300 border-sky-700'
                  : 'text-slate-500 border-transparent hover:text-slate-300'
              }`}
              title="Match Whole Word"
            >
              \b
            </button>
            <button
              type="button"
              onClick={() => setIsFindBarOpen(false)}
              className="text-slate-500 hover:text-slate-300 p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 4. Diagnostics Banner (Errors or Warnings in ST Declaration) */}
      {activeParsed.diagnostics.length > 0 && (
        <div className="px-3 py-1.5 bg-amber-950/60 border-b border-amber-800/80 flex items-center justify-between text-xs text-amber-200 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="font-semibold">TwinCAT DUT Syntax:</span>
            <span className="truncate font-mono text-[11px]">
              {activeParsed.diagnostics[0].message} (line {declarationLineInView(activeParsed.diagnostics[0].line)})
            </span>
          </div>
          <button
            type="button"
            onClick={() => jumpToDeclarationLine(activeParsed.diagnostics[0].line)}
            className="text-[11px] underline text-amber-300 hover:text-amber-100 cursor-pointer font-mono shrink-0 ml-2"
          >
            Jump to Line {declarationLineInView(activeParsed.diagnostics[0].line)}
          </button>
        </div>
      )}

      {/* Save Status Notification Banner */}
      {saveStatus.type !== 'idle' && (
        <div
          className={`px-3 py-1.5 border-b text-xs flex items-center justify-between shrink-0 font-medium ${
            saveStatus.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-800 text-emerald-200'
              : 'bg-rose-950/80 border-rose-800 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {saveStatus.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span className="truncate">{saveStatus.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveStatus({ type: 'idle' })}
            className="text-slate-400 hover:text-white p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 5. Main Editor Work Area based on viewMode */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
        {/* VIEW 1: Structured Text Code Editor */}
        {viewMode === 'st' && (
          <StructuredTextCodeEditor
            ref={stEditorRef}
            id="st-dut-editor"
            value={stCode}
            onChange={(val) => setStCode(val)}
            highlightedLine={flashLine?.view === 'st' ? flashLine.line : null}
            liveLine={liveStateId ? memberLine(liveStateId, 'st') || null : null}
            enableCodeFolding={true}
            foldedBlockIds={foldedBlockIds}
            onToggleFold={handleToggleFold}
            foldableBlocks={foldableBlocks}
            findQuery={isFindBarOpen ? findQuery : ''}
            findOptions={findOptions}
            activeFindMatchIndex={activeMatchIndex}
            placeholder="TYPE E_States : ( ... ); END_TYPE"
            ariaLabel="TwinCAT Structured Text Enum Editor"
            className="flex-1 min-h-0"
          />
        )}

        {/* VIEW 2: TwinCAT XAE Members Grid Table */}
        {viewMode === 'grid' && (
          <div className="flex-1 min-h-0 flex flex-col bg-slate-950 overflow-hidden">
            {/* Grid Search / Filter Bar */}
            <div className="flex items-center justify-between px-3 py-2 bg-slate-900/60 border-b border-slate-800 gap-2 shrink-0">
              <div className="flex items-center gap-2 max-w-sm flex-1">
                <Search className="w-3.5 h-3.5 text-slate-500" />
                <input
                  type="text"
                  value={gridFilter}
                  onChange={(e) => setGridFilter(e.target.value)}
                  placeholder="Filter enum members or comments..."
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 font-mono outline-none focus:border-sky-500"
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>
                  Showing {filteredGridItems.length} of {activeParsed.enumItems.length} items
                </span>
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(true)}
                  className="px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium flex items-center gap-1 text-xs cursor-pointer shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add State</span>
                </button>
              </div>
            </div>

            {/* Grid Data Table */}
            <div className="flex-1 overflow-auto custom-scrollbar">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 select-none sticky top-0 z-10 text-[11px]">
                    <th className="py-2 px-3 w-12 text-center">#</th>
                    <th className="py-2 px-3">State Identifier</th>
                    <th className="py-2 px-3 w-28">Value / Ordinal</th>
                    <th className="py-2 px-3">Comment / Description</th>
                    <th className="py-2 px-3 w-36">Category Group</th>
                    <th className="py-2 px-3 w-28 text-center">In Statechart?</th>
                    <th className="py-2 px-3 w-28 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {filteredGridItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                        No enum members match the current filter.
                      </td>
                    </tr>
                  ) : (
                    filteredGridItems.map((item, idx) => {
                      const isUsed = referencedStatesInPou.has(item.name);
                      return (
                        <tr
                          key={item.id}
                          data-member={item.name}
                          data-live={liveStateId === item.name ? 'true' : undefined}
                          className={`hover:bg-slate-900/60 transition-colors group ${flashRow === item.name ? 'enum-row-flash' : ''} ${liveStateId === item.name ? 'bg-emerald-950/60 shadow-[inset_3px_0_0_rgb(52,211,153)]' : ''}`}
                        >
                          {/* Index */}
                          <td className="py-2 px-3 text-slate-500 text-center text-[10px]">
                            {idx + 1}
                          </td>

                          {/* State Name */}
                          <td className="py-2 px-3 font-semibold text-sky-300">
                            {item.name}
                          </td>

                          {/* Value / Ordinal */}
                          <td className="py-2 px-3 text-amber-300 font-mono">
                            {item.value ? `:= ${item.value}` : <span className="text-slate-600">auto</span>}
                          </td>

                          {/* Comment */}
                          <td className="py-2 px-3 text-emerald-400/90 italic">
                            {item.comment ? `(* ${item.comment} *)` : <span className="text-slate-600">—</span>}
                          </td>

                          {/* Category Group */}
                          <td className="py-2 px-3 text-slate-400 text-[11px]">
                            {item.group || <span className="text-slate-600">—</span>}
                          </td>

                          {/* Used in Logic */}
                          <td className="py-2 px-3 text-center">
                            {isUsed ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-mono bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.5 rounded">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 font-mono bg-slate-900 px-1.5 py-0.5 rounded">
                                Unused
                              </span>
                            )}
                          </td>

                          {/* Reorder and Delete Actions */}
                          <td className="py-2 px-3 text-right">
                            <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={() => handleMoveMember(idx, 'up')}
                                disabled={idx === 0}
                                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-20 cursor-pointer"
                                title="Move state up"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMoveMember(idx, 'down')}
                                disabled={idx === filteredGridItems.length - 1}
                                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-20 cursor-pointer"
                                title="Move state down"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteMember(item.name)}
                                className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/60 transition-colors cursor-pointer"
                                title="Delete this state"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* VIEW 3: Raw .TcDUT XML Editor */}
        {viewMode === 'xml' && (
          <StructuredTextCodeEditor
            ref={xmlEditorRef}
            id="raw-tcdut-xml-editor"
            value={rawXmlCode}
            onChange={(val) => setRawXmlCode(val)}
            highlightedLine={flashLine?.view === 'xml' ? flashLine.line : null}
            liveLine={liveStateId ? memberLine(liveStateId, 'xml') || null : null}
            enableCodeFolding={true}
            findQuery={isFindBarOpen ? findQuery : ''}
            findOptions={findOptions}
            activeFindMatchIndex={activeMatchIndex}
            placeholder="<TcPlcObject> ... </TcPlcObject>"
            ariaLabel="Raw TwinCAT 3 .TcDUT XML Document"
            className="flex-1 min-h-0"
          />
        )}
      </div>

      {/* 6. TwinCAT XAE Status Bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-slate-900 border-t border-slate-800 text-[11px] text-slate-400 font-mono select-none shrink-0">
        <div className="flex items-center gap-3">
          {/* Status state */}
          <span className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isDirty ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
              }`}
            />
            <span className={isDirty ? 'text-amber-300 font-semibold' : 'text-slate-300'}>
              {isDirty ? 'Modified (Unsaved)' : 'Ready'}
            </span>
          </span>

          {/* Member count */}
          <span>
            {activeParsed.enumItems.length} Enum Items (
            <span className="text-emerald-400">
              {referencedStatesInPou.size} active in POU logic
            </span>
            )
          </span>

          {activeParsed.groups.length > 0 && (
            <span className="hidden md:inline">
              {activeParsed.groups.length} Categories
            </span>
          )}
        </div>

        <div className="flex items-center gap-4 text-[11px]">
          <span className="hidden sm:inline">Beckhoff TwinCAT 3</span>
          <span className="text-sky-300">IEC 61131-3 DUT</span>
          <span>UTF-8</span>
        </div>
      </div>

      {/* 7. Modal Dialog: Add New Enum Member */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-4 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-bold text-slate-100">Add New Enum Member</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">State Identifier *</label>
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="e.g. TABLEMANAGER_NEW_STATE"
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-sky-300 focus:border-sky-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Ordinal Value <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={newItemValue}
                  onChange={(e) => setNewItemValue(e.target.value)}
                  placeholder="e.g. 100 or 16#FF"
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-amber-300 focus:border-sky-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Inline Comment / Description <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={newItemComment}
                  onChange={(e) => setNewItemComment(e.target.value)}
                  placeholder="e.g. Waiting for safe sensor condition"
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:border-sky-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Category Section Header <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={newItemGroup}
                  onChange={(e) => setNewItemGroup(e.target.value)}
                  placeholder="e.g. Auto-feed Sequence"
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:border-sky-500 outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-3 py-1.5 rounded text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddNewMember}
                disabled={!newItemName.trim()}
                className="px-4 py-1.5 rounded text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40 cursor-pointer shadow-sm"
              >
                Add State Member
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (isModal && !embedded) ? createPortal(editorContent, document.body) : editorContent;
};
