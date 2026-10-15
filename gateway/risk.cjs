// The risk list: what to look at first, across every PLC, for a maintenance supervisor. From
// - the drives (drives.cjs): their health findings, and their heatsink's trend: its daily medians (while running) going
//   up, carried forward to its warning threshold: "in about 20 days";
// - the I/O boxes (fleet.cjs): one out of OP now, one dropping out of OP on several days, its CRC errors (cables,
//   connectors) rising;
// - the machines (the alert history): more faults this week than the week before.
// Each with its level (alarm, warn, watch), its reason, and when known how many days are left.

const RANK = { alarm: 0, warn: 1, watch: 2 };

/** A straight line through the points ({ x, y }): its slope (y per x), null with too few */
function slopeOf(points) {
  if (points.length < 5) return null;
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  const sxx = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  if (!sxx) return null;
  return points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx;
}

const dayNumber = (day) => Math.round(Date.parse(`${day}T12:00:00`) / 86400000);

/**
 * The risks: drives [{ id, name, drives: [view…] }], daily [{ plc: { drivePath: [{ day, heatsink }] } }] (the drives'
 * daily medians), fleet [{ id, name, boxes: [view…] }], alerts (the history), now
 */
function risks({ drives = [], daily = {}, fleet = [], alerts = [], now = Date.now(), limits = {} }) {
  const L = { heatsinkSlope: 0.15, etaDays: 90, etaWarnDays: 14, crcWarn: 50, crcWatch: 5, daysOutWarn: 2, faultsWatch: 5, faultsWarn: 10, ...limits };
  const out = [];
  // Drives
  for (const p of drives) {
    for (const d of p.drives ?? []) {
      const where = `${p.name} · ${d.device ?? ''}`;
      const lv = d.health?.level;
      if (lv === 'alarm' || lv === 'warn' || lv === 'watch') out.push({ id: `drive:${p.id}:${d.path}`, kind: 'drive', plc: p.id, plcName: p.name, name: d.name, path: d.path, where, level: lv, reason: d.health.findings?.[0]?.text ?? lv, eta: null });
      if (d.notAnswering) out.push({ id: `drive-mute:${p.id}:${d.path}`, kind: 'drive', plc: p.id, plcName: p.name, name: d.name, path: d.path, where, level: 'warn', reason: 'Not answering its reads', eta: null });
      // (its heatsink's trend, carried forward to its threshold)
      const days = (daily[p.id]?.[d.path] ?? []).filter((x) => typeof x.heatsink === 'number').slice(-14);
      const slope = slopeOf(days.map((x) => ({ x: dayNumber(x.day), y: x.heatsink })));
      const limit = (typeof d.latest?.heatsinkLimit?.v === 'number' ? d.latest.heatsinkLimit.v : 80) - 5;
      const last = days.at(-1)?.heatsink;
      if (slope !== null && slope >= L.heatsinkSlope && typeof last === 'number' && last < limit) {
        const eta = Math.round((limit - last) / slope);
        if (eta <= L.etaDays) out.push({ id: `drive-trend:${p.id}:${d.path}`, kind: 'drive', plc: p.id, plcName: p.name, name: d.name, path: d.path, where, level: eta <= L.etaWarnDays ? 'warn' : 'watch', reason: `Heatsink rising ${(Math.round(slope * 100) / 100).toString()} °C a day (${days.length} days): near its warning threshold in about ${eta} days`, eta, trend: days.map((x) => x.heatsink) });
      }
    }
  }
  // I/O boxes
  for (const p of fleet) {
    for (const b of p.boxes ?? []) {
      if (b.disabled) continue;
      const where = `${p.name} · ${b.device}`;
      const base = { kind: 'box', plc: p.id, plcName: p.name, name: b.name, path: b.path, where, eta: null };
      if (b.now && !b.now.ok && !b.now.absent) out.push({ ...base, id: `box-now:${p.id}:${b.path}`, level: 'alarm', reason: `Not in OP now (${b.now.name})` });
      if (b.week?.daysOut >= L.daysOutWarn) out.push({ ...base, id: `box-out:${p.id}:${b.path}`, level: 'warn', reason: `Out of OP on ${b.week.daysOut} of the last 7 days: its supply, its cable, its connectors` });
      if (b.week?.crc >= L.crcWarn) out.push({ ...base, id: `box-crc:${p.id}:${b.path}`, level: 'warn', reason: `${b.week.crc} CRC errors in 7 days: its cable or connectors` });
      else if (b.week?.crc >= L.crcWatch) out.push({ ...base, id: `box-crc:${p.id}:${b.path}`, level: 'watch', reason: `${b.week.crc} CRC errors in 7 days` });
    }
  }
  // Machines faulting more
  const week = 7 * 86400000;
  const count = new Map();
  for (const a of alerts) {
    if (a.event !== 'error' && a.event !== 'stuck') continue;
    const t = Date.parse(a.at);
    const k = `${a.plc}|${a.machine}`;
    const c = count.get(k) ?? { plc: a.plc, plcName: a.plcName, machine: a.machine, now: 0, before: 0 };
    if (t > now - week) c.now++;
    else if (t > now - 2 * week) c.before++;
    count.set(k, c);
  }
  for (const c of count.values()) {
    if (c.now < L.faultsWatch || c.now < 2 * c.before) continue;
    out.push({ id: `machine:${c.plc}:${c.machine}`, kind: 'machine', plc: c.plc, plcName: c.plcName, name: c.machine, path: c.machine, where: c.plcName, level: c.now >= L.faultsWarn ? 'warn' : 'watch', reason: `${c.now} faults or stuck states this week (${c.before} the week before)`, eta: null });
  }
  return out.sort((a, b) => RANK[a.level] - RANK[b.level] || (a.eta ?? 1e9) - (b.eta ?? 1e9) || a.name.localeCompare(b.name));
}

/** The inventory: the boxes by maker, type and firmware, with how many and where */
function inventory(fleet = []) {
  const groups = new Map();
  for (const p of fleet) {
    for (const b of p.boxes ?? []) {
      const k = `${b.vendor}|${b.type}|${b.revision}`;
      const g = groups.get(k) ?? { vendor: b.vendor || '?', type: b.type || b.product || '?', revision: b.revision, productCode: b.productCode, count: 0, disabled: 0, places: [] };
      g.count++;
      if (b.disabled) g.disabled++;
      g.places.push({ plc: p.id, plcName: p.name, path: b.path, name: b.name });
      groups.set(k, g);
    }
  }
  return [...groups.values()].sort((a, b) => a.vendor.localeCompare(b.vendor) || a.type.localeCompare(b.type) || String(a.revision).localeCompare(String(b.revision)));
}

module.exports = { risks, inventory, slopeOf };
