// Roles: who may do what on the gateway, which board page each one starts on, and who is told about what.
// config.json "roles" (the setup page's Roles edits it); without it, everyone signed in may do everything (as before:
// writeUsers and boardEditors still apply), and a view-only token is a display.
//   "roles": {
//     "users":  { "ann": "operator", "bob@acme.com": "technician" },      a user (a token's name, a company sign-in)
//     "groups": { "Maintenance": "technician" },                          a company sign-in's group (or app role)
//     "default": "operator",                                              everyone else signed in ("" or none: nothing)
//     "startPages": { "operator": "<saved filter id>" },                  the board's page for a role (a saved filter)
//     "pages": { "operator": ["andon", "machines"] },                     the board's pages a role sees (else its defaults)
//     "notify": [{ "role": "technician", "webhook": "https://…", "format": "teams", "events": ["error", "stuck", "drive",
//                 "call", "plcStopped"], "onCall": [{ "name": "Bob", "days": "Mon-Fri", "from": "06:00", "to": "14:00" }] }]
//   }
const ROLES = ['operator', 'technician', 'supervisor', 'engineer', 'manager'];
const LABELS = { operator: 'Operator', technician: 'Service / maintenance technician', supervisor: 'Maintenance supervisor', engineer: 'Engineer', manager: 'Production / office manager' };
/** What each role may do (the gateway refuses the rest; the board and the web app hide it) */
const CAN = {
  operator: ['ack', 'note', 'call', 'downtime'],
  technician: ['ack', 'note', 'call', 'downtime', 'maintenance', 'workorder', 'faults'],
  supervisor: ['ack', 'note', 'call', 'downtime', 'maintenance', 'workorder', 'assign', 'faults', 'boardEdit', 'reports'],
  engineer: ['ack', 'note', 'call', 'downtime', 'maintenance', 'workorder', 'assign', 'faults', 'boardEdit', 'reports', 'engineering', 'plcWrite'],
  manager: ['note', 'reports'],
};
const ALL = [...new Set(Object.values(CAN).flat())];
/** The board's pages, and those each role sees unless the setup page says otherwise */
const PAGES = ['andon', 'machines', 'io', 'drives', 'risk', 'oee', 'work', 'eng'];
const PAGE_LABELS = { andon: 'Andon', machines: 'Machines', io: 'I/O', drives: 'Drives', risk: 'Risk', oee: 'OEE', work: 'Work', eng: 'Engineering' };
const DEFAULT_PAGES = {
  operator: ['andon', 'machines'],
  technician: ['andon', 'machines', 'io', 'drives', 'risk', 'work'],
  supervisor: ['andon', 'machines', 'io', 'drives', 'risk', 'oee', 'work'],
  engineer: PAGES,
  manager: ['andon', 'machines', 'risk', 'oee', 'work'],
};
const EVENTS = ['error', 'stuck', 'plcStopped', 'drive', 'slower', 'call', 'workorder', 'recovered', 'escalated'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** "Mon-Fri", "Sat,Sun", "Mon" -> day numbers (0 Sunday); empty: every day */
function daysOf(text) {
  const s = String(text ?? '').trim().toLowerCase();
  if (!s) return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set();
  for (const part of s.split(/\s*,\s*/)) {
    const [a, b] = part.split(/\s*-\s*/).map((x) => DAYS.indexOf(x.slice(0, 3)));
    if (a < 0 || (b !== undefined && b < 0)) throw new Error(`"${text}": days such as Mon-Fri or Sat,Sun`);
    if (b === undefined) out.add(a);
    else for (let d = a; ; d = (d + 1) % 7) {
      out.add(d);
      if (d === b) break;
    }
  }
  return [...out].sort();
}
const minutesOf = (t) => {
  const m = /^(\d{1,2}):(\d\d)$/.exec(String(t ?? '').trim());
  if (!m || Number(m[1]) > 24 || Number(m[2]) > 59) throw new Error(`"${t}": a time such as 06:00`);
  return Number(m[1]) * 60 + Number(m[2]);
};

/** config.json's roles, checked (throws with a message for the setup page) */
function checkRoles(r, filterIds = []) {
  if (r == null) return null;
  const role = (x, where) => {
    const v = String(x ?? '').trim();
    if (v && !ROLES.includes(v)) throw new Error(`${where}: one of ${ROLES.join(', ')}`);
    return v;
  };
  const users = {};
  for (const [u, x] of Object.entries(r.users ?? {})) {
    const name = String(u).trim().toLowerCase();
    if (!name || name.length > 120) continue;
    const v = role(x, `The role of ${u}`);
    if (v) users[name] = v;
  }
  const groups = {};
  for (const [g, x] of Object.entries(r.groups ?? {})) {
    const v = role(x, `The role of the group ${g}`);
    if (String(g).trim() && v) groups[String(g).trim()] = v;
  }
  const startPages = {};
  for (const [k, id] of Object.entries(r.startPages ?? {})) {
    role(k, 'A start page');
    if (id && (!filterIds.length || filterIds.includes(String(id)))) startPages[k] = String(id);
  }
  // (the pages a role sees: kept only where they differ from its defaults)
  const pages = {};
  for (const [k, list] of Object.entries(r.pages ?? {})) {
    if (!role(k, 'Pages')) continue;
    const l = PAGES.filter((p) => (Array.isArray(list) ? list : []).includes(p));
    if (!l.length) throw new Error(`${LABELS[k]}: at least one page of the board`);
    if (l.join() !== DEFAULT_PAGES[k].join()) pages[k] = l;
  }
  const notify = (Array.isArray(r.notify) ? r.notify : []).map((n, i) => {
    const where = `Notification ${i + 1}`;
    const rl = role(n?.role, `${where}: its role`);
    if (!rl) throw new Error(`${where}: choose its role`);
    const webhook = String(n?.webhook ?? '').trim();
    if (!/^https?:\/\/\S+$/i.test(webhook)) throw new Error(`${where}: the webhook is an http(s) URL`);
    const events = (Array.isArray(n?.events) && n.events.length ? n.events : ['error', 'stuck', 'plcStopped', 'drive', 'call']).filter((e) => EVENTS.includes(e));
    const onCall = (Array.isArray(n?.onCall) ? n.onCall : []).filter((o) => o && String(o.name ?? '').trim()).map((o) => {
      daysOf(o.days);
      minutesOf(o.from || '00:00');
      minutesOf(o.to || '24:00');
      return { name: String(o.name).trim().slice(0, 60), days: String(o.days ?? '').trim(), from: o.from || '00:00', to: o.to || '24:00' };
    });
    return { role: rl, webhook, format: ['teams', 'slack', 'json'].includes(n?.format) ? n.format : 'teams', events, onCall };
  });
  return { users, groups, default: role(r.default, 'The default role'), startPages, pages, notify };
}

/** Who is on call now in a notification's schedule (several: all of them) */
function onCallNow(onCall, now = new Date()) {
  const day = now.getDay();
  const min = now.getHours() * 60 + now.getMinutes();
  return (onCall ?? [])
    .filter((o) => {
      const from = minutesOf(o.from || '00:00');
      const to = minutesOf(o.to || '24:00');
      const days = daysOf(o.days);
      // (overnight: 22:00 to 06:00 is the evening of its days and the morning after)
      if (from <= to) return days.includes(day) && min >= from && min < to;
      return (days.includes(day) && min >= from) || (days.includes((day + 6) % 7) && min < to);
    })
    .map((o) => o.name);
}

function createRoles({ getConfig, postWebhook, log }) {
  const conf = () => getConfig().roles ?? null;
  /** A user's role (null: roles are off on this gateway, or none for this user) */
  const roleOf = (user, groups = []) => {
    const r = conf();
    if (!r) return null;
    const u = String(user ?? '').toLowerCase();
    if (r.users?.[u]) return r.users[u];
    for (const g of groups) if (r.groups?.[g]) return r.groups[g];
    return r.default || null;
  };
  return {
    roleOf,
    /** What the user may do: every capability with roles off; a display (view-only token) nothing */
    can(user, groups, viewOnly) {
      if (viewOnly) return [];
      if (!conf()) return ALL;
      const role = roleOf(user, groups);
      return role ? CAN[role] : [];
    },
    enabled: () => !!conf(),
    startPage: (role) => (role ? conf()?.startPages?.[role] ?? null : null),
    /** The board's pages a role sees (null: every page its capabilities allow) */
    pagesOf: (role) => (role && conf() ? conf().pages?.[role] ?? DEFAULT_PAGES[role] ?? null : null),
    /** A new alert or call: posted to the roles that want it, with who is on call */
    notify(event) {
      const r = conf();
      if (!r?.notify?.length || event.muted) return;
      const kind = event.escalatedAt && !event.ack ? 'escalated' : event.event;
      for (const n of r.notify) {
        if (!n.events.includes(kind)) continue;
        const who = onCallNow(n.onCall);
        const text = `${event.text}${who.length ? ` · on call (${LABELS[n.role] ?? n.role}): ${who.join(', ')}` : ''}`;
        void postWebhook(n.webhook, n.format, { ...event, role: n.role, onCall: who, text }, log);
      }
    },
  };
}

module.exports = { createRoles, checkRoles, onCallNow, daysOf, ROLES, LABELS, CAN, EVENTS, PAGES, PAGE_LABELS, DEFAULT_PAGES };
