// Tokens: an expiry date (expires: a token past it is refused, said why), a rotation (a new secret for the same
// name; the old one still let in until its grace period ends: previous { sha256, until }), and its PLCs (plcs: only
// those: their machines, alerts, work orders, drives …; none: every PLC). Its expiry near (7 days) told once a day.
const crypto = require('crypto');

const DAY = 86400000;

/** The token a secret is (its hash): { token, old: true when it is the one rotated out } or { expired } or null */
function tokenFor(tokens, secret, sha256, now = Date.now()) {
  const hash = Buffer.from(sha256(String(secret ?? '')), 'hex');
  const same = (h) => {
    const stored = Buffer.from(String(h ?? ''), 'hex');
    return stored.length === hash.length && crypto.timingSafeEqual(stored, hash);
  };
  for (const t of tokens ?? []) {
    const isNew = same(t.sha256);
    const isOld = !isNew && t.previous?.sha256 && Date.parse(t.previous.until) > now && same(t.previous.sha256);
    if (!isNew && !isOld) continue;
    if (t.expires && Date.parse(t.expires) <= now) return { expired: t };
    return { token: t, old: !!isOld };
  }
  return null;
}

/** A token's PLCs (a Set), or null: every PLC */
const allowedOf = (t) => (Array.isArray(t?.plcs) && t.plcs.length ? new Set(t.plcs.map(String)) : null);

/**
 * A message from a board with a token of some PLCs: one of another PLC refused (true), its lists of PLCs narrowed to
 * its own (an empty one: all of its own)
 */
function scopeIn(m, allowed) {
  if (!allowed || !m || typeof m !== 'object') return false;
  const plcOf = [m.plc, m.order?.plc, m.shelf?.plc, m.part?.plc, m.plan?.plc].filter((x) => typeof x === 'string' && x);
  if (plcOf.some((p) => !allowed.has(p))) return true;
  if (Array.isArray(m.plcs)) {
    const own = m.plcs.map(String).filter((p) => allowed.has(p));
    m.plcs = own.length ? own : [...allowed];
  }
  return false;
}

/** A message to it: what is of another PLC left out (null: none of it is its) */
function scopeOut(msg, allowed) {
  if (!allowed || !msg || typeof msg !== 'object') return msg;
  const mine = (p) => !p || allowed.has(String(p));
  switch (msg.type) {
    case 'welcome':
      return { ...msg, plcs: (msg.plcs ?? []).filter((p) => allowed.has(p.id)) };
    case 'alertsList':
      return { ...msg, events: (msg.events ?? []).filter((e) => mine(e.plc)) };
    case 'alertEvent':
      return mine(msg.event?.plc) ? msg : null;
    case 'workOrders':
      return { ...msg, orders: (msg.orders ?? []).filter((o) => mine(o.plc)) };
    case 'changes':
      return { ...msg, changes: (msg.changes ?? []).filter((c) => mine(c.plc)) };
    case 'shelves':
      return { ...msg, active: (msg.active ?? []).filter((s) => mine(s.plc)), recent: (msg.recent ?? []).filter((s) => mine(s.plc)) };
    case 'drivesState':
    case 'axesState':
    case 'fleetState':
    case 'boardState':
      return Array.isArray(msg.plcs) ? { ...msg, plcs: msg.plcs.filter((p) => allowed.has(p.id)) } : msg;
    case 'pmPlans':
      return { ...msg, plans: (msg.plans ?? []).filter((p) => mine(p.plc)) };
    default:
      return msg;
  }
}

/** Expiries near (7 days), told once a day each */
function watchExpiry({ getConfig, onEvent, log, every = 3600000 }) {
  const told = new Map();
  const check = () => {
    const now = Date.now();
    const day = new Date(now).toDateString();
    for (const t of getConfig().tokens ?? []) {
      if (!t.expires) continue;
      const left = Date.parse(t.expires) - now;
      if (!(left > 0 && left < 7 * DAY) || told.get(t.name) === day) continue;
      told.set(t.name, day);
      log(`tokens: "${t.name}" expires ${t.expires}`);
      onEvent?.({ event: 'token', level: 'warn', rule: 'Tokens', ruleId: 'tokens', plc: '', plcName: '', machine: `token ${t.name}`, state: 'expiring', text: `🔑 The token "${t.name}" expires ${new Date(t.expires).toLocaleDateString()} (in ${Math.ceil(left / DAY)} day(s)): rotate it on the setup page (Tokens)`, at: new Date(now).toISOString() });
    }
  };
  const timer = setInterval(check, every);
  timer.unref?.();
  setTimeout(check, 10000).unref?.();
  return { check, stop: () => clearInterval(timer) };
}

module.exports = { tokenFor, allowedOf, scopeIn, scopeOut, watchExpiry };
