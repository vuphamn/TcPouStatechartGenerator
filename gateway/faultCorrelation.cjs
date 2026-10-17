// What changes before a fault (the fault viewer's "Before it, most often"): over the fault records of the same machine
// going into the same state (fault records keep the minute before each one), each signal kept and each other machine
// of the PLC: how often it changed in the seconds before the fault (10 s), against how often it changes in any other
// 10 seconds of those minutes (its usual rate). The ones that changed before most of them, much more often than
// usual, first: likely its cause, or the first to show it.
const WINDOW_MS = 10000;

/** Its values' changes [{ t, v }] (the first value: none) */
const changesOf = (list) => {
  const out = [];
  for (let i = 1; i < (list?.length ?? 0); i++) if (JSON.stringify(list[i].v) !== JSON.stringify(list[i - 1].v)) out.push(list[i]);
  return out;
};

/**
 * records: full fault records of one machine and state; -> [{ name, kind: 'signal' | 'machine', hits, of, rate,
 * usualRate, lift, before: its most common value just before }] (those changed before at least 2 of them and half,
 * most telling first)
 */
function correlate(records, { windowMs = WINDOW_MS, minRate = 0.5 } = {}) {
  const stats = new Map(); // key -> { name, kind, hits, of, slices, sliceHits, befores: Map }
  for (const r of records) {
    const machine = String(r.machine ?? '').toLowerCase();
    const lists = [
      ...Object.entries(r.signals ?? {}).map(([name, list]) => ({ name, kind: 'signal', list })),
      ...Object.entries(r.machines ?? {}).filter(([name]) => name.toLowerCase() !== machine).map(([name, list]) => ({ name, kind: 'machine', list: list.map((p) => ({ t: p.t, v: r.stateNames?.[name]?.[String(p.v)] ?? p.v })) })),
    ];
    for (const { name, kind, list } of lists) {
      const k = `${kind}|${name}`;
      const s = stats.get(k) ?? { name, kind, hits: 0, of: 0, slices: 0, sliceHits: 0, befores: new Map() };
      const ch = changesOf(list);
      s.of++;
      // (just before: a change in its last seconds; its value then)
      const hit = ch.some((c) => c.t > r.at - windowMs && c.t <= r.at);
      if (hit) {
        s.hits++;
        const last = [...list].filter((p) => p.t <= r.at).at(-1);
        const key = JSON.stringify(last?.v ?? null);
        s.befores.set(key, (s.befores.get(key) ?? 0) + 1);
      }
      // (its usual rate: the minute before, less those seconds, in slices of the same length)
      for (let a = r.from; a + windowMs <= r.at - windowMs; a += windowMs) {
        s.slices++;
        if (ch.some((c) => c.t > a && c.t <= a + windowMs)) s.sliceHits++;
      }
      stats.set(k, s);
    }
  }
  return [...stats.values()]
    .map((s) => {
      const rate = s.of ? s.hits / s.of : 0;
      const usualRate = s.slices ? s.sliceHits / s.slices : 0;
      const before = [...s.befores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      return { name: s.name, kind: s.kind, hits: s.hits, of: s.of, rate, usualRate, lift: rate / Math.max(usualRate, 0.02), before: before === undefined ? null : JSON.parse(before) };
    })
    .filter((x) => x.hits >= 2 && x.rate >= minRate && x.rate > x.usualRate)
    .sort((a, b) => b.rate - a.rate || b.lift - a.lift)
    .slice(0, 10);
}

module.exports = { correlate, changesOf, WINDOW_MS };
