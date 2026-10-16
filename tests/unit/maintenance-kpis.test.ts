// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The maintenance KPIs (gateway/kpis.cjs): preventive maintenance done on time (a day's grace; cancelled ones not
// counted; one overdue now), the backlog by age and priority and its oldest, planned against unplanned, MTTR by week
// (work orders, error alerts; muted ones not), the parts used per machine (by work order number)
/* eslint-disable @typescript-eslint/no-require-imports */
const { maintenanceKpis, weekOf } = require('../../gateway/kpis.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(() => {
  const H = 3600000;
  const DAY = 24 * H;
  const now = new Date(2026, 9, 16, 12, 0, 0).getTime(); // a Friday
  const iso = (ms: number) => new Date(ms).toISOString();
  let n = 1000;
  const o = (x: Record<string, unknown>) => ({ id: `o${++n}`, number: n, title: `job ${n}`, plc: 'line', plcName: 'Line 9', machine: 'MAIN.a', priority: 'normal', status: 'open', createdAt: iso(now - DAY), source: { kind: 'manual' }, ...x });
  const orders = [
    // (preventive: two due and done, one on time (within a day's grace), one 3 days late; one cancelled; one overdue)
    o({ source: { kind: 'pm' }, status: 'done', due: iso(now - 10 * DAY), startedAt: iso(now - 10 * DAY), doneAt: iso(now - 10 * DAY + 20 * H) }),
    o({ source: { kind: 'pm' }, status: 'done', due: iso(now - 20 * DAY), startedAt: iso(now - 17 * DAY - H), doneAt: iso(now - 17 * DAY) }),
    o({ source: { kind: 'pm' }, status: 'cancelled', due: iso(now - 5 * DAY) }),
    o({ source: { kind: 'pm' }, status: 'open', due: iso(now - 2 * DAY), createdAt: iso(now - 9 * DAY) }),
    // (the backlog: one new, one 3 days old, one 40 days old (urgent))
    o({ createdAt: iso(now - 2 * H) }),
    o({ createdAt: iso(now - 3 * DAY), status: 'in progress', priority: 'high' }),
    o({ createdAt: iso(now - 40 * DAY), status: 'assigned', priority: 'urgent', machine: 'MAIN.b' }),
    // (done this week: 2 h and 4 h from start to done; one last week, 1 h)
    o({ status: 'done', startedAt: iso(now - 3 * H), doneAt: iso(now - H), machine: 'MAIN.b' }),
    o({ status: 'done', startedAt: iso(now - 5 * H), doneAt: iso(now - H) }),
    o({ status: 'done', startedAt: iso(now - 7 * DAY - H), doneAt: iso(now - 7 * DAY) }),
  ];
  const alerts = [
    { event: 'error', at: iso(now - 2 * H), resolvedAt: iso(now - 2 * H + 30 * 60000) },
    { event: 'error', at: iso(now - 2 * H), resolvedAt: iso(now - H), muted: 'maintenance' },
    { event: 'stuck', at: iso(now - 2 * H), resolvedAt: iso(now - H) },
  ];
  const moves = [
    { at: now - DAY, number: 'S12', delta: -2, order: 1008 },
    { at: now - DAY, number: 'BELT', delta: -1, order: 1008 },
    { at: now - DAY, number: 'S12', delta: -1, order: 1009 },
    { at: now - DAY, number: 'S12', delta: 5 },
    { at: now - 60 * DAY, number: 'S12', delta: -9, order: 1009 },
  ];
  const k = maintenanceKpis({ orders, moves, alerts, now, days: 30, weeks: 4 });
  expect(k.pm.due === 3 && k.pm.onTime === 1 && k.pm.late === 2 && k.pm.overdue === 1 && Math.abs(k.pm.compliance - 1 / 3) < 1e-9, `preventive: ${k.pm.onTime} of ${k.pm.due} on time (the open overdue one late too), ${k.pm.overdue} overdue now`);
  const ages = k.backlog.byAge.map((b: { n: number }) => b.n).join(' ');
  expect(k.backlog.open === 4 && ages === '1 1 1 1' && k.backlog.byPriority.urgent === 1 && k.backlog.oldest.number === 1007, `the backlog: ${k.backlog.open} open, by age ${ages}, oldest #${k.backlog.oldest?.number}`);
  expect(k.planned.pm === 2 && k.planned.other === 3 && Math.abs(k.planned.share - 0.4) < 1e-9, `planned: ${k.planned.pm} preventive, ${k.planned.other} other`);
  const last = k.trend[k.trend.length - 1];
  const prev = k.trend[k.trend.length - 2];
  expect(k.trend.length === 4 && last.week === '2026-10-12' && weekOf(now) === new Date(2026, 9, 12).getTime() && last.orders === 2 && last.mttrMs === 3 * H && last.alerts === 1 && last.alertMttrMs === 30 * 60000 && prev.orders === 2 && prev.mttrMs === 10.5 * H, `MTTR this week: ${last.orders} orders, ${last.mttrMs / H} h; ${last.alerts} error alert (not muted, not stuck), ${last.alertMttrMs / 60000} min; last week (a preventive one too) ${prev.orders}, ${prev.mttrMs / H} h`);
  const parts = k.parts.map((p: { machine: string; qty: number }) => `${p.machine} ${p.qty}`).join(', ');
  expect(parts === 'MAIN.b 3, MAIN.a 1' && k.parts[0].parts[0].number === 'S12' && k.parts[0].parts[0].qty === 2, `parts per machine: ${parts} (stock added and old moves not counted)`);
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
