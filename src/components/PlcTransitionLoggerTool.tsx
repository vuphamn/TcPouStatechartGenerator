import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  FileSpreadsheet,
  Upload,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Copy,
  Download,
  X,
  Play,
  Sparkles,
  Zap,
  RotateCcw,
  Check,
  Search,
  Filter,
  ArrowRight,
  Clock,
  ShieldAlert,
  Info,
} from 'lucide-react';
import { IdentifiedPouState } from '../utils/pouStateExtractor.ts';
import { EdgeInfo } from '../types.ts';
import {
  TransitionHistoryDataset,
  parsePlcHistoryLog,
  generateSampleCsvForPou,
  isTransitionInModel,
} from '../utils/transitionHistoryAnalytics.ts';

export interface PlcTransitionLoggerToolProps {
  isOpen: boolean;
  onClose: () => void;
  states: IdentifiedPouState[];
  edges: EdgeInfo[];
  pouFileName: string;
  onPopulateHistory: (dataset: TransitionHistoryDataset, message?: string) => void;
  onToast?: (message: string, type?: 'success' | 'error') => void;
}

export const PlcTransitionLoggerTool: React.FC<PlcTransitionLoggerToolProps> = ({
  isOpen,
  onClose,
  states,
  edges,
  pouFileName,
  onPopulateHistory,
  onToast,
}) => {
  // Input log text state
  const [logText, setLogText] = useState<string>('');
  const [loadedFileName, setLoadedFileName] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [copiedSample, setCopiedSample] = useState<boolean>(false);
  const [filterUnexpectedOnly, setFilterUnexpectedOnly] = useState<boolean>(false);
  const [searchPreview, setSearchPreview] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize with a default sample on first open if empty
  useEffect(() => {
    if (isOpen && !logText.trim()) {
      const sample = generateSampleCsvForPou(states, edges, 'unexpected', 'simple_3col');
      setLogText(sample.csvText);
      setLoadedFileName('sample_unexpected_transitions.csv');
    }
  }, [isOpen, states, edges]);

  // Live parsed dataset
  const parsedDataset = useMemo<TransitionHistoryDataset>(() => {
    return parsePlcHistoryLog(
      logText,
      states,
      edges,
      loadedFileName || 'Uploaded_PLC_Log.csv'
    );
  }, [logText, states, edges, loadedFileName]);

  // Table rows for preview
  const previewRows = useMemo(() => {
    let rows = parsedDataset.events;

    if (filterUnexpectedOnly) {
      rows = rows.filter((r) => r.isUnexpected);
    }

    if (searchPreview.trim()) {
      const q = searchPreview.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.fromState.toLowerCase().includes(q) ||
          r.toState.toLowerCase().includes(q) ||
          r.isoTime.toLowerCase().includes(q) ||
          r.anomalies.some((a) => a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
      );
    }

    return rows;
  }, [parsedDataset.events, filterUnexpectedOnly, searchPreview]);

  // Load a built-in sample template
  const handleLoadSample = (scenario: 'clean' | 'unexpected' | 'chatter' | 'stall', format: 'simple_3col' | 'extended_csv' = 'simple_3col') => {
    const sample = generateSampleCsvForPou(states, edges, scenario, format);
    setLogText(sample.csvText);
    setLoadedFileName(sample.fileName);
    onToast?.(`Loaded ${sample.title} (${sample.count} transitions)`, 'success');
  };

  // Handle file upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text !== undefined) {
        setLogText(text);
        setLoadedFileName(file.name);
        onToast?.(`Loaded file: ${file.name} (${file.size} bytes)`, 'success');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Drag & drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text !== undefined) {
        setLogText(text);
        setLoadedFileName(file.name);
        onToast?.(`Dropped "${file.name}" into PLC Transition Logger`, 'success');
      }
    };
    reader.readAsText(file);
  };

  // Populate Transition History tab
  const handleCommitToHistory = () => {
    if (parsedDataset.events.length === 0) {
      onToast?.('No valid transitions found to populate. Please check format.', 'error');
      return;
    }

    onPopulateHistory(
      parsedDataset,
      `Populated Transition History with ${parsedDataset.events.length} transitions (${parsedDataset.unexpectedCount} unexpected changes detected).`
    );
    onClose();
  };

  // Download current CSV
  const handleDownloadCsv = () => {
    if (!logText.trim()) return;
    const blob = new Blob([logText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = loadedFileName || `${pouFileName.replace(/\.TcPOU$/i, '')}_plc_transitions.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onToast?.('Downloaded PLC log CSV file', 'success');
  };

  // Copy sample format to clipboard
  const handleCopySample = () => {
    if (!logText) return;
    navigator.clipboard.writeText(logText).then(() => {
      setCopiedSample(true);
      setTimeout(() => setCopiedSample(false), 2000);
      onToast?.('Copied log text to clipboard', 'success');
    });
  };

  if (!isOpen) return null;

  return (
    <div
      id="plc-transition-logger-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex flex-col w-full max-w-5xl max-h-[92vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950/90 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  PLC Transition Logger
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800">
                  Data-Driven Telemetry
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Upload CSV or text logs <code className="text-sky-300 font-mono">[Timestamp, FromState, ToState]</code> to analyze real-world chronologic state changes and detect unexpected behaviors.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tool Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 flex flex-col gap-4">
          {/* Top Quick Actions: Dropzone & Presets */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            {/* Dropzone Card */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`md:col-span-6 flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                isDragOver
                  ? 'border-sky-400 bg-sky-500/10 shadow-lg'
                  : 'border-slate-700 bg-slate-950/50 hover:border-slate-600 hover:bg-slate-950/80'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,.log,.tsv,.json"
                onChange={handleFileChange}
                className="hidden"
                id="plc-logger-file-input"
              />
              <div className="flex items-center gap-2 text-sky-400 mb-1">
                <Upload className="w-5 h-5" />
                <span className="text-xs font-semibold">Drop CSV / Log file here</span>
              </div>
              <p className="text-[11px] text-slate-400 text-center">
                Supports <span className="text-slate-200">.csv</span>, <span className="text-slate-200">.txt</span>, <span className="text-slate-200">.log</span> (CSV, TSV, Beckhoff ADS, Siemens S7)
              </p>
              {loadedFileName && (
                <div className="mt-2 text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1.5">
                  <FileText className="w-3 h-3 text-sky-400" />
                  <span className="truncate max-w-[200px]">{loadedFileName}</span>
                </div>
              )}
            </div>

            {/* Quick Presets for Active POU */}
            <div className="md:col-span-6 flex flex-col justify-between bg-slate-950/60 border border-slate-800/90 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Quick-Load Realistic POU Samples:
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {states.length} States • {edges.length} Edges
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleLoadSample('clean', 'simple_3col')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 hover:text-emerald-300 transition-colors text-left"
                  title="Generates a clean, error-free production cycle CSV"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate">Clean Production Run</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleLoadSample('unexpected', 'simple_3col')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] bg-slate-900 hover:bg-slate-800 border border-amber-900/40 text-amber-300 hover:text-amber-200 transition-colors text-left"
                  title="Injects illegal transitions, dwell timeouts, and chatter"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="truncate">Injected Anomalies CSV</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleLoadSample('chatter', 'simple_3col')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 hover:text-sky-300 transition-colors text-left"
                  title="Rapid switch bounce (<20ms dwell)"
                >
                  <Zap className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span className="truncate">Sensor Bounce / Chatter</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleLoadSample('stall', 'simple_3col')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 hover:text-purple-300 transition-colors text-left"
                  title="Actuator stalls and dwell time outliers (>7000ms)"
                >
                  <Clock className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  <span className="truncate">Dwell Stall / Timeout</span>
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-800/80 text-[10px] text-slate-400">
                <span>Format: <code className="text-slate-300 font-mono">[Timestamp, FromState, ToState]</code></span>
                <button
                  type="button"
                  onClick={() => handleLoadSample('unexpected', 'extended_csv')}
                  className="text-sky-400 hover:underline"
                >
                  Switch to 6-column extended CSV
                </button>
              </div>
            </div>
          </div>

          {/* Text Input & Live Preview Area */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left: Text Input Box */}
            <div className="lg:col-span-5 flex flex-col">
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="log-text-area" className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-sky-400" />
                  Log File Content / Paste Box:
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopySample}
                    className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors"
                    title="Copy log text"
                  >
                    {copiedSample ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedSample ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLogText('');
                      setLoadedFileName('');
                    }}
                    className="text-[11px] text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors"
                    title="Clear content"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Clear</span>
                  </button>
                </div>
              </div>

              <textarea
                id="log-text-area"
                value={logText}
                onChange={(e) => setLogText(e.target.value)}
                placeholder={`Timestamp, FromState, ToState\n2026-09-24T10:00:00.000Z, STATE_INIT, STATE_IDLE\n2026-09-24T10:00:01.500Z, STATE_IDLE, STATE_RUNNING\n2026-09-24T10:00:04.200Z, STATE_RUNNING, STATE_ERROR`}
                rows={12}
                className="w-full h-72 sm:h-80 bg-slate-950 font-mono text-xs text-slate-200 p-3 rounded-xl border border-slate-800 focus:border-sky-500 focus:outline-none resize-none leading-relaxed selection:bg-sky-900"
              />

              <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                <span>{logText.split('\n').filter((l) => l.trim()).length} non-empty lines</span>
                <span>Auto-computes dwell time from consecutive timestamps</span>
              </div>
            </div>

            {/* Right: Real-time Parser Validation & Preview Table */}
            <div className="lg:col-span-7 flex flex-col">
              {/* Telemetry KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-2.5">
                  <div className="text-[10px] text-slate-400 font-medium">Transitions</div>
                  <div className="text-base font-bold text-white font-mono">
                    {parsedDataset.events.length}
                  </div>
                </div>

                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-2.5">
                  <div className="text-[10px] text-slate-400 font-medium">Total Duration</div>
                  <div className="text-base font-bold text-sky-400 font-mono">
                    {parsedDataset.totalDurationSec.toFixed(2)}s
                  </div>
                </div>

                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-2.5">
                  <div className="text-[10px] text-slate-400 font-medium">POU Compliance</div>
                  <div
                    className={`text-base font-bold font-mono ${
                      parsedDataset.complianceRate >= 90
                        ? 'text-emerald-400'
                        : parsedDataset.complianceRate >= 70
                        ? 'text-amber-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {parsedDataset.complianceRate}%
                  </div>
                </div>

                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-2.5">
                  <div className="text-[10px] text-slate-400 font-medium">Unexpected</div>
                  <div
                    className={`text-base font-bold font-mono ${
                      parsedDataset.unexpectedCount > 0 ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {parsedDataset.unexpectedCount}
                  </div>
                </div>
              </div>

              {/* Anomaly breakdown alert badge if present */}
              {parsedDataset.unexpectedCount > 0 && (
                <div className="mb-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between text-xs text-amber-300">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      Detected <strong>{parsedDataset.unexpectedCount}</strong> unexpected state changes:
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    {parsedDataset.anomalyCounts.ILLEGAL_TRANSITION > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800">
                        {parsedDataset.anomalyCounts.ILLEGAL_TRANSITION} Illegal
                      </span>
                    )}
                    {parsedDataset.anomalyCounts.CHATTER_BOUNCE > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                        {parsedDataset.anomalyCounts.CHATTER_BOUNCE} Chatter
                      </span>
                    )}
                    {parsedDataset.anomalyCounts.DWELL_TIMEOUT > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
                        {parsedDataset.anomalyCounts.DWELL_TIMEOUT} Timeout
                      </span>
                    )}
                    {parsedDataset.anomalyCounts.ABRUPT_FAULT > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800">
                        {parsedDataset.anomalyCounts.ABRUPT_FAULT} Fault Jump
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Filter & Search preview toolbar */}
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setFilterUnexpectedOnly(false)}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                      !filterUnexpectedOnly
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    All ({parsedDataset.events.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterUnexpectedOnly(true)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                      filterUnexpectedOnly
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                    <span>Unexpected Only ({parsedDataset.unexpectedCount})</span>
                  </button>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={searchPreview}
                    onChange={(e) => setSearchPreview(e.target.value)}
                    placeholder="Search preview..."
                    className="pl-7 pr-2 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-sky-500 w-36 sm:w-44"
                  />
                </div>
              </div>

              {/* Preview Table */}
              <div className="flex-1 min-h-[220px] max-h-64 sm:max-h-72 overflow-y-auto border border-slate-800 rounded-xl bg-slate-950/80 text-xs">
                {previewRows.length === 0 ? (
                  <div className="p-8 text-center text-slate-500">
                    <Info className="w-5 h-5 mx-auto mb-2 text-slate-600" />
                    <p>No transition rows to display.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-900/90 text-[10px] text-slate-400 font-semibold sticky top-0 border-b border-slate-800 uppercase tracking-wider">
                      <tr>
                        <th className="py-2 px-2.5 w-10">#</th>
                        <th className="py-2 px-2.5">Timestamp</th>
                        <th className="py-2 px-2.5">From State</th>
                        <th className="py-2 px-2.5">To State</th>
                        <th className="py-2 px-2.5">Dwell</th>
                        <th className="py-2 px-2.5">POU Model Check</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                      {previewRows.slice(0, 100).map((row) => {
                        const inModel = isTransitionInModel(row.fromState, row.toState, edges, states);
                        return (
                          <tr
                            key={row.id}
                            className={`hover:bg-slate-800/40 transition-colors ${
                              row.isUnexpected ? 'bg-amber-500/5' : ''
                            }`}
                          >
                            <td className="py-1.5 px-2.5 text-slate-500">{row.index}</td>
                            <td className="py-1.5 px-2.5 text-slate-300 truncate max-w-[130px]" title={row.isoTime}>
                              {row.formattedTime}
                            </td>
                            <td className="py-1.5 px-2.5 text-sky-300 font-medium truncate max-w-[120px]" title={row.fromState}>
                              {row.fromState}
                            </td>
                            <td className="py-1.5 px-2.5 text-indigo-300 font-medium truncate max-w-[120px]" title={row.toState}>
                              {row.toState}
                            </td>
                            <td className="py-1.5 px-2.5 text-slate-400">{row.dwellMs}ms</td>
                            <td className="py-1.5 px-2.5">
                              {row.anomalies.length > 0 ? (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold bg-rose-950/80 text-rose-300 border border-rose-800/80"
                                  title={row.anomalies.map((a) => a.description).join('\n')}
                                >
                                  <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                                  <span>{row.anomalies[0].title}</span>
                                </span>
                              ) : inModel ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-sans text-emerald-400">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  <span>Modeled</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-sans text-amber-400">
                                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                                  <span>Unmodeled</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Action Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-slate-950 border-t border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={!logText.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-40"
              title="Download CSV file formatted for your PLC transition logging scripts"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download CSV</span>
            </button>
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              Ready to feed into the time-series Transition History visualization
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>

            <button
              id="populate-transition-history-btn"
              type="button"
              onClick={handleCommitToHistory}
              disabled={parsedDataset.events.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white shadow-lg shadow-sky-950/40 transition-all disabled:opacity-40 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Populate Transition History</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/20 font-mono">
                {parsedDataset.events.length}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
