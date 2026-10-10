// A TwinCAT source file (.TcPOU, .TcDUT, .TcGVL, .TcIO) as its Structured Text sections, as XAE shows them: the
// object's declaration and implementation, each method's, property's (and its Get / Set), action's and transition's.
// Each section is the text of one CDATA block; a section written back replaces only that block's text: the XML around
// it, the objects' Ids (GUIDs), the line ids and the file's byte order mark and line breaks stay as they are.
'use strict';

/** The kinds of objects that hold sections, and the tags read */
const OWNER = new Set(['POU', 'DUT', 'GVL', 'Itf', 'Method', 'Property', 'Get', 'Set', 'Action', 'Transition']);
const TAG = /<(\/?)(POU|DUT|GVL|Itf|Method|Property|Get|Set|Action|Transition|Declaration|Implementation|ST|SFC|CFC|FBD|LD|IL|NWL|XmlArchive)\b([^>]*?)(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>/g;
const nameOf = (attrs) => /\bName="([^"]*)"/.exec(attrs)?.[1] ?? '';

/**
 * The sections of the file: { kind: 'POU' | 'DUT' | 'GVL' | 'Itf', name, members: [{ key, kind, name, label, decl?,
 * impl?, implLanguage? }] } where decl / impl are { start, end, text } (the CDATA text's offsets in the file).
 * key: '' for the object itself, 'Method:doState', 'Property:Speed', 'Property:Speed.Get', 'Action:Reset',
 * 'Transition:T1'. implLanguage: 'ST', or the graphical language of an implementation not shown as text (SFC, CFC, …)
 */
function parseSource(xml) {
  const stack = [];
  const members = [];
  let root = null;
  const memberOf = (frame) => frame.member;
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(xml))) {
    if (m[5] !== undefined) {
      // A CDATA block: a declaration's or an ST implementation's text, of the innermost object
      const top = stack[stack.length - 1];
      const owner = [...stack].reverse().find((f) => OWNER.has(f.tag));
      if (!top || !owner) continue;
      const start = m.index + '<![CDATA['.length;
      const part = { start, end: start + m[5].length, text: m[5] };
      if (top.tag === 'Declaration' && !memberOf(owner).decl) memberOf(owner).decl = part;
      else if (top.tag === 'ST' && stack[stack.length - 2]?.tag === 'Implementation' && !memberOf(owner).impl) memberOf(owner).impl = part;
      continue;
    }
    const [, closing, tag, attrs, selfClosing] = m;
    if (closing) {
      // (the innermost open one of that tag)
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (OWNER.has(tag)) {
      const name = nameOf(attrs);
      const parent = [...stack].reverse().find((f) => OWNER.has(f.tag));
      let member;
      if (!root && ['POU', 'DUT', 'GVL', 'Itf'].includes(tag)) {
        root = { kind: tag, name };
        member = { key: '', kind: tag, name, label: name };
      } else if (tag === 'Get' || tag === 'Set') {
        const prop = parent?.member;
        const base = prop ? prop.key : '';
        member = { key: `${base}.${tag}`, kind: tag, name: tag, label: `${prop?.label ?? ''}.${tag}`, parent: base };
      } else {
        member = { key: `${tag}:${name}`, kind: tag, name, label: `${root?.name ?? ''}.${name}` };
      }
      if (!selfClosing) stack.push({ tag, member });
      members.push(member);
      continue;
    }
    if (tag === 'Implementation' || tag === 'Declaration' || tag === 'ST') {
      if (!selfClosing) stack.push({ tag });
      continue;
    }
    // (a graphical implementation: SFC, CFC, …: no text to show)
    if (stack[stack.length - 1]?.tag === 'Implementation') {
      const owner = [...stack].reverse().find((f) => OWNER.has(f.tag));
      if (owner && !owner.member.implLanguage) owner.member.implLanguage = tag;
      if (!selfClosing) stack.push({ tag });
    }
  }
  for (const mb of members) if (mb.impl && !mb.implLanguage) mb.implLanguage = 'ST';
  return { kind: root?.kind ?? null, name: root?.name ?? '', members };
}

/** One section's text, or null when the file has no such section */
function readSection(xml, key, section) {
  const mb = parseSource(xml).members.find((x) => x.key === key);
  const part = mb?.[section];
  return part ? part.text : null;
}

/**
 * The file with one section's text replaced (only that CDATA block's text). Throws when the section is not in the file
 * or the text cannot be kept in a CDATA block (it holds "]]>")
 */
function writeSection(xml, key, section, text) {
  if (text.includes(']]>')) throw new Error('The text holds "]]>", which a TwinCAT source file cannot keep: change it first');
  const mb = parseSource(xml).members.find((x) => x.key === key);
  const part = mb?.[section];
  if (!part) throw new Error(`${key || 'The object'} has no ${section === 'decl' ? 'declaration' : 'Structured Text implementation'} in this file`);
  return xml.slice(0, part.start) + text + xml.slice(part.end);
}

/**
 * The section a place in the file is in (line and column 0-based, as in the file): { key, section, line, column }
 * (line and column within the section's text), or null: not in a section's text (the XML around them)
 */
function sectionAt(xml, line, column = 0) {
  let lineStart = 0;
  for (let l = 0; l < line; l++) {
    const nl = xml.indexOf('\n', lineStart);
    if (nl < 0) return null;
    lineStart = nl + 1;
  }
  const nl = xml.indexOf('\n', lineStart);
  const lineEnd = nl < 0 ? xml.length : nl;
  const at = Math.min(lineStart + Math.max(0, column), lineEnd);
  for (const mb of parseSource(xml).members) {
    for (const section of ['decl', 'impl']) {
      const part = mb[section];
      // (the line touches the section's text; its first line shares the line with the tags: <ST><![CDATA[IF …)
      if (!part || part.start > lineEnd || part.end < lineStart) continue;
      const pos = Math.min(Math.max(at, part.start), part.end);
      const lines = xml.slice(part.start, pos).split('\n');
      return { key: mb.key, section, line: lines.length - 1, column: lines[lines.length - 1].replace(/\r$/, '').length };
    }
  }
  return null;
}

/** What a member is called in lists ("doState()", "Speed (Get)") */
function memberTitle(mb) {
  if (mb.key === '') return mb.name;
  if (mb.kind === 'Method') return `${mb.name}()`;
  if (mb.kind === 'Get' || mb.kind === 'Set') return `${mb.label.replace(/\.(Get|Set)$/, '')} (${mb.kind})`;
  return mb.name;
}

module.exports = { parseSource, readSection, writeSection, sectionAt, memberTitle };
