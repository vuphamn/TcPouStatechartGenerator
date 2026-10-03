import React, { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
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
  Pin,
  PinOff,
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
  MessageSquare,
  Grid3x3,
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
  Spline,
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
import { StatechartPalette, PALETTE_MIME, PaletteElement } from './StatechartPalette.tsx';
import { listenOnAppWindows } from '../utils/appWindows.ts';
import { NoteOverlaysLayer } from './NoteOverlaysLayer.tsx';
import { ExportModal } from './ExportModal.tsx';
import { TransitionGuardInspector } from './TransitionGuardInspector.tsx';
import { PreProcessStructuredTextEditor } from './PreProcessStructuredTextEditor.tsx';
import { MethodStructuredTextEditor } from './MethodStructuredTextEditor.tsx';
import { StateActionsPreview } from './StateActionsPreview.tsx';
import { NodeHoverBox, type ScreenRect } from './NodeHoverBox.tsx';
import { DutEnumEditor } from './DutEnumEditor.tsx';
import { createInteractiveMermaidCode, parseConditionClauses } from '../utils/interactiveDiagram.ts';
import {
  exportHighResSvg,
  exportHighResPng,
  copyToClipboard,
  copyTextToClipboard,
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
  routeToNewEnd,
  frozenMidOf,
  getNodeGeometry,
  nodeShapeOf,
  nodeBoxOf,
  gapOutside,
  isDiamondNode,
  resolveNodeOffset,
  parseSvgPathCommands,
  extractCoordinatePoints,
  type NodeBox,
} from '../utils/nodeDragger.ts';
import { relayoutEdgeRoute } from '../utils/edgeRelayout.ts';
import { COMPOSITE_SELECTOR, compositeMembersOf, compositeNameOf, compositeRectsOf, growCompositesToMembers } from '../utils/compositeBounds.ts';
import {
  CanvasNodePositionsMap,
  extractCanvasNodePositions,
} from '../utils/canvasPositions.ts';
import { compositeColors } from '../utils/compositeColors.ts';
import { canvasBackgroundOf, ideThemeOf, isDarkTheme, mermaidThemeOptions } from '../utils/ideThemes.ts';

export type LayoutEngine = 'dagre' | 'elk';
export type FlowchartCurve = 'basis' | 'linear' | 'cardinal' | 'stepAfter' | 'monotoneX' | 'natural';
export type MermaidTheme = 'dark' | 'neutral' | 'forest' | 'base' | 'default' | import('../utils/ideThemes.ts').IdeThemeId;

/**
 * Composite states (and parallel regions): a sand border, dashed, with a faint tint of the same and the title in it,
 * so the box reads as a container, apart from the grey edges and the states (sand is used for nothing else on the
 * canvas: sky blue is hover and selection, amber the selected badge, emerald live, violet paths). In the SVG itself,
 * so the exports (SVG, PNG) keep it; :where() keeps it below the canvas's own marks (live, search). Dark theme: light
 * sand; the light themes: a darker one
 */
export function compositeStyle(theme: MermaidTheme | undefined, preset: string = 'sand', own: Record<string, string> = {}): string {
  const dark = isDarkTheme(theme);
  // (scope: which clusters, as the inside of a :where(); the rules for one composite come after all's, as specific)
  const rules = (scope: string[], color: string) => {
    const c = compositeColors(color, dark);
    if (!c) return '';
    const flow = scope.map((s) => `.cluster${s}`).join(', ');
    const state = scope.map((s) => `.statediagram-cluster${s}`).join(', ');
    return `:where(${flow}) > rect, :where(${state}) > rect.outer, :where(${state}) > g:not(.cluster-label) > :is(path, rect) { stroke: ${c.line} !important; stroke-width: 1.5px !important; stroke-dasharray: 8 4 !important; fill: ${c.tint} !important; rx: 8px; ry: 8px; }
:where(${state}) > rect.inner { fill: transparent !important; stroke: none !important; }
:where(${state}) .divider { stroke: ${c.line} !important; stroke-dasharray: 8 4 !important; }
:where(${flow.split(', ').map((s) => `${s} .cluster-label`).join(', ')}, ${state.split(', ').map((s) => `${s} .cluster-label`).join(', ')}) :is(span, p, text, div) { color: ${c.title} !important; fill: ${c.title} !important; font-weight: 600 !important; }
`;
  };
  // (a composite's cluster: its id is its name, after the render's id and a dash)
  const idOf = (name: string) => name.replace(/[.\-\s]/g, '_').replace(/["\\]/g, '');
  const ownRules = Object.entries(own)
    .map(([name, color]) => rules([`[id="${idOf(name)}"]`, `[id$="-${idOf(name)}"]`, `[data-id="${idOf(name)}"]`], color))
    .join('');
  // (Forest's green states are close to sand: its composites slate)
  const base = theme === 'forest' && preset === 'sand' ? 'slate' : preset;
  return `<style class="kss-composite-style">
${rules([''], base)}${ownRules}${dark ? '' : LIGHT_THEME_CSS}</style>`;
}

/**
 * The light themes (default, base, forest, neutral): the canvas' marks in colours that read on white. The complexity
 * badges' level colours darker (white text on them), a soft shadow for their glow; a state that needs refactoring
 * outlined in rose instead of its pulsing glow; the edge labels a neutral chip (at the lowest specificity: the
 * canvas' own label marks win); hover sky-600, the selected transition's badge amber-600 with white text
 */
const LIGHT_THEME_CSS = `
.tc-complexity-badge.is-critical rect, .tc-complexity-badge.lvl-critical rect { fill: #be123c !important; stroke: #9f1239 !important; }
.tc-complexity-badge.is-high rect, .tc-complexity-badge.lvl-high rect { fill: #b45309 !important; stroke: #92400e !important; }
.tc-complexity-badge.is-moderate rect, .tc-complexity-badge.lvl-moderate rect { fill: #0369a1 !important; stroke: #075985 !important; }
.tc-complexity-badge.lvl-low rect { fill: #047857 !important; stroke: #065f46 !important; }
.tc-complexity-badge text { fill: #ffffff !important; }
.tc-complexity-badge :is(polygon, line) { stroke: #ffffff !important; }
.tc-complexity-badge circle { fill: #ffffff !important; }
.tc-refactor-flag-badge, .tc-refactor-flag-badge.is-critical, .tc-refactor-flag-badge.is-high { filter: drop-shadow(0 1px 2px rgba(15, 23, 42, 0.35)) !important; }
.complexity-refactor-needed { animation: none !important; filter: none !important; }
g.node.complexity-refactor-needed > :is(rect, polygon, path.basic, .label-container) { stroke: #e11d48 !important; stroke-width: 2px !important; }
:where(.edgeLabel) :where(p, span, .labelBkg), :where(.edgeLabel) { background-color: rgba(255, 255, 255, 0.92) !important; color: #1e293b !important; }
:where(.edgeLabel) :where(.labelBkg, p) { box-shadow: inset 0 0 0 1px #cbd5e1; border-radius: 2px; }
:where(.edgeLabel) :where(rect) { fill: rgba(255, 255, 255, 0.92) !important; stroke: #cbd5e1 !important; }
.tc-edge-path:hover, .tc-edge-path.tc-edge-hover, .tc-edge-path.tc-edge-pointer-hover { stroke: #0284c7 !important; filter: drop-shadow(0 0 3px rgba(2, 132, 199, 0.45)); }
.tc-priority-badge:hover circle, .tc-priority-badge.tc-priority-badge-hover circle, .tc-priority-badge.tc-priority-badge-pointer-hover circle { fill: #0284c7 !important; stroke: #075985 !important; }
.tc-priority-badge:hover text, .tc-priority-badge.tc-priority-badge-hover text, .tc-priority-badge.tc-priority-badge-pointer-hover text { fill: #ffffff !important; }
.tc-priority-badge.tc-priority-badge-selected circle, .tc-priority-badge.tc-priority-badge-selected.tc-priority-badge-hover circle, .tc-priority-badge.tc-priority-badge-selected.tc-priority-badge-pointer-hover circle, .tc-priority-badge.tc-priority-badge-selected:hover circle { fill: #d97706 !important; stroke: #ffffff !important; }
.tc-priority-badge.tc-priority-badge-selected text, .tc-priority-badge.tc-priority-badge-selected:hover text { fill: #ffffff !important; }
g.node.tc-end-hover > :is(rect, polygon, circle, ellipse, path.basic, .label-container), g.node.tc-end-pointer-hover > :is(rect, polygon, circle, ellipse, path.basic, .label-container), g.cluster.tc-end-hover > rect, g.cluster.tc-end-pointer-hover > rect { stroke: #0284c7 !important; }
`;

/** The composites' style put into a rendered diagram's SVG (right after its opening tag) */
export function withCompositeStyle(svg: string, theme: MermaidTheme | undefined, preset?: string, own?: Record<string, string>): string {
  const at = svg.indexOf('>', svg.indexOf('<svg'));
  return at < 0 ? svg : svg.slice(0, at + 1) + compositeStyle(theme, preset, own) + svg.slice(at + 1);
}

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
  /** Several states lined up (their left / centre / right / top / middle / bottom edge) or spread evenly */
  arrangeStates: (ids: string[], mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distribute-h' | 'distribute-v') => void;
  /**
   * Tidy up the edges: the states left where they are, each edge's own route (its waypoints, moved ends, moved label)
   * dropped, so it is drawn again from its states' places (Dagre: the ends on a side spread, the labels apart). How
   * many edges had a route of their own
   */
  tidyEdges: () => number;
}

/** Each drawn transition's key across drawings: FROM->TO, #2, #3 … for more between the same states (in their order) */
// (globalThis.Map: this file imports an icon called Map)
function transitionKeysOf(svg: SVGSVGElement): globalThis.Map<SVGPathElement, string> {
  const seen = new globalThis.Map<string, number>();
  const out = new globalThis.Map<SVGPathElement, string>();
  for (const p of edgePathsOf(svg)) {
    const from = p.getAttribute('data-source-id');
    const to = p.getAttribute('data-target-id');
    if (!from || !to) continue;
    const pair = `${from}->${to}`;
    const n = (seen.get(pair) ?? 0) + 1;
    seen.set(pair, n);
    out.set(p, n > 1 ? `${pair}#${n}` : pair);
  }
  return out;
}
/** The routes by transition (from the drawing's path / edge ids); ones of paths no longer drawn left out */
function edgeOffsetsByTransition(svg: SVGSVGElement, offsets: EdgeOffsetsMap): EdgeOffsetsMap {
  const keys = transitionKeysOf(svg);
  const out: EdgeOffsetsMap = {};
  for (const [id, o] of Object.entries(offsets)) {
    const p = [...keys.keys()].find((x) => x.getAttribute('data-path-id') === id || x.getAttribute('data-edge-id') === id);
    const k = p ? keys.get(p) : null;
    if (k) out[k] = o;
  }
  return out;
}
/** The routes by transition put on this drawing's paths (their path ids) */
function edgeOffsetsOnPaths(svg: SVGSVGElement, byTransition: EdgeOffsetsMap): EdgeOffsetsMap {
  const out: EdgeOffsetsMap = {};
  for (const [p, k] of transitionKeysOf(svg)) {
    const o = byTransition[k];
    const id = p.getAttribute('data-path-id');
    if (o && id) out[id] = o;
  }
  return out;
}
/** A transition's end dropped on another state: which end, the transition, the state, its route then */
interface MovedEnd {
  atStart: boolean;
  from: string;
  to: string;
  newId: string;
  d: string;
}
/** A transition's route as drawn (its path's d, its label's place), kept across an edit from the canvas */
interface KeptRoute {
  d: string;
  label: string | null;
}
const routeKeyOf = (svg: SVGSVGElement, path: SVGPathElement) => {
  const from = path.getAttribute('data-source-id');
  const to = path.getAttribute('data-target-id');
  if (!from || !to) return null;
  const pid = path.getAttribute('data-path-id') || path.id;
  const label = pid ? svg.querySelector<SVGGElement>(`g.edgeLabel[data-linked-path-id="${CSS.escape(pid)}"]`) : null;
  return { pair: `${from}->${to}`, key: `${from}->${to}|${(label?.textContent ?? '').replace(/\s+/g, ' ').trim()}`, label };
};
const edgePathsOf = (svg: SVGSVGElement) =>
  Array.from(svg.querySelectorAll<SVGPathElement>('g.edgePaths path.tc-edge-path')).filter((p) => !p.classList.contains('tc-edge-hitbox') && p.getAttribute('d'));
/** Each transition's route now, by its states and its label (parallel ones in order) */
function keptRoutesOf(svg: SVGSVGElement): Record<string, KeptRoute[]> {
  const out: Record<string, KeptRoute[]> = {};
  for (const path of edgePathsOf(svg)) {
    const k = routeKeyOf(svg, path);
    if (!k) continue;
    const r = { d: path.getAttribute('d') || '', label: k.label?.getAttribute('transform') ?? null };
    (out[k.key] ??= []).push(r);
    (out[`pair:${k.pair}`] ??= []).push(r);
  }
  return out;
}
/** A composite's box as drawn (its rect, its title's place; in its group's own coordinates, the group's place) */
type KeptBox = { x: number; y: number; width: number; height: number } | null;
interface KeptCluster {
  at: { x: number; y: number };
  outer: KeptBox;
  inner: KeptBox;
  label: { x: number; y: number } | null;
}
const clusterPartsOf = (c: Element) => ({
  ...compositeRectsOf(c),
  label: c.querySelector<SVGGElement>(':scope > g.cluster-label'),
  at: parseTranslation(c.getAttribute('data-orig-transform') ?? c.getAttribute('transform') ?? ''),
});
const boxOfRect = (r: SVGRectElement | null): KeptBox => {
  const n = (a: string) => parseFloat(r?.getAttribute(a) ?? 'NaN');
  return r && [n('x'), n('y'), n('width'), n('height')].every(Number.isFinite) ? { x: n('x'), y: n('y'), width: n('width'), height: n('height') } : null;
};
/** Each composite's box now (a flowchart's subgraph, a state diagram's composite), by its name */
function keptClustersOf(svg: SVGSVGElement): Record<string, KeptCluster> {
  const out: Record<string, KeptCluster> = {};
  for (const c of svg.querySelectorAll(COMPOSITE_SELECTOR)) {
    const { outer, inner, label, at } = clusterPartsOf(c);
    out[compositeNameOf(c)] = { at, outer: boxOfRect(outer), inner: boxOfRect(inner), label: label ? parseTranslation(label.getAttribute('transform') ?? '') : null };
  }
  return out;
}
/** The new drawing's composites as they were drawn: the layout sized them for its own places, not the states' kept ones */
function restoreKeptClusters(svg: SVGSVGElement, kept: Record<string, KeptCluster>) {
  for (const c of svg.querySelectorAll(COMPOSITE_SELECTOR)) {
    const k = kept[compositeNameOf(c)];
    if (!k) continue;
    const { outer, inner, label, at } = clusterPartsOf(c);
    // (its group placed elsewhere this time: the box where it was all the same)
    const dx = k.at.x - at.x;
    const dy = k.at.y - at.y;
    const put = (r: SVGRectElement | null, b: KeptBox) => {
      if (!r || !b) return;
      r.setAttribute('x', String(b.x + dx));
      r.setAttribute('y', String(b.y + dy));
      r.setAttribute('width', String(b.width));
      r.setAttribute('height', String(b.height));
    };
    put(outer, k.outer);
    put(inner, k.inner);
    if (label && k.label) label.setAttribute('transform', `translate(${k.label.x + dx}, ${k.label.y + dy})`);
  }
}
/**
 * The new drawing's transitions given their kept routes: the same states and label (else the only one between the
 * same states, its label changed: the other arm of an IF / ELSE moved); a new one (the one moved) routed afresh
 */
function restoreKeptRoutes(svg: SVGSVGElement, kept: Record<string, KeptRoute[]>, moved: MovedEnd | null = null, places: Record<string, { centerX: number; centerY: number }> = {}) {
  const used = new Set<KeptRoute>();
  const kept1 = new Set<SVGPathElement>();
  const paths = edgePathsOf(svg);
  const keys = paths.map((p) => routeKeyOf(svg, p));
  const pairs: Record<string, number> = {};
  for (const k of keys) if (k) pairs[k.pair] = (pairs[k.pair] ?? 0) + 1;
  paths.forEach((path, i) => {
    const k = keys[i];
    if (!k) return;
    let r = (kept[k.key] ?? []).find((x) => !used.has(x));
    if (!r && pairs[k.pair] === 1 && kept[`pair:${k.pair}`]?.length === 1 && !used.has(kept[`pair:${k.pair}`][0])) r = kept[`pair:${k.pair}`][0];
    if (!r || !r.d) return;
    used.add(r);
    kept1.add(path);
    path.setAttribute('data-frozen-d', r.d);
    path.removeAttribute('data-frozen-sig');
    if (k.label && r.label) {
      k.label.setAttribute('data-frozen-transform', r.label);
      k.label.removeAttribute('data-frozen-ldx');
      k.label.removeAttribute('data-frozen-ldy');
    }
  });
  // The transition moved: from (to) its new state, square to its side, then its other end's stretch as it was
  if (!moved || !moved.d) return;
  const from = moved.atStart ? moved.newId : moved.from;
  const to = moved.atStart ? moved.to : moved.newId;
  const path = paths.find((p) => !kept1.has(p) && p.getAttribute('data-source-id') === from && p.getAttribute('data-target-id') === to);
  const node = findNodeElement(svg, moved.newId);
  if (!path || !node) return;
  const g = getNodeGeometry(node, svg);
  const at = places[moved.newId];
  // (the other states, where they are kept: its new part clear of them)
  const obstacles: { cx: number; cy: number; hw: number; hh: number }[] = [];
  for (const n of svg.querySelectorAll<SVGGElement>('g.node[data-state-id]')) {
    const id = n.getAttribute('data-state-id') || '';
    if (id === moved.newId) continue;
    const q = getNodeGeometry(n, svg);
    obstacles.push({ cx: places[id]?.centerX ?? q.origCenterX, cy: places[id]?.centerY ?? q.origCenterY, hw: q.width / 2, hh: q.height / 2 });
  }
  const d = routeToNewEnd(moved.d, { cx: at?.centerX ?? g.origCenterX, cy: at?.centerY ?? g.origCenterY, hw: g.width / 2, hh: g.height / 2 }, moved.atStart, obstacles);
  if (!d) return;
  path.setAttribute('data-frozen-d', d);
  path.removeAttribute('data-frozen-sig');
  // (its label halfway along its new route, as the others are on theirs; moved with it afterwards)
  const label = routeKeyOf(svg, path)?.label;
  if (label) {
    const m = frozenMidOf(d);
    label.setAttribute('data-frozen-transform', `translate(${m.x}, ${m.y})`);
    label.removeAttribute('data-frozen-ldx');
    label.removeAttribute('data-frozen-ldy');
  }
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
  /** The Transition Guard window's Edit: the transition's condition (the app asks for it, by the label) */
  onEditTransitionCondition?: (edge: EdgeInfo) => void;
  /** States with lint problems (Problems tab): a badge on their node */
  problemMarkers?: Record<string, 'error' | 'warning'>;
  /** Bookmarked states: a badge at their top-left corner */
  bookmarkedStates?: string[];
  /**
   * Expanded: the canvas fills the window (the app's Focus mode: the header and the side panels hidden), its toolbar
   * then drawn on the canvas itself; onExpandedChange: Expand / its exit asks the app for it
   */
  expanded?: boolean;
  onExpandedChange?: (on: boolean) => void;
  /** A click on a state's bookmark ribbon: its bookmark off */
  onToggleStateBookmark?: (stateId: string) => void;
  /** The states whose code changed since the POU was saved (an amber dot on them, the minimap and search) */
  changedStates?: string[];
  /** A state's tooltip (its entry / do / exit actions), by state */
  stateTooltips?: Record<string, string>;
  /** The Problems tab's findings in a state's code (their messages, the names they flag), by state */
  stateProblems?: Record<string, { messages: string[]; names: string[] }>;
  /** A line on top of the canvas about the chart (a diagram learned live) */
  canvasBanner?: string;
  /** A button in the banner */
  canvasBannerAction?: { id: string; label: string; title?: string; onClick: () => void };
  /** Several states moved together, snapping on: each of them on the grid (else they keep their places to the one dragged) */
  groupSnapEach?: boolean;
  /** Several states selected (Ctrl+click, Shift+drag a box): marked; the app's menu acts on all of them */
  multiSelection?: string[];
  onMultiSelectionChange?: (ids: string[]) => void;
  /** Shift + a box drawn around states: they are selected, and the app may offer to group them into a composite */
  onBoxSelected?: (ids: string[]) => void;
  /** Live view: the PLC's current state (and the one it came from) are highlighted */
  /** stuck: longer in the state than its time limit (red) */
  liveHighlight?: { stateId: string; previousStateId?: string; stuck?: boolean; regionStates?: string[] } | null;
  /** Measured state times on the diagram: level 0 (quick) to 4 (slow), the badge's text and its tooltip */
  stateTimes?: Record<string, { level: number; label: string; title: string }> | null;
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
  /** A transition's start or end handle dropped on another state: the app changes the code (the drag is undone) */
  onEdgeEndpointDrop?: (edge: EdgeInfo, end: 'start' | 'end', stateId: string) => void;
  /** The transitions of the code a drawn edge stands for, with their priorities (a composite's collapsed edge: several, listed in its guard popup) */
  edgeMembersOf?: (from: string, to: string) => { from: string; to: string; priority?: number | null }[];
  /** One of those picked in the guard popup: its code opened */
  onOpenTransitionCode?: (from: string, to: string) => void;
  /** Go to code: an edge's condition where it is in the code (doState() or preProcess()) */
  onGoToEdgeCode?: (edge: EdgeInfo) => void;
  /** The composites' colour (a preset: sand, slate, …, plain) and each one's own (its {region}'s // @color) */
  compositeColor?: string;
  compositeOwnColors?: Record<string, string>;
  /**
   * The statechart palette is shown: an element dropped on a state, in a composite or on the canvas (at: where), or
   * clicked (at: null)
   */
  onPaletteElement?: (kind: PaletteElement, at: { stateId: string | null; composite: string | null; x: number; y: number } | null) => void;
  /** Undo / Redo (on the palette) */
  history?: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void };
  /** A state's node dragged and released: the composites (cluster labels) under the pointer, smallest first */
  onStateDropped?: (stateId: string, composites: string[], altKey: boolean) => void;
  /** A composite dragged by its title and released: the composite under the pointer (not itself or one of its own), or null */
  onCompositeDropped?: (composite: string, into: string | null) => void;
  /** Move this (new) state's node to that point of the screen, once the chart has it */
  placeRequest?: { stateId: string; x: number; y: number; nonce: number } | null;
  /** Keys on the canvas (not while typing or with a menu / dialog open), with the selection; true: handled */
  onCanvasKey?: (e: KeyboardEvent, selection: { stateId: string | null; edge: EdgeInfo | null }) => boolean;
  nodeOffsets?: NodeOffsetsMap;
  /** Changed: the states kept where they are in the drawing that follows (an undo / redo of a code change) */
  keepPositionsSignal?: number;
  /** (auto: the canvas' own placing, the locked layout's or a drop's: no undo step of its own) */
  onNodeOffsetsChange?: (offsets: NodeOffsetsMap, opts?: { auto?: boolean }) => void;
  /**
   * The transitions' dragged routes and labels to start from (a POU's layout file), by transition (FROM->TO, #2 for a
   * second one between them): taken when edgeOffsetsKey changes, on the drawing after it
   */
  initialEdgeOffsets?: EdgeOffsetsMap;
  edgeOffsetsKey?: string;
  /**
   * The states put at these places (their centers in the drawing) in the drawing after pinPositions.key changes: a
   * layout file made with another layout engine (its offsets are that engine's)
   */
  pinPositions?: { key: string; positions: Record<string, { centerX: number; centerY: number }> };
  /** The transitions' dragged routes and labels changed: by transition (FROM->TO, #2 …), as initialEdgeOffsets */
  onEdgeOffsetsChange?: (offsets: EdgeOffsetsMap) => void;
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

/**
 * A state's box in its drawing's coordinates (the drawing not laid out yet: from its group's translate and its shape's
 * own attributes, a rect, polygon, circle or path), among a root's nodes; null when not there
 */
function nodeBoxIn(root: Element, stateId: string): { x0: number; y0: number; x1: number; y1: number } | null {
  const esc = stateId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const idRx = new RegExp(`(^|-)${esc}-\\d+$`);
  const node = Array.from(root.querySelectorAll('g.node')).find((n) => n.getAttribute('data-state-id') === stateId || idRx.test(n.getAttribute('id') || '') || n.getAttribute('data-id') === stateId);
  if (!node) return null;
  const t = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/.exec(node.getAttribute('transform') || '');
  const tx = t ? Number(t[1]) : 0;
  const ty = t ? Number(t[2]) : 0;
  const shape = node.querySelector(':scope > rect, :scope > polygon, :scope > circle, :scope > path, :scope > g > rect, :scope > g > path');
  if (!shape) return null;
  const n = (a: string) => Number(shape.getAttribute(a) || 0);
  let pts: number[][] = [];
  const tag = shape.nodeName.toLowerCase();
  if (tag === 'rect') pts = [[n('x'), n('y')], [n('x') + n('width'), n('y') + n('height')]];
  else if (tag === 'circle') pts = [[n('cx') - n('r'), n('cy') - n('r')], [n('cx') + n('r'), n('cy') + n('r')]];
  else {
    const nums = (shape.getAttribute(tag === 'polygon' ? 'points' : 'd') || '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  }
  if (!pts.length) return null;
  const xs = pts.map((q) => q[0] + tx);
  const ys = pts.map((q) => q[1] + ty);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
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
      if (rawId && rawId !== 'root_start' && rawId !== 'root_end' && !/^(startNode|endNode|choice_)/.test(rawId)) {
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
            // (as a style too: the theme's .node rect colours would otherwise win over the attributes)
            badgeRect.setAttribute('style', `fill: ${badgeBg}; stroke: ${badgeBorder}`);
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
            badgeG.setAttribute('class', `tc-complexity-badge lvl-${metric.level}`);
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
            badgeRect.setAttribute('style', `fill: ${metric.color.badgeBg}; stroke: ${metric.color.badgeBorder}`);
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
        l.setAttribute('title', 'Double-click to toggle Transition Guard & Condition Inspector');
      }

      if (paths.length === 0 || labels.length === 0) continue;

      // Dedicated priority layer inside this cluster (rendered directly after edgePaths)
      const clusterBadgeLayer = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
      clusterBadgeLayer.setAttribute('class', 'priority-badges-cluster');

      const usedPathIndices = new Set<number>();
      // (the badges placed so far in this cluster: another one on top of one moves further along its own edge)
      const placedBadges: { x: number; y: number }[] = [];

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
        let cx = parsed.startX + parsed.dirX * offset;
        let cy = parsed.startY + parsed.dirY * offset;
        // Another badge there (two transitions leaving the state side by side): further along this edge, until clear
        const BADGE_GAP = 19;
        const clear = (x: number, y: number) => placedBadges.every((b) => Math.hypot(b.x - x, b.y - y) >= BADGE_GAP);
        if (!clear(cx, cy) && typeof (pathEl as SVGPathElement).getPointAtLength === 'function') {
          const len = (pathEl as SVGPathElement).getTotalLength();
          for (let d = offset + 12; d <= Math.min(len * 0.6, offset + 96); d += 12) {
            const q = (pathEl as SVGPathElement).getPointAtLength(d);
            if (clear(q.x, q.y)) {
              cx = q.x;
              cy = q.y;
              break;
            }
          }
        }
        // (still on its state, e.g. a small rounded AnyState whose edges start inside it: further along its edge,
        // until clear of the state's border)
        const fromBox = matchedEdge ? nodeBoxIn(parent, matchedEdge.from) : null;
        const on = (x: number, y: number) => !!fromBox && x > fromBox.x0 - 9 && x < fromBox.x1 + 9 && y > fromBox.y0 - 9 && y < fromBox.y1 + 9;
        if (on(cx, cy) && typeof (pathEl as SVGPathElement).getPointAtLength === 'function') {
          try {
            const len = (pathEl as SVGPathElement).getTotalLength();
            for (let d = offset; d <= len * 0.7; d += 4) {
              const q = (pathEl as SVGPathElement).getPointAtLength(d);
              if (!on(q.x, q.y) && clear(q.x, q.y)) {
                cx = q.x;
                cy = q.y;
                break;
              }
            }
          } catch {
            // (no geometry here: where it was)
          }
        }
        placedBadges.push({ x: cx, y: cy });

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
        badgeG.setAttribute('title', 'Double-click to toggle Transition Guard & Condition Inspector');

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
    onEditTransitionCondition,
    problemMarkers,
    bookmarkedStates,
    expanded,
    onExpandedChange,
    onToggleStateBookmark,
    changedStates,
    stateTooltips,
    stateProblems,
    canvasBanner,
    canvasBannerAction,
    groupSnapEach,
    multiSelection,
    onMultiSelectionChange,
    onBoxSelected,
    liveHighlight,
    stateTimes,
    pathHighlight,
    diffHighlight,
    liveGuards,
    contextMenuItems,
    connectFrom = null,
    onConnectTo,
    onConnectCancel,
    onEdgeEndpointDrop,
    edgeMembersOf,
    onOpenTransitionCode,
    onGoToEdgeCode,
    compositeColor = 'sand',
    compositeOwnColors,
    onCanvasKey,
    onPaletteElement,
    onStateDropped,
    onCompositeDropped,
    history,
    placeRequest = null,
    onStyleChange: onStyleChangeProp,
    onResetStateStyle: onResetStateStyleProp,
    onClearAllCustomStyles: onClearAllCustomStylesProp,
    nodeOffsets: externalNodeOffsets,
    onNodeOffsetsChange,
    initialEdgeOffsets,
    edgeOffsetsKey,
    onEdgeOffsetsChange,
    pinPositions,
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
    keepPositionsSignal,
    onLayoutLockedChange: onLayoutLockedChangeProp,
    onToast: onToastProp,
    toolbarPortalTarget,
    onSwitchToDiagramTab,
    dockedPanels,
    onOpenInspectorPanel,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  // The window the canvas is in (the main one, or a window of its own: Move to New Window): its frames and its mouse
  const hostWin = (): Window => containerRef.current?.ownerDocument?.defaultView ?? window;
  const ownerWin = containerRef.current?.ownerDocument?.defaultView ?? window;
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
  // The chart (its file) the SVG shown was drawn for: another chart's SVG until the new one is drawn
  const svgChartRef = useRef<string | undefined>(undefined);
  // (each new SVG counted: a drop's places are kept in the drawing after it, not in a redraw of the one before)
  const svgVersionRef = useRef(0);
  const fileNameRef = useRef(fileName);
  fileNameRef.current = fileName;
  useEffect(() => {
    svgChartRef.current = fileNameRef.current;
    svgVersionRef.current += 1;
  }, [svgContent]);
  const [layoutTrigger, setLayoutTrigger] = useState<number>(0);
  const [isAutoAligning, setIsAutoAligning] = useState<boolean>(false);
  const autoAlignInProgressRef = useRef<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  // The chart's scale at zoom 1 (a chart wider or taller than the canvas is fitted to it): the zoom shown is its size
  const [fitScale, setFitScale] = useState(1);
  // (zoomed in up to 1000% of its own size: a chart fitted to the canvas goes further than 10 times that)
  const maxZoomRef = useRef(10);
  maxZoomRef.current = Math.max(10, 10 / fitScale);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const mouseDownPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Expanded (the app's Focus mode when it says so; else this viewer's own fixed layer over the page)
  const [ownFullscreen, setOwnFullscreen] = useState<boolean>(false);
  const isFullscreen = expanded ?? ownFullscreen;
  const setIsFullscreen = (on: boolean) => (onExpandedChange ? onExpandedChange(on) : setOwnFullscreen(on));
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
  // The popups on hovering a state (its code, its complexity), a transition's label or a badge (its guard): on by
  // default, off on the toolbar (kept in this browser)
  const [hoverPopups, setHoverPopupsState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('kss.canvas.hoverPopups') !== 'off';
    } catch {
      return true;
    }
  });
  // The canvas' grid (its dots): off by default, on in the toolbar (kept in this browser)
  const [showGrid, setShowGridState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('kss.canvas.grid') === 'on';
    } catch {
      return false;
    }
  });
  const setShowGrid = useCallback((on: boolean) => {
    setShowGridState(on);
    try {
      localStorage.setItem('kss.canvas.grid', on ? 'on' : 'off');
    } catch {
      // (this session only)
    }
  }, []);
  const setHoverPopups = useCallback((on: boolean) => {
    setHoverPopupsState(on);
    try {
      localStorage.setItem('kss.canvas.hoverPopups', on ? 'on' : 'off');
    } catch {
      // (this session only)
    }
  }, []);
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
  // (the chart's width at zoom 1 against its own: 1 when it fits the canvas; measured again when the canvas resizes)
  useEffect(() => {
    const measure = () => {
      const s = getDiagramSvg();
      const vb = s?.viewBox?.baseVal;
      if (!s || !vb?.width || !s.clientWidth) return;
      const f = Math.min(1, s.clientWidth / vb.width);
      setFitScale((prev) => (Math.abs(prev - f) < 0.001 ? prev : f));
    };
    measure();
    const host = containerRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [svgContent, getDiagramSvg]);

  // Whether the pressed edge was already selected before this press (the press itself selects it)
  const edgeSelectedBeforePressRef = useRef<boolean>(false);
  // True when this press started on an edge (and therefore already selected it)
  const edgePressedRef = useRef<boolean>(false);
  // The transition under the last mouse-down (a right-click's menu is for it, although the press re-drew it)
  const pressedEdgeRef = useRef<{ edge: EdgeInfo; t: number } | null>(null);
  // Set when mouse-up handled an edge click, so the click event of the same gesture is ignored
  const edgeClickHandledRef = useRef<boolean>(false);

  /**
   * Edge click: a click selects and highlights the transition; a double-click opens (or closes) the Transition
   * Guard & Condition Inspector.
   */
  const lastEdgeClickRef = useRef<{ id: string; t: number } | null>(null);
  const activateEdgeClick = (edge: EdgeInfo, anchor: { x: number; y: number }, _wasSelected?: boolean) => {
    setSelectedEdge(edge);
    const now = Date.now();
    const last = lastEdgeClickRef.current;
    // (one click can be reported twice, by mouse-up and by click: that is not a second click)
    const repeat = !!last && last.id === edge.id && now - last.t <= 40;
    const double = !!last && last.id === edge.id && now - last.t > 40 && now - last.t < 500;
    if (!repeat) lastEdgeClickRef.current = { id: edge.id, t: double ? 0 : now };
    if (double) {
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
  // The transitions drawn as they were kept (an edit from the canvas): shown, with a re-layout at hand
  const [keptRoutes, setKeptRoutes] = useState(0);
  const countKeptRoutes = () => setKeptRoutes(getDiagramSvg()?.querySelectorAll('path.tc-edge-path[data-frozen-d]').length ?? 0);
  useEffect(() => {
    if (!isNodeDragging) countKeptRoutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNodeDragging]);
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
  // A layout file's routes (by transition) for the next drawing: put on its paths there (their ids are the drawing's)
  const pendingEdgeSeedRef = useRef<EdgeOffsetsMap | null>(null);
  useEffect(() => {
    if (edgeOffsetsKey === undefined) return;
    pendingEdgeSeedRef.current = { ...(initialEdgeOffsets ?? {}) };
    setLayoutTrigger((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeOffsetsKey]);
  // A layout file's places (another engine's): the states pinned there in the next drawing, as after a drop
  useEffect(() => {
    if (!pinPositions?.key) return;
    keepPositionsRef.current = { at: Date.now(), chart: fileName, version: svgVersionRef.current, positions: { ...pinPositions.positions }, edges: {}, clusters: {}, moved: null, frame: { viewBox: null, style: null, width: null, height: null }, align: true };
    setLayoutTrigger((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinPositions?.key]);
  // The routes changed: told by transition (the drawing's path ids are not kept across drawings)
  const onEdgeOffsetsChangeRef = useRef(onEdgeOffsetsChange);
  onEdgeOffsetsChangeRef.current = onEdgeOffsetsChange;
  const reportedEdgesRef = useRef('');
  useEffect(() => {
    const svg = getDiagramSvg();
    if (!svg || !onEdgeOffsetsChangeRef.current || pendingEdgeSeedRef.current) return;
    const out = edgeOffsetsByTransition(svg, edgeOffsets);
    const text = JSON.stringify(out);
    if (text === reportedEdgesRef.current) return;
    reportedEdgesRef.current = text;
    onEdgeOffsetsChangeRef.current(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeOffsets]);

  const isDraggingEdgeHandleRef = useRef<boolean>(false);
  const draggedEdgeIdRef = useRef<string | null>(null);
  const draggedHandleTypeRef = useRef<'start' | 'end' | 'mid' | 'label' | null>(null);
  const edgeHandleDragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const edgeInitialOffsetRef = useRef<EdgeOffset>({ x: 0, y: 0 });
  // (a handle drag: the route as drawn when it began, the layout's, clear of the states; not the dragged one)
  const edgeInitialDRef = useRef<string | null>(null);
  // Label drag: only the label element moves (once per frame); the full re-apply runs on release
  const draggedLabelRef = useRef<{ el: SVGGElement; x: number; y: number } | null>(null);
  const labelDragFrameRef = useRef<number | null>(null);
  // Line / handle drags: applied once per animation frame with the latest offset, re-routing only that edge
  const edgeDragFrameRef = useRef<number | null>(null);
  const applyEdgeDragFrameRef = useRef<(() => void) | null>(null);
  const flushLabelDrag = () => {
    if (labelDragFrameRef.current !== null) {
      hostWin().cancelAnimationFrame(labelDragFrameRef.current);
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

  // Pinned/locked canvas positions for all states (stateId -> { centerX, centerY }), of the chart drawn (renderedChartRef):
  // another chart's are not kept (the start symbol and AnyState have the same ids in every chart: they would be put
  // where the previous chart had them)
  const lockedNodePositionsRef = useRef<Record<string, { centerX: number; centerY: number }>>({});
  const renderedChartRef = useRef<string | undefined>(undefined);
  // An edit from the canvas itself (an edge's end dropped on another state): the states kept where they were in the
  // drawing that follows it, locked or not (taken at the drop; dropped when no drawing follows within a few seconds)
  const keepPositionsRef = useRef<{ at: number; chart: string | undefined; version: number; positions: Record<string, { centerX: number; centerY: number }>; edges: Record<string, KeptRoute[]>; clusters: Record<string, KeptCluster>; moved: MovedEnd | null; frame: { viewBox: string | null; style: string | null; width: string | null; height: string | null }; align?: boolean } | null>(null);
  // Each state's place at the last edits from the canvas and undos (this chart's; a state gone since too): one that
  // comes back (an undo of its deletion) where it was. (Not at each drawing: a deleted state is drawn once more
  // without its offset before it goes.)
  // (each composite's states, from the chart's source)
  const compositeMembers = useMemo(() => compositeMembersOf(code), [code]);
  const compositeMembersRef = useRef(compositeMembers);
  compositeMembersRef.current = compositeMembers;
  const lastDrawnPositionsRef = useRef<Record<string, { centerX: number; centerY: number }>>({});
  /** The states' places on the canvas now (moved by hand since it was drawn too), this chart's, remembered with those
   * gone since */
  const rememberDrawnPositions = () => {
    const svg = getDiagramSvg();
    if (!svg || svgChartRef.current !== fileNameRef.current) return;
    const prev = lastDrawnPositionsRef.current;
    const now = extractCanvasNodePositions(svg, {});
    // (a drawing laid out again may be shifted as a whole: the ones not in it moved with it, by the states in both)
    const median = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : 0);
    const both = Object.keys(now).filter((id) => prev[id]);
    const dx = median(both.map((id) => now[id].centerX - prev[id].centerX));
    const dy = median(both.map((id) => now[id].centerY - prev[id].centerY));
    const drawn: Record<string, { centerX: number; centerY: number }> = {};
    for (const [id, q] of Object.entries(prev)) if (!now[id]) drawn[id] = { centerX: q.centerX + dx, centerY: q.centerY + dy };
    for (const [id, q] of Object.entries(now)) drawn[id] = { centerX: q.centerX, centerY: q.centerY };
    lastDrawnPositionsRef.current = drawn;
  };
  /** The states' places now (as drawn: the drawing already has the offsets in it) and its frame, for the next drawing */
  const keepPositionsForNextDrawing = (moved: MovedEnd | null = null) => {
    const svg = getDiagramSvg();
    if (!svg) return;
    rememberDrawnPositions();
    const positions: Record<string, { centerX: number; centerY: number }> = { ...lastDrawnPositionsRef.current };
    keepPositionsRef.current = { at: Date.now(), chart: fileName, version: svgVersionRef.current, positions, edges: keptRoutesOf(svg), clusters: keptClustersOf(svg), moved, frame: { viewBox: svg.getAttribute('viewBox'), style: svg.getAttribute('style'), width: svg.getAttribute('width'), height: svg.getAttribute('height') } };
  };
  // (an undo / redo of a code change: the states where they are; the chart drawn again for the code as it was)
  const keepSignalRef = useRef(keepPositionsSignal);
  useEffect(() => {
    if (keepPositionsSignal === keepSignalRef.current) return;
    keepSignalRef.current = keepPositionsSignal;
    keepPositionsForNextDrawing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keepPositionsSignal]);

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
    // (the SVG still another chart's: nothing taken from it)
    if (externalLayoutLocked && renderedChartRef.current === fileName && svgChartRef.current === fileName) {
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
  }, [externalLayoutLocked, effectiveNodeOffsets, fileName]);
  // Another chart opened: the locked positions are its own (taken once it is drawn)
  useEffect(() => {
    if (renderedChartRef.current !== undefined && renderedChartRef.current !== fileName) lockedNodePositionsRef.current = {};
  }, [fileName]);

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
    /** The hovered label's (or badge's) own path: its edge lit, even one without a badge */
    linkedPathId?: string;
  } | null>(null);
  // An edge lit by a hover: its two states (or composites) too, so a long edge's ends are easy to find
  const lightEnds = useCallback((svg: SVGSVGElement, paths: Element[], cls: string) => {
    for (const path of paths) {
      for (const id of [path.getAttribute('data-source-id'), path.getAttribute('data-target-id')]) {
        if (!id) continue;
        svg.querySelectorAll(`g.node[data-state-id="${CSS.escape(id)}"], g.cluster:is([id="${CSS.escape(id)}"], [id$="-${CSS.escape(id)}"]), .statediagram-cluster[data-id="${CSS.escape(id)}"]`).forEach((el) => el.classList.add(cls));
      }
    }
  }, []);
  // An edge hovered (its wider hit area, drawn on top of the line): the edge and its priority badge lit, as its label
  // hovered lights them (not while something is dragged)
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    let lit: string | null = null;
    const light = (pid: string | null) => {
      if (pid === lit) return;
      const svg = getDiagramSvg();
      svg?.querySelectorAll('.tc-edge-pointer-hover').forEach((el) => el.classList.remove('tc-edge-pointer-hover'));
      svg?.querySelectorAll('.tc-priority-badge-pointer-hover').forEach((el) => el.classList.remove('tc-priority-badge-pointer-hover'));
      svg?.querySelectorAll('.tc-end-pointer-hover').forEach((el) => el.classList.remove('tc-end-pointer-hover'));
      lit = pid;
      if (!svg || !pid) return;
      const key = `[data-path-id="${CSS.escape(pid)}"]`;
      const paths = [...svg.querySelectorAll(`path.tc-edge-path${key}`)];
      paths.forEach((el) => el.classList.add('tc-edge-pointer-hover'));
      lightEnds(svg, paths, 'tc-end-pointer-hover');
      svg.querySelectorAll(`.tc-priority-badge${key}`).forEach((el) => el.classList.add('tc-priority-badge-pointer-hover'));
    };
    const over = (e: PointerEvent) => {
      const hit = (e.target as Element | null)?.closest?.('.tc-edge-hitbox, path.tc-edge-path');
      light(hit && !isDraggingNodeRef.current && !isDraggingEdgeHandleRef.current ? hit.getAttribute('data-path-id') : null);
    };
    const leave = () => light(null);
    host.addEventListener('pointerover', over);
    host.addEventListener('pointerleave', leave);
    return () => {
      host.removeEventListener('pointerover', over);
      host.removeEventListener('pointerleave', leave);
      light(null);
    };
  }, [getDiagramSvg, lightEnds]);
  // An edge's label hovered: the edge and its priority badge lit as when they are hovered themselves (its own path
  // first: two transitions between the same states each have their own)
  const hoveredEdge = hoveredEdgeCondition?.edge;
  // The guard popup: placed once measured, never over its label (below it; else above; else beside it)
  const guardPopupRef = useRef<HTMLDivElement | null>(null);
  // The composites' colours: put in the SVG when it is drawn, and changed in the drawn one (no new render)
  const compositeColorRef = useRef({ preset: compositeColor, own: compositeOwnColors ?? {} });
  const compositeColorKey = `${compositeColor}|${JSON.stringify(compositeOwnColors ?? {})}`;
  useEffect(() => {
    compositeColorRef.current = { preset: compositeColor, own: compositeOwnColors ?? {} };
    // (each drawn copy: the canvas' and the minimap's)
    const css = compositeStyle(mermaidTheme, compositeColor, compositeOwnColors ?? {}).replace(/^<style[^>]*>|<\/style>$/g, '');
    containerRef.current?.querySelectorAll('svg style.kss-composite-style').forEach((style) => {
      if (style.textContent !== css) style.textContent = css;
    });
  }, [compositeColorKey, mermaidTheme]); // eslint-disable-line react-hooks/exhaustive-deps
  const [guardPopupPos, setGuardPopupPos] = useState<{ left: number; top: number; key: string } | null>(null);
  // Pinned (a click on it, or its pin): it stays open, whatever is hovered, until unpinned, Esc or a click elsewhere
  const [guardPinned, setGuardPinned] = useState(false);
  const [guardCopied, setGuardCopied] = useState(false);
  const guardLeaveRef = useRef<number | null>(null);
  const keepGuardPopup = useCallback(() => {
    if (guardLeaveRef.current != null) {
      clearTimeout(guardLeaveRef.current);
      guardLeaveRef.current = null;
    }
  }, []);
  // (where the mouse is on the canvas; null: off it)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  // (the mouse off its label: a moment to reach the popup before it closes; still on a label, a badge or the popup
  // then, as when the popup moved away from under the mouse to another label: it stays)
  const leaveGuardPopup = useCallback(() => {
    if (guardPinned || guardLeaveRef.current != null) return;
    guardLeaveRef.current = window.setTimeout(() => {
      guardLeaveRef.current = null;
      const pt = lastPointerRef.current;
      if (pt && document.elementsFromPoint(pt.x, pt.y).some((el) => el.closest('#edge-guard-condition-hover-badge, g.edgeLabel, .tc-priority-badge, .priority-badge'))) return;
      setHoveredEdgeCondition(null);
    }, 200);
  }, [guardPinned]);
  useEffect(() => {
    if (hoveredEdgeCondition) return;
    setGuardPinned(false);
    setGuardCopied(false);
  }, [hoveredEdgeCondition]);
  useEffect(() => () => keepGuardPopup(), [keepGuardPopup]);
  useEffect(() => {
    if (!guardPinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setHoveredEdgeCondition(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [guardPinned]);
  // (which label it was placed for: another one is placed afresh, not shown where the last one was)
  const guardPopupKey = hoveredEdgeCondition ? `${hoveredEdgeCondition.edge.id}|${hoveredEdgeCondition.edge.pathId ?? ''}|${Math.round(hoveredEdgeCondition.labelRect?.top ?? hoveredEdgeCondition.anchorY)}` : '';
  useLayoutEffect(() => {
    const el = guardPopupRef.current;
    const hc = hoveredEdgeCondition;
    if (!el || !hc) {
      setGuardPopupPos(null);
      return;
    }
    const r = hc.labelRect ?? new DOMRect(hc.anchorX, hc.anchorY, 1, 1);
    const w = el.offsetWidth;
    const hh = el.offsetHeight;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const M = 8;
    let left = Math.min(W - w - M, Math.max(M, r.left + 12));
    let top: number;
    if (r.bottom + M + hh <= H - M) top = r.bottom + M;
    else if (r.top - M - hh >= M) top = r.top - M - hh;
    else {
      top = Math.min(H - hh - M, Math.max(M, r.top + r.height / 2 - hh / 2));
      left = r.right + M + w <= W - M ? r.right + M : Math.max(M, r.left - M - w);
    }
    setGuardPopupPos((prev) => (prev && prev.left === left && prev.top === top && prev.key === guardPopupKey ? prev : { left, top, key: guardPopupKey }));
  }, [hoveredEdgeCondition, guardPopupKey]);
  useEffect(() => {
    const svg = getDiagramSvg();
    if (!svg) return;
    svg.querySelectorAll('.tc-priority-badge-hover').forEach((el) => el.classList.remove('tc-priority-badge-hover'));
    svg.querySelectorAll('.tc-edge-hover').forEach((el) => el.classList.remove('tc-edge-hover'));
    svg.querySelectorAll('.tc-end-hover').forEach((el) => el.classList.remove('tc-end-hover'));
    if (!hoveredEdge) return;
    const linked = hoveredEdgeCondition?.linkedPathId;
    const key = linked ? `[data-path-id="${CSS.escape(linked)}"]` : hoveredEdge.pathId ? `[data-path-id="${CSS.escape(hoveredEdge.pathId)}"]` : hoveredEdge.id ? `[data-edge-id="${CSS.escape(hoveredEdge.id)}"]` : '';
    if (!key) return;
    const paths = new Set<string>([linked, hoveredEdge.pathId].filter((x): x is string => !!x));
    svg.querySelectorAll(`.tc-priority-badge${key}`).forEach((el) => {
      el.classList.add('tc-priority-badge-hover');
      // (its edge: the path the badge belongs to)
      const pid = el.getAttribute('data-path-id');
      if (pid) paths.add(pid);
    });
    for (const pid of paths) svg.querySelectorAll(`path.tc-edge-path[data-path-id="${CSS.escape(pid)}"]`).forEach((el) => el.classList.add('tc-edge-hover'));
    if (!paths.size) svg.querySelectorAll(`path.tc-edge-path${key}`).forEach((el) => el.classList.add('tc-edge-hover'));
    lightEnds(svg, [...svg.querySelectorAll('path.tc-edge-path.tc-edge-hover')], 'tc-end-hover');
  }, [hoveredEdge, hoveredEdgeCondition?.linkedPathId, getDiagramSvg, lightEnds]);

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
        hostWin().cancelAnimationFrame(activePanAnimationRef.current);
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
        hostWin().cancelAnimationFrame(activePanAnimationRef.current);
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
          activePanAnimationRef.current = hostWin().requestAnimationFrame(animateStep);
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

      activePanAnimationRef.current = hostWin().requestAnimationFrame(animateStep);
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
          // (an IDE theme: Mermaid's base theme with its colours)
          ...mermaidThemeOptions(mermaidTheme),
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
          setSvgContent(withCompositeStyle(enhancedSvg, mermaidTheme, compositeColorRef.current.preset, compositeColorRef.current.own));
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
    // (the SVG still the previous chart's, its file just changed: not locked to it, nor taken as this chart's)
    const stale = svgChartRef.current !== fileName;
    // (this SVG is this chart's: another one's locked positions dropped)
    if (!stale && renderedChartRef.current !== fileName) {
      if (renderedChartRef.current !== undefined) lockedNodePositionsRef.current = {};
      lastDrawnPositionsRef.current = {};
      renderedChartRef.current = fileName;
    }

    let targetNodeOffsets = { ...effectiveNodeOffsets };

    // (the states' places to keep: after a drop on the canvas, else the locked layout's)
    const kept = keepPositionsRef.current && keepPositionsRef.current.chart === fileName && svgVersionRef.current > keepPositionsRef.current.version && Date.now() - keepPositionsRef.current.at < 8000 ? keepPositionsRef.current : null;
    let keep = kept ? kept.positions : null;
    // (another drawing's places, a layout file's of another engine: moved as a whole to this drawing's top left)
    if (!stale && kept?.align && keep) {
      const drawn = extractCanvasNodePositions(svg, {});
      const ids = Object.keys(keep).filter((id) => drawn[id]);
      if (ids.length) {
        const min = (v: number[]) => Math.min(...v);
        const dx = min(ids.map((id) => drawn[id].centerX)) - min(ids.map((id) => keep![id].centerX));
        const dy = min(ids.map((id) => drawn[id].centerY)) - min(ids.map((id) => keep![id].centerY));
        keep = Object.fromEntries(ids.map((id) => [id, { centerX: keep![id].centerX + dx, centerY: keep![id].centerY + dy }]));
      }
    }
    if (!stale && kept) {
      keepPositionsRef.current = null;
      // (the drawing's frame as before: a bigger one would scale every state on screen)
      for (const [attr, v] of Object.entries(kept.frame)) if (v !== null) svg.setAttribute(attr, v);
      // (the locked layout's from now on: these too)
      if (isLayoutLocked) lockedNodePositionsRef.current = { ...lockedNodePositionsRef.current, ...keep };
    }
    const pinned = stale ? null : keep ?? (isLayoutLocked && Object.keys(lockedNodePositionsRef.current).length > 0 ? lockedNodePositionsRef.current : null);
    // (the transitions as they were drawn, but the ones the edit changed: their routes and labels kept)
    if (!stale && kept) {
      restoreKeptRoutes(svg, kept.edges, kept.moved, kept.positions);
      restoreKeptClusters(svg, kept.clusters);
    }
    if (pinned) {
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

        const lockedPos = pinned[stateId];
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
          onNodeOffsetsChange(updatedOffsets, { auto: true });
        } else {
          setInternalNodeOffsets(updatedOffsets);
        }
      }
    }

    // (a layout file's routes, by transition: on this drawing's paths)
    let targetEdgeOffsets = edgeOffsets;
    if (!stale && pendingEdgeSeedRef.current) {
      targetEdgeOffsets = edgeOffsetsOnPaths(svg, pendingEdgeSeedRef.current);
      pendingEdgeSeedRef.current = null;
      currentEdgeOffsetsRef.current = { ...targetEdgeOffsets };
      reportedEdgesRef.current = JSON.stringify(edgeOffsetsByTransition(svg, targetEdgeOffsets));
      setEdgeOffsets(targetEdgeOffsets);
    }
    applyDiagramOffsetsToSvg(
      svg,
      targetNodeOffsets,
      targetEdgeOffsets,
      null,
      selectedEdge?.id || null,
      layoutEngine,
      flowchartCurve
    );
    // (the states kept where they were: a composite the layout sized for its own places grown to hold its states)
    if (!stale && pinned) growCompositesToMembers(svg, compositeMembersRef.current);
    if (!stale) countKeptRoutes();
    const positions = extractCanvasNodePositions(svg, targetNodeOffsets);
    setCanvasNodePositions(positions);

    // If layout is not locked, OR if lockedNodePositions is empty (freshly auto-aligned), keep lockedNodePositionsRef in sync with latest positions
    if (!stale && (!isLayoutLocked || Object.keys(lockedNodePositionsRef.current).length === 0)) {
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
    const w = hostWin();
    w.addEventListener('mousemove', onMove);
    return () => {
      w.removeEventListener('mousemove', onMove);
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

  // Measured state times: each measured state's border and a badge under it, quick (green) to slow (red)
  useEffect(() => {
    const svg = renderedSvg;
    if (!svg) return;
    svg.querySelectorAll('.state-time-badge').forEach((el) => el.remove());
    svg.querySelectorAll('[class*="state-time-l"]').forEach((el) => el.classList.remove('state-time-l0', 'state-time-l1', 'state-time-l2', 'state-time-l3', 'state-time-l4'));
    if (!stateTimes) return;
    const ns = 'http://www.w3.org/2000/svg';
    for (const [id, t] of Object.entries(stateTimes)) {
      const node = svg.querySelector(`g.node[data-state-id="${CSS.escape(id)}"]`) as SVGGElement | null;
      if (!node) continue;
      node.classList.add(`state-time-l${t.level}`);
      let box: DOMRect;
      try {
        box = node.getBBox();
      } catch {
        continue;
      }
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', `state-time-badge state-time-badge-l${t.level}`);
      g.setAttribute('data-state-id', id);
      const title = document.createElementNS(ns, 'title');
      title.textContent = t.title;
      const text = document.createElementNS(ns, 'text');
      text.textContent = t.label;
      text.setAttribute('x', String(box.x + box.width / 2));
      text.setAttribute('y', String(box.y + box.height + 13));
      text.setAttribute('text-anchor', 'middle');
      const rect = document.createElementNS(ns, 'rect');
      g.append(title, rect, text);
      node.appendChild(g);
      const tb = text.getBBox();
      rect.setAttribute('x', String(tb.x - 5));
      rect.setAttribute('y', String(tb.y - 2));
      rect.setAttribute('width', String(tb.width + 10));
      rect.setAttribute('height', String(tb.height + 4));
      rect.setAttribute('rx', '6');
    }
  }, [renderedSvg, stateTimes]);

  // Live view: the PLC's current state glows, the previous one and the transition taken are marked
  useEffect(() => {
    const svg = renderedSvg;
    if (!svg) return;
    svg.querySelectorAll('.live-active-node, .live-previous-node, .live-stuck-node, .live-active-cluster, .live-region-node').forEach((el) =>
      el.classList.remove('live-active-node', 'live-previous-node', 'live-stuck-node', 'live-active-cluster', 'live-region-node')
    );
    svg.querySelectorAll('.live-last-edge').forEach((el) => el.classList.remove('live-last-edge'));
    svg.classList.toggle('diagram-live-active', !!liveHighlight);
    if (!liveHighlight) return;
    const node = (id: string) => svg.querySelector(`g.node[data-state-id="${CSS.escape(id)}"]`);
    node(liveHighlight.stateId)?.classList.add('live-active-node');
    if (liveHighlight.stuck) node(liveHighlight.stateId)?.classList.add('live-stuck-node');
    // A state with parallel regions is a cluster: it glows as one, each region's state inside it too
    const sid = liveHighlight.stateId.replace(/[.-]/g, '_');
    svg.querySelector(`g.cluster[id$="-${CSS.escape(sid)}"], g.cluster[id="${CSS.escape(sid)}"]`)?.classList.add('live-active-cluster');
    for (const r of liveHighlight.regionStates ?? []) node(r)?.classList.add('live-region-node');
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

  // A state's entry / do / exit actions on hover: at once, in the app's own box (in the heat-map's, when that
  // one shows); no browser tooltip, which came late and covered it
  const [hoveredActions, setHoveredActions] = useState<{ id: string; text: string; x: number; y: number; rect: ScreenRect } | null>(null);

  const onToggleStateBookmarkRef = useRef(onToggleStateBookmark);
  onToggleStateBookmarkRef.current = onToggleStateBookmark;
  // Bookmarks: a ribbon at the top-left corner of each bookmarked state
  const bookmarkKey = (bookmarkedStates ?? []).join('|');
  useEffect(() => {
    const svg = renderedSvg;
    if (!svg) return;
    svg.querySelectorAll('g.state-bookmark-marker').forEach((el) => el.remove());
    const marked = new Set(bookmarkKey ? bookmarkKey.split('|') : []);
    if (!marked.size) return;
    const ns = 'http://www.w3.org/2000/svg';
    const num = (el: Element, name: string) => parseFloat(el.getAttribute(name) || '0') || 0;
    svg.querySelectorAll('g.node[data-state-id]').forEach((node) => {
      const id = node.getAttribute('data-state-id') || '';
      if (!marked.has(id)) return;
      // The node's shape in its own coordinates (as the problem badges do)
      let box = { x: 0, y: 0, width: 0 };
      const shape = node.querySelector(':scope > rect, :scope > polygon, :scope > circle, :scope > ellipse, rect, polygon');
      if (shape?.tagName === 'rect') box = { x: num(shape, 'x'), y: num(shape, 'y'), width: num(shape, 'width') };
      else if (shape?.tagName === 'polygon') {
        const pts = (shape.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
        const xs = pts.filter((_, i) => i % 2 === 0);
        const ys = pts.filter((_, i) => i % 2 === 1);
        if (xs.length) box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs) };
      }
      if (!box.width) {
        try {
          const b = (node as SVGGElement).getBBox();
          box = { x: b.x, y: b.y, width: b.width };
        } catch {
          return;
        }
      }
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'state-bookmark-marker');
      g.setAttribute('data-state-id', id);
      g.setAttribute('transform', `translate(${box.x + 6}, ${box.y - 3})`);
      const title = document.createElementNS(ns, 'title');
      title.textContent = onToggleStateBookmarkRef.current ? 'Bookmark: a click removes it' : 'Bookmark (right-click the state to remove it)';
      const ribbon = document.createElementNS(ns, 'path');
      ribbon.setAttribute('d', 'M0,0 H12 V16 L6,11.5 L0,16 Z');
      // (inline and important: the theme's ".node path" fill would paint it dark; the colours of Identified States' icon)
      ribbon.setAttribute('style', 'fill:#38bdf8 !important;stroke:#7dd3fc !important;stroke-width:1.2px !important;stroke-linejoin:round;filter:drop-shadow(0 0 3px rgba(56,189,248,0.7));cursor:pointer;');
      g.append(title, ribbon);
      node.appendChild(g);
    });
  }, [renderedSvg, bookmarkKey]);

  // Changed since saved: an amber dot at the top-right corner of each such state
  const changedKey = (changedStates ?? []).join('|');
  useEffect(() => {
    const svg = renderedSvg;
    if (!svg) return;
    svg.querySelectorAll('g.state-changed-marker').forEach((el) => el.remove());
    const marked = new Set(changedKey ? changedKey.split('|') : []);
    if (!marked.size) return;
    const ns = 'http://www.w3.org/2000/svg';
    svg.querySelectorAll('g.node[data-state-id]').forEach((node) => {
      const id = node.getAttribute('data-state-id') || '';
      if (!marked.has(id)) return;
      let b: DOMRect;
      try {
        b = (node as SVGGElement).getBBox();
      } catch {
        return;
      }
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'state-changed-marker');
      g.setAttribute('data-state-id', id);
      g.setAttribute('transform', `translate(${b.x + b.width - 7}, ${b.y + 7})`);
      const title = document.createElementNS(ns, 'title');
      title.textContent = 'Its code changed since the POU was saved (the header\'s Diff shows how)';
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('r', '4');
      // (inline and important: the theme's ".node circle" fill would paint it over)
      dot.setAttribute('style', 'fill:#f59e0b !important;stroke:#fde68a !important;stroke-width:1px !important;');
      g.append(title, dot);
      node.appendChild(g);
    });
  }, [renderedSvg, changedKey]);

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
      hostWin().cancelAnimationFrame(jumpAttemptTimerRef.current);
      jumpAttemptTimerRef.current = null;
    }

    const startTime = performance.now();
    const maxWaitMs = 2500; // Allow sufficient time for async Mermaid rendering if tab just mounted

    const attempt = () => {
      if (!containerRef.current) {
        if (performance.now() - startTime < maxWaitMs) {
          jumpAttemptTimerRef.current = hostWin().requestAnimationFrame(attempt);
        }
        return;
      }
      const svg = getDiagramSvg();
      if (!svg) {
        if (performance.now() - startTime < maxWaitMs) {
          jumpAttemptTimerRef.current = hostWin().requestAnimationFrame(attempt);
        }
        return;
      }
      const nodeEl =
        findNodeElement(svg as SVGSVGElement, stateId) ||
        (svg.querySelector(`g.node[data-state-id="${stateId}"]`) as SVGGElement | null);

      if (!nodeEl) {
        if (performance.now() - startTime < maxWaitMs) {
          jumpAttemptTimerRef.current = hostWin().requestAnimationFrame(attempt);
        }
        return;
      }

      // Check if element has non-zero size (ensure layout is computed)
      const rect = nodeEl.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        if (performance.now() - startTime < maxWaitMs) {
          jumpAttemptTimerRef.current = hostWin().requestAnimationFrame(attempt);
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
      if (jumpAttemptTimerRef.current) hostWin().cancelAnimationFrame(jumpAttemptTimerRef.current);
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

  // A state's shape on screen (a hover box goes beside it)
  const stateScreenRect = (id: string): ScreenRect | null => {
    const svg = getDiagramSvg();
    if (!svg) return null;
    const want = id.toLowerCase();
    const el = [...svg.querySelectorAll('g.node[data-state-id]')].find((g) => g.getAttribute('data-state-id')!.toLowerCase() === want) as SVGGElement | undefined;
    if (!el) return null;
    const r = nodeShapeOf(el).getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom };
  };

  // The other selected states' offsets when one of them is dragged (they move with it)
  const groupInitialRef = useRef<Record<string, { x: number; y: number }> | null>(null);
  // (a composite dragged by its title: its name; its release is no drop of a state into or out of a composite)
  const compositeDragRef = useRef<string | null>(null);
  // (a press on a bookmark ribbon: its release is no click on the state)
  const ribbonClickRef = useRef(false);
  // (the dragged composite's own sub-composites: not where it can be dropped)
  const compositeDragInnerRef = useRef<string[]>([]);
  // (Snap each to the grid, the selection's menu: each of them snapped when moved, not only the one dragged)
  const groupSnapEachRef = useRef(false);
  groupSnapEachRef.current = !!groupSnapEach;
  // Re-layout edge (a transition's menu): that transition laid out again on its own, straight or with as few turns as
  // it can, clear of the other states; the states, the other transitions and their labels stay as they are. Its
  // label goes to its middle. Kept as its own route (its offsets: the layout file's too)
  const relayoutEdge = (edge: { id: string; pathId?: string; from: string; to: string }): string | null => {
    const svg = getDiagramSvg();
    if (!svg) return 'No drawing';
    const paths = edgePathsOf(svg);
    const path =
      (edge.pathId ? paths.find((x) => x.getAttribute('data-path-id') === edge.pathId) : undefined) ??
      paths.find((x) => x.getAttribute('data-path-id') === edge.id || x.getAttribute('data-edge-id') === edge.id) ??
      paths.find((x) => x.getAttribute('data-source-id') === edge.from && x.getAttribute('data-target-id') === edge.to);
    const key = path?.getAttribute('data-path-id') || path?.getAttribute('id') || '';
    const srcId = path?.getAttribute('data-source-id');
    const tgtId = path?.getAttribute('data-target-id');
    if (!path || !key || !srcId || !tgtId) return 'Its line is not in the drawing';
    if (srcId === tgtId) return 'A transition back to its own state keeps its loop';
    const offsets = currentNodeOffsetsRef.current;
    const boxOf = (el: SVGGElement | null, id: string | null) => (el ? nodeBoxOf(el, svg, resolveNodeOffset(id, el, offsets)) : null);
    const srcEl = findNodeElement(svg, srcId) as SVGGElement | null;
    const tgtEl = findNodeElement(svg, tgtId) as SVGGElement | null;
    const src = boxOf(srcEl, srcId);
    const tgt = boxOf(tgtEl, tgtId);
    if (!src || !tgt) return 'Its states are not in the drawing';
    // (the other states, as they are now)
    const obstacles: NodeBox[] = [];
    for (const n of Array.from(svg.querySelectorAll<SVGGElement>('g.node'))) {
      if (n === srcEl || n === tgtEl) continue;
      const id = cleanNodeId(n.getAttribute('data-state-id') || n.getAttribute('id') || '');
      if (id.startsWith('note_')) continue;
      const b = boxOf(n, id || null);
      if (b) obstacles.push(b);
    }
    // (the other lines and labels, in this line's coordinates)
    const ownCtm = path.getScreenCTM();
    const toOwn = ownCtm ? ownCtm.inverse() : null;
    const mapped = (m: DOMMatrix | null, q: { x: number; y: number }) => (m ? new DOMPoint(q.x, q.y).matrixTransform(m) : q);
    const edges = paths
      .filter((x) => x !== path)
      .map((x) => {
        const m = toOwn && x.getScreenCTM() ? toOwn.multiply(x.getScreenCTM()!) : null;
        return extractCoordinatePoints(parseSvgPathCommands(x.getAttribute('d') || '')).map((q) => mapped(m, q));
      });
    const labels: NodeBox[] = [];
    for (const l of Array.from(svg.querySelectorAll<SVGGElement>('g.edgeLabel'))) {
      const linked = l.getAttribute('data-linked-path-id');
      if (linked === key || !l.textContent?.trim()) continue;
      const r = l.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const a = mapped(toOwn, { x: r.left, y: r.top });
      const b = mapped(toOwn, { x: r.right, y: r.bottom });
      labels.push({ cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, hw: Math.abs(b.x - a.x) / 2, hh: Math.abs(b.y - a.y) / 2 });
    }
    // (its ends off the borders as they are now: the arrow head's room)
    const own = extractCoordinatePoints(parseSvgPathCommands(path.getAttribute('d') || ''));
    const route = relayoutEdgeRoute({
      src,
      tgt,
      obstacles,
      labels,
      edges,
      srcGap: own.length ? gapOutside(src, own[0]) : 0,
      tgtGap: own.length ? gapOutside(tgt, own[own.length - 1]) : 0,
      srcDiamond: isDiamondNode(srcEl),
      tgtDiamond: isDiamondNode(tgtEl),
    });
    if (!route) return 'No way between its states clear of the others';
    const next: EdgeOffset = { x: 0, y: 0, route: route.flatMap((q) => [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10]), routeAt: [src.cx, src.cy, tgt.cx, tgt.cy].map((v) => Math.round(v * 10) / 10) };
    // (its kept route, from an edit before: this one now)
    path.removeAttribute('data-frozen-d');
    path.removeAttribute('data-frozen-sig');
    currentEdgeOffsetsRef.current = { ...currentEdgeOffsetsRef.current, [key]: next };
    applyDiagramOffsetsToSvg(svg, currentNodeOffsetsRef.current, currentEdgeOffsetsRef.current, null, selectedEdge?.id || null, layoutEngine, flowchartCurve);
    setEdgeOffsets({ ...currentEdgeOffsetsRef.current });
    return null;
  };
  const relayoutEdgeRef = useRef(relayoutEdge);
  relayoutEdgeRef.current = relayoutEdge;
  // Several states lined up / spread evenly: their offsets changed, the diagram re-drawn, the positions kept
  const arrangeRef = useRef<(ids: string[], mode: string) => void>(() => {});
  const tidyRef = useRef<() => number>(() => 0);
  tidyRef.current = () => {
    const svg = getDiagramSvg();
    const n = Object.keys(currentEdgeOffsetsRef.current).length;
    currentEdgeOffsetsRef.current = {};
    setEdgeOffsets({});
    if (svg) applyDiagramOffsetsToSvg(svg, currentNodeOffsetsRef.current, {}, null, selectedEdge?.id, layoutEngine, flowchartCurve);
    return n;
  };
  arrangeRef.current = (ids, mode) => {
    const svg = getDiagramSvg();
    if (!svg || ids.length < 2) return;
    const items = ids
      .map((id) => {
        const el = svg.querySelector(`g.node[data-state-id="${CSS.escape(id)}"]`) as SVGGElement | null;
        if (!el) return null;
        const g = getNodeGeometry(el, svg);
        const off = currentNodeOffsetsRef.current[id] || { x: 0, y: 0 };
        return { id, cx: g.origCenterX + off.x, cy: g.origCenterY + off.y, hw: g.halfWidth, hh: g.halfHeight, off };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    if (items.length < 2) return;
    const target: Record<string, { cx: number; cy: number }> = {};
    const minL = Math.min(...items.map((i) => i.cx - i.hw));
    const maxR = Math.max(...items.map((i) => i.cx + i.hw));
    const minT = Math.min(...items.map((i) => i.cy - i.hh));
    const maxB = Math.max(...items.map((i) => i.cy + i.hh));
    const midX = items.reduce((s, i) => s + i.cx, 0) / items.length;
    const midY = items.reduce((s, i) => s + i.cy, 0) / items.length;
    for (const i of items) {
      if (mode === 'left') target[i.id] = { cx: minL + i.hw, cy: i.cy };
      else if (mode === 'right') target[i.id] = { cx: maxR - i.hw, cy: i.cy };
      else if (mode === 'center') target[i.id] = { cx: midX, cy: i.cy };
      else if (mode === 'top') target[i.id] = { cx: i.cx, cy: minT + i.hh };
      else if (mode === 'bottom') target[i.id] = { cx: i.cx, cy: maxB - i.hh };
      else if (mode === 'middle') target[i.id] = { cx: i.cx, cy: midY };
    }
    if (mode === 'distribute-h' || mode === 'distribute-v') {
      const h = mode === 'distribute-h';
      const sorted = [...items].sort((a, b) => (h ? a.cx - b.cx : a.cy - b.cy));
      const a = h ? sorted[0].cx : sorted[0].cy;
      const z = h ? sorted[sorted.length - 1].cx : sorted[sorted.length - 1].cy;
      sorted.forEach((i, k) => {
        const v = a + ((z - a) * k) / (sorted.length - 1);
        target[i.id] = h ? { cx: v, cy: i.cy } : { cx: i.cx, cy: v };
      });
    }
    // (snapping on: the line they are lined up on, and each spread place, on the grid)
    if (snapConfig.enabled && snapConfig.gridSize > 0) {
      const g = snapConfig.gridSize;
      const snap = (v: number) => Math.round(v / g) * g;
      const first = items.find((i) => target[i.id]);
      if (first && ['left', 'right', 'center'].includes(mode)) {
        const tg = target[first.id];
        const edge = mode === 'left' ? tg.cx - first.hw : mode === 'right' ? tg.cx + first.hw : tg.cx;
        const d = snap(edge) - edge;
        for (const i of items) if (target[i.id]) target[i.id] = { ...target[i.id], cx: target[i.id].cx + d };
      } else if (first && ['top', 'bottom', 'middle'].includes(mode)) {
        const tg = target[first.id];
        const edge = mode === 'top' ? tg.cy - first.hh : mode === 'bottom' ? tg.cy + first.hh : tg.cy;
        const d = snap(edge) - edge;
        for (const i of items) if (target[i.id]) target[i.id] = { ...target[i.id], cy: target[i.id].cy + d };
      } else if (mode === 'distribute-h') {
        for (const i of items) if (target[i.id]) target[i.id] = { ...target[i.id], cx: snap(target[i.id].cx) };
      } else if (mode === 'distribute-v') {
        for (const i of items) if (target[i.id]) target[i.id] = { ...target[i.id], cy: snap(target[i.id].cy) };
      }
    }
    const next = { ...currentNodeOffsetsRef.current };
    for (const i of items) {
      const tg = target[i.id];
      if (tg) next[i.id] = { x: Math.round(i.off.x + tg.cx - i.cx), y: Math.round(i.off.y + tg.cy - i.cy) };
    }
    setNodeOffsets(next);
    applyDiagramOffsetsToSvg(svg, next, currentEdgeOffsetsRef.current, null, selectedEdge?.id, layoutEngine, flowchartCurve);
    const positions = extractCanvasNodePositions(svg, next);
    setCanvasNodePositions(positions);
    for (const i of items) if (positions[i.id]) lockedNodePositionsRef.current[i.id] = { centerX: positions[i.id].centerX, centerY: positions[i.id].centerY };
    onCanvasPositionsChange?.(positions);
  };

  // Several states: Ctrl+click adds / removes one, Shift+drag on the canvas selects the ones in the box
  const multiGestureRef = useRef(false);
  const [selectBand, setSelectBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const handleMultiSelectDown = (e: React.MouseEvent): boolean => {
    if (e.button !== 0 || !onMultiSelectionChange) return false;
    const t = e.target as Element;
    // (a press in a menu, a dialog or a control over the canvas is theirs: React passes it on to here)
    if (t.closest?.('#diagram-context-menu, [role="menu"], [role="dialog"], [role="listbox"], button, input, textarea, select')) return false;
    const nodeEl = t.closest?.('g.node[data-state-id]');
    const id = nodeEl?.getAttribute('data-state-id') ?? null;
    if ((e.ctrlKey || e.metaKey) && id && id !== '[*]' && !t.closest('.tc-edge-handle')) {
      e.preventDefault();
      e.stopPropagation();
      const cur = multiSelection ?? [];
      const base = cur.length ? cur : effectiveSelectedStateId && effectiveSelectedStateId !== id && effectiveSelectedStateId !== '[*]' ? [effectiveSelectedStateId] : [];
      onMultiSelectionChange(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
      multiGestureRef.current = true;
      return true;
    }
    if (e.shiftKey && !id && !t.closest('[data-edge-key], .tc-edge-handle, g.edgeLabel, button, input')) {
      e.preventDefault();
      e.stopPropagation();
      multiGestureRef.current = true;
      const x0 = e.clientX;
      const y0 = e.clientY;
      setSelectBand({ x0, y0, x1: x0, y1: y0 });
      const move = (ev: MouseEvent) => setSelectBand({ x0, y0, x1: ev.clientX, y1: ev.clientY });
      const up = (ev: MouseEvent) => {
        hostWin().removeEventListener('mousemove', move);
        hostWin().removeEventListener('mouseup', up, true);
        setSelectBand(null);
        const l = Math.min(x0, ev.clientX);
        const r = Math.max(x0, ev.clientX);
        const tp = Math.min(y0, ev.clientY);
        const b = Math.max(y0, ev.clientY);
        if (r - l < 4 && b - tp < 4) return;
        const svg = getDiagramSvg();
        const ids = [...(svg?.querySelectorAll('g.node[data-state-id]') ?? [])]
          .filter((n) => {
            const q = n.getBoundingClientRect();
            return q.width > 0 && q.right > l && q.left < r && q.bottom > tp && q.top < b;
          })
          .map((n) => n.getAttribute('data-state-id') || '')
          // (the states: not the start / end circles, a choice, a note, the "any state" of preProcess())
          .filter((x) => x && x !== '[*]' && x !== 'AnyState' && !/^(startNode|endNode|choice_|note_)/.test(x));
        onMultiSelectionChange([...new Set(ids)]);
        if (ids.length) onBoxSelected?.([...new Set(ids)]);
      };
      hostWin().addEventListener('mousemove', move);
      hostWin().addEventListener('mouseup', up, true);
      return true;
    }
    // A plain click elsewhere ends the selection
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey && (multiSelection?.length ?? 0) > 0 && !id) onMultiSelectionChange([]);
    return false;
  };
  // The selected states marked
  const multiKey = (multiSelection ?? []).join('|');
  useEffect(() => {
    const svg = renderedSvg;
    if (!svg) return;
    const set = new Set(multiKey ? multiKey.split('|') : []);
    svg.querySelectorAll('g.node[data-state-id]').forEach((n) => n.classList.toggle('multi-selected', set.has(n.getAttribute('data-state-id') || '')));
  }, [renderedSvg, multiKey]);

  const handleMouseDown = (e: React.MouseEvent) => {
    // A state's bookmark ribbon: a click takes its bookmark off (no selection, no drag)
    const ribbon = e.button === 0 ? (e.target as Element).closest?.('g.state-bookmark-marker') : null;
    if (ribbon && onToggleStateBookmark) {
      e.preventDefault();
      e.stopPropagation();
      ribbonClickRef.current = true;
      const id = ribbon.getAttribute('data-state-id');
      if (id) onToggleStateBookmark(id);
      return;
    }
    if (handleMultiSelectDown(e)) return;
    if (e.button === 2) {
      // A right-click: its menu is for the transition pressed (the release may re-draw it away from the pointer)
      const t = e.target as Element;
      const key = t.closest?.('[data-edge-key]')?.getAttribute('data-edge-key');
      const found = resolveEdgeFromElement(t, getDiagramSvg(), availableEdges);
      const edge = (key ? availableEdges.find((x) => `${x.from}->${x.to}` === key) : undefined) ?? (found?.from && found?.to ? found : null);
      pressedEdgeRef.current = edge ? { edge, t: Date.now() } : null;
    }
    if (e.button !== 0) return;
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    edgeSelectedBeforePressRef.current = false;
    edgePressedRef.current = false;

    // Cancel any active smooth scroll animation immediately on mouse interaction
    if (activePanAnimationRef.current) {
      hostWin().cancelAnimationFrame(activePanAnimationRef.current);
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
      target.closest('#diagram-search-panel') ||
      target.closest('#edge-guard-condition-hover-badge')
    ) {
      return;
    }

    keepGuardPopup();
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
        const startSvg = getDiagramSvg();
        edgeInitialDRef.current = (startSvg && edgePathsOf(startSvg).find((x) => x.getAttribute('data-path-id') === eId || x.getAttribute('data-edge-id') === eId)?.getAttribute('d')) || null;
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
        compositeDragRef.current = null;
        isDraggingNodeRef.current = true;
        draggedNodeIdRef.current = stateId;
        draggedNodeElRef.current = nodeEl;
        dragUnitScaleRef.current = getSvgUnitScale(nodeEl.parentElement, zoom);
        nodeDragStartPosRef.current = { x: e.clientX, y: e.clientY };
        nodeMovedRef.current = false;
        const currentOffset = effectiveNodeOffsets[stateId] || { x: 0, y: 0 };
        nodeInitialOffsetRef.current = { ...currentOffset };
        // (one of several selected states: the others move with it)
        groupInitialRef.current =
          multiSelection && multiSelection.length > 1 && multiSelection.includes(stateId)
            ? Object.fromEntries(multiSelection.filter((id) => id !== stateId).map((id) => [id, { ...(effectiveNodeOffsets[id] || { x: 0, y: 0 }) }]))
            : null;

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

    // B2. A composite's title: the composite dragged, with its states and the composites inside it (their offsets
    // moved together: the composite's box follows by its own offset)
    const clusterOfTitle = target.closest('.cluster-label')?.closest('g.cluster, .statediagram-cluster') as SVGGElement | null;
    if (clusterOfTitle) {
      const svgRoot = getDiagramSvg();
      const box = clusterOfTitle.querySelector(':scope > rect, :scope > g > rect.outer')?.getBoundingClientRect();
      const nameOf = (c: Element) => c.getAttribute('data-id') || c.id.replace(/^.*?render-[a-z0-9]+-/i, '').replace(/^state-/, '').replace(/-\d+$/, '');
      const inside = (r: DOMRect) => !!box && r.width > 0 && r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
      const states = [...(svgRoot?.querySelectorAll('g.node[data-state-id]') ?? [])].filter((n) => inside(n.getBoundingClientRect())).map((n) => n.getAttribute('data-state-id')!).filter((id) => !id.startsWith('note_'));
      const inner = [...(svgRoot?.querySelectorAll('g.cluster, .statediagram-cluster') ?? [])].filter((c) => c !== clusterOfTitle && inside((c.querySelector(':scope > rect, :scope > g > rect.outer') ?? c).getBoundingClientRect())).map(nameOf);
      const name = nameOf(clusterOfTitle);
      const lead = states[0];
      const leadEl = lead ? svgRoot?.querySelector(`g.node[data-state-id="${CSS.escape(lead)}"]`) as SVGGElement | null : null;
      if (name && lead && leadEl) {
        e.preventDefault();
        compositeDragRef.current = name;
        compositeDragInnerRef.current = inner;
        isDraggingNodeRef.current = true;
        draggedNodeIdRef.current = lead;
        draggedNodeElRef.current = leadEl;
        dragUnitScaleRef.current = getSvgUnitScale(leadEl.parentElement, zoom);
        nodeDragStartPosRef.current = { x: e.clientX, y: e.clientY };
        nodeMovedRef.current = false;
        const currentOffset = effectiveNodeOffsets[lead] || { x: 0, y: 0 };
        nodeInitialOffsetRef.current = { ...currentOffset };
        groupInitialRef.current = Object.fromEntries([...states.slice(1), name, ...inner].map((id) => [id, { ...(effectiveNodeOffsets[id] || { x: 0, y: 0 }) }]));
        const geom = getNodeGeometry(leadEl, svgRoot);
        nodeInitialCenterRef.current = { x: geom.origCenterX + currentOffset.x, y: geom.origCenterY + currentOffset.y, origCenterX: geom.origCenterX, origCenterY: geom.origCenterY };
        clusterOfTitle.classList.add('dragging-composite');
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
      pressedEdgeRef.current = { edge: clickedEdge, t: Date.now() };
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

  // An edge's start / end handle over another state: that state is marked; dropped there, the app moves the end
  const dropTargetRef = useRef<Element | null>(null);
  // (by the nodes' boxes: while dragging, the nodes take no pointer events; the smallest box wins, not a cluster)
  const endpointNodeAt = (x: number, y: number): Element | null => {
    let best: Element | null = null;
    let bestArea = Infinity;
    getDiagramSvg()?.querySelectorAll('g.node[data-state-id]').forEach((node) => {
      if (node.closest('g.note')) return;
      const r = node.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
      if (r.width * r.height < bestArea) {
        best = node;
        bestArea = r.width * r.height;
      }
    });
    return best;
  };
  // A handle's transition (handles are keyed by the path's id: the transition is the path's)
  const edgeOfHandleKey = (key: string): EdgeInfo | undefined => {
    const svg = getDiagramSvg();
    const pathEl = svg?.querySelector(`path[data-path-id="${CSS.escape(key)}"]`) ?? svg?.querySelector(`path#${CSS.escape(key)}`);
    const edgeId = pathEl?.getAttribute('data-edge-id');
    const edgeKey = pathEl?.getAttribute('data-edge-key');
    return (
      availableEdges.find((x) => x.id === key || (!!x.pathId && x.pathId === key)) ??
      (edgeId ? availableEdges.find((x) => x.id === edgeId) : undefined) ??
      (edgeKey ? availableEdges.find((x) => `${x.from}->${x.to}` === edgeKey) : undefined) ??
      (selectedEdge && selectedEdge.id !== '->' ? selectedEdge : undefined)
    );
  };
  const endpointTarget = (x: number, y: number) => {
    const eId = draggedEdgeIdRef.current;
    const type = draggedHandleTypeRef.current;
    if (!onEdgeEndpointDrop || !eId || (type !== 'start' && type !== 'end')) return null;
    const edge = edgeOfHandleKey(eId);
    const node = endpointNodeAt(x, y);
    const id = node?.getAttribute('data-state-id');
    if (!edge || !node || !id || id === (type === 'start' ? edge.from : edge.to)) return null;
    return { edge, type, id, node } as const;
  };
  const markDropTarget = (node: Element | null) => {
    if (dropTargetRef.current === node) return;
    dropTargetRef.current?.classList.remove('edge-drop-target');
    node?.classList.add('edge-drop-target');
    dropTargetRef.current = node;
  };
  // A state confirms a connection: a short flash
  const flashNode = (node: Element) => {
    node.classList.remove('edge-drop-snapped');
    void (node as SVGGElement).getBBox?.();
    node.classList.add('edge-drop-snapped');
    window.setTimeout(() => node.classList.remove('edge-drop-snapped'), 900);
  };
  /**
   * A handle released over its own state: the end moves onto the state's border, where the line from its center
   * toward the pointer crosses it
   */
  const snapEndpointToNode = (x: number, y: number) => {
    const eId = draggedEdgeIdRef.current;
    const type = draggedHandleTypeRef.current;
    if (!eId || (type !== 'start' && type !== 'end') || !edgeMovedRef.current) return;
    const node = endpointNodeAt(x, y);
    const current = currentEdgeOffsetsRef.current[eId];
    if (!node || !current) return;
    // (the state's own box, not its badges)
    const r = nodeShapeOf(node).getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = x - cx;
    let dy = y - cy;
    if (!dx && !dy) dy = -1;
    const k = Math.min(dx ? r.width / 2 / Math.abs(dx) : Infinity, dy ? r.height / 2 / Math.abs(dy) : Infinity);
    const sx = cx + dx * k;
    const sy = cy + dy * k;
    const scale = dragUnitScaleRef.current;
    const next: EdgeOffset = { ...current };
    if (type === 'start') {
      next.startDx = Math.round((current.startDx || 0) + (sx - x) / scale.x);
      next.startDy = Math.round((current.startDy || 0) + (sy - y) / scale.y);
    } else {
      next.endDx = Math.round((current.endDx || 0) + (sx - x) / scale.x);
      next.endDy = Math.round((current.endDy || 0) + (sy - y) / scale.y);
    }
    currentEdgeOffsetsRef.current = { ...currentEdgeOffsetsRef.current, [eId]: next };
    const svg = getDiagramSvg();
    if (svg) applyDiagramOffsetsToSvg(svg, currentNodeOffsetsRef.current, currentEdgeOffsetsRef.current, null, eId, layoutEngine, flowchartCurve);
    flashNode(node);
  };
  /** At the end of a handle drag: true when it was dropped on another state (the reroute is undone) */
  const finishEndpointDrop = (x: number, y: number) => {
    markDropTarget(null);
    const target = edgeMovedRef.current ? endpointTarget(x, y) : null;
    if (!target) {
      snapEndpointToNode(x, y);
      return false;
    }
    flashNode(target.node);
    const eId = target.edge.id;
    currentEdgeOffsetsRef.current = { ...currentEdgeOffsetsRef.current, [eId]: edgeInitialOffsetRef.current };
    const svg = getDiagramSvg();
    if (svg) applyDiagramOffsetsToSvg(svg, currentNodeOffsetsRef.current, currentEdgeOffsetsRef.current, null, eId, layoutEngine, flowchartCurve);
    // (the states stay where they are in the drawing the edit brings; this transition: its other end's stretch kept)
    const was = svg ? edgePathsOf(svg).find((x) => x.getAttribute('data-path-id') === eId || x.getAttribute('data-edge-id') === eId) ?? edgePathsOf(svg).find((x) => x.getAttribute('data-source-id') === target.edge.from && x.getAttribute('data-target-id') === target.edge.to) : undefined;
    const wasD = edgeInitialDRef.current || was?.getAttribute('d') || '';
    edgeInitialDRef.current = null;
    keepPositionsForNextDrawing(wasD ? { atStart: target.type === 'start', from: target.edge.from, to: target.edge.to, newId: target.id, d: wasD } : null);
    onEdgeEndpointDrop?.(target.edge, target.type, target.id);
    return true;
  };
  // The composite (cluster) at a point of the screen: its label (the smallest cluster holding the point)
  const compositeAt = (x: number, y: number): string | null => {
    let best: string | null = null;
    let bestArea = Infinity;
    // (a flowchart's subgraph, a state diagram's composite: its frame)
    getDiagramSvg()?.querySelectorAll(COMPOSITE_SELECTOR).forEach((c) => {
      const r = (compositeRectsOf(c).outer ?? c).getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
      const label = (c.querySelector('.cluster-label, .nodeLabel, text')?.textContent ?? '').trim();
      if (label && r.width * r.height < bestArea) {
        best = label;
        bestArea = r.width * r.height;
      }
    });
    return best;
  };
  // The composites (cluster labels) at a point of the screen, smallest first
  const compositesAt = (x: number, y: number): string[] => {
    const hits: { label: string; area: number }[] = [];
    // (a flowchart's subgraph, a state diagram's composite: its frame)
    getDiagramSvg()?.querySelectorAll(COMPOSITE_SELECTOR).forEach((c) => {
      const r = (compositeRectsOf(c).outer ?? c).getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
      const label = (c.querySelector('.cluster-label, .nodeLabel, text')?.textContent ?? '').trim();
      if (label) hits.push({ label, area: r.width * r.height });
    });
    return hits.sort((a, b) => a.area - b.area).map((h) => h.label);
  };
  const isPaletteDrag = (e: React.DragEvent) => !!onPaletteElement && Array.from(e.dataTransfer.types).includes(PALETTE_MIME);
  const handlePaletteDragOver = (e: React.DragEvent) => {
    if (!isPaletteDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    markDropTarget(endpointNodeAt(e.clientX, e.clientY));
  };
  const handlePaletteDrop = (e: React.DragEvent) => {
    if (!isPaletteDrag(e)) return;
    e.preventDefault();
    markDropTarget(null);
    const kind = e.dataTransfer.getData(PALETTE_MIME) as PaletteElement;
    if (kind === 'note') return addFreeNoteAt(e.clientX, e.clientY);
    const node = endpointNodeAt(e.clientX, e.clientY);
    onPaletteElement?.(kind, { stateId: node?.getAttribute('data-state-id') ?? null, composite: compositeAt(e.clientX, e.clientY), x: e.clientX, y: e.clientY });
  };
  // A free note: its card's corner where it was dropped (in the zoom wrapper's units, like the other notes)
  const addFreeNoteAt = (x: number, y: number) => {
    const wrapper = (getDiagramSvg()?.closest('#mermaid-svg-wrapper') ?? document.getElementById('mermaid-svg-wrapper')) as HTMLElement | null;
    if (!wrapper) return;
    const w = wrapper.getBoundingClientRect();
    const scale = wrapper.offsetWidth > 0 && w.width > 0 ? w.width / wrapper.offsetWidth : zoom || 1;
    const id = `note_${Date.now().toString(36)}`;
    onUpdateNotePositionProp?.(id, { x: Math.round((x - w.left) / scale), y: Math.round((y - w.top) / scale) });
    handleOpenAddNote({ type: 'node', id, label: 'Note' });
  };
  const handlePaletteClick = (kind: PaletteElement) => {
    if (kind !== 'note') return onPaletteElement?.(kind, null);
    const r = containerRef.current?.getBoundingClientRect();
    if (r) addFreeNoteAt(r.left + r.width / 2 - 80, r.top + r.height / 3);
  };
  // The canvas' top in the viewer (the bars above it change height): the palette's corner
  const [canvasTop, setCanvasTop] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setCanvasTop(el.offsetTop);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [svgContent]);
  // A new state's node moved to where it was dropped
  const placedNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!placeRequest || placedNonceRef.current === placeRequest.nonce) return;
    const node = getDiagramSvg()?.querySelector(`g.node[data-state-id="${CSS.escape(placeRequest.stateId)}"]`) as SVGGElement | null;
    if (!node) return;
    placedNonceRef.current = placeRequest.nonce;
    const r = node.getBoundingClientRect();
    const scale = getSvgUnitScale(node.parentElement, zoom);
    const current = effectiveNodeOffsets[placeRequest.stateId] ?? { x: 0, y: 0 };
    setNodeOffsets({
      ...effectiveNodeOffsets,
      [placeRequest.stateId]: {
        x: Math.round(current.x + (placeRequest.x - (r.left + r.width / 2)) / scale.x),
        y: Math.round(current.y + (placeRequest.y - (r.top + r.height / 2)) / scale.y),
      },
    });
  });

  const finishEndpointDropRef = useRef(finishEndpointDrop);
  finishEndpointDropRef.current = finishEndpointDrop;

  // The app's canvas keys (priority, copy / paste, delete), with the selected state or transition
  const canvasKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  canvasKeyRef.current = (e: KeyboardEvent) => {
    if (!onCanvasKey || e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!containerRef.current || containerRef.current.offsetParent === null) return;
    // (menus and modal dialogs; the canvas' own windows, such as the style window, do not count)
    if (document.querySelector('#diagram-context-menu, #dock-context-menu, #window-menu, #text-prompt-overlay, [aria-modal="true"]')) return;
    // Only while the canvas is the last thing used (not a code editor next to it)
    if (!canvasActiveRef.current) return;
    // The selection made last (a state and a transition can both be selected)
    const edge = selectedEdge && selectedEdge.id !== '->' ? selectedEdge : null;
    const stateId = effectiveSelectedStateId ?? null;
    const latest = lastSelectedKindRef.current;
    const selection = edge && stateId ? (latest === 'edge' ? { stateId: null, edge } : { stateId, edge: null }) : { stateId, edge };
    if (onCanvasKey(e, selection)) e.preventDefault();
  };
  const lastSelectedKindRef = useRef<'state' | 'edge' | null>(null);
  useEffect(() => {
    if (selectedEdge && selectedEdge.id !== '->') lastSelectedKindRef.current = 'edge';
  }, [selectedEdge]);
  useEffect(() => {
    if (effectiveSelectedStateId) lastSelectedKindRef.current = 'state';
  }, [effectiveSelectedStateId]);
  // The last press or focus was on the canvas (its mouse-down takes no focus: a button used before keeps it)
  const canvasActiveRef = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => canvasKeyRef.current(e);
    const onPress = (e: Event) => {
      canvasActiveRef.current = !!containerRef.current?.contains(e.target as Node);
    };
    window.addEventListener('keydown', onKey);
    // (in the windows tabs were moved to too: their keys come to this window, their presses do not)
    const offPress = listenOnAppWindows('pointerdown', onPress, true);
    const offFocus = listenOnAppWindows('focusin', onPress, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      offPress();
      offFocus();
    };
  }, []);

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

      if (edgeMovedRef.current && (handleType === 'start' || handleType === 'end')) markDropTarget(endpointTarget(e.clientX, e.clientY)?.node ?? null);
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
          if (labelDragFrameRef.current !== null) hostWin().cancelAnimationFrame(labelDragFrameRef.current);
          labelDragFrameRef.current = hostWin().requestAnimationFrame(() => {
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
            edgeDragFrameRef.current = hostWin().requestAnimationFrame(() => {
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
        nodeDragFrameRef.current = hostWin().requestAnimationFrame(() => {
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
        const group = groupInitialRef.current;
        if (group) {
          const dx = newOffset.x - nodeInitialOffsetRef.current.x;
          const dy = newOffset.y - nodeInitialOffsetRef.current.y;
          // (snapping on and Snap each to the grid: each of them on the grid too, not only the one dragged; else they keep their places to it)
          const g = snapConfig.enabled && snapConfig.gridSize > 0 && groupSnapEachRef.current ? snapConfig.gridSize : 0;
          const groupSvg = g ? getDiagramSvg() : null;
          for (const [id, o] of Object.entries(group)) {
            let next = { x: o.x + dx, y: o.y + dy };
            const el = groupSvg?.querySelector(`g.node[data-state-id="${CSS.escape(id)}"]`);
            const ocx = parseFloat(el?.getAttribute('data-orig-cx') ?? 'NaN');
            const ocy = parseFloat(el?.getAttribute('data-orig-cy') ?? 'NaN');
            if (g && Number.isFinite(ocx) && Number.isFinite(ocy)) next = { x: Math.round((ocx + next.x) / g) * g - ocx, y: Math.round((ocy + next.y) / g) * g - ocy };
            currentNodeOffsetsRef.current[id] = next;
          }
        }

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
              group ? undefined : { onlyNodeId: stateId }
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

    let target = e.target as Element;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };

    // (the guard popup itself: kept open while the mouse is on it, to pin it, copy, or open a transition it lists;
    // not pinned, another label or badge under it is that one's: the popup does not hide the labels it covers)
    if (target?.closest?.('#edge-guard-condition-hover-badge')) {
      const beneath = guardPinned
        ? undefined
        : document
            .elementsFromPoint(e.clientX, e.clientY)
            .find((el) => !el.closest('#edge-guard-condition-hover-badge') && el.closest('g.edgeLabel, .tc-priority-badge, .priority-badge'));
      if (!beneath) {
        keepGuardPopup();
        return;
      }
      target = beneath;
    }

    // 3.5 Hover tracking for Edge Label Guard Condition Visual Badge
    const labelOrBadgeEl = (target?.closest('g.edgeLabel') ||
      target?.closest('.clickable-edge-label') ||
      target?.closest('.tc-interactive-edge-label') ||
      target?.closest('.tc-priority-badge') ||
      target?.closest('.priority-badge')) as HTMLElement | SVGElement | null;

    if (guardPinned) {
      // (pinned: it stays, whatever is hovered, until unpinned, Esc or a click elsewhere)
    } else if (
      labelOrBadgeEl &&
      hoverPopups &&
      !isDraggingNodeRef.current &&
      !isDraggingEdgeHandleRef.current &&
      !activeConditionOverlay &&
      !isInspectorOpen
    ) {
      const svg = getDiagramSvg();
      const edge = resolveEdgeFromElement(labelOrBadgeEl, svg, availableEdges);
      if (edge && edge.from && edge.to) {
        keepGuardPopup();
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
          linkedPathId: labelOrBadgeEl.getAttribute('data-linked-path-id') || labelOrBadgeEl.getAttribute('data-path-id') || undefined,
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
        leaveGuardPopup();
      }
    } else if (hoveredEdgeCondition) {
      leaveGuardPopup();
    }

    // 4. Hover tracking for Complexity Heat-map Tooltip & Refactor Badges
    const shouldTrackComplexityHover =
      hoverPopups &&
      (isHeatmapActive || showComplexityBadges) &&
      !isDraggingNodeRef.current &&
      !isDraggingEdgeHandleRef.current;

    if (shouldTrackComplexityHover) {
      const nodeEl = target?.closest('g.node') as HTMLElement | SVGElement | null;
      if (nodeEl) {
        if (hoveredEdgeCondition) {
          leaveGuardPopup();
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

    // 5. A state's actions (entry / do / exit), as soon as the pointer is on it
    if (!hoverPopups) {
      if (hoveredActions) setHoveredActions(null);
    } else if (stateTooltips && !isDraggingNodeRef.current && !isDraggingEdgeHandleRef.current) {
      const nodeEl = target?.closest('g.node[data-state-id]');
      const sId = nodeEl?.getAttribute('data-state-id') || '';
      const tip = sId ? stateTooltips[sId] : undefined;
      if (tip) {
        if (hoveredActions?.id !== sId) {
          // (its box goes beside the state: the state's own shape, not its badges)
          const r = nodeShapeOf(nodeEl!).getBoundingClientRect();
          setHoveredActions({ id: sId, text: tip.split('\n').slice(1).join('\n'), x: e.clientX, y: e.clientY, rect: { l: r.left, t: r.top, r: r.right, b: r.bottom } });
        }
      } else if (hoveredActions) setHoveredActions(null);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    // (a ribbon's click: done on the press)
    if (ribbonClickRef.current) {
      ribbonClickRef.current = false;
      return;
    }
    // (a Ctrl+click / Shift+drag selection: nothing else)
    if (multiGestureRef.current) return;
    // Apply the latest pending node-drag position before finishing the drag
    if (nodeDragFrameRef.current !== null) {
      hostWin().cancelAnimationFrame(nodeDragFrameRef.current);
      nodeDragFrameRef.current = null;
      applyNodeDragFrameRef.current?.();
    }
    flushLabelDrag();
    // The edge drag's last frame, if it has not run yet
    if (edgeDragFrameRef.current !== null) {
      hostWin().cancelAnimationFrame(edgeDragFrameRef.current);
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
      const dropped = finishEndpointDrop(e.clientX, e.clientY);
      const wasMoved = edgeMovedRef.current && !dropped;
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
        const dropComposites = compositesAt(e.clientX, e.clientY);
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
        // (after its position is kept: a move into a composite drops it again, for the layout to place it there)
        // (a composite dragged by its title: moved, not dropped into another one)
        if (compositeDragRef.current) {
          getDiagramSvg()?.querySelectorAll('.dragging-composite').forEach((c) => c.classList.remove('dragging-composite'));
          const dragged = compositeDragRef.current;
          const own = new Set([dragged, ...compositeDragInnerRef.current]);
          compositeDragRef.current = null;
          // (the composite it was released in: nested there, or out of the one it was in)
          if (wasMoved) onCompositeDropped?.(dragged, compositesAt(e.clientX, e.clientY).find((c) => !own.has(c)) ?? null);
        } else onStateDropped?.(stateId, dropComposites, e.altKey);
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

    // 1b. A composite's title or its border (inside it: the canvas' menu, to paste or add there)
    const clusterEl = target.closest('g.cluster, .statediagram-cluster') as SVGGElement | null;
    if (clusterEl) {
      const box = clusterEl.querySelector(':scope > rect, :scope > g > rect.outer')?.getBoundingClientRect();
      const B = 10;
      const onBorder = !!box && [e.clientX - box.left, box.right - e.clientX, e.clientY - box.top, box.bottom - e.clientY].some((d) => Math.abs(d) <= B);
      const name = clusterEl.getAttribute('data-id') || clusterEl.id.replace(/^.*?render-[a-z0-9]+-/i, '');
      if (name && (target.closest('.cluster-label') || onBorder)) {
        setContextMenuState({ x: e.clientX, y: e.clientY, target: { type: 'composite', id: name, label: name } });
        return;
      }
    }

    // 2. Clicked on an edge
    const svg = getDiagramSvg();
    let edge = resolveEdgeFromElement(target, svg, availableEdges);
    if (!edge?.from || !edge?.to) {
      // (a path whose id does not name its states: its "FROM->TO" key does; a handle: its path's)
      const key = target.closest('[data-edge-key]')?.getAttribute('data-edge-key');
      const handleKey = target.closest('.tc-edge-handle[data-edge-id]')?.getAttribute('data-edge-id');
      edge =
        (key ? availableEdges.find((x) => `${x.from}->${x.to}` === key) : undefined) ??
        (handleKey ? edgeOfHandleKey(handleKey) : undefined) ??
        (svg ? findEdgeNearPoint(svg, e.clientX, e.clientY, availableEdges, 24) : null) ??
        (pressedEdgeRef.current && Date.now() - pressedEdgeRef.current.t < 1500 ? pressedEdgeRef.current.edge : null) ??
        edge;
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
    const handleWindowMouseUp = (e: MouseEvent) => {
      flushLabelDrag();
      if (isDraggingEdgeHandleRef.current) {
        const edgeId = draggedEdgeIdRef.current;
        const dropped = finishEndpointDropRef.current(e.clientX, e.clientY);
        const wasMoved = edgeMovedRef.current && !dropped;
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

    ownerWin.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      ownerWin.removeEventListener('mouseup', handleWindowMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerWin]);

  // Close Snap to Grid configuration menu on outside click
  useEffect(() => {
    if (!isSnapMenuOpen) return;
    const handleCloseSnapMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('#snap-to-grid-toolbar-group')) {
        setIsSnapMenuOpen(false);
      }
    };
    ownerWin.addEventListener('mousedown', handleCloseSnapMenu);
    return () => ownerWin.removeEventListener('mousedown', handleCloseSnapMenu);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSnapMenuOpen, ownerWin]);

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
      hostWin().cancelAnimationFrame(activePanAnimationRef.current);
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
        target.closest('#edge-condition-detail-overlay, #transition-guard-inspector') ||
        // (the right-click menu of a state / a transition, and any menu or dialog over the canvas: they scroll themselves)
        target.closest('#diagram-context-menu, [role="menu"], [role="dialog"], [role="listbox"]'))
    ) {
      // Allow normal scrolling inside editors and UI overlays; do NOT zoom canvas
      return;
    }
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const oldZoom = wheelZoomRef.current;
    const newZoom = Math.min(Math.max(0.2, oldZoom * factor), maxZoomRef.current);
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

  // (the latest Fit, for a delayed call: after the canvas was expanded or brought back)
  const resetZoomRef = useRef<() => void>(() => {});
  resetZoomRef.current = () => handleResetZoom();
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
    exportSettings?.background ?? (isDarkTheme(mermaidTheme) ? 'dark' : 'white');

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
      zoomIn: () => setZoom((prev) => Math.min(maxZoomRef.current, prev * 1.2)),
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
      arrangeStates: (ids, mode) => arrangeRef.current(ids, mode),
      tidyEdges: () => tidyRef.current(),
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
    // (the app's Focus mode: no browser fullscreen, no fixed layer; the chart fitted to the canvas' new size)
    if (onExpandedChange) {
      onExpandedChange(!isFullscreen);
      window.setTimeout(() => resetZoomRef.current(), 300);
      return;
    }
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
        // (the app's Focus mode: Esc is the app's)
        if (isFullscreen && !onExpandedChange) {
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

      // Keyboard arrow keys to nudge the selected state (several selected: all of them)
      const nudged = (multiSelection?.length ?? 0) > 1 ? multiSelection! : effectiveSelectedStateId ? [effectiveSelectedStateId] : [];
      if (nudged.length && !isInspectorOpen && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
            const nextOffsets = { ...effectiveNodeOffsets };
            for (const id of nudged) {
              const current = effectiveNodeOffsets[id] || { x: 0, y: 0 };
              nextOffsets[id] = { x: current.x + delta.x, y: current.y + delta.y };
            }
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
  }, [isFullscreen, isInspectorOpen, effectiveSelectedStateId, effectiveNodeOffsets, selectedEdge, multiKey]);

  const handleClick = (e: React.MouseEvent) => {
    if (multiGestureRef.current) {
      multiGestureRef.current = false;
      return;
    }
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
      'interactive', 'labels', 'hover', 'code',
      'autoAlign', 'lock', 'snap', 'grid', 'resetLayout',
      'heatmap', 'refactor',
      'stats', 'legend', 'notes', 'minimap', 'styles',
      'zoom', 'fullscreen',
    ] as ToolbarItemId[]
  ).filter((id) => (id === 'code' ? hasCodeEditors : id === 'resetLayout' ? movedElementsCount > 0 : true));
  const TOOLBAR_GROUP: Record<ToolbarItemId, number> = {
    interactive: 0, labels: 0, hover: 0, code: 0, grid: 1,
    autoAlign: 1, lock: 1, snap: 1, resetLayout: 1,
    heatmap: 2, refactor: 2,
    stats: 3, legend: 3, notes: 3, minimap: 3, styles: 3,
    zoom: 4, fullscreen: 4,
  };
  // First to stay visible -> last to move into the Hidden menu
  const TOOLBAR_PRIORITY: ToolbarItemId[] = [
    'zoom', 'fullscreen', 'interactive', 'code', 'autoAlign', 'heatmap', 'lock', 'resetLayout',
    'stats', 'legend', 'notes', 'minimap', 'styles', 'refactor', 'grid', 'snap', 'hover', 'labels',
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
            title="Find states and transitions by name or condition (Ctrl+F); Enter: the next one"
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
            hoverPopups={hoverPopups}
            setHoverPopups={setHoverPopups}
            showGrid={showGrid}
            setShowGrid={setShowGrid}
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
            fitScale={fitScale}
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
      case 'grid':
        return (
          <button
            id="toolbar-grid-btn"
            type="button"
            aria-pressed={showGrid}
            onClick={() => setShowGrid(!showGrid)}
            className={toolbarButtonClass(showGrid, 'bg-sky-950/80 text-sky-300 border border-sky-600/70')}
            title={`Grid ${showGrid ? 'on' : 'off'}: the canvas' dots - click to turn them ${showGrid ? 'off' : 'on'}`}
          >
            <Grid3x3 className={`w-3.5 h-3.5 ${showGrid ? 'text-sky-400' : 'text-slate-500'}`} />
          </button>
        );
      case 'hover':
        return (
          <button
            id="toolbar-hover-popups-btn"
            type="button"
            aria-pressed={hoverPopups}
            onClick={() => setHoverPopups(!hoverPopups)}
            className={toolbarButtonClass(hoverPopups, 'bg-sky-950/80 text-sky-300 border border-sky-600/70')}
            title={`Hover popups ${hoverPopups ? 'on' : 'off'}: the popups on hovering a state (its code), a transition's label or a badge (its guard) - click to turn them ${hoverPopups ? 'off' : 'on'}`}
          >
            <MessageSquare className={`w-3.5 h-3.5 ${hoverPopups ? 'text-sky-400' : 'text-slate-500'}`} />
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
            <button
              id="zoom-label-button"
              type="button"
              onClick={() => {
                onSwitchToDiagramTab?.();
                // (fitted: its own size; else fitted again)
                const atFit = Math.abs(zoom - 1) < 0.01;
                setZoom(atFit && fitScale < 0.999 ? Math.min(maxZoomRef.current, 1 / fitScale) : 1);
                setPan({ x: 0, y: 0 });
              }}
              className="px-0.5 font-mono text-[11px] text-slate-400 hover:text-slate-200 rounded select-none cursor-pointer"
              title="The chart's size shown (100%: its own size). Click: its own size / fitted to the canvas"
            >
              {Math.round(zoom * fitScale * 100)}%
            </button>
            <button
              id="zoom-in-button"
              type="button"
              onClick={() => {
                onSwitchToDiagramTab?.();
                setZoom((z) => Math.min(maxZoomRef.current, z * 1.15));
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
              title="Fit the chart to the canvas (the view reset: zoom and position)"
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
            title={isFullscreen ? 'Back to the panels (Esc, Z)' : 'Expand the canvas to the whole window: the header and the side panels hidden, the chart fitted (Z; Esc brings them back)'}
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
        isFullscreen && !onExpandedChange ? 'fixed inset-0 z-[100] w-screen h-screen rounded-none border-none shadow-2xl' : isFullscreen ? 'rounded-none border-none' : ''
      }`}
    >
      {/* If in Fullscreen mode, render toolbar inside fullscreen container. Otherwise portal to 2nd row of header */}
      {isFullscreen
        ? toolbarContent
        : effectivePortalTarget
        ? createPortal(toolbarContent, effectivePortalTarget)
        : toolbarContent}

      {/* The box of a Shift+drag selection, and how many states are selected */}
      {selectBand && (
        <div
          id="canvas-select-band"
          className="fixed z-40 pointer-events-none border border-sky-400 bg-sky-400/10 rounded-sm"
          style={{ left: Math.min(selectBand.x0, selectBand.x1), top: Math.min(selectBand.y0, selectBand.y1), width: Math.abs(selectBand.x1 - selectBand.x0), height: Math.abs(selectBand.y1 - selectBand.y0) }}
        />
      )}
      {canvasBanner && (
        <div id="canvas-learned-banner" className="absolute left-1/2 -translate-x-1/2 z-30 max-w-[80%] flex items-center gap-2 px-3 py-1 rounded-full bg-amber-950/90 border border-amber-600/80 text-[11px] text-amber-100 shadow-lg" style={{ top: canvasTop + 8 + ((multiSelection?.length ?? 0) > 1 ? 30 : 0) }} title={canvasBanner}>
          <span className="truncate">{canvasBanner}</span>
          {canvasBannerAction && (
            <button id={canvasBannerAction.id} type="button" onClick={canvasBannerAction.onClick} title={canvasBannerAction.title} className="shrink-0 px-2 py-0.5 rounded-full border border-amber-500/70 text-amber-100 hover:bg-amber-800/60">
              {canvasBannerAction.label}
            </button>
          )}
        </div>
      )}
      {(multiSelection?.length ?? 0) > 1 && (
        <div id="canvas-multi-selection" className="absolute left-1/2 -translate-x-1/2 z-30 px-3 py-1 rounded-full bg-sky-900/90 border border-sky-600 text-[11px] text-sky-100 shadow-lg" style={{ top: canvasTop + 8 }}>
          {multiSelection!.length} states selected · right-click one of them for their actions · Esc clears
        </div>
      )}
      {/* The statechart palette: over the canvas, not in it (the canvas' first <svg> is the diagram) */}
      {onPaletteElement && !error && svgContent && <StatechartPalette onClick={handlePaletteClick} history={history} top={canvasTop + 8} />}
      {/* The layout kept (an edit from the canvas: the states where they were, the other transitions drawn as they were): a re-layout at hand */}
      {!error && svgContent && keptRoutes > 0 && (
        <div
          id="layout-kept-chip"
          className="absolute left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 pl-2.5 pr-1 py-1 rounded-full border border-slate-700/70 bg-slate-900/90 text-[11px] text-slate-300 shadow-lg backdrop-blur"
          style={{ top: canvasTop + 8 }}
          title="After an edit from the canvas the states stay where they were and the other transitions are drawn as they were, so you see what changed. Re-layout lets the layout engine place everything again."
        >
          <Lock className="w-3 h-3 text-slate-400" />
          <span>Layout kept: {keptRoutes} transition{keptRoutes === 1 ? '' : 's'} as drawn</span>
          <button
            id="layout-kept-relayout-btn"
            type="button"
            onClick={() => {
              onSwitchToDiagramTab?.();
              handleAutoAlign();
            }}
            disabled={isAutoAligning}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/20 border border-sky-500/40 text-sky-300 hover:bg-sky-500/30 disabled:opacity-50"
          >
            <Workflow className="w-3 h-3" />
            Re-layout
          </button>
        </div>
      )}
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
          setHoveredActions(null);
          lastPointerRef.current = null;
          leaveGuardPopup();
        }}
        onClick={handleClick}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        onDragOver={handlePaletteDragOver}
        onDragLeave={(e) => {
          if (!containerRef.current?.contains(e.relatedTarget as Node)) markDropTarget(null);
        }}
        onDrop={handlePaletteDrop}
        data-grid={showGrid ? 'on' : 'off'}
        style={canvasBackgroundOf(mermaidTheme) ? { backgroundColor: canvasBackgroundOf(mermaidTheme)! } : undefined}
        className={`flex-1 relative overflow-hidden [background-size:16px_16px] cursor-grab transition-colors duration-200 ${
          isNodeDragging ? 'tc-node-dragging ' : ''
        }${
          ideThemeOf(mermaidTheme)
            ? `${showGrid ? 'bg-[radial-gradient(var(--color-slate-800)_1px,transparent_1px)]' : ''}`
            : mermaidTheme === 'dark'
            ? `bg-slate-900 ${showGrid ? 'bg-[radial-gradient(#1e293b_1px,transparent_1px)]' : ''}`
            : mermaidTheme === 'forest'
            ? `bg-[#f4f7f4] ${showGrid ? 'bg-[radial-gradient(#cbd5e1_1px,transparent_1px)]' : ''}`
            : mermaidTheme === 'neutral'
            ? `bg-[#f5f5f4] ${showGrid ? 'bg-[radial-gradient(#d6d3d1_1px,transparent_1px)]' : ''}`
            : `bg-[#f8fafc] ${showGrid ? 'bg-[radial-gradient(#cbd5e1_1px,transparent_1px)]' : ''}`
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

            {/* Snap to Grid Background Dot Pattern (with the grid on: snapping works without its dots) */}
            {snapConfig.enabled && showGrid && (
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
                      fill={isDarkTheme(mermaidTheme) ? '#475569' : '#94a3b8'}
                      opacity={isDarkTheme(mermaidTheme) ? '0.65' : '0.45'}
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
                fitScale={fitScale}
                onPanChange={setPan}
                onResetZoom={handleResetZoom}
                selectedStateId={effectiveSelectedStateId}
                selectedStateLabel={effectiveSelectedStateLabel}
                availableStatesCount={availableStates.length}
                canvasPositions={canvasNodePositions}
                bookmarkedStateIds={bookmarkedStates}
                changedStateIds={changedStates}
                multiSelection={multiSelection}
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
        {hoveredActions && !contextMenuState && !((isHeatmapActive || showComplexityBadges) && hoveredComplexityMetric) && (
          <NodeHoverBox
            anchor={() => stateScreenRect(hoveredActions.id) ?? hoveredActions.rect}
            id="state-actions-hover"
            className="z-50 pointer-events-none max-w-[720px] rounded-lg bg-slate-950/95 border border-slate-700 shadow-2xl px-2.5 py-1.5"
          >
            <div className="text-[10px] font-semibold text-slate-400 mb-0.5">{hoveredActions.id}</div>
            <StateActionsPreview text={hoveredActions.text} problems={stateProblems?.[hoveredActions.id]} />
          </NodeHoverBox>
        )}
        {(isHeatmapActive || showComplexityBadges) && hoveredComplexityMetric && (
          <NodeHoverBox
            anchor={() => stateScreenRect(hoveredComplexityMetric.metric.stateId) ?? { l: hoveredComplexityMetric.anchorX + 16, t: hoveredComplexityMetric.anchorY - 8, r: hoveredComplexityMetric.anchorX + 16, b: hoveredComplexityMetric.anchorY + 16 }}
            id="heatmap-state-hover-tooltip"
            className="pointer-events-none z-[60] w-max min-w-64 max-w-[min(94vw,760px)] p-3 bg-slate-950/95 border border-amber-500/50 rounded-xl shadow-2xl backdrop-blur-md text-xs"
          >
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
              <div className="font-bold text-slate-100 truncate flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">{hoveredComplexityMetric.metric.stateLabel.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')}</span>
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
              {hoveredActions && hoveredActions.id.toLowerCase() === hoveredComplexityMetric.metric.stateId.toLowerCase() && (
                <div id="state-actions-in-heatmap" className="mt-1 pt-1 border-t border-slate-700/70">
                  <StateActionsPreview text={hoveredActions.text} problems={stateProblems?.[hoveredActions.id]} />
                </div>
              )}
            </div>
          </NodeHoverBox>
        )}

        {/* Visual Badge for Edge Label Guard Condition Expression (not while a right-click menu is open: above it, it
            would take its clicks) */}
        {hoveredEdgeCondition && !activeConditionOverlay && !contextMenuState && (
          <div
            id="edge-guard-condition-hover-badge"
            ref={guardPopupRef}
            style={{
              position: 'fixed',
              // (measured first, hidden until placed, next to its label; no transition: it would fly in from where it
              // was measured. Its fade and zoom in are an animation)
              left: `${guardPopupPos?.key === guardPopupKey ? guardPopupPos.left : (hoveredEdgeCondition.labelRect?.left ?? hoveredEdgeCondition.anchorX)}px`,
              top: `${guardPopupPos?.key === guardPopupKey ? guardPopupPos.top : (hoveredEdgeCondition.labelRect?.bottom ?? hoveredEdgeCondition.anchorY)}px`,
              visibility: guardPopupPos?.key === guardPopupKey ? 'visible' : 'hidden',
              transition: 'none',
              zIndex: 60,
            }}
            data-pinned={guardPinned ? 'true' : undefined}
            onMouseEnter={keepGuardPopup}
            onMouseLeave={leaveGuardPopup}
            onClick={() => setGuardPinned(true)}
            className={`pointer-events-auto max-w-sm sm:max-w-md w-auto min-w-[280px] p-3 bg-slate-950/95 border ${guardPinned ? 'border-amber-400/70' : 'border-sky-500/60'} rounded-xl shadow-2xl shadow-sky-950/50 backdrop-blur-md text-xs animate-in fade-in zoom-in-95 duration-150 select-none`}
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
              <div className="flex items-center gap-1 shrink-0">
                {hoveredEdgeCondition.priority !== undefined && (
                  <span
                    className="shrink-0 font-mono text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-400/40 shadow-xs"
                    title={`Transition Evaluation Priority: ${hoveredEdgeCondition.priority}`}
                  >
                    Prio [{hoveredEdgeCondition.priority}]
                  </span>
                )}
                {onGoToEdgeCode && hoveredEdgeCondition.edge.from !== '[*]' && (
                  <button
                    id="guard-popup-goto-code"
                    type="button"
                    title={`Go to code: its condition in ${hoveredEdgeCondition.edge.from === 'AnyState' || /^\[preProcess\]/i.test(hoveredEdgeCondition.fullCondition) ? 'preProcess()' : 'doState()'}, in the Method Editor`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onGoToEdgeCode(hoveredEdgeCondition.edge);
                      setHoveredEdgeCondition(null);
                    }}
                    className="p-1 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  id="guard-popup-copy"
                  type="button"
                  title="Copy the guard condition"
                  onClick={(e) => {
                    e.stopPropagation();
                    setGuardPinned(true);
                    void copyTextToClipboard(hoveredEdgeCondition.fullCondition).then((ok) => {
                      setGuardCopied(ok !== false);
                      window.setTimeout(() => setGuardCopied(false), 1500);
                    });
                  }}
                  className="p-1 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800"
                >
                  {guardCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  id="guard-popup-pin"
                  type="button"
                  title={guardPinned ? 'Unpin (Esc): it closes' : 'Pin: it stays open (a click on it pins it too)'}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (guardPinned) setHoveredEdgeCondition(null);
                    else setGuardPinned(true);
                  }}
                  className={`p-1 rounded hover:bg-slate-800 ${guardPinned ? 'text-amber-400' : 'text-slate-400 hover:text-sky-300'}`}
                >
                  {guardPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* A composite's collapsed edge: the transitions of the code it stands for, each opened by a click */}
            {(() => {
              const members = edgeMembersOf?.(hoveredEdgeCondition.edge.from, hoveredEdgeCondition.edge.to) ?? [];
              if (members.length < 2) return null;
              return (
                <div id="guard-popup-members" className="pt-2 space-y-1">
                  <div className="text-[9px] text-slate-400 uppercase font-semibold tracking-wider">Stands for {members.length} transitions:</div>
                  <div className="space-y-0.5 max-h-40 overflow-y-auto pr-0.5 custom-scrollbar">
                    {members.map((m, i) => (
                      <button
                        key={`${m.from}->${m.to}#${i}`}
                        type="button"
                        data-member={`${m.from}->${m.to}`}
                        disabled={!onOpenTransitionCode}
                        title={onOpenTransitionCode ? `Open the code of ${m.from} → ${m.to}` : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenTransitionCode?.(m.from, m.to);
                          setHoveredEdgeCondition(null);
                        }}
                        className="w-full flex items-center justify-between gap-2 text-left text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900/60 border border-slate-800 text-slate-300 hover:border-sky-500/60 hover:text-sky-200 disabled:hover:border-slate-800 disabled:hover:text-slate-300"
                      >
                        <span className="truncate">
                          {m.from} <ArrowRight className="inline w-2.5 h-2.5 text-sky-400" /> {m.to}
                        </span>
                        {m.priority != null && m.priority > 0 && <span className="shrink-0 text-sky-300 font-bold">[{m.priority}]</span>}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

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
                <span className="text-slate-400">💡 Click the label: Guard Inspector · click here: pin (Esc closes)</span>
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
                changedStateIds={changedStates}
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
            onEditCondition={
              onEditTransitionCondition
                ? () => {
                    const edge = activeConditionOverlay.edge;
                    setActiveConditionOverlay(null);
                    onEditTransitionCondition(edge);
                  }
                : undefined
            }
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
            extraItems={(() => {
              const target = contextMenuState.target;
              const items = contextMenuItems?.(target) ?? [];
              if (target.type !== 'edge' || !target.from || !target.to || target.from === target.to) return items;
              return [
                ...items,
                {
                  id: 'relayout-edge',
                  label: 'Re-layout edge',
                  icon: <Spline className="w-3.5 h-3.5" />,
                  title: 'This transition laid out again on its own: straight, or with as few turns as it can, clear of the other states. The states, the other transitions and their labels stay where they are',
                  onSelect: () => {
                    const err = relayoutEdgeRef.current({ id: target.id, pathId: target.pathId, from: target.from, to: target.to });
                    onToastProp?.(err ? `Re-layout edge: ${err}` : `${target.from} → ${target.to} laid out again`, err ? 'error' : 'success');
                  },
                },
              ];
            })()}
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
          currentNote={activeNoteTarget && (activeNoteTarget.type === 'node' || activeNoteTarget.type === 'edge') ? activeNoteTarget.note : ''}
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
