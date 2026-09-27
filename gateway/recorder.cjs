// Recordings on the gateway: the state machines under a root of a PLC, recorded all day (every change of their state
// variables, PLC time), one file per recording and day: recordings/<id>/<YYYY-MM-DD>.jsonl next to config.json, lines
// { "t": ms, "m": "<machine path>", "v": value }; chosen variables too (guard values), lines { "t", "x": "<path>",
// "v" }. Past days are compressed (.jsonl.gz); kept for "days" days and within "maxMB". The web app lists them,
// replays one machine over a time window (recordingQuery, with the variables), shows its state-time trends
// (recordingStats) and the machines' availability (recordingAvailability). Once a day the trends are checked: a
// state getting slower than "slowerPct" is reported (an alert, and the rule's webhook). Rules: config.json
// "recordings" (the setup page edits them).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { AlertMonitor, postWebhook, DEFAULT_ERROR } = require('./alerts.cjs');
const { createTrends } = require('./trends.cjs');

const ads = require(fs.existsSync(path.join(__dirname, 'shared', 'tcAds.cjs')) ? './shared/tcAds.cjs' : '../shared/tcAds.cjs');
const MAX_VALUES = 200000;
const FLUSH_MS = 2000;
const DAY_FILE = /^(\d{4}-\d\d-\d\d)\.jsonl(\.gz)?$/;

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
  const vars = (Array.isArray(r?.vars) ? r.vars : String(r?.vars ?? '').split(/[\s,;]+/)).map((v) => String(v).trim()).filter(Boolean);
  if (vars.length > 100 || vars.some((v) => !ads.isSymbolPath(v))) throw new Error(`${where}: variables are symbol paths such as MAIN.fbLine.bDoorClosed (at most 100)`);
  const maxMB = r?.maxMB == null || r.maxMB === '' ? null : Number(r.maxMB);
  if (maxMB !== null && (!Number.isFinite(maxMB) || maxMB < 1)) throw new Error(`${where}: the size limit is at least 1 MB`);
  const slowerPct = r?.slowerPct == null || r.slowerPct === '' ? null : Number(r.slowerPct);
  if (slowerPct !== null && (!Number.isFinite(slowerPct) || slowerPct < 5)) throw new Error(`${where}: "getting slower" is at least 5 %`);
  const slowerWebhook = String(r?.slowerWebhook ?? '').trim() || null;
  if (slowerWebhook && !/^https?:\/\/\S+$/i.test(slowerWebhook)) throw new Error(`${where}: the webhook is an http(s) URL (or empty)`);
  return {
    id, name: String(r?.name ?? '').trim().slice(0, 80) || id, enabled: r?.enabled !== false, plc: r.plc, root, stateVar, days, vars, maxMB,
    compress: r?.compress !== false, slowerPct, slowerWebhook, slowerFormat: ['teams', 'slack', 'json'].includes(r?.slowerFormat) ? r.slowerFormat : 'teams',
  };
}

/** A state's trend over days: the latest 3 days' average against the days before (as the web app's Trends) */
function trendChange(series) {
  const vals = series.filter((v) => v !== null && v !== undefined);
  if (vals.length < 4) return null;
  const avg = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const b = avg(vals.slice(0, -3));
  return b > 0 ? (avg(vals.slice(-3)) - b) / b : null;
}

function createRecorders({ dir, connectionFor, plcOf, log, retryMs, rules = () => [], maintenance = null, onEvent = null, audit = null }) {
  let recorders = new Map(); // id -> { rule, monitor, buffer, timer }
  let key = '';
  const folder = (id) => path.join(dir, id);
  // A day's text, plain (today, or not compressed) or compressed
  const readDay = (id, d) => {
    const plain = path.join(folder(id), `${d}.jsonl`);
    if (fs.existsSync(plain)) return fs.readFileSync(plain, 'utf8');
    return zlib.gunzipSync(fs.readFileSync(`${plain}.gz`)).toString('utf8');
  };
  const trends = createTrends({ dir, read: readDay });
  const slowerSent = new Set(); // `${id}|${machine}|${state}|${day}`

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

  const files = (id) => {
    try {
      return fs.readdirSync(folder(id)).map((f) => ({ f, m: DAY_FILE.exec(f) })).filter((x) => x.m).map((x) => ({ file: x.f, day: x.m[1], gz: !!x.m[2], bytes: fs.statSync(path.join(folder(id), x.f)).size }));
    } catch {
      return [];
    }
  };
  const days = (id) => [...new Set(files(id).map((x) => x.day))].sort();

  /** Past days compressed; days older than the rule keeps, or beyond its size limit (the oldest first), deleted */
  function prune(r) {
    const today = dayOf(Date.now());
    const cutoff = dayOf(Date.now() - r.rule.days * 86400000);
    for (const x of files(r.rule.id)) {
      const full = path.join(folder(r.rule.id), x.file);
      try {
        if (x.day < cutoff) {
          fs.rmSync(full);
          log(`recordings: ${r.rule.id} ${x.day} deleted (kept ${r.rule.days} days)`);
        } else if (!x.gz && x.day < today && r.rule.compress !== false) {
          fs.writeFileSync(`${full}.gz`, zlib.gzipSync(fs.readFileSync(full)));
          fs.rmSync(full);
        }
      } catch (err) {
        log(`recordings: ${r.rule.id} ${x.file}: ${err.message}`);
      }
    }
    if (r.rule.maxMB) {
      const list = files(r.rule.id).sort((a, b) => a.day.localeCompare(b.day));
      let total = list.reduce((s, x) => s + x.bytes, 0);
      for (const x of list) {
        if (total <= r.rule.maxMB * 1048576 || x.day === today) break;
        fs.rmSync(path.join(folder(r.rule.id), x.file));
        total -= x.bytes;
        log(`recordings: ${r.rule.id} ${x.day} deleted (over ${r.rule.maxMB} MB)`);
      }
    }
  }

  /** Once a day: each machine's states over the last 14 days; a state slower by more than slowerPct is reported */
  function checkSlower(r) {
    if (!r.rule.slowerPct) return [];
    const today = dayOf(Date.now());
    const found = [];
    const all = days(r.rule.id).filter((d) => d < today);
    for (const m of r.monitor.machines) {
      const per = trends.of(r.rule.id, m.path, 14, all, today);
      const values = [...new Set(per.flatMap((d) => Object.keys(d.states)))];
      for (const v of values) {
        const series = per.map((d) => d.states[v]?.avgMs ?? null);
        const change = trendChange(series);
        if (change === null || change * 100 < r.rule.slowerPct) continue;
        const key = `${r.rule.id}|${m.path}|${v}|${today}`;
        if (slowerSent.has(key)) continue;
        slowerSent.add(key);
        const state = m.stateNames?.[v] ?? `#${v}`;
        const recent = series.filter((x) => x !== null).slice(-3);
        const avgRecent = recent.reduce((a, x) => a + x, 0) / recent.length;
        const plc = plcOf(r.rule.plc);
        const text = `${plc?.name ?? r.rule.plc}: 🐢 ${m.path} is getting slower in ${state}: +${Math.round(change * 100)}% (the last 3 days: ${(avgRecent / 1000).toFixed(1)} s on average)`;
        const event = { event: 'slower', rule: r.rule.name, ruleId: `rec:${r.rule.id}`, plc: r.rule.plc, plcName: plc?.name ?? r.rule.plc, machine: m.path, type: m.type, state, value: Number(v), change, text, at: new Date().toISOString() };
        found.push(event);
        log(`recordings: ${m.path} slower in ${state} (+${Math.round(change * 100)}%)`);
        onEvent?.(event);
        if (r.rule.slowerWebhook) void postWebhook(r.rule.slowerWebhook, r.rule.slowerFormat, event, log);
      }
    }
    return found;
  }

  /**
   * Availability of each machine between from and to (ms): the time normal, in an error state, stuck (the part of a
   * stay beyond its limit), in maintenance (its PLC's windows), and without data (before its first value)
   */
  function availability(r, from, to) {
    flush(r);
    const end = Math.min(to, Date.now());
    const rule = rules().find((a) => a.enabled !== false && a.plc === r.rule.plc && a.root === r.rule.root);
    const errorRx = new RegExp(rule?.errorPattern || DEFAULT_ERROR, 'i');
    const windows = maintenance?.windowsBetween(r.rule.plc, from, end) ?? [];
    const want = new Map(r.monitor.machines.map((m) => [m.path.toLowerCase(), m]));
    const seq = new Map(); // machine -> [{ t, v }] (with the value before `from`)
    const ds = days(r.rule.id).filter((d) => d <= dayOf(end));
    // (the window's days and the one before it, for the values at its start)
    const first = ds.findIndex((d) => d >= dayOf(from));
    for (const d of ds.slice(Math.max(0, (first < 0 ? ds.length : first) - 1))) {
      let text = '';
      try {
        text = readDay(r.rule.id, d);
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!line) continue;
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        if (o.m === undefined || o.t > end) continue;
        const k = String(o.m).toLowerCase();
        if (!want.has(k)) continue;
        if (!seq.has(k)) seq.set(k, []);
        const list = seq.get(k);
        if (list.length && list[list.length - 1].v === o.v) continue;
        list.push({ t: o.t, v: o.v });
      }
    }
    const overlap = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));
    const out = [];
    for (const [k, m] of want) {
      const list = seq.get(k) ?? [];
      const res = { machine: m.path, type: m.type, normalMs: 0, errorMs: 0, stuckMs: 0, maintenanceMs: 0, noDataMs: 0, totalMs: end - from };
      const startIdx = list.findLastIndex ? list.findLastIndex((p) => p.t <= from) : -1;
      const firstKnown = startIdx >= 0 ? from : list[0]?.t ?? end;
      res.noDataMs = Math.max(0, Math.min(firstKnown, end) - from);
      for (let i = Math.max(0, startIdx); i < list.length; i++) {
        const p = list[i];
        const a = Math.max(p.t, from);
        const b = Math.min(list[i + 1]?.t ?? end, end);
        if (b <= a) continue;
        const name = m.stateNames?.[String(p.v)] ?? `#${p.v}`;
        const limit = rule ? rule.stateLimits?.[name] ?? rule.stuckAfterMs ?? null : null;
        // The segment's parts: in maintenance first, then error / stuck / normal
        let inMaint = 0;
        for (const w of windows) inMaint += overlap(a, b, w.from, w.until);
        inMaint = Math.min(inMaint, b - a);
        const rest = b - a - inMaint;
        res.maintenanceMs += inMaint;
        if (errorRx.test(name)) res.errorMs += rest;
        else if (limit) {
          const stuck = Math.min(rest, overlap(a, b, p.t + limit, Infinity));
          res.stuckMs += stuck;
          res.normalMs += rest - stuck;
        } else res.normalMs += rest;
      }
      out.push(res);
    }
    return out.sort((a, b) => a.machine.localeCompare(b.machine));
  }

  return {
    apply(list0) {
      const list = (Array.isArray(list0) ? list0 : []).filter((r) => r && r.enabled !== false);
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
        const r = { rule, buffer: [], timer: null, monitor: null, slowerDay: null };
        r.monitor = new AlertMonitor(
          { id: `rec:${rule.id}`, name: `recording ${rule.id}`, plc: rule.plc, root: rule.root, stateVar: rule.stateVar, stuckAfterMs: null, stateLimits: {}, onError: false, notifyRecovery: false, webhook: null, extraVars: rule.vars ?? [] },
          { connectionFor, plcOf, log, retryMs, onSample: (m, v, t) => r.buffer.push({ t, m: m.path, v }), onVar: (p, v, t) => r.buffer.push({ t, x: p, v }) }
        );
        r.timer = setInterval(() => flush(r), FLUSH_MS);
        prune(r);
        // Hourly: prune and compress; the slowdown check once a day (after the machines are known)
        r.pruneTimer = setInterval(() => {
          prune(r);
          const today = dayOf(Date.now());
          if (r.slowerDay !== today && r.monitor.machines.length) {
            r.slowerDay = today;
            checkSlower(r);
          }
        }, Number(process.env.KSS_RECORDING_CHECK_MS) || 3600000);
        recorders.set(rule.id, r);
        void r.monitor.start();
      }
    },

    list: () =>
      [...recorders.values()].map((r) => {
        const fl = files(r.rule.id);
        return {
          id: r.rule.id, name: r.rule.name, plc: r.rule.plc, plcName: plcOf(r.rule.plc)?.name ?? r.rule.plc, root: r.rule.root, stateVar: r.rule.stateVar,
          keepDays: r.rule.days, days: days(r.rule.id), state: r.monitor.state, message: r.monitor.message, vars: r.rule.vars ?? [],
          bytes: fl.reduce((s, x) => s + x.bytes, 0), maxMB: r.rule.maxMB ?? null, compressedDays: fl.filter((x) => x.gz).length,
          machines: r.monitor.machines.map((m) => ({ path: m.path, type: m.type, stateNames: m.stateNames })),
        };
      }),

    /** One machine's values between from and to (ms), with its value when the window starts, and the recorded variables */
    query(id, machine, from, to) {
      const r = recorders.get(id);
      if (!r) return { error: `No recording "${id}"` };
      flush(r);
      const want = String(machine).toLowerCase();
      const wanted = days(id).filter((d) => d <= dayOf(to));
      const values = [];
      const vars = [];
      const varBefore = new Map();
      let before = null;
      let truncated = false;
      // (the window's days, and the days before it until the value at its start is known)
      for (let i = wanted.length - 1; i >= 0; i--) {
        const d = wanted[i];
        if (d < dayOf(from) && before) break;
        let text = '';
        try {
          text = readDay(id, d);
        } catch {
          continue;
        }
        const day = [];
        const dayVars = [];
        for (const line of text.split('\n')) {
          if (!line) continue;
          let o;
          try {
            o = JSON.parse(line);
          } catch {
            continue;
          }
          if (o.x !== undefined) {
            // A variable: named as the app's guards name it (a member of the machine: its name; else the full path)
            const x = String(o.x).toLowerCase();
            const vid = x.startsWith(`${want}.`) ? x.slice(want.length + 1) : x;
            if (o.t < from) {
              const b = varBefore.get(vid);
              if (!b || o.t >= b.t) varBefore.set(vid, { id: vid, t: o.t, v: o.v, symbol: o.x });
            } else if (o.t <= to) dayVars.push({ id: vid, t: o.t, v: o.v, symbol: o.x });
            continue;
          }
          if (String(o.m).toLowerCase() !== want) continue;
          if (o.t < from) {
            if (!before || o.t >= before.t) before = { t: o.t, value: o.v };
          } else if (o.t <= to) day.push({ t: o.t, value: o.v });
        }
        values.unshift(...day);
        vars.unshift(...dayVars);
      }
      if (values.length > MAX_VALUES) {
        values.splice(MAX_VALUES);
        truncated = true;
      }
      if (vars.length > MAX_VALUES) vars.splice(MAX_VALUES);
      if (before) values.unshift({ t: from, value: before.value });
      for (const b of varBefore.values()) vars.unshift({ id: b.id, t: from, v: b.v, symbol: b.symbol });
      const watched = {};
      for (const v of vars) watched[v.id] ??= { symbol: v.symbol, type: typeof v.v === 'boolean' ? 'BOOL' : typeof v.v === 'string' ? 'STRING' : 'LREAL' };
      const m = r.monitor.machines.find((x) => x.path.toLowerCase() === want);
      return {
        machine: m?.path ?? machine, machineType: m?.type ?? '', stateVar: r.rule.stateVar, plcName: plcOf(r.rule.plc)?.name ?? r.rule.plc, values, truncated,
        vars: vars.map(({ id: vid, t, v }) => ({ id: vid, t, v })), watched,
      };
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

    /** The machines' availability over each of the windows [{ label, from, to }] */
    availability(id, windowsList) {
      const r = recorders.get(id);
      if (!r) return { error: `No recording "${id}"` };
      return { plcName: plcOf(r.rule.plc)?.name ?? r.rule.plc, windows: windowsList.map((w) => ({ label: w.label, from: w.from, to: w.to, machines: availability(r, w.from, w.to) })) };
    },

    /** The slowdown check now (the setup page's "Check now", and the tests) */
    checkSlowerNow(id) {
      const r = recorders.get(id);
      if (!r) return { error: `No recording "${id}"` };
      flush(r);
      return { found: checkSlower(r) };
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

module.exports = { createRecorders, checkRecording, trendChange };
