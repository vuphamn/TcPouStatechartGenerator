// The master alarm database (ISA-18.2 rationalization): each alarm a PLC raises (a machine, or a type of machine, in a
// state) with its priority (1 urgent … 4 low), its consequence, the operator's response and the time to respond. An
// alert of a rationalized alarm carries them (the board shows them on it); alarm health counts the alarms raised that
// are rationalized and those not. Written by those who assign work (supervisors, engineers); kept in alarmdb.json
// beside config.json; each change in the audit log.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRIORITIES = { 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low' };

function createAlarmDb({ baseDir, log, audit }) {
  const file = path.join(baseDir, 'alarmdb.json');
  let entries = [];
  try {
    const x = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(x)) entries = x;
  } catch {
    entries = [];
  }
  const listeners = new Set();
  const save = () => {
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(entries, null, 1));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      log(`alarmdb: ${err.message}`);
    }
    for (const fn of listeners) fn();
  };
  const lower = (x) => String(x ?? '').toLowerCase();
  const text = (x, n) => String(x ?? '').trim().slice(0, n);
  const short = (t) => lower(String(t ?? '').split('.').pop());
  /** The entry of an alarm: its machine's own, else its type's (on its PLC, or any) */
  const match = ({ plc, machine, type, state }) => {
    const of = entries.filter((e) => lower(e.state) === lower(state) && (!e.plc || e.plc === plc));
    return of.find((e) => e.machine && lower(e.machine) === lower(machine)) ?? of.find((e) => !e.machine && e.type && short(e.type) === short(type)) ?? null;
  };
  return {
    PRIORITIES,
    list: () => entries,
    match,
    /** An alert as it is logged: its rationalization with it, when its alarm has one */
    apply(e) {
      if (!e || !e.state || !['error', 'stuck', 'plcStopped', 'drive', 'slower', 'plcEvent'].includes(e.event)) return e;
      const m = match(e);
      return m ? { ...e, alarm: { id: m.id, priority: m.priority, consequence: m.consequence, response: m.response, respondMin: m.respondMin ?? null } } : e;
    },
    /** One written: { id?, plc?, machine? or type?, state, priority 1-4, consequence, response, respondMin } */
    save(x, user) {
      const state = text(x?.state, 120);
      const machine = text(x?.machine, 300);
      const type = text(x?.type, 120);
      if (!state || (!machine && !type)) throw new Error('An alarm: its state, and its machine or its type');
      const priority = Number(x?.priority);
      if (!PRIORITIES[priority]) throw new Error('Its priority: 1 (urgent) to 4 (low)');
      const response = text(x?.response, 500);
      if (!response) throw new Error("The operator's response: what to do (ISA-18.2: each alarm has one)");
      const id = typeof x?.id === 'string' && entries.some((e) => e.id === x.id) ? x.id : crypto.randomBytes(5).toString('hex');
      const e = { id, plc: text(x?.plc, 60) || null, machine: machine || null, type: machine ? null : type, state, priority, consequence: text(x?.consequence, 300), response, respondMin: Number(x?.respondMin) > 0 ? Math.min(1440, Number(x.respondMin)) : null, by: user, at: Date.now() };
      entries = [...entries.filter((y) => y.id !== id), e];
      save();
      audit?.add(user, 'alarmdb.save', { id, state, machine: e.machine, type: e.type, priority });
      return e;
    },
    remove(id, user) {
      if (!entries.some((e) => e.id === id)) throw new Error('No such alarm');
      entries = entries.filter((e) => e.id !== id);
      save();
      audit?.add(user, 'alarmdb.remove', { id });
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

module.exports = { createAlarmDb, PRIORITIES };
