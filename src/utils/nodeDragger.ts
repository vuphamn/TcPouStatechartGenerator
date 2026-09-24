/**
 * Utilities for interactive SVG node dragging, connected edge deformation,
 * distortion-free edge rerouting, and manual edge selection/curve adjustments in Mermaid diagrams.
 */

import { EdgeInfo } from '../types.ts';

export interface Point {
  x: number;
  y: number;
}

export interface NodeOffset {
  x: number;
  y: number;
}

export interface EdgeOffset {
  x: number;
  y: number;
  startDx?: number;
  startDy?: number;
  endDx?: number;
  endDy?: number;
}

export type NodeOffsetsMap = Record<string, NodeOffset>;
export type EdgeOffsetsMap = Record<string, EdgeOffset>;

export interface PathCommand {
  type: string;
  args: number[];
}

export interface NodeGeometry {
  id: string;
  origCenterX: number;
  origCenterY: number;
  width: number;
  height: number;
  halfWidth: number;
  halfHeight: number;
}

export interface BoundaryIntersection {
  x: number;
  y: number;
  normalX: number;
  normalY: number;
}

/**
 * Parse an SVG path `d` string into commands and argument numbers.
 */
export function parseSvgPathCommands(d: string): PathCommand[] {
  if (!d) return [];
  const commands: PathCommand[] = [];
  const cmdRegex = /([a-df-z])([^a-df-z]*)/gi;
  let match: RegExpExecArray | null;
  let curX = 0;
  let curY = 0;

  while ((match = cmdRegex.exec(d)) !== null) {
    const type = match[1];
    const rawArgs = match[2].trim();
    const args = rawArgs
      ? (rawArgs.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number) || [])
      : [];

    const upper = type.toUpperCase();
    if (upper === 'H') {
      if (args.length >= 1) {
        const targetX = type === 'h' ? curX + args[0] : args[0];
        commands.push({ type: 'L', args: [targetX, curY] });
        curX = targetX;
      }
    } else if (upper === 'V') {
      if (args.length >= 1) {
        const targetY = type === 'v' ? curY + args[0] : args[0];
        commands.push({ type: 'L', args: [curX, targetY] });
        curY = targetY;
      }
    } else {
      commands.push({ type, args });
      if (args.length >= 2) {
        curX = args[args.length - 2];
        curY = args[args.length - 1];
      }
    }
  }
  return commands;
}

/**
 * Extract coordinate points (x, y pairs) from path commands.
 */
export function extractCoordinatePoints(commands: PathCommand[]): Point[] {
  const points: Point[] = [];
  for (const cmd of commands) {
    const type = cmd.type.toUpperCase();
    if (type === 'M' || type === 'L' || type === 'T' || type === 'C' || type === 'S' || type === 'Q') {
      for (let i = 0; i < cmd.args.length - 1; i += 2) {
        points.push({ x: cmd.args[i], y: cmd.args[i + 1] });
      }
    } else if (type === 'A') {
      if (cmd.args.length >= 7) {
        points.push({ x: cmd.args[5], y: cmd.args[6] });
      }
    }
  }
  return points;
}

/**
 * Parses translation from transform string, e.g. "translate(120, 340)" or "matrix(1, 0, 0, 1, 120, 340)".
 */
export function parseTranslation(transformStr: string): { x: number; y: number } {
  if (!transformStr) return { x: 0, y: 0 };
  const tm = transformStr.match(
    /translate\(\s*(-?[\d.]+(?:e[+-]?\d+)?)[,\s]+(-?[\d.]+(?:e[+-]?\d+)?)\s*\)/i
  );
  if (tm) {
    return { x: parseFloat(tm[1]), y: parseFloat(tm[2]) };
  }
  const singleTm = transformStr.match(/translate\(\s*(-?[\d.]+(?:e[+-]?\d+)?)\s*\)/i);
  if (singleTm) {
    return { x: parseFloat(singleTm[1]), y: 0 };
  }
  const mm = transformStr.match(
    /matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*(-?[\d.]+(?:e[+-]?\d+)?)[,\s]+(-?[\d.]+(?:e[+-]?\d+)?)\s*\)/i
  );
  if (mm) {
    return { x: parseFloat(mm[1]), y: parseFloat(mm[2]) };
  }
  return { x: 0, y: 0 };
}

/**
 * Compute the intersection of a ray from a box center towards a target point with the box's outer perimeter.
 */
export function computeBoxBoundaryIntersection(
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  tx: number,
  ty: number,
  padding = 2
): BoundaryIntersection {
  const dx = tx - cx;
  const dy = ty - cy;

  if (Math.abs(dx) < 1e-5 && Math.abs(dy) < 1e-5) {
    return { x: cx, y: cy - hh - padding, normalX: 0, normalY: -1 };
  }

  const effectiveHw = Math.max(12, hw + padding);
  const effectiveHh = Math.max(10, hh + padding);

  const scaleX = Math.abs(dx) > 1e-5 ? effectiveHw / Math.abs(dx) : Infinity;
  const scaleY = Math.abs(dy) > 1e-5 ? effectiveHh / Math.abs(dy) : Infinity;

  if (scaleX < scaleY) {
    // Exits left or right face
    const nx = dx > 0 ? 1 : -1;
    return {
      x: cx + nx * effectiveHw,
      y: cy + dy * scaleX,
      normalX: nx,
      normalY: 0,
    };
  } else {
    // Exits top or bottom face
    const ny = dy > 0 ? 1 : -1;
    return {
      x: cx + dx * scaleY,
      y: cy + ny * effectiveHh,
      normalX: 0,
      normalY: ny,
    };
  }
}

/**
 * Extract node bounding geometry (center and half-dimensions in diagram coordinate space).
 * Accumulates parent group transforms to match edgePaths coordinate space.
 */
export function getNodeGeometry(node: SVGGElement, svgRoot?: SVGSVGElement | null): NodeGeometry {
  const stateId = node.getAttribute('data-state-id') || '';

  // 1. Preferred method: Exact SVG coordinate mapping from node space to edgePaths space
  const edgePaths = svgRoot?.querySelector('g.edgePaths');
  if (svgRoot && edgePaths) {
    try {
      const nodeEl = node as SVGGraphicsElement;
      const edgeEl = edgePaths as SVGGraphicsElement;
      if (typeof nodeEl.getScreenCTM === 'function' && typeof edgeEl.getScreenCTM === 'function') {
        const nodeCTM = nodeEl.getScreenCTM();
        const edgeCTM = edgeEl.getScreenCTM();
        const bbox = typeof nodeEl.getBBox === 'function' ? nodeEl.getBBox() : null;
        if (nodeCTM && edgeCTM && bbox && bbox.width > 0 && bbox.height > 0) {
          const nodeToEdge = edgeCTM.inverse().multiply(nodeCTM);
          const centerPt = svgRoot.createSVGPoint();
          centerPt.x = bbox.x + bbox.width / 2;
          centerPt.y = bbox.y + bbox.height / 2;
          const mapped = centerPt.matrixTransform(nodeToEdge);
          const scaleX = Math.hypot(nodeToEdge.a, nodeToEdge.b) || 1;
          const scaleY = Math.hypot(nodeToEdge.c, nodeToEdge.d) || 1;
          const w = bbox.width * scaleX;
          const h = bbox.height * scaleY;
          if (!isNaN(mapped.x) && !isNaN(mapped.y) && isFinite(mapped.x) && isFinite(mapped.y)) {
            return {
              id: stateId,
              origCenterX: mapped.x,
              origCenterY: mapped.y,
              width: w,
              height: h,
              halfWidth: Math.max(14, w / 2),
              halfHeight: Math.max(12, h / 2),
            };
          }
        }
      }
    } catch {
      // Fall through to parent transform accumulation
    }
  }

  // 2. Accumulate transforms from node up to the common parent or svgRoot
  let totalTx = 0;
  let totalTy = 0;
  let curr: Element | null = node;
  const stopAt = svgRoot?.querySelector('g.edgePaths')?.parentElement || svgRoot || null;

  while (curr && curr !== stopAt && curr.tagName !== 'svg') {
    const tf = (curr === node ? curr.getAttribute('data-orig-transform') : null) || curr.getAttribute('transform') || '';
    if (tf) {
      const { x, y } = parseTranslation(tf);
      totalTx += x;
      totalTy += y;
    }
    curr = curr.parentElement;
  }

  let w = 120;
  let h = 50;
  let localCx = 0;
  let localCy = 0;

  try {
    const bbox = node.getBBox();
    if (bbox && bbox.width > 0 && bbox.height > 0) {
      w = bbox.width;
      h = bbox.height;
      localCx = bbox.x + bbox.width / 2;
      localCy = bbox.y + bbox.height / 2;
    }
  } catch {
    const rect = node.querySelector('rect');
    if (rect) {
      const rw = parseFloat(rect.getAttribute('width') || '120');
      const rh = parseFloat(rect.getAttribute('height') || '50');
      const rx = parseFloat(rect.getAttribute('x') || '0');
      const ry = parseFloat(rect.getAttribute('y') || '0');
      w = rw;
      h = rh;
      localCx = rx + rw / 2;
      localCy = ry + rh / 2;
    } else {
      const circle = node.querySelector('circle');
      if (circle) {
        const r = parseFloat(circle.getAttribute('r') || '12');
        w = 2 * r;
        h = 2 * r;
        localCx = 0;
        localCy = 0;
      }
    }
  }

  const origCenterX = totalTx + localCx;
  const origCenterY = totalTy + localCy;
  const halfWidth = Math.max(14, w / 2);
  const halfHeight = Math.max(12, h / 2);

  return {
    id: stateId,
    origCenterX,
    origCenterY,
    width: w,
    height: h,
    halfWidth,
    halfHeight,
  };
}

/**
 * Translates all coordinates in an SVG path by (dx, dy).
 */
export function translateSvgPath(d: string, dx: number, dy: number): string {
  if (!d || (dx === 0 && dy === 0)) return d;
  const commands = parseSvgPathCommands(d);
  let result = '';

  for (const cmd of commands) {
    const type = cmd.type;
    const upper = type.toUpperCase();
    const newArgs = [...cmd.args];

    if (upper === 'M' || upper === 'L' || upper === 'T' || upper === 'C' || upper === 'S' || upper === 'Q') {
      for (let i = 0; i < newArgs.length - 1; i += 2) {
        newArgs[i] = Math.round((newArgs[i] + dx) * 10) / 10;
        newArgs[i + 1] = Math.round((newArgs[i + 1] + dy) * 10) / 10;
      }
    } else if (upper === 'A') {
      if (newArgs.length >= 7) {
        newArgs[5] = Math.round((newArgs[5] + dx) * 10) / 10;
        newArgs[6] = Math.round((newArgs[6] + dy) * 10) / 10;
      }
    }

    if (newArgs.length === 0) {
      result += type;
    } else {
      result += `${type}${newArgs.join(',')}`;
    }
  }

  return result;
}

/**
 * Cleans raw Mermaid node IDs (removing diagram-id prefixes, 'flowchart-', 'state-', and trailing instance numbers like '-0').
 * Preserves user hyphens like 'step-1' or 'node-2'.
 */
export function cleanNodeId(raw: string): string {
  if (!raw) return '';
  let id = raw.trim();
  const hadPrefix = /^(?:[A-Za-z0-9_.-]+?-)?(?:state|flowchart)-/.test(id);
  // Strip any diagram ID prefix before 'state-' or 'flowchart-'
  id = id.replace(/^[A-Za-z0-9_.-]+?-(?:state|flowchart)-/, '');
  id = id.replace(/^(?:state|flowchart)-/, '');
  // Strip trailing instance numbers like -0, -1, _0, _1 only if it had a Mermaid generated prefix
  if (hadPrefix) {
    id = id.replace(/[-_]\d+$/, '');
  }
  return id.trim();
}

/**
 * Robustly finds an SVG node element in the diagram by stateId.
 */
export function findNodeElement(svg: SVGSVGElement, stateId: string): SVGGElement | null {
  if (!svg || !stateId) return null;
  const cleanId = cleanNodeId(stateId);
  const isStartEnd = cleanId === '[*]' || cleanId === 'root_start' || cleanId === 'root_end' || cleanId === 'startNode';

  try {
    const escapedStateId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(stateId) : stateId.replace(/["\\]/g, '\\$&');
    const escapedCleanId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(cleanId) : cleanId.replace(/["\\]/g, '\\$&');

    const direct = (
      svg.querySelector(`g.node[data-state-id="${escapedStateId}"], g[data-state-id="${escapedStateId}"]`) ||
      svg.querySelector(`g.node[data-state-id="${escapedCleanId}"], g[data-state-id="${escapedCleanId}"]`) ||
      svg.querySelector(`g.node[id="${escapedStateId}"], g[id="${escapedStateId}"]`) ||
      svg.querySelector(`g.node[id="${escapedCleanId}"], g[id="${escapedCleanId}"]`) ||
      svg.querySelector(`g.node[id*="flowchart-${escapedCleanId}-"], g[id*="flowchart-${escapedCleanId}-"]`) ||
      svg.querySelector(`g.node[id*="state-${escapedCleanId}-"], g[id*="state-${escapedCleanId}-"]`) ||
      (isStartEnd
        ? (svg.querySelector('g.node[id*="root_start"], g.node[id*="root_end"], g.node[id*="startNode"], g.node.startNode') as SVGGElement | null)
        : null)
    ) as SVGGElement | null;
    if (direct) return direct;
  } catch {
    // If querySelector throws on complex selector, continue to comprehensive node scan below
  }

  const lowerStateId = stateId.toLowerCase().trim();
  const lowerCleanId = cleanId.toLowerCase().trim();
  const strippedSuffix = lowerStateId.includes('.') ? lowerStateId.split('.').pop()! : lowerStateId;

  // Fallback: scan all candidate nodes (g.node, g.statediagram-state, g[data-state-id], g.cluster)
  const allNodes = Array.from(
    svg.querySelectorAll('g.node, g.statediagram-state, g[data-state-id], g.cluster')
  ) as SVGGElement[];

  for (const n of allNodes) {
    const nStateId = (n.getAttribute('data-state-id') || '').trim();
    const lowerNStateId = nStateId.toLowerCase();
    if (
      nStateId === stateId ||
      nStateId === cleanId ||
      cleanNodeId(nStateId) === cleanId ||
      lowerNStateId === lowerStateId ||
      lowerNStateId === lowerCleanId ||
      lowerNStateId === strippedSuffix ||
      cleanNodeId(lowerNStateId) === lowerCleanId
    ) {
      return n;
    }

    const nId = (n.getAttribute('id') || '').trim();
    const lowerNId = nId.toLowerCase();
    const cleanNId = cleanNodeId(nId);
    const lowerCleanNId = cleanNId.toLowerCase();
    if (
      nId === stateId ||
      cleanNId === cleanId ||
      cleanNId === stateId ||
      lowerNId === lowerStateId ||
      lowerCleanNId === lowerCleanId ||
      lowerCleanNId === strippedSuffix ||
      lowerNId.includes(lowerCleanId)
    ) {
      return n;
    }

    const nLabel = (n.getAttribute('data-state-label') || '').trim();
    const lowerNLabel = nLabel.toLowerCase();
    if (
      nLabel &&
      (nLabel === stateId ||
        nLabel === cleanId ||
        lowerNLabel === lowerStateId ||
        lowerNLabel === lowerCleanId ||
        lowerNLabel === strippedSuffix)
    ) {
      return n;
    }

    const text = (n.textContent || '').trim().toLowerCase();
    if (
      text &&
      (text === lowerStateId ||
        text === lowerCleanId ||
        text === strippedSuffix ||
        text.startsWith(lowerStateId + ' ') ||
        text.startsWith(lowerCleanId + ' ') ||
        text.startsWith(strippedSuffix + ' ') ||
        text.includes(lowerCleanId))
    ) {
      return n;
    }
  }
  return null;
}

/**
 * Robustly finds an SVG edge path element in the diagram by edgeId, canonical keys, or source/target.
 */
export function findEdgePathElement(
  svg: SVGElement,
  edgeId: string,
  availableEdges: EdgeInfo[] = []
): SVGPathElement | null {
  if (!svg || !edgeId) return null;

  const cleanId = cleanNodeId(edgeId);

  // 1. Identify source and target states from availableEdges or the edgeId string
  const edge = availableEdges.find(
    (e) => e.id === edgeId || `${e.from}->${e.to}` === edgeId || cleanNodeId(e.id) === cleanId
  );

  let from = edge?.from || '';
  let to = edge?.to || '';

  if (!from || !to) {
    if (edgeId.includes('->')) {
      const parts = edgeId.split('->');
      from = parts[0].trim().replace(/#\d+$/, '');
      to = parts[1].trim().replace(/#\d+$/, '');
    } else {
      const lMatch = edgeId.match(/\bL-([A-Za-z0-9_.-]+)-([A-Za-z0-9_.-]+)(?:-\d+)?\b/);
      if (lMatch) {
        from = lMatch[1];
        to = lMatch[2];
      }
    }
  }

  const cFrom = from ? cleanNodeId(from) : '';
  const cTo = to ? cleanNodeId(to) : '';

  // 2. Direct selector searches on path and parent g
  const selectors: string[] = [
    `path[data-edge-id="${edgeId}"]`,
    `path[data-edge-key="${edgeId}"]`,
    `path[data-path-id="${edgeId}"]`,
    `path#${edgeId}`,
    `path[data-edge-id="${cleanId}"]`,
    `g.edgePath#${edgeId} path`,
    `g.edgePath[id="${edgeId}"] path`,
    `g#${edgeId} path`,
    `g.edgePath[id="${cleanId}"] path`,
  ];

  if (from && to) {
    selectors.push(
      `path[data-edge-key="${from}->${to}"]`,
      `path[data-edge-key="${cFrom}->${cTo}"]`,
      `path[data-source-id="${from}"][data-target-id="${to}"]`,
      `path[data-source-id="${cFrom}"][data-target-id="${cTo}"]`,
      `path[id*="L_${from}_${to}"]`,
      `path[id*="L_${cFrom}_${cTo}"]`,
      `path[id*="L-${from}-${to}"]`,
      `path[id*="L-${cFrom}-${cTo}"]`,
      `path[id*="${from}"][id*="${to}"]`,
      `path[id*="${cFrom}"][id*="${cTo}"]`,
      `g.edgePath.LS-${from}.LE-${to} path`,
      `g.edgePath.LS-${cFrom}.LE-${cTo} path`,
      `g.edgePath[class*="LS-${from}"][class*="LE-${to}"] path`,
      `g.edgePath[class*="LS-${cFrom}"][class*="LE-${cTo}"] path`,
      `g.edgePath[id^="L-${from}-${to}"] path`,
      `g.edgePath[id^="L-${cFrom}-${cTo}"] path`,
      `g.edgePath[id*="${from}"][id*="${to}"] path`,
      `g.edgePath[id*="${cFrom}"][id*="${cTo}"] path`
    );
    if (from === '[*]' || cFrom === '[*]') {
      selectors.push(
        `g.edgePath[class*="LS-root_start"] path`,
        `g.edgePath[class*="LS-startNode"] path`,
        `g.edgePath[id*="root_start"] path`
      );
    }
    if (to === '[*]' || cTo === '[*]') {
      selectors.push(
        `g.edgePath[class*="LE-root_end"] path`,
        `g.edgePath[class*="LE-root_start"] path`,
        `g.edgePath[id*="root_end"] path`
      );
    }
  }

  for (const sel of selectors) {
    try {
      const el = svg.querySelector(sel);
      if (el && el.tagName.toLowerCase() === 'path' && !el.closest('defs, marker')) {
        return el as SVGPathElement;
      }
    } catch {
      // ignore selector syntax errors
    }
  }

  // 3. Fallback: inspect all edge paths in svg (filtering out defs/marker arrowheads)
  const allEdgePaths = (Array.from(
    svg.querySelectorAll('g.edgePaths path.path, g.edgePath path.path, path.tc-edge-path, g.edgePaths path, g.edgePath path')
  ) as SVGPathElement[]).filter((p) => !p.closest('defs, marker'));

  for (const p of allEdgePaths) {
    const pEdgeId = p.getAttribute('data-edge-id');
    const pEdgeKey = p.getAttribute('data-edge-key');
    const pId = p.getAttribute('id');
    const gParent = p.closest('g.edgePath') || p.parentElement;
    const gId = gParent?.getAttribute('id') || '';
    const gClass = `${gParent?.getAttribute('class') || ''} ${p.getAttribute('class') || ''}`;

    if (
      pEdgeId === edgeId ||
      pEdgeKey === edgeId ||
      pId === edgeId ||
      gId === edgeId ||
      pEdgeId === cleanId ||
      gId === cleanId
    ) {
      return p;
    }

    if (from && to) {
      const pIdStr = pId || '';
      const hasFrom =
        gClass.includes(`LS-${from}`) ||
        gClass.includes(`LS-${cFrom}`) ||
        gId.includes(from) ||
        gId.includes(cFrom) ||
        pIdStr.includes(`L_${from}_`) ||
        pIdStr.includes(`L_${cFrom}_`) ||
        pIdStr.includes(`L-${from}-`) ||
        pIdStr.includes(`L-${cFrom}-`) ||
        (from === '[*]' && (gClass.includes('root_start') || gId.includes('root_start') || pIdStr.includes('root_start')));
      const hasTo =
        gClass.includes(`LE-${to}`) ||
        gClass.includes(`LE-${cTo}`) ||
        gId.includes(to) ||
        gId.includes(cTo) ||
        pIdStr.includes(`_${to}`) ||
        pIdStr.includes(`_${cTo}`) ||
        pIdStr.includes(`-${to}`) ||
        pIdStr.includes(`-${cTo}`) ||
        (to === '[*]' && (gClass.includes('root_end') || gId.includes('root_end') || pIdStr.includes('root_end')));

      if (hasFrom && hasTo) {
        return p;
      }
    }
  }

  // 4. Index-based matching if edge order matches
  if (edge) {
    const edgeIndex = availableEdges.indexOf(edge);
    if (edgeIndex >= 0 && edgeIndex < allEdgePaths.length) {
      return allEdgePaths[edgeIndex];
    }
  }

  return null;
}

/**
 * Calculates the exact anchor coordinate along an edge path.
 * If containerEl and zoom are provided, returns coordinates relative to containerEl.
 * Otherwise returns coordinates in SVG coordinate space.
 */
export function getEdgeAnchorPoint(
  svg: SVGElement,
  pathEl: SVGPathElement,
  containerEl?: HTMLElement | null,
  zoom = 1
): { x: number; y: number } {
  if (containerEl) {
    const cRect = containerEl.getBoundingClientRect();
    const pRect = pathEl.getBoundingClientRect();
    if (cRect.width > 0 && pRect.width > 0) {
      const actualScale =
        containerEl.offsetWidth > 0 && cRect.width > 0
          ? cRect.width / containerEl.offsetWidth
          : zoom > 0
          ? zoom
          : 1;

      try {
        const pathLen = pathEl.getTotalLength();
        if (pathLen > 0) {
          const midPt = pathEl.getPointAtLength(pathLen / 2);
          const ctm = pathEl.getScreenCTM();
          if (ctm) {
            const screenX = midPt.x * ctm.a + midPt.y * ctm.c + ctm.e;
            const screenY = midPt.x * ctm.b + midPt.y * ctm.d + ctm.f;
            return {
              x: Math.round((screenX - cRect.left) / actualScale),
              y: Math.round((screenY - cRect.top) / actualScale),
            };
          }
        }
      } catch {
        // fallback
      }
      return {
        x: Math.round((pRect.left + pRect.width / 2 - cRect.left) / actualScale),
        y: Math.round((pRect.top + pRect.height / 2 - cRect.top) / actualScale),
      };
    }
  }

  // SVG coordinate space
  try {
    const pathLen = pathEl.getTotalLength();
    if (pathLen > 0) {
      const midPt = pathEl.getPointAtLength(pathLen / 2);
      return { x: Math.round(midPt.x), y: Math.round(midPt.y) };
    }
  } catch {
    // fallback
  }

  const bbox = (pathEl as any).getBBox?.() || { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: Math.round(bbox.x + bbox.width / 2),
    y: Math.round(bbox.y + bbox.height / 2),
  };
}

/**
 * Initializes SVG metadata for draggable state nodes, interactive edge paths, and edge hitboxes.
 * Should be called once whenever a new SVG is rendered.
 */
export function initializeSvgDragMetadata(
  svg: SVGSVGElement,
  availableEdges: EdgeInfo[] = []
): void {
  svg.setAttribute('data-drag-initialized', 'true');
  // 1. Gather all state nodes with initial transforms and geometry
  const nodes = Array.from(svg.querySelectorAll('g.node')) as SVGGElement[];
  const nodeCenters: { id: string; x: number; y: number; hw: number; hh: number }[] = [];

  for (const node of nodes) {
    const rawStateId = node.getAttribute('data-state-id') || node.getAttribute('id') || '';
    let stateId = cleanNodeId(rawStateId);
    if (!stateId && (rawStateId.includes('root_start') || rawStateId.includes('startNode'))) {
      stateId = '[*]';
    }
    if (!stateId) continue;
    node.setAttribute('data-state-id', stateId);

    if (!node.getAttribute('data-orig-transform')) {
      const origTf = node.getAttribute('transform') || '';
      node.setAttribute('data-orig-transform', origTf);
      const { x, y } = parseTranslation(origTf);
      node.setAttribute('data-orig-x', String(x));
      node.setAttribute('data-orig-y', String(y));
    }

    const geom = getNodeGeometry(node, svg);
    node.setAttribute('data-orig-cx', geom.origCenterX.toFixed(1));
    node.setAttribute('data-orig-cy', geom.origCenterY.toFixed(1));
    node.setAttribute('data-hw', geom.halfWidth.toFixed(1));
    node.setAttribute('data-hh', geom.halfHeight.toFixed(1));

    nodeCenters.push({
      id: stateId,
      x: geom.origCenterX,
      y: geom.origCenterY,
      hw: geom.halfWidth,
      hh: geom.halfHeight,
    });
  }

  // 2. Map all edge paths to their source and target nodes, and setup interactive hitboxes
  const allPaths = (Array.from(svg.querySelectorAll('g.edgePaths path')).filter(
    (p) => !p.closest('defs') && !p.closest('marker') && p.getAttribute('d') && !p.classList.contains('tc-edge-hitbox')
  ) as SVGPathElement[]);

  for (let idx = 0; idx < allPaths.length; idx++) {
    const path = allPaths[idx];
    const rawPathId = path.getAttribute('id') || path.getAttribute('data-id') || `path-${idx}`;
    const uniquePathId = rawPathId.startsWith('path-') ? `${rawPathId}_${idx}` : rawPathId;

    if (!path.getAttribute('data-orig-d')) {
      const d = path.getAttribute('d') || '';
      path.setAttribute('data-orig-d', d);
    }

    const origD = path.getAttribute('data-orig-d') || '';
    const points = extractCoordinatePoints(parseSvgPathCommands(origD));

    // Try finding source and target from classes, id, geometric proximity, or availableEdges
    const parent = path.parentElement;
    const classStr = `${path.getAttribute('class') || ''} ${parent?.getAttribute('class') || ''}`;
    const idStr = `${path.getAttribute('id') || ''} ${parent?.getAttribute('id') || ''}`;

    let sourceId: string | null = null;
    let targetId: string | null = null;

    // 1. Mermaid stateDiagram ID check: id="<diagramId>-edge<N>"
    const edgeIndexMatch = rawPathId.match(/-edge(\d+)$/) || path.getAttribute('id')?.match(/-edge(\d+)$/);
    if (edgeIndexMatch) {
      const edgeIdx = parseInt(edgeIndexMatch[1], 10);
      if (edgeIdx >= 0 && edgeIdx < availableEdges.length) {
        sourceId = availableEdges[edgeIdx].from;
        targetId = availableEdges[edgeIdx].to;
        path.setAttribute('data-edge-index', String(edgeIdx));
      }
    }

    // 2. Class check: LS-<source> LE-<target>
    if (!sourceId || !targetId) {
      const lsMatch = classStr.match(/\bLS-([A-Za-z0-9_.-]+)\b/);
      if (lsMatch) {
        const raw = lsMatch[1];
        sourceId = raw.includes('root_start') || raw.includes('startNode') ? '[*]' : cleanNodeId(raw);
      }
      const leMatch = classStr.match(/\bLE-([A-Za-z0-9_.-]+)\b/);
      if (leMatch) {
        const raw = leMatch[1];
        targetId = raw.includes('root_end') || raw.includes('startNode') || raw.includes('root_start') ? '[*]' : cleanNodeId(raw);
      }
    }

    // 3. Match against availableEdges by link name in id/classes
    if (!sourceId || !targetId) {
      for (let eIdx = 0; eIdx < availableEdges.length; eIdx++) {
        const e = availableEdges[eIdx];
        const cf = cleanNodeId(e.from);
        const ct = cleanNodeId(e.to);
        if (
          (cf && ct && (idStr.includes(`L_${cf}_${ct}`) || idStr.includes(`L-${cf}-${ct}`))) ||
          (classStr.includes(`LS-${cf}`) && classStr.includes(`LE-${ct}`)) ||
          (classStr.includes(`LS-state-${cf}`) && classStr.includes(`LE-state-${ct}`))
        ) {
          sourceId = e.from;
          targetId = e.to;
          path.setAttribute('data-edge-index', String(eIdx));
          break;
        }
      }
    }

    // 4. Sequential fallback if index matches
    if (!sourceId || !targetId) {
      if (idx < availableEdges.length) {
        sourceId = availableEdges[idx].from;
        targetId = availableEdges[idx].to;
        path.setAttribute('data-edge-index', String(idx));
      }
    }

    sourceId = sourceId ? cleanNodeId(sourceId) : '';
    targetId = targetId ? cleanNodeId(targetId) : '';

    if (sourceId) path.setAttribute('data-source-id', sourceId);
    if (targetId) path.setAttribute('data-target-id', targetId);

    const edgeKey = sourceId && targetId ? `${sourceId}->${targetId}` : uniquePathId;
    path.setAttribute('data-edge-id', uniquePathId);
    path.setAttribute('data-path-id', uniquePathId);
    path.setAttribute('data-edge-key', edgeKey);
    path.setAttribute('data-path-index', String(idx));
    path.classList.add('tc-edge-path');

    // Compute baseline curvature/offset of the original path to preserve natural curve
    if (points.length >= 2) {
      const p0 = points[0];
      const pEnd = points[points.length - 1];
      const midPoint = points[Math.floor(points.length / 2)];
      const lineDx = pEnd.x - p0.x;
      const lineDy = pEnd.y - p0.y;
      const lineLen = Math.hypot(lineDx, lineDy);
      if (lineLen > 10) {
        const lineMidX = (p0.x + pEnd.x) / 2;
        const lineMidY = (p0.y + pEnd.y) / 2;
        const normX = -lineDy / lineLen;
        const normY = lineDx / lineLen;
        const curvature = (midPoint.x - lineMidX) * normX + (midPoint.y - lineMidY) * normY;
        path.setAttribute('data-base-curvature', curvature.toFixed(1));
      }
    }

    // Add transparent wider hitbox alongside path
    if (parent) {
      let hitbox = parent.querySelector(`.tc-edge-hitbox[data-path-id="${uniquePathId}"]`) as SVGPathElement | null;
      if (!hitbox) {
        hitbox = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitbox.setAttribute('class', 'tc-edge-hitbox');
        hitbox.setAttribute('data-edge-id', uniquePathId);
        hitbox.setAttribute('data-path-id', uniquePathId);
        hitbox.setAttribute('data-edge-key', edgeKey);
        hitbox.setAttribute('data-path-index', String(idx));
        if (sourceId) hitbox.setAttribute('data-source-id', sourceId);
        if (targetId) hitbox.setAttribute('data-target-id', targetId);
        hitbox.setAttribute('d', path.getAttribute('d') || '');
        hitbox.setAttribute('fill', 'none');
        hitbox.setAttribute('stroke', 'rgba(0, 0, 0, 0.001)');
        hitbox.setAttribute('stroke-width', '28');
        hitbox.setAttribute('stroke-linecap', 'round');
        hitbox.setAttribute('stroke-linejoin', 'round');
        hitbox.setAttribute('pointer-events', 'stroke');
        hitbox.setAttribute('cursor', 'pointer');
        // Insert AFTER path so it sits on top in SVG painter's order
        if (path.nextSibling) {
          parent.insertBefore(hitbox, path.nextSibling);
        } else {
          parent.appendChild(hitbox);
        }
      } else {
        hitbox.setAttribute('d', path.getAttribute('d') || '');
        hitbox.setAttribute('data-edge-id', uniquePathId);
        hitbox.setAttribute('data-path-id', uniquePathId);
        hitbox.setAttribute('data-edge-key', edgeKey);
        hitbox.setAttribute('data-path-index', String(idx));
        if (sourceId) hitbox.setAttribute('data-source-id', sourceId);
        if (targetId) hitbox.setAttribute('data-target-id', targetId);
      }
    }
    path.setAttribute('pointer-events', 'stroke');
    path.setAttribute('cursor', 'pointer');
  }

  // 3. Link edge labels to edge paths
  const edgeLabels = Array.from(svg.querySelectorAll('g.edgeLabel')) as SVGGElement[];
  edgeLabels.forEach((labelEl, idx) => {
    if (!labelEl.getAttribute('data-orig-transform')) {
      const origTf = labelEl.getAttribute('transform') || '';
      labelEl.setAttribute('data-orig-transform', origTf);
      const { x, y } = parseTranslation(origTf);
      labelEl.setAttribute('data-orig-x', String(x));
      labelEl.setAttribute('data-orig-y', String(y));
    }

    // Match label to path
    let matchedPath: SVGPathElement | null = null;
    const labelDataId =
      labelEl.getAttribute('data-id') ||
      labelEl.querySelector('[data-id]')?.getAttribute('data-id');

    if (labelDataId) {
      matchedPath = allPaths.find((p) => p.getAttribute('data-id') === labelDataId) || null;
    }
    if (!matchedPath && idx < allPaths.length) {
      matchedPath = allPaths[idx];
    }

    if (matchedPath) {
      const pId = matchedPath.getAttribute('data-path-id') || String(idx);
      labelEl.setAttribute('data-linked-path-id', pId);
    }
  });

  // 4. Link priority badges
  const badges = Array.from(svg.querySelectorAll('.tc-priority-badge')) as SVGGElement[];
  for (const badge of badges) {
    if (!badge.getAttribute('data-orig-transform')) {
      const origTf = badge.getAttribute('transform') || '';
      badge.setAttribute('data-orig-transform', origTf);
      const { x, y } = parseTranslation(origTf);
      badge.setAttribute('data-orig-x', String(x));
      badge.setAttribute('data-orig-y', String(y));
    }
  }
}

/**
 * Resolve node offset flexibly by ID, element data-state-id, raw ID, or clean ID.
 */
export function resolveNodeOffset(
  id: string | null,
  nodeEl: SVGGElement | null,
  nodeOffsets: NodeOffsetsMap
): NodeOffset {
  if (!id && !nodeEl) return { x: 0, y: 0 };
  if (id && nodeOffsets[id]) return nodeOffsets[id];
  if (nodeEl) {
    const stateId = nodeEl.getAttribute('data-state-id');
    if (stateId && nodeOffsets[stateId]) return nodeOffsets[stateId];
    const rawId = nodeEl.getAttribute('id');
    if (rawId && nodeOffsets[rawId]) return nodeOffsets[rawId];
    const cleanRaw = cleanNodeId(rawId || '');
    if (cleanRaw && nodeOffsets[cleanRaw]) return nodeOffsets[cleanRaw];
  }
  const clean = cleanNodeId(id || '');
  if (clean && nodeOffsets[clean]) return nodeOffsets[clean];
  for (const [k, v] of Object.entries(nodeOffsets)) {
    if (cleanNodeId(k) === clean || cleanNodeId(k) === id || k === clean) {
      return v;
    }
  }
  return { x: 0, y: 0 };
}

/**
 * Deforms an existing SVG path string based on source node movement, target node movement,
 * and edge waypoint or endpoint offsets.
 * Preserves the pristine curvature and routing topology calculated by Mermaid while smoothly
 * anchoring endpoints to moving nodes so edges never disconnect.
 */
export function deformSvgPathWithOffsets(
  origD: string,
  srcOffset: NodeOffset,
  tgtOffset: NodeOffset,
  edgeOffset: EdgeOffset
): { d: string; midPoint: Point; startPoint: Point; endPoint: Point } {
  const commands = parseSvgPathCommands(origD);
  const points = extractCoordinatePoints(commands);
  if (points.length === 0) {
    return {
      d: origD,
      midPoint: { x: 0, y: 0 },
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 0 },
    };
  }

  // Calculate cumulative arc-length along the points
  const distances: number[] = [0];
  let totalDist = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    totalDist += seg;
    distances.push(totalDist);
  }

  const updatedPoints: Point[] = points.map((p, k) => {
    const t = totalDist > 0 ? distances[k] / totalDist : k / Math.max(1, points.length - 1);

    // 1. Interpolated node movement: start moves with srcOffset, end moves with tgtOffset
    const nodeDx = srcOffset.x * (1 - t) + tgtOffset.x * t;
    const nodeDy = srcOffset.y * (1 - t) + tgtOffset.y * t;

    // 2. Waypoint handle offset (smooth parabolic curve, max at t=0.5, 0 at endpoints)
    const midInfluence = 4 * t * (1 - t);
    const wpDx = (edgeOffset.x || 0) * midInfluence;
    const wpDy = (edgeOffset.y || 0) * midInfluence;

    // 3. Endpoint handle manual dragging
    const startDx = (edgeOffset.startDx || 0) * (1 - t);
    const startDy = (edgeOffset.startDy || 0) * (1 - t);
    const endDx = (edgeOffset.endDx || 0) * t;
    const endDy = (edgeOffset.endDy || 0) * t;

    return {
      x: p.x + nodeDx + wpDx + startDx + endDx,
      y: p.y + nodeDy + wpDy + startDy + endDy,
    };
  });

  // Reconstruct SVG path string preserving command types
  let ptIdx = 0;
  let newD = '';
  for (const cmd of commands) {
    const type = cmd.type;
    const upper = type.toUpperCase();
    if (upper === 'M' || upper === 'L' || upper === 'T') {
      const p = updatedPoints[ptIdx++];
      if (p) newD += `${type}${p.x.toFixed(1)},${p.y.toFixed(1)} `;
    } else if (upper === 'C') {
      const p1 = updatedPoints[ptIdx++];
      const p2 = updatedPoints[ptIdx++];
      const p3 = updatedPoints[ptIdx++];
      if (p1 && p2 && p3) {
        newD += `${type}${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)} ${p3.x.toFixed(1)},${p3.y.toFixed(1)} `;
      }
    } else if (upper === 'Q' || upper === 'S') {
      const p1 = updatedPoints[ptIdx++];
      const p2 = updatedPoints[ptIdx++];
      if (p1 && p2) {
        newD += `${type}${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)} `;
      }
    } else if (upper === 'A') {
      const p = updatedPoints[ptIdx++];
      if (p) {
        newD += `${type}${cmd.args[0]},${cmd.args[1]} ${cmd.args[2]} ${cmd.args[3]} ${cmd.args[4]} ${p.x.toFixed(1)},${p.y.toFixed(1)} `;
      }
    } else if (upper === 'Z') {
      newD += `${type} `;
    }
  }

  const startPoint = updatedPoints[0] || { x: 0, y: 0 };
  const endPoint = updatedPoints[updatedPoints.length - 1] || startPoint;
  const midPoint = updatedPoints[Math.floor(updatedPoints.length / 2)] || startPoint;

  return {
    d: newD.trim(),
    midPoint,
    startPoint,
    endPoint,
  };
}

/**
 * Generates an ELK-style orthogonal route with rounded quadratic fillet corners (Q).
 * Matches Mermaid ELK's native orthogonal path geometry.
 */
export function generateElkOrthogonalRoute(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  midX: number,
  midY: number,
  sNormal: { normalX?: number; normalY?: number; x?: number; y?: number },
  tNormal: { normalX?: number; normalY?: number; x?: number; y?: number },
  radius = 8
): string {
  const dx = endX - startX;
  const dy = endY - startY;

  // Straight line if nearly collinear
  if (Math.abs(dx) < 3) {
    return `M${startX.toFixed(1)},${startY.toFixed(1)}L${endX.toFixed(1)},${endY.toFixed(1)}`;
  }
  if (Math.abs(dy) < 3) {
    return `M${startX.toFixed(1)},${startY.toFixed(1)}L${endX.toFixed(1)},${endY.toFixed(1)}`;
  }

  const sNormY = sNormal.normalY !== undefined ? sNormal.normalY : (sNormal.y || 0);
  const sNormX = sNormal.normalX !== undefined ? sNormal.normalX : (sNormal.x || 0);

  // Determine primary flow direction based on surface normals or relative delta
  const isVerticalFlow = sNormY !== 0 || (sNormX === 0 && Math.abs(dy) >= Math.abs(dx));

  if (isVerticalFlow) {
    const signX = dx >= 0 ? 1 : -1;
    const signY1 = midY >= startY ? 1 : -1;
    const signY2 = endY >= midY ? 1 : -1;

    const r = Math.max(
      0,
      Math.min(radius, Math.abs(dx) / 2, Math.abs(midY - startY) / 2, Math.abs(endY - midY) / 2)
    );

    if (r < 1.5) {
      return `M${startX.toFixed(1)},${startY.toFixed(1)}V${midY.toFixed(1)}H${endX.toFixed(1)}V${endY.toFixed(1)}`;
    }

    const c1StartY = midY - signY1 * r;
    const c1EndX = startX + signX * r;
    const c2StartX = endX - signX * r;
    const c2EndY = midY + signY2 * r;

    return [
      `M${startX.toFixed(1)},${startY.toFixed(1)}`,
      `L${startX.toFixed(1)},${c1StartY.toFixed(1)}`,
      `Q${startX.toFixed(1)},${midY.toFixed(1)} ${c1EndX.toFixed(1)},${midY.toFixed(1)}`,
      `L${c2StartX.toFixed(1)},${midY.toFixed(1)}`,
      `Q${endX.toFixed(1)},${midY.toFixed(1)} ${endX.toFixed(1)},${c2EndY.toFixed(1)}`,
      `L${endX.toFixed(1)},${endY.toFixed(1)}`,
    ].join('');
  } else {
    const signY = dy >= 0 ? 1 : -1;
    const signX1 = midX >= startX ? 1 : -1;
    const signX2 = endX >= midX ? 1 : -1;

    const r = Math.max(
      0,
      Math.min(radius, Math.abs(dy) / 2, Math.abs(midX - startX) / 2, Math.abs(endX - midX) / 2)
    );

    if (r < 1.5) {
      return `M${startX.toFixed(1)},${startY.toFixed(1)}H${midX.toFixed(1)}V${endY.toFixed(1)}H${endX.toFixed(1)}`;
    }

    const c1StartX = midX - signX1 * r;
    const c1EndY = startY + signY * r;
    const c2StartY = endY - signY * r;
    const c2EndX = midX + signX2 * r;

    return [
      `M${startX.toFixed(1)},${startY.toFixed(1)}`,
      `L${c1StartX.toFixed(1)},${startY.toFixed(1)}`,
      `Q${midX.toFixed(1)},${startY.toFixed(1)} ${midX.toFixed(1)},${c1EndY.toFixed(1)}`,
      `L${midX.toFixed(1)},${c2StartY.toFixed(1)}`,
      `Q${midX.toFixed(1)},${endY.toFixed(1)} ${c2EndX.toFixed(1)},${endY.toFixed(1)}`,
      `L${endX.toFixed(1)},${endY.toFixed(1)}`,
    ].join('');
  }
}

/**
 * Calculate rerouted curve for an edge between two nodes, preventing distortion and matching curve/engine settings.
 */
export function calculateReroutedEdgePath(
  path: SVGPathElement,
  svg: SVGSVGElement,
  nodeOffsets: NodeOffsetsMap,
  edgeOffsets: EdgeOffsetsMap,
  layoutEngine: 'dagre' | 'elk' = 'elk',
  flowchartCurve: string = 'basis'
): { d: string; midPoint: Point; startPoint: Point; endPoint: Point } {
  const origD = path.getAttribute('data-orig-d') || path.getAttribute('d') || '';
  const rawPathId = path.getAttribute('data-path-id') || path.getAttribute('id') || '';
  const edgeId = path.getAttribute('data-edge-id') || rawPathId;
  const srcId = path.getAttribute('data-source-id');
  const tgtId = path.getAttribute('data-target-id');
  const edgeKey = srcId && tgtId ? `${srcId}->${tgtId}` : edgeId;

  const srcNodeEl = srcId ? findNodeElement(svg, srcId) : null;
  const tgtNodeEl = tgtId ? findNodeElement(svg, tgtId) : null;

  const srcOffset = resolveNodeOffset(srcId, srcNodeEl, nodeOffsets);
  const tgtOffset = resolveNodeOffset(tgtId, tgtNodeEl, nodeOffsets);
  const edgeOffset =
    edgeOffsets[rawPathId] ||
    edgeOffsets[edgeId] ||
    (edgeKey ? edgeOffsets[edgeKey] : undefined) ||
    { x: 0, y: 0 };

  const normCurve = (flowchartCurve || 'basis').toLowerCase();
  const normEngine = (layoutEngine || 'elk').toLowerCase() as 'dagre' | 'elk';

  const hasNodeMovement = srcOffset.x !== 0 || srcOffset.y !== 0 || tgtOffset.x !== 0 || tgtOffset.y !== 0;
  const hasEdgeMovement =
    edgeOffset.x !== 0 ||
    edgeOffset.y !== 0 ||
    (edgeOffset.startDx !== undefined && edgeOffset.startDx !== 0) ||
    (edgeOffset.startDy !== undefined && edgeOffset.startDy !== 0) ||
    (edgeOffset.endDx !== undefined && edgeOffset.endDx !== 0) ||
    (edgeOffset.endDy !== undefined && edgeOffset.endDy !== 0);

  // Parse original coordinate points from Mermaid's initial layout
  const origPoints = extractCoordinatePoints(parseSvgPathCommands(origD));
  const origStart = origPoints[0] || { x: 0, y: 0 };
  const origEnd = origPoints[origPoints.length - 1] || origStart;
  const origMid = origPoints[Math.floor(origPoints.length / 2)] || origStart;

  // If no node moved and no edge dragged, always preserve pristine original path from Mermaid layout
  if (!hasNodeMovement && !hasEdgeMovement) {
    return { d: origD, midPoint: origMid, startPoint: origStart, endPoint: origEnd };
  }

  // Self-loop (srcId === tgtId): Rigidly translate loop to maintain pristine circular/oval shape
  if (srcId && tgtId && srcId === tgtId) {
    const totalDx = srcOffset.x + edgeOffset.x;
    const totalDy = srcOffset.y + edgeOffset.y;
    const newD = translateSvgPath(origD, totalDx, totalDy);
    const loopPoints = extractCoordinatePoints(parseSvgPathCommands(newD));
    const startPoint = loopPoints[0] || { x: 0, y: 0 };
    const endPoint = loopPoints[loopPoints.length - 1] || startPoint;
    const midPoint = loopPoints[Math.floor(loopPoints.length / 2)] || startPoint;
    return { d: newD, midPoint, startPoint, endPoint };
  }

  // Resolve source node moved center & boundary dimensions
  let sCx: number, sCy: number, sHw: number, sHh: number;
  if (srcNodeEl) {
    let sOrigCx = parseFloat(srcNodeEl.getAttribute('data-orig-cx') || 'NaN');
    let sOrigCy = parseFloat(srcNodeEl.getAttribute('data-orig-cy') || 'NaN');
    if (isNaN(sOrigCx) || isNaN(sOrigCy)) {
      const geom = getNodeGeometry(srcNodeEl, svg);
      sOrigCx = geom.origCenterX;
      sOrigCy = geom.origCenterY;
      srcNodeEl.setAttribute('data-orig-cx', sOrigCx.toFixed(1));
      srcNodeEl.setAttribute('data-orig-cy', sOrigCy.toFixed(1));
      srcNodeEl.setAttribute('data-hw', geom.halfWidth.toFixed(1));
      srcNodeEl.setAttribute('data-hh', geom.halfHeight.toFixed(1));
    }
    sHw = parseFloat(srcNodeEl.getAttribute('data-hw') || '60');
    sHh = parseFloat(srcNodeEl.getAttribute('data-hh') || '25');
    sCx = sOrigCx + srcOffset.x;
    sCy = sOrigCy + srcOffset.y;
  } else {
    sCx = origStart.x + srcOffset.x;
    sCy = origStart.y + srcOffset.y;
    sHw = 14;
    sHh = 12;
  }

  // Resolve target node moved center & boundary dimensions
  let tCx: number, tCy: number, tHw: number, tHh: number;
  if (tgtNodeEl) {
    let tOrigCx = parseFloat(tgtNodeEl.getAttribute('data-orig-cx') || 'NaN');
    let tOrigCy = parseFloat(tgtNodeEl.getAttribute('data-orig-cy') || 'NaN');
    if (isNaN(tOrigCx) || isNaN(tOrigCy)) {
      const geom = getNodeGeometry(tgtNodeEl, svg);
      tOrigCx = geom.origCenterX;
      tOrigCy = geom.origCenterY;
      tgtNodeEl.setAttribute('data-orig-cx', tOrigCx.toFixed(1));
      tgtNodeEl.setAttribute('data-orig-cy', tOrigCy.toFixed(1));
      tgtNodeEl.setAttribute('data-hw', geom.halfWidth.toFixed(1));
      tgtNodeEl.setAttribute('data-hh', geom.halfHeight.toFixed(1));
    }
    tHw = parseFloat(tgtNodeEl.getAttribute('data-hw') || '60');
    tHh = parseFloat(tgtNodeEl.getAttribute('data-hh') || '25');
    tCx = tOrigCx + tgtOffset.x;
    tCy = tOrigCy + tgtOffset.y;
  } else {
    tCx = origEnd.x + tgtOffset.x;
    tCy = origEnd.y + tgtOffset.y;
    tHw = 14;
    tHh = 12;
  }

  const baseMidX = (sCx + tCx) / 2;
  const baseMidY = (sCy + tCy) / 2;
  const actualMidX = baseMidX + (edgeOffset.x || 0);
  const actualMidY = baseMidY + (edgeOffset.y || 0);

  // Compute boundary intersections with source and target boxes
  const startBound = srcNodeEl
    ? computeBoxBoundaryIntersection(sCx, sCy, sHw, sHh, actualMidX, actualMidY, 0)
    : { x: sCx, y: sCy, normalX: 0, normalY: 1 };
  const endBound = tgtNodeEl
    ? computeBoxBoundaryIntersection(tCx, tCy, tHw, tHh, actualMidX, actualMidY, 3)
    : { x: tCx, y: tCy, normalX: 0, normalY: -1 };

  const startX = startBound.x + (edgeOffset.startDx || 0);
  const startY = startBound.y + (edgeOffset.startDy || 0);
  const endX = endBound.x + (edgeOffset.endDx || 0);
  const endY = endBound.y + (edgeOffset.endDy || 0);

  const startPoint = { x: startX, y: startY };
  const endPoint = { x: endX, y: endY };
  const midPoint = { x: actualMidX, y: actualMidY };

  const vX = endX - startX;
  const vY = endY - startY;
  const dist = Math.hypot(vX, vY);

  let newD = '';

  // 1. LINEAR CURVE: Clean straight line segments (as requested: 'linear')
  if (normCurve === 'linear') {
    const hasManualMid = Math.abs(edgeOffset.x || 0) >= 2 || Math.abs(edgeOffset.y || 0) >= 2;
    if (!hasManualMid) {
      newD = `M${startX.toFixed(1)},${startY.toFixed(1)}L${endX.toFixed(1)},${endY.toFixed(1)}`;
      midPoint.x = (startX + endX) / 2;
      midPoint.y = (startY + endY) / 2;
    } else {
      newD = `M${startX.toFixed(1)},${startY.toFixed(1)}L${actualMidX.toFixed(1)},${actualMidY.toFixed(1)}L${endX.toFixed(1)},${endY.toFixed(1)}`;
    }
    return { d: newD, midPoint, startPoint, endPoint };
  }

  // 2. STEPPED / ORTHOGONAL: Manhattan routing with horizontal & vertical segments
  if (normCurve.includes('step')) {
    if (normCurve === 'stepbefore') {
      newD = `M${startX.toFixed(1)},${startY.toFixed(1)}V${actualMidY.toFixed(1)}H${endX.toFixed(1)}V${endY.toFixed(1)}`;
    } else if (normCurve === 'stepafter') {
      newD = `M${startX.toFixed(1)},${startY.toFixed(1)}H${actualMidX.toFixed(1)}V${endY.toFixed(1)}H${endX.toFixed(1)}`;
    } else {
      if (Math.abs(vX) >= Math.abs(vY)) {
        newD = `M${startX.toFixed(1)},${startY.toFixed(1)}H${actualMidX.toFixed(1)}V${endY.toFixed(1)}H${endX.toFixed(1)}`;
      } else {
        newD = `M${startX.toFixed(1)},${startY.toFixed(1)}V${actualMidY.toFixed(1)}H${endX.toFixed(1)}V${endY.toFixed(1)}`;
      }
    }
    return { d: newD, midPoint, startPoint, endPoint };
  }

  // 3. ELK ENGINE: Layered & orthogonal routing with rounded fillet corners or multi-point preservation
  if (normEngine === 'elk') {
    // If original path was multi-segment (e.g. channel bypass / loopback with multiple bends),
    // deform it to keep all intermediate obstacle-avoidance waypoints while anchoring to moving nodes!
    if (origPoints.length > 2 && !normCurve.includes('step')) {
      return deformSvgPathWithOffsets(origD, srcOffset, tgtOffset, edgeOffset);
    }

    // Otherwise, generate ELK orthogonal routing with rounded fillet corners (Q corners)
    newD = generateElkOrthogonalRoute(
      startX,
      startY,
      endX,
      endY,
      actualMidX,
      actualMidY,
      startBound,
      endBound,
      8
    );
    return { d: newD, midPoint, startPoint, endPoint };
  }

  // 4. DAGRE ENGINE (or default):
  // If user manually dragged the midpoint waypoint handle (Smooth Quadratic Bézier passing through waypoint)
  const hasManualWaypoint = Math.abs(edgeOffset.x || 0) >= 2 || Math.abs(edgeOffset.y || 0) >= 2;
  if (hasManualWaypoint) {
    const cpX = 2 * actualMidX - 0.5 * (startX + endX);
    const cpY = 2 * actualMidY - 0.5 * (startY + endY);
    newD = `M${startX.toFixed(1)},${startY.toFixed(1)}Q${cpX.toFixed(1)},${cpY.toFixed(1)} ${endX.toFixed(1)},${endY.toFixed(1)}`;
    return { d: newD, midPoint, startPoint, endPoint };
  }

  // 5. DAGRE DEFAULT: Cubic Bézier guided by node surface normals
  const bendDist = Math.min(Math.max(dist * 0.38, 20), 85);
  const cp1X = startX + startBound.normalX * bendDist;
  const cp1Y = startY + startBound.normalY * bendDist;
  const cp2X = endX + endBound.normalX * bendDist;
  const cp2Y = endY + endBound.normalY * bendDist;
  newD = `M${startX.toFixed(1)},${startY.toFixed(1)}C${cp1X.toFixed(1)},${cp1Y.toFixed(1)} ${cp2X.toFixed(1)},${cp2Y.toFixed(1)} ${endX.toFixed(1)},${endY.toFixed(1)}`;
  return { d: newD, midPoint, startPoint, endPoint };
}

/**
 * Apply both node offsets and edge offsets to the SVG diagram in real-time.
 * Manages draggable state nodes, rerouted edges, and interactive edge endpoint handles.
 */
export function applyDiagramOffsetsToSvg(
  svg: SVGSVGElement,
  nodeOffsets: NodeOffsetsMap,
  edgeOffsets: EdgeOffsetsMap,
  targetEdgeId?: string | null,
  selectedEdgeId?: string | null,
  layoutEngine: 'dagre' | 'elk' = 'elk',
  flowchartCurve: string = 'basis'
): void {
  const actualSelectedEdgeId =
    selectedEdgeId !== undefined && selectedEdgeId !== null
      ? selectedEdgeId
      : targetEdgeId && (targetEdgeId.includes('->') || targetEdgeId.includes('#') || targetEdgeId.startsWith('path-'))
      ? targetEdgeId
      : null;

  // Ensure metadata is initialized first on this SVG element
  if (!svg.getAttribute('data-drag-initialized')) {
    initializeSvgDragMetadata(svg);
  }

  // 1. Update node transforms
  const nodesToUpdate = Array.from(svg.querySelectorAll('g.node')) as SVGGElement[];
  for (const node of nodesToUpdate) {
    const rawStateId = node.getAttribute('data-state-id') || node.getAttribute('id') || '';
    let stateId = cleanNodeId(rawStateId);
    if (!stateId && (rawStateId.includes('root_start') || rawStateId.includes('startNode'))) {
      stateId = '[*]';
    }
    if (!stateId) continue;
    if (!node.getAttribute('data-state-id')) {
      node.setAttribute('data-state-id', stateId);
    }

    // Ensure original transform is captured from pristine Mermaid layout if not yet saved
    if (!node.getAttribute('data-orig-transform')) {
      const currentTf = node.getAttribute('transform') || '';
      node.setAttribute('data-orig-transform', currentTf);
      const { x, y } = parseTranslation(currentTf);
      node.setAttribute('data-orig-x', String(x));
      node.setAttribute('data-orig-y', String(y));
    }

    const offset = resolveNodeOffset(stateId, node, nodeOffsets);
    if (offset.x === 0 && offset.y === 0) {
      // Node has NOT been moved - restore pristine original transform from Mermaid!
      const origTf = node.getAttribute('data-orig-transform');
      if (origTf !== null && origTf !== undefined) {
        node.setAttribute('transform', origTf);
      }
    } else {
      // Node has been moved by user dragging
      const origX = parseFloat(node.getAttribute('data-orig-x') || '0');
      const origY = parseFloat(node.getAttribute('data-orig-y') || '0');
      node.setAttribute('transform', `translate(${origX + offset.x}, ${origY + offset.y})`);
    }
  }

  // 2. Update edge paths, hitboxes, labels, and handles
  const allPaths = (Array.from(svg.querySelectorAll('g.edgePaths path')).filter(
    (p) => !p.closest('defs') && !p.closest('marker') && p.getAttribute('d') && !p.classList.contains('tc-edge-hitbox')
  ) as SVGPathElement[]);

  // Ensure waypoint handle group exists in the same coordinate space on top
  const edgePathsGroup = svg.querySelector('g.edgePaths');
  const parentContainer = (edgePathsGroup?.parentElement || svg) as SVGElement;
  let handlesGroup = parentContainer.querySelector('g.tc-edge-handles') as SVGGElement | null;
  if (!handlesGroup) {
    handlesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    handlesGroup.setAttribute('class', 'tc-edge-handles');
    parentContainer.appendChild(handlesGroup);
  } else if ((handlesGroup.parentElement as Element | null) !== parentContainer) {
    parentContainer.appendChild(handlesGroup);
  }
  // Ensure handlesGroup is on top of edges
  parentContainer.appendChild(handlesGroup);
  handlesGroup.style.pointerEvents = 'all';

  let selectedFound = false;

  for (const path of allPaths) {
    const rawPathId = path.getAttribute('data-path-id') || path.getAttribute('id') || '';
    const edgeId = path.getAttribute('data-edge-id') || rawPathId;
    const srcId = path.getAttribute('data-source-id');
    const tgtId = path.getAttribute('data-target-id');
    const edgeKey = srcId && tgtId ? `${srcId}->${tgtId}` : edgeId;

    const { d: newD, midPoint, startPoint, endPoint } = calculateReroutedEdgePath(
      path,
      svg,
      nodeOffsets,
      edgeOffsets,
      layoutEngine,
      flowchartCurve
    );

    // Update path `d`
    path.setAttribute('d', newD);

    // Update hitbox `d`
    const parent = path.parentElement;
    const hitbox = parent?.querySelector(`.tc-edge-hitbox[data-path-id="${rawPathId}"]`);
    if (hitbox) {
      hitbox.setAttribute('d', newD);
    }

    // Update edge label position to follow rerouted midpoint
    if (edgeKey || edgeId) {
      const labels = Array.from(
        svg.querySelectorAll(
          `g.edgeLabel[data-linked-path-id="${rawPathId}"], g.edgeLabel[data-linked-path-id="${edgeKey}"], g.edgeLabel[data-edge-id="${edgeId}"], g.edgeLabel[data-edge-id="${rawPathId}"], g.edgeLabel[data-edge-id="${edgeKey}"]`
        )
      ) as SVGGElement[];
      for (const label of labels) {
        if (!label.hasAttribute('data-orig-x')) {
          let curX = 0;
          let curY = 0;
          const tf = label.getAttribute('transform');
          if (tf) {
            const tm = tf.match(/translate\(\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)\s*\)/);
            if (tm) {
              curX = parseFloat(tm[1]);
              curY = parseFloat(tm[2]);
            }
          }
          label.setAttribute('data-orig-x', String(curX));
          label.setAttribute('data-orig-y', String(curY));
        }
        const origLx = parseFloat(label.getAttribute('data-orig-x') || '0');
        const origLy = parseFloat(label.getAttribute('data-orig-y') || '0');
        // Smoothly adjust label based on difference from original midpoint
        const origD = path.getAttribute('data-orig-d') || '';
        const origPoints = extractCoordinatePoints(parseSvgPathCommands(origD));
        const origMid = origPoints[Math.floor(origPoints.length / 2)] || { x: origLx, y: origLy };
        const dX = midPoint.x - origMid.x;
        const dY = midPoint.y - origMid.y;
        label.setAttribute('transform', `translate(${origLx + dX}, ${origLy + dY})`);
      }

      // Update priority badge position
      const badges = Array.from(
        svg.querySelectorAll(
          `.tc-priority-badge[data-path-id="${rawPathId}"], .tc-priority-badge[data-path-id="${edgeKey}"], .tc-priority-badge[data-edge-id="${edgeId}"], .tc-priority-badge[data-edge-id="${rawPathId}"], .tc-priority-badge[data-edge-id="${edgeKey}"]`
        )
      ) as SVGGElement[];
      for (const badge of badges) {
        if (!badge.hasAttribute('data-orig-x')) {
          badge.setAttribute('data-orig-x', '0');
          badge.setAttribute('data-orig-y', '0');
        }
        const origD = path.getAttribute('data-orig-d') || '';
        const origPoints = extractCoordinatePoints(parseSvgPathCommands(origD));
        const origStart = origPoints[0] || { x: 0, y: 0 };
        const origBx = parseFloat(badge.getAttribute('data-orig-x') || '0');
        const origBy = parseFloat(badge.getAttribute('data-orig-y') || '0');
        const dX = startPoint.x - origStart.x;
        const dY = startPoint.y - origStart.y;
        badge.setAttribute('transform', `translate(${origBx + dX}, ${origBy + dY})`);
      }
    }

    // Highlight selected edge and update/show its draggable waypoint & 2 endpoint handles
    const pathId = rawPathId;
    const normSelected = actualSelectedEdgeId && actualSelectedEdgeId.trim() !== '->' ? actualSelectedEdgeId.trim() : '';

    let isSelected = false;
    if (normSelected) {
      if (pathId === normSelected || path.id === normSelected) {
        isSelected = true;
      } else if (
        !selectedFound &&
        (edgeId === normSelected ||
          edgeKey === normSelected ||
          (srcId && tgtId && `${srcId}->${tgtId}` === normSelected))
      ) {
        isSelected = true;
        selectedFound = true;
      }
    }

    if (isSelected) {
      path.classList.add('selected-edge', 'diagram-selected-edge');
      hitbox?.classList.add('selected-edge');

      const handleKey = pathId;

      // 1. Midpoint / Curvature handle
      let midHandle = handlesGroup.querySelector(
        `.tc-edge-handle[data-edge-id="${handleKey}"][data-handle-type="mid"]`
      ) as SVGGElement | null;
      if (!midHandle) {
        midHandle = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        midHandle.setAttribute('class', 'tc-edge-handle tc-edge-handle-mid cursor-grab');
        midHandle.setAttribute('data-edge-id', handleKey);
        midHandle.setAttribute('data-source-id', srcId || '');
        midHandle.setAttribute('data-target-id', tgtId || '');
        midHandle.setAttribute('data-handle-type', 'mid');

        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        halo.setAttribute('class', 'handle-halo');
        halo.setAttribute('r', '14');
        halo.setAttribute('fill', 'rgba(14, 165, 233, 0.2)');
        halo.setAttribute('stroke', '#0ea5e9');
        halo.setAttribute('stroke-width', '1.5');
        halo.setAttribute('stroke-dasharray', '3 2');

        const core = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        core.setAttribute('class', 'handle-core');
        core.setAttribute('r', '6');
        core.setAttribute('fill', '#38bdf8');
        core.setAttribute('stroke', '#0f172a');
        core.setAttribute('stroke-width', '2');
        core.setAttribute('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))');

        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = 'Curve Waypoint: Drag to adjust edge path and curve';

        midHandle.appendChild(halo);
        midHandle.appendChild(core);
        midHandle.appendChild(title);
        handlesGroup.appendChild(midHandle);
      } else {
        midHandle.setAttribute('data-source-id', srcId || '');
        midHandle.setAttribute('data-target-id', tgtId || '');
      }
      midHandle.setAttribute('transform', `translate(${midPoint.x.toFixed(1)}, ${midPoint.y.toFixed(1)})`);

      // 2. Start endpoint handle (Source anchor)
      let startHandle = handlesGroup.querySelector(
        `.tc-edge-handle[data-edge-id="${handleKey}"][data-handle-type="start"]`
      ) as SVGGElement | null;
      if (!startHandle) {
        startHandle = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        startHandle.setAttribute('class', 'tc-edge-handle tc-edge-endpoint-start cursor-crosshair');
        startHandle.setAttribute('data-edge-id', handleKey);
        startHandle.setAttribute('data-source-id', srcId || '');
        startHandle.setAttribute('data-target-id', tgtId || '');
        startHandle.setAttribute('data-handle-type', 'start');

        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        halo.setAttribute('class', 'handle-halo');
        halo.setAttribute('r', '14');
        halo.setAttribute('fill', 'rgba(16, 185, 129, 0.25)');
        halo.setAttribute('stroke', '#10b981');
        halo.setAttribute('stroke-width', '1.5');

        const core = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        core.setAttribute('class', 'handle-core');
        core.setAttribute('r', '6');
        core.setAttribute('fill', '#10b981');
        core.setAttribute('stroke', '#0f172a');
        core.setAttribute('stroke-width', '2');
        core.setAttribute('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))');

        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = 'Start Endpoint: Drag to reposition source anchor';

        startHandle.appendChild(halo);
        startHandle.appendChild(core);
        startHandle.appendChild(title);
        handlesGroup.appendChild(startHandle);
      } else {
        startHandle.setAttribute('data-source-id', srcId || '');
        startHandle.setAttribute('data-target-id', tgtId || '');
      }
      startHandle.setAttribute('transform', `translate(${startPoint.x.toFixed(1)}, ${startPoint.y.toFixed(1)})`);

      // 3. End endpoint handle (Target anchor)
      let endHandle = handlesGroup.querySelector(
        `.tc-edge-handle[data-edge-id="${handleKey}"][data-handle-type="end"]`
      ) as SVGGElement | null;
      if (!endHandle) {
        endHandle = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        endHandle.setAttribute('class', 'tc-edge-handle tc-edge-endpoint-end cursor-crosshair');
        endHandle.setAttribute('data-edge-id', handleKey);
        endHandle.setAttribute('data-source-id', srcId || '');
        endHandle.setAttribute('data-target-id', tgtId || '');
        endHandle.setAttribute('data-handle-type', 'end');

        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        halo.setAttribute('class', 'handle-halo');
        halo.setAttribute('r', '14');
        halo.setAttribute('fill', 'rgba(244, 63, 94, 0.25)');
        halo.setAttribute('stroke', '#f43f5e');
        halo.setAttribute('stroke-width', '1.5');

        const core = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        core.setAttribute('class', 'handle-core');
        core.setAttribute('r', '6');
        core.setAttribute('fill', '#f43f5e');
        core.setAttribute('stroke', '#0f172a');
        core.setAttribute('stroke-width', '2');
        core.setAttribute('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))');

        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = 'End Endpoint: Drag to reposition target anchor';

        endHandle.appendChild(halo);
        endHandle.appendChild(core);
        endHandle.appendChild(title);
        handlesGroup.appendChild(endHandle);
      } else {
        endHandle.setAttribute('data-source-id', srcId || '');
        endHandle.setAttribute('data-target-id', tgtId || '');
      }
      endHandle.setAttribute('transform', `translate(${endPoint.x.toFixed(1)}, ${endPoint.y.toFixed(1)})`);
    } else {
      path.classList.remove('selected-edge', 'diagram-selected-edge');
      hitbox?.classList.remove('selected-edge');
    }
  }

  // Remove handles for edges that are no longer selected
  if (handlesGroup) {
    const existingHandles = Array.from(handlesGroup.querySelectorAll('.tc-edge-handle'));
    const normSelected = actualSelectedEdgeId && actualSelectedEdgeId.trim() !== '->' ? actualSelectedEdgeId.trim() : '';
    for (const h of existingHandles) {
      const hEdgeId = (h.getAttribute('data-edge-id') || '').trim();
      const isStillSelected = Boolean(normSelected && hEdgeId === normSelected);
      if (!isStillSelected) {
        h.remove();
      }
    }
  }
}

/**
 * Convenience wrapper to maintain backward-compatibility with applyNodeOffsetsToSvg.
 */
export function applyNodeOffsetsToSvg(
  svg: SVGSVGElement,
  nodeOffsets: NodeOffsetsMap,
  targetNodeIds?: string[]
): void {
  applyDiagramOffsetsToSvg(svg, nodeOffsets, {}, null, null);
}

/**
 * Reset all manual node positions and edge offsets, restoring the original Mermaid layout.
 */
export function resetSvgDiagramOffsets(svg: SVGSVGElement): void {
  // 1. Reset all nodes to original transforms
  const nodes = Array.from(svg.querySelectorAll('g.node[data-orig-transform]')) as SVGGElement[];
  for (const node of nodes) {
    const origTf = node.getAttribute('data-orig-transform') || '';
    node.setAttribute('transform', origTf);
  }

  // 2. Reset all paths to original d
  const paths = Array.from(svg.querySelectorAll('g.edgePaths path[data-orig-d]')) as SVGPathElement[];
  for (const path of paths) {
    const origD = path.getAttribute('data-orig-d') || '';
    path.setAttribute('d', origD);
    path.classList.remove('selected-edge');

    const edgeId = path.getAttribute('data-edge-id') || path.getAttribute('data-path-id');
    const hitbox = path.parentElement?.querySelector(`.tc-edge-hitbox[data-edge-id="${edgeId}"]`);
    if (hitbox) {
      hitbox.setAttribute('d', origD);
      hitbox.classList.remove('selected-edge');
    }
  }

  // 3. Reset all edge labels
  const labels = Array.from(svg.querySelectorAll('g.edgeLabel[data-orig-transform]')) as SVGGElement[];
  for (const label of labels) {
    const origTf = label.getAttribute('data-orig-transform') || '';
    label.setAttribute('transform', origTf);
  }

  // 4. Reset all priority badges
  const badges = Array.from(svg.querySelectorAll('.tc-priority-badge[data-orig-transform]')) as SVGGElement[];
  for (const badge of badges) {
    const origTf = badge.getAttribute('data-orig-transform') || '';
    badge.setAttribute('transform', origTf);
  }

  // 5. Remove any waypoint handles
  const handles = svg.querySelector('g.tc-edge-handles');
  if (handles) {
    handles.remove();
  }
}

/**
 * Alias for backward-compatibility.
 */
export const resetSvgNodeOffsets = resetSvgDiagramOffsets;
