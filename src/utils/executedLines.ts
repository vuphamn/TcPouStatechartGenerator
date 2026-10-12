/**
 * The code that ran (live coverage in the code editors): from the transitions the PLC took (the coverage: from, to,
 * how often), the lines of the state method that ran: each taken transition's assignment (state := TARGET, inside its
 * source state's CASE branch) and the CASE label of each state left that way. By the code's text, as the chart reads it.
 */
export interface ExecutedLine {
  /** How often (the transitions' counts added) */
  n: number;
  kind: 'state' | 'transition';
  title: string;
}

const tail = (s: string) => s.split('.').pop()!.toLowerCase();

/** The state method's CASE branches: each label's states and its lines (1-based, label to the line before the next) */
function branches(code: string, stateVar: string): { states: string[]; from: number; to: number }[] {
  const lines = code.split(/\r?\n/);
  const out: { states: string[]; from: number; to: number }[] = [];
  const caseRx = new RegExp(`^\\s*CASE\\s+\\(?\\s*(?:THIS\\^\\.)?${stateVar.replace(/[^\w]/g, '')}\\s*\\)?\\s+OF\\b`, 'i');
  let inCase = false;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\/\/.*$/, '').replace(/\(\*.*?\*\)/g, '');
    if (!inCase) {
      if (caseRx.test(l)) {
        inCase = true;
        depth = 0;
      }
      continue;
    }
    if (/^\s*CASE\b/i.test(l)) depth++;
    if (/^\s*END_CASE\b/i.test(l)) {
      if (depth === 0) {
        if (out.length) out[out.length - 1].to = i;
        inCase = false;
        continue;
      }
      depth--;
    }
    // (a label of this CASE: names and a colon, not :=)
    const m = depth === 0 ? /^\s*([\w.]+(?:\s*,\s*[\w.]+)*)\s*:(?!=)/.exec(l) : null;
    if (m && !/^\s*(IF|ELSIF|ELSE|FOR|WHILE|REPEAT|RETURN|EXIT)\b/i.test(l)) {
      if (out.length) out[out.length - 1].to = i;
      out.push({ states: m[1].split(',').map((x) => tail(x.trim())), from: i + 1, to: lines.length });
    }
  }
  return out;
}

/** The lines that ran → line (1-based) → what ran there */
export function executedLines(code: string, stateVar: string, taken: { from: string; to: string; n: number }[]): Map<number, ExecutedLine> {
  const out = new Map<number, ExecutedLine>();
  const lines = code.split(/\r?\n/);
  const bs = branches(code, stateVar);
  const sv = stateVar.replace(/[^\w]/g, '');
  for (const t of taken) {
    if (!t.n) continue;
    const b = bs.find((x) => x.states.includes(tail(t.from)));
    if (!b) continue;
    const label = out.get(b.from);
    out.set(b.from, { n: (label?.n ?? 0) + t.n, kind: 'state', title: `${t.from}: left ${(label?.n ?? 0) + t.n}× (live coverage)` });
    // (its assignment: state := TARGET in the branch)
    const rx = new RegExp(`(?:THIS\\^\\.)?\\b${sv}\\s*:=\\s*(?:[\\w]+\\.)?${tail(t.to)}\\b`, 'i');
    for (let i = b.from; i < Math.min(b.to, lines.length); i++) {
      if (!rx.test(lines[i].replace(/\/\/.*$/, ''))) continue;
      const line = i + 1;
      const was = out.get(line);
      out.set(line, { n: (was?.n ?? 0) + t.n, kind: 'transition', title: `${t.from} → ${t.to}: taken ${(was?.n ?? 0) + t.n}× (live coverage)` });
    }
  }
  return out;
}
