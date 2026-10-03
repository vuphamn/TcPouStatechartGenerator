/**
 * A layout file git could not merge (conflict markers in it, <<<<<<< / ======= / >>>>>>>): its two sides read back
 * (yours: the branch you are on; theirs: the one merged or pulled in), and merged key by key: each state's offset
 * and place, each transition's route, each note, each colour from either side; one changed on both sides: yours.
 */
import { parseLayout, type PouLayout } from './pouLayout.ts';

/** The two sides of a file with conflict markers (a diff3 base section left out), or null when it has none */
export function splitConflict(text: string): { ours: string; theirs: string } | null {
  if (!/^<{7}( |$)/m.test(text)) return null;
  const ours: string[] = [];
  const theirs: string[] = [];
  let mode: 'both' | 'ours' | 'base' | 'theirs' = 'both';
  for (const line of text.split(/\r?\n/)) {
    if (/^<{7}( |$)/.test(line)) mode = 'ours';
    else if (/^\|{7}( |$)/.test(line) && mode === 'ours') mode = 'base';
    else if (/^={7}$/.test(line) && (mode === 'ours' || mode === 'base')) mode = 'theirs';
    else if (/^>{7}( |$)/.test(line) && mode === 'theirs') mode = 'both';
    else if (mode === 'both') {
      ours.push(line);
      theirs.push(line);
    } else if (mode === 'ours') ours.push(line);
    else if (mode === 'theirs') theirs.push(line);
  }
  // (markers left open: not a conflict this can read)
  if (mode !== 'both') return null;
  return { ours: ours.join('\n'), theirs: theirs.join('\n') };
}

const merged = <T>(theirs: Record<string, T> | undefined, ours: Record<string, T> | undefined): Record<string, T> => ({ ...(theirs ?? {}), ...(ours ?? {}) });

/** Both sides' layouts in one: each key from either side, yours where both have it */
export function mergeLayouts(ours: PouLayout, theirs: PouLayout): PouLayout {
  const transitions: Record<string, PouLayout['transitions'][string]> = {};
  for (const engine of new Set([...Object.keys(theirs.transitions), ...Object.keys(ours.transitions)])) transitions[engine] = merged(theirs.transitions[engine], ours.transitions[engine]);
  const notes: PouLayout['notes'] = {
    nodes: merged(theirs.notes.nodes, ours.notes.nodes),
    edges: merged(theirs.notes.edges, ours.notes.edges),
    ...(ours.notes.positions || theirs.notes.positions ? { positions: merged(theirs.notes.positions, ours.notes.positions) } : {}),
    ...(ours.notes.styles || theirs.notes.styles ? { styles: merged(theirs.notes.styles, ours.notes.styles) } : {}),
  };
  return {
    pou: ours.pou || theirs.pou,
    layoutEngine: ours.layoutEngine,
    // (the states' offsets are the layout engine's: theirs taken only when made with the same one)
    states: ours.layoutEngine === theirs.layoutEngine ? merged(theirs.states, ours.states) : ours.states,
    places: merged(theirs.places, ours.places),
    transitions,
    notes,
    look: {
      states: merged(theirs.look.states, ours.look.states),
      transitions: merged(theirs.look.transitions, ours.look.transitions),
      collapsed: [...new Set([...theirs.look.collapsed, ...ours.look.collapsed])],
    },
  };
}

/** Where the two sides differ, one line each (what Merge both does with it): states, places, routes, notes, looks */
export function diffLayouts(ours: PouLayout, theirs: PouLayout): string[] {
  const out: string[] = [];
  const short = (id: string) => (id.length > 40 ? `${id.slice(0, 38)}…` : id);
  const pt = (o?: { x: number; y: number }) => (o ? `${Math.round(o.x)}, ${Math.round(o.y)}` : 'not moved');
  const json = (v: unknown) => JSON.stringify(v ?? null);
  const each = <T>(label: string, a: Record<string, T> | undefined, b: Record<string, T> | undefined, show: (v: T | undefined) => string) => {
    for (const k of [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort()) {
      const [x, y] = [a?.[k], b?.[k]];
      if (json(x) === json(y)) continue;
      const how = x === undefined ? 'theirs taken' : y === undefined ? 'yours kept' : 'yours kept (both changed it)';
      out.push(`${label} ${short(k)}: yours ${show(x)} · theirs ${show(y)} → ${how}`);
    }
  };
  if (ours.layoutEngine === theirs.layoutEngine) each('State', ours.states, theirs.states, pt);
  else out.push(`Layout engine: yours ${ours.layoutEngine.toUpperCase()} · theirs ${theirs.layoutEngine.toUpperCase()} → yours (their states' offsets are the other engine's: not taken)`);
  for (const engine of [...new Set([...Object.keys(ours.transitions), ...Object.keys(theirs.transitions)])].sort()) each(`Route (${engine})`, ours.transitions[engine], theirs.transitions[engine], (v) => (v ? (v.route ? 'laid out again' : 'dragged') : 'as drawn'));
  each('Note', ours.notes.nodes, theirs.notes.nodes, (v) => (v ? `"${String(v).split('\n')[0].slice(0, 24)}"` : 'none'));
  each('Note', ours.notes.edges, theirs.notes.edges, (v) => (v ? `"${String(v).split('\n')[0].slice(0, 24)}"` : 'none'));
  each('Colour', ours.look.states, theirs.look.states, (v) => (v ? String((v as { fill?: string }).fill ?? 'own') : 'default'));
  each('Colour', ours.look.transitions, theirs.look.transitions, (v) => (v ? 'own' : 'default'));
  const [oc, tc] = [new Set(ours.look.collapsed), new Set(theirs.look.collapsed)];
  for (const c of [...new Set([...oc, ...tc])].sort()) if (oc.has(c) !== tc.has(c)) out.push(`Composite ${c}: ${oc.has(c) ? 'collapsed in yours' : 'collapsed in theirs'} → collapsed`);
  return out;
}

/** A conflicted layout file read: its two sides' layouts, or why not (no markers; a side that is not a layout) */
export function readConflict(text: string): { ours: PouLayout; theirs: PouLayout } | { error: string } | null {
  const sides = splitConflict(text);
  if (!sides) return null;
  const ours = parseLayout(sides.ours);
  const theirs = parseLayout(sides.theirs);
  if ('error' in ours) return { error: `Your side: ${ours.error}` };
  if ('error' in theirs) return { error: `Their side: ${theirs.error}` };
  return { ours, theirs };
}
