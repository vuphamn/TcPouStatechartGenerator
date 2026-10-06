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
      // (muted: kept to be seen, never open: no chime, no escalation)
      if (event.muted) e.resolvedAt = event.at;
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
    /** Every alert kept (the shift report) */
    all: () => events,
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
 * Maintenance: a PLC's alerts are muted during a window (set on the operator board by a signed-in user, with a note):
 * now for some minutes, or planned ahead (e.g. Saturday 06:00 to 14:00). Kept in maintenance.json with the past
 * windows (the availability report counts them). Announced on the webhooks of the PLC's alert rules when a window
 * starts and ends.
 */
function createMaintenance({ file, log, rules, plcOf, audit }) {
  // { windows: [{ id, plc, from, until, by, note, started? }], history: [{ plc, from, until, by, note }] }
  let state = { windows: [], history: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    if (Array.isArray(raw.windows)) state = { windows: raw.windows, history: Array.isArray(raw.history) ? raw.history : [] };
    else {
      // (the earlier format: one window per PLC, started now)
      for (const [plc, m] of Object.entries(raw)) {
        if (m && m.until) state.windows.push({ id: crypto.randomBytes(6).toString('hex'), plc, from: m.since ?? new Date().toISOString(), until: m.until, by: m.by, note: m.note ?? '', started: true });
      }
    }
  } catch {
    state = { windows: [], history: [] };
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
  const name = (plcId) => plcOf(plcId)?.name ?? plcId;
  const time = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const notify = (plcId) => {
    for (const fn of listeners) fn(plcId);
  };
  const close = (w, endedAt, why) => {
    state.windows = state.windows.filter((x) => x !== w);
    if (w.started) state.history.push({ plc: w.plc, from: w.from, until: endedAt, by: w.by, note: w.note });
    if (state.history.length > 2000) state.history = state.history.slice(-2000);
    save();
    if (w.started) {
      log(`maintenance: ${w.plc} ended (${why})`);
      announce(w.plc, `🔧 ${name(w.plc)}: ${why === 'its time was up' ? 'maintenance ended' : `${why} ended the maintenance`}, alerts are on again`);
    }
    notify(w.plc);
  };
  /** Windows that started or ended since the last look: announced once */
  const tick = (now = Date.now()) => {
    for (const w of [...state.windows]) {
      if (Date.parse(w.until) <= now) close(w, w.until, 'its time was up');
      else if (!w.started && Date.parse(w.from) <= now) {
        w.started = true;
        save();
        log(`maintenance: ${w.plc} started (planned by ${w.by})`);
        announce(w.plc, `🔧 ${name(w.plc)}: planned maintenance until ${time(w.until)} (${w.by}${w.note ? `: ${w.note}` : ''}); alerts are muted`);
        notify(w.plc);
      }
    }
  };
  const timer = setInterval(() => tick(), 15000);
  timer.unref();
  const active = (plcId, now = Date.now()) => {
    tick(now);
    return state.windows.find((w) => w.plc === plcId && Date.parse(w.from) <= now && Date.parse(w.until) > now) ?? null;
  };
  return {
    /** The window in force now for the PLC (null: none) */
    get: (plcId) => {
      const w = active(plcId);
      return w ? { id: w.id, from: w.from, until: w.until, by: w.by, note: w.note } : null;
    },
    /** The PLC's planned windows (not started yet), soonest first */
    planned: (plcId) => state.windows.filter((w) => w.plc === plcId && Date.parse(w.from) > Date.now()).sort((a, b) => a.from.localeCompare(b.from)).map((w) => ({ id: w.id, from: w.from, until: w.until, by: w.by, note: w.note })),
    /** Past and current windows of a PLC overlapping [from, to] (the availability report) */
    windowsBetween: (plcId, from, to) => [...state.history, ...state.windows.filter((w) => w.started)].filter((w) => w.plc === plcId && Date.parse(w.from) < to && Date.parse(w.until) > from).map((w) => ({ from: Date.parse(w.from), until: Math.min(Date.parse(w.until), Date.now()) })),
    /**
     * minutes 0: ends the current window (or, with id, removes that planned one). startAt (ms): planned for then;
     * else from now
     */
    set(plcId, minutesFor, user, note, startAt, id) {
      if (!minutesFor) {
        const w = id ? state.windows.find((x) => x.id === id && x.plc === plcId) : active(plcId);
        if (w) {
          if (w.started) close(w, new Date().toISOString(), user);
          else {
            state.windows = state.windows.filter((x) => x !== w);
            save();
            log(`maintenance: ${user} removed the planned window on ${plcId} (${w.from})`);
            notify(plcId);
          }
          audit?.add(user, 'maintenance.end', { plc: plcId, planned: !w.started });
        }
        return this.get(plcId);
      }
      const from = startAt && startAt > Date.now() + 30000 ? new Date(startAt) : new Date();
      const until = new Date(from.getTime() + minutesFor * 60000);
      const planned = from.getTime() > Date.now() + 30000;
      if (!planned) {
        // Now: it replaces a window in force
        const cur = active(plcId);
        if (cur) close(cur, new Date().toISOString(), user);
      }
      const w = { id: crypto.randomBytes(6).toString('hex'), plc: plcId, from: from.toISOString(), until: until.toISOString(), by: user, note: String(note ?? '').trim().slice(0, 200), started: !planned };
      state.windows.push(w);
      save();
      audit?.add(user, 'maintenance.set', { plc: plcId, from: w.from, until: w.until, note: w.note });
      if (planned) {
        log(`maintenance: ${user} planned ${plcId} from ${w.from} until ${w.until}${w.note ? ` ("${w.note}")` : ''}`);
        announce(plcId, `🗓️ ${name(plcId)}: maintenance planned ${time(w.from)} to ${time(w.until)} (${user}${w.note ? `: ${w.note}` : ''})`);
      } else {
        log(`maintenance: ${user} set ${plcId} until ${w.until}${w.note ? ` ("${w.note}")` : ''}`);
        announce(plcId, `🔧 ${name(plcId)}: in maintenance until ${new Date(w.until).toLocaleTimeString()} (${user}${w.note ? `: ${w.note}` : ''}); alerts are muted`);
      }
      notify(plcId);
      return this.get(plcId);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    stop: () => clearInterval(timer),
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
            // (its PLC's ADS state: Run, Stop, Invalid (no program) …; null while not connected)
            return { id, name: plc?.name ?? id, state: m?.state ?? 'stopped', message: m?.message ?? '', plcState: m?.state === 'watching' ? m.conn?.plcState ?? null : null, machines: m?.snapshot() ?? [], maintenance: maintenance?.get(id) ?? null, planned: maintenance?.planned(id) ?? [] };
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
