// Shift handover: what the outgoing shift hands the next one. The gateway makes its summary from what happened in
// the shift (config.shifts; none: the last 8 hours): its alerts and the machines that had most, its stops and their
// reasons (OEE, from the recordings), the work orders opened, done and still open, the drives in warning or alarm,
// the alerts still open. The outgoing person adds a note and hands it over; the next shift reads it on the board
// (who read it, kept). Told to the roles that want "handover" (roles.notify). Kept in handover.json beside
// config.json (the last 500); each one in the audit log.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OPEN_WORK = ['open', 'assigned', 'in progress'];

function createHandover({ baseDir, shiftWindowsOf, alertLog, workOrders, oee, drives, log, audit, notify }) {
  const file = path.join(baseDir, 'handover.json');
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }
  const listeners = new Set();
  const save = () => {
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(list.slice(-500)));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      log(`handover: ${err.message}`);
    }
  };
  const publish = () => {
    for (const fn of listeners) fn();
  };

  /** The shift now (its name, from, to); no shift now: the last 8 hours */
  const shiftNow = (now = Date.now()) => {
    const w = shiftWindowsOf(now - 26 * 3600_000, now + 1).filter((x) => x.from <= now && x.to > now).pop();
    return w ? { name: w.name, from: w.from, to: w.to } : { name: 'The last 8 hours', from: now - 8 * 3600_000, to: now };
  };
  const brief = (o) => ({ id: o.id, number: o.number, title: o.title, priority: o.priority, status: o.status, plcName: o.plcName, machine: o.machine, assignee: o.assignee });

  /** What happened in [from, to] on these PLCs (all: none given), made fresh */
  function summary(from, to, plcIds = []) {
    const inPlc = (p) => !plcIds.length || !p || plcIds.includes(p);
    const all = alertLog.all();
    const problems = all.filter((e) => {
      const t = Date.parse(e.at);
      return t >= from && t < to && inPlc(e.plc) && !e.muted && e.event !== 'recovered';
    });
    const counts = {};
    const byMachine = new Map();
    for (const e of problems) {
      counts[e.event] = (counts[e.event] ?? 0) + 1;
      const k = `${e.plcName ?? e.plc ?? ''}|${e.machine ?? ''}`;
      byMachine.set(k, (byMachine.get(k) ?? 0) + 1);
    }
    const machines = [...byMachine.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, count]) => ({ plcName: k.split('|')[0], machine: k.slice(k.indexOf('|') + 1), count }));
    const open = all.filter((e) => !e.resolvedAt && !e.muted && e.event !== 'recovered' && inPlc(e.plc)).slice(-20).reverse().map((e) => ({ id: e.id, at: e.at, plcName: e.plcName ?? e.plc ?? '', machine: e.machine ?? '', text: e.text, ack: !!e.ack }));
    let stops = null;
    try {
      const r = oee.report({ from, to, plcIds });
      if (r.recorded) stops = { count: r.line.stops, downMs: r.line.downMs, availability: r.line.availability, oee: r.line.oee, reasons: r.pareto.reason.slice(0, 3).map((x) => ({ reason: x.key, ms: x.ms, count: x.count })), noReason: r.stops.filter((s) => !s.reason).length };
    } catch (err) {
      log(`handover: OEE: ${err.message}`);
    }
    const t = (x) => (x ? Date.parse(x) : NaN);
    const orders = workOrders.list().filter((o) => inPlc(o.plc));
    const work = {
      opened: orders.filter((o) => t(o.createdAt) >= from && t(o.createdAt) < to).map(brief),
      done: orders.filter((o) => o.status === 'done' && t(o.doneAt) >= from && t(o.doneAt) < to).map(brief),
      open: orders.filter((o) => OPEN_WORK.includes(o.status)).sort((a, b) => ['urgent', 'high', 'normal', 'low'].indexOf(a.priority) - ['urgent', 'high', 'normal', 'low'].indexOf(b.priority)).slice(0, 20).map(brief),
    };
    const driveList = [];
    try {
      for (const p of drives.view(plcIds)) {
        for (const d of p.drives) if (d.health && (d.health.level === 'warn' || d.health.level === 'alarm')) driveList.push({ plcName: p.name, name: d.name, level: d.health.level, text: d.health.findings?.[0]?.text ?? '' });
      }
    } catch {
      // (no drives monitor)
    }
    return { from, to, alerts: { total: problems.length, counts, machines }, stops, work, drives: driveList, open };
  }

  /** One line of a summary, for a channel */
  const lineOf = (s) => {
    const parts = [`${s.alerts.total} alert(s)`];
    if (s.stops) parts.push(`${s.stops.count} stop(s), ${Math.round(s.stops.downMs / 60000)} min down`);
    parts.push(`${s.work.done.length} work order(s) done, ${s.work.open.length} open`);
    if (s.drives.length) parts.push(`${s.drives.length} drive(s) to watch`);
    if (s.open.length) parts.push(`${s.open.length} alert(s) still open`);
    return parts.join(', ');
  };

  return {
    shiftNow,
    summary,
    /** The board's: the shift now and its summary so far */
    draft(plcIds = []) {
      const shift = shiftNow();
      return { shift, summary: summary(shift.from, Date.now(), plcIds) };
    },
    /** The shift handed over: its summary (made now), the note */
    handOver({ note, plcIds = [] }, user) {
      const shift = shiftNow();
      const now = Date.now();
      const text = String(note ?? '').trim().slice(0, 4000);
      const ids = (Array.isArray(plcIds) ? plcIds : []).map(String).slice(0, 100);
      const e = { id: crypto.randomBytes(6).toString('hex'), shift: shift.name, from: shift.from, to: Math.min(shift.to, now), at: now, by: user, note: text, plcs: ids, summary: summary(shift.from, now, ids), reads: [] };
      list.push(e);
      if (list.length > 500) list = list.slice(-500);
      save();
      audit?.add(user, 'handover', { id: e.id, shift: e.shift, note: text.slice(0, 200) });
      log(`handover: ${user} handed over ${e.shift}: ${lineOf(e.summary)}`);
      notify?.({ event: 'handover', plc: '', plcName: '', machine: '', state: '', at: new Date(now).toISOString(), text: `🔁 ${e.shift} handed over by ${user}: ${lineOf(e.summary)}${text ? ` · ${text.slice(0, 300)}` : ''}` });
      publish();
      return e;
    },
    /** Read by the next shift (once each) */
    read(id, user) {
      const e = list.find((x) => x.id === id);
      if (!e) throw new Error('No such handover');
      if (!e.reads.some((r) => r.by === user)) {
        e.reads.push({ by: user, at: Date.now() });
        save();
        audit?.add(user, 'handover.read', { id });
        publish();
      }
      return e;
    },
    /** The latest ones, newest first */
    list: (limit = 10) => list.slice(-limit).reverse(),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

module.exports = { createHandover };
