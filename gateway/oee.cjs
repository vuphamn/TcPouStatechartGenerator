// OEE and downtime, for production and office managers, from the gateway's recordings (recorder.cjs):
// - availability: the time each recorded machine ran normally, out of its time not in maintenance and with data (an
//   error state, or the part of a stay beyond its limit, is down);
// - performance (when its cycle is set: config.oee.machines): its cycles (each entry into its cycle state) times its
//   ideal cycle time, out of the time it ran; quality: from its good and bad counts when set (else not counted);
//   OEE: their product (what is known of them);
// - its stops: each stay in an error state, each stuck stay beyond its limit, with the reason an operator gave on
//   the board (downtime.jsonl beside config.json), and Pareto charts of the downtime by reason, machine and state;
// - by shift (config.shifts) or by day, to compare; a weekly summary to a webhook (config.oee.weekly).
// config.json "oee": { "reasons": ["Waiting for material", "Jam", …], "reasonAfterMin": 2,
//   "machines": [{ "plc": "line202", "machine": "MAIN.mainStateMachine.smTable1" (or "type": "SM_TableManager"),
//                  "cycleState": "TABLEMANAGER_DONE", "idealCycleSec": 42,
//                  "goodVar": "MAIN.nGoodParts", "badVar": "MAIN.nBadParts" }],     part counters (each optional), for quality;
//                                                       recorded with that PLC's recordings by themselves (withCounters)
//   "weekly": { "day": "Mon", "at": "07:00", "webhook": "https://…", "format": "teams", "link": "https://gateway:8443/?board&page=oee" },
//   "products": { "line202": { "var": "GVL.sRecipe", "idealCycleSec": { "Door 36": 40, "Door 42": 48 } } } }
//   the product (or recipe) a PLC makes: its variable (a STRING, or a number), recorded with its recordings; each window
//   split into the runs of each product: OEE per product, its cycles against its own ideal cycle time (else the
//   machine's).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DEFAULT_ERROR } = require('./alerts.cjs');
const { meterOf, kwhOf } = require('./energy.cjs');

const REASONS = ['Waiting for material', 'Jam', 'Tool change', 'Changeover', 'Electrical fault', 'Mechanical fault', 'Maintenance', 'Operator break', 'Quality check', 'Other'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** A counter's rises over its recorded values (a drop: reset, counted from zero); null: nothing recorded */
function risesOf(list) {
  if (!list?.length) return null;
  let n = 0;
  for (let i = 1; i < list.length; i++) {
    const a = Number(list[i - 1].v);
    const b = Number(list[i].v);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    n += b >= a ? b - a : b;
  }
  return n;
}
/** Quality: good of good and bad; with one counter only, of the cycles counted */
function qualityOf(good, bad, cycles) {
  if (good !== null && bad !== null) return good + bad > 0 ? good / (good + bad) : null;
  if (bad !== null && cycles) return Math.max(0, cycles - bad) / cycles;
  if (good !== null && cycles) return Math.min(1, good / cycles);
  return null;
}
/** The recordings as the recorder takes them: each one with its PLC's OEE part counters among its variables */
function withCounters(recordings, oee, energy) {
  const machines = Array.isArray(oee?.machines) ? oee.machines : [];
  return (recordings ?? []).map((r) => {
    const add = [...machines.filter((m) => m.plc === r.plc).flatMap((m) => [m.goodVar, m.badVar]), oee?.products?.[r.plc]?.var, ...(Array.isArray(energy?.meters) ? energy.meters.filter((m) => m?.plc === r.plc).map((m) => m.var) : [])].filter(Boolean).map(String);
    if (!add.length) return r;
    const vars = [...(r.vars ?? [])];
    for (const v of add) if (!vars.some((x) => x.toLowerCase() === v.toLowerCase())) vars.push(v);
    return { ...r, vars: vars.slice(0, 100) };
  });
}

function createOee({ baseDir, getConfig, recorders, rules, shiftWindowsOf, log, audit, postWebhook }) {
  const file = path.join(baseDir, 'downtime.jsonl');
  let entries = [];
  try {
    entries = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    entries = [];
  }
  const settings = () => {
    const c = getConfig().oee ?? {};
    return {
      reasons: Array.isArray(c.reasons) && c.reasons.length ? c.reasons.map(String).slice(0, 40) : REASONS,
      reasonAfterMin: Math.max(0, Math.min(240, Number(c.reasonAfterMin ?? 2))),
      machines: Array.isArray(c.machines) ? c.machines : [],
      weekly: c.weekly && /^https?:\/\//i.test(String(c.weekly.webhook ?? '')) ? c.weekly : null,
      products: c.products && typeof c.products === 'object' ? c.products : {},
    };
  };

  /** A reason given for a stop (the same stop again: the latest one) */
  function setReason({ plc, machine, from, reason, note }, user) {
    const s = settings();
    if (!s.reasons.includes(reason)) throw new Error(`One of: ${s.reasons.join(', ')}`);
    const e = { id: crypto.randomBytes(5).toString('hex'), plc: String(plc), machine: String(machine), from: Number(from), reason, note: String(note ?? '').trim().slice(0, 200), by: user, at: Date.now() };
    entries = [...entries.filter((x) => !(x.plc === e.plc && x.machine.toLowerCase() === e.machine.toLowerCase() && Math.abs(x.from - e.from) < 1000)), e];
    if (entries.length > 50000) entries = entries.slice(-50000);
    try {
      fs.appendFileSync(file, JSON.stringify(e) + '\n');
    } catch (err) {
      log(`oee: ${err.message}`);
    }
    audit?.add(user, 'downtime.reason', { plc: e.plc, machine: e.machine, from: new Date(e.from).toISOString(), reason, note: e.note });
    log(`oee: ${user}: ${machine} stopped at ${new Date(e.from).toISOString()}: ${reason}${e.note ? ` (${e.note})` : ''}`);
    return e;
  }
  const reasonOf = (plc, machine, from, to) => {
    const m = String(machine).toLowerCase();
    return [...entries].reverse().find((x) => x.plc === plc && x.machine.toLowerCase() === m && x.from >= from - 60000 && x.from <= (to ?? from) + 60000) ?? null;
  };

  const cycleOf = (plc, m) => settings().machines.find((x) => x.plc === plc && (x.machine ? String(x.machine).toLowerCase() === m.path.toLowerCase() : x.type && String(m.type).split('.').pop().toLowerCase() === String(x.type).toLowerCase()));

  /** One machine of a recording over [from, to]: its time by kind, its stops, its cycles */
  function machineWindow(rec, m, from, to, idealOverride = null) {
    const end = Math.min(to, Date.now());
    const rule = rules().find((r) => r.enabled !== false && r.plc === rec.plc && r.root === rec.root);
    const errorRx = new RegExp(rule?.errorPattern || DEFAULT_ERROR, 'i');
    const q = recorders.query(rec.id, m.path, from, end);
    const values = (q.values ?? []).filter((x, i, all) => i === 0 || x.value !== all[i - 1].value);
    const av = recorders.availability(rec.id, [{ label: 'w', from, to: end }]).windows?.[0]?.machines?.find((x) => x.machine.toLowerCase() === m.path.toLowerCase());
    const name = (v) => m.stateNames?.[String(v)] ?? `#${v}`;
    const stops = [];
    const cyc = cycleOf(rec.plc, m);
    let cycles = 0;
    for (let i = 0; i < values.length; i++) {
      const a = values[i];
      const b = Math.min(values[i + 1]?.t ?? end, end);
      const n = name(a.value);
      if (cyc && n === cyc.cycleState && a.t > from && i > 0) cycles++;
      const limit = rule ? rule.stateLimits?.[n] ?? rule.stuckAfterMs ?? null : null;
      let downFrom = null;
      let kind = null;
      if (errorRx.test(n)) {
        downFrom = a.t;
        kind = 'error';
      } else if (limit && b - a.t > limit) {
        downFrom = a.t + limit;
        kind = 'stuck';
      }
      if (downFrom === null || b <= Math.max(downFrom, from)) continue;
      const r = reasonOf(rec.plc, m.path, a.t, b);
      stops.push({ plc: rec.plc, plcName: rec.plcName, machine: m.path, type: m.type, state: n, kind, from: Math.max(downFrom, from), to: b, ms: b - Math.max(downFrom, from), since: a.t, reason: r?.reason ?? null, note: r?.note ?? '', by: r?.by ?? null });
    }
    const runMs = av ? av.normalMs : 0;
    const plannedMs = av ? av.totalMs - av.maintenanceMs - av.noDataMs : 0;
    const availability = av && plannedMs > 0 ? av.normalMs / plannedMs : null;
    // (its product's own ideal cycle time, when it has one)
    const ideal = cyc ? idealOverride ?? cyc.idealCycleSec : null;
    const performance = cyc && ideal > 0 && runMs > 0 ? Math.min(1, (cycles * ideal * 1000) / runMs) : null;
    // (quality: the parts counted in the window by its counters)
    let good = null;
    let bad = null;
    if (cyc && (cyc.goodVar || cyc.badVar)) {
      const series = recorders.queryVars(rec.id, [cyc.goodVar, cyc.badVar].filter(Boolean), from, end).series ?? {};
      if (cyc.goodVar) good = risesOf(series[cyc.goodVar]);
      if (cyc.badVar) bad = risesOf(series[cyc.badVar]);
    }
    const quality = qualityOf(good, bad, cyc ? cycles : null);
    const partsCounted = good !== null && bad !== null ? good + bad : cyc ? cycles : 0;
    const parts = [availability, performance, quality].filter((x) => x !== null);
    return { plc: rec.plc, plcName: rec.plcName, machine: m.path, type: m.type, availability, performance, quality, good, bad, partsCounted, oee: parts.length ? parts.reduce((a, x) => a * x, 1) : null, cycles: cyc ? cycles : null, idealCycleSec: ideal ?? null, runMs, plannedMs, downMs: av ? av.errorMs + av.stuckMs : 0, maintenanceMs: av?.maintenanceMs ?? 0, noDataMs: av?.noDataMs ?? 0, stops };
  }

  /** The window's machines (every recording of these PLCs), their stops, the Pareto, and per shift or day */
  function report({ from, to, plcIds = [], by = 'total' }) {
    const recs = recorders.list().filter((r) => !plcIds.length || plcIds.includes(r.plc));
    const machinesOf = (f, t) => {
      const out = new Map();
      for (const rec of recs) {
        for (const m of rec.machines) {
          const k = `${rec.plc}|${m.path.toLowerCase()}`;
          if (out.has(k)) continue;
          out.set(k, machineWindow(rec, m, f, t));
        }
      }
      return [...out.values()];
    };
    const machines = machinesOf(from, to);
    const stops = machines.flatMap((m) => m.stops).sort((a, b) => b.from - a.from);
    const pareto = (keyOf) => {
      const g = new Map();
      for (const s of stops) {
        const k = keyOf(s);
        const x = g.get(k) ?? { key: k, ms: 0, count: 0 };
        x.ms += s.ms;
        x.count++;
        g.set(k, x);
      }
      return [...g.values()].sort((a, b) => b.ms - a.ms);
    };
    const line = (list) => {
      const planned = list.reduce((a, m) => a + m.plannedMs, 0);
      const run = list.reduce((a, m) => a + m.runMs, 0);
      const withP = list.filter((m) => m.performance !== null);
      const perf = withP.length ? withP.reduce((a, m) => a + m.performance * m.runMs, 0) / Math.max(1, withP.reduce((a, m) => a + m.runMs, 0)) : null;
      const availability = planned > 0 ? run / planned : null;
      const withQ = list.filter((m) => m.quality !== null && m.partsCounted > 0);
      const counted = withQ.reduce((a, m) => a + m.partsCounted, 0);
      const quality = counted > 0 ? withQ.reduce((a, m) => a + m.quality * m.partsCounted, 0) / counted : null;
      const sum = (k) => (list.some((m) => m[k] !== null && m[k] !== undefined) ? list.reduce((a, m) => a + (m[k] ?? 0), 0) : null);
      return { availability, performance: perf, quality, good: sum('good'), bad: sum('bad'), oee: availability === null ? null : availability * (perf ?? 1) * (quality ?? 1), downMs: list.reduce((a, m) => a + m.downMs, 0), stops: list.reduce((a, m) => a + m.stops.length, 0) };
    };
    let windows = [];
    if (by === 'shift' || by === 'day') {
      const day = (t) => new Date(new Date(t).toDateString()).getTime();
      if (by === 'day') for (let d = day(from); d < to; d += 86400000) windows.push({ label: new Date(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }), from: Math.max(d, from), to: Math.min(d + 86400000, to) });
      else for (const w of shiftWindowsOf(from, to)) windows.push({ label: `${new Date(w.from).toLocaleDateString([], { weekday: 'short', day: 'numeric' })} ${w.name}`, from: Math.max(w.from, from), to: Math.min(w.to, to) });
      windows = windows.slice(-62).map((w) => ({ ...w, ...line(machinesOf(w.from, w.to)) }));
    }
    // By product: each PLC's product variable split into its runs; each run's machines with that product's ideal cycle
    // (energy: each meter of these PLCs, recorded with one of its recordings; its kWh over [f, t])
    const meters = (Array.isArray(getConfig().energy?.meters) ? getConfig().energy.meters : []).map(meterOf).filter((m) => m && (!plcIds.length || plcIds.includes(m.plc)));
    const meterSrc = (m) => recs.find((r) => r.plc === m.plc && (r.vars ?? []).some((v) => String(v).toLowerCase() === m.var.toLowerCase()));
    const kwhIn = (m, f, t) => {
      const src = meterSrc(m);
      return src ? kwhOf(m, recorders.queryVars(src.id, [m.var], f, Math.min(t, Date.now())).series?.[m.var] ?? [], f, Math.min(t, Date.now())) : null;
    };
    const partsOf = (m, list) => list.filter((x) => x.plc === m.plc && (!m.machines.length || m.machines.some((p) => p.toLowerCase() === x.machine.toLowerCase()))).reduce((a, x) => a + (x.partsCounted ?? 0), 0);
    const price = Number(getConfig().energy?.price) > 0 ? Number(getConfig().energy.price) : null;
    const energy = meters.map((m) => {
      const kwh = kwhIn(m, from, to);
      const parts = partsOf(m, machines);
      return { plc: m.plc, plcName: recs.find((r) => r.plc === m.plc)?.plcName ?? m.plc, name: m.name, var: m.var, recorded: !!meterSrc(m), kwh, parts, kwhPerPart: kwh !== null && parts > 0 ? kwh / parts : null, cost: kwh !== null && price ? kwh * price : null };
    });
    const products = [];
    const byProduct = new Map();
    for (const [plcId, p] of Object.entries(settings().products)) {
      if (!p?.var || (plcIds.length && !plcIds.includes(plcId))) continue;
      const plcRecs = recs.filter((r) => r.plc === plcId);
      const src = plcRecs.find((r) => (r.vars ?? []).some((v) => String(v).toLowerCase() === String(p.var).toLowerCase()));
      if (!src) continue;
      const end = Math.min(to, Date.now());
      const series = recorders.queryVars(src.id, [p.var], from, end).series?.[p.var] ?? [];
      const runs = [];
      for (let i = 0; i < series.length; i++) {
        const name = series[i].v === null || series[i].v === undefined || series[i].v === '' ? '(none)' : String(series[i].v);
        const a = Math.max(series[i].t, from);
        const b = Math.min(series[i + 1]?.t ?? end, end);
        if (b <= a) continue;
        const last = runs[runs.length - 1];
        if (last && last.product === name && last.to === a) last.to = b;
        else runs.push({ product: name, from: a, to: b });
      }
      for (const run of runs.slice(-200)) {
        const ideal = Number(p.idealCycleSec?.[run.product]) || null;
        const list = [];
        const seen = new Set();
        for (const rec of plcRecs) {
          for (const m of rec.machines) {
            if (seen.has(m.path.toLowerCase())) continue;
            seen.add(m.path.toLowerCase());
            list.push(machineWindow(rec, m, run.from, run.to, ideal));
          }
        }
        // (the energy of its PLC's meters in this run)
        const runKwh = meters.filter((m) => m.plc === plcId).map((m) => kwhIn(m, run.from, run.to)).filter((x) => x !== null);
        const k = `${plcId}|${run.product}`;
        const x = byProduct.get(k) ?? { plc: plcId, plcName: src.plcName, product: run.product, idealCycleSec: ideal, runs: 0, ms: 0, machines: [], kwh: null };
        x.runs++;
        x.ms += run.to - run.from;
        x.machines.push(...list);
        if (runKwh.length) x.kwh = (x.kwh ?? 0) + runKwh.reduce((a, v) => a + v, 0);
        byProduct.set(k, x);
      }
    }
    for (const x of byProduct.values()) {
      const parts = x.machines.reduce((a, m) => a + (m.partsCounted ?? 0), 0);
      products.push({ plc: x.plc, plcName: x.plcName, product: x.product, idealCycleSec: x.idealCycleSec, runs: x.runs, ms: x.ms, cycles: x.machines.some((m) => m.cycles !== null) ? x.machines.reduce((a, m) => a + (m.cycles ?? 0), 0) : null, ...line(x.machines), kwh: x.kwh, parts, kwhPerPart: x.kwh !== null && parts > 0 ? x.kwh / parts : null });
    }
    products.sort((a, b) => b.ms - a.ms);
    const kwhAll = energy.some((e) => e.kwh !== null) ? energy.reduce((a, e) => a + (e.kwh ?? 0), 0) : null;
    return { from, to, by, line: line(machines), products, energy, energyTotal: { kwh: kwhAll, cost: kwhAll !== null && price ? kwhAll * price : null, price, currency: String(getConfig().energy?.currency ?? '').slice(0, 8) }, machines: machines.map(({ stops: s, ...m }) => ({ ...m, stops: s.length })), stops: stops.slice(0, 500), pareto: { reason: pareto((s) => s.reason ?? '(no reason given)'), machine: pareto((s) => s.machine), state: pareto((s) => s.state) }, windows, reasons: settings().reasons, recorded: recs.length };
  }

  // The weekly summary (once, at its day and time)
  let lastWeekly = '';
  const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)} %`);
  const hours = (ms) => `${(ms / 3600000).toFixed(1)} h`;
  const weeklyTimer = setInterval(() => {
    const w = settings().weekly;
    if (!w) return;
    const now = new Date();
    const [hh, mm] = String(w.at ?? '07:00').split(':').map(Number);
    const day = DAYS.indexOf(String(w.day ?? 'mon').slice(0, 3).toLowerCase());
    const key = now.toDateString();
    if (now.getDay() !== (day < 0 ? 1 : day) || now.getHours() !== hh || now.getMinutes() !== mm || lastWeekly === key) return;
    lastWeekly = key;
    const r = report({ from: now.getTime() - 7 * 86400000, to: now.getTime() });
    const top = r.pareto.reason.slice(0, 3).map((x) => `${x.key} ${hours(x.ms)}`).join(', ');
    const text = `📊 The last 7 days: OEE ${pct(r.line.oee)} (availability ${pct(r.line.availability)}${r.line.performance !== null ? `, performance ${pct(r.line.performance)}` : ''}${r.line.quality !== null ? `, quality ${pct(r.line.quality)}${r.line.bad !== null ? ` (${r.line.bad} bad)` : ''}` : ''}), ${r.line.stops} stops, ${hours(r.line.downMs)} down${top ? `; most: ${top}` : ''}${w.link ? ` · ${w.link}` : ''}`;
    log(`oee: the weekly summary: ${text}`);
    void postWebhook(w.webhook, ['teams', 'slack', 'json'].includes(w.format) ? w.format : 'teams', { event: 'oee.weekly', text, at: now.toISOString(), line: r.line, pareto: r.pareto.reason.slice(0, 10) }, log);
  }, 30000);
  weeklyTimer.unref();

  return {
    setReason,
    settings,
    /** The reasons given lately (the board: which stops have one) */
    recent: (sinceMs = 24 * 3600_000) => entries.filter((e) => e.at > Date.now() - sinceMs),
    report,
    stop: () => clearInterval(weeklyTimer),
  };
}

module.exports = { createOee, REASONS, risesOf, qualityOf, withCounters };
