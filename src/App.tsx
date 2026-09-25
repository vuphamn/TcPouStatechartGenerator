import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  Download,
  Copy,
  ExternalLink,
  Check,
  RotateCcw,
  Sparkles,
  Settings2,
  CheckCircle2,
  AlertTriangle,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Code2,
  Lock,
  Unlock,
  Printer,
  Loader2,
  ChevronDown,
  FileImage,
  FileCode,
  X,
  Activity,
  TrendingUp,
  History,
  FileSpreadsheet,
  Bookmark,
  Workflow,
  BookOpen,
  FileText,
  Search,
  Map as MapIcon,
  PanelRightClose,
  PanelRightOpen,
  ChartColumn,
  Flame,
  Layers,
  StickyNote,
} from 'lucide-react';
import { generateStatechart, PriorityFormat } from './generator.ts';
import {
  MermaidViewer,
  MermaidViewerHandle,
  LayoutEngine,
  FlowchartCurve,
  MermaidTheme,
  DockedCanvasPanels,
  DockedCanvasPanelId,
} from './components/MermaidViewer.tsx';
import { MermaidMarkdownViewer } from './components/MermaidMarkdownViewer.tsx';
import { PouComplexityReportTab } from './components/PouComplexityReportTab.tsx';
import { TransitionFrequencyTab } from './components/TransitionFrequencyTab.tsx';
import { TransitionHistoryTab } from './components/TransitionHistoryTab.tsx';
import { PlcTransitionLoggerSidebarCard } from './components/PlcTransitionLoggerSidebarCard.tsx';
import { PlcTransitionLoggerTool } from './components/PlcTransitionLoggerTool.tsx';
import { TransitionHistoryDataset } from './utils/transitionHistoryAnalytics.ts';
import { SourceFilesHeaderItem, DutSearchStatus } from './components/SourceFilesHeaderItem.tsx';
import { rankDutCandidates, DutCandidate, DutMatch } from './utils/dutMatcher.ts';
import {
  browseForPou,
  readDroppedPou,
  findDutCandidates,
  chooseDutFiles,
  isDesktopApp,
  canPickFolder,
  PouSource,
} from './utils/sourceFileAccess.ts';
import { isXaeHost, onHostMessage, postToHost } from './utils/xaeHost.ts';
import { IdentifiedStatesSidebarSection } from './components/IdentifiedStatesSidebarSection.tsx';
import { StateNodeStyleInspector, InspectorPanelMode } from './components/StateNodeStyleInspector.tsx';
import { DockPanelView, DockTabMeta } from './components/dock/DockPanelView.tsx';
import { DockSplitter } from './components/dock/DockSplitter.tsx';
import { useDockHostRegistry } from './components/dock/DockHost.tsx';
import { WindowMenuButton } from './components/dock/WindowMenuButton.tsx';
import {
  DOCK_TAB_ORDER,
  DockTabId,
  LEFT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
  activateDockTab,
  closeDockTab,
  isDockTabOpen,
  isDockTabVisible,
  loadDockLayout,
  revealDockTab,
  saveDockLayout,
} from './utils/dockLayout.ts';
import { HeaderHiddenControls, HeaderItemId } from './components/HeaderHiddenControls.tsx';
import { useToolbarOverflow } from './hooks/useToolbarOverflow.ts';
import { extractIdentifiedStatesFromPou } from './utils/pouStateExtractor.ts';
import { generatePouComplexityReport } from './utils/pouComplexityReport.ts';
import { extractEdgesFromMermaid } from './utils/diagramNotes.ts';
import { SAMPLES, SampleItem } from './samples/samplesData.ts';
import { getMermaidLiveUrl } from './utils/mermaidLive.ts';
import { CustomNodeStylesMap, NodeDisplayProperties, DiagramNotes, ContextMenuTarget, NotePosition, DiagramPreset, PresetExportSettings, CustomEdgeStylesMap, EdgeDisplayProperties } from './types.ts';
import { DiagramPresetManager } from './components/DiagramPresetManager.tsx';
import {
  DiagramOptionsState,
  describeExportSettings,
  getPresetExportSettings,
  loadActivePresetId,
  loadUserPresets,
  BUILTIN_PRESETS,
} from './utils/diagramPresets.ts';
import { applyCustomStylesToMermaid } from './utils/nodeStyles.ts';
import { applyNotesToMermaid } from './utils/diagramNotes.ts';
import { NodeOffsetsMap } from './utils/nodeDragger.ts';
import {
  CanvasNodePositionsMap,
  extractCanvasNodePositions,
  appendCanvasPositionsToMermaid,
} from './utils/canvasPositions.ts';
import { copyTextToClipboard } from './utils/diagramExport.ts';
import { exportDiagramVisibleAreaToPdf } from './utils/printToPdf.ts';
import { updateStateCodeInPou, updatePreProcessCodeInPou, updateMethodCodeInPou } from './utils/pouStateEditor.ts';

export const App: React.FC = () => {
  // Active sample or custom state
  const [selectedSampleId, setSelectedSampleId] = useState<string>(SAMPLES[0].id);

  // Input states
  const [dutFileName, setDutFileName] = useState<string>(SAMPLES[0].dutName);
  const [dutContent, setDutContent] = useState<string>(SAMPLES[0].dutContent);
  const [pouFileName, setPouFileName] = useState<string>(SAMPLES[0].pouName);
  const [pouContent, setPouContent] = useState<string>(SAMPLES[0].pouContent);
  // Loaded .TcPOU (full path on desktop) and the .TcDUT enums found for it in its folder tree
  const [pouPath, setPouPath] = useState<string | undefined>(undefined);
  const [dutMatches, setDutMatches] = useState<DutMatch[] | null>(null);
  const [dutRelativePath, setDutRelativePath] = useState<string | undefined>(undefined);
  const [dutStatus, setDutStatus] = useState<DutSearchStatus>('sample');
  // Full path of the chosen .TcDUT (desktop / XAE extension)
  const [dutPath, setDutPath] = useState<string | undefined>(undefined);
  // Inside the TwinCAT XAE extension: file content as last loaded from / saved to the project, per path
  const [hostSavedContent, setHostSavedContent] = useState<Record<string, string>>({});

  // Configuration options matching C# LauncherForm & active User/Builtin Preset
  const initialPreset = useMemo(() => {
    try {
      const activeId = loadActivePresetId();
      const allPresets = [...loadUserPresets(), ...BUILTIN_PRESETS];
      return allPresets.find((p) => p.id === activeId) || BUILTIN_PRESETS[0];
    } catch {
      return BUILTIN_PRESETS[0];
    }
  }, []);

  const [flowchartOutput, setFlowchartOutput] = useState<boolean>(SAMPLES[0].defaultFlowchart);
  const [collapseErrorSinkEdges, setCollapseErrorSinkEdges] = useState<boolean>(true);
  const [includeStateDescriptions, setIncludeStateDescriptions] = useState<boolean>(
    SAMPLES[0].defaultIncludeDescriptions
  );
  const [showTransitionPriorities, setShowTransitionPriorities] = useState<boolean>(true);
  const [priorityFormat, setPriorityFormat] = useState<PriorityFormat>(initialPreset.priorityFormat);
  const [layoutEngine, setLayoutEngine] = useState<LayoutEngine>(initialPreset.layoutEngine);
  const [flowchartCurve, setFlowchartCurve] = useState<FlowchartCurve>(initialPreset.flowchartCurve);
  const [mermaidTheme, setMermaidTheme] = useState<MermaidTheme>(initialPreset.mermaidTheme);
  const [liveUpdate, setLiveUpdate] = useState<boolean>(true);
  const [exportSettings, setExportSettings] = useState<PresetExportSettings>(() =>
    getPresetExportSettings(initialPreset)
  );

  // Grouped diagram options state for preset matching and manager
  const currentDiagramOptions: DiagramOptionsState = useMemo(
    () => ({
      layoutEngine,
      flowchartCurve,
      mermaidTheme,
      priorityFormat,
      exportSettings,
    }),
    [layoutEngine, flowchartCurve, mermaidTheme, priorityFormat, exportSettings]
  );

  const handleApplyPreset = useCallback((preset: DiagramPreset) => {
    setLayoutEngine(preset.layoutEngine);
    setFlowchartCurve(preset.flowchartCurve);
    setMermaidTheme(preset.mermaidTheme);
    setPriorityFormat(preset.priorityFormat);
    setExportSettings(getPresetExportSettings(preset));
  }, []);

  // Lock diagram layout toggle: disables automatic re-layout triggered by edits, preserving custom node positions
  const [lockDiagramLayout, setLockDiagramLayout] = useState<boolean>(() => {
    try {
      return localStorage.getItem('tc_statechart_lock_diagram_layout') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('tc_statechart_lock_diagram_layout', String(lockDiagramLayout));
    } catch {
      // ignore
    }
  }, [lockDiagramLayout]);

  // Workspace docking layout: LeftPanel (sources), MiddlePanel (documents), RightPanel (tool windows)
  const [dockLayout, setDockLayout] = useState(() => loadDockLayout());
  const dockLayoutRef = useRef(dockLayout);
  dockLayoutRef.current = dockLayout;
  const dockRegistry = useDockHostRegistry();

  useEffect(() => {
    saveDockLayout(dockLayout);
  }, [dockLayout]);

  const showDockTab = useCallback((tabId: DockTabId) => {
    setDockLayout((l) => activateDockTab(l, tabId));
  }, []);

  // Tab contents mount the first time they are shown and unmount when closed (the diagram stays mounted)
  const [shownDockTabs, setShownDockTabs] = useState<Set<DockTabId>>(
    () => new Set(DOCK_TAB_ORDER.filter((t) => isDockTabVisible(dockLayout, t)))
  );
  useEffect(() => {
    const newlyShown = DOCK_TAB_ORDER.filter((t) => isDockTabVisible(dockLayout, t) && !shownDockTabs.has(t));
    if (newlyShown.length > 0) setShownDockTabs((prev) => new Set([...prev, ...newlyShown]));
  }, [dockLayout, shownDockTabs]);
  const isDockTabMounted = (tabId: DockTabId) => isDockTabOpen(dockLayout, tabId) && shownDockTabs.has(tabId);

  /** Runs an action that needs the diagram canvas on screen, showing the Diagram Canvas tab first if needed */
  const runWithDiagramVisible = useCallback((action: () => void, delayMs = 50) => {
    if (isDockTabVisible(dockLayoutRef.current, 'diagram')) {
      action();
    } else {
      setDockLayout((l) => activateDockTab(l, 'diagram'));
      setTimeout(action, delayMs);
    }
  }, []);

  const [diagramSearchQuery, setDiagramSearchQuery] = useState<string>('');
  const isSidebarOpen = dockLayout.leftVisible;
  const setIsSidebarOpen = useCallback((open: boolean) => setDockLayout((l) => ({ ...l, leftVisible: open })), []);
  const [copiedMarkdown, setCopiedMarkdown] = useState<boolean>(false);
  const [headerToolbarElement, setHeaderToolbarElement] = useState<HTMLDivElement | null>(null);

  // PLC Transition Logger & Telemetry State
  const [historyDataset, setHistoryDataset] = useState<TransitionHistoryDataset | null>(null);
  const [isPlcLoggerModalOpen, setIsPlcLoggerModalOpen] = useState<boolean>(false);

  // Node display customizations
  const [customNodeStyles, setCustomNodeStyles] = useState<CustomNodeStylesMap>({});
  const [customEdgeStyles, setCustomEdgeStyles] = useState<CustomEdgeStylesMap>({});
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [selectedStateLabel, setSelectedStateLabel] = useState<string>('');
  // Last selected state: the Method Editor, Style & Documentation tabs stay on it when the
  // canvas selection is cleared (background click / Esc) instead of jumping to the first state
  const [lastSelectedState, setLastSelectedState] = useState<{ id: string; label: string } | null>(null);
  useEffect(() => {
    if (selectedStateId) setLastSelectedState({ id: selectedStateId, label: selectedStateLabel || selectedStateId });
  }, [selectedStateId, selectedStateLabel]);

  // Inspector tabs: Method Editor & Enum Editor (MiddlePanel), Style & Documentation (RightPanel)
  const [inspectorRequest, setInspectorRequest] = useState<{ method: string; enumMember?: string }>({
    method: 'doState()',
  });

  const handleOpenMethodEditorModal = useCallback((methodName: string = 'doState()') => {
    setInspectorRequest((prev) => ({ ...prev, method: methodName }));
    setDockLayout((l) => activateDockTab(l, 'method'));
  }, []);

  const handleOpenEnumEditorModal = useCallback((memberName?: string) => {
    setInspectorRequest((prev) => ({ ...prev, enumMember: memberName || selectedStateId || undefined }));
    setDockLayout((l) => activateDockTab(l, 'enum'));
  }, [selectedStateId]);

  const handleOpenInspectorPanel = useCallback(
    (mode: InspectorPanelMode, options?: { method?: string; reveal?: boolean }) => {
      if (mode === 'enum') return handleOpenEnumEditorModal();
      if (mode === 'method') {
        if (options?.method) setInspectorRequest((prev) => ({ ...prev, method: options.method! }));
        // Selecting a node opens the Method Editor without hiding the canvas when both share a tab group
        setDockLayout((l) =>
          options?.reveal === false ? revealDockTab(l, 'method', 'diagram') : activateDockTab(l, 'method')
        );
        return;
      }
      // State style is a window on the canvas (opened by the diagram itself), not a dock tab
      if (mode === 'style') return;
      setDockLayout((l) => activateDockTab(l, mode));
    },
    [handleOpenEnumEditorModal]
  );

  // Diagram notes and state documentation state with localStorage persistence
  const [diagramNotes, setDiagramNotes] = useState<DiagramNotes>(() => {
    try {
      const stored = localStorage.getItem('tc_statechart_diagram_notes_metadata');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object' && parsed.nodes) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return {
      nodes: {},
      edges: {},
    };
  });

  // Sync diagram notes and state documentation changes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('tc_statechart_diagram_notes_metadata', JSON.stringify(diagramNotes));
    } catch {
      // ignore
    }
  }, [diagramNotes]);

  // Node drag offsets and canvas extracted positions
  const [nodeOffsets, setNodeOffsets] = useState<NodeOffsetsMap>({});
  const [canvasPositions, setCanvasPositions] = useState<CanvasNodePositionsMap>({});

  // Mermaid viewer reference and jump focus request
  const mermaidViewerRef = useRef<MermaidViewerHandle>(null);
  const [jumpRequest, setJumpRequest] = useState<{ stateId: string; timestamp: number } | null>(null);

  // Extract all identified states and their transitions from .TcPOU and optional .TcDUT
  const identifiedStatesResult = useMemo(() => {
    return extractIdentifiedStatesFromPou(pouContent, dutContent);
  }, [pouContent, dutContent]);

  // Jump to state from sidebar list
  const handleJumpToState = useCallback((stateId: string, label?: string) => {
    setDockLayout((l) => activateDockTab(l, 'diagram'));
    setSelectedStateId(stateId);
    if (label) {
      setSelectedStateLabel(label);
    }
    const ts = Date.now();
    setJumpRequest({ stateId, timestamp: ts });
    if (mermaidViewerRef.current) {
      mermaidViewerRef.current.panToState(stateId, ts);
    }
  }, []);

  // Raw generated Mermaid Markdown
  const [rawMarkdown, setRawMarkdown] = useState<string>('');
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationStats, setGenerationStats] = useState<{
    statesCount: number;
    linesCount: number;
    timeMs: number;
  } | null>(null);

  // Core generation logic
  const handleGenerate = useCallback(() => {
    if (!dutContent.trim() && !pouContent.trim()) {
      setRawMarkdown('');
      setGenerationError('Please provide both .TcDUT and .TcPOU content.');
      setGenerationStats(null);
      return;
    }

    try {
      const startTime = performance.now();
      setGenerationError(null);
      const result = generateStatechart(dutContent, pouContent, {
        flowchartOutput,
        collapseErrorSinkEdges,
        includeStateDescriptions,
        showTransitionPriorities,
        priorityFormat,
      });

      const elapsed = Math.round(performance.now() - startTime);
      setRawMarkdown(result);

      // Simple stats extraction
      const lines = result.split('\n');
      const stateMatches = result.match(/-->/g) || [];
      setGenerationStats({
        statesCount: stateMatches.length,
        linesCount: lines.length,
        timeMs: elapsed,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setGenerationError(msg);
      setRawMarkdown('');
      setGenerationStats(null);
    }
  }, [
    dutContent,
    pouContent,
    flowchartOutput,
    collapseErrorSinkEdges,
    includeStateDescriptions,
    showTransitionPriorities,
    priorityFormat,
  ]);

  // Apply custom node styles for live diagram canvas display
  const styledMarkdown = useMemo(() => {
    return applyCustomStylesToMermaid(rawMarkdown, customNodeStyles);
  }, [rawMarkdown, customNodeStyles]);

  // Apply diagram notes and canvas positions metadata to Mermaid markdown
  const outputMarkdown = useMemo(() => {
    const withNotes = applyNotesToMermaid(styledMarkdown, diagramNotes);
    return appendCanvasPositionsToMermaid(withNotes, canvasPositions, {
      layoutEngine,
      flowchartCurve,
      theme: mermaidTheme,
    });
  }, [styledMarkdown, diagramNotes, canvasPositions, layoutEngine, flowchartCurve, mermaidTheme]);

  // Extract edges for complexity analysis
  const availableEdges = useMemo(() => {
    return extractEdgesFromMermaid(outputMarkdown);
  }, [outputMarkdown]);

  // Comprehensive POU Cyclomatic Complexity & Transition Density Report
  const pouComplexityReport = useMemo(() => {
    return generatePouComplexityReport(
      identifiedStatesResult,
      availableEdges,
      pouFileName.replace(/\.TcPOU$/i, '') || 'Statechart POU'
    );
  }, [identifiedStatesResult, availableEdges, pouFileName]);

  const handleStyleChange = useCallback((stateId: string, style: NodeDisplayProperties) => {
    setCustomNodeStyles((prev) => ({
      ...prev,
      [stateId]: style,
    }));
  }, []);

  const handleResetStateStyle = useCallback((stateId: string) => {
    setCustomNodeStyles((prev) => {
      const next = { ...prev };
      delete next[stateId];
      return next;
    });
  }, []);

  const handleClearAllCustomStyles = useCallback(() => {
    setCustomNodeStyles({});
  }, []);

  const handleEdgeStyleChange = useCallback((edgeId: string, style: EdgeDisplayProperties | null) => {
    setCustomEdgeStyles((prev) => {
      const next = { ...prev };
      if (style) next[edgeId] = style;
      else delete next[edgeId];
      return next;
    });
  }, []);

  const handleSaveNote = useCallback((target: ContextMenuTarget, text: string) => {
    setDiagramNotes((prev) => {
      const trimmed = text.trim();
      if (target.type === 'node') {
        const nextNodes = { ...prev.nodes };
        if (trimmed) {
          nextNodes[target.id] = trimmed;
        } else {
          delete nextNodes[target.id];
        }
        return { ...prev, nodes: nextNodes };
      } else if (target.type === 'edge') {
        const canonicalKey =
          target.from && target.to
            ? target.id.includes('#')
              ? target.id
              : `${target.from}->${target.to}`
            : target.id;
        const nextEdges = { ...prev.edges };
        if (trimmed) {
          nextEdges[canonicalKey] = trimmed;
          if (target.id !== canonicalKey) {
            delete nextEdges[target.id];
          }
          if (target.pathId && target.pathId !== canonicalKey) {
            delete nextEdges[target.pathId];
          }
        } else {
          delete nextEdges[canonicalKey];
          delete nextEdges[target.id];
          if (target.pathId) delete nextEdges[target.pathId];
        }
        return { ...prev, edges: nextEdges };
      }
      return prev;
    });
  }, []);

  const handleDeleteNote = useCallback((target: ContextMenuTarget) => {
    if (target.type === 'canvas') return;
    setDiagramNotes((prev) => {
      const nextPositions = { ...(prev.positions || {}) };
      delete nextPositions[target.id];
      if (target.type === 'edge' && target.pathId) {
        delete nextPositions[target.pathId];
      }

      const nextStyles = { ...(prev.styles || {}) };
      delete nextStyles[target.id];
      if (target.type === 'edge' && target.pathId) {
        delete nextStyles[target.pathId];
      }

      if (target.type === 'node') {
        const nextNodes = { ...prev.nodes };
        delete nextNodes[target.id];
        return { ...prev, nodes: nextNodes, positions: nextPositions, styles: nextStyles };
      } else if (target.type === 'edge') {
        const canonicalKey =
          target.from && target.to
            ? target.id.includes('#')
              ? target.id
              : `${target.from}->${target.to}`
            : target.id;
        delete nextPositions[canonicalKey];
        delete nextStyles[canonicalKey];
        const nextEdges = { ...prev.edges };
        delete nextEdges[canonicalKey];
        delete nextEdges[target.id];
        if (target.pathId) delete nextEdges[target.pathId];
        return { ...prev, edges: nextEdges, positions: nextPositions, styles: nextStyles };
      }
      return prev;
    });
  }, []);

  const handleUpdateNotePosition = useCallback((targetId: string, pos: NotePosition) => {
    setDiagramNotes((prev) => ({
      ...prev,
      positions: {
        ...(prev.positions || {}),
        [targetId]: pos,
      },
    }));
  }, []);

  const handleUpdateNoteStyle = useCallback((targetId: string, style: NodeDisplayProperties | null) => {
    setDiagramNotes((prev) => {
      const nextStyles = { ...(prev.styles || {}) };
      if (style === null) {
        delete nextStyles[targetId];
      } else {
        nextStyles[targetId] = style;
      }
      return {
        ...prev,
        styles: nextStyles,
      };
    });
  }, []);

  const handleClearAllNotes = useCallback(() => {
    setDiagramNotes({ nodes: {}, edges: {}, positions: {}, styles: {} });
  }, []);

  const handleSaveStateCode = useCallback(
    (stateId: string, newCode: string) => {
      try {
        const updateResult = updateStateCodeInPou(pouContent, stateId, newCode);
        if (!updateResult.success) {
          return { success: false, error: updateResult.error || 'Failed to update POU' };
        }
        const updatedPou = updateResult.updatedPou;
        // Update pouContent state (this updates left drawer editor and downloaded file)
        setPouContent(updatedPou);

        // Regenerate the diagram and markdown with the updated POU code immediately
        try {
          const startTime = performance.now();
          setGenerationError(null);
          const result = generateStatechart(dutContent, updatedPou, {
            flowchartOutput,
            collapseErrorSinkEdges,
            includeStateDescriptions,
            showTransitionPriorities,
            priorityFormat,
          });

          const elapsed = Math.round(performance.now() - startTime);
          setRawMarkdown(result);

          const lines = result.split('\n');
          const stateMatches = result.match(/-->/g) || [];
          setGenerationStats({
            statesCount: stateMatches.length,
            linesCount: lines.length,
            timeMs: elapsed,
          });
        } catch (genErr: unknown) {
          const msg = genErr instanceof Error ? genErr.message : String(genErr);
          setGenerationError(msg);
        }

        return { success: true };
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Error updating state code',
        };
      }
    },
    [
      pouContent,
      dutContent,
      flowchartOutput,
      collapseErrorSinkEdges,
      includeStateDescriptions,
      showTransitionPriorities,
      priorityFormat,
    ]
  );

  const handleSaveMethodCode = useCallback(
    (methodName: string, newCode: string, newDeclaration?: string) => {
      try {
        const updateResult = updateMethodCodeInPou(pouContent, methodName, newCode, newDeclaration);
        if (!updateResult.success) {
          return { success: false, error: updateResult.error || `Failed to update method ${methodName} in POU` };
        }
        const updatedPou = updateResult.updatedPou;
        // Update pouContent state (this updates left drawer editor, samples, and downloaded files)
        setPouContent(updatedPou);

        // Regenerate the diagram and markdown with the updated POU code immediately
        try {
          const startTime = performance.now();
          setGenerationError(null);
          const result = generateStatechart(dutContent, updatedPou, {
            flowchartOutput,
            collapseErrorSinkEdges,
            includeStateDescriptions,
            showTransitionPriorities,
            priorityFormat,
          });

          const elapsed = Math.round(performance.now() - startTime);
          setRawMarkdown(result);

          const lines = result.split('\n');
          const stateMatches = result.match(/-->/g) || [];
          setGenerationStats({
            statesCount: stateMatches.length,
            linesCount: lines.length,
            timeMs: elapsed,
          });
        } catch (genErr: unknown) {
          const msg = genErr instanceof Error ? genErr.message : String(genErr);
          setGenerationError(msg);
        }

        return { success: true };
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : `Error updating method ${methodName}`,
        };
      }
    },
    [
      pouContent,
      dutContent,
      flowchartOutput,
      collapseErrorSinkEdges,
      includeStateDescriptions,
      showTransitionPriorities,
      priorityFormat,
    ]
  );

  const handleSavePreProcessCode = useCallback(
    (newCode: string, newDeclaration?: string) => {
      try {
        const updateResult = updatePreProcessCodeInPou(pouContent, newCode, newDeclaration);
        if (!updateResult.success) {
          return { success: false, error: updateResult.error || 'Failed to update preProcess method in POU' };
        }
        const updatedPou = updateResult.updatedPou;
        // Update pouContent state (this updates left drawer editor, samples, and downloaded files)
        setPouContent(updatedPou);

        // Regenerate the diagram and markdown with the updated POU code immediately
        try {
          const startTime = performance.now();
          setGenerationError(null);
          const result = generateStatechart(dutContent, updatedPou, {
            flowchartOutput,
            collapseErrorSinkEdges,
            includeStateDescriptions,
            showTransitionPriorities,
            priorityFormat,
          });

          const elapsed = Math.round(performance.now() - startTime);
          setRawMarkdown(result);

          const lines = result.split('\n');
          const stateMatches = result.match(/-->/g) || [];
          setGenerationStats({
            statesCount: stateMatches.length,
            linesCount: lines.length,
            timeMs: elapsed,
          });
        } catch (genErr: unknown) {
          const msg = genErr instanceof Error ? genErr.message : String(genErr);
          setGenerationError(msg);
        }

        return { success: true };
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Error updating preProcess method',
        };
      }
    },
    [
      pouContent,
      dutContent,
      flowchartOutput,
      collapseErrorSinkEdges,
      includeStateDescriptions,
      showTransitionPriorities,
      priorityFormat,
    ]
  );

  const handleSaveDutContent = useCallback(
    (newDutContent: string) => {
      try {
        setDutContent(newDutContent);

        // Regenerate diagram with updated DUT content immediately
        try {
          const startTime = performance.now();
          setGenerationError(null);
          const result = generateStatechart(newDutContent, pouContent, {
            flowchartOutput,
            collapseErrorSinkEdges,
            includeStateDescriptions,
            showTransitionPriorities,
            priorityFormat,
          });

          const elapsed = Math.round(performance.now() - startTime);
          setRawMarkdown(result);

          const lines = result.split('\n');
          const stateMatches = result.match(/-->/g) || [];
          setGenerationStats({
            statesCount: stateMatches.length,
            linesCount: lines.length,
            timeMs: elapsed,
          });
        } catch (genErr: unknown) {
          const msg = genErr instanceof Error ? genErr.message : String(genErr);
          setGenerationError(msg);
        }

        return { success: true };
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Error updating DUT enum content',
        };
      }
    },
    [
      pouContent,
      flowchartOutput,
      collapseErrorSinkEdges,
      includeStateDescriptions,
      showTransitionPriorities,
      priorityFormat,
    ]
  );

  const customizedStatesCount = useMemo(() => {
    return Object.values(customNodeStyles).filter(
      (s) => s.fill || s.color || s.stroke || s.strokeWidth
    ).length;
  }, [customNodeStyles]);

  // Initial & reactive generation
  useEffect(() => {
    if (liveUpdate) {
      handleGenerate();
    }
  }, [handleGenerate, liveUpdate]);

  // Handle sample selection
  const handleSelectSample = (sample: SampleItem) => {
    setSelectedSampleId(sample.id);
    setDutFileName(sample.dutName);
    setDutContent(sample.dutContent);
    setPouFileName(sample.pouName);
    setPouContent(sample.pouContent);
    setFlowchartOutput(sample.defaultFlowchart);
    setIncludeStateDescriptions(sample.defaultIncludeDescriptions);
    setCustomNodeStyles({});
    setCustomEdgeStyles({});
    setDiagramNotes({ nodes: {}, edges: {} });
    setNodeOffsets({});
    setCanvasPositions({});
    setSelectedStateId(null);
    setSelectedStateLabel('');
    setLastSelectedState(null);
    setPouPath(undefined);
    setDutMatches(null);
    setDutRelativePath(undefined);
    setDutPath(undefined);
    setDutStatus('sample');
  };

  // Helper to extract the most up-to-date canvas positions and generate the full exported markdown
  const getLatestFullMarkdown = useCallback(() => {
    const livePositions = extractCanvasNodePositions(
      document.getElementById('mermaid-diagram-svg-container')?.querySelector('svg') ||
      document.getElementById('mermaid-canvas-area')?.querySelector('svg:not(#diagram-snap-grid-svg):not([id*="snap-grid"])') ||
      document.getElementById('mermaid-canvas-area')?.querySelector('svg'),
      nodeOffsets
    );
    const effectivePositions = Object.keys(livePositions).length > 0 ? livePositions : canvasPositions;
    const withNotes = applyNotesToMermaid(styledMarkdown, diagramNotes);
    return appendCanvasPositionsToMermaid(withNotes, effectivePositions, {
      layoutEngine,
      flowchartCurve,
      theme: mermaidTheme,
    });
  }, [nodeOffsets, canvasPositions, styledMarkdown, diagramNotes, layoutEngine, flowchartCurve, mermaidTheme]);

  // Actions
  const [copyToast, setCopyToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const copyToastTimeoutRef = useRef<number | null>(null);

  const showCopyToast = useCallback((message: string, type: 'success' | 'error' = 'success', durationMs = 3200) => {
    if (copyToastTimeoutRef.current) {
      window.clearTimeout(copyToastTimeoutRef.current);
    }
    setCopyToast({ message, type });
    copyToastTimeoutRef.current = window.setTimeout(() => {
      setCopyToast(null);
      copyToastTimeoutRef.current = null;
    }, durationMs);
  }, []);

  // ---------------------------------------------------------------------------
  // Source files: a browsed .TcPOU, and its state enum found among the .TcDUT files in its folder tree
  // ---------------------------------------------------------------------------
  const applyDut = useCallback((dut: { name: string; relativePath: string; content: string; path?: string } | null) => {
    setDutFileName(dut?.name ?? '');
    setDutContent(dut?.content ?? '');
    setDutRelativePath(dut?.relativePath);
    setDutPath(dut?.path);
  }, []);

  /** Picks the enum that declares the most doState() states; `forceFirst` keeps a hand-picked file without a match */
  const applyDutCandidates = useCallback(
    (pou: string, candidates: DutCandidate[], forceFirst = false) => {
      const ranked = rankDutCandidates(pou, candidates);
      setDutMatches(ranked);
      if (ranked.length > 0) {
        applyDut(ranked[0]);
        setDutStatus('found');
        if (ranked.length > 1) {
          showCopyToast(`${ranked.length} .TcDUT files match; using ${ranked[0].relativePath}. Click the enum to choose another.`);
        }
      } else if (forceFirst && candidates.length > 0) {
        applyDut(candidates[0]);
        setDutStatus('found');
        showCopyToast(`${candidates[0].name} declares none of the doState() states`, 'error');
      } else {
        applyDut(null);
        setDutStatus('none');
        showCopyToast(
          candidates.length === 0
            ? 'No .TcDUT files in the .TcPOU folder or its subfolders'
            : `None of the ${candidates.length} .TcDUT files declares the doState() states`,
          'error'
        );
      }
    },
    [showCopyToast, applyDut]
  );

  const applyLoadedPou = useCallback(
    (src: PouSource) => {
      setPouFileName(src.name);
      setPouContent(src.content);
      setPouPath(src.path);
      setSelectedSampleId('');
      if (src.dutCandidates) {
        applyDutCandidates(src.content, src.dutCandidates);
      } else {
        // Web without folder access yet: the header offers "Find .TcDUT..."
        setDutMatches(null);
        applyDut(null);
        setDutStatus('pending');
      }
    },
    [applyDutCandidates, applyDut]
  );

  const handleBrowsePou = useCallback(async () => {
    if (isXaeHost()) {
      postToHost({ type: 'browsePou' });
      return;
    }
    try {
      const src = await browseForPou();
      if (src) applyLoadedPou(src);
    } catch (e) {
      showCopyToast(`Could not open the .TcPOU: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }, [applyLoadedPou, showCopyToast]);

  const handleDropPou = useCallback(
    async (file: File) => {
      applyLoadedPou(await readDroppedPou(file));
    },
    [applyLoadedPou]
  );

  const handleFindDut = useCallback(async () => {
    if (isXaeHost()) {
      postToHost({ type: 'findDut' });
      return;
    }
    try {
      const candidates = await findDutCandidates();
      if (candidates) applyDutCandidates(pouContent, candidates);
    } catch (e) {
      showCopyToast(`Could not search the folder: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }, [applyDutCandidates, pouContent, showCopyToast]);

  const handleChooseDutFiles = useCallback(async () => {
    if (isXaeHost()) {
      postToHost({ type: 'chooseDutFiles' });
      return;
    }
    const candidates = await chooseDutFiles();
    if (candidates) applyDutCandidates(pouContent, candidates, true);
  }, [applyDutCandidates, pouContent]);

  // ---------------------------------------------------------------------------
  // TwinCAT XAE extension: it opens the right-clicked .TcPOU here and saves edits back into the project
  // ---------------------------------------------------------------------------
  const pouContentRef = useRef(pouContent);
  pouContentRef.current = pouContent;
  const pendingHostSaveRef = useRef<{ path: string; content: string }[]>([]);
  const hostHandlersRef = useRef({ applyLoadedPou, applyDutCandidates, showCopyToast });
  hostHandlersRef.current = { applyLoadedPou, applyDutCandidates, showCopyToast };

  useEffect(() => {
    if (!isXaeHost()) return;
    const remember = (files: { path?: string; content: string }[]) =>
      setHostSavedContent((prev) => {
        const next = { ...prev };
        for (const f of files) if (f.path) next[f.path] = f.content;
        return next;
      });
    const off = onHostMessage((m) => {
      const h = hostHandlersRef.current;
      if (m.type === 'loadPou') {
        setHostSavedContent({});
        remember([{ path: m.source.path, content: m.source.content }, ...(m.source.dutCandidates ?? [])]);
        h.applyLoadedPou(m.source);
      } else if (m.type === 'dutCandidates') {
        remember(m.candidates);
        h.applyDutCandidates(pouContentRef.current, m.candidates, m.forceFirst);
      } else if (m.type === 'saveResult') {
        if (m.ok) remember(pendingHostSaveRef.current);
        pendingHostSaveRef.current = [];
        h.showCopyToast(m.message, m.ok ? 'success' : 'error', m.ok ? 4000 : 7000);
      } else if (m.type === 'error') {
        h.showCopyToast(m.message, 'error', 7000);
      }
    });
    postToHost({ type: 'ready' });
    return off;
  }, []);

  /** Edited files that came from the project (a sample or a dropped file cannot be saved back) */
  const hostDirtyFiles = useMemo(() => {
    if (!isXaeHost()) return [];
    const files: { path: string; content: string }[] = [];
    if (pouPath && hostSavedContent[pouPath] !== undefined && hostSavedContent[pouPath] !== pouContent) {
      files.push({ path: pouPath, content: pouContent });
    }
    if (dutPath && hostSavedContent[dutPath] !== undefined && hostSavedContent[dutPath] !== dutContent) {
      files.push({ path: dutPath, content: dutContent });
    }
    return files;
  }, [hostSavedContent, pouPath, pouContent, dutPath, dutContent]);

  const handleSaveToProject = useCallback(() => {
    if (hostDirtyFiles.length === 0) return;
    pendingHostSaveRef.current = hostDirtyFiles;
    postToHost({ type: 'save', files: hostDirtyFiles });
  }, [hostDirtyFiles]);

  useEffect(() => {
    return () => {
      if (copyToastTimeoutRef.current) {
        window.clearTimeout(copyToastTimeoutRef.current);
      }
    };
  }, []);

  const handleCopyMarkdown = () => {
    const md = getLatestFullMarkdown() || outputMarkdown;
    if (!md) return;
    copyTextToClipboard(md)
      .then((ok) => {
        if (ok) {
          setCopiedMarkdown(true);
          setTimeout(() => setCopiedMarkdown(false), 2000);
          showCopyToast('Mermaid diagram markdown copied to clipboard!', 'success');
        } else {
          showCopyToast('Failed to copy diagram markdown to clipboard', 'error');
        }
      })
      .catch((err) => {
        console.error('Error copying markdown:', err);
        showCopyToast('Failed to copy diagram markdown to clipboard', 'error');
      });
  };

  const handleDownload = () => {
    const md = getLatestFullMarkdown() || outputMarkdown;
    if (!md) return;
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const baseName = pouFileName.replace(/\.TcPOU$/i, '') || 'statechart';
    link.href = url;
    link.download = `${baseName}.statechart.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const [isPrintingPdf, setIsPrintingPdf] = useState<boolean>(false);
  const [pdfToast, setPdfToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const pdfToastTimeoutRef = useRef<number | null>(null);

  const showPdfToast = useCallback((message: string, type: 'success' | 'error' = 'success', durationMs = 3500) => {
    if (pdfToastTimeoutRef.current) {
      window.clearTimeout(pdfToastTimeoutRef.current);
    }
    setPdfToast({ message, type });
    pdfToastTimeoutRef.current = window.setTimeout(() => {
      setPdfToast(null);
      pdfToastTimeoutRef.current = null;
    }, durationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (pdfToastTimeoutRef.current) {
        window.clearTimeout(pdfToastTimeoutRef.current);
      }
    };
  }, []);

  const [isExportMenuOpen, setIsExportMenuOpen] = useState<boolean>(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleOpenExportDialog = (format: 'png' | 'svg' = exportSettings.format) => {
    setIsExportMenuOpen(false);
    runWithDiagramVisible(() => mermaidViewerRef.current?.openExportModal(format));
  };

  // One-click export using the active preset's format, scale & background
  const handleExportWithPresetSettings = () => {
    setIsExportMenuOpen(false);
    runWithDiagramVisible(() => mermaidViewerRef.current?.exportWithSettings(exportSettings));
  };

  const handleQuickDownloadPng = (scale: 1 | 2 | 3 | 4 = 2) => {
    setIsExportMenuOpen(false);
    runWithDiagramVisible(() => mermaidViewerRef.current?.quickDownloadPng(scale));
  };

  const handleQuickDownloadSvg = (scale: 1 | 2 | 3 | 4 = 1) => {
    setIsExportMenuOpen(false);
    runWithDiagramVisible(() => mermaidViewerRef.current?.quickDownloadSvg(scale));
  };

  const handleQuickCopyPng = (scale: 1 | 2 | 3 | 4 = 2) => {
    setIsExportMenuOpen(false);
    const trigger = async () => {
      try {
        const res = await mermaidViewerRef.current?.quickCopyPng(scale);
        if (res) {
          showCopyToast(res.message, res.success ? 'success' : 'error');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Clipboard copy failed';
        showCopyToast(`Copy failed: ${msg}`, 'error');
      }
    };

    runWithDiagramVisible(trigger, 80);
  };

  const handleQuickCopySvg = () => {
    setIsExportMenuOpen(false);
    const trigger = async () => {
      try {
        const res = await mermaidViewerRef.current?.quickCopySvg();
        if (res) {
          showCopyToast(res.message, res.success ? 'success' : 'error');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Clipboard copy failed';
        showCopyToast(`Copy failed: ${msg}`, 'error');
      }
    };

    runWithDiagramVisible(trigger, 80);
  };

  const handlePrintToPdf = async () => {
    if (!outputMarkdown || isPrintingPdf) return;
    setIsPrintingPdf(true);
    try {
      const baseName = pouFileName.replace(/\.TcPOU$/i, '') || 'statechart';
      const result = await exportDiagramVisibleAreaToPdf({
        targetElementId: 'mermaid-canvas-area',
        fileName: `${baseName}-diagram-visible`,
        scale: 2,
        theme: mermaidTheme,
        title: `${baseName} - Statechart Diagram (Visible Area)`,
      });

      if (result.success) {
        showPdfToast(`Exported high-res PDF: ${result.fileName}`, 'success');
      } else {
        showPdfToast(result.error || 'Failed to export PDF', 'error');
      }
    } catch (err: unknown) {
      console.error('Error printing PDF:', err);
      const msg = err instanceof Error ? err.message : 'Failed to generate PDF';
      showPdfToast(msg, 'error');
    } finally {
      setIsPrintingPdf(false);
    }
  };

  const notesCount = useMemo(
    () =>
      Object.values(diagramNotes.nodes).filter((t) => t && t.trim()).length +
      Object.values(diagramNotes.edges).filter((t) => t && t.trim()).length,
    [diagramNotes]
  );

  // State shown by the inspector tabs: the selection, or the last selection if it still exists
  const lastStateStillExists =
    lastSelectedState !== null && identifiedStatesResult.states.some((s) => s.id === lastSelectedState.id);
  const inspectorStateId = selectedStateId ?? (lastStateStillExists ? lastSelectedState!.id : null);
  const inspectorStateLabel = selectedStateId ? selectedStateLabel : lastStateStillExists ? lastSelectedState!.label : '';

  // Titles, icons & badges for every dockable tab
  const dockTabMeta = useMemo<Record<DockTabId, DockTabMeta>>(
    () => ({
      diagram: { title: 'Diagram Canvas', icon: <Workflow />, tooltip: 'Interactive statechart diagram canvas' },
      method: {
        title: 'Method Editor',
        icon: <FileCode />,
        tooltip: `Structured Text methods in ${pouFileName || 'POU'}${selectedStateId ? ` — state ${selectedStateId}` : ''}`,
      },
      enum: { title: 'Enum Editor', icon: <Code2 />, tooltip: `Enum members in ${dutFileName || '.TcDUT'}` },
      complexity: {
        title: 'Complexity Report',
        icon: <Activity />,
        badge:
          pouComplexityReport.refactorCandidatesCount > 0 ? (
            <span
              className="px-1.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800"
              title={`${pouComplexityReport.refactorCandidatesCount} refactoring candidates flagged`}
            >
              {pouComplexityReport.refactorCandidatesCount}
            </span>
          ) : undefined,
      },
      frequency: {
        title: 'Transition Frequency',
        icon: <TrendingUp />,
        tooltip: 'Analyze transition frequency over time from PLC logs or view static State Hit Count heatmap',
      },
      history: {
        title: 'Transition History',
        icon: <History />,
        tooltip: 'Time-series visualization of state transitions from PLC log files',
      },
      docs: { title: 'Documentation', icon: <BookOpen />, tooltip: 'State purpose, notes & documentation' },
      markdown: { title: 'Mermaid Markdown', icon: <FileText />, tooltip: 'Generated Mermaid diagram markdown' },
      search: { title: 'Keyword Search & Filter', icon: <Search /> },
      stats: {
        title: 'Real-Time Stats',
        icon: <ChartColumn />,
        tooltip: 'State Machine Real-Time Stats (shortcut: S)',
      },
      heatmap: { title: 'Complexity Heat-Map', icon: <Flame />, tooltip: 'Complexity Heat-Map (shortcut: H)' },
      legend: { title: 'Diagram Legend', icon: <Layers />, tooltip: 'Diagram Legend (shortcut: L)' },
      notes: {
        title: 'Notes',
        icon: <StickyNote />,
        tooltip: 'Notes attached to states and transitions',
        badge:
          notesCount > 0 ? (
            <span className="px-1.5 rounded-full text-[10px] font-mono bg-amber-500/20 text-amber-300">{notesCount}</span>
          ) : undefined,
      },
      minimap: { title: 'Minimap', icon: <MapIcon /> },
    }),
    [pouFileName, dutFileName, selectedStateId, pouComplexityReport.refactorCandidatesCount, notesCount]
  );

  // Canvas tool windows live in the RightPanel; the canvas renders them into these dock slots
  const dockedCanvasPanels = useMemo<DockedCanvasPanels>(() => {
    const ids: DockedCanvasPanelId[] = ['search', 'minimap', 'stats', 'heatmap', 'legend', 'notes'];
    const map = <T,>(fn: (id: DockedCanvasPanelId) => T) =>
      Object.fromEntries(ids.map((id) => [id, fn(id)])) as Record<DockedCanvasPanelId, T>;
    return {
      targets: map((id) => dockRegistry.nodes[id]),
      open: map((id) => isDockTabOpen(dockLayout, id)),
      visible: map((id) => isDockTabVisible(dockLayout, id)),
      onOpenChange: (id, open) => setDockLayout((l) => (open ? activateDockTab(l, id) : closeDockTab(l, id))),
    };
  }, [dockRegistry, dockLayout]);

  // Left / Right panel splitters resize the DOM directly while dragging, then commit the width
  const leftPanelRef = useRef<HTMLElement>(null);
  const rightPanelRef = useRef<HTMLElement>(null);
  const sidePanelDragStartRef = useRef<number>(0);
  const clampSidePanelWidth = (w: number) => Math.round(Math.max(SIDE_PANEL_MIN_WIDTH, Math.min(w, window.innerWidth * 0.6)));

  const handleOpenMermaidLive = () => {
    const md = getLatestFullMarkdown() || outputMarkdown;
    if (!md) return;
    const liveUrl = getMermaidLiveUrl(md, {
      layout: layoutEngine,
      curve: flowchartCurve,
      theme: mermaidTheme,
    });
    window.open(liveUrl, '_blank', 'noopener,noreferrer');
  };


  // ---------------------------------------------------------------------------
  // Header overflow: actions that do not fit on the header row move into its Hidden menu
  // ---------------------------------------------------------------------------
  const [headerRowEl, setHeaderRowEl] = useState<HTMLDivElement | null>(null);
  const [headerLeftFixedEl, setHeaderLeftFixedEl] = useState<HTMLDivElement | null>(null);
  const headerActionsRef = useRef<HTMLDivElement>(null);
  const [headerRowWidth, setHeaderRowWidth] = useState<number>(0);
  const [headerLeftWidth, setHeaderLeftWidth] = useState<number>(0);
  useEffect(() => {
    if (!headerRowEl || !headerLeftFixedEl) return;
    const ro = new ResizeObserver(() => {
      setHeaderRowWidth(headerRowEl.clientWidth);
      setHeaderLeftWidth(headerLeftFixedEl.offsetWidth);
    });
    ro.observe(headerRowEl);
    ro.observe(headerLeftFixedEl);
    return () => ro.disconnect();
  }, [headerRowEl, headerLeftFixedEl]);

  const headerItems: HeaderItemId[] = ['source', 'sample', 'generate', 'copy', 'download', 'export', 'pdf', 'mermaidLive'];
  const headerOverflow = useToolbarOverflow<HeaderItemId>({
    items: headerItems,
    // First entries stay visible longest
    priority: ['source', 'generate', 'sample', 'export', 'copy', 'download', 'mermaidLive', 'pdf'],
    // Row padding (2 x 16) + gap between title and actions + separator + safety margin
    available: headerRowWidth - headerLeftWidth - 60,
    containerRef: headerActionsRef,
    hiddenButtonSelector: '#header-hidden-controls-container',
    initialHiddenButtonWidth: 100,
  });

  function renderHeaderItem(id: HeaderItemId): React.ReactNode {
    switch (id) {
      case 'source':
        return (
          <SourceFilesHeaderItem
            pouFileName={pouFileName}
            pouPath={pouPath}
            dutFileName={dutFileName}
            dutRelativePath={dutRelativePath}
            dutMatches={dutMatches}
            dutStatus={dutStatus}
            canSearchFolder={isDesktopApp() || canPickFolder() || isXaeHost()}
            hostSave={isXaeHost() && pouPath ? { dirtyCount: hostDirtyFiles.length, onSave: handleSaveToProject } : undefined}
            onBrowsePou={handleBrowsePou}
            onDropPou={handleDropPou}
            onFindDut={handleFindDut}
            onChooseDutFiles={handleChooseDutFiles}
            onSelectDut={(m) => {
              applyDut(m);
              setDutStatus('found');
            }}
          />
        );
      case 'sample':
        return (
            <div className="flex items-center whitespace-nowrap gap-1 sm:gap-1.5 bg-slate-800/80 border border-slate-700/60 rounded-lg px-1.5 sm:px-2 py-1 text-xs shrink-0 max-w-[240px]">
              <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-slate-400 text-[11px] font-medium shrink-0">Sample:</span>
              <select
                id="sample-selector"
                value={selectedSampleId}
                onChange={(e) => {
                  const sample = SAMPLES.find((s) => s.id === e.target.value);
                  if (sample) handleSelectSample(sample);
                }}
                className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer pr-1 truncate w-full"
              >
                {/* A browsed .TcPOU is not one of the samples */}
                {selectedSampleId === '' && (
                  <option value="" disabled className="bg-slate-900 text-slate-400">
                    (own file)
                  </option>
                )}
                {SAMPLES.map((s) => (
                  <option key={s.id} value={s.id} className="bg-slate-900 text-slate-200">
                    {s.title}
                  </option>
                ))}
              </select>
              {selectedSampleId && (
                <button
                  id="sample-reset-btn"
                  type="button"
                  onClick={() => {
                    const sample = SAMPLES.find((s) => s.id === selectedSampleId);
                    if (sample) handleSelectSample(sample);
                  }}
                  className="p-0.5 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-700/60 transition-colors shrink-0"
                  title="Reload this sample (discards edits, styles, notes and moved nodes)"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
            </div>
        );
      case 'generate':
        return (
            <button
              id="generate-button"
              type="button"
              onClick={handleGenerate}
              className="flex items-center whitespace-nowrap gap-1 sm:gap-1.5 px-2 sm:px-2.5 md:px-3 py-1 sm:py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors shrink-0 cursor-pointer"
              title={liveUpdate ? 'Re-generate statechart diagram' : 'Generate statechart diagram'}
            >
              <Play className="w-3.5 h-3.5 fill-current shrink-0" />
              <span>Generate</span>
            </button>
        );
      case 'copy':
        return (
            <button
              id="copy-markdown-btn"
              type="button"
              onClick={handleCopyMarkdown}
              disabled={!outputMarkdown}
              className="flex items-center whitespace-nowrap gap-1 sm:gap-1.5 px-2 sm:px-2.5 md:px-3 py-1 sm:py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition-colors disabled:opacity-40 shrink-0 cursor-pointer"
              title="Copy Mermaid Markdown"
            >
              {copiedMarkdown ? (
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <Copy className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>
                {copiedMarkdown ? (
                  'Copied'
                ) : (
                  <>
                    <span>Copy</span>
                    <span> Markdown</span>
                  </>
                )}
              </span>
            </button>
        );
      case 'download':
        return (
            <button
              id="download-file-btn"
              type="button"
              onClick={handleDownload}
              disabled={!outputMarkdown}
              className="flex items-center whitespace-nowrap gap-1 sm:gap-1.5 px-2 sm:px-2.5 md:px-3 py-1 sm:py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition-colors disabled:opacity-40 shrink-0 cursor-pointer"
              title="Download .statechart.md"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>Download</span>
            </button>
        );
      case 'export':
        return (
            <div className="relative shrink-0" ref={exportMenuRef}>
              <button
                id="export-dropdown-button"
                type="button"
                onClick={() => setIsExportMenuOpen((prev) => !prev)}
                disabled={!outputMarkdown}
                className="flex items-center whitespace-nowrap gap-1 sm:gap-1.5 px-2 sm:px-2.5 md:px-3 py-1 sm:py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-medium shadow-sm transition-all disabled:opacity-40 cursor-pointer shrink-0"
                title="Export high-resolution PNG/SVG with custom scale and options"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>Export</span>
                <ChevronDown className={`w-3 h-3 transition-transform shrink-0 ${isExportMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {isExportMenuOpen && (
                <div
                  id="export-options-dropdown"
                  className="absolute right-0 top-full mt-1.5 w-64 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl py-1.5 z-50 text-xs text-slate-200 divide-y divide-slate-800/70"
                >
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    High-Resolution Export
                  </div>
                  <div className="py-1">
                    <button
                      id="dropdown-open-modal-btn"
                      type="button"
                      onClick={() => handleOpenExportDialog()}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-800 text-sky-400 font-medium transition-colors cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
                      <div>
                        <div className="text-white text-xs">High-Res Export Dialog...</div>
                        <div className="text-[10px] text-slate-400">Custom scale (1x-4x), background & DPI</div>
                      </div>
                    </button>
                    <button
                      id="dropdown-export-preset-btn"
                      type="button"
                      onClick={handleExportWithPresetSettings}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                      title="Download using the export format, scale and background saved in the active preset"
                    >
                      <span className="flex items-center whitespace-nowrap gap-2">
                        <Bookmark className="w-3.5 h-3.5 text-sky-400" />
                        Export with Preset
                      </span>
                      <span className="text-[10px] font-mono text-sky-300 bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-800/50">
                        {describeExportSettings(exportSettings)}
                      </span>
                    </button>
                  </div>
                  <div className="py-1">
                    <div className="px-3 py-1 text-[10px] text-slate-500 font-medium">Quick Downloads</div>
                    <button
                      id="dropdown-png-2x-btn"
                      type="button"
                      onClick={() => handleQuickDownloadPng(2)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    >
                      <span className="flex items-center whitespace-nowrap gap-2">
                        <FileImage className="w-3.5 h-3.5 text-sky-400" />
                        Download PNG
                      </span>
                      <span className="text-[10px] font-mono text-sky-400 bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-800/50">2x Retina</span>
                    </button>
                    <button
                      id="dropdown-png-3x-btn"
                      type="button"
                      onClick={() => handleQuickDownloadPng(3)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    >
                      <span className="flex items-center whitespace-nowrap gap-2">
                        <FileImage className="w-3.5 h-3.5 text-amber-400" />
                        Download PNG
                      </span>
                      <span className="text-[10px] font-mono text-amber-400 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800/50">High-Quality (3x)</span>
                    </button>
                    <button
                      id="dropdown-png-4x-btn"
                      type="button"
                      onClick={() => handleQuickDownloadPng(4)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    >
                      <span className="flex items-center whitespace-nowrap gap-2">
                        <FileImage className="w-3.5 h-3.5 text-emerald-400" />
                        Download PNG
                      </span>
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800/50">4x UHD 4K</span>
                    </button>
                    <button
                      id="dropdown-svg-btn"
                      type="button"
                      onClick={() => handleQuickDownloadSvg(1)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    >
                      <span className="flex items-center whitespace-nowrap gap-2">
                        <FileCode className="w-3.5 h-3.5 text-indigo-400" />
                        Download SVG
                      </span>
                      <span className="text-[10px] font-mono text-indigo-400 bg-indigo-950/80 px-1.5 py-0.5 rounded border border-indigo-800/50">Vector</span>
                    </button>
                    <button
                      id="dropdown-print-pdf-btn"
                      type="button"
                      onClick={() => {
                        setIsExportMenuOpen(false);
                        handlePrintToPdf();
                      }}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    >
                      <span className="flex items-center whitespace-nowrap gap-2">
                        <Printer className="w-3.5 h-3.5 text-rose-400" />
                        Print to PDF
                      </span>
                      <span className="text-[10px] font-mono text-rose-400 bg-rose-950/80 px-1.5 py-0.5 rounded border border-rose-800/50">Visible Area</span>
                    </button>
                  </div>
                  <div className="py-1">
                    <div className="px-3 py-1 text-[10px] text-slate-500 font-medium">Copy to System Clipboard</div>
                    <button
                      id="dropdown-copy-png-btn"
                      type="button"
                      onClick={() => handleQuickCopyPng(2)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    >
                      <span className="flex items-center whitespace-nowrap gap-2">
                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                        Copy PNG
                      </span>
                      <span className="text-[10px] font-mono text-sky-400 bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-800/50">2x Retina</span>
                    </button>
                    <button
                      id="dropdown-copy-png-3x-btn"
                      type="button"
                      onClick={() => handleQuickCopyPng(3)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    >
                      <span className="flex items-center whitespace-nowrap gap-2">
                        <Copy className="w-3.5 h-3.5 text-amber-400" />
                        Copy PNG
                      </span>
                      <span className="text-[10px] font-mono text-amber-400 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800/50">High-Quality (3x)</span>
                    </button>
                    <button
                      id="dropdown-copy-svg-btn"
                      type="button"
                      onClick={handleQuickCopySvg}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    >
                      <span className="flex items-center whitespace-nowrap gap-2">
                        <Copy className="w-3.5 h-3.5 text-indigo-400" />
                        Copy SVG
                      </span>
                      <span className="text-[10px] font-mono text-indigo-400 bg-indigo-950/80 px-1.5 py-0.5 rounded border border-indigo-800/50">Vector</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
        );
      case 'pdf':
        return (
            <button
              id="print-to-pdf-btn"
              type="button"
              onClick={handlePrintToPdf}
              disabled={!outputMarkdown || isPrintingPdf}
              className="flex items-center whitespace-nowrap gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg text-xs font-medium border border-slate-700 transition-colors disabled:opacity-40 cursor-pointer"
              title="Print current visible area of the Mermaid diagram as a high-resolution PDF file"
            >
              {isPrintingPdf ? (
                <Loader2 className="w-3.5 h-3.5 text-rose-400 animate-spin" />
              ) : (
                <Printer className="w-3.5 h-3.5 text-rose-400" />
              )}
              <span>{isPrintingPdf ? 'Generating PDF...' : 'Print to PDF'}</span>
            </button>
        );
      case 'mermaidLive':
        return (
            <button
              id="open-mermaid-live-btn"
              type="button"
              onClick={handleOpenMermaidLive}
              disabled={!outputMarkdown}
              className="flex items-center whitespace-nowrap gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors disabled:opacity-40"
              title="Open in mermaid.live"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Mermaid Live</span>
            </button>
        );
    }
  }

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Top Application Bar & Header Section */}
      <header
        id="app-header"
        className="relative z-40 flex flex-col bg-slate-900/90 border-b border-slate-800 backdrop-blur shrink-0"
      >
        {/* Row 1: Brand, Title, Sample Selector, Generate, Copy Markdown, Export */}
        <div
          id="header-row-1"
          ref={setHeaderRowEl}
          className="flex flex-nowrap items-center justify-between px-2.5 sm:px-4 py-1.5 border-b border-slate-800/80 gap-2 shrink-0"
        >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <div ref={setHeaderLeftFixedEl} className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            id="toggle-sidebar-btn"
            type="button"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors shrink-0"
            title={isSidebarOpen ? 'Hide left panel (TwinCAT source files)' : 'Show left panel (TwinCAT source files)'}
          >
            {isSidebarOpen ? <PanelLeftClose className="w-4 h-4 sm:w-5 sm:h-5" /> : <PanelLeftOpen className="w-4 h-4 sm:w-5 sm:h-5" />}
          </button>
          <WindowMenuButton layout={dockLayout} onLayoutChange={setDockLayout} tabMeta={dockTabMeta} />
          <button
            id="toggle-right-panel-btn"
            type="button"
            onClick={() => setDockLayout((l) => ({ ...l, rightVisible: !l.rightVisible }))}
            className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors shrink-0"
            title={dockLayout.rightVisible ? 'Hide right panel (tool windows)' : 'Show right panel (tool windows)'}
          >
            {dockLayout.rightVisible ? <PanelRightClose className="w-4 h-4 sm:w-5 sm:h-5" /> : <PanelRightOpen className="w-4 h-4 sm:w-5 sm:h-5" />}
          </button>

            <img src="/icon.svg" alt="Kval StateScope" className="w-7 h-7 sm:w-8 sm:h-8 shrink-0" draggable={false} />
          </div>
            {/* Title shrinks and truncates first when the header runs out of room */}
            <div className="min-w-0 overflow-hidden">
              <h1 className="text-xs sm:text-sm font-bold tracking-tight text-white flex items-center gap-1.5 sm:gap-2 truncate">
                <span className="truncate">Kval StateScope</span>
              </h1>
              <p className="text-[11px] text-slate-400 truncate hidden 2xl:block">
                TwinCAT state machine viewer for Kval SM_*.TcPOU function blocks
              </p>
            </div>
        </div>

        {/* Header Action Bar: actions that fit on this row; the rest are listed in the Hidden menu */}
        <div ref={headerActionsRef} id="header-action-bar" className="flex flex-nowrap items-center gap-1.5 shrink-0">
          {headerItems.map((id, index) => {
            if (!headerOverflow.isVisible(id)) return null;
            const prevVisible = headerItems.slice(0, index).filter(headerOverflow.isVisible).pop();
            return (
              <React.Fragment key={id}>
                {prevVisible === 'sample' && <div className="h-4 sm:h-5 w-[1px] bg-slate-800 shrink-0" />}
                <div data-toolbar-item={id} className="shrink-0 flex items-center">
                  {renderHeaderItem(id)}
                </div>
              </React.Fragment>
            );
          })}
          {headerOverflow.overflow.length > 0 && (
            <HeaderHiddenControls
              overflowItems={headerOverflow.overflow}
              compact={headerRowWidth < 900}
              samples={SAMPLES}
              pouFileName={pouFileName}
              dutFileName={dutFileName}
              onBrowsePou={handleBrowsePou}
              onFindDut={dutStatus === 'pending' || dutStatus === 'none' ? handleFindDut : undefined}
              selectedSampleId={selectedSampleId}
              onSelectSample={(id) => {
                const sample = SAMPLES.find((x) => x.id === id);
                if (sample) handleSelectSample(sample);
              }}
              onGenerate={handleGenerate}
              onCopyMarkdown={handleCopyMarkdown}
              onDownload={handleDownload}
              onOpenExportDialog={() => handleOpenExportDialog()}
              onExportWithPreset={handleExportWithPresetSettings}
              exportPresetLabel={describeExportSettings(exportSettings)}
              onPrintToPdf={handlePrintToPdf}
              isPrintingPdf={isPrintingPdf}
              onOpenMermaidLive={handleOpenMermaidLive}
              hasOutput={Boolean(outputMarkdown)}
            />
          )}
        </div>
        </div>

      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* LeftPanel: TwinCAT source files */}
        {dockLayout.leftVisible && (
          <aside
            id="source-files-sidebar"
            data-panel="LeftPanel"
            ref={leftPanelRef}
            style={{ width: clampSidePanelWidth(dockLayout.leftWidth) }}
            className="bg-slate-950/90 flex flex-col shrink-0 overflow-y-auto p-4 gap-4"
          >
            {/* Identified States Sidebar Section */}
            <IdentifiedStatesSidebarSection
              states={identifiedStatesResult.states}
              selectedStateId={selectedStateId}
              onJumpToState={handleJumpToState}
              customStyles={customNodeStyles}
              stateVarName={identifiedStatesResult.stateVarName}
              onOpenEnumEditor={() => {
                handleOpenEnumEditorModal(selectedStateId || undefined);
              }}
              onOpenComplexityReport={() => showDockTab('complexity')}
              fill
            />

            {/* Pinned to the bottom of the panel (also when Identified States is collapsed) */}
            <div className="mt-auto flex flex-col gap-4 shrink-0">
            {/* PLC Transition Logger Sidebar Card */}
            <PlcTransitionLoggerSidebarCard
              states={identifiedStatesResult.states}
              edges={availableEdges}
              activeDataset={historyDataset}
              onOpenLoggerModal={() => setIsPlcLoggerModalOpen(true)}
              onPopulateHistory={(ds, msg) => {
                setHistoryDataset(ds);
                showDockTab('history');
                if (msg) showCopyToast(msg, 'success');
              }}
              onViewHistoryTab={() => showDockTab('history')}
              onToast={showCopyToast}
            />

            {/* Guidance Info Card */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 text-[11px] text-slate-400 leading-relaxed">
              <div className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
                How It Works
              </div>
              <p>
                Parses <code className="text-sky-300">doState()</code> and <code className="text-sky-300">preProcess()</code> from the POU, matches enum sequences from the DUT or embedded UML composites, and emits clean Mermaid diagram markdown.
              </p>
            </div>
            </div>
          </aside>
        )}

        {dockLayout.leftVisible && (
          <DockSplitter
            id="left-panel-splitter"
            orientation="vertical"
            title="Drag to resize the left panel (double-click to reset)"
            onDragStart={() => (sidePanelDragStartRef.current = leftPanelRef.current?.offsetWidth ?? dockLayout.leftWidth)}
            onDrag={(d) => {
              if (leftPanelRef.current) leftPanelRef.current.style.width = `${clampSidePanelWidth(sidePanelDragStartRef.current + d)}px`;
            }}
            onDragEnd={() => {
              const w = leftPanelRef.current?.offsetWidth;
              if (w) setDockLayout((l) => ({ ...l, leftWidth: w }));
            }}
            onDoubleClick={() => setDockLayout((l) => ({ ...l, leftWidth: LEFT_PANEL_DEFAULT_WIDTH }))}
          />
        )}

        {/* MiddlePanel: document tab groups (Diagram Canvas, editors, reports) */}
        <main id="output-workspace" data-panel="MiddlePanel" className="flex-1 flex flex-col min-w-0 bg-slate-950 overflow-hidden">
          {generationError && (
            <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-rose-400 bg-rose-950/50 border-b border-rose-900/50 shrink-0">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="font-medium truncate">{generationError}</span>
            </div>
          )}
          <DockPanelView
            id="middle-panel"
            panel="middle"
            layout={dockLayout}
            onLayoutChange={setDockLayout}
            tabMeta={dockTabMeta}
            registry={dockRegistry}
          />
        </main>

        {/* RightPanel: tool windows stacked vertically */}
        {dockLayout.rightVisible && (
          <>
            <DockSplitter
              id="right-panel-splitter"
              orientation="vertical"
              title="Drag to resize the right panel (double-click to reset)"
              onDragStart={() => (sidePanelDragStartRef.current = rightPanelRef.current?.offsetWidth ?? dockLayout.rightWidth)}
              onDrag={(d) => {
                if (rightPanelRef.current) rightPanelRef.current.style.width = `${clampSidePanelWidth(sidePanelDragStartRef.current - d)}px`;
              }}
              onDragEnd={() => {
                const w = rightPanelRef.current?.offsetWidth;
                if (w) setDockLayout((l) => ({ ...l, rightWidth: w }));
              }}
              onDoubleClick={() => setDockLayout((l) => ({ ...l, rightWidth: RIGHT_PANEL_DEFAULT_WIDTH }))}
            />
            <aside
              id="right-panel"
              data-panel="RightPanel"
              ref={rightPanelRef}
              style={{ width: clampSidePanelWidth(dockLayout.rightWidth) }}
              className="flex flex-col shrink-0 min-h-0 bg-slate-950 overflow-hidden"
            >
              <DockPanelView
                id="right-dock-panel"
                panel="right"
                layout={dockLayout}
                onLayoutChange={setDockLayout}
                tabMeta={dockTabMeta}
                registry={dockRegistry}
              />
            </aside>
          </>
        )}
      </div>

      {/* Dock tab contents: rendered once and portaled into persistent host nodes that the dock layout
          moves between tab groups, so moving a tab never remounts its content */}
      {createPortal(
        <div className="flex flex-col h-full w-full min-h-0">
          {/* Diagram toolbar (search, view & editing controls), portaled from MermaidViewer */}
          <div
            id="header-toolbar-container"
            ref={setHeaderToolbarElement}
            className="relative z-40 flex items-center justify-between px-2 py-0.5 min-h-[34px] bg-slate-950/95 border-b border-slate-800/80 text-xs text-slate-300 overflow-visible shrink-0"
          />
          {/* Options Control Ribbon (diagram generation options, only relevant to the canvas) */}
          <div
            id="options-ribbon"
            className="relative z-30 flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-1 bg-slate-900 border-b border-slate-800 text-xs text-slate-300 shrink-0"
          >
            <div className="contents">
              <div className="flex items-center gap-1.5 text-slate-400 font-medium">
                <Settings2 className="w-3.5 h-3.5 text-sky-400" />
                <span>Options:</span>
              </div>

              {/* User Preset Quick Toggle & Manager */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 text-[11px] font-medium hidden md:inline">Preset:</span>
                <DiagramPresetManager
                  currentOptions={currentDiagramOptions}
                  onApplyPreset={handleApplyPreset}
                  onExportSettingsChange={setExportSettings}
                />
              </div>

              <div className="h-4 w-px bg-slate-800 hidden sm:block"></div>

              {/* Format Toggle */}
              <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
                <button
                  id="format-flowchart-btn"
                  type="button"
                  onClick={() => setFlowchartOutput(true)}
                  title="Flowchart format (TD): Direct transition arrows with subgraph hierarchy"
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    flowchartOutput ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  flowchart TD
                </button>
                <button
                  id="format-statediagram-btn"
                  type="button"
                  onClick={() => setFlowchartOutput(false)}
                  title="State diagram format (v2): Standard UML statechart notation"
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    !flowchartOutput ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  stateDiagram-v2
                </button>
              </div>

              {/* Collapse error sink edges */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  id="collapse-errors-checkbox"
                  type="checkbox"
                  checked={collapseErrorSinkEdges}
                  onChange={(e) => setCollapseErrorSinkEdges(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-700 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-900"
                />
                <span className="text-slate-300">Collapse error-sink edges</span>
              </label>

              {/* Include state description */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  id="include-descriptions-checkbox"
                  type="checkbox"
                  checked={includeStateDescriptions}
                  onChange={(e) => setIncludeStateDescriptions(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-700 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-900"
                />
                <span className="text-slate-300">Include state descriptions</span>
              </label>

              {/* Show transition priorities & format */}
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    id="show-priorities-checkbox"
                    type="checkbox"
                    checked={showTransitionPriorities}
                    onChange={(e) => setShowTransitionPriorities(e.target.checked)}
                    className="rounded bg-slate-950 border-slate-700 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-900"
                  />
                  <span className="text-slate-300">Priorities</span>
                </label>

                {showTransitionPriorities && (
                  <div
                    id="priority-format-toggle"
                    className="flex items-center bg-slate-950 p-0.5 rounded-md border border-slate-800 text-[11px]"
                  >
                    <button
                      id="prio-format-paren"
                      type="button"
                      onClick={() => setPriorityFormat('paren')}
                      title="Parentheses format: (1) - clean, standard text, universal font support in mermaid.live"
                      className={`px-2 py-0.5 rounded font-mono transition-colors ${
                        priorityFormat === 'paren'
                          ? 'bg-sky-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      (1)
                    </button>
                    <button
                      id="prio-format-bracket"
                      type="button"
                      onClick={() => setPriorityFormat('bracket')}
                      title="Bracket format: [1] - standard UML index notation"
                      className={`px-2 py-0.5 rounded font-mono transition-colors ${
                        priorityFormat === 'bracket'
                          ? 'bg-sky-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      [1]
                    </button>
                    <button
                      id="prio-format-circled"
                      type="button"
                      onClick={() => setPriorityFormat('circled')}
                      title="Circled Unicode format: ① - TwinCAT visual circled style"
                      className={`px-2 py-0.5 rounded font-mono transition-colors ${
                        priorityFormat === 'circled'
                          ? 'bg-sky-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      ①
                    </button>
                  </div>
                )}
              </div>
              {/* Layout Engine: Dagre vs ELK */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 text-[11px] font-medium">Engine:</span>
                <div
                  id="layout-engine-toggle"
                  className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]"
                >
                  <button
                    id="layout-engine-dagre"
                    type="button"
                    onClick={() => setLayoutEngine('dagre')}
                    title="Dagre layout engine: classic Mermaid hierarchical DAG layout"
                    className={`px-2.5 py-0.5 rounded-md font-medium transition-colors ${
                      layoutEngine === 'dagre'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Dagre
                  </button>
                  <button
                    id="layout-engine-elk"
                    type="button"
                    onClick={() => setLayoutEngine('elk')}
                    title="ELK (Eclipse Layout Kernel) engine: advanced layered routing matching mermaid.live ELK option"
                    className={`px-2.5 py-0.5 rounded-md font-medium transition-colors ${
                      layoutEngine === 'elk'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ELK
                  </button>
                </div>
              </div>

              {/* Flowchart Curve Interpolation */}
              {flowchartOutput && (
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 text-[11px] font-medium">Curve:</span>
                  <select
                    id="flowchart-curve-select"
                    value={flowchartCurve}
                    onChange={(e) => setFlowchartCurve(e.target.value as FlowchartCurve)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
                    title="Flowchart link curve interpolation (basis, linear, cardinal, stepAfter, etc.)"
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

              {/* Theme Preset Dropdown */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 text-[11px] font-medium">Theme:</span>
                <select
                  id="mermaid-theme-select"
                  value={mermaidTheme}
                  onChange={(e) => setMermaidTheme(e.target.value as MermaidTheme)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
                  title="Mermaid theme preset (dark, base, forest, neutral, default)"
                >
                  <option value="dark">dark</option>
                  <option value="base">base</option>
                  <option value="forest">forest</option>
                  <option value="neutral">neutral</option>
                  <option value="default">default</option>
                </select>
              </div>

              {/* Lock Diagram Layout Toggle */}
              <button
                id="lock-diagram-layout-toggle-btn"
                type="button"
                onClick={() => setLockDiagramLayout((prev) => !prev)}
                title={
                  lockDiagramLayout
                    ? 'Diagram layout is LOCKED: automatic re-layout is disabled on code edits, preserving custom node positions. Click to unlock.'
                    : 'Lock diagram layout: disables automatic re-layout triggered by edits, allowing you to maintain custom node positions when tweaking code logic.'
                }
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                  lockDiagramLayout
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/60 shadow-xs ring-1 ring-amber-500/30'
                    : 'bg-slate-950/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800'
                }`}
              >
                {lockDiagramLayout ? (
                  <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                ) : (
                  <Unlock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
                <span>{lockDiagramLayout ? 'Layout Locked' : 'Lock Layout'}</span>
                {lockDiagramLayout && (
                  <span className="text-[9px] font-bold px-1 rounded bg-amber-400 text-slate-950 leading-none">
                    LOCKED
                  </span>
                )}
              </button>

              {/* Custom Node Styles Count Badge */}
              {customizedStatesCount > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-sky-950/60 border border-sky-800/60 text-sky-400 text-[11px]">
                  <Palette className="w-3 h-3" />
                  <span>
                    {customizedStatesCount} custom state{customizedStatesCount > 1 ? 's' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={handleClearAllCustomStyles}
                    className="ml-1 p-0.5 text-slate-400 hover:text-rose-400 transition-colors"
                    title="Reset all custom state node styles"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Stats & Live update toggle */}
            <div className="flex items-center gap-3 ml-auto">
              {generationStats && (
                <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Valid
                  </span>
                  <span>•</span>
                  <span>{generationStats.linesCount} lines</span>
                  <span>•</span>
                  <span>{generationStats.timeMs}ms</span>
                </div>
              )}

              <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-400 hover:text-slate-200 select-none">
                <input
                  id="live-update-checkbox"
                  type="checkbox"
                  checked={liveUpdate}
                  onChange={(e) => setLiveUpdate(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-700 text-sky-500"
                />
                <span>Auto-refresh</span>
              </label>
            </div>
          </div>

          <div className="relative flex-1 min-h-0">
            <div className="absolute inset-0">
                <MermaidViewer
                  ref={mermaidViewerRef}
                  toolbarPortalTarget={headerToolbarElement}
                  focusStateRequest={jumpRequest}
                  code={styledMarkdown}
                  layoutEngine={layoutEngine}
                  flowchartCurve={flowchartCurve}
                  mermaidTheme={mermaidTheme}
                  exportSettings={exportSettings}
                  searchQuery={diagramSearchQuery}
                  onSearchQueryChange={setDiagramSearchQuery}
                  selectedStateId={selectedStateId}
                  selectedStateLabel={selectedStateLabel}
                  onSelectState={(id, label) => {
                    setSelectedStateId(id);
                    if (label) setSelectedStateLabel(label);
                  }}
                  customStyles={customNodeStyles}
                  onStyleChange={handleStyleChange}
                  onResetStateStyle={handleResetStateStyle}
                  onClearAllCustomStyles={handleClearAllCustomStyles}
                  customEdgeStyles={customEdgeStyles}
                  onEdgeStyleChange={handleEdgeStyleChange}
                  nodeOffsets={nodeOffsets}
                  onNodeOffsetsChange={setNodeOffsets}
                  onCanvasPositionsChange={setCanvasPositions}
                  notes={diagramNotes}
                  onSaveNote={handleSaveNote}
                  onDeleteNote={handleDeleteNote}
                  onClearAllNotes={handleClearAllNotes}
                  onUpdateNotePosition={handleUpdateNotePosition}
                  onUpdateNoteStyle={handleUpdateNoteStyle}
                  onOpenMermaidLive={handleOpenMermaidLive}
                  fileName={pouFileName.replace(/\.TcPOU$/i, '') || 'statechart'}
                  tcPouContent={pouContent}
                  tcPouFileName={pouFileName}
                  tcDutContent={dutContent}
                  tcDutFileName={dutFileName}
                  onSaveDutContent={handleSaveDutContent}
                  onOpenEnumEditor={(memberName) => {
                    handleOpenEnumEditorModal(memberName);
                  }}
                  onOpenMethodEditor={(methodName) => {
                    handleOpenMethodEditorModal(methodName || 'doState()');
                  }}
                  onSaveMethodCode={handleSaveMethodCode}
                  onSaveStateCode={handleSaveStateCode}
                  onSavePreProcessCode={handleSavePreProcessCode}
                  priorityFormat={priorityFormat}
                  layoutLocked={lockDiagramLayout}
                  onLayoutLockedChange={setLockDiagramLayout}
                  onToast={showCopyToast}
                  onSwitchToDiagramTab={() => showDockTab('diagram')}
                  dockedPanels={dockedCanvasPanels}
                  onOpenInspectorPanel={handleOpenInspectorPanel}
                />
            </div>
          </div>
        </div>,
        dockRegistry.nodes.diagram
      )}

      {(['method', 'enum', 'docs'] as const).map(
        (mode) =>
          isDockTabMounted(mode) &&
          createPortal(
            <StateNodeStyleInspector
              key={mode}
              panelMode={mode}
              selectedStateId={inspectorStateId}
              selectedStateLabel={inspectorStateLabel}
              availableStates={identifiedStatesResult.states}
              customStyles={customNodeStyles}
              onStyleChange={handleStyleChange}
              onResetStateStyle={handleResetStateStyle}
              onClearAllCustomStyles={handleClearAllCustomStyles}
              onSelectState={(id, label) => {
                handleJumpToState(id, label);
              }}
              onClose={() => setDockLayout((l) => closeDockTab(l, mode))}
              tcPouContent={pouContent}
              tcPouFileName={pouFileName || 'POU.TcPOU'}
              tcDutContent={dutContent}
              tcDutFileName={dutFileName || 'EnumDeclaration.TcDUT'}
              onSaveDutContent={handleSaveDutContent}
              onSaveMethodCode={handleSaveMethodCode}
              onSaveStateCode={handleSaveStateCode}
              onSavePreProcessCode={handleSavePreProcessCode}
              initialMethod={inspectorRequest.method}
              initialEnumMember={inspectorRequest.enumMember}
              notes={diagramNotes}
              onSaveNote={handleSaveNote}
              onDeleteNote={handleDeleteNote}
              onUpdateNoteStyle={handleUpdateNoteStyle}
            />,
            dockRegistry.nodes[mode],
            mode
          )
      )}

      {isDockTabMounted('markdown') &&
        createPortal(
          <MermaidMarkdownViewer
            code={outputMarkdown}
            fileName={`${pouFileName.replace(/\.TcPOU$/i, '') || 'statechart'}.statechart.md`}
            searchQuery={diagramSearchQuery}
            onSearchQueryChange={setDiagramSearchQuery}
            onToast={showCopyToast}
          />,
          dockRegistry.nodes.markdown
        )}

      {isDockTabMounted('complexity') &&
        createPortal(
          <PouComplexityReportTab
            report={pouComplexityReport}
            onJumpToState={handleJumpToState}
            onOpenStateEditor={(stateId) => handleOpenEnumEditorModal(stateId)}
            onOpenMethodEditor={(methodName) => handleOpenMethodEditorModal(methodName)}
            onToast={showCopyToast}
          />,
          dockRegistry.nodes.complexity
        )}

      {isDockTabMounted('frequency') &&
        createPortal(
          <TransitionFrequencyTab
            states={identifiedStatesResult.states}
            edges={availableEdges}
            pouContent={pouContent}
            pouFileName={pouFileName}
            onJumpToState={handleJumpToState}
            onApplyHeatmapStyles={(styles) => {
              setCustomNodeStyles((prev) => ({ ...prev, ...styles }));
              showDockTab('diagram');
            }}
            onToast={showCopyToast}
          />,
          dockRegistry.nodes.frequency
        )}

      {isDockTabMounted('history') &&
        createPortal(
          <TransitionHistoryTab
            states={identifiedStatesResult.states}
            edges={availableEdges}
            pouFileName={pouFileName}
            activeDataset={historyDataset}
            onDatasetChange={(ds) => setHistoryDataset(ds)}
            onJumpToState={handleJumpToState}
            onToast={showCopyToast}
          />,
          dockRegistry.nodes.history
        )}

      {/* Dedicated PLC Transition Logger Tool Modal */}
      <PlcTransitionLoggerTool
        isOpen={isPlcLoggerModalOpen}
        onClose={() => setIsPlcLoggerModalOpen(false)}
        states={identifiedStatesResult.states}
        edges={availableEdges}
        pouFileName={pouFileName}
        onPopulateHistory={(newDs, msg) => {
          setHistoryDataset(newDs);
          showDockTab('history');
          if (msg) showCopyToast(msg, 'success');
        }}
        onToast={showCopyToast}
      />

      {/* Floating Toast Notifications Container */}
      <div
        id="toast-notification-container"
        className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 pointer-events-none items-end"
      >
        {/* Mermaid Diagram Clipboard Copy Toast */}
        {copyToast && (
          <div
            id="clipboard-toast"
            data-testid="clipboard-toast-notification"
            className={`pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-2xl text-xs font-medium border backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200 ${
              copyToast.type === 'success'
                ? 'bg-slate-900/95 border-emerald-500/50 text-emerald-300 ring-1 ring-emerald-500/20'
                : 'bg-slate-900/95 border-rose-500/50 text-rose-300 ring-1 ring-rose-500/20'
            }`}
          >
            {copyToast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{copyToast.message}</span>
            <button
              type="button"
              onClick={() => setCopyToast(null)}
              className="ml-1 p-0.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
              title="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Floating PDF Toast Notification */}
        {pdfToast && (
          <div
            id="pdf-export-toast"
            data-testid="pdf-export-toast"
            className={`pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-2xl text-xs font-medium border backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200 ${
              pdfToast.type === 'success'
                ? 'bg-slate-900/95 border-emerald-500/50 text-emerald-300 ring-1 ring-emerald-500/20'
                : 'bg-slate-900/95 border-rose-500/50 text-rose-300 ring-1 ring-rose-500/20'
            }`}
          >
            {pdfToast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{pdfToast.message}</span>
            <button
              type="button"
              onClick={() => setPdfToast(null)}
              className="ml-1 p-0.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
              title="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
