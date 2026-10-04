// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The connection check's last word on the PLC itself, once it answers: Run, nothing to add; Stop, a hint (its values
// frozen); Invalid (its runtime there, no program loaded: a PLC that is not started, or whose license ran out) or
// another state, a failing step: no more "All good: go live" for a PLC with nothing to go live on
/* eslint-disable @typescript-eslint/no-require-imports */
const { plcStateStep } = require('../../shared/tcCheck.cjs');
/* eslint-enable @typescript-eslint/no-require-imports */

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

expect(plcStateStep('Run', 851) === null, 'Run: nothing to add');
const stop = plcStateStep('Stop', 851);
expect(stop?.id === 'plc' && stop.ok === null && /stopped/.test(stop.title) && /frozen/.test(stop.detail), `Stop: a hint (${stop?.title})`);
const invalid = plcStateStep('Invalid', 851);
expect(invalid?.ok === false && /runs no program \(state: Invalid\)/.test(invalid.title) && /Login/.test(invalid.detail) && /license/.test(invalid.detail), `Invalid: failing (${invalid?.title})`);
const other = plcStateStep('Init', 852);
expect(other?.ok === false && /port 852/.test(other.title), `another state: failing, its port said (${other?.title})`);
expect(plcStateStep('', 851)?.ok === false && /unknown/.test(plcStateStep('', 851)!.title), 'no state: failing, said unknown');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
