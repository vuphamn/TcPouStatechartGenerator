// Alerts: the gateway follows the state machines of a PLC by itself (no browser needed) and posts to a webhook
// (Teams, Slack, or any JSON endpoint) when one is stuck (longer in a state than its limit) or goes into an error
// state, and when it recovers. Rules are in config.json "alerts" (the setup page edits them). Read-only on the PLC.
// The PLC itself too (onPlcStop, on by default): it stops running (Stop, no program, its runtime gone: from its ADS
// state, read every 2 s by its connection) or stops answering: one alert; running again: recovered.
const ads = require(require('fs').existsSync(require('path').join(__dirname, 'shared', 'tcAds.cjs')) ? './shared/tcAds.cjs' : '../shared/tcAds.cjs');
const { VarWatcher } = require(require('fs').existsSync(require('path').join(__dirname, 'shared', 'liveVars.cjs')) ? './shared/liveVars.cjs' : '../shared/liveVars.cjs');

const DEFAULT_ERROR = 'ERROR|FAULT|ALARM|E_?STOP|ABORT';
const MAX_DEPTH = 5;
const MAX_BROWSES = 400;
const MAX_MACHINES = 200;
/** The same library blocks the Machine Overview does not walk into */
const LIBRARY_TYPE = /^(TON|TOF|TP|R_TRIG|F_TRIG|CTU|CTD|CTUD|RS|SR|LTON|LTOF|LTP|MC_\w+|AXIS_REF\w*|NCTOPLC\w*|PLCTONC\w*|FB_(?:Ads|File|Json|Log|Sql|Xml)\w*|T_\w+|ST_Lib\w*)$/i;
/** At most one message per machine and kind in this time (a machine flapping in and out of an error) */
const REPEAT_MS = 5 * 60 * 1000;

const formatDuration = (ms) => {
  if (ms < 10000) return `${Math.round(ms / 100) / 10} s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dayNumber = (d) => {
  const i = DAYS.indexOf(d.toLowerCase().slice(0, 3));
  if (i < 0) throw new Error(`"${d}" is not a day (Mon, Tue, ...)`);
  return i;
};
const minutes = (hm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m || Number(m[1]) > 24 || Number(m[2]) > 59) throw new Error(`"${hm}" is not a time (HH:MM)`);
  return Number(m[1]) * 60 + Number(m[2]);
};

/**
 * Quiet hours: "Mon-Fri 22:00-06:00; Sat,Sun" (days, a time range that may pass midnight, or whole days; a range
 * without days is every day). Returns [{ days: Set of 0-6 (Sun 0), from, to (minutes) }]; throws why not.
 */
function parseQuietHours(text) {
  const out = [];
  for (const part of String(text ?? '').split(';').map((p) => p.trim()).filter(Boolean)) {
    const m = /^([A-Za-z,\- ]+?)?\s*(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})?$/.exec(part);
    if (!m || (!m[1] && !m[2])) throw new Error(`"${part}": days and / or a time range, such as Mon-Fri 22:00-06:00`);
    const days = new Set();
    for (const item of (m[1] ?? '').split(',').map((d) => d.trim()).filter(Boolean)) {
      const [a, b] = item.split('-').map((d) => d.trim());
      if (b) for (let d = dayNumber(a), n = 0; n < 7; d = (d + 1) % 7, n++) {
        days.add(d);
        if (d === dayNumber(b)) break;
      }
      else days.add(dayNumber(a));
    }
    if (!days.size) for (let d = 0; d < 7; d++) days.add(d);
    const [from, to] = m[2] ? m[2].split('-').map((x) => minutes(x.trim())) : [0, 24 * 60];
    out.push({ days, from, to });
  }
  return out;
}

/** Is this time within the quiet hours (a range past midnight belongs to the day it starts on) */
function isQuiet(ranges, date = new Date()) {
  const day = date.getDay();
  const t = date.getHours() * 60 + date.getMinutes();
  return ranges.some((r) => (r.from <= r.to ? r.days.has(day) && t >= r.from && t < r.to : (r.days.has(day) && t >= r.from) || (r.days.has((day + 6) % 7) && t < r.to)));
}

/** A rule from config.json, checked; throws with a message for the setup page */
function checkRule(r, i, plcIds) {
  const where = `Alert ${i + 1}`;
  const id = String(r?.id ?? '').trim() || `alert${i + 1}`;
  if (!/^[\w-]{1,40}$/.test(id)) throw new Error(`${where}: the id is letters, digits, - or _`);
  if (!plcIds.includes(r?.plc)) throw new Error(`${where}: choose one of the gateway's PLCs`);
  const root = String(r?.root ?? 'MAIN.mainStateMachine').trim();
  if (!ads.isSymbolPath(root)) throw new Error(`${where}: the root is a symbol path such as MAIN.mainStateMachine`);
  const stateVar = String(r?.stateVar ?? 'machineState').trim();
  if (!/^[A-Za-z_]\w*$/.test(stateVar)) throw new Error(`${where}: the state variable is a name such as machineState`);
  const stuckAfterMs = r?.stuckAfterMs == null || r.stuckAfterMs === '' ? null : Number(r.stuckAfterMs);
  if (stuckAfterMs !== null && (!Number.isFinite(stuckAfterMs) || stuckAfterMs < 1000)) throw new Error(`${where}: "stuck after" is at least 1 s`);
  const stateLimits = {};
  for (const [k, v] of Object.entries(r?.stateLimits ?? {})) {
    if (!/^[A-Za-z_][\w.]*$/.test(k) || !Number.isFinite(Number(v)) || Number(v) < 1000) throw new Error(`${where}: state limits are STATE_NAME: milliseconds (at least 1000)`);
    stateLimits[k] = Number(v);
  }
  const errorPattern = String(r?.errorPattern ?? DEFAULT_ERROR);
  try {
    new RegExp(errorPattern, 'i');
  } catch {
    throw new Error(`${where}: the error pattern is not a valid regular expression`);
  }
  // (no webhook: the alerts go to the history and the operator board only)
  const webhook = String(r?.webhook ?? '').trim() || null;
  if (webhook && !/^https?:\/\/[^\s]+$/i.test(webhook)) throw new Error(`${where}: the webhook is an http(s) URL (or empty)`);
  const format = ['teams', 'slack', 'json'].includes(r?.format) ? r.format : 'json';
  // Escalation: not acknowledged within this time, posted again (to the escalation webhook, else the rule's)
  const escalateAfterMin = r?.escalateAfterMin == null || r.escalateAfterMin === '' ? null : Number(r.escalateAfterMin);
  if (escalateAfterMin !== null && (!Number.isFinite(escalateAfterMin) || escalateAfterMin < 1)) throw new Error(`${where}: "escalate after" is at least 1 minute`);
  const escalateWebhook = String(r?.escalateWebhook ?? '').trim() || null;
  if (escalateWebhook && !/^https?:\/\/[^\s]+$/i.test(escalateWebhook)) throw new Error(`${where}: the escalation webhook is an http(s) URL (or empty)`);
  if (escalateAfterMin !== null && !escalateWebhook && !webhook) throw new Error(`${where}: escalation needs a webhook`);
  const quietHours = String(r?.quietHours ?? '').trim() || null;
  try {
    parseQuietHours(quietHours);
  } catch (err) {
    throw new Error(`${where}: quiet hours: ${err.message}`);
  }
  return {
    id, name: String(r?.name ?? '').trim().slice(0, 80) || id, enabled: r?.enabled !== false, plc: r.plc, root, stateVar, stuckAfterMs, stateLimits, onPlcStop: r?.onPlcStop !== false,
    onError: r?.onError !== false, errorPattern, notifyRecovery: r?.notifyRecovery !== false, webhook, format,
    escalateAfterMin, escalateWebhook, escalateFormat: ['teams', 'slack', 'json'].includes(r?.escalateFormat) ? r.escalateFormat : format, quietHours,
  };
}

/** The webhook's body: Teams and Slack incoming webhooks take { text }; json: the event with its fields */
function webhookBody(format, event) {
  if (format === 'json') return event;
  return { text: event.text };
}

async function postWebhook(url, format, event, log) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(webhookBody(format, event)), signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      log(`alerts: webhook answered ${res.status} for ${event.machine ?? 'the test'}`);
      return { ok: false, message: `The webhook answered ${res.status} ${res.statusText}` };
    }
    return { ok: true, message: 'Sent' };
  } catch (err) {
    log(`alerts: webhook failed: ${err?.message ?? err}`);
    return { ok: false, message: `Could not reach the webhook: ${err?.message ?? err}` };
  }
}

class AlertMonitor {
  constructor(rule, env) {
    this.rule = rule;
    this.env = env; // { connectionFor, plcOf, log }
    this.machines = []; // { path, type, stateNames }
    this.tracks = new Map(); // id -> { value, since, stuck, error, sent: { kind: time } }
    this.state = 'starting';
    this.message = '';
    this.lastAlert = null;
    this.stopped = false;
    this.vars = null;
    this.timer = null;
    this.retry = null;
    this.conn = null;
    this.viewer = { send: (m) => m?.type === 'liveStatus' && m.state === 'plcState' && this.plcState(m.plcState), push: () => {}, lost: (message) => this.lost(message) };
    // The PLC itself, as one more thing followed (its ADS state; down: it stopped running or answering, alerted)
    this.plc = { value: null, since: Date.now(), sent: {}, down: false };
  }

  /** The PLC, as alerts name it (its state names are its ADS states) */
  plcMachine(value) {
    return { path: 'PLC', type: 'PLC', stateNames: { [String(value)]: String(value) } };
  }

  /** Its ADS state changed: it stopped running (from Run), or runs again (after it was alerted) */
  plcState(state) {
    const was = this.plc.value;
    // (a new stay: its muted alert said again)
    this.plc = { ...this.plc, value: state, since: Date.now(), mutedSent: undefined };
    if (this.rule.onPlcStop !== true) return;
    if (was === 'Run' && state !== 'Run' && !this.plc.down) {
      const why = state === 'Stop' ? 'is stopped' : state === 'Invalid' ? 'runs no program' : `is in ${state}`;
      if (this.alert('plcStopped', this.plcMachine(state), this.plc, `⏹️ the PLC ${why} (it was running)`)) this.plc.down = true;
    } else if (state === 'Run' && this.plc.down) {
      this.plc.down = false;
      if (this.rule.notifyRecovery) this.alert('recovered', this.plcMachine(state), this.plc, '✅ the PLC runs again');
    }
  }

  status() {
    return { id: this.rule.id, name: this.rule.name, state: this.state, message: this.message, machines: this.machines.length, lastAlert: this.lastAlert };
  }

  async start() {
    if (this.stopped) return;
    const plc = this.env.plcOf(this.rule.plc);
    if (!plc) {
      this.state = 'error';
      this.message = `No PLC "${this.rule.plc}"`;
      return;
    }
    this.state = 'connecting';
    this.message = `Connecting to ${plc.name}`;
    try {
      const conn = this.env.connectionFor(plc);
      await conn.connect();
      if (this.stopped) return;
      this.conn = conn;
      conn.viewers.add(this.viewer);
      clearTimeout(conn.idleTimer);
      this.machines = await this.discover(conn.client);
      if (this.stopped) return;
      this.vars = new VarWatcher(conn.client, () => {});
      // (and a recording's extra variables, e.g. guard values: ids "var:<path>")
      await this.vars.set([
        ...this.machines.map((m) => ({ id: m.path.toLowerCase(), candidates: [`${m.path}.${this.rule.stateVar}`] })),
        ...(this.rule.extraVars ?? []).map((p) => ({ id: `var:${p.toLowerCase()}`, candidates: [p] })),
      ]);
      this.timer = setInterval(() => this.tick(), 1000);
      // (its PLC's state as connected: running again after it was lost or stopped: recovered)
      this.plcState(conn.plcState);
      this.state = 'watching';
      this.message = `${this.machines.length} machine${this.machines.length === 1 ? '' : 's'} on ${plc.name}`;
      this.env.log(`alerts: "${this.rule.name}" watches ${this.machines.length} machine(s) under ${this.rule.root} on ${plc.id}`);
    } catch (err) {
      this.state = 'error';
      this.message = err instanceof Error ? err.message : String(err);
      this.env.log(`alerts: "${this.rule.name}": ${this.message}`);
      this.later();
    }
  }

  /** Every state machine under the rule's root (as the Machine Overview finds them) */
  async discover(client) {
    const found = new Map();
    const queue = [{ path: this.rule.root, depth: 0 }];
    const seen = new Set([this.rule.root.toLowerCase()]);
    const cache = new Map();
    let read = 0;
    while (queue.length && read < MAX_BROWSES && found.size < MAX_MACHINES && !this.stopped) {
      const item = queue.shift();
      read++;
      const r = await ads.browseSymbol(client, item.path, { stateVar: this.rule.stateVar, cache });
      if (r.error) {
        if (item.path === this.rule.root) throw new Error(`${this.rule.root}: ${r.error}`);
        continue;
      }
      if (r.stateMachine && !found.has(r.path.toLowerCase())) found.set(r.path.toLowerCase(), { path: r.path, type: r.symbolType ?? '', stateNames: r.stateNames ?? {} });
      for (const c of r.children ?? []) {
        if (c.stateMachine && !found.has(c.path.toLowerCase())) found.set(c.path.toLowerCase(), { path: c.path, type: c.type, stateNames: c.stateNames ?? {} });
        const last = c.type.trim().split('.').pop().replace(/^ARRAY.*OF\s+/i, '');
        if ((c.kind === 'struct' || c.kind === 'array') && !LIBRARY_TYPE.test(last) && item.depth + 1 <= MAX_DEPTH && !seen.has(c.path.toLowerCase())) {
          seen.add(c.path.toLowerCase());
          queue.push({ path: c.path, depth: item.depth + 1 });
        }
      }
    }
    return [...found.values()];
  }

  tick() {
    const now = Date.now();
    for (const s of this.vars?.drain() ?? []) {
      if (s.id.startsWith('var:')) {
        // (the path as written in the rule, not the lower-case id)
        const p = (this.rule.extraVars ?? []).find((x) => x.toLowerCase() === s.id.slice(4)) ?? s.id.slice(4);
        this.env.onVar?.(p, s.v, s.t || now);
        continue;
      }
      if (typeof s.v !== 'number') continue;
      const t = this.tracks.get(s.id);
      if (t && t.value === s.v) continue;
      const m = this.machines.find((x) => x.path.toLowerCase() === s.id);
      if (!m) continue;
      const was = t ? { stuck: t.stuck, error: t.error, name: this.name(m, t.value) } : null;
      // (the gateway's clock: the first value's time is when it was first seen)
      const next = { value: s.v, since: now, first: !t, stuck: false, error: false, sent: t?.sent ?? {} };
      this.tracks.set(s.id, next);
      this.env.onSample?.(m, s.v, s.t || now);
      const name = this.name(m, s.v);
      if (was && (was.stuck || was.error) && this.rule.notifyRecovery) this.alert('recovered', m, next, `✅ ${m.path} left ${was.name}: now ${name}`);
      if (this.rule.onError && new RegExp(this.rule.errorPattern, 'i').test(name)) {
        next.error = true;
        this.alert('error', m, next, `🛑 ${m.path} is in ${name}`);
      }
    }
    for (const m of this.machines) {
      const t = this.tracks.get(m.path.toLowerCase());
      if (!t || t.stuck) continue;
      const name = this.name(m, t.value);
      const limit = this.rule.stateLimits[name] ?? this.rule.stuckAfterMs;
      if (!limit || now - t.since <= limit) continue;
      // (muted: not marked, so it is reported once the maintenance or the quiet hours end)
      if (this.alert('stuck', m, t, `⚠️ ${m.path} is stuck in ${name} for more than ${formatDuration(limit)}`)) t.stuck = true;
    }
  }

  name(m, value) {
    return m.stateNames?.[String(value)] ?? `#${value}`;
  }

  /**
   * Posts an alert; false when muted (maintenance, quiet hours) or repeated too soon. A muted one is still kept, once
   * per stay, in the history and on the board as muted (with why): a planned stop does not look like a fault there,
   * and nobody is called (no webhook, no chime, not open)
   */
  alert(kind, m, t, text) {
    const now = Date.now();
    if (kind !== 'recovered' && t.sent[kind] && now - t.sent[kind] < REPEAT_MS) return false;
    const plc = this.env.plcOf(this.rule.plc);
    const event = {
      event: kind, rule: this.rule.name, ruleId: this.rule.id, plc: this.rule.plc, plcName: plc?.name ?? this.rule.plc, machine: m.path, type: m.type,
      state: this.name(m, t.value), value: t.value, since: new Date(t.since).toISOString(), durationMs: now - t.since,
      text: `${plc?.name ?? this.rule.plc}: ${text}`, at: new Date(now).toISOString(),
    };
    const muted = this.mutedWhy(now);
    if (muted) {
      if (kind !== 'recovered') {
        this.env.log(`alerts: ${kind} ${m.path} muted (${muted})`);
        if (!t.mutedSent?.[kind]) {
          t.mutedSent = { ...(t.mutedSent ?? {}), [kind]: now };
          this.env.onEvent?.({ ...event, muted }, this.rule);
        }
      }
      return false;
    }
    t.sent[kind] = now;
    this.lastAlert = { kind, machine: m.path, state: event.state, at: event.at };
    this.env.log(`alerts: ${kind} ${m.path} (${event.state}) on ${this.rule.plc}`);
    // The alert history (the web app lists and acknowledges it), then the webhook
    this.env.onEvent?.(event, this.rule);
    if (this.rule.webhook) void postWebhook(this.rule.webhook, this.rule.format, event, this.env.log);
    return true;
  }

  /** In maintenance (set on the board) or within the rule's quiet hours */
  muted(now = Date.now()) {
    return !!this.mutedWhy(now);
  }

  /** Why its alerts are muted now: 'maintenance', 'quiet hours', or null */
  mutedWhy(now = Date.now()) {
    if (this.env.maintenanceOf?.(this.rule.plc)) return 'maintenance';
    if (!this.rule.quietHours) return null;
    this.quiet ??= parseQuietHours(this.rule.quietHours);
    return isQuiet(this.quiet, new Date(now)) ? 'quiet hours' : null;
  }

  /** The machines now (the operator board): state, since when (gateway time), in error, the limit that applies */
  snapshot() {
    const error = new RegExp(this.rule.errorPattern || DEFAULT_ERROR, 'i');
    return this.machines.map((m) => {
      const t = this.tracks.get(m.path.toLowerCase());
      const state = t ? this.name(m, t.value) : null;
      return {
        path: m.path, type: m.type, value: t?.value ?? null, state, since: t?.since ?? null, atLeast: !!t?.first,
        error: !!state && error.test(state), limitMs: state ? this.rule.stateLimits?.[state] ?? this.rule.stuckAfterMs ?? null : null,
      };
    });
  }

  lost(message) {
    if (this.stopped) return;
    // (it was running and no longer answers: alerted once, until it runs again)
    if (this.rule.onPlcStop === true && this.state === 'watching' && !this.plc.down) {
      if (this.alert('plcStopped', this.plcMachine('no answer'), { ...this.plc, value: 'no answer', since: Date.now() }, `📵 the PLC stopped answering: ${message}`)) this.plc.down = true;
      this.plc = { ...this.plc, value: null };
    }
    this.state = 'error';
    this.message = message;
    this.cleanup();
    this.later();
  }

  later() {
    clearTimeout(this.retry);
    if (!this.stopped) this.retry = setTimeout(() => this.start(), this.env.retryMs ?? 30000);
  }

  cleanup() {
    clearInterval(this.timer);
    this.timer = null;
    const vars = this.vars;
    this.vars = null;
    if (vars && this.conn?.client) void vars.close().catch(() => {});
    this.conn?.viewers.delete(this.viewer);
    this.conn = null;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    const conn = this.conn;
    this.cleanup();
    // The connection stays for the viewers; without any it closes after its idle time
    if (conn && conn.viewers.size === 0) void conn.unwatch({}).catch(() => {});
  }
}

/** The alert monitors for config.alerts (restarted when their rules change) */
function createAlerts(env) {
  let monitors = new Map(); // rule id -> monitor
  let rulesKey = '';
  return {
    apply(rules) {
      const list = Array.isArray(rules) ? rules.filter((r) => r && r.enabled !== false) : [];
      const key = JSON.stringify(list);
      if (key === rulesKey) return;
      rulesKey = key;
      for (const m of monitors.values()) m.stop();
      monitors = new Map();
      for (const r of list) {
        const m = new AlertMonitor(r, env);
        monitors.set(r.id, m);
        void m.start();
      }
    },
    /** A PLC's connection was replaced (its settings changed): its monitors start again */
    restartFor(plcId) {
      for (const m of monitors.values()) {
        if (m.rule.plc !== plcId) continue;
        m.cleanup();
        void m.start();
      }
    },
    status: () => [...monitors.values()].map((m) => m.status()),
    stop() {
      for (const m of monitors.values()) m.stop();
      monitors = new Map();
      rulesKey = '';
    },
  };
}

module.exports = { createAlerts, checkRule, postWebhook, AlertMonitor, parseQuietHours, isQuiet, DEFAULT_ERROR };
