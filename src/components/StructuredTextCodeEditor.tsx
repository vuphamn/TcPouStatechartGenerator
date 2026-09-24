import React, { useRef, useMemo, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
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
        const targetTop = Math.max(0, targetViewIdx * 20 - 40);
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
        const targetTop = Math.max(0, targetViewIdx * 20 - 40);
        textareaRef.current.scrollTo({
          top: targetTop,
          behavior: 'smooth',
        });
      }
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
        onWheel={(e) => e.stopPropagation()}
        className={`relative flex-1 min-h-0 flex font-mono text-xs overflow-hidden bg-slate-950 ${className}`}
      >
        {/* Line Numbers Gutter with Code Folding Toggles */}
        <div
          ref={gutterRef}
          aria-hidden="true"
          className={`${
            enableCodeFolding ? 'w-14' : 'w-11'
          } bg-slate-950/95 py-2 select-none border-r border-slate-800/80 overflow-hidden font-mono text-[11px] text-slate-500 shrink-0 select-none z-10`}
        >
          {lineEntries.map((entry, idx) => {
            const isHighlighted =
              highlightedViewLineIndex !== null && highlightedViewLineIndex === idx;

            return (
              <div
                key={`line-row-${idx}`}
                className={`leading-5 h-5 flex items-center justify-between transition-colors px-1 rounded-sm group/gutter-row ${
                  isHighlighted
                    ? 'bg-sky-500/30 text-sky-300 font-bold ring-1 ring-sky-400'
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
                <div className="flex items-center justify-end flex-1 pr-0.5 select-none font-mono text-[10px] gap-1">
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
          {/* Highlight line overlay */}
          {highlightedViewLineIndex !== null && (
            <div
              className="absolute left-0 right-0 pointer-events-none transition-all duration-300 bg-sky-500/15 border-l-2 border-sky-400 z-0"
              style={{
                top: `${highlightedViewLineIndex * 20 + 8 - scrollTop}px`,
                height: '20px',
              }}
            />
          )}

          {/* Syntax-Highlighted HTML (Underneath) */}
          <pre
            ref={preRef}
            aria-hidden="true"
            tabIndex={-1}
            style={{ tabSize: 4, MozTabSize: 4 }}
            className="absolute inset-0 m-0 p-2 font-mono text-xs leading-5 whitespace-pre overflow-hidden pointer-events-none select-none text-slate-100 z-0 custom-scrollbar"
            dangerouslySetInnerHTML={{ __html: highlightedHtml + '<br/>' }}
          />

          {/* Real Transparent Editable Textarea (On Top) */}
          <textarea
            ref={textareaRef}
            id={id}
            value={activeViewCode}
            onChange={(e) => handleTextareaChange(e.target.value)}
            onClick={handleTextareaClickOrSelect}
            onSelect={handleTextareaClickOrSelect}
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
            style={{ tabSize: 4, MozTabSize: 4 }}
            className="absolute inset-0 w-full h-full p-2 font-mono text-xs leading-5 whitespace-pre bg-transparent text-transparent caret-sky-400 resize-none outline-none overflow-auto custom-scrollbar selection:bg-sky-500/30 selection:text-transparent z-10"
          />
        </div>
      </div>
    );
  }
);

StructuredTextCodeEditor.displayName = 'StructuredTextCodeEditor';
