import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
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
  Palette,
  RotateCcw,
} from 'lucide-react';
import { EdgeInfo, DiagramNotes, EdgeDisplayProperties, EdgeLabelStyle } from '../types.ts';
import {
  EDGE_COLOR_SWATCHES,
  EDGE_WIDTH_OPTIONS,
  EDGE_PATTERN_OPTIONS,
  LABEL_BACKGROUND_SWATCHES,
  LABEL_TEXT_SWATCHES,
  LABEL_FONT_SIZE_OPTIONS,
  LABEL_BORDER_WIDTH_OPTIONS,
  edgeDashArray,
  hasEdgeStyle,
  hasLabelStyle,
  compactStyle,
} from '../utils/edgeStyles.ts';
import { parseConditionClauses } from '../utils/interactiveDiagram.ts';

export interface TransitionGuardInspectorProps {
  edge: EdgeInfo;
  onClose: () => void;
  anchorPos?: { x: number; y: number };
  containerRef?: React.RefObject<HTMLDivElement | null>;
  notes?: DiagramNotes;
  onSelectState?: (stateId: string, label?: string) => void;
  onOpenNoteEditor?: (edge: EdgeInfo) => void;
  /** Custom line style of this transition; omit onEdgeStyleChange to hide the style controls */
  edgeStyle?: EdgeDisplayProperties;
  onEdgeStyleChange?: (style: EdgeDisplayProperties | null) => void;
}

export const TransitionGuardInspector: React.FC<TransitionGuardInspectorProps> = ({
  edge,
  onClose,
  anchorPos,
  containerRef,
  notes,
  onSelectState,
  onOpenNoteEditor,
  edgeStyle,
  onEdgeStyleChange,
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

  // Position relative to the canvas; the panel may be no taller than the canvas (its body scrolls)
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 24, y: 72 });
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  // Place the panel beside the clicked label / badge (right of it, or left if there is no room) so it never
  // covers the transition it describes, and keep it fully inside the canvas
  useLayoutEffect(() => {
    if (!containerRef?.current) return;
    const cRect = containerRef.current.getBoundingClientRect();
    const margin = 12;
    // Compact by default (long guard breakdowns scroll inside the body), never taller than the canvas
    const availableH = Math.max(160, Math.min(480, cRect.height - margin * 2));
    setMaxHeight(availableH);
    if (!anchorPos) return;
    const w = inspectorRef.current?.offsetWidth || 420;
    const h = Math.min(inspectorRef.current?.offsetHeight || 360, availableH);
    const ax = anchorPos.x - cRect.left;
    const ay = anchorPos.y - cRect.top;
    const gap = 28;

    let x = ax + gap;
    if (x + w > cRect.width - margin) x = ax - gap - w;
    x = Math.max(margin, Math.min(x, cRect.width - w - margin));
    let y = ay - 48;
    y = Math.max(margin, Math.min(y, cRect.height - h - margin));

    setPos({ x: Math.round(x), y: Math.round(y) });
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

    // Capture phase: the panel stops mouse events from reaching the canvas, which must not block ending the drag
    window.addEventListener('mousemove', handleMouseMove, true);
    window.addEventListener('mouseup', handleMouseUp, true);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
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
        maxHeight,
      }}
      // Keep clicks (e.g. Add Note) from reaching the canvas handlers underneath, which would close the panel
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      className="absolute top-0 left-0 z-40 w-[420px] max-w-[calc(100%-24px)] bg-slate-900/95 backdrop-blur-md border border-slate-700/90 rounded-xl shadow-2xl shadow-slate-950/90 overflow-hidden flex flex-col text-slate-200 animate-in fade-in zoom-in-95 duration-150 select-none transition-shadow edge-condition-detail-overlay"
      role="dialog"
      aria-labelledby="transition-guard-inspector-title"
    >
      {/* Header bar (Draggable) */}
      <div
        onMouseDown={handleMouseDownHeader}
        className={`px-3.5 py-2.5 bg-slate-950/85 border-b border-slate-800 flex items-center justify-between gap-2 cursor-grab shrink-0 ${
          isDragging ? 'cursor-grabbing' : ''
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-6 h-6 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <h2
              id="transition-guard-inspector-title"
              className="text-xs font-bold text-slate-100 uppercase tracking-wider truncate"
              title="Transition Guard & Condition Inspector"
            >
              Transition Guard
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
      <div
        className="px-3.5 py-2 bg-slate-950/40 border-b border-slate-800/60 text-xs shrink-0"
        title={edge.id || `${edge.from}->${edge.to}`}
      >
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <button
            id="guard-inspector-from-state-btn"
            type="button"
            onClick={() => onSelectState?.(edge.from, edge.from)}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 font-mono text-[11px] border border-slate-700 hover:border-sky-500/50 transition-colors text-left break-all max-w-full"
            title={`Source state: ${edge.from} (click to inspect)`}
          >
            {edge.from}
          </button>
          <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <button
            id="guard-inspector-to-state-btn"
            type="button"
            onClick={() => onSelectState?.(edge.to, edge.to)}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 font-mono text-[11px] border border-slate-700 hover:border-emerald-500/50 transition-colors text-left break-all max-w-full"
            title={`Target state: ${edge.to} (click to inspect)`}
          >
            {edge.to}
          </button>
        </div>
      </div>

      {/* Main Content Body */}
      <div className="p-3.5 flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto custom-scrollbar select-text">
        {onEdgeStyleChange && (
          <EdgeStyleEditor style={edgeStyle} onChange={onEdgeStyleChange} />
        )}

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
      <div className="px-3.5 py-2 bg-slate-950/90 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 shrink-0">
        <span className="truncate">Click the selected transition again to close</span>
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

type Swatch = { label: string; value: string };

const styleChip = (active: boolean) =>
  `px-1.5 h-6 rounded border text-[10px] font-medium transition-colors flex items-center justify-center ${
    active
      ? 'bg-sky-900/60 border-sky-500 text-sky-100'
      : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'
  }`;

function StyleRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[10px] text-slate-400">{label}</span>
      <div className="flex flex-wrap items-center gap-1 min-w-0">{children}</div>
    </div>
  );
}

/** Default + preset swatches + a custom colour picker */
function ColorSwatchRow({
  id,
  value,
  swatches,
  onChange,
  fallback,
}: {
  id: string;
  value?: string;
  swatches: Swatch[];
  onChange: (color: string | undefined) => void;
  fallback: string;
}) {
  return (
    <>
      <button
        type="button"
        data-swatch=""
        onClick={() => onChange(undefined)}
        className={`${styleChip(!value)} w-6 px-0`}
        title="Default"
      >
        <X className="w-3 h-3" />
      </button>
      {swatches.map((c) => (
        <button
          key={c.value}
          type="button"
          data-swatch={c.value}
          onClick={() => onChange(c.value)}
          className={`w-6 h-6 rounded border transition-transform hover:scale-110 ${
            value?.toLowerCase() === c.value ? 'border-white ring-2 ring-sky-400' : 'border-slate-600'
          }`}
          style={{ backgroundColor: c.value }}
          title={c.label}
        />
      ))}
      <label
        className="relative w-6 h-6 rounded border border-slate-600 overflow-hidden cursor-pointer"
        title="Custom color"
        style={{ background: 'conic-gradient(#f43f5e, #f59e0b, #10b981, #3b82f6, #a855f7, #f43f5e)' }}
      >
        <input
          id={id}
          type="color"
          value={value || fallback}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </label>
    </>
  );
}

// Last chosen tab, kept while the app runs so re-opening the inspector stays on it
let lastStyleTab: 'line' | 'label' = 'line';

/** Line (colour, width, dash) and label (fill, text, font, border) style of one transition */
function EdgeStyleEditor({
  style,
  onChange,
}: {
  style?: EdgeDisplayProperties;
  onChange: (style: EdgeDisplayProperties | null) => void;
}) {
  const [tab, setTab] = useState<'line' | 'label'>(lastStyleTab);
  const current = style || {};
  const label = current.labelStyle || {};

  const emit = (next: EdgeDisplayProperties) => {
    const labelStyle = next.labelStyle ? compactStyle(next.labelStyle) : undefined;
    const compacted = compactStyle({
      ...next,
      labelStyle: labelStyle && hasLabelStyle(labelStyle) ? labelStyle : undefined,
    });
    onChange(hasEdgeStyle(compacted) ? compacted : null);
  };
  const updateLine = (patch: Partial<EdgeDisplayProperties>) => emit({ ...current, ...patch });
  const updateLabel = (patch: Partial<EdgeLabelStyle>) => emit({ ...current, labelStyle: { ...label, ...patch } });

  const lineChanged = Boolean(current.stroke || current.strokeWidth || current.pattern);
  const labelChanged = hasLabelStyle(label);
  const tabBtn = (id: 'line' | 'label', text: string, changed: boolean) => (
    <button
      type="button"
      id={`guard-inspector-style-tab-${id}`}
      onClick={() => {
        lastStyleTab = id;
        setTab(id);
      }}
      className={`px-2 h-5 rounded text-[10px] font-semibold transition-colors flex items-center gap-1 ${
        tab === id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {text}
      {changed && <span className="w-1.5 h-1.5 rounded-full bg-violet-400" title="Customized" />}
    </button>
  );

  return (
    <div id="guard-inspector-line-style" className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2.5 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-300">
        <span className="flex items-center gap-1">
          <Palette className="w-3 h-3 text-violet-400" />
          Style
        </span>
        <div className="flex items-center gap-0.5 p-0.5 rounded bg-slate-900 border border-slate-800">
          {tabBtn('line', 'Line', lineChanged)}
          {tabBtn('label', 'Label', labelChanged)}
        </div>
        {(tab === 'line' ? lineChanged : labelChanged) ? (
          <button
            id="guard-inspector-line-style-reset"
            type="button"
            onClick={() =>
              tab === 'line' ? emit({ labelStyle: current.labelStyle }) : emit({ ...current, labelStyle: undefined })
            }
            className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-0.5"
            title={`Back to the default ${tab} style`}
          >
            <RotateCcw className="w-2.5 h-2.5" />
            Reset
          </button>
        ) : (
          <span className="w-10" />
        )}
      </div>

      {tab === 'line' ? (
        <div id="guard-inspector-line-controls" className="flex flex-col gap-2">
          <StyleRow label="Color">
            <ColorSwatchRow
              id="guard-inspector-line-color-input"
              value={current.stroke}
              swatches={EDGE_COLOR_SWATCHES}
              onChange={(stroke) => updateLine({ stroke })}
              fallback="#94a3b8"
            />
          </StyleRow>
          <StyleRow label="Width">
            <button
              type="button"
              data-edge-width=""
              onClick={() => updateLine({ strokeWidth: undefined })}
              className={styleChip(!current.strokeWidth)}
            >
              Auto
            </button>
            {EDGE_WIDTH_OPTIONS.map((w) => (
              <button
                key={w}
                type="button"
                data-edge-width={w}
                onClick={() => updateLine({ strokeWidth: w })}
                className={`${styleChip(current.strokeWidth === w)} gap-1`}
                title={`${w}px`}
              >
                <span className="w-3 rounded-full bg-current" style={{ height: `${Math.min(w, 4)}px` }} />
                {w}
              </button>
            ))}
          </StyleRow>
          <StyleRow label="Pattern">
            {EDGE_PATTERN_OPTIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                data-edge-pattern={p.value}
                onClick={() => updateLine({ pattern: p.value })}
                className={`${styleChip(current.pattern === p.value)} gap-1`}
              >
                <svg width="20" height="6" className="shrink-0">
                  <line
                    x1="0"
                    y1="3"
                    x2="20"
                    y2="3"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray={edgeDashArray(p.value, 1.2)}
                  />
                </svg>
                {p.label}
              </button>
            ))}
          </StyleRow>
        </div>
      ) : (
        <div id="guard-inspector-label-controls" className="flex flex-col gap-2">
          <StyleRow label="Fill">
            <ColorSwatchRow
              id="guard-inspector-label-bg-input"
              value={label.background}
              swatches={LABEL_BACKGROUND_SWATCHES}
              onChange={(background) => updateLabel({ background })}
              fallback="#0f172a"
            />
          </StyleRow>
          <StyleRow label="Text">
            <ColorSwatchRow
              id="guard-inspector-label-color-input"
              value={label.color}
              swatches={LABEL_TEXT_SWATCHES}
              onChange={(color) => updateLabel({ color })}
              fallback="#f8fafc"
            />
          </StyleRow>
          <StyleRow label="Size">
            <button
              type="button"
              data-label-size=""
              onClick={() => updateLabel({ fontSize: undefined })}
              className={styleChip(!label.fontSize)}
            >
              Auto
            </button>
            {LABEL_FONT_SIZE_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                data-label-size={s}
                onClick={() => updateLabel({ fontSize: s })}
                className={styleChip(label.fontSize === s)}
              >
                {s}
              </button>
            ))}
          </StyleRow>
          <StyleRow label="Font">
            <button
              type="button"
              data-label-font="bold"
              onClick={() => updateLabel({ bold: !label.bold })}
              className={`${styleChip(!!label.bold)} w-7 font-bold`}
              title="Bold"
            >
              B
            </button>
            <button
              type="button"
              data-label-font="italic"
              onClick={() => updateLabel({ italic: !label.italic })}
              className={`${styleChip(!!label.italic)} w-7 italic`}
              title="Italic"
            >
              I
            </button>
            <button
              type="button"
              data-label-font="underline"
              onClick={() => updateLabel({ underline: !label.underline })}
              className={`${styleChip(!!label.underline)} w-7 underline`}
              title="Underline"
            >
              U
            </button>
          </StyleRow>
          <StyleRow label="Border">
            <button
              type="button"
              data-label-border=""
              onClick={() => updateLabel({ borderWidth: undefined })}
              className={styleChip(!label.borderWidth)}
            >
              None
            </button>
            {LABEL_BORDER_WIDTH_OPTIONS.map((w) => (
              <button
                key={w}
                type="button"
                data-label-border={w}
                onClick={() => updateLabel({ borderWidth: w })}
                className={`${styleChip(label.borderWidth === w)} gap-1`}
                title={`${w}px border`}
              >
                <span className="w-3 h-3 rounded-sm border-current" style={{ borderWidth: `${w}px` }} />
                {w}
              </button>
            ))}
          </StyleRow>
          {!!label.borderWidth && (
            <StyleRow label="Edge">
              <ColorSwatchRow
                id="guard-inspector-label-border-input"
                value={label.borderColor}
                swatches={EDGE_COLOR_SWATCHES}
                onChange={(borderColor) => updateLabel({ borderColor })}
                fallback="#94a3b8"
              />
            </StyleRow>
          )}
        </div>
      )}
    </div>
  );
}
