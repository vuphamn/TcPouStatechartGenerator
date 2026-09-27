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
  Blocks,
  LayoutGrid,
  Timer,
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
  BookMarked,
  FileText,
  Search,
  Map as MapIcon,
  PanelRightClose,
  PanelRightOpen,
  ChartColumn,
  Flame,
  Layers,
  StickyNote,
  ListChecks,
  Radio,
  GitCompare,
  Maximize2,
  Minimize2,
  ArrowRightLeft,
  PencilLine,
  SquarePlus,
  Link2,
  FileStack,
  Route,
  ArrowUp,
  ArrowDown,
  ListOrdered,
  ClipboardCopy,
  ClipboardPaste,
  Trash2,
  CircleDot,
  Circle,
  SquareStack,
  ListTree,
  FlaskConical,
} from 'lucide-react';
import { generateStatechart, generateStatechartModel, PriorityFormat } from './generator.ts';
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
import { PouCodeEditor } from './components/PouCodeEditor.tsx';
import { updatePouBody } from './utils/pouBody.ts';
import { PouComplexityReportTab } from './components/PouComplexityReportTab.tsx';
import { TransitionFrequencyTab } from './components/TransitionFrequencyTab.tsx';
import { TransitionHistoryTab } from './components/TransitionHistoryTab.tsx';
import { PlcTransitionLoggerTool } from './components/PlcTransitionLoggerTool.tsx';
import { HelpButton } from './components/HelpButton.tsx';
import { TransitionHistoryDataset, analyzeChronologicalEvents } from './utils/transitionHistoryAnalytics.ts';
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
  canWriteBack,
  downloadSource,
  writeWebSource,
} from './utils/sourceFileAccess.ts';
import type { WebSaveResult } from './utils/sourceFileAccess.ts';
import { HostMessage, isXaeHost, onHostMessage, postToHost } from './utils/xaeHost.ts';
import { locateState, locateTransition } from './utils/sourceLocation.ts';
import { LintFinding, addCaseBranch, addEnumMember, enumMembers, lintStateMachine } from './utils/stateMachineLint.ts';
import { ProblemsPanel } from './components/ProblemsPanel.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { PathsPanel } from './components/PathsPanel.tsx';
import { ChangesPanel, CompareBase } from './components/ChangesPanel.tsx';
import { diffCharts } from './utils/chartDiff.ts';
import { canReadGitVersions, fetchCommittedVersion } from './utils/hostGit.ts';
import { ReferencedMachine, declaredMachineMembers, referencedMachines } from './utils/referencedMachines.ts';
import { getStateCodeFromPou } from './utils/pouStateEditor.ts';
import { buildProjectDocumentation } from './utils/projectDocumentation.ts';
import { loadProjectFiles, saveDocument } from './utils/projectFiles.ts';
import { declarationLineCount, implementationLineCount, stateAtLine } from './utils/stateMachineLint.ts';
import { findPaths } from './utils/statePaths.ts';
import { TextPromptDialog, TextPromptRequest } from './components/TextPromptDialog.tsx';
import { addState, addTransition, checkNewStateName, renameEdgeKeys, renameKey, renameState } from './utils/stateEdits.ts';
import { deleteTransition, moveTransitionStart, retargetTransition, setTransitionPriority, transitionOrder, TransitionEditResult } from './utils/transitionEdits.ts';
import { copyName, copyState, deleteState, removeEnumMember } from './utils/stateCopyDelete.ts';
import {
  addChoice,
  addCompletionTransition,
  addExceptionTransition,
  addForkJoinRegions,
  regionVariables,
  addEnumMemberIn,
  addStateDescription,
  compositeOf,
  describeName,
  dropEmptyComposites,
  enumComposites,
  initialStateOf,
  isFinalState,
  enumMarksOf,
  setEnumMark,
  isValidCompositeName,
  setFinalState,
  setInitialState,
  wrapInComposite,
} from './utils/statechartEdits.ts';
import type { PaletteElement } from './components/StatechartPalette.tsx';
import { ChoiceDialog, ChoiceRequest } from './components/ChoiceDialog.tsx';
import { ForkJoinDialog, ForkJoinRequest } from './components/ForkJoinDialog.tsx';
import { SimulationPanel, SimTransition } from './components/SimulationPanel.tsx';
import type { ContextMenuExtraItem } from './components/DiagramContextMenu.tsx';
import { LivePanel, LiveSettings, LiveStatus } from './components/LivePanel.tsx';
import { EMPTY_LIVE_SESSION, LiveSession, applyLiveSamples, enumValueMap } from './utils/liveView.ts';
import {
  buildEnumTables,
  buildGuardEdges,
  evaluateGuards,
  appliesToState,
  symbolCandidates,
  variablesToWatch,
  type GuardInputs,
  type LiveValue,
  type WatchedVar,
} from './utils/liveGuards.ts';
import type { LiveBrowseResult, LiveWatchVar, SymbolChild } from './utils/xaeHost.ts';
import { desktopLive } from './utils/liveHost.ts';
import { LiveRecorder, parseRecording, recordingFileName, recordingSpan, upperBound, type LiveRecording } from './utils/liveRecording.ts';
import { addSeen, loadSeen, removedSeenTransitions, saveSeen, seenKey, seenText, stateSeen, type SeenMap } from './utils/seenTransitions.ts';
import { addRouteOnPlc, canScanPlcs, ipFieldFor, loadRememberedPlcs, saveRememberedPlcs, scanPlcs, type AddRouteResult, type FoundPlc, type PlcScanResult, type RememberedPlc } from './utils/plcDiscovery.ts';
import { GatewayConnection, GatewayPlc, GatewaySso, detectGatewayOrigin, fetchGatewaySso, gatewaySignOut, gatewaySocketUrl } from './utils/liveGateway.ts';
import { useStoredSecret } from './hooks/useStoredSecret.ts';
import { InstanceLaunch, connectionOf, putHandoff, sameInstance, takeHandoff } from './utils/instanceLaunch.ts';
import { DEFAULT_SYMBOL_ROOT, SymbolBrowserWindow, symbolWatchId } from './components/SymbolBrowserWindow.tsx';
import { MachineOverview, overviewWatchId } from './components/MachineOverview.tsx';
import { OtherPlcsOverview } from './components/OtherPlcsOverview.tsx';
import type { SidePlc, SideVia } from './utils/sideLive.ts';
import { formatLimit, limitFor, notifyStuck, parseDuration, requestNotifyPermission, setDefaultLimit, setNotify, setStateLimit, useDefaultLimit, useNotify, useStateLimits } from './utils/stateLimits.ts';

/** Guard variables and Symbols values followed at once (a gateway allows 100 by default) */
const MAX_WATCHED = 100;
/** A symbol path the hosts accept (as shared/tcAds.cjs isSymbolPath) */
const isSymbolPathText = (t: string) => t.length <= 250 && /^[A-Za-z_]\w*(\[-?\d+\]|\^)*(\.[A-Za-z_]\w*(\[-?\d+\]|\^)*)*$/.test(t);
/** A recording played back: its span and position (PLC time), playing, and speed (1: real time) */
interface ReplayState {
  rec: LiveRecording;
  file: string;
  from: number;
  to: number;
  pos: number;
  playing: boolean;
  speed: number;
}

const DEFAULT_LIVE_SETTINGS: LiveSettings = { instance: '', netId: '', port: '', ip: '', localNetId: '', gateway: '', plc: '', via: '', linkPort: '' };
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
  getDockGroupOfTab,
  saveDockLayout,
} from './utils/dockLayout.ts';
import { HeaderHiddenControls, HeaderItemId } from './components/HeaderHiddenControls.tsx';
import { useToolbarOverflow } from './hooks/useToolbarOverflow.ts';
import { extractIdentifiedStatesFromPou } from './utils/pouStateExtractor.ts';
import { generatePouComplexityReport } from './utils/pouComplexityReport.ts';
import { extractEdgesFromMermaid } from './utils/diagramNotes.ts';
import { SAMPLES, SampleItem } from './samples/samplesData.ts';
import { getMermaidLiveUrl } from './utils/mermaidLive.ts';
import { CustomNodeStylesMap, NodeDisplayProperties, DiagramNotes, ContextMenuTarget, NotePosition, DiagramPreset, PresetExportSettings, CustomEdgeStylesMap, EdgeDisplayProperties, EdgeInfo } from './types.ts';
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


/** Diagram notes in localStorage: one entry per POU, "<this key>:<POU path or file name>" */
const NOTES_STORAGE_KEY = 'tc_statechart_diagram_notes_metadata';

/**
 * The POU's stored notes. Before they were kept per POU, all notes were one entry: the first POU whose states it
 * names takes it over.
 */
function readStoredNotes(key: string, pouContent: string): DiagramNotes {
  // Only what the app can show: text notes (damaged or foreign data must not break the diagram)
  const clean = (v: unknown): DiagramNotes | null => {
    if (!v || typeof v !== 'object' || !('nodes' in (v as object))) return null;
    const o = v as Partial<DiagramNotes>;
    const texts = (m: unknown) =>
      Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {}).filter(([, t]) => typeof t === 'string')) as Record<string, string>;
    return { ...o, nodes: texts(o.nodes), edges: texts(o.edges) } as DiagramNotes;
  };
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const notes = clean(JSON.parse(raw));
      if (notes) return notes;
    }
    const legacy = localStorage.getItem(NOTES_STORAGE_KEY);
    if (legacy) {
      const notes = clean(JSON.parse(legacy));
      const ids = notes ? Object.keys(notes.nodes) : [];
      if (notes && ids.length > 0 && ids.every((id) => pouContent.includes(id))) {
        localStorage.setItem(key, JSON.stringify(notes));
        localStorage.removeItem(NOTES_STORAGE_KEY);
        return notes;
      }
    }
  } catch {
    // storage unavailable or damaged
  }
  return { nodes: {}, edges: {} };
}

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
  // Every .TcDUT found with the POU (not only the state enum's candidates): enum literals for live guard values
  const [dutPool, setDutPool] = useState<string[]>([]);
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
  // A state's IF / ELSIF / ELSE of transitions as a choice (a diamond): per viewer
  const [choiceNodes, setChoiceNodesState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('kss.choiceNodes') === 'true';
    } catch {
      return false;
    }
  });
  const setChoiceNodes = useCallback((on: boolean) => {
    setChoiceNodesState(on);
    try {
      localStorage.setItem('kss.choiceNodes', String(on));
    } catch {
      // (not remembered)
    }
  }, []);
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

  // Details follow the selection: a selected state brings the Documentation tab forward (unless an interactive
  // tool tab is in front); a transition opens its Transition Guard window on a double-click
  const [followSelection, setFollowSelection] = useState(() => {
    try {
      return localStorage.getItem('kss.followSelection') !== 'false';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('kss.followSelection', String(followSelection));
    } catch {
      // per-viewer convenience only
    }
  }, [followSelection]);

  // Focus mode (Z): header, side panels and options ribbon hidden, the diagram fills the window; Z / Esc restore
  const [focusMode, setFocusMode] = useState(false);
  const focusRestoreRef = useRef<{ left: boolean; right: boolean } | null>(null);
  const toggleFocusMode = useCallback(() => {
    setFocusMode((on) => {
      if (!on) {
        setDockLayout((l) => {
          focusRestoreRef.current = { left: l.leftVisible, right: l.rightVisible };
          return activateDockTab({ ...l, leftVisible: false, rightVisible: false }, 'diagram');
        });
      } else {
        const restore = focusRestoreRef.current;
        if (restore) setDockLayout((l) => ({ ...l, leftVisible: restore.left, rightVisible: restore.right }));
      }
      return !on;
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'z' || e.key === 'Z' || (e.key === 'Escape' && focusMode)) {
        e.preventDefault();
        toggleFocusMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusMode, toggleFocusMode]);
  const [copiedMarkdown, setCopiedMarkdown] = useState<boolean>(false);
  const [headerToolbarElement, setHeaderToolbarElement] = useState<HTMLDivElement | null>(null);

  // PLC Transition Logger & Telemetry State
  const [historyDataset, setHistoryDataset] = useState<TransitionHistoryDataset | null>(null);

  // Node display customizations
  const [customNodeStyles, setCustomNodeStyles] = useState<CustomNodeStylesMap>({});
  const [customEdgeStyles, setCustomEdgeStyles] = useState<CustomEdgeStylesMap>({});
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [selectedStateLabel, setSelectedStateLabel] = useState<string>('');
  useEffect(() => {
    if (!followSelection || !selectedStateId) return;
    setDockLayout((l) => {
      const group = getDockGroupOfTab(l, 'docs');
      const busy: DockTabId[] = ['live', 'problems', 'paths', 'changes'];
      if (!group || group.active === 'docs' || (group.active && busy.includes(group.active))) return l;
      return revealDockTab(l, 'docs', 'diagram');
    });
  }, [followSelection, selectedStateId]);
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

  // Diagram notes and state documentation, kept per POU in localStorage. Several StateScopes (browser tabs, desktop
  // windows, XAE tabs) share that storage: each keeps its own POU's notes, and picks up changes another one saves.
  const notesKey = `${NOTES_STORAGE_KEY}:${pouPath || pouFileName || 'POU'}`;
  const [diagramNotes, setDiagramNotes] = useState<DiagramNotes>({ nodes: {}, edges: {} });
  // The key the notes in state belong to, and the JSON last saved / loaded (no write back of what was just read)
  const notesLoadedKeyRef = useRef<string | null>(null);
  const notesSavedRef = useRef<string>('');
  // The notes object the load put in state: nothing is saved until the state holds it (until then diagramNotes is
  // still the previous POU's, or the initial empty one)
  const notesLoadedRef = useRef<DiagramNotes | null>(null);
  const notesReadyRef = useRef(false);
  // Save (declared before the load: when the POU changes, the old POU's notes are not written to the new key)
  useEffect(() => {
    if (notesLoadedKeyRef.current !== notesKey) return;
    if (!notesReadyRef.current) {
      if (diagramNotes !== notesLoadedRef.current) return;
      notesReadyRef.current = true;
    }
    const json = JSON.stringify(diagramNotes);
    if (json === notesSavedRef.current) return;
    notesSavedRef.current = json;
    try {
      localStorage.setItem(notesKey, json);
    } catch {
      // storage unavailable: notes live in memory only
    }
  }, [diagramNotes, notesKey]);
  // Load the POU's notes
  useEffect(() => {
    const notes = readStoredNotes(notesKey, pouContent);
    notesLoadedKeyRef.current = notesKey;
    notesSavedRef.current = JSON.stringify(notes);
    notesLoadedRef.current = notes;
    notesReadyRef.current = false;
    setDiagramNotes(notes);
    // Only when the POU changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesKey]);
  // Another instance saved notes of the same POU
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== notesKey || e.newValue === null || e.newValue === notesSavedRef.current) return;
      try {
        const parsed = JSON.parse(e.newValue);
        if (parsed && typeof parsed === 'object' && parsed.nodes) {
          notesSavedRef.current = e.newValue;
          setDiagramNotes(parsed);
        }
      } catch {
        // not ours
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [notesKey]);

  // (The window title and the POU reported to the desktop app are set next to the live view, with the instance)
  // Window menu: another StateScope for another POU (desktop app: a window; web edition: a browser tab). In XAE each
  // POU opened from the PLC tree gets its own tab.
  const desktopNewWindow = (window as unknown as { tcDesktop?: { newWindow?: (p?: string) => Promise<void> } }).tcDesktop?.newWindow;
  const openNewInstance = isXaeHost()
    ? null
    : desktopNewWindow
      ? () => void desktopNewWindow()
      : () => void window.open(window.location.href.split('#')[0], '_blank', 'noopener');

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
        collapseErrorSinkEdges, choiceNodes,
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
    collapseErrorSinkEdges, choiceNodes,
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
            collapseErrorSinkEdges, choiceNodes,
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
      collapseErrorSinkEdges, choiceNodes,
      includeStateDescriptions,
      showTransitionPriorities,
      priorityFormat,
    ]
  );

  // POU Editor: the POU's own declaration and body (its methods stay as they are)
  const handleSavePouBody = useCallback(
    (declaration: string, implementation: string | null) => {
      const r = updatePouBody(pouContent, declaration, implementation);
      if (!r.success) return { success: false, error: r.error };
      setPouContent(r.updatedPou);
      return { success: true };
    },
    [pouContent]
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
            collapseErrorSinkEdges, choiceNodes,
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
      collapseErrorSinkEdges, choiceNodes,
      includeStateDescriptions,
      showTransitionPriorities,
      priorityFormat,
    ]
  );

  /** New .TcPOU and / or .TcDUT text (edits made from the diagram), then the diagram regenerated once */
  const handleReplaceSources = useCallback(
    (newPou: string | null, newDut: string | null) => {
      const pou = newPou ?? pouContent;
      const dut = newDut ?? dutContent;
      if (newPou !== null) setPouContent(newPou);
      if (newDut !== null) setDutContent(newDut);
      try {
        const startTime = performance.now();
        setGenerationError(null);
        const result = generateStatechart(dut, pou, { flowchartOutput, collapseErrorSinkEdges, choiceNodes, includeStateDescriptions, showTransitionPriorities, priorityFormat });
        setRawMarkdown(result);
        setGenerationStats({ statesCount: (result.match(/-->/g) || []).length, linesCount: result.split('\n').length, timeMs: Math.round(performance.now() - startTime) });
      } catch (genErr: unknown) {
        setGenerationError(genErr instanceof Error ? genErr.message : String(genErr));
      }
    },
    [pouContent, dutContent, flowchartOutput, collapseErrorSinkEdges, choiceNodes, includeStateDescriptions, showTransitionPriorities, priorityFormat]
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
            collapseErrorSinkEdges, choiceNodes,
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
      collapseErrorSinkEdges, choiceNodes,
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
            collapseErrorSinkEdges, choiceNodes,
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
      collapseErrorSinkEdges, choiceNodes,
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
  const handleSelectSample = (sample: SampleItem, discard = false) => {
    if (!discard && localDirtyRef.current) {
      confirmDiscard(() => handleSelectSample(sample, true));
      return;
    }
    setSelectedSampleId(sample.id);
    setDutFileName(sample.dutName);
    setDutContent(sample.dutContent);
    setPouFileName(sample.pouName);
    setPouContent(sample.pouContent);
    setFlowchartOutput(sample.defaultFlowchart);
    setIncludeStateDescriptions(sample.defaultIncludeDescriptions);
    setCustomNodeStyles({});
    setCustomEdgeStyles({});
    // (Notes are not cleared: the sample's own notes are loaded, see notesKey)
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
    setWindowInstance(null);
    setAutoLivePending(false);
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
    // Shown in the status bar, which covers nothing: a little longer than a pop-up
    copyToastTimeoutRef.current = window.setTimeout(() => {
      setCopyToast(null);
      copyToastTimeoutRef.current = null;
    }, Math.max(durationMs, type === 'error' ? 15000 : 8000));
  }, []);

  // ---------------------------------------------------------------------------
  // Source files: a browsed .TcPOU, and its state enum found among the .TcDUT files in its folder tree
  // ---------------------------------------------------------------------------
  const applyDut = useCallback((dut: { name: string; relativePath: string; content: string; path?: string } | null) => {
    setDutFileName(dut?.name ?? '');
    setDutContent(dut?.content ?? '');
    setDutRelativePath(dut?.relativePath);
    setDutPath(dut?.path);
    setSavedSources((b) => ({ ...b, dut: dut?.content ?? '' }));
  }, []);

  /** Picks the enum that declares the most doState() states; `forceFirst` keeps a hand-picked file without a match */
  const applyDutCandidates = useCallback(
    (pou: string, candidates: DutCandidate[], forceFirst = false) => {
      const ranked = rankDutCandidates(pou, candidates);
      setDutMatches(ranked);
      setDutPool(candidates.map((c) => c.content));
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

  // The PLC instance this window follows, when it was opened for one (Live: Open instance): per window, so two windows
  // on the same POU follow different instances. null: the POU's saved live settings choose.
  const [windowInstance, setWindowInstance] = useState<string | null>(null);
  // Go live once the POU (and its live settings) are loaded
  const [autoLivePending, setAutoLivePending] = useState(false);

  const applyLoadedPou = useCallback(
    (src: PouSource, launch?: InstanceLaunch) => {
      setWindowInstance(launch?.instance?.trim() || null);
      setAutoLivePending(!!launch?.live);
      if (launch?.connection) adoptLiveConnection(src.name, launch.connection);
      setPouFileName(src.name);
      setPouContent(src.content);
      setPouPath(src.path);
      setSavedSources((b) => ({ ...b, pou: src.content }));
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

  const browseNow = useCallback(async () => {
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
  const handleBrowsePou = useCallback(() => confirmDiscard(() => void browseNow()), [browseNow]);

  // Desktop: a .TcPOU opened from Windows Explorer ("Open in Kval StateScope"): at start-up, or later in this window
  useEffect(() => {
    // launch: the window was opened to follow one PLC instance (Live: Open instance)
    type Opened = (PouSource & { launch?: InstanceLaunch }) | { error: string } | null;
    const d = (window as unknown as { tcDesktop?: { startupPou?: () => Promise<Opened>; onOpenPouFile?: (h: (s: Opened) => void) => () => void } }).tcDesktop;
    if (!d?.startupPou || !d.onOpenPouFile) return;
    // Through the ref: the handlers of the latest render
    const open = (src: Opened) => {
      if (!src) return;
      if ('error' in src) hostHandlersRef.current.showCopyToast(src.error, 'error');
      else hostHandlersRef.current.applyLoadedPou(src, src.launch);
    };
    const off = d.onOpenPouFile(open);
    void d.startupPou().then(open);
    return off;
  }, []);

  // Opened by another window to follow a PLC instance, with the POU handed over (web edition; desktop: a sample or a
  // dropped file)
  useEffect(() => {
    const h = takeHandoff();
    if (!h) return;
    const sample = h.sampleId ? SAMPLES.find((s) => s.id === h.sampleId) : undefined;
    if (sample) {
      handleSelectSample(sample);
      setWindowInstance(h.instance?.trim() || null);
      setAutoLivePending(!!h.live);
      if (h.connection) adoptLiveConnection(sample.pouName, h.connection);
    } else if (h.pou) {
      const dut = h.dutCandidates ?? (h.dut ? [{ name: h.dut.name, relativePath: h.dut.name, content: h.dut.content, path: h.dut.path }] : null);
      applyLoadedPou({ name: h.pou.name, content: h.pou.content, path: h.pou.path, dutCandidates: dut }, h);
    }
    // At start-up only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDropPou = useCallback(
    async (file: File, handle?: Promise<unknown>) => {
      // (the handle is asked for during the drop: taken before any question)
      const fileHandle = handle ? await handle.catch(() => null) : null;
      confirmDiscard(() => void readDroppedPou(file, fileHandle).then(applyLoadedPou));
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
  // A loaded file changed in XAE while it has unsaved edits here: the user picks reload or keep
  const [hostConflict, setHostConflict] = useState<{ path: string; name: string; content: string } | null>(null);
  // Files whose XAE change the user chose to overwrite with their edits (sent as "force" on save)
  const keepMineRef = useRef<Set<string>>(new Set());
  const hostStateRef = useRef({ pouPath, dutPath, pouContent, dutContent, saved: hostSavedContent });
  hostStateRef.current = { pouPath, dutPath, pouContent, dutContent, saved: hostSavedContent };

  /** Takes XAE's version of a loaded file: it becomes the content and the saved version */
  const applyHostVersion = useCallback((path: string, content: string) => {
    const st = hostStateRef.current;
    setHostSavedContent((prev) => ({ ...prev, [path]: content }));
    if (path === st.pouPath) setPouContent(content);
    else if (path === st.dutPath) setDutContent(content);
    keepMineRef.current.delete(path);
  }, []);

  /** A loaded file changed in XAE / on disk: refresh, or ask when it has unsaved edits here */
  const handleSourceChanged = useCallback(
    (path: string, name: string, content: string) => {
      const st = hostStateRef.current;
      const inUse = path === st.pouPath || path === st.dutPath;
      if (!inUse) {
        // Another .TcDUT candidate: just keep its saved version current
        setHostSavedContent((prev) => (prev[path] === undefined ? prev : { ...prev, [path]: content }));
        return;
      }
      const current = path === st.pouPath ? st.pouContent : st.dutContent;
      const saved = st.saved[path];
      if (saved === undefined || current === saved || current === content) {
        applyHostVersion(path, content);
        showCopyToast(`${name} was changed in XAE: the diagram is updated`, 'success', 4000);
      } else {
        setHostConflict({ path, name, content });
      }
    },
    [applyHostVersion, showCopyToast]
  );

  // ---- Live view (XAE): the POU's state variable in the running PLC, over ADS ----
  const [liveStatus, setLiveStatus] = useState<LiveStatus>({ state: 'idle', instances: [] });
  const [liveSession, setLiveSession] = useState<LiveSession>(EMPTY_LIVE_SESSION);
  // Live recordings: the running session is recorded (Save recording); Replay plays one back as if live
  const recorderRef = useRef(new LiveRecorder());
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const replayingRef = useRef(false);
  replayingRef.current = !!replay;
  // The transitions the PLC took with this POU type (kept in the app): edits and Save that drop one say so first
  const seenPouType = useMemo(() => pouContent.match(/<POU\b[^>]*\bName="([^"]+)"/)?.[1], [pouContent]);
  const [seen, setSeen] = useState<SeenMap>({});
  useEffect(() => setSeen(loadSeen(seenPouType)), [seenPouType]);
  const seenUpToRef = useRef(0);
  useEffect(() => {
    const fresh = liveSession.transitions.filter((t) => t.t > seenUpToRef.current);
    if (!fresh.length) return;
    seenUpToRef.current = Math.max(...fresh.map((t) => t.t));
    // (a replay shows transitions already counted when they happened)
    if (replayingRef.current) return;
    setSeen((s) => {
      const next = addSeen(s, fresh);
      saveSeen(seenPouType, next);
      return next;
    });
  }, [liveSession.transitions, seenPouType]);
  const liveEnumNames = useMemo(() => enumValueMap(dutContent), [dutContent]);
  const liveNamesRef = useRef(liveEnumNames);
  liveNamesRef.current = liveEnumNames;
  const liveEdgesRef = useRef(availableEdges);
  liveEdgesRef.current = availableEdges;
  const handleLiveStatus = useCallback((m: Extract<HostMessage, { type: 'liveStatus' }>) => {
    if (m.state === 'plcState') {
      setLiveStatus((prev) =>
        prev.state === 'connected' && prev.plcState !== m.plcState
          ? { ...prev, plcState: m.plcState, message: prev.message?.replace(/\(PLC [^)]*\)$/, `(PLC ${m.plcState})`) }
          : prev
      );
      return;
    }
    const state = m.state;
    setLiveStatus((prev) => ({
      state,
      message: m.message,
      target: m.target ?? prev.target,
      plcState: m.plcState ?? prev.plcState,
      instance: state === 'connected' ? m.instance : prev.instance,
      instances: m.instances && m.instances.length ? m.instances : prev.instances,
      route: m.route ?? prev.route,
    }));
  }, []);
  const handleLiveValues = useCallback((events: { t: number; value: number }[]) => {
    // (a live session's samples while a replay shows: recorded, not shown)
    recorderRef.current.addValues(events);
    if (replayingRef.current) return;
    setLiveSession((prev) => applyLiveSamples(prev, events, liveNamesRef.current, liveEdgesRef.current));
  }, []);
  // Guard variables: where the host found each one, and their latest values (by variable, lower case)
  const [liveWatched, setLiveWatched] = useState<Record<string, WatchedVar>>({});
  const [liveVarValues, setLiveVarValues] = useState<Record<string, LiveValue>>({});
  const handleLiveWatchResult = useCallback((vars: { id: string; symbol?: string; type?: string; error?: string }[]) => {
    recorderRef.current.addWatched(vars);
    if (replayingRef.current) return;
    setLiveWatched((prev) => {
      const next = { ...prev };
      for (const v of vars) next[v.id] = { symbol: v.symbol, type: v.type, error: v.error };
      return next;
    });
  }, []);
  const handleLiveVars = useCallback((values: { id: string; t: number; v: LiveValue | null }[]) => {
    recorderRef.current.addVars(values);
    if (replayingRef.current) return;
    setLiveVarValues((prev) => {
      const next = { ...prev };
      for (const s of values) {
        if (s.v === null || s.v === undefined) delete next[s.id];
        else next[s.id] = s.v;
      }
      return next;
    });
  }, []);

  // Symbol browser (Live > Symbols): answers to liveBrowse, by request id
  const browseWaitersRef = useRef(new Map<number, (r: LiveBrowseResult) => void>());
  const handleLiveBrowseResult = useCallback((m: LiveBrowseResult) => {
    const waiter = browseWaitersRef.current.get(m.requestId);
    if (!waiter) return;
    browseWaitersRef.current.delete(m.requestId);
    waiter(m);
  }, []);

  // Two-way selection (XAE): the caret in TwinCAT's doState() editor selects the state whose CASE branch it is in
  const followSelectionRef = useRef(followSelection);
  followSelectionRef.current = followSelection;
  const handleEditorCaret = useCallback((m: Extract<HostMessage, { type: 'editorCaret' }>) => {
    if (!followSelectionRef.current || m.method.toLowerCase() !== 'dostate') return;
    const pou = pouContentRef.current;
    const declLines = declarationLineCount(pou, 'doState');
    const implLines = implementationLineCount(pou, 'doState');
    if (!declLines || !implLines) return;
    // TwinCAT's editor numbers the declaration's lines first (its line count can be one more than the file's)
    const line = m.line - declLines;
    if (line < 1 || line > implLines) return;
    const state = stateAtLine(pou, line);
    if (!state) return;
    setSelectedStateId((prev) => {
      if (prev !== state) {
        setSelectedStateLabel(state);
        mermaidViewerRef.current?.panToState(state, Date.now());
      }
      return state;
    });
  }, []);

  const hostHandlersRef = useRef({ applyLoadedPou, applyDutCandidates, showCopyToast, handleSourceChanged, handleLiveStatus, handleLiveValues, handleLiveWatchResult, handleLiveVars, handleEditorCaret, handleLiveBrowseResult });
  hostHandlersRef.current = { applyLoadedPou, applyDutCandidates, showCopyToast, handleSourceChanged, handleLiveStatus, handleLiveValues, handleLiveWatchResult, handleLiveVars, handleEditorCaret, handleLiveBrowseResult };

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
        setHostConflict(null);
        keepMineRef.current.clear();
        remember([{ path: m.source.path, content: m.source.content }, ...(m.source.dutCandidates ?? [])]);
        h.applyLoadedPou(m.source, { instance: m.instance, live: m.live, connection: m.connection });
      } else if (m.type === 'dutCandidates') {
        remember(m.candidates);
        h.applyDutCandidates(pouContentRef.current, m.candidates, m.forceFirst);
      } else if (m.type === 'sourceChanged') {
        h.handleSourceChanged(m.path, m.name, m.content);
      } else if (m.type === 'saveResult') {
        if (m.ok) {
          const sent = pendingHostSaveRef.current;
          const confirmed = m.files && m.files.length ? m.files : sent;
          remember(confirmed);
          // No typing since Save was pressed: XAE's version also becomes the content, so nothing looks unsaved
          const st = hostStateRef.current;
          for (const f of confirmed) {
            const wasSent = sent.find((x) => x.path === f.path)?.content;
            if (f.path === st.pouPath && st.pouContent === wasSent) setPouContent(f.content);
            if (f.path === st.dutPath && st.dutContent === wasSent) setDutContent(f.content);
            keepMineRef.current.delete(f.path);
          }
          setHostConflict(null);
        }
        pendingHostSaveRef.current = [];
        h.showCopyToast(m.message, m.ok ? 'success' : 'error', m.ok ? 4000 : 7000);
      } else if (m.type === 'liveStatus') {
        h.handleLiveStatus(m);
      } else if (m.type === 'liveValues') {
        h.handleLiveValues(m.events);
      } else if (m.type === 'liveWatchResult') {
        h.handleLiveWatchResult(m.vars);
      } else if (m.type === 'liveVars') {
        h.handleLiveVars(m.values);
      } else if (m.type === 'liveBrowseResult') {
        h.handleLiveBrowseResult(m);
      } else if (m.type === 'editorCaret') {
        h.handleEditorCaret(m);
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

  // ---- Save (desktop, web): each source as read / last saved, what differs from it, writing it back ----
  const pouKey = `${pouPath ?? ''}|${pouFileName}`;
  const dutKey = `${dutPath ?? ''}|${dutRelativePath ?? ''}|${dutFileName}`;
  const [savedSources, setSavedSources] = useState<{ pouKey: string; pou: string; dutKey: string; dut: string }>(() => ({ pouKey, pou: pouContent, dutKey, dut: dutContent }));
  // (another file, a sample, a Save As: what it is now is its saved version)
  useEffect(() => {
    setSavedSources((b) => (b.pouKey === pouKey ? b : { ...b, pouKey, pou: pouContent }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pouKey]);
  useEffect(() => {
    setSavedSources((b) => (b.dutKey === dutKey ? b : { ...b, dutKey, dut: dutContent }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dutKey]);
  const localSave = !isXaeHost();
  const pouDirty = localSave && !!pouContent && savedSources.pouKey === pouKey && pouContent !== savedSources.pou;
  const dutDirty = localSave && !!dutContent && savedSources.dutKey === dutKey && dutContent !== savedSources.dut;
  const localDirtyCount = Number(pouDirty) + Number(dutDirty);
  const localDirtyRef = useRef(false);
  localDirtyRef.current = localDirtyCount > 0;
  const markSaved = (kind: 'pou' | 'dut', content: string) => setSavedSources((b) => (kind === 'pou' ? { ...b, pou: content } : { ...b, dut: content }));
  type DesktopSave = {
    saveSources?: (files: unknown[]) => Promise<{ saved: string[]; conflicts: { path: string }[]; errors: { path: string; error: string }[] }>;
    saveSourceAs?: (name: string, content: string, dir?: string | null) => Promise<{ path?: string; canceled?: boolean; error?: string }>;
  };
  const desktopSave = () => (window as unknown as { tcDesktop?: DesktopSave }).tcDesktop;
  const defaultName = (kind: 'pou' | 'dut') => (kind === 'pou' ? pouFileName || 'SM_Machine.TcPOU' : dutFileName || 'E_States.TcDUT');
  /** Unsaved edits: go on only after the user agrees to lose them */
  const confirmDiscard = (proceed: () => void) => {
    if (!localDirtyRef.current) return proceed();
    setPromptRequest({
      title: 'Unsaved edits',
      label: 'The POU or the enum has unsaved edits. Open the other file and lose them? (Cancel, then Save, to keep them.)',
      confirmOnly: true,
      danger: true,
      submitLabel: 'Lose the edits',
      onSubmit: proceed,
    });
  };
  /** Save As (desktop: a file picked; web: a download) */
  const handleSaveAs = useCallback(
    async (kind: 'pou' | 'dut') => {
      const content = kind === 'pou' ? pouContent : dutContent;
      if (!content) return;
      const d = desktopSave();
      if (d?.saveSourceAs) {
        const dir = (kind === 'pou' ? pouPath : dutPath ?? pouPath)?.replace(/[\\/][^\\/]*$/, '') ?? null;
        const r = await d.saveSourceAs(defaultName(kind), content, dir);
        if (r.error) return showCopyToast(`Could not save: ${r.error}`, 'error', 8000);
        if (!r.path) return;
        const base = r.path.split(/[\\/]/).pop() ?? r.path;
        // (the file it is now: its saved version, through the key)
        if (kind === 'pou') {
          setPouPath(r.path);
          setPouFileName(base);
        } else {
          setDutPath(r.path);
          setDutFileName(base);
        }
        return showCopyToast(`Saved ${base}`, 'success');
      }
      downloadSource(defaultName(kind), content);
      markSaved(kind, content);
      showCopyToast(`Downloaded ${defaultName(kind)}`, 'success');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pouContent, dutContent, pouPath, dutPath, pouFileName, dutFileName, showCopyToast]
  );
  /**
   * Save: the edited sources back to their files (desktop), or through the browser's handles (web; a download when
   * it cannot write them). A file changed on disk since it was read is overwritten only when the user says so.
   * quiet: from an editor's Ctrl+S (no message when there is nothing to save, no download)
   */
  /**
   * Before a Save: transitions the saved version has, the edit no longer has, and the PLC took. When there are any,
   * asks (Save anyway runs save) and returns true; else false (save now)
   */
  const confirmSeenRemovals = useCallback(
    (savedDut: string, savedPou: string, save: () => void): boolean => {
      const removed = removedSeenTransitions(savedDut, savedPou, dutContent, pouContent, seen);
      if (!removed.length) return false;
      setPromptRequest({
        title: 'Save without transitions the PLC uses?',
        label: `This Save removes ${removed.length} transition${removed.length === 1 ? '' : 's'} the running PLC has taken:`,
        details: [...removed.slice(0, 12).map((r) => `${r.from} → ${r.to}: taken ${seenText(r)}`), ...(removed.length > 12 ? [`… ${removed.length - 12} more`] : [])],
        confirmOnly: true,
        danger: true,
        submitLabel: 'Save anyway',
        onSubmit: save,
      });
      return true;
    },
    [dutContent, pouContent, seen]
  );
  const handleSaveSources = useCallback(
    async (opts: { force?: boolean; quiet?: boolean; checked?: boolean } = {}) => {
      // Transitions the PLC took that this Save removes: asked first
      if (!opts.force && !opts.checked && pouDirty && confirmSeenRemovals(savedSources.dut, savedSources.pou, () => void saveSourcesRef.current({ ...opts, checked: true }))) return;
      const items = [
        pouDirty ? { kind: 'pou' as const, name: defaultName('pou'), path: pouPath, relativePath: undefined as string | undefined, content: pouContent, baseline: savedSources.pou } : null,
        dutDirty ? { kind: 'dut' as const, name: defaultName('dut'), path: dutPath, relativePath: dutRelativePath, content: dutContent, baseline: savedSources.dut } : null,
      ].filter((i): i is NonNullable<typeof i> => !!i);
      if (!items.length) {
        if (!opts.quiet) showCopyToast('No unsaved edits', 'success');
        return;
      }
      const saved: string[] = [];
      const downloaded: string[] = [];
      const conflicts: string[] = [];
      const d = desktopSave();
      if (d?.saveSources) {
        // (a sample, or a dropped file: no file to write back to)
        for (const i of items.filter((x) => !x.path)) if (!opts.quiet) await handleSaveAs(i.kind);
        const withPath = items.filter((x) => x.path);
        if (withPath.length) {
          const r = await d.saveSources(withPath.map((i) => ({ path: i.path, content: i.content, baseline: i.baseline, force: !!opts.force })));
          for (const i of withPath) {
            if (r.saved.includes(i.path!)) {
              markSaved(i.kind, i.content);
              saved.push(i.name);
            } else if (r.conflicts.some((c) => c.path === i.path)) conflicts.push(i.name);
          }
          for (const e of r.errors) showCopyToast(`Could not save ${e.path}: ${e.error}`, 'error', 8000);
        }
      } else {
        for (const i of items) {
          let res: WebSaveResult = 'no-handle';
          try {
            res = await writeWebSource(i.kind, i.relativePath, i.content, i.baseline, !!opts.force);
          } catch (e) {
            showCopyToast(`Could not write ${i.name}: ${e instanceof Error ? e.message : String(e)}`, 'error', 8000);
          }
          if (res === 'saved') {
            markSaved(i.kind, i.content);
            saved.push(i.name);
          } else if (res === 'conflict') conflicts.push(i.name);
          else if (!opts.quiet) {
            downloadSource(i.name, i.content);
            markSaved(i.kind, i.content);
            downloaded.push(i.name);
          }
        }
      }
      if (saved.length) showCopyToast(`Saved ${saved.join(' and ')}`, 'success');
      if (downloaded.length)
        showCopyToast(`Downloaded ${downloaded.join(' and ')}: ${canWriteBack() ? 'open it with Browse to save in place next time' : 'this browser cannot write files back'}; replace the original with it`, 'success', 9000);
      if (conflicts.length)
        setPromptRequest({
          title: 'Changed on disk',
          label: `${conflicts.join(' and ')} changed on disk since ${conflicts.length > 1 ? 'they were' : 'it was'} opened (saved in TwinCAT or another editor?). Overwrite with your version?`,
          confirmOnly: true,
          danger: true,
          submitLabel: 'Overwrite',
          onSubmit: () => void handleSaveSources({ force: true }),
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pouDirty, dutDirty, pouPath, dutPath, dutRelativePath, pouContent, dutContent, savedSources, handleSaveAs, showCopyToast, confirmSeenRemovals]
  );
  const saveSourcesRef = useRef(handleSaveSources);
  saveSourcesRef.current = handleSaveSources;
  // Ctrl+S saves the files (an editor's Ctrl+S first puts its code into the POU: then the files are saved too)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 's') return;
      const t = e.target as HTMLElement | null;
      const inEditor = !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable);
      if (inEditor) {
        if (e.defaultPrevented && !isXaeHost()) window.setTimeout(() => void saveSourcesRef.current({ quiet: true }), 60);
        return;
      }
      e.preventDefault();
      if (isXaeHost()) handleSaveToProjectRef.current();
      else void saveSourcesRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Closing / reloading with unsaved edits: the browser (the desktop app: its dialog) asks first
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!localDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const handleSaveToProject = useCallback((checked?: boolean) => {
    if (hostDirtyFiles.length === 0) return;
    const savedPou = (pouPath && hostSavedContent[pouPath]) || '';
    const savedDut = (dutPath && hostSavedContent[dutPath]) || dutContent;
    if (checked !== true && savedPou && confirmSeenRemovals(savedDut, savedPou, () => handleSaveToProjectRef.current(true))) return;
    pendingHostSaveRef.current = hostDirtyFiles;
    // The saved version tells the extension what this edit was based on; a change in XAE since then is refused
    // unless the user chose to keep their edits
    postToHost({
      type: 'save',
      files: hostDirtyFiles.map((f) => ({
        ...f,
        baseline: hostSavedContent[f.path],
        force: keepMineRef.current.has(f.path),
      })),
    });
  }, [hostDirtyFiles, hostSavedContent, pouPath, dutPath, dutContent, confirmSeenRemovals]);
  const handleSaveToProjectRef = useRef(handleSaveToProject);
  handleSaveToProjectRef.current = handleSaveToProject;

  /** Opens TwinCAT's editor at a state's CASE branch or a transition's assignment (POU loaded from the project) */
  const handleShowInXae = useCallback(
    (target: { kind: 'state'; id: string } | { kind: 'edge'; edge: EdgeInfo }) => {
      if (!pouPath) return;
      const loc = target.kind === 'state' ? locateState(pouContent, target.id) : locateTransition(pouContent, target.edge);
      if (!loc) {
        showCopyToast(
          target.kind === 'state'
            ? `${target.id} has no CASE branch in doState()`
            : `The code of ${target.edge.from} → ${target.edge.to} was not found`,
          'error'
        );
        return;
      }
      postToHost({ type: 'navigate', path: pouPath, method: loc.method, line: loc.line, text: loc.text });
    },
    [pouPath, pouContent, showCopyToast]
  );

  // Lint findings (Problems tab); ignored ones are remembered per POU
  const lintFindings = useMemo(
    () => lintStateMachine(pouContent, dutContent, availableEdges),
    [pouContent, dutContent, availableEdges]
  );
  const lintIgnoreStorageKey = `kss.lint.ignored.${pouFileName || 'POU'}`;
  const [lintIgnored, setLintIgnored] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(lintIgnoreStorageKey);
      setLintIgnored(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    } catch {
      setLintIgnored(new Set());
    }
  }, [lintIgnoreStorageKey]);
  const handleToggleLintIgnore = useCallback(
    (finding: LintFinding) => {
      setLintIgnored((prev) => {
        const next = new Set(prev);
        if (next.has(finding.key)) next.delete(finding.key);
        else next.add(finding.key);
        try {
          localStorage.setItem(lintIgnoreStorageKey, JSON.stringify([...next]));
        } catch {
          // per-viewer convenience only
        }
        return next;
      });
    },
    [lintIgnoreStorageKey]
  );
  const activeLintFindings = useMemo(() => lintFindings.filter((f) => !lintIgnored.has(f.key)), [lintFindings, lintIgnored]);
  const lintProblemMarkers = useMemo(() => {
    const markers: Record<string, 'error' | 'warning'> = {};
    for (const f of activeLintFindings) {
      if (!f.stateId || f.severity === 'info') continue;
      if (markers[f.stateId] !== 'error') markers[f.stateId] = f.severity;
    }
    return markers;
  }, [activeLintFindings]);

  const canNavigateInXae = isXaeHost() && !!pouPath && hostSavedContent[pouPath] !== undefined;

  // Paths tab: every path between two states, highlighted on the diagram
  const [pathFrom, setPathFrom] = useState('');
  const [pathTo, setPathTo] = useState('');
  const [pathIndex, setPathIndex] = useState<number | null>(null);
  useEffect(() => {
    setPathFrom('');
    setPathTo('');
    setPathIndex(null);
  }, [pouFileName]);
  const pathResult = useMemo(() => findPaths(availableEdges, pathFrom, pathTo), [availableEdges, pathFrom, pathTo]);
  const pathHighlight = useMemo(() => {
    if (!pathFrom || !pathTo || pathResult.paths.length === 0) return null;
    const shown = pathIndex !== null && pathResult.paths[pathIndex] ? [pathResult.paths[pathIndex]] : pathResult.paths;
    const states = new Set<string>();
    const edges = new Map<string, { from: string; to: string }>();
    for (const p of shown) for (const step of p) {
      states.add(step.from);
      states.add(step.to);
      edges.set(`${step.from}->${step.to}`, { from: step.from, to: step.to });
    }
    return { states: [...states], edges: [...edges.values()] };
  }, [pathFrom, pathTo, pathResult, pathIndex]);
  const diagramStateIds = useMemo(
    () => [...new Set([...identifiedStatesResult.states.map((s) => s.id), ...availableEdges.flatMap((e) => [e.from, e.to])])].filter((s) => s && s !== '[*]').sort(),
    [identifiedStatesResult.states, availableEdges]
  );
  const findPathsFor = useCallback(
    (stateId: string, role: 'from' | 'to') => {
      if (role === 'from') {
        setPathFrom(stateId);
        setPathTo((t) => (t === stateId ? '' : t));
      } else {
        setPathTo(stateId);
        setPathFrom((f) => (f === stateId ? '' : f));
      }
      setPathIndex(null);
      showDockTab('paths');
    },
    [showDockTab]
  );

  // Compare (Changes tab): the chart against the version as loaded / saved in XAE, or the committed one (git)
  const [compareBase, setCompareBase] = useState<CompareBase>('saved');
  const [compareOnDiagram, setCompareOnDiagram] = useState(true);
  const [loadedBaseline, setLoadedBaseline] = useState<{ pou: string; dut: string }>({ pou: '', dut: '' });
  useEffect(() => {
    // The versions as they were when this POU / enum was loaded (edits come later)
    setLoadedBaseline({ pou: pouContent, dut: dutContent });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pouFileName, dutFileName]);
  const [gitBaseline, setGitBaseline] = useState<{ key: string; loading: boolean; pou?: string; dut?: string; error?: string; note?: string } | null>(null);
  const changesTabMounted = isDockTabMounted('changes');
  const gitKey = `${pouPath ?? ''}|${dutPath ?? ''}`;
  useEffect(() => {
    if (!changesTabMounted || compareBase !== 'git' || gitBaseline?.key === gitKey) return;
    if (!pouPath) {
      setGitBaseline({ key: gitKey, loading: false, error: 'Open the POU from its folder (Browse) to compare with git' });
      return;
    }
    setGitBaseline({ key: gitKey, loading: true });
    void (async () => {
      const pou = await fetchCommittedVersion(pouPath);
      const dut = dutPath ? await fetchCommittedVersion(dutPath) : null;
      setGitBaseline({
        key: gitKey,
        loading: false,
        pou: pou.content,
        dut: dut?.content,
        error: pou.error,
        note: !pou.error && dutPath && !dut?.content ? `The enum was not compared (${dut?.error ?? 'not committed'})` : undefined,
      });
    })();
  }, [changesTabMounted, compareBase, gitKey, gitBaseline?.key, pouPath, dutPath]);
  const savedBaseline =
    isXaeHost() && pouPath && hostSavedContent[pouPath] !== undefined
      ? { pou: hostSavedContent[pouPath], dut: (dutPath && hostSavedContent[dutPath]) || dutContent }
      : loadedBaseline;
  const chartDiff = useMemo(() => {
    if (!changesTabMounted) return null;
    const baseline = compareBase === 'git' ? (gitBaseline?.pou ? { pou: gitBaseline.pou, dut: gitBaseline.dut ?? dutContent } : null) : savedBaseline;
    if (!baseline?.pou || !pouContent) return null;
    return diffCharts(baseline, { pou: pouContent, dut: dutContent });
  }, [changesTabMounted, compareBase, gitBaseline, savedBaseline.pou, savedBaseline.dut, pouContent, dutContent]);
  const diffHighlight = useMemo(() => {
    if (!compareOnDiagram || !chartDiff || chartDiff.total === 0) return null;
    return {
      added: chartDiff.statesAdded,
      changed: chartDiff.statesChanged,
      edgesAdded: chartDiff.transitionsAdded.map((t) => ({ from: t.from, to: t.to })),
      edgesChanged: chartDiff.guardsChanged.map((t) => ({ from: t.from, to: t.to })),
    };
  }, [compareOnDiagram, chartDiff]);

  // Project documentation: every state machine of the PLC project in one HTML document
  const [docProgress, setDocProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const docCancelRef = useRef(false);
  const handleDocumentProject = useCallback(async () => {
    setIsExportMenuOpen(false);
    docCancelRef.current = false;
    setDocProgress({ done: 0, total: 0, name: 'Reading the project...' });
    try {
      const files = await loadProjectFiles(pouPath);
      if ('error' in files && files.error) {
        if (files.error !== 'canceled') showCopyToast(files.error, 'error');
        return;
      }
      const project = files as Exclude<typeof files, { error: string }>;
      const doc = await buildProjectDocumentation(
        { project: project.project ?? 'PLC project', pous: project.pous ?? [], duts: project.duts ?? [] },
        { flowchartOutput, collapseErrorSinkEdges, includeStateDescriptions, showTransitionPriorities, priorityFormat },
        (done, total, name) => setDocProgress({ done, total, name }),
        () => docCancelRef.current
      );
      if (!doc) {
        showCopyToast('Documentation canceled', 'error');
        return;
      }
      if (doc.count === 0) {
        showCopyToast('No state machines (POUs with a doState() CASE) were found in the project', 'error');
        return;
      }
      const saved = await saveDocument(`${(project.project ?? 'project').replace(/[^\w.-]+/g, '_')}-state-machines.html`, doc.html);
      if (saved.error) showCopyToast(`Could not save the documentation: ${saved.error}`, 'error');
      else if (!saved.canceled) showCopyToast(`Documented ${doc.count} state machines${saved.path ? `: ${saved.path}` : ''}`, 'success', 8000);
    } finally {
      setDocProgress(null);
    }
  }, [pouPath, flowchartOutput, collapseErrorSinkEdges, choiceNodes, includeStateDescriptions, showTransitionPriorities, priorityFormat, showCopyToast]);

  // Edits from the diagram: rename a state, add a state, add a transition (connect mode)
  const [promptRequest, setPromptRequest] = useState<TextPromptRequest | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  useEffect(() => {
    if (!connectFrom) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setConnectFrom(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connectFrom]);
  const stateVarName = identifiedStatesResult.stateVarName || 'machineState';
  const handleRenameState = useCallback(
    (oldName: string) =>
      setPromptRequest({
        title: `Rename ${oldName}`,
        label: 'New name (the enum, CASE labels, transitions and every other use in the POU change with it)',
        initial: oldName,
        monospace: true,
        submitLabel: 'Rename',
        validate: (v) => checkNewStateName(pouContent, dutContent, v, oldName),
        onSubmit: (newName) => {
          const r = renameState(pouContent, dutContent, oldName, newName);
          handleReplaceSources(r.pou, dutContent ? r.dut : null);
          setCustomNodeStyles((m) => renameKey(m, oldName, newName) ?? m);
          setCustomEdgeStyles((m) => renameEdgeKeys(m, oldName, newName) ?? m);
          setNodeOffsets((m) => renameKey(m, oldName, newName) ?? m);
          setCanvasPositions((m) => renameKey(m, oldName, newName) ?? m);
          setDiagramNotes((n) => ({
            ...n,
            nodes: renameKey(n.nodes, oldName, newName) ?? n.nodes,
            edges: renameEdgeKeys(n.edges, oldName, newName) ?? n.edges,
            positions: renameEdgeKeys(renameKey(n.positions, oldName, newName), oldName, newName),
            styles: renameEdgeKeys(renameKey(n.styles, oldName, newName), oldName, newName),
          }));
          if (selectedStateId === oldName) {
            setSelectedStateId(newName);
            setSelectedStateLabel(newName);
          }
          const where = `${r.pouCount} place${r.pouCount === 1 ? '' : 's'} in the POU${dutContent ? `, ${r.dutCount} in the enum` : ''}`;
          showCopyToast(`Renamed ${oldName} to ${newName}: ${where}`, 'success');
        },
      }),
    [pouContent, dutContent, handleReplaceSources, selectedStateId, showCopyToast]
  );
  const handleAddState = useCallback(
    () =>
      setPromptRequest({
        title: 'Add a state',
        label: 'Name (added to the enum, with an empty CASE branch in doState())',
        placeholder: 'e.g. TABLEMANAGER_WAIT_FOR_DOOR',
        monospace: true,
        submitLabel: 'Add state',
        validate: (v) => (v ? checkNewStateName(pouContent, dutContent, v) : 'Enter a name'),
        onSubmit: (name) => {
          const added = addState(pouContent, dutContent, name);
          if (!added) {
            showCopyToast('doState() has no CASE to add the state to', 'error');
            return;
          }
          const pou = updateMethodCodeInPou(pouContent, 'doState', added.pouCode);
          if (!pou.success) {
            showCopyToast(pou.error || 'Could not add the state', 'error');
            return;
          }
          handleReplaceSources(pou.updatedPou, added.dut);
          showCopyToast(`Added ${name}${added.dut ? ' to the enum and' : ''} to doState(): connect it with Add transition`, 'success');
        },
      }),
    [pouContent, dutContent, handleReplaceSources, showCopyToast]
  );
  // Parallel regions (Fork / Join): a region's transitions set its own state variable
  const regionOf = useMemo(() => regionVariables(pouContent, dutContent, stateVarName), [pouContent, dutContent, stateVarName]);
  const regionOfRef = useRef(regionOf);
  regionOfRef.current = regionOf;
  const varFor = useCallback((state: string) => regionOfRef.current.get(state)?.variable ?? stateVarName, [stateVarName]);

  // What a connect-mode click makes: a transition (with a condition), a completion transition (none), an exception
  // transition (checked first; from a composite: in preProcess())
  const connectKindRef = useRef<{ kind: 'transition' | 'completion' | 'exception'; composite?: string }>({ kind: 'transition' });
  const handleConnectTo = useCallback(
    (to: string) => {
      const from = connectFrom;
      const { kind, composite } = connectKindRef.current;
      connectKindRef.current = { kind: 'transition' };
      setConnectFrom(null);
      if (!from) return;
      // In a parallel region: its own variable, and only its own states
      const region = regionOf.get(from);
      if (!composite && (regionOf.get(to)?.variable ?? null) !== (region?.variable ?? null)) {
        showCopyToast(region ? `${to} is not in ${from}'s region (${region.variable})` : `${to} is in a parallel region: its fork enters it`, 'error');
        return;
      }
      const v = region?.variable ?? stateVarName;
      if (kind === 'completion') {
        const r = addCompletionTransition(pouContent, from, to, v);
        if ('error' in r) return showCopyToast(r.error, 'error');
        handleReplaceSources(r.pou, null);
        showCopyToast(`Added the completion transition ${from} → ${to} (no condition, last in its branch)`, 'success');
        return;
      }
      if (kind === 'exception') {
        setPromptRequest({
          title: `Exception transition ${from} → ${to}`,
          label: composite
            ? `Condition (Structured Text). Checked in preProcess() for every state of ${composite}:`
            : "Condition (Structured Text). Checked before the state's code and its other transitions:",
          initial: 'bError',
          monospace: true,
          submitLabel: 'Add exception transition',
          validate: (v) => (v ? null : 'Enter a condition'),
          onSubmit: (condition) => {
            const r = addExceptionTransition(pouContent, dutContent, composite ? { composite } : { state: from }, to, condition, v);
            if ('error' in r) return showCopyToast(r.error, 'error');
            handleReplaceSources(r.pou, null);
            showCopyToast(`Added the exception transition ${from} → ${to} in ${r.where}`, 'success');
          },
        });
        return;
      }
      setPromptRequest({
        title: `New transition ${from} → ${to}`,
        label: "Condition (Structured Text). The transition is added at the end of the state's branch:",
        initial: 'TRUE',
        monospace: true,
        hint: `IF <condition> THEN ${stateVarName} := ${to}; END_IF`,
        submitLabel: 'Add transition',
        validate: (v) => (v ? null : 'Enter a condition (TRUE for always)'),
        onSubmit: (condition) => {
          const code = addTransition(pouContent, from, to, condition, v);
          if (!code) {
            showCopyToast(`${from} has no CASE branch in doState()`, 'error');
            return;
          }
          const result = handleSaveMethodCode('doState', code);
          if (!result?.success) showCopyToast(result?.error || 'Could not add the transition', 'error');
          else showCopyToast(`Added the transition ${from} → ${to}`, 'success');
        },
      });
    },
    [connectFrom, pouContent, dutContent, stateVarName, regionOf, handleSaveMethodCode, handleReplaceSources, showCopyToast]
  );

  // Transitions edited on the canvas (priority, start / end moved): doState() / preProcess() rewritten, the chart
  // regenerated (Save writes the files)
  const applyTransitionEdit = useCallback(
    (r: TransitionEditResult) => {
      if ('error' in r) {
        showCopyToast(r.error, 'error', 6000);
        return false;
      }
      const result = handleSaveMethodCode(r.method, r.code);
      if (!result?.success) {
        showCopyToast(result?.error || 'Could not change the code', 'error');
        return false;
      }
      showCopyToast(r.message, 'success');
      return true;
    },
    [handleSaveMethodCode, showCopyToast]
  );
  // The edge as the chart has it now (its priority changes with each edit)
  const currentEdge = useCallback((edge: EdgeInfo) => availableEdges.find((e) => e.id === edge.id) ?? edge, [availableEdges]);
  const handleTransitionPriority = useCallback(
    (edge: EdgeInfo, priority: number) => pouContent && applyTransitionEdit(setTransitionPriority(pouContent, currentEdge(edge), priority, varFor(edge.from))),
    [pouContent, applyTransitionEdit, currentEdge, stateVarName]
  );
  const handleTransitionPriorityStep = useCallback(
    (edge: EdgeInfo, delta: number) => {
      if (!pouContent) return;
      const order = transitionOrder(pouContent, currentEdge(edge), varFor(edge.from));
      if ('error' in order) showCopyToast(order.error, 'error', 6000);
      else if (order.count < 2) showCopyToast(`${edge.from} has only this transition`, 'error');
      else handleTransitionPriority(edge, order.priority + delta);
    },
    [pouContent, currentEdge, stateVarName, handleTransitionPriority, showCopyToast]
  );
  const knownStates = useMemo(() => new Set(identifiedStatesResult.states.map((st) => st.id)), [identifiedStatesResult]);
  const handleEdgeEndpointDrop = useCallback(
    (edge: EdgeInfo, end: 'start' | 'end', stateId: string) => {
      if (!pouContent) return;
      if (!knownStates.has(stateId)) {
        showCopyToast(`${stateId} is not a state of the enum / doState() (a composite state?)`, 'error');
        return;
      }
      const e = currentEdge(edge);
      if ((regionOfRef.current.get(e.from)?.variable ?? null) !== (regionOfRef.current.get(stateId)?.variable ?? null)) {
        showCopyToast(`${stateId} is ${regionOfRef.current.has(stateId) ? 'in another parallel region' : 'outside the parallel region'}`, 'error');
        return;
      }
      applyTransitionEdit(end === 'end' ? retargetTransition(pouContent, e, stateId, varFor(e.from)) : moveTransitionStart(pouContent, e, stateId, varFor(e.from)));
      const taken = seen[seenKey(e.from, e.to)];
      if (taken) showCopyToast(`⚠ The PLC took ${e.from} → ${e.to} ${seenText(taken)}: the running machine uses it (Undo: Ctrl+Z)`, 'error', 8000);
    },
    [pouContent, knownStates, currentEdge, applyTransitionEdit, stateVarName, showCopyToast, seen]
  );
  // Copy / paste a state: a new state with a copy of its code (enum member, branches), then Rename… opens for it
  const copiedStateRef = useRef<string | null>(null);
  const [pendingRename, setPendingRename] = useState<string | null>(null);
  const handleCopyState = useCallback(
    (id: string) => {
      copiedStateRef.current = id;
      showCopyToast(`Copied ${id}: Ctrl+V (or right-click the canvas) pastes a new state with its code`, 'success');
    },
    [showCopyToast]
  );
  const handlePasteState = useCallback(() => {
    const from = copiedStateRef.current;
    if (!from || !pouContent) return;
    if (!knownStates.has(from)) {
      showCopyToast(`${from} is no longer a state`, 'error');
      return;
    }
    const name = copyName(pouContent, dutContent, from);
    const r = copyState(pouContent, dutContent, from, name, stateVarName);
    if ('error' in r) {
      showCopyToast(r.error, 'error', 6000);
      return;
    }
    handleReplaceSources(r.pou, r.dut);
    setCustomNodeStyles((m) => (m[from] ? { ...m, [name]: m[from] } : m));
    setPendingRename(name);
    showCopyToast(`Pasted ${name}: ${r.dut ? 'the enum, ' : ''}${r.methods.map((m) => `${m}()`).join(', ')}. Connect it with Add transition`, 'success', 6000);
  }, [pouContent, dutContent, knownStates, stateVarName, handleReplaceSources, showCopyToast]);
  // Once the chart has the pasted state: shown, selected, and its name asked for
  useEffect(() => {
    if (!pendingRename || !knownStates.has(pendingRename)) return;
    const name = pendingRename;
    setPendingRename(null);
    handleJumpToState(name);
    handleRenameState(name);
  }, [pendingRename, knownStates, handleJumpToState, handleRenameState]);

  const dropStateKeys = useCallback((id: string) => {
    const drop = <T,>(m: Record<string, T> | undefined) => {
      if (!m || !(id in m)) return m;
      const next = { ...m };
      delete next[id];
      return next;
    };
    setCustomNodeStyles((m) => drop(m) ?? m);
    setNodeOffsets((m) => drop(m) ?? m);
    setCanvasPositions((m) => drop(m) ?? m);
    setDiagramNotes((n) => ({ ...n, nodes: drop(n.nodes) ?? n.nodes, positions: drop(n.positions), styles: drop(n.styles) }));
  }, []);
  const handleDeleteState = useCallback(
    (id: string) => {
      if (!pouContent || id === '[*]') return;
      const r = deleteState(pouContent, dutContent, id, stateVarName);
      if ('error' in r) {
        showCopyToast(r.error, 'error', 6000);
        return;
      }
      const details = [
        ...(r.dut ? [`The enum member ${id}${r.renumbered ? ' (the members after it get new values: they have none of their own)' : ''}`] : []),
        ...r.methods.map((m) => `Its branch in ${m}()`),
        ...r.transitions.map((t) => `The transition ${t}`),
        ...r.kept.map((k) => `Not deleted, change it yourself: ${k}`),
        ...r.remaining.map((k) => `Still refers to it: ${k}`),
      ];
      const inState = stateSeen(seen, id);
      setPromptRequest({
        title: `Delete ${id}?`,
        label: `${inState.n ? `⚠ The PLC went into or out of ${id} ${seenText(inState)}: the running machine uses it. ` : ''}Deleted from the POU and the enum (Save writes them to the project):`,
        details,
        confirmOnly: true,
        danger: true,
        submitLabel: 'Delete state',
        onSubmit: () => {
          handleReplaceSources(r.pou, r.dut);
          dropStateKeys(id);
          if (selectedStateId === id) {
            setSelectedStateId(null);
            setSelectedStateLabel('');
          }
          const left = r.kept.length + r.remaining.length;
          showCopyToast(`Deleted ${id}${r.transitions.length ? ` and ${r.transitions.length} transition${r.transitions.length === 1 ? '' : 's'} into it` : ''}${left ? `: ${left} place${left === 1 ? '' : 's'} still refer to it (Problems)` : ''}`, left ? 'error' : 'success', 7000);
        },
      });
    },
    [pouContent, dutContent, stateVarName, handleReplaceSources, dropStateKeys, selectedStateId, showCopyToast, seen]
  );
  const handleDeleteTransition = useCallback(
    (edge: EdgeInfo) => {
      if (!pouContent) return;
      const e = currentEdge(edge);
      const r = deleteTransition(pouContent, e, varFor(e.from));
      if ('error' in r) {
        showCopyToast(r.error, 'error', 6000);
        return;
      }
      const gone = (r.removed ?? []).map((l) => l.trim()).filter(Boolean);
      const taken = seen[seenKey(e.from, e.to)];
      setPromptRequest({
        title: `Delete ${e.from} → ${e.to}?`,
        label: `${taken ? `⚠ The PLC took this transition ${seenText(taken)}: the running machine uses it. ` : ''}Its code in ${r.method}() is deleted (Save writes it to the project):`,
        details: gone.length <= 12 ? gone : [...gone.slice(0, 11), `… ${gone.length - 11} more lines`],
        confirmOnly: true,
        danger: true,
        submitLabel: 'Delete transition',
        onSubmit: () => applyTransitionEdit(r),
      });
    },
    [pouContent, currentEdge, stateVarName, applyTransitionEdit, showCopyToast, seen]
  );

  // The statechart palette: elements dropped on the canvas become ST (Save writes the files)
  const [choiceRequest, setChoiceRequest] = useState<ChoiceRequest | null>(null);
  const [forkJoinRequest, setForkJoinRequest] = useState<ForkJoinRequest | null>(null);
  const [placeRequest, setPlaceRequest] = useState<{ stateId: string; x: number; y: number; nonce: number } | null>(null);
  // The POU's child state machines (members of state-machine types)
  const machineMembers = useMemo(() => declaredMachineMembers(pouContent), [pouContent]);
  const composites = useMemo(() => (dutContent ? enumComposites(dutContent) : []), [dutContent]);
  const chartComposites = useMemo(() => {
    try {
      return pouContent ? generateStatechartModel(dutContent, pouContent, {}).composites : {};
    } catch {
      return {} as Record<string, string[]>;
    }
  }, [pouContent, dutContent]);
  const compositeOfState = useCallback((state: string) => Object.entries(chartComposites).find(([, members]) => members.includes(state))?.[0] ?? null, [chartComposites]);
  const isFinal = useCallback((state: string) => isFinalState(pouContent, state) || (!!dutContent.trim() && enumMarksOf(dutContent, state).final), [pouContent, dutContent]);
  const compositeNames = useMemo(() => new Set(composites.map((c) => c.name)), [composites]);
  const stateNames = useMemo(() => [...knownStates].filter((st) => st !== '[*]').sort(), [knownStates]);
  // A name for a new state: the machine's prefix and a free suffix
  const newStateName = useCallback(
    (suffix: string) => {
      const prefix = stateNames.length > 1 ? stateNames.reduce((a, b) => { let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return a.slice(0, k); }).replace(/[^_]*$/, '') : '';
      for (let i = 1; ; i++) {
        const n = `${prefix}${suffix}${i === 1 ? '' : i}`;
        if (!checkNewStateName(pouContent, dutContent, n)) return n;
      }
    },
    [stateNames, pouContent, dutContent]
  );
  /** A new state (optionally final, in a composite), its description, placed where it was dropped */
  const createState = useCallback(
    (name: string, opts: { composite?: string | null; final?: boolean; at?: { x: number; y: number } | null; newComposite?: string; from?: { state: string; condition: string } }) => {
      let pou = addCaseBranch(pouContent, name);
      if (!pou) return showCopyToast('doState() has no CASE to add the state to', 'error');
      const u = updateMethodCodeInPou(pouContent, 'doState', pou);
      if (!u.success) return showCopyToast(u.error || 'Could not add the state', 'error');
      pou = u.updatedPou;
      // From a state: the transition to it (at the end of that state's branch)
      if (opts.from) {
        const code = addTransition(pou, opts.from.state, name, opts.from.condition, stateVarName);
        const t = code ? updateMethodCodeInPou(pou, 'doState', code) : null;
        if (!t?.success) return showCopyToast(`${opts.from.state} has no CASE branch in doState()`, 'error');
        pou = t.updatedPou;
      }
      pou = addStateDescription(pou, name, describeName(name, stateNames));
      if (opts.final && !dutContent.trim()) {
        const fin = setFinalState(pou, name, true);
        if ('error' in fin) return showCopyToast(fin.error, 'error');
        pou = fin.pou;
      }
      let dut: string | null = null;
      if (dutContent.trim()) {
        dut = addEnumMemberIn(dutContent, name, opts.composite ?? null);
        if (dut && opts.newComposite) dut = wrapInComposite(dut, name, opts.newComposite);
        if (dut && opts.final) dut = setEnumMark(dut, name, 'final', true);
        if (!dut) return showCopyToast(`Could not add ${name} to the enum${opts.composite ? ` (in ${opts.composite})` : ''}`, 'error');
      } else if (opts.composite || opts.newComposite) {
        return showCopyToast('Load the .TcDUT enum first: composites are regions in it', 'error');
      }
      handleReplaceSources(pou, dut);
      if (opts.from) setPendingShow(name);
      // (a state in a composite stays where the layout puts it: in the composite's box)
      if (opts.at && !opts.composite && !opts.newComposite) setPlaceRequest({ stateId: name, x: opts.at.x, y: opts.at.y, nonce: Date.now() });
      const where = opts.newComposite ? ` in the new composite ${opts.newComposite}` : opts.composite ? ` in ${opts.composite}` : '';
      showCopyToast(
        opts.from
          ? `Added ${name}${where} and the transition ${opts.from.state} → ${name}: ${dut ? 'the enum, ' : ''}doState()${pou.includes('getStateDescription') ? ', getStateDescription()' : ''}`
          : `Added ${opts.final ? 'the final state ' : ''}${name}${where}: ${dut ? 'the enum, ' : ''}doState()${pou.includes('getStateDescription') ? ', getStateDescription()' : ''}. Connect it with Transition`,
        'success',
        6000
      );
    },
    [pouContent, dutContent, stateNames, stateVarName, handleReplaceSources, showCopyToast]
  );
  // A state added from another: shown (and selected) once the chart has it
  const [pendingShow, setPendingShow] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingShow || !knownStates.has(pendingShow)) return;
    const name = pendingShow;
    setPendingShow(null);
    handleJumpToState(name);
  }, [pendingShow, knownStates, handleJumpToState]);
  /** Right-click a state > Add new state from here: its name, then the transition's condition */
  const handleAddStateFrom = useCallback(
    (from: string) => {
      if (regionOf.has(from)) return showCopyToast(`${from} is in a parallel region: add its states with the region's CASE in the Method Editor`, 'error');
      const composite = dutContent.trim() ? compositeOf(dutContent, from) : null;
      setPromptRequest({
        title: `New state from ${from}`,
        label: `Name of the new state (an enum member${composite ? ` in ${composite}` : ''}, a CASE branch in doState()). Then the condition of ${from} → it.`,
        initial: newStateName(`${from.replace(/^.*?_/, '')}_NEXT`.replace(/^_/, '')),
        monospace: true,
        submitLabel: 'Next: condition',
        validate: (v) => (v ? checkNewStateName(pouContent, dutContent, v) : 'Enter a name'),
        onSubmit: (name) =>
          // (after this dialog closes)
          setTimeout(
            () =>
              setPromptRequest({
                title: `Transition ${from} → ${name}`,
                label: `Condition (Structured Text). Written at the end of ${from}'s branch:`,
                initial: 'TRUE',
                monospace: true,
                hint: `IF <condition> THEN ${stateVarName} := ${name}; END_IF`,
                submitLabel: 'Add state and transition',
                validate: (v) => (v ? null : 'Enter a condition (TRUE for always)'),
                onSubmit: (condition) => createState(name, { composite, from: { state: from, condition } }),
              }),
            0
          ),
      });
    },
    [regionOf, dutContent, pouContent, stateVarName, newStateName, createState, showCopyToast]
  );
  const askNewState = useCallback(
    (opts: { composite?: string | null; final?: boolean; at?: { x: number; y: number } | null; newComposite?: string }) =>
      setPromptRequest({
        title: opts.final ? 'New final state' : opts.newComposite ? `First state of ${opts.newComposite}` : `New state${opts.composite ? ` in ${opts.composite}` : ''}`,
        label: `Name (an enum member${opts.composite || opts.newComposite ? ' in the composite' : ''} and a CASE branch in doState()${opts.final ? ', marked (* final *)' : ''})`,
        initial: newStateName(opts.final ? 'DONE' : 'NEW_STATE'),
        monospace: true,
        submitLabel: 'Add state',
        validate: (v) => (v ? checkNewStateName(pouContent, dutContent, v) : 'Enter a name'),
        onSubmit: (name) => createState(name, opts),
      }),
    [newStateName, pouContent, dutContent, createState]
  );
  const askCompositeName = useCallback(
    (title: string, onName: (name: string) => void) =>
      setPromptRequest({
        title,
        label: 'Composite name (a {region "…"} around its members in the enum)',
        initial: 'NewComposite',
        monospace: true,
        submitLabel: 'OK',
        validate: (v) =>
          !isValidCompositeName(v) ? 'Letters, digits, _ and spaces' : compositeNames.has(v) ? `${v} already exists` : knownStates.has(v) ? `${v} is a state` : null,
        onSubmit: onName,
      }),
    [compositeNames, knownStates]
  );
  const dropNodeOffset = useCallback((state: string) => setNodeOffsets((m) => {
    if (!m || !(state in m)) return m;
    const next = { ...m };
    delete next[state];
    return next;
  }), []);
  const handleSetInitial = useCallback(
    (state: string) => {
      const r = setInitialState(pouContent, stateVarName, state);
      if ('error' in r) return showCopyToast(r.error, 'error');
      handleReplaceSources(r.pou, null);
      showCopyToast(`${state} is the initial state: ${stateVarName} := ${state} in ${r.where}`, 'success');
    },
    [pouContent, stateVarName, handleReplaceSources, showCopyToast]
  );
  // A composite's initial state: marked in the enum (the only one of its composite); its entry on the chart
  const handleSetCompositeInitial = useCallback(
    (state: string) => {
      const composite = compositeOfState(state);
      if (!composite || !dutContent.trim()) return showCopyToast(`${state} is in no composite`, 'error');
      let dut: string | null = dutContent;
      for (const other of chartComposites[composite] ?? []) if (other !== state && dut && enumMarksOf(dut, other).initial) dut = setEnumMark(dut, other, 'initial', false);
      dut = dut && setEnumMark(dut, state, 'initial', true);
      if (!dut) return showCopyToast(`${state} was not found in the enum`, 'error');
      handleReplaceSources(null, dut);
      showCopyToast(`${state} is the initial state of ${composite} (// @initial in the enum): transitions into it end at the composite`, 'success', 6000);
    },
    [dutContent, chartComposites, compositeOfState, handleReplaceSources, showCopyToast]
  );
  const handleToggleFinal = useCallback(
    (state: string) => {
      const final = !isFinal(state);
      // In the enum (// @final) when there is one, else on the CASE label; not final: both gone
      let pou = pouContent;
      let dut: string | null = null;
      if (!final || !dutContent.trim()) {
        const r = setFinalState(pouContent, state, final);
        if ('error' in r) {
          if (!dutContent.trim()) return showCopyToast(r.error, 'error');
        } else pou = r.pou;
      }
      if (dutContent.trim()) {
        dut = setEnumMark(dutContent, state, 'final', final);
        if (!dut) return showCopyToast(`${state} was not found in the enum`, 'error');
      }
      const r = { pou };
      handleReplaceSources(r.pou === pouContent ? null : r.pou, dut);
      const out = availableEdges.filter((e) => e.from === state && e.to !== '[*]').length;
      // (in a composite, a final state's transitions out are the composite's: drawn from its border)
      const composite = compositeOfState(state);
      const where = dutContent.trim() ? ' (// @final in the enum)' : ' (* final *)';
      const note = composite ? `: its transitions out start at ${composite}` : out ? `: it still has ${out} transition${out === 1 ? '' : 's'} out` : '';
      showCopyToast(final ? `${state} is a final state${where}${note}` : `${state} is no final state`, final && out && !composite ? 'error' : 'success');
    },
    [pouContent, dutContent, availableEdges, isFinal, handleReplaceSources, showCopyToast]
  );
  const handleMoveToComposite = useCallback(
    (state: string) => {
      if (!dutContent.trim()) return showCopyToast('Load the .TcDUT enum first: composites are regions in it', 'error');
      const current = compositeOf(dutContent, state);
      setPromptRequest({
        title: `Composite of ${state}`,
        label: `${current ? `In ${current} now. ` : ''}The composite to move it to (empty: none). The members after its old and new place get new values when they have none of their own.${composites.length ? ` Composites: ${composites.map((c) => c.name).join(', ')}` : ''}`,
        initial: current ?? '',
        monospace: true,
        submitLabel: 'Move',
        validate: (v) => (!v || compositeNames.has(v) ? null : `No composite ${v} (add one with the palette's Composite)`),
        onSubmit: (target) => {
          if ((target || null) === current) return;
          const removed = removeEnumMember(dutContent, state);
          const added = removed && addEnumMemberIn(removed.dut, state, target || null);
          if (!added) return showCopyToast(`Could not move ${state} in the enum`, 'error');
          handleReplaceSources(null, dropEmptyComposites(added));
          dropNodeOffset(state);
          showCopyToast(target ? `${state} is in ${target}` : `${state} is in no composite`, 'success');
        },
      });
    },
    [dutContent, composites, compositeNames, handleReplaceSources, dropNodeOffset, showCopyToast]
  );
  // A state's node released over another {region} composite (or out of its own): with Alt it moves there
  const handleStateDropped = useCallback(
    (state: string, clusters: string[], altKey: boolean) => {
      if (!dutContent.trim() || !knownStates.has(state) || regionOf.has(state)) return;
      const current = compositeOf(dutContent, state);
      const target = clusters.find((c) => compositeNames.has(c)) ?? null;
      if (target === current) return;
      if (!altKey) {
        showCopyToast(target ? `Hold Alt while dropping to move ${state} into ${target}` : `Hold Alt while dropping to move ${state} out of ${current}`, 'success', 5000);
        return;
      }
      const removed = removeEnumMember(dutContent, state);
      const added = removed && addEnumMemberIn(removed.dut, state, target);
      if (!added) return showCopyToast(`Could not move ${state} in the enum`, 'error');
      handleReplaceSources(null, dropEmptyComposites(added));
      dropNodeOffset(state);
      showCopyToast(
        `${target ? `${state} is in ${target}` : `${state} is in no composite`}${removed.renumbered ? ' (the members after its old place get new values: they have none of their own)' : ''}`,
        'success',
        6000
      );
    },
    [dutContent, knownStates, regionOf, compositeNames, handleReplaceSources, dropNodeOffset, showCopyToast]
  );
  const handlePaletteElement = useCallback(
    (kind: PaletteElement, at: { stateId: string | null; composite: string | null; x: number; y: number } | null) => {
      if (!pouContent) return;
      // A drop on a composite's own node (stateDiagram) is a drop in it
      const onComposite = at?.stateId && compositeNames.has(at.stateId) ? at.stateId : null;
      const state = at ? (at.stateId && knownStates.has(at.stateId) && at.stateId !== '[*]' ? at.stateId : null) : selectedStateId;
      const composite = onComposite ?? at?.composite ?? null;
      const where = at ? { x: at.x, y: at.y } : null;
      const needState = (what: string) => showCopyToast(`Drop ${what} on a state${at ? '' : ' (or select one and click it)'}`, 'error');
      switch (kind) {
        case 'state':
          return askNewState({ composite: composite && compositeNames.has(composite) ? composite : null, at: where });
        case 'final':
          if (state && at) return handleToggleFinal(state);
          return askNewState({ composite: composite && compositeNames.has(composite) ? composite : null, final: true, at: where });
        case 'initial':
          if (!state) return needState('Initial');
          // Dropped in a composite: its initial state; else the machine's
          return at?.composite && compositeOfState(state) && dutContent.trim() ? handleSetCompositeInitial(state) : handleSetInitial(state);
        case 'choice':
          if (!state) return needState('Choice');
          return setChoiceRequest({
            from: state,
            states: stateNames,
            onSubmit: (rows, elseTo) => {
              const res = addChoice(pouContent, state, rows, elseTo, varFor(state));
              if ('error' in res) return showCopyToast(res.error, 'error');
              handleReplaceSources(res.pou, null);
              showCopyToast(`Added a choice to ${state}: ${rows.length + (elseTo ? 1 : 0)} transitions`, 'success');
            },
          });
        case 'composite':
          if (!dutContent.trim()) return showCopyToast('Load the .TcDUT enum first: composites are regions in it', 'error');
          if (state && at) {
            return askCompositeName(`New composite around ${state}`, (name) => {
              const dut = wrapInComposite(dutContent, state, name);
              if (!dut) return showCopyToast(`${state} was not found in the enum`, 'error');
              handleReplaceSources(null, dut);
              dropNodeOffset(state);
              showCopyToast(`${state} is in the new composite ${name}: add states to it with State`, 'success');
            });
          }
          return askCompositeName('New composite', (name) => askNewState({ composite: composite && compositeNames.has(composite) ? composite : null, newComposite: name, at: where }));
        case 'transition':
        case 'completion':
          if (!state) return needState(kind === 'completion' ? 'Completion transition' : 'Transition');
          connectKindRef.current = { kind };
          setConnectFrom(state);
          return;
        case 'exception': {
          // From a state, or (dropped in a composite, off its states) from the composite
          const fromComposite = !state && composite && compositeNames.has(composite) ? composite : null;
          if (!state && !fromComposite) return needState('Exception transition');
          connectKindRef.current = { kind: 'exception', composite: fromComposite ?? undefined };
          setConnectFrom(state ?? fromComposite);
          return;
        }
        case 'pointer':
          connectKindRef.current = { kind: 'transition' };
          setConnectFrom(null);
          return;
        case 'forkjoin':
          // The child state machines run in parallel: the state starts them and waits for all of them
          if (!state) return needState('Fork/Join');
          if (regionOf.has(state)) return showCopyToast(`${state} is in a parallel region already`, 'error');
          {
            // Suggested regions: free variable and state names
            const taken = (n: string) => new RegExp(`\\b${n}\\b`, 'i').test(pouContent) || knownStates.has(n);
            const free = (base: string) => {
              for (let i = 1; ; i++) if (!taken(`${base}${i === 1 ? '' : i}`)) return `${base}${i === 1 ? '' : i}`;
            };
            const nextRegion = (i: number) => {
              const letter = String.fromCharCode(65 + (i % 26));
              return { variable: free(`region${letter}`), states: [free(`${state}_${letter}_RUN`), free(`${state}_${letter}_DONE`)] };
            };
            return setForkJoinRequest({
              from: state,
              states: stateNames.filter((st) => !regionOf.has(st)),
              regions: [nextRegion(0), nextRegion(1)],
              nextRegion,
              onSubmit: (regions, target) => {
                const res = addForkJoinRegions(pouContent, dutContent, state, regions, target, stateVarName);
                if ('error' in res) return showCopyToast(res.error, 'error', 6000);
                handleReplaceSources(res.pou, res.dut);
                showCopyToast(`Added a fork / join to ${state}: ${regions.map((x) => x.variable).join(', ')} in parallel, then ${target} when all are done. Draw the regions' transitions with Transition`, 'success', 7000);
              },
            });
          }
      }
    },
    [pouContent, dutContent, compositeNames, knownStates, selectedStateId, stateNames, stateVarName, regionOf, varFor, askNewState, askCompositeName, handleToggleFinal, handleSetInitial, handleSetCompositeInitial, compositeOfState, handleReplaceSources, dropNodeOffset, showCopyToast]
  );

  // Undo / Redo: the POU and the enum as they were before each edit (edits within a second of each other are one
  // step); another file starts a new history
  type Snapshot = { pou: string; dut: string };
  const historyRef = useRef<{ past: Snapshot[]; future: Snapshot[]; last: Snapshot | null; lastAt: number; applying: boolean; file: string }>({
    past: [],
    future: [],
    last: null,
    lastAt: 0,
    applying: false,
    file: '',
  });
  const [historyVersion, setHistoryVersion] = useState(0);
  useEffect(() => {
    const h = historyRef.current;
    const snap = { pou: pouContent, dut: dutContent };
    const file = `${pouPath ?? ''}|${pouFileName}`;
    if (h.file !== file || !h.last) {
      h.file = file;
      h.past = [];
      h.future = [];
      h.last = snap;
      h.applying = false;
      setHistoryVersion((v) => v + 1);
      return;
    }
    if (h.last.pou === snap.pou && h.last.dut === snap.dut) return;
    if (h.applying) h.applying = false;
    else {
      const now = Date.now();
      if (now - h.lastAt > 1000 || h.past.length === 0) h.past.push(h.last);
      if (h.past.length > 100) h.past.shift();
      h.future = [];
      h.lastAt = now;
    }
    h.last = snap;
    setHistoryVersion((v) => v + 1);
  }, [pouContent, dutContent, pouPath, pouFileName]);
  const stepHistory = useCallback(
    (back: boolean) => {
      const h = historyRef.current;
      const from = back ? h.past : h.future;
      const to = back ? h.future : h.past;
      const snap = from.pop();
      if (!snap || !h.last) return showCopyToast(back ? 'Nothing to undo' : 'Nothing to redo', 'error');
      to.push(h.last);
      h.applying = true;
      h.lastAt = 0;
      handleReplaceSources(snap.pou !== pouContent ? snap.pou : null, snap.dut !== dutContent ? snap.dut : null);
      setHistoryVersion((v) => v + 1);
      showCopyToast(`${back ? 'Undone' : 'Redone'} (${h.past.length} to undo, ${h.future.length} to redo)`, 'success');
    },
    [pouContent, dutContent, handleReplaceSources, showCopyToast]
  );
  const historyState = useMemo(() => ({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 }), [historyVersion]);

  const handleCanvasKey = useCallback(
    (e: KeyboardEvent, sel: { stateId: string | null; edge: EdgeInfo | null }) => {
      // Alt+Up / Alt+Down: the selected transition's priority up (checked earlier) / down
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && sel.edge) {
        handleTransitionPriorityStep(sel.edge, e.key === 'ArrowUp' ? -1 : 1);
        return true;
      }
      const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
      const textSelected = !!window.getSelection()?.toString();
      // Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z): the last edit undone / redone
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
        stepHistory(!e.shiftKey);
        return true;
      }
      if (ctrl && e.key.toLowerCase() === 'y') {
        stepHistory(false);
        return true;
      }
      // Ctrl+C / Ctrl+V: copy the selected state, paste a new state with its code
      if (ctrl && e.key.toLowerCase() === 'c' && sel.stateId && sel.stateId !== '[*]' && !sel.edge && !textSelected && pouContent) {
        handleCopyState(sel.stateId);
        return true;
      }
      if (ctrl && e.key.toLowerCase() === 'v' && copiedStateRef.current && pouContent) {
        handlePasteState();
        return true;
      }
      // Delete: the selected transition, else the selected state (after a confirmation)
      if (e.key === 'Delete' && !e.ctrlKey && !e.altKey && !e.metaKey && pouContent) {
        if (sel.edge) handleDeleteTransition(sel.edge);
        else if (sel.stateId && sel.stateId !== '[*]') handleDeleteState(sel.stateId);
        else return false;
        return true;
      }
      return false;
    },
    [handleTransitionPriorityStep, pouContent, handleCopyState, handlePasteState, handleDeleteTransition, handleDeleteState, stepHistory]
  );

  // Open a state machine the diagram references (its POU in the same PLC project), with Back
  const [pouHistory, setPouHistory] = useState<{ path: string; name: string }[]>([]);
  const openPouInProject = useCallback(
    async (typeName?: string, backPath?: string) => {
      if (isXaeHost()) {
        postToHost({ type: 'openPou', typeName, path: backPath });
        return true;
      }
      const desktop = (window as unknown as { tcDesktop?: { openPouInProject?: (from: string, type?: string, path?: string) => Promise<PouSource & { error?: string }> } }).tcDesktop;
      if (desktop?.openPouInProject && pouPath) {
        const r = await desktop.openPouInProject(pouPath, typeName, backPath);
        if (r?.error || !r?.content) {
          showCopyToast(r?.error || 'Could not open the POU', 'error');
          return false;
        }
        applyLoadedPou(r);
        return true;
      }
      showCopyToast(`Open ${typeName ?? 'the POU'}.TcPOU with Browse: the web edition cannot open project files by name`, 'error');
      return false;
    },
    [pouPath, applyLoadedPou, showCopyToast]
  );
  const handleOpenReferenced = useCallback(
    async (ref: ReferencedMachine) => {
      const from = pouPath ? { path: pouPath, name: pouFileName } : null;
      if (await openPouInProject(ref.type)) {
        if (from) setPouHistory((h) => [...h, from].slice(-20));
      }
    },
    [pouPath, pouFileName, openPouInProject]
  );
  const handleBackToPreviousPou = useCallback(() => {
    const prev = pouHistory[pouHistory.length - 1];
    if (!prev) return;
    setPouHistory((h) => h.slice(0, -1));
    void openPouInProject(undefined, prev.path);
  }, [pouHistory, openPouInProject]);

  // The app's own context menu actions (paths, rename, add a transition / state, open a referenced state machine)
  // (the limits are set up further down: read when a menu opens)
  const limitMenuRef = useRef<{ stateLimits: Record<string, number>; defaultLimit: number | null; handleStateLimit: (state: string, ms: number | null) => void; pouTypeName?: string }>({ stateLimits: {}, defaultLimit: null, handleStateLimit: () => {} });
  const diagramContextMenuItems = useCallback(
    (target: ContextMenuTarget): ContextMenuExtraItem[] => {
      const items: ContextMenuExtraItem[] = [];
      // A free note (from the palette): only the viewer's note items
      if (target.type === 'node' && (target.id.startsWith('note_') || target.id.startsWith('choice_'))) return items;
      if (target.type === 'node') {
        items.push(
          { id: 'paths-from-btn', label: 'Paths from here', icon: <Route className="w-3.5 h-3.5" />, onSelect: () => findPathsFor(target.id, 'from') },
          { id: 'paths-to-btn', label: 'Paths to here', icon: <Route className="w-3.5 h-3.5 rotate-180" />, onSelect: () => findPathsFor(target.id, 'to') }
        );
        if (target.id !== '[*]' && pouContent) {
          items.push(
            { id: 'add-state-from-btn', label: 'Add new state from here…', icon: <SquarePlus className="w-3.5 h-3.5" />, title: 'A new state and the transition to it', onSelect: () => handleAddStateFrom(target.id) },
            { id: 'add-transition-btn', label: 'Add transition from here…', icon: <ArrowRightLeft className="w-3.5 h-3.5" />, title: 'Then click the target state', onSelect: () => setConnectFrom(target.id) },
            { id: 'rename-state-btn', label: 'Rename state…', icon: <PencilLine className="w-3.5 h-3.5" />, onSelect: () => handleRenameState(target.id) },
            { id: 'copy-state-btn', label: 'Copy state', icon: <ClipboardCopy className="w-3.5 h-3.5" />, title: 'Ctrl+C: then paste a new state with its code (Ctrl+V)', onSelect: () => handleCopyState(target.id) },
            { id: 'delete-state-btn', label: 'Delete state…', icon: <Trash2 className="w-3.5 h-3.5" />, title: 'Delete: the state, its code, the transitions into it and its enum member', onSelect: () => handleDeleteState(target.id) }
          );
          if (knownStates.has(target.id)) {
            if (initialStateOf(pouContent, stateVarName) !== target.id)
              items.push({ id: 'set-initial-btn', label: 'Set as initial state', icon: <CircleDot className="w-3.5 h-3.5" />, title: `${stateVarName} starts in it (its initial value in the declaration)`, onSelect: () => handleSetInitial(target.id) });
            const inComposite = dutContent.trim() ? compositeOfState(target.id) : null;
            if (inComposite && !enumMarksOf(dutContent, target.id).initial)
              items.push({ id: 'set-composite-initial-btn', label: `Initial state of ${inComposite}`, icon: <CircleDot className="w-3.5 h-3.5" />, title: '// @initial in the enum: transitions into it end at the composite', onSelect: () => handleSetCompositeInitial(target.id) });
            items.push({
              id: 'toggle-final-btn',
              label: isFinal(target.id) ? 'Not a final state' : 'Mark as final state',
              icon: <Circle className="w-3.5 h-3.5" />,
              title: dutContent.trim() ? '// @final in the enum: in a composite, its transitions out start at the composite' : '(* final *) on its CASE label',
              onSelect: () => handleToggleFinal(target.id),
            });
            if (dutContent.trim()) items.push({ id: 'move-composite-btn', label: 'Move to composite…', icon: <SquareStack className="w-3.5 h-3.5" />, onSelect: () => handleMoveToComposite(target.id) });
          }
        }
        // Stuck-state alert: how long this state may last (live: over it the state turns red)
        const { stateLimits, defaultLimit, handleStateLimit, pouTypeName: limitType } = limitMenuRef.current;
        if (target.id !== '[*]' && limitType) {
          const own = stateLimits[target.id] ?? null;
          items.push({
            id: 'time-limit-btn',
            label: own ? `Time limit (${formatLimit(own)})…` : 'Time limit…',
            icon: <Timer className="w-3.5 h-3.5" />,
            title: 'Live: how long the state may last before it counts as stuck',
            onSelect: () =>
              setPromptRequest({
                title: `Time limit of ${target.id}`,
                label: `How long ${target.id} may last before it counts as stuck (e.g. 30 s, 2 min). Empty: ${defaultLimit ? `the default, ${formatLimit(defaultLimit)}` : 'no limit'}.`,
                initial: formatLimit(own),
                placeholder: defaultLimit ? formatLimit(defaultLimit) : 'e.g. 30 s',
                monospace: true,
                submitLabel: 'Set',
                validate: (v) => (!v.trim() || parseDuration(v) !== null ? null : 'A duration, e.g. 30, 1.5 s, 2 min or 1 h'),
                onSubmit: (v) => handleStateLimit(target.id, v.trim() ? parseDuration(v) : null),
              }),
          });
        }
      }
      // Right-clicking the empty canvas with a state selected opens the state's menu: Add state is there too
      if ((target.type === 'canvas' || target.type === 'node') && pouContent) {
        items.push({ id: 'add-state-btn', label: 'Add state…', icon: <SquarePlus className="w-3.5 h-3.5" />, onSelect: handleAddState });
        if (copiedStateRef.current)
          items.push({ id: 'paste-state-btn', label: `Paste a copy of ${copiedStateRef.current}`, icon: <ClipboardPaste className="w-3.5 h-3.5" />, title: 'Ctrl+V: a new state with its code', onSelect: handlePasteState });
      }
      // A transition's priority (its order in the state's doState() branch, or in preProcess())
      if (target.type === 'edge' && pouContent) {
        const edge = availableEdges.find((e) => e.id === target.id) ?? { id: target.id, from: target.from, to: target.to, label: target.label };
        const order = transitionOrder(pouContent, edge, varFor(edge.from));
        if (!('error' in order) && order.count > 1) {
          const pre = order.method === 'preProcess';
          const where = pre ? 'preProcess()' : `${edge.from}`;
          if (order.priority > 1)
            items.push({
              id: 'priority-up-btn',
              label: pre ? `Earlier in preProcess() (${order.priority} → ${order.priority - 1})` : `Raise priority (${order.priority} → ${order.priority - 1})`,
              icon: <ArrowUp className="w-3.5 h-3.5" />,
              title: 'Checked before the transition above it (Alt+↑)',
              onSelect: () => handleTransitionPriority(edge, order.priority - 1),
            });
          if (order.priority < order.count)
            items.push({
              id: 'priority-down-btn',
              label: pre ? `Later in preProcess() (${order.priority} → ${order.priority + 1})` : `Lower priority (${order.priority} → ${order.priority + 1})`,
              icon: <ArrowDown className="w-3.5 h-3.5" />,
              title: 'Checked after the transition below it (Alt+↓)',
              onSelect: () => handleTransitionPriority(edge, order.priority + 1),
            });
          items.push({
            id: 'priority-set-btn',
            label: `Priority ${order.priority} of ${order.count}…`,
            icon: <ListOrdered className="w-3.5 h-3.5" />,
            title: `The order of the transitions of ${where}`,
            onSelect: () =>
              setPromptRequest({
                title: `Priority of ${edge.from} → ${edge.to}`,
                label: `1 is checked first. The transitions of ${where} now: ${order.targets.map((t, i) => `${i + 1} ${t}`).join(', ')}`,
                initial: String(order.priority),
                monospace: true,
                submitLabel: 'Set priority',
                validate: (v) => (/^\d+$/.test(v.trim()) && +v >= 1 && +v <= order.count ? null : `A number from 1 to ${order.count}`),
                onSubmit: (v) => handleTransitionPriority(edge, +v),
              }),
          });
        }
        if (edge.from !== '[*]')
          items.push({ id: 'delete-transition-btn', label: 'Delete transition…', icon: <Trash2 className="w-3.5 h-3.5" />, title: 'Delete: its code in doState() / preProcess()', onSelect: () => handleDeleteTransition(edge) });
      }
      // State machines this state's code / this transition's guard uses: open their charts
      if ((target.type === 'node' || target.type === 'edge') && machineMembers.size > 0) {
        let text = '';
        if (target.type === 'node') {
          try {
            text = getStateCodeFromPou(pouContent, target.id).code ?? '';
          } catch {
            text = '';
          }
        } else {
          const edge = availableEdges.find((e) => e.id === target.id);
          text = `${target.label ?? ''} ${edge?.condition ?? ''} ${edge?.label ?? ''}`;
        }
        referencedMachines(text, machineMembers)
          .slice(0, 6)
          .forEach((ref) =>
            items.push({
              id: `open-ref-${ref.member}`,
              label: `Open ${ref.type} (${ref.member})`,
              icon: <Link2 className="w-3.5 h-3.5" />,
              title: `Open the chart of ${ref.member} : ${ref.type}`,
              onSelect: () => void handleOpenReferenced(ref),
            })
          );
      }
      return items;
    },
    [findPathsFor, pouContent, dutContent, handleRenameState, handleAddState, machineMembers, availableEdges, handleOpenReferenced, stateVarName, handleTransitionPriority, handleCopyState, handlePasteState, handleDeleteState, handleDeleteTransition, knownStates, handleSetInitial, handleToggleFinal, handleMoveToComposite, compositeOfState, handleSetCompositeInitial, isFinal, handleAddStateFrom]
  );
  // "Open code" outside XAE: the Method Editor opens the method at the line (a new request each click)
  const [codeJump, setCodeJump] = useState<{ method: string; line: number; nonce: number } | null>(null);
  const handleLintGoToCode = useCallback(
    (finding: LintFinding) => {
      if (!finding.method || !finding.line) return;
      if (finding.stateId) handleJumpToState(finding.stateId);
      if (canNavigateInXae && pouPath) {
        postToHost({ type: 'navigate', path: pouPath, method: finding.method, line: finding.line, text: finding.text });
      } else {
        handleOpenInspectorPanel('method', { method: finding.method });
        setCodeJump({ method: finding.method, line: finding.line, nonce: Date.now() });
      }
    },
    [canNavigateInXae, pouPath, handleJumpToState, handleOpenInspectorPanel]
  );
  const handleLintFix = useCallback(
    (finding: LintFinding) => {
      const fix = finding.fix;
      if (!fix) return;
      if (fix.kind === 'add-enum-member') {
        if (!dutContent.trim()) {
          showCopyToast('Load the .TcDUT enum first', 'error');
          return;
        }
        const next = addEnumMember(dutContent, fix.name);
        if (!next) {
          showCopyToast('The enum list was not found in the .TcDUT', 'error');
          return;
        }
        handleSaveDutContent(next);
        showCopyToast(`Added ${fix.name} to ${dutFileName || 'the enum'}`, 'success');
      } else {
        const code = addCaseBranch(pouContent, fix.name);
        const result = code ? handleSaveMethodCode('doState', code) : { success: false, error: 'doState() CASE not found' };
        if (!result?.success) {
          showCopyToast(result?.error || 'Could not add the CASE branch', 'error');
          return;
        }
        showCopyToast(`Added a CASE branch for ${fix.name} to doState()`, 'success');
      }
    },
    [dutContent, dutFileName, pouContent, handleSaveDutContent, handleSaveMethodCode, showCopyToast]
  );

  // Live view controls (the handlers for the host's messages are above, next to the other host handlers)
  const liveSettingsKey = `kss.live.${pouFileName || 'POU'}`;
  const [storedLiveSettings, setLiveSettings] = useState<LiveSettings>(DEFAULT_LIVE_SETTINGS);
  // The key whose saved settings are in state (auto go-live waits for them)
  const [liveSettingsLoadedKey, setLiveSettingsLoadedKey] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(liveSettingsKey);
      const loaded: LiveSettings = raw ? { ...DEFAULT_LIVE_SETTINGS, ...(JSON.parse(raw) as Partial<LiveSettings>) } : DEFAULT_LIVE_SETTINGS;
      // A POU without a target starts with the last remembered PLC (XAE: empty is the project's target, kept so)
      const last = !loaded.netId && !isXaeHost() ? loadRememberedPlcs()[0] : undefined;
      setLiveSettings(last ? { ...loaded, netId: last.netId, ip: last.ip, port: last.port, localNetId: last.localNetId } : loaded);
    } catch {
      setLiveSettings(DEFAULT_LIVE_SETTINGS);
    }
    setLiveSettingsLoadedKey(liveSettingsKey);
  }, [liveSettingsKey]);
  // Opened by another window (Open instance, Watch): the same PLC, so its connection becomes this POU's
  function adoptLiveConnection(pouName: string, connection: Record<string, string>) {
    const key = `kss.live.${pouName || 'POU'}`;
    let saved: Partial<LiveSettings> = {};
    try {
      saved = JSON.parse(localStorage.getItem(key) || '{}') as Partial<LiveSettings>;
    } catch {
      // none saved
    }
    const merged = { ...DEFAULT_LIVE_SETTINGS, ...saved, ...connectionOf(connection) } as LiveSettings;
    setLiveSettings(merged);
    try {
      localStorage.setItem(key, JSON.stringify(merged));
    } catch {
      // per-viewer convenience only
    }
  }
  // A window opened for one instance follows it; the target and the other settings are the POU's
  const liveSettings = useMemo(
    () => (windowInstance !== null ? { ...storedLiveSettings, instance: windowInstance } : storedLiveSettings),
    [storedLiveSettings, windowInstance]
  );
  const handleLiveSettingsChange = useCallback(
    (next: LiveSettings) => {
      // This window's instance stays in this window (other windows on the POU follow theirs)
      const toStore = windowInstance !== null ? { ...next, instance: storedLiveSettings.instance } : next;
      if (windowInstance !== null) setWindowInstance(next.instance);
      setLiveSettings(toStore);
      try {
        localStorage.setItem(liveSettingsKey, JSON.stringify(toStore));
      } catch {
        // per-viewer convenience only
      }
    },
    [liveSettingsKey, windowInstance, storedLiveSettings.instance]
  );
  // Follow: pan the canvas to the live state on each change (off by default: the canvas stays where it is)
  const [liveFollow, setLiveFollowState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('kss.liveFollow') === '1';
    } catch {
      return false;
    }
  });
  const setLiveFollow = useCallback((on: boolean) => {
    setLiveFollowState(on);
    try {
      localStorage.setItem('kss.liveFollow', on ? '1' : '0');
    } catch {
      // per-viewer convenience only
    }
  }, []);
  // Desktop app: the main process talks ADS to the PLC and sends the same messages as the XAE extension
  useEffect(() => {
    const api = desktopLive();
    if (!api) return;
    return api.onMessage((m) => {
      if (m.type === 'liveStatus') handleLiveStatus(m);
      else if (m.type === 'liveValues') handleLiveValues(m.events);
      else if (m.type === 'liveWatchResult') handleLiveWatchResult(m.vars);
      else if (m.type === 'liveVars') handleLiveVars(m.values);
      else if (m.type === 'liveBrowseResult') handleLiveBrowseResult(m);
    });
  }, [handleLiveStatus, handleLiveValues, handleLiveWatchResult, handleLiveVars, handleLiveBrowseResult]);
  // Web edition: through a Kval StateScope gateway on the PLC network (by default the one serving this page)
  const liveMode: 'xae' | 'desktop' | 'web' | null = canNavigateInXae ? 'xae' : isXaeHost() ? null : desktopLive() ? 'desktop' : 'web';
  const [gatewayOrigin, setGatewayOrigin] = useState<string | null>(null);
  useEffect(() => {
    if (liveMode === 'web') void detectGatewayOrigin().then(setGatewayOrigin);
  }, [liveMode]);
  const [gatewayToken, setGatewayToken, rememberGatewayToken, setRememberGatewayToken] = useStoredSecret('kss.gateway.token');
  // Sign-in with company accounts on the gateway serving this page (its session cookie is this site's)
  const [gatewaySso, setGatewaySso] = useState<GatewaySso | null>(null);
  useEffect(() => {
    if (liveMode === 'web' && gatewayOrigin) void fetchGatewaySso(gatewayOrigin).then(setGatewaySso);
  }, [liveMode, gatewayOrigin]);
  const ssoHere = !!gatewaySso?.sso && !!gatewayOrigin && (!liveSettings.gateway || gatewaySocketUrl(liveSettings.gateway) === gatewaySocketUrl(gatewayOrigin));
  const ssoUser = ssoHere ? gatewaySso?.user ?? null : null;
  const [linkCode, setLinkCode, rememberLinkCode, setRememberLinkCode] = useStoredSecret('kss.link.code');
  // Through the gateway when this page is served by one, else through the helper on this computer
  const liveVia: 'link' | 'gateway' = liveSettings.via || (gatewayOrigin ? 'gateway' : 'link');
  const gatewayRef = useRef<GatewayConnection | null>(null);
  const gatewayConnection = useCallback(() => {
    gatewayRef.current ??= new GatewayConnection((m) => {
      if (m.type === 'liveStatus') handleLiveStatus(m);
      else if (m.type === 'liveValues') handleLiveValues(m.events);
      else if (m.type === 'liveWatchResult') handleLiveWatchResult(m.vars);
      else if (m.type === 'liveVars') handleLiveVars(m.values);
      else if (m.type === 'liveBrowseResult') handleLiveBrowseResult(m);
      else if (m.type === 'closed') setLiveStatus((prev) => ({ ...prev, state: 'lost', message: m.message }));
    });
    return gatewayRef.current;
  }, [handleLiveStatus, handleLiveValues, handleLiveWatchResult, handleLiveVars, handleLiveBrowseResult]);
  useEffect(() => () => gatewayRef.current?.close(), []);
  const pouTypeName = useMemo(() => pouContent.match(/<POU\b[^>]*\bName="([^"]+)"/)?.[1], [pouContent]);
  // Another POU: stop following the old one (the XAE extension does that itself)
  useEffect(() => {
    if (!isXaeHost()) void desktopLive()?.stop();
    gatewayRef.current?.stop();
    setLiveSession(EMPTY_LIVE_SESSION);
    setLiveStatus({ state: 'idle', instances: [] });
  }, [pouPath]);
  // Remembered PLCs (any POU): Browse lists them, Remember adds the target, going live on one makes it the newest
  const [rememberedPlcs, setRememberedPlcs] = useState<RememberedPlc[]>(loadRememberedPlcs);
  const updateRememberedPlcs = useCallback((change: (list: RememberedPlc[]) => RememberedPlc[]) => {
    setRememberedPlcs((prev) => {
      const next = change(prev).sort((a, b) => b.used - a.used);
      saveRememberedPlcs(next);
      return next;
    });
  }, []);
  const handleRememberPlc = useCallback(
    (remember: boolean, name?: string) => {
      const netId = liveSettings.netId.trim();
      updateRememberedPlcs((list) => {
        const rest = list.filter((p) => p.netId !== netId);
        if (!remember) return rest;
        const known = list.find((p) => p.netId === netId);
        return [{ name: name || known?.name || netId, netId, ip: liveSettings.ip.trim(), port: liveSettings.port, localNetId: liveSettings.localNetId.trim(), used: Date.now() }, ...rest];
      });
    },
    [liveSettings, updateRememberedPlcs]
  );
  const handleLiveStart = useCallback(() => {
    const port = parseInt(liveSettings.port, 10);
    const stateVar = identifiedStatesResult.stateVarName || 'machineState';
    const targetNetId = liveSettings.netId.trim();
    // A new session: a new recording (a replay showing ends)
    replayingRef.current = false;
    setReplay(null);
    recorderRef.current.reset();
    if (!(liveMode === 'web' && liveVia === 'gateway')) {
      updateRememberedPlcs((list) =>
        list.map((p) => (p.netId === targetNetId ? { ...p, ip: liveSettings.ip.trim(), port: liveSettings.port, localNetId: liveSettings.localNetId.trim(), used: Date.now() } : p))
      );
    }
    if (liveMode === 'desktop') {
      setLiveSession(EMPTY_LIVE_SESSION);
      setLiveStatus((prev) => ({ ...prev, state: 'connecting', message: 'Connecting...' }));
      void desktopLive()!.start({
        path: pouPath,
        typeName: pouTypeName,
        stateVar,
        instance: liveSettings.instance.trim() || undefined,
        netId: liveSettings.netId.trim(),
        ip: liveSettings.ip.trim() || undefined,
        port: port > 0 ? port : undefined,
        localNetId: liveSettings.localNetId.trim() || undefined,
      });
      return;
    }
    if (liveMode === 'web' && liveVia === 'link') {
      if (!/^\d+(\.\d+){5}$/.test(liveSettings.netId.trim())) {
        setLiveStatus((prev) => ({ ...prev, state: 'error', message: "Enter the PLC's AMS NetId (e.g. 192.168.1.20.1.1)" }));
        return;
      }
      if (!linkCode) {
        setLiveStatus((prev) => ({ ...prev, state: 'error', message: 'Enter the pairing code shown by Kval StateScope Link' }));
        return;
      }
      setLiveSession(EMPTY_LIVE_SESSION);
      setLiveStatus((prev) => ({ ...prev, state: 'connecting', message: 'Connecting to Kval StateScope Link...' }));
      const connection = gatewayConnection();
      connection
        .connect(`ws://127.0.0.1:${parseInt(liveSettings.linkPort, 10) || 48960}`, linkCode)
        .then(() =>
          connection.start({
            stateVar,
            typeName: pouTypeName,
            instance: liveSettings.instance.trim() || undefined,
            netId: liveSettings.netId.trim(),
            ip: liveSettings.ip.trim() || undefined,
            port: port > 0 ? port : undefined,
            localNetId: liveSettings.localNetId.trim() || undefined,
          })
        )
        .catch((err: Error) => setLiveStatus((prev) => ({ ...prev, state: 'error', message: err.message })));
      return;
    }
    if (liveMode === 'web') {
      const address = liveSettings.gateway || gatewayOrigin;
      if (!address) {
        setLiveStatus((prev) => ({ ...prev, state: 'error', message: 'Enter the gateway address' }));
        return;
      }
      if (!gatewayToken && !ssoUser) {
        setLiveStatus((prev) => ({ ...prev, state: 'error', message: ssoHere ? 'Sign in first' : 'Enter your gateway access token' }));
        return;
      }
      setLiveSession(EMPTY_LIVE_SESSION);
      setLiveStatus((prev) => ({ ...prev, state: 'connecting', message: 'Connecting to the gateway...' }));
      const connection = gatewayConnection();
      connection
        .connect(address, gatewayToken, !!ssoUser)
        .then(({ user, plcs }: { user: string; plcs: GatewayPlc[] }) => {
          setLiveStatus((prev) => ({ ...prev, user, plcs }));
          const plc = plcs.find((p) => p.id === liveSettings.plc) ?? (plcs.length === 1 ? plcs[0] : undefined);
          if (!plc) {
            setLiveStatus((prev) => ({ ...prev, state: 'stopped', message: `Signed in as ${user}: choose a PLC and go live` }));
            return;
          }
          if (plc.id !== liveSettings.plc) handleLiveSettingsChange({ ...liveSettings, plc: plc.id });
          connection.start({ plc: plc.id, stateVar, typeName: pouTypeName, instance: liveSettings.instance.trim() || undefined });
        })
        .catch((err: Error) => setLiveStatus((prev) => ({ ...prev, state: 'error', message: err.message })));
      return;
    }
    if (!pouPath) return;
    setLiveSession(EMPTY_LIVE_SESSION);
    setLiveStatus((prev) => ({ ...prev, state: 'connecting', message: 'Connecting...' }));
    postToHost({
      type: 'liveStart',
      path: pouPath,
      stateVar,
      instance: liveSettings.instance.trim() || undefined,
      netId: liveSettings.netId.trim() || undefined,
      port: port > 0 ? port : undefined,
    });
  }, [pouPath, pouTypeName, liveSettings, identifiedStatesResult.stateVarName, liveMode, gatewayOrigin, gatewayToken, linkCode, liveVia, gatewayConnection, handleLiveSettingsChange, updateRememberedPlcs, ssoUser, ssoHere]);
  // Opened to follow an instance: go live once the POU and its live settings are loaded
  useEffect(() => {
    if (!autoLivePending || !pouContent || !liveMode || liveSettingsLoadedKey !== liveSettingsKey) return;
    setAutoLivePending(false);
    handleLiveStart();
  }, [autoLivePending, pouContent, liveMode, liveSettingsLoadedKey, liveSettingsKey, handleLiveStart]);
  // Live: another window / tab on this POU that follows another of its PLC instances (XAE: a tab, desktop: a window,
  // web: a browser tab). The POU goes along: XAE and the desktop app load it from its file, else it is handed over.
  const handleOpenInstance = useCallback(
    (instance: string) => {
      if (isXaeHost()) {
        if (pouPath) postToHost({ type: 'openInstance', path: pouPath, instance, connection: connectionOf(liveSettings) });
        return;
      }
      const newWindow = (window as unknown as { tcDesktop?: { newWindow?: (p: string | null, launch?: InstanceLaunch & { handoff?: string }) => Promise<void> } }).tcDesktop?.newWindow;
      if (newWindow && pouPath) {
        void newWindow(pouPath, { instance, live: true, connection: connectionOf(liveSettings) });
        return;
      }
      const sample = selectedSampleId ? SAMPLES.find((s) => s.id === selectedSampleId && s.pouContent === pouContent && s.dutContent === dutContent) : undefined;
      const id = putHandoff({
        instance,
        live: true,
        connection: connectionOf(liveSettings),
        sampleId: sample?.id,
        pou: sample ? undefined : { name: pouFileName, content: pouContent, path: pouPath },
        dut: !sample && dutContent ? { name: dutFileName, content: dutContent, path: dutPath } : undefined,
      });
      if (!id) {
        showCopyToast('Cannot hand the POU to another window: this browser blocks local storage', 'error');
        return;
      }
      if (newWindow) {
        void newWindow(null, { handoff: id });
        return;
      }
      const url = new URL(window.location.href);
      url.hash = '';
      url.searchParams.set('handoff', id);
      window.open(url.toString(), '_blank', 'noopener');
    },
    [pouPath, pouFileName, pouContent, dutFileName, dutContent, dutPath, selectedSampleId, showCopyToast, liveSettings]
  );
  // ---- Live > Symbols: the PLC's symbols from a root, with values; Watch follows a state machine in its own window ----
  // The PLC Symbols tab on show: its values are followed
  const symbolsOpen = isDockTabVisible(dockLayout, 'symbols');
  const [symbolRoot, setSymbolRootState] = useState<string>(() => {
    try {
      return localStorage.getItem('kss.symbols.root') || DEFAULT_SYMBOL_ROOT;
    } catch {
      return DEFAULT_SYMBOL_ROOT;
    }
  });
  const setSymbolRoot = useCallback((root: string) => {
    setSymbolRootState(root);
    try {
      localStorage.setItem('kss.symbols.root', root);
    } catch {
      // per-viewer convenience only
    }
  }, []);
  // The value symbols on show in the window (followed with the guard variables)
  const [symbolPaths, setSymbolPaths] = useState<string[]>([]);
  const handleSymbolPaths = useCallback((paths: string[]) => setSymbolPaths((prev) => (prev.join('\n') === paths.join('\n') ? prev : paths)), []);
  // Machine Overview: the machines it follows (their state variables)
  const [overviewPaths, setOverviewPaths] = useState<string[]>([]);
  const handleOverviewPaths = useCallback((paths: string[]) => setOverviewPaths((prev) => (prev.join('\n') === paths.join('\n') ? prev : paths)), []);
  const liveStateVar = identifiedStatesResult.stateVarName || 'machineState';
  const browseSeqRef = useRef(0);
  const browseTargetRef = useRef({ liveMode, stateVar: liveStateVar });
  browseTargetRef.current = { liveMode, stateVar: liveStateVar };
  // Stable (the window reloads its tree when this changes)
  const liveBrowse = useCallback(
    (path: string) =>
      new Promise<LiveBrowseResult>((resolve) => {
        const requestId = ++browseSeqRef.current;
        const { liveMode: mode, stateVar } = browseTargetRef.current;
        const req = { requestId, path, stateVar };
        browseWaitersRef.current.set(requestId, resolve);
        window.setTimeout(() => {
          if (browseWaitersRef.current.delete(requestId)) resolve({ requestId, path, error: 'No answer from the PLC connection (does the host support browsing? update it)' });
        }, 15000);
        if (mode === 'xae') postToHost({ type: 'liveBrowse', ...req });
        else if (mode === 'desktop') void desktopLive()?.browse?.(req);
        else if (!gatewayRef.current?.browse(req)) {
          browseWaitersRef.current.delete(requestId);
          resolve({ requestId, path, error: 'Not connected' });
        }
      }),
    []
  );
  // Watch: the state machine's diagram in its own tab / window, live on that instance (its transitions are recorded)
  const handleWatchMachine = useCallback(
    (node: SymbolChild, on?: Partial<LiveSettings>) => {
      // on: another PLC (the Machine Overview's other PLCs): its connection instead of this window's
      const connection = connectionOf(on ? { ...liveSettings, ...on } : liveSettings);
      const typeName = node.type.trim().split('.').pop() ?? '';
      if (!/^[A-Za-z_]\w*$/.test(typeName)) {
        showCopyToast(`${node.type} is not a function block type`, 'error');
        return;
      }
      // This POU: another instance of it
      if (!on && pouTypeName && typeName.toLowerCase() === pouTypeName.toLowerCase()) {
        handleOpenInstance(node.path);
        return;
      }
      if (isXaeHost()) {
        postToHost({ type: 'openInstance', typeName, instance: node.path, connection });
        return;
      }
      const d = (window as unknown as {
        tcDesktop?: {
          openPouInProject?: (fromPath: string | undefined, typeName: string) => Promise<PouSource | { error: string }>;
          newWindow?: (p: string | null, launch?: InstanceLaunch & { handoff?: string }) => Promise<void>;
        };
      }).tcDesktop;
      const handOver = (src: PouSource) => {
        if (d?.newWindow && src.path) {
          void d.newWindow(src.path, { instance: node.path, live: true, connection });
          return;
        }
        const dut = src.dutCandidates ?? undefined;
        const id = putHandoff({ instance: node.path, live: true, connection, pou: { name: src.name, content: src.content, path: src.path }, dutCandidates: dut });
        if (!id) {
          showCopyToast('Cannot hand the POU to another window: this browser blocks local storage', 'error');
          return;
        }
        if (d?.newWindow) {
          void d.newWindow(null, { handoff: id });
          return;
        }
        const url = new URL(window.location.href);
        url.hash = '';
        url.searchParams.set('handoff', id);
        window.open(url.toString(), '_blank', 'noopener');
      };
      // Pick the .TcPOU (web edition, or no PLC project to find it in)
      const pick = () => {
        showCopyToast(`Choose ${typeName}.TcPOU to watch ${node.path}`, 'success', 5000);
        browseForPou()
          .then((src) => {
            if (!src) return;
            if (src.name.replace(/\.TcPOU$/i, '').toLowerCase() !== typeName.toLowerCase()) {
              showCopyToast(`${src.name} is not ${typeName}.TcPOU: ${node.path} is a ${typeName}`, 'error', 7000);
              return;
            }
            handOver(src);
          })
          .catch((e: unknown) => showCopyToast(`Could not open the .TcPOU: ${e instanceof Error ? e.message : String(e)}`, 'error'));
      };
      if (d?.openPouInProject && pouPath) {
        void d.openPouInProject(pouPath, typeName).then((src) => {
          if ('error' in src) pick();
          else handOver(src);
        });
        return;
      }
      pick();
    },
    [pouTypeName, pouPath, handleOpenInstance, showCopyToast, liveSettings]
  );
  // Stop following the window's values when it closes or the connection ends
  useEffect(() => {
    if (!symbolsOpen) setSymbolPaths([]);
  }, [symbolsOpen]);

  // The POU and the followed instance in the window / tab title, to tell several StateScopes apart
  const shownInstance = (liveStatus.state === 'connected' || liveStatus.state === 'lost' ? liveStatus.instance : undefined) ?? windowInstance ?? undefined;
  useEffect(() => {
    const pou = pouFileName ? pouFileName.replace(/\.TcPOU$/i, '') : '';
    document.title = pou ? `${pou}${shownInstance ? ` (${shownInstance})` : ''} - Kval StateScope` : 'Kval StateScope';
  }, [pouFileName, shownInstance]);
  // Desktop app: the main process opens a POU (and an instance of it) in the window that shows it
  useEffect(() => {
    (window as unknown as { tcDesktop?: { reportPou?: (p: string | null, instance?: string | null) => void } }).tcDesktop?.reportPou?.(pouPath ?? null, shownInstance ?? null);
  }, [pouPath, shownInstance]);

  const handleLiveStop = useCallback(() => {
    // Stop during a replay: ends the replay
    if (replayingRef.current) {
      setReplay(null);
      setLiveStatus({ state: 'stopped', message: 'Replay closed', instances: [] });
      return;
    }
    if (isXaeHost()) postToHost({ type: 'liveStop' });
    else if (desktopLive()) void desktopLive()!.stop();
    else gatewayRef.current?.stop();
    setLiveStatus((prev) => ({ ...prev, state: 'stopped', message: 'Not connected' }));
  }, []);
  // ---- Recording and replay ----
  const handleSaveRecording = useCallback(async () => {
    const rec = recorderRef.current.toRecording({
      pou: pouTypeName, pouFile: pouFileName, instance: liveStatus.instance ?? (liveSettings.instance || undefined), target: liveStatus.target,
      stateVar: identifiedStatesResult.stateVarName || 'machineState',
    });
    const r = await saveDocument(recordingFileName(pouTypeName, rec.instance), JSON.stringify(rec));
    if (r.error) showCopyToast(`Could not save the recording: ${r.error}`, 'error', 8000);
    else if (!r.canceled) showCopyToast(`Recording saved${r.path ? `: ${r.path}` : ''} (${rec.values.length} samples${rec.truncated ? ', the oldest dropped' : ''})`, 'success', 6000);
  }, [pouTypeName, pouFileName, liveStatus.instance, liveStatus.target, liveSettings.instance, identifiedStatesResult.stateVarName, showCopyToast]);
  // What the replay has shown: up to which sample (a seek back starts again from the beginning)
  const replayFedRef = useRef({ values: 0, vars: 0, pos: -Infinity });
  const handleOpenRecording = useCallback(
    async (file: File) => {
      const rec = parseRecording(await file.text());
      if ('error' in rec) {
        showCopyToast(`${file.name}: ${rec.error}`, 'error', 7000);
        return;
      }
      if (liveStatus.state === 'connected' || liveStatus.state === 'connecting') {
        if (isXaeHost()) postToHost({ type: 'liveStop' });
        else if (desktopLive()) void desktopLive()!.stop();
        else gatewayRef.current?.stop();
      }
      const span = recordingSpan(rec);
      replayFedRef.current = { values: 0, vars: 0, pos: -Infinity };
      replayingRef.current = true;
      setLiveSession(EMPTY_LIVE_SESSION);
      setLiveVarValues({});
      setLiveWatched(rec.watched);
      setReplay({ rec, file: file.name, from: span.from, to: span.to, pos: span.from, playing: true, speed: 1 });
      setLiveStatus({ state: 'connected', message: `Replay: ${file.name}`, instance: rec.instance, target: rec.target, plcState: 'Replay', instances: rec.instance ? [rec.instance] : [] });
      if (rec.pou && pouTypeName && rec.pou !== pouTypeName) showCopyToast(`${file.name} was recorded with ${rec.pou}; this is ${pouTypeName}: states are shown by their values`, 'error', 8000);
    },
    [liveStatus.state, pouTypeName, showCopyToast]
  );
  // The replay's clock: 100 ms steps times the speed, until the end
  const replayPlaying = !!replay?.playing;
  useEffect(() => {
    if (!replayPlaying) return;
    const t = window.setInterval(() => {
      setReplay((r) => {
        if (!r || !r.playing) return r;
        const pos = Math.min(r.to, r.pos + 100 * r.speed);
        return { ...r, pos, playing: pos < r.to };
      });
    }, 100);
    return () => window.clearInterval(t);
  }, [replayPlaying]);
  // Shows the recording up to the replay's position (as the live view shows samples)
  useEffect(() => {
    if (!replay) return;
    const fed = replayFedRef.current;
    const { rec, pos } = replay;
    let reset = false;
    if (pos < fed.pos) {
      fed.values = 0;
      fed.vars = 0;
      reset = true;
    }
    const vEnd = upperBound(rec.values, pos);
    const gEnd = upperBound(rec.vars, pos);
    const samples = rec.values.slice(fed.values, vEnd);
    const vars = rec.vars.slice(fed.vars, gEnd);
    fed.values = vEnd;
    fed.vars = gEnd;
    fed.pos = pos;
    setLiveSession((prev) => {
      const next = applyLiveSamples(reset ? EMPTY_LIVE_SESSION : prev, samples, liveNamesRef.current, liveEdgesRef.current);
      return { ...next, clockOffset: Date.now() - pos };
    });
    if (vars.length || reset) {
      setLiveVarValues((prev) => {
        const next = reset ? {} : { ...prev };
        for (const s of vars) {
          if (s.v === null || s.v === undefined) delete next[s.id];
          else next[s.id] = s.v;
        }
        return next;
      });
    }
  }, [replay]);
  const replayView = useMemo(
    () => (replay ? { file: replay.file, from: replay.from, to: replay.to, pos: replay.pos, playing: replay.playing, speed: replay.speed, samples: replay.rec.values.length } : undefined),
    [replay]
  );
  // The PLC switcher while live: stop, take the remembered PLC's settings, go live again once they are in state
  const [switchPending, setSwitchPending] = useState(false);
  const handleSwitchPlc = useCallback(
    (p: RememberedPlc) => {
      handleLiveStop();
      handleLiveSettingsChange({ ...liveSettings, netId: p.netId, ip: ipFieldFor(p.netId, p.ip), port: p.port, localNetId: p.localNetId });
      setSwitchPending(true);
    },
    [handleLiveStop, handleLiveSettingsChange, liveSettings]
  );
  useEffect(() => {
    if (!switchPending) return;
    setSwitchPending(false);
    handleLiveStart();
  }, [switchPending, handleLiveStart]);
  // Browse through Link (web edition): the search and Add Route run in Link, on this computer
  const linkRequest = useCallback(
    async <T,>(message: Record<string, unknown>, replyType: string): Promise<T> => {
      if (!linkCode) throw new Error('Enter the pairing code shown by Kval StateScope Link first');
      const c = gatewayConnection();
      await c.connect(`ws://127.0.0.1:${parseInt(liveSettings.linkPort, 10) || 48960}`, linkCode);
      return c.request<T>(message, replyType);
    },
    [linkCode, gatewayConnection, liveSettings.linkPort]
  );
  const viaLink = liveMode === 'web' && liveVia === 'link';
  const handleScanPlcs = useMemo(() => {
    if (viaLink) {
      return (addresses: string[]) => linkRequest<PlcScanResult>({ type: 'discover', addresses }, 'discoverResult').catch((err: Error) => ({ devices: [], errors: [err.message] }));
    }
    return canScanPlcs() ? (addresses: string[]) => scanPlcs(addresses, liveSettings.localNetId.trim()) : undefined;
  }, [viaLink, linkRequest, liveSettings.localNetId]);
  const handleAddRoute = useMemo(() => {
    const localNetId = liveSettings.localNetId.trim() || undefined;
    if (viaLink) {
      return (d: FoundPlc, user: string, password: string) =>
        linkRequest<AddRouteResult>({ type: 'addRoute', plcIp: d.ip, user, password, localNetId }, 'addRouteResult').catch((err: Error) => ({ ok: false, message: err.message }));
    }
    return canScanPlcs() ? (d: FoundPlc, user: string, password: string) => addRouteOnPlc({ plcIp: d.ip, netId: d.netId, name: d.name, user, password, localNetId }) : undefined;
  }, [viaLink, linkRequest, liveSettings.localNetId]);
  // Machine Overview, other PLCs: how they are reached in this edition (XAE: not), and which can be added
  const sideVia = useMemo<SideVia | null>(() => {
    if (liveMode === 'desktop') return { kind: 'desktop' };
    if (liveMode !== 'web') return null;
    if (liveVia === 'link') return linkCode ? { kind: 'link', url: `ws://127.0.0.1:${parseInt(liveSettings.linkPort, 10) || 48960}`, code: linkCode } : null;
    const address = liveSettings.gateway || gatewayOrigin;
    if (address && ssoUser) return { kind: 'gateway', url: address, token: '', sso: true };
    return address && gatewayToken ? { kind: 'gateway', url: address, token: gatewayToken } : null;
  }, [liveMode, liveVia, linkCode, liveSettings.linkPort, liveSettings.gateway, gatewayOrigin, gatewayToken, ssoUser]);
  const sideCandidates = useMemo<SidePlc[]>(() => {
    if (sideVia?.kind === 'gateway') return (liveStatus.plcs ?? []).map((p) => ({ key: `gw-${p.id}`.replace(/[^\w.:-]/g, '_'), name: p.name, plc: p.id }));
    return rememberedPlcs.map((p) => ({ key: `plc-${p.netId}`, name: p.name, netId: p.netId, ip: p.ip, port: p.port, localNetId: p.localNetId }));
  }, [sideVia, liveStatus.plcs, rememberedPlcs]);
  const liveActive = liveStatus.state === 'connected' || liveStatus.state === 'lost';
  // Stuck-state alerts: this POU type's time limits (and the default); over the limit the state is "stuck"
  const stateLimits = useStateLimits(pouTypeName);
  const defaultLimit = useDefaultLimit();
  const notifyOn = useNotify();
  const liveLimit = limitFor(stateLimits, defaultLimit, liveSession.current?.state);
  const [liveNow, setLiveNow] = useState(() => Date.now());
  useEffect(() => {
    if (!liveActive || !liveLimit) return;
    const t = window.setInterval(() => setLiveNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [liveActive, liveLimit]);
  const liveInState = liveSession.current ? liveNow - (liveSession.clockOffset ?? 0) - liveSession.current.since : 0;
  const liveStuck = liveStatus.state === 'connected' && !!liveLimit && !!liveSession.current && liveInState > liveLimit;
  // Notify once per stay in the state
  const notifiedStuckRef = useRef('');
  useEffect(() => {
    if (!liveStuck || !notifyOn || !liveSession.current) return;
    const key = `${liveSession.current.state}@${liveSession.current.since}`;
    if (notifiedStuckRef.current === key) return;
    notifiedStuckRef.current = key;
    const who = liveStatus.instance ?? (pouTypeName || 'The state machine');
    void notifyStuck(`Kval StateScope: ${who} is stuck`, `In ${liveSession.current.state} for more than ${formatLimit(liveLimit)}`, `kss-stuck-${who}`);
  }, [liveStuck, notifyOn, liveSession, liveLimit, liveStatus.instance, pouTypeName]);
  const handleStateLimit = useCallback(
    (state: string, ms: number | null) => {
      if (pouTypeName) setStateLimit(pouTypeName, state, ms);
    },
    [pouTypeName]
  );
  limitMenuRef.current = { stateLimits, defaultLimit, handleStateLimit, pouTypeName };
  // The live state's parallel regions (Fork / Join): their variables, read with the guards' ones
  const liveRegions = useMemo(() => {
    const cur = liveActive ? liveSession.current?.state : undefined;
    if (!cur) return [] as { variable: string; states: string[] }[];
    const byVar = new Map<string, string[]>();
    for (const r of regionOf.values()) if (r.parent === cur) byVar.set(r.variable, r.states);
    return [...byVar].map(([variable, states]) => ({ variable, states }));
  }, [liveActive, liveSession.current?.state, regionOf]);
  const liveRegionStates = useMemo(
    () =>
      liveRegions
        .map((r) => {
          const v = liveVarValues[r.variable.toLowerCase()];
          const name = typeof v === 'number' ? liveEnumNames.get(v) : undefined;
          return name && r.states.includes(name) ? name : undefined;
        })
        .filter((s): s is string => !!s),
    [liveRegions, liveVarValues, liveEnumNames]
  );
  const liveHighlight = useMemo(() => {
    if (!liveActive || !liveSession.current) return null;
    const last = liveSession.transitions[liveSession.transitions.length - 1];
    return {
      stateId: liveSession.current.state,
      previousStateId: last && last.to === liveSession.current.state ? last.from : undefined,
      stuck: liveStuck,
      regionStates: liveRegionStates,
    };
  }, [liveActive, liveSession, liveStuck, liveRegionStates]);
  // Follow: keep the active state in view
  const liveCurrentState = liveSession.current?.state;
  useEffect(() => {
    if (liveFollow && liveActive && liveCurrentState) mermaidViewerRef.current?.panToState(liveCurrentState, Date.now());
  }, [liveFollow, liveActive, liveCurrentState]);
  const handleLiveOpenHistory = useCallback(() => {
    if (liveSession.transitions.length === 0) return;
    const dataset = analyzeChronologicalEvents(
      liveSession.transitions.map((t) => ({ timestamp: t.t, fromState: t.from, toState: t.to, dwellMs: t.dwellMs })),
      identifiedStatesResult.states,
      availableEdges,
      `Live: ${liveStatus.instance ?? pouFileName}`
    );
    setHistoryDataset(dataset);
    showDockTab('history');
  }, [liveSession.transitions, identifiedStatesResult.states, availableEdges, liveStatus.instance, pouFileName, showDockTab]);

  // ---- Live guard values: the conditions of the active state's transitions (or all), read from the PLC ----
  const [liveGuardScope, setLiveGuardScopeState] = useState<'active' | 'all' | 'off'>(() => {
    try {
      const v = localStorage.getItem('kss.liveGuards');
      return v === 'all' || v === 'off' ? v : 'active';
    } catch {
      return 'active';
    }
  });
  const setLiveGuardScope = useCallback((scope: 'active' | 'all' | 'off') => {
    setLiveGuardScopeState(scope);
    try {
      localStorage.setItem('kss.liveGuards', scope);
    } catch {
      // per-viewer convenience only
    }
  }, []);
  // A new session starts without the previous one's variables
  useEffect(() => {
    if (liveStatus.state === 'connecting' || liveStatus.state === 'idle') {
      setLiveWatched({});
      setLiveVarValues({});
    }
  }, [liveStatus.state]);
  // Enum literals in conditions: the state enum, the other .TcDUT files found with the POU, and (desktop, XAE) the
  // PLC project's, loaded once per POU while live
  const [projectDuts, setProjectDuts] = useState<{ path: string; contents: string[] } | null>(null);
  // The POU they are asked for (a ref: the answer must not be dropped when the effect runs again meanwhile)
  const projectDutsRequestRef = useRef<string | null>(null);
  useEffect(() => {
    if (!liveActive || liveGuardScope === 'off' || !pouPath || (liveMode !== 'xae' && liveMode !== 'desktop')) return;
    if (projectDutsRequestRef.current === pouPath) return;
    projectDutsRequestRef.current = pouPath;
    const forPou = pouPath;
    void loadProjectFiles(forPou)
      .then((files) => {
        if (projectDutsRequestRef.current !== forPou) return;
        if ('error' in files) projectDutsRequestRef.current = null; // asked again later
        else setProjectDuts({ path: forPou, contents: files.duts.map((d) => d.content) });
      })
      .catch(() => {
        if (projectDutsRequestRef.current === forPou) projectDutsRequestRef.current = null;
      });
  }, [liveActive, liveGuardScope, pouPath, liveMode]);
  const liveEnums = useMemo(
    () => buildEnumTables([dutContent, ...dutPool, ...(projectDuts && projectDuts.path === pouPath ? projectDuts.contents : [])]),
    [dutContent, dutPool, projectDuts, pouPath]
  );
  const liveGuardEdges = useMemo(() => {
    if (!liveActive || liveGuardScope === 'off') return null;
    try {
      const model = generateStatechartModel(dutContent, pouContent, {
        flowchartOutput,
        collapseErrorSinkEdges, choiceNodes,
        includeStateDescriptions,
        showTransitionPriorities,
        priorityFormat,
      });
      // The generator's own edges (their ids are the diagram's: notes do not change the order of the lines)
      return { stateVar: model.stateVar, edges: buildGuardEdges(model.edges, extractEdgesFromMermaid(model.markdown), model.stateVar, liveEnums) };
    } catch {
      return null;
    }
  }, [liveActive, liveGuardScope, dutContent, pouContent, flowchartOutput, collapseErrorSinkEdges, choiceNodes, includeStateDescriptions, showTransitionPriorities, priorityFormat, liveEnums]);
  const liveGuardInputs = useMemo<GuardInputs | null>(
    () =>
      liveGuardEdges
        ? {
            values: liveVarValues,
            watched: liveWatched,
            stateVar: liveGuardEdges.stateVar,
            stateValue: liveSession.current?.value ?? null,
            currentState: liveSession.current?.state ?? null,
            enums: liveEnums,
          }
        : null,
    [liveGuardEdges, liveVarValues, liveWatched, liveSession.current, liveEnums]
  );
  // The variables to follow change with the active state (or the scope); the host keeps the ones still wanted
  const liveWatchKey = useMemo(() => {
    if (liveStatus.state !== 'connected' || !liveStatus.instance) return '';
    const guards = liveGuardEdges && liveGuardInputs ? variablesToWatch(liveGuardEdges.edges, liveGuardInputs, liveGuardScope === 'all') : [];
    // (and the current state's regions' variables)
    return [...new Set([...guards, ...liveRegions.map((r) => r.variable)])].sort().join('\n');
  }, [liveGuardEdges, liveGuardInputs, liveStatus.state, liveStatus.instance, liveGuardScope, liveRegions]);
  const sendLiveWatch = useCallback(
    (vars: LiveWatchVar[]) => {
      // (a replay has its recorded values)
      if (replayingRef.current) return;
      if (liveMode === 'xae') postToHost({ type: 'liveWatch', vars });
      else if (liveMode === 'desktop') void desktopLive()?.watch?.(vars);
      else gatewayRef.current?.watch(vars);
    },
    [liveMode]
  );
  const lastWatchRef = useRef('');
  useEffect(() => {
    if (liveStatus.state !== 'connected') {
      lastWatchRef.current = '';
      return;
    }
    // With the Symbols window's values (full paths, ids "sym:<path>")
    const key = `${liveWatchKey}\n#overview\n${overviewPaths.join('\n')}\n#symbols\n${symbolPaths.join('\n')}`;
    if (key === lastWatchRef.current) return;
    const instance = liveStatus.instance;
    const timer = window.setTimeout(() => {
      lastWatchRef.current = key;
      const paths = liveWatchKey && instance ? liveWatchKey.split('\n') : [];
      const guards = paths.map((p) => ({ id: p.toLowerCase(), candidates: symbolCandidates(p, instance!) }));
      const symbols = symbolPaths.filter(isSymbolPathText).map((p) => ({ id: symbolWatchId(p), candidates: [p] }));
      const machines = overviewPaths.filter(isSymbolPathText).map((p) => ({ id: overviewWatchId(p), candidates: [`${p}.${liveStateVar}`] }));
      // The guards first, then the overview's machines; a gateway follows at most 100 by default (more is refused)
      sendLiveWatch([...guards, ...machines, ...symbols].slice(0, MAX_WATCHED));
    }, 120);
    return () => window.clearTimeout(timer);
  }, [liveWatchKey, symbolPaths, overviewPaths, liveStateVar, liveStatus.state, liveStatus.instance, sendLiveWatch]);
  const liveGuardViews = useMemo(
    () => (liveGuardEdges && liveGuardInputs ? evaluateGuards(liveGuardEdges.edges, liveGuardInputs, liveGuardScope === 'all', null) : null),
    [liveGuardEdges, liveGuardInputs, liveGuardScope]
  );
  // ---- Offline simulation: a state, the values its transitions' conditions read, the steps taken ----
  const [sim, setSim] = useState<{ active: boolean; current: string | null; history: { from: string; to: string; label: string }[]; values: Record<string, LiveValue> }>({
    active: false,
    current: null,
    history: [],
    values: {},
  });
  const simOn = sim.active && !liveActive && !!sim.current;
  const simGuardEdges = useMemo(() => {
    if (!simOn) return null;
    try {
      const model = generateStatechartModel(dutContent, pouContent, { flowchartOutput, collapseErrorSinkEdges, choiceNodes, includeStateDescriptions, showTransitionPriorities, priorityFormat });
      return { stateVar: model.stateVar, edges: buildGuardEdges(model.edges, extractEdgesFromMermaid(model.markdown), model.stateVar, liveEnums) };
    } catch {
      return null;
    }
  }, [simOn, dutContent, pouContent, flowchartOutput, collapseErrorSinkEdges, choiceNodes, includeStateDescriptions, showTransitionPriorities, priorityFormat, liveEnums]);
  const simInputs = useMemo<GuardInputs | null>(
    () =>
      simGuardEdges && sim.current
        ? {
            values: sim.values,
            watched: {},
            stateVar: simGuardEdges.stateVar,
            stateValue: (liveEnums.literals.get(sim.current.toLowerCase()) as number | undefined) ?? null,
            currentState: sim.current,
            enums: liveEnums,
          }
        : null,
    [simGuardEdges, sim.current, sim.values, liveEnums]
  );
  const simViews = useMemo(() => (simGuardEdges && simInputs ? evaluateGuards(simGuardEdges.edges, simInputs, false, null) : null), [simGuardEdges, simInputs]);
  // The current state's transitions: preProcess()'s first (it runs before doState()), then by priority
  const simTransitions = useMemo<(SimTransition & { target: string })[]>(() => {
    if (!simGuardEdges || !simInputs) return [];
    const list = simGuardEdges.edges
      .map((e) => ({ e, applying: e.members.filter((m) => appliesToState(m, simInputs)) }))
      .filter(({ applying }) => applying.length > 0)
      .map(({ e, applying }) => {
        const info = availableEdges.find((x) => x.id === e.edgeId);
        return {
          edgeId: e.edgeId,
          to: e.to,
          target: applying[0].to || e.to,
          priority: info?.priority,
          label: (info?.condition ?? info?.label ?? '').replace(/<br\s*\/?>/g, ' '),
          source: applying[0].source,
          result: (e.conditional ? simViews?.[e.edgeId]?.result ?? 'unknown' : 'always') as SimTransition['result'],
        };
      });
    const rank = (t: { source: string; priority?: number }) => (t.source === 'preProcess' ? -1 : t.priority ?? 999);
    return list.sort((a, b) => rank(a) - rank(b));
  }, [simGuardEdges, simInputs, simViews, availableEdges]);
  const simVariables = useMemo(() => {
    const names = new Set<string>();
    for (const t of simTransitions) for (const r of simGuardEdges?.edges.find((e) => e.edgeId === t.edgeId)?.refs ?? []) names.add(r);
    return [...names].sort().map((name) => ({ name, value: sim.values[name.toLowerCase()] as boolean | number | string | undefined }));
  }, [simTransitions, simGuardEdges, sim.values]);
  const simTake = useCallback(
    (edgeId: string) => {
      const t = simTransitions.find((x) => x.edgeId === edgeId);
      if (!t || !sim.current) return;
      const from = sim.current;
      setSim((s) => ({ ...s, current: t.target, history: [...s.history, { from, to: t.target, label: t.label }] }));
    },
    [simTransitions, sim.current]
  );
  const simHighlight = useMemo(
    () => (simOn ? { stateId: sim.current!, previousStateId: sim.history[sim.history.length - 1]?.from, stuck: false } : null),
    [simOn, sim.current, sim.history]
  );
  const simStartState = useMemo(() => {
    const init = pouContent ? initialStateOf(pouContent, stateVarName) : null;
    const first = dutContent.trim() ? enumMembers(dutContent)[0] : undefined;
    return (init && knownStates.has(init) ? init : first && knownStates.has(first) ? first : null) ?? [...knownStates].filter((s) => s !== '[*]')[0] ?? null;
  }, [pouContent, dutContent, stateVarName, knownStates]);

  // The Live tab lists the active state's transitions with their results
  const liveActiveGuards = useMemo(() => {
    if (!liveGuardViews || !liveGuardEdges) return [];
    return liveGuardEdges.edges
      .filter((e) => liveGuardViews[e.edgeId]?.detail)
      .map((e) => ({ edgeId: e.edgeId, to: e.to, ...liveGuardViews[e.edgeId] }));
  }, [liveGuardViews, liveGuardEdges]);

  const hostConflictActions = hostConflict
    ? {
        name: hostConflict.name,
        onReload: () => {
          applyHostVersion(hostConflict.path, hostConflict.content);
          setHostConflict(null);
          showCopyToast(`Reloaded ${hostConflict.name} from XAE (your edits were discarded)`, 'success', 4000);
        },
        onKeepMine: () => {
          keepMineRef.current.add(hostConflict.path);
          setHostConflict(null);
          showCopyToast(`Kept your edits: Save to project will overwrite the change made in XAE`, 'success', 5000);
        },
      }
    : undefined;

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
      pou: {
        title: 'POU Editor',
        icon: <Blocks />,
        tooltip: `The declaration and body of ${pouFileName ? pouFileName.replace(/\.TcPOU$/i, '') : 'the POU'} (Structured Text)`,
      },
      enum: { title: 'Enum Editor', icon: <Code2 />, tooltip: `Enum members in ${dutFileName || '.TcDUT'}` },
      overview: { title: 'Machine Overview', icon: <LayoutGrid />, tooltip: 'Every state machine of the PLC with its current state (while live)' },
      symbols: { title: 'PLC Symbols', icon: <ListTree />, tooltip: "The PLC's symbols and their values (while live); Watch opens a state machine" },
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
      logger: {
        title: 'PLC Transition Logger',
        icon: <FileSpreadsheet />,
        tooltip: 'Load a CSV or text log of PLC state changes into Transition History',
      },
      docs: { title: 'Documentation', icon: <BookOpen />, tooltip: 'State purpose, notes & documentation' },
      simulate: { title: 'Simulation', icon: <FlaskConical />, tooltip: 'Step through the state machine without a PLC' },
      live: {
        title: 'Live',
        icon: <Radio />,
        tooltip: 'Follow the state machine in the running PLC (TwinCAT XAE)',
        badge: liveActive ? <span id="live-tab-badge" className="live-dot" title={liveStatus.message} /> : undefined,
      },
      problems: {
        title: 'Problems',
        icon: <ListChecks />,
        tooltip: 'State machine checks: enum, CASE branches, reachability, guards',
        badge: (() => {
          const errors = activeLintFindings.filter((f) => f.severity === 'error').length;
          const warnings = activeLintFindings.filter((f) => f.severity === 'warning').length;
          if (errors + warnings === 0) return undefined;
          return (
            <span
              id="problems-tab-badge"
              className={`px-1.5 rounded-full text-[10px] font-bold border ${
                errors > 0 ? 'bg-rose-950 text-rose-300 border-rose-800' : 'bg-amber-950/60 text-amber-300 border-amber-800'
              }`}
              title={`${errors} errors, ${warnings} warnings`}
            >
              {errors + warnings}
            </span>
          );
        })(),
      },
      markdown: { title: 'Mermaid Markdown', icon: <FileText />, tooltip: 'Generated Mermaid diagram markdown' },
      search: { title: 'Keyword Search & Filter', icon: <Search /> },
      stats: {
        title: 'Real-Time Stats',
        icon: <ChartColumn />,
        tooltip: 'State Machine Real-Time Stats (shortcut: S)',
      },
      heatmap: { title: 'Complexity Heat-Map', icon: <Flame />, tooltip: 'Complexity Heat-Map (shortcut: H)' },
      notes: {
        title: 'Notes',
        icon: <StickyNote />,
        tooltip: 'Notes attached to states and transitions',
        badge:
          notesCount > 0 ? (
            <span className="px-1.5 rounded-full text-[10px] font-mono bg-amber-500/20 text-amber-300">{notesCount}</span>
          ) : undefined,
      },
      changes: { title: 'Changes', icon: <GitCompare />, tooltip: 'Compare the chart with the saved or committed version' },
      paths: { title: 'Paths', icon: <Route />, tooltip: 'Every path between two states, with the guards along it' },
    }),
    [pouFileName, dutFileName, selectedStateId, pouComplexityReport.refactorCandidatesCount, notesCount, activeLintFindings, liveActive, liveStatus.message]
  );

  // Canvas tool windows live in the RightPanel; the canvas renders them into these dock slots
  const dockedCanvasPanels = useMemo<DockedCanvasPanels>(() => {
    const ids: DockedCanvasPanelId[] = ['search', 'stats', 'heatmap', 'notes'];
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
    // ... less the README link and Help at the right end
    available: headerRowWidth - headerLeftWidth - 60 - 76,
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
            hostSave={
              isXaeHost()
                ? pouPath
                  ? { dirtyCount: hostDirtyFiles.length, onSave: handleSaveToProject }
                  : undefined
                : pouContent
                ? {
                    id: 'save-sources-btn',
                    label: 'Save',
                    dirtyCount: localDirtyCount,
                    onSave: () => void handleSaveSources(),
                    title: desktopSave()?.saveSources
                      ? `Write the edits back to ${[pouDirty && (pouPath ? pouFileName : `${pouFileName} (Save As)`), dutDirty && dutFileName].filter(Boolean).join(' and ')} (Ctrl+S)`
                      : canWriteBack()
                      ? 'Write the edits back to the files opened with Browse (else download them) (Ctrl+S)'
                      : 'Download the edited files (this browser cannot write them back) (Ctrl+S)',
                    menu: desktopSave()?.saveSourceAs
                      ? [
                          { id: 'save-pou-as', label: 'Save .TcPOU As…', onSelect: () => void handleSaveAs('pou') },
                          ...(dutContent ? [{ id: 'save-dut-as', label: 'Save .TcDUT As…', onSelect: () => void handleSaveAs('dut') }] : []),
                        ]
                      : [
                          { id: 'download-pou', label: `Download ${defaultName('pou')}`, onSelect: () => void handleSaveAs('pou') },
                          ...(dutContent ? [{ id: 'download-dut', label: `Download ${defaultName('dut')}`, onSelect: () => void handleSaveAs('dut') }] : []),
                        ],
                  }
                : undefined
            }
            hostConflict={hostConflictActions}
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
                  <div className="py-1">
                    <button
                      id="dropdown-document-project-btn"
                      type="button"
                      onClick={() => void handleDocumentProject()}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Every state machine of the PLC project in one HTML document: charts, states, transitions, problems"
                    >
                      <FileStack className="w-4 h-4 text-violet-300 shrink-0" />
                      <div>
                        <div className="text-white text-xs">Document all state machines…</div>
                        <div className="text-[10px] text-slate-400">{isXaeHost() || pouPath ? 'Of this PLC project' : 'Choose the PLC project folder'}</div>
                      </div>
                    </button>
                  </div>
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
      {focusMode && (
        <button
          id="exit-focus-mode-btn"
          type="button"
          onClick={toggleFocusMode}
          className="fixed top-2 right-3 z-[60] flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/90 border border-slate-700 text-xs text-slate-300 hover:text-white hover:border-sky-500 shadow-lg"
          title="Leave focus mode (Z or Esc)"
        >
          <Minimize2 className="w-3.5 h-3.5" /> Exit focus
        </button>
      )}
      <header
        id="app-header"
        className={`relative z-40 flex flex-col bg-slate-900/90 border-b border-slate-800 backdrop-blur shrink-0 ${focusMode ? 'hidden' : ''}`}
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
          <WindowMenuButton
            layout={dockLayout}
            onLayoutChange={setDockLayout}
            tabMeta={dockTabMeta}
            onNewWindow={openNewInstance ?? undefined}
            newWindowLabel={desktopNewWindow ? 'New Window' : 'New Tab'}
          />
          <button
            id="focus-mode-btn"
            type="button"
            onClick={toggleFocusMode}
            className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors shrink-0"
            title="Focus mode: only the diagram (Z)"
          >
            <Maximize2 className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <button
            id="toggle-right-panel-btn"
            type="button"
            onClick={() => setDockLayout((l) => ({ ...l, rightVisible: !l.rightVisible }))}
            className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors shrink-0"
            title={dockLayout.rightVisible ? 'Hide right panel (tool windows)' : 'Show right panel (tool windows)'}
          >
            {dockLayout.rightVisible ? <PanelRightClose className="w-4 h-4 sm:w-5 sm:h-5" /> : <PanelRightOpen className="w-4 h-4 sm:w-5 sm:h-5" />}
          </button>

            {/* Relative to the app (BASE_URL): the desktop app loads it from file:// */}
            <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="Kval StateScope" className="w-7 h-7 sm:w-8 sm:h-8 shrink-0" draggable={false} />
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
          <div className="h-4 sm:h-5 w-[1px] bg-slate-800 shrink-0" />
          {/* The README on GitHub (the desktop app and XAE open it in the default browser) */}
          <a
            id="readme-link"
            href="https://github.com/vuphamn/TcPouStatechartGenerator#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors shrink-0"
            title="README on GitHub: features, setup and editions"
            aria-label="README on GitHub"
          >
            <BookMarked className="w-4 h-4 sm:w-5 sm:h-5" />
          </a>
          <HelpButton />
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
              liveStateId={liveActive ? liveSession.current?.state ?? null : simHighlight?.stateId ?? null}
              liveFollow={liveFollow}
              onLiveFollowChange={setLiveFollow}
              onJumpToState={handleJumpToState}
              onSelectState={(id, label) => {
                setSelectedStateId(id);
                setSelectedStateLabel(label || id);
              }}
              customStyles={customNodeStyles}
              stateVarName={identifiedStatesResult.stateVarName}
              onOpenEnumEditor={() => {
                handleOpenEnumEditorModal(selectedStateId || undefined);
              }}
              onOpenComplexityReport={() => showDockTab('complexity')}
              fill
            />
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
            className={`${focusMode ? 'hidden ' : ''}relative z-30 flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-1 bg-slate-900 border-b border-slate-800 text-xs text-slate-300 shrink-0`}
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

              {/* A state's IF / ELSIF / ELSE of transitions as a choice (a diamond) */}
              <label className="flex items-center gap-2 cursor-pointer select-none" title="A state's IF / ELSIF / ELSE with two or more of its transitions: drawn as a choice (a diamond)">
                <input
                  id="choice-nodes-checkbox"
                  type="checkbox"
                  checked={choiceNodes}
                  onChange={(e) => setChoiceNodes(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-700 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-900"
                />
                <span className="text-slate-300">Choices</span>
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
                  onShowInXae={canNavigateInXae ? handleShowInXae : undefined}
                  problemMarkers={lintProblemMarkers}
                  liveHighlight={liveHighlight ?? simHighlight}
                  pathHighlight={pathHighlight}
                  diffHighlight={diffHighlight}
                  liveGuards={liveGuardViews ?? simViews}
                  contextMenuItems={diagramContextMenuItems}
                  connectFrom={connectFrom}
                  onConnectTo={handleConnectTo}
                  onConnectCancel={() => setConnectFrom(null)}
                  onEdgeEndpointDrop={pouContent ? handleEdgeEndpointDrop : undefined}
                  onCanvasKey={handleCanvasKey}
                  onPaletteElement={pouContent ? handlePaletteElement : undefined}
                  onStateDropped={pouContent ? handleStateDropped : undefined}
                  history={{ ...historyState, onUndo: () => stepHistory(true), onRedo: () => stepHistory(false) }}
                  placeRequest={placeRequest}
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
              liveStateId={liveActive ? liveSession.current?.state ?? null : simHighlight?.stateId ?? null}
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
              codeJump={codeJump}
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

      {isDockTabMounted('simulate') &&
        createPortal(
          <SimulationPanel
            live={liveActive}
            active={sim.active}
            states={[...knownStates].filter((s) => s !== '[*]').sort()}
            startState={simStartState}
            current={sim.current}
            history={sim.history}
            transitions={simTransitions}
            variables={simVariables}
            onStart={(state) => {
              setSim((s) => ({ ...s, active: true, current: state, history: [] }));
              handleJumpToState(state);
            }}
            onStop={() => setSim((s) => ({ ...s, active: false, current: null, history: [] }))}
            onTake={simTake}
            onStep={() => {
              const t = simTransitions.find((x) => x.result === 'true' || x.result === 'always');
              if (t) simTake(t.edgeId);
              else showCopyToast('No transition holds with these values', 'error');
            }}
            onBack={() =>
              setSim((s) => (s.history.length ? { ...s, current: s.history[s.history.length - 1].from, history: s.history.slice(0, -1) } : s))
            }
            onSetValue={(name, value) =>
              setSim((s) => {
                const values = { ...s.values };
                if (value === undefined) delete values[name.toLowerCase()];
                else values[name.toLowerCase()] = value;
                return { ...s, values };
              })
            }
            onGoTo={handleJumpToState}
          />,
          dockRegistry.nodes.simulate
        )}

      {isDockTabMounted('overview') &&
        createPortal(
          <div className="flex-1 min-h-0 w-full flex flex-col overflow-y-auto bg-slate-950">
            <div className="flex-1 min-h-[20rem] flex flex-col">
              <MachineOverview
                connected={liveStatus.state === 'connected' && !replay}
                root={symbolRoot}
                onRootChange={setSymbolRoot}
                browse={liveBrowse}
                values={liveVarValues}
                onFollow={handleOverviewPaths}
                stateVar={liveStateVar}
                currentInstance={liveStatus.instance}
                pouTypeName={pouTypeName}
                pouStateNames={liveEnumNames}
                onWatch={(m) => handleWatchMachine(m)}
                openTarget={isXaeHost() || liveMode === 'web' ? 'tab' : 'window'}
              />
            </div>
            <OtherPlcsOverview
              via={sideVia}
              candidates={sideCandidates}
              stateVar={liveStateVar}
              pouTypeName={pouTypeName}
              pouStateNames={liveEnumNames}
              onWatch={(m, plc) => handleWatchMachine(m, plc.plc ? { plc: plc.plc, gateway: plc.gateway ?? liveSettings.gateway } : { netId: plc.netId ?? '', ip: plc.ip ?? '', port: plc.port ?? '', localNetId: plc.localNetId ?? '' })}
              openTarget={isXaeHost() || liveMode === 'web' ? 'tab' : 'window'}
            />
          </div>,
          dockRegistry.nodes.overview
        )}

      {isDockTabMounted('pou') &&
        createPortal(
          <PouCodeEditor
            pouContent={pouContent}
            pouFileName={pouFileName || 'POU.TcPOU'}
            onSave={handleSavePouBody}
            onToast={showCopyToast}
            onOpenMethod={handleOpenMethodEditorModal}
          />,
          dockRegistry.nodes.pou
        )}

      {isDockTabMounted('live') &&
        createPortal(
          <LivePanel
            mode={liveMode}
            gatewayOrigin={gatewayOrigin}
            defaultVia={gatewayOrigin ? 'gateway' : 'link'}
            token={liveVia === 'link' ? linkCode : gatewayToken}
            onTokenChange={liveVia === 'link' ? setLinkCode : setGatewayToken}
            rememberToken={liveVia === 'link' ? rememberLinkCode : rememberGatewayToken}
            onRememberTokenChange={liveVia === 'link' ? setRememberLinkCode : setRememberGatewayToken}
            stateVar={identifiedStatesResult.stateVarName || 'machineState'}
            status={liveStatus}
            session={liveSession}
            hasEnumNames={liveEnumNames.size > 0}
            settings={liveSettings}
            onSettingsChange={handleLiveSettingsChange}
            onStart={handleLiveStart}
            onStop={handleLiveStop}
            onClear={() => setLiveSession((s) => ({ ...EMPTY_LIVE_SESSION, current: s.current, clockOffset: s.clockOffset }))}
            onSelectState={(id) => handleJumpToState(id)}
            follow={liveFollow}
            onFollowChange={setLiveFollow}
            onOpenHistory={handleLiveOpenHistory}
            guardScope={liveGuardScope}
            onGuardScopeChange={setLiveGuardScope}
            guards={liveActiveGuards}
            onOpenInstance={liveMode ? handleOpenInstance : undefined}
            openTarget={isXaeHost() || liveMode === 'web' ? 'tab' : 'window'}
            onOpenSymbols={liveMode && !replay ? () => setDockLayout((l) => activateDockTab(l, 'symbols')) : undefined}
            onOpenOverview={liveMode && !replay ? () => setDockLayout((l) => activateDockTab(l, 'overview')) : undefined}
            limitMs={liveLimit}
            stateLimitMs={liveSession.current ? stateLimits[liveSession.current.state] ?? null : null}
            onStateLimitChange={pouTypeName ? (ms) => liveSession.current && handleStateLimit(liveSession.current.state, ms) : undefined}
            defaultLimitMs={defaultLimit}
            onDefaultLimitChange={setDefaultLimit}
            rememberedPlcs={rememberedPlcs}
            onRememberPlc={handleRememberPlc}
            onForgetPlc={(netId) => updateRememberedPlcs((list) => list.filter((p) => p.netId !== netId))}
            onScanPlcs={handleScanPlcs}
            onAddRoute={handleAddRoute}
            onRenamePlc={(netId, name) => updateRememberedPlcs((list) => list.map((p) => (p.netId === netId ? { ...p, name } : p)))}
            onSwitchPlc={handleSwitchPlc}
            sso={ssoHere && gatewaySso ? { provider: gatewaySso.provider, user: gatewaySso.user, name: gatewaySso.name, tokens: gatewaySso.tokens } : undefined}
            onSignIn={() => {
              window.location.href = `/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`;
            }}
            boardUrl={
              liveMode === 'web' && liveVia === 'gateway' && (gatewayOrigin || liveSettings.gateway)
                ? `${window.location.pathname}?board${liveSettings.gateway && !ssoHere ? `&gateway=${encodeURIComponent(liveSettings.gateway)}` : ''}`
                : undefined
            }
            onSignOut={() => {
              if (!gatewayOrigin) return;
              handleLiveStop();
              gatewayRef.current?.close();
              void gatewaySignOut(gatewayOrigin).then(() => fetchGatewaySso(gatewayOrigin)).then(setGatewaySso);
            }}
            canSaveRecording={!recorderRef.current.empty && !replay}
            onSaveRecording={() => void handleSaveRecording()}
            onOpenRecording={(f) => void handleOpenRecording(f)}
            replay={replayView}
            onReplayPlay={(playing) => setReplay((r) => (r ? { ...r, playing, pos: playing && r.pos >= r.to ? r.from : r.pos } : r))}
            onReplaySeek={(pos) => setReplay((r) => (r ? { ...r, pos: Math.max(r.from, Math.min(r.to, pos)) } : r))}
            onReplaySpeed={(speed) => setReplay((r) => (r ? { ...r, speed } : r))}
            notify={notifyOn}
            onNotifyChange={(on) => {
              if (on) requestNotifyPermission();
              setNotify(on);
            }}
          />,
          dockRegistry.nodes.live
        )}

      {isDockTabMounted('symbols') &&
        createPortal(
        <SymbolBrowserWindow
          connected={liveStatus.state === 'connected'}
          root={symbolRoot}
          onRootChange={setSymbolRoot}
          browse={liveBrowse}
          values={liveVarValues}
          watched={liveWatched}
          onVisibleValues={handleSymbolPaths}
          currentInstance={liveStatus.instance}
          stateVar={liveStateVar}
          onWatch={handleWatchMachine}
          openTarget={isXaeHost() || liveMode === 'web' ? 'tab' : 'window'}
        />,
          dockRegistry.nodes.symbols
        )}

      {changesTabMounted &&
        createPortal(
          <ChangesPanel
            base={compareBase}
            onBaseChange={(b) => {
              if (b === 'git') setGitBaseline(null); // read it again
              setCompareBase(b);
            }}
            savedLabel={isXaeHost() && pouPath && hostSavedContent[pouPath] !== undefined ? 'saved in XAE' : 'as loaded'}
            gitAvailable={canReadGitVersions()}
            loading={compareBase === 'git' && !!gitBaseline?.loading}
            error={compareBase === 'git' ? gitBaseline?.error ?? null : null}
            note={compareBase === 'git' ? gitBaseline?.note ?? null : null}
            diff={chartDiff}
            showOnDiagram={compareOnDiagram}
            onShowOnDiagramChange={setCompareOnDiagram}
            onJumpToState={(id) => handleJumpToState(id)}
          />,
          dockRegistry.nodes.changes
        )}

      {isDockTabMounted('paths') &&
        createPortal(
          <PathsPanel
            states={diagramStateIds}
            from={pathFrom}
            to={pathTo}
            onChange={(f, t) => {
              setPathFrom(f);
              setPathTo(t);
              setPathIndex(null);
            }}
            result={pathResult}
            selected={pathIndex}
            onSelect={setPathIndex}
            onJumpToState={(id) => handleJumpToState(id)}
            onClear={() => {
              setPathFrom('');
              setPathTo('');
              setPathIndex(null);
            }}
          />,
          dockRegistry.nodes.paths
        )}

      {isDockTabMounted('problems') &&
        createPortal(
          <ProblemsPanel
            findings={lintFindings}
            ignoredKeys={lintIgnored}
            onToggleIgnore={handleToggleLintIgnore}
            onSelectState={(id) => handleJumpToState(id)}
            onGoToCode={handleLintGoToCode}
            goToCodeLabel={canNavigateInXae ? 'Show in TwinCAT editor' : 'Open code'}
            onApplyFix={handleLintFix}
          />,
          dockRegistry.nodes.problems
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
            onOpenLogger={() => showDockTab('logger')}
            onDatasetChange={(ds) => setHistoryDataset(ds)}
            onJumpToState={handleJumpToState}
            onToast={showCopyToast}
          />,
          dockRegistry.nodes.history
        )}

      {isDockTabMounted('logger') &&
        createPortal(
          <PlcTransitionLoggerTool
            states={identifiedStatesResult.states}
            edges={availableEdges}
            pouFileName={pouFileName}
            onPopulateHistory={(newDs, msg) => {
              setHistoryDataset(newDs);
              showDockTab('history');
              if (msg) showCopyToast(msg, 'success');
            }}
            onToast={showCopyToast}
          />,
          dockRegistry.nodes.logger
        )}

      {promptRequest && <TextPromptDialog request={promptRequest} onClose={() => setPromptRequest(null)} />}
      {choiceRequest && <ChoiceDialog request={choiceRequest} onClose={() => setChoiceRequest(null)} />}
      {forkJoinRequest && <ForkJoinDialog request={forkJoinRequest} onClose={() => setForkJoinRequest(null)} />}

      {docProgress && (
        <div id="doc-progress-overlay" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50">
          <div className="w-[380px] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-4 text-xs space-y-3">
            <div className="font-semibold text-slate-100">Documenting the state machines</div>
            <div id="doc-progress-text" className="text-slate-400 truncate">
              {docProgress.total ? `${docProgress.done} / ${docProgress.total}: ${docProgress.name}` : docProgress.name}
            </div>
            <div className="h-1.5 rounded bg-slate-800 overflow-hidden">
              <div className="h-full bg-violet-500 transition-all" style={{ width: `${docProgress.total ? (100 * docProgress.done) / docProgress.total : 5}%` }} />
            </div>
            <div className="flex justify-end">
              <button id="doc-cancel-btn" onClick={() => (docCancelRef.current = true)} className="px-3 py-1 rounded-md text-slate-300 hover:bg-slate-800">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status bar: messages (formerly pop-ups), file and save state, counts, problems, live view */}
      {!focusMode && (
        <StatusBar
          message={copyToast ? { text: copyToast.message, type: copyToast.type } : pdfToast ? { text: pdfToast.message, type: pdfToast.type } : null}
          onDismissMessage={() => {
            setCopyToast(null);
            setPdfToast(null);
          }}
          fileName={pouFileName}
          unsavedCount={isXaeHost() ? hostDirtyFiles.length : localDirtyCount}
          changedInXae={!!hostConflict}
          statesCount={identifiedStatesResult.states.length}
          transitionsCount={availableEdges.length}
          errors={activeLintFindings.filter((f) => f.severity === 'error').length}
          warnings={activeLintFindings.filter((f) => f.severity === 'warning').length}
          onOpenProblems={() => showDockTab('problems')}
          live={liveActive ? { state: liveSession.current?.state ?? null, message: liveStatus.message } : null}
          onOpenLive={() => showDockTab('live')}
          changes={chartDiff && compareOnDiagram ? chartDiff.total : null}
          onOpenChanges={() => showDockTab('changes')}
          host={isXaeHost() ? 'XAE' : desktopLive() ? 'Desktop' : 'Web'}
          followSelection={followSelection}
          onFollowSelectionChange={setFollowSelection}
          backTo={pouHistory.length ? { name: pouHistory[pouHistory.length - 1].name, onClick: handleBackToPreviousPou } : null}
        />
      )}
    </div>
  );
};
