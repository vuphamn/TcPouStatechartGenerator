import React, { useRef, useMemo, useEffect, useLayoutEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useEditorZoom } from '../hooks/useEditorZoom.ts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { highlightStructuredText } from '../utils/stSyntaxHighlighter.ts';
import {
  FoldableBlock,
  buildFoldedViewModel,
  restoreFullCodeFromViewCode,
  LineMappingEntry,
} from '../utils/stCodeFolding.ts';
import {
  FindOptions,
  highlightHtmlWithFindMatches,
  buildSearchRegex,
} from '../utils/stFindHighlight.ts';

/**
 * Room below the last line in the line numbers and the highlighting (overflow hidden, scrolled with the textarea):
 * more than the textarea's horizontal scrollbar, so at the very bottom they can scroll as far as it does
 */
const BOTTOM_ROOM = 48;

export interface StructuredTextCodeEditorRef {
  scrollToLine: (lineNumber: number, smooth?: boolean) => void;
  focus: () => void;
  getTextarea: () => HTMLTextAreaElement | null;
}

export interface StructuredTextCodeEditorProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  highlightedLine?: number | null; // 1-based original line number to highlight
  /** Live: the line of the PLC's current state (marked, never scrolled to) */
  liveLine?: number | null;
  scrollToLine?: number | null; // 1-based original line number to scroll into view
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  className?: string;
  ariaLabel?: string;

  // Code Folding Props
  enableCodeFolding?: boolean;
  foldedBlockIds?: Set<string>;
  onToggleFold?: (blockId: string) => void;
  foldableBlocks?: FoldableBlock[];

  // Find & Highlight Props
  findQuery?: string;
  findOptions?: FindOptions;
  activeFindMatchIndex?: number;

  // Context Menu
  onContextMenu?: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
}

export const StructuredTextCodeEditor = forwardRef<
  StructuredTextCodeEditorRef,
  StructuredTextCodeEditorProps
>(
  (
    {
      id,
      value,
      onChange,
      placeholder,
      highlightedLine,
      liveLine,
      scrollToLine,
      onKeyDown,
      className = '',
      ariaLabel = 'Structured Text Editor',
      enableCodeFolding = false,
      foldedBlockIds,
      onToggleFold,
      foldableBlocks = [],
      findQuery = '',
      findOptions = { matchCase: false, wholeWord: false },
      activeFindMatchIndex,
      onContextMenu,
    },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const preRef = useRef<HTMLPreElement>(null);
    const gutterRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState<number>(0);
    const containerRef = useRef<HTMLDivElement>(null);
    // Text size (Ctrl+mouse wheel, as in Visual Studio / TwinCAT XAE): 100% is 12px text on 20px lines
    const [zoom, setZoom] = useEditorZoom();
    const lineH = 20 * zoom;
    const lineHRef = useRef(lineH);
    lineHRef.current = lineH;
    const fontPx = 12 * zoom;
    // The line at the top when zooming: kept at the top at the new size
    const zoomAnchorRef = useRef<number | null>(null);
    const [zoomShownAt, setZoomShownAt] = useState(0);
    // (a ref: wheel events come faster than renders)
    const zoomRef = useRef(zoom);
    zoomRef.current = zoom;
    const zoomBy = useCallback(
      (delta: number) => {
        const ta = textareaRef.current;
        // The first zoom of a burst sets the anchor (the line at the top before it)
        if (ta && zoomAnchorRef.current === null) zoomAnchorRef.current = ta.scrollTop / (20 * zoomRef.current);
        zoomRef.current = setZoom(zoomRef.current + delta);
        setZoomShownAt(Date.now());
      },
      [setZoom]
    );
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      // Not passive: Ctrl+wheel must not zoom the whole page
      const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        if (e.deltaY !== 0) zoomBy(e.deltaY < 0 ? 0.1 : -0.1);
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    }, [zoomBy]);
    useLayoutEffect(() => {
      const ta = textareaRef.current;
      const anchor = zoomAnchorRef.current;
      zoomAnchorRef.current = null;
      if (!ta || anchor === null) return;
      ta.scrollTop = anchor * lineH;
      // The layers follow the textarea (also on the next frame: the browser may still adjust it after the font change)
      const sync = () => {
        if (preRef.current) {
          preRef.current.scrollTop = ta.scrollTop;
          preRef.current.scrollLeft = ta.scrollLeft;
        }
        if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
        setScrollTop(ta.scrollTop);
      };
      sync();
      const raf = requestAnimationFrame(sync);
      return () => cancelAnimationFrame(raf);
    }, [lineH]);
    // The zoom level shows for a moment after a change (and stays while it is not 100%)
    const [, setTick] = useState(0);
    useEffect(() => {
      if (!zoomShownAt) return;
      const t = window.setTimeout(() => setTick((n) => n + 1), 1300);
      return () => window.clearTimeout(t);
    }, [zoomShownAt]);
    const showZoom = zoom !== 1 || Date.now() - zoomShownAt < 1200;
    // The caret's line (view line index), highlighted like Visual Studio's / TwinCAT XAE's current line
    const [caretViewLine, setCaretViewLine] = useState<number | null>(null);
    const [focused, setFocused] = useState(false);
    const updateCaretLine = useCallback(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      // The end the caret is at (a selection made upwards has it at its start)
      const pos = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;
      let line = 0;
      for (let i = ta.value.indexOf('\n'); i >= 0 && i < pos; i = ta.value.indexOf('\n', i + 1)) line++;
      setCaretViewLine((prev) => (prev === line ? prev : line));
    }, []);
    // Every caret move while focused: keys, clicks, drags, jumps (setSelectionRange), edits
    useEffect(() => {
      if (!focused) return;
      document.addEventListener('selectionchange', updateCaretLine);
      return () => document.removeEventListener('selectionchange', updateCaretLine);
    }, [focused, updateCaretLine]);

    // Compute folded view model (or standard fallback)
    const viewModel = useMemo(() => {
      if (!enableCodeFolding) return null;
      return buildFoldedViewModel(value, foldableBlocks, foldedBlockIds || new Set());
    }, [enableCodeFolding, value, foldableBlocks, foldedBlockIds]);

    const activeViewCode = viewModel ? viewModel.viewCode : value;

    // Syntax highlighted HTML via Prism iecst + Find match highlighting
    const highlightedHtml = useMemo(() => {
      const rawPrism = highlightStructuredText(activeViewCode);
      if (!findQuery || !findQuery.trim()) {
        return rawPrism;
      }
      const { html } = highlightHtmlWithFindMatches(
        rawPrism,
        findQuery,
        findOptions,
        activeFindMatchIndex ?? -1
      );
      return html;
    }, [activeViewCode, findQuery, findOptions, activeFindMatchIndex]);

    // View line indices containing search query matches for gutter indicators
    const matchingViewLines = useMemo(() => {
      if (!findQuery || !findQuery.trim()) return new Set<number>();
      const searchRegex = buildSearchRegex(
        findQuery.trim(),
        findOptions.matchCase,
        findOptions.wholeWord
      );
      if (!searchRegex) return new Set<number>();

      const set = new Set<number>();
      const lines = activeViewCode.split('\n');
      for (let i = 0; i < lines.length; i++) {
        searchRegex.lastIndex = 0;
        if (searchRegex.test(lines[i])) {
          set.add(i);
        }
      }
      return set;
    }, [activeViewCode, findQuery, findOptions]);

    // Line mapping entries for gutter
    const lineEntries: LineMappingEntry[] = useMemo(() => {
      if (viewModel) {
        return viewModel.lineMapping;
      }
      const count = (value.match(/\n/g) || []).length + 1;
      return Array.from({ length: count }, (_, i) => ({
        viewLineIndex: i,
        originalLineNumber: i + 1,
        isFolded: false,
      }));
    }, [viewModel, value]);

    // View line index corresponding to highlightedLine
    const highlightedViewLineIndex = useMemo<number | null>(() => {
      if (!highlightedLine) return null;
      const idx = lineEntries.findIndex(
        (entry) => entry.originalLineNumber === highlightedLine
      );
      return idx >= 0 ? idx : null;
    }, [highlightedLine, lineEntries]);

    // The live state's line as shown (inside a folded block: the block's line)
    const liveViewLineIndex = useMemo<number | null>(() => {
      if (!liveLine) return null;
      let idx = lineEntries.findIndex((entry) => entry.originalLineNumber === liveLine);
      if (idx < 0) {
        for (let i = 0; i < lineEntries.length; i++) {
          const n = lineEntries[i].originalLineNumber;
          if (n !== null && n <= liveLine) idx = i;
        }
      }
      return idx >= 0 ? idx : null;
    }, [liveLine, lineEntries]);

    // Expose imperative methods to parent
    useImperativeHandle(ref, () => ({
      scrollToLine: (originalLineNum: number, smooth = true) => {
        if (!textareaRef.current || originalLineNum <= 0) return;
        let targetViewIdx = lineEntries.findIndex(
          (e) => e.originalLineNumber === originalLineNum
        );
        if (targetViewIdx < 0) {
          // Fallback to approximate line position
          targetViewIdx = Math.max(0, originalLineNum - 1);
        }
        const targetTop = Math.max(0, targetViewIdx * lineHRef.current - 2 * lineHRef.current);
        textareaRef.current.scrollTo({
          top: targetTop,
          behavior: smooth ? 'smooth' : 'auto',
        });
      },
      focus: () => {
        textareaRef.current?.focus();
      },
      getTextarea: () => textareaRef.current,
    }));

    // Auto-scroll when scrollToLine prop changes
    useEffect(() => {
      if (scrollToLine && scrollToLine > 0 && textareaRef.current) {
        let targetViewIdx = lineEntries.findIndex(
          (e) => e.originalLineNumber === scrollToLine
        );
        if (targetViewIdx < 0) {
          targetViewIdx = Math.max(0, scrollToLine - 1);
        }
        const targetTop = Math.max(0, targetViewIdx * lineHRef.current - 2 * lineHRef.current);
        textareaRef.current.scrollTo({
          top: targetTop,
          behavior: 'smooth',
        });
      }
    // (not on a zoom: the line height is read from the ref)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scrollToLine, lineEntries]);

    // Synchronize scrolling across textarea, pre, and gutter
    const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
      const top = e.currentTarget.scrollTop;
      const left = e.currentTarget.scrollLeft;
      setScrollTop(top);

      if (preRef.current) {
        preRef.current.scrollTop = top;
        preRef.current.scrollLeft = left;
      }
      if (gutterRef.current) {
        gutterRef.current.scrollTop = top;
      }
    };

    // Handle code edits from textarea
    const handleTextareaChange = (newViewCode: string) => {
      if (viewModel && viewModel.activeFoldedBlocks.length > 0) {
        const fullCode = restoreFullCodeFromViewCode(
          newViewCode,
          viewModel.activeFoldedBlocks,
          value
        );
        onChange(fullCode);
      } else {
        onChange(newViewCode);
      }
    };

    // If user clicks or selects a placeholder line in the textarea, unfold that block!
    const handleTextareaClickOrSelect = () => {
      if (!viewModel || !textareaRef.current || !onToggleFold) return;
      const selStart = textareaRef.current.selectionStart;
      const viewText = textareaRef.current.value;
      const lineIdx = (viewText.slice(0, selStart).match(/\n/g) || []).length;
      const entry = viewModel.lineMapping[lineIdx];
      if (entry && entry.isPlaceholder && entry.blockId) {
        onToggleFold(entry.blockId);
      }
    };

    // Tab key indentation support & custom keybindings
    const handleKeyDownInternal = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (onKeyDown) {
        onKeyDown(e);
        if (e.defaultPrevented) return;
      }

      // Check if user is typing on a folded placeholder line: unfold it before editing!
      if (viewModel && viewModel.activeFoldedBlocks.length > 0 && textareaRef.current && onToggleFold) {
        const selStart = textareaRef.current.selectionStart;
        const viewText = textareaRef.current.value;
        const lineIdx = (viewText.slice(0, selStart).match(/\n/g) || []).length;
        const entry = viewModel.lineMapping[lineIdx];
        if (entry && entry.isPlaceholder && entry.blockId) {
          // If user presses Enter or Backspace or standard characters, unfold immediately
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
            e.preventDefault();
            onToggleFold(entry.blockId);
            return;
          }
        }
      }

      // Zoom from the keyboard, as in Visual Studio: Ctrl+Shift+. / Ctrl+Shift+, and Ctrl+0 for 100%
      if (e.ctrlKey && !e.altKey && (e.key === '0' || (e.shiftKey && (e.key === '>' || e.key === '.' || e.key === '<' || e.key === ',')))) {
        e.preventDefault();
        if (e.key === '0') zoomBy(1 - zoom);
        else zoomBy(e.key === '>' || e.key === '.' ? 0.1 : -0.1);
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        const textarea = textareaRef.current;
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;

        if (e.shiftKey) {
          // Outdent
          const lineStart = val.lastIndexOf('\n', start - 1) + 1;
          if (val.slice(lineStart, lineStart + 1) === '\t') {
            const nextVal = val.slice(0, lineStart) + val.slice(lineStart + 1);
            handleTextareaChange(nextVal);
            setTimeout(() => {
              textarea.selectionStart = Math.max(lineStart, start - 1);
              textarea.selectionEnd = Math.max(lineStart, end - 1);
            }, 0);
          } else if (val.slice(lineStart, lineStart + 2) === '  ') {
            const nextVal = val.slice(0, lineStart) + val.slice(lineStart + 2);
            handleTextareaChange(nextVal);
            setTimeout(() => {
              textarea.selectionStart = Math.max(lineStart, start - 2);
              textarea.selectionEnd = Math.max(lineStart, end - 2);
            }, 0);
          }
        } else {
          // Indent with tab character
          const insertText = '\t';
          const nextVal = val.substring(0, start) + insertText + val.substring(end);
          handleTextareaChange(nextVal);
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + insertText.length;
          }, 0);
        }
      }
    };

    return (
      <div
        ref={containerRef}
        onWheel={(e) => e.stopPropagation()}
        className={`relative flex-1 min-h-0 flex font-mono text-xs overflow-hidden bg-slate-950 ${className}`}
      >
        {/* Line Numbers Gutter with Code Folding Toggles */}
        <div
          ref={gutterRef}
          aria-hidden="true"
          className={`${
            enableCodeFolding ? 'w-14' : 'w-11'
          } bg-slate-950/95 py-2 select-none border-r border-slate-800/80 overflow-hidden font-mono text-slate-500 shrink-0 select-none z-10`}
          style={{ fontSize: `${11 * zoom}px`, width: zoom > 1 ? `${(enableCodeFolding ? 56 : 44) * Math.min(zoom, 2)}px` : undefined, paddingBottom: `${BOTTOM_ROOM}px` }}
        >
          {lineEntries.map((entry, idx) => {
            const isHighlighted =
              highlightedViewLineIndex !== null && highlightedViewLineIndex === idx;
            const isCaretLine = caretViewLine === idx;
            const isLiveLine = liveViewLineIndex === idx;

            return (
              <div
                key={`line-row-${idx}`}
                data-caret-line={isCaretLine ? (focused ? 'focused' : 'blurred') : undefined}
                data-live-line={isLiveLine ? 'true' : undefined}
                style={{ height: `${lineH}px`, lineHeight: `${lineH}px` }}
                className={`st-gutter-row flex items-center justify-between transition-colors px-1 rounded-sm group/gutter-row ${
                  isHighlighted
                    ? 'bg-sky-500/30 text-sky-300 font-bold ring-1 ring-sky-400'
                    : isLiveLine
                    ? 'bg-emerald-900/50'
                    : isCaretLine
                    ? focused
                      ? 'bg-slate-700/45'
                      : 'bg-slate-800/40'
                    : 'hover:bg-slate-900/60'
                }`}
              >
                {/* Left: Fold Toggle Button if foldable line or placeholder */}
                {enableCodeFolding && (
                  <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                    {entry.isPlaceholder ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (entry.blockId && onToggleFold) {
                            onToggleFold(entry.blockId);
                          }
                        }}
                        className="w-3.5 h-3.5 flex items-center justify-center text-amber-400 hover:text-amber-200 hover:scale-110 transition-transform cursor-pointer"
                        title="Click to expand collapsed block"
                      >
                        <ChevronRight className="w-3 h-3 text-amber-400 stroke-[2.5]" />
                      </button>
                    ) : entry.foldableBlockStart ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (entry.foldableBlockStart && onToggleFold) {
                            onToggleFold(entry.foldableBlockStart.id);
                          }
                        }}
                        className={`w-3.5 h-3.5 flex items-center justify-center rounded transition-all cursor-pointer ${
                          entry.isFolded
                            ? 'text-amber-300 bg-amber-950/80 hover:bg-amber-900 ring-1 ring-amber-500/60'
                            : 'text-slate-500 hover:text-sky-300 hover:bg-slate-800'
                        }`}
                        title={
                          entry.isFolded
                            ? `Expand ${entry.foldableBlockStart.type} (lines ${entry.foldableBlockStart.startLine}–${entry.foldableBlockStart.endLine})`
                            : `Collapse ${entry.foldableBlockStart.type} (lines ${entry.foldableBlockStart.startLine}–${entry.foldableBlockStart.endLine})`
                        }
                      >
                        {entry.isFolded ? (
                          <ChevronRight className="w-3 h-3 stroke-[2.5]" />
                        ) : (
                          <ChevronDown className="w-3 h-3 opacity-60 group-hover/gutter-row:opacity-100" />
                        )}
                      </button>
                    ) : null}
                  </div>
                )}

                {/* Right: Line Number and Find Match Indicator */}
                <div className="flex items-center justify-end flex-1 pr-0.5 select-none font-mono gap-1" style={{ fontSize: `${10 * zoom}px` }}>
                  {matchingViewLines.has(idx) && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 shadow-[0_0_6px_rgba(251,191,36,0.8)]"
                      title="Search match on this line"
                    />
                  )}
                  <span
                    className={`${
                      isHighlighted
                        ? 'text-sky-300 font-bold'
                        : isLiveLine
                        ? 'text-emerald-300 font-bold'
                        : isCaretLine
                        ? focused
                          ? 'text-slate-100 font-semibold'
                          : 'text-slate-300'
                        : entry.isPlaceholder
                        ? 'text-amber-400 font-semibold'
                        : matchingViewLines.has(idx)
                        ? 'text-amber-300 font-semibold'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {entry.originalLineNumber !== null ? entry.originalLineNumber : '··'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Code Viewport with Syntax-Highlighted Pre + Transparent Editable Textarea */}
        <div className="relative flex-1 min-h-0 overflow-hidden bg-slate-950">
          {/* Live: the PLC's current state's line (a green band; the view is not moved to it) */}
          {liveViewLineIndex !== null && (
            <div
              id={id ? `${id}-live-line` : undefined}
              className="st-live-line absolute left-0 right-0 pointer-events-none z-0 bg-emerald-500/20 border-l-2 border-emerald-400"
              style={{ top: `${liveViewLineIndex * lineH + 8 - scrollTop}px`, height: `${lineH}px` }}
              title="The PLC's current state"
            />
          )}

          {/* The caret's line (as in Visual Studio / TwinCAT XAE): a band with a frame, dimmer when not focused */}
          {caretViewLine !== null && caretViewLine < lineEntries.length && (
            <div
              id={id ? `${id}-caret-line` : undefined}
              className={`st-caret-line absolute left-0 right-0 pointer-events-none z-0 border-y ${
                focused ? 'bg-slate-600/30 border-slate-500/60' : 'bg-slate-700/15 border-slate-700/60'
              }`}
              style={{ top: `${caretViewLine * lineH + 8 - scrollTop}px`, height: `${lineH}px` }}
            />
          )}

          {/* Highlight line overlay */}
          {highlightedViewLineIndex !== null && (
            <div
              className="absolute left-0 right-0 pointer-events-none transition-all duration-300 bg-sky-500/15 border-l-2 border-sky-400 z-0"
              style={{
                top: `${highlightedViewLineIndex * lineH + 8 - scrollTop}px`,
                height: `${lineH}px`,
              }}
            />
          )}

          {/* Syntax-Highlighted HTML (Underneath) */}
          <pre
            ref={preRef}
            aria-hidden="true"
            tabIndex={-1}
            // (extra room at the bottom: the textarea's horizontal scrollbar lets it scroll further down than this
            // layer could, which would put its lines out of step at the end of the code)
            style={{ tabSize: 4, MozTabSize: 4, fontSize: `${fontPx}px`, lineHeight: `${lineH}px`, paddingBottom: `${BOTTOM_ROOM}px` }}
            className="absolute inset-0 m-0 p-2 font-mono whitespace-pre overflow-hidden pointer-events-none select-none text-slate-100 z-0 custom-scrollbar"
            dangerouslySetInnerHTML={{ __html: highlightedHtml + '<br/>' }}
          />

          {/* Real Transparent Editable Textarea (On Top) */}
          <textarea
            ref={textareaRef}
            id={id}
            value={activeViewCode}
            onChange={(e) => handleTextareaChange(e.target.value)}
            onClick={handleTextareaClickOrSelect}
            onSelect={() => {
              updateCaretLine();
              handleTextareaClickOrSelect();
            }}
            onFocus={() => {
              setFocused(true);
              updateCaretLine();
            }}
            onBlur={() => setFocused(false)}
            onScroll={handleScroll}
            onWheel={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDownInternal}
            onContextMenu={onContextMenu}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            placeholder={placeholder}
            aria-label={ariaLabel}
            style={{ tabSize: 4, MozTabSize: 4, fontSize: `${fontPx}px`, lineHeight: `${lineH}px` }}
            className="absolute inset-0 w-full h-full p-2 font-mono whitespace-pre bg-transparent text-transparent caret-sky-400 resize-none outline-none overflow-auto custom-scrollbar selection:bg-sky-500/30 selection:text-transparent z-10"
          />
          {/* Zoom level (bottom left, as in Visual Studio): click for 100% */}
          {showZoom && (
            <button
              type="button"
              id={id ? `${id}-zoom` : undefined}
              onClick={() => zoomBy(1 - zoom)}
              className="st-editor-zoom absolute left-2 bottom-2 z-20 px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900/90 font-sans text-[10px] text-slate-300 hover:text-sky-300 hover:border-sky-600"
              title="Text size (Ctrl+mouse wheel, Ctrl+Shift+. / Ctrl+Shift+,). Click for 100% (Ctrl+0)"
            >
              {Math.round(zoom * 100)}%
            </button>
          )}
        </div>
      </div>
    );
  }
);

StructuredTextCodeEditor.displayName = 'StructuredTextCodeEditor';
