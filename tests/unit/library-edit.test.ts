// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The Library Manager's edits (vscode-extension/libraryEdit.cjs), as XAE's: a placeholder's version (its default, its
// resolution; * drops the resolution), a library at a version, a library removed (its resolution too, an emptied
// ItemGroup gone), one added beside the others in name order (or in a new ItemGroup), already referenced: refused; line
// ends, indentation and the BOM kept; the libraries installed in a repository
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { installedLibraries, setLibraryVersion, removeLibrary, addLibrary, editPlcproj } = require('../../vscode-extension/libraryEdit.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readLibraries } = require('../../vscode-extension/plcTree.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const V = 'Beckhoff Automation GmbH';

const xml = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<Project DefaultTargets="Build">',
  '  <ItemGroup>',
  '    <Compile Include="POUs\\MAIN.TcPOU" />',
  '  </ItemGroup>',
  '  <ItemGroup>',
  '    <PlaceholderReference Include="Tc2_Standard">',
  `      <DefaultResolution>Tc2_Standard, * (${V})</DefaultResolution>`,
  '      <Namespace>Tc2_Standard</Namespace>',
  '    </PlaceholderReference>',
  '    <PlaceholderReference Include="Tc2_System">',
  `      <DefaultResolution>Tc2_System, * (${V})</DefaultResolution>`,
  '      <Namespace>Tc2_System</Namespace>',
  '    </PlaceholderReference>',
  `    <LibraryReference Include="Tc2_MC2, 3.3.40.0 (${V})">`,
  '      <Namespace>Tc2_MC2</Namespace>',
  '    </LibraryReference>',
  '  </ItemGroup>',
  '  <ItemGroup>',
  '    <PlaceholderResolution Include="Tc2_System">',
  `      <Resolution>Tc2_System, 3.4.25.0 (${V})</Resolution>`,
  '    </PlaceholderResolution>',
  '  </ItemGroup>',
  '</Project>',
  '',
].join('\r\n');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-libedit-'));
const plcproj = path.join(root, 'Plc.plcproj');
const libs = () => Object.fromEntries((readLibraries(plcproj, { repositories: [] }) as { name: string; version: string; pinned: boolean }[]).map((l) => [l.name, l.version]));
const write = (s: string) => fs.writeFileSync(plcproj, `﻿${s}`);
const std = { name: 'Tc2_Standard', vendor: V, placeholder: 'Tc2_Standard' };
const sys = { name: 'Tc2_System', vendor: V, placeholder: 'Tc2_System' };
const mc2 = { name: 'Tc2_MC2', vendor: V, placeholder: null };

// 1. Versions
write(xml);
editPlcproj(plcproj, (x: string) => setLibraryVersion(x, std, '3.3.3.0'));
editPlcproj(plcproj, (x: string) => setLibraryVersion(x, sys, '3.4.26.0'));
editPlcproj(plcproj, (x: string) => setLibraryVersion(x, mc2, '3.3.42.0'));
let l = libs();
expect(l.Tc2_Standard === '3.3.3.0' && l.Tc2_System === '3.4.26.0' && l.Tc2_MC2 === '3.3.42.0', `set: a placeholder's default, a resolution, a library at a version (${JSON.stringify(l)})`);
let raw = fs.readFileSync(plcproj, 'utf8');
expect(raw.charCodeAt(0) === 0xfeff && !/[^\r]\n/.test(raw.slice(1)), 'the BOM and the CRLF line ends kept');
editPlcproj(plcproj, (x: string) => setLibraryVersion(x, sys, '*'));
raw = fs.readFileSync(plcproj, 'utf8');
expect(libs().Tc2_System === '*' && !/PlaceholderResolution/.test(raw) && !/<ItemGroup>\s*<\/ItemGroup>/.test(raw), 'the newest (*): its resolution dropped, the emptied ItemGroup gone');
let threw = '';
try { setLibraryVersion(xml, std, 'latest'); } catch (e) { threw = (e as Error).message; }
expect(/Not a version/.test(threw), 'not a version: refused');

// 2. Removed
write(xml);
editPlcproj(plcproj, (x: string) => removeLibrary(x, sys));
editPlcproj(plcproj, (x: string) => removeLibrary(x, mc2));
raw = fs.readFileSync(plcproj, 'utf8');
l = libs();
expect(Object.keys(l).join() === 'Tc2_Standard' && !/Tc2_System|Tc2_MC2/.test(raw) && /<Compile Include/.test(raw), `removed: the placeholder with its resolution, a library reference (${Object.keys(l).join()})`);

// 3. Added: beside the others in name order; in a new ItemGroup when there are none; twice: refused
write(xml);
editPlcproj(plcproj, (x: string) => addLibrary(x, { name: 'Tc2_Utilities', vendor: V }));
editPlcproj(plcproj, (x: string) => addLibrary(x, { name: 'Tc2_EtherCAT', vendor: V, version: '3.3.17.0' }));
raw = fs.readFileSync(plcproj, 'utf8');
l = libs();
const order = [...raw.matchAll(/<PlaceholderReference Include="([^"]+)"/g)].map((m) => m[1]).join();
expect(l.Tc2_Utilities === '*' && l.Tc2_EtherCAT === '3.3.17.0' && order === 'Tc2_EtherCAT,Tc2_Standard,Tc2_System,Tc2_Utilities', `added in name order (${order})`);
expect(/\r\n    <PlaceholderReference Include="Tc2_Utilities">\r\n      <DefaultResolution>Tc2_Utilities, \* \(Beckhoff Automation GmbH\)<\/DefaultResolution>\r\n      <Namespace>Tc2_Utilities<\/Namespace>\r\n    <\/PlaceholderReference>\r\n/.test(raw), 'as XAE writes it: indented, CRLF');
threw = '';
try { addLibrary(raw, { name: 'tc2_standard', vendor: V }); } catch (e) { threw = (e as Error).message; }
expect(/already referenced/.test(threw), 'already referenced: refused');
const bare = addLibrary('<Project>\n  <ItemGroup>\n    <Compile Include="A.TcPOU" />\n  </ItemGroup>\n</Project>\n', { name: 'Tc2_Standard', vendor: V });
expect(/<\/ItemGroup>\n  <ItemGroup>\n    <PlaceholderReference Include="Tc2_Standard">[\s\S]*<\/PlaceholderReference>\n  <\/ItemGroup>\n<\/Project>/.test(bare), `none yet: a new ItemGroup (${JSON.stringify(bare.slice(-200))})`);

// 4. Installed
const repo = path.join(root, 'repo');
for (const [n, v] of [['Tc2_Utilities', '3.3.59.0'], ['Tc2_Utilities', '3.3.100.0'], ['Tc2_Standard', '3.4.10.0']]) fs.mkdirSync(path.join(repo, V, n, v), { recursive: true });
fs.mkdirSync(path.join(repo, V, 'Empty'), { recursive: true });
const inst = installedLibraries([repo, path.join(root, 'none')]) as { name: string; versions: string[]; vendor: string }[];
expect(inst.map((x) => `${x.name}:${x.versions.join('/')}`).join() === 'Tc2_Standard:3.4.10.0,Tc2_Utilities:3.3.59.0/3.3.100.0' && inst[0].vendor === V, `installed: ${inst.map((x) => `${x.name}:${x.versions.join('/')}`).join()}`);

fs.rmSync(root, { recursive: true, force: true });
console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
