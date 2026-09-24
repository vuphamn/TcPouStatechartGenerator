import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Map,
  X,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Crosshair,
  Maximize2,
  Navigation,
} from 'lucide-react';
import { CanvasNodePositionsMap } from '../utils/canvasPositions.ts';

export interface DiagramBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface DiagramMinimapProps {
  svgElement: SVGSVGElement | null;
  containerElement: HTMLDivElement | null;
  pan: { x: number; y: number };
  zoom: number;
  onPanChange: (newPan: { x: number; y: number }) => void;
  onResetZoom: () => void;
  selectedStateId?: string | null;
  selectedStateLabel?: string;
  availableStatesCount?: number;
  canvasPositions?: CanvasNodePositionsMap;
  onSelectState?: (stateId: string) => void;
  isOpen?: boolean;
  onClose?: () => void;
  theme?: string;
}

/**
 * Extracts natural diagram coordinate bounds from SVG viewBox or getBBox.
 */
function getSvgBounds(svg: SVGSVGElement | null): DiagramBounds | null {
  if (!svg) return null;

  const origViewBox = svg.getAttribute('viewBox');
  if (origViewBox) {
    const parts = origViewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && !parts.some(isNaN) && parts[2] > 0 && parts[3] > 0) {
      return {
        minX: parts[0],
        minY: parts[1],
        width: parts[2],
        height: parts[3],
      };
    }
  }

  try {
    const bbox = svg.getBBox();
    if (bbox && bbox.width > 0 && bbox.height > 0) {
      return {
        minX: bbox.x,
        minY: bbox.y,
        width: bbox.width,
        height: bbox.height,
      };
    }
  } catch {
    // Ignore error if getBBox is unavailable
  }

  const w = parseFloat(svg.getAttribute('width') || '800') || 800;
  const h = parseFloat(svg.getAttribute('height') || '600') || 600;
  if (w > 0 && h > 0) {
    return { minX: 0, minY: 0, width: w, height: h };
  }

  return null;
}

export const DiagramMinimap: React.FC<DiagramMinimapProps> = ({
  svgElement,
  containerElement,
  pan,
  zoom,
  onPanChange,
  onResetZoom,
  selectedStateId,
  selectedStateLabel,
  availableStatesCount = 0,
  canvasPositions = {},
  onSelectState,
  isOpen = true,
  onClose,
  theme = 'dark',
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const hasMovedRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; initialPan: { x: number; y: number } }>({
    clientX: 0,
    clientY: 0,
    initialPan: { x: 0, y: 0 },
  });

  const minimapBodyRef = useRef<HTMLDivElement>(null);
  const clonedSvgContainerRef = useRef<HTMLDivElement>(null);

  // Compute diagram bounds
  const diagramBounds = useMemo(() => {
    return getSvgBounds(svgElement);
  }, [svgElement]);

  // Clone main SVG content into minimap when svgElement or its contents change
  useEffect(() => {
    if (!svgElement || !clonedSvgContainerRef.current) return;

    try {
      const cloned = svgElement.cloneNode(true) as SVGSVGElement;
      const origId = svgElement.id || 'mermaid-diagram';
      const miniId = `${origId}-minimap`;
      cloned.id = miniId;

      // Scope embedded stylesheets to cloned SVG id
      const styles = cloned.querySelectorAll('style');
      styles.forEach((s) => {
        if (s.textContent && origId) {
          s.textContent = s.textContent.replaceAll(`#${origId}`, `#${miniId}`);
        }
      });

      cloned.removeAttribute('style');
      cloned.setAttribute('width', '100%');
      cloned.setAttribute('height', '100%');
      cloned.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      cloned.style.pointerEvents = 'none';
      cloned.style.display = 'block';

      // Enhance stroke widths slightly so thumbnail is crisp and high-contrast
      const paths = cloned.querySelectorAll<SVGPathElement>('.edgePath path, path.tc-edge-path');
      paths.forEach((p) => {
        p.style.setProperty('stroke-width', '2.5px', 'important');
        p.style.setProperty('opacity', '0.85', 'important');
      });

      const nodeRects = cloned.querySelectorAll<SVGElement>('.node rect, .node polygon, .node circle');
      nodeRects.forEach((r) => {
        r.style.setProperty('stroke-width', '2px', 'important');
      });

      // Subdue text in minimap to avoid clutter
      const textEls = cloned.querySelectorAll<SVGTextElement>('text, .nodeLabel, .edgeLabel');
      textEls.forEach((t) => {
        t.style.setProperty('font-size', '8px', 'important');
        t.style.setProperty('opacity', '0.6', 'important');
      });

      clonedSvgContainerRef.current.replaceChildren(cloned);
    } catch (err) {
      console.warn('Failed to clone SVG for minimap:', err);
    }
  }, [svgElement, canvasPositions]);

  // Calculate minimap container dimensions based on diagram aspect ratio
  const minimapDimensions = useMemo(() => {
    const defaultW = 240;
    const minH = 110;
    const maxH = 170;

    if (!diagramBounds || diagramBounds.width <= 0 || diagramBounds.height <= 0) {
      return { width: defaultW, height: 135 };
    }

    const aspect = diagramBounds.width / diagramBounds.height;
    let height = Math.round(defaultW / aspect);
    height = Math.max(minH, Math.min(maxH, height));

    return { width: defaultW, height };
  }, [diagramBounds]);

  // Geometry calculation for viewport rectangle & screen-to-minimap coordinate mapping
  const geometry = useMemo(() => {
    if (!svgElement || !containerElement || !diagramBounds) return null;

    const svgRect = svgElement.getBoundingClientRect();
    const containerRect = containerElement.getBoundingClientRect();

    if (svgRect.width <= 0 || svgRect.height <= 0 || containerRect.width <= 0 || containerRect.height <= 0) {
      return null;
    }

    const { minX, minY, width: bW, height: bH } = diagramBounds;

    // Determine SVG rendering letterbox scaling
    const svgContentRatio = bW / bH;
    const svgRectRatio = svgRect.width / svgRect.height;
    let contentScale: number;
    let contentOffsetScreenX: number;
    let contentOffsetScreenY: number;

    if (svgRectRatio > svgContentRatio) {
      // Letterbox on left/right
      contentScale = svgRect.height / bH;
      const renderedWidth = bW * contentScale;
      contentOffsetScreenX = svgRect.left + (svgRect.width - renderedWidth) / 2;
      contentOffsetScreenY = svgRect.top;
    } else {
      // Letterbox on top/bottom
      contentScale = svgRect.width / bW;
      const renderedHeight = bH * contentScale;
      contentOffsetScreenX = svgRect.left;
      contentOffsetScreenY = svgRect.top + (svgRect.height - renderedHeight) / 2;
    }

    // Minimap inner content scale and offsets
    const padding = 8;
    const availW = minimapDimensions.width - padding * 2;
    const availH = minimapDimensions.height - padding * 2;

    const miniScale = Math.min(availW / bW, availH / bH);
    const miniRenderedW = bW * miniScale;
    const miniRenderedH = bH * miniScale;
    const miniContentLeft = padding + (availW - miniRenderedW) / 2;
    const miniContentTop = padding + (availH - miniRenderedH) / 2;

    // Viewport rectangle in minimap pixels
    const scaleRatio = miniScale / contentScale;
    const rectX = miniContentLeft + (containerRect.left - contentOffsetScreenX) * scaleRatio;
    const rectY = miniContentTop + (containerRect.top - contentOffsetScreenY) * scaleRatio;
    const rectW = containerRect.width * scaleRatio;
    const rectH = containerRect.height * scaleRatio;

    return {
      bounds: diagramBounds,
      svgRect,
      containerRect,
      contentScale,
      contentOffsetScreenX,
      contentOffsetScreenY,
      miniScale,
      miniContentLeft,
      miniContentTop,
      scaleRatio,
      rect: {
        x: rectX,
        y: rectY,
        width: Math.max(12, rectW),
        height: Math.max(10, rectH),
      },
    };
  }, [svgElement, containerElement, diagramBounds, minimapDimensions, pan, zoom]);

  // Center canvas at specific SVG coordinate
  const centerCanvasAtSvgCoordinate = useCallback(
    (targetSvgX: number, targetSvgY: number) => {
      if (!geometry || !containerElement) return;

      const { containerRect, contentOffsetScreenX, contentOffsetScreenY, contentScale, bounds } = geometry;

      // Current screen position of target SVG point
      const currentScreenX = contentOffsetScreenX + (targetSvgX - bounds.minX) * contentScale;
      const currentScreenY = contentOffsetScreenY + (targetSvgY - bounds.minY) * contentScale;

      // Desired screen position (center of container)
      const targetScreenX = containerRect.left + containerRect.width / 2;
      const targetScreenY = containerRect.top + containerRect.height / 2;

      const deltaX = targetScreenX - currentScreenX;
      const deltaY = targetScreenY - currentScreenY;

      onPanChange({
        x: pan.x + deltaX,
        y: pan.y + deltaY,
      });
    },
    [geometry, containerElement, pan, onPanChange]
  );

  // Handle click on minimap: smoothly jump to clicked location or clicked node
  const handleMinimapClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (hasMovedRef.current) return;
      if (!geometry || !minimapBodyRef.current) return;

      const rect = minimapBodyRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const { miniContentLeft, miniContentTop, miniScale, bounds } = geometry;
      const targetSvgX = bounds.minX + (clickX - miniContentLeft) / miniScale;
      const targetSvgY = bounds.minY + (clickY - miniContentTop) / miniScale;

      // Check if user clicked near any state node
      if (onSelectState && canvasPositions) {
        let closestNodeId: string | null = null;
        let minDistance = 16 / miniScale; // within 16 minimap pixels

        for (const [id, pos] of Object.entries(canvasPositions)) {
          const dist = Math.hypot(pos.centerX - targetSvgX, pos.centerY - targetSvgY);
          if (dist < minDistance) {
            minDistance = dist;
            closestNodeId = id;
          }
        }

        if (closestNodeId) {
          onSelectState(closestNodeId);
          centerCanvasAtSvgCoordinate(canvasPositions[closestNodeId].centerX, canvasPositions[closestNodeId].centerY);
          return;
        }
      }

      centerCanvasAtSvgCoordinate(targetSvgX, targetSvgY);
    },
    [geometry, centerCanvasAtSvgCoordinate, onSelectState, canvasPositions]
  );

  // Handle start dragging viewport rectangle or dragging across minimap
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    hasMovedRef.current = false;
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      initialPan: { ...pan },
    };
  };

  // Window drag listeners for smooth real-time panning
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!geometry) return;

      const deltaClientX = e.clientX - dragStartRef.current.clientX;
      const deltaClientY = e.clientY - dragStartRef.current.clientY;

      if (Math.hypot(deltaClientX, deltaClientY) > 3) {
        hasMovedRef.current = true;
      }

      // Dragging minimap by 1px moves canvas by (contentScale / miniScale)
      const canvasPerMiniPixel = 1 / geometry.scaleRatio;

      const deltaCanvasX = -deltaClientX * canvasPerMiniPixel;
      const deltaCanvasY = -deltaClientY * canvasPerMiniPixel;

      onPanChange({
        x: dragStartRef.current.initialPan.x + deltaCanvasX,
        y: dragStartRef.current.initialPan.y + deltaCanvasY,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseup', handleMouseUp, { capture: true });
    window.addEventListener('pointerup', handleMouseUp, { capture: true });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp, { capture: true });
      window.removeEventListener('pointerup', handleMouseUp, { capture: true });
    };
  }, [isDragging, geometry, onPanChange]);

  // Selected state node coordinate on the minimap
  const selectedNodeMarker = useMemo(() => {
    if (!selectedStateId || !geometry || !canvasPositions[selectedStateId]) return null;

    const nodePos = canvasPositions[selectedStateId];
    const { miniContentLeft, miniContentTop, miniScale, bounds } = geometry;

    const x = miniContentLeft + (nodePos.centerX - bounds.minX) * miniScale;
    const y = miniContentTop + (nodePos.centerY - bounds.minY) * miniScale;

    return { x, y, label: selectedStateLabel || nodePos.label || selectedStateId };
  }, [selectedStateId, geometry, canvasPositions, selectedStateLabel]);

  if (!isOpen) {
    return null;
  }

  // If collapsed: show compact bottom-right floating pill
  if (isCollapsed) {
    return (
      <div
        id="diagram-minimap-collapsed"
        className="absolute bottom-4 right-4 z-30 select-none animate-in fade-in zoom-in-95 duration-150"
      >
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/95 hover:bg-slate-800 border border-slate-700/80 hover:border-sky-500/60 shadow-xl backdrop-blur-md text-xs font-medium text-slate-200 hover:text-white transition-all cursor-pointer group"
          title="Expand Diagram Minimap"
        >
          <Map className="w-3.5 h-3.5 text-sky-400 group-hover:scale-110 transition-transform" />
          <span>Minimap</span>
          {availableStatesCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-sky-950 text-sky-300 font-mono text-[10px] border border-sky-800/60">
              {availableStatesCount}
            </span>
          )}
          <ChevronUp className="w-3 h-3 text-slate-400 ml-0.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      id="diagram-minimap-container"
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={() => {
        if (isDragging) setIsDragging(false);
      }}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      className="absolute bottom-4 right-4 z-30 flex flex-col rounded-xl bg-slate-900/95 border border-slate-700/80 shadow-2xl backdrop-blur-md overflow-hidden select-none animate-in fade-in slide-in-from-bottom-2 duration-150 ring-1 ring-black/40"
      style={{ width: `${minimapDimensions.width}px` }}
    >
      {/* Minimap Header */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-950/90 border-b border-slate-800 text-xs text-slate-300">
        <div className="flex items-center gap-1.5 min-w-0">
          <Map className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span className="font-semibold text-[11px] text-slate-200 truncate">Minimap</span>
          {availableStatesCount > 0 && (
            <span
              className="px-1.5 py-0.2 rounded-full bg-slate-800/90 text-slate-400 font-mono text-[9px] border border-slate-700/60 shrink-0"
              title={`${availableStatesCount} states detected in diagram`}
            >
              {availableStatesCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {/* Fit Diagram / Reset View */}
          <button
            type="button"
            onClick={onResetZoom}
            className="p-1 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Reset View & Fit Diagram (100%)"
          >
            <RotateCcw className="w-3 h-3" />
          </button>

          {/* Collapse */}
          <button
            type="button"
            onClick={() => setIsCollapsed(true)}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Collapse Minimap"
          >
            <ChevronDown className="w-3 h-3" />
          </button>

          {/* Close */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-rose-300 hover:bg-slate-800 transition-colors cursor-pointer"
              title="Close Minimap (M)"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Minimap Body: Cloned SVG Canvas & Interactive Viewport Rectangle */}
      <div
        ref={minimapBodyRef}
        id="diagram-minimap-canvas"
        onClick={handleMinimapClick}
        onMouseDown={handleMouseDown}
        style={{
          width: `${minimapDimensions.width}px`,
          height: `${minimapDimensions.height}px`,
        }}
        className="relative bg-slate-950/90 overflow-hidden cursor-crosshair group/minimap"
      >
        {/* Cloned SVG Graphic Container */}
        <div
          ref={clonedSvgContainerRef}
          className="absolute inset-0 w-full h-full pointer-events-none opacity-85 select-none"
        />

        {/* Selected State Marker & Beacon */}
        {selectedNodeMarker && (
          <div
            className="absolute pointer-events-none z-20 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
            style={{
              left: `${selectedNodeMarker.x}px`,
              top: `${selectedNodeMarker.y}px`,
            }}
          >
            <div className="w-3.5 h-3.5 rounded-full bg-amber-400/90 ring-2 ring-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.9)] animate-pulse" />
            <div className="w-6 h-6 rounded-full border border-amber-400/50 absolute animate-ping opacity-75" />
          </div>
        )}

        {/* Viewport Indicator Rectangle (The Camera Frustum) */}
        {geometry && (
          <div
            id="minimap-viewport-indicator"
            style={{
              left: `${geometry.rect.x}px`,
              top: `${geometry.rect.y}px`,
              width: `${geometry.rect.width}px`,
              height: `${geometry.rect.height}px`,
            }}
            className={`absolute z-10 rounded border-2 border-sky-400 bg-sky-500/20 shadow-[0_0_12px_rgba(56,189,248,0.45)] transition-shadow duration-150 ${
              isDragging
                ? 'cursor-grabbing border-sky-300 bg-sky-400/30 shadow-[0_0_16px_rgba(56,189,248,0.7)] ring-1 ring-sky-300'
                : 'cursor-grab hover:border-sky-300 hover:bg-sky-500/25'
            }`}
            title="Drag to pan diagram, or click anywhere on minimap to jump"
          >
            {/* Center crosshair dot inside viewport rectangle */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-70">
              <div className="w-1 h-1 rounded-full bg-sky-300" />
            </div>
          </div>
        )}

        {/* Fallback if diagram is loading/rendering */}
        {!diagramBounds && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-500 font-mono">
            Rendering diagram...
          </div>
        )}
      </div>

      {/* Minimap Footer / Info Bar */}
      <div className="flex items-center justify-between px-2.5 py-1 bg-slate-950 border-t border-slate-800 text-[10px] font-mono text-slate-400 select-none">
        <span className="flex items-center gap-1">
          <Crosshair className="w-3 h-3 text-sky-400" />
          <span>{Math.round(zoom * 100)}%</span>
        </span>
        <span className="text-[9px] text-slate-500 font-sans">
          {isDragging ? 'Panning canvas...' : 'Click or drag to navigate'}
        </span>
      </div>
    </div>
  );
};
