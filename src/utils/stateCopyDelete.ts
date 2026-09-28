/**
 * A state copied (Ctrl+C / Ctrl+V on the canvas) or deleted, in the .TcPOU and the .TcDUT:
 * - copy: a new enum member (at the end, so no other state's value changes) and a copy of the state's branch in
 *   doState() right after it (its actions and transitions; "<stateVar> := STATE" in it goes to the copy), and in the
 *   other methods that CASE over the states (getStateDescription: the text with " (copy)");
 * - delete: the transitions into it (doState() and preProcess()), its branches, its enum member; what refers to it
 *   after that is listed (a range bound in preProcess(), a comparison…) for the user to change.
 */

import { addEnumMember, blankComments, enumListRange, stateAtLine } from './stateMachineLint.ts';
import { getAllMethodsFromPou, getMethodCodeFromPou, updateMethodCodeInPou } from './pouStateEditor.ts';
import { escapeRx, labelNames } from './sourceLocation.ts';
import { caseBranchRange, checkNewStateName } from './stateEdits.ts';
import { stateQualifier } from './stateNames.ts';
import { deleteTransition, leading } from './transitionEdits.ts';

const blankedLines = (lines: string[]) => blankComments(lines.join('\n')).split('\n');
const isPreProcess = (m: string) => /^preProcess$/i.test(m);

function setMethod(pou: string, method: string, code: string): string {
  const u = updateMethodCodeInPou(pou, method, code);
  if (!u.success) throw new Error(u.error || `Could not change ${method}()`);
  return u.updatedPou;
}

/** A free name for a copy: NAME_COPY, NAME_COPY2, … */
/** taken: names already given in this paste (several states copied at once) */
export function copyName(pouXml: string, dutContent: string, name: string, taken: string[] = []): string {
  for (let i = 1; ; i++) {
    const candidate = `${name}_COPY${i === 1 ? '' : i}`;
    if (!taken.some((n) => n.toLowerCase() === candidate.toLowerCase()) && !checkNewStateName(pouXml, dutContent, candidate)) return candidate;
  }
}

export interface CopyResult {
  pou: string;
  /** null: no .TcDUT loaded */
  dut: string | null;
  methods: string[];
}

/** The state copied as a new state */
export function copyState(pouXml: string, dutContent: string, from: string, name: string, stateVar: string): CopyResult | { error: string } {
  const why = checkNewStateName(pouXml, dutContent, name);
  if (why) return { error: why };
  let pou = pouXml;
  const methods: string[] = [];
  const selfRx = new RegExp(`(\\b${escapeRx(stateVar)}\\s*:=\\s*(?:[A-Za-z_]\\w*\\s*\\.\\s*)*)${escapeRx(from)}\\b`, 'g');
  try {
    for (const method of getAllMethodsFromPou(pouXml)) {
      if (isPreProcess(method)) continue;
      const m = getMethodCodeFromPou(pou, method);
      if (!m.methodFound) continue;
      const eol = m.code.includes('\r\n') ? '\r\n' : '\n';
      const lines = m.code.split(/\r?\n/);
      const code = blankedLines(lines);
      const range = caseBranchRange(code, from);
      if (!range) continue;
      // The label: the copy's name alone (a shared label: only this state), the code after it kept
      const colon = code[range.start].search(/:(?!=)/);
      const afterLabel = lines[range.start].slice(colon + 1);
      const body = lines.slice(range.start + 1, range.end);
      while (body.length && !body[body.length - 1].trim()) body.pop();
      const labelIndent = leading(lines[range.start]);
      let copy = [`${labelIndent}${stateQualifier(m.code, stateVar)}${name}:${afterLabel}`, ...body].map((l) => l.replace(selfRx, `$1${name}`));
      if (!afterLabel.trim() && !body.some((l) => l.trim())) copy.push(`${labelIndent}\t;`);
      // A description / text table: the text marked as the copy's
      if (!/^doState$/i.test(method)) {
        let marked = false;
        copy = copy.map((l) => (marked ? l : l.replace(/'([^']*)'/, (_, t) => ((marked = true), `'${t} (copy)'`))));
      }
      // Right after the state's branch (a blank line before it, as between the branches there)
      let last = range.end - 1;
      while (last > range.start && !lines[last].trim()) last--;
      const gap = last + 1 < range.end && !lines[last + 1].trim() ? [''] : [];
      lines.splice(last + 1, 0, ...gap, ...copy);
      pou = setMethod(pou, method, lines.join(eol));
      methods.push(method);
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (!methods.some((m) => /^doState$/i.test(m))) return { error: `${from} has no CASE branch in doState()` };
  let dut: string | null = null;
  if (dutContent?.trim()) {
    dut = addEnumMember(dutContent, name);
    if (!dut) return { error: 'The enum list was not found in the .TcDUT' };
  }
  return { pou, dut, methods };
}

/** The .TcDUT without an enum member; renumbered: a member after it has no value of its own (its value changes) */
export function removeEnumMember(dutContent: string, name: string): { dut: string; renumbered: boolean } | null {
  const declMatch = dutContent.match(/(<Declaration>\s*<!\[CDATA\[)([\s\S]*?)(\]\]>)/i);
  const decl = declMatch ? declMatch[2] : dutContent;
  const range = enumListRange(decl);
  if (!range) return null;
  const code = blankComments(decl).replace(/\{[^{}\n]*\}/g, (m) => ' '.repeat(m.length));
  // The list's items, between its commas
  const items: { s: number; e: number }[] = [];
  let s0 = range.start + 1;
  for (let i = range.start + 1; i < range.end; i++) {
    if (code[i] === ',') {
      items.push({ s: s0, e: i });
      s0 = i + 1;
    }
  }
  items.push({ s: s0, e: range.end });
  const idOf = (it: { s: number; e: number }) => code.slice(it.s, it.e).match(/^\s*([A-Za-z_]\w*)/)?.[1];
  const k = items.findIndex((it) => idOf(it) === name);
  const named = items.filter((it) => idOf(it));
  if (k < 0 || named.length < 2) return null;
  const renumbered = items.slice(k + 1).some((it) => idOf(it) && !/:=/.test(code.slice(it.s, it.e)));
  // Over the rest of the line when it is only blanks / comments (not the line break)
  const toLineEnd = (p: number) => {
    let q = p;
    while (q < range.end && code[q] !== '\n' && code[q] !== '\r' && /\s/.test(code[q])) q++;
    return code[q] === '\n' || code[q] === '\r' ? q : p;
  };
  // From the line break before the member, when it starts its line
  const lineStart = (it: { s: number; e: number }) => {
    const id = it.s + code.slice(it.s, it.e).search(/\S/);
    const nl = decl.lastIndexOf('\n', id);
    if (nl < it.s || decl.slice(nl + 1, id).trim()) return it.s;
    return decl[nl - 1] === '\r' ? nl - 1 : nl;
  };
  const it = items[k];
  let next: string;
  if (k < items.length - 1 && idOf(items[k + 1])) {
    // "MEMBER," with its line
    next = decl.slice(0, lineStart(it)) + decl.slice(toLineEnd(items[k + 1].s));
  } else {
    // The last member: the comma before it too
    const end = toLineEnd(it.s + code.slice(it.s, it.e).trimEnd().length);
    next = decl.slice(0, it.s - 1) + decl.slice(it.s, lineStart(it)) + decl.slice(end);
  }
  return { dut: declMatch ? dutContent.replace(declMatch[0], () => declMatch[1] + next + declMatch[3]) : next, renumbered };
}

export interface DeleteResult {
  pou: string;
  dut: string | null;
  /** The transitions into the state that were deleted */
  transitions: string[];
  /** The methods whose branch of the state was deleted */
  methods: string[];
  /** Still referring to the state: "doState() line 12: …" (for the user to change) */
  remaining: string[];
  /** Transitions into it that could not be deleted, and why */
  kept: string[];
  renumbered: boolean;
}

/** The state deleted: the transitions into it, its branches, its enum member */
export function deleteState(pouXml: string, dutContent: string, name: string, stateVar: string): DeleteResult | { error: string } {
  let pou = pouXml;
  const transitions: string[] = [];
  const kept: string[] = [];
  const assignRx = new RegExp(`\\b${escapeRx(stateVar)}\\s*:=\\s*(?:[A-Za-z_]\\w*\\s*\\.\\s*)*${escapeRx(name)}\\b`);
  try {
    // 1. The transitions into it: doState() (outside its own branch), then preProcess()
    const failed = new Set<string>();
    for (let guard = 0; guard < 500; guard++) {
      const m = getMethodCodeFromPou(pou, 'doState');
      if (!m.methodFound) break;
      const code = blankedLines(m.code.split(/\r?\n/));
      const from = code
        .map((l, i) => (assignRx.test(l) ? stateAtLine(pou, i + 1) : null))
        .find((s): s is string => !!s && s !== name && !failed.has(s));
      if (!from) break;
      const r = deleteTransition(pou, { from, to: name }, stateVar);
      if ('error' in r) {
        failed.add(from);
        kept.push(`${from} → ${name}: ${r.error}`);
        continue;
      }
      pou = setMethod(pou, r.method, r.code);
      transitions.push(`${from} → ${name}`);
    }
    for (let guard = 0; guard < 100; guard++) {
      const m = getMethodCodeFromPou(pou, 'preProcess');
      if (!m.methodFound || !blankedLines(m.code.split(/\r?\n/)).some((l) => assignRx.test(l))) break;
      const r = deleteTransition(pou, { from: 'AnyState', to: name, condition: '[preProcess]' }, stateVar);
      if ('error' in r) {
        kept.push(`preProcess() → ${name}: ${r.error}`);
        break;
      }
      pou = setMethod(pou, r.method, r.code);
      transitions.push(`preProcess() → ${name}`);
    }

    // 2. Its branches (a shared label: only its name goes)
    const methods: string[] = [];
    for (const method of getAllMethodsFromPou(pou)) {
      if (isPreProcess(method)) continue;
      const m = getMethodCodeFromPou(pou, method);
      if (!m.methodFound) continue;
      const eol = m.code.includes('\r\n') ? '\r\n' : '\n';
      const lines = m.code.split(/\r?\n/);
      const code = blankedLines(lines);
      const range = caseBranchRange(code, name);
      if (!range) continue;
      if (labelNames(code[range.start]).length > 1) {
        const q = '(?:[A-Za-z_]\\w*\\s*\\.\\s*)?';
        const own = new RegExp(`${q}${escapeRx(name)}\\s*,\\s*|\\s*,\\s*${q}${escapeRx(name)}\\b`);
        lines[range.start] = lines[range.start].replace(own, '');
      } else {
        lines.splice(range.start, range.end - range.start);
      }
      pou = setMethod(pou, method, lines.join(eol));
      methods.push(method);
    }
    if (!methods.some((m) => /^doState$/i.test(m)) && !dutContent.includes(name)) return { error: `${name} has no CASE branch in doState() and is not in the enum` };

    // 3. The enum member
    let dut: string | null = null;
    let renumbered = false;
    if (dutContent?.trim()) {
      const r = removeEnumMember(dutContent, name);
      if (r) {
        dut = r.dut;
        renumbered = r.renumbered;
      }
    }

    // 4. What still refers to it
    const remaining: string[] = [];
    const word = new RegExp(`\\b${escapeRx(name)}\\b`);
    for (const method of getAllMethodsFromPou(pou)) {
      const m = getMethodCodeFromPou(pou, method);
      if (!m.methodFound) continue;
      const lines = m.code.split(/\r?\n/);
      blankedLines(lines).forEach((l, i) => word.test(l) && remaining.push(`${method}() line ${i + 1}: ${lines[i].trim()}`));
    }
    const everywhere = (blankComments(pou).match(new RegExp(word.source, 'g')) ?? []).length;
    if (everywhere > remaining.length) remaining.push(`${everywhere - remaining.length} more in the POU's declaration / body`);
    return { pou, dut, transitions, methods, remaining, kept, renumbered };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Several states copied at once (names: the copies' names, in the same order): each as copyState does, then in the
 * copies' branches a transition to another of the copied states goes to its copy (the group copied as a whole).
 */
export function copyStates(pouXml: string, dutContent: string, froms: string[], names: string[], stateVar: string): { pou: string; dut: string | null; methods: string[] } | { error: string } {
  let pou = pouXml;
  let dut: string | null = dutContent?.trim() ? dutContent : null;
  const methods = new Set<string>();
  for (let i = 0; i < froms.length; i++) {
    const r = copyState(pou, dut ?? '', froms[i], names[i], stateVar);
    if ('error' in r) return { error: `${froms[i]}: ${r.error}` };
    pou = r.pou;
    if (r.dut) dut = r.dut;
    r.methods.forEach((m) => methods.add(m));
  }
  // The copies' transitions to the other copied states: to their copies
  for (const method of methods) {
    const m = getMethodCodeFromPou(pou, method);
    if (!m.methodFound) continue;
    const eol = m.code.includes('\r\n') ? '\r\n' : '\n';
    const lines = m.code.split(/\r?\n/);
    const code = blankedLines(lines);
    let changed = false;
    for (const name of names) {
      const range = caseBranchRange(code, name);
      if (!range) continue;
      for (let l = range.start + 1; l < range.end; l++) {
        let line = lines[l];
        froms.forEach((from, k) => {
          const rx = new RegExp(`(\\b${escapeRx(stateVar)}\\s*:=\\s*(?:[A-Za-z_]\\w*\\s*\\.\\s*)*)${escapeRx(from)}\\b`, 'g');
          line = line.replace(rx, `$1${names[k]}`);
        });
        if (line !== lines[l]) {
          lines[l] = line;
          changed = true;
        }
      }
    }
    if (changed) pou = setMethod(pou, method, lines.join(eol));
  }
  return { pou, dut: dut === dutContent ? null : dut, methods: [...methods] };
}
