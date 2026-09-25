/**
 * The function block instances a piece of code uses (e.g. "smOutfeedStopAxis.status_bHomed" in a guard), with their
 * types from the POU's declaration: candidates for "open that POU's chart".
 */

import { blankComments } from './stateMachineLint.ts';

export interface ReferencedMachine {
  member: string;
  type: string;
}

// Types with no chart of their own: elementary types, IEC / Tc2 standard blocks, enums, structs, interfaces
const NOT_A_CHART = new Set(
  [
    'BOOL', 'BYTE', 'WORD', 'DWORD', 'LWORD', 'SINT', 'USINT', 'INT', 'UINT', 'DINT', 'UDINT', 'LINT', 'ULINT', 'REAL', 'LREAL',
    'TIME', 'LTIME', 'DATE', 'TOD', 'DT', 'TIME_OF_DAY', 'DATE_AND_TIME', 'STRING', 'WSTRING', 'BIT',
    'TON', 'TOF', 'TP', 'R_TRIG', 'F_TRIG', 'CTU', 'CTD', 'CTUD', 'RS', 'SR', 'LTON', 'LTOF', 'LTP',
  ].map((t) => t.toLowerCase())
);
const isChartType = (type: string) => !NOT_A_CHART.has(type.toLowerCase()) && !/^(E|ST|T|I|U)_/i.test(type) && !/^(ARRAY|POINTER|REFERENCE)\b/i.test(type);

/** Members of the POU's own declaration (VAR, VAR_INPUT, ...) whose type may be a state machine */
export function declaredMachineMembers(pouXml: string): Map<string, ReferencedMachine> {
  const members = new Map<string, ReferencedMachine>();
  const decl = pouXml.match(/<POU\b[\s\S]*?<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1];
  if (!decl) return members;
  const code = blankComments(decl);
  for (const block of code.matchAll(/\b(VAR_INPUT|VAR_OUTPUT|VAR_STAT|VAR)\b[^\n]*([\s\S]*?)\bEND_VAR\b/gi)) {
    for (const statement of block[2].split(';')) {
      const m = statement.match(/^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?:AT\s+%\S+\s*)?:\s*([A-Za-z_][\w.]*)/);
      if (!m) continue;
      const type = m[2].split('.').pop()!;
      if (!isChartType(type)) continue;
      for (const name of m[1].split(',')) members.set(name.trim().toLowerCase(), { member: name.trim(), type });
    }
  }
  return members;
}

/** The declared state-machine members the text uses (as "member.something"), each once */
export function referencedMachines(text: string, members: Map<string, ReferencedMachine>): ReferencedMachine[] {
  const found = new Map<string, ReferencedMachine>();
  for (const m of (text || '').matchAll(/\b([A-Za-z_]\w*)\s*\./g)) {
    const hit = members.get(m[1].toLowerCase());
    if (hit && !found.has(hit.member)) found.set(hit.member, hit);
  }
  return [...found.values()];
}
