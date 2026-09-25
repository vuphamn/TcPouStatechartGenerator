import { extractIdentifiedStatesFromPou } from './pouStateExtractor.ts';
import { extractDeclaration, readEnumOrder } from '../generator.ts';

/** A .TcDUT file found next to (or below) the loaded .TcPOU */
export interface DutCandidate {
  name: string;
  /** Path relative to the .TcPOU's folder, for display (e.g. "DUTs/E_Feed_States.TcDUT") */
  relativePath: string;
  content: string;
}

export interface DutMatch extends DutCandidate {
  /** doState() CASE states this enum declares */
  matched: number;
  /** doState() CASE states in the POU */
  caseStates: number;
  /** Members of this enum */
  enumMembers: number;
  enumTypeName: string | null;
  /** The POU declares its state variable with this enum type */
  typeDeclared: boolean;
}

/** State names used as CASE labels in doState(), plus the declared type of the state variable if the POU has it */
export function getPouCaseStates(pouContent: string): { states: string[]; declaredType: string | null } {
  const result = extractIdentifiedStatesFromPou(pouContent);
  const states = result.states.filter((s) => s.hasCaseBranch).map((s) => s.id);
  const varName = result.stateVarName.split('.').pop() || result.stateVarName;
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const typeMatch = pouContent.match(new RegExp(`\\b${escaped}\\s*:\\s*([A-Za-z_][A-Za-z0-9_]*)`));
  return { states, declaredType: typeMatch ? typeMatch[1] : null };
}

function enumInfo(dutContent: string): { members: Set<string>; typeName: string | null } {
  // Same reader the diagram generator uses (handles leading-comma enum layouts)
  let names: string[] = [];
  try {
    names = readEnumOrder(extractDeclaration(dutContent));
  } catch {
    names = [];
  }
  const typeMatch = dutContent.match(/\bTYPE\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/);
  return { members: new Set(names), typeName: typeMatch ? typeMatch[1] : null };
}

/**
 * Ranks .TcDUT files by how well their enum matches the POU's doState() states (best first). Files whose enum
 * declares none of the CASE states are left out. Ties: the enum type the POU declares, then the enum with fewer
 * extra members, then the file closest to the .TcPOU.
 */
export function rankDutCandidates(pouContent: string, candidates: DutCandidate[]): DutMatch[] {
  const { states, declaredType } = getPouCaseStates(pouContent);
  if (states.length === 0) return [];
  const matches: DutMatch[] = [];
  for (const c of candidates) {
    const { members, typeName } = enumInfo(c.content);
    if (members.size === 0) continue;
    const matched = states.filter((s) => members.has(s)).length;
    if (matched === 0) continue;
    matches.push({
      ...c,
      matched,
      caseStates: states.length,
      enumMembers: members.size,
      enumTypeName: typeName,
      typeDeclared: !!declaredType && declaredType === typeName,
    });
  }
  const depth = (p: string) => p.split(/[\\/]/).length;
  return matches.sort(
    (a, b) =>
      b.matched - a.matched ||
      Number(b.typeDeclared) - Number(a.typeDeclared) ||
      a.enumMembers - a.matched - (b.enumMembers - b.matched) ||
      depth(a.relativePath) - depth(b.relativePath) ||
      a.relativePath.localeCompare(b.relativePath)
  );
}
