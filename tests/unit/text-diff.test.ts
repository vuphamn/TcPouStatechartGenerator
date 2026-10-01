// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The editors' Diff (src/utils/textDiff.ts): lines put in, taken out, changed (one out, one in), their line numbers
// before and after; the hunks: the changes with 3 lines around them, a gap marked between them
import { diffCounts, diffHunks, diffLines } from '../../src/utils/textDiff.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\r\n');
const after = before.replace('line 3', 'line three').replace('line 15\r\n', '').replace('line 20', 'line 20\r\nline 21');
const rows = diffLines(before, after);
const c = diffCounts(rows);
expect(c.added === 2 && c.removed === 2, `counts: +${c.added} −${c.removed}`);
const del3 = rows.find((r) => r.type === 'del' && r.text === 'line 3');
const add3 = rows.find((r) => r.type === 'add' && r.text === 'line three');
expect(del3?.before === 3 && add3?.after === 3, 'line 3 changed: out at 3, in at 3');
const del15 = rows.find((r) => r.type === 'del' && r.text === 'line 15');
expect(del15?.before === 15 && !rows.some((r) => r.type === 'add' && r.text === 'line 15'), 'line 15 taken out');
const add21 = rows.find((r) => r.type === 'add' && r.text === 'line 21');
expect(add21?.after === 20, 'line 21 put in (after: 20, a line fewer above)');
expect(rows.filter((r) => r.type === 'same').every((r) => r.before !== undefined && r.after !== undefined), 'the same lines: numbered before and after');
const hunks = diffHunks(rows);
const gaps = hunks.filter((h) => h === null).length;
expect(gaps >= 1 && hunks.filter((h) => h && h.type === 'same').length <= 3 * 6, `hunks: the changes with their context, ${gaps} gaps`);
expect(diffLines('a\nb', 'a\nb').every((r) => r.type === 'same'), 'no change: all the same');
expect(diffLines('', 'x').some((r) => r.type === 'add' && r.text === 'x'), 'from nothing: put in');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
