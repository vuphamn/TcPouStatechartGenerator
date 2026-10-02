import React, { useLayoutEffect, useRef, useState } from 'react';

export interface ScreenRect {
  l: number;
  t: number;
  r: number;
  b: number;
}

/**
 * A hover box placed beside what it is about (a state on the canvas): just below it, else just above it, where it
 * fits; else on the side with more room, as tall as that room. Never over it; kept inside the window. Where that is,
 * read (anchor()) when it is placed, before it is drawn: hidden until then, so it shows once, in its place (and no
 * transition: it does not glide there from where it waited).
 */
export const NodeHoverBox: React.FC<{ anchor: () => ScreenRect | null; id?: string; className?: string; children: React.ReactNode }> = ({ anchor, id, className, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight?: number; below: boolean } | null>(null);
  // (the place set last: not set again when it is the same, not even to the same value; a state update there on each
  // render, its parent drawn again meanwhile, would loop)
  const placedRef = useRef<typeof pos>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const rect = anchor();
    if (!el || !rect) return;
    const w = el.offsetWidth;
    const h = el.scrollHeight;
    const gap = 8;
    const below = window.innerHeight - rect.b - gap - 8;
    const above = rect.t - gap - 8;
    let top: number;
    let maxHeight: number | undefined;
    if (h <= below) top = rect.b + gap;
    else if (h <= above) top = rect.t - gap - h;
    else if (below >= above) {
      top = rect.b + gap;
      maxHeight = below;
    } else {
      top = 8;
      maxHeight = above;
    }
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.l));
    const was = placedRef.current;
    if (was && was.left === left && was.top === top && was.maxHeight === maxHeight) return;
    placedRef.current = { left, top, maxHeight, below: top >= rect.b };
    setPos(placedRef.current);
  });
  return (
    <div
      ref={ref}
      id={id}
      className={className}
      data-placed={pos ? (pos.below ? 'below' : 'above') : undefined}
      style={{ position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, maxHeight: pos?.maxHeight, overflow: 'hidden', visibility: pos ? 'visible' : 'hidden', transition: 'none' }}
    >
      {children}
    </div>
  );
};
