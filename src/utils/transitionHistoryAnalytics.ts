import { IdentifiedPouState } from './pouStateExtractor.ts';
import { EdgeInfo } from '../types.ts';
import { cleanNodeId } from './nodeDragger.ts';

export type AnomalySeverity = 'critical' | 'warning' | 'notice';

export type TransitionAnomalyType =
  | 'ILLEGAL_TRANSITION'
  | 'CHATTER_BOUNCE'
  | 'DWELL_TIMEOUT'
  | 'ABRUPT_FAULT'
  | 'SKIPPED_SEQUENCE';

export interface TransitionAnomaly {
  type: TransitionAnomalyType;
  severity: AnomalySeverity;
  title: string;
  description: string;
  details?: string;
  expectedContext?: string;
  detectedValue?: string;
}

export interface ChronologicalTransitionEvent {
  id: string;
  index: number; // 1-based chronological index
  timestamp: number; // Epoch ms
  isoTime: string;
  formattedTime: string; // "14:23:05.120" or "+00:04.250s"
  relativeSec: number; // Elapsed seconds from start of log
  fromState: string;
  toState: string;
  dwellMs: number; // Duration spent in fromState before this transition
  cycleNumber?: number;
  guardFired?: string;
  isUnexpected: boolean;
  anomalies: TransitionAnomaly[];
  rawLogLine?: string;
}

export interface StateTimeInterval {
  id: string;
  stateId: string;
  startSec: number;
  endSec: number;
  durationMs: number;
  eventIndex: number; // Event that ended this interval
  isUnexpectedExit: boolean;
  cycleNumber?: number;
  anomalies?: TransitionAnomaly[];
}

export interface TransitionHistoryDataset {
  name: string;
  source: 'preset' | 'file' | 'pasted';
  events: ChronologicalTransitionEvent[];
  intervals: StateTimeInterval[];
  startTime: number;
  endTime: number;
  totalDurationSec: number;
  uniqueStates: string[];
  unexpectedCount: number;
  expectedCount: number;
  complianceRate: number; // 0 - 100%
  anomalyCounts: Record<TransitionAnomalyType, number>;
  stateDwellStats: Record<
    string,
    {
      avgDwellMs: number;
      minDwellMs: number;
      maxDwellMs: number;
      count: number;
    }
  >;
}

/**
 * Normalizes state ID by stripping prefixes/quotes for robust matching.
 */
export function normalizeStateId(id: string): string {
  if (!id) return '';
  return cleanNodeId(id).replace(/^[A-Za-z0-9_]+::/, '').replace(/^["']|["']$/g, '').trim();
}

/**
 * Checks whether a transition exists in the given POU statechart edges.
 */
export function isTransitionInModel(
  fromState: string,
  toState: string,
  edges: EdgeInfo[],
  states: IdentifiedPouState[]
): boolean {
  if (edges.length === 0) return true; // If no edges parsed, avoid false positives

  const normFrom = normalizeStateId(fromState).toLowerCase();
  const normTo = normalizeStateId(toState).toLowerCase();

  // Also check against state labels
  const fromStateObj = states.find(
    (s) => s.id.toLowerCase() === normFrom || s.label.toLowerCase() === normFrom
  );
  const toStateObj = states.find(
    (s) => s.id.toLowerCase() === normTo || s.label.toLowerCase() === normTo
  );

  const candidateFroms = new Set<string>([normFrom]);
  if (fromStateObj) {
    candidateFroms.add(fromStateObj.id.toLowerCase());
    candidateFroms.add(fromStateObj.label.toLowerCase());
  }

  const candidateTos = new Set<string>([normTo]);
  if (toStateObj) {
    candidateTos.add(toStateObj.id.toLowerCase());
    candidateTos.add(toStateObj.label.toLowerCase());
  }

  return edges.some((edge) => {
    const eFrom = normalizeStateId(edge.from).toLowerCase();
    const eTo = normalizeStateId(edge.to).toLowerCase();
    return candidateFroms.has(eFrom) && candidateTos.has(eTo);
  });
}

/**
 * Gets valid destination states from the statechart model for a given source state.
 */
export function getLegalDestinations(
  fromState: string,
  edges: EdgeInfo[],
  states: IdentifiedPouState[]
): string[] {
  const normFrom = normalizeStateId(fromState).toLowerCase();
  const destinations = new Set<string>();

  edges.forEach((edge) => {
    const eFrom = normalizeStateId(edge.from).toLowerCase();
    if (eFrom === normFrom) {
      destinations.add(edge.to);
    }
  });

  return Array.from(destinations);
}

/**
 * Computes dwell statistics across all events for each state.
 */
export function computeStateDwellStats(
  rawEvents: { fromState: string; dwellMs: number }[]
): Record<string, { avgDwellMs: number; minDwellMs: number; maxDwellMs: number; count: number }> {
  const map: Record<string, number[]> = {};

  rawEvents.forEach((ev) => {
    if (!map[ev.fromState]) map[ev.fromState] = [];
    map[ev.fromState].push(ev.dwellMs);
  });

  const result: Record<string, { avgDwellMs: number; minDwellMs: number; maxDwellMs: number; count: number }> = {};
  Object.keys(map).forEach((st) => {
    const list = map[st];
    const sum = list.reduce((a, b) => a + b, 0);
    result[st] = {
      count: list.length,
      avgDwellMs: Math.round(sum / list.length),
      minDwellMs: Math.min(...list),
      maxDwellMs: Math.max(...list),
    };
  });

  return result;
}

/**
 * Analyzes chronological transition events against POU state machine structure
 * and flags unexpected state changes (illegal transitions, chatter, timeouts, abrupt faults).
 */
export function analyzeChronologicalEvents(
  rawEvents: {
    timestamp: number;
    fromState: string;
    toState: string;
    dwellMs?: number;
    cycleNumber?: number;
    guardFired?: string;
    rawLogLine?: string;
  }[],
  states: IdentifiedPouState[],
  edges: EdgeInfo[],
  datasetName: string = 'PLC Transition History',
  source: 'preset' | 'file' | 'pasted' = 'preset'
): TransitionHistoryDataset {
  if (rawEvents.length === 0) {
    return {
      name: datasetName,
      source,
      events: [],
      intervals: [],
      startTime: Date.now(),
      endTime: Date.now(),
      totalDurationSec: 0,
      uniqueStates: states.map((s) => s.id),
      unexpectedCount: 0,
      expectedCount: 0,
      complianceRate: 100,
      anomalyCounts: {
        ILLEGAL_TRANSITION: 0,
        CHATTER_BOUNCE: 0,
        DWELL_TIMEOUT: 0,
        ABRUPT_FAULT: 0,
        SKIPPED_SEQUENCE: 0,
      },
      stateDwellStats: {},
    };
  }

  // Sort raw events chronologically
  const sortedRaw = [...rawEvents].sort((a, b) => a.timestamp - b.timestamp);
  const startTime = sortedRaw[0].timestamp;
  const lastEvent = sortedRaw[sortedRaw.length - 1];
  const endTime = lastEvent.timestamp;
  const totalDurationSec = Math.max(0.1, (endTime - startTime) / 1000);

  // Compute baseline dwell stats for each state to detect statistical dwell outliers
  const baselineDwells = computeStateDwellStats(
    sortedRaw.map((e) => ({ fromState: e.fromState, dwellMs: e.dwellMs || 150 }))
  );

  const anomalyCounts: Record<TransitionAnomalyType, number> = {
    ILLEGAL_TRANSITION: 0,
    CHATTER_BOUNCE: 0,
    DWELL_TIMEOUT: 0,
    ABRUPT_FAULT: 0,
    SKIPPED_SEQUENCE: 0,
  };

  const processedEvents: ChronologicalTransitionEvent[] = [];
  const intervals: StateTimeInterval[] = [];
  const uniqueStatesSet = new Set<string>();

  // Register known states first to keep canonical ordering
  states.forEach((s) => uniqueStatesSet.add(s.id));

  let prevEvent: ChronologicalTransitionEvent | null = null;
  let intervalStartSec = 0;

  sortedRaw.forEach((raw, idx) => {
    uniqueStatesSet.add(raw.fromState);
    uniqueStatesSet.add(raw.toState);

    const relativeSec = Number(((raw.timestamp - startTime) / 1000).toFixed(3));
    const dwellMs = raw.dwellMs !== undefined && raw.dwellMs > 0 ? raw.dwellMs : 150;
    const anomalies: TransitionAnomaly[] = [];

    // 1. ILLEGAL / UNMODELED TRANSITION CHECK
    // Does this transition exist in the POU statechart?
    const inModel = isTransitionInModel(raw.fromState, raw.toState, edges, states);
    if (!inModel) {
      const legalDestinations = getLegalDestinations(raw.fromState, edges, states);
      const destText =
        legalDestinations.length > 0
          ? `Allowed destinations: [${legalDestinations.join(', ')}]`
          : 'State has no defined outgoing transitions in POU.';

      anomalies.push({
        type: 'ILLEGAL_TRANSITION',
        severity: 'critical',
        title: 'Illegal State Transition',
        description: `Transition from "${raw.fromState}" to "${raw.toState}" is NOT declared in the statechart POU model.`,
        details: `${destText} This may indicate an unhandled runtime bypass, direct variable overwrite, or unexpected edge case.`,
        expectedContext: legalDestinations.join(' | ') || 'None',
        detectedValue: raw.toState,
      });
      anomalyCounts.ILLEGAL_TRANSITION++;
    }

    // 2. CHATTER / RAPID BOUNCE DETECTION
    // If state bounced back to previous state within < 40ms or ping-ponged
    if (prevEvent) {
      const timeSincePrev = raw.timestamp - prevEvent.timestamp;
      const isPingPong =
        prevEvent.fromState === raw.toState && prevEvent.toState === raw.fromState;

      if ((timeSincePrev < 40 && dwellMs < 40) || (isPingPong && timeSincePrev < 100)) {
        anomalies.push({
          type: 'CHATTER_BOUNCE',
          severity: 'warning',
          title: 'Rapid State Chatter / Bounce',
          description: `Rapid reversal from "${raw.fromState}" back to "${raw.toState}" occurred within ${timeSincePrev}ms.`,
          details:
            'Indicates mechanical switch bounce, noisy sensor input without software debounce, or unstable guard condition.',
          expectedContext: 'Dwell > 50ms without oscillation',
          detectedValue: `${timeSincePrev}ms dwell`,
        });
        anomalyCounts.CHATTER_BOUNCE++;
      }
    }

    // 3. DWELL TIME OUTLIER / TIMEOUT DETECTION
    const dwellStat = baselineDwells[raw.fromState];
    const isErrorOrIdle =
      raw.fromState.toLowerCase().includes('idle') ||
      raw.fromState.toLowerCase().includes('wait') ||
      raw.fromState.toLowerCase().includes('error');

    if (!isErrorOrIdle && dwellStat && dwellStat.count >= 3) {
      // If dwell is greater than 3.5x average and greater than 3000ms
      if (dwellMs > Math.max(3000, dwellStat.avgDwellMs * 3.5)) {
        anomalies.push({
          type: 'DWELL_TIMEOUT',
          severity: 'warning',
          title: 'State Dwell Timeout / Stall',
          description: `Remained in "${raw.fromState}" for ${(dwellMs / 1000).toFixed(2)}s (typical average: ${(dwellStat.avgDwellMs / 1000).toFixed(2)}s).`,
          details:
            'State execution took significantly longer than normal cycle baseline, pointing to actuator delay or delayed sensor handshake.',
          expectedContext: `~${dwellStat.avgDwellMs}ms avg`,
          detectedValue: `${dwellMs}ms`,
        });
        anomalyCounts.DWELL_TIMEOUT++;
      }
    }

    // 4. ABRUPT FAULT / UNEXPECTED ERROR JUMP
    const toLower = raw.toState.toLowerCase();
    const fromLower = raw.fromState.toLowerCase();
    const isErrorSink =
      toLower.includes('err') ||
      toLower.includes('fault') ||
      toLower.includes('abort') ||
      toLower.includes('alarm');
    const isExpectedFromSetup =
      fromLower.includes('init') ||
      fromLower.includes('check') ||
      fromLower.includes('idle');

    if (isErrorSink && !isExpectedFromSetup && inModel) {
      // Even if in model, abrupt error jump mid-production is flagged as an unexpected change
      anomalies.push({
        type: 'ABRUPT_FAULT',
        severity: 'critical',
        title: 'Abrupt Fault State Triggered',
        description: `Operational sequence interrupted by sudden transition to fault state "${raw.toState}".`,
        details: raw.guardFired
          ? `Fault guard triggered: ${raw.guardFired}`
          : 'Transition jumped to error sink during active process.',
        expectedContext: 'Normal operational sequence',
        detectedValue: raw.toState,
      });
      anomalyCounts.ABRUPT_FAULT++;
    }

    const isUnexpected = anomalies.length > 0;

    // Format human-friendly time string
    const date = new Date(raw.timestamp);
    const timeFormatted = `${String(date.getHours()).padStart(2, '0')}:${String(
      date.getMinutes()
    ).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(
      date.getMilliseconds()
    ).padStart(3, '0')}`;

    const eventObj: ChronologicalTransitionEvent = {
      id: `evt-${idx + 1}`,
      index: idx + 1,
      timestamp: raw.timestamp,
      isoTime: date.toISOString(),
      formattedTime: timeFormatted,
      relativeSec,
      fromState: raw.fromState,
      toState: raw.toState,
      dwellMs,
      cycleNumber: raw.cycleNumber || Math.floor(idx / Math.max(1, states.length)) + 1,
      guardFired: raw.guardFired,
      isUnexpected,
      anomalies,
      rawLogLine: raw.rawLogLine,
    };

    processedEvents.push(eventObj);

    // Build timeline interval for the state that was just active
    const intervalEndSec = relativeSec;
    intervals.push({
      id: `int-${idx + 1}`,
      stateId: raw.fromState,
      startSec: intervalStartSec,
      endSec: intervalEndSec,
      durationMs: Math.max(10, Math.round((intervalEndSec - intervalStartSec) * 1000)),
      eventIndex: idx + 1,
      isUnexpectedExit: isUnexpected,
      cycleNumber: eventObj.cycleNumber,
      anomalies,
    });
    intervalStartSec = intervalEndSec;

    prevEvent = eventObj;
  });

  // Add final interval for the last toState
  if (processedEvents.length > 0) {
    const finalEv = processedEvents[processedEvents.length - 1];
    intervals.push({
      id: `int-final`,
      stateId: finalEv.toState,
      startSec: intervalStartSec,
      endSec: Number((intervalStartSec + 0.5).toFixed(3)),
      durationMs: 500,
      eventIndex: processedEvents.length,
      isUnexpectedExit: false,
      cycleNumber: finalEv.cycleNumber,
    });
  }

  const unexpectedCount = processedEvents.filter((e) => e.isUnexpected).length;
  const expectedCount = processedEvents.length - unexpectedCount;
  const complianceRate =
    processedEvents.length > 0
      ? Number(((expectedCount / processedEvents.length) * 100).toFixed(1))
      : 100;

  return {
    name: datasetName,
    source,
    events: processedEvents,
    intervals,
    startTime,
    endTime,
    totalDurationSec,
    uniqueStates: Array.from(uniqueStatesSet),
    unexpectedCount,
    expectedCount,
    complianceRate,
    anomalyCounts,
    stateDwellStats: baselineDwells,
  };
}

/**
 * Parses timestamp strings in various formats:
 * - ISO string: 2026-09-24T10:00:00.120Z or 2026-09-24 10:00:00.120
 * - Time-only: 14:20:05.350 or 14:20:05
 * - Relative seconds: 0, 1.25, 3.500
 * - Milliseconds: 1000, 2500
 */
export function parseTimestampValue(val: string, baseEpoch: number, index: number): number {
  if (!val) return baseEpoch + index * 300;
  const clean = val.replace(/^[\[\("']|[\]\)"']$/g, '').trim();

  // 1. Time only (HH:mm:ss or HH:mm:ss.SSS)
  const timeOnlyMatch = clean.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (timeOnlyMatch) {
    const today = new Date();
    today.setHours(parseInt(timeOnlyMatch[1], 10));
    today.setMinutes(parseInt(timeOnlyMatch[2], 10));
    today.setSeconds(parseInt(timeOnlyMatch[3], 10));
    today.setMilliseconds(timeOnlyMatch[4] ? parseInt(timeOnlyMatch[4].padEnd(3, '0').slice(0, 3), 10) : 0);
    return today.getTime();
  }

  // 2. Numeric offset (e.g., 0, 1.5, 3.25 or 1500)
  const num = Number(clean);
  if (!isNaN(num)) {
    if (num > 1000000000000) {
      // Epoch ms
      return num;
    }
    if (num > 1000000000) {
      // Epoch seconds
      return num * 1000;
    }
    if (num < 86400) {
      // Relative seconds from baseEpoch
      return Math.round(baseEpoch + num * 1000);
    }
    // Relative milliseconds from baseEpoch
    return Math.round(baseEpoch + num);
  }

  // 3. ISO / Standard Date parsing
  const isoFormatted = clean.includes(' ') && !clean.includes('T') ? clean.replace(' ', 'T') : clean;
  const parsed = Date.parse(isoFormatted);
  if (!isNaN(parsed)) {
    return parsed;
  }

  // Fallback
  return baseEpoch + index * 300;
}

/**
 * Universal PLC log text parser supporting CSV, TSV, JSON, Beckhoff ADS Logger,
 * Siemens TIA Portal state traces, and Allen-Bradley Logix CSV.
 * Gracefully handles [Timestamp, FromState, ToState] and variations.
 */
export function parsePlcHistoryLog(
  rawText: string,
  states: IdentifiedPouState[],
  edges: EdgeInfo[],
  fileName: string = 'Imported_PLC_Log'
): TransitionHistoryDataset {
  const text = rawText.trim();
  if (!text) {
    return analyzeChronologicalEvents([], states, edges, fileName, 'file');
  }

  // 1. JSON Array parsing
  if (text.startsWith('[') && text.endsWith(']') && text.includes('{')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const baseEpoch = Date.now() - parsed.length * 500;
        const rawEvents = parsed
          .map((item, idx) => {
            const from = String(item.from || item.fromState || item.source || '').trim();
            const to = String(item.to || item.toState || item.target || '').trim();
            if (!from || !to) return null;
            const ts = item.timestamp
              ? parseTimestampValue(String(item.timestamp), baseEpoch, idx)
              : baseEpoch + idx * 300;
            return {
              timestamp: isNaN(ts) ? baseEpoch + idx * 300 : ts,
              fromState: from,
              toState: to,
              dwellMs: item.dwellMs || item.durationMs || 150,
              cycleNumber: item.cycleNumber || item.cycle,
              guardFired: item.guard || item.condition,
              rawLogLine: JSON.stringify(item),
            };
          })
          .filter(Boolean) as {
          timestamp: number;
          fromState: string;
          toState: string;
          dwellMs: number;
          cycleNumber?: number;
          guardFired?: string;
          rawLogLine?: string;
        }[];

        return analyzeChronologicalEvents(rawEvents, states, edges, fileName, 'file');
      }
    } catch {
      // Continue to line-by-line parsing
    }
  }

  // 2. Line by line parsing for CSV, TSV, ADS, Siemens, etc.
  const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const baseEpoch = Date.now() - rawLines.length * 400;
  const parsedItems: {
    timestamp: number;
    fromState: string;
    toState: string;
    dwellMs?: number;
    cycleNumber?: number;
    guardFired?: string;
    rawLogLine?: string;
    explicitDwell: boolean;
  }[] = [];

  rawLines.forEach((line, idx) => {
    // Ignore comments
    if (line.startsWith('//') || line.startsWith('#') || line.startsWith('/*')) return;

    // Remove wrapping brackets if whole line is bracketed like [Timestamp, FromState, ToState]
    let sanitizedLine = line;
    if (sanitizedLine.startsWith('[') && sanitizedLine.endsWith(']')) {
      sanitizedLine = sanitizedLine.slice(1, -1).trim();
    }

    // Check header line
    const lowerLine = sanitizedLine.toLowerCase();
    if (
      (lowerLine.includes('timestamp') || lowerLine.includes('time')) &&
      (lowerLine.includes('from') || lowerLine.includes('source') || lowerLine.includes('state')) &&
      (lowerLine.includes('to') || lowerLine.includes('target') || lowerLine.includes('dest'))
    ) {
      return;
    }

    // A) Beckhoff ADS Logger format:
    // "2026-09-24 14:10:02.150 [INFO] Transition: STATE_INIT -> STATE_IDLE (dwell: 250ms)"
    // "2026-09-24 14:10:02.150 [WARN] State: STATE_RUN -> STATE_ERR"
    const adsMatch = sanitizedLine.match(
      /(?:Transition:?|State:?)\s*([A-Za-z0-9_]+)\s*(?:->|-->|=>|to)\s*([A-Za-z0-9_]+)/i
    );
    if (adsMatch) {
      const from = adsMatch[1];
      const to = adsMatch[2];
      const timeMatch = sanitizedLine.match(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?/);
      const parsedTs = timeMatch ? Date.parse(timeMatch[0].replace(' ', 'T')) : NaN;
      const ts = !isNaN(parsedTs) ? parsedTs : baseEpoch + idx * 350;

      const dwellMatch = sanitizedLine.match(/dwell:?\s*(\d+(?:\.\d+)?)\s*(?:ms|s)?/i);
      let dwell: number | undefined = undefined;
      let explicitDwell = false;
      if (dwellMatch) {
        dwell = sanitizedLine.includes('s') && !sanitizedLine.includes('ms')
          ? parseFloat(dwellMatch[1]) * 1000
          : parseFloat(dwellMatch[1]);
        explicitDwell = true;
      }

      parsedItems.push({
        timestamp: ts,
        fromState: from,
        toState: to,
        dwellMs: dwell,
        cycleNumber: idx + 1,
        rawLogLine: line,
        explicitDwell,
      });
      return;
    }

    // B) Siemens S7 Diagnostic / TIA state trace:
    // "10:14:02.300;EVENT_TRANSITION;PrevState=STATE_INIT;NewState=STATE_IDLE;Dwell=120"
    const siemensMatch = sanitizedLine.match(/PrevState=([A-Za-z0-9_]+).*?NewState=([A-Za-z0-9_]+)/i);
    if (siemensMatch) {
      const from = siemensMatch[1];
      const to = siemensMatch[2];
      const dwellMatch = sanitizedLine.match(/Dwell=(\d+)/i);
      parsedItems.push({
        timestamp: baseEpoch + idx * 350,
        fromState: from,
        toState: to,
        dwellMs: dwellMatch ? parseInt(dwellMatch[1], 10) : undefined,
        rawLogLine: line,
        explicitDwell: !!dwellMatch,
      });
      return;
    }

    // C) CSV / TSV / Delimited lines: [Timestamp, FromState, ToState, ...]
    const delimiter = sanitizedLine.includes('\t') ? '\t' : sanitizedLine.includes(';') ? ';' : ',';
    const rawCols = sanitizedLine.split(delimiter);
    const cols = rawCols.map((c) => c.replace(/^[\[\("']|[\]\)"']$/g, '').trim());

    if (cols.length >= 2) {
      let ts = baseEpoch + idx * 300;
      let from = '';
      let to = '';
      let dwell: number | undefined = undefined;
      let cycle = idx + 1;
      let guard: string | undefined = undefined;
      let explicitDwell = false;

      // Col format 1: [timestamp, fromState, toState, dwellMs?, cycle?, guard?]
      if (cols.length >= 3) {
        const potentialTs = parseTimestampValue(cols[0], baseEpoch, idx);
        // If cols[0] parsed to a reasonable timestamp or relative seconds
        ts = potentialTs;
        from = cols[1];
        to = cols[2];

        if (cols.length >= 4 && !isNaN(Number(cols[3])) && cols[3] !== '') {
          dwell = Number(cols[3]);
          explicitDwell = true;
        }
        if (cols.length >= 5 && !isNaN(Number(cols[4])) && cols[4] !== '') {
          cycle = Number(cols[4]);
        }
        if (cols.length >= 6) {
          guard = cols[5];
        }
      } else {
        // Col format 2: [fromState, toState, dwellMs?, cycle?, guard?]
        from = cols[0];
        to = cols[1];
        if (cols.length >= 3 && !isNaN(Number(cols[2])) && cols[2] !== '') {
          dwell = Number(cols[2]);
          explicitDwell = true;
        }
        if (cols.length >= 4 && !isNaN(Number(cols[3])) && cols[3] !== '') {
          cycle = Number(cols[3]);
        }
        if (cols.length >= 5) {
          guard = cols[4];
        }
      }

      // Check if from and to are not header words
      const lowerFrom = from.toLowerCase();
      const lowerTo = to.toLowerCase();
      if (
        (lowerFrom === 'from' || lowerFrom === 'fromstate' || lowerFrom === 'source') &&
        (lowerTo === 'to' || lowerTo === 'tostate' || lowerTo === 'target')
      ) {
        return;
      }

      if (from && to) {
        parsedItems.push({
          timestamp: ts,
          fromState: from,
          toState: to,
          dwellMs: dwell,
          cycleNumber: cycle,
          guardFired: guard,
          rawLogLine: line,
          explicitDwell,
        });
      }
    }
  });

  // Sort chronologically
  parsedItems.sort((a, b) => a.timestamp - b.timestamp);

  // Compute dwell time delta for events that did not have an explicit dwellMs specified
  // If event i has timestamp T_i and event i-1 has timestamp T_{i-1}, dwell = T_i - T_{i-1}
  const rawEvents = parsedItems.map((item, i) => {
    let dwell = item.dwellMs;
    if (dwell === undefined || !item.explicitDwell) {
      if (i > 0) {
        const delta = item.timestamp - parsedItems[i - 1].timestamp;
        dwell = delta > 0 ? delta : 150;
      } else {
        dwell = 200; // First event baseline dwell
      }
    }
    return {
      timestamp: item.timestamp,
      fromState: item.fromState,
      toState: item.toState,
      dwellMs: Math.max(5, Math.round(dwell)),
      cycleNumber: item.cycleNumber,
      guardFired: item.guardFired,
      rawLogLine: item.rawLogLine,
    };
  });

  return analyzeChronologicalEvents(rawEvents, states, edges, fileName, 'file');
}

/**
 * Generates sample CSV text tailored to the active POU states for testing the PLC Transition Logger.
 */
export function generateSampleCsvForPou(
  states: IdentifiedPouState[],
  edges: EdgeInfo[],
  scenario: 'clean' | 'unexpected' | 'chatter' | 'stall' = 'unexpected',
  format: 'simple_3col' | 'extended_csv' = 'simple_3col'
): { csvText: string; fileName: string; title: string; count: number } {
  const ds = generateSyntheticHistoryLog(
    states,
    edges,
    scenario === 'clean'
      ? 'production_clean'
      : scenario === 'chatter'
      ? 'sensor_chatter'
      : scenario === 'stall'
      ? 'dwell_stall'
      : 'unexpected_anomalies'
  );

  let csvText = '';
  if (format === 'simple_3col') {
    const lines = [
      'Timestamp, FromState, ToState',
      ...ds.events.map((e) => `${e.isoTime}, ${e.fromState}, ${e.toState}`),
    ];
    csvText = lines.join('\n');
  } else {
    const lines = [
      'Timestamp, FromState, ToState, DwellMs, Cycle, Guard',
      ...ds.events.map(
        (e) =>
          `${e.isoTime}, ${e.fromState}, ${e.toState}, ${e.dwellMs}, ${e.cycleNumber || 1}, ${e.guardFired || ''}`
      ),
    ];
    csvText = lines.join('\n');
  }

  const titles: Record<string, string> = {
    clean: 'Clean Production Cycle CSV',
    unexpected: 'Unexpected Transitions & Faults CSV',
    chatter: 'Sensor Chatter / Rapid Bounce CSV',
    stall: 'Actuator Stall / Dwell Timeout CSV',
  };

  return {
    csvText,
    fileName: `plc_transition_log_${scenario}.csv`,
    title: titles[scenario] || 'PLC Transition Log',
    count: ds.events.length,
  };
}

/**
 * Generates realistic synthetic PLC runtime logs tailored to the user's active POU.
 * Offers standard golden batch production run OR scenario with intentionally injected unexpected state changes.
 */
export function generateSyntheticHistoryLog(
  states: IdentifiedPouState[],
  edges: EdgeInfo[],
  scenario: 'production_clean' | 'unexpected_anomalies' | 'sensor_chatter' | 'dwell_stall' = 'unexpected_anomalies'
): TransitionHistoryDataset {
  if (states.length === 0) {
    return analyzeChronologicalEvents([], states, edges, 'Empty Machine', 'preset');
  }

  const initial = states.find((s) => s.isInitial) || states[0];
  const stateList = states.map((s) => s.id);
  const rawEvents: {
    timestamp: number;
    fromState: string;
    toState: string;
    dwellMs: number;
    cycleNumber: number;
    guardFired?: string;
    rawLogLine: string;
  }[] = [];

  const baseTime = Date.now() - 180000; // 3 minutes ago
  let currentTs = baseTime;
  let currentState = initial.id;
  let cycle = 1;

  // Build edge map
  const outEdgesMap = new Map<string, EdgeInfo[]>();
  states.forEach((s) => {
    const outs = edges.filter((e) => e.from === s.id);
    outEdgesMap.set(s.id, outs);
  });

  const totalSteps = scenario === 'production_clean' ? 45 : 60;

  for (let step = 0; step < totalSteps; step++) {
    const validOuts = outEdgesMap.get(currentState) || [];
    let nextState = '';
    let dwell = 120 + Math.round(Math.random() * 250);
    let guardText = '';

    // ==========================================
    // SCENARIO 1: UNEXPECTED ANOMALIES INJECTION
    // ==========================================
    if (scenario === 'unexpected_anomalies') {
      // Step 12: Injected ILLEGAL TRANSITION (Jumping directly to a state with no model edge!)
      if (step === 12 && stateList.length >= 3) {
        // Find a state that is NOT in validOuts
        const illegalCandidates = stateList.filter(
          (s) => s !== currentState && !validOuts.some((e) => e.to === s)
        );
        nextState =
          illegalCandidates.length > 0
            ? illegalCandidates[0]
            : stateList[(step + 2) % stateList.length];
        dwell = 180;
        guardText = 'FORCE_OVERRIDE_FLAG';
      }
      // Step 24 & 25: Injected CHATTER / RAPID BOUNCE
      else if (step === 24) {
        nextState = validOuts.length > 0 ? validOuts[0].to : stateList[(step + 1) % stateList.length];
        dwell = 12; // Extremely fast chatter
      } else if (step === 25) {
        // Bounces straight back to previous state!
        const prevEv = rawEvents[rawEvents.length - 1];
        nextState = prevEv ? prevEv.fromState : initial.id;
        dwell = 15;
      }
      // Step 38: Injected DWELL TIMEOUT / STALL
      else if (step === 38) {
        nextState = validOuts.length > 0 ? validOuts[0].to : stateList[(step + 1) % stateList.length];
        dwell = 6850; // High dwell stall (almost 7 seconds)
      }
      // Step 46: Injected ABRUPT FAULT
      else if (step === 46) {
        const errorState = stateList.find(
          (s) => s.toLowerCase().includes('err') || s.toLowerCase().includes('fault')
        );
        if (errorState && errorState !== currentState) {
          nextState = errorState;
          dwell = 210;
          guardText = 'SAFETY_CIRCUIT_TRIPPED';
        }
      }
    }

    // ==========================================
    // SCENARIO 2: SENSOR CHATTER
    // ==========================================
    else if (scenario === 'sensor_chatter') {
      if (step === 8 || step === 9 || step === 22 || step === 23) {
        dwell = Math.round(8 + Math.random() * 15);
      }
    }

    // ==========================================
    // SCENARIO 3: DWELL STALL
    // ==========================================
    else if (scenario === 'dwell_stall') {
      if (step === 15 || step === 32) {
        dwell = 7200;
      }
    }

    // Normal progression if not overridden by an anomaly injection
    if (!nextState) {
      if (validOuts.length > 0) {
        // Prioritize non-error edge first
        const nonError = validOuts.filter(
          (e) =>
            !e.to.toLowerCase().includes('err') &&
            !e.to.toLowerCase().includes('fault') &&
            !e.to.toLowerCase().includes('abort')
        );
        const chosen =
          nonError.length > 0
            ? nonError[Math.floor(Math.random() * nonError.length)]
            : validOuts[Math.floor(Math.random() * validOuts.length)];
        nextState = chosen.to;
        guardText = chosen.guard || chosen.condition || '';
      } else {
        // Loop back to initial
        nextState = initial.id;
      }
    }

    // Assign realistic dwell based on state name
    const lower = currentState.toLowerCase();
    if (lower.includes('idle')) dwell = Math.max(dwell, 800 + Math.round(Math.random() * 1000));
    else if (lower.includes('init')) dwell = Math.max(dwell, 300 + Math.round(Math.random() * 200));

    currentTs += dwell;

    const logLine = `${new Date(currentTs).toISOString()} [TC_EVENT] Transition: ${currentState} -> ${nextState} (dwell: ${dwell}ms)`;

    rawEvents.push({
      timestamp: currentTs,
      fromState: currentState,
      toState: nextState,
      dwellMs: dwell,
      cycleNumber: cycle,
      guardFired: guardText,
      rawLogLine: logLine,
    });

    if (nextState === initial.id) {
      cycle++;
    }

    currentState = nextState;
  }

  const scenarioNames: Record<string, string> = {
    production_clean: 'Production Golden Batch (Clean)',
    unexpected_anomalies: 'Simulated Log with Injected Unexpected State Changes',
    sensor_chatter: 'Sensor Bounce & Contact Chatter Log',
    dwell_stall: 'Actuator Stall & Dwell Outlier Log',
  };

  return analyzeChronologicalEvents(
    rawEvents,
    states,
    edges,
    scenarioNames[scenario] || 'PLC Transition History',
    'preset'
  );
}
