// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// CRC errors by port (gateway/risk.cjs cableOf, risks): the port with most of a box's errors this week named with the
// cable there: port A its incoming one (from the box its PortABoxInfo names, or the master), ports B … D the cable to
// the box cabled there (its own PortABoxInfo naming this box and port); no ports counted: as before
/* eslint-disable @typescript-eslint/no-require-imports */
const { risks, cableOf } = require('../../gateway/risk.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(() => {
  const box = (name: string, boxId: number, portA: Record<string, unknown> | null, crcPorts: number[] | null) => ({ name, path: `D^${name}`, device: 'Device 1', boxId, portA, week: { seen: 100, notOp: 0, daysOut: 0, crc: (crcPorts ?? [0]).reduce((a, x) => a + x, 0), crcPorts } });
  const ek = box('Term 1 (EK1100)', 1, { master: true, port: 0 }, [60, 0, 0, 0]);
  const coupler = box('Term 5 (EK1122)', 5, { box: 1, port: 1 }, [0, 0, 80, 0]);
  const branch = box('Box 9 (EP2008)', 9, { box: 5, port: 2 }, [3, 0, 0, 0]);
  const old = box('Box 12 (EL1008)', 12, { box: 5, port: 3 }, null);
  old.week.crc = 70;
  const boxes = [ek, coupler, branch, old];
  expect(/port A, its incoming cable \(from the master\)/.test(cableOf(ek, boxes) ?? '') && /port C, the cable to Box 9 \(EP2008\)/.test(cableOf(coupler, boxes) ?? '') && /port A, its incoming cable \(from Term 5 \(EK1122\)\)/.test(cableOf(branch, boxes) ?? '') && cableOf(old, boxes) === null, `cables: ${cableOf(coupler, boxes)}; ${cableOf(branch, boxes)}`);
  const out = risks({ fleet: [{ id: 'line', name: 'Line 3', boxes }] });
  const r = (n: string) => out.find((x: { name: string; id: string }) => x.name === n && x.id.startsWith('box-crc'))?.reason;
  expect(r('Term 5 (EK1122)') === '80 CRC errors in 7 days, most at port C, the cable to Box 9 (EP2008): that cable, its connectors' && r('Box 12 (EL1008)') === '70 CRC errors in 7 days: its cable or connectors', `the risk list: "${r('Term 5 (EK1122)')}"; without ports: "${r('Box 12 (EL1008)')}"`);
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
