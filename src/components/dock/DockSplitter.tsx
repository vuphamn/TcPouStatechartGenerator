import React, { useRef } from 'react';

interface DockSplitterProps {
  /** `vertical` = a vertical bar that resizes horizontally (between side-by-side panes) */
  orientation: 'vertical' | 'horizontal';
  /** Called with the total pointer delta (px) since the drag started */
  onDrag: (deltaPx: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDoubleClick?: () => void;
  id?: string;
  title?: string;
}

/** Thin draggable splitter bar used between the main panels and between tab groups */
export const DockSplitter: React.FC<DockSplitterProps> = ({
  orientation,
  onDrag,
  onDragStart,
  onDragEnd,
  onDoubleClick,
  id,
  title,
}) => {
  const startRef = useRef<number>(0);
  const draggingRef = useRef<boolean>(false);
  const isVertical = orientation === 'vertical';

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = isVertical ? e.clientX : e.clientY;
    draggingRef.current = true;
    document.body.style.cursor = isVertical ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    onDragStart?.();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    onDrag((isVertical ? e.clientX : e.clientY) - startRef.current);
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    onDragEnd?.();
  };

  return (
    <div
      id={id}
      role="separator"
      aria-orientation={isVertical ? 'vertical' : 'horizontal'}
      title={title}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={onDoubleClick}
      className={`group relative shrink-0 z-10 touch-none ${
        isVertical ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'
      } bg-slate-800/70 hover:bg-sky-500/70 active:bg-sky-400 transition-colors`}
    >
      {/* Wider invisible hit area */}
      <div className={`absolute ${isVertical ? 'inset-y-0 -left-1 -right-1' : 'inset-x-0 -top-1 -bottom-1'}`} />
    </div>
  );
};
