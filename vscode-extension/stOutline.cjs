// The outline of a Structured Text section (no vscode here: tested on its own), for VS Code's Outline view and the
// breadcrumbs: a declaration's object (FUNCTION_BLOCK, METHOD, TYPE …) with its VAR blocks and their variables (a
// struct's fields, an enum's members); an implementation's CASE branches (the states), each from its label to the
// next one. [{ name, detail, kind, start, end, nameStart, nameEnd, children }]: offsets in the text; kind: one of
// 'class' 'method' 'property' 'function' 'interface' 'struct' 'enum' 'namespace' 'variable' 'field' 'enumMember'
// 'constant' 'event'
'use strict';
const { blankCode, declarationsIn } = require('./stReferences.cjs');

const HEADER_KIND = { FUNCTION_BLOCK: 'class', PROGRAM: 'class', FUNCTION: 'function', METHOD: 'method', PROPERTY: 'property', INTERFACE: 'interface', ACTION: 'event', TYPE: 'struct' };

/** The outline of a declaration section */
function declarationOutline(text) {
  const code = blankCode(text);
  const decls = declarationsIn(code);
  const out = [];
  // The object: its header (the first one), the whole text its range
  const header = /^[ \t]*(FUNCTION_BLOCK|FUNCTION|PROGRAM|METHOD|PROPERTY|INTERFACE|ACTION|TYPE)\b(?:[ \t]+(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL|ABSTRACT|FINAL))*[ \t]+([A-Za-z_]\w*)([^\n]*)/im.exec(code);
  // VAR blocks (VAR_INPUT … END_VAR), STRUCT … END_STRUCT, an enum's ( … )
  const blocks = [];
  const blockRx = /\b(VAR(?:_INPUT|_OUTPUT|_IN_OUT|_GLOBAL|_TEMP|_STAT|_INST|_EXTERNAL|_CONFIG)?)\b([^\n]*)|\bEND_VAR\b|\bSTRUCT\b|\bEND_STRUCT\b/gi;
  let open = null;
  let m;
  while ((m = blockRx.exec(code))) {
    const word = m[0].trim().split(/\s/)[0].toUpperCase();
    if (word === 'END_VAR' || word === 'END_STRUCT') {
      if (open) {
        open.end = m.index + m[0].length;
        blocks.push(open);
        open = null;
      }
    } else if (!open) {
      const qualifiers = (m[2] ?? '').trim().split(/\s+/).filter((w) => /^(CONSTANT|RETAIN|PERSISTENT)$/i.test(w)).join(' ');
      open = { name: word === 'STRUCT' ? 'STRUCT' : word, detail: qualifiers, start: m.index, nameStart: m.index, nameEnd: m.index + word.length, end: code.length, kind: 'namespace', children: [] };
    }
  }
  if (open) blocks.push(open);
  const lineEndAt = (offset) => {
    const nl = code.indexOf('\n', offset);
    return nl < 0 ? code.length : nl;
  };
  const typeAfter = (offset, name) => {
    const rest = code.slice(offset + name.length, lineEndAt(offset));
    return /:(?!=)\s*([^;:=]+?)\s*(?::=|;|$)/.exec(rest)?.[1]?.trim() ?? '';
  };
  for (const d of decls) {
    if (d.kind === 'header') continue;
    const symbol = { name: d.name, detail: d.kind === 'enum' ? '' : typeAfter(d.offset, d.name), kind: d.kind === 'enum' ? 'enumMember' : 'variable', start: d.offset, end: d.kind === 'enum' ? d.offset + d.name.length : lineEndAt(d.offset), nameStart: d.offset, nameEnd: d.offset + d.name.length, children: [] };
    const block = blocks.find((b) => b.start <= d.offset && d.offset <= b.end);
    if (block) {
      if (block.name === 'STRUCT') symbol.kind = 'field';
      else if (/CONSTANT/i.test(block.detail)) symbol.kind = 'constant';
      block.children.push(symbol);
    } else out.push(symbol);
  }
  const children = [...blocks.filter((b) => b.children.length || b.name !== 'STRUCT'), ...out].sort((a, b) => a.start - b.start);
  if (!header) return children;
  const word = header[1].toUpperCase();
  // (TYPE: a struct, an enum (its "( … )"), or an alias)
  const isEnum = word === 'TYPE' && /:[ \t\r\n]*\(/.test(code);
  const kind = word === 'TYPE' ? (isEnum ? 'enum' : 'struct') : HEADER_KIND[word] ?? 'class';
  const nameStart = header.index + header[0].indexOf(header[2], header[1].length);
  // (an enum's members straight under it, not in a block)
  const kids = isEnum ? children.map((c) => (c.kind === 'namespace' ? c.children : [c])).flat() : children;
  const detail = word === 'TYPE' ? (isEnum ? 'ENUM' : 'STRUCT') : `${word}${header[3].trim() ? ` ${header[3].trim().replace(/\s+/g, ' ')}` : ''}`.slice(0, 120);
  return [{ name: header[2], detail, kind, start: header.index, end: code.length, nameStart, nameEnd: nameStart + header[2].length, children: kids }];
}

/** The outline of an implementation section: its CASE branches (the states), each from its label to the next */
function implementationOutline(text) {
  const code = blankCode(text);
  const out = [];
  const lines = code.split('\n');
  const starts = [];
  let o = 0;
  for (const l of lines) {
    starts.push(o);
    o += l.length + 1;
  }
  // (a CASE's labels: "E_State.Idle:", "Idle, Busy:", "10:", "1..5:"; not ":=")
  const label = /^[ \t]*((?:[A-Za-z_][\w.]*|\d+(?:\.\.\d+)?)(?:[ \t]*,[ \t]*(?:[A-Za-z_][\w.]*|\d+(?:\.\.\d+)?))*)[ \t]*:(?!=)/;
  let depth = 0;
  const open = [];
  lines.forEach((l, i) => {
    if (/\bCASE\b[\s\S]*\bOF\b/i.test(l)) {
      depth++;
      return;
    }
    if (/\bEND_CASE\b/i.test(l)) {
      while (open.length && open[open.length - 1].depth === depth) open.pop().end = starts[i];
      depth = Math.max(0, depth - 1);
      return;
    }
    if (depth === 0) return;
    const m = label.exec(l);
    if (!m || /^\s*(ELSE|ELSIF|THEN)\b/i.test(l)) return;
    while (open.length && open[open.length - 1].depth === depth) open.pop().end = starts[i];
    const names = m[1].split(',').map((n) => n.trim());
    const nameStart = starts[i] + l.indexOf(m[1]);
    const symbol = { name: names.map((n) => n.split('.').pop()).join(', '), detail: names.length === 1 && names[0].includes('.') ? names[0].split('.').slice(0, -1).join('.') : '', kind: 'enumMember', start: starts[i], end: code.length, nameStart, nameEnd: nameStart + m[1].length, children: [], depth };
    // (a nested CASE's branches under the branch it is in)
    const parent = open.filter((x) => x.depth < depth).pop();
    (parent ? parent.children : out).push(symbol);
    open.push(symbol);
  });
  const clean = (list) => list.map(({ depth: _d, ...s }) => ({ ...s, children: clean(s.children) })); // eslint-disable-line no-unused-vars
  return clean(out);
}

module.exports = { declarationOutline, implementationOutline };
