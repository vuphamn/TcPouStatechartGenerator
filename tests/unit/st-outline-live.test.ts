// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The VS Code extension's outline of a Structured Text section (vscode-extension/stOutline.cjs), the names it shows
// live values for and their text (liveText.cjs), and Rename by the name's declaration (stReferences.renameEdits): a
// method's local in that method only, a POU's variable in the POU and the POUs that extend it, an enum member
// everywhere; a TwinCAT object's name, a keyword, a name already declared: refused
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { declarationOutline, implementationOutline } = require('../../vscode-extension/stOutline.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { watchNames, valueText } = require('../../vscode-extension/liveText.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createIndex, renameEdits } = require('../../vscode-extension/stReferences.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readSection } = require('../../vscode-extension/tcStSource.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pou, dut } = require('../fixtures/third-party-pou.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
type Sym = { name: string; kind: string; detail: string; children: Sym[] };
const tree = (l: Sym[], d = 0): string[] => l.flatMap((s) => [`${'  '.repeat(d)}${s.kind} ${s.name}${s.detail ? ` : ${s.detail}` : ''}`, ...tree(s.children, d + 1)]);

// Outline: the FB, its VAR blocks and variables
const decl = declarationOutline(readSection(pou, '', 'decl'));
const t = tree(decl);
expect(t[0] === 'class FB_ScanSequencer : FUNCTION_BLOCK' && t.includes('  namespace VAR_OUTPUT') && t.includes('    variable State : E_ScanState') && t.includes('    variable _Count : INT'), `the declaration: the FB, its blocks, its variables (${t.slice(0, 6).join(' | ')})`);
// (a method's: its header, its parameter)
const md = tree(declarationOutline(readSection(pou, 'Method:MoveAndAdvance', 'decl')));
expect(md[0].startsWith('method MoveAndAdvance') && md.some((l) => /variable NextState : E_ScanState/.test(l)), `a method's declaration (${md.join(' | ')})`);
// (the enum: its members under it)
const en = tree(declarationOutline(readSection(dut, '', 'decl')));
expect(en[0] === 'enum E_ScanState : ENUM' && en.filter((l) => /^ {2}enumMember /.test(l)).length === 6, `the enum and its members (${en.slice(0, 3).join(' | ')})`);
// Outline: the implementation's CASE branches (the states), a nested CASE's under its branch
const impl = implementationOutline('CASE State OF\n\tE_ScanState.InitializeScan:\n\t\tState := E_ScanState.ResetData;\n\tE_ScanState.ResetData:\n\t\tCASE iStep OF\n\t\t\t0: iStep := 1;\n\t\t\t1, 2: ;\n\t\tEND_CASE\nEND_CASE');
const it = tree(impl);
expect(JSON.stringify(it) === JSON.stringify(['enumMember InitializeScan : E_ScanState', 'enumMember ResetData : E_ScanState', '  enumMember 0', '  enumMember 1, 2']), `the implementation: its states, a nested CASE under its branch (${it.join(' | ')})`);

// Live values: the names shown (not keywords, labels, calls, named arguments), the value as text
const names = watchNames('CASE State OF\n\tE_ScanState.ResetData:\n\t\tIF fbAxis.bDone AND NOT Busy THEN // Busy\n\t\t\tfbTimer(IN := TRUE, PT := tWait);\n\t\tEND_IF\nEND_CASE').map((n: { path: string; uses: unknown[] }) => `${n.path}x${n.uses.length}`);
expect(JSON.stringify(names) === JSON.stringify(['Statex1', 'fbAxis.bDonex1', 'Busyx1', 'tWaitx1']), `the names shown (${names.join(', ')})`);
expect([true, 7, 2.5, 1 / 3, 'ab', 3].map((v) => valueText(v, { enumNames: v === 3 ? { 3: 'FastScan' } : null })).join('|') === "TRUE|7|2.5|0.333333|'ab'|FastScan", 'the values as text (TRUE, numbers, a string, an enum by name)');

// Rename by declaration
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-rename-'));
fs.mkdirSync(path.join(root, 'PLC'), { recursive: true });
fs.writeFileSync(path.join(root, 'Cell.tsproj'), '<TcSmProject/>');
const pouFile = path.join(root, 'PLC', 'FB_ScanSequencer.TcPOU');
fs.writeFileSync(pouFile, pou);
fs.writeFileSync(path.join(root, 'PLC', 'E_ScanState.TcDUT'), dut);
// (another POU that extends it, and one that only has a local of the same name)
const derived = pou.replace(/FB_ScanSequencer/g, 'FB_FastSequencer').replace('FUNCTION_BLOCK FB_FastSequencer', 'FUNCTION_BLOCK FB_FastSequencer EXTENDS FB_ScanSequencer');
fs.writeFileSync(path.join(root, 'PLC', 'FB_FastSequencer.TcPOU'), derived);
const files = createIndex().project(root);
type Edit = { file: string; key: string; apart: boolean };
const r1 = renameEdits(files, { file: pouFile, key: 'Method:MoveAndAdvance', name: 'NextState' }, 'Target');
expect(!r1.error && r1.scope === 'member' && r1.edits.every((e: Edit) => e.key === 'Method:MoveAndAdvance' && path.basename(e.file) === 'FB_ScanSequencer.TcPOU'), `a method's parameter: in that method only (${r1.error ?? `${r1.edits.length} edits`})`);
const r2 = renameEdits(files, { file: pouFile, key: 'Method:Execute', name: '_Count' }, '_Passes');
const where2 = [...new Set(r2.edits?.map((e: Edit) => path.basename(e.file)) ?? [])].sort();
expect(!r2.error && r2.scope === 'pou' && JSON.stringify(where2) === JSON.stringify(['FB_FastSequencer.TcPOU', 'FB_ScanSequencer.TcPOU']), `a POU's variable: the POU and the one that extends it (${r2.error ?? where2.join(', ')})`);
const r3 = renameEdits(files, { file: pouFile, key: 'Method:Execute', name: 'FastScan', qualifier: 'E_ScanState' }, 'QuickScan');
expect(!r3.error && r3.scope === 'project' && r3.edits.some((e: Edit) => path.basename(e.file) === 'E_ScanState.TcDUT'), `an enum member: everywhere, its .TcDUT too (${r3.error ?? r3.edits.length})`);
for (const [name, to, why] of [['Execute', 'Run', /a method/], ['FB_ScanSequencer', 'FB_X', /name of FB_ScanSequencer\.TcPOU/], ['_Count', 'IF', /keyword/], ['_Count', 'State', /already declared/], ['_Count', '2x', /not a Structured Text name/]] as const) {
  const r = renameEdits(files, { file: pouFile, key: 'Method:Execute', name }, to);
  expect(!!r.error && why.test(r.error), `${name} → ${to}: refused (${r.error})`);
}
fs.rmSync(root, { recursive: true, force: true });

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
