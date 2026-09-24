import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  Copy,
  Check,
  FileImage,
  FileCode,
  Sparkles,
  Layers,
  ZoomIn,
  Sliders,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { DiagramNotes, NodeDisplayProperties } from '../types.ts';
import {
  ExportFormat,
  ExportScale,
  ExportBackground,
  DiagramExportOptions,
  exportHighResSvg,
  exportHighResPng,
  copyToClipboard,
  triggerDownload,
  prepareStandaloneSvg,
} from '../utils/diagramExport.ts';

export interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  svgElement: SVGSVGElement | null;
  baseFileName?: string;
  notes?: DiagramNotes;
  customStyles?: Record<string, NodeDisplayProperties>;
  theme?: string;
  defaultFormat?: ExportFormat;
  onToast?: (message: string, type: 'success' | 'error') => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  svgElement,
  baseFileName = 'statechart',
  notes,
  customStyles,
  theme,
  defaultFormat = 'png',
  onToast,
}) => {
  const [format, setFormat] = useState<ExportFormat>(defaultFormat);
  const [scale, setScale] = useState<ExportScale>(2);
  const [background, setBackground] = useState<ExportBackground>('dark');
  const [padding, setPadding] = useState<number>(32);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (defaultFormat) setFormat(defaultFormat);
  }, [defaultFormat, isOpen]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !svgElement) return null;

  // Calculate estimated dimensions
  let calculatedWidth = 800;
  let calculatedHeight = 600;
  try {
    const prep = prepareStandaloneSvg(svgElement, { scale, background, padding });
    calculatedWidth = prep.width;
    calculatedHeight = prep.height;
  } catch {
    // Fallback estimates
    calculatedWidth = 800 * scale;
    calculatedHeight = 600 * scale;
  }

  const exportOptions: DiagramExportOptions = {
    format,
    scale,
    background,
    padding,
    fileName: baseFileName.replace(/\.statechart|\.TcPOU/gi, ''),
    notes,
    customStyles,
    theme,
  };

  const handleDownload = async () => {
    setIsExporting(true);
    setErrorMessage(null);
    try {
      if (format === 'svg') {
        const result = await exportHighResSvg(svgElement, exportOptions);
        triggerDownload(result.blob, result.fileName);
      } else {
        const result = await exportHighResPng(svgElement, exportOptions);
        triggerDownload(result.blob, result.fileName);
      }
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopy = async () => {
    setIsExporting(true);
    setErrorMessage(null);
    try {
      const res = await copyToClipboard(svgElement, exportOptions);
      setCopyStatus('copied');
      const isRestricted = Boolean(res.message && (res.message.includes('restricted') || res.message.includes('downloaded')));
      if (isRestricted) {
        setErrorMessage(res.message || null);
      }
      const toastMsg = res.message || `Mermaid diagram ${format.toUpperCase()} copied to clipboard!`;
      onToast?.(toastMsg, isRestricted ? 'error' : 'success');
      setTimeout(() => setCopyStatus('idle'), 2500);
    } catch (err) {
      setCopyStatus('error');
      const errMsg = err instanceof Error ? err.message : 'Copy to clipboard failed.';
      setErrorMessage(errMsg);
      onToast?.(errMsg, 'error');
      setTimeout(() => setCopyStatus('idle'), 3000);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      id="export-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="export-modal-dialog"
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-slate-100"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">High-Resolution Export</h3>
              <p className="text-xs text-slate-400">
                Vector SVG & ultra-crisp raster PNG with customizable scale
              </p>
            </div>
          </div>
          <button
            id="close-export-modal"
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {/* Format selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Export Format</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                id="export-format-png"
                type="button"
                onClick={() => setFormat('png')}
                className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                  format === 'png'
                    ? 'bg-sky-950/40 border-sky-500 text-white shadow-sm ring-1 ring-sky-500/40'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <div
                  className={`p-2 rounded-lg ${
                    format === 'png' ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  <FileImage className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">PNG Image</div>
                  <div className="text-[11px] text-slate-400">High-res raster for slides, docs & chat</div>
                </div>
              </button>

              <button
                id="export-format-svg"
                type="button"
                onClick={() => setFormat('svg')}
                className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                  format === 'svg'
                    ? 'bg-sky-950/40 border-sky-500 text-white shadow-sm ring-1 ring-sky-500/40'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <div
                  className={`p-2 rounded-lg ${
                    format === 'svg' ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  <FileCode className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">SVG Vector</div>
                  <div className="text-[11px] text-slate-400">Lossless vector for Illustrator & web</div>
                </div>
              </button>
            </div>
          </div>

          {/* Scale Multiplier */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300">Resolution Multiplier</label>
              <span className="text-[11px] font-mono text-sky-400">
                {scale === 1 && '96 DPI (Standard)'}
                {scale === 2 && '150 DPI (Retina / 2x)'}
                {scale === 3 && '300 DPI (Print / 3x)'}
                {scale === 4 && '4K UHD (Maximum / 4x)'}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {([1, 2, 3, 4] as ExportScale[]).map((s) => (
                <button
                  key={s}
                  id={`export-scale-${s}x`}
                  type="button"
                  onClick={() => setScale(s)}
                  className={`py-2 px-3 rounded-xl border text-center transition-all ${
                    scale === s
                      ? 'bg-sky-600 text-white font-bold border-sky-500 shadow-sm'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <div className="text-xs">{s}x</div>
                  <div className="text-[10px] opacity-75">
                    {s === 1 && 'Standard'}
                    {s === 2 && 'Retina'}
                    {s === 3 && 'Print'}
                    {s === 4 && 'Ultra 4K'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Background Canvas Mode */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Background</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                id="export-bg-dark"
                type="button"
                onClick={() => setBackground('dark')}
                className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all ${
                  background === 'dark'
                    ? 'bg-slate-800/90 border-sky-500 text-white ring-1 ring-sky-500/40'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="w-4 h-4 rounded-full bg-slate-950 border border-slate-700 shrink-0" />
                <span className="text-xs">Dark Canvas</span>
              </button>

              <button
                id="export-bg-white"
                type="button"
                onClick={() => setBackground('white')}
                className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all ${
                  background === 'white'
                    ? 'bg-slate-800/90 border-sky-500 text-white ring-1 ring-sky-500/40'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="w-4 h-4 rounded-full bg-white border border-slate-300 shrink-0" />
                <span className="text-xs">Clean White</span>
              </button>

              <button
                id="export-bg-transparent"
                type="button"
                onClick={() => setBackground('transparent')}
                className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all ${
                  background === 'transparent'
                    ? 'bg-slate-800/90 border-sky-500 text-white ring-1 ring-sky-500/40'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="w-4 h-4 rounded-full border border-slate-600 bg-transparent flex items-center justify-center text-[9px] shrink-0 text-slate-400">
                  Ø
                </div>
                <span className="text-xs">Transparent</span>
              </button>
            </div>
          </div>

          {/* Padding / Margins */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300">Canvas Margin</label>
              <span className="text-[11px] text-slate-400 font-mono">{padding}px</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[16, 32, 48].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPadding(p)}
                  className={`py-1.5 rounded-lg border text-xs text-center transition-all ${
                    padding === p
                      ? 'bg-sky-950/50 border-sky-500 text-sky-400 font-medium'
                      : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-300'
                  }`}
                >
                  {p === 16 && 'Compact (16px)'}
                  {p === 32 && 'Balanced (32px)'}
                  {p === 48 && 'Generous (48px)'}
                </button>
              ))}
            </div>
          </div>

          {/* Dimension Details Banner */}
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-slate-300">
              <Sliders className="w-3.5 h-3.5 text-sky-400" />
              <span>Target Dimensions:</span>
            </div>
            <div className="font-mono text-sky-400 font-medium">
              {calculatedWidth} × {calculatedHeight} px
            </div>
          </div>

          {errorMessage && (
            <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-950/50 border border-rose-900/50 p-2.5 rounded-xl">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-800 bg-slate-900/90 gap-3">
          <button
            id="copy-export-button"
            type="button"
            onClick={handleCopy}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors border border-slate-700/60 disabled:opacity-50"
          >
            {copyStatus === 'copied' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied to Clipboard!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy to Clipboard</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-2">
            <button
              id="cancel-export-button"
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              id="download-export-button"
              type="button"
              onClick={handleDownload}
              disabled={isExporting}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md shadow-sky-950 transition-all disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>{isExporting ? 'Exporting...' : `Download ${format.toUpperCase()}`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
