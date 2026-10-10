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

// (ADS data type ids, as tcAds reads them)
const ADST = { INT16: 2, INT32: 3, REAL32: 4, REAL64: 5, INT8: 16, UINT8: 17, UINT16: 18, UINT32: 19, INT64: 20, UINT64: 21, STRING: 30, WSTRING: 31, BIT: 33 };
const RANGES = { [ADST.INT8]: [-128, 127], [ADST.UINT8]: [0, 255], [ADST.INT16]: [-32768, 32767], [ADST.UINT16]: [0, 65535], [ADST.INT32]: [-2147483648, 2147483647], [ADST.UINT32]: [0, 4294967295], [ADST.INT64]: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], [ADST.UINT64]: [0, Number.MAX_SAFE_INTEGER] };

/**
 * A value typed for a variable, as its type takes it: { value } or { error }. info: { dataType, size }; enumNames: an
 * enum's members (value -> name): a member's name (or its number). BOOL: TRUE / FALSE (1 / 0); numbers as written
 * (16#FF too); text with or without its quotes
 */
function parseValue(text, info, enumNames = null) {
  const t = String(text ?? '').trim();
  if (!t) return { error: 'Type a value' };
  if (enumNames) {
    const hit = Object.entries(enumNames).find(([, n]) => n.toLowerCase() === t.split('.').pop().toLowerCase());
    if (hit) return { value: Number(hit[0]) };
    if (/^-?\d+$/.test(t) && enumNames[Number(t)] !== undefined) return { value: Number(t) };
    return { error: `Not one of its members: ${Object.values(enumNames).slice(0, 8).join(', ')}${Object.keys(enumNames).length > 8 ? ', …' : ''}` };
  }
  if (info.dataType === ADST.BIT) {
    if (/^(TRUE|1)$/i.test(t)) return { value: true };
    if (/^(FALSE|0)$/i.test(t)) return { value: false };
    return { error: 'TRUE or FALSE' };
  }
  if (RANGES[info.dataType]) {
    const m = /^(-)?(?:16#([0-9A-F_]+)|2#([01_]+)|8#([0-7_]+)|(\d[\d_]*))$/i.exec(t);
    if (!m) return { error: 'A whole number' };
    const digits = (m[2] ?? m[3] ?? m[4] ?? m[5]).replace(/_/g, '');
    const n = (m[1] ? -1 : 1) * parseInt(digits, m[2] ? 16 : m[3] ? 2 : m[4] ? 8 : 10);
    const [min, max] = RANGES[info.dataType];
    if (!Number.isSafeInteger(n) || n < min || n > max) return { error: `From ${min} to ${max}` };
    return { value: n };
  }
  if (info.dataType === ADST.REAL32 || info.dataType === ADST.REAL64) {
    const n = Number(t.replace(/_/g, ''));
    if (!Number.isFinite(n)) return { error: 'A number (1.5, -2, 1E3)' };
    return { value: n };
  }
  if (info.dataType === ADST.STRING || info.dataType === ADST.WSTRING) {
    const v = /^'.*'$/s.test(t) || /^".*"$/s.test(t) ? t.slice(1, -1) : t;
    const max = info.dataType === ADST.STRING ? info.size - 1 : info.size / 2 - 1;
    if (v.length > max) return { error: `At most ${max} characters` };
    return { value: v };
  }
  return { error: 'This type is not written here (only BOOL, numbers, enums and strings)' };
}

module.exports = { watchNames, valueText, parseValue, ADST };
