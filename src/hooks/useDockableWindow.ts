import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';

export interface UseDockableWindowOptions {
  id?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  defaultDocked?: boolean;
  minWidth?: number;
  minHeight?: number;
}

export type ResizeDirection =
  | 'dock-left'
  | 'left'
  | 'right'
  | 'bottom'
  | 'bottom-left'
  | 'bottom-right';

export interface UseDockableWindowReturn {
  isDocked: boolean;
  setIsDocked: React.Dispatch<React.SetStateAction<boolean>>;
  toggleDock: () => void;
  isMaximized: boolean;
  setIsMaximized: React.Dispatch<React.SetStateAction<boolean>>;
  toggleMaximize: () => void;
  pos: { x: number; y: number } | null;
  setPos: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  size: { width: number; height: number };
  setSize: React.Dispatch<React.SetStateAction<{ width: number; height: number }>>;
  dockWidth: number;
  setDockWidth: React.Dispatch<React.SetStateAction<number>>;
  isDragging: boolean;
  isResizing: boolean;
  handleHeaderMouseDown: (e: React.MouseEvent) => void;
  startResize: (direction: ResizeDirection) => (e: React.MouseEvent) => void;
  containerStyle: React.CSSProperties;
}

export function useDockableWindow(options: UseDockableWindowOptions = {}): UseDockableWindowReturn {
  const {
    id,
    defaultWidth = 780,
    defaultHeight = 740,
    defaultDocked = false,
    minWidth = 380,
    minHeight = 320,
  } = options;

  const storageKey = id ? `tc_dockable_window_${id}` : null;

  // Initialize dock state
  const [isDocked, setIsDocked] = useState<boolean>(() => {
    if (storageKey) {
      try {
        const saved = localStorage.getItem(`${storageKey}_docked`);
        if (saved !== null) return saved === 'true';
      } catch {
        // ignore
      }
    }
    return defaultDocked;
  });

  const [isMaximized, setIsMaximized] = useState<boolean>(false);

  // Initialize docked width
  const [dockWidth, setDockWidth] = useState<number>(() => {
    if (storageKey) {
      try {
        const saved = localStorage.getItem(`${storageKey}_dockWidth`);
        if (saved) return Math.max(minWidth, parseInt(saved, 10));
      } catch {
        // ignore
      }
    }
    return Math.min(Math.max(680, minWidth), typeof window !== 'undefined' ? window.innerWidth - 60 : 700);
  });

  // Floating size
  const [size, setSize] = useState<{ width: number; height: number }>(() => {
    const initialW = typeof window !== 'undefined' ? Math.min(defaultWidth, window.innerWidth - 32) : defaultWidth;
    const initialH = typeof window !== 'undefined' ? Math.min(defaultHeight, window.innerHeight - 32) : defaultHeight;
    return { width: Math.max(minWidth, initialW), height: Math.max(minHeight, initialH) };
  });

  // Floating position
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState<boolean>(false);

  const isDraggingRef = useRef(false);
  const isResizingRef = useRef(false);

  // Save docking preferences
  useEffect(() => {
    if (storageKey) {
      try {
        localStorage.setItem(`${storageKey}_docked`, String(isDocked));
        localStorage.setItem(`${storageKey}_dockWidth`, String(dockWidth));
      } catch {
        // ignore
      }
    }
  }, [storageKey, isDocked, dockWidth]);

  // Adjust on window resize to ensure floating window stays within screen bounds
  useEffect(() => {
    const handleWindowResize = () => {
      setSize((prev) => ({
        width: Math.min(prev.width, window.innerWidth - 20),
        height: Math.min(prev.height, window.innerHeight - 20),
      }));

      setPos((prev) => {
        if (!prev) return null;
        return {
          x: Math.max(0, Math.min(window.innerWidth - 120, prev.x)),
          y: Math.max(0, Math.min(window.innerHeight - 60, prev.y)),
        };
      });

      setDockWidth((prev) => Math.min(prev, window.innerWidth - 60));
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  const toggleDock = useCallback(() => {
    setIsDocked((prev) => !prev);
    setIsMaximized(false);
  }, []);

  const toggleMaximize = useCallback(() => {
    setIsMaximized((prev) => !prev);
    setIsDocked(false);
  }, []);

  // Dragging by header
  const handleHeaderMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isDocked || isMaximized) return;
      if (
        (e.target as HTMLElement).closest(
          'button, input, select, textarea, a, [role="button"], .no-drag'
        )
      ) {
        return;
      }

      e.preventDefault();
      isDraggingRef.current = true;
      setIsDragging(true);

      const currentLeft = pos?.x ?? (window.innerWidth - size.width - 24);
      const currentTop = pos?.y ?? 16;
      const startMouseX = e.clientX;
      const startMouseY = e.clientY;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const dx = ev.clientX - startMouseX;
        const dy = ev.clientY - startMouseY;
        const nextX = Math.max(0, Math.min(window.innerWidth - 100, currentLeft + dx));
        const nextY = Math.max(0, Math.min(window.innerHeight - 50, currentTop + dy));
        setPos({ x: nextX, y: nextY });
      };

      const onMouseUp = () => {
        isDraggingRef.current = false;
        setIsDragging(false);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [isDocked, isMaximized, pos, size]
  );

  // Resizing handler
  const startResize = useCallback(
    (direction: ResizeDirection) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isResizingRef.current = true;
      setIsResizing(true);

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const startWidth = isDocked ? dockWidth : size.width;
      const startHeight = size.height;
      const startLeft = pos?.x ?? (window.innerWidth - size.width - 24);
      const startTop = pos?.y ?? 16;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isResizingRef.current) return;

        if (direction === 'dock-left') {
          const newW = Math.max(
            minWidth,
            Math.min(window.innerWidth - 80, window.innerWidth - ev.clientX)
          );
          setDockWidth(newW);
          return;
        }

        let newW = startWidth;
        let newH = startHeight;
        let newX = startLeft;

        if (direction === 'right' || direction === 'bottom-right') {
          const dx = ev.clientX - startMouseX;
          newW = Math.max(minWidth, Math.min(window.innerWidth - startLeft - 16, startWidth + dx));
        }

        if (direction === 'left' || direction === 'bottom-left') {
          const dx = ev.clientX - startMouseX;
          const proposedW = startWidth - dx;
          newW = Math.max(minWidth, Math.min(startLeft + startWidth - 16, proposedW));
          newX = startLeft + (startWidth - newW);
        }

        if (
          direction === 'bottom' ||
          direction === 'bottom-right' ||
          direction === 'bottom-left'
        ) {
          const dy = ev.clientY - startMouseY;
          newH = Math.max(minHeight, Math.min(window.innerHeight - startTop - 16, startHeight + dy));
        }

        setSize({ width: newW, height: newH });
        if (direction === 'left' || direction === 'bottom-left') {
          setPos((prev) => ({ x: newX, y: prev?.y ?? startTop }));
        }
      };

      const onMouseUp = () => {
        isResizingRef.current = false;
        setIsResizing(false);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [isDocked, dockWidth, size, pos, minWidth, minHeight]
  );

  const containerStyle: React.CSSProperties = useMemo(() => {
    if (isMaximized) {
      return {
        position: 'fixed',
        left: 0,
        top: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 45,
        borderRadius: 0,
      };
    }
    if (isDocked) {
      return {
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: `${dockWidth}px`,
        height: '100vh',
        maxHeight: '100vh',
        zIndex: 45,
        borderRadius: 0,
        borderRight: 'none',
        borderTop: 'none',
        borderBottom: 'none',
      };
    }
    return {
      position: 'fixed',
      left: pos ? `${pos.x}px` : undefined,
      right: pos ? undefined : '16px',
      top: pos ? `${pos.y}px` : '16px',
      width: `${size.width}px`,
      height: `${size.height}px`,
      maxWidth: 'calc(100vw - 20px)',
      maxHeight: 'calc(100vh - 20px)',
      zIndex: 45,
    };
  }, [isMaximized, isDocked, dockWidth, pos, size]);

  return {
    isDocked,
    setIsDocked,
    toggleDock,
    isMaximized,
    setIsMaximized,
    toggleMaximize,
    pos,
    setPos,
    size,
    setSize,
    dockWidth,
    setDockWidth,
    isDragging,
    isResizing,
    handleHeaderMouseDown,
    startResize,
    containerStyle,
  };
}
