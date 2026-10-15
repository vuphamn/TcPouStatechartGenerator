// The drive health board's monitor: each PLC's drives (the EtherCAT boxes a drive profile matches, driveProfiles.cjs:
// Lenze i550, any maker's CiA 402 drive) read by the gateway itself, read-only, without the PLC's program: their own
// parameters (CoE objects, an SDO upload through the EtherCAT master: ADS index group 0xF302, the device's AMS NetId,
// the slave's EtherCAT address as the port) every 30 seconds (the slow ones, hours and counters, every 10 minutes),
// one after the other: a few mailbox reads a second for a whole line.
// - Kept: drives/<plc>/<day>.jsonl beside config.json (a value when it changes, else every 10 minutes; past days
//   compressed; config.drives.keepDays, 90 by default) and each day's statistics (summary.json), the baselines.
// - Judged (driveHealth.cjs) after each round: against its limits, its own past, its siblings; a drive turning to
//   warn or alarm is an alert (the boards' alert list, the chime, config.drives.webhook), its recovery too.
// - The board's Drives page follows them (drivesWatch: drivesState after each round), a drive's history (driveHistory).
// config.json "drives": { "enabled": true, "everySeconds": 30, "slowEveryMinutes": 10, "keepDays": 90, "plcs": [ids],
// "limits": { … driveHealth DEFAULTS }, "profiles": [ … ], "webhook": "https://…", "format": "teams" }.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { profilesOf, profileFor, decodeValue } = require('./driveProfiles.cjs');
const { evaluate, dayStats } = require('./driveHealth.cjs');

const COE_SDO = 0xf302;
const HEARTBEAT_MS = 10 * 60000;
const TREE_EVERY_MS = 30 * 60000;
const SPARK_KEYS = ['heatsink', 'current', 'currentPct', 'dcBus'];
const SPARK_BUCKET_MS = 15 * 60000;
const REPEAT_MS = 12 * 3600_000;

const dayOf = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function createDrives({ baseDir, getConfig, plcList, connectionFor, sharedDir, ads, log, onEvent, postWebhook }) {
  const { readIoTree } = require(`${sharedDir}/tcIoTree.cjs`);
  const { readBootFile } = require(`${sharedDir}/tcSources.cjs`);
  const { readEcatStates } = require(`${sharedDir}/tcEcat.cjs`);
  const settings = () => {
    const c = getConfig().drives ?? {};
    return {
      enabled: c.enabled !== false && getConfig().allowBrowse !== false,
      everyMs: Math.max(5, Math.min(3600, Number(c.everySeconds) || 30)) * 1000,
      slowMs: Math.max(1, Math.min(24 * 60, Number(c.slowEveryMinutes) || 10)) * 60000,
      keepDays: Math.max(2, Math.min(3650, Number(c.keepDays) || 90)),
      plcs: Array.isArray(c.plcs) && c.plcs.length ? c.plcs : null,
      limits: c.limits && typeof c.limits === 'object' ? c.limits : {},
      profiles: profilesOf(c.profiles, log),
      webhook: typeof c.webhook === 'string' && /^https?:\/\//i.test(c.webhook) ? c.webhook : null,
      format: ['teams', 'slack', 'json'].includes(c.format) ? c.format : 'teams',
    };
  };
  const dirOf = (plcId) => path.join(baseDir, 'drives', String(plcId).replace(/[^\w.-]/g, '_'));
  const monitors = new Map(); // plc id -> monitor
  const listeners = new Set();

  class DriveMonitor {
    constructor(plc) {
      this.plc = plc;
      this.state = 'starting';
      this.message = '';
      this.conn = null;
      this.tree = null;
      this.treeAt = 0;
      this.drives = []; // { path, name, device, netId, address, profile, latest, slowAt, failing, stored, today: [], spark, health, sent }
      this.timer = null;
      this.busy = false;
      this.stopped = false;
      this.lastRound = null;
      this.summary = this.readSummary();
      this.viewer = { send: () => {}, push: () => {}, lost: (m) => this.lost(m) };
    }

    readSummary() {
      try {
        return JSON.parse(fs.readFileSync(path.join(dirOf(this.plc.id), 'summary.json'), 'utf8'));
      } catch {
        return { days: {} };
      }
    }

    saveSummary() {
      try {
        fs.mkdirSync(dirOf(this.plc.id), { recursive: true });
        fs.writeFileSync(path.join(dirOf(this.plc.id), 'summary.json'), JSON.stringify(this.summary));
      } catch (err) {
        log(`drives: ${this.plc.id}: summary.json: ${err.message}`);
      }
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
        this.message = '';
        await this.readTree();
        // (no drive a profile knows in its I/O: its connection not held for nothing; looked at again later)
        if (!this.drives.length) {
          this.state = 'idle';
          this.message = this.tree?.error ? this.message : 'No drive in its I/O that a profile knows';
          this.conn = null;
          conn.viewers.delete(this.viewer);
          if (conn.viewers.size === 0) void conn.unwatch({}).catch(() => {});
          for (const fn of listeners) fn(this.plc.id);
          clearTimeout(this.retry);
          if (!this.stopped) this.retry = setTimeout(() => void this.start(), TREE_EVERY_MS);
          return;
        }
        this.loadToday();
        void this.round();
        this.timer = setInterval(() => void this.round(), settings().everyMs);
      } catch (err) {
        this.state = 'error';
        this.message = err instanceof Error ? err.message : String(err);
        this.later();
      }
    }

    later() {
      clearTimeout(this.retry);
      if (!this.stopped) this.retry = setTimeout(() => void this.start(), 60000);
    }

    lost(message) {
      if (this.stopped) return;
      this.state = 'error';
      this.message = message;
      clearInterval(this.timer);
      this.conn?.viewers.delete(this.viewer);
      this.conn = null;
      this.later();
    }

    stop() {
      this.stopped = true;
      clearTimeout(this.retry);
      clearInterval(this.timer);
      const conn = this.conn;
      conn?.viewers.delete(this.viewer);
      this.conn = null;
      if (conn && conn.viewers.size === 0) void conn.unwatch({}).catch(() => {});
    }

    /** Its drives from the PLC's I/O (its boot folder); the ones kept, their values and history */
    async readTree() {
      const client = this.conn?.client;
      if (!client) return;
      this.treeAt = Date.now();
      const tree = await readIoTree((rel) => readBootFile(client, rel)).catch((err) => ({ devices: [], error: ads.adsErrorText(err) }));
      this.tree = tree;
      if (tree.error) {
        this.message = `Its I/O not read: ${tree.error}`;
        return;
      }
      const profiles = settings().profiles;
      const found = [];
      for (const d of tree.devices ?? []) {
        if (d.disabled || !d.netId) continue;
        // (the master's own addresses: a box's place among its slaves, when it is not at its default address)
        let slaves = null;
        try {
          const r = await readEcatStates(client, d.netId);
          slaves = r.slaves ?? null;
        } catch {
          slaves = null;
        }
        const walk = (boxes) => {
          for (const b of boxes) {
            const profile = b.disabled ? null : profileFor(b, profiles);
            if (profile) {
              const known = slaves?.some((s) => s.address === b.address);
              const address = known || !slaves ? b.address : slaves[b.slave ?? -1]?.address ?? b.address;
              found.push({ path: b.path, name: b.name.replace(/\s*\([^()]*\)\s*$/, '') || b.name, box: b.name, device: d.name, netId: d.netId, address, profile, product: b.info?.desc ?? '', firmware: b.info?.type ?? '', vendor: b.info?.supplier || (b.info?.vendorId !== undefined ? `vendor #x${b.info.vendorId.toString(16)}` : '') });
            }
            walk(b.boxes);
          }
        };
        walk(d.boxes);
      }
      const old = new Map(this.drives.map((x) => [x.path, x]));
      this.drives = found.map((f) => ({ ...(old.get(f.path) ?? { latest: {}, slowAt: 0, failing: 0, stored: {}, today: [], spark: {}, health: null, sent: {} }), ...f }));
      if (found.length !== old.size) log(`drives: ${this.plc.id}: ${found.length} drive(s) in its I/O (${[...new Set(found.map((x) => x.profile.name))].join(', ') || 'none a profile knows'})`);
    }

    /** Today's samples back from its file (the gateway restarted) */
    loadToday() {
      const file = path.join(dirOf(this.plc.id), `${dayOf(Date.now())}.jsonl`);
      let text = '';
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        return;
      }
      const by = new Map(this.drives.map((d) => [d.path, d]));
      const rows = new Map(); // path -> Map(t -> values)
      for (const line of text.split('\n')) {
        if (!line) continue;
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        const d = by.get(o.d);
        if (!d || typeof o.v !== 'number') continue;
        if (!rows.has(o.d)) rows.set(o.d, new Map());
        const m = rows.get(o.d);
        if (!m.has(o.t)) m.set(o.t, {});
        m.get(o.t)[o.k] = o.v;
        d.stored[o.k] = { v: o.v, t: o.t };
      }
      // (a value kept only when it changed: carried forward to each row)
      for (const [p, m] of rows) {
        const d = by.get(p);
        const cur = {};
        d.today = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, vals]) => ({ t, values: Object.assign(cur, vals) && { ...cur } }));
      }
    }

    async readParam(client, drive, p) {
      const buf = await client.readRaw(COE_SDO, ((p.index & 0xffff) << 16) | (p.sub & 0xff), p.size, { amsNetId: drive.netId, adsPort: drive.address });
      return decodeValue(buf, p);
    }

    /** One round: every drive's values, kept, judged, sent */
    async round() {
      const client = this.conn?.client;
      if (!client || this.busy || this.stopped) return;
      this.busy = true;
      const s = settings();
      try {
        if (Date.now() - this.treeAt > TREE_EVERY_MS) await this.readTree();
        const now = Date.now();
        const lines = [];
        for (const d of this.drives) {
          // (a drive not answering: tried every 5 minutes only)
          if (d.failing >= 3 && now - (d.lastTry ?? 0) < 5 * 60000) continue;
          d.lastTry = now;
          const slow = now - d.slowAt >= s.slowMs;
          let ok = 0;
          for (const p of d.profile.params) {
            if (p.slow && !slow) continue;
            try {
              const r = await this.readParam(client, d, p);
              d.latest[p.key] = { v: r?.value ?? null, raw: r?.raw ?? null, t: now };
              ok++;
            } catch (err) {
              d.latest[p.key] = { v: null, t: now, error: ads.adsErrorText(err) };
            }
          }
          if (slow) d.slowAt = now;
          d.failing = ok ? 0 : d.failing + 1;
          const values = {};
          for (const [k, x] of Object.entries(d.latest)) if (typeof x.v === 'number') values[k] = x.v;
          if (!ok) continue;
          d.today.push({ t: now, values });
          if (d.today.length > 6000) d.today.splice(0, d.today.length - 6000);
          // (kept when it changed, else every 10 minutes)
          for (const [k, v] of Object.entries(values)) {
            const st = d.stored[k];
            if (!st || st.v !== v || now - st.t >= HEARTBEAT_MS) {
              lines.push(JSON.stringify({ t: now, d: d.path, k, v: Math.round(v * 1000) / 1000 }));
              d.stored[k] = { v, t: now };
            }
          }
          for (const k of SPARK_KEYS) {
            if (typeof values[k] !== 'number') continue;
            const b = Math.floor(now / SPARK_BUCKET_MS) * SPARK_BUCKET_MS;
            const list = (d.spark[k] ??= []);
            const last = list[list.length - 1];
            if (last && last.t === b) {
              last.sum += values[k];
              last.n++;
            } else list.push({ t: b, sum: values[k], n: 1 });
            while (list.length && list[0].t < now - 24 * 3600_000) list.shift();
          }
        }
        if (lines.length) {
          try {
            fs.mkdirSync(dirOf(this.plc.id), { recursive: true });
            fs.appendFileSync(path.join(dirOf(this.plc.id), `${dayOf(now)}.jsonl`), lines.join('\n') + '\n');
          } catch (err) {
            log(`drives: ${this.plc.id}: ${err.message}`);
          }
        }
        this.rollDay(now);
        this.judge(s);
        this.lastRound = now;
        this.message = this.drives.length ? '' : this.tree?.error ? this.message : 'No drive in its I/O that a profile knows';
        for (const fn of listeners) fn(this.plc.id);
      } finally {
        this.busy = false;
      }
    }

    /** A new day: yesterday's statistics kept, today's samples begun afresh; old days compressed and removed */
    rollDay(now) {
      const today = dayOf(now);
      for (const d of this.drives) {
        const first = d.today[0];
        if (!first || dayOf(first.t) === today) continue;
        const day = dayOf(first.t);
        const done = d.today.filter((x) => dayOf(x.t) === day);
        d.today = d.today.filter((x) => dayOf(x.t) !== day);
        const stats = dayStats(done, d.profile);
        const counters = {};
        for (const p of d.profile.params.filter((x) => x.counter)) {
          const last = [...done].reverse().find((x) => typeof x.values[p.key] === 'number');
          if (last) counters[p.key] = last.values[p.key];
        }
        ((this.summary.days[day] ??= {})[d.path] = { ...stats, counters });
        this.summary.changed = true;
      }
      if (this.summary.changed) {
        delete this.summary.changed;
        const days = Object.keys(this.summary.days).sort();
        for (const old of days.slice(0, Math.max(0, days.length - 60))) delete this.summary.days[old];
        this.saveSummary();
        this.prune();
      }
    }

    prune() {
      const keep = dayOf(Date.now() - settings().keepDays * 86400000);
      const today = dayOf(Date.now());
      let files = [];
      try {
        files = fs.readdirSync(dirOf(this.plc.id));
      } catch {
        return;
      }
      for (const f of files) {
        const m = /^(\d{4}-\d\d-\d\d)\.jsonl(\.gz)?$/.exec(f);
        if (!m) continue;
        const full = path.join(dirOf(this.plc.id), f);
        try {
          if (m[1] < keep) fs.rmSync(full);
          else if (!m[2] && m[1] < today) {
            fs.writeFileSync(`${full}.gz`, zlib.gzipSync(fs.readFileSync(full)));
            fs.rmSync(full);
          }
        } catch (err) {
          log(`drives: ${f}: ${err.message}`);
        }
      }
    }

    /** Each drive judged (its siblings: the same profile on this PLC); a turn to warn or alarm, and back, said */
    judge(s) {
      const todayStats = new Map(this.drives.map((d) => [d.path, dayStats(d.today, d.profile)]));
      const days = Object.keys(this.summary.days).sort();
      const pastDays = days.slice(-14);
      const weekAgo = days.filter((x) => x <= dayOf(Date.now() - 7 * 86400000)).pop() ?? days[0];
      for (const d of this.drives) {
        const past = {};
        for (const day of pastDays) if (this.summary.days[day]?.[d.path]) past[day] = this.summary.days[day][d.path];
        const peers = this.drives.filter((x) => x !== d && x.profile.id === d.profile.id).map((x) => ({ today: todayStats.get(x.path) }));
        const before = d.health;
        d.health = evaluate({ latest: d.latest, today: todayStats.get(d.path), past, counters7d: weekAgo ? this.summary.days[weekAgo]?.[d.path]?.counters ?? {} : {}, peers, profile: d.profile, limits: s.limits });
        d.todayStats = todayStats.get(d.path);
        const bad = (h) => h && (h.level === 'warn' || h.level === 'alarm');
        const now = Date.now();
        for (const f of d.health.findings.filter((x) => x.level === 'warn' || x.level === 'alarm')) {
          const key = `${f.key}|${f.level}`;
          if (now - (d.sent[key] ?? 0) < REPEAT_MS) continue;
          d.sent[key] = now;
          this.say(d, f.level === 'alarm' ? 'error' : 'drive', `🔧 ${d.name}: ${f.text}`, f.level, s);
        }
        if (bad(before) && !bad(d.health) && d.health.level !== 'unknown') {
          d.sent = {};
          this.say(d, 'recovered', `✅ ${d.name}: healthy again`, d.health.level, s);
        }
      }
    }

    say(d, event, text, level, s) {
      const e = { event: event === 'error' ? 'drive' : event, level, rule: 'Drive health', ruleId: 'drives', plc: this.plc.id, plcName: this.plc.name, machine: d.name, state: level, text: `${this.plc.name}: ${text}`, at: new Date().toISOString() };
      log(`drives: ${this.plc.id}: ${text}`);
      onEvent?.(e);
      if (s.webhook) void postWebhook?.(s.webhook, s.format, e, log);
    }

    /** Each drive's daily heatsink medians while running (the risk list's trends), today's last */
    daily() {
      const days = Object.keys(this.summary.days).sort().slice(-21);
      return Object.fromEntries(this.drives.map((d) => [d.path, [...days.map((day) => ({ day, heatsink: this.summary.days[day]?.[d.path]?.heatsink?.median ?? null })), ...(d.todayStats?.heatsink ? [{ day: new Date().toISOString().slice(0, 10), heatsink: d.todayStats.heatsink.median }] : [])].filter((x, i, all) => all.findIndex((y) => y.day === x.day) === i)]));
    }

    /** As the board shows it */
    view() {
      return {
        id: this.plc.id, name: this.plc.name, state: this.state, message: this.message, lastRound: this.lastRound,
        drives: this.drives.map((d) => ({
          path: d.path, name: d.name, box: d.box, device: d.device, netId: d.netId, address: d.address, profile: d.profile.id, vendor: d.vendor, product: d.product, firmware: d.firmware,
          latest: Object.fromEntries(Object.entries(d.latest).map(([k, x]) => [k, { v: x.v, ...(x.error ? { error: x.error } : {}) }])),
          health: d.health, today: d.todayStats ?? null,
          spark: Object.fromEntries(Object.entries(d.spark).map(([k, list]) => [k, list.map((b) => ({ t: b.t, v: Math.round((b.sum / b.n) * 10) / 10 }))])),
          notAnswering: d.failing >= 3,
        })),
      };
    }

    /** A drive's kept values between from and to (ms), at most 2000 points a key (each bucket's lowest and highest) */
    history(drivePath, keys, from, to) {
      const want = new Set(keys);
      const series = Object.fromEntries(keys.map((k) => [k, []]));
      for (let t = from - 86400000; dayOf(t) <= dayOf(to); t += 86400000) {
        const day = dayOf(t);
        const plain = path.join(dirOf(this.plc.id), `${day}.jsonl`);
        let text = '';
        try {
          text = fs.existsSync(plain) ? fs.readFileSync(plain, 'utf8') : zlib.gunzipSync(fs.readFileSync(`${plain}.gz`)).toString('utf8');
        } catch {
          continue;
        }
        for (const line of text.split('\n')) {
          if (!line || !line.includes(drivePath.slice(-20))) continue;
          let o;
          try {
            o = JSON.parse(line);
          } catch {
            continue;
          }
          if (o.d !== drivePath || !want.has(o.k) || o.t > to) continue;
          series[o.k].push({ t: o.t, v: o.v });
        }
      }
      for (const k of keys) {
        const all = series[k].sort((a, b) => a.t - b.t);
        // (the value at the window's start, then the window)
        const start = all.findLastIndex ? all.findLastIndex((x) => x.t < from) : -1;
        let list = all.slice(Math.max(0, start)).map((x) => (x.t < from ? { t: from, v: x.v } : x));
        if (list.length > 2000) {
          const bucket = (to - from) / 1000;
          const out = [];
          let cur = null;
          for (const x of list) {
            const b = Math.floor((x.t - from) / bucket);
            if (!cur || cur.b !== b) {
              if (cur) out.push(...(cur.lo.t <= cur.hi.t ? [cur.lo, cur.hi] : [cur.hi, cur.lo]));
              cur = { b, lo: x, hi: x };
            } else {
              if (x.v < cur.lo.v) cur.lo = x;
              if (x.v > cur.hi.v) cur.hi = x;
            }
          }
          if (cur) out.push(...(cur.lo.t <= cur.hi.t ? [cur.lo, cur.hi] : [cur.hi, cur.lo]));
          list = out;
        }
        series[k] = list;
      }
      const baseline = this.drives.find((d) => d.path === drivePath)?.health?.baseline ?? {};
      return { series, baseline };
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
      const m = new DriveMonitor(plc);
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
    /** The board's view of these PLCs (all when none) */
    view: (ids) => [...monitors.values()].filter((m) => !ids?.length || ids.includes(m.plc.id)).map((m) => m.view()),
    /** Each PLC's drives' daily heatsink medians (the risk list) */
    daily: () => Object.fromEntries([...monitors.entries()].map(([id, m]) => [id, m.daily()])),
    /** The drives' parameters, by profile, for the board's labels */
    params: () => Object.fromEntries(settings().profiles.map((p) => [p.id, { name: p.name, params: p.params.map(({ key, label, unit, verified, format, counter, slow, trend }) => ({ key, label, unit, verified, format, counter, slow, trend })) }])),
    history(plcId, drivePath, keys, from, to) {
      const m = monitors.get(plcId);
      if (!m) return { error: 'This gateway does not follow that PLC\'s drives' };
      return m.history(drivePath, keys, from, to);
    },
    pollNow(plcId) {
      const m = monitors.get(plcId);
      if (m) void m.round();
      return !!m;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    stats: () => [...monitors.values()].map((m) => ({ plc: m.plc.id, drives: m.drives.length, everyMs: settings().everyMs })),
  };
}

module.exports = { createDrives };
