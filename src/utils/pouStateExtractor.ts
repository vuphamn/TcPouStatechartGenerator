/**
 * Utility for parsing and identifying all states from a Beckhoff TwinCAT .TcPOU file
 * (along with optional .TcDUT enum declaration for groupings and descriptions).
 */

import { parseTransitionsFromStateCode } from './pouStateEditor.ts';

export interface IdentifiedPouState {
  id: string; // Machine-readable state identifier (e.g. TABLEMANAGER_IDLE_FEED_OFF)
  label: string; // Display label
  description?: string; // Human-readable description (from getStateDescription or DUT comments)
  hasCaseBranch: boolean; // Whether an explicit CASE branch is implemented in doState()
  outgoingTransitions: string[]; // Target states this state can transition to
  incomingTransitions: string[]; // Source states that can transition into this state
  compositeGroup?: string; // Associated composite group/subgraph (from DUT comments or UML)
  isInitial?: boolean; // Whether this is the starting/initial state
  isErrorSink?: boolean; // Whether this represents an error or fault sink state
  enumIndex: number; // Order index from DUT or order of discovery
  lineCount?: number; // Approximate lines of Structured Text code in its branch
}

export interface PouStatesExtractionResult {
  states: IdentifiedPouState[];
  stateVarName: string;
  totalCount: number;
  withLogicCount: number;
  groups: string[];
  doStateFound: boolean;
  preProcessFound: boolean;
  dutMatched: boolean;
}

/**
 * Extracts all identified states and their transition metadata from a .TcPOU and optional .TcDUT.
 */
export function extractIdentifiedStatesFromPou(
  pouXml: string,
  dutContent?: string
): PouStatesExtractionResult {
  const result: PouStatesExtractionResult = {
    states: [],
    stateVarName: 'machineState',
    totalCount: 0,
    withLogicCount: 0,
    groups: [],
    doStateFound: false,
    preProcessFound: false,
    dutMatched: false,
  };

  if (!pouXml || !pouXml.trim()) {
    return result;
  }

  // 1. Extract Descriptions from getStateDescription() if present
  const descriptionsMap = extractStateDescriptionsFromPou(pouXml);

  // 2. Extract DUT groups and enum ordering if present
  const { enumOrder, stateToGroup, dutCommentsMap, groupsList } = parseDutInformation(dutContent);
  if (enumOrder.length > 0) {
    result.dutMatched = true;
    result.groups = groupsList;
  }

  // 3. Extract UML composite groups from doState_UmlSC if present
  const umlGroupsMap = extractUmlCompositeGroups(pouXml);

  // 4. Locate doState() method
  const methodRx = /<Method[^>]*\bName=["']doState["'][^>]*>([\s\S]*?)<\/Method>/i;
  const methodMatch = pouXml.match(methodRx);
  let doStateSt = '';
  if (methodMatch) {
    result.doStateFound = true;
    const stRx = /<ST[^>]*>([\s\S]*?)<\/ST>/i;
    const stMatch = methodMatch[1].match(stRx);
    if (stMatch) {
      const cdataMatch = stMatch[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
      doStateSt = cdataMatch ? cdataMatch[1] : unescapeXml(stMatch[1]);
    }
  }

  // 5. Detect state variable name from CASE (var) OF
  let stateVar = 'machineState';
  if (doStateSt) {
    const caseVarMatch = doStateSt.match(/\bCASE\b\s*\(?\s*([A-Za-z0-9_\.]+)\s*\)?\s*\bOF\b/i);
    if (caseVarMatch) {
      stateVar = caseVarMatch[1].trim();
      result.stateVarName = stateVar;
    }
  }

  // 6. Map to collect all states by id
  const stateMap = new Map<
    string,
    {
      id: string;
      label: string;
      hasCaseBranch: boolean;
      outgoing: Set<string>;
      rawCode: string;
      discoveryIndex: number;
    }
  >();

  let discoveryCounter = 0;

  // 7. Parse CASE branches in doState()
  if (doStateSt) {
    const caseRx = /(\bCASE\b\s*\(?\s*([A-Za-z0-9_\.]+)\s*\)?\s*\bOF\b)([\s\S]*?)(\bEND_CASE\b;?)/i;
    const caseMatch = doStateSt.match(caseRx);
    if (caseMatch) {
      const body = caseMatch[3];
      // Matches lines like "  TABLEMANAGER_DISABLED:" or "STATE_A, STATE_B:"
      const labelPattern = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*:(?!\=)(?:\s*(?:\/\/[^\n]*|\(\*[\s\S]*?\*\)))?\s*$/gm;
      const matches: RegExpExecArray[] = [];
      let m: RegExpExecArray | null;
      while ((m = labelPattern.exec(body)) !== null) {
        matches.push(m);
      }

      for (let i = 0; i < matches.length; i++) {
        const curMatch = matches[i];
        const rawLabels = curMatch[1].split(',').map((l) => l.trim()).filter(Boolean);
        const startIdx = curMatch.index + curMatch[0].length;
        let endIdx = i + 1 < matches.length ? matches[i + 1].index : body.length;

        const slice = body.slice(startIdx, endIdx);
        const elseMatch = slice.match(/^[ \t]*ELSE\b/im);
        if (elseMatch && elseMatch.index !== undefined) {
          endIdx = startIdx + elseMatch.index;
        }

        const rawCode = body.slice(startIdx, endIdx);
        const outgoing = parseTransitionsFromStateCode(rawCode, stateVar);

        for (const lbl of rawLabels) {
          if (!stateMap.has(lbl)) {
            stateMap.set(lbl, {
              id: lbl,
              label: formatStateLabel(lbl),
              hasCaseBranch: true,
              outgoing: new Set(outgoing),
              rawCode,
              discoveryIndex: discoveryCounter++,
            });
          } else {
            const existing = stateMap.get(lbl)!;
            existing.hasCaseBranch = true;
            outgoing.forEach((t) => existing.outgoing.add(t));
          }

          // Also track any target states referenced in transitions
          for (const target of outgoing) {
            if (!stateMap.has(target)) {
              stateMap.set(target, {
                id: target,
                label: formatStateLabel(target),
                hasCaseBranch: false,
                outgoing: new Set(),
                rawCode: '',
                discoveryIndex: discoveryCounter++,
              });
            }
          }
        }
      }
    }
  }

  // 8. Parse preProcess() method for global overrides & error sinks
  const preRx = /<Method[^>]*\bName=["']preProcess["'][^>]*>([\s\S]*?)<\/Method>/i;
  const preMatch = pouXml.match(preRx);
  if (preMatch) {
    result.preProcessFound = true;
    const stRx = /<ST[^>]*>([\s\S]*?)<\/ST>/i;
    const stMatch = preMatch[1].match(stRx);
    if (stMatch) {
      const cdataMatch = stMatch[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
      const preSt = cdataMatch ? cdataMatch[1] : unescapeXml(stMatch[1]);
      const preTransitions = parseTransitionsFromStateCode(preSt, stateVar);
      for (const target of preTransitions) {
        if (!stateMap.has(target)) {
          stateMap.set(target, {
            id: target,
            label: formatStateLabel(target),
            hasCaseBranch: false,
            outgoing: new Set(),
            rawCode: '',
            discoveryIndex: discoveryCounter++,
          });
        }
      }
    }
  }

  // 9. Include all states declared in DUT if not yet in stateMap
  for (const enumState of enumOrder) {
    if (!stateMap.has(enumState)) {
      stateMap.set(enumState, {
        id: enumState,
        label: formatStateLabel(enumState),
        hasCaseBranch: false,
        outgoing: new Set(),
        rawCode: '',
        discoveryIndex: discoveryCounter++,
      });
    }
  }

  // 10. Calculate incoming transitions
  const incomingMap = new Map<string, Set<string>>();
  for (const [, stateInfo] of stateMap) {
    for (const target of stateInfo.outgoing) {
      if (!incomingMap.has(target)) {
        incomingMap.set(target, new Set());
      }
      incomingMap.get(target)!.add(stateInfo.id);
    }
  }

  // 11. Assemble final IdentifiedPouState list
  const identifiedList: IdentifiedPouState[] = [];
  let firstStateId: string | null = null;
  if (enumOrder.length > 0) {
    firstStateId = enumOrder[0];
  } else if (stateMap.size > 0) {
    firstStateId = Array.from(stateMap.keys())[0];
  }

  for (const [id, info] of stateMap) {
    const enumIdx = enumOrder.indexOf(id);
    const orderIndex = enumIdx >= 0 ? enumIdx : 1000 + info.discoveryIndex;

    const desc =
      descriptionsMap.get(id) ||
      dutCommentsMap.get(id) ||
      undefined;

    const group =
      umlGroupsMap.get(id) ||
      stateToGroup.get(id) ||
      undefined;

    const lowerId = id.toLowerCase();
    const isError =
      lowerId.includes('error') ||
      lowerId.includes('fault') ||
      lowerId.includes('alarm');

    const isInit =
      id === firstStateId ||
      lowerId.includes('disabled') ||
      lowerId.endsWith('_init') ||
      lowerId === 'init' ||
      lowerId === 'start';

    const lines = info.rawCode ? info.rawCode.trim().split(/\r?\n/).length : 0;

    identifiedList.push({
      id,
      label: info.label,
      description: desc,
      hasCaseBranch: info.hasCaseBranch,
      outgoingTransitions: Array.from(info.outgoing),
      incomingTransitions: incomingMap.has(id) ? Array.from(incomingMap.get(id)!) : [],
      compositeGroup: group,
      isInitial: isInit && id === firstStateId,
      isErrorSink: isError,
      enumIndex: orderIndex,
      lineCount: lines,
    });
  }

  // Sort by enumIndex by default (reflects natural machine cycle)
  identifiedList.sort((a, b) => a.enumIndex - b.enumIndex);

  result.states = identifiedList;
  result.totalCount = identifiedList.length;
  result.withLogicCount = identifiedList.filter((s) => s.hasCaseBranch).length;

  // Gather unique groups from states if not already collected
  if (result.groups.length === 0) {
    const uniqueGroups = new Set<string>();
    identifiedList.forEach((s) => {
      if (s.compositeGroup) uniqueGroups.add(s.compositeGroup);
    });
    result.groups = Array.from(uniqueGroups);
  }

  return result;
}

/**
 * Extracts human-readable state descriptions from the getStateDescription() method.
 */
function extractStateDescriptionsFromPou(pouXml: string): Map<string, string> {
  const map = new Map<string, string>();
  const methodRx = /<Method[^>]*\bName=["']getStateDescription["'][^>]*>([\s\S]*?)<\/Method>/i;
  const match = pouXml.match(methodRx);
  if (!match) return map;

  const stRx = /<ST[^>]*>([\s\S]*?)<\/ST>/i;
  const stMatch = match[1].match(stRx);
  if (!stMatch) return map;

  const cdata = stMatch[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
  const st = cdata ? cdata[1] : unescapeXml(stMatch[1]);

  // Matches lines like: TABLEMANAGER_DISABLED: getStateDescription := 'Disabled';
  const rx = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*getStateDescription\s*:=\s*['"]([^'"]+)['"]/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(st)) !== null) {
    map.set(m[1].trim(), m[2].trim());
  }

  return map;
}

/**
 * Parses DUT enum declaration for states, category comments, and ordering.
 */
function parseDutInformation(dutContent?: string): {
  enumOrder: string[];
  stateToGroup: Map<string, string>;
  dutCommentsMap: Map<string, string>;
  groupsList: string[];
} {
  const enumOrder: string[] = [];
  const stateToGroup = new Map<string, string>();
  const dutCommentsMap = new Map<string, string>();
  const groupsList: string[] = [];

  if (!dutContent || !dutContent.trim()) {
    return { enumOrder, stateToGroup, dutCommentsMap, groupsList };
  }

  // Extract Declaration content
  const declMatch = dutContent.match(/<Declaration>[\s\S]*?<!\[CDATA\[([\s\S]*?)\]\]>[\s\S]*?<\/Declaration>/i);
  const rawDecl = declMatch ? declMatch[1] : dutContent;

  const lines = rawDecl.split(/\r?\n/);
  let currentGroup = '';

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Check for comment headers like (* Standard Running States *) or // Standard Running States
    const blockCommentMatch = trimmed.match(/^\(\*\s*([^*]+?)\s*\*\)$/);
    if (blockCommentMatch) {
      const gName = blockCommentMatch[1].trim();
      if (!gName.toLowerCase().includes('declaration') && !gName.toLowerCase().includes('type')) {
        currentGroup = gName;
        if (!groupsList.includes(gName)) groupsList.push(gName);
      }
      continue;
    }

    // Match enum item: STATE_NAME, or STATE_NAME := 10, with optional comment
    const enumRx = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*:=\s*[^,;]+)?(?:\s*,|\s*;|\s*$)(?:\s*(?:\(\*([^*]+)\*\)|\/\/(.*)))?/;
    const m = trimmed.match(enumRx);
    if (m) {
      const stateName = m[1].trim();
      // Skip keywords
      if (['TYPE', 'STRUCT', 'END_TYPE', 'END_STRUCT'].includes(stateName.toUpperCase())) {
        continue;
      }
      if (!enumOrder.includes(stateName)) {
        enumOrder.push(stateName);
      }
      if (currentGroup) {
        stateToGroup.set(stateName, currentGroup);
      }
      const inlineComment = (m[2] || m[3] || '').trim();
      if (inlineComment) {
        dutCommentsMap.set(stateName, inlineComment);
      }
    }
  }

  return { enumOrder, stateToGroup, dutCommentsMap, groupsList };
}

/**
 * Extracts UML composite groups from doState_UmlSC if embedded in the POU XML.
 */
function extractUmlCompositeGroups(pouXml: string): Map<string, string> {
  const map = new Map<string, string>();
  const umlMethodRx = /<Method[^>]*\bName=["']doState_UmlSC["'][^>]*>([\s\S]*?)<\/Method>/i;
  const match = pouXml.match(umlMethodRx);
  if (!match) return map;

  // Look for State elements with parent composite groups
  const stateElementRx = /<State[^>]*\bName=["']([^"']+)["'][^>]*\bParent=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = stateElementRx.exec(match[1])) !== null) {
    const sName = m[1].trim();
    const pName = m[2].trim();
    if (sName && pName && pName !== 'Root' && pName !== 'None') {
      map.set(sName, pName);
    }
  }

  return map;
}

/**
 * Formats a raw state constant (e.g. TABLEMANAGER_AUTOFEED_IDLE) into a cleaner human label.
 */
function formatStateLabel(rawId: string): string {
  // If snake_case, make it readable if very long, or keep the standard ID
  return rawId;
}

/**
 * Unescapes standard XML entities.
 */
function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
