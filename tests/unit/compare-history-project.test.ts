// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Where two sessions part (src/utils/liveComparison.ts firstDifference): aligned from the first state both leave,
// the first step where one goes elsewhere or ends; none when the same. The build history beside the PLC project
// (shared/tcCompileInfo.cjs recordProjectBuilds): _CompileInfo's builds kept in MachineScope.builds.json, written only
// when one is new, an older one still known after XAE replaced it. The project's coverage (src/utils/projectCoverage.ts):
// every state machine against the transitions seen per POU type, its CSVs
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { firstDifference } from '../../src/utils/liveComparison.ts';
import { projectCoverage, projectCoverageCsv, projectTransitionsCsv } from '../../src/utils/projectCoverage.ts';
import { SAMPLES } from '../../src/samples/samplesData.ts';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { recordProjectBuilds, buildHistory, HISTORY_FILE } = require('../../shared/tcCompileInfo.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }).localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => void store.set(k, v),
  removeItem: (k) => void store.delete(k),
};

(async () => {
  // ---- firstDifference ----
  const tr = (t: number, from: string, to: string) => ({ t, from, to, dwellMs: 1000, inModel: true });
  const a = [tr(1, 'IDLE', 'RUN'), tr(2, 'RUN', 'IDLE'), tr(3, 'IDLE', 'RUN'), tr(4, 'RUN', 'DONE')];
  const b = [tr(10, 'START', 'IDLE'), tr(11, 'IDLE', 'RUN'), tr(12, 'RUN', 'IDLE'), tr(13, 'IDLE', 'RUN'), tr(14, 'RUN', 'ERROR')];
  const d = firstDifference(a, b);
  expect(d?.startA === 0 && d.startB === 1 && d.same === 3 && d.state === 'RUN' && d.a?.to === 'DONE' && d.b?.to === 'ERROR', `aligned from IDLE (B's START left out), parted after 3 in RUN (${JSON.stringify({ ...d, a: d?.a?.to, b: d?.b?.to })})`);
  expect(firstDifference(a, a) === null, 'the same: none');
  const shorter = firstDifference(a.slice(0, 2), a);
  expect(shorter?.same === 2 && shorter.a === null && shorter.b?.to === 'RUN' && shorter.state === 'IDLE', 'one ends first: it ends there');
  const apart = firstDifference([tr(1, 'X', 'Y')], [tr(1, 'P', 'Q')]);
  expect(apart?.state === null && apart.same === 0, 'no state in common: their start');

  // ---- the build history beside the PLC project ----
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-build-history-'));
  const plc = path.join(dir, 'PLC');
  fs.mkdirSync(path.join(plc, '_CompileInfo'), { recursive: true });
  fs.mkdirSync(path.join(plc, 'POUs'));
  fs.writeFileSync(path.join(plc, 'PLC.plcproj'), '<Project/>');
  const pou = path.join(plc, 'POUs', 'SM_A.TcPOU');
  fs.writeFileSync(pou, '<TcPlcObject/>');
  const B1 = 'A745ADEC-C77E-C4C4-A4FC-3BA80BF4A2CC';
  const B2 = 'E83231B4-9806-EB68-87CD-2C0EF6A2578B';
  const info = (id: string, at: string) => {
    const f = path.join(plc, '_CompileInfo', `${id}.compileinfo`);
    fs.writeFileSync(f, 'x');
    fs.utimesSync(f, new Date(at), new Date(at));
  };
  info(B1, '2026-10-08T20:42:44Z');
  let list = recordProjectBuilds(pou);
  const file = path.join(plc, HISTORY_FILE);
  expect(list.length === 1 && list[0].id === B1 && fs.existsSync(file), `the first build: kept in ${HISTORY_FILE}`);
  const written = fs.statSync(file).mtimeMs;
  // (XAE builds again: the old compile info replaced by the new one)
  fs.rmSync(path.join(plc, '_CompileInfo', `${B1}.compileinfo`));
  info(B2, '2026-10-09T00:05:02Z');
  list = recordProjectBuilds(pou);
  expect(list.length === 2 && list[0].id === B2 && list[1].id === B1 && list[1].at.startsWith('2026-10-08T20:42:44'), `XAE replaced it: both known, newest first (${list.map((x: { id: string }) => x.id.slice(0, 8))})`);
  expect(buildHistory(pou).length === 2 && /Commit it with the project/.test(fs.readFileSync(file, 'utf8')), 'the file: both builds and what it is for');
  const again = fs.readFileSync(file, 'utf8');
  await new Promise((r) => setTimeout(r, 20));
  recordProjectBuilds(pou);
  expect(fs.readFileSync(file, 'utf8') === again && fs.statSync(file).mtimeMs >= written, 'nothing new: the file not written again');
  fs.rmSync(dir, { recursive: true, force: true });

  // ---- the project's coverage ----
  const s = SAMPLES[0];
  const name = /<POU\b[^>]*\bName="([^"]+)"/.exec(s.pouContent)![1];
  const other = SAMPLES.find((x) => x.id !== s.id && /<Method\b[^>]*\bName="doState"/i.test(x.pouContent))!;
  const otherName = /<POU\b[^>]*\bName="([^"]+)"/.exec(other.pouContent)![1];
  const files = {
    project: 'Line202',
    pous: [
      { name: `${name}.TcPOU`, content: s.pouContent },
      { name: `${otherName}.TcPOU`, content: other.pouContent },
      { name: 'FB_Helper.TcPOU', content: '<TcPlcObject><POU Name="FB_Helper"><Declaration>FUNCTION_BLOCK FB_Helper</Declaration></POU></TcPlcObject>' },
    ],
    duts: [
      { name: 'E_A.TcDUT', relativePath: 'E_A.TcDUT', content: s.dutContent },
      { name: 'E_B.TcDUT', relativePath: 'E_B.TcDUT', content: other.dutContent },
    ],
  };
  const pc0 = await projectCoverage(files);
  const first = pc0?.pous.find((p) => p.name === name);
  const t = first?.coverage.rows[0];
  // (one of the first POU's transitions taken live here)
  store.set(`kss.seen.${name}`, JSON.stringify({ [`${t!.from}->${t!.to}`]: { n: 3, last: Date.parse('2026-10-08T12:00:00Z') } }));
  const pc = await projectCoverage(files);
  const x = pc?.pous.find((p) => p.name === name);
  const y = pc?.pous.find((p) => p.name === otherName);
  expect(!!pc && pc.pous.length === 2 && x!.coverage.taken === 1 && x!.coverage.total > 5 && y!.coverage.taken === 0 && pc.taken === 1 && pc.total === x!.coverage.total + y!.coverage.total, `two state machines (the helper left out): ${name} 1 / ${x?.coverage.total}, ${otherName} 0 / ${y?.coverage.total}`);
  const csv = projectCoverageCsv(pc!);
  expect(csv.startsWith('POU,Transitions taken,Transitions,Coverage %') && new RegExp(`\\n${name},1,${x!.coverage.total},`).test(csv) && /\nAll,1,/.test(csv), 'its CSV: one row per state machine, the whole');
  const all = projectTransitionsCsv(pc!);
  expect(all.split('\n').filter((l) => l.trim()).length === 1 + pc!.total && new RegExp(`\\n${name},${t!.from},${t!.to},3,2026-10-08T12:00:00.000Z,yes`).test(all), 'every transition: its POU, how often, when');

  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
