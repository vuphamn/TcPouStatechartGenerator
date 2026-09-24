import { cleanNodeId, getNodeGeometry, resolveNodeOffset, NodeOffsetsMap } from './nodeDragger.ts';

export interface CanvasNodePosition {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  cluster?: string;
}

export type CanvasNodePositionsMap = Record<string, CanvasNodePosition>;

export interface CanvasMetadataOptions {
  layoutEngine?: 'dagre' | 'elk';
  flowchartCurve?: string;
  theme?: string;
  includeJsonMetadata?: boolean;
  includeStructuralComments?: boolean;
  includeLayoutDirectives?: boolean;
}

/**
 * Extracts current node positions and bounding dimensions from the diagram SVG canvas.
 * Takes into account both initial rendered layout and any user-dragged offsets.
 */
export function extractCanvasNodePositions(
  svgOrContainer?: Element | null,
  nodeOffsets: NodeOffsetsMap = {}
): CanvasNodePositionsMap {
  if (typeof document === 'undefined') return {};

  let svg: SVGSVGElement | null = null;
  if (svgOrContainer instanceof SVGSVGElement && svgOrContainer.id !== 'diagram-snap-grid-svg') {
    svg = svgOrContainer;
  } else if (svgOrContainer) {
    svg = (svgOrContainer.querySelector('#mermaid-diagram-svg-container svg') ||
      svgOrContainer.querySelector('svg:not(#diagram-snap-grid-svg):not([id*="snap-grid"])') ||
      svgOrContainer.querySelector('svg')) as SVGSVGElement | null;
  }

  if (!svg || svg.id === 'diagram-snap-grid-svg') {
    svg =
      (document.querySelector('#mermaid-diagram-svg-container svg') as SVGSVGElement | null) ||
      (document.querySelector('#mermaid-canvas-area svg:not(#diagram-snap-grid-svg):not([id*="snap-grid"])') as SVGSVGElement | null) ||
      (document.querySelector('.tc-mermaid-svg') as SVGSVGElement | null) ||
      (document.querySelector('svg:not(#diagram-snap-grid-svg):not([id*="snap-grid"])') as SVGSVGElement | null);
  }

  if (!svg) return {};

  const nodes = Array.from(svg.querySelectorAll('g.node')) as SVGGElement[];
  const result: CanvasNodePositionsMap = {};

  for (const node of nodes) {
    const rawStateId = node.getAttribute('data-state-id') || node.getAttribute('id') || '';
    let stateId = cleanNodeId(rawStateId);
    if (!stateId && (rawStateId.includes('root_start') || rawStateId.includes('startNode'))) {
      stateId = '[*]';
    }
    if (!stateId) continue;

    // Filter out internal generated note overlays if rendered into SVG
    if (stateId.startsWith('note_') || node.classList.contains('note-node')) {
      continue;
    }

    // Extract label
    let label = node.getAttribute('data-state-label') || '';
    if (!label) {
      const labelEl = node.querySelector('.nodeLabel, text');
      label = labelEl?.textContent?.trim() || stateId;
    }

    // Extract geometry and user drag offset
    const geom = getNodeGeometry(node, svg);
    const offset = resolveNodeOffset(stateId, node, nodeOffsets);

    const cx = Math.round(geom.origCenterX + (offset ? offset.x : 0));
    const cy = Math.round(geom.origCenterY + (offset ? offset.y : 0));
    const w = Math.round(geom.width);
    const h = Math.round(geom.height);
    const x = Math.round(cx - w / 2);
    const y = Math.round(cy - h / 2);

    const clusterEl = node.closest('g.cluster');
    const clusterId = clusterEl
      ? clusterEl.getAttribute('id') || clusterEl.getAttribute('data-id') || undefined
      : undefined;

    result[stateId] = {
      id: stateId,
      label,
      x,
      y,
      width: w,
      height: h,
      centerX: cx,
      centerY: cy,
      cluster: clusterId ? cleanNodeId(clusterId) : undefined,
    };
  }

  return result;
}

/**
 * Computes structural vertical tiers from extracted node positions.
 * Groups nodes whose Y centers or tops fall within proximity into ordered tiers.
 */
export function computeStructuralTiers(positions: CanvasNodePositionsMap): { tierIndex: number; approxY: number; nodes: CanvasNodePosition[] }[] {
  const list = Object.values(positions);
  if (list.length === 0) return [];

  // Sort primarily by Y ascending, then by X ascending
  const sorted = [...list].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 40) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });

  const tiers: { tierIndex: number; approxY: number; nodes: CanvasNodePosition[] }[] = [];
  const Y_THRESHOLD = 50;

  for (const node of sorted) {
    const existingTier = tiers.find((t) => Math.abs(t.approxY - node.y) <= Y_THRESHOLD);
    if (existingTier) {
      existingTier.nodes.push(node);
      // Re-sort tier nodes by X
      existingTier.nodes.sort((a, b) => a.x - b.x);
      // Update average Y
      existingTier.approxY = Math.round(
        existingTier.nodes.reduce((acc, n) => acc + n.y, 0) / existingTier.nodes.length
      );
    } else {
      tiers.push({
        tierIndex: tiers.length + 1,
        approxY: node.y,
        nodes: [node],
      });
    }
  }

  // Sort tiers by approxY
  tiers.sort((a, b) => a.approxY - b.approxY);
  tiers.forEach((t, idx) => {
    t.tierIndex = idx + 1;
  });

  return tiers;
}

/**
 * Formats extracted canvas positions into Mermaid '%%' comment metadata and structural comments.
 */
export function formatPositionsCommentMetadata(
  positions: CanvasNodePositionsMap,
  options: CanvasMetadataOptions = {}
): string {
  const nodeEntries = Object.entries(positions);
  if (nodeEntries.length === 0) return '';

  const layout = options.layoutEngine || 'elk';
  const tiers = computeStructuralTiers(positions);

  const lines: string[] = [];
  lines.push('%% =========================================================================');
  lines.push('%% DIAGRAM CANVAS NODE POSITIONS & STRUCTURAL METADATA');
  lines.push('%% Extracted from interactive diagram canvas coordinates');
  lines.push('%% =========================================================================');
  lines.push(`%% @layout-engine: ${layout}`);
  lines.push(`%% @node-count: ${nodeEntries.length}`);
  lines.push('%%');
  lines.push('%% Structural Tiers (Top-to-Bottom, Left-to-Right layout ordering):');

  for (const tier of tiers) {
    const nodeSummary = tier.nodes
      .map((n) => `${n.id} (x:${n.x}, y:${n.y}, w:${n.width}, h:${n.height})`)
      .join(', ');
    lines.push(`%%   Tier ${tier.tierIndex} (y ≈ ${tier.approxY}): ${nodeSummary}`);
  }

  lines.push('%%');
  lines.push('%% Node Coordinates Catalog [id: x, y, width, height, centerX, centerY]:');
  for (const [, pos] of nodeEntries) {
    const clusterInfo = pos.cluster ? ` [cluster: ${pos.cluster}]` : '';
    lines.push(
      `%%   - ${pos.id}: x=${pos.x}, y=${pos.y}, w=${pos.width}, h=${pos.height}, center=(${pos.centerX}, ${pos.centerY})${clusterInfo}`
    );
  }

  // Structural Subgraph hints for flowchart/hierarchical representation
  if (options.includeStructuralComments !== false && tiers.length > 1) {
    lines.push('%%');
    lines.push('%% Structural Rank Hints (for Mermaid layout engines):');
    for (const tier of tiers) {
      const ids = tier.nodes.map((n) => n.id).join(' ');
      lines.push(`%%   rank_tier_${tier.tierIndex} (y ~ ${tier.approxY}): [ ${ids} ]`);
    }
  }

  // Machine-readable JSON metadata block
  if (options.includeJsonMetadata !== false) {
    const jsonPayload: Record<string, { x: number; y: number; w: number; h: number; cx: number; cy: number; cluster?: string }> = {};
    for (const [id, p] of nodeEntries) {
      jsonPayload[id] = {
        x: p.x,
        y: p.y,
        w: p.width,
        h: p.height,
        cx: p.centerX,
        cy: p.centerY,
        ...(p.cluster ? { cluster: p.cluster } : {}),
      };
    }
    lines.push('%%');
    lines.push('%% Machine-Readable JSON Metadata:');
    lines.push(`%% %%canvas_node_positions: ${JSON.stringify(jsonPayload)}`);
  }

  lines.push('%% =========================================================================');
  return lines.join('\n');
}

const METADATA_SECTION_REGEX = /\n?%%\s*={3,}\n%%\s*DIAGRAM CANVAS NODE POSITIONS[\s\S]*?%%\s*={3,}/;

/**
 * Ensures Mermaid markdown contains appropriate layout init directives and appends
 * the canvas node positions as '%%' comment metadata.
 */
export function appendCanvasPositionsToMermaid(
  markdown: string,
  positions: CanvasNodePositionsMap,
  options: CanvasMetadataOptions = {}
): string {
  if (!markdown) return '';

  let result = markdown.trim();

  // 1. Remove previous metadata section if already present
  result = result.replace(METADATA_SECTION_REGEX, '').trim();

  // 2. Ensure layout directives exist in %%{init: ...}%% at the top
  if (options.includeLayoutDirectives !== false) {
    const layout = options.layoutEngine || 'elk';
    const curve = options.flowchartCurve || 'basis';
    const theme = options.theme || 'dark';

    const initRegex = /%%\{init:\s*\{[\s\S]*?\}\s*\}%%/;
    if (initRegex.test(result)) {
      result = result.replace(initRegex, (match) => {
        let updated = match;
        if (!/['"]?layout['"]?\s*:/i.test(updated)) {
          updated = updated.replace(/%%\{init:\s*\{/, `%%{init: {'layout': '${layout}', `);
        }
        if (!/['"]?theme['"]?\s*:/i.test(updated)) {
          updated = updated.replace(/%%\{init:\s*\{/, `%%{init: {'theme': '${theme}', `);
        }
        return updated;
      });
    } else {
      const initDirective = `%%{init: {'theme': '${theme}', 'layout': '${layout}', 'flowchart': {'defaultRenderer': '${layout}', 'curve': '${curve}'}}}%%`;
      result = `${initDirective}\n${result}`;
    }
  }

  // 3. Format and append positions comment block
  const commentMetadata = formatPositionsCommentMetadata(positions, options);
  if (commentMetadata) {
    result = `${result}\n\n${commentMetadata}\n`;
  }

  return result;
}

/**
 * Convenience function: extracts canvas node positions from the DOM SVG and appends them
 * directly to the provided Mermaid markdown.
 */
export function extractAndAppendCanvasPositions(
  markdown: string,
  svgOrContainer?: Element | null,
  nodeOffsets: NodeOffsetsMap = {},
  options: CanvasMetadataOptions = {}
): string {
  const positions = extractCanvasNodePositions(svgOrContainer, nodeOffsets);
  return appendCanvasPositionsToMermaid(markdown, positions, options);
}
