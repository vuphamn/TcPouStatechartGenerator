// The operator board and the alert history.
// - Board: the gateway follows the machines of the PLCs a board shows (one monitor per PLC, shared by every board;
//   stopped a minute after the last board closes) and sends their states once a second (boardState).
// - Alert history: every alert (alerts.cjs) is kept (alerts-history.json next to config.json, the latest 1000);
//   people signed in to the gateway list them and acknowledge one (with a note), which is logged, sent to every open
//   board and posted to the rule's webhook. A "recovered" alert resolves the machine's open ones.
const fs = require('fs');
const crypto = require('crypto');
const { AlertMonitor, postWebhook } = require('./alerts.cjs');

const MAX_HISTORY = 1000;
const IDLE_MS = 60000;

function createAlertLog({ file, log, rules }) {
  let events = [];
  try {
    events = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(events)) events = [];
  } catch {
    events = [];
  }
  const listeners = new Set();
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.writeFileSync(`${file}.tmp`, JSON.stringify(events.slice(-MAX_HISTORY)));
        fs.renameSync(`${file}.tmp`, file);
      } catch (err) {
        log(`alerts: could not write the history: ${err.message}`);
      }
    }, 500);
  };
  const publish = (event) => {
    for (const fn of listeners) fn(event);
  };

  return {
    /** A new alert (from an alert monitor) */
    add(event) {
      const e = { id: crypto.randomBytes(8).toString('hex'), ...event, ack: null, resolvedAt: null };
      if (event.event === 'recovered') {
        e.resolvedAt = event.at;
        for (const old of events) {
          if (old.plc === event.plc && old.machine === event.machine && !old.resolvedAt && old.event !== 'recovered') {
            old.resolvedAt = event.at;
            publish(old);
          }
        }
      }
      events.push(e);
      if (events.length > MAX_HISTORY) events = events.slice(-MAX_HISTORY);
      save();
      publish(e);
      return e;
    },
    /** The latest alerts, newest first */
    list: (limit = 200) => events.slice(-limit).reverse(),
    /** Acknowledged by a user: logged, posted to the rule's webhook; null when there is no such alert */
    ack(id, user, note) {
      const e = events.find((x) => x.id === id);
      if (!e) return null;
      if (e.ack) return e;
      e.ack = { by: user, at: new Date().toISOString(), note: String(note ?? '').trim().slice(0, 300) };
      save();
      publish(e);
      log(`alerts: ${user} acknowledged ${e.event} ${e.machine}${e.ack.note ? ` ("${e.ack.note}")` : ''}`);
      const rule = rules().find((r) => r.id === e.ruleId);
      if (rule?.webhook) {
        const text = `👤 ${user} acknowledged: ${e.text}${e.ack.note ? ` · ${e.ack.note}` : ''}`;
        void postWebhook(rule.webhook, rule.format, { event: 'acknowledged', of: e.event, rule: e.rule, plc: e.plc, plcName: e.plcName, machine: e.machine, state: e.state, by: user, note: e.ack.note, text, at: e.ack.at }, log);
      }
      return e;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** One monitor per PLC for the boards (the alert rules' limits and error patterns apply when a rule covers the PLC) */
function createBoards({ connectionFor, plcOf, rules, log, retryMs }) {
  const monitors = new Map(); // plc id -> { monitor, users: Set, idle }
  const ruleFor = (plcId, root) => rules().find((r) => r.enabled !== false && r.plc === plcId && r.root === root);

  function acquire(plcId, root, viewer) {
    const key = `${plcId}|${root}`;
    let m = monitors.get(key);
    if (!m) {
      const r = ruleFor(plcId, root);
      const monitor = new AlertMonitor({
        id: `board:${key}`, name: `board ${plcId}`, plc: plcId, root, stateVar: r?.stateVar ?? 'machineState',
        stuckAfterMs: r?.stuckAfterMs ?? null, stateLimits: r?.stateLimits ?? {}, onError: false, notifyRecovery: false,
        errorPattern: r?.errorPattern, webhook: null,
      }, { connectionFor, plcOf, log, retryMs });
      m = { monitor, users: new Set(), idle: null };
      monitors.set(key, m);
      void monitor.start();
    }
    clearTimeout(m.idle);
    m.users.add(viewer);
    return key;
  }

  function release(key, viewer) {
    const m = monitors.get(key);
    if (!m) return;
    m.users.delete(viewer);
    if (m.users.size) return;
    clearTimeout(m.idle);
    m.idle = setTimeout(() => {
      if (m.users.size) return;
      m.monitor.stop();
      monitors.delete(key);
    }, IDLE_MS);
  }

  return {
    /** A board's PLCs followed for viewer; returns the function that stops it */
    watch(plcIds, root, viewer, send) {
      const keys = plcIds.map((id) => acquire(id, root, viewer));
      const tick = () => {
        send({
          type: 'boardState', now: Date.now(), plcs: keys.map((k) => {
            const m = monitors.get(k)?.monitor;
            const plc = plcOf(k.split('|')[0]);
            return { id: plc?.id ?? k, name: plc?.name ?? k, state: m?.state ?? 'stopped', message: m?.message ?? '', machines: m?.snapshot() ?? [] };
          }),
        });
      };
      tick();
      const timer = setInterval(tick, 1000);
      return () => {
        clearInterval(timer);
        for (const k of keys) release(k, viewer);
      };
    },
    stop() {
      for (const m of monitors.values()) {
        clearTimeout(m.idle);
        m.monitor.stop();
      }
      monitors.clear();
    },
  };
}

module.exports = { createAlertLog, createBoards };
