// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// This round's logic: pause conditions as expressions (pauseOnState.ts), the Method Editor's blame (methodBlame.ts),
// the timeline's recording lane and exports (StateTimeline.tsx), git blame's output (shared/gitHistory.cjs), new
// files in a PLC project (shared/plcAddFiles.cjs), the events kept beside the project (shared/eventsFile.cjs), the
// TcUnit program (tcunitTest.ts)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { conditionMetIn, isPauseCondition, parsePauseCondition, replayConditionStopIn, type PauseCondition } from '../../src/utils/pauseOnState.ts';
import { methodBlame } from '../../src/utils/methodBlame.ts';
import { laneSegments, recordingLane, timelineCsv, timelineSvg } from '../../src/components/StateTimeline.tsx';
import { generateTcUnitProgram, testInstanceName } from '../../src/utils/tcunitTest.ts';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseBlame } = require('../../shared/gitHistory.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { addPlcFiles, mergeTestProgram } = require('../../shared/plcAddFiles.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { saveEventsFile } = require('../../shared/eventsFile.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// ---- Pause conditions as expressions ----
const simple = parsePauseCondition('bError = TRUE') as PauseCondition;
const expr = parsePauseCondition('nCount > 3 AND bOn') as PauseCondition;
expect(!simple.expr && simple.id === 'berror', 'a simple condition: as before');
expect(!!expr.expr && JSON.stringify(expr.ids) === '["ncount","bon"]' && expr.text === 'nCount > 3 AND bOn', `an expression: its variables ${JSON.stringify(expr.ids)}`);
expect(isPauseCondition('bA AND NOT bB') && isPauseCondition('n >= 2') && !isPauseCondition('TABLEMANAGER_IDLE'), 'a condition or a state');
expect('error' in parsePauseCondition('nCount > (') && 'error' in parsePauseCondition('TRUE AND FALSE'), 'a wrong one or one reading no variable: said');
const met = conditionMetIn([{ id: 'bon', v: true }, { id: 'ncount', v: 2 }, { id: 'ncount', v: 4 }], [expr], {});
expect(met === expr, 'live: met when both are (at nCount 4, bOn TRUE)');
expect(conditionMetIn([{ id: 'ncount', v: 5 }], [expr], { ncount: 4, bon: true }) === null, 'an edge: not again while it stays met');
const stop = replayConditionStopIn([{ id: 'bon', t: 1, v: true }, { id: 'ncount', t: 5, v: 1 }, { id: 'ncount', t: 9, v: 7 }], 2, 20, [expr]);
expect(stop?.t === 9, `a replay stops where it became met (${stop?.t})`);

// ---- Blame matched to a method's lines ----
const file = ['<POU>', '<Method Name="doState" Id="{1}">', '<Declaration><![CDATA[METHOD doState]]></Declaration>', '<Implementation>', '<ST><![CDATA[a := 1;', 'b := 2;', 'c := 3;]]></ST>', '</Implementation>', '</Method>'];
const blame = file.map((text, i) => ({ hash: i === 5 ? '0000000' : i === 6 ? 'bbbbbbb' : 'aaaaaaa', author: i === 6 ? 'Ann' : 'Bob', date: i === 6 ? '2026-10-02' : '2026-10-01', summary: 's', text }));
const m = methodBlame(blame, 'doState', 'a := 1;\nb := 2;\nc := 4;');
expect(!('error' in m) && m.get(1)?.hash === 'aaaaaaa' && m.get(1)?.age === 0 && /Bob · 2026-10-01/.test(m.get(1)!.title), 'blame: the first line (on the CDATA line) by its commit, the oldest');
expect(!('error' in m) && m.get(2)?.title === 'Not committed yet' && m.get(3)?.title === 'Changed here: not saved yet', 'not committed; changed here');
expect('error' in methodBlame(blame, 'other', 'x'), 'a method not in the file: said');

// ---- The timeline: a recording's lane, CSV, SVG ----
const names: Record<number, string> = { 0: 'IDLE', 1: 'RUN' };
const lane = recordingLane('night', [{ t: 100, value: 0 }, { t: 150, value: 0 }, { t: 300, value: 1 }, { t: 700, value: 1 }], (v) => names[v], 1000);
const segs = laneSegments(lane, 99999);
expect(segs.map((s) => `${s.state}:${s.from}-${s.to}`).join(' ') === 'IDLE:1100-1300 RUN:1300-1700', `a recording's lane, moved, ending at its last sample (${segs.map((s) => `${s.state}:${s.from}-${s.to}`).join(' ')})`);
const csv = timelineCsv([lane], 99999, 0, 1500);
expect(csv.split('\n').length === 3 && /^night;RUN;.*;400$/m.test(csv), `the window's stays as CSV (the RUN stay cut by the window? its own length kept: ${csv.split('\n')[2]})`);
expect(/^<svg[\s\S]*IDLE[\s\S]*<\/svg>$/.test(timelineSvg([lane], 99999, 1000, 1800)), 'the timeline as SVG');

// ---- git blame's output ----
const porcelain = ['1111111111111111111111111111111111111111 1 1 1', 'author Ann', 'author-time 1760000000', 'summary first', 'filename x', '\tline one', '0000000000000000000000000000000000000000 2 2 1', 'author Not Committed Yet', 'author-time 1760100000', 'summary Version of x', 'filename x', '\t\tline two'].join('\n');
const parsed = parseBlame(porcelain);
expect(parsed.length === 2 && parsed[0].hash === '1111111' && parsed[0].date === '2025-10-09' && parsed[1].text === '\tline two', `git blame read: ${JSON.stringify(parsed[0])}`);

// ---- New files in a PLC project; the test program merged; the events kept ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-add-'));
try {
  fs.mkdirSync(path.join(dir, 'POUs'));
  fs.writeFileSync(path.join(dir, 'P.plcproj'), '<Project>\r\n  <ItemGroup>\r\n    <Compile Include="POUs\\MAIN.TcPOU">\r\n      <SubType>Code</SubType>\r\n    </Compile>\r\n  </ItemGroup>\r\n</Project>\r\n');
  const pou = path.join(dir, 'POUs', 'MAIN.TcPOU');
  fs.writeFileSync(pou, '<x/>');
  const suite = (n: string) => ({ name: `${n}.TcPOU`, content: `<x>// generated by Kval MachineScope ${n}</x>` });
  const r1 = addPlcFiles(pou, { folder: 'KssTests', files: [suite('FB_A_Test'), { name: 'PRG_KssTests.TcPOU', content: generateTcUnitProgram(['FB_A_Test']) }] });
  const r2 = addPlcFiles(pou, { folder: 'KssTests', files: [suite('FB_B_Test'), { name: 'PRG_KssTests.TcPOU', content: generateTcUnitProgram(['FB_B_Test']) }] });
  const proj = fs.readFileSync(path.join(dir, 'P.plcproj'), 'utf8');
  const prg = fs.readFileSync(path.join(dir, 'KssTests', 'PRG_KssTests.TcPOU'), 'utf8');
  expect(r1.ok && r2.ok && !r1.tcunit && proj.includes('<Compile Include="KssTests\\FB_B_Test.TcPOU">') && proj.includes('<Folder Include="KssTests" />'), 'the files written, listed in the .plcproj with their folder');
  expect(prg.includes(`${testInstanceName('FB_A_Test')} : FB_A_Test;`) && prg.includes(`${testInstanceName('FB_B_Test')} : FB_B_Test;`) && (prg.match(/TcUnit\.RUN\(\);/g) ?? []).length === 1, 'the test program keeps the first suite when a second comes');
  fs.writeFileSync(path.join(dir, 'KssTests', 'FB_C_Test.TcPOU'), '<mine/>');
  const r3 = addPlcFiles(pou, { folder: 'KssTests', files: [{ name: 'FB_C_Test.TcPOU', content: 'x' }] });
  expect(!r3.ok && fs.readFileSync(path.join(dir, 'KssTests', 'FB_C_Test.TcPOU'), 'utf8') === '<mine/>', `someone's own file: not replaced (${r3.error})`);
  expect(!addPlcFiles(pou, { folder: '../up', files: [suite('FB_D_Test')] }).ok && !addPlcFiles(pou, { folder: 'KssTests', files: [{ name: '../x.TcPOU', content: '' }] }).ok, 'no path outside the folder');
  expect(mergeTestProgram(prg, generateTcUnitProgram(['FB_A_Test'])) === prg, 'a suite there already: the program unchanged');
  const ev = saveEventsFile(pou, { name: 'SM_X_2026-10-12-08-30.csv', csv: 'time;kind;event\n' });
  expect(ev.ok && fs.readFileSync(path.join(dir, 'MachineScope.events', 'SM_X_2026-10-12-08-30.csv'), 'utf8') === '﻿time;kind;event\n', 'the events kept in MachineScope.events (Excel: a BOM)');
  expect(!saveEventsFile(pou, { name: '..\\x.csv', csv: '' }).ok && !saveEventsFile(pou, { name: 'x.exe', csv: '' }).ok, 'only a CSV name, no path');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
