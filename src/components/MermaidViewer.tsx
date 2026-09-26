import React, { useEffect, useRef, useState, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import mermaid from 'mermaid';
import elkLayouts from '@mermaid-js/layout-elk';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Minimize2,
  AlertCircle,
  Copy,
  Check,
  Download,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  Palette,
  StickyNote,
  FileImage,
  FileCode,
  Sparkles,
  Sliders,
  MousePointerClick,
  SlidersHorizontal,
  Map,
  Grid,
  Magnet,
  BookOpen,
  Activity,
  Flame,
  AlertTriangle,
  Lock,
  Unlock,
  Code2,
  ListFilter,
  Workflow,
  Printer,
  Loader2,
  ShieldCheck,
  ArrowRight,
  Target,
} from 'lucide-react';
import { DiagramMinimap } from './DiagramMinimap.tsx';
import { DiagramLegendOverlay } from './DiagramLegendOverlay.tsx';
import { ToolbarHiddenControls, ToolbarItemId } from './ToolbarHiddenControls.tsx';
import { useToolbarOverflow } from '../hooks/useToolbarOverflow.ts';
import { StateMachineStatsPanel } from './StateMachineStatsPanel.tsx';
import { ComplexityHeatmapPanel } from './ComplexityHeatmapPanel.tsx';
import {
  calculateStateComplexityHeatmap,
  ComplexityHeatmapResult,
  HeatmapPalette,
  StateComplexityMetric,
} from '../utils/complexityHeatmap.ts';
import { exportDiagramVisibleAreaToPdf } from '../utils/printToPdf.ts';
import { DiagramSearchPanel } from './DiagramSearchPanel.tsx';
import { DiagramSnapGuides } from './DiagramSnapGuides.tsx';
import {
  SnapConfig,
  DEFAULT_SNAP_CONFIG,
  calculateSnappedPosition,
  SnapResult,
} from '../utils/snapToGrid.ts';
import { StateNodeStyleInspector, InspectorPanelMode } from './StateNodeStyleInspector.tsx';
import { StateStylePopup } from './StateStylePopup.tsx';
import { DiagramContextMenu, ContextMenuExtraItem } from './DiagramContextMenu.tsx';
import { NoteDialog } from './NoteDialog.tsx';
import { NotesDrawer } from './NotesDrawer.tsx';
import { NoteOverlaysLayer } from './NoteOverlaysLayer.tsx';
import { ExportModal } from './ExportModal.tsx';
import { TransitionGuardInspector } from './TransitionGuardInspector.tsx';
import { PreProcessStructuredTextEditor } from './PreProcessStructuredTextEditor.tsx';
import { MethodStructuredTextEditor } from './MethodStructuredTextEditor.tsx';
import { DutEnumEditor } from './DutEnumEditor.tsx';
import { createInteractiveMermaidCode, parseConditionClauses } from '../utils/interactiveDiagram.ts';
import {
  exportHighResSvg,
  exportHighResPng,
  copyToClipboard,
  triggerDownload,
  ExportFormat,
  ExportScale,
  ExportBackground,
} from '../utils/diagramExport.ts';
import {
  CustomNodeStylesMap,
  NodeDisplayProperties,
  DiagramNotes,
  ContextMenuTarget,
  EdgeInfo,
  NotePosition,
  SearchMatchItem,
  PresetExportSettings,
  CustomEdgeStylesMap,
  EdgeDisplayProperties,
} from '../types.ts';
import { applyEdgeStylesToSvg } from '../utils/edgeStyles.ts';
import type { EdgeGuardView } from '../utils/liveGuards.ts';
import { extractStateNodesFromMermaid } from '../utils/nodeStyles.ts';
import {
  extractEdgesFromMermaid,
  countTotalNotes,
} from '../utils/diagramNotes.ts';
import {
  NodeOffsetsMap,
  EdgeOffsetsMap,
  EdgeOffset,
  initializeSvgDragMetadata,
  applyDiagramOffsetsToSvg,
  resetSvgDiagramOffsets,
  cleanNodeId,
  findNodeElement,
  findEdgePathElement,
  getEdgeAnchorPoint,
  parseTranslation,
  getNodeGeometry,
} from '../utils/nodeDragger.ts';
import {
  CanvasNodePositionsMap,
  extractCanvasNodePositions,
} from '../utils/canvasPositions.ts';

export type LayoutEngine = 'dagre' | 'elk';
export type FlowchartCurve = 'basis' | 'linear' | 'cardinal' | 'stepAfter' | 'monotoneX' | 'natural';
export type MermaidTheme = 'dark' | 'neutral' | 'forest' | 'base' | 'default';

let elkRegistered = false;
function ensureElkRegistered() {
  if (!elkRegistered && typeof mermaid.registerLayoutLoaders === 'function') {
    try {
      mermaid.registerLayoutLoaders(elkLayouts);
      elkRegistered = true;
    } catch (e) {
      console.warn('Failed to register ELK layout loaders:', e);
    }
  }
}

export interface MermaidViewerHandle {
  panToState: (stateId: string, timestamp?: number) => void;
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToScreen: () => void;
  autoAlign: () => void;
  openExportModal: (format?: ExportFormat) => void;
  quickDownloadPng: (scale?: ExportScale) => Promise<void>;
  quickDownloadSvg: (scale?: ExportScale) => Promise<void>;
  quickCopyPng: (scale?: ExportScale) => Promise<{ success: boolean; message: string }>;
  quickCopySvg: () => Promise<{ success: boolean; message: string }>;
  exportWithSettings: (settings: PresetExportSettings) => Promise<void>;
  printVisiblePdf: () => Promise<void>;
  getActiveSvgElement: () => SVGSVGElement | null;
}

export interface MermaidViewerProps {
  code: string;
  layoutEngine?: LayoutEngine;
  flowchartCurve?: FlowchartCurve;
  mermaidTheme?: MermaidTheme;
  /** Export format, scale & background from the active diagram preset */
  exportSettings?: PresetExportSettings;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  selectedStateId?: string | null;
  selectedStateLabel?: string;
  onSelectState?: (stateId: string | null, label?: string) => void;
  customStyles?: CustomNodeStylesMap;
  onStyleChange?: (stateId: string, style: NodeDisplayProperties) => void;
  onResetStateStyle?: (stateId: string) => void;
  onClearAllCustomStyles?: () => void;
  /** Custom line colour / width / pattern per transition id */
  customEdgeStyles?: CustomEdgeStylesMap;
  onEdgeStyleChange?: (edgeId: string, style: EdgeDisplayProperties | null) => void;
  /** TwinCAT XAE: open a state's CASE branch / a transition in TwinCAT's editor */
  onShowInXae?: (target: { kind: 'state'; id: string } | { kind: 'edge'; edge: EdgeInfo }) => void;
  /** States with lint problems (Problems tab): a badge on their node */
  problemMarkers?: Record<string, 'error' | 'warning'>;
  /** Live view: the PLC's current state (and the one it came from) are highlighted */
  liveHighlight?: { stateId: string; previousStateId?: string } | null;
  /** Details follow the selection: the first click on a transition also opens its Transition Guard window */
  openGuardOnSelect?: boolean;
  /** Changes tab: states / transitions added (green) or changed (amber) against the compared version */
  diffHighlight?: { added: string[]; changed: string[]; edgesAdded: { from: string; to: string }[]; edgesChanged: { from: string; to: string }[] } | null;
  /** Live view: each transition's guard result (TRUE / FALSE / unknown) and its variables' values, by edge id */
  liveGuards?: Record<string, EdgeGuardView> | null;
  /** Paths tab: the states and transitions of the shown path(s); everything else is dimmed */
  pathHighlight?: { states: string[]; edges: { from: string; to: string }[] } | null;
  /** The app's extra context menu actions for a state, transition or the canvas */
  contextMenuItems?: (target: ContextMenuTarget) => ContextMenuExtraItem[];
  /** Connect mode (Add transition from here): the source state; the next state clicked is the target */
  connectFrom?: string | null;
  onConnectTo?: (stateId: string) => void;
  onConnectCancel?: () => void;
  nodeOffsets?: NodeOffsetsMap;
  onNodeOffsetsChange?: (offsets: NodeOffsetsMap) => void;
  notes?: DiagramNotes;
  onSaveNote?: (target: ContextMenuTarget, noteText: string) => void;
  onDeleteNote?: (target: ContextMenuTarget) => void;
  onClearAllNotes?: () => void;
  onUpdateNotePosition?: (targetId: string, pos: NotePosition) => void;
  onUpdateNoteStyle?: (targetId: string, style: NodeDisplayProperties | null) => void;
  onCanvasPositionsChange?: (positions: CanvasNodePositionsMap) => void;
  onOpenMermaidLive?: () => void;
  fileName?: string;
  interactiveMode?: boolean;
  onInteractiveModeChange?: (enabled: boolean) => void;
  tcPouContent?: string;
  tcPouFileName?: string;
  tcDutContent?: string;
  tcDutFileName?: string;
  onSaveDutContent?: (newDutContent: string) => { success: boolean; error?: string };
  onOpenEnumEditor?: (memberName?: string) => void;
  onOpenMethodEditor?: (methodName?: string) => void;
  onSaveMethodCode?: (methodName: string, newCode: string, newDeclaration?: string) => { success: boolean; error?: string };
  onSaveStateCode?: (stateId: string, newCode: string) => { success: boolean; error?: string };
  onSavePreProcessCode?: (newCode: string, newDeclaration?: string) => { success: boolean; error?: string };
  focusStateRequest?: { stateId: string; timestamp: number } | null;
  priorityFormat?: 'circled' | 'bracket' | 'paren';
  layoutLocked?: boolean;
  onLayoutLockedChange?: (locked: boolean) => void;
  onToast?: (message: string, type: 'success' | 'error') => void;
  toolbarPortalTarget?: HTMLElement | null;
  onSwitchToDiagramTab?: () => void;
  /** Render the Keyword Search panel and Minimap into external dock panels instead of canvas overlays */
  dockedPanels?: DockedCanvasPanels;
  /** Open a docked inspector tab instead of the floating inspector window. `reveal: false` avoids covering the canvas */
  onOpenInspectorPanel?: (mode: InspectorPanelMode, options?: { method?: string; reveal?: boolean }) => void;
}

/** Canvas tool windows that can be docked as RightPanel tabs (the minimap and legend stay canvas overlays) */
export type DockedCanvasPanelId = 'search' | 'stats' | 'heatmap' | 'notes';

export interface DockedCanvasPanels {
  /** Host element each tool window is rendered into */
  targets: Record<DockedCanvasPanelId, HTMLElement>;
  /** Tab is open (content rendered, possibly behind another tab) */
  open: Record<DockedCanvasPanelId, boolean>;
  /** Tab is on screen; toggles close a visible tab and bring a hidden one forward */
  visible: Record<DockedCanvasPanelId, boolean>;
  onOpenChange: (id: DockedCanvasPanelId, open: boolean) => void;
}

/**
 * Open/closed state of a canvas tool window. Floating: local state. Docked: owned by the workspace
 * layout. The setter is stable (reads docked props through a ref) because keyboard shortcut effects capture it.
 */
function useCanvasPanelOpenState(
  id: DockedCanvasPanelId | 'minimap' | 'legend',
  initial: boolean,
  docked: DockedCanvasPanels | undefined
): [boolean, (value: React.SetStateAction<boolean>) => void] {
  const [internal, setInternal] = useState<boolean>(initial);
  const dockedRef = useRef(docked);
  dockedRef.current = docked;
  const setOpen = useCallback(
    (value: React.SetStateAction<boolean>) => {
      const d = dockedRef.current;
      if (!d || id === 'minimap' || id === 'legend') return setInternal(value);
      d.onOpenChange(id, typeof value === 'function' ? value(d.visible[id]) : value);
    },
    [id]
  );
  return [docked && id !== 'minimap' && id !== 'legend' ? docked.open[id] : internal, setOpen];
}

interface ParsedPath {
  pathEl: Element;
  startX: number;
  startY: number;
  dirX: number;
  dirY: number;
  allPoints: { x: number; y: number }[];
  classes: string;
  id: string;
}

/**
 * Finds the transition(s) for a Mermaid flowchart link id. Mermaid names links `L_<from>_<to>_<n>`, with n
 * increasing in document order for links between the same pair of states, but not always consecutive
 * (e.g. _0, _2, _3). The link's rank among all rendered links of that pair therefore selects the matching
 * edge (edges are extracted in document order).
 */
function matchEdgesByLinkId(linkId: string, edges: EdgeInfo[], allLinkIds: string[]): EdgeInfo[] {
  const parse = (id: string) => id.match(/(?:^|-)L_(.+)_(\d+)$/);
  const m = parse(linkId);
  if (!m) return [];
  const pairEdges = edges.filter((e) => `${e.from}_${e.to}` === m[1]);
  const pairSuffixes = [...new Set(allLinkIds.map(parse).filter((x) => x && x[1] === m[1]).map((x) => Number(x![2])))].sort(
    (a, b) => a - b
  );
  const nth = pairEdges[pairSuffixes.indexOf(Number(m[2]))];
  return nth ? [nth] : pairEdges;
}

/** Guard text without priority prefixes, note markers and truncation, for comparing labels with transitions */
function normalizeGuardText(text: string): string {
  return text
    .replace(/📝.*$/, '')
    .replace(/▾/g, '')
    .replace(/\.\.\./g, '')
    .replace(/\(\+\d+\)/g, '')
    .replace(/^[①-⑳㉑-㉟㊱-㊿]\s*/, '')
    .replace(/^\(\d+\)\s*/, '')
    .replace(/^\[\d+\]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * stateDiagram-v2 links are named `edge<N>` in document order, the same order transitions are extracted in.
 * The positional candidate is only trusted when its guard text or priority agrees with the rendered label.
 */
function matchStateDiagramEdge(
  linkId: string,
  edges: EdgeInfo[],
  labelText: string,
  priority: number | undefined
): EdgeInfo | null {
  const m = linkId.match(/^edge(\d+)$/);
  const cand = m ? edges[Number(m[1])] : undefined;
  if (!cand) return null;
  const label = normalizeGuardText(labelText);
  const guard = normalizeGuardText(cand.condition || cand.label || '');
  const textAgrees = label.length > 0 && guard.length > 0 && (guard === label || guard.startsWith(label) || label.startsWith(guard));
  const priorityAgrees = priority !== undefined && cand.priority === priority;
  // With guard text on both sides the texts must agree; otherwise fall back to priority / both unlabelled
  if (label && guard) return textAgrees ? cand : null;
  return priorityAgrees || (!label && !guard) ? cand : null;
}

/**
 * Moves a badge's content into an inner group. The outer group is positioned with a
 * transform="translate()" attribute, which a CSS hover transform would replace (making the badge jump),
 * so the hover scale is applied to the inner group instead.
 */
function wrapBadgeContent(badgeG: SVGGElement): void {
  const body = badgeG.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
  body.setAttribute('class', 'tc-complexity-badge-body');
  while (badgeG.firstChild) body.appendChild(badgeG.firstChild);
  badgeG.appendChild(body);
}

/**
 * Screen pixels per SVG user unit for an element's coordinate space. Includes the canvas zoom AND Mermaid's
 * fit-to-canvas viewBox scaling, so dragged items follow the cursor 1:1 however the diagram is scaled.
 */
function getSvgUnitScale(el: Element | null, fallback: number): { x: number; y: number } {
  const ctm = (el as SVGGraphicsElement | null)?.getScreenCTM?.();
  if (!ctm) return { x: fallback, y: fallback };
  const x = Math.hypot(ctm.a, ctm.b);
  const y = Math.hypot(ctm.c, ctm.d);
  return x > 0 && y > 0 ? { x, y } : { x: fallback, y: fallback };
}

function extractPriorityFromText(text: string): { priority: number; symbol: string } | null {
  if (!text) return null;
  // Check (1) or (2)...
  const mParen = text.match(/(?:^|\s)\((\d+)\)/);
  if (mParen) {
    return { priority: parseInt(mParen[1], 10), symbol: `(${mParen[1]})` };
  }
  // Check [1] or [2]...
  const mBracket = text.match(/(?:^|\s)\[(\d+)\]/);
  if (mBracket) {
    return { priority: parseInt(mBracket[1], 10), symbol: `[${mBracket[1]}]` };
  }
  // Check Unicode circled numbers ①..⑳ (0x2460..0x2473)
  for (let i = 1; i <= 20; i++) {
    const sym = String.fromCodePoint(0x2460 + i - 1);
    if (text.includes(sym)) return { priority: i, symbol: sym };
  }
  // Check ㉑..㉟ (0x3251..0x325f)
  for (let i = 21; i <= 35; i++) {
    const sym = String.fromCodePoint(0x3251 + i - 21);
    if (text.includes(sym)) return { priority: i, symbol: sym };
  }
  // Check ㊱..㊿ (0x32b1..0x32bf)
  for (let i = 36; i <= 50; i++) {
    const sym = String.fromCodePoint(0x32b1 + i - 36);
    if (text.includes(sym)) return { priority: i, symbol: sym };
  }
  const m = text.match(/\[priority:\s*(\d+)\]/i);
  if (m) {
    return { priority: parseInt(m[1], 10), symbol: m[0] };
  }
  return null;
}

function parsePathData(p: Element): ParsedPath | null {
  const d = p.getAttribute('d');
  if (!d) return null;
  const numbers = d.match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 2) return null;

  const allPoints: { x: number; y: number }[] = [];
  for (let i = 0; i < numbers.length - 1; i += 2) {
    allPoints.push({ x: parseFloat(numbers[i]), y: parseFloat(numbers[i + 1]) });
  }
  if (allPoints.length === 0) return null;

  const startX = allPoints[0].x;
  const startY = allPoints[0].y;
  let dirX = 0;
  let dirY = 1;

  if (allPoints.length > 1) {
    const dx = allPoints[1].x - startX;
    const dy = allPoints[1].y - startY;
    const len = Math.hypot(dx, dy);
    if (len > 0.0001) {
      dirX = dx / len;
      dirY = dy / len;
    }
  }

  const parent = p.parentElement;
  const classes = `${p.getAttribute('class') || ''} ${parent?.getAttribute('class') || ''}`;
  const id = `${p.getAttribute('id') || ''} ${parent?.getAttribute('id') || ''}`;

  return { pathEl: p, startX, startY, dirX, dirY, allPoints, classes, id };
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

function minDistanceToPath(labelPt: { x: number; y: number }, pathPts: { x: number; y: number }[]): number {
  let minDist = Infinity;
  for (let i = 0; i < pathPts.length - 1; i++) {
    const d = distToSegment(labelPt.x, labelPt.y, pathPts[i].x, pathPts[i].y, pathPts[i + 1].x, pathPts[i + 1].y);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function getLabelPos(el: Element): { x: number; y: number } | null {
  let cur: Element | null = el;
  while (cur && cur.nodeName.toLowerCase() !== 'svg') {
    const tf = cur.getAttribute('transform');
    if (tf) {
      const tm = tf.match(/translate\(\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)\s*\)/);
      if (tm) return { x: parseFloat(tm[1]), y: parseFloat(tm[2]) };
      const mm = tf.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)\s*\)/);
      if (mm) return { x: parseFloat(mm[1]), y: parseFloat(mm[2]) };
    }
    cur = cur.parentElement;
  }
  const textEl = el.querySelector('text') || el;
  const x = textEl.getAttribute('x');
  const y = textEl.getAttribute('y');
  if (x && y) {
    return { x: parseFloat(x), y: parseFloat(y) };
  }
  return null;
}

function cleanSymbolFromLabel(labelEl: Element, symbol: string) {
  try {
    const doc = labelEl.ownerDocument;
    const walker = doc.createTreeWalker(labelEl, 4 /* NodeFilter.SHOW_TEXT */);
    let textNode = walker.nextNode();
    while (textNode) {
      if (textNode.nodeValue && textNode.nodeValue.includes(symbol)) {
        textNode.nodeValue = textNode.nodeValue.replace(symbol, '').trim();
        break;
      }
      textNode = walker.nextNode();
    }
  } catch {
    // Fallback if TreeWalker is unsupported
    if (labelEl.textContent && labelEl.textContent.includes(symbol)) {
      labelEl.textContent = labelEl.textContent.replace(symbol, '').trim();
    }
  }
}

/**
 * Resolves the full un-truncated guard condition expression for an edge.
 * Avoids any compacting ellipses (...) from interactive rendering modes.
 */
function getFullGuardCondition(edge: EdgeInfo, labelEl?: Element | null): string {
  // If edge already has an untruncated condition from diagram source, prefer it
  if (edge.condition && !edge.condition.endsWith('...') && !edge.condition.endsWith('▾')) {
    let cand = edge.condition.trim();
    if (cand && cand !== '->') {
      const prio = extractPriorityFromText(cand);
      if (prio && prio.symbol) {
        cand = cand.replace(prio.symbol, '').trim();
      }
      return cand || '(unconditional transition)';
    }
  }

  let cand = labelEl?.getAttribute('data-condition')?.trim() || '';
  if (!cand || cand.endsWith('...') || cand.endsWith('▾') || cand.endsWith('... ▾')) {
    cand = (edge.condition || edge.guard || edge.label || '').trim();
  }
  if (!cand) {
    cand = (edge.label || '').trim();
  }

  // If candidate still contains truncated ellipsis, check edge.condition
  if ((cand.endsWith('...') || cand.endsWith('▾') || cand.endsWith('... ▾')) && edge.condition) {
    if (!edge.condition.endsWith('...') && !edge.condition.endsWith('▾')) {
      cand = edge.condition;
    }
  }

  if (!cand || cand === '->') {
    return '(unconditional transition)';
  }

  // Strip priority symbol if present (e.g. [1], (1), ①, etc.)
  const prio = extractPriorityFromText(cand);
  if (prio && prio.symbol) {
    cand = cand.replace(prio.symbol, '').trim();
  }

  // Normalize HTML / XML entities and formatting
  cand = cand
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/#35;/g, '#')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/📝.*$/, '')
    .trim();

  // Strip wrapping quotes if any
  if (
    (cand.startsWith('"') && cand.endsWith('"')) ||
    (cand.startsWith("'") && cand.endsWith("'"))
  ) {
    cand = cand.slice(1, -1).trim();
  }

  // Remove trailing expand arrow if present
  cand = cand.replace(/\s*▾$/, '').trim();

  return cand || '(unconditional transition)';
}

/**
 * Attempts to extract the full untruncated guard expression directly from the TwinCAT POU Structured Text
 * in case the input diagram string was already truncated.
 */
function tryExtractGuardFromPou(pouContent: string | undefined, fromState: string, toState: string): string | null {
  if (!pouContent || !fromState || !toState) return null;
  try {
    const caseRegex = new RegExp(`\\b${fromState}\\s*:[\\s\\S]*?(?=\\n\\s*[A-Za-z0-9_]+\\s*:(?!\\=)|END_CASE)`, 'i');
    const caseMatch = pouContent.match(caseRegex);
    const searchArea = caseMatch ? caseMatch[0] : pouContent;

    const ifRegex = new RegExp(`(?:IF|ELSIF)\\b([\\s\\S]*?)\\bTHEN[\\s\\S]*?:=\\s*${toState}\\b`, 'i');
    const match = searchArea.match(ifRegex);
    if (match && match[1]) {
      const cleaned = match[1]
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned) return cleaned;
    }
  } catch {
    // ignore
  }
  return null;
}

function resolveEdgeFromElement(
  targetEl: Element,
  svg: SVGSVGElement | null,
  availableEdges: EdgeInfo[]
): EdgeInfo | null {
  // 0. Click on edge handle (start, end, or waypoint handle)
  const handleEl = targetEl.closest('.tc-edge-handle');
  if (handleEl) {
    const handleEdgeId = handleEl.getAttribute('data-edge-id');
    if (handleEdgeId) {
      const srcId = handleEl.getAttribute('data-source-id');
      const tgtId = handleEl.getAttribute('data-target-id');
      const found = availableEdges.find(
        (e) => e.id === handleEdgeId || (srcId && tgtId && e.from === srcId && e.to === tgtId)
      );
      if (found) return { ...found, id: handleEdgeId };
      return { id: handleEdgeId, from: srcId || '', to: tgtId || '' };
    }
  }

  // 1. Direct path / hitbox element / edge group
  const pathEl = (targetEl.closest('path.tc-edge-path') ||
    targetEl.closest('.tc-edge-hitbox') ||
    targetEl.closest('g.edgePath') ||
    targetEl.closest('g.edgePaths path') ||
    targetEl.closest('[data-edge-id]')) as Element | null;

  if (pathEl) {
    const realPath = pathEl.classList.contains('tc-edge-hitbox')
      ? (pathEl.previousElementSibling as SVGPathElement | null) || pathEl
      : (pathEl.tagName.toLowerCase() === 'path' ? pathEl : pathEl.querySelector('path') || pathEl);

    const pathId =
      realPath.getAttribute('data-path-id') ||
      realPath.getAttribute('id') ||
      pathEl.getAttribute('data-path-id') ||
      pathEl.getAttribute('id') ||
      '';

    let sourceId =
      realPath.getAttribute('data-source-id') ||
      pathEl.getAttribute('data-source-id') ||
      '';
    let targetId =
      realPath.getAttribute('data-target-id') ||
      pathEl.getAttribute('data-target-id') ||
      '';

    const idStr = `${realPath.getAttribute('id') || pathEl.getAttribute('id') || ''}`;

    if (!sourceId || !targetId) {
      const classStr = `${pathEl.getAttribute('class') || ''} ${realPath.getAttribute('class') || ''} ${pathEl.parentElement?.getAttribute('class') || ''}`;
      const ls = classStr.match(/\bLS-([A-Za-z0-9_]+)\b/);
      const le = classStr.match(/\bLE-([A-Za-z0-9_]+)\b/);
      if (ls) sourceId = ls[1];
      if (le) targetId = le[1];

      if (!sourceId || !targetId) {
        // Direct search across availableEdges against idStr
        for (const e of availableEdges) {
          const cf = cleanNodeId(e.from);
          const ct = cleanNodeId(e.to);
          const patterns = [
            `L_${e.from}_${e.to}`,
            `L-${e.from}-${e.to}`,
            `_${e.from}_${e.to}_`,
            `-${e.from}-${e.to}-`,
            `_${cf}_${ct}_`,
            `-${cf}-${ct}-`,
            `L_${cf}_${ct}`,
            `L-${cf}-${ct}`,
          ];
          if (patterns.some((p) => idStr.includes(p))) {
            sourceId = e.from;
            targetId = e.to;
            break;
          }
        }
      }

      if (!sourceId || !targetId) {
        // Strip renderer prefixes like mermaid-123-L_ or testelk-L_
        const stripped = idStr
          .replace(/^.*?[_-]L[_-]/, '')
          .replace(/^(?:flowchart|edge)[_-]/, '')
          .replace(/^L[_-]/, '');
        const m = stripped.match(/^([A-Za-z0-9_.]+?)[_-]([A-Za-z0-9_.]+?)(?:[_-](\d+))?$/);
        if (m) {
          sourceId = m[1];
          targetId = m[2];
        }
      }
    }

    // Parallel edges share source and target: the label linked to this path names the exact transition
    if (svg && pathId) {
      const linkedEdgeId = svg
        .querySelector(`g.edgeLabel[data-linked-path-id="${pathId}"]`)
        ?.getAttribute('data-edge-id');
      const byLabel = linkedEdgeId ? availableEdges.find((e) => e.id === linkedEdgeId) : undefined;
      if (byLabel) return { ...byLabel, pathId };
    }

    // Try finding matching edge in availableEdges
    let matchedEdge = pathId
      ? availableEdges.find((e) => e.id === pathId || (e.pathId && e.pathId === pathId))
      : null;
    if (!matchedEdge && sourceId && targetId) {
      matchedEdge = availableEdges.find(
        (e) =>
          (e.from === sourceId || cleanNodeId(e.from) === cleanNodeId(sourceId)) &&
          (e.to === targetId || cleanNodeId(e.to) === cleanNodeId(targetId))
      );
    }

    if (matchedEdge) {
      return {
        ...matchedEdge,
        id: matchedEdge.id,
        pathId: pathId || matchedEdge.pathId,
        from: matchedEdge.from,
        to: matchedEdge.to,
      };
    }

    if (sourceId && targetId) {
      return {
        id: `${sourceId}->${targetId}`,
        pathId: pathId || undefined,
        from: sourceId,
        to: targetId,
      };
    }

    if (pathId) {
      const pMatch = availableEdges.find((e) => e.id === pathId || e.pathId === pathId);
      if (pMatch) return pMatch;
      if (pathId.startsWith('path-')) {
        const pIdx = parseInt(pathId.replace('path-', ''), 10);
        if (!isNaN(pIdx) && pIdx >= 0 && pIdx < availableEdges.length) {
          return availableEdges[pIdx];
        }
      }
      return {
        id: pathId,
        pathId,
        from: '',
        to: '',
      };
    }
  }

  // 2. Edge label element
  const labelEl = (targetEl.closest('g.edgeLabel') ||
    targetEl.closest('.clickable-edge-label') ||
    targetEl.closest('.tc-interactive-edge-label')) as SVGGElement | null;
  if (labelEl) {
    const directEdgeId = labelEl.getAttribute('data-edge-id');
    if (directEdgeId) {
      const match = availableEdges.find(
        (e) => e.id === directEdgeId || `${e.from}->${e.to}` === directEdgeId || e.pathId === directEdgeId
      );
      if (match) return match;
    }

    const from = labelEl.getAttribute('data-from');
    const to = labelEl.getAttribute('data-to');
    if (from && to) {
      const match = availableEdges.find((e) => e.from === from && e.to === to);
      if (match) return match;
      return {
        id: `${from}->${to}`,
        from,
        to,
        label: labelEl.getAttribute('data-condition') || '',
        condition: labelEl.getAttribute('data-condition') || '',
        priority: Number(labelEl.getAttribute('data-priority')) || undefined,
      };
    }

    const linkedPathId = labelEl.getAttribute('data-linked-path-id');
    if (linkedPathId && svg) {
      const p = svg.querySelector(
        `path[data-path-id="${linkedPathId}"], path[data-edge-id="${linkedPathId}"], path#${linkedPathId}`
      ) as SVGPathElement | null;
      if (p) {
        const edgeFromP = resolveEdgeFromElement(p, svg, availableEdges);
        if (edgeFromP && edgeFromP.from && edgeFromP.to) return edgeFromP;
      }
    }

    const text = labelEl.textContent?.trim() || '';
    if (text) {
      const cleanLabelText = text
        .replace(/📝.*$/, '')
        .replace(/▾/g, '')
        .replace(/\.\.\./g, '')
        .replace(/\(\+\d+\)/g, '')
        .replace(/^[①-⑳㉑-㉟㊱-㊿]\s*/, '')
        .replace(/^\(\d+\)\s*/, '')
        .replace(/^\[\d+\]\s*/, '')
        .trim();
      const match = availableEdges.find((e) => {
        const fullCandidate = (e.condition || e.label || '').trim();
        if (!fullCandidate) return false;
        const eClean = fullCandidate
          .replace(/📝.*$/, '')
          .replace(/^[①-⑳㉑-㉟㊱-㊿]\s*/, '')
          .replace(/^\(\d+\)\s*/, '')
          .replace(/^\[\d+\]\s*/, '')
          .trim();
        return (
          eClean &&
          (cleanLabelText.includes(eClean) ||
            eClean.includes(cleanLabelText) ||
            (cleanLabelText.length >= 4 &&
              eClean.toLowerCase().startsWith(cleanLabelText.slice(0, Math.min(cleanLabelText.length, 12)).toLowerCase())) ||
            (eClean.length >= 4 &&
              cleanLabelText.toLowerCase().startsWith(eClean.slice(0, Math.min(eClean.length, 12)).toLowerCase())))
        );
      });
      if (match) return match;
    }

    if (svg) {
      const allLabels = Array.from(svg.querySelectorAll('g.edgeLabels g.edgeLabel'));
      const idx = allLabels.indexOf(labelEl);
      if (idx >= 0 && idx < availableEdges.length) {
        return availableEdges[idx];
      }
    }
  }

  // 3. Priority badge element
  const badgeEl = (targetEl.closest('.tc-priority-badge') || targetEl.closest('.priority-badge')) as SVGGElement | null;
  if (badgeEl) {
    const directEdgeId = badgeEl.getAttribute('data-edge-id');
    if (directEdgeId) {
      const match = availableEdges.find(
        (e) => e.id === directEdgeId || `${e.from}->${e.to}` === directEdgeId || e.pathId === directEdgeId
      );
      if (match) return match;
    }

    const from = badgeEl.getAttribute('data-from');
    const to = badgeEl.getAttribute('data-to');
    if (from && to) {
      const match = availableEdges.find((e) => e.from === from && e.to === to);
      if (match) return match;
      return {
        id: `${from}->${to}`,
        from,
        to,
        label: badgeEl.getAttribute('data-condition') || '',
        condition: badgeEl.getAttribute('data-condition') || '',
        priority: Number(badgeEl.getAttribute('data-priority')) || undefined,
      };
    }

    const prioVal = badgeEl.getAttribute('data-priority') || badgeEl.querySelector('text')?.textContent?.trim();
    if (prioVal) {
      const prioNum = parseInt(prioVal, 10);
      if (!isNaN(prioNum)) {
        const match = availableEdges.find((e) => e.priority === prioNum);
        if (match) return match;
      }
    }

    if (svg) {
      const pathId = badgeEl.getAttribute('data-path-id');
      if (pathId) {
        const p = svg.querySelector(
          `path[data-path-id="${pathId}"], path[data-edge-id="${pathId}"], path#${pathId}`
        ) as SVGPathElement | null;
        if (p) {
          const edgeFromP = resolveEdgeFromElement(p, svg, availableEdges);
          if (edgeFromP && edgeFromP.from && edgeFromP.to) return edgeFromP;
        }
      }
    }
  }

  return null;
}

/**
 * Finds an edge whose rendered SVG path is within `tolerance` pixels of the screen click point.
 * Ensures effortless edge selection even if clicking slightly off the thin line.
 */
export function findEdgeNearPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  availableEdges: EdgeInfo[],
  tolerance: number = 24
): EdgeInfo | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const svgPt = pt.matrixTransform(ctm.inverse());

  const paths = Array.from(
    svg.querySelectorAll<SVGPathElement>('path.tc-edge-path, g.edgePaths path[data-orig-d], g.edgePaths path')
  ).filter(
    (p) => !p.closest('defs') && !p.closest('marker') && p.getAttribute('d') && !p.classList.contains('tc-edge-hitbox')
  );

  let bestEdge: EdgeInfo | null = null;
  let bestDist = tolerance;

  for (const path of paths) {
    try {
      const len = path.getTotalLength();
      if (len <= 0) continue;
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const p = path.getPointAtLength((i / steps) * len);
        const dist = Math.hypot(p.x - svgPt.x, p.y - svgPt.y);
        if (dist < bestDist) {
          const resolved = resolveEdgeFromElement(path, svg, availableEdges);
          if (resolved && resolved.from?.trim() && resolved.to?.trim()) {
            bestDist = dist;
            bestEdge = resolved;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return bestEdge;
}

function enhanceSvgWithPriorityCircles(
  svgString: string,
  selectedStateId?: string | null,
  customStyles?: CustomNodeStylesMap,
  selectedEdgeId?: string | null,
  notes?: DiagramNotes,
  isInteractiveMode?: boolean,
  activeEdgeId?: string | null,
  availableEdgesList?: EdgeInfo[],
  heatmapResult?: ComplexityHeatmapResult | null,
  isHeatmapActive?: boolean,
  heatmapOnlyRefactor?: boolean,
  complexityThreshold: number = 5,
  showComplexityBadges: boolean = true
): string {
  if (typeof window === 'undefined' || !svgString) return svgString;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgEl = doc.documentElement;
    if (!svgEl || svgEl.nodeName.toLowerCase() === 'parsererror') return svgString;

    // 0. Normalize the edge container: Mermaid's Dagre renderer groups edge paths in <g class="edgePaths">,
    // the ELK renderer in <g class="edges edgePath">. Priority badges, node dragging, edge handles and edge
    // hit-testing all look for g.edgePaths, so give ELK's group that class too.
    doc.querySelectorAll('g.edges.edgePath').forEach((g) => {
      if (g.querySelector(':scope > path')) g.classList.add('edgePaths');
    });

    // 1. Mark state nodes with data attributes, clickability, and selection classes
    const nodes = Array.from(doc.querySelectorAll('g.node'));
    for (const node of nodes) {
      const id = node.getAttribute('id') || '';
      let rawId = cleanNodeId(id);
      if (!rawId) {
        const dataId = node.getAttribute('data-id') || node.getAttribute('data-node-id');
        if (dataId) rawId = cleanNodeId(dataId);
      }
      if (!rawId) {
        const labelText = node.querySelector('.nodeLabel')?.textContent?.trim() || node.textContent?.trim();
        if (labelText) rawId = cleanNodeId(labelText);
      }
      if (rawId && rawId !== 'root_start' && rawId !== 'root_end' && rawId !== 'startNode') {
        node.setAttribute('data-state-id', rawId);
        const label =
          node.querySelector('.nodeLabel')?.textContent?.trim() ||
          node.textContent?.trim() ||
          rawId;
        node.setAttribute('data-state-label', label);
        node.classList.add('clickable-state-node');

        // Preserve pristine original Mermaid transform & coordinates
        const origTf = node.getAttribute('transform') || '';
        if (origTf && !node.getAttribute('data-orig-transform')) {
          node.setAttribute('data-orig-transform', origTf);
          const { x, y } = parseTranslation(origTf);
          node.setAttribute('data-orig-x', String(x));
          node.setAttribute('data-orig-y', String(y));
        }

        if (selectedStateId && rawId === selectedStateId) {
          node.classList.add('diagram-selected-node');
        }

        if (notes?.nodes && notes.nodes[rawId]) {
          node.classList.add('has-diagram-note');
          node.setAttribute('title', `Note: ${notes.nodes[rawId]}`);
        }

        // Complexity Heat-map coloring takes precedence when Heat-map mode is active
        const metric =
          heatmapResult?.metrics.get(rawId) ||
          heatmapResult?.metricsList.find((m) => m.stateId.toLowerCase() === rawId.toLowerCase());

        const isExceeded = metric ? metric.score >= complexityThreshold : false;
        const shouldShowBadge = Boolean(
          metric && (
            (showComplexityBadges && isExceeded) ||
            (isHeatmapActive && (!heatmapOnlyRefactor || metric.refactorNeeded))
          )
        );

        if (isHeatmapActive && metric) {
          if (!heatmapOnlyRefactor || metric.refactorNeeded) {
            const shapes = node.querySelectorAll('rect, polygon, circle, path.basic');
            shapes.forEach((shape) => {
              (shape as HTMLElement).style.setProperty('fill', metric.color.fill, 'important');
              (shape as HTMLElement).style.setProperty('stroke', metric.color.stroke, 'important');
              (shape as HTMLElement).style.setProperty('stroke-width', metric.color.strokeWidth, 'important');
            });
            const textEls = node.querySelectorAll('.nodeLabel, span, p, text, div');
            textEls.forEach((txt) => {
              (txt as HTMLElement).style.setProperty('color', metric.color.color, 'important');
              (txt as HTMLElement).style.setProperty('font-weight', '700', 'important');
            });

            node.setAttribute('data-complexity-score', String(metric.score));
            node.setAttribute('data-complexity-level', metric.level);
            node.classList.add('complexity-heatmap-node', `complexity-level-${metric.level}`);
          }
        } else if (customStyles && customStyles[rawId]) {
          // Fallback to custom styles directly on SVG elements
          const st = customStyles[rawId];
          const shapes = node.querySelectorAll('rect, polygon, circle, path.basic');
          shapes.forEach((shape) => {
            if (st.fill) (shape as HTMLElement).style.setProperty('fill', st.fill, 'important');
            if (st.stroke) (shape as HTMLElement).style.setProperty('stroke', st.stroke, 'important');
            if (st.strokeWidth) (shape as HTMLElement).style.setProperty('stroke-width', st.strokeWidth, 'important');
          });
          const textEls = node.querySelectorAll('.nodeLabel, span, p, text, div');
          textEls.forEach((txt) => {
            if (st.color) (txt as HTMLElement).style.setProperty('color', st.color, 'important');
          });
        }

        // If the state exceeds cyclomatic complexity threshold, flag it as needing refactoring
        if (metric && isExceeded) {
          node.classList.add('complexity-refactor-needed');
          node.setAttribute('data-complexity-score', String(metric.score));
          node.setAttribute('data-complexity-exceeded', 'true');
        }

        // Render visual complexity badge on the node if eligible
        if (shouldShowBadge && metric) {
          let anchorX = 60;
          let anchorY = -25;
          let foundAnchor = false;

          const primaryRect = node.querySelector('rect');
          if (primaryRect) {
            const rx = parseFloat(primaryRect.getAttribute('x') || '0');
            const ry = parseFloat(primaryRect.getAttribute('y') || '0');
            const rw = parseFloat(primaryRect.getAttribute('width') || '0');
            if (!isNaN(rw) && rw > 15) {
              anchorX = rx + rw;
              anchorY = ry;
              foundAnchor = true;
            }
          }

          if (!foundAnchor) {
            const primaryPolygon = node.querySelector('polygon');
            if (primaryPolygon) {
              const pointsStr = primaryPolygon.getAttribute('points') || '';
              if (pointsStr) {
                const pts = pointsStr.trim().split(/[\s,]+/).map(parseFloat);
                let maxX = -Infinity;
                let minY = Infinity;
                for (let i = 0; i < pts.length; i += 2) {
                  if (!isNaN(pts[i]) && pts[i] > maxX) maxX = pts[i];
                  if (!isNaN(pts[i + 1]) && pts[i + 1] < minY) minY = pts[i + 1];
                }
                if (maxX !== -Infinity && minY !== Infinity) {
                  anchorX = maxX;
                  anchorY = minY;
                  foundAnchor = true;
                }
              }
            }
          }

          if (!foundAnchor) {
            const primaryCircle = node.querySelector('circle');
            if (primaryCircle) {
              const cx = parseFloat(primaryCircle.getAttribute('cx') || '0');
              const cy = parseFloat(primaryCircle.getAttribute('cy') || '0');
              const r = parseFloat(primaryCircle.getAttribute('r') || '20');
              anchorX = cx + r * 0.707;
              anchorY = cy - r * 0.707;
              foundAnchor = true;
            }
          }

          const badgeG = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
          badgeG.setAttribute('data-state-id', rawId);
          badgeG.setAttribute('data-complexity-score', String(metric.score));

          if (isExceeded) {
            // Prominent visual alert badge for states exceeding cyclomatic complexity threshold
            const isCritical = metric.score >= 8;
            const isHigh = metric.score >= 5;
            const glowClass = isCritical ? 'is-critical' : isHigh ? 'is-high' : 'is-moderate';
            const badgeBg = isCritical
              ? 'rgba(225, 29, 72, 0.96)'
              : isHigh
              ? 'rgba(217, 119, 6, 0.96)'
              : 'rgba(2, 132, 199, 0.96)';
            const badgeBorder = isCritical ? '#fda4af' : isHigh ? '#fde047' : '#7dd3fc';

            badgeG.setAttribute('class', `tc-complexity-badge tc-refactor-flag-badge ${glowClass}`);
            badgeG.setAttribute('transform', `translate(${anchorX - 38}, ${anchorY - 10})`);

            // Tooltip title
            const titleEl = doc.createElementNS('http://www.w3.org/2000/svg', 'title');
            titleEl.textContent = `Cyclomatic Complexity: M=${metric.score} (Exceeds Threshold ${complexityThreshold}) - Potential Refactoring Needed! ${metric.refactorRecommendation || ''}`;
            badgeG.appendChild(titleEl);

            // Badge pill background
            const badgeRect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
            badgeRect.setAttribute('width', '54');
            badgeRect.setAttribute('height', '20');
            badgeRect.setAttribute('rx', '10');
            badgeRect.setAttribute('ry', '10');
            badgeRect.setAttribute('fill', badgeBg);
            badgeRect.setAttribute('stroke', badgeBorder);
            badgeRect.setAttribute('stroke-width', '1.5');
            badgeG.appendChild(badgeRect);

            // Warning triangle icon
            const warnIcon = doc.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            warnIcon.setAttribute('points', '8,14.5 13.5,5.5 19,14.5');
            warnIcon.setAttribute('fill', 'none');
            warnIcon.setAttribute('stroke', '#ffffff');
            warnIcon.setAttribute('stroke-width', '1.2');
            warnIcon.setAttribute('stroke-linejoin', 'round');
            badgeG.appendChild(warnIcon);

            const warnLine = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
            warnLine.setAttribute('x1', '13.5');
            warnLine.setAttribute('y1', '8.5');
            warnLine.setAttribute('x2', '13.5');
            warnLine.setAttribute('y2', '11.5');
            warnLine.setAttribute('stroke', '#ffffff');
            warnLine.setAttribute('stroke-width', '1.2');
            warnLine.setAttribute('stroke-linecap', 'round');
            badgeG.appendChild(warnLine);

            const warnDot = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
            warnDot.setAttribute('cx', '13.5');
            warnDot.setAttribute('cy', '13.2');
            warnDot.setAttribute('r', '0.65');
            warnDot.setAttribute('fill', '#ffffff');
            badgeG.appendChild(warnDot);

            // Monospace Score Text
            const badgeText = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
            badgeText.setAttribute('x', '35');
            badgeText.setAttribute('y', '14');
            badgeText.setAttribute('text-anchor', 'middle');
            badgeText.setAttribute('fill', '#ffffff');
            badgeText.setAttribute('font-size', '10.5px');
            badgeText.setAttribute('font-weight', 'bold');
            badgeText.setAttribute('font-family', 'ui-monospace, monospace');
            badgeText.textContent = `M=${metric.score}`;
            badgeG.appendChild(badgeText);

            wrapBadgeContent(badgeG);
            node.appendChild(badgeG);
          } else {
            // Standard compact pill badge in heatmap mode
            badgeG.setAttribute('class', 'tc-complexity-badge');
            badgeG.setAttribute('transform', `translate(${anchorX - 32}, ${anchorY - 9})`);

            const titleEl = doc.createElementNS('http://www.w3.org/2000/svg', 'title');
            titleEl.textContent = `Cyclomatic Complexity: M=${metric.score} (${metric.levelLabel})`;
            badgeG.appendChild(titleEl);

            const badgeRect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
            badgeRect.setAttribute('width', '42');
            badgeRect.setAttribute('height', '18');
            badgeRect.setAttribute('rx', '9');
            badgeRect.setAttribute('ry', '9');
            badgeRect.setAttribute('fill', metric.color.badgeBg);
            badgeRect.setAttribute('stroke', metric.color.badgeBorder);
            badgeRect.setAttribute('stroke-width', '1.5');
            badgeG.appendChild(badgeRect);

            const badgeText = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
            badgeText.setAttribute('x', '21');
            badgeText.setAttribute('y', '12.5');
            badgeText.setAttribute('text-anchor', 'middle');
            badgeText.setAttribute('fill', '#ffffff');
            badgeText.setAttribute('font-size', '10px');
            badgeText.setAttribute('font-weight', 'bold');
            badgeText.setAttribute('font-family', 'ui-monospace, monospace');
            badgeText.textContent = `M=${metric.score}`;
            badgeG.appendChild(badgeText);

            wrapBadgeContent(badgeG);
            node.appendChild(badgeG);
          }
        }
      }
    }

    // Find all edgePaths groups across root and subgraphs / composite states
    const pGroups = Array.from(doc.querySelectorAll('g.edgePaths'));
    if (pGroups.length === 0) {
      const serializer = new XMLSerializer();
      return serializer.serializeToString(doc);
    }

    let anyBadgeAdded = false;
    // Every rendered link id, used to rank parallel links between the same pair of states
    const allLinkIds = Array.from(doc.querySelectorAll('path[data-id]')).map((p) => p.getAttribute('data-id') || '');

    for (const pGroup of pGroups) {
      const parent = pGroup.parentElement;
      if (!parent) continue;

      // Find matching edgeLabels group within the same cluster container
      const lGroup =
        parent.querySelector(':scope > g.edgeLabels') ||
        Array.from(parent.children).find((c) => c.classList && c.classList.contains('edgeLabels'));

      if (!lGroup) continue;

      const paths = Array.from(pGroup.querySelectorAll('path')).filter(
        (p) => !p.closest('defs') && !p.closest('marker') && p.getAttribute('d')
      );
      const labels = Array.from(lGroup.querySelectorAll('g.edgeLabel'));

      for (let pIdx = 0; pIdx < paths.length; pIdx++) {
        const p = paths[pIdx];
        p.classList.add('tc-edge-path', 'clickable-edge-path');
        p.setAttribute('data-edge', 'true');
        const pId = p.getAttribute('id') || p.getAttribute('data-id') || `path-${pIdx}`;
        p.setAttribute('data-path-id', pId);
      }
      for (let lIdx = 0; lIdx < labels.length; lIdx++) {
        const l = labels[lIdx];
        l.classList.add('clickable-edge-label', 'tc-interactive-edge-label');
        l.setAttribute('data-edge', 'true');
        l.setAttribute('style', 'cursor: pointer !important; pointer-events: all !important;');
        l.setAttribute('title', 'Click to toggle Transition Guard & Condition Inspector');
      }

      if (paths.length === 0 || labels.length === 0) continue;

      // Dedicated priority layer inside this cluster (rendered directly after edgePaths)
      const clusterBadgeLayer = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
      clusterBadgeLayer.setAttribute('class', 'priority-badges-cluster');

      const usedPathIndices = new Set<number>();

      for (let i = 0; i < labels.length; i++) {
        const labelEl = labels[i];
        const text = labelEl.textContent || '';
        const prioInfo = extractPriorityFromText(text);

        // In Mermaid, edges and labels can be linked via data-id (ELK / Flowchart-v2) or 1-to-1 index (Dagre)
        let pathEl: Element | null = null;

        // 1. Check data-id attribute (Flowchart-v2 / ELK provides matching data-id on path and label)
        const labelDataId =
          labelEl.getAttribute('data-id') ||
          labelEl.querySelector('[data-id]')?.getAttribute('data-id');
        if (labelDataId) {
          const match = paths.find(
            (p) => p.getAttribute('data-id') === labelDataId && !usedPathIndices.has(paths.indexOf(p))
          );
          if (match) {
            pathEl = match;
            usedPathIndices.add(paths.indexOf(match));
          }
        }

        // 2. 1-to-1 index matching (Standard Dagre behavior where edgePaths and edgeLabels have identical counts)
        if (!pathEl && i < paths.length && !usedPathIndices.has(i)) {
          pathEl = paths[i];
          usedPathIndices.add(i);
        }

        // 3. Proximity fallback: find the closest path whose spline points pass near the label
        if (!pathEl) {
          const labelPos = getLabelPos(labelEl);
          if (labelPos) {
            let bestDist = Infinity;
            let bestIdx = -1;
            for (let pIdx = 0; pIdx < paths.length; pIdx++) {
              if (usedPathIndices.has(pIdx)) continue;
              const pData = parsePathData(paths[pIdx]);
              if (!pData) continue;
              const dist = minDistanceToPath(labelPos, pData.allPoints);
              if (dist < bestDist) {
                bestDist = dist;
                bestIdx = pIdx;
              }
            }
            if (bestIdx >= 0 && bestDist < 150) {
              pathEl = paths[bestIdx];
              usedPathIndices.add(bestIdx);
            }
          }
        }

        // 4. Fallback: search for first unused path in this cluster
        if (!pathEl) {
          for (let pIdx = 0; pIdx < paths.length; pIdx++) {
            if (!usedPathIndices.has(pIdx)) {
              pathEl = paths[pIdx];
              usedPathIndices.add(pIdx);
              break;
            }
          }
        }

        let matchedEdge: EdgeInfo | null = null;
        if (availableEdgesList && availableEdgesList.length > 0) {
          const directId = labelEl.getAttribute('data-edge-id');
          if (directId) {
            matchedEdge = availableEdgesList.find((e) => e.id === directId || e.pathId === directId) || null;
          }

          // Structural match on Mermaid's link id (exact); guard-text matching below is only a fallback,
          // since many transitions share guard text (e.g. "else" branches or common interlocks)
          if (!matchedEdge) {
            const linkId = labelDataId || pathEl?.getAttribute('data-id') || '';
            const byLinkId = linkId ? matchEdgesByLinkId(linkId, availableEdgesList, allLinkIds) : [];
            if (byLinkId.length === 1) {
              matchedEdge = byLinkId[0];
            } else if (byLinkId.length > 1) {
              matchedEdge = byLinkId.find((e) => prioInfo && e.priority === prioInfo.priority) || byLinkId[0];
            } else if (linkId) {
              matchedEdge = matchStateDiagramEdge(linkId, availableEdgesList, text, prioInfo?.priority);
            }
          }

          if (!matchedEdge) {
            const cleanText = text
              .replace(/📝.*$/, '')
              .replace(/▾/g, '')
              .replace(/\.\.\./g, '')
              .replace(/\(\+\d+\)/g, '')
              .replace(/^[①-⑳㉑-㉟㊱-㊿]\s*/, '')
              .replace(/^\(\d+\)\s*/, '')
              .replace(/^\[\d+\]\s*/, '')
              .trim();
            if (cleanText) {
              matchedEdge =
                availableEdgesList.find((e) => {
                  const fullCand = (e.condition || e.label || '').trim();
                  if (!fullCand) return false;
                  const eClean = fullCand
                    .replace(/📝.*$/, '')
                    .replace(/^[①-⑳㉑-㉟㊱-㊿]\s*/, '')
                    .replace(/^\(\d+\)\s*/, '')
                    .replace(/^\[\d+\]\s*/, '')
                    .trim();
                  return (
                    cleanText === eClean ||
                    cleanText.includes(eClean) ||
                    eClean.includes(cleanText) ||
                    (cleanText.length >= 4 &&
                      eClean.toLowerCase().startsWith(cleanText.slice(0, Math.min(cleanText.length, 12)).toLowerCase()))
                  );
                }) || null;
            }
          }

          if (!matchedEdge && prioInfo) {
            const prioMatches = availableEdgesList.filter((e) => e.priority === prioInfo.priority);
            if (prioMatches.length === 1) {
              matchedEdge = prioMatches[0];
            }
          }

          if (!matchedEdge && i < availableEdgesList.length) {
            matchedEdge = availableEdgesList[i];
          }
        }

        if (pathEl) {
          const pId = pathEl.getAttribute('id') || pathEl.getAttribute('data-id') || `path-${paths.indexOf(pathEl as SVGPathElement)}`;
          labelEl.setAttribute('data-linked-path-id', pId);
          if (activeEdgeId && (pId === activeEdgeId || labelEl.getAttribute('data-edge-id') === activeEdgeId || matchedEdge?.id === activeEdgeId)) {
            labelEl.classList.add('tc-interactive-edge-label-active');
          }
        }

        if (matchedEdge) {
          labelEl.setAttribute('data-edge-id', matchedEdge.id);
          labelEl.setAttribute('data-from', matchedEdge.from);
          labelEl.setAttribute('data-to', matchedEdge.to);
          if (matchedEdge.condition || matchedEdge.label) {
            labelEl.setAttribute('data-condition', matchedEdge.condition || matchedEdge.label || '');
          }
          if (matchedEdge.priority !== undefined || prioInfo?.priority) {
            labelEl.setAttribute('data-priority', String(matchedEdge.priority ?? prioInfo?.priority));
          }
          if (pathEl) {
            pathEl.setAttribute('data-edge-id', matchedEdge.id);
            pathEl.setAttribute('data-from', matchedEdge.from);
            pathEl.setAttribute('data-to', matchedEdge.to);
            if (matchedEdge.condition || matchedEdge.label) {
              pathEl.setAttribute('data-condition', matchedEdge.condition || matchedEdge.label || '');
            }
          }
        }

        if (!prioInfo || !pathEl) continue;

        const parsed = parsePathData(pathEl);
        if (!parsed) continue;

        // Position badge 20px from edge start endpoint along direction vector to ensure clean clearance from state border
        const offset = 20;
        const cx = parsed.startX + parsed.dirX * offset;
        const cy = parsed.startY + parsed.dirY * offset;

        // TwinCAT XAE UML Statechart style circular badge
        const badgeG = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
        badgeG.setAttribute('class', 'priority-badge tc-priority-badge');
        const pathDataId = pathEl.getAttribute('id') || pathEl.getAttribute('data-id') || `path-${paths.indexOf(pathEl as SVGPathElement)}`;
        badgeG.setAttribute('data-path-id', pathDataId);
        if (!pathEl.getAttribute('data-path-id')) {
          pathEl.setAttribute('data-path-id', pathDataId);
        }
        if (matchedEdge) {
          badgeG.setAttribute('data-edge-id', matchedEdge.id);
          badgeG.setAttribute('data-from', matchedEdge.from);
          badgeG.setAttribute('data-to', matchedEdge.to);
          if (matchedEdge.condition || matchedEdge.label) {
            badgeG.setAttribute('data-condition', matchedEdge.condition || matchedEdge.label || '');
          }
          badgeG.setAttribute('data-priority', String(matchedEdge.priority ?? prioInfo.priority));
        } else {
          badgeG.setAttribute('data-priority', String(prioInfo.priority));
        }
        badgeG.setAttribute('style', 'cursor: pointer !important; pointer-events: all !important;');
        badgeG.setAttribute('title', 'Click to toggle Transition Guard & Condition Inspector');

        if (activeEdgeId && (activeEdgeId === matchedEdge?.id || activeEdgeId === pathDataId)) {
          badgeG.classList.add('tc-priority-badge-active');
        }

        const circle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', cx.toFixed(1));
        circle.setAttribute('cy', cy.toFixed(1));
        circle.setAttribute('r', '8.5');
        circle.setAttribute('fill', '#ffffff');
        circle.setAttribute('stroke', '#0f172a');
        circle.setAttribute('stroke-width', '1.5');
        circle.setAttribute('filter', 'drop-shadow(0px 1px 2px rgba(0,0,0,0.35))');
        circle.setAttribute('style', 'cursor: pointer !important; pointer-events: all !important;');

        const textEl = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
        textEl.setAttribute('x', cx.toFixed(1));
        textEl.setAttribute('y', cy.toFixed(1));
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('dominant-baseline', 'central');
        textEl.setAttribute('font-family', 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif');
        textEl.setAttribute('font-size', prioInfo.priority >= 10 ? '9' : '10.5');
        textEl.setAttribute('font-weight', '700');
        textEl.setAttribute('fill', '#0f172a');
        textEl.setAttribute('style', 'cursor: pointer !important; pointer-events: all !important;');
        textEl.textContent = String(prioInfo.priority);

        badgeG.appendChild(circle);
        badgeG.appendChild(textEl);
        clusterBadgeLayer.appendChild(badgeG);
        anyBadgeAdded = true;

        // Clean priority symbol from label text
        cleanSymbolFromLabel(labelEl, prioInfo.symbol);
      }

      if (clusterBadgeLayer.childNodes.length > 0) {
        // Append as last child of parent container so badges render on top of nodes and edges in SVG painter's model
        parent.appendChild(clusterBadgeLayer);
      }
    }

    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
  } catch (err) {
    console.warn('Failed to enhance SVG with priority circles:', err);
    return svgString;
  }
}

/** Shown in a docked tool window while the diagram has not rendered yet */
const DockedPanelPlaceholder: React.FC<{ label: string }> = ({ label }) => (
  <div
    // Portaled into a dock panel, but React events still bubble to the canvas pan handlers
    onMouseDown={(e) => e.stopPropagation()}
    onWheel={(e) => e.stopPropagation()}
    className="flex-1 flex items-center justify-center p-4 text-center text-xs text-slate-500 bg-slate-900"
  >
    {label} is available once the diagram has rendered.
  </div>
);

export const MermaidViewer = forwardRef<MermaidViewerHandle, MermaidViewerProps>((props, ref) => {
  const {
    code,
    layoutEngine = 'elk',
    flowchartCurve = 'basis',
    mermaidTheme = 'dark',
    exportSettings,
    searchQuery: externalSearchQuery,
    onSearchQueryChange,
    selectedStateId: externalSelectedStateId,
    selectedStateLabel: externalSelectedStateLabel,
    onSelectState: onSelectStateProp,
    customStyles: externalCustomStyles,
    customEdgeStyles,
    onEdgeStyleChange,
    onShowInXae,
    problemMarkers,
    liveHighlight,
    openGuardOnSelect = false,
    pathHighlight,
    diffHighlight,
    liveGuards,
    contextMenuItems,
    connectFrom = null,
    onConnectTo,
    onConnectCancel,
    onStyleChange: onStyleChangeProp,
    onResetStateStyle: onResetStateStyleProp,
    onClearAllCustomStyles: onClearAllCustomStylesProp,
    nodeOffsets: externalNodeOffsets,
    onNodeOffsetsChange,
    notes,
    onSaveNote,
    onDeleteNote,
    onClearAllNotes,
    onUpdateNotePosition: onUpdateNotePositionProp,
    onUpdateNoteStyle,
    onCanvasPositionsChange,
    onOpenMermaidLive,
    fileName = 'statechart',
    interactiveMode: externalInteractiveMode,
    onInteractiveModeChange,
    tcPouContent,
    tcPouFileName,
    tcDutContent,
    tcDutFileName,
    onSaveDutContent,
    onOpenEnumEditor: onOpenEnumEditorProp,
    onOpenMethodEditor: onOpenMethodEditorProp,
    onSaveMethodCode,
    onSaveStateCode,
    onSavePreProcessCode,
    focusStateRequest,
    priorityFormat = 'circled',
    layoutLocked: externalLayoutLocked,
    onLayoutLockedChange: onLayoutLockedChangeProp,
    onToast: onToastProp,
    toolbarPortalTarget,
    onSwitchToDiagramTab,
    dockedPanels,
    onOpenInspectorPanel,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const codeMenuRef = useRef<HTMLDivElement>(null);
  const codeButtonRef = useRef<HTMLButtonElement>(null);
  const [codeMenuCoords, setCodeMenuCoords] = useState<{ top: number; left: number }>({ top: 80, left: 100 });
  const [isCodeMenuOpen, setIsCodeMenuOpen] = useState<boolean>(false);

  const updateCodeMenuPosition = useCallback(() => {
    if (!codeButtonRef.current) return;
    const rect = codeButtonRef.current.getBoundingClientRect();
    const menuWidth = 224; // 14rem = 224px
    let left = rect.left;
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    if (left < 8) left = 8;
    setCodeMenuCoords({
      top: rect.bottom + 6,
      left: Math.round(left),
    });
  }, []);
  const [svgContent, setSvgContent] = useState<string>('');
  const [layoutTrigger, setLayoutTrigger] = useState<number>(0);
  const [isAutoAligning, setIsAutoAligning] = useState<boolean>(false);
  const autoAlignInProgressRef = useRef<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const mouseDownPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [copiedSvg, setCopiedSvg] = useState<boolean>(false);
  const [isMethodModalOpen, setIsMethodModalOpen] = useState<boolean>(false);
  const [methodModalInitialMethod, setMethodModalInitialMethod] = useState<string>('doState()');
  const [isEnumModalOpen, setIsEnumModalOpen] = useState<boolean>(false);
  const [enumModalInitialMember, setEnumModalInitialMember] = useState<string | undefined>(undefined);
  // Canvas tool windows: floating overlays, or RightPanel tabs when docked
  const [isMinimapOpen, setIsMinimapOpen] = useCanvasPanelOpenState('minimap', true, dockedPanels);
  const [isLegendOpen, setIsLegendOpen] = useCanvasPanelOpenState('legend', false, dockedPanels);
  const [isStatsOpen, setIsStatsOpen] = useCanvasPanelOpenState('stats', false, dockedPanels);
  const [isSearchPanelOpen, setIsSearchPanelOpen] = useCanvasPanelOpenState('search', true, dockedPanels);
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);
  const [canvasNodePositions, setCanvasNodePositions] = useState<CanvasNodePositionsMap>({});

  const handleOpenMethodEditor = useCallback((methodName: string = 'doState()') => {
    if (onOpenMethodEditorProp) {
      onOpenMethodEditorProp(methodName);
    } else {
      setMethodModalInitialMethod(methodName);
      setIsMethodModalOpen(true);
    }
  }, [onOpenMethodEditorProp]);

  const handleOpenEnumEditor = useCallback((memberName?: string) => {
    if (onOpenEnumEditorProp) {
      onOpenEnumEditorProp(memberName);
    } else {
      setEnumModalInitialMember(memberName);
      setIsEnumModalOpen(true);
    }
  }, [onOpenEnumEditorProp]);

  // Snap to Grid & Smart Alignment Guides State
  const [snapConfig, setSnapConfig] = useState<SnapConfig>({
    enabled: true,
    gridSize: 20,
    snapToNodes: true,
    tolerance: 8,
  });
  const [activeSnapResult, setActiveSnapResult] = useState<SnapResult | null>(null);
  const [showSnapToast, setShowSnapToast] = useState<{ message: string; timestamp: number } | null>(null);
  const [isSnapMenuOpen, setIsSnapMenuOpen] = useState<boolean>(false);
  const nodeInitialCenterRef = useRef<{
    x: number;
    y: number;
    origCenterX: number;
    origCenterY: number;
  } | null>(null);

  // Interactive Mode & Transition Condition Detail Overlay
  const [internalInteractiveMode, setInternalInteractiveMode] = useState<boolean>(true);
  const isInteractiveMode = externalInteractiveMode !== undefined ? externalInteractiveMode : internalInteractiveMode;
  const setIsInteractiveMode = (valOrFn: boolean | ((prev: boolean) => boolean)) => {
    const nextVal = typeof valOrFn === 'function' ? valOrFn(isInteractiveMode) : valOrFn;
    if (onInteractiveModeChange) {
      onInteractiveModeChange(nextVal);
    } else {
      setInternalInteractiveMode(nextVal);
    }
  };

  const [isCompactLabels, setIsCompactLabels] = useState<boolean>(true);
  const [activeConditionOverlay, setActiveConditionOverlay] = useState<{
    edge: EdgeInfo;
    anchorPos: { x: number; y: number };
  } | null>(null);

  const pendingLabelBadgeClickRef = useRef<{
    el: HTMLElement | SVGElement;
    clientX: number;
    clientY: number;
  } | null>(null);
  const lastOverlayToggleTimeRef = useRef<number>(0);

  const [canvasTransition, setCanvasTransition] = useState<string>('none');
  const [renderedSvg, setRenderedSvg] = useState<SVGSVGElement | null>(null);

  const getDiagramSvg = useCallback((): SVGSVGElement | null => {
    if (!containerRef.current) return null;
    return (
      (containerRef.current.querySelector('#mermaid-diagram-svg-container svg') as SVGSVGElement | null) ||
      (containerRef.current.querySelector('svg:not(#diagram-snap-grid-svg):not([id*="snap-grid"])') as SVGSVGElement | null) ||
      (renderedSvg && renderedSvg.id !== 'diagram-snap-grid-svg' ? renderedSvg : null)
    );
  }, [renderedSvg]);

  // Whether the pressed edge was already selected before this press (the press itself selects it)
  const edgeSelectedBeforePressRef = useRef<boolean>(false);
  // True when this press started on an edge (and therefore already selected it)
  const edgePressedRef = useRef<boolean>(false);
  // Set when mouse-up handled an edge click, so the click event of the same gesture is ignored
  const edgeClickHandledRef = useRef<boolean>(false);

  /**
   * Edge click: the first click selects and highlights the transition; clicking the already selected
   * transition again opens (or closes) the Transition Guard & Condition Inspector.
   */
  const activateEdgeClick = (edge: EdgeInfo, anchor: { x: number; y: number }, wasSelected: boolean) => {
    setSelectedEdge(edge);
    if (wasSelected || openGuardOnSelect) {
      toggleConditionOverlay(edge, anchor);
    } else {
      // Selecting a different transition closes an inspector that belongs to another one
      setActiveConditionOverlay((prev) => (prev && prev.edge.id !== edge.id ? null : prev));
    }
  };

  const toggleConditionOverlay = (edge: EdgeInfo, anchorPos?: { x: number; y: number }) => {
    const now = Date.now();
    if (now - lastOverlayToggleTimeRef.current < 300) {
      return;
    }
    lastOverlayToggleTimeRef.current = now;

    setActiveConditionOverlay((prev) => {
      // Same transition only: parallel transitions share from / to
      if (prev && prev.edge.id === edge.id) {
        return null;
      }
      let finalAnchor = anchorPos;
      if (!finalAnchor && containerRef.current) {
        const svg = getDiagramSvg();
        if (svg) {
          const el = svg.querySelector(
            `g.edgeLabel[data-edge-id="${edge.id}"], .tc-priority-badge[data-edge-id="${edge.id}"], path[data-edge-id="${edge.id}"]`
          );
          if (el) {
            const r = el.getBoundingClientRect();
            finalAnchor = { x: r.left + r.width / 2, y: r.top };
          }
        }
      }
      if (!finalAnchor && containerRef.current) {
        const cRect = containerRef.current.getBoundingClientRect();
        finalAnchor = { x: cRect.left + cRect.width / 2, y: cRect.top + 100 };
      }
      return {
        edge,
        anchorPos: finalAnchor || { x: 200, y: 150 },
      };
    });
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const svg = getDiagramSvg();
    if (!svg) return;

    svg.querySelectorAll('.tc-priority-badge-active').forEach((el) => {
      el.classList.remove('tc-priority-badge-active');
    });
    svg.querySelectorAll('.tc-interactive-edge-label-active').forEach((el) => {
      el.classList.remove('tc-interactive-edge-label-active');
    });

    if (activeConditionOverlay) {
      const edge = activeConditionOverlay.edge;
      const targetEdgeId = edge.id;
      const targetPathId = edge.pathId;
      const selectors = [
        targetEdgeId ? `[data-edge-id="${targetEdgeId}"]` : '',
        targetPathId ? `[data-path-id="${targetPathId}"]` : '',
        targetPathId ? `[data-linked-path-id="${targetPathId}"]` : '',
        edge.from && edge.to ? `[data-from="${edge.from}"][data-to="${edge.to}"]` : '',
      ]
        .filter(Boolean)
        .join(', ');

      if (selectors) {
        svg.querySelectorAll(selectors).forEach((el) => {
          if (el.classList.contains('tc-priority-badge') || el.classList.contains('priority-badge')) {
            el.classList.add('tc-priority-badge-active');
          }
          if (el.classList.contains('clickable-edge-label') || el.classList.contains('edgeLabel')) {
            el.classList.add('tc-interactive-edge-label-active');
          }
        });
      }
    }
  }, [activeConditionOverlay, getDiagramSvg]);

  // High-Resolution Export States
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [exportModalDefaultFormat, setExportModalDefaultFormat] = useState<ExportFormat>('png');
  const [exportingNotification, setExportingNotification] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        codeButtonRef.current &&
        !codeButtonRef.current.contains(target) &&
        codeMenuRef.current &&
        !codeMenuRef.current.contains(target)
      ) {
        setIsCodeMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isCodeMenuOpen) {
        setIsCodeMenuOpen(false);
      }
    };
    const handleReposition = () => {
      if (isCodeMenuOpen) {
        updateCodeMenuPosition();
      }
    };

    if (isCodeMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('resize', handleReposition);
      window.addEventListener('scroll', handleReposition, true);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isCodeMenuOpen, updateCodeMenuPosition]);

  // Notes & Edge Selection State
  const [selectedEdge, setSelectedEdge] = useState<EdgeInfo | null>(null);
  const [contextMenuState, setContextMenuState] = useState<{
    x: number;
    y: number;
    target: ContextMenuTarget;
  } | null>(null);
  const [isNoteDialogOpen, setIsNoteDialogOpen] = useState<boolean>(false);
  const [activeNoteTarget, setActiveNoteTarget] = useState<ContextMenuTarget | null>(null);
  const [isNotesDrawerOpen, setIsNotesDrawerOpen] = useCanvasPanelOpenState('notes', false, dockedPanels);

  useEffect(() => {
    if (!containerRef.current || !svgContent) {
      setRenderedSvg(null);
      return;
    }
    const svg = (containerRef.current.querySelector('#mermaid-diagram-svg-container svg') ||
      containerRef.current.querySelector('svg:not(#diagram-snap-grid-svg):not([id*="snap-grid"])') ||
      containerRef.current.querySelector('svg')) as SVGSVGElement | null;
    setRenderedSvg(svg);
  }, [svgContent]);

  const effectiveNotes: DiagramNotes = useMemo(() => {
    return notes || { nodes: {}, edges: {} };
  }, [notes]);

  // The rendered diagram only depends on note texts (note markers / edge note flags). Positions and styles are
  // drawn by the note overlay layer, so moving or restyling a note must not re-render (and re-layout) the diagram.
  const noteTextsKey = JSON.stringify([effectiveNotes.nodes || {}, effectiveNotes.edges || {}]);
  const notesForDiagram: DiagramNotes = useMemo(
    () => ({ nodes: effectiveNotes.nodes || {}, edges: effectiveNotes.edges || {} }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noteTextsKey]
  );

  const availableEdges = useMemo(() => {
    return extractEdgesFromMermaid(code, notesForDiagram);
  }, [code, notesForDiagram]);

  const totalNotesCount = useMemo(() => {
    return countTotalNotes(effectiveNotes);
  }, [effectiveNotes]);

  // Manual Node Dragging & Offsets state
  const [internalNodeOffsets, setInternalNodeOffsets] = useState<NodeOffsetsMap>({});
  const effectiveNodeOffsets = externalNodeOffsets !== undefined ? externalNodeOffsets : internalNodeOffsets;
  const currentNodeOffsetsRef = useRef<NodeOffsetsMap>({});

  useEffect(() => {
    currentNodeOffsetsRef.current = { ...effectiveNodeOffsets };
  }, [effectiveNodeOffsets]);

  const setNodeOffsets = (updater: NodeOffsetsMap | ((prev: NodeOffsetsMap) => NodeOffsetsMap)) => {
    const nextOffsets = typeof updater === 'function' ? updater(effectiveNodeOffsets) : updater;
    currentNodeOffsetsRef.current = nextOffsets;
    if (onNodeOffsetsChange) {
      onNodeOffsetsChange(nextOffsets);
    } else {
      setInternalNodeOffsets(nextOffsets);
    }
  };

  const [isNodeDragging, setIsNodeDragging] = useState<boolean>(false);
  const isDraggingNodeRef = useRef<boolean>(false);
  const draggedNodeIdRef = useRef<string | null>(null);
  const draggedNodeElRef = useRef<SVGGElement | null>(null);
  const nodeDragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Screen px per SVG unit, captured when a node / edge-handle drag starts
  const dragUnitScaleRef = useRef<{ x: number; y: number }>({ x: 1, y: 1 });
  // Node drags are applied once per animation frame with the latest pointer position
  const pendingNodeDragPointRef = useRef<{ x: number; y: number } | null>(null);
  const nodeDragFrameRef = useRef<number | null>(null);
  const applyNodeDragFrameRef = useRef<(() => void) | null>(null);
  const nodeInitialOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const nodeMovedRef = useRef<boolean>(false);
  // State Style window: a second click on the selected state opens it beside the node
  const [stylePopup, setStylePopup] = useState<{
    stateId: string;
    anchorRect?: { left: number; right: number; top: number };
  } | null>(null);
  const nodeSelectedBeforePressRef = useRef<boolean>(false);

  // Edge Offsets & Endpoint Dragging State
  const [edgeOffsets, setEdgeOffsets] = useState<EdgeOffsetsMap>({});
  const currentEdgeOffsetsRef = useRef<EdgeOffsetsMap>({});
  useEffect(() => {
    currentEdgeOffsetsRef.current = { ...edgeOffsets };
  }, [edgeOffsets]);

  const isDraggingEdgeHandleRef = useRef<boolean>(false);
  const draggedEdgeIdRef = useRef<string | null>(null);
  const draggedHandleTypeRef = useRef<'start' | 'end' | 'mid' | 'label' | null>(null);
  const edgeHandleDragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const edgeInitialOffsetRef = useRef<EdgeOffset>({ x: 0, y: 0 });
  // Label drag: only the label element moves (once per frame); the full re-apply runs on release
  const draggedLabelRef = useRef<{ el: SVGGElement; x: number; y: number } | null>(null);
  const labelDragFrameRef = useRef<number | null>(null);
  // Line / handle drags: applied once per animation frame with the latest offset, re-routing only that edge
  const edgeDragFrameRef = useRef<number | null>(null);
  const applyEdgeDragFrameRef = useRef<(() => void) | null>(null);
  const flushLabelDrag = () => {
    if (labelDragFrameRef.current !== null) {
      cancelAnimationFrame(labelDragFrameRef.current);
      labelDragFrameRef.current = null;
    }
    const dragged = draggedLabelRef.current;
    draggedLabelRef.current = null;
    // Put the label exactly where it was released (the committed offset re-applies the same spot)
    const offset = dragged && draggedEdgeIdRef.current ? currentEdgeOffsetsRef.current[draggedEdgeIdRef.current] : null;
    if (dragged && offset && edgeMovedRef.current) {
      const initial = edgeInitialOffsetRef.current;
      dragged.el.setAttribute(
        'transform',
        `translate(${dragged.x + (offset.labelDx || 0) - (initial.labelDx || 0)}, ${dragged.y + (offset.labelDy || 0) - (initial.labelDy || 0)})`
      );
    }
  };
  const edgeMovedRef = useRef<boolean>(false);

  // State selection and inspector
  const [internalSelectedStateId, setInternalSelectedStateId] = useState<string | null>(null);
  const [internalSelectedStateLabel, setInternalSelectedStateLabel] = useState<string>('');
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);

  const effectiveSelectedStateId =
    externalSelectedStateId !== undefined ? externalSelectedStateId : internalSelectedStateId;
  const effectiveSelectedStateLabel =
    externalSelectedStateLabel !== undefined ? externalSelectedStateLabel : internalSelectedStateLabel;

  // Lock Diagram Layout state: disables automatic re-layout triggered by edits, preserving custom node positions
  const [internalLayoutLocked, setInternalLayoutLocked] = useState<boolean>(false);
  const isLayoutLocked = externalLayoutLocked !== undefined ? externalLayoutLocked : internalLayoutLocked;
  const setEffectiveLayoutLocked = useCallback(
    (valOrFn: boolean | ((prev: boolean) => boolean)) => {
      const nextVal = typeof valOrFn === 'function' ? valOrFn(isLayoutLocked) : valOrFn;
      if (onLayoutLockedChangeProp) {
        onLayoutLockedChangeProp(nextVal);
      } else {
        setInternalLayoutLocked(nextVal);
      }
    },
    [isLayoutLocked, onLayoutLockedChangeProp]
  );

  // Toast notification for layout locking
  const [layoutLockToast, setLayoutLockToast] = useState<{ message: string; locked: boolean; timestamp: number } | null>(null);

  useEffect(() => {
    if (!layoutLockToast) return;
    const timer = setTimeout(() => {
      setLayoutLockToast(null);
    }, 2500);
    return () => clearTimeout(timer);
  }, [layoutLockToast]);

  // Pinned/locked canvas positions for all states (stateId -> { centerX, centerY })
  const lockedNodePositionsRef = useRef<Record<string, { centerX: number; centerY: number }>>({});

  const handleToggleLayoutLocked = useCallback(() => {
    setEffectiveLayoutLocked((prev) => {
      const next = !prev;
      if (next) {
        if (containerRef.current) {
          const svg = getDiagramSvg();
          if (svg) {
            const currentPos = extractCanvasNodePositions(svg, effectiveNodeOffsets);
            const snapshot: Record<string, { centerX: number; centerY: number }> = {};
            for (const [sId, p] of Object.entries(currentPos)) {
              snapshot[sId] = { centerX: p.centerX, centerY: p.centerY };
            }
            lockedNodePositionsRef.current = snapshot;
          }
        }
        setLayoutLockToast({
          message: 'Diagram Layout Locked: Custom node positions will be maintained on code edits.',
          locked: true,
          timestamp: Date.now(),
        });
      } else {
        setLayoutLockToast({
          message: 'Diagram Layout Unlocked: Automatic re-layout re-enabled.',
          locked: false,
          timestamp: Date.now(),
        });
      }
      return next;
    });
  }, [effectiveNodeOffsets, setEffectiveLayoutLocked, getDiagramSvg]);

  useEffect(() => {
    if (externalLayoutLocked) {
      if (containerRef.current) {
        const svg = getDiagramSvg();
        if (svg) {
          const currentPos = extractCanvasNodePositions(svg, effectiveNodeOffsets);
          const snapshot: Record<string, { centerX: number; centerY: number }> = {};
          for (const [sId, p] of Object.entries(currentPos)) {
            snapshot[sId] = { centerX: p.centerX, centerY: p.centerY };
          }
          lockedNodePositionsRef.current = snapshot;
        }
      }
    }
  }, [externalLayoutLocked, effectiveNodeOffsets]);

  // Custom node styles (fallback to local if not controlled)
  const [internalCustomStyles, setInternalCustomStyles] = useState<CustomNodeStylesMap>({});
  const effectiveCustomStyles = externalCustomStyles !== undefined ? externalCustomStyles : internalCustomStyles;

  // Available states from Mermaid code
  const availableStates = useMemo(() => {
    return extractStateNodesFromMermaid(code);
  }, [code]);

  // Auto-Align: triggers a re-run of the layout engine to organize all nodes according to the current flowchart or stateDiagram-v2 logic, while respecting the locked layout state
  const handleAutoAlign = useCallback(() => {
    autoAlignInProgressRef.current = true;
    setIsAutoAligning(true);

    // 1. Clear any active manual node and edge drag offsets
    currentNodeOffsetsRef.current = {};
    currentEdgeOffsetsRef.current = {};
    setNodeOffsets({});
    setEdgeOffsets({});

    // 2. Clear locked positions snapshot so the layout engine positions won't be overridden by previous drag offsets
    lockedNodePositionsRef.current = {};

    // 3. Reset SVG diagram offsets in current DOM if rendered
    if (containerRef.current) {
      const svg = getDiagramSvg();
      if (svg) {
        resetSvgDiagramOffsets(svg);
      }
    }

    // 4. Trigger re-run of layout engine in mermaid
    setLayoutTrigger((prev) => prev + 1);

    // 5. Toast notification respecting locked state
    const statesCount = availableStates.length;
    setLayoutLockToast({
      message: isLayoutLocked
        ? `Diagram Auto-Aligned (${statesCount} states organized, layout remains locked)`
        : `Diagram Auto-Aligned (${statesCount} states organized by ${layoutEngine.toUpperCase()} engine)`,
      locked: isLayoutLocked,
      timestamp: Date.now(),
    });

    // Safety fallback timer to clear spinner if svg render is instantaneous
    setTimeout(() => {
      setIsAutoAligning(false);
      autoAlignInProgressRef.current = false;
    }, 1200);
  }, [getDiagramSvg, isLayoutLocked, layoutEngine, availableStates.length]);

  // Complexity Heat-Map & Refactoring State & Calculation
  const [isHeatmapActive, setIsHeatmapActive] = useState<boolean>(false);
  const [isHeatmapPanelOpen, setIsHeatmapPanelOpen] = useCanvasPanelOpenState('heatmap', false, dockedPanels);
  const [heatmapPalette, setHeatmapPalette] = useState<HeatmapPalette>('traffic');
  const [heatmapOnlyRefactor, setHeatmapOnlyRefactor] = useState<boolean>(false);
  const [complexityThreshold, setComplexityThreshold] = useState<number>(5);
  const [showComplexityBadges, setShowComplexityBadges] = useState<boolean>(true);
  const [hoveredComplexityMetric, setHoveredComplexityMetric] = useState<{
    metric: StateComplexityMetric;
    anchorX: number;
    anchorY: number;
  } | null>(null);

  // Edge label hover Visual Badge state showing full untruncated Guard Condition Expression
  const [hoveredEdgeCondition, setHoveredEdgeCondition] = useState<{
    edge: EdgeInfo;
    fullCondition: string;
    anchorX: number;
    anchorY: number;
    labelRect?: DOMRect;
    priority?: number;
    clauses?: string[];
    hasCompound: boolean;
  } | null>(null);

  const complexityHeatmapResult = useMemo<ComplexityHeatmapResult>(() => {
    return calculateStateComplexityHeatmap(
      availableStates,
      availableEdges,
      tcPouContent,
      heatmapPalette,
      complexityThreshold
    );
  }, [availableStates, availableEdges, tcPouContent, heatmapPalette, complexityThreshold]);

  // Search state
  const [internalSearchQuery, setInternalSearchQuery] = useState<string>('');
  const effectiveSearchQuery = externalSearchQuery !== undefined ? externalSearchQuery : internalSearchQuery;
  const [matches, setMatches] = useState<SearchMatchItem[]>([]);
  const [activeMatchIndex, setActiveMatchIndex] = useState<number>(0);
  const [matchesBreakdown, setMatchesBreakdown] = useState<{ states: number; transitions: number }>({
    states: 0,
    transitions: 0,
  });

  // State jump animation, smooth scroll-to and auto-centering refs
  const jumpAttemptTimerRef = useRef<number | null>(null);
  const jumpHighlightTimerRef = useRef<NodeJS.Timeout | null>(null);
  const jumpTransitionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const jumpHighlightedNodeRef = useRef<SVGElement | null>(null);
  const jumpSavedInlineStylesRef = useRef<Array<{
    el: SVGElement;
    fill?: string;
    stroke?: string;
    strokeWidth?: string;
    fillPriority?: string;
    strokePriority?: string;
    attrFill?: string | null;
    attrStroke?: string | null;
    attrStrokeWidth?: string | null;
  }> | null>(null);
  const lastPanStateIdRef = useRef<{ id: string; timestamp: number } | null>(null);
  const lastHandledFocusRequestTimestampRef = useRef<number | null>(null);

  // Smooth scroll-to animation for canvas pan, ensuring node is centered in viewport
  const activePanAnimationRef = useRef<number | null>(null);
  const currentPanRef = useRef<{ x: number; y: number }>({ x: pan.x, y: pan.y });
  // Latest zoom for wheel handling (several wheel events can arrive before a re-render)
  const wheelZoomRef = useRef<number>(zoom);
  wheelZoomRef.current = zoom;
  const zoomRef = useRef<number>(zoom);
  const lastPanRequestRef = useRef<{ target: Element | string; time: number } | null>(null);

  useEffect(() => {
    currentPanRef.current = pan;
  }, [pan]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    return () => {
      if (activePanAnimationRef.current) {
        cancelAnimationFrame(activePanAnimationRef.current);
        activePanAnimationRef.current = null;
      }
    };
  }, []);

  // Glowing radiant border highlight on target node with expanding radar pulse beacon
  // Ensures state name and description remain 100% visible, sharp, and clear at all times
  const triggerNodeJumpHighlight = useCallback((nodeEl: Element) => {
    if (jumpHighlightedNodeRef.current && jumpHighlightedNodeRef.current !== nodeEl) {
      jumpHighlightedNodeRef.current.classList.remove('diagram-jump-highlight');
      jumpHighlightedNodeRef.current.querySelectorAll('.state-jump-border-pulse, .state-jump-border-bg-flash').forEach((s) => {
        s.classList.remove('state-jump-border-pulse', 'state-jump-border-bg-flash');
      });
      jumpHighlightedNodeRef.current.querySelectorAll('.tc-goto-state-beacon').forEach((b) => b.remove());
      if (jumpSavedInlineStylesRef.current) {
        jumpSavedInlineStylesRef.current.forEach(
          ({ el, stroke, strokeWidth, strokePriority, attrStroke, attrStrokeWidth }) => {
            if (stroke) el.style.setProperty('stroke', stroke, strokePriority);
            else el.style.removeProperty('stroke');
            if (strokeWidth) el.style.setProperty('stroke-width', strokeWidth, strokePriority);
            else el.style.removeProperty('stroke-width');
            if (attrStroke !== null && attrStroke !== undefined) el.setAttribute('stroke', attrStroke);
            else el.removeAttribute('stroke');
            if (attrStrokeWidth !== null && attrStrokeWidth !== undefined) el.setAttribute('stroke-width', attrStrokeWidth);
            else el.removeAttribute('stroke-width');
          }
        );
        jumpSavedInlineStylesRef.current = null;
      }
    }

    // Select only actual background shape elements, strictly avoiding beacon radar rings or text elements
    const shapes = Array.from(
      nodeEl.querySelectorAll<SVGElement>(
        ':scope > rect, :scope > polygon, :scope > circle, :scope > path.basic, :scope > path.label-container, :scope > .label-container, rect.basic, polygon.basic'
      )
    ).filter((s) => !s.closest('.tc-goto-state-beacon') && !s.classList.contains('tc-beacon-radar-pulse'));

    if (!jumpSavedInlineStylesRef.current || jumpHighlightedNodeRef.current !== nodeEl) {
      const savedStyles = shapes.map((s) => ({
        el: s,
        stroke: s.style.getPropertyValue('stroke'),
        strokeWidth: s.style.getPropertyValue('stroke-width'),
        strokePriority: s.style.getPropertyPriority('stroke'),
        attrStroke: s.getAttribute('stroke'),
        attrStrokeWidth: s.getAttribute('stroke-width'),
      }));
      jumpSavedInlineStylesRef.current = savedStyles;
    }

    // Clear only stroke and stroke-width inline so the pulsing border animation class can take effect.
    // Interior fill and text styling are deliberately untouched to keep state name and description crisp!
    shapes.forEach((s) => {
      s.style.removeProperty('stroke');
      s.style.removeProperty('stroke-width');
    });

    nodeEl.classList.remove('diagram-jump-highlight');
    shapes.forEach((s) => s.classList.remove('state-jump-border-pulse', 'state-jump-border-bg-flash'));
    nodeEl.querySelectorAll('.tc-goto-state-beacon').forEach((b) => b.remove());

    // Force synchronous layout reflow on SVG element so consecutive animations reliably restart from 0%
    void (nodeEl as SVGGraphicsElement).getBoundingClientRect?.();

    nodeEl.classList.add('diagram-jump-highlight');
    shapes.forEach((s) => s.classList.add('state-jump-border-pulse'));
    jumpHighlightedNodeRef.current = nodeEl as SVGElement;

    // Attach expanding beacon pulse radar ring around the node, inserted as FIRST child behind text
    try {
      const bbox = (nodeEl as SVGGraphicsElement).getBBox?.();
      if (bbox && bbox.width > 0 && bbox.height > 0) {
        const beaconG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        beaconG.setAttribute('class', 'tc-goto-state-beacon pointer-events-none');
        beaconG.style.pointerEvents = 'none';
        const pad = 10;
        const beaconRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        beaconRect.setAttribute('x', String(bbox.x - pad));
        beaconRect.setAttribute('y', String(bbox.y - pad));
        beaconRect.setAttribute('width', String(bbox.width + pad * 2));
        beaconRect.setAttribute('height', String(bbox.height + pad * 2));
        beaconRect.setAttribute('rx', '12');
        beaconRect.setAttribute('ry', '12');
        beaconRect.setAttribute('fill', 'none');
        beaconRect.setAttribute('stroke', '#38bdf8');
        beaconRect.setAttribute('stroke-width', '3.5');
        beaconRect.setAttribute('class', 'tc-beacon-radar-pulse');
        beaconRect.style.setProperty('fill', 'none', 'important');
        beaconRect.style.setProperty('pointer-events', 'none', 'important');
        beaconG.appendChild(beaconRect);

        // Insert as first child so it is rendered behind the node content and text label!
        if (nodeEl.firstChild) {
          nodeEl.insertBefore(beaconG, nodeEl.firstChild);
        } else {
          nodeEl.appendChild(beaconG);
        }
      }
    } catch {
      // getBBox fallback ignored if detached
    }

    if (jumpHighlightTimerRef.current) {
      clearTimeout(jumpHighlightTimerRef.current);
    }
    jumpHighlightTimerRef.current = setTimeout(() => {
      nodeEl.classList.remove('diagram-jump-highlight');
      shapes.forEach((s) => s.classList.remove('state-jump-border-pulse', 'state-jump-border-bg-flash'));
      nodeEl.querySelectorAll('.tc-goto-state-beacon').forEach((b) => b.remove());

      if (jumpSavedInlineStylesRef.current) {
        jumpSavedInlineStylesRef.current.forEach(
          ({ el, stroke, strokeWidth, strokePriority, attrStroke, attrStrokeWidth }) => {
            if (stroke) el.style.setProperty('stroke', stroke, strokePriority);
            else el.style.removeProperty('stroke');
            if (strokeWidth) el.style.setProperty('stroke-width', strokeWidth, strokePriority);
            else el.style.removeProperty('stroke-width');
            if (attrStroke !== null && attrStroke !== undefined) el.setAttribute('stroke', attrStroke);
            else el.removeAttribute('stroke');
            if (attrStrokeWidth !== null && attrStrokeWidth !== undefined) el.setAttribute('stroke-width', attrStrokeWidth);
            else el.removeAttribute('stroke-width');
          }
        );
        jumpSavedInlineStylesRef.current = null;
      }
      if (jumpHighlightedNodeRef.current === nodeEl) {
        jumpHighlightedNodeRef.current = null;
      }
    }, 2500);
  }, []);

  // Smooth scroll-to animation that glides canvas to center the target element in the viewport
  const panToElement = useCallback(
    (
      elem: Element,
      options?: { duration?: number; onComplete?: () => void }
    ) => {
      if (!containerRef.current) return;
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();

      let elemRect = elem.getBoundingClientRect();
      if (elemRect.width === 0 && elemRect.height === 0) {
        const child = elem.querySelector('rect, polygon, circle, path, foreignObject, text');
        if (child) {
          elemRect = child.getBoundingClientRect();
        }
      }
      if (elemRect.width === 0 && elemRect.height === 0) return;

      // Deduplicate calls for the same element within 40ms to avoid re-triggering mid-frame
      const now = performance.now();
      if (
        lastPanRequestRef.current &&
        lastPanRequestRef.current.target === elem &&
        now - lastPanRequestRef.current.time < 40 &&
        activePanAnimationRef.current
      ) {
        return;
      }
      lastPanRequestRef.current = { target: elem, time: now };

      // Stop any existing animation
      if (activePanAnimationRef.current) {
        cancelAnimationFrame(activePanAnimationRef.current);
        activePanAnimationRef.current = null;
      }

      const wrapper = container.querySelector('#mermaid-svg-wrapper') as HTMLElement | null;
      let startX = currentPanRef.current.x;
      let startY = currentPanRef.current.y;

      // Read current actual rendered position if wrapper was previously transforming
      if (wrapper) {
        wrapper.style.transition = 'none';
        const transformStr = window.getComputedStyle(wrapper).transform;
        if (transformStr && transformStr !== 'none') {
          const matrixMatch = transformStr.match(/matrix\(([^)]+)\)/);
          if (matrixMatch) {
            const parts = matrixMatch[1].split(',').map((p) => parseFloat(p.trim()));
            if (parts.length >= 6 && !isNaN(parts[4]) && !isNaN(parts[5])) {
              startX = parts[4];
              startY = parts[5];
              currentPanRef.current = { x: startX, y: startY };
            }
          }
        }
      }

      // Viewport center
      const targetCenterX = containerRect.left + containerRect.width / 2;
      const targetCenterY = containerRect.top + containerRect.height / 2;

      // Current element center in screen viewport
      const currentElemCenterX = elemRect.left + elemRect.width / 2;
      const currentElemCenterY = elemRect.top + elemRect.height / 2;

      const deltaX = targetCenterX - currentElemCenterX;
      const deltaY = targetCenterY - currentElemCenterY;

      const targetX = Math.round(startX + deltaX);
      const targetY = Math.round(startY + deltaY);

      // If already centered within 2 pixels, just finish
      if (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) {
        setPan({ x: targetX, y: targetY });
        currentPanRef.current = { x: targetX, y: targetY };
        options?.onComplete?.();
        return;
      }

      const distance = Math.hypot(deltaX, deltaY);
      // Dynamic smooth duration: 400ms to 650ms depending on travel distance
      const duration = options?.duration ?? Math.min(650, Math.max(380, Math.round(distance * 0.38)));
      const startTime = performance.now();

      // Natural deceleration curve (smooth ease-out with slight quart blend)
      const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
      const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
      const ease = (t: number) => 0.4 * easeOutCubic(t) + 0.6 * easeOutQuart(t);

      setCanvasTransition('none');

      const animateStep = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(1, elapsed / duration);
        const eased = ease(progress);

        const curX = startX + (targetX - startX) * eased;
        const curY = startY + (targetY - startY) * eased;

        currentPanRef.current = { x: curX, y: curY };

        if (wrapper) {
          wrapper.style.transform = `translate(${curX}px, ${curY}px) scale(${zoomRef.current})`;
        }

        if (progress < 1) {
          activePanAnimationRef.current = requestAnimationFrame(animateStep);
        } else {
          activePanAnimationRef.current = null;
          setPan({ x: targetX, y: targetY });
          currentPanRef.current = { x: targetX, y: targetY };
          if (wrapper) {
            wrapper.style.transform = `translate(${targetX}px, ${targetY}px) scale(${zoomRef.current})`;
          }
          options?.onComplete?.();
        }
      };

      activePanAnimationRef.current = requestAnimationFrame(animateStep);
    },
    []
  );

  const clearHighlighting = () => {
    if (!containerRef.current) return;
    const svg = getDiagramSvg();
    if (!svg) return;

    svg.classList.remove('diagram-search-active');
    const prevHighlighted = svg.querySelectorAll(
      '.diagram-match-node, .diagram-match-edge, .diagram-match-path, .diagram-match-active'
    );
    prevHighlighted.forEach((el) => {
      el.classList.remove(
        'diagram-match-node',
        'diagram-match-edge',
        'diagram-match-path',
        'diagram-match-active'
      );
    });
  };

  const applySearchHighlighting = (
    query: string,
    targetActiveIndex = 0,
    shouldPan = false
  ) => {
    if (!containerRef.current) return;
    const svg = getDiagramSvg();
    if (!svg) return;

    const term = query.trim().toLowerCase();

    // Reset previous search classes
    clearHighlighting();

    if (!term) {
      setMatches([]);
      setMatchesBreakdown({ states: 0, transitions: 0 });
      setActiveMatchIndex(0);
      return;
    }

    svg.classList.add('diagram-search-active');

    const newMatches: SearchMatchItem[] = [];
    let stateMatches = 0;
    let transitionMatches = 0;

    // 1. Match States (g.node)
    const nodes = Array.from(svg.querySelectorAll('g.node'));
    nodes.forEach((node) => {
      const text = node.textContent || '';
      const stateId =
        node.getAttribute('data-state-id') ||
        node.id?.replace(/^flowchart-/, '').replace(/-\d+$/, '') ||
        '';
      const stateLabel = node.getAttribute('data-state-label') || text.trim().replace(/\s+/g, ' ');

      const isMatch =
        text.toLowerCase().includes(term) ||
        stateId.toLowerCase().includes(term) ||
        stateLabel.toLowerCase().includes(term);

      if (isMatch) {
        node.classList.add('diagram-match-node');
        stateMatches++;
        newMatches.push({
          type: 'state',
          name: stateLabel || text.trim().replace(/\s+/g, ' '),
          element: node,
          stateId,
          stateLabel,
        });
      }
    });

    // 2. Match Transitions (g.edgeLabel & corresponding paths)
    const pGroup = svg.querySelector('g.edgePaths');
    const allPaths = pGroup
      ? Array.from(pGroup.querySelectorAll('path')).filter(
          (p) => !p.closest('defs') && p.getAttribute('d')
        )
      : [];
    const edgeLabels = Array.from(svg.querySelectorAll('g.edgeLabel'));

    edgeLabels.forEach((labelEl, idx) => {
      const text = labelEl.textContent || '';

      // Find linked path
      let matchedPath: Element | null = null;
      const labelDataId =
        labelEl.getAttribute('data-id') ||
        labelEl.querySelector('[data-id]')?.getAttribute('data-id');

      if (labelDataId) {
        matchedPath =
          allPaths.find((p) => p.getAttribute('data-id') === labelDataId) ||
          null;
      }

      if (!matchedPath && idx < allPaths.length) {
        matchedPath = allPaths[idx];
      }

      // Resolve linked edge info
      const edge =
        resolveEdgeFromElement(labelEl, svg, availableEdges) ||
        (matchedPath ? resolveEdgeFromElement(matchedPath, svg, availableEdges) : undefined);

      const fromState = edge?.from || '';
      const toState = edge?.to || '';
      const guard = edge?.guard || edge?.condition || '';
      const label = edge?.label || '';

      const isMatch =
        text.toLowerCase().includes(term) ||
        fromState.toLowerCase().includes(term) ||
        toState.toLowerCase().includes(term) ||
        guard.toLowerCase().includes(term) ||
        label.toLowerCase().includes(term);

      if (isMatch) {
        labelEl.classList.add('diagram-match-edge');
        transitionMatches++;

        const associatedPaths: Element[] = [];
        if (matchedPath) {
          matchedPath.classList.add('diagram-match-path');
          associatedPaths.push(matchedPath);

          const pathId =
            matchedPath.getAttribute('id') ||
            matchedPath.getAttribute('data-id') ||
            matchedPath.getAttribute('data-path-id') ||
            String(allPaths.indexOf(matchedPath as SVGPathElement));

          const badges = svg.querySelectorAll(
            `.tc-priority-badge[data-path-id="${pathId}"]`
          );
          badges.forEach((b) => {
            b.classList.add('diagram-match-path');
            associatedPaths.push(b);
          });
        }

        newMatches.push({
          type: 'transition',
          name: text.trim().replace(/\s+/g, ' ') || label || `${fromState} -> ${toState}`,
          element: labelEl,
          associatedPaths,
          edgeInfo: edge || undefined,
          fromState,
          toState,
          guard,
          priority: edge?.priority,
        });
      }
    });

    setMatches(newMatches);
    setMatchesBreakdown({ states: stateMatches, transitions: transitionMatches });

    if (newMatches.length > 0) {
      const idx = Math.max(0, Math.min(targetActiveIndex, newMatches.length - 1));
      setActiveMatchIndex(idx);
      const activeMatch = newMatches[idx];
      activeMatch.element.classList.add('diagram-match-active');
      activeMatch.associatedPaths?.forEach((p) =>
        p.classList.add('diagram-match-active')
      );

      if (shouldPan) {
        panToElement(activeMatch.element);
      }
    } else {
      setActiveMatchIndex(0);
    }
  };

  const handleSearchChange = (val: string) => {
    if (onSearchQueryChange) {
      onSearchQueryChange(val);
    } else {
      setInternalSearchQuery(val);
    }
    applySearchHighlighting(val, 0, true);
  };

  const clearSearch = () => {
    if (onSearchQueryChange) {
      onSearchQueryChange('');
    } else {
      setInternalSearchQuery('');
    }
    clearHighlighting();
    setMatches([]);
    setMatchesBreakdown({ states: 0, transitions: 0 });
    setActiveMatchIndex(0);
  };

  const switchActiveMatch = (newIdx: number) => {
    if (!containerRef.current || matches.length === 0) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;

    const prevActives = svg.querySelectorAll('.diagram-match-active');
    prevActives.forEach((el) => el.classList.remove('diagram-match-active'));

    const item = matches[newIdx];
    if (item) {
      item.element.classList.add('diagram-match-active');
      item.associatedPaths?.forEach((p) =>
        p.classList.add('diagram-match-active')
      );
      setActiveMatchIndex(newIdx);
      panToElement(item.element);
      if (item.element.classList.contains('node') || item.element.closest('g.node')) {
        const nodeG = (item.element.classList.contains('node') ? item.element : item.element.closest('g.node')) as SVGGElement;
        if (nodeG) triggerNodeJumpHighlight(nodeG);
      }
    }
  };

  const goToNextMatch = () => {
    if (matches.length <= 1) return;
    const nextIdx = (activeMatchIndex + 1) % matches.length;
    switchActiveMatch(nextIdx);
  };

  const goToPrevMatch = () => {
    if (matches.length <= 1) return;
    const prevIdx = (activeMatchIndex - 1 + matches.length) % matches.length;
    switchActiveMatch(prevIdx);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        goToPrevMatch();
      } else {
        goToNextMatch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clearSearch();
      setIsSearchFocused(false);
      searchInputRef.current?.blur();
    }
  };

  // Re-apply search highlighting when svgContent updates
  useEffect(() => {
    if (svgContent && effectiveSearchQuery.trim()) {
      const timer = setTimeout(() => {
        applySearchHighlighting(effectiveSearchQuery, activeMatchIndex, false);
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [svgContent, effectiveSearchQuery]);

  // Global shortcut to focus search
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsSearchPanelOpen(true);
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const renderDiagram = async () => {
      if (!code.trim()) {
        setSvgContent('');
        setError(null);
        return;
      }
      try {
        setError(null);
        ensureElkRegistered();
        mermaid.initialize({
          startOnLoad: false,
          theme: mermaidTheme,
          securityLevel: 'loose',
          layout: layoutEngine,
          flowchart: {
            useMaxWidth: false,
            htmlLabels: true,
            curve: flowchartCurve,
            wrappingWidth: 360,
          },
          state: {
            useMaxWidth: false,
          },
        });
        const uniqueId = `mermaid-render-${Math.random().toString(36).substring(2, 9)}`;
        const codeForRendering =
          isInteractiveMode && isCompactLabels
            ? createInteractiveMermaidCode(code, true)
            : code;
        const { svg } = await mermaid.render(uniqueId, codeForRendering);
        if (isMounted) {
          const enhancedSvg = enhanceSvgWithPriorityCircles(
            svg,
            effectiveSelectedStateId,
            effectiveCustomStyles,
            selectedEdge?.id,
            notesForDiagram,
            isInteractiveMode,
            activeConditionOverlay?.edge?.id,
            availableEdges,
            complexityHeatmapResult,
            isHeatmapActive,
            heatmapOnlyRefactor,
            complexityThreshold,
            showComplexityBadges
          );
          setSvgContent(enhancedSvg);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : String(err));
          setSvgContent('');
        }
      }
    };

    renderDiagram();
    return () => {
      isMounted = false;
    };
  }, [
    code,
    layoutEngine,
    flowchartCurve,
    mermaidTheme,
    effectiveCustomStyles,
    isInteractiveMode,
    isCompactLabels,
    notesForDiagram,
    complexityHeatmapResult,
    isHeatmapActive,
    heatmapOnlyRefactor,
    complexityThreshold,
    showComplexityBadges,
    layoutTrigger,
  ]);

  // Synchronize active transition detail overlay label highlighting in SVG
  useEffect(() => {
    if (!containerRef.current) return;
    const svg = getDiagramSvg();
    if (!svg) return;
    svg.querySelectorAll('.tc-interactive-edge-label-active').forEach((el) => {
      el.classList.remove('tc-interactive-edge-label-active');
    });
    if (activeConditionOverlay) {
      const activeId = activeConditionOverlay.edge.id;
      const labels = Array.from(svg.querySelectorAll('g.edgeLabel, .clickable-edge-label, .tc-interactive-edge-label'));
      for (const l of labels) {
        const lEdgeId = l.getAttribute('data-edge-id');
        const lPathId = l.getAttribute('data-linked-path-id');
        if (
          (lEdgeId && lEdgeId === activeId) ||
          (lPathId && lPathId === activeId) ||
          // Whole-text match only for labels without an edge id (guards repeat and contain each other)
          (!lEdgeId &&
            !!activeConditionOverlay.edge.label &&
            normalizeGuardText(l.textContent || '') === normalizeGuardText(activeConditionOverlay.edge.label))
        ) {
          l.classList.add('tc-interactive-edge-label-active');
          break;
        }
      }
    }
  }, [activeConditionOverlay, getDiagramSvg]);

  // 1. Initialize SVG metadata and active offsets whenever SVG content updates
  useEffect(() => {
    if (!containerRef.current || !svgContent) return;
    const svg = getDiagramSvg();
    if (!svg) return;
    initializeSvgDragMetadata(svg, availableEdges);

    let targetNodeOffsets = { ...effectiveNodeOffsets };

    if (isLayoutLocked && Object.keys(lockedNodePositionsRef.current).length > 0) {
      // Automatic re-layout is disabled! Maintain custom node positions across code edits:
      const nodes = Array.from(svg.querySelectorAll('g.node')) as SVGGElement[];
      const updatedOffsets: NodeOffsetsMap = { ...targetNodeOffsets };
      let hasAdjusted = false;

      for (const node of nodes) {
        const rawStateId = node.getAttribute('data-state-id') || node.getAttribute('id') || '';
        let stateId = cleanNodeId(rawStateId);
        if (!stateId && (rawStateId.includes('root_start') || rawStateId.includes('startNode'))) {
          stateId = '[*]';
        }
        if (!stateId || stateId.startsWith('note_')) continue;

        const lockedPos = lockedNodePositionsRef.current[stateId];
        if (lockedPos) {
          const geom = getNodeGeometry(node, svg);
          const neededX = Math.round(lockedPos.centerX - geom.origCenterX);
          const neededY = Math.round(lockedPos.centerY - geom.origCenterY);
          updatedOffsets[stateId] = { x: neededX, y: neededY };
          hasAdjusted = true;
        }
      }

      if (hasAdjusted) {
        targetNodeOffsets = updatedOffsets;
        currentNodeOffsetsRef.current = updatedOffsets;
        if (onNodeOffsetsChange) {
          onNodeOffsetsChange(updatedOffsets);
        } else {
          setInternalNodeOffsets(updatedOffsets);
        }
      }
    }

    applyDiagramOffsetsToSvg(
      svg,
      targetNodeOffsets,
      edgeOffsets,
      null,
      selectedEdge?.id || null,
      layoutEngine,
      flowchartCurve
    );
    const positions = extractCanvasNodePositions(svg, targetNodeOffsets);
    setCanvasNodePositions(positions);

    // If layout is not locked, OR if lockedNodePositions is empty (freshly auto-aligned), keep lockedNodePositionsRef in sync with latest positions
    if (!isLayoutLocked || Object.keys(lockedNodePositionsRef.current).length === 0) {
      const newLocked: Record<string, { centerX: number; centerY: number }> = {};
      for (const [id, p] of Object.entries(positions)) {
        newLocked[id] = { centerX: p.centerX, centerY: p.centerY };
      }
      lockedNodePositionsRef.current = newLocked;
    }

    if (autoAlignInProgressRef.current) {
      autoAlignInProgressRef.current = false;
      setIsAutoAligning(false);
    }

    if (onCanvasPositionsChange) {
      onCanvasPositionsChange(positions);
    }
  }, [svgContent, availableEdges, isLayoutLocked, getDiagramSvg]);

  // 2. Synchronize node selection and incoming/outgoing edges highlight in SVG
  useEffect(() => {
    if (!containerRef.current) return;
    const svg = getDiagramSvg();
    if (!svg) return;

    // A. Clean up previous state selection & connected edge highlight classes
    svg.classList.remove('diagram-state-focus-active');
    svg.querySelectorAll('.diagram-selected-node').forEach((el) => {
      el.classList.remove('diagram-selected-node');
    });
    svg.querySelectorAll('.diagram-connected-edge, .diagram-outgoing-edge, .diagram-incoming-edge, .diagram-loop-edge').forEach((el) => {
      el.classList.remove('diagram-connected-edge', 'diagram-outgoing-edge', 'diagram-incoming-edge', 'diagram-loop-edge');
    });
    svg.querySelectorAll('.diagram-connected-edge-label, .diagram-outgoing-edge-label, .diagram-incoming-edge-label, .diagram-loop-edge-label').forEach((el) => {
      el.classList.remove('diagram-connected-edge-label', 'diagram-outgoing-edge-label', 'diagram-incoming-edge-label', 'diagram-loop-edge-label');
    });
    svg.querySelectorAll('.diagram-connected-badge, .diagram-outgoing-badge, .diagram-incoming-badge').forEach((el) => {
      el.classList.remove('diagram-connected-badge', 'diagram-outgoing-badge', 'diagram-incoming-badge');
    });

    // Restore original marker-ends if saved
    svg.querySelectorAll('path[data-prev-marker-end]').forEach((p) => {
      const orig = p.getAttribute('data-prev-marker-end');
      if (orig) {
        p.setAttribute('marker-end', orig);
      } else {
        p.removeAttribute('marker-end');
      }
      p.removeAttribute('data-prev-marker-end');
    });

    if (!effectiveSelectedStateId) return;

    // B. Highlight selected state node
    const targetNode =
      findNodeElement(svg as SVGSVGElement, effectiveSelectedStateId) ||
      (svg.querySelector(`g.node[data-state-id="${effectiveSelectedStateId}"]`) as SVGGElement | null) ||
      (svg.querySelector(`g.node[id*="${cleanNodeId(effectiveSelectedStateId)}"]`) as SVGGElement | null);
    if (targetNode) {
      targetNode.classList.add('diagram-selected-node');
    }

    // C. Activate state focus mode (softens unconnected edges/labels so transitions stand out)
    svg.classList.add('diagram-state-focus-active');

    // D. Setup custom markers in <defs> for colored arrowheads
    let defs = svg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svg.insertBefore(defs, svg.firstChild);
    }
    const ensureMarker = (id: string, color: string) => {
      let marker = defs!.querySelector(`#${id}`) as SVGMarkerElement | null;
      if (!marker) {
        marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', id);
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '9');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '7');
        marker.setAttribute('markerHeight', '7');
        marker.setAttribute('orient', 'auto');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M 0 1.5 L 9 5 L 0 8.5 z');
        path.setAttribute('fill', color);
        path.setAttribute('stroke', color);
        marker.appendChild(path);
        defs!.appendChild(marker);
      } else {
        const path = marker.querySelector('path');
        if (path) {
          path.setAttribute('fill', color);
          path.setAttribute('stroke', color);
        }
      }
    };
    ensureMarker('tc-marker-outgoing', '#10b981');
    ensureMarker('tc-marker-incoming', '#818cf8');
    ensureMarker('tc-marker-loop', '#f59e0b');

    // E. Matching helpers for selected state ID
    const cleanTargetId = cleanNodeId(effectiveSelectedStateId);
    const targetLower = cleanTargetId.toLowerCase();
    const targetSuffix = targetLower.includes('.') ? targetLower.split('.').pop()! : targetLower;
    const targetAlnum = targetLower.replace(/[^a-z0-9]/g, '');

    const isStateMatch = (candidate: string): boolean => {
      if (!candidate) return false;
      const cClean = cleanNodeId(candidate);
      const cLower = cClean.toLowerCase();
      const cSuffix = cLower.includes('.') ? cLower.split('.').pop()! : cLower;
      const cAlnum = cLower.replace(/[^a-z0-9]/g, '');
      return (
        cClean === cleanTargetId ||
        cLower === targetLower ||
        cSuffix === targetSuffix ||
        (cAlnum.length > 2 && targetAlnum.length > 2 && cAlnum === targetAlnum) ||
        candidate === effectiveSelectedStateId ||
        candidate.toLowerCase() === effectiveSelectedStateId.toLowerCase()
      );
    };

    // Filter available edges
    const outgoingEdges = availableEdges.filter((e) => isStateMatch(e.from));
    const incomingEdges = availableEdges.filter((e) => isStateMatch(e.to));

    const outgoingEdgeKeys = new Set(outgoingEdges.map((e) => `${cleanNodeId(e.from)}->${cleanNodeId(e.to)}`));
    const incomingEdgeKeys = new Set(incomingEdges.map((e) => `${cleanNodeId(e.from)}->${cleanNodeId(e.to)}`));
    const outgoingPathIds = new Set(outgoingEdges.map((e) => e.id || e.pathId).filter(Boolean));
    const incomingPathIds = new Set(incomingEdges.map((e) => e.id || e.pathId).filter(Boolean));

    // F. Find and highlight all edge paths (lines, arrowheads, hitboxes)
    const allEdgePaths = Array.from(
      new Set(
        Array.from(
          svg.querySelectorAll<SVGPathElement>(
            'path.tc-edge-path, g.edgePaths path:not(.tc-edge-hitbox), g.edgePath path:not(.tc-edge-hitbox), path.flowchart-link:not(.tc-edge-hitbox), path.transition:not(.tc-edge-hitbox), g[class*="edge"] path:not(.tc-edge-hitbox)'
          )
        ).filter((p) => !p.closest('defs') && !p.closest('marker') && p.getAttribute('d'))
      )
    );

    // Pre-resolve path elements from outgoing and incoming edges for 100% reliable matching
    const outgoingPathElements = new Set<SVGPathElement>();
    const incomingPathElements = new Set<SVGPathElement>();

    outgoingEdges.forEach((edge) => {
      const p =
        findEdgePathElement(svg, edge.id, availableEdges) ||
        findEdgePathElement(svg, `${edge.from}->${edge.to}`, availableEdges) ||
        findEdgePathElement(svg, `${cleanNodeId(edge.from)}->${cleanNodeId(edge.to)}`, availableEdges);
      if (p) {
        outgoingPathElements.add(p);
        if (!allEdgePaths.includes(p)) allEdgePaths.push(p);
      }
    });

    incomingEdges.forEach((edge) => {
      const p =
        findEdgePathElement(svg, edge.id, availableEdges) ||
        findEdgePathElement(svg, `${edge.from}->${edge.to}`, availableEdges) ||
        findEdgePathElement(svg, `${cleanNodeId(edge.from)}->${cleanNodeId(edge.to)}`, availableEdges);
      if (p) {
        incomingPathElements.add(p);
        if (!allEdgePaths.includes(p)) allEdgePaths.push(p);
      }
    });

    const allEdgeLabels = Array.from(svg.querySelectorAll<SVGGElement>('g.edgeLabel, .edgeLabel'));
    const allPriorityBadges = Array.from(svg.querySelectorAll<SVGGElement>('.tc-priority-badge'));

    allEdgePaths.forEach((path) => {
      const pId = path.getAttribute('data-path-id') || path.getAttribute('data-edge-id') || path.getAttribute('id') || '';
      const srcId = path.getAttribute('data-source-id') || path.getAttribute('data-from') || '';
      const tgtId = path.getAttribute('data-target-id') || path.getAttribute('data-to') || '';
      const edgeKey = path.getAttribute('data-edge-key') || `${srcId}->${tgtId}`;
      const parent = path.parentElement;
      const classStr = `${path.getAttribute('class') || ''} ${parent?.getAttribute('class') || ''}`;

      let isOutgoing = outgoingPathElements.has(path);
      let isIncoming = incomingPathElements.has(path);

      // Check data-source-id / data-target-id
      if (!isOutgoing && isStateMatch(srcId)) isOutgoing = true;
      if (!isIncoming && isStateMatch(tgtId)) isIncoming = true;

      // Check classes (LS-... LE-...)
      if (!isOutgoing || !isIncoming) {
        const lsMatch = classStr.match(/\bLS-([A-Za-z0-9_.-]+)\b/);
        if (lsMatch && isStateMatch(lsMatch[1])) isOutgoing = true;
        const leMatch = classStr.match(/\bLE-([A-Za-z0-9_.-]+)\b/);
        if (leMatch && isStateMatch(leMatch[1])) isIncoming = true;
      }

      // Check keys and path IDs
      if (!isOutgoing && (outgoingEdgeKeys.has(edgeKey) || outgoingPathIds.has(pId))) isOutgoing = true;
      if (!isIncoming && (incomingEdgeKeys.has(edgeKey) || incomingPathIds.has(pId))) isIncoming = true;

      // Fallback: resolveEdgeFromElement
      if (!isOutgoing && !isIncoming) {
        const resolved = resolveEdgeFromElement(path, svg, availableEdges);
        if (resolved) {
          if (isStateMatch(resolved.from)) isOutgoing = true;
          if (isStateMatch(resolved.to)) isIncoming = true;
        }
      }

      if (isOutgoing || isIncoming) {
        path.classList.add('diagram-connected-edge');

        // Also highlight matching hitbox
        const hitbox = parent?.querySelector(`.tc-edge-hitbox[data-path-id="${pId}"], .tc-edge-hitbox[data-edge-id="${pId}"]`) ||
          parent?.querySelector('.tc-edge-hitbox');
        hitbox?.classList.add('diagram-connected-edge');

        // Save original marker and apply custom colored arrowhead
        if (!path.hasAttribute('data-prev-marker-end')) {
          path.setAttribute('data-prev-marker-end', path.getAttribute('marker-end') || '');
        }

        if (isOutgoing && isIncoming) {
          path.classList.add('diagram-loop-edge');
          hitbox?.classList.add('diagram-loop-edge');
          path.setAttribute('marker-end', 'url(#tc-marker-loop)');
        } else if (isOutgoing) {
          path.classList.add('diagram-outgoing-edge');
          hitbox?.classList.add('diagram-outgoing-edge');
          path.setAttribute('marker-end', 'url(#tc-marker-outgoing)');
        } else if (isIncoming) {
          path.classList.add('diagram-incoming-edge');
          hitbox?.classList.add('diagram-incoming-edge');
          path.setAttribute('marker-end', 'url(#tc-marker-incoming)');
        }

        // Link edge labels by linked path id, edge id, or from/to state
        allEdgeLabels.forEach((labelEl) => {
          const lPid = labelEl.getAttribute('data-linked-path-id');
          const lEdgeId = labelEl.getAttribute('data-edge-id');
          const lFrom = labelEl.getAttribute('data-from') || '';
          const lTo = labelEl.getAttribute('data-to') || '';

          // A label linked to a path belongs to that path only; the looser checks are for unlinked labels
          const isLabelForThisPath = lPid
            ? lPid === pId || lPid === path.getAttribute('id')
            : (lEdgeId && (lEdgeId === pId || lEdgeId === path.getAttribute('data-edge-id'))) ||
              (lFrom && lTo && isStateMatch(lFrom) && (srcId ? isStateMatch(srcId) : true)) ||
              (lFrom && lTo && isStateMatch(lTo) && (tgtId ? isStateMatch(tgtId) : true));

          if (isLabelForThisPath) {
            labelEl.classList.add('diagram-connected-edge-label');
            if (isOutgoing && isIncoming) {
              labelEl.classList.add('diagram-loop-edge-label');
            } else if (isOutgoing) {
              labelEl.classList.add('diagram-outgoing-edge-label');
            } else if (isIncoming) {
              labelEl.classList.add('diagram-incoming-edge-label');
            }
          }
        });

        // Link priority badges
        allPriorityBadges.forEach((badge) => {
          const bPid = badge.getAttribute('data-path-id') || badge.getAttribute('data-edge-id');
          const bFrom = badge.getAttribute('data-from') || '';
          const bTo = badge.getAttribute('data-to') || '';
          if (bPid === pId || (isOutgoing && isStateMatch(bFrom)) || (isIncoming && isStateMatch(bTo))) {
            badge.classList.add('diagram-connected-badge');
            if (isOutgoing) badge.classList.add('diagram-outgoing-badge');
            if (isIncoming) badge.classList.add('diagram-incoming-badge');
          }
        });
      }
    });

    // G. Secondary label matching by guard condition text (for labels without explicit data-linked-path-id)
    // Only for labels not linked to a path, and on the whole guard text: guards such as "else" repeat across the
    // diagram, and a guard can be part of another one, so substring matches highlighted unrelated transitions
    allEdgeLabels.forEach((labelEl) => {
      if (labelEl.classList.contains('diagram-connected-edge-label')) return;
      if (labelEl.getAttribute('data-linked-path-id') || labelEl.getAttribute('data-edge-id')) return;
      const text = normalizeGuardText(labelEl.textContent || '');
      if (!text) return;
      const isOutLabel = outgoingEdges.some((e) => normalizeGuardText(e.condition || e.label || '') === text);
      const isInLabel = incomingEdges.some((e) => normalizeGuardText(e.condition || e.label || '') === text);
      if (isOutLabel || isInLabel) {
        labelEl.classList.add('diagram-connected-edge-label');
        if (isOutLabel && isInLabel) {
          labelEl.classList.add('diagram-loop-edge-label');
        } else if (isOutLabel) {
          labelEl.classList.add('diagram-outgoing-edge-label');
        } else if (isInLabel) {
          labelEl.classList.add('diagram-incoming-edge-label');
        }
      }
    });
  }, [effectiveSelectedStateId, availableEdges, svgContent, getDiagramSvg]);

  // 3. Synchronize edge selection highlight and active offsets in SVG
  useEffect(() => {
    if (!containerRef.current || !svgContent) return;
    const svg = getDiagramSvg();
    if (!svg) return;

    svg.querySelectorAll('.diagram-selected-edge, .selected-edge').forEach((el) => {
      el.classList.remove('diagram-selected-edge', 'selected-edge');
    });
    svg.querySelectorAll('.diagram-selected-edge-label').forEach((el) => {
      el.classList.remove('diagram-selected-edge-label');
    });

    const selId = selectedEdge && selectedEdge.id && selectedEdge.id.trim() !== '->' ? selectedEdge.id.trim() : null;
    if (selId) {
      let targetPath = svg.querySelector<SVGPathElement>(`path.tc-edge-path[data-path-id="${selId}"]`);
      if (!targetPath) {
        targetPath = svg.querySelector<SVGPathElement>(`path.tc-edge-path[data-edge-id="${selId}"]`);
      }
      if (!targetPath) {
        // Via the transition's label, which is linked to its exact path (parallel edges share from->to)
        const linkedPathId = svg
          .querySelector(`g.edgeLabel[data-edge-id="${selId}"]`)
          ?.getAttribute('data-linked-path-id');
        if (linkedPathId) targetPath = svg.querySelector<SVGPathElement>(`path.tc-edge-path[data-path-id="${linkedPathId}"]`);
      }
      if (!targetPath && selectedEdge?.from && selectedEdge?.to) {
        const key = `${selectedEdge.from.trim()}->${selectedEdge.to.trim()}`;
        targetPath = svg.querySelector<SVGPathElement>(`path.tc-edge-path[data-edge-id="${key}"]`);
      }

      if (targetPath) {
        targetPath.classList.add('diagram-selected-edge', 'selected-edge');
        const pId = targetPath.getAttribute('data-path-id') || targetPath.getAttribute('data-edge-id');
        const hitbox = targetPath.parentElement?.querySelector(
          `.tc-edge-hitbox[data-path-id="${pId}"], .tc-edge-hitbox[data-edge-id="${pId}"]`
        );
        hitbox?.classList.add('selected-edge');

        const labels = svg.querySelectorAll<SVGGElement>('g.edgeLabel');
        labels.forEach((l) => {
          const lPid = l.getAttribute('data-linked-path-id');
          // Text match only for labels not linked to a path: "[preProcess]" is part of other guards too
          if (lPid ? lPid === pId : !!selectedEdge?.label && normalizeGuardText(l.textContent || '') === normalizeGuardText(selectedEdge.label)) {
            l.classList.add('diagram-selected-edge-label');
          }
        });
      }
    }

    applyDiagramOffsetsToSvg(
      svg,
      effectiveNodeOffsets,
      edgeOffsets,
      null,
      selId,
      layoutEngine,
      flowchartCurve
    );

    const positions = extractCanvasNodePositions(svg, effectiveNodeOffsets);
    setCanvasNodePositions(positions);
    if (onCanvasPositionsChange) {
      onCanvasPositionsChange(positions);
    }
  }, [selectedEdge, effectiveNodeOffsets, edgeOffsets, layoutEngine, flowchartCurve]);

  // Connect mode: a line from the source state to the mouse, until a target state is clicked
  const [connectLine, setConnectLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  useEffect(() => {
    if (!connectFrom) {
      setConnectLine(null);
      return;
    }
    const svg = renderedSvg;
    const node = svg?.querySelector(`g.node[data-state-id="${CSS.escape(connectFrom)}"]`);
    svg?.classList.add('diagram-connect-mode');
    const onMove = (e: MouseEvent) => {
      const r = node?.getBoundingClientRect();
      if (r) setConnectLine({ x1: r.x + r.width / 2, y1: r.y + r.height / 2, x2: e.clientX, y2: e.clientY });
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      svg?.classList.remove('diagram-connect-mode');
    };
  }, [connectFrom, renderedSvg]);

  // Changes tab: what differs from the compared version
  useEffect(() => {
    const svg = renderedSvg;
    if (!svg) return;
    svg.querySelectorAll('.diff-added, .diff-changed').forEach((el) => el.classList.remove('diff-added', 'diff-changed'));
    if (!diffHighlight) return;
    const node = (id: string) => svg.querySelector(`g.node[data-state-id="${CSS.escape(id)}"]`);
    diffHighlight.added.forEach((id) => node(id)?.classList.add('diff-added'));
    diffHighlight.changed.forEach((id) => node(id)?.classList.add('diff-changed'));
    diffHighlight.edgesAdded.forEach((e) => findEdgePathElement(svg, `${e.from}->${e.to}`, availableEdges)?.classList.add('diff-added'));
    diffHighlight.edgesChanged.forEach((e) => findEdgePathElement(svg, `${e.from}->${e.to}`, availableEdges)?.classList.add('diff-changed'));
  }, [renderedSvg, diffHighlight, availableEdges]);

  // Paths tab: the path(s) between two states stand out, the rest of the diagram is dimmed
  useEffect(() => {
    const svg = renderedSvg;
    if (!svg) return;
    svg.querySelectorAll('.path-node, .path-edge, .path-edge-label').forEach((el) => el.classList.remove('path-node', 'path-edge', 'path-edge-label'));
    svg.classList.toggle('diagram-path-active', !!pathHighlight && pathHighlight.states.length > 0);
    if (!pathHighlight) return;
    for (const id of pathHighlight.states) svg.querySelector(`g.node[data-state-id="${CSS.escape(id)}"]`)?.classList.add('path-node');
    for (const e of pathHighlight.edges) {
      findEdgePathElement(svg, `${e.from}->${e.to}`, availableEdges)?.classList.add('path-edge');
      svg.querySelectorAll(`g.edgeLabel[data-from="${CSS.escape(e.from)}"][data-to="${CSS.escape(e.to)}"]`).forEach((l) => l.classList.add('path-edge-label'));
    }
  }, [renderedSvg, pathHighlight, availableEdges]);

  // Live view: the PLC's current state glows, the previous one and the transition taken are marked
  useEffect(() => {
    const svg = renderedSvg;
    if (!svg) return;
    svg.querySelectorAll('.live-active-node, .live-previous-node').forEach((el) => el.classList.remove('live-active-node', 'live-previous-node'));
    svg.querySelectorAll('.live-last-edge').forEach((el) => el.classList.remove('live-last-edge'));
    svg.classList.toggle('diagram-live-active', !!liveHighlight);
    if (!liveHighlight) return;
    const node = (id: string) => svg.querySelector(`g.node[data-state-id="${CSS.escape(id)}"]`);
    node(liveHighlight.stateId)?.classList.add('live-active-node');
    const prev = liveHighlight.previousStateId;
    if (prev && prev !== liveHighlight.stateId) {
      node(prev)?.classList.add('live-previous-node');
      findEdgePathElement(svg, `${prev}->${liveHighlight.stateId}`, availableEdges)?.classList.add('live-last-edge');
    }
  }, [renderedSvg, liveHighlight, availableEdges]);

  // Live guard values: a TRUE / FALSE / ? badge on each transition's label, and the values of its variables
  // under it (the active state's transitions, and the selected one). Drawn inside the label's group, so they move
  // with the label when it is dragged and pan / zoom with the diagram.
  useEffect(() => {
    const svg = renderedSvg;
    if (!svg) return;
    svg.querySelectorAll('g.live-guard, g.live-guard-values').forEach((el) => el.remove());
    if (!liveGuards) return;
    const ns = 'http://www.w3.org/2000/svg';
    const colors = { true: '#34d399', false: '#64748b', unknown: '#fbbf24' } as const;
    const symbols = { true: '\u2713', false: '\u2717', unknown: '?' } as const;
    const words = { true: 'TRUE', false: 'FALSE', unknown: 'unknown' } as const;
    const MAX_LINES = 6;
    const CHAR_W = 6.1;
    const LINE_H = 13;
    const num = (el: Element | null, name: string) => parseFloat(el?.getAttribute(name) || '0') || 0;
    const shorten = (s: string, max: number) => (s.length > max ? `\u2026${s.slice(s.length - max + 1)}` : s);
    for (const [edgeId, view] of Object.entries(liveGuards)) {
      const label = svg.querySelector(`g.edgeLabel[data-edge-id="${CSS.escape(edgeId)}"]`);
      if (!label) continue;
      // The label's box in its group's coordinates, background included; getBBox() is 0 while the tab is hidden:
      // then from the label's attributes
      let box = { x: 0, y: 0, w: 0, h: 0 };
      try {
        const b = (label as SVGGElement).getBBox();
        box = { x: b.x, y: b.y, w: b.width, h: b.height };
      } catch {
        // not rendered
      }
      if (!box.w) {
        const inner = label.querySelector(':scope > g.label, g.label');
        const fo = label.querySelector('foreignObject');
        const t = (inner?.getAttribute('transform') || '').match(/translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/);
        box = { x: t ? parseFloat(t[1]) : 0, y: t ? parseFloat(t[2]) : 0, w: num(fo, 'width'), h: num(fo, 'height') };
      }
      if (!box.w || !box.h) continue;

      const badge = document.createElementNS(ns, 'g');
      badge.setAttribute('class', `live-guard live-guard-${view.result}`);
      badge.setAttribute('data-guard-result', view.result);
      // On the label's top-left corner: the label's styled background can reach past its box
      badge.setAttribute('transform', `translate(${box.x - 4}, ${box.y - 4})`);
      const title = document.createElementNS(ns, 'title');
      title.textContent = [`Guard: ${words[view.result]}`, ...view.vars.map((v) => `${v.name} = ${v.text}${v.note ? ` (${v.note})` : ''}`)].join('\n');
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('r', '8');
      circle.setAttribute('fill', colors[view.result]);
      circle.setAttribute('stroke', '#0f172a');
      circle.setAttribute('stroke-width', '1.5');
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('fill', '#0f172a');
      text.setAttribute('font-size', '11');
      text.setAttribute('font-weight', '700');
      text.textContent = symbols[view.result];
      badge.append(title, circle, text);
      label.appendChild(badge);

      const detail = view.detail || selectedEdge?.id === edgeId;
      if (!detail || view.vars.length === 0) continue;
      const lines = view.vars.slice(0, MAX_LINES).map((v) => ({ text: `${shorten(v.name, 34)} = ${shorten(v.text, 22)}`, known: v.known, note: v.note }));
      if (view.vars.length > MAX_LINES) lines.push({ text: `+${view.vars.length - MAX_LINES} more`, known: true, note: undefined });
      const width = Math.max(...lines.map((l) => l.text.length)) * CHAR_W + 12;
      const height = lines.length * LINE_H + 6;
      const values = document.createElementNS(ns, 'g');
      values.setAttribute('class', 'live-guard-values');
      values.setAttribute('transform', `translate(${box.x + box.w / 2 - width / 2}, ${box.y + box.h + 3})`);
      const bg = document.createElementNS(ns, 'rect');
      bg.setAttribute('width', String(width));
      bg.setAttribute('height', String(height));
      bg.setAttribute('rx', '4');
      bg.setAttribute('fill', 'rgba(15, 23, 42, 0.92)');
      bg.setAttribute('stroke', colors[view.result]);
      bg.setAttribute('stroke-opacity', '0.7');
      values.appendChild(bg);
      lines.forEach((l, i) => {
        const tx = document.createElementNS(ns, 'text');
        tx.setAttribute('x', '6');
        tx.setAttribute('y', String(3 + (i + 0.5) * LINE_H));
        tx.setAttribute('dominant-baseline', 'central');
        tx.setAttribute('font-family', 'ui-monospace, Consolas, monospace');
        tx.setAttribute('font-size', '10');
        tx.setAttribute('fill', l.known ? '#e2e8f0' : '#fbbf24');
        tx.textContent = l.text;
        if (l.note) {
          const tt = document.createElementNS(ns, 'title');
          tt.textContent = l.note;
          tx.appendChild(tt);
        }
        values.appendChild(tx);
      });
      label.appendChild(values);
    }
  }, [renderedSvg, liveGuards, selectedEdge]);

  // Lint problem badges: a small marker at the top-right corner of each affected state node
  useEffect(() => {
    const svg = renderedSvg;
    if (!svg) return;
    svg.querySelectorAll('g.lint-problem-marker').forEach((el) => el.remove());
    const markers = problemMarkers || {};
    if (Object.keys(markers).length === 0) return;
    const ns = 'http://www.w3.org/2000/svg';
    svg.querySelectorAll('g.node[data-state-id]').forEach((node) => {
      const severity = markers[node.getAttribute('data-state-id') || ''];
      if (!severity) return;
      // The node's shape in its own coordinates, from its attributes: getBBox() is 0 while the tab is hidden
      const num = (el: Element, name: string) => parseFloat(el.getAttribute(name) || '0') || 0;
      let box = { x: 0, y: 0, width: 0 };
      const shape = node.querySelector(':scope > rect, :scope > polygon, :scope > circle, :scope > ellipse, rect, polygon');
      if (shape?.tagName === 'rect') box = { x: num(shape, 'x'), y: num(shape, 'y'), width: num(shape, 'width') };
      else if (shape?.tagName === 'polygon') {
        const pts = (shape.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
        const xs = pts.filter((_, i) => i % 2 === 0);
        const ys = pts.filter((_, i) => i % 2 === 1);
        if (xs.length) box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs) };
      } else if (shape) {
        const r = num(shape, 'r') || num(shape, 'rx');
        box = { x: num(shape, 'cx') - r, y: num(shape, 'cy') - (num(shape, 'r') || num(shape, 'ry')), width: 2 * r };
      }
      if (!box.width) {
        try {
          const b = (node as SVGGElement).getBBox();
          box = { x: b.x, y: b.y, width: b.width };
        } catch {
          return;
        }
      }
      if (!box.width) return;
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', `lint-problem-marker lint-problem-${severity}`);
      g.setAttribute('transform', `translate(${box.x + box.width - 2}, ${box.y + 2})`);
      const title = document.createElementNS(ns, 'title');
      title.textContent = severity === 'error' ? 'Problem (error): see the Problems tab' : 'Problem (warning): see the Problems tab';
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('r', '9');
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.textContent = '!';
      g.append(title, circle, text);
      node.appendChild(g);
    });
  }, [renderedSvg, problemMarkers]);

  // Custom transition line styles, applied to the rendered paths (resolved like a click on the path)
  useEffect(() => {
    const svg = renderedSvg;
    if (!svg) return;
    const styles = customEdgeStyles || {};
    const hasAny = Object.keys(styles).length > 0;
    if (!hasAny && !svg.querySelector('path[data-tc-edge-styled], g.edgeLabel[data-tc-label-styled]')) return;
    applyEdgeStylesToSvg(svg, (path) => {
      if (!hasAny) return undefined;
      const edge = resolveEdgeFromElement(path, svg, availableEdges);
      return edge ? styles[edge.id] : undefined;
    });
  }, [renderedSvg, customEdgeStyles, availableEdges]);

  const panToState = useCallback((stateId: string, timestamp?: number) => {
    if (!stateId) return;

    if (timestamp) {
      lastHandledFocusRequestTimestampRef.current = timestamp;
    }

    // Cancel any previous pending jump attempts
    if (jumpAttemptTimerRef.current) {
      cancelAnimationFrame(jumpAttemptTimerRef.current);
      jumpAttemptTimerRef.current = null;
    }

    const startTime = performance.now();
    const maxWaitMs = 2500; // Allow sufficient time for async Mermaid rendering if tab just mounted

    const attempt = () => {
      if (!containerRef.current) {
        if (performance.now() - startTime < maxWaitMs) {
          jumpAttemptTimerRef.current = requestAnimationFrame(attempt);
        }
        return;
      }
      const svg = getDiagramSvg();
      if (!svg) {
        if (performance.now() - startTime < maxWaitMs) {
          jumpAttemptTimerRef.current = requestAnimationFrame(attempt);
        }
        return;
      }
      const nodeEl =
        findNodeElement(svg as SVGSVGElement, stateId) ||
        (svg.querySelector(`g.node[data-state-id="${stateId}"]`) as SVGGElement | null);

      if (!nodeEl) {
        if (performance.now() - startTime < maxWaitMs) {
          jumpAttemptTimerRef.current = requestAnimationFrame(attempt);
        }
        return;
      }

      // Check if element has non-zero size (ensure layout is computed)
      const rect = nodeEl.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        if (performance.now() - startTime < maxWaitMs) {
          jumpAttemptTimerRef.current = requestAnimationFrame(attempt);
        }
        return;
      }

      // Center the node in canvas viewport with smooth animated glide and trigger visual highlight animation
      panToElement(nodeEl);
      triggerNodeJumpHighlight(nodeEl);
    };

    attempt();
  }, [getDiagramSvg, panToElement, triggerNodeJumpHighlight]);

  const handleSelectState = (stateId: string | null, label?: string) => {
    if (onSelectStateProp) {
      onSelectStateProp(stateId, label);
    } else {
      setInternalSelectedStateId(stateId);
      if (label) setInternalSelectedStateLabel(label);
    }
    // Selecting a state leaves the layout as it is (no Method Editor brought forward: the canvas stays where it is);
    // the Method Editor follows the selection when it is shown. Without the dock (standalone viewer): the inspector.
    if (stateId && !onOpenInspectorPanel) setIsInspectorOpen(true);
  };

  const handleCloseInspector = () => {
    setIsInspectorOpen(false);
    if (onSelectStateProp) {
      onSelectStateProp(null);
    } else {
      setInternalSelectedStateId(null);
    }
  };

  // The State Style window belongs to the selected state: selecting another state or clearing the selection closes it
  useEffect(() => {
    if (stylePopup && effectiveSelectedStateId !== stylePopup.stateId) setStylePopup(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSelectedStateId]);

  /** Opens the State Style window beside the state's node (or at the canvas corner if it is not rendered) */
  const openStylePopup = (stateId: string) => {
    const nodeEl = containerRef.current?.querySelector(`#mermaid-diagram-svg-container g.node[data-state-id="${stateId}"]`);
    const r = nodeEl?.getBoundingClientRect();
    setActiveConditionOverlay(null);
    setStylePopup({ stateId, anchorRect: r ? { left: r.left, right: r.right, top: r.top } : undefined });
  };

  const handleToggleInspector = () => {
    if (onOpenInspectorPanel) {
      if (stylePopup) {
        setStylePopup(null);
        return;
      }
      const stateId = effectiveSelectedStateId || availableStates[0]?.id;
      if (!stateId) return;
      if (!effectiveSelectedStateId) handleSelectState(stateId, availableStates[0].label);
      openStylePopup(stateId);
      return;
    }
    if (isInspectorOpen) {
      handleCloseInspector();
    } else {
      setIsInspectorOpen(true);
      if (!effectiveSelectedStateId && availableStates.length > 0) {
        handleSelectState(availableStates[0].id, availableStates[0].label);
      }
    }
  };

  useEffect(() => {
    if (focusStateRequest?.stateId) {
      if (
        focusStateRequest.timestamp &&
        lastHandledFocusRequestTimestampRef.current === focusStateRequest.timestamp
      ) {
        return;
      }
      lastHandledFocusRequestTimestampRef.current = focusStateRequest.timestamp || Date.now();
      panToState(focusStateRequest.stateId, focusStateRequest.timestamp);
    }
  }, [focusStateRequest, panToState]);

  useEffect(() => {
    return () => {
      if (jumpAttemptTimerRef.current) cancelAnimationFrame(jumpAttemptTimerRef.current);
      if (jumpHighlightTimerRef.current) clearTimeout(jumpHighlightTimerRef.current);
      if (jumpTransitionTimerRef.current) clearTimeout(jumpTransitionTimerRef.current);
    };
  }, []);

  const handleStyleChange = (stateId: string, style: NodeDisplayProperties) => {
    // 1. Immediately update DOM element in SVG for instantaneous live response
    if (containerRef.current) {
      const svg = getDiagramSvg();
      if (svg) {
        const nodeEl = svg.querySelector(`g.node[data-state-id="${stateId}"]`);
        if (nodeEl) {
          const shapes = nodeEl.querySelectorAll('rect, polygon, circle, path.basic');
          shapes.forEach((s) => {
            if (style.fill) (s as HTMLElement).style.setProperty('fill', style.fill, 'important');
            else (s as HTMLElement).style.removeProperty('fill');

            if (style.stroke) (s as HTMLElement).style.setProperty('stroke', style.stroke, 'important');
            else (s as HTMLElement).style.removeProperty('stroke');

            if (style.strokeWidth) (s as HTMLElement).style.setProperty('stroke-width', style.strokeWidth, 'important');
            else (s as HTMLElement).style.removeProperty('stroke-width');
          });
          const textEls = nodeEl.querySelectorAll('.nodeLabel, span, p, text, div');
          textEls.forEach((t) => {
            if (style.color) (t as HTMLElement).style.setProperty('color', style.color, 'important');
            else (t as HTMLElement).style.removeProperty('color');
          });
        }
      }
    }

    // 2. Propagate to parent state & Mermaid generator
    if (onStyleChangeProp) {
      onStyleChangeProp(stateId, style);
    } else {
      setInternalCustomStyles((prev) => ({
        ...prev,
        [stateId]: style,
      }));
    }
  };

  const handleResetStateStyle = (stateId: string) => {
    if (onResetStateStyleProp) {
      onResetStateStyleProp(stateId);
    } else {
      setInternalCustomStyles((prev) => {
        const next = { ...prev };
        delete next[stateId];
        return next;
      });
    }
  };

  const handleClearAllCustomStyles = () => {
    if (onClearAllCustomStylesProp) {
      onClearAllCustomStylesProp();
    } else {
      setInternalCustomStyles({});
    }
  };

  const customizedStatesCount = Object.values(effectiveCustomStyles).filter(
    (s) => s.fill || s.color || s.stroke || s.strokeWidth
  ).length;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    edgeSelectedBeforePressRef.current = false;
    edgePressedRef.current = false;

    // Cancel any active smooth scroll animation immediately on mouse interaction
    if (activePanAnimationRef.current) {
      cancelAnimationFrame(activePanAnimationRef.current);
      activePanAnimationRef.current = null;
      setPan({ x: Math.round(currentPanRef.current.x), y: Math.round(currentPanRef.current.y) });
    }

    // Reset any active jump transition immediately on mouse interaction
    const wrapper = containerRef.current?.querySelector('#mermaid-svg-wrapper') as HTMLElement | null;
    if (wrapper) {
      wrapper.style.transition = 'none';
    }

    const target = e.target as Element;
    // If clicking inside inspector, toolbar, context menu, dialogs, or detail overlay, don't initiate drag
    if (
      target.closest('#state-style-inspector, #state-style-popup') ||
      target.closest('#mermaid-toolbar') ||
      target.closest('#diagram-context-menu') ||
      target.closest('#note-dialog-overlay') ||
      target.closest('#notes-drawer-overlay') ||
      target.closest('#edge-condition-detail-overlay, #transition-guard-inspector') ||
      target.closest('#transition-guard-inspector') ||
      target.closest('#complexity-heatmap-panel') ||
      target.closest('#state-machine-stats-panel') ||
      target.closest('#diagram-search-panel')
    ) {
      return;
    }

    setHoveredEdgeCondition(null);

    // A0. Check if user clicked on a priority badge or edge label -> record pending click and do not initiate drag/pan
    const labelOrBadgeEl = (target.closest('.tc-priority-badge') ||
      target.closest('.priority-badge') ||
      target.closest('g.edgeLabel') ||
      target.closest('.clickable-edge-label') ||
      target.closest('.tc-interactive-edge-label')) as HTMLElement | SVGElement | null;
    if (labelOrBadgeEl) {
      pendingLabelBadgeClickRef.current = {
        el: labelOrBadgeEl,
        clientX: e.clientX,
        clientY: e.clientY,
      };
      // An edge label can also be dragged away from its default spot (it only counts as a drag after 3px)
      const labelEl = labelOrBadgeEl.closest('g.edgeLabel') as SVGGElement | null;
      const labelPathId = labelEl?.getAttribute('data-linked-path-id');
      if (labelEl && labelPathId) {
        isDraggingEdgeHandleRef.current = true;
        draggedEdgeIdRef.current = labelPathId;
        draggedHandleTypeRef.current = 'label';
        dragUnitScaleRef.current = getSvgUnitScale(labelEl.parentElement, zoom);
        edgeHandleDragStartPosRef.current = { x: e.clientX, y: e.clientY };
        edgeMovedRef.current = false;
        edgeInitialOffsetRef.current = { ...(currentEdgeOffsetsRef.current[labelPathId] || { x: 0, y: 0 }) };
        draggedLabelRef.current = { el: labelEl, ...parseTranslation(labelEl.getAttribute('transform') || '') };
      }
      return;
    }

    // A. Check if user clicked on an edge handle (waypoint, start endpoint, or end endpoint)
    const handleEl = (target.closest('g.tc-edge-handle[data-handle-type]') ||
      target.closest('[data-handle-type]')) as SVGGElement | null;
    if (handleEl) {
      const eId = handleEl.getAttribute('data-edge-id');
      const hType = handleEl.getAttribute('data-handle-type') as 'start' | 'end' | 'mid';
      if (eId && hType) {
        isDraggingEdgeHandleRef.current = true;
        draggedEdgeIdRef.current = eId;
        dragUnitScaleRef.current = getSvgUnitScale(handleEl.parentElement, zoom);
        draggedHandleTypeRef.current = hType;
        edgeHandleDragStartPosRef.current = { x: e.clientX, y: e.clientY };
        edgeMovedRef.current = false;
        const currentEdgeOffset = currentEdgeOffsetsRef.current[eId] || { x: 0, y: 0 };
        edgeInitialOffsetRef.current = { ...currentEdgeOffset };
        setIsNodeDragging(true);
        return;
      }
    }

    // B. Check if user clicked on a state node
    const nodeEl = (target.closest('g.clickable-state-node') ||
      target.closest('g.node[data-state-id]') ||
      target.closest('g.node')) as SVGGElement | null;
    if (nodeEl && !nodeEl.closest('g.note') && !nodeEl.classList.contains('note')) {
      let stateId = nodeEl.getAttribute('data-state-id');
      if (!stateId) {
        const rawId = nodeEl.getAttribute('id') || '';
        stateId = cleanNodeId(rawId);
        if (!stateId && (rawId.includes('root_start') || rawId.includes('startNode'))) {
          stateId = '[*]';
        }
      }
      if (stateId && !stateId.startsWith('note_')) {
        nodeSelectedBeforePressRef.current = effectiveSelectedStateId === stateId;
        isDraggingNodeRef.current = true;
        draggedNodeIdRef.current = stateId;
        draggedNodeElRef.current = nodeEl;
        dragUnitScaleRef.current = getSvgUnitScale(nodeEl.parentElement, zoom);
        nodeDragStartPosRef.current = { x: e.clientX, y: e.clientY };
        nodeMovedRef.current = false;
        const currentOffset = effectiveNodeOffsets[stateId] || { x: 0, y: 0 };
        nodeInitialOffsetRef.current = { ...currentOffset };

        const svgEl = getDiagramSvg();
        const geom = getNodeGeometry(nodeEl, svgEl);
        nodeInitialCenterRef.current = {
          x: geom.origCenterX + currentOffset.x,
          y: geom.origCenterY + currentOffset.y,
          origCenterX: geom.origCenterX,
          origCenterY: geom.origCenterY,
        };

        nodeEl.classList.add('dragging-state-node');
        setIsNodeDragging(true);
        return;
      }
    }

    // C. Check if user clicked on an edge path or hitbox
    const svg = getDiagramSvg();
    let clickedEdge = resolveEdgeFromElement(target, svg, availableEdges);
    if (!clickedEdge && svg && (target.tagName.toLowerCase() === 'svg' || target.closest('svg'))) {
      clickedEdge = findEdgeNearPoint(svg, e.clientX, e.clientY, availableEdges, 24);
    }
    if (clickedEdge && clickedEdge.from && clickedEdge.to && clickedEdge.from.trim() && clickedEdge.to.trim()) {
      edgeSelectedBeforePressRef.current = selectedEdge?.id === clickedEdge.id;
      edgePressedRef.current = true;
      setSelectedEdge(clickedEdge);
      if (svg) {
        applyDiagramOffsetsToSvg(
          svg,
          currentNodeOffsetsRef.current,
          currentEdgeOffsetsRef.current,
          null,
          clickedEdge.id,
          layoutEngine,
          flowchartCurve
        );
      }
      // Key the offset by the path id, like the edge handles do, so line drags and handle drags add up
      const grabbedPathId = target.closest('path')?.getAttribute('data-path-id') || null;
      const offsetKey = grabbedPathId || clickedEdge.id;
      isDraggingEdgeHandleRef.current = true;
      draggedEdgeIdRef.current = offsetKey;
      draggedHandleTypeRef.current = 'mid';
      dragUnitScaleRef.current = getSvgUnitScale(
        target.closest('path')?.parentElement ?? svg?.querySelector('g.edgePaths') ?? null,
        zoom
      );
      edgeHandleDragStartPosRef.current = { x: e.clientX, y: e.clientY };
      edgeMovedRef.current = false;
      const currentEdgeOffset =
        currentEdgeOffsetsRef.current[offsetKey] || currentEdgeOffsetsRef.current[clickedEdge.id] || { x: 0, y: 0 };
      edgeInitialOffsetRef.current = { ...currentEdgeOffset };
      setIsNodeDragging(true);
      return;
    }

    // Otherwise initiate canvas panning
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // 1. Dragging edge handle (Start endpoint, End endpoint, or Midpoint)
    if (isDraggingEdgeHandleRef.current && draggedEdgeIdRef.current && draggedHandleTypeRef.current) {
      const edgeId = draggedEdgeIdRef.current;
      const handleType = draggedHandleTypeRef.current;
      const screenDx = e.clientX - edgeHandleDragStartPosRef.current.x;
      const screenDy = e.clientY - edgeHandleDragStartPosRef.current.y;

      if (!edgeMovedRef.current && Math.hypot(screenDx, screenDy) >= 3) {
        edgeMovedRef.current = true;
        // A label press only becomes a drag here (a plain click must not toggle the dragging state)
        if (handleType === 'label') setIsNodeDragging(true);
      }

      if (edgeMovedRef.current) {
        const canvasDx = screenDx / dragUnitScaleRef.current.x;
        const canvasDy = screenDy / dragUnitScaleRef.current.y;
        const initial = edgeInitialOffsetRef.current;

        const nextOffset: EdgeOffset = { ...initial };
        if (handleType === 'start') {
          nextOffset.startDx = Math.round((initial.startDx || 0) + canvasDx);
          nextOffset.startDy = Math.round((initial.startDy || 0) + canvasDy);
        } else if (handleType === 'end') {
          nextOffset.endDx = Math.round((initial.endDx || 0) + canvasDx);
          nextOffset.endDy = Math.round((initial.endDy || 0) + canvasDy);
        } else if (handleType === 'mid') {
          nextOffset.x = Math.round(initial.x + canvasDx);
          nextOffset.y = Math.round(initial.y + canvasDy);
        } else if (handleType === 'label') {
          nextOffset.labelDx = Math.round((initial.labelDx || 0) + canvasDx);
          nextOffset.labelDy = Math.round((initial.labelDy || 0) + canvasDy);
        }

        currentEdgeOffsetsRef.current = {
          ...currentEdgeOffsetsRef.current,
          [edgeId]: nextOffset,
        };

        const draggedLabel = draggedLabelRef.current;
        if (handleType === 'label' && draggedLabel) {
          // The edge itself does not change: move just the label element, at most once per frame
          const tx = draggedLabel.x + (nextOffset.labelDx || 0) - (initial.labelDx || 0);
          const ty = draggedLabel.y + (nextOffset.labelDy || 0) - (initial.labelDy || 0);
          if (labelDragFrameRef.current !== null) cancelAnimationFrame(labelDragFrameRef.current);
          labelDragFrameRef.current = requestAnimationFrame(() => {
            labelDragFrameRef.current = null;
            draggedLabel.el.setAttribute('transform', `translate(${tx}, ${ty})`);
          });
        } else if (containerRef.current) {
          // Once per animation frame, with the latest offset, re-routing only the dragged edge (the whole diagram
          // is updated when the drag ends)
          const activeEdgeId = selectedEdge?.id || edgeId;
          applyEdgeDragFrameRef.current = () => {
            const svg = getDiagramSvg();
            if (!svg) return;
            applyDiagramOffsetsToSvg(
              svg,
              currentNodeOffsetsRef.current,
              currentEdgeOffsetsRef.current,
              null,
              activeEdgeId,
              layoutEngine,
              flowchartCurve,
              { onlyEdgeId: edgeId }
            );
          };
          if (edgeDragFrameRef.current === null) {
            edgeDragFrameRef.current = requestAnimationFrame(() => {
              edgeDragFrameRef.current = null;
              applyEdgeDragFrameRef.current?.();
            });
          }
        }
      }
      return;
    }

    // 2. Dragging a state node: applied once per animation frame with the latest pointer position, re-routing
    // only the edges attached to the dragged node (the full re-route runs when the drag ends)
    if (isDraggingNodeRef.current && draggedNodeIdRef.current) {
      pendingNodeDragPointRef.current = { x: e.clientX, y: e.clientY };
      applyNodeDragFrameRef.current = () => applyNodeDragAt(pendingNodeDragPointRef.current);
      if (nodeDragFrameRef.current === null) {
        nodeDragFrameRef.current = requestAnimationFrame(() => {
          nodeDragFrameRef.current = null;
          applyNodeDragFrameRef.current?.();
        });
      }
      return;
    }

    // 3. Panning canvas
    handlePanMove(e);
  };

  const applyNodeDragAt = (point: { x: number; y: number } | null) => {
    if (!point || !isDraggingNodeRef.current || !draggedNodeIdRef.current) return;
    {
      const stateId = draggedNodeIdRef.current;
      const screenDx = point.x - nodeDragStartPosRef.current.x;
      const screenDy = point.y - nodeDragStartPosRef.current.y;

      if (Math.hypot(screenDx, screenDy) >= 3) {
        nodeMovedRef.current = true;
      }

      if (nodeMovedRef.current) {
        const canvasDx = screenDx / dragUnitScaleRef.current.x;
        const canvasDy = screenDy / dragUnitScaleRef.current.y;

        let newOffset = {
          x: Math.round(nodeInitialOffsetRef.current.x + canvasDx),
          y: Math.round(nodeInitialOffsetRef.current.y + canvasDy),
        };

        if (snapConfig.enabled && nodeInitialCenterRef.current) {
          const rawCenterX = nodeInitialCenterRef.current.x + canvasDx;
          const rawCenterY = nodeInitialCenterRef.current.y + canvasDy;

          const snapRes = calculateSnappedPosition(
            rawCenterX,
            rawCenterY,
            stateId,
            canvasNodePositions,
            snapConfig
          );

          // Only re-render (snap guides) when the snapped position or alignment actually changes
          setActiveSnapResult((prev) =>
            prev &&
            prev.x === snapRes.x &&
            prev.y === snapRes.y &&
            prev.snapSourceX === snapRes.snapSourceX &&
            prev.snapSourceY === snapRes.snapSourceY &&
            prev.alignedNodeX?.id === snapRes.alignedNodeX?.id &&
            prev.alignedNodeY?.id === snapRes.alignedNodeY?.id
              ? prev
              : snapRes
          );

          newOffset = {
            x: Math.round(snapRes.x - nodeInitialCenterRef.current.origCenterX),
            y: Math.round(snapRes.y - nodeInitialCenterRef.current.origCenterY),
          };
        } else {
          setActiveSnapResult((prev) => (prev === null ? prev : null));
        }

        currentNodeOffsetsRef.current = {
          ...currentNodeOffsetsRef.current,
          [stateId]: newOffset,
        };

        if (containerRef.current) {
          const svg = getDiagramSvg();
          if (svg) {
            applyDiagramOffsetsToSvg(
              svg,
              currentNodeOffsetsRef.current,
              currentEdgeOffsetsRef.current,
              null,
              selectedEdge?.id,
              layoutEngine,
              flowchartCurve,
              { onlyNodeId: stateId }
            );
          }
        }
      }
    }
  };

  const handlePanMove = (e: React.MouseEvent) => {
    // 3. Panning canvas
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
      if (hoveredComplexityMetric) {
        setHoveredComplexityMetric(null);
      }
      if (hoveredEdgeCondition) {
        setHoveredEdgeCondition(null);
      }
      return;
    }

    const target = e.target as Element;

    // 3.5 Hover tracking for Edge Label Guard Condition Visual Badge
    const labelOrBadgeEl = (target?.closest('g.edgeLabel') ||
      target?.closest('.clickable-edge-label') ||
      target?.closest('.tc-interactive-edge-label') ||
      target?.closest('.tc-priority-badge') ||
      target?.closest('.priority-badge')) as HTMLElement | SVGElement | null;

    if (
      labelOrBadgeEl &&
      !isDraggingNodeRef.current &&
      !isDraggingEdgeHandleRef.current &&
      !activeConditionOverlay &&
      !isInspectorOpen
    ) {
      const svg = getDiagramSvg();
      const edge = resolveEdgeFromElement(labelOrBadgeEl, svg, availableEdges);
      if (edge && edge.from && edge.to) {
        let fullCond = getFullGuardCondition(edge, labelOrBadgeEl);
        if ((fullCond.includes('...') || fullCond.endsWith('▾')) && tcPouContent) {
          const fromPou = tryExtractGuardFromPou(tcPouContent, edge.from, edge.to);
          if (fromPou) {
            fullCond = fromPou;
          }
        }
        const rect = labelOrBadgeEl.getBoundingClientRect();
        const parsed = parseConditionClauses(fullCond);

        setHoveredEdgeCondition({
          edge,
          fullCondition: fullCond,
          anchorX: e.clientX,
          anchorY: e.clientY,
          labelRect: rect,
          priority: edge.priority,
          clauses: parsed.clauses,
          hasCompound: parsed.clauses.length > 1,
        });

        if (hoveredComplexityMetric) {
          setHoveredComplexityMetric(null);
        }
        return;
      } else if (hoveredEdgeCondition) {
        setHoveredEdgeCondition(null);
      }
    } else if (hoveredEdgeCondition) {
      setHoveredEdgeCondition(null);
    }

    // 4. Hover tracking for Complexity Heat-map Tooltip & Refactor Badges
    const shouldTrackComplexityHover =
      (isHeatmapActive || showComplexityBadges) &&
      !isDraggingNodeRef.current &&
      !isDraggingEdgeHandleRef.current;

    if (shouldTrackComplexityHover) {
      const nodeEl = target?.closest('g.node') as HTMLElement | SVGElement | null;
      if (nodeEl) {
        if (hoveredEdgeCondition) {
          setHoveredEdgeCondition(null);
        }
        const sId =
          nodeEl.getAttribute('data-state-id') ||
          nodeEl.id?.replace(/^flowchart-/, '').replace(/-\d+$/, '');
        if (sId) {
          const metric =
            complexityHeatmapResult.metrics.get(sId) ||
            complexityHeatmapResult.metricsList.find(
              (m) => m.stateId.toLowerCase() === sId.toLowerCase()
            );
          const isEligibleForTooltip =
            Boolean(metric && (
              isHeatmapActive
                ? !heatmapOnlyRefactor || metric.refactorNeeded
                : metric.score >= complexityThreshold || metric.refactorNeeded
            ));

          if (metric && isEligibleForTooltip) {
            setHoveredComplexityMetric({
              metric,
              anchorX: e.clientX,
              anchorY: e.clientY,
            });
          } else if (hoveredComplexityMetric) {
            setHoveredComplexityMetric(null);
          }
        } else if (hoveredComplexityMetric) {
          setHoveredComplexityMetric(null);
        }
      } else if (hoveredComplexityMetric) {
        setHoveredComplexityMetric(null);
      }
    } else if (hoveredComplexityMetric) {
      setHoveredComplexityMetric(null);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    // Apply the latest pending node-drag position before finishing the drag
    if (nodeDragFrameRef.current !== null) {
      cancelAnimationFrame(nodeDragFrameRef.current);
      nodeDragFrameRef.current = null;
      applyNodeDragFrameRef.current?.();
    }
    flushLabelDrag();
    // The edge drag's last frame, if it has not run yet
    if (edgeDragFrameRef.current !== null) {
      cancelAnimationFrame(edgeDragFrameRef.current);
      edgeDragFrameRef.current = null;
      applyEdgeDragFrameRef.current?.();
    }
    applyEdgeDragFrameRef.current = null;
    // 0. Check pending click on priority badge or edge label
    if (pendingLabelBadgeClickRef.current) {
      const { el, clientX, clientY } = pendingLabelBadgeClickRef.current;
      pendingLabelBadgeClickRef.current = null;
      const dx = Math.abs(e.clientX - clientX);
      const dy = Math.abs(e.clientY - clientY);
      const labelDragged = draggedHandleTypeRef.current === 'label' && edgeMovedRef.current;
      if (labelDragged) {
        // Commit the label move below; the click that follows must not select the edge / open the inspector
        edgeClickHandledRef.current = true;
        setTimeout(() => {
          edgeClickHandledRef.current = false;
        }, 0);
      } else if (draggedHandleTypeRef.current === 'label') {
        isDraggingEdgeHandleRef.current = false;
        draggedEdgeIdRef.current = null;
        draggedHandleTypeRef.current = null;
      }
      if (!labelDragged && dx < 10 && dy < 10) {
        const svg = getDiagramSvg();
        const edge = resolveEdgeFromElement(el, svg, availableEdges);
        if (edge && edge.from && edge.to) {
          const rect = el.getBoundingClientRect();
          activateEdgeClick(edge, { x: rect.left + rect.width / 2, y: rect.top }, selectedEdge?.id === edge.id);
          edgeClickHandledRef.current = true;
          return;
        }
      }
    }

    // 1. Released edge handle
    if (isDraggingEdgeHandleRef.current) {
      const edgeId = draggedEdgeIdRef.current;
      const wasMoved = edgeMovedRef.current;
      isDraggingEdgeHandleRef.current = false;
      draggedEdgeIdRef.current = null;
      draggedHandleTypeRef.current = null;
      setIsNodeDragging(false);

      if (wasMoved && edgeId) {
        setEdgeOffsets({ ...currentEdgeOffsetsRef.current });
        return;
      }
    }

    // 2. Released while dragging a state node
    if (isDraggingNodeRef.current) {
      const stateId = draggedNodeIdRef.current;
      const wasMoved = nodeMovedRef.current;
      if (draggedNodeElRef.current) {
        draggedNodeElRef.current.classList.remove('dragging-state-node');
      }
      isDraggingNodeRef.current = false;
      draggedNodeIdRef.current = null;
      draggedNodeElRef.current = null;
      nodeInitialCenterRef.current = null;
      setActiveSnapResult(null);
      setIsNodeDragging(false);

      if (wasMoved && stateId) {
        const nextOffsets = { ...currentNodeOffsetsRef.current };
        setNodeOffsets(nextOffsets);
        if (onNodeOffsetsChange) {
          onNodeOffsetsChange(nextOffsets);
        }
        if (containerRef.current) {
          const svg = getDiagramSvg();
          if (svg) {
            const nextPositions = extractCanvasNodePositions(svg, nextOffsets);
            setCanvasNodePositions(nextPositions);
            if (nextPositions[stateId]) {
              lockedNodePositionsRef.current[stateId] = {
                centerX: nextPositions[stateId].centerX,
                centerY: nextPositions[stateId].centerY,
              };
            }
            if (onCanvasPositionsChange) {
              onCanvasPositionsChange(nextPositions);
            }
          }
        }
        return;
      }

      // Click without drag -> select state and open inspector
      if (!wasMoved && stateId) {
        // Connect mode: this state is the new transition's target
        if (connectFrom && onConnectTo) {
          if (stateId !== '[*]') onConnectTo(stateId);
          return;
        }
        const onBadge = !!(e.target as Element).closest?.('.tc-refactor-flag-badge, .tc-complexity-badge');
        // Second click on the selected state toggles its State Style window (a badge keeps its own action)
        if (nodeSelectedBeforePressRef.current && !onBadge) {
          if (stylePopup?.stateId === stateId) setStylePopup(null);
          else openStylePopup(stateId);
          return;
        }
        const targetNode = containerRef.current?.querySelector(`g.node[data-state-id="${stateId}"]`);
        const stateLabel = targetNode?.getAttribute('data-state-label') || stateId;
        handleSelectState(stateId, stateLabel);
        setSelectedEdge(null);
        // Clicking a node's complexity / refactor badge also opens the Complexity Heat-Map
        if (onBadge) {
          setIsHeatmapPanelOpen(true);
        }
        return;
      }

      // Dragged node -> keep state selected so connected edges remain highlighted
      if (wasMoved && stateId) {
        const targetNode = containerRef.current?.querySelector(`g.node[data-state-id="${stateId}"]`);
        const stateLabel = targetNode?.getAttribute('data-state-label') || stateId;
        handleSelectState(stateId, stateLabel);
        setSelectedEdge(null);
      }
    }

    // 3. Released canvas panning
    setIsDragging(false);
    const dx = Math.abs(e.clientX - mouseDownPosRef.current.x);
    const dy = Math.abs(e.clientY - mouseDownPosRef.current.y);

    // If mouse moved less than 6 pixels, treat as a click
    if (dx < 6 && dy < 6) {
      const target = e.target as Element;
      // If clicking inside inspector, toolbar, context menu, dialogs, or note overlays, don't change selection
      if (
        target.closest('#state-style-inspector, #state-style-popup') ||
        target.closest('#mermaid-toolbar') ||
        target.closest('#diagram-context-menu') ||
        target.closest('#note-dialog-overlay') ||
        target.closest('#notes-drawer-overlay') ||
        target.closest('#mermaid-note-overlays-layer') ||
        target.closest('#edge-condition-detail-overlay, #transition-guard-inspector')
      ) {
        return;
      }

      // Check if user clicked an SVG note
      const svgNote = target.closest('g.note');
      if (svgNote) {
        const text = svgNote.textContent?.trim() || '';
        const matchingNodeId = Object.keys(effectiveNotes.nodes || {}).find(
          (k) => (effectiveNotes.nodes[k] || '').trim() === text || text.includes((effectiveNotes.nodes[k] || '').trim())
        );
        if (matchingNodeId) {
          handleOpenAddNote({
            type: 'node',
            id: matchingNodeId,
            label: matchingNodeId,
            note: effectiveNotes.nodes[matchingNodeId],
          });
          return;
        }
      }

      // Check if user clicked on a state node
      const nodeEl = (target.closest('g.clickable-state-node') ||
        target.closest('g.node[data-state-id]') ||
        target.closest('g.node')) as SVGGElement | null;
      if (nodeEl && !nodeEl.closest('g.note') && !nodeEl.classList.contains('note')) {
        let stateId = nodeEl.getAttribute('data-state-id');
        if (!stateId) {
          const rawId = nodeEl.getAttribute('id') || '';
          stateId = cleanNodeId(rawId);
          if (!stateId && (rawId.includes('root_start') || rawId.includes('startNode'))) {
            stateId = '[*]';
          }
        }
        if (stateId && !stateId.startsWith('note_')) {
          // Connect mode: this state is the new transition's target
          if (connectFrom && onConnectTo) {
            if (stateId !== '[*]') onConnectTo(stateId);
            return;
          }
          const stateLabel =
            nodeEl.getAttribute('data-state-label') ||
            nodeEl.querySelector('.nodeLabel')?.textContent?.trim() ||
            stateId;
          handleSelectState(stateId, stateLabel);
          triggerNodeJumpHighlight(nodeEl);
          setSelectedEdge(null);
          setActiveConditionOverlay(null);
          if (target.closest('.tc-refactor-flag-badge, .tc-complexity-badge')) {
            setIsHeatmapPanelOpen(true);
          }
          return;
        }
      }

      // Check if user clicked on an edge path, label, or priority badge
      const svg = getDiagramSvg();
      let clickedEdge = resolveEdgeFromElement(target, svg, availableEdges);
      if (!clickedEdge && svg && (target.tagName.toLowerCase() === 'svg' || target.closest('svg'))) {
        clickedEdge = findEdgeNearPoint(svg, e.clientX, e.clientY, availableEdges, 24);
      }
      if (clickedEdge && clickedEdge.from && clickedEdge.to && clickedEdge.from.trim() && clickedEdge.to.trim()) {
        // First click selects & highlights the transition; clicking the selected one again opens the inspector
        const labelOrBadgeEl = (target.closest('.tc-priority-badge') ||
          target.closest('.priority-badge') ||
          target.closest('g.edgeLabel') ||
          target.closest('.clickable-edge-label') ||
          target.closest('.tc-interactive-edge-label')) as HTMLElement | SVGElement | null;
        const rect = labelOrBadgeEl?.getBoundingClientRect() || { left: e.clientX - 10, width: 20, top: e.clientY - 10 };
        activateEdgeClick(
          clickedEdge,
          { x: rect.left + rect.width / 2, y: rect.top },
          edgePressedRef.current ? edgeSelectedBeforePressRef.current : selectedEdge?.id === clickedEdge.id
        );
        edgeClickHandledRef.current = true;

        if (svg) {
          applyDiagramOffsetsToSvg(
            svg,
            currentNodeOffsetsRef.current,
            currentEdgeOffsetsRef.current,
            null,
            clickedEdge.id,
            layoutEngine,
            flowchartCurve
          );
        }
        return;
      }

      // Connect mode: a click on the empty canvas cancels
      if (connectFrom) {
        onConnectCancel?.();
        return;
      }

      // Clicked on empty canvas background -> clear the selected state, its highlighted transitions,
      // the selected edge and the condition overlay (editor tabs keep showing the last selected state)
      if (effectiveSelectedStateId) handleSelectState(null);
      setSelectedEdge(null);
      setActiveConditionOverlay(null);
      if (svg) {
        applyDiagramOffsetsToSvg(
          svg,
          currentNodeOffsetsRef.current,
          currentEdgeOffsetsRef.current,
          null,
          null,
          layoutEngine,
          flowchartCurve
        );
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const target = e.target as Element;

    if (
      target.closest('#complexity-heatmap-panel') ||
      target.closest('#state-machine-stats-panel') ||
      target.closest('#diagram-search-panel') ||
      target.closest('#state-style-inspector, #state-style-popup') ||
      target.closest('#transition-guard-inspector') ||
      target.closest('#edge-condition-detail-overlay')
    ) {
      return;
    }

    // 0. Clicked on a note overlay card
    const noteCardEl = target.closest('[id^="note-overlay-"]');
    if (noteCardEl) {
      const noteCardId = noteCardEl.id.replace('note-overlay-', '');
      const isNodeNote = effectiveNotes.nodes?.[noteCardId] !== undefined;
      const isEdgeNote = effectiveNotes.edges?.[noteCardId] !== undefined;
      if (isNodeNote) {
        const state = availableStates.find((s) => s.id === noteCardId || cleanNodeId(s.id) === cleanNodeId(noteCardId));
        const menuTarget: ContextMenuTarget = {
          type: 'node',
          id: noteCardId,
          label: state?.label || noteCardId,
          note: effectiveNotes.nodes[noteCardId],
        };
        setContextMenuState({ x: e.clientX, y: e.clientY, target: menuTarget });
        return;
      }
      if (isEdgeNote) {
        const edge = availableEdges.find(
          (e) =>
            e.id === noteCardId ||
            `${e.from}->${e.to}` === noteCardId ||
            (e.pathId && e.pathId === noteCardId)
        );
        const menuTarget: ContextMenuTarget = {
          type: 'edge',
          id: edge?.id || noteCardId,
          pathId: edge?.pathId,
          from: edge?.from || '',
          to: edge?.to || '',
          label: edge?.label,
          note: effectiveNotes.edges[noteCardId] || (edge ? effectiveNotes.edges[edge.id] : ''),
        };
        setContextMenuState({ x: e.clientX, y: e.clientY, target: menuTarget });
        return;
      }
    }

    // 1. Clicked on a state node
    const nodeEl = (target.closest('g.clickable-state-node') ||
      target.closest('g.node[data-state-id]') ||
      target.closest('g.node')) as SVGGElement | null;
    if (nodeEl) {
      const rawStateId =
        nodeEl.getAttribute('data-state-id') ||
        nodeEl.id.replace(/^flowchart-/, '').replace(/-\d+$/, '');
      const stateId = cleanNodeId(rawStateId);
      const stateLabel = nodeEl.getAttribute('data-state-label') || stateId;
      const note = effectiveNotes.nodes[stateId] || effectiveNotes.nodes[rawStateId] || '';
      const menuTarget: ContextMenuTarget = {
        type: 'node',
        id: stateId,
        label: stateLabel,
        note,
      };
      handleSelectState(stateId, stateLabel);
      setSelectedEdge(null);
      setContextMenuState({ x: e.clientX, y: e.clientY, target: menuTarget });
      return;
    }

    // 2. Clicked on an edge
    const svg = getDiagramSvg();
    let edge = resolveEdgeFromElement(target, svg, availableEdges);
    if (!edge && svg) {
      edge = findEdgeNearPoint(svg, e.clientX, e.clientY, availableEdges, 24);
    }
    if (edge && edge.from && edge.to && edge.from.trim() && edge.to.trim()) {
      const note =
        effectiveNotes.edges[edge.id] ||
        effectiveNotes.edges[`${edge.from}->${edge.to}`] ||
        (edge.pathId ? effectiveNotes.edges[edge.pathId] : '') ||
        '';
      const menuTarget: ContextMenuTarget = {
        type: 'edge',
        id: edge.id,
        pathId: edge.pathId,
        from: edge.from,
        to: edge.to,
        label: edge.label,
        note,
      };
      setSelectedEdge(edge);
      if (onSelectStateProp) {
        onSelectStateProp(null);
      } else {
        setInternalSelectedStateId(null);
      }
      setContextMenuState({ x: e.clientX, y: e.clientY, target: menuTarget });
      return;
    }

    // 3. Fallback: canvas context menu or selected item context menu
    if (selectedEdge && selectedEdge.id !== '->') {
      const note = effectiveNotes.edges[selectedEdge.id] || '';
      setContextMenuState({
        x: e.clientX,
        y: e.clientY,
        target: { type: 'edge', ...selectedEdge, note },
      });
      return;
    }
    if (effectiveSelectedStateId) {
      const note = effectiveNotes.nodes[effectiveSelectedStateId] || '';
      setContextMenuState({
        x: e.clientX,
        y: e.clientY,
        target: {
          type: 'node',
          id: effectiveSelectedStateId,
          label: effectiveSelectedStateLabel || effectiveSelectedStateId,
          note,
        },
      });
      return;
    }

    setContextMenuState({
      x: e.clientX,
      y: e.clientY,
      target: { type: 'canvas', x: e.clientX, y: e.clientY },
    });
  };

  const handleOpenAddNote = (target: ContextMenuTarget) => {
    setActiveNoteTarget(target);
    setIsNoteDialogOpen(true);
  };

  const handleSaveActiveNote = (target: ContextMenuTarget, noteText: string) => {
    onSaveNote?.(target, noteText);
    setIsNoteDialogOpen(false);
  };

  const handleDeleteActiveNote = (target: ContextMenuTarget) => {
    onDeleteNote?.(target);
    setIsNoteDialogOpen(false);
  };

  const panToEdge = (edgeId: string) => {
    if (!containerRef.current) return;
    const svg = getDiagramSvg();
    if (!svg) return;
    const pathEl = findEdgePathElement(svg, edgeId, availableEdges);
    if (pathEl) {
      panToElement(pathEl);
    }
  };

  // Window-level mouseup listener to guarantee drag never gets orphaned
  useEffect(() => {
    const handleWindowMouseUp = () => {
      flushLabelDrag();
      if (isDraggingEdgeHandleRef.current) {
        const edgeId = draggedEdgeIdRef.current;
        const wasMoved = edgeMovedRef.current;
        isDraggingEdgeHandleRef.current = false;
        draggedEdgeIdRef.current = null;
        draggedHandleTypeRef.current = null;
        setIsNodeDragging(false);

        if (wasMoved && edgeId) {
          setEdgeOffsets({ ...currentEdgeOffsetsRef.current });
        }
      }
      if (isDraggingNodeRef.current) {
        const stateId = draggedNodeIdRef.current;
        const wasMoved = nodeMovedRef.current;
        if (draggedNodeElRef.current) {
          draggedNodeElRef.current.classList.remove('dragging-state-node');
        }
        isDraggingNodeRef.current = false;
        draggedNodeIdRef.current = null;
        draggedNodeElRef.current = null;
        nodeInitialCenterRef.current = null;
        setActiveSnapResult(null);
        setIsNodeDragging(false);

        if (wasMoved && stateId) {
          setNodeOffsets({ ...currentNodeOffsetsRef.current });
        }
      }
      setIsDragging(false);
    };

    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, []);

  // Close Snap to Grid configuration menu on outside click
  useEffect(() => {
    if (!isSnapMenuOpen) return;
    const handleCloseSnapMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('#snap-to-grid-toolbar-group')) {
        setIsSnapMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleCloseSnapMenu);
    return () => window.removeEventListener('mousedown', handleCloseSnapMenu);
  }, [isSnapMenuOpen]);

  // Auto-dismiss Snap to Grid status toast
  useEffect(() => {
    if (!showSnapToast) return;
    const timer = setTimeout(() => {
      setShowSnapToast(null);
    }, 2200);
    return () => clearTimeout(timer);
  }, [showSnapToast]);

  const handleResetLayout = () => {
    handleAutoAlign();
  };

  const movedElementsCount =
    Object.keys(effectiveNodeOffsets).filter(
      (id) => effectiveNodeOffsets[id].x !== 0 || effectiveNodeOffsets[id].y !== 0
    ).length +
    Object.keys(edgeOffsets).filter(
      (id) =>
        edgeOffsets[id].x !== 0 ||
        edgeOffsets[id].y !== 0 ||
        (edgeOffsets[id].startDx !== undefined && edgeOffsets[id].startDx !== 0) ||
        (edgeOffsets[id].startDy !== undefined && edgeOffsets[id].startDy !== 0) ||
        (edgeOffsets[id].endDx !== undefined && edgeOffsets[id].endDx !== 0) ||
        (edgeOffsets[id].endDy !== undefined && edgeOffsets[id].endDy !== 0) ||
        !!edgeOffsets[id].labelDx ||
        !!edgeOffsets[id].labelDy
    ).length;

  const handleWheel = (e: React.WheelEvent) => {
    if (activePanAnimationRef.current) {
      cancelAnimationFrame(activePanAnimationRef.current);
      activePanAnimationRef.current = null;
      setPan({ x: Math.round(currentPanRef.current.x), y: Math.round(currentPanRef.current.y) });
    }

    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.closest('#diagram-minimap-container') ||
        target.closest('#diagram-minimap-collapsed') ||
        target.closest('#state-style-inspector, #state-style-popup') ||
        target.closest('#method-editor-panel') ||
        target.closest('#method-editor-fullscreen-overlay') ||
        target.closest('#method-editor-modal-overlay') ||
        target.closest('#method-split-panels-container') ||
        target.closest('#method-top-panel') ||
        target.closest('#method-bottom-panel') ||
        target.closest('.custom-scrollbar') ||
        target.closest('textarea') ||
        target.closest('pre') ||
        target.closest('select') ||
        target.closest('#note-dialog-overlay') ||
        target.closest('#notes-drawer-overlay') ||
        target.closest('#mermaid-toolbar') ||
        target.closest('#export-dialog-modal') ||
        target.closest('#complexity-heatmap-panel') ||
        target.closest('#state-machine-stats-panel') ||
        target.closest('#diagram-search-panel') ||
        target.closest('#transition-guard-inspector') ||
        target.closest('#edge-condition-detail-overlay, #transition-guard-inspector'))
    ) {
      // Allow normal scrolling inside editors and UI overlays; do NOT zoom canvas
      return;
    }
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const oldZoom = wheelZoomRef.current;
    const newZoom = Math.min(Math.max(0.2, oldZoom * factor), 5);
    if (newZoom === oldZoom) return;

    // Zoom around the cursor: the wrapper is drawn as translate(pan) scale(zoom) with its origin at the
    // top-left, so move the pan such that the diagram point under the cursor stays under the cursor
    const wrapper = containerRef.current?.querySelector('#mermaid-svg-wrapper') as HTMLElement | null;
    const oldPan = currentPanRef.current;
    if (wrapper) {
      const wRect = wrapper.getBoundingClientRect();
      // Untransformed wrapper origin on screen (its bounding box starts at origin + pan)
      const originX = wRect.left - oldPan.x;
      const originY = wRect.top - oldPan.y;
      const cx = e.clientX - originX;
      const cy = e.clientY - originY;
      const ratio = newZoom / oldZoom;
      const nextPan = { x: cx - (cx - oldPan.x) * ratio, y: cy - (cy - oldPan.y) * ratio };
      currentPanRef.current = nextPan;
      setPan(nextPan);
    }
    wheelZoomRef.current = newZoom;
    setZoom(newZoom);
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const getActiveSvgElement = (): SVGSVGElement | null => {
    return getDiagramSvg();
  };

  const handleOpenExportModal = (format: ExportFormat = 'png') => {
    setExportModalDefaultFormat(format);
    setIsExportModalOpen(true);
  };

  // Preset export background wins; otherwise derive from the diagram theme
  const defaultExportBackground: ExportBackground =
    exportSettings?.background ?? (mermaidTheme === 'dark' || !mermaidTheme ? 'dark' : 'white');

  const handleQuickDownloadPng = async (scale: ExportScale = 2, background?: ExportBackground) => {
    const svgEl = getActiveSvgElement();
    if (!svgEl) return;
    setExportingNotification(`Exporting ${scale}x PNG...`);
    try {
      const result = await exportHighResPng(svgEl, {
        scale,
        background: background ?? defaultExportBackground,
        fileName: (fileName || 'statechart').replace(/\.statechart|\.TcPOU/gi, ''),
        notes: effectiveNotes,
        customStyles: effectiveCustomStyles,
        theme: mermaidTheme,
      });
      triggerDownload(result.blob, result.fileName);
      setExportingNotification(`Downloaded ${result.fileName}`);
      setTimeout(() => setExportingNotification(null), 2500);
    } catch (e) {
      console.error('PNG export failed:', e);
      const msg = e instanceof Error ? e.message : 'PNG export failed';
      setExportingNotification(`PNG export failed: ${msg}`);
      setTimeout(() => setExportingNotification(null), 3500);
    }
  };

  const handleQuickDownloadSvg = async (scale: ExportScale = 1, background?: ExportBackground) => {
    const svgEl = getActiveSvgElement();
    if (!svgEl) return;
    setExportingNotification('Exporting vector SVG...');
    try {
      const result = await exportHighResSvg(svgEl, {
        scale,
        background: background ?? defaultExportBackground,
        fileName: (fileName || 'statechart').replace(/\.statechart|\.TcPOU/gi, ''),
        notes: effectiveNotes,
        customStyles: effectiveCustomStyles,
        theme: mermaidTheme,
      });
      triggerDownload(result.blob, result.fileName);
      setExportingNotification(`Downloaded ${result.fileName}`);
      setTimeout(() => setExportingNotification(null), 2500);
    } catch (e) {
      console.error('SVG export failed:', e);
      const msg = e instanceof Error ? e.message : 'SVG export failed';
      setExportingNotification(`SVG export failed: ${msg}`);
      setTimeout(() => setExportingNotification(null), 3500);
    }
  };

  const handleExportWithSettings = (settings: PresetExportSettings) =>
    settings.format === 'svg'
      ? handleQuickDownloadSvg(settings.scale, settings.background)
      : handleQuickDownloadPng(settings.scale, settings.background);

  const handleQuickCopyPng = async (scale: ExportScale = 2, background?: ExportBackground): Promise<{ success: boolean; message: string }> => {
    const svgEl = getActiveSvgElement();
    if (!svgEl) {
      const msg = 'Diagram SVG element not ready';
      onToastProp?.(msg, 'error');
      return { success: false, message: msg };
    }
    if (!onToastProp) {
      setExportingNotification('Copying PNG to clipboard...');
    }
    try {
      const res = await copyToClipboard(svgEl, {
        format: 'png',
        scale,
        background: background ?? defaultExportBackground,
        notes: effectiveNotes,
        customStyles: effectiveCustomStyles,
        theme: mermaidTheme,
      });
      const isRestricted = Boolean(res.message && (res.message.includes('restricted') || res.message.includes('downloaded')));
      const msg = res.message || `Copied PNG (${scale}x Retina) to clipboard!`;
      if (!onToastProp) {
        setExportingNotification(msg);
        setTimeout(() => setExportingNotification(null), 2500);
      }
      onToastProp?.(msg, isRestricted ? 'error' : 'success');
      return { success: !isRestricted, message: msg };
    } catch (e) {
      console.error('Copy PNG failed:', e);
      const msg = e instanceof Error ? e.message : 'Clipboard copy failed';
      if (!onToastProp) {
        setExportingNotification(`Copy failed: ${msg}`);
        setTimeout(() => setExportingNotification(null), 3500);
      }
      onToastProp?.(`Copy failed: ${msg}`, 'error');
      return { success: false, message: msg };
    }
  };

  const handleQuickCopySvg = async (): Promise<{ success: boolean; message: string }> => {
    const svgEl = getActiveSvgElement();
    if (!svgEl) {
      const msg = 'Diagram SVG element not ready';
      onToastProp?.(msg, 'error');
      return { success: false, message: msg };
    }
    if (!onToastProp) {
      setExportingNotification('Copying SVG to clipboard...');
    }
    try {
      const res = await copyToClipboard(svgEl, {
        format: 'svg',
        notes: effectiveNotes,
        customStyles: effectiveCustomStyles,
        theme: mermaidTheme,
      });
      setCopiedSvg(true);
      setTimeout(() => setCopiedSvg(false), 2000);
      const isRestricted = Boolean(res.message && (res.message.includes('restricted') || res.message.includes('downloaded')));
      const msg = res.message || 'Copied SVG vector to clipboard!';
      if (!onToastProp) {
        setExportingNotification(msg);
        setTimeout(() => setExportingNotification(null), 2500);
      }
      onToastProp?.(msg, isRestricted ? 'error' : 'success');
      return { success: !isRestricted, message: msg };
    } catch (e) {
      console.error('Copy SVG failed:', e);
      const msg = e instanceof Error ? e.message : 'Clipboard copy failed';
      if (!onToastProp) {
        setExportingNotification(`Copy failed: ${msg}`);
        setTimeout(() => setExportingNotification(null), 3500);
      }
      onToastProp?.(`Copy failed: ${msg}`, 'error');
      return { success: false, message: msg };
    }
  };

  const handleCopySvg = handleQuickCopySvg;
  const handleDownloadSvg = () => handleQuickDownloadSvg(1);

  const [isPrintingPdf, setIsPrintingPdf] = useState<boolean>(false);

  const handlePrintVisiblePdf = async () => {
    if (!svgContent || isPrintingPdf) return;
    setIsPrintingPdf(true);
    setExportingNotification('Generating high-resolution PDF...');
    try {
      const baseName = (fileName || 'statechart').replace(/\.statechart|\.TcPOU/gi, '') || 'statechart';
      const result = await exportDiagramVisibleAreaToPdf({
        targetElement: containerRef.current,
        targetElementId: 'mermaid-canvas-area',
        fileName: `${baseName}-diagram-visible`,
        scale: 2,
        theme: mermaidTheme,
        title: `${baseName} - Statechart Diagram (Visible Area)`,
      });

      if (result.success) {
        setExportingNotification(`Exported high-res PDF: ${result.fileName}`);
        setTimeout(() => setExportingNotification(null), 3000);
      } else {
        setExportingNotification(`PDF export error: ${result.error || 'Failed'}`);
        setTimeout(() => setExportingNotification(null), 3500);
      }
    } catch (err: unknown) {
      console.error('Print PDF failed:', err);
      const msg = err instanceof Error ? err.message : 'PDF export failed';
      setExportingNotification(`PDF export error: ${msg}`);
      setTimeout(() => setExportingNotification(null), 3500);
    } finally {
      setIsPrintingPdf(false);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      panToState,
      resetView: handleResetZoom,
      zoomIn: () => setZoom((prev) => Math.min(5, prev * 1.2)),
      zoomOut: () => setZoom((prev) => Math.max(0.2, prev / 1.2)),
      fitToScreen: handleResetZoom,
      autoAlign: handleAutoAlign,
      openExportModal: (format?: ExportFormat) => handleOpenExportModal(format),
      quickDownloadPng: (scale?: ExportScale) => handleQuickDownloadPng(scale),
      quickDownloadSvg: (scale?: ExportScale) => handleQuickDownloadSvg(scale),
      quickCopyPng: (scale?: ExportScale) => handleQuickCopyPng(scale),
      quickCopySvg: () => handleQuickCopySvg(),
      exportWithSettings: (settings: PresetExportSettings) => handleExportWithSettings(settings),
      printVisiblePdf: () => handlePrintVisiblePdf(),
      getActiveSvgElement: () => getActiveSvgElement(),
    }),
    [
      panToState,
      handleAutoAlign,
      handleResetZoom,
      handleOpenExportModal,
      handleQuickDownloadPng,
      handleQuickDownloadSvg,
      handleQuickCopyPng,
      handleQuickCopySvg,
      handleExportWithSettings,
      handlePrintVisiblePdf,
      getActiveSvgElement,
    ]
  );

  const toggleFullscreen = async () => {
    if (!isFullscreen) {
      setIsFullscreen(true);
      try {
        if (document.fullscreenEnabled && !document.fullscreenElement) {
          await document.documentElement.requestFullscreen?.().catch(() => {});
        }
      } catch {
        // Fallback gracefully to CSS fixed window expansion
      }
    } else {
      setIsFullscreen(false);
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen?.().catch(() => {});
        }
      } catch {
        // Fallback
      }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDraggingNodeRef.current) {
          const stateId = draggedNodeIdRef.current;
          if (stateId && containerRef.current) {
            const svg = getDiagramSvg();
            if (svg) {
              currentNodeOffsetsRef.current[stateId] = { ...nodeInitialOffsetRef.current };
              applyDiagramOffsetsToSvg(
                svg,
                currentNodeOffsetsRef.current,
                currentEdgeOffsetsRef.current,
                null,
                selectedEdge?.id,
                layoutEngine,
                flowchartCurve
              );
            }
          }
          if (draggedNodeElRef.current) {
            draggedNodeElRef.current.classList.remove('dragging-state-node');
          }
          isDraggingNodeRef.current = false;
          draggedNodeIdRef.current = null;
          draggedNodeElRef.current = null;
          setIsNodeDragging(false);
          return;
        }
        if (isInspectorOpen) {
          handleCloseInspector();
          return;
        }
        if (isFullscreen) {
          setIsFullscreen(false);
          if (document.fullscreenElement) {
            document.exitFullscreen?.().catch(() => {});
          }
          return;
        }

        // Clear the selected state / edge highlights, unless Esc is closing something else.
        // Check the event target: inputs such as the search box blur themselves on Esc before this runs
        const keyTarget = e.target as HTMLElement | null;
        const isTyping =
          keyTarget &&
          (keyTarget.tagName === 'INPUT' ||
            keyTarget.tagName === 'TEXTAREA' ||
            keyTarget.tagName === 'SELECT' ||
            keyTarget.isContentEditable);
        const overlayOpen = document.querySelector(
          '#toolbar-hidden-controls-menu, #code-editors-dropdown-menu, #dock-context-menu, #window-menu, #diagram-presets-dropdown-menu, #diagram-context-menu, [role="dialog"]'
        );
        const canvasVisible = Boolean(containerRef.current && containerRef.current.offsetParent !== null);
        if (!isTyping && !overlayOpen && canvasVisible && (effectiveSelectedStateId || selectedEdge)) {
          if (effectiveSelectedStateId) handleSelectState(null);
          setSelectedEdge(null);
          setActiveConditionOverlay(null);
        }
      }

      // 'M' or 'm' to toggle Minimap overlay
      if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const activeEl = document.activeElement;
        const isTyping =
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            activeEl.getAttribute('contenteditable') === 'true');
        if (!isTyping) {
          e.preventDefault();
          setIsMinimapOpen((prev) => !prev);
          return;
        }
      }

      // 'L' or 'l' to toggle Diagram Legend overlay
      if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const activeEl = document.activeElement;
        const isTyping =
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            activeEl.getAttribute('contenteditable') === 'true');
        if (!isTyping) {
          e.preventDefault();
          setIsLegendOpen((prev) => !prev);
          return;
        }
      }

      // 'S' or 's' to toggle State Machine Statistics panel
      if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const activeEl = document.activeElement;
        const isTyping =
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            activeEl.getAttribute('contenteditable') === 'true');
        if (!isTyping) {
          e.preventDefault();
          setIsStatsOpen((prev) => !prev);
          return;
        }
      }

      // 'F' or 'f' to toggle Keyword Search & Highlighting panel
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const activeEl = document.activeElement;
        const isTyping =
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            activeEl.getAttribute('contenteditable') === 'true');
        if (!isTyping) {
          e.preventDefault();
          setIsSearchPanelOpen((prev) => !prev);
          return;
        }
      }

      // 'H' or 'h' to toggle Complexity Heat-map mode and panel
      if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const activeEl = document.activeElement;
        const isTyping =
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            activeEl.getAttribute('contenteditable') === 'true');
        if (!isTyping) {
          e.preventDefault();
          setIsHeatmapActive((prev) => {
            const next = !prev;
            if (next) {
              setIsHeatmapPanelOpen(true);
            }
            return next;
          });
          return;
        }
      }

      // 'G' or 'g' to toggle Snap to Grid
      if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const activeEl = document.activeElement;
        const isTyping =
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            activeEl.getAttribute('contenteditable') === 'true');
        if (!isTyping) {
          e.preventDefault();
          setSnapConfig((prev) => {
            const next = { ...prev, enabled: !prev.enabled };
            setShowSnapToast({
              message: next.enabled ? `Snap to Grid: ON (${next.gridSize}px)` : 'Snap to Grid: OFF',
              timestamp: Date.now(),
            });
            return next;
          });
          return;
        }
      }

      // 'K' or 'k' to toggle Lock Diagram Layout
      if ((e.key === 'k' || e.key === 'K') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const activeEl = document.activeElement;
        const isTyping =
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            activeEl.getAttribute('contenteditable') === 'true');
        if (!isTyping) {
          e.preventDefault();
          handleToggleLayoutLocked();
          return;
        }
      }

      // 'A' or 'a' to trigger Auto-Align
      if ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const activeEl = document.activeElement;
        const isTyping =
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            activeEl.getAttribute('contenteditable') === 'true');
        if (!isTyping) {
          e.preventDefault();
          handleAutoAlign();
          return;
        }
      }

      // Keyboard arrow keys to nudge selected state node position
      if (effectiveSelectedStateId && !isInspectorOpen && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const isArrow =
          e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
        if (isArrow) {
          const activeEl = document.activeElement;
          const isTyping =
            activeEl &&
            (activeEl.tagName === 'INPUT' ||
              activeEl.tagName === 'TEXTAREA' ||
              activeEl.getAttribute('contenteditable') === 'true');
          if (!isTyping) {
            e.preventDefault();
            const step = snapConfig.enabled
              ? (e.shiftKey ? snapConfig.gridSize * 2 : snapConfig.gridSize)
              : (e.shiftKey ? 15 : 3);
            const delta = {
              x: e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
              y: e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
            };
            const current = effectiveNodeOffsets[effectiveSelectedStateId] || { x: 0, y: 0 };
            const next = { x: current.x + delta.x, y: current.y + delta.y };
            const nextOffsets = { ...effectiveNodeOffsets, [effectiveSelectedStateId]: next };
            currentNodeOffsetsRef.current = nextOffsets;
            setNodeOffsets(nextOffsets);
            if (containerRef.current) {
              const svg = getDiagramSvg();
              if (svg) {
                applyDiagramOffsetsToSvg(
                  svg,
                  nextOffsets,
                  currentEdgeOffsetsRef.current,
                  null,
                  selectedEdge?.id,
                  layoutEngine,
                  flowchartCurve
                );
              }
            }
          }
        }
      }
    };
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [isFullscreen, isInspectorOpen, effectiveSelectedStateId, effectiveNodeOffsets, selectedEdge]);

  const handleClick = (e: React.MouseEvent) => {
    // Mouse-up already handled this gesture's edge click
    if (edgeClickHandledRef.current) {
      edgeClickHandledRef.current = false;
      return;
    }
    const target = e.target as Element;
    if (
      target.closest('#state-style-inspector, #state-style-popup') ||
      target.closest('#mermaid-toolbar') ||
      target.closest('#diagram-context-menu') ||
      target.closest('#note-dialog-overlay') ||
      target.closest('#notes-drawer-overlay') ||
      target.closest('#mermaid-note-overlays-layer') ||
      target.closest('#edge-condition-detail-overlay, #transition-guard-inspector') ||
      target.closest('#transition-guard-inspector') ||
      target.closest('#complexity-heatmap-panel') ||
      target.closest('#state-machine-stats-panel') ||
      target.closest('#diagram-search-panel')
    ) {
      return;
    }

    const labelOrBadgeEl = (target.closest('.tc-priority-badge') ||
      target.closest('.priority-badge') ||
      target.closest('g.edgeLabel') ||
      target.closest('.clickable-edge-label') ||
      target.closest('.tc-interactive-edge-label')) as HTMLElement | SVGElement | null;

    if (labelOrBadgeEl) {
      e.stopPropagation();
      const svg = getDiagramSvg();
      const edge = resolveEdgeFromElement(labelOrBadgeEl, svg, availableEdges);
      if (edge && edge.from && edge.to) {
        const rect = labelOrBadgeEl.getBoundingClientRect();
        activateEdgeClick(edge, { x: rect.left + rect.width / 2, y: rect.top }, selectedEdge?.id === edge.id);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Toolbar overflow: controls stay on one row next to the search box; the lowest-priority
  // controls that do not fit move into the "Hidden" menu (measured against the real toolbar width)
  // ---------------------------------------------------------------------------
  const hasCodeEditors = Boolean(tcPouContent || tcDutContent || onOpenEnumEditorProp);
  const toolbarItems: ToolbarItemId[] = (
    [
      'interactive', 'labels', 'code',
      'autoAlign', 'lock', 'snap', 'resetLayout',
      'heatmap', 'refactor',
      'stats', 'legend', 'notes', 'minimap', 'styles',
      'zoom', 'fullscreen',
    ] as ToolbarItemId[]
  ).filter((id) => (id === 'code' ? hasCodeEditors : id === 'resetLayout' ? movedElementsCount > 0 : true));
  const TOOLBAR_GROUP: Record<ToolbarItemId, number> = {
    interactive: 0, labels: 0, code: 0,
    autoAlign: 1, lock: 1, snap: 1, resetLayout: 1,
    heatmap: 2, refactor: 2,
    stats: 3, legend: 3, notes: 3, minimap: 3, styles: 3,
    zoom: 4, fullscreen: 4,
  };
  // First to stay visible -> last to move into the Hidden menu
  const TOOLBAR_PRIORITY: ToolbarItemId[] = [
    'zoom', 'fullscreen', 'interactive', 'code', 'autoAlign', 'heatmap', 'lock', 'resetLayout',
    'stats', 'legend', 'notes', 'minimap', 'styles', 'refactor', 'snap', 'labels',
  ];

  // Callback ref: the toolbar is portaled into a container that may not exist on the first render
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);
  const toolbarItemsRef = useRef<HTMLDivElement>(null);
  const [toolbarWidth, setToolbarWidth] = useState<number>(0);

  useEffect(() => {
    if (!toolbarEl) return;
    const ro = new ResizeObserver(() => setToolbarWidth(toolbarEl.clientWidth));
    ro.observe(toolbarEl);
    return () => ro.disconnect();
  }, [toolbarEl]);

  const hiddenButtonWidthRef = useRef<number>(96);
  // Search box: wider while focused, but always leaves room for the Hidden button on narrow toolbars
  const searchBoxWidth = Math.round(
    Math.max(
      40,
      Math.min(
        isSearchFocused ? Math.max(160, toolbarWidth * 0.55) : Math.max(120, toolbarWidth * 0.28),
        isSearchFocused ? 360 : 200,
        toolbarWidth - 46 - hiddenButtonWidthRef.current
      )
    )
  );

  const toolbarOverflow = useToolbarOverflow<ToolbarItemId>({
    items: toolbarItems,
    priority: TOOLBAR_PRIORITY,
    // Toolbar padding + gap between the search box and the controls + safety margin
    available: toolbarWidth - searchBoxWidth - 32,
    containerRef: toolbarItemsRef,
    hiddenButtonSelector: '#toolbar-hidden-controls-container',
    groupOf: (id) => TOOLBAR_GROUP[id],
  });
  hiddenButtonWidthRef.current = toolbarOverflow.hiddenButtonWidth;
  const overflowItems = toolbarOverflow.overflow;
  const isToolbarItemVisible = toolbarOverflow.isVisible;
  const toolbarButtonClass = (active: boolean, activeClass: string) =>
    `flex items-center gap-1 px-1.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
      active ? activeClass : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60'
    }`;

  const toggleHeatmap = () => {
    onSwitchToDiagramTab?.();
    setIsHeatmapActive((prev) => {
      const next = !prev;
      if (next) setIsHeatmapPanelOpen(true);
      return next;
    });
  };

  const toolbarContent = (
    <div
      ref={setToolbarEl}
      id="mermaid-toolbar"
      className="relative flex flex-nowrap items-center gap-2 px-1 sm:px-2 py-0.5 text-xs text-slate-300 z-20 shrink-0 w-full min-w-0 overflow-visible"
    >
      <div className="flex items-center min-w-0 shrink-0">
        {/* Search Input for States and Transitions (expands when focused; controls overflow into Hidden) */}
        <div
          id="diagram-search-input-container"
          style={{ width: searchBoxWidth }}
          className="relative flex items-center transition-[width] duration-300 ease-in-out"
        >
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
          <input
            ref={searchInputRef}
            id="diagram-search-input"
            type="text"
            value={effectiveSearchQuery}
            onChange={(e) => {
              handleSearchChange(e.target.value);
              if (!isSearchPanelOpen) setIsSearchPanelOpen(true);
            }}
            onFocus={() => {
              onSwitchToDiagramTab?.();
              setIsSearchFocused(true);
              if (!isSearchPanelOpen) setIsSearchPanelOpen(true);
            }}
            onBlur={(e) => {
              if (e.relatedTarget && (e.relatedTarget as HTMLElement).closest('#diagram-search-input-container')) {
                return;
              }
              setIsSearchFocused(false);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder={isSearchFocused ? 'Search states or transitions... (Ctrl+F)' : 'Search (Ctrl+F)'}
            className="w-full bg-slate-900/90 border border-slate-700/80 rounded-lg pl-8 pr-16 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50 transition-all truncate"
          />

          {/* Quick Search Results Dropdown Menu */}
          {isSearchFocused && effectiveSearchQuery.trim() && (
            <div
              id="diagram-search-results-dropdown"
              onMouseDown={(e) => {
                // Prevent input blur before click event fires
                e.preventDefault();
              }}
              className="absolute left-0 top-full mt-1.5 w-full min-w-[280px] sm:min-w-[340px] max-h-72 overflow-y-auto bg-slate-950/95 border border-slate-700/90 rounded-xl shadow-2xl backdrop-blur-md z-50 divide-y divide-slate-800/70 text-xs py-1 animate-in fade-in slide-in-from-top-1 duration-150 custom-scrollbar"
            >
              {matches.length === 0 ? (
                <div className="px-3 py-3 text-center text-slate-400 text-xs">
                  No matching states or transitions found for <span className="font-mono text-amber-300 font-semibold">"{effectiveSearchQuery}"</span>
                </div>
              ) : (
                <>
                  <div className="px-2.5 py-1 text-[10px] font-medium text-slate-400 flex items-center justify-between bg-slate-900/80">
                    <span>{matches.length} {matches.length === 1 ? 'match' : 'matches'}</span>
                    <span className="text-slate-500 font-mono text-[9px]">Click to scroll & center</span>
                  </div>
                  {matches.slice(0, 10).map((m, idx) => {
                    const isActive = idx === activeMatchIndex;
                    const isState = m.type === 'state';
                    return (
                      <button
                        key={`search-dropdown-item-${idx}`}
                        type="button"
                        onClick={() => {
                          onSwitchToDiagramTab?.();
                          switchActiveMatch(idx);
                          if (isState) {
                            const targetState =
                              availableStates.find((s) => s.id === m.stateId || s.label === m.name) ||
                              availableStates.find((s) => m.name.includes(s.id) || m.name.includes(s.label));
                            if (targetState) {
                              handleSelectState(targetState.id, targetState.label);
                            }
                          } else if (m.edgeInfo) {
                            setSelectedEdge(m.edgeInfo);
                          }
                          panToElement(m.element);
                          if (m.element.classList.contains('node') || m.element.closest('g.node')) {
                            const nodeG = (m.element.classList.contains('node') ? m.element : m.element.closest('g.node')) as SVGGElement;
                            if (nodeG) triggerNodeJumpHighlight(nodeG);
                          }
                        }}
                        className={`w-full text-left px-2.5 py-1.5 flex items-center justify-between gap-2 transition-colors cursor-pointer group ${
                          isActive
                            ? 'bg-sky-950/80 text-sky-200 font-medium'
                            : 'text-slate-200 hover:bg-slate-850 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`px-1 py-0.2 rounded text-[9px] font-mono font-bold shrink-0 ${
                              isState
                                ? 'bg-sky-950 border border-sky-800 text-sky-400'
                                : 'bg-emerald-950 border border-emerald-800 text-emerald-400'
                            }`}
                          >
                            {isState ? 'STATE' : 'TRANS'}
                          </span>
                          <span className="truncate font-mono text-xs">
                            {m.name || m.stateLabel || m.stateId}
                          </span>
                        </div>
                        <Target className="w-3.5 h-3.5 text-slate-500 group-hover:text-amber-400 shrink-0 transition-colors" />
                      </button>
                    );
                  })}
                  {matches.length > 10 && (
                    <div className="px-2.5 py-1 text-center text-[10px] text-slate-500 bg-slate-900/40">
                      +{matches.length - 10} more in Keyword Search Panel
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {effectiveSearchQuery.trim() && (
            <div className="absolute right-1.5 flex items-center gap-0.5">
              <span
                id="diagram-search-matches-count"
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border leading-none ${
                  matches.length > 0
                    ? 'bg-sky-950/90 text-sky-300 border-sky-800/80'
                    : 'bg-rose-950/90 text-rose-300 border-rose-800/80'
                }`}
                title={
                  matches.length > 0
                    ? `${matchesBreakdown.states} states, ${matchesBreakdown.transitions} transitions matching`
                    : 'No matching states or transitions'
                }
              >
                {matches.length > 0 ? `${activeMatchIndex + 1}/${matches.length}` : '0 found'}
              </span>

              {matches.length > 1 && (
                <div className="flex items-center">
                  <button
                    id="diagram-search-prev-btn"
                    type="button"
                    onClick={goToPrevMatch}
                    className="p-0.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
                    title="Previous match (Shift+Enter)"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    id="diagram-search-next-btn"
                    type="button"
                    onClick={goToNextMatch}
                    className="p-0.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
                    title="Next match (Enter)"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <button
                id="diagram-search-clear-btn"
                type="button"
                onClick={clearSearch}
                className="p-0.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors cursor-pointer"
                title="Clear search (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>

              <button
                id="keyword-search-panel-toggle-button"
                type="button"
                onClick={() => setIsSearchPanelOpen((prev) => !prev)}
                className={`p-0.5 rounded transition-colors cursor-pointer ${
                  isSearchPanelOpen
                    ? 'text-amber-400 bg-amber-950/80 hover:bg-amber-900/80'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
                title={isSearchPanelOpen ? 'Hide Search Results Panel (Ctrl+F)' : 'Show Search Results Panel (Ctrl+F)'}
              >
                <ListFilter className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Controls that fit on this row (the rest are listed in the Hidden menu) */}
      <div ref={toolbarItemsRef} className="flex flex-nowrap items-center justify-end gap-1.5 ml-auto min-w-0 overflow-hidden py-0.5 px-0.5">
        {toolbarItems.map((id, index) => {
          if (!isToolbarItemVisible(id)) return null;
          const prevVisible = toolbarItems.slice(0, index).filter(isToolbarItemVisible).pop();
          const separator =
            prevVisible && TOOLBAR_GROUP[prevVisible] !== TOOLBAR_GROUP[id] ? (
              <div className="w-[1px] h-4 bg-slate-800 shrink-0" />
            ) : null;
          return (
            <React.Fragment key={id}>
              {separator}
              <div data-toolbar-item={id} className="shrink-0 flex items-center">
                {renderToolbarItem(id)}
              </div>
            </React.Fragment>
          );
        })}

        {/* Hidden Controls Menu: lists only the controls that did not fit */}
        {overflowItems.length > 0 && (
          <ToolbarHiddenControls
            overflowItems={overflowItems}
            compact={toolbarWidth < 640}
            isInteractiveMode={isInteractiveMode}
            setIsInteractiveMode={setIsInteractiveMode}
            isCompactLabels={isCompactLabels}
            setIsCompactLabels={setIsCompactLabels}
            isInspectorOpen={isInspectorOpen}
            handleToggleInspector={handleToggleInspector}
            handleOpenMethodEditor={handleOpenMethodEditor}
            handleOpenEnumEditor={handleOpenEnumEditor}
            hasPouContent={Boolean(tcPouContent)}
            hasDutContent={Boolean(tcDutContent || onOpenEnumEditorProp)}
            handleAutoAlign={handleAutoAlign}
            isAutoAligning={isAutoAligning}
            isLayoutLocked={isLayoutLocked}
            handleToggleLayoutLocked={handleToggleLayoutLocked}
            movedElementsCount={movedElementsCount}
            handleResetLayout={handleResetLayout}
            totalNotesCount={totalNotesCount}
            onOpenNotesDrawer={() => setIsNotesDrawerOpen(true)}
            isMinimapOpen={isMinimapOpen}
            setIsMinimapOpen={setIsMinimapOpen}
            isLegendOpen={isLegendOpen}
            setIsLegendOpen={setIsLegendOpen}
            isStatsOpen={isStatsOpen}
            setIsStatsOpen={setIsStatsOpen}
            isHeatmapActive={isHeatmapActive}
            onToggleHeatmap={toggleHeatmap}
            setIsHeatmapPanelOpen={setIsHeatmapPanelOpen}
            refactorCandidatesCount={complexityHeatmapResult.refactorCandidatesCount}
            complexityThreshold={complexityThreshold}
            snapConfig={snapConfig}
            setSnapConfig={setSnapConfig}
            setShowSnapToast={setShowSnapToast}
            zoom={zoom}
            setZoom={setZoom}
            handleResetZoom={handleResetZoom}
            isFullscreen={isFullscreen}
            toggleFullscreen={toggleFullscreen}
          />
        )}
      </div>
    </div>
  );

  function renderToolbarItem(id: ToolbarItemId): React.ReactNode {
    switch (id) {
      case 'interactive':
        return (
          <button
            id="toggle-interactive-mode-btn"
            type="button"
            onClick={() => {
              onSwitchToDiagramTab?.();
              setIsInteractiveMode((prev) => !prev);
            }}
            className={toolbarButtonClass(
              isInteractiveMode,
              'bg-emerald-600/90 hover:bg-emerald-500 text-white shadow-sm ring-1 ring-emerald-400/40'
            )}
            title="Toggle Interactive Mode: Clean compact transition labels with click-to-expand condition details overlay"
          >
            <MousePointerClick className="w-3.5 h-3.5 text-emerald-400" />
            <span
              className={`px-1.5 py-0.2 rounded-full font-bold text-[10px] ${
                isInteractiveMode ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60' : 'bg-slate-900 text-slate-400'
              }`}
            >
              {isInteractiveMode ? 'ON' : 'OFF'}
            </span>
          </button>
        );
      case 'labels':
        return (
          <button
            id="toolbar-labels-btn"
            type="button"
            onClick={() => setIsCompactLabels((prev) => !prev)}
            className={toolbarButtonClass(isCompactLabels, 'bg-sky-950/80 text-sky-300 border border-sky-600/70')}
            title={`Transition labels: ${isCompactLabels ? 'Clean (shortened)' : 'Full condition text'} - click to toggle`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-sky-400" />
          </button>
        );
      case 'code':
        return (
          <div className="relative">
            <button
              ref={codeButtonRef}
              id="toolbar-code-editors-dropdown-btn"
              type="button"
              onClick={() => {
                if (!isCodeMenuOpen) {
                  updateCodeMenuPosition();
                }
                setIsCodeMenuOpen((prev) => !prev);
              }}
              className={`flex items-center gap-1 px-1.5 py-1 rounded-lg transition-all text-xs font-medium cursor-pointer ${
                isCodeMenuOpen
                  ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-400/40'
                  : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60'
              }`}
              title="Edit TwinCAT POU Methods (.TcPOU) or State Enum (.TcDUT)"
            >
              <Code2 className="w-3.5 h-3.5 text-sky-400" />
              <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isCodeMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isCodeMenuOpen &&
              createPortal(
                <div
                  ref={codeMenuRef}
                  id="code-editors-dropdown-menu"
                  style={{
                    position: 'fixed',
                    top: `${codeMenuCoords.top}px`,
                    left: `${codeMenuCoords.left}px`,
                    zIndex: 99999,
                  }}
                  className="w-56 bg-slate-900 border border-slate-700/90 rounded-xl shadow-2xl py-1 text-xs text-slate-200 divide-y divide-slate-800/80 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
                >
                  <button
                    id="open-method-editor-btn"
                    type="button"
                    onClick={() => {
                      setIsCodeMenuOpen(false);
                      handleOpenMethodEditor('doState()');
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-800 text-slate-200 hover:text-white transition-colors cursor-pointer"
                  >
                    <FileCode className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <div>
                      <div className="font-medium text-xs text-slate-100">Edit Methods (.TcPOU)</div>
                      <div className="text-[10px] text-slate-400">View & edit methods in POU</div>
                    </div>
                  </button>

                  {(tcDutContent || onOpenEnumEditorProp) && (
                    <button
                      id="open-enum-editor-btn"
                      type="button"
                      onClick={() => {
                        setIsCodeMenuOpen(false);
                        handleOpenEnumEditor(undefined);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-800 text-slate-200 hover:text-white transition-colors cursor-pointer"
                    >
                      <Code2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <div>
                        <div className="font-medium text-xs text-slate-100">Edit ENUM (.TcDUT)</div>
                        <div className="text-[10px] text-slate-400">View & edit states enum</div>
                      </div>
                    </button>
                  )}
                </div>,
                document.body
              )}
          </div>
        );
      case 'autoAlign':
        return (
          <button
            id="toolbar-auto-align-btn"
            type="button"
            onClick={() => {
              onSwitchToDiagramTab?.();
              handleAutoAlign();
            }}
            disabled={isAutoAligning || !svgContent}
            className={toolbarButtonClass(isAutoAligning, 'bg-sky-500/20 text-sky-300 border border-sky-500/40')}
            title={`Auto-Align (Shortcut: A): Re-runs the ${layoutEngine.toUpperCase()} layout engine to organize all nodes${
              isLayoutLocked ? ' (Layout remains locked)' : ''
            }`}
          >
            <Workflow className={`w-3.5 h-3.5 text-sky-400 ${isAutoAligning ? 'animate-spin' : ''}`} />
          </button>
        );
      case 'lock':
        return (
          <button
            id="toolbar-lock-layout-btn"
            type="button"
            onClick={handleToggleLayoutLocked}
            className={toolbarButtonClass(isLayoutLocked, 'bg-amber-500/20 text-amber-300 border border-amber-500/60')}
            title={isLayoutLocked ? 'Layout locked: automatic re-layout is disabled. Click to unlock.' : 'Lock layout to keep custom node positions'}
          >
            {isLayoutLocked ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Unlock className="w-3.5 h-3.5 text-slate-400" />}
          </button>
        );
      case 'snap':
        return (
          <div
            className={`flex items-center rounded-lg border text-xs ${
              snapConfig.enabled ? 'border-sky-600/70 bg-sky-950/60' : 'border-slate-700/60 bg-slate-800/80'
            }`}
          >
            <button
              id="toolbar-snap-btn"
              type="button"
              onClick={() =>
                setSnapConfig((prev) => {
                  const next = { ...prev, enabled: !prev.enabled };
                  setShowSnapToast({
                    message: next.enabled ? `Snap to Grid: ON (${next.gridSize}px)` : 'Snap to Grid: OFF',
                    timestamp: Date.now(),
                  });
                  return next;
                })
              }
              className={`flex items-center gap-1.5 pl-2 pr-1.5 py-1 font-medium whitespace-nowrap cursor-pointer ${
                snapConfig.enabled ? 'text-sky-300' : 'text-slate-300 hover:text-white'
              }`}
              title="Toggle snap to grid & smart alignment guides"
            >
              <Magnet className="w-3.5 h-3.5 text-sky-400" />
            </button>
            <select
              id="toolbar-snap-size-select"
              value={snapConfig.gridSize}
              onChange={(e) => {
                const size = Number(e.target.value);
                setSnapConfig((prev) => ({ ...prev, gridSize: size, enabled: true }));
                setShowSnapToast({ message: `Grid resolution: ${size}px`, timestamp: Date.now() });
              }}
              className="bg-transparent text-[11px] font-mono text-slate-300 pr-1 py-1 border-l border-slate-700/60 focus:outline-none cursor-pointer"
              title="Grid resolution"
            >
              {[10, 20, 40].map((size) => (
                <option key={size} value={size} className="bg-slate-900">
                  {size}px
                </option>
              ))}
            </select>
          </div>
        );
      case 'resetLayout':
        return (
          <button
            id="toolbar-reset-layout-btn"
            type="button"
            onClick={handleResetLayout}
            className={toolbarButtonClass(true, 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30')}
            title="Reset manually moved nodes and edges to the automatic layout"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
            <span className="px-1.5 rounded-full bg-amber-400 text-slate-950 font-bold text-[10px]">{movedElementsCount}</span>
          </button>
        );
      case 'heatmap':
        return (
          <button
            id="toolbar-heatmap-btn"
            type="button"
            onClick={toggleHeatmap}
            className={toolbarButtonClass(isHeatmapActive, 'bg-amber-950/80 text-amber-300 border border-amber-500/70')}
            title={`Complexity Heat-Map: ${isHeatmapActive ? 'ON' : 'OFF'} - click to toggle (Shortcut: H)`}
          >
            <Flame className="w-3.5 h-3.5 text-amber-400" />
          </button>
        );
      case 'refactor':
        return (
          <button
            id="toolbar-refactor-btn"
            type="button"
            onClick={() => setIsHeatmapPanelOpen(true)}
            className={toolbarButtonClass(
              complexityHeatmapResult.refactorCandidatesCount > 0,
              'bg-rose-950/80 text-rose-300 border border-rose-500/60'
            )}
            title={`Refactor candidates (cyclomatic complexity M ≥ ${complexityThreshold}); opens the Complexity Heat-Map`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            <span>{complexityHeatmapResult.refactorCandidatesCount}</span>
          </button>
        );
      case 'stats':
      case 'legend':
      case 'notes':
      case 'minimap':
      case 'styles': {
        const cfg = {
          stats: { icon: <Activity className="w-3.5 h-3.5" />, active: isStatsOpen, onClick: () => setIsStatsOpen((p) => !p), title: 'State Machine Real-Time Stats (Shortcut: S)' },
          legend: { icon: <BookOpen className="w-3.5 h-3.5" />, active: isLegendOpen, onClick: () => setIsLegendOpen((p) => !p), title: 'Diagram Legend (Shortcut: L)' },
          notes: { icon: <StickyNote className="w-3.5 h-3.5" />, active: totalNotesCount > 0, onClick: () => setIsNotesDrawerOpen(true), title: `Notes (${totalNotesCount})` },
          minimap: { icon: <Map className="w-3.5 h-3.5" />, active: isMinimapOpen, onClick: () => setIsMinimapOpen((p) => !p), title: 'Minimap (Shortcut: M)' },
          styles: { icon: <Palette className="w-3.5 h-3.5" />, active: isInspectorOpen, onClick: handleToggleInspector, title: 'Node Styles (State Node Appearance)' },
        }[id];
        return (
          <button
            id={`toolbar-${id}-btn`}
            type="button"
            onClick={cfg.onClick}
            className={`relative p-1.5 rounded-lg transition-colors cursor-pointer ${
              cfg.active ? 'bg-sky-950/80 text-sky-300 ring-1 ring-sky-600/60' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title={cfg.title}
            aria-label={cfg.title}
          >
            {cfg.icon}
            {id === 'notes' && totalNotesCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1 rounded-full bg-amber-400 text-slate-950 font-bold text-[9px] leading-tight">
                {totalNotesCount}
              </span>
            )}
          </button>
        );
      }
      case 'zoom':
        return (
          <div className="flex items-center gap-0.5">
            <button
              id="zoom-out-button"
              type="button"
              onClick={() => {
                onSwitchToDiagramTab?.();
                setZoom((z) => Math.max(0.2, z * 0.85));
              }}
              className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-0.5 font-mono text-[11px] text-slate-400 select-none">
              {Math.round(zoom * 100)}%
            </span>
            <button
              id="zoom-in-button"
              type="button"
              onClick={() => {
                onSwitchToDiagramTab?.();
                setZoom((z) => Math.min(5, z * 1.15));
              }}
              className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              id="zoom-reset-button"
              type="button"
              onClick={() => {
                onSwitchToDiagramTab?.();
                handleResetZoom();
              }}
              className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              title="Reset View"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      case 'fullscreen':
        return (
          <button
            id="fullscreen-button"
            type="button"
            onClick={() => {
              onSwitchToDiagramTab?.();
              toggleFullscreen();
            }}
            className={toolbarButtonClass(isFullscreen, 'bg-sky-600 hover:bg-sky-500 text-white shadow-sm ring-1 ring-sky-400/40')}
            title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Expand diagram canvas to fill the entire browser window'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        );
    }
  }

  const renderCanvasPanel = (id: DockedCanvasPanelId, label: string, element: React.ReactNode) => {
    if (!dockedPanels) return element;
    return createPortal(element ?? <DockedPanelPlaceholder label={label} />, dockedPanels.targets[id]);
  };

  const effectivePortalTarget =
    toolbarPortalTarget ||
    (typeof document !== 'undefined' ? document.getElementById('header-toolbar-container') : null);

  return (
    <div
      id="mermaid-viewer-container"
      className={`relative flex flex-col w-full h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden ${
        isFullscreen ? 'fixed inset-0 z-[100] w-screen h-screen rounded-none border-none shadow-2xl' : ''
      }`}
    >
      {/* If in Fullscreen mode, render toolbar inside fullscreen container. Otherwise portal to 2nd row of header */}
      {isFullscreen
        ? toolbarContent
        : effectivePortalTarget
        ? createPortal(toolbarContent, effectivePortalTarget)
        : toolbarContent}

      {/* Main Diagram Canvas */}
      <div
        ref={containerRef}
        id="mermaid-canvas-area"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={(e) => {
          handleMouseUp(e);
          setHoveredComplexityMetric(null);
          setHoveredEdgeCondition(null);
        }}
        onClick={handleClick}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        className={`flex-1 relative overflow-hidden [background-size:16px_16px] cursor-grab transition-colors duration-200 ${
          isNodeDragging ? 'tc-node-dragging ' : ''
        }${
          mermaidTheme === 'dark'
            ? 'bg-slate-900 bg-[radial-gradient(#1e293b_1px,transparent_1px)]'
            : mermaidTheme === 'forest'
            ? 'bg-[#f4f7f4] bg-[radial-gradient(#cbd5e1_1px,transparent_1px)]'
            : mermaidTheme === 'neutral'
            ? 'bg-[#f5f5f4] bg-[radial-gradient(#d6d3d1_1px,transparent_1px)]'
            : 'bg-[#f8fafc] bg-[radial-gradient(#cbd5e1_1px,transparent_1px)]'
        } ${isDragging || isNodeDragging ? 'cursor-grabbing select-none' : ''}`}
      >
        {error ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center text-rose-400 max-w-md mx-auto">
            <AlertCircle className="w-8 h-8 mb-2" />
            <p className="font-semibold text-sm">Mermaid Render Error</p>
            <p className="text-xs text-slate-400 mt-1 font-mono break-all bg-slate-950/80 p-3 rounded border border-rose-900/50">
              {error}
            </p>
          </div>
        ) : svgContent ? (
          <div
            id="mermaid-svg-wrapper"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              transition: canvasTransition,
            }}
            className="w-full h-full p-8 select-none flex items-center justify-center [&>svg]:max-w-none [&>svg]:max-h-none relative"
          >
            {/* Main Mermaid Diagram SVG Container */}
            <div
              id="mermaid-diagram-svg-container"
              className="contents"
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />

            {/* Snap to Grid Background Dot Pattern */}
            {snapConfig.enabled && (
              <svg
                id="diagram-snap-grid-svg"
                className="absolute inset-0 pointer-events-none -z-10 overflow-visible"
                style={{
                  left: -8000,
                  top: -8000,
                  width: 16000,
                  height: 16000,
                }}
              >
                <defs>
                  <pattern
                    id="diagram-snap-grid-pattern"
                    width={snapConfig.gridSize}
                    height={snapConfig.gridSize}
                    patternUnits="userSpaceOnUse"
                  >
                    <circle
                      cx={snapConfig.gridSize / 2}
                      cy={snapConfig.gridSize / 2}
                      r="1.2"
                      fill={mermaidTheme === 'dark' ? '#475569' : '#94a3b8'}
                      opacity={mermaidTheme === 'dark' ? '0.65' : '0.45'}
                    />
                  </pattern>
                </defs>
                <rect
                  x="0"
                  y="0"
                  width="100%"
                  height="100%"
                  fill="url(#diagram-snap-grid-pattern)"
                />
              </svg>
            )}

            {/* Smart Alignment Guides and Crosshair Overlay */}
            <DiagramSnapGuides
              snapResult={activeSnapResult}
              activeNodeId={draggedNodeIdRef.current}
              canvasPositions={canvasNodePositions}
              svgElement={renderedSvg || getDiagramSvg()}
            />

            <NoteOverlaysLayer
              notes={effectiveNotes}
              availableStates={availableStates}
              availableEdges={availableEdges}
              svgElement={renderedSvg || getDiagramSvg()}
              zoom={zoom}
              onEditNote={handleOpenAddNote}
              onDeleteNote={handleDeleteActiveNote}
              onUpdateNotePosition={onUpdateNotePositionProp || (() => {})}
              onUpdateNoteStyle={onUpdateNoteStyle}
              onSelectTarget={(target) => {
                // The note is drawn beside its target, so select it without panning the view
                if (target.type === 'node') {
                  handleSelectState(target.id, target.label || target.id);
                } else if (target.type === 'edge') {
                  const edge = availableEdges.find((e) => e.id === target.id);
                  if (edge) setSelectedEdge(edge);
                }
              }}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            Diagram will appear here once generated
          </div>
        )}

        {/* Snap to Grid Status Toast */}
        {showSnapToast && (
          <div
            id="snap-status-toast"
            className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/95 border border-sky-500/50 shadow-2xl backdrop-blur-md text-xs font-medium text-sky-200 animate-in fade-in zoom-in-95 duration-150 pointer-events-none select-none ring-1 ring-sky-500/20"
          >
            <Magnet className="w-3.5 h-3.5 text-sky-400" />
            <span>{showSnapToast.message}</span>
          </div>
        )}

        {/* Interactive Diagram Minimap (canvas overlay, or docked into the RightPanel) */}
        {(() => {
          const minimap =
            svgContent && !error ? (
              <DiagramMinimap
                svgElement={renderedSvg || getDiagramSvg()}
                containerElement={containerRef.current}
                pan={pan}
                zoom={zoom}
                onPanChange={setPan}
                onResetZoom={handleResetZoom}
                selectedStateId={effectiveSelectedStateId}
                selectedStateLabel={effectiveSelectedStateLabel}
                availableStatesCount={availableStates.length}
                canvasPositions={canvasNodePositions}
                onSelectState={(id) => {
                  handleSelectState(id);
                  panToState(id);
                }}
                isOpen={isMinimapOpen}
                onClose={() => setIsMinimapOpen(false)}
                theme={mermaidTheme}
                docked={false}
              />
            ) : null;
          return minimap;
        })()}

        {/* Connect mode: the new transition follows the mouse */}
        {connectFrom && (
          <div id="connect-mode-hint" className="absolute top-2 left-1/2 -translate-x-1/2 z-40 px-3 py-1 rounded-lg bg-violet-950/90 border border-violet-600 text-[11px] text-violet-100 shadow-lg pointer-events-none">
            New transition from <span className="font-mono">{connectFrom}</span>: click the target state (Esc cancels)
          </div>
        )}
        {connectLine &&
          createPortal(
            <svg className="fixed inset-0 w-screen h-screen pointer-events-none z-[70]">
              <defs>
                <marker id="connect-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#a78bfa" />
                </marker>
              </defs>
              <line x1={connectLine.x1} y1={connectLine.y1} x2={connectLine.x2} y2={connectLine.y2} stroke="#a78bfa" strokeWidth={2.5} strokeDasharray="6 4" markerEnd="url(#connect-arrow)" />
            </svg>,
            document.body
          )}

        {/* Interactive Diagram Legend (canvas overlay) */}
        {svgContent && !error ? (
            <DiagramLegendOverlay
              isOpen={isLegendOpen}
              onClose={() => setIsLegendOpen(false)}
              customStyles={effectiveCustomStyles}
              availableStates={availableStates}
              selectedStateId={effectiveSelectedStateId}
              onSelectState={(id) => {
                handleSelectState(id);
                panToState(id);
              }}
              priorityFormat={priorityFormat}
              availableEdges={availableEdges}
              notes={effectiveNotes}
              containerRef={containerRef}
              docked={false}
            />
          ) : null}

        {/* Real-Time State Machine Statistics & Cyclomatic Analysis (overlay, or docked into the RightPanel) */}
        {renderCanvasPanel(
          'stats',
          'State Machine Real-Time Stats',
          svgContent && !error ? (
            <StateMachineStatsPanel
              isOpen={isStatsOpen}
              onClose={() => setIsStatsOpen(false)}
              availableStates={availableStates}
              availableEdges={availableEdges}
              tcPouContent={tcPouContent}
              selectedStateId={effectiveSelectedStateId}
              onSelectState={(id) => {
                handleSelectState(id);
                panToState(id);
              }}
              onPanToState={panToState}
              onOpenComplexityHeatmap={() => {
                setIsHeatmapActive(true);
                setIsHeatmapPanelOpen(true);
              }}
              diagramVersionKey={`${fileName}_${code}_${availableEdges.length}_${availableStates.length}`}
              docked={Boolean(dockedPanels)}
            />
          ) : null
        )}

        {/* Real-Time Complexity Heat-Map Control Panel (overlay, or docked into the RightPanel) */}
        {renderCanvasPanel(
          'heatmap',
          'Complexity Heat-Map',
          svgContent && !error ? (
            <ComplexityHeatmapPanel
              isOpen={isHeatmapPanelOpen}
              onClose={() => setIsHeatmapPanelOpen(false)}
              heatmapResult={complexityHeatmapResult}
              isHeatmapActive={isHeatmapActive}
              onToggleHeatmap={(active) => setIsHeatmapActive(active)}
              selectedPalette={heatmapPalette}
              onChangePalette={(p) => setHeatmapPalette(p)}
              onlyShowRefactorCandidates={heatmapOnlyRefactor}
              onToggleOnlyShowRefactorCandidates={(val) => setHeatmapOnlyRefactor(val)}
              selectedStateId={effectiveSelectedStateId}
              onSelectState={(id) => {
                handleSelectState(id);
                panToState(id);
              }}
              onPanToState={panToState}
              onOpenMethodEditorForState={(stateId) => {
                if (onOpenInspectorPanel) {
                  handleSelectState(stateId);
                  onOpenInspectorPanel('method', { method: 'doState()' });
                  return;
                }
                setMethodModalInitialMethod(`doState() for ${stateId}`);
                setIsMethodModalOpen(true);
              }}
              refactorThreshold={complexityThreshold}
              onChangeRefactorThreshold={(th) => setComplexityThreshold(th)}
              showComplexityBadges={showComplexityBadges}
              onToggleShowComplexityBadges={(show) => setShowComplexityBadges(show)}
              docked={Boolean(dockedPanels)}
            />
          ) : null
        )}

        {/* Complexity Heat-map / Refactor Badge Hover Tooltip */}
        {(isHeatmapActive || showComplexityBadges) && hoveredComplexityMetric && (
          <div
            id="heatmap-state-hover-tooltip"
            style={{
              position: 'fixed',
              left: `${Math.min(window.innerWidth - 280, hoveredComplexityMetric.anchorX + 16)}px`,
              top: `${Math.min(window.innerHeight - 200, hoveredComplexityMetric.anchorY + 16)}px`,
              zIndex: 60,
            }}
            className="pointer-events-none w-64 p-3 bg-slate-950/95 border border-amber-500/50 rounded-xl shadow-2xl backdrop-blur-md text-xs animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
              <div className="font-bold text-slate-100 truncate flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">{hoveredComplexityMetric.metric.stateLabel}</span>
              </div>
              <span
                className="font-mono font-extrabold text-[11px] px-1.5 py-0.5 rounded text-white shadow-xs"
                style={{
                  backgroundColor: hoveredComplexityMetric.metric.color.badgeBg,
                  border: `1px solid ${hoveredComplexityMetric.metric.color.badgeBorder}`,
                }}
              >
                M={hoveredComplexityMetric.metric.score}
              </span>
            </div>

            <div className="pt-2 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between text-slate-400">
                <span>Tier:</span>
                <span
                  className="font-bold uppercase tracking-wider text-[10px]"
                  style={{ color: hoveredComplexityMetric.metric.color.stroke }}
                >
                  {hoveredComplexityMetric.metric.level}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1 py-1 px-1.5 bg-slate-900/90 rounded border border-slate-800/80 text-[10px]">
                <div className="text-slate-400">
                  Exits: <span className="text-slate-200 font-semibold">{hoveredComplexityMetric.metric.outgoingTransitionsCount}</span>
                </div>
                <div className="text-slate-400">
                  Guards: <span className="text-sky-300 font-semibold">+{hoveredComplexityMetric.metric.guardedTransitionsCount}</span>
                </div>
                <div className="text-slate-400">
                  Compound: <span className="text-amber-300 font-semibold">+{hoveredComplexityMetric.metric.compoundConditionsCount}</span>
                </div>
                <div className="text-slate-400">
                  ST Logic: <span className="text-indigo-300 font-semibold">+{hoveredComplexityMetric.metric.internalDecisionsCount}</span>
                </div>
              </div>

              <div className="text-[10px] text-slate-300 leading-snug">
                <span className="text-amber-300 font-semibold">Insight: </span>
                {hoveredComplexityMetric.metric.refactorRecommendation}
              </div>

              {hoveredComplexityMetric.metric.refactorNeeded && (
                <div className="text-[10px] text-rose-300 font-semibold flex items-center gap-1 bg-rose-950/60 p-1 rounded border border-rose-800/50">
                  <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                  <span>Exceeds refactor threshold (M={hoveredComplexityMetric.metric.score} ≥ {complexityThreshold})</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Visual Badge for Edge Label Guard Condition Expression */}
        {hoveredEdgeCondition && !activeConditionOverlay && (
          <div
            id="edge-guard-condition-hover-badge"
            style={{
              position: 'fixed',
              left: `${Math.min(
                window.innerWidth - 380,
                Math.max(16, (hoveredEdgeCondition.labelRect?.left ?? hoveredEdgeCondition.anchorX) + 12)
              )}px`,
              top: `${
                hoveredEdgeCondition.anchorY > window.innerHeight - 240
                  ? Math.max(16, hoveredEdgeCondition.anchorY - 170)
                  : Math.min(window.innerHeight - 240, (hoveredEdgeCondition.labelRect?.bottom ?? hoveredEdgeCondition.anchorY) + 12)
              }px`,
              zIndex: 60,
            }}
            className="pointer-events-none max-w-sm sm:max-w-md w-auto min-w-[280px] p-3 bg-slate-950/95 border border-sky-500/60 rounded-xl shadow-2xl shadow-sky-950/50 backdrop-blur-md text-xs animate-in fade-in zoom-in-95 duration-150 select-none"
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 rounded-lg bg-sky-500/20 text-sky-400 shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-100 tracking-wide truncate">
                      Guard Condition Expression
                    </span>
                    {hoveredEdgeCondition.hasCompound && (
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 shrink-0">
                        Compound
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono">
                    <span className="text-slate-300 truncate max-w-[110px]" title={hoveredEdgeCondition.edge.from}>
                      {hoveredEdgeCondition.edge.from || '[*]'}
                    </span>
                    <ArrowRight className="w-2.5 h-2.5 text-sky-400 shrink-0" />
                    <span className="text-slate-300 truncate max-w-[110px]" title={hoveredEdgeCondition.edge.to}>
                      {hoveredEdgeCondition.edge.to || '[*]'}
                    </span>
                  </div>
                </div>
              </div>
              {hoveredEdgeCondition.priority !== undefined && (
                <span
                  className="shrink-0 font-mono text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-400/40 shadow-xs"
                  title={`Transition Evaluation Priority: ${hoveredEdgeCondition.priority}`}
                >
                  Prio [{hoveredEdgeCondition.priority}]
                </span>
              )}
            </div>

            <div className="pt-2 space-y-2">
              <div className="bg-slate-900/90 rounded-lg p-2.5 border border-slate-800/80 shadow-inner">
                <div className="text-[9px] uppercase tracking-wider font-semibold text-slate-400 mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Code2 className="w-3 h-3 text-sky-400" />
                    Guard Logic:
                  </span>
                  <span className="text-sky-400/80 font-mono text-[9px]">Structured Text</span>
                </div>
                <pre className="font-mono text-[11px] leading-relaxed text-amber-300 whitespace-pre-wrap break-words font-medium select-text">
                  {hoveredEdgeCondition.fullCondition}
                </pre>
              </div>

              {hoveredEdgeCondition.hasCompound &&
                hoveredEdgeCondition.clauses &&
                hoveredEdgeCondition.clauses.length > 1 && (
                  <div className="space-y-1">
                    <div className="text-[9px] text-slate-400 uppercase font-semibold tracking-wider flex items-center justify-between">
                      <span>Clauses ({hoveredEdgeCondition.clauses.length}):</span>
                      <span className="text-[9px] text-sky-400/70 font-mono">Terms</span>
                    </div>
                    <div className="space-y-1 max-h-24 overflow-y-auto pr-0.5 custom-scrollbar">
                      {hoveredEdgeCondition.clauses.map((clause, idx) => (
                        <div
                          key={idx}
                          className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900/60 border border-slate-800 text-slate-300 truncate"
                          title={clause}
                        >
                          <span className="text-sky-400 font-bold mr-1.5">{idx + 1}.</span>
                          {clause}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {hoveredEdgeCondition.edge.note && (
                <div className="text-[10px] text-amber-200/90 bg-amber-950/30 border border-amber-500/20 rounded p-1.5 truncate">
                  <span className="font-semibold text-amber-400">Note: </span>
                  {hoveredEdgeCondition.edge.note}
                </div>
              )}

              <div className="text-[9px] text-slate-400 flex items-center justify-between pt-0.5 border-t border-slate-800/60">
                <span className="text-slate-400">💡 Click edge label to open Guard Inspector</span>
              </div>
            </div>
          </div>
        )}

        {/* Real-Time Keyword Search & Highlighting Panel (Positioned below Statistics Panel) */}
        {(() => {
          const searchPanel =
            svgContent && !error ? (
              <DiagramSearchPanel
                isOpen={isSearchPanelOpen}
                onClose={() => setIsSearchPanelOpen(false)}
                searchQuery={effectiveSearchQuery}
                onSearchChange={handleSearchChange}
                onClearSearch={clearSearch}
                matches={matches}
                activeMatchIndex={activeMatchIndex}
                matchesBreakdown={matchesBreakdown}
                onSelectMatch={switchActiveMatch}
                onNextMatch={goToNextMatch}
                onPrevMatch={goToPrevMatch}
                availableStates={availableStates}
                availableEdges={availableEdges}
                onSelectState={(id, label) => {
                  handleSelectState(id, label);
                }}
                onSelectEdge={(edge) => {
                  setSelectedEdge(edge);
                }}
                onPanToElement={(el) => {
                  panToElement(el);
                  if (el.classList.contains('node') || el.closest('g.node')) {
                    const nodeG = (el.classList.contains('node') ? el : el.closest('g.node')) as SVGGElement;
                    if (nodeG) triggerNodeJumpHighlight(nodeG);
                  }
                }}
                isStatsOpen={isStatsOpen}
                diagramVersionKey={`${fileName}_${code}_${availableEdges.length}_${availableStates.length}`}
                docked={Boolean(dockedPanels)}
              />
            ) : null;
          if (!dockedPanels) return searchPanel;
          return createPortal(
            searchPanel ?? <DockedPanelPlaceholder label="Keyword Search & Filter" />,
            dockedPanels.targets.search
          );
        })()}

        {/* Floating State Node Style Inspector */}
        {isInspectorOpen && (
          <StateNodeStyleInspector
            selectedStateId={effectiveSelectedStateId}
            selectedStateLabel={effectiveSelectedStateLabel}
            availableStates={availableStates}
            customStyles={effectiveCustomStyles}
            onStyleChange={handleStyleChange}
            onResetStateStyle={handleResetStateStyle}
            onClearAllCustomStyles={handleClearAllCustomStyles}
            onSelectState={(id, label) => {
              handleSelectState(id, label);
              if (id) panToState(id);
            }}
            onClose={handleCloseInspector}
            tcPouContent={tcPouContent}
            tcPouFileName={tcPouFileName || fileName}
            tcDutContent={tcDutContent}
            tcDutFileName={tcDutFileName}
            onSaveDutContent={onSaveDutContent}
            onSaveMethodCode={onSaveMethodCode}
            onSaveStateCode={onSaveStateCode}
            onSavePreProcessCode={onSavePreProcessCode}
            initialMode="method"
            notes={effectiveNotes}
            onSaveNote={onSaveNote}
            onDeleteNote={onDeleteNote}
            onUpdateNoteStyle={onUpdateNoteStyle}
          />
        )}

        {/* Modal for Method Editor */}
        {isMethodModalOpen && (
          <StateNodeStyleInspector
            selectedStateId={effectiveSelectedStateId}
            selectedStateLabel={effectiveSelectedStateLabel}
            availableStates={availableStates}
            customStyles={effectiveCustomStyles}
            onStyleChange={handleStyleChange}
            onResetStateStyle={handleResetStateStyle}
            onClearAllCustomStyles={handleClearAllCustomStyles}
            onSelectState={(id, label) => {
              handleSelectState(id, label);
              if (id) panToState(id);
            }}
            onClose={() => setIsMethodModalOpen(false)}
            tcPouContent={tcPouContent}
            tcPouFileName={tcPouFileName || fileName}
            tcDutContent={tcDutContent}
            tcDutFileName={tcDutFileName}
            onSaveDutContent={onSaveDutContent}
            onSaveMethodCode={onSaveMethodCode}
            onSaveStateCode={onSaveStateCode}
            onSavePreProcessCode={onSavePreProcessCode}
            initialMode="method"
            initialMethod={methodModalInitialMethod}
            notes={effectiveNotes}
            onSaveNote={onSaveNote}
            onDeleteNote={onDeleteNote}
            onUpdateNoteStyle={onUpdateNoteStyle}
          />
        )}

        {/* Modal for Enum Editor */}
        {isEnumModalOpen && (
          <StateNodeStyleInspector
            selectedStateId={effectiveSelectedStateId}
            selectedStateLabel={effectiveSelectedStateLabel}
            availableStates={availableStates}
            customStyles={effectiveCustomStyles}
            onStyleChange={handleStyleChange}
            onResetStateStyle={handleResetStateStyle}
            onClearAllCustomStyles={handleClearAllCustomStyles}
            onSelectState={(id, label) => {
              handleSelectState(id, label);
              if (id) panToState(id);
            }}
            onClose={() => setIsEnumModalOpen(false)}
            tcPouContent={tcPouContent}
            tcPouFileName={tcPouFileName || fileName}
            tcDutContent={tcDutContent}
            tcDutFileName={tcDutFileName}
            onSaveDutContent={onSaveDutContent}
            onSaveMethodCode={onSaveMethodCode}
            onSaveStateCode={onSaveStateCode}
            onSavePreProcessCode={onSavePreProcessCode}
            initialMode="enum"
            initialEnumMember={enumModalInitialMember}
            notes={effectiveNotes}
            onSaveNote={onSaveNote}
            onDeleteNote={onDeleteNote}
            onUpdateNoteStyle={onUpdateNoteStyle}
          />
        )}

        {/* Floating Transition Guard & Condition Inspector */}
        {stylePopup && (
          <StateStylePopup
            stateId={stylePopup.stateId}
            stateLabel={availableStates.find((s) => s.id === stylePopup.stateId)?.label}
            anchorRect={stylePopup.anchorRect}
            containerRef={containerRef}
            availableStates={availableStates}
            customStyles={effectiveCustomStyles}
            onStyleChange={handleStyleChange}
            onResetStateStyle={handleResetStateStyle}
            onClearAllCustomStyles={handleClearAllCustomStyles}
            onSelectState={(id, label) => {
              // Picking another state inside the window keeps the window on that state
              handleSelectState(id, label);
              if (id) {
                setStylePopup((prev) => (prev ? { ...prev, stateId: id } : prev));
                panToState(id);
              }
            }}
            onClose={() => setStylePopup(null)}
          />
        )}

        {activeConditionOverlay && (
          <TransitionGuardInspector
            edge={activeConditionOverlay.edge}
            anchorPos={activeConditionOverlay.anchorPos}
            containerRef={containerRef}
            notes={effectiveNotes}
            onClose={() => setActiveConditionOverlay(null)}
            edgeStyle={customEdgeStyles?.[activeConditionOverlay.edge.id]}
            onShowInXae={onShowInXae ? () => onShowInXae({ kind: 'edge', edge: activeConditionOverlay.edge }) : undefined}
            onEdgeStyleChange={
              onEdgeStyleChange ? (style) => onEdgeStyleChange(activeConditionOverlay.edge.id, style) : undefined
            }
            onSelectState={(id, label) => {
              handleSelectState(id, label);
              panToState(id);
            }}
            onOpenNoteEditor={(edge) => {
              handleOpenAddNote({
                type: 'edge',
                id: edge.id,
                from: edge.from,
                to: edge.to,
                label: edge.label,
                note: edge.note,
                pathId: edge.pathId,
              });
            }}
          />
        )}

        {/* Right-click Context Menu */}
        {contextMenuState && (
          <DiagramContextMenu
            x={contextMenuState.x}
            y={contextMenuState.y}
            target={contextMenuState.target}
            onAddOrEditNote={handleOpenAddNote}
            onDeleteNote={handleDeleteActiveNote}
            extraItems={contextMenuItems?.(contextMenuState.target)}
            onShowInXae={
              onShowInXae
                ? (target: ContextMenuTarget) => {
                    if (target.type === 'node') onShowInXae({ kind: 'state', id: target.id });
                    else if (target.type === 'edge') {
                      const edge = availableEdges.find((e) => e.id === target.id) ?? { id: target.id, from: target.from, to: target.to, label: target.label };
                      onShowInXae({ kind: 'edge', edge });
                    }
                  }
                : undefined
            }
            onOpenStyleCustomizer={(stateId: string) => {
              const st = availableStates.find((s) => s.id === stateId);
              handleSelectState(stateId, st?.label || stateId);
              if (onOpenInspectorPanel) openStylePopup(stateId);
              else setIsInspectorOpen(true);
            }}
            onOpenMethodEditor={(m) => {
              if (onOpenInspectorPanel) return onOpenInspectorPanel('method', { method: m || undefined });
              if (m) setMethodModalInitialMethod(m);
              setIsMethodModalOpen(true);
            }}
            onOpenPreProcessEditor={() => {
              if (onOpenInspectorPanel) return onOpenInspectorPanel('method', { method: 'preProcess()' });
              setMethodModalInitialMethod('preProcess()');
              setIsMethodModalOpen(true);
            }}
            onOpenMermaidLive={onOpenMermaidLive}
            onOpenEnumEditor={(memberName) => {
              if (onOpenEnumEditorProp) {
                onOpenEnumEditorProp(memberName);
              } else {
                setEnumModalInitialMember(memberName);
                setIsEnumModalOpen(true);
              }
            }}
            onExportImage={(fmt) => handleOpenExportModal(fmt)}
            onToggleLegend={() => setIsLegendOpen((prev) => !prev)}
            onToggleStats={() => setIsStatsOpen((prev) => !prev)}
            onToggleSearch={() => setIsSearchPanelOpen((prev) => !prev)}
            onToggleHeatmap={() => {
              setIsHeatmapActive((prev) => {
                const next = !prev;
                if (next) setIsHeatmapPanelOpen(true);
                return next;
              });
            }}
            isHeatmapActive={isHeatmapActive}
            onToggleLockLayout={handleToggleLayoutLocked}
            isLayoutLocked={isLayoutLocked}
            onClose={() => setContextMenuState(null)}
          />
        )}

        {/* High-Resolution Export Modal */}
        <ExportModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          svgElement={getActiveSvgElement()}
          baseFileName={fileName}
          notes={effectiveNotes}
          customStyles={effectiveCustomStyles}
          theme={mermaidTheme}
          defaultFormat={exportModalDefaultFormat}
          defaultScale={exportSettings?.scale}
          defaultBackground={defaultExportBackground}
          onToast={onToastProp}
        />

        {/* Export Notification Toast (Fallback if no external toast provider) */}
        {!onToastProp && exportingNotification && (
          <div
            id="export-toast-notification"
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900/95 border border-sky-500/50 shadow-2xl text-xs text-white backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-200 pointer-events-none"
          >
            <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
            <span>{exportingNotification}</span>
          </div>
        )}

        {/* Layout Lock Toast Notification */}
        {layoutLockToast && (
          <div
            id="layout-lock-toast-notification"
            className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl border shadow-2xl text-xs backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-200 pointer-events-none ${
              layoutLockToast.locked
                ? 'bg-amber-950/95 border-amber-500/60 text-amber-200'
                : 'bg-slate-900/95 border-slate-700/60 text-slate-200'
            }`}
          >
            {layoutLockToast.locked ? (
              <Lock className="w-4 h-4 text-amber-400 shrink-0" />
            ) : (
              <Unlock className="w-4 h-4 text-slate-400 shrink-0" />
            )}
            <span>{layoutLockToast.message}</span>
          </div>
        )}

        {/* Note Dialog Modal */}
        <NoteDialog
          isOpen={isNoteDialogOpen}
          target={activeNoteTarget}
          currentNote={activeNoteTarget && activeNoteTarget.type !== 'canvas' ? activeNoteTarget.note : ''}
          onSave={handleSaveActiveNote}
          onDelete={handleDeleteActiveNote}
          onClose={() => setIsNoteDialogOpen(false)}
        />

        {/* Notes (slide-over drawer, or docked into the RightPanel) */}
        {renderCanvasPanel(
          'notes',
          'Notes',
          <NotesDrawer
            isOpen={isNotesDrawerOpen}
            notes={effectiveNotes}
            onSelectTarget={(target: ContextMenuTarget) => {
              if (target.type === 'node') {
                handleSelectState(target.id, target.label || target.id);
                panToState(target.id);
              } else if (target.type === 'edge') {
                const edge = availableEdges.find((e) => e.id === target.id);
                if (edge) setSelectedEdge(edge);
                panToEdge(target.id);
              }
            }}
            onEditNote={(target: ContextMenuTarget) => {
              setActiveNoteTarget(target);
              setIsNoteDialogOpen(true);
            }}
            onDeleteNote={(target: ContextMenuTarget) => {
              handleDeleteActiveNote(target);
            }}
            onClearAllNotes={() => {
              onClearAllNotes?.();
            }}
            onOpenMermaidLive={() => {
              onOpenMermaidLive?.();
            }}
            onClose={() => setIsNotesDrawerOpen(false)}
            docked={Boolean(dockedPanels)}
          />
        )}
      </div>
    </div>
  );
});

MermaidViewer.displayName = 'MermaidViewer';
