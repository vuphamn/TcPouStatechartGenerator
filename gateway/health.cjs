// The gateway's own health (the setup page's Health; a summary to the Sites page of a gateway that follows this one):
// the disk it keeps its data on (free, of how much), what it keeps there (its recordings, each one; its fault records,
// drives', events, photos, backups), how fast its recordings grow (the last 7 days a day), when the disk is full at
// that, and a retention planner: each recording's days kept and what it will take at full retention; days to keep to
// fit when it will not. Low (under 10 % or 5 GB free, or full within 14 days): an alert (event "disk"), once a day.
const fs = require('fs');
const path = require('path');

const DAY = 86400000;
const GB = 1024 ** 3;

/** A folder's size (bytes) and its files, under it */
function sizeOf(dir) {
  let bytes = 0;
  let files = 0;
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          bytes += fs.statSync(p).size;
          files++;
        } catch {
          // (gone meanwhile)
        }
      }
    }
  };
  walk(dir);
  return { bytes, files };
}

/** A recording's day files (YYYY-MM-DD.jsonl[.gz]): its size, its days, its bytes a day (its last 7 full days) */
function recordingOf(dir, id, keepDays, now = Date.now()) {
  const d = path.join(dir, id);
  let names = [];
  try {
    names = fs.readdirSync(d).filter((n) => /^\d{4}-\d\d-\d\d\.jsonl(\.gz)?$/.test(n));
  } catch {
    names = [];
  }
  const days = names.map((n) => ({ day: n.slice(0, 10), bytes: fs.statSync(path.join(d, n)).size })).sort((a, b) => a.day.localeCompare(b.day));
  // (today, as the recorder names its days: local)
  const t = new Date(now);
  const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const full = days.filter((x) => x.day < today).slice(-7);
  const perDay = full.length ? full.reduce((a, x) => a + x.bytes, 0) / full.length : days.length ? days[days.length - 1].bytes : 0;
  const bytes = days.reduce((a, x) => a + x.bytes, 0);
  return { id, bytes, days: days.length, perDay, keepDays: keepDays ?? null, atFull: keepDays ? perDay * keepDays : null };
}

/**
 * The health now: { disk: { free, total, freePct }, folders: [{ name, bytes }], recordings: [...], growthPerDay,
 * daysLeft, plan: { needed, fits, suggestions: [{ id, keepDays, keep }] }, low: why or null }
 */
function healthOf({ baseDir, recordings = [], statfs = fs.statfsSync, now = Date.now() }) {
  let disk = null;
  try {
    const st = statfs(baseDir);
    disk = { free: st.bavail * st.bsize, total: st.blocks * st.bsize };
    disk.freePct = disk.total ? (disk.free / disk.total) * 100 : null;
  } catch {
    disk = null;
  }
  const folders = ['recordings', 'faults', 'drives', 'axes', 'fleet', 'eventlog', 'attachments', 'backups', 'projects', 'support'].map((name) => ({ name, ...sizeOf(path.join(baseDir, name)) })).filter((f) => f.files);
  const recDir = path.join(baseDir, 'recordings');
  const recs = recordings.map((r) => ({ ...recordingOf(recDir, r.id, Number(r.days) || null, now), name: r.name ?? r.id }));
  const growthPerDay = recs.reduce((a, r) => a + r.perDay, 0);
  // (full at its growth: its recordings until they reach their retention, then flat)
  const needed = recs.reduce((a, r) => a + Math.max(0, (r.atFull ?? r.bytes) - r.bytes), 0);
  const daysLeft = disk && growthPerDay > 0 ? disk.free / growthPerDay : null;
  const fits = !disk || needed <= disk.free * 0.8;
  // (not fitting: each recording's days cut in the same share, to fit 80 % of what is free)
  let suggestions = [];
  if (disk && !fits && needed > 0) {
    const share = (disk.free * 0.8 + recs.reduce((a, r) => a + r.bytes, 0)) / recs.reduce((a, r) => a + (r.atFull ?? r.bytes), 0);
    suggestions = recs.filter((r) => r.keepDays && r.perDay > 0).map((r) => ({ id: r.id, name: r.name, keepDays: r.keepDays, keep: Math.max(1, Math.floor(r.keepDays * Math.min(1, share))) }));
  }
  const low = !disk ? null : disk.freePct !== null && disk.freePct < 10 ? `${disk.freePct.toFixed(1)} % free` : disk.free < 5 * GB ? `${(disk.free / GB).toFixed(1)} GB free` : !fits ? 'its recordings will not fit at their retention' : daysLeft !== null && daysLeft < 14 ? `full in ${Math.round(daysLeft)} days at its growth` : null;
  return { at: now, disk, folders, recordings: recs, growthPerDay, daysLeft, plan: { needed, fits, suggestions }, low };
}

/** Its health followed: worked out every 10 minutes, a low one told once a day (onEvent) */
function createHealth({ baseDir, getConfig, log, onEvent, every = 10 * 60000 }) {
  let last = null;
  let toldDay = '';
  // (told from its first check after start, 10 minutes on: not at once)
  const check = (tell = false) => {
    try {
      last = healthOf({ baseDir, recordings: getConfig().recordings ?? [] });
    } catch (err) {
      log(`health: ${err.message}`);
      return last;
    }
    const day = new Date().toDateString();
    if (tell && last.low && toldDay !== day) {
      toldDay = day;
      log(`health: the disk: ${last.low}`);
      onEvent?.({ event: 'disk', level: 'warn', rule: 'Gateway health', ruleId: 'health', plc: '', plcName: '', machine: 'the gateway', state: 'low', text: `💽 The gateway's disk: ${last.low}${last.daysLeft !== null ? `; full in about ${Math.round(last.daysLeft)} days at its growth` : ''} (the setup page: Health)`, at: new Date().toISOString() });
    }
    return last;
  };
  const timer = setInterval(() => check(true), every);
  timer.unref?.();
  setTimeout(() => check(false), 5000).unref?.();
  return {
    now: () => check(),
    last: () => last,
    /** For the Sites page of a gateway following this one: its disk, its days left */
    summary: () => ((last ?? check()) ? { freePct: last.disk?.freePct ?? null, free: last.disk?.free ?? null, daysLeft: last.daysLeft, low: last.low } : null),
    stop: () => clearInterval(timer),
  };
}

module.exports = { healthOf, createHealth, sizeOf, recordingOf };
