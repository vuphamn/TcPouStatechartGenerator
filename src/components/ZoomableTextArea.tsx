import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditorZoom } from '../hooks/useEditorZoom.ts';

/**
 * A plain text area (wrapped text, e.g. Markdown) with what the code editors have: the caret's line highlighted as in
 * Visual Studio / TwinCAT XAE (the whole line, wrapped rows included) and Ctrl+mouse wheel zoom (shared with them).
 * Also a zoomable read-only view (ZoomableView) for the rendered text.
 */

interface ZoomableTextAreaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'> {
  id: string;
  value: string;
  /** Text size at 100% (px) */
  baseFontPx?: number;
  /** Line height as a multiple of the text size */
  lineHeightRatio?: number;
  /** The wrapper's classes (border, background, rounding) */
  frameClassName?: string;
}

function useZoomKeys(zoomBy: (delta: number) => void, zoomRef: React.MutableRefObject<number>) {
  return useCallback(
    (e: React.KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return false;
      if (e.key === '0') zoomBy(1 - zoomRef.current);
      else if (e.shiftKey && (e.key === '>' || e.key === '.')) zoomBy(0.1);
      else if (e.shiftKey && (e.key === '<' || e.key === ',')) zoomBy(-0.1);
      else return false;
      e.preventDefault();
      return true;
    },
    [zoomBy, zoomRef]
  );
}

/** The zoom level and a badge that shows it for a moment after a change (and while it is not 100%) */
function useZoomState() {
  const [zoom, setZoom] = useEditorZoom();
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [shownAt, setShownAt] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!shownAt) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), 1300);
    return () => window.clearTimeout(t);
  }, [shownAt]);
  const zoomBy = useCallback(
    (delta: number) => {
      zoomRef.current = setZoom(zoomRef.current + delta);
      setShownAt(Date.now());
    },
    [setZoom]
  );
  const showBadge = zoom !== 1 || Date.now() - shownAt < 1200;
  return { zoom, zoomRef, zoomBy, showBadge };
}

/** Ctrl+wheel on the element (not passive: the page itself must not zoom) */
function useCtrlWheel(ref: React.RefObject<HTMLElement>, zoomBy: (delta: number) => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY !== 0) zoomBy(e.deltaY < 0 ? 0.1 : -0.1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, zoomBy]);
}

const ZoomBadge: React.FC<{ id: string; zoom: number; onReset: () => void }> = ({ id, zoom, onReset }) => (
  <button
    type="button"
    id={`${id}-zoom`}
    onClick={onReset}
    className="absolute left-2 bottom-2 z-20 px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900/90 font-sans text-[10px] text-slate-300 hover:text-sky-300 hover:border-sky-600"
    title="Text size (Ctrl+mouse wheel, Ctrl+Shift+. / Ctrl+Shift+,). Click for 100% (Ctrl+0)"
  >
    {Math.round(zoom * 100)}%
  </button>
);

export const ZoomableTextArea = React.forwardRef<HTMLTextAreaElement, ZoomableTextAreaProps>(
  ({ id, value, baseFontPx = 14, lineHeightRatio = 1.625, frameClassName = '', className = '', onKeyDown, onFocus, onBlur, onScroll, ...rest }, forwardedRef) => {
    const { zoom, zoomRef, zoomBy, showBadge } = useZoomState();
    const frameRef = useRef<HTMLDivElement>(null);
    const taRef = useRef<HTMLTextAreaElement | null>(null);
    const mirrorRef = useRef<HTMLDivElement>(null);
    const setRefs = (el: HTMLTextAreaElement | null) => {
      taRef.current = el;
      if (typeof forwardedRef === 'function') forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    };
    useCtrlWheel(frameRef, zoomBy);
    const zoomKeys = useZoomKeys(zoomBy, zoomRef);
    const fontPx = baseFontPx * zoom;
    const lineH = fontPx * lineHeightRatio;

    // The caret's line: its top and height inside the text (wrapped rows included), measured on a hidden copy
    const [band, setBand] = useState<{ top: number; height: number } | null>(null);
    const [focused, setFocused] = useState(false);
    const measure = useCallback(() => {
      const ta = taRef.current;
      const mirror = mirrorRef.current;
      if (!ta || !mirror) return;
      const cs = getComputedStyle(ta);
      // The textarea's text box: its width without the scrollbar, padding included
      mirror.style.boxSizing = 'border-box';
      mirror.style.width = `${ta.clientWidth}px`;
      for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'tabSize', 'wordSpacing'] as const) {
        (mirror.style as unknown as Record<string, string>)[p] = (cs as unknown as Record<string, string>)[p];
      }
      const text = ta.value;
      const pos = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;
      const start = text.lastIndexOf('\n', pos - 1) + 1;
      const endAt = text.indexOf('\n', pos);
      const end = endAt < 0 ? text.length : endAt;
      const topOf = (at: number) => {
        mirror.textContent = text.slice(0, at);
        const mark = document.createElement('span');
        mark.textContent = '​';
        mirror.appendChild(mark);
        // (fractional: offsetTop rounds, which adds up over many rows of a fractional line height)
        return mark.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
      };
      const top = topOf(start);
      const bottom = topOf(end) + parseFloat(cs.lineHeight);
      setBand((prev) => (prev && prev.top === top && prev.height === bottom - top ? prev : { top, height: bottom - top }));
    }, []);
    // Every caret move while focused (keys, clicks, drags, typing)
    useEffect(() => {
      if (!focused) return;
      document.addEventListener('selectionchange', measure);
      return () => document.removeEventListener('selectionchange', measure);
    }, [focused, measure]);
    const [scrollTop, setScrollTop] = useState(0);
    useLayoutEffect(() => {
      if (band) measure();
      // The text or its size changed: the rows move
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, fontPx]);
    useEffect(() => {
      const ta = taRef.current;
      if (!ta || typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => band && measure());
      ro.observe(ta);
      return () => ro.disconnect();
    }, [band, measure]);

    return (
      <div ref={frameRef} className={`relative flex-1 min-h-0 flex overflow-hidden ${frameClassName}`}>
        {band && (
          <div
            id={`${id}-caret-line`}
            className={`absolute left-0 right-0 pointer-events-none z-0 border-y ${focused ? 'bg-slate-600/30 border-slate-500/60' : 'bg-slate-700/15 border-slate-700/60'}`}
            style={{ top: band.top - scrollTop, height: band.height }}
          />
        )}
        <textarea
          {...rest}
          ref={setRefs}
          id={id}
          value={value}
          style={{ fontSize: `${fontPx}px`, lineHeight: `${lineH}px` }}
          className={`relative z-10 w-full h-full flex-1 bg-transparent resize-none outline-none custom-scrollbar ${className}`}
          onKeyDown={(e) => {
            if (zoomKeys(e)) return;
            onKeyDown?.(e);
          }}
          onFocus={(e) => {
            setFocused(true);
            measure();
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          onSelect={measure}
          onScroll={(e) => {
            setScrollTop(e.currentTarget.scrollTop);
            onScroll?.(e);
          }}
        />
        {/* The hidden copy the caret's line is measured on */}
        <div ref={mirrorRef} aria-hidden="true" className="absolute left-0 top-0 invisible pointer-events-none whitespace-pre-wrap break-words overflow-hidden" style={{ overflowWrap: 'break-word' }} />
        {showBadge && <ZoomBadge id={id} zoom={zoom} onReset={() => zoomBy(1 - zoomRef.current)} />}
      </div>
    );
  }
);
ZoomableTextArea.displayName = 'ZoomableTextArea';

/** A read-only view (e.g. rendered Markdown) zoomed with the editors (Ctrl+mouse wheel; CSS zoom of its content) */
export const ZoomableView: React.FC<{ id: string; className?: string; children: React.ReactNode }> = ({ id, className = '', children }) => {
  const { zoom, zoomRef, zoomBy, showBadge } = useZoomState();
  const ref = useRef<HTMLDivElement>(null);
  useCtrlWheel(ref, zoomBy);
  const zoomKeys = useZoomKeys(zoomBy, zoomRef);
  return (
    <div className="relative flex-1 min-h-0 flex">
      <div ref={ref} id={id} tabIndex={0} onKeyDown={(e) => zoomKeys(e)} className={`outline-none ${className}`}>
        <div style={{ zoom }}>{children}</div>
      </div>
      {showBadge && <ZoomBadge id={id} zoom={zoom} onReset={() => zoomBy(1 - zoomRef.current)} />}
    </div>
  );
};
