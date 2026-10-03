// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The notes in the exported Mermaid text (Mermaid Live, the code view, copies): a state's note beside its state (its
// colour), a transition's too; a free note (the palette's Note, of no state: note_<time>) left out, nothing of it in
// the text (no box of its id, no link to it); only free notes: the text as it was
import { applyNotesToMermaid, isFreeNoteId } from '../../src/utils/diagramNotes.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const chart = ['flowchart TD', '    IDLE["Idle"]', '    RUN["Run"]', '    IDLE -->|"start"| RUN', ''].join('\n');
const notes = {
  nodes: { IDLE: 'Waits for start', note_muj1hbvi: 'ttftfy', note_muj1j3hd: 'tdxh' },
  edges: {},
  styles: { note_muj1hbvi: { fill: '#8b1a2b' }, IDLE: { fill: '#123456' } },
  positions: { note_muj1hbvi: { x: 400, y: 10 } },
} as never;
const out = applyNotesToMermaid(chart, notes);
expect(/note_IDLE\[/.test(out) && out.includes('Waits for start') && /IDLE ~~~ note_IDLE/.test(out) && out.includes('fill:#123456'), "a state's note: beside its state, its colour");
expect(!/muj1hbvi|muj1j3hd/.test(out) && !out.includes('ttftfy') && !out.includes('tdxh') && !out.includes('#8b1a2b'), `free notes: left out (${out.split('\n').filter((l) => /note_/.test(l)).join(' | ')})`);
expect(applyNotesToMermaid(chart, { nodes: { note_muj1hbvi: 'ttftfy' }, edges: {} } as never) === chart, 'only free notes: the text as it was');
const sd = applyNotesToMermaid(['stateDiagram-v2', '    IDLE --> RUN', ''].join('\n'), notes);
expect(/note right of IDLE/.test(sd) && !sd.includes('ttftfy') && !/muj1/.test(sd), 'stateDiagram-v2: the same');
expect(isFreeNoteId('note_muj1hbvi') && !isFreeNoteId('IDLE'), 'a free note told by its id');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
