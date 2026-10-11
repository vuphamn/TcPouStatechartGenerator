// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The Solution view's References (vscode-extension/plcTree.cjs readLibraries), as XAE's Library Manager: a placeholder
// on the newest (*), one pinned by its resolution, a library referenced at a version; the versions the project's
// cache (_Libraries) and the repositories hold; the one used; a missing one said
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readLibraries } = require('../../vscode-extension/plcTree.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-libs-'));
const plc = path.join(root, 'Plc');
const repo = path.join(root, 'repo');
const V = 'Beckhoff Automation GmbH';
for (const [base, name, version] of [
  [path.join(plc, '_Libraries'), 'Tc2_Standard', '3.4.7.0'],
  [repo, 'Tc2_Standard', '3.3.3.0'],
  [repo, 'Tc2_Standard', '3.4.10.0'],
  [repo, 'Tc2_System', '3.4.25.0'],
  [repo, 'Tc2_MC2', '3.3.40.0'],
]) fs.mkdirSync(path.join(base, V, name, version), { recursive: true });
const plcproj = path.join(plc, 'Plc.plcproj');
fs.writeFileSync(plcproj, `<?xml version="1.0" encoding="utf-8"?>
<Project>
  <ItemGroup>
    <PlaceholderReference Include="Tc2_Standard">
      <DefaultResolution>Tc2_Standard, * (Beckhoff Automation GmbH)</DefaultResolution>
      <Namespace>Tc2_Standard</Namespace>
    </PlaceholderReference>
    <PlaceholderReference Include="Tc2_System">
      <DefaultResolution>Tc2_System, * (Beckhoff Automation GmbH)</DefaultResolution>
      <Namespace>Tc2_System</Namespace>
    </PlaceholderReference>
    <LibraryReference Include="Tc2_MC2, 3.3.42.0 (Beckhoff Automation GmbH)">
      <Namespace>Tc2_MC2</Namespace>
    </LibraryReference>
  </ItemGroup>
  <ItemGroup>
    <PlaceholderResolution Include="Tc2_System">
      <Resolution>Tc2_System, 3.4.25.0 (Beckhoff Automation GmbH)</Resolution>
    </PlaceholderResolution>
  </ItemGroup>
</Project>
`);
const libs = readLibraries(plcproj, { repositories: [repo] }) as { name: string; version: string; pinned: boolean; used: string | null; cached: string[]; installed: string[]; missing: boolean; vendor: string }[];
const by = Object.fromEntries(libs.map((l) => [l.name, l]));
expect(libs.map((l) => l.name).join() === 'Tc2_MC2,Tc2_Standard,Tc2_System', `by name (${libs.map((l) => l.name).join()})`);
expect(!by.Tc2_Standard.pinned && by.Tc2_Standard.used === '3.4.10.0' && by.Tc2_Standard.cached.join() === '3.4.7.0' && by.Tc2_Standard.installed.join() === '3.3.3.0,3.4.10.0', `the newest (*): 3.4.10.0 over 3.4.7.0, versions compared as numbers (${JSON.stringify(by.Tc2_Standard)})`);
expect(by.Tc2_System.pinned && by.Tc2_System.version === '3.4.25.0' && by.Tc2_System.used === '3.4.25.0' && !by.Tc2_System.missing, 'a placeholder pinned by its resolution');
expect(by.Tc2_MC2.pinned && by.Tc2_MC2.used === null && by.Tc2_MC2.missing && by.Tc2_MC2.vendor === V, 'a library at a version installed nowhere: missing');

fs.rmSync(root, { recursive: true, force: true });
console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
