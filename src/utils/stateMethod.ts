/**
 * The method holding a POU's state machine. Kval's POUs have doState() (CASE machineState / mainState OF); another
 * company's may have it elsewhere: Execute() with CASE State OF, State declared as an enum type. When there is no
 * doState() (its own, or a base's merged in), the state method is the one whose CASE switches on a variable the POU
 * declares with a non-elementary type (an enum) or an enum written inline (Phase : (Waiting, OffEdge) := Waiting), the
 * one with the most branches. A POU that EXTENDS another is Kval's when a base merged in has doState() or its own code
 * assigns machineState / mainState: 'doState' then (its base is looked for: see pouInheritance); otherwise its own
 * state method is looked for as above (another company's FB with a base of its own: TrackSample()).
 *
 * The POU's body is its state method when no method is and its own code has such a CASE (FB_TestCycle: CASE State OF in
 * its body): its name then stands for the body (isBodyMethod).
 *
 * Code that asks for 'doState' (reading, editing, line counts, Go to code) gets that method through
 * resolveStateMethod(): the 76 places that name doState() follow it without change.
 */
import { extendsOf, pouNameOf, registeredBases, stripInherited } from './pouInheritance.ts';
import { getPouBody } from './pouBody.ts';

const ELEMENTARY = new Set(
  'BOOL BIT BYTE WORD DWORD LWORD SINT USINT INT UINT DINT UDINT LINT ULINT REAL LREAL TIME LTIME DATE LDATE TIME_OF_DAY TOD LTOD DATE_AND_TIME DT LDT STRING WSTRING ANY POINTER REFERENCE'.split(' ')
);

const stripComments = (s: string) => s.replace(/\(\*[\s\S]*?\*\)/g, '').replace(/\/\/[^\r\n]*/g, '');

/** The POU's own declaration (its <POU><Declaration>), comments taken out */
function pouDeclaration(pouXml: string): string {
  return stripComments(stripInherited(pouXml).match(/<POU\b[^>]*>\s*<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1] ?? '');
}

/** The type a variable is declared with in the POU's declaration (State : E_FrameScanState := …), or null */
export function declaredTypeOf(pouXml: string, varName: string): string | null {
  if (!/^[A-Za-z_]\w*$/.test(varName)) return null;
  const m = new RegExp(`(?:^|[\\s;,])${varName}\\s*(?:AT\\s+%\\S+\\s*)?:\\s*([A-Za-z_][\\w.]*)`, 'im').exec(pouDeclaration(pouXml));
  return m ? m[1] : null;
}

/**
 * An enum written inline in the POU's declaration for this variable (Phase : (Waiting, OffEdge := 5, OnBest) :=
 * Waiting): its members (name, value when given), or null
 */
export function inlineEnumOf(pouXml: string, varName: string): { name: string; value?: string }[] | null {
  if (!/^[A-Za-z_]\w*$/.test(varName)) return null;
  const m = new RegExp(`(?:^|[\\s;,])${varName}\\s*:\\s*\\(([^)]*)\\)`, 'im').exec(pouDeclaration(pouXml));
  if (!m) return null;
  const members = m[1]
    .split(',')
    .map((x) => /^\s*([A-Za-z_]\w*)\s*(?::=\s*([^,]+?))?\s*$/.exec(x))
    .filter((x): x is RegExpExecArray => !!x)
    .map((x) => ({ name: x[1], ...(x[2] ? { value: x[2].trim() } : {}) }));
  return members.length >= 2 ? members : null;
}

/** The POU's methods (its own and those merged in): name and code */
function methodsWithCode(pouXml: string): { name: string; st: string }[] {
  const out: { name: string; st: string }[] = [];
  for (const m of pouXml.matchAll(/<Method\b([^>]*)>([\s\S]*?)<\/Method>/gi)) {
    const name = m[1].match(/\bName=["']([^"']+)["']/i)?.[1];
    const st = m[2].match(/<ST[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1];
    if (name && st !== undefined) out.push({ name, st });
  }
  return out;
}

/** The POU's own body (Structured Text), or null (none, or SFC …) */
function ownBodySt(pouXml: string): string | null {
  const b = getPouBody(stripInherited(pouXml));
  return b.found && b.isStructuredText && b.implementation.trim() ? b.implementation : null;
}

/**
 * Is this name the POU's body (its own name, no method called so)? The body as a state method (FB_TestCycle's CASE in
 * its body) is asked for by the POU's name
 */
export function isBodyMethod(pouXml: string, name: string): boolean {
  const pou = pouNameOf(pouXml);
  if (!pou || !name || name.replace(/\(\)$/, '').toLowerCase() !== pou.toLowerCase()) return false;
  return !methodsWithCode(pouXml).some((m) => m.name.toLowerCase() === pou.toLowerCase());
}

/** A method's code, the body's when the name is the POU's (isBodyMethod); null when there is none */
export function stateCodeOf(pouXml: string, name: string): string | null {
  if (isBodyMethod(pouXml, name)) return ownBodySt(pouXml);
  return methodsWithCode(pouXml).find((m) => m.name.toLowerCase() === name.toLowerCase())?.st ?? null;
}

const CASE_OF = /\bCASE\s*\(?\s*([A-Za-z_]\w*)\s*\)?\s*OF\b/i;

/** A method as the state method: its CASE variable and how many branches (labels) it has; null when it is none */
function stateCaseOf(pouXml: string, st: string): { stateVar: string; branches: number } | null {
  const code = stripComments(st);
  const m = CASE_OF.exec(code);
  if (!m) return null;
  const stateVar = m[1];
  const type = declaredTypeOf(pouXml, stateVar);
  // (an enum: a type of its own, not INT / DINT …; or labels written qualified, E_X.Member)
  const qualified = /^\s*[A-Za-z_]\w*\.[A-Za-z_]\w*\s*[:,]/m.test(code.slice(m.index));
  // (an enum written inline: Phase : (Waiting, OffEdge) := Waiting)
  const inline = !type && !!inlineEnumOf(pouXml, stateVar);
  if (!(type ? !ELEMENTARY.has(type.toUpperCase()) : qualified || inline)) return null;
  const body = code.slice(m.index + m[0].length);
  const branches = body.split(/\r?\n/).filter((l) => /^\s*(?:[A-Za-z_][\w.]*\s*,\s*)*[A-Za-z_][\w.]*\s*:(?!=)/.test(l)).length;
  return branches >= 2 ? { stateVar, branches } : null;
}

const cache = new Map<string, string>();

/** The name of the method holding the POU's state machine: 'doState' (Kval's, or not known), else the one found */
export function stateMethodName(pouXml: string): string {
  if (!pouXml) return 'doState';
  // (the bases known for it count too: found later, they decide whether it is Kval's)
  const bases = extendsOf(pouXml) ? registeredBases(pouNameOf(pouXml)) : [];
  const key = `${bases.map((b) => b.name).join(',')}|${pouXml}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const methods = methodsWithCode(pouXml);
  let found = 'doState';
  const kvals =
    methods.some((m) => m.name.toLowerCase() === 'dostate') ||
    (!!extendsOf(pouXml) &&
      (bases.some((b) => /<Method\b[^>]*\bName=["']doState["']/i.test(b.content)) || /\b(?:machineState|mainState)\s*:=/i.test(stripComments(stripInherited(pouXml)))));
  if (!kvals) {
    // (its own methods: a base's merged in are not its state method)
    let best: { name: string; branches: number } | null = null;
    for (const m of methodsWithCode(stripInherited(pouXml))) {
      const c = stateCaseOf(pouXml, m.st);
      if (c && (!best || c.branches > best.branches)) best = { name: m.name, branches: c.branches };
    }
    // (else its body: CASE State OF in the FB's own code; its name stands for it)
    const body = best ? null : ownBodySt(pouXml);
    const c = body ? stateCaseOf(pouXml, body) : null;
    if (c && pouNameOf(pouXml)) best = { name: pouNameOf(pouXml), branches: c.branches };
    if (best) found = best.name;
  }
  if (cache.size > 16) cache.delete(cache.keys().next().value!);
  cache.set(key, found);
  return found;
}

/** A method name asked for: 'doState' is the POU's state method (Execute() in another company's POU); others as they are */
export function resolveStateMethod(pouXml: string, name: string): string {
  return name.toLowerCase() === 'dostate' ? stateMethodName(pouXml) : name;
}

/**
 * The enum type of the POU's state variable (State : E_ScanState → 'E_ScanState'), when the POU declares it itself
 * with a type of its own (not INT / DINT …); null otherwise (Kval's machineState inherited from the base FB)
 */
export function stateEnumTypeOf(pouXml: string): string | null {
  if (!pouXml) return null;
  const st = stateCodeOf(pouXml, stateMethodName(pouXml));
  const v = st ? CASE_OF.exec(stripComments(st))?.[1] : null;
  const type = v ? declaredTypeOf(pouXml, v) : null;
  return type && !ELEMENTARY.has(type.toUpperCase()) ? type.split('.').pop() ?? null : null;
}

/** Where an enum written inline in the POU is said to be (its candidate's relativePath): not a file */
export const INLINE_ENUM_PATH = '(declared in the POU)';

/**
 * The POU's state variable's enum when it is written inline (Phase : (Waiting, OffEdge) := Waiting): the variable,
 * its members, and a .TcDUT's text made from them (read only: the enum's order, names and values for the chart, the
 * lists and live view); null otherwise
 */
export function inlineStateEnum(pouXml: string): { varName: string; members: { name: string; value?: string }[]; dut: string; typeName: string } | null {
  if (!pouXml) return null;
  const st = stateCodeOf(pouXml, stateMethodName(pouXml));
  const v = st ? CASE_OF.exec(stripComments(st))?.[1] : null;
  const members = v ? inlineEnumOf(pouXml, v) : null;
  if (!v || !members) return null;
  const typeName = `${pouNameOf(pouXml) || 'POU'}_${v}`;
  const body = members.map((m, k) => `\t${m.name}${m.value !== undefined ? ` := ${m.value}` : ''}${k < members.length - 1 ? ',' : ''}`).join('\n');
  const dut = `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <DUT Name="${typeName}" Id="{00000000-0000-0000-0000-000000000000}">
    <Declaration><![CDATA[// ${v}'s states, as declared inline in ${pouNameOf(pouXml)} (${v} : (...)): read only here
TYPE ${typeName} :
(
${body}
);
END_TYPE
]]></Declaration>
  </DUT>
</TcPlcObject>
`;
  return { varName: v, members, dut, typeName };
}

/** The state method's display name (doState(), Execute()) */
export const stateMethodLabel = (pouXml: string) => `${stateMethodName(pouXml)}()`;
