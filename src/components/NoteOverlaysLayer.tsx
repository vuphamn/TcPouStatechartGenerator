import React, { useState, useRef, useEffect } from 'react';
import { StickyNote, Pencil, Trash2, Move, X, Palette } from 'lucide-react';
import { DiagramNotes, ContextMenuTarget, StateNodeInfo, EdgeInfo, NotePosition, NodeDisplayProperties } from '../types.ts';
import { cleanNodeId, findNodeElement, findEdgePathElement, getEdgeAnchorPoint } from '../utils/nodeDragger.ts';
import { parseEdgeKey } from '../utils/diagramNotes.ts';
import { NoteStylePopover } from './NoteStylePopover.tsx';

export interface NoteOverlaysLayerProps {
  notes: DiagramNotes;
  availableStates: StateNodeInfo[];
  availableEdges: EdgeInfo[];
  svgElement: SVGSVGElement | null;
  zoom: number;
  onEditNote: (target: ContextMenuTarget) => void;
  onDeleteNote: (target: ContextMenuTarget) => void;
  onUpdateNotePosition: (targetId: string, pos: NotePosition) => void;
  onUpdateNoteStyle?: (targetId: string, style: NodeDisplayProperties | null) => void;
  onSelectTarget?: (target: ContextMenuTarget) => void;
}

interface NoteItemWithPos {
  id: string; // target id (node id or edge id)
  type: 'node' | 'edge';
  text: string;
  label: string;
  x: number;
  y: number;
  targetAnchor: { x: number; y: number };
  targetObject: ContextMenuTarget;
}

export const NoteOverlaysLayer: React.FC<NoteOverlaysLayerProps> = ({
  notes,
  availableStates,
  availableEdges,
  svgElement,
  zoom,
  onEditNote,
  onDeleteNote,
  onUpdateNotePosition,
  onUpdateNoteStyle,
  onSelectTarget,
}) => {
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [selectedNoteCardId, setSelectedNoteCardId] = useState<string | null>(null);
  const [isStylingNoteId, setIsStylingNoteId] = useState<string | null>(null);
  const [activeDragOffset, setActiveDragOffset] = useState<{ id: string; x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ clientX: number; clientY: number; origX: number; origY: number } | null>(null);

  // Close selection & styling when clicking outside or pressing Escape
  useEffect(() => {
    const handleDocumentMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // If clicked inside any note card, popover, dialog, or context menu, keep selection
      if (
        target.closest('[id^="note-overlay-"]') ||
        target.closest('[id^="note-style-popover-"]') ||
        target.closest('#diagram-context-menu') ||
        target.closest('#note-dialog')
      ) {
        return;
      }
      setSelectedNoteCardId(null);
      setIsStylingNoteId(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedNoteCardId(null);
        setIsStylingNoteId(null);
      }
    };

    document.addEventListener('mousedown', handleDocumentMouseDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Compute positions for all node and edge notes
  const noteItems: NoteItemWithPos[] = [];

  // 1. Process Node Notes
  for (const [rawNodeId, text] of Object.entries(notes.nodes || {})) {
    if (!text || !text.trim()) continue;

    const nodeId = cleanNodeId(rawNodeId);
    const state = availableStates.find((s) => cleanNodeId(s.id) === nodeId || s.id === nodeId || s.id === rawNodeId);
    const label = state?.label || nodeId;

    let targetX = 150;
    let targetY = 150;
    let defaultNoteX = 230;
    let defaultNoteY = 105;

    if (svgElement) {
      const nodeEl =
        findNodeElement(svgElement, nodeId) ||
        findNodeElement(svgElement, rawNodeId) ||
        (svgElement.querySelector(
          `g.node[data-state-id="${nodeId}"], g.node[data-state-id="${rawNodeId}"], g.node#${nodeId}, g.node#${rawNodeId}`
        ) as SVGGElement | null);

      if (nodeEl) {
        const wrapperEl = (svgElement.closest('#mermaid-svg-wrapper') ||
          document.getElementById('mermaid-svg-wrapper')) as HTMLElement | null;
        if (wrapperEl) {
          const wRect = wrapperEl.getBoundingClientRect();
          const nRect = nodeEl.getBoundingClientRect();
          if (wRect.width > 0 && nRect.width > 0) {
            const actualScale =
              wrapperEl.offsetWidth > 0 && wRect.width > 0
                ? wRect.width / wrapperEl.offsetWidth
                : zoom > 0
                ? zoom
                : 1;
            const localLeft = (nRect.left - wRect.left) / actualScale;
            const localTop = (nRect.top - wRect.top) / actualScale;
            const localW = nRect.width / actualScale;
            const localH = nRect.height / actualScale;
            targetX = Math.round(localLeft + localW / 2);
            targetY = Math.round(localTop + localH / 2);
            defaultNoteX = Math.round(localLeft + localW + 28);
            defaultNoteY = Math.max(16, Math.round(localTop - 12));
          }
        } else {
          try {
            const bbox = nodeEl.getBBox();
            targetX = Math.round(bbox.x + bbox.width / 2);
            targetY = Math.round(bbox.y + bbox.height / 2);
            defaultNoteX = Math.round(bbox.x + bbox.width + 28);
            defaultNoteY = Math.max(16, Math.round(bbox.y - 12));
          } catch {
            // fallback
          }
        }
      }
    }

    const savedPos =
      notes.positions?.[rawNodeId] ||
      notes.positions?.[nodeId] ||
      (state ? notes.positions?.[state.id] : null);
    let noteX = defaultNoteX;
    let noteY = defaultNoteY;

    if (savedPos) {
      if (typeof savedPos.deltaX === 'number' && typeof savedPos.deltaY === 'number') {
        noteX = targetX + savedPos.deltaX;
        noteY = targetY + savedPos.deltaY;
      } else {
        noteX = savedPos.x;
        noteY = savedPos.y;
      }
    }

    // Apply active drag override if currently dragging
    if (
      activeDragOffset &&
      (activeDragOffset.id === rawNodeId ||
        activeDragOffset.id === nodeId ||
        (state && activeDragOffset.id === state.id))
    ) {
      noteX = activeDragOffset.x;
      noteY = activeDragOffset.y;
    }

    noteItems.push({
      id: rawNodeId,
      type: 'node',
      text,
      label: `State: ${label}`,
      x: noteX,
      y: noteY,
      targetAnchor: { x: targetX, y: targetY },
      targetObject: { type: 'node', id: rawNodeId, label, note: text },
    });
  }

  // 2. Process Edge Notes
  for (const [edgeId, text] of Object.entries(notes.edges || {})) {
    if (!text || !text.trim()) continue;

    const parsed = parseEdgeKey(edgeId, availableEdges);
    const edge =
      availableEdges.find(
        (e) =>
          e.id === edgeId ||
          `${e.from}->${e.to}` === edgeId ||
          (e.pathId && e.pathId === edgeId)
      ) || parsed?.edge;
    const label = edge?.label
      ? `${edge.from} → ${edge.to} (${edge.label})`
      : edge
      ? `${edge.from} → ${edge.to}`
      : parsed
      ? `${parsed.from} → ${parsed.to}`
      : edgeId;

    let targetX = 250;
    let targetY = 250;
    let defaultNoteX = 290;
    let defaultNoteY = 200;

    // Position edge note adjacent to target node (edge.to) just like a node note, matching Mermaid.live
    const targetNodeId = edge?.to || parsed?.to;
    let positionedNearTargetNode = false;

    if (svgElement && targetNodeId) {
      const cleanTarget = cleanNodeId(targetNodeId);
      const targetNodeEl =
        findNodeElement(svgElement, cleanTarget) ||
        findNodeElement(svgElement, targetNodeId) ||
        (svgElement.querySelector(
          `g.node[data-state-id="${cleanTarget}"], g.node[data-state-id="${targetNodeId}"], g.node#${cleanTarget}, g.node#${targetNodeId}`
        ) as SVGGElement | null);

      if (targetNodeEl) {
        const wrapperEl = (svgElement.closest('#mermaid-svg-wrapper') ||
          document.getElementById('mermaid-svg-wrapper')) as HTMLElement | null;
        if (wrapperEl) {
          const wRect = wrapperEl.getBoundingClientRect();
          const nRect = targetNodeEl.getBoundingClientRect();
          if (wRect.width > 0 && nRect.width > 0) {
            const actualScale =
              wrapperEl.offsetWidth > 0 && wRect.width > 0
                ? wRect.width / wrapperEl.offsetWidth
                : zoom > 0
                ? zoom
                : 1;
            const localLeft = (nRect.left - wRect.left) / actualScale;
            const localTop = (nRect.top - wRect.top) / actualScale;
            const localW = nRect.width / actualScale;
            const localH = nRect.height / actualScale;
            targetX = Math.round(localLeft + localW / 2);
            targetY = Math.round(localTop + localH / 2);
            defaultNoteX = Math.round(localLeft + localW + 28);
            defaultNoteY = Math.max(16, Math.round(localTop - 12));
            positionedNearTargetNode = true;
          }
        }
      }
    }

    if (!positionedNearTargetNode && svgElement) {
      const pathEl =
        findEdgePathElement(svgElement, edgeId, availableEdges) ||
        (edge ? findEdgePathElement(svgElement, edge.id, availableEdges) : null) ||
        (edge && edge.pathId ? findEdgePathElement(svgElement, edge.pathId, availableEdges) : null) ||
        (edge ? findEdgePathElement(svgElement, `${edge.from}->${edge.to}`, availableEdges) : null);

      if (pathEl) {
        const wrapperEl = (svgElement.closest('#mermaid-svg-wrapper') ||
          document.getElementById('mermaid-svg-wrapper')) as HTMLElement | null;
        const pt = getEdgeAnchorPoint(svgElement, pathEl, wrapperEl, zoom);
        targetX = pt.x;
        targetY = pt.y;
        defaultNoteX = Math.round(targetX + 28);
        defaultNoteY = Math.max(16, Math.round(targetY - 24));
      }
    }

    const savedPos =
      notes.positions?.[edgeId] ||
      (edge
        ? notes.positions?.[edge.id] ||
          notes.positions?.[`${edge.from}->${edge.to}`] ||
          (edge.pathId ? notes.positions?.[edge.pathId] : null)
        : null);
    let noteX = defaultNoteX;
    let noteY = defaultNoteY;

    if (savedPos) {
      if (typeof savedPos.deltaX === 'number' && typeof savedPos.deltaY === 'number') {
        noteX = targetX + savedPos.deltaX;
        noteY = targetY + savedPos.deltaY;
      } else {
        noteX = savedPos.x;
        noteY = savedPos.y;
      }
    }

    if (
      activeDragOffset &&
      (activeDragOffset.id === edgeId ||
        (edge &&
          (activeDragOffset.id === edge.id ||
            activeDragOffset.id === `${edge.from}->${edge.to}` ||
            (edge.pathId && activeDragOffset.id === edge.pathId))))
    ) {
      noteX = activeDragOffset.x;
      noteY = activeDragOffset.y;
    }

    noteItems.push({
      id: edgeId,
      type: 'edge',
      text,
      label: `Transition: ${label}`,
      x: noteX,
      y: noteY,
      targetAnchor: { x: targetX, y: targetY },
      targetObject: {
        type: 'edge',
        id: edgeId,
        from: edge?.from || '',
        to: edge?.to || '',
        label,
        note: text,
      },
    });
  }

  // Mouse drag handlers
  const handleNoteMouseDown = (e: React.MouseEvent, note: NoteItemWithPos) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      origX: note.x,
      origY: note.y,
    };
    setDraggingNoteId(note.id);
    setActiveDragOffset({ id: note.id, x: note.x, y: note.y });
  };

  useEffect(() => {
    if (!draggingNoteId) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = (e.clientX - dragStartRef.current.clientX) / zoom;
      const dy = (e.clientY - dragStartRef.current.clientY) / zoom;

      const newX = Math.round(dragStartRef.current.origX + dx);
      const newY = Math.round(dragStartRef.current.origY + dy);

      setActiveDragOffset({
        id: draggingNoteId,
        x: newX,
        y: newY,
      });
    };

    const handleWindowMouseUp = () => {
      if (activeDragOffset) {
        const matchingNote = noteItems.find((n) => n.id === activeDragOffset.id);
        const targetAnchor = matchingNote?.targetAnchor || { x: 0, y: 0 };
        const deltaX = Math.round(activeDragOffset.x - targetAnchor.x);
        const deltaY = Math.round(activeDragOffset.y - targetAnchor.y);

        onUpdateNotePosition(activeDragOffset.id, {
          x: activeDragOffset.x,
          y: activeDragOffset.y,
          deltaX,
          deltaY,
        });
      }
      dragStartRef.current = null;
      setDraggingNoteId(null);
      setActiveDragOffset(null);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [draggingNoteId, activeDragOffset, onUpdateNotePosition, zoom, noteItems]);

  if (noteItems.length === 0) {
    return null;
  }

  return (
    <div
      id="mermaid-note-overlays-layer"
      className="absolute inset-0 pointer-events-none z-20 overflow-visible"
      style={{ width: '100%', height: '100%' }}
    >
      {/* Note Overlay Cards (rendered without dashed-line connectors) */}
      {noteItems.map((note) => {
        const isDragging = draggingNoteId === note.id;
        const isSelected = selectedNoteCardId === note.id;
        const isStyling = isStylingNoteId === note.id;

        const noteStyle = notes.styles?.[note.id] || notes.styles?.[cleanNodeId(note.id)];
        const cardBg = noteStyle?.fill || '#fffbeb';
        const cardColor = noteStyle?.color || '#78350f';
        const cardBorder = noteStyle?.stroke || '#f59e0b';
        const cardBorderWidth = noteStyle?.strokeWidth || '1.5px';

        return (
          <div
            key={note.id}
            id={`note-overlay-${note.id}`}
            style={{
              transform: `translate(${note.x}px, ${note.y}px)`,
              position: 'absolute',
              top: 0,
              left: 0,
              backgroundColor: cardBg,
              color: cardColor,
              borderColor: cardBorder,
              borderWidth: cardBorderWidth,
            }}
            className={`pointer-events-auto w-44 rounded-lg shadow-md transition-all select-none ${
              isDragging
                ? 'shadow-xl ring-2 scale-[1.02] cursor-grabbing z-30'
                : isSelected
                ? 'ring-2 shadow-lg z-25'
                : 'hover:shadow-lg cursor-grab active:cursor-grabbing'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedNoteCardId(note.id);
              onSelectTarget?.(note.targetObject);
            }}
            onMouseDown={(e) => {
              // When not selected or clicking background of card, allow direct dragging
              if (!isSelected) {
                handleNoteMouseDown(e, note);
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onEditNote(note.targetObject);
            }}
          >
            {/* Note Style Popover */}
            {isStyling && isSelected && (
              <NoteStylePopover
                noteId={note.id}
                noteLabel={note.label}
                currentStyle={noteStyle}
                onUpdateStyle={(updatedStyle) => {
                  onUpdateNoteStyle?.(note.id, updatedStyle);
                }}
                onClose={() => setIsStylingNoteId(null)}
              />
            )}

            {/* Note Title Bar - ONLY rendered when note is selected / focused */}
            {isSelected && (
              <div
                id={`note-title-bar-${note.id}`}
                onMouseDown={(e) => handleNoteMouseDown(e, note)}
                className="flex items-center justify-between px-2 py-1 rounded-t-[7px] border-b cursor-grab active:cursor-grabbing select-none transition-colors"
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.08)',
                  borderColor: cardBorder,
                  color: cardColor,
                }}
                title="Click & drag to reposition this note"
              >
                <div className="flex items-center space-x-1 min-w-0 pr-1">
                  <StickyNote className="w-3 h-3 shrink-0" style={{ color: cardBorder }} />
                  <span className="text-[10px] font-bold truncate">
                    {note.label}
                  </span>
                </div>
                <div
                  className="flex items-center space-x-0.5 shrink-0"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {/* Style Note Button */}
                  <button
                    id={`style-note-${note.id}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsStylingNoteId(isStyling ? null : note.id);
                    }}
                    className={`flex items-center gap-0.5 px-1 py-0.5 rounded transition-colors text-[10px] font-medium ${
                      isStyling
                        ? 'bg-amber-500/30 text-white font-bold'
                        : 'hover:bg-black/10 dark:hover:bg-white/10'
                    }`}
                    title="Customize Note Colors (Background, Text & Border)"
                    aria-label="Customize Note Style"
                  >
                    <Palette className="w-2.5 h-2.5" />
                    <span>Style</span>
                  </button>

                  {/* Edit Note Button */}
                  <button
                    id={`edit-note-${note.id}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onEditNote(note.targetObject);
                    }}
                    className="flex items-center gap-0.5 px-1 py-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded transition-colors text-[10px] font-medium"
                    title="Edit Note Text"
                    aria-label="Edit Note"
                  >
                    <Pencil className="w-2.5 h-2.5" />
                    <span>Edit</span>
                  </button>

                  {/* Delete Note Button */}
                  <button
                    id={`delete-note-${note.id}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onDeleteNote(note.targetObject);
                    }}
                    className="flex items-center gap-0.5 px-1 py-0.5 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 rounded transition-colors text-[10px] font-medium"
                    title="Delete Note"
                    aria-label="Delete Note"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                    <span>Delete</span>
                  </button>

                  {/* Close / Deselect Button */}
                  <button
                    id={`close-note-${note.id}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedNoteCardId(null);
                      setIsStylingNoteId(null);
                    }}
                    className="p-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded transition-colors opacity-70 hover:opacity-100"
                    title="Deselect Note (Esc)"
                    aria-label="Deselect Note"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Note Content - Proportional 11px font size, clean line-height */}
            <div
              className={`px-2.5 py-2 text-[11px] font-medium whitespace-pre-wrap break-words leading-snug max-h-36 overflow-y-auto ${
                isSelected ? '' : 'rounded-lg'
              }`}
              title="Click to select, double-click to edit note text"
            >
              {note.text}
            </div>
          </div>
        );
      })}
    </div>
  );
};
