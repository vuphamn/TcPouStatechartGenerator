// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The project files' TwinCAT versions against git (shared/projectVersions.cjs), in a repository of its own: a
// converted .tsproj said with the lines changed since HEAD; Revert restores only this POU's project files (another
// file, the POU itself, a path outside refused), byte for byte as committed
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { projectVersions, revertProjectFiles } = require('../../shared/projectVersions.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-project-versions-'));
  const plcDir = path.join(dir, 'PLC');
  fs.mkdirSync(path.join(plcDir, 'POUs'), { recursive: true });
  const ts = path.join(dir, 'M.tsproj');
  const plc = path.join(plcDir, 'PLC.plcproj');
  const pou = path.join(plcDir, 'POUs', 'SM_A.TcPOU');
  const other = path.join(dir, 'Notes.txt');
  const tsCommitted = '<?xml version="1.0"?>\r\n<TcSmProject TcSmVersion="1.0" TcVersion="3.1.4024.59">\r\n</TcSmProject>\r\n';
  fs.writeFileSync(ts, tsCommitted);
  fs.writeFileSync(plc, '<Project><PropertyGroup><ProgramVersion>3.1.4024.0</ProgramVersion></PropertyGroup></Project>\n');
  fs.writeFileSync(pou, '﻿<TcPlcObject Version="1.1.0.1" ProductVersion="3.1.4024.12"><POU Name="SM_A" /></TcPlcObject>');
  fs.writeFileSync(other, 'committed\n');
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...a], { stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');

  // Not converted: said so
  let v = await projectVersions(pou);
  expect(!v.converted && v.files.length === 3 && v.files.every((f: { working: string; head: string }) => f.working === f.head), `as committed: not converted (${JSON.stringify(v.files.map((f: { kind: string; working: string }) => `${f.kind} ${f.working}`))})`);

  // The .tsproj converted (its version line only), Notes changed
  fs.writeFileSync(ts, tsCommitted.replace('3.1.4024.59', '3.1.4026.27'));
  fs.writeFileSync(other, 'mine\n');
  v = await projectVersions(pou);
  const t = v.files.find((f: { kind: string }) => f.kind === 'tsproj');
  expect(v.converted && t.working === '3.1.4026.27' && t.head === '3.1.4024.59' && t.changed?.added === 1 && t.changed?.removed === 1, `converted: said, one line changed (${JSON.stringify(t)})`);

  // Revert: only this POU's .tsproj / .plcproj
  const r = await revertProjectFiles(pou, [ts, other, pou, path.join(os.tmpdir(), 'x.tsproj')]);
  expect(r.reverted.length === 1 && path.resolve(r.reverted[0]) === path.resolve(ts) && r.errors.length === 3, `reverted the .tsproj only, the rest refused (${JSON.stringify(r)})`);
  expect(fs.readFileSync(ts, 'utf8') === tsCommitted, 'the .tsproj byte for byte as committed (CRLF kept)');
  expect(fs.readFileSync(other, 'utf8') === 'mine\n', 'another file: untouched');
  v = await projectVersions(pou);
  expect(!v.converted, 'not converted any more');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
