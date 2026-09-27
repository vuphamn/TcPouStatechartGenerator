// The operator board and the alert history.
// - Board: the gateway follows the machines of the PLCs a board shows (one monitor per PLC, shared by every board;
//   stopped a minute after the last board closes) and sends their states once a second (boardState).
// - Alert history: every alert (alerts.cjs) is kept (alerts-history.json next to config.json, the latest 1000);
//   people signed in to the gateway list them and acknowledge one (with a note), which is logged, sent to every open
//   board and posted to the rule's webhook. A "recovered" alert resolves the machine's open ones.
const fs = require('fs');
const crypto = require('crypto');
const { AlertMonitor, postWebhook, parseQuietHours, isQuiet } = require('./alerts.cjs');

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
    /**
     * Escalation: open alerts (not acknowledged, not resolved) older than their rule's "escalate after" are posted
     * again, once, to the escalation webhook (else the rule's), unless the PLC is muted
     */
    escalate(now, mutedFor) {
      for (const e of events) {
        if (e.event === 'recovered' || e.ack || e.resolvedAt || e.escalatedAt) continue;
        const rule = rules().find((r) => r.id === e.ruleId);
        if (!rule?.escalateAfterMin || now - Date.parse(e.at) < rule.escalateAfterMin * 60000) continue;
        if (mutedFor?.(rule, now)) continue;
        e.escalatedAt = new Date(now).toISOString();
        save();
        publish(e);
        const url = rule.escalateWebhook || rule.webhook;
        const text = `⏰ Not acknowledged for ${rule.escalateAfterMin} min: ${e.text}`;
        log(`alerts: escalated ${e.event} ${e.machine} (not acknowledged for ${rule.escalateAfterMin} min)`);
        if (url) void postWebhook(url, rule.escalateFormat || rule.format, { event: 'escalated', of: e.event, rule: e.rule, plc: e.plc, plcName: e.plcName, machine: e.machine, state: e.state, text, at: e.escalatedAt, alertAt: e.at }, log);
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * Maintenance: a PLC's alerts are muted until a time (set on the operator board by a signed-in user, with a note);
 * kept in maintenance.json. Announced on the webhooks of the PLC's alert rules.
 */
function createMaintenance({ file, log, rules, plcOf }) {
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    state = {};
  }
  const listeners = new Set();
  const save = () => {
    try {
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
    } catch (err) {
      log(`maintenance: could not write ${file}: ${err.message}`);
    }
  };
  const announce = (plcId, text) => {
    const seen = new Set();
    for (const r of rules()) {
      if (r.plc !== plcId || !r.webhook || seen.has(r.webhook)) continue;
      seen.add(r.webhook);
      void postWebhook(r.webhook, r.format, { event: 'maintenance', plc: plcId, plcName: plcOf(plcId)?.name ?? plcId, text, at: new Date().toISOString() }, log);
    }
  };
  const get = (plcId) => {
    const m = state[plcId];
    if (!m) return null;
    if (Date.parse(m.until) <= Date.now()) {
      delete state[plcId];
      save();
      log(`maintenance: ${plcId} ended (its time was up)`);
      announce(plcId, `🔧 ${plcOf(plcId)?.name ?? plcId}: maintenance ended, alerts are on again`);
      for (const fn of listeners) fn(plcId);
      return null;
    }
    return m;
  };
  return {
    get,
    /** minutes 0: ends it */
    set(plcId, minutesFor, user, note) {
      const name = plcOf(plcId)?.name ?? plcId;
      if (!minutesFor) {
        const had = !!state[plcId];
        delete state[plcId];
        save();
        if (had) {
          log(`maintenance: ${user} ended it on ${plcId}`);
          announce(plcId, `🔧 ${name}: ${user} ended the maintenance, alerts are on again`);
        }
      } else {
        const until = new Date(Date.now() + minutesFor * 60000).toISOString();
        state[plcId] = { until, by: user, note: String(note ?? '').trim().slice(0, 200), since: new Date().toISOString() };
        save();
        log(`maintenance: ${user} set ${plcId} until ${until}${note ? ` ("${note}")` : ''}`);
        announce(plcId, `🔧 ${name}: in maintenance until ${new Date(until).toLocaleTimeString()} (${user}${note ? `: ${note}` : ''}); alerts are muted`);
      }
      for (const fn of listeners) fn(plcId);
      return get(plcId);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Is a rule muted now: its PLC in maintenance, or within its quiet hours */
function mutedFor(maintenance) {
  const cache = new Map();
  return (rule, now = Date.now()) => {
    if (maintenance.get(rule.plc)) return true;
    if (!rule.quietHours) return false;
    if (!cache.has(rule.quietHours)) cache.set(rule.quietHours, parseQuietHours(rule.quietHours));
    return isQuiet(cache.get(rule.quietHours), new Date(now));
  };
}

/** One monitor per PLC for the boards (the alert rules' limits and error patterns apply when a rule covers the PLC) */
function createBoards({ connectionFor, plcOf, rules, log, retryMs, maintenance }) {
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
            const id = plc?.id ?? k.split('|')[0];
            return { id, name: plc?.name ?? id, state: m?.state ?? 'stopped', message: m?.message ?? '', machines: m?.snapshot() ?? [], maintenance: maintenance?.get(id) ?? null };
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

module.exports = { createAlertLog, createBoards, createMaintenance, mutedFor };
