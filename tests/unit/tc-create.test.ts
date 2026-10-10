// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// New TwinCAT objects as XAE writes them (vscode-extension/tcCreate.cjs): a function block, program, function, struct,
// enum, alias, each a file that reads back as that object with its sections and a GUID of its own; a method and a
// property (Get, Set) put into a POU (a name taken refused); a file added to a .plcproj with its folders, once
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { checkName, newPouXml, newDutXml, addMethod, addProperty, addToPlcproj } = require('../../vscode-extension/tcCreate.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseSource, readSection } = require('../../vscode-extension/tcStSource.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const ids = (xml: string) => [...xml.matchAll(/Id="(\{[0-9a-f-]{36}\})"/g)].map((m) => m[1]);

expect(checkName('FB_Cell') === null && !!checkName('2x') && !!checkName('a__b') && !!checkName('a-b'), 'names: letters, digits, single underscores');

const fb = newPouXml('FUNCTION_BLOCK', 'FB_Cell', { extendsName: 'FB_Base' });
const s = parseSource(fb);
expect(s.kind === 'POU' && s.name === 'FB_Cell' && /^FUNCTION_BLOCK FB_Cell EXTENDS FB_Base\r\nVAR_INPUT/.test(readSection(fb, '', 'decl')) && readSection(fb, '', 'impl') === '' && ids(fb).length === 1 && fb.includes('\r\n') && !/[^\r]\n/.test(fb), 'a function block: its declaration (EXTENDS), an empty body, a GUID, CRLF');
expect(/^PROGRAM MAIN2\r\nVAR\r\nEND_VAR/.test(readSection(newPouXml('PROGRAM', 'MAIN2'), '', 'decl')) && /^FUNCTION F_Add : INT\r\nVAR_INPUT/.test(readSection(newPouXml('FUNCTION', 'F_Add', { returnType: 'INT' }), '', 'decl')), 'a program, a function with its return type');
const en = newDutXml('ENUM', 'E_Mode', { members: ['Auto', 'Manual'] });
expect(parseSource(en).kind === 'DUT' && /TYPE E_Mode :\r\n\(\r\n\tAuto := 0,\r\n\tManual\r\n\);/.test(readSection(en, '', 'decl')), 'an enum: its members, the first := 0');
expect(/TYPE ST_Pos :\r\nSTRUCT\r\n\tx : LREAL;\r\nEND_STRUCT/.test(readSection(newDutXml('STRUCT', 'ST_Pos', { members: ['x : LREAL'] }), '', 'decl')) && /TYPE T_Id : DINT;/.test(readSection(newDutXml('ALIAS', 'T_Id', { aliasOf: 'DINT' }), '', 'decl')), 'a struct, an alias');

// A method and a property put into the POU: each a member with its sections, GUIDs of their own
let x = addMethod(fb, 'Run', { returnType: 'BOOL' });
x = addProperty(x, 'Speed', { type: 'LREAL' });
const keys = parseSource(x).members.map((m: { key: string }) => m.key);
expect(JSON.stringify(keys) === JSON.stringify(['', 'Method:Run', 'Property:Speed', 'Property:Speed.Get', 'Property:Speed.Set']), `the members (${keys.join(', ')})`);
expect(/^METHOD Run : BOOL\r\nVAR_INPUT/.test(readSection(x, 'Method:Run', 'decl')) && readSection(x, 'Property:Speed', 'decl') === 'PROPERTY Speed : LREAL' && new Set(ids(x)).size === 5, 'their declarations, five GUIDs, all different');
expect((() => { try { addMethod(x, 'speed'); return false; } catch { return true; } })(), 'a name taken (any case): refused');
expect(x.startsWith(fb.slice(0, fb.indexOf('</POU>'))) && x.trimEnd().endsWith('</TcPlcObject>'), 'the POU itself as it was, the members before </POU>');

// The .plcproj: the file and its folders, once
const proj = '<?xml version="1.0" encoding="utf-8"?>\r\n<Project>\r\n  <ItemGroup>\r\n    <Compile Include="POUs\\MAIN.TcPOU">\r\n      <SubType>Code</SubType>\r\n    </Compile>\r\n  </ItemGroup>\r\n  <ItemGroup>\r\n    <Folder Include="POUs" />\r\n  </ItemGroup>\r\n</Project>\r\n';
const p2 = addToPlcproj(proj, 'POUs/Cell/FB_Cell.TcPOU');
expect(/<Compile Include="POUs\\MAIN\.TcPOU">[\s\S]*<Compile Include="POUs\\Cell\\FB_Cell\.TcPOU">\r\n      <SubType>Code<\/SubType>\r\n    <\/Compile>/.test(p2), 'the file, after the others');
expect(/<Folder Include="POUs" \/>\r\n    <Folder Include="POUs\\Cell" \/>/.test(p2) && (p2.match(/Folder Include="POUs"/g) ?? []).length === 1, 'its new folder (POUs\\Cell), POUs not twice');
expect(addToPlcproj(p2, 'POUs\\Cell\\FB_Cell.TcPOU') === p2, 'added again: unchanged');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
