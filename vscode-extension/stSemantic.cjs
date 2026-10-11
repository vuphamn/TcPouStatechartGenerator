// Semantic colours for Structured Text, from the project (stReferences' index): the project's types (a function block,
// a struct, an enum, an interface, a function, a program) and the standard blocks (TON, R_TRIG, CTU …); a function
// block's instances (fbAxis : FB_Axis, tonWait : TON) and their members after the dot (a method called, else a
// property); the enums' members (E_State.Idle, Idle); a POU's own methods called; constants (VAR CONSTANT). By name,
// as the rest of the editor: not a compiler's resolution.
'use strict';
const { blankCode, declarationsIn } = require('./stReferences.cjs');
const { typesOf, instancesIn } = require('./stNavigation.cjs');

/** The token types and modifiers, in the legend's order */
const TOKEN_TYPES = ['type', 'class', 'struct', 'enum', 'interface', 'function', 'namespace', 'enumMember', 'fbInstance', 'method', 'property', 'variable'];
const TOKEN_MODIFIERS = ['readonly', 'declaration', 'defaultLibrary'];

/** IEC 61131-3's and Tc2_Standard's function blocks: their instances coloured too */
const STANDARD_FBS = new Set(['TON', 'TOF', 'TP', 'TONR', 'LTON', 'LTOF', 'LTP', 'R_TRIG', 'F_TRIG', 'CTU', 'CTD', 'CTUD', 'RS', 'SR', 'SEMA', 'RTC', 'FB_TIMER'].map((x) => x.toLowerCase()));
const ELEMENTARY = new Set('BOOL BIT BYTE WORD DWORD LWORD SINT USINT INT UINT DINT UDINT LINT ULINT REAL LREAL TIME LTIME DATE LDATE TIME_OF_DAY TOD LTOD DATE_AND_TIME DT LDT STRING WSTRING ANY POINTER REFERENCE ARRAY OF TO'.split(' ').map((x) => x.toLowerCase()));

const KIND_TOKEN = { FUNCTION_BLOCK: 'class', FUNCTION: 'function', PROGRAM: 'namespace', INTERFACE: 'interface', STRUCT: 'struct', UNION: 'struct', ENUM: 'enum', ALIAS: 'type' };
const NAME_RX = /(?<![\w#])[A-Za-z_]\w*(?![\w#])/g;

/** What the project knows for colouring: its types by name, its enums' members, its FB types (lower case) */
function projectTables(files, libraryNames = new Set()) {
  const types = new Map();
  for (const t of typesOf(files)) types.set(t.name.toLowerCase(), t.kind);
  const enumMembers = new Map(); // member (lower) → its enum's name
  for (const f of files) {
    if (f.kind !== 'DUT') continue;
    for (const s of f.sections) for (const d of s.decls) if (d.kind === 'enum') enumMembers.set(d.name.toLowerCase(), f.name);
  }
  // (a library's function blocks: its FB_ / MC_ names)
  const isFb = (type) => {
    const t = String(type ?? '').split('.').pop().toLowerCase();
    return types.get(t) === 'FUNCTION_BLOCK' || STANDARD_FBS.has(t) || (libraryNames.has(t) && /^(fb|mc)_/.test(t));
  };
  return { types, enumMembers, isFb, libraryNames };
}

/**
 * A section's tokens: { text (the section's), file, key (its member), files (the project's), tables (projectTables) }
 * → [{ line, char, length, type, modifiers: [] }] in text order
 */
function semanticTokensOf({ text, file, key = '', files = [], tables }) {
  const code = blankCode(text);
  const t = tables ?? projectTables(files);
  const f = files.find((x) => String(x.file).toLowerCase() === String(file ?? '').toLowerCase());
  // The instances: the file's (its POU's and its methods' declarations), this section's own (an unsaved edit), the
  // global lists'
  const inst = new Map(f ? instancesIn(f) : []);
  const own = /^[ \t]*([A-Za-z_]\w*(?:[ \t]*,[ \t]*[A-Za-z_]\w*)*)[ \t]*(?:AT[ \t]+%[\w.*]+[ \t]*)?:(?!=)[ \t]*(?:REFERENCE[ \t]+TO[ \t]+|POINTER[ \t]+TO[ \t]+)?([A-Za-z_][\w.]*)/gim;
  let m;
  while ((m = own.exec(code))) for (const n of m[1].split(',')) inst.set(n.trim().toLowerCase(), m[2].split('.').pop());
  for (const g of files) if (g.kind === 'GVL') for (const [n, ty] of instancesIn(g)) if (!inst.has(n)) inst.set(n, ty);
  const fbInstances = new Set([...inst].filter(([, ty]) => t.isFb(ty)).map(([n]) => n));
  // (this POU's methods and actions: called by their name)
  const methods = new Set((f?.members ?? []).filter((x) => x.kind === 'Method' || x.kind === 'Action').map((x) => x.name.toLowerCase()));
  // (constants: the names declared in a VAR … CONSTANT block: this section's, its file's declarations', the global lists')
  const constants = new Set();
  const declCodes = [code, ...(f?.sections ?? []).filter((s) => s.section === 'decl').map((s) => s.code), ...files.filter((g) => g.kind === 'GVL').flatMap((g) => g.sections.map((s) => s.code))];
  for (const c of declCodes) for (const b of c.matchAll(/^[ \t]*VAR\w*[ \t]+CONSTANT\b([\s\S]*?)\bEND_VAR\b/gim)) for (const d of declarationsIn(b[1])) if (d.kind === 'var') constants.add(d.name.toLowerCase());
  const declAt = new Set(declarationsIn(code).filter((d) => d.kind === 'var').map((d) => d.offset));
  // (line starts)
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
  const at = (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, char: offset - starts[lo] };
  };
  const out = [];
  const push = (offset, length, type, modifiers = []) => out.push({ ...at(offset), length, type, modifiers });
  NAME_RX.lastIndex = 0;
  while ((m = NAME_RX.exec(code))) {
    const name = m[0];
    const lower = name.toLowerCase();
    const before = code.slice(Math.max(0, m.index - 80), m.index);
    const dot = /([A-Za-z_]\w*)(\^?)\s*\.\s*$/.exec(before);
    const after = code.slice(m.index + name.length);
    const call = /^\s*\(/.test(after);
    if (dot) {
      const q = dot[1].toLowerCase();
      // E_State.Idle: an enum's member; fbAxis.Move() / fbAxis.bDone: an instance's method / property
      if (t.types.get(q) === 'ENUM' || [...t.enumMembers].some(([mem, en]) => mem === lower && en.toLowerCase() === q)) push(m.index, name.length, 'enumMember');
      else if (fbInstances.has(q) || q === 'this' || q === 'super') push(m.index, name.length, call ? 'method' : 'property');
      continue;
    }
    if (ELEMENTARY.has(lower)) continue;
    const kind = t.types.get(lower);
    if (kind) {
      push(m.index, name.length, KIND_TOKEN[kind] ?? 'type');
      continue;
    }
    if (STANDARD_FBS.has(lower)) {
      push(m.index, name.length, 'class', ['defaultLibrary']);
      continue;
    }
    if (fbInstances.has(lower)) {
      push(m.index, name.length, 'fbInstance', declAt.has(m.index) ? ['declaration'] : []);
      continue;
    }
    if (constants.has(lower)) {
      push(m.index, name.length, 'variable', ['readonly', ...(declAt.has(m.index) ? ['declaration'] : [])]);
      continue;
    }
    if (call && methods.has(lower)) {
      push(m.index, name.length, 'method');
      continue;
    }
    // (a bare enum member, not a variable here: Idle in CASE … OF Idle:)
    if (t.enumMembers.has(lower) && !inst.has(lower)) push(m.index, name.length, 'enumMember');
  }
  return out;
}

module.exports = { TOKEN_TYPES, TOKEN_MODIFIERS, STANDARD_FBS, projectTables, semanticTokensOf };
