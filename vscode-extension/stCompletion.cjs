// IntelliSense in the Structured Text sections (no vscode here: tested on its own), from the project's declarations:
//  - after a dot: the members of the name's type (a project FB's inputs, outputs, methods and properties, its bases'
//    too; a struct's fields; an enum's members after its type's name: E_State.)
//  - else: the names visible here (the member's own variables, the POU's and its bases', its methods, properties and
//    actions), the global variables, the project's types
//  - in a call (Move(, fbTimer(): its parameters (a method's VAR_INPUT / VAR_IN_OUT / VAR_OUTPUT, an FB's inputs)
'use strict';
const path = require('path');
const { blankCode, declarationsIn } = require('./stReferences.cjs');
const { declarationOutline } = require('./stOutline.cjs');

/** A declaration section's variables with their block and type: [{ name, type, block }] */
function variablesOf(text) {
  const out = [];
  for (const top of declarationOutline(text)) {
    const blocks = top.kind === 'namespace' ? [top] : top.children.filter((c) => c.kind === 'namespace');
    for (const b of blocks) for (const v of b.children) out.push({ name: v.name, type: v.detail || '', block: b.name, kind: v.kind });
    if (top.kind === 'enum') for (const e of top.children) out.push({ name: e.name, type: '', block: 'ENUM', kind: 'enumMember' });
  }
  return out;
}

/** The project's objects by name: { file, kind (POU / DUT / GVL / Itf), name, members, sections } */
function byName(files) {
  return new Map(files.map((f) => [f.name.toLowerCase(), f]));
}
const declOf = (f, key = '') => f?.sections.find((s) => s.key === key && s.section === 'decl');
const rawOf = (f, key = '') => {
  // (the section's code, comments blanked: what declarationOutline reads)
  const s = declOf(f, key);
  return s ? s.code : '';
};
/** A POU's bases, EXTENDS after EXTENDS (the nearest first) */
function basesOf(files, f) {
  const names = byName(files);
  const out = [];
  for (let at = f, i = 0; at && i < 10; i++) {
    const base = /\bEXTENDS\s+([A-Za-z_]\w*)/i.exec(rawOf(at))?.[1];
    const next = base ? names.get(base.toLowerCase()) : null;
    if (!next || out.includes(next)) break;
    out.push(next);
    at = next;
  }
  return out;
}
/** The members of a type, as seen from outside it (after a dot) */
function membersOfType(files, typeName) {
  const t = byName(files).get(String(typeName).toLowerCase());
  if (!t) return [];
  const out = [];
  const add = (f) => {
    for (const v of variablesOf(rawOf(f))) {
      // (an FB from outside: its inputs and outputs; a struct: its fields; an enum: its members; a GVL: its variables)
      if (f.kind === 'POU' && !/^VAR_(INPUT|OUTPUT|IN_OUT)$/i.test(v.block)) continue;
      out.push({ label: v.name, kind: v.kind === 'enumMember' ? 'enumMember' : v.kind === 'field' ? 'field' : 'variable', detail: v.type ? `${v.type} (${f.name})` : f.name });
    }
    for (const m of f.members) if (m.key && /^(Method|Property)$/.test(m.kind)) out.push({ label: m.name, kind: m.kind === 'Method' ? 'method' : 'property', detail: `${m.kind.toLowerCase()} of ${f.name}` });
  };
  add(t);
  if (t.kind === 'POU') for (const b of basesOf(files, t)) add(b);
  return dedupe(out);
}
const dedupe = (list) => [...new Map(list.map((x) => [x.label.toLowerCase(), x])).values()];

/** The declared type of a name visible from a member (its own, the POU's, its bases', a global) */
function typeOfName(files, f, key, name) {
  const lower = name.toLowerCase();
  const look = (text) => variablesOf(text).find((v) => v.name.toLowerCase() === lower)?.type ?? null;
  if (key) {
    const own = look(rawOf(f, key)) ?? look(rawOf(f, key.replace(/\.(Get|Set)$/, '')));
    if (own) return own;
  }
  for (const at of [f, ...basesOf(files, f)]) {
    const t = look(rawOf(at));
    if (t) return t;
  }
  for (const g of files.filter((x) => x.kind === 'GVL')) {
    const t = look(rawOf(g));
    if (t) return t;
  }
  return null;
}
/** A type name as declared (ARRAY [..] OF X, POINTER TO X, REFERENCE TO X: X) */
const baseType = (t) => String(t ?? '').replace(/^\s*(?:ARRAY\s*\[[^\]]*\]\s*OF|POINTER\s+TO|REFERENCE\s+TO)\s+/i, '').replace(/\(.*$/, '').trim();

/**
 * Completions at a place: { file, key, section, text (the section's text now), offset } →
 * [{ label, kind, detail }] (kind: variable, field, enumMember, method, property, event, class, struct, enum, keyword)
 */
function completionsAt(files, { file, key, text, offset }) {
  const same = (x, y) => path.resolve(x).toLowerCase() === path.resolve(y).toLowerCase();
  const f = files.find((x) => same(x.file, file));
  if (!f) return [];
  const before = blankCode(text).slice(0, offset);
  const chain = /([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)\s*\.\s*[A-Za-z_]?\w*$/.exec(before);
  if (chain) {
    const parts = chain[1].split('.').map((s) => s.trim());
    // (E_State.: the enum's members; GVL_Name.: its variables)
    let type = byName(files).has(parts[0].toLowerCase()) ? parts[0] : typeOfName(files, f, key, parts[0]);
    for (const p of parts.slice(1)) {
      const next = byName(files).get(baseType(type).toLowerCase());
      type = next ? variablesOf(rawOf(next)).find((v) => v.name.toLowerCase() === p.toLowerCase())?.type ?? null : null;
      if (!type) break;
    }
    return type ? membersOfType(files, baseType(type)) : [];
  }
  const out = [];
  const vars = (text0, from) => variablesOf(text0).forEach((v) => out.push({ label: v.name, kind: v.kind === 'enumMember' ? 'enumMember' : 'variable', detail: v.type ? `${v.type} (${from})` : from }));
  if (key) vars(rawOf(f, key), key.replace(/^\w+:/, ''));
  for (const at of [f, ...basesOf(files, f)]) {
    vars(rawOf(at), at.name);
    for (const m of at.members) if (m.key && /^(Method|Property|Action)$/.test(m.kind)) out.push({ label: m.name, kind: m.kind === 'Method' ? 'method' : m.kind === 'Property' ? 'property' : 'event', detail: `${m.kind.toLowerCase()} of ${at.name}` });
  }
  for (const g of files.filter((x) => x.kind === 'GVL')) out.push({ label: g.name, kind: 'struct', detail: 'global variable list' });
  for (const t of files.filter((x) => x.kind === 'POU' || x.kind === 'DUT' || x.kind === 'Itf')) {
    const isEnum = t.kind === 'DUT' && /:\s*\(/.test(rawOf(t));
    out.push({ label: t.name, kind: t.kind === 'POU' ? 'class' : isEnum ? 'enum' : t.kind === 'Itf' ? 'interface' : 'struct', detail: t.kind === 'POU' ? 'POU' : isEnum ? 'enum' : t.kind === 'Itf' ? 'interface' : 'type' });
  }
  return dedupe(out);
}

/**
 * The call the caret is in, and its parameters: { name, params: [{ name, type, dir }], active } or null.
 * A method of the POU (or its bases), a method after a dot (fbAxis.MoveTo(), an FB instance's call (fbTimer(): its inputs)
 */
function signatureAt(files, { file, key, text, offset }) {
  const same = (x, y) => path.resolve(x).toLowerCase() === path.resolve(y).toLowerCase();
  const f = files.find((x) => same(x.file, file));
  if (!f) return null;
  const code = blankCode(text).slice(0, offset);
  // (the open call: the last "(" not closed)
  let depth = 0;
  let open = -1;
  let commas = 0;
  for (let i = code.length - 1; i >= 0; i--) {
    const c = code[i];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) {
        open = i;
        break;
      }
      depth--;
    } else if (c === ',' && depth === 0) commas++;
  }
  if (open < 0) return null;
  const callee = /([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*$/.exec(code.slice(0, open))?.[1];
  if (!callee) return null;
  const parts = callee.split('.');
  const name = parts[parts.length - 1];
  const paramsOf = (owner, memberKey) => variablesOf(rawOf(owner, memberKey)).filter((v) => /^VAR_(INPUT|IN_OUT|OUTPUT)$/i.test(v.block)).map((v) => ({ name: v.name, type: v.type, dir: v.block.toUpperCase() }));
  let params = null;
  if (parts.length === 1) {
    // (the POU's own method, or an FB instance's call: its inputs)
    for (const at of [f, ...basesOf(files, f)]) {
      const m = at.members.find((x) => x.kind === 'Method' && x.name.toLowerCase() === name.toLowerCase());
      if (m) {
        params = paramsOf(at, m.key);
        break;
      }
    }
    if (!params) {
      const t = typeOfName(files, f, key, name);
      const fb = t ? byName(files).get(baseType(t).toLowerCase()) : null;
      if (fb?.kind === 'POU') params = paramsOf(fb, '');
    }
  } else {
    const t = typeOfName(files, f, key, parts[0]);
    const fb = t ? byName(files).get(baseType(t).toLowerCase()) : null;
    const m = fb ? [fb, ...basesOf(files, fb)].flatMap((at) => at.members.filter((x) => x.kind === 'Method' && x.name.toLowerCase() === name.toLowerCase()).map((x) => ({ at, x })))[0] : null;
    if (m) params = paramsOf(m.at, m.x.key);
  }
  if (!params) return null;
  return { name: callee, params, active: Math.min(commas, Math.max(0, params.length - 1)) };
}

module.exports = { completionsAt, signatureAt, variablesOf, membersOfType };
void declarationsIn;
