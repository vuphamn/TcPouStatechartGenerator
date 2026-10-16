// Servo axis health (AX5000, AX8000, any NC axis): each AXIS_REF of a PLC's program found, its NcToPlc read every few
// seconds (Tc2_MC2: ErrorCode, AxisState, SetVelo, ActVelo, PosDiff: the following error, ActTorque). While it moves
// (its set velocity not 0): its following error and its torque kept, their 95th percentile a day. Judged: an NC error
// (alarm); its following error or its torque today above its own past (the median of its daily values, the last 14
// days, 3 at least): the mechanics (backlash, a bearing, a coupling), its tuning, friction, the load. Read-only;
// config.json "axes": { "enabled": true, "everySeconds": 10, "plcs": [..], "limits": { "lagRise": { "watch": 30,
// "warn": 60 }, "torqueRise": { "watch": 15, "warn": 30 }, "minSamples": 20 } } (%; its samples
// moving today before it is judged). Kept in axes/<plc>/summary.json beside config.json.
const fs = require('fs');
const path = require('path');

const FIELDS = ['ErrorCode', 'AxisState', 'SetVelo', 'ActVelo', 'PosDiff', 'ActTorque'];
const TREE_EVERY_MS = 30 * 60000;
const MAX_SAMPLES = 20000;
const REPEAT_MS = 12 * 3600_000;

const dayOf = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
};
const median = (xs) => quantile(xs, 0.5);

/** An axis judged: { latest, today: { lagP95, torqueP95, n }, past: { day: { lagP95, torqueP95 } }, limits } */
function judgeAxis({ latest, today, past, limits }) {
  const L = { lagRise: { watch: 30, warn: 60 }, torqueRise: { watch: 15, warn: 30 }, ...limits };
  const findings = [];
  const add = (level, key, text) => findings.push({ level, key, text });
  const err = latest.ErrorCode;
  if (typeof err === 'number' && err) add('alarm', 'error', `NC error 0x${err.toString(16).toUpperCase().padStart(4, '0')}`);
  const baseline = {};
  for (const [k, key, what, why] of [
    ['lagP95', 'lag', 'Following error', 'its mechanics (backlash, a bearing, a coupling), its tuning, the load'],
    ['torqueP95', 'torque', 'Torque to move', 'friction, the load, its brake'],
  ]) {
    const days = Object.values(past).map((d) => d?.[k]).filter((x) => typeof x === 'number' && x > 0);
    if (days.length < 3) continue;
    const b = median(days);
    baseline[key] = b;
    const now = today?.[k];
    if (typeof now !== 'number' || !today.n || today.n < (L.minSamples ?? 20) || !(b > 0)) continue;
    const rise = ((Math.abs(now) - b) / b) * 100;
    const lim = key === 'lag' ? L.lagRise : L.torqueRise;
    const text = `${what} ${Math.round(rise)} % above its last ${days.length} days (${+Math.abs(now).toPrecision(3)}, was ${+b.toPrecision(3)}): ${why}`;
    if (rise >= lim.warn) add('warn', key, text);
    else if (rise >= lim.watch) add('watch', key, text);
  }
  const order = ['ok', 'watch', 'warn', 'alarm'];
  const level = findings.reduce((w, f) => (order.indexOf(f.level) > order.indexOf(w) ? f.level : w), 'ok');
  findings.sort((a, b) => order.indexOf(b.level) - order.indexOf(a.level));
  return { level, findings, baseline };
}

function createAxes({ baseDir, getConfig, plcList, connectionFor, ads, log, onEvent }) {
  const settings = () => {
    const c = getConfig().axes ?? {};
    return { enabled: c.enabled !== false, everyMs: Math.max(2, Math.min(600, Number(c.everySeconds) || 10)) * 1000, plcs: Array.isArray(c.plcs) && c.plcs.length ? c.plcs : null, limits: c.limits ?? {} };
  };
  const monitors = new Map();
  const listeners = new Set();
  const dirOf = (plcId) => path.join(baseDir, 'axes', String(plcId).replace(/[^\w.-]/g, '_'));

  class AxisMonitor {
    constructor(plc) {
      this.plc = plc;
      this.state = 'starting';
      this.message = '';
      this.axes = []; // { path, name, fields: { name: { handle, info } }, latest, samples: { lag: [], torque: [] }, health, sent }
      this.treeAt = 0;
      this.conn = null;
      this.busy = false;
      this.stopped = false;
      this.viewer = { send: () => {}, push: () => {}, lost: (m) => this.lost(m) };
      this.summary = { days: {} };
      try {
        this.summary = JSON.parse(fs.readFileSync(path.join(dirOf(plc.id), 'summary.json'), 'utf8'));
      } catch {
        // none yet
      }
      this.day = dayOf(Date.now());
    }
    async start() {
      if (this.stopped) return;
      try {
        const conn = connectionFor(this.plc);
        await conn.connect();
        if (this.stopped) return;
        this.conn = conn;
        conn.viewers.add(this.viewer);
        clearTimeout(conn.idleTimer);
        this.state = 'watching';
        await this.find();
        if (!this.axes.length) {
          // (no axis: its connection let go, looked at again later)
          this.state = 'idle';
          this.message = 'No AXIS_REF in its program';
          this.release();
          for (const fn of listeners) fn(this.plc.id);
          this.retry = setTimeout(() => void this.start(), TREE_EVERY_MS);
          return;
        }
        void this.round();
        this.timer = setInterval(() => void this.round(), settings().everyMs);
      } catch (err) {
        this.state = 'error';
        this.message = err instanceof Error ? err.message : String(err);
        this.retry = setTimeout(() => void this.start(), 60000);
      }
    }
    release() {
      const conn = this.conn;
      this.conn = null;
      conn?.viewers.delete(this.viewer);
      if (conn && conn.viewers.size === 0) void conn.unwatch({}).catch(() => {});
    }
    lost(message) {
      clearInterval(this.timer);
      this.state = 'error';
      this.message = message || 'The connection to the PLC was lost';
      this.conn = null;
      this.axes.forEach((a) => (a.fields = {}));
      clearTimeout(this.retry);
      if (!this.stopped) this.retry = setTimeout(() => void this.start(), 30000);
    }
    stop() {
      this.stopped = true;
      clearInterval(this.timer);
      clearTimeout(this.retry);
      this.saveSummary();
      this.release();
    }
    /** Its axes: each AXIS_REF instance, its NcToPlc fields' handles */
    async find() {
      const client = this.conn?.client;
      if (!client) return;
      this.treeAt = Date.now();
      const paths = await ads.discoverInstances(client, 'AXIS_REF', 200).catch(() => []);
      const old = new Map(this.axes.map((a) => [a.path, a]));
      const axes = [];
      for (const p0 of paths) {
        const p = typeof p0 === 'string' ? p0 : p0.path ?? p0.name;
        const a = old.get(p) ?? { path: p, name: p.split('.').pop(), latest: {}, samples: { lag: [], torque: [] }, health: null, sent: {} };
        a.fields = {};
        for (const f of FIELDS) {
          const sym = `${p}.NcToPlc.${f}`;
          try {
            const info = await ads.probe(client, sym);
            if (info) a.fields[f] = { handle: await ads.createHandle(client, sym), info };
          } catch {
            // (not this one's)
          }
        }
        if (Object.keys(a.fields).length) axes.push(a);
      }
      this.axes = axes;
      log(`axes: ${this.plc.id}: ${axes.length} axis/axes (${axes.map((a) => a.name).join(', ') || 'none'})`);
    }
    async round() {
      const client = this.conn?.client;
      if (!client || this.busy || this.stopped) return;
      this.busy = true;
      try {
        if (Date.now() - this.treeAt > TREE_EVERY_MS) await this.find();
        const today = dayOf(Date.now());
        if (today !== this.day) this.rollDay(today);
        for (const a of this.axes) {
          for (const [f, x] of Object.entries(a.fields)) {
            try {
              a.latest[f] = await ads.readTyped(client, x.handle, x.info);
            } catch {
              a.latest[f] = null;
            }
          }
          const moving = typeof a.latest.SetVelo === 'number' && Math.abs(a.latest.SetVelo) > 1e-6;
          if (moving) {
            if (typeof a.latest.PosDiff === 'number') a.samples.lag.push(Math.abs(a.latest.PosDiff));
            if (typeof a.latest.ActTorque === 'number') a.samples.torque.push(Math.abs(a.latest.ActTorque));
            for (const k of ['lag', 'torque']) if (a.samples[k].length > MAX_SAMPLES) a.samples[k].splice(0, a.samples[k].length - MAX_SAMPLES);
          }
        }
        this.judge();
        this.lastRound = Date.now();
        this.message = '';
        for (const fn of listeners) fn(this.plc.id);
      } finally {
        this.busy = false;
      }
    }
    todayOf(a) {
      return { lagP95: quantile(a.samples.lag, 0.95), torqueP95: quantile(a.samples.torque, 0.95), n: Math.max(a.samples.lag.length, a.samples.torque.length) };
    }
    rollDay(today) {
      const keep = (this.summary.days[this.day] ??= {});
      for (const a of this.axes) if (a.samples.lag.length || a.samples.torque.length) keep[a.path] = this.todayOf(a);
      for (const a of this.axes) a.samples = { lag: [], torque: [] };
      const days = Object.keys(this.summary.days).sort();
      for (const old of days.slice(0, Math.max(0, days.length - 60))) delete this.summary.days[old];
      this.day = today;
      this.saveSummary();
    }
    saveSummary() {
      try {
        fs.mkdirSync(dirOf(this.plc.id), { recursive: true });
        fs.writeFileSync(path.join(dirOf(this.plc.id), 'summary.json'), JSON.stringify(this.summary));
      } catch (err) {
        log(`axes: ${this.plc.id}: ${err.message}`);
      }
    }
    judge() {
      const days = Object.keys(this.summary.days).filter((d) => d < this.day).sort().slice(-14);
      const now = Date.now();
      for (const a of this.axes) {
        const past = Object.fromEntries(days.map((d) => [d, this.summary.days[d]?.[a.path]]).filter(([, v]) => v));
        const before = a.health;
        a.health = judgeAxis({ latest: a.latest, today: this.todayOf(a), past, limits: settings().limits });
        for (const f of a.health.findings.filter((x) => x.level === 'warn' || x.level === 'alarm')) {
          const key = `${f.key}|${f.level}`;
          if (now - (a.sent[key] ?? 0) < REPEAT_MS) continue;
          a.sent[key] = now;
          onEvent?.({ event: 'drive', level: f.level, rule: 'Axis health', ruleId: 'axes', plc: this.plc.id, plcName: this.plc.name, machine: a.path, state: f.level, text: `${this.plc.name}: ⚙️ ${a.name}: ${f.text}`, at: new Date().toISOString() });
        }
        const bad = (h) => h && (h.level === 'warn' || h.level === 'alarm');
        if (bad(before) && !bad(a.health)) {
          a.sent = {};
          onEvent?.({ event: 'recovered', rule: 'Axis health', ruleId: 'axes', plc: this.plc.id, plcName: this.plc.name, machine: a.path, state: 'ok', text: `${this.plc.name}: ✅ ${a.name}: healthy again`, at: new Date().toISOString() });
        }
      }
    }
    view() {
      return {
        id: this.plc.id, name: this.plc.name, state: this.state, message: this.message, lastRound: this.lastRound ?? null,
        axes: this.axes.map((a) => ({ path: a.path, name: a.name, latest: a.latest, today: this.todayOf(a), health: a.health })),
      };
    }
  }

  const apply = () => {
    const s = settings();
    const wanted = new Set(s.enabled ? plcList().filter((p) => !s.plcs || s.plcs.includes(p.id)).map((p) => p.id) : []);
    for (const [id, m] of monitors) {
      if (wanted.has(id) && JSON.stringify(m.plc) === JSON.stringify(plcList().find((p) => p.id === id))) continue;
      m.stop();
      monitors.delete(id);
    }
    for (const plc of plcList()) {
      if (!wanted.has(plc.id) || monitors.has(plc.id)) continue;
      const m = new AxisMonitor(plc);
      monitors.set(plc.id, m);
      void m.start();
    }
  };
  return {
    apply,
    start: () => apply(),
    stop() {
      for (const m of monitors.values()) m.stop();
      monitors.clear();
    },
    view: (ids) => [...monitors.values()].filter((m) => !ids?.length || ids.includes(m.plc.id)).map((m) => m.view()),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    stats: () => [...monitors.values()].map((m) => ({ plc: m.plc.id, axes: m.axes.length, everyMs: settings().everyMs })),
  };
}

module.exports = { createAxes, judgeAxis };
