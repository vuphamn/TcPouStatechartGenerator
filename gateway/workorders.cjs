// Work orders, for technicians and maintenance supervisors: a job to do on a machine, a drive, an I/O box or the line,
// from an alert, a call for maintenance (one by itself: config.workorders.fromCalls), a risk, or by hand. Assigned
// (supervisors, engineers), taken, worked on (a log of what was done), done with its root cause and the parts used,
// or cancelled. Kept in workorders.json beside config.json; each change in the audit log; a new one and an assignment
// told to the roles that want "workorder" (roles.notify). From them and the alert history: each machine's MTBF and
// MTTR (reliability), and the maintenance calendar (the windows, the jobs due).
const fs = require('fs');
const crypto = require('crypto');

const STATUSES = ['open', 'assigned', 'in progress', 'done', 'cancelled'];
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
const MAX = 5000;

function createWorkOrders({ file, getConfig, log, audit, notify }) {
  let orders = [];
  try {
    orders = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(orders)) orders = [];
  } catch {
    orders = [];
  }
  const listeners = new Set();
  const save = () => {
    try {
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(orders.slice(-MAX)));
      fs.renameSync(tmp, file);
    } catch (err) {
      log(`workorders: ${err.message}`);
    }
    for (const fn of listeners) fn();
  };
  const text = (x, n) => String(x ?? '').trim().slice(0, n);
  const short = (o) => `#${o.number} ${o.title}${o.machine ? ` (${o.machine})` : ''}`;

  return {
    STATUSES,
    PRIORITIES,
    list: () => orders,
    get: (id) => orders.find((o) => o.id === id) ?? null,
    /** A new work order: title, plc, machine (or a drive's or box's path), priority, due, source, note */
    create(w, user) {
      const title = text(w.title, 120);
      if (!title) throw new Error('A title: what is to be done');
      const now = new Date().toISOString();
      const o = {
        id: crypto.randomBytes(6).toString('hex'), number: (orders.reduce((a, x) => Math.max(a, x.number ?? 0), 0) || 1000) + 1,
        title, plc: text(w.plc, 60) || null, plcName: text(w.plcName, 80) || null, machine: text(w.machine, 300) || null,
        priority: PRIORITIES.includes(w.priority) ? w.priority : 'normal', status: 'open', assignee: null,
        due: w.due && !Number.isNaN(Date.parse(w.due)) ? new Date(w.due).toISOString() : null,
        source: w.source && typeof w.source === 'object' ? { kind: text(w.source.kind, 20), id: text(w.source.id, 80), text: text(w.source.text, 300) } : { kind: 'manual' },
        createdBy: user, createdAt: now, startedAt: null, doneAt: null, rootCause: '', parts: '',
        log: [{ at: now, by: user, text: text(w.note, 500) || 'Created', status: 'open' }],
      };
      orders.push(o);
      save();
      audit?.add(user, 'workorder.create', { id: o.id, number: o.number, title, plc: o.plc, machine: o.machine, source: o.source.kind });
      log(`workorders: ${user} created ${short(o)}`);
      notify?.({ event: 'workorder', plc: o.plc, plcName: o.plcName, machine: o.machine ?? '', state: o.priority, text: `🛠️ ${o.plcName ? `${o.plcName}: ` : ''}work order ${short(o)} (${o.priority}) by ${user}`, at: now });
      return o;
    },
    /**
     * A change: status (taking it: in progress; done: its root cause; cancelled), assignee (assigning another: may),
     * priority, due, a note to its log
     */
    update(id, ch, user, mayAssign) {
      const o = orders.find((x) => x.id === id);
      if (!o) throw new Error('No such work order');
      const now = new Date().toISOString();
      const entry = { at: now, by: user, text: text(ch.note, 500) };
      if (ch.assignee !== undefined && ch.assignee !== o.assignee) {
        const a = text(ch.assignee, 120) || null;
        if (a && a.toLowerCase() !== String(user).toLowerCase() && !mayAssign) throw new Error('Only a supervisor or an engineer assigns work to others');
        o.assignee = a;
        entry.assignee = a;
        if (o.status === 'open' && a) o.status = 'assigned';
        if (a) notify?.({ event: 'workorder', plc: o.plc, plcName: o.plcName, machine: o.machine ?? '', state: o.priority, text: `🛠️ ${short(o)} assigned to ${a} by ${user}`, at: now });
      }
      if (ch.status !== undefined && ch.status !== o.status) {
        if (!STATUSES.includes(ch.status)) throw new Error(`A status: ${STATUSES.join(', ')}`);
        if (ch.status === 'done') {
          const rc = text(ch.rootCause, 500);
          if (!rc) throw new Error('Done: its root cause (what was wrong)');
          o.rootCause = rc;
          o.parts = text(ch.parts, 300);
          o.doneAt = now;
        }
        if (ch.status === 'in progress') {
          o.startedAt ??= now;
          o.assignee ??= user;
        }
        if (ch.status !== 'done') o.doneAt = ch.status === 'cancelled' ? now : null;
        o.status = ch.status;
        entry.status = ch.status;
      }
      if (ch.priority !== undefined && PRIORITIES.includes(ch.priority) && ch.priority !== o.priority) {
        o.priority = ch.priority;
        entry.priority = ch.priority;
      }
      if (ch.due !== undefined) o.due = ch.due && !Number.isNaN(Date.parse(ch.due)) ? new Date(ch.due).toISOString() : null;
      if (!entry.text && !entry.status && !entry.assignee && !entry.priority && ch.due === undefined) return o;
      if (!entry.text) entry.text = [entry.status && `→ ${entry.status}`, entry.assignee && `assigned to ${entry.assignee}`, entry.priority && `priority ${entry.priority}`].filter(Boolean).join(', ') || 'Changed';
      o.log.push(entry);
      save();
      audit?.add(user, 'workorder.change', { id, number: o.number, status: entry.status, assignee: entry.assignee, priority: entry.priority, note: entry.text });
      log(`workorders: ${user}: ${short(o)}: ${entry.text}`);
      return o;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * Each machine's reliability over [from, to]: its failures (error alerts, and work orders done on it), MTBF (the
 * window over its failures), MTTR (its failures' time to recover: an alert's resolution, a work order's
 * start-to-done), the top root causes
 */
function reliability({ alerts = [], orders = [], from, to }) {
  const per = new Map();
  const at = (k, plc, plcName) => {
    if (!per.has(k)) per.set(k, { plc, plcName, machine: k.split('|')[1], failures: 0, repairs: [], causes: new Map(), orders: 0 });
    return per.get(k);
  };
  for (const a of alerts) {
    if (a.event !== 'error' || a.muted) continue;
    const t = Date.parse(a.at);
    if (t < from || t > to) continue;
    const r = at(`${a.plc}|${a.machine}`, a.plc, a.plcName);
    r.failures++;
    if (a.resolvedAt) r.repairs.push(Date.parse(a.resolvedAt) - t);
  }
  for (const o of orders) {
    if (o.status !== 'done' || !o.machine || !o.doneAt) continue;
    const t = Date.parse(o.doneAt);
    if (t < from || t > to) continue;
    const r = at(`${o.plc}|${o.machine}`, o.plc, o.plcName);
    r.orders++;
    if (o.startedAt) r.repairs.push(t - Date.parse(o.startedAt));
    if (o.rootCause) r.causes.set(o.rootCause, (r.causes.get(o.rootCause) ?? 0) + 1);
  }
  const span = Math.max(1, to - from);
  return [...per.values()]
    .map((r) => ({ plc: r.plc, plcName: r.plcName, machine: r.machine, failures: r.failures, orders: r.orders, mtbfMs: r.failures ? span / r.failures : null, mttrMs: r.repairs.length ? r.repairs.reduce((a, x) => a + x, 0) / r.repairs.length : null, causes: [...r.causes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => ({ cause: c, count: n })) }))
    .sort((a, b) => b.failures - a.failures || (a.mtbfMs ?? Infinity) - (b.mtbfMs ?? Infinity));
}

module.exports = { createWorkOrders, reliability, STATUSES, PRIORITIES };
