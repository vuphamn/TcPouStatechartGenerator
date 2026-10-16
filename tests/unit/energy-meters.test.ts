// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Energy meters (gateway/energy.cjs): a meter checked (its unit: an energy counter or a power; not another unit),
// its energy over a window (a counter's rises in kWh, a reset counted from zero; a power held and integrated)
/* eslint-disable @typescript-eslint/no-require-imports */
const { meterOf, kwhOf } = require('../../gateway/energy.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(() => {
  const H = 3600000;
  const wh = meterOf({ plc: 'line', name: 'Feed', var: 'GVL.nWh', unit: 'Wh' });
  const kw = meterOf({ plc: 'line', var: 'GVL.fPower', unit: 'kW', machines: ['MAIN.a'] });
  const w = meterOf({ plc: 'line', var: 'GVL.nPower', unit: 'W', scale: 0.1 });
  expect(wh?.kind === 'energy' && wh.factor === 0.001 && kw?.kind === 'power' && kw.name === 'GVL.fPower' && kw.machines[0] === 'MAIN.a' && w?.factor === 0.0001 && meterOf({ plc: 'line', var: 'x', unit: 'A' }) === null && meterOf({ plc: 'line', var: ' ' }) === null, `meters: ${wh?.kind} ×${wh?.factor}, ${kw?.kind}, W scaled ×${w?.factor}; amperes and no variable refused`);
  // (a counter in Wh: 1000 → 3000, reset, → 500: 2.5 kWh)
  const e = kwhOf(wh, [{ t: 0, v: 1000 }, { t: H, v: 3000 }, { t: 2 * H, v: 0 }, { t: 3 * H, v: 500 }], 0, 4 * H);
  // (a power: 2 kW for 1 h, then 4 kW for 30 min, the window ending there)
  const p = kwhOf(kw, [{ t: 0, v: 2 }, { t: H, v: 4 }], 0, 1.5 * H);
  // (a power before the window starts: counted from the window's start)
  const p2 = kwhOf(kw, [{ t: -H, v: 10 }, { t: H, v: 0 }], 0, 2 * H);
  expect(Math.abs(e - 2.5) < 1e-9 && Math.abs(p - 4) < 1e-9 && Math.abs(p2 - 10) < 1e-9 && kwhOf(wh, [], 0, H) === null, `energy: a counter ${e} kWh; a power ${p} kWh; from the window's start ${p2} kWh; nothing recorded: null`);
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
