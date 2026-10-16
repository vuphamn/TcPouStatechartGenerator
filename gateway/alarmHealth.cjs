// Alarm health, as ISA-18.2 (and EEMUA 191) measure an alarm system, from the gateway's alert history: how many alarms
// an hour (about 6 an hour, one in 10 minutes, is acceptable; over 12, overloaded), the busiest 10 minutes, floods (more
// than 10 in 10 minutes) and the share of time in them, the bad actors (the alarms most often raised, and their share),
// chattering ones (raised 3 times or more within a minute), stale ones (open over 24 hours), how long they wait to be
// acknowledged, and the ones muted (in maintenance). An alarm: an error state, stuck, a PLC stopped, a drive, getting
// slower (not calls for maintenance, work orders, recoveries).
const ALARMS = ['error', 'stuck', 'plcStopped', 'drive', 'slower'];
const TEN = 10 * 60000;
const DAY = 86400000;

const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
};

function alarmHealth({ events, from, to, plcIds = [], now = Date.now() }) {
  const inPlc = (e) => !plcIds.length || plcIds.includes(e.plc);
  const all = events.filter((e) => ALARMS.includes(e.event) && inPlc(e)).map((e) => ({ ...e, t: Date.parse(e.at) })).filter((e) => Number.isFinite(e.t));
  const inWindow = all.filter((e) => e.t >= from && e.t < to);
  const muted = inWindow.filter((e) => e.muted).length;
  const list = inWindow.filter((e) => !e.muted).sort((a, b) => a.t - b.t);
  const hours = Math.max(1 / 60, (to - from) / 3600000);
  const perHour = list.length / hours;
  // The 10 minutes: the busiest; floods (more than 10), merged
  const buckets = new Map();
  for (const e of list) {
    const b = Math.floor((e.t - from) / TEN);
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  let peak = { at: null, count: 0 };
  for (const [b, n] of buckets) if (n > peak.count) peak = { at: from + b * TEN, count: n };
  const floodBuckets = [...buckets.entries()].filter(([, n]) => n > 10).map(([b]) => b).sort((a, b) => a - b);
  const floods = [];
  for (const b of floodBuckets) {
    const last = floods[floods.length - 1];
    const count = buckets.get(b);
    if (last && last.lastB === b - 1) {
      last.to = from + (b + 1) * TEN;
      last.count += count;
      last.lastB = b;
    } else floods.push({ from: from + b * TEN, to: from + (b + 1) * TEN, count, lastB: b });
  }
  const totalBuckets = Math.max(1, Math.ceil((to - from) / TEN));
  // Each alarm (its PLC, machine, state): how often; chattering (3 or more within a minute)
  const byAlarm = new Map();
  for (const e of list) {
    const k = `${e.plc}|${e.machine}|${e.state}`;
    const a = byAlarm.get(k) ?? { plc: e.plc, plcName: e.plcName ?? e.plc, machine: e.machine, state: e.state, event: e.event, count: 0, times: [] };
    a.count++;
    a.times.push(e.t);
    byAlarm.set(k, a);
  }
  const top = [...byAlarm.values()].sort((a, b) => b.count - a.count).slice(0, 10).map(({ times, ...a }) => ({ ...a, share: list.length ? a.count / list.length : 0 }));
  const chattering = [];
  for (const a of byAlarm.values()) {
    let most = 0;
    let j = 0;
    for (let i = 0; i < a.times.length; i++) {
      while (a.times[i] - a.times[j] > 60000) j++;
      most = Math.max(most, i - j + 1);
    }
    if (most >= 3) chattering.push({ plc: a.plc, plcName: a.plcName, machine: a.machine, state: a.state, count: a.count, inAMinute: most });
  }
  chattering.sort((a, b) => b.inAMinute - a.inAMinute || b.count - a.count);
  // Stale: open (not resolved, not muted) over 24 hours, whenever raised
  const stale = all.filter((e) => !e.resolvedAt && !e.muted && now - e.t > DAY).sort((a, b) => a.t - b.t).slice(0, 50).map((e) => ({ id: e.id, plc: e.plc, plcName: e.plcName ?? e.plc, machine: e.machine, state: e.state, at: e.t, acked: !!e.ack }));
  // Acknowledged: how long after
  const ackMs = list.filter((e) => e.ack?.at).map((e) => Date.parse(e.ack.at) - e.t).filter((x) => x >= 0);
  // By day (the last 31 days of the window)
  const days = [];
  for (let d = new Date(new Date(Math.max(from, to - 31 * DAY)).toDateString()).getTime(); d < to; d += DAY) days.push({ day: d, count: list.filter((e) => e.t >= d && e.t < d + DAY).length });
  const rating = perHour <= 6 ? 'acceptable' : perHour <= 12 ? 'manageable' : 'overloaded';
  return {
    from, to, total: list.length, muted, perHour, rating,
    peak10: peak, floods: floods.map(({ lastB, ...f }) => f), floodPct: (floodBuckets.length / totalBuckets) * 100,
    top, topShare: top.reduce((s, a) => s + a.share, 0),
    chattering: chattering.slice(0, 20), stale,
    ack: { count: ackMs.length, notAcked: list.length - ackMs.length, medianMs: quantile(ackMs, 0.5), p90Ms: quantile(ackMs, 0.9) },
    days,
  };
}

module.exports = { alarmHealth, ALARMS };
