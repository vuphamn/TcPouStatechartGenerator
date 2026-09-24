import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Code2,
  Save,
  RotateCcw,
  Copy,
  Check,
  ArrowRight,
  AlertCircle,
  FileCode,
  Sparkles,
  Maximize2,
  Minimize2,
  CheckCircle2,
} from 'lucide-react';
import {
  getStateCodeFromPou,
  parseTransitionsFromStateCode,
  ExtractedStateCode,
} from '../utils/pouStateEditor.ts';

export interface StateStructuredTextEditorProps {
  selectedStateId: string;
  selectedStateLabel?: string;
  tcPouContent?: string;
  tcPouFileName?: string;
  onSaveStateCode?: (stateId: string, newCode: string) => { success: boolean; error?: string };
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export const StateStructuredTextEditor: React.FC<StateStructuredTextEditorProps> = ({
  selectedStateId,
  selectedStateLabel,
  tcPouContent = '',
  tcPouFileName = 'POU.TcPOU',
  onSaveStateCode,
  isExpanded = false,
  onToggleExpand,
}) => {
  // Extract initial code for this state
  const extractedInfo = useMemo<ExtractedStateCode>(() => {
    return getStateCodeFromPou(tcPouContent, selectedStateId);
  }, [tcPouContent, selectedStateId]);

  const [code, setCode] = useState<string>('');
  const [initialCode, setInitialCode] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<{ type: 'idle' | 'success' | 'error'; message?: string }>({
    type: 'idle',
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // When selected state or pouContent changes, load code
  useEffect(() => {
    const loadedCode = extractedInfo.code || '';
    setCode(loadedCode);
    setInitialCode(loadedCode);
    setSaveStatus({ type: 'idle' });
  }, [selectedStateId, extractedInfo]);

  const isDirty = code !== initialCode;

  // Real-time parsed transitions from the current code
  const currentTransitions = useMemo(() => {
    return parseTransitionsFromStateCode(code, extractedInfo.stateVarName || 'machineState');
  }, [code, extractedInfo.stateVarName]);

  // Sync scroll between textarea and line numbers gutter
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Handle Tab key for proper indentation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;

      if (e.shiftKey) {
        // Shift+Tab: Unindent current line
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        if (val.slice(lineStart, lineStart + 1) === '\t') {
          const nextVal = val.slice(0, lineStart) + val.slice(lineStart + 1);
          setCode(nextVal);
          setTimeout(() => {
            textarea.selectionStart = Math.max(lineStart, start - 1);
            textarea.selectionEnd = Math.max(lineStart, end - 1);
          }, 0);
        } else if (val.slice(lineStart, lineStart + 2) === '  ') {
          const nextVal = val.slice(0, lineStart) + val.slice(lineStart + 2);
          setCode(nextVal);
          setTimeout(() => {
            textarea.selectionStart = Math.max(lineStart, start - 2);
            textarea.selectionEnd = Math.max(lineStart, end - 2);
          }, 0);
        }
      } else {
        // Tab: Insert tab character or 2 spaces
        const insertText = '\t';
        const nextVal = val.substring(0, start) + insertText + val.substring(end);
        setCode(nextVal);
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + insertText.length;
        }, 0);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      // Ctrl+S or Cmd+S to save
      e.preventDefault();
      handleSave();
    }
  };

  const handleSave = () => {
    if (!onSaveStateCode) {
      setSaveStatus({ type: 'error', message: 'Save handler not available.' });
      return;
    }

    try {
      const res = onSaveStateCode(selectedStateId, code);
      if (res.success) {
        setInitialCode(code);
        setSaveStatus({
          type: 'success',
          message: `Saved to ${tcPouFileName}! Diagram & Markdown updated.`,
        });
        setTimeout(() => {
          setSaveStatus((prev) => (prev.type === 'success' ? { type: 'idle' } : prev));
        }, 3500);
      } else {
        setSaveStatus({
          type: 'error',
          message: res.error || 'Failed to save changes to .TcPOU file.',
        });
      }
    } catch (err) {
      setSaveStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unknown error during save.',
      });
    }
  };

  const handleRevert = () => {
    setCode(initialCode);
    setSaveStatus({ type: 'idle' });
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleScaffoldBranch = () => {
    const starterTemplate = `IF (bFirstPass) THEN\n\t// Initialization logic for ${selectedStateId}\nEND_IF\n\n// Add state transition or action logic\n// ${extractedInfo.stateVarName} := NEXT_STATE;\n`;
    setCode(starterTemplate);
  };

  const lineCount = useMemo(() => {
    return Math.max(1, code.split('\n').length);
  }, [code]);

  return (
    <div id="state-st-code-editor" className="flex flex-col text-xs text-slate-200">
      {/* State & Method Context Banner */}
      <div className="px-3.5 py-2 bg-slate-950/70 border-b border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <FileCode className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <div className="flex items-center gap-1 text-[11px] font-mono text-slate-300 truncate">
            <span className="text-slate-500">doState()</span>
            <span className="text-slate-600">›</span>
            <span className="text-sky-400 font-semibold">{selectedStateId}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Unsaved changes badge */}
          {isDirty ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-medium animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Unsaved
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 text-[10px]">
              In sync
            </span>
          )}

          {/* Expand/Collapse Toggle */}
          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title={isExpanded ? 'Standard width' : 'Expand editor width'}
            >
              {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* Copy Code */}
          <button
            type="button"
            onClick={handleCopyCode}
            disabled={!code.trim()}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-40 transition-colors"
            title="Copy Structured Text"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* CASE Header Context Bar */}
      <div className="px-3.5 py-1.5 bg-slate-900/90 border-b border-slate-800/80 flex items-center justify-between text-[11px] font-mono">
        <div className="flex items-center gap-1.5 text-slate-400 truncate">
          <span className="text-sky-400/90">CASE</span>
          <span className="text-slate-300">({extractedInfo.stateVarName})</span>
          <span className="text-sky-400/90">OF</span>
          <span className="text-slate-500">→</span>
          <span className="text-amber-300 font-semibold">{extractedInfo.caseLabelLine}</span>
        </div>

        <span className="text-[10px] text-slate-500 shrink-0">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        </span>
      </div>

      {/* Missing Branch Notice */}
      {!extractedInfo.hasCaseBranch && (
        <div className="m-3 p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/50 flex flex-col gap-1.5 text-amber-200">
          <div className="flex items-start gap-2 text-xs">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">No CASE statement branch found</span> for{' '}
              <code className="text-amber-300 font-mono text-[11px]">{selectedStateId}</code> in{' '}
              <code className="text-slate-300">doState()</code>.
            </div>
          </div>
          <button
            type="button"
            onClick={handleScaffoldBranch}
            className="self-start mt-1 px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-medium text-xs flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Scaffold State Branch Template
          </button>
        </div>
      )}

      {/* Structured Text Code Editor Area with Line Numbers */}
      <div className="relative flex bg-slate-950 border-b border-slate-800/90 font-mono text-xs">
        {/* Line Numbers Gutter */}
        <div
          ref={lineNumbersRef}
          aria-hidden="true"
          className="select-none py-3 pl-3 pr-2 text-right bg-slate-950 text-slate-600 border-r border-slate-800/80 font-mono text-[11px] leading-[1.625rem] min-w-[38px] overflow-hidden"
          style={{ maxHeight: isExpanded ? '480px' : '280px' }}
        >
          {Array.from({ length: lineCount }).map((_, idx) => (
            <div key={idx + 1}>{idx + 1}</div>
          ))}
        </div>

        {/* Textarea Editor */}
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            id="state-st-code-textarea"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={`// Structured Text code for ${selectedStateId}\n// E.g.:\nIF (bFirstPass) THEN\n\t// setup actions\nEND_IF\n\n// Transition:\n${extractedInfo.stateVarName} := NEXT_STATE;`}
            className="w-full py-3 px-3.5 bg-transparent text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono text-xs sm:text-[12.5px] leading-[1.625rem] resize-none overflow-y-auto whitespace-pre tab-4"
            style={{
              height: isExpanded ? '480px' : '280px',
              tabSize: 4,
            }}
          />
        </div>
      </div>

      {/* Detected Transitions Pill Bar */}
      <div className="px-3.5 py-2 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-1.5 text-slate-400 overflow-x-auto py-0.5 no-scrollbar">
          <span className="text-slate-500 font-medium shrink-0">Transitions:</span>
          {currentTransitions.length > 0 ? (
            currentTransitions.map((target) => (
              <span
                key={target}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-950/60 border border-sky-800/60 text-sky-300 font-mono text-[10px] shrink-0"
              >
                <ArrowRight className="w-2.5 h-2.5 text-sky-400" />
                {target}
              </span>
            ))
          ) : (
            <span className="text-slate-500 italic text-[10px]">None assigned in this block</span>
          )}
        </div>

        <span className="text-[10px] text-slate-500 shrink-0 hidden sm:inline">
          Ctrl+S to save
        </span>
      </div>

      {/* Save Notification Alert */}
      {saveStatus.type !== 'idle' && (
        <div
          className={`px-3.5 py-2 flex items-center gap-2 text-xs border-b ${
            saveStatus.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/60 border-rose-800 text-rose-300'
          }`}
        >
          {saveStatus.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span className="truncate">{saveStatus.message}</span>
        </div>
      )}

      {/* Bottom Actions Bar */}
      <div className="p-3 bg-slate-900/90 flex items-center justify-between gap-2">
        <button
          type="button"
          id="revert-state-code-btn"
          onClick={handleRevert}
          disabled={!isDirty}
          className="px-2.5 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:hover:bg-slate-800 text-xs font-medium flex items-center gap-1.5 transition-colors"
          title="Revert back to original code in file"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Revert
        </button>

        <button
          type="button"
          id="save-state-code-btn"
          onClick={handleSave}
          disabled={!isDirty}
          className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:from-slate-700 disabled:to-slate-700 text-white disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold shadow-md flex items-center gap-1.5 transition-all"
          title="Save changes back to input .TcPOU and refresh diagram (Ctrl+S / Cmd+S)"
        >
          <Save className="w-3.5 h-3.5" />
          <span>Save to .TcPOU</span>
        </button>
      </div>
    </div>
  );
};
