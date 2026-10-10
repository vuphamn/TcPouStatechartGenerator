// Checks while typing in the Structured Text sections (no vscode here: tested on its own), kept to what a name index
// can say without the libraries' symbols (no false alarms for them):
//  - unused: a method's (function's, property accessor's) own variable (VAR, VAR_TEMP, VAR_INST) declared and never
//    used in it: shown faded
//  - undeclared: a plain name (no dot, not a call, not ALL_CAPS: libraries' constants are) used in an implementation
//    that nothing in the project declares (no variable, member, type, enum member of that name anywhere), and no IEC
//    function: a typo, most likely
// [{ line, column, length, kind: 'unused' | 'undeclared', message }]
'use strict';
const { blankCode, declarationsIn, KEYWORDS } = require('./stReferences.cjs');
const { declarationOutline } = require('./stOutline.cjs');

// IEC 61131-3 and TwinCAT's own names a project never declares (functions and blocks are calls: not checked anyway)
const STANDARD = new Set(['THIS', 'SUPER', 'TRUE', 'FALSE', 'NULL', 'ADR', 'ADRINST', 'SIZEOF', 'BITADR', 'REF', 'INDEXOF', 'UPPER_BOUND', 'LOWER_BOUND', 'ISVALIDREF', 'EN', 'ENO', 'TIME', 'LTIME', 'DATE', 'TOD', 'DT']);

const NAME_RX = /(?<![\w#.])[A-Za-z_]\w*(?![\w#])/g;

/** Offsets → line / column */
function lineColOf(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, column: offset - starts[lo] };
  };
}

/** Every name the project declares, lower case (variables, fields, enum members, headers, members, files' objects) */
function projectNames(files) {
  const out = new Set();
  for (const f of files) {
    out.add(f.name.toLowerCase());
    for (const m of f.members) out.add(m.name.toLowerCase());
    for (const s of f.sections) for (const d of s.decls) out.add(d.name.toLowerCase());
  }
  return out;
}

/**
 * The checks of one section: its text now (maybe unsaved), the member's declaration text (for an implementation: its
 * own variables), the project's files (stReferences.createIndex().project)
 */
function checkSection({ section, text, declText = '', implText = '', files = [], known = null, baseUnknown = false }) {
  const out = [];
  if (section === 'decl') {
    // Unused: the member's own variables (not its inputs, outputs, in-outs), not used in its implementation
    const blocks = declarationOutline(text).flatMap((h) => (h.kind === 'namespace' ? [h] : h.children.filter((c) => c.kind === 'namespace')));
    const header = /^\s*(?:\{[^}]*\}\s*)*(METHOD|FUNCTION|PROPERTY|ACTION)\b/im.test(blankCode(text));
    if (!header || !implText) return out;
    const used = new Set();
    const implCode = blankCode(implText);
    NAME_RX.lastIndex = 0;
    let m;
    while ((m = NAME_RX.exec(implCode))) used.add(m[0].toLowerCase());
    // (used in the declaration itself too: an initial value, an array bound)
    const code = blankCode(text);
    const at = lineColOf(code);
    for (const b of blocks) {
      if (!/^(VAR|VAR_TEMP|VAR_INST|VAR_STAT)$/i.test(b.name) || /CONSTANT/i.test(b.detail ?? '')) continue;
      for (const v of b.children) {
        const name = v.name.toLowerCase();
        if (used.has(name)) continue;
        const elsewhere = (code.match(new RegExp(`(?<![\\w#.])${v.name}(?![\\w#])`, 'gi')) ?? []).length > 1;
        if (elsewhere) continue;
        out.push({ ...at(v.nameStart), length: v.name.length, kind: 'unused', message: `${v.name} is declared but never used` });
      }
    }
    return out;
  }
  // Undeclared: a plain name no declaration in the project has (not in a POU that extends a library's: its members
  // are not known here)
  if (baseUnknown) return out;
  const names = known ?? projectNames(files);
  for (const d of declarationsIn(blankCode(declText))) names.add(d.name.toLowerCase());
  const code = blankCode(text);
  const at = lineColOf(code);
  NAME_RX.lastIndex = 0;
  let m;
  const seen = new Set();
  while ((m = NAME_RX.exec(code))) {
    const n = m[0];
    const lower = n.toLowerCase();
    if (names.has(lower) || STANDARD.has(n.toUpperCase()) || KEYWORDS.has(n.toUpperCase()) || /^[A-Z0-9_]+$/.test(n)) continue;
    const after = code.slice(m.index + n.length, m.index + n.length + 40);
    // (a call, a member chain's first part, a CASE label, a named argument: not checked)
    if (/^\s*[(.]/.test(after) || /^\s*(?::=|=>)/.test(after) && /[(,]\s*$/.test(code.slice(Math.max(0, m.index - 200), m.index))) continue;
    if (/^\s*:(?!=)/.test(after)) continue;
    const key = `${lower}@${m.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...at(m.index), length: n.length, kind: 'undeclared', message: `${n} is not declared in this project (a typo? a library's?)` });
  }
  return out;
}

/** Does the file's POU extend (EXTENDS after EXTENDS) a type the project does not have (a library's)? */
function extendsUnknown(files, file) {
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  let at = files.find((f) => f.file.toLowerCase() === String(file).toLowerCase());
  for (let i = 0; at && i < 10; i++) {
    const base = /\bEXTENDS\s+([A-Za-z_][\w.]*)/i.exec(at.sections.find((x) => x.key === '' && x.section === 'decl')?.code ?? '')?.[1];
    if (!base) return false;
    at = byName.get(base.split('.').pop().toLowerCase());
    if (!at) return true;
  }
  return false;
}

module.exports = { checkSection, projectNames, extendsUnknown };
