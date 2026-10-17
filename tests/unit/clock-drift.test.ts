// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// A PLC clock's drift (gateway/load.cjs driftOf): the slope of its offsets against the gateway's clock, in ms a day;
// none from under 30 minutes of them or under 3 samples
/* eslint-disable @typescript-eslint/no-require-imports */
const { driftOf } = require('../../gateway/load.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(() => {
  const M = 60000;
  // (1 s a day ahead more: 1000 ms / 1440 minutes, each minute; its noise ±5 ms)
  const samples = Array.from({ length: 120 }, (_, i) => ({ t: i * M, offsetMs: 300 + (1000 / 1440) * i + (i % 2 ? 5 : -5) }));
  const d = driftOf(samples);
  expect(Math.abs(d - 1000) < 20 && driftOf(samples.slice(0, 20)) === null && driftOf(samples.slice(0, 2)) === null && Math.abs(driftOf(samples.map((x) => ({ ...x, offsetMs: 300 })))) < 1e-9, `drift: ${d?.toFixed(1)} ms a day; none from 20 minutes or 2 samples; a steady one 0`);
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
