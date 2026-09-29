// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Rebuilding the PLC's project (shared/tcBuild.cjs): its archives from the boot folder, the work folder laid out as
// the .xti files say, the edits put in (none outside it), XAE's message places, the script's steps; the app's edits
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fetchProjectArchives, writeWorkspace, buildScript, serverScript, placeOf, checkEdits, reuseWorkspace, archivesHash, buildFromPlc, buildFromProject, projectRootOf, syncTree, xaeWorker, openXae } = require('../../shared/tcBuild.cjs');
const { plcAppInfo } = require('../../shared/tcAppInfo.cjs');
const { ProjectMirror, relPath } = require('../../link/projectMirror.cjs');
const selfUpdate = require('../../link/selfUpdate.cjs');
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
  expect(/online, download or activate/.test(checkEdits({ edits: [], write: 'erase' }) ?? '') && checkEdits({ edits: [], write: 'download' }) === null, 'an unknown write: refused; download: fine');

  // 4. XAE's message places: the file in the project, its member and part, the line
  const place = placeOf({ file: `${path.join(dir, 'LinePlc', 'POUs', 'SM_Line.TcPOU')}@doState (Impl)`, line: 12 }, ws);
  const body = placeOf({ file: `${path.join(dir, 'LinePlc', 'POUs', 'SM_Line.TcPOU')} (Decl)`, line: 3 }, ws);
  expect(JSON.stringify(place) === '{"plcProject":"LinePlc","path":"POUs/SM_Line.TcPOU","member":"doState","part":"implementation","line":12}' && body?.member === null && body?.part === 'declaration', `places: ${JSON.stringify(place)} / ${JSON.stringify(body)}`);
  expect(placeOf({ file: 'C:\\elsewhere\\X.TcPOU (Impl)', line: 1 }, ws) === null && placeOf({ file: '', line: 0 }, ws) === null, 'outside the project, or none: no place');

  // 5. The script: builds, reads the Error List; writes only when asked, after the build had no errors
  const build = buildScript({ dir, tsproj: ws.tsproj, plcProject: 'LinePlc' });
  const online = buildScript({ dir, tsproj: ws.tsproj, plcProject: 'LinePlc', write: 'online', netId: '5.1.2.3.1.1' });
  // (a PowerShell function of the script, up to the next: "function Name {" or "function Name($r) {")
  const fn = (s: string, name: string) => {
    const at = s.search(new RegExp(`function ${name}[ (]`));
    const end = s.indexOf('\nfunction ', at + 1);
    return at < 0 ? '' : s.slice(at, end < 0 ? undefined : end);
  };
  const buildFn = fn(build, 'Build-Kss');
  expect(/SolutionBuild\.Build\(\$true\)/.test(buildFn) && /KssErrorList/.test(buildFn) && /if \(-not \$r\.write\) \{ Say @\{ kind = 'done'; ok = \$true/.test(buildFn), 'build: the Error List read; without a write it ends there');
  expect(buildFn.indexOf('[KssPlcOnline]::Login($plc, 2 + 256)') > buildFn.indexOf("failedProjects = $failed }; return }") && buildFn.indexOf('[KssPlcOnline]::Login($plc, 4 + 256)') > buildFn.indexOf("failedProjects = $failed }; return }") && buildFn.indexOf('ActivateConfiguration') > buildFn.indexOf("failedProjects = $failed }; return }"), 'login (online change, download) and activation only after the error check');
  expect(/"netId":"5\.1\.2\.3\.1\.1"/.test(online) && /"write":"online"/.test(online) && /"writeText":"Online change"/.test(online) && /"write":null/.test(build), 'the request: the connection\'s NetId, the write asked for (none for a build)');
  expect(/GenerateBootProject\(\$true\)/.test(buildFn) && /StartRestartTwinCAT\(\)/.test(buildFn), 'online: the boot project updated too; activate: TwinCAT restarted');
  let refused = '';
  try {
    buildScript({ dir, tsproj: ws.tsproj, plcProject: 'LinePlc', write: 'erase' as never });
  } catch (e) {
    refused = (e as Error).message;
  }
  expect(/Unknown write/.test(refused), 'an unknown write: refused');
  const stopFn = fn(build, 'Stop-Kss');
  expect(/\$script:before -notcontains \$_\.Id/.test(fn(build, 'Start-Kss')) && /Stop-Process -Id \$id/.test(stopFn) && /Say @\{ kind = 'xae'; pids = \$script:mine \}/.test(build), 'only its own XAE stopped at the end (its id reported)');
  // XAE's settings: put back only the files that existed and changed; one made meanwhile is left
  const restoreFn = fn(build, 'Restore-KssSettings');
  expect(/foreach \(\$path in @\(\$kssFiles\.Keys\)\)/.test(restoreFn) && !/Remove-Item -LiteralPath \$f/.test(restoreFn) && /if \(@\(\$script:before \| Where-Object \{ \$still -notcontains \$_ \}\)\.Count -eq 0\) \{ Restore-KssSettings \}/.test(stopFn), 'settings: changed ones put back, none removed; not when the user\'s XAE quit meanwhile');
  // XAE kept open: one request per line; the changed files taken in when the project stays open
  const server = serverScript();
  expect(/\[Console\]::In\.ReadLine\(\)/.test(server) && /if \(\$r\.cmd -eq 'quit'\) \{ break \}/.test(server) && /if \(-not \$script:dte\) \{ Start-Kss \}/.test(server) && /if \(-not \$opened -and \$r\.changed\)/.test(server), 'the server: requests on stdin, XAE started once, changed files taken in');

  // 5b. The work folder used again: this build's edits in, an earlier build's edits back as the PLC has them
  const reused = { ...ws, originals: new Map<string, Buffer>() };
  const pouFile = path.join(dir, 'LinePlc', 'POUs', 'SM_Line.TcPOU');
  const dutFile = path.join(dir, 'LinePlc', 'POUs', 'E_Line.TcDUT');
  reused.originals.set(pouFile, Buffer.from('<POU Name="SM_Line"/>'));
  let changed = reuseWorkspace(reused, [{ plcProject: 'LinePlc', path: 'POUs/E_Line.TcDUT', content: '<DUT>x</DUT>' }]);
  expect(changed && fs.readFileSync(pouFile, 'utf8') === '<POU Name="SM_Line"/>' && fs.readFileSync(dutFile, 'utf8') === '<DUT>x</DUT>', 'reused: the earlier edit put back, the new one in');
  changed = reuseWorkspace(reused, [{ plcProject: 'LinePlc', path: 'POUs/E_Line.TcDUT', content: '<DUT>x</DUT>' }]);
  expect(!changed, 'the same edit again: nothing rewritten (XAE not asked to take in files)');
  expect(archivesHash(a) === archivesHash(a) && archivesHash(a) !== archivesHash({ ...a, system: writeZip({ 'Line.tsproj': '<TcSmProject x="1"/>' }) }), 'the archives\' fingerprint: another project, another fingerprint');

  // 5c. A write (the stand-in compiler): the PLC read again after it, the result says so
  process.env.KSS_BUILD_DRYRUN = '1';
  const ads = boot; // (the stand-in PLC: the same boot folder; no data types, so nothing to compare)
  const open = new Map<number, { data: Buffer; at: number }>();
  let next = 1;
  // (the PLC runtime's state: 5 Run, 6 Stop)
  let adsState = 5;
  const client = {
    async readState() {
      return { adsState };
    },
    async readWriteRaw(ig: number, io: number, size: number, value: Buffer, target?: { adsPort?: number }) {
      if (target?.adsPort !== 10000) throw Object.assign(new Error('no types'), { adsError: { errorCode: 0x710, errorStr: 'Symbol not found' } });
      if (ig === 120) {
        const name = value.toString('latin1').replace(/\0+$/, '');
        if (!ads[name]) throw Object.assign(new Error('Not found'), { adsError: { errorCode: 1804, errorStr: 'Not found (files, ...)' } });
        const b = Buffer.alloc(4);
        b.writeUInt32LE(next);
        open.set(next++, { data: ads[name], at: 0 });
        return b;
      }
      const f = open.get(io)!;
      if (ig === 121) {
        open.delete(io);
        return Buffer.alloc(0);
      }
      const chunk = f.data.subarray(f.at, f.at + size);
      f.at += chunk.length;
      return chunk;
    },
  };
  boot['CurrentConfig/LinePlc.tpzip'] = writeZip({ 'LinePlc.plcproj': '<Project/>', 'POUs/SM_Line.TcPOU': '<POU Name="SM_Line"/>', 'POUs/E_Line.TcDUT': '<DUT/>' });
  const written = await buildFromPlc(client, { edits: [{ plcProject: 'LinePlc', path: 'POUs/SM_Line.TcPOU', content: '<POU Name="SM_Line"><Implementation><ST><![CDATA[x := 1;]]></ST></Implementation></POU>' }], write: 'online' });
  expect(written.ok && written.written === 'online' && written.verified?.ok === true && /runs the code written/.test(written.verified.text), `after the write: ${JSON.stringify(written.verified ?? written.fatal)}`);
  expect(written.plcRun?.ok === true && written.plcRun.state === 'Run', `after the write, the PLC in Run: ${JSON.stringify(written.plcRun)}`);
  // Not back in Run (the application stopped): said, with the time waited set short
  adsState = 6;
  process.env.KSS_BUILD_RUN_WAIT_MS = '300';
  const stopped = await buildFromPlc(client, { edits: [], write: 'download' });
  expect(stopped.ok && stopped.plcRun?.ok === false && stopped.plcRun.state === 'Stop' && stopped.items.some((i: { text: string }) => /After the download the PLC is in Stop, not in Run: start it from XAE/.test(i.text)), `not back in Run: ${JSON.stringify(stopped.plcRun)}`);
  adsState = 5;
  delete process.env.KSS_BUILD_RUN_WAIT_MS;
  // The PLC's state and online change count (a runtime without the counter: null)
  const info = await plcAppInfo(client);
  expect(info.state === 'Run' && info.onlineChanges === null, `the PLC's app info: ${JSON.stringify(info)}`);
  const failing = await buildFromPlc(client, { edits: [{ plcProject: 'LinePlc', path: 'POUs/SM_Line.TcPOU', content: '<POU Name="SM_Line"><Implementation><ST><![CDATA[noSuchVar := 1;]]></ST></Implementation></POU>' }], write: 'online' });
  expect(!failing.ok && !failing.written && !failing.verified && failing.errors === 1, 'with an error: not written, not checked');
  // A trial license that ran out: a download (the application would not start again) refused before anything is built
  const lic = (h: number) => Buffer.from(`<TcLicenseInfo><LicenseInfo><ExpireTime>${new Date(Date.now() + h * 3600000).toISOString().slice(0, 19)}</ExpireTime></LicenseInfo></TcLicenseInfo>`);
  boot['../License/TrialLicense.tclrs'] = lic(-2);
  const refusedDl = await buildFromPlc(client, { edits: [], write: 'download' });
  expect(!refusedDl.ok && /Nothing was written: The PLC's TwinCAT trial license ran out/.test(refusedDl.fatal ?? '') && !refusedDl.written, `an expired trial: the download refused (${(refusedDl.fatal ?? '').slice(0, 70)})`);
  boot['../License/TrialLicense.tclrs'] = lic(30);
  const soon = await buildFromPlc(client, { edits: [], write: 'download' });
  expect(soon.ok && soon.written === 'download' && soon.items.some((i: { text: string }) => /runs out tomorrow/.test(i.text)), 'running out tomorrow: written, with the warning');
  delete boot['../License/TrialLicense.tclrs'];
  const none = await buildFromPlc(client, { edits: [], write: 'download' });
  expect(none.ok && !none.items.some((i: { text: string }) => /trial license/.test(i.text)), 'no trial (a full license): nothing said');
  // 5d. From a TwinCAT project on this computer: found from a POU, built from a copy with the edit (the project left
  // as it is), its error placed; a file outside it refused; a copy synced again: only the changed files
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-unit-proj-'));
  fs.mkdirSync(path.join(proj, 'LinePlc', 'POUs'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'Line.tsproj'), '<TcSmProject/>');
  fs.writeFileSync(path.join(proj, 'LinePlc', 'LinePlc.plcproj'), '<Project/>');
  const projPou = path.join(proj, 'LinePlc', 'POUs', 'SM_Line.TcPOU');
  fs.writeFileSync(projPou, '<POU Name="SM_Line"><Implementation><ST><![CDATA[x := 1;]]></ST></Implementation></POU>');
  expect(projectRootOf(projPou) === proj && projectRootOf(path.join(os.tmpdir(), 'nowhere.TcPOU')) === null, 'the project found from its POU (none elsewhere)');
  const fromProj = await buildFromProject(client, { file: projPou, edits: [{ file: projPou, content: '<POU Name="SM_Line"><Implementation><ST><![CDATA[noSuchVar := 1;]]></ST></Implementation></POU>' }] });
  expect(!fromProj.ok && fromProj.errors === 1 && fromProj.items[0].place?.path === 'POUs/SM_Line.TcPOU' && fromProj.items[0].place?.plcProject === 'LinePlc' && /x := 1/.test(fs.readFileSync(projPou, 'utf8')), `built from a copy: the error in ${JSON.stringify(fromProj.items[0]?.place)}; the project's file unchanged`);
  // Written from the project: the new compile information copied into it, its paths said (Link sends them back)
  const projWritten = await buildFromProject(client, { file: projPou, edits: [], write: 'online' });
  const infoFile = projWritten.compileInfoFiles?.[0] ?? '';
  expect(projWritten.ok && projWritten.compileInfoCopied === 1 && /^LinePlc\/_CompileInfo\/StandIn-\d+\.compileinfo$/.test(infoFile) && fs.existsSync(path.join(proj, infoFile)) && projWritten.plcRun?.ok === true, `written from the project: ${infoFile} (${projWritten.compileInfoCopied} copied), in Run`);
  fs.rmSync(path.join(proj, 'LinePlc', '_CompileInfo'), { recursive: true, force: true });
  const outside = await buildFromProject(client, { file: projPou, edits: [{ file: path.join(os.tmpdir(), 'x.TcPOU'), content: 'x' }] });
  expect(/Not a source of this project/.test(outside.fatal ?? ''), `a file outside the project: "${outside.fatal}"`);
  const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-unit-sync-'));
  expect(syncTree(proj, copyDir) === 3 && syncTree(proj, copyDir) === 0, 'synced: the files, then nothing (unchanged)');
  fs.writeFileSync(projPou, '<POU Name="SM_Line"/>');
  expect(syncTree(proj, copyDir) === 1, 'one file changed: one copied');
  // Open XAE (the stand-in: not started, the path it would start)
  const xae = await openXae();
  expect(xae.ok && /TcXaeShell\.exe$/.test(xae.dry ?? ''), `Open XAE: ${xae.message}`);
  delete process.env.KSS_BUILD_DRYRUN;

  // 5e. One XAE per project: at most KSS_BUILD_MAX_XAE; for another, the one used longest ago goes (not a busy one)
  process.env.KSS_BUILD_MAX_XAE = '2';
  const w1 = xaeWorker('unit|one');
  const w2 = xaeWorker('unit|two');
  const w1again = xaeWorker('unit|one');
  const w3 = xaeWorker('unit|three');
  expect(w1again === w1 && w3 !== w1 && xaeWorker('unit|one') === w1 && xaeWorker('unit|two') !== w2, 'one XAE per project: the same one again; a third project closes the one used longest ago');
  w1.pending = 1;
  xaeWorker('unit|four');
  expect(xaeWorker('unit|one') === w1, 'a busy XAE is kept for another project');
  w1.pending = 0;
  delete process.env.KSS_BUILD_MAX_XAE;

  // 5f. Link: the page's project folder mirrored (the files it needs, in pieces; the ones not listed removed)
  expect(relPath('Plant/POUs/A.TcPOU') === path.join('Plant', 'POUs', 'A.TcPOU') && [ '../x', '/x', 'a\\b', 'C:x', 'a//b', 'a/./b' ].every((x) => relPath(x) === null), 'mirror paths: relative, nothing outside');
  const mirror = new ProjectMirror();
  const t = Date.now() - 10000;
  const list = [{ path: 'Plant.tsproj', size: 3, mtime: t }, { path: 'Plant/POUs/A.TcPOU', size: 5, mtime: t }];
  expect(!!mirror.sync('Plant', [{ path: 'Plant/A.TcPOU', size: 1, mtime: t }]).error, 'a folder without a .tsproj: refused');
  const m1 = mirror.sync('Plant', list);
  expect(!!m1.uploadId && m1.need?.length === 2, `the first list: both needed (${m1.need})`);
  mirror.put(m1.uploadId, { path: 'Plant.tsproj', offset: 0, data: Buffer.from('<x>').toString('base64'), size: 3, mtime: t, done: true });
  mirror.put(m1.uploadId, { path: 'Plant/POUs/A.TcPOU', offset: 0, data: Buffer.from('ab').toString('base64') });
  const gap = mirror.put(m1.uploadId, { path: 'Plant/POUs/A.TcPOU', offset: 3, data: Buffer.from('cde').toString('base64') });
  mirror.put(m1.uploadId, { path: 'Plant/POUs/A.TcPOU', offset: 2, data: Buffer.from('cde').toString('base64'), size: 5, mtime: t, done: true });
  const m2 = mirror.sync('Plant', list);
  const root = mirror.root(m1.uploadId);
  expect(!!gap.error && m2.uploadId === m1.uploadId && m2.need?.length === 0 && fs.readFileSync(path.join(root, 'Plant', 'POUs', 'A.TcPOU'), 'utf8') === 'abcde', `sent in pieces (a gap refused): listed again, none needed (${m2.need})`);
  const m3 = mirror.sync('Plant', [list[0]]);
  expect(m3.need?.length === 0 && !fs.existsSync(path.join(root, 'Plant', 'POUs', 'A.TcPOU')) && mirror.fullPath(m1.uploadId, '../x') === null, 'a file no longer listed: removed');
  mirror.dispose();

  // 5g. Link's updates: versions compared; the newest release with a Link found; its download checked (SHA-256)
  expect(selfUpdate.compareVersions('1.2.10', '1.2.9') > 0 && selfUpdate.compareVersions('1.0.0', '1.0.0') === 0 && selfUpdate.compareVersions('0.9.9', '1.0.0') < 0, 'versions compared');
  const exe = Buffer.from('a Link');
  const sha = require('crypto').createHash('sha256').update(exe).digest('hex');
  const srv = require('http').createServer((req, res) => {
    if (req.url === '/releases') {
      res.setHeader('Content-Type', 'application/json');
      const asset = (v: string, digest: string) => ({ name: `KvalStateScope-Link-${v}.exe`, browser_download_url: `http://127.0.0.1:${(srv.address() as { port: number }).port}/link-${v}.exe`, size: exe.length, digest });
      return res.end(JSON.stringify([
        { tag_name: 'web-v1.0.2', assets: [asset('1.0.2', `sha256:${sha}`)] },
        { tag_name: 'web-v1.1.0', draft: true, assets: [asset('1.1.0', `sha256:${sha}`)] },
        { tag_name: 'desktop-v9.0.0', assets: [] },
        { tag_name: 'web-v1.0.10', assets: [asset('1.0.10', `sha256:${'0'.repeat(64)}`)] },
      ]));
    }
    res.end(exe);
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  process.env.KSS_LINK_RELEASES = `http://127.0.0.1:${(srv.address() as { port: number }).port}/releases`;
  const latest = await selfUpdate.latestRelease();
  let badSha = '';
  await selfUpdate.download(latest).catch((e: Error) => (badSha = e.message));
  const good = await selfUpdate.download({ ...latest, sha256: sha });
  expect(latest?.version === '1.0.10' && /does not match the release's SHA-256/.test(badSha) && fs.readFileSync(good, 'utf8') === 'a Link', `the newest Link: ${latest?.version} (drafts, other editions left out); a download not matching its SHA-256 refused, one matching kept`);
  fs.rmSync(good, { force: true });
  // (fetch's kept-alive connections closed first: ending with them open trips libuv on Windows)
  srv.closeAllConnections();
  await new Promise((r) => srv.close(r));
  await new Promise((r) => setTimeout(r, 100));
  delete process.env.KSS_LINK_RELEASES;

  // 6. The app: the edits (the POU, its enum when one of the PLC's), where a message is
  const origin = { plcProject: 'LinePlc', path: 'POUs/SM_Line.TcPOU', dutPaths: { 'e_line.tcdut': 'POUs/E_Line.TcDUT' } };
  const edits = plcEdits(origin, { content: 'P' }, { name: 'E_Line.TcDUT', content: 'D' });
  expect(JSON.stringify(edits) === '[{"plcProject":"LinePlc","path":"POUs/SM_Line.TcPOU","content":"P"},{"plcProject":"LinePlc","path":"POUs/E_Line.TcDUT","content":"D"}]' && plcEdits(origin, { content: 'P' }, { name: 'E_Other.TcDUT', content: 'D' }).length === 1, 'edits: the POU and its enum (another enum: not sent)');
  const item = { level: 'error' as const, text: 'x', file: '', line: 12, place: place };
  expect(buildItemWhere(item) === 'SM_Line.doState() line 12' && buildItemWhere({ ...item, place: { ...place, member: 'bReady.Get' } }) === 'SM_Line.bReady.Get line 12' && itemInPou(item, origin) && !itemInPou(item, { ...origin, path: 'POUs/Other.TcPOU' }), 'where: SM_Line.doState() line 12; in this POU or not');

  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
