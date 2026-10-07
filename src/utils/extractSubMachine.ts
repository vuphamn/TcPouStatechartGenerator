/**
 * Extract to sub-machine: states of doState() moved into a method with a state machine of its own, called from a new
 * state that takes their place (the opposite of what the parser reads as a sub-machine).
 *
 * The method: their CASE branches under a CASE of its own, on an INT with a constant per state (no new .TcDUT: the web
 * edition and the XAE extension cannot add one); its start set when it is called with bStart (the new state's
 * bFirstPass); a transition between two of them a step of its own; one leaving them its exit, returned (1, 2, ...).
 * bFirstPass in their code: each state's own first cycle there (bSubFirstPass). The new state: an enum member where
 * the first of them was, its branch calls the method and goes where its exit says. The transitions into them: into the
 * new state (the sub-machine starts in the one most of them went to). Refused when one of them is used elsewhere than
 * as a state of doState() (a comparison, another method): it would no longer exist.
 */
import { getAllMethodsFromPou, getMethodCodeFromPou, updateMethodCodeInPou } from './pouStateEditor.ts';
import { caseBranchRange, checkNewStateName } from './stateEdits.ts';
import { blankComments, enumMembers } from './stateMachineLint.ts';
import { escapeRx, labelNames } from './sourceLocation.ts';
import { addEnumMemberIn, enumComposites } from './statechartEdits.ts';
import { removeEnumMember } from './stateCopyDelete.ts';

export interface ExtractSubMachinePlan {
  method: string;
  /** The new state calling it */
  state: string;
  /** Where it starts */
  entry: string;
  /** Its exits: the code it returns, the state it leads to */
  exits: { code: number; to: string }[];
  /** Transitions into the extracted states that now enter at its start instead (another one of them before) */
  enteredAt: string[];
  /** Transitions redirected into the new state */
  redirected: number;
}

const IDENT = /^[A-Za-z_]\w*$/;
const KEYWORDS = /^(IF|THEN|ELSE|ELSIF|END_IF|CASE|OF|END_CASE|FOR|TO|BY|DO|END_FOR|WHILE|END_WHILE|REPEAT|UNTIL|END_REPEAT|RETURN|EXIT|AND|OR|XOR|NOT|MOD|TRUE|FALSE|VAR|END_VAR|METHOD|FUNCTION|PROGRAM|TYPE|STRUCT)$/i;

/** Its new state's name by default: the states' common prefix (up to an "_") and the method's name in capitals */
export function defaultSubMachineState(states: string[], method: string): string {
  let prefix = states[0] ?? '';
  for (const s of states) while (!s.startsWith(prefix)) prefix = prefix.slice(0, -1);
  prefix = prefix.slice(0, prefix.lastIndexOf('_') + 1);
  return `${prefix}${method.toUpperCase()}`;
}

/** Why these states cannot be extracted into that method (null: they can) */
export function checkExtractSubMachine(pouXml: string, dutContent: string, states: string[], method: string, newState: string, stateVar: string): string | null {
  if (states.length < 2) return 'Select two or more states';
  if (!IDENT.test(method) || KEYWORDS.test(method)) return 'A method name is letters, digits and _ (not starting with a digit), not a keyword';
  if (new RegExp(`<(Method|Property|Action)\\b[^>]*\\bName="${escapeRx(method)}"`, 'i').test(pouXml)) return `${method} is already a method, property or action of the POU`;
  const nameError = checkNewStateName(pouXml, dutContent, newState);
  if (nameError) return nameError;
  const members = new Set(enumMembers(dutContent));
  const doState = getMethodCodeFromPou(pouXml, 'doState');
  if (!doState.methodFound) return 'The POU has no doState()';
  const lines = doState.code.split(/\r?\n/);
  const blanked = blankComments(doState.code).split(/\r?\n/);
  for (const s of states) {
    if (!members.has(s)) return `${s} is not a state of the enum`;
    const r = caseBranchRange(blanked, s);
    if (!r) return `${s} has no CASE branch in doState()`;
    if (labelNames(blanked[r.start]).length > 1) return `${s} shares its CASE branch with other states: split it first`;
  }
  // (used elsewhere than as a state of doState(): its label, or an assignment of the state variable)
  const assign = (s: string) => new RegExp(`\\b${escapeRx(stateVar)}\\s*:=\\s*(?:[A-Za-z_]\\w*\\s*\\.\\s*)*${escapeRx(s)}\\b`, 'g');
  const used = (text: string, s: string) => (blankComments(text).replace(assign(s), '').match(new RegExp(`\\b${escapeRx(s)}\\b`, 'g')) ?? []).length;
  for (const s of states) {
    const r = caseBranchRange(blanked, s)!;
    const outsideLabel = [...blanked.slice(0, r.start), blanked[r.start].replace(new RegExp(`(?:[A-Za-z_]\\w*\\.)?\\b${escapeRx(s)}\\b`), ''), ...blanked.slice(r.start + 1)].join('\n');
    if (used(outsideLabel, s)) return `${s} is compared or used in doState() (not only as a state there): change that first`;
    for (const m of getAllMethodsFromPou(pouXml).map((x) => x.replace(/\(\)$/, ''))) {
      if (/^doState$/i.test(m) || /^getStateDescription$/i.test(m)) continue;
      const code = getMethodCodeFromPou(pouXml, m).code ?? '';
      if (used(code, s)) return `${s} is used in ${m}(): change that first`;
    }
  }
  // (a state machine: at least one transition between them)
  const inside = states.some((s) => {
    const r = caseBranchRange(blanked, s)!;
    const text = blanked.slice(r.start + 1, r.end).join('\n');
    return states.some((t) => t !== s && assign(t).test(text));
  });
  if (!inside) return 'No transition between them: there would be no state machine to make of them';
  void lines;
  return null;
}

/** The states extracted into the method, a new state calling it */
export function extractSubMachine(
  pouXml: string,
  dutContent: string,
  states: string[],
  method: string,
  stateVar: string,
  newState = defaultSubMachineState(states, method)
): { pou: string; dut: string; plan: ExtractSubMachinePlan } | { error: string } {
  const error = checkExtractSubMachine(pouXml, dutContent, states, method, newState, stateVar);
  if (error) return { error };
  const doState = getMethodCodeFromPou(pouXml, 'doState');
  const eol = doState.code.includes('\r\n') ? '\r\n' : '\n';
  const lines = doState.code.split(/\r?\n/);
  const blanked = blankComments(doState.code).split(/\r?\n/);
  const selected = new Set(states);
  // (their branches, in the code's order)
  const ranges = states.map((s) => ({ s, ...caseBranchRange(blanked, s)! })).sort((a, b) => a.start - b.start);
  const inRanges = (i: number) => ranges.some((r) => i >= r.start && i < r.end);
  const assignAny = new RegExp(`\\b(${escapeRx(stateVar)}\\s*:=\\s*)((?:[A-Za-z_]\\w*\\s*\\.\\s*)*)([A-Za-z_]\\w*)`, 'g');

  // 1. Where the sub-machine starts: the state the transitions into them go to most (else the first of them)
  const into = new Map<string, number>();
  const count = (text: string) => {
    for (const m of blankComments(text).matchAll(assignAny)) if (selected.has(m[3])) into.set(m[3], (into.get(m[3]) ?? 0) + 1);
  };
  count(lines.filter((_, i) => !inRanges(i)).join('\n'));
  for (const m of ['preProcess', 'initialize']) count(getMethodCodeFromPou(pouXml, m).code ?? '');
  const entry = [...into].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ranges[0].s;
  const enteredAt = [...into.keys()].filter((s) => s !== entry);

  // 2. The method: their branches under its own CASE; a transition among them its step, one leaving them its exit
  const eState = `e${method}State`;
  const exits: { code: number; to: string }[] = [];
  const exitOf = (to: string) => {
    let e = exits.find((x) => x.to === to);
    if (!e) exits.push((e = { code: exits.length + 1, to }));
    return e.code;
  };
  const indentOf = (l: string) => l.match(/^[ \t]*/)![0];
  const body: string[] = [];
  for (const r of ranges) {
    const own = lines.slice(r.start + 1, r.end);
    const ownBlank = blanked.slice(r.start + 1, r.end);
    const base = ownBlank.filter((l) => l.trim()).map(indentOf).sort((a, b) => a.length - b.length)[0] ?? '';
    body.push(`\t${r.s}:`);
    own.forEach((line, k) => {
      let out = line;
      // (only where it is code: the comments blanked out where the matches are looked for)
      const code = ownBlank[k];
      const edits: { at: number; len: number; text: string }[] = [];
      for (const m of code.matchAll(assignAny)) {
        const to = m[3];
        const text = selected.has(to) ? `${eState} := ${to}` : `${method} := ${exitOf(to)}`;
        edits.push({ at: m.index!, len: m[0].length, text });
      }
      for (const m of code.matchAll(/\bbFirstPass\b/g)) edits.push({ at: m.index!, len: m[0].length, text: 'bSubFirstPass' });
      for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.at + e.len);
      body.push(line.trim() ? `\t\t${out.startsWith(base) ? out.slice(base.length) : out.trimStart()}` : '');
    });
  }
  const exitComment = exits.map((e) => `${e.code}: to ${e.to}`).join(', ');
  const methodCode = [
    `${method} := 0;`,
    `// Started by its state's first cycle; each state's own first cycle (as bFirstPass is a state's in doState())`,
    `IF bStart THEN`,
    `\t${eState} := ${entry};`,
    `END_IF`,
    `bSubFirstPass := bStart OR ${eState} <> ${eState}Prev;`,
    `${eState}Prev := ${eState};`,
    `CASE ${eState} OF`,
    ...body,
    `END_CASE`,
  ].join(eol);
  const methodDecl = [
    `METHOD ${method} : INT`,
    `// ${states.join(', ')}: states of doState() once, moved here (Extract to sub-machine), run while ${newState} is current.`,
    `// Returns 0 while it runs, else where it goes on (${exitComment || 'none'})`,
    `VAR_INPUT`,
    `\tbStart\t: BOOL;`,
    `END_VAR`,
    `VAR_INST`,
    `\t${eState}\t: INT;`,
    `\t${eState}Prev\t: INT := -1;`,
    `END_VAR`,
    `VAR`,
    `\tbSubFirstPass\t: BOOL;`,
    `END_VAR`,
    `VAR CONSTANT`,
    ...states.map((s, i) => `\t${s}\t: INT := ${i};`),
    `END_VAR`,
    ``,
  ].join(eol);

  // 3. doState(): their branches out, the new state's in where the first one was; its exits as its transitions
  const label = lines[ranges[0].start];
  const labelIndent = indentOf(label);
  const qualifier = label.trim().match(/^([A-Za-z_]\w*)\.[A-Za-z_]\w*\s*:/)?.[1];
  const stateRef = (s: string) => (qualifier ? `${qualifier}.${s}` : s);
  const inner = `${labelIndent}\t`;
  const exitVar = `i${method}Exit`;
  const newBranch = [
    `${labelIndent}${stateRef(newState)}:`,
    `${inner}// ${states.join(', ')}: in ${method}() (Extract to sub-machine)`,
    `${inner}${exitVar} := ${method}(bStart := bFirstPass);`,
    ...exits.flatMap((e, i) => [`${inner}${i === 0 ? 'IF' : 'ELSIF'} ${exitVar} = ${e.code} THEN`, `${inner}\t${stateVar} := ${stateRef(e.to)};`]),
    ...(exits.length ? [`${inner}END_IF`] : []),
    '',
  ];
  const kept: string[] = [];
  let placed = false;
  lines.forEach((l, i) => {
    if (inRanges(i)) {
      if (!placed && i === ranges[0].start) {
        kept.push(...newBranch);
        placed = true;
      }
      return;
    }
    kept.push(l);
  });
  // (the transitions into them: into the new state)
  let redirected = 0;
  const redirect = (text: string) =>
    text.replace(assignAny, (m, head: string, q: string, to: string) => {
      if (!selected.has(to)) return m;
      redirected++;
      return `${head}${q}${newState}`;
    });
  const doStateCode = kept.map((l) => (l.includes(':=') ? redirect(l) : l)).join(eol);
  const doStateDecl = (doState.declaration ?? 'METHOD doState\r\n').replace(/\s*$/, '') + `${eol}VAR${eol}\t${exitVar}\t: INT;\t// where ${method}() goes on (0: it runs)${eol}END_VAR${eol}`;
  let pou = pouXml;
  const u1 = updateMethodCodeInPou(pou, 'doState', doStateCode, doStateDecl);
  if (!u1.success) return { error: u1.error || 'Could not change doState()' };
  pou = u1.updatedPou;
  for (const m of ['preProcess', 'initialize']) {
    const c = getMethodCodeFromPou(pou, m);
    if (!c.methodFound) continue;
    const next = redirect(c.code);
    if (next !== c.code) {
      const u = updateMethodCodeInPou(pou, m, next);
      if (u.success) pou = u.updatedPou;
    }
  }
  // (the declared initial value)
  pou = pou.replace(new RegExp(`(\\b${escapeRx(stateVar)}\\s*:\\s*[A-Za-z_][\\w.]*\\s*:=\\s*(?:[A-Za-z_]\\w*\\s*\\.\\s*)*)(${states.map(escapeRx).join('|')})\\b`), (_, head: string) => `${head}${newState}`);
  const u2 = updateMethodCodeInPou(pou, method, methodCode, methodDecl);
  if (!u2.success) return { error: u2.error || `Could not add ${method}()` };
  pou = u2.updatedPou;

  // 4. The enum: the new state where the first of them was (its composite), theirs out
  const composite = enumComposites(dutContent).find((c) => c.members.includes(ranges[0].s))?.name ?? null;
  let dut = addEnumMemberIn(dutContent, newState, composite);
  if (!dut) return { error: `Could not add ${newState} to the enum` };
  for (const s of states) {
    const r = removeEnumMember(dut, s);
    if (r) dut = r.dut;
  }
  return { pou, dut, plan: { method, state: newState, entry, exits, enteredAt, redirected } };
}
