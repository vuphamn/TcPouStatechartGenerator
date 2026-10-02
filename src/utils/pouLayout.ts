/**
 * A POU's layout file, <POU>.machinescope.json beside its .TcPOU: what the canvas shares with the other developers
 * through git: the states' places (moved by hand), the transitions' routes and labels (dragged), the notes and the
 * states' documentation. Written stable (keys sorted, whole units, two-space indents) so a move is a small diff. The
 * personal settings (theme, presets, the dock, bookmarks, live recordings) are not in it: each user's own storage.
 */
import type { DiagramNotes } from '../types.ts';
import type { EdgeOffsetsMap, NodeOffsetsMap } from './nodeDragger.ts';

export const LAYOUT_FORMAT = 'kval-machinescope-layout';
export const LAYOUT_SUFFIX = '.machinescope.json';

export interface PouLayout {
  /** The POU's file name (SM_TableManager.TcPOU) */
  pou: string;
  /** The layout engine the places were made with (elk / dagre): another one draws the states elsewhere */
  layoutEngine: string;
  /** Each moved state's offset from where the layout engine puts it */
  states: NodeOffsetsMap;
  /** Each dragged transition's offsets (its handles, its label), by its path id */
  transitions: EdgeOffsetsMap;
  /** The notes, the states' documentation, their places and looks */
  notes: DiagramNotes;
}

/** The layout file's name beside a POU (SM_TableManager.TcPOU → SM_TableManager.machinescope.json) */
export const layoutFileNameOf = (pouFileName: string) => pouFileName.replace(/\.TcPOU$/i, '') + LAYOUT_SUFFIX;

const isEmptyObject = (o: unknown) => !o || typeof o !== 'object' || Object.keys(o as object).length === 0;

/** Nothing in it worth a file (no move, no route, no note) */
export function isEmptyLayout(l: Pick<PouLayout, 'states' | 'transitions' | 'notes'>): boolean {
  const n = l.notes ?? { nodes: {}, edges: {} };
  return (
    Object.values(l.states ?? {}).every((o) => !o || (Math.round(o.x) === 0 && Math.round(o.y) === 0)) &&
    Object.values(l.transitions ?? {}).every((o) => !o || Object.values(o).every((v) => !v || Math.round(Number(v)) === 0)) &&
    isEmptyObject(n.nodes) &&
    isEmptyObject(n.edges)
  );
}

/** A value with its object keys sorted (deep) and, round: its numbers whole (places, offsets: not a style's), zero moves left out */
function stable(value: unknown, dropZero = false, round = true): unknown {
  if (typeof value === 'number') return !Number.isFinite(value) ? 0 : round ? Math.round(value) : value;
  if (Array.isArray(value)) return value.map((v) => stable(v, false, round));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      const v = stable((value as Record<string, unknown>)[k], false, round);
      if (v === undefined) continue;
      // (an offset back at zero: nothing to keep)
      if (dropZero && v && typeof v === 'object' && Object.values(v as object).every((x) => x === 0)) continue;
      out[k] = v;
    }
    return out;
  }
  return value;
}

/** The file's text (stable: the same layout, the same bytes) */
export function serializeLayout(l: PouLayout): string {
  return (
    JSON.stringify(
      {
        format: LAYOUT_FORMAT,
        version: 1,
        pou: l.pou,
        layoutEngine: l.layoutEngine,
        states: stable(l.states ?? {}, true),
        transitions: stable(l.transitions ?? {}, true),
        notes: {
          edges: stable(l.notes?.edges ?? {}),
          nodes: stable(l.notes?.nodes ?? {}),
          ...(l.notes?.positions && Object.keys(l.notes.positions).length ? { positions: stable(l.notes.positions) } : {}),
          ...(l.notes?.styles && Object.keys(l.notes.styles).length ? { styles: stable(l.notes.styles, false, false) } : {}),
        },
      },
      null,
      2
    ) + '\n'
  );
}

/** The file read back, or an error (not one, a newer version) */
export function parseLayout(text: string): PouLayout | { error: string } {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text);
  } catch {
    return { error: 'Not JSON' };
  }
  if (!j || j.format !== LAYOUT_FORMAT) return { error: `Not a ${LAYOUT_FORMAT} file` };
  if (typeof j.version !== 'number' || j.version > 1) return { error: `Version ${String(j.version)}: made by a newer Kval MachineScope` };
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const notes = obj(j.notes);
  return {
    pou: typeof j.pou === 'string' ? j.pou : '',
    layoutEngine: typeof j.layoutEngine === 'string' ? j.layoutEngine : 'elk',
    states: obj(j.states) as NodeOffsetsMap,
    transitions: obj(j.transitions) as EdgeOffsetsMap,
    notes: { nodes: obj(notes.nodes) as DiagramNotes['nodes'], edges: obj(notes.edges) as DiagramNotes['edges'], ...(notes.positions ? { positions: obj(notes.positions) as DiagramNotes['positions'] } : {}), ...(notes.styles ? { styles: obj(notes.styles) as DiagramNotes['styles'] } : {}) },
  };
}
