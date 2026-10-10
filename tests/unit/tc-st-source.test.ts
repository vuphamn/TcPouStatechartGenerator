// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The VS Code extension's TwinCAT files as Structured Text (vscode-extension/tcStSource.cjs, sectionStore.cjs): a
// .TcPOU's sections (its declaration and implementation, each method's, a property's Get / Set, an action's), a
// .TcDUT's declaration; a section written back changes only its CDATA text (the Ids, line ids, BOM and CRLF kept);
// "]]>" refused; each section's time changes only with its own text (no "the file is newer" for another section's
// unsaved edits); a change on disk found for the sections it touched
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseSource, readSection, writeSection, memberTitle } = require('../../vscode-extension/tcStSource.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createSectionStore, sectionAddress, addressOf } = require('../../vscode-extension/sectionStore.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pou, dut } = require('../fixtures/third-party-pou.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// A POU with a property (Get / Set) and an action too, CRLF and a BOM, as XAE writes it
const extra = `    <Property Name="Speed" Id="{11111111-0000-0000-0000-000000000001}">
      <Declaration><![CDATA[PROPERTY Speed : REAL]]></Declaration>
      <Get Name="Get" Id="{11111111-0000-0000-0000-000000000002}">
        <Declaration><![CDATA[VAR
END_VAR]]></Declaration>
        <Implementation>
          <ST><![CDATA[Speed := _Speed;]]></ST>
        </Implementation>
      </Get>
      <Set Name="Set" Id="{11111111-0000-0000-0000-000000000003}">
        <Declaration><![CDATA[VAR
END_VAR]]></Declaration>
        <Implementation>
          <ST><![CDATA[_Speed := Speed;]]></ST>
        </Implementation>
      </Set>
    </Property>
    <Action Name="ResetAll" Id="{11111111-0000-0000-0000-000000000004}">
      <Implementation>
        <ST><![CDATA[_Count := 0;]]></ST>
      </Implementation>
    </Action>
    <Action Name="Sequence" Id="{11111111-0000-0000-0000-000000000005}">
      <Implementation>
        <SFC><![CDATA[]]></SFC>
      </Implementation>
    </Action>
  </POU>`;
const xml = '﻿' + pou.replace(/\r?\n/g, '\n').replace(/  <\/POU>/, extra).replace(/\n/g, '\r\n');

const s = parseSource(xml);
const keys = s.members.map((m: { key: string }) => m.key);
expect(s.kind === 'POU' && s.name === 'FB_ScanSequencer', `the POU (${s.kind} ${s.name})`);
expect(['', 'Method:Execute', 'Method:MoveAndAdvance', 'Property:Speed', 'Property:Speed.Get', 'Property:Speed.Set', 'Action:ResetAll'].every((k) => keys.includes(k)), `its members (${keys.join(', ')})`);
const body = s.members[0];
expect(/^FUNCTION_BLOCK FB_ScanSequencer/m.test(body.decl.text) && !!body.impl, 'the POU: its declaration (FUNCTION_BLOCK …) and its implementation');
expect(/CASE State OF/.test(readSection(xml, 'Method:Execute', 'impl')) && /^METHOD Execute/m.test(readSection(xml, 'Method:Execute', 'decl')), "Execute(): its declaration and its implementation (CASE State OF)");
expect(readSection(xml, 'Property:Speed.Get', 'impl') === 'Speed := _Speed;' && readSection(xml, 'Property:Speed', 'decl') === 'PROPERTY Speed : REAL', "the property's declaration, its Get's implementation");
expect(readSection(xml, 'Action:ResetAll', 'decl') === null && readSection(xml, 'Action:ResetAll', 'impl') === '_Count := 0;', 'an action: its implementation only');
const sfc = s.members.find((m: { key: string }) => m.key === 'Action:Sequence');
expect(sfc?.implLanguage === 'SFC' && !sfc.impl, `a graphical implementation: its language, no text (${sfc?.implLanguage})`);
expect(memberTitle(s.members.find((m: { key: string }) => m.key === 'Method:Execute')) === 'Execute()' && memberTitle(s.members.find((m: { key: string }) => m.key === 'Property:Speed.Get')) === 'FB_ScanSequencer.Speed (Get)', 'the members as listed');

// Written back: only that CDATA's text
const newImpl = '// edited\r\n' + readSection(xml, 'Method:Execute', 'impl');
const written = writeSection(xml, 'Method:Execute', 'impl', newImpl);
expect(written.replace('// edited\r\n', '') === xml && written.startsWith('﻿') && readSection(written, 'Method:Execute', 'impl') === newImpl, 'written back: only that text changed (the BOM, Ids, the rest the same)');
expect((() => { try { writeSection(xml, 'Method:Execute', 'impl', 'x ]]> y'); return false; } catch { return true; } })(), '"]]>" refused');
expect((() => { try { writeSection(xml, 'Action:ResetAll', 'decl', 'x'); return false; } catch { return true; } })(), 'a section the file has not: refused');

// The DUT
const d = parseSource(dut);
expect(d.kind === 'DUT' && d.members.length === 1 && /TYPE E_ScanState/.test(d.members[0].decl.text) && !d.members[0].impl, 'the DUT: its declaration only');

// The section store: each section's time its own
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-st-'));
const file = path.join(dir, 'FB_ScanSequencer.TcPOU');
fs.writeFileSync(file, xml, 'utf8');
let clock = 1000;
const store = createSectionStore({ now: () => clock });
const decl = { file, key: '', section: 'decl' };
const impl = { file, key: '', section: 'impl' };
const t0d = store.stat(decl).mtime;
const t0i = store.stat(impl).mtime;
clock = 2000;
const t1d = store.write(decl, store.stat(decl).text + '\r\n// more');
expect(t1d > t0d && store.stat(impl).mtime === t0i, `writing the declaration: its time only (decl ${t0d}→${t1d}, impl ${t0i}→${store.stat(impl).mtime})`);
const onDisk = fs.readFileSync(file, 'utf8');
expect(onDisk.startsWith('﻿') && readSection(onDisk, '', 'decl').endsWith('// more') && onDisk.replace('\r\n// more', '') === xml, 'on disk: the BOM kept, only the declaration changed');
// (a change on disk, the implementation: found for it, not for the declaration)
clock = 3000;
fs.writeFileSync(file, writeSection(onDisk, '', 'impl', 'Execute();'), 'utf8');
const changed = store.changedIn(file).map((a: { section: string }) => a.section);
expect(JSON.stringify(changed) === '["impl"]' && store.stat(impl).mtime > t0i && store.stat(decl).mtime === t1d, `a change on disk: the implementation's (${JSON.stringify(changed)})`);
// (the address: its tab title and back)
const a = sectionAddress({ file, key: 'Method:Execute', section: 'impl' }, s.members);
const back = addressOf(a.query);
expect(a.path === '/FB_ScanSequencer/FB_ScanSequencer.Execute (Impl).st' && back.file.toLowerCase() === file.toLowerCase() && back.key === 'Method:Execute' && back.section === 'impl', `the address (${a.path})`);
fs.rmSync(dir, { recursive: true, force: true });

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
