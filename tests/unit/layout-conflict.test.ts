// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// A layout file git could not merge: its two sides read back from the conflict markers (a diff3 base left out), and
// listed (each difference with what Merge both does), merged key by key: each side's own changes kept, a key changed
// on both: yours; the states' offsets of another layout engine not mixed in; no markers: null; markers left open: null
import { diffLayouts, mergeLayouts, readConflict, splitConflict } from '../../src/utils/layoutConflict.ts';
import { serializeLayout, type PouLayout } from '../../src/utils/pouLayout.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const base: PouLayout = {
  pou: 'SM_X.TcPOU',
  layoutEngine: 'elk',
  states: { A: { x: 10, y: 0 } },
  places: { A: { x: 100, y: 50 }, B: { x: 300, y: 50 } },
  transitions: { elk: { 'A->B': { x: 5, y: 0 } } },
  notes: { nodes: { A: 'note A' }, edges: {} },
  look: { states: {}, transitions: {}, collapsed: [] },
};
// Yours: A moved, a note on B; theirs: A moved elsewhere, B moved, a colour, a route
const ours: PouLayout = { ...base, states: { A: { x: 40, y: 0 } }, notes: { nodes: { A: 'note A', B: 'mine on B' }, edges: {} } };
const theirs: PouLayout = { ...base, states: { A: { x: -30, y: 0 }, B: { x: 0, y: 20 } }, look: { states: { B: { fill: '#f00' } }, transitions: {}, collapsed: ['Clamp'] }, transitions: { elk: { 'A->B': { x: 5, y: 0 }, 'B->A': { x: 0, y: 9 } } } };
// The file as git leaves it: the differing lines in a conflict (a diff3 base too)
const lo = serializeLayout(ours).split('\n');
const lt = serializeLayout(theirs).split('\n');
let i = 0;
while (i < lo.length && lo[i] === lt[i]) i++;
let jo = lo.length - 1;
let jt = lt.length - 1;
while (jo > i && jt > i && lo[jo] === lt[jt]) {
  jo--;
  jt--;
}
const conflicted = [...lo.slice(0, i), '<<<<<<< HEAD', ...lo.slice(i, jo + 1), '||||||| base', '  "old": 1,', '=======', ...lt.slice(i, jt + 1), '>>>>>>> origin/main', ...lo.slice(jo + 1)].join('\n');

const sides = splitConflict(conflicted);
expect(!!sides && JSON.parse(sides.ours).states.A.x === 40 && JSON.parse(sides.ours).notes.nodes.B === 'mine on B', 'yours read back');
expect(!!sides && JSON.parse(sides.theirs).states.B.y === 20 && !/old/.test(sides.theirs), 'theirs read back (the base left out)');
const r = readConflict(conflicted);
expect(!!r && !('error' in r), 'both sides are layouts');
if (r && !('error' in r)) {
  const m = mergeLayouts(r.ours, r.theirs);
  expect(m.states.A.x === 40 && m.states.B?.y === 20, `each state: yours where both moved it (A ${m.states.A.x}), theirs where only they did (B)`);
  expect(m.notes.nodes.B === 'mine on B' && m.look.states.B?.fill === '#f00' && m.look.collapsed.includes('Clamp') && !!m.transitions.elk['B->A'], 'your note, their colour, their collapsed composite, their route: all kept');
  const diff = diffLayouts(r.ours, r.theirs);
  const has = (re: RegExp) => diff.some((l) => re.test(l));
  expect(has(/^State A: yours 40, 0 · theirs -30, 0 → yours kept \(both changed it\)/) && has(/^State B: yours not moved · theirs 0, 20 → theirs taken/) && has(/^Note B: yours "mine on B" · theirs none → yours kept/) && has(/^Colour B: yours default · theirs #f00 → theirs taken/) && has(/^Route \(elk\) B->A: .*theirs taken/) && has(/^Composite Clamp: collapsed in theirs/), `the differences listed, each with what Merge both does: ${diff.join(' | ')}`);
  expect(diffLayouts(r.ours, r.ours).length === 0, 'the same layout: no differences');
  const dagre = mergeLayouts({ ...r.ours }, { ...r.theirs, layoutEngine: 'dagre', states: { Z: { x: 1, y: 1 } } });
  expect(!dagre.states.Z, "another engine's state offsets not mixed in");
}
expect(splitConflict(serializeLayout(base)) === null, 'no markers: null');
expect(splitConflict('<<<<<<< HEAD\n{"a":1}\n=======\n{"a":2}\n') === null, 'markers left open: null');
expect(readConflict('<<<<<<< HEAD\nnot json\n=======\n{}\n>>>>>>> x\n') !== null && 'error' in (readConflict('<<<<<<< HEAD\nnot json\n=======\n{}\n>>>>>>> x\n') as object), 'a side that is not a layout: said');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
