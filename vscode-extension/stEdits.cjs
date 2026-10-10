// Edits of Structured Text as XAE offers them: Auto Declare (a name used but declared nowhere: its declaration added
// to a VAR block of the method or the POU, its type guessed from how it is used), a declaration removed (a variable
// never used), and Format Document (each line's indentation from the blocks it is in; nothing else changed).
'use strict';
const { blankCode } = require('./stReferences.cjs');

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The type a name's use suggests: an assignment's value (TRUE / FALSE: BOOL, 1.5: LREAL, 10: INT, T#2S: TIME, 'x':
 * STRING, E_State.Idle: E_State), a comparison with one, a condition (IF x THEN: BOOL), a timer's members (x.Q: TON);
 * else BOOL
 */
function guessType(implText, name) {
  const code = blankCode(implText);
  const n = escapeRx(name);
  // (a literal in the text, not blanked: strings are blanked in code, so look at the text at the same place)
  const valueAfter = (rx) => {
    const m = rx.exec(code);
    if (!m) return null;
    const at = m.index + m[0].length;
    return implText.slice(at).match(/^\s*([^;\r\n]*)/)?.[1]?.trim() ?? null;
  };
  const value = valueAfter(new RegExp(`(?<![\\w.])${n}\\s*:=`, 'i')) ?? valueAfter(new RegExp(`(?<![\\w.])${n}\\s*(?:=|<>|<=|>=|<|>)(?!=)`, 'i')) ?? valueAfter(new RegExp(`:=\\s*(?=${n}\\b)`, 'i'));
  const typeOf = (v) => {
    if (!v) return null;
    if (/^(TRUE|FALSE)\b/i.test(v)) return 'BOOL';
    if (/^(?:L?T|L?TIME)#/i.test(v)) return 'TIME';
    if (/^'/.test(v)) return 'STRING';
    if (/^"/.test(v)) return 'WSTRING';
    if (/^-?\d+\.\d*(?:E[+-]?\d+)?\b|^-?\d+E[+-]?\d+\b/i.test(v)) return 'LREAL';
    if (/^-?\d+\b/.test(v)) return 'INT';
    if (/^(?:16|8|2)#/.test(v)) return 'WORD';
    const q = /^([A-Za-z_]\w*)\.[A-Za-z_]\w*\s*$/.exec(v);
    if (q && /^E_|^E[A-Z]/.test(q[1])) return q[1];
    return null;
  };
  const t = typeOf(value);
  if (t) return t;
  if (new RegExp(`(?<![\\w.])${n}\\s*\\.\\s*(?:Q|ET)\\b`, 'i').test(code) || new RegExp(`(?<![\\w.])${n}\\s*\\(\\s*IN\\s*:=`, 'i').test(code)) return 'TON';
  if (new RegExp(`(?<![\\w.])${n}\\s*\\(\\s*CLK\\s*:=`, 'i').test(code)) return 'R_TRIG';
  return 'BOOL';
}

/**
 * A declaration's text with a variable added to a block (VAR, VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, VAR_TEMP): before the
 * first such block's END_VAR (its indentation as the block's lines'), else a new block after the last END_VAR (or at
 * the end). → { text, line } (line: the new declaration's, 0-based)
 */
function addDeclaration(declText, { name, type, block = 'VAR', comment }) {
  const nl = declText.includes('\r\n') ? '\r\n' : '\n';
  const lines = declText.split(/\r?\n/);
  const code = blankCode(declText).split(/\r?\n/);
  const want = block.toUpperCase();
  const decl = `${name} : ${type};${comment ? ` // ${comment}` : ''}`;
  let open = -1;
  for (let i = 0; i < code.length; i++) {
    const t = code[i].trim().toUpperCase();
    // (VAR, not VAR CONSTANT / VAR RETAIN / VAR PERSISTENT: their values are another matter)
    if (open < 0 && new RegExp(`^${want}\\s*$`).test(t)) open = i;
    else if (open >= 0 && /^END_VAR\b/.test(t)) {
      const inner = lines.slice(open + 1, i).find((l) => l.trim());
      const indent = inner ? /^\s*/.exec(inner)[0] : `${/^\s*/.exec(lines[open])[0]}\t`;
      lines.splice(i, 0, `${indent}${decl}`);
      return { text: lines.join(nl), line: i };
    }
  }
  // (no such block: a new one after the last END_VAR, else at the end)
  let last = -1;
  code.forEach((l, i) => {
    if (/^\s*END_VAR\b/i.test(l)) last = i;
  });
  const indent = last >= 0 ? /^\s*/.exec(lines[last])[0] : '';
  const at = last >= 0 ? last + 1 : lines.length - (lines[lines.length - 1].trim() ? 0 : 1);
  lines.splice(at, 0, `${indent}${want}`, `${indent}\t${decl}`, `${indent}END_VAR`);
  return { text: lines.join(nl), line: at + 1 };
}

/**
 * A declaration's text without a variable: its line removed when it declares only that one (with its comment),
 * else the name taken out of "a, b : INT;". null when it is not declared there
 */
function removeDeclaration(declText, name) {
  const nl = declText.includes('\r\n') ? '\r\n' : '\n';
  const lines = declText.split(/\r?\n/);
  const code = blankCode(declText).split(/\r?\n/);
  const n = escapeRx(name);
  for (let i = 0; i < code.length; i++) {
    const m = new RegExp(`^(\\s*)((?:[A-Za-z_]\\w*\\s*,\\s*)*)(${n})((?:\\s*,\\s*[A-Za-z_]\\w*)*)(\\s*(?:AT\\s+%\\S+\\s*)?:(?!=))`, 'i').exec(code[i]);
    if (!m) continue;
    if (!m[2] && !m[4]) {
      lines.splice(i, 1);
      return lines.join(nl);
    }
    // (one of several: "a, b : INT;" → "a : INT;")
    const names = `${m[2]}${m[3]}${m[4]}`.split(',').map((x) => x.trim()).filter((x) => x.toLowerCase() !== name.toLowerCase());
    lines[i] = lines[i].slice(0, m[1].length) + names.join(', ') + lines[i].slice(m[1].length + m[2].length + m[3].length + m[4].length);
    return lines.join(nl);
  }
  return null;
}

const LABEL_RX = /^(?:[A-Za-z_][\w.]*|-?\d+(?:\.\.-?\d+)?)(?:\s*,\s*(?:[A-Za-z_][\w.]*|-?\d+(?:\.\.-?\d+)?))*\s*:(?!=)/;

/**
 * A section formatted: each line's indentation (tabs, or `indent`) from the blocks it is in: IF … END_IF, CASE …
 * END_CASE (its labels one in, their statements two), FOR / WHILE / REPEAT, VAR blocks, STRUCT / UNION, an enum's
 * ( … ); ELSIF / ELSE / UNTIL at their block's level. Only the leading white space changes: lines in a comment over
 * several lines are kept, and a statement's continuation lines (a call's arguments over several lines) move with its
 * first line, their own alignment kept. → the new text
 */
function formatSection(text, { indent = '\t' } = {}) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const code = blankCode(text).split(/\r?\n/);
  const out = [];
  const stack = [];
  let commentDepth = 0;
  // (the section's own base: its first code line's indentation, e.g. a method's whole body one tab in)
  const firstCode = code.findIndex((l) => l.trim());
  const base = firstCode >= 0 ? /^\s*/.exec(lines[firstCode])[0] : '';
  // (a statement over several lines: its first line's old and new indentation, its first word)
  let stmt = null;
  const opensBlock = (U, first) => {
    if (first === 'IF' && /\bTHEN$/.test(U)) return 'if';
    if (first === 'CASE' && /\bOF$/.test(U)) return 'case';
    if (first === 'FOR' && /\bDO$/.test(U)) return 'for';
    if (first === 'WHILE' && /\bDO$/.test(U)) return 'while';
    return null;
  };
  // (a statement goes on after a line not ending one: no ";", THEN, DO, OF, a label's ":", a block word)
  const ends = (U) => !U || /;$/.test(U) || /\b(THEN|DO|OF|ELSE|REPEAT)$/.test(U) || /^END_\w+/.test(U) || /^(VAR\w*|STRUCT|UNION)\b/.test(U) || /^(FUNCTION_BLOCK|FUNCTION|PROGRAM|METHOD|PROPERTY|INTERFACE|TYPE|ACTION)\b/.test(U) || /:$/.test(U) || /^\)/.test(U);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const opens = (raw.match(/\(\*/g) ?? []).length;
    const closes = (raw.match(/\*\)/g) ?? []).length;
    if (commentDepth > 0) {
      out.push(raw);
      commentDepth = Math.max(0, commentDepth + opens - closes);
      continue;
    }
    const U = code[i].trim().toUpperCase();
    if (!raw.trim()) {
      out.push('');
      continue;
    }
    // (a line that is only a comment, // or (* *) on one line: as it is; commented-out code often sits at column 0)
    if (!U && opens <= closes) {
      out.push(raw);
      continue;
    }
    const oldIndent = /^\s*/.exec(raw)[0];
    // A continuation line: moved with its statement's first line
    if (stmt && !stmt.ended) {
      const moved = raw.startsWith(stmt.oldIndent) ? stmt.newIndent + raw.slice(stmt.oldIndent.length) : raw;
      out.push(moved);
      commentDepth = Math.max(0, opens - closes);
      // (its end: the block it opens, IF a AND b THEN)
      // (a comment line in it does not end it)
      if (U && ends(U)) {
        stmt.ended = true;
        const b = opensBlock(U, stmt.first);
        if (b) stack.push(b);
      }
      continue;
    }
    const top = stack[stack.length - 1];
    let level;
    if (/^END_(IF|CASE|FOR|WHILE|REPEAT|VAR|STRUCT|UNION)\b/.test(U)) {
      const kind = /^END_(\w+)/.exec(U)[1].toLowerCase();
      const at = stack.lastIndexOf(kind);
      if (at >= 0) stack.splice(at);
      level = stack.length;
    } else if (/^\)/.test(U) && stack.includes('paren')) {
      stack.splice(stack.lastIndexOf('paren'));
      level = stack.length;
    } else if (/^UNTIL\b/.test(U) && stack.includes('repeat')) {
      stack.splice(stack.lastIndexOf('repeat'));
      level = stack.length;
    } else if ((top === 'case' || top === 'label') && /^ELSE\b/.test(U)) {
      // A CASE's ELSE: at the CASE's level (as XAE's code has it), its statements one in
      if (top === 'label') stack.pop();
      level = stack.length - 1;
    } else if ((top === 'case' || top === 'label') && LABEL_RX.test(U)) {
      // A CASE label: one in from the CASE, its statements two
      if (top === 'label') stack.pop();
      level = stack.length;
      stack.push('label');
    } else if (/^(ELSIF|ELSE)\b/.test(U) && top === 'if') {
      level = stack.length - 1;
    } else level = stack.length;
    const newIndent = base + indent.repeat(Math.max(0, level));
    out.push(newIndent + raw.trimStart());
    commentDepth = Math.max(0, opens - closes);
    // The blocks it opens; a statement it begins and does not end
    const first = /^[A-Z_]+/.exec(U)?.[0] ?? '';
    const label = top !== stack[stack.length - 1] || /^(ELSE|ELSIF)\b/.test(U);
    const body = /^(?:[A-Za-z_][\w.]*|-?\d+(?:\.\.-?\d+)?)(?:\s*,\s*(?:[A-Za-z_][\w.]*|-?\d+(?:\.\.-?\d+)?))*\s*:(?!=)\s*(.*)$/.exec(U);
    const rest = stack[stack.length - 1] === 'label' && body && !/^(ELSE)\b/.test(U) ? body[1] : U;
    const b = opensBlock(rest, /^[A-Z_]+/.exec(rest)?.[0] ?? first);
    if (b) stack.push(b);
    else if (/^REPEAT$/.test(U)) stack.push('repeat');
    else if (/^VAR\w*(?:\s+(?:CONSTANT|RETAIN|PERSISTENT|NON_RETAIN))*$/.test(U)) stack.push('var');
    else if (/(?:^|:)\s*STRUCT$/.test(U)) stack.push('struct');
    else if (/(?:^|:)\s*UNION$/.test(U)) stack.push('union');
    else if (/(?:^|:)\s*\($/.test(U)) stack.push('paren');
    stmt = null;
    if (!b && !label && rest && !ends(rest) && stack[stack.length - 1] !== 'paren') stmt = { oldIndent, newIndent, first: /^[A-Z_]+/.exec(rest)?.[0] ?? '', ended: false };
  }
  return out.join(nl);
}

module.exports = { guessType, addDeclaration, removeDeclaration, formatSection };
