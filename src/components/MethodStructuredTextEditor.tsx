import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Code2,
  Save,
  RotateCcw,
  Copy,
  Check,
  ArrowRight,
  ArrowUpRight,
  AlertCircle,
  FileCode,
  Sparkles,
  Maximize2,
  Minimize2,
  CheckCircle2,
  X,
  Layers,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Search,
  Tag,
  GripHorizontal,
  FoldVertical,
  UnfoldVertical,
  ListCollapse,
  FileCode2,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import {
  getAllMethodsFromPou,
  getMethodCodeFromPou,
  parseTransitionsFromStateCode,
  ExtractedMethodCode,
} from '../utils/pouStateEditor.ts';
import {
  StructuredTextCodeEditor,
  StructuredTextCodeEditorRef,
} from './StructuredTextCodeEditor.tsx';
import { findCaseLabelLineIndex } from '../utils/stSyntaxHighlighter.ts';
import {
  detectFoldableBlocks,
  getAllCaseBranchBlockIds,
  getAllIfBlockIds,
  getAllFoldableBlockIds,
  findFoldableBlockForState,
  FoldableBlock,
} from '../utils/stCodeFolding.ts';
import {
  findMatchesInCode,
  collectSearchVariables,
  type SearchVariable,
  FindMatch,
  FindOptions,
} from '../utils/stFindHighlight.ts';
import { MethodEditorBreadcrumb } from './MethodEditorBreadcrumb.tsx';
import { extractPouHierarchyMetadata } from '../utils/pouHierarchy.ts';
import {
  extractPouDeclaration,
  resolveSymbolFromText,
  findSymbolDeclarationLine,
} from '../utils/stSymbolDefinition.ts';
import { MethodEditorContextMenu } from './MethodEditorContextMenu.tsx';
import { useDockableWindow } from '../hooks/useDockableWindow.ts';
import { DockableResizeHandles } from './DockableResizeHandles.tsx';

const VARIABLE_GROUPS: { source: SearchVariable['source']; label: string }[] = [
  { source: 'state', label: 'State variable' },
  { source: 'method', label: 'Method variables' },
  { source: 'pou', label: 'Function block variables' },
  { source: 'code', label: 'Used in the code' },
];

export interface MethodStructuredTextEditorProps {
  tcPouContent?: string;
  tcPouFileName?: string;
  initialMethod?: string;
  /** Go to this line of the method's implementation (a new nonce each request): scroll, unfold, highlight */
  codeJump?: { method: string; line: number; nonce: number } | null;
  selectedStateId?: string | null;
  selectedStateLabel?: string;
  /** Live: the PLC's current state (marked in the code, never scrolled to) */
  liveStateId?: string | null;
  onSaveMethodCode?: (methodName: string, newCode: string, newDeclaration?: string) => { success: boolean; error?: string };
  onSavePreProcessCode?: (newCode: string, newDeclaration?: string) => { success: boolean; error?: string };
  onClose?: () => void;
  isModal?: boolean;
  onJumpToState?: (stateId: string) => void;
  isDocked?: boolean;
  onToggleDock?: () => void;
}

export const MethodStructuredTextEditor: React.FC<MethodStructuredTextEditorProps> = ({
  tcPouContent = '',
  tcPouFileName = 'POU.TcPOU',
  initialMethod,
  codeJump,
  selectedStateId,
  selectedStateLabel,
  liveStateId,
  onSaveMethodCode,
  onSavePreProcessCode,
  onClose,
  isModal = false,
  onJumpToState,
  isDocked: propIsDocked,
  onToggleDock,
}) => {
  // Dockable, moveable, resizeable popup window hook when opened as modal
  const {
    isDocked: modalIsDocked,
    toggleDock: modalToggleDock,
    isMaximized: modalIsMaximized,
    toggleMaximize: modalToggleMaximize,
    handleHeaderMouseDown,
    startResize,
    containerStyle,
  } = useDockableWindow({
    id: 'method_structured_text_editor',
    defaultWidth: 860,
    defaultHeight: 760,
    defaultDocked: false,
    minWidth: 400,
    minHeight: 320,
  });

  const effectiveIsDocked = isModal ? modalIsDocked : Boolean(propIsDocked);
  const effectiveToggleDock = isModal ? modalToggleDock : onToggleDock;
  // 1. Extract and sort all methods from the input .TcPOU file in ascending order
  const availableMethods = useMemo<string[]>(() => {
    const rawMethods = getAllMethodsFromPou(tcPouContent);
    // Ensure unique and sorted in ascending alphabetical order
    const sorted = Array.from(new Set(rawMethods)).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    // Format all items with () for standard method call notation
    const formatted = sorted.map((m) => (m.endsWith('()') ? m : `${m}()`));

    // Ensure doState() is included if missing
    if (!formatted.some((m) => m.replace(/\(\)$/, '').toLowerCase() === 'dostate')) {
      formatted.push('doState()');
      formatted.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }

    return formatted;
  }, [tcPouContent]);

  // 2. Default selected method: "doState()"
  const defaultMethodItem = useMemo<string>(() => {
    if (initialMethod) {
      const formattedInitial = initialMethod.endsWith('()') ? initialMethod : `${initialMethod}()`;
      if (availableMethods.includes(formattedInitial)) {
        return formattedInitial;
      }
    }
    const doStateFound = availableMethods.find(
      (m) => m.replace(/\(\)$/, '').toLowerCase() === 'dostate'
    );
    return doStateFound || 'doState()';
  }, [availableMethods, initialMethod]);

  const [selectedMethod, setSelectedMethod] = useState<string>(defaultMethodItem);

  // Sync selected method if availableMethods changes and selected is not available
  useEffect(() => {
    if (!availableMethods.includes(selectedMethod)) {
      setSelectedMethod(defaultMethodItem);
    }
  }, [availableMethods, defaultMethodItem, selectedMethod]);

  // Sync selected method when initialMethod changes
  useEffect(() => {
    if (initialMethod) {
      const formattedInitial = initialMethod.endsWith('()') ? initialMethod : `${initialMethod}()`;
      if (availableMethods.includes(formattedInitial)) {
        setSelectedMethod(formattedInitial);
      }
    }
  }, [initialMethod, availableMethods]);

  // Clean method name without trailing ()
  const cleanMethodName = useMemo(() => {
    return selectedMethod.replace(/\(\)$/, '').trim();
  }, [selectedMethod]);

  // Extract POU hierarchy and method signatures metadata for breadcrumb trail
  const pouMetadata = useMemo(() => {
    return extractPouHierarchyMetadata(tcPouContent, tcPouFileName);
  }, [tcPouContent, tcPouFileName]);

  const [activeBreadcrumbState, setActiveBreadcrumbState] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    if (selectedStateId) {
      setActiveBreadcrumbState({
        id: selectedStateId,
        label: selectedStateLabel || selectedStateId,
      });
    }
  }, [selectedStateId, selectedStateLabel]);

  // Extract code & declaration for the currently selected method
  const extractedInfo = useMemo<ExtractedMethodCode>(() => {
    return getMethodCodeFromPou(tcPouContent, cleanMethodName);
  }, [tcPouContent, cleanMethodName]);

  const [code, setCode] = useState<string>('');
  const [initialCode, setInitialCode] = useState<string>('');
  const [declaration, setDeclaration] = useState<string>('');
  const [initialDeclaration, setInitialDeclaration] = useState<string>('');
  const [showDeclaration, setShowDeclaration] = useState<boolean>(true);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<{ type: 'idle' | 'success' | 'error'; message?: string }>({
    type: 'idle',
  });

  const implEditorRef = useRef<StructuredTextCodeEditorRef>(null);
  const declEditorRef = useRef<StructuredTextCodeEditorRef>(null);

  // POU-level member declaration (FUNCTION_BLOCK / PROGRAM member variables)
  const initialPouDeclaration = useMemo(() => {
    return extractPouDeclaration(tcPouContent);
  }, [tcPouContent]);
  const [pouDeclaration, setPouDeclaration] = useState<string>(initialPouDeclaration);

  useEffect(() => {
    setPouDeclaration(initialPouDeclaration);
  }, [initialPouDeclaration]);

  // Top Panel scope: 'method' (current method's declaration) or 'pou' (Function Block member declaration)
  const [declTab, setDeclTab] = useState<'method' | 'pou'>('method');
  const [declHighlightedLine, setDeclHighlightedLine] = useState<number | null>(null);
  const [declScrollToLine, setDeclScrollToLine] = useState<number | null>(null);
  const [definitionNotification, setDefinitionNotification] = useState<{
    type: 'success' | 'warning' | 'info';
    message: string;
  } | null>(null);

  // Context Menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    symbol: string | null;
    memberOf?: string;
    sourceScope: 'implementation' | 'declaration';
  } | null>(null);

  const [highlightedCaseLine, setHighlightedCaseLine] = useState<number | null>(null);
  const [scrollToLine, setScrollToLine] = useState<number | null>(null);
  const [scrollNotification, setScrollNotification] = useState<string | null>(null);
  const lastScrolledTargetRef = useRef<string | null>(null);
  const prevSelectedStateIdRef = useRef<string | null>(selectedStateId || null);
  const prevMethodNameRef = useRef<string>(cleanMethodName);
  const isInitialMountRef = useRef<boolean>(true);

  // Panel splitter ratio: default 20% Top Panel (Declaration), 80% Bottom Panel (Implementation)
  const [splitRatio, setSplitRatio] = useState<number>(0.2);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState<boolean>(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // Dragging event handlers for the panel splitter
  const handleSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSplitter(true);
  };

  const handleSplitterTouchStart = () => {
    setIsDraggingSplitter(true);
  };

  useEffect(() => {
    if (!isDraggingSplitter) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      if (rect.height <= 0) return;
      const offsetY = e.clientY - rect.top;
      // Clamp between 8% and 85% to ensure content stays usable
      const newRatio = Math.max(0.08, Math.min(0.85, offsetY / rect.height));
      setSplitRatio(newRatio);
    };

    const handleMouseUp = () => {
      setIsDraggingSplitter(false);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!splitContainerRef.current || !e.touches[0]) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      if (rect.height <= 0) return;
      const offsetY = e.touches[0].clientY - rect.top;
      const newRatio = Math.max(0.08, Math.min(0.85, offsetY / rect.height));
      setSplitRatio(newRatio);
    };

    const handleTouchEnd = () => {
      setIsDraggingSplitter(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDraggingSplitter]);

  // When extractedInfo changes (upon method switch or pouContent change), update editor buffers
  useEffect(() => {
    const loadedCode = extractedInfo.code || '';
    const loadedDecl = extractedInfo.declaration || '';
    setCode(loadedCode);
    setInitialCode(loadedCode);
    setDeclaration(loadedDecl);
    setInitialDeclaration(loadedDecl);
    setSaveStatus({ type: 'idle' });
  }, [extractedInfo]);

  // Detect foldable blocks in current implementation code
  const foldableBlocks = useMemo<FoldableBlock[]>(() => {
    return detectFoldableBlocks(code);
  }, [code]);

  // Set of actively folded block IDs
  const [foldedBlockIds, setFoldedBlockIds] = useState<Set<string>>(new Set());

  // Reset folds when method changes
  useEffect(() => {
    setFoldedBlockIds(new Set());
  }, [cleanMethodName]);

  const handleToggleFold = useCallback((blockId: string) => {
    setFoldedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  }, []);

  const handleFoldAllCases = useCallback(() => {
    const caseIds = getAllCaseBranchBlockIds(foldableBlocks);
    setFoldedBlockIds(new Set(caseIds));
  }, [foldableBlocks]);

  const handleFoldAllIfs = useCallback(() => {
    const ifIds = getAllIfBlockIds(foldableBlocks);
    setFoldedBlockIds(new Set(ifIds));
  }, [foldableBlocks]);

  const handleFoldAll = useCallback(() => {
    const allIds = getAllFoldableBlockIds(foldableBlocks);
    setFoldedBlockIds(new Set(allIds));
  }, [foldableBlocks]);

  const handleUnfoldAll = useCallback(() => {
    setFoldedBlockIds(new Set());
  }, []);

  // Dedicated Find Input & Highlight State
  const [findQuery, setFindQuery] = useState<string>('');
  const [findScope, setFindScope] = useState<'both' | 'implementation' | 'declaration'>('both');
  const [findOptions, setFindOptions] = useState<FindOptions>({
    matchCase: false,
    wholeWord: false,
  });
  const [activeGlobalMatchIndex, setActiveGlobalMatchIndex] = useState<number>(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  // The find box's variable list (a combobox): open, the text it is filtered by, the highlighted option
  const [varListOpen, setVarListOpen] = useState(false);
  const [varListFilter, setVarListFilter] = useState('');
  const [varListActive, setVarListActive] = useState(-1);
  const findBoxRef = useRef<HTMLDivElement>(null);
  const varListRef = useRef<HTMLDivElement>(null);

  // The variables offered in the find box: the method's, the function block's, and names used in the code
  const searchVariables = useMemo(
    () => collectSearchVariables(declaration, pouDeclaration, code, extractedInfo.stateVarName),
    [declaration, pouDeclaration, code, extractedInfo.stateVarName]
  );
  const shownVariables = useMemo(() => {
    const f = varListFilter.trim().toLowerCase();
    return f ? searchVariables.filter((v) => v.name.toLowerCase().includes(f)) : searchVariables;
  }, [searchVariables, varListFilter]);
  const chooseVariable = useCallback((name: string) => {
    setFindQuery(name);
    setActiveGlobalMatchIndex(0);
    setVarListOpen(false);
    setVarListActive(-1);
    findInputRef.current?.focus();
  }, []);
  // Close the list on a click elsewhere
  useEffect(() => {
    if (!varListOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!findBoxRef.current?.contains(e.target as Node)) setVarListOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [varListOpen]);
  // Keep the highlighted option in view
  useEffect(() => {
    if (varListActive < 0) return;
    varListRef.current?.querySelector(`[data-var-index="${varListActive}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [varListActive]);

  // Find matches in implementation code
  const implMatches = useMemo<FindMatch[]>(() => {
    if (findScope === 'declaration' || !findQuery.trim()) return [];
    return findMatchesInCode(code, findQuery, 'implementation', findOptions);
  }, [code, findQuery, findScope, findOptions]);

  // Find matches in declaration code (searches active declaration scope: Method or POU)
  const declMatches = useMemo<FindMatch[]>(() => {
    if (findScope === 'implementation' || !findQuery.trim()) return [];
    const activeDeclText = declTab === 'pou' ? pouDeclaration : declaration;
    return findMatchesInCode(activeDeclText, findQuery, 'declaration', findOptions);
  }, [declTab, pouDeclaration, declaration, findQuery, findScope, findOptions]);

  // Combined ordered matches across the editor (declaration top, implementation bottom)
  const allMatches = useMemo<FindMatch[]>(() => {
    const combined: FindMatch[] = [];
    let gIdx = 0;
    for (const m of declMatches) {
      combined.push({ ...m, globalIndex: gIdx++ });
    }
    for (const m of implMatches) {
      combined.push({ ...m, globalIndex: gIdx++ });
    }
    return combined;
  }, [declMatches, implMatches]);

  // Clamp active index when matches change
  useEffect(() => {
    if (allMatches.length === 0) {
      setActiveGlobalMatchIndex(0);
    } else if (activeGlobalMatchIndex >= allMatches.length) {
      setActiveGlobalMatchIndex(0);
    }
  }, [allMatches.length, activeGlobalMatchIndex]);

  const currentActiveMatch = allMatches[activeGlobalMatchIndex] || null;

  // Active match target index within implementation or declaration
  const activeImplMatchIndex = useMemo(() => {
    if (!currentActiveMatch || currentActiveMatch.target !== 'implementation') return -1;
    return currentActiveMatch.targetIndex;
  }, [currentActiveMatch]);

  const activeDeclMatchIndex = useMemo(() => {
    if (!currentActiveMatch || currentActiveMatch.target !== 'declaration') return -1;
    return currentActiveMatch.targetIndex;
  }, [currentActiveMatch]);

  const scrollToMatch = useCallback(
    (match: FindMatch) => {
      if (!match) return;
      if (match.target === 'implementation') {
        // If the match line is inside a folded block in implementation, unfold that block!
        const foldedParent = foldableBlocks.find(
          (b) =>
            foldedBlockIds.has(b.id) &&
            match.originalLineNumber >= b.startLine &&
            match.originalLineNumber <= b.endLine
        );
        if (foldedParent) {
          setFoldedBlockIds((prev) => {
            const next = new Set(prev);
            next.delete(foldedParent.id);
            return next;
          });
        }
        implEditorRef.current?.scrollToLine(match.originalLineNumber, true);
      } else if (match.target === 'declaration') {
        // If declaration panel is collapsed/hidden, reveal it so user sees the match!
        if (!showDeclaration) {
          setShowDeclaration(true);
        }
        declEditorRef.current?.scrollToLine(match.originalLineNumber, true);
      }
    },
    [foldableBlocks, foldedBlockIds, showDeclaration]
  );

  const handleNextMatch = useCallback(() => {
    if (allMatches.length === 0) return;
    const nextIdx = (activeGlobalMatchIndex + 1) % allMatches.length;
    setActiveGlobalMatchIndex(nextIdx);
    scrollToMatch(allMatches[nextIdx]);
  }, [allMatches, activeGlobalMatchIndex, scrollToMatch]);

  const handlePrevMatch = useCallback(() => {
    if (allMatches.length === 0) return;
    const prevIdx = (activeGlobalMatchIndex - 1 + allMatches.length) % allMatches.length;
    setActiveGlobalMatchIndex(prevIdx);
    scrollToMatch(allMatches[prevIdx]);
  }, [allMatches, activeGlobalMatchIndex, scrollToMatch]);

  // Global Ctrl+F / Cmd+F to focus dedicated Find input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        findInputRef.current?.focus();
        findInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Filter case branches for quick state jump navigation
  const caseBranches = useMemo(() => {
    return foldableBlocks.filter((b) => b.type === 'case-branch');
  }, [foldableBlocks]);
  // Live: the CASE label of the PLC's current state in this method (0: not in it)
  const liveCaseLine = useMemo(() => (liveStateId ? findFoldableBlockForState(foldableBlocks, liveStateId)?.startLine ?? null : null), [liveStateId, foldableBlocks]);

  const handleJumpToCaseBranch = (block: FoldableBlock) => {
    // If target block is folded, unfold it so the code is visible!
    if (foldedBlockIds.has(block.id)) {
      setFoldedBlockIds((prev) => {
        const next = new Set(prev);
        next.delete(block.id);
        return next;
      });
    }
    const stateLabelOrId = block.label.replace(/:.*$/, '').trim();
    setActiveBreadcrumbState({
      id: stateLabelOrId,
      label: stateLabelOrId,
    });
    setScrollToLine(block.startLine);
    setHighlightedCaseLine(block.startLine);
    setScrollNotification(`Jumped to case: ${block.label.slice(0, 30)} (line ${block.startLine})`);
    setTimeout(() => {
      setHighlightedCaseLine(null);
      setScrollNotification(null);
    }, 3000);
  };

  // Auto-scroll to CASE label in doState() implementation when a state/node is selected on Diagram Canvas
  useEffect(() => {
    const isStateChanged = prevSelectedStateIdRef.current !== (selectedStateId || null);
    const methodChanged = prevMethodNameRef.current !== cleanMethodName;
    prevMethodNameRef.current = cleanMethodName;

    // When switching back into doState() or when state node changed, permit scrolling to the target state
    if (methodChanged && cleanMethodName.toLowerCase() === 'dostate') {
      lastScrolledTargetRef.current = null;
    }

    if (isStateChanged) {
      prevSelectedStateIdRef.current = selectedStateId || null;
      lastScrolledTargetRef.current = null;

      // When the user deliberately selects a new state on the Diagram Canvas,
      // switch to doState() so they can inspect this state's code branch.
      if (selectedStateId && cleanMethodName.toLowerCase() !== 'dostate') {
        const doStateItem = availableMethods.find(
          (m) => m.replace(/\(\)$/, '').toLowerCase() === 'dostate'
        );
        if (doStateItem) {
          setSelectedMethod(doStateItem);
        }
        return;
      }
    }

    // Mark initial mount as completed
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
    }

    // If the currently selected method is NOT doState(), DO NOT force a switch back to doState()!
    // Non-doState methods (e.g. preProcess, stop, etc.) do not have state machine CASE branches.
    if (cleanMethodName.toLowerCase() !== 'dostate') {
      return;
    }

    if (!selectedStateId) return;

    // Avoid repeatedly scrolling if this state branch has already been scrolled to
    if (lastScrolledTargetRef.current === selectedStateId) {
      return;
    }

    // Search for the case label line in the implementation code
    const lineIndex = findCaseLabelLineIndex(code, selectedStateId, selectedStateLabel);
    if (lineIndex >= 0) {
      lastScrolledTargetRef.current = selectedStateId;
      const targetLine = lineIndex + 1; // 1-based line number

      // If this state block is currently collapsed, automatically unfold it!
      const stateBlock = findFoldableBlockForState(foldableBlocks, selectedStateId);
      if (stateBlock && foldedBlockIds.has(stateBlock.id)) {
        setFoldedBlockIds((prev) => {
          const next = new Set(prev);
          next.delete(stateBlock.id);
          return next;
        });
      }

      setScrollToLine(targetLine);
      setHighlightedCaseLine(targetLine);

      // Clear the temporary highlight after 3 seconds. No "Jumped to case" notice here: selecting a state
      // on the canvas already updates the breadcrumb "Case:" chip and highlights the line
      const timer = setTimeout(() => {
        setHighlightedCaseLine(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [selectedStateId, selectedStateLabel, cleanMethodName, code, availableMethods, foldableBlocks, foldedBlockIds]);

  // A jump to a line (Problems tab: Open code). After the state's CASE label scroll above, so the line wins when both
  // come at once; it waits until the requested method is the one shown.
  const handledCodeJumpRef = useRef(0);
  const codeJumpTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!codeJump || codeJump.nonce === handledCodeJumpRef.current) return;
    if (cleanMethodName.toLowerCase() !== codeJump.method.replace(/\(\)$/, '').toLowerCase()) {
      // Another method is shown (chosen by hand): switch to the jump's method, the jump follows when it is shown
      const wanted = codeJump.method.endsWith('()') ? codeJump.method : `${codeJump.method}()`;
      const match = availableMethods.find((m) => m.toLowerCase() === wanted.toLowerCase());
      if (match) setSelectedMethod(match);
      else handledCodeJumpRef.current = codeJump.nonce;
      return;
    }
    handledCodeJumpRef.current = codeJump.nonce;
    // The selected state's CASE label counts as visited: that scroll must not take the view back later
    lastScrolledTargetRef.current = selectedStateId || null;
    const line = codeJump.line;
    // Unfold the blocks that hide the line
    const hiding = foldableBlocks.filter((b) => foldedBlockIds.has(b.id) && line > b.startLine && line <= b.endLine);
    if (hiding.length) {
      setFoldedBlockIds((prev) => {
        const next = new Set(prev);
        for (const b of hiding) next.delete(b.id);
        return next;
      });
    }
    setHighlightedCaseLine(line);
    // After the tab is shown and the code unfolded; again while a just-shown editor is still laying out its lines
    for (const delay of [80, 300, 700]) {
      window.setTimeout(() => implEditorRef.current?.scrollToLine(line, delay === 80), delay);
    }
    if (codeJumpTimerRef.current !== null) window.clearTimeout(codeJumpTimerRef.current);
    codeJumpTimerRef.current = window.setTimeout(() => {
      setHighlightedCaseLine((l) => (l === line ? null : l));
      codeJumpTimerRef.current = null;
    }, 3000);
  }, [codeJump, cleanMethodName, availableMethods, foldableBlocks, foldedBlockIds, selectedStateId]);
  useEffect(() => () => {
    if (codeJumpTimerRef.current !== null) window.clearTimeout(codeJumpTimerRef.current);
  }, []);

  const isDirty = code !== initialCode || declaration !== initialDeclaration;

  // Real-time parsed transitions from current code
  const currentTransitions = useMemo(() => {
    return parseTransitionsFromStateCode(code, extractedInfo.stateVarName || 'machineState');
  }, [code, extractedInfo.stateVarName]);

  // Go to Definition handler for right-click context menu and F12 shortcut
  const handleGoToDefinition = useCallback(
    (targetSymbol: string, memberOf?: string) => {
      if (!targetSymbol || !targetSymbol.trim()) return;
      const sym = targetSymbol.trim();

      // Clear previous declaration highlight
      setDeclHighlightedLine(null);

      // 1. Check Method Declaration first
      let methodMatch = findSymbolDeclarationLine(declaration, sym);
      if (!methodMatch && memberOf) {
        methodMatch = findSymbolDeclarationLine(declaration, memberOf);
      }

      if (methodMatch) {
        setDeclTab('method');
        if (!showDeclaration) {
          setShowDeclaration(true);
        }
        setDeclHighlightedLine(methodMatch.lineNumber);
        setDeclScrollToLine(methodMatch.lineNumber);
        setDefinitionNotification({
          type: 'success',
          message: `Found definition of '${sym}' at line ${methodMatch.lineNumber} in Method Declaration`,
        });
        setTimeout(() => {
          setDefinitionNotification(null);
        }, 4500);
        return;
      }

      // 2. Check POU Declaration (Function Block / Program member variables)
      let pouMatch = findSymbolDeclarationLine(pouDeclaration, sym);
      if (!pouMatch && memberOf) {
        pouMatch = findSymbolDeclarationLine(pouDeclaration, memberOf);
      }

      if (pouMatch) {
        setDeclTab('pou');
        if (!showDeclaration) {
          setShowDeclaration(true);
        }
        setDeclHighlightedLine(pouMatch.lineNumber);
        setDeclScrollToLine(pouMatch.lineNumber);
        setDefinitionNotification({
          type: 'success',
          message: `Found definition of '${sym}' at line ${pouMatch.lineNumber} in POU Declaration`,
        });
        setTimeout(() => {
          setDefinitionNotification(null);
        }, 4500);
        return;
      }

      // 3. Check if target is another Method of the POU
      const foundMethod = availableMethods.find(
        (m) => m.replace(/\(\)$/, '').toLowerCase() === sym.toLowerCase()
      );
      if (foundMethod) {
        setSelectedMethod(foundMethod);
        setDefinitionNotification({
          type: 'success',
          message: `Navigated to method '${foundMethod}'`,
        });
        setTimeout(() => {
          setDefinitionNotification(null);
        }, 4000);
        return;
      }

      // 4. Check if target is a State/Case branch in this method
      const stateBranch = caseBranches.find(
        (b) =>
          b.label.toLowerCase().includes(sym.toLowerCase()) ||
          b.id.toLowerCase() === sym.toLowerCase()
      );
      if (stateBranch) {
        handleJumpToCaseBranch(stateBranch);
        setDefinitionNotification({
          type: 'success',
          message: `Jumped to State Case branch '${stateBranch.label}' (line ${stateBranch.startLine})`,
        });
        setTimeout(() => {
          setDefinitionNotification(null);
        }, 4000);
        return;
      }

      // 5. Symbol not found
      setDefinitionNotification({
        type: 'warning',
        message: `Definition for '${sym}' not found in Method or POU Declarations`,
      });
      setTimeout(() => {
        setDefinitionNotification(null);
      }, 4000);
    },
    [declaration, pouDeclaration, showDeclaration, availableMethods, caseBranches, handleJumpToCaseBranch]
  );

  // Right-click context menu handlers
  const handleImplContextMenu = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const textarea = e.currentTarget;
    const resolved = resolveSymbolFromText(code, textarea.selectionStart, textarea.selectionEnd);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      symbol: resolved?.symbol || null,
      memberOf: resolved?.memberOf,
      sourceScope: 'implementation',
    });
  };

  const handleDeclContextMenu = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const textarea = e.currentTarget;
    const activeText = declTab === 'pou' ? pouDeclaration : declaration;
    const resolved = resolveSymbolFromText(activeText, textarea.selectionStart, textarea.selectionEnd);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      symbol: resolved?.symbol || null,
      memberOf: resolved?.memberOf,
      sourceScope: 'declaration',
    });
  };

  // Handle Ctrl+S / Cmd+S save shortcuts, and F12 Go to Definition in code editors
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'F12') {
      e.preventDefault();
      const textarea = e.currentTarget;
      const activeText = textarea.value;
      const resolved = resolveSymbolFromText(activeText, textarea.selectionStart, textarea.selectionEnd);
      if (resolved && resolved.symbol) {
        handleGoToDefinition(resolved.symbol, resolved.memberOf);
      }
    }
  };

  const handleSave = () => {
    if (!onSaveMethodCode && !onSavePreProcessCode) {
      setSaveStatus({
        type: 'error',
        message: 'Save handler is not connected.',
      });
      return;
    }

    setSaveStatus({ type: 'idle' });
    let res: { success: boolean; error?: string } = { success: false };

    if (onSaveMethodCode) {
      res = onSaveMethodCode(cleanMethodName, code, declaration);
    } else if (cleanMethodName === 'preProcess' && onSavePreProcessCode) {
      res = onSavePreProcessCode(code, declaration);
    }

    if (res.success) {
      setInitialCode(code);
      setInitialDeclaration(declaration);
      setSaveStatus({
        type: 'success',
        message: `Saved method ${cleanMethodName}() to .TcPOU and refreshed diagram!`,
      });
      setTimeout(() => {
        setSaveStatus((prev) => (prev.type === 'success' ? { type: 'idle' } : prev));
      }, 4000);
    } else {
      setSaveStatus({
        type: 'error',
        message: res.error || `Failed to update ${cleanMethodName}() in .TcPOU`,
      });
    }
  };

  const handleReset = () => {
    setCode(initialCode);
    setDeclaration(initialDeclaration);
    setSaveStatus({ type: 'idle' });
  };

  const handleCopy = async () => {
    try {
      const fullText = declaration
        ? `// === METHOD ${cleanMethodName}() DECLARATION ===\n${declaration}\n\n// === IMPLEMENTATION ===\n${code}`
        : code;
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback ignored
    }
  };

  // Generate line numbers for ST implementation code
  const lines = useMemo(() => {
    const count = (code.match(/\n/g) || []).length + 1;
    return Array.from({ length: Math.max(count, 1) }, (_, i) => i + 1);
  }, [code]);

  // Generate line numbers for Declaration (top panel)
  // Handle ESC key to exit fullscreen mode
  useEffect(() => {
    if (!isExpanded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExpanded(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded]);

  const declLines = useMemo(() => {
    const count = (declaration.match(/\n/g) || []).length + 1;
    return Array.from({ length: Math.max(count, 1) }, (_, i) => i + 1);
  }, [declaration]);

  const editorInnerContent = (
    <>
      {/* POU and Method Hierarchy Breadcrumb Navigation Trail */}
      <MethodEditorBreadcrumb
        metadata={pouMetadata}
        selectedMethod={selectedMethod}
        onSelectMethod={(newMethod) => setSelectedMethod(newMethod)}
        availableMethods={availableMethods}
        activeStateId={activeBreadcrumbState?.id || selectedStateId}
        activeStateLabel={activeBreadcrumbState?.label || selectedStateLabel}
        caseBranches={caseBranches}
        onJumpToCaseBranch={(block) => {
          handleJumpToCaseBranch(block);
        }}
        activeSection={showDeclaration ? 'declaration' : 'implementation'}
        onToggleSection={() => setShowDeclaration(!showDeclaration)}
        isDeclarationVisible={showDeclaration}
      />

      {/* Definition Navigation Feedback Toast / Banner */}
      {definitionNotification && (
        <div
          className={`px-3.5 py-1.5 text-xs flex items-center justify-between gap-2 border-b shrink-0 transition-all select-none animate-in fade-in ${
            definitionNotification.type === 'success'
              ? 'bg-sky-950/90 border-sky-800/80 text-sky-200'
              : 'bg-amber-950/90 border-amber-800/80 text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {definitionNotification.type === 'success' ? (
              <ArrowUpRight className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            )}
            <span className="font-mono text-[11px] truncate">
              {definitionNotification.message}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDefinitionNotification(null)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Editor Header Bar with ComboBox for Methods */}
      <div
        onMouseDown={isModal ? handleHeaderMouseDown : undefined}
        className={`flex flex-wrap items-center justify-between px-3.5 py-2.5 bg-slate-950 border-b border-slate-800 gap-2 shrink-0 ${
          isModal && !effectiveIsDocked ? 'cursor-move select-none' : ''
        }`}
        title={isModal && !effectiveIsDocked ? 'Click and drag to move window anywhere on screen' : undefined}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-sky-950 border border-sky-800/80 flex items-center justify-center shrink-0">
            <FileCode className="w-4 h-4 text-sky-400" />
          </div>

          {/* Title & ComboBox */}
          <div className="flex items-center flex-wrap gap-2.5 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-100 uppercase tracking-wider">
                Method Editor:
              </span>
              {effectiveIsDocked && (
                <span className="text-[9px] px-1 py-0.2 bg-sky-950 text-sky-300 rounded border border-sky-800/60 font-mono">
                  Docked
                </span>
              )}
            </div>

            {/* Methods ComboBox */}
            <div className="flex items-center gap-1.5 bg-slate-900 px-2 py-0.5 rounded-lg border border-slate-700">
              <label htmlFor="method-selector-combobox" className="text-[11px] text-slate-400 font-medium whitespace-nowrap">
                Method
              </label>
              <select
                id="method-selector-combobox"
                aria-label="Select Method"
                value={selectedMethod}
                onChange={(e) => setSelectedMethod(e.target.value)}
                className="bg-slate-950 border border-slate-700 hover:border-slate-600 focus:border-sky-500 rounded-md px-2 py-1 text-xs font-mono text-sky-300 font-semibold outline-none cursor-pointer transition-colors max-w-[220px] sm:max-w-[280px]"
                title="Select a method found in this .TcPOU file (sorted ascending)"
              >
                {availableMethods.map((methodName) => (
                  <option key={methodName} value={methodName}>
                    {methodName}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-slate-400 font-mono hidden md:inline">
                ({availableMethods.length} found)
              </span>
            </div>

            {/* Only the exception is shown: a method that is not in the POU yet (saving adds it) */}
            {extractedInfo.methodFound ? null : (
              <span className="text-[10px] text-amber-400 flex items-center gap-1 font-mono shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                New Method
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {/* Toggle Declaration Top Panel Button */}
          <button
            type="button"
            onClick={() => setShowDeclaration(!showDeclaration)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
              showDeclaration
                ? 'bg-slate-800 text-sky-300 border border-sky-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Toggle top panel (declaration section)"
          >
            <Layers className="w-3 h-3 text-sky-400" />
            <span className="hidden sm:inline">Top Panel</span>
            <span className="px-1 py-0.2 text-[9px] rounded bg-sky-950 text-sky-300 font-mono border border-sky-800/60">
              {showDeclaration ? `${Math.round(splitRatio * 100)}%` : 'Hidden'}
            </span>
            {showDeclaration ? (
              <ChevronDown className="w-3 h-3 ml-0.5 text-slate-400" />
            ) : (
              <ChevronRight className="w-3 h-3 ml-0.5 text-slate-400" />
            )}
          </button>

          {/* Copy Code */}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Copy Structured Text to clipboard"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span className="hidden sm:inline">Copy</span>
              </>
            )}
          </button>

          {/* Dock / Undock Button */}
          {effectiveToggleDock && (
            <button
              id="method-editor-dock-btn"
              type="button"
              onClick={effectiveToggleDock}
              className={`p-1.5 rounded transition-colors cursor-pointer ${
                effectiveIsDocked
                  ? 'text-sky-400 bg-sky-950/80 border border-sky-800/80 hover:bg-sky-900/60 hover:text-white'
                  : 'text-slate-400 hover:text-sky-300 hover:bg-slate-800'
              }`}
              title={effectiveIsDocked ? 'Undock / Float window' : 'Dock to right side of window'}
              aria-label={effectiveIsDocked ? 'Undock window' : 'Dock to right'}
            >
              {effectiveIsDocked ? (
                <PanelRightOpen className="w-3.5 h-3.5" />
              ) : (
                <PanelRightClose className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {/* Expand / Minimize */}
          <button
            type="button"
            onClick={isModal ? modalToggleMaximize : () => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            title={(isModal ? modalIsMaximized : isExpanded) ? 'Restore size (Esc)' : 'Expand full window'}
          >
            {(isModal ? modalIsMaximized : isExpanded) ? (
              <Minimize2 className="w-3.5 h-3.5 text-sky-400" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Close button if modal or onClose provided */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Dedicated Find Input Box & Navigation Toolbar */}
      <div
        id="method-editor-find-bar"
        className="flex items-center flex-wrap justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-xs gap-2 shrink-0 select-none"
      >
        {/* Left: Find Input Box with Search Icon, Counter, Prev/Next, Options, and Scope */}
        <div className="flex items-center gap-1.5 flex-1 min-w-[280px]">
          {/* Search Input Box */}
          <div ref={findBoxRef} className="relative flex-1 max-w-sm flex items-center">
            <div className="absolute left-2.5 pointer-events-none flex items-center text-sky-400">
              <Search className="w-3.5 h-3.5" />
            </div>
            <input
              ref={findInputRef}
              id="method-editor-find-input"
              type="text"
              role="combobox"
              aria-expanded={varListOpen}
              aria-controls="method-editor-find-variables"
              aria-autocomplete="list"
              aria-activedescendant={varListOpen && varListActive >= 0 ? `find-variable-${varListActive}` : undefined}
              autoComplete="off"
              spellCheck={false}
              value={findQuery}
              onChange={(e) => {
                setFindQuery(e.target.value);
                setActiveGlobalMatchIndex(0);
                // Typing filters the variable list
                setVarListFilter(e.target.value);
                setVarListActive(-1);
                setVarListOpen(e.target.value.trim().length > 0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (!varListOpen) {
                    setVarListFilter('');
                    setVarListOpen(true);
                    setVarListActive(e.key === 'ArrowDown' ? 0 : searchVariables.length - 1);
                    return;
                  }
                  const n = shownVariables.length;
                  if (n === 0) return;
                  setVarListActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i <= 0 ? n - 1 : i - 1)));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (varListOpen && varListActive >= 0 && shownVariables[varListActive]) {
                    chooseVariable(shownVariables[varListActive].name);
                  } else {
                    setVarListOpen(false);
                    if (e.shiftKey) {
                      handlePrevMatch();
                    } else {
                      handleNextMatch();
                    }
                  }
                } else if (e.key === 'Escape') {
                  if (varListOpen) {
                    setVarListOpen(false);
                  } else if (findQuery) {
                    setFindQuery('');
                  } else {
                    findInputRef.current?.blur();
                  }
                } else if (e.key === 'Tab') {
                  setVarListOpen(false);
                }
              }}
              placeholder="Find string or variable... (e.g. bBusy, machineState, TON) [Ctrl+F]"
              aria-label="Find string or variable in method code"
              className="w-full pl-8 pr-12 py-1 text-xs font-mono bg-slate-950 border border-slate-700/80 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50 transition-colors"
            />
            {findQuery && (
              <button
                type="button"
                onClick={() => {
                  setFindQuery('');
                  findInputRef.current?.focus();
                }}
                className="absolute right-6 text-slate-400 hover:text-slate-200 p-0.5 rounded cursor-pointer"
                title="Clear search query (Esc)"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              id="method-editor-find-variables-btn"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                // The whole list, whatever is typed
                setVarListFilter('');
                setVarListActive(-1);
                setVarListOpen((o) => !o);
                findInputRef.current?.focus();
              }}
              disabled={searchVariables.length === 0}
              className="absolute right-1 p-0.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
              title={`Variables (${searchVariables.length}): pick one to find it (Alt+Down)`}
              aria-label="Show variables"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${varListOpen ? 'rotate-180' : ''}`} />
            </button>
            {varListOpen && (
              <div
                ref={varListRef}
                id="method-editor-find-variables"
                role="listbox"
                aria-label="Variables"
                className="absolute left-0 top-full mt-1 z-50 w-full min-w-[320px] max-h-72 overflow-y-auto custom-scrollbar bg-slate-900 border border-slate-700 rounded-lg shadow-2xl py-1 text-xs"
              >
                {shownVariables.length === 0 ? (
                  <div className="px-3 py-2 text-slate-500">No variable contains "{varListFilter.trim()}": Enter finds the text</div>
                ) : (
                  VARIABLE_GROUPS.map((g) => {
                    const items = shownVariables.map((v, i) => ({ v, i })).filter((x) => x.v.source === g.source);
                    if (items.length === 0) return null;
                    return (
                      <div key={g.source} role="group" aria-label={g.label}>
                        <div className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider font-semibold text-slate-500 flex items-center gap-1">
                          <Tag className="w-2.5 h-2.5" />
                          {g.label}
                        </div>
                        {items.map(({ v, i }) => {
                          const active = i === varListActive;
                          const selected = findQuery.trim().toLowerCase() === v.name.toLowerCase();
                          return (
                            <div
                              key={v.name}
                              id={`find-variable-${i}`}
                              data-var-index={i}
                              role="option"
                              aria-selected={active}
                              onMouseDown={(e) => e.preventDefault()}
                              onMouseEnter={() => setVarListActive(i)}
                              onClick={() => chooseVariable(v.name)}
                              className={`find-variable-option flex items-center gap-2 px-3 py-1 cursor-pointer font-mono ${
                                active ? 'bg-sky-700/60 text-white' : 'text-slate-200 hover:bg-slate-800'
                              }`}
                              title={`Find ${v.name}${v.type ? ` : ${v.type}` : ''}`}
                            >
                              <span className={`truncate ${selected ? 'text-amber-300 font-bold' : ''}`}>{v.name}</span>
                              {v.type && <span className="truncate text-[10px] text-slate-500">{v.type}</span>}
                              <span
                                className={`ml-auto shrink-0 text-[10px] px-1.5 rounded-full ${v.uses ? 'bg-slate-800 text-slate-300' : 'text-slate-600'}`}
                                title={`${v.uses} use(s) in this method's code`}
                              >
                                {v.uses}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Match Count Badge */}
          {findQuery.trim() ? (
            <div
              className={`px-2 py-0.5 rounded text-[11px] font-mono shrink-0 flex items-center gap-1 border ${
                allMatches.length > 0
                  ? 'bg-sky-950/80 border-sky-700/80 text-sky-300 font-semibold'
                  : 'bg-rose-950/70 border-rose-800/70 text-rose-300'
              }`}
              title={`${declMatches.length} match(es) in declaration, ${implMatches.length} in implementation`}
            >
              {allMatches.length > 0 ? (
                <>
                  <span>
                    {activeGlobalMatchIndex + 1} of {allMatches.length}
                  </span>
                  <span className="text-[9px] text-sky-400/80 font-normal hidden sm:inline">
                    ({currentActiveMatch?.target === 'declaration' ? 'decl' : 'impl'}:L{currentActiveMatch?.originalLineNumber})
                  </span>
                </>
              ) : (
                <span>No matches</span>
              )}
            </div>
          ) : null}

          {/* Prev / Next Match Navigation */}
          <div className="flex items-center bg-slate-950 rounded border border-slate-700/70 p-0.5 shrink-0">
            <button
              type="button"
              id="find-prev-match-btn"
              onClick={handlePrevMatch}
              disabled={allMatches.length === 0}
              className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
              title="Previous match (Shift+Enter)"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              id="find-next-match-btn"
              onClick={handleNextMatch}
              disabled={allMatches.length === 0}
              className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
              title="Next match (Enter)"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Match Options: Case Sensitive & Whole Word */}
          <div className="flex items-center bg-slate-950 rounded border border-slate-700/70 p-0.5 shrink-0">
            <button
              type="button"
              id="find-match-case-btn"
              onClick={() => setFindOptions((prev) => ({ ...prev, matchCase: !prev.matchCase }))}
              className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded transition-colors cursor-pointer ${
                findOptions.matchCase
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
              title={findOptions.matchCase ? 'Match Case (Active)' : 'Match Case'}
            >
              Aa
            </button>
            <button
              type="button"
              id="find-whole-word-btn"
              onClick={() => setFindOptions((prev) => ({ ...prev, wholeWord: !prev.wholeWord }))}
              className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded transition-colors cursor-pointer ${
                findOptions.wholeWord
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
              title={findOptions.wholeWord ? 'Match Whole Word (Active)' : 'Match Whole Word (\\b)'}
            >
              \b
            </button>
          </div>

          {/* Window Scope Selector */}
          <div className="flex items-center gap-1 shrink-0">
            <select
              id="find-window-scope-select"
              aria-label="Find Scope Window"
              value={findScope}
              onChange={(e) => {
                setFindScope(e.target.value as 'both' | 'implementation' | 'declaration');
                setActiveGlobalMatchIndex(0);
              }}
              className="bg-slate-950 border border-slate-700/80 rounded px-1.5 py-1 text-[11px] font-medium text-slate-300 outline-none cursor-pointer hover:border-slate-600 focus:border-sky-500"
              title="Choose which code windows to search in"
            >
              <option value="both">Both Windows</option>
              <option value="implementation">Implementation Only</option>
              <option value="declaration">Declaration Only</option>
            </select>
          </div>
        </div>

      </div>

      {/* Status banner */}
      {saveStatus.message && (
        <div
          className={`px-3.5 py-1.5 text-xs flex items-center gap-2 border-b shrink-0 ${
            saveStatus.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-800/80 text-emerald-300'
              : 'bg-rose-950/80 border-rose-800/80 text-rose-300'
          }`}
        >
          {saveStatus.type === 'success' ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="font-medium flex-1">{saveStatus.message}</span>
          <button
            type="button"
            onClick={() => setSaveStatus({ type: 'idle' })}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Resizable Panels Container: TwinCAT XAE Look & Feel (Headers Hidden, Only Horizontal Splitter Bar Shown) */}
      <div
        ref={splitContainerRef}
        id="method-split-panels-container"
        onWheel={(e) => e.stopPropagation()}
        className="flex-1 min-h-0 flex flex-col overflow-hidden bg-slate-950 relative"
      >
        {/* Top Panel: Method / POU Declaration (<Declaration>) */}
        {showDeclaration && (
          <div
            id="method-top-panel"
            style={{ height: `calc(${splitRatio * 100}% - 4px)` }}
            onWheel={(e) => e.stopPropagation()}
            className="flex flex-col bg-slate-950 shrink-0 min-h-[40px] overflow-hidden border-b border-slate-800"
          >
            {/* Declaration Toolbar / Scope Switcher */}
            <div className="flex items-center justify-between px-3 py-1 bg-slate-900 border-b border-slate-800 text-xs shrink-0 select-none gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 min-w-0">
                <FileCode2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="text-[10px] text-slate-400 font-semibold font-mono uppercase tracking-wider">
                  Top Panel:
                </span>
                <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setDeclTab('method');
                      setDeclHighlightedLine(null);
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer ${
                      declTab === 'method'
                        ? 'bg-sky-950 text-sky-300 border border-sky-600/70 font-semibold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title={`Method ${cleanMethodName}() Local Declaration (VAR_INPUT, VAR, VAR_INST)`}
                  >
                    Method ({cleanMethodName})
                  </button>
                  {pouDeclaration && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeclTab('pou');
                        setDeclHighlightedLine(null);
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer ${
                        declTab === 'pou'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-600/70 font-semibold shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title={`POU ${pouMetadata.pouName} Member Declaration (VAR_INPUT, VAR_OUTPUT, VAR)`}
                    >
                      POU ({pouMetadata.pouName})
                    </button>
                  )}
                </div>
              </div>

              {declHighlightedLine !== null && (
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-sky-300 bg-sky-950/90 border border-sky-600/80 px-2 py-0.5 rounded-full shadow-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
                  <span>Definition at line {declHighlightedLine}</span>
                  <button
                    type="button"
                    onClick={() => setDeclHighlightedLine(null)}
                    className="text-slate-400 hover:text-white ml-0.5 cursor-pointer"
                    title="Dismiss definition highlight"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            {/* Syntax-Highlighted Declaration Editor Area */}
            <StructuredTextCodeEditor
              ref={declEditorRef}
              id="method-declaration-editor"
              value={declTab === 'pou' ? pouDeclaration : declaration}
              onChange={declTab === 'pou' ? setPouDeclaration : setDeclaration}
              onKeyDown={handleEditorKeyDown}
              onContextMenu={handleDeclContextMenu}
              highlightedLine={declHighlightedLine}
              scrollToLine={declScrollToLine}
              placeholder={
                declTab === 'pou'
                  ? `FUNCTION_BLOCK ${pouMetadata.pouName}\nVAR_INPUT\nEND_VAR`
                  : `METHOD ${cleanMethodName}\nVAR_INPUT\nEND_VAR`
              }
              ariaLabel={
                declTab === 'pou'
                  ? `${pouMetadata.pouName} POU Declaration Structured Text`
                  : `${cleanMethodName} Declaration Structured Text`
              }
              findQuery={findScope !== 'implementation' ? findQuery : ''}
              findOptions={findOptions}
              activeFindMatchIndex={activeDeclMatchIndex}
              className="flex-1"
            />
          </div>
        )}

        {/* Draggable Splitter Divider - TwinCAT XAE style clean horizontal splitter bar */}
        {showDeclaration && (
          <div
            id="method-panel-splitter"
            onMouseDown={handleSplitterMouseDown}
            onTouchStart={handleSplitterTouchStart}
            onWheel={(e) => e.stopPropagation()}
            className={`h-2.5 w-full bg-slate-900 hover:bg-sky-600/80 cursor-row-resize flex items-center justify-center transition-colors select-none z-10 border-y border-slate-800/90 group ${
              isDraggingSplitter ? 'bg-sky-600 ring-1 ring-sky-400' : ''
            }`}
            title="Drag to resize Top (Declaration) and Bottom (Implementation) panels"
          >
            <div className="w-12 h-1 rounded-full bg-slate-600 group-hover:bg-sky-200 transition-colors" />
          </div>
        )}

        {/* Bottom Panel: Method Implementation (<Implementation><ST>) - Default 80%, pure code pane with code folding controls */}
        <div
          id="method-bottom-panel"
          style={{
            height: showDeclaration ? `calc(${(1 - splitRatio) * 100}% - 4px)` : '100%',
          }}
          onWheel={(e) => e.stopPropagation()}
          className="relative flex-1 flex flex-col min-h-0 bg-slate-950 overflow-hidden"
        >
          {/* Implementation Section Header & Code Folding Toolbar */}
          <div
            id="method-implementation-toolbar"
            className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-xs shrink-0 select-none gap-2 flex-wrap"
          >
            {/* Left: Section Label & Fold Status Badge */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                <Code2 className="w-3.5 h-3.5 text-sky-400" />
                <span className="text-[11px] font-mono">Implementation</span>
              </div>

              {foldedBlockIds.size > 0 ? (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-950/70 border border-amber-700/60 text-amber-300 text-[10px] font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block animate-pulse" />
                  <span>{foldedBlockIds.size} block{foldedBlockIds.size > 1 ? 's' : ''} folded</span>
                  <button
                    type="button"
                    onClick={handleUnfoldAll}
                    className="ml-0.5 text-amber-200 hover:text-white underline underline-offset-2 hover:no-underline font-sans cursor-pointer"
                    title="Expand all collapsed code blocks"
                  >
                    Expand All
                  </button>
                </div>
              ) : (
                <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
                  ({foldableBlocks.length} foldable block{foldableBlocks.length !== 1 ? 's' : ''})
                </span>
              )}
            </div>

            {/* Center / Right: State Jump Navigator & Code Folding Action Buttons */}
            <div className="flex items-center gap-1.5 ml-auto">
              {/* Quick Jump to State Dropdown (if CASE branches found) */}
              {caseBranches.length > 0 && (
                <div className="flex items-center gap-1">
                  <select
                    id="jump-to-case-state-select"
                    aria-label="Jump to State Case"
                    onChange={(e) => {
                      const blk = caseBranches.find((b) => b.id === e.target.value);
                      if (blk) handleJumpToCaseBranch(blk);
                    }}
                    defaultValue=""
                    className="bg-slate-950 border border-slate-700 hover:border-slate-600 focus:border-sky-500 rounded px-2 py-0.5 text-[11px] font-mono text-slate-300 outline-none cursor-pointer max-w-[160px] sm:max-w-[200px]"
                    title="Jump directly to a state case in this method"
                  >
                    <option value="" disabled>
                      Jump to State Case...
                    </option>
                    {caseBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Fold Actions Button Group */}
              <div className="flex items-center bg-slate-950 rounded-lg p-0.5 border border-slate-800">
                {caseBranches.length > 0 && (
                  <button
                    type="button"
                    id="fold-cases-btn"
                    onClick={handleFoldAllCases}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition-colors cursor-pointer"
                    title="Collapse all state case branches (ideal for high-level state machine navigation)"
                  >
                    <ListCollapse className="w-3 h-3 text-amber-400" />
                    <span className="hidden md:inline">Fold Cases</span>
                  </button>
                )}

                <button
                  type="button"
                  id="fold-ifs-btn"
                  onClick={handleFoldAllIfs}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Collapse all IF/ELSE conditional blocks"
                >
                  <Code2 className="w-3 h-3 text-sky-400" />
                  <span className="hidden md:inline">Fold IFs</span>
                </button>

                <button
                  type="button"
                  id="fold-all-btn"
                  onClick={handleFoldAll}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Collapse all structured text blocks (CASE statements, IF structures, loops)"
                >
                  <FoldVertical className="w-3 h-3 text-slate-400" />
                  <span className="hidden lg:inline">Fold All</span>
                </button>

                <button
                  type="button"
                  id="unfold-all-btn"
                  onClick={handleUnfoldAll}
                  disabled={foldedBlockIds.size === 0}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
                  title="Expand all collapsed blocks back to full view"
                >
                  <UnfoldVertical className="w-3 h-3 text-emerald-400" />
                  <span className="hidden lg:inline">Unfold All</span>
                </button>
              </div>
            </div>
          </div>

          {/* Syntax-Highlighted Implementation Editor Area with Code Folding & Find Highlighting */}
          <StructuredTextCodeEditor
            ref={implEditorRef}
            id="method-implementation-editor"
            value={code}
            onChange={setCode}
            onKeyDown={handleEditorKeyDown}
            onContextMenu={handleImplContextMenu}
            highlightedLine={highlightedCaseLine}
            liveLine={liveCaseLine}
            scrollToLine={scrollToLine}
            placeholder={`// Structured Text implementation for ${cleanMethodName}()\n`}
            ariaLabel={`${cleanMethodName} Implementation Structured Text`}
            enableCodeFolding={true}
            foldedBlockIds={foldedBlockIds}
            onToggleFold={handleToggleFold}
            foldableBlocks={foldableBlocks}
            findQuery={findScope !== 'declaration' ? findQuery : ''}
            findOptions={findOptions}
            activeFindMatchIndex={activeImplMatchIndex}
            className="flex-1"
          />

          {/* "Jumped to case" toast for jumps made in the editor; floats over the code so nothing shifts */}
          {scrollNotification && (
            <div
              id="method-jump-toast"
              role="status"
              className="absolute bottom-3 right-4 z-20 pointer-events-none max-w-[80%] truncate px-2.5 py-1 rounded-md bg-slate-900/95 border border-sky-700/70 text-[11px] font-mono text-sky-300 shadow-lg animate-in fade-in duration-200"
            >
              {scrollNotification}
            </div>
          )}
        </div>
      </div>

      {/* Editor Footer / Action Bar */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-slate-950 border-t border-slate-800 text-xs shrink-0">
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-amber-400 flex items-center gap-1 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block animate-pulse" />
              Unsaved changes in {cleanMethodName}()
            </span>
          )}
          {!isDirty && (
            <span className="text-slate-400 font-mono text-[11px]">
              Saved to {tcPouFileName}
            </span>
          )}
          {currentTransitions.length > 0 && (
            <span className="text-[11px] text-sky-400 font-mono hidden sm:inline">
              • {currentTransitions.length} detected transition(s)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            id="method-reset-btn"
            onClick={handleReset}
            disabled={!isDirty}
            className="flex items-center gap-1 px-2.5 py-1 text-slate-400 hover:text-slate-200 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-slate-900 rounded-lg border border-slate-700 transition-colors text-xs font-medium"
            title="Discard current edits and reload"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>

          <button
            type="button"
            id="method-save-btn"
            onClick={handleSave}
            disabled={!isDirty}
            className={`flex items-center gap-1.5 px-3 py-1 text-white rounded-lg transition-all text-xs font-semibold shadow-sm ${
              isDirty
                ? 'bg-sky-600 hover:bg-sky-500 ring-1 ring-sky-400/40'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 cursor-default opacity-60'
            }`}
            title="Save method declaration and implementation to .TcPOU (Ctrl+S)"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save to POU</span>
          </button>
        </div>
      </div>

      {/* Right-Click Context Menu for Go to Definition, Find References, Copy */}
      {contextMenu && (
        <MethodEditorContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          targetSymbol={contextMenu.symbol}
          targetMemberOf={contextMenu.memberOf}
          onGoToDefinition={handleGoToDefinition}
          onFindReferences={(sym) => {
            setFindQuery(sym);
            setFindScope('both');
            findInputRef.current?.focus();
            findInputRef.current?.select();
          }}
          onCopySymbol={(sym) => {
            navigator.clipboard.writeText(sym).catch(() => {});
          }}
          onToggleFoldCurrent={() => {
            if (contextMenu.sourceScope === 'implementation' && foldableBlocks.length > 0) {
              const firstFoldable = foldableBlocks[0];
              if (firstFoldable) handleToggleFold(firstFoldable.id);
            }
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );

  // When Fullscreen is requested, render via Portal to document.body so it's never clipped by parent overflow or transforms
  if (isExpanded) {
    return createPortal(
      <div
        id="method-editor-fullscreen-overlay"
        onWheel={(e) => e.stopPropagation()}
        className="fixed inset-0 z-[99999] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150"
      >
        <div
          id="method-editor-panel"
          onWheel={(e) => e.stopPropagation()}
          className="w-full h-full max-w-[98vw] max-h-[96vh] flex flex-col bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
        >
          {editorInnerContent}
        </div>
      </div>,
      document.body
    );
  }

  if (isModal) {
    return createPortal(
      <div
        id="method-editor-popup-window"
        onWheel={(e) => e.stopPropagation()}
        style={containerStyle}
        className={`flex flex-col bg-slate-900 border border-slate-700/90 shadow-2xl backdrop-blur-md overflow-hidden text-slate-200 transition-all ${
          modalIsDocked
            ? 'rounded-none border-r-0 border-y-0 max-w-none'
            : modalIsMaximized
            ? 'rounded-none'
            : 'rounded-xl max-w-[calc(100vw-20px)]'
        }`}
      >
        <DockableResizeHandles
          isDocked={modalIsDocked}
          isMaximized={modalIsMaximized}
          onStartResize={startResize}
        />
        {editorInnerContent}
      </div>,
      document.body
    );
  }

  return (
    <div
      id="method-editor-panel"
      onWheel={(e) => e.stopPropagation()}
      className="w-full flex-1 min-h-0 flex flex-col bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden"
    >
      {editorInnerContent}
    </div>
  );
};
