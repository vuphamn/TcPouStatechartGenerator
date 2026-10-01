/**
 * A line diff (the longest common subsequence, after the lines the same at the start and the end): what an editor's
 * edits change, or a file since it was saved. Rows: the same line, a line taken out (del) or put in (add), with their
 * line numbers before / after. Hunks: the changed rows with a few lines around them
 */
export interface DiffRow {
  type: 'same' | 'del' | 'add';
  text: string;
  /** 1-based, before (same / del) and after (same / add) */
  before?: number;
  after?: number;
}

const MAX_CELLS = 4_000_000;

export function diffLines(beforeText: string, afterText: string): DiffRow[] {
  const a = beforeText.replace(/\r\n/g, '\n').split('\n');
  const b = afterText.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const rows: DiffRow[] = [];
  for (let i = 0; i < start; i++) rows.push({ type: 'same', text: a[i], before: i + 1, after: i + 1 });
  const ma = a.slice(start, endA);
  const mb = b.slice(start, endB);
  const n = ma.length;
  const m = mb.length;
  if (n * m > MAX_CELLS) {
    // (too large to compare line by line: the middle taken out and put in as a whole)
    ma.forEach((t, i) => rows.push({ type: 'del', text: t, before: start + i + 1 }));
    mb.forEach((t, j) => rows.push({ type: 'add', text: t, after: start + j + 1 }));
  } else {
    // (lcs[i][j]: the common lines of ma[i..] and mb[j..])
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i * w + j] = ma[i] === mb[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && ma[i] === mb[j]) {
        rows.push({ type: 'same', text: ma[i], before: start + i + 1, after: start + j + 1 });
        i++;
        j++;
      } else if (j < m && (i >= n || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) {
        rows.push({ type: 'add', text: mb[j], after: start + j + 1 });
        j++;
      } else {
        rows.push({ type: 'del', text: ma[i], before: start + i + 1 });
        i++;
      }
    }
  }
  for (let k = 0; k < a.length - endA; k++) rows.push({ type: 'same', text: a[endA + k], before: endA + k + 1, after: endB + k + 1 });
  return rows;
}

/** The changed rows with `context` lines around them; null in between: lines left out */
export function diffHunks(rows: DiffRow[], context = 3): (DiffRow | null)[] {
  return diffHunkIndices(rows, context).map((i) => (i === null ? null : rows[i]));
}

/** As diffHunks, the rows' indices */
export function diffHunkIndices(rows: DiffRow[], context = 3): (number | null)[] {
  const keep = new Set<number>();
  rows.forEach((r, i) => {
    if (r.type === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep.add(k);
  });
  const out: (number | null)[] = [];
  let last = -1;
  rows.forEach((_r, i) => {
    if (!keep.has(i)) return;
    if (last >= 0 && i > last + 1) out.push(null);
    else if (last < 0 && i > 0) out.push(null);
    out.push(i);
    last = i;
  });
  if (last >= 0 && last < rows.length - 1) out.push(null);
  return out;
}

/** How many lines put in and taken out */
export const diffCounts = (rows: DiffRow[]) => ({ added: rows.filter((r) => r.type === 'add').length, removed: rows.filter((r) => r.type === 'del').length });

/** A change: rows start..end (inclusive) taken out and / or put in, with the same lines around it */
export interface DiffChange {
  start: number;
  end: number;
}

/** The changes of a diff, in order: each run of rows taken out or put in */
export function diffChanges(rows: DiffRow[]): DiffChange[] {
  const out: DiffChange[] = [];
  rows.forEach((r, i) => {
    if (r.type === 'same') return;
    const last = out[out.length - 1];
    if (last && last.end === i - 1) last.end = i;
    else out.push({ start: i, end: i });
  });
  return out;
}

/**
 * The text after, one change undone (its lines taken out put back, those put in taken out); eol: the after text's
 * line ends (\r\n kept)
 */
export function undoChange(rows: DiffRow[], change: DiffChange, eol = '\n'): string {
  const lines: string[] = [];
  rows.forEach((r, i) => {
    const inIt = i >= change.start && i <= change.end;
    if (r.type === 'same' || (r.type === 'add' && !inIt) || (r.type === 'del' && inIt)) lines.push(r.text);
  });
  return lines.join(eol);
}

/** A part of a changed line: the same on both sides, or changed (taken out on the left, put in on the right) */
export interface InlineSeg {
  text: string;
  changed: boolean;
}

/**
 * What changed within a line (one taken out beside the one put in, Split view): by words, spaces and punctuation
 * (their longest common run kept); a long line by its common start and end only
 */
export function inlineDiff(before: string, after: string): { left: InlineSeg[]; right: InlineSeg[] } {
  const tok = (s: string) => s.match(/\w+|\s+|[^\w\s]/g) ?? [];
  const a = tok(before);
  const b = tok(after);
  const merge = (parts: InlineSeg[]) =>
    parts.reduce<InlineSeg[]>((out, p) => {
      if (!p.text) return out;
      const last = out[out.length - 1];
      if (last && last.changed === p.changed) last.text += p.text;
      else out.push({ ...p });
      return out;
    }, []);
  if (a.length * b.length > 40000) {
    let s = 0;
    while (s < before.length && s < after.length && before[s] === after[s]) s++;
    let e = 0;
    while (e < before.length - s && e < after.length - s && before[before.length - 1 - e] === after[after.length - 1 - e]) e++;
    const side = (t: string) => merge([{ text: t.slice(0, s), changed: false }, { text: t.slice(s, t.length - e), changed: true }, { text: t.slice(t.length - e), changed: false }]);
    return { left: side(before), right: side(after) };
  }
  // (the longest common subsequence of the tokens)
  const n = a.length;
  const m = b.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const left: InlineSeg[] = [];
  const right: InlineSeg[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      left.push({ text: a[i++], changed: false });
      right.push({ text: b[j++], changed: false });
    } else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) right.push({ text: b[j++], changed: true });
    else left.push({ text: a[i++], changed: true });
  }
  // (a common run of only spaces between two changes: part of the change)
  const tidy = (segs: InlineSeg[]) => merge(segs).map((s, k, all) => (!s.changed && /^\s+$/.test(s.text) && all[k - 1]?.changed && all[k + 1]?.changed ? { ...s, changed: true } : s));
  return { left: merge(tidy(left)), right: merge(tidy(right)) };
}
