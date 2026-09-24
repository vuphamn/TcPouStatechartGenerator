import React, { useRef, useState } from 'react';
import {
  FileSpreadsheet,
  Upload,
  Sparkles,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Clock,
  Zap,
} from 'lucide-react';
import { IdentifiedPouState } from '../utils/pouStateExtractor.ts';
import { EdgeInfo } from '../types.ts';
import {
  TransitionHistoryDataset,
  parsePlcHistoryLog,
} from '../utils/transitionHistoryAnalytics.ts';

export interface PlcTransitionLoggerSidebarCardProps {
  states: IdentifiedPouState[];
  edges: EdgeInfo[];
  activeDataset: TransitionHistoryDataset | null;
  onOpenLoggerModal: () => void;
  onPopulateHistory: (dataset: TransitionHistoryDataset, message?: string) => void;
  onViewHistoryTab: () => void;
  onToast?: (message: string, type?: 'success' | 'error') => void;
}

export const PlcTransitionLoggerSidebarCard: React.FC<PlcTransitionLoggerSidebarCardProps> = ({
  states,
  edges,
  activeDataset,
  onOpenLoggerModal,
  onPopulateHistory,
  onViewHistoryTab,
  onToast,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        const parsed = parsePlcHistoryLog(content, states, edges, file.name);
        onPopulateHistory(
          parsed,
          `Imported "${file.name}": ${parsed.events.length} chronological transitions populated.`
        );
      }
    };
    reader.readAsText(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  return (
    <div
      id="plc-transition-logger-sidebar-card"
      className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex flex-col gap-2.5 transition-all"
    >
      <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
            <FileSpreadsheet className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold text-slate-200">PLC Transition Logger</span>
        </div>
        <button
          id="open-logger-modal-sidebar-btn"
          type="button"
          onClick={onOpenLoggerModal}
          className="text-[11px] text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1 transition-colors"
        >
          <span>Open Tool</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <p className="text-[11px] text-slate-400 leading-snug">
        Upload CSV / text log <code className="text-sky-300 font-mono">[Time, FromState, ToState]</code> for time-series anomaly detection.
      </p>

      {/* Mini Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`flex items-center justify-between px-2.5 py-2 rounded-lg border border-dashed cursor-pointer transition-colors ${
          isDragOver
            ? 'border-sky-400 bg-sky-500/10'
            : 'border-slate-700 bg-slate-950/60 hover:border-slate-600 hover:bg-slate-950/90'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt,.log,.tsv,.json"
          onChange={handleInputChange}
          className="hidden"
          id="sidebar-plc-logger-input"
        />
        <div className="flex items-center gap-2 text-slate-300 text-xs">
          <Upload className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span className="truncate">Upload CSV or Log...</span>
        </div>
        <span className="text-[10px] font-mono text-slate-500 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700">
          .csv / .txt
        </span>
      </div>

      {/* Active telemetry status badge */}
      {activeDataset && activeDataset.events.length > 0 ? (
        <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-2 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400 font-medium truncate max-w-[170px]" title={activeDataset.name}>
              {activeDataset.name}
            </span>
            <span className="font-mono text-sky-400 font-semibold">
              {activeDataset.events.length} evts
            </span>
          </div>

          <div className="flex items-center justify-between text-[10px] pt-1 border-t border-slate-800/60">
            <div className="flex items-center gap-1.5">
              {activeDataset.unexpectedCount > 0 ? (
                <span className="flex items-center gap-1 text-amber-400 font-medium">
                  <AlertTriangle className="w-3 h-3" />
                  <span>{activeDataset.unexpectedCount} unexpected</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 text-emerald-400 font-medium">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>100% modeled</span>
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={onViewHistoryTab}
              className="text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1"
            >
              <span>View History</span>
              <ArrowRight className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between pt-0.5">
          <span className="text-[10px] text-slate-500">No custom log loaded</span>
          <button
            type="button"
            onClick={onOpenLoggerModal}
            className="text-[10px] text-indigo-400 hover:underline flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" />
            <span>Load Sample CSV</span>
          </button>
        </div>
      )}
    </div>
  );
};
