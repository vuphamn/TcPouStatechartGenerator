// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// A POU's layout file (<POU>.machinescope.json beside it, for git): written stable (the same layout, the same bytes,
// whatever order it was built in; whole units; zero moves left out; styles as they are), read back, not taken when it
// is not one or a newer one; nothing to keep: no file. shared/pouLayout.cjs: beside the POU, written only when it
// changed, removed with null, nothing beside another file
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readLayoutFile, writeLayoutFile, layoutPathOf } = require('../../shared/pouLayout.cjs');
/* eslint-enable @typescript-eslint/no-require-imports */
import { isEmptyLayout, layoutFileNameOf, parseLayout, serializeLayout, type PouLayout } from '../../src/utils/pouLayout.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const a: PouLayout = {
  pou: 'SM_TableManager.TcPOU',
  layoutEngine: 'elk',
  states: { TABLEMANAGER_HOMMING: { x: 40.4, y: -12.6 }, TABLEMANAGER_ERROR: { x: 0, y: 0 } },
  transitions: { 'TABLEMANAGER_HOMMING->TABLEMANAGER_ERROR': { x: 12.2, y: 0, labelDx: 5.5 } },
  notes: { nodes: { TABLEMANAGER_HOMMING: '## Homing\nWaits for the reference.' }, edges: {}, styles: { TABLEMANAGER_HOMMING: { strokeWidth: 1.5, fill: '#123' } as never } },
};
// (the same, built in another order)
const b: PouLayout = {
  notes: { styles: { TABLEMANAGER_HOMMING: { fill: '#123', strokeWidth: 1.5 } as never }, edges: {}, nodes: { TABLEMANAGER_HOMMING: '## Homing\nWaits for the reference.' } },
  transitions: { 'TABLEMANAGER_HOMMING->TABLEMANAGER_ERROR': { labelDx: 5.5, y: 0, x: 12.2 } },
  states: { TABLEMANAGER_ERROR: { y: 0, x: 0 }, TABLEMANAGER_HOMMING: { y: -12.6, x: 40.4 } },
  layoutEngine: 'elk',
  pou: 'SM_TableManager.TcPOU',
};
const ta = serializeLayout(a);
expect(ta === serializeLayout(b), 'the same layout in another order: the same text');
const j = JSON.parse(ta);
expect(j.format === 'kval-machinescope-layout' && j.version === 1 && j.states.TABLEMANAGER_HOMMING.x === 40 && j.states.TABLEMANAGER_HOMMING.y === -13 && !('TABLEMANAGER_ERROR' in j.states), `whole units, a state back at its place left out (${JSON.stringify(j.states)})`);
expect(j.notes.styles.TABLEMANAGER_HOMMING.strokeWidth === 1.5, 'a style as it is (not rounded)');
expect(ta.endsWith('\n') && ta.includes('\n  "layoutEngine": "elk"'), 'two-space indents, a last line break');
const back = parseLayout(ta);
expect(!('error' in back) && back.states.TABLEMANAGER_HOMMING.x === 40 && back.transitions['TABLEMANAGER_HOMMING->TABLEMANAGER_ERROR'].labelDx === 6 && back.notes.nodes.TABLEMANAGER_HOMMING.startsWith('## Homing'), 'read back');
expect('error' in parseLayout('{"format":"something-else","version":1}') && 'error' in parseLayout('not json') && 'error' in parseLayout('{"format":"kval-machinescope-layout","version":2}'), 'not one, not JSON, a newer one: not taken');
expect(isEmptyLayout({ states: { X: { x: 0.2, y: 0 } }, transitions: {}, notes: { nodes: {}, edges: {} } }) && !isEmptyLayout(a), 'nothing to keep: empty');
expect(layoutFileNameOf('SM_TableManager.TcPOU') === 'SM_TableManager.machinescope.json', 'its name beside the POU');

// The file beside the POU
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-layout-'));
const pou = path.join(dir, 'SM_TableManager.TcPOU');
fs.writeFileSync(pou, '<POU/>');
expect(layoutPathOf(pou) === path.join(dir, 'SM_TableManager.machinescope.json'), 'beside the POU');
expect(readLayoutFile(pou) === null, 'none yet: null');
expect(writeLayoutFile(pou, ta).written === true && readLayoutFile(pou) === ta, 'written, read back');
expect(writeLayoutFile(pou, ta).written === false, 'the same again: not written');
expect(!fs.readdirSync(dir).some((f: string) => f.endsWith('.tmp')), 'no temp file left');
expect(writeLayoutFile(pou, null).written === true && readLayoutFile(pou) === null, 'removed with null');
let refused = 0;
for (const bad of [path.join(dir, 'E_States.TcDUT'), path.join(dir, 'SM_Missing.TcPOU')]) {
  try {
    writeLayoutFile(bad, '{}');
  } catch {
    refused++;
  }
}
expect(refused === 2, 'not beside another file, nor beside a POU not there');
fs.rmSync(dir, { recursive: true, force: true });

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
