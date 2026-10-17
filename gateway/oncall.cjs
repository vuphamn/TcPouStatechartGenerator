// On-call rotations and acknowledging by link. A rotation (config.rotations: [{ "name": "Maintenance", "every": "week"
// or "day", "start": "2026-10-19T07:00" (its first handover), "people": [{ "name": "Bob", "contact": "+15551234567" }] }])
// hands over at its start's time, each day or week, to the next of its people in turn; a channel of the roles (its
// "rotation") then tells the one on call now, and, escalated, the next one too. Each email or text carries a link
// (config.publicUrl) that acknowledges the alert as that person: signed (HMAC-SHA256, its key in ack.secret beside
// config.json, never in a backup), good for 24 hours.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PERIOD = { day: 86400000, week: 7 * 86400000 };

/** A rotation's start (ms, local time) */
const startOf = (rot) => {
  const t = Date.parse(String(rot?.start ?? '').replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
};

/** The one on call at `when`: { name, contact, index, from, until } (null: no rotation, nobody in it) */
function personAt(rot, when = Date.now()) {
  const people = Array.isArray(rot?.people) ? rot.people.filter((p) => p?.name) : [];
  const start = startOf(rot);
  const period = PERIOD[rot?.every] ?? PERIOD.week;
  if (!people.length || start === null) return null;
  const k = Math.floor((when - start) / period);
  const index = ((k % people.length) + people.length) % people.length;
  return { ...people[index], index, from: start + k * period, until: start + (k + 1) * period };
}

/** The next `count` handovers from `from`: [{ name, contact, from, until }] (the calendar) */
function scheduleOf(rot, from = Date.now(), count = 8) {
  const out = [];
  let p = personAt(rot, from);
  for (let i = 0; p && i < count; i++) {
    out.push(p);
    p = personAt(rot, p.until);
  }
  return out;
}

/** A rotation checked (throws with why): { name, every, start, people } */
function checkRotation(r, i) {
  const where = `Rotation ${i + 1}`;
  const name = String(r?.name ?? '').trim().slice(0, 60);
  if (!name) throw new Error(`${where}: its name`);
  if (!['day', 'week'].includes(r?.every)) throw new Error(`${name}: every day or every week`);
  if (startOf(r) === null) throw new Error(`${name}: its first handover, a date and time (2026-10-19 07:00)`);
  const people = (Array.isArray(r?.people) ? r.people : []).map((p) => ({ name: String(p?.name ?? '').trim().slice(0, 60), contact: String(p?.contact ?? '').trim().slice(0, 120) })).filter((p) => p.name);
  if (!people.length) throw new Error(`${name}: who takes turns`);
  return { name, every: r.every, start: String(r.start).replace(' ', 'T').slice(0, 16), people };
}

/** Acknowledge links: made, checked */
function createAckLinks({ baseDir, getConfig }) {
  const file = path.join(baseDir, 'ack.secret');
  let key;
  try {
    key = fs.readFileSync(file);
  } catch {
    key = crypto.randomBytes(32);
    try {
      fs.writeFileSync(file, key, { mode: 0o600 });
    } catch {
      // (this run only)
    }
  }
  const sign = (id, who, exp) => crypto.createHmac('sha256', key).update(`${id}|${who}|${exp}`).digest('base64url');
  return {
    /** Its link (null: config.publicUrl not set) */
    linkOf(id, who, now = Date.now()) {
      const base = String(getConfig().publicUrl ?? '').replace(/\/+$/, '');
      if (!base || !id) return null;
      const exp = Math.floor((now + 86400000) / 1000);
      const w = encodeURIComponent(String(who || 'link').slice(0, 60));
      return `${base}/ack/${encodeURIComponent(id)}/${w}/${exp}/${sign(id, decodeURIComponent(w), exp)}`;
    },
    /** A link's parts checked: { id, who } or null (wrong, expired) */
    check(id, who, exp, sig, now = Date.now()) {
      if (!/^\d+$/.test(String(exp)) || Number(exp) * 1000 < now) return null;
      const want = Buffer.from(sign(id, who, Number(exp)));
      const got = Buffer.from(String(sig));
      return want.length === got.length && crypto.timingSafeEqual(want, got) ? { id, who } : null;
    },
  };
}

module.exports = { personAt, scheduleOf, checkRotation, createAckLinks, PERIOD };
