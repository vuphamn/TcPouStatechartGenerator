import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Activity,
  Flame,
  Play,
  Pause,
  RotateCcw,
  Upload,
  Download,
  Search,
  ArrowRight,
  TrendingUp,
  Clock,
  AlertTriangle,
  FileSpreadsheet,
  CheckCircle2,
  Sliders,
  ExternalLink,
  Target,
  Sparkles,
  Info,
  Grid,
  Filter,
  Copy,
  Check,
  Zap,
  Layers,
  ChevronDown,
} from 'lucide-react';
import { IdentifiedPouState } from '../utils/pouStateExtractor.ts';
import { EdgeInfo, NodeDisplayProperties } from '../types.ts';
import {
  PlcLogDataset,
  PlcTransitionEvent,
  TransitionFrequencyStats,
  StateHitMetric,
  StaticHeatmapAnalysis,
  computeStaticHeatmap,
  computeDatasetFromEvents,
  generateRealisticPlcLog,
  parsePlcLogText,
  getHeatColorStyles,
  HeatCategory,
} from '../utils/transitionFrequencyAnalytics.ts';

export interface TransitionFrequencyTabProps {
  states: IdentifiedPouState[];
  edges: EdgeInfo[];
  pouContent: string;
  pouFileName: string;
  onJumpToState: (stateId: string, label?: string) => void;
  onApplyHeatmapStyles?: (styles: Record<string, NodeDisplayProperties>) => void;
  onToast?: (message: string, type?: 'success' | 'error') => void;
}

export const TransitionFrequencyTab: React.FC<TransitionFrequencyTabProps> = ({
  states,
  edges,
  pouContent,
  pouFileName,
  onJumpToState,
  onApplyHeatmapStyles,
  onToast,
}) => {
  // Mode: 'telemetry' (PLC log / runtime frequency over time) vs 'static' (Static Hit Count heatmap & N x N matrix)
  const [activeMode, setActiveMode] = useState<'telemetry' | 'static'>('telemetry');

  // Static heatmap calculation
  const staticAnalysis = useMemo<StaticHeatmapAnalysis>(() => {
    return computeStaticHeatmap(states, edges, pouContent);
  }, [states, edges, pouContent]);

  // PLC Runtime Dataset (default initializes with a realistic production run tailored to the active POU)
  const [dataset, setDataset] = useState<PlcLogDataset>(() => {
    return generateRealisticPlcLog(states, edges, 'production', 350);
  });

  // Regenerate preset when states change and current dataset was a preset
  useEffect(() => {
    if (dataset.source === 'preset') {
      setDataset(generateRealisticPlcLog(states, edges, 'production', 350));
    }
  }, [states, edges]);

  // Live Stream Simulator State
  const [isLiveStreaming, setIsLiveStreaming] = useState<boolean>(false);
  const [liveSpeedHz, setLiveSpeedHz] = useState<number>(4); // ticks per sec
  const streamTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedHeatFilter, setSelectedHeatFilter] = useState<HeatCategory | 'all'>('all');
  const [selectedStateFocus, setSelectedStateFocus] = useState<string | null>(null);
  const [timeRangeSlider, setTimeRangeSlider] = useState<number>(100); // % of time window

  // Upload/Paste Log Modal/Drawer
  const [isLogDrawerOpen, setIsLogDrawerOpen] = useState<boolean>(false);
  const [rawLogInputText, setRawLogInputText] = useState<string>('');
  const [copiedCsv, setCopiedCsv] = useState<boolean>(false);

  // Hovered Chart Tooltip State
  const [hoveredBucketIndex, setHoveredBucketIndex] = useState<number | null>(null);

  // Hovered Matrix Cell State
  const [hoveredMatrixCell, setHoveredMatrixCell] = useState<{
    from: string;
    to: string;
    score: number | null;
    guard?: string;
    priority?: number;
  } | null>(null);

  // Live simulation tick handler
  const handleLiveTick = useCallback(() => {
    setDataset((prev) => {
      const currentStates = states.length > 0 ? states : [{ id: 'STATE_INIT', label: 'STATE_INIT', hasCaseBranch: true, outgoingTransitions: [], incomingTransitions: [], enumIndex: 0 }];
      const lastEvent = prev.events[prev.events.length - 1];
      const fromSt = lastEvent ? lastEvent.toState : currentStates[0].id;
      const outs = edges.filter((e) => e.from === fromSt);

      let nextSt = '';
      let firedGuard: string | undefined;
      let isErr = false;

      if (outs.length === 0) {
        nextSt = currentStates[0].id;
      } else {
        const sorted = [...outs].sort((a, b) => (a.priority || 1) - (b.priority || 1));
        const pick = Math.random() < 0.7 ? sorted[0] : sorted[Math.min(1, sorted.length - 1)];
        nextSt = pick.to;
        firedGuard = pick.guard || pick.condition;
      }

      if (nextSt.toLowerCase().includes('err') || nextSt.toLowerCase().includes('fault')) {
        isErr = true;
      }

      const now = Date.now();
      const dur = Math.round(1000 / liveSpeedHz);
      const newEvt: PlcTransitionEvent = {
        id: `live-${now}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: now,
        isoTime: new Date(now).toISOString(),
        relativeSec: Number(((now - prev.startTime) / 1000).toFixed(2)),
        fromState: fromSt,
        toState: nextSt,
        durationMs: dur,
        cycleCount: (lastEvent?.cycleCount || 1) + (fromSt === currentStates[0].id ? 1 : 0),
        errorFlag: isErr,
        guardFired: firedGuard,
      };

      // Keep up to 1000 events in memory
      const updatedEvents = [...prev.events.slice(-999), newEvt];
      return computeDatasetFromEvents(updatedEvents, states, edges, 'Live PLC Telemetry Stream', 'live');
    });
  }, [edges, liveSpeedHz, states]);

  // Manage Live Simulation Timer
  useEffect(() => {
    if (isLiveStreaming) {
      const intervalMs = Math.max(50, Math.round(1000 / liveSpeedHz));
      streamTimerRef.current = setInterval(handleLiveTick, intervalMs);
    } else {
      if (streamTimerRef.current) {
        clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
      }
    }
    return () => {
      if (streamTimerRef.current) clearInterval(streamTimerRef.current);
    };
  }, [isLiveStreaming, liveSpeedHz, handleLiveTick]);

  // Load Preset Scenario
  const handleLoadPreset = (scenario: 'production' | 'error_recovery' | 'stress_test') => {
    setIsLiveStreaming(false);
    const generated = generateRealisticPlcLog(
      states,
      edges,
      scenario,
      scenario === 'stress_test' ? 800 : 350
    );
    setDataset(generated);
    onToast?.(`Loaded ${generated.name}`, 'success');
  };

  // Parse Uploaded or Pasted Log
  const handleApplyPastedLog = () => {
    if (!rawLogInputText.trim()) return;
    const parsed = parsePlcLogText(rawLogInputText, states.map((s) => s.id));
    if (parsed.length === 0) {
      onToast?.('Could not parse any transition events from input. Check format.', 'error');
      return;
    }
    setIsLiveStreaming(false);
    const newDs = computeDatasetFromEvents(parsed, states, edges, 'Custom Uploaded Log', 'file');
    setDataset(newDs);
    setIsLogDrawerOpen(false);
    setRawLogInputText('');
    onToast?.(`Successfully imported ${parsed.length} transition events!`, 'success');
  };

  // Apply Heatmap Colors to Diagram Canvas
  const handleApplyHeatmapToDiagram = () => {
    if (!onApplyHeatmapStyles) return;
    const styles: Record<string, NodeDisplayProperties> = {};

    const activeList = activeMode === 'telemetry' ? dataset.stateMetrics : staticAnalysis.stateMetrics;
    activeList.forEach((metric) => {
      const colors = getHeatColorStyles(metric.heatCategory);
      styles[metric.stateId] = {
        fill: colors.hexFill,
        stroke: colors.hexStroke,
        color: '#f8fafc',
        strokeWidth: metric.heatCategory === 'hotspot' ? '3px' : '1.5px',
      };
    });

    onApplyHeatmapStyles(styles);
    onToast?.('Applied State Hit Count heatmap styling to diagram canvas!', 'success');
  };

  // Export CSV of Transition Frequency
  const handleExportCsv = () => {
    const lines = ['FromState,ToState,HitCount,Percentage,AvgDurationMs,MinDurationMs,MaxDurationMs,Errors,Guard'];
    dataset.transitionStats.forEach((t) => {
      lines.push(
        `"${t.fromState}","${t.toState}",${t.hitCount},${t.percentage}%,${t.avgDurationMs},${t.minDurationMs},${t.maxDurationMs},${t.errorCount},"${(t.guardCondition || '').replace(/"/g, '""')}"`
      );
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pouFileName.replace(/\.TcPOU$/i, '')}_transition_frequency.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onToast?.('Exported transition frequency data to CSV!', 'success');
  };

  // Filtered transition stats based on search & state focus
  const filteredTransitions = useMemo(() => {
    return dataset.transitionStats.filter((t) => {
      if (selectedStateFocus) {
        if (t.fromState !== selectedStateFocus && t.toState !== selectedStateFocus) return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        t.fromState.toLowerCase().includes(q) ||
        t.toState.toLowerCase().includes(q) ||
        (t.guardCondition && t.guardCondition.toLowerCase().includes(q))
      );
    });
  }, [dataset.transitionStats, searchQuery, selectedStateFocus]);

  // Filtered state metrics
  const filteredStateMetrics = useMemo(() => {
    const list = activeMode === 'telemetry' ? dataset.stateMetrics : staticAnalysis.stateMetrics;
    return list.filter((s) => {
      if (selectedHeatFilter !== 'all' && s.heatCategory !== selectedHeatFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return s.stateId.toLowerCase().includes(q) || s.label.toLowerCase().includes(q);
    });
  }, [activeMode, dataset.stateMetrics, staticAnalysis.stateMetrics, selectedHeatFilter, searchQuery]);

  // Max transitions in time bucket for scaling SVG chart
  const maxBucketCount = useMemo(() => {
    if (dataset.timeBuckets.length === 0) return 1;
    return Math.max(...dataset.timeBuckets.map((b) => b.count), 1);
  }, [dataset.timeBuckets]);

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-200 overflow-y-auto">
      {/* Top Header Bar */}
      <div className="px-3.5 py-2 border-b border-slate-800/80 bg-slate-900/60 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-sky-950/80 border border-sky-800/60 text-sky-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-100 tracking-tight">
                  State Transition Frequency & Telemetry
                </h1>
                <span className="text-xs text-slate-400">
                  {dataset.source === 'live' ? (
                    <span className="flex items-center gap-1 text-emerald-400 font-mono">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                      LIVE
                    </span>
                  ) : dataset.source === 'preset' ? (
                    <span className="text-slate-400">Simulation</span>
                  ) : (
                    <span className="text-slate-400">Log File</span>
                  )}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Frequency analysis of transitions over time, PLC runtime logs, and State Hit Count heatmaps.
              </p>
            </div>
          </div>

          {/* Primary View Mode Switcher */}
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-950 border border-slate-800 p-0.5 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setActiveMode('telemetry')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
                  activeMode === 'telemetry'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>PLC Log Over Time</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveMode('static')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
                  activeMode === 'static'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                <span>Static Hit Heatmap</span>
              </button>
            </div>

            {/* Apply Heatmap to Diagram Canvas */}
            <button
              type="button"
              onClick={handleApplyHeatmapToDiagram}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-amber-200 border border-amber-600/40 rounded-lg text-xs font-medium transition-colors shadow-xs"
              title="Apply State Hit Count heat colors directly to the Mermaid diagram canvas"
            >
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              <span>Colorize Diagram</span>
            </button>
          </div>
        </div>

        {/* Toolbar & Actions Row */}
        <div className="mt-3 pt-3 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Presets & Simulator Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400 font-medium">Scenarios:</span>
            <button
              type="button"
              onClick={() => handleLoadPreset('production')}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-md border border-slate-700 transition-colors"
            >
              Production Run
            </button>
            <button
              type="button"
              onClick={() => handleLoadPreset('error_recovery')}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-md border border-slate-700 transition-colors"
            >
              Fault & Recovery
            </button>
            <button
              type="button"
              onClick={() => handleLoadPreset('stress_test')}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-md border border-slate-700 transition-colors"
            >
              Stress Test
            </button>

            {/* Live Stream Simulator Toggle */}
            <div className="h-4 w-px bg-slate-800 mx-1"></div>
            <button
              type="button"
              onClick={() => setIsLiveStreaming((prev) => !prev)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium border transition-colors ${
                isLiveStreaming
                  ? 'bg-rose-950 text-rose-200 border-rose-700 animate-pulse'
                  : 'bg-emerald-950 hover:bg-emerald-900 text-emerald-200 border-emerald-800'
              }`}
            >
              {isLiveStreaming ? (
                <>
                  <Pause className="w-3 h-3" />
                  <span>Pause Stream</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" />
                  <span>Live Stream Sim</span>
                </>
              )}
            </button>

            {isLiveStreaming && (
              <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                <span>Speed:</span>
                <select
                  value={liveSpeedHz}
                  onChange={(e) => setLiveSpeedHz(Number(e.target.value))}
                  className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200"
                >
                  <option value={1}>1 Hz (Slow)</option>
                  <option value={4}>4 Hz (Normal)</option>
                  <option value={10}>10 Hz (Fast)</option>
                  <option value={25}>25 Hz (Burst)</option>
                </select>
              </div>
            )}
          </div>

          {/* Import / Export Controls */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsLogDrawerOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-md border border-slate-700 transition-colors"
            >
              <Upload className="w-3 h-3 text-sky-400" />
              <span>Import PLC Log...</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-md border border-slate-700 transition-colors"
            >
              <Download className="w-3 h-3 text-emerald-400" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Metric Summary Ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 p-4 bg-slate-950 border-b border-slate-800/80">
        <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80">
          <div className="text-xs text-slate-400">Total Transitions</div>
          <div className="text-xl font-bold font-mono text-slate-100 mt-1 tabular-nums">
            {activeMode === 'telemetry' ? dataset.totalTransitions.toLocaleString() : staticAnalysis.totalStructuralTransitions}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {activeMode === 'telemetry' ? `${dataset.durationSec}s run window` : `${states.length} state nodes`}
          </div>
        </div>

        <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80">
          <div className="text-xs text-slate-400">Transition Rate</div>
          <div className="text-xl font-bold font-mono text-sky-400 mt-1 tabular-nums">
            {activeMode === 'telemetry' ? `${dataset.avgTransitionsPerSec}/s` : 'Static DAG'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {activeMode === 'telemetry' ? `Peak: ${dataset.peakTransitionsPerSec}/s` : 'Deterministic'}
          </div>
        </div>

        <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80">
          <div className="text-xs text-slate-400">Top Hotspot State</div>
          <div className="text-sm font-bold font-mono text-rose-400 mt-1 truncate" title={dataset.stateMetrics[0]?.stateId}>
            {activeMode === 'telemetry' ? dataset.stateMetrics[0]?.stateId || 'None' : staticAnalysis.topHotspots[0]?.stateId || 'None'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
            {activeMode === 'telemetry'
              ? `${dataset.stateMetrics[0]?.totalHits || 0} hits (${dataset.stateMetrics[0]?.dwellPercentage || 0}% dwell)`
              : `${staticAnalysis.topHotspots[0]?.totalHits || 0} total edge links`}
          </div>
        </div>

        <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80">
          <div className="text-xs text-slate-400">Unique Edge Paths</div>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-1 tabular-nums">
            {activeMode === 'telemetry' ? dataset.transitionStats.length : edges.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {activeMode === 'telemetry' ? `${Math.round((dataset.transitionStats.length / Math.max(edges.length, 1)) * 100)}% coverage` : 'In POU logic'}
          </div>
        </div>

        <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80">
          <div className="text-xs text-slate-400">Fault / Error Trips</div>
          <div className={`text-xl font-bold font-mono mt-1 tabular-nums ${dataset.anomalies.filter((a) => a.type === 'error_spike').length > 0 ? 'text-rose-400' : 'text-slate-300'}`}>
            {dataset.transitionStats.reduce((sum, t) => sum + t.errorCount, 0)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {dataset.transitionStats.reduce((sum, t) => sum + t.errorCount, 0) > 0 ? 'Action required' : 'Nominal run'}
          </div>
        </div>

        <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80">
          <div className="text-xs text-slate-400">Anomalies Detected</div>
          <div className={`text-xl font-bold font-mono mt-1 tabular-nums ${dataset.anomalies.length > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
            {dataset.anomalies.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {dataset.anomalies.length > 0 ? dataset.anomalies[0].title : 'Clean execution'}
          </div>
        </div>
      </div>

      {/* Anomalies Banner if any */}
      {dataset.anomalies.length > 0 && activeMode === 'telemetry' && (
        <div className="px-4 py-2 bg-amber-950/30 border-b border-amber-800/40 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="font-semibold">{dataset.anomalies[0].title}:</span>
            <span className="text-amber-200/80">{dataset.anomalies[0].description}</span>
          </div>
          {dataset.anomalies[0].stateId && (
            <button
              type="button"
              onClick={() => onJumpToState(dataset.anomalies[0].stateId!)}
              className="px-2 py-0.5 rounded bg-amber-900/60 text-amber-200 hover:bg-amber-800 border border-amber-700/60 transition-colors text-[11px]"
            >
              Locate in Canvas
            </button>
          )}
        </div>
      )}

      {/* Main Analysis View */}
      <div className="flex-1 p-4 space-y-6">
        {/* =========================================================================
            MODE 1: TELEMETRY & RUNTIME FREQUENCY OVER TIME
           ========================================================================= */}
        {activeMode === 'telemetry' && (
          <>
            {/* Transition Frequency Histogram / Area Chart */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between pb-3 mb-2 border-b border-slate-800/80 gap-2">
                <div>
                  <h2 className="text-sm font-bold text-slate-200">Transition Frequency Over Time</h2>
                  <p className="text-xs text-slate-400">
                    Temporal distribution of state changes across runtime cycle buckets (transitions per second)
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <span className="w-2.5 h-2.5 rounded-sm bg-sky-500"></span>
                    <span>Transitions</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <span className="w-2.5 h-2.5 rounded-sm bg-rose-500"></span>
                    <span>Fault Trips</span>
                  </div>
                </div>
              </div>

              {/* SVG Frequency Chart */}
              <div className="relative h-44 w-full">
                {dataset.timeBuckets.length > 0 ? (
                  <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 1000 160">
                    {/* Horizontal gridlines */}
                    {[0, 40, 80, 120].map((y) => (
                      <line
                        key={y}
                        x1="0"
                        y1={y}
                        x2="1000"
                        y2={y}
                        stroke="#1e293b"
                        strokeDasharray="4 4"
                        strokeWidth="1"
                      />
                    ))}

                    {/* Bars for each time bucket */}
                    {dataset.timeBuckets.map((bucket, idx) => {
                      const totalBars = dataset.timeBuckets.length;
                      const barWidth = 900 / totalBars;
                      const x = 50 + idx * (900 / totalBars);
                      const barHeight = Math.max(4, (bucket.count / maxBucketCount) * 120);
                      const y = 140 - barHeight;
                      const errHeight = bucket.errorCount > 0 ? Math.max(4, (bucket.errorCount / maxBucketCount) * 120) : 0;
                      const isHovered = hoveredBucketIndex === idx;

                      return (
                        <g
                          key={idx}
                          className="cursor-pointer transition-opacity"
                          onMouseEnter={() => setHoveredBucketIndex(idx)}
                          onMouseLeave={() => setHoveredBucketIndex(null)}
                        >
                          {/* Main Transition Bar */}
                          <rect
                            x={x + 2}
                            y={y}
                            width={Math.max(4, barWidth - 4)}
                            height={barHeight}
                            rx="2"
                            fill={isHovered ? '#38bdf8' : '#0284c7'}
                            opacity={isHovered ? 1 : 0.85}
                          />

                          {/* Error Overlay Bar */}
                          {errHeight > 0 && (
                            <rect
                              x={x + 2}
                              y={140 - errHeight}
                              width={Math.max(4, barWidth - 4)}
                              height={errHeight}
                              rx="2"
                              fill="#f43f5e"
                            />
                          )}

                          {/* X-axis tick label */}
                          {idx % Math.ceil(totalBars / 8) === 0 && (
                            <text
                              x={x + barWidth / 2}
                              y="155"
                              textAnchor="middle"
                              fill="#64748b"
                              fontSize="10"
                              fontFamily="monospace"
                            >
                              {bucket.label}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                    No transition events in the selected time window.
                  </div>
                )}

                {/* Tooltip Overlay */}
                {hoveredBucketIndex !== null && dataset.timeBuckets[hoveredBucketIndex] && (
                  <div
                    className="absolute z-20 pointer-events-none bg-slate-900 border border-slate-700 rounded-lg p-2.5 shadow-xl text-xs text-slate-200"
                    style={{
                      left: `${Math.min(85, Math.max(10, (hoveredBucketIndex / dataset.timeBuckets.length) * 100))}%`,
                      top: '10px',
                    }}
                  >
                    <div className="font-mono text-[11px] text-sky-400 font-bold">
                      Time: {dataset.timeBuckets[hoveredBucketIndex].label}
                    </div>
                    <div className="mt-1 flex items-center gap-3">
                      <span>
                        Transitions:{' '}
                        <strong className="font-mono tabular-nums text-white">
                          {dataset.timeBuckets[hoveredBucketIndex].count}
                        </strong>
                      </span>
                      {dataset.timeBuckets[hoveredBucketIndex].errorCount > 0 && (
                        <span className="text-rose-400 font-bold font-mono">
                          {dataset.timeBuckets[hoveredBucketIndex].errorCount} errors
                        </span>
                      )}
                    </div>
                    {dataset.timeBuckets[hoveredBucketIndex].topTransition && (
                      <div className="mt-1 text-[11px] text-slate-400 truncate max-w-xs">
                        Top: <code className="text-sky-300">{dataset.timeBuckets[hoveredBucketIndex].topTransition}</code>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[240px] max-w-md">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter transitions or states by name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              {selectedStateFocus && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-950 border border-sky-800 text-xs text-sky-300">
                  <span>Filtered to: <strong>{selectedStateFocus}</strong></span>
                  <button
                    type="button"
                    onClick={() => setSelectedStateFocus(null)}
                    className="ml-1 text-slate-400 hover:text-white"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>

            {/* Two-Column Layout: Top Transitions Table + State Dwell Times */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left 2 Cols: Detailed Transition Frequency Table */}
              <div className="lg:col-span-2 bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
                <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-sky-400" />
                    <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      Specific Transition Frequency ({filteredTransitions.length})
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">
                    Sorted by Hit Count
                  </span>
                </div>

                <div className="overflow-x-auto flex-1 max-h-[480px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-950/80 sticky top-0 text-slate-400 text-[11px] border-b border-slate-800 z-10">
                      <tr>
                        <th className="py-2 px-3 font-semibold">Priority</th>
                        <th className="py-2 px-3 font-semibold">Source State</th>
                        <th className="py-2 px-2 text-center"></th>
                        <th className="py-2 px-3 font-semibold">Target State</th>
                        <th className="py-2 px-3 font-semibold text-right">Hit Count</th>
                        <th className="py-2 px-3 font-semibold text-right">Share %</th>
                        <th className="py-2 px-3 font-semibold text-right">Avg Dwell</th>
                        <th className="py-2 px-3 font-semibold">Guard / Condition</th>
                        <th className="py-2 px-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                      {filteredTransitions.length > 0 ? (
                        filteredTransitions.map((t) => {
                          const isHigh = t.percentage >= 15;
                          return (
                            <tr
                              key={t.key}
                              className="hover:bg-slate-800/50 transition-colors group cursor-pointer"
                              onClick={() => setSelectedStateFocus(t.fromState === selectedStateFocus ? null : t.fromState)}
                            >
                              <td className="py-2 px-3">
                                {t.priority ? (
                                  <span className="px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800/80 text-[10px] font-bold">
                                    {t.priority}
                                  </span>
                                ) : (
                                  <span className="text-slate-600">-</span>
                                )}
                              </td>
                              <td className="py-2 px-3 font-semibold text-slate-200 truncate max-w-[160px]" title={t.fromState}>
                                {t.fromState}
                              </td>
                              <td className="py-2 px-2 text-center text-slate-600 group-hover:text-sky-400 transition-colors">
                                →
                              </td>
                              <td className="py-2 px-3 font-semibold text-slate-200 truncate max-w-[160px]" title={t.toState}>
                                {t.toState}
                              </td>
                              <td className="py-2 px-3 text-right font-bold text-slate-100 tabular-nums">
                                {t.hitCount.toLocaleString()}
                              </td>
                              <td className="py-2 px-3 text-right tabular-nums">
                                <div className="flex items-center justify-end gap-1.5">
                                  <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full ${isHigh ? 'bg-rose-500' : 'bg-sky-500'}`}
                                      style={{ width: `${Math.min(100, t.percentage * 2)}%` }}
                                    ></div>
                                  </div>
                                  <span className={isHigh ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                                    {t.percentage}%
                                  </span>
                                </div>
                              </td>
                              <td className="py-2 px-3 text-right text-slate-400 tabular-nums">
                                {t.avgDurationMs}ms
                              </td>
                              <td className="py-2 px-3 text-slate-400 truncate max-w-[180px]" title={t.guardCondition}>
                                {t.guardCondition ? (
                                  <span className="text-sky-300/90">{t.guardCondition}</span>
                                ) : (
                                  <span className="text-slate-600 italic">(unconditional)</span>
                                )}
                              </td>
                              <td className="py-2 px-2 text-right">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onJumpToState(t.fromState);
                                  }}
                                  className="p-1 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition-colors"
                                  title="Jump to this state in the diagram canvas"
                                >
                                  <Target className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-slate-500 font-sans text-xs">
                            No transitions found matching search query.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Right Col: State Hit Counts & Dwell Time Share */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
                <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Flame className="w-4 h-4 text-amber-400" />
                    <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      State Hit & Dwell Distribution
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {dataset.stateMetrics.length} States
                  </span>
                </div>

                <div className="p-3 space-y-2 overflow-y-auto max-h-[480px]">
                  {dataset.stateMetrics.map((st) => {
                    const colors = getHeatColorStyles(st.heatCategory);
                    const isFocus = selectedStateFocus === st.stateId;

                    return (
                      <div
                        key={st.stateId}
                        onClick={() => setSelectedStateFocus(isFocus ? null : st.stateId)}
                        className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                          isFocus
                            ? 'bg-sky-950/70 border-sky-500 shadow-md'
                            : `${colors.bgClass} ${colors.borderClass}`
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold text-slate-100 truncate" title={st.stateId}>
                            {st.stateId}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-bold ${colors.badgeBg} ${colors.badgeText}`}>
                            {st.heatScore} pts
                          </span>
                        </div>

                        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-mono text-slate-400 border-t border-slate-800/40 pt-1.5">
                          <div>
                            <span className="text-slate-500">Hits: </span>
                            <span className="text-slate-200 font-bold tabular-nums">{st.totalHits}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">In/Out: </span>
                            <span className="text-slate-200 tabular-nums">{st.inCount}/{st.outCount}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-slate-500">Dwell: </span>
                            <span className="text-slate-200 font-bold tabular-nums">{st.dwellPercentage}%</span>
                          </div>
                        </div>

                        {/* Visual Dwell Time Bar */}
                        <div className="mt-2 w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${st.dwellPercentage > 40 ? 'bg-rose-500' : 'bg-amber-500'}`}
                            style={{ width: `${Math.min(100, st.dwellPercentage)}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Recent Transition Event Waterfall Log */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800/80">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-sky-400" />
                  <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Recent Transition Event Log (Last {Math.min(dataset.events.length, 15)} transitions)
                  </h3>
                </div>
                <span className="text-[11px] text-slate-500 font-mono">
                  Real-time PLC Event Stream
                </span>
              </div>

              <div className="space-y-1.5 font-mono text-xs max-h-48 overflow-y-auto">
                {dataset.events.slice(-15).reverse().map((ev) => (
                  <div
                    key={ev.id}
                    className={`flex items-center justify-between p-2 rounded border text-[11px] ${
                      ev.errorFlag
                        ? 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-slate-500 tabular-nums">+{ev.relativeSec}s</span>
                      <span className="font-semibold text-slate-200">{ev.fromState}</span>
                      <span className="text-sky-400">→</span>
                      <span className="font-semibold text-slate-200">{ev.toState}</span>
                      {ev.guardFired && (
                        <span className="text-slate-400 text-[10px] truncate max-w-sm">
                          [{ev.guardFired}]
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-slate-400 tabular-nums">
                      <span>Dwell: {ev.durationMs}ms</span>
                      {ev.cycleCount && <span>Cycle #{ev.cycleCount}</span>}
                      {ev.errorFlag && <span className="text-rose-400 font-bold uppercase">FAULT</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* =========================================================================
            MODE 2: STATIC HIT COUNT HEATMAP & TRANSITION MATRIX
           ========================================================================= */}
        {activeMode === 'static' && (
          <div className="space-y-6">
            {/* Category Filter Pills */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-400 font-medium mr-1">Intensity:</span>
                {(['all', 'hotspot', 'high', 'moderate', 'low', 'minimal'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedHeatFilter(cat)}
                    className={`px-2.5 py-1 rounded-md capitalize font-medium transition-colors ${
                      selectedHeatFilter === cat
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="text-xs text-slate-400">
                Calculated from <strong className="text-slate-200">{states.length} states</strong> and{' '}
                <strong className="text-slate-200">{edges.length} edges</strong> in Structured Text
              </div>
            </div>

            {/* State Hit Count Cards Grid */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Flame className="w-4 h-4 text-amber-400" />
                  <span>State Hit Count Heatmap ({filteredStateMetrics.length})</span>
                </h3>
                <span className="text-xs text-slate-500">
                  Derived from branch in/out degrees, POU references, and evaluation priorities
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredStateMetrics.map((st) => {
                  const colors = getHeatColorStyles(st.heatCategory);
                  return (
                    <div
                      key={st.stateId}
                      className={`p-3 rounded-xl border transition-all ${colors.bgClass} ${colors.borderClass} flex flex-col justify-between`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-mono text-xs font-bold text-slate-100 break-all" title={st.stateId}>
                            {st.stateId}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold shrink-0 ${colors.badgeBg} ${colors.badgeText}`}>
                            {st.heatScore} pts
                          </span>
                        </div>

                        <div className="mt-3 space-y-1 text-[11px] font-mono text-slate-400">
                          <div className="flex justify-between">
                            <span className="text-slate-500">Inbound Transitions:</span>
                            <span className="text-slate-200 font-bold tabular-nums">{st.inCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Outbound Transitions:</span>
                            <span className="text-slate-200 font-bold tabular-nums">{st.outCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Structural Weight:</span>
                            <span className="text-slate-200 font-bold tabular-nums">{st.totalHits}</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between">
                        <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                          {st.heatCategory}
                        </span>
                        <button
                          type="button"
                          onClick={() => onJumpToState(st.stateId)}
                          className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
                        >
                          <span>Canvas</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* N x N Transition Matrix Heatmap */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 overflow-hidden">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/80">
                <div className="flex items-center gap-2">
                  <Grid className="w-4 h-4 text-sky-400" />
                  <div>
                    <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      State-to-State Transition Matrix Heatmap ({states.length} × {states.length})
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Rows represent source states (From); Columns represent target states (To). Hover for transition details.
                    </p>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[440px] border border-slate-800 rounded-lg">
                <table className="w-full text-center text-[10px] font-mono border-collapse">
                  <thead className="bg-slate-950 sticky top-0 z-10 text-slate-400">
                    <tr>
                      <th className="p-2 border-b border-r border-slate-800 text-left bg-slate-950 sticky left-0 z-20 min-w-[140px]">
                        From \ To
                      </th>
                      {staticAnalysis.transitionMatrix.states.map((stId) => (
                        <th key={stId} className="p-1.5 border-b border-r border-slate-800 min-w-[50px] max-w-[90px] truncate" title={stId}>
                          {stId.replace(/^[A-Z0-9]+_/, '')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {staticAnalysis.transitionMatrix.states.map((fromId, rIdx) => (
                      <tr key={fromId} className="hover:bg-slate-800/30">
                        <td className="p-2 border-r border-slate-800 text-left font-bold text-slate-300 bg-slate-950 sticky left-0 z-10 truncate max-w-[140px]" title={fromId}>
                          {fromId}
                        </td>
                        {staticAnalysis.transitionMatrix.states.map((toId, cIdx) => {
                          const val = staticAnalysis.transitionMatrix.matrix[rIdx][cIdx];
                          const meta = staticAnalysis.transitionMatrix.meta[rIdx][cIdx];
                          const hasTransition = val !== null;
                          const isSelfLoop = fromId === toId;

                          let cellBg = 'bg-transparent';
                          if (hasTransition) {
                            if (val >= 70) cellBg = 'bg-rose-900/60 text-rose-200 font-bold border border-rose-700/60';
                            else if (val >= 45) cellBg = 'bg-amber-900/60 text-amber-200 font-bold border border-amber-700/60';
                            else cellBg = 'bg-emerald-900/60 text-emerald-200 font-bold border border-emerald-700/60';
                          }

                          return (
                            <td
                              key={toId}
                              onMouseEnter={() => {
                                if (hasTransition) {
                                  setHoveredMatrixCell({
                                    from: fromId,
                                    to: toId,
                                    score: val,
                                    guard: meta?.guard,
                                    priority: meta?.priority,
                                  });
                                } else {
                                  setHoveredMatrixCell(null);
                                }
                              }}
                              onClick={() => {
                                if (hasTransition) onJumpToState(fromId);
                              }}
                              className={`p-1.5 border-r border-slate-800/50 transition-colors ${
                                hasTransition ? 'cursor-pointer' : ''
                              } ${cellBg}`}
                            >
                              {hasTransition ? (
                                <span title={`${fromId} -> ${toId}`}>
                                  {meta?.priority ? `P${meta.priority}` : '✓'}
                                </span>
                              ) : isSelfLoop ? (
                                <span className="text-slate-800">·</span>
                              ) : null}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Hovered Matrix Cell Card */}
              {hoveredMatrixCell && (
                <div className="mt-3 p-3 bg-slate-900 border border-slate-700 rounded-lg flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-slate-100">{hoveredMatrixCell.from}</span>
                    <span className="text-sky-400">→</span>
                    <span className="font-bold text-slate-100">{hoveredMatrixCell.to}</span>
                    {hoveredMatrixCell.priority && (
                      <span className="px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800 text-[10px] font-bold">
                        Priority {hoveredMatrixCell.priority}
                      </span>
                    )}
                    {hoveredMatrixCell.guard && (
                      <span className="text-slate-400 font-mono text-[11px] truncate max-w-md">
                        Guard: <code className="text-sky-300">[{hoveredMatrixCell.guard}]</code>
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onJumpToState(hoveredMatrixCell.from)}
                    className="px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium text-[11px] transition-colors"
                  >
                    Focus in Diagram
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Upload / Paste PLC Log Drawer Modal */}
      {isLogDrawerOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl shadow-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-sky-400" />
                <h3 className="text-sm font-bold text-slate-100">Import PLC Transition Log Data</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsLogDrawerOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ×
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Paste or drop your TwinCAT ADS EventLogger export, ADS Monitor CSV, or text log. Supported formats:
              CSV/TSV with columns <code className="text-sky-300">Timestamp, FromState, ToState, DurationMs, Cycle</code> or standard TwinCAT transition lines.
            </p>

            <textarea
              rows={8}
              value={rawLogInputText}
              onChange={(e) => setRawLogInputText(e.target.value)}
              placeholder={`Example CSV:\nTimestamp,FromState,ToState,DurationMs,Cycle\n2026-09-24T10:00:00.120Z,TABLEMANAGER_AUTOFEED_START_DOOR_IN,TABLEMANAGER_AUTOFEED_IDLE,240,1\n2026-09-24T10:00:00.360Z,TABLEMANAGER_AUTOFEED_IDLE,TABLEMANAGER_AUTOFEED_FEEDTHRU_START,150,1\n...`}
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
            />

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsLogDrawerOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyPastedLog}
                disabled={!rawLogInputText.trim()}
                className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium shadow-sm disabled:opacity-40"
              >
                Analyze Log
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
