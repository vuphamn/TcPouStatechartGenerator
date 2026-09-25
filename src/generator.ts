// Port of TcPouStatechartGenerator (C#) to TypeScript

import { DOMParser as XmldomParser } from '@xmldom/xmldom';

export type PriorityFormat = 'paren' | 'bracket' | 'circled';

export interface GeneratorOptions {
  collapseErrorSinkEdges?: boolean;
  flowchartOutput?: boolean;
  includeStateDescriptions?: boolean;
  showTransitionPriorities?: boolean;
  priorityFormat?: PriorityFormat;
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
  members: { from: string; frames: GuardFrame[] }[];
}

export interface StatechartModel {
  markdown: string;
  stateVar: string;
  edges: ModelEdge[];
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
  redirectedTo?: string | null;
  scopeLower?: string | null;
  scopeUpper?: string | null;
  effectiveFrom: string;
  effectiveTo: string;
}

interface IfFrame {
  currentCond: string | null;
  negatedPriorConds: (string | null)[];
}

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
}

const DefaultCollapseErrorSinkEdges = true;
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
  return flat.split('\n');
}

function looksLikeStateLabel(label: string): boolean {
  for (const part of label.split(',')) {
    const p = part.trim();
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

function buildGuard(s: IfFrame[]): string | null {
  if (s.length === 0) return null;
  if (s.length === 1) {
    return s[0].currentCond ?? 'else';
  }
  const parts: string[] = [];
  for (const f of s) {
    if (f.currentCond === null) {
      parts.push('else');
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
  const labelRx = /^\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*:\s*$/;
  const assignRx = /getStateDescription\s*:=\s*'([^']*)'/i;

  let pendingLabels: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;

    const am = line.match(assignRx);
    if (am && pendingLabels.length > 0) {
      for (const lbl of pendingLabels) {
        map.set(lbl, am[1].trim());
      }
      pendingLabels = [];
      continue;
    }

    const lm = line.match(labelRx);
    if (lm) {
      pendingLabels = [];
      for (const part of lm[1].split(',')) {
        pendingLabels.push(part.trim());
      }
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
  states: Set<string>
) {
  const code = stripComments(st);
  const lines = preprocessDoStateLines(code);
  let currentStates: string[] = [];
  const statePriorityCounters = new Map<string, number>();
  const ifStack: IfFrame[] = [];
  const caseRx = /^\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*:\s*(\/\/.*)?$/;
  const assign = new RegExp(`\\b(${stateVarName})\\s*:=\\s*([A-Za-z_][A-Za-z0-9_\\.]*)`, 'g');
  const ifRx = /^\s*IF\b(.*?)\bTHEN\b/i;
  const elsifRx = /^\s*ELSIF\b(.*?)\bTHEN\b/i;
  const elseRx = /^\s*ELSE\b/i;
  const endIfRx = /^\s*END_IF\b/i;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;

    const cm = line.match(caseRx);
    if (cm && looksLikeStateLabel(cm[1])) {
      currentStates = [];
      for (const lbl of cm[1].split(',').map((s) => s.trim())) {
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
      const target = match[2];
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
  const ifRx = /^\s*IF\b(.*?)\bTHEN\b/i;
  const elsifRx = /^\s*ELSIF\b(.*?)\bTHEN\b/i;
  const elseRx = /^\s*ELSE\b/i;
  const endIfRx = /^\s*END_IF\b/i;
  const assign = new RegExp(`\\b(${stateVarName})\\s*:=\\s*([A-Za-z_][A-Za-z0-9_\\.]*)`, 'g');
  const lowerRx = new RegExp(`\\b(${stateVarName})\\s*(>=|>)\\s*([A-Za-z_][A-Za-z0-9_]*)`, 'i');
  const upperRx = new RegExp(`\\b(${stateVarName})\\s*(<=|<)\\s*([A-Za-z_][A-Za-z0-9_]*)`, 'i');
  const Any = 'AnyState';

  let pendingLower: string | null = null;
  let pendingUpper: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;

    const mIf = line.match(ifRx);
    if (mIf) {
      ifStack.push({
        currentCond: cleanCondition(mIf[1]),
        negatedPriorConds: [],
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
    if (lo) pendingLower = lo[3];
    const hi = line.match(upperRx);
    if (hi) pendingUpper = hi[3];

    let am: RegExpExecArray | null;
    assign.lastIndex = 0;
    while ((am = assign.exec(line)) !== null) {
      const target = am[2];
      states.add(target);
      states.add(Any);
      const tr: Transition = {
        from: Any,
        to: target,
        guard: buildResetGuard(ifStack, stateVarName),
        frames: snapshotFrames(ifStack),
        source: 'preProcess',
        scopeLower: pendingLower,
        scopeUpper: pendingUpper,
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

  const enablingIdx = enumOrder.findIndex((s) => s.endsWith('ENABLING'));
  if (enablingIdx < 0) return;

  const childStates = new Set(enumOrder.slice(enablingIdx + 1));
  if (childStates.size === 0) return;

  const firstChild = enumOrder[enablingIdx + 1];
  const owningGroup = groups.stateToGroup.get(firstChild);
  if (!owningGroup) return;

  let top = owningGroup;
  while (groups.groupParent.has(top) && groups.groups.has(groups.groupParent.get(top)!)) {
    top = groups.groupParent.get(top)!;
  }
  groups.enabledCompositeName = top;
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
  if (groups.enumOrder.length === 0) return null;

  const loIdx = t.scopeLower != null ? groups.enumOrder.indexOf(t.scopeLower) : 0;
  const hiIdx = t.scopeUpper != null ? groups.enumOrder.indexOf(t.scopeUpper) : groups.enumOrder.length - 1;
  if (loIdx < 0 || hiIdx < 0 || loIdx > hiIdx) {
    return groups.enabledCompositeName ?? null;
  }

  const owningGroups = new Set<string>();
  for (let i = loIdx; i <= hiIdx; i++) {
    const state = groups.enumOrder[i];
    if (state === t.to) continue;
    const g = groups.stateToGroup.get(state);
    if (g) owningGroups.add(g);
  }
  if (owningGroups.size === 0) return groups.enabledCompositeName ?? null;

  let lca: string | null = null;
  for (const g of owningGroups) {
    lca = lca === null ? g : lowestCommonAncestor(lca, g, groups);
  }
  return lca ?? groups.enabledCompositeName ?? null;
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
  const kept: Transition[] = [];

  for (const t of transitions) {
    const targetsError = t.to === error;
    const fromG = groups.stateToGroup.get(t.from);
    const fromInside = fromG ? isSameOrDescendantGroup(fromG, composite, groups) : false;

    if (targetsError && fromInside && t.from !== error) {
      borderSources.add(topLevelComposite(fromG!, groups));
      continue;
    }
    kept.push(t);
  }

  transitions.length = 0;
  transitions.push(...kept);

  for (const src of borderSources) {
    const exists = transitions.some((t) => t.from === src && t.to === error);
    if (!exists) {
      transitions.push({
        from: src,
        to: error,
        guard: CollapsedEdgeWarningLabel,
        source: 'doState',
        effectiveFrom: src,
        effectiveTo: error,
      });
    }
  }
}

function extractErrorSinkStates(
  transitions: Transition[],
  groups: GroupingResult,
  collapseErrorSinkEdges: boolean
) {
  if (groups.groups.size === 0 || transitions.length === 0) return;

  const origStateToGroup = new Map(groups.stateToGroup);

  for (const candidate of Array.from(origStateToGroup.keys())) {
    const group = origStateToGroup.get(candidate);
    if (!group) continue;

    if (!nameLooksLikeError(candidate)) continue;

    const incomingFromInside = new Set<string>();
    let hasForwardEdge = false;

    for (const t of transitions) {
      if (t.to === candidate && t.from !== candidate) {
        const fromG = origStateToGroup.get(t.from);
        if (fromG && isSameOrDescendantGroup(fromG, group, groups)) {
          incomingFromInside.add(t.from);
        }
      }

      if (t.from === candidate && t.to !== candidate) {
        const toG = origStateToGroup.get(t.to);
        if (toG && isSameOrDescendantGroup(toG, group, groups)) {
          hasForwardEdge = true;
        }
      }
    }

    let subtreeMemberCount = 0;
    for (const [s, g] of origStateToGroup.entries()) {
      if (s !== candidate && isSameOrDescendantGroup(g, group, groups)) {
        subtreeMemberCount++;
      }
    }

    const isBroadSink =
      subtreeMemberCount > 0 &&
      incomingFromInside.size * 2 >= subtreeMemberCount &&
      !hasForwardEdge;

    if (!isBroadSink) continue;

    removeStateFromGroup(candidate, groups);
    origStateToGroup.delete(candidate);

    if (collapseErrorSinkEdges) {
      collapseInternalEdgesToBorder(transitions, candidate, group, groups);
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

function emitFlowchartSubgraph(
  lines: string[],
  gname: string,
  groups: GroupingResult,
  childGroups: Map<string, string[]>,
  depth: number,
  declared: Set<string>,
  stateDescriptions?: Map<string, string>
) {
  const indent = ' '.repeat(depth * 4);
  const bodyIndent = ' '.repeat((depth + 1) * 4);
  const gid = san(gname);

  lines.push(`${indent}subgraph ${gid}["${gname}"]`);

  const members = groups.groups.get(gname);
  if (members) {
    for (const s of members) {
      if (declared.has(s)) continue;
      lines.push(`${bodyIndent}${san(s)}["${flowNodeLabel(s, stateDescriptions)}"]`);
      declared.add(s);
    }
  }

  const kids = childGroups.get(gname);
  if (kids) {
    const sortedKids = [...kids].sort();
    for (const child of sortedKids) {
      emitFlowchartSubgraph(lines, child, groups, childGroups, depth + 1, declared, stateDescriptions);
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
  stateDescriptions?: Map<string, string>
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
      emitComposite(lines, child, groups, childGroups, depth + 1, exitStates, stateDescriptions);
    }
  }

  const last = groups.groupLastState.get(gname);
  if (last && exitStates.has(last)) {
    lines.push(`${bodyIndent}${san(last)} --> [*]`);
  }

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
  emitted?: ModelEdge[]
): string {
  const firstStateToGroup = new Map<string, string>();
  for (const [k, v] of groups.groupFirstState.entries()) {
    firstStateToGroup.set(v, k);
  }

  const lastStateToGroup = new Map<string, string>();
  for (const [k, v] of groups.groupLastState.entries()) {
    lastStateToGroup.set(v, k);
  }

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
    const last = groups.groupLastState.get(g);
    if (last === t.from) continue;
    if (borderExits.has(`${g}###${t.effectiveTo}###${t.guard ?? ''}`)) {
      redundant.add(t);
    }
  }

  // Calculate total out-degree from original and effective sources
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
      ((origOutCounts.get(t.from) ?? 0) > 1 || (effectiveOutCounts.get(t.effectiveFrom) ?? 0) > 1)
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
  const recordEdge = (t: Transition, label: string) => {
    if (!emitted) return;
    const members = tr
      .filter(
        (m) =>
          m.effectiveTo === t.effectiveTo &&
          (m.guard ?? '') === (t.guard ?? '') &&
          m.source === t.source &&
          (!showTransitionPriorities || (m.priority ?? '') === (t.priority ?? '')) &&
          (m.effectiveFrom === t.effectiveFrom || (redundant.has(m) && groups.stateToGroup.get(m.from) === t.effectiveFrom))
      )
      .map((m) => ({ from: m.from, frames: m.frames ?? [] }));
    emitted.push({ from: san(t.effectiveFrom), to: san(t.effectiveTo), label: label.trim(), source: t.source, members });
  };

  if (flowchartOutput) {
    const lines: string[] = ['flowchart TD'];
    const declared = new Set<string>();

    const topLevel = Array.from(groups.groups.keys())
      .filter((k) => !groups.groupParent.has(k) || !groups.groups.has(groups.groupParent.get(k)!))
      .sort();

    for (const gname of topLevel) {
      emitFlowchartSubgraph(lines, gname, groups, childGroups, 1, declared, stateDescriptions);
    }

    const sortedStates = Array.from(states).sort();
    for (const s of sortedStates) {
      if (declared.has(s)) continue;
      if (s === 'AnyState') continue;
      lines.push(`    ${san(s)}["${flowNodeLabel(s, stateDescriptions)}"]`);
      declared.add(s);
    }

    if (groups.machineStartState) {
      lines.push(`    startNode((" ")) --> ${san(groups.machineStartState)}`);
    }

    for (const t of uniq) {
      if (!t.effectiveFrom || !t.effectiveTo) continue;
      if (t.effectiveFrom === t.effectiveTo) continue;

      const lbl = formatTransitionLabel(t);

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
      emitComposite(lines, gname, groups, childGroups, 1, exitStates, stateDescriptions);
    }

    if (groups.machineStartState) {
      lines.push(`    [*] --> ${san(groups.machineStartState)}`);
    }

    for (const t of uniq) {
      if (!t.effectiveFrom || !t.effectiveTo) continue;
      if (t.effectiveFrom === t.effectiveTo) continue;

      const lbl = formatTransitionLabel(t);

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
        if (groups.stateToGroup.has(s)) continue;
        const desc = stateDescriptions.get(s);
        if (desc) {
          const formattedDesc = wrapDescription(desc.replace(/"/g, "'"), 32);
          lines.push(`    state "${s}<br/><span class='node-desc'>${formattedDesc}</span>" as ${san(s)}`);
        }
      }
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
  const doStateSt = getMethodSt(doc, tcPouContent, 'doState');
  const preProcessSt = getMethodSt(doc, tcPouContent, 'preProcess');

  let stateDescriptions: Map<string, string> | undefined;
  if (includeStateDescriptions) {
    const descSt = getMethodSt(doc, tcPouContent, 'getStateDescription');
    stateDescriptions = parseStateDescriptions(descSt);
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

  if (doStateSt) parseDoState(doStateSt, stateVarName, transitions, states);
  if (preProcessSt) parsePreProcess(preProcessSt, stateVarName, transitions, states);

  const decl = extractDeclaration(tcDutContent);
  const enumOrder = readEnumOrder(decl);

  const groups =
    tryLoadUmlGrouping(doc) ?? loadEnumGrouping(decl) ?? {
      groups: new Map(),
      stateToGroup: new Map(),
      groupFirstState: new Map(),
      groupLastState: new Map(),
      compositeToId: new Map(),
      groupParent: new Map(),
      enumOrder: [],
    };

  reorderGroupsByEnum(groups, enumOrder);
  applyEnumConventions(groups, enumOrder);
  determineCompositeStartStates(transitions, groups);
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
    edges
  );
  return { markdown, stateVar: stateVarName, edges };
}
