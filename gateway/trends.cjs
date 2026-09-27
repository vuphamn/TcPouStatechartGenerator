// State-time trends from the gateway's recordings: for one machine, per day and per state, how long it stayed (the
// stays that ended that day): count, average, median, 90%, longest, total. A stay that spans midnight counts for the
// day it ends. Finished days are kept in memory (their files no longer change); today is read again each time.
const fs = require('fs');
const path = require('path');

const quantile = (sorted, q) => {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

function summarize(byValue) {
  const out = {};
  for (const [v, list] of byValue) {
    const sorted = list.sort((a, b) => a - b);
    const total = sorted.reduce((s, x) => s + x, 0);
    out[v] = { n: sorted.length, avgMs: total / sorted.length, medianMs: quantile(sorted, 0.5), p90Ms: quantile(sorted, 0.9), maxMs: sorted[sorted.length - 1], totalMs: total };
  }
  return out;
}

function createTrends({ dir }) {
  const cache = new Map(); // `${id}|${day}|${machine}` -> { last, states }

  /** One day of one machine: the stays that ended that day (carry: the last sample of the day before) */
  function day(id, d, machine, carry, today) {
    const key = `${id}|${d}|${machine}`;
    if (d !== today && cache.has(key)) {
      const hit = cache.get(key);
      // (the cached day started from its own carry; a different carry only changes its first stay)
      if (hit.carryT === carry?.t) return hit;
    }
    let text = '';
    try {
      text = fs.readFileSync(path.join(dir, id, `${d}.jsonl`), 'utf8');
    } catch {
      return { last: carry, states: {}, carryT: carry?.t };
    }
    const byValue = new Map();
    let prev = carry;
    for (const line of text.split('\n')) {
      if (!line) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (String(o.m).toLowerCase() !== machine) continue;
      // (the same value again: the gateway restarted and logged it anew; the stay goes on)
      if (prev && prev.v === o.v) continue;
      if (prev && o.t >= prev.t) {
        if (!byValue.has(prev.v)) byValue.set(prev.v, []);
        byValue.get(prev.v).push(o.t - prev.t);
      }
      prev = { t: o.t, v: o.v };
    }
    const result = { last: prev, states: summarize(byValue), carryT: carry?.t };
    if (d !== today) cache.set(key, result);
    return result;
  }

  return {
    /** The machine's state times per day, for the days recorded (the latest `days`), oldest first */
    of(id, machine, days, allDays, today) {
      const want = String(machine).toLowerCase();
      const list = allDays.slice(-(days + 1));
      const out = [];
      let carry = null;
      list.forEach((d, i) => {
        const r = day(id, d, want, carry, today);
        carry = r.last;
        // (the first day read only gives the carry for the next: its first stay started before it)
        if (i > 0 || list.length <= days) out.push({ day: d, states: r.states });
      });
      return out.slice(-days);
    },
  };
}

module.exports = { createTrends };
