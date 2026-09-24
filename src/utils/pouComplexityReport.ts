/**
 * Comprehensive POU Cyclomatic Complexity & Transition Density Analysis Engine
 * 
 * Provides in-depth analysis for Beckhoff TwinCAT state machine POUs (.TcPOU and .TcDUT):
 * 1. Per-state Cyclomatic Complexity (McCabe M = 1 + decision points)
 * 2. Transition Density metrics (Fan-out, Fan-in, Hub classification, Density coefficient)
 * 3. Categorized Refactoring Opportunities based on Transition Density & Cyclomatic hotspots
 * 4. Architectural Health Index & Markdown documentation generator
 */

import { IdentifiedPouState, PouStatesExtractionResult } from './pouStateExtractor.ts';
import { EdgeInfo } from '../types.ts';

export type ComplexityTier = 'low' | 'moderate' | 'high' | 'critical';
export type HealthRating = 'excellent' | 'good' | 'moderate' | 'needs_refactor';

export type StateClassification =
  | 'dispatcher_hub'
  | 'bottleneck_hub'
  | 'router_hub'
  | 'linear'
  | 'error_sink'
  | 'dead_end'
  | 'unreachable'
  | 'transient';

export interface StateTransitionDensity {
  outgoingCount: number; // Fan-out
  incomingCount: number; // Fan-in
  totalTransitions: number; // Degree (E_out + E_in)
  densityRatio: number; // E_out / max(1, N - 1)
  relativeDensity: number; // E_out / avgOutgoing
  classification: StateClassification;
  classificationLabel: string;
  classificationDescription: string;
  isHub: boolean;
}

export interface StateCyclomaticBreakdown {
  score: number; // Total M
  basePath: number; // 1
  guardedBranches: number; // Guarded transition decisions
  unconditionalBranches: number; // Extra unconditional decisions (E_out - guarded - 1)
  compoundOperators: number; // Compound boolean operators in transition guards (AND, OR, XOR)
  internalDecisions: number; // Decision constructs inside ST body (IF, ELSIF, CASE, loops)
  compoundInCode: number; // Compound boolean operators in ST code
  selfLoops: number; // Self-directed transitions
  level: ComplexityTier;
  levelLabel: string;
  formulaText: string;
}

export interface StateRefactorSuggestion {
  id: string;
  stateId: string;
  stateLabel: string;
  category: 'density' | 'cyclomatic' | 'supervisor' | 'safety' | 'guard';
  categoryLabel: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  diagnosis: string;
  recommendation: string;
  impact: string;
  suggestedAction: string;
}

export interface StateTransitionItem {
  to: string;
  toLabel?: string;
  condition?: string;
  priority?: number;
  isCompound: boolean;
  isSelfLoop: boolean;
}

export interface StateComplexityReportItem {
  id: string;
  label: string;
  description?: string;
  group?: string;
  isInitial: boolean;
  isErrorSink: boolean;
  hasCaseBranch: boolean;
  linesOfCode: number;
  code?: string;
  outgoingTransitions: StateTransitionItem[];
  incomingTransitions: string[];
  density: StateTransitionDensity;
  complexity: StateCyclomaticBreakdown;
  suggestions: StateRefactorSuggestion[];
  refactorNeeded: boolean;
  refactorPriority: number; // 1 (highest) to 4 (lowest)
}

export interface RefactoringAreaSummary {
  id: string;
  title: string;
  category: 'density' | 'cyclomatic' | 'supervisor' | 'safety' | 'guard';
  categoryLabel: string;
  severity: 'critical' | 'warning' | 'info';
  description: string;
  recommendation: string;
  impact: string;
  affectedStates: Array<{ id: string; label: string; metricValue?: string }>;
}

export interface PouComplexityReport {
  pouName: string;
  totalStates: number;
  totalTransitions: number;
  globalGraphComplexity: number; // McCabe M = E - N + 2P
  cumulativeCodeComplexity: number; // Sum of per-state CC
  avgStateComplexity: number;
  maxStateComplexity: number;
  highestComplexityState?: StateComplexityReportItem;
  avgTransitionDensity: number; // E / N
  densityCoefficient: number; // E / (N * (N - 1))
  maxOutgoingCount: number;
  maxIncomingCount: number;
  healthScore: number; // 0 - 100
  healthRating: HealthRating;
  counts: {
    low: number;
    moderate: number;
    high: number;
    critical: number;
  };
  densitySummary: {
    dispatcherHubs: number;
    bottleneckHubs: number;
    linearStates: number;
    deadEnds: number;
    unreachable: number;
    errorSinks: number;
  };
  states: StateComplexityReportItem[];
  allSuggestions: StateRefactorSuggestion[];
  refactorCandidatesCount: number;
  topRefactorAreas: RefactoringAreaSummary[];
}

/**
 * Counts internal Structured Text decision constructs inside a state's body
 */
function analyzeStructuredTextDecisions(code?: string): { decisions: number; compoundInCode: number; loc: number } {
  if (!code || !code.trim()) {
    return { decisions: 0, compoundInCode: 0, loc: 0 };
  }

  const lines = code.trim().split(/\r?\n/).length;

  // Clean code of comments and strings
  const cleanCode = code
    .replace(/\(\*[\s\S]*?\*\)/g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");

  let decisions = 0;

  // IF statements
  const ifMatches = cleanCode.match(/\bIF\b/gi);
  if (ifMatches) decisions += ifMatches.length;

  // ELSIF statements (each is a decision branch)
  const elsifMatches = cleanCode.match(/\bELSIF\b/gi);
  if (elsifMatches) decisions += elsifMatches.length;

  // CASE statements inside state body
  const caseMatches = cleanCode.match(/\bCASE\b/gi);
  if (caseMatches) decisions += caseMatches.length;

  // Loops (FOR, WHILE, REPEAT)
  const loopMatches = cleanCode.match(/\b(FOR|WHILE|REPEAT)\b/gi);
  if (loopMatches) decisions += loopMatches.length;

  // Compound operators in ST (AND, OR, XOR)
  const compoundMatches = cleanCode.match(/\b(AND|OR|XOR|AND_THEN|OR_ELSE)\b/gi);
  const compoundCount = compoundMatches ? Math.min(compoundMatches.length, 12) : 0;

  return {
    decisions: decisions + compoundCount,
    compoundInCode: compoundCount,
    loc: lines,
  };
}

/**
 * Counts compound condition operators inside a transition guard text
 */
function countCompoundOperators(condition?: string): number {
  if (!condition) return 0;
  const cleaned = condition.replace(/^[\[(]|[\])]$/g, '');
  const matches = cleaned.match(/\b(AND|OR|XOR|AND_THEN|OR_ELSE)\b|&&|\|\|/gi);
  return matches ? matches.length : 0;
}

/**
 * Generates comprehensive POU complexity report
 */
export function generatePouComplexityReport(
  extractedResult: PouStatesExtractionResult,
  availableEdges: EdgeInfo[] = [],
  pouName: string = 'Statechart POU'
): PouComplexityReport {
  const { states } = extractedResult;
  const totalStates = Math.max(1, states.length);

  // 1. Index edges by source and target
  const outgoingEdgeMap = new Map<string, EdgeInfo[]>();
  const incomingEdgeMap = new Map<string, EdgeInfo[]>();

  availableEdges.forEach((edge) => {
    if (!outgoingEdgeMap.has(edge.from)) outgoingEdgeMap.set(edge.from, []);
    outgoingEdgeMap.get(edge.from)!.push(edge);

    if (!incomingEdgeMap.has(edge.to)) incomingEdgeMap.set(edge.to, []);
    incomingEdgeMap.get(edge.to)!.push(edge);
  });

  // Calculate total edges (either from availableEdges or extracted states)
  let totalTransitions = availableEdges.length;
  if (totalTransitions === 0) {
    let edgeSum = 0;
    states.forEach((s) => (edgeSum += s.outgoingTransitions.length));
    totalTransitions = edgeSum;
  }

  const avgOutgoing = Number((totalTransitions / totalStates).toFixed(2));
  const maxPossibleEdges = totalStates > 1 ? totalStates * (totalStates - 1) : 1;
  const densityCoefficient = Number((totalTransitions / maxPossibleEdges).toFixed(3));

  let maxOutgoingCount = 0;
  let maxIncomingCount = 0;
  let cumulativeCodeComplexity = 0;

  const counts = {
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
  };

  const densitySummary = {
    dispatcherHubs: 0,
    bottleneckHubs: 0,
    linearStates: 0,
    deadEnds: 0,
    unreachable: 0,
    errorSinks: 0,
  };

  const reportStates: StateComplexityReportItem[] = [];
  const allSuggestions: StateRefactorSuggestion[] = [];

  // 2. Process each state
  states.forEach((state) => {
    // Collect outgoing edges
    const directEdges = outgoingEdgeMap.get(state.id) || [];
    const outgoingList: StateTransitionItem[] = [];

    if (directEdges.length > 0) {
      directEdges.forEach((e) => {
        const cond = (e.condition || e.label || '').trim();
        const ops = countCompoundOperators(cond);
        outgoingList.push({
          to: e.to,
          toLabel: e.to,
          condition: cond || undefined,
          priority: e.priority,
          isCompound: ops > 0,
          isSelfLoop: e.to === state.id,
        });
      });
    } else {
      // Fallback to extracted state.outgoingTransitions
      state.outgoingTransitions.forEach((target) => {
        outgoingList.push({
          to: target,
          toLabel: target,
          condition: undefined,
          isCompound: false,
          isSelfLoop: target === state.id,
        });
      });
    }

    const outgoingCount = outgoingList.length;
    const incomingCount = state.incomingTransitions.length;

    if (outgoingCount > maxOutgoingCount) maxOutgoingCount = outgoingCount;
    if (incomingCount > maxIncomingCount) maxIncomingCount = incomingCount;

    // Density calculations
    const totalTransitionsForState = outgoingCount + incomingCount;
    const densityRatio = totalStates > 1 ? Number((outgoingCount / (totalStates - 1)).toFixed(2)) : 0;
    const relativeDensity = avgOutgoing > 0 ? Number((outgoingCount / avgOutgoing).toFixed(2)) : 1;

    // Classify state role
    let classification: StateClassification = 'linear';
    let classificationLabel = 'Linear State';
    let classificationDescription = 'Standard sequential transition step.';
    let isHub = false;

    if (state.isErrorSink) {
      classification = 'error_sink';
      classificationLabel = 'Fault / Error Sink';
      classificationDescription = 'Absorbs fault conditions from multiple operational states.';
      densitySummary.errorSinks++;
    } else if (outgoingCount === 0 && !state.isErrorSink) {
      classification = 'dead_end';
      classificationLabel = 'Terminal / Dead-End';
      classificationDescription = 'No outgoing transitions defined. May cause state machine hang.';
      densitySummary.deadEnds++;
    } else if (incomingCount === 0 && !state.isInitial) {
      classification = 'unreachable';
      classificationLabel = 'Unreachable State';
      classificationDescription = 'No incoming transitions found. State code may be orphaned or dead.';
      densitySummary.unreachable++;
    } else if (outgoingCount >= 4 && incomingCount >= 4) {
      classification = 'router_hub';
      classificationLabel = 'Symmetrical Hub';
      classificationDescription = 'High fan-in and high fan-out router with heavy traffic coupling.';
      isHub = true;
      densitySummary.dispatcherHubs++;
    } else if (outgoingCount >= 4 || relativeDensity >= 2.0) {
      classification = 'dispatcher_hub';
      classificationLabel = 'Dispatcher Hub';
      classificationDescription = `High fan-out (${outgoingCount} outgoing branches). Acts as a dense coordinator.`;
      isHub = true;
      densitySummary.dispatcherHubs++;
    } else if (incomingCount >= 4) {
      classification = 'bottleneck_hub';
      classificationLabel = 'Fan-In Collector';
      classificationDescription = `High fan-in (${incomingCount} incoming transitions). Potential structural bottleneck.`;
      isHub = true;
      densitySummary.bottleneckHubs++;
    } else if (outgoingCount === 1 && incomingCount === 1) {
      classification = 'linear';
      classificationLabel = 'Linear Pipeline';
      classificationDescription = 'Deterministic 1-in 1-out sequence.';
      densitySummary.linearStates++;
    } else {
      classification = 'transient';
      classificationLabel = 'Branching Step';
      classificationDescription = 'Moderate multi-branch transition node.';
    }

    const densityInfo: StateTransitionDensity = {
      outgoingCount,
      incomingCount,
      totalTransitions: totalTransitionsForState,
      densityRatio,
      relativeDensity,
      classification,
      classificationLabel,
      classificationDescription,
      isHub,
    };

    // 3. Cyclomatic Complexity Calculation
    let guardedCount = 0;
    let compoundOpsCount = 0;
    let selfLoopsCount = 0;

    outgoingList.forEach((out) => {
      if (out.isSelfLoop) selfLoopsCount++;
      if (out.condition) {
        guardedCount++;
        const ops = countCompoundOperators(out.condition);
        if (ops > 0) compoundOpsCount += ops;
      }
    });

    let unconditionalBranches = 0;
    if (guardedCount > 0) {
      const extraUnconditional = outgoingCount - guardedCount;
      if (extraUnconditional > 1) {
        unconditionalBranches = extraUnconditional - 1;
      }
    } else if (outgoingCount > 1) {
      unconditionalBranches = outgoingCount - 1;
    }

    // Code decisions
    const stAnalysis = analyzeStructuredTextDecisions(state.code);

    const basePath = 1;
    const cyclomaticScore = Math.max(
      1,
      basePath + guardedCount + unconditionalBranches + compoundOpsCount + stAnalysis.decisions
    );

    cumulativeCodeComplexity += cyclomaticScore;

    // Severity level
    let level: ComplexityTier = 'low';
    let levelLabel = 'Low Complexity';
    let refactorPriority = 4;

    if (cyclomaticScore >= 9) {
      level = 'critical';
      levelLabel = 'Critical Complexity';
      refactorPriority = 1;
      counts.critical++;
    } else if (cyclomaticScore >= 6) {
      level = 'high';
      levelLabel = 'High Complexity';
      refactorPriority = 2;
      counts.high++;
    } else if (cyclomaticScore >= 3) {
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

    // Formula explanation text
    const parts: string[] = ['1 (base)'];
    if (guardedCount > 0) parts.push(`${guardedCount} (guards)`);
    if (unconditionalBranches > 0) parts.push(`${unconditionalBranches} (branch)`);
    if (compoundOpsCount > 0) parts.push(`${compoundOpsCount} (compound)`);
    if (stAnalysis.decisions > 0) parts.push(`${stAnalysis.decisions} (ST logic)`);
    const formulaText = `${parts.join(' + ')} = ${cyclomaticScore}`;

    const complexityInfo: StateCyclomaticBreakdown = {
      score: cyclomaticScore,
      basePath,
      guardedBranches: guardedCount,
      unconditionalBranches,
      compoundOperators: compoundOpsCount,
      internalDecisions: stAnalysis.decisions,
      compoundInCode: stAnalysis.compoundInCode,
      selfLoops: selfLoopsCount,
      level,
      levelLabel,
      formulaText,
    };

    // 4. Generate Specific Refactoring Suggestions for this state
    const stateSuggestions: StateRefactorSuggestion[] = [];

    // Density-based suggestions:
    if (outgoingCount >= 4) {
      stateSuggestions.push({
        id: `density-${state.id}`,
        stateId: state.id,
        stateLabel: state.label,
        category: 'density',
        categoryLabel: 'Transition Density',
        severity: outgoingCount >= 6 ? 'critical' : 'warning',
        title: `High Fan-Out Density (${outgoingCount} outgoing transitions)`,
        diagnosis: `State ${state.label} exhibits excessive transition fan-out (${outgoingCount} targets, ${relativeDensity}× POU average). It acts as a dense monolithic dispatcher.`,
        recommendation: `Decompose into hierarchical composite sub-states (sub-state machine) or sequential sub-phases to reduce branching entropy.`,
        impact: `Reduces state fan-out by up to 60%, isolating transition guards and making scan-cycle timing predictable.`,
        suggestedAction: `Split into composite sub-states or child function blocks.`,
      });
    }

    if (incomingCount >= 5 && !state.isErrorSink && !state.isInitial) {
      stateSuggestions.push({
        id: `bottleneck-${state.id}`,
        stateId: state.id,
        stateLabel: state.label,
        category: 'supervisor',
        categoryLabel: 'Supervisor Refactoring',
        severity: 'warning',
        title: `Fan-In Bottleneck (${incomingCount} incoming transitions)`,
        diagnosis: `${incomingCount} different states transition into ${state.label}. This creates tight coupling across the statechart.`,
        recommendation: `Consider centralizing common transition triggers into the supervisor preProcess() method or a global reset handler.`,
        impact: `Removes duplicated transition guards across ${incomingCount} states and streamlines the diagram.`,
        suggestedAction: `Move common transitions to preProcess().`,
      });
    }

    // Cyclomatic logic suggestions:
    if (stAnalysis.decisions >= 5) {
      stateSuggestions.push({
        id: `logic-${state.id}`,
        stateId: state.id,
        stateLabel: state.label,
        category: 'cyclomatic',
        categoryLabel: 'Procedural Complexity',
        severity: stAnalysis.decisions >= 8 ? 'critical' : 'warning',
        title: `Heavy Procedural Logic in State Body (${stAnalysis.decisions} decisions, ${stAnalysis.loc} LOC)`,
        diagnosis: `The CASE branch for ${state.label} contains ${stAnalysis.decisions} decision constructs (${stAnalysis.loc} lines of Structured Text).`,
        recommendation: `Extract execution payload into dedicated IEC 61131-3 Action (A_${state.id}) or Method (M_${state.id}). Keep the CASE branch purely for transition dispatching.`,
        impact: `Decouples execution logic from state dispatching, enabling isolated unit testing with TcUnit.`,
        suggestedAction: `Extract logic into Action/Method.`,
      });
    }

    if (compoundOpsCount >= 2) {
      stateSuggestions.push({
        id: `guard-${state.id}`,
        stateId: state.id,
        stateLabel: state.label,
        category: 'guard',
        categoryLabel: 'Compound Guard Simplification',
        severity: 'info',
        title: `Multi-Variable Compound Guard Conditions`,
        diagnosis: `Transition guards use ${compoundOpsCount} compound boolean operators (AND/OR). Complex boolean expressions increase verification effort.`,
        recommendation: `Consolidate compound boolean conditions into a descriptive boolean property or flag (e.g. bReadyToExecute) evaluated prior to the CASE statement.`,
        impact: `Simplifies transition condition truth tables and speeds up troubleshooting in TwinCAT online watch.`,
        suggestedAction: `Consolidate guard expressions into boolean flags.`,
      });
    }

    // Safety suggestions:
    if (outgoingCount === 0 && !state.isErrorSink) {
      stateSuggestions.push({
        id: `deadend-${state.id}`,
        stateId: state.id,
        stateLabel: state.label,
        category: 'safety',
        categoryLabel: 'Safety & Liveness',
        severity: 'critical',
        title: `Potential Terminal Dead-End State`,
        diagnosis: `State ${state.label} has no outgoing transitions defined. Once entered, the machine cannot transition out through normal CASE flow.`,
        recommendation: `Verify if this state represents an intentional halt/completion state. If not, add exit transitions or a watchdog timeout trigger.`,
        impact: `Prevents machine halt or unrecoverable lockups in automatic production mode.`,
        suggestedAction: `Add exit guard or watchdog timeout transition.`,
      });
    }

    if (incomingCount === 0 && !state.isInitial) {
      stateSuggestions.push({
        id: `unreachable-${state.id}`,
        stateId: state.id,
        stateLabel: state.label,
        category: 'safety',
        categoryLabel: 'Safety & Liveness',
        severity: 'warning',
        title: `Unreachable State (0 incoming transitions)`,
        diagnosis: `No state can transition into ${state.label}. It represents potential dead code or missing state enum assignments.`,
        recommendation: `Verify if this state is triggered externally or if a transition from another state was omitted. Clean up unused states to reduce cognitive load.`,
        impact: `Removes dead code, reduces enum clutter, and clarifies machine operational cycle.`,
        suggestedAction: `Connect missing transition or prune dead state.`,
      });
    }

    if (selfLoopsCount > 0) {
      stateSuggestions.push({
        id: `selfloop-${state.id}`,
        stateId: state.id,
        stateLabel: state.label,
        category: 'safety',
        categoryLabel: 'Safety & Liveness',
        severity: 'info',
        title: `Self-Loop Transition Active`,
        diagnosis: `State ${state.label} has a self-loop transition back to itself.`,
        recommendation: `Ensure an execution watchdog timer (TON) or counter prevents indefinite cyclic re-entry under persistent conditions.`,
        impact: `Prevents silent spin-loops and ensures timely cycle timeout detection.`,
        suggestedAction: `Verify TON timer guard on self-transition.`,
      });
    }

    const refactorNeeded = stateSuggestions.some((s) => s.severity === 'critical' || s.severity === 'warning');

    allSuggestions.push(...stateSuggestions);

    reportStates.push({
      id: state.id,
      label: state.label,
      description: state.description,
      group: state.compositeGroup,
      isInitial: !!state.isInitial,
      isErrorSink: !!state.isErrorSink,
      hasCaseBranch: state.hasCaseBranch,
      linesOfCode: state.lineCount || stAnalysis.loc,
      code: state.code,
      outgoingTransitions: outgoingList,
      incomingTransitions: state.incomingTransitions,
      density: densityInfo,
      complexity: complexityInfo,
      suggestions: stateSuggestions,
      refactorNeeded,
      refactorPriority: refactorNeeded ? refactorPriority : 4,
    });
  });

  // 5. Global Metrics & Aggregations
  // Sort states by cyclomatic complexity descending
  reportStates.sort((a, b) => b.complexity.score - a.complexity.score);

  const avgComplexity = Number((cumulativeCodeComplexity / totalStates).toFixed(1));
  const maxComplexity = reportStates.length > 0 ? reportStates[0].complexity.score : 1;
  const highestComplexityState = reportStates.length > 0 ? reportStates[0] : undefined;

  // Global McCabe Graph Complexity: M = E - N + 2P (P=1 for single statechart component)
  const connectedComponents = 1;
  const globalGraphComplexity = Math.max(1, totalTransitions - totalStates + 2 * connectedComponents);

  // 6. Calculate POU Health Score (0 - 100)
  // Deductions based on critical/high states, dead ends, unreachable states, density outliers
  let healthScore = 100;
  healthScore -= counts.critical * 12;
  healthScore -= counts.high * 5;
  healthScore -= densitySummary.deadEnds * 15;
  healthScore -= densitySummary.unreachable * 8;
  if (densityCoefficient > 0.35 && totalStates > 5) {
    healthScore -= 10; // Overly dense mesh graph (spaghetti statechart)
  }
  if (avgComplexity > 5) {
    healthScore -= Math.min(20, Math.round((avgComplexity - 5) * 4));
  }
  healthScore = Math.max(10, Math.min(100, healthScore));

  let healthRating: HealthRating = 'excellent';
  if (healthScore < 50) healthRating = 'needs_refactor';
  else if (healthScore < 70) healthRating = 'moderate';
  else if (healthScore < 85) healthRating = 'good';

  // 7. Aggregate Top Refactoring Areas
  const refactorAreaMap = new Map<string, RefactoringAreaSummary>();

  allSuggestions.forEach((sugg) => {
    const key = `${sugg.category}-${sugg.title}`;
    if (!refactorAreaMap.has(key)) {
      refactorAreaMap.set(key, {
        id: key,
        title: sugg.title,
        category: sugg.category,
        categoryLabel: sugg.categoryLabel,
        severity: sugg.severity,
        description: sugg.diagnosis,
        recommendation: sugg.recommendation,
        impact: sugg.impact,
        affectedStates: [],
      });
    }
    const area = refactorAreaMap.get(key)!;
    if (!area.affectedStates.some((st) => st.id === sugg.stateId)) {
      area.affectedStates.push({
        id: sugg.stateId,
        label: sugg.stateLabel,
      });
    }
  });

  const topRefactorAreas = Array.from(refactorAreaMap.values()).sort((a, b) => {
    const sevWeight = { critical: 3, warning: 2, info: 1 };
    return (sevWeight[b.severity] * 10 + b.affectedStates.length) - (sevWeight[a.severity] * 10 + a.affectedStates.length);
  });

  return {
    pouName,
    totalStates,
    totalTransitions,
    globalGraphComplexity,
    cumulativeCodeComplexity,
    avgStateComplexity: avgComplexity,
    maxStateComplexity: maxComplexity,
    highestComplexityState,
    avgTransitionDensity: avgOutgoing,
    densityCoefficient,
    maxOutgoingCount,
    maxIncomingCount,
    healthScore,
    healthRating,
    counts,
    densitySummary,
    states: reportStates,
    allSuggestions,
    refactorCandidatesCount: reportStates.filter((s) => s.refactorNeeded).length,
    topRefactorAreas,
  };
}

/**
 * Generates an exportable Markdown report string
 */
export function generateMarkdownComplexityReport(report: PouComplexityReport): string {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  return `# POU Architecture & Complexity Analysis Report
**POU Name:** ${report.pouName}  
**Generated:** ${timestamp}  
**Architecture Health Score:** ${report.healthScore}/100 (${report.healthRating.toUpperCase().replace('_', ' ')})  

---

## 1. Executive Summary & Graph Metrics

| Metric | Value | Reference Standard / Interpretation |
| :--- | :--- | :--- |
| **Total Identified States** | ${report.totalStates} | Core machine lifecycle states |
| **Total Active Transitions** | ${report.totalTransitions} | Defined state-to-state edges |
| **Global McCabe Graph Complexity** | **M = ${report.globalGraphComplexity}** | $M = E - N + 2P$ (Control-flow paths) |
| **Average State Complexity** | **${report.avgStateComplexity}** | Recommended < 4.0 |
| **Max State Complexity** | **${report.maxStateComplexity}** (${report.highestComplexityState?.label || 'N/A'}) | Highest cognitive load hotspot |
| **Average Transition Density** | **${report.avgTransitionDensity}** transitions/state | Fan-out density factor |
| **Graph Density Coefficient** | **${(report.densityCoefficient * 100).toFixed(1)}%** | Ratio of active to possible transitions |
| **Refactoring Candidates** | **${report.refactorCandidatesCount} of ${report.totalStates} states** | Exceeds density or complexity threshold |

### Complexity Distribution
- **Critical (M ≥ 9):** ${report.counts.critical} state(s)
- **High (M = 6..8):** ${report.counts.high} state(s)
- **Moderate (M = 3..5):** ${report.counts.moderate} state(s)
- **Low (M ≤ 2):** ${report.counts.low} state(s)

---

## 2. Transition Density & Structural Hotspots

- **Dispatcher Hubs (High Fan-Out ≥ 4):** ${report.densitySummary.dispatcherHubs}
- **Fan-In Collectors / Bottlenecks (≥ 4 in):** ${report.densitySummary.bottleneckHubs}
- **Linear Sequences (1-in, 1-out):** ${report.densitySummary.linearStates}
- **Potential Dead-Ends (0 out):** ${report.densitySummary.deadEnds}
- **Unreachable States (0 in):** ${report.densitySummary.unreachable}
- **Error / Fault Sinks:** ${report.densitySummary.errorSinks}

---

## 3. High-Priority Refactoring Recommendations

${
  report.topRefactorAreas.length === 0
    ? '_No urgent refactoring areas identified. State machine exhibits clean, deterministic architecture._'
    : report.topRefactorAreas
        .map(
          (area, idx) => `### ${idx + 1}. [${area.severity.toUpperCase()}] ${area.title}
- **Category:** ${area.categoryLabel}
- **Affected States:** ${area.affectedStates.map((s) => `\`${s.label}\``).join(', ')}
- **Diagnosis:** ${area.description}
- **TwinCAT Architectural Recommendation:** ${area.recommendation}
- **Estimated Impact:** ${area.impact}
`
        )
        .join('\n')
}

---

## 4. State-by-State Complexity & Density Breakdown

| State Name | Cyclomatic CC (M) | Outgoing (Fan-Out) | Incoming (Fan-In) | Role / Classification | Refactor Status |
| :--- | :---: | :---: | :---: | :--- | :--- |
${report.states
  .map(
    (s) =>
      `| \`${s.label}\` | **${s.complexity.score}** (${s.complexity.level.toUpperCase()}) | ${s.density.outgoingCount} | ${s.density.incomingCount} | ${s.density.classificationLabel} | ${s.refactorNeeded ? '⚠️ Refactor Suggested' : '✅ Optimal'} |`
  )
  .join('\n')}

---

*Report generated by TwinCAT Statechart Visualizer & POU Analyzer.*
`;
}
