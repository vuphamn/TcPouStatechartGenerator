// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The operator board's tree (utils/boardTree.ts): machines nested by their symbol paths under the root, array
// elements under their array, a lone group joined with its child, the problems rolled up, the rules' coverage; and its
// playback (utils/boardPlayback.ts): the state at a time, the stays in a window, the change times
import { covers, keysUnder, machineTree, pathParts, rollup, type Health } from '../../src/utils/boardTree.ts';
import { changeTimes, indexAt, stateAt, staysOf, type PlaybackMachine } from '../../src/utils/boardPlayback.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const R = 'MAIN.mainStateMachine';
const m = (path: string, health: Health = 'ok') => ({ path, health });
const machines = [
  m(R),
  m(`${R}.smTable2`),
  m(`${R}.smTable1`, 'stuck'),
  m(`${R}.aDoors[10]`),
  m(`${R}.aDoors[2]`, 'error'),
  m(`${R}.stations.station1.smClamp`),
  m('MAIN.conveyor'),
];
expect(pathParts(`${R}.aDoors[2].sm`).join(' ') === 'MAIN mainStateMachine aDoors [2] sm', 'a path in parts, an index its own');
const tree = machineTree(machines, R);
const main = tree.find((n) => n.key === R.toLowerCase());
const conveyor = tree.find((n) => n.key === 'main.conveyor');
expect(tree.length === 2 && !!main?.machine && !!conveyor?.machine, `two tops: the root machine and one outside it (${tree.map((n) => n.label).join(', ')})`);
const labels = main!.children.map((c) => c.label);
expect(labels.join(',') === 'aDoors,smTable1,smTable2,stations.station1', `under the root, by name: ${labels.join(', ')}`);
const doors = main!.children.find((c) => c.label === 'aDoors')!;
expect(!doors.machine && doors.children.map((c) => c.label).join(',') === '[2],[10]', `aDoors' elements by index: ${doors.children.map((c) => c.label).join(', ')}`);
const station = main!.children.find((c) => c.label === 'stations.station1')!;
expect(station.children[0]?.label === 'smClamp' && station.children[0].machine?.path === `${R}.stations.station1.smClamp`, 'a lone group joined with its child: stations.station1 › smClamp');
const r = rollup(main!, (x) => x.health);
expect(r.worst === 'error' && r.error === 1 && r.stuck === 1 && r.machines === 6, `rolled up under the root: worst ${r.worst}, ${r.error} error, ${r.stuck} stuck, ${r.machines} machines`);
expect(rollup(doors, (x) => x.health).worst === 'error' && keysUnder(doors).length === 3, 'aDoors: its worst, its keys with its elements');
const rule = { plc: 'l1', root: R, machines: null };
expect(covers(rule, 'l1', `${R}.smTable1`) && covers(rule, 'l1', R) && !covers(rule, 'l1', 'MAIN.conveyor') && !covers(rule, 'l2', R), 'a rule without machines covers its root and under it, on its PLC');
const own = { plc: 'l1', root: R, machines: [`${R}.smTable1`], enabled: true };
expect(covers(own, 'l1', `${R}.SMTABLE1`) && !covers(own, 'l1', `${R}.smTable2`) && !covers({ ...own, enabled: false }, 'l1', `${R}.smTable1`), 'a rule with its own machines: only those (any case), not when off');

const pm: PlaybackMachine = { plc: 'l1', path: `${R}.smTable1`, recording: 'r', stateNames: { '1': 'IDLE', '2': 'RUN' }, values: [{ t: 1000, value: 1 }, { t: 2000, value: 1 }, { t: 3000, value: 2 }, { t: 5000, value: 1 }] };
expect(indexAt(pm.values, 999) === -1 && indexAt(pm.values, 3000) === 2 && indexAt(pm.values, 9999) === 3, 'indexAt: none before, the one at, the last');
const s = stateAt(pm, 2500);
expect(s?.name === 'IDLE' && s.since === 1000 && stateAt(pm, 500) === null && stateAt(pm, 4000)?.name === 'RUN', `stateAt: IDLE since 1000 (a repeated value is not a new stay): ${JSON.stringify(s)}`);
const stays = staysOf(pm, 1500, 6000);
expect(stays.length === 3 && stays[0].from === 1500 && stays[0].to === 3000 && stays[1].name === 'RUN' && stays[2].to === 6000, `stays in the window: ${stays.map((x) => `${x.name} ${x.from}-${x.to}`).join(', ')}`);
expect(changeTimes([pm], 0, 10000).join(',') === '3000,5000', 'the change times (not the repeat)');
expect(stateAt({ ...pm, stateNames: {} }, 4000)?.name === '#2', 'a state without its name: #2');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
