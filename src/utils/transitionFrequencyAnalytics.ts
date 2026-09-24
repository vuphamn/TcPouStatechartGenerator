import { IdentifiedPouState } from './pouStateExtractor.ts';
import { EdgeInfo } from '../types.ts';

export interface PlcTransitionEvent {
  id: string;
  timestamp: number; // Epoch ms
  isoTime: string;
  relativeSec: number; // Seconds since start of log
  fromState: string;
  toState: string;
  durationMs: number; // Time spent in fromState before transition
  cycleCount?: number;
  errorFlag?: boolean;
  guardFired?: string;
}

export interface TransitionFrequencyStats {
  fromState: string;
  toState: string;
  key: string; // `${from}->${to}`
  hitCount: number;
  percentage: number; // % of total transitions
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  errorCount: number;
  guardCondition?: string;
  priority?: number;
}

export type HeatCategory = 'minimal' | 'low' | 'moderate' | 'high' | 'hotspot';

export interface StateHitMetric {
  stateId: string;
  label: string;
  inCount: number;
  outCount: number;
  totalHits: number;
  totalDwellMs: number;
  avgDwellMs: number;
  dwellPercentage: number;
  heatScore: number; // 0 - 100
  heatCategory: HeatCategory;
  isInitial?: boolean;
  isErrorSink?: boolean;
  staticBranchHits?: number;
}

export interface TimeBucket {
  timestamp: number;
  label: string;
  count: number;
  errorCount: number;
  topTransition?: string;
}

export interface PlcLogDataset {
  name: string;
  source: 'static' | 'preset' | 'file' | 'live';
  events: PlcTransitionEvent[];
  startTime: number;
  endTime: number;
  totalTransitions: number;
  durationSec: number;
  avgTransitionsPerSec: number;
  peakTransitionsPerSec: number;
  transitionStats: TransitionFrequencyStats[];
  stateMetrics: StateHitMetric[];
  timeBuckets: TimeBucket[];
  anomalies: {
    type: 'chatter' | 'bottleneck' | 'error_spike' | 'orphan';
    title: string;
    description: string;
    severity: 'info' | 'warning' | 'critical';
    stateId?: string;
    transitionKey?: string;
  }[];
}

export interface StaticHeatmapAnalysis {
  stateMetrics: StateHitMetric[];
  transitions: {
    from: string;
    to: string;
    staticScore: number;
    priority?: number;
    guard?: string;
  }[];
  transitionMatrix: {
    states: string[];
    matrix: (number | null)[][];
    meta: { from: string; to: string; guard?: string; priority?: number }[][];
  };
  totalStructuralTransitions: number;
  topHotspots: StateHitMetric[];
}

/**
 * Maps a numerical score (0-100) to a HeatCategory.
 */
export function getHeatCategory(score: number): HeatCategory {
  if (score >= 80) return 'hotspot';
  if (score >= 55) return 'high';
  if (score >= 30) return 'moderate';
  if (score >= 10) return 'low';
  return 'minimal';
}

/**
 * Returns clean CSS color variables & Tailwind classes for heat categories.
 */
export function getHeatColorStyles(category: HeatCategory): {
  bgClass: string;
  borderClass: string;
  textClass: string;
  badgeBg: string;
  badgeText: string;
  hexFill: string;
  hexStroke: string;
} {
  switch (category) {
    case 'hotspot':
      return {
        bgClass: 'bg-rose-950/40 hover:bg-rose-950/60',
        borderClass: 'border-rose-600/70',
        textClass: 'text-rose-400',
        badgeBg: 'bg-rose-950 border border-rose-700/80',
        badgeText: 'text-rose-300 font-bold',
        hexFill: '#4c0519',
        hexStroke: '#e11d48',
      };
    case 'high':
      return {
        bgClass: 'bg-amber-950/40 hover:bg-amber-950/60',
        borderClass: 'border-amber-600/70',
        textClass: 'text-amber-400',
        badgeBg: 'bg-amber-950 border border-amber-700/80',
        badgeText: 'text-amber-300 font-bold',
        hexFill: '#451a03',
        hexStroke: '#d97706',
      };
    case 'moderate':
      return {
        bgClass: 'bg-emerald-950/40 hover:bg-emerald-950/60',
        borderClass: 'border-emerald-600/70',
        textClass: 'text-emerald-400',
        badgeBg: 'bg-emerald-950 border border-emerald-700/80',
        badgeText: 'text-emerald-300 font-bold',
        hexFill: '#064e3b',
        hexStroke: '#059669',
      };
    case 'low':
      return {
        bgClass: 'bg-sky-950/30 hover:bg-sky-950/50',
        borderClass: 'border-sky-700/50',
        textClass: 'text-sky-400',
        badgeBg: 'bg-sky-950 border border-sky-800/60',
        badgeText: 'text-sky-300',
        hexFill: '#082f49',
        hexStroke: '#0284c7',
      };
    case 'minimal':
    default:
      return {
        bgClass: 'bg-slate-900/40 hover:bg-slate-900/60',
        borderClass: 'border-slate-800',
        textClass: 'text-slate-400',
        badgeBg: 'bg-slate-950 border border-slate-800',
        badgeText: 'text-slate-400',
        hexFill: '#0f172a',
        hexStroke: '#334155',
      };
  }
}

/**
 * Calculates static State Hit Count and transition matrix when no external PLC log is loaded.
 */
export function computeStaticHeatmap(
  states: IdentifiedPouState[],
  edges: EdgeInfo[],
  pouContent: string = ''
): StaticHeatmapAnalysis {
  const edgeMap = new Map<string, EdgeInfo>();
  edges.forEach((e) => {
    edgeMap.set(`${e.from}->${e.to}`, e);
  });

  // Count code assignments to each state in POU ST
  const codeOccurrenceMap = new Map<string, number>();
  states.forEach((s) => {
    let count = 0;
    try {
      const rx = new RegExp(`\\b${s.id}\\b`, 'g');
      const matches = pouContent.match(rx);
      count = matches ? matches.length : 1;
    } catch {
      count = 1;
    }
    codeOccurrenceMap.set(s.id, count);
  });

  // Calculate static raw weights
  const rawScores = states.map((s) => {
    const inEdges = edges.filter((e) => e.to === s.id);
    const outEdges = edges.filter((e) => e.from === s.id);

    // Initial states and hub states receive baseline weight
    let weight = inEdges.length * 3 + outEdges.length * 2.5;
    if (s.isInitial) weight += 15;
    if (s.isErrorSink) weight += 4;

    // Weight incoming edges by priority (priority 1 edges get higher nominal branch likelihood)
    inEdges.forEach((e) => {
      const p = e.priority ?? 1;
      if (p === 1) weight += 4;
      else if (p === 2) weight += 2.5;
      else weight += 1.5;
    });

    // Factor code mentions
    const codeHits = codeOccurrenceMap.get(s.id) || 1;
    weight += Math.min(codeHits * 1.5, 20);

    return {
      state: s,
      inCount: inEdges.length,
      outCount: outEdges.length,
      codeHits,
      rawWeight: weight,
    };
  });

  const maxRaw = Math.max(...rawScores.map((r) => r.rawWeight), 1);

  const stateMetrics: StateHitMetric[] = rawScores.map((r) => {
    const heatScore = Math.min(100, Math.round((r.rawWeight / maxRaw) * 100));
    return {
      stateId: r.state.id,
      label: r.state.label || r.state.id,
      inCount: r.inCount,
      outCount: r.outCount,
      totalHits: r.codeHits + r.inCount + r.outCount,
      totalDwellMs: 0,
      avgDwellMs: 0,
      dwellPercentage: 0,
      heatScore,
      heatCategory: getHeatCategory(heatScore),
      isInitial: r.state.isInitial,
      isErrorSink: r.state.isErrorSink,
      staticBranchHits: r.rawWeight,
    };
  });

  // Sort by heatScore descending
  stateMetrics.sort((a, b) => b.heatScore - a.heatScore);

  // Transitions list with static score
  const transitions = edges.map((e) => {
    const src = stateMetrics.find((s) => s.stateId === e.from);
    const tgt = stateMetrics.find((s) => s.stateId === e.to);
    const p = e.priority ?? 1;
    const prioMultiplier = p === 1 ? 1.0 : p === 2 ? 0.7 : 0.5;
    const score = Math.round((((src?.heatScore || 50) + (tgt?.heatScore || 50)) / 2) * prioMultiplier);

    return {
      from: e.from,
      to: e.to,
      staticScore: score,
      priority: e.priority,
      guard: e.guard || e.condition,
    };
  });

  // N x N Matrix
  const stateIds = states.map((s) => s.id);
  const matrix: (number | null)[][] = [];
  const meta: { from: string; to: string; guard?: string; priority?: number }[][] = [];

  for (let i = 0; i < stateIds.length; i++) {
    const rowVals: (number | null)[] = [];
    const rowMeta: { from: string; to: string; guard?: string; priority?: number }[] = [];
    const fromId = stateIds[i];

    for (let j = 0; j < stateIds.length; j++) {
      const toId = stateIds[j];
      const edge = edgeMap.get(`${fromId}->${toId}`);
      if (edge) {
        const tr = transitions.find((t) => t.from === fromId && t.to === toId);
        rowVals.push(tr?.staticScore ?? 50);
        rowMeta.push({
          from: fromId,
          to: toId,
          guard: edge.guard || edge.condition,
          priority: edge.priority,
        });
      } else {
        rowVals.push(null);
        rowMeta.push({ from: fromId, to: toId });
      }
    }
    matrix.push(rowVals);
    meta.push(rowMeta);
  }

  return {
    stateMetrics,
    transitions,
    transitionMatrix: {
      states: stateIds,
      matrix,
      meta,
    },
    totalStructuralTransitions: edges.length,
    topHotspots: stateMetrics.slice(0, 5),
  };
}

/**
 * Computes analytics dataset from an array of PlcTransitionEvent items.
 */
export function computeDatasetFromEvents(
  events: PlcTransitionEvent[],
  states: IdentifiedPouState[],
  edges: EdgeInfo[],
  name: string = 'PLC Runtime Log',
  source: 'static' | 'preset' | 'file' | 'live' = 'file'
): PlcLogDataset {
  if (events.length === 0) {
    return {
      name,
      source,
      events: [],
      startTime: Date.now(),
      endTime: Date.now(),
      totalTransitions: 0,
      durationSec: 0,
      avgTransitionsPerSec: 0,
      peakTransitionsPerSec: 0,
      transitionStats: [],
      stateMetrics: [],
      timeBuckets: [],
      anomalies: [],
    };
  }

  const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const startTime = sortedEvents[0].timestamp;
  const endTime = sortedEvents[sortedEvents.length - 1].timestamp;
  const durationSec = Math.max(1, (endTime - startTime) / 1000);

  // Group transitions by `${from}->${to}`
  const transMap = new Map<string, {
    from: string;
    to: string;
    durations: number[];
    errors: number;
  }>();

  // Group state hits and dwell times
  const stateHitsMap = new Map<string, {
    inCount: number;
    outCount: number;
    dwellMsList: number[];
  }>();

  // Initialize all known states
  states.forEach((s) => {
    stateHitsMap.set(s.id, { inCount: 0, outCount: 0, dwellMsList: [] });
  });

  // Edge metadata map
  const edgeMetaMap = new Map<string, EdgeInfo>();
  edges.forEach((e) => edgeMetaMap.set(`${e.from}->${e.to}`, e));

  sortedEvents.forEach((ev) => {
    const key = `${ev.fromState}->${ev.toState}`;
    if (!transMap.has(key)) {
      transMap.set(key, {
        from: ev.fromState,
        to: ev.toState,
        durations: [],
        errors: 0,
      });
    }
    const tItem = transMap.get(key)!;
    tItem.durations.push(ev.durationMs);
    if (ev.errorFlag) tItem.errors++;

    // Track fromState out and dwell
    if (!stateHitsMap.has(ev.fromState)) {
      stateHitsMap.set(ev.fromState, { inCount: 0, outCount: 0, dwellMsList: [] });
    }
    const fromRec = stateHitsMap.get(ev.fromState)!;
    fromRec.outCount++;
    fromRec.dwellMsList.push(ev.durationMs);

    // Track toState in
    if (!stateHitsMap.has(ev.toState)) {
      stateHitsMap.set(ev.toState, { inCount: 0, outCount: 0, dwellMsList: [] });
    }
    const toRec = stateHitsMap.get(ev.toState)!;
    toRec.inCount++;
  });

  const totalTransitions = sortedEvents.length;

  // Build transition stats list
  const transitionStats: TransitionFrequencyStats[] = [];
  transMap.forEach((val, key) => {
    const edge = edgeMetaMap.get(key);
    const count = val.durations.length;
    const sumDur = val.durations.reduce((a, b) => a + b, 0);
    const avgDur = count > 0 ? Math.round(sumDur / count) : 0;
    const minDur = count > 0 ? Math.min(...val.durations) : 0;
    const maxDur = count > 0 ? Math.max(...val.durations) : 0;

    transitionStats.push({
      fromState: val.from,
      toState: val.to,
      key,
      hitCount: count,
      percentage: totalTransitions > 0 ? Number(((count / totalTransitions) * 100).toFixed(1)) : 0,
      avgDurationMs: avgDur,
      minDurationMs: minDur,
      maxDurationMs: maxDur,
      errorCount: val.errors,
      guardCondition: edge?.guard || edge?.condition,
      priority: edge?.priority,
    });
  });

  // Sort transitions by hit count descending
  transitionStats.sort((a, b) => b.hitCount - a.hitCount);

  // Total dwell time across all states
  let totalSystemDwellMs = 0;
  stateHitsMap.forEach((rec) => {
    totalSystemDwellMs += rec.dwellMsList.reduce((a, b) => a + b, 0);
  });
  if (totalSystemDwellMs === 0) totalSystemDwellMs = durationSec * 1000;

  // Find max hits to scale heat scores
  let maxStateHits = 1;
  stateHitsMap.forEach((rec) => {
    const total = rec.inCount + rec.outCount;
    if (total > maxStateHits) maxStateHits = total;
  });

  // Build StateHitMetrics
  const stateMetrics: StateHitMetric[] = [];
  stateHitsMap.forEach((rec, stateId) => {
    const stObj = states.find((s) => s.id === stateId);
    const totalHits = rec.inCount + rec.outCount;
    const dwellSum = rec.dwellMsList.reduce((a, b) => a + b, 0);
    const avgDwell = rec.dwellMsList.length > 0 ? Math.round(dwellSum / rec.dwellMsList.length) : 0;
    const dwellPct = totalSystemDwellMs > 0 ? Number(((dwellSum / totalSystemDwellMs) * 100).toFixed(1)) : 0;
    const heatScore = Math.min(100, Math.round((totalHits / maxStateHits) * 100));

    stateMetrics.push({
      stateId,
      label: stObj?.label || stateId,
      inCount: rec.inCount,
      outCount: rec.outCount,
      totalHits,
      totalDwellMs: dwellSum,
      avgDwellMs: avgDwell,
      dwellPercentage: dwellPct,
      heatScore,
      heatCategory: getHeatCategory(heatScore),
      isInitial: stObj?.isInitial,
      isErrorSink: stObj?.isErrorSink,
    });
  });

  // Sort states by total hits descending
  stateMetrics.sort((a, b) => b.totalHits - a.totalHits);

  // Build Time Buckets (histogram / time-series frequency)
  const bucketCount = Math.min(30, Math.max(10, Math.round(durationSec / 5)));
  const bucketSizeMs = Math.max(500, Math.round((endTime - startTime) / bucketCount));
  const timeBuckets: TimeBucket[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const bStart = startTime + i * bucketSizeMs;
    const bEnd = bStart + bucketSizeMs;
    const inBucket = sortedEvents.filter((e) => e.timestamp >= bStart && e.timestamp < bEnd);
    const errCount = inBucket.filter((e) => e.errorFlag).length;

    // Find top transition in this bucket
    const counts = new Map<string, number>();
    inBucket.forEach((e) => {
      const k = `${e.fromState} -> ${e.toState}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    let topTrans = '';
    let maxTransC = 0;
    counts.forEach((c, k) => {
      if (c > maxTransC) {
        maxTransC = c;
        topTrans = k;
      }
    });

    const d = new Date(bStart);
    const label = `${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;

    timeBuckets.push({
      timestamp: bStart,
      label,
      count: inBucket.length,
      errorCount: errCount,
      topTransition: topTrans,
    });
  }

  const peakTransitionsPerSec =
    timeBuckets.length > 0
      ? Math.max(...timeBuckets.map((b) => Number((b.count / (bucketSizeMs / 1000)).toFixed(1))))
      : 0;

  const avgTransitionsPerSec = Number((totalTransitions / durationSec).toFixed(2));

  // Identify anomalies
  const anomalies: PlcLogDataset['anomalies'] = [];

  // Check for chatter (rapid ping-pong transitions between 2 states)
  for (let i = 0; i < sortedEvents.length - 2; i++) {
    const e1 = sortedEvents[i];
    const e2 = sortedEvents[i + 1];
    const e3 = sortedEvents[i + 2];
    if (
      e1.fromState === e2.toState &&
      e1.toState === e2.fromState &&
      e2.fromState === e3.toState &&
      e2.toState === e3.fromState &&
      e1.durationMs < 50 &&
      e2.durationMs < 50
    ) {
      anomalies.push({
        type: 'chatter',
        title: `Rapid State Bounce: ${e1.fromState} ⟷ ${e1.toState}`,
        description: `Transitions oscillating within <50ms. Potential sensor bounce or unguarded edge debounce issue.`,
        severity: 'warning',
        stateId: e1.fromState,
        transitionKey: `${e1.fromState}->${e1.toState}`,
      });
      break;
    }
  }

  // Check for bottleneck states (>50% of total system dwell time)
  stateMetrics.forEach((s) => {
    if (s.dwellPercentage >= 50 && !s.isInitial) {
      anomalies.push({
        type: 'bottleneck',
        title: `Dwell Bottleneck: ${s.label}`,
        description: `Machine spent ${s.dwellPercentage}% of total runtime in this state (avg dwell: ${(s.avgDwellMs / 1000).toFixed(1)}s).`,
        severity: 'info',
        stateId: s.stateId,
      });
    }
  });

  // Check for error sink spikes
  const errorEvents = sortedEvents.filter((e) => e.errorFlag);
  if (errorEvents.length > 0) {
    anomalies.push({
      type: 'error_spike',
      title: `${errorEvents.length} Fault/Trip Transitions Logged`,
      description: `State machine entered error branches ${errorEvents.length} time${errorEvents.length > 1 ? 's' : ''} during execution.`,
      severity: 'critical',
    });
  }

  return {
    name,
    source,
    events: sortedEvents,
    startTime,
    endTime,
    totalTransitions,
    durationSec,
    avgTransitionsPerSec,
    peakTransitionsPerSec,
    transitionStats,
    stateMetrics,
    timeBuckets,
    anomalies,
  };
}

/**
 * Parses user-provided raw text (CSV, TSV, JSON, or Beckhoff ADS text log) into PlcTransitionEvent[].
 */
export function parsePlcLogText(rawText: string, validStates: string[] = []): PlcTransitionEvent[] {
  if (!rawText || !rawText.trim()) return [];

  const text = rawText.trim();

  // Try JSON
  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const baseTime = Date.now();
        return parsed
          .map((item, idx) => {
            const from = String(item.from || item.fromState || item.source || '').trim();
            const to = String(item.to || item.toState || item.target || '').trim();
            if (!from || !to) return null;
            const ts = item.timestamp ? Number(new Date(item.timestamp).getTime()) : baseTime + idx * 200;
            return {
              id: `evt-${idx}`,
              timestamp: isNaN(ts) ? baseTime + idx * 200 : ts,
              isoTime: new Date(isNaN(ts) ? baseTime + idx * 200 : ts).toISOString(),
              relativeSec: idx * 0.2,
              fromState: from,
              toState: to,
              durationMs: Math.max(10, Number(item.durationMs || item.duration || 150)),
              cycleCount: item.cycle ? Number(item.cycle) : idx + 1,
              errorFlag: Boolean(item.error || item.errorFlag || to.toLowerCase().includes('error')),
              guardFired: item.guard || item.condition,
            };
          })
          .filter(Boolean) as PlcTransitionEvent[];
      }
    } catch {
      // Continue to line-by-line parsing
    }
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const events: PlcTransitionEvent[] = [];
  const baseEpoch = Date.now() - lines.length * 500;

  lines.forEach((line, idx) => {
    // Ignore pure comment lines
    if (line.startsWith('//') || line.startsWith('#') || line.startsWith('/*')) return;

    // Check if line is CSV / TSV header
    if (idx === 0 && (line.toLowerCase().includes('from') || line.toLowerCase().includes('state'))) {
      return;
    }

    // Attempt delimiter split (comma or tab or semicolon)
    const delimiter = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    const cols = line.split(delimiter).map((c) => c.replace(/^["']|["']$/g, '').trim());

    if (cols.length >= 2) {
      // Possible CSV row: [timestamp, from, to, duration, cycle] or [from, to, duration]
      let ts = baseEpoch + idx * 450;
      let from = '';
      let to = '';
      let dur = 150;
      let cycle = idx + 1;
      let isErr = false;

      // Try parsing first col as timestamp
      const parsedTs = Date.parse(cols[0]);
      if (!isNaN(parsedTs) && cols.length >= 3) {
        ts = parsedTs;
        from = cols[1];
        to = cols[2];
        if (cols.length >= 4 && !isNaN(Number(cols[3]))) dur = Number(cols[3]);
        if (cols.length >= 5 && !isNaN(Number(cols[4]))) cycle = Number(cols[4]);
      } else {
        // [from, to] or [from, to, dur]
        from = cols[0];
        to = cols[1];
        if (cols.length >= 3 && !isNaN(Number(cols[2]))) dur = Number(cols[2]);
      }

      if (from && to) {
        if (to.toLowerCase().includes('err') || to.toLowerCase().includes('fault')) isErr = true;
        events.push({
          id: `csv-${idx}`,
          timestamp: ts,
          isoTime: new Date(ts).toISOString(),
          relativeSec: (idx * 450) / 1000,
          fromState: from,
          toState: to,
          durationMs: Math.max(5, dur),
          cycleCount: cycle,
          errorFlag: isErr,
        });
        return;
      }
    }

    // Beckhoff ADS Log format: e.g. "2026-09-24 10:15:32.120 [INFO] Transition: STATE_A -> STATE_B"
    const adsMatch = line.match(/(?:Transition:?|State:?)\s*([A-Za-z0-9_]+)\s*(?:->|-->|=>|to)\s*([A-Za-z0-9_]+)/i);
    if (adsMatch) {
      const from = adsMatch[1];
      const to = adsMatch[2];
      const timeMatch = line.match(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?/);
      const ts = timeMatch ? Date.parse(timeMatch[0]) : baseEpoch + idx * 500;
      const isErr = line.toLowerCase().includes('error') || to.toLowerCase().includes('error');

      events.push({
        id: `ads-${idx}`,
        timestamp: isNaN(ts) ? baseEpoch + idx * 500 : ts,
        isoTime: new Date(isNaN(ts) ? baseEpoch + idx * 500 : ts).toISOString(),
        relativeSec: (idx * 500) / 1000,
        fromState: from,
        toState: to,
        durationMs: 250,
        cycleCount: idx + 1,
        errorFlag: isErr,
      });
    }
  });

  return events;
}

/**
 * Generates rich, realistic synthetic PLC runtime logs following the actual state machine graph.
 */
export function generateRealisticPlcLog(
  states: IdentifiedPouState[],
  edges: EdgeInfo[],
  scenario: 'production' | 'error_recovery' | 'stress_test' = 'production',
  totalCycleCount: number = 300
): PlcLogDataset {
  if (states.length === 0) {
    return computeDatasetFromEvents([], states, edges, 'Empty Machine', 'preset');
  }

  // Find initial state or fallback to first state
  const initial = states.find((s) => s.isInitial) || states[0];
  let currentState = initial.id;

  const events: PlcTransitionEvent[] = [];
  const baseTime = Date.now() - (scenario === 'stress_test' ? 60000 : 300000);
  let currentTimestamp = baseTime;
  let cycle = 1;

  // Pre-build out-edges map
  const outEdgesMap = new Map<string, EdgeInfo[]>();
  states.forEach((s) => {
    const outs = edges.filter((e) => e.from === s.id);
    outEdgesMap.set(s.id, outs);
  });

  // State dwell multipliers (simulate realistic physics)
  const getDwellForState = (stId: string): number => {
    const lower = stId.toLowerCase();
    if (scenario === 'stress_test') return Math.round(15 + Math.random() * 30);
    if (lower.includes('idle')) return Math.round(400 + Math.random() * 800);
    if (lower.includes('wait') || lower.includes('delay')) return Math.round(300 + Math.random() * 500);
    if (lower.includes('feed') || lower.includes('move') || lower.includes('run')) return Math.round(200 + Math.random() * 400);
    if (lower.includes('stop') || lower.includes('inpos')) return Math.round(150 + Math.random() * 250);
    if (lower.includes('error') || lower.includes('fault')) return Math.round(600 + Math.random() * 1200);
    return Math.round(100 + Math.random() * 200);
  };

  const iterations = Math.min(totalCycleCount, 1500);

  for (let i = 0; i < iterations; i++) {
    const outTransitions = outEdgesMap.get(currentState) || [];
    let nextState = '';
    let selectedEdge: EdgeInfo | undefined;
    let isError = false;

    if (outTransitions.length === 0) {
      // Dead end / terminal: loop back to initial or idle
      const restartTarget = states.find((s) => s.id.toLowerCase().includes('idle')) || initial;
      nextState = restartTarget.id;
    } else if (outTransitions.length === 1) {
      selectedEdge = outTransitions[0];
      nextState = selectedEdge.to;
    } else {
      // Prioritize edges according to priority or scenario
      if (scenario === 'error_recovery' && i % 45 === 0) {
        // Trigger error branch if available
        const errEdge = outTransitions.find((e) => e.to.toLowerCase().includes('err') || e.to.toLowerCase().includes('fault'));
        if (errEdge) {
          selectedEdge = errEdge;
          nextState = errEdge.to;
          isError = true;
        }
      }

      if (!nextState) {
        // Sort by priority (priority 1 gets ~70% chance, priority 2 gets ~25%, etc.)
        const sorted = [...outTransitions].sort((a, b) => (a.priority || 1) - (b.priority || 1));
        const rand = Math.random();
        if (rand < 0.65 || sorted.length === 1) {
          selectedEdge = sorted[0];
        } else if (rand < 0.9 || sorted.length === 2) {
          selectedEdge = sorted[1];
        } else {
          selectedEdge = sorted[Math.min(2, sorted.length - 1)];
        }
        nextState = selectedEdge.to;
      }
    }

    const dwellMs = getDwellForState(currentState);
    currentTimestamp += dwellMs;

    if (nextState.toLowerCase().includes('err') || nextState.toLowerCase().includes('fault')) {
      isError = true;
    }

    events.push({
      id: `gen-${i}`,
      timestamp: currentTimestamp,
      isoTime: new Date(currentTimestamp).toISOString(),
      relativeSec: Number(((currentTimestamp - baseTime) / 1000).toFixed(2)),
      fromState: currentState,
      toState: nextState,
      durationMs: dwellMs,
      cycleCount: cycle,
      errorFlag: isError,
      guardFired: selectedEdge?.guard || selectedEdge?.condition,
    });

    currentState = nextState;
    if (currentState === initial.id || currentState.toLowerCase().includes('idle')) {
      cycle++;
    }
  }

  const scenarioNames: Record<string, string> = {
    production: `Production Run (${events.length} transitions)`,
    error_recovery: `Fault & Recovery Test (${events.length} transitions)`,
    stress_test: `High-Throughput Stress Test (${events.length} transitions)`,
  };

  return computeDatasetFromEvents(events, states, edges, scenarioNames[scenario] || 'PLC Log', 'preset');
}
