// Maintenance KPIs (the Work page's KPIs tab), from the work orders, the alert history and the spare parts' moves:
// - preventive maintenance compliance: its work orders due in the window, done by their due date (a day's grace);
// - the backlog: the open work orders by age and by priority, the oldest;
// - planned against unplanned: the work orders done in the window, preventive ones against the others;
// - MTTR by week (the last weeks): a work order's start to done, an error alert's time to recover;
// - the parts used per machine (the moves taken by a work order, its machine).
const DAY = 86400000;
const OPEN = ['open', 'assigned', 'in progress'];

/** Monday 00:00 (local) of the week of t */
const weekOf = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
};
const mean = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
const dayOf = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** { orders, moves, alerts, now, days (the window), weeks (the trend) } -> the KPIs */
function maintenanceKpis({ orders = [], moves = [], alerts = [], now = Date.now(), days = 30, weeks = 8 }) {
  const from = now - days * DAY;
  const t = (iso) => (iso ? Date.parse(iso) : NaN);
  // Preventive maintenance: due in the window (and before now)
  const pmDue = orders.filter((o) => o.source?.kind === 'pm' && o.due && t(o.due) >= from && t(o.due) <= now && o.status !== 'cancelled');
  const onTime = pmDue.filter((o) => o.status === 'done' && t(o.doneAt) <= t(o.due) + DAY).length;
  const pmOverdue = orders.filter((o) => o.source?.kind === 'pm' && OPEN.includes(o.status) && o.due && t(o.due) < now).length;
  // The backlog
  const open = orders.filter((o) => OPEN.includes(o.status));
  const age = (o) => now - t(o.createdAt);
  const buckets = [
    { label: '< 1 day', max: DAY },
    { label: '1–7 days', max: 7 * DAY },
    { label: '7–30 days', max: 30 * DAY },
    { label: '> 30 days', max: Infinity },
  ];
  const byAge = buckets.map((b, i) => ({ label: b.label, n: open.filter((o) => age(o) >= (i ? buckets[i - 1].max : 0) && age(o) < b.max).length }));
  const oldest = [...open].sort((a, b) => t(a.createdAt) - t(b.createdAt))[0];
  const byPriority = Object.fromEntries(['urgent', 'high', 'normal', 'low'].map((p) => [p, open.filter((o) => o.priority === p).length]));
  // Planned against unplanned, done in the window
  const done = orders.filter((o) => o.status === 'done' && t(o.doneAt) >= from && t(o.doneAt) <= now);
  const planned = done.filter((o) => o.source?.kind === 'pm').length;
  // MTTR by week
  const w0 = weekOf(now) - (weeks - 1) * 7 * DAY;
  const trend = Array.from({ length: weeks }, (_, i) => {
    const a = w0 + i * 7 * DAY;
    const b = a + 7 * DAY;
    const ws = orders.filter((o) => o.status === 'done' && o.startedAt && t(o.doneAt) >= a && t(o.doneAt) < b).map((o) => t(o.doneAt) - t(o.startedAt)).filter((x) => x >= 0);
    const as = alerts.filter((e) => e.event === 'error' && !e.muted && e.resolvedAt && t(e.at) >= a && t(e.at) < b).map((e) => t(e.resolvedAt) - t(e.at)).filter((x) => x >= 0);
    return { week: dayOf(a), orders: ws.length, mttrMs: mean(ws), alerts: as.length, alertMttrMs: mean(as) };
  });
  // Parts per machine: the moves a work order took (its number), in the window
  const byNumber = new Map(orders.map((o) => [o.number, o]));
  const per = new Map();
  for (const m of moves) {
    if (!m.order || m.delta >= 0 || m.at < from || m.at > now) continue;
    const o = byNumber.get(m.order);
    const k = `${o?.plcName ?? ''}|${o?.machine ?? '(no machine)'}`;
    const x = per.get(k) ?? { plcName: o?.plcName ?? '', machine: o?.machine ?? '(no machine)', qty: 0, parts: new Map() };
    x.qty += -m.delta;
    x.parts.set(m.number, (x.parts.get(m.number) ?? 0) - m.delta);
    per.set(k, x);
  }
  const parts = [...per.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10)
    .map((x) => ({ plcName: x.plcName, machine: x.machine, qty: x.qty, parts: [...x.parts.entries()].sort((a, b) => b[1] - a[1]).map(([number, qty]) => ({ number, qty })) }));
  return {
    window: { from, to: now, days },
    pm: { due: pmDue.length, onTime, late: pmDue.length - onTime, overdue: pmOverdue, compliance: pmDue.length ? onTime / pmDue.length : null },
    backlog: { open: open.length, byAge, byPriority, oldest: oldest ? { id: oldest.id, number: oldest.number, title: oldest.title, ageMs: age(oldest) } : null },
    planned: { pm: planned, other: done.length - planned, share: done.length ? planned / done.length : null },
    trend,
    parts,
  };
}

module.exports = { maintenanceKpis, weekOf };
