import React, { useState, useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Filter,
  Flame,
  GitBranch,
  Info,
  Layers,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  Workflow,
  Zap,
} from 'lucide-react';
import {
  PouComplexityReport,
  StateComplexityReportItem,
  StateRefactorSuggestion,
  ComplexityTier,
  generateMarkdownComplexityReport,
} from '../utils/pouComplexityReport.ts';

export interface PouComplexityReportTabProps {
  report: PouComplexityReport;
  onJumpToState: (stateId: string, label?: string) => void;
  onOpenStateEditor?: (stateId: string) => void;
  onOpenMethodEditor?: (methodName: string) => void;
  onToast?: (message: string, type?: 'success' | 'error') => void;
}

export type FilterCategory = 'all' | 'critical' | 'high' | 'moderate' | 'low' | 'refactor' | 'hubs';
export type SortOption = 'complexity' | 'outgoing' | 'incoming' | 'total' | 'loc' | 'name';

export const PouComplexityReportTab: React.FC<PouComplexityReportTabProps> = ({
  report,
  onJumpToState,
  onOpenStateEditor,
  onOpenMethodEditor,
  onToast,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<FilterCategory>('all');
  const [sortOption, setSortOption] = useState<SortOption>('complexity');
  const [expandedStateIds, setExpandedStateIds] = useState<Set<string>>(new Set());
  const [copiedReport, setCopiedReport] = useState<boolean>(false);
  const [selectedSuggestionCategory, setSelectedSuggestionCategory] = useState<string>('all');

  // Toggle state accordion expansion
  const toggleExpand = (stateId: string) => {
    setExpandedStateIds((prev) => {
      const next = new Set(prev);
      if (next.has(stateId)) {
        next.delete(stateId);
      } else {
        next.add(stateId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedStateIds(new Set(report.states.map((s) => s.id)));
  };

  const collapseAll = () => {
    setExpandedStateIds(new Set());
  };

  // Copy Markdown report to clipboard
  const handleCopyReport = async () => {
    try {
      const markdown = generateMarkdownComplexityReport(report);
      await navigator.clipboard.writeText(markdown);
      setCopiedReport(true);
      onToast?.('Complexity report copied to clipboard!', 'success');
      setTimeout(() => setCopiedReport(false), 2500);
    } catch {
      onToast?.('Failed to copy report to clipboard', 'error');
    }
  };

  // Download Markdown report file
  const handleDownloadReport = () => {
    try {
      const markdown = generateMarkdownComplexityReport(report);
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${report.pouName.replace(/\.TcPOU$/i, '')}-complexity-report.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      onToast?.('Downloaded complexity report .md file', 'success');
    } catch {
      onToast?.('Failed to download report', 'error');
    }
  };

  // Filtered and sorted states list
  const filteredStates = useMemo(() => {
    return report.states
      .filter((state) => {
        // Search filter
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchesName = state.label.toLowerCase().includes(q) || state.id.toLowerCase().includes(q);
          const matchesGroup = state.group?.toLowerCase().includes(q);
          const matchesClassification = state.density.classificationLabel.toLowerCase().includes(q);
          if (!matchesName && !matchesGroup && !matchesClassification) {
            return false;
          }
        }

        // Category filter
        switch (activeFilter) {
          case 'critical':
            return state.complexity.level === 'critical';
          case 'high':
            return state.complexity.level === 'high';
          case 'moderate':
            return state.complexity.level === 'moderate';
          case 'low':
            return state.complexity.level === 'low';
          case 'refactor':
            return state.refactorNeeded;
          case 'hubs':
            return state.density.isHub;
          case 'all':
          default:
            return true;
        }
      })
      .sort((a, b) => {
        switch (sortOption) {
          case 'complexity':
            return b.complexity.score - a.complexity.score;
          case 'outgoing':
            return b.density.outgoingCount - a.density.outgoingCount;
          case 'incoming':
            return b.density.incomingCount - a.density.incomingCount;
          case 'total':
            return b.density.totalTransitions - a.density.totalTransitions;
          case 'loc':
            return b.linesOfCode - a.linesOfCode;
          case 'name':
            return a.label.localeCompare(b.label);
          default:
            return 0;
        }
      });
  }, [report.states, searchQuery, activeFilter, sortOption]);

  // Filtered Refactoring Suggestions
  const filteredSuggestions = useMemo(() => {
    if (selectedSuggestionCategory === 'all') {
      return report.topRefactorAreas;
    }
    return report.topRefactorAreas.filter((area) => area.category === selectedSuggestionCategory);
  }, [report.topRefactorAreas, selectedSuggestionCategory]);

  // Health rating badge colors
  const healthBadgeColor = useMemo(() => {
    switch (report.healthRating) {
      case 'excellent':
        return 'text-emerald-400 bg-emerald-950/60 border-emerald-800/60';
      case 'good':
        return 'text-sky-400 bg-sky-950/60 border-sky-800/60';
      case 'moderate':
        return 'text-amber-400 bg-amber-950/60 border-amber-800/60';
      case 'needs_refactor':
        return 'text-rose-400 bg-rose-950/60 border-rose-800/60';
      default:
        return 'text-slate-400 bg-slate-900 border-slate-700';
    }
  }, [report.healthRating]);

  // Helper for complexity tier styling
  const getComplexityBadge = (level: ComplexityTier, score: number) => {
    switch (level) {
      case 'critical':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-rose-950/70 text-rose-300 border border-rose-800">
            <Flame className="w-3 h-3 text-rose-400" />
            M={score} Critical
          </span>
        );
      case 'high':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-950/70 text-amber-300 border border-amber-800">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            M={score} High
          </span>
        );
      case 'moderate':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-sky-950/70 text-sky-300 border border-sky-800">
            <Activity className="w-3 h-3 text-sky-400" />
            M={score} Moderate
          </span>
        );
      case 'low':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-950/70 text-emerald-300 border border-emerald-800">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            M={score} Low
          </span>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-y-auto custom-scrollbar">
      {/* Top Sticky Header */}
      <div className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800/80 px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-sky-950/80 border border-sky-800/60 text-sky-400 shrink-0">
            <Activity className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-100 tracking-tight truncate">
                POU Complexity & Transition Density Report
              </h2>
              <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${healthBadgeColor}`}>
                Health Score: {report.healthScore}/100 ({report.healthRating.toUpperCase().replace('_', ' ')})
              </span>
            </div>
            <p className="text-xs text-slate-400 truncate">
              {report.pouName} • {report.totalStates} States • {report.totalTransitions} Transitions • McCabe Cyclomatic Complexity & Refactoring Engine
            </p>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopyReport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 border border-slate-700 hover:bg-slate-800 hover:text-sky-300 text-slate-300 transition-colors"
            title="Copy entire report as Markdown"
          >
            {copiedReport ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedReport ? 'Copied!' : 'Copy Report'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadReport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-950/80 border border-sky-800 hover:bg-sky-900 text-sky-300 transition-colors shadow-sm"
            title="Download report as Markdown file"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Markdown</span>
          </button>
        </div>
      </div>

      <div className="p-4 space-y-5 max-w-7xl w-full mx-auto">
        {/* Executive KPI Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Health Index */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Health Rating</span>
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-slate-100 tracking-tight">
              {report.healthScore}<span className="text-sm font-medium text-slate-500">/100</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className={`w-2 h-2 rounded-full ${report.healthRating === 'needs_refactor' ? 'bg-rose-500' : report.healthRating === 'moderate' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              <span className="capitalize">{report.healthRating.replace('_', ' ')}</span>
            </div>
          </div>

          {/* Graph McCabe Complexity */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Graph Complexity</span>
              <Workflow className="w-4 h-4 text-sky-400" />
            </div>
            <div className="text-2xl font-black text-sky-400 tracking-tight">
              M = {report.globalGraphComplexity}
            </div>
            <div className="mt-2 text-[11px] text-slate-400" title="M = E - N + 2P formula on control flow statechart">
              E={report.totalTransitions}, N={report.totalStates} (E-N+2)
            </div>
          </div>

          {/* Average State Complexity */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Avg State CC</span>
              <Activity className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-black text-indigo-400 tracking-tight">
              {report.avgStateComplexity}
            </div>
            <div className="mt-2 text-[11px] text-slate-400">
              Max CC: <span className="font-semibold text-rose-400">{report.maxStateComplexity}</span> ({report.highestComplexityState?.label || 'None'})
            </div>
          </div>

          {/* Transition Density */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Transition Density</span>
              <GitBranch className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-emerald-400 tracking-tight">
              {report.avgTransitionDensity} <span className="text-xs font-normal text-slate-500">out/state</span>
            </div>
            <div className="mt-2 text-[11px] text-slate-400">
              Graph Density: {(report.densityCoefficient * 100).toFixed(1)}%
            </div>
          </div>

          {/* Refactoring Candidates */}
          <div
            onClick={() => setActiveFilter(activeFilter === 'refactor' ? 'all' : 'refactor')}
            className={`cursor-pointer bg-slate-900/90 border rounded-xl p-3.5 flex flex-col justify-between shadow-sm transition-colors ${
              activeFilter === 'refactor'
                ? 'border-rose-700/80 bg-rose-950/20'
                : 'border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Refactor Needed</span>
              <Flame className="w-4 h-4 text-rose-400" />
            </div>
            <div className="text-2xl font-black text-rose-400 tracking-tight">
              {report.refactorCandidatesCount} <span className="text-xs font-normal text-slate-500">states</span>
            </div>
            <div className="mt-2 text-[11px] text-rose-300/80">
              {report.refactorCandidatesCount > 0 ? 'Click to filter candidates' : 'All states optimal'}
            </div>
          </div>

          {/* Hubs & Bottlenecks */}
          <div
            onClick={() => setActiveFilter(activeFilter === 'hubs' ? 'all' : 'hubs')}
            className={`cursor-pointer bg-slate-900/90 border rounded-xl p-3.5 flex flex-col justify-between shadow-sm transition-colors ${
              activeFilter === 'hubs'
                ? 'border-amber-700/80 bg-amber-950/20'
                : 'border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Transition Hubs</span>
              <Layers className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-black text-amber-400 tracking-tight">
              {report.densitySummary.dispatcherHubs + report.densitySummary.bottleneckHubs}
            </div>
            <div className="mt-2 text-[11px] text-slate-400">
              {report.densitySummary.dispatcherHubs} Dispatcher, {report.densitySummary.bottleneckHubs} Collector
            </div>
          </div>
        </div>

        {/* Structural Metrics & Complexity Distribution Bar */}
        <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              State Complexity & Transition Topology Distribution
            </h3>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 text-slate-400">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
                Critical: {report.counts.critical}
              </span>
              <span className="flex items-center gap-1 text-slate-400">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
                High: {report.counts.high}
              </span>
              <span className="flex items-center gap-1 text-slate-400">
                <span className="w-2.5 h-2.5 rounded-sm bg-sky-500" />
                Moderate: {report.counts.moderate}
              </span>
              <span className="flex items-center gap-1 text-slate-400">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                Low: {report.counts.low}
              </span>
            </div>
          </div>

          {/* Visual Percentage Distribution Bar */}
          <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden flex shadow-inner border border-slate-800">
            {report.counts.critical > 0 && (
              <div
                style={{ width: `${(report.counts.critical / report.totalStates) * 100}%` }}
                className="bg-rose-500 h-full transition-all"
                title={`Critical: ${report.counts.critical} (${Math.round((report.counts.critical / report.totalStates) * 100)}%)`}
              />
            )}
            {report.counts.high > 0 && (
              <div
                style={{ width: `${(report.counts.high / report.totalStates) * 100}%` }}
                className="bg-amber-500 h-full transition-all"
                title={`High: ${report.counts.high} (${Math.round((report.counts.high / report.totalStates) * 100)}%)`}
              />
            )}
            {report.counts.moderate > 0 && (
              <div
                style={{ width: `${(report.counts.moderate / report.totalStates) * 100}%` }}
                className="bg-sky-500 h-full transition-all"
                title={`Moderate: ${report.counts.moderate} (${Math.round((report.counts.moderate / report.totalStates) * 100)}%)`}
              />
            )}
            {report.counts.low > 0 && (
              <div
                style={{ width: `${(report.counts.low / report.totalStates) * 100}%` }}
                className="bg-emerald-500 h-full transition-all"
                title={`Low: ${report.counts.low} (${Math.round((report.counts.low / report.totalStates) * 100)}%)`}
              />
            )}
          </div>

          {/* Quick Topology Pills */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-1">
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 text-center">
              <span className="text-[11px] text-slate-400 block">Dispatcher Hubs</span>
              <span className="text-sm font-bold text-amber-400">{report.densitySummary.dispatcherHubs}</span>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 text-center">
              <span className="text-[11px] text-slate-400 block">Collector Bottlenecks</span>
              <span className="text-sm font-bold text-sky-400">{report.densitySummary.bottleneckHubs}</span>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 text-center">
              <span className="text-[11px] text-slate-400 block">Linear Pipelines</span>
              <span className="text-sm font-bold text-emerald-400">{report.densitySummary.linearStates}</span>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 text-center">
              <span className="text-[11px] text-slate-400 block">Fault / Error Sinks</span>
              <span className="text-sm font-bold text-rose-400">{report.densitySummary.errorSinks}</span>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 text-center">
              <span className="text-[11px] text-slate-400 block">Terminal Dead Ends</span>
              <span className={`text-sm font-bold ${report.densitySummary.deadEnds > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                {report.densitySummary.deadEnds}
              </span>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 text-center">
              <span className="text-[11px] text-slate-400 block">Unreachable States</span>
              <span className={`text-sm font-bold ${report.densitySummary.unreachable > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                {report.densitySummary.unreachable}
              </span>
            </div>
          </div>
        </div>

        {/* Section 2: Refactoring Opportunities & Action Plan */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-sm space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Refactoring Opportunities & Architectural Recommendations
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Automated detection of transition density hotspots, fan-out bloat, high cyclomatic procedural logic, and supervisor refactoring areas.
              </p>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setSelectedSuggestionCategory('all')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  selectedSuggestionCategory === 'all'
                    ? 'bg-slate-800 text-sky-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All ({report.topRefactorAreas.length})
              </button>
              <button
                type="button"
                onClick={() => setSelectedSuggestionCategory('density')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  selectedSuggestionCategory === 'density'
                    ? 'bg-slate-800 text-sky-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Transition Density
              </button>
              <button
                type="button"
                onClick={() => setSelectedSuggestionCategory('cyclomatic')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  selectedSuggestionCategory === 'cyclomatic'
                    ? 'bg-slate-800 text-sky-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Procedural CC
              </button>
              <button
                type="button"
                onClick={() => setSelectedSuggestionCategory('supervisor')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  selectedSuggestionCategory === 'supervisor'
                    ? 'bg-slate-800 text-sky-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Supervisor
              </button>
              <button
                type="button"
                onClick={() => setSelectedSuggestionCategory('safety')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  selectedSuggestionCategory === 'safety'
                    ? 'bg-slate-800 text-sky-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Safety & Liveness
              </button>
            </div>
          </div>

          {filteredSuggestions.length === 0 ? (
            <div className="py-8 text-center bg-slate-950/40 rounded-xl border border-dashed border-slate-800/80">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
              <p className="text-sm font-semibold text-slate-200">No Architectural Hotspots Flagged</p>
              <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                State transition density and cyclomatic complexity are well-balanced across all states. Deterministic execution timing is maintained.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredSuggestions.map((area) => {
                const isCritical = area.severity === 'critical';
                const isWarning = area.severity === 'warning';

                return (
                  <div
                    key={area.id}
                    className={`rounded-xl p-3.5 border flex flex-col justify-between transition-all ${
                      isCritical
                        ? 'bg-rose-950/20 border-rose-800/60 shadow-sm'
                        : isWarning
                        ? 'bg-amber-950/20 border-amber-800/60 shadow-sm'
                        : 'bg-slate-950/40 border-slate-800/80'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                              isCritical
                                ? 'bg-rose-950/80 text-rose-300 border-rose-700'
                                : isWarning
                                ? 'bg-amber-950/80 text-amber-300 border-amber-700'
                                : 'bg-sky-950/80 text-sky-300 border-sky-700'
                            }`}
                          >
                            {area.severity}
                          </span>
                          <span className="text-xs font-semibold text-slate-400">{area.categoryLabel}</span>
                        </div>

                        <span className="text-xs text-slate-500 font-mono">
                          {area.affectedStates.length} state{area.affectedStates.length === 1 ? '' : 's'}
                        </span>
                      </div>

                      <h4 className="text-sm font-bold text-slate-100 mb-1.5">{area.title}</h4>
                      <p className="text-xs text-slate-300/90 leading-relaxed mb-2.5">{area.description}</p>

                      {/* TwinCAT Architectural Recommendation */}
                      <div className="bg-slate-950/80 rounded-lg p-2.5 border border-slate-800/80 mb-2.5 text-xs space-y-1">
                        <div className="flex items-center gap-1 font-semibold text-amber-300">
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>TwinCAT Architecture Recommendation:</span>
                        </div>
                        <p className="text-slate-300 pl-4 leading-relaxed">{area.recommendation}</p>
                      </div>

                      <div className="text-[11px] text-emerald-400/90 flex items-center gap-1 mb-3">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span><strong>Expected Impact:</strong> {area.impact}</span>
                      </div>
                    </div>

                    {/* Affected State Pills & Actions */}
                    <div className="pt-2 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[10px] text-slate-500 font-medium mr-1">States:</span>
                        {area.affectedStates.slice(0, 4).map((st) => (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => onJumpToState(st.id, st.label)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 hover:text-sky-200 text-[11px] font-mono transition-colors"
                            title={`Jump to state ${st.label} in diagram canvas`}
                          >
                            <span>{st.label}</span>
                            <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                          </button>
                        ))}
                        {area.affectedStates.length > 4 && (
                          <span className="text-[11px] text-slate-400 font-mono">
                            +{area.affectedStates.length - 4} more
                          </span>
                        )}
                      </div>

                      {area.affectedStates.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const first = area.affectedStates[0];
                            onJumpToState(first.id, first.label);
                          }}
                          className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 font-medium transition-colors"
                        >
                          <span>Inspect in Canvas</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Section 3: State-by-State Cyclomatic Complexity & Transition Density Matrix */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Workflow className="w-4 h-4 text-sky-400" />
                State Complexity & Transition Density Matrix
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Detailed per-state breakdown of McCabe cyclomatic score (decisions + guards), fan-out density, and Structured Text lines.
              </p>
            </div>

            {/* Quick Expand / Collapse All */}
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={expandAll}
                className="px-2 py-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                Expand All
              </button>
              <span className="text-slate-700">|</span>
              <button
                type="button"
                onClick={collapseAll}
                className="px-2 py-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                Collapse All
              </button>
            </div>
          </div>

          {/* Search, Filter Pills & Sort Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {/* Search Input */}
            <div className="relative min-w-[220px] max-w-sm flex-1">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search state name, group, or role..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs bg-slate-950 border border-slate-800 focus:border-sky-500 focus:outline-none text-slate-200 placeholder-slate-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Filter Buttons */}
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <button
                type="button"
                onClick={() => setActiveFilter('all')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  activeFilter === 'all'
                    ? 'bg-slate-800 text-sky-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All ({report.totalStates})
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('critical')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  activeFilter === 'critical'
                    ? 'bg-rose-950/80 text-rose-300 font-semibold border border-rose-800/80'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Critical ({report.counts.critical})
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('high')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  activeFilter === 'high'
                    ? 'bg-amber-950/80 text-amber-300 font-semibold border border-amber-800/80'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                High ({report.counts.high})
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('refactor')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  activeFilter === 'refactor'
                    ? 'bg-rose-950/80 text-rose-300 font-semibold border border-rose-800/80'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Refactor Needed ({report.refactorCandidatesCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('hubs')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  activeFilter === 'hubs'
                    ? 'bg-amber-950/80 text-amber-300 font-semibold border border-amber-800/80'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Hubs ({report.densitySummary.dispatcherHubs + report.densitySummary.bottleneckHubs})
              </button>
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="shrink-0">Sort:</span>
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as SortOption)}
                className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-slate-200 focus:outline-none focus:border-sky-500 text-xs"
              >
                <option value="complexity">Cyclomatic Complexity (Highest)</option>
                <option value="outgoing">Outgoing Fan-Out Density</option>
                <option value="incoming">Incoming Fan-In</option>
                <option value="total">Total Transitions</option>
                <option value="loc">Lines of Code</option>
                <option value="name">State Name (A-Z)</option>
              </select>
            </div>
          </div>

          {/* States Table / Cards List */}
          {filteredStates.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              No states match current search query or filter selection.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredStates.map((state) => {
                const isExpanded = expandedStateIds.has(state.id);

                return (
                  <div
                    key={state.id}
                    className={`border rounded-xl transition-colors ${
                      isExpanded
                        ? 'bg-slate-950/80 border-slate-700 shadow-md'
                        : 'bg-slate-950/40 border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    {/* Main Row Header */}
                    <div
                      onClick={() => toggleExpand(state.id)}
                      className="p-3 cursor-pointer flex flex-wrap items-center justify-between gap-3 select-none"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <button
                          type="button"
                          className="text-slate-500 hover:text-slate-300 transition-colors p-0.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(state.id);
                          }}
                        >
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-100 font-mono truncate">
                              {state.label}
                            </span>

                            {state.isInitial && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                                Initial
                              </span>
                            )}

                            {state.isErrorSink && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-800">
                                Error Sink
                              </span>
                            )}

                            {state.group && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                                {state.group}
                              </span>
                            )}

                            {state.density.isHub && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-950/70 text-amber-300 border border-amber-800">
                                {state.density.classificationLabel}
                              </span>
                            )}
                          </div>

                          {state.description && (
                            <p className="text-xs text-slate-400 truncate mt-0.5 max-w-xl">
                              {state.description}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Right-Side Metrics Summary */}
                      <div className="flex items-center gap-3 shrink-0">
                        {/* Outgoing Fan-Out Badge */}
                        <div
                          className="flex items-center gap-1 text-xs font-mono px-2 py-1 rounded bg-slate-900 border border-slate-800"
                          title={`Outgoing Transitions: ${state.density.outgoingCount} (Relative Density: ${state.density.relativeDensity}x)`}
                        >
                          <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400 font-semibold">{state.density.outgoingCount}</span>
                          <span className="text-[10px] text-slate-500">out</span>
                        </div>

                        {/* Incoming Fan-In Badge */}
                        <div
                          className="flex items-center gap-1 text-xs font-mono px-2 py-1 rounded bg-slate-900 border border-slate-800"
                          title={`Incoming Transitions: ${state.density.incomingCount}`}
                        >
                          <ArrowDownLeft className="w-3.5 h-3.5 text-indigo-400" />
                          <span className="text-indigo-400 font-semibold">{state.density.incomingCount}</span>
                          <span className="text-[10px] text-slate-500">in</span>
                        </div>

                        {/* Cyclomatic Complexity Badge */}
                        <div>{getComplexityBadge(state.complexity.level, state.complexity.score)}</div>

                        {/* Refactor Action Required Pill */}
                        {state.refactorNeeded && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-950/90 text-rose-300 border border-rose-800 animate-pulse">
                            Refactor
                          </span>
                        )}

                        {/* Quick Jump Action */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onJumpToState(state.id, state.label);
                          }}
                          className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-sky-400 hover:text-sky-300 border border-slate-800 transition-colors"
                          title="Focus state in Diagram Canvas"
                        >
                          <Target className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Expandable State Detail Panel */}
                    {isExpanded && (
                      <div className="p-4 border-t border-slate-800/80 bg-slate-950/90 space-y-4">
                        {/* Cyclomatic Formula Breakdown Card */}
                        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 text-xs space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-200 flex items-center gap-1.5">
                              <Activity className="w-3.5 h-3.5 text-sky-400" />
                              Cyclomatic Complexity Breakdown (McCabe)
                            </span>
                            <span className="font-mono text-sky-400 font-semibold">
                              {state.complexity.formulaText}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
                            <div className="bg-slate-950 p-2 rounded border border-slate-800">
                              <span className="text-slate-400 block">Base Path</span>
                              <span className="font-semibold text-slate-200">1</span>
                            </div>
                            <div className="bg-slate-950 p-2 rounded border border-slate-800">
                              <span className="text-slate-400 block">Guarded Branches</span>
                              <span className="font-semibold text-emerald-400">+{state.complexity.guardedBranches}</span>
                            </div>
                            <div className="bg-slate-950 p-2 rounded border border-slate-800">
                              <span className="text-slate-400 block">Compound Conditions</span>
                              <span className="font-semibold text-amber-400">+{state.complexity.compoundOperators}</span>
                            </div>
                            <div className="bg-slate-950 p-2 rounded border border-slate-800">
                              <span className="text-slate-400 block">ST Internal Decisions</span>
                              <span className="font-semibold text-indigo-400">+{state.complexity.internalDecisions}</span>
                            </div>
                          </div>
                        </div>

                        {/* Transition Details: Outgoing & Incoming Lists */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {/* Outgoing Transitions */}
                          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 text-xs space-y-2">
                            <div className="flex items-center justify-between font-semibold text-slate-200 border-b border-slate-800 pb-1.5">
                              <span className="flex items-center gap-1.5 text-emerald-400">
                                <ArrowUpRight className="w-3.5 h-3.5" />
                                Outgoing Transitions ({state.density.outgoingCount})
                              </span>
                              <span className="text-[10px] text-slate-500 font-normal">
                                Density: {state.density.relativeDensity}× avg
                              </span>
                            </div>

                            {state.outgoingTransitions.length === 0 ? (
                              <p className="text-slate-500 italic py-2">No outgoing transitions (Terminal State).</p>
                            ) : (
                              <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                                {state.outgoingTransitions.map((out, idx) => (
                                  <div
                                    key={idx}
                                    className="p-2 rounded bg-slate-950 border border-slate-800/80 flex items-center justify-between gap-2"
                                  >
                                    <div className="min-w-0 flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => onJumpToState(out.to, out.toLabel)}
                                        className="font-mono text-sky-400 hover:underline truncate"
                                      >
                                        → {out.to}
                                      </button>
                                      {out.isSelfLoop && (
                                        <span className="px-1 rounded text-[9px] bg-amber-950 text-amber-300 border border-amber-800">
                                          Self Loop
                                        </span>
                                      )}
                                    </div>

                                    {out.condition && (
                                      <span
                                        className="text-[10px] text-slate-400 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 truncate max-w-[180px]"
                                        title={out.condition}
                                      >
                                        [{out.condition}]
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Incoming Transitions */}
                          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 text-xs space-y-2">
                            <div className="flex items-center justify-between font-semibold text-slate-200 border-b border-slate-800 pb-1.5">
                              <span className="flex items-center gap-1.5 text-indigo-400">
                                <ArrowDownLeft className="w-3.5 h-3.5" />
                                Incoming Transitions ({state.density.incomingCount})
                              </span>
                              <span className="text-[10px] text-slate-500 font-normal">
                                Fan-in Collector
                              </span>
                            </div>

                            {state.incomingTransitions.length === 0 ? (
                              <p className="text-slate-500 italic py-2">
                                {state.isInitial ? 'Initial machine entry state.' : 'No incoming transitions found (Unreachable).'}
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-1 max-h-48 overflow-y-auto custom-scrollbar">
                                {state.incomingTransitions.map((fromId, idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => onJumpToState(fromId)}
                                    className="px-2 py-1 rounded bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-sky-300 font-mono text-[11px] border border-slate-800 transition-colors"
                                  >
                                    ← {fromId}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Refactoring Recommendations for this specific state */}
                        {state.suggestions.length > 0 && (
                          <div className="bg-rose-950/20 border border-rose-900/60 rounded-xl p-3 text-xs space-y-2">
                            <div className="flex items-center gap-1.5 font-bold text-rose-300">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>Refactoring Diagnosis & Recommendations</span>
                            </div>
                            <div className="space-y-2">
                              {state.suggestions.map((sug) => (
                                <div key={sug.id} className="bg-slate-950/80 p-2.5 rounded-lg border border-rose-950/80 space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="font-semibold text-rose-200">{sug.title}</span>
                                    <span className="text-[10px] uppercase font-bold text-rose-400">{sug.severity}</span>
                                  </div>
                                  <p className="text-slate-300">{sug.diagnosis}</p>
                                  <p className="text-amber-300 font-medium">💡 Recommendation: {sug.recommendation}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Structured Text Code Preview */}
                        {state.code && (
                          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 text-xs space-y-2">
                            <div className="flex items-center justify-between font-semibold text-slate-300">
                              <span className="flex items-center gap-1.5">
                                <Code2 className="w-3.5 h-3.5 text-sky-400" />
                                Structured Text Logic ({state.linesOfCode} lines)
                              </span>
                              {onOpenStateEditor && (
                                <button
                                  type="button"
                                  onClick={() => onOpenStateEditor(state.id)}
                                  className="text-sky-400 hover:text-sky-300 flex items-center gap-1 font-medium text-xs"
                                >
                                  <span>Edit State Code</span>
                                  <ExternalLink className="w-3 h-3" />
                                </button>
                              )}
                            </div>

                            <pre className="p-3 bg-slate-950 rounded-lg text-slate-300 font-mono text-[11px] overflow-x-auto max-h-48 border border-slate-800 custom-scrollbar leading-relaxed">
                              {state.code.trim()}
                            </pre>
                          </div>
                        )}

                        {/* State Actions Footer */}
                        <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-800/60">
                          <button
                            type="button"
                            onClick={() => onJumpToState(state.id, state.label)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-950 hover:bg-sky-900 text-sky-300 border border-sky-800 text-xs font-medium transition-colors"
                          >
                            <Target className="w-3.5 h-3.5" />
                            <span>Jump to Canvas</span>
                          </button>

                          {onOpenStateEditor && (
                            <button
                              type="button"
                              onClick={() => onOpenStateEditor(state.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-medium transition-colors"
                            >
                              <Code2 className="w-3.5 h-3.5" />
                              <span>Open State Editor</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
