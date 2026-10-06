/**
 * Structured Text read a statement at a time, for the state machines' parsers: a line holding several statements
 * ("1: IF a THEN x := B; END_IF") split into them, and a nested CASE's arms as conditions ("iStep = 1"), so that a
 * transition under a nested CASE's label is guarded by it as by an IF
 */

/** A CASE label line: its labels (names, numbers, ranges, several separated by commas), and the code after it */
const LABEL_RX = /^((?:[A-Za-z_][\w.]*|-?\d+(?:\s*\.\.\s*-?\d+)?)(?:\s*,\s*(?:[A-Za-z_][\w.]*|-?\d+(?:\s*\.\.\s*-?\d+)?))*)\s*:(?!=)\s*(\S.*)?$/;
const NOT_LABELS = /^(IF|ELSIF|ELSE|CASE|FOR|WHILE|REPEAT|RETURN|THEN|DO|OF|END_\w+)$/i;

/**
 * One statement (or IF / CASE line) per line: after THEN, OF and ";", before ELSIF, ELSE, END_IF and END_CASE; a
 * label and the code after it on lines of their own. Comments must be gone already
 */
export function splitStatements(line: string): string[] {
  const parts = line
    .replace(/\bTHEN\b/gi, 'THEN\n')
    .replace(/\bOF\b/gi, 'OF\n')
    .replace(/;/g, ';\n')
    .replace(/\b(ELSIF|ELSE|END_IF|END_CASE)\b/gi, '\n$1')
    .replace(/\b(END_IF|END_CASE)\b\s*;?/gi, (m) => `${m}\n`)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    // ("ELSE x := 1;": ELSE, then its code)
    const el = p.match(/^ELSE\b\s*(\S.*)$/i);
    if (el) {
      out.push('ELSE', el[1]);
      continue;
    }
    const m = p.match(LABEL_RX);
    if (m && !NOT_LABELS.test(m[1].trim())) {
      out.push(`${m[1].trim()}:`);
      if (m[2]) out.push(m[2]);
    } else out.push(p);
  }
  return out;
}

/** A CASE label alone on its line (after splitStatements): its labels, else null */
export function caseLabelOf(line: string): string | null {
  const m = line.match(/^(.*\S)\s*:$/);
  if (!m || !LABEL_RX.test(line) || NOT_LABELS.test(m[1].trim())) return null;
  return m[1].trim();
}

/** The selector of a "CASE <selector> OF" line, else null */
export function caseSelectorOf(line: string): string | null {
  const m = line.match(/^CASE\s+(.+?)\s+OF\b/i);
  return m ? m[1].trim().replace(/^\((.*)\)$/, '$1').trim() : null;
}

/** A nested CASE's arm as a condition: "iStep = 1", "(iStep >= 3 AND iStep <= 5)", several joined by OR */
export function caseArmCondition(selector: string, labels: string): string {
  const parts = labels.split(',').map((l) => {
    const r = l.trim().match(/^(-?\d+)\s*\.\.\s*(-?\d+)$/);
    return r ? `(${selector} >= ${r[1]} AND ${selector} <= ${r[2]})` : `${selector} = ${l.trim()}`;
  });
  return parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0];
}
