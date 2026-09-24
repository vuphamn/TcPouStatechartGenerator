import React from 'react';
import { ResizeDirection } from '../hooks/useDockableWindow.ts';

interface DockableResizeHandlesProps {
  isDocked: boolean;
  isMaximized: boolean;
  onStartResize: (direction: ResizeDirection) => (e: React.MouseEvent) => void;
}

export const DockableResizeHandles: React.FC<DockableResizeHandlesProps> = ({
  isDocked,
  isMaximized,
  onStartResize,
}) => {
  if (isMaximized) return null;

  if (isDocked) {
    return (
      <div
        onMouseDown={onStartResize('dock-left')}
        className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-sky-500/40 active:bg-sky-500 transition-colors z-50 flex items-center justify-center group select-none"
        title="Drag left/right to resize docked panel width"
      >
        <div className="w-1 h-12 bg-slate-600/80 group-hover:bg-sky-400 group-active:bg-sky-300 rounded-full transition-colors shadow-sm" />
      </div>
    );
  }

  return (
    <>
      {/* Left edge */}
      <div
        onMouseDown={onStartResize('left')}
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-sky-500/30 transition-colors z-40"
        title="Resize width"
      />
      {/* Right edge */}
      <div
        onMouseDown={onStartResize('right')}
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-sky-500/30 transition-colors z-40"
        title="Resize width"
      />
      {/* Bottom edge */}
      <div
        onMouseDown={onStartResize('bottom')}
        className="absolute left-0 right-0 bottom-0 h-2 cursor-ns-resize hover:bg-sky-500/30 transition-colors z-40"
        title="Resize height"
      />
      {/* Bottom-left corner */}
      <div
        onMouseDown={onStartResize('bottom-left')}
        className="absolute left-0 bottom-0 w-4 h-4 cursor-nesw-resize hover:bg-sky-500/50 transition-colors z-50"
        title="Resize window"
      />
      {/* Bottom-right corner with visual grip dot pattern */}
      <div
        onMouseDown={onStartResize('bottom-right')}
        className="absolute right-0 bottom-0 w-5 h-5 cursor-nwse-resize hover:bg-sky-500/50 transition-colors z-50 flex items-end justify-end p-1 select-none group"
        title="Resize window"
      >
        <svg
          className="w-3 h-3 text-slate-500 group-hover:text-sky-400 transition-colors"
          viewBox="0 0 10 10"
          fill="currentColor"
        >
          <circle cx="8" cy="8" r="1" />
          <circle cx="8" cy="5" r="1" />
          <circle cx="5" cy="8" r="1" />
          <circle cx="8" cy="2" r="1" />
          <circle cx="5" cy="5" r="1" />
          <circle cx="2" cy="8" r="1" />
        </svg>
      </div>
    </>
  );
};
