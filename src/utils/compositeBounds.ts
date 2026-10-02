/**
 * The composites' boxes on the canvas grown to hold their states: a drawing whose states are kept where they were
 * (Lock Layout, an edit from the canvas) has its composites sized by the layout for the layout's places, so a state
 * kept elsewhere can end up outside its box. Only grown, never shrunk; not while a state is dragged (a state dragged
 * out of its composite stays out of it, to be dropped there)
 */

/** Each composite's states and nested composites, from the chart's Mermaid source (flowchart subgraphs, or a state
 * diagram's `state … { … }`): its id → the ids inside it, nested ones' too */
export function compositeMembersOf(code: string): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  const stack: string[] = [];
  const stateDiagram = /^\s*stateDiagram/.test(code);
  const add = (id: string) => {
    for (const c of stack) if (c !== id) (out[c] ??= new Set()).add(id);
  };
  for (const raw of code.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    const sub = line.match(/^subgraph\s+([A-Za-z_][\w]*)/);
    const st = line.match(/^state\s+(?:"[^"]*"\s+as\s+)?([A-Za-z_][\w]*)\s*\{\s*$/);
    if (sub || st) {
      const id = (sub ?? st)![1];
      add(id);
      out[id] ??= new Set();
      stack.push(id);
      continue;
    }
    if (/^(end|\})$/.test(line)) {
      stack.pop();
      continue;
    }
    if (!stack.length || /^(direction|classDef|class|style|linkStyle|click|note)\b/.test(line) || line === '--') continue;
    // (a state declared here, or the states of a transition drawn in it)
    const ends = line.split(/\s*(?:-->|---|-\.->|==>|--\s[^-]*-->)\s*/).map((s) => s.replace(/^\[\*\]$/, '').match(/^([A-Za-z_][\w]*)/)?.[1]).filter((s): s is string => !!s && s !== 'state');
    const decl = line.match(/^state\s+"[^"]*"\s+as\s+([A-Za-z_][\w]*)\s*$/)?.[1];
    // (a state diagram: a transition in a composite puts both its states there; a flowchart: its first mention only)
    for (const id of decl ? [decl] : stateDiagram ? ends : ends.slice(0, 1)) add(id);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

/** A composite's group on the canvas: a flowchart's subgraph, or a state diagram's composite state */
export const COMPOSITE_SELECTOR = 'g.cluster, g.statediagram-cluster';
/** A composite's name (its id in the chart's source) */
export const compositeNameOf = (c: Element) => c.getAttribute('data-id') || c.id.replace(/^.*?render-[a-z0-9]+-/i, '').replace(/^state-/, '').replace(/-\d+$/, '');
/** A composite's boxes: its frame (outer), and a state diagram's area below its title (inner) */
export const compositeRectsOf = (c: Element) => ({
  outer: c.querySelector<SVGRectElement>(':scope > rect:not(.inner), :scope > g > rect.outer'),
  inner: c.querySelector<SVGRectElement>(':scope > rect.inner'),
});

const PAD = 14;
/** The composites' boxes grown to hold their states and nested composites (members: compositeMembersOf) */
export function growCompositesToMembers(svg: SVGSVGElement, members: Record<string, string[]>): string[] {
  const grown: string[] = [];
  const nameOf = compositeNameOf;
  // (innermost first: a nested one grown before the one around it)
  const clusters = [...svg.querySelectorAll<SVGGElement>(COMPOSITE_SELECTOR)].sort((a, b) => (members[nameOf(a)]?.length ?? 0) - (members[nameOf(b)]?.length ?? 0));
  for (const c of clusters) {
    const name = nameOf(c);
    const ids = members[name];
    const { outer: rect, inner } = compositeRectsOf(c);
    if (!ids?.length || !rect) continue;
    const toLocal = rect.getScreenCTM()?.inverse();
    if (!toLocal) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const take = (el: SVGGraphicsElement | null) => {
      const m = el?.getScreenCTM();
      if (!el || !m) return;
      const b = el.getBBox();
      if (!b.width && !b.height) return;
      for (const [x, y] of [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]) {
        const p = new DOMPoint(x, y).matrixTransform(m).matrixTransform(toLocal);
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
    };
    for (const id of ids) {
      const node = svg.querySelector<SVGGElement>(`g.node[data-state-id="${CSS.escape(id)}"]`);
      take(node ? ((node.querySelector(':scope > rect, :scope > path, :scope > polygon, :scope > circle') as SVGGraphicsElement | null) ?? node) : null);
      const nested = clusters.find((x) => nameOf(x) === id);
      take(nested ? compositeRectsOf(nested).outer : null);
    }
    if (!Number.isFinite(x0)) continue;
    const r = { x: +rect.getAttribute('x')!, y: +rect.getAttribute('y')!, w: +rect.getAttribute('width')!, h: +rect.getAttribute('height')! };
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite)) continue;
    // (all its states inside it: left as the layout drew it, its own margins)
    if (x0 >= r.x - 0.5 && y0 >= r.y - 0.5 && x1 <= r.x + r.w + 0.5 && y1 <= r.y + r.h + 0.5) continue;
    // (its title's room at the top)
    const title = c.querySelector<SVGGElement>(':scope > g.cluster-label');
    const top = title ? Math.max(PAD, (title.getBBox().height || 0) + 8) : PAD;
    const nx0 = Math.min(r.x, x0 - PAD);
    const ny0 = Math.min(r.y, y0 - top);
    const nx1 = Math.max(r.x + r.w, x1 + PAD);
    const ny1 = Math.max(r.y + r.h, y1 + PAD);
    if (nx0 >= r.x - 0.5 && ny0 >= r.y - 0.5 && nx1 <= r.x + r.w + 0.5 && ny1 <= r.y + r.h + 0.5) continue;
    // (a state diagram's area below its title: the same frame, the title's room kept)
    if (inner) {
      const i = { y: +inner.getAttribute('y')!, h: +inner.getAttribute('height')! };
      const gapTop = i.y - r.y;
      const gapBottom = r.y + r.h - (i.y + i.h);
      inner.setAttribute('x', String(nx0));
      inner.setAttribute('width', String(nx1 - nx0));
      inner.setAttribute('y', String(ny0 + gapTop));
      inner.setAttribute('height', String(Math.max(0, ny1 - ny0 - gapTop - gapBottom)));
    }
    rect.setAttribute('x', String(nx0));
    rect.setAttribute('y', String(ny0));
    rect.setAttribute('width', String(nx1 - nx0));
    rect.setAttribute('height', String(ny1 - ny0));
    // (its title: still centred at its top)
    if (title) {
      const t = (title.getAttribute('transform') || '').match(/translate\(\s*(-?[\d.]+)[,\s]+(-?[\d.]+)/);
      if (t) title.setAttribute('transform', `translate(${+t[1] + (nx0 + nx1 - r.x * 2 - r.w) / 2}, ${+t[2] + (ny0 - r.y)})`);
    }
    grown.push(name);
  }
  return grown;
}
