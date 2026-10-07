// Port of TcPouStatechartGenerator (C#) to TypeScript

import { findAllSubMachines } from './utils/subMachines.ts';
import { DOMParser as XmldomParser } from '@xmldom/xmldom';
import { unqualifyState, STATE_LABELS_SRC } from './utils/stateNames.ts';
import { caseArmCondition, caseLabelOf, caseSelectorOf, splitStatements } from './utils/stStatements.ts';

export type PriorityFormat = 'paren' | 'bracket' | 'circled';

export interface GeneratorOptions {
  collapseErrorSinkEdges?: boolean;
  /** A state's IF / ELSIF / ELSE of transitions drawn as a choice (a diamond) */
  choiceNodes?: boolean;
  /** An IF's ELSE in a guard written as what it is ("NOT (a OR b)"), not "else" */
  spellOutElse?: boolean;
  flowchartOutput?: boolean;
  includeStateDescriptions?: boolean;
  showTransitionPriorities?: boolean;
  priorityFormat?: PriorityFormat;
  /** States' entry / do / exit actions (their first line) shown under their names, as TwinCAT's UML editor does */
  stateActions?: Map<string, { entry?: string; do?: string; exit?: string }>;
  /** Composites drawn collapsed: one box for the composite and its states (their transitions in and out its own) */
  collapsedComposites?: string[];
}

/**
 * Composites collapsed (a view of the chart; the code is not changed): each one's states, its sub-composites' too,
 * drawn as one state named after it, in the composite around it if any. The transitions into or out of them go to /
 * leave that state, the ones within it are left out, a choice's arms from it are plain transitions
 */
function collapseComposites(names: string[], transitions: Transition[], states: Set<string>, groups: GroupingResult, finalStates: Set<string>, stateDescriptions?: Map<string, string>) {
  for (const name of names) {
    if (!groups.groups.has(name)) continue;
    // (the composite's own states and its sub-composites')
    const inside = new Set<string>();
    const subs = new Set<string>([name]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [child, parent] of groups.groupParent) if (subs.has(parent) && !subs.has(child)) {
        subs.add(child);
        grew = true;
      }
    }
    for (const g of subs) for (const s of groups.groups.get(g) ?? []) inside.add(s);
    if (states.has(name) && !inside.has(name)) continue;
    const parent = groups.groupParent.get(name);
    for (const g of subs) {
      groups.groups.delete(g);
      groups.groupParent.delete(g);
      groups.groupFirstState.delete(g);
      groups.groupLastState.delete(g);
      groups.markedInitial?.delete(g);
      groups.groupFinals?.delete(g);
    }
    for (const s of inside) {
      states.delete(s);
      groups.stateToGroup.delete(s);
      finalStates.delete(s);
    }
    states.add(name);
    if (parent && groups.groups.has(parent)) {
      groups.groups.get(parent)!.push(name);
      groups.stateToGroup.set(name, parent);
    }
    if (groups.machineStartState && inside.has(groups.machineStartState)) groups.machineStartState = name;
    stateDescriptions?.set(name, `collapsed: ${inside.size} states`);
    const at = (s: string) => (inside.has(s) ? name : s);
    for (let i = transitions.length - 1; i >= 0; i--) {
      const t = transitions[i];
      const from = at(t.from);
      const to = at(t.to);
      if (from === name && to === name) {
        transitions.splice(i, 1);
        continue;
      }
      if (from !== t.from || to !== t.to) {
        transitions[i] = { ...t, from, to, effectiveFrom: at(t.effectiveFrom), effectiveTo: at(t.effectiveTo), choice: from !== t.from ? undefined : t.choice };
      }
    }
  }
}

/** A line of code in a node label: # < > as Mermaid entities, short */
function actionText(code: string): string {
  const s = code.length > 34 ? `${code.slice(0, 33)}…` : code;
  return s.replace(/"/g, "'").replace(/#/g, '#35;').replace(/</g, '#lt;').replace(/>/g, '#gt;');
}

/** One enclosing IF level of an assignment: its condition (null: ELSE) and the earlier branches' conditions */
export interface GuardFrame {
  cond: string | null;
  /** Conditions of the IF / ELSIF branches before this one: all of them were FALSE */
  prior: string[];
}

/** A drawn transition (as extracted from the Mermaid code: sanitized ids, label as written) */
export interface ModelEdge {
  from: string;
  to: string;
  /** The label exactly as in the Mermaid code ('' when unlabeled) */
  label: string;
  source: string;
  /** The transitions in the code this edge stands for (several when edges were merged into a composite's) */
  members: { from: string; to: string; frames: GuardFrame[]; priority?: number | null }[];
}

export interface StatechartModel {
  markdown: string;
  stateVar: string;
  edges: ModelEdge[];
  /** The states with a sub-machine (a method's state machine they call), and whether it is drawn expanded */
  subMachines?: { parent: string; method: string; expanded: boolean }[];
  /** The composites (as drawn) and their own states */
  composites: Record<string, string[]>;
}

export interface Transition {
  from: string;
  to: string;
  guard: string | null;
  /** The IF levels around the assignment, outermost first */
  frames?: GuardFrame[];
  priority?: number | null;
  source: string;
  redirectedFrom?: string | null;
  /** In a state's top-level IF: which one and which arm (IF 0, ELSIF 1, …) */
  choice?: { id: number; arm: number };
  /** A composite's edge collapsed from several (Collapse error-sink edges): the transitions of the code it stands for */
  collapsed?: Transition[];
  redirectedTo?: string | null;
  scopeLower?: string | null;
  scopeUpper?: string | null;
  /** > / < (the bound itself left out) */
  scopeLowerStrict?: boolean;
  scopeUpperStrict?: boolean;
  effectiveFrom: string;
  effectiveTo: string;
}

interface IfFrame {
  currentCond: string | null;
  negatedPriorConds: (string | null)[];
  /** Which IF statement (for choice nodes) */
  id?: number;
  /** A CASE nested in a state's branch: its selector (its arms are this frame's conditions, as an IF's) */
  caseSel?: string;
  /** (its first arm seen) */
  armed?: boolean;
}
let ifSeq = 0;
/** (the option spellOutElse, for buildGuard: set at each generation) */
let spellElse = false;

interface UmlComposite {
  displayName: string;
  fullName: string;
  objectGuid: string;
  containerGuid: string;
}

interface GroupingResult {
  groups: Map<string, string[]>;
  stateToGroup: Map<string, string>;
  groupFirstState: Map<string, string>;
  groupLastState: Map<string, string>;
  compositeToId: Map<string, string>;
  groupParent: Map<string, string>;
  machineStartState?: string;
  enabledCompositeName?: string;
  enumOrder: string[];
  /** Composites whose initial state is marked (@initial): drawn with a start node */
  markedInitial?: Set<string>;
  /** A composite's final states (marked): its exits, each drawn to an end node in it */
  groupFinals?: Map<string, string[]>;
}

const DefaultCollapseErrorSinkEdges = false;
const CollapsedEdgeWarningLabel = "hasErrors [collapsed]";

function cleanXmlString(xml: string): string {
  // Strip BOM if present
  if (xml.charCodeAt(0) === 0xfeff) {
    return xml.slice(1);
  }
  return xml;
}

function parseXmlDoc(xml: string): Document | null {
  try {
    const cleaned = cleanXmlString(xml);
    const Parser = typeof DOMParser !== 'undefined' ? DOMParser : XmldomParser;
    const parser = new Parser();
    const doc = parser.parseFromString(cleaned, 'text/xml');
    return doc as unknown as Document;
  } catch {
    // ignore
  }
  return null;
}

function getMethodSt(doc: Document | null, rawXml: string, name: string): string | null {
  if (doc) {
    const methods = Array.from(doc.getElementsByTagName('Method'));
    const target = methods.find(
      (m) => m.getAttribute('Name')?.toLowerCase() === name.toLowerCase()
    );
    if (target) {
      const impl = Array.from(target.children).find((c) => c.tagName === 'Implementation');
      const st = impl ? Array.from(impl.children).find((c) => c.tagName === 'ST') : null;
      if (st && st.textContent !== null) {
        return st.textContent;
      }
    }
  }

  // Regex fallback
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`<Method[^>]*\\bName=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/Method>`, 'i');
  const m = rawXml.match(rx);
  if (!m) return null;

  const stMatch = m[1].match(/<ST[^>]*>([\s\S]*?)<\/ST>/i);
  if (!stMatch) return null;

  const cdata = stMatch[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
  if (cdata) return cdata[1];
  return stMatch[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** A sub-machine as the app follows it (Live, the simulation): see subMachines.ts */
export interface SubMachineInfo {
  parent: string;
  method: string;
  states: string[];
  /** Its state variable, and its declared type (an enum: its names when the PLC does not give them) */
  variable: string;
  variableType: string | null;
  start: string | null;
  entry: string | null;
  /** The conditions around its call: it runs only then (null: always, while its state is current) */
  when: string | null;
  /** A RETURN after its call: its state's own transitions wait while it runs */
  preempts: boolean;
  transitions: { from: string; to: string; guard: string | null }[];
}

/** The states of a POU that call a method with a state machine of its own (its sub-machines; see subMachines.ts) */
export function subMachinesOf(tcPouContent: string): SubMachineInfo[] {
  const doc = parseXmlDoc(tcPouContent);
  const methods = methodsOf(doc, tcPouContent);
  return findAllSubMachines(getMethodSt(doc, tcPouContent, 'doState'), methods, stripComments(tcPouContent)).map((m) => {
    const decl = stripComments(methods.get(m.method)?.decl ?? '');
    const type = new RegExp(`(?:^|[\\s;])${m.variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([A-Za-z_][\\w.]*)`, 'i').exec(decl)?.[1] ?? null;
    return { parent: m.parent, method: m.method, states: m.states, variable: m.variable, variableType: type, start: m.start, entry: m.entry, when: m.when, preempts: m.preempts, transitions: m.transitions };
  });
}

/** The POU's methods: their ST and declaration, by name */
function methodsOf(doc: Document | null, rawXml: string): Map<string, { st: string | null; decl: string | null }> {
  const out = new Map<string, { st: string | null; decl: string | null }>();
  for (const m of rawXml.matchAll(/<Method[^>]*\bName=["']([^"']+)["'][^>]*>([\s\S]*?)<\/Method>/gi)) {
    const decl = m[2].match(/<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1] ?? null;
    out.set(m[1], { st: getMethodSt(doc, rawXml, m[1]), decl });
  }
  return out;
}

function stripComments(s: string): string {
  s = s.replace(/\(\*[\s\S]*?\*\)/g, '');
  s = s.replace(/\/\/[^\r\n]*/g, '');
  return s;
}

function cleanCondition(s: string): string | null {
  if (!s || !s.trim()) return null;
  s = s.replace(/\s+/g, ' ').trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    let ok = true;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      if (depth === 0 && i < s.length - 1) {
        ok = false;
        break;
      }
    }
    if (!ok) break;
    s = s.substring(1, s.length - 1).trim();
  }
  return s;
}

function toLogicalLines(code: string): string[] {
  let flat = code.replace(/\s+/g, ' ').trim();
  flat = flat.replace(/\bTHEN\b/gi, 'THEN\n');
  flat = flat.replace(/;/g, ';\n');
  flat = flat.replace(/\bELSIF\b/gi, '\nELSIF');
  flat = flat.replace(/\bELSE\b/gi, '\nELSE');
  flat = flat.replace(/\bEND_IF\b/gi, '\nEND_IF\n');
  // A CASE / loop ends a statement too (it has no ";"), and its labels start one: the IF after them is on its own line
  flat = flat.replace(/\bOF\b/gi, 'OF\n');
  flat = flat.replace(/\bEND_(CASE|FOR|WHILE|REPEAT)\b\s*;?/gi, (m) => `\n${m}\n`);
  flat = flat.replace(/\b(DO)\b/gi, 'DO\n');
  const label = /^\s*((?:[A-Za-z_][\w.]*|\d+)(?:\s*(?:,|\.\.)\s*(?:[A-Za-z_][\w.]*|\d+))*)\s*:(?!=)\s*(\S.*)$/;
  return flat.split('\n').flatMap((l) => {
    const m = l.match(label);
    return m && !/^(IF|ELSIF|ELSE|CASE|FOR|WHILE|REPEAT|RETURN)$/i.test(m[1]) ? [`${m[1]}:`, m[2]] : [l];
  });
}

// A CASE label: MEMBER or E_Type.MEMBER (an enum with {attribute 'qualified_only'}), several separated by commas
const STATE_LABELS = STATE_LABELS_SRC;
/** "LABELS:" alone on the line (a trailing // comment allowed) */
const CASE_LABEL_LINE = new RegExp(`^\\s*(${STATE_LABELS})\\s*:(?!=)\\s*(\\/\\/.*)?$`);
/** "LABELS: code" on one line */
const CASE_LABEL_WITH_CODE = new RegExp(`^\\s*(${STATE_LABELS})\\s*:(?!=)\\s*(\\S.*)$`);

/**
 * A CASE label of states: E_Type.MEMBER, a member of the enum, or (without the enum) an upper-case name with "_"
 */
function looksLikeStateLabel(label: string, members?: Set<string>): boolean {
  for (const part of label.split(',')) {
    const raw = part.trim();
    if (/^[A-Za-z_]\w*\s*\.\s*[A-Za-z_]\w*$/.test(raw)) continue;
    const p = raw;
    if (members && members.has(p)) continue;
    if (p.length === 0 || !p.includes('_')) return false;
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      const isUpper = c >= 'A' && c <= 'Z';
      const isDigit = c >= '0' && c <= '9';
      if (!(isUpper || isDigit || c === '_')) return false;
    }
  }
  return true;
}

function isFullyParenthesized(s: string): boolean {
  if (!s.startsWith('(') || !s.endsWith(')')) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    if (depth === 0 && i < s.length - 1) {
      return false;
    }
  }
  return depth === 0;
}

function parenthesizeCondition(c: string): string {
  const trimmed = c.trim();
  if (!trimmed) return '';
  if (isFullyParenthesized(trimmed)) {
    return trimmed;
  }
  return `(${trimmed})`;
}

const snapshotFrames = (s: IfFrame[]): GuardFrame[] =>
  s.map((f) => ({ cond: f.currentCond, prior: f.negatedPriorConds.filter((c): c is string => !!c) }));

/** An ELSE's condition: none of the arms before it ("NOT (a OR b)") */
const elseOf = (f: IfFrame) => {
  const prior = f.negatedPriorConds.filter((c): c is string => !!c);
  return prior.length ? `NOT (${prior.join(' OR ')})` : 'else';
};

function buildGuard(s: IfFrame[]): string | null {
  if (s.length === 0) return null;
  if (s.length === 1) {
    // (a nested CASE's ELSE: what it is, its arms named; an IF's: "else", unless spelled out)
    return s[0].currentCond ?? (s[0].caseSel || spellElse ? elseOf(s[0]) : 'else');
  }
  const parts: string[] = [];
  for (const f of s) {
    if (f.currentCond === null) {
      // (a nested CASE's ELSE: what it is, its arms named; an IF's: "else", unless spelled out)
      parts.push(f.caseSel || spellElse ? elseOf(f) : 'else');
    } else {
      parts.push(parenthesizeCondition(f.currentCond));
    }
  }
  return parts.join(' AND ');
}

function buildResetGuard(s: IfFrame[], stateVarName: string): string | null {
  const nonScope = s.filter((f) => {
    if (f.currentCond === null) return true;
    return !new RegExp(`\\b(${stateVarName})\\b`, 'i').test(f.currentCond);
  });
  if (nonScope.length === 0) return null;
  return buildGuard(nonScope);
}

function parseStateDescriptions(st: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!st) return map;

  const code = stripComments(st);
  const lines = code.replace(/\r/g, '').split('\n');
  const assignRx = /getStateDescription\s*:=\s*'([^']*)'/i;

  let pendingLabels: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;

    // "LABEL:" then the assignment on the next line, or "LABEL: getStateDescription := '...';" on one line
    const lm = line.match(CASE_LABEL_LINE) || line.match(CASE_LABEL_WITH_CODE);
    const rest = lm && lm[2] && !lm[2].startsWith('//') ? lm[2] : line;
    if (lm) {
      pendingLabels = lm[1].split(',').map((p) => unqualifyState(p));
    }
    const am = rest.match(assignRx);
    if (am && pendingLabels.length > 0) {
      for (const lbl of pendingLabels) {
        map.set(lbl, am[1].trim());
      }
      pendingLabels = [];
    }
  }
  return map;
}

function preprocessDoStateLines(code: string): string[] {
  const rawLines = code.replace(/\r/g, '').split('\n');
  const result: string[] = [];
  let inCondition = false;
  let accumulated = '';

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;

    if (inCondition) {
      accumulated += ' ' + line;
      if (/\bTHEN\b/i.test(line)) {
        result.push(accumulated);
        accumulated = '';
        inCondition = false;
      }
      continue;
    }

    // "LABEL: code" on one line: the label and the code as two lines
    const labelled = line.match(CASE_LABEL_WITH_CODE);
    if (labelled && !/^(ELSE|THEN|DO|OF)$/i.test(labelled[1].trim()) && !labelled[2].startsWith('//')) {
      result.push(`${labelled[1]}:`);
      const rest = labelled[2];
      if (/^\s*(?:IF\b|ELSIF\b)/i.test(rest) && !/\bTHEN\b/i.test(rest)) {
        inCondition = true;
        accumulated = rest;
      } else {
        result.push(rest);
      }
      continue;
    }

    const startsIfOrElsif = /^\s*(?:IF\b|ELSIF\b)/i.test(line);
    const hasThen = /\bTHEN\b/i.test(line);

    if (startsIfOrElsif && !hasThen) {
      inCondition = true;
      accumulated = line;
      continue;
    }

    result.push(line);
  }

  if (accumulated) {
    result.push(accumulated);
  }

  return result;
}

function parseDoState(
  st: string,
  stateVarName: string,
  transitions: Transition[],
  states: Set<string>,
  members?: Set<string>
) {
  const code = stripComments(st);
  const lines = preprocessDoStateLines(code).flatMap(splitStatements);
  let currentStates: string[] = [];
  const statePriorityCounters = new Map<string, number>();
  const ifStack: IfFrame[] = [];
  const caseRx = CASE_LABEL_LINE;
  const assign = new RegExp(`\\b(${stateVarName})\\s*:=\\s*([A-Za-z_][A-Za-z0-9_\\.]*)`, 'g');
  const ifRx = /^\s*IF\b(.*?)\bTHEN\b/i;
  const elsifRx = /^\s*ELSIF\b(.*?)\bTHEN\b/i;
  const elseRx = /^\s*ELSE\b/i;
  const endIfRx = /^\s*END_IF\b/i;

  // Only the outer CASE's labels are states: a CASE nested in a state's branch has labels of its own
  let caseDepth = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (/^CASE\b[\s\S]*\bOF\b/i.test(line)) {
      caseDepth++;
      // A CASE in a state's branch: its arms guard what is under them, as an IF's ("iStep = 1")
      const sel = caseDepth >= 2 && currentStates.length ? caseSelectorOf(line) : null;
      if (sel) ifStack.push({ currentCond: null, negatedPriorConds: [], id: ++ifSeq, caseSel: sel, armed: false });
      continue;
    }
    if (/^END_CASE\b/i.test(line)) {
      if (caseDepth >= 2) {
        const at = ifStack.map((f) => !!f.caseSel).lastIndexOf(true);
        if (at >= 0) ifStack.length = at;
      }
      caseDepth = Math.max(0, caseDepth - 1);
      continue;
    }
    const top = ifStack[ifStack.length - 1];
    if (caseDepth >= 2 && top?.caseSel) {
      const labels = caseLabelOf(line);
      if (labels) {
        if (top.armed) top.negatedPriorConds.push(top.currentCond);
        top.currentCond = caseArmCondition(top.caseSel, labels);
        top.armed = true;
        continue;
      }
    }

    const cm = line.match(caseRx);
    if (cm && caseDepth <= 1 && looksLikeStateLabel(cm[1], members)) {
      currentStates = [];
      for (const lbl of cm[1].split(',').map((s) => unqualifyState(s))) {
        currentStates.push(lbl);
        states.add(lbl);
        statePriorityCounters.set(lbl, 0);
      }
      ifStack.length = 0;
      continue;
    }

    const mIf = line.match(ifRx);
    if (mIf) {
      ifStack.push({
        currentCond: cleanCondition(mIf[1]),
        negatedPriorConds: [],
        id: ++ifSeq,
      });
    } else {
      const mEl = line.match(elsifRx);
      if (mEl && ifStack.length > 0) {
        const t = ifStack.pop()!;
        t.negatedPriorConds.push(t.currentCond);
        t.currentCond = cleanCondition(mEl[1]);
        ifStack.push(t);
      } else if (elseRx.test(line) && ifStack.length > 0) {
        const t = ifStack.pop()!;
        t.negatedPriorConds.push(t.currentCond);
        t.currentCond = null;
        ifStack.push(t);
      } else if (endIfRx.test(line) && ifStack.length > 0) {
        ifStack.pop();
      }
    }

    let match: RegExpExecArray | null;
    assign.lastIndex = 0;
    while ((match = assign.exec(line)) !== null) {
      const target = unqualifyState(match[2]);
      for (const currentState of currentStates) {
        if (target === currentState) continue;
        states.add(target);
        const guard = buildGuard(ifStack);
        const currentPrio = (statePriorityCounters.get(currentState) ?? 0) + 1;
        statePriorityCounters.set(currentState, currentPrio);

        transitions.push({
          from: currentState,
          to: target,
          guard,
          frames: snapshotFrames(ifStack),
          priority: currentPrio,
          // (its top-level IF and arm: a choice)
          choice: ifStack.length && ifStack[0].id ? { id: ifStack[0].id, arm: ifStack[0].negatedPriorConds.length } : undefined,
          source: 'doState',
          effectiveFrom: currentState,
          effectiveTo: target,
        });
      }
    }
  }
}

function parsePreProcess(
  st: string,
  stateVarName: string,
  transitions: Transition[],
  states: Set<string>
) {
  const code = stripComments(st);
  const lines = toLogicalLines(code);
  const ifStack: IfFrame[] = [];
  // (its transitions' priorities: their order in preProcess(), as its Earlier / Later moves them)
  let order = 0;
  const ifRx = /^\s*IF\b(.*?)\bTHEN\b/i;
  const elsifRx = /^\s*ELSIF\b(.*?)\bTHEN\b/i;
  const elseRx = /^\s*ELSE\b/i;
  const endIfRx = /^\s*END_IF\b/i;
  const assign = new RegExp(`\\b(${stateVarName})\\s*:=\\s*([A-Za-z_][A-Za-z0-9_\\.]*)`, 'g');
  const lowerRx = new RegExp(`\\b(${stateVarName})\\s*(>=|>)\\s*([A-Za-z_][A-Za-z0-9_.]*)`, 'i');
  const upperRx = new RegExp(`\\b(${stateVarName})\\s*(<=|<)\\s*([A-Za-z_][A-Za-z0-9_.]*)`, 'i');
  const Any = 'AnyState';

  let pendingLower: string | null = null;
  let pendingUpper: string | null = null;
  let pendingLowerStrict = false;
  let pendingUpperStrict = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;

    const mIf = line.match(ifRx);
    if (mIf) {
      ifStack.push({
        currentCond: cleanCondition(mIf[1]),
        negatedPriorConds: [],
        id: ++ifSeq,
      });
    } else {
      const mEl = line.match(elsifRx);
      if (mEl && ifStack.length > 0) {
        const t = ifStack.pop()!;
        t.negatedPriorConds.push(t.currentCond);
        t.currentCond = cleanCondition(mEl[1]);
        ifStack.push(t);
      } else if (elseRx.test(line) && ifStack.length > 0) {
        const t = ifStack.pop()!;
        t.negatedPriorConds.push(t.currentCond);
        t.currentCond = null;
        ifStack.push(t);
      } else if (endIfRx.test(line) && ifStack.length > 0) {
        ifStack.pop();
      }
    }

    const lo = line.match(lowerRx);
    if (lo) {
      pendingLower = unqualifyState(lo[3]);
      pendingLowerStrict = lo[2] === '>';
    }
    const hi = line.match(upperRx);
    if (hi) {
      pendingUpper = unqualifyState(hi[3]);
      pendingUpperStrict = hi[2] === '<';
    }

    let am: RegExpExecArray | null;
    assign.lastIndex = 0;
    while ((am = assign.exec(line)) !== null) {
      const target = unqualifyState(am[2]);
      states.add(target);
      states.add(Any);
      const tr: Transition = {
        from: Any,
        to: target,
        guard: buildResetGuard(ifStack, stateVarName),
        frames: snapshotFrames(ifStack),
        priority: ++order,
        source: 'preProcess',
        scopeLower: pendingLower,
        scopeUpper: pendingUpper,
        scopeLowerStrict: pendingLowerStrict,
        scopeUpperStrict: pendingUpperStrict,
        effectiveFrom: Any,
        effectiveTo: target,
      };
      transitions.push(tr);
      pendingLower = null;
      pendingUpper = null;
    }
  }
}

function normalizeGuid(g: string | null): string {
  if (!g) return '';
  return g.trim().replace(/^\{+|\}+$/g, '').toLowerCase();
}

function shortenCompositeName(name: string): string {
  const trimmed = name.replace(/_SEQUENCE$/, '');
  const parts = trimmed.split('_');
  const core = parts.length >= 3 ? parts.slice(2).join('_') : trimmed;
  const pieces = core
    .split('_')
    .filter((p) => p.length > 0)
    .map((p) => p[0].toUpperCase() + p.substring(1).toLowerCase());
  return pieces.join('');
}

function readStringValueFromElement(el: Element, attrName: string): string | null {
  const vList = Array.from(el.getElementsByTagName('v'));
  const target = vList.find((v) => v.getAttribute('n') === attrName);
  if (!target) return null;
  let s = target.textContent?.trim();
  if (!s) return null;
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.substring(1, s.length - 1);
  }
  return s;
}

function tryLoadUmlGrouping(doc: Document | null): GroupingResult | null {
  if (!doc) return null;
  const methods = Array.from(doc.getElementsByTagName('Method'));
  const uml = methods.find((m) => m.getAttribute('Name') === 'doState_UmlSC');
  if (!uml) return null;

  const data = Array.from(uml.getElementsByTagName('Data'))[0];
  if (!data) return null;

  const result: GroupingResult = {
    groups: new Map(),
    stateToGroup: new Map(),
    groupFirstState: new Map(),
    groupLastState: new Map(),
    compositeToId: new Map(),
    groupParent: new Map(),
    enumOrder: [],
  };

  const composites = new Map<string, UmlComposite>();
  const compositesByObject = new Map<string, UmlComposite>();
  const elemToArea = new Map<string, string>();

  const oElements = Array.from(data.getElementsByTagName('o'));
  for (const o of oElements) {
    const typ = o.getAttribute('t');
    if (typ === 'UMLStateChartComposite') {
      const name = readStringValueFromElement(o, 'ElementName');
      if (!name) continue;
      const objectGuid = normalizeGuid(readStringValueFromElement(o, 'ElementObjectGuid'));
      const containerGuid = normalizeGuid(readStringValueFromElement(o, 'ContainerGuid'));
      const comp: UmlComposite = {
        displayName: shortenCompositeName(name),
        fullName: name,
        objectGuid,
        containerGuid,
      };
      if (objectGuid) compositesByObject.set(objectGuid, comp);

      const l = Array.from(o.children).find((c) => c.tagName === 'l');
      if (!l) continue;
      const areaList = Array.from(l.children).filter((c) => c.tagName === 'o');
      for (const area of areaList) {
        const vList = Array.from(area.children).filter((c) => c.tagName === 'v');
        const guidV = vList.find((v) => v.getAttribute('n') === 'Elementguid');
        const areaGuid = guidV?.textContent?.trim();
        if (areaGuid) {
          composites.set(normalizeGuid(areaGuid), comp);
        }
      }
    } else if (typ === 'UMLStateChartElement') {
      const name = readStringValueFromElement(o, 'ElementName');
      const area = readStringValueFromElement(o, 'Area');
      if (!name || !area) continue;
      elemToArea.set(name, normalizeGuid(area));
    }
  }

  if (composites.size === 0) return null;

  for (const [state, area] of elemToArea.entries()) {
    const comp = composites.get(area);
    if (comp) {
      let list = result.groups.get(comp.displayName);
      if (!list) {
        list = [];
        result.groups.set(comp.displayName, list);
      }
      list.push(state);
      result.stateToGroup.set(state, comp.displayName);
      if (!result.groupFirstState.has(comp.displayName)) {
        result.groupFirstState.set(comp.displayName, state);
      }
    }
  }

  const RootGuid = '00000000-0000-0000-0000-000000000000';
  const uniqueComps = Array.from(new Set(compositesByObject.values()));
  for (const comp of uniqueComps) {
    if (!comp.containerGuid || comp.containerGuid === RootGuid) continue;
    const parent = compositesByObject.get(comp.containerGuid);
    if (parent && parent.displayName !== comp.displayName) {
      result.groupParent.set(comp.displayName, parent.displayName);
    }
  }

  const uniqueAllComps = Array.from(new Set(composites.values()));
  for (const comp of uniqueAllComps) {
    if (comp.fullName) {
      result.compositeToId.set(comp.fullName, comp.displayName);
    }
  }

  return result.groups.size > 0 ? result : null;
}

// A choice diamond's label: an empty box of a set size (index.css: .kss-choice-pad), so the diamond is big enough to
// see and grab, the same size everywhere (a bare space draws a tiny one; a blank character's width depends on the font)
const CHOICE_LABEL = "<span class='kss-choice-pad'></span>";

export function extractDeclaration(tcDutContent: string): string | null {
  const doc = parseXmlDoc(tcDutContent);
  if (doc) {
    const decls = Array.from(doc.getElementsByTagName('Declaration'));
    if (decls.length > 0 && decls[0].textContent) {
      return decls[0].textContent;
    }
  }
  const m = tcDutContent.match(/<Declaration[^>]*>([\s\S]*?)<\/Declaration>/i);
  if (m) {
    const cdata = m[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
    return cdata ? cdata[1] : m[1];
  }
  return tcDutContent;
}

export function readEnumOrder(decl: string | null): string[] {
  const order: string[] = [];
  if (!decl) return order;

  const typeIdx = decl.search(/\bTYPE\b/i);
  const openParen = decl.indexOf('(', Math.max(0, typeIdx));
  const closeParen = decl.lastIndexOf(')');
  if (openParen < 0 || closeParen < 0 || closeParen <= openParen) return order;

  const body = decl.substring(openParen + 1, closeParen);
  const lines = body.replace(/\r/g, '').split('\n');

  for (const raw of lines) {
    let line = raw.trim();
    if (line.startsWith(',')) line = line.substring(1).trim();
    if (line.endsWith(',')) line = line.substring(0, line.length - 1).trim();
    if (line.length === 0) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    if (m) order.push(m[1]);
  }
  return order;
}

function deriveGroupName(cluster: string[]): string | null {
  if (cluster.length === 0) return null;
  const tokLists = cluster.map((s) => s.split('_'));
  const minLen = Math.min(...tokLists.map((t) => t.length));
  let common = 0;
  for (let i = 0; i < minLen; i++) {
    const t = tokLists[0][i];
    if (tokLists.every((x) => x[i] === t)) common++;
    else break;
  }
  if (common < 1) return null;

  const skip = Math.min(2, common);
  let significant = tokLists[0].slice(skip, common);
  if (significant.length === 0) {
    if (common < minLen) significant = [tokLists[0][common]];
    else significant = [tokLists[0][common - 1]];
  }
  return significant
    .map((p) => (p.length === 0 ? '' : p[0].toUpperCase() + p.substring(1).toLowerCase()))
    .join('');
}

function deriveEnabledCompositeName(decl: string, typeIdx: number, order: string[]): string {
  const tm = decl.substring(Math.max(0, typeIdx)).match(/\bTYPE\s+([A-Za-z_][A-Za-z0-9_]*)/i);
  if (tm) {
    let typeName = tm[1];
    typeName = typeName.replace(/^E_/i, '');
    typeName = typeName.replace(/_States?$/i, '');
    typeName = typeName.replace(/^_+|_+$/g, '');
    if (typeName.length > 0) return typeName + 'Enabled';
  }
  const derived = deriveGroupName(order);
  return (derived ?? 'Machine') + 'Enabled';
}

/**
 * The enum's regions put in the grouping: each a composite holding its members, inside the composite its first
 * member was in (or its enclosing region)
 */
function applyEnumRegions(groups: GroupingResult, regions: GroupingResult | null) {
  if (!regions) return;
  for (const [name, members] of regions.groups) {
    let id = name;
    while (groups.groups.has(id) && !regions.groups.has(id)) id = `${id}_`;
    const enclosing = regions.groupParent.get(name) ?? (members[0] ? groups.stateToGroup.get(members[0]) : undefined);
    for (const m of members) {
      const old = groups.stateToGroup.get(m);
      if (old && old !== id) {
        const list = groups.groups.get(old);
        if (list) groups.groups.set(old, list.filter((x) => x !== m));
      }
      groups.stateToGroup.set(m, id);
    }
    groups.groups.set(id, [...members]);
    if (members[0]) groups.groupFirstState.set(id, members[0]);
    if (enclosing && enclosing !== id) groups.groupParent.set(id, enclosing);
  }
  // A composite left without members keeps its first state only when it still holds it
  for (const [g, list] of groups.groups) {
    const first = groups.groupFirstState.get(g);
    if (first && !list.includes(first)) {
      if (list[0]) groups.groupFirstState.set(g, list[0]);
      else groups.groupFirstState.delete(g);
    }
  }
}

/**
 * Composites from {region "Name"} … {endregion} pragmas around the enum's members (the canvas editor writes them);
 * a region inside a region is a composite inside a composite. null: the enum has none.
 */
function loadEnumRegions(decl: string | null): GroupingResult | null {
  if (!decl || !/\{\s*region\b/i.test(decl)) return null;
  const typeIdx = decl.search(/\bTYPE\b/i);
  const openParen = decl.indexOf('(', Math.max(0, typeIdx));
  const closeParen = decl.lastIndexOf(')');
  if (openParen < 0 || closeParen <= openParen) return null;
  const result: GroupingResult = {
    groups: new Map(),
    stateToGroup: new Map(),
    groupFirstState: new Map(),
    groupLastState: new Map(),
    compositeToId: new Map(),
    groupParent: new Map(),
    enumOrder: [],
  };
  const stack: string[] = [];
  const body = decl.substring(openParen + 1, closeParen).replace(/\(\*[\s\S]*?\*\)/g, '').replace(/\r/g, '');
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    const region = line.match(/^\{\s*region\b\s*(?:"([^"]*)"|'([^']*)'|([^}]*?))\s*\}/i);
    if (region) {
      let name = (region[1] ?? region[2] ?? region[3] ?? '').trim() || `Composite${result.groups.size + 1}`;
      while (result.groups.has(name)) name = `${name}_`;
      result.groups.set(name, []);
      if (stack.length) result.groupParent.set(name, stack[stack.length - 1]);
      stack.push(name);
      continue;
    }
    if (/^\{\s*endregion\b/i.test(line)) {
      stack.pop();
      continue;
    }
    const m = line.replace(/^,/, '').trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    if (!m || !stack.length) continue;
    const g = stack[stack.length - 1];
    result.groups.get(g)!.push(m[1]);
    result.stateToGroup.set(m[1], g);
    if (!result.groupFirstState.has(g)) result.groupFirstState.set(g, m[1]);
  }
  return result.groups.size ? result : null;
}

/** The state variable's initial value in the POU's own declaration ("machineState : E_X := E_X.IDLE;") */
function declaredInitialState(pouXml: string, stateVarName: string): string | null {
  const own = pouXml.match(/<POU\b[^>]*>\s*<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>/i);
  if (!own) return null;
  const code = own[1].replace(/\(\*[\s\S]*?\*\)/g, '').replace(/\/\/.*$/gm, '');
  const m = code.match(new RegExp(`^\\s*${stateVarName}\\s*:\\s*[A-Za-z_][\\w.]*\\s*:=\\s*(?:[A-Za-z_]\\w*\\s*\\.\\s*)?([A-Za-z_]\\w*)\\s*;`, 'im'));
  return m ? m[1] : null;
}

/** The state variable set in initialize() (a variable inherited from the base FB): "machineState := IDLE;" */
function initializedState(st: string | null, stateVarName: string): string | null {
  if (!st) return null;
  const code = stripComments(st);
  const m = code.match(new RegExp(`^\\s*${stateVarName}\\s*:=\\s*(?:[A-Za-z_]\\w*\\s*\\.\\s*)?([A-Za-z_]\\w*)\\s*;`, 'im'));
  return m ? m[1] : null;
}

export interface ParallelRegion {
  /** The state whose branch holds the region */
  parent: string;
  /** The region's state variable (of the enum's type) */
  variable: string;
  states: string[];
  /** Set in the parent's branch before the region's CASE (on entry) */
  start: string | null;
  finals: string[];
  transitions: { from: string; to: string; guard: string | null }[];
  /** A sub-machine's (a method's state machine): its states' names as drawn (their ids: <state>__<method>__<name>) */
  labels?: Record<string, string>;
  /** Its title (flowchart: the subgraph's) */
  title?: string;
  /** When it starts (its entry's label) */
  entry?: string | null;
  /** Its states nothing goes to: drawn dashed, "never reached" */
  unreachable?: string[];
  /** A sub-machine's: its method (its box's header, the box's id <state>__<method>) and when it runs (under it) */
  subMachine?: { method: string; when: string | null };
}

/**
 * Parallel regions (the canvas' Fork / Join writes them): in a state's branch of doState(), a CASE on another
 * variable whose labels are members of the enum. Its states, its transitions ("<variable> := X" under a label),
 * where it starts (the variable set before its CASE) and its final states ("(* final *)" on a label).
 */
export function parseParallelRegions(st: string | null, stateVarName: string, members: Set<string>): Map<string, ParallelRegion[]> {
  const out = new Map<string, ParallelRegion[]>();
  if (!st || members.size === 0) return out;
  const own = (v: string) => v.split('.').pop()!.replace(/^THIS\^$/i, '');
  const labelRx = /^((?:[A-Za-z_][\w.]*\s*,\s*)*[A-Za-z_][\w.]*)\s*:(?!=)/;
  let depth = 0;
  let parent: string | null = null;
  let region: ParallelRegion | null = null;
  let regionDepth = 0;
  let current: string | null = null;
  const ifs: string[] = [];
  const starts = new Map<string, string>();
  for (const raw of stripComments(st).split(/\r?\n/).map((l, i) => ({ code: l, raw: st.split(/\r?\n/)[i] ?? '' }))) {
    const line = raw.code.trim();
    if (!line) continue;
    const caseM = line.match(/^CASE\s*\(?\s*([A-Za-z_][\w.]*)\s*\)?\s*OF\b/i);
    if (caseM) {
      depth++;
      if (depth === 2 && parent && own(caseM[1]) !== own(stateVarName)) {
        region = { parent, variable: caseM[1], states: [], start: starts.get(caseM[1]) ?? null, finals: [], transitions: [] };
        regionDepth = depth;
        current = null;
        ifs.length = 0;
      }
      continue;
    }
    if (/^END_CASE\b/i.test(line)) {
      if (region && depth === regionDepth) {
        if (region.states.length) out.set(region.parent, [...(out.get(region.parent) ?? []), region]);
        region = null;
        current = null;
      }
      depth = Math.max(0, depth - 1);
      continue;
    }
    const lab = line.match(labelRx);
    if (lab && !/^(ELSE|ELSIF|IF|END_\w+|THEN)\b/i.test(line)) {
      const names = lab[1].split(',').map((n) => unqualifyState(n.trim()));
      if (depth === 1) {
        parent = names[0];
        starts.clear();
        continue;
      }
      if (region && depth === regionDepth && names.every((n) => members.has(n))) {
        current = names[0];
        region.states.push(...names);
        ifs.length = 0;
        if (/\(\*\s*final\s*\*\)/i.test(raw.raw)) region.finals.push(...names);
        continue;
      }
    }
    // The conditions around an assignment in a region's state
    let closes = 0;
    if (region && current) {
      const mIf = line.match(/^IF\b(.*?)\bTHEN\b/i);
      const mEl = line.match(/^ELSIF\b(.*?)\bTHEN\b/i);
      if (mIf) ifs.push(cleanCondition(mIf[1]) ?? mIf[1].trim());
      else if (mEl && ifs.length) ifs[ifs.length - 1] = cleanCondition(mEl[1]) ?? mEl[1].trim();
      else if (/^ELSE\b/i.test(line) && ifs.length) ifs[ifs.length - 1] = `NOT (${ifs[ifs.length - 1]})`;
      closes = (line.match(/\bEND_IF\b/gi) ?? []).length;
      if (/^END_IF\b/i.test(line)) {
        ifs.pop();
        closes--;
      }
    }
    for (const a of line.matchAll(/\b([A-Za-z_][\w.]*)\s*:=\s*([A-Za-z_][\w.]*)/g)) {
      const target = unqualifyState(a[2]);
      if (!members.has(target) || own(a[1]) === own(stateVarName)) continue;
      if (region && current && a[1] === region.variable) {
        if (target !== current) region.transitions.push({ from: current, to: target, guard: ifs.length ? ifs.join(' AND ') : null });
      } else if (!region && parent && depth === 1 && !starts.has(a[1])) starts.set(a[1], target);
    }
    // (IF … END_IF on one line)
    for (; closes > 0 && ifs.length; closes--) ifs.pop();
  }
  return out;
}

/** Members marked in the enum: "// @initial" / "// @final" (or in (* … *)) on their line */
export function enumStateMarks(decl: string | null): { initial: string[]; final: string[] } {
  const marks = { initial: [] as string[], final: [] as string[] };
  if (!decl) return marks;
  const typeIdx = decl.search(/\bTYPE\b/i);
  const open = decl.indexOf('(', Math.max(0, typeIdx));
  const close = decl.lastIndexOf(')');
  if (open < 0 || close <= open) return marks;
  for (const line of decl.substring(open + 1, close).split(/\r?\n/)) {
    const comment = [...line.matchAll(/\/\/(.*)$|\(\*([\s\S]*?)\*\)/g)].map((m) => m[1] ?? m[2] ?? '').join(' ');
    const member = line.replace(/\(\*[\s\S]*?\*\)/g, '').replace(/\/\/.*$/, '').replace(/\{[^}]*\}/g, '').replace(/^\s*,/, '').match(/^\s*([A-Za-z_]\w*)/)?.[1];
    if (!member) continue;
    if (/@initial\b/i.test(comment)) marks.initial.push(member);
    if (/@final\b/i.test(comment)) marks.final.push(member);
  }
  return marks;
}

/** Final states: "(* final *)" on their CASE label in doState() */
function finalStatesOf(doStateSt: string | null): Set<string> {
  const finals = new Set<string>();
  for (const line of (doStateSt ?? '').split(/\r?\n/)) {
    const m = line.match(/^\s*((?:[A-Za-z_][\w.]*\s*,\s*)*[A-Za-z_][\w.]*)\s*:(?!=)\s*\(\*\s*final\s*\*\)/i);
    if (m) for (const n of m[1].split(',')) finals.add(unqualifyState(n.trim()));
  }
  return finals;
}

function loadEnumGrouping(decl: string | null): GroupingResult | null {
  if (!decl) return null;
  const order = readEnumOrder(decl);
  if (order.length === 0) return null;

  const result: GroupingResult = {
    groups: new Map(),
    stateToGroup: new Map(),
    groupFirstState: new Map(),
    groupLastState: new Map(),
    compositeToId: new Map(),
    groupParent: new Map(),
    enumOrder: order,
  };

  const enablingIdx = order.findIndex((s) => s.endsWith('ENABLING'));
  if (enablingIdx >= 0 && enablingIdx + 1 < order.length) {
    const typeIdx = decl.search(/\bTYPE\b/i);
    const compositeName = deriveEnabledCompositeName(decl, typeIdx, order);
    const members: string[] = [];
    result.groups.set(compositeName, members);
    for (let i = enablingIdx + 1; i < order.length; i++) {
      const s = order[i];
      members.push(s);
      result.stateToGroup.set(s, compositeName);
      if (!result.groupFirstState.has(compositeName)) {
        result.groupFirstState.set(compositeName, s);
      }
    }
    return result;
  }

  const groupName = deriveGroupName(order) ?? 'States';
  const members: string[] = [];
  result.groups.set(groupName, members);
  for (const s of order) {
    members.push(s);
    result.stateToGroup.set(s, groupName);
    if (!result.groupFirstState.has(groupName)) {
      result.groupFirstState.set(groupName, s);
    }
  }
  return result;
}

function reorderGroupsByEnum(groups: GroupingResult, enumOrder: string[]) {
  if (groups.groups.size === 0 || enumOrder.length === 0) return;
  const orderMap = new Map<string, number>();
  enumOrder.forEach((val, idx) => orderMap.set(val, idx));

  for (const [key, members] of groups.groups.entries()) {
    members.sort((a, b) => {
      const oa = orderMap.has(a) ? orderMap.get(a)! : Number.MAX_SAFE_INTEGER;
      const ob = orderMap.has(b) ? orderMap.get(b)! : Number.MAX_SAFE_INTEGER;
      return oa - ob;
    });
    if (members.length > 0) {
      groups.groupFirstState.set(key, members[0]);
      groups.groupLastState.set(key, members[members.length - 1]);
    }
  }
}

function applyEnumConventions(groups: GroupingResult, enumOrder: string[]) {
  if (enumOrder.length === 0) return;
  groups.enumOrder = enumOrder;
  groups.machineStartState = enumOrder[0];
}

function isDescendantGroup(candidate: string | undefined, ancestor: string, groups: GroupingResult): boolean {
  if (!candidate || !ancestor) return false;
  let cur: string | undefined = candidate;
  let guard = 0;
  while (cur && guard++ < 100) {
    if (cur === ancestor) return true;
    cur = groups.groupParent.get(cur);
    if (!cur || !groups.groups.has(cur)) break;
  }
  return false;
}

function isSameOrDescendantGroup(candidate: string, ancestor: string, groups: GroupingResult): boolean {
  return candidate === ancestor || isDescendantGroup(candidate, ancestor, groups);
}

function lowestCommonAncestor(a: string, b: string, groups: GroupingResult): string | null {
  if (a === b) return a;
  const chainA: string[] = [];
  let cur: string | undefined = a;
  while (cur) {
    chainA.push(cur);
    const p = groups.groupParent.get(cur);
    cur = p && groups.groups.has(p) ? p : undefined;
  }
  const setA = new Set(chainA);

  cur = b;
  while (cur) {
    if (setA.has(cur)) return cur;
    const p = groups.groupParent.get(cur);
    cur = p && groups.groups.has(p) ? p : undefined;
  }
  return null;
}

function resolveScopeComposite(t: Transition, groups: GroupingResult): string | null {
  const order = groups.enumOrder;
  // (no range checked: a transition from any state)
  if (order.length === 0 || (t.scopeLower == null && t.scopeUpper == null)) return null;
  const lo = t.scopeLower == null ? 0 : order.indexOf(t.scopeLower) + (t.scopeLowerStrict ? 1 : 0);
  const hi = t.scopeUpper == null ? order.length - 1 : order.indexOf(t.scopeUpper) - (t.scopeUpperStrict ? 1 : 0);
  if ((t.scopeLower != null && order.indexOf(t.scopeLower) < 0) || (t.scopeUpper != null && order.indexOf(t.scopeUpper) < 0) || hi < lo) return null;
  // The states the range checks (its target left out: "go to ERROR from any of these") are exactly a composite's,
  // its sub-composites' too
  const checked = order.slice(lo, hi + 1).filter((s) => s !== t.to);
  const inside = (g: string, s: string): boolean => {
    for (let x = groups.stateToGroup.get(s); x; x = groups.groupParent.get(x)) if (x === g) return true;
    return false;
  };
  for (const g of groups.groups.keys()) {
    const own = order.filter((s) => s !== t.to && inside(g, s));
    if (own.length && own.length === checked.length && own.every((s, i) => s === checked[i])) return g;
  }
  return null;
}

function nameLooksLikeError(state: string | null | undefined): boolean {
  if (!state) return false;
  const lower = state.toLowerCase();
  return lower.includes('error') || lower.includes('fault');
}

function determineCompositeStartStates(transitions: Transition[], groups: GroupingResult) {
  if (groups.groups.size === 0 || transitions.length === 0) return;

  const externalEntryCount = new Map<string, number>();

  for (const t of transitions) {
    if (!t.to) continue;
    const dstGroup = groups.stateToGroup.get(t.to);
    if (!dstGroup) continue;

    if (t.source === 'preProcess') continue;
    if (t.from === 'AnyState') continue;

    const srcGroup = groups.stateToGroup.get(t.from);
    const external = srcGroup !== dstGroup;
    if (!external) continue;

    if (isDescendantGroup(srcGroup, dstGroup, groups)) continue;

    externalEntryCount.set(t.to, (externalEntryCount.get(t.to) || 0) + 1);
  }

  for (const [gKey, members] of groups.groups.entries()) {
    let bestState: string | null = null;
    let bestCount = 0;
    for (const member of members) {
      if (nameLooksLikeError(member)) continue;
      const count = externalEntryCount.get(member) || 0;
      if (count > bestCount) {
        bestCount = count;
        bestState = member;
      }
    }
    if (bestState !== null) {
      groups.groupFirstState.set(gKey, bestState);
    }
  }
}

function topLevelComposite(group: string, groups: GroupingResult): string {
  let top = group;
  let guard = 0;
  while (top && guard++ < 100) {
    const p = groups.groupParent.get(top);
    if (p && groups.groups.has(p)) {
      top = p;
    } else {
      break;
    }
  }
  return top;
}

function removeStateFromGroup(state: string, groups: GroupingResult) {
  const group = groups.stateToGroup.get(state);
  if (!group) return;
  groups.stateToGroup.delete(state);

  const members = groups.groups.get(group);
  if (members) {
    const idx = members.indexOf(state);
    if (idx >= 0) members.splice(idx, 1);

    if (groups.groupFirstState.get(group) === state) {
      if (members.length > 0) groups.groupFirstState.set(group, members[0]);
      else groups.groupFirstState.delete(group);
    }
    if (groups.groupLastState.get(group) === state) {
      if (members.length > 0) groups.groupLastState.set(group, members[members.length - 1]);
      else groups.groupLastState.delete(group);
    }
  }
}

function collapseInternalEdgesToBorder(
  transitions: Transition[],
  error: string,
  composite: string,
  groups: GroupingResult
) {
  const borderSources = new Set<string>();
  // (the priorities of the transitions each collapsed edge stands for: it takes the first one checked)
  const collapsedPriorities = new Map<string, number[]>();
  const collapsedFrom = new Map<string, Transition[]>();
  const kept: Transition[] = [];

  for (const t of transitions) {
    const targetsError = t.to === error;
    const fromG = groups.stateToGroup.get(t.from);
    const fromInside = fromG ? isSameOrDescendantGroup(fromG, composite, groups) : false;

    if (targetsError && fromInside && t.from !== error) {
      const src = topLevelComposite(fromG!, groups);
      borderSources.add(src);
      if (t.priority != null && t.priority > 0) collapsedPriorities.set(src, [...(collapsedPriorities.get(src) ?? []), t.priority]);
      collapsedFrom.set(src, [...(collapsedFrom.get(src) ?? []), t]);
      continue;
    }
    kept.push(t);
  }

  transitions.length = 0;
  transitions.push(...kept);

  for (const src of borderSources) {
    const exists = transitions.some((t) => t.from === src && t.to === error);
    if (!exists) {
      // Its priority: the transitions' it stands for (several: the lowest, the first one TwinCAT checks), so its badge
      // shows as the composite's other edges' do
      const prios = collapsedPriorities.get(src) ?? [];
      transitions.push({
        from: src,
        to: error,
        guard: CollapsedEdgeWarningLabel,
        source: 'doState',
        effectiveFrom: src,
        effectiveTo: error,
        ...(prios.length ? { priority: Math.min(...prios) } : {}),
        collapsed: collapsedFrom.get(src) ?? [],
      });
    }
  }
}

/**
 * Collapse error-sink edges: an error state outside a composite that most of the composite's states go to (and that
 * does not lead back into it): their edges to it drawn as one, from the composite's border. The composites are the
 * enum's markers: a state inside one stays there
 */
function extractErrorSinkStates(
  transitions: Transition[],
  groups: GroupingResult,
  collapseErrorSinkEdges: boolean
) {
  if (!collapseErrorSinkEdges || groups.groups.size === 0 || transitions.length === 0) return;
  const tops = [...groups.groups.keys()].filter((g) => !groups.groupParent.has(g) || !groups.groups.has(groups.groupParent.get(g)!));
  const errors = new Set([...transitions.map((t) => t.to), ...transitions.map((t) => t.from)].filter((x): x is string => !!x && nameLooksLikeError(x)));
  for (const group of tops) {
    const inside = (st: string) => {
      const g = groups.stateToGroup.get(st);
      return !!g && isSameOrDescendantGroup(g, group, groups);
    };
    const members = [...groups.stateToGroup.keys()].filter(inside);
    if (!members.length) continue;
    for (const candidate of errors) {
      if (inside(candidate)) continue;
      const incoming = new Set(transitions.filter((t) => t.to === candidate && t.from && inside(t.from)).map((t) => t.from));
      const back = transitions.some((t) => t.from === candidate && inside(t.to));
      if (incoming.size > 1 && incoming.size * 2 >= members.length && !back) collapseInternalEdgesToBorder(transitions, candidate, group, groups);
    }
  }
}

function san(id: string | null | undefined): string {
  return (id ?? '').replace(/\./g, '_').replace(/-/g, '_');
}

function esc(l: string): string {
  if (!l) return '';
  return l.replace(/:/g, '\\:').replace(/\r\n|\r|\n/g, '<br/>');
}

function flowLabel(l: string): string {
  if (!l) return '';
  return l.replace(/\r\n|\r|\n/g, '<br/>').replace(/"/g, "'").replace(/#/g, '#35;');
}

function wrapDescription(desc: string, maxCharsPerLine: number = 26): string {
  if (!desc) return '';
  const parts = desc.split(/<br\s*\/?>/i);
  const allWrapped: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const words = trimmed.split(/\s+/);
    let cur = '';
    for (const w of words) {
      if (!cur) {
        cur = w;
      } else if ((cur + ' ' + w).length <= maxCharsPerLine) {
        cur += ' ' + w;
      } else {
        allWrapped.push(cur);
        cur = w;
      }
    }
    if (cur) allWrapped.push(cur);
  }
  return allWrapped.join('<br/>');
}

function flowNodeLabel(state: string, stateDescriptions?: Map<string, string>): string {
  if (stateDescriptions && stateDescriptions.has(state)) {
    const desc = stateDescriptions.get(state);
    if (desc) {
      const formattedDesc = wrapDescription(desc.replace(/"/g, "'"), 32);
      return `${state}<br/><span class='node-desc'>${formattedDesc}</span>`;
    }
  }
  return state;
}

/** Every state's regions (sub-machines' too: a sub-machine's state with one of its own), for the emitters below */
let allRegions: Map<string, ParallelRegion[]> = new Map();

/** A state with parallel regions, as a flowchart subgraph holding one subgraph per region */
function emitFlowchartRegions(lines: string[], indent: string, state: string, regions: ParallelRegion[], declared: Set<string>, stateDescriptions?: Map<string, string>, title?: string) {
  lines.push(`${indent}subgraph ${san(state)}["${title ?? flowNodeLabel(state, stateDescriptions)}"]`);
  for (const r of regions) {
    const rid = r.subMachine ? `${san(state)}__${san(r.subMachine.method)}` : `${san(state)}__${san(r.variable)}`;
    const inner = `${indent}        `;
    if (r.subMachine) lines.push(`${indent}    %% sub-machine ${san(state)} ${san(r.subMachine.method)}`);
    lines.push(`${indent}    subgraph ${rid}["${r.subMachine ? subMachineHeader(r.subMachine) : r.title ?? r.variable}"]`);
    for (const s of r.states) {
      const name = r.labels?.[s];
      const own = allRegions.get(s);
      if (own && name) {
        emitFlowchartRegions(lines, inner, s, own, declared, stateDescriptions, name);
        continue;
      }
      lines.push(`${inner}${san(s)}["${name ? `${name}${r.unreachable?.includes(s) ? "<br/><span class='node-desc'>never reached</span>" : ''}` : flowNodeLabel(s, stateDescriptions)}"]`);
      declared.add(s);
    }
    for (const s of r.unreachable ?? []) if (!allRegions.has(s)) lines.push(`${inner}class ${san(s)} kssUnreachable`);
    if (r.start) lines.push(`${inner}startNode_${rid}((" ")) -->${r.entry ? `|"${flowLabel(r.entry)}"|` : ''} ${san(r.start)}`);
    for (const t of r.transitions) lines.push(`${inner}${san(t.from)} -->${t.guard ? `|"${flowLabel(t.guard)}"|` : ''} ${san(t.to)}`);
    for (const f of r.finals) lines.push(`${inner}${san(f)} --> endNode_${rid}(((" ")))`);
    lines.push(`${indent}    end`);
  }
  lines.push(`${indent}end`);
  declared.add(state);
}

/** A state with parallel regions, as a stateDiagram composite with "--" between the regions */
function emitStateRegions(lines: string[], indent: string, state: string, regions: ParallelRegion[], stateDescriptions?: Map<string, string>, title?: string) {
  const desc = stateDescriptions?.get(state);
  const label = title ?? (desc ? `${state}<br/><span class='node-desc'>${wrapDescription(desc.replace(/"/g, "'"), 32)}</span>` : state);
  lines.push(`${indent}state "${label}" as ${san(state)} {`);
  regions.forEach((r, i) => {
    let inner = `${indent}    `;
    if (i > 0) lines.push(`${inner}--`);
    if (r.subMachine) {
      lines.push(`${inner}%% sub-machine ${san(state)} ${san(r.subMachine.method)}`);
      lines.push(`${inner}state "${subMachineHeader(r.subMachine)}" as ${san(state)}__${san(r.subMachine.method)} {`);
      inner += '    ';
    }
    if (r.start) lines.push(`${inner}[*] --> ${san(r.start)}${r.entry ? `: ${esc(r.entry)}` : ''}`);
    for (const s of r.states) {
      const name = r.labels?.[s];
      const own = allRegions.get(s);
      if (own && name) emitStateRegions(lines, inner, s, own, stateDescriptions, name);
      else if (!name) lines.push(`${inner}${san(s)}`);
      else lines.push(`${inner}state "${name}${r.unreachable?.includes(s) ? "<br/><span class='node-desc'>never reached</span>" : ''}" as ${san(s)}`);
    }
    for (const s of r.unreachable ?? []) if (!allRegions.has(s)) lines.push(`${inner}class ${san(s)} kssUnreachable`);
    for (const t of r.transitions) lines.push(`${inner}${san(t.from)} --> ${san(t.to)}${t.guard ? `: ${esc(t.guard)}` : ''}`);
    for (const f of r.finals) lines.push(`${inner}${san(f)} --> [*]`);
    if (r.subMachine) lines.push(`${indent}    }`);
  });
  lines.push(`${indent}}`);
}

/** A sub-machine's box header: its method; when it runs (the IFs around its call) under it */
function subMachineHeader(sub: { method: string; when: string | null }) {
  return sub.when ? `${sub.method}<br/><span class='node-desc'>${wrapDescription(`while ${sub.when}`.replace(/"/g, "'"), 32)}</span>` : sub.method;
}

function emitFlowchartSubgraph(
  lines: string[],
  gname: string,
  groups: GroupingResult,
  childGroups: Map<string, string[]>,
  depth: number,
  declared: Set<string>,
  stateDescriptions?: Map<string, string>,
  regions: Map<string, ParallelRegion[]> = new Map(),
  choicesOf: Map<string, string[]> = new Map()
) {
  const indent = ' '.repeat(depth * 4);
  const bodyIndent = ' '.repeat((depth + 1) * 4);
  const gid = san(gname);

  lines.push(`${indent}subgraph ${gid}["${gname}"]`);

  const members = groups.groups.get(gname);
  if (members) {
    for (const s of members) {
      if (declared.has(s)) continue;
      const own = regions.get(s);
      if (own) emitFlowchartRegions(lines, bodyIndent, s, own, declared, stateDescriptions);
      else lines.push(`${bodyIndent}${san(s)}["${flowNodeLabel(s, stateDescriptions)}"]`);
      for (const c of choicesOf.get(s) ?? []) lines.push(`${bodyIndent}${c}{"${CHOICE_LABEL}"}`);
      declared.add(s);
    }
  }

  const first = groups.groupFirstState.get(gname);
  if (first && groups.markedInitial?.has(gname) && declared.has(first)) lines.push(`${bodyIndent}startNode_${gid}((" ")) --> ${san(first)}`);
  for (const f of groups.groupFinals?.get(gname) ?? []) if (declared.has(f)) lines.push(`${bodyIndent}${san(f)} --> endNode_${gid}(((" ")))`);

  const kids = childGroups.get(gname);
  if (kids) {
    const sortedKids = [...kids].sort();
    for (const child of sortedKids) {
      emitFlowchartSubgraph(lines, child, groups, childGroups, depth + 1, declared, stateDescriptions, regions, choicesOf);
    }
  }

  lines.push(`${indent}end`);
}

function emitComposite(
  lines: string[],
  gname: string,
  groups: GroupingResult,
  childGroups: Map<string, string[]>,
  depth: number,
  exitStates: Set<string>,
  stateDescriptions?: Map<string, string>,
  regions: Map<string, ParallelRegion[]> = new Map(),
  choicesOf: Map<string, string[]> = new Map()
) {
  const indent = ' '.repeat(depth * 4);
  const bodyIndent = ' '.repeat((depth + 1) * 4);
  const gid = san(gname);

  lines.push(`${indent}state "${gname}" as ${gid} {`);

  const first = groups.groupFirstState.get(gname);
  if (first) {
    lines.push(`${bodyIndent}[*] --> ${san(first)}`);
  }

  const members = groups.groups.get(gname);
  if (members) {
    for (const s of members) {
      for (const c of choicesOf.get(s) ?? []) lines.push(`${bodyIndent}state ${c} <<choice>>`);
      const own = regions.get(s);
      if (own) {
        emitStateRegions(lines, bodyIndent, s, own, stateDescriptions);
        continue;
      }
      const desc = stateDescriptions?.get(s);
      if (desc) {
        const formattedDesc = wrapDescription(desc.replace(/"/g, "'"), 32);
        lines.push(`${bodyIndent}state "${s}<br/><span class='node-desc'>${formattedDesc}</span>" as ${san(s)}`);
      } else {
        lines.push(`${bodyIndent}${san(s)}`);
      }
    }
  }

  const kids = childGroups.get(gname);
  if (kids) {
    const sortedKids = [...kids].sort();
    for (const child of sortedKids) {
      emitComposite(lines, child, groups, childGroups, depth + 1, exitStates, stateDescriptions, regions, choicesOf);
    }
  }

  const finals = groups.groupFinals?.get(gname);
  if (finals) for (const f of finals) lines.push(`${bodyIndent}${san(f)} --> [*]`);

  lines.push(`${indent}}`);
}

export function toCircledNumber(n: number): string {
  if (n >= 1 && n <= 20) {
    return String.fromCodePoint(0x2460 + n - 1); // ① .. ⑳
  }
  if (n >= 21 && n <= 35) {
    return String.fromCodePoint(0x3251 + n - 21); // ㉑ .. ㉟
  }
  if (n >= 36 && n <= 50) {
    return String.fromCodePoint(0x32b1 + n - 36); // ㊱ .. ㊿
  }
  return `(${n})`;
}

function buildMermaid(
  tr: Transition[],
  states: Set<string>,
  groups: GroupingResult,
  stateDescriptions?: Map<string, string>,
  flowchartOutput = false,
  showTransitionPriorities = true,
  priorityFormat: PriorityFormat = 'paren',
  emitted?: ModelEdge[],
  finals: Set<string> = new Set(),
  regions: Map<string, ParallelRegion[]> = new Map(),
  choiceNodes = false
): string {
  allRegions = regions;
  const firstStateToGroup = new Map<string, string>();
  for (const [k, v] of groups.groupFirstState.entries()) {
    firstStateToGroup.set(v, k);
  }

  // (a composite's exits: its final states, // @final or (* final *); none marked: its transitions leave from its states)
  const lastStateToGroup = new Map<string, string>();
  for (const [k, list] of groups.groupFinals ?? []) for (const s of list) lastStateToGroup.set(s, k);

  for (const t of tr) {
    if (groups.compositeToId.has(t.to)) t.redirectedTo = groups.compositeToId.get(t.to);
    if (groups.compositeToId.has(t.from)) t.redirectedFrom = groups.compositeToId.get(t.from);

    const srcGroup = groups.stateToGroup.get(t.from);
    const dstGroup = groups.stateToGroup.get(t.to);

    if (
      t.redirectedTo == null &&
      firstStateToGroup.has(t.to) &&
      srcGroup !== firstStateToGroup.get(t.to) &&
      !isDescendantGroup(srcGroup, firstStateToGroup.get(t.to)!, groups)
    ) {
      t.redirectedTo = firstStateToGroup.get(t.to);
    }

    if (
      t.redirectedFrom == null &&
      lastStateToGroup.has(t.from) &&
      lastStateToGroup.get(t.from) !== dstGroup &&
      !isDescendantGroup(dstGroup, lastStateToGroup.get(t.from)!, groups)
    ) {
      t.redirectedFrom = lastStateToGroup.get(t.from);
    }

    if (t.source === 'preProcess' && t.from === 'AnyState') {
      const scopeComposite = resolveScopeComposite(t, groups);
      if (scopeComposite) {
        t.redirectedFrom = scopeComposite;
      }
    }

    t.effectiveFrom = t.redirectedFrom ?? t.from;
    t.effectiveTo = t.redirectedTo ?? t.to;
  }

  const exitStates = new Set<string>();
  for (const t of tr) {
    if (!t.from || !t.to) continue;
    const fromGroup = groups.stateToGroup.get(t.from);
    if (!fromGroup) continue;

    let toGroup: string | undefined;
    if (groups.groups.has(t.to)) toGroup = t.to;
    else toGroup = groups.stateToGroup.get(t.to);

    const leavesGroup =
      fromGroup !== toGroup && (!toGroup || !isDescendantGroup(toGroup, fromGroup, groups));
    if (leavesGroup) exitStates.add(t.from);
  }

  const childGroups = new Map<string, string[]>();
  for (const [key, val] of groups.groupParent.entries()) {
    if (!groups.groups.has(key) || !groups.groups.has(val)) continue;
    let kids = childGroups.get(val);
    if (!kids) {
      kids = [];
      childGroups.set(val, kids);
    }
    kids.push(key);
  }

  const borderExits = new Set<string>();
  for (const t of tr) {
    if (t.redirectedFrom != null && groups.groups.has(t.redirectedFrom)) {
      borderExits.add(`${t.redirectedFrom}###${t.effectiveTo}###${t.guard ?? ''}`);
    }
  }

  const redundant = new Set<Transition>();
  for (const t of tr) {
    if (t.redirectedFrom != null) continue;
    if (!t.from) continue;
    const g = groups.stateToGroup.get(t.from);
    if (!g) continue;
    if (groups.groupFinals?.get(g)?.includes(t.from)) continue;
    if (borderExits.has(`${g}###${t.effectiveTo}###${t.guard ?? ''}`)) {
      redundant.add(t);
    }
  }

  // Calculate total out-degree from original and effective sources
  const preProcessCount = tr.filter((t) => t.source === 'preProcess').length;
  const origOutCounts = new Map<string, number>();
  for (const t of tr) {
    if (t.source === 'doState' && t.from) {
      origOutCounts.set(t.from, (origOutCounts.get(t.from) ?? 0) + 1);
    }
  }

  const seen = new Set<string>();
  const uniq: Transition[] = [];
  for (const t of tr) {
    if (redundant.has(t)) continue;
    const prioKey = showTransitionPriorities ? (t.priority ?? '') : '';
    const key = `${t.effectiveFrom}###${t.effectiveTo}###${t.guard ?? ''}###${t.source}###${prioKey}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(t);
    }
  }

  const effectiveOutCounts = new Map<string, number>();
  for (const t of uniq) {
    if (!t.effectiveFrom || !t.effectiveTo || t.effectiveFrom === t.effectiveTo) continue;
    effectiveOutCounts.set(t.effectiveFrom, (effectiveOutCounts.get(t.effectiveFrom) ?? 0) + 1);
  }

  const formatTransitionLabel = (t: Transition): string | null => {
    let lbl = t.guard;

    if (
      showTransitionPriorities &&
      t.priority != null &&
      t.priority > 0 &&
      // (preProcess()'s: numbered among its own, when it has several; drawn from AnyState or a composite's border)
      (t.source === 'preProcess' ? preProcessCount > 1 : (origOutCounts.get(t.from) ?? 0) > 1 || (effectiveOutCounts.get(t.effectiveFrom) ?? 0) > 1)
    ) {
      let prioSymbol: string;
      if (priorityFormat === 'bracket') {
        prioSymbol = `[${t.priority}]`;
      } else if (priorityFormat === 'circled') {
        prioSymbol = toCircledNumber(t.priority);
      } else {
        prioSymbol = `(${t.priority})`;
      }
      lbl = lbl ? `${prioSymbol} ${lbl}` : prioSymbol;
    }

    if (t.source === 'preProcess') {
      lbl = !lbl ? '[preProcess]' : `[preProcess] ${lbl}`;
    }

    return lbl;
  };

  // The transitions of the code behind a drawn edge: the same target, guard and origin, and the ones folded into
  // a composite's border exit
  const recordEdge = (t: Transition, label: string, fromNode?: string) => {
    if (!emitted) return;
    const members = (t.collapsed?.length ? t.collapsed : tr
      .filter(
        (m) =>
          m.effectiveTo === t.effectiveTo &&
          (m.guard ?? '') === (t.guard ?? '') &&
          m.source === t.source &&
          (!showTransitionPriorities || (m.priority ?? '') === (t.priority ?? '')) &&
          (m.effectiveFrom === t.effectiveFrom || (redundant.has(m) && groups.stateToGroup.get(m.from) === t.effectiveFrom))
      ))
      .map((m) => ({ from: m.from, to: m.to, frames: m.frames ?? [], priority: m.priority ?? null }));
    emitted.push({ from: fromNode ?? san(t.effectiveFrom), to: san(t.effectiveTo), label: label.trim(), source: t.source, members });
  };

  // Choices: per state, a top-level IF whose arms hold two or more of its (not redirected) transitions
  const choiceOf = new Map<Transition, string>();
  const choicesOf = new Map<string, string[]>();
  if (choiceNodes) {
    const arms = new Map<string, Set<number>>();
    const key = (t: Transition) => `${t.from}#${t.choice!.id}`;
    const eligible = (t: Transition) => !!t.choice && t.source === 'doState' && t.effectiveFrom === t.from && t.effectiveFrom !== t.effectiveTo;
    for (const t of uniq) if (eligible(t)) arms.set(key(t), (arms.get(key(t)) ?? new Set()).add(t.choice!.arm));
    for (const t of uniq) {
      if (!eligible(t) || (arms.get(key(t))?.size ?? 0) < 2) continue;
      const id = `choice_${san(t.from)}_${t.choice!.id}`;
      choiceOf.set(t, id);
      const list = choicesOf.get(t.from) ?? [];
      if (!list.includes(id)) choicesOf.set(t.from, [...list, id]);
    }
  }
  const choiceLinked = new Set<string>();

  if (flowchartOutput) {
    const lines: string[] = ['flowchart TD'];
    const declared = new Set<string>();

    const topLevel = Array.from(groups.groups.keys())
      .filter((k) => !groups.groupParent.has(k) || !groups.groups.has(groups.groupParent.get(k)!))
      .sort();

    for (const gname of topLevel) {
      emitFlowchartSubgraph(lines, gname, groups, childGroups, 1, declared, stateDescriptions, regions, choicesOf);
    }

    const sortedStates = Array.from(states).sort();
    for (const s of sortedStates) {
      if (declared.has(s)) continue;
      if (s === 'AnyState') continue;
      const own = regions.get(s);
      if (own) emitFlowchartRegions(lines, '    ', s, own, declared, stateDescriptions);
      else lines.push(`    ${san(s)}["${flowNodeLabel(s, stateDescriptions)}"]`);
      for (const c of choicesOf.get(s) ?? []) lines.push(`    ${c}{"${CHOICE_LABEL}"}`);
      declared.add(s);
    }

    if (groups.machineStartState) {
      lines.push(`    startNode((" ")) --> ${san(groups.machineStartState)}`);
    }
    for (const s of [...finals].sort()) {
      if (states.has(s) && !groups.stateToGroup.has(s)) lines.push(`    ${san(s)} --> endNode(((" ")))`);
    }
    // preProcess()'s transitions checking no composite's range: from any state
    if (uniq.some((t) => t.effectiveFrom === 'AnyState')) lines.push('    AnyState(["any state"])', '    classDef kssAnyState stroke-dasharray: 4 3', '    class AnyState kssAnyState');

    for (const t of uniq) {
      if (!t.effectiveFrom || !t.effectiveTo) continue;
      if (t.effectiveFrom === t.effectiveTo) continue;

      const lbl = formatTransitionLabel(t);
      const choice = choiceOf.get(t);
      if (choice) {
        if (!choiceLinked.has(choice)) {
          choiceLinked.add(choice);
          lines.push(`    ${san(t.from)} --> ${choice}`);
        }
        lines.push(lbl ? `    ${choice} -->|"${flowLabel(lbl)}"| ${san(t.effectiveTo)}` : `    ${choice} --> ${san(t.effectiveTo)}`);
        recordEdge(t, lbl ? flowLabel(lbl) : '', choice);
        continue;
      }

      if (!lbl) {
        lines.push(`    ${san(t.effectiveFrom)} --> ${san(t.effectiveTo)}`);
      } else {
        lines.push(`    ${san(t.effectiveFrom)} -->|"${flowLabel(lbl)}"| ${san(t.effectiveTo)}`);
      }
      recordEdge(t, lbl ? flowLabel(lbl) : '');
    }

    return lines.join('\n');
  } else {
    const lines: string[] = ['stateDiagram-v2'];

    const topLevel = Array.from(groups.groups.keys())
      .filter((k) => !groups.groupParent.has(k) || !groups.groups.has(groups.groupParent.get(k)!))
      .sort();

    for (const gname of topLevel) {
      emitComposite(lines, gname, groups, childGroups, 1, exitStates, stateDescriptions, regions, choicesOf);
    }
    // States with regions outside the composites
    for (const [s, own] of regions) if (!groups.stateToGroup.has(s) && states.has(s)) emitStateRegions(lines, '    ', s, own, stateDescriptions);

    // The choices of states outside the composites
    for (const [s, list] of choicesOf) if (!groups.stateToGroup.has(s)) for (const c of list) lines.push(`    state ${c} <<choice>>`);
    if (groups.machineStartState) {
      lines.push(`    [*] --> ${san(groups.machineStartState)}`);
    }
    for (const s of [...finals].sort()) {
      if (states.has(s) && !groups.stateToGroup.has(s)) lines.push(`    ${san(s)} --> [*]`);
    }
    if (uniq.some((t) => t.effectiveFrom === 'AnyState')) lines.push('    state "any state" as AnyState', '    classDef kssAnyState stroke-dasharray: 4 3', '    class AnyState kssAnyState');

    for (const t of uniq) {
      if (!t.effectiveFrom || !t.effectiveTo) continue;
      if (t.effectiveFrom === t.effectiveTo) continue;

      const lbl = formatTransitionLabel(t);
      const choice = choiceOf.get(t);
      if (choice) {
        if (!choiceLinked.has(choice)) {
          choiceLinked.add(choice);
          lines.push(`    ${san(t.from)} --> ${choice}`);
        }
        lines.push(lbl ? `    ${choice} --> ${san(t.effectiveTo)}: ${esc(lbl)}` : `    ${choice} --> ${san(t.effectiveTo)}`);
        recordEdge(t, lbl ? esc(lbl) : '', choice);
        continue;
      }

      if (!lbl) {
        lines.push(`    ${san(t.effectiveFrom)} --> ${san(t.effectiveTo)}`);
      } else {
        lines.push(`    ${san(t.effectiveFrom)} --> ${san(t.effectiveTo)}: ${esc(lbl)}`);
      }
      recordEdge(t, lbl ? esc(lbl) : '');
    }

    if (stateDescriptions && stateDescriptions.size > 0) {
      const sortedStates = Array.from(states).sort();
      for (const s of sortedStates) {
        // (a state drawn as a box, its regions or sub-machine inside: declared with its label there; once more here
        // Mermaid refuses: "Group nodes can only have label")
        if (groups.stateToGroup.has(s) || regions.has(s)) continue;
        const desc = stateDescriptions.get(s);
        if (desc) {
          const formattedDesc = wrapDescription(desc.replace(/"/g, "'"), 32);
          lines.push(`    state "${s}<br/><span class='node-desc'>${formattedDesc}</span>" as ${san(s)}`);
        }
      }
    }
    // A state no line names yet (no transition, no description, outside the composites): drawn all the same, as the
    // flowchart draws it (a state moved out of its composite, no longer the first member, is still on the canvas)
    const named = new Set(lines.join('\n').match(/\w+/g) ?? []);
    for (const s of Array.from(states).sort()) {
      if (s === 'AnyState' || groups.stateToGroup.has(s) || regions.has(s)) continue;
      if (!named.has(san(s))) lines.push(`    ${san(s)}`);
    }

    return lines.join('\n');
  }
}

export function generateStatechart(
  tcDutContent: string,
  tcPouContent: string,
  options: GeneratorOptions = {}
): string {
  return generateStatechartModel(tcDutContent, tcPouContent, options).markdown;
}

/**
 * The composites the chart used to find on its own, before composites came only from the enum's {region} markers:
 * TwinCAT's UML statechart (doState_UmlSC), else the names (the states after *_ENABLING: <Type>Enabled). An error
 * state most of a composite's states go to is left out of it (drawn apart, as it was). Offered as "Write these
 * composites as markers"; outer composites first, each one's states in enum order
 */
export function inferredComposites(tcDutContent: string, tcPouContent: string): { name: string; members: string[]; parent: string | null; initial: string | null }[] {
  const doc = parseXmlDoc(tcPouContent);
  const decl = extractDeclaration(tcDutContent);
  const enumOrder = readEnumOrder(decl);
  const groups = tryLoadUmlGrouping(doc) ?? loadEnumGrouping(decl);
  if (!groups || !groups.groups.size) return [];
  const doStateSt = getMethodSt(doc, tcPouContent, 'doState');
  const stateVar = /\bCASE\s*\(?\s*(.*?)\s*\)?\s*OF\b/i.exec(doStateSt ?? '')?.[1]?.trim() || 'machineState';
  const transitions: Transition[] = [];
  if (doStateSt) parseDoState(doStateSt, stateVar, transitions, new Set<string>(), new Set(enumOrder));
  // (an error state most of its composite's states go to, that leads nowhere back in: outside it)
  for (const [candidate, group] of [...groups.stateToGroup]) {
    if (!nameLooksLikeError(candidate)) continue;
    const insideOf = (st: string) => { const g = groups.stateToGroup.get(st); return !!g && isSameOrDescendantGroup(g, group, groups); };
    const incoming = new Set(transitions.filter((t) => t.to === candidate && t.from !== candidate && insideOf(t.from)).map((t) => t.from));
    const back = transitions.some((t) => t.from === candidate && t.to !== candidate && insideOf(t.to));
    const count = [...groups.stateToGroup.keys()].filter((st) => st !== candidate && insideOf(st)).length;
    if (count > 0 && incoming.size * 2 >= count && !back) removeStateFromGroup(candidate, groups);
  }
  // (its entry as it was drawn: the state most transitions from outside go to)
  reorderGroupsByEnum(groups, enumOrder);
  determineCompositeStartStates(transitions, groups);
  const order = (st: string) => { const k = enumOrder.indexOf(st); return k < 0 ? Number.MAX_SAFE_INTEGER : k; };
  const depth = (g: string) => { let d = 0; for (let x = groups.groupParent.get(g); x && groups.groups.has(x); x = groups.groupParent.get(x)) d++; return d; };
  // (each composite's states, its sub-composites' too: written outer first, the inner ones then nest in them)
  const within = (name: string) => enumOrder.filter((st) => { const g = groups.stateToGroup.get(st); return !!g && isSameOrDescendantGroup(g, name, groups); });
  return [...groups.groups.keys()]
    .map((name) => ({ name, members: within(name), parent: groups.groups.has(groups.groupParent.get(name) ?? '') ? groups.groupParent.get(name)! : null, initial: groups.groupFirstState.get(name) ?? null }))
    // (one around every state of the enum groups nothing)
    .filter((c) => c.members.length > 0 && c.members.length < enumOrder.length)
    .sort((a, b) => depth(a.name) - depth(b.name) || order(a.members[0]) - order(b.members[0]));
}

/** The Mermaid code, the state variable, and the drawn edges with the code's transitions (and their IF context) */
export function generateStatechartModel(
  tcDutContent: string,
  tcPouContent: string,
  options: GeneratorOptions = {}
): StatechartModel {
  const collapseErrorSinkEdges = options.collapseErrorSinkEdges ?? DefaultCollapseErrorSinkEdges;
  const flowchartOutput = options.flowchartOutput ?? false;
  const includeStateDescriptions = options.includeStateDescriptions ?? false;
  const showTransitionPriorities = options.showTransitionPriorities ?? true;
  const priorityFormat = options.priorityFormat ?? 'circled';

  const doc = parseXmlDoc(tcPouContent);
  // (the IF statements numbered from 1 for each chart: a choice keeps its id)
  ifSeq = 0;
  spellElse = options.spellOutElse ?? false;
  const doStateSt = getMethodSt(doc, tcPouContent, 'doState');
  const preProcessSt = getMethodSt(doc, tcPouContent, 'preProcess');

  let stateDescriptions: Map<string, string> | undefined;
  if (includeStateDescriptions) {
    const descSt = getMethodSt(doc, tcPouContent, 'getStateDescription');
    stateDescriptions = parseStateDescriptions(descSt);
  }
  // Entry / do / exit: lines under the name (after the description)
  if (options.stateActions && options.stateActions.size > 0) {
    stateDescriptions = new Map(stateDescriptions ?? []);
    for (const [state, a] of options.stateActions) {
      const lines = (['entry', 'do', 'exit'] as const).filter((k) => a[k]).map((k) => `${k} / ${actionText(a[k]!)}`);
      if (!lines.length) continue;
      const desc = stateDescriptions.get(state);
      stateDescriptions.set(state, [...(desc ? [desc] : []), ...lines].join('<br/>'));
    }
  }

  if (doStateSt === null && preProcessSt === null) {
    throw new Error('Neither doState() nor preProcess() found in POU file.');
  }

  let stateVarName = 'machineState';
  if (doStateSt) {
    const pattern = /\bCASE\s*\(?\s*(.*?)\s*\)?\s*OF\b/i;
    const match = doStateSt.match(pattern);
    if (match) {
      stateVarName = match[1].trim();
      if (stateVarName !== 'machineState' && stateVarName !== 'mainState') {
        throw new Error(
          `Unexpected state variable name: ${stateVarName}. Expected 'machineState' or 'mainState'.`
        );
      }
    }
  }

  const transitions: Transition[] = [];
  const states = new Set<string>();

  // The enum first: its members are CASE labels even without "_" (DISABLED, ENABLED)
  const decl = extractDeclaration(tcDutContent);
  const enumOrder = readEnumOrder(decl);

  if (doStateSt) parseDoState(doStateSt, stateVarName, transitions, states, new Set(enumOrder));
  if (preProcessSt) parsePreProcess(preProcessSt, stateVarName, transitions, states);

  // Composites: only the enum's {region} markers (nothing inferred from names, TwinCAT's UML chart or preProcess())
  const groups: GroupingResult = {
      groups: new Map(),
      stateToGroup: new Map(),
      groupFirstState: new Map(),
      groupLastState: new Map(),
      compositeToId: new Map(),
      groupParent: new Map(),
      enumOrder: [],
    };

  applyEnumRegions(groups, loadEnumRegions(decl));
  // Parallel regions: their states are drawn inside their state, not in the composites
  const regions = parseParallelRegions(doStateSt, stateVarName, new Set(enumOrder));
  for (const list of regions.values()) for (const r of list) for (const s of r.states) removeStateFromGroup(s, groups);
  // Every state of the enum drawn, one without a CASE branch or transitions too (not a parallel region's: drawn in
  // its state)
  const inRegions = new Set([...regions.values()].flatMap((list) => list.flatMap((r) => r.states)));
  // Sub-machines: a method of the POU with its own state machine, called from a state's branch (EFX_IDLE's
  // RpsSimulation()): drawn inside that state (by default: a mark in it was easy to miss), unless collapsed ("-<state>"
  // among the collapsed composites): then the state's label says it has one
  const collapsedSubs = new Set((options.collapsedComposites ?? []).filter((n) => n.startsWith('-')).map((n) => n.slice(1)));
  const subMachines = findAllSubMachines(doStateSt, methodsOf(doc, tcPouContent), stripComments(tcPouContent));
  let anyUnreachable = false;
  // (the sub-machines' states drawn: a sub-machine of one of them is drawn inside it, unless its own is collapsed)
  const drawnSubStates = new Set<string>();
  for (const m of subMachines) {
    const nested = !enumOrder.includes(m.parent) && !states.has(m.parent);
    if (nested && !drawnSubStates.has(m.parent)) continue;
    if (collapsedSubs.has(m.parent) && nested) {
      // (a sub-machine's state with one of its own, collapsed: its label says so)
      for (const list of regions.values())
        for (const r of list) if (r.labels?.[m.parent]) r.labels[m.parent] = `${r.labels[m.parent]}<br/><span class='node-desc'>⊞ ${m.method}</span>`;
      continue;
    }
    if (collapsedSubs.has(m.parent)) {
      stateDescriptions = new Map(stateDescriptions ?? []);
      const desc = stateDescriptions.get(m.parent);
      stateDescriptions.set(m.parent, [...(desc ? [desc] : []), `⊞ ${m.method}`].join('<br/>'));
      continue;
    }
    const id = (x: string) => `${m.parent}__${m.method}__${x}`;
    for (const x of m.states) drawnSubStates.add(id(x));
    if (m.unreachable.length) anyUnreachable = true;
    regions.set(m.parent, [
      ...(regions.get(m.parent) ?? []),
      {
        parent: m.parent, variable: `${m.method}.${m.variable}`, states: m.states.map(id), start: m.start ? id(m.start) : null, finals: [],
        transitions: m.transitions.map((t) => {
          // (its priority: its place among its state's transitions, numbered when there are several)
          const own = m.transitions.filter((x) => x.from === t.from);
          if (!(options.showTransitionPriorities ?? true) || own.length < 2) return { from: id(t.from), to: id(t.to), guard: t.guard };
          const n = own.indexOf(t) + 1;
          const fmt = options.priorityFormat ?? 'circled';
          const mark = fmt === 'bracket' ? `[${n}]` : fmt === 'circled' ? toCircledNumber(n) : `(${n})`;
          return { from: id(t.from), to: id(t.to), guard: t.guard ? `${mark} ${t.guard}` : mark };
        }),
        labels: Object.fromEntries(m.states.map((x) => [id(x), x])), title: m.method, entry: m.entry, subMachine: { method: m.method, when: m.when ?? null },
        unreachable: m.unreachable.map(id),
      },
    ]);
  }
  for (const s of enumOrder) if (!inRegions.has(s)) states.add(s);
  reorderGroupsByEnum(groups, enumOrder);
  applyEnumConventions(groups, enumOrder);
  // A declared initial value (or one set in initialize()) is the initial state
  const declaredStart = declaredInitialState(tcPouContent, stateVarName) ?? initializedState(getMethodSt(doc, tcPouContent, 'initialize'), stateVarName);
  if (declaredStart && states.has(declaredStart)) groups.machineStartState = declaredStart;
  // Marked states: a composite's @initial is its entry, its final states its exits; an @initial outside the
  // composites is the chart's initial state (unless the declaration / initialize() give one)
  const marks = enumStateMarks(decl);
  const finalStates = new Set([...finalStatesOf(doStateSt), ...marks.final]);
  groups.markedInitial = new Set();
  groups.groupFinals = new Map();
  for (const s of marks.initial) {
    const g = groups.stateToGroup.get(s);
    if (g) {
      groups.groupFirstState.set(g, s);
      groups.markedInitial.add(g);
    } else if (states.has(s) && !declaredStart) groups.machineStartState = s;
  }
  for (const s of finalStates) {
    const g = groups.stateToGroup.get(s);
    if (g) groups.groupFinals.set(g, [...(groups.groupFinals.get(g) ?? []), s]);
  }
  // ("-<state>": a sub-machine collapsed, not a composite; "+<state>": expanded, as it was before it was the default)
  const collapsedNames = (options.collapsedComposites ?? []).filter((n) => !n.startsWith('+') && !n.startsWith('-'));
  if (collapsedNames.length) collapseComposites(collapsedNames, transitions, states, groups, finalStates, stateDescriptions);
  extractErrorSinkStates(transitions, groups, collapseErrorSinkEdges);

  const edges: ModelEdge[] = [];
  const markdown = buildMermaid(
    transitions,
    states,
    groups,
    stateDescriptions,
    flowchartOutput,
    showTransitionPriorities,
    priorityFormat,
    edges,
    finalStates,
    regions,
    options.choiceNodes ?? false
  );
  // (a sub-machine's states nothing goes to: dashed)
  const finalMarkdown = anyUnreachable ? `${markdown.replace(/\n*$/, '')}\n    classDef kssUnreachable stroke-dasharray: 3 3,opacity:0.6\n` : markdown;
  return { markdown: finalMarkdown, stateVar: stateVarName, edges, subMachines: subMachines.map((m) => ({ parent: m.parent, method: m.method, expanded: !collapsedSubs.has(m.parent) })), composites: Object.fromEntries([...groups.groups].map(([k, v]) => [k, [...v]])) };
}
