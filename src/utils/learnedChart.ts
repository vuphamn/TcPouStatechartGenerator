/**
 * A diagram learned live, for a state machine whose source is not at hand: its states from the PLC (the state
 * variable's enum: names and values, as the PLC's symbols give them), its transitions the ones the PLC has taken
 * (the seen transitions, kept per POU type). Made as a small POU and enum the app draws like any other; each
 * transition seen is an arm of its state's CASE branch (IF seenLive THEN ...). Marked, so the app knows it is not a
 * real source (nothing to save to a project) and draws it again as transitions are seen.
 */
import type { SeenMap } from './seenTransitions.ts';

export const LEARNED_MARK = '(* Learned live by Kval StateScope: no source. Its transitions: the ones seen on the PLC *)';

export const isLearnedPou = (pou: string) => pou.includes(LEARNED_MARK);

const cdata = (s: string) => `<![CDATA[${s}]]>`;
const ident = (s: string) => /^[A-Za-z_]\w*$/.test(s);

export interface LearnedInput {
  /** The FB type (SM_DoorDasher) */
  typeName: string;
  /** Its state variable (machineState) */
  stateVar: string;
  /** The enum type (E_DoorDasher_States) */
  enumType: string;
  /** The enum's values and names, as the PLC gives them */
  names: Record<string, string>;
  seen: SeenMap;
}

/** The POU and enum of a learned diagram; null when the PLC gave no usable states */
export function learnedSources({ typeName, stateVar, enumType, names, seen }: LearnedInput): { pou: string; dut: string } | null {
  const members = Object.entries(names)
    .map(([v, n]) => ({ v: Number(v), n: n.split('.').pop() ?? n }))
    .filter((m) => Number.isFinite(m.v) && ident(m.n))
    .sort((a, b) => a.v - b.v);
  if (!members.length || !ident(typeName) || !ident(stateVar) || !ident(enumType)) return null;
  const known = new Set(members.map((m) => m.n));
  // Each state: the transitions seen from it, the most taken first
  const out = new Map<string, { to: string; n: number }[]>();
  for (const [k, s] of Object.entries(seen)) {
    const [from, to] = k.split('->');
    if (!known.has(from) || !known.has(to) || from === to) continue;
    out.set(from, [...(out.get(from) ?? []), { to, n: s.n }]);
  }
  const branches = members.map((m) => {
    const arms = (out.get(m.n) ?? []).sort((a, b) => b.n - a.n);
    const body = arms.length
      ? arms.map((a) => `\t\t// seen ${a.n}×\n\t\tIF seenLive THEN\n\t\t\t${stateVar} := ${enumType}.${a.to};\n\t\tEND_IF`).join('\n')
      : '\t\t; // no transition out of it seen yet';
    return `\t${enumType}.${m.n}:\n${body}`;
  });
  const doState = [`CASE ${stateVar} OF`, ...branches, 'END_CASE'].join('\n');
  const decl = [LEARNED_MARK, `FUNCTION_BLOCK ${typeName}`, 'VAR', `\t${stateVar} : ${enumType};`, '\tseenLive : BOOL; // (a transition seen on the PLC: its condition is not known)', 'END_VAR'].join('\n');
  const pou = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<TcPlcObject Version="1.1.0.1">',
    `  <POU Name="${typeName}" Id="{00000000-0000-4000-8000-000000000001}" SpecialFunc="None">`,
    `    <Declaration>${cdata(decl)}</Declaration>`,
    '    <Implementation>',
    `      <ST>${cdata('doState();')}</ST>`,
    '    </Implementation>',
    '    <Method Name="doState" Id="{00000000-0000-4000-8000-000000000002}">',
    `      <Declaration>${cdata('METHOD doState : BOOL')}</Declaration>`,
    '      <Implementation>',
    `        <ST>${cdata(doState)}</ST>`,
    '      </Implementation>',
    '    </Method>',
    '  </POU>',
    '</TcPlcObject>',
  ].join('\n');
  const list = members.map((m, i) => `\t${m.n} := ${m.v}${i < members.length - 1 ? ',' : ''}`).join('\n');
  const dut = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<TcPlcObject Version="1.1.0.1">',
    `  <DUT Name="${enumType}" Id="{00000000-0000-4000-8000-000000000003}">`,
    `    <Declaration>${cdata(`{attribute 'qualified_only'}\nTYPE ${enumType} :\n(\n${list}\n);\nEND_TYPE`)}</Declaration>`,
    '  </DUT>',
    '</TcPlcObject>',
  ].join('\n');
  return { pou, dut };
}

/** The learned POU's input again, from its own sources (to draw it again with more seen transitions) */
export function learnedInputOf(pou: string, dut: string): Omit<LearnedInput, 'seen'> | null {
  if (!isLearnedPou(pou)) return null;
  const typeName = pou.match(/<POU\b[^>]*\bName="([^"]+)"/)?.[1];
  const decl = pou.match(/FUNCTION_BLOCK[\s\S]*?VAR\s*\n\s*([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)\s*;/);
  if (!typeName || !decl) return null;
  const names: Record<string, string> = {};
  for (const m of dut.matchAll(/^\s*([A-Za-z_]\w*)\s*:=\s*(-?\d+)\s*,?\s*$/gm)) names[m[2]] = m[1];
  return { typeName, stateVar: decl[1], enumType: decl[2], names };
}
