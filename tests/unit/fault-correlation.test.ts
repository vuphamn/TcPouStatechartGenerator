// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// What changes before a fault (gateway/faultCorrelation.cjs): over a machine's fault records into one state, the
// signal that changed in the 10 s before 3 of 4 of them (rarely otherwise) first, with its value just before; one that
// changes all the time (a clock) not; another machine's state by its name; the faulting machine itself left out
/* eslint-disable @typescript-eslint/no-require-imports */
const { correlate } = require('../../gateway/faultCorrelation.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(() => {
  const S = 1000;
  const record = (at: number, sensorDrops: boolean, conveyorStops: boolean) => {
    const from = at - 60 * S;
    // (a clock signal: changes every 2 s, all the minute)
    const tick = Array.from({ length: 31 }, (_, i) => ({ t: from + i * 2 * S, v: i % 2 }));
    return {
      at, from, machine: 'MAIN.aDoors[2]', state: 'DOOR_ERROR',
      stateNames: { 'MAIN.conveyor': { 1: 'RUNNING', 4: 'STOPPED' } },
      machines: { 'MAIN.aDoors[2]': [{ t: from, v: 1 }, { t: at, v: 7 }], 'MAIN.conveyor': conveyorStops ? [{ t: from, v: 1 }, { t: at - 4 * S, v: 4 }] : [{ t: from, v: 1 }] },
      signals: { 'MAIN.bSensorS12': sensorDrops ? [{ t: from, v: true }, { t: at - 3 * S, v: false }] : [{ t: from, v: true }], 'MAIN.bClock': tick },
    };
  };
  const records = [record(1e7, true, true), record(2e7, true, false), record(3e7, true, true), record(4e7, false, false)];
  const out = correlate(records);
  const names = out.map((x: { name: string }) => x.name);
  const s12 = out[0];
  const conv = out.find((x: { name: string }) => x.name === 'MAIN.conveyor');
  expect(s12?.name === 'MAIN.bSensorS12' && s12.hits === 3 && s12.of === 4 && s12.usualRate === 0 && s12.before === false && conv?.kind === 'machine' && conv.hits === 2 && conv.before === 'STOPPED' && !names.includes('MAIN.bClock') && !names.includes('MAIN.aDoors[2]'), `before the fault: ${out.map((x: { name: string; hits: number; of: number; before: unknown }) => `${x.name} ${x.hits}/${x.of} (just before ${String(x.before)})`).join('; ')}; a clock signal and the machine itself left out`);
  expect(correlate([records[0]]).length === 0, 'one record alone: nothing said (at least 2)');
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
