/**
 * Sub-machines: a state's branch of doState() calls a method of the POU whose body is a state machine of its own (a
 * CASE on its own variable, e.g. a VAR_INST of another enum), as EFX_IDLE calls RpsSimulation() in its test mode.
 * Found here: which state calls which method, under what condition (the IFs around the call), whether a RETURN after
 * it keeps the state's own transitions from being looked at meanwhile, the method's states (its CASE labels, in their
 * order), its transitions ("<variable> := X" under a label, with the IFs around them), and where it starts (the
 * variable set before its CASE: under an input of the method, the call's argument for it says when; a rising edge's
 * Q: "↑ <its CLK>").
 */

import { unqualifyState } from './stateNames.ts';
import { caseArmCondition, caseLabelOf, caseSelectorOf, splitStatements } from './stStatements.ts';

/** A CASE nested in a branch: its arms as conditions in the IFs' list (at: its place there) */
interface CaseFrame {
  sel: string;
  at: number;
  prior: string[];
}
/** A line of a nested CASE (its start, an arm, its ELSE, its end): the IFs' list updated; true when it was one */
function nestedCaseLine(l: string, nested: boolean, ifs: string[], frames: CaseFrame[]): boolean {
  const sel = nested ? caseSelectorOf(l) : null;
  if (sel) {
    frames.push({ sel, at: ifs.length, prior: [] });
    ifs.push('');
    return true;
  }
  const top = frames[frames.length - 1];
  if (!top) return false;
  if (/^END_CASE\b/i.test(l)) {
    ifs.length = top.at;
    frames.pop();
    return true;
  }
  // (an arm or its ELSE: only while no IF of its own is open)
  if (ifs.length - 1 !== top.at) return false;
  const labels = caseLabelOf(l);
  if (labels) {
    if (ifs[top.at]) top.prior.push(ifs[top.at]);
    ifs[top.at] = caseArmCondition(top.sel, labels);
    return true;
  }
  if (/^ELSE$/i.test(l)) {
    if (ifs[top.at]) top.prior.push(ifs[top.at]);
    ifs[top.at] = top.prior.length ? `NOT (${top.prior.join(' OR ')})` : '';
    return true;
  }
  return false;
}

export interface SubMachine {
  /** The state whose branch calls it */
  parent: string;
  method: string;
  /** The method's state variable (its CASE) */
  variable: string;
  /** Its states, as in its CASE (unqualified) */
  states: string[];
  start: string | null;
  /** When it starts: the call's argument for the input its start is set under (a rising edge: ↑ …), else the call's condition */
  entry: string | null;
  /** The conditions around the call (it runs only then) */
  when: string | null;
  /** A RETURN after the call: the state's own transitions are not looked at while it runs */
  preempts: boolean;
  transitions: { from: string; to: string; guard: string | null }[];
  /** Its states nothing goes to (not its start): never reached */
  unreachable: string[];
}

const stripComments = (s: string) => s.replace(/\(\*[\s\S]*?\*\)/g, '').replace(/\/\/[^\r\n]*/g, '');
const clean = (s: string) => {
  let t = s.replace(/\s+/g, ' ').trim();
  // (one pair of brackets around all of it)
  if (/^\(.*\)$/.test(t)) {
    let depth = 0;
    let whole = true;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '(') depth++;
      else if (t[i] === ')') depth--;
      if (depth === 0 && i < t.length - 1) whole = false;
    }
    if (whole) t = t.slice(1, -1).trim();
  }
  return t;
};
const KEYWORDS = /^(IF|ELSIF|WHILE|FOR|CASE|REPEAT|UNTIL|NOT|AND|OR|XOR|MOD|ABS|SQRT|MIN|MAX|SEL|MUX|LIMIT|TO_\w+|\w+_TO_\w+|SIZEOF|ADR|REF|TRUNC|LEN|LEFT|RIGHT|MID|CONCAT)$/i;

/** A method's VAR_INPUT names, in order (its declaration) */
function inputsOf(decl: string | null): string[] {
  if (!decl) return [];
  const m = /VAR_INPUT\b([\s\S]*?)END_VAR/i.exec(stripComments(decl));
  if (!m) return [];
  return [...m[1].matchAll(/^\s*([A-Za-z_]\w*)\s*:/gm)].map((x) => x[1]);
}

/** The method's state machine: its first CASE whose labels are names and that sets its own variable */
function machineOf(st: string): { variable: string; states: string[]; transitions: SubMachine['transitions']; start: string | null; startUnder: string | null } | null {
  const lines = stripComments(st).split(/\r?\n/).flatMap((l) => splitStatements(l.trim()));
  const frames: CaseFrame[] = [];
  const caseAt = lines.findIndex((l) => /^CASE\s*\(?\s*[A-Za-z_][\w.]*\s*\)?\s*OF\b/i.test(l));
  if (caseAt < 0) return null;
  const variable = lines[caseAt].match(/^CASE\s*\(?\s*([A-Za-z_][\w.]*)/i)![1];
  const own = (v: string) => v.replace(/^THIS\^\./i, '').toLowerCase();
  const states: string[] = [];
  const transitions: SubMachine['transitions'] = [];
  const ifs: string[] = [];
  let depth = 0;
  let current: string | null = null;
  // (where it starts: set before its CASE, under the IF around it)
  let start: string | null = null;
  let startUnder: string | null = null;
  const before: string[] = [];
  for (let i = 0; i < caseAt; i++) {
    const l = lines[i];
    const mIf = l.match(/^IF\b(.*?)\bTHEN\b/i);
    if (mIf) before.push(clean(mIf[1]));
    else if (/^ELSE\b/i.test(l) && before.length) before[before.length - 1] = `NOT (${before[before.length - 1]})`;
    else if (/^END_IF\b/i.test(l)) before.pop();
    const a = l.match(/^([A-Za-z_][\w.^]*)\s*:=\s*([A-Za-z_][\w.]*)\s*;/);
    if (a && own(a[1]) === own(variable) && !start) {
      start = unqualifyState(a[2]);
      startUnder = before.length ? before[before.length - 1] : null;
    }
  }
  for (let i = caseAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (/^CASE\b/i.test(l)) {
      depth++;
      if (current) nestedCaseLine(l, true, ifs, frames);
      continue;
    }
    if (/^END_CASE\b/i.test(l)) {
      if (depth === 0) break;
      nestedCaseLine(l, false, ifs, frames);
      depth--;
      continue;
    }
    if (depth > 0 && current && nestedCaseLine(l, false, ifs, frames)) continue;
    if (depth === 0) {
      const lab = l.match(/^((?:[A-Za-z_][\w.]*\s*,\s*)*[A-Za-z_][\w.]*)\s*:(?!=)\s*$/) ?? l.match(/^((?:[A-Za-z_][\w.]*\s*,\s*)*[A-Za-z_][\w.]*)\s*:(?!=)/);
      if (lab && !/^(ELSE|ELSIF|IF|END_\w+|THEN)\b/i.test(l)) {
        const names = lab[1].split(',').map((n) => unqualifyState(n.trim()));
        states.push(...names);
        current = names[0];
        ifs.length = 0;
        continue;
      }
    }
    if (!current) continue;
    const mIf = l.match(/^IF\b(.*?)\bTHEN\b/i);
    const mEl = l.match(/^ELSIF\b(.*?)\bTHEN\b/i);
    if (mIf) ifs.push(clean(mIf[1]));
    else if (mEl && ifs.length) ifs[ifs.length - 1] = clean(mEl[1]);
    else if (/^ELSE\b/i.test(l) && ifs.length) ifs[ifs.length - 1] = `NOT (${ifs[ifs.length - 1]})`;
    for (const a of l.matchAll(/\b([A-Za-z_][\w.^]*)\s*:=\s*([A-Za-z_][\w.]*)/g)) {
      if (own(a[1]) !== own(variable)) continue;
      const to = unqualifyState(a[2]);
      const guard = ifs.filter(Boolean).join(' AND ');
      if (to !== current) transitions.push({ from: current, to, guard: guard || null });
    }
    if (/^END_IF\b/i.test(l)) ifs.pop();
  }
  // (a state machine: at least two states, and it moves between them)
  if (states.length < 2 || !transitions.length) return null;
  return { variable, states: [...new Set(states)], transitions, start, startUnder };
}

/**
 * The sub-machines of a POU's doState(): st: doState's ST; methods: the POU's methods, by name ({ st, decl }); allSt:
 * the rest of the POU's code (a rising edge's CLK may be set elsewhere)
 */
export function findSubMachines(st: string | null, methods: Map<string, { st: string | null; decl: string | null }>, allSt = ''): SubMachine[] {
  if (!st || !methods.size) return [];
  const byLower = new Map([...methods.keys()].map((k) => [k.toLowerCase(), k]));
  const lines = stripComments(st).split(/\r?\n/).flatMap((l) => splitStatements(l.trim()));
  const out: SubMachine[] = [];
  const seen = new Set<string>();
  const frames: CaseFrame[] = [];
  let depth = 0;
  let parent: string | null = null;
  const ifs: string[] = [];
  const own = (v: string) => v.split('.').pop()!.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    const caseM = l.match(/^CASE\s*\(?\s*([A-Za-z_][\w.]*)\s*\)?\s*OF\b/i);
    if (caseM) {
      depth++;
      if (depth >= 2 && parent) nestedCaseLine(l, true, ifs, frames);
      continue;
    }
    if (/^END_CASE\b/i.test(l)) {
      if (depth >= 2) nestedCaseLine(l, false, ifs, frames);
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth >= 2 && parent && nestedCaseLine(l, false, ifs, frames)) continue;
    const lab = l.match(/^((?:[A-Za-z_][\w.]*\s*,\s*)*[A-Za-z_][\w.]*)\s*:(?!=)/);
    if (depth === 1 && lab && !/^(ELSE|ELSIF|IF|END_\w+|THEN)\b/i.test(l)) {
      parent = unqualifyState(lab[1].split(',')[0].trim());
      ifs.length = 0;
      frames.length = 0;
      continue;
    }
    if (!parent || depth < 1) continue;
    const mIf = l.match(/^IF\b(.*?)\bTHEN\b/i);
    const mEl = l.match(/^ELSIF\b(.*?)\bTHEN\b/i);
    if (mIf) ifs.push(clean(mIf[1]));
    else if (mEl && ifs.length) ifs[ifs.length - 1] = clean(mEl[1]);
    else if (/^ELSE\b/i.test(l) && ifs.length) ifs[ifs.length - 1] = `NOT (${ifs[ifs.length - 1]})`;
    // A call of one of the POU's methods (not a member's: "fb.method(" is another FB's)
    for (const c of l.matchAll(/(?:^|[^\w.^])(?:THIS\^\.)?([A-Za-z_]\w*)\s*\(([^;]*)\)\s*;?/g)) {
      const method = byLower.get(c[1].toLowerCase());
      if (!method || KEYWORDS.test(c[1]) || own(method) === 'dostate') continue;
      const key = `${parent}|${method}`;
      if (seen.has(key)) continue;
      const m = methods.get(method)!;
      const machine = m.st ? machineOf(m.st) : null;
      if (!machine) continue;
      seen.add(key);
      // (a RETURN after it, before the IF around it ends: the state's own transitions wait)
      let preempts = false;
      for (let j = i + 1, d = 0; j < lines.length; j++) {
        const n = lines[j];
        if (/^IF\b/i.test(n) && !/\bEND_IF\b/i.test(n)) d++;
        if (/^END_IF\b/i.test(n)) {
          if (d === 0) break;
          d--;
        }
        if (d === 0 && /^RETURN\s*;?$/i.test(n)) {
          preempts = true;
          break;
        }
        if (/^((?:[A-Za-z_][\w.]*\s*,\s*)*[A-Za-z_][\w.]*)\s*:(?!=)/.test(n) && !/^(ELSE|ELSIF|IF|END_\w+|THEN)\b/i.test(n)) break;
      }
      const when = ifs.filter(Boolean).join(' AND ') || null;
      // Where it starts, and when: the input its start is set under, and the call's argument for it
      let entry = when;
      if (machine.startUnder) {
        const inputs = inputsOf(m.decl);
        const args = c[2].split(',').map((a) => a.trim()).filter(Boolean);
        const named = new Map(args.map((a) => a.match(/^([A-Za-z_]\w*)\s*:=\s*(.+)$/)).filter((x): x is RegExpMatchArray => !!x).map((x) => [x[1].toLowerCase(), x[2].trim()]));
        const idx = inputs.findIndex((n) => n.toLowerCase() === machine.startUnder!.toLowerCase());
        const arg = named.get(machine.startUnder.toLowerCase()) ?? (idx >= 0 && !named.size ? args[idx] : undefined);
        if (arg) {
          // (a rising edge's Q: when its CLK rises)
          const q = arg.match(/^([A-Za-z_]\w*)\.Q$/);
          const clk = q ? new RegExp(`\\b${q[1]}\\s*\\(\\s*CLK\\s*:=\\s*([^,)]+)`, 'i').exec(`${st}\n${allSt}`)?.[1]?.trim() : null;
          entry = clk ? `↑ ${clk}` : arg;
        }
      }
      const reached = new Set([machine.start, ...machine.transitions.map((t) => t.to)].filter(Boolean));
      out.push({
        parent, method, variable: machine.variable, states: machine.states, start: machine.start ?? machine.states[0], entry, when, preempts,
        transitions: machine.transitions, unreachable: machine.states.filter((s) => !reached.has(s)),
      });
    }
    if (/^END_IF\b/i.test(l)) ifs.pop();
  }
  return out;
}

/**
 * The sub-machines of doState(), and theirs (a sub-machine's state calling another method with a state machine of
 * its own: its parent that state's id, <state>__<method>__<name>), outer ones first; a method calling itself or one
 * around it is not one again; at most `maxDepth` deep
 */
export function findAllSubMachines(st: string | null, methods: Map<string, { st: string | null; decl: string | null }>, allSt = '', maxDepth = 4): SubMachine[] {
  const out: SubMachine[] = [];
  const walk = (code: string | null, outer: SubMachine | null, prefix: string, chain: string[]) => {
    for (const m of findSubMachines(code, methods, allSt)) {
      if (chain.includes(m.method.toLowerCase())) continue;
      // (in a method: a state of its own state machine)
      if (outer && !outer.states.includes(m.parent)) continue;
      const found = { ...m, parent: `${prefix}${m.parent}` };
      out.push(found);
      if (chain.length + 1 < maxDepth) walk(methods.get(m.method)?.st ?? null, m, `${found.parent}__${m.method}__`, [...chain, m.method.toLowerCase()]);
    }
  };
  walk(st, null, '', []);
  return out;
}
