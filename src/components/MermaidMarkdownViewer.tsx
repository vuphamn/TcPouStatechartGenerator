import React, { useState, useMemo, useRef, useEffect } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-markdown.js';
import 'prismjs/components/prism-mermaid.js';
import {
  FileCode,
  Copy,
  Check,
  Download,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  WrapText,
  Code2,
} from 'lucide-react';

export interface MermaidMarkdownViewerProps {
  code: string;
  initialWrapInMarkdown?: boolean;
  fileName?: string;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onToast?: (message: string, type: 'success' | 'error') => void;
}

export const MermaidMarkdownViewer: React.FC<MermaidMarkdownViewerProps> = ({
  code,
  initialWrapInMarkdown = true,
  fileName = 'output.statechart.md',
  searchQuery: externalSearchQuery,
  onSearchQueryChange,
  onToast,
}) => {
  const [wrapInMarkdown, setWrapInMarkdown] = useState<boolean>(initialWrapInMarkdown);
  const [wrapLines, setWrapLines] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [internalSearchQuery, setInternalSearchQuery] = useState<string>('');
  const [activeMatchIndex, setActiveMatchIndex] = useState<number>(0);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const searchInputRef = useRef<HTMLInputElement>(null);

  const effectiveSearchQuery = externalSearchQuery !== undefined ? externalSearchQuery : internalSearchQuery;

  // Compute text lines based on wrap mode
  const rawLines = useMemo(() => {
    const trimmed = code.trim();
    if (!trimmed) return [];
    
    // Check if code already contains markdown fences
    const alreadyFenced = trimmed.startsWith('```');
    
    if (wrapInMarkdown && !alreadyFenced) {
      return ['```mermaid', ...trimmed.split('\n'), '```'];
    }
    return trimmed.split('\n');
  }, [code, wrapInMarkdown]);

  // Full text representation for copying or downloading
  const fullText = useMemo(() => {
    return rawLines.join('\n');
  }, [rawLines]);

  // Highlight each line with Prism (mermaid or markdown fence)
  const highlightedLines = useMemo(() => {
    if (!rawLines.length) return [];
    
    return rawLines.map((line, index) => {
      const isFence = line.trim().startsWith('```');
      if (isFence) {
        return Prism.highlight(line, Prism.languages.markdown, 'markdown');
      }
      return Prism.highlight(line, Prism.languages.mermaid, 'mermaid');
    });
  }, [rawLines]);

  // Compute search match line indices
  const matchingLineIndices = useMemo(() => {
    const term = effectiveSearchQuery.trim().toLowerCase();
    if (!term) return [];
    
    const indices: number[] = [];
    rawLines.forEach((line, idx) => {
      if (line.toLowerCase().includes(term)) {
        indices.push(idx);
      }
    });
    return indices;
  }, [rawLines, effectiveSearchQuery]);

  // Reset or adjust active match index when matching list changes
  useEffect(() => {
    setActiveMatchIndex(0);
  }, [effectiveSearchQuery, rawLines]);

  // Scroll active match into view
  const scrollToLine = (lineIdx: number) => {
    const element = lineRefs.current.get(lineIdx);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleNextMatch = () => {
    if (matchingLineIndices.length <= 1) return;
    const nextIdx = (activeMatchIndex + 1) % matchingLineIndices.length;
    setActiveMatchIndex(nextIdx);
    scrollToLine(matchingLineIndices[nextIdx]);
  };

  const handlePrevMatch = () => {
    if (matchingLineIndices.length <= 1) return;
    const prevIdx = (activeMatchIndex - 1 + matchingLineIndices.length) % matchingLineIndices.length;
    setActiveMatchIndex(prevIdx);
    scrollToLine(matchingLineIndices[prevIdx]);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrevMatch();
      } else {
        handleNextMatch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleClearSearch();
      searchInputRef.current?.blur();
    }
  };

  const handleSearchChange = (val: string) => {
    if (onSearchQueryChange) {
      onSearchQueryChange(val);
    } else {
      setInternalSearchQuery(val);
    }
  };

  const handleClearSearch = () => {
    if (onSearchQueryChange) {
      onSearchQueryChange('');
    } else {
      setInternalSearchQuery('');
    }
    setActiveMatchIndex(0);
  };

  const handleCopy = async () => {
    if (!fullText) return;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onToast?.('Mermaid diagram markdown copied to clipboard!', 'success');
    } catch {
      // Fallback
      try {
        const textArea = document.createElement('textarea');
        textArea.value = fullText;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        onToast?.('Mermaid diagram markdown copied to clipboard!', 'success');
      } catch {
        onToast?.('Failed to copy markdown to clipboard', 'error');
      }
    }
  };

  const handleDownload = () => {
    if (!fullText) return;
    const blob = new Blob([fullText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      id="mermaid-markdown-viewer"
      className="flex flex-col w-full h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm"
    >
      {/* Header Toolbar */}
      <div
        id="markdown-viewer-toolbar"
        className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2 bg-slate-950/90 border-b border-slate-800 backdrop-blur text-xs text-slate-300 z-10 shrink-0"
      >
        {/* Left: File Badge & Mode Toggle */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-medium shrink-0 text-slate-200">
            <FileCode className="w-4 h-4 text-sky-400" />
            <span className="font-mono text-xs">{fileName}</span>
            <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] font-mono text-slate-400">
              {rawLines.length} lines
            </span>
          </div>

          {/* Mode Switcher Pills */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-[11px] shrink-0">
            <button
              type="button"
              onClick={() => setWrapInMarkdown(true)}
              className={`px-2 py-0.5 rounded font-medium transition-colors ${
                wrapInMarkdown
                  ? 'bg-slate-800 text-sky-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Wrap in ```mermaid markdown code fence for direct pasting into docs"
            >
              Markdown (```mermaid)
            </button>
            <button
              type="button"
              onClick={() => setWrapInMarkdown(false)}
              className={`px-2 py-0.5 rounded font-medium transition-colors ${
                !wrapInMarkdown
                  ? 'bg-slate-800 text-sky-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Show raw Mermaid diagram source code"
            >
              Raw Mermaid
            </button>
          </div>

          {/* Code Search Filter */}
          <div className="relative flex items-center min-w-[170px] max-w-xs w-full">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
            <input
              ref={searchInputRef}
              id="markdown-search-input"
              type="text"
              value={effectiveSearchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Filter code lines..."
              className="w-full bg-slate-900/90 border border-slate-700/80 rounded-lg pl-8 pr-16 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50 transition-all"
            />
            {effectiveSearchQuery.trim() && (
              <div className="absolute right-1.5 flex items-center gap-0.5">
                <span
                  id="markdown-search-count"
                  className={`text-[10px] font-mono px-1 py-0.5 rounded border leading-none ${
                    matchingLineIndices.length > 0
                      ? 'bg-sky-950/90 text-sky-300 border-sky-800/80'
                      : 'bg-rose-950/90 text-rose-300 border-rose-800/80'
                  }`}
                  title={`${matchingLineIndices.length} matching lines`}
                >
                  {matchingLineIndices.length > 0
                    ? `${activeMatchIndex + 1}/${matchingLineIndices.length}`
                    : '0 found'}
                </span>

                {matchingLineIndices.length > 1 && (
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={handlePrevMatch}
                      className="p-0.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
                      title="Previous line (Shift+Enter)"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleNextMatch}
                      className="p-0.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
                      title="Next line (Enter)"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="p-0.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
                  title="Clear filter (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            id="markdown-wrap-lines-btn"
            type="button"
            onClick={() => setWrapLines(!wrapLines)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-colors border ${
              wrapLines
                ? 'bg-sky-950/80 border-sky-800 text-sky-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title={wrapLines ? 'Disable line wrap' : 'Enable line wrap'}
          >
            <WrapText className="w-3.5 h-3.5" />
            <span className="text-[11px] hidden sm:inline">Wrap</span>
          </button>

          <button
            id="copy-markdown-code-btn"
            type="button"
            onClick={handleCopy}
            disabled={!fullText}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors disabled:opacity-40"
            title="Copy code to clipboard"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="text-[11px]">{copied ? 'Copied!' : 'Copy'}</span>
          </button>

          <button
            id="download-markdown-code-btn"
            type="button"
            onClick={handleDownload}
            disabled={!fullText}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-950/70 border border-sky-800/80 hover:bg-sky-900/80 text-sky-300 hover:text-sky-100 transition-colors disabled:opacity-40"
            title="Download .md file"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="text-[11px] hidden sm:inline">Download</span>
          </button>
        </div>
      </div>

      {/* Code Container with Line Numbers & Prism Syntax Highlighting */}
      <div
        id="markdown-code-scroll-container"
        className="flex-1 overflow-auto bg-slate-950 p-3 select-text font-mono text-xs leading-relaxed custom-scrollbar"
      >
        {rawLines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 py-12">
            <Code2 className="w-8 h-8 mb-2 opacity-50" />
            <p>No Mermaid code available</p>
          </div>
        ) : (
          <div className="prism-code min-w-max pb-6">
            {rawLines.map((rawLine, idx) => {
              const lineNum = idx + 1;
              const isHighlightedMatch = matchingLineIndices.includes(idx);
              const isActiveMatch =
                matchingLineIndices.length > 0 && matchingLineIndices[activeMatchIndex] === idx;

              return (
                <div
                  key={idx}
                  ref={(el) => {
                    if (el) lineRefs.current.set(idx, el);
                    else lineRefs.current.delete(idx);
                  }}
                  className={`flex items-start group rounded transition-colors duration-150 ${
                    isActiveMatch
                      ? 'bg-amber-950/60 border-l-2 border-amber-400 pl-1'
                      : isHighlightedMatch
                      ? 'bg-sky-950/40 border-l-2 border-sky-400/80 pl-1'
                      : 'hover:bg-slate-900/70 pl-1.5'
                  }`}
                >
                  {/* Line Number Gutter */}
                  <span
                    className={`w-10 shrink-0 text-right pr-3.5 select-none font-mono text-[11px] transition-colors ${
                      isActiveMatch
                        ? 'text-amber-400 font-bold'
                        : isHighlightedMatch
                        ? 'text-sky-300 font-medium'
                        : 'text-slate-600 group-hover:text-slate-400'
                    }`}
                  >
                    {lineNum}
                  </span>

                  {/* Syntax Highlighted Code Line */}
                  <div
                    className={`flex-1 font-mono text-xs ${
                      wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
                    }`}
                    dangerouslySetInnerHTML={{
                      __html: highlightedLines[idx] || ' ',
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
