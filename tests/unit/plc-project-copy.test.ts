// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// A PLC's project kept on this computer (shared/plcProjectCopy.cjs): downloaded into Documents\Kval StateScope\PLC
// projects\<project> (the whole TwinCAT project, as it opens in XAE), the same the next time (nothing asked), the
// PLC's changed: "differs" with the local edits listed; Override writes the PLC's over it, Keep local leaves it, a
// folder of its own ("Save to a different location") gets its own copy
const fs = require('fs');
const os = require('os');
const path = require('path');
const { syncPlcProject, baseDirOf, MANIFEST, readCopyPou } = require('../../shared/plcProjectCopy.cjs');
const { createLiveSession } = require('../../shared/liveSession.cjs');
const { writeZip } = require('../lib/zip.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const tpzip = (pou: string) => writeZip({ 'EdgePlc.plcproj': '<Project/>', 'POUs/SM_TableManager.TcPOU': pou, 'DUTs/E_TableManager.TcDUT': '<DUT/>' });
  const boot: Record<string, Buffer> = {
    'CurrentProjectInfo.json': Buffer.from(JSON.stringify({ project: { name: 'EdgeSS' }, sub_projects: [{ name: 'EdgePlc', file: 'Plc/Port_851.json' }] })),
    'CurrentConfig.tszip': writeZip({
      'EdgeSS.tsproj': '<TcSmProject/>',
      '_Config/PLC/EdgePlc.xti': '<TcSmItem><Project GUID="{1}" Name="EdgePlc" PrjFilePath="..\\..\\EdgePlc\\EdgePlc.plcproj" AmsPort="851"/></TcSmItem>',
    }),
    'CurrentConfig/EdgePlc.tpzip': tpzip('<POU Name="SM_TableManager">v1</POU>'),
  };
  const read = async (rel: string) => {
    if (!boot[rel]) throw Object.assign(new Error('Not found'), { adsError: { errorCode: 1804, errorStr: 'Not found (files, ...)' } });
    return boot[rel];
  };
  const documents = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-docs-'));
  const dir = path.join(baseDirOf(documents), 'EdgeSS');
  const pou = path.join(dir, 'EdgePlc', 'POUs', 'SM_TableManager.TcPOU');

  // First time: downloaded, the whole project
  let r = await syncPlcProject(read, { documents, netId: '10.10.10.50.1.1' });
  expect(r.status === 'downloaded' && r.dir === dir, `downloaded into Documents\\Kval StateScope\\PLC projects\\EdgeSS (${r.status}, ${r.dir})`);
  expect(fs.existsSync(path.join(dir, 'EdgeSS.tsproj')) && fs.readFileSync(pou, 'utf8').includes('v1') && fs.existsSync(path.join(dir, 'EdgePlc', 'EdgePlc.plcproj')), 'the .tsproj, the PLC project where its .xti says, its POUs');
  expect(r.plcProjects?.length === 1 && r.plcProjects[0].name === 'EdgePlc' && /EdgeSS\.tsproj$/.test(r.tsproj), `its projects told (${JSON.stringify(r.plcProjects?.map((p: { name: string }) => p.name))})`);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
  expect(manifest.project === 'EdgeSS' && manifest.netId === '10.10.10.50.1.1' && !!manifest.hash && Object.keys(manifest.files).length >= 4, 'its manifest: the project, the PLC, the fingerprints');

  // Again, the PLC unchanged: current, nothing asked
  r = await syncPlcProject(read, { documents });
  expect(r.status === 'current' && r.changes?.length === 0 && r.plcProjects.length === 1, `the same again: current (${r.status})`);

  // Edited here, the PLC unchanged: still current (its edits listed)
  fs.writeFileSync(pou, '<POU Name="SM_TableManager">mine</POU>');
  r = await syncPlcProject(read, { documents });
  expect(r.status === 'current' && r.changes?.join() === 'EdgePlc/POUs/SM_TableManager.TcPOU', `edited here, the PLC as it was: current, the edit listed (${r.changes?.join()})`);

  // The PLC's project changed: differs, the local edit listed; nothing written
  boot['CurrentConfig/EdgePlc.tpzip'] = tpzip('<POU Name="SM_TableManager">v2</POU>');
  r = await syncPlcProject(read, { documents });
  expect(r.status === 'differs' && r.changes?.join() === 'EdgePlc/POUs/SM_TableManager.TcPOU' && fs.readFileSync(pou, 'utf8').includes('mine'), `the PLC's changed: differs, the edit listed, nothing written (${r.status})`);
  // Keep local
  r = await syncPlcProject(read, { documents, choice: 'keep' });
  expect(r.status === 'kept' && fs.readFileSync(pou, 'utf8').includes('mine'), 'Keep local: left as it is');
  // Save to a different location: its own copy, the first one left
  const other = path.join(documents, 'Elsewhere', 'EdgeSS v2');
  r = await syncPlcProject(read, { documents, folder: other });
  expect(r.status === 'downloaded' && r.dir === other && fs.readFileSync(path.join(other, 'EdgePlc', 'POUs', 'SM_TableManager.TcPOU'), 'utf8').includes('v2') && fs.readFileSync(pou, 'utf8').includes('mine'), 'Save to a different location: the PLC\'s there, the local copy left');
  // Override
  r = await syncPlcProject(read, { documents, choice: 'override' });
  expect(r.status === 'overridden' && fs.readFileSync(pou, 'utf8').includes('v2'), 'Override: the PLC\'s written over it');
  r = await syncPlcProject(read, { documents });
  expect(r.status === 'current' && r.changes?.length === 0, 'then current, no edits');

  // A folder there not downloaded here (no manifest): differs, its edits not known
  const own = path.join(documents, 'Mine');
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, 'notes.txt'), 'mine');
  r = await syncPlcProject(read, { documents, folder: own });
  expect(r.status === 'differs' && r.changes === null, `a folder of its own with other files: differs, edits not known (${r.status})`);
  // ... chosen for it (Save to a different location): the project in a folder of its own there
  r = await syncPlcProject(read, { documents, folder: own, chosen: true });
  expect(r.status === 'downloaded' && r.dir === path.join(own, 'EdgeSS') && fs.readFileSync(path.join(own, 'notes.txt'), 'utf8') === 'mine', `chosen, holding other things: into ${r.dir}, its files left`);

  // The PLC runs the loaded POU's own project: nothing downloaded (its project information only)
  const docs2 = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-docs-'));
  const reads: string[] = [];
  r = await syncPlcProject(async (rel: string) => { reads.push(rel); return read(rel); }, { documents: docs2, skipProjects: ['edgess'] });
  expect(r.status === 'same-project' && r.project === 'EdgeSS' && reads.join() === 'CurrentProjectInfo.json' && !fs.existsSync(baseDirOf(docs2)), `the loaded POU's project: same-project, nothing read but its project information (${r.status}, ${reads.join()})`);
  r = await syncPlcProject(read, { documents: docs2, skipProjects: ['Commander_3'] });
  expect(r.status === 'downloaded', `another project loaded (Commander_3): downloaded (${r.status})`);
  fs.rmSync(docs2, { recursive: true, force: true });

  // No project on the PLC: an error, nothing written
  const none = await syncPlcProject(async () => { throw new Error('Not found'); }, { documents: fs.mkdtempSync(path.join(os.tmpdir(), 'kss-docs-')) });
  expect(!!none.error && /project information/.test(none.error), `no project on the PLC: ${none.error}`);

  // An instance's POU from the copy (Link: the page has no files): its content, the project's enums
  const plcproj = path.join(dir, 'EdgePlc', 'EdgePlc.plcproj');
  const got = readCopyPou(plcproj, 'SM_TableManager');
  expect(got.name === 'SM_TableManager.TcPOU' && /SM_TableManager/.test(got.content) && got.dutCandidates?.map((d: { relativePath: string }) => d.relativePath).join() === 'DUTs/E_TableManager.TcDUT', `a POU of the copy: ${got.name ?? got.error}, its enums ${got.dutCandidates?.map((d: { relativePath: string }) => d.relativePath).join()}`);
  expect(!!readCopyPou(plcproj, 'FB_Missing').error && !!readCopyPou(plcproj, '../x').error && !!readCopyPou(path.join(dir, 'EdgeSS.tsproj'), 'SM_TableManager').error, 'not there, not a name, not a .plcproj: an error');
  // ... through Link's session: only from the PLC projects' place (or a folder the copy may be in)
  const sent: { type: string; requestId: number; content?: string; error?: string }[] = [];
  const session = createLiveSession({ documents: () => documents, folderAllowed: () => false });
  session.projectPou((m: (typeof sent)[0]) => sent.push(m), { requestId: 7, plcproj, typeName: 'SM_TableManager' });
  const elsewhere = path.join(other, 'EdgePlc', 'EdgePlc.plcproj');
  session.projectPou((m: (typeof sent)[0]) => sent.push(m), { requestId: 8, plcproj: elsewhere, typeName: 'SM_TableManager' });
  expect(sent[0]?.type === 'projectPouResult' && sent[0].requestId === 7 && /SM_TableManager/.test(sent[0].content ?? ''), `Link: from Documents\\Kval StateScope\\PLC projects (${sent[0]?.error ?? 'read'})`);
  expect(!!sent[1]?.error && !sent[1].content, `Link: a folder it may not read (${sent[1]?.error})`);
  const session2 = createLiveSession({ documents: () => documents, folderAllowed: (d: string) => d.toLowerCase().startsWith(documents.toLowerCase()) });
  session2.projectPou((m: (typeof sent)[0]) => sent.push(m), { requestId: 9, plcproj: elsewhere, typeName: 'SM_TableManager' });
  expect(sent[2]?.requestId === 9 && /v2/.test(sent[2].content ?? ''), `Link: a copy saved to a different location in the user's folders (${sent[2]?.error ?? 'read'})`);

  fs.rmSync(documents, { recursive: true, force: true });
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
