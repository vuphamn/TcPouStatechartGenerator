// Roles: who may do what on the gateway, which board page each one starts on, and who is told about what.
// config.json "roles" (the setup page's Roles edits it); without it, everyone signed in may do everything (as before:
// writeUsers and boardEditors still apply), and a view-only token is a display.
//   "roles": {
//     "users":  { "ann": "operator", "bob@acme.com": "technician" },      a user (a token's name, a company sign-in)
//     "groups": { "Maintenance": "technician" },                          a company sign-in's group (or app role)
//     "default": "operator",                                              everyone else signed in ("" or none: nothing)
//     "startPages": { "operator": "<saved filter id>" },                  the board's page for a role (a saved filter)
//     "pages": { "operator": ["andon", "machines"] },                     the board's pages a role sees (else its defaults)
//     "languages": { "operator": "es" },                                  the board's language a role starts in (en, es)
//     "notify": [{ "role": "technician", "webhook": "https://…", "format": "teams", "events": ["error", "stuck", "drive",
//                 "call", "plcStopped"], "onCall": [{ "name": "Bob", "days": "Mon-Fri", "from": "06:00", "to": "14:00" }] },
//                { "role": "technician", "channel": "sms", "to": "+15551234567", "events": ["error"], "onCall": [{ "name":
//                  "Bob", "days": "Mon-Fri", "from": "06:00", "to": "14:00", "contact": "+15557654321" }] }]
//     (a channel: "webhook" (Teams, Slack, JSON), "email" or "sms" (channels.cjs; config.smtp, config.sms); with an
//     on-call schedule whose people have a contact, only those on call now are emailed or texted, else its "to")
//   }
const { emailsOf, phonesOf } = require('./channels.cjs');
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
const PAGES = ['andon', 'machines', 'io', 'drives', 'risk', 'oee', 'work', 'eng', 'sites'];
const PAGE_LABELS = { andon: 'Andon', machines: 'Machines', io: 'I/O', drives: 'Drives', risk: 'Risk', oee: 'OEE', work: 'Work', eng: 'Engineering', sites: 'Sites' };
/** The board's language each role starts in, unless the setup page says otherwise (a viewer can switch it) */
const LANGS = ['en', 'es'];
const DEFAULT_LANGS = { operator: 'es' };
const DEFAULT_PAGES = {
  operator: ['andon', 'machines'],
  technician: ['andon', 'machines', 'io', 'drives', 'risk', 'work'],
  supervisor: ['andon', 'machines', 'io', 'drives', 'risk', 'oee', 'work', 'sites'],
  engineer: PAGES,
  manager: ['andon', 'machines', 'risk', 'oee', 'work', 'sites'],
};
const EVENTS = ['error', 'stuck', 'plcStopped', 'drive', 'slower', 'call', 'workorder', 'handover', 'parts', 'change', 'anomaly', 'cert', 'recovered', 'escalated'];
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
  const languages = {};
  for (const [k, l] of Object.entries(r.languages ?? {})) {
    if (!role(k, 'A language')) continue;
    if (!LANGS.includes(l)) throw new Error(`${LABELS[k]}: a language of ${LANGS.join(', ')}`);
    if (l !== (DEFAULT_LANGS[k] ?? 'en')) languages[k] = l;
  }
  const notify = (Array.isArray(r.notify) ? r.notify : []).map((n, i) => {
    const where = `Notification ${i + 1}`;
    const rl = role(n?.role, `${where}: its role`);
    if (!rl) throw new Error(`${where}: choose its role`);
    const channel = ['email', 'sms'].includes(n?.channel) ? n.channel : 'webhook';
    const webhook = String(n?.webhook ?? '').trim();
    let to = [];
    if (channel === 'webhook' && !/^https?:\/\/\S+$/i.test(webhook)) throw new Error(`${where}: the webhook is an http(s) URL`);
    if (channel === 'email') to = emailsOf(Array.isArray(n?.to) ? n.to.join(',') : n?.to);
    if (channel === 'sms') to = phonesOf(Array.isArray(n?.to) ? n.to.join(',') : n?.to);
    const events = (Array.isArray(n?.events) && n.events.length ? n.events : ['error', 'stuck', 'plcStopped', 'drive', 'call']).filter((e) => EVENTS.includes(e));
    const onCall = (Array.isArray(n?.onCall) ? n.onCall : []).filter((o) => o && String(o.name ?? '').trim()).map((o) => {
      daysOf(o.days);
      minutesOf(o.from || '00:00');
      minutesOf(o.to || '24:00');
      const contact = String(o.contact ?? '').trim();
      if (contact && channel === 'email') emailsOf(contact);
      if (contact && channel === 'sms') phonesOf(contact);
      return { name: String(o.name).trim().slice(0, 60), days: String(o.days ?? '').trim(), from: o.from || '00:00', to: o.to || '24:00', ...(contact ? { contact: channel === 'sms' ? phonesOf(contact)[0] : contact } : {}) };
    });
    if (channel !== 'webhook' && !to.length && !onCall.some((o) => o.contact)) throw new Error(`${where}: who is ${channel === 'email' ? 'emailed' : 'texted'} (its addresses, or contacts in its on-call schedule)`);
    return channel === 'webhook' ? { role: rl, webhook, format: ['teams', 'slack', 'json'].includes(n?.format) ? n.format : 'teams', events, onCall } : { role: rl, channel, to, events, onCall };
  });
  return { users, groups, default: role(r.default, 'The default role'), startPages, pages, languages, notify };
}

/** Who is on call now in a notification's schedule (several: all of them): their names */
function onCallNow(onCall, now = new Date()) {
  return onCallEntries(onCall, now).map((o) => o.name);
}
/** … their entries (name, contact) */
function onCallEntries(onCall, now = new Date()) {
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
    });
}

function createRoles({ getConfig, postWebhook, sendEmail, sendSms, log }) {
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
    /** The board's language a role starts in (null: roles off or no role: the viewer's browser decides) */
    langOf: (role) => (role && conf() ? conf().languages?.[role] ?? DEFAULT_LANGS[role] ?? 'en' : null),
    pagesOf: (role) => (role && conf() ? conf().pages?.[role] ?? DEFAULT_PAGES[role] ?? null : null),
    /** A new alert or call: posted to the roles that want it, with who is on call */
    notify(event) {
      const r = conf();
      if (!r?.notify?.length || event.muted) return;
      const kind = event.escalatedAt && !event.ack ? 'escalated' : event.event;
      for (const n of r.notify) {
        if (!n.events.includes(kind)) continue;
        const on = onCallEntries(n.onCall);
        const who = on.map((o) => o.name);
        const text = `${event.text}${who.length ? ` · on call (${LABELS[n.role] ?? n.role}): ${who.join(', ')}` : ''}`;
        if (!n.channel || n.channel === 'webhook') {
          void postWebhook(n.webhook, n.format, { ...event, role: n.role, onCall: who, text }, log);
          continue;
        }
        // (email, SMS: those on call now with a contact, else the channel's own)
        const contacts = on.map((o) => o.contact).filter(Boolean);
        // (its "to" as saved, a list; or as written in config.json by hand, "a@b.com, c@d.com")
        const own = Array.isArray(n.to) ? n.to : String(n.to ?? '').split(n.channel === 'email' ? /[\s,;]+/ : /[,;]+/).map((x) => x.trim()).filter(Boolean);
        const to = contacts.length ? contacts : own;
        if (!to.length) continue;
        const subject = `${event.plcName ? `${event.plcName}: ` : ''}${kind === 'escalated' ? 'escalated: ' : ''}${String(event.text ?? '').replace(/^[^:]*:\s*/, '').slice(0, 90)}`;
        const send = n.channel === 'email' ? sendEmail?.({ to, subject, text: `${text}\n\n${event.at ?? ''}\nKval MachineScope gateway` }) : sendSms?.({ to, text: text.slice(0, 300) });
        void Promise.resolve(send).catch((err) => log(`roles: ${n.channel} to ${to.join(', ')}: ${err.message}`));
      }
    },
  };
}

module.exports = { createRoles, checkRoles, onCallNow, onCallEntries, daysOf, ROLES, LABELS, CAN, EVENTS, PAGES, PAGE_LABELS, DEFAULT_PAGES, DEFAULT_LANGS };
