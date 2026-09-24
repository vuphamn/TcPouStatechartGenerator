import React from 'react';
import { SnapResult } from '../utils/snapToGrid.ts';
import { CanvasNodePositionsMap } from '../utils/canvasPositions.ts';

export interface DiagramSnapGuidesProps {
  snapResult: SnapResult | null;
  activeNodeId: string | null;
  canvasPositions: CanvasNodePositionsMap;
  svgElement: SVGSVGElement | null;
}

export const DiagramSnapGuides: React.FC<DiagramSnapGuidesProps> = ({
  snapResult,
  activeNodeId,
  canvasPositions,
  svgElement,
}) => {
  if (!snapResult || !activeNodeId) return null;

  // Derive coordinate boundaries from SVG
  let minX = -1000;
  let maxX = 3000;
  let minY = -1000;
  let maxY = 3000;

  if (svgElement) {
    const origViewBox = svgElement.getAttribute('viewBox');
    if (origViewBox) {
      const parts = origViewBox.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && !parts.some(isNaN)) {
        minX = parts[0] - 800;
        minY = parts[1] - 800;
        maxX = parts[0] + parts[2] + 800;
        maxY = parts[1] + parts[3] + 800;
      }
    }
  }

  const { x, y, isSnappedX, isSnappedY, snapSourceX, snapSourceY, alignedNodeX, alignedNodeY } = snapResult;

  // Partner nodes that the active node is aligned with
  const partnerX = alignedNodeX ? canvasPositions[alignedNodeX.id] : null;
  const partnerY = alignedNodeY ? canvasPositions[alignedNodeY.id] : null;

  return (
    <svg
      id="diagram-snap-guides-overlay"
      className="absolute inset-0 w-full h-full pointer-events-none overflow-visible z-20"
      style={{ overflow: 'visible' }}
    >
      <defs>
        {/* Glow filters for guide lines */}
        <filter id="snap-guide-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#38bdf8" floodOpacity="0.8" />
        </filter>
        <filter id="node-align-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#34d399" floodOpacity="0.8" />
        </filter>
      </defs>

      {/* Vertical Alignment Guide Line */}
      {isSnappedX && (
        <g className="snap-guide-x animate-in fade-in duration-100">
          <line
            x1={x}
            y1={minY}
            x2={x}
            y2={maxY}
            stroke={snapSourceX === 'node' ? '#10b981' : '#38bdf8'}
            strokeWidth={snapSourceX === 'node' ? 1.75 : 1.25}
            strokeDasharray={snapSourceX === 'node' ? '6 4' : '4 3'}
            filter={snapSourceX === 'node' ? 'url(#node-align-glow)' : 'url(#snap-guide-glow)'}
            opacity={0.85}
          />
          {/* Alignment Tag */}
          <g transform={`translate(${x}, ${y - 45})`}>
            <rect
              x="-48"
              y="-10"
              width="96"
              height="20"
              rx="4"
              fill="#0f172a"
              stroke={snapSourceX === 'node' ? '#10b981' : '#0284c7'}
              strokeWidth="1.2"
              opacity="0.95"
            />
            <text
              x="0"
              y="3.5"
              textAnchor="middle"
              fill={snapSourceX === 'node' ? '#34d399' : '#7dd3fc'}
              fontSize="10"
              fontFamily="monospace"
              fontWeight="600"
            >
              {snapSourceX === 'node' ? `Align X:${alignedNodeX?.label || ''}` : `X: ${Math.round(x)}`}
            </text>
          </g>
        </g>
      )}

      {/* Horizontal Alignment Guide Line */}
      {isSnappedY && (
        <g className="snap-guide-y animate-in fade-in duration-100">
          <line
            x1={minX}
            y1={y}
            x2={maxX}
            y2={y}
            stroke={snapSourceY === 'node' ? '#10b981' : '#38bdf8'}
            strokeWidth={snapSourceY === 'node' ? 1.75 : 1.25}
            strokeDasharray={snapSourceY === 'node' ? '6 4' : '4 3'}
            filter={snapSourceY === 'node' ? 'url(#node-align-glow)' : 'url(#snap-guide-glow)'}
            opacity={0.85}
          />
          {/* Alignment Tag */}
          <g transform={`translate(${x + 45}, ${y})`}>
            <rect
              x="-6"
              y="-10"
              width="96"
              height="20"
              rx="4"
              fill="#0f172a"
              stroke={snapSourceY === 'node' ? '#10b981' : '#0284c7'}
              strokeWidth="1.2"
              opacity="0.95"
            />
            <text
              x="42"
              y="3.5"
              textAnchor="middle"
              fill={snapSourceY === 'node' ? '#34d399' : '#7dd3fc'}
              fontSize="10"
              fontFamily="monospace"
              fontWeight="600"
            >
              {snapSourceY === 'node' ? `Align Y:${alignedNodeY?.label || ''}` : `Y: ${Math.round(y)}`}
            </text>
          </g>
        </g>
      )}

      {/* Partner Node Highlight Rings */}
      {partnerX && (
        <circle
          cx={partnerX.centerX}
          cy={partnerX.centerY}
          r={Math.max(partnerX.width, partnerX.height) / 2 + 8}
          fill="none"
          stroke="#10b981"
          strokeWidth="2"
          strokeDasharray="4 2"
          className="animate-pulse"
          opacity="0.75"
        />
      )}
      {partnerY && partnerY.id !== partnerX?.id && (
        <circle
          cx={partnerY.centerX}
          cy={partnerY.centerY}
          r={Math.max(partnerY.width, partnerY.height) / 2 + 8}
          fill="none"
          stroke="#10b981"
          strokeWidth="2"
          strokeDasharray="4 2"
          className="animate-pulse"
          opacity="0.75"
        />
      )}

      {/* Active Node Snap Center Crosshair */}
      <circle cx={x} cy={y} r="4" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.5" />
    </svg>
  );
};
