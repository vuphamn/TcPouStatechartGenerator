import { DiagramNotes, NodeDisplayProperties } from '../types.ts';
import { cleanNodeId, findNodeElement, findEdgePathElement } from './nodeDragger.ts';

export type ExportFormat = 'png' | 'svg';
export type ExportScale = 1 | 2 | 3 | 4;
export type ExportBackground = 'dark' | 'white' | 'transparent';

export interface DiagramExportOptions {
  format?: ExportFormat;
  scale?: ExportScale;
  background?: ExportBackground;
  padding?: number;
  fileName?: string;
  notes?: DiagramNotes;
  customStyles?: Record<string, NodeDisplayProperties>;
  theme?: string;
}

export interface ExportResult {
  blob: Blob;
  dataUrl?: string;
  width: number;
  height: number;
  fileName: string;
}

const BG_COLORS: Record<ExportBackground, string> = {
  dark: '#090d16',
  white: '#ffffff',
  transparent: 'none',
};

/**
 * Extracts individual lines from HTML or text containing <br>, <BR>, <p>, <div>,
 * escaped entities, and newlines.
 */
function extractLinesFromHtmlOrText(html: string): string[] {
  let s = html
    // Replace all variations of br tags (case-insensitive)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&lt;br\s*\/?&gt;/gi, '\n')
    // Replace closing block tags with newlines
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    // Strip opening block tags
    .replace(/<(p|div|li|h[1-6])[^>]*>/gi, '')
    // Strip any remaining HTML tags
    .replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  s = s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Splits a single long string into multiple lines at word boundaries
 * if it exceeds maxChars per line.
 */
function wrapLine(line: string, maxChars: number = 30): string[] {
  if (line.length <= maxChars) return [line];
  const words = line.split(/\s+/);
  const result: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if ((cur + ' ' + w).length <= maxChars) {
      cur += ' ' + w;
    } else {
      result.push(cur);
      cur = w;
    }
  }
  if (cur) result.push(cur);
  return result;
}

/**
 * Converts any <foreignObject> elements (which Mermaid emits with htmlLabels: true)
 * into standard SVG <text> elements with <tspan> children.
 * Ensures state names are strictly single-line, descriptions wrap properly,
 * text is mathematically centered inside node borders, and node rect boundaries
 * remain untouched so edge connections are never broken.
 */
function sanitizeForeignObjects(
  svg: SVGSVGElement,
  defaultTextColor: string,
  defaultLabelColor: string
): void {
  const foreignObjects = Array.from(svg.querySelectorAll('foreignObject'));
  for (const fo of foreignObjects) {
    try {
      const isEdgeLabel = Boolean(
        fo.closest('.edgeLabel') ||
        fo.querySelector('.edgeLabel') ||
        fo.classList.contains('edgeLabel')
      );

      const innerHtml = fo.innerHTML || fo.textContent || '';
      const rawLines = extractLinesFromHtmlOrText(innerHtml);
      if (rawLines.length === 0) {
        fo.remove();
        continue;
      }

      const nodeGroup = fo.closest('g.node') as SVGGElement | null;
      const edgeGroup = fo.closest('g.edgeLabel') as SVGGElement | null;
      const labelG = fo.closest('g.label') as SVGGElement | null;

      const rect = (nodeGroup?.querySelector('rect.label-container, rect.basic, rect') ||
        edgeGroup?.querySelector('rect.labelBkg, rect.background, rect')) as SVGRectElement | null;

      // Extract node or edge shape center
      let cx = 0;
      let cy = 0;
      let rectW = 120;
      let rectH = 40;

      if (rect) {
        const rx = parseFloat(rect.getAttribute('x') || '0') || 0;
        const ry = parseFloat(rect.getAttribute('y') || '0') || 0;
        rectW = parseFloat(rect.getAttribute('width') || '0') || 120;
        rectH = parseFloat(rect.getAttribute('height') || '0') || 40;
        cx = rx + rectW / 2;
        cy = ry + rectH / 2;
      } else {
        const fox = parseFloat(fo.getAttribute('x') || '0') || 0;
        const foy = parseFloat(fo.getAttribute('y') || '0') || 0;
        const fow = parseFloat(fo.getAttribute('width') || '0') || 120;
        const foh = parseFloat(fo.getAttribute('height') || '0') || 40;
        cx = fox + fow / 2;
        cy = foy + foh / 2;
        rectW = fow;
        rectH = foh;
      }

      const availW = Math.max(30, rectW - 16);
      const availH = Math.max(16, rectH - 12);

      const lines: string[] = [];
      if (isEdgeLabel) {
        rawLines.forEach((line) => lines.push(...wrapLine(line, 32)));
      } else {
        // Line 0: State Name MUST NEVER BE WRAPPED (single line always)
        lines.push(rawLines[0]);
        // Lines 1..N: Description lines CAN be wrapped
        const descMaxChars = Math.max(20, Math.floor(availW / 6.8));
        rawLines.slice(1).forEach((line) => {
          lines.push(...wrapLine(line, descMaxChars));
        });
      }

      const innerElem = fo.querySelector('.nodeLabel, .edgeLabel, span, p, div') as HTMLElement | null;
      let textColor = innerElem?.style?.color || (isEdgeLabel ? defaultLabelColor : defaultTextColor);
      if (!textColor || textColor === 'inherit') {
        textColor = isEdgeLabel ? defaultLabelColor : defaultTextColor;
      }

      const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      textEl.setAttribute('x', String(cx));
      textEl.setAttribute('y', String(cy));
      textEl.setAttribute('text-anchor', 'middle');
      textEl.setAttribute('dominant-baseline', 'central');
      textEl.setAttribute('fill', textColor);
      textEl.setAttribute(
        'font-family',
        'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      );

      if (lines.length <= 1) {
        let titleFontSize = isEdgeLabel ? 11 : 13.5;
        const estTitleW = lines[0].length * (isEdgeLabel ? 6.5 : 7.6);
        if (!isEdgeLabel && estTitleW > availW) {
          titleFontSize = Math.max(9.5, Math.floor(13.5 * (availW / estTitleW)));
        }
        textEl.setAttribute('font-size', `${titleFontSize}px`);
        textEl.setAttribute('font-weight', isEdgeLabel ? '500' : '600');
        textEl.setAttribute('class', isEdgeLabel ? 'edge-title' : 'node-title');
        textEl.textContent = lines[0] || '';
      } else {
        if (isEdgeLabel) {
          const fontSize = 11;
          const lineSpacing = 14;
          const totalH = (lines.length - 1) * lineSpacing;
          lines.forEach((line, idx) => {
            const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspan.setAttribute('x', String(cx));
            tspan.setAttribute('y', String(cy - totalH / 2 + idx * lineSpacing));
            tspan.setAttribute('text-anchor', 'middle');
            tspan.setAttribute('dominant-baseline', 'central');
            tspan.setAttribute('font-size', `${fontSize}px`);
            tspan.setAttribute('font-weight', '500');
            tspan.textContent = line;
            textEl.appendChild(tspan);
          });
        } else {
          // Node with State Name (Line 0) + Description (Lines 1..N-1)
          let titleFontSize = 13.5;
          const estTitleW = lines[0].length * 7.6;
          if (estTitleW > availW) {
            titleFontSize = Math.max(9.5, Math.floor(13.5 * (availW / estTitleW)));
          }

          let descFontSize = 12;
          let descLineHeight = 16;
          let gap = 6;
          let totalBlockH = titleFontSize + gap + (lines.length - 1) * descLineHeight;

          if (totalBlockH > availH) {
            gap = 4;
            descLineHeight = Math.max(12, Math.floor((availH - titleFontSize - gap) / (lines.length - 1)));
            descFontSize = Math.max(9.5, Math.min(12, descLineHeight * 0.8));
            totalBlockH = titleFontSize + gap + (lines.length - 1) * descLineHeight;
          }

          const startY = cy - totalBlockH / 2;
          lines.forEach((line, idx) => {
            const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspan.setAttribute('x', String(cx));
            tspan.setAttribute('text-anchor', 'middle');
            tspan.setAttribute('dominant-baseline', 'central');

            if (idx === 0) {
              const y = startY + titleFontSize / 2;
              tspan.setAttribute('y', String(y));
              tspan.setAttribute('font-size', `${titleFontSize}px`);
              tspan.setAttribute('font-weight', '600');
              tspan.setAttribute('class', 'node-title');
            } else {
              const y = startY + titleFontSize + gap + (idx - 1) * descLineHeight + descLineHeight / 2;
              tspan.setAttribute('y', String(y));
              tspan.setAttribute('font-size', `${descFontSize}px`);
              tspan.setAttribute('font-weight', '400');
              tspan.setAttribute('opacity', '0.92');
              tspan.setAttribute('class', 'node-desc');
            }
            tspan.textContent = line;
            textEl.appendChild(tspan);
          });
        }
      }

      // Expand edge label background rect centered at (cx, cy) if present
      if (isEdgeLabel && lines.length > 1) {
        const bkgRect = (fo.parentElement?.querySelector('rect.labelBkg, rect.background, rect') ||
          fo.closest('.edgeLabel')?.querySelector('rect.labelBkg, rect.background, rect')) as SVGRectElement | null;
        if (bkgRect) {
          const maxLineWidth = Math.max(...lines.map((l) => l.length * 6.8));
          const origWidth = parseFloat(bkgRect.getAttribute('width') || '0') || 0;
          const origHeight = parseFloat(bkgRect.getAttribute('height') || '0') || 0;
          const neededWidth = maxLineWidth + 16;
          const neededHeight = lines.length * 14 + 10;

          if (neededWidth > origWidth) {
            bkgRect.setAttribute('width', String(Math.ceil(neededWidth)));
            bkgRect.setAttribute('x', String(Math.round(cx - neededWidth / 2)));
          }
          if (neededHeight > origHeight) {
            bkgRect.setAttribute('height', String(Math.ceil(neededHeight)));
            bkgRect.setAttribute('y', String(Math.round(cy - neededHeight / 2)));
          }
        }
      }

      // Exact coordinate alignment:
      // If in a node group where rect is a direct child of nodeGroup:
      if (nodeGroup && rect && (rect.parentNode === (nodeGroup as Node))) {
        nodeGroup.appendChild(textEl);
        if (labelG) labelG.remove();
        else fo.remove();
      } else if (labelG) {
        // In edge labels or when rect is inside labelG:
        labelG.insertBefore(textEl, fo);
        fo.remove();
      } else if (fo.parentElement) {
        fo.parentElement.insertBefore(textEl, fo);
        fo.remove();
      }
    } catch (err) {
      console.warn('Failed to convert foreignObject to SVG text:', err);
      fo.remove();
    }
  }

  // Also sanitize any native SVG <text> elements that contain <BR> or <br/>
  sanitizeSvgTextElements(svg);
}

/**
 * Sanitizes any native SVG <text> elements that contain unparsed HTML break tags (<BR>).
 */
function sanitizeSvgTextElements(svg: SVGSVGElement): void {
  const textEls = Array.from(svg.querySelectorAll('text'));
  for (const textEl of textEls) {
    if (textEl.querySelector('tspan')) continue;
    const raw = textEl.textContent || '';
    if (!/<br\s*\/?>|&lt;br\s*\/?&gt;|\n/i.test(raw)) continue;

    const lines = extractLinesFromHtmlOrText(raw);
    if (lines.length <= 1) continue;

    const x = parseFloat(textEl.getAttribute('x') || '0') || 0;
    const y = parseFloat(textEl.getAttribute('y') || '0') || 0;
    const fontSize = parseFloat(textEl.getAttribute('font-size') || '11') || 11;
    const lineSpacing = fontSize * 1.35;
    const totalHeight = (lines.length - 1) * lineSpacing;

    textEl.textContent = '';
    lines.forEach((line, idx) => {
      const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      tspan.setAttribute('x', String(x));
      tspan.setAttribute('y', String(y - totalHeight / 2 + idx * lineSpacing));
      tspan.setAttribute('text-anchor', textEl.getAttribute('text-anchor') || 'middle');
      tspan.setAttribute('dominant-baseline', textEl.getAttribute('dominant-baseline') || 'central');
      tspan.textContent = line;
      textEl.appendChild(tspan);
    });
  }
}

interface NoteSvgPlacement {
  targetId: string;
  targetAnchor: { x: number; y: number };
  noteBox: { x: number; y: number; width: number; height: number };
  cardCenter: { x: number; y: number };
  noteText: string;
  label: string;
  connectorColor: string;
  cardBg: string;
  cardBorder: string;
  cardBorderWidth: string;
  cardColor: string;
  lines: string[];
}

/**
 * Computes exact SVG-space coordinates for all notes in the diagram.
 * Reconciles live DOM offsets, zoom factor, and diagram viewBox coordinates.
 */
function computeNotePlacements(
  sourceSvg: SVGSVGElement,
  notes: DiagramNotes,
  background: ExportBackground
): NoteSvgPlacement[] {
  const placements: NoteSvgPlacement[] = [];
  const allNoteIds = [
    ...Object.keys(notes.nodes || {}),
    ...Object.keys(notes.edges || {}),
  ];

  const wrapperEl =
    sourceSvg.closest('#mermaid-svg-wrapper') ||
    document.getElementById('mermaid-svg-wrapper');
  const wRect = wrapperEl?.getBoundingClientRect();
  const sCTM = typeof sourceSvg.getScreenCTM === 'function' ? sourceSvg.getScreenCTM() : null;
  const sInv = sCTM ? sCTM.inverse() : null;
  const zoom =
    wrapperEl && (wrapperEl as HTMLElement).offsetWidth > 0 && wRect
      ? wRect.width / (wrapperEl as HTMLElement).offsetWidth
      : 1;

  for (const targetId of allNoteIds) {
    const cleanId = cleanNodeId(targetId);
    const noteText =
      (notes.nodes && (notes.nodes[cleanId] || notes.nodes[targetId])) ||
      (notes.edges && (notes.edges[targetId] || notes.edges[cleanId]));
    if (!noteText || !noteText.trim()) continue;

    const pos = notes.positions && (notes.positions[cleanId] || notes.positions[targetId]);

    // 1. Locate target element in sourceSvg
    const isEdge = targetId.includes('->') || (notes.edges && Boolean(notes.edges[targetId]));
    let nodeEl: SVGGraphicsElement | null = null;
    let edgeEl: SVGGraphicsElement | null = null;

    if (!isEdge) {
      nodeEl =
        sourceSvg.querySelector(`g.node[data-state-id="${cleanId}"]`) ||
        sourceSvg.querySelector(`g.node[data-state-id="${targetId}"]`) ||
        sourceSvg.querySelector(`g.node[id="${cleanId}"]`) ||
        sourceSvg.querySelector(`g.node[id="${targetId}"]`) ||
        sourceSvg.querySelector(`g.node[id*="${cleanId}"]`) ||
        findNodeElement(sourceSvg, cleanId) ||
        null;
    } else {
      // For edge notes, anchor adjacent to the transition's target node (to), matching canvas & mermaid.live
      const edgeParts = targetId.split('#')[0].split('->');
      if (edgeParts.length === 2) {
        const toNodeId = edgeParts[1].trim();
        const toClean = cleanNodeId(toNodeId);
        nodeEl =
          sourceSvg.querySelector(`g.node[data-state-id="${toClean}"]`) ||
          sourceSvg.querySelector(`g.node[data-state-id="${toNodeId}"]`) ||
          sourceSvg.querySelector(`g.node[id="${toClean}"]`) ||
          sourceSvg.querySelector(`g.node[id="${toNodeId}"]`) ||
          findNodeElement(sourceSvg, toClean) ||
          findNodeElement(sourceSvg, toNodeId) ||
          null;
      }
    }

    if (!nodeEl) {
      edgeEl = findEdgePathElement(sourceSvg, targetId);
    }

    const targetEl = nodeEl || edgeEl;

    // 2. Find target anchor in SVG viewBox coordinates
    let targetSvgX = 150;
    let targetSvgY = 150;
    let targetSvgW = 40;
    let targetSvgH = 20;
    let foundAnchor = false;

    // If it's an edge path, compute anchor along the path midpoint directly
    if (edgeEl && edgeEl.tagName.toLowerCase() === 'path') {
      try {
        const pathEl = edgeEl as SVGPathElement;
        const pathLen = pathEl.getTotalLength();
        if (pathLen > 0) {
          const midPt = pathEl.getPointAtLength(pathLen / 2);
          const ctm = pathEl.getScreenCTM();
          if (ctm && sInv) {
            const screenX = midPt.x * ctm.a + midPt.y * ctm.c + ctm.e;
            const screenY = midPt.x * ctm.b + midPt.y * ctm.d + ctm.f;
            const pt = sourceSvg.createSVGPoint();
            pt.x = screenX;
            pt.y = screenY;
            const mapped = pt.matrixTransform(sInv);
            if (isFinite(mapped.x) && isFinite(mapped.y)) {
              targetSvgX = Math.round(mapped.x);
              targetSvgY = Math.round(mapped.y);
              targetSvgW = 30;
              targetSvgH = 20;
              foundAnchor = true;
            }
          }
        }
      } catch {
        // fallback
      }
    }

    if (!foundAnchor && targetEl && sInv) {
      try {
        const elRect = targetEl.getBoundingClientRect();
        if (elRect.width > 0 && elRect.height > 0) {
          const ptCenter = sourceSvg.createSVGPoint();
          ptCenter.x = elRect.left + elRect.width / 2;
          ptCenter.y = elRect.top + elRect.height / 2;
          const mappedCenter = ptCenter.matrixTransform(sInv);

          const ptW = sourceSvg.createSVGPoint();
          ptW.x = elRect.left + elRect.width;
          ptW.y = elRect.top + elRect.height;
          const mappedW = ptW.matrixTransform(sInv);

          if (!isNaN(mappedCenter.x) && !isNaN(mappedCenter.y) && isFinite(mappedCenter.x) && isFinite(mappedCenter.y)) {
            targetSvgX = Math.round(mappedCenter.x);
            targetSvgY = Math.round(mappedCenter.y);
            targetSvgW = Math.max(20, Math.abs(mappedW.x - mappedCenter.x) * 2);
            targetSvgH = Math.max(20, Math.abs(mappedW.y - mappedCenter.y) * 2);
            foundAnchor = true;
          }
        }
      } catch {
        // fallback
      }
    }

    if (!foundAnchor && targetEl) {
      try {
        let tx = 0;
        let ty = 0;
        let curr: Element | null = targetEl;
        while (curr && curr !== sourceSvg) {
          const tf = curr.getAttribute('transform') || '';
          if (tf) {
            const match = /translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/i.exec(tf);
            if (match) {
              tx += parseFloat(match[1]) || 0;
              ty += parseFloat(match[2]) || 0;
            }
          }
          curr = curr.parentElement;
        }

        if (edgeEl && edgeEl.tagName.toLowerCase() === 'path') {
          const pathEl = edgeEl as SVGPathElement;
          const pathLen = pathEl.getTotalLength();
          if (pathLen > 0) {
            const midPt = pathEl.getPointAtLength(pathLen / 2);
            targetSvgX = Math.round(tx + midPt.x);
            targetSvgY = Math.round(ty + midPt.y);
            targetSvgW = 30;
            targetSvgH = 20;
            foundAnchor = true;
          }
        }

        if (!foundAnchor) {
          const bbox = (targetEl as any).getBBox?.();
          if (bbox && bbox.width > 0) {
            targetSvgX = Math.round(tx + bbox.x + bbox.width / 2);
            targetSvgY = Math.round(ty + bbox.y + bbox.height / 2);
            targetSvgW = bbox.width;
            targetSvgH = bbox.height;
            foundAnchor = true;
          } else {
            targetSvgX = Math.round(tx);
            targetSvgY = Math.round(ty);
            foundAnchor = true;
          }
        }
      } catch {
        // keep defaults
      }
    }

    // 3. Compute note card dimensions (proportional 11px font size, clean padding)
    const noteW = 150;
    const lines = wrapText(noteText, 19);
    const paddingInternal = 8;
    const noteH = Math.max(32, lines.length * 15 + paddingInternal * 2);

    // 4. Compute note position in SVG coordinates
    let noteSvgX = Math.round(targetSvgX + targetSvgW / 2 + 22);
    let noteSvgY = Math.max(16, Math.round(targetSvgY - targetSvgH / 2 - 8));

    if (pos) {
      // Case A: If relative displacement deltaX / deltaY was recorded
      if (typeof pos.deltaX === 'number' && typeof pos.deltaY === 'number') {
        if (sInv && wrapperEl && wRect) {
          try {
            const pt0 = sourceSvg.createSVGPoint();
            pt0.x = 0;
            pt0.y = 0;
            const p0 = pt0.matrixTransform(sInv);

            const ptD = sourceSvg.createSVGPoint();
            ptD.x = pos.deltaX * zoom;
            ptD.y = pos.deltaY * zoom;
            const pD = ptD.matrixTransform(sInv);

            noteSvgX = Math.round(targetSvgX + (pD.x - p0.x));
            noteSvgY = Math.round(targetSvgY + (pD.y - p0.y));
          } catch {
            noteSvgX = Math.round(targetSvgX + pos.deltaX);
            noteSvgY = Math.round(targetSvgY + pos.deltaY);
          }
        } else {
          noteSvgX = Math.round(targetSvgX + pos.deltaX);
          noteSvgY = Math.round(targetSvgY + pos.deltaY);
        }
      }
      // Case B: If wrapper-space coordinates pos.x, pos.y were recorded
      else if (typeof pos.x === 'number' && typeof pos.y === 'number') {
        if (sInv && wrapperEl && wRect) {
          try {
            const screenX = wRect.left + pos.x * zoom;
            const screenY = wRect.top + pos.y * zoom;

            const pt = sourceSvg.createSVGPoint();
            pt.x = screenX;
            pt.y = screenY;
            const svgPt = pt.matrixTransform(sInv);

            if (!isNaN(svgPt.x) && !isNaN(svgPt.y) && isFinite(svgPt.x) && isFinite(svgPt.y)) {
              noteSvgX = Math.round(svgPt.x);
              noteSvgY = Math.round(svgPt.y);
            }
          } catch {
            noteSvgX = pos.x;
            noteSvgY = pos.y;
          }
        } else {
          noteSvgX = pos.x;
          noteSvgY = pos.y;
        }
      }
    }

    // 5. Note styles from notes.styles, preserving custom background and text colors
    const customStyle =
      notes.styles?.[targetId] ||
      notes.styles?.[cleanId] ||
      (targetId.includes('->') ? notes.styles?.[targetId.replace(/\s+/g, '')] : null) ||
      (targetId.startsWith('edge-') ? notes.styles?.[targetId.replace(/^edge-/, '')] : null) ||
      notes.styles?.[`edge-${targetId}`];

    // Default note styling matches interactive UI (Amber Sticky: #fffbeb fill, #78350f text, #f59e0b stroke)
    const cardBg = customStyle?.fill || '#fffbeb';
    const cardColor = customStyle?.color || '#78350f';
    const cardBorder = customStyle?.stroke || '#f59e0b';
    const cardBorderWidth = customStyle?.strokeWidth
      ? String(customStyle.strokeWidth).replace('px', '')
      : '1.5';
    const connectorColor = customStyle?.stroke || cardBorder;

    const cardCenterX = noteSvgX + noteW / 2;
    const cardCenterY = noteSvgY + noteH / 2;

    placements.push({
      targetId,
      targetAnchor: { x: targetSvgX, y: targetSvgY },
      noteBox: { x: noteSvgX, y: noteSvgY, width: noteW, height: noteH },
      cardCenter: { x: cardCenterX, y: cardCenterY },
      noteText,
      label: '',
      connectorColor,
      cardBg,
      cardBorder,
      cardBorderWidth,
      cardColor,
      lines,
    });
  }

  return placements;
}

/**
 * Prepares a clean, standalone SVG element suitable for high-resolution vector export or rasterization.
 * Inlines necessary styles, embeds fonts, handles background fills, and ensures bounds with padding.
 */
export function prepareStandaloneSvg(
  sourceSvg: SVGSVGElement,
  options: DiagramExportOptions = {}
): {
  svgElement: SVGSVGElement;
  svgString: string;
  width: number;
  height: number;
  viewBox: string;
} {
  const scale = options.scale ?? 2;
  const background = options.background ?? 'dark';
  const padding = options.padding ?? 32;
  const bgColor = BG_COLORS[background];

  // 1. Clone the SVG element so live DOM is untouched
  const svg = sourceSvg.cloneNode(true) as SVGSVGElement;

  // 2. Remove interactive UI markers and selection classes
  svg.querySelectorAll(
    '.diagram-selected-node, .diagram-selected-edge, .diagram-selected-edge-label, .selected-edge, .dragging-state-node, .diagram-match-node, .diagram-match-edge, .diagram-match-path'
  ).forEach((el) => {
    el.classList.remove(
      'diagram-selected-node',
      'diagram-selected-edge',
      'diagram-selected-edge-label',
      'selected-edge',
      'dragging-state-node',
      'diagram-match-node',
      'diagram-match-edge',
      'diagram-match-path'
    );
  });

  // 3. Determine natural coordinate boundaries
  let minX = 0;
  let minY = 0;
  let baseWidth = 800;
  let baseHeight = 600;

  const origViewBox = sourceSvg.getAttribute('viewBox');
  if (origViewBox) {
    const parts = origViewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && !parts.some(isNaN)) {
      [minX, minY, baseWidth, baseHeight] = parts;
    }
  } else {
    try {
      const bbox = sourceSvg.getBBox();
      if (bbox && bbox.width > 0 && bbox.height > 0) {
        minX = bbox.x;
        minY = bbox.y;
        baseWidth = bbox.width;
        baseHeight = bbox.height;
      }
    } catch {
      baseWidth = parseFloat(sourceSvg.getAttribute('width') || '800') || 800;
      baseHeight = parseFloat(sourceSvg.getAttribute('height') || '600') || 600;
    }
  }

  // Ensure positive dimensions
  baseWidth = Math.max(100, baseWidth);
  baseHeight = Math.max(100, baseHeight);

  // 4. Compute note placements and expand bounding box to include all notes and connectors
  const notePlacements = options.notes
    ? computeNotePlacements(sourceSvg, options.notes, background)
    : [];

  let contentMinX = minX;
  let contentMinY = minY;
  let contentMaxX = minX + baseWidth;
  let contentMaxY = minY + baseHeight;

  for (const note of notePlacements) {
    contentMinX = Math.min(contentMinX, note.noteBox.x, note.targetAnchor.x - 8);
    contentMinY = Math.min(contentMinY, note.noteBox.y, note.targetAnchor.y - 8);
    contentMaxX = Math.max(contentMaxX, note.noteBox.x + note.noteBox.width, note.targetAnchor.x + 8);
    contentMaxY = Math.max(contentMaxY, note.noteBox.y + note.noteBox.height, note.targetAnchor.y + 8);
  }

  const finalWidth = Math.max(100, contentMaxX - contentMinX);
  const finalHeight = Math.max(100, contentMaxY - contentMinY);

  // 5. Apply padding around content
  const exportMinX = Math.round(contentMinX - padding);
  const exportMinY = Math.round(contentMinY - padding);
  const exportWidth = Math.round(finalWidth + padding * 2);
  const exportHeight = Math.round(finalHeight + padding * 2);

  const viewBoxStr = `${exportMinX} ${exportMinY} ${exportWidth} ${exportHeight}`;
  svg.setAttribute('viewBox', viewBoxStr);
  svg.setAttribute('width', `${exportWidth * scale}`);
  svg.setAttribute('height', `${exportHeight * scale}`);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  svg.removeAttribute('style');

  const textColor = background === 'white' ? '#0f172a' : '#f8fafc';
  const labelColor = background === 'white' ? '#1e293b' : '#e2e8f0';

  // 6. Sanitize any foreignObjects to pure SVG <text> elements
  sanitizeForeignObjects(svg, textColor, labelColor);

  // 7. Embed standalone styles and drop-shadow filter in <defs>
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }

  // Add shadow filter for notes using SVG namespace and proper casing
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', 'diagram-note-shadow');
  filter.setAttribute('x', '-20%');
  filter.setAttribute('y', '-20%');
  filter.setAttribute('width', '140%');
  filter.setAttribute('height', '140%');
  const feDrop = document.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
  feDrop.setAttribute('dx', '0');
  feDrop.setAttribute('dy', '2');
  feDrop.setAttribute('stdDeviation', '2');
  feDrop.setAttribute('flood-color', '#000000');
  feDrop.setAttribute('flood-opacity', '0.25');
  filter.appendChild(feDrop);
  defs.appendChild(filter);

  const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  styleEl.textContent = `
    svg {
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      text-rendering: geometricPrecision;
      shape-rendering: geometricPrecision;
      image-rendering: high-quality;
    }
    text {
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    .node text {
      fill: ${textColor};
    }
    .node text .node-title, tspan.node-title {
      font-size: 13.5px;
      font-weight: 600;
      fill: ${textColor};
    }
    .node text .node-desc, tspan.node-desc {
      font-size: 12px;
      font-weight: 400;
      fill: ${textColor};
      opacity: 0.92;
    }
    .edgeLabel text {
      font-size: 11px;
      font-weight: 500;
      fill: ${labelColor} !important;
    }
    .tc-priority-badge {
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-weight: 700;
      user-select: none;
    }
    .diagram-note-box {
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    .diagram-note-card-bg {
      shape-rendering: geometricPrecision;
    }
    .diagram-note-cards text {
      text-rendering: geometricPrecision;
    }
  `;
  defs.appendChild(styleEl);

  // 8. Embed Notes as vector SVG group (rendered without dashed-line connectors)
  if (notePlacements.length > 0) {
    const notesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    notesGroup.setAttribute('id', 'exported-diagram-notes');
    notesGroup.setAttribute('class', 'diagram-notes-layer');

    // 8. Render note cards
    const cardsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    cardsGroup.setAttribute('class', 'diagram-note-cards');

    for (const note of notePlacements) {
      const gCard = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      gCard.setAttribute('class', 'diagram-note-item');
      gCard.setAttribute('data-note-id', note.targetId);

      // Subtle vector drop shadow underneath card (100% compatible across all SVG viewers)
      const shadowRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      shadowRect.setAttribute('x', `${note.noteBox.x}`);
      shadowRect.setAttribute('y', `${note.noteBox.y + 2}`);
      shadowRect.setAttribute('width', `${note.noteBox.width}`);
      shadowRect.setAttribute('height', `${note.noteBox.height}`);
      shadowRect.setAttribute('rx', '8');
      shadowRect.setAttribute('ry', '8');
      shadowRect.setAttribute('fill', '#000000');
      shadowRect.setAttribute('fill-opacity', '0.15');
      gCard.appendChild(shadowRect);

      // Card body rect with explicit fill, stroke, and inline style for 100% rendering immunity
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('class', 'diagram-note-card-bg');
      rect.setAttribute('x', `${note.noteBox.x}`);
      rect.setAttribute('y', `${note.noteBox.y}`);
      rect.setAttribute('width', `${note.noteBox.width}`);
      rect.setAttribute('height', `${note.noteBox.height}`);
      rect.setAttribute('rx', '8');
      rect.setAttribute('ry', '8');
      rect.setAttribute('fill', note.cardBg);
      rect.setAttribute('stroke', note.cardBorder);
      rect.setAttribute('stroke-width', note.cardBorderWidth);
      rect.setAttribute('style', `fill: ${note.cardBg} !important; stroke: ${note.cardBorder} !important; stroke-width: ${note.cardBorderWidth} !important;`);
      gCard.appendChild(rect);

      // Note text lines (proportional 11px font size matching in-canvas notes)
      const contentText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      contentText.setAttribute('x', `${note.noteBox.x + 10}`);
      contentText.setAttribute('y', `${note.noteBox.y + 17}`);
      contentText.setAttribute('fill', note.cardColor);
      contentText.setAttribute('font-size', '11px');
      contentText.setAttribute('font-weight', '500');
      contentText.setAttribute('font-family', 'ui-sans-serif, system-ui, -apple-system, sans-serif');

      note.lines.forEach((line, idx) => {
        const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tspan.setAttribute('x', `${note.noteBox.x + 10}`);
        if (idx > 0) {
          tspan.setAttribute('dy', '14.5');
        }
        tspan.textContent = line;
        contentText.appendChild(tspan);
      });

      gCard.appendChild(contentText);
      cardsGroup.appendChild(gCard);
    }
    notesGroup.appendChild(cardsGroup);

    svg.appendChild(notesGroup);
  }

  // 9. Inject solid background rect if background is not transparent
  if (bgColor && bgColor !== 'none') {
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', `${exportMinX}`);
    bgRect.setAttribute('y', `${exportMinY}`);
    bgRect.setAttribute('width', `${exportWidth}`);
    bgRect.setAttribute('height', `${exportHeight}`);
    bgRect.setAttribute('fill', bgColor);
    svg.insertBefore(bgRect, svg.firstChild);
  }

  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(svg);

  // Prepend standard XML declaration for standalone vector files (no external DTD)
  if (!svgString.startsWith('<?xml')) {
    svgString = `<?xml version="1.0" encoding="UTF-8"?>\n${svgString}`;
  }

  return {
    svgElement: svg,
    svgString,
    width: exportWidth * scale,
    height: exportHeight * scale,
    viewBox: viewBoxStr,
  };
}

/**
 * Splits text into lines for SVG text rendering.
 */
function wrapText(text: string, maxCharsPerLine = 24): string[] {
  if (!text) return [];
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let currentLine = '';
    for (const word of words) {
      if ((currentLine + (currentLine ? ' ' : '') + word).length <= maxCharsPerLine) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [text];
}

/**
 * Converts a data URL into a Blob without relying on window.fetch.
 */
function dataURLtoBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const byteString = atob(parts[1]);
  const mimeString = parts[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}

/**
 * Robustly loads an SVG string into an HTMLImageElement using multiple fallback strategies.
 */
async function loadSvgToImage(svgString: string): Promise<HTMLImageElement> {
  // Strip XML declaration for data URI / image loader compatibility
  const cleanSvg = svgString.replace(/<\?xml[\s\S]*?\?>/gi, '').trim();

  const loadImageFromSrc = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      let settled = false;

      img.onload = () => {
        if (!settled) {
          settled = true;
          resolve(img);
        }
      };

      img.onerror = (err) => {
        if (!settled) {
          settled = true;
          reject(new Error(`Failed to render SVG onto raster surface: ${String(err)}`));
        }
      };

      // Timeout safety (5s)
      setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Raster image rendering timed out'));
        }
      }, 5000);

      img.src = src;
    });
  };

  // Strategy 1: Data URL with URL-encoding (standard, immune to CORS and iframe sandbox restrictions)
  const encodedDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleanSvg)}`;
  try {
    return await loadImageFromSrc(encodedDataUrl);
  } catch (err1) {
    console.warn('Strategy 1 (URI-encoded Data URL) failed, trying Base64:', err1);

    // Strategy 2: Base64 Data URL fallback
    try {
      const base64 = btoa(unescape(encodeURIComponent(cleanSvg)));
      const base64Url = `data:image/svg+xml;base64,${base64}`;
      return await loadImageFromSrc(base64Url);
    } catch (err2) {
      console.warn('Strategy 2 (Base64 Data URL) failed, trying Blob URL:', err2);

      // Strategy 3: Blob URL fallback
      const blob = new Blob([cleanSvg], { type: 'image/svg+xml;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      try {
        const img = await loadImageFromSrc(blobUrl);
        URL.revokeObjectURL(blobUrl);
        return img;
      } catch (err3) {
        URL.revokeObjectURL(blobUrl);
        throw new Error('All SVG raster image loading strategies failed.');
      }
    }
  }
}

/**
 * Exports diagram as a high-resolution standalone SVG vector file.
 */
export async function exportHighResSvg(
  sourceSvg: SVGSVGElement,
  options: DiagramExportOptions = {}
): Promise<ExportResult> {
  const { svgString, width, height } = prepareStandaloneSvg(sourceSvg, options);
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const baseName = options.fileName || 'statechart';
  const scaleTag = options.scale && options.scale > 1 ? `@${options.scale}x` : '';
  const fileName = `${baseName}${scaleTag}.svg`;

  return {
    blob,
    width,
    height,
    fileName,
  };
}

/**
 * Exports diagram as a high-resolution raster PNG image.
 * Uses an off-screen HTML5 Canvas with sub-pixel interpolation and optional multiplier scaling (1x, 2x, 3x, 4x).
 */
export async function exportHighResPng(
  sourceSvg: SVGSVGElement,
  options: DiagramExportOptions = {}
): Promise<ExportResult> {
  const { svgString, width, height } = prepareStandaloneSvg(sourceSvg, options);
  const background = options.background ?? 'dark';
  const bgColor = BG_COLORS[background];

  // Clamp maximum dimensions to 8192px to prevent browser canvas memory limits
  const MAX_DIM = 8192;
  let targetWidth = Math.max(100, Math.round(width));
  let targetHeight = Math.max(100, Math.round(height));

  if (targetWidth > MAX_DIM || targetHeight > MAX_DIM) {
    const ratio = Math.min(MAX_DIM / targetWidth, MAX_DIM / targetHeight);
    targetWidth = Math.round(targetWidth * ratio);
    targetHeight = Math.round(targetHeight * ratio);
  }

  const img = await loadSvgToImage(svgString);

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas context for PNG export.');
  }

  // High quality interpolation
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Fill background
  if (bgColor && bgColor !== 'none') {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, targetWidth, targetHeight);
  } else {
    ctx.clearRect(0, 0, targetWidth, targetHeight);
  }

  // Draw rendered SVG image
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // Convert canvas to Blob with multi-tier fallback
  const blob = await new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob(
        (b) => {
          if (b) {
            resolve(b);
          } else {
            try {
              const dataUrl = canvas.toDataURL('image/png');
              resolve(dataURLtoBlob(dataUrl));
            } catch (e) {
              reject(new Error('Failed to encode raster canvas to PNG blob.'));
            }
          }
        },
        'image/png',
        1.0
      );
    } catch (toBlobErr) {
      try {
        const dataUrl = canvas.toDataURL('image/png');
        resolve(dataURLtoBlob(dataUrl));
      } catch (dataUrlErr) {
        reject(
          new Error(
            `Canvas export failed: ${toBlobErr instanceof Error ? toBlobErr.message : String(toBlobErr)}`
          )
        );
      }
    }
  });

  const baseName = options.fileName || 'statechart';
  const scaleTag = options.scale && options.scale > 1 ? `@${options.scale}x` : '';
  const fileName = `${baseName}${scaleTag}.png`;
  let dataUrl: string | undefined;
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch {
    // optional dataUrl
  }

  return {
    blob,
    dataUrl,
    width: targetWidth,
    height: targetHeight,
    fileName,
  };
}

/**
 * Reliably copies text to clipboard across all browser contexts, including iframes
 * where document focus or navigator.clipboard may be restricted.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // Try bringing window focus to ensure clipboard permission can succeed
  try {
    window.focus();
  } catch {
    // ignore
  }

  // 1. Try modern navigator.clipboard.writeText if available and document has focus
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('navigator.clipboard.writeText failed (e.g. document not focused), attempting execCommand fallback:', err);
    }
  }

  // 2. Robust document.execCommand('copy') fallback (works even when document.hasFocus() is false in iframes)
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    textArea.style.opacity = '0';
    textArea.setAttribute('readonly', '');
    document.body.appendChild(textArea);
    textArea.focus({ preventScroll: true });
    textArea.select();
    textArea.setSelectionRange(0, textArea.value.length);
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    if (successful) {
      return true;
    }
  } catch (fallbackErr) {
    console.warn('document.execCommand fallback failed:', fallbackErr);
  }

  return false;
}

/**
 * Copies high-resolution SVG text or PNG image blob directly to user's system clipboard.
 */
export async function copyToClipboard(
  sourceSvg: SVGSVGElement,
  options: DiagramExportOptions = {}
): Promise<{ success: boolean; format: ExportFormat; message?: string }> {
  const format = options.format || 'png';

  // Ensure window is focused so browser doesn't block clipboard
  try {
    window.focus();
  } catch {
    // ignore
  }

  if (format === 'svg') {
    const { svgString } = prepareStandaloneSvg(sourceSvg, options);
    const textCopied = await copyTextToClipboard(svgString);
    if (textCopied) {
      return { success: true, format: 'svg', message: 'Copied SVG vector to clipboard' };
    }
    // If copying was blocked by iframe permissions, download SVG as fallback
    const { blob } = await exportHighResSvg(sourceSvg, options);
    const fileName = `${options.fileName || 'statechart'}.svg`;
    triggerDownload(blob, fileName);
    return {
      success: true,
      format: 'svg',
      message: 'Clipboard access restricted in preview; downloaded SVG vector file.',
    };
  } else {
    // PNG
    const pngResult = await exportHighResPng(sourceSvg, options);

    // Attempt 1: Modern navigator.clipboard.write([ClipboardItem])
    if (
      typeof ClipboardItem !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.write === 'function'
    ) {
      try {
        const item = new ClipboardItem({ 'image/png': pngResult.blob });
        await navigator.clipboard.write([item]);
        return { success: true, format: 'png', message: 'Copied PNG to clipboard' };
      } catch (err) {
        console.warn('Direct ClipboardItem write failed, attempting text/data fallback:', err);
      }
    }

    // Attempt 2: If image clipboard is restricted or document focus prevents binary write,
    // copy the SVG vector text via robust text copy
    const { svgString } = prepareStandaloneSvg(sourceSvg, options);
    const textCopied = await copyTextToClipboard(svgString);
    if (textCopied) {
      return {
        success: true,
        format: 'svg',
        message: 'Image clipboard restricted in preview; copied SVG vector markup instead.',
      };
    }

    // Attempt 3: If iframe sandbox completely blocks clipboard write, download the generated PNG
    triggerDownload(pngResult.blob, pngResult.fileName);
    return {
      success: true,
      format: 'png',
      message: 'Clipboard blocked by preview container; downloaded high-res PNG instead.',
    };
  }
}

/**
 * Triggers browser download for a generated Blob.
 */
export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
