/**
 * Cyclomatic Complexity & Heat-Map Engine for Beckhoff TwinCAT Statecharts
 * 
 * Calculates per-state Cyclomatic Complexity (McCabe M = 1 + decisions) based on:
 * 1. Outgoing transition branching factor (fan-out)
 * 2. Guard condition predicates and compound boolean operators (AND, OR, XOR)
 * 3. Priority evaluation conflicts and order-of-evaluation
 * 4. Internal Structured Text decisions in doState() CASE branches or state methods
 * 
 * Color-codes state nodes into heat-map tiers to provide visual cues for states
 * that might need architectural refactoring.
 */

import { EdgeInfo, StateNodeInfo } from '../types.ts';

export type ComplexityLevel = 'low' | 'moderate' | 'high' | 'critical';
export type HeatmapPalette = 'traffic' | 'plasma' | 'neon';

export interface StateComplexityMetric {
  stateId: string;
  stateLabel: string;
  score: number; // Overall cyclomatic complexity score
  level: ComplexityLevel;
  levelLabel: string;
  exceedsThreshold: boolean; // True if state cyclomatic score exceeds refactor threshold
  
  // Metric Breakdown
  basePath: number; // 1
  outgoingTransitionsCount: number;
  guardedTransitionsCount: number;
  compoundConditionsCount: number;
  internalDecisionsCount: number;
  selfLoopsCount: number;
  
  // Transition Details
  outgoingTransitions: Array<{
    to: string;
    condition?: string;
    priority?: number;
    isCompound: boolean;
  }>;
  
  // Code & Refactoring
  hasCaseBranch: boolean;
  refactorNeeded: boolean;
  refactorPriority: number; // 1 (highest) to 4 (lowest)
  refactorRecommendation: string;
  refactorSuggestions: string[];

  // Styling
  color: {
    fill: string;
    stroke: string;
    strokeWidth: string;
    color: string;
    badgeBg: string;
    badgeBorder: string;
    badgeText: string;
    glowColor: string;
  };
}

export interface ComplexityHeatmapResult {
  metrics: Map<string, StateComplexityMetric>;
  metricsList: StateComplexityMetric[]; // Sorted by complexity descending
  totalStates: number;
  avgComplexity: number;
  maxComplexity: number;
  highestComplexityState?: StateComplexityMetric;
  
  // Level Breakdown
  counts: {
    low: number;
    moderate: number;
    high: number;
    critical: number;
  };
  refactorCandidatesCount: number;
  flaggedStatesCount: number;
  palette: HeatmapPalette;
  refactorThreshold: number;
}

// Color palettes for heat-map visualization
export const HEATMAP_PALETTES: Record<HeatmapPalette, {
  name: string;
  description: string;
  levels: Record<ComplexityLevel, {
    fill: string;
    stroke: string;
    strokeWidth: string;
    color: string;
    badgeBg: string;
    badgeBorder: string;
    badgeText: string;
    glowColor: string;
  }>;
}> = {
  traffic: {
    name: 'Refactor Alert (Traffic)',
    description: 'Emerald (Low) -> Sky (Moderate) -> Amber (High) -> Rose (Critical)',
    levels: {
      low: {
        fill: '#064e3b', // Emerald 900
        stroke: '#10b981', // Emerald 500
        strokeWidth: '2px',
        color: '#ecfdf5',
        badgeBg: 'rgba(5, 150, 105, 0.9)',
        badgeBorder: '#34d399',
        badgeText: '#ffffff',
        glowColor: 'rgba(16, 185, 129, 0.3)',
      },
      moderate: {
        fill: '#0c4a6e', // Sky 900
        stroke: '#38bdf8', // Sky 400
        strokeWidth: '2.5px',
        color: '#f0f9ff',
        badgeBg: 'rgba(2, 132, 199, 0.9)',
        badgeBorder: '#7dd3fc',
        badgeText: '#ffffff',
        glowColor: 'rgba(56, 189, 248, 0.3)',
      },
      high: {
        fill: '#78350f', // Amber 900
        stroke: '#f59e0b', // Amber 500
        strokeWidth: '3px',
        color: '#fffbeb',
        badgeBg: 'rgba(217, 119, 6, 0.92)',
        badgeBorder: '#fcd34d',
        badgeText: '#ffffff',
        glowColor: 'rgba(245, 158, 11, 0.45)',
      },
      critical: {
        fill: '#881337', // Rose 900
        stroke: '#f43f5e', // Rose 500
        strokeWidth: '3.5px',
        color: '#fff1f2',
        badgeBg: 'rgba(225, 29, 72, 0.95)',
        badgeBorder: '#fda4af',
        badgeText: '#ffffff',
        glowColor: 'rgba(244, 63, 94, 0.6)',
      },
    },
  },
  plasma: {
    name: 'Plasma Heat-Map',
    description: 'Deep Indigo -> Violet -> Magenta -> Vivid Crimson',
    levels: {
      low: {
        fill: '#1e1b4b',
        stroke: '#6366f1',
        strokeWidth: '2px',
        color: '#e0e7ff',
        badgeBg: 'rgba(79, 70, 229, 0.9)',
        badgeBorder: '#818cf8',
        badgeText: '#ffffff',
        glowColor: 'rgba(99, 102, 241, 0.3)',
      },
      moderate: {
        fill: '#4c1d95',
        stroke: '#a855f7',
        strokeWidth: '2.5px',
        color: '#faf5ff',
        badgeBg: 'rgba(147, 51, 234, 0.9)',
        badgeBorder: '#c084fc',
        badgeText: '#ffffff',
        glowColor: 'rgba(168, 85, 247, 0.35)',
      },
      high: {
        fill: '#701a75',
        stroke: '#ec4899',
        strokeWidth: '3px',
        color: '#fdf2f8',
        badgeBg: 'rgba(219, 39, 119, 0.92)',
        badgeBorder: '#f472b6',
        badgeText: '#ffffff',
        glowColor: 'rgba(236, 72, 153, 0.45)',
      },
      critical: {
        fill: '#7f1d1d',
        stroke: '#ef4444',
        strokeWidth: '3.5px',
        color: '#fef2f2',
        badgeBg: 'rgba(220, 38, 38, 0.95)',
        badgeBorder: '#fca5a5',
        badgeText: '#ffffff',
        glowColor: 'rgba(239, 68, 68, 0.6)',
      },
    },
  },
  neon: {
    name: 'Cyber Neon Alert',
    description: 'Teal -> Gold -> Neon Orange -> Radiant Red',
    levels: {
      low: {
        fill: '#134e4a',
        stroke: '#14b8a6',
        strokeWidth: '2px',
        color: '#f0fdfa',
        badgeBg: 'rgba(13, 148, 136, 0.9)',
        badgeBorder: '#5eead4',
        badgeText: '#ffffff',
        glowColor: 'rgba(20, 184, 166, 0.35)',
      },
      moderate: {
        fill: '#713f12',
        stroke: '#eab308',
        strokeWidth: '2.5px',
        color: '#fefce8',
        badgeBg: 'rgba(202, 138, 4, 0.9)',
        badgeBorder: '#fde047',
        badgeText: '#ffffff',
        glowColor: 'rgba(234, 179, 8, 0.35)',
      },
      high: {
        fill: '#7c2d12',
        stroke: '#f97316',
        strokeWidth: '3px',
        color: '#fff7ed',
        badgeBg: 'rgba(234, 88, 12, 0.92)',
        badgeBorder: '#fdba74',
        badgeText: '#ffffff',
        glowColor: 'rgba(249, 115, 22, 0.45)',
      },
      critical: {
        fill: '#991b1b',
        stroke: '#ff0055',
        strokeWidth: '3.5px',
        color: '#fff1f2',
        badgeBg: 'rgba(255, 0, 85, 0.95)',
        badgeBorder: '#ff99bb',
        badgeText: '#ffffff',
        glowColor: 'rgba(255, 0, 85, 0.65)',
      },
    },
  },
};

/**
 * Extracts Structured Text code corresponding to a specific state from doState() in POU
 */
function extractStateCodeFromPou(tcPouContent: string, stateId: string): string {
  if (!tcPouContent) return '';
  
  // Match doState ST body
  const doStateMatch = tcPouContent.match(/<Method[^>]*\bName=["']doState["'][^>]*>([\s\S]*?)<\/Method>/i);
  if (!doStateMatch) return '';
  
  const doStateBody = doStateMatch[1];
  
  // Find CASE branch for stateId
  const escapedState = stateId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const branchRegex = new RegExp(
    `(?:^[ \\t]*|\\b)(?:[A-Za-z0-9_]+\\s*,\\s*)*${escapedState}(?:\\s*,\\s*[A-Za-z0-9_]+)*\\s*:(?!=)([\\s\\S]*?)(?=(?:^[ \\t]*[A-Za-z0-9_]+\\s*:|END_CASE|ELSE\\b))`,
    'im'
  );
  
  const match = doStateBody.match(branchRegex);
  if (match) {
    return match[1];
  }
  
  // Also check if there is an action or method named after state: e.g. M_StateId or A_StateId
  const actionMatch = tcPouContent.match(
    new RegExp(`<Action[^>]*\\bName=["'](?:A_|M_)?${escapedState}["'][^>]*>([\\s\\S]*?)<\\/Action>`, 'i')
  );
  if (actionMatch) {
    return actionMatch[1];
  }

  return '';
}

/**
 * Counts internal Structured Text decision constructs inside a state's body
 */
function countInternalDecisionsInSt(code: string): number {
  if (!code || !code.trim()) return 0;
  
  // Remove string literals and comments to avoid false positives
  const cleanCode = code
    .replace(/\(\*[\s\S]*?\*\)/g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    
  let decisions = 0;
  
  // IF statements
  const ifMatches = cleanCode.match(/\bIF\b/gi);
  if (ifMatches) decisions += ifMatches.length;
  
  // ELSIF statements (each represents another decision branch)
  const elsifMatches = cleanCode.match(/\bELSIF\b/gi);
  if (elsifMatches) decisions += elsifMatches.length;
  
  // CASE statements inside state body (count branches)
  const caseMatches = cleanCode.match(/\bCASE\b/gi);
  if (caseMatches) decisions += caseMatches.length;
  
  // Loops (FOR, WHILE, REPEAT)
  const loopMatches = cleanCode.match(/\b(FOR|WHILE|REPEAT)\b/gi);
  if (loopMatches) decisions += loopMatches.length;
  
  // Compound boolean operators inside ST (AND, OR, XOR)
  const compoundMatches = cleanCode.match(/\b(AND|OR|XOR|AND_THEN|OR_ELSE)\b/gi);
  if (compoundMatches) {
    // We add compound operators within decisions
    decisions += Math.min(compoundMatches.length, 10);
  }
  
  return decisions;
}

/**
 * Counts compound condition operators inside a transition label / guard
 */
function countCompoundOperatorsInGuard(guardText: string): number {
  if (!guardText) return 0;
  const cleaned = guardText
    .replace(/^\[|\]$/g, '')
    .replace(/^\(|\)$/g, '');
    
  const ops = cleaned.match(/\b(AND|OR|XOR|AND_THEN|OR_ELSE)\b|&&|\|\|/gi);
  return ops ? ops.length : 0;
}

/**
 * Generates actionable refactoring recommendation for a state based on its metric breakdown
 */
function generateRefactoringAdvice(
  stateId: string,
  score: number,
  level: ComplexityLevel,
  outgoingCount: number,
  guardedCount: number,
  compoundCount: number,
  internalCount: number,
  selfLoops: number
): { recommendation: string; suggestions: string[] } {
  const suggestions: string[] = [];

  if (level === 'critical') {
    if (outgoingCount >= 4 && compoundCount >= 3) {
      suggestions.push(
        'High fan-out with multi-variable compound guards. Decompose this state into composite hierarchical sub-states (sub-FSM).'
      );
    }
    if (internalCount >= 5) {
      suggestions.push(
        'Heavy procedural logic in state body. Extract processing into dedicated helper Action/Method (e.g. A_' + stateId + ' or RunStep).'
      );
    }
    if (outgoingCount >= 5) {
      suggestions.push(
        'Excessive outgoing transition paths (' + outgoingCount + '). Centralize error/abort paths into supervisor preProcess() method.'
      );
    }
    if (suggestions.length === 0) {
      suggestions.push('High cyclomatic score (M=' + score + '). Restructure state into smaller modular states.');
    }
    return {
      recommendation: `High Cognitive Load (M=${score}): Refactoring strongly advised to maintain deterministic PLC cycle execution and unit testability.`,
      suggestions,
    };
  }

  if (level === 'high') {
    if (compoundCount >= 2) {
      suggestions.push('Simplify compound guards by caching combined boolean condition into a descriptive flag variable (e.g. bCanProceed).');
    }
    if (outgoingCount >= 4) {
      suggestions.push('Multiple branching paths (' + outgoingCount + '). Verify that transition guard priorities (1), (2) are mutually exclusive.');
    }
    if (internalCount >= 3) {
      suggestions.push('Consider moving internal nested IF conditions into state entry/exit actions.');
    }
    if (selfLoops > 0) {
      suggestions.push('State has self-loop transitions. Ensure step timeout or watchdog counter prevents infinite cyclic hangs.');
    }
    return {
      recommendation: `Elevated Complexity (M=${score}): Moderate refactoring or guard simplification recommended.`,
      suggestions,
    };
  }

  if (level === 'moderate') {
    suggestions.push(`Verify all ${outgoingCount} branching paths have automated or manual test coverage.`);
    if (compoundCount > 0) {
      suggestions.push('Guards contain boolean predicates. Ensure edge cases and edge-trigger variables (R_TRIG) are handled.');
    }
    return {
      recommendation: `Balanced Branching (M=${score}): State exhibits standard structured control flow.`,
      suggestions,
    };
  }

  // Low
  return {
    recommendation: `Clean & Linear (M=${score}): Minimal branching with high testability and deterministic timing.`,
    suggestions: ['No refactoring required. Maintain current linear transition structure.'],
  };
}

/**
 * Calculates Cyclomatic Complexity Heat-Map for all states in the diagram
 */
export function calculateStateComplexityHeatmap(
  availableStates: StateNodeInfo[],
  availableEdges: EdgeInfo[],
  tcPouContent?: string,
  palette: HeatmapPalette = 'traffic',
  refactorThreshold: number = 5
): ComplexityHeatmapResult {
  const currentPalette = HEATMAP_PALETTES[palette] || HEATMAP_PALETTES.traffic;

  // 1. Map all unique states
  const stateIds = new Set<string>();
  const stateMap = new Map<string, StateNodeInfo>();

  availableStates.forEach((s) => {
    if (s.id && !stateIds.has(s.id)) {
      stateIds.add(s.id);
      stateMap.set(s.id, s);
    }
  });

  // Ensure any states in transitions are accounted for
  availableEdges.forEach((e) => {
    if (e.from && !stateIds.has(e.from)) {
      stateIds.add(e.from);
      stateMap.set(e.from, { id: e.from, label: e.from });
    }
    if (e.to && !stateIds.has(e.to)) {
      stateIds.add(e.to);
      stateMap.set(e.to, { id: e.to, label: e.to });
    }
  });

  // 2. Group outgoing edges by source state
  const outgoingMap = new Map<string, EdgeInfo[]>();
  stateIds.forEach((id) => outgoingMap.set(id, []));

  availableEdges.forEach((e) => {
    if (outgoingMap.has(e.from)) {
      outgoingMap.get(e.from)!.push(e);
    } else {
      outgoingMap.set(e.from, [e]);
    }
  });

  // 3. Compute metric for each state
  const metrics = new Map<string, StateComplexityMetric>();
  const metricsList: StateComplexityMetric[] = [];

  let totalScoreSum = 0;
  let maxScore = 1;
  let highestMetric: StateComplexityMetric | undefined;

  const counts = {
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
  };

  for (const stateId of stateIds) {
    const nodeInfo = stateMap.get(stateId);
    const label = nodeInfo?.label || stateId;
    const outEdges = outgoingMap.get(stateId) || [];

    // Outgoing counts
    const outgoingCount = outEdges.length;
    let guardedCount = 0;
    let compoundCount = 0;
    let selfLoops = 0;

    const transitionDetails: StateComplexityMetric['outgoingTransitions'] = [];

    outEdges.forEach((e) => {
      if (e.to === stateId) {
        selfLoops++;
      }

      const cond = (e.condition || e.label || '').trim();
      const isUnconditional =
        !cond ||
        cond === 'ELSE' ||
        cond === '[preProcess]' ||
        /^[(\[{]?\d+[)\]}]?$/.test(cond);

      let isCompound = false;
      if (!isUnconditional) {
        guardedCount++;
        const ops = countCompoundOperatorsInGuard(cond);
        if (ops > 0) {
          compoundCount += ops;
          isCompound = true;
        }
      }

      transitionDetails.push({
        to: e.to,
        condition: cond || undefined,
        priority: e.priority,
        isCompound,
      });
    });

    // Internal code parsing (if tcPouContent provided)
    let internalDecisions = 0;
    let hasCase = false;
    if (tcPouContent) {
      const stateCode = extractStateCodeFromPou(tcPouContent, stateId);
      if (stateCode && stateCode.trim()) {
        hasCase = true;
        internalDecisions = countInternalDecisionsInSt(stateCode);
      }
    }

    // Cyclomatic Complexity formula for a single state:
    // Base execution path = 1
    // Each distinct guarded transition adds a predicate branch: guardedCount
    // If outgoing edges > 1 and unconditional: adds (outgoingCount - 1) branches
    // Each compound boolean condition in guards adds +1 decision (McCabe rule for compound predicates)
    // Each internal decision construct (IF, ELSIF, CASE, loop) adds +1
    let branchingFactor = 0;
    if (guardedCount > 0) {
      branchingFactor = guardedCount;
      // If there are additional unconditional branches besides guards (e.g. ELSE)
      const unconditionalEdges = outgoingCount - guardedCount;
      if (unconditionalEdges > 1) {
        branchingFactor += unconditionalEdges - 1;
      }
    } else if (outgoingCount > 1) {
      branchingFactor = outgoingCount - 1;
    }

    const calculatedScore = Math.max(
      1,
      1 + branchingFactor + compoundCount + internalDecisions
    );

    totalScoreSum += calculatedScore;
    if (calculatedScore > maxScore) {
      maxScore = calculatedScore;
    }

    // Determine level
    let level: ComplexityLevel = 'low';
    let levelLabel = 'Low Complexity';
    let refactorPriority = 4;

    const exceedsThreshold = calculatedScore >= refactorThreshold;
    const refactorNeeded = exceedsThreshold;

    if (calculatedScore >= 8) {
      level = 'critical';
      levelLabel = 'Critical (Refactor Recommended)';
      refactorPriority = 1;
      counts.critical++;
    } else if (calculatedScore >= 5) {
      level = 'high';
      levelLabel = 'High Complexity';
      refactorPriority = 2;
      counts.high++;
    } else if (calculatedScore >= 3) {
      level = 'moderate';
      levelLabel = 'Moderate Complexity';
      refactorPriority = 3;
      counts.moderate++;
    } else {
      level = 'low';
      levelLabel = 'Low Complexity';
      refactorPriority = 4;
      counts.low++;
    }

    const { recommendation, suggestions } = generateRefactoringAdvice(
      stateId,
      calculatedScore,
      level,
      outgoingCount,
      guardedCount,
      compoundCount,
      internalDecisions,
      selfLoops
    );

    // If score exceeds refactor threshold but level was moderate/low, add specific threshold advice
    if (exceedsThreshold && level !== 'critical' && level !== 'high') {
      suggestions.unshift(
        `State cyclomatic score (M=${calculatedScore}) exceeds the configured refactor threshold (${refactorThreshold}). Consider decomposing branches.`
      );
    }

    const paletteColors = currentPalette.levels[level];

    const metricItem: StateComplexityMetric = {
      stateId,
      stateLabel: label,
      score: calculatedScore,
      level,
      levelLabel,
      exceedsThreshold,
      basePath: 1,
      outgoingTransitionsCount: outgoingCount,
      guardedTransitionsCount: guardedCount,
      compoundConditionsCount: compoundCount,
      internalDecisionsCount: internalDecisions,
      selfLoopsCount: selfLoops,
      outgoingTransitions: transitionDetails,
      hasCaseBranch: hasCase,
      refactorNeeded,
      refactorPriority,
      refactorRecommendation: recommendation,
      refactorSuggestions: suggestions,
      color: paletteColors,
    };

    metrics.set(stateId, metricItem);
    metricsList.push(metricItem);

    if (!highestMetric || metricItem.score > highestMetric.score) {
      highestMetric = metricItem;
    }
  }

  // Sort list by score descending (highest complexity first)
  metricsList.sort((a, b) => b.score - a.score);

  const totalStates = Math.max(1, stateIds.size);
  const avgComplexity = Number((totalScoreSum / totalStates).toFixed(1));
  const flaggedStatesCount = metricsList.filter((m) => m.exceedsThreshold).length;

  return {
    metrics,
    metricsList,
    totalStates: stateIds.size,
    avgComplexity,
    maxComplexity: maxScore,
    highestComplexityState: highestMetric,
    counts,
    refactorCandidatesCount: flaggedStatesCount,
    flaggedStatesCount,
    palette,
    refactorThreshold,
  };
}
