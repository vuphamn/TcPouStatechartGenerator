/**
 * The operator board's tree view: the state machines nested as the PLC's program nests them (by their symbol paths):
 * a machine inside another (MAIN.mainStateMachine.smTable1 under MAIN.mainStateMachine), the members between them as
 * groups (an array: aDoors, its elements [1], [2]). The problems roll up: a group or a machine shows the worst of what
 * is under it (error, then stuck), with counts, so a closed branch still says where to look.
 */

export type Health = 'error' | 'stuck' | 'ok' | 'unknown';

export interface TreeMachine {
  path: string;
}

export interface BoardTreeNode<M extends TreeMachine> {
  /** Its full path, lower case (unique in its PLC) */
  key: string;
  /** Its own part of the path: smTable1, aDoors, [2] */
  label: string;
  path: string;
  machine: M | null;
  children: BoardTreeNode<M>[];
}

/** A symbol path's parts: names and array indexes (MAIN.aDoors[1].sm: MAIN, aDoors, [1], sm) */
export function pathParts(path: string): string[] {
  return path.match(/[A-Za-z_]\w*|\[[^\]]*\]/g) ?? [];
}

const join = (parts: string[]) => parts.reduce((s, p) => (p.startsWith('[') ? s + p : s ? `${s}.${p}` : p), '');

/**
 * The machines as a tree under root (its own node first, when it is a machine): one tree per top part for the ones
 * outside root. A group with a single child that is no machine is joined with it (stations.station1), so deep
 * structures do not take a row per level
 */
export function machineTree<M extends TreeMachine>(machines: M[], root: string): BoardTreeNode<M>[] {
  const rootParts = pathParts(root);
  const top: BoardTreeNode<M>[] = [];
  const byKey = new Map<string, BoardTreeNode<M>>();
  const nodeFor = (parts: string[], base: number): BoardTreeNode<M> => {
    const path = join(parts);
    const key = path.toLowerCase();
    const hit = byKey.get(key);
    if (hit) return hit;
    const node: BoardTreeNode<M> = { key, label: parts.length <= base ? path : parts[parts.length - 1], path, machine: null, children: [] };
    byKey.set(key, node);
    if (parts.length <= base) top.push(node);
    else nodeFor(parts.slice(0, -1), base).children.push(node);
    return node;
  };
  for (const m of machines) {
    const parts = pathParts(m.path);
    const under = rootParts.length > 0 && parts.length >= rootParts.length && rootParts.every((p, i) => p.toLowerCase() === parts[i].toLowerCase());
    // (under root: its node the top; else the machine's own first part)
    nodeFor(parts, under ? rootParts.length : 1).machine = m;
  }
  const squash = (n: BoardTreeNode<M>): BoardTreeNode<M> => {
    n.children = n.children.map(squash);
    if (!n.machine && n.children.length === 1 && !n.children[0].machine && !n.children[0].label.startsWith('[')) {
      const c = n.children[0];
      return { ...c, label: `${n.label}.${c.label}` };
    }
    return n;
  };
  const sortRec = (list: BoardTreeNode<M>[]) => {
    // (machines and groups in the program's order of names; array elements by their index)
    list.sort((a, b) => {
      const ia = /^\[(-?\d+)/.exec(a.label);
      const ib = /^\[(-?\d+)/.exec(b.label);
      if (ia && ib) return Number(ia[1]) - Number(ib[1]);
      return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
    });
    for (const n of list) sortRec(n.children);
  };
  // (a top group holding one thing only, a machine outside root too: shown as that one, MAIN.conveyor)
  const out = top.map(squash).map((n) => (!n.machine && n.children.length === 1 ? { ...n.children[0], label: `${n.label}${n.children[0].label.startsWith('[') ? '' : '.'}${n.children[0].label}` } : n));
  sortRec(out);
  return out;
}

export interface Rollup {
  worst: Health;
  error: number;
  stuck: number;
  machines: number;
}

/** What is under a node, itself included: the worst health, how many in error, stuck, and machines */
export function rollup<M extends TreeMachine>(n: BoardTreeNode<M>, healthOf: (m: M) => Health): Rollup {
  const rank: Record<Health, number> = { error: 0, stuck: 1, ok: 2, unknown: 3 };
  const out: Rollup = { worst: 'unknown', error: 0, stuck: 0, machines: 0 };
  const visit = (x: BoardTreeNode<M>) => {
    if (x.machine) {
      const h = healthOf(x.machine);
      out.machines++;
      if (h === 'error') out.error++;
      if (h === 'stuck') out.stuck++;
      if (rank[h] < rank[out.worst]) out.worst = h;
    }
    x.children.forEach(visit);
  };
  visit(n);
  return out;
}

/** Every node's key under (and with) a node: open or close a branch at once */
export function keysUnder<M extends TreeMachine>(n: BoardTreeNode<M>): string[] {
  return [n.key, ...n.children.flatMap((c) => keysUnder(c))];
}

/** A machine's place on a board (a PLC's, by its path): the key of the selection, the saved filters and the rules */
export const machineKey = (plc: string, path: string) => `${plc}|${path}`;

/** Does a rule (a recording, an alarm) cover this machine: its own machines, else every one under its root */
export function covers(rule: { plc: string; root: string; machines: string[] | null; enabled?: boolean }, plc: string, path: string): boolean {
  if (rule.enabled === false || rule.plc !== plc) return false;
  const p = path.toLowerCase();
  if (rule.machines) return rule.machines.some((x) => x.toLowerCase() === p);
  const r = rule.root.toLowerCase();
  return p === r || p.startsWith(`${r}.`);
}
