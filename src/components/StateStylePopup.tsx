import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Palette, X, Move } from 'lucide-react';
import { StateNodeStyleInspector, StateNodeStyleInspectorProps } from './StateNodeStyleInspector.tsx';

export interface StateStylePopupProps
  extends Pick<
    StateNodeStyleInspectorProps,
    'availableStates' | 'customStyles' | 'onStyleChange' | 'onResetStateStyle' | 'onClearAllCustomStyles' | 'onSelectState'
  > {
  stateId: string;
  stateLabel?: string;
  onClose: () => void;
  /** Screen rect to open beside (the clicked state node) */
  anchorRect?: { left: number; right: number; top: number };
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

/** State node appearance, as a draggable window on the canvas (like the Transition Guard window) */
export const StateStylePopup: React.FC<StateStylePopupProps> = ({
  stateId,
  stateLabel,
  onClose,
  anchorRect,
  containerRef,
  ...inspectorProps
}) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 24, y: 72 });
  const [height, setHeight] = useState<number>(520);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, initialX: 0, initialY: 0 });

  // Beside the node (right of it, or left if there is no room) and fully inside the canvas
  useLayoutEffect(() => {
    if (!containerRef?.current) return;
    const cRect = containerRef.current.getBoundingClientRect();
    const margin = 12;
    const h = Math.max(240, Math.min(560, cRect.height - margin * 2));
    setHeight(h);
    const w = popupRef.current?.offsetWidth || 380;
    let x = margin;
    let y = margin;
    if (anchorRect) {
      const gap = 16;
      x = anchorRect.right - cRect.left + gap;
      if (x + w > cRect.width - margin) x = anchorRect.left - cRect.left - gap - w;
      y = anchorRect.top - cRect.top - 8;
    }
    x = Math.max(margin, Math.min(x, cRect.width - w - margin));
    y = Math.max(margin, Math.min(y, cRect.height - h - margin));
    setPos({ x: Math.round(x), y: Math.round(y) });
    setDragOffset(null);
  }, [anchorRect, containerRef, stateId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Esc in a field of the popup (e.g. a colour input) should not close it
      const t = e.target as HTMLElement | null;
      if (t && popupRef.current?.contains(t) && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    const cur = dragOffset ?? pos;
    dragStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, initialX: cur.x, initialY: cur.y };
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const s = dragStartRef.current;
      const cw = containerRef?.current ? containerRef.current.clientWidth : window.innerWidth;
      const ch = containerRef?.current ? containerRef.current.clientHeight : window.innerHeight;
      const w = popupRef.current?.offsetWidth || 380;
      setDragOffset({
        x: Math.max(8, Math.min(cw - w - 8, s.initialX + e.clientX - s.mouseX)),
        y: Math.max(8, Math.min(ch - 100, s.initialY + e.clientY - s.mouseY)),
      });
    };
    const handleMouseUp = () => setIsDragging(false);
    // Capture phase: the popup stops mouse events from reaching the canvas, which must not block ending the drag
    window.addEventListener('mousemove', handleMouseMove, true);
    window.addEventListener('mouseup', handleMouseUp, true);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
    };
  }, [isDragging, containerRef]);

  const cur = dragOffset ?? pos;

  return (
    <div
      id="state-style-popup"
      ref={popupRef}
      role="dialog"
      aria-labelledby="state-style-popup-title"
      style={{ transform: `translate3d(${cur.x}px, ${cur.y}px, 0)`, height }}
      // Keep clicks from reaching the canvas handlers underneath (which would deselect / close the popup)
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      className="absolute top-0 left-0 z-40 w-[380px] max-w-[calc(100%-24px)] bg-slate-900/95 backdrop-blur-md border border-slate-700/90 rounded-xl shadow-2xl shadow-slate-950/90 overflow-hidden flex flex-col text-slate-200 animate-in fade-in zoom-in-95 duration-150"
    >
      <div
        onMouseDown={handleHeaderMouseDown}
        className={`px-3.5 py-2.5 bg-slate-950/85 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0 select-none ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-6 h-6 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
            <Palette className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <div className="min-w-0">
            <h2 id="state-style-popup-title" className="text-xs font-bold text-slate-100 uppercase tracking-wider truncate">
              State Style
            </h2>
            <p className="text-[10px] font-mono text-sky-300 break-all leading-tight" title={stateId}>
              {stateLabel || stateId}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-slate-500" title="Drag to reposition">
            <Move className="w-3 h-3 inline opacity-50" />
          </span>
          <button
            id="close-state-style-popup-btn"
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <StateNodeStyleInspector
          {...inspectorProps}
          panelMode="style"
          selectedStateId={stateId}
          selectedStateLabel={stateLabel}
          onClose={onClose}
        />
      </div>
    </div>
  );
};
