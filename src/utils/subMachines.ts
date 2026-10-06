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
  const lines = stripComments(st).split(/\r?\n/).map((l) => l.trim());
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
      continue;
    }
    if (/^END_CASE\b/i.test(l)) {
      if (depth === 0) break;
      depth--;
      continue;
    }
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
      if (to !== current) transitions.push({ from: current, to, guard: ifs.length ? ifs.join(' AND ') : null });
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
  const lines = stripComments(st).split(/\r?\n/).map((l) => l.trim());
  const out: SubMachine[] = [];
  const seen = new Set<string>();
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
      continue;
    }
    if (/^END_CASE\b/i.test(l)) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    const lab = l.match(/^((?:[A-Za-z_][\w.]*\s*,\s*)*[A-Za-z_][\w.]*)\s*:(?!=)/);
    if (depth === 1 && lab && !/^(ELSE|ELSIF|IF|END_\w+|THEN)\b/i.test(l)) {
      parent = unqualifyState(lab[1].split(',')[0].trim());
      ifs.length = 0;
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
      const when = ifs.length ? ifs.join(' AND ') : null;
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
