// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Alarm health (gateway/alarmHealth.cjs): alarms an hour and the rating; the busiest 10 minutes; a flood (over 10 in 10
// minutes) and its share of time; the bad actors; chattering (3 within a minute); stale (open over 24 hours); time to
// acknowledge; muted ones apart; calls and recoveries not alarms; another PLC's left out.
/* eslint-disable @typescript-eslint/no-require-imports */
const { alarmHealth } = require('../../gateway/alarmHealth.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const H = 3600000;
const now = Date.UTC(2026, 9, 15, 12, 0, 0);
const from = now - 24 * H;
const iso = (t: number) => new Date(t).toISOString();
let n = 0;
const ev = (t: number, machine: string, extra: Record<string, unknown> = {}) => ({ id: `e${n++}`, event: 'error', plc: 'a', plcName: 'Line A', machine, state: 'X_ERROR', at: iso(t), ack: null, resolvedAt: iso(t + 60000), ...extra });
const events = [
  // a flood: 12 in 5 minutes (one door chattering: 3 in 40 s)
  ...Array.from({ length: 12 }, (_, i) => ev(from + 2 * H + i * 25000, i < 3 ? 'M.door' : `M.m${i}`)),
  // through the day: the door 6 more times, acknowledged after 2 minutes
  ...Array.from({ length: 6 }, (_, i) => ev(from + (4 + i * 3) * H, 'M.door', { ack: { by: 'ann', at: iso(from + (4 + i * 3) * H + 120000) } })),
  // stale: raised 30 hours ago, still open
  ev(now - 30 * H, 'M.press', { resolvedAt: null }),
  // muted, a call, a recovery, another PLC: not counted here
  ev(from + 5 * H, 'M.x', { muted: true }),
  ev(from + 6 * H, 'M.x', { event: 'call' }),
  ev(from + 7 * H, 'M.x', { event: 'recovered' }),
  ev(from + 8 * H, 'M.x', { plc: 'b' }),
];
const r = alarmHealth({ events, from, to: now, plcIds: ['a'], now });
expect(r.total === 18 && Math.abs(r.perHour - 0.75) < 1e-9 && r.rating === 'acceptable' && r.muted === 1, `${r.total} alarms, ${r.perHour.toFixed(2)} an hour (${r.rating}), ${r.muted} muted`);
expect(r.peak10.count === 12 && r.floods.length === 1 && r.floods[0].count === 12 && Math.abs(r.floodPct - (1 / 144) * 100) < 1e-6, `the busiest 10 minutes: ${r.peak10.count}; floods ${r.floods.length} (${r.floodPct.toFixed(2)} % of the time)`);
expect(r.top[0].machine === 'M.door' && r.top[0].count === 9 && Math.abs(r.top[0].share - 0.5) < 1e-9, `the worst: ${r.top[0].machine} ${r.top[0].count} (${Math.round(r.top[0].share * 100)} %)`);
expect(r.chattering.length === 1 && r.chattering[0].machine === 'M.door' && r.chattering[0].inAMinute === 3, `chattering: ${r.chattering.map((c: { machine: string; inAMinute: number }) => `${c.machine} ${c.inAMinute}`).join(', ')}`);
expect(r.stale.length === 1 && r.stale[0].machine === 'M.press', `stale: ${r.stale.map((s: { machine: string }) => s.machine).join(', ')}`);
expect(r.ack.count === 6 && r.ack.medianMs === 120000 && r.ack.notAcked === 12, `acknowledged: ${r.ack.count}, median ${r.ack.medianMs} ms, ${r.ack.notAcked} not`);
const busy = alarmHealth({ events: Array.from({ length: 30 }, (_, i) => ev(now - H + i * 100000, `M.b${i % 5}`)), from: now - 2 * H, to: now, now });
expect(busy.rating === 'overloaded' && busy.perHour === 15, `30 in 2 hours: ${busy.perHour} an hour, ${busy.rating}`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
