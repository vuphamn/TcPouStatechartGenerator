// "Last time this happened": for an alert (or a fault record) of a machine in a state, what the gateway already
// knows of it: the same machine in the same state before (the alert history, the last 90 days: how often, the last
// time, how long until it recovered, its acknowledgement's note), the work orders done on that machine (their root
// causes and parts, those from an alert of that state first; those done since too: what fixed it), its recovery
// guide, its earlier fault records.
const DAY = 86400000;

const lower = (x) => String(x ?? '').toLowerCase();

/**
 * { alerts, orders, faults, guide, plc, machine, state, at (ms), excludeId, days } -> { before, orders, causes,
 * guide, faults }
 */
function lastTime({ alerts = [], orders = [], faults = [], guide = null, plc, machine, state, at = Date.now(), excludeId = null, days = 90 }) {
  const m = lower(machine);
  const st = lower(state);
  const from = at - days * DAY;
  const same = alerts
    .filter((e) => e.id !== excludeId && e.plc === plc && lower(e.machine) === m && e.event !== 'recovered' && !e.muted && (!st || lower(e.state) === st))
    .map((e) => ({ e, t: Date.parse(e.at) }))
    .filter((x) => x.t >= from && x.t < at)
    .sort((a, b) => b.t - a.t);
  const recovered = same.filter((x) => x.e.resolvedAt).map((x) => Date.parse(x.e.resolvedAt) - x.t).filter((ms) => ms >= 0);
  const last = same[0]?.e;
  const before = {
    count: same.length,
    days,
    last: last ? { at: last.at, resolvedAt: last.resolvedAt ?? null, ack: last.ack ? { by: last.ack.by, note: last.ack.note ?? '' } : null } : null,
    // (the median time to recover)
    recoverMs: recovered.length ? [...recovered].sort((a, b) => a - b)[recovered.length >> 1] : null,
  };
  // (its work orders done: those from an alert of this state first, then the newest)
  const fromState = (o) => !!st && (lower(o.source?.text).includes(st) || lower(o.title).includes(st));
  const done = orders
    .filter((o) => o.status === 'done' && o.plc === plc && lower(o.machine) === m && o.doneAt)
    .sort((a, b) => Number(fromState(b)) - Number(fromState(a)) || Date.parse(b.doneAt) - Date.parse(a.doneAt));
  const causes = new Map();
  for (const o of done) if (o.rootCause) causes.set(o.rootCause, (causes.get(o.rootCause) ?? 0) + 1);
  return {
    before,
    orders: done.slice(0, 5).map((o) => ({ id: o.id, number: o.number, title: o.title, rootCause: o.rootCause, parts: o.parts ?? '', doneAt: o.doneAt, by: o.assignee ?? null, sameState: fromState(o), photos: (o.attachments ?? []).length })),
    causes: [...causes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cause, count]) => ({ cause, count })),
    guide: guide ? { id: guide.id, title: guide.title, steps: guide.steps?.length ?? 0 } : null,
    faults: faults.filter((f) => f.plc === plc && lower(f.machine) === m && f.at < at - 15000 && f.at >= from && (!st || lower(f.state) === st)).length,
  };
}

module.exports = { lastTime };
