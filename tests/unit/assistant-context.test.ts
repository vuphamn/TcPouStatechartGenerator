// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The statechart's selection for AI assistants: its Markdown (assistantContext.ts); a folder set up for it, CLAUDE.md's
// section (put in, replaced, the rest kept), the selection written only there (vscode-extension/assistantSetup.cjs)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assistantContextMarkdown } from '../../src/utils/assistantContext.ts';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setupFolder, upsertSection, writeSelection, isSetUp, START, END } = require('../../vscode-extension/assistantSetup.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// ---- The Markdown ----
const md = assistantContextMarkdown({
  pou: 'EFX',
  layoutFile: 'EFX.machinescope.json',
  method: 'doState',
  stateVar: 'machineState',
  enumType: 'E_EFX_States',
  state: { id: 'EFX_CONFIG_POSITION_SET', description: 'Config position set' },
  branch: { line: 41, code: ['\tE_EFX_States.EFX_CONFIG_POSITION_SET:', '\t\tIF bFirstPass THEN', '\t\t\tmachineState := E_EFX_States.EFX_ERROR;', '\t\tEND_IF'] },
  outgoing: [{ to: 'EFX_ERROR', condition: 'bFirstPass AND NOT bOk', priority: 1 }, { to: 'EFX_IDLE', priority: 2 }],
  incoming: [{ from: 'EFX_CONFIG_SETUP', condition: 'bDone' }],
  documentation: 'Moves the servo.\n\n- step 1',
  problems: ['EFX_CONFIG_POSITION_SET has  no line'],
  live: { connected: true, state: 'EFX_CONFIG_POSITION_SET', sinceMs: 4200, plc: '5.1.2.3.1.1:851' },
  now: new Date(Date.UTC(2026, 9, 14, 8)),
});
expect(md.startsWith('# MachineScope selection\n\nUpdated: 2026-10-14T08:00:00.000Z') && md.includes('**Selected state:** `EFX_CONFIG_POSITION_SET`') && md.includes('file `%POU_PATH%`') && md.includes('`CASE machineState OF` in `doState()`') && md.includes('`E_EFX_States.EFX_CONFIG_POSITION_SET`'), 'the state, its POU (path left to the extension), its state machine');
expect(md.includes("**Description** (its line in `getStateDescription()`): 'Config position set'") && md.includes('`EFX.machinescope.json` → `notes.nodes["EFX_CONFIG_POSITION_SET"]`): below') && md.includes('## Its documentation\n\nMoves the servo.\n\n- step 1'), 'its description and documentation (where they are kept)');
expect(md.includes('from line 41 of its implementation') && md.includes('```st\n\tE_EFX_States.EFX_CONFIG_POSITION_SET:\n\t\tIF bFirstPass THEN') && md.includes('1. → `EFX_ERROR` when `bFirstPass AND NOT bOk`') && md.includes('2. → `EFX_IDLE` when always (no condition)') && md.includes('- `EFX_CONFIG_SETUP` → when `bDone`'), 'its code, its transitions out in order and in');
expect(md.includes('- EFX_CONFIG_POSITION_SET has no line') && md.includes('the PLC is in `EFX_CONFIG_POSITION_SET` for 4 s (this state)'), 'its problems; live');
const none = assistantContextMarkdown({ pou: 'EFX', layoutFile: 'EFX.machinescope.json', method: 'doState', stateVar: 'machineState', enumType: 'E', state: null, branch: null, outgoing: [], incoming: [], documentation: '', problems: [] });
expect(/No state selected: select one in the statechart, or ask which state is meant\./.test(none), 'none selected: said');
const bare = assistantContextMarkdown({ pou: 'EFX', layoutFile: 'x.json', method: 'doState', stateVar: 'machineState', enumType: 'E', state: { id: 'S_X' }, branch: null, outgoing: [], incoming: [], documentation: '', problems: [] });
expect(bare.includes('none yet') && bare.includes('No CASE branch') && bare.includes('None: no other state leads to it.') && bare.includes('_None yet._'), 'nothing known: said so');

// ---- The folder ----
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-assistant-'));
try {
  const pou = path.join(root, 'POUs', 'EFX', 'EFX.TcPOU');
  expect(!isSetUp(root) && writeSelection(root, pou, 'x') === false && !fs.existsSync(path.join(root, '.machinescope')), 'not set up: nothing written');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# EFX\n\nOur own notes.\n');
  const r = setupFolder(root);
  const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  expect(r.updated && !r.created && claude.startsWith('# EFX\n\nOur own notes.\n\n<!-- kval-machinescope:start') && claude.includes(END) && claude.includes('.machinescope/selection.md') && claude.includes('"notes": { "nodes": { "<STATE>": "<markdown>" } }') && claude.includes("write a quote as `$'`"), 'CLAUDE.md: the section added after its own text');
  expect(fs.readFileSync(path.join(root, '.machinescope', '.gitignore'), 'utf8').includes('\n*\n') && /No state selected yet/.test(fs.readFileSync(path.join(root, '.machinescope', 'selection.md'), 'utf8')), '.machinescope/: git-ignored, a first selection');
  // (set up again: the section replaced, not added twice; the rest kept)
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), claude.replace('## TwinCAT project and Kval MachineScope', '## old heading') + '\n## After\n');
  setupFolder(root);
  const again = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  expect(again.split(START.slice(0, 32)).length === 2 && !again.includes('## old heading') && again.includes('## After') && again.includes('Our own notes.'), 'set up again: the section replaced once, the rest kept');
  expect(upsertSection(null).startsWith('<!-- kval-machinescope:start') && upsertSection('').startsWith('<!-- kval-machinescope:start'), 'no CLAUDE.md: the section alone');
  expect(writeSelection(root, pou, '# MachineScope selection\n\nfile `%POU_PATH%`\n') && fs.readFileSync(path.join(root, '.machinescope', 'selection.md'), 'utf8') === '# MachineScope selection\n\nfile `POUs/EFX/EFX.TcPOU`\n', 'the selection written, its POU path made relative');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
