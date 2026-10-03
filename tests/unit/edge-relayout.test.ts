// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// One transition laid out again (the canvas' Re-layout edge): straight when its states face each other; else one or
// two turns; around a state in the way, never through one; out of its state and into the other one square to a side,
// away from the corners (a diamond: at a corner); a label crossed only when there is no other way; fast on a big chart
import { relayoutEdgeRoute, type Point } from '../../src/utils/edgeRelayout.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const box = (cx: number, cy: number, hw = 90, hh = 22) => ({ cx, cy, hw, hh });
type Box = ReturnType<typeof box>;
const turns = (r: Point[] | null) => (r ? r.length - 2 : -1);
const orthogonal = (r: Point[]) => r.every((p, i) => !i || Math.abs(p.x - r[i - 1].x) < 0.01 || Math.abs(p.y - r[i - 1].y) < 0.01);
const through = (r: Point[], b: Box) =>
  r.some((p, i) => i > 0 && Math.max(p.x, r[i - 1].x) > b.cx - b.hw && Math.min(p.x, r[i - 1].x) < b.cx + b.hw && Math.max(p.y, r[i - 1].y) > b.cy - b.hh && Math.min(p.y, r[i - 1].y) < b.cy + b.hh);
const onSide = (p: Point, b: Box, gap: number) =>
  (Math.abs(Math.abs(p.x - b.cx) - (b.hw + gap)) < 0.2 && Math.abs(p.y - b.cy) <= b.hh) || (Math.abs(Math.abs(p.y - b.cy) - (b.hh + gap)) < 0.2 && Math.abs(p.x - b.cx) <= b.hw);
const show = (r: Point[] | null) => (r ? r.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ') : 'none');

// 1. Facing each other (one above the other, their spans overlapping): straight down
{
  const src = box(100, 100);
  const tgt = box(160, 300);
  const r = relayoutEdgeRoute({ src, tgt, obstacles: [], tgtGap: 4 });
  expect(turns(r) === 0 && !!r && Math.abs(r[0].x - r[1].x) < 0.01 && r[0].y < r[1].y, `facing: straight (${show(r)})`);
  expect(!!r && onSide(r[0], src, 0) && onSide(r[r.length - 1], tgt, 4), 'out of its side, into the other one the arrow head\'s gap off it');
}

// 2. Not facing: one turn (out of the side toward it, into the other one's top)
{
  const src = box(100, 100);
  const tgt = box(600, 400);
  const r = relayoutEdgeRoute({ src, tgt, obstacles: [] });
  expect(!!r && orthogonal(r) && turns(r) === 1, `not facing: one turn (${show(r)})`);
}

// 3. A state in the way: around it, not through it; still few turns
{
  const src = box(100, 100);
  const tgt = box(100, 500);
  const wall = box(100, 300, 150, 30);
  const r = relayoutEdgeRoute({ src, tgt, obstacles: [wall] });
  expect(!!r && orthogonal(r) && !through(r, wall) && turns(r) <= 4, `a state in the way: around it (${show(r)})`);
  expect(!!r && !through(r.slice(1, -1).length > 1 ? r.slice(1, -1) : [], src) && !through(r.slice(1, -1).length > 1 ? r.slice(1, -1) : [], tgt), 'not back through its own states');
}

// 4. The picture's case: from a state's right to one below and to the right, a long way: one turn, no zigzag
{
  const src = box(120, 55, 100, 18);
  const tgt = box(560, 420, 140, 18);
  const mid = box(360, 190, 230, 18);
  const r = relayoutEdgeRoute({ src, tgt, obstacles: [mid], tgtGap: 4 });
  expect(!!r && !through(r, mid) && turns(r) <= 2, `past a state between them: at most two turns (${show(r)})`);
}

// 5. A diamond (a choice): in at a corner
{
  const src = box(100, 100);
  const tgt = box(400, 400, 20, 20);
  const r = relayoutEdgeRoute({ src, tgt, obstacles: [], tgtDiamond: true });
  const end = r?.[r.length - 1];
  expect(!!end && ((Math.abs(end.x - 400) < 0.1 && Math.abs(Math.abs(end.y - 400) - 20) < 0.2) || (Math.abs(end.y - 400) < 0.1 && Math.abs(Math.abs(end.x - 400) - 20) < 0.2)), `a diamond: in at a corner (${show(r)})`);
}

// 6. A label in the straight way: crossed only when there is no other way (here there is: beside it)
{
  const src = box(100, 100);
  const tgt = box(100, 300);
  const label = box(100, 200, 40, 10);
  const r = relayoutEdgeRoute({ src, tgt, obstacles: [], labels: [label] });
  expect(!!r && !through(r, label) && turns(r) === 0, `a label in the way: straight beside it (${show(r)})`);
}

// 7. Another line where it would run: not on top of it
{
  const src = box(100, 100);
  const tgt = box(100, 300);
  const other: Point[] = [{ x: 100, y: 122 }, { x: 100, y: 278 }];
  const r = relayoutEdgeRoute({ src, tgt, obstacles: [], edges: [other] });
  expect(!!r && turns(r) === 0 && Math.abs(r[0].x - 100) > 4, `another line there: beside it (${show(r)})`);
}

// 8. A big chart: quick
{
  const obstacles: Box[] = [];
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) obstacles.push(box(i * 260, j * 120, 90, 22));
  const src = obstacles.splice(0, 1)[0];
  const tgt = obstacles.splice(obstacles.length - 1, 1)[0];
  const edges: Point[][] = obstacles.slice(0, 60).map((b) => [{ x: b.cx, y: b.cy + 22 }, { x: b.cx, y: b.cy + 98 }]);
  const t0 = Date.now();
  const r = relayoutEdgeRoute({ src, tgt, obstacles, edges });
  const ms = Date.now() - t0;
  expect(!!r && obstacles.every((o) => !through(r, o)), `a 144-state chart: a route clear of them all (${r ? turns(r) : '-'} turns)`);
  expect(ms < 1500, `quick (${ms} ms)`);
}

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
