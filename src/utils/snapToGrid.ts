/**
 * Utilities for Snap-to-Grid and Smart Alignment Guides
 * in the state machine diagram canvas.
 */

import { CanvasNodePosition, CanvasNodePositionsMap } from './canvasPositions.ts';

export interface SnapConfig {
  enabled: boolean;
  gridSize: number;
  snapToNodes: boolean;
  tolerance: number;
}

export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  enabled: true,
  gridSize: 20,
  snapToNodes: true,
  tolerance: 8,
};

export interface AlignedNodeInfo {
  id: string;
  label: string;
  coord: number;
}

export interface SnapResult {
  x: number;
  y: number;
  isSnappedX: boolean;
  isSnappedY: boolean;
  snapSourceX: 'grid' | 'node' | 'none';
  snapSourceY: 'grid' | 'node' | 'none';
  alignedNodeX?: AlignedNodeInfo;
  alignedNodeY?: AlignedNodeInfo;
}

/**
 * Calculates snapped center coordinate for a state node being dragged.
 * First checks for smart alignment with other nodes (matching center X or Y).
 * If no node is within magnetic tolerance, snaps to the nearest grid line.
 */
export function calculateSnappedPosition(
  rawCenterX: number,
  rawCenterY: number,
  activeStateId: string,
  canvasPositions: CanvasNodePositionsMap,
  config: SnapConfig = DEFAULT_SNAP_CONFIG
): SnapResult {
  if (!config.enabled) {
    return {
      x: Math.round(rawCenterX),
      y: Math.round(rawCenterY),
      isSnappedX: false,
      isSnappedY: false,
      snapSourceX: 'none',
      snapSourceY: 'none',
    };
  }

  const { gridSize, snapToNodes, tolerance } = config;

  let finalX = rawCenterX;
  let finalY = rawCenterY;
  let isSnappedX = false;
  let isSnappedY = false;
  let snapSourceX: 'grid' | 'node' | 'none' = 'none';
  let snapSourceY: 'grid' | 'node' | 'none' = 'none';
  let alignedNodeX: AlignedNodeInfo | undefined;
  let alignedNodeY: AlignedNodeInfo | undefined;

  // 1. Check Smart Alignment with other nodes in the diagram
  if (snapToNodes && canvasPositions) {
    let bestDistX = tolerance + 1;
    let bestDistY = tolerance + 1;

    for (const [id, node] of Object.entries(canvasPositions)) {
      if (id === activeStateId) continue;

      // Check center X alignment
      const distX = Math.abs(rawCenterX - node.centerX);
      if (distX <= tolerance && distX < bestDistX) {
        bestDistX = distX;
        finalX = node.centerX;
        isSnappedX = true;
        snapSourceX = 'node';
        alignedNodeX = {
          id: node.id,
          label: node.label || node.id,
          coord: node.centerX,
        };
      }

      // Check center Y alignment
      const distY = Math.abs(rawCenterY - node.centerY);
      if (distY <= tolerance && distY < bestDistY) {
        bestDistY = distY;
        finalY = node.centerY;
        isSnappedY = true;
        snapSourceY = 'node';
        alignedNodeY = {
          id: node.id,
          label: node.label || node.id,
          coord: node.centerY,
        };
      }
    }
  }

  // 2. If not aligned with another node, snap to nearest grid line
  if (!isSnappedX && gridSize > 1) {
    const gridX = Math.round(rawCenterX / gridSize) * gridSize;
    finalX = gridX;
    isSnappedX = true;
    snapSourceX = 'grid';
  }

  if (!isSnappedY && gridSize > 1) {
    const gridY = Math.round(rawCenterY / gridSize) * gridSize;
    finalY = gridY;
    isSnappedY = true;
    snapSourceY = 'grid';
  }

  return {
    x: finalX,
    y: finalY,
    isSnappedX,
    isSnappedY,
    snapSourceX,
    snapSourceY,
    alignedNodeX,
    alignedNodeY,
  };
}
