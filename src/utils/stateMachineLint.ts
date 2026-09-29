/**
 * Lint rules for a TwinCAT state machine: checks doState() / preProcess() and the rest of the .TcPOU against the
 * .TcDUT enum and the diagram's transitions. Each finding points at the code (method + 1-based line of the ST
 * implementation, as sourceLocation.ts) and may carry a fix.
 */

import type { EdgeInfo } from '../types.ts';
import { stateQualifier } from './stateNames.ts';
import { getMethodCodeFromPou } from './pouStateEditor.ts';
import { parseParallelRegions } from '../generator.ts';
import { LABEL_RX, escapeRx, labelNames, locateTransition } from './sourceLocation.ts';
import { extractCleanGuardText } from './stateMachineStats.ts';

export type LintSeverity = 'error' | 'warning' | 'info';

export type LintRuleId =
  | 'unknown-target'
  | 'unknown-case-label'
  | 'duplicate-case'
  | 'missing-branch'
  | 'unreachable'
  | 'dead-end'
  | 'duplicate-guard'
  | 'self-transition'
  | 'unused-enum'
  | 'no-else'
  | 'multiple-initial'
  | 'region-no-final'
  | 'region-unreachable'
  | 'recorded-path'
  | 'undeclared-variable'
  | 'unused-variable'
  | 'duplicate-variable'
  | 'input-written'
  | 'unused-method'
  | 'unreachable-code'
  | 'fb-not-called'
  | 'timer-no-pt'
  | 'trigger-constant'
  | 'empty-if'
  | 'output-never-set'
  | 'no-description'
  | 'build-error'
  | 'build-warning';

export type LintFix =
  | { kind: 'add-enum-member'; name: string }
  | { kind: 'add-case-branch'; name: string }
  /** Declare a name the code uses (in its method, or the POU) */
  | { kind: 'declare-variable'; name: string; method?: string }
  /** Delete an unused variable's declaration */
  | { kind: 'remove-variable'; name: string; method?: string }
  /** A timer / trigger / counter never called: its call put in before its first use */
  | { kind: 'insert-call'; name: string; type: string }
  /** Code that never runs (after a RETURN): removed, to the end of its block; count: exactly these lines */
  | { kind: 'remove-lines'; name: string; method?: string; line: number; count?: number }
  /** The state machine's CASE without ELSE: an ELSE branch put in before END_CASE */
  | { kind: 'add-else'; name: string; method: string; line: number }
  /** A PRIVATE method nothing calls: removed */
  | { kind: 'remove-method'; name: string }
  /** A state no transition leads to: deleted (Delete state…: what goes is shown first) */
  | { kind: 'delete-state'; name: string }
  /** An enum member nothing uses: taken out of the enum */
  | { kind: 'remove-enum-member'; name: string }
  /** A timer called without its time: PT put into its first call */
  | { kind: 'add-pt'; name: string; method: string; line: number }
  /** A state without its line in getStateDescription(): one put in */
  | { kind: 'add-description'; name: string };

export interface LintFinding {
  /** Stable across edits (no line numbers): used to ignore a finding */
  key: string;
  rule: LintRuleId;
  severity: LintSeverity;
  message: string;
  /** State the finding is about (selected in the diagram) */
  stateId?: string;
  /** Code location: method and 1-based line of its ST implementation */
  method?: string;
  line?: number;
  /** The source line, to find it again in TwinCAT's editor */
  text?: string;
  fix?: LintFix;
  /** Where the code editors underline it: a line of the method's (or the POU's) declaration / implementation, the name */
  mark?: { line: number; declaration: boolean; name: string };
}

export const LINT_RULES: Record<LintRuleId, { severity: LintSeverity; title: string; description: string }> = {
  'unknown-target': {
    severity: 'error',
    title: 'Target not in enum',
    description: 'A transition assigns a state that the .TcDUT enum does not declare.',
  },
  'unknown-case-label': {
    severity: 'error',
    title: 'CASE label not in enum',
    description: 'doState() has a branch for a state that the .TcDUT enum does not declare.',
  },
  'duplicate-case': {
    severity: 'error',
    title: 'Duplicate CASE label',
    description: 'The same state has more than one branch in doState().',
  },
  'missing-branch': {
    severity: 'warning',
    title: 'No CASE branch',
    description: 'A state is entered, but doState() has no branch for it, so nothing runs while in it.',
  },
  unreachable: {
    severity: 'warning',
    title: 'Unreachable state',
    description:
      'A state has a branch, but no transition in this POU leads to it and it is not the initial state. The lifecycle states (the enum members up to …_ENABLING, driven by the base class) are not checked.',
  },
  'dead-end': {
    severity: 'warning',
    title: 'Dead end',
    description:
      'A state has no transition out of it, in its branch or in preProcess(). The lifecycle states (up to …_ENABLING) are not checked.',
  },
  'duplicate-guard': {
    severity: 'warning',
    title: 'Same guard, different targets',
    description: 'Two transitions out of a state have the same condition, so only the first one can fire.',
  },
  'self-transition': {
    severity: 'info',
    title: 'Self-transition',
    description: 'A branch assigns its own state, which has no effect unless re-entry is intended.',
  },
  'unused-enum': {
    severity: 'info',
    title: 'Unused enum member',
    description: 'An enum member is never used: no branch, no transition and no other reference in the POU.',
  },
  'no-else': {
    severity: 'info',
    title: 'CASE without ELSE',
    description: 'doState() has no ELSE branch, so an unexpected state value is silently ignored.',
  },
  'multiple-initial': {
    severity: 'warning',
    title: 'Several initial states',
    description: 'More than one enum member of the same composite ({region}), or outside the composites, is marked // @initial: only one is where it starts.',
  },
  'region-no-final': {
    severity: 'warning',
    title: 'Parallel region without a final state',
    description: 'A parallel region (Fork / Join) has no state marked (* final *), so a join waiting for it never fires.',
  },
  'region-unreachable': {
    severity: 'warning',
    title: 'Region state never entered',
    description: 'A state of a parallel region is neither where the region starts nor the target of one of its transitions.',
  },
  'recorded-path': {
    severity: 'error',
    title: 'Recorded path broken',
    description: 'A path check (kept from a live session or a recording) has a transition the diagram no longer has: the machine did it, the edited code would not.',
  },
  'undeclared-variable': {
    severity: 'warning',
    title: 'Not declared',
    description: 'The code uses a name that is declared nowhere: not in the method, the POU, its base class, a GVL or a type of the PLC project (checked when the project is known: XAE, desktop).',
  },
  'unused-variable': {
    severity: 'info',
    title: 'Not used',
    description: "A variable (VAR) of the POU or of a method is not used in its code. Inputs and outputs are the POU's interface and not checked; a derived FB may still use it.",
  },
  'input-written': {
    severity: 'warning',
    title: 'Input written',
    description: 'The POU assigns one of its own inputs (VAR_INPUT): its caller sets it every call, so the value written here is overwritten, and the caller does not see it.',
  },
  'unused-method': {
    severity: 'info',
    title: 'Method not called',
    description: 'A PRIVATE method that no code of the POU calls. (Public and protected methods may be called from elsewhere: not checked.)',
  },
  'unreachable-code': {
    severity: 'warning',
    title: 'Never runs',
    description: 'Code right after a RETURN in the same block: it is never reached.',
  },
  'timer-no-pt': {
    severity: 'warning',
    title: 'Timer without time',
    description: 'A TON, TOF or TP that is called, but never given its time (PT): its time is T#0S, so it runs out at once.',
  },
  'trigger-constant': {
    severity: 'warning',
    title: 'Trigger on a constant',
    description: "An R_TRIG or F_TRIG whose CLK is always the same (TRUE, FALSE or a constant): its Q is never TRUE, or only in the first cycle. Where removing the call changes nothing, the fix removes it.",
  },
  'empty-if': {
    severity: 'info',
    title: 'Empty IF',
    description: 'An IF … THEN with nothing before its END_IF (and no ELSE): it does nothing. The fix removes it (when its condition calls nothing).',
  },
  'output-never-set': {
    severity: 'info',
    title: 'Output never set',
    description: 'A VAR_OUTPUT that no code of the POU writes: whoever reads it always gets its initial value. (Not removed for you: other POUs may read it.)',
  },
  'build-error': {
    severity: 'error',
    title: 'Build error',
    description: 'The last Build for the PLC: TwinCAT XAE did not compile this. Fix it, then Build again (the Live tab).',
  },
  'build-warning': {
    severity: 'warning',
    title: 'Build warning',
    description: 'The last Build for the PLC: TwinCAT XAE compiled it with this warning.',
  },
  'no-description': {
    severity: 'info',
    title: 'State without description',
    description: 'A state of doState() that getStateDescription() has no line for: its description (on the diagram, in reports) is empty.',
  },
  'fb-not-called': {
    severity: 'warning',
    title: 'FB never called',
    description: 'A timer, trigger or counter whose outputs the code reads, but that is never called (fbTimer(IN := ..., PT := ...)): its outputs never change.',
  },
  'duplicate-variable': {
    severity: 'error',
    title: 'Declared twice',
    description: "A name is declared twice in one declaration (error), or a method's own variable hides a member of the POU of that name (warning).",
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Scanning

/**
 * The text with comments ((* *), nestable, and //), string literals and pragmas blanked out. Lengths and line
 * breaks are kept, so offsets and line numbers still match the original.
 */
export function blankComments(text: string): string {
  const out = text.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '(' && next === '*') {
      const start = i;
      let depth = 0;
      while (i < text.length) {
        if (text[i] === '(' && text[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (text[i] === '*' && text[i + 1] === ')') {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else i++;
      }
      blank(start, i);
    } else if (c === '/' && next === '/') {
      const start = i;
      while (i < text.length && text[i] !== '\n') i++;
      blank(start, i);
    } else if (c === "'" || c === '"') {
      const start = i++;
      while (i < text.length && text[i] !== c && text[i] !== '\n') i += text[i] === '$' ? 2 : 1;
      i++;
      blank(start + 1, Math.min(i - 1, text.length));
    } else if (c === '{') {
      const start = i;
      while (i < text.length && text[i] !== '}' && text[i] !== '\n') i++;
      i++;
      blank(start, Math.min(i, text.length));
    } else i++;
  }
  return out.join('');
}

export interface CodeUnit {
  /** Method / action name; null for the POU's own body */
  method: string | null;
  lines: string[];
  code: string[];
}

const cdata = (s: string) => {
  const m = s.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return (m ? m[1] : s).replace(/\r\n/g, '\n');
};

/** ST implementations of the POU body, its methods and actions */
export function codeUnits(pouXml: string): CodeUnit[] {
  const units: CodeUnit[] = [];
  const make = (method: string | null, st: string) => {
    const text = cdata(st);
    units.push({ method, lines: text.split('\n'), code: blankComments(text).split('\n') });
  };
  const rx = /<(Method|Action)\b[^>]*\bName=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(pouXml))) {
    const st = m[3].match(/<ST[^>]*>([\s\S]*?)<\/ST>/i);
    if (st) make(m[2], st[1]);
  }
  const body = pouXml.replace(/<(Method|Action|Property)\b[\s\S]*?<\/\1>/gi, '');
  const bodySt = body.match(/<Implementation>\s*<ST[^>]*>([\s\S]*?)<\/ST>/i);
  if (bodySt) make(null, bodySt[1]);
  return units;
}

interface CaseBranch {
  labels: string[];
  /** 0-based line of the label */
  line: number;
  /** 0-based, exclusive */
  endLine: number;
}

interface MainCase {
  variable: string;
  caseLine: number;
  branches: CaseBranch[];
  elseLine: number | null;
  endCaseLine: number | null;
}

const BLOCK_RX = /\b(CASE|IF|FOR|WHILE|REPEAT|END_CASE|END_IF|END_FOR|END_WHILE|END_REPEAT|ELSE)\b/gi;

/** The branches of doState()'s CASE on the state variable (nested CASE / IF blocks are skipped over) */
function scanMainCase(code: string[]): MainCase | null {
  const stack: { kind: string; main: boolean }[] = [];
  let main: MainCase | null = null;
  let open: CaseBranch | null = null;
  const close = (at: number) => {
    if (open && main) {
      open.endLine = at;
      main.branches.push(open);
    }
    open = null;
  };
  for (let i = 0; i < code.length; i++) {
    const line = code[i];
    const top = stack[stack.length - 1];
    if (top?.main && main?.endCaseLine === null) {
      const names = labelNames(line).filter((n) => !/^\d+$/.test(n));
      if (names.length && LABEL_RX.test(line) && !/^\s*(ELSE|ELSIF|END_\w+)\b/i.test(line)) {
        close(i);
        open = { labels: names, line: i, endLine: code.length };
      }
    }
    BLOCK_RX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BLOCK_RX.exec(line))) {
      const kw = m[1].toUpperCase();
      if (kw === 'CASE') {
        const v = line.slice(m.index).match(/^CASE\s*\(?\s*([A-Za-z_][\w.]*)\s*\)?\s*OF\b/i);
        const isMain = !main && !!v;
        if (isMain) main = { variable: v![1], caseLine: i, branches: [], elseLine: null, endCaseLine: null };
        stack.push({ kind: 'CASE', main: isMain });
      } else if (kw === 'ELSE') {
        const t = stack[stack.length - 1];
        if (t?.main && main) {
          close(i);
          main.elseLine = i;
        }
      } else if (kw.startsWith('END_')) {
        const kind = kw.slice(4);
        const at = stack.map((s) => s.kind).lastIndexOf(kind);
        if (at >= 0) {
          const [popped] = stack.splice(at);
          if (popped.main && main) {
            close(i);
            main.endCaseLine = i;
          }
        }
      } else {
        stack.push({ kind: kw, main: false });
      }
    }
  }
  if (main && main.endCaseLine === null) close(code.length);
  return main;
}

interface Assignment {
  method: string | null;
  line: number;
  target: string;
}

function assignments(units: CodeUnit[], variable: string): Assignment[] {
  const rx = new RegExp(`(?:^|[^\\w.])${escapeRx(variable)}\\s*:=\\s*(?:[A-Za-z_]\\w*\\.)?([A-Za-z_]\\w*)\\b`, 'g');
  const list: Assignment[] = [];
  for (const u of units) {
    u.code.forEach((line, i) => {
      rx.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rx.exec(line))) list.push({ method: u.method, line: i, target: m[1] });
    });
  }
  return list;
}

/** The enum's members in order (commented-out ones skipped), from a .TcDUT or its declaration */
export function enumMembers(dutContent: string): string[] {
  const decl = dutContent.match(/<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1] ?? dutContent;
  const range = enumListRange(decl);
  if (!range) return [];
  return blankComments(decl)
    .replace(/\{[^{}\n]*\}/g, (m) => ' '.repeat(m.length))
    .slice(range.start + 1, range.end)
    .split(',')
    .map((part) => part.match(/^\s*([A-Za-z_]\w*)/)?.[1])
    .filter((n): n is string => !!n);
}

/** Offsets of the enum list's parentheses in a declaration */
export function enumListRange(decl: string): { start: number; end: number } | null {
  const code = blankComments(decl);
  const type = code.search(/\bTYPE\b[\s\S]*?:\s*\(/i);
  if (type < 0) return null;
  const start = code.indexOf('(', type);
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) return { start, end: i };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Rules

const FINAL_LABEL = /:(?!=)\s*\(\*\s*final\s*\*\)/i;
const ERROR_LIKE = /ERROR|FAULT|FAIL|ALARM|ABORT|EMERGENCY|ESTOP/i;

export function lintStateMachine(pouXml: string, dutContent: string, edges: EdgeInfo[] = []): LintFinding[] {
  if (!pouXml?.trim()) return [];
  const units = codeUnits(pouXml);
  const doState = units.find((u) => u.method?.toLowerCase() === 'dostate');
  if (!doState) return [];
  const mainCase = scanMainCase(doState.code);
  if (!mainCase) return [];
  const variable = mainCase.variable;
  const findings: LintFinding[] = [];
  const at = (u: CodeUnit, line: number) => ({ method: u.method ?? undefined, line: line + 1, text: u.lines[line]?.trim() });
  const add = (f: Omit<LintFinding, 'severity'> & { severity?: LintSeverity }) =>
    findings.push({ severity: LINT_RULES[f.rule].severity, ...f });

  // Enum members (skipped when the loaded .TcDUT does not seem to be this state machine's)
  const enumItems = dutContent?.trim() ? enumMembers(dutContent) : [];
  const enumNames = new Set(enumItems);
  const labelList = mainCase.branches.flatMap((b) => b.labels);
  const enumMatches = enumItems.length > 0 && labelList.filter((l) => enumNames.has(l)).length >= labelList.length / 2;

  const allAssignments = assignments(units, variable);
  const branchOf = (line: number) => mainCase.branches.find((b) => line >= b.line && line < b.endLine);
  const labelled = new Map<string, CaseBranch>();

  // Duplicate / unknown labels
  for (const b of mainCase.branches) {
    for (const label of b.labels) {
      if (labelled.has(label)) {
        add({ key: `duplicate-case:${label}`, rule: 'duplicate-case', stateId: label, ...at(doState, b.line),
          message: `${label} has another branch at doState line ${labelled.get(label)!.line + 1}` });
      } else labelled.set(label, b);
      if (enumMatches && !enumNames.has(label)) {
        add({ key: `unknown-case-label:${label}`, rule: 'unknown-case-label', stateId: label, ...at(doState, b.line),
          message: `${label} is not declared in the enum`, fix: { kind: 'add-enum-member', name: label } });
      }
    }
  }

  // Targets
  const targets = new Map<string, Assignment[]>();
  for (const a of allAssignments) {
    if (!targets.has(a.target)) targets.set(a.target, []);
    targets.get(a.target)!.push(a);
  }
  const unitOf = (a: Assignment) => units.find((u) => u.method === a.method)!;
  for (const [target, list] of targets) {
    const first = list[0];
    if (enumMatches && !enumNames.has(target)) {
      add({ key: `unknown-target:${target}`, rule: 'unknown-target', stateId: target, ...at(unitOf(first), first.line),
        message: `${target} is assigned but not declared in the enum`, fix: { kind: 'add-enum-member', name: target } });
    } else if (!labelled.has(target)) {
      const hasElse = mainCase.elseLine !== null;
      add({ key: `missing-branch:${target}`, rule: 'missing-branch', stateId: target, ...at(unitOf(first), first.line),
        severity: hasElse ? 'info' : 'warning',
        message: hasElse
          ? `${target} is entered but only handled by doState's ELSE branch`
          : `${target} is entered but doState() has no branch for it`,
        fix: { kind: 'add-case-branch', name: target } });
    }
  }

  // Initial state: the variable's declared initial value, else the enum's first member, else the first label
  const decl = pouXml.match(/<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1] ?? '';
  const init = blankComments(decl).match(
    new RegExp(`\\b${escapeRx(variable.split('.').pop()!)}\\s*:\\s*[\\w.]+\\s*:=\\s*(?:[A-Za-z_]\\w*\\.)?([A-Za-z_]\\w*)`)
  )?.[1];
  const initial = init ?? (enumMatches ? enumItems[0] : undefined) ?? labelList[0];
  // Lifecycle states, as the diagram groups them: up to …_ENABLING, driven by the base class (enable / disable)
  const enablingIdx = enumMatches ? enumItems.findIndex((n) => /ENABLING$/i.test(n)) : -1;
  const lifecycle = new Set(enablingIdx >= 0 ? enumItems.slice(0, enablingIdx + 1) : [initial]);

  // Reachability and exits
  const rawDoState = getMethodCodeFromPou(pouXml, 'doState').code.split(/\r?\n/);
  // (or "// @final" on its line in the enum)
  const markedFinal = (state: string) => new RegExp(`^[ \\t]*,?[ \\t]*${escapeRx(state)}\\b[^\\n]*@final\\b`, 'im').test(dutContent || '');
  const exitsOf = (state: string) => {
    const out = new Set<string>();
    const b = labelled.get(state);
    if (b) for (const a of allAssignments) if (a.method === doState.method && a.line >= b.line && a.line < b.endLine && a.target !== state) out.add(a.target);
    for (const e of edges) if (e.from === state && e.to !== state) out.add(e.to);
    return out;
  };
  for (const [state, b] of labelled) {
    const incoming = (targets.get(state) ?? []).filter((a) => !(a.method === doState.method && branchOf(a.line) === b));
    if (!lifecycle.has(state) && state !== initial && incoming.length === 0 && !edges.some((e) => e.to === state && e.from !== state)) {
      add({ key: `unreachable:${state}`, rule: 'unreachable', stateId: state, ...at(doState, b.line),
        message: `No transition in this POU leads to ${state}`, fix: { kind: 'delete-state', name: state } });
    }
    // (a final state, "(* final *)" on its label, has no way out on purpose)
    if (!lifecycle.has(state) && exitsOf(state).size === 0 && !FINAL_LABEL.test(rawDoState[b.line] ?? '') && !markedFinal(state)) {
      const errorLike = ERROR_LIKE.test(state);
      add({ key: `dead-end:${state}`, rule: 'dead-end', stateId: state, ...at(doState, b.line),
        severity: errorLike ? 'info' : 'warning',
        message: errorLike ? `${state} has no way out (a reset may happen elsewhere)` : `${state} has no transition out of it` });
    }
  }
  for (const b of mainCase.branches) {
    const self = allAssignments.find((a) => a.method === doState.method && a.line >= b.line && a.line < b.endLine && b.labels.includes(a.target));
    if (self && !findings.some((f) => f.key === `self-transition:${self.target}`)) {
      add({ key: `self-transition:${self.target}`, rule: 'self-transition', stateId: self.target, ...at(doState, self.line),
        message: `${self.target} assigns itself` });
    }
  }

  // Same guard, different targets
  const byGuard = new Map<string, EdgeInfo[]>();
  for (const e of edges) {
    const guard = extractCleanGuardText(e.condition || e.label || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!guard || guard === 'else') continue;
    const k = `${e.from}\u0000${guard}`;
    if (!byGuard.has(k)) byGuard.set(k, []);
    byGuard.get(k)!.push(e);
  }
  for (const [k, list] of byGuard) {
    const distinct = [...new Set(list.map((e) => e.to))];
    if (distinct.length < 2) continue;
    const [from, guard] = k.split('\u0000');
    const second = list.find((e) => e.to === distinct[1])!;
    const loc = locateTransition(pouXml, second);
    add({ key: `duplicate-guard:${from}:${guard}`, rule: 'duplicate-guard', stateId: from,
      ...(loc ? { method: loc.method, line: loc.line, text: loc.text } : {}),
      message: `From ${from}, "${guard}" leads to ${distinct.join(' and ')}` });
  }

  // Enum members never used anywhere in the POU
  if (enumMatches) {
    const code = blankComments(pouXml);
    for (const name of enumItems) {
      if (labelled.has(name) || targets.has(name) || name === initial) continue;
      if (new RegExp(`\\b${escapeRx(name)}\\b`).test(code)) continue;
      add({ key: `unused-enum:${name}`, rule: 'unused-enum', stateId: name, message: `${name} is never used in this POU`, fix: { kind: 'remove-enum-member', name } });
    }
  }

  // Initial states marked in the enum: one per composite ({region}) and one outside them
  if (dutContent) {
    const byComposite = new Map<string, string[]>();
    const stack: string[] = [];
    const list = (dutContent.match(/<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1] ?? dutContent).split(/\r?\n/);
    for (const line of list) {
      const region = line.match(/^\s*\{\s*region\b\s*(?:"([^"]*)"|'([^']*)'|([^}]*?))\s*\}/i);
      if (region) {
        stack.push((region[1] ?? region[2] ?? region[3] ?? '').trim());
        continue;
      }
      if (/^\s*\{\s*endregion\b/i.test(line)) {
        stack.pop();
        continue;
      }
      const member = blankComments(line).replace(/^\s*,/, '').match(/^\s*([A-Za-z_]\w*)/)?.[1];
      if (!member || !/@initial\b/i.test(line)) continue;
      const key = stack[stack.length - 1] ?? '';
      byComposite.set(key, [...(byComposite.get(key) ?? []), member]);
    }
    for (const [composite, members] of byComposite)
      if (members.length > 1)
        add({ key: `multiple-initial:${composite}`, rule: 'multiple-initial', stateId: members[1], message: `${members.join(', ')} are all marked // @initial ${composite ? `in ${composite}` : 'outside the composites'}` });
  }

  // Parallel regions (Fork / Join): a final state each, every state entered
  // (the raw code: the regions' final states are marked in comments)
  for (const list of parseParallelRegions(rawDoState.join('\n'), variable, new Set(enumItems)).values()) {
    for (const r of list) {
      if (!r.finals.length)
        add({ key: `region-no-final:${r.parent}.${r.variable}`, rule: 'region-no-final', stateId: r.parent, message: `${r.parent}'s region ${r.variable} has no final state: its join never fires` });
      const entered = new Set([r.start, ...r.transitions.map((t) => t.to)]);
      for (const st of r.states)
        if (!entered.has(st))
          add({ key: `region-unreachable:${st}`, rule: 'region-unreachable', stateId: st, message: `${st} (region ${r.variable} of ${r.parent}) is never entered` });
    }
  }

  // States getStateDescription() has no line for (when it describes some of them)
  const desc = getMethodCodeFromPou(pouXml, 'getStateDescription');
  if (desc.methodFound && desc.code) {
    const described = new Set<string>();
    for (const line of desc.code.replace(/\(\*[\s\S]*?\*\)/g, '').split(/\r?\n/)) for (const n of labelNames(line.replace(/\/\/.*$/, ''))) described.add(n.split('.').pop()!.toUpperCase());
    if (described.size)
      for (const state of labelled.keys())
        if (!described.has(state.toUpperCase()))
          add({ key: `no-description:${state}`, rule: 'no-description', stateId: state, message: `${state} has no line in getStateDescription()`, fix: { kind: 'add-description', name: state } });
  }

  if (mainCase.elseLine === null && mainCase.endCaseLine !== null) {
    add({ key: 'no-else', rule: 'no-else', ...at(doState, mainCase.endCaseLine), message: `CASE ${variable} OF has no ELSE branch`, ...(doState.method ? { fix: { kind: 'add-else' as const, name: variable, method: doState.method, line: mainCase.endCaseLine + 1 } } : {}) });
  }

  const order: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || (a.line ?? 1e9) - (b.line ?? 1e9));
}

/**
 * The state whose doState() CASE branch holds a line (1-based, of doState's ST implementation), or null (outside
 * any branch: the CASE line, ELSE, code before / after the CASE)
 */
export function stateAtLine(pouXml: string, line: number): string | null {
  const doState = codeUnits(pouXml).find((u) => u.method?.toLowerCase() === 'dostate');
  if (!doState) return null;
  const main = scanMainCase(doState.code);
  const branch = main?.branches.find((b) => line - 1 >= b.line && line - 1 < b.endLine);
  return branch ? branch.labels[0] : null;
}

/** Number of lines of a method's ST implementation (TwinCAT's editor shows its declaration first) */
export function implementationLineCount(pouXml: string, method: string): number | null {
  const unit = codeUnits(pouXml).find((u) => u.method?.toLowerCase() === method.toLowerCase());
  return unit ? unit.lines.length : null;
}

/** Lines of a method's declaration; TwinCAT's editor shows them before the implementation's lines */
export function declarationLineCount(pouXml: string, method: string): number | null {
  const escaped = method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = pouXml.match(new RegExp(`<Method\\b[^>]*\\bName="${escaped}"[^>]*>\\s*<Declaration>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`, 'i'));
  return match ? match[1].split(/\r?\n/).length : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Fixes

/** The .TcDUT with a member appended to its enum, in the list's own style; null if the list is not found */
export function addEnumMember(dutContent: string, name: string): string | null {
  const declMatch = dutContent.match(/(<Declaration>\s*<!\[CDATA\[)([\s\S]*?)(\]\]>)/i);
  const decl = declMatch ? declMatch[2] : dutContent;
  // (pragmas such as {endregion} are no member: the comma goes after the last member)
  const code = blankComments(decl).replace(/\{[^{}\n]*\}/g, (m) => ' '.repeat(m.length));
  const range = enumListRange(decl);
  if (!range) return null;
  const { start: listStart, end: close } = range;
  // End of the last member (skipping blanked comments and white space)
  let end = close;
  while (end > listStart + 1 && /\s/.test(code[end - 1])) end--;
  if (end <= listStart + 1) return null;
  const lineStart = decl.lastIndexOf('\n', end - 1) + 1;
  const lineEndRaw = decl.indexOf('\n', end);
  const lineEnd = lineEndRaw < 0 || lineEndRaw > close ? close : lineEndRaw;
  const eol = decl.includes('\r\n') ? '\r\n' : '\n';
  const lineText = decl.slice(lineStart, lineEnd).replace(/\r$/, '');
  const indent = lineText.match(/^[ \t]*/)![0] || '\t';
  const leadingCommas = /\n[ \t]*,/.test(code.slice(listStart, close));
  let next: string;
  // The list ends with a composite's {endregion}: the new member after it (at the top level), before ")"
  if (!leadingCommas && /\{\s*endregion\b/i.test(decl.slice(end, close))) {
    const withComma = decl.slice(0, end) + ',' + decl.slice(end);
    const closeAt = close + 1;
    const closeLine = withComma.lastIndexOf('\n', closeAt - 1) + 1;
    const ownLine = !withComma.slice(closeLine, closeAt).trim();
    const at = ownLine ? closeLine : closeAt;
    // Indented like the last (outermost) {endregion}
    const er = withComma.toLowerCase().lastIndexOf('{endregion', closeAt);
    const listIndent = withComma.slice(withComma.lastIndexOf('\n', er) + 1, er).match(/^[ \t]*/)![0];
    next = withComma.slice(0, at) + `${ownLine ? '' : eol}${listIndent || indent}${name}${eol}` + withComma.slice(at);
    return declMatch ? dutContent.replace(declMatch[0], declMatch[1] + next + declMatch[3]) : next;
  }
  if (leadingCommas) {
    const insertAt = decl[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
    next = decl.slice(0, insertAt) + `${eol}${indent.replace(/,.*$/, '')}, ${name}` + decl.slice(insertAt);
  } else {
    // "LAST_MEMBER,<trailing comment>" + new line with the member
    const withComma = decl.slice(0, end) + ',' + decl.slice(end);
    const shifted = lineEnd + 1;
    const insertAt = withComma[shifted - 1] === '\r' ? shifted - 1 : shifted;
    next = withComma.slice(0, insertAt) + `${eol}${indent}${name}` + withComma.slice(insertAt);
  }
  return declMatch ? dutContent.replace(declMatch[0], declMatch[1] + next + declMatch[3]) : next;
}

/** doState()'s ST code with an empty branch for the state added before the CASE's ELSE / END_CASE */
export function addCaseBranch(pouXml: string, name: string): string | null {
  const method = getMethodCodeFromPou(pouXml, 'doState');
  if (!method.methodFound) return null;
  const eol = method.code.includes('\r\n') ? '\r\n' : '\n';
  const lines = method.code.split(/\r?\n/);
  const main = scanMainCase(blankComments(lines.join('\n')).split('\n'));
  if (!main) return null;
  const insertAt = main.elseLine ?? main.endCaseLine;
  if (insertAt === null) return null;
  const labelIndent = main.branches[0] ? lines[main.branches[0].line].match(/^[ \t]*/)![0] : '\t';
  const bodyIndent = labelIndent + '\t';
  // Written like the other labels (a qualified_only enum needs "E_X.STATE:")
  lines.splice(insertAt, 0, `${labelIndent}${stateQualifier(method.code)}${name}:`, `${bodyIndent};`, '');
  return lines.join(eol);
}
