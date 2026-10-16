// The drive health board's early warnings (drives.cjs reads the values; this judges them): each drive against
// - its own limits: in fault (an error code), the heatsink near or over its warning threshold (the drive's own, else
//   80 °C), the motor's i²t and the device's ixt utilisation high, a short circuit or earth fault counted lately;
// - its own past: today's running values against its baseline (the median of its daily medians, the last 14 days):
//   the heatsink warmer, the current per Hz higher (more load, or wear) than it used to be;
// - its siblings: the same model on the same PLC, today: one much hotter than the others, its DC bus unlike theirs.
// "Running": the profile's running value (the output frequency) above 1 (stopped, a drive cools and draws nothing).
// A health score (100: nothing found) and the worst level: ok, watch, warn, alarm; unknown when nothing was read.

const LEVELS = ['ok', 'watch', 'warn', 'alarm'];
const PENALTY = { watch: 8, warn: 20, alarm: 50 };
const DEFAULTS = {
  heatsinkLimit: 80, // °C, when the drive does not say its own
  heatsinkMargin: 5, // °C below its limit: warn
  heatsinkRise: { watch: 5, warn: 8 }, // °C above its baseline
  currentRise: { watch: 10, warn: 20 }, // % above its baseline (per Hz)
  utilisation: { warn: 80, alarm: 95 }, // % (i²t, ixt)
  peerHotter: { watch: 6, warn: 10 }, // °C above its siblings' median
  dcBusApart: 10, // % from its siblings' median
  baselineDays: 3, // at least, for a baseline
  noMainsV: 50, // V: a DC bus below it: no mains (its 24 V only): not judged
};
const hex4 = (x) => x.toString(16).toUpperCase().padStart(4, '0');
const { lenzeError } = require('./lenzeErrors.cjs');
/** A drive's error code as its maker names it (its profile's errors: "lenze"), else null */
const errorOf = (profile, code) => (profile?.errors === 'lenze' ? lenzeError(code) : null);
const errorText = (code, named) => (named ? `${named.warning ? 'Warning' : 'In fault'}: error 0x${hex4(code)} "${named.text}"` : `In fault: error 0x${hex4(code)}`);

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
};

/**
 * A day's statistics of one drive (the samples of that day: { t, values: { key: number } }): per key its median,
 * 90 % and maximum over the running samples (all, for a key not of the running kind), and the current per Hz
 */
function dayStats(samples, profile) {
  const run = profile.running;
  const running = (s) => !run || (typeof s.values[run] === 'number' && Math.abs(s.values[run]) > 1);
  const out = {};
  const keys = new Set(samples.flatMap((s) => Object.keys(s.values)));
  for (const k of keys) {
    const p = profile.params.find((x) => x.key === k);
    if (!p || p.slow || p.counter || p.format === 'hex') continue;
    const xs = samples.filter((s) => (p.trend || p.peers ? running(s) : true) && typeof s.values[k] === 'number').map((s) => s.values[k]);
    if (xs.length) out[k] = { median: median(xs), p90: quantile(xs, 0.9), max: Math.max(...xs), n: xs.length };
  }
  if (run) {
    const ratio = samples.filter((s) => running(s) && typeof s.values.current === 'number').map((s) => s.values.current / Math.abs(s.values[run]));
    if (ratio.length) out.currentPerHz = { median: median(ratio), n: ratio.length };
  }
  return out;
}

/** The baseline of a key from past days' statistics ({ day: stats }): the median of their medians, enough days */
function baselineOf(days, key, minDays = DEFAULTS.baselineDays) {
  const ms = Object.values(days).map((d) => d?.[key]?.median).filter((v) => typeof v === 'number');
  return ms.length >= minDays ? { median: median(ms), days: ms.length } : null;
}

const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toString();

/**
 * One drive judged: { latest: { key: { v, t, error } }, today: dayStats, past: { day: dayStats } (the days before
 * today), counters7d: { key: value 7 days ago }, peers: [{ today }] (its siblings), profile, limits } ->
 * { level, score, findings: [{ level, key, text }], baseline: { key: median } }
 */
function evaluate({ latest = {}, today = {}, past = {}, counters7d = {}, peers = [], profile, limits = {} }) {
  const L = { ...DEFAULTS, ...limits };
  const findings = [];
  const add = (level, key, text) => findings.push({ level, key, text });
  const v = (k) => (typeof latest[k]?.v === 'number' ? latest[k].v : null);
  const readable = Object.values(latest).some((x) => typeof x?.v === 'number');
  if (!readable) {
    const err = Object.values(latest).find((x) => x?.error)?.error;
    return { level: 'unknown', score: null, findings: err ? [{ level: 'unknown', key: null, text: `Not read: ${err}` }] : [], baseline: {} };
  }
  // No mains (a DC bus near 0 V: the drive on its 24 V only): not judged; an error of the voltages inside the drive
  // (0x32xx, as without mains) not a fault, any other one still is
  const dc = v('dcBus');
  if (dc !== null && dc < L.noMainsV) {
    const err = v('error');
    const supply = !!err && err >= 0x3200 && err <= 0x32ff;
    const f = [];
    const named = err ? errorOf(profile, err) : null;
    if (err && !supply) f.push({ level: named?.warning ? 'warn' : 'alarm', key: 'error', text: errorText(err, named) });
    f.push({ level: 'off', key: 'dcBus', text: `No mains: DC bus ${fmt(dc, 0)} V${supply ? ` (error 0x${hex4(err)}${named ? ` "${named.text}"` : ': a voltage inside the drive'}, as without mains)` : ''}; not judged until it is powered` });
    return { level: f[0].level, score: null, findings: f, baseline: {} };
  }
  // In fault (or a warning, as its maker names its code)
  const error = v('error');
  if (error) {
    const named = errorOf(profile, error);
    add(named?.warning ? 'warn' : 'alarm', 'error', errorText(error, named));
  }
  // The heatsink against its limit, its past, its siblings
  const hs = v('heatsink');
  const limit = v('heatsinkLimit') ?? L.heatsinkLimit;
  if (hs !== null) {
    if (hs >= limit) add('alarm', 'heatsink', `Heatsink ${fmt(hs)} °C: at its warning threshold (${fmt(limit)} °C)`);
    else if (hs >= limit - L.heatsinkMargin) add('warn', 'heatsink', `Heatsink ${fmt(hs)} °C: near its warning threshold (${fmt(limit)} °C)`);
  }
  const baseline = {};
  const hb = baselineOf(past, 'heatsink');
  if (hb) baseline.heatsink = hb.median;
  if (hb && today.heatsink) {
    const rise = today.heatsink.median - hb.median;
    if (rise >= L.heatsinkRise.warn) add('warn', 'heatsink', `Running ${fmt(rise)} °C warmer than its last ${hb.days} days (${fmt(today.heatsink.median)} °C, was ${fmt(hb.median)} °C): check its fan and cooling, the load`);
    else if (rise >= L.heatsinkRise.watch) add('watch', 'heatsink', `Running ${fmt(rise)} °C warmer than its last ${hb.days} days`);
  }
  const cb = baselineOf(past, 'currentPerHz');
  if (cb) baseline.currentPerHz = cb.median;
  if (cb && today.currentPerHz && cb.median > 0) {
    const pct = ((today.currentPerHz.median - cb.median) / cb.median) * 100;
    if (pct >= L.currentRise.warn) add('warn', 'current', `Drawing ${fmt(pct, 0)} % more current at the same speed than its last ${cb.days} days: the load, bearings, the tool`);
    else if (pct >= L.currentRise.watch) add('watch', 'current', `Drawing ${fmt(pct, 0)} % more current at the same speed than its last ${cb.days} days`);
  }
  const peerHs = median(peers.map((p) => p.today?.heatsink?.median).filter((x) => typeof x === 'number'));
  if (peerHs !== null && today.heatsink && peers.length >= 2) {
    const d = today.heatsink.median - peerHs;
    if (d >= L.peerHotter.warn) add('warn', 'heatsink', `${fmt(d)} °C hotter than its ${peers.length} siblings today (${fmt(today.heatsink.median)} °C, they ${fmt(peerHs)} °C)`);
    else if (d >= L.peerHotter.watch) add('watch', 'heatsink', `${fmt(d)} °C hotter than its ${peers.length} siblings today`);
  }
  const peerDc = median(peers.map((p) => p.today?.dcBus?.median).filter((x) => typeof x === 'number'));
  if (peerDc && today.dcBus && peers.length >= 2) {
    const pct = Math.abs((today.dcBus.median - peerDc) / peerDc) * 100;
    if (pct >= L.dcBusApart) add('watch', 'dcBus', `DC bus ${fmt(today.dcBus.median, 0)} V, its siblings ${fmt(peerDc, 0)} V: its supply, its DC-bus capacitors`);
  }
  // Utilisation
  for (const [k, what] of [['motorI2t', 'Motor i²t'], ['deviceIxt', 'Device ixt']]) {
    const u = v(k);
    if (u === null) continue;
    if (u >= L.utilisation.alarm) add('alarm', k, `${what} ${fmt(u, 0)} %: about to trip`);
    else if (u >= L.utilisation.warn) add('warn', k, `${what} ${fmt(u, 0)} %: running near its limit`);
  }
  // Counters of bad events, the last 7 days
  for (const p of profile.params.filter((x) => x.counter && x.bad)) {
    const now = v(p.key);
    const before = counters7d[p.key];
    if (now !== null && typeof before === 'number' && now > before) add('alarm', p.key, `${now - before} new ${now - before === 1 ? p.label.toLowerCase().replace(/s$/, '') : p.label.toLowerCase()} in 7 days`);
  }
  // (most of its values not answering: not healthy for what little answers)
  const main = profile.params.filter((p) => !p.slow);
  const answered = main.filter((p) => typeof latest[p.key]?.v === 'number').length;
  const failed = main.filter((p) => latest[p.key]?.error).length;
  if (main.length >= 3 && failed > answered) {
    const err = main.map((p) => latest[p.key]?.error).find(Boolean);
    add('watch', null, `Only ${answered} of its ${main.length} values answer${err ? ` (${err})` : ''}: its address or its profile? (the setup page: Check a drive)`);
  }
  const level = findings.reduce((w, f) => (LEVELS.indexOf(f.level) > LEVELS.indexOf(w) ? f.level : w), 'ok');
  const score = Math.max(0, 100 - findings.reduce((s, f) => s + (PENALTY[f.level] ?? 0), 0));
  findings.sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level));
  return { level, score, findings, baseline };
}

module.exports = { evaluate, dayStats, baselineOf, median, quantile, DEFAULTS, LEVELS };
