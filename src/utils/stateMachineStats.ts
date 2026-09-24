/**
 * Real-time analysis utility for Beckhoff TwinCAT state machines.
 * Computes graph metrics, cyclomatic complexity (McCabe M = E - V + 2P),
 * entry/exit action inventory, and structural health ratings.
 */

import { EdgeInfo, StateNodeInfo } from '../types.ts';

export interface EntryExitActionItem {
  stateId: string;
  actionType: 'entry' | 'exit';
  name: string;
  source: 'method' | 'action' | 'inline_st' | 'uml_attribute';
  description?: string;
  lineSnippet?: string;
}

export interface GuardTransitionRef {
  id: string;
  from: string;
  to: string;
  priority?: number;
  label?: string;
}

export interface GuardConditionFrequency {
  condition: string;
  normalizedKey: string;
  count: number;
  percentage: number; // Percentage of all guarded transitions (0 - 100)
  transitions: GuardTransitionRef[];
  sources: string[]; // Unique origin state IDs
  targets: string[]; // Unique destination state IDs
  isCompound: boolean; // Contains boolean operators (AND, OR, NOT, etc.)
  insight: string; // Engineering insight into logic role
  category: 'safety' | 'progress' | 'fault' | 'command' | 'timer' | 'general';
}

export interface StateMachineStatistics {
  // States Metrics
  totalStates: number;
  initialState?: string;
  sinkStates: string[]; // out-degree = 0
  sourceStates: string[]; // in-degree = 0

  // Transitions Metrics
  totalTransitions: number;
  guardedTransitionsCount: number;
  unconditionalTransitionsCount: number;
  selfLoopsCount: number;
  preProcessTransitionsCount: number;
  priorityBreakdown: {
    priority1: number;
    priority2: number;
    priority3Plus: number;
    unassigned: number;
  };

  // Top Guard Conditions
  topGuardConditions: GuardConditionFrequency[];
  totalGuardsExtracted: number;
  uniqueGuardsCount: number;

  // Entry / Exit Actions Metrics
  entryActionsCount: number;
  exitActionsCount: number;
  entryActions: EntryExitActionItem[];
  exitActions: EntryExitActionItem[];

  // Cyclomatic Analysis Metrics
  cyclomaticScore: number; // McCabe M = E - V + 2P
  extendedCyclomaticScore: number; // M + compound condition operators (AND, OR)
  cyclomaticRating: 'low' | 'moderate' | 'high' | 'critical';
  cyclomaticRatingLabel: string;
  cyclomaticRatingColor: string;
  cyclomaticDetails: {
    vertices: number; // V
    edges: number; // E
    connectedComponents: number; // P
    compoundConditionOperators: number; // AND/OR
    averageBranchingFactor: number; // E / V
    maxOutDegree: number;
    maxBranchingStates: Array<{ stateId: string; outDegree: number }>;
  };

  // State Machine Architecture Health (0 - 100)
  healthScore: number;
  healthObservations: string[];
}

/**
 * Calculates connected components count (P) using BFS on the undirected representation of the graph.
 */
function calculateConnectedComponents(
  states: string[],
  transitions: Array<{ from: string; to: string }>
): number {
  if (states.length === 0) return 0;

  const adj = new Map<string, Set<string>>();
  states.forEach((s) => adj.set(s, new Set()));

  transitions.forEach((t) => {
    if (!adj.has(t.from)) adj.set(t.from, new Set());
    if (!adj.has(t.to)) adj.set(t.to, new Set());
    adj.get(t.from)!.add(t.to);
    adj.get(t.to)!.add(t.from);
  });

  const visited = new Set<string>();
  let components = 0;

  for (const state of states) {
    if (!visited.has(state)) {
      components++;
      const queue = [state];
      visited.add(state);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const neighbors = adj.get(curr);
        if (neighbors) {
          neighbors.forEach((nbr) => {
            if (!visited.has(nbr)) {
              visited.add(nbr);
              queue.push(nbr);
            }
          });
        }
      }
    }
  }

  return Math.max(1, components);
}

/**
 * Extracts and classifies all Entry and Exit actions defined across the TwinCAT POU
 * (POU actions, state methods, inline ST entry/exit blocks, and UML statechart tags).
 */
export function extractEntryExitActions(
  tcPouContent?: string,
  availableStates?: StateNodeInfo[]
): {
  entryActions: EntryExitActionItem[];
  exitActions: EntryExitActionItem[];
} {
  const entryActions: EntryExitActionItem[] = [];
  const exitActions: EntryExitActionItem[] = [];

  if (!tcPouContent || !tcPouContent.trim()) {
    return { entryActions, exitActions };
  }

  const knownStateIds = new Set(
    (availableStates || []).map((s) => s.id.toUpperCase())
  );

  // Helper to match a state ID from text
  const matchStateId = (text: string): string => {
    const upper = text.toUpperCase();
    for (const sid of knownStateIds) {
      if (upper.includes(sid)) return sid;
    }
    return availableStates && availableStates.length > 0 ? availableStates[0].id : 'GLOBAL';
  };

  // 1. Scan for POU <Action Name="..."> tags
  const actionRegex = /<Action[^>]*\bName=["']([^"']+)["'][^>]*>([\s\S]*?)<\/Action>/gi;
  let actMatch: RegExpExecArray | null;
  while ((actMatch = actionRegex.exec(tcPouContent)) !== null) {
    const actName = actMatch[1].trim();
    const actLower = actName.toLowerCase();

    if (/entry|enter|onentry|init/i.test(actLower)) {
      entryActions.push({
        stateId: matchStateId(actName),
        actionType: 'entry',
        name: actName,
        source: 'action',
        description: `Dedicated POU Action: ${actName}`,
      });
    } else if (/exit|leave|onexit|cleanup/i.test(actLower)) {
      exitActions.push({
        stateId: matchStateId(actName),
        actionType: 'exit',
        name: actName,
        source: 'action',
        description: `Dedicated POU Action: ${actName}`,
      });
    }
  }

  // 2. Scan for dedicated entry/exit Methods <Method Name="...">
  const methodRegex = /<Method[^>]*\bName=["']([^"']+)["'][^>]*>([\s\S]*?)<\/Method>/gi;
  let mMatch: RegExpExecArray | null;
  while ((mMatch = methodRegex.exec(tcPouContent)) !== null) {
    const methodName = mMatch[1].trim();
    const methodLower = methodName.toLowerCase();

    if (methodLower === 'dostate' || methodLower === 'preprocess' || methodLower === 'getstatedescription') {
      continue;
    }

    if (/^(entry|enter|onentry|initstate|stateentry)/i.test(methodLower)) {
      entryActions.push({
        stateId: matchStateId(methodName),
        actionType: 'entry',
        name: `${methodName}()`,
        source: 'method',
        description: `State Entry Method: ${methodName}()`,
      });
    } else if (/^(exit|leave|onexit|cleanstate|stateexit)/i.test(methodLower)) {
      exitActions.push({
        stateId: matchStateId(methodName),
        actionType: 'exit',
        name: `${methodName}()`,
        source: 'method',
        description: `State Exit Method: ${methodName}()`,
      });
    }
  }

  // 3. Scan inside doState() ST logic for inline entry/exit blocks:
  // e.g.: IF bEntry THEN ... / IF stateChanged THEN ... / IF isFirstScan THEN ...
  // or calling onEntry() / onExit()
  const doStateMatch = tcPouContent.match(/<Method[^>]*\bName=["']doState["'][^>]*>([\s\S]*?)<\/Method>/i);
  if (doStateMatch) {
    const doStateSt = doStateMatch[1];

    // Split doState by CASE branches
    const caseBranchRegex = /([A-Za-z0-9_]+)\s*:\s*\n([\s\S]*?)(?=(?:[A-Za-z0-9_]+\s*:\s*\n|END_CASE))/gi;
    let branchMatch: RegExpExecArray | null;

    while ((branchMatch = caseBranchRegex.exec(doStateSt)) !== null) {
      const stateLabel = branchMatch[1].trim();
      const branchCode = branchMatch[2];

      // Check entry pattern in branch code
      const entryPattern = /\bIF\s+(?:bEntry|bStateEntry|isEntry|isFirstScan|stateChanged|bFirstScan|bInitStep|bEntryAction)\b[^\n]*/i;
      const entryMatch = branchCode.match(entryPattern);
      if (entryMatch) {
        entryActions.push({
          stateId: stateLabel,
          actionType: 'entry',
          name: entryMatch[0].trim(),
          source: 'inline_st',
          description: `Inline Entry Guard in ${stateLabel}`,
          lineSnippet: entryMatch[0].trim(),
        });
      }

      // Check method/action entry calls: e.g. entry(); or A_Entry();
      const entryCallPattern = /\b(entry|onEntry|enter|initStep|A_Entry_[A-Za-z0-9_]+|A_Entry)\s*\(/i;
      const entryCallMatch = branchCode.match(entryCallPattern);
      if (entryCallMatch && !entryMatch) {
        entryActions.push({
          stateId: stateLabel,
          actionType: 'entry',
          name: `${entryCallMatch[1]}()`,
          source: 'inline_st',
          description: `Entry action called in ${stateLabel}`,
        });
      }

      // Check exit pattern in branch code
      const exitPattern = /\bIF\s+(?:bExit|bStateExit|isExit|bLeaveState|bExitAction)\b[^\n]*/i;
      const exitMatch = branchCode.match(exitPattern);
      if (exitMatch) {
        exitActions.push({
          stateId: stateLabel,
          actionType: 'exit',
          name: exitMatch[0].trim(),
          source: 'inline_st',
          description: `Inline Exit Guard in ${stateLabel}`,
          lineSnippet: exitMatch[0].trim(),
        });
      }

      // Check method/action exit calls: e.g. exit(); or cleanup(); or A_Exit();
      const exitCallPattern = /\b(exit|onExit|leave|cleanup|A_Exit_[A-Za-z0-9_]+|A_Exit)\s*\(/i;
      const exitCallMatch = branchCode.match(exitCallPattern);
      if (exitCallMatch && !exitMatch) {
        exitActions.push({
          stateId: stateLabel,
          actionType: 'exit',
          name: `${exitCallMatch[1]}()`,
          source: 'inline_st',
          description: `Exit action called in ${stateLabel}`,
        });
      }
    }
  }

  // 4. Scan for UML Statechart XML attributes (<EntryAction> / <ExitAction>)
  const umlEntryMatches = tcPouContent.match(/<EntryAction[^>]*>([\s\S]*?)<\/EntryAction>/gi) || [];
  umlEntryMatches.forEach((umlEntry, idx) => {
    const text = umlEntry.replace(/<[^>]+>/g, '').trim();
    if (text) {
      entryActions.push({
        stateId: matchStateId(text),
        actionType: 'entry',
        name: text.length > 30 ? `${text.substring(0, 30)}...` : text,
        source: 'uml_attribute',
        description: `UML Statechart Entry Action #${idx + 1}`,
      });
    }
  });

  const umlExitMatches = tcPouContent.match(/<ExitAction[^>]*>([\s\S]*?)<\/ExitAction>/gi) || [];
  umlExitMatches.forEach((umlExit, idx) => {
    const text = umlExit.replace(/<[^>]+>/g, '').trim();
    if (text) {
      exitActions.push({
        stateId: matchStateId(text),
        actionType: 'exit',
        name: text.length > 30 ? `${text.substring(0, 30)}...` : text,
        source: 'uml_attribute',
        description: `UML Statechart Exit Action #${idx + 1}`,
      });
    }
  });

  return { entryActions, exitActions };
}

/**
 * Cleans raw transition labels into a normalized guard condition string.
 * Strips priority markers (①, [1], (1), etc.), [preProcess] prefix, markdown notes, outer brackets/quotes.
 */
export function extractCleanGuardText(raw?: string): string {
  if (!raw) return '';
  let text = raw.trim();

  // Strip Markdown / note annotations
  text = text.replace(/(?:<br\s*\/?>\s*📝?.*|\[📝[^\]]*\])/, '').trim();

  // Strip circled priority numbers: ①..⑳ (0x2460-0x2473), ㉑..㉟ (0x3251-0x325F), ㊱..㊿ (0x32B1-0x32BF)
  text = text.replace(/[\u2460-\u2473\u3251-\u325F\u32B1-\u32BF]/g, '').trim();

  // Strip bracketed / parenthesized priority e.g. [priority: 1], [1], (1), {1}
  text = text.replace(/^\[(?:priority:\s*)?\d+\]\s*/i, '');
  text = text.replace(/^\(\d+\)\s*/, '');
  text = text.replace(/^\{\d+\}\s*/, '');

  // Strip [preProcess] supervisor marker
  text = text.replace(/^\[preProcess\]\s*/i, '');

  // Strip surrounding quotes
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }

  // Strip outer single square brackets if not compound brackets e.g. [bStart] -> bStart
  if (text.startsWith('[') && text.endsWith(']') && !text.slice(1, -1).includes('[')) {
    text = text.slice(1, -1).trim();
  }

  // Collapse consecutive whitespaces
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Validates whether a cleaned string represents an authentic guard condition
 * (filtering out ELSE, [*], empty strings, pure digits, etc.).
 */
export function isValidGuardCondition(cond: string): boolean {
  if (!cond) return false;
  const upper = cond.toUpperCase().trim();
  if (
    upper === 'ELSE' ||
    upper === '[*]' ||
    upper === '*' ||
    upper === 'DEFAULT' ||
    upper === 'NONE' ||
    upper === 'FALLBACK' ||
    upper === 'TRUE' ||
    upper === '1'
  ) {
    return false;
  }
  // Pure digit or digit in parens e.g. "1" or "(1)"
  if (/^[\(\[\{]?\d+[\)\]\}]?$/.test(cond)) return false;
  return true;
}

/**
 * Classifies a guard condition into an operational engineering category and provides
 * clear PLC domain insight on how it drives the state machine logic.
 */
export function classifyGuardCondition(
  condition: string,
  sourcesCount: number,
  isCompound: boolean
): {
  category: 'safety' | 'progress' | 'fault' | 'command' | 'timer' | 'general';
  insight: string;
} {
  const lower = condition.toLowerCase();

  if (/(safety|estop|e_stop|abort|interlock|guard|door|emergency|bemergency|bsafety)/i.test(lower)) {
    return {
      category: 'safety',
      insight:
        sourcesCount > 1
          ? `High-priority safety interlock active across ${sourcesCount} states`
          : 'Dedicated safety / abort interlock condition',
    };
  }

  if (/(error|fault|alarm|fail|timeout|bexception|btimeout|berror)/i.test(lower)) {
    return {
      category: 'fault',
      insight:
        sourcesCount > 1
          ? `Global fault detection trigger active across ${sourcesCount} states`
          : 'Fault recovery / anomaly monitoring condition',
    };
  }

  if (/(timer|ton|tof|tp|delay|elapsed|t#|dwell|wait|btimeout|\.q\b)/i.test(lower)) {
    return {
      category: 'timer',
      insight: 'Time-delay / dwell completion condition driving state sequencing',
    };
  }

  if (/(start|execute|trigger|resume|cmd|command|button|req|request|bstart|bexec)/i.test(lower)) {
    return {
      category: 'command',
      insight:
        sourcesCount > 1
          ? `Supervisory operator / host command routing across ${sourcesCount} states`
          : 'State initiation / trigger command',
    };
  }

  if (/(done|complete|inpos|ready|target|finished|bsuccess|bready|bdone)/i.test(lower)) {
    return {
      category: 'progress',
      insight: 'Subsystem readiness / motion completion handshake signal',
    };
  }

  if (sourcesCount >= 3) {
    return {
      category: 'general',
      insight: `Cross-cutting logic gate evaluated across ${sourcesCount} different states`,
    };
  }

  if (isCompound) {
    return {
      category: 'general',
      insight: 'Compound boolean decision predicate driving conditional transition',
    };
  }

  return {
    category: 'general',
    insight: 'Standard sequential transition guard condition',
  };
}

/**
 * Computes complete real-time statistics and cyclomatic complexity for the state machine.
 */
export function calculateStateMachineStats(
  availableStates: StateNodeInfo[],
  availableEdges: EdgeInfo[],
  tcPouContent?: string
): StateMachineStatistics {
  // 1. Normalize unique states list
  const stateIdSet = new Set<string>();
  const stateNodes: string[] = [];

  availableStates.forEach((s) => {
    if (s.id && !stateIdSet.has(s.id)) {
      stateIdSet.add(s.id);
      stateNodes.push(s.id);
    }
  });

  // Ensure any states appearing in transitions are also registered
  availableEdges.forEach((e) => {
    if (e.from && !stateIdSet.has(e.from)) {
      stateIdSet.add(e.from);
      stateNodes.push(e.from);
    }
    if (e.to && !stateIdSet.has(e.to)) {
      stateIdSet.add(e.to);
      stateNodes.push(e.to);
    }
  });

  const V = Math.max(1, stateNodes.length);
  const E = availableEdges.length;

  // 2. Compute Degree distributions (In-Degree & Out-Degree)
  const inDegreeMap = new Map<string, number>();
  const outDegreeMap = new Map<string, number>();

  stateNodes.forEach((s) => {
    inDegreeMap.set(s, 0);
    outDegreeMap.set(s, 0);
  });

  let guardedCount = 0;
  let unconditionalCount = 0;
  let selfLoops = 0;
  let preProcessCount = 0;
  let p1Count = 0;
  let p2Count = 0;
  let p3PlusCount = 0;
  let unassignedCount = 0;
  let compoundOperatorsCount = 0;

  // Track and aggregate Guard Conditions
  interface RawGuardBucket {
    condition: string;
    normalizedKey: string;
    transitions: GuardTransitionRef[];
    sources: Set<string>;
    targets: Set<string>;
  }

  const guardsMap = new Map<string, RawGuardBucket>();
  let totalGuardsExtracted = 0;

  availableEdges.forEach((e) => {
    const from = e.from;
    const to = e.to;

    // Track out/in degrees
    if (outDegreeMap.has(from)) {
      outDegreeMap.set(from, outDegreeMap.get(from)! + 1);
    }
    if (inDegreeMap.has(to)) {
      inDegreeMap.set(to, inDegreeMap.get(to)! + 1);
    }

    // Check self-loop
    if (from === to) {
      selfLoops++;
    }

    // Check guard condition presence
    const condition = (e.condition || e.label || '').trim();
    if (condition && condition !== 'ELSE' && condition !== '[preProcess]' && !condition.match(/^[\(\[\{]?\d+[\)\]\}]?$/)) {
      guardedCount++;
      // Count compound condition operators: AND, OR, &&, ||
      const ops = condition.match(/\b(AND|OR)\b|&&|\|\|/gi);
      if (ops) {
        compoundOperatorsCount += ops.length;
      }
    } else {
      unconditionalCount++;
    }

    // Extract, clean, and record guard condition
    const rawGuard = (e.condition || e.guard || e.label || '').trim();
    const cleanGuard = extractCleanGuardText(rawGuard);
    if (isValidGuardCondition(cleanGuard)) {
      totalGuardsExtracted++;
      const normKey = cleanGuard.toLowerCase();

      if (!guardsMap.has(normKey)) {
        guardsMap.set(normKey, {
          condition: cleanGuard,
          normalizedKey: normKey,
          transitions: [],
          sources: new Set(),
          targets: new Set(),
        });
      }

      const bucket = guardsMap.get(normKey)!;
      bucket.transitions.push({
        id: e.id || `${e.from}->${e.to}`,
        from: e.from,
        to: e.to,
        priority: e.priority,
        label: e.label,
      });
      if (e.from) bucket.sources.add(e.from);
      if (e.to) bucket.targets.add(e.to);
    }

    // Check preProcess supervisor source
    if (e.label?.includes('[preProcess]') || e.condition?.includes('preProcess')) {
      preProcessCount++;
    }

    // Priority breakdown
    if (e.priority === 1) p1Count++;
    else if (e.priority === 2) p2Count++;
    else if (e.priority && e.priority >= 3) p3PlusCount++;
    else unassignedCount++;
  });

  // Calculate Guard Condition frequencies, percentages, and insights
  const allGuardsList = Array.from(guardsMap.values()).map((bucket) => {
    const isCompound = Boolean(bucket.condition.match(/\b(AND|OR|NOT|XOR)\b|&&|\|\||!/i));
    const sourcesList = Array.from(bucket.sources);
    const targetsList = Array.from(bucket.targets);
    const { category, insight } = classifyGuardCondition(bucket.condition, sourcesList.length, isCompound);
    const count = bucket.transitions.length;
    const percentage = totalGuardsExtracted > 0 ? Math.round((count / totalGuardsExtracted) * 100) : 0;

    return {
      condition: bucket.condition,
      normalizedKey: bucket.normalizedKey,
      count,
      percentage,
      transitions: bucket.transitions,
      sources: sourcesList,
      targets: targetsList,
      isCompound,
      insight,
      category,
    } as GuardConditionFrequency;
  });

  // Sort by occurrence count descending, then condition name ascending
  allGuardsList.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.condition.localeCompare(b.condition);
  });

  const topGuardConditions = allGuardsList.slice(0, 5);
  const uniqueGuardsCount = allGuardsList.length;

  // Identify Sink States (out-degree = 0) and Source States (in-degree = 0)
  const sinkStates: string[] = [];
  const sourceStates: string[] = [];
  const maxBranchingStates: Array<{ stateId: string; outDegree: number }> = [];

  stateNodes.forEach((s) => {
    const outDeg = outDegreeMap.get(s) || 0;
    const inDeg = inDegreeMap.get(s) || 0;

    if (outDeg === 0) sinkStates.push(s);
    if (inDeg === 0) sourceStates.push(s);
    if (outDeg > 0) {
      maxBranchingStates.push({ stateId: s, outDegree: outDeg });
    }
  });

  maxBranchingStates.sort((a, b) => b.outDegree - a.outDegree);
  const maxOutDegree = maxBranchingStates.length > 0 ? maxBranchingStates[0].outDegree : 0;

  // 3. Compute Connected Components (P)
  const P = calculateConnectedComponents(stateNodes, availableEdges);

  // 4. Calculate McCabe Cyclomatic Complexity: M = E - V + 2P
  // In graph theory, for a directed graph with connected components P:
  // M = E - V + 2P
  const cyclomaticScore = Math.max(1, E - V + 2 * P);
  const extendedCyclomaticScore = cyclomaticScore + compoundOperatorsCount;

  // Rating classification
  let cyclomaticRating: 'low' | 'moderate' | 'high' | 'critical' = 'low';
  let cyclomaticRatingLabel = 'Low (Linear & Highly Testable)';
  let cyclomaticRatingColor = 'text-emerald-400';

  if (extendedCyclomaticScore > 40) {
    cyclomaticRating = 'critical';
    cyclomaticRatingLabel = 'Critical (Very High - Decompose to Sub-states)';
    cyclomaticRatingColor = 'text-rose-400';
  } else if (extendedCyclomaticScore > 20) {
    cyclomaticRating = 'high';
    cyclomaticRatingLabel = 'High (Extensive Branching - Rigorous Verification Needed)';
    cyclomaticRatingColor = 'text-amber-400';
  } else if (extendedCyclomaticScore > 10) {
    cyclomaticRating = 'moderate';
    cyclomaticRatingLabel = 'Moderate (Well-Structured Branching)';
    cyclomaticRatingColor = 'text-sky-400';
  }

  // 5. Extract Entry and Exit Actions
  const { entryActions, exitActions } = extractEntryExitActions(tcPouContent, availableStates);

  // 6. Compute State Machine Architecture Health Score (0 to 100)
  const observations: string[] = [];
  let healthScore = 100;

  // Health deductions / bonuses:
  if (extendedCyclomaticScore > 50) {
    healthScore -= 20;
    observations.push('High cyclomatic score (>50): consider decomposing complex states into subgraphs.');
  } else if (extendedCyclomaticScore > 30) {
    healthScore -= 10;
    observations.push('Elevated branching paths: ensure each branch has dedicated unit test coverage.');
  }

  if (sourceStates.length > 1) {
    healthScore -= Math.min(15, (sourceStates.length - 1) * 5);
    observations.push(`Multiple source states detected (${sourceStates.length}): verify machine start determinism.`);
  }

  if (sinkStates.length > 3) {
    healthScore -= 5;
    observations.push(`${sinkStates.length} sink states (terminal/dead-end): confirm all intended error states.`);
  }

  if (entryActions.length > 0 || exitActions.length > 0) {
    healthScore = Math.min(100, healthScore + 5);
    observations.push(`${entryActions.length} entry and ${exitActions.length} exit action(s) properly isolated.`);
  }

  if (p1Count > 0) {
    observations.push(`${p1Count} explicit Priority-1 safety/abort transition(s) prioritized.`);
  }

  if (topGuardConditions.length > 0) {
    const top1 = topGuardConditions[0];
    if (top1.count > 1) {
      observations.push(
        `Top guard condition "${top1.condition}" drives ${top1.count} transitions (${top1.percentage}% of guarded branches).`
      );
    }
  }

  const averageBranchingFactor = V > 0 ? parseFloat((E / V).toFixed(2)) : 0;

  return {
    totalStates: V,
    initialState: sourceStates[0] || (stateNodes.length > 0 ? stateNodes[0] : undefined),
    sinkStates,
    sourceStates,
    totalTransitions: E,
    guardedTransitionsCount: guardedCount,
    unconditionalTransitionsCount: unconditionalCount,
    selfLoopsCount: selfLoops,
    preProcessTransitionsCount: preProcessCount,
    priorityBreakdown: {
      priority1: p1Count,
      priority2: p2Count,
      priority3Plus: p3PlusCount,
      unassigned: unassignedCount,
    },
    topGuardConditions,
    totalGuardsExtracted,
    uniqueGuardsCount,
    entryActionsCount: entryActions.length,
    exitActionsCount: exitActions.length,
    entryActions,
    exitActions,
    cyclomaticScore,
    extendedCyclomaticScore,
    cyclomaticRating,
    cyclomaticRatingLabel,
    cyclomaticRatingColor,
    cyclomaticDetails: {
      vertices: V,
      edges: E,
      connectedComponents: P,
      compoundConditionOperators: compoundOperatorsCount,
      averageBranchingFactor,
      maxOutDegree,
      maxBranchingStates: maxBranchingStates.slice(0, 5),
    },
    healthScore: Math.max(20, Math.min(100, healthScore)),
    healthObservations: observations,
  };
}
