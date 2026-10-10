// Find All References and Go to Definition for the Structured Text sections of a TwinCAT project (no vscode here:
// tested on its own). By name, as Structured Text is (case-insensitive), outside comments, strings and pragmas; not a
// compiler's resolution: a local variable of the same name in another POU is listed too.
//  - references: every use of the name in the project's .TcPOU / .TcDUT / .TcGVL / .TcIO sections
//  - definition: its declarations, the nearest first: the member's own (a method's VAR, its header), its POU's (the
//    FB's VAR, a method or action of that name), then the project's: a type (FUNCTION_BLOCK, TYPE, INTERFACE,
//    FUNCTION, PROGRAM), a global variable, an enum member; after a dot (E_State.Idle, fbAxis.Enable) the one in the
//    type named before the dot first
'use strict';
const fs = require('fs');
const path = require('path');
const { parseSource } = require('./tcStSource.cjs');

const SOURCE_RX = /\.(tcpou|tcdut|tcgvl|tcio)$/i;
const SKIP = new Set(['.git', '.vs', '_Boot', '_CompileInfo', '_Libraries', 'node_modules']);
const KEYWORDS = new Set('IF THEN ELSIF ELSE END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT EXIT CONTINUE RETURN AND OR XOR NOT MOD VAR VAR_INPUT VAR_OUTPUT VAR_IN_OUT VAR_GLOBAL VAR_TEMP VAR_STAT VAR_INST VAR_EXTERNAL VAR_CONFIG END_VAR CONSTANT RETAIN PERSISTENT TRUE FALSE FUNCTION_BLOCK END_FUNCTION_BLOCK FUNCTION END_FUNCTION PROGRAM END_PROGRAM METHOD END_METHOD PROPERTY END_PROPERTY INTERFACE END_INTERFACE TYPE END_TYPE STRUCT END_STRUCT UNION END_UNION ACTION END_ACTION EXTENDS IMPLEMENTS PUBLIC PRIVATE PROTECTED INTERNAL ABSTRACT FINAL THIS SUPER ARRAY POINTER REFERENCE AT BOOL BYTE WORD DWORD LWORD SINT USINT INT UINT DINT UDINT LINT ULINT REAL LREAL TIME LTIME DATE TOD DT STRING WSTRING'.split(' '));

/** The text with its comments, strings and pragmas blanked (spaces; line breaks kept): names found in code only */
function blankCode(text) {
  const out = text.split('');
  const n = text.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  let i = 0;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '(' && d === '*') {
      // ((* *) may nest in TwinCAT)
      const s = i;
      let depth = 0;
      while (i < n) {
        if (text[i] === '(' && text[i + 1] === '*') { depth++; i += 2; }
        else if (text[i] === '*' && text[i + 1] === ')') { depth--; i += 2; if (depth === 0) break; }
        else i++;
      }
      blank(s, i);
    } else if (c === '/' && d === '*') {
      const s = i;
      const e = text.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
      blank(s, i);
    } else if (c === '/' && d === '/') {
      const s = i;
      while (i < n && text[i] !== '\n') i++;
      blank(s, i);
    } else if (c === "'" || c === '"') {
      const s = i++;
      while (i < n && text[i] !== c && text[i] !== '\n') i += text[i] === '$' ? 2 : 1;
      i++;
      blank(s, i);
    } else if (c === '{') {
      const s = i;
      const e = text.indexOf('}', i);
      i = e < 0 ? n : e + 1;
      blank(s, i);
    } else i++;
  }
  return out.join('');
}

const NAME_RX = /(?<![\w#])[A-Za-z_]\w*(?![\w#])/g;

/** Offsets of the starts of lines (for an offset's line and column) */
function lineStarts(text) {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') out.push(i + 1);
  return out;
}
function lineCol(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, column: offset - starts[lo] };
}

/**
 * The declarations in a declaration section's (blanked) text: [{ name, offset, kind }]: 'header' (FUNCTION_BLOCK X,
 * METHOD X, TYPE X …), 'var' (VAR … END_VAR, a STRUCT's fields), 'enum' (TYPE X : (A, B), an inline enum)
 */
function declarationsIn(code) {
  const out = [];
  const header = /^[ \t]*(FUNCTION_BLOCK|FUNCTION|PROGRAM|METHOD|PROPERTY|INTERFACE|ACTION|TYPE)\b((?:[ \t]+(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL|ABSTRACT|FINAL))*)[ \t]+([A-Za-z_]\w*)/gim;
  let m;
  const headerLines = new Set();
  while ((m = header.exec(code))) {
    out.push({ name: m[3], offset: m.index + m[0].length - m[3].length, kind: 'header' });
    headerLines.add(code.lastIndexOf('\n', m.index) + 1);
  }
  // Variables and fields: "a, b : INT;", "x AT %I* : BOOL;" at a line's start (not a header line, not ":=")
  const vars = /^[ \t]*([A-Za-z_]\w*(?:[ \t]*,[ \t]*[A-Za-z_]\w*)*)[ \t]*(?:AT[ \t]+%[\w.*]+[ \t]*)?:(?!=)/gm;
  while ((m = vars.exec(code))) {
    if (headerLines.has(m.index)) continue;
    let at = m.index + m[0].indexOf(m[1]);
    for (const part of m[1].split(',')) {
      const name = part.trim();
      const local = part.indexOf(name);
      if (name && !KEYWORDS.has(name.toUpperCase())) out.push({ name, offset: at + local, kind: 'var' });
      at += part.length + 1;
    }
  }
  // Enum members: inside "( … )" after a colon (TYPE E : ( … ), Phase : ( … )): each item's leading name
  const enumStart = /:[ \t\r\n]*\(/g;
  while ((m = enumStart.exec(code))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const from = i + 1;
    for (; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')' && --depth === 0) break;
    }
    const body = code.slice(from, i);
    let offset = from;
    for (const item of body.split(',')) {
      const n = /^\s*([A-Za-z_]\w*)\s*(?::=|$)/.exec(item);
      if (n) out.push({ name: n[1], offset: offset + item.indexOf(n[1]), kind: 'enum' });
      offset += item.length + 1;
    }
  }
  return out;
}

/** The index of a project's sections: cached per file by its time and size (the open, edited ones given as text) */
function createIndex() {
  const cache = new Map();
  /** Every source file of the project folder */
  function sourcesIn(root, depth = 0, out = []) {
    if (depth > 8) return out;
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      const p = path.join(root, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith('.')) sourcesIn(p, depth + 1, out);
      } else if (SOURCE_RX.test(e.name)) out.push(p);
    }
    return out;
  }
  /** A file's sections, each with its blanked text, line starts and declarations */
  function fileOf(file) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      return null;
    }
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    let parsed;
    try {
      parsed = parseSource(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
    const sections = [];
    for (const mb of parsed.members) {
      for (const section of ['decl', 'impl']) {
        if (mb[section]) sections.push(sectionEntry(mb.key, section, mb[section].text));
      }
    }
    const entry = { mtimeMs: st.mtimeMs, size: st.size, kind: parsed.kind, name: parsed.name, members: parsed.members, sections };
    cache.set(file, entry);
    return entry;
  }
  function sectionEntry(key, section, text) {
    const code = blankCode(text);
    return { key, section, code, starts: lineStarts(code), decls: section === 'decl' ? declarationsIn(code) : [] };
  }
  /**
   * The project's files with their sections; overrides: file|key|section → text (an open section's unsaved text)
   */
  function project(root, overrides = new Map()) {
    const files = [];
    for (const file of sourcesIn(root)) {
      const f = fileOf(file);
      if (!f) continue;
      const sections = f.sections.map((s) => {
        const text = overrides.get(`${path.resolve(file).toLowerCase()}|${s.key}|${s.section}`);
        return text === undefined ? s : sectionEntry(s.key, s.section, text);
      });
      files.push({ file, kind: f.kind, name: f.name, members: f.members, sections });
    }
    return files;
  }
  return { project };
}

/** The name at a place of a section's text, and the name before a dot there (E_State.Idle: Idle, E_State) */
function nameAt(text, line, column) {
  const code = blankCode(text);
  const starts = lineStarts(code);
  const lineText = code.slice(starts[line] ?? code.length, starts[line + 1] ?? code.length);
  NAME_RX.lastIndex = 0;
  let m;
  while ((m = NAME_RX.exec(lineText))) {
    if (m.index <= column && column <= m.index + m[0].length) {
      const before = /([A-Za-z_]\w*)\s*\.\s*$/.exec(lineText.slice(0, m.index));
      return { name: m[0], qualifier: before ? before[1] : null };
    }
  }
  return null;
}

/** Every use of the name in the project: [{ file, key, section, line, column, length, declaration }] */
/**
 * How a name is used at a place of blanked code (its offset and length): 'write' (x := …, x.a[i] := …, x R= / S=, an
 * output bound to it: Q => x), 'call' (x(…): an FB instance's or a function's call), else 'read'
 */
function accessOf(code, offset, length) {
  // (its members and indexes after it: pos.x := 1 writes pos)
  const rest = code.slice(offset + length).replace(/^(?:\s*(?:\.\s*[A-Za-z_]\w*|\[[^\]\n]*\]|\^))*/, '');
  if (/^\s*(?::=|[RS]=)/.test(rest)) return 'write';
  if (/=>\s*$/.test(code.slice(Math.max(0, offset - 60), offset))) return 'write';
  if (/^\s*\(/.test(rest)) return 'call';
  return 'read';
}

/** The places of a name in a section's blanked code: [{ offset, length, access: 'declaration' | 'write' | 'call' | 'read' }] */
function occurrencesIn(code, decls, name) {
  const want = String(name).toLowerCase();
  const declAt = new Set((decls ?? []).filter((d) => d.name.toLowerCase() === want).map((d) => d.offset));
  const out = [];
  NAME_RX.lastIndex = 0;
  let m;
  while ((m = NAME_RX.exec(code))) {
    if (m[0].toLowerCase() !== want) continue;
    out.push({ offset: m.index, length: m[0].length, access: declAt.has(m.index) ? 'declaration' : accessOf(code, m.index, m[0].length) });
  }
  return out;
}

function findReferences(files, name) {
  const want = name.toLowerCase();
  const out = [];
  for (const f of files) {
    for (const s of f.sections) {
      const declAt = new Set(s.decls.filter((d) => d.name.toLowerCase() === want).map((d) => d.offset));
      NAME_RX.lastIndex = 0;
      let m;
      while ((m = NAME_RX.exec(s.code))) {
        if (m[0].toLowerCase() !== want) continue;
        out.push({ file: f.file, key: s.key, section: s.section, ...lineCol(s.starts, m.index), length: m[0].length, declaration: declAt.has(m.index), access: declAt.has(m.index) ? 'declaration' : accessOf(s.code, m.index, m[0].length) });
      }
    }
  }
  return out;
}

/**
 * The name's declarations, the nearest first (only the nearest group): from a place in a file's member (file, key)
 * → [{ file, key, section, line, column, length }]
 */
function findDefinition(files, { file, key, name, qualifier }) {
  const want = name.toLowerCase();
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  // (the POU's bases, EXTENDS after EXTENDS: their declarations next after its own, the nearest base first)
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  const bases = new Map();
  let at = files.find((f) => same(f.file, file));
  for (let depth = 1; at && depth < 10; depth++) {
    const base = /\bEXTENDS\s+([A-Za-z_]\w*)/i.exec(at.sections.find((s) => s.key === '' && s.section === 'decl')?.code ?? '')?.[1]?.toLowerCase();
    if (!base || bases.has(base)) break;
    bases.set(base, depth);
    at = byName.get(base);
  }
  const candidates = [];
  for (const f of files) {
    for (const s of f.sections) {
      for (const d of s.decls) {
        if (d.name.toLowerCase() !== want) continue;
        let rank;
        const here = same(f.file, file);
        if (qualifier) {
          // (after a dot: the type named before it first, then any type's member of that name)
          rank = f.name.toLowerCase() === qualifier.toLowerCase() ? 0 : d.kind === 'enum' || d.kind === 'header' || s.key !== '' ? 2 : 3;
        } else if (here && s.key === key) rank = 0;
        else if (here && (s.key === '' || d.kind === 'header')) rank = 1;
        else if (bases.has(f.name.toLowerCase()) && (s.key === '' || d.kind === 'header')) rank = 1 + bases.get(f.name.toLowerCase()) / 100;
        else if (d.kind === 'header' && s.key === '') rank = 2;
        else if (f.kind === 'GVL' || d.kind === 'enum') rank = 3;
        // (another member's local of this POU before other POUs' locals)
        else if (here) rank = 3.5;
        else rank = 4;
        candidates.push({ rank, file: f.file, key: s.key, section: s.section, ...lineCol(s.starts, d.offset), length: d.name.length });
      }
    }
    // (an action or transition of that name: no declaration, its implementation)
    for (const mb of f.members) {
      if ((mb.kind === 'Action' || mb.kind === 'Transition') && mb.name.toLowerCase() === want && mb.impl) {
        candidates.push({ rank: same(f.file, file) ? 1 : 4, file: f.file, key: mb.key, section: 'impl', line: 0, column: 0, length: 0 });
      }
    }
  }
  if (!candidates.length) return [];
  const best = Math.min(...candidates.map((c) => c.rank));
  return candidates.filter((c) => c.rank === best).map(({ rank, ...c }) => c); // eslint-disable-line no-unused-vars
}

/**
 * Rename, by the name's declaration (found from the place: file, key, qualifier): a method's own variable in that
 * method only; a POU's variable in that POU and the POUs that extend it (EXTENDS), and its uses after a dot elsewhere
 * (fbScan.State: their type not known here) apart, for a look; a global variable, an enum member, a type: everywhere.
 * { edits: [{ file, key, section, line, column, length, apart }], scope } or { error }: the new name not an identifier
 * or a keyword; the name a TwinCAT object's (a POU, DUT, GVL, method, property, action: XAE keeps it in the file's XML
 * too); not declared in this project (a library's); the new name already declared where the old one is used
 */
function renameEdits(files, at, newName) {
  const name = at.name;
  const to = String(newName ?? '').trim();
  if (!/^[A-Za-z_]\w*$/.test(to) || /__/.test(to)) return { error: `"${to}" is not a Structured Text name (letters, digits, single underscores)` };
  if (KEYWORDS.has(to.toUpperCase())) return { error: `"${to}" is a Structured Text keyword` };
  if (to === name) return { edits: [], scope: 'none' };
  const want = name.toLowerCase();
  for (const f of files) {
    if (f.name.toLowerCase() === want) return { error: `${name} is the name of ${path.basename(f.file)}: rename it in TwinCAT XAE (the file and its object)` };
    const mb = f.members.find((m) => m.key !== '' && m.name.toLowerCase() === want);
    if (mb) return { error: `${name} is ${mb.kind === 'Method' ? 'a method' : mb.kind === 'Property' ? 'a property' : `an ${mb.kind.toLowerCase()}`} of ${f.name}: rename it in TwinCAT XAE (its object in the file)` };
  }
  const defs = findDefinition(files, at);
  if (!defs.length) return { error: `${name} is not declared in this project (a library's?): it is not renamed here` };
  const def = defs[0];
  const same = (x, y) => path.resolve(x).toLowerCase() === path.resolve(y).toLowerCase();
  const defFile = files.find((f) => same(f.file, def.file));
  const refs = findReferences(files, name);
  let scope;
  let inScope;
  if (def.key !== '' && defFile?.kind === 'POU') {
    // (a method's, property's own variable: only there)
    scope = 'member';
    inScope = (r) => same(r.file, def.file) && (r.key === def.key || r.key.startsWith(`${def.key}.`));
  } else if (defFile?.kind === 'POU' && def.key === '') {
    // (a POU's variable: the POU, and the POUs that extend it, after EXTENDS after EXTENDS)
    scope = 'pou';
    const family = new Set([defFile.name.toLowerCase()]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const f of files) {
        const base = /\bEXTENDS\s+([A-Za-z_]\w*)/i.exec(f.sections.find((x) => x.key === '' && x.section === 'decl')?.code ?? '')?.[1]?.toLowerCase();
        if (base && family.has(base) && !family.has(f.name.toLowerCase())) {
          family.add(f.name.toLowerCase());
          grew = true;
        }
      }
    }
    inScope = (r) => family.has((files.find((f) => same(f.file, r.file))?.name ?? '').toLowerCase());
  } else {
    scope = 'project';
    inScope = () => true;
  }
  // (uses after a dot outside the scope: fbScan.State in another POU: listed apart)
  const dotted = (r) => {
    const f = files.find((x) => same(x.file, r.file));
    const sec = f?.sections.find((x) => x.key === r.key && x.section === r.section);
    if (!sec) return false;
    const off = sec.starts[r.line] + r.column;
    return /\.\s*$/.test(sec.code.slice(Math.max(0, off - 40), off));
  };
  const edits = [];
  for (const r of refs) {
    if (inScope(r)) edits.push({ ...r, apart: false });
    else if (scope === 'pou' && dotted(r)) edits.push({ ...r, apart: true });
  }
  if (!edits.length) return { error: `${name} is not used where it is declared` };
  // (the new name already declared where the edits go)
  if (to.toLowerCase() !== want) {
    for (const e of edits) {
      const f = files.find((x) => same(x.file, e.file));
      for (const sec of f?.sections ?? []) {
        if (scope === 'member' && !(sec.key === def.key || sec.key === '')) continue;
        const clash = sec.decls.find((d) => d.name.toLowerCase() === to.toLowerCase());
        if (clash) return { error: `${to} is already declared in ${f.name}${sec.key ? ` (${sec.key.replace(/^\w+:/, '')})` : ''}: choose another name` };
      }
    }
  }
  return { edits: edits.map(({ declaration, ...r }) => r), scope }; // eslint-disable-line no-unused-vars
}

module.exports = { blankCode, declarationsIn, createIndex, nameAt, findReferences, findDefinition, renameEdits, accessOf, occurrencesIn, KEYWORDS };
