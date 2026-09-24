import React, { useRef, useState, useMemo } from 'react';
import { Upload, FileCode, Edit3, ExternalLink, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';

interface FileDropzoneProps {
  label: string;
  fileExtension: string;
  fileName: string | null;
  content: string;
  onFileLoaded: (name: string, content: string) => void;
  onContentChanged: (content: string) => void;
  idPrefix: string;
  onOpenEditor?: () => void;
  editorButtonLabel?: string;
  editorButtonTooltip?: string;
  defaultExpanded?: boolean;
}

export const FileDropzone: React.FC<FileDropzoneProps> = ({
  label,
  fileExtension,
  fileName,
  content,
  onFileLoaded,
  onContentChanged,
  idPrefix,
  onOpenEditor,
  editorButtonLabel,
  editorButtonTooltip,
  defaultExpanded = true,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);

  const lineCount = useMemo(() => {
    if (!content) return 0;
    return content.split('\n').length;
  }, [content]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || '';
      onFileLoaded(file.name, text);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || '';
      onFileLoaded(file.name, text);
    };
    reader.readAsText(file);
  };

  const handleCopyContent = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      id={`${idPrefix}-container`}
      className="flex flex-col bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden p-3.5 transition-colors hover:border-slate-700/80 shrink-0 shadow-sm"
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800/80 select-none">
        <div
          className="flex items-center gap-2 min-w-0 cursor-pointer hover:opacity-90 transition-opacity"
          onClick={() => setIsExpanded(!isExpanded)}
          title={isExpanded ? 'Click to collapse panel' : 'Click to expand panel'}
        >
          <div className="w-5 h-5 rounded-md bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
            <FileCode className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold text-slate-200 truncate" title={label}>
            {label}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-950/80 text-sky-400 border border-sky-800/40 font-mono font-medium shrink-0">
            {fileExtension}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onOpenEditor && (
            <button
              id={`${idPrefix}-open-editor-btn`}
              type="button"
              onClick={onOpenEditor}
              className="text-[11px] text-sky-400 hover:text-sky-300 font-semibold flex items-center gap-1 bg-sky-950/60 border border-sky-800/60 hover:bg-sky-900/60 px-2 py-0.5 rounded-md transition-colors"
              title={
                editorButtonTooltip ||
                (editorButtonLabel && editorButtonLabel !== 'Edit'
                  ? `Open ${editorButtonLabel}`
                  : `Edit ${label}`)
              }
            >
              <Edit3 className="w-3 h-3 text-sky-400 shrink-0" />
              <span>{editorButtonLabel || 'Edit'}</span>
            </button>
          )}

          <button
            id={`${idPrefix}-choose-file-btn`}
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-[11px] text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2 py-0.5 rounded-md font-medium flex items-center gap-1 transition-colors"
            title={`Browse and load a ${fileExtension} file`}
          >
            <Upload className="w-3 h-3 shrink-0" />
            <span>Browse</span>
          </button>

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800 transition-colors ml-0.5"
            title={isExpanded ? 'Collapse' : 'Expand'}
            aria-label={isExpanded ? 'Collapse panel' : 'Expand panel'}
          >
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={fileExtension}
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Panel Body */}
      {isExpanded ? (
        <div className="pt-2.5 flex flex-col gap-2">
          {content ? (
            <div
              id={`${idPrefix}-dropzone`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="flex flex-col bg-slate-950/70 rounded-lg border border-slate-800 hover:border-slate-700 transition-colors overflow-hidden"
            >
              {/* File Info Subheader Bar */}
              <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-900/80 border-b border-slate-800/80 text-[11px] text-slate-400">
                <div className="flex items-center gap-1.5 min-w-0 pr-2">
                  <span
                    className="font-mono text-slate-200 truncate font-medium text-[11px]"
                    title={fileName || `Custom ${fileExtension}`}
                  >
                    {fileName || `Custom ${fileExtension}`}
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700/60 shrink-0">
                    {lineCount} {lineCount === 1 ? 'line' : 'lines'}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCopyContent}
                    className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors px-1.5 py-0.5 rounded hover:bg-slate-800"
                    title="Copy source content to clipboard"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="text-emerald-400 font-medium">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 shrink-0" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>

                  {onOpenEditor && (
                    <button
                      type="button"
                      onClick={onOpenEditor}
                      className="text-sky-400 hover:text-sky-300 flex items-center gap-1 text-[10px] font-medium transition-colors"
                      title={editorButtonLabel ? `Open in ${editorButtonLabel}` : 'Open dedicated editor'}
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span>{editorButtonLabel || 'Open Editor'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Textarea Code Editor */}
              <div className="p-2 flex flex-col">
                <textarea
                  id={`${idPrefix}-editor`}
                  rows={8}
                  value={content}
                  onChange={(e) => onContentChanged(e.target.value)}
                  placeholder={`Paste or edit ${fileExtension} content here...`}
                  className="w-full h-44 sm:h-52 min-h-[140px] bg-slate-950/80 text-slate-200 font-mono text-[11px] leading-relaxed custom-scrollbar p-2 rounded border border-slate-800/80 focus:border-sky-500/60 focus:ring-1 focus:ring-sky-500/20 focus:outline-none resize-y"
                  spellCheck={false}
                />
              </div>
            </div>
          ) : (
            <div
              id={`${idPrefix}-dropzone`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center min-h-[140px] p-4 bg-slate-950/50 rounded-lg border border-dashed border-slate-800 hover:border-sky-500/60 hover:bg-slate-950/80 transition-colors cursor-pointer text-slate-500 hover:text-slate-400"
            >
              <Upload className="w-6 h-6 mb-1.5 text-slate-600 hover:text-sky-400 transition-colors" />
              <p className="text-xs font-semibold text-slate-300">Drop {fileExtension} file here</p>
              <p className="text-[11px] text-slate-500 mt-0.5">or click to browse from computer</p>
            </div>
          )}
        </div>
      ) : (
        /* Collapsed Summary View */
        <div
          onClick={() => setIsExpanded(true)}
          className="pt-2 flex items-center justify-between text-[11px] text-slate-400 cursor-pointer hover:text-slate-300 transition-colors select-none"
          title="Click to expand panel"
        >
          <span className="font-mono truncate max-w-[200px] text-slate-300">
            {fileName || (content ? `Custom ${fileExtension}` : `No file loaded`)}
          </span>
          <span className="text-[10px] text-slate-500 font-mono">
            {content ? `${lineCount} lines (click to expand)` : 'Empty (click to expand)'}
          </span>
        </div>
      )}
    </div>
  );
};
