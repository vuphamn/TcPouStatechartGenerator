// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The coverage counts beside the PLC project (shared/coverageFile.cjs): merged by the highest count and the latest
// time, written only when that adds something, stable text; merged into this browser's (mergeSeenCounts: what was
// learned here kept). The sign-off report (coverageReportHtml): the whole, the never-taken, lines to sign. The project
// opened in the XAE of its committed version (openXaeForProject, KSS_BUILD_DRYRUN: nothing started): its solution,
// whether the Remote Manager has that build
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mergeSeenCounts, seenCounts, type SeenMap } from '../../src/utils/seenTransitions.ts';
import { coverageReportHtml, type ProjectCoverage } from '../../src/utils/projectCoverage.ts';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCoverageFile, mergeCoverageFile, COVERAGE_FILE } = require('../../shared/coverageFile.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { openXaeForProject } = require('../../shared/projectVersions.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-coverage-file-'));
  const plc = path.join(dir, 'Machine', 'PLC');
  fs.mkdirSync(path.join(plc, 'POUs'), { recursive: true });
  fs.writeFileSync(path.join(plc, 'PLC.plcproj'), '<Project/>');
  fs.writeFileSync(path.join(dir, 'Machine', 'Machine.tsproj'), '<TcSmProject TcVersion="3.1.4026.27"/>');
  fs.writeFileSync(path.join(dir, 'Machine.sln'), '');
  const pou = path.join(plc, 'POUs', 'SM_A.TcPOU');
  fs.writeFileSync(pou, '<TcPlcObject/>');
  const file = path.join(plc, COVERAGE_FILE);

  // ---- the counts file ----
  expect(Object.keys(readCoverageFile(pou).pous).length === 0, 'no file: no counts');
  let r = mergeCoverageFile(pou, 'SM_A', { 'IDLE->RUN': { n: 3, last: 1000 }, 'RUN->IDLE': { n: 1, last: 900 }, bogus: { n: 1 }, 'RUN->DONE': { n: 0, last: 1 } });
  expect(r.counts && Object.keys(r.counts).join() === 'IDLE->RUN,RUN->IDLE' && fs.existsSync(file), `written, the bad ones left out (${Object.keys(r.counts ?? {})})`);
  // (a colleague's: fewer IDLE->RUN, a later RUN->IDLE, one more)
  r = mergeCoverageFile(pou, 'SM_A', { 'IDLE->RUN': { n: 2, last: 500 }, 'RUN->IDLE': { n: 1, last: 2000 }, 'RUN->ERROR': { n: 1, last: 1500 } });
  expect(r.counts['IDLE->RUN'].n === 3 && r.counts['IDLE->RUN'].last === 1000 && r.counts['RUN->IDLE'].last === 2000 && r.counts['RUN->ERROR'].n === 1, 'merged: the highest count, the latest time, the new one added');
  mergeCoverageFile(pou, 'SM_B', { 'X->Y': { n: 1, last: 1 } });
  const text = fs.readFileSync(file, 'utf8');
  expect(/"SM_A": \{\n {6}"IDLE->RUN": \{ "n": 3, "last": 1000 \},\n {6}"RUN->ERROR"/.test(text) && text.indexOf('"SM_A"') < text.indexOf('"SM_B"') && /Commit it with the project/.test(text), 'the file: sorted, one transition a line, what it is for');
  fs.utimesSync(file, new Date(2000, 0, 1), new Date(2000, 0, 1));
  mergeCoverageFile(pou, 'SM_A', { 'IDLE->RUN': { n: 1, last: 10 } });
  expect(fs.statSync(file).mtime.getFullYear() === 2000 && fs.readFileSync(file, 'utf8') === text, 'nothing new: not written again');
  expect(Object.keys(readCoverageFile(pou).pous).sort().join() === 'SM_A,SM_B', 'read back: both POU types');

  // ---- merged into this browser's ----
  const mine: SeenMap = { 'IDLE->RUN': { n: 1, last: 50, condition: 'bStart' }, 'RUN->DONE': { n: 2, last: 3000 } };
  const merged = mergeSeenCounts(mine, readCoverageFile(pou).pous.SM_A);
  expect(merged['IDLE->RUN'].n === 3 && merged['IDLE->RUN'].condition === 'bStart' && merged['RUN->DONE'].n === 2 && merged['RUN->ERROR'].n === 1, "merged into this browser's: the learned condition kept, its own kept, the others' added");
  expect(mergeSeenCounts(merged, readCoverageFile(pou).pous.SM_A) === merged, 'nothing new: the same object (no re-render)');
  expect(JSON.stringify(seenCounts(mine)) === JSON.stringify({ 'IDLE->RUN': { n: 1, last: 50 }, 'RUN->DONE': { n: 2, last: 3000 } }), 'the counts written: count and time only');

  // ---- the sign-off report ----
  const p: ProjectCoverage = {
    project: 'Line202',
    taken: 3,
    total: 5,
    pous: [
      { name: 'SM_A', coverage: { taken: 2, total: 3, rows: [{ from: 'IDLE', to: 'RUN', n: 3, last: 1 }, { from: 'RUN', to: 'IDLE', n: 1, last: 1 }, { from: 'RUN', to: 'ERROR', n: 0, last: null }] } },
      { name: 'SM_B', coverage: { taken: 1, total: 2, rows: [{ from: 'X', to: 'Y', n: 1, last: 1 }, { from: 'Y', to: '<Z>', n: 0, last: null }] } },
    ],
  };
  const html = coverageReportHtml(p, new Date('2026-10-09T12:00:00Z'));
  expect(/<b>3 of 5<\/b> transitions taken \(60%\)/.test(html) && /RUN → ERROR/.test(html) && /Y → &lt;Z&gt;/.test(html) && /Commissioned by/.test(html) && /Signature/.test(html) && !/IDLE → RUN<\/div>/.test(html), 'the report: the whole, the never-taken (escaped), the lines to sign');

  // (live on two PLCs: the comparison in the report too)
  const tr = (t: number, from: string, to: string) => ({ t, from, to, dwellMs: 1500, inModel: true });
  const withCmp = coverageReportHtml(p, new Date('2026-10-09T12:00:00Z'), [
    { a: { label: 'CX-A', transitions: [tr(1, 'IDLE', 'RUN'), tr(2, 'RUN', 'IDLE'), tr(3, 'IDLE', 'RUN'), tr(4, 'RUN', 'DONE')] }, b: { label: 'CX-B', transitions: [tr(1, 'IDLE', 'RUN'), tr(2, 'RUN', 'IDLE'), tr(3, 'IDLE', 'RUN'), tr(4, 'RUN', 'ERROR')] } },
  ]);
  expect(/Compared live: CX-A and CX-B/.test(withCmp) && /First difference, after 3 transitions the same: in <span class="mono">RUN<\/span>/.test(withCmp) && /CX-A from there/.test(withCmp) && /RUN → DONE <span class="muted">1\.5 s/.test(withCmp) && /Only CX-B took/.test(withCmp) && /RUN → ERROR \(1×\)/.test(withCmp) && withCmp.indexOf('Compared live') < withCmp.indexOf('Commissioned by'), 'the report with a comparison: where they part, both paths, what only one took, before the lines to sign');
  expect(!/Compared live/.test(html), 'without one: none');

  // ---- the report's heading (MachineScope.report.json beside the project) ----
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readReportSettings, REPORT_SETTINGS_FILE } = require('../../shared/reportSettings.cjs');
  expect(Object.keys(readReportSettings(pou)).length === 0, 'no settings file: no heading');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  fs.mkdirSync(path.join(plc, 'img'));
  fs.writeFileSync(path.join(plc, 'img', 'logo.png'), png);
  fs.writeFileSync(path.join(plc, REPORT_SETTINGS_FILE), '﻿{ "company": "Kval Inc.", "machine": " Line 202 ", "logo": "img/logo.png" }');
  const hs = readReportSettings(pou);
  expect(hs.company === 'Kval Inc.' && hs.machine === 'Line 202' && hs.logo === `data:image/png;base64,${png.toString('base64')}` && !hs.error, 'read: the company, the machine (trimmed), the logo embedded');
  fs.writeFileSync(path.join(plc, REPORT_SETTINGS_FILE), '{ "company": "Kval", "logo": "logo.bmp" }');
  expect(/must be a \.png/.test(readReportSettings(pou).error ?? '') && readReportSettings(pou).company === 'Kval', 'a logo of another type: said, the rest kept');
  fs.writeFileSync(path.join(plc, REPORT_SETTINGS_FILE), '{ not json');
  expect(/is not readable/.test(readReportSettings(pou).error ?? ''), 'a broken file: said');
  const headed = coverageReportHtml(p, new Date('2026-10-09T12:00:00Z'), [], hs);
  expect(/<div class="heading"><img src="data:image\/png;base64,/.test(headed) && /<div class="company">Kval Inc\.<\/div>/.test(headed) && /<div class="machine">Line 202<\/div>/.test(headed) && headed.indexOf('class="heading"') < headed.indexOf('<h1>'), 'the report: its heading above the title');
  const badLogo = coverageReportHtml(p, new Date(), [], { company: '<b>X</b>', logo: 'javascript:alert(1)' });
  expect(!/<img/.test(badLogo) && /&lt;b&gt;X&lt;\/b&gt;/.test(badLogo), 'only an image data URL becomes the logo; the names escaped');

  // ---- the project in the XAE of its committed version ----
  process.env.KSS_BUILD_DRYRUN = '1';
  process.env.KSS_RM_BUILDS = '4026.27,4026.3';
  const o = await openXaeForProject(pou, '3.1.4024.59');
  expect(o.ok && path.basename(o.file) === 'Machine.sln' && o.build === 4024 && o.remoteManager === false && /Its Remote Manager has no 4024\.59 here \(4026\.27, 4026\.3\)/.test(o.message), `4024.59: its solution, the Remote Manager without it said (${o.message})`);
  const o2 = await openXaeForProject(pou, '3.1.4026.27');
  expect(o2.ok && o2.remoteManager === true && /Choose 4026\.27 in its Remote Manager/.test(o2.message), `4026.27: in the Remote Manager (${o2.message})`);
  const none = await openXaeForProject(path.join(dir, 'loose.TcPOU'), '3.1.4024.59');
  expect(!none.ok && /not in a TwinCAT project/.test(none.message), 'a POU outside a project: said');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
