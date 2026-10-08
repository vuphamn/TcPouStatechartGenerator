/**
 * The loaded .TcDUT brought to the PLC's enum (Live: the state variable's enum as the PLC describes it): a value named
 * otherwise there is renamed (in the .TcDUT and the POU's code: renameState, through a temporary name so swapped names
 * do not collide), a value the .TcDUT lacks is added with its value; values only the .TcDUT has are left (said).
 */
import { enumValueMap } from './liveView.ts';
import { renameState } from './stateEdits.ts';
import { addEnumMember } from './stateMachineLint.ts';

export interface PlcEnumChanges {
  renames: { value: number; from: string; to: string }[];
  adds: { value: number; name: string }[];
  /** In the .TcDUT, not on the PLC: left as they are */
  extra: { value: number; name: string }[];
}

const bare = (n: string) => n.split('.').pop()!.trim();

/** What bringing the .TcDUT to the PLC's names (value -> name) would change */
export function plcEnumChanges(dutContent: string, plcNames: Record<string, string>): PlcEnumChanges {
  const mine = enumValueMap(dutContent);
  const renames: PlcEnumChanges['renames'] = [];
  const adds: PlcEnumChanges['adds'] = [];
  for (const [v, raw] of Object.entries(plcNames)) {
    const value = Number(v);
    const name = bare(raw);
    if (!Number.isFinite(value) || !/^[A-Za-z_]\w*$/.test(name)) continue;
    const have = mine.get(value);
    if (have === undefined) adds.push({ value, name });
    else if (have.toLowerCase() !== name.toLowerCase()) renames.push({ value, from: have, to: name });
  }
  const extra = [...mine].filter(([v]) => !(String(v) in plcNames)).map(([value, name]) => ({ value, name }));
  return { renames, adds, extra };
}

/** The POU and the .TcDUT brought to the PLC's names; or { error } */
export function applyPlcEnum(pouXml: string, dutContent: string, plcNames: Record<string, string>): { pou: string; dut: string; changes: PlcEnumChanges } | { error: string } {
  const changes = plcEnumChanges(dutContent, plcNames);
  let pou = pouXml;
  let dut = dutContent;
  // (two steps: A -> B and B -> A at once)
  const temp = changes.renames.map((r, i) => ({ ...r, temp: `KSS_TEMP_${i}_${r.from}` }));
  for (const r of temp) ({ pou, dut } = renameState(pou, dut, r.from, r.temp));
  for (const r of temp) ({ pou, dut } = renameState(pou, dut, r.temp, r.to));
  for (const a of changes.adds) {
    const next = addEnumMember(dut, `${a.name} := ${a.value}`);
    if (next === null) return { error: `${a.name} could not be added to the .TcDUT's enum` };
    dut = next;
  }
  return { pou, dut, changes };
}
