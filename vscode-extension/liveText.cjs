// Live values in the Structured Text sections, as XAE shows them logged in (no vscode here: tested on its own): the
// names in a section's code that may be variables (State, fbAxis.bDone, aSides[2] left out), and a value as text
'use strict';
const { blankCode, KEYWORDS } = require('./stReferences.cjs');

// (a name or a chain of them: fbAxis.status.bDone; not after a dot or a #, not a typed literal: T#5s, INT#3)
const CHAIN_RX = /(?<![\w#.])[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?![\w#])/g;
const NOT_VARIABLE = new Set([...KEYWORDS, 'THEN', 'ELSE', 'OF', 'DO', 'TO', 'BY', 'NULL', 'SIZEOF', 'ADR', 'REF', 'TRUE', 'FALSE']);

/**
 * The names in a section's text that may be variables, with where each use is: [{ path, uses: [{ start, end }] }]
 * (offsets in the text; a chain: fbAxis.bDone; a call left out: Execute(), fbTimer( ... ) itself; keywords out)
 */
function watchNames(text, { from = 0, to = Infinity } = {}) {
  const code = blankCode(text);
  const byPath = new Map();
  CHAIN_RX.lastIndex = 0;
  let m;
  while ((m = CHAIN_RX.exec(code))) {
    const start = m.index;
    const end = start + m[0].length;
    if (end < from || start > to) continue;
    const first = m[0].split('.')[0];
    if (NOT_VARIABLE.has(first.toUpperCase())) continue;
    // (a call: Execute(), fbTimer(IN := …): the function block's own value has no text; its outputs are read as chains)
    if (/^\s*\(/.test(code.slice(end, end + 40))) continue;
    // (a CASE label, "Idle:", is a state's name, not a variable; an assignment target "x :=" is one)
    if (/^\s*:(?!=)/.test(code.slice(end, end + 10)) && !/:\s*$/.test(code.slice(Math.max(0, start - 40), start)) && /^[ \t]*$/.test(code.slice(code.lastIndexOf('\n', start - 1) + 1, start))) continue;
    // (a call's named argument, fbTimer(IN := …, Q => …): the callee's parameter, not this POU's variable)
    if (/^\s*(?::=|=>)/.test(code.slice(end, end + 10)) && /[(,]\s*$/.test(code.slice(Math.max(0, start - 200), start))) continue;
    const key = m[0].toLowerCase();
    if (!byPath.has(key)) byPath.set(key, { path: m[0], uses: [] });
    byPath.get(key).uses.push({ start, end });
  }
  return [...byPath.values()];
}

/** A value as XAE shows it: TRUE / FALSE, a number (a REAL with up to six significant digits), 'a string', an enum's name */
function valueText(value, { enumNames = null } = {}) {
  if (value === null || value === undefined) return '???';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (enumNames && enumNames[value] !== undefined) return enumNames[value];
    if (Number.isInteger(value)) return String(value);
    const s = Number(value.toPrecision(6)).toString();
    return s.includes('e') ? value.toExponential(4) : s;
  }
  const s = String(value);
  return `'${s.length > 40 ? `${s.slice(0, 39)}…` : s}'`;
}

module.exports = { watchNames, valueText };
