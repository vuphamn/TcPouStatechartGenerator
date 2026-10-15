// State names from a PLC project's sources, for state machines whose state variable the PLC only knows as a number
// (Kval's KvalStateMachineBase: machineState : INT; the enum used in the code only): each machine type's enum found in
// its state method's CASE labels (E_X_States.MEMBER:) or its state variable's assignments (machineState :=
// E_X_States.MEMBER), in it or the types it EXTENDS; that enum's members and values read from its .TcDUT (as the app's
// enumValueMap: implicit values counted on, := 16#… / 2#…, comments ignored). No vscode, no ADS: tested on its own.

/** The CDATA of the first <tag> (Declaration, ST) after `from`, or '' */
const cdata = (xml, tag, from = 0) => xml.slice(from).match(new RegExp(`<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`, 'i'))?.[1] ?? '';

// Comments blanked (line comments, (* … *) and C-style block comments), strings kept; positions unchanged
function blankComments(text) {
  return text
    .replace(/\(\*[\s\S]*?\*\)|\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/** IEC integer literal: 12, -3, 16#FF, 2#1010, 8#17, INT#5 (underscores allowed); null when not one */
function integerLiteral(text) {
  const t = String(text).replace(/_/g, '').replace(/^[A-Z_]+#(?=[-\d])/i, '');
  const based = t.match(/^(2|8|16)#([0-9A-F]+)$/i);
  if (based) return parseInt(based[2], Number(based[1]));
  return /^-?\d+$/.test(t) ? parseInt(t, 10) : null;
}

/** An enum DUT's members by value: { 0: 'S_IDLE', 1: 'S_RUN' } ({} when it is not an enum) */
function enumValues(dutXml) {
  const decl = blankComments(cdata(dutXml, 'Declaration') || dutXml);
  // (TYPE E_X : ( A, B := 5, C ) [base type] ; END_TYPE: the list between the first "(" after ":" and its ")")
  const m = decl.match(/\bTYPE\s+[A-Za-z_]\w*\s*:\s*\(([\s\S]*?)\)\s*(?:[A-Za-z_]\w*)?\s*(?::=[^;]*)?;?\s*END_TYPE/i);
  if (!m) return {};
  const out = {};
  let next = 0;
  for (const part of m[1].split(',')) {
    const p = part.match(/^\s*([A-Za-z_]\w*)\s*(?::=\s*([^\s]+))?\s*$/);
    if (!p) continue;
    let value = next;
    if (p[2] !== undefined) value = integerLiteral(p[2]);
    if (value === null) {
      next = null;
      continue;
    }
    if (!(value in out)) out[value] = p[1];
    next = value + 1;
  }
  return out;
}

/** The files by object name (lower case): { pous: { name: xml }, duts: { name: xml } } */
function indexSources(files) {
  const pous = new Map();
  const duts = new Map();
  for (const f of files) {
    const text = String(f.content ?? '');
    const pou = text.match(/<POU\b[^>]*\bName="([^"]+)"/);
    if (pou) pous.set(pou[1].toLowerCase(), text);
    const dut = text.match(/<DUT\b[^>]*\bName="([^"]+)"/);
    if (dut) duts.set(dut[1].toLowerCase(), text);
  }
  // (each DUT's enum members, worked out once)
  const values = new Map();
  const valuesOf = (name, xml) => {
    if (!values.has(name)) values.set(name, enumValues(xml));
    return values.get(name);
  };
  return { pous, duts, valuesOf };
}

/** The enum a POU's state variable takes (its CASE labels, its assignments), or null; its base types tried after it */
function stateEnumOf(index, type, stateVar = 'machineState', seen = new Set()) {
  const key = type.toLowerCase();
  if (seen.has(key)) return null;
  seen.add(key);
  const xml = index.pous.get(key);
  if (!xml) return null;
  const code = blankComments(xml);
  const sv = stateVar.replace(/[^\w]/g, '');
  // (CASE machineState OF / CASE (machineState) OF … E_X.MEMBER: …; or machineState := E_X.MEMBER)
  const caseRx = new RegExp(`\\bCASE\\s*\\(?\\s*(?:THIS\\^\\.)?${sv}\\s*\\)?\\s*OF\\b`, 'i');
  const caseAt = code.search(caseRx);
  const label = caseAt >= 0 ? code.slice(caseAt).match(/\bOF\b[\s\S]*?\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*(?:,[^:]*)?:(?!=)/i) : null;
  const assigned = code.match(new RegExp(`\\b(?:THIS\\^\\.)?${sv}\\s*:=\\s*([A-Za-z_]\\w*)\\.([A-Za-z_]\\w*)`, 'i'));
  for (const m of [label, assigned]) {
    if (m && index.duts.has(m[1].toLowerCase())) return m[1];
  }
  // (unqualified members, machineState := BALLCATCH_RESET; and CASE labels: the enum that has most of them)
  const used = new Set();
  for (const m of code.matchAll(new RegExp(`\\b(?:THIS\\^\\.)?${sv}\\s*:=\\s*([A-Za-z_]\\w*)\\s*;`, 'gi'))) used.add(m[1].toLowerCase());
  if (caseAt >= 0) {
    for (const m of code.slice(caseAt).matchAll(/^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*:(?!=)/gm)) {
      for (const n of m[1].split(',')) used.add(n.trim().toLowerCase());
    }
  }
  if (used.size) {
    let best = null;
    for (const [name, dut] of index.duts) {
      const members = Object.values(index.valuesOf(name, dut)).map((x) => x.toLowerCase());
      const hits = members.filter((x) => used.has(x)).length;
      if (hits && (!best || hits > best.hits)) best = { name: dut.match(/<DUT\b[^>]*\bName="([^"]+)"/)[1], hits };
    }
    if (best && best.hits >= Math.min(2, used.size)) return best.name;
  }
  // (its base type's)
  const ext = (cdata(xml, 'Declaration') || xml).match(/\bFUNCTION_BLOCK\s+(?:(?:PUBLIC|INTERNAL|ABSTRACT|FINAL)\s+)*[A-Za-z_]\w*\s+EXTENDS\s+([A-Za-z_][\w.]*)/i);
  return ext ? stateEnumOf(index, ext[1].split('.').pop(), stateVar, seen) : null;
}

/**
 * Each type's state names from the sources: types (the machines' types, e.g. SM_TableManager) → Map(type lower case →
 * { value: name }) for those whose enum was found (the others left out)
 */
function stateNamesFromSources(files, types, stateVar = 'machineState') {
  const index = indexSources(files);
  const out = new Map();
  for (const t of new Set(types.map((x) => String(x).split('.').pop()).filter(Boolean))) {
    const e = stateEnumOf(index, t, stateVar);
    const values = e ? enumValues(index.duts.get(e.toLowerCase())) : {};
    if (Object.keys(values).length) out.set(t.toLowerCase(), values);
  }
  return out;
}

module.exports = { stateNamesFromSources, stateEnumOf, enumValues, indexSources, integerLiteral };
