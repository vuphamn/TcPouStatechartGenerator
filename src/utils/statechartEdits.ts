/**
 * The canvas as a statechart editor: elements dropped from its palette become ST.
 * - composite states: {region "Name"} … {endregion} pragmas around enum members in the .TcDUT (nested regions are
 *   nested composites; TwinCAT's editor folds them). A composite's members are consecutive, as preProcess()'s
 *   ">= FIRST AND <= LAST" scopes expect;
 * - the initial state: the state variable's initial value in the POU's declaration ("machineState : E := S;");
 * - a final state: "(* final *)" on its CASE label in doState() (it has no transitions out);
 * - a choice: an IF / ELSIF / ELSE of transitions at the end of a state's branch;
 * - a state's description: its line in getStateDescription().
 */

import { addEnumMember, blankComments, enumListRange } from './stateMachineLint.ts';
import { getMethodCodeFromPou, updateMethodCodeInPou } from './pouStateEditor.ts';
import { getPouBody, updatePouBody } from './pouBody.ts';
import { escapeRx, labelNames } from './sourceLocation.ts';
import { caseBranchRange } from './stateEdits.ts';
import { stateQualifier } from './stateNames.ts';
import { leading } from './transitionEdits.ts';
import { parseParallelRegions } from '../generator.ts';

export const FINAL_MARK = '(* final *)';
const REGION_RX = /^\s*\{\s*region\b\s*(?:"([^"]*)"|'([^']*)'|([^}]*?))\s*\}/i;
const END_REGION_RX = /^\s*\{\s*endregion\b[^}]*\}/i;

/** Comments and pragmas ({…}) blanked, the line breaks kept */
export const blankCommentsAndPragmas = (text: string) => blankComments(text).replace(/\{[^{}\n]*\}/g, (m) => ' '.repeat(m.length));

const declOf = (dutContent: string) => {
  const m = dutContent.match(/(<Declaration>\s*<!\[CDATA\[)([\s\S]*?)(\]\]>)/i);
  return {
    decl: m ? m[2] : dutContent,
    wrap: (next: string) => (m ? dutContent.replace(m[0], () => m[1] + next + m[3]) : next),
  };
};

export interface EnumComposite {
  name: string;
  parent: string | null;
  /** Its own members (not its sub-composites'), in order */
  members: string[];
}

/** The composites of the enum ({region} pragmas in its list) */
export function enumComposites(dutContent: string): EnumComposite[] {
  const { decl } = declOf(dutContent);
  const range = enumListRange(decl);
  if (!range) return [];
  const lines = decl.slice(range.start + 1, range.end).split('\n');
  const code = blankComments(lines.join('\n')).split('\n');
  const out: EnumComposite[] = [];
  const stack: EnumComposite[] = [];
  lines.forEach((raw, i) => {
    const region = raw.match(REGION_RX);
    if (region) {
      const c: EnumComposite = { name: (region[1] ?? region[2] ?? region[3] ?? '').trim() || `Composite${out.length + 1}`, parent: stack[stack.length - 1]?.name ?? null, members: [] };
      out.push(c);
      stack.push(c);
      return;
    }
    if (END_REGION_RX.test(raw)) {
      stack.pop();
      return;
    }
    const member = code[i].replace(/^\s*,/, '').match(/^\s*([A-Za-z_]\w*)/)?.[1];
    if (member && stack.length) stack[stack.length - 1].members.push(member);
  });
  return out;
}

/** The composite a member is in (null: top level) */
export const compositeOf = (dutContent: string, member: string) => enumComposites(dutContent).find((c) => c.members.includes(member))?.name ?? null;

// The list's lines, with the offset of each
function listLines(decl: string) {
  const range = enumListRange(decl);
  if (!range) return null;
  const code = blankCommentsAndPragmas(decl);
  const raw = blankComments(decl);
  const lines: { start: number; end: number }[] = [];
  let p = range.start + 1;
  while (p <= range.end) {
    const nl = decl.indexOf('\n', p);
    const end = nl < 0 || nl > range.end ? range.end : nl;
    lines.push({ start: p, end });
    p = end + 1;
  }
  return { range, code, raw, lines };
}

/**
 * The .TcDUT with a member added: at the end of the list (composite null), or last in the composite. Members after
 * it (a composite that is not last) get new values when they have none of their own.
 */
export function addEnumMemberIn(dutContent: string, name: string, composite: string | null): string | null {
  if (!composite) return addEnumMember(dutContent, name);
  const { decl, wrap } = declOf(dutContent);
  const l = listLines(decl);
  if (!l) return null;
  const { code, raw, lines } = l;
  const eol = decl.includes('\r\n') ? '\r\n' : '\n';
  // The composite's {endregion} (nesting counted)
  const open = lines.findIndex((x) => {
    const m = decl.slice(x.start, x.end).match(REGION_RX);
    return !!m && (m[1] ?? m[2] ?? m[3] ?? '').trim() === composite;
  });
  if (open < 0) return null;
  let depth = 0;
  let close = -1;
  for (let i = open; i < lines.length; i++) {
    const t = decl.slice(lines[i].start, lines[i].end);
    if (REGION_RX.test(t)) depth++;
    else if (END_REGION_RX.test(t) && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close < 0) return null;
  const at = lines[close].start;
  const before = code.slice(l.range.start + 1, at);
  const after = code.slice(at, l.range.end);
  if (/\n\s*,/.test(code.slice(l.range.start, l.range.end))) return null; // (leading commas: not supported)
  const memberIndent = lines
    .slice(open + 1, close)
    .map((x) => decl.slice(x.start, x.end))
    .find((t) => /^\s*[A-Za-z_]/.test(blankCommentsAndPragmas(t)));
  const indent = memberIndent ? leading(memberIndent) : leading(decl.slice(lines[open].start, lines[open].end)) + '\t';
  const hasNext = /[A-Za-z_]/.test(after);
  if (hasNext) return wrap(decl.slice(0, at) + `${indent}${name},${eol}` + decl.slice(at));
  // The list's last member: a comma after the one before it
  const prevEnd = l.range.start + 1 + before.trimEnd().length;
  if (!/[A-Za-z_0-9)]/.test(before)) return null;
  return wrap(decl.slice(0, prevEnd) + ',' + decl.slice(prevEnd, at) + `${indent}${name}${eol}` + decl.slice(at));
}

/** The member's line wrapped in a new composite ({region "name"} … {endregion}) */
export function wrapInComposite(dutContent: string, member: string, composite: string): string | null {
  const { decl, wrap } = declOf(dutContent);
  const l = listLines(decl);
  if (!l) return null;
  const eol = decl.includes('\r\n') ? '\r\n' : '\n';
  const line = l.lines.find((x) => new RegExp(`^\\s*,?\\s*${escapeRx(member)}\\b`).test(l.code.slice(x.start, x.end)));
  if (!line) return null;
  const text = decl.slice(line.start, line.end).replace(/\r$/, '');
  const indent = leading(text);
  const lineEnd = decl[line.end - 1] === '\r' ? line.end - 1 : line.end;
  return wrap(decl.slice(0, line.start) + `${indent}{region "${composite}"}${eol}` + decl.slice(line.start, lineEnd) + `${eol}${indent}{endregion}` + decl.slice(lineEnd));
}

/** Composite pragmas with no member left removed */
export function dropEmptyComposites(dutContent: string): string {
  const { decl, wrap } = declOf(dutContent);
  let next = decl;
  for (let guard = 0; guard < 50; guard++) {
    const rx = /(\r?\n)[ \t]*\{\s*region\b[^}]*\}[ \t]*((?:\r?\n[ \t]*(?:\/\/[^\r\n]*|\(\*[\s\S]*?\*\))?[ \t]*)*?)\r?\n[ \t]*\{\s*endregion\b[^}]*\}[ \t]*(?=\r?\n)/i;
    const m = next.match(rx);
    if (!m) break;
    next = next.replace(m[0], '');
  }
  return next === decl ? dutContent : wrap(next);
}

/** A member's marks in the enum: "// @initial", "// @final" on its line */
export function enumMarksOf(dutContent: string, member: string): { initial: boolean; final: boolean } {
  const line = memberLine(dutContent, member);
  const text = line ? line.text : '';
  const comment = [...text.matchAll(/\/\/(.*)$|\(\*([\s\S]*?)\*\)/g)].map((m) => m[1] ?? m[2] ?? '').join(' ');
  return { initial: /@initial\b/i.test(comment), final: /@final\b/i.test(comment) };
}

function memberLine(dutContent: string, member: string) {
  const { decl, wrap } = declOf(dutContent);
  const l = listLines(decl);
  if (!l) return null;
  const line = l.lines.find((x) => new RegExp(`^\\s*,?\\s*${escapeRx(member)}\\b`).test(l.code.slice(x.start, x.end)));
  if (!line) return null;
  const end = decl[line.end - 1] === '\r' ? line.end - 1 : line.end;
  return { decl, wrap, start: line.start, end, text: decl.slice(line.start, end) };
}

/** The .TcDUT with a member marked (or not) "@initial" / "@final" in a comment on its line */
export function setEnumMark(dutContent: string, member: string, mark: 'initial' | 'final', on: boolean): string | null {
  const line = memberLine(dutContent, member);
  if (!line) return null;
  let text = line.text.replace(new RegExp(`\\s*@${mark}\\b`, 'gi'), '');
  // A comment left empty goes
  text = text.replace(/[ \t]*\/\/[ \t]*$/, '').replace(/[ \t]*\(\*\s*\*\)/g, '');
  if (on) text = /\/\//.test(text) ? text.replace(/\/\/[ \t]?/, `// @${mark} `) : `${text.replace(/\s+$/, '')} // @${mark}`;
  text = text.replace(/[ \t]+$/, '');
  return line.wrap(line.decl.slice(0, line.start) + text + line.decl.slice(line.end));
}

export const isValidCompositeName =(name: string) => /^[A-Za-z_][A-Za-z0-9_ ]*$/.test(name) && name.trim() === name;

// ---------------------------------------------------------------------------------------------------------------
// The POU

function setMethod(pou: string, method: string, code: string): string | null {
  const u = updateMethodCodeInPou(pou, method, code);
  return u.success ? u.updatedPou : null;
}

// "<stateVar> := STATE;" as a statement of its own (initialize())
const initAssignRx = (stateVar: string) => new RegExp(`^([ \\t]*)${escapeRx(stateVar)}\\s*:=\\s*(?:[A-Za-z_]\\w*\\s*\\.\\s*)?([A-Za-z_]\\w*)\\s*;[^\\r\\n]*$`, 'im');

/**
 * The initial state: the state variable's initial value in the POU's declaration, or (a variable inherited from
 * the base FB) its assignment in initialize(). null: none given
 */
export function initialStateOf(pouXml: string, stateVar: string): string | null {
  const decl = getPouBody(pouXml).declaration;
  const m = blankComments(decl).match(new RegExp(`^\\s*${escapeRx(stateVar)}\\s*:\\s*[A-Za-z_][\\w.]*\\s*:=\\s*(?:[A-Za-z_]\\w*\\s*\\.\\s*)?([A-Za-z_]\\w*)\\s*;`, 'im'));
  if (m) return m[1];
  const init = getMethodCodeFromPou(pouXml, 'initialize');
  return init.methodFound ? blankComments(init.code).match(initAssignRx(stateVar))?.[2] ?? null : null;
}

/** The POU with the state variable starting in this state */
export function setInitialState(pouXml: string, stateVar: string, state: string): { pou: string; where: string } | { error: string } {
  const body = getPouBody(pouXml);
  if (!body.found) return { error: body.error || 'The POU has no declaration' };
  const decl = body.declaration;
  const code = blankComments(decl);
  const rx = new RegExp(`^([ \\t]*${escapeRx(stateVar)}\\s*:\\s*[A-Za-z_][\\w.]*)(\\s*:=[^;]*)?(\\s*;)`, 'im');
  const m = code.match(rx);
  const doState = getMethodCodeFromPou(pouXml, 'doState');
  const q = stateQualifier(doState.methodFound ? doState.code : '', stateVar);
  if (!m || m.index === undefined) {
    // Inherited from the base FB: set in initialize(), after SUPER^.initialize()
    const init = getMethodCodeFromPou(pouXml, 'initialize');
    if (!init.methodFound) return { error: `${stateVar} is not declared in the POU and it has no initialize() to set it in` };
    const eol = init.code.includes('\r\n') ? '\r\n' : '\n';
    const lines = init.code.split(/\r?\n/);
    const code = blankComments(lines.join('\n')).split('\n');
    const line = `${stateVar} := ${q}${state}; // the initial state`;
    const existing = code.findIndex((l) => initAssignRx(stateVar).test(l));
    if (existing >= 0) lines[existing] = leading(lines[existing]) + line;
    else {
      const sup = code.findIndex((l) => /\bSUPER\^\s*\.\s*initialize\s*\(/i.test(l));
      lines.splice(sup + 1, 0, ...(sup >= 0 ? [line] : [line, '']));
    }
    const pou = setMethod(pouXml, 'initialize', lines.join(eol));
    return pou ? { pou, where: 'initialize()' } : { error: 'Could not change initialize()' };
  }
  const next = decl.slice(0, m.index) + decl.slice(m.index, m.index + m[1].length) + ` := ${q}${state}` + decl.slice(m.index + m[1].length + (m[2]?.length ?? 0));
  const u = updatePouBody(pouXml, next, null);
  return u.success ? { pou: u.updatedPou, where: 'the declaration' } : { error: u.error || 'Could not change the declaration' };
}

/** Lines appended to a state's doState() branch, indented like it */
function appendToBranch(pouXml: string, from: string, code: string[]): string | null {
  const method = getMethodCodeFromPou(pouXml, 'doState');
  if (!method.methodFound) return null;
  const eol = method.code.includes('\r\n') ? '\r\n' : '\n';
  const lines = method.code.split(/\r?\n/);
  const range = caseBranchRange(blankComments(lines.join('\n')).split('\n'), from);
  if (!range) return null;
  let last = range.end - 1;
  while (last > range.start && !lines[last].trim()) last--;
  const body = lines.slice(range.start + 1, range.end).find((l) => l.trim() && l.trim() !== ';');
  const indent = body ? leading(body) : leading(lines[range.start]) + '\t';
  // An empty branch's ";" goes
  if (last > range.start && lines[last].trim() === ';') lines.splice(last--, 1);
  lines.splice(last + 1, 0, ...code.map((l) => indent + l));
  return setMethod(pouXml, 'doState', lines.join(eol));
}

export interface ChoiceRow {
  condition: string;
  to: string;
}

/** A choice: IF / ELSIF (/ ELSE) transitions at the end of the state's branch, the first row checked first */
export function addChoice(pouXml: string, from: string, rows: ChoiceRow[], elseTo: string | null, stateVar: string): { pou: string } | { error: string } {
  const valid = rows.filter((r) => r.condition.trim() && r.to);
  if (valid.length === 0) return { error: 'Give at least one condition and its target' };
  if (valid.some((r) => r.to === from) || elseTo === from) return { error: `${from} cannot go to itself: that is no transition` };
  const doState = getMethodCodeFromPou(pouXml, 'doState');
  const q = stateQualifier(doState.methodFound ? doState.code : '', stateVar);
  const code: string[] = [];
  valid.forEach((r, i) => code.push(`${i === 0 ? 'IF' : 'ELSIF'} ${r.condition.trim()} THEN`, `\t${stateVar} := ${q}${r.to};`));
  if (elseTo) code.push('ELSE', `\t${stateVar} := ${q}${elseTo};`);
  code.push('END_IF');
  const pou = appendToBranch(pouXml, from, code);
  return pou ? { pou } : { error: `${from} has no CASE branch in doState()` };
}

/** Whether the state is marked final ("(* final *)" on its label) */
export function isFinalState(pouXml: string, state: string): boolean {
  const m = getMethodCodeFromPou(pouXml, 'doState');
  if (!m.methodFound) return false;
  const lines = m.code.split(/\r?\n/);
  const range = caseBranchRange(blankComments(lines.join('\n')).split('\n'), state);
  return !!range && /\(\*\s*final\s*\*\)/i.test(lines[range.start]);
}

/** The state marked final (or not) */
export function setFinalState(pouXml: string, state: string, final: boolean): { pou: string } | { error: string } {
  const m = getMethodCodeFromPou(pouXml, 'doState');
  if (!m.methodFound) return { error: 'The POU has no doState()' };
  const eol = m.code.includes('\r\n') ? '\r\n' : '\n';
  const lines = m.code.split(/\r?\n/);
  const range = caseBranchRange(blankComments(lines.join('\n')).split('\n'), state);
  if (!range) return { error: `${state} has no CASE branch in doState()` };
  const label = lines[range.start].replace(/\s*\(\*\s*final\s*\*\)/i, '');
  lines[range.start] = final ? `${label.replace(/\s+$/, '')} ${FINAL_MARK}` : label;
  const pou = setMethod(pouXml, 'doState', lines.join(eol));
  return pou ? { pou } : { error: 'Could not change doState()' };
}

/** A line for the state in getStateDescription()'s CASE (when the POU has one): its text */
export function addStateDescription(pouXml: string, state: string, text: string): string {
  const m = getMethodCodeFromPou(pouXml, 'getStateDescription');
  if (!m.methodFound) return pouXml;
  const eol = m.code.includes('\r\n') ? '\r\n' : '\n';
  const lines = m.code.split(/\r?\n/);
  const code = blankComments(lines.join('\n')).split('\n');
  if (caseBranchRange(code, state)) return pouXml;
  // After the last branch (before the CASE's ELSE / END_CASE)
  let lastLabel = -1;
  for (let i = 0; i < code.length; i++) if (labelNames(code[i]).length && !/^\s*(ELSE|END_)/i.test(code[i])) lastLabel = i;
  if (lastLabel < 0) return pouXml;
  const range = caseBranchRange(code, labelNames(code[lastLabel])[0]);
  if (!range) return pouXml;
  let last = range.end - 1;
  while (last > range.start && !lines[last].trim()) last--;
  const q = stateQualifier(m.code);
  const target = code[lastLabel].match(/:(?!=)\s*(\S.*)$/) ? `${state}: getStateDescription := '${text.replace(/'/g, '$$27')}';` : `${state}:${eol}${leading(lines[lastLabel])}\tgetStateDescription := '${text.replace(/'/g, '$$27')}';`;
  lines.splice(last + 1, 0, `${leading(lines[lastLabel])}${q}${target}`);
  return setMethod(pouXml, 'getStateDescription', lines.join(eol)) ?? pouXml;
}

/** A readable description from a state name: TABLEMANAGER_WAIT_FOR_DOOR → "Wait For Door" */
export function describeName(name: string, siblings: string[] = []): string {
  // The common prefix of the machine's states (TABLEMANAGER_) left out
  const prefix = siblings.length > 1 ? siblings.reduce((a, b) => {
    let k = 0;
    while (k < a.length && k < b.length && a[k] === b[k]) k++;
    return a.slice(0, k);
  }).replace(/[^_]*$/, '') : '';
  const core = prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
  return core
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export interface ForkRegion {
  /** The region's state variable (declared in the POU, of the enum's type) */
  variable: string;
  /** Its states in order: the first is where it starts, the last its final state */
  states: string[];
}

/** The state variables of a state's parallel regions, by state (from doState()) */
export function regionVariables(pouXml: string, dutContent: string, stateVar: string): Map<string, { variable: string; parent: string; states: string[] }> {
  const out = new Map<string, { variable: string; parent: string; states: string[] }>();
  const doState = getMethodCodeFromPou(pouXml, 'doState');
  if (!doState.methodFound || !dutContent.trim()) return out;
  for (const list of parseParallelRegions(doState.code, stateVar, new Set(enumMembersOf(dutContent))).values())
    for (const r of list) for (const s of r.states) out.set(s, { variable: r.variable, parent: r.parent, states: r.states });
  return out;
}

/**
 * A fork / join with parallel regions: each region a state variable of the enum's type (declared in the POU), its
 * states new enum members and a CASE in the state's branch. On entry (bFirstPass) every region starts in its first
 * state (fork); the state goes on to the target once every region is in its last, final state (join).
 */
export function addForkJoinRegions(
  pouXml: string,
  dutContent: string,
  from: string,
  regions: ForkRegion[],
  target: string,
  stateVar: string
): { pou: string; dut: string } | { error: string } {
  if (regions.length < 2) return { error: 'A fork has at least two regions' };
  if (!dutContent.trim()) return { error: 'Load the .TcDUT enum first: the regions’ states are members of it' };
  if (target === from) return { error: `${from} cannot go to itself: that is no transition` };
  const enumType = declOf(dutContent).decl.match(/\bTYPE\s+([A-Za-z_]\w*)/i)?.[1];
  if (!enumType) return { error: 'The enum’s TYPE was not found in the .TcDUT' };
  const doState = getMethodCodeFromPou(pouXml, 'doState');
  if (!doState.methodFound) return { error: 'The POU has no doState()' };
  if (!/\bbFirstPass\b/.test(blankComments(doState.code))) return { error: 'The regions start on entry: doState() needs bFirstPass (from the base FB)' };
  const used = blankComments(pouXml);
  const names = new Set<string>();
  for (const r of regions) {
    if (!/^[A-Za-z_]\w*$/.test(r.variable)) return { error: `${r.variable || '(empty)'} is no variable name` };
    if (new RegExp(`\\b${escapeRx(r.variable)}\\b`, 'i').test(used) || names.has(r.variable.toLowerCase())) return { error: `${r.variable} is already used` };
    names.add(r.variable.toLowerCase());
    if (!r.states.length) return { error: `The region ${r.variable} has no states` };
    for (const s of r.states) {
      if (!/^[A-Za-z_]\w*$/.test(s)) return { error: `${s} is no state name` };
      if (names.has(s.toLowerCase()) || new RegExp(`\\b${escapeRx(s)}\\b`, 'i').test(used) || enumMembersOf(dutContent).some((m) => m.toLowerCase() === s.toLowerCase()))
        return { error: `${s} is already used` };
      names.add(s.toLowerCase());
    }
  }

  // The enum: the regions' states
  let dut = dutContent;
  for (const r of regions)
    for (const s of r.states) {
      const next = addEnumMember(dut, s);
      if (!next) return { error: 'The enum list was not found in the .TcDUT' };
      dut = next;
    }

  // The declaration: the regions' variables
  const body = getPouBody(pouXml);
  if (!body.found) return { error: body.error || 'The POU has no declaration' };
  const deol = body.declaration.includes('\r\n') ? '\r\n' : '\n';
  const vars = regions.map((r) => `\t${r.variable} : ${enumType}; // parallel region of ${from}`);
  const dl = body.declaration.split(/\r?\n/);
  const dc = blankComments(dl.join('\n')).split('\n');
  const varLine = dc.findIndex((l) => /^\s*VAR\s*$/i.test(l));
  const endVar = varLine >= 0 ? dc.findIndex((l, i) => i > varLine && /^\s*END_VAR\b/i.test(l)) : -1;
  if (endVar >= 0) dl.splice(endVar, 0, ...vars);
  else dl.push('VAR', ...vars, 'END_VAR');
  const withVars = updatePouBody(pouXml, dl.join(deol), null);
  if (!withVars.success) return { error: withVars.error || 'Could not change the declaration' };

  // doState(): fork, the regions, join
  const q = stateQualifier(doState.code, stateVar);
  const code: string[] = [`// fork: ${regions.map((r) => r.variable).join(', ')} run in parallel`, 'IF bFirstPass THEN', ...regions.map((r) => `\t${r.variable} := ${q}${r.states[0]};`), 'END_IF'];
  for (const r of regions) {
    code.push(`CASE ${r.variable} OF`);
    r.states.forEach((s, i) => {
      const last = i === r.states.length - 1;
      code.push(`\t${q}${s}:${last ? ` ${FINAL_MARK}` : ''}`, last ? '\t\t;' : `\t\t// ${r.variable} := ${q}${r.states[i + 1]}; when …`);
    });
    code.push('END_CASE');
  }
  code.push(
    '// join: when every region is in its final state',
    `IF ${regions.map((r) => `${r.variable} = ${q}${r.states[r.states.length - 1]}`).join(' AND ')} THEN`,
    `\t${stateVar} := ${q}${target};`,
    'END_IF'
  );
  const pou = appendToBranch(withVars.updatedPou, from, code);
  return pou ? { pou, dut } : { error: `${from} has no CASE branch in doState()` };
}


/** A completion transition: "<stateVar> := TARGET;" with no condition at the end of the branch (taken once the state's code has run) */
export function addCompletionTransition(pouXml: string, from: string, to: string, stateVar: string): { pou: string } | { error: string } {
  if (from === to) return { error: `${from} cannot go to itself: that is no transition` };
  const doState = getMethodCodeFromPou(pouXml, 'doState');
  const q = stateQualifier(doState.methodFound ? doState.code : '', stateVar);
  const pou = appendToBranch(pouXml, from, [`${stateVar} := ${q}${to}; // completion transition`]);
  return pou ? { pou } : { error: `${from} has no CASE branch in doState()` };
}

/** A composite's first and last member in the enum's order (its sub-composites' members included) */
export function compositeSpan(dutContent: string, composite: string): { first: string; last: string } | null {
  const all = enumComposites(dutContent);
  const inside = new Set<string>();
  const add = (name: string) => {
    const c = all.find((x) => x.name === name);
    if (!c) return;
    c.members.forEach((m) => inside.add(m));
    all.filter((x) => x.parent === name).forEach((x) => add(x.name));
  };
  add(composite);
  const order = enumMembersOf(dutContent).filter((m) => inside.has(m));
  return order.length ? { first: order[0], last: order[order.length - 1] } : null;
}
const enumMembersOf = (dutContent: string) => {
  const { decl } = declOf(dutContent);
  const range = enumListRange(decl);
  if (!range) return [];
  return blankCommentsAndPragmas(decl)
    .slice(range.start + 1, range.end)
    .split(',')
    .map((part) => part.match(/^\s*([A-Za-z_]\w*)/)?.[1])
    .filter((n): n is string => !!n);
};

/**
 * An exception transition, checked before everything else:
 * - from a state: its branch becomes IF <condition> THEN <stateVar> := TARGET; ELSE <the branch as it was> END_IF;
 * - from a composite: in preProcess(), for all its states (the ">= FIRST AND <= LAST" scope the generator reads).
 */
export function addExceptionTransition(
  pouXml: string,
  dutContent: string,
  source: { state?: string; composite?: string },
  to: string,
  condition: string,
  stateVar: string
): { pou: string; where: string } | { error: string } {
  const cond = condition.trim() || 'TRUE';
  const doState = getMethodCodeFromPou(pouXml, 'doState');
  const q = stateQualifier(doState.methodFound ? doState.code : '', stateVar);
  if (source.composite) {
    const span = compositeSpan(dutContent, source.composite);
    if (!span) return { error: `The composite ${source.composite} has no states` };
    const pre = getMethodCodeFromPou(pouXml, 'preProcess');
    if (!pre.methodFound) return { error: 'The POU has no preProcess() for a composite’s exception transition' };
    const eol = pre.code.includes('\r\n') ? '\r\n' : '\n';
    const lines = pre.code.replace(/\s+$/, '').split(/\r?\n/);
    lines.push(
      `// exception transition: ${source.composite} → ${to}`,
      `IF ${stateVar} >= ${q}${span.first} AND ${stateVar} <= ${q}${span.last} AND (${cond}) THEN`,
      `\t${stateVar} := ${q}${to};`,
      'END_IF'
    );
    const pou = setMethod(pouXml, 'preProcess', lines.join(eol) + eol);
    return pou ? { pou, where: 'preProcess()' } : { error: 'Could not change preProcess()' };
  }
  const from = source.state!;
  if (from === to) return { error: `${from} cannot go to itself: that is no transition` };
  if (!doState.methodFound) return { error: 'The POU has no doState()' };
  const eol = doState.code.includes('\r\n') ? '\r\n' : '\n';
  const lines = doState.code.split(/\r?\n/);
  const range = caseBranchRange(blankComments(lines.join('\n')).split('\n'), from);
  if (!range) return { error: `${from} has no CASE branch in doState()` };
  let last = range.end - 1;
  while (last > range.start && !lines[last].trim()) last--;
  const body = lines.slice(range.start + 1, last + 1);
  const code = body.filter((l) => l.trim() && l.trim() !== ';');
  const indent = code.length ? leading(code[0]) : leading(lines[range.start]) + '\t';
  const wrapped = [
    `${indent}IF ${cond} THEN // exception transition`,
    `${indent}\t${stateVar} := ${q}${to};`,
    ...(code.length ? [`${indent}ELSE`, ...body.map((l) => (l.trim() ? '\t' + l : l)), `${indent}END_IF`] : [`${indent}END_IF`]),
  ];
  lines.splice(range.start + 1, last - range.start, ...wrapped);
  const pou = setMethod(pouXml, 'doState', lines.join(eol));
  return pou ? { pou, where: 'doState()' } : { error: 'Could not change doState()' };
}
