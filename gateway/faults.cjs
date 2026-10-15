// The fault recorder: what led to a fault, kept by itself. For each PLC, the gateway keeps the last minute of every
// machine's state under its root and of the signals chosen for it (config.faults.signals, or the I/O page's
// "Add to fault records"); when a machine goes into an error state (ERROR, FAULT, ALARM, E-STOP, ABORT in its name,
// or the PLC's alert rule's pattern), that minute and the next one are kept as a fault record:
// faults/<plc>/<day>/<id>.json beside config.json (config.faults.keepDays, 30 by default). A machine that keeps
// falling into errors is kept once every 5 minutes. The board's alerts open the record of theirs (Fault record), its
// Faults list all of them: a lane per machine, the signals charted, the moment of the fault marked.
// Over the PLC's shared notifications (sharedVars.cjs): the machines the boards, alarms and recordings follow cost
// nothing more. config.json "faults": { "enabled": true, "preSeconds": 60, "postSeconds": 60, "keepDays": 30,
// "root": "MAIN.mainStateMachine", "signals": { "<plc id>": ["MAIN.fbDoor.bClosed", …] } }.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AlertMonitor, DEFAULT_ERROR } = require('./alerts.cjs');

const REPEAT_MS = 5 * 60000;
const MAX_POINTS = 20000;

const dayOf = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function createFaults({ baseDir, getConfig, plcList, connectionFor, log, retryMs }) {
  const settings = () => {
    const c = getConfig().faults ?? {};
    return {
      enabled: c.enabled !== false,
      preMs: Math.max(5, Math.min(600, Number(c.preSeconds) || 60)) * 1000,
      postMs: Math.max(5, Math.min(600, Number(c.postSeconds) || 60)) * 1000,
      keepDays: Math.max(1, Math.min(3650, Number(c.keepDays) || 30)),
      root: typeof c.root === 'string' && c.root ? c.root : null,
      signals: c.signals && typeof c.signals === 'object' ? c.signals : {},
      plcs: Array.isArray(c.plcs) && c.plcs.length ? c.plcs : null,
    };
  };
  const dirOf = (plcId) => path.join(baseDir, 'faults', String(plcId).replace(/[^\w.-]/g, '_'));
  const recorders = new Map(); // plc id -> recorder
  const listeners = new Set();
  const index = new Map(); // fault id -> summary (every PLC)

  // The faults kept (their summaries), read at start
  const loadIndex = () => {
    index.clear();
    let plcDirs = [];
    try {
      plcDirs = fs.readdirSync(path.join(baseDir, 'faults'));
    } catch {
      return;
    }
    for (const p of plcDirs) {
      let days = [];
      try {
        days = fs.readdirSync(path.join(baseDir, 'faults', p));
      } catch {
        continue;
      }
      for (const d of days) {
        let files = [];
        try {
          files = fs.readdirSync(path.join(baseDir, 'faults', p, d)).filter((f) => f.endsWith('.json'));
        } catch {
          continue;
        }
        for (const f of files) {
          try {
            const r = JSON.parse(fs.readFileSync(path.join(baseDir, 'faults', p, d, f), 'utf8'));
            index.set(r.id, summaryOf(r, path.join(baseDir, 'faults', p, d, f)));
          } catch {
            // (a file being written, or not ours)
          }
        }
      }
    }
  };
  const summaryOf = (r, file) => ({ id: r.id, plc: r.plc, plcName: r.plcName, machine: r.machine, type: r.type, state: r.state, at: r.at, from: r.from, to: r.to, machines: Object.keys(r.machines ?? {}).length, signals: Object.keys(r.signals ?? {}).length, complete: r.complete !== false, file });

  const prune = () => {
    const keep = dayOf(Date.now() - settings().keepDays * 86400000);
    for (const [id, s] of index) {
      if (dayOf(s.at) >= keep) continue;
      index.delete(id);
      try {
        fs.rmSync(s.file, { force: true });
      } catch {
        // (removed next time)
      }
    }
  };

  class FaultRecorder {
    constructor(plc) {
      this.plc = plc;
      const s = settings();
      const rule = (getConfig().alerts ?? []).find((r) => r.enabled !== false && r.plc === plc.id);
      this.root = s.root || rule?.root || 'MAIN.mainStateMachine';
      this.errorRx = new RegExp(rule?.errorPattern || DEFAULT_ERROR, 'i');
      this.signals = Array.isArray(s.signals[plc.id]) ? s.signals[plc.id].filter((x) => typeof x === 'string') : [];
      this.buffer = new Map(); // id ("m:<path>" | "x:<path>") -> [{ t, v }]
      this.lastError = new Map(); // machine path (lower case) -> time
      this.open = []; // captures still taking their minute after
      this.monitor = new AlertMonitor(
        { id: `faults:${plc.id}`, name: `fault recorder ${plc.id}`, plc: plc.id, root: this.root, stateVar: rule?.stateVar ?? 'machineState', stuckAfterMs: null, stateLimits: {}, onError: false, notifyRecovery: false, webhook: null, extraVars: this.signals },
        { connectionFor, plcOf: (id) => plcList().find((p) => p.id === id), log, retryMs, onSample: (m, v, t) => this.sample(m, v, t), onVar: (p, v, t) => this.push(`x:${p}`, v, t) }
      );
      void this.monitor.start();
      this.timer = setInterval(() => this.tick(), 1000);
    }

    push(id, v, t) {
      const list = this.buffer.get(id) ?? [];
      list.push({ t, v });
      this.buffer.set(id, list);
      for (const c of this.open) {
        const arr = (c.record[id.startsWith('m:') ? 'machines' : 'signals'][id.slice(2)] ??= []);
        if (arr.length < MAX_POINTS) arr.push({ t, v });
      }
    }

    sample(m, v, t) {
      const name = m.stateNames?.[String(v)] ?? `#${v}`;
      const id = `m:${m.path}`;
      const before = this.buffer.get(id)?.at(-1)?.v;
      this.push(id, v, t);
      // (its first value: in an error state already when the gateway began, not a fault it saw happen)
      if (before === undefined) return;
      const wasError = before !== undefined && this.errorRx.test(m.stateNames?.[String(before)] ?? `#${before}`);
      if (!this.errorRx.test(name) || wasError) return;
      const key = m.path.toLowerCase();
      if (Date.now() - (this.lastError.get(key) ?? 0) < REPEAT_MS) return;
      this.lastError.set(key, Date.now());
      this.capture(m, name, t);
    }

    /** A fault: the buffer's last minute copied, the next minute added as it comes, then kept */
    capture(m, state, at) {
      const s = settings();
      const from = at - s.preMs;
      const record = {
        id: `${dayOf(at).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex')}`, plc: this.plc.id, plcName: this.plc.name, machine: m.path, type: m.type, state, at, from, to: at + s.postMs,
        root: this.root, stateNames: {}, machines: {}, signals: {}, complete: false,
      };
      for (const x of this.monitor.machines) record.stateNames[x.path] = x.stateNames ?? {};
      for (const [id, list] of this.buffer) {
        // (the value at the window's start, then the window)
        const start = list.findLastIndex((p) => p.t <= from);
        const part = list.slice(Math.max(0, start)).map((p) => (p.t < from ? { t: from, v: p.v } : p));
        record[id.startsWith('m:') ? 'machines' : 'signals'][id.slice(2)] = part;
      }
      this.open.push({ record, until: at + s.postMs });
      log(`faults: ${this.plc.id}: ${m.path} went into ${state}: its minute before kept, the next one coming`);
      this.save(record);
      for (const fn of listeners) fn(summaryOf(record, this.fileOf(record)), 'new');
    }

    fileOf(r) {
      return path.join(dirOf(this.plc.id), dayOf(r.at), `${r.id}.json`);
    }

    save(r) {
      try {
        fs.mkdirSync(path.dirname(this.fileOf(r)), { recursive: true });
        fs.writeFileSync(this.fileOf(r), JSON.stringify(r));
        index.set(r.id, summaryOf(r, this.fileOf(r)));
      } catch (err) {
        log(`faults: ${this.plc.id}: ${err.message}`);
      }
    }

    /** Each second: the buffer trimmed to the last minute; captures whose minute after is over, kept complete */
    tick() {
      const now = Date.now();
      const cut = now - settings().preMs;
      for (const [id, list] of this.buffer) {
        // (the last value before the window stays: the value at its start)
        let drop = 0;
        while (drop < list.length - 1 && list[drop + 1].t <= cut) drop++;
        if (drop) list.splice(0, drop);
        if (!list.length) this.buffer.delete(id);
      }
      for (const c of [...this.open]) {
        if (now < c.until) continue;
        c.record.complete = true;
        this.save(c.record);
        this.open = this.open.filter((x) => x !== c);
        for (const fn of listeners) fn(summaryOf(c.record, this.fileOf(c.record)), 'complete');
      }
    }

    stop() {
      clearInterval(this.timer);
      for (const c of this.open) this.save(c.record);
      this.monitor.stop();
    }
  }

  let key = '';
  const apply = () => {
    const s = settings();
    const k = JSON.stringify({ s, plcs: plcList(), alerts: (getConfig().alerts ?? []).map((r) => [r.plc, r.root, r.errorPattern, r.enabled]) });
    if (k === key) return;
    key = k;
    for (const r of recorders.values()) r.stop();
    recorders.clear();
    if (!s.enabled) return;
    for (const plc of plcList()) if (!s.plcs || s.plcs.includes(plc.id)) recorders.set(plc.id, new FaultRecorder(plc));
  };
  const pruneTimer = setInterval(prune, 3600_000);
  pruneTimer.unref();

  return {
    start() {
      loadIndex();
      prune();
      apply();
    },
    apply,
    stop() {
      clearInterval(pruneTimer);
      for (const r of recorders.values()) r.stop();
      recorders.clear();
    },
    /** The faults kept, newest first (a PLC's, a machine's, since a time) */
    list({ plc, machine, since, limit = 200 } = {}) {
      return [...index.values()]
        .filter((s) => (!plc || s.plc === plc) && (!machine || s.machine.toLowerCase() === String(machine).toLowerCase()) && (!since || s.at >= since))
        .sort((a, b) => b.at - a.at)
        .slice(0, limit)
        .map(({ file, ...s }) => s);
    },
    /** One fault record in full (the one still taking its minute after: as it is so far) */
    get(id) {
      for (const r of recorders.values()) {
        const open = r.open.find((c) => c.record.id === id);
        if (open) return open.record;
      }
      const s = index.get(id);
      if (!s) return null;
      try {
        return JSON.parse(fs.readFileSync(s.file, 'utf8'));
      } catch {
        return null;
      }
    },
    /** The PLCs whose faults are recorded (the Load panel) */
    stats: () => [...recorders.keys()],
    /** A PLC's signals kept with its faults (the I/O page's "Add to fault records") */
    signalsOf: (plcId) => (Array.isArray(settings().signals[plcId]) ? settings().signals[plcId] : []),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

module.exports = { createFaults };
