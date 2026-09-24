import React, { useState, useEffect, useRef } from 'react';
import {
  Code2,
  X,
  Copy,
  Check,
  ArrowRight,
  Sparkles,
  Layers,
  Edit3,
  ExternalLink,
  Move,
  StickyNote,
} from 'lucide-react';
import { EdgeInfo, DiagramNotes } from '../types.ts';
import { parseConditionClauses } from '../utils/interactiveDiagram.ts';

interface EdgeConditionDetailOverlayProps {
  edge: EdgeInfo;
  onClose: () => void;
  anchorPos?: { x: number; y: number };
  containerRef?: React.RefObject<HTMLDivElement | null>;
  notes?: DiagramNotes;
  onSelectState?: (stateId: string, label?: string) => void;
  onOpenNoteEditor?: (edge: EdgeInfo) => void;
}

export const EdgeConditionDetailOverlay: React.FC<EdgeConditionDetailOverlayProps> = ({
  edge,
  onClose,
  anchorPos,
  containerRef,
  notes,
  onSelectState,
  onOpenNoteEditor,
}) => {
  const [copied, setCopied] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; initialX: number; initialY: number }>({
    mouseX: 0,
    mouseY: 0,
    initialX: 0,
    initialY: 0,
  });

  const overlayRef = useRef<HTMLDivElement>(null);

  // Full condition text
  const fullCondition = edge.condition || edge.label || '(unconditional transition)';
  const parsed = parseConditionClauses(fullCondition);

  // Note for this transition if any
  const edgeNote = edge.note || (notes?.edges ? notes.edges[edge.id] || notes.edges[`${edge.from}->${edge.to}`] : undefined);

  // Calculate default position relative to container
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 24, y: 72 });

  useEffect(() => {
    if (!anchorPos || !containerRef?.current) return;
    const cRect = containerRef.current.getBoundingClientRect();
    const overlayW = Math.min(460, cRect.width - 32);
    const overlayH = 340;

    let targetX = anchorPos.x - cRect.left - overlayW / 2;
    let targetY = anchorPos.y - cRect.top + 20;

    // Clamp horizontally within container
    if (targetX < 16) targetX = 16;
    if (targetX + overlayW > cRect.width - 16) {
      targetX = Math.max(16, cRect.width - overlayW - 16);
    }

    // Clamp vertically, or flip above if it would overflow bottom
    if (targetY + overlayH > cRect.height - 16) {
      const aboveY = anchorPos.y - cRect.top - overlayH - 24;
      targetY = aboveY >= 16 ? aboveY : Math.max(16, cRect.height - overlayH - 16);
    }

    setPos({ x: Math.round(targetX), y: Math.round(targetY) });
    setDragOffset(null);
  }, [anchorPos, containerRef, edge.id]);

  // Handle ESC key to close overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Copy to clipboard
  const handleCopy = () => {
    if (!fullCondition) return;
    navigator.clipboard.writeText(fullCondition).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Dragging handlers for repositioning the card
  const handleMouseDownHeader = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    const currentX = dragOffset ? dragOffset.x : pos.x;
    const currentY = dragOffset ? dragOffset.y : pos.y;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialX: currentX,
      initialY: currentY,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      const newX = dragStartRef.current.initialX + dx;
      const newY = dragStartRef.current.initialY + dy;

      const containerW = containerRef?.current ? containerRef.current.clientWidth : window.innerWidth;
      const containerH = containerRef?.current ? containerRef.current.clientHeight : window.innerHeight;
      const overlayW = overlayRef.current?.offsetWidth || 420;

      const clampedX = Math.max(8, Math.min(containerW - overlayW - 8, newX));
      const clampedY = Math.max(8, Math.min(containerH - 100, newY));

      setDragOffset({ x: clampedX, y: clampedY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, containerRef]);

  const currentX = dragOffset ? dragOffset.x : pos.x;
  const currentY = dragOffset ? dragOffset.y : pos.y;

  return (
    <div
      id="edge-condition-detail-overlay"
      ref={overlayRef}
      style={{
        transform: `translate3d(${currentX}px, ${currentY}px, 0)`,
      }}
      className="absolute top-0 left-0 z-40 w-[420px] max-w-[calc(100vw-32px)] bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-xl shadow-2xl shadow-slate-950/80 overflow-hidden flex flex-col text-slate-200 animate-in fade-in zoom-in-95 duration-150 select-none transition-shadow"
      role="dialog"
      aria-labelledby="edge-detail-title"
    >
      {/* Header bar (Draggable) */}
      <div
        onMouseDown={handleMouseDownHeader}
        className={`px-3.5 py-2.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between gap-2 cursor-grab ${
          isDragging ? 'cursor-grabbing' : ''
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0">
            <Code2 className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="min-w-0">
            <h2 id="edge-detail-title" className="text-xs font-bold text-slate-100 uppercase tracking-wider flex items-center gap-1.5 truncate">
              Transition Condition
              {edge.priority !== undefined && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-semibold lowercase">
                  <span className="w-3.5 h-3.5 rounded-full bg-white text-slate-950 font-bold text-[9px] flex items-center justify-center shrink-0">
                    {edge.priority}
                  </span>
                  prio {edge.priority}
                </span>
              )}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-slate-500 font-mono hidden sm:inline mr-1" title="Drag to reposition">
            <Move className="w-3 h-3 inline opacity-50" />
          </span>
          <button
            id="close-edge-condition-overlay-btn"
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-md transition-colors"
            title="Close overlay (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* State Machine Transition Path Badge */}
      <div className="px-3.5 py-2 bg-slate-950/40 border-b border-slate-800/60 flex items-center gap-1.5 text-xs">
        <button
          type="button"
          onClick={() => onSelectState?.(edge.from, edge.from)}
          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 font-mono text-[11px] border border-slate-700 hover:border-sky-500/50 transition-colors truncate max-w-[160px]"
          title={`Source state: ${edge.from} (click to inspect)`}
        >
          {edge.from}
        </button>
        <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <button
          type="button"
          onClick={() => onSelectState?.(edge.to, edge.to)}
          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 font-mono text-[11px] border border-slate-700 hover:border-emerald-500/50 transition-colors truncate max-w-[160px]"
          title={`Target state: ${edge.to} (click to inspect)`}
        >
          {edge.to}
        </button>
      </div>

      {/* Main Content Body */}
      <div className="p-3.5 flex flex-col gap-3 max-h-[380px] overflow-y-auto custom-scrollbar select-text">
        {/* Full Condition Code Block */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-sky-400" />
              Full Guard Expression
            </span>
            <button
              id="copy-full-condition-btn"
              type="button"
              onClick={handleCopy}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                copied
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80'
              }`}
              title="Copy expression to clipboard"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg font-mono text-xs text-slate-100 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed custom-scrollbar shadow-inner">
            <ConditionCodeViewer code={fullCondition} />
          </div>
        </div>

        {/* Structured Clauses Breakdown (If multi-clause or compound logic) */}
        {parsed.clauses.length > 1 && (
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2.5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
              <span className="flex items-center gap-1">
                <Layers className="w-3 h-3 text-emerald-400" />
                Condition Clauses Breakdown
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {parsed.clauses.length} sub-guards
              </span>
            </div>

            <div className="flex flex-col gap-1.5 mt-1">
              {parsed.clauses.map((clause, idx) => (
                <React.Fragment key={idx}>
                  <div className="p-2 bg-slate-900/90 border border-slate-800 rounded flex items-start gap-2 text-xs">
                    <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono text-[10px] shrink-0">
                      [{idx + 1}]
                    </span>
                    <span className="font-mono text-[11px] text-sky-200 break-all leading-snug">
                      {clause}
                    </span>
                  </div>
                  {idx < parsed.operators.length && (
                    <div className="flex justify-center -my-0.5">
                      <span className="px-2 py-0.2 rounded-full bg-sky-950/80 border border-sky-800/60 text-sky-400 font-mono font-bold text-[9px] uppercase tracking-wider">
                        {parsed.operators[idx]}
                      </span>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 leading-normal mt-1 italic">
              {parsed.operators.every((op) => op === 'AND' || op === 'AND_THEN')
                ? 'All clauses must evaluate to TRUE concurrently for this transition to fire.'
                : 'Transition fires when the combined boolean expression evaluates to TRUE.'}
            </p>
          </div>
        )}

        {/* Notes & Annotations on this Edge */}
        {edgeNote ? (
          <div className="p-2.5 bg-amber-950/20 border border-amber-800/40 rounded-lg flex flex-col gap-1">
            <div className="flex items-center justify-between text-[11px] font-semibold text-amber-300">
              <span className="flex items-center gap-1">
                <StickyNote className="w-3 h-3 text-amber-400" />
                Transition Note
              </span>
              <button
                type="button"
                onClick={() => onOpenNoteEditor?.(edge)}
                className="text-[10px] text-amber-400 hover:text-amber-200 flex items-center gap-0.5"
              >
                <Edit3 className="w-2.5 h-2.5" />
                Edit
              </button>
            </div>
            <p className="text-xs text-amber-100/90 leading-relaxed font-sans whitespace-pre-wrap break-words">
              {edgeNote}
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
            <span>No annotation on this transition</span>
            <button
              type="button"
              onClick={() => onOpenNoteEditor?.(edge)}
              className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 transition-colors"
            >
              <Edit3 className="w-3 h-3" />
              Add Note
            </button>
          </div>
        )}
      </div>

      {/* Footer info & keyboard hint */}
      <div className="px-3.5 py-2 bg-slate-950/90 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
        <span className="truncate">
          Interactive Mode active • Click label to toggle
        </span>
        <button
          type="button"
          onClick={onClose}
          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors font-medium shrink-0 ml-2"
        >
          Dismiss (Esc)
        </button>
      </div>
    </div>
  );
};

/**
 * Renders TwinCAT Structured Text syntax highlighting for transition conditions.
 */
function ConditionCodeViewer({ code }: { code: string }) {
  if (!code) return <span className="text-slate-500 italic">No condition</span>;

  // Split tokens while preserving whitespace and delimiters
  const tokens = code.split(/(\b(?:AND|AND_THEN|OR|OR_ELSE|NOT|XOR|TRUE|FALSE|IF|THEN|ELSE|ELSIF|END_IF)\b|<=|>=|<>|:=|=|<|>|\(|\)|\[|\]|,|\s+)/gi);

  return (
    <span>
      {tokens.map((token, i) => {
        const upper = token.toUpperCase();
        if (['AND', 'AND_THEN', 'OR', 'OR_ELSE', 'NOT', 'XOR'].includes(upper)) {
          return (
            <span key={i} className="text-sky-400 font-bold">
              {token}
            </span>
          );
        }
        if (['TRUE', 'FALSE'].includes(upper)) {
          return (
            <span key={i} className="text-emerald-400 font-semibold">
              {token}
            </span>
          );
        }
        if (['IF', 'THEN', 'ELSE', 'ELSIF', 'END_IF'].includes(upper)) {
          return (
            <span key={i} className="text-purple-400 font-semibold">
              {token}
            </span>
          );
        }
        if (['=', '<>', '<', '>', '<=', '>=', ':='].includes(token)) {
          return (
            <span key={i} className="text-amber-300 font-semibold">
              {token}
            </span>
          );
        }
        if (/^\d+(\.\d+)?$/.test(token)) {
          return (
            <span key={i} className="text-purple-300 font-semibold">
              {token}
            </span>
          );
        }
        if (['(', ')', '[', ']'].includes(token)) {
          return (
            <span key={i} className="text-slate-400 font-bold">
              {token}
            </span>
          );
        }
        return <span key={i}>{token}</span>;
      })}
    </span>
  );
}
