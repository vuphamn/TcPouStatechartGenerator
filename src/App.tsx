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
  Cpu,
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
  Spline,
  Undo2,
  Redo2,
  ListTree,
  FlaskConical,
  Pencil,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  Grid3x3,
} from 'lucide-react';
import { generateStatechart, generateStatechartModel, inferredComposites, PriorityFormat, subMachinesOf } from './generator.ts';
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
import { rankDutCandidates, dutFileKey, DutCandidate, DutMatch } from './utils/dutMatcher.ts';
import {
  browseForPou,
  readDrop,
  PICKED_FILE_REFUSED,
  findDutCandidates,
  chooseDutFiles,
  isDesktopApp,
  canPickFolder,
  PouSource,
  canWriteBack,
  isEmbeddedBrowser,
  downloadSource,
  writeWebSource,
  webProjectUses,
  writeWebOtherPous,
  webProjectFolder,
  writeWebProjectFile,
} from './utils/sourceFileAccess.ts';
import type { WebSaveResult } from './utils/sourceFileAccess.ts';
import { HostMessage, isXaeHost, onHostMessage, postToHost } from './utils/xaeHost.ts';
import { setOpenTypeHandler, type OpenTypeWhere, type InlineRename } from './utils/openType.ts';
import { declareInDeclaration, declareVariables, declarationVariables, guessType, removeFromDeclaration, type NewVariable } from './utils/pouVariables.ts';
import { DeclareVariableDialog } from './components/DeclareVariableForm.tsx';
import { baseTypeName, buildProjectSymbols, getProjectSymbols, hasProjectSymbols, onProjectSymbols, setProjectSymbols, symbolScope, type ProjectFile } from './utils/projectSymbols.ts';
import { setTransitionCondition, transitionCondition } from './utils/transitionEdits.ts';
import { allStateActions, readStateCode, writeStateCode } from './utils/stateActions.ts';
import { lineDiff } from './utils/lineDiff.ts';
import { isLearnedPou, learnedAsSource, learnedInputOf, learnedSources } from './utils/learnedChart.ts';
import { plcPous, plcPouSource, plcProjectFiles, type PlcSources, type PlcCopy, type PlcCopyResult } from './utils/plcSources.ts';
import { editorParts, pendingEditors, pendingParts, savePendingEditors, usePendingEditors } from './utils/pendingSaves.ts';
import { SAVE_TO_FILE_EVENT } from './components/SaveToFileButton.tsx';
import { CODE_FOCUS_EVENT, type CodeFocus } from './utils/codeFocus.ts';
import { isEmptyLayout, layoutFileNameOf, parseLayout, serializeLayout, type PouLayout } from './utils/pouLayout.ts';
import { layoutHost, readLayoutFile, WEB_LAYOUT_PREFIX, writeLayoutFile, type LinkRequest } from './utils/hostLayout.ts';
import { pickWebLayoutFolder, webLayoutReady } from './utils/sourceFileAccess.ts';
import { diffLayouts, mergeLayouts, readConflict } from './utils/layoutConflict.ts';
import { IoTreePanel, type IoGuardUse, type IoTree } from './components/IoTreePanel.tsx';
import { allBoxes, boxStates, stateEvents, type EcatStatesResult, type IoEvent, type SlaveState } from './components/IoNetworkView.tsx';
import type { BoxSince, CrcBase, DeviceInfo, DeviceInfoRequest } from './components/IoBoxProperties.tsx';
import { canPickIoFolder, readIoFolderInBrowser } from './utils/ioFolder.ts';
import { IDE_THEMES, ideThemeOf, ideThemesCss } from './utils/ideThemes.ts';

/** A short two-tone beep (an I/O alert) */
function ioBeep() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    [880, 660].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.value = 0.08;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.15);
    });
    window.setTimeout(() => void ctx.close(), 800);
  } catch {
    // (no audio here)
  }
}
import { DiffDialog, DiffPanel, OPEN_DIFF_EVENT, setFilesChanged, showEditorDiff, type DiffPart, type DiffRequest } from './components/DiffDialog.tsx';
import { checkMethodRename, checkRename, findReferences, renameMemberInFile, renameMethod, renameVariable, renameWordInFile, type Reference } from './utils/renameVariable.ts';
import { ShortcutsDialog } from './components/ShortcutsDialog.tsx';
import { setUserSnippets, snippetsFromText, snippetsToText, userSnippets, BUILTIN_SNIPPETS, snippetsToFile, snippetsFromFile, mergeSnippets } from './utils/stSnippets.ts';
import { ReferencesDialog } from './components/ReferencesDialog.tsx';
import { deadLines, lintVariables, plannedCall } from './utils/variableLint.ts';
import { checkExtract, checkExtractAction, checkExtractProperty, extractAction, extractMethod, extractProperty, guessExpressionType, planExtract, planExtractProperty } from './utils/extractMethod.ts';
import { checkExtractSubMachine, defaultSubMachineState, extractSubMachine } from './utils/extractSubMachine.ts';
import { blankComments } from './utils/stateMachineLint.ts';
import { caseBranchRange } from './utils/stateEdits.ts';
import { extractPouDeclaration } from './utils/stSymbolDefinition.ts';
import { stateQualifier } from './utils/stateNames.ts';
import { BODY, ENUM_KEY, clearBookmarks, declarationOf, exportBookmarks, importBookmarks, isDeclarationKey, listBookmarks, setBookmarkNote, toggleStateBookmark, useBookmarks, type BookmarkEntry } from './utils/bookmarks.ts';
import { parseDutContent, updateDutDeclaration } from './utils/dutEnumEditor.ts';
import { BookmarksDialog } from './components/BookmarksDialog.tsx';
import { ReleaseNotesDialog } from './components/ReleaseNotesDialog.tsx';
import { armState } from './utils/choiceArms.ts';
import { COMPOSITE_PRESETS, normalizeCompositeColor } from './utils/compositeColors.ts';
import { dutPartDiff, pouPartDiffs, type PartDiff } from './utils/pouDiff.ts';
import { editionOf, editionVersion } from './utils/releaseNotes.ts';
import { PlcBuildDialog, type PlcBuildState } from './components/PlcBuildDialog.tsx';
import type { CheckRequest, CheckResult } from './utils/connectionCheck.ts';
import { base64ToBytes, buildItemWhere, bytesToBase64, itemInPou, placeOfXaeFile, plcEdits, type PlcAppInfo, type PlcBuildItem, type PlcBuildResult, type PlcEdit, type PlcOrigin, type PlcWrite } from './utils/plcBuild.ts';
import { CommandPalette, type PaletteCommand } from './components/CommandPalette.tsx';
import { getPouBody } from './utils/pouBody.ts';
import { locateState, locateTransition, subMachineId, caseVariable, methodLines } from './utils/sourceLocation.ts';
import { LintFinding, addCaseBranch, addEnumMember, enumMembers, lintStateMachine } from './utils/stateMachineLint.ts';
import { ProblemsPanel } from './components/ProblemsPanel.tsx';
import { StatusBar, type LayoutMenu, type LayoutStatus } from './components/StatusBar.tsx';
import { PathsPanel } from './components/PathsPanel.tsx';
import { ChangesPanel, CompareBase } from './components/ChangesPanel.tsx';
import { diffCharts } from './utils/chartDiff.ts';
import { canReadGitVersions, fetchCommittedVersion } from './utils/hostGit.ts';
import { ReferencedMachine, declaredMachineMembers, referencedMachines } from './utils/referencedMachines.ts';
import { getStateCodeFromPou, getMethodCodeFromPou, getAllMethodsFromPou, getPropertyAccessorsFromPou, getActionsFromPou } from './utils/pouStateEditor.ts';
import { buildProjectDocumentation } from './utils/projectDocumentation.ts';
import { loadProjectFiles, saveDocument } from './utils/projectFiles.ts';
import { declarationLineCount, implementationLineCount, stateAtLine } from './utils/stateMachineLint.ts';
import { findPaths } from './utils/statePaths.ts';
import { TextPromptDialog, TextPromptRequest } from './components/TextPromptDialog.tsx';
import { addState, addTransition, checkNewStateName, renameEdgeKeys, renameKey, renameState } from './utils/stateEdits.ts';
import { deleteTransition, moveTransitionStart, retargetTransition, setTransitionPriority, transitionOrder, TransitionEditResult } from './utils/transitionEdits.ts';
import { copyName, copyState, copyStates, deleteState, removeEnumMember } from './utils/stateCopyDelete.ts';
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
  compositeColorsOf,
  setCompositeColor,
  groupInComposite,
  ungroupComposite,
  nestComposite,
  moveToComposite,
  writeCompositeMarkers,
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
import { EMPTY_LIVE_SESSION, LiveSession, MAX_LIVE_TRANSITIONS, applyLiveSamples, enumValueMap, recheckInModel } from './utils/liveView.ts';
import {
  buildEnumTables,
  buildGuardEdges,
  evaluateGuards,
  appliesToState,
  collectRefs,
  evaluate as evaluateExpr,
  parseCondition,
  symbolCandidates,
  variablesToWatch,
  type GuardInputs,
  type LiveValue,
  type WatchedVar,
} from './utils/liveGuards.ts';
import type { LiveBrowseResult, LiveWatchVar, SymbolChild } from './utils/xaeHost.ts';
import { type PlcInstancesResult, desktopLive } from './utils/liveHost.ts';
import { ALL_PLC_CONTROLS, type PlcControlMode, type PlcControlResult, type PlcState } from './components/PlcControls.tsx';
import type { PlcActionEntry } from './utils/plcActionLog.ts';

// (the layout file: its POU's name, of a path or of the web edition's web:<name>; routes compared key by key; no look)
const pouNameOf = (pou: string) => (pou.split(/[\\/]/).pop() ?? pou).replace(WEB_LAYOUT_PREFIX, '');
const stableEdges = (e: EdgeOffsetsMap) => Object.fromEntries(Object.entries(e).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
const emptyLook: PouLayout['look'] = { states: {}, transitions: {}, collapsed: [] };
import { LiveRecorder, parseRecording, recordingFileName, recordingSpan, upperBound, type LiveRecording } from './utils/liveRecording.ts';
import { addSeen, loadSeen, removedSeenTransitions, saveSeen, seenKey, seenText, stateSeen, type SeenMap, forgetSeen, setSeenCondition, candidatesOf } from './utils/seenTransitions.ts';
import { probePlcs, refreshRemembered, addRouteOnPlc, canScanPlcs, ipFieldFor, loadRememberedPlcs, saveRememberedPlcs, scanPlcs, type AddRouteBoth, type AddRouteResult, type FoundPlc, type PlcScanResult, type RememberedPlc } from './utils/plcDiscovery.ts';
import { GatewayConnection, GatewayPlc, GatewaySso, detectGatewayOrigin, fetchGatewaySso, gatewaySignOut, gatewaySocketUrl, type HelperBuild } from './utils/liveGateway.ts';
import { useStoredSecret } from './hooks/useStoredSecret.ts';
import { InstanceLaunch, connectionOf, putHandoff, sameInstance, takeHandoff } from './utils/instanceLaunch.ts';
import { DEFAULT_SYMBOL_ROOT, SymbolBrowserWindow, symbolWatchId } from './components/SymbolBrowserWindow.tsx';
import { MachineOverview, overviewWatchId } from './components/MachineOverview.tsx';
import { OtherPlcsOverview } from './components/OtherPlcsOverview.tsx';
import { GatewayRecordingsDialog } from './components/GatewayRecordingsDialog.tsx';
import { BeforeAfterDialog } from './components/BeforeAfterDialog.tsx';
import { CompareRecordingsDialog } from './components/CompareRecordingsDialog.tsx';
import { stateTimeLevels, stateTimes } from './utils/stateTimes.ts';
import { loadPathChecks, pathCheckFindings, pathCheckFrom, runPathChecks, savePathChecks, type PathCheck } from './utils/pathChecks.ts';
import { downloadCsv, toCsv } from './utils/csv.ts';
import { appInfo, checkForUpdate, installDesktopUpdate, loadUpdateSettings, saveUpdateSettings } from './utils/updates.ts';
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
  splitDockTab,
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
import { applyCustomStylesToMermaid, extractStateNodesFromMermaid } from './utils/nodeStyles.ts';
import { applyNotesToMermaid } from './utils/diagramNotes.ts';
import { NodeOffsetsMap, type EdgeOffsetsMap } from './utils/nodeDragger.ts';
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
  const [dutFiles, setDutFiles] = useState<DutCandidate[]>([]);
  const [subDutEdits, setSubDutEdits] = useState<Record<string, string>>({});
  const [subDutSaved, setSubDutSaved] = useState<Record<string, string>>({});
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
  const [collapseErrorSinkEdges, setCollapseErrorSinkEdges] = useState<boolean>(false);
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
  // An IF's ELSE in a guard written as what it is ("NOT (a)"), not "else": per viewer
  const [spellOutElse, setSpellOutElseState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('kss.spellOutElse') === 'true';
    } catch {
      return false;
    }
  });
  const setSpellOutElse = useCallback((on: boolean) => {
    setSpellOutElseState(on);
    try {
      localStorage.setItem('kss.spellOutElse', String(on));
    } catch {
      // (not remembered)
    }
  }, []);
  const [includeStateDescriptions, setIncludeStateDescriptions] = useState<boolean>(
    SAMPLES[0].defaultIncludeDescriptions
  );
  // (a state shows its name and its description only: its entry / do / exit actions are edited from its menu, not
  // drawn on it)
  const stateActions: ReturnType<typeof allStateActions> | undefined = undefined;
  const [showTransitionPriorities, setShowTransitionPriorities] = useState<boolean>(true);
  const [priorityFormat, setPriorityFormat] = useState<PriorityFormat>(initialPreset.priorityFormat);
  // The composites drawn collapsed (one box each), kept per POU in this browser: a view, the code not changed
  const [collapsedComposites, setCollapsedComposites] = useState<string[]>([]);
  const [layoutEngine, setLayoutEngine] = useState<LayoutEngine>(initialPreset.layoutEngine);
  const [flowchartCurve, setFlowchartCurve] = useState<FlowchartCurve>(initialPreset.flowchartCurve);
  const [mermaidTheme, setMermaidTheme] = useState<MermaidTheme>(initialPreset.mermaidTheme);
  // The header's Theme & Preset panel
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [appearanceAt, setAppearanceAt] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!appearanceOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      // (inside it, or a preset menu it opened)
      if (t?.closest?.('#header-appearance, #header-appearance-panel, #diagram-presets-dropdown-menu, [role="dialog"]')) return;
      setAppearanceOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [appearanceOpen]);
  // The Theme for the whole app, not only the diagram: a light one on <html data-app-theme> (src/styles/appThemes.css);
  // an IDE's on <html data-ide-theme> (its greys and accent; a light one over the light palette, "default")
  useEffect(() => {
    const el = document.documentElement;
    const ide = ideThemeOf(mermaidTheme);
    if (ide) {
      if (!document.getElementById('kss-ide-themes')) {
        const style = document.createElement('style');
        style.id = 'kss-ide-themes';
        style.textContent = ideThemesCss();
        document.head.appendChild(style);
      }
      el.setAttribute('data-ide-theme', ide.id);
      if (ide.dark) el.removeAttribute('data-app-theme');
      else el.setAttribute('data-app-theme', 'default');
      return;
    }
    el.removeAttribute('data-ide-theme');
    if (mermaidTheme === 'dark') el.removeAttribute('data-app-theme');
    else el.setAttribute('data-app-theme', mermaidTheme);
  }, [mermaidTheme]);
  // The composites' colour (Composites: next to Theme), kept in this browser; a composite's own is in the enum
  const [compositeColor, setCompositeColorPreset] = useState<string>(() => {
    try {
      return normalizeCompositeColor(localStorage.getItem('kss.compositeColor') ?? '') ?? 'sand';
    } catch {
      return 'sand';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('kss.compositeColor', compositeColor);
    } catch {
      // (not kept)
    }
  }, [compositeColor]);
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
  const focusModeRef = useRef(focusMode);
  focusModeRef.current = focusMode;
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

  // Diagram notes and state documentation, kept per POU in localStorage. Several MachineScopes (browser tabs, desktop
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
  // Window menu: another MachineScope for another POU (desktop app: a window; web edition: a browser tab). In XAE each
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
        collapseErrorSinkEdges, choiceNodes, spellOutElse,
        includeStateDescriptions, stateActions,
        showTransitionPriorities,
        priorityFormat, collapsedComposites,
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
    collapseErrorSinkEdges, choiceNodes, spellOutElse,
    includeStateDescriptions, stateActions,
    showTransitionPriorities,
    priorityFormat, collapsedComposites,
  ]);

  // Apply custom node styles for live diagram canvas display
  // How big a choice diamond is drawn (its label's class: index.css .kss-choice-*), kept per viewer
  const [choiceSize, setChoiceSizeState] = useState<'small' | 'medium' | 'large'>(() => {
    try {
      const v = localStorage.getItem('kss.choiceSize');
      return v === 'small' || v === 'large' ? v : 'medium';
    } catch {
      return 'medium';
    }
  });
  const setChoiceSize = useCallback((v: 'small' | 'medium' | 'large') => {
    setChoiceSizeState(v);
    try {
      localStorage.setItem('kss.choiceSize', v);
    } catch {
      // per-viewer convenience only
    }
  }, []);
  const styledMarkdown = useMemo(() => {
    const styled = applyCustomStylesToMermaid(rawMarkdown, customNodeStyles);
    return choiceSize === 'medium' ? styled : styled.split("class='kss-choice-pad'").join(`class='kss-choice-pad kss-choice-${choiceSize}'`);
  }, [rawMarkdown, customNodeStyles, choiceSize]);

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
  // (and the chart's states: the Complexity Report's sub-machines are scored from them)
  const availableStates = useMemo(() => extractStateNodesFromMermaid(outputMarkdown), [outputMarkdown]);

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
            collapseErrorSinkEdges, choiceNodes, spellOutElse,
            includeStateDescriptions, stateActions,
            showTransitionPriorities,
            priorityFormat, collapsedComposites,
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
      collapseErrorSinkEdges, choiceNodes, spellOutElse,
      includeStateDescriptions, stateActions,
      showTransitionPriorities,
      priorityFormat, collapsedComposites,
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
            collapseErrorSinkEdges, choiceNodes, spellOutElse,
            includeStateDescriptions, stateActions,
            showTransitionPriorities,
            priorityFormat, collapsedComposites,
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
      collapseErrorSinkEdges, choiceNodes, spellOutElse,
      includeStateDescriptions, stateActions,
      showTransitionPriorities,
      priorityFormat, collapsedComposites,
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
        const result = generateStatechart(dut, pou, { flowchartOutput, collapseErrorSinkEdges, choiceNodes, spellOutElse, includeStateDescriptions, stateActions, showTransitionPriorities, priorityFormat, collapsedComposites });
        setRawMarkdown(result);
        setGenerationStats({ statesCount: (result.match(/-->/g) || []).length, linesCount: result.split('\n').length, timeMs: Math.round(performance.now() - startTime) });
      } catch (genErr: unknown) {
        setGenerationError(genErr instanceof Error ? genErr.message : String(genErr));
      }
    },
    [pouContent, dutContent, flowchartOutput, collapseErrorSinkEdges, choiceNodes, spellOutElse, includeStateDescriptions, stateActions, showTransitionPriorities, priorityFormat, collapsedComposites]
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
            collapseErrorSinkEdges, choiceNodes, spellOutElse,
            includeStateDescriptions, stateActions,
            showTransitionPriorities,
            priorityFormat, collapsedComposites,
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
      collapseErrorSinkEdges, choiceNodes, spellOutElse,
      includeStateDescriptions, stateActions,
      showTransitionPriorities,
      priorityFormat, collapsedComposites,
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
            collapseErrorSinkEdges, choiceNodes, spellOutElse,
            includeStateDescriptions, stateActions,
            showTransitionPriorities,
            priorityFormat, collapsedComposites,
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
      collapseErrorSinkEdges, choiceNodes, spellOutElse,
      includeStateDescriptions, stateActions,
      showTransitionPriorities,
      priorityFormat, collapsedComposites,
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
      setDutFiles(candidates);
      setSubDutEdits({});
      setSubDutSaved({});
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

  // A POU from the PLC's own sources: where it is there (Build puts the edits back)
  const [plcOrigin, setPlcOrigin] = useState<PlcOrigin | null>(null);
  // The other POUs (and enums) of the PLC edited in this session, kept when another was opened: built with it
  const [plcSessionEdits, setPlcSessionEdits] = useState<Record<string, PlcEdit>>({});
  const applyLoadedPou = useCallback(
    (src: PouSource, launch?: InstanceLaunch) => {
      setPlcOrigin(src.plc ?? null);
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
      const message = e instanceof Error ? e.message : String(e);
      showCopyToast(message === PICKED_FILE_REFUSED ? message : `Could not open the .TcPOU: ${message}`, 'error', message === PICKED_FILE_REFUSED ? 12000 : undefined);
    }
  }, [applyLoadedPou, showCopyToast]);
  const handleBrowsePou = useCallback(() => confirmDiscard(() => void browseNow()), [browseNow]);

  // Desktop: a .TcPOU opened from Windows Explorer ("Open in Kval MachineScope"): at start-up, or later in this window
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
      applyLoadedPou({ name: h.pou.name, content: h.pou.content, path: h.pou.path, dutCandidates: dut, plc: h.pou.plc }, h);
    }
    // At start-up only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opened from the operator board (a tile): ?watch=<POU type>&instance=<path>&plc=<gateway PLC>[&gateway=]. A sample of
  // that type loads at once; else the banner asks for the .TcPOU (a file dialog needs a click). Live once it is loaded.
  const [watchRequest, setWatchRequest] = useState<{ type: string; instance: string; connection: Record<string, string> } | null>(() => {
    const q = new URLSearchParams(window.location.search);
    const type = q.get('watch');
    const instance = q.get('instance');
    if (!type || !/^[A-Za-z_]\w*$/.test(type) || !instance || !isSymbolPathText(instance)) return null;
    const connection: Record<string, string> = { via: 'gateway', plc: q.get('plc') ?? '' };
    if (q.get('gateway')) connection.gateway = q.get('gateway')!;
    return { type, instance, connection };
  });
  useEffect(() => {
    if (!watchRequest) return;
    const sample = SAMPLES.find((s) => s.pouName.toLowerCase() === `${watchRequest.type}.tcpou`.toLowerCase());
    if (sample) handleSelectSample(sample);
    // At start-up only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleWatchBrowse = useCallback(async () => {
    if (!watchRequest) return;
    try {
      const src = await browseForPou();
      if (!src) return;
      if (src.name.replace(/\.TcPOU$/i, '').toLowerCase() !== watchRequest.type.toLowerCase()) {
        showCopyToast(`${src.name} is not ${watchRequest.type}.TcPOU: ${watchRequest.instance} is a ${watchRequest.type}`, 'error', 7000);
        return;
      }
      applyLoadedPou(src);
    } catch (e) {
      showCopyToast(`Could not open the .TcPOU: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }, [watchRequest, applyLoadedPou, showCopyToast]);

  const handleDropPou = useCallback(
    async (items: { file: File | null; handle: Promise<unknown> | null }[]) => {
      // (the handles are asked for during the drop: taken before any question)
      const settled = await Promise.all(items.map(async (i) => ({ file: i.file, handle: i.handle ? Promise.resolve(await i.handle.catch(() => null)) : null })));
      confirmDiscard(
        () =>
          void readDrop(settled)
            .then((src) => {
              if (!src) showCopyToast('Drop a .TcPOU (with its .TcDUT files), or the folder it is in', 'error', 6000);
              else if ('several' in src) showCopyToast(`The folder has ${src.several.length} .TcPOU files: drop or Browse the one to open (its enum is found in this folder then)`, 'success', 8000);
              else {
                applyLoadedPou(src);
                // (its enum not found: how to give it)
                if (!src.dutCandidates) showCopyToast('Its enum: drop its .TcDUT too, or the folder it is in (then any .TcPOU dropped from it finds its enum), or click Find .TcDUT…', 'success', 9000);
              }
            })
            .catch((e: unknown) => showCopyToast(`Could not open the .TcPOU: ${e instanceof Error ? e.message : String(e)}`, 'error', 8000))
      );
    },
    [applyLoadedPou, showCopyToast]
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
  // The watched values: the last one of each, and when it last changed (PLC ms)
  const varLastRef = useRef(new Map<string, string>());
  const varChangedRef = useRef(new Map<string, number>());
  useEffect(() => setSeen(loadSeen(seenPouType)), [seenPouType]);
  const seenUpToRef = useRef(0);
  useEffect(() => {
    const fresh = liveSession.transitions.filter((t) => t.t > seenUpToRef.current);
    if (!fresh.length) return;
    seenUpToRef.current = Math.max(...fresh.map((t) => t.t));
    // (a replay shows transitions already counted when they happened)
    if (replayingRef.current) return;
    // (the watched values that changed within a second before each: candidates for its condition)
    const changed = [...varChangedRef.current.entries()];
    const withBefore = fresh.map((t) => ({ ...t, before: changed.filter(([, at]) => at <= t.t && t.t - at <= 1000).map(([id]) => id) }));
    setSeen((s) => {
      const next = addSeen(s, withBefore);
      saveSeen(seenPouType, next);
      return next;
    });
  }, [liveSession.transitions, seenPouType]);
  const liveEnumNames = useMemo(() => enumValueMap(dutContent), [dutContent]);
  const liveNamesRef = useRef(liveEnumNames);
  liveNamesRef.current = liveEnumNames;
  const liveEdgesRef = useRef(availableEdges);
  liveEdgesRef.current = availableEdges;
  // (opened From PLC: once live, which of its instances, when the PLC has several)
  const pickInstanceRef = useRef(false);
  // (before going live, From PLC: onPick opens the POU live on the one chosen; closed without one: onDismiss)
  const [instancePicker, setInstancePicker] = useState<{ instances: string[]; current: string | null; typeName?: string; onPick?: (instance: string) => void; onDismiss?: () => void } | null>(null);
  const instancePickedRef = useRef(false);
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
    if (state === 'connected' && pickInstanceRef.current) {
      pickInstanceRef.current = false;
      if ((m.instances?.length ?? 0) > 1) setInstancePicker({ instances: m.instances!, current: m.instance ?? null });
    } else if (state === 'error') pickInstanceRef.current = false;
    // (not reset on stopped: From PLC while live stops first, and that stopped comes after the flag is set)
    setLiveStatus((prev) => ({
      state,
      message: m.message,
      target: m.target ?? prev.target,
      plcState: m.plcState ?? prev.plcState,
      instance: state === 'connected' ? m.instance : prev.instance,
      instances: m.instances && m.instances.length ? m.instances : prev.instances,
      route: m.route ?? prev.route,
      ports: state === 'error' ? m.ports : undefined,
      versions: state === 'connected' ? (m.twinCatBuild || m.xaeBuild ? { plc: m.twinCatBuild ?? null, xae: m.xaeBuild ?? null } : undefined) : prev.versions,
      // (the gateway's user and PLCs: from its welcome, kept)
      user: prev.user,
      plcs: prev.plcs,
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
  // The variables the shown code uses, and the ones watched from the code (per POU): followed while live too
  const [editorWatch, setEditorWatch] = useState<string[]>([]);
  const [userWatch, setUserWatch] = useState<string[]>([]);
  const liveValuesRef = useRef<{ active: boolean; values: Record<string, LiveValue> }>({ active: false, values: {} });
  const handleLiveWatchResult = useCallback((vars: { id: string; symbol?: string; type?: string; error?: string; enumNames?: Record<string, string> }[]) => {
    recorderRef.current.addWatched(vars);
    if (replayingRef.current) return;
    setLiveWatched((prev) => {
      const next = { ...prev };
      for (const v of vars) next[v.id] = { symbol: v.symbol, type: v.type, error: v.error, ...(v.enumNames ? { enumNames: v.enumNames } : {}) };
      return next;
    });
  }, []);
  const handleLiveVars = useCallback((values: { id: string; t: number; v: LiveValue | null }[]) => {
    recorderRef.current.addVars(values);
    if (replayingRef.current) return;
    // (when each value last changed, PLC time: a transition right after it has it as a candidate)
    for (const s of values) {
      if (s.v === null || s.v === undefined) continue;
      const key = JSON.stringify(s.v);
      if (varLastRef.current.has(s.id) && varLastRef.current.get(s.id) !== key && Number.isFinite(s.t)) varChangedRef.current.set(s.id, s.t);
      varLastRef.current.set(s.id, key);
    }
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
    // (sub-machines' enums, each in its own file)
    for (const c of dutFiles) {
      const text = subDutEdits[dutFileKey(c)];
      if (c.path && text !== undefined && hostSavedContent[c.path] !== undefined && hostSavedContent[c.path] !== text) files.push({ path: c.path, content: text });
    }
    return files;
  }, [hostSavedContent, pouPath, pouContent, dutPath, dutContent, dutFiles, subDutEdits]);

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
  // (the editors' Diff: enabled for their file's changes too)
  useEffect(() => setFilesChanged({ pou: !!pouDirty, enum: !!dutDirty }), [pouDirty, dutDirty]);
  // (a sub-machine's enum, in its own file: edited since it was read or saved)
  const subDutDirty = useMemo(
    () =>
      localSave
        ? dutFiles.filter((c) => {
            const key = dutFileKey(c);
            return subDutEdits[key] !== undefined && subDutEdits[key] !== (subDutSaved[key] ?? c.content);
          })
        : [],
    [localSave, dutFiles, subDutEdits, subDutSaved]
  );
  const localDirtyCount = Number(pouDirty) + Number(dutDirty) + subDutDirty.length;
  const localDirtyRef = useRef(false);
  localDirtyRef.current = localDirtyCount > 0;
  const markSaved = (kind: 'pou' | 'dut', content: string) => setSavedSources((b) => (kind === 'pou' ? { ...b, pou: content } : { ...b, dut: content }));
  // A diagram learned live: drawn again with each transition seen (not an edit: nothing to save)
  const learnedPou = useMemo(() => isLearnedPou(pouContent), [pouContent]);
  useEffect(() => {
    if (!learnedPou) return;
    const input = learnedInputOf(pouContent, dutContent);
    const next = input ? learnedSources({ ...input, seen }) : null;
    if (!next || next.pou === pouContent) return;
    setPouContent(next.pou);
    markSaved('pou', next.pou);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learnedPou, seen]);
  // (its transitions are in it once drawn: the Live tab stops counting them as not in the diagram)
  useEffect(() => {
    if (learnedPou) setLiveSession((s) => recheckInModel(s, availableEdges));
  }, [learnedPou, availableEdges]);
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
    async (kind: 'pou' | 'dut', given?: string) => {
      const content = given ?? (kind === 'pou' ? pouContent : dutContent);
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
  // A learned diagram as a source to finish: its POU (not learned any more: its conditions FALSE, to write) and enum
  const handleSaveLearnedAsSource = useCallback(() => {
    const pou = learnedAsSource(pouContent);
    setPouContent(pou);
    void (async () => {
      await handleSaveAs('pou', pou);
      if (dutContent) await handleSaveAs('dut', dutContent);
    })();
  }, [pouContent, dutContent, handleSaveAs]);
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
        // (sub-machines' enums, each in its own file)
        ...subDutDirty.map((c) => ({ kind: 'dut' as const, name: c.name, path: c.path, relativePath: c.relativePath, content: subDutEdits[dutFileKey(c)], baseline: subDutSaved[dutFileKey(c)] ?? c.content, sub: dutFileKey(c) })),
      ].filter((i): i is NonNullable<typeof i> => !!i);
      // (saved: the main files' baseline, or a sub-machine enum's)
      const markItem = (i: { kind: 'pou' | 'dut'; content: string; sub?: string }) => (i.sub ? setSubDutSaved((b) => ({ ...b, [i.sub!]: i.content })) : markSaved(i.kind, i.content));
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
              markItem(i);
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
            markItem(i);
            saved.push(i.name);
          } else if (res === 'conflict') conflicts.push(i.name);
          else if (!opts.quiet) {
            downloadSource(i.name, i.content);
            markItem(i);
            downloaded.push(i.name);
          }
        }
      }
      if (saved.length) showCopyToast(`Saved ${saved.join(' and ')}`, 'success');
      if (downloaded.length)
        showCopyToast(`Downloaded ${downloaded.join(' and ')}: ${canWriteBack() ? 'open it with Browse to save in place next time' : isEmbeddedBrowser ? "a browser inside another app (VS Code's) cannot write files back: open the page in Chrome or Edge to save in place" : 'this browser cannot write files back'}; replace the original with it`, 'success', 9000);
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
    [pouDirty, dutDirty, pouPath, dutPath, dutRelativePath, pouContent, dutContent, savedSources, handleSaveAs, showCopyToast, confirmSeenRemovals, subDutDirty, subDutEdits, subDutSaved]
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
  // The header's Save / Save All: the editor used last (or every editor) puts its edits into the POU, then the files
  // are written (once the POU has them)
  // What this window has to save (its editors' edits, its edited files): Save All in another window asks
  // (the editors counted when asked: their edits do not draw the app again)
  const dirtyFilesRef = useRef(0);
  dirtyFilesRef.current = isXaeHost() ? hostDirtyFiles.length : localDirtyCount;
  const saveAllChannelRef = useRef<BroadcastChannel | null>(null);
  const handleHeaderSave = useCallback((which: 'active' | 'all', fromOtherWindow = false) => {
    const had = pendingEditors().length + dirtyFilesRef.current;
    const n = savePendingEditors(which);
    window.setTimeout(() => {
      if (isXaeHost()) handleSaveToProjectRef.current();
      else void saveSourcesRef.current(n ? { quiet: false } : undefined);
    }, n ? 120 : 0);
    // Save All: the app's other windows (desktop) and tabs (XAE, web) save theirs too, and say what they saved. XAE:
    // also through the extension (a tab with a WebView2 profile of its own is not on the channel)
    const ch = saveAllChannelRef.current;
    const relay = isXaeHost();
    if (which !== 'all' || fromOtherWindow || (!ch && !relay)) return had;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const saved: string[] = [];
    const onDone = (e: MessageEvent) => {
      const m = e.data as { type?: string; id?: string; name?: string; count?: number } | null;
      if (m?.type === 'saveAllDone' && m.id === id && (m.count ?? 0) > 0) saved.push(m.name || 'another window');
    };
    ch?.addEventListener('message', onDone);
    ch?.postMessage({ type: 'saveAll', id });
    const offHost = relay
      ? onHostMessage((m) => {
          if (m.type === 'saveAllDone' && m.id === id && (m.count ?? 0) > 0) saved.push(m.name || 'another tab');
        })
      : null;
    if (relay) postToHost({ type: 'saveAllRelay', id });
    window.setTimeout(() => {
      offHost?.();
      ch?.removeEventListener('message', onDone);
      if (saved.length) showCopyToast(`Save All: also saved in ${saved.length} other window${saved.length === 1 ? '' : 's'} (${saved.join(', ')})`, 'success', 5000);
    }, 900);
    return had;
  }, [showCopyToast]);
  const pouFileNameRef = useRef(pouFileName);
  pouFileNameRef.current = pouFileName;
  const handleHeaderSaveRef = useRef(handleHeaderSave);
  handleHeaderSaveRef.current = handleHeaderSave;
  // An editor's "Save to file" (its button, Ctrl+Alt+S in it): its edits put in, then the files written
  useEffect(() => {
    const save = () => handleHeaderSaveRef.current('active');
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.altKey && e.key.toLowerCase() === 's')) return;
      if (!(e.target as HTMLElement | null)?.closest?.('[data-save-scope]')) return;
      e.preventDefault();
      e.stopPropagation();
      save();
    };
    window.addEventListener(SAVE_TO_FILE_EVENT, save);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener(SAVE_TO_FILE_EVENT, save);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('kss-save-all');
    saveAllChannelRef.current = ch;
    ch.onmessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; id?: string } | null;
      if (m?.type !== 'saveAll' || !m.id || answeredSaveAllRef.current.has(m.id)) return;
      answeredSaveAllRef.current.add(m.id);
      const count = handleHeaderSaveRef.current('all', true);
      ch.postMessage({ type: 'saveAllDone', id: m.id, name: pouFileNameRef.current, count });
    };
    return () => {
      ch.close();
      saveAllChannelRef.current = null;
    };
  }, []);
  // XAE: Save All from another tab, relayed by the extension (answered once: it may come on the channel too)
  const answeredSaveAllRef = useRef(new Set<string>());
  useEffect(() => {
    if (!isXaeHost()) return;
    return onHostMessage((m) => {
      if (m.type !== 'saveAll' || !m.id || answeredSaveAllRef.current.has(m.id)) return;
      answeredSaveAllRef.current.add(m.id);
      const count = handleHeaderSaveRef.current('all', true);
      postToHost({ type: 'saveAllDoneRelay', id: m.id, name: pouFileNameRef.current, count });
    });
  }, []);

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
  // Path checks (kept from a live session or a recording, per POU type): their transitions the diagram no longer has
  const [pathChecks, setPathChecksState] = useState<PathCheck[]>([]);
  useEffect(() => setPathChecksState(loadPathChecks(seenPouType)), [seenPouType]);
  const setPathChecks = useCallback(
    (list: PathCheck[]) => {
      setPathChecksState(list);
      savePathChecks(seenPouType, list);
    },
    [seenPouType]
  );
  const pathCheckResults = useMemo(() => runPathChecks(pathChecks, availableEdges), [pathChecks, availableEdges]);
  // Bookmarks (the canvas, Identified States, the Method Editor share them)
  const bookmarks = useBookmarks(pouFileName);
  const handleToggleBookmark = useCallback(
    (state: string) => {
      const on = toggleStateBookmark(pouFileName, state);
      showCopyToast(on ? `Bookmarked ${state}` : `Bookmark removed: ${state}`, 'success');
    },
    [pouFileName, showCopyToast]
  );
  // (a state's branch that calls a method with a state machine of its own: its sub-machine; see setSubMachineExpanded)
  const subMachines = useMemo(() => {
    try {
      return pouContent ? subMachinesOf(pouContent) : [];
    } catch {
      return [];
    }
  }, [pouContent]);
  // A state's tooltip on the canvas: its entry / do / exit actions in full (a few lines each)
  const stateTooltips = useMemo(() => {
    const out: Record<string, string> = {};
    if (!pouContent) return out;
    // The state's whole CASE branch in doState(), as written (its first 60 lines), indentation kept relative
    const MAX = 60;
    const doCode = getMethodCodeFromPou(pouContent, 'doState');
    const doLines = doCode.methodFound ? doCode.code.replace(/\r\n/g, '\n').split('\n') : [];
    const doBlank = blankComments(doLines.join('\n')).split('\n');
    for (const st of identifiedStatesResult.states) {
      // (its lines from the CASE range, the label line left out: to the next label / ELSE / END_CASE)
      const range = doLines.length ? caseBranchRange(doBlank, st.id) : null;
      if (!range) continue;
      const lines = doLines.slice(range.start + 1, range.end);
      while (lines.length && !lines[0].trim()) lines.shift();
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      if (!lines.length) continue;
      const common = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)![0].replace(/\t/g, '    ').length));
      const shown = lines.slice(0, MAX).map((l) => `  ${l.replace(/\t/g, '    ').slice(common)}`);
      if (lines.length > MAX) shown.push(`… ${lines.length - MAX} more lines (Method Editor)`);
      out[st.id] = `${st.id}\n${shown.join('\n')}`;
    }
    // A sub-machine's states (drawn inside the state that calls its method): their branch in that method's CASE
    for (const m of subMachines) {
      const code = getMethodCodeFromPou(pouContent, m.method);
      if (!code.methodFound) continue;
      const mLines = code.code.replace(/\r\n/g, '\n').split('\n');
      const mBlank = blankComments(mLines.join('\n')).split('\n');
      for (const name of m.states) {
        const range = caseBranchRange(mBlank, name);
        if (!range) continue;
        const lines = mLines.slice(range.start + 1, range.end);
        while (lines.length && !lines[0].trim()) lines.shift();
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        if (!lines.length) continue;
        const common = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)![0].replace(/\t/g, '    ').length));
        const shown = lines.slice(0, MAX).map((l) => `  ${l.replace(/\t/g, '    ').slice(common)}`);
        if (lines.length > MAX) shown.push(`… ${lines.length - MAX} more lines (Method Editor)`);
        out[`${m.parent}__${m.method}__${name}`] = `${m.method}() · ${name}\n${shown.join('\n')}`;
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pouContent, dutContent, identifiedStatesResult, subMachines]);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  // The watched variables, kept per POU
  const userWatchRef = useRef<string[]>([]);
  userWatchRef.current = userWatch;
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(`kss.live.watch.${pouFileName.replace(/\.TcPOU$/i, '')}`) || '[]');
      setUserWatch(Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []);
    } catch {
      setUserWatch([]);
    }
  }, [pouFileName]);
  const saveUserWatch = (list: string[]) => {
    try {
      localStorage.setItem(`kss.live.watch.${pouFileName.replace(/\.TcPOU$/i, '')}`, JSON.stringify(list));
    } catch {
      // (not kept)
    }
  };
  const userWatchKey = userWatch.join('|');
  useEffect(() => saveUserWatch(userWatch), [userWatchKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // (read by the canvas's keys, set up further down)
  const bookmarksRef = useRef<string[]>([]);
  const identifiedStatesRef = useRef<string[]>([]);
  bookmarksRef.current = bookmarks.states;
  identifiedStatesRef.current = identifiedStatesResult.states.map((s) => s.id);
  // Keyboard shortcuts (?): every shortcut in one list
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The release notes (the status bar's version)
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const appHost: 'XAE' | 'Desktop' | 'Web' = isXaeHost() ? 'XAE' : desktopLive() ? 'Desktop' : 'Web';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.altKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      setShortcutsOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Several states selected on the canvas (Ctrl+click, Shift+drag)
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  // Several states moved together, snapping on: each of them on the grid (kept per viewer)
  const [groupSnapEach, setGroupSnapEachState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('kss.groupSnapEach') === '1';
    } catch {
      return false;
    }
  });
  const setGroupSnapEach = useCallback((on: boolean) => {
    setGroupSnapEachState(on);
    try {
      localStorage.setItem('kss.groupSnapEach', on ? '1' : '0');
    } catch {
      // per-viewer convenience only
    }
  }, []);
  useEffect(() => setMultiSelected([]), [pouFileName]);
  useEffect(() => {
    if (!multiSelected.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement | null)?.closest?.('input, textarea, [role="dialog"], #diagram-context-menu')) setMultiSelected([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [multiSelected.length]);
  // The command palette (Ctrl+Shift+P), Go to Symbol (Ctrl+T in XAE / the desktop app; Ctrl+Shift+O everywhere)
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && ((e.shiftKey && e.key.toLowerCase() === 'o') || (!e.shiftKey && e.key.toLowerCase() === 't'))) {
        e.preventDefault();
        setSymbolSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Every bookmark of the POU, where it is now (the code of each section: a declaration, the enum, an implementation)
  const listAllBookmarks = () =>
    listBookmarks(pouFileName, (m) => {
      // (the bookmarks of a declaration, of the enum, of an implementation)
      if (m === ENUM_KEY) return dutContent.trim() ? parseDutContent(dutContent).declaration : null;
      if (isDeclarationKey(m)) {
        const base = declarationOf(m);
        if (base === BODY) return getPouBody(pouContent).declaration;
        const c = getMethodCodeFromPou(pouContent, base);
        return c.methodFound ? c.declaration : null;
      }
      return m === BODY ? getPouBody(pouContent).implementation : getMethodCodeFromPou(pouContent, m).methodFound ? getMethodCodeFromPou(pouContent, m).code : null;
    });
  // A bookmark opened where it is (a state: the state and its CASE label; a line: its editor at that line)
  const openBookmark = (e: BookmarkEntry) => {
    if (e.kind === 'state' && e.state) handleJumpToState(e.state);
    if (e.method === ENUM_KEY) {
      // (the enum: its member on that line selected in the Enum Editor)
      const member = /^\s*,?\s*([A-Za-z_]\w*)/.exec(e.text)?.[1];
      handleOpenEnumEditorModal(member);
    } else if (isDeclarationKey(e.method)) {
      const base = declarationOf(e.method);
      if (base === BODY) {
        setDockLayout((l) => activateDockTab(l, 'pou'));
        setPouReveal({ symbol: '', nonce: Date.now(), line: e.line, part: 'declaration' });
      } else {
        handleOpenInspectorPanel('method', { method: `${base}()` });
        setCodeJump({ method: base, line: e.line, nonce: Date.now(), part: 'declaration' });
      }
    } else if (e.method === BODY) {
      setDockLayout((l) => activateDockTab(l, 'pou'));
      setPouReveal({ symbol: '', nonce: Date.now(), line: e.line, part: 'implementation' });
    } else if (e.line > 0) {
      handleOpenInspectorPanel('method', { method: `${e.method}()` });
      setCodeJump({ method: e.method, line: e.line, nonce: Date.now() });
    }
  };
  // Alt+F2 / Shift+Alt+F2: the next / previous bookmark of any section, in the Bookmarks list's order
  const bookmarkStepRef = useRef(-1);
  const stepBookmark = (dir: 1 | -1) => {
    const all = listAllBookmarks();
    if (!all.length) return showCopyToast('No bookmarks yet: right-click a state, or a line of a code editor (Toggle Bookmark)', 'error');
    const i = ((bookmarkStepRef.current + dir) % all.length + all.length) % all.length;
    bookmarkStepRef.current = i;
    const e = all[i];
    openBookmark(e);
    showCopyToast(`Bookmark ${i + 1} of ${all.length}: ${e.note ? `${e.note} (${e.state ?? `line ${e.line}`})` : e.state ?? `line ${e.line}: ${e.text.slice(0, 40)}`}`, 'success', 4000);
  };
  const stepBookmarkRef = useRef(stepBookmark);
  stepBookmarkRef.current = stepBookmark;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2' || !e.altKey || e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      stepBookmarkRef.current(e.shiftKey ? -1 : 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const bookmarkEntries = useMemo(
    () => (bookmarksOpen ? listAllBookmarks() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookmarksOpen, bookmarks, pouContent, pouFileName, dutContent]
  );
  const [projectFiles, setProjectFiles] = useState<{ project?: string; files: ProjectFile[] } | null>(null);
  // A POU opened from the PLC's sources: code help from the rest of them (no project folder)
  const [plcCodeFiles, setPlcCodeFiles] = useState<{ project?: string; files: ProjectFile[] } | null>(null);
  useEffect(() => {
    setProjectFiles(null);
    if (pouPath) setPlcCodeFiles(null);
    if (isXaeHost()) {
      const off = onHostMessage((m) => {
        if (m.type === 'projectSymbols' && m.files) setProjectFiles({ project: m.project, files: m.files });
      });
      postToHost({ type: 'projectSymbols' });
      return off;
    }
    const desktop = (window as unknown as { tcDesktop?: { projectSymbols?: (from: string) => Promise<{ project?: string; files?: ProjectFile[]; error?: string }> } }).tcDesktop;
    if (desktop?.projectSymbols && pouPath) {
      let alive = true;
      void desktop.projectSymbols(pouPath).then((r) => {
        if (alive && r?.files) setProjectFiles({ project: r.project, files: r.files });
      });
      return () => {
        alive = false;
      };
    }
    return undefined;
  }, [pouPath]);
  const [symbolsVersion, setSymbolsVersion] = useState(0);
  useEffect(() => onProjectSymbols(() => setSymbolsVersion((v) => v + 1)), []);
  useEffect(() => {
    const loaded: ProjectFile[] = [
      ...(pouContent ? [{ name: pouFileName || 'POU.TcPOU', content: pouContent }] : []),
      ...(dutContent ? [{ name: dutFileName || 'E_States.TcDUT', content: dutContent }] : []),
    ];
    const files = projectFiles ?? plcCodeFiles;
    setProjectSymbols(buildProjectSymbols(files?.files ?? [], loaded, files?.project), !!files);
  }, [projectFiles, plcCodeFiles, pouContent, dutContent, pouFileName, dutFileName]);
  // Does another file of the project read a member of this POU (instance.name)? Only with the project's files
  const readElsewhere = useMemo(() => {
    const files = (projectFiles ?? plcCodeFiles)?.files;
    if (!files?.length) return undefined;
    const others = files.filter((f) => f.name.toLowerCase() !== (pouFileName || '').toLowerCase()).map((f) => f.content);
    return (name: string) => {
      const rx = new RegExp(`\\.\\s*${name.replace(/[^\w]/g, '')}\\b`, 'i');
      return others.some((c) => rx.test(c));
    };
  }, [projectFiles, plcCodeFiles, pouFileName]);
  const lintFindings = useMemo(
    () => [
      ...lintStateMachine(pouContent, dutContent, availableEdges),
      ...lintVariables(pouContent, getProjectSymbols(), hasProjectSymbols(), identifiedStatesResult.states.map((s) => s.id), readElsewhere),
      ...pathCheckFindings(pathCheckResults),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pouContent, dutContent, availableEdges, pathCheckResults, symbolsVersion, identifiedStatesResult, readElsewhere]
  );
  const stateProblems = useMemo(() => {
    const out: Record<string, { messages: string[]; names: string[] }> = {};
    if (!pouContent) return out;
    const m = getMethodCodeFromPou(pouContent, 'doState');
    const code = m.methodFound ? blankComments(m.code).split(/\r?\n/) : [];
    for (const st of identifiedStatesResult.states) {
      const range = code.length ? caseBranchRange(code, st.id) : null;
      const inBranch = (f: LintFinding) => !!range && f.method === 'doState' && !!f.line && f.line > range.start + 1 && f.line <= range.end;
      const found = lintFindings.filter((f) => f.stateId === st.id || inBranch(f));
      if (found.length) out[st.id] = { messages: found.map((f) => f.message), names: found.map((f) => f.mark?.name ?? '').filter(Boolean) };
    }
    return out;
  }, [pouContent, identifiedStatesResult, lintFindings]);
  const lintFindingsRef = useRef<LintFinding[]>([]);
  lintFindingsRef.current = lintFindings;
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
  // The PLC's version of this POU (and its enum), from the sources it keeps: read when compared with it
  const [plcBaseline, setPlcBaseline] = useState<{ key: string; loading: boolean; pou?: string; dut?: string; error?: string; note?: string } | null>(null);
  const savedBaseline =
    isXaeHost() && pouPath && hostSavedContent[pouPath] !== undefined
      ? { pou: hostSavedContent[pouPath], dut: (dutPath && hostSavedContent[dutPath]) || dutContent }
      : loadedBaseline;
  // Review and save: the version as saved (XAE: saved in XAE) against the edit, side by side
  const [review, setReview] = useState<{ before: { pou: string; dut: string }; after: { pou: string; dut: string }; diff: ReturnType<typeof diffCharts>; label: string; parts?: PartDiff[]; noSave?: boolean } | null>(null);
  const openReview = () => {
    const xae = isXaeHost() && pouPath && hostSavedContent[pouPath] !== undefined;
    const before = xae ? { pou: hostSavedContent[pouPath!], dut: (dutPath && hostSavedContent[dutPath]) || dutContent } : { pou: savedSources.pou, dut: savedSources.dut || dutContent };
    const after = { pou: pouContent, dut: dutContent };
    setReview({ before, after, diff: diffCharts(before, after), label: xae ? 'saved in XAE' : 'last saved' });
  };
  // Compare recordings (Live tab)
  const [compareOpen, setCompareOpen] = useState(false);
  const chartDiff = useMemo(() => {
    if (!changesTabMounted) return null;
    const baseline =
      compareBase === 'git'
        ? gitBaseline?.pou ? { pou: gitBaseline.pou, dut: gitBaseline.dut ?? dutContent } : null
        : compareBase === 'plc'
          ? plcBaseline?.pou ? { pou: plcBaseline.pou, dut: plcBaseline.dut ?? dutContent } : null
          : savedBaseline;
    if (!baseline?.pou || !pouContent) return null;
    return diffCharts(baseline, { pou: pouContent, dut: dutContent });
  }, [changesTabMounted, compareBase, gitBaseline, plcBaseline, savedBaseline.pou, savedBaseline.dut, pouContent, dutContent]);
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
  }, [pouPath, flowchartOutput, collapseErrorSinkEdges, choiceNodes, spellOutElse, includeStateDescriptions, showTransitionPriorities, priorityFormat, showCopyToast]);

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
  const projectIoRef = useRef<{
    fetch: (name: string) => Promise<{ files?: { name: string; path: string; content: string }[]; error?: string }>;
    write: (files: { path: string; content: string; baseline: string }[]) => Promise<string | null>;
    can: () => boolean;
  } | null>(null);
  // After a state is renamed here: its uses in the project's other POUs (E_States.OLD, OLD), renamed too if you agree
  const renameStateElsewhere = async (oldName: string, newName: string) => {
    const io = projectIoRef.current;
    if (!io?.can()) return;
    const res = await io.fetch(oldName);
    if (res.error || !res.files?.length) return;
    const enumNames = (dutContent.match(/\bTYPE\s+(\w+)/gi) ?? []).map((m) => m.split(/\s+/)[1]);
    const others = res.files.map((f) => ({ ...f, ...renameWordInFile(f.content, oldName, newName, enumNames) })).filter((f) => f.changes.length);
    if (!others.length) return;
    setPromptRequest({
      title: `Rename ${oldName} in ${others.length} other POU${others.length === 1 ? '' : 's'} too?`,
      label: `These POUs of the project use ${oldName}. Written at once (each only if it did not change since it was read):`,
      details: others.flatMap((o) => [`${o.name}:`, ...o.changes.slice(0, 10).map((c) => `  ${c.where} ${c.line}: ${c.before} → ${c.after}`), ...(o.changes.length > 10 ? [`  … ${o.changes.length - 10} more`] : [])]),
      confirmOnly: true,
      submitLabel: 'Rename there too',
      onSubmit: async () => {
        const err = await io.write(others.map((o) => ({ path: o.path, content: o.xml, baseline: o.content })));
        showCopyToast(err ? `Not written: ${err}` : `Renamed ${oldName} → ${newName} in ${others.map((o) => o.name).join(', ')}`, err ? 'error' : 'success', 7000);
      },
    });
  };
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
          // (the other POUs: asked after this dialog closed)
          setTimeout(() => void renameStateElsewhere(oldName, newName), 0);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const codeScope = (method?: string) => symbolScope(pouContent, getProjectSymbols(), { method, states: identifiedStatesResult.states.map((st) => st.id) });
  const conditionHelp = (method = 'doState') => ({ scope: codeScope(method), condition: true });
  /** The POU with the variables declared in a condition dialog (null: the error was shown) */
  const withDeclarations = (pou: string, declarations?: NewVariable[]) => {
    if (!declarations?.length) return pou;
    const r = declareVariables(pou, declarations);
    if ('error' in r) {
      showCopyToast(r.error, 'error');
      return null;
    }
    return r.pou;
  };
  const declaredText = (declarations?: NewVariable[]) => (declarations?.length ? `; declared ${declarations.map((d) => `${d.name} : ${d.type}`).join(', ')}` : '');
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
          ...conditionHelp(composite ? 'preProcess' : 'doState'),
          validate: (v) => (v ? null : 'Enter a condition'),
          onSubmit: (condition, declarations) => {
            const r = addExceptionTransition(pouContent, dutContent, composite ? { composite } : { state: from }, to, condition, v);
            if ('error' in r) return showCopyToast(r.error, 'error');
            const pou = withDeclarations(r.pou, declarations);
            if (!pou) return;
            handleReplaceSources(pou, null);
            showCopyToast(`Added the exception transition ${from} → ${to} in ${r.where}${declaredText(declarations)}`, 'success');
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
        ...conditionHelp(),
        validate: (v) => (v ? null : 'Enter a condition (TRUE for always)'),
        onSubmit: (condition, declarations) => {
          const code = addTransition(pouContent, from, to, condition, v);
          if (!code) {
            showCopyToast(`${from} has no CASE branch in doState()`, 'error');
            return;
          }
          if (declarations?.length) {
            const u = updateMethodCodeInPou(pouContent, 'doState', code);
            const pou = u.success ? withDeclarations(u.updatedPou, declarations) : null;
            if (!u.success) showCopyToast(u.error || 'Could not add the transition', 'error');
            if (!pou) return;
            handleReplaceSources(pou, null);
            showCopyToast(`Added the transition ${from} → ${to}${declaredText(declarations)}`, 'success');
            return;
          }
          const result = handleSaveMethodCode('doState', code);
          if (!result?.success) showCopyToast(result?.error || 'Could not add the transition', 'error');
          else showCopyToast(`Added the transition ${from} → ${to}`, 'success');
        },
      });
    },
    [connectFrom, pouContent, dutContent, stateVarName, regionOf, handleSaveMethodCode, handleReplaceSources, showCopyToast, identifiedStatesResult]
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
  // (a choice's arm is drawn from its diamond, choice_<state>_<n>: the transition is its state's)
  const drawnEdge = useCallback((edge: EdgeInfo) => availableEdges.find((e) => e.id === edge.id) ?? edge, [availableEdges]);
  // Each drawn edge's transitions in the code ("from->to" -> [{ from, to }]): an edge drawn from or to a composite's
  // border stands for its states' (the only state in it, or several collapsed into one edge)
  // (all: each of them, a state's several transitions to the same target too, with their priorities: the list in a
  // collapsed edge's guard popup)
  const { unique: edgeMembers, all: edgeMembersAll } = useMemo(() => {
    const m = new Map<string, { from: string; to: string }[]>();
    const all = new Map<string, { from: string; to: string; priority?: number | null }[]>();
    if (!pouContent) return { unique: m, all };
    try {
      for (const e of generateStatechartModel(dutContent, pouContent, { flowchartOutput, collapseErrorSinkEdges, choiceNodes, spellOutElse }).edges) {
        const k = `${e.from}->${e.to}`;
        const each = [...(all.get(k) ?? []), ...e.members.map(({ from, to, priority }) => ({ from, to, priority }))];
        all.set(k, each);
        m.set(k, [...new Map(each.map((x) => [`${x.from}->${x.to}`, { from: x.from, to: x.to }])).values()]);
      }
    } catch {
      // (the chart is drawn without it: edits go by the drawn edge)
    }
    return { unique: m, all };
  }, [dutContent, pouContent, flowchartOutput, collapseErrorSinkEdges, choiceNodes, spellOutElse]);
  // Each state's transitions in and out, one per transition in the code (two to the same state are two): the
  // Identified States list's counts, as the chart draws them
  const stateTransitionCounts = useMemo(() => {
    const counts = new Map<string, { incoming: number; outgoing: number }>();
    const of = (id: string) => {
      let c = counts.get(id);
      if (!c) counts.set(id, (c = { incoming: 0, outgoing: 0 }));
      return c;
    };
    for (const list of edgeMembersAll.values()) {
      for (const t of list) {
        of(t.from).outgoing++;
        of(t.to).incoming++;
      }
    }
    return counts;
  }, [edgeMembersAll]);
  const currentEdge = useCallback(
    (edge: EdgeInfo) => {
      const e = drawnEdge(edge);
      const from = armState(e.from);
      if (from) return { ...e, from, id: `${from}->${e.to}` };
      // (drawn from or to a composite's border for one transition in the code: that transition, its own states)
      const members = edgeMembers.get(`${e.from}->${e.to}`) ?? [];
      if (members.length === 1 && (members[0].from !== e.from || members[0].to !== e.to)) return { ...e, from: members[0].from, to: members[0].to, id: `${members[0].from}->${members[0].to}` };
      return e;
    },
    [drawnEdge, edgeMembers]
  );
  // A sub-machine's transition (drawn inside the state that calls its method): its states' names in that method, its
  // CASE's variable (null: a transition of doState() / preProcess())
  const subEdgeOf = useCallback(
    (e: { from: string; to: string; label?: string; priority?: number }) => {
      const st = subMachineId(pouContent, e.to);
      const sf = subMachineId(pouContent, e.from);
      if (!st || !sf) return null;
      const variable = caseVariable(methodLines(pouContent, st.method) ?? []);
      return variable ? { ref: { from: sf.name, to: st.name, label: e.label, priority: e.priority }, variable, method: st.method } : null;
    },
    [pouContent]
  );
  const handleTransitionPriority = useCallback(
    (edge: EdgeInfo, priority: number) => {
      const e = currentEdge(edge);
      const sub = subEdgeOf(e);
      return pouContent && applyTransitionEdit(sub ? setTransitionPriority(pouContent, sub.ref, priority, sub.variable, sub.method) : setTransitionPriority(pouContent, e, priority, varFor(e.from)));
    },
    [pouContent, applyTransitionEdit, currentEdge, stateVarName, subEdgeOf]
  );
  const handleTransitionPriorityStep = useCallback(
    (edge: EdgeInfo, delta: number) => {
      if (!pouContent) return;
      const e = currentEdge(edge);
      const sub = subEdgeOf(e);
      const order = sub ? transitionOrder(pouContent, sub.ref, sub.variable, sub.method) : transitionOrder(pouContent, e, varFor(e.from));
      if ('error' in order) showCopyToast(order.error, 'error', 6000);
      else if (order.count < 2) showCopyToast(`${e.from} has only this transition`, 'error');
      else handleTransitionPriority(edge, order.priority + delta);
    },
    [pouContent, currentEdge, stateVarName, handleTransitionPriority, showCopyToast, subEdgeOf]
  );
  const knownStates = useMemo(() => new Set(identifiedStatesResult.states.map((st) => st.id)), [identifiedStatesResult]);
  // Move start to… / Move end to… (the transition's menu): a list of the states instead of dragging its end
  const [endPicker, setEndPicker] = useState<{ edge: EdgeInfo; end: 'start' | 'end' } | null>(null);
  const handleEdgeEndpointDrop = useCallback(
    (edge: EdgeInfo, end: 'start' | 'end', stateId: string) => {
      if (!pouContent) return;
      // A sub-machine's transition (drawn inside the state that calls its method): moved among its own states, in its
      // method (its CASE's variable, its states' own names); one between it and the rest of the chart is refused
      const sub = subMachineId(pouContent, edge.to) ?? subMachineId(pouContent, edge.from) ?? subMachineId(pouContent, stateId);
      if (sub) {
        const e0 = currentEdge(edge);
        const sf = subMachineId(pouContent, e0.from);
        const st = subMachineId(pouContent, e0.to);
        const sd = subMachineId(pouContent, stateId);
        if (!st || !sd || sd.method !== st.method || sd.parent !== st.parent) {
          showCopyToast(`${sub.method}()'s transitions stay among its own states: drop it on one of them`, 'error', 6000);
          return;
        }
        const variable = caseVariable(methodLines(pouContent, st.method) ?? []);
        if (!variable) return showCopyToast(`${st.method}() has no CASE`, 'error');
        const ref = { from: sf?.name ?? '[*]', to: st.name, label: drawnEdge(edge).label ?? edge.label };
        applyTransitionEdit(end === 'end' ? retargetTransition(pouContent, ref, sd.name, variable, st.method) : moveTransitionStart(pouContent, ref, sd.name, variable, st.method));
        return;
      }
      if (!knownStates.has(stateId)) {
        showCopyToast(`${stateId} is not a state of the enum / doState() (a composite state?)`, 'error');
        return;
      }
      // (an arm starts at its IF: its end moves, its start is the IF's state)
      if (end === 'start' && armState(drawnEdge(edge).from)) {
        showCopyToast(`An arm of ${armState(drawnEdge(edge).from)}'s IF starts at the IF: drag its end to another state`, 'error');
        return;
      }
      const e = currentEdge(edge);
      // (one edge for several transitions, from a composite's border: which one is not known)
      const members = edgeMembers.get(`${e.from}->${e.to}`) ?? [];
      if (!knownStates.has(e.from) && members.length > 1) {
        showCopyToast(`This edge stands for ${members.length} transitions (from ${members.map((x) => x.from).join(', ')}): drag each from its own state (with Collapse error-sink edges off they are drawn apart)`, 'error', 8000);
        return;
      }
      if ((regionOfRef.current.get(e.from)?.variable ?? null) !== (regionOfRef.current.get(stateId)?.variable ?? null)) {
        showCopyToast(`${stateId} is ${regionOfRef.current.has(stateId) ? 'in another parallel region' : 'outside the parallel region'}`, 'error');
        return;
      }
      applyTransitionEdit(end === 'end' ? retargetTransition(pouContent, e, stateId, varFor(e.from)) : moveTransitionStart(pouContent, e, stateId, varFor(e.from)));
      const taken = seen[seenKey(e.from, e.to)];
      if (taken) showCopyToast(`⚠ The PLC took ${e.from} → ${e.to} ${seenText(taken)}: the running machine uses it (Undo: Ctrl+Z)`, 'error', 8000);
    },
    [pouContent, knownStates, currentEdge, drawnEdge, edgeMembers, applyTransitionEdit, stateVarName, showCopyToast, seen]
  );
  const edgeMembersOf = useCallback((from: string, to: string) => edgeMembersAll.get(`${from}->${to}`) ?? [], [edgeMembersAll]);
  // A transition of the code (one of a collapsed edge's, from its guard popup): its IF in the Method editor
  const handleOpenTransitionCode = useCallback(
    (from: string, to: string, label?: string) => {
      const loc = locateTransition(pouContent, { from, to, label });
      if (!loc) {
        showCopyToast(`The code of ${from} → ${to} was not found`, 'error');
        return;
      }
      handleOpenInspectorPanel('method', { method: `${loc.method}()` });
      setCodeJump({ method: loc.method, line: loc.line, nonce: Date.now() });
    },
    [pouContent, showCopyToast, handleOpenInspectorPanel]
  );
  // Go to code for a state (Identified States' card menu): its CASE label, in doState() or its sub-machine's method
  const handleGoToStateCode = useCallback(
    (id: string) => {
      const loc = locateState(pouContent, id);
      if (!loc) {
        showCopyToast(`${id.split('__').pop()} has no CASE branch${subMachineId(pouContent, id) ? ` in ${subMachineId(pouContent, id)!.method}()` : ' in doState()'}`, 'error');
        return;
      }
      handleOpenInspectorPanel('method', { method: `${loc.method}()` });
      setCodeJump({ method: loc.method, line: loc.line, nonce: Date.now() });
    },
    [pouContent, showCopyToast, handleOpenInspectorPanel]
  );
  // Go to code (an edge's menu, its guard popup): its condition in doState() or preProcess(), in the Method Editor; an
  // edge from a composite's border: its transition's (the first of several: the others in its guard popup)
  const handleGoToEdgeCode = useCallback(
    (edge: EdgeInfo) => {
      const real = currentEdge(edge);
      const members = edgeMembersAll.get(`${real.from}->${real.to}`) ?? [];
      const one = real.from !== 'AnyState' && !knownStates.has(real.from) && members.length ? members[0] : real;
      handleOpenTransitionCode(one.from, one.to, drawnEdge(edge).label ?? edge.label);
      if (one !== real && members.length > 1) showCopyToast(`This edge stands for ${members.length} transitions: ${one.from} → ${one.to}'s code (the others: in its guard popup)`, 'success', 6000);
    },
    [currentEdge, drawnEdge, edgeMembersAll, knownStates, handleOpenTransitionCode, showCopyToast]
  );
  // Copy / paste a state: a new state with a copy of its code (enum member, branches), then Rename… opens for it
  // The state(s) copied (Ctrl+C: the selected one, or the several selected ones)
  const copiedStateRef = useRef<string[] | null>(null);
  const [pendingRename, setPendingRename] = useState<string | null>(null);
  const handleCopyState = useCallback(
    (id: string | string[]) => {
      const ids = Array.isArray(id) ? id : [id];
      copiedStateRef.current = ids;
      showCopyToast(ids.length > 1 ? `Copied ${ids.length} states: Ctrl+V (or right-click the canvas) pastes new states with their code, the transitions between them going to the copies` : `Copied ${ids[0]}: Ctrl+V (or right-click the canvas) pastes a new state with its code`, 'success');
    },
    [showCopyToast]
  );
  const handlePasteState = useCallback(() => {
    const list = copiedStateRef.current;
    if (!list?.length || !pouContent) return;
    // Several: a copy of each, selected together (no names asked: rename them as you like)
    if (list.length > 1) {
      const gone = list.filter((s) => !knownStates.has(s));
      if (gone.length) {
        showCopyToast(`No longer states: ${gone.join(', ')}`, 'error');
        return;
      }
      const names: string[] = [];
      let pouAcc = pouContent;
      let dutAcc = dutContent;
      for (const s of list) {
        const n = copyName(pouAcc, dutAcc, s, names);
        names.push(n);
      }
      const r = copyStates(pouContent, dutContent, list, names, stateVarName);
      if ('error' in r) {
        showCopyToast(r.error, 'error', 6000);
        return;
      }
      pouAcc = r.pou;
      dutAcc = r.dut ?? dutContent;
      handleReplaceSources(pouAcc, r.dut);
      setCustomNodeStyles((m) => {
        const next = { ...m };
        list.forEach((s, i) => {
          if (m[s]) next[names[i]] = m[s];
        });
        return next;
      });
      setMultiSelected(names);
      showCopyToast(`Pasted ${names.join(', ')}: ${r.dut ? 'the enum, ' : ''}${r.methods.map((m) => `${m}()`).join(', ')}. The transitions between them go to the copies`, 'success', 7000);
      return;
    }
    const from = list[0];
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

  // A state that goes (Ctrl+Z of a paste, a delete, code that no longer has it): its style and place on the canvas set
  // aside; back again (Ctrl+Y, Ctrl+Z of the delete): given back. Another file: nothing kept
  const stashRef = useRef<{ file: string; styles: CustomNodeStylesMap; offsets: NodeOffsetsMap }>({ file: '', styles: {}, offsets: {} });
  const prevStatesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const file = `${pouPath ?? ''}|${pouFileName}`;
    const stash = stashRef.current;
    const prev = prevStatesRef.current;
    prevStatesRef.current = knownStates;
    if (stash.file !== file) {
      stashRef.current = { file, styles: {}, offsets: {} };
      return;
    }
    // (no states at all: the code being loaded or broken for a moment, not states that went)
    if (!knownStates.size || !prev.size) return;
    const gone = [...prev].filter((s) => !knownStates.has(s));
    const back = [...knownStates].filter((s) => !prev.has(s) && (s in stash.styles || s in stash.offsets));
    if (!gone.length && !back.length) return;
    // (what comes back taken from the stash first: an updater may run twice, and must give the same result)
    const styles = Object.fromEntries(back.filter((s) => stash.styles[s]).map((s) => [s, stash.styles[s]]));
    const offsets = Object.fromEntries(back.filter((s) => stash.offsets[s]).map((s) => [s, stash.offsets[s]]));
    for (const s of back) {
      delete stash.styles[s];
      delete stash.offsets[s];
    }
    setCustomNodeStyles((m) => {
      const next = { ...m };
      for (const s of gone) if (next[s]) { stash.styles[s] = next[s]; delete next[s]; }
      for (const [s, v] of Object.entries(styles)) if (!next[s]) next[s] = v;
      return next;
    });
    setNodeOffsets((m) => {
      const next = { ...m };
      for (const s of gone) if (next[s]) { stash.offsets[s] = next[s]; delete next[s]; }
      for (const [s, v] of Object.entries(offsets)) if (!next[s]) next[s] = v;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownStates]);

  const dropStateKeys = useCallback((id: string) => {
    const drop = <T,>(m: Record<string, T> | undefined) => {
      if (!m || !(id in m)) return m;
      const next = { ...m };
      delete next[id];
      return next;
    };
    // (its style and place set aside: Ctrl+Z of the delete gives them back)
    setCustomNodeStyles((m) => {
      if (m[id]) stashRef.current.styles[id] = m[id];
      return drop(m) ?? m;
    });
    setNodeOffsets((m) => {
      if (m[id]) stashRef.current.offsets[id] = m[id];
      return drop(m) ?? m;
    });
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
          // (the other states stay where they are on the canvas: Ctrl+Z puts it back where it was)
          setKeepCanvasPositions((v) => v + 1);
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
        onSubmit: () => {
          // (the states stay where they are on the canvas)
          setKeepCanvasPositions((v) => v + 1);
          applyTransitionEdit(r);
        },
      });
    },
    [pouContent, currentEdge, stateVarName, applyTransitionEdit, showCopyToast, seen]
  );

  // A transition's condition changed: from its menu, F2, or the Transition Guard window; the dialog by its label
  const edgeAnchor = (edge: EdgeInfo) => {
    // Its label (the diagram's, not the minimap's), else the middle of its line
    const key = `${edge.from}->${edge.to}`;
    const label = [...document.querySelectorAll<SVGGElement>('#mermaid-diagram-svg-container g.edgeLabel')].find((l) => l.getAttribute('data-linked-path-id') === key || l.getAttribute('data-edge-id') === key);
    const lr = label?.getBoundingClientRect();
    if (lr && lr.width > 4 && lr.height > 4) return { x: lr.x + lr.width / 2, y: lr.y + lr.height / 2, width: lr.width, height: lr.height, onLabel: true };
    const path = [...document.querySelectorAll<SVGPathElement>('#mermaid-canvas-area path.tc-edge-path')].find((p) => p.getAttribute('data-edge-key') === `${edge.from}->${edge.to}`);
    if (!path) return undefined;
    try {
      const q = path.getPointAtLength(path.getTotalLength() / 2);
      const m = path.getScreenCTM();
      if (!m) return undefined;
      return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f };
    } catch {
      return undefined;
    }
  };
  const handleEditCondition = useCallback(
    (edge: EdgeInfo) => {
      if (!pouContent) return;
      // (a sub-machine's transition: its condition in its method, on its own variable)
      const sub = subEdgeOf(currentEdge(edge));
      const e = sub ? { ...currentEdge(edge), ...sub.ref } : currentEdge(edge);
      const sv = sub ? sub.variable : varFor(e.from);
      const c = transitionCondition(pouContent, e, sv, sub?.method);
      if ('error' in c) {
        showCopyToast(c.error, 'error', 6000);
        return;
      }
      // (on the label as drawn: an arm's is on its line from the diamond)
      const anchor = edgeAnchor(drawnEdge(edge));
      setPromptRequest({
        title: `Condition of ${e.from} → ${e.to}`,
        label: c.condition
          ? `Condition (Structured Text), in ${c.method}() line ${c.line}:`
          : `${e.from} → ${e.to} has no condition (it is taken whenever the code gets there). A condition puts it in an IF:`,
        initial: c.condition || 'TRUE',
        monospace: true,
        anchor,
        // (on its label: edited in place; without a condition, the dialog says what happens)
        inline: !!c.condition && !!anchor && 'onLabel' in anchor,
        submitLabel: 'Change condition',
        ...conditionHelp(c.method),
        validate: (v) => (v ? null : 'Enter a condition (TRUE for always)'),
        onSubmit: (condition, declarations) => {
          if (condition === c.condition && !declarations?.length) return;
          const r = setTransitionCondition(pouContent, e, condition, sv, sub?.method);
          if ('error' in r) return showCopyToast(r.error, 'error', 6000);
          const u = updateMethodCodeInPou(pouContent, r.method, r.code);
          if (!u.success) return showCopyToast(u.error || 'Could not change the condition', 'error');
          const pou = withDeclarations(u.updatedPou, declarations);
          if (!pou) return;
          handleReplaceSources(pou, null);
          showCopyToast(`${r.message}${declaredText(declarations)}`, 'success');
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pouContent, currentEdge, stateVarName, showCopyToast, handleReplaceSources, identifiedStatesResult, subEdgeOf]
  );
  // A state's whole code (its CASE branch), as written
  const handleEditStateCode = useCallback(
    (state: string) => {
      if (!pouContent) return;
      const whole = readStateCode(pouContent, state);
      if (!Array.isArray(whole)) return showCopyToast(whole.error, 'error', 6000);
      setPromptRequest({
        title: `Code of ${state}`,
        label: `${state}'s code in doState() (its CASE branch), as written: its actions, its transitions, all of it.`,
        initial: whole.join('\n'),
        monospace: true,
        multiline: true,
        submitLabel: 'Set code',
        scope: codeScope('doState'),
        hint: 'Structured Text statements',
        // What changes (before Set code)
        preview: (v) => {
          const d = lineDiff(whole, v.replace(/\r\n/g, '\n').split('\n'));
          if (!d.added && !d.removed) return [];
          return [`${d.added} line${d.added === 1 ? '' : 's'} in, ${d.removed} out:`, ...d.rows.slice(0, 60), ...(d.rows.length > 60 ? [`… ${d.rows.length - 60} more`] : [])];
        },
        altAction: {
          id: 'text-prompt-open-method-btn',
          label: 'Open in Method Editor',
          title: `doState() at ${state}'s CASE label (what is typed here is not kept)`,
          run: () => {
            const m = getMethodCodeFromPou(pouContent, 'doState');
            const range = m.methodFound ? caseBranchRange(blankComments(m.code).split(/\r?\n/), state) : null;
            handleOpenInspectorPanel('method', { method: 'doState' });
            if (range) setCodeJump({ method: 'doState', line: range.start + 1, nonce: Date.now() });
          },
        },
        onSubmit: (code, declarations) => {
          const r = writeStateCode(pouContent, state, code);
          if ('error' in r) return showCopyToast(r.error, 'error', 6000);
          const pou = withDeclarations(r.pou, declarations);
          if (!pou) return;
          handleReplaceSources(pou, null);
          showCopyToast(`${r.message}${declaredText(declarations)}`, 'success');
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pouContent, showCopyToast, handleReplaceSources]
  );

  const handleEditStateCodeRef = useRef(handleEditStateCode);
  handleEditStateCodeRef.current = handleEditStateCode;

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
  const compositeOwnColors = useMemo(() => (dutContent ? compositeColorsOf(dutContent) : {}), [dutContent]);
  // A composite's colour set (null: the Composites setting's) in a comment on its {region} line
  const handleCompositeColor = useCallback(
    (name: string, color: string | null) => {
      const next = setCompositeColor(dutContent, name, color);
      if (!next) return showCopyToast(`${name} has no {region} in the enum`, 'error');
      if (next !== dutContent) handleReplaceSources(null, next);
      showCopyToast(color ? `${name}: ${color} (// @color on its {region} line)` : `${name}: the Composites colour`, 'success');
    },
    [dutContent, handleReplaceSources, showCopyToast]
  );
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
    (name: string, opts: { composite?: string | null; final?: boolean; at?: { x: number; y: number } | null; newComposite?: string; from?: { state: string; condition: string; declarations?: NewVariable[] } }) => {
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
        const declared = withDeclarations(pou, opts.from.declarations);
        if (!declared) return;
        pou = declared;
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
      // (in a composite too: dropped in its box, kept there, the box grown to hold it as for a state dragged in; a
      // new composite around it: where the layout puts the two)
      if (opts.at && !opts.newComposite) setPlaceRequest({ stateId: name, x: opts.at.x, y: opts.at.y, nonce: Date.now() });
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
                ...conditionHelp(),
                validate: (v) => (v ? null : 'Enter a condition (TRUE for always)'),
                onSubmit: (condition, declarations) => createState(name, { composite, from: { state: from, condition, declarations } }),
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
          moveStatesTo([state], target || null);
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dutContent, composites, compositeNames, handleReplaceSources, dropNodeOffset, showCopyToast]
  );
  // States moved into a composite, or out of theirs (target null): their enum lines moved, kept whole (comments,
  // values, @initial / @final). Dragged there (dropped: true): they stay where they were dropped, the composite's box
  // grown to hold them; else (a menu) the layout places them in it
  const moveStatesTo = (states: string[], target: string | null, dropped = false) => {
    const r = moveToComposite(dutContent, states, target);
    if ('error' in r) return showCopyToast(`Could not move ${states.join(', ')} in the enum: ${r.error}`, 'error', 6000);
    if (r.dut === dutContent) return;
    if (dropped) setKeepCanvasPositions((v) => v + 1);
    handleReplaceSources(null, r.dut);
    if (!dropped) states.forEach(dropNodeOffset);
    const who = states.length > 1 ? `${states.length} states are` : `${states[0]} is`;
    showCopyToast(`${target ? `${who} in ${target}` : `${who} in no composite`} (the enum's {region} markers; Ctrl+Z undoes)${r.reordered ? '. Members without a value of their own get new numbers' : ''}`, 'success', 6000);
  };
  // Composites come only from the enum's {region} markers: the ones the chart used to find on its own (the state
  // names, TwinCAT's UML chart) and the enum does not mark yet, offered to be written (the canvas' menu)
  const pendingComposites = useMemo(() => {
    if (!pouContent || !dutContent.trim()) return [] as string[];
    try {
      const have = new Set(composites.map((c) => c.name.toLowerCase()));
      return inferredComposites(dutContent, pouContent).map((c) => c.name).filter((n) => !have.has(n.toLowerCase()));
    } catch {
      return [] as string[];
    }
  }, [pouContent, dutContent, composites]);
  // A composite collapsed (one box) or expanded again: kept per POU in this browser
  const storeCollapsed = useCallback(
    (name: string, on: boolean) =>
      setCollapsedComposites((cur) => {
        const next = on ? [...new Set([...cur, name])] : cur.filter((x) => x !== name);
        try {
          const key = `kss.collapsed.${(pouFileName || 'POU').replace(/\.TcPOU$/i, '')}`;
          if (next.length) localStorage.setItem(key, JSON.stringify(next));
          else localStorage.removeItem(key);
        } catch {
          // (this session only)
        }
        return next;
      }),
    [pouFileName]
  );
  const setCollapsed = useCallback(
    (name: string, on: boolean) => {
      storeCollapsed(name, on);
      showCopyToast(on ? `${name} collapsed: one box (right-click it: Expand)` : `${name} expanded`, 'success');
    },
    [storeCollapsed, showCopyToast]
  );
  // Sub-machines (a state's branch calls a method with a state machine of its own): drawn inside it unless collapsed
  // ("-<state>" kept with the collapsed composites: per POU, in the layout file too)
  const setSubMachineExpanded = useCallback(
    (parent: string, method: string, on: boolean) => {
      storeCollapsed(`-${parent}`, !on);
      showCopyToast(on ? `${parent}: its sub-machine ${method} shown inside it (right-click its title: Collapse)` : `${parent}: its sub-machine ${method} collapsed`, 'success');
    },
    [storeCollapsed, showCopyToast]
  );
  // Identified States: each sub-machine's states inside its state's card, shown while the canvas shows them
  const identifiedSubMachines = useMemo(
    () => subMachines.map((m) => ({ parent: m.parent, method: m.method, states: m.states, start: m.start, transitions: m.transitions, expanded: !collapsedComposites.includes(`-${m.parent}`) })),
    [subMachines, collapsedComposites]
  );
  // A composite dragged into another one (its {region} block nested there), or out of the one it is in
  const handleCompositeDropped = useCallback(
    (name: string, into: string | null) => {
      if (!dutContent.trim()) return;
      const all = enumComposites(dutContent);
      const me = all.find((c) => c.name === name || c.name.replace(/[.\-\s]/g, '_') === name);
      if (!me) return;
      const target = into ? all.find((c) => c.name === into || c.name.replace(/[.\-\s]/g, '_') === into)?.name ?? null : null;
      if ((target ?? null) === (me.parent ?? null)) return;
      // (out: only when it was released outside the one it is in)
      const next = nestComposite(dutContent, me.name, target);
      if (!next) return;
      handleReplaceSources(null, next);
      showCopyToast(target ? `${me.name} now in ${target} (its {region} in it: Ctrl+Z undoes)` : `${me.name} moved out of ${me.parent} (Ctrl+Z undoes)`, 'success', 6000);
    },
    [dutContent, handleReplaceSources, showCopyToast]
  );
  const handleWriteCompositeMarkers = useCallback(() => {
    const r = writeCompositeMarkers(dutContent, pouContent);
    if (!r.written.length) return showCopyToast(r.errors.length ? `No composite written: ${r.errors.join('; ')}` : 'No composite to write', 'error', 7000);
    handleReplaceSources(null, r.dut);
    showCopyToast(`Written as {region} markers in the enum: ${r.written.join(', ')}${r.errors.length ? `. Not: ${r.errors.join('; ')}` : ''}${r.reordered ? '. Enum lines were moved together: members without a value of their own get new numbers' : ''} (Ctrl+Z undoes)`, 'success', 8000);
  }, [dutContent, pouContent, handleReplaceSources, showCopyToast]);
  // (said once for each POU that has some)
  const compositesHintRef = useRef('');
  useEffect(() => {
    if (!pendingComposites.length || !pouFileName || compositesHintRef.current === pouFileName || composites.length) return;
    compositesHintRef.current = pouFileName;
    showCopyToast(`Composites come only from {region} markers in the enum now: right-click the canvas, "Write these composites as markers" (${pendingComposites.join(', ')})`, 'success', 9000);
  }, [pendingComposites, pouFileName, composites.length, showCopyToast]);
  // Shift + a box around states: selected, and offered as a new composite ({region} markers around them in the enum)
  const handleBoxSelected = useCallback(
    (ids: string[]) => {
      const states = ids.filter((s) => knownStates.has(s) && !regionOf.has(s));
      if (!states.length || !pouContent || !dutContent.trim()) return;
      const parents = [...new Set(states.map((s) => compositeOf(dutContent, s)))];
      const inComposite = parents.length === 1 ? parents[0] : null;
      setPromptRequest({
        title: `Group ${states.length === 1 ? states[0] : `${states.length} states`} into a composite`,
        label: parents.length > 1
          ? `These states are in different composites (${parents.map((p) => p ?? 'none').join(', ')}): only the states of one composite can be grouped. Just select them, or box the states of one composite.`
          : `Its name (a {region "…"} around them in the enum${inComposite ? `, inside ${inComposite}` : ''}). Its first state in the enum is its initial state (right-click a state: Initial state of …). ${states.join(', ')}`,
        initial: 'NewComposite',
        monospace: true,
        submitLabel: 'Group',
        cancelLabel: 'Just select them',
        validate: (v) =>
          parents.length > 1 ? 'Box the states of one composite' : !isValidCompositeName(v) ? 'Letters, digits, _ and spaces' : compositeNames.has(v) ? `${v} already exists` : knownStates.has(v) ? `${v} is a state` : null,
        onSubmit: (name) => {
          const r = groupInComposite(dutContent, states, name);
          if ('error' in r) return showCopyToast(`Could not group them: ${r.error}`, 'error', 6000);
          handleReplaceSources(null, r.dut);
          states.forEach(dropNodeOffset);
          setMultiSelected([]);
          showCopyToast(`${name}: ${states.length} state${states.length === 1 ? '' : 's'} in it ({region} markers in the enum; Ctrl+Z undoes)${r.reordered ? '. Their enum lines were moved together: members without a value of their own get new numbers' : ''}`, 'success', 7000);
        },
      });
    },
    [knownStates, regionOf, pouContent, dutContent, compositeNames, handleReplaceSources, dropNodeOffset, showCopyToast]
  );
  // Extract to sub-machine (the selection's menu): the states moved into a method of their own, called from a new state
  const handleExtractSubMachine = useCallback(
    (ids: string[]) => {
      const states = ids.filter((x) => knownStates.has(x) && !regionOf.has(x) && !x.includes('__'));
      if (states.length < 2 || !pouContent || !dutContent.trim()) return;
      const sv = identifiedStatesResult.stateVarName || stateVarName;
      setPromptRequest({
        title: `Extract ${states.length} states to a sub-machine`,
        label: `The method's name. ${states.join(', ')} become its states (its own CASE, an INT with a constant each), run while a new state, ${defaultSubMachineState(states, 'Name')}, is current; a transition leaving them is its exit, that state's transition. Ctrl+Z undoes.`,
        initial: 'Sequence',
        monospace: true,
        submitLabel: 'Extract',
        validate: (v) => checkExtractSubMachine(pouContent, dutContent, states, v, defaultSubMachineState(states, v), sv),
        onSubmit: (method) => {
          const r = extractSubMachine(pouContent, dutContent, states, method, sv);
          if ('error' in r) return showCopyToast(`Could not extract them: ${r.error}`, 'error', 7000);
          handleReplaceSources(r.pou, r.dut);
          states.forEach(dropNodeOffset);
          setMultiSelected([]);
          const p = r.plan;
          showCopyToast(
            `${p.state}: ${states.length} states in ${p.method}(), starting in ${p.entry}${p.exits.length ? `; its exits: ${p.exits.map((e) => e.to).join(', ')}` : ''}${p.enteredAt.length ? `; the transitions into ${p.enteredAt.join(', ')} now enter at ${p.entry}` : ''} (Ctrl+Z undoes)`,
            'success',
            9000
          );
        },
      });
    },
    [knownStates, regionOf, pouContent, dutContent, identifiedStatesResult.stateVarName, stateVarName, handleReplaceSources, dropNodeOffset, showCopyToast]
  );
  // A state's node released over another {region} composite (or out of its own): it moves there
  const handleStateDropped = useCallback(
    // (Alt no longer needed: a state dropped in a composite's box is in it, dropped outside its box it is out of it)
    (state: string, clusters: string[], _altKey: boolean) => {
      if (!dutContent.trim() || !knownStates.has(state) || regionOf.has(state)) return;
      const current = compositeOf(dutContent, state);
      const target = clusters.find((c) => compositeNames.has(c)) ?? null;
      if (target === current) return;
      // (dropped with the states selected with it: those of them in the same composite as it move too)
      const with_ = multiSelected.includes(state) ? multiSelected.filter((s) => knownStates.has(s) && !regionOf.has(s) && compositeOf(dutContent, s) === current) : [state];
      // (out of an inner composite into the one around it: into that one)
      moveStatesTo(with_.length ? with_ : [state], target, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dutContent, knownStates, regionOf, compositeNames, handleReplaceSources, dropNodeOffset, showCopyToast, multiSelected]
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
  // step), and the states' places on the canvas before each move (a drag, Align / Distribute, arrow keys, a reset),
  // in the order they were made; another file starts a new history
  type Snapshot = { pou: string; dut: string };
  const historyRef = useRef<{
    past: Snapshot[];
    future: Snapshot[];
    last: Snapshot | null;
    lastAt: number;
    applying: boolean;
    file: string;
    layoutPast: NodeOffsetsMap[];
    layoutFuture: NodeOffsetsMap[];
    layoutAt: number;
    /** The transitions' routes before a change of the user's (by transition: a handle dragged, Re-layout edge) */
    edgesPast: EdgeOffsetsMap[];
    edgesFuture: EdgeOffsetsMap[];
    orderPast: ('code' | 'layout' | 'edges')[];
    orderFuture: ('code' | 'layout' | 'edges')[];
  }>({
    past: [],
    future: [],
    last: null,
    lastAt: 0,
    applying: false,
    file: '',
    layoutPast: [],
    layoutFuture: [],
    layoutAt: 0,
    edgesPast: [],
    edgesFuture: [],
    orderPast: [],
    orderFuture: [],
  });
  // (the transitions' routes now, and how they are put back: the layout block's, below)
  const edgeUndoRef = useRef<{ get: () => EdgeOffsetsMap; restore: (edges: EdgeOffsetsMap) => void } | null>(null);
  const nodeOffsetsRef = useRef(nodeOffsets);
  nodeOffsetsRef.current = nodeOffsets;
  // The canvas moved states: where they were is kept for Undo (a held arrow key is one step)
  // (the canvas' own placing told to the layout file: not a change of the user's)
  const autoNodeOffsetsRef = useRef<(o: NodeOffsetsMap) => void>(() => {});
  const handleCanvasNodeOffsets = useCallback((next: NodeOffsetsMap, opts?: { auto?: boolean }) => {
    // (the canvas' own placing: the locked layout's, a drop's states kept: part of the edit, no undo step)
    if (opts?.auto) {
      autoNodeOffsetsRef.current(next);
      setNodeOffsets(next);
      return;
    }
    const h = historyRef.current;
    const now = Date.now();
    if (now - h.layoutAt > 300 || h.orderPast[h.orderPast.length - 1] !== 'layout') {
      h.layoutPast.push(nodeOffsetsRef.current);
      h.orderPast.push('layout');
      if (h.layoutPast.length > 100) h.layoutPast.shift();
    }
    h.layoutAt = now;
    h.future = [];
    h.layoutFuture = [];
    h.edgesFuture = [];
    h.orderFuture = [];
    setNodeOffsets(next);
    setHistoryVersion((v) => v + 1);
  }, []);
  const [historyVersion, setHistoryVersion] = useState(0);
  // The transitions of several states laid out again (a selection's, a composite's): said how many
  const relayoutTransitionsOf = (states: string[], what: string) => {
    const r = mermaidViewerRef.current?.relayoutTransitions(states) ?? { done: 0, failed: [] };
    if (!r.done && !r.failed.length) return showCopyToast(`${what}: no transition to lay out again (each as straight as it can be)`, 'success');
    showCopyToast(
      r.done ? `${what}: ${r.done} transition${r.done === 1 ? '' : 's'} laid out again${r.failed.length ? ` (no way for ${r.failed.length})` : ''}` : `${what}: no way for ${r.failed.length} transition${r.failed.length === 1 ? '' : 's'}`,
      r.done ? 'success' : 'error'
    );
  };
  const pushEdgeStep = useCallback((before: EdgeOffsetsMap) => {
    const h = historyRef.current;
    h.edgesPast.push(before);
    if (h.edgesPast.length > 100) h.edgesPast.shift();
    h.orderPast.push('edges');
    h.future = [];
    h.layoutFuture = [];
    h.edgesFuture = [];
    h.orderFuture = [];
    setHistoryVersion((v) => v + 1);
  }, []);
  // An undo / redo of a code change: the canvas keeps its states where they are (counted)
  const [keepCanvasPositions, setKeepCanvasPositions] = useState(0);
  useEffect(() => {
    const h = historyRef.current;
    const snap = { pou: pouContent, dut: dutContent };
    const file = `${pouPath ?? ''}|${pouFileName}`;
    if (h.file !== file || !h.last) {
      h.file = file;
      h.past = [];
      h.future = [];
      h.layoutPast = [];
      h.layoutFuture = [];
      h.edgesPast = [];
      h.edgesFuture = [];
      h.orderPast = [];
      h.orderFuture = [];
      h.last = snap;
      h.applying = false;
      setHistoryVersion((v) => v + 1);
      return;
    }
    if (h.last.pou === snap.pou && h.last.dut === snap.dut) return;
    if (h.applying) h.applying = false;
    else {
      const now = Date.now();
      if (now - h.lastAt > 1000 || h.past.length === 0 || h.orderPast[h.orderPast.length - 1] !== 'code') {
        h.past.push(h.last);
        h.orderPast.push('code');
      }
      if (h.past.length > 100) h.past.shift();
      h.future = [];
      h.layoutFuture = [];
      h.edgesFuture = [];
      h.orderFuture = [];
      h.lastAt = now;
    }
    h.last = snap;
    setHistoryVersion((v) => v + 1);
  }, [pouContent, dutContent, pouPath, pouFileName]);
  const stepHistory = useCallback(
    (back: boolean) => {
      const h = historyRef.current;
      const orderFrom = back ? h.orderPast : h.orderFuture;
      const orderTo = back ? h.orderFuture : h.orderPast;
      // A transition's route changed last (dragged, laid out again): the routes back as they were, on the drawing as it is
      if (orderFrom[orderFrom.length - 1] === 'edges' && edgeUndoRef.current) {
        const eFrom = back ? h.edgesPast : h.edgesFuture;
        const eTo = back ? h.edgesFuture : h.edgesPast;
        const edges = eFrom.pop();
        orderFrom.pop();
        if (edges) {
          eTo.push(edgeUndoRef.current.get());
          orderTo.push('edges');
          edgeUndoRef.current.restore(edges);
          setHistoryVersion((v) => v + 1);
          showCopyToast(`${back ? 'Transition layout undone' : 'Transition layout redone'} (${h.orderPast.length} to undo, ${h.orderFuture.length} to redo)`, 'success');
          return;
        }
      }
      // A move on the canvas last: the states back where they were
      if (orderFrom[orderFrom.length - 1] === 'layout') {
        const lFrom = back ? h.layoutPast : h.layoutFuture;
        const lTo = back ? h.layoutFuture : h.layoutPast;
        const offsets = lFrom.pop();
        orderFrom.pop();
        if (offsets) {
          lTo.push(nodeOffsetsRef.current);
          orderTo.push('layout');
          h.layoutAt = 0;
          setNodeOffsets(offsets);
          setHistoryVersion((v) => v + 1);
          showCopyToast(`${back ? 'Move undone' : 'Move redone'} (${h.orderPast.length} to undo, ${h.orderFuture.length} to redo)`, 'success');
          return;
        }
      }
      if (orderFrom[orderFrom.length - 1] === 'code') orderFrom.pop();
      // (the states where they are on the canvas: the chart drawn again for the code as it was)
      setKeepCanvasPositions((v) => v + 1);
      const from = back ? h.past : h.future;
      const to = back ? h.future : h.past;
      const snap = from.pop();
      if (!snap || !h.last) return showCopyToast(back ? 'Nothing to undo' : 'Nothing to redo', 'error');
      to.push(h.last);
      orderTo.push('code');
      h.applying = true;
      h.lastAt = 0;
      handleReplaceSources(snap.pou !== pouContent ? snap.pou : null, snap.dut !== dutContent ? snap.dut : null);
      setHistoryVersion((v) => v + 1);
      showCopyToast(`${back ? 'Undone' : 'Redone'} (${h.orderPast.length || h.past.length} to undo, ${h.orderFuture.length || h.future.length} to redo)`, 'success');
    },
    [pouContent, dutContent, handleReplaceSources, showCopyToast]
  );
  const historyState = useMemo(
    () => ({
      canUndo: historyRef.current.past.length + historyRef.current.layoutPast.length + historyRef.current.edgesPast.length > 0,
      canRedo: historyRef.current.future.length + historyRef.current.layoutFuture.length + historyRef.current.edgesFuture.length > 0,
    }),
    [historyVersion] // eslint-disable-line react-hooks/exhaustive-deps
  );

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
      if (ctrl && e.key.toLowerCase() === 'c' && !sel.edge && !textSelected && pouContent && multiSelected.length > 1) {
        handleCopyState(multiSelected);
        return true;
      }
      if (ctrl && e.key.toLowerCase() === 'c' && sel.stateId && sel.stateId !== '[*]' && !sel.edge && !textSelected && pouContent) {
        handleCopyState(sel.stateId);
        return true;
      }
      if (ctrl && e.key.toLowerCase() === 'v' && copiedStateRef.current && pouContent) {
        handlePasteState();
        return true;
      }
      // F2: the selected transition's condition
      if (e.key === 'F2' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && sel.edge && pouContent) {
        handleEditCondition(sel.edge);
        return true;
      }
      // F2 / Shift+F2 otherwise: the next / previous bookmarked state (in the states' order)
      if (e.key === 'F2' && !e.ctrlKey && !e.altKey && !e.metaKey && !sel.edge && bookmarksRef.current.length) {
        const order = identifiedStatesRef.current.filter((s) => bookmarksRef.current.includes(s));
        if (!order.length) return false;
        const at = sel.stateId ? order.indexOf(sel.stateId) : -1;
        const next = e.shiftKey ? order[(at <= 0 ? order.length : at) - 1] : order[(at + 1) % order.length];
        handleJumpToState(next);
        setSelectedStateId(next);
        setSelectedStateLabel(next);
        showCopyToast(`Bookmark ${order.indexOf(next) + 1} of ${order.length}: ${next}`, 'success', 1800);
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
    [handleTransitionPriorityStep, pouContent, handleCopyState, handlePasteState, handleDeleteTransition, handleDeleteState, stepHistory, handleEditCondition, multiSelected]
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
  // The code editors' Go to Definition on a type (another POU): here in MachineScope (with Back), or in TwinCAT's
  // editor; a member: that POU at the member (its declaration line, or its method)
  const [pendingReveal, setPendingReveal] = useState<{ type: string; member: string } | null>(null);
  const [pouReveal, setPouReveal] = useState<{ symbol: string; nonce: number; line?: number; part?: 'declaration' | 'implementation' } | null>(null);
  // Find All References: the uses of a name in the POU, listed; a click opens the method / the POU Editor at the line
  const [refsView, setRefsView] = useState<{ name: string; refs: Reference[] } | null>(null);
  const handleFindReferences = useCallback((name: string) => {
    // (a state is also used as E_States.STATE)
    if (pouContent) setRefsView({ name, refs: findReferences(pouContent, name, (dutContent.match(/\bTYPE\s+(\w+)/gi) ?? []).map((m) => m.split(/\s+/)[1])) });
  }, [pouContent, dutContent]);
  const handleOpenReference = useCallback(
    (r: Reference) => {
      const method = r.unit && getAllMethodsFromPou(pouContent).find((m) => m.toLowerCase() === r.unit!.toLowerCase());
      if (method) {
        handleOpenInspectorPanel('method', { method: `${method}()` });
        if (r.part === 'implementation') setCodeJump({ method, line: r.line, nonce: Date.now() });
      } else if (!r.unit) {
        setDockLayout((l) => activateDockTab(l, 'pou'));
        setPouReveal({ symbol: refsView?.name ?? '', nonce: Date.now(), line: r.line, part: r.part });
      } else showCopyToast(`${r.where} line ${r.line}: open it in the TwinCAT editor`, 'error');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pouContent, handleOpenInspectorPanel, refsView, showCopyToast]
  );
  // Build (the Live tab): the PLC's project rebuilt with this POU as edited here, its errors listed; then written back
  const [plcBuild, setPlcBuild] = useState<PlcBuildState | null>(null);
  // (closed: the last build kept, the Live tab reopens it)
  const [plcBuildShown, setPlcBuildShown] = useState(false);
  const runPlcBuild = useCallback(
    (write: PlcWrite | null) => {
      if (!plcOrigin) return;
      const mine = plcEdits(plcOrigin, { content: pouContent }, { name: dutFileName, content: dutContent });
      const edits = [...Object.values(plcSessionEdits).filter((e) => !mine.some((m) => m.path.toLowerCase() === e.path.toLowerCase())), ...mine];
      const base: PlcBuildState = { phase: write ? 'writing' : 'building', write, files: edits.map((e) => e.path.split('/').pop() ?? e.path), project: plcOrigin.plcProject ?? plcOrigin.project, target: liveStatus.target ?? plcOrigin.target, via: 'plc' };
      setPlcBuild(base);
      setPlcBuildShown(true);
      const req = { requestId: Date.now() % 1e9, edits, plcProject: plcOrigin.plcProject, write };
      const desktop = desktopLive();
      const p: Promise<PlcBuildResult> = desktop
        ? desktop.build?.(req) ?? Promise.resolve({ ok: false, fatal: 'Update the desktop app: it cannot build the PLC\'s project' })
        : gatewayRef.current
          ? gatewayRef.current.request<PlcBuildResult>({ type: 'plcBuild', edits, plcProject: plcOrigin.plcProject, write }, 'plcBuildResult', 45 * 60 * 1000)
          : Promise.resolve({ ok: false, fatal: 'Not connected' });
      void p
        .catch((e: unknown) => ({ ok: false, fatal: e instanceof Error ? e.message : String(e) }) as PlcBuildResult)
        .then(async (r) => {
          // (built, not written yet: what a write would change, each file against the PLC's)
          let changes: PlcBuildState['changes'];
          if (r.ok && !r.written) {
            const theirs = await fetchPlcSources(plcOrigin.plcProject ?? '').catch(() => null);
            if (theirs?.files) {
              changes = edits.map((e) => {
                const was = theirs.files!.find((f) => f.path.toLowerCase() === e.path.toLowerCase())?.content ?? '';
                const name = e.path.split('/').pop() ?? e.path;
                return { file: name, parts: /\.TcPOU$/i.test(e.path) ? pouPartDiffs(was, e.content) : dutPartDiff(was, e.content) };
              });
            }
          }
          setPlcBuild({ ...base, phase: 'done', result: r, changes });
          if (r.written && r.ok) {
            // On the PLC now: this POU is saved there, and its sources are read again
            setSavedSources((b) => ({ ...b, pou: pouContent, dut: dutContent }));
            setPlcSessionEdits({});
            plcSourcesRef.current = new Map();
            showCopyToast(`Written to the PLC (${r.written === 'online' ? 'online change' : r.written === 'download' ? 'downloaded' : 'configuration activated'})`, 'success', 7000);
          }
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plcOrigin, pouContent, dutContent, dutFileName, liveStatus.target, showCopyToast, plcSessionEdits]
  );
  // Desktop app, a POU from the PLC: the engineering project that runs on it (its folder chosen once, remembered per
  // PLC project in this app), for XAE's own online change: the POU and its enum as edited saved into it
  const engineeringKey = plcOrigin ? `kss.engineeringProject.${plcOrigin.project ?? ''}|${plcOrigin.plcProject ?? ''}` : '';
  const engineeringRoot = (() => {
    try {
      return engineeringKey ? localStorage.getItem(engineeringKey) : null;
    } catch {
      return null;
    }
  })();
  const saveIntoEngineering = useCallback(async (): Promise<string | null> => {
    const api = desktopLive();
    if (!api?.saveIntoProject || !api.pickProjectFolder || !plcOrigin) return 'Not available here';
    let root = engineeringRoot;
    if (!root) {
      const picked = await api.pickProjectFolder();
      if (picked.canceled) return 'Not saved: no project chosen';
      if (!picked.path) return picked.error ?? 'Not a TwinCAT project folder';
      root = picked.path;
    }
    let pou = await api.saveIntoProject({ root, plcProject: plcOrigin.plcProject, path: plcOrigin.path, content: pouContent });
    // (the remembered project no longer has it, renamed or moved: chosen again at once, then saved there)
    if (pou.error && root === engineeringRoot) {
      const again = await api.pickProjectFolder();
      if (again.path) {
        root = again.path;
        pou = await api.saveIntoProject({ root, plcProject: plcOrigin.plcProject, path: plcOrigin.path, content: pouContent });
      } else if (again.canceled) pou = { error: `${pou.error} (not saved: no other project chosen)` };
    }
    if (pou.error) {
      try {
        localStorage.removeItem(engineeringKey);
      } catch {
        // (not kept)
      }
      return `${pou.error} (choose the project again next time)`;
    }
    try {
      localStorage.setItem(engineeringKey, root);
    } catch {
      // (asked again next time)
    }
    const dutPath = plcOrigin.dutPaths[dutFileName.toLowerCase()];
    if (dutPath && dutContent) {
      const dut = await api.saveIntoProject({ root, plcProject: plcOrigin.plcProject, path: dutPath, content: dutContent });
      if (dut.error) return `The POU is saved; its enum not: ${dut.error}`;
    }
    showCopyToast(`Saved into ${pou.file}${dutPath && dutContent ? ' (and its enum)' : ''}: reload it in XAE, then Login`, 'success', 7000);
    return null;
  }, [plcOrigin, engineeringRoot, engineeringKey, pouContent, dutContent, dutFileName, showCopyToast]);
  // Desktop app, a POU of a TwinCAT project on this computer: built from that project (a copy of it, this POU and its
  // enum as edited here); after a write the POU is saved and the project gets the new compile information
  const runProjectBuild = useCallback(
    (write: PlcWrite | null) => {
      const desktop = desktopLive();
      if (!pouPath || !desktop?.projectBuild) return;
      const edits = [{ file: pouPath, content: pouContent }, ...(dutPath && dutContent ? [{ file: dutPath, content: dutContent }] : [])];
      const base: PlcBuildState = { phase: write ? 'writing' : 'building', write, files: edits.map((e) => e.file.split(/[\\/]/).pop() ?? e.file), project: 'this POU\'s TwinCAT project', target: liveStatus.target, via: 'project' };
      setPlcBuild(base);
      setPlcBuildShown(true);
      void desktop
        .projectBuild({ requestId: Date.now() % 1e9, file: pouPath, edits, write })
        .catch((e: unknown) => ({ ok: false, fatal: e instanceof Error ? e.message : String(e) }) as PlcBuildResult)
        .then((r) => {
          setPlcBuild({ ...base, project: r.plcProject ?? base.project, phase: 'done', result: r });
          if (r.written && r.ok) {
            // On the PLC now: saved to its file too
            void saveSourcesRef.current();
            showCopyToast(`Written to the PLC (${r.written === 'online' ? 'online change' : r.written === 'download' ? 'downloaded' : 'configuration activated'}), saved${r.compileInfoCopied ? ', the project\'s compile information updated' : ''}`, 'success', 7000);
          }
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pouPath, pouContent, dutPath, dutContent, liveStatus.target, showCopyToast]
  );
  // XAE edition: XAE's own build of its solution (this POU saved there first), its Error List here
  const xaeBuildIdRef = useRef(0);
  const runXaeBuild = useCallback(() => {
    // (XAE builds what is saved in its project: this POU's edits saved there first; the host takes them in order)
    if (hostDirtyFiles.length) handleSaveToProjectRef.current(true);
    const requestId = ++xaeBuildIdRef.current;
    const base: PlcBuildState = { phase: 'building', write: null, files: [], project: 'the solution open in XAE', target: 'XAE', via: 'xae' };
    setPlcBuild(base);
    setPlcBuildShown(true);
    postToHost({ type: 'buildProject', requestId });
  }, [hostDirtyFiles.length, showCopyToast]);
  useEffect(() => {
    if (!isXaeHost()) return;
    return onHostMessage((m) => {
      if (m.type !== 'xaeBuildResult' || m.requestId !== xaeBuildIdRef.current) return;
      const items: PlcBuildItem[] = (m.items ?? []).map((x) => ({ ...x, place: placeOfXaeFile(x.file, x.line) }));
      setPlcBuild((b) => (b ? { ...b, phase: 'done', result: { ok: m.ok, fatal: m.fatal, errors: m.errors, warnings: m.warnings, items } } : b));
    });
  }, []);
  // The connected PLC's TwinCAT trial license: read once per connection; the Live tab says so when it ran out or
  // runs out soon (the next application start would fail)
  const [licenseNotice, setLicenseNotice] = useState<{ state: 'expired' | 'soon'; text: string } | null>(null);
  // (Renew's Check again: read once more)
  const [licenseCheck, setLicenseCheck] = useState(0);
  useEffect(() => {
    setLicenseNotice(null);
    if (liveStatus.state !== 'connected' || isXaeHost()) return;
    let alive = true;
    const desktop = desktopLive();
    const ask: Promise<{ state: { state: 'expired' | 'soon' | 'ok'; text: string } | null }> = desktop?.license
      ? desktop.license({ requestId: Date.now() % 1e9 })
      : gatewayRef.current
        ? gatewayRef.current.request<{ state: { state: 'expired' | 'soon' | 'ok'; text: string } | null }>({ type: 'plcLicense' }, 'plcLicenseResult', 20000)
        : Promise.resolve({ state: null });
    void ask
      .catch(() => ({ state: null }))
      .then((r) => {
        if (alive && r.state && r.state.state !== 'ok') setLicenseNotice({ state: r.state.state, text: r.state.text });
      });
    return () => {
      alive = false;
    };
    // (once per connection: its target; again on Check again)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStatus.state === 'connected' ? liveStatus.target : null, licenseCheck]);
  // The PLC's state and online change count (the dialog's online change from XAE: before and after)
  const handleReadAppInfo = useCallback(async (): Promise<PlcAppInfo> => {
    const desktop = desktopLive();
    if (desktop?.appInfo) return desktop.appInfo({ requestId: Date.now() % 1e9 });
    if (!gatewayRef.current) return { state: null, onlineChanges: null, error: 'Not connected' };
    return gatewayRef.current.request<PlcAppInfo>({ type: 'plcAppInfo' }, 'plcAppInfoResult', 20000);
  }, []);
  // Close the XAE kept open for builds now (the desktop app, Link, the gateway: where the build ran)
  const handleCloseXae = useCallback(async (key?: string): Promise<boolean> => {
    const desktop = desktopLive();
    if (desktop?.closeBuild) return (await desktop.closeBuild({ requestId: Date.now() % 1e9, ...(key ? { key } : {}) })).closed;
    if (!gatewayRef.current) return false;
    const r = await gatewayRef.current.request<{ closed: boolean }>({ type: 'plcBuildClose', ...(key ? { key } : {}) }, 'plcBuildClosed', 30000).catch(() => ({ closed: false }));
    return r.closed;
  }, []);
  const openPlcBuildItem = useCallback(
    (i: PlcBuildItem) => {
      const p = i.place;
      const origin = isXaeHost() && pouPath ? { path: pouPath.replace(/\\/g, '/'), dutPaths: {} } : plcOrigin;
      if (!p || !itemInPou(i, origin)) return false;
      handleOpenReference({ where: '', unit: p.member ?? undefined, part: p.part ?? 'implementation', line: p.line ?? 1, column: 0, text: '', kind: 'read' });
      return true;
    },
    [plcOrigin, handleOpenReference, pouPath]
  );
  // The last build's messages in the Problems tab too (until the next build): a click opens those in this POU
  const buildItemsRef = useRef(new Map<string, PlcBuildItem>());
  const buildFindings = useMemo<LintFinding[]>(() => {
    buildItemsRef.current = new Map();
    const items = plcBuild?.phase === 'done' ? plcBuild.result?.items ?? [] : [];
    return items.map((i, n) => {
      const key = `build:${i.level}:${buildItemWhere(i)}:${i.text.trim()}:${n}`;
      buildItemsRef.current.set(key, i);
      const inPou = isXaeHost() && pouPath ? !!i.place : itemInPou(i, plcOrigin);
      return { key, rule: i.level === 'error' ? 'build-error' : 'build-warning', severity: i.level === 'error' ? 'error' : 'warning', message: `${i.text.trim()} (${buildItemWhere(i)})`, ...(inPou ? { method: i.place?.member ?? '(body)', line: i.place?.line ?? 1 } : {}) } as LintFinding;
    });
  }, [plcBuild, plcOrigin, pouPath]);
  const handleOpenType = useCallback(
    async (type: string, where: OpenTypeWhere, member?: string) => {
      const info = getProjectSymbols()?.types.get(type.toLowerCase());
      const found = member ? info?.members.find((m) => m.name.toLowerCase() === member.toLowerCase()) : undefined;
      if (where === 'xae') {
        const method = found && (found.scope === 'METHOD' || found.scope === 'PROPERTY') ? found.name : undefined;
        postToHost({ type: 'openInXae', typeName: type, ...(method ? { method } : found?.line ? { line: found.line, text: found.text } : {}) });
        return;
      }
      if (info && !['FUNCTION_BLOCK', 'PROGRAM', 'FUNCTION'].includes(info.kind)) {
        showCopyToast(`${type} is ${info.kind === 'GVL' ? 'a GVL' : info.kind === 'INTERFACE' ? 'an interface' : 'a DUT'}: MachineScope opens POUs${isXaeHost() ? ' (Open in the TwinCAT editor)' : ''}`, 'error');
        return;
      }
      const from = pouPath ? { path: pouPath, name: pouFileName } : null;
      if (await openPouInProject(type)) {
        if (from) setPouHistory((h) => [...h, from].slice(-20));
        if (member) setPendingReveal({ type, member });
      }
    },
    [pouPath, pouFileName, openPouInProject, showCopyToast]
  );
  // Once that POU is here: its method in the Method Editor, else the member's line in the POU Editor
  useEffect(() => {
    if (!pendingReveal) return;
    if (pouFileName.replace(/\.TcPOU$/i, '').toLowerCase() !== pendingReveal.type.toLowerCase()) return;
    const method = getAllMethodsFromPou(pouContent).find((m) => m.toLowerCase() === pendingReveal.member.toLowerCase());
    if (method && /<Method\b/i.test(pouContent)) handleOpenMethodEditorModal(`${method}()`);
    else {
      setDockLayout((l) => activateDockTab(l, 'pou'));
      setPouReveal({ symbol: pendingReveal.member, nonce: Date.now() });
    }
    setPendingReveal(null);
  }, [pendingReveal, pouFileName, pouContent, handleOpenMethodEditorModal]);
  // Rename a variable of the POU (a method's own: in it), with the changes previewed. An input / output is also
  // renamed where other POUs of the project use it (instance.x, instance(x := ...)): XAE and the desktop app find
  // them, the preview lists them, and they are written at once (this POU with Save, as usual)
  const renameUsesRef = useRef<{ key: string; files: { name: string; path: string; baseline: string; content: string; changes: { where: string; line: number; before: string; after: string }[] }[] | null; error?: string } | null>(null);
  const fetchProjectUses = useCallback(async (name: string): Promise<{ files?: { name: string; path: string; content: string }[]; error?: string }> => {
    if (isXaeHost()) {
      const requestId = Date.now() % 1e9;
      return new Promise((resolve) => {
        const off = onHostMessage((m) => {
          if (m.type === 'projectUses' && m.requestId === requestId) {
            off();
            resolve({ files: m.files, error: m.error });
          }
        });
        postToHost({ type: 'projectUses', requestId, name });
        setTimeout(() => {
          off();
          resolve({ error: 'XAE did not answer' });
        }, 20000);
      });
    }
    const desktop = (window as unknown as { tcDesktop?: { projectUses?: (from: string, n: string) => Promise<{ files?: { name: string; path: string; content: string }[]; error?: string }> } }).tcDesktop;
    if (desktop?.projectUses && pouPath) return desktop.projectUses(pouPath, name);
    // Web: the project folder (asked for once)
    if (canPickFolder()) return webProjectUses(name);
    return { error: 'none' };
  }, [pouPath]);
  const writeOtherPous = useCallback(
    async (files: { path: string; content: string; baseline: string }[]): Promise<string | null> => {
      if (isXaeHost()) {
        const requestId = Date.now() % 1e9;
        return new Promise((resolve) => {
          const off = onHostMessage((m) => {
            if (m.type === 'saveOtherResult' && m.requestId === requestId) {
              off();
              resolve(m.ok ? null : m.message || 'XAE did not write them');
            }
          });
          postToHost({ type: 'saveOther', requestId, files });
        });
      }
      const desktop = (window as unknown as { tcDesktop?: { saveSources?: (f: unknown) => Promise<{ saved: string[]; conflicts: { path: string }[]; errors: { path: string; error: string }[] }> } }).tcDesktop;
      if (!desktop?.saveSources) return canPickFolder() ? writeWebOtherPous(files) : 'The other POUs cannot be written here';
      const r = await desktop.saveSources(files);
      if (r.conflicts.length) return `Changed since they were read: ${r.conflicts.map((c) => c.path.split(/[\\/]/).pop()).join(', ')}`;
      if (r.errors.length) return r.errors.map((e) => e.error).join('; ');
      return null;
    },
    []
  );
  projectIoRef.current = {
    fetch: fetchProjectUses,
    write: writeOtherPous,
    can: () => isXaeHost() || Boolean((window as unknown as { tcDesktop?: { projectUses?: unknown } }).tcDesktop?.projectUses && pouPath) || (!isDesktopApp() && canPickFolder()),
  };
  const handleRenameVariable = useCallback(
    (name: string, method?: string, inline?: InlineRename) => {
      if (!pouContent) return;
      const v = (method ? declarationVariables(getMethodCodeFromPou(pouContent, method).declaration || '') : declarationVariables(extractPouDeclaration(pouContent))).find((x) => x.name.toLowerCase() === name.toLowerCase());
      const outside = !method && v && ['VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT'].includes(v.scope);
      const desktop = (window as unknown as { tcDesktop?: { projectUses?: unknown } }).tcDesktop;
      const canProject = !!outside && (isXaeHost() || Boolean(desktop?.projectUses && pouPath) || (!desktop && canPickFolder()));
      const pouName = pouFileName.replace(/\.TcPOU$/i, '');
      // The other POUs' changes for a new name (the files are read once)
      renameUsesRef.current = null;
      let files: { name: string; path: string; content: string }[] | null = null;
      let lookupError: string | undefined;
      const otherChanges = (n: string) => {
        if (!files) return null;
        const instances = new Set<string>();
        for (const tp of getProjectSymbols()?.types.values() ?? []) for (const m of tp.members) if (baseTypeName(m.type).toLowerCase() === pouName.toLowerCase()) instances.add(m.name.toLowerCase());
        return files
          .map((file) => {
            const local = new Set(instances);
            for (const d of file.content.matchAll(/<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>/gi)) for (const x of declarationVariables(d[1])) if (baseTypeName(x.type).toLowerCase() === pouName.toLowerCase()) local.add(x.name.toLowerCase());
            if (!local.size) return null;
            const r = renameMemberInFile(file.content, local, name, n);
            return r.changes.length ? { name: file.name, path: file.path, baseline: file.content, content: r.xml, changes: r.changes } : null;
          })
          .filter((x): x is NonNullable<typeof x> => !!x);
      };
      const ask = () =>
        setPromptRequest({
          // (Shift+F6: in place, at the name)
          ...(inline ? { anchor: inline.anchor, inline: true, onDismiss: inline.done } : {}),
          title: `Rename ${name}${method ? ` (in ${method}())` : ''}`,
          label: method ? `The new name of ${method}()'s ${name}, in that method:` : `The new name of ${name}${v ? ` (${v.scope} : ${v.type})` : ''}, everywhere in the POU: its declaration, body, methods and the guards${canProject ? ', and where other POUs of the project use it' : ''}:`,
          initial: name,
          monospace: true,
          submitLabel: 'Rename',
          validate: (n) => (n === name ? 'Enter a new name' : checkRename(pouContent, name, n, method)),
          preview: (n) => {
            const r = renameVariable(pouContent, name, n, method);
            if ('error' in r) return [];
            const rows = r.changes.slice(0, 40).map((c) => `${c.where} ${c.line}:  ${c.before}\n    →  ${c.after}`);
            if (r.changes.length > 40) rows.push(`… ${r.changes.length - 40} more`);
            if (r.skipped.length) rows.push(`Left as they are (their own ${name}): ${r.skipped.join(', ')}`);
            if (canProject) {
              const others = otherChanges(n);
              if (others === null) rows.push(lookupError ? `⚠ Uses in other POUs not found (${lookupError}): they keep the old name` : 'Looking for uses in the other POUs of the project…');
              else if (!others.length) rows.push('No other POU of the project uses it.');
              else
                for (const o of others) {
                  rows.push(`${o.name} (written at once):`);
                  o.changes.slice(0, 12).forEach((c) => rows.push(`  ${c.where} ${c.line}:  ${c.before}\n      →  ${c.after}`));
                  if (o.changes.length > 12) rows.push(`  … ${o.changes.length - 12} more`);
                }
              rows.push('Live watches of the old name are not changed.');
            } else if (outside) rows.push(`⚠ ${name} is part of the POU's interface: other POUs that use it (instance.${name}), and Live watches, keep the old name`);
            return [`${r.changes.length} line${r.changes.length === 1 ? '' : 's'} change:`, ...rows];
          },
          onSubmit: async (n) => {
            const r = renameVariable(pouContent, name, n, method);
            if ('error' in r) return showCopyToast(r.error, 'error', 6000);
            const others = canProject ? otherChanges(n) ?? [] : [];
            if (others.length) {
              const err = await writeOtherPous(others.map((o) => ({ path: o.path, content: o.content, baseline: o.baseline })));
              if (err) return showCopyToast(`Not renamed: ${err}`, 'error', 8000);
            }
            handleReplaceSources(r.pou, null);
            showCopyToast(`Renamed ${name} → ${n}: ${r.changes.length} line${r.changes.length === 1 ? '' : 's'}${others.length ? `, and in ${others.map((o) => o.name).join(', ')} (written)` : ''}${r.skipped.length ? ` (not in ${r.skipped.join(', ')}: their own ${name})` : ''}`, 'success', 7000);
          },
        });
      ask();
      if (canProject) {
        void fetchProjectUses(name).then((res) => {
          files = res.files ?? [];
          lookupError = res.error;
          if (res.error) files = null;
          // (the dialog shows them: asked again, what is typed is kept)
          setPromptRequest((cur) => (cur && cur.title.startsWith(`Rename ${name}`) ? { ...cur } : cur));
        });
      }
    },
    [pouContent, pouFileName, pouPath, handleReplaceSources, showCopyToast, fetchProjectUses, writeOtherPous]
  );
  // Rename a method / property: in the POU, and (not PRIVATE) where other POUs of the project call it
  const handleRenameMethod = useCallback(
    (name: string, inline?: InlineRename) => {
      if (!pouContent) return;
      const pouName = pouFileName.replace(/\.TcPOU$/i, '');
      const probe = renameMethod(pouContent, name, `${name}_`);
      if ('error' in probe) return showCopyToast(probe.error, 'error');
      const desktop = (window as unknown as { tcDesktop?: { projectUses?: unknown } }).tcDesktop;
      const canProject = !probe.isPrivate && (isXaeHost() || Boolean(desktop?.projectUses && pouPath) || (!desktop && canPickFolder()));
      let files: { name: string; path: string; content: string }[] | null = null;
      let lookupError: string | undefined;
      const otherChanges = (n: string) => {
        if (!files) return null;
        const instances = new Set<string>();
        for (const tp of getProjectSymbols()?.types.values() ?? []) for (const m of tp.members) if (baseTypeName(m.type).toLowerCase() === pouName.toLowerCase()) instances.add(m.name.toLowerCase());
        return files
          .map((file) => {
            const local = new Set(instances);
            for (const d of file.content.matchAll(/<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>/gi)) for (const x of declarationVariables(d[1])) if (baseTypeName(x.type).toLowerCase() === pouName.toLowerCase()) local.add(x.name.toLowerCase());
            if (!local.size) return null;
            const r = renameMemberInFile(file.content, local, name, n);
            return r.changes.length ? { name: file.name, path: file.path, baseline: file.content, content: r.xml, changes: r.changes } : null;
          })
          .filter((x): x is NonNullable<typeof x> => !!x);
      };
      setPromptRequest({
        ...(inline ? { anchor: inline.anchor, inline: true, onDismiss: inline.done } : {}),
        title: `Rename ${probe.kind} ${name}`,
        label: `The new name of ${name}${probe.kind === 'method' ? '()' : ''}: its declaration and every call in the POU${canProject ? ', and where other POUs of the project call it' : probe.isPrivate ? ' (PRIVATE: only this POU calls it)' : ''}:`,
        initial: name,
        monospace: true,
        submitLabel: 'Rename',
        validate: (n) => checkMethodRename(pouContent, name, n),
        preview: (n) => {
          const r = renameMethod(pouContent, name, n);
          if ('error' in r) return [];
          const rows = r.changes.slice(0, 40).map((c) => `${c.where} ${c.line}:  ${c.before}\n    →  ${c.after}`);
          if (canProject) {
            const others = otherChanges(n);
            if (others === null) rows.push(lookupError ? `⚠ Calls in other POUs not found (${lookupError})` : 'Looking for calls in the other POUs of the project…');
            else if (!others.length) rows.push('No other POU of the project calls it.');
            else for (const o of others) {
              rows.push(`${o.name} (written at once):`);
              o.changes.slice(0, 12).forEach((c) => rows.push(`  ${c.where} ${c.line}:  ${c.before}\n      →  ${c.after}`));
            }
          } else if (!probe.isPrivate) rows.push(`⚠ Other POUs that call it (instance.${name}()) keep the old name`);
          return [`${r.changes.length} line${r.changes.length === 1 ? '' : 's'} change:`, ...rows];
        },
        onSubmit: async (n) => {
          const r = renameMethod(pouContent, name, n);
          if ('error' in r) return showCopyToast(r.error, 'error', 6000);
          const others = canProject ? otherChanges(n) ?? [] : [];
          if (others.length) {
            const err = await writeOtherPous(others.map((o) => ({ path: o.path, content: o.content, baseline: o.baseline })));
            if (err) return showCopyToast(`Not renamed: ${err}`, 'error', 8000);
          }
          handleReplaceSources(r.pou, null);
          showCopyToast(`Renamed ${name} → ${n}: ${r.changes.length} line${r.changes.length === 1 ? '' : 's'}${others.length ? `, and in ${others.map((o) => o.name).join(', ')} (written)` : ''}`, 'success', 7000);
        },
      });
      if (canProject) {
        void fetchProjectUses(name).then((res) => {
          files = res.error ? null : res.files ?? [];
          lookupError = res.error;
          setPromptRequest((cur) => (cur && cur.title.startsWith(`Rename ${probe.kind} ${name}`) ? { ...cur } : cur));
        });
      }
    },
    [pouContent, pouFileName, pouPath, handleReplaceSources, showCopyToast, fetchProjectUses, writeOtherPous]
  );
  // Extract Method: the lines into a new method (its name asked, what it takes previewed)
  const handleExtractMethod = useCallback(
    (method: string, start: number, end: number) => {
      if (!pouContent) return;
      const first = checkExtract(pouContent, method, start, end, 'NewMethod_');
      if (first && !/already a method/.test(first)) return showCopyToast(first, 'error', 6000);
      setPromptRequest({
        title: `Extract Method from ${method}() (lines ${start}–${end})`,
        label: 'The new method\'s name (PRIVATE; the lines go into it, a call takes their place):',
        initial: 'NewMethod',
        monospace: true,
        submitLabel: 'Extract',
        validate: (n) => checkExtract(pouContent, method, start, end, n),
        preview: (n) => {
          const p = planExtract(pouContent, method, start, end, n);
          return [
            `In ${method}(), lines ${start}–${end} become:`,
            ...p.call.split('\n').map((l) => `  ${l.trim()}`),
            ...(p.returns ? [`(the lines RETURN: ${n}() returns TRUE when they did, and ${method}() RETURNs after it)`] : []),
            `${n}() takes: ${p.inputs.length ? `VAR_INPUT ${p.inputs.map((x) => `${x.name} : ${x.type}`).join(', ')}` : 'no inputs'}${p.outputs.length ? `; VAR_OUTPUT ${p.outputs.map((x) => `${x.name} : ${x.type}`).join(', ')} (set by the lines, given back)` : ''}${p.inOuts.length ? `; VAR_IN_OUT ${p.inOuts.map((x) => `${x.name} : ${x.type}`).join(', ')} (read and written by the lines)` : ''}`,
            `Its body (${p.body.filter((l) => l.trim()).length} lines):`,
            ...p.body.slice(0, 12).map((l) => `  ${l}`),
            ...(p.body.length > 12 ? [`  … ${p.body.length - 12} more`] : []),
          ];
        },
        onSubmit: (n) => {
          const r = extractMethod(pouContent, method, start, end, n);
          if ('error' in r) return showCopyToast(r.error, 'error', 6000);
          handleReplaceSources(r.pou, null);
          showCopyToast(`Extracted ${end - start + 1} line${end === start ? '' : 's'} of ${method}() into ${n}()`, 'success', 6000);
        },
      });
    },
    [pouContent, handleReplaceSources, showCopyToast]
  );
  // Extract Action: the lines (only the POU's members) into a new Action, its call in their place
  const handleExtractAction = useCallback(
    (method: string, start: number, end: number) => {
      if (!pouContent) return;
      const first = checkExtractAction(pouContent, method, start, end, 'NewAction_');
      if (first && !/already a method/.test(first)) return showCopyToast(first, 'error', 7000);
      const m = getMethodCodeFromPou(pouContent, method);
      const sel = (m.code ?? '').split(/\r?\n/).slice(start - 1, end).filter((l) => l.trim());
      setPromptRequest({
        title: `Extract Action from ${method}() (lines ${start}–${end})`,
        label: 'The new Action\'s name (the lines go into it, a call takes their place):',
        initial: 'NewAction',
        monospace: true,
        submitLabel: 'Extract',
        validate: (n) => checkExtractAction(pouContent, method, start, end, n),
        preview: (n) => [`In ${method}(), lines ${start}–${end} become:`, `  ${n}();`, `The Action ${n} (${sel.length} lines):`, ...sel.slice(0, 12).map((l) => `  ${l.trim()}`), ...(sel.length > 12 ? [`  … ${sel.length - 12} more`] : [])],
        onSubmit: (n) => {
          const r = extractAction(pouContent, method, start, end, n);
          if ('error' in r) return showCopyToast(r.error, 'error', 6000);
          handleReplaceSources(r.pou, null);
          showCopyToast(`Extracted ${end - start + 1} line${end === start ? '' : 's'} of ${method}() into the Action ${n}`, 'success', 6000);
        },
      });
    },
    [pouContent, handleReplaceSources, showCopyToast]
  );
  // Extract Property: "Name : TYPE" asked for (the type guessed from the expression)
  const handleExtractProperty = useCallback(
    (method: string, line: number, from: number, to: number) => {
      if (!pouContent) return;
      const text = (getMethodCodeFromPou(pouContent, method).code ?? '').split(/\r?\n/)[line - 1] ?? '';
      const expr = text.slice(from, to).trim();
      const guessed = guessExpressionType(pouContent, method, expr);
      const parse = (v: string) => {
        const m = v.match(/^\s*([A-Za-z_]\w*)\s*:\s*(.+?)\s*;?\s*$/);
        return m ? { name: m[1], type: m[2] } : { name: v.trim(), type: '' };
      };
      const first = checkExtractProperty(pouContent, method, line, from, to, 'NewProperty_', guessed || 'BOOL');
      if (first && !/already/.test(first)) return showCopyToast(first, 'error', 6000);
      setPromptRequest({
        title: `Extract Property from ${method}() (line ${line})`,
        label: `The new property: its name and type (PRIVATE, Get only; ${expr} becomes its value, its name takes its place):`,
        initial: `${/^BOOL$/i.test(guessed) ? 'bNewProperty' : 'NewProperty'} : ${guessed || 'INT'}`,
        monospace: true,
        submitLabel: 'Extract',
        validate: (v) => {
          const p = parse(v);
          return checkExtractProperty(pouContent, method, line, from, to, p.name, p.type);
        },
        preview: (v) => {
          const p = parse(v);
          const plan = planExtractProperty(pouContent, method, line, from, to, p.name, p.type);
          return [`In ${method}(), line ${line} becomes:`, `  ${plan.line.trim()}`, `PROPERTY PRIVATE ${p.name} : ${p.type}`, `  Get: ${p.name} := ${plan.expression};`];
        },
        onSubmit: (v) => {
          const p = parse(v);
          const r = extractProperty(pouContent, method, line, from, to, p.name, p.type);
          if ('error' in r) return showCopyToast(r.error, 'error', 6000);
          handleReplaceSources(r.pou, null);
          showCopyToast(`Extracted ${r.plan.expression} into the property ${p.name} : ${p.type}`, 'success', 6000);
        },
      });
    },
    [pouContent, handleReplaceSources, showCopyToast]
  );
  const handleDeclareInPou = useCallback(
    (vars: NewVariable[]) => {
      const r = declareVariables(pouContent, vars);
      if ('error' in r) {
        showCopyToast(r.error, 'error');
        return false;
      }
      handleReplaceSources(r.pou, null);
      return true;
    },
    [pouContent, handleReplaceSources, showCopyToast]
  );
  useEffect(() => {
    const desktop = (window as unknown as { tcDesktop?: { openPouInProject?: unknown } }).tcDesktop;
    const canOpen = isXaeHost() || Boolean(desktop?.openPouInProject && pouPath);
    setOpenTypeHandler({
      open: canOpen ? (t, w, m) => void handleOpenType(t, w, m) : undefined,
      xae: isXaeHost(),
      current: pouFileName.replace(/\.TcPOU$/i, ''),
      scope: (method) => symbolScope(pouContent, getProjectSymbols(), { method: method ?? '__body__', states: identifiedStatesResult.states.map((s) => s.id) }),
      rename: handleRenameVariable,
      renameMethod: handleRenameMethod,
      extractMethod: handleExtractMethod,
      extractProperty: handleExtractProperty,
      extractAction: handleExtractAction,
      declare: handleDeclareInPou,
      findReferences: handleFindReferences,
      problems: () => lintFindingsRef.current,
      liveValues: () => liveValuesRef.current,
      setEditorWatch: (names) => setEditorWatch((cur) => (cur.join('|') === names.join('|') ? cur : names)),
      watchVariable: (name) => setUserWatch((cur) => (cur.some((n) => n.toLowerCase() === name.toLowerCase()) ? cur.filter((n) => n.toLowerCase() !== name.toLowerCase()) : [...cur, name])),
      isWatched: (name) => userWatchRef.current.some((n) => n.toLowerCase() === name.toLowerCase()),
      showBookmarks: () => setBookmarksOpen(true),
    });
    return () => setOpenTypeHandler(null);
  }, [handleOpenType, pouPath, pouFileName, pouContent, identifiedStatesResult, handleRenameVariable, handleDeclareInPou, symbolsVersion, handleFindReferences, handleRenameMethod, handleExtractMethod, handleExtractProperty, handleExtractAction]);
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
      // Several states selected, and this one among them: actions on all of them first
      if (target.type === 'node' && multiSelected.length > 1 && multiSelected.includes(target.id)) {
        const many = multiSelected;
        const n = many.length;
        const allMarked = many.every((s) => bookmarks.states.includes(s));
        items.push({
          id: 'multi-bookmark-btn',
          label: allMarked ? `Remove the bookmarks of the ${n} states` : `Bookmark the ${n} states`,
          icon: <Bookmark className="w-3.5 h-3.5" />,
          onSelect: () => {
            for (const s of many) if (bookmarks.states.includes(s) === allMarked) toggleStateBookmark(pouFileName, s);
            showCopyToast(allMarked ? `Removed ${n} bookmarks` : `Bookmarked ${n} states`, 'success');
          },
        });
        items.push({
          id: 'multi-delete-btn',
          label: `Delete the ${n} states…`,
          icon: <Trash2 className="w-3.5 h-3.5" />,
          onSelect: () => {
            let pou = pouContent;
            let dut: string | null = dutContent;
            const details: string[] = [];
            for (const s of many) {
              const r = deleteState(pou, dut ?? '', s, stateVarName);
              if ('error' in r) return showCopyToast(`${s}: ${r.error}`, 'error', 6000);
              pou = r.pou;
              if (r.dut) dut = r.dut;
              details.push(`${s}: ${[...(r.dut ? ['its enum member'] : []), ...r.methods.map((m) => `its branch in ${m}()`), ...(r.transitions.length ? [`${r.transitions.length} transition${r.transitions.length === 1 ? '' : 's'} into it`] : [])].join(', ')}`);
              for (const k of [...r.kept, ...r.remaining]) details.push(`  still refers to it: ${k}`);
            }
            setPromptRequest({
              title: `Delete ${n} states?`,
              label: 'Deleted from the POU and the enum (Save writes them to the project):',
              details,
              confirmOnly: true,
              danger: true,
              submitLabel: `Delete ${n} states`,
              onSubmit: () => {
                handleReplaceSources(pou, dut !== dutContent ? dut : null);
                many.forEach((s) => dropStateKeys(s));
                setMultiSelected([]);
                if (selectedStateId && many.includes(selectedStateId)) {
                  setSelectedStateId(null);
                  setSelectedStateLabel('');
                }
                showCopyToast(`Deleted ${n} states`, 'success');
              },
            });
          },
        });
        const arrange = (mode: Parameters<MermaidViewerHandle['arrangeStates']>[1]) => () => mermaidViewerRef.current?.arrangeStates(many, mode);
        items.push({ id: 'multi-align-left-btn', label: 'Align left edges', icon: <AlignStartVertical className="w-3.5 h-3.5" />, onSelect: arrange('left') });
        items.push({ id: 'multi-align-center-btn', label: 'Align centers (vertical line)', icon: <AlignCenterVertical className="w-3.5 h-3.5" />, onSelect: arrange('center') });
        items.push({ id: 'multi-align-right-btn', label: 'Align right edges', icon: <AlignEndVertical className="w-3.5 h-3.5" />, onSelect: arrange('right') });
        items.push({ id: 'multi-align-top-btn', label: 'Align top edges', icon: <AlignStartHorizontal className="w-3.5 h-3.5" />, onSelect: arrange('top') });
        items.push({ id: 'multi-align-middle-btn', label: 'Align middles (horizontal line)', icon: <AlignCenterHorizontal className="w-3.5 h-3.5" />, onSelect: arrange('middle') });
        items.push({ id: 'multi-align-bottom-btn', label: 'Align bottom edges', icon: <AlignEndHorizontal className="w-3.5 h-3.5" />, onSelect: arrange('bottom') });
        if (n > 2) {
          items.push({ id: 'multi-distribute-h-btn', label: 'Distribute horizontally', icon: <AlignHorizontalSpaceAround className="w-3.5 h-3.5" />, title: 'The ones between the outer two: evenly apart', onSelect: arrange('distribute-h') });
          items.push({ id: 'multi-distribute-v-btn', label: 'Distribute vertically', icon: <AlignVerticalSpaceAround className="w-3.5 h-3.5" />, title: 'The ones between the outer two: evenly apart', onSelect: arrange('distribute-v') });
        }
        items.push({
          id: 'multi-relayout-btn',
          label: 'Re-layout their transitions',
          icon: <Spline className="w-3.5 h-3.5" />,
          title: 'Every transition in or out of the selected states laid out again, each straight or with as few turns as it can, clear of the other states; the states stay where they are (one Ctrl+Z puts them back)',
          onSelect: () => relayoutTransitionsOf(many, `the ${n} states`),
        });
        if (pouContent && many.filter((x) => !x.includes('__')).length >= 2)
          items.push({ id: 'multi-extract-sub-machine-btn', label: 'Extract to sub-machine…', icon: <Layers className="w-3.5 h-3.5" />, title: 'These states into a method of their own (a sub-machine), run from a new state in their place; their transitions out its exits (Ctrl+Z undoes)', onSelect: () => handleExtractSubMachine(many) });
        items.push({ id: 'multi-snap-each-btn', label: `${groupSnapEach ? '✓ ' : ''}Snap each to the grid when moved`, icon: <Grid3x3 className="w-3.5 h-3.5" />, title: 'With snapping on: each of the selected states on the grid when they are moved together (else they keep their places to the one dragged)', onSelect: () => setGroupSnapEach(!groupSnapEach) });
        if (pouContent) items.push({ id: 'multi-copy-btn', label: `Copy the ${n} states`, icon: <ClipboardPaste className="w-3.5 h-3.5" />, title: 'Ctrl+C; then Ctrl+V pastes copies of them, the transitions between them going to the copies', onSelect: () => handleCopyState(many) });
        items.push({ id: 'multi-clear-btn', label: 'Clear the selection', icon: <X className="w-3.5 h-3.5" />, title: 'Esc', onSelect: () => setMultiSelected([]) });
      }
      // A composite's title or border: its colour
      if (target.type === 'composite') {
        // (a state drawn with its sub-machine inside: Collapse)
        const sub = subMachines.find((m) => m.parent === target.id || m.parent.replace(/[.\-\s]/g, '_') === target.id || `${m.parent.replace(/[.\-\s]/g, '_')}__${m.method}` === target.id);
        if (sub && !collapsedComposites.includes(`-${sub.parent}`)) {
          items.push({ id: 'submachine-collapse-btn', label: `Collapse sub-machine ${sub.method}`, icon: <Minimize2 className="w-3.5 h-3.5" />, title: `${sub.parent} drawn as one state again (its label says it has one)`, onSelect: () => setSubMachineExpanded(sub.parent, sub.method, false) });
          return items;
        }
        // (the name drawn: the enum's region, spaces and dots made _)
        const name = composites.find((c) => c.name === target.id || c.name.replace(/[.\-\s]/g, '_') === target.id)?.name;
        if (!name) return items;
        const own = compositeOwnColors[name];
        for (const p of COMPOSITE_PRESETS.filter((x) => x.id !== 'plain'))
          items.push({ id: `composite-color-${p.id}`, label: `${own === p.id ? '✓ ' : ''}Colour: ${p.label}`, icon: <Palette className="w-3.5 h-3.5" />, title: `// @color ${p.id} on its {region} line`, onSelect: () => handleCompositeColor(name, p.id) });
        items.push({
          id: 'composite-color-custom',
          label: `${own?.startsWith('#') ? `✓ Colour: ${own}` : 'Colour: custom'}…`,
          icon: <Palette className="w-3.5 h-3.5" />,
          onSelect: () =>
            setPromptRequest({
              title: `Colour of ${name}`,
              label: 'A colour as #rgb or #rrggbb (its border and title; a faint tint of it inside)',
              initial: own?.startsWith('#') ? own : '#7aa2c8',
              monospace: true,
              submitLabel: 'Set colour',
              validate: (v) => (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? null : 'As #rgb or #rrggbb'),
              onSubmit: (v) => handleCompositeColor(name, v.trim().toLowerCase()),
            }),
        });
        if (own) items.push({ id: 'composite-color-default', label: `The Composites colour (${compositeColor})`, icon: <X className="w-3.5 h-3.5" />, title: 'Its own colour taken out of its {region} line', onSelect: () => handleCompositeColor(name, null) });
        items.push({
          id: 'composite-relayout-btn',
          label: 'Re-layout its transitions',
          icon: <Spline className="w-3.5 h-3.5" />,
          title: 'Every transition in or out of its states (its nested composites\' too) laid out again; the states stay where they are (one Ctrl+Z puts them back)',
          onSelect: () => {
            // (its states and its nested composites' states)
            const inside = new Set([name]);
            for (let grew = true; grew; ) {
              grew = false;
              for (const c of composites) if (c.parent && inside.has(c.parent) && !inside.has(c.name)) (inside.add(c.name), (grew = true));
            }
            const states = composites.filter((c) => inside.has(c.name)).flatMap((c) => c.members);
            relayoutTransitionsOf(states, name);
          },
        });
        items.push({
          id: 'composite-collapse-btn',
          label: 'Collapse to one box',
          icon: <Minimize2 className="w-3.5 h-3.5" />,
          title: 'Drawn as one box, its transitions in and out its own (a view: the code is not changed; its menu: Expand)',
          onSelect: () => setCollapsed(name, true),
        });
        items.push({
          id: 'composite-ungroup-btn',
          label: 'Ungroup (keep its states)',
          icon: <SquareStack className="w-3.5 h-3.5" />,
          title: 'Its {region} markers taken out of the enum: its states stay, no longer in a composite (Ctrl+Z undoes)',
          onSelect: () => {
            const next = ungroupComposite(dutContent, name);
            if (!next) return showCopyToast(`${name}: its {region} was not found in the enum`, 'error');
            handleReplaceSources(null, next);
            showCopyToast(`${name} ungrouped: its states stay, in no composite (Ctrl+Z undoes)`, 'success', 6000);
          },
        });
        return items;
      }
      // A free note (from the palette): only the viewer's note items
      if (target.type === 'node' && (target.id.startsWith('note_') || target.id.startsWith('choice_'))) return items;
      // A collapsed composite: Expand (not a state of the code: no state's items)
      if (target.type === 'node' && collapsedComposites.includes(target.id)) {
        items.push({ id: 'composite-expand-btn', label: `Expand ${target.id}`, icon: <Maximize2 className="w-3.5 h-3.5" />, title: 'Drawn with its states again', onSelect: () => setCollapsed(target.id, false) });
        return items;
      }
      // A sub-machine's state (drawn inside the state that calls its method): its code is in that method
      const subStateId = target.type === 'node' ? target.id : '';
      const subState = subStateId ? subMachineId(pouContent, subStateId) : null;
      if (subState) {
        items.push({
          id: 'goto-code-btn',
          label: 'Go to code',
          icon: <Code2 className="w-3.5 h-3.5" />,
          title: `${subState.name}'s branch in ${subState.method}(), in the Method Editor`,
          onSelect: () => {
            const loc = locateState(pouContent, subStateId);
            if (!loc) return showCopyToast(`${subState.name} was not found in ${subState.method}()`, 'error');
            handleOpenInspectorPanel('method', { method: `${loc.method}()` });
            setCodeJump({ method: loc.method, line: loc.line, nonce: Date.now() });
          },
        });
        return items;
      }
      // (a state whose branch calls a method with its own state machine: shown inside it, or collapsed again)
      const subOf = target.type === 'node' ? subMachines.find((m) => m.parent === target.id) : undefined;
      if (subOf) {
        const open = !collapsedComposites.includes(`-${subOf.parent}`);
        items.push({
          id: open ? 'submachine-collapse-btn' : 'submachine-expand-btn',
          label: `${open ? 'Collapse' : 'Expand'} sub-machine ${subOf.method}`,
          icon: open ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />,
          title: open ? `${subOf.parent} drawn as one state again` : `${subOf.method}()'s states drawn inside ${subOf.parent} (it is called from its branch)`,
          onSelect: () => setSubMachineExpanded(subOf.parent, subOf.method, !open),
        });
      }
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
      // Where the state is used (its CASE label, the transitions to it, ...)
      if (target.type === 'node' && target.id !== '[*]' && knownStates.has(target.id) && pouContent) {
        items.push({ id: 'find-refs-btn', label: 'Find all references', icon: <Search className="w-3.5 h-3.5" />, title: 'Every use of the state in the POU: its CASE label, the transitions to it, …', onSelect: () => handleFindReferences(target.id) });
      }
      // A bookmark on the state
      if (target.type === 'node' && target.id !== '[*]' && knownStates.has(target.id)) {
        const on = bookmarks.states.includes(target.id);
        items.push({ id: 'bookmark-state-btn', label: on ? 'Remove bookmark' : 'Add bookmark', icon: <Bookmark className="w-3.5 h-3.5" />, title: 'Shown on the state, in Identified States and at its CASE label in the Method Editor', onSelect: () => handleToggleBookmark(target.id) });
      }
      if ((target.type === 'node' || target.type === 'canvas') && bookmarks.states.length + bookmarks.lines.length > 0)
        items.push({ id: 'bookmarks-list-btn', label: `All bookmarks (${bookmarks.states.length + bookmarks.lines.length})…`, icon: <Bookmark className="w-3.5 h-3.5" />, onSelect: () => setBookmarksOpen(true) });
      // A state's code (its CASE branch, as written)
      if (target.type === 'node' && pouContent && target.id !== '[*]' && knownStates.has(target.id)) {
        const whole = readStateCode(pouContent, target.id);
        if (Array.isArray(whole)) {
          const n = whole.filter((l) => l.trim()).length;
          items.push({ id: 'edit-state-code-btn', label: `Edit the state's code…${n ? ` (${n} line${n === 1 ? '' : 's'})` : ''}`, icon: <Code2 className="w-3.5 h-3.5" />, title: "Its CASE branch in doState(), as written: actions and transitions", onSelect: () => handleEditStateCode(target.id) });
        }
      }
      // Learned: what changed just before a transition seen, offered as its condition (drawn instead of an unknown one;
      // idTag: the transition's, in a state's menu)
      const conditionItems = (from: string, to: string, idTag = '') => {
        const seenHere = seen[seenKey(from, to)];
        if (!learnedPou || !seenHere) return;
        const instance = (liveStatus.instance ?? windowInstance ?? '').toLowerCase();
        const nameOf = (id: string) => {
          if (!id.startsWith('sym:')) return id;
          const p = id.slice(4);
          return instance && p.startsWith(`${instance}.`) ? p.slice(instance.length + 1) : p;
        };
        const setCondition = (c: string | null) => {
          const next = setSeenCondition(seen, from, to, c);
          saveSeen(seenPouType, next);
          setSeen(next);
        };
        const where = idTag ? ` (→ ${to})` : '';
        candidatesOf(seenHere).forEach((c, i) => {
          const name = nameOf(c.id);
          if (!/^[A-Za-z_][\w.[\]]*$/.test(name) || seenHere.condition === name) return;
          items.push({ id: `use-candidate-${idTag}${i}-btn`, label: `Its condition${where}: ${name}`, icon: <Pencil className="w-3.5 h-3.5" />, title: `${name} changed just before ${from} → ${to} ${c.n} of the ${seenHere.n} times it was seen: drawn as IF ${name} THEN (kept with the transitions seen)`, onSelect: () => setCondition(name) });
        });
        if (seenHere.condition)
          items.push({ id: `clear-candidate-${idTag}btn`, label: `Its condition${where}: not known`, icon: <Pencil className="w-3.5 h-3.5" />, title: `${seenHere.condition} no longer taken as the condition of ${from} → ${to}`, onSelect: () => setCondition(null) });
      };
      // A learned diagram: each transition seen from the state can be forgotten (seen by mistake)
      if (target.type === 'node' && learnedPou)
        for (const [k, s] of Object.entries(seen)) {
          const [from, to] = k.split('->');
          if (from !== target.id) continue;
          conditionItems(from, to, `${to}-`);
          items.push({
            id: `forget-seen-${to}-btn`,
            label: `Forget ${from} → ${to} (seen ${s.n}×)`,
            icon: <Trash2 className="w-3.5 h-3.5" />,
            title: 'Seen by mistake (a test, a manual jump): taken out of what was seen on the PLC',
            onSelect: () =>
              setSeen((cur) => {
                const next = forgetSeen(cur, from, to);
                saveSeen(seenPouType, next);
                return next;
              }),
          });
        }
      // The canvas: Undo / Redo of the edits (the POU, the enum, the states' moves), as Ctrl+Z / Ctrl+Y
      if (target.type === 'canvas') {
        if (historyState.canUndo) items.push({ id: 'undo-btn', label: 'Undo', icon: <Undo2 className="w-3.5 h-3.5" />, title: 'Ctrl+Z: the last edit (of the code, the enum, or a move on the canvas)', onSelect: () => stepHistory(true) });
        if (historyState.canRedo) items.push({ id: 'redo-btn', label: 'Redo', icon: <Redo2 className="w-3.5 h-3.5" />, title: 'Ctrl+Y: the edit undone last', onSelect: () => stepHistory(false) });
      }
      // Tidy up the edges (the states left where they are)
      if (target.type === 'canvas')
        items.push({
          id: 'tidy-edges-btn',
          label: 'Tidy up edges',
          icon: <Spline className="w-3.5 h-3.5" />,
          title: "The states left where they are: each edge's own route (waypoints, moved ends, a moved label) dropped and the edge drawn again from its states",
          onSelect: () => {
            const n = mermaidViewerRef.current?.tidyEdges() ?? 0;
            showCopyToast(n ? `Edges tidied up: ${n} drawn again from their states` : 'Edges tidied up (none had a route of its own)', 'success');
          },
        });
      // Right-clicking the empty canvas with a state selected opens the state's menu: Add state is there too
      if ((target.type === 'canvas' || target.type === 'node') && pouContent) {
        items.push({ id: 'add-state-btn', label: 'Add state…', icon: <SquarePlus className="w-3.5 h-3.5" />, onSelect: handleAddState });
        if (copiedStateRef.current?.length)
          items.push({
            id: 'paste-state-btn',
            label: copiedStateRef.current.length > 1 ? `Paste copies of ${copiedStateRef.current.length} states` : `Paste a copy of ${copiedStateRef.current[0]}`,
            icon: <ClipboardPaste className="w-3.5 h-3.5" />,
            title: copiedStateRef.current.length > 1 ? `Ctrl+V: new states with their code (${copiedStateRef.current.join(', ')}), the transitions between them going to the copies` : 'Ctrl+V: a new state with its code',
            onSelect: handlePasteState,
          });
      }
      // The composites the chart used to find on its own (the state names, TwinCAT's UML chart): written as markers
      if (target.type === 'canvas' && pouContent && dutContent.trim() && pendingComposites.length)
        items.push({
          id: 'write-composite-markers-btn',
          label: `Write these composites as markers (${pendingComposites.length})`,
          icon: <SquareStack className="w-3.5 h-3.5" />,
          title: `Composites come only from {region} markers in the enum now: ${pendingComposites.join(', ')} written around their states`,
          onSelect: handleWriteCompositeMarkers,
        });
      // A transition's priority (its order in the state's doState() branch, or in preProcess())
      if (target.type === 'edge' && pouContent) {
        const edge = availableEdges.find((e) => e.id === target.id) ?? { id: target.id, from: target.from, to: target.to, label: target.label };
        // Go to code: its condition where it is, in doState() or preProcess(); a sub-machine's entry: where its start is set
        if (edge.from !== '[*]' || subMachineId(pouContent, edge.to))
          items.push({ id: 'goto-code-btn', label: 'Go to code', icon: <Code2 className="w-3.5 h-3.5" />, title: `Its condition in ${subMachineId(pouContent, currentEdge(edge).to) ? `${subMachineId(pouContent, currentEdge(edge).to)!.method}()` : edge.from === 'AnyState' || /^\[preProcess\]/i.test(edge.label ?? '') ? 'preProcess()' : 'doState()'}, in the Method Editor`, onSelect: () => handleGoToEdgeCode(edge) });
        // (a choice's arm: its state's order)
        const real = currentEdge(edge);
        const subReal = subEdgeOf(real);
        const order = subReal ? transitionOrder(pouContent, subReal.ref, subReal.variable, subReal.method) : transitionOrder(pouContent, real, varFor(real.from));
        if (!('error' in order) && order.count > 1) {
          const pre = order.method === 'preProcess';
          const where = pre ? 'preProcess()' : `${real.from}`;
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
                title: `Priority of ${real.from} → ${real.to}`,
                label: `1 is checked first. The transitions of ${where} now: ${order.targets.map((t, i) => `${i + 1} ${t}`).join(', ')}`,
                initial: String(order.priority),
                monospace: true,
                submitLabel: 'Set priority',
                validate: (v) => (/^\d+$/.test(v.trim()) && +v >= 1 && +v <= order.count ? null : `A number from 1 to ${order.count}`),
                onSubmit: (v) => handleTransitionPriority(edge, +v),
              }),
          });
        }
        if (learnedPou && seen[seenKey(edge.from, edge.to)])
          items.push({
            id: 'forget-seen-btn',
            label: 'Forget this transition',
            icon: <Trash2 className="w-3.5 h-3.5" />,
            title: `Seen by mistake (a test, a manual jump): ${edge.from} → ${edge.to} taken out of what was seen on the PLC`,
            onSelect: () =>
              setSeen((s) => {
                const next = forgetSeen(s, edge.from, edge.to);
                saveSeen(seenPouType, next);
                return next;
              }),
          });
        // Learned: what changed just before it, offered as its condition
        conditionItems(edge.from, edge.to);
        if (edge.from !== '[*]' && !learnedPou)
          items.push({ id: 'edit-condition-btn', label: 'Edit condition…', icon: <Pencil className="w-3.5 h-3.5" />, title: 'F2: its condition, with the variables of the POU', onSelect: () => handleEditCondition(edge) });
        if (edge.from !== '[*]' && !learnedPou) {
          if (!armState(drawnEdge(edge).from))
            items.push({ id: 'move-start-btn', label: 'Move start to…', icon: <ArrowRightLeft className="w-3.5 h-3.5" />, title: 'Another state it starts from (as dragging its start): its code moved to that state', onSelect: () => setEndPicker({ edge, end: 'start' }) });
          items.push({ id: 'move-end-btn', label: 'Move end to…', icon: <ArrowRightLeft className="w-3.5 h-3.5" />, title: 'Another state it goes to (as dragging its end)', onSelect: () => setEndPicker({ edge, end: 'end' }) });
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
    [findPathsFor, groupSnapEach, setGroupSnapEach, pouContent, dutContent, handleRenameState, handleAddState, machineMembers, availableEdges, handleOpenReferenced, stateVarName, handleTransitionPriority, handleCopyState, handlePasteState, handleDeleteState, handleDeleteTransition, knownStates, handleSetInitial, handleToggleFinal, handleMoveToComposite, compositeOfState, handleSetCompositeInitial, isFinal, handleAddStateFrom, handleEditCondition, bookmarks, handleToggleBookmark, handleFindReferences, multiSelected, seen, learnedPou, seenPouType, liveStatus.instance, windowInstance, drawnEdge, composites, compositeOwnColors, compositeColor, handleCompositeColor, pendingComposites, handleWriteCompositeMarkers, historyState, stepHistory, collapsedComposites, setCollapsed, subMachines, setSubMachineExpanded, currentEdge, handleOpenInspectorPanel, showCopyToast]
  );
  // Go to Symbol: the project's types and GVL variables, this POU's methods, members and states
  const symbolCommands = (): PaletteCommand[] => {
    const cmds: PaletteCommand[] = [];
    const current = pouFileName.replace(/\.TcPOU$/i, '').toLowerCase();
    const kindName: Record<string, string> = { FUNCTION_BLOCK: 'FB', PROGRAM: 'Program', FUNCTION: 'Function', INTERFACE: 'Interface', STRUCT: 'Struct', UNION: 'Union', ENUM: 'Enum', ALIAS: 'Alias', GVL: 'GVL' };
    for (const st of identifiedStatesResult.states) cmds.push({ id: `sym-state:${st.id}`, group: 'State', label: st.id, hint: st.label && st.label !== st.id ? st.label : undefined, run: () => handleJumpToState(st.id) });
    for (const m of pouContent ? getAllMethodsFromPou(pouContent) : []) cmds.push({ id: `sym-method:${m}`, group: 'Method', label: `${m}()`, run: () => handleOpenInspectorPanel('method', { method: `${m}()` }) });
    // (a property: its Get / Set, opened in the Method Editor)
    for (const a of pouContent ? getActionsFromPou(pouContent) : []) cmds.push({ id: `sym-action:${a}`, group: 'Action', label: a, hint: 'action', run: () => handleOpenInspectorPanel('method', { method: `${a}()` }) });
    for (const p of pouContent ? getPropertyAccessorsFromPou(pouContent) : []) cmds.push({ id: `sym-property:${p.name}`, group: 'Property', label: p.name, hint: p.type || undefined, run: () => handleOpenInspectorPanel('method', { method: `${p.name}()` }) });
    for (const v of pouContent ? declarationVariables(extractPouDeclaration(pouContent)) : [])
      cmds.push({ id: `sym-member:${v.name}`, group: 'Member', label: v.name, hint: `${v.type} · ${v.scope}`, run: () => { setDockLayout((l) => activateDockTab(l, 'pou')); setPouReveal({ symbol: v.name, nonce: Date.now() }); } });
    for (const tp of getProjectSymbols()?.types.values() ?? []) {
      if (tp.name.toLowerCase() === current) continue;
      const kind = kindName[tp.kind] ?? tp.kind;
      const pou = ['FUNCTION_BLOCK', 'PROGRAM', 'FUNCTION'].includes(tp.kind);
      cmds.push({
        id: `sym-type:${tp.name}`,
        group: kind,
        label: tp.name,
        hint: pou ? 'open in MachineScope' : isXaeHost() ? 'open in the TwinCAT editor' : undefined,
        run: () => (pou ? void handleOpenType(tp.name, 'machinescope') : isXaeHost() ? void handleOpenType(tp.name, 'xae') : showCopyToast(`${tp.name} is a ${kind}: MachineScope opens POUs`, 'error')),
      });
      if (tp.kind === 'GVL')
        for (const m of tp.members)
          cmds.push({ id: `sym-gvl:${tp.name}.${m.name}`, group: 'Global', label: `${tp.name}.${m.name}`, hint: m.type, run: () => (isXaeHost() ? postToHost({ type: 'openInXae', typeName: tp.name, ...(m.line ? { line: m.line, text: m.text } : {}) }) : showCopyToast(`${tp.name}.${m.name} : ${m.type}${m.comment ? ` (${m.comment})` : ''}`, 'success', 5000)) });
    }
    return cmds;
  };
  // The command palette's commands: tabs, states, methods, the selected state's and the canvas's menus, options
  const paletteCommands = (): PaletteCommand[] => {
    const cmds: PaletteCommand[] = [];
    const menu = (target: ContextMenuTarget, group: string) =>
      diagramContextMenuItems(target).forEach((it) => cmds.push({ id: `${group}:${it.id}`, group, label: it.label, run: it.onSelect }));
    if (selectedStateId && selectedStateId !== '[*]') menu({ type: 'node', id: selectedStateId, label: selectedStateLabel || selectedStateId } as ContextMenuTarget, 'Selected');
    document.querySelectorAll<HTMLElement>('button[id^="dock-tab-"]').forEach((el) => {
      const label = el.textContent?.replace(/\s+/g, ' ').trim();
      if (label && label.length < 40) cmds.push({ id: `tab:${el.id}`, group: 'Tab', label: `Show ${label}`, run: () => el.click() });
    });
    for (const st of identifiedStatesResult.states) cmds.push({ id: `state:${st.id}`, group: 'State', label: `Go to ${st.id}`, hint: st.label && st.label !== st.id ? st.label : undefined, run: () => handleJumpToState(st.id) });
    for (const m of pouContent ? getAllMethodsFromPou(pouContent) : []) cmds.push({ id: `method:${m}`, group: 'Method', label: `Open ${m}()`, run: () => handleOpenInspectorPanel('method', { method: `${m}()` }) });
    menu({ type: 'canvas' } as ContextMenuTarget, 'Canvas');
    const toggle = (id: string, label: string, on: boolean, set: (v: boolean) => void) => cmds.push({ id: `view:${id}`, group: 'View', label: `${on ? 'Hide' : 'Show'} ${label}`, run: () => set(!on) });
    toggle('descriptions', 'state descriptions', includeStateDescriptions, setIncludeStateDescriptions);
    toggle('priorities', 'transition priorities', showTransitionPriorities, setShowTransitionPriorities);
    cmds.push({ id: 'view:engine', group: 'View', label: `Layout engine: ${layoutEngine === 'elk' ? 'Dagre' : 'ELK'}`, run: () => setLayoutEngine(layoutEngine === 'elk' ? 'dagre' : 'elk') });
    cmds.push({ id: 'app:save', group: 'File', label: 'Save to project', hint: 'Ctrl+S', run: () => handleSaveToProjectRef.current() });
    cmds.push({ id: 'app:undo', group: 'Edit', label: 'Undo', hint: 'Ctrl+Z', run: () => stepHistory(true) });
    cmds.push({ id: 'app:tidy-edges', group: 'Canvas', label: 'Tidy up edges', hint: 'the states stay: the edges drawn again from them', run: () => { const n = mermaidViewerRef.current?.tidyEdges() ?? 0; showCopyToast(n ? `Edges tidied up: ${n} drawn again from their states` : 'Edges tidied up (none had a route of its own)', 'success'); } });
    cmds.push({ id: 'app:diff-all', group: 'Edit', label: 'All changes (Diff)', hint: "every editor's edits and the files' since saved", run: () => showDiff({ source: 'all' }) });
    cmds.push({ id: 'app:redo', group: 'Edit', label: 'Redo', hint: 'Ctrl+Y', run: () => stepHistory(false) });
    cmds.push({ id: 'app:bookmarks', group: 'Bookmarks', label: 'Show all bookmarks', run: () => setBookmarksOpen(true) });
    cmds.push({ id: 'app:shortcuts', group: 'Help', label: 'Keyboard shortcuts', hint: '?', run: () => setShortcutsOpen(true) });
    cmds.push({ id: 'app:symbol', group: 'Go', label: 'Go to symbol…', hint: 'Ctrl+Shift+O', run: () => setSymbolSearchOpen(true) });
    cmds.push({
      id: 'app:snippets',
      group: 'Edit',
      label: 'Edit snippets…',
      run: () =>
        setPromptRequest({
          title: 'Your snippets',
          label: `A snippet: its key on a line of its own ("key // what it is"), its code below it indented by 4 spaces; $1 is where the caret goes. In a code editor, the key and Tab put it in. Yours come before the built-in ones (${BUILTIN_SNIPPETS.map((s) => s.key).join(', ')}).`,
          initial: userSnippets().length ? snippetsToText(userSnippets()) : 'fbCall // an example\n    fbX(bExecute := $1);\n    IF fbX.bDone THEN\n    \t\n    END_IF',
          monospace: true,
          multiline: true,
          submitLabel: 'Keep',
          validate: (v) => {
            const r = snippetsFromText(v);
            return typeof r === 'string' ? r : null;
          },
          onSubmit: (v) => {
            const r = snippetsFromText(v);
            if (typeof r === 'string') return;
            setUserSnippets(r);
            showCopyToast(`${r.length} snippet${r.length === 1 ? '' : 's'} kept`, 'success');
          },
        }),
    });
    cmds.push({
      id: 'app:snippets-export',
      group: 'Edit',
      label: 'Export snippets to a file…',
      run: () => {
        const mine = userSnippets();
        if (!mine.length) {
          showCopyToast('No snippets of yours to export (Edit snippets… makes them)', 'error');
          return;
        }
        void saveDocument('snippets.kss-snippets.json', snippetsToFile(mine));
      },
    });
    cmds.push({
      id: 'app:snippets-import',
      group: 'Edit',
      label: 'Import snippets from a file…',
      run: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.id = 'snippets-import-input';
        input.style.display = 'none';
        input.onchange = async () => {
          const file = input.files?.[0];
          input.remove();
          if (!file) return;
          const r = snippetsFromFile(await file.text());
          if (typeof r === 'string') {
            showCopyToast(`${file.name}: ${r}`, 'error');
            return;
          }
          const m = mergeSnippets(userSnippets(), r);
          setUserSnippets(m.list);
          showCopyToast(`${file.name}: ${m.added} snippet${m.added === 1 ? '' : 's'} added${m.replaced ? `, ${m.replaced} replaced` : ''}`, 'success');
        };
        document.body.appendChild(input);
        input.click();
      },
    });
    return cmds;
  };
  // "Open code" outside XAE: the Method Editor opens the method at the line (a new request each click)
  const [codeJump, setCodeJump] = useState<{ method: string; line: number; nonce: number; part?: 'declaration' } | null>(null);
  // The state at the Method or Enum Editor's caret: the other editor and Identified States show it; with the editor's
  // Follow on, the canvas selects it and pans to it too
  const [codeFocus, setCodeFocus] = useState<CodeFocus | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const f = (e as CustomEvent<CodeFocus>).detail;
      if (!f?.state) return;
      setCodeFocus(f);
      // (the canvas selects it, always; it pans there only with the editor's Follow on)
      setSelectedStateId(f.state);
      setSelectedStateLabel(f.state);
      if (f.follow) mermaidViewerRef.current?.panToState(f.state, Date.now());
    };
    window.addEventListener(CODE_FOCUS_EVENT, on);
    return () => window.removeEventListener(CODE_FOCUS_EVENT, on);
  }, []);
  // Another state selected (the canvas, Identified States): the editors' caret state is no longer the one shown
  useEffect(() => {
    setCodeFocus((f) => (f && f.state !== selectedStateId ? null : f));
  }, [selectedStateId]);
  const handleLintGoToCode = useCallback(
    (finding: LintFinding) => {
      // (a build's message: opened as the build dialog opens it)
      const built = buildItemsRef.current.get(finding.key);
      if (built) return void openPlcBuildItem(built);
      if (!finding.method || !finding.line) return;
      if (finding.stateId) handleJumpToState(finding.stateId);
      if (canNavigateInXae && pouPath) {
        postToHost({ type: 'navigate', path: pouPath, method: finding.method, line: finding.line, text: finding.text });
      } else {
        handleOpenInspectorPanel('method', { method: finding.method });
        setCodeJump({ method: finding.method, line: finding.line, nonce: Date.now() });
      }
    },
    [canNavigateInXae, pouPath, handleJumpToState, handleOpenInspectorPanel, openPlcBuildItem]
  );
  // The Problems tab's quick fixes for variables: Declare… (its method, or the POU), Remove (after a look)
  const [declareFix, setDeclareFix] = useState<{ name: string; method?: string } | null>(null);
  const handleLintFix = useCallback(
    (finding: LintFinding) => {
      const fix = finding.fix;
      if (!fix) return;
      if (fix.kind === 'declare-variable') {
        setDeclareFix({ name: fix.name, method: fix.method });
        return;
      }
      if (fix.kind === 'insert-call') {
        const c = plannedCall(pouContent, fix.name, fix.type);
        if (!c) return showCopyToast(`No use of ${fix.name} found in a method`, 'error');
        const m = getMethodCodeFromPou(pouContent, c.method);
        setPromptRequest({
          title: `Call ${fix.name}?`,
          label: `This call goes into ${c.method}() before line ${c.line}, its first use. Set its inputs (IN, PT, ...) to what they should be:`,
          details: [c.text.trim()],
          confirmOnly: true,
          submitLabel: 'Insert call',
          onSubmit: () => {
            const eol = m.code.includes('\r\n') ? '\r\n' : '\n';
            const lines = m.code.split(/\r?\n/);
            lines.splice(c.line - 1, 0, c.text);
            const res = handleSaveMethodCode(c.method, lines.join(eol));
            if (!res?.success) return showCopyToast(res?.error || 'Could not change the method', 'error');
            showCopyToast(`Inserted ${fix.name}(...) in ${c.method}() line ${c.line}: set its inputs`, 'success', 6000);
            setCodeJump({ method: c.method, line: c.line, nonce: Date.now() });
          },
        });
        return;
      }
      if (fix.kind === 'add-else') {
        const m = getMethodCodeFromPou(pouContent, fix.method);
        const lines = m.code.split(/\r?\n/);
        const end = fix.line - 1;
        if (!/^\s*END_CASE\b/i.test(lines[end] ?? '')) return showCopyToast('END_CASE was not found where it was: check the Problems again', 'error');
        const caseIndent = lines[end].match(/^[ \t]*/)![0];
        // (the ELSE at the labels' indentation: the first label after CASE ... OF)
        const labelLine = lines.slice(0, end).reverse().find((l) => /^\s*(?:[A-Za-z_][\w.]*|\d+)(?:\s*,\s*(?:[A-Za-z_][\w.]*|\d+))*\s*:(?!=)/.test(l));
        const labelIndent = labelLine ? labelLine.match(/^[ \t]*/)![0] : `${caseIndent}\t`;
        const added = [`${labelIndent}ELSE`, `${labelIndent}\t// a value of ${fix.name} not listed above`, `${labelIndent}\t;`];
        setPromptRequest({
          title: `Add an ELSE branch to CASE ${fix.name} OF?`,
          label: `In ${fix.method}(), before its END_CASE (line ${fix.line}):`,
          details: added.map((l) => l.trim()),
          confirmOnly: true,
          submitLabel: 'Add ELSE',
          onSubmit: () => {
            const eol = m.code.includes('\r\n') ? '\r\n' : '\n';
            lines.splice(end, 0, ...added);
            const res = handleSaveMethodCode(fix.method, lines.join(eol));
            if (!res?.success) return showCopyToast(res?.error || 'Could not change the method', 'error');
            showCopyToast(`ELSE added to CASE ${fix.name} OF in ${fix.method}()`, 'success');
            setCodeJump({ method: fix.method, line: end + 2, nonce: Date.now() });
          },
        });
        return;
      }
      if (fix.kind === 'remove-method') {
        const rx = new RegExp(`[ \\t]*<Method\\b[^>]*\\bName="${fix.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>[\\s\\S]*?<\\/Method>[ \\t]*\\r?\\n?`, 'i');
        const m = pouContent.match(rx);
        if (!m) return showCopyToast(`${fix.name}() was not found`, 'error');
        const code = getMethodCodeFromPou(pouContent, fix.name);
        setPromptRequest({
          title: `Remove ${fix.name}()?`,
          label: `Nothing in the POU calls it (it is PRIVATE). Its declaration and code (${(code.code ?? '').split(/\r?\n/).filter((l) => l.trim()).length} lines) go:`,
          details: [(code.declaration ?? '').split(/\r?\n/)[0] ?? `METHOD ${fix.name}`, ...(code.code ?? '').split(/\r?\n/).filter((l) => l.trim()).slice(0, 8), ...((code.code ?? '').split(/\r?\n/).filter((l) => l.trim()).length > 8 ? ['…'] : [])],
          confirmOnly: true,
          danger: true,
          submitLabel: 'Remove',
          onSubmit: () => {
            handleReplaceSources(pouContent.replace(rx, ''), null);
            showCopyToast(`Removed ${fix.name}() (Ctrl+Z brings it back)`, 'success');
          },
        });
        return;
      }
      if (fix.kind === 'add-pt') {
        const m = getMethodCodeFromPou(pouContent, fix.method);
        const lines = m.code.split(/\r?\n/);
        const i = fix.line - 1;
        const rx = new RegExp(`(\\b${fix.name}\\s*\\()(\\s*\\))?`, 'i');
        if (!rx.test(lines[i] ?? '')) return showCopyToast(`${fix.name}'s call was not found where it was: check the Problems again`, 'error');
        const changed = (lines[i] ?? '').replace(rx, (_all, open: string, empty?: string) => (empty ? `${open}PT := T#1S)` : `${open}PT := T#1S, `));
        setPromptRequest({
          title: `Give ${fix.name} its time?`,
          label: `In ${fix.method}(), line ${fix.line}: PT := T#1S (change it to the time it should run):`,
          details: [changed.trim()],
          confirmOnly: true,
          submitLabel: 'Add PT',
          onSubmit: () => {
            const eol = m.code.includes('\r\n') ? '\r\n' : '\n';
            lines[i] = changed;
            const res = handleSaveMethodCode(fix.method, lines.join(eol));
            if (!res?.success) return showCopyToast(res?.error || 'Could not change the method', 'error');
            showCopyToast(`${fix.name} is given PT := T#1S in ${fix.method}()`, 'success');
            setCodeJump({ method: fix.method, line: fix.line, nonce: Date.now() });
          },
        });
        return;
      }
      if (fix.kind === 'add-description') {
        const m = getMethodCodeFromPou(pouContent, 'getStateDescription');
        if (!m.methodFound) return showCopyToast('The POU has no getStateDescription()', 'error');
        const lines = m.code.split(/\r?\n/);
        // (like the other lines: their indentation and qualifier; the text from the state's name)
        const sample = lines.find((l) => /^\s*[A-Za-z_][\w.]*\s*:(?!=)\s*getStateDescription\s*:=/i.test(l)) ?? lines.find((l) => /^\s*[A-Za-z_][\w.]*\s*:(?!=)/.test(l)) ?? '\t';
        const indent = sample.match(/^[ \t]*/)![0];
        const qualifier = sample.trim().match(/^([A-Za-z_]\w*\.)/)?.[1] ?? '';
        const names = [...knownStates];
        let prefix = names.length > 1 ? names.reduce((p, n) => { let k = 0; while (k < p.length && p[k] === n[k]) k++; return p.slice(0, k); }) : '';
        prefix = prefix.slice(0, prefix.lastIndexOf('_') + 1);
        const text = fix.name.slice(prefix.length).split('_').filter(Boolean).map((w) => w[0] + w.slice(1).toLowerCase()).join(' ') || fix.name;
        const added = `${indent}${qualifier}${fix.name}: getStateDescription := '${text}';`;
        // Before the CASE's ELSE, else its END_CASE
        let at = lines.findIndex((l) => /^\s*ELSE\b/i.test(l));
        if (at < 0) at = lines.findIndex((l) => /^\s*END_CASE\b/i.test(l));
        if (at < 0) return showCopyToast('getStateDescription() has no CASE to add it to', 'error');
        setPromptRequest({
          title: `Describe ${fix.name}?`,
          label: 'In getStateDescription() (change the text as you like):',
          details: [added.trim()],
          confirmOnly: true,
          submitLabel: 'Add description',
          onSubmit: () => {
            const eol = m.code.includes('\r\n') ? '\r\n' : '\n';
            lines.splice(at, 0, added);
            const res = handleSaveMethodCode('getStateDescription', lines.join(eol));
            if (!res?.success) return showCopyToast(res?.error || 'Could not change the method', 'error');
            showCopyToast(`${fix.name}: described as '${text}'`, 'success');
          },
        });
        return;
      }
      if (fix.kind === 'delete-state') {
        handleDeleteState(fix.name);
        return;
      }
      if (fix.kind === 'remove-enum-member') {
        if (!dutContent.trim()) return showCopyToast('No .TcDUT loaded', 'error');
        const r = removeEnumMember(dutContent, fix.name);
        if (!r) return showCopyToast(`${fix.name} was not found in the enum`, 'error');
        setPromptRequest({
          title: `Remove ${fix.name} from the enum?`,
          label: 'Nothing in the POU uses it. Members after it get new values when they have none of their own.',
          details: [fix.name],
          confirmOnly: true,
          danger: true,
          submitLabel: 'Remove',
          onSubmit: () => {
            handleReplaceSources(null, r.dut);
            showCopyToast(`Removed ${fix.name} from the enum`, 'success');
          },
        });
        return;
      }
      if (fix.kind === 'remove-lines' && fix.method) {
        const m = getMethodCodeFromPou(pouContent, fix.method);
        const range = fix.count ? { start: fix.line, end: fix.line + fix.count - 1 } : deadLines(m.code, fix.line);
        const lines = m.code.split(/\r?\n/);
        const gone = lines.slice(range.start - 1, range.end);
        setPromptRequest({
          title: fix.count ? `Remove ${fix.name}?` : `Remove ${gone.length} line${gone.length === 1 ? '' : 's'} that never run?`,
          label: fix.count ? `In ${fix.method}(), line${gone.length === 1 ? ` ${range.start}` : `s ${range.start}–${range.end}`} (it does nothing):` : `In ${fix.method}(), lines ${range.start}–${range.end} (after a RETURN, to the end of their block):`,
          details: gone.map((l) => l.trim()).filter(Boolean),
          confirmOnly: true,
          danger: true,
          submitLabel: 'Remove',
          onSubmit: () => {
            const eol = m.code.includes('\r\n') ? '\r\n' : '\n';
            lines.splice(range.start - 1, range.end - range.start + 1);
            const res = handleSaveMethodCode(fix.method!, lines.join(eol));
            if (!res?.success) return showCopyToast(res?.error || 'Could not change the method', 'error');
            showCopyToast(`Removed ${gone.length} line${gone.length === 1 ? '' : 's'} of ${fix.method}()`, 'success');
          },
        });
        return;
      }
      if (fix.kind === 'remove-variable') {
        const m = fix.method ? getMethodCodeFromPou(pouContent, fix.method) : null;
        const decl = m ? m.declaration || '' : extractPouDeclaration(pouContent);
        const r = removeFromDeclaration(decl, fix.name);
        if (!r) return showCopyToast(`${fix.name} was not found in the declaration`, 'error');
        setPromptRequest({
          title: `Remove ${fix.name}?`,
          label: `Its declaration in ${fix.method ? `${fix.method}()` : 'the POU'} is removed (Save writes it to the project):`,
          details: [r.removed],
          confirmOnly: true,
          danger: true,
          submitLabel: 'Remove',
          onSubmit: () => {
            if (fix.method && m) {
              const res = handleSaveMethodCode(fix.method, m.code, r.declaration);
              if (!res?.success) return showCopyToast(res?.error || 'Could not change the method', 'error');
            } else {
              const u = updatePouBody(pouContent, r.declaration, null);
              if (!u.success) return showCopyToast(u.error || 'Could not change the declaration', 'error');
              handleReplaceSources(u.updatedPou, null);
            }
            showCopyToast(`Removed ${fix.name}`, 'success');
          },
        });
        return;
      }
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
    [dutContent, dutFileName, pouContent, handleSaveDutContent, handleSaveMethodCode, showCopyToast, handleReplaceSources, handleDeleteState, knownStates]
  );

  // Live view controls (the handlers for the host's messages are above, next to the other host handlers)
  const liveSettingsKey = `kss.live.${pouFileName || 'POU'}`;
  const [storedLiveSettings, setLiveSettings] = useState<LiveSettings>(DEFAULT_LIVE_SETTINGS);
  // The key whose saved settings are in state (auto go-live waits for them)
  const [liveSettingsLoadedKey, setLiveSettingsLoadedKey] = useState<string | null>(null);
  // The project's connection (the last one used with any of its POUs): a POU of it without its own settings starts
  // with it
  const liveProject = (projectFiles ?? plcCodeFiles)?.project ?? '';
  const liveProjectKey = liveProject ? `kss.live.project.${liveProject}` : '';
  useEffect(() => {
    try {
      const raw = localStorage.getItem(liveSettingsKey);
      const ofProject = !raw && liveProjectKey ? localStorage.getItem(liveProjectKey) : null;
      const loaded: LiveSettings = raw
        ? { ...DEFAULT_LIVE_SETTINGS, ...(JSON.parse(raw) as Partial<LiveSettings>) }
        : ofProject
          ? { ...DEFAULT_LIVE_SETTINGS, ...connectionOf(JSON.parse(ofProject) as Record<string, string>) }
          : DEFAULT_LIVE_SETTINGS;
      // A POU without a target starts with the last remembered PLC (XAE: empty is the project's target, kept so)
      const last = !loaded.netId && !isXaeHost() ? loadRememberedPlcs()[0] : undefined;
      setLiveSettings(last ? { ...loaded, netId: last.netId, ip: last.ip, port: last.port, localNetId: last.localNetId } : loaded);
    } catch {
      setLiveSettings(DEFAULT_LIVE_SETTINGS);
    }
    setLiveSettingsLoadedKey(liveSettingsKey);
  }, [liveSettingsKey, liveProjectKey]);
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
        if (liveProjectKey) localStorage.setItem(liveProjectKey, JSON.stringify(connectionOf(toStore)));
      } catch {
        // per-viewer convenience only
      }
    },
    [liveSettingsKey, liveProjectKey, windowInstance, storedLiveSettings.instance]
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
      else if (m.type === 'plcBuildProgress') setPlcBuild((b) => (b && b.phase !== 'done' ? { ...b, step: String(m.text ?? '') } : b));
    });
  }, [handleLiveStatus, handleLiveValues, handleLiveWatchResult, handleLiveVars, handleLiveBrowseResult]);
  // Web edition: through a Kval MachineScope gateway on the PLC network (by default the one serving this page)
  const liveMode: 'xae' | 'desktop' | 'web' | null = canNavigateInXae ? 'xae' : isXaeHost() ? null : desktopLive() ? 'desktop' : 'web';
  const [gatewayOrigin, setGatewayOrigin] = useState<string | null>(null);
  // (known: whether a gateway serves this page, and then whether it signs in with company accounts; a page opened to
  // go live waits for it, else it would go live without its gateway on a slow start)
  const [gatewayKnown, setGatewayKnown] = useState(false);
  useEffect(() => {
    if (liveMode !== 'web') return;
    void detectGatewayOrigin().then((origin) => {
      setGatewayOrigin(origin);
      if (!origin) setGatewayKnown(true);
    });
  }, [liveMode]);
  const [gatewayToken, setGatewayToken, rememberGatewayToken, setRememberGatewayToken] = useStoredSecret('kss.gateway.token');
  // Sign-in with company accounts on the gateway serving this page (its session cookie is this site's)
  const [gatewaySso, setGatewaySso] = useState<GatewaySso | null>(null);
  useEffect(() => {
    if (liveMode === 'web' && gatewayOrigin)
      void fetchGatewaySso(gatewayOrigin)
        .then(setGatewaySso)
        .finally(() => setGatewayKnown(true));
  }, [liveMode, gatewayOrigin]);
  const ssoHere = !!gatewaySso?.sso && !!gatewayOrigin && (!liveSettings.gateway || gatewaySocketUrl(liveSettings.gateway) === gatewaySocketUrl(gatewayOrigin));
  const ssoUser = ssoHere ? gatewaySso?.user ?? null : null;
  const [linkCode, setLinkCode, rememberLinkCode, setRememberLinkCode] = useStoredSecret('kss.link.code');
  // Through the gateway when this page is served by one, else through the helper on this computer
  const liveVia: 'link' | 'gateway' = liveSettings.via || (gatewayOrigin ? 'gateway' : 'link');
  const gatewayRef = useRef<GatewayConnection | null>(null);
  const linkBuildRef = useRef<HelperBuild | null>(null);
  // What the gateway can do beyond going live (its welcome: projectBuild, plcStart, ...)
  const [gatewayFeatures, setGatewayFeatures] = useState<string[]>([]);
  // (for the callbacks declared before them)
  const gatewayFeaturesRef = useRef(gatewayFeatures);
  gatewayFeaturesRef.current = gatewayFeatures;
  const gatewayRequestRef = useRef<<T>(message: Record<string, unknown>, replyType: string) => Promise<T>>(() => Promise.reject(new Error('Not connected')));
  // (a token tried once each: a gateway blocks an address after 10 failed attempts in a minute)
  const gatewayTriedRef = useRef(new Set<string>());
  const gatewayConnection = useCallback(() => {
    gatewayRef.current ??= new GatewayConnection((m) => {
      if (m.type === 'liveStatus') handleLiveStatus(m);
      else if (m.type === 'liveValues') handleLiveValues(m.events);
      else if (m.type === 'liveWatchResult') handleLiveWatchResult(m.vars);
      else if (m.type === 'liveVars') handleLiveVars(m.values);
      else if (m.type === 'liveBrowseResult') handleLiveBrowseResult(m);
      else if (m.type === 'plcBuildProgress') setPlcBuild((b) => (b && b.phase !== 'done' ? { ...b, step: String(m.text ?? '') } : b));
      // (closed: lost when it was live; opened only for From PLC, Browse or Check: nothing was lost)
      else if (m.type === 'closed') setLiveStatus((prev) => (prev.state === 'connected' || prev.state === 'connecting' ? { ...prev, state: 'lost', message: m.message } : prev));
    });
    return gatewayRef.current;
  }, [handleLiveStatus, handleLiveValues, handleLiveWatchResult, handleLiveVars, handleLiveBrowseResult]);
  useEffect(() => () => gatewayRef.current?.close(), []);
  const pouTypeName = useMemo(() => pouContent.match(/<POU\b[^>]*\bName="([^"]+)"/)?.[1], [pouContent]);
  // From the operator board: once the POU of that type is loaded (and its live settings), live on the machine
  useEffect(() => {
    if (!watchRequest || !pouTypeName || pouTypeName.toLowerCase() !== watchRequest.type.toLowerCase() || liveSettingsLoadedKey !== liveSettingsKey) return;
    adoptLiveConnection(pouFileName, watchRequest.connection);
    setWindowInstance(watchRequest.instance);
    setAutoLivePending(true);
    setWatchRequest(null);
    setDockLayout((l) => activateDockTab(l, 'live'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchRequest, pouTypeName, liveSettingsLoadedKey, liveSettingsKey]);
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
    (remember: boolean, name?: string, found?: { twincat?: string; os?: string }) => {
      const netId = liveSettings.netId.trim();
      updateRememberedPlcs((list) => {
        const rest = list.filter((p) => p.netId !== netId);
        if (!remember) return rest;
        const known = list.find((p) => p.netId === netId);
        return [{ ...(known ?? {}), name: name || known?.name || netId, netId, ip: liveSettings.ip.trim(), port: liveSettings.port, localNetId: liveSettings.localNetId.trim(), used: Date.now(), ...(found?.twincat ? { twincat: found.twincat, seen: Date.now() } : {}), ...(found?.os ? { os: found.os } : {}) }, ...rest];
      });
    },
    [liveSettings, updateRememberedPlcs]
  );
  // Each Browse search keeps the remembered PLCs up to date (their TwinCAT, OS, when seen; a changed DHCP address)
  const handlePlcsFound = useCallback((r: PlcScanResult) => updateRememberedPlcs((list) => refreshRemembered(list, r.devices, Date.now())), [updateRememberedPlcs]);
  const handleLiveStart = useCallback(() => {
    const port = parseInt(liveSettings.port, 10);
    const stateVar = identifiedStatesResult.stateVarName || 'machineState';
    const targetNetId = liveSettings.netId.trim();
    // A new session: a new recording (a replay showing ends)
    console.log('KSS-DBG start', new Error().stack);
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
        setLiveStatus((prev) => ({ ...prev, state: 'error', message: 'Enter the pairing code shown by Kval MachineScope Link' }));
        return;
      }
      setLiveSession(EMPTY_LIVE_SESSION);
      setLiveStatus((prev) => ({ ...prev, state: 'connecting', message: 'Connecting to Kval MachineScope Link...' }));
      const connection = gatewayConnection();
      connection
        .connect(`ws://127.0.0.1:${parseInt(liveSettings.linkPort, 10) || 48960}`, linkCode)
        .then((w) => {
          setLinkBuild(w?.build ?? { stamp: '', built: null, from: 'old' });
          return w;
        })
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
        .then(({ user, plcs, features }: { user: string; plcs: GatewayPlc[]; features?: string[] }) => {
          setGatewayFeatures(features ?? []);
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
    // (the web edition: once it knows its gateway)
    if (liveMode === 'web' && !gatewayKnown) return;
    setAutoLivePending(false);
    handleLiveStart();
  }, [autoLivePending, pouContent, liveMode, liveSettingsLoadedKey, liveSettingsKey, handleLiveStart, gatewayKnown]);
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
  // The I/O tab: the PLC's I/O tree, its linked variables on show (followed with the Symbols window's)
  const [ioTree, setIoTree] = useState<IoTree | null>(null);
  const [ioLoading, setIoLoading] = useState(false);
  const [ioVars, setIoVars] = useState<string[]>([]);
  const handleIoVars = useCallback((vars: string[]) => setIoVars((prev) => (prev.join('\n') === vars.join('\n') ? prev : vars)), []);
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
  // Another instance of this POU followed here instead: live again on it (stopped first when connected)
  const liveRestartRef = useRef<string | null>(null);
  const handleGoLiveHere = useCallback(
    (path: string) => {
      liveRestartRef.current = path;
      if (liveStatus.state === 'connected' || liveStatus.state === 'connecting') handleLiveStopRef.current();
      handleLiveSettingsChange({ ...liveSettings, instance: path });
    },
    [liveStatus.state, liveSettings, handleLiveSettingsChange]
  );
  useEffect(() => {
    const want = liveRestartRef.current;
    if (!want || liveSettings.instance !== want || liveStatus.state === 'connected' || liveStatus.state === 'connecting') return;
    liveRestartRef.current = null;
    handleLiveStartRef.current();
  }, [liveSettings.instance, liveStatus.state]);
  // The PLC project's sources as the PLC keeps them: read once per connection (a few MB), through the live connection
  // (plcProject: another PLC project on the same target; each read once)
  const plcSourcesRef = useRef<Map<string, Promise<PlcSources>>>(new Map());
  const plcSourcesTargetRef = useRef('');
  // The PLC's I/O tree (the I/O tab): read from the PLC connected to (its boot folder), read-only
  const loadIoTree = useCallback(async () => {
    setIoLoading(true);
    const req = { requestId: Date.now() % 1e9 };
    let r: IoTree;
    try {
      if (liveStatus.state !== 'connected') r = { devices: [], links: [], error: 'Go live on a PLC first (the Live tab)' };
      else if (isXaeHost()) r = { devices: [], links: [], error: 'In XAE, the I/O tree is XAE\'s own (its Solution Explorer)' };
      else if (liveMode === 'desktop') r = (await desktopLive()?.ioTree?.(req)) ?? { devices: [], links: [], error: 'Update the desktop app: it cannot read the I/O tree' };
      else if (gatewayRef.current) r = await gatewayRef.current.request<IoTree>({ type: 'ioTree', ...req }, 'ioTreeResult', 60000);
      else r = { devices: [], links: [], error: 'Not connected' };
    } catch (e) {
      r = { devices: [], links: [], error: e instanceof Error ? e.message : String(e) };
    }
    setIoTree({ devices: r.devices ?? [], links: r.links ?? [], project: r.project, error: r.error });
    setIoEcat(null);
    setIoLoading(false);
  }, [liveStatus.state, liveMode]);
  // The project's I/O, to compare with the PLC's (the desktop app: the open POU's project, else a folder chosen; the
  // browser: a folder chosen)
  const fetchProjectIo = useCallback(async (): Promise<IoTree | null> => {
    const api = desktopLive()?.ioTreeFolder;
    const r = api ? await api({ pouPath: pouPath || undefined, pick: false }) : await readIoFolderInBrowser();
    if (r.canceled) return null;
    return { devices: r.devices ?? [], links: r.links ?? [], project: r.project, folder: r.folder ?? '', error: r.error };
  }, [pouPath]);
  // Offline: the I/O of the TwinCAT project on this computer (the desktop app: the open POU's project; pick: a folder
  // chosen; the browser: a folder chosen, Chrome / Edge)
  const ioFolderApi = !!desktopLive()?.ioTreeFolder || (!isXaeHost() && canPickIoFolder());
  const loadIoFolder = useCallback(
    async (pick: boolean) => {
      const api = desktopLive()?.ioTreeFolder;
      setIoLoading(true);
      try {
        const r = api ? await api({ pouPath: pouPath || undefined, pick }) : await readIoFolderInBrowser();
        if (!r.canceled) setIoTree({ devices: r.devices ?? [], links: r.links ?? [], project: r.project, folder: r.folder ?? '', error: r.error });
      } catch (e) {
        setIoTree({ devices: [], links: [], folder: '', error: e instanceof Error ? e.message : String(e) });
      }
      setIoEcat(null);
      setIoLoading(false);
    },
    [pouPath]
  );
  // The EtherCAT masters' slave states (read-only; not yet confirmed on hardware): polled while the I/O tab shows a
  // tree read from the PLC
  const [ioEcat, setIoEcat] = useState<EcatStatesResult | null>(null);
  const [ioStatesWanted, setIoStatesWanted] = useState(false);
  const handleIoStatesWanted = useCallback((on: boolean) => setIoStatesWanted(on), []);
  useEffect(() => {
    // (also with the I/O tab closed: the status bar's health, the alerts)
    if (liveStatus.state !== 'connected' || !ioTree || ioTree.folder !== undefined) return;
    const netIds = [...new Set(ioTree.devices.filter((d) => d.netId && d.boxes.length).map((d) => d.netId!))];
    if (!netIds.length) return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      const req = { requestId: Date.now() % 1e9, netIds };
      let r: EcatStatesResult;
      try {
        if (liveMode === 'desktop') r = (await desktopLive()?.ecatStates?.(req)) ?? { error: 'Update the desktop app: it cannot read the EtherCAT states' };
        else if (gatewayRef.current) r = await gatewayRef.current.request<EcatStatesResult>({ type: 'ecatStates', ...req }, 'ecatStatesResult', 10000);
        else r = { error: 'Not connected' };
      } catch (e) {
        r = { error: e instanceof Error ? e.message : String(e) };
      }
      if (stopped) return;
      setIoEcat(r);
      // (a host that cannot answer them: not asked again until the tree is read again)
      if (r.error && /^(Update|No answer)/.test(r.error)) return;
      timer = window.setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [liveStatus.state, ioTree, liveMode]);
  // (another PLC: its tree read again when asked)
  useEffect(() => {
    setIoTree(null);
    setIoEcat(null);
  }, [liveStatus.target]);
  // What happened to the boxes while live: each read of the masters compared with the one before (newest first)
  const [ioEvents, setIoEvents] = useState<IoEvent[]>([]);
  // Alerts when a box leaves OP: a message (on by default), a sound (off)
  const [ioAlerts, setIoAlertsState] = useState<{ toast: boolean; sound: boolean }>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('kss.io.alerts') || '{}');
      return { toast: v.toast !== false, sound: v.sound === true };
    } catch {
      return { toast: true, sound: false };
    }
  });
  const ioAlertsRef = useRef(ioAlerts);
  ioAlertsRef.current = ioAlerts;
  const setIoAlerts = useCallback((v: { toast: boolean; sound: boolean }) => {
    setIoAlertsState(v);
    try {
      localStorage.setItem('kss.io.alerts', JSON.stringify(v));
    } catch {
      // per-viewer convenience only
    }
  }, []);
  const ioPrevStatesRef = useRef<Map<string, SlaveState>>(new Map());
  // Since when each box is in its state, and when it last left OP (by path)
  const [ioSince, setIoSince] = useState<Record<string, BoxSince>>({});
  // The CRC counters' baselines ("since now", by path)
  const [ioCrcBase, setIoCrcBase] = useState<Record<string, CrcBase>>({});
  useEffect(() => {
    ioPrevStatesRef.current = new Map();
    setIoSince({});
    setIoCrcBase({});
  }, [ioTree]);
  useEffect(() => {
    if (!ioTree || !ioEcat?.masters) return;
    // (the masters' own states: the InfoData ones change with the values, not with the reads)
    const next = boxStates(ioTree.devices, ioEcat, () => undefined);
    const names = new Map(ioTree.devices.flatMap((d) => allBoxes(d.boxes).map((b) => [b.path, b.name] as const)));
    const found = stateEvents(ioPrevStatesRef.current, next, names);
    const before = ioPrevStatesRef.current;
    ioPrevStatesRef.current = next;
    setIoSince((prev) => {
      let changed = false;
      const out = { ...prev };
      const now = Date.now();
      for (const [path, st] of next) {
        const was = before.get(path);
        const cur = out[path];
        if (!cur || !was || was.name !== st.name || was.ok !== st.ok) {
          out[path] = { name: st.name, ok: st.ok, since: cur && was && was.name === st.name && was.ok === st.ok ? cur.since : now, first: !was && !cur, ...(cur?.lastLeftOp ? { lastLeftOp: cur.lastLeftOp } : {}), ...(was?.ok && !st.ok ? { lastLeftOp: now } : {}) };
          changed = true;
        }
      }
      return changed ? out : prev;
    });
    if (found.length) setIoEvents((prev) => [...found.reverse(), ...prev].slice(0, 500));
    // (a box out of OP: said at once, wherever the I/O tab is; a sound when asked for)
    const bad = found.filter((e) => !e.ok && e.kind === 'state' && before.size > 0);
    if (bad.length && ioAlertsRef.current.toast) showCopyToast(`I/O: ${bad[0].text}${bad.length > 1 ? ` (and ${bad.length - 1} more)` : ''}`, 'error', 10000);
    if (bad.length && ioAlertsRef.current.sound) ioBeep();
  }, [ioEcat, ioTree]);
  // The I/O's health while live (the status bar): the boxes known, those not in OP
  const ioHealth = useMemo(() => {
    if (!ioTree || ioTree.folder !== undefined || liveStatus.state !== 'connected' || !ioEcat?.masters) return null;
    const st = boxStates(ioTree.devices, ioEcat, () => undefined);
    const names = new Map(ioTree.devices.flatMap((d) => allBoxes(d.boxes).map((b) => [b.path, b.name] as const)));
    return { known: st.size, down: [...st].filter(([, s]) => !s.ok).map(([p, s]) => `${names.get(p) ?? p}: ${s.name}`) };
  }, [ioTree, ioEcat, liveStatus.state]);
  // The events kept for each PLC (this browser: they survive a reload)
  const ioEventsKey = ioTree && ioTree.folder === undefined && liveStatus.target ? `kss.io.events.${liveStatus.target}` : null;
  const ioEventsLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ioEventsKey || ioEventsLoadedRef.current === ioEventsKey) return;
    ioEventsLoadedRef.current = ioEventsKey;
    try {
      const kept = JSON.parse(localStorage.getItem(ioEventsKey) || '[]');
      if (Array.isArray(kept)) setIoEvents((prev) => [...prev, ...kept.filter((e) => e && typeof e.at === 'number' && typeof e.text === 'string' && !prev.some((p) => p.at === e.at && p.text === e.text))].sort((a, b) => b.at - a.at).slice(0, 500));
    } catch {
      // (none kept)
    }
  }, [ioEventsKey]);
  useEffect(() => {
    if (!ioEventsKey || ioEventsLoadedRef.current !== ioEventsKey) return;
    try {
      localStorage.setItem(ioEventsKey, JSON.stringify(ioEvents.slice(0, 500)));
    } catch {
      // per-viewer convenience only
    }
  }, [ioEvents, ioEventsKey]);
  // Browse through Link (web edition): the search and Add Route run in Link, on this computer
  const linkRequest = useCallback(
    async <T,>(message: Record<string, unknown>, replyType: string, timeoutMs?: number): Promise<T> => {
      if (!linkCode) throw new Error('Enter the pairing code shown by Kval MachineScope Link first');
      const c = gatewayConnection();
      const w = await c.connect(`ws://127.0.0.1:${parseInt(liveSettings.linkPort, 10) || 48960}`, linkCode);
      setLinkBuild(w?.build ?? { stamp: '', built: null, from: 'old' });
      return c.request<T>(message, replyType, timeoutMs);
    },
    [linkCode, gatewayConnection, liveSettings.linkPort]
  );
  // (not live: from the PLC the Live tab names, over a connection of its own: its sources are files in its boot
  // folder, its PLC need not run; the desktop app and Link)
  const plcSourcesConnection = () => ({
    netId: liveSettings.netId.trim(),
    ip: liveSettings.ip.trim() || undefined,
    port: Number(liveSettings.port) > 0 ? Number(liveSettings.port) : undefined,
    localNetId: liveSettings.localNetId.trim() || undefined,
  });
  const fetchPlcSources = useCallback((plcProject = ''): Promise<PlcSources> => {
    const offline = liveStatus.state !== 'connected';
    const conn = plcSourcesConnection();
    const target = `${liveMode}|${offline ? `${conn.netId}:${conn.port ?? 851}` : liveStatus.target ?? ''}`;
    if (plcSourcesTargetRef.current !== target) {
      plcSourcesTargetRef.current = target;
      plcSourcesRef.current = new Map();
    }
    const cache = plcSourcesRef.current;
    const known = cache.get(plcProject);
    if (known) return known;
    const req = { requestId: Date.now() % 1e9, ...(plcProject ? { plcProject } : {}), ...(offline ? { connection: conn } : {}) };
    let p: Promise<PlcSources>;
    if (isXaeHost()) p = Promise.resolve({ error: 'XAE opens the project from the target itself' });
    else if (liveMode === 'desktop') p = desktopLive()?.sources?.(req) ?? Promise.resolve({ error: 'Update the desktop app: it cannot read the PLC\'s sources' });
    else if (offline && liveVia === 'link') {
      // (Link: connected to it first, without going live; an older Link reads them only while live)
      p = !linkCode
        ? Promise.resolve({ error: 'Enter the pairing code shown by Kval MachineScope Link' })
        : gatewayConnection()
            .connect(`ws://127.0.0.1:${parseInt(liveSettings.linkPort, 10) || 48960}`, linkCode)
            .then((w) => {
              setLinkBuild(w?.build ?? { stamp: '', built: null, from: 'old' });
              if (!w?.features?.includes('sourcesOffline')) return { error: 'This Link reads the PLC\'s sources only while live: update it (npm run build:link, or the installer) and start it again, or go live first' };
              return gatewayRef.current!.request<PlcSources>({ type: 'plcSources', ...(plcProject ? { plcProject } : {}), connection: conn }, 'plcSourcesResult', 120000);
            })
            .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    } else if (offline) {
      // (a gateway: one of its PLCs chosen; signed in first, without going live)
      const address = liveSettings.gateway || gatewayOrigin;
      p = !address || !liveSettings.plc
        ? Promise.resolve({ error: 'Choose one of the gateway\'s PLCs first' })
        : !gatewayToken && !ssoUser
          ? Promise.resolve({ error: ssoHere ? 'Sign in first' : 'Enter your gateway access token' })
          : gatewayConnection()
              .connect(address, gatewayToken, !!ssoUser)
              .then((w) => {
                setGatewayFeatures(w.features ?? []);
                if (!w.features?.includes('sourcesOffline')) return { error: 'This gateway reads the PLC\'s sources only while live: go live first (or update the gateway)' };
                return gatewayRef.current!.request<PlcSources>({ type: 'plcSources', plc: liveSettings.plc, ...(plcProject ? { plcProject } : {}) }, 'plcSourcesResult', 120000);
              })
              .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    }
    else p = gatewayRef.current ? gatewayRef.current.request<PlcSources>({ type: 'plcSources', ...(plcProject ? { plcProject } : {}) }, 'plcSourcesResult', 120000).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) })) : Promise.resolve({ error: 'Not connected' });
    p = p.then((r) => {
      if (r.error && cache.get(plcProject) === p) cache.delete(plcProject);
      return r;
    });
    cache.set(plcProject, p);
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode, liveStatus.target, liveStatus.state, liveSettings, liveVia, linkCode, gatewayConnection, gatewayOrigin, gatewayToken, ssoUser, ssoHere]);
  // A POU type's instances on the PLC the Live tab names, before going live (the one to follow chosen first): the
  // desktop app, a Link that can (instancesOffline); null elsewhere (a gateway: which one, once live)
  const fetchInstancesBeforeLive = (typeName: string, stateVar: string): Promise<PlcInstancesResult> | null => {
    if (isXaeHost()) return null;
    const req = { requestId: Date.now() % 1e9, connection: plcSourcesConnection(), typeName, stateVar };
    if (liveMode === 'desktop') return desktopLive()?.instances?.(req) ?? null;
    if (liveMode === 'web' && liveVia === 'link' && linkBuildRef.current?.features?.includes('instancesOffline'))
      return linkRequest<PlcInstancesResult>({ type: 'liveInstances', ...req }, 'liveInstancesResult', 60000).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    if (liveMode === 'web' && liveVia === 'gateway' && liveSettings.plc && gatewayFeaturesRef.current.includes('instancesOffline'))
      return gatewayRequestRef.current<PlcInstancesResult>({ type: 'liveInstances', plc: liveSettings.plc, typeName, stateVar }, 'liveInstancesResult').catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    return null;
  };
  // A PLC's project kept on this computer (desktop app, Link): going live on a PLC that runs another project than the
  // loaded POU's, its whole TwinCAT project is downloaded into Documents\Kval MachineScope\PLC projects\<project>; a copy
  // there that differs from the PLC's: Override, Save to a different location (remembered for this PLC), or Keep
  // local. Its instances then open with their own POU from it (the same name in another project is another type)
  const [plcCopy, setPlcCopy] = useState<PlcCopy | null>(null);
  const plcCopyAskedRef = useRef('');
  const requestPlcCopy = useCallback(
    (req: { folder?: string; chosen?: boolean; choice?: 'override' | 'keep'; skipProjects?: string[] }): Promise<PlcCopyResult> => {
      const r = { requestId: Date.now() % 1e9, ...req };
      if (liveMode === 'desktop') return desktopLive()?.projectCopy?.(r) ?? Promise.resolve({ error: 'Update the desktop app' });
      return gatewayRef.current ? gatewayRef.current.request<PlcCopyResult>({ type: 'plcProjectCopy', ...req }, 'plcProjectCopyResult', 180000).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) })) : Promise.resolve({ error: 'Not connected' });
    },
    [liveMode]
  );
  const copyFolderKey = (target: string) => `kss.plcCopy.folder.${target.split(':')[0]}`;
  const handlePlcCopy = useCallback(
    (r: PlcCopyResult, target: string) => {
      if (r.error || !r.status) {
        showCopyToast(`The PLC's project was not kept on this computer: ${r.error ?? 'no answer'}`, 'error', 8000);
        return;
      }
      const copy: PlcCopy = { ...r, status: r.status, project: r.project ?? '', target };
      // (this window's POU from another project: said, its own opened from Symbols)
      const other = pouTypeName && r.dir && !(pouPath ?? '').toLowerCase().startsWith(r.dir.toLowerCase()) ? `. This window's ${pouTypeName} is ${liveProject || 'another project'}'s: open ${copy.project}'s from Symbols` : '';
      if (r.status !== 'differs') {
        setPlcCopy(copy);
        if (r.status === 'downloaded' || r.status === 'overridden')
          showCopyToast(`${copy.project}: the PLC's project ${r.status === 'downloaded' ? 'downloaded' : 'written over the local copy'} (${r.dir}). Its instances open with their own POUs from it${other}`, 'success', 9000);
        else if (r.status === 'current' || r.status === 'kept') showCopyToast(`${copy.project}: its instances open from the local copy (${r.dir})${other}`, 'success', 6000);
        return;
      }
      const keep = () => {
        setPlcCopy({ ...copy, status: 'kept' });
        showCopyToast(`${copy.project}: the local copy kept (${r.dir}); its instances open from it`, 'success', 5000);
      };
      // Save to a different location: its folder chosen (the desktop app's dialog; Link: typed, in your folders)
      const elsewhere = async () => {
        const suggested = `${(r.dir ?? '').replace(/[\\/][^\\/]*$/, '')}\\${copy.project} (${new Date().toISOString().slice(0, 10)})`;
        const save = (folder: string) => {
          try {
            localStorage.setItem(copyFolderKey(target), folder);
          } catch {
            // (asked for again next time)
          }
          showCopyToast(`${copy.project}: downloading the PLC's project to ${folder}…`, 'success', 4000);
          void requestPlcCopy({ folder, chosen: true }).then((x) => handlePlcCopy(x, target));
        };
        const pick = desktopLive()?.pickFolder;
        if (pick) {
          const f = await pick(`Where to keep ${copy.project} (the PLC's project)`);
          if (f.path) save(f.path);
          else keep();
          return;
        }
        setPromptRequest({
          title: `Where to keep ${copy.project}`,
          label: 'A folder on this computer, in your user folder (Link writes the PLC\'s project there)',
          initial: suggested,
          monospace: true,
          submitLabel: 'Download here',
          validate: (v) => (/^([A-Za-z]:\\|\\\\|\/)/.test(v.trim()) ? null : 'A full path (C:\\…)'),
          onSubmit: (v) => save(v.trim()),
          onCancel: keep,
        });
      };
      setPromptRequest({
        title: `${copy.project}: the PLC's project differs from your local copy`,
        label: `The PLC runs another version of ${copy.project} than the copy in ${r.dir}${r.downloaded ? ` (downloaded ${new Date(r.downloaded).toLocaleString()})` : ''}.`,
        details:
          r.changes == null
            ? ['That folder was not downloaded by Kval MachineScope: its own edits are not known (Override writes the PLC\'s files over it)']
            : r.changes.length
              ? [`Edited here since it was downloaded (Override loses these):`, ...r.changes.slice(0, 12).map((c) => `  ${c}`), ...(r.changes.length > 12 ? [`  … and ${r.changes.length - 12} more`] : [])]
              : ['Not edited here since it was downloaded'],
        confirmOnly: true,
        danger: r.changes == null || r.changes.length > 0,
        submitLabel: 'Override',
        onSubmit: () => void requestPlcCopy({ folder: r.dir, choice: 'override' }).then((x) => handlePlcCopy(x, target)),
        altAction: { id: 'plc-copy-elsewhere-btn', label: 'Save to a different location…', title: 'The PLC\'s project in another folder (this one left as it is); remembered for this PLC', run: () => void elsewhere() },
        cancelLabel: 'Keep local',
        onCancel: keep,
        sideAction: r.compare?.length
          ? {
              id: 'plc-copy-show-diff-btn',
              label: `Show the differences (${r.compare.length}${r.compareMore ? `+${r.compareMore}` : ''} file${r.compare.length === 1 ? '' : 's'})`,
              title: "The PLC's version of each source file that differs, next to your local copy's (read-only)",
              run: () =>
                setPlcCopyDiff({
                  title: `${copy.project}: the PLC's version and your local copy${r.compareMore ? ` (${r.compareMore} more files not shown)` : ''}`,
                  parts: r.compare!.map((c) => ({ name: c.path + (!c.plc ? ' (only here)' : !c.local ? ' (only on the PLC)' : ''), before: c.plc, after: c.local })),
                }),
            }
          : undefined,
      });
    },
    [requestPlcCopy, showCopyToast, pouTypeName, pouPath, liveProject]
  );
  // The PLC connected to runs another project than the loaded POU's (its copy kept here): an instance of the "same"
  // type there is another type, opened with its own POU
  const livePlcCopy = plcCopy && plcCopy.target === liveStatus.target && plcCopy.status !== 'same-project' ? plcCopy : null;
  const loadedFromLivePlc =
    !livePlcCopy ||
    !liveProject ||
    (!!pouPath && !!livePlcCopy.dir && pouPath.toLowerCase().startsWith(livePlcCopy.dir.toLowerCase())) ||
    (!!plcOrigin?.target && !!liveStatus.target && plcOrigin.target.split(':')[0] === liveStatus.target.split(':')[0]);
  const plcCompareKey = `${liveStatus.target ?? ''}|${pouTypeName ?? ''}`;
  const loadPlcBaseline = useCallback(async (): Promise<{ pou?: string; dut?: string; error?: string; note?: string; project?: string }> => {
    if (!pouTypeName) return { error: 'No POU loaded' };
    const r = await fetchPlcSources(plcOrigin?.plcProject ?? '');
    if (r.error || !r.files) return { error: r.error ?? 'The PLC keeps no sources' };
    const src = plcPouSource(r.files, pouTypeName);
    if (!src) return { error: `${pouTypeName}.TcPOU is not in the PLC's sources (${r.plcProject ?? r.project})` };
    const dut = dutFileName ? src.dutCandidates?.find((d) => d.name.toLowerCase() === dutFileName.toLowerCase()) : undefined;
    return { pou: src.content, dut: dut?.content, project: r.plcProject ?? r.project, note: [r.stale, dutFileName && !dut ? `The enum was not compared (${dutFileName} is not in the PLC's sources)` : ''].filter(Boolean).join(' ') || undefined };
  }, [pouTypeName, dutFileName, fetchPlcSources, plcOrigin?.plcProject]);
  useEffect(() => {
    if (!changesTabMounted || compareBase !== 'plc' || plcBaseline?.key === plcCompareKey) return;
    if (liveStatus.state !== 'connected') {
      setPlcBaseline({ key: plcCompareKey, loading: false, error: 'Go live on the PLC to compare with its version' });
      return;
    }
    setPlcBaseline({ key: plcCompareKey, loading: true });
    void loadPlcBaseline().then((r) => setPlcBaseline({ key: plcCompareKey, loading: false, ...r }));
  }, [changesTabMounted, compareBase, plcCompareKey, plcBaseline?.key, liveStatus.state, loadPlcBaseline]);
  // Compare with the PLC (the Live tab): this POU against the PLC's, side by side
  const handleCompareWithPlc = useCallback(() => {
    showCopyToast("Reading the PLC's sources…", 'success', 3000);
    void loadPlcBaseline().then((r) => {
      if (r.error || !r.pou) return showCopyToast(r.error ?? 'Not in the PLC', 'error', 8000);
      const before = { pou: r.pou, dut: r.dut ?? dutContent };
      const after = { pou: pouContent, dut: dutContent };
      setReview({ before, after, diff: diffCharts(before, after), label: `on the PLC (${r.project ?? 'its project'})`, parts: pouPartDiffs(r.pou, pouContent), noSave: true });
      if (r.note) showCopyToast(r.note, 'error', 10000);
    });
  }, [loadPlcBaseline, pouContent, dutContent, showCopyToast]);
  // Open from the PLC (the Live tab): its POUs listed, one opened in this window
  const [plcPicker, setPlcPicker] = useState<PlcSources | null>(null);
  const handleOpenFromPlc = useCallback(
    (plcProject = '') => {
      showCopyToast(plcProject ? `Reading the PLC's sources of ${plcProject}…` : 'Reading the PLC\'s sources…', 'success', 3000);
      void fetchPlcSources(plcProject).then((r) => {
        if (r.error || !r.files) return showCopyToast(r.error ?? 'The PLC keeps no sources', 'error', 8000);
        if (r.stale) showCopyToast(r.stale, 'error', 12000);
        setPlcPicker(r);
      });
    },
    [fetchPlcSources, showCopyToast]
  );
  const openPlcPouHere = useCallback(
    (sources: PlcSources, typeName: string) => {
      const conn = plcSourcesConnection();
      const found = sources.files ? plcPouSource(sources.files, typeName, { project: sources.project, plcProject: sources.plcProject, target: liveStatus.state === 'connected' ? liveStatus.target : `${conn.netId}:${conn.port ?? 851}` }) : null;
      if (!found) return showCopyToast(`${typeName}.TcPOU is not in the PLC's sources`, 'error');
      // This one from the PLC, edited: its edits kept for the session (built with the others), not discarded
      const keep: Record<string, PlcEdit> = {};
      if (plcOrigin && (pouDirty || dutDirty)) for (const e of plcEdits(plcOrigin, { content: pouContent }, { name: dutFileName, content: dutContent })) keep[e.path.toLowerCase()] = e;
      if (Object.keys(keep).length) setPlcSessionEdits((m) => ({ ...m, ...keep }));
      const edits = { ...plcSessionEdits, ...keep };
      // (edited earlier in this session: its edits back)
      const again = edits[found.plc!.path.toLowerCase()];
      const src = again ? { ...found, content: again.content } : found;
      const proceed = (go: () => void) => (Object.keys(keep).length ? go() : confirmDiscard(go));
      proceed(() => {
        // Live: stopped, then live again on an instance of this type (the PLC's first; the Live tab lists the others),
        // not on the previous type's instance
        const wasLive = liveStatus.state === 'connected' || liveStatus.state === 'connecting';
        if (wasLive) {
          handleLiveStopRef.current();
          handleLiveSettingsChange({ ...liveSettings, instance: '' });
        }
        // The POU opened: live (on the instance chosen; none: the PLC's first of it, several there: which one, once
        // connected), or not (its instances not read: said after)
        const open = (live: boolean, instance?: string) => {
          // (the connection comes along, live or not: the live settings are kept per POU, and From PLC before going
          // live named the Target)
          applyLoadedPou(src, { live, ...(instance ? { instance } : {}), connection: connectionOf(liveSettings) });
          if (live && !instance && (!liveSettings.instance.trim() || wasLive)) pickInstanceRef.current = true;
          // (its edits, still to build: unsaved against the PLC's version)
          if (again) setSavedSources((b) => ({ ...b, pou: found.content }));
          // Code help from the whole PLC project (its types, GVLs, the other POUs' members)
          setPlcCodeFiles({ project: sources.project, files: plcProjectFiles(sources.files ?? []) });
          const keptNote = Object.keys(keep).length ? ` Kept your edits of ${Object.values(keep).map((e) => e.path.split('/').pop()).join(', ')} for the build.` : '';
          if (sources.stale) showCopyToast(`${sources.stale}${keptNote}`, 'error', 12000);
          else showCopyToast(`${src.name} from the PLC (${sources.project ?? 'its project'}): a copy of the PLC's source; Save As keeps it on this computer.${keptNote}`, 'success', 7000);
        };
        // Not live: its instances on the PLC read first (desktop app, Link), so the one to follow is chosen before
        // connecting; while live: which one once live again (the connection there is the live one)
        const stateVar = extractIdentifiedStatesFromPou(src.content, '').stateVarName || 'machineState';
        const before = wasLive ? null : fetchInstancesBeforeLive(typeName, stateVar);
        if (!before) return open(true);
        showCopyToast(`${typeName}: its instances on the PLC…`, 'success', 4000);
        void before.then((r) => {
          const list = r.instances ?? [];
          if (r.error || !list.length) {
            open(false);
            showCopyToast(`${src.name} opened, not live: ${r.error ?? `the PLC has no instance of ${typeName}`}`, 'error', 9000);
          } else if (list.length === 1) open(true, list[0]);
          else setInstancePicker({ instances: list, current: null, typeName, onPick: (i) => open(true, i), onDismiss: () => open(false) });
        });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showCopyToast, applyLoadedPou, liveStatus.state, liveSettings, handleLiveSettingsChange, plcOrigin, pouDirty, dutDirty, pouContent, dutContent, dutFileName, plcSessionEdits, liveMode, liveVia, linkRequest]
  );
  // Watch: the state machine's diagram in its own tab / window, live on that instance (its transitions are recorded)
  const handleWatchMachine = useCallback(
    (node: SymbolChild, on?: Partial<LiveSettings>, opts?: { here?: boolean }) => {
      // on: another PLC (the Machine Overview's other PLCs): its connection instead of this window's
      const connection = connectionOf(on ? { ...liveSettings, ...on } : liveSettings);
      const typeName = node.type.trim().split('.').pop() ?? '';
      // A library's type (Tc2_MC2.MC_Power): its library named when its source is not at hand
      const qualifier = node.type.trim().split('.').slice(0, -1).join('.');
      if (!/^[A-Za-z_]\w*$/.test(typeName)) {
        showCopyToast(`${node.type} is not a function block type`, 'error');
        return;
      }
      // This POU: another instance of it (not when the PLC runs another project: its type of that name is its own)
      if (!on && pouTypeName && typeName.toLowerCase() === pouTypeName.toLowerCase() && loadedFromLivePlc) {
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
        // Here: this window's POU replaced (live on the instance)
        if (opts?.here) {
          confirmDiscard(() => {
            if (liveStatus.state === 'connected' || liveStatus.state === 'connecting') handleLiveStopRef.current();
            applyLoadedPou(src, { instance: node.path, live: true, connection });
            showCopyToast(`${src.name} here, live on ${node.path}`, 'success', 5000);
          });
          return;
        }
        if (d?.newWindow && src.path) {
          void d.newWindow(src.path, { instance: node.path, live: true, connection });
          return;
        }
        const dut = src.dutCandidates ?? undefined;
        const id = putHandoff({ instance: node.path, live: true, connection, pou: { name: src.name, content: src.content, path: src.path, plc: src.plc }, dutCandidates: dut });
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
      const choose = () => {
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
      // No source at hand: from the PLC's own sources when it keeps them; else its .TcPOU chosen, or its diagram learned
      // live (the PLC's states, the transitions it takes)
      const inLibrary = (lib?: string) => (lib ? `${typeName} is in the library ${lib}: its source is not in the project` : undefined);
      const pick = () => {
        if (liveStatus.state !== 'connected' || isXaeHost()) return offer(inLibrary(qualifier));
        showCopyToast(`Looking for ${typeName} in the PLC's sources…`, 'success', 3000);
        void fetchPlcSources().then((r) => {
          const src = r.files ? plcPouSource(r.files, typeName, { project: r.project, plcProject: r.plcProject, target: liveStatus.target }) : null;
          const lib = qualifier || r.libraryTypes?.[typeName.toLowerCase()];
          if (!src) return offer(inLibrary(lib) ?? r.error ?? (r.files ? `${typeName} is not in the PLC's sources (${r.project})` : undefined));
          showCopyToast(`${typeName} from the PLC's sources (${r.project}), live on ${node.path}`, 'success', 6000);
          handOver(src);
        });
      };
      const offer = (why?: string) => {
        const enumType = node.stateType?.trim().split('.').pop() ?? '';
        const learned = node.stateNames && enumType ? learnedSources({ typeName, stateVar: liveStateVar, enumType, names: node.stateNames, seen: loadSeen(typeName) }) : null;
        // (nothing to say and nothing to learn: straight to choosing its .TcPOU)
        if (!learned && !why) return choose();
        setPromptRequest({
          title: `Open ${node.path} (${typeName})`,
          label: learned
            ? `${typeName}'s source is not at hand${why ? ` (${why})` : ''}. Choose its .TcPOU, or learn its diagram live: its ${Object.keys(node.stateNames ?? {}).length} states from the PLC, and each transition the PLC takes added as it happens (their conditions are not known). Nothing is written to a project.`
            : `${typeName}'s source is not at hand (${why}): choose its .TcPOU (a library's POU: from the library's project).`,
          confirmOnly: true,
          submitLabel: `Choose ${typeName}.TcPOU…`,
          onSubmit: choose,
          altAction: learned ? {
            id: 'text-prompt-learn-btn',
            label: 'Learn it live',
            title: 'A diagram of its states, its transitions added as the PLC takes them (live on this instance)',
            run: () => handOver({ name: `${typeName}.TcPOU`, content: learned.pou, dutCandidates: [{ name: `${enumType}.TcDUT`, relativePath: `${enumType}.TcDUT`, content: learned.dut }] }),
          } : undefined,
        });
      };
      // The PLC runs another project, kept on this computer: its own POU from that copy (the desktop app; Link: read
      // by Link, the copy on its computer)
      const fromCopy = !on && !loadedFromLivePlc ? livePlcCopy?.plcProjects ?? [] : [];
      const openInProject = d?.openPouInProject;
      // (Link: the copy is on its computer, the POU read there)
      const gw = gatewayRef.current;
      const openInCopy: ((plcproj: string, type: string) => Promise<PouSource | { error: string }>) | undefined =
        openInProject ??
        (liveMode === 'web' && liveVia === 'link' && gw && linkBuildRef.current?.features?.includes('projectPou')
          ? (plcproj, type) => gw.request<PouSource & { error?: string }>({ type: 'projectPou', plcproj, typeName: type }, 'projectPouResult', 30000).then((r) => (r.error ? { error: r.error } : r)).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
          : undefined);
      if (openInCopy && fromCopy.length) {
        void (async () => {
          for (const plc of fromCopy) {
            const src = await openInCopy(plc.plcproj, typeName);
            if (!('error' in src)) {
              showCopyToast(`${typeName} from ${livePlcCopy?.project} (the PLC's project, ${plc.name}), live on ${node.path}`, 'success', 6000);
              return handOver(src);
            }
          }
          pick();
        })();
        return;
      }
      if (openInProject && pouPath && loadedFromLivePlc) {
        void openInProject(pouPath, typeName).then((src) => {
          if ('error' in src) pick();
          else handOver(src);
        });
        return;
      }
      pick();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pouTypeName, pouPath, handleOpenInstance, showCopyToast, liveSettings, liveStateVar, liveStatus.state, fetchPlcSources, applyLoadedPou, loadedFromLivePlc, livePlcCopy, liveMode, liveVia]
  );
  // Stop following the window's values when it closes or the connection ends
  useEffect(() => {
    if (!symbolsOpen) setSymbolPaths([]);
  }, [symbolsOpen]);

  // The POU and the followed instance in the window / tab title, to tell several MachineScopes apart
  const shownInstance = (liveStatus.state === 'connected' || liveStatus.state === 'lost' ? liveStatus.instance : undefined) ?? windowInstance ?? undefined;
  useEffect(() => {
    const pou = pouFileName ? pouFileName.replace(/\.TcPOU$/i, '') : '';
    document.title = pou ? `${pou}${shownInstance ? ` (${shownInstance})` : ''} - Kval MachineScope` : 'Kval MachineScope';
  }, [pouFileName, shownInstance]);
  // Desktop app: the main process opens a POU (and an instance of it) in the window that shows it
  useEffect(() => {
    (window as unknown as { tcDesktop?: { reportPou?: (p: string | null, instance?: string | null) => void } }).tcDesktop?.reportPou?.(pouPath ?? null, shownInstance ?? null);
  }, [pouPath, shownInstance]);

  const handleLiveStop = useCallback(() => {
    // Stop during a replay: ends the replay
    if (replayingRef.current) {
      console.log('KSS-DBG stop', new Error().stack);
      setReplay(null);
      setLiveStatus({ state: 'stopped', message: 'Replay closed', instances: [] });
      return;
    }
    if (isXaeHost()) postToHost({ type: 'liveStop' });
    else if (desktopLive()) void desktopLive()!.stop();
    else gatewayRef.current?.stop();
    setLiveStatus((prev) => ({ ...prev, state: 'stopped', message: 'Not connected' }));
  }, []);
  const handleLiveStartRef = useRef(handleLiveStart);
  handleLiveStartRef.current = handleLiveStart;
  const handleLiveStopRef = useRef(handleLiveStop);
  handleLiveStopRef.current = handleLiveStop;
  // ---- Recording and replay ----
  const handleSaveRecording = useCallback(async () => {
    const rec = recorderRef.current.toRecording({
      pou: pouTypeName, pouFile: pouFileName, instance: liveStatus.instance ?? (liveSettings.instance || undefined), target: liveStatus.target,
      stateVar: identifiedStatesResult.stateVarName || 'machineState',
    });
    // (a recording is the user's own: offered in their folder, not the project's)
    const r = await saveDocument(recordingFileName(pouTypeName, rec.instance), JSON.stringify(rec), { personal: true });
    if (r.error) showCopyToast(`Could not save the recording: ${r.error}`, 'error', 8000);
    else if (!r.canceled) showCopyToast(`Recording saved${r.path ? `: ${r.path}` : ''} (${rec.values.length} samples${rec.truncated ? ', the oldest dropped' : ''})`, 'success', 6000);
  }, [pouTypeName, pouFileName, liveStatus.instance, liveStatus.target, liveSettings.instance, identifiedStatesResult.stateVarName, showCopyToast]);
  // What the replay has shown: up to which sample (a seek back starts again from the beginning)
  const replayFedRef = useRef({ values: 0, vars: 0, pos: -Infinity });
  // A recording played back (a file, or a machine's time window from a gateway recording)
  const startReplay = useCallback(
    (rec: LiveRecording, name: string) => {
      const file = { name };
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
      if (rec.pou && pouTypeName && rec.pou.toLowerCase() !== pouTypeName.toLowerCase()) showCopyToast(`${file.name} was recorded with ${rec.pou}; this is ${pouTypeName}: states are shown by their values`, 'error', 8000);
    },
    [liveStatus.state, pouTypeName, showCopyToast]
  );
  const handleOpenRecording = useCallback(
    async (file: File) => {
      const rec = parseRecording(await file.text());
      if ('error' in rec) {
        showCopyToast(`${file.name}: ${rec.error}`, 'error', 7000);
        return;
      }
      startReplay(rec, file.name);
    },
    [startReplay, showCopyToast]
  );
  // Path checks: this session's transitions kept (named), checked against every edit (Problems)
  const handleKeepPathCheck = useCallback(() => {
    const trans = liveSession.transitions;
    if (!trans.length) return;
    const unique = new Set(trans.map((t) => `${t.from}->${t.to}`)).size;
    setPromptRequest({
      title: 'Keep as a path check',
      label: `This session's ${unique} different transition${unique === 1 ? '' : 's'} (${trans.length} in all) are checked against every edit: one the diagram no longer has shows in Problems.`,
      initial: `${replay ? replay.file.replace(/\.kssrec\.json$|\.json$/i, '') : `Live ${liveStatus.instance?.split('.').pop() ?? ''}`} ${new Date().toLocaleDateString()}`.trim(),
      submitLabel: 'Keep',
      validate: (v) => (v.trim() ? null : 'A name'),
      onSubmit: (name) => {
        setPathChecks([...pathChecks, pathCheckFrom(name, replay ? `recording ${replay.file}` : `live ${liveStatus.instance ?? ''}`, trans)]);
        showCopyToast(`Path check "${name}" kept: ${unique} transitions`, 'success');
      },
    });
  }, [liveSession.transitions, replay, liveStatus.instance, pathChecks, setPathChecks, showCopyToast]);
  const pathCheckView = useMemo(
    () => pathCheckResults.map((r) => ({ id: r.check.id, name: r.check.name, transitions: r.check.transitions.length, missing: r.missing.map((t) => `${t.from} → ${t.to}`) })),
    [pathCheckResults]
  );
  // During a replay: its recorded variables (at most 8, thinned to 400 points each) for the small charts
  const replayVars = useMemo(() => {
    if (!replay?.rec.vars.length) return [];
    const by = new Map<string, { t: number; v: number | boolean | string | null }[]>();
    for (const x of replay.rec.vars) {
      if (!by.has(x.id)) by.set(x.id, []);
      by.get(x.id)!.push({ t: x.t, v: x.v });
    }
    return [...by.entries()].slice(0, 8).map(([id, pts]) => ({ id, points: pts.length > 400 ? pts.filter((_, i) => i % Math.ceil(pts.length / 400) === 0 || i === pts.length - 1) : pts }));
  }, [replay?.rec]);
  // Gateway recordings (web edition through a gateway): the gateway's list, one machine's time window replayed
  const [gatewayRecordingsOpen, setGatewayRecordingsOpen] = useState(false);
  const gatewayRequest = useCallback(
    async <T,>(message: Record<string, unknown>, replyType: string): Promise<T> => {
      const address = liveSettings.gateway || gatewayOrigin;
      if (!address) throw new Error('Enter the gateway address');
      if (!gatewayToken && !ssoUser) throw new Error(ssoHere ? 'Sign in first' : 'Enter your gateway access token first');
      const c = gatewayConnection();
      await c.connect(address, gatewayToken, !!ssoUser);
      return c.request<T>(message, replyType, 60000);
    },
    [liveSettings.gateway, gatewayOrigin, gatewayToken, ssoUser, ssoHere, gatewayConnection]
  );
  gatewayRequestRef.current = gatewayRequest;
  // The gateway signed in to as soon as its address and a token (or the company sign-in) are there, not only when going
  // live: its PLCs listed (one chosen when it has only one), their states and what it offers shown before going live
  const liveSettingsNow = useRef(liveSettings);
  liveSettingsNow.current = liveSettings;
  useEffect(() => {
    if (liveMode !== 'web' || liveVia !== 'gateway') return;
    const address = liveSettings.gateway || gatewayOrigin;
    if (!address || (!gatewayToken && !ssoUser)) return;
    const key = `${address}|${ssoUser ? `sso:${ssoUser}` : gatewayToken}`;
    if (gatewayTriedRef.current.has(key)) return;
    // (a moment after the last change: not each key typed)
    const t = window.setTimeout(() => {
      gatewayTriedRef.current.add(key);
      gatewayConnection()
        .connect(address, gatewayToken, !!ssoUser)
        .then(({ user, plcs, features }) => {
          setGatewayFeatures(features ?? []);
          setLiveStatus((prev) => ({ ...prev, user, plcs, ...(prev.state === 'connected' || prev.state === 'connecting' ? {} : { message: `Signed in as ${user}: ${plcs.length === 1 ? plcs[0].name : `${plcs.length} PLCs`}` }) }));
          const now = liveSettingsNow.current;
          if (!plcs.some((x) => x.id === now.plc) && plcs.length === 1) handleLiveSettingsChange({ ...now, plc: plcs[0].id });
        })
        .catch((err: Error) => setLiveStatus((prev) => (prev.state === 'connected' || prev.state === 'connecting' ? prev : { ...prev, message: err.message })));
    }, 1200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode, liveVia, liveSettings.gateway, gatewayOrigin, gatewayToken, ssoUser]);
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
  // Which code Link runs (from its welcome): another stamp than this page's: another version of Link, said in the
  // Live tab (a Link started from an old install, as the Start menu's)
  const [linkBuild, setLinkBuild] = useState<HelperBuild | null>(null);
  // (for the callbacks declared above: what this Link can do)
  linkBuildRef.current = linkBuild;
  const linkNotice = linkBuild && linkBuild.stamp !== __KSS_LINK_STAMP__
    ? linkBuild.from === 'old'
      ? 'The Link on this computer is an older version (from before it said which). Update it: npm run build:link, or the installer, then start Link again.'
      : `The Link on this computer is another version than this page (${linkBuild.from === 'source' ? 'run from source' : `built ${linkBuild.built ? new Date(linkBuild.built).toLocaleString() : '?'}`}, code ${linkBuild.stamp}; this page: ${__KSS_LINK_STAMP__}). Update it: npm run build:link, or the installer, then start Link again.`
    : null;
  // The Link notice's Update Link: Link checks for a newer release and updates itself (it starts again); a Link built
  // here, newer than the released one, is rebuilt instead. What happened, for the notice
  const handleUpdateLink = useCallback(async (): Promise<string> => {
    type UpdateAnswer = { ok?: boolean; message?: string; status?: { version?: string; newer?: boolean; canUpdate?: boolean; error?: string | null; latest?: { version: string } | null } };
    try {
      const c = await linkRequest<UpdateAnswer>({ type: 'linkUpdate', action: 'check' }, 'linkUpdateResult');
      const st = c.status ?? {};
      if (st.error) return `Could not check: ${st.error}`;
      if (!st.canUpdate) return 'This Link runs from its sources: update it from the repository (npm run build:link), then start it again';
      if (!st.newer) return `No newer Link released (Link ${st.version ?? '?'}; this page is a newer build): npm run build:link, then start Link again`;
      const r = await linkRequest<UpdateAnswer>({ type: 'linkUpdate', action: 'install' }, 'linkUpdateResult');
      return r.ok === false ? r.message ?? 'Link did not update' : `Link ${st.latest?.version ?? ''} installed: it is starting again (go live again then)`;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [linkRequest]);
  // (the PLC's project kept on this computer: see requestPlcCopy)
  const canCopyProject = !replay && (liveMode === 'desktop' ? !!desktopLive()?.projectCopy : liveMode === 'web' && liveVia === 'link' && !!linkBuild?.features?.includes('plcProjectCopy'));
  // Once per PLC connected to (not while replaying a recording)
  useEffect(() => {
    const target = liveStatus.target ?? '';
    // (stopped: going live again checks again; a connection lost and back does not ask again)
    if (liveStatus.state === 'stopped') plcCopyAskedRef.current = '';
    if (liveStatus.state !== 'connected' || !target || !canCopyProject || plcCopyAskedRef.current === target) return;
    plcCopyAskedRef.current = target;
    let folder: string | undefined;
    try {
      folder = localStorage.getItem(copyFolderKey(target)) || undefined;
    } catch {
      folder = undefined;
    }
    // (the loaded POU's own project running there: nothing downloaded)
    const skipProjects = [liveProject, plcOrigin?.project, plcOrigin?.plcProject].filter((x): x is string => !!x);
    // (a POU of no known project, a sample or a file on its own: which project it is from is not known, nothing kept)
    if (!skipProjects.length) return;
    void requestPlcCopy({ folder, skipProjects }).then((r) => handlePlcCopy(r, target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStatus.state, liveStatus.target, canCopyProject]);
  const viaLink = liveMode === 'web' && liveVia === 'link';

  // ---- The POU's layout file (<POU>.machinescope.json beside it: for git, shared with the other developers) ----
  // The states' places, the transitions' routes and labels, the notes and the states' documentation, the chart's look:
  // read when the POU is loaded, written a moment after each change of the user's (only when it differs; the canvas'
  // own placing is not one). Kept by the host that has the POU's folder: the desktop app, XAE, Link (a PLC project it
  // keeps), the web edition with a folder granted (its project folder, or one chosen for it); else in this browser.
  // Followed while open: changed on disk (a git pull, a checkout), read again (asked first when edited here too).
  // The theme, the presets, the dock, bookmarks and live recordings stay each user's own; the look too, when chosen.
  const layoutLink = useCallback<() => LinkRequest | null>(
    () => (viaLink && gatewayRef.current && linkBuildRef.current?.features?.includes('layoutFile') ? (m, a, t) => gatewayRef.current!.request(m as never, a, t) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viaLink, gatewayFeatures]
  );
  // (the web edition: the POU's folder granted, its project folder or one chosen for it)
  const [webLayoutPou, setWebLayoutPou] = useState<string | null>(null);
  const [webLayoutTick, setWebLayoutTick] = useState(0);
  const hostedPou = layoutHost(pouPath, layoutLink()) ? pouPath! : null;
  useEffect(() => {
    if (hostedPou || isXaeHost() || desktopLive() || !pouContent || !/\.TcPOU$/i.test(pouFileName)) return setWebLayoutPou(null);
    let gone = false;
    void webLayoutReady(pouFileName).then((ok) => !gone && setWebLayoutPou(ok ? pouFileName : null));
    return () => {
      gone = true;
    };
  }, [hostedPou, pouFileName, pouContent, webLayoutTick]);
  const layoutPou = hostedPou ?? (webLayoutPou ? WEB_LAYOUT_PREFIX + webLayoutPou : null);
  const ownLookKey = `kss.layout.ownLook.${(pouFileName || 'POU').replace(/\.TcPOU$/i, '')}`;
  const [ownLook, setOwnLookState] = useState(false);
  useEffect(() => {
    try {
      setOwnLookState(localStorage.getItem(ownLookKey) === '1');
    } catch {
      setOwnLookState(false);
    }
  }, [ownLookKey]);
  const [layoutEdges, setLayoutEdges] = useState<EdgeOffsetsMap>({});
  const layoutEdgesRef = useRef(layoutEdges);
  layoutEdgesRef.current = layoutEdges;
  // (put back by an undo / redo: on the canvas' drawing as it is)
  const [edgeRestore, setEdgeRestore] = useState<{ key: string; edges: EdgeOffsetsMap } | null>(null);
  edgeUndoRef.current = {
    get: () => layoutEdgesRef.current,
    restore: (edges) => {
      setLayoutEdges(edges);
      setEdgeRestore({ key: `${Date.now()}`, edges });
    },
  };
  const handleCanvasEdgeOffsets = useCallback(
    (next: EdgeOffsetsMap, opts?: { user?: boolean }) => {
      if (opts?.user) pushEdgeStep(layoutEdgesRef.current);
      setLayoutEdges(next);
    },
    [pushEdgeStep]
  );
  const [layoutSeed, setLayoutSeed] = useState<{ key: string; edges: EdgeOffsetsMap } | null>(null);
  const [layoutPins, setLayoutPins] = useState<{ key: string; positions: Record<string, { centerX: number; centerY: number }> } | null>(null);
  const [layoutStatus, setLayoutStatus] = useState<LayoutStatus | null>(null);
  // (the file as read or last written: its text, its layout; what was taken from it, to tell the user's changes from
  // the canvas' own placing: the states' offsets put, the routes' text, the notes' and look's text)
  const layoutRef = useRef<{
    pou: string | null;
    ready: boolean;
    text: string | null;
    file: PouLayout | null;
    states: NodeOffsetsMap | null;
    edges: string;
    marks: string;
    autoStates: NodeOffsetsMap | null;
    unsaved: boolean;
    asking: boolean;
  }>({ pou: null, ready: false, text: null, file: null, states: null, edges: '{}', marks: '', autoStates: null, unsaved: false, asking: false });
  autoNodeOffsetsRef.current = (o) => {
    layoutRef.current.autoStates = o;
  };
  const marksOf = (notes: DiagramNotes, look: PouLayout['look'] | null) => JSON.stringify([notes, look]);
  const canvasPositionsRef = useRef(canvasPositions);
  canvasPositionsRef.current = canvasPositions;
  const lookNow = (): PouLayout['look'] => ({ states: customNodeStyles, transitions: customEdgeStyles, collapsed: collapsedComposites });
  // The file's layout put on the canvas (read at load, or again: changed on disk)
  // A layout file git could not merge (conflict markers): Merge both (each state's place, route, note and colour from
  // either side; one changed on both: yours), or one side; written back without the markers (then git add it to
  // finish the merge). Not now: left as it is (Read the file again asks again)
  const conflictAskedRef = useRef<string | null>(null);
  const askLayoutConflict = (pou: string, text: string, sides: { ours: PouLayout; theirs: PouLayout }, force = false) => {
    if (!force && conflictAskedRef.current === text) return;
    conflictAskedRef.current = text;
    const file = layoutFileNameOf(pouNameOf(pou));
    const resolve = (layout: PouLayout, how: string) => {
      const next = serializeLayout(layout);
      void writeLayoutFile(pou, next, layoutLink()).then((r) => {
        if (layoutRef.current.pou !== pou) return;
        if (r.error) return setLayoutStatus({ file, state: 'error', detail: r.error });
        applyLayoutText(pou, next);
        showCopyToast(`${file}: ${how}, the conflict markers gone. git add it to finish the merge`, 'success');
      });
    };
    const count = (l: PouLayout) => `${Object.keys(l.states).length} states moved, ${Object.values(l.transitions).reduce((n, m) => n + Object.keys(m).length, 0)} routes, ${Object.keys(l.notes.nodes).length + Object.keys(l.notes.edges).length} notes`;
    const sideOnly = () =>
      setPromptRequest({
        title: 'The layout file: one side',
        label: `${file}: keep one side of the conflict, the other dropped (git still has it).`,
        details: [`Yours: ${count(sides.ours)}`, `Theirs: ${count(sides.theirs)}`],
        confirmOnly: true,
        submitLabel: 'Keep mine',
        onSubmit: () => resolve(sides.ours, 'yours kept'),
        altAction: { id: 'layout-conflict-theirs', label: 'Take theirs', title: 'Their side of the conflict, yours dropped', run: () => resolve(sides.theirs, 'theirs taken') },
        cancelLabel: 'Not now',
      });
    setPromptRequest({
      title: 'The layout file has a merge conflict',
      label: `${file}: git could not merge the two layouts.`,
      // (what differs, and what Merge both does with each: before choosing)
      details: (() => {
        const diff = diffLayouts(sides.ours, sides.theirs);
        return [
          `Yours: ${count(sides.ours)} · theirs: ${count(sides.theirs)}`,
          'Merge both: each state\'s place, route, note and colour from either side; one changed on both sides: yours',
          ...(diff.length ? [`${diff.length} difference${diff.length === 1 ? '' : 's'}:`, ...diff.slice(0, 60), ...(diff.length > 60 ? [`… ${diff.length - 60} more`] : [])] : ['No difference in the states, routes, notes or colours (only the states\' places as drawn)']),
        ];
      })(),
      confirmOnly: true,
      submitLabel: 'Merge both',
      onSubmit: () => resolve(mergeLayouts(sides.ours, sides.theirs), 'both merged'),
      altAction: { id: 'layout-conflict-one-side', label: 'One side…', title: 'Keep yours or take theirs', run: sideOnly },
      cancelLabel: 'Not now',
    });
  };
  const applyLayoutText = (pou: string, text: string | null) => {
    const file = layoutFileNameOf(pouNameOf(pou));
    const parsed = text ? parseLayout(text) : null;
    if (parsed && 'error' in parsed) {
      // (a file that is not one, or a newer one: left as it is, not written over; one git could not merge: asked how)
      layoutRef.current = { ...layoutRef.current, ready: false, text };
      const conflict = text ? readConflict(text) : null;
      setLayoutStatus({ file, state: 'error', detail: conflict ? ('error' in conflict ? `A merge conflict in it, not readable: ${conflict.error}` : 'A merge conflict in it (git): choose how to resolve it (Read the file again asks again)') : parsed.error });
      if (conflict && !('error' in conflict)) askLayoutConflict(pou, text!, conflict);
      return;
    }
    const key = `${pou}|${Date.now()}`;
    const states = parsed && parsed.layoutEngine === layoutEngine ? parsed.states : {};
    const edges = parsed?.transitions[layoutEngine] ?? {};
    setNodeOffsets(states);
    setLayoutSeed({ key, edges });
    setLayoutEdges(edges);
    let look: PouLayout['look'] | null = null;
    if (parsed) {
      setDiagramNotes(parsed.notes);
      if (!ownLook) {
        look = parsed.look;
        setCustomNodeStyles(parsed.look.states);
        setCustomEdgeStyles(parsed.look.transitions);
        setCollapsedComposites(parsed.look.collapsed);
      }
      // (made with another layout engine: its states put at its places, as a whole where this one's drawing starts)
      if (parsed.layoutEngine !== layoutEngine && Object.keys(parsed.places).length) {
        setLayoutPins({ key, positions: Object.fromEntries(Object.entries(parsed.places).map(([id, q]) => [id, { centerX: q.x, centerY: q.y }])) });
      }
    }
    layoutRef.current = {
      ...layoutRef.current,
      ready: true,
      text,
      file: parsed,
      states,
      edges: JSON.stringify(stableEdges(edges)),
      marks: marksOf(parsed?.notes ?? diagramNotes, ownLook ? parsed?.look ?? null : parsed?.look ?? lookNow()),
      autoStates: null,
      unsaved: false,
    };
    setLayoutStatus(
      !parsed
        ? { file, state: 'new' }
        : parsed.layoutEngine !== layoutEngine
          ? { file, state: 'other-engine', detail: `Made with ${parsed.layoutEngine.toUpperCase()}: its states put at its places; its routes are ${parsed.layoutEngine.toUpperCase()}'s (kept as they are)` }
          : { file, state: 'loaded' }
    );
  };
  useEffect(() => {
    const pou = layoutPou;
    layoutRef.current = { pou, ready: false, text: null, file: null, states: null, edges: '{}', marks: '', autoStates: null, unsaved: false, asking: false };
    setLayoutEdges({});
    if (!pou) {
      setLayoutStatus(pouContent ? { file: null, state: 'browser' } : null);
      return;
    }
    const file = layoutFileNameOf(pouNameOf(pou));
    let gone = false;
    void readLayoutFile(pou, layoutLink()).then((r) => {
      if (gone || layoutRef.current.pou !== pou) return;
      if (r.error) return setLayoutStatus({ file, state: 'error', detail: r.error });
      applyLayoutText(pou, r.text ?? null);
    });
    return () => {
      gone = true;
    };
    // (when the POU or where it is kept changes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutPou]);
  // Another layout engine chosen: the file put on its drawing again (its offsets, or the other engine's places)
  const layoutEngineRef = useRef(layoutEngine);
  useEffect(() => {
    if (layoutEngineRef.current === layoutEngine) return;
    layoutEngineRef.current = layoutEngine;
    const L = layoutRef.current;
    if (L.pou && L.ready && !L.unsaved) applyLayoutText(L.pou, L.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutEngine]);
  // Written a moment after a change of the user's, when it differs: the states moved (not by the canvas itself), a
  // route dragged, a note, the look; with all the states' places as drawn (another engine puts its states there)
  useEffect(() => {
    const pou = layoutRef.current.pou;
    if (!pou || !layoutRef.current.ready) return;
    const L = layoutRef.current;
    const marks = marksOf(diagramNotes, ownLook ? L.file?.look ?? null : lookNow());
    const moved = nodeOffsets !== L.states && nodeOffsets !== L.autoStates;
    const routed = JSON.stringify(stableEdges(layoutEdges)) !== L.edges;
    const marked = marks !== L.marks;
    if (!moved && !routed && !marked) return;
    L.unsaved = true;
    const t = window.setTimeout(() => {
      const L = layoutRef.current;
      if (L.pou !== pou || !L.ready || L.asking) return;
      const places: PouLayout['places'] = {};
      for (const [id, q] of Object.entries(canvasPositionsRef.current)) if (!id.startsWith('note_')) places[id] = { x: q.centerX, y: q.centerY };
      const layout: PouLayout = {
        pou: pouNameOf(pou),
        layoutEngine,
        states: nodeOffsets,
        places,
        transitions: { ...(L.file?.transitions ?? {}), [layoutEngine]: layoutEdges },
        notes: diagramNotes,
        look: ownLook ? L.file?.look ?? emptyLook : lookNow(),
      };
      if (!L.text && isEmptyLayout(layout)) return void (L.unsaved = false);
      const text = serializeLayout(layout);
      if (text === L.text) return void (L.unsaved = false);
      const file = layoutFileNameOf(layout.pou);
      void writeLayoutFile(pou, text, layoutLink()).then((r) => {
        if (layoutRef.current.pou !== pou) return;
        if (r.error) return setLayoutStatus({ file, state: 'error', detail: r.error });
        // (what is in the file now: the next changes told from it)
        Object.assign(layoutRef.current, { text, file: layout, states: nodeOffsets, edges: JSON.stringify(stableEdges(layoutEdges)), marks, autoStates: null, unsaved: false });
        setLayoutStatus({ file, state: 'saved' });
      });
    }, 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeOffsets, layoutEdges, diagramNotes, customNodeStyles, customEdgeStyles, collapsedComposites, ownLook]);
  // Followed on disk: read every few seconds while shown (and when the window is back); changed there (git), read
  // again; edited here too, the user asked which to keep
  const reloadLayout = async (quiet: boolean) => {
      const L = layoutRef.current;
      const pou = L.pou;
      if (!pou || L.asking) return;
      const r = await readLayoutFile(pou, layoutLink());
      if (layoutRef.current.pou !== pou || r.error) return;
      const text = r.text ?? null;
      if (text === layoutRef.current.text) {
        // (still the conflict: asked again)
        const conflict = !quiet && text ? readConflict(text) : null;
        if (conflict && !('error' in conflict)) return askLayoutConflict(pou, text!, conflict, true);
        if (!quiet) showCopyToast('The layout file has not changed', 'success');
        return;
      }
      const file = layoutFileNameOf(pouNameOf(pou));
      if (!layoutRef.current.unsaved) {
        applyLayoutText(pou, text);
        showCopyToast(`${file} changed on disk: read again`, 'success');
        return;
      }
      layoutRef.current.asking = true;
      let took = false;
      setPromptRequest({
        title: 'The layout file changed',
        label: `${file} was changed on disk (a git pull or checkout?) while you moved states or edited notes here.`,
        details: ["Take the file's: your changes since it was last read are dropped", 'Keep mine: your layout is written over it (git still has the other one)'],
        confirmOnly: true,
        submitLabel: "Take the file's",
        onSubmit: () => {
          took = true;
        },
        onDismiss: () => {
          layoutRef.current.asking = false;
          if (layoutRef.current.pou !== pou) return;
          if (took) return applyLayoutText(pou, text);
          // (mine: written over it, as a change of the user's)
          layoutRef.current.text = text;
          layoutRef.current.edges = '';
          setLayoutEdges((e) => ({ ...e }));
        },
      });
  };
  const reloadLayoutRef = useRef(reloadLayout);
  reloadLayoutRef.current = reloadLayout;
  useEffect(() => {
    if (!layoutPou) return;
    const poll = () => document.visibilityState === 'visible' && (layoutRef.current.ready || layoutRef.current.text !== null) && void reloadLayoutRef.current(true);
    const timer = window.setInterval(poll, 3000);
    window.addEventListener('focus', poll);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', poll);
    };
  }, [layoutPou]);
  // (the chart's look this user's own: kept in this browser; the file's left as it is)
  const setOwnLook = useCallback(
    (on: boolean) => {
      setOwnLookState(on);
      try {
        if (on) localStorage.setItem(ownLookKey, '1');
        else localStorage.removeItem(ownLookKey);
      } catch {
        // (this session only)
      }
      // (the team's look again: the file's)
      const look = layoutRef.current.file?.look;
      if (!on && look) {
        setCustomNodeStyles(look.states);
        setCustomEdgeStyles(look.transitions);
        setCollapsedComposites(look.collapsed);
        layoutRef.current.marks = marksOf(diagramNotes, look);
      }
      showCopyToast(on ? 'The chart\'s look is yours now: the layout file\'s is left as it is' : "The team's look: the layout file's", 'success');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownLookKey, diagramNotes, showCopyToast]
  );
  const layoutMenu = useMemo<LayoutMenu | null>(() => {
    const web = !hostedPou && !isXaeHost() && !desktopLive() && !!pouContent && /\.TcPOU$/i.test(pouFileName);
    if (!layoutPou && !web) return null;
    return {
      onPickFolder: web
        ? () =>
            void pickWebLayoutFolder(pouFileName).then((err) => {
              if (err === 'canceled') return;
              if (err) return showCopyToast(err, 'error');
              setWebLayoutTick((v) => v + 1);
            })
        : undefined,
      onReload: layoutPou ? () => void reloadLayoutRef.current(false) : undefined,
      ownLook,
      onOwnLookChange: layoutPou ? setOwnLook : undefined,
    };
  }, [hostedPou, layoutPou, pouContent, pouFileName, ownLook, setOwnLook, showCopyToast]);
  // A box's device details for the I/O tab: TwinCAT's device descriptions and the user's pictures (the desktop app;
  // Link, also offline with its pairing code)
  const ioViaLink = !desktopLive() && !isXaeHost() && liveVia === 'link' && !!linkCode;
  // (a gateway: its own device descriptions and pictures, while connected to it)
  const ioViaGateway = liveMode === 'web' && liveVia === 'gateway' && gatewayFeatures.includes('deviceInfo') && liveStatus.state === 'connected';
  const fetchDeviceInfo = useMemo(() => {
    const api = desktopLive()?.deviceInfo;
    if (api) return (req: DeviceInfoRequest) => api(req);
    const msg = (req: DeviceInfoRequest) => ({ type: 'deviceInfo', productCode: req.productCode, revision: req.revision, deviceType: req.type, product: req.product });
    if (ioViaLink) return (req: DeviceInfoRequest) => linkRequest<DeviceInfo>(msg(req), 'deviceInfoResult');
    if (ioViaGateway) return (req: DeviceInfoRequest) => (gatewayRef.current ? gatewayRef.current.request<DeviceInfo>(msg(req), 'deviceInfoResult', 20000) : Promise.reject(new Error('Not connected')));
    return undefined;
  }, [ioViaLink, ioViaGateway, linkRequest]);
  const openDevicesFolder = desktopLive()?.openDevicesFolder
    ? () => void desktopLive()!.openDevicesFolder!().then((r) => r.error && showCopyToast(`Could not open ${r.folder}: ${r.error}`, 'error'))
    : undefined;
  const handleScanPlcs = useMemo(() => {
    if (viaLink) {
      return (addresses: string[]) => linkRequest<PlcScanResult>({ type: 'discover', addresses }, 'discoverResult').catch((err: Error) => ({ devices: [], errors: [err.message] }));
    }
    return canScanPlcs() ? (addresses: string[]) => scanPlcs(addresses, liveSettings.localNetId.trim()) : undefined;
  }, [viaLink, linkRequest, liveSettings.localNetId]);
  const handleAddRoute = useMemo(() => {
    const localNetId = liveSettings.localNetId.trim() || undefined;
    if (viaLink) {
      return (d: FoundPlc, user: string, password: string, both?: AddRouteBoth) =>
        linkRequest<AddRouteResult>({ type: 'addRoute', plcIp: d.ip, plcNetId: d.netId, plcName: d.name, user, password, localNetId, ...(both ?? {}) }, 'addRouteResult').catch((err: Error) => ({ ok: false, message: err.message }));
    }
    return canScanPlcs() ? (d: FoundPlc, user: string, password: string, both?: AddRouteBoth) => addRouteOnPlc({ plcIp: d.ip, netId: d.netId, name: d.name, user, password, localNetId, ...(both ?? {}) }) : undefined;
  }, [viaLink, linkRequest, liveSettings.localNetId]);
  // Browse: a found PLC started, not live (after a confirmation: its PLC from Stop, or TwinCAT from Config to Run
  // mode), and the found PLCs' states again while Browse is open (the desktop app, a Link that can)
  const handlePlcStartAt = useMemo(() => {
    const localNetId = liveSettings.localNetId.trim() || undefined;
    const req = (d: FoundPlc, mode: PlcControlMode) => ({ requestId: Date.now() % 1e9, connection: { netId: d.netId, ip: d.ip || undefined, localNetId }, mode });
    const api = desktopLive();
    if (api?.startAt) return (d: FoundPlc, mode: PlcControlMode) => api.startAt!(req(d, mode));
    if (viaLink && linkBuild?.features?.includes('plcStartAt'))
      return (d: FoundPlc, mode: PlcControlMode) =>
        linkRequest<PlcControlResult>({ type: 'plcStartAt', ...req(d, mode) }, 'plcStartAtResult', 70000).catch((e: Error) => ({ state: null, ok: false, error: e.message }));
    return undefined;
  }, [viaLink, linkBuild, linkRequest, liveSettings.localNetId]);
  const plcControlModes: PlcControlMode[] = viaLink && !linkBuild?.features?.includes('plcStopAt') ? ['plc', 'run'] : ALL_PLC_CONTROLS;
  // The gateway's PLC chosen, not live: its state (the Live tab reads it every few seconds) and Start / Stop / Restart /
  // Run mode (a write: as the gateway allows; asked first)
  const viaGatewayHere = liveMode === 'web' && liveVia === 'gateway';
  const handleGatewayPlcState = useMemo(() => {
    if (!viaGatewayHere || !liveSettings.plc || !gatewayFeatures.includes('plcStatesRefresh')) return undefined;
    const plc = liveSettings.plc;
    return () => gatewayRequest<{ devices?: { state?: PlcState; name?: string }[] }>({ type: 'plcStates', plcs: [plc] }, 'plcStatesResult').then((r) => r.devices?.[0]);
  }, [viaGatewayHere, liveSettings.plc, gatewayFeatures, gatewayRequest]);
  const handleGatewayPlcControl = useMemo(() => {
    if (!viaGatewayHere || !liveSettings.plc || !gatewayFeatures.includes('plcStartAt')) return undefined;
    const plc = liveSettings.plc;
    return (mode: PlcControlMode) => gatewayRequest<PlcControlResult>({ type: 'plcStartAt', plc, mode }, 'plcStartAtResult').catch((e: Error) => ({ state: null, ok: false, error: e.message }));
  }, [viaGatewayHere, liveSettings.plc, gatewayFeatures, gatewayRequest]);
  const gatewayPlcControlModes: PlcControlMode[] = gatewayFeatures.includes('plcStopAt') ? ALL_PLC_CONTROLS : [];
  const handleGatewayPlcStates = useMemo(() => {
    if (!viaGatewayHere || !gatewayFeatures.includes('plcStatesRefresh')) return undefined;
    return (ids: string[]) => gatewayRequest<{ devices?: { id?: string; state?: PlcState }[] }>({ type: 'plcStates', plcs: ids }, 'plcStatesResult').then((r) => r.devices ?? []);
  }, [viaGatewayHere, gatewayFeatures, gatewayRequest]);
  const handleGatewayPlcHistory = useMemo(() => {
    if (!viaGatewayHere || !liveSettings.plc || !gatewayFeatures.includes('plcHistory')) return undefined;
    const plc = liveSettings.plc;
    return () =>
      gatewayRequest<{ entries?: PlcActionEntry[]; error?: string }>({ type: 'plcHistory', plc, limit: 500 }, 'plcHistoryResult').then((r) => {
        if (r.error) throw new Error(r.error);
        return r.entries ?? [];
      });
  }, [viaGatewayHere, liveSettings.plc, gatewayFeatures, gatewayRequest]);
  const handleRefreshPlcStates = useMemo(() => {
    const localNetId = liveSettings.localNetId.trim() || undefined;
    const req = (devices: FoundPlc[]) => ({ requestId: Date.now() % 1e9, localNetId, devices: devices.map((d) => ({ netId: d.netId, ip: d.ip ?? '', name: d.name })) });
    const api = desktopLive();
    if (api?.plcStates) return (devices: FoundPlc[]) => api.plcStates!(req(devices)).then((r) => r.devices ?? []);
    if (viaLink && linkBuild?.features?.includes('plcStatesRefresh'))
      return (devices: FoundPlc[]) => linkRequest<{ devices?: FoundPlc[] }>({ type: 'plcStates', ...req(devices) }, 'plcStatesResult', 20000).then((r) => r.devices ?? []);
    return undefined;
  }, [viaLink, linkBuild, linkRequest, liveSettings.localNetId]);
  // TwinCAT XAE opened on this computer (the desktop app, Link): its license page renews a trial license
  const handleOpenXae = useMemo(() => {
    const api = desktopLive();
    if (api?.openXae) return () => api.openXae!();
    if (viaLink && linkBuild?.features?.includes('openXae')) return () => linkRequest<{ ok: boolean; message: string }>({ type: 'openXae' }, 'openXaeResult').catch((e: Error) => ({ ok: false, message: e.message }));
    return undefined;
  }, [viaLink, linkBuild, linkRequest]);
  // Web edition through Link or the gateway: Build from the TwinCAT project's folder (granted once, read and write):
  // its files sent there (only the new or changed ones, gzip-compressed when it saves; the list not even sent when
  // nothing changed since the last build), built there by XAE with this POU and its enum as edited here; after a
  // write, the new compile information written into the folder and this POU saved (XAE there still matches the PLC)
  const webProjectSyncRef = useRef<{ key: string; uploadId: string } | null>(null);
  const runWebProjectBuild = useCallback(
    async (write: PlcWrite | null) => {
      const viaGateway = !viaLink;
      const host = viaGateway ? 'the gateway' : 'Link';
      const ask = viaGateway ? gatewayRequest : linkRequest;
      const base: PlcBuildState = { phase: write ? 'writing' : 'building', write, files: [pouFileName || 'the POU', ...(dutContent && dutFileName ? [dutFileName] : [])], project: 'your TwinCAT project', target: liveStatus.target, via: 'webProject', sentTo: host, step: 'Reading the project folder' };
      setPlcBuild(base);
      setPlcBuildShown(true);
      const fail = (fatal: string) => setPlcBuild({ ...base, phase: 'done', result: { ok: false, fatal } });
      const folder = await webProjectFolder(pouFileName, dutFileName);
      if ('error' in folder) {
        if (folder.error === 'canceled') {
          setPlcBuild(null);
          setPlcBuildShown(false);
        } else fail(`The project folder: ${folder.error}`);
        return;
      }
      if (!folder.pouPath) return fail(`${pouFileName} is not in ${folder.name}: choose the folder of this POU's TwinCAT project`);
      // (its project folder granted: the layout file kept beside the POU there too)
      setWebLayoutTick((v) => v + 1);
      // (the folder as it is now: the same as at the last build, sent to the same place: nothing to send)
      const key = `${host}|${folder.name}|${folder.files.map((f) => `${f.path}:${f.size}:${f.mtime}`).join('|')}`;
      const send = async (): Promise<string | null> => {
        const sync = await ask<{ uploadId?: string; need?: string[]; error?: string }>({ type: 'projectSync', project: folder.name, files: folder.files.map(({ path, size, mtime }) => ({ path, size, mtime })) }, 'projectSyncResult');
        if (!sync.uploadId) {
          fail(sync.error ?? `${host} did not take the project`);
          return null;
        }
        const need = new Set(sync.need ?? []);
        const todo = folder.files.filter((f) => need.has(f.path));
        const CHUNK = 150 * 1024;
        for (let n = 0; n < todo.length; n++) {
          const f = todo[n];
          setPlcBuild((b) => (b && b.phase !== 'done' ? { ...b, step: `Sending the project to ${host} (${n + 1} of ${todo.length} files)` } : b));
          const raw = new Uint8Array(await f.read());
          // (compressed when that saves a tenth or more: XML sources, compile information)
          let data = raw;
          let encoding: string | undefined;
          if (raw.length > 2048 && typeof CompressionStream !== 'undefined') {
            const gz = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
            if (gz.length < raw.length * 0.9) {
              data = gz;
              encoding = 'gzip';
            }
          }
          for (let off = 0; ; off += CHUNK) {
            const done = off + CHUNK >= data.length;
            const r = await ask<{ ok?: boolean; error?: string }>({ type: 'projectPut', uploadId: sync.uploadId, path: f.path, offset: off, data: bytesToBase64(data.subarray(off, off + CHUNK)), size: raw.length, mtime: f.mtime, done, ...(encoding ? { encoding } : {}) }, 'projectPutResult');
            if (!r.ok) {
              fail(r.error ?? `${host} did not take ${f.path}`);
              return null;
            }
            if (done) break;
          }
        }
        webProjectSyncRef.current = { key, uploadId: sync.uploadId };
        return sync.uploadId;
      };
      try {
        const edits = [{ file: folder.pouPath, content: pouContent }, ...(folder.dutPath && dutContent ? [{ file: folder.dutPath, content: dutContent }] : [])];
        const build = (uploadId: string) => gatewayConnection().request<PlcBuildResult>({ type: 'projectBuild', uploadId, file: folder.pouPath, edits, write }, 'plcBuildResult', 45 * 60 * 1000);
        let uploadId = webProjectSyncRef.current?.key === key ? webProjectSyncRef.current.uploadId : await send();
        if (!uploadId) return;
        let r = await build(uploadId);
        // (the copy there gone meanwhile: the page connected again, or the other side restarted: sent again, once)
        if (!r.ok && /is not on (this computer|the gateway) yet/.test(r.fatal ?? '')) {
          webProjectSyncRef.current = null;
          uploadId = await send();
          if (!uploadId) return;
          r = await build(uploadId);
        }
        if (r.ok && r.written) {
          // The new compile information into the project folder; this POU saved
          const problems: string[] = [];
          for (const c of r.compileInfo ?? []) {
            const err = await writeWebProjectFile(c.path, base64ToBytes(c.data)).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
            if (err) problems.push(err);
          }
          if (problems.length) r.items = [...(r.items ?? []), { level: 'warning', text: `The new compile information did not go into the project folder (XAE's next login may not match): ${problems.join('; ')}`, file: '', line: 0 }];
          // (the folder changed: listed and sent again next time)
          webProjectSyncRef.current = null;
          void saveSourcesRef.current({ quiet: true, checked: true });
          showCopyToast(`Written to the PLC (${r.written === 'online' ? 'online change' : r.written === 'download' ? 'downloaded' : 'configuration activated'})${r.compileInfo?.length && !problems.length ? ', the project\'s compile information updated' : ''}`, 'success', 7000);
        }
        delete r.compileInfo;
        setPlcBuild({ ...base, project: r.plcProject ?? base.project, phase: 'done', result: r });
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pouFileName, pouContent, dutFileName, dutContent, liveStatus.target, linkRequest, gatewayRequest, gatewayConnection, viaLink, showCopyToast]
  );
  // The PLC application started (after a write left it in Stop): the desktop app, Link or the gateway
  const handleStartPlc = useMemo(() => {
    const api = desktopLive();
    if (api?.startPlc) return () => api.startPlc!({ requestId: Date.now() % 1e9 });
    const can = viaLink ? linkBuild?.features?.includes('plcStart') : liveMode === 'web' && gatewayFeatures.includes('plcStart');
    if (!can) return undefined;
    return () => gatewayConnection().request<{ state: string | null; ok: boolean; error?: string }>({ type: 'plcStart' }, 'plcStartResult', 30000);
  }, [viaLink, linkBuild, liveMode, gatewayFeatures, gatewayConnection]);
  // The Live tab's Check: why the PLC does not answer, from the computer that talks to it (desktop app, Link)
  // (any PLC: the target's by default; Browse's Check all asks each remembered one)
  const handleCheckPlc = useMemo(() => {
    if (viaLink) return (req: CheckRequest) => linkRequest<CheckResult>({ type: 'checkConnection', ...req }, 'checkConnectionResult');
    const api = desktopLive();
    return api?.checkConnection ? (req: CheckRequest) => api.checkConnection!(req) : undefined;
  }, [viaLink, linkRequest]);
  const handleCheckConnection = useMemo(() => {
    if (!handleCheckPlc) return undefined;
    return () => handleCheckPlc({ netId: liveSettings.netId.trim(), ip: liveSettings.ip.trim(), port: parseInt(liveSettings.port, 10) || undefined, localNetId: liveSettings.localNetId.trim() || undefined });
  }, [handleCheckPlc, liveSettings.netId, liveSettings.ip, liveSettings.port, liveSettings.localNetId]);
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
  // Measured state times (the session's transitions: live or a replay), on the diagram when asked for
  const measuredStateTimes = useMemo(() => stateTimes(liveSession.transitions), [liveSession.transitions]);
  const stateTimeBadges = useMemo(() => stateTimeLevels(measuredStateTimes), [measuredStateTimes]);
  const handleExportStateTimes = useCallback(() => {
    void downloadCsv(
      `state-times-${pouTypeName ?? 'POU'}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(['state', 'stays', 'average ms', 'median ms', '90% ms', 'shortest ms', 'longest ms', 'total ms'], measuredStateTimes.map((t) => [t.state, t.n, Math.round(t.avgMs), Math.round(t.medianMs), Math.round(t.p90Ms), t.minMs, t.maxMs, t.totalMs]))
    );
  }, [measuredStateTimes, pouTypeName]);
  // The PLC switcher: which remembered PLCs answer (every 30 s while there are some; not through a gateway)
  const [reachable, setReachable] = useState<Record<string, boolean | null>>({});
  const probeKey = liveMode && !(liveMode === 'web' && liveVia === 'gateway') ? rememberedPlcs.map((p) => `${p.netId}|${p.ip}`).join(',') : '';
  useEffect(() => {
    if (!probeKey) return;
    let stop = false;
    const targets = rememberedPlcs.map((p) => ({ key: p.netId, ip: p.ip || p.netId.split('.').slice(0, 4).join('.') }));
    const run = async () => {
      let r: Record<string, boolean> = {};
      if (liveMode === 'web') {
        if (!linkCode) return;
        r = await linkRequest<{ reachable: Record<string, boolean> }>({ type: 'probe', targets }, 'probeResult').then((x) => x.reachable).catch(() => ({}));
      } else r = await probePlcs(targets);
      if (!stop) setReachable(r);
    };
    void run();
    const t = window.setInterval(() => void run(), 30000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeKey]);
  // Updates (desktop, XAE): quietly once a day at start; from the Window menu on request
  // (installable: the installed desktop app's Update now; installing: its answer, while it downloads and after)
  const [updateOffer, setUpdateOffer] = useState<{ edition: string; version: string; current: string; url: string; installable?: boolean } | null>(null);
  const [updateInstall, setUpdateInstall] = useState<{ busy: boolean; text: string } | null>(null);
  const [updateQuiet, setUpdateQuiet] = useState(() => !!loadUpdateSettings().quiet);
  const handleInstallUpdate = useCallback(async () => {
    if (!updateOffer) return;
    setUpdateInstall({ busy: true, text: `Downloading ${updateOffer.version}…` });
    const r = await installDesktopUpdate(updateOffer.version, loadUpdateSettings());
    setUpdateInstall({ busy: r.ok, text: r.message });
  }, [updateOffer]);
  const runUpdateCheck = useCallback(
    async (quiet: boolean) => {
      const info = await appInfo();
      if (!info) {
        if (!quiet) showCopyToast('The web edition is updated with its gateway', 'success');
        return;
      }
      const settings = loadUpdateSettings();
      const r = await checkForUpdate(info.edition, info.version, settings, info.releasesUrl);
      saveUpdateSettings({ ...settings, lastCheck: Date.now() });
      if (r.state === 'newer') {
        if (quiet && settings.skipped === r.version) return;
        setUpdateInstall(null);
        setUpdateOffer({ edition: info.edition, version: r.version, current: info.version, url: r.url, installable: info.edition === 'desktop' && !!info.installable });
      } else if (!quiet) {
        if (r.state === 'current') showCopyToast(`Kval MachineScope ${info.edition === 'xae' ? 'for XAE' : 'desktop'} ${info.version} is the newest`, 'success');
        else if (r.state === 'no-access') {
          setPromptRequest({
            title: 'Updates: GitHub access',
            label: `${r.message}. A GitHub token with read access to ${settings.repo} (a fine-grained token: Contents, read-only) lets this app see its releases. It is kept in this app only.`,
            initial: settings.token,
            placeholder: 'github_pat_...',
            monospace: true,
            submitLabel: 'Save and check',
            onSubmit: (token) => {
              saveUpdateSettings({ ...loadUpdateSettings(), token: token.trim() });
              void runUpdateCheck(false);
            },
          });
        } else showCopyToast(r.message, 'error', 7000);
      }
    },
    [showCopyToast]
  );
  useEffect(() => {
    const s = loadUpdateSettings();
    if (Date.now() - (s.lastCheck ?? 0) < 20 * 3600000) return;
    const t = window.setTimeout(() => void runUpdateCheck(true), 8000);
    return () => window.clearTimeout(t);
  }, [runUpdateCheck]);
  const [showStateTimes, setShowStateTimesState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('kss.stateTimes.diagram') === '1';
    } catch {
      return false;
    }
  });
  const setShowStateTimes = useCallback((on: boolean) => {
    setShowStateTimesState(on);
    try {
      localStorage.setItem('kss.stateTimes.diagram', on ? '1' : '0');
    } catch {
      // per-viewer convenience only
    }
  }, []);
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
    void notifyStuck(`Kval MachineScope: ${who} is stuck`, `In ${liveSession.current.state} for more than ${formatLimit(liveLimit)}`, `kss-stuck-${who}`);
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
  // The Enum Editor, a sub-machine's state selected (on the canvas, in Identified States, at an editor's caret): its
  // sub-machine's enum, read-only here (its .TcDUT among the ones found, else made from its method's CASE labels)
  const enumSubView = useMemo(() => {
    const id = selectedStateId;
    const m = id ? subMachines.filter((x) => id.startsWith(`${x.parent}__${x.method}__`)).sort((a, b) => b.parent.length - a.parent.length)[0] ?? null : null;
    if (!m) return null;
    const type = m.variableType ?? `${m.method}.${m.variable}`;
    const prefix = `${m.parent}__${m.method}__`;
    // (its .TcDUT among the files found with the POU: edited here, saved to that file)
    const file = dutFiles.find((c) => !!c.content && parseDutContent(c.content).dutName.toLowerCase() === type.toLowerCase());
    if (file) {
      const key = dutFileKey(file);
      return { content: subDutEdits[key] ?? file.content, fileName: file.name, prefix, note: undefined as string | undefined, key };
    }
    const pool = [dutContent, ...dutPool, ...(projectDuts && projectDuts.path === pouPath ? projectDuts.contents : [])];
    const found = pool.find((c) => !!c && parseDutContent(c).dutName.toLowerCase() === type.toLowerCase());
    if (found) return { content: found, fileName: `${type}.TcDUT`, prefix, note: `${type}: the states of ${m.method}() (read-only here: its file is not among the ones found)` as string | undefined, key: undefined as string | undefined };
    return {
      content: `TYPE ${type} :\n(\n${m.states.map((x) => `\t${x}`).join(',\n')}\n);\nEND_TYPE\n`,
      fileName: `${type} (from ${m.method}())`,
      prefix,
      note: `${type}: the states of ${m.method}(), from its CASE labels (its .TcDUT is not open; read-only)` as string | undefined,
      key: undefined as string | undefined,
    };
  }, [selectedStateId, subMachines, dutContent, dutPool, dutFiles, subDutEdits, projectDuts, pouPath]);
  const liveEnums = useMemo(
    () => buildEnumTables([dutContent, ...dutPool, ...(projectDuts && projectDuts.path === pouPath ? projectDuts.contents : [])]),
    [dutContent, dutPool, projectDuts, pouPath]
  );
  // The live state's sub-machine (a method with its own state machine, called from its branch): its variable followed
  // (a method's VAR_INST: under the instance, found by the method's and the variable's names), its state named from
  // the PLC's enum (else the method's enum, when its .TcDUT is open)
  // (a sub-machine's state calling another with its own: that one's followed too, and so on)
  const liveSubLevels = useMemo(() => {
    const levels: { m: (typeof subMachines)[number]; watchId: string; state: string | null; id: (name: string) => string }[] = [];
    if (!liveActive || !liveSession.current) return levels;
    let parent: string | null = liveSession.current.state;
    for (let k = 0; parent && k < 8; k++) {
      const m = subMachines.find((x) => x.parent === parent);
      if (!m) break;
      const watchId = `sub:${m.parent}.${m.method}.${m.variable}`.toLowerCase();
      const v = liveVarValues[watchId];
      const w = liveWatched[watchId];
      const name = typeof v === 'number' ? w?.enumNames?.[String(v)] ?? liveEnums.types.get((w?.type ?? m.variableType ?? '').toLowerCase())?.get(v) : undefined;
      const state = name && m.states.includes(name) ? name : null;
      const id = (n: string) => `${m.parent}__${m.method}__${n}`;
      levels.push({ m, watchId, state, id });
      if (!state) break;
      parent = id(state);
    }
    return levels;
  }, [liveActive, liveSession.current?.state, subMachines, liveVarValues, liveWatched, liveEnums]);
  const liveSubWatchKey = liveSubLevels.map((L) => L.watchId).join('|');
  // Each level's step, kept in the session (the trail, a recording): its state changed while it ran; at the PLC's time
  const liveSubPrevRef = useRef<Record<string, { state: string; since: number }>>({});
  useEffect(() => {
    if (!liveActive) {
      liveSubPrevRef.current = {};
      return;
    }
    const now = Date.now() - (liveSession.clockOffset ?? 0);
    const prev = liveSubPrevRef.current;
    const next: Record<string, { state: string; since: number }> = {};
    const steps: NonNullable<LiveSession['subSteps']> = [];
    for (const L of liveSubLevels) {
      if (!L.state) continue;
      const was = prev[L.watchId];
      if (was && was.state !== L.state) steps.push({ t: now, method: L.m.method, from: L.id(was.state), to: L.id(L.state), dwellMs: Math.max(0, now - was.since) });
      next[L.watchId] = was && was.state === L.state ? was : { state: L.state, since: now };
    }
    liveSubPrevRef.current = next;
    if (steps.length) setLiveSession((s) => ({ ...s, subSteps: [...(s.subSteps ?? []), ...steps].slice(-MAX_LIVE_TRANSITIONS) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveActive, liveSubLevels]);
  const liveRegionStates = useMemo(
    () => [
      ...liveRegions
        .map((r) => {
          const v = liveVarValues[r.variable.toLowerCase()];
          const name = typeof v === 'number' ? liveEnumNames.get(v) : undefined;
          return name && r.states.includes(name) ? name : undefined;
        })
        .filter((s): s is string => !!s),
      // (its sub-machines' states, inside it)
      ...liveSubLevels.filter((L) => L.state).map((L) => L.id(L.state!)),
    ],
    [liveRegions, liveVarValues, liveEnumNames, liveSubLevels]
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
  const liveGuardEdges = useMemo(() => {
    if (!liveActive || liveGuardScope === 'off') return null;
    try {
      const model = generateStatechartModel(dutContent, pouContent, {
        flowchartOutput,
        collapseErrorSinkEdges, choiceNodes, spellOutElse,
        includeStateDescriptions, stateActions,
        showTransitionPriorities,
        priorityFormat, collapsedComposites,
      });
      // The generator's own edges (their ids are the diagram's: notes do not change the order of the lines)
      return { stateVar: model.stateVar, edges: buildGuardEdges(model.edges, extractEdgesFromMermaid(model.markdown), model.stateVar, liveEnums) };
    } catch {
      return null;
    }
  }, [liveActive, liveGuardScope, dutContent, pouContent, flowchartOutput, collapseErrorSinkEdges, choiceNodes, spellOutElse, includeStateDescriptions, stateActions, showTransitionPriorities, priorityFormat, collapsedComposites, liveEnums]);
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
    // (and the current state's regions' variables, the shown code's, the watched ones)
    return [...new Set([...guards, ...liveRegions.map((r) => r.variable), ...userWatch, ...editorWatch])].sort().join('\n');
  }, [liveGuardEdges, liveGuardInputs, liveStatus.state, liveStatus.instance, liveGuardScope, liveRegions, editorWatch, userWatch]);
  liveValuesRef.current = { active: liveStatus.state === 'connected', values: liveVarValues };
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
    const key = `${liveWatchKey}\n#overview\n${overviewPaths.join('\n')}\n#symbols\n${symbolPaths.join('\n')}\n#io\n${ioVars.join('\n')}\n#sub\n${liveSubWatchKey}`;
    if (key === lastWatchRef.current) return;
    const instance = liveStatus.instance;
    const timer = window.setTimeout(() => {
      lastWatchRef.current = key;
      const paths = liveWatchKey && instance ? liveWatchKey.split('\n') : [];
      const guards = paths.map((p) => ({ id: p.toLowerCase(), candidates: symbolCandidates(p, instance!) }));
      const symbols = [...new Set([...symbolPaths, ...ioVars])].filter(isSymbolPathText).map((p) => ({ id: symbolWatchId(p), candidates: [p] }));
      const machines = overviewPaths.filter(isSymbolPathText).map((p) => ({ id: overviewWatchId(p), candidates: [`${p}.${liveStateVar}`] }));
      // (the live state's sub-machines: each method's VAR_INST, as <instance>.<method>.<variable>, else searched)
      const sub: LiveWatchVar[] = instance ? liveSubLevels.map((L) => ({ id: L.watchId, candidates: [`${instance}.${L.m.method}.${L.m.variable}`], search: { under: instance, words: [L.m.method, L.m.variable] } })) : [];
      // The guards first, then the overview's machines; a gateway follows at most 100 by default (more is refused)
      sendLiveWatch([...sub, ...guards, ...machines, ...symbols].slice(0, MAX_WATCHED));
    }, 120);
    return () => window.clearTimeout(timer);
  }, [liveWatchKey, symbolPaths, ioVars, overviewPaths, liveStateVar, liveStatus.state, liveStatus.instance, sendLiveWatch, liveSubLevels, liveSubWatchKey]);
  const liveGuardViews = useMemo(
    () => (liveGuardEdges && liveGuardInputs ? evaluateGuards(liveGuardEdges.edges, liveGuardInputs, liveGuardScope === 'all', null) : null),
    [liveGuardEdges, liveGuardInputs, liveGuardScope]
  );
  // The I/O tab: the transitions whose conditions read a linked variable (the guards' variables, by lower-case path)
  const ioGuardIndex = useMemo(() => {
    if (!ioTree) return null;
    let edges = liveGuardEdges?.edges ?? null;
    if (!edges) {
      try {
        const model = generateStatechartModel(dutContent, pouContent, { flowchartOutput, collapseErrorSinkEdges, choiceNodes, spellOutElse, includeStateDescriptions, stateActions, showTransitionPriorities, priorityFormat, collapsedComposites });
        edges = buildGuardEdges(model.edges, extractEdgesFromMermaid(model.markdown), model.stateVar, liveEnums);
      } catch {
        return null;
      }
    }
    const index = new Map<string, IoGuardUse[]>();
    for (const e of edges) for (const r of e.refs) {
      const k = r.toLowerCase();
      const list = index.get(k) ?? [];
      if (!list.some((g) => g.from === e.from && g.to === e.to)) list.push({ from: e.from, to: e.to });
      index.set(k, list);
    }
    return index;
  }, [ioTree, liveGuardEdges, dutContent, pouContent, flowchartOutput, collapseErrorSinkEdges, choiceNodes, spellOutElse, includeStateDescriptions, stateActions, showTransitionPriorities, priorityFormat, collapsedComposites, liveEnums]);
  const ioGuardsOf = useCallback(
    (variable: string): IoGuardUse[] => {
      if (!ioGuardIndex) return [];
      const v = variable.toLowerCase();
      const inst = (liveStatus.instance ?? '').toLowerCase();
      const out: IoGuardUse[] = [];
      for (const [ref, uses] of ioGuardIndex) {
        // (a member of the instance followed; a global path itself; not live: a member of that name anywhere)
        const hit = v === ref || (inst ? v === `${inst}.${ref}` : !ref.includes('.') && v.endsWith(`.${ref}`));
        if (hit) for (const g of uses) if (!out.some((x) => x.from === g.from && x.to === g.to)) out.push(g);
      }
      return out;
    },
    [ioGuardIndex, liveStatus.instance]
  );
  const ioValueOf = useCallback(
    (v: string) => {
      const x = liveVarValues[symbolWatchId(v)];
      return x === undefined ? undefined : { v: x };
    },
    [liveVarValues]
  );
  // ---- Offline simulation: a state, the values its transitions' conditions read, the steps taken ----
  // (subs: the states of the current state's sub-machines while they run, outer first: its sub-machine's, and the
  // sub-machine's its state calls, ...; history: a sub-machine's step says so, each step what it was before)
  const [sim, setSim] = useState<{
    active: boolean;
    current: string | null;
    history: { from: string; to: string; label: string; sub?: boolean; before?: { current: string | null; subs: string[] } }[];
    values: Record<string, LiveValue>;
    subs: string[];
  }>({
    active: false,
    current: null,
    history: [],
    values: {},
    subs: [],
  });
  const simOn = sim.active && !liveActive && !!sim.current;
  const simGuardEdges = useMemo(() => {
    if (!simOn) return null;
    try {
      const model = generateStatechartModel(dutContent, pouContent, { flowchartOutput, collapseErrorSinkEdges, choiceNodes, spellOutElse, includeStateDescriptions, stateActions, showTransitionPriorities, priorityFormat, collapsedComposites });
      return { stateVar: model.stateVar, edges: buildGuardEdges(model.edges, extractEdgesFromMermaid(model.markdown), model.stateVar, liveEnums) };
    } catch {
      return null;
    }
  }, [simOn, dutContent, pouContent, flowchartOutput, collapseErrorSinkEdges, choiceNodes, spellOutElse, includeStateDescriptions, stateActions, showTransitionPriorities, priorityFormat, collapsedComposites, liveEnums]);
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
  // The current state's sub-machines: the one its branch calls, and the one a state of that one calls in turn (...);
  // each runs while the condition around its call holds (it starts in its first state then). Their transitions are
  // offered first, the innermost's first; a RETURN after a call keeps the transitions around it waiting
  const simEval = useCallback(
    (text: string): 'true' | 'false' | 'unknown' => {
      const r = evaluateExpr(parseCondition(text), { value: (p) => sim.values[p.toLowerCase()] ?? liveEnums.literals.get(p.split('.').pop()!.toLowerCase()) });
      return r === undefined ? 'unknown' : r === true || (typeof r === 'number' && r !== 0) ? 'true' : 'false';
    },
    [sim.values, liveEnums]
  );
  // (each level's sub-machine, and its state while it runs)
  const simLevels = useMemo(() => {
    const levels: { m: (typeof subMachines)[number]; state: string | null; id: (name: string) => string }[] = [];
    if (!simOn) return levels;
    let parent: string | null = sim.current;
    for (let k = 0; parent && k < 8; k++) {
      const m = subMachines.find((x) => x.parent === parent);
      if (!m) break;
      const state = sim.subs[k] ?? null;
      const id = (name: string) => `${m.parent}__${m.method}__${name}`;
      levels.push({ m, state, id });
      if (!state) break;
      parent = id(state);
    }
    return levels;
  }, [simOn, sim.current, sim.subs, subMachines]);
  // (started where their calls' conditions hold, stopped where they no longer do)
  useEffect(() => {
    if (!simOn) return;
    const next: string[] = [];
    let parent: string | null = sim.current;
    for (let k = 0; parent && k < 8; k++) {
      const m = subMachines.find((x) => x.parent === parent);
      if (!m || (m.when && simEval(m.when) !== 'true')) break;
      const st = sim.subs[k] && m.states.includes(sim.subs[k]) ? sim.subs[k] : m.start ?? m.states[0];
      next.push(st);
      parent = `${m.parent}__${m.method}__${st}`;
    }
    if (next.join('|') !== sim.subs.join('|')) setSim((s) => ({ ...s, subs: next }));
  }, [simOn, sim.current, sim.subs, subMachines, simEval]);
  const { simSubTransitions, simMainWaits } = useMemo(() => {
    const out: (SimTransition & { target: string; level: number })[] = [];
    // (a RETURN after a call: the transitions of the code that called it wait, the one level around it; doState()'s
    // when it is the outermost's)
    let waits = false;
    for (let k = simLevels.length - 1; k >= 0; k--) {
      const L = simLevels[k];
      if (L.state && !waits)
        L.m.transitions
          .filter((t) => t.from === L.state)
          .forEach((t, j) => out.push({ edgeId: `sub${k}:${L.m.method}:${t.from}->${t.to}#${j}`, to: t.to, target: t.to, level: k, priority: j + 1, label: t.guard ?? '', source: `${L.m.method}()`, result: t.guard ? simEval(t.guard) : 'always' }));
      waits = !!L.state && L.m.preempts;
    }
    return { simSubTransitions: out, simMainWaits: waits };
  }, [simLevels, simEval]);
  const simOffered = useMemo(() => [...simSubTransitions, ...(simMainWaits ? [] : simTransitions)], [simSubTransitions, simMainWaits, simTransitions]);
  const simAllVariables = useMemo(() => {
    const names = new Set(simVariables.map((v) => v.name));
    for (const L of simLevels) if (L.m.when) for (const r of collectRefs(parseCondition(L.m.when))) names.add(r);
    for (const t of simSubTransitions) if (t.label) for (const r of collectRefs(parseCondition(t.label))) names.add(r);
    return [...names].sort().map((name) => ({ name, value: sim.values[name.toLowerCase()] as boolean | number | string | undefined }));
  }, [simVariables, simLevels, simSubTransitions, sim.values]);
  const simTake = useCallback(
    (edgeId: string) => {
      const before = { current: sim.current, subs: sim.subs };
      const sub = simSubTransitions.find((x) => x.edgeId === edgeId);
      const L = sub ? simLevels[sub.level] : null;
      if (sub && L?.state) {
        // (its level's state; the ones inside it start again)
        setSim((s) => ({ ...s, subs: [...s.subs.slice(0, sub.level), sub.target], history: [...s.history, { from: L.id(L.state!), to: L.id(sub.target), label: sub.label, sub: true, before }] }));
        return;
      }
      const t = simTransitions.find((x) => x.edgeId === edgeId);
      if (!t || !sim.current) return;
      const from = sim.current;
      setSim((s) => ({ ...s, current: t.target, subs: [], history: [...s.history, { from, to: t.target, label: t.label, before }] }));
    },
    [simTransitions, simSubTransitions, simLevels, sim.current, sim.subs]
  );
  // (the state glows; while its sub-machines run, their states inside it too)
  const simHighlight = useMemo(
    () =>
      simOn
        ? {
            stateId: sim.current!,
            previousStateId: sim.history.filter((h) => !h.sub)[sim.history.filter((h) => !h.sub).length - 1]?.from,
            stuck: false,
            regionStates: simLevels.filter((L) => L.state).map((L) => L.id(L.state!)),
          }
        : null,
    [simOn, sim.current, sim.history, simLevels]
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

  // An editor's tab marked "*" while it has edits not saved: its own (not yet put in the POU / the enum: its Ctrl+S),
  // or its file's (changed since it was saved)
  const pendingNow = usePendingEditors();
  const methodEdits = pendingNow.some((e) => e.id.startsWith('method') || e.id === 'state-code');
  const pouEdits = pendingNow.some((e) => e.id === 'pou-editor');
  const enumEdits = pendingNow.some((e) => e.id === 'enum-editor');
  // (its "*" clicked: the editor's diff, or its file's against its saved version)
  // A file's changes since it was saved (its parts from the sources as they are now: a change undone or a line edited
  // in the Diff goes into them, as an edit, Ctrl+Z undoes it)
  // The Diff (one at a time): what it shows, and whether it is docked (its tab, beside the Diagram Canvas) or a popup
  const [diffView, setDiffView] = useState<{ req: DiffRequest; docked: boolean } | null>(null);
  const showDiff = useCallback((req: DiffRequest) => {
    setDiffView((d) => ({ req, docked: d?.docked ?? false }));
    // (docked: its tab shown)
    if (diffViewRef.current?.docked) setDockLayout((l) => activateDockTab(l, 'diff'));
  }, []);
  const diffViewRef = useRef(diffView);
  diffViewRef.current = diffView;
  const pouParts = (before: string, after: string): DiffPart[] => {
    const b = getPouBody(before);
    const a = getPouBody(after);
    const put = (r: { success: boolean; updatedPou: string; error?: string }) => (r.success ? handleReplaceSources(r.updatedPou, null) : showCopyToast(r.error ?? 'Not changed', 'error'));
    const parts: DiffPart[] = [
      { name: "The POU's declaration", before: b.declaration, after: a.declaration, apply: (t) => put(updatePouBody(after, t, null)) },
      { name: "The POU's body", before: b.implementation, after: a.implementation, apply: (t) => put(updatePouBody(after, a.declaration, t)) },
    ];
    for (const m of [...new Set([...getAllMethodsFromPou(before), ...getAllMethodsFromPou(after)])]) {
      const x = getMethodCodeFromPou(before, m);
      const y = getMethodCodeFromPou(after, m);
      // (a method taken out since: read-only here)
      parts.push(
        { name: `${m}() declaration`, before: x.methodFound ? x.declaration : '', after: y.methodFound ? y.declaration : '', apply: y.methodFound ? (t) => put(updateMethodCodeInPou(after, m, y.code, t)) : undefined },
        { name: `${m}() implementation`, before: x.methodFound ? x.code : '', after: y.methodFound ? y.code : '', apply: y.methodFound ? (t) => put(updateMethodCodeInPou(after, m, t, y.declaration)) : undefined }
      );
    }
    return parts;
  };
  // The collapsed composites of this POU (this browser), read when another POU is loaded
  const collapsedKey = `kss.collapsed.${(pouFileName || 'POU').replace(/\.TcPOU$/i, '')}`;
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(collapsedKey) || '[]');
      setCollapsedComposites(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
    } catch {
      setCollapsedComposites([]);
    }
  }, [collapsedKey]);
  // The states whose code (their CASE branch in doState()) changed since the POU was saved: marked on the canvas, the
  // minimap and in the canvas's search
  const changedStates = useMemo(() => {
    if (!savedSources.pou || !pouContent || savedSources.pou === pouContent) return [] as string[];
    const before = getMethodCodeFromPou(savedSources.pou, 'doState');
    const after = getMethodCodeFromPou(pouContent, 'doState');
    if (!before.methodFound || !after.methodFound || before.code === after.code) return [] as string[];
    // (each state's branch as written, its comments too: from its label to the next one)
    const branches = (code: string) => {
      const lines = code.replace(/\r\n/g, '\n').split('\n');
      const blank = blankComments(lines.join('\n')).split('\n');
      return (id: string) => {
        const r = caseBranchRange(blank, id);
        return r ? lines.slice(r.start, r.end).join('\n') : null;
      };
    };
    const was = branches(before.code);
    const now = branches(after.code);
    return identifiedStatesResult.states.map((s) => s.id).filter((id) => was(id) !== now(id));
  }, [savedSources.pou, pouContent, identifiedStatesResult.states]);
  // The PLC's project and its local copy, compared (asked about before Override / Keep local)
  const [plcCopyDiff, setPlcCopyDiff] = useState<{ title: string; parts: DiffPart[] } | null>(null);
  // All changes (the header's Diff): every editor's edits not in the POU yet, then the files' since they were saved
  const allChangesParts = (): DiffPart[] => [
    ...pendingParts().flatMap((e) => e.parts.map((p) => ({ ...p, name: `${e.label}: ${p.name} (in the editor, not in the POU yet)` }))),
    ...fileDiffParts('pou').map((p) => ({ ...p, name: `${pouFileName}: ${p.name} (since saved)` })),
    ...(dutContent ? fileDiffParts('enum').map((p) => ({ ...p, name: `${dutFileName}: ${p.name} (since saved)` })) : []),
  ];
  // A Diff asked for (an editor's, a file's since saved, all changes)
  useEffect(() => {
    const on = (e: Event) => {
      const req = (e as CustomEvent<DiffRequest>).detail;
      if (req) showDiff(req);
    };
    window.addEventListener(OPEN_DIFF_EVENT, on);
    return () => window.removeEventListener(OPEN_DIFF_EVENT, on);
  }, [showDiff]);
  // What a Diff shows, its labels and its parts as they are now
  const diffInfo = (req: DiffRequest): { title: string; beforeLabel: string; afterLabel: string; getParts: () => DiffPart[] } =>
    req.source === 'editor'
      ? { title: req.title, beforeLabel: req.beforeLabel, afterLabel: req.afterLabel, getParts: () => editorParts(req.editorId) }
      : req.source === 'file'
        ? { title: `${req.file === 'enum' ? dutFileName : pouFileName}: since it was saved`, beforeLabel: 'saved', afterLabel: 'now', getParts: () => fileDiffPartsRef.current(req.file) }
        : { title: 'All changes', beforeLabel: 'before', afterLabel: 'now', getParts: () => allChangesRef.current() };
  // (the docked Diff: in its tab, beside the Diagram Canvas in a group of its own)
  const dockDiff = () => {
    setDiffView((d) => (d ? { ...d, docked: true } : d));
    setDockLayout((l) => {
      let next = activateDockTab(l, 'diff');
      const canvas = getDockGroupOfTab(next, 'diagram');
      if (canvas && canvas.tabs.includes('diff')) next = splitDockTab(next, 'diff', canvas.id, 'after');
      return activateDockTab(next, 'diagram');
    });
  };
  const floatDiff = () => {
    setDiffView((d) => (d ? { ...d, docked: false } : d));
    setDockLayout((l) => closeDockTab(l, 'diff'));
  };
  const closeDiff = () => {
    if (diffViewRef.current?.docked) setDockLayout((l) => closeDockTab(l, 'diff'));
    setDiffView(null);
  };
  // (its tab closed from the tab strip: the docked Diff closed too)
  useEffect(() => {
    if (diffView?.docked && !isDockTabOpen(dockLayout, 'diff')) setDiffView(null);
  }, [diffView?.docked, dockLayout]);
  const fileDiffParts = (tab: 'pou' | 'enum'): DiffPart[] =>
    tab === 'enum'
      ? [{ name: 'Declaration', before: savedSources.dut ? parseDutContent(savedSources.dut).declaration : '', after: dutContent ? parseDutContent(dutContent).declaration : '', apply: dutContent ? (t) => handleReplaceSources(null, updateDutDeclaration(dutContent, t)) : undefined }]
      : pouParts(savedSources.pou, pouContent);
  const fileDiffPartsRef = useRef(fileDiffParts);
  fileDiffPartsRef.current = fileDiffParts;
  const allChangesRef = useRef(allChangesParts);
  allChangesRef.current = allChangesParts;
  const openTabDiff = (tab: 'method' | 'pou' | 'enum') => {
    setDockLayout((l) => activateDockTab(l, tab));
    if ({ method: methodEdits, pou: pouEdits, enum: enumEdits }[tab]) {
      window.setTimeout(() => showEditorDiff(tab), 150);
      return;
    }
    showDiff({ source: 'file', file: tab === 'enum' ? 'enum' : 'pou' });
  };
  const dirtyMark = (tab: 'method' | 'pou' | 'enum', why: (string | false)[]) => {
    const list = why.filter((x): x is string => !!x);
    return list.length ? (
      <span
        id={`dock-tab-dirty-${tab}`}
        role="button"
        onClick={() => openTabDiff(tab)}
        className="text-amber-300 font-bold leading-none cursor-pointer hover:text-amber-200"
        title={`Not saved: ${list.join('; ')}. Click: the changes`}
      >
        *
      </span>
    ) : undefined;
  };
  const pouUnsaved = pouDirty && `${pouFileName} changed since it was saved`;
  const dutUnsaved = dutDirty && `${dutFileName || 'the .TcDUT'} changed since it was saved`;
  // Titles, icons & badges for every dockable tab
  const dockTabMeta = useMemo<Record<DockTabId, DockTabMeta>>(
    () => ({
      diagram: { title: 'Diagram Canvas', icon: <Workflow />, tooltip: 'Interactive statechart diagram canvas' },
      method: {
        title: 'Method Editor',
        icon: <FileCode />,
        badge: dirtyMark('method', [methodEdits && 'edits in the Method Editor not put in the POU yet (Ctrl+S in it)', pouUnsaved]),
        tooltip: `Structured Text methods in ${pouFileName || 'POU'}${selectedStateId ? ` — state ${selectedStateId}` : ''}`,
      },
      pou: {
        title: 'POU Editor',
        icon: <Blocks />,
        badge: dirtyMark('pou', [pouEdits && 'edits in the POU Editor not put in the POU yet (Ctrl+S in it)', pouUnsaved]),
        tooltip: `The declaration and body of ${pouFileName ? pouFileName.replace(/\.TcPOU$/i, '') : 'the POU'} (Structured Text)`,
      },
      enum: { title: 'Enum Editor', icon: <Code2 />, badge: dirtyMark('enum', [enumEdits && 'edits in the Enum Editor not put in the enum yet (Ctrl+S in it)', dutUnsaved]), tooltip: `Enum members in ${dutFileName || '.TcDUT'}` },
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
      diff: { title: 'Diff', icon: <GitCompare />, tooltip: "The Diff docked: an editor's or a file's changes, beside the Diagram Canvas" },
      paths: { title: 'Paths', icon: <Route />, tooltip: 'Every path between two states, with the guards along it' },
      io: { title: 'I/O', icon: <Cpu />, tooltip: "The PLC's I/O (read-only): its EtherCAT devices, couplers and terminals, the PLC variables linked to them, live" },
    }),
    [pouFileName, dutFileName, selectedStateId, pouComplexityReport.refactorCandidatesCount, notesCount, activeLintFindings, liveActive, liveStatus.message, methodEdits, pouEdits, enumEdits, pouUnsaved, dutUnsaved, pouContent, dutContent, savedSources]
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
    available: headerRowWidth - headerLeftWidth - 60 - 76 - 34,
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
                  ? { dirtyCount: hostDirtyFiles.length, onSave: handleSaveToProject, onSaveEditor: handleHeaderSave, onDiffAll: () => showDiff({ source: 'all' }), menu: [{ id: 'review-save', label: 'Review and save…', onSelect: openReview }] }
                  : undefined
                : pouContent
                ? {
                    id: 'save-sources-btn',
                    label: 'Save',
                    dirtyCount: localDirtyCount,
                    onSave: () => void handleSaveSources(),
                    onSaveEditor: handleHeaderSave,
                    onDiffAll: () => showDiff({ source: 'all' }),
                    title: desktopSave()?.saveSources
                      ? `Write the edits back to ${[pouDirty && (pouPath ? pouFileName : `${pouFileName} (Save As)`), dutDirty && dutFileName].filter(Boolean).join(' and ')} (Ctrl+S)`
                      : canWriteBack()
                      ? 'Write the edits back to the files opened with Browse (else download them) (Ctrl+S)'
                      : 'Download the edited files (this browser cannot write them back) (Ctrl+S)',
                    menu: desktopSave()?.saveSourceAs
                      ? [
                          { id: 'review-save', label: 'Review and save…', onSelect: openReview },
                          { id: 'save-pou-as', label: 'Save .TcPOU As…', onSelect: () => void handleSaveAs('pou') },
                          ...(dutContent ? [{ id: 'save-dut-as', label: 'Save .TcDUT As…', onSelect: () => void handleSaveAs('dut') }] : []),
                        ]
                      : [
                          { id: 'review-save', label: 'Review and save…', onSelect: openReview },
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
              <span className="sr-only">Sample:</span>
              <select
                id="sample-selector"
                title="A built-in example state machine (a POU and its enum) to look at and try things on: your own files stay as they are"
                value={selectedSampleId}
                onChange={(e) => {
                  const sample = SAMPLES.find((s) => s.id === e.target.value);
                  if (sample) handleSelectSample(sample);
                }}
                className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer pr-1 truncate w-full max-w-[130px]"
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
          className="fixed bottom-8 right-3 z-[60] flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/90 border border-slate-700 text-xs text-slate-300 hover:text-white hover:border-sky-500 shadow-lg"
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
            onCheckUpdates={liveMode === 'web' ? undefined : () => void runUpdateCheck(false)}
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
            <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="Kval MachineScope" className="w-7 h-7 sm:w-8 sm:h-8 shrink-0" draggable={false} />
          </div>
            {/* Title shrinks and truncates first when the header runs out of room */}
            <div className="min-w-0 overflow-hidden">
              <h1 className="text-xs sm:text-sm font-bold tracking-tight text-white flex items-center gap-1.5 sm:gap-2 truncate">
                <span className="truncate">Kval MachineScope</span>
              </h1>
              <p className="text-[11px] text-slate-400 truncate hidden 2xl:block">
                Design, simulate and debug TwinCAT state machines and their I/O, live on the PLC.
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
          {/* Theme & Preset: the whole app's theme and the diagram presets, together */}
          <div className="relative shrink-0" id="header-appearance">
            <button
              id="header-appearance-btn"
              type="button"
              aria-expanded={appearanceOpen}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setAppearanceAt({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
                setAppearanceOpen((o) => !o);
              }}
              className={`p-1.5 rounded-lg transition-colors ${appearanceOpen ? 'bg-slate-800 text-sky-300' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
              title={`Theme & Preset: the app's theme (${mermaidTheme}) and the diagram presets`}
            >
              <Palette className="w-4 h-4" />
            </button>
            {createPortal(
            <div
              id="header-appearance-panel"
              className={`${appearanceOpen ? '' : 'hidden'} fixed z-[200] w-[22rem] p-3 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl text-xs space-y-3`}
              style={appearanceAt ? { top: appearanceAt.top, right: appearanceAt.right } : undefined}
              onKeyDown={(e) => e.key === 'Escape' && setAppearanceOpen(false)}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">Theme & Preset</span>
                <button type="button" onClick={() => setAppearanceOpen(false)} className="p-0.5 rounded text-slate-400 hover:text-white" title="Close">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <label className="flex items-center justify-between gap-2">
                <span className="text-slate-400 text-[11px] font-medium">Theme</span>
                <select
                  id="mermaid-theme-select"
                  value={mermaidTheme}
                  onChange={(e) => setMermaidTheme(e.target.value as MermaidTheme)}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
                  title="The theme of the whole app and of the diagram: dark, a light one (default, base, neutral, forest), or one after a popular IDE's (VS Code, Visual Studio, JetBrains …)"
                >
                  <optgroup label="MachineScope">
                    <option value="dark">dark</option>
                    <option value="base">base</option>
                    <option value="forest">forest</option>
                    <option value="neutral">neutral</option>
                    <option value="default">default</option>
                  </optgroup>
                  <optgroup label="IDE themes (dark)">
                    {IDE_THEMES.filter((t) => t.dark).map((t) => (
                      <option key={t.id} value={t.id} title={t.from}>{t.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="IDE themes (light)">
                    {IDE_THEMES.filter((t) => !t.dark).map((t) => (
                      <option key={t.id} value={t.id} title={t.from}>{t.name}</option>
                    ))}
                  </optgroup>
                </select>
              </label>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400 text-[11px] font-medium">Preset</span>
                <DiagramPresetManager currentOptions={currentDiagramOptions} onApplyPreset={handleApplyPreset} onExportSettingsChange={setExportSettings} />
              </div>
              <div className="text-[10px] text-slate-500">A preset keeps the diagram's options (engine, curve, priorities, export) with its theme.</div>
            </div>,
            document.body
            )}
          </div>
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
              transitionCounts={edgeMembersAll.size ? stateTransitionCounts : undefined}
              subMachines={identifiedSubMachines}
              onToggleSubMachine={setSubMachineExpanded}
              onGoToCode={pouContent ? handleGoToStateCode : undefined}
              liveSubStateIds={(liveActive ? liveRegionStates : simHighlight?.regionStates ?? []).filter((x) => x.includes('__'))}
              selectedStateId={selectedStateId}
              focusStateId={codeFocus?.state ?? null}
              focusNonce={codeFocus?.t}
              liveStateId={liveActive ? liveSession.current?.state ?? null : simHighlight?.stateId ?? null}
              liveFollow={liveFollow}
              onLiveFollowChange={setLiveFollow}
              onJumpToState={handleJumpToState}
              onSelectState={(id, label) => {
                setSelectedStateId(id);
                setSelectedStateLabel(label || id);
              }}
              customStyles={customNodeStyles}
              bookmarkedStates={bookmarks.states}
              onToggleBookmark={handleToggleBookmark}
              onShowBookmarks={() => setBookmarksOpen(true)}
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
              <label className="flex items-center gap-2 cursor-pointer select-none" title="An error state most of a composite's states go to: their transitions to it drawn as one, from the composite's border (its badge lists them)">
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
              {choiceNodes && (
                <select
                  id="choice-size-select"
                  value={choiceSize}
                  onChange={(e) => setChoiceSize(e.target.value as 'small' | 'medium' | 'large')}
                  title="How big the choice diamonds are drawn"
                  className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[11px] text-slate-300"
                >
                  <option value="small">small</option>
                  <option value="medium">medium</option>
                  <option value="large">large</option>
                </select>
              )}

              {/* An IF's ELSE in a guard: what it is */}
              <label className="flex items-center gap-2 cursor-pointer select-none" title={'A transition under an IF\'s ELSE: its condition written out, "NOT (cmd_bStart)", not "else" (longer labels)'}>
                <input
                  id="spell-out-else-checkbox"
                  type="checkbox"
                  checked={spellOutElse}
                  onChange={(e) => setSpellOutElse(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-700 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-900"
                />
                <span className="text-slate-300">ELSE as condition</span>
              </label>

              {/* Include state description */}
              <label className="flex items-center gap-2 cursor-pointer select-none" title="Each state's description (from getStateDescription()) under its name">
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
                <label className="flex items-center gap-2 cursor-pointer select-none" title="Each transition's priority (the order its state checks it in) in a badge at its start; the format beside">
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

              {/* The composites' colour (a composite's own: its menu's Colour); compact, so the toolbar keeps its rows */}
              <label className="flex items-center gap-1" title="Composites: the composite states' border, title and tint (a composite's own: right-click its title, Colour)">
                <SquareStack className="w-3.5 h-3.5 text-slate-400" />
                <select
                  id="composite-color-select"
                  value={compositeColor}
                  onChange={(e) => setCompositeColorPreset(e.target.value)}
                  aria-label="Composites' colour"
                  className="bg-slate-950 border border-slate-800 rounded-lg px-1.5 py-0 h-6 text-[11px] leading-none text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
                >
                  {COMPOSITE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>

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

              <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-400 hover:text-slate-200 select-none" title="The chart drawn again as you edit the code (off: Generate draws it)">
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
                  expanded={focusMode}
                  onExpandedChange={(on) => on !== focusModeRef.current && toggleFocusMode()}
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
                  onEditTransitionCondition={pouContent ? handleEditCondition : undefined}
                  onShowInXae={canNavigateInXae ? handleShowInXae : undefined}
                  problemMarkers={lintProblemMarkers}
                  bookmarkedStates={bookmarks.states}
                  onToggleStateBookmark={(id) => handleToggleBookmark(id)}
                  changedStates={changedStates}
                  stateTooltips={stateTooltips}
                  stateProblems={stateProblems}
                  groupSnapEach={groupSnapEach}
                  canvasBanner={learnedPou ? `Learned live: no source. ${availableEdges.length} transition${availableEdges.length === 1 ? '' : 's'} seen so far; each one the PLC takes is added (their conditions are not known)` : undefined}
                  canvasBannerAction={learnedPou ? { id: 'canvas-learned-save-btn', label: 'Save as source…', title: 'A .TcPOU and its enum to finish by hand: each transition seen, its condition FALSE to write (what changed just before it in its comment)', onClick: handleSaveLearnedAsSource } : undefined}
                  multiSelection={multiSelected}
                  onMultiSelectionChange={setMultiSelected}
                  onBoxSelected={pouContent && dutContent.trim() ? handleBoxSelected : undefined}
                  liveHighlight={liveHighlight ?? simHighlight}
                  stateTimes={showStateTimes && measuredStateTimes.length ? stateTimeBadges : null}
                  pathHighlight={pathHighlight}
                  diffHighlight={diffHighlight}
                  liveGuards={liveGuardViews ?? simViews}
                  contextMenuItems={diagramContextMenuItems}
                  connectFrom={connectFrom}
                  onConnectTo={handleConnectTo}
                  onConnectCancel={() => setConnectFrom(null)}
                  onEdgeEndpointDrop={pouContent ? handleEdgeEndpointDrop : undefined}
                  edgeMembersOf={edgeMembersOf}
                  compositeColor={compositeColor}
                  compositeOwnColors={compositeOwnColors}
                  onOpenTransitionCode={pouContent ? handleOpenTransitionCode : undefined}
                  onGoToEdgeCode={pouContent ? handleGoToEdgeCode : undefined}
                  onCanvasKey={handleCanvasKey}
                  onPaletteElement={pouContent ? handlePaletteElement : undefined}
                  onStateDropped={pouContent ? handleStateDropped : undefined}
                  onCompositeDropped={pouContent ? handleCompositeDropped : undefined}
                  history={{ ...historyState, onUndo: () => stepHistory(true), onRedo: () => stepHistory(false) }}
                  placeRequest={placeRequest}
                  nodeOffsets={nodeOffsets}
                  keepPositionsSignal={keepCanvasPositions}
                  onNodeOffsetsChange={handleCanvasNodeOffsets}
                  initialEdgeOffsets={layoutSeed?.edges}
                  edgeOffsetsKey={layoutSeed?.key}
                  pinPositions={layoutPins ?? undefined}
                  onEdgeOffsetsChange={handleCanvasEdgeOffsets}
                  restoreEdges={edgeRestore ?? undefined}
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
              tcDutContent={enumSubView?.content ?? dutContent}
              tcDutFileName={enumSubView?.fileName ?? (dutFileName || 'EnumDeclaration.TcDUT')}
              onSaveDutContent={
                enumSubView
                  ? enumSubView.key
                    ? (text: string) => {
                        // (a sub-machine's enum in its own file: kept, written by Save)
                        const key = enumSubView.key!;
                        setSubDutEdits((e) => ({ ...e, [key]: text }));
                        return { success: true };
                      }
                    : () => ({ success: false, error: enumSubView.note })
                  : handleSaveDutContent
              }
              enumMemberPrefix={enumSubView?.prefix}
              enumReadOnlyNote={enumSubView?.note}
              onSaveMethodCode={handleSaveMethodCode}
              onSaveStateCode={handleSaveStateCode}
              onSavePreProcessCode={handleSavePreProcessCode}
              initialMethod={inspectorRequest.method}
              codeJump={codeJump}
              codeFocus={codeFocus}
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
            transitions={simOffered}
            variables={simAllVariables}
            subMachine={simLevels[0] ? { method: simLevels[0].m.method, parent: simLevels[0].m.parent, when: simLevels[0].m.when, running: !!simLevels[0].state, state: simLevels[0].state, preempts: simLevels[0].m.preempts } : null}
            nestedSubMachines={simLevels.slice(1).map((L) => ({ method: L.m.method, when: L.m.when, running: !!L.state, state: L.state }))}
            onStart={(state) => {
              setSim((s) => ({ ...s, active: true, current: state, history: [], subs: [] }));
              handleJumpToState(state);
            }}
            onStop={() => setSim((s) => ({ ...s, active: false, current: null, history: [], subs: [] }))}
            onTake={simTake}
            onStep={() => {
              const t = simOffered.find((x) => x.result === 'true' || x.result === 'always');
              if (t) simTake(t.edgeId);
              else showCopyToast('No transition holds with these values', 'error');
            }}
            onBack={() =>
              setSim((s) => {
                const last = s.history[s.history.length - 1];
                if (!last) return s;
                // (as it was before that step: the state, its sub-machines' states)
                if (last.before) return { ...s, current: last.before.current, subs: last.before.subs, history: s.history.slice(0, -1) };
                return { ...s, current: last.from, subs: [], history: s.history.slice(0, -1) };
              })
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
            reveal={pouReveal}
          />,
          dockRegistry.nodes.pou
        )}

      {isDockTabMounted('live') &&
        createPortal(
          <LivePanel
            watchList={userWatch.map((n) => ({ name: n, value: liveVarValues[n.toLowerCase()] }))}
            onUnwatch={(n) => setUserWatch((cur) => cur.filter((x) => x !== n))}
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
            stateTimes={measuredStateTimes}
            showStateTimes={showStateTimes}
            onShowStateTimesChange={setShowStateTimes}
            onExportStateTimes={measuredStateTimes.length ? handleExportStateTimes : undefined}
            onKeepPathCheck={liveSession.transitions.length ? handleKeepPathCheck : undefined}
            pathChecks={pathCheckView}
            onRemovePathCheck={(id) => setPathChecks(pathChecks.filter((c) => c.id !== id))}
            onCompare={() => setCompareOpen(true)}
            replayVars={replayVars}
            reachable={reachable}
            onOpenInstance={liveMode ? (i: string) => (loadedFromLivePlc || !pouTypeName ? handleOpenInstance(i) : handleWatchMachine({ name: i.split('.').pop() ?? i, path: i, type: pouTypeName, kind: 'struct' })) : undefined}
            openTarget={isXaeHost() || liveMode === 'web' ? 'tab' : 'window'}
            onOpenSymbols={liveMode && !replay ? () => setDockLayout((l) => activateDockTab(l, 'symbols')) : undefined}
            onOpenFromPlc={liveMode && !replay && !isXaeHost() ? () => handleOpenFromPlc() : undefined}
            fromPlcOffline={!!liveMode && !replay && !isXaeHost() && liveStatus.state !== 'connected' && liveStatus.state !== 'connecting' && (liveMode === 'web' && liveVia === 'gateway' ? !!liveSettings.plc : (liveMode === 'desktop' || liveVia === 'link') && /^\d+(\.\d+){5}$/.test(liveSettings.netId.trim()))}
            onUpdateLink={viaLink && linkBuild?.features?.includes('selfUpdate') ? handleUpdateLink : undefined}
            onCompareWithPlc={liveMode && liveMode !== 'xae' && !replay && !isXaeHost() && pouTypeName ? handleCompareWithPlc : undefined}
            onBuildForPlc={isXaeHost() && pouPath ? runXaeBuild : plcOrigin && liveMode && liveMode !== 'xae' && !replay && !isXaeHost() ? () => runPlcBuild(null) : liveMode === 'desktop' && pouPath && !replay && desktopLive()?.projectBuild ? () => runProjectBuild(null) : liveMode === 'web' && pouContent && !replay && (viaLink ? linkBuild?.features?.includes('projectBuild') : gatewayFeatures.includes('projectBuild')) ? () => void runWebProjectBuild(null) : undefined}
            buildOffline={isXaeHost()}
            lastBuild={plcBuild && !plcBuildShown && plcBuild.phase === 'done' && plcBuild.result ? { text: plcBuild.result.fatal ? 'failed' : plcBuild.result.written ? 'written' : `${plcBuild.result.errors ?? plcBuild.result.items?.filter((i) => i.level === 'error').length ?? 0} error${(plcBuild.result.errors ?? 0) === 1 ? '' : 's'}`, ok: !!plcBuild.result.ok, onOpen: () => setPlcBuildShown(true) } : undefined}
            onOpenOverview={liveMode && !replay ? () => setDockLayout((l) => activateDockTab(l, 'overview')) : undefined}
            limitMs={liveLimit}
            stateLimitMs={liveSession.current ? stateLimits[liveSession.current.state] ?? null : null}
            onStateLimitChange={pouTypeName ? (ms) => liveSession.current && handleStateLimit(liveSession.current.state, ms) : undefined}
            defaultLimitMs={defaultLimit}
            onDefaultLimitChange={setDefaultLimit}
            rememberedPlcs={rememberedPlcs}
            onRememberPlc={handleRememberPlc}
            onPlcsFound={handlePlcsFound}
            onForgetPlc={(netId) => updateRememberedPlcs((list) => list.filter((p) => p.netId !== netId))}
            onScanPlcs={handleScanPlcs}
            onAddRoute={handleAddRoute}
            onPlcStartAt={handlePlcStartAt}
            plcControlModes={plcControlModes}
            onGatewayPlcState={handleGatewayPlcState}
            onGatewayPlcControl={handleGatewayPlcControl}
            gatewayPlcControlModes={gatewayPlcControlModes}
            onGatewayPlcStates={handleGatewayPlcStates}
            onGatewayPlcHistory={handleGatewayPlcHistory}
            onRefreshPlcStates={handleRefreshPlcStates}
            onCheckConnection={handleCheckConnection}
            onCheckPlc={handleCheckPlc}
            linkNotice={viaLink ? linkNotice : null}
            licenseNotice={licenseNotice}
            onRecheckLicense={() => setLicenseCheck((n) => n + 1)}
            onOpenXae={handleOpenXae}
            onStartPlc={handleStartPlc}
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
            onOpenGatewayRecordings={liveMode === 'web' && liveVia === 'gateway' ? () => setGatewayRecordingsOpen(true) : undefined}
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
          onOpenHere={isXaeHost() ? undefined : (m) => handleWatchMachine(m, undefined, { here: true })}
          openTarget={isXaeHost() || liveMode === 'web' ? 'tab' : 'window'}
          loadedType={pouTypeName}
          loadedIsLive={loadedFromLivePlc}
          onGoLiveHere={handleGoLiveHere}
          plcKey={liveStatus.target}
        />,
          dockRegistry.nodes.symbols
        )}

      {changesTabMounted &&
        createPortal(
          <ChangesPanel
            base={compareBase}
            onBaseChange={(b) => {
              if (b === 'git') setGitBaseline(null); // read it again
              if (b === 'plc') setPlcBaseline(null);
              setCompareBase(b);
            }}
            savedLabel={isXaeHost() && pouPath && hostSavedContent[pouPath] !== undefined ? 'saved in XAE' : 'as loaded'}
            gitAvailable={canReadGitVersions()}
            plcAvailable={liveStatus.state === 'connected' && !!liveMode && liveMode !== 'xae' && !isXaeHost()}
            loading={(compareBase === 'git' && !!gitBaseline?.loading) || (compareBase === 'plc' && !!plcBaseline?.loading)}
            error={compareBase === 'git' ? gitBaseline?.error ?? null : compareBase === 'plc' ? plcBaseline?.error ?? null : null}
            note={compareBase === 'git' ? gitBaseline?.note ?? null : compareBase === 'plc' ? plcBaseline?.note ?? null : null}
            diff={chartDiff}
            showOnDiagram={compareOnDiagram}
            onShowOnDiagramChange={setCompareOnDiagram}
            onJumpToState={(id) => handleJumpToState(id)}
          />,
          dockRegistry.nodes.changes
        )}

      {isDockTabMounted('diff') &&
        createPortal(
          diffView?.docked ? (
            <DiffPanel key={JSON.stringify(diffView.req)} {...diffInfo(diffView.req)} docked onClose={closeDiff} onFloat={floatDiff} />
          ) : (
            <div id="diff-tab-empty" className="h-full flex items-center justify-center p-6 text-xs text-slate-400 text-center">
              No Diff here: open one (an editor's Diff, the "*" on its tab, the header's All changes) and dock it with its Dock button.
            </div>
          ),
          dockRegistry.nodes.diff
        )}

      {isDockTabMounted('io') &&
        createPortal(
          <IoTreePanel
            tree={ioTree}
            loading={ioLoading}
            connected={liveStatus.state === 'connected'}
            onLoad={() => void loadIoTree()}
            onLoadFolder={ioFolderApi ? (pick) => void loadIoFolder(pick) : undefined}
            onVisibleVariables={handleIoVars}
            valueOf={ioValueOf}
            ecat={ioEcat}
            onStatesWanted={handleIoStatesWanted}
            guardsOf={ioGuardsOf}
            onOpenGuard={(g) => handleOpenTransitionCode(g.from, g.to)}
            events={ioEvents}
            onClearEvents={() => setIoEvents([])}
            since={ioSince}
            crcBase={ioCrcBase}
            onResetCrc={(path, crc) => setIoCrcBase((prev) => ({ ...prev, [path]: { at: Date.now(), crc } }))}
            picturesWhere={desktopLive()?.deviceInfo ? 'desktop' : ioViaLink ? 'link' : ioViaGateway ? 'gateway' : undefined}
            alerts={ioAlerts}
            onAlertsChange={setIoAlerts}
            onCompareProject={ioFolderApi ? fetchProjectIo : undefined}
            exportName={liveStatus.target ?? ioTree?.project ?? 'io'}
            fetchDeviceInfo={fetchDeviceInfo}
            onOpenDevicesFolder={openDevicesFolder}
            folderLabel={desktopLive()?.ioTreeFolder ? undefined : 'Offline: the I/O of a TwinCAT project folder you choose (Chrome, Edge)'}
          />,
          dockRegistry.nodes.io
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
            findings={buildFindings.length ? [...buildFindings, ...lintFindings] : lintFindings}
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
            pouContent={pouContent}
            availableStates={availableStates}
            availableEdges={availableEdges}
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

      {promptRequest && (
        <TextPromptDialog
          request={promptRequest}
          onClose={() => {
            promptRequest.onDismiss?.();
            setPromptRequest(null);
          }}
        />
      )}
      {declareFix && (
        <DeclareVariableDialog
          initial={{ name: declareFix.name, type: guessType(declareFix.name), scope: declareFix.method ? 'VAR' : 'VAR_INPUT' }}
          known={declareFix.method ? declarationVariables(getMethodCodeFromPou(pouContent, declareFix.method).declaration || '') : declarationVariables(extractPouDeclaration(pouContent))}
          types={symbolScope(pouContent, getProjectSymbols(), { method: declareFix.method }).types}
          scopes={declareFix.method ? ['VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_INST', 'VAR_TEMP'] : ['VAR_INPUT', 'VAR_OUTPUT', 'VAR']}
          title={`Declare ${declareFix.name} in ${declareFix.method ? `${declareFix.method}()` : 'the POU'}`}
          onCancel={() => setDeclareFix(null)}
          onDone={(v) => {
            const method = declareFix.method;
            setDeclareFix(null);
            if (method) {
              const m = getMethodCodeFromPou(pouContent, method);
              const res = handleSaveMethodCode(method, m.code, declareInDeclaration(m.declaration || '', [v]));
              if (!res?.success) return showCopyToast(res?.error || 'Could not change the method', 'error');
            } else if (!handleDeclareInPou([v])) return;
            showCopyToast(`Declared ${v.name} : ${v.type} in ${method ? `${method}()` : 'the POU'} (${v.scope})`, 'success');
          }}
        />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {releaseNotesOpen && <ReleaseNotesDialog edition={editionOf(appHost)} onClose={() => setReleaseNotesOpen(false)} />}
      {plcBuild && plcBuildShown && (
        <PlcBuildDialog
          state={plcBuild}
          canOpen={(i) => itemInPou(i, isXaeHost() && pouPath ? { path: pouPath.replace(/\\/g, '/'), dutPaths: {} } : plcOrigin)}
          canWrite={!isXaeHost()}
          onOpenItem={openPlcBuildItem}
          onRebuild={() => (plcBuild.via === 'xae' || isXaeHost() ? runXaeBuild() : plcBuild.via === 'webProject' ? void runWebProjectBuild(null) : plcBuild.via === 'project' ? runProjectBuild(null) : runPlcBuild(null))}
          onWrite={(w) => (plcBuild.via === 'webProject' ? void runWebProjectBuild(w) : plcBuild.via === 'project' ? runProjectBuild(w) : runPlcBuild(w))}
          onClose={() => setPlcBuildShown(false)}
          onCloseXae={isXaeHost() ? undefined : handleCloseXae}
          onReadAppInfo={isXaeHost() ? undefined : handleReadAppInfo}
          onOpenXae={handleOpenXae}
          onStartPlc={handleStartPlc}
          saveForXae={
            plcBuild.via === 'plc' && desktopLive()?.saveIntoProject
              ? {
                  label: 'Save into your engineering project',
                  hint: engineeringRoot ? `(${engineeringRoot}: XAE reads it from there)` : '(its folder chosen once: the one with the .tsproj that runs on this PLC)',
                  run: saveIntoEngineering,
                }
              : plcBuild.via === 'plc'
              ? {
                  label: 'Download the POU',
                  hint: '(as edited here: put it into your engineering project in place of its file)',
                  run: async () => {
                    downloadSource(pouFileName || 'POU.TcPOU', pouContent);
                    if (dutContent && dutContent !== savedSources.dut && dutFileName) downloadSource(dutFileName, dutContent);
                    return null;
                  },
                }
              : plcBuild.via === 'project' || plcBuild.via === 'webProject'
                ? {
                    label: 'Save to the project',
                    hint: '(this POU and its enum, to their files: XAE reads them from there)',
                    run: async () => {
                      await saveSourcesRef.current({ checked: true });
                      return null;
                    },
                  }
                : undefined
          }
        />
      )}
      {paletteOpen && <CommandPalette commands={paletteCommands()} onClose={() => setPaletteOpen(false)} />}
      {plcPicker?.files && (
        <CommandPalette
          id="plc-pou-picker"
          label="Open from the PLC"
          placeholder={`A POU of ${plcPicker.plcProject ?? plcPicker.project ?? 'the PLC'}'s sources (${plcPous(plcPicker.files).length}), opened here…`}
          commands={[
            ...plcPous(plcPicker.files).map((p) => ({ id: `plc-pou:${p.path}`, group: 'POU', label: p.name, hint: p.folder, run: () => openPlcPouHere(plcPicker, p.name) })),
            // Several PLC projects on the target: another one's POUs
            ...(plcPicker.projects ?? [])
              .filter((p) => p.name !== plcPicker.plcProject)
              .map((p) => ({ id: `plc-project:${p.name}`, group: 'PLC project', label: p.name, hint: p.port ? `ADS port ${p.port}: its POUs` : 'its POUs', run: () => handleOpenFromPlc(p.name) })),
          ]}
          onClose={() => setPlcPicker(null)}
        />
      )}
      {instancePicker && (
        <CommandPalette
          id="live-instance-picker"
          label="Which instance"
          placeholder={`The PLC has ${instancePicker.instances.length} instances of ${instancePicker.typeName ?? pouTypeName ?? 'this POU'}: the one to ${instancePicker.onPick ? 'go live on' : 'follow here'}…`}
          commands={instancePicker.instances.map((i) => ({
            id: `live-instance:${i}`,
            group: 'Instance',
            label: i,
            hint: instancePicker.current && i.toLowerCase() === instancePicker.current.toLowerCase() ? 'followed now' : instancePicker.onPick ? 'go live on it' : 'follow it here',
            run: () => {
              instancePickedRef.current = true;
              if (instancePicker.onPick) instancePicker.onPick(i);
              else if (!(instancePicker.current && i.toLowerCase() === instancePicker.current.toLowerCase())) handleGoLiveHere(i);
            },
          }))}
          onClose={() => {
            // (a pick runs after the palette closes: not picked by then, it was dismissed)
            const dismiss = instancePicker.onDismiss;
            instancePickedRef.current = false;
            setInstancePicker(null);
            if (dismiss) setTimeout(() => !instancePickedRef.current && dismiss(), 50);
          }}
        />
      )}
      {endPicker && (() => {
        const e = currentEdge(endPicker.edge);
        const keep = endPicker.end === 'start' ? e.from : e.to;
        const region = regionOfRef.current.get(e.from)?.variable ?? null;
        // (a sub-machine's transition: the other states of its sub-machine)
        const subOfEdge = subMachineId(pouContent, e.to) ?? subMachineId(pouContent, e.from);
        const subStates = subOfEdge ? subMachines.find((m) => m.parent === subOfEdge.parent && m.method === subOfEdge.method)?.states.map((n) => `${subOfEdge.parent}__${subOfEdge.method}__${n}`) ?? [] : null;
        const states = subStates ? subStates.filter((id) => id !== keep) : identifiedStatesResult.states.map((st) => st.id).filter((id) => id !== keep && (regionOfRef.current.get(id)?.variable ?? null) === region);
        return (
          <CommandPalette
            id="edge-end-picker"
            label={endPicker.end === 'start' ? 'Move start to' : 'Move end to'}
            placeholder={endPicker.end === 'start' ? `${e.from} → ${e.to}: the state it starts from instead of ${e.from}…` : `${e.from} → ${e.to}: the state it goes to instead of ${e.to}…`}
            commands={states.map((id) => ({ id: `edge-end:${id}`, group: 'State', label: id, hint: endPicker.end === 'start' ? `${id} → ${e.to}` : `${e.from} → ${id}`, run: () => handleEdgeEndpointDrop(endPicker.edge, endPicker.end, id) }))}
            onClose={() => setEndPicker(null)}
          />
        );
      })()}
      {symbolSearchOpen && <CommandPalette id="symbol-search" label="Go to symbol" placeholder="Go to a symbol: a type, a GVL variable, a method, a member, a state…" commands={symbolCommands()} onClose={() => setSymbolSearchOpen(false)} />}
      {bookmarksOpen && (
        <BookmarksDialog
          entries={bookmarkEntries}
          onClose={() => setBookmarksOpen(false)}
          onClear={() => clearBookmarks(pouFileName)}
          onOpen={openBookmark}
          onNote={(e, note) => setBookmarkNote(pouFileName, e.key, note)}
          onStep={stepBookmark}
          onExport={() => ({ name: `${(pouFileName || 'POU').replace(/\.TcPOU$/i, '')}.bookmarks.json`, text: exportBookmarks(pouFileName) })}
          onImport={(text) => {
            const r = importBookmarks(pouFileName, text);
            return r.error ?? `Imported: ${r.added} bookmark${r.added === 1 ? '' : 's'} added`;
          }}
        />
      )}
      {diffView && !diffView.docked && <DiffPanel key={JSON.stringify(diffView.req)} {...diffInfo(diffView.req)} onClose={closeDiff} onDock={dockDiff} />}
      {plcCopyDiff && <DiffDialog title={plcCopyDiff.title} beforeLabel="on the PLC" afterLabel="your local copy" parts={plcCopyDiff.parts} onClose={() => setPlcCopyDiff(null)} />}
      {refsView && <ReferencesDialog name={refsView.name} refs={refsView.refs} onOpen={handleOpenReference} onClose={() => setRefsView(null)} />}
      {updateOffer && (
        <div id="update-banner" className="fixed bottom-10 right-4 z-[70] flex items-center gap-3 px-4 py-2 rounded-lg border border-emerald-700 bg-slate-900 shadow-xl text-sm text-slate-200">
          <span>
            Kval MachineScope {updateOffer.edition === 'xae' ? 'for XAE' : 'desktop'} <b>{updateOffer.version}</b> is available (this is {updateOffer.current})
          </span>
          {updateInstall && (
            <span id="update-install-state" data-busy={String(updateInstall.busy)} className={updateInstall.busy ? 'text-emerald-300' : 'text-rose-300'}>
              {updateInstall.busy && <Loader2 className="inline w-3 h-3 mr-1 animate-spin" />}
              {updateInstall.text}
            </span>
          )}
          {updateOffer.installable && !updateInstall?.busy && (
            <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer" title="The installer without its pages; the app starts again when it is installed">
              <input id="update-quiet" type="checkbox" checked={updateQuiet} onChange={(e) => { setUpdateQuiet(e.target.checked); saveUpdateSettings({ ...loadUpdateSettings(), quiet: e.target.checked }); }} />
              quietly, then start again
            </label>
          )}
          {updateOffer.installable && (
            <button
              id="update-install"
              disabled={!!updateInstall?.busy}
              onClick={() => void handleInstallUpdate()}
              title="Downloads its installer from the release, checks it, and starts it: this app closes (save your work first)"
              className="px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white"
            >
              Update now
            </button>
          )}
          <a id="update-open" href={updateOffer.url} target="_blank" rel="noreferrer" onClick={() => setUpdateOffer(null)} className={`px-3 py-1 rounded text-white ${updateOffer.installable ? 'border border-slate-600 hover:bg-slate-800' : 'bg-emerald-700 hover:bg-emerald-600'}`}>
            {updateOffer.installable ? 'Release' : 'Get it'}
          </a>
          <button
            onClick={() => {
              saveUpdateSettings({ ...loadUpdateSettings(), skipped: updateOffer.version });
              setUpdateOffer(null);
            }}
            className="px-2 py-1 rounded hover:bg-slate-800 text-slate-400"
          >
            Later
          </button>
        </div>
      )}
      {watchRequest && pouTypeName?.toLowerCase() !== watchRequest.type.toLowerCase() && (
        <div id="watch-banner" className="fixed top-14 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3 px-4 py-2 rounded-lg border border-sky-700 bg-slate-900 shadow-xl text-sm text-slate-200">
          <span>
            To watch <span className="font-mono text-sky-300">{watchRequest.instance}</span> live, open <span className="font-mono">{watchRequest.type}.TcPOU</span>
          </span>
          <button id="watch-banner-browse" onClick={() => void handleWatchBrowse()} className="px-3 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white">
            Browse...
          </button>
          <button onClick={() => setWatchRequest(null)} className="px-2 py-1 rounded hover:bg-slate-800 text-slate-400" title="Not now">
            ×
          </button>
        </div>
      )}
      {review && (
        <BeforeAfterDialog
          before={review.before}
          after={review.after}
          diff={review.diff}
          savedLabel={review.label}
          parts={review.parts}
          onClose={() => setReview(null)}
          onSave={review.noSave ? undefined : () => (isXaeHost() ? handleSaveToProject() : void handleSaveSources())}
        />
      )}
      {compareOpen && (
        <CompareRecordingsDialog
          onClose={() => setCompareOpen(false)}
          current={liveSession.transitions.length ? { label: replay ? replay.file : 'this session', transitions: liveSession.transitions } : null}
          names={liveEnumNames}
          edges={availableEdges}
        />
      )}
      {gatewayRecordingsOpen && (
        <GatewayRecordingsDialog
          onClose={() => setGatewayRecordingsOpen(false)}
          request={gatewayRequest}
          onReplay={startReplay}
          pouTypeName={pouTypeName}
          stateName={(type, value) => ((type.split('.').pop() ?? '').toLowerCase() === (pouTypeName ?? '').toLowerCase() ? liveEnumNames.get(Number(value)) ?? null : null)}
        />
      )}
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
          // (a link into a choice is no transition of its own: the one out of it is)
          transitionsCount={availableEdges.filter((e) => !/^choice_/.test(e.to)).length}
          errors={activeLintFindings.filter((f) => f.severity === 'error').length}
          warnings={activeLintFindings.filter((f) => f.severity === 'warning').length}
          onOpenProblems={() => showDockTab('problems')}
          live={liveActive ? { state: liveSession.current?.state ?? null, message: liveStatus.message } : null}
          onOpenLive={() => showDockTab('live')}
          io={ioHealth}
          layout={layoutStatus}
          layoutMenu={layoutMenu}
          onOpenIo={() => showDockTab('io')}
          changes={chartDiff && compareOnDiagram ? chartDiff.total : null}
          onOpenChanges={() => showDockTab('changes')}
          host={appHost}
          version={editionVersion(editionOf(appHost))}
          onOpenReleaseNotes={() => setReleaseNotesOpen((v) => !v)}
          followSelection={followSelection}
          onFollowSelectionChange={setFollowSelection}
          backTo={pouHistory.length ? { name: pouHistory[pouHistory.length - 1].name, onClick: handleBackToPreviousPou } : null}
        />
      )}
    </div>
  );
};
