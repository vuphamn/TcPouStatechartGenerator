// Recordings on the gateway: the state machines under a root of a PLC, recorded all day (every change of their state
// variables, PLC time), one file per recording and day: recordings/<id>/<YYYY-MM-DD>.jsonl next to config.json, lines
// { "t": ms, "m": "<machine path>", "v": value }. Kept for "days" days. The web app lists them and replays one
// machine over a time window (recordingQuery). Rules: config.json "recordings" (the setup page edits them).
const fs = require('fs');
const path = require('path');
const { AlertMonitor } = require('./alerts.cjs');
const { createTrends } = require('./trends.cjs');

const ads = require(fs.existsSync(path.join(__dirname, 'shared', 'tcAds.cjs')) ? './shared/tcAds.cjs' : '../shared/tcAds.cjs');
const MAX_VALUES = 200000;
const FLUSH_MS = 2000;

const dayOf = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** A recording rule from config.json, checked; throws with a message for the setup page */
function checkRecording(r, i, plcIds) {
  const where = `Recording ${i + 1}`;
  const id = String(r?.id ?? '').trim() || `rec${i + 1}`;
  if (!/^[\w-]{1,40}$/.test(id)) throw new Error(`${where}: the id is letters, digits, - or _`);
  if (!plcIds.includes(r?.plc)) throw new Error(`${where}: choose one of the gateway's PLCs`);
  const root = String(r?.root ?? 'MAIN.mainStateMachine').trim();
  if (!ads.isSymbolPath(root)) throw new Error(`${where}: the root is a symbol path such as MAIN.mainStateMachine`);
  const stateVar = String(r?.stateVar ?? 'machineState').trim();
  if (!/^[A-Za-z_]\w*$/.test(stateVar)) throw new Error(`${where}: the state variable is a name such as machineState`);
  const days = Number(r?.days ?? 7);
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error(`${where}: keep 1 to 366 days`);
  return { id, name: String(r?.name ?? '').trim().slice(0, 80) || id, enabled: r?.enabled !== false, plc: r.plc, root, stateVar, days };
}

function createRecorders({ dir, connectionFor, plcOf, log, retryMs }) {
  let recorders = new Map(); // id -> { rule, monitor, buffer, timer }
  let key = '';
  const folder = (id) => path.join(dir, id);
  const trends = createTrends({ dir });

  function flush(r) {
    if (!r.buffer.length) return;
    const lines = r.buffer.splice(0);
    const byDay = new Map();
    for (const l of lines) {
      const d = dayOf(l.t);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(JSON.stringify(l));
    }
    try {
      fs.mkdirSync(folder(r.rule.id), { recursive: true });
      for (const [d, ls] of byDay) fs.appendFileSync(path.join(folder(r.rule.id), `${d}.jsonl`), ls.join('\n') + '\n');
    } catch (err) {
      log(`recordings: could not write ${r.rule.id}: ${err.message}`);
    }
  }

  /** Days older than the rule keeps: deleted */
  function prune(r) {
    const cutoff = dayOf(Date.now() - r.rule.days * 86400000);
    try {
      for (const f of fs.readdirSync(folder(r.rule.id))) {
        if (/^\d{4}-\d\d-\d\d\.jsonl$/.test(f) && f.slice(0, 10) < cutoff) {
          fs.rmSync(path.join(folder(r.rule.id), f));
          log(`recordings: ${r.rule.id} ${f.slice(0, 10)} deleted (kept ${r.rule.days} days)`);
        }
      }
    } catch {
      // no folder yet
    }
  }

  const days = (id) => {
    try {
      return fs.readdirSync(folder(id)).filter((f) => /^\d{4}-\d\d-\d\d\.jsonl$/.test(f)).map((f) => f.slice(0, 10)).sort();
    } catch {
      return [];
    }
  };

  return {
    apply(rules) {
      const list = (Array.isArray(rules) ? rules : []).filter((r) => r && r.enabled !== false);
      const k = JSON.stringify(list);
      if (k === key) return;
      key = k;
      for (const r of recorders.values()) {
        clearInterval(r.timer);
        clearInterval(r.pruneTimer);
        flush(r);
        r.monitor.stop();
      }
      recorders = new Map();
      for (const rule of list) {
        const r = { rule, buffer: [], timer: null, monitor: null };
        r.monitor = new AlertMonitor(
          { id: `rec:${rule.id}`, name: `recording ${rule.id}`, plc: rule.plc, root: rule.root, stateVar: rule.stateVar, stuckAfterMs: null, stateLimits: {}, onError: false, notifyRecovery: false, webhook: null },
          { connectionFor, plcOf, log, retryMs, onSample: (m, v, t) => r.buffer.push({ t, m: m.path, v }) }
        );
        r.timer = setInterval(() => flush(r), FLUSH_MS);
        prune(r);
        r.pruneTimer = setInterval(() => prune(r), 3600000);
        recorders.set(rule.id, r);
        void r.monitor.start();
      }
    },

    list: () =>
      [...recorders.values()].map((r) => ({
        id: r.rule.id, name: r.rule.name, plc: r.rule.plc, plcName: plcOf(r.rule.plc)?.name ?? r.rule.plc, root: r.rule.root, stateVar: r.rule.stateVar,
        keepDays: r.rule.days, days: days(r.rule.id), state: r.monitor.state, message: r.monitor.message,
        machines: r.monitor.machines.map((m) => ({ path: m.path, type: m.type, stateNames: m.stateNames })),
      })),

    /** One machine's values between from and to (ms), with its value when the window starts */
    query(id, machine, from, to) {
      const r = recorders.get(id);
      if (!r) return { error: `No recording "${id}"` };
      flush(r);
      const want = String(machine).toLowerCase();
      const wanted = days(id).filter((d) => d <= dayOf(to));
      const values = [];
      let before = null;
      let truncated = false;
      // (the window's days, and the days before it until the value at its start is known)
      for (let i = wanted.length - 1; i >= 0; i--) {
        const d = wanted[i];
        if (d < dayOf(from) && before) break;
        let text = '';
        try {
          text = fs.readFileSync(path.join(folder(id), `${d}.jsonl`), 'utf8');
        } catch {
          continue;
        }
        const day = [];
        for (const line of text.split('\n')) {
          if (!line) continue;
          let o;
          try {
            o = JSON.parse(line);
          } catch {
            continue;
          }
          if (String(o.m).toLowerCase() !== want) continue;
          if (o.t < from) {
            if (!before || o.t >= before.t) before = { t: o.t, value: o.v };
          } else if (o.t <= to) day.push({ t: o.t, value: o.v });
        }
        values.unshift(...day);
      }
      if (values.length > MAX_VALUES) {
        values.splice(MAX_VALUES);
        truncated = true;
      }
      if (before) values.unshift({ t: from, value: before.value });
      const m = r.monitor.machines.find((x) => x.path.toLowerCase() === want);
      return { machine: m?.path ?? machine, machineType: m?.type ?? '', stateVar: r.rule.stateVar, plcName: plcOf(r.rule.plc)?.name ?? r.rule.plc, values, truncated };
    },

    /** One machine's state times per day (the latest `n` days recorded), with its state names */
    stats(id, machine, n) {
      const r = recorders.get(id);
      if (!r) return { error: `No recording "${id}"` };
      flush(r);
      const m = r.monitor.machines.find((x) => x.path.toLowerCase() === String(machine).toLowerCase());
      const perDay = trends.of(id, machine, n, days(id), dayOf(Date.now()));
      return { machine: m?.path ?? machine, machineType: m?.type ?? '', stateNames: m?.stateNames ?? {}, days: perDay };
    },

    stop() {
      for (const r of recorders.values()) {
        clearInterval(r.timer);
        clearInterval(r.pruneTimer);
        flush(r);
        r.monitor.stop();
      }
      recorders = new Map();
      key = '';
    },
  };
}

module.exports = { createRecorders, checkRecording };
