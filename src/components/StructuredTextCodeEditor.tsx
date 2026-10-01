import React, { useRef, useMemo, useEffect, useLayoutEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useEditorZoom } from '../hooks/useEditorZoom.ts';
import { ChevronDown, ChevronRight, Bookmark as BookmarkIcon } from 'lucide-react';
import { completionAt, type SymbolScope } from '../utils/projectSymbols.ts';
import type { PouVariable } from '../utils/pouVariables.ts';
import { InputAssistantDialog } from './InputAssistantDialog.tsx';
import { createPortal } from 'react-dom';
import { expandSnippet, snippetFor } from '../utils/stSnippets.ts';
import { formatST } from '../utils/stFormat.ts';

/** A problem in the code: a wavy underline under [start, end) of a line (0-based columns), the message on hover */
export interface CodeMarker {
  line: number;
  start: number;
  end: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

const MARKER_COLOR = { error: '%23f43f5e', warning: '%23f59e0b', info: '%2338bdf8' };
const wave = (sev: CodeMarker['severity']) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='4'%3E%3Cpath d='M0 3 Q1.5 0 3 3 T6 3' fill='none' stroke='${MARKER_COLOR[sev]}' stroke-width='1.2'/%3E%3C/svg%3E")`;

/** The character index of a line at a column as shown (tabs of 4) */
const indexAtVisual = (text: string, vcol: number) => {
  let v = 0;
  for (let i = 0; i < text.length; i++) {
    const w = text[i] === '\t' ? 4 - (v % 4) : 1;
    if (vcol < v + w) return i;
    v += w;
  }
  return -1;
};

/** What a name is, for the hover: "nCycles : INT (VAR) — comment" */
export function describeName(scope: SymbolScope | null, text: string, index: number): string | null {
  if (!scope || index < 0 || !/\w/.test(text[index] ?? '')) return null;
  let end = index;
  while (end < text.length && /\w/.test(text[end])) end++;
  const at = completionAt(text, end);
  if (!at.word || /^\d/.test(at.word)) return null;
  const pool = at.chain && at.chain.length ? scope.members(at.chain) ?? [] : scope.top;
  const v = pool.find((x) => x.name.toLowerCase() === at.word.toLowerCase());
  if (!v) return null;
  const owner = at.chain && at.chain.length ? `${at.chain.join('.')}.` : '';
  return `${owner}${v.name}${v.type ? ` : ${v.type}` : ''}  (${v.scope})${v.comment ? `\n${v.comment}` : ''}`;
}

/** A column of a line as shown (tabs of 4) */
const visualColumn = (text: string, col: number) => {
  let v = 0;
  for (let i = 0; i < col && i < text.length; i++) v = text[i] === '\t' ? v + 4 - (v % 4) : v + 1;
  return v + Math.max(0, col - text.length);
};
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
  highlightWordOccurrences,
  wordAtCaret,
} from '../utils/stFindHighlight.ts';

/**
 * Room below the last line in the line numbers and the highlighting (overflow hidden, scrolled with the textarea):
 * more than the textarea's horizontal scrollbar, so at the very bottom they can scroll as far as it does
 */
const BOTTOM_ROOM = 48;

export interface StructuredTextCodeEditorRef {
  scrollToLine: (lineNumber: number, smooth?: boolean) => void;
  /** The caret on a line (1-based, of the code), at its first character; the focus stays where it is */
  placeCaret: (lineNumber: number) => void;
  focus: () => void;
  getTextarea: () => HTMLTextAreaElement | null;
  /** Re-indent the code (Format Document); false: nothing changed */
  formatDocument: () => boolean;
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
  /** Bookmarked lines (1-based original line numbers): a mark in the gutter */
  bookmarkLines?: number[];
  /** Completion (Ctrl+Space, and after a dot): the names the code sees */
  completionScope?: () => SymbolScope | null;
  /** Problems in the code: wavy underlines, the message on hover */
  markers?: CodeMarker[];
  /** Live: variables' values (by name or path, lower case), shown at the end of the lines that use them */
  inlineValues?: Record<string, string> | null;
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
      bookmarkLines,
      completionScope,
      markers,
      inlineValues,
    },
    ref
  ) => {
    const bookmarkSet = useMemo(() => new Set(bookmarkLines ?? []), [bookmarkLines]);
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
    const [scrollLeft, setScrollLeft] = useState(0);
    // The width of a character (monospace), to place underlines and the completion list on a line
    const [charW, setCharW] = useState(7.2);
    type Completion = { start: number; end: number; word: string; chain: string[] | null; items: PouVariable[]; active: number; forced: boolean };
    const [completion, setCompletion] = useState<Completion | null>(null);
    const completionRef = useRef<Completion | null>(null);
    completionRef.current = completion;
    const completionListRef = useRef<HTMLDivElement>(null);
    // Format Document: every line re-indented (as typing: undo works) when nothing is folded, else set directly
    const formatNow = (): boolean => {
      const formatted = formatST(value);
      if (formatted === value) return false;
      const ta = textareaRef.current;
      if (ta && !(viewModel && viewModel.activeFoldedBlocks.length > 0)) {
        ta.focus();
        const caretLine = ta.value.slice(0, ta.selectionStart).split('\n').length;
        ta.setSelectionRange(0, ta.value.length);
        if (!ta.ownerDocument.execCommand('insertText', false, formatted)) onChange(formatted);
        // (the caret back on its line, at its start)
        const at = formatted.split('\n').slice(0, caretLine - 1).join('\n').length + (caretLine > 1 ? 1 : 0);
        ta.setSelectionRange(at, at);
      } else onChange(formatted);
      return true;
    };

    // Parameter hints: the call around the caret and what it takes
    type Signature = { start: number; label: string; returns?: string; params: PouVariable[]; active: number };
    const [signature, setSignature] = useState<Signature | null>(null);
    const refreshSignature = () => {
      const ta = textareaRef.current;
      const scope = completionScope?.();
      if (!ta || !scope) return setSignature(null);
      const text = ta.value;
      const caret = ta.selectionStart;
      // Back to the unclosed "(" of the statement
      let depth = 0;
      let open = -1;
      for (let i = caret - 1; i >= 0 && caret - i < 2000; i--) {
        const ch = text[i];
        if (ch === ')') depth++;
        else if (ch === '(') {
          if (depth === 0) {
            open = i;
            break;
          }
          depth--;
        } else if (ch === ';' && depth === 0) break;
      }
      if (open < 0) return setSignature(null);
      const at = completionAt(text, open);
      if (!at.word || at.end !== open) return setSignature(null);
      const sig = scope.signature([...(at.chain ?? []), at.word]);
      if (!sig || !sig.params.length) return setSignature(null);
      // Which parameter: by name (IN := ...) or by position
      const inner = text.slice(open + 1, caret);
      let d = 0;
      let commas = 0;
      let segStart = 0;
      for (let i = 0; i < inner.length; i++) {
        if (inner[i] === '(') d++;
        else if (inner[i] === ')') d--;
        else if (inner[i] === ',' && d === 0) {
          commas++;
          segStart = i + 1;
        }
      }
      const named = inner.slice(segStart).match(/^\s*([A-Za-z_]\w*)\s*(:=|=>)/);
      const byName = named ? sig.params.findIndex((p) => p.name.toLowerCase() === named[1].toLowerCase()) : -1;
      const inputs = sig.params.filter((p) => p.scope !== 'VAR_OUTPUT');
      const active = byName >= 0 ? byName : sig.params.indexOf(inputs[Math.min(commas, inputs.length - 1)]);
      setSignature({ start: at.start - (at.chain?.length ? at.chain.join('.').length + 1 : 0), label: sig.label, returns: sig.returns, params: sig.params, active });
    };
    const signatureRef = useRef<Signature | null>(null);
    signatureRef.current = signature;

    // The Input Assistant (F2): the selection it inserts at
    const [assistant, setAssistant] = useState<{ start: number; end: number; catalog: ReturnType<SymbolScope['catalog']> } | null>(null);
    const [focused, setFocused] = useState(false);
    // The identifier at the caret: its other uses marked (while the editor has the focus, Find not on)
    const [caretWord, setCaretWord] = useState('');
    const updateCaretLine = useCallback(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const word = wordAtCaret(ta.value, ta.selectionStart, ta.selectionEnd);
      setCaretWord((prev) => (prev === word ? prev : word));
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
        return focused && caretWord ? highlightWordOccurrences(rawPrism, caretWord).html : rawPrism;
      }
      const { html } = highlightHtmlWithFindMatches(
        rawPrism,
        findQuery,
        findOptions,
        activeFindMatchIndex ?? -1
      );
      return html;
    }, [activeViewCode, findQuery, findOptions, activeFindMatchIndex, focused, caretWord]);

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

    // A line scrolled into view (a bit below the top); hidden (its tab not shown): done when it is shown
    const pendingScrollRef = useRef<number | null>(null);
    const viewIndexOf = (originalLineNum: number) => {
      const i = lineEntries.findIndex((e) => e.originalLineNumber === originalLineNum);
      return i >= 0 ? i : Math.max(0, originalLineNum - 1);
    };
    const scrollToOriginal = (originalLineNum: number, smooth: boolean) => {
      const ta = textareaRef.current;
      if (!ta || originalLineNum <= 0) return;
      if (ta.clientHeight === 0) {
        pendingScrollRef.current = originalLineNum;
        return;
      }
      pendingScrollRef.current = null;
      const targetTop = Math.max(0, viewIndexOf(originalLineNum) * lineHRef.current - 2 * lineHRef.current);
      ta.scrollTo({ top: targetTop, behavior: smooth ? 'smooth' : 'auto' });
    };
    const scrollRef = useRef(scrollToOriginal);
    scrollRef.current = scrollToOriginal;
    useEffect(() => {
      const ta = textareaRef.current;
      if (!ta || typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => {
        if (ta.clientHeight > 0 && pendingScrollRef.current !== null) scrollRef.current(pendingScrollRef.current, false);
      });
      ro.observe(ta);
      return () => ro.disconnect();
    }, []);

    // Expose imperative methods to parent
    useImperativeHandle(ref, () => ({
      scrollToLine: (originalLineNum: number, smooth = true) => scrollToOriginal(originalLineNum, smooth),
      placeCaret: (originalLineNum: number) => {
        const ta = textareaRef.current;
        // (not while it has the focus: typing there, its own caret)
        if (!ta || originalLineNum <= 0 || ta.ownerDocument.activeElement === ta) return;
        const lines = ta.value.split('\n');
        const idx = Math.min(viewIndexOf(originalLineNum), lines.length - 1);
        const at = lines.slice(0, idx).reduce((n, l) => n + l.length + 1, 0) + (lines[idx]?.match(/^\s*/)?.[0].length ?? 0);
        ta.setSelectionRange(at, at);
      },
      focus: () => {
        textareaRef.current?.focus();
      },
      getTextarea: () => textareaRef.current,
      formatDocument: () => formatNow(),
    }));

    // Auto-scroll when scrollToLine prop changes
    useEffect(() => {
      if (scrollToLine && scrollToLine > 0 && textareaRef.current) scrollToOriginal(scrollToLine, true);
    // (not on a zoom: the line height is read from the ref)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scrollToLine, lineEntries]);

    // Synchronize scrolling across textarea, pre, and gutter
    const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
      const top = e.currentTarget.scrollTop;
      const left = e.currentTarget.scrollLeft;
      setScrollTop(top);
      setScrollLeft(left);

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
      // (the list follows what is typed; so does the parameter hint)
      if (completionRef.current) requestAnimationFrame(() => refreshCompletion(completionRef.current?.forced ?? false));
      if (completionScope) requestAnimationFrame(refreshSignature);
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
    // Completion: the names at the caret's word (after "a.b.": the members of what it is)
    const refreshCompletion = (forced: boolean) => {
      const ta = textareaRef.current;
      const scope = completionScope?.();
      if (!ta || !scope) return setCompletion(null);
      const at = completionAt(ta.value, ta.selectionStart);
      const inChain = !!at.chain && at.chain.length > 0;
      if (!inChain && !at.word && !forced) return setCompletion(null);
      const pool = inChain ? scope.members(at.chain!) ?? [] : scope.top;
      const w = at.word.toLowerCase();
      const starts = w ? pool.filter((v) => v.name.toLowerCase().startsWith(w)) : pool;
      const items = w ? [...starts, ...pool.filter((v) => !starts.includes(v) && v.name.toLowerCase().includes(w))] : pool;
      if (!items.length || (!forced && items.length === 1 && items[0].name === at.word)) return setCompletion(null);
      setCompletion({ start: at.start, end: at.end, word: at.word, chain: at.chain, items: items.slice(0, 300), active: 0, forced });
    };
    const acceptCompletion = (name: string) => {
      const ta = textareaRef.current;
      const c = completionRef.current;
      if (!ta || !c) return;
      ta.focus();
      ta.setSelectionRange(c.start, c.end);
      // (as typing: the editor's own change handling and undo)
      if (!ta.ownerDocument.execCommand('insertText', false, name)) {
        const v = ta.value;
        handleTextareaChange(v.slice(0, c.start) + name + v.slice(c.end));
      }
      setCompletion(null);
    };
    useEffect(() => {
      completionListRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [completion?.active]);
    useLayoutEffect(() => {
      const ta = textareaRef.current;
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ta || !ctx) return;
      ctx.font = `${fontPx}px ${getComputedStyle(ta).fontFamily}`;
      const w = ctx.measureText('MMMMMMMMMM').width / 10;
      if (w > 0) setCharW(w);
    }, [fontPx]);

    const handleKeyDownInternal = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const c = completionRef.current;
      if (c) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const n = c.items.length;
          setCompletion({ ...c, active: (c.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
          return;
        }
        if ((e.key === 'Enter' || e.key === 'Tab') && !e.ctrlKey && !e.shiftKey) {
          e.preventDefault();
          acceptCompletion(c.items[c.active].name);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setCompletion(null);
          return;
        }
      }
      if (completionScope && e.key === 'F2' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        const scope = completionScope();
        const ta = textareaRef.current;
        if (scope && ta) {
          e.preventDefault();
          setCompletion(null);
          setAssistant({ start: ta.selectionStart, end: ta.selectionEnd, catalog: scope.catalog() });
          return;
        }
      }
      if (completionScope && e.ctrlKey && (e.key === ' ' || e.code === 'Space')) {
        e.preventDefault();
        refreshCompletion(true);
        return;
      }
      // After a dot: the members
      if (completionScope && e.key === '.' && !e.ctrlKey && !e.altKey) setTimeout(() => refreshCompletion(false), 0);
      if (signatureRef.current && e.key === 'Escape' && !completionRef.current) {
        e.preventDefault();
        e.stopPropagation();
        setSignature(null);
        return;
      }
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

      // Format Document (Shift+Alt+F)
      if (e.shiftKey && e.altKey && !e.ctrlKey && (e.key === 'F' || e.key === 'f' || e.code === 'KeyF')) {
        e.preventDefault();
        formatNow();
        return;
      }
      // A snippet: its key and Tab (not in the declaration's VAR lines: those are code editors' too, so any line)
      if (e.key === 'Tab' && !e.shiftKey && completionScope && textareaRef.current) {
        const ta = textareaRef.current;
        if (ta.selectionStart === ta.selectionEnd) {
          const before = ta.value.slice(0, ta.selectionStart);
          const lineStart = before.lastIndexOf('\n') + 1;
          const m = before.slice(lineStart).match(/(^|[\s(;])([A-Za-z_]\w*)$/);
          const snip = m ? snippetFor(m[2]) : undefined;
          if (m && snip) {
            e.preventDefault();
            const wordStart = ta.selectionStart - m[2].length;
            const indent = ta.value.slice(lineStart).match(/^[ \t]*/)![0];
            const { text, caret } = expandSnippet(snip, indent);
            ta.setSelectionRange(wordStart, ta.selectionStart);
            if (!ta.ownerDocument.execCommand('insertText', false, text)) handleTextareaChange(ta.value.slice(0, wordStart) + text + ta.value.slice(ta.selectionEnd));
            ta.setSelectionRange(wordStart + caret, wordStart + caret);
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
        ref={containerRef}
        onWheel={(e) => e.stopPropagation()}
        className={`relative flex-1 min-h-0 flex font-mono text-xs overflow-hidden bg-slate-950 ${className}`}
      >
        {/* Line Numbers Gutter with Code Folding Toggles */}
        <div
          ref={gutterRef}
          id={id ? `${id}-gutter` : undefined}
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
                data-highlighted-line={isHighlighted ? String(entry.originalLineNumber) : undefined}
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
                  {entry.originalLineNumber !== null && bookmarkSet.has(entry.originalLineNumber) && (
                    <span className="st-bookmark shrink-0 text-sky-300" data-bookmark-line={entry.originalLineNumber} title="Bookmark (right-click: PLC Bookmarks)">
                      <BookmarkIcon className="w-2.5 h-2.5 fill-sky-400" />
                    </span>
                  )}
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
              className={`st-caret-line caret-band absolute left-0 right-0 pointer-events-none z-0 ${focused ? '' : 'is-blurred'}`}
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

          {/* Live: the values of the variables a line uses, after it (the lines in view) */}
          {inlineValues && Object.keys(inlineValues).length > 0 && (
            <div id={id ? `${id}-inline-values` : undefined} className="absolute inset-0 pointer-events-none overflow-hidden z-[5]">
              {(() => {
                const lines = value.split('\n');
                const h = containerRef.current?.clientHeight ?? 800;
                const first = Math.max(0, Math.floor((scrollTop - 8) / lineH));
                const last = Math.min(lineEntries.length - 1, Math.ceil((scrollTop + h) / lineH));
                const rows: React.ReactNode[] = [];
                for (let vi = first; vi <= last; vi++) {
                  const ln = lineEntries[vi]?.originalLineNumber;
                  if (!ln) continue;
                  const text = lines[ln - 1] ?? '';
                  const code = text.replace(/\/\/.*$/, '').replace(/\(\*.*?\*\)/g, ' ').replace(/'[^']*'/g, ' ');
                  const seen = new Set<string>();
                  const parts: string[] = [];
                  for (const m of code.matchAll(/(?<![\w.#])[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*/g)) {
                    const name = m[0].replace(/\s+/g, '');
                    const k = name.toLowerCase();
                    if (seen.has(k) || inlineValues[k] === undefined) continue;
                    seen.add(k);
                    parts.push(`${name} = ${inlineValues[k]}`);
                  }
                  if (!parts.length) continue;
                  rows.push(
                    <div
                      key={vi}
                      className="st-inline-values absolute whitespace-nowrap font-mono italic text-emerald-300/80"
                      data-line={ln}
                      style={{ left: `${8 + (visualColumn(text, text.length) + 3) * charW - scrollLeft}px`, top: `${vi * lineH + 8 - scrollTop}px`, height: `${lineH}px`, lineHeight: `${lineH}px`, fontSize: `${fontPx * 0.9}px` }}
                    >
                      {parts.slice(0, 6).join('  ·  ')}
                    </div>
                  );
                }
                return rows;
              })()}
            </div>
          )}
          {/* Problems: wavy underlines */}
          {markers && markers.length > 0 && (
            <div id={id ? `${id}-markers` : undefined} className="absolute inset-0 pointer-events-none overflow-hidden z-[5]">
              {markers.map((m, i) => {
                const viewIdx = lineEntries.findIndex((en) => en.originalLineNumber === m.line);
                if (viewIdx < 0) return null;
                const text = value.split('\n')[m.line - 1] ?? '';
                const a = visualColumn(text, m.start);
                const b = visualColumn(text, m.end);
                return (
                  <div
                    key={`${m.line}-${m.start}-${i}`}
                    className={`st-marker st-marker-${m.severity} absolute`}
                    data-line={m.line}
                    data-message={m.message}
                    style={{ left: `${8 + a * charW - scrollLeft}px`, width: `${Math.max(charW, (b - a) * charW)}px`, top: `${viewIdx * lineH + 8 - scrollTop + lineH - 5}px`, height: '5px', backgroundImage: wave(m.severity), backgroundRepeat: 'repeat-x' }}
                  />
                );
              })}
            </div>
          )}
          {/* Parameter hint: what the call takes, the parameter at the caret marked */}
          {signature &&
            (() => {
              const v = textareaRef.current?.value ?? '';
              const lineStart = v.lastIndexOf('\n', signature.start - 1) + 1;
              const viewIdx = (v.slice(0, signature.start).match(/\n/g) || []).length;
              const lineText = v.slice(lineStart, v.indexOf('\n', lineStart) < 0 ? undefined : v.indexOf('\n', lineStart));
              const x = 8 + visualColumn(lineText, signature.start - lineStart) * charW - scrollLeft;
              const above = viewIdx * lineH + 8 - scrollTop - 26;
              const y = above >= 0 ? above : (viewIdx + 1) * lineH + 8 - scrollTop + (completion ? 230 : 2);
              return (
                <div
                  id={id ? `${id}-signature` : undefined}
                  className="code-signature absolute z-30 max-w-[90%] truncate rounded-md bg-slate-950 border border-sky-800/80 shadow-xl px-2 py-0.5 font-mono text-[11px] text-slate-300 pointer-events-none"
                  style={{ left: `${Math.max(4, x)}px`, top: `${y}px` }}
                >
                  <span className="text-slate-100">{signature.label}</span>(
                  {signature.params.map((p, i) => (
                    <React.Fragment key={p.name}>
                      {i > 0 && ', '}
                      <span className={i === signature.active ? 'code-signature-active text-sky-300 font-bold underline' : ''} data-param={p.name}>
                        {p.scope === 'VAR_OUTPUT' ? `=> ${p.name}` : p.name}: {p.type}
                      </span>
                    </React.Fragment>
                  ))}
                  ){signature.returns ? `: ${signature.returns}` : ''}
                  {signature.params[signature.active]?.comment && <span className="text-slate-500"> — {signature.params[signature.active].comment}</span>}
                </div>
              );
            })()}

          {/* Completion (Ctrl+Space, after a dot) */}
          {completion &&
            (() => {
              const ta = textareaRef.current;
              const v = ta?.value ?? '';
              const lineStart = v.lastIndexOf('\n', completion.start - 1) + 1;
              const viewIdx = (v.slice(0, completion.start).match(/\n/g) || []).length;
              const lineText = v.slice(lineStart, v.indexOf('\n', lineStart) < 0 ? undefined : v.indexOf('\n', lineStart));
              const x = 8 + visualColumn(lineText, completion.start - lineStart) * charW - scrollLeft;
              const y = (viewIdx + 1) * lineH + 8 - scrollTop;
              const width = containerRef.current?.clientWidth ?? 600;
              return (
                <div
                  id={id ? `${id}-completion` : undefined}
                  ref={completionListRef}
                  role="listbox"
                  className="code-completion absolute z-30 w-80 max-h-56 overflow-y-auto rounded-md bg-slate-950 border border-slate-700 shadow-2xl py-1 font-sans text-xs"
                  style={{ left: `${Math.max(4, Math.min(x, width - 330))}px`, top: `${y}px` }}
                >
                  {completion.chain && completion.chain.length > 0 && (
                    <div className="px-2.5 pb-1 text-[10px] text-slate-500 border-b border-slate-800">
                      Members of <span className="font-mono">{completion.chain.join('.')}</span>
                    </div>
                  )}
                  {completion.items.map((it, i) => (
                    <div
                      key={it.name + it.scope}
                      role="option"
                      aria-selected={i === completion.active}
                      data-active={i === completion.active ? 'true' : undefined}
                      data-name={it.name}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => i !== completion.active && setCompletion({ ...completion, active: i })}
                      onClick={() => acceptCompletion(it.name)}
                      className={`code-completion-item flex items-center gap-2 px-2.5 py-0.5 cursor-pointer font-mono ${i === completion.active ? 'bg-sky-700/40 text-white' : 'text-slate-200'}`}
                      title={it.comment}
                    >
                      <span className="truncate">{it.name}</span>
                      {it.type && <span className="text-slate-400 truncate">: {it.type}</span>}
                      <span className="ml-auto text-[10px] text-slate-500 shrink-0">{it.scope}</span>
                    </div>
                  ))}
                </div>
              );
            })()}

          {assistant && createPortal(
            <InputAssistantDialog
              catalog={assistant.catalog}
              onClose={() => {
                setAssistant(null);
                requestAnimationFrame(() => textareaRef.current?.focus());
              }}
              onInsert={(name) => {
                const ta = textareaRef.current;
                if (!ta) return;
                ta.focus();
                ta.setSelectionRange(assistant.start, assistant.end);
                if (!ta.ownerDocument.execCommand('insertText', false, name)) {
                  const v = ta.value;
                  handleTextareaChange(v.slice(0, assistant.start) + name + v.slice(assistant.end));
                }
              }}
            />,
            textareaRef.current?.ownerDocument.body ?? document.body
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
            onBlur={() => {
              setFocused(false);
              setSignature(null);
              setTimeout(() => {
                if (!completionListRef.current?.contains(document.activeElement)) setCompletion(null);
              }, 150);
            }}
            onMouseDown={() => setCompletion(null)}
            onKeyUp={(e) => {
              if (completionScope && /^(Arrow|Home|End|PageUp|PageDown)/.test(e.key)) refreshSignature();
            }}
            onMouseUp={() => completionScope && requestAnimationFrame(refreshSignature)}
            onMouseMove={(e) => {
              if (!markers?.length && !completionScope) return;
              const ta = e.currentTarget;
              const r = ta.getBoundingClientRect();
              const viewIdx = Math.floor((e.clientY - r.top - 8 + ta.scrollTop) / lineH);
              const line = lineEntries[viewIdx]?.originalLineNumber;
              const col = (e.clientX - r.left - 8 + ta.scrollLeft) / charW;
              const text = line ? value.split('\n')[line - 1] ?? '' : '';
              // A problem's message, else what the name under the pointer is (its type, block and comment)
              const hit = line && markers ? markers.find((m) => m.line === line && visualColumn(text, m.start) <= col && col <= visualColumn(text, m.end)) : undefined;
              const title = hit ? hit.message : line && completionScope ? describeName(completionScope(), text, indexAtVisual(text, Math.floor(col))) ?? '' : '';
              if (ta.title !== title) ta.title = title;
            }}
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
