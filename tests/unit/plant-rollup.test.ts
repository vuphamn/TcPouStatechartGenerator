// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The plant roll-up (gateway/plant.cjs): a gateway's summary (its OEE report over 24 h and 7 days, its planned time,
// its top reasons, its alarms an hour, its open alerts), the plant's totals (OEE and availability weighted by planned
// time; downtime, stops, alerts summed; one away left out), its text for the email
/* eslint-disable @typescript-eslint/no-require-imports */
const { summaryOf, totalsOf, textOf } = require('../../gateway/plant.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(() => {
  const H = 3600000;
  const now = Date.parse('2026-10-16T12:00:00Z');
  const asked: number[] = [];
  const report = ({ from, to }: { from: number; to: number }) => {
    asked.push(to - from);
    const week = to - from > 2 * 86400000;
    return { line: { oee: week ? 0.6 : 0.5, availability: 0.8, performance: 0.9, quality: null, downMs: week ? 10 * H : 2 * H, stops: week ? 40 : 6 }, machines: [{ plannedMs: week ? 100 * H : 20 * H }, { plannedMs: week ? 60 * H : 4 * H }], pareto: { reason: [{ key: 'Jam', ms: 5 * H, count: 9 }, { key: 'Tool change', ms: 3 * H, count: 4 }, { key: 'Other', ms: H, count: 2 }, { key: 'x', ms: 1, count: 1 }] } };
  };
  const events = [{ resolvedAt: null, event: 'error' }, { resolvedAt: 'x', event: 'error' }, { resolvedAt: null, event: 'recovered' }, { resolvedAt: null, event: 'stuck', muted: 'maintenance' }];
  const s = summaryOf({ name: 'Line 2', report, events, alarmHealth: () => ({ perHour: 3.5 }), now });
  expect(s.name === 'Line 2' && asked.join() === `${86400000},${7 * 86400000}` && s.week.oee === 0.6 && s.week.plannedMs === 160 * H && s.day.plannedMs === 24 * H && s.top.length === 3 && s.top[0].reason === 'Jam' && s.alarmsPerHour === 3.5 && s.openAlerts === 1, `a summary: OEE ${s.week.oee} (7 days, ${s.week.plannedMs / H} h planned), top ${s.top.map((x: { reason: string }) => x.reason)}, ${s.openAlerts} open`);
  const rows = [
    { name: 'A', day: { oee: 0.5, availability: 0.8, downMs: 2 * H, stops: 6, plannedMs: 20 * H }, week: { oee: 0.6, availability: 0.8, downMs: 10 * H, stops: 40, plannedMs: 100 * H }, openAlerts: 2, alarmsPerHour: 1 },
    { name: 'B', day: { oee: 0.8, availability: 0.9, downMs: H, stops: 2, plannedMs: 60 * H }, week: { oee: 0.9, availability: 1, downMs: 2 * H, stops: 5, plannedMs: 300 * H }, openAlerts: 1, alarmsPerHour: 2 },
    { name: 'C', day: { oee: null, availability: null, downMs: 0, stops: 0, plannedMs: 0 }, week: { oee: null, availability: null, downMs: 0, stops: 0, plannedMs: 0 }, openAlerts: 0, alarmsPerHour: 0 },
  ];
  const t = totalsOf(rows);
  expect(Math.abs(t.week.oee - (0.6 * 100 + 0.9 * 300) / 400) < 1e-9 && Math.abs(t.day.oee - (0.5 * 20 + 0.8 * 60) / 80) < 1e-9 && Math.abs(t.week.availability - 0.95) < 1e-9 && t.week.downMs === 12 * H && t.week.stops === 45 && t.openAlerts === 3 && t.week.plannedMs === 400 * H, `totals: OEE ${t.week.oee.toFixed(3)} (weighted by planned time; one with none left out), ${t.week.stops} stops, ${t.openAlerts} open`);
  const text = textOf([...rows, { name: 'D', away: true, message: 'Not reached' }], t);
  expect(/^A: OEE 60 % the last 7 days \(50 % the last 24 h\)/.test(text) && /D: not answering \(Not reached\)/.test(text) && /The plant: OEE 83 %/.test(text), `its text: ${text.split('\n')[0]} … ${text.split('\n').at(-1)}`);
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
