// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The risk list's drive forecasts (gateway/risk.cjs): the heatsink to its threshold, the motor's i²t and the device's
// ixt (their daily 90 %) to 90 % ("near tripping in about N days"), the current per Hz to 20 % above its first days;
// flat ones and ones already there not forecast; warn within 14 days, watch within 90
/* eslint-disable @typescript-eslint/no-require-imports */
const { risks } = require('../../gateway/risk.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(() => {
  const day = (k: number) => {
    const d = new Date(2026, 9, 16 - k);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const series = (f: (i: number) => Record<string, number>) => Array.from({ length: 10 }, (_, i) => ({ day: day(9 - i), heatsink: 40, ...f(i) }));
  const drive = (path: string) => ({ path, name: path, device: 'Device 1', latest: {}, health: { level: 'ok', findings: [] } });
  const daily = {
    line: {
      A: series((i) => ({ motorI2t: 60 + 3 * i })), // 87 now, +3 a day: 90 in 1 day (warn)
      B: series((i) => ({ deviceIxt: 40 + 0.6 * i })), // 45.4 now, +0.6 a day: 90 in ~74 days (watch)
      C: series((i) => ({ currentPerHz: 0.1 * (1 + 0.01 * i) })), // +1 % a day: 20 % above in ~11 days (warn)
      D: series((i) => ({ motorI2t: 50, currentPerHz: 0.1 })), // flat
      E: series((i) => ({ motorI2t: 91 + i * 0.1 })), // already over 90: its health says so, no forecast
    },
  };
  const out = risks({ drives: [{ id: 'line', name: 'Line 3', drives: ['A', 'B', 'C', 'D', 'E'].map(drive) }], daily });
  const of = (path: string) => out.filter((r: { path?: string; id: string }) => r.path === path && r.id.startsWith('drive-') && !r.id.startsWith('drive:'));
  const a = of('A')[0];
  const b = of('B')[0];
  const c = of('C')[0];
  expect(a?.id.startsWith('drive-motorI2t') && a.level === 'warn' && a.eta === 1 && /Motor i²t rising 3 % a day \(10 days, now 87 %\): near tripping \(90 %\) in about 1 day$/.test(a.reason), `i²t: ${a?.level} "${a?.reason}"`);
  expect(b?.id.startsWith('drive-deviceIxt') && b.level === 'watch' && b.eta >= 70 && b.eta <= 78, `ixt: ${b?.level} in ${b?.eta} days`);
  expect(c?.id.startsWith('drive-current') && c.level === 'warn' && c.eta >= 9 && c.eta <= 13 && /Current at the same speed rising 1 % a day/.test(c.reason), `current per Hz: ${c?.level} "${c?.reason}"`);
  expect(!of('D').length && !of('E').length, 'flat ones, and one already near tripping: not forecast');
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
