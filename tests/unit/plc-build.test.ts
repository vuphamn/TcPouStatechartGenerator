// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Rebuilding the PLC's project (shared/tcBuild.cjs): its archives from the boot folder, the work folder laid out as
// the .xti files say, the edits put in (none outside it), XAE's message places, the script's steps; the app's edits
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fetchProjectArchives, writeWorkspace, buildScript, placeOf, checkEdits } = require('../../shared/tcBuild.cjs');
const { writeZip } = require('../lib/zip.cjs');
/* eslint-enable @typescript-eslint/no-require-imports */
import { buildItemWhere, itemInPou, plcEdits } from '../../src/utils/plcBuild.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const boot: Record<string, Buffer> = {
    'CurrentProjectInfo.json': Buffer.from(JSON.stringify({ project: { name: 'Line' }, sub_projects: [{ name: 'LinePlc', file: 'Plc/Port_851.json' }] })),
    'CurrentConfig.tszip': writeZip({
      'Line.tsproj': '<TcSmProject/>',
      '_Config/PLC/LinePlc.xti': '<TcSmItem><Project GUID="{1}" Name="LinePlc" PrjFilePath="..\\..\\LinePlc\\LinePlc.plcproj" AmsPort="851"/></TcSmItem>',
      '_Config/SPLC/Safety.xti': '<TcSmItem><Project Name="Safety" PrjFilePath="..\\..\\Safety\\Safety.splcproj"/></TcSmItem>',
      '_Config/IO/Device 1.xti': '<TcSmItem><Device/></TcSmItem>',
    }),
    'CurrentConfig/LinePlc.tpzip': writeZip({ 'LinePlc.plcproj': '<Project/>', 'POUs/SM_Line.TcPOU': '<POU Name="SM_Line"/>', 'POUs/E_Line.TcDUT': '<DUT/>' }),
    'CurrentConfig/Safety.tfzip': writeZip({ 'Safety.splcproj': '<Project/>' }),
  };
  const read = async (rel: string) => {
    if (!boot[rel]) throw Object.assign(new Error('Not found'), { adsError: { errorCode: 1804, errorStr: 'Not found (files, ...)' } });
    return boot[rel];
  };

  // 1. The archives: the TwinCAT project and each nested project its .xti files name
  const a = await fetchProjectArchives(read);
  expect(a.nested.map((n: { name: string; kind: string; prjPath: string; data: Buffer | null }) => `${n.name}:${n.kind}:${n.prjPath}:${!!n.data}`).join() === 'LinePlc:plc:../../LinePlc/LinePlc.plcproj:true,Safety:safety:../../Safety/Safety.splcproj:true', `archives: ${a.nested.map((n: { name: string }) => n.name).join(', ')}`);

  // 2. The work folder: each project where its .xti says, the edit put in (CRLF, as XAE writes)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-unit-build-'));
  const ws = writeWorkspace(a, [{ plcProject: 'LinePlc', path: 'POUs/SM_Line.TcPOU', content: '<POU Name="SM_Line">\nx := 1;\n</POU>' }], dir);
  const pou = fs.readFileSync(path.join(dir, 'LinePlc', 'POUs', 'SM_Line.TcPOU'), 'utf8');
  expect(ws.tsproj === path.join(dir, 'Line.tsproj') && fs.existsSync(path.join(dir, 'LinePlc', 'LinePlc.plcproj')) && fs.existsSync(path.join(dir, 'Safety', 'Safety.splcproj')) && pou === '<POU Name="SM_Line">\r\nx := 1;\r\n</POU>', `laid out: ${ws.plcProjects.map((p: { plcproj: string }) => path.relative(dir, p.plcproj)).join()}, the edit in (${ws.applied.join()})`);
  let err = '';
  try {
    writeWorkspace(a, [{ plcProject: 'LinePlc', path: 'POUs/SM_New.TcPOU', content: 'x' }], fs.mkdtempSync(path.join(os.tmpdir(), 'kss-unit-build-')));
  } catch (e) {
    err = (e as Error).message;
  }
  expect(/SM_New\.TcPOU is not in LinePlc/.test(err), `a file the project does not have: "${err}"`);
  // (a safety project downloaded without its sources: said, not built half)
  let err2 = '';
  try {
    writeWorkspace({ ...a, nested: a.nested.map((n: { kind: string }) => (n.kind === 'safety' ? { ...n, data: null } : n)) }, [], fs.mkdtempSync(path.join(os.tmpdir(), 'kss-unit-build-')));
  } catch (e) {
    err2 = (e as Error).message;
  }
  expect(/keeps no sources of Safety \(safety project\)/.test(err2), `without a project's sources: "${err2}"`);
  // An archive entry outside its folder (zip slip): refused
  let err3 = '';
  try {
    writeWorkspace({ ...a, system: writeZip({ 'Line.tsproj': '', '../evil.txt': 'x' }) }, [], fs.mkdtempSync(path.join(os.tmpdir(), 'kss-unit-build-')));
  } catch (e) {
    err3 = (e as Error).message;
  }
  expect(/outside its folder/.test(err3), `an entry outside the folder: "${err3}"`);

  // 3. The requests checked: paths inside the project, sources only, write modes
  expect(checkEdits({ edits: [{ path: 'POUs/A.TcPOU', content: 'x' }], write: 'online' }) === null, 'a POU and online: fine');
  expect(/Not a PLC source path/.test(checkEdits({ edits: [{ path: '../../Windows/x.TcPOU', content: 'x' }] }) ?? '') && /Not a PLC source path/.test(checkEdits({ edits: [{ path: 'C:/x.TcPOU', content: 'x' }] }) ?? '') && /Not a PLC source path/.test(checkEdits({ edits: [{ path: 'run.cmd', content: 'x' }] }) ?? ''), 'outside the project, absolute, not a source: refused');
  expect(/online or activate/.test(checkEdits({ edits: [], write: 'download' }) ?? ''), 'an unknown write: refused');

  // 4. XAE's message places: the file in the project, its member and part, the line
  const place = placeOf({ file: `${path.join(dir, 'LinePlc', 'POUs', 'SM_Line.TcPOU')}@doState (Impl)`, line: 12 }, ws);
  const body = placeOf({ file: `${path.join(dir, 'LinePlc', 'POUs', 'SM_Line.TcPOU')} (Decl)`, line: 3 }, ws);
  expect(JSON.stringify(place) === '{"plcProject":"LinePlc","path":"POUs/SM_Line.TcPOU","member":"doState","part":"implementation","line":12}' && body?.member === null && body?.part === 'declaration', `places: ${JSON.stringify(place)} / ${JSON.stringify(body)}`);
  expect(placeOf({ file: 'C:\\elsewhere\\X.TcPOU (Impl)', line: 1 }, ws) === null && placeOf({ file: '', line: 0 }, ws) === null, 'outside the project, or none: no place');

  // 5. The script: builds, reads the Error List; writes only when asked, after the build had no errors
  const build = buildScript({ dir, tsproj: ws.tsproj, plcProject: 'LinePlc' });
  const online = buildScript({ dir, tsproj: ws.tsproj, plcProject: 'LinePlc', write: 'online', netId: '5.1.2.3.1.1' });
  const activate = buildScript({ dir, tsproj: ws.tsproj, plcProject: 'LinePlc', write: 'activate' });
  expect(/SolutionBuild\.Build\(\$true\)/.test(build) && /KssErrorList/.test(build) && !/LoginCmd|ActivateConfiguration/.test(build), 'build only: no login, no activation');
  expect(/SetTargetNetId\('5\.1\.2\.3\.1\.1'\)/.test(online) && /<LoginCmd>true<\/LoginCmd>/.test(online) && !/ActivateConfiguration/.test(online) && online.indexOf('LoginCmd') > online.indexOf("exit 0"), 'online: login after the error check, on the connection\'s NetId');
  expect(/ActivateConfiguration\(\)/.test(activate) && /StartRestartTwinCAT\(\)/.test(activate) && !/LoginCmd/.test(activate), 'activate: the configuration, TwinCAT restarted');
  expect(/\$before -notcontains \$_\.Id/.test(build) && /Stop-Process -Id \$id/.test(build), 'only its own XAE stopped at the end');

  // 6. The app: the edits (the POU, its enum when one of the PLC's), where a message is
  const origin = { plcProject: 'LinePlc', path: 'POUs/SM_Line.TcPOU', dutPaths: { 'e_line.tcdut': 'POUs/E_Line.TcDUT' } };
  const edits = plcEdits(origin, { content: 'P' }, { name: 'E_Line.TcDUT', content: 'D' });
  expect(JSON.stringify(edits) === '[{"plcProject":"LinePlc","path":"POUs/SM_Line.TcPOU","content":"P"},{"plcProject":"LinePlc","path":"POUs/E_Line.TcDUT","content":"D"}]' && plcEdits(origin, { content: 'P' }, { name: 'E_Other.TcDUT', content: 'D' }).length === 1, 'edits: the POU and its enum (another enum: not sent)');
  const item = { level: 'error' as const, text: 'x', file: '', line: 12, place: place };
  expect(buildItemWhere(item) === 'SM_Line.doState() line 12' && buildItemWhere({ ...item, place: { ...place, member: 'bReady.Get' } }) === 'SM_Line.bReady.Get line 12' && itemInPou(item, origin) && !itemInPou(item, { ...origin, path: 'POUs/Other.TcPOU' }), 'where: SM_Line.doState() line 12; in this POU or not');

  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
