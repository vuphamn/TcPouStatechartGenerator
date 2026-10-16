// Alarm shelving (ISA-18.2): an alarm a person sets aside for a while, with why: a machine (and one of its states, or
// any) on a PLC, for at most config.alarms.maxShelveHours (12 by default). While shelved, its alarms are kept as muted
// ("shelved: why"): not open, no chime, no webhook, nobody told; shelved by those who acknowledge alarms. When its time
// is up it comes back by itself (said in the alert history); it can be unshelved sooner. Each in the audit log. Kept in
// shelves.json beside config.json (the last 500).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const H = 3600000;
const ALARMS = ['error', 'stuck', 'plcStopped', 'drive', 'slower', 'anomaly'];

function createShelves({ baseDir, getConfig, log, audit, onEvent }) {
  const file = path.join(baseDir, 'shelves.json');
  let list = [];
  try {
    const x = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(x)) list = x;
  } catch {
    list = [];
  }
  const listeners = new Set();
  const save = () => {
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(list.slice(-500), null, 1));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      log(`shelves: ${err.message}`);
    }
    for (const fn of listeners) fn();
  };
  const lower = (x) => String(x ?? '').toLowerCase();
  const text = (x, n) => String(x ?? '').trim().slice(0, n);
  const maxHours = () => Math.max(0.25, Math.min(168, Number(getConfig?.()?.alarms?.maxShelveHours) || 12));
  const active = (s, now = Date.now()) => !s.endedAt && s.until > now;
  /** The shelf an alarm is on now: the same PLC and machine, its state or any */
  const of = (plc, machine, state, now = Date.now()) => list.find((s) => active(s, now) && s.plc === plc && lower(s.machine) === lower(machine) && (!s.state || lower(s.state) === lower(state))) ?? null;
  const end = (s, how, user = null) => {
    s.endedAt = Date.now();
    s.endedBy = user;
    s.ended = how;
    const line = `${s.plcName}: 🔔 ${s.machine}${s.state ? ` (${s.state})` : ''} ${how === 'expired' ? 'back from the shelf: its time is up' : `unshelved by ${user}`}`;
    log(`shelves: ${line}`);
    onEvent?.({ event: 'shelf', rule: 'Shelved alarms', ruleId: 'shelf', plc: s.plc, plcName: s.plcName, machine: s.machine, state: s.state || '', text: line, at: new Date().toISOString(), quiet: true });
  };
  const whyOf = (plc, machine, state) => {
    const s = of(plc, machine, state);
    return s ? `shelved: ${s.reason}` : null;
  };
  // (their time up: back by themselves)
  const timer = setInterval(() => {
    const now = Date.now();
    const done = list.filter((s) => !s.endedAt && s.until <= now);
    for (const s of done) end(s, 'expired');
    if (done.length) save();
  }, 30000);
  timer.unref?.();

  return {
    ALARMS,
    maxHours,
    /** Shelved: { plc, plcName, machine, state (empty: any), hours, reason } by a user */
    shelve(x, user) {
      const plc = text(x?.plc, 60);
      const machine = text(x?.machine, 300);
      const reason = text(x?.reason, 300);
      const hours = Number(x?.hours);
      if (!plc || !machine) throw new Error('A PLC and a machine');
      if (!reason) throw new Error('Why it is shelved (ISA-18.2: a reason for each)');
      if (!(hours > 0) || hours > maxHours()) throw new Error(`For at most ${maxHours()} hours`);
      const state = text(x?.state, 120);
      const old = of(plc, machine, state);
      if (old && lower(old.state) === lower(state)) throw new Error(`Shelved already by ${old.by} until ${new Date(old.until).toLocaleTimeString()}`);
      const s = { id: crypto.randomBytes(5).toString('hex'), plc, plcName: text(x?.plcName, 80) || plc, machine, state, reason, by: user, at: Date.now(), until: Date.now() + hours * H, endedAt: null, endedBy: null, ended: null };
      list.push(s);
      save();
      audit?.add(user, 'alarm.shelve', { id: s.id, plc, machine, state, hours, reason });
      log(`shelves: ${user} shelved ${machine}${state ? ` (${state})` : ''} on ${plc} for ${hours} h: ${reason}`);
      return s;
    },
    unshelve(id, user) {
      const s = list.find((x) => x.id === id);
      if (!s || !active(s)) throw new Error('Not shelved now');
      end(s, 'unshelved', user);
      save();
      audit?.add(user, 'alarm.unshelve', { id, plc: s.plc, machine: s.machine, state: s.state });
      return s;
    },
    /** Why an alarm is muted by a shelf now ("shelved: its reason"), or null */
    why: whyOf,
    /** An alert as it is logged: muted when its alarm is shelved */
    apply(e) {
      if (!e || e.muted || !ALARMS.includes(e.event)) return e;
      const w = whyOf(e.plc, e.machine, e.state);
      return w ? { ...e, muted: w } : e;
    },
    /** Those on the shelf now, and the latest ended ones */
    list: () => ({ active: list.filter((s) => active(s)), recent: list.filter((s) => !active(s)).slice(-30).reverse(), maxHours: maxHours() }),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    stop: () => clearInterval(timer),
  };
}

module.exports = { createShelves };
