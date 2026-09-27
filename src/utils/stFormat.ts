/**
 * Format Document for Structured Text: every line re-indented with tabs by its blocks (IF / ELSIF / ELSE, CASE and
 * its labels, FOR, WHILE, REPEAT, VAR ... END_VAR, STRUCT, METHOD / FUNCTION_BLOCK headers), a condition going on
 * over several lines one level further. The code itself is not changed: only the leading whitespace (blank lines
 * are emptied, a block comment's inner lines are kept as they are).
 */

const LABEL = /^(?:[A-Za-z_][\w.]*|-?\d+)(?:\s*(?:,|\.\.)\s*(?:[A-Za-z_][\w.]*|-?\d+))*\s*:(?!=)/;

/** A line's code without strings and comments (to read its keywords) */
function codeOf(line: string, inBlockComment: { on: boolean }): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (inBlockComment.on) {
      const end = line.indexOf('*)', i);
      if (end < 0) return out;
      inBlockComment.on = false;
      i = end + 2;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === '//') break;
    if (two === '(*') {
      inBlockComment.on = true;
      i += 2;
      continue;
    }
    const c = line[i];
    if (c === "'" || c === '"') {
      const end = line.indexOf(c, i + 1);
      i = end < 0 ? line.length : end + 1;
      out += ' ';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function formatST(code: string): string {
  const eol = code.includes('\r\n') ? '\r\n' : '\n';
  const lines = code.split(/\r?\n/);
  // The open blocks: 'block' (IF, FOR, ... VAR), 'case' (CASE ... OF: its labels one level in), 'label' (a label's code)
  const stack: ('block' | 'case' | 'label')[] = [];
  let continuation = false; // an IF / ELSIF / WHILE / FOR condition not yet closed by THEN / DO
  const bc = { on: false };
  const out: string[] = [];
  for (const raw of lines) {
    const wasInComment = bc.on;
    const text = raw.trim();
    const code = codeOf(raw, bc).trim();
    const upper = code.toUpperCase();
    if (!text) {
      out.push('');
      continue;
    }
    // Inside a block comment that started on an earlier line: as it is
    if (wasInComment) {
      out.push(raw.replace(/\s+$/, ''));
      continue;
    }
    let level = stack.length;
    // Closing / middle keywords go one level out
    const closes = /^(END_IF|END_CASE|END_FOR|END_WHILE|END_REPEAT|END_VAR|END_STRUCT|END_UNION|END_TYPE|UNTIL)\b/.test(upper);
    const middle = /^(ELSIF|ELSE)\b/.test(upper);
    if (closes) {
      if (/^END_CASE\b/.test(upper)) {
        if (stack[stack.length - 1] === 'label') stack.pop();
        if (stack[stack.length - 1] === 'case') stack.pop();
      } else if (/^UNTIL\b/.test(upper)) {
        // (UNTIL ends the REPEAT's body; END_REPEAT follows)
        if (stack.length) stack.pop();
      } else if (!/^END_REPEAT\b/.test(upper) || stack.length) {
        if (!/^END_REPEAT\b/.test(upper)) stack.pop();
      }
      level = stack.length;
    } else if (middle) {
      // ELSE of a CASE: like a label
      if (stack[stack.length - 1] === 'label') {
        stack.pop();
        level = stack.length;
        out.push('\t'.repeat(level) + text);
        stack.push('label');
        continue;
      }
      level = Math.max(0, stack.length - 1);
    } else if (stack[stack.length - 1] === 'label' || stack[stack.length - 1] === 'case') {
      // A CASE label: one level in from its CASE
      if (LABEL.test(code) && !/^(IF|FOR|WHILE|REPEAT|CASE|RETURN|EXIT)\b/.test(upper)) {
        if (stack[stack.length - 1] === 'label') stack.pop();
        level = stack.length;
        out.push('\t'.repeat(level) + text);
        stack.push('label');
        continue;
      }
    }
    out.push('\t'.repeat(level + (continuation && !closes && !middle ? 1 : 0)) + text);

    // What this line opens
    if (continuation) {
      if (/\b(THEN|DO)\b/.test(upper)) {
        continuation = false;
        stack.push('block');
      }
      continue;
    }
    if (middle) {
      // ELSIF c THEN / ELSE: the body goes one level in again (the block stays open)
      if (/^ELSIF\b/.test(upper) && !/\bTHEN\b/.test(upper)) continuation = true;
      continue;
    }
    const opensIf = /^(IF|ELSIF)\b/.test(upper) || /^(FOR|WHILE)\b/.test(upper);
    const oneLine = /\bEND_(IF|FOR|WHILE)\b/.test(upper);
    if (opensIf && !oneLine) {
      if (/\b(THEN|DO)\b/.test(upper)) stack.push('block');
      else continuation = true;
    } else if (/^CASE\b/.test(upper) && /\bOF\b/.test(upper) && !/\bEND_CASE\b/.test(upper)) stack.push('case');
    else if (/^REPEAT\b/.test(upper)) stack.push('block');
    else if (/^(VAR(_INPUT|_OUTPUT|_IN_OUT|_TEMP|_STAT|_INST|_GLOBAL|_CONFIG)?|STRUCT|UNION)\b/.test(upper) && !/\bEND_(VAR|STRUCT|UNION)\b/.test(upper)) stack.push('block');
  }
  return out.join(eol);
}
