import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  Code2,
  X,
  Copy,
  Check,
  ArrowRight,
  Sparkles,
  Layers,
  Edit3,
  Move,
  StickyNote,
  Zap,
} from 'lucide-react';
import { EdgeInfo, DiagramNotes } from '../types.ts';
import { parseConditionClauses } from '../utils/interactiveDiagram.ts';

export interface TransitionGuardInspectorProps {
  edge: EdgeInfo;
  onClose: () => void;
  anchorPos?: { x: number; y: number };
  containerRef?: React.RefObject<HTMLDivElement | null>;
  notes?: DiagramNotes;
  onSelectState?: (stateId: string, label?: string) => void;
  onOpenNoteEditor?: (edge: EdgeInfo) => void;
}

export const TransitionGuardInspector: React.FC<TransitionGuardInspectorProps> = ({
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

  const inspectorRef = useRef<HTMLDivElement>(null);

  // Full condition text
  const rawCondition = (edge.condition || edge.label || '').trim();
  const normalizedCondition = rawCondition
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/#35;/g, '#')
    .trim();
  const isUnconditional = !normalizedCondition || normalizedCondition === '->';
  const displayCondition = isUnconditional ? '(unconditional transition)' : normalizedCondition;
  const parsed = parseConditionClauses(displayCondition);

  // Note for this transition if any
  const edgeNote =
    edge.note ||
    (notes?.edges ? notes.edges[edge.id] || notes.edges[`${edge.from}->${edge.to}`] : undefined);

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

  // Handle ESC key to close inspector
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
    if (isUnconditional) return;
    navigator.clipboard.writeText(displayCondition).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Dragging handlers for repositioning the panel
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
      const overlayW = inspectorRef.current?.offsetWidth || 440;

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
      id="transition-guard-inspector"
      ref={inspectorRef}
      style={{
        transform: `translate3d(${currentX}px, ${currentY}px, 0)`,
      }}
      className="absolute top-0 left-0 z-40 w-[450px] max-w-[calc(100vw-32px)] bg-slate-900/95 backdrop-blur-md border border-slate-700/90 rounded-xl shadow-2xl shadow-slate-950/90 overflow-hidden flex flex-col text-slate-200 animate-in fade-in zoom-in-95 duration-150 select-none transition-shadow edge-condition-detail-overlay"
      role="dialog"
      aria-labelledby="transition-guard-inspector-title"
    >
      {/* Header bar (Draggable) */}
      <div
        onMouseDown={handleMouseDownHeader}
        className={`px-3.5 py-2.5 bg-slate-950/85 border-b border-slate-800 flex items-center justify-between gap-2 cursor-grab ${
          isDragging ? 'cursor-grabbing' : ''
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <h2
              id="transition-guard-inspector-title"
              className="text-xs font-bold text-slate-100 uppercase tracking-wider flex items-center gap-1.5 truncate"
            >
              Transition Guard & Condition Inspector
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {edge.priority !== undefined && (
            <span
              id="transition-guard-priority-badge"
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[10px] font-semibold"
              title={`Evaluation priority: ${edge.priority} (Lower number = higher evaluation priority)`}
            >
              <span className="w-3.5 h-3.5 rounded-full bg-sky-400 text-slate-950 font-bold text-[9px] flex items-center justify-center shrink-0">
                {edge.priority}
              </span>
              <span>Priority {edge.priority}</span>
            </span>
          )}

          <span className="text-[10px] text-slate-500 font-mono hidden sm:inline" title="Drag to reposition panel">
            <Move className="w-3 h-3 inline opacity-50" />
          </span>

          <button
            id="close-transition-guard-inspector-btn"
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-md transition-colors ml-1"
            title="Close inspector (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* State Machine Transition Path Badge */}
      <div className="px-3.5 py-2 bg-slate-950/40 border-b border-slate-800/60 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            id="guard-inspector-from-state-btn"
            type="button"
            onClick={() => onSelectState?.(edge.from, edge.from)}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 font-mono text-[11px] border border-slate-700 hover:border-sky-500/50 transition-colors truncate max-w-[150px]"
            title={`Source state: ${edge.from} (click to inspect)`}
          >
            {edge.from}
          </button>
          <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <button
            id="guard-inspector-to-state-btn"
            type="button"
            onClick={() => onSelectState?.(edge.to, edge.to)}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 font-mono text-[11px] border border-slate-700 hover:border-emerald-500/50 transition-colors truncate max-w-[150px]"
            title={`Target state: ${edge.to} (click to inspect)`}
          >
            {edge.to}
          </button>
        </div>

        <div className="text-[10px] text-slate-400 font-mono shrink-0">
          {edge.id || `${edge.from}->${edge.to}`}
        </div>
      </div>

      {/* Main Content Body */}
      <div className="p-3.5 flex flex-col gap-3 max-h-[380px] overflow-y-auto custom-scrollbar select-text">
        {/* Full Condition Code Block */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
              <Code2 className="w-3 h-3 text-emerald-400" />
              Guard Condition Expression
            </span>
            {!isUnconditional && (
              <button
                id="copy-guard-expression-btn"
                type="button"
                onClick={handleCopy}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  copied
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80'
                }`}
                title="Copy guard expression to clipboard"
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
            )}
          </div>

          <div
            id="guard-expression-code-view"
            className="p-3 bg-slate-950 border border-slate-800 rounded-lg font-mono text-xs text-slate-100 overflow-x-auto overflow-y-auto max-h-64 whitespace-pre-wrap break-words leading-relaxed custom-scrollbar shadow-inner select-text"
          >
            {isUnconditional ? (
              <div className="flex items-center gap-2 text-slate-400 italic text-xs py-1">
                <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Unconditional transition: fires automatically when source state completes.</span>
              </div>
            ) : (
              <StructuredTextSyntaxHighlighter code={displayCondition} />
            )}
          </div>
        </div>

        {/* Structured Clauses Breakdown (If multi-clause or compound logic) */}
        {!isUnconditional && parsed.clauses.length > 1 && (
          <div
            id="guard-clauses-breakdown"
            className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2.5 flex flex-col gap-1.5"
          >
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
              <span className="flex items-center gap-1">
                <Layers className="w-3 h-3 text-sky-400" />
                Compound Sub-Guards
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {parsed.clauses.length} evaluated conditions
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
                ? 'All clauses must evaluate to TRUE simultaneously for this transition to fire.'
                : 'Transition fires when the combined boolean guard evaluates to TRUE.'}
            </p>
          </div>
        )}

        {/* Evaluation Semantics & Priority Note */}
        <div className="p-2.5 bg-slate-950/50 border border-slate-800/60 rounded-lg flex items-start gap-2 text-xs">
          <Sparkles className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5 text-slate-300 text-[11px]">
            <span className="font-semibold text-slate-200">Execution Semantics</span>
            <span className="text-slate-400 leading-relaxed">
              {edge.priority !== undefined
                ? `Evaluated with priority rank #${edge.priority} during state machine cycle updates.`
                : 'Evaluated by the state machine runtime on each PLC execution cycle.'}
            </span>
          </div>
        </div>

        {/* Notes & Annotations on this Edge */}
        {edgeNote ? (
          <div className="p-2.5 bg-amber-950/20 border border-amber-800/40 rounded-lg flex flex-col gap-1">
            <div className="flex items-center justify-between text-[11px] font-semibold text-amber-300">
              <span className="flex items-center gap-1">
                <StickyNote className="w-3 h-3 text-amber-400" />
                Transition Annotation / Note
              </span>
              <button
                type="button"
                onClick={() => onOpenNoteEditor?.(edge)}
                className="text-[10px] text-amber-400 hover:text-amber-200 flex items-center gap-0.5"
              >
                <Edit3 className="w-2.5 h-2.5" />
                Edit Note
              </button>
            </div>
            <p className="text-xs text-amber-100/90 leading-relaxed font-sans whitespace-pre-wrap break-words">
              {edgeNote}
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
            <span>No annotation attached</span>
            <button
              id="guard-inspector-add-note-btn"
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

      {/* Footer bar */}
      <div className="px-3.5 py-2 bg-slate-950/90 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
        <span className="truncate">Click edge label or priority badge to toggle</span>
        <button
          id="guard-inspector-dismiss-btn"
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
 * TwinCAT Structured Text syntax highlighting for transition condition expressions.
 */
function StructuredTextSyntaxHighlighter({ code }: { code: string }) {
  if (!code) return <span className="text-slate-500 italic">No condition</span>;

  // Split tokens while preserving delimiters and whitespace
  const tokens = code.split(
    /(\b(?:AND|AND_THEN|OR|OR_ELSE|NOT|XOR|TRUE|FALSE|IF|THEN|ELSE|ELSIF|END_IF)\b|<=|>=|<>|:=|=|<|>|\(|\)|\[|\]|,|\s+)/gi
  );

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
