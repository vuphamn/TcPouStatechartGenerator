// Preventive maintenance: plans (grease the table's bearings every 30 days; change the spindle's belt every 2 000
// operating hours), each for a machine or a drive of a PLC. Its hours: a drive's own operating hours (the drive health
// board reads them) or a PLC variable that counts hours. Due: its days since it was last done, or its hours, reach its
// interval, less a lead (7 days, 24 hours by default); then a work order is made of it by itself (one at a time, its
// steps as its note, due when the plan is). That work order done: the plan done then, at those hours; cancelled: made
// again when still due. Written by those who assign work; kept in pm.json beside config.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DAY = 86400000;
const SYMBOL = /^[A-Za-z_][\w]*(\[[\d, ]+\])?(\.[A-Za-z_][\w]*(\[[\d, ]+\])?)*$/;

function createPm({ baseDir, getPlc, workOrders, hoursOfDrive, readVars, log, audit }) {
  const file = path.join(baseDir, 'pm.json');
  let plans = [];
  try {
    const x = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(x)) plans = x;
  } catch {
    plans = [];
  }
  const listeners = new Set();
  const save = () => {
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(plans, null, 1));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      log(`pm: ${err.message}`);
    }
    for (const fn of listeners) fn();
  };
  const text = (x, n) => String(x ?? '').trim().slice(0, n);
  const pos = (x, hi) => {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? Math.min(hi, n) : null;
  };

  /** When a plan is due: { nextAt, hoursLeft, state: ok | soon | due, why } */
  const dueOf = (p, now = Date.now()) => {
    const nextAt = p.everyDays ? p.lastDoneAt + p.everyDays * DAY : null;
    const nextHours = p.everyHours && p.lastDoneHours !== null ? p.lastDoneHours + p.everyHours : null;
    const hoursLeft = nextHours !== null && typeof p.hoursNow === 'number' ? nextHours - p.hoursNow : null;
    const byDays = nextAt === null ? 'ok' : now >= nextAt ? 'due' : now >= nextAt - p.leadDays * DAY ? 'soon' : 'ok';
    const byHours = hoursLeft === null ? 'ok' : hoursLeft <= 0 ? 'due' : hoursLeft <= p.leadHours ? 'soon' : 'ok';
    const rank = { ok: 0, soon: 1, due: 2 };
    const state = rank[byDays] >= rank[byHours] ? byDays : byHours;
    const why = [nextAt !== null ? `by ${new Date(nextAt).toLocaleDateString()}` : '', hoursLeft !== null ? `in ${Math.round(hoursLeft)} h of running` : ''].filter(Boolean).join(', or ');
    return { nextAt, nextHours, hoursLeft, state, why };
  };

  /** Each plan's hours now (its drive's, its variable's) */
  async function readHours() {
    const byPlc = new Map();
    for (const p of plans) {
      if (!p.counter) continue;
      if (p.counter.kind === 'drive') {
        const h = hoursOfDrive(p.plc, p.counter.path);
        if (typeof h === 'number') Object.assign(p, { hoursNow: h, hoursAt: Date.now() });
      } else if (p.counter.kind === 'var') byPlc.set(p.plc, [...(byPlc.get(p.plc) ?? []), p]);
    }
    for (const [plc, list] of byPlc) {
      try {
        const values = await readVars(plc, [...new Set(list.map((p) => p.counter.var))]);
        for (const p of list) {
          const v = values[p.counter.var];
          if (typeof v?.value === 'number') Object.assign(p, { hoursNow: v.value * (p.counter.scale ?? 1), hoursAt: Date.now() });
        }
      } catch (err) {
        log(`pm: ${plc}: its hours not read: ${err.message}`);
      }
    }
    // (a plan begun on hours not known then: from the first hours read)
    for (const p of plans) if (p.everyHours && p.lastDoneHours === null && typeof p.hoursNow === 'number') p.lastDoneHours = p.hoursNow;
  }

  /** Due plans: their work orders made (one open at a time) */
  function makeOrders(user = 'preventive maintenance') {
    let made = 0;
    for (const p of plans) {
      const open = p.openOrder && workOrders.get(p.openOrder);
      if (open && !['done', 'cancelled'].includes(open.status)) continue;
      p.openOrder = null;
      const d = dueOf(p);
      if (d.state === 'ok') continue;
      const plc = getPlc(p.plc);
      const o = workOrders.create({ title: `PM: ${p.title}`.slice(0, 120), plc: p.plc, plcName: plc?.name ?? p.plc, machine: p.machine || null, priority: p.priority, due: d.nextAt ? new Date(d.nextAt).toISOString() : null, note: p.steps || `Preventive maintenance, due ${d.why}`, source: { kind: 'pm', id: p.id, text: `preventive maintenance: ${p.title} (${d.why})` } }, user);
      p.openOrder = o.id;
      made++;
    }
    return made;
  }

  async function tick() {
    if (!plans.length) return;
    await readHours();
    makeOrders();
    save();
  }
  const timer = setInterval(() => void tick().catch((err) => log(`pm: ${err.message}`)), 10 * 60000);
  timer.unref();
  setTimeout(() => void tick().catch(() => {}), 15000).unref();

  return {
    list: () => plans.map((p) => ({ ...p, due: dueOf(p) })),
    /** A plan written: checked; its interval restarts only when said (lastDoneAt given) */
    async save(p0, user) {
      const title = text(p0?.title, 100);
      if (!title) throw new Error('A plan has a title: what is to be done');
      if (!getPlc(p0?.plc)) throw new Error('Choose its PLC');
      const everyDays = pos(p0?.everyDays, 3650);
      const everyHours = pos(p0?.everyHours, 1e6);
      if (!everyDays && !everyHours) throw new Error('How often: every so many days, or operating hours, or both');
      let counter = null;
      if (everyHours) {
        const c = p0?.counter ?? {};
        if (c.kind === 'drive' && text(c.path, 300)) counter = { kind: 'drive', path: text(c.path, 300) };
        else if (c.kind === 'var' && SYMBOL.test(text(c.var, 200))) counter = { kind: 'var', var: text(c.var, 200), scale: pos(c.scale, 1e6) ?? 1 };
        else throw new Error('Its operating hours: a drive (its own hours) or a PLC variable that counts hours');
      }
      const old = plans.find((x) => x.id === p0?.id);
      const lastDoneAt = p0?.lastDoneAt && !Number.isNaN(Date.parse(p0.lastDoneAt)) ? Date.parse(p0.lastDoneAt) : old?.lastDoneAt ?? Date.now();
      const p = {
        id: old?.id ?? crypto.randomBytes(5).toString('hex'), title, plc: String(p0.plc), machine: text(p0?.machine, 300), everyDays, everyHours, counter,
        leadDays: pos(p0?.leadDays, 365) ?? 7, leadHours: pos(p0?.leadHours, 1e5) ?? 24, steps: text(p0?.steps, 1000), priority: ['urgent', 'high', 'normal', 'low'].includes(p0?.priority) ? p0.priority : 'normal',
        lastDoneAt, lastDoneHours: p0?.lastDoneHours != null && Number.isFinite(Number(p0.lastDoneHours)) ? Number(p0.lastDoneHours) : old && JSON.stringify(old.counter) === JSON.stringify(counter) ? old.lastDoneHours : null,
        hoursNow: old?.hoursNow ?? null, hoursAt: old?.hoursAt ?? null, openOrder: old?.openOrder ?? null, by: user, at: Date.now(),
      };
      plans = [...plans.filter((x) => x.id !== p.id), p];
      await readHours();
      makeOrders(user);
      save();
      audit?.add(user, 'pm.save', { id: p.id, title, everyDays, everyHours });
      return { ...p, due: dueOf(p) };
    },
    remove(id, user) {
      if (!plans.some((p) => p.id === id)) throw new Error('No such plan');
      plans = plans.filter((p) => p.id !== id);
      save();
      audit?.add(user, 'pm.delete', { id });
    },
    /** Its work order now, due or not */
    now(id, user) {
      const p = plans.find((x) => x.id === id);
      if (!p) throw new Error('No such plan');
      const open = p.openOrder && workOrders.get(p.openOrder);
      if (open && !['done', 'cancelled'].includes(open.status)) throw new Error(`Its work order #${open.number} is open`);
      const plc = getPlc(p.plc);
      const o = workOrders.create({ title: `PM: ${p.title}`.slice(0, 120), plc: p.plc, plcName: plc?.name ?? p.plc, machine: p.machine || null, priority: p.priority, note: p.steps || 'Preventive maintenance', source: { kind: 'pm', id: p.id, text: `preventive maintenance: ${p.title}` } }, user);
      p.openOrder = o.id;
      save();
      return o;
    },
    /** Its work order done: the plan done then, at its hours now */
    done(id, at = Date.now()) {
      const p = plans.find((x) => x.id === id);
      if (!p) return;
      p.lastDoneAt = at;
      if (typeof p.hoursNow === 'number') p.lastDoneHours = p.hoursNow;
      p.openOrder = null;
      save();
      log(`pm: "${p.title}" done; next ${dueOf(p).why}`);
    },
    tick,
    dueOf,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    stop: () => clearInterval(timer),
  };
}

module.exports = { createPm };
