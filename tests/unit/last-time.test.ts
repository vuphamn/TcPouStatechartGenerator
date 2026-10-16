// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// "Last time this happened" (gateway/lastTime.cjs): the same machine in the same state before (the last 90 days:
// how often, the last time, its median time to recover, its note), not the alert asked about, nor another state,
// machine or PLC; the work orders done on it, those from an alert of that state first; its root causes; its guide;
// its earlier fault records
/* eslint-disable @typescript-eslint/no-require-imports */
const { lastTime } = require('../../gateway/lastTime.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(() => {
  const DAY = 86400000;
  const now = Date.parse('2026-10-16T12:00:00Z');
  const iso = (ms: number) => new Date(ms).toISOString();
  const M = 'MAIN.fbCell.aDoors[2]';
  const alert = (id: string, daysAgo: number, extra: Record<string, unknown> = {}) => ({ id, event: 'error', plc: 'line', machine: M, state: 'DOOR_ERROR', at: iso(now - daysAgo * DAY), resolvedAt: iso(now - daysAgo * DAY + 10 * 60000), ack: null, ...extra });
  const alerts = [
    alert('a1', 40),
    alert('a2', 12, { resolvedAt: iso(now - 12 * DAY + 30 * 60000), ack: { by: 'tech', note: 'cable at the hinge' } }),
    alert('a3', 5, { resolvedAt: iso(now - 5 * DAY + 20 * 60000) }),
    alert('old', 120),
    alert('other-state', 3, { state: 'DOOR_STUCK' }),
    alert('other-machine', 2, { machine: 'MAIN.fbCell.aDoors[3]' }),
    alert('other-plc', 2, { plc: 'press' }),
    alert('muted', 1, { muted: 'maintenance' }),
    alert('now', 0),
  ];
  const order = (number: number, daysAgo: number, rootCause: string, extra: Record<string, unknown> = {}) => ({ id: `o${number}`, number, title: 'Fix the door', plc: 'line', machine: M, status: 'done', doneAt: iso(now - daysAgo * DAY), rootCause, parts: '', assignee: 'tech', source: { kind: 'manual' }, ...extra });
  const orders = [
    order(1001, 30, 'Sensor loose'),
    order(1002, 11, 'Cable cut at the hinge', { parts: '2 m cable', source: { kind: 'alert', text: 'Line 9: aDoors[2] in DOOR_ERROR' }, attachments: [{ id: 'x' }] }),
    order(1003, 4, 'Sensor loose'),
    order(1004, 2, 'x', { status: 'in progress' }),
    order(1005, 2, 'x', { machine: 'MAIN.fbCell.aDoors[3]' }),
  ];
  const faults = [{ plc: 'line', machine: M, state: 'DOOR_ERROR', at: now - 12 * DAY }, { plc: 'line', machine: M, state: 'DOOR_ERROR', at: now - 5000 }, { plc: 'line', machine: M, state: 'DOOR_STUCK', at: now - DAY }];
  const r = lastTime({ alerts, orders, faults, guide: { id: 'g1', title: 'Door sensor reset', steps: [1, 2, 3] }, plc: 'line', machine: M.toLowerCase(), state: 'door_error', at: now, excludeId: 'now' });
  expect(r.before.count === 3 && r.before.last.at === iso(now - 5 * DAY) && r.before.recoverMs === 20 * 60000 && r.before.days === 90, `before: ${r.before.count}× (not 120 days ago, nor another state, machine, PLC, nor muted, nor itself), last ${r.before.last?.at}, recovered in ${r.before.recoverMs / 60000} min (the median)`);
  const n = (x: { number: number }[]) => x.map((o) => o.number).join(' ');
  expect(n(r.orders) === '1002 1003 1001' && r.orders[0].sameState && r.orders[0].parts === '2 m cable' && r.orders[0].photos === 1 && r.causes[0].cause === 'Sensor loose' && r.causes[0].count === 2, `its work orders: ${n(r.orders)} (the one from a DOOR_ERROR alert first), causes ${r.causes.map((c: { cause: string; count: number }) => `${c.cause} ${c.count}`).join(', ')}`);
  expect(r.guide?.title === 'Door sensor reset' && r.guide.steps === 3 && r.faults === 1, `its guide ${r.guide?.title} (${r.guide?.steps} steps); ${r.faults} earlier fault record (not the one now, nor another state)`);
  const none = lastTime({ alerts: [], orders: [], plc: 'line', machine: M, state: 'X', at: now });
  expect(none.before.count === 0 && none.before.last === null && !none.orders.length && none.guide === null && none.faults === 0, 'nothing known: nothing said');
  // (no state: an alert of another kind, a call: any state of the machine)
  const any = lastTime({ alerts, orders: [], plc: 'line', machine: M, state: '', at: now, excludeId: 'now' });
  expect(any.before.count === 4, `no state: ${any.before.count} of its alerts (any state)`);
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
