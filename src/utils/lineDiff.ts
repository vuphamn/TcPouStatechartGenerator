/**
 * The lines that change between two texts (a longest common subsequence of lines): "- " a line taken out, "+ " a
 * line put in, "…" between changes far apart. For previews (Edit the state's code): small texts only.
 */
export function lineDiff(before: string[], after: string[], context = 1): { rows: string[]; added: number; removed: number } {
  const n = before.length;
  const m = after.length;
  // (too big for a preview: the counts only)
  if (n * m > 400000) return { rows: [`(${n} → ${m} lines)`], added: Math.max(0, m - n), removed: Math.max(0, n - m) };
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops: { kind: ' ' | '-' | '+'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      ops.push({ kind: ' ', text: before[i] });
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i][j + 1] > lcs[i + 1][j])) {
      ops.push({ kind: '+', text: after[j] });
      j++;
    } else {
      ops.push({ kind: '-', text: before[i] });
      i++;
    }
  }
  const changed = ops.map((o) => o.kind !== ' ');
  const near = ops.map((_, k) => changed.slice(Math.max(0, k - context), k + context + 1).some(Boolean));
  const rows: string[] = [];
  let gap = false;
  ops.forEach((o, k) => {
    if (!near[k]) {
      gap = true;
      return;
    }
    if (gap && rows.length) rows.push('…');
    gap = false;
    rows.push(`${o.kind} ${o.text.replace(/\t/g, '    ')}`);
  });
  return { rows, added: ops.filter((o) => o.kind === '+').length, removed: ops.filter((o) => o.kind === '-').length };
}
