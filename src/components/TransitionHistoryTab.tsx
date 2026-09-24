import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  History,
  AlertTriangle,
  CheckCircle2,
  Play,
  Pause,
  RotateCcw,
  Upload,
  Download,
  Search,
  ArrowRight,
  Clock,
  Zap,
  Sliders,
  Filter,
  ExternalLink,
  ChevronRight,
  ShieldAlert,
  FileText,
  FileSpreadsheet,
  Copy,
  Check,
  Maximize2,
  ZoomIn,
  ZoomOut,
  Layers,
  Activity,
  AlertOctagon,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { IdentifiedPouState } from '../utils/pouStateExtractor.ts';
import { EdgeInfo } from '../types.ts';
import {
  TransitionHistoryDataset,
  ChronologicalTransitionEvent,
  TransitionAnomaly,
  TransitionAnomalyType,
  StateTimeInterval,
  parsePlcHistoryLog,
  generateSyntheticHistoryLog,
} from '../utils/transitionHistoryAnalytics.ts';
import { PlcTransitionLoggerTool } from './PlcTransitionLoggerTool.tsx';

export interface TransitionHistoryTabProps {
  states: IdentifiedPouState[];
  edges: EdgeInfo[];
  pouFileName: string;
  activeDataset?: TransitionHistoryDataset | null;
  onDatasetChange?: (dataset: TransitionHistoryDataset) => void;
  onJumpToState: (stateId: string, label?: string) => void;
  onToast?: (message: string, type?: 'success' | 'error') => void;
}

export const TransitionHistoryTab: React.FC<TransitionHistoryTabProps> = ({
  states,
  edges,
  pouFileName,
  activeDataset,
  onDatasetChange,
  onJumpToState,
  onToast,
}) => {
  // Preset scenario selection
  const [selectedScenario, setSelectedScenario] = useState<
    'unexpected_anomalies' | 'production_clean' | 'sensor_chatter' | 'dwell_stall'
  >('unexpected_anomalies');

  // Active dataset
  const [dataset, setDataset] = useState<TransitionHistoryDataset>(() => {
    return activeDataset || generateSyntheticHistoryLog(states, edges, 'unexpected_anomalies');
  });

  // Sync with activeDataset if passed from parent
  useEffect(() => {
    if (activeDataset) {
      setDataset(activeDataset);
    }
  }, [activeDataset]);

  // Re-run synthetic log when states/edges change and dataset is a preset and no external activeDataset
  useEffect(() => {
    if (!activeDataset && dataset.source === 'preset') {
      const newDs = generateSyntheticHistoryLog(states, edges, selectedScenario);
      setDataset(newDs);
      onDatasetChange?.(newDs);
    }
  }, [states, edges, selectedScenario, activeDataset]);

  // View style: 'waveform' (stepped logic analyzer) vs 'swimlane' (Gantt multi-track)
  const [viewMode, setViewMode] = useState<'waveform' | 'swimlane'>('waveform');

  // Zoom and pan
  const [zoomLevel, setZoomLevel] = useState<number>(1); // 0.5 to 5
  const [timelineScrollLeft, setTimelineScrollLeft] = useState<number>(0);
  const timelineContainerRef = useRef<HTMLDivElement>(null);

  // Selected event for detailed inspector
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Filtering
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [anomalyFilter, setAnomalyFilter] = useState<'all' | 'unexpected_only' | TransitionAnomalyType>(
    'all'
  );
  const [selectedStateFilter, setSelectedStateFilter] = useState<string>('all');

  // Time scrubber cursor (in relative seconds)
  const [scrubberSec, setScrubberSec] = useState<number | null>(null);

  // Playback simulation
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const playbackTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Dedicated PLC Transition Logger Tool Modal
  const [isLoggerToolOpen, setIsLoggerToolOpen] = useState<boolean>(false);
  const [copiedReport, setCopiedReport] = useState<boolean>(false);

  // Hovered item for tooltip
  const [hoveredEvent, setHoveredEvent] = useState<ChronologicalTransitionEvent | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Initialize selected event
  useEffect(() => {
    if (!selectedEventId && dataset.events.length > 0) {
      // Prioritize selecting an unexpected event if present
      const firstUnexpected = dataset.events.find((e) => e.isUnexpected);
      setSelectedEventId(firstUnexpected ? firstUnexpected.id : dataset.events[0].id);
    }
  }, [dataset, selectedEventId]);

  // Active selected event object
  const activeSelectedEvent = useMemo(() => {
    return dataset.events.find((e) => e.id === selectedEventId) || null;
  }, [dataset.events, selectedEventId]);

  // Unique state list ordered for Y-axis
  const orderedStates = useMemo(() => {
    const canonicalOrder = states.map((s) => s.id);
    const extra = dataset.uniqueStates.filter((st) => !canonicalOrder.includes(st));
    return [...canonicalOrder, ...extra];
  }, [states, dataset.uniqueStates]);

  // State color mapping
  const stateColorMap = useMemo(() => {
    const palette = [
      '#38bdf8', // sky-400
      '#818cf8', // indigo-400
      '#34d399', // emerald-400
      '#fbbf24', // amber-400
      '#a78bfa', // purple-400
      '#f472b6', // pink-400
      '#2dd4bf', // teal-400
      '#fb923c', // orange-400
      '#e879f9', // fuchsia-400
    ];

    const map: Record<string, string> = {};
    orderedStates.forEach((st, idx) => {
      const lower = st.toLowerCase();
      if (lower.includes('err') || lower.includes('fault') || lower.includes('abort')) {
        map[st] = '#f43f5e'; // rose-500
      } else if (lower.includes('idle') || lower.includes('init') || lower.includes('ready')) {
        map[st] = '#38bdf8'; // sky-400
      } else {
        map[st] = palette[idx % palette.length];
      }
    });
    return map;
  }, [orderedStates]);

  // Filtered events
  const filteredEvents = useMemo(() => {
    return dataset.events.filter((ev) => {
      // Anomaly filter
      if (anomalyFilter === 'unexpected_only' && !ev.isUnexpected) return false;
      if (
        anomalyFilter !== 'all' &&
        anomalyFilter !== 'unexpected_only' &&
        !ev.anomalies.some((a) => a.type === anomalyFilter)
      ) {
        return false;
      }

      // State filter
      if (selectedStateFilter !== 'all') {
        if (ev.fromState !== selectedStateFilter && ev.toState !== selectedStateFilter) {
          return false;
        }
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesFrom = ev.fromState.toLowerCase().includes(q);
        const matchesTo = ev.toState.toLowerCase().includes(q);
        const matchesGuard = ev.guardFired?.toLowerCase().includes(q);
        const matchesAnomaly = ev.anomalies.some(
          (a) => a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
        );
        if (!matchesFrom && !matchesTo && !matchesGuard && !matchesAnomaly) return false;
      }

      return true;
    });
  }, [dataset.events, anomalyFilter, selectedStateFilter, searchQuery]);

  // Time scrubber playback loop
  useEffect(() => {
    if (!isPlaying) {
      if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
      return;
    }

    const intervalMs = 50;
    const stepSec = (intervalMs / 1000) * playbackSpeed;

    playbackTimerRef.current = setInterval(() => {
      setScrubberSec((prev) => {
        const current = prev !== null ? prev : 0;
        const next = current + stepSec;
        if (next > dataset.totalDurationSec) {
          setIsPlaying(false);
          return dataset.totalDurationSec;
        }

        // Auto-select event under scrubber
        const evUnder = dataset.events.find((e) => Math.abs(e.relativeSec - next) < 0.25);
        if (evUnder) {
          setSelectedEventId(evUnder.id);
        }

        return next;
      });
    }, intervalMs);

    return () => {
      if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
    };
  }, [isPlaying, playbackSpeed, dataset.totalDurationSec, dataset.events]);

  // Handle preset scenario switch
  const handleSelectScenario = (
    scenario: 'unexpected_anomalies' | 'production_clean' | 'sensor_chatter' | 'dwell_stall'
  ) => {
    setSelectedScenario(scenario);
    const newDs = generateSyntheticHistoryLog(states, edges, scenario);
    setDataset(newDs);
    onDatasetChange?.(newDs);
    setScrubberSec(0);
    setIsPlaying(false);
    onToast?.(`Loaded ${newDs.name} (${newDs.events.length} transitions)`, 'success');
  };

  // Export Chronological History as CSV
  const handleExportCsv = () => {
    const headers = [
      'Index',
      'RelativeSeconds',
      'ISO_Time',
      'FromState',
      'ToState',
      'Dwell_ms',
      'Cycle',
      'IsUnexpected',
      'AnomalyTypes',
      'AnomalyDetails',
      'GuardFired',
    ];
    const rows = dataset.events.map((e) => [
      e.index,
      e.relativeSec.toFixed(3),
      `"${e.isoTime}"`,
      `"${e.fromState}"`,
      `"${e.toState}"`,
      e.dwellMs,
      e.cycleNumber || 1,
      e.isUnexpected ? 'TRUE' : 'FALSE',
      `"${e.anomalies.map((a) => a.type).join('; ')}"`,
      `"${e.anomalies.map((a) => a.title + ': ' + a.description).join(' | ').replace(/"/g, '""')}"`,
      `"${(e.guardFired || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pouFileName.replace(/\.TcPOU$/i, '')}_transition_history.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onToast?.('Exported Transition History to CSV!', 'success');
  };

  // Copy Anomaly Diagnostics Report
  const handleCopyDiagnosticsReport = () => {
    const unexpectedEvents = dataset.events.filter((e) => e.isUnexpected);
    const lines = [
      `# PLC Transition History & Anomaly Diagnostics Report`,
      `Generated: ${new Date().toLocaleString()}`,
      `File: ${pouFileName}`,
      `Total Chronological Transitions: ${dataset.events.length}`,
      `Duration: ${dataset.totalDurationSec.toFixed(2)}s`,
      `Statechart Compliance Rate: ${dataset.complianceRate}%`,
      `Unexpected Changes Flagged: ${dataset.unexpectedCount}`,
      ``,
      `## Anomaly Summary:`,
      `- Illegal Transitions (Not in POU): ${dataset.anomalyCounts.ILLEGAL_TRANSITION}`,
      `- Chatter / Rapid Bouncing: ${dataset.anomalyCounts.CHATTER_BOUNCE}`,
      `- State Dwell Timeouts / Stalls: ${dataset.anomalyCounts.DWELL_TIMEOUT}`,
      `- Abrupt Fault State Jumps: ${dataset.anomalyCounts.ABRUPT_FAULT}`,
      ``,
      `## Flagged Chronological Events:`,
      ...unexpectedEvents.map((e) => {
        const anomalyDescs = e.anomalies.map((a) => `  * [${a.type}] ${a.title}: ${a.description}`).join('\n');
        return `### Step #${e.index} (+${e.relativeSec.toFixed(3)}s) - ${e.fromState} ➔ ${e.toState}\n- Dwell: ${e.dwellMs}ms | Cycle: #${e.cycleNumber}\n${anomalyDescs}`;
      }),
    ];

    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2000);
      onToast?.('Diagnostics report copied to clipboard!', 'success');
    });
  };

  // Timeline Geometry Dimensions
  const totalDuration = Math.max(1, dataset.totalDurationSec);
  const pxPerSec = 120 * zoomLevel;
  const chartWidth = Math.max(800, totalDuration * pxPerSec + 150);
  const laneHeight = 36;
  const topPadding = 40;
  const bottomPadding = 45;
  const stateCount = Math.max(1, orderedStates.length);
  const chartHeight = topPadding + stateCount * laneHeight + bottomPadding;

  // Jump to Diagram Handler
  const handleJumpToStateFromHistory = (stateId: string) => {
    onJumpToState(stateId, stateId);
    onToast?.(`Focused "${stateId}" in Diagram Canvas`, 'success');
  };

  // Scroll timeline to event
  const handleFocusEventOnTimeline = (event: ChronologicalTransitionEvent) => {
    setSelectedEventId(event.id);
    setScrubberSec(event.relativeSec);
    if (timelineContainerRef.current) {
      const targetScroll = event.relativeSec * pxPerSec - timelineContainerRef.current.clientWidth / 2;
      timelineContainerRef.current.scrollTo({
        left: Math.max(0, targetScroll),
        behavior: 'smooth',
      });
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-200 overflow-hidden select-none">
      {/* Top Header Bar */}
      <div className="px-3.5 py-2 border-b border-slate-800/80 bg-slate-900/60 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Left Title & Description */}
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-950/80 border border-indigo-800/60 text-indigo-400 shadow-xs">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-100 tracking-tight">Transition History</h1>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800/80">
                  Time-Series & Anomaly Detection
                </span>
                {dataset.unexpectedCount > 0 ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-950 text-rose-300 border border-rose-800 animate-pulse">
                    <AlertTriangle className="w-3 h-3" />
                    {dataset.unexpectedCount} Unexpected Changes
                  </span>
                ) : (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
                    <CheckCircle2 className="w-3 h-3" />
                    100% Model Compliant
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Chronological time-series reconstruction of PLC state transitions with automated detection of illegal paths, chatter, and dwell stalls.
              </p>
            </div>
          </div>

          {/* Right Toolbar: Preset Selector, Import, Export, Mode */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Scenario Preset Selector */}
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-lg text-xs">
              <span className="text-slate-400 text-[11px] font-medium">Scenario:</span>
              <select
                value={selectedScenario}
                onChange={(e) => handleSelectScenario(e.target.value as any)}
                className="bg-transparent text-slate-200 text-xs font-semibold focus:outline-hidden cursor-pointer"
                title="Select a pre-configured PLC log scenario"
              >
                <option value="unexpected_anomalies" className="bg-slate-900 text-slate-200">
                  ⚠️ Unexpected Changes & Fault Injection
                </option>
                <option value="production_clean" className="bg-slate-900 text-slate-200">
                  ✓ Golden Batch (100% Expected)
                </option>
                <option value="sensor_chatter" className="bg-slate-900 text-slate-200">
                  ⚡ Sensor Chatter & Bouncing
                </option>
                <option value="dwell_stall" className="bg-slate-900 text-slate-200">
                  ⏱️ Actuator Stall & Dwell Outliers
                </option>
              </select>
            </div>

            {/* View Mode Toggle: Waveform vs Swimlane */}
            <div className="flex items-center bg-slate-950 border border-slate-800 p-0.5 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setViewMode('waveform')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors ${
                  viewMode === 'waveform'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Stepped Logic Analyzer Waveform"
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Step Waveform</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('swimlane')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors ${
                  viewMode === 'swimlane'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Gantt Multi-Track Swimlanes"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Swimlane Gantt</span>
              </button>
            </div>

            {/* PLC Transition Logger Tool Button */}
            <button
              id="open-plc-transition-logger-btn"
              type="button"
              onClick={() => setIsLoggerToolOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-lg text-xs font-semibold shadow-xs transition-all cursor-pointer"
              title="Open PLC Transition Logger tool to upload small CSV or text log files [Timestamp, FromState, ToState]"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>PLC Transition Logger</span>
            </button>

            {/* Export Menu */}
            <button
              type="button"
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 rounded-lg text-xs font-medium transition-colors shadow-xs"
              title="Export chronological transition history as CSV"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Playback & Scrubbing Control Bar */}
        <div className="mt-2 pt-2 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-xs">
          {/* Playback Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPlaying((p) => !p)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors shadow-xs ${
                isPlaying
                  ? 'bg-amber-600 hover:bg-amber-500 text-white'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPlaying ? 'Pause' : 'Play Run'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setScrubberSec(0);
                if (dataset.events.length > 0) setSelectedEventId(dataset.events[0].id);
              }}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors"
              title="Reset scrubber to start"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Speed Selector */}
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 px-2 py-0.5 rounded-md text-[11px]">
              <span className="text-slate-400">Speed:</span>
              {[1, 2, 5, 10].map((spd) => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => setPlaybackSpeed(spd)}
                  className={`px-1.5 py-0.5 rounded ${
                    playbackSpeed === spd
                      ? 'bg-indigo-600 text-white font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>

            {/* Scrubber Time Counter */}
            <div className="font-mono text-xs text-sky-400 bg-slate-950/80 px-2.5 py-1 rounded-md border border-slate-800">
              <Clock className="w-3 h-3 inline mr-1 text-slate-400" />
              T+{(scrubberSec !== null ? scrubberSec : 0).toFixed(2)}s / {dataset.totalDurationSec.toFixed(2)}s
            </div>
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 text-xs">Zoom:</span>
            <button
              type="button"
              onClick={() => setZoomLevel((z) => Math.max(0.4, Number((z - 0.25).toFixed(2))))}
              className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
              title="Zoom out timeline"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-slate-300 font-mono text-[11px] min-w-10 text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoomLevel((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
              className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
              title="Zoom in timeline"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoomLevel(1)}
              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] transition-colors"
              title="Reset zoom to 100%"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* KPI & Anomaly Diagnostics Summary Banner */}
      <div className="px-3.5 py-1.5 bg-slate-900/40 border-b border-slate-800/70 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 shrink-0 text-xs">
        {/* Total Transitions */}
        <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
          <span className="text-slate-400 text-[11px]">Total Transitions</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-lg font-bold text-slate-100 font-mono">{dataset.events.length}</span>
            <span className="text-[10px] text-slate-400">events</span>
          </div>
        </div>

        {/* Compliance Rate */}
        <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
          <span className="text-slate-400 text-[11px]">Model Compliance</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span
              className={`text-lg font-bold font-mono ${
                dataset.complianceRate >= 95
                  ? 'text-emerald-400'
                  : dataset.complianceRate >= 80
                  ? 'text-amber-400'
                  : 'text-rose-400'
              }`}
            >
              {dataset.complianceRate}%
            </span>
            <span className="text-[10px] text-slate-400">valid edges</span>
          </div>
        </div>

        {/* Illegal Transitions */}
        <div
          onClick={() => setAnomalyFilter(anomalyFilter === 'ILLEGAL_TRANSITION' ? 'all' : 'ILLEGAL_TRANSITION')}
          className={`p-2.5 rounded-lg border cursor-pointer transition-all flex flex-col justify-between ${
            anomalyFilter === 'ILLEGAL_TRANSITION'
              ? 'bg-rose-950/60 border-rose-500 ring-1 ring-rose-500'
              : dataset.anomalyCounts.ILLEGAL_TRANSITION > 0
              ? 'bg-rose-950/30 border-rose-800/80 hover:bg-rose-950/50'
              : 'bg-slate-950/70 border-slate-800'
          }`}
          title="Filter by Illegal Transitions (Paths not declared in POU statechart)"
        >
          <div className="flex items-center justify-between">
            <span className="text-rose-300 text-[11px] font-medium flex items-center gap-1">
              <ShieldAlert className="w-3 h-3 text-rose-400" />
              Illegal Transitions
            </span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-lg font-bold text-rose-400 font-mono">
              {dataset.anomalyCounts.ILLEGAL_TRANSITION}
            </span>
            <span className="text-[10px] text-rose-300/70">unmodeled</span>
          </div>
        </div>

        {/* Chatter / Rapid Bouncing */}
        <div
          onClick={() => setAnomalyFilter(anomalyFilter === 'CHATTER_BOUNCE' ? 'all' : 'CHATTER_BOUNCE')}
          className={`p-2.5 rounded-lg border cursor-pointer transition-all flex flex-col justify-between ${
            anomalyFilter === 'CHATTER_BOUNCE'
              ? 'bg-amber-950/60 border-amber-500 ring-1 ring-amber-500'
              : dataset.anomalyCounts.CHATTER_BOUNCE > 0
              ? 'bg-amber-950/30 border-amber-800/80 hover:bg-amber-950/50'
              : 'bg-slate-950/70 border-slate-800'
          }`}
          title="Filter by Chatter / Rapid Bounces (< 40ms oscillations)"
        >
          <div className="flex items-center justify-between">
            <span className="text-amber-300 text-[11px] font-medium flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-400" />
              Chatter / Bounce
            </span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-lg font-bold text-amber-400 font-mono">
              {dataset.anomalyCounts.CHATTER_BOUNCE}
            </span>
            <span className="text-[10px] text-amber-300/70">&lt;40ms</span>
          </div>
        </div>

        {/* Dwell Timeouts */}
        <div
          onClick={() => setAnomalyFilter(anomalyFilter === 'DWELL_TIMEOUT' ? 'all' : 'DWELL_TIMEOUT')}
          className={`p-2.5 rounded-lg border cursor-pointer transition-all flex flex-col justify-between ${
            anomalyFilter === 'DWELL_TIMEOUT'
              ? 'bg-sky-950/60 border-sky-500 ring-1 ring-sky-500'
              : dataset.anomalyCounts.DWELL_TIMEOUT > 0
              ? 'bg-sky-950/30 border-sky-800/80 hover:bg-sky-950/50'
              : 'bg-slate-950/70 border-slate-800'
          }`}
          title="Filter by Dwell Timeouts (State stuck significantly longer than average)"
        >
          <div className="flex items-center justify-between">
            <span className="text-sky-300 text-[11px] font-medium flex items-center gap-1">
              <Clock className="w-3 h-3 text-sky-400" />
              Dwell Timeouts
            </span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-lg font-bold text-sky-400 font-mono">
              {dataset.anomalyCounts.DWELL_TIMEOUT}
            </span>
            <span className="text-[10px] text-sky-300/70">stalls</span>
          </div>
        </div>

        {/* Abrupt Faults */}
        <div
          onClick={() => setAnomalyFilter(anomalyFilter === 'ABRUPT_FAULT' ? 'all' : 'ABRUPT_FAULT')}
          className={`p-2.5 rounded-lg border cursor-pointer transition-all flex flex-col justify-between ${
            anomalyFilter === 'ABRUPT_FAULT'
              ? 'bg-purple-950/60 border-purple-500 ring-1 ring-purple-500'
              : dataset.anomalyCounts.ABRUPT_FAULT > 0
              ? 'bg-purple-950/30 border-purple-800/80 hover:bg-purple-950/50'
              : 'bg-slate-950/70 border-slate-800'
          }`}
          title="Filter by Abrupt Faults (Sudden jumps to error states mid-operation)"
        >
          <div className="flex items-center justify-between">
            <span className="text-purple-300 text-[11px] font-medium flex items-center gap-1">
              <AlertOctagon className="w-3 h-3 text-purple-400" />
              Abrupt Faults
            </span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-lg font-bold text-purple-400 font-mono">
              {dataset.anomalyCounts.ABRUPT_FAULT}
            </span>
            <span className="text-[10px] text-purple-300/70">interrupts</span>
          </div>
        </div>
      </div>

      {/* Main Content Area: Split between Time-Series Chart (Top) and Event Inspector Table (Bottom) */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* ========================================================================= */}
        {/* 1. INTERACTIVE CHRONOLOGICAL TIME-SERIES VISUALIZATION (Step Waveform / Swimlane) */}
        {/* ========================================================================= */}
        <div className="h-[46%] min-h-[200px] border-b border-slate-800 bg-slate-950 flex flex-col relative overflow-hidden">
          {/* Chart Header Bar */}
          <div className="px-3 py-1.5 bg-slate-900/70 border-b border-slate-800 flex items-center justify-between text-xs shrink-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-200">
                {viewMode === 'waveform' ? 'Digital State Waveform' : 'Gantt State Swimlanes'}
              </span>
              <span className="text-slate-400 text-[11px]">
                (Hover over steps for details • Click to inspect transition • Red markers highlight unexpected changes)
              </span>
            </div>

            {/* Quick Filter: Show Unexpected Only */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setAnomalyFilter(anomalyFilter === 'unexpected_only' ? 'all' : 'unexpected_only')
                }
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  anomalyFilter === 'unexpected_only'
                    ? 'bg-rose-900/80 text-rose-200 border border-rose-700'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                }`}
              >
                <AlertTriangle className="w-3 h-3 text-rose-400" />
                <span>Unexpected Only ({dataset.unexpectedCount})</span>
              </button>

              <button
                type="button"
                onClick={handleCopyDiagnosticsReport}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                title="Copy anomaly diagnostics report"
              >
                {copiedReport ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedReport ? 'Copied' : 'Report'}</span>
              </button>
            </div>
          </div>

          {/* Scrollable SVG Canvas Container */}
          <div
            ref={timelineContainerRef}
            onScroll={(e) => setTimelineScrollLeft((e.target as HTMLDivElement).scrollLeft)}
            className="flex-1 overflow-x-auto overflow-y-auto relative bg-radial from-slate-900/40 to-slate-950"
          >
            {/* SVG Canvas */}
            <svg
              width={chartWidth}
              height={chartHeight}
              className="overflow-visible select-none"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const clickedSec = Math.max(0, (clickX - 120) / pxPerSec);
                setScrubberSec(clickedSec);
                // Select nearest event
                const nearest = dataset.events.reduce((prev, curr) =>
                  Math.abs(curr.relativeSec - clickedSec) < Math.abs(prev.relativeSec - clickedSec)
                    ? curr
                    : prev
                );
                if (nearest) setSelectedEventId(nearest.id);
              }}
            >
              <defs>
                {/* Glow Filter for Anomalies */}
                <filter id="anomaly-glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                {/* Pattern for background grid */}
                <pattern id="time-grid-sec" width={pxPerSec} height={laneHeight} patternUnits="userSpaceOnUse">
                  <path d={`M ${pxPerSec} 0 L 0 0 0 ${laneHeight}`} fill="none" stroke="#1e293b" strokeWidth="0.5" />
                </pattern>
              </defs>

              {/* Background Grid */}
              <rect x={120} y={topPadding} width={chartWidth - 120} height={stateCount * laneHeight} fill="url(#time-grid-sec)" opacity="0.6" />

              {/* State Horizontal Lanes */}
              {orderedStates.map((st, idx) => {
                const y = topPadding + idx * laneHeight;
                const isSelectedState =
                  activeSelectedEvent?.fromState === st || activeSelectedEvent?.toState === st;

                return (
                  <g key={st}>
                    {/* Lane Background */}
                    <rect
                      x={120}
                      y={y}
                      width={chartWidth - 120}
                      height={laneHeight}
                      fill={isSelectedState ? '#1e293b' : idx % 2 === 0 ? '#0f172a' : '#090d16'}
                      opacity={isSelectedState ? '0.6' : '0.4'}
                    />
                    {/* Lane Horizontal Divider */}
                    <line
                      x1={0}
                      y1={y + laneHeight}
                      x2={chartWidth}
                      y2={y + laneHeight}
                      stroke="#1e293b"
                      strokeWidth="1"
                    />

                    {/* Left Sticky Y-Axis State Label */}
                    <g
                      transform={`translate(${timelineScrollLeft}, 0)`}
                      className="cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleJumpToStateFromHistory(st);
                      }}
                    >
                      <rect
                        x={0}
                        y={y}
                        width={120}
                        height={laneHeight}
                        fill={isSelectedState ? '#1e293b' : '#090d16'}
                        stroke="#1e293b"
                        strokeWidth="1"
                      />
                      {/* State color dot */}
                      <circle
                        cx={14}
                        cy={y + laneHeight / 2}
                        r={4.5}
                        fill={stateColorMap[st] || '#38bdf8'}
                      />
                      {/* State Name */}
                      <text
                        x={25}
                        y={y + laneHeight / 2 + 4}
                        fill={isSelectedState ? '#38bdf8' : '#cbd5e1'}
                        fontSize="11"
                        fontWeight={isSelectedState ? '700' : '500'}
                        fontFamily="ui-monospace, monospace"
                      >
                        {st.length > 11 ? `${st.substring(0, 10)}…` : st}
                      </text>
                    </g>
                  </g>
                );
              })}

              {/* Time Ruler (X-Axis Top) */}
              <g transform={`translate(0, 0)`}>
                {Array.from({ length: Math.ceil(totalDuration) + 2 }).map((_, sec) => {
                  const x = 120 + sec * pxPerSec;
                  return (
                    <g key={`sec-${sec}`}>
                      <line x1={x} y1={topPadding - 8} x2={x} y2={topPadding} stroke="#475569" strokeWidth="1" />
                      <text
                        x={x}
                        y={topPadding - 12}
                        fill="#94a3b8"
                        fontSize="10"
                        fontFamily="ui-monospace, monospace"
                        textAnchor="middle"
                      >
                        +{sec}s
                      </text>
                    </g>
                  );
                })}
              </g>

              {/* ========================================================== */}
              {/* WAVEFORM VIEW MODE: Stepped digital logic analyzer curve */}
              {/* ========================================================== */}
              {viewMode === 'waveform' && (
                <g>
                  {/* Step Waveform Path Segments */}
                  {dataset.intervals.map((int, idx) => {
                    const stateIdx = orderedStates.indexOf(int.stateId);
                    if (stateIdx === -1) return null;

                    const y = topPadding + stateIdx * laneHeight + laneHeight / 2;
                    const xStart = 120 + int.startSec * pxPerSec;
                    const xEnd = 120 + int.endSec * pxPerSec;
                    const color = stateColorMap[int.stateId] || '#38bdf8';

                    // Next state index to draw vertical step connector
                    const nextInt = dataset.intervals[idx + 1];
                    const nextStateIdx = nextInt ? orderedStates.indexOf(nextInt.stateId) : -1;
                    const nextY =
                      nextStateIdx !== -1 ? topPadding + nextStateIdx * laneHeight + laneHeight / 2 : y;

                    // Transition event corresponding to this step
                    const trEvent = dataset.events[int.eventIndex - 1];
                    const isUnexpected = trEvent?.isUnexpected;

                    return (
                      <g key={int.id}>
                        {/* Horizontal Active State Line */}
                        <line
                          x1={xStart}
                          y1={y}
                          x2={xEnd}
                          y2={y}
                          stroke={color}
                          strokeWidth="3.5"
                          strokeLinecap="round"
                        />

                        {/* Soft Area fill under step line */}
                        <rect
                          x={xStart}
                          y={y - 10}
                          width={Math.max(2, xEnd - xStart)}
                          height={20}
                          fill={color}
                          opacity="0.12"
                          rx="3"
                        />

                        {/* Vertical Step Connector to Next State */}
                        {nextInt && nextY !== y && (
                          <line
                            x1={xEnd}
                            y1={y}
                            x2={xEnd}
                            y2={nextY}
                            stroke={isUnexpected ? '#f43f5e' : '#64748b'}
                            strokeWidth={isUnexpected ? '3' : '2'}
                            strokeDasharray={isUnexpected ? '3,3' : undefined}
                            filter={isUnexpected ? 'url(#anomaly-glow)' : undefined}
                          />
                        )}
                      </g>
                    );
                  })}
                </g>
              )}

              {/* ========================================================== */}
              {/* SWIMLANE VIEW MODE: Multi-track Gantt blocks */}
              {/* ========================================================== */}
              {viewMode === 'swimlane' && (
                <g>
                  {dataset.intervals.map((int) => {
                    const stateIdx = orderedStates.indexOf(int.stateId);
                    if (stateIdx === -1) return null;

                    const y = topPadding + stateIdx * laneHeight + 4;
                    const xStart = 120 + int.startSec * pxPerSec;
                    const width = Math.max(3, (int.endSec - int.startSec) * pxPerSec);
                    const color = stateColorMap[int.stateId] || '#38bdf8';
                    const trEvent = dataset.events[int.eventIndex - 1];
                    const isUnexpected = trEvent?.isUnexpected;

                    return (
                      <g key={int.id}>
                        <rect
                          x={xStart}
                          y={y}
                          width={width}
                          height={laneHeight - 8}
                          fill={color}
                          fillOpacity={isUnexpected ? '0.7' : '0.4'}
                          stroke={isUnexpected ? '#f43f5e' : color}
                          strokeWidth={isUnexpected ? '2' : '1'}
                          rx="4"
                          filter={isUnexpected ? 'url(#anomaly-glow)' : undefined}
                        />
                        {width > 35 && (
                          <text
                            x={xStart + 6}
                            y={y + (laneHeight - 8) / 2 + 3.5}
                            fill="#ffffff"
                            fontSize="10"
                            fontFamily="ui-monospace, monospace"
                            fontWeight="600"
                          >
                            {int.durationMs}ms
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              )}

              {/* ========================================================== */}
              {/* TRANSITION ANOMALY MARKERS & EVENT INTERACTIVE NODES */}
              {/* ========================================================== */}
              {dataset.events.map((ev) => {
                const toIdx = orderedStates.indexOf(ev.toState);
                if (toIdx === -1) return null;

                const x = 120 + ev.relativeSec * pxPerSec;
                const y = topPadding + toIdx * laneHeight + laneHeight / 2;
                const isSelected = selectedEventId === ev.id;
                const isUnexpected = ev.isUnexpected;

                // Anomaly color
                let markerColor = '#38bdf8';
                if (isUnexpected) {
                  if (ev.anomalies.some((a) => a.type === 'ILLEGAL_TRANSITION')) markerColor = '#f43f5e';
                  else if (ev.anomalies.some((a) => a.type === 'CHATTER_BOUNCE')) markerColor = '#f59e0b';
                  else if (ev.anomalies.some((a) => a.type === 'DWELL_TIMEOUT')) markerColor = '#06b6d4';
                  else markerColor = '#a855f7';
                }

                return (
                  <g
                    key={ev.id}
                    className="cursor-pointer transition-transform"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedEventId(ev.id);
                      setScrubberSec(ev.relativeSec);
                    }}
                    onMouseEnter={(e) => {
                      setHoveredEvent(ev);
                      setTooltipPos({ x: e.clientX, y: e.clientY });
                    }}
                    onMouseLeave={() => {
                      setHoveredEvent(null);
                      setTooltipPos(null);
                    }}
                  >
                    {/* Vertical Anomaly Guide Line */}
                    {isUnexpected && (
                      <line
                        x1={x}
                        y1={topPadding}
                        x2={x}
                        y2={topPadding + stateCount * laneHeight}
                        stroke="#f43f5e"
                        strokeWidth="1.5"
                        strokeDasharray="2,2"
                        opacity="0.6"
                      />
                    )}

                    {/* Transition Point Dot */}
                    <circle
                      cx={x}
                      cy={y}
                      r={isSelected ? 7.5 : isUnexpected ? 6.5 : 4.5}
                      fill={markerColor}
                      stroke={isSelected ? '#ffffff' : '#0f172a'}
                      strokeWidth={isSelected ? '2.5' : '1.5'}
                      filter={isUnexpected || isSelected ? 'url(#anomaly-glow)' : undefined}
                    />

                    {/* Unexpected Warning Badge Icon Above Point */}
                    {isUnexpected && (
                      <g transform={`translate(${x - 7}, ${y - 20})`}>
                        <rect x={0} y={0} width={14} height={14} rx={3} fill="#e11d48" />
                        <text
                          x={7}
                          y={11}
                          fill="#ffffff"
                          fontSize="10"
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          !
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Scrubber Cursor (Vertical scrubbing line) */}
              {scrubberSec !== null && (
                <g transform={`translate(${120 + scrubberSec * pxPerSec}, 0)`}>
                  <line
                    x1={0}
                    y1={topPadding - 15}
                    x2={0}
                    y2={topPadding + stateCount * laneHeight + 15}
                    stroke="#38bdf8"
                    strokeWidth="2"
                    strokeDasharray="4,2"
                  />
                  {/* Scrubber head flag */}
                  <polygon points="-6,15 6,15 0,25" fill="#38bdf8" />
                  <rect x={-32} y={5} width={64} height={18} rx={3} fill="#0284c7" />
                  <text
                    x={0}
                    y={17}
                    fill="#ffffff"
                    fontSize="9"
                    fontFamily="ui-monospace, monospace"
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    +{scrubberSec.toFixed(2)}s
                  </text>
                </g>
              )}
            </svg>
          </div>
        </div>

        {/* Hover Tooltip */}
        {hoveredEvent && tooltipPos && (
          <div
            className="fixed z-50 pointer-events-none bg-slate-900 border border-slate-700/80 rounded-lg p-2.5 shadow-2xl text-xs max-w-xs text-slate-100"
            style={{
              left: `${Math.min(window.innerWidth - 300, tooltipPos.x + 12)}px`,
              top: `${Math.min(window.innerHeight - 150, tooltipPos.y + 12)}px`,
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5 mb-1.5">
              <span className="font-bold text-sky-400">Step #{hoveredEvent.index}</span>
              <span className="font-mono text-slate-400 text-[10px]">+{hoveredEvent.relativeSec.toFixed(3)}s</span>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-xs mb-1">
              <span className="text-slate-300 font-semibold">{hoveredEvent.fromState}</span>
              <ArrowRight className="w-3 h-3 text-slate-500 shrink-0" />
              <span className="text-emerald-400 font-semibold">{hoveredEvent.toState}</span>
            </div>
            <div className="text-[11px] text-slate-400">Dwell in previous state: {hoveredEvent.dwellMs}ms</div>
            {hoveredEvent.isUnexpected && (
              <div className="mt-1.5 pt-1.5 border-t border-rose-900/60 text-rose-300 text-[11px] flex items-start gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">{hoveredEvent.anomalies[0]?.title}</span>
                  <p className="text-[10px] text-rose-300/80">{hoveredEvent.anomalies[0]?.description}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* 2. CHRONOLOGICAL EVENT STREAM & DETAILED ANOMALY INSPECTOR (Bottom Split) */}
        {/* ========================================================================= */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 bg-slate-950">
          {/* Left Column: Chronological Event List & Filters */}
          <div className="flex-1 flex flex-col border-r border-slate-800/80 min-w-0">
            {/* Filter Bar */}
            <div className="p-2.5 border-b border-slate-800 bg-slate-900/50 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                {/* Search */}
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search state name, condition, or anomaly..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-2.5 py-1 bg-slate-950 border border-slate-800 rounded-md text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-indigo-500"
                  />
                </div>

                {/* State Dropdown */}
                <select
                  value={selectedStateFilter}
                  onChange={(e) => setSelectedStateFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 text-slate-300 text-xs px-2 py-1 rounded-md focus:outline-hidden"
                >
                  <option value="all">All States</option>
                  {orderedStates.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              {/* Anomaly Quick Tabs */}
              <div className="flex items-center gap-1">
                {(['all', 'unexpected_only'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAnomalyFilter(mode)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      anomalyFilter === mode
                        ? mode === 'unexpected_only'
                          ? 'bg-rose-950 text-rose-300 border border-rose-800 font-bold'
                          : 'bg-indigo-950 text-indigo-300 border border-indigo-800 font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {mode === 'all' ? `All (${dataset.events.length})` : `⚠️ Unexpected (${dataset.unexpectedCount})`}
                  </button>
                ))}
              </div>
            </div>

            {/* Event List Table */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
              {filteredEvents.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs flex flex-col items-center justify-center">
                  <Filter className="w-6 h-6 mb-2 text-slate-600" />
                  <span>No chronological transition events match current filter.</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setAnomalyFilter('all');
                      setSelectedStateFilter('all');
                    }}
                    className="mt-2 text-indigo-400 hover:underline"
                  >
                    Reset filters
                  </button>
                </div>
              ) : (
                filteredEvents.map((ev) => {
                  const isSelected = selectedEventId === ev.id;
                  const isUnexpected = ev.isUnexpected;

                  return (
                    <div
                      key={ev.id}
                      onClick={() => handleFocusEventOnTimeline(ev)}
                      className={`p-2.5 transition-colors cursor-pointer flex items-center justify-between gap-3 text-xs ${
                        isSelected
                          ? 'bg-indigo-950/40 border-l-4 border-l-indigo-500 text-slate-100'
                          : isUnexpected
                          ? 'bg-rose-950/20 hover:bg-rose-950/30 border-l-4 border-l-rose-500/80 text-slate-200'
                          : 'hover:bg-slate-900/40 border-l-4 border-l-transparent text-slate-300'
                      }`}
                    >
                      {/* Left: Step Index, Time & Transition */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* Step # */}
                        <span className="font-mono text-[11px] text-slate-400 w-8 shrink-0">#{ev.index}</span>

                        {/* Status Icon */}
                        {isUnexpected ? (
                          <div className="p-1 rounded-md bg-rose-950/80 border border-rose-800/80 text-rose-400 shrink-0">
                            <AlertTriangle className="w-3.5 h-3.5" />
                          </div>
                        ) : (
                          <div className="p-1 rounded-md bg-slate-900 border border-slate-800 text-emerald-400 shrink-0">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </div>
                        )}

                        {/* Transition Badge */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-mono text-xs truncate">
                            <span
                              className="font-medium text-slate-200 truncate hover:text-sky-300"
                              title={ev.fromState}
                            >
                              {ev.fromState}
                            </span>
                            <ArrowRight className="w-3 h-3 text-slate-500 shrink-0" />
                            <span
                              className={`font-semibold truncate ${
                                isUnexpected ? 'text-rose-300' : 'text-emerald-400'
                              }`}
                              title={ev.toState}
                            >
                              {ev.toState}
                            </span>
                          </div>

                          {/* Anomaly snippet or guard */}
                          {isUnexpected ? (
                            <div className="text-[11px] text-rose-400 font-medium truncate mt-0.5">
                              {ev.anomalies[0]?.title}
                            </div>
                          ) : ev.guardFired ? (
                            <div className="text-[11px] text-slate-400 truncate mt-0.5">
                              Guard: <span className="font-mono">{ev.guardFired}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {/* Right: Dwell Time, Timestamp & Action */}
                      <div className="flex items-center gap-3 shrink-0 text-right">
                        <div>
                          <div className="font-mono text-[11px] text-slate-300">{ev.dwellMs}ms</div>
                          <div className="font-mono text-[10px] text-slate-400">+{ev.relativeSec.toFixed(2)}s</div>
                        </div>

                        <ChevronRight className={`w-4 h-4 ${isSelected ? 'text-indigo-400' : 'text-slate-600'}`} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Detailed Transition Inspector & Context */}
          <div className="w-full md:w-[380px] lg:w-[440px] border-t md:border-t-0 md:border-l border-slate-800/80 bg-slate-950/60 p-4 overflow-y-auto flex flex-col justify-between text-xs">
            {activeSelectedEvent ? (
              <div className="space-y-4">
                {/* Inspector Header */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md text-xs font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
                      Step #{activeSelectedEvent.index}
                    </span>
                    <span className="font-mono text-slate-400">
                      T+{activeSelectedEvent.relativeSec.toFixed(3)}s
                    </span>
                  </div>

                  {activeSelectedEvent.isUnexpected ? (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-950 text-rose-300 border border-rose-800 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Unexpected Change
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Valid Transition
                    </span>
                  )}
                </div>

                {/* Transition Direction Card */}
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
                  <span className="text-[11px] text-slate-400 font-medium">State Machine Transition:</span>
                  <div className="flex items-center justify-between gap-2 p-2 rounded-md bg-slate-950 border border-slate-800/80">
                    <div className="min-w-0">
                      <span className="text-[10px] text-slate-400 uppercase font-mono block">From State</span>
                      <button
                        type="button"
                        onClick={() => handleJumpToStateFromHistory(activeSelectedEvent.fromState)}
                        className="font-mono font-bold text-sky-400 hover:underline truncate block text-left"
                        title="Jump to From State in Diagram"
                      >
                        {activeSelectedEvent.fromState}
                      </button>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-500 shrink-0" />
                    <div className="min-w-0 text-right">
                      <span className="text-[10px] text-slate-400 uppercase font-mono block">To State</span>
                      <button
                        type="button"
                        onClick={() => handleJumpToStateFromHistory(activeSelectedEvent.toState)}
                        className={`font-mono font-bold hover:underline truncate block text-right ${
                          activeSelectedEvent.isUnexpected ? 'text-rose-400' : 'text-emerald-400'
                        }`}
                        title="Jump to To State in Diagram"
                      >
                        {activeSelectedEvent.toState}
                      </button>
                    </div>
                  </div>

                  {/* Dwell & Cycle Info */}
                  <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                    <div className="bg-slate-950/80 p-2 rounded-md border border-slate-800/50">
                      <span className="text-slate-400 block text-[10px]">Dwell Duration</span>
                      <span className="font-mono font-bold text-slate-200">{activeSelectedEvent.dwellMs} ms</span>
                    </div>
                    <div className="bg-slate-950/80 p-2 rounded-md border border-slate-800/50">
                      <span className="text-slate-400 block text-[10px]">Cycle Count</span>
                      <span className="font-mono font-bold text-slate-200">Cycle #{activeSelectedEvent.cycleNumber || 1}</span>
                    </div>
                  </div>
                </div>

                {/* Unexpected Change Explanations (If any) */}
                {activeSelectedEvent.anomalies.length > 0 && (
                  <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-800/80 space-y-2.5">
                    <div className="flex items-center gap-1.5 text-rose-300 font-bold text-xs">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>Why Was This State Change Unexpected?</span>
                    </div>

                    {activeSelectedEvent.anomalies.map((anom, aIdx) => (
                      <div key={aIdx} className="p-2.5 rounded-md bg-slate-950/80 border border-rose-900/60 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-rose-300 text-xs">{anom.title}</span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-rose-900/60 text-rose-200">
                            {anom.severity}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-300 leading-relaxed">{anom.description}</p>
                        {anom.details && (
                          <p className="text-[10px] text-slate-400 leading-relaxed border-t border-slate-800/80 pt-1 mt-1">
                            {anom.details}
                          </p>
                        )}
                        {anom.expectedContext && (
                          <div className="text-[10px] text-slate-400 font-mono mt-1">
                            <span className="text-slate-500">Expected: </span>
                            <span className="text-emerald-300">{anom.expectedContext}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Raw Log Line */}
                {activeSelectedEvent.rawLogLine && (
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <span className="text-[10px] text-slate-400 font-medium">Raw Log Entry:</span>
                    <pre className="text-[10px] font-mono text-slate-300 bg-slate-950 p-2 rounded border border-slate-850 overflow-x-auto whitespace-pre-wrap break-all">
                      {activeSelectedEvent.rawLogLine}
                    </pre>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="pt-2 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => handleJumpToStateFromHistory(activeSelectedEvent.toState)}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Jump to "{activeSelectedEvent.toState}" in Diagram</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleFocusEventOnTimeline(activeSelectedEvent)}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Clock className="w-3.5 h-3.5 text-sky-400" />
                    <span>Focus on Time-Series Axis</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-slate-500 text-xs flex flex-col items-center justify-center my-auto">
                <History className="w-8 h-8 mb-2 text-slate-600" />
                <span>Select a chronological transition event to inspect its parameters and statechart compliance.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* PLC TRANSITION LOGGER TOOL MODAL */}
      {/* ========================================================================= */}
      <PlcTransitionLoggerTool
        isOpen={isLoggerToolOpen}
        onClose={() => setIsLoggerToolOpen(false)}
        states={states}
        edges={edges}
        pouFileName={pouFileName}
        onPopulateHistory={(newDs, msg) => {
          setDataset(newDs);
          onDatasetChange?.(newDs);
          setScrubberSec(0);
          setIsPlaying(false);
          if (newDs.events.length > 0) {
            const firstUnexpected = newDs.events.find((e) => e.isUnexpected);
            setSelectedEventId(firstUnexpected ? firstUnexpected.id : newDs.events[0].id);
          }
          if (msg) onToast?.(msg, 'success');
        }}
        onToast={onToast}
      />
    </div>
  );
};
