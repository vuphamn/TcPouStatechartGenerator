/**
 * One transition laid out again on its own (the canvas' "Re-layout edge"): an orthogonal route from its state to
 * the other one with as few turns as it can, clear of the other states, the rest of the drawing left as it is.
 *
 * A shortest path on a sparse grid (the lines along the states' sides, a clearance away, and between them) where a
 * turn costs as much as a long stretch: straight when the two states face each other, else one or two turns, around
 * the states in the way. It leaves its state square to a side and comes into the other one square to a side, away
 * from the corners (a choice's diamond: at its corners). Other transitions' labels and lines are avoided when it
 * costs little: crossing a label, running along another line, an end on another one's end.
 */
import type { NodeBox } from './nodeDragger.ts';

export interface Point {
  x: number;
  y: number;
}

export interface RelayoutInput {
  src: NodeBox;
  tgt: NodeBox;
  /** The other states' boxes: never crossed */
  obstacles: NodeBox[];
  /** The other transitions' labels: crossed only when there is no other way */
  labels?: NodeBox[];
  /** The other transitions' lines (their points): crossed or followed at a cost */
  edges?: Point[][];
  /** How far off the states' borders the route starts and ends (the arrow head's room) */
  srcGap?: number;
  tgtGap?: number;
  srcDiamond?: boolean;
  tgtDiamond?: boolean;
}

/** Clearance between the route and a state it passes */
const CLEAR = 16;
/** A turn: as much as this long a stretch */
const TURN = 70;
const LABEL_COST = 400;
const CROSS_COST = 25;
const ALONG_COST = 4;
const SHARED_END_COST = 150;
/** Away from a side's corners */
const CORNER = 10;

const inside = (b: NodeBox, p: Point, grow: number) => Math.abs(p.x - b.cx) < b.hw + grow && Math.abs(p.y - b.cy) < b.hh + grow;

/** A horizontal or vertical stretch through a box (grown by `grow`) */
function through(b: NodeBox, a: Point, c: Point, grow: number): boolean {
  return Math.max(a.x, c.x) > b.cx - b.hw - grow && Math.min(a.x, c.x) < b.cx + b.hw + grow && Math.max(a.y, c.y) > b.cy - b.hh - grow && Math.min(a.y, c.y) < b.cy + b.hh + grow;
}

/** Two segments cross (not just touch at an end) */
function crossing(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return d1 * d2 < -1e-6 && d3 * d4 < -1e-6;
}

/** How long a horizontal / vertical stretch runs along (within 4) a horizontal / vertical one of another line */
function alongLength(a: Point, b: Point, c: Point, d: Point): number {
  const horizontal = Math.abs(a.y - b.y) < 0.5;
  if (horizontal ? Math.abs(c.y - d.y) >= 0.5 || Math.abs(c.y - a.y) > 4 : Math.abs(c.x - d.x) >= 0.5 || Math.abs(c.x - a.x) > 4) return 0;
  const [s1, e1] = horizontal ? [Math.min(a.x, b.x), Math.max(a.x, b.x)] : [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const [s2, e2] = horizontal ? [Math.min(c.x, d.x), Math.max(c.x, d.x)] : [Math.min(c.y, d.y), Math.max(c.y, d.y)];
  return Math.max(0, Math.min(e1, e2) - Math.max(s1, s2));
}

/** The points' consecutive duplicates and the ones in the middle of a straight run left out */
export function simplifyRoute(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5) continue;
    if (out.length >= 2) {
      const prev = out[out.length - 2];
      if ((Math.abs(prev.x - last.x) < 0.5 && Math.abs(last.x - p.x) < 0.5) || (Math.abs(prev.y - last.y) < 0.5 && Math.abs(last.y - p.y) < 0.5)) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/** A small binary heap of [cost, state] */
class Heap {
  private c: number[] = [];
  private s: number[] = [];
  get size() {
    return this.c.length;
  }
  push(cost: number, state: number) {
    const { c, s } = this;
    let i = c.length;
    c.push(cost);
    s.push(state);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= c[i]) break;
      [c[p], c[i]] = [c[i], c[p]];
      [s[p], s[i]] = [s[i], s[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const { c, s } = this;
    const top: [number, number] = [c[0], s[0]];
    const lc = c.pop()!;
    const ls = s.pop()!;
    if (c.length) {
      c[0] = lc;
      s[0] = ls;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < c.length && c[l] < c[m]) m = l;
        if (r < c.length && c[r] < c[m]) m = r;
        if (m === i) break;
        [c[m], c[i]] = [c[i], c[m]];
        [s[m], s[i]] = [s[i], s[m]];
        i = m;
      }
    }
    return top;
  }
}

// Directions: 0 right (+x), 1 down (+y), 2 left, 3 up
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/** The transition's new route (its points, from its state to the other one), or null when there is none */
export function relayoutEdgeRoute(input: RelayoutInput): Point[] | null {
  const { src, tgt } = input;
  const gs = Math.max(0, input.srcGap ?? 0);
  const gt = Math.max(0, input.tgtGap ?? 0);
  // (only what is near the two states: the region they span, and room to go around)
  const pad = 400;
  const rx0 = Math.min(src.cx - src.hw, tgt.cx - tgt.hw) - pad;
  const rx1 = Math.max(src.cx + src.hw, tgt.cx + tgt.hw) + pad;
  const ry0 = Math.min(src.cy - src.hh, tgt.cy - tgt.hh) - pad;
  const ry1 = Math.max(src.cy + src.hh, tgt.cy + tgt.hh) + pad;
  const near = (b: NodeBox) => b.cx + b.hw > rx0 && b.cx - b.hw < rx1 && b.cy + b.hh > ry0 && b.cy - b.hh < ry1;
  const obstacles = input.obstacles.filter(near);
  const labels = (input.labels ?? []).filter(near);
  const edges = (input.edges ?? []).filter((e) => e.length >= 2);
  const ends = edges.flatMap((e) => [e[0], e[e.length - 1]]);

  // The grid's lines: the states' sides a clearance away, the two states' centers and their facing spans' middles,
  // the ports' lines (the sides, the gap away), halfway between neighbours
  const xs = new Set<number>([src.cx, tgt.cx, src.cx - src.hw - gs, src.cx + src.hw + gs, tgt.cx - tgt.hw - gt, tgt.cx + tgt.hw + gt]);
  const ys = new Set<number>([src.cy, tgt.cy, src.cy - src.hh - gs, src.cy + src.hh + gs, tgt.cy - tgt.hh - gt, tgt.cy + tgt.hh + gt]);
  const lo = Math.max(src.cx - src.hw, tgt.cx - tgt.hw);
  const hi = Math.min(src.cx + src.hw, tgt.cx + tgt.hw);
  if (hi > lo) xs.add((lo + hi) / 2);
  const loY = Math.max(src.cy - src.hh, tgt.cy - tgt.hh);
  const hiY = Math.min(src.cy + src.hh, tgt.cy + tgt.hh);
  if (hiY > loY) ys.add((loY + hiY) / 2);
  for (const b of [src, tgt, ...obstacles]) {
    xs.add(b.cx - b.hw - CLEAR);
    xs.add(b.cx + b.hw + CLEAR);
    ys.add(b.cy - b.hh - CLEAR);
    ys.add(b.cy + b.hh + CLEAR);
  }
  const withMiddles = (set: Set<number>) => {
    const v = [...set].map((n) => Math.round(n * 10) / 10).sort((a, b) => a - b);
    const out: number[] = [];
    for (let i = 0; i < v.length; i++) {
      if (i && v[i] - v[i - 1] < 0.5) continue;
      if (i && v[i] - v[i - 1] > 2 * CLEAR) out.push((v[i] + v[i - 1]) / 2);
      out.push(v[i]);
    }
    return out.sort((a, b) => a - b);
  };
  const X = withMiddles(xs);
  const Y = withMiddles(ys);
  const nx = X.length;
  const ny = Y.length;
  const at = (i: number, j: number): Point => ({ x: X[i], y: Y[j] });

  // A grid point the route may use: not in a state (the two ends' only on their port lines, outside)
  const blocked = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = at(i, j);
      if (obstacles.some((b) => inside(b, p, CLEAR - 1)) || inside(src, p, -0.5 + Math.min(gs, 0.4)) || inside(tgt, p, -0.5 + Math.min(gt, 0.4))) blocked[j * nx + i] = 1;
    }
  }
  // The other lines' segments, each with its extent (most are far from a given stretch)
  const segs: { a: Point; b: Point; x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const e of edges) for (let k = 1; k < e.length; k++) segs.push({ a: e[k - 1], b: e[k], x0: Math.min(e[k - 1].x, e[k].x) - 4, x1: Math.max(e[k - 1].x, e[k].x) + 4, y0: Math.min(e[k - 1].y, e[k].y) - 4, y1: Math.max(e[k - 1].y, e[k].y) + 4 });
  // The cost of a stretch between neighbouring grid points (Infinity: not allowed)
  const costOf = (a: Point, b: Point): number => {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (obstacles.some((o) => inside(o, mid, CLEAR - 1))) return Infinity;
    // (along a state's own side: not; only out of it and into the other one, square)
    if (inside(src, mid, gs + 0.4) || inside(tgt, mid, gt + 0.4)) return Infinity;
    let cost = Math.hypot(b.x - a.x, b.y - a.y);
    for (const l of labels) if (through(l, a, b, 2)) cost += LABEL_COST;
    const [x0, x1, y0, y1] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
    for (const s of segs) {
      if (s.x1 < x0 || s.x0 > x1 || s.y1 < y0 || s.y0 > y1) continue;
      if (crossing(a, b, s.a, s.b)) cost += CROSS_COST;
      cost += ALONG_COST * alongLength(a, b, s.a, s.b);
    }
    return cost;
  };
  // (each stretch's cost worked out once: from (i, j) right, and from (i, j) down)
  const right = new Float64Array(nx * ny).fill(NaN);
  const down = new Float64Array(nx * ny).fill(NaN);
  const stepCost = (i: number, j: number, ni: number, nj: number): number => {
    const [ci, cj] = [Math.min(i, ni), Math.min(j, nj)];
    const cache = nj === j ? right : down;
    const k = cj * nx + ci;
    if (Number.isNaN(cache[k])) cache[k] = costOf(at(i, j), at(ni, nj));
    return cache[k];
  };

  // The ports: on each side's line, away from the corners (a diamond: its corners), with that side's direction
  type Port = { i: number; j: number; dir: number; cost: number };
  const portsOf = (box: NodeBox, gap: number, diamond: boolean, outward: boolean): Port[] => {
    const out: Port[] = [];
    const sides = [
      { dir: 0, x: box.cx + box.hw + gap },
      { dir: 2, x: box.cx - box.hw - gap },
      { dir: 1, y: box.cy + box.hh + gap },
      { dir: 3, y: box.cy - box.hh - gap },
    ];
    for (const s of sides) {
      const horizontal = s.x !== undefined;
      const fixed = horizontal ? X.findIndex((v) => Math.abs(v - s.x!) < 0.06) : Y.findIndex((v) => Math.abs(v - s.y!) < 0.06);
      if (fixed < 0) continue;
      const span = horizontal ? box.hh : box.hw;
      const center = horizontal ? box.cy : box.cx;
      const along = horizontal ? Y : X;
      const room = diamond ? 0.06 : Math.max(0.06, span - CORNER);
      along.forEach((v, k) => {
        if (Math.abs(v - center) > room) return;
        const [i, j] = horizontal ? [fixed, k] : [k, fixed];
        if (blocked[j * nx + i]) return;
        const p = at(i, j);
        let cost = 0.15 * Math.abs(v - center);
        if (ends.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 8)) cost += SHARED_END_COST;
        // (into the other state: moving inward, the side's direction reversed)
        out.push({ i, j, dir: outward ? s.dir : (s.dir + 2) % 4, cost });
      });
    }
    return out;
  };
  const starts = portsOf(src, gs, !!input.srcDiamond, true);
  const goals = portsOf(tgt, gt, !!input.tgtDiamond, false);
  if (!starts.length || !goals.length) return null;
  const goalCost = new Map<number, number>();
  for (const g of goals) goalCost.set((g.j * nx + g.i) * 4 + g.dir, g.cost);

  // Dijkstra over (grid point, direction)
  const N = nx * ny * 4;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const heap = new Heap();
  for (const s of starts) {
    const id = (s.j * nx + s.i) * 4 + s.dir;
    if (s.cost < dist[id]) {
      dist[id] = s.cost;
      heap.push(s.cost, id);
    }
  }
  let best = -1;
  let bestCost = Infinity;
  while (heap.size) {
    const [cost, id] = heap.pop();
    if (cost > dist[id] || cost >= bestCost) continue;
    const dir = id % 4;
    const cell = (id - dir) / 4;
    const i = cell % nx;
    const j = (cell - i) / nx;
    const g = goalCost.get(id);
    if (g !== undefined && cost + g < bestCost) {
      bestCost = cost + g;
      best = id;
      continue;
    }
    for (let d = 0; d < 4; d++) {
      if (d === (dir + 2) % 4) continue;
      const ni = i + DX[d];
      const nj = j + DY[d];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny || blocked[nj * nx + ni]) continue;
      const step = stepCost(i, j, ni, nj);
      if (step === Infinity) continue;
      const next = (nj * nx + ni) * 4 + d;
      const c = cost + step + (d === dir ? 0 : TURN);
      if (c < dist[next]) {
        dist[next] = c;
        prev[next] = id;
        heap.push(c, next);
      }
    }
  }
  if (best < 0) return null;
  const pts: Point[] = [];
  for (let id = best; id >= 0; id = prev[id]) {
    const cell = (id - (id % 4)) / 4;
    pts.push(at(cell % nx, Math.floor(cell / nx)));
  }
  return simplifyRoute(pts.reverse());
}
