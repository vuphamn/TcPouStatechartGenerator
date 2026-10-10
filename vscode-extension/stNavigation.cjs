// Navigation as TwinCAT XAE has it, over the project's sections (stReferences' index: files with their members and
// blanked sections): the project's symbols (Ctrl+T), folding (VAR / IF / CASE and its branches / FOR / WHILE / REPEAT /
// STRUCT / TYPE blocks, regions, comments), the type hierarchy (EXTENDS, IMPLEMENTS), calls (who calls a method, an
// action, a function, a program, an FB's body; what one calls) and implementations (an interface's or a base's
// subtypes, a method's overrides). By name, as Find All References is: not a compiler's resolution.
'use strict';
const { blankCode, KEYWORDS } = require('./stReferences.cjs');
const { implementationOutline } = require('./stOutline.cjs');

const lower = (s) => String(s ?? '').toLowerCase();
const last = (qualified) => String(qualified ?? '').split('.').pop();

/** 0-based line and column of an offset (starts: each line's first offset) */
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

const sectionOf = (f, key, section) => f.sections.find((s) => s.key === key && s.section === section);

/** Where a member (or the object, key '') is declared: its header in its declaration, else its implementation's start */
function memberLocation(f, key, name) {
  const decl = sectionOf(f, key, 'decl');
  const head = decl?.decls.find((d) => d.kind === 'header' && (!name || lower(d.name) === lower(name))) ?? decl?.decls.find((d) => d.kind === 'header');
  if (decl && head) return { file: f.file, key, section: 'decl', ...lineCol(decl.starts, head.offset), length: head.name.length };
  const impl = sectionOf(f, key, 'impl');
  if (impl) return { file: f.file, key, section: 'impl', line: 0, column: 0, length: 0 };
  if (decl) return { file: f.file, key, section: 'decl', line: 0, column: 0, length: 0 };
  return null;
}

const POU_HEADER = /^[ \t]*(FUNCTION_BLOCK|FUNCTION|PROGRAM|INTERFACE)\b((?:[ \t]+(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL|ABSTRACT|FINAL))*)[ \t]+([A-Za-z_]\w*)/im;
const TYPE_HEADER = /^[ \t]*TYPE[ \t]+([A-Za-z_]\w*)(?:[ \t]+EXTENDS[ \t]+([A-Za-z_][\w.]*))?[ \t]*:[ \t\r\n]*(STRUCT|UNION|\(|[A-Za-z_])/im;
const listOf = (s) => (s ?? '').split(',').map((x) => x.trim()).filter((x) => /^[A-Za-z_][\w.]*$/.test(x));

/**
 * The project's types: POUs and interfaces (their EXTENDS / IMPLEMENTS), DUTs (a struct's EXTENDS) →
 * [{ name, kind, file, extends, implements, location }]; kind: FUNCTION_BLOCK, FUNCTION, PROGRAM, INTERFACE, STRUCT,
 * UNION, ENUM, ALIAS
 */
const typesCache = new WeakMap();
function typesOf(files) {
  const hit = typesCache.get(files);
  if (hit) return hit;
  const out = [];
  typesCache.set(files, out);
  for (const f of files) {
    const decl = sectionOf(f, '', 'decl');
    if (!decl) continue;
    const code = decl.code;
    const p = POU_HEADER.exec(code);
    if (p) {
      // (the header up to its first VAR block / END_: EXTENDS and IMPLEMENTS, over one or more lines)
      const rest = code.slice(p.index + p[0].length);
      const cut = rest.search(/\b(VAR\w*|END_\w+|STRUCT)\b/i);
      const head = cut < 0 ? rest : rest.slice(0, cut);
      const ext = /\bEXTENDS\b([\s\S]*?)(?=\bIMPLEMENTS\b|$)/i.exec(head)?.[1];
      const imp = /\bIMPLEMENTS\b([\s\S]*)$/i.exec(head)?.[1];
      const at = p.index + p[0].length - p[3].length;
      out.push({ name: p[3], kind: p[1].toUpperCase(), file: f.file, extends: listOf(ext), implements: listOf(imp), location: { file: f.file, key: '', section: 'decl', ...lineCol(decl.starts, at), length: p[3].length } });
      continue;
    }
    const t = TYPE_HEADER.exec(code);
    if (t) {
      const kind = /^STRUCT$/i.test(t[3]) ? 'STRUCT' : /^UNION$/i.test(t[3]) ? 'UNION' : t[3] === '(' ? 'ENUM' : 'ALIAS';
      const at = t.index + t[0].indexOf(t[1], t[0].search(/TYPE/i) + 4);
      out.push({ name: t[1], kind, file: f.file, extends: t[2] ? [t[2]] : [], implements: [], location: { file: f.file, key: '', section: 'decl', ...lineCol(decl.starts, at), length: t[1].length } });
    }
  }
  return out;
}

const SYMBOL_KIND = { FUNCTION_BLOCK: 'class', FUNCTION: 'function', PROGRAM: 'module', INTERFACE: 'interface', STRUCT: 'struct', UNION: 'struct', ENUM: 'enum', ALIAS: 'typeParameter', Method: 'method', Property: 'property', Action: 'event', Transition: 'event' };

/** Does the query's letters appear in the name in order (case aside)? An empty query: everything */
function fits(name, query) {
  const q = lower(query).replace(/\s+/g, '');
  if (!q) return true;
  const n = lower(name);
  let i = 0;
  for (let k = 0; k < n.length && i < q.length; k++) if (n[k] === q[i]) i++;
  return i === q.length;
}

/**
 * The project's symbols for a query (Ctrl+T): its POUs, interfaces and DUTs; their methods, properties and actions
 * (named POU.Method); the global variable lists' variables; the enums' members (E_State.Idle) →
 * [{ name, kind, container, location }], the best (a name starting with the query) first, at most `limit`
 */
function workspaceSymbols(files, query = '', limit = 500) {
  const out = [];
  for (const t of typesOf(files)) out.push({ name: t.name, kind: SYMBOL_KIND[t.kind] ?? 'class', container: '', location: t.location });
  for (const f of files) {
    for (const mb of f.members ?? []) {
      if (!mb.key || /\.(Get|Set)$/.test(mb.key)) continue;
      const location = memberLocation(f, mb.key, mb.name);
      if (location) out.push({ name: mb.name, kind: SYMBOL_KIND[mb.kind] ?? 'method', container: f.name, location });
    }
    // (a global variable list's variables; an enum's members)
    for (const s of f.sections) {
      if (s.section !== 'decl' || s.key) continue;
      for (const d of s.decls) {
        if (f.kind === 'GVL' && d.kind === 'var') out.push({ name: d.name, kind: 'variable', container: f.name, location: { file: f.file, key: s.key, section: 'decl', ...lineCol(s.starts, d.offset), length: d.name.length } });
        else if (f.kind === 'DUT' && d.kind === 'enum') out.push({ name: d.name, kind: 'enumMember', container: f.name, location: { file: f.file, key: s.key, section: 'decl', ...lineCol(s.starts, d.offset), length: d.name.length } });
      }
    }
  }
  const q = lower(query).trim();
  const hits = out.filter((x) => fits(x.name, q) || fits(`${x.container}.${x.name}`, q));
  // (underscores aside: fbax is FB_Axis's start)
  const norm = (v) => lower(v).replace(/_/g, '');
  const nq = norm(q);
  const rank = (x) => (norm(x.name) === nq ? 0 : norm(x.name).startsWith(nq) ? 1 : norm(x.name).includes(nq) ? 2 : fits(x.name, q) ? 3 : 4);
  return hits.sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length || a.name.localeCompare(b.name)).slice(0, limit);
}

const OPENERS = { IF: 'END_IF', CASE: 'END_CASE', FOR: 'END_FOR', WHILE: 'END_WHILE', REPEAT: 'END_REPEAT', STRUCT: 'END_STRUCT', UNION: 'END_UNION' };

/**
 * A section's folding ranges, as XAE folds: VAR … END_VAR, IF / CASE / FOR / WHILE / REPEAT … END_, STRUCT, TYPE …
 * END_TYPE; each CASE branch (its label to the next); {region} … {endregion}; a comment over several lines →
 * [{ start, end, kind? 'region' | 'comment' }] (0-based lines; an END_ line stays visible)
 */
function foldingRanges(text) {
  const code = blankCode(text);
  const lines = code.split('\n');
  const starts = [];
  let o = 0;
  for (const l of lines) {
    starts.push(o);
    o += l.length + 1;
  }
  const out = [];
  const add = (start, end, kind) => {
    if (end > start) out.push(kind ? { start, end, kind } : { start, end });
  };
  const stack = [];
  const TOKEN = /(?<![\w#])[A-Za-z_]\w*/g;
  lines.forEach((l, i) => {
    TOKEN.lastIndex = 0;
    let m;
    let first = true;
    while ((m = TOKEN.exec(l))) {
      const tok = m[0].toUpperCase();
      // (VAR blocks and TYPE: a line's first word)
      const closer = OPENERS[tok] ?? (first && /^VAR(_\w+)?$/.test(tok) ? 'END_VAR' : first && tok === 'TYPE' && /^[ \t]+[A-Za-z_]/.test(l.slice(m.index + 4)) ? 'END_TYPE' : null);
      first = false;
      if (closer) stack.push({ closer, line: i });
      else if (tok.startsWith('END_')) {
        const at = stack.map((x) => x.closer).lastIndexOf(tok);
        if (at >= 0) {
          const open = stack.splice(at).shift();
          add(open.line, i - 1);
        }
      }
    }
  });
  // (the CASE branches: from their label to the line before the next one)
  const lineOf = (offset) => lineCol(starts, offset).line;
  const branches = (list) => {
    for (const b of list) {
      add(lineOf(b.start), lineOf(b.end) - 1);
      branches(b.children ?? []);
    }
  };
  branches(implementationOutline(text));
  // (regions and comments: in the text itself)
  const raw = text.split(/\r?\n/);
  const regions = [];
  raw.forEach((l, i) => {
    if (/^\s*\{\s*region\b/i.test(l)) regions.push(i);
    else if (/^\s*\{\s*endregion\b/i.test(l) && regions.length) add(regions.pop(), i, 'region');
  });
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i].indexOf('(*');
    if (s >= 0 && raw[i].indexOf('*)', s + 2) < 0) {
      let j = i + 1;
      while (j < raw.length && raw[j].indexOf('*)') < 0) j++;
      if (j < raw.length) add(i, j, 'comment');
      i = j;
    } else if (/^\s*\/\//.test(raw[i])) {
      let j = i;
      while (j + 1 < raw.length && /^\s*\/\//.test(raw[j + 1])) j++;
      if (j - i >= 2) add(i, j, 'comment');
      i = j;
    }
  }
  // (one range per start line: the longest)
  const best = new Map();
  for (const r of out) if (!best.has(r.start) || best.get(r.start).end < r.end) best.set(r.start, r);
  return [...best.values()].sort((a, b) => a.start - b.start);
}

/** A type by its name (qualified names by their last part) */
const typeNamed = (types, name) => types.find((t) => lower(t.name) === lower(last(name)));

/** The types a type extends or implements (the project's) */
function supertypes(files, name) {
  const types = typesOf(files);
  const t = typeNamed(types, name);
  return t ? [...t.extends, ...t.implements].map((n) => typeNamed(types, n)).filter(Boolean) : [];
}

/** The types that extend or implement a type */
function subtypes(files, name) {
  return typesOf(files).filter((t) => [...t.extends, ...t.implements].some((n) => lower(last(n)) === lower(last(name))));
}

/** Every type below a type (its subtypes, theirs, …) */
function allSubtypes(files, name) {
  const types = typesOf(files);
  const seen = new Map();
  const walk = (n) => {
    for (const t of types) {
      if (seen.has(lower(t.name))) continue;
      if ([...t.extends, ...t.implements].some((x) => lower(last(x)) === lower(last(n)))) {
        seen.set(lower(t.name), t);
        walk(t.name);
      }
    }
  };
  walk(name);
  return [...seen.values()];
}

// ---- Calls ---------------------------------------------------------------------------------------------------------

const CALLABLE_KINDS = new Set(['Method', 'Action']);

/** A call hierarchy item: a member (method, action) or a POU (its body: a function, a program, an FB) */
function memberItem(f, mb) {
  const location = memberLocation(f, mb.key, mb.name);
  return location ? { name: mb.name, kind: mb.kind === 'Action' ? 'action' : 'method', container: f.name, file: f.file, key: mb.key, location } : null;
}
function pouItem(files, t) {
  const f = files.find((x) => x.file === t.file);
  return f ? { name: t.name, kind: t.kind === 'FUNCTION' ? 'function' : t.kind === 'PROGRAM' ? 'program' : 'functionBlock', container: '', file: t.file, key: '', location: t.location } : null;
}
/** The item of a place: its member (a method's, an action's; else the POU's body) */
function itemOfPlace(files, file, key) {
  const f = files.find((x) => lower(x.file) === lower(file));
  if (!f) return null;
  const mb = key ? (f.members ?? []).find((m) => m.key === key) : null;
  if (mb && CALLABLE_KINDS.has(mb.kind)) return memberItem(f, mb);
  const t = typesOf([f])[0];
  return t ? pouItem(files, t) : null;
}

/** The variables a file declares with a type (instances: fbAxis : FB_Axis) → Map lowercased name → type name */
const instancesCache = new WeakMap();
function instancesIn(f) {
  const hit = instancesCache.get(f);
  if (hit) return hit;
  const out = new Map();
  instancesCache.set(f, out);
  for (const s of f.sections) {
    if (s.section !== 'decl') continue;
    const rx = /^[ \t]*([A-Za-z_]\w*(?:[ \t]*,[ \t]*[A-Za-z_]\w*)*)[ \t]*(?:AT[ \t]+%[\w.*]+[ \t]*)?:(?!=)[ \t]*(?:REFERENCE[ \t]+TO[ \t]+|POINTER[ \t]+TO[ \t]+)?([A-Za-z_][\w.]*)/gim;
    let m;
    while ((m = rx.exec(s.code))) for (const n of m[1].split(',')) out.set(lower(n.trim()), last(m[2]));
  }
  return out;
}

/**
 * The callables a name stands for at a place: a member of the place's POU (or its bases'), a project function /
 * program / FB, an FB instance there (its type's body), a member of an instance's type (inst.Method) → items
 */
function callablesNamed(files, { file, name, qualifier }) {
  const types = typesOf(files);
  const f = files.find((x) => lower(x.file) === lower(file));
  const out = [];
  const membersOf = (typeName, member) => {
    const chain = [];
    let t = typeNamed(types, typeName);
    while (t && !chain.includes(t)) {
      chain.push(t);
      t = t.extends.length ? typeNamed(types, t.extends[0]) : null;
    }
    for (const c of chain) {
      const cf = files.find((x) => x.file === c.file);
      const mb = (cf?.members ?? []).find((m) => CALLABLE_KINDS.has(m.kind) && lower(m.name) === lower(member));
      if (mb) return [memberItem(cf, mb)];
    }
    return [];
  };
  if (qualifier && f) {
    const q = lower(qualifier).replace(/\^$/, '');
    const own = typesOf([f])[0];
    const typeName = q === 'this' ? own?.name : q === 'super' ? own?.extends[0] : instancesIn(f).get(q);
    if (typeName) out.push(...membersOf(typeName, name));
    return out.filter(Boolean);
  }
  if (f) {
    const own = typesOf([f])[0];
    if (own) out.push(...membersOf(own.name, name));
    const inst = instancesIn(f).get(lower(name));
    const it = inst ? typeNamed(types, inst) : null;
    if (it && it.kind === 'FUNCTION_BLOCK') out.push(pouItem(files, it));
  }
  const t = typeNamed(types, name);
  if (t && ['FUNCTION', 'PROGRAM', 'FUNCTION_BLOCK'].includes(t.kind) && lower(t.name) === lower(name)) out.push(pouItem(files, t));
  const seen = new Set();
  return out.filter((x) => x && !seen.has(`${x.file}|${x.key}`) && seen.add(`${x.file}|${x.key}`));
}

const CALL_RX = /(?<![\w#.])(?:([A-Za-z_]\w*)(\^?)[ \t]*\.[ \t]*)?([A-Za-z_]\w*)[ \t]*\(/g;

/** Calls in a section's code: { name, qualifier, offset (of the name) } */
function callsIn(code) {
  const out = [];
  CALL_RX.lastIndex = 0;
  let m;
  while ((m = CALL_RX.exec(code))) {
    if (KEYWORDS.has(m[3].toUpperCase())) continue;
    const qualifier = m[1] ? `${m[1]}${m[2]}` : null;
    if (qualifier && KEYWORDS.has(m[1].toUpperCase()) && !/^(THIS|SUPER)$/i.test(m[1])) continue;
    out.push({ name: m[3], qualifier, offset: m.index + m[0].lastIndexOf(m[3]) });
  }
  return out;
}

const sameItem = (a, b) => a && b && lower(a.file) === lower(b.file) && a.key === b.key;

/** Who calls an item: [{ from: item, ranges: [{ line, column, length }] }] (the calls in the caller's implementation) */
function incomingCalls(files, item) {
  const groups = new Map();
  for (const f of files) {
    for (const s of f.sections) {
      if (s.section !== 'impl') continue;
      for (const c of callsIn(s.code)) {
        if (lower(c.name) !== lower(item.name) && !(item.kind === 'functionBlock' && instancesIn(f).get(lower(c.name)) && lower(instancesIn(f).get(lower(c.name))) === lower(item.name))) continue;
        if (!callablesNamed(files, { file: f.file, name: c.name, qualifier: c.qualifier }).some((x) => sameItem(x, item))) continue;
        const from = itemOfPlace(files, f.file, s.key);
        if (!from) continue;
        const k = `${from.file}|${from.key}`;
        if (!groups.has(k)) groups.set(k, { from, ranges: [], section: s.section });
        groups.get(k).ranges.push({ ...lineCol(s.starts, c.offset), length: c.name.length });
      }
    }
  }
  return [...groups.values()];
}

/** What an item calls: [{ to: item, ranges }] (the calls in its own implementation) */
function outgoingCalls(files, item) {
  const f = files.find((x) => lower(x.file) === lower(item.file));
  const s = f && sectionOf(f, item.key, 'impl');
  if (!s) return [];
  const groups = new Map();
  for (const c of callsIn(s.code)) {
    for (const to of callablesNamed(files, { file: f.file, name: c.name, qualifier: c.qualifier })) {
      if (sameItem(to, item)) continue;
      const k = `${to.file}|${to.key}`;
      if (!groups.has(k)) groups.set(k, { to, ranges: [] });
      groups.get(k).ranges.push({ ...lineCol(s.starts, c.offset), length: c.name.length });
    }
  }
  return [...groups.values()];
}

/**
 * Implementations of a name at a place: a type's subtypes (an interface's implementations, a base's extensions, theirs
 * too); a method's or property's overrides and implementations in those (of the place's type when it declares it,
 * else of every type declaring it) → locations
 */
function implementations(files, { file, name }) {
  const types = typesOf(files);
  const t = typeNamed(types, name);
  if (t && lower(t.name) === lower(name)) return allSubtypes(files, t.name).map((x) => x.location);
  const f = files.find((x) => lower(x.file) === lower(file));
  const declares = (ff) => (ff?.members ?? []).some((m) => (m.kind === 'Method' || m.kind === 'Property') && lower(m.name) === lower(name));
  const owners = f && declares(f) ? typesOf([f]) : types.filter((x) => declares(files.find((y) => y.file === x.file)));
  const out = [];
  const seen = new Set();
  for (const o of owners) {
    for (const sub of allSubtypes(files, o.name)) {
      const sf = files.find((x) => x.file === sub.file);
      const mb = (sf?.members ?? []).find((m) => (m.kind === 'Method' || m.kind === 'Property') && lower(m.name) === lower(name));
      if (!mb || seen.has(`${sf.file}|${mb.key}`)) continue;
      seen.add(`${sf.file}|${mb.key}`);
      const loc = memberLocation(sf, mb.key, mb.name);
      if (loc) out.push(loc);
    }
  }
  return out;
}

module.exports = { typesOf, workspaceSymbols, foldingRanges, supertypes, subtypes, allSubtypes, callablesNamed, itemOfPlace, incomingCalls, outgoingCalls, implementations, lineCol };
