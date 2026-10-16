// Anomalies, live, from the recordings: each machine's stay in a state, as it ends, against that state's stays of the
// last 14 days (their median and its spread: the median absolute deviation); far longer (6 spreads above, twice the
// median and 5 s more at least) or far shorter (6 spreads below, a third of the median: a step skipped?) is one; so is
// a transition never seen in those days. Each one an alert of its own kind ("anomaly"), quiet: kept in the alert
// history, never open, no chime; told to the roles and devices that want it. One a machine and kind an hour at most.
// config.json "anomalies": { "enabled": true, "days": 14, "minStays": 20, "spreads": 6 }.
const DAY = 86400000;
const HOUR = 3600000;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const dur = (ms) => (ms < 60000 ? `${Math.round(ms / 100) / 10} s` : ms < 3600000 ? `${Math.round(ms / 6000) / 10} min` : `${Math.round(ms / 360000) / 10} h`);

/** A machine's stays and transitions from its recorded values ([{ t, value }]), the first stay left out (its start not known) */
function staysOf(values, nameOf) {
  const changes = values.filter((x, i, all) => i === 0 || x.value !== all[i - 1].value);
  const stays = new Map();
  const transitions = new Set();
  for (let i = 1; i < changes.length; i++) {
    const a = nameOf(changes[i - 1].value);
    const b = nameOf(changes[i].value);
    transitions.add(`${a}>${b}`);
    // (the first stay: its start before the window, not known)
    if (i === 1) continue;
    if (!stays.has(a)) stays.set(a, []);
    stays.get(a).push(changes[i].t - changes[i - 1].t);
  }
  return { stays, transitions, count: changes.length };
}

/** A stay judged against its state's: { kind: 'long' | 'short', median } or null */
function judgeStay(ms, list, { minStays = 20, spreads = 6 } = {}) {
  if (!list || list.length < minStays) return null;
  const m = median(list);
  const mad = median(list.map((x) => Math.abs(x - m))) * 1.4826;
  if (ms > m + spreads * mad && ms > 2 * m && ms - m > 5000) return { kind: 'long', median: m };
  if (ms < m - spreads * mad && ms < m / 3 && m > 5000) return { kind: 'short', median: m };
  return null;
}

function createAnomalies({ recorders, getConfig, log, onEvent }) {
  const settings = () => {
    const c = getConfig().anomalies ?? {};
    return { enabled: c.enabled !== false, days: Math.max(1, Math.min(90, Number(c.days) || 14)), minStays: Math.max(3, Number(c.minStays) || 20), spreads: Math.max(2, Number(c.spreads) || 6) };
  };
  const cache = new Map(); // recording|machine -> { at, stays, transitions }
  const live = new Map(); // recording|machine -> { state, since, first }
  const sent = new Map(); // recording|machine|kind -> time
  const statsOf = (rec, m) => {
    const key = `${rec.id}|${m.path.toLowerCase()}`;
    const c = cache.get(key);
    if (c && Date.now() - c.at < 12 * HOUR) return c;
    const now = Date.now();
    const q = recorders.query(rec.id, m.path, now - settings().days * DAY, now);
    const nameOf = (v) => m.stateNames?.[String(v)] ?? `#${v}`;
    const s = { at: now, ...staysOf(q.values ?? [], nameOf) };
    cache.set(key, s);
    return s;
  };
  const say = (rec, m, kind, state, text) => {
    const key = `${rec.id}|${m.path.toLowerCase()}|${kind}`;
    if (Date.now() - (sent.get(key) ?? 0) < HOUR) return;
    sent.set(key, Date.now());
    log(`anomalies: ${rec.plc}: ${m.path}: ${text}`);
    onEvent?.({ event: 'anomaly', quiet: true, level: 'watch', rule: 'Anomalies', ruleId: 'anomaly', plc: rec.plc, plcName: rec.plcName, machine: m.path, state, text: `${rec.plcName}: 🔍 ${m.path.split('.').slice(-1)[0]}: ${text}`, at: new Date().toISOString() });
  };
  return {
    /** A machine's value, as a recording takes it */
    sample(ruleId, m, v, t) {
      const s = settings();
      if (!s.enabled) return;
      const key = `${ruleId}|${m.path.toLowerCase()}`;
      const name = m.stateNames?.[String(v)] ?? `#${v}`;
      const prev = live.get(key);
      live.set(key, { state: name, since: t, first: !prev });
      if (!prev || prev.state === name) {
        if (prev) live.set(key, prev);
        return;
      }
      const rec = recorders.list().find((r) => r.id === ruleId);
      if (!rec) return;
      let st;
      try {
        st = statsOf(rec, m);
      } catch (err) {
        log(`anomalies: ${err.message}`);
        return;
      }
      // (its stay, when its start was seen)
      if (!prev.first) {
        const ms = t - prev.since;
        const j = judgeStay(ms, st.stays.get(prev.state), s);
        if (j) say(rec, m, `stay-${prev.state}`, prev.state, `${prev.state} lasted ${dur(ms)}, usually ${dur(j.median)}: ${j.kind === 'long' ? 'far longer than usual' : 'far shorter than usual (a step skipped?)'}`);
      }
      // (a transition never seen in its days, when it has enough of them)
      if (st.count > s.minStays && !st.transitions.has(`${prev.state}>${name}`)) {
        say(rec, m, `to-${prev.state}>${name}`, name, `${prev.state} → ${name}: a transition not seen in its last ${s.days} days`);
        st.transitions.add(`${prev.state}>${name}`);
      }
    },
  };
}

module.exports = { createAnomalies, judgeStay, staysOf };
