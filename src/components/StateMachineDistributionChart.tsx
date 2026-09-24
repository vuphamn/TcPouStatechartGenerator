import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { StateMachineStatistics } from '../utils/stateMachineStats.ts';
import { PieChart, ShieldAlert, ArrowRight, LogIn, LogOut, RotateCcw } from 'lucide-react';

export interface DistributionSliceItem {
  id: string;
  label: string;
  shortLabel: string;
  value: number;
  color: string;
  hoverColor: string;
  category: 'guard' | 'unconditional' | 'loop' | 'entry' | 'exit' | 'supervisor' | 'priority1' | 'priority2' | 'priority3' | 'unassigned';
  description: string;
}

export type DistributionViewMode = 'types_and_actions' | 'priority';

export interface StateMachineDistributionChartProps {
  stats: StateMachineStatistics;
  viewMode?: DistributionViewMode;
  onViewModeChange?: (mode: DistributionViewMode) => void;
}

export const StateMachineDistributionChart: React.FC<StateMachineDistributionChartProps> = ({
  stats,
  viewMode: controlledViewMode,
  onViewModeChange,
}) => {
  const [internalViewMode, setInternalViewMode] = useState<DistributionViewMode>('types_and_actions');
  const viewMode = controlledViewMode ?? internalViewMode;

  const setViewMode = (mode: DistributionViewMode) => {
    if (onViewModeChange) {
      onViewModeChange(mode);
    } else {
      setInternalViewMode(mode);
    }
  };

  const [hoveredSliceId, setHoveredSliceId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Generate slice data based on the active view mode
  const slices: DistributionSliceItem[] = useMemo(() => {
    if (viewMode === 'types_and_actions') {
      const list: DistributionSliceItem[] = [
        {
          id: 'guards',
          label: 'Guarded Transitions',
          shortLabel: 'Guards',
          value: stats.guardedTransitionsCount,
          color: '#10b981', // emerald-500
          hoverColor: '#34d399',
          category: 'guard',
          description: 'Transitions requiring conditional boolean expressions',
        },
        {
          id: 'unconditional',
          label: 'Unconditional / Fallback',
          shortLabel: 'Fallback',
          value: stats.unconditionalTransitionsCount,
          color: '#64748b', // slate-500
          hoverColor: '#94a3b8',
          category: 'unconditional',
          description: 'Default ELSE or unnumbered continuous transitions',
        },
        {
          id: 'loops',
          label: 'Self-Loop Transitions',
          shortLabel: 'Self-Loops',
          value: stats.selfLoopsCount,
          color: '#f59e0b', // amber-500
          hoverColor: '#fbbf24',
          category: 'loop',
          description: 'Transitions looping back to the same state (dwell/timers)',
        },
        {
          id: 'entry',
          label: 'Entry Actions',
          shortLabel: 'Entry',
          value: stats.entryActionsCount,
          color: '#06b6d4', // cyan-500
          hoverColor: '#22d3ee',
          category: 'entry',
          description: 'Actions triggered when entering target states',
        },
        {
          id: 'exit',
          label: 'Exit Actions',
          shortLabel: 'Exit',
          value: stats.exitActionsCount,
          color: '#818cf8', // indigo-400
          hoverColor: '#a5b4fc',
          category: 'exit',
          description: 'Actions triggered when leaving source states',
        },
      ];

      if (stats.preProcessTransitionsCount > 0) {
        list.push({
          id: 'supervisor',
          label: 'Supervisor (preProcess)',
          shortLabel: 'preProcess',
          value: stats.preProcessTransitionsCount,
          color: '#ec4899', // pink-500
          hoverColor: '#f472b6',
          category: 'supervisor',
          description: 'Global transitions handled before state CASE block',
        });
      }

      // Filter out zero-value slices so the pie chart is clean and readable
      return list.filter((item) => item.value > 0);
    } else {
      // Transition Priorities mode
      const { priority1, priority2, priority3Plus, unassigned } = stats.priorityBreakdown;
      const list: DistributionSliceItem[] = [
        {
          id: 'p1',
          label: 'Priority 1 (Safety / Abort)',
          shortLabel: 'Priority 1',
          value: priority1,
          color: '#f43f5e', // rose-500
          hoverColor: '#fb7185',
          category: 'priority1',
          description: 'Highest precedence: evaluated first on every PLC cycle',
        },
        {
          id: 'p2',
          label: 'Priority 2 (Standard Progress)',
          shortLabel: 'Priority 2',
          value: priority2,
          color: '#0284c7', // sky-600
          hoverColor: '#38bdf8',
          category: 'priority2',
          description: 'Secondary precedence: sequence progression paths',
        },
        {
          id: 'p3',
          label: 'Priority 3+ (Tertiary / Fallback)',
          shortLabel: 'Priority 3+',
          value: priority3Plus,
          color: '#d97706', // amber-600
          hoverColor: '#f59e0b',
          category: 'priority3',
          description: 'Lower precedence: timeouts, retries, and alternate branches',
        },
        {
          id: 'unassigned',
          label: 'Unassigned / Default Flow',
          shortLabel: 'Unassigned',
          value: unassigned,
          color: '#475569', // slate-600
          hoverColor: '#64748b',
          category: 'unassigned',
          description: 'Transitions without explicit priority rank numbers',
        },
      ];

      return list.filter((item) => item.value > 0);
    }
  }, [stats, viewMode]);

  const totalValue = useMemo(() => {
    return slices.reduce((acc, s) => acc + s.value, 0);
  }, [slices]);

  const activeHoveredSlice = useMemo(() => {
    if (!hoveredSliceId) return null;
    return slices.find((s) => s.id === hoveredSliceId) || null;
  }, [hoveredSliceId, slices]);

  // Render D3 pie chart
  useEffect(() => {
    if (!svgRef.current) return;

    const width = 160;
    const height = 160;
    const radius = Math.min(width, height) / 2;
    const innerRadius = radius * 0.58; // Modern donut hole
    const outerRadius = radius * 0.92;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    if (slices.length === 0 || totalValue === 0) {
      // Empty state
      const gEmpty = svg
        .append('g')
        .attr('transform', `translate(${width / 2}, ${height / 2})`);

      gEmpty
        .append('circle')
        .attr('r', outerRadius)
        .attr('fill', 'none')
        .attr('stroke', '#334155')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '4 4');

      gEmpty
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('fill', '#64748b')
        .attr('font-size', '10px')
        .text('No Data');
      return;
    }

    const g = svg
      .append('g')
      .attr('transform', `translate(${width / 2}, ${height / 2})`);

    // D3 pie layout
    const pie = d3
      .pie<DistributionSliceItem>()
      .value((d) => d.value)
      .sort(null)
      .padAngle(0.04);

    const arc = d3
      .arc<d3.PieArcDatum<DistributionSliceItem>>()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius)
      .cornerRadius(4);

    const hoverArc = d3
      .arc<d3.PieArcDatum<DistributionSliceItem>>()
      .innerRadius(innerRadius - 2)
      .outerRadius(outerRadius + 4)
      .cornerRadius(4);

    const pieData = pie(slices);

    // Draw pie slices
    const paths = g
      .selectAll<SVGPathElement, d3.PieArcDatum<DistributionSliceItem>>('path')
      .data(pieData)
      .enter()
      .append('path')
      .attr('d', arc)
      .attr('fill', (d) => d.data.color)
      .attr('stroke', '#0f172a') // slate-900 border for crisp contrast
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .style('transition', 'all 0.2s ease')
      .attr('opacity', (d) => {
        if (!hoveredSliceId) return 0.92;
        return d.data.id === hoveredSliceId ? 1 : 0.4;
      });

    // Hover interactions
    paths
      .on('mouseenter', function (_event, d) {
        setHoveredSliceId(d.data.id);
        d3.select(this)
          .transition()
          .duration(150)
          .attr('d', hoverArc as any)
          .attr('fill', d.data.hoverColor)
          .attr('opacity', 1);
      })
      .on('mouseleave', function (_event, d) {
        setHoveredSliceId(null);
        d3.select(this)
          .transition()
          .duration(150)
          .attr('d', arc as any)
          .attr('fill', d.data.color)
          .attr('opacity', 0.92);
      });

    // Center Display inside Donut
    const centerGroup = g.append('g').attr('class', 'chart-center-group');

    if (activeHoveredSlice) {
      const percentage = ((activeHoveredSlice.value / totalValue) * 100).toFixed(1);

      centerGroup
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '-0.6em')
        .attr('fill', '#94a3b8')
        .attr('font-size', '9px')
        .attr('font-weight', '500')
        .text(activeHoveredSlice.shortLabel);

      centerGroup
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.55em')
        .attr('fill', activeHoveredSlice.color)
        .attr('font-size', '15px')
        .attr('font-weight', '700')
        .attr('font-family', 'monospace')
        .text(activeHoveredSlice.value);

      centerGroup
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '1.85em')
        .attr('fill', '#cbd5e1')
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .text(`${percentage}%`);
    } else {
      centerGroup
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '-0.25em')
        .attr('fill', '#f1f5f9')
        .attr('font-size', '15px')
        .attr('font-weight', '700')
        .attr('font-family', 'monospace')
        .text(totalValue);

      centerGroup
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '1.2em')
        .attr('fill', '#64748b')
        .attr('font-size', '9px')
        .attr('font-weight', '500')
        .text(viewMode === 'types_and_actions' ? 'Types Total' : 'Transitions');
    }
  }, [slices, totalValue, hoveredSliceId, activeHoveredSlice, viewMode]);

  return (
    <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2.5">
      {/* Chart Header with Mode Selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
          <PieChart className="w-3.5 h-3.5 text-sky-400" />
          <span>Transition & Action Distribution</span>
        </div>

        {/* View Mode Toggle Pill */}
        <div className="flex items-center p-0.5 bg-slate-900 rounded-md border border-slate-800 text-[10px]">
          <button
            type="button"
            onClick={() => setViewMode('types_and_actions')}
            className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
              viewMode === 'types_and_actions'
                ? 'bg-sky-950 text-sky-300 font-semibold shadow-2xs border border-sky-800/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="View distribution of guards vs entry actions vs exit actions"
          >
            Types & Actions
          </button>
          <button
            type="button"
            onClick={() => setViewMode('priority')}
            className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
              viewMode === 'priority'
                ? 'bg-sky-950 text-sky-300 font-semibold shadow-2xs border border-sky-800/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="View distribution of transition priorities (P1 safety, P2 progression, etc.)"
          >
            Priorities
          </button>
        </div>
      </div>

      {/* Main Chart Graphic & Slices Legend */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        {/* D3 SVG Donut Chart */}
        <div className="relative shrink-0 flex items-center justify-center">
          <svg
            ref={svgRef}
            width={160}
            height={160}
            className="overflow-visible drop-shadow-md select-none"
          />
        </div>

        {/* Interactive Legend List */}
        <div className="flex-1 w-full space-y-1.5 min-w-0">
          {slices.length === 0 ? (
            <div className="text-[11px] text-slate-500 italic py-2 text-center">
              No transition or action data available.
            </div>
          ) : (
            slices.map((slice) => {
              const isHovered = hoveredSliceId === slice.id;
              const percent = totalValue > 0 ? ((slice.value / totalValue) * 100).toFixed(1) : '0';

              return (
                <div
                  key={slice.id}
                  onMouseEnter={() => setHoveredSliceId(slice.id)}
                  onMouseLeave={() => setHoveredSliceId(null)}
                  className={`flex items-center justify-between p-1.5 px-2 rounded-md transition-all cursor-pointer border ${
                    isHovered
                      ? 'bg-slate-800/90 border-slate-600 shadow-xs scale-[1.01]'
                      : 'bg-slate-900/60 border-slate-800/70 hover:bg-slate-850'
                  }`}
                  title={slice.description}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs"
                      style={{
                        backgroundColor: slice.color,
                        boxShadow: isHovered ? `0 0 8px ${slice.color}` : 'none',
                      }}
                    />
                    <span
                      className={`text-[11px] truncate ${
                        isHovered ? 'text-white font-medium' : 'text-slate-300'
                      }`}
                    >
                      {slice.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-2 font-mono text-[10px]">
                    <span className="font-bold text-slate-200">{slice.value}</span>
                    <span className="text-slate-500">({percent}%)</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Dynamic Hint / Description Footer */}
      <div className="text-[10px] text-slate-400 bg-slate-900/50 p-1.5 px-2 rounded border border-slate-800/60 flex items-center justify-between">
        <span className="truncate">
          {activeHoveredSlice
            ? activeHoveredSlice.description
            : viewMode === 'types_and_actions'
            ? 'Hover over chart slices to inspect guards vs entry/exit breakdown'
            : 'Evaluation order: Priority 1 safety branches execute before standard steps'}
        </span>
        <span className="text-slate-500 font-mono text-[9px] shrink-0 ml-2">
          {totalValue} items total
        </span>
      </div>
    </div>
  );
};
