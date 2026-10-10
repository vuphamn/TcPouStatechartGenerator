// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The VS Code extension's TwinCAT project of a file (vscode-extension/twincatProject.cjs): its folder and .tsproj, the
// PLC project the file is in (the nearest .plcproj above it, of two), the target the .tsproj names (none: this
// computer), a PLC project's .plcproj by name; a file outside any project: none
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { projectOf, projectTarget, findPlcproj } = require('../../vscode-extension/twincatProject.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-tcproj-'));
const proj = path.join(root, 'Cell');
for (const d of ['Robot/POUs/Sub', 'Conveyor/POUs']) fs.mkdirSync(path.join(proj, d), { recursive: true });
fs.writeFileSync(path.join(proj, 'Cell.tsproj'), '<?xml version="1.0"?>\r\n<TcSmProject TcVersion="3.1.4026.27">\r\n\t<Project ProjectGUID="{1}" TargetNetId="192.168.1.20.1.1" Target64Bit="true">\r\n\t</Project>\r\n</TcSmProject>\r\n');
fs.writeFileSync(path.join(proj, 'Robot', 'Robot.plcproj'), '<Project/>');
fs.writeFileSync(path.join(proj, 'Conveyor', 'Conveyor.plcproj'), '<Project/>');
const pou = path.join(proj, 'Robot', 'POUs', 'Sub', 'FB_Arm.TcPOU');
fs.writeFileSync(pou, '<TcPlcObject/>');

const p = projectOf(pou);
expect(!!p && p.root === proj && p.name === 'Cell' && p.tsproj === path.join(proj, 'Cell.tsproj'), `the project (${p?.name} in ${p?.root})`);
expect(p?.plcProject === 'Robot' && p?.plcproj === path.join(proj, 'Robot', 'Robot.plcproj'), `its PLC project: the one the file is in (${p?.plcProject})`);
expect(projectTarget(p.tsproj) === '192.168.1.20.1.1', `the target the project names (${projectTarget(p.tsproj)})`);
fs.writeFileSync(path.join(proj, 'Cell.tsproj'), '<?xml version="1.0"?>\r\n<TcSmProject>\r\n\t<Project ProjectGUID="{1}"/>\r\n</TcSmProject>\r\n');
expect(projectTarget(p.tsproj) === null, 'none named: this computer');
expect(findPlcproj(proj, 'conveyor') === path.join(proj, 'Conveyor', 'Conveyor.plcproj') && findPlcproj(proj, 'Nope') === null, 'a PLC project by name (any case)');
const loose = path.join(root, 'FB_Loose.TcPOU');
fs.writeFileSync(loose, '<TcPlcObject/>');
expect(projectOf(loose) === null, 'a file outside any project: none');
fs.rmSync(root, { recursive: true, force: true });

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
