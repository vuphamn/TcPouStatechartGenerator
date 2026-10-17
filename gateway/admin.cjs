// The gateway's setup page (/admin): find the PLCs on the network and put them in config.json, test a PLC's
// connection, create and revoke access tokens. Only from the gateway machine itself (or the addresses in
// config.admin.allowFrom); "admin": { "enabled": false } turns it off.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const NETID = /^(\d{1,3}\.){5}\d{1,3}$/;
const HOST = /^([A-Za-z0-9-]{1,63}\.)*[A-Za-z0-9-]{1,63}(:\d{1,5})?$/;
const validNetId = (s) => typeof s === 'string' && NETID.test(s) && s.split('.').every((n) => Number(n) <= 255);

function localHostNames(config) {
  const names = new Set(['localhost', '127.0.0.1', '[::1]', os.hostname().toLowerCase()]);
  for (const a of Object.values(os.networkInterfaces()).flat()) if (a) names.add(a.family === 'IPv6' ? `[${a.address}]` : a.address);
  for (const h of config.admin?.hosts ?? []) names.add(String(h).toLowerCase());
  return names;
}

/** The PLC list from the page, checked; throws with a message for the page */
function checkPlcs(list) {
  if (!Array.isArray(list) || list.length > 200) throw new Error('A list of PLCs is expected');
  const ids = new Set();
  return list.map((p, i) => {
    const row = `PLC ${i + 1}`;
    const id = String(p?.id ?? '').trim();
    const name = String(p?.name ?? '').trim().slice(0, 80) || id;
    const netId = String(p?.netId ?? '').trim();
    const ip = String(p?.ip ?? '').trim();
    const port = Number(p?.port ?? 851);
    if (!ID.test(id)) throw new Error(`${row}: the id is letters, digits, - or _ (it is in the web app's saved choice)`);
    if (ids.has(id.toLowerCase())) throw new Error(`${row}: the id "${id}" is used twice`);
    ids.add(id.toLowerCase());
    if (!validNetId(netId)) throw new Error(`${name}: the AMS NetId is six numbers such as 192.168.1.20.1.1`);
    if (ip && !HOST.test(ip)) throw new Error(`${name}: the address is an IP address or host name (host:port for a forwarded ADS port)`);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name}: the ADS port is a number (851 for the first PLC)`);
    const out = { id, name, netId, ip: ip || netId.split('.').slice(0, 4).join('.'), port };
    if (p?.localNetId) {
      if (!validNetId(p.localNetId)) throw new Error(`${name}: the gateway's AMS NetId for it is six numbers`);
      out.localNetId = p.localNetId;
    }
    return out;
  });
}

/** The Monitoring section's settings, checked (throws with a message): each kept as config.json has it, merged */
function checkMonitoring(body, plcIds, current) {
  const num = (x, min, max, def) => {
    if (x === '' || x == null) return def;
    const n = Number(x);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${x}: a number from ${min} to ${max}`);
    return n;
  };
  const plcList = (x) => {
    const l = (Array.isArray(x) ? x : []).filter((p) => plcIds.includes(p));
    return l.length && l.length < plcIds.length ? l : undefined;
  };
  const url = (x, what) => {
    const s = String(x ?? '').trim();
    if (s && !/^https?:[/][/][^ ]+$/i.test(s)) throw new Error(`${what}: an http(s) address`);
    return s || undefined;
  };
  const fmt = (x) => (['teams', 'slack', 'json'].includes(x) ? x : 'teams');
  const text = (x, n) => String(x ?? '').trim().slice(0, n);
  const lines = (x, n, len) => (Array.isArray(x) ? x : String(x ?? '').split(String.fromCharCode(10))).map((s) => text(s, len)).filter(Boolean).slice(0, n);
  // (a symbol path: names joined by dots, each maybe with its array index: MAIN.aDoors[2].bClosed)
  const sym = (x) => !!String(x ?? '') && String(x).split('.').every((part) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part.split('[')[0]));
  const b = body ?? {};
  const d = b.drives ?? {};
  const drives = { ...(current.drives ?? {}), enabled: d.enabled !== false, everySeconds: num(d.everySeconds, 5, 3600, 30), slowEveryMinutes: num(d.slowEveryMinutes, 1, 1440, 10), keepDays: num(d.keepDays, 2, 3650, 90), settingsEveryHours: num(d.settingsEveryHours, 1, 720, undefined), plcs: plcList(d.plcs), webhook: url(d.webhook, 'The drives\' webhook'), format: fmt(d.format) };
  // (each PLC's mains signal: a BOOL symbol, TRUE its mains on; NOT x: TRUE off)
  if (d.mains !== undefined) {
    const out = {};
    for (const [id, x] of Object.entries(d.mains && typeof d.mains === 'object' ? d.mains : {})) {
      const v = text(x, 200);
      if (!v) continue;
      if (!sym(v.replace(/^NOT +/i, ''))) throw new Error(`The mains signal of ${id}: a PLC symbol (MAIN.bMainsOn, NOT GVL.bEStop)`);
      out[String(id)] = v;
    }
    drives.mains = Object.keys(out).length ? out : undefined;
  }
  const L = d.limits ?? {};
  drives.limits = {
    heatsinkRise: { watch: num(L.heatsinkRise?.watch, 1, 50, 5), warn: num(L.heatsinkRise?.warn, 1, 50, 8) },
    currentRise: { watch: num(L.currentRise?.watch, 1, 200, 10), warn: num(L.currentRise?.warn, 1, 200, 20) },
    utilisation: { warn: num(L.utilisation?.warn, 10, 100, 80), alarm: num(L.utilisation?.alarm, 10, 100, 95) },
    peerHotter: { watch: num(L.peerHotter?.watch, 1, 50, 6), warn: num(L.peerHotter?.warn, 1, 50, 10) },
  };
  const f = b.faults ?? {};
  const signals = {};
  for (const [plc, list] of Object.entries(f.signals ?? {})) {
    if (!plcIds.includes(plc)) continue;
    const l = lines(list, 20, 200);
    if (l.some((p) => !sym(p))) throw new Error(`The fault records' signals of ${plc}: symbol paths such as MAIN.fbDoor.bClosed`);
    if (l.length) signals[plc] = l;
  }
  if (f.root && !sym(f.root)) throw new Error('The fault recorder\'s root: a symbol path such as MAIN.mainStateMachine');
  const faults = { ...(current.faults ?? {}), enabled: f.enabled !== false, preSeconds: num(f.preSeconds, 5, 600, 60), postSeconds: num(f.postSeconds, 5, 600, 60), keepDays: num(f.keepDays, 1, 3650, 30), root: text(f.root, 200) || undefined, plcs: plcList(f.plcs), signals };
  const fl = b.fleet ?? {};
  const fleet = { ...(current.fleet ?? {}), enabled: fl.enabled !== false, everySeconds: num(fl.everySeconds, 10, 3600, 60), plcs: plcList(fl.plcs), limits: { crcWatch: num(fl.limits?.crcWatch, 1, 1e6, 5), crcWarn: num(fl.limits?.crcWarn, 1, 1e6, 50), etaDays: num(fl.limits?.etaDays, 1, 3650, 90), etaWarnDays: num(fl.limits?.etaWarnDays, 1, 3650, 14), faultsWatch: num(fl.limits?.faultsWatch, 1, 1e4, 5), faultsWarn: num(fl.limits?.faultsWarn, 1, 1e4, 10) } };
  const ps = b.projectSync ?? {};
  const projectSync = { ...(current.projectSync ?? {}), enabled: ps.enabled !== false, everyMinutes: num(ps.everyMinutes, 1, 1440, 10), keep: num(ps.keep, 1, 200, 20), plcs: plcList(ps.plcs) };
  const o = b.oee ?? {};
  const machines = (Array.isArray(o.machines) ? o.machines : []).filter((m) => m && (m.machine || m.type)).map((m, i) => {
    if (!plcIds.includes(m.plc)) throw new Error(`OEE machine ${i + 1}: one of the gateway's PLCs`);
    if (m.machine && !sym(m.machine)) throw new Error(`OEE machine ${i + 1}: its machine is a symbol path`);
    if (!text(m.cycleState, 80)) throw new Error(`OEE machine ${i + 1}: its cycle state (the state each cycle goes into)`);
    for (const k of ['goodVar', 'badVar']) if (m[k] && !sym(m[k])) throw new Error(`OEE machine ${i + 1}: ${k} is a symbol path`);
    return { plc: m.plc, ...(m.machine ? { machine: text(m.machine, 200) } : { type: text(m.type, 80) }), cycleState: text(m.cycleState, 80), idealCycleSec: num(m.idealCycleSec, 0.1, 86400, 60), ...(m.goodVar ? { goodVar: text(m.goodVar, 200) } : {}), ...(m.badVar ? { badVar: text(m.badVar, 200) } : {}) };
  });
  const w = o.weekly ?? {};
  const weekly = url(w.webhook, 'The weekly summary\'s webhook') ? { day: text(w.day, 3) || 'Mon', at: /^[0-2][0-9]:[0-5][0-9]$/.test(w.at) ? w.at : '07:00', webhook: url(w.webhook, ''), format: fmt(w.format), link: url(w.link, 'Its link') } : undefined;
  // (each PLC's product variable, and each product's ideal cycle: a line "Door 36 = 40")
  let products = current.oee?.products;
  if (o.products !== undefined) {
    products = {};
    for (const [id, p] of Object.entries(o.products && typeof o.products === 'object' ? o.products : {})) {
      if (!plcIds.includes(id)) continue;
      const v = text(p?.var, 200);
      if (!v) continue;
      if (!sym(v)) throw new Error(`The product variable of ${id}: a PLC symbol (GVL.sRecipe)`);
      const ideal = {};
      for (const l of lines(p.idealLines ?? Object.entries(p.idealCycleSec ?? {}).map(([k, x]) => k + ' = ' + x), 200, 120)) {
        const at = l.lastIndexOf('=');
        const n = Number(l.slice(at + 1));
        if (at < 1 || !(n > 0)) throw new Error(`An ideal cycle: its product, =, its seconds (${l.slice(0, 40)})`);
        ideal[text(l.slice(0, at), 80)] = n;
      }
      products[id] = { var: v, ...(Object.keys(ideal).length ? { idealCycleSec: ideal } : {}) };
    }
    if (!Object.keys(products).length) products = undefined;
  }
  const oee = { ...(current.oee ?? {}), reasons: lines(o.reasons, 40, 60), reasonAfterMin: num(o.reasonAfterMin, 0, 240, 2), machines, weekly, products };
  if (!oee.reasons.length) delete oee.reasons;
  const a = b.andon ?? {};
  const steps = {};
  for (const l of lines(a.steps, 500, 400)) {
    const i = l.indexOf('=');
    if (i > 0) steps[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  const andon = { ...(current.andon ?? {}), steps, callReasons: lines(a.callReasons, 20, 60) };
  if (!andon.callReasons.length) delete andon.callReasons;
  // (checklist templates: one a line, its name, a colon, its steps by semicolons; sign-off counted on the board)
  const checklists = lines(b.workorders?.checklistLines ?? (current.workorders?.checklists ?? []).map((c) => c.name + ': ' + c.items.join('; ')), 50, 2000).map((l) => {
    const at = l.indexOf(':');
    const name = text(at > 0 ? l.slice(0, at) : l, 80);
    const items = (at > 0 ? l.slice(at + 1) : '').split(';').map((x) => text(x, 200)).filter(Boolean).slice(0, 40);
    if (!name || !items.length) throw new Error(`A checklist: its name, a colon, its steps by semicolons (${l.slice(0, 40)})`);
    return { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'checklist', name, items };
  });
  const workorders = { ...(current.workorders ?? {}), fromCalls: b.workorders?.fromCalls !== false, signOff: b.workorders?.signOff === true || undefined, checklists: checklists.length ? checklists : undefined };
  delete workorders.checklistLines;
  const clean = (x) => JSON.parse(JSON.stringify(x));
  // (energy meters: per PLC, one a line: its name, =, its variable, its unit, and for which machines (by commas))
  const e = b.energy ?? {};
  let energy = current.energy;
  if (b.energy !== undefined) {
    let meters = (current.energy?.meters ?? []).filter((m) => plcIds.includes(m.plc));
    if (e.meterLines && typeof e.meterLines === 'object') {
      meters = [];
      for (const [id, ls] of Object.entries(e.meterLines)) {
        if (!plcIds.includes(id)) continue;
        for (const l of lines(ls, 50, 400)) {
          const at = l.indexOf('=');
          const words = l.slice(at + 1).trim().split(' ').filter(Boolean);
          const [v, unit, kw, ...rest] = words;
          if (at < 1 || !sym(v) || !['wh', 'kwh', 'mwh', 'w', 'kw', 'mw'].includes(String(unit).toLowerCase())) throw new Error(`A meter: its name, =, its variable, its unit (Wh, kWh, MWh, W, kW) (${l.slice(0, 50)})`);
          const machines = String(kw).toLowerCase() === 'for' ? rest.join(' ').split(',').map((x) => x.trim()).filter(Boolean) : [];
          meters.push({ plc: id, name: text(l.slice(0, at), 80), var: v, unit, ...(machines.length ? { machines } : {}) });
        }
      }
    }
    const price = e.price === '' || e.price == null ? undefined : num(e.price, 0, 1000, undefined);
    energy = meters.length || price ? { meters, ...(price ? { price } : {}), ...(text(e.currency, 8) ? { currency: text(e.currency, 8) } : {}) } : undefined;
  }
  return { drives: clean(drives), faults: clean(faults), fleet: clean(fleet), projectSync: clean(projectSync), oee: clean(oee), andon: clean(andon), workorders: clean(workorders), energy: energy && clean(energy) };
}

/** A saved operator board, checked */
function checkBoard(b, i, plcIds) {
  const where = `Board ${i + 1}`;
  const id = String(b?.id ?? '').trim();
  if (!/^[\w-]{1,40}$/.test(id)) throw new Error(`${where}: the id (in the address, ?board=<id>) is letters, digits, - or _`);
  const plcs = Array.isArray(b?.plcs) ? b.plcs.filter((p) => plcIds.includes(p)) : [];
  const root = String(b?.root ?? 'MAIN.mainStateMachine').trim();
  if (!/^[A-Za-z_]\w*(\[-?\d+\])*(\.[A-Za-z_]\w*(\[-?\d+\])*)*$/.test(root)) throw new Error(`${where}: the root is a symbol path such as MAIN.mainStateMachine`);
  const stuck = b?.stuck == null || b.stuck === '' ? null : Number(b.stuck);
  if (stuck !== null && (!Number.isFinite(stuck) || stuck < 1)) throw new Error(`${where}: "stuck after" is at least 1 s`);
  return { id, title: String(b?.title ?? '').trim().slice(0, 80) || id, plcs, root, stuck };
}

/** A token's expiry: a date alone is the end of that day (here); null: none */
function expiryOf(x) {
  if (!x) return null;
  const v = String(x);
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) ? new Date(v + 'T23:59:59') : new Date(v);
}

function createAdmin({ configPath, getConfig, applyConfig, plcStatus, testPlc, checkPlc, discover, localNetworks, sha256, version, log, alerts, recordings, audit, reports, service, projects, load, roles, driveCheck, findMeters, health, plantSend, eventRelayStatus, eventLog, channels, sitesView, mqttReady, backup, restart, certs }) {
  // config.json read fresh and written whole (a temporary file renamed over it): other settings are kept as they are
  const update = (change) => {
    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    change(onDisk);
    const tmp = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(onDisk, null, 2) + '\n');
    fs.renameSync(tmp, configPath);
    applyConfig(onDisk);
    return onDisk;
  };

  const state = () => {
    const config = getConfig();
    return {
      version,
      configPath,
      host: os.hostname(),
      port: config.port ?? 8443,
      scheme: config.insecure && !config.tls ? 'http' : 'https',
      localNetId: config.localNetId ?? '',
      networks: localNetworks(),
      plcs: (config.plcs ?? []).map((p) => ({ ...p, status: plcStatus(p.id) })),
      tokens: (config.tokens ?? []).map((t) => ({ name: t.name, created: t.created ?? null, ...(t.view ? { view: true } : {}), expires: t.expires ?? null, plcs: Array.isArray(t.plcs) ? t.plcs : [], rotatedUntil: t.previous?.until && Date.parse(t.previous.until) > Date.now() ? t.previous.until : null })),
    };
  };

  const api = {
    'GET state': async () => state(),
    'POST scan': async (body) => {
      const addresses = (Array.isArray(body.addresses) ? body.addresses : []).map((a) => String(a).trim()).filter(Boolean);
      if (addresses.length > 64 || addresses.some((a) => !HOST.test(a) || a.includes(':'))) throw new Error('Addresses: IP addresses or host names, separated by commas');
      const result = await discover({ localNetId: getConfig().localNetId, addresses, broadcast: body.broadcast !== false && getConfig().discoveryBroadcast !== false, port: getConfig().discoveryPort ?? 48899 });
      log(`admin: network search, ${result.devices.length} TwinCAT device(s)`);
      return result;
    },
    // Check: why a PLC does not answer the gateway, step by step (read-only; the gateway's NetId)
    'POST check': async (body) => {
      const [plc] = checkPlcs([{ id: body.id || 'check', name: body.name || 'The PLC', netId: body.netId, ip: body.ip, port: body.port ?? 851, localNetId: body.localNetId || undefined }]);
      if (!checkPlc) throw new Error('Not available on this gateway');
      return checkPlc(plc);
    },
    'POST test': async (body) => {
      const [plc] = checkPlcs([{ id: body.id || 'test', name: body.name || 'The PLC', netId: body.netId, ip: body.ip, port: body.port ?? 851, localNetId: body.localNetId || undefined }]);
      return testPlc(plc, body.id);
    },
    'POST plcs': async (body) => {
      const plcs = checkPlcs(body.plcs);
      if (!validNetId(body.localNetId)) throw new Error('The gateway\'s AMS NetId is six numbers such as 192.168.1.5.1.1');
      update((c) => {
        c.localNetId = body.localNetId;
        c.plcs = plcs;
      });
      log(`admin: PLCs saved (${plcs.map((p) => p.id).join(', ') || 'none'}), gateway AMS NetId ${body.localNetId}`);
      return state();
    },
    'POST tokens': async (body) => {
      const name = String(body.name ?? '').trim();
      if (!/^[\w .@-]{1,60}$/.test(name)) throw new Error('A name for the token: letters, digits, space, . @ - or _');
      if ((getConfig().tokens ?? []).some((t) => t.name.toLowerCase() === name.toLowerCase())) throw new Error(`A token named "${name}" exists: revoke it first`);
      const token = crypto.randomBytes(24).toString('base64url');
      // (view only: a display, a TV by the line: the operator board, nothing else; its link carries it)
      const view = body.view === true;
      const ids = (getConfig().plcs ?? []).map((p) => p.id);
      const scope = (Array.isArray(body.plcs) ? body.plcs : []).map(String).filter((p) => ids.includes(p));
      const expires = expiryOf(body.expires);
      if (expires && (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now())) throw new Error('Its expiry: a date to come');
      update((c) => {
        c.tokens = [...(c.tokens ?? []), { name, sha256: sha256(token), created: new Date().toISOString(), ...(view ? { view: true } : {}), ...(expires ? { expires: expires.toISOString() } : {}), ...(scope.length ? { plcs: scope } : {}) }];
      });
      log(`admin: ${view ? 'view-only ' : ''}token "${name}" created`);
      audit?.add('setup page', 'token.create', { name, view, expires: expires?.toISOString() ?? null, plcs: scope });
      const s = state();
      return { name, token, view, ...(view ? { boardUrl: `${s.scheme}://${s.host}:${s.port}/?board&view=${token}` } : {}), state: s };
    },
    'GET alerts': async () => ({ rules: getConfig().alerts ?? [], status: alerts?.status() ?? [], plcs: (getConfig().plcs ?? []).map((p) => ({ id: p.id, name: p.name })) }),
    'POST alerts': async (body) => {
      if (!alerts) throw new Error('Alerts are not available');
      if (!Array.isArray(body.rules) || body.rules.length > 50) throw new Error('A list of alerts is expected');
      const ids = (getConfig().plcs ?? []).map((p) => p.id);
      const rules = body.rules.map((r, i) => alerts.checkRule(r, i, ids));
      if (new Set(rules.map((r) => r.id)).size !== rules.length) throw new Error('Two alerts have the same id');
      update((c) => {
        c.alerts = rules;
      });
      log(`admin: alerts saved (${rules.length})`);
      return { rules, status: alerts.status(), plcs: (getConfig().plcs ?? []).map((p) => ({ id: p.id, name: p.name })) };
    },
    'GET boards': async () => ({ boards: getConfig().boards ?? [], plcs: (getConfig().plcs ?? []).map((p) => ({ id: p.id, name: p.name })) }),
    'POST boards': async (body) => {
      if (!Array.isArray(body.boards) || body.boards.length > 50) throw new Error('A list of boards is expected');
      const ids = (getConfig().plcs ?? []).map((p) => p.id);
      const boards = body.boards.map((b, i) => checkBoard(b, i, ids));
      if (new Set(boards.map((b) => b.id.toLowerCase())).size !== boards.length) throw new Error('Two boards have the same id');
      update((c) => {
        c.boards = boards;
      });
      log(`admin: boards saved (${boards.map((b) => b.id).join(', ') || 'none'})`);
      return { boards, plcs: (getConfig().plcs ?? []).map((p) => ({ id: p.id, name: p.name })) };
    },
    'POST recordings/check': async (body) => {
      if (!recordings) throw new Error('Recordings are not available');
      return recordings.checkSlowerNow(String(body.id ?? ''));
    },
    // Audit log: search (text, time window), newest first
    'POST audit/search': async (body) => {
      const from = Number(body.from) || Date.now() - 7 * 86400000;
      const to = Number(body.to) || Date.now();
      return { events: audit ? audit.search({ from, to, q: String(body.q ?? '').slice(0, 200), limit: Math.min(5000, Number(body.limit) || 1000) }) : [] };
    },
    // Shift reports: the shifts, the webhook; a preview; sent now
    'GET reports': async () => ({ shifts: getConfig().shifts ?? [], reports: getConfig().reports ?? {} }),
    'POST reports': async (body) => {
      if (!reports) throw new Error('Reports are not available');
      const shifts = (Array.isArray(body.shifts) ? body.shifts : []).filter((x) => x && (x.name || x.from || x.to));
      reports.checkShifts(shifts);
      const webhook = String(body.reports?.webhook ?? '').trim() || null;
      if (webhook && !/^https?:\/\/\S+$/i.test(webhook)) throw new Error('The reports webhook is an http(s) URL (or empty)');
      const format = ['teams', 'slack', 'json'].includes(body.reports?.format) ? body.reports.format : 'teams';
      // (by email: to whom, when)
      const em = body.reports?.email ?? {};
      const to = String(Array.isArray(em.to) ? em.to.join(',') : em.to ?? '').split(/[\s,;]+/).filter(Boolean);
      for (const x of to) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) throw new Error(`"${x}": an email address`);
      if (to.length && !/^\d{1,2}:\d{2}$/.test(String(em.at || '07:00'))) throw new Error('The report email: its time, 07:00');
      update((c) => {
        c.shifts = shifts.map((x) => ({ name: String(x.name ?? '').trim().slice(0, 30), from: String(x.from).trim(), to: String(x.to).trim() }));
        c.reports = { webhook, format, ...(to.length ? { email: { to, when: ['shift', 'daily', 'weekly'].includes(em.when) ? em.when : 'daily', day: String(em.day || 'mon').slice(0, 3).toLowerCase(), at: String(em.at || '07:00') } } : {}) };
      });
      log(`admin: shifts and reports saved (${shifts.length} shift(s)${webhook ? ', webhook' : ''})`);
      return { shifts: getConfig().shifts ?? [], reports: getConfig().reports ?? {} };
    },
    'POST reports/email': async (body) => {
      if (!reports?.emailNow) throw new Error('Reports are not available');
      await reports.emailNow(['last', 'today', 'yesterday'].includes(body?.which) ? body.which : 'last');
      return { ok: true, message: 'Emailed' };
    },
    'POST reports/preview': async (body) => {
      if (!reports) throw new Error('Reports are not available');
      const r = reports.report(['last', 'today', 'yesterday'].includes(body.which) ? body.which : 'last');
      return { summary: r.summary, csv: r.csv };
    },
    'POST reports/send': async (body) => {
      if (!reports) throw new Error('Reports are not available');
      return reports.send(['last', 'today', 'yesterday'].includes(body.which) ? body.which : 'last');
    },
    // Run at startup (Windows): the startup task
    'GET service': async () => (service ? service.status() : { supported: false, message: 'Not available' }),
    'POST service/install': async () => service.install(),
    'POST service/remove': async () => service.remove(),
    'POST service/switch': async () => service.switchToTask(),
    // The PLCs' projects kept here (projectSync.cjs): their state; one checked now
    'GET projects': async () => (projects ? projects.list() : { enabled: false, plcs: [] }),
    // Roles: who has which, the default, groups, start pages, notifications (roles.cjs); null: roles off
    'GET roles': async () => ({ roles: getConfig().roles ?? null, labels: roles?.labels ?? {}, pages: roles?.pages ?? [], pageLabels: roles?.pageLabels ?? {}, pageDefaults: roles?.pageDefaults ?? {}, langDefaults: roles?.langDefaults ?? {}, filters: roles?.filters() ?? [], users: (getConfig().tokens ?? []).map((t) => ({ name: t.name, view: !!t.view })) }),
    'POST roles': async (body) => {
      const checked = body.roles == null ? null : roles.check(body.roles, (roles?.filters() ?? []).map((f) => f.id));
      update((c) => {
        if (checked) c.roles = checked;
        else delete c.roles;
      });
      log(`admin: roles ${checked ? `saved (${Object.keys(checked.users).length} user(s), ${Object.keys(checked.groups).length} group(s), default ${checked.default || 'none'}, ${checked.notify.length} notification(s))` : 'off'}`);
      audit?.add('setup page', 'roles', { on: !!checked });
      return { roles: checked };
    },
    // Monitoring: which monitors on which PLCs, and their settings (one Save)
    // Check a drive (drives.cjs, read only): a PLC's boxes of other makers; a box's profile read raw; one object
    // (the energy meters: a PLC's EL34xx boxes and the variables linked to them)
    'POST energy/find': async (body) => {
      if (!findMeters) throw new Error('Not on this gateway');
      return findMeters(String(body?.plc ?? ''));
    },
    'POST drivecheck': async (body) => {
      if (!driveCheck) throw new Error('Not on this gateway');
      const r = await driveCheck(body ?? {});
      if (body?.path) audit?.add('setup page', 'drive.check', { plc: body.plc, path: body.path, index: body.index ?? null });
      return r;
    },
    // TwinCAT logged events (eventlog.cjs): each PLC's kept; an export of the Logged Events window imported
    'GET eventlog': async () => ({ plcs: (getConfig().plcs ?? []).map((p) => ({ id: p.id, name: p.name })), stats: eventLog?.stats() ?? {}, live: getConfig().eventlog?.live ?? {}, relay: eventRelayStatus ? eventRelayStatus() : {} }),
    // (live: each PLC's FB_KvalEventRelay instance)
    'POST eventlog/live': async (body) => {
      const ids = (getConfig().plcs ?? []).map((p) => p.id);
      const live = {};
      for (const [id, p] of Object.entries(body?.live && typeof body.live === 'object' ? body.live : {})) {
        const v = String(p ?? '').trim();
        if (!v || !ids.includes(id)) continue;
        if (!/^[A-Za-z_][A-Za-z0-9_]*([.][A-Za-z_][A-Za-z0-9_]*)+$/.test(v)) throw new Error(`The relay of ${id}: its instance (MAIN.fbEventRelay)`);
        live[id] = v;
      }
      update((c) => { c.eventlog = { ...(c.eventlog ?? {}), live: Object.keys(live).length ? live : undefined }; });
      audit?.add('setup page', 'eventlog.live', { plcs: Object.keys(live) });
      return { ok: true, live };
    },
    'POST eventlog': async (body) => {
      if (!eventLog) throw new Error('Not on this gateway');
      if (!(getConfig().plcs ?? []).some((p) => p.id === body?.plc)) throw new Error('Choose its PLC');
      if (typeof body?.csv !== 'string' || !body.csv.trim()) throw new Error('No file: the CSV the Logged Events window exported');
      return eventLog.import(body.plc, body.csv, 'setup page');
    },
    // Email and SMS (channels.cjs): config.smtp, config.sms; their secrets never sent back (kept when left empty)
    'GET channels': async () => {
      const c = getConfig();
      const { pass, ...smtp } = c.smtp ?? {};
      const { authToken, ...sms } = c.sms ?? {};
      return { smtp: { ...smtp, hasPass: !!pass }, sms: { ...sms, hasToken: !!authToken } };
    },
    'POST channels': async (body) => {
      const s = body?.smtp ?? {};
      const m = body?.sms ?? {};
      const text = (x, n) => String(x ?? '').trim().slice(0, n);
      await update((c) => {
        if (text(s.host, 200)) {
          const port = Number(s.port) || 587;
          if (port < 1 || port > 65535) throw new Error('The mail server: its port');
          c.smtp = { host: text(s.host, 200), port, secure: port === 465, user: text(s.user, 200), pass: s.pass ? String(s.pass) : c.smtp?.pass ?? '', from: text(s.from, 200), rejectUnauthorized: s.rejectUnauthorized !== false };
        } else delete c.smtp;
        if (m.provider === 'twilio') {
          if (!text(m.accountSid, 80) || !text(m.from, 30)) throw new Error('Twilio: its account SID and its From number');
          c.sms = { provider: 'twilio', accountSid: text(m.accountSid, 80), authToken: m.authToken ? String(m.authToken) : c.sms?.authToken ?? '', from: text(m.from, 30) };
        } else if (m.provider === 'http') {
          if (!/^https?:\/\/\S+$/i.test(text(m.url, 500))) throw new Error('The SMS provider: its URL, with {to} and {text}');
          c.sms = { provider: 'http', url: text(m.url, 500), method: m.method === 'GET' ? 'GET' : 'POST', body: text(m.body, 1000), ...(m.headers && typeof m.headers === 'object' ? { headers: m.headers } : {}) };
        } else delete c.sms;
      });
      audit?.add('setup page', 'channels', { smtp: !!getConfig().smtp, sms: getConfig().sms?.provider ?? null });
      return { ok: true };
    },
    'POST channelsTest': async (body) => {
      if (!channels) throw new Error('Not on this gateway');
      const c = getConfig();
      if (body?.kind === 'sms') {
        const to = String(body.to ?? '').replace(/[\s()-]/g, '');
        if (!/^\+?\d{6,15}$/.test(to)) throw new Error('A phone number to text (+15551234567)');
        await channels.sendSms(c.sms, { to: [to], text: 'Kval MachineScope: a test of the gateway\'s SMS' });
      } else {
        const to = String(body?.to ?? '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('An email address to write to');
        await channels.sendEmail(c.smtp, { to: [to], subject: 'Kval MachineScope: a test', text: 'A test of the gateway\'s email: its alerts will come like this.' });
      }
      return { ok: true };
    },
    // Other gateways (sites.cjs): config.sites; their tokens never sent back (kept when left empty)
    'GET sites': async () => ({ sites: (getConfig().sites ?? []).map(({ token, ...s }) => ({ ...s, hasToken: !!token })), status: sitesView ? sitesView() : [] }),
    // (the plant roll-up: its weekly email, its webhook; sent now)
    'GET plant': async () => ({ plantReport: getConfig().plantReport ?? {}, siteName: getConfig().siteName ?? '' }),
    'POST plant': async (body) => {
      const p = body?.plantReport ?? {};
      const to = String(Array.isArray(p.to) ? p.to.join(',') : p.to ?? '').split(/[,; ]+/).map((x) => x.trim()).filter(Boolean);
      for (const a of to) if (!/^[^@\s]+@[^@\s]+$/.test(a)) throw new Error(`Not an email address: ${a}`);
      const webhook = String(p.webhook ?? '').trim();
      if (webhook && !/^https?:\/\//i.test(webhook)) throw new Error('Its webhook: an http(s) address');
      const plantReport = { day: String(p.day || 'mon').slice(0, 3).toLowerCase(), at: /^[0-2][0-9]:[0-5][0-9]$/.test(String(p.at)) ? p.at : '07:00', ...(to.length ? { to } : {}), ...(webhook ? { webhook, format: ['teams', 'slack', 'json'].includes(p.format) ? p.format : 'teams' } : {}), ...(String(p.link ?? '').trim() ? { link: String(p.link).trim().slice(0, 300) } : {}) };
      const siteName = String(body?.siteName ?? '').trim().slice(0, 80);
      update((c) => { c.plantReport = to.length || webhook ? plantReport : undefined; c.siteName = siteName || undefined; });
      audit?.add('setup page', 'plant.report', { to: to.length, webhook: !!webhook });
      return { ok: true };
    },
    'POST plant/send': async () => {
      if (!plantSend) throw new Error('Not on this gateway');
      return plantSend('setup page');
    },
    'POST sites': async (body) => {
      const list = Array.isArray(body?.sites) ? body.sites : [];
      const ids = new Set();
      await update((c) => {
        const old = c.sites ?? [];
        c.sites = list.map((s, i) => {
          const name = String(s?.name ?? '').trim().slice(0, 80);
          const url = String(s?.url ?? '').trim().replace(/\/+$/, '');
          if (!name || !/^https?:\/\/[^\s/]+(:\d+)?$/i.test(url)) throw new Error(`Gateway ${i + 1}: its name and its address (https://gw-line4:8443)`);
          const id = String(s?.id || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `site${i + 1}`;
          if (ids.has(id)) throw new Error(`Gateway ${i + 1}: another one has its name`);
          ids.add(id);
          const token = s?.token ? String(s.token).trim() : old.find((o) => o.id === id)?.token ?? '';
          if (!token) throw new Error(`${name}: a view-only token of that gateway`);
          return { id, name, url, token, ...(s?.root ? { root: String(s.root).trim() } : {}), ...(s?.insecureTls ? { insecureTls: true } : {}) };
        });
        if (!c.sites.length) delete c.sites;
      });
      audit?.add('setup page', 'sites', { count: list.length });
      return { ok: true };
    },
    // Exports: the API, MQTT, the CMMS hook (config.api, config.mqtt, config.cmms); the MQTT password never sent back
    'GET exports': async () => {
      const c = getConfig();
      const { password, ...mqtt } = c.mqtt ?? {};
      return { api: { enabled: c.api?.enabled !== false }, mqtt: { ...mqtt, hasPassword: !!password }, mqttReady: mqttReady ? mqttReady() : false, cmms: c.cmms ?? {}, publicUrl: c.publicUrl ?? '' };
    },
    'POST exports': async (body) => {
      const m = body?.mqtt ?? {};
      const k = body?.cmms ?? {};
      const text = (x, n) => String(x ?? '').trim().slice(0, n);
      await update((c) => {
        c.api = { enabled: body?.api?.enabled !== false };
        if (text(m.url, 300)) {
          if (!/^mqtts?:\/\/[^\s/]+/i.test(text(m.url, 300))) throw new Error('MQTT: its broker (mqtt://broker:1883 or mqtts://broker:8883)');
          c.mqtt = { url: text(m.url, 300), username: text(m.username, 200), password: m.password ? String(m.password) : c.mqtt?.password ?? '', prefix: text(m.prefix, 120) || 'kval/machinescope', ...(m.insecureTls ? { insecureTls: true } : {}) };
        } else delete c.mqtt;
        if (text(k.url, 500)) {
          if (!/^https?:\/\/\S+$/i.test(text(k.url, 500)) || (text(k.doneUrl, 500) && !/^https?:\/\/\S+$/i.test(text(k.doneUrl, 500)))) throw new Error('The CMMS: its addresses (http or https)');
          let headers;
          if (text(k.headers, 2000)) {
            try {
              headers = typeof k.headers === 'string' ? JSON.parse(k.headers) : k.headers;
            } catch {
              throw new Error('The CMMS: its headers, as JSON ({"Authorization": "Basic …"})');
            }
          }
          c.cmms = { url: text(k.url, 500), method: ['POST', 'PUT'].includes(k.method) ? k.method : 'POST', body: text(k.body, 4000), doneUrl: text(k.doneUrl, 500), doneMethod: ['POST', 'PUT', 'PATCH'].includes(k.doneMethod) ? k.doneMethod : 'POST', doneBody: text(k.doneBody, 4000), idPath: text(k.idPath, 120), ...(headers ? { headers } : {}) };
        } else delete c.cmms;
        if (text(body?.publicUrl, 300)) c.publicUrl = text(body.publicUrl, 300);
        else delete c.publicUrl;
      });
      audit?.add('setup page', 'exports', { api: body?.api?.enabled !== false, mqtt: !!getConfig().mqtt, cmms: !!getConfig().cmms });
      return { ok: true };
    },
    // Backup and restore (backup.cjs): the backups kept; one made; the gateway restarted (after a restore)
    // (its health: its disk, what it keeps, how fast it grows, its retention planned)
    'GET health': async () => (health ? health() : null) ?? { error: 'Not on this gateway' },
    'GET backups': async () => ({ backups: backup ? backup.list() : [] }),
    'POST backup': async (body) => {
      if (!backup) throw new Error('Not on this gateway');
      return backup.create({ passphrase: body?.passphrase, recordings: !!body?.recordings, faults: !!body?.faults });
    },
    // (the scheduled backups: their settings, their passphrase (write only), one now)
    'GET backup/schedule': async () => (backup?.schedule ? backup.schedule() : { schedule: null }),
    'POST backup/schedule': async (body) => {
      if (!backup?.schedule) throw new Error('Not on this gateway');
      const x = body?.schedule ?? {};
      const share = String(x.share ?? '').trim().slice(0, 300);
      if (share && !(path.isAbsolute(share) || share.startsWith(String.fromCharCode(92, 92)))) throw new Error('Its folder: a full path, or a network share (two backslashes, the server, the share)');
      if (body?.passphrase) backup.setPassphrase(body.passphrase);
      if (x.enabled && !backup.schedule().passphraseSet) throw new Error('Set its passphrase first: the backups are made with it');
      const schedule = { enabled: x.enabled === true, every: x.every === 'weekly' ? 'weekly' : 'daily', day: String(x.day || 'sun').slice(0, 3).toLowerCase(), at: /^[0-2][0-9]:[0-5][0-9]$/.test(String(x.at)) ? x.at : '02:00', share, keep: Math.max(1, Math.min(365, Number(x.keep) || 14)), recordings: x.recordings === true, faults: x.faults === true };
      update((c) => { c.backup = { ...(c.backup ?? {}), schedule }; });
      audit?.add('setup page', 'backup.schedule', { enabled: schedule.enabled, every: schedule.every, at: schedule.at, share: schedule.share });
      return backup.schedule();
    },
    'POST backup/schedule/run': async () => {
      if (!backup?.runScheduled) throw new Error('Not on this gateway');
      return backup.runScheduled('setup page');
    },
    'POST restart': async () => {
      if (!restart) throw new Error('Not on this gateway');
      return restart();
    },
    // The certificate (certs.cjs): shown; self-signed; a request (CSR); the CA's certificate; a PFX
    'GET cert': async () => ({ info: certs?.info() ?? null, own: certs?.ownNames() ?? [], pending: certs?.pending() ?? false }),
    'POST cert/selfsigned': async (body) => certs.selfSigned({ names: body?.names, days: body?.days }),
    'POST cert/csr': async (body) => certs.csr({ commonName: body?.commonName, names: body?.names, organization: body?.organization }),
    'POST cert/install': async (body) => certs.install({ pem: body?.pem, key: body?.key }),
    'POST cert/pfx': async (body) => certs.installPfx({ pfx: body?.pfx, passphrase: body?.passphrase }),
    'GET monitoring': async () => {
      const c = getConfig();
      return { plcs: (c.plcs ?? []).map((p) => ({ id: p.id, name: p.name })), drives: c.drives ?? {}, faults: c.faults ?? {}, fleet: c.fleet ?? {}, projectSync: c.projectSync ?? {}, oee: c.oee ?? {}, andon: c.andon ?? {}, workorders: c.workorders ?? {}, energy: c.energy ?? {}, defaults: { reasons: ['Waiting for material', 'Jam', 'Tool change', 'Changeover', 'Electrical fault', 'Mechanical fault', 'Maintenance', 'Operator break', 'Quality check', 'Other'], callReasons: ['Mechanical', 'Electrical', 'Material', 'Quality', 'Safety', 'Other'] } };
    },
    'POST monitoring': async (body) => {
      const c = getConfig();
      const checked = checkMonitoring(body, (c.plcs ?? []).map((p) => p.id), c);
      update((x) => Object.assign(x, checked));
      log('admin: monitoring saved (drives, fault records, fleet, projects, OEE, andon, work orders)');
      audit?.add('setup page', 'monitoring', { drives: checked.drives.enabled, faults: checked.faults.enabled, fleet: checked.fleet.enabled, projects: checked.projectSync.enabled });
      return { ok: true };
    },
    // (the load panel: this computer, the gateway, each PLC's notifications and tasks, the drives read)
    'GET load': async () => (load ? load() : { plcs: [] }),
    'POST projects/check': async (body) => {
      if (!projects) throw new Error('Not available on this gateway');
      const plc = (getConfig().plcs ?? []).find((p) => p.id === String(body.id ?? ''));
      if (!plc) throw new Error('No such PLC: save the PLCs first');
      // eslint-disable-next-line no-unused-vars
      const { manifest, fingerprint, ...r } = await projects.check(plc, 'setup page');
      return r;
    },
    'GET recordings': async () => ({ rules: getConfig().recordings ?? [], status: recordings?.list() ?? [], plcs: (getConfig().plcs ?? []).map((p) => ({ id: p.id, name: p.name })) }),
    'POST recordings': async (body) => {
      if (!recordings) throw new Error('Recordings are not available');
      if (!Array.isArray(body.rules) || body.rules.length > 20) throw new Error('A list of recordings is expected');
      const ids = (getConfig().plcs ?? []).map((p) => p.id);
      const rules = body.rules.map((r, i) => recordings.check(r, i, ids));
      if (new Set(rules.map((r) => r.id)).size !== rules.length) throw new Error('Two recordings have the same id');
      update((c) => {
        c.recordings = rules;
      });
      log(`admin: recordings saved (${rules.length})`);
      return { rules, status: recordings.list(), plcs: (getConfig().plcs ?? []).map((p) => ({ id: p.id, name: p.name })) };
    },
    'POST alerts/test': async (body) => {
      if (!alerts) throw new Error('Alerts are not available');
      const webhook = String(body.webhook ?? '').trim();
      if (!/^https?:\/\/\S+$/i.test(webhook)) throw new Error('The webhook is an http(s) URL');
      return alerts.test(webhook, ['teams', 'slack', 'json'].includes(body.format) ? body.format : 'json');
    },
    // (on-call rotations: one a line, "Maintenance | week | 2026-10-19 07:00 | Bob +15551234567, Ann ann@acme.com")
    'GET rotations': async () => {
      const { scheduleOf } = require('./oncall.cjs');
      const rotations = getConfig().rotations ?? [];
      return { rotations, schedule: Object.fromEntries(rotations.map((r) => [r.name, scheduleOf(r, Date.now(), 4)])) };
    },
    'POST rotations': async (body) => {
      const { checkRotation } = require('./oncall.cjs');
      const lines = (Array.isArray(body?.lines) ? body.lines : []).map((l) => String(l ?? '').trim()).filter(Boolean).slice(0, 20);
      const rotations = lines.map((l, i) => {
        const [name, every, start, people] = l.split('|').map((x) => x.trim());
        const ev = /^(week|weekly)$/i.test(every ?? '') ? 'week' : /^(day|daily)$/i.test(every ?? '') ? 'day' : every;
        const ps = String(people ?? '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
          const words = p.split(' ').filter(Boolean);
          const last = words.at(-1) ?? '';
          const contact = words.length > 1 && (last.includes('@') || /^[+]?[0-9]{6,}$/.test(last)) ? words.pop() : '';
          return { name: words.join(' '), contact };
        });
        return checkRotation({ name, every: ev, start, people: ps }, i);
      });
      update((c) => { c.rotations = rotations.length ? rotations : undefined; });
      audit?.add('setup page', 'rotations', { count: rotations.length });
      const { scheduleOf } = require('./oncall.cjs');
      return { rotations, schedule: Object.fromEntries(rotations.map((r) => [r.name, scheduleOf(r, Date.now(), 4)])) };
    },
    'POST tokens/rotate': async (body) => {
      const name = String(body.name ?? '');
      const old = (getConfig().tokens ?? []).find((t) => t.name === name);
      if (!old) throw new Error(`No token named "${name}"`);
      const graceDays = Math.max(0, Math.min(90, Number(body.graceDays ?? 7)));
      const expires = expiryOf(body.expires);
      if (expires && (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now())) throw new Error('Its expiry: a date to come');
      const token = crypto.randomBytes(24).toString('base64url');
      update((c) => {
        c.tokens = (c.tokens ?? []).map((t) => (t.name !== name ? t : { ...t, sha256: sha256(token), rotated: new Date().toISOString(), ...(graceDays ? { previous: { sha256: t.sha256, until: new Date(Date.now() + graceDays * 86400000).toISOString() } } : { previous: undefined }), ...(expires ? { expires: expires.toISOString() } : {}) }));
      });
      log(`admin: token "${name}" rotated (the old one let in ${graceDays} more day(s))`);
      audit?.add('setup page', 'token.rotate', { name, graceDays });
      const st = state();
      return { name, token, view: !!old.view, ...(old.view ? { boardUrl: `${st.scheme}://${st.host}:${st.port}/?board&view=${token}` } : {}), state: st };
    },
    'POST tokens/revoke': async (body) => {
      const name = String(body.name ?? '');
      if (!(getConfig().tokens ?? []).some((t) => t.name === name)) throw new Error(`No token named "${name}"`);
      update((c) => {
        c.tokens = (c.tokens ?? []).filter((t) => t.name !== name);
      });
      log(`admin: token "${name}" revoked`);
      return state();
    },
  };

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', ...headers });
    res.end(body);
  };
  const json = (res, status, value) => send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json' });

  /** Handles /admin and /admin/api/...; false for other paths */
  return function handle(req, res) {
    const url = new URL(req.url, 'https://gateway');
    if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) return false;
    const config = getConfig();
    const remote = req.socket.remoteAddress ?? '';
    const allowed = LOOPBACK.has(remote) || (config.admin?.allowFrom ?? []).some((a) => a === remote || `::ffff:${a}` === remote);
    if (config.admin?.enabled === false || !allowed) {
      send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
      if (config.admin?.enabled !== false) log(`admin: refused ${remote} (only this computer, or admin.allowFrom)`);
      return true;
    }
    // Another host name pointing here (DNS rebinding): refused
    const hostName = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    if (!localHostNames(config).has(hostName)) {
      send(res, 421, 'Misdirected request', { 'Content-Type': 'text/plain' });
      return true;
    }
    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      if (req.method !== 'GET') return send(res, 405, ''), true;
      const nonce = crypto.randomBytes(16).toString('base64');
      send(res, 200, adminPage(nonce), {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      });
      return true;
    }
    // (the PLC's function block for the live events, its source to import)
    if (url.pathname === '/admin/plc/FB_KvalEventRelay.st' && req.method === 'GET') {
      send(res, 200, fs.readFileSync(require('path').join(__dirname, 'plc', 'FB_KvalEventRelay.st')), { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="FB_KvalEventRelay.st"' });
      return true;
    }
    // A backup's file, downloaded
    const bk = /^\/admin\/backup\/([\w.-]+\.kvalbk)$/.exec(url.pathname);
    if (bk && req.method === 'GET') {
      try {
        send(res, 200, backup.read(bk[1]), { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${bk[1]}"` });
      } catch (err) {
        json(res, 404, { error: err.message });
      }
      return true;
    }
    // A backup restored: its file as the body, its passphrase in X-Passphrase (from the page itself only)
    if (url.pathname === '/admin/restore' && req.method === 'POST') {
      let origin = '';
      try {
        origin = new URL(req.headers.origin ?? '').host;
      } catch {
        origin = '';
      }
      if (origin !== req.headers.host || !/^application\/octet-stream\b/.test(req.headers['content-type'] ?? '')) return json(res, 403, { error: 'Only from the gateway\'s setup page' }), true;
      const chunks = [];
      let size = 0;
      req.on('data', (d) => {
        size += d.length;
        if (size > 1024 * 1024 * 1024) req.destroy();
        else chunks.push(d);
      });
      req.on('end', () => {
        try {
          const r = backup.restore(Buffer.concat(chunks), decodeURIComponent(String(req.headers['x-passphrase'] ?? '')));
          applyConfig(r.config);
          json(res, 200, { ok: true, files: r.files, plcs: r.plcs, before: r.before });
        } catch (err) {
          json(res, 400, { error: err.message });
        }
      });
      return true;
    }
    const route = api[`${req.method} ${url.pathname.slice('/admin/api/'.length)}`];
    if (!url.pathname.startsWith('/admin/api/') || !route) return json(res, 404, { error: 'Not found' }), true;
    // Changes only from the page itself (same origin, JSON): other sites cannot post here
    if (req.method !== 'GET') {
      let origin = '';
      try {
        origin = new URL(req.headers.origin ?? '').host;
      } catch {
        origin = '';
      }
      if (origin !== req.headers.host || !/^application\/json\b/.test(req.headers['content-type'] ?? '')) return json(res, 403, { error: 'Only from the gateway\'s setup page' }), true;
    }
    let raw = '';
    req.on('data', (d) => {
      raw += d;
      // (a logged events export: up to 16 MB)
      if (raw.length > (/\/eventlog$/.test(req.url ?? '') ? 16 * 1024 * 1024 : 64 * 1024)) req.destroy();
    });
    req.on('end', async () => {
      try {
        const body = raw ? JSON.parse(raw) : {};
        const result = await route(body && typeof body === 'object' ? body : {});
        if (req.method !== 'GET' && !/^(audit\/search|reports\/preview|test|scan)$/.test(url.pathname.slice('/admin/api/'.length))) {
          audit?.add('setup page', `setup.${url.pathname.slice('/admin/api/'.length)}`, { from: remote });
        }
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
    });
    return true;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The page: built with DOM calls (text only): device names from the network never become markup

function adminPage(nonce) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gateway Setup</title>
<style nonce="${nonce}">
:root { color-scheme: dark; --bg:#020617; --panel:#0f172a; --line:#1e293b; --text:#e2e8f0; --dim:#94a3b8; --accent:#38bdf8; --ok:#34d399; --bad:#f87171; --warn:#fbbf24; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 "Segoe UI", system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); margin: 0 0 12px; font-weight: 600; }
.sub { color: var(--dim); margin: 0 0 20px; } .sub code { color: var(--text); }
section { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
p.hint { color: var(--dim); margin: 8px 0 0; font-size: 13px; }
table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 6px 6px; border-bottom: 1px solid var(--line); vertical-align: middle; }
th { color: var(--dim); font-weight: 600; font-size: 12px; } td.mono, .mono { font-family: Consolas, ui-monospace, monospace; font-size: 13px; }
input[type=text], input[type=number], select { background: #020617; color: var(--text); border: 1px solid #334155; border-radius: 6px; padding: 5px 8px; font: inherit; width: 100%; min-width: 0; }
input.mono { font-family: Consolas, ui-monospace, monospace; }
button { background: #1e293b; color: var(--text); border: 1px solid #334155; border-radius: 6px; padding: 6px 12px; font: inherit; cursor: pointer; white-space: nowrap; }
button:hover:not(:disabled) { border-color: var(--accent); } button:disabled { opacity: .45; cursor: default; }
button.primary { background: #0369a1; border-color: #0284c7; } button.danger:hover:not(:disabled) { border-color: var(--bad); color: var(--bad); }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; } .row > input[type=text] { flex: 1 1 260px; width: auto; } .row > select { width: auto; max-width: 100%; }
.msg { margin-top: 10px; font-size: 13px; min-height: 1em; } .msg.ok { color: var(--ok); } .msg.bad { color: var(--bad); }
.status { font-size: 12px; } .status.ok { color: var(--ok); } .status.bad { color: var(--bad); } .status.busy { color: var(--warn); }
.admin-check-row td { padding: 4px 8px 10px; font-size: 12px; } .admin-check-step.ok { color: var(--ok); } .admin-check-step.bad { color: var(--bad); } .admin-check-step.warn { color: var(--warn); } .admin-check-verdict { margin-top: 4px; font-weight: 600; }
.tag { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 9px; background: #1e293b; color: var(--dim); }
.token { margin-top: 12px; padding: 12px; border: 1px solid #0284c7; border-radius: 8px; background: #082f49; }
.token .mono { font-size: 16px; word-break: break-all; color: var(--accent); }
.scroll { overflow-x: auto; } .mt { margin-top: 10px; } .mt6 { margin-top: 6px; } p.hint.flush { margin: 0 0 10px; } .grow { flex: 1; } .nowrap { flex-wrap: nowrap; } .right { text-align: right; } td.w-port { width: 80px; } td.w-status { min-width: 180px; max-width: 300px; } input[data-key=netId], input[data-key=ip] { min-width: 140px; } input[data-key=id], input[data-key=name] { min-width: 100px; } td.w-port { min-width: 70px; }
@media (max-width: 700px) { .hide-sm { display: none; } }
</style></head>
<body><main>
<h1>Kval MachineScope gateway: setup</h1>
<p class="sub" id="admin-sub">Loading...</p>

<section>
  <h2>This gateway's AMS NetId</h2>
  <div class="row"><input type="text" class="mono" id="admin-local-netid" placeholder="192.168.1.5.1.1"><select id="admin-netid-suggest"><option value="">Suggested...</option></select></div>
  <p class="hint">Each PLC needs an ADS route to the gateway: this AMS NetId, and the gateway's IP address on the PLC's network. Add the route on the PLC (TwinCAT router: <i>Edit Routes</i>) or from an XAE connected to it.</p>
</section>

<section>
  <h2>Find PLCs on the network</h2>
  <div class="row"><button class="primary" id="admin-scan">Search the network</button><input type="text" id="admin-scan-addresses" placeholder="Also ask these addresses (comma-separated; for PLCs behind a router)"></div>
  <p class="hint">The TwinCAT search (UDP 48899), as the XAE's Add Route dialog does it. It changes nothing on the devices.</p>
  <div class="msg" id="admin-scan-msg"></div>
  <div class="scroll"><table id="admin-found-table" hidden><thead><tr><th></th><th>Name</th><th>AMS NetId</th><th>Address</th><th class="hide-sm">TwinCAT</th><th class="hide-sm">OS</th><th></th></tr></thead><tbody id="admin-found"></tbody></table></div>
  <div class="row mt"><button id="admin-add-found" disabled>Add the ticked ones to the PLCs</button></div>
</section>

<section>
  <h2>PLCs (config.json)</h2>
  <p class="hint flush">The PLCs the web app's Live tab offers. The id names the PLC in the web app (keep it once people use it); ADS port 851 is the first PLC runtime.</p>
  <div class="scroll"><table><thead><tr><th>Id</th><th>Name</th><th>AMS NetId</th><th>Address</th><th>Port</th><th>Status</th><th></th></tr></thead><tbody id="admin-plcs"></tbody></table></div>
  <div class="row mt"><button id="admin-add-plc">Add a PLC by hand</button><span class="grow"></span><button id="admin-revert" disabled>Discard changes</button><button class="primary" id="admin-save" disabled>Save to config.json</button></div>
  <div class="msg" id="admin-save-msg"></div>
</section>

<section>
  <h2>Access tokens</h2>
  <div class="scroll"><table><thead><tr><th>Name</th><th>Created</th><th>Expires</th><th>PLCs</th><th></th></tr></thead><tbody id="admin-tokens"></tbody></table></div>
  <div class="row mt"><input type="text" id="admin-token-name" placeholder="Who is it for? (a person or team)" maxlength="60"><label title="A display (a TV by the line): the operator board only, no actions; its link carries the token"><input type="checkbox" id="admin-token-view"> View only (a display)</label><label title="After this day it is refused (empty: never)">expires <input type="date" id="admin-token-expires"></label><span id="admin-token-plcs" title="Only these PLCs: their machines, alerts, work orders, drives (none ticked: every PLC)"></span><button class="primary" id="admin-token-create">Create token</button></div>
  <div id="admin-token-new"></div>
  <div class="msg" id="admin-token-msg"></div>
  <p class="hint">Only a token's hash is kept: a new token is shown once. People enter it in the web app's Live tab. A revoked token stops working at once.</p>
</section>
<section>
  <h2>Alerts</h2>
  <p class="hint flush">The gateway follows the state machines under a root by itself (no browser needed) and posts to a webhook when one is stuck (longer in a state than the limit) or goes into an error state, and when it recovers. Teams and Slack: an incoming webhook URL (Teams: a channel's Workflows "post to a channel when a webhook request is received", or an Incoming Webhook connector).</p>
  <div id="admin-alerts"></div>
  <div class="row mt"><button id="admin-alert-add">Add an alert</button><span class="grow"></span><button class="primary" id="admin-alerts-save">Save alerts</button></div>
  <div class="msg" id="admin-alerts-msg"></div>
</section>

<section>
  <h2>Roles</h2>
  <p class="hint flush">Who may do what. An <b>operator</b> acknowledges alerts, writes notes, calls maintenance and gives downtime reasons. A <b>technician</b> also sets maintenance windows, handles work orders and fault records. A <b>supervisor</b> also assigns work, adds alarms and recordings and saves the board's filters, and sees the reports. An <b>engineer</b> also builds and writes to the PLCs (with allowWrite and writeUsers). A <b>manager</b> sees the boards and the reports. Without roles, everyone signed in may do everything. Each role can start on a saved filter of the board, and be told of alerts on its own channel, naming who is on call.</p>
  <label class="row"><input type="checkbox" id="admin-roles-on"> Use roles</label>
  <div id="admin-roles"></div>
  <div class="row mt"><span class="grow"></span><button class="primary" id="admin-roles-save">Save roles</button></div>
  <div class="msg" id="admin-roles-msg"></div>
</section>
<section>
  <h2>Operator boards</h2>
  <p class="hint flush">Saved boards: open one at /?board=&lt;id&gt; (for a screen by the line). Without PLCs ticked, a board shows all of them.</p>
  <div id="admin-boards"></div>
  <div class="row mt"><button id="admin-board-add">Add a board</button><span class="grow"></span><button class="primary" id="admin-boards-save">Save boards</button></div>
  <div class="msg" id="admin-boards-msg"></div>
</section>

<section>
  <h2>Recordings</h2>
  <p class="hint flush">The gateway records every state change of the machines under a root, all day, one file per day (recordings/ next to config.json), and keeps them for the days you choose. Engineers replay a machine's time window from the web app's Live tab (Gateway recordings...).</p>
  <div id="admin-recordings"></div>
  <div class="row mt"><button id="admin-recording-add">Add a recording</button><span class="grow"></span><button class="primary" id="admin-recordings-save">Save recordings</button></div>
  <div class="msg" id="admin-recordings-msg"></div>
</section>
<section>
  <h2>Monitoring</h2>
  <p class="hint flush">What the gateway follows on each PLC by itself, and how. Drives: each drive's own values (heatsink, current, DC bus …), judged against its limits, its past and its siblings. Fault records: the minute before and after each fault. I/O fleet: the EtherCAT boxes' states (the Risk page, the inventory). Project copies: the PLC's project kept here. Each costs a little of the PLC's and the network's time: the Load section below shows it.</p>
  <div id="admin-monitoring"></div>
  <div class="row mt"><span class="grow"></span><button class="primary" id="admin-monitoring-save">Save monitoring</button></div>
  <div class="msg" id="admin-monitoring-msg"></div>
</section>
<section>
  <h2>Certificate</h2>
  <p class="hint flush">The certificate the board and this page are served with (https). Browsers warn about a self-signed one: a certificate of your company&#39;s CA (a request made here, the certificate it issues installed here) is trusted by its computers. Taken at once, without a restart; the one before kept (cert-&lt;when&gt;.pem). The roles that want cert are told from 30 days before it expires.</p>
  <div id="admin-cert-info" class="hint"></div>
  <div class="row"><input id="admin-cert-names" class="grow mono" placeholder="its names and addresses (gw-line4, gw-line4.acme.com, 10.10.10.5): empty, this computer&#39;s"><input id="admin-cert-org" placeholder="organization (for a request)"></div>
  <div class="row"><button id="admin-cert-self">Make a self-signed certificate</button><button id="admin-cert-csr">Make a request (CSR) for our CA</button></div>
  <textarea id="admin-cert-pem" rows="5" class="mono" placeholder="The request (CSR) to send to your CA appears here; paste the certificate it issued here (PEM, its chain after it), then Install it"></textarea>
  <div class="row"><button id="admin-cert-install">Install the CA&#39;s certificate</button><input type="file" id="admin-cert-pfx" accept=".pfx,.p12"><input type="password" id="admin-cert-pfx-pass" placeholder="its passphrase"><button id="admin-cert-pfx-btn">Install the PFX</button></div>
  <div class="msg" id="admin-cert-msg"></div>
</section>
<section>
  <h2>Backup</h2>
  <p class="hint flush">The gateway in one file, to move it to another computer or to go back: its settings, tokens, roles, the alert history, work orders, spare parts, plans, guides, handovers, changes, filters, boards, push devices, certificates, the drives&#39; and axes&#39; statistics, the logged events (with the recordings and fault records when ticked). Encrypted with a passphrase: it holds passwords and tokens; without it, it cannot be restored. A restore keeps the gateway as it was first (before-restore), then the gateway restarted takes it all.</p>
  <div class="row"><input type="password" id="admin-backup-pass" placeholder="its passphrase (8 characters at least)"><label class="inline"><input type="checkbox" id="admin-backup-recordings"> the recordings</label><label class="inline"><input type="checkbox" id="admin-backup-faults"> the fault records</label><button class="primary" id="admin-backup-make">Make a backup</button></div>
  <div id="admin-backups"></div>
  <h3>Scheduled</h3>
  <div class="row"><label class="inline"><input type="checkbox" id="admin-bsched-on"> Make one by itself</label><select id="admin-bsched-every"><option value="daily">every day</option><option value="weekly">every week, on</option></select><select id="admin-bsched-day"><option value="sun">Sun</option><option value="mon">Mon</option><option value="tue">Tue</option><option value="wed">Wed</option><option value="thu">Thu</option><option value="fri">Fri</option><option value="sat">Sat</option></select> at <input type="text" class="mono" id="admin-bsched-at" size="5" placeholder="02:00"></div>
  <div class="row">a copy to <input type="text" class="grow mono" id="admin-bsched-share" placeholder="a folder or a network share (its full path; empty: here only)"> keeping the newest <input type="number" class="num" id="admin-bsched-keep" placeholder="14"> <label class="inline"><input type="checkbox" id="admin-bsched-rec"> the recordings</label><label class="inline"><input type="checkbox" id="admin-bsched-faults"> the fault records</label></div>
  <div class="row"><input type="password" id="admin-bsched-pass" placeholder="its passphrase (set once; kept here, never shown)"><button id="admin-bsched-save">Save the schedule</button><button id="admin-bsched-run">Make one now</button><span id="admin-bsched-status" class="hint flush"></span></div>
  <div class="msg" id="admin-bsched-msg"></div>
  <h3>Restore</h3>
  <div class="row"><input type="file" id="admin-restore-file" accept=".kvalbk"><input type="password" id="admin-restore-pass" placeholder="its passphrase"><button id="admin-restore">Restore it</button><button id="admin-restart">Restart the gateway</button></div>
  <div class="msg" id="admin-backup-msg"></div>
</section>
<section>
  <h2>Exports</h2>
  <p class="hint flush">For other systems, read only. The <b>REST/JSON API</b>: GET /api/v1/plcs, alerts, workorders, oee, drives, axes, risks, changes, with a token of the gateway (a view-only one is enough) as its bearer: curl -H "Authorization: Bearer &lt;token&gt;" https://this-gateway:8443/api/v1/alerts. <b>MQTT</b>: each alert to &lt;prefix&gt;/&lt;plc&gt;/alerts, each recorded machine&#39;s state to &lt;prefix&gt;/&lt;plc&gt;/state/&lt;its path&gt; (retained), work orders to &lt;prefix&gt;/workorders, the gateway&#39;s status online / offline. <b>A CMMS</b> (SAP PM, Maximo or another): a work order made posts its body to its address, done its done body; {number} {title} {plc} {machine} {priority} {status} {assignee} {due} {rootCause} {parts} {externalId} {link} filled in.</p>
  <div class="row"><label class="inline"><input type="checkbox" id="admin-api-on"> The REST/JSON API</label><input id="admin-public-url" class="grow mono" placeholder="this gateway, as others reach it (https://gw-line4:8443): for {link}"></div>
  <h3>MQTT <span class="hint" id="admin-mqtt-state"></span></h3>
  <div class="row"><input id="admin-mqtt-url" class="grow mono" placeholder="mqtt://broker:1883 or mqtts://broker:8883"><input id="admin-mqtt-user" placeholder="user"><input id="admin-mqtt-pass" type="password" placeholder="password"><input id="admin-mqtt-prefix" placeholder="kval/machinescope"></div>
  <h3>CMMS (SAP PM, Maximo …)</h3>
  <div class="row"><select id="admin-cmms-method"><option>POST</option><option>PUT</option></select><input id="admin-cmms-url" class="grow mono" placeholder="https://cmms/api/workorders (a work order made)"><input id="admin-cmms-id" placeholder="its id in the answer (id)"></div>
  <textarea id="admin-cmms-body" rows="3" class="mono" placeholder='{"description":"{title}","priority":"{priority}","asset":"{machine}"}'></textarea>
  <div class="row"><select id="admin-cmms-done-method"><option>POST</option><option>PUT</option><option>PATCH</option></select><input id="admin-cmms-done-url" class="grow mono" placeholder="https://cmms/api/workorders/{externalId}/complete (done)"></div>
  <textarea id="admin-cmms-done-body" rows="2" class="mono" placeholder='{"status":"COMP","remarks":"{rootCause}"}'></textarea>
  <textarea id="admin-cmms-headers" rows="2" class="mono" placeholder='{"Content-Type":"application/json","Authorization":"Basic …"}'></textarea>
  <div class="row mt"><span class="grow"></span><button class="primary" id="admin-exports-save">Save exports</button></div>
  <div class="msg" id="admin-exports-msg"></div>
</section>
<section>
  <h2>Other gateways</h2>
  <p class="hint flush">The plant&#39;s other gateways on this board&#39;s Sites page: each one&#39;s PLCs, its machines in error or stuck, its open alerts, a link to its own board. Each is followed as a display follows its board, with a view-only token of that gateway (its setup page, Tokens): nothing is changed there. Self-signed certificates: tick Its certificate not checked.</p>
  <div id="admin-sites"></div>
  <div class="row mt"><button id="admin-site-add">Add a gateway</button><span class="grow"></span><button class="primary" id="admin-sites-save">Save other gateways</button></div>
  <div class="msg" id="admin-sites-msg"></div>
  <h3>The plant, each week</h3>
  <p class="hint flush">The roll-up of this gateway and those it follows (OEE, availability, downtime, stops, open alerts), on the Sites page, and each week by email (its mail server: Email and SMS) and to a webhook.</p>
  <div class="row">This gateway is <input type="text" id="admin-plant-name" placeholder="its name in the roll-up (this computer's name)"> sent each <select id="admin-plant-day"><option value="mon">Mon</option><option value="tue">Tue</option><option value="wed">Wed</option><option value="thu">Thu</option><option value="fri">Fri</option><option value="sat">Sat</option><option value="sun">Sun</option></select> at <input type="text" class="mono" id="admin-plant-at" size="5" placeholder="07:00"></div>
  <div class="row"><input type="text" class="grow" id="admin-plant-to" placeholder="emailed to: plant.manager@acme.com, maintenance@acme.com"><input type="text" class="grow mono" id="admin-plant-webhook" placeholder="and to a webhook (Teams, Slack): https://…"></div>
  <div class="row"><input type="text" class="grow mono" id="admin-plant-link" placeholder="the link it carries: https://gateway:8443/?board&amp;page=sites"><button id="admin-plant-save">Save</button><button id="admin-plant-send">Send it now</button></div>
  <div class="msg" id="admin-plant-msg"></div>
</section>
<section>
  <h2>Email and SMS</h2>
  <p class="hint flush">For the roles&#39; alerts by email or text message (Roles, Told of alerts: a channel of email or SMS). Email through your mail server (SMTP: port 587 with STARTTLS, 465 with TLS); SMS through Twilio, or any provider&#39;s web API (its address with {to} and {text}). Passwords and tokens are kept in config.json and never shown again: left empty, the saved one stays.</p>
  <h3>Email (SMTP)</h3>
  <div class="row"><input id="admin-smtp-host" placeholder="mail server (smtp.office365.com)"><input id="admin-smtp-port" size="5" placeholder="587"><input id="admin-smtp-user" placeholder="user"><input id="admin-smtp-pass" type="password" placeholder="password"><input id="admin-smtp-from" class="grow" placeholder="From: MachineScope &lt;alerts@acme.com&gt;"></div>
  <h3>SMS</h3>
  <div class="row"><select id="admin-sms-provider"><option value="">(none)</option><option value="twilio">Twilio</option><option value="http">Another provider (web API)</option></select><input id="admin-sms-sid" placeholder="Twilio account SID"><input id="admin-sms-token" type="password" placeholder="Twilio auth token"><input id="admin-sms-from" placeholder="From (+15550001111)"></div>
  <div class="row"><input id="admin-sms-url" class="grow mono" placeholder="https://provider/send?to={to}&amp;text={text}"><select id="admin-sms-method"><option>POST</option><option>GET</option></select><input id="admin-sms-body" class="grow mono" placeholder="its body (POST)"></div>
  <div class="row mt"><input id="admin-test-email" placeholder="email a test to"><button id="admin-test-email-btn">Send a test email</button><input id="admin-test-sms" placeholder="text a test to (+1…)"><button id="admin-test-sms-btn">Send a test SMS</button><span class="grow"></span><button class="primary" id="admin-channels-save">Save email and SMS</button></div>
  <div class="msg" id="admin-channels-msg"></div>
</section>
<section>
  <h2>TwinCAT logged events</h2>
  <p class="hint flush">The PLC's own alarms and messages (its EventLogger) beside the gateway's fault records: each fault record shows the events of its window, on its timeline and listed. In TwinCAT XAE, open View &gt; Other Windows &gt; TwinCAT Logged Events, read the PLC's events, export them (CSV), and import that file here for its PLC. The same event is kept once; the last 50 000 a PLC.</p>
  <div class="row"><select id="admin-eventlog-plc"></select><input type="file" id="admin-eventlog-file" accept=".csv,text/csv,text/plain"><button class="primary" id="admin-eventlog-import">Import</button></div>
  <div class="msg" id="admin-eventlog-msg"></div>
  <p class="hint" id="admin-eventlog-stats"></p>
  <h3>Live</h3>
  <p class="hint flush">Its events as they happen, without an export: a small function block in the PLC (<a href="/admin/plc/FB_KvalEventRelay.st" id="admin-eventlog-fb">FB_KvalEventRelay.st</a>: its structure, its function block and its methods, to add to your PLC project with Tc3_EventLogger), its instance called every cycle; here, that instance for each PLC. Its alarms of severity error or critical raised are alerts too; cleared, they recover.</p>
  <div id="admin-eventlog-live"></div>
  <div class="row"><span class="grow"></span><button id="admin-eventlog-live-save">Save</button></div>
  <div class="msg" id="admin-eventlog-live-msg"></div>
</section>
<section>
  <h2>Check a drive</h2>
  <p class="hint flush">A drive read straight from its PLC (its own CoE objects, through the EtherCAT master), to compare with its keypad or its maker's software: its profile, each value raw and as the board reads it, or any one object. Read only: nothing is written to the drive. A value marked unverified has a scaling its maker does not give: check it here once, and correct its profile (drives.profiles) when it is off.</p>
  <div class="row"><select id="admin-drive-plc"></select><button id="admin-drive-list">List its drives</button><select id="admin-drive-box" class="grow"></select><button id="admin-drive-read">Read its profile</button></div>
  <div class="row"><input id="admin-drive-index" class="mono" placeholder="index, e.g. 6ff1" size="12"><input id="admin-drive-sub" class="mono" placeholder="sub" size="4"><select id="admin-drive-size"><option value="1">1 byte</option><option value="2">2 bytes</option><option value="4" selected>4 bytes</option><option value="8">8 bytes</option></select><input id="admin-drive-at" class="mono" size="7" placeholder="at address"><button id="admin-drive-one">Read this object</button><button id="admin-drive-scan">Scan the bus</button></div>
  <div class="msg" id="admin-drive-msg"></div>
  <div id="admin-drive-out"></div>
</section>
<section>
  <h2>Load</h2>
  <p class="hint flush">What the gateway costs this computer and each PLC, measured every few seconds. The PLC's own tasks run in TwinCAT's real time, before any Windows program: its tasks below show whether they keep their cycle (their execution time, the longest seen, every overrun counted). Each variable the boards, alarms, recordings, live diagrams and I/O charts follow is one ADS notification, shared by all of them.</p>
  <p class="hint" id="admin-load-sub"></p>
  <div id="admin-load"></div>
</section>
<section>
  <h2>Health</h2>
  <p class="hint flush">The disk the gateway keeps its data on, what it keeps there, how fast its recordings grow, and when the disk is full at that. Each recording kept for its days: what it takes at full retention, and how many days to keep when it does not fit. Low (under 10 % or 5 GB free, or full within 14 days): an alert, once a day.</p>
  <div class="row"><span id="admin-health-sub" class="grow"></span><button id="admin-health-refresh">Again</button></div>
  <div id="admin-health"></div>
</section>
<section>
  <h2>PLC projects</h2>
  <p class="hint flush">Each PLC's project as the PLC keeps it (its TwinCAT configuration and its PLC project's sources), kept here as a TwinCAT project to open: the PLC's copy is the golden one. Checked at start and every few minutes: downloaded when the PLC runs another build (only then), local changes undone; the versions before kept in history. The PLC must keep its sources (PLC project &gt; Settings &gt; Source download).</p>
  <p class="hint" id="admin-projects-sub"></p>
  <div id="admin-projects"></div>
  <div class="msg" id="admin-projects-msg"></div>
</section>
<section>
  <h2>Shift reports</h2>
  <p class="hint flush">The shifts (empty: the whole day). At the end of each shift, its report (alerts, time to acknowledge and to resolve, the machines with the most, maintenance) goes to the webhook; the board downloads it too.</p>
  <div id="admin-shifts"></div>
  <div class="row mt"><button id="admin-shift-add">Add a shift</button></div>
  <table class="mt"><tbody>
    <tr><th>Reports webhook</th><td><input type="text" class="mono" id="admin-report-webhook" placeholder="https://... (empty: not posted)"></td><th>Format</th><td><select id="admin-report-format"><option value="teams">Teams</option><option value="slack">Slack</option><option value="json">JSON</option></select></td></tr>
    <tr><th>Emailed to</th><td><input type="text" id="admin-report-email" placeholder="manager@acme.com, maintenance@acme.com (Email and SMS: its mail server)"></td><th>When</th><td><select id="admin-report-when"><option value="shift">each shift</option><option value="daily">daily</option><option value="weekly">weekly</option></select><select id="admin-report-day"><option value="mon">Mon</option><option value="tue">Tue</option><option value="wed">Wed</option><option value="thu">Thu</option><option value="fri">Fri</option><option value="sat">Sat</option><option value="sun">Sun</option></select><input type="text" class="mono" id="admin-report-at" size="5" placeholder="07:00"></td></tr>
  </tbody></table>
  <div class="row mt"><button id="admin-report-preview">Preview the last shift</button><button id="admin-report-send">Send it now</button><button id="admin-report-email-now">Email it now</button><span class="grow"></span><button class="primary" id="admin-reports-save">Save shifts and reports</button></div>
  <div class="msg" id="admin-reports-msg"></div>
</section>

<section>
  <h2>Run at startup (Windows)</h2>
  <p class="hint flush">The gateway as a Windows scheduled task: it starts with the computer (as SYSTEM, before anyone signs in), is started again when it stops, and has no time limit. Installing needs this gateway to run as an administrator once.</p>
  <div class="row"><span class="status" id="admin-service-status">...</span><span class="grow"></span><button id="admin-service-install">Install</button><button id="admin-service-switch">Switch to the task now</button><button class="danger" id="admin-service-remove">Remove</button></div>
  <div class="msg" id="admin-service-msg"></div>
</section>

<section>
  <h2>Audit log</h2>
  <p class="hint flush">Who did what: sign-ins, going live, acknowledging, maintenance, replays, reports, and the changes on this page. Kept for 24 months (audit-YYYY-MM.jsonl next to config.json).</p>
  <div class="row"><input type="text" id="admin-audit-q" placeholder="Search (user, action, PLC, machine...)"><select id="admin-audit-range"><option value="1">last 24 h</option><option value="7" selected>last 7 days</option><option value="31">last 31 days</option><option value="366">last year</option></select><button id="admin-audit-search">Search</button><button id="admin-audit-csv">Export CSV</button></div>
  <div class="scroll mt"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody id="admin-audit"></tbody></table></div>
  <div class="msg" id="admin-audit-msg"></div>
</section>
<p class="hint" id="admin-foot"></p>
</main>
<script nonce="${nonce}">
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k === 'class') e.className = v;
      else if (k in e) e[k] = v;
      else e.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) e.append(kid instanceof Node ? kid : String(kid));
    return e;
  };
  const call = async (path, body) => {
    const r = await fetch('/admin/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({ error: 'No answer from the gateway' }));
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  };
  const say = (id, text, ok) => { const m = $(id); m.textContent = text; m.className = 'msg ' + (ok === true ? 'ok' : ok === false ? 'bad' : ''); };

  let saved = null;   // the state as saved: PLCs and the gateway's NetId
  let plcs = [];      // the rows being edited
  let found = [];
  const tests = new Map(); // a PLC's settings -> { cls, text } (kept across Save)
  const testKey = (p) => [p.id, p.netId, p.ip, p.port].join('|');

  const dirty = () => JSON.stringify(plcs.map(({ status, ...p }) => p)) !== JSON.stringify(saved.plcs.map(({ status, ...p }) => p)) || $('admin-local-netid').value.trim() !== saved.localNetId;
  const refreshButtons = () => { const d = dirty(); $('admin-save').disabled = !d; $('admin-revert').disabled = !d; };
  const slug = (s) => (s || 'plc').toLowerCase().replace(/[^a-z0-9_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'plc';
  const uniqueId = (base) => { let id = slug(base), n = 2; while (plcs.some((p) => p.id.toLowerCase() === id)) id = slug(base).slice(0, 36) + '-' + n++; return id; };

  function renderPlcs() {
    const body = $('admin-plcs');
    body.replaceChildren();
    if (!plcs.length) body.append(el('tr', {}, el('td', { colSpan: 7, class: 'status' }, 'No PLCs yet: search the network, or add one by hand.')));
    plcs.forEach((p, i) => {
      const field = (key, cls, type = 'text') => el('input', { type, class: cls || '', value: p[key] ?? '', 'data-key': key, on: { input: (e) => { p[key] = type === 'number' ? Number(e.target.value) : e.target.value; refreshButtons(); } } });
      const t = tests.get(testKey(p)) || (p.status ? { cls: p.status.connected ? 'ok' : '', text: p.status.connected ? 'In use: ' + p.status.viewers + ' viewer(s), PLC ' + (p.status.plcState || '?') : '' } : { cls: '', text: '' });
      const status = el('span', { class: 'status ' + t.cls }, t.text);
      body.append(el('tr', { 'data-plc': p.id },
        el('td', {}, field('id', 'mono')),
        el('td', {}, field('name')),
        el('td', {}, field('netId', 'mono')),
        el('td', {}, field('ip', 'mono')),
        el('td', { class: 'w-port' }, field('port', 'mono', 'number')),
        el('td', { class: 'w-status' }, status),
        el('td', {}, el('div', { class: 'row nowrap' },
          el('button', { class: 'admin-test', on: { click: () => testRow(p, status) } }, 'Test'),
          el('button', { class: 'admin-check', title: 'Why does it not answer? Each step: the network, TwinCAT, its NetId, the route (nothing is changed)', on: { click: () => checkRow(p) } }, 'Check'),
          el('button', { class: 'danger', title: 'Remove from the list (Save to apply)', on: { click: () => { plcs.splice(i, 1); renderPlcs(); renderFound(); refreshButtons(); } } }, 'Remove'))),
      ));
    });
  }

  // Check: the steps in a row under the PLC's (a listed PLC, or one the search found, before it is added)
  function checkRow(p) {
    const tr = document.querySelector('tr[data-plc="' + CSS.escape(p.id) + '"]');
    if (tr) return checkInto(tr, p.id, p);
  }
  async function checkInto(tr, key, p) {
    let out = tr.nextElementSibling;
    if (!out || !out.classList.contains('admin-check-row')) {
      out = el('tr', { class: 'admin-check-row', 'data-check': key }, el('td', { colspan: '7' }));
      tr.after(out);
    }
    const cell = out.firstChild;
    cell.textContent = 'Checking...';
    try {
      const r = await call('check', { id: p.id || 'check', name: p.name || 'The PLC', netId: String(p.netId).trim(), ip: String(p.ip).trim(), port: Number(p.port) || 851, localNetId: p.localNetId || $('admin-local-netid').value.trim() });
      cell.textContent = '';
      for (const s of r.steps) cell.append(el('div', { class: 'admin-check-step ' + (s.ok === true ? 'ok' : s.ok === false ? 'bad' : 'warn'), 'data-step': s.id, 'data-ok': String(s.ok) }, (s.ok === true ? '✓ ' : s.ok === false ? '✗ ' : '! ') + s.title + (s.detail && s.ok !== true ? ' — ' + s.detail : '')));
      cell.append(el('div', { class: 'admin-check-verdict' }, r.verdict));
    } catch (err) {
      cell.textContent = err.message;
    }
  }

  async function testRow(p, status) {
    status.className = 'status busy';
    status.textContent = 'Testing...';
    try {
      const r = await call('test', { id: p.id, name: p.name, netId: String(p.netId).trim(), ip: String(p.ip).trim(), port: Number(p.port) || 851, localNetId: p.localNetId || $('admin-local-netid').value.trim() });
      tests.set(testKey(p), { cls: r.ok ? 'ok' : 'bad', text: r.message });
    } catch (err) {
      tests.set(testKey(p), { cls: 'bad', text: err.message });
    }
    const t = tests.get(testKey(p));
    status.className = 'status ' + t.cls;
    status.textContent = t.text;
  }

  function renderFound() {
    const body = $('admin-found');
    body.replaceChildren();
    $('admin-found-table').hidden = !found.length;
    for (const d of found) {
      const have = plcs.some((p) => p.netId === d.netId);
      const box = el('input', { type: 'checkbox', checked: !have && d.pick !== false, disabled: have, on: { change: (e) => { d.pick = e.target.checked; updateAdd(); } } });
      d.box = box;
      body.append(el('tr', { 'data-netid': d.netId },
        el('td', {}, box), el('td', {}, d.name || '(no name)'), el('td', { class: 'mono' }, d.netId), el('td', { class: 'mono' }, d.ip),
        el('td', { class: 'hide-sm' }, d.twincat), el('td', { class: 'hide-sm' }, d.os),
        el('td', {}, el('div', { class: 'row nowrap' },
          have ? el('span', { class: 'tag' }, 'in the list') : null,
          el('button', { class: 'admin-found-check', title: 'Check it before adding it: the network, TwinCAT, its NetId, the route from this gateway (nothing is changed)', on: { click: (e) => checkInto(e.target.closest('tr'), 'found:' + d.netId, { name: d.name, netId: d.netId, ip: d.ip, port: 851 }) } }, 'Check')))));
    }
    updateAdd();
  }
  const updateAdd = () => { $('admin-add-found').disabled = !found.some((d) => d.box && d.box.checked && !d.box.disabled); };

  function render(state) {
    saved = { localNetId: state.localNetId, plcs: state.plcs.map((p) => ({ ...p })) };
    plcs = state.plcs.map((p) => ({ ...p }));
    $('admin-local-netid').value = state.localNetId;
    const sel = $('admin-netid-suggest');
    sel.replaceChildren(el('option', { value: '' }, 'Suggested...'), ...state.networks.map((n) => el('option', { value: n.netId }, n.netId + ' (' + n.iface + ', ' + n.address + ')')));
    $('admin-sub').replaceChildren('Version ' + state.version + ' on ' + state.host + ', port ' + state.port + '. Settings in ', el('code', {}, state.configPath), '.');
    $('admin-foot').textContent = 'People open the web app at ' + state.scheme + '://' + state.host + ':' + state.port + '/ . This page works only on the gateway computer.';
    renderPlcs();
    renderFound();
    renderTokens(state.tokens);
    $('admin-token-plcs').replaceChildren(...(state.plcs || []).map((p) => el('label', { class: 'inline' }, el('input', { type: 'checkbox', value: p.id }), ' ' + p.name)));
    refreshButtons();
  }

  function renderTokens(tokens) {
    const body = $('admin-tokens');
    body.replaceChildren();
    if (!tokens.length) body.append(el('tr', {}, el('td', { colSpan: 5, class: 'status' }, 'No tokens yet: nobody can go live through this gateway.')));
    for (const t of tokens) {
      body.append(el('tr', { 'data-token': t.name },
        el('td', {}, t.name, t.view ? el('span', { class: 'tag admin-token-view-tag', title: 'A display: the operator board only, no actions' }, ' view only') : ''), el('td', {}, t.created ? new Date(t.created).toLocaleString() : ''),
        el('td', { class: 'admin-token-expires' + (t.expires && Date.parse(t.expires) - Date.now() < 7 * 86400000 ? ' bad' : '') }, t.expires ? new Date(t.expires).toLocaleDateString() : 'never', t.rotatedUntil ? el('div', { class: 'hint flush' }, 'its old one until ' + new Date(t.rotatedUntil).toLocaleDateString()) : ''),
        el('td', { class: 'admin-token-plcs' }, t.plcs && t.plcs.length ? t.plcs.join(', ') : 'all'),
        el('td', { class: 'right' }, el('button', { class: 'admin-rotate', title: 'A new token for the same name; its old one still works 7 days', on: { click: () => rotate(t.name) } }, 'Rotate'), el('button', { class: 'danger admin-revoke', on: { click: () => revoke(t.name) } }, 'Revoke'))));
    }
  }

  async function rotate(name) {
    if (!confirm('A new token for "' + name + '"? Its old one still works 7 days, then stops.')) return;
    try {
      const r = await call('tokens/rotate', { name, graceDays: 7 });
      renderTokens(r.state.tokens);
      $('admin-token-new').replaceChildren(el('div', { class: 'token' }, el('div', { class: 'status' }, 'The new token for "' + r.name + '": shown only now. Its old one works 7 more days.'), el('div', { class: 'row mt6' }, el('span', { class: 'mono', id: 'admin-token-value' }, r.token)), r.boardUrl ? el('a', { class: 'mono', id: 'admin-token-board-url', href: r.boardUrl, target: '_blank' }, r.boardUrl) : ''));
    } catch (err) { say('admin-token-msg', err.message, false); }
  }

  async function revoke(name) {
    if (!confirm('Revoke the token "' + name + '"? Whoever uses it can no longer go live.')) return;
    try {
      renderTokens((await call('tokens/revoke', { name })).tokens);
      say('admin-token-msg', 'Revoked "' + name + '".', true);
    } catch (err) { say('admin-token-msg', err.message, false); }
  }

  $('admin-netid-suggest').addEventListener('change', (e) => { if (e.target.value) $('admin-local-netid').value = e.target.value; e.target.value = ''; refreshButtons(); });
  $('admin-local-netid').addEventListener('input', refreshButtons);

  $('admin-scan').addEventListener('click', async () => {
    const b = $('admin-scan');
    b.disabled = true;
    say('admin-scan-msg', 'Searching...');
    try {
      const addresses = $('admin-scan-addresses').value.split(/[\\s,;]+/).filter(Boolean);
      const r = await call('scan', { addresses });
      found = r.devices;
      renderFound();
      say('admin-scan-msg', found.length ? found.length + ' TwinCAT device(s) found.' + (r.errors.length ? ' (' + r.errors.join('; ') + ')' : '') : 'None found. A firewall may block UDP 48899, or the PLCs are behind a router: enter their addresses.' + (r.errors.length ? ' (' + r.errors.join('; ') + ')' : ''), found.length ? true : false);
    } catch (err) { say('admin-scan-msg', err.message, false); }
    b.disabled = false;
  });

  $('admin-add-found').addEventListener('click', () => {
    for (const d of found) {
      if (!d.box || !d.box.checked || d.box.disabled) continue;
      plcs.push({ id: uniqueId(d.name || d.ip), name: d.name || d.ip, netId: d.netId, ip: d.ip, port: 851 });
    }
    renderPlcs();
    renderFound();
    refreshButtons();
    say('admin-save-msg', 'Added: check the ids and names, Test, then Save.');
  });

  $('admin-add-plc').addEventListener('click', () => {
    plcs.push({ id: uniqueId('plc'), name: '', netId: '', ip: '', port: 851 });
    renderPlcs();
    refreshButtons();
    const inputs = $('admin-plcs').querySelectorAll('tr:last-child input');
    if (inputs[1]) inputs[1].focus();
  });

  $('admin-revert').addEventListener('click', async () => { render(await call('state')); say('admin-save-msg', ''); });

  $('admin-save').addEventListener('click', async () => {
    try {
      const body = { localNetId: $('admin-local-netid').value.trim(), plcs: plcs.map(({ status, ...p }) => ({ ...p, netId: String(p.netId).trim(), ip: String(p.ip).trim(), port: Number(p.port) || 851 })) };
      render(await call('plcs', body));
      say('admin-save-msg', 'Saved. Viewers of a changed PLC go live again; new ones see the list at once.', true);
    } catch (err) { say('admin-save-msg', err.message, false); }
  });

  $('admin-token-create').addEventListener('click', async () => {
    const name = $('admin-token-name').value.trim();
    if (!name) return say('admin-token-msg', 'Enter who the token is for.', false);
    try {
      const r = await call('tokens', { name, view: $('admin-token-view').checked, expires: $('admin-token-expires').value || undefined, plcs: [...document.querySelectorAll('#admin-token-plcs input:checked')].map((x) => x.value) });
      $('admin-token-expires').value = '';
      $('admin-token-name').value = '';
      $('admin-token-view').checked = false;
      renderTokens(r.state.tokens);
      const copy = el('button', { id: 'admin-token-copy', on: { click: async () => { try { await navigator.clipboard.writeText(r.token); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy it'; } } } }, 'Copy');
      $('admin-token-new').replaceChildren(el('div', { class: 'token' },
        el('div', { class: 'status' }, 'Token for "' + r.name + '": shown only now. Give it to that person.'),
        el('div', { class: 'row mt6' }, el('span', { class: 'mono', id: 'admin-token-value' }, r.token), copy),
        r.boardUrl ? el('div', { class: 'mt6' }, el('div', { class: 'status' }, 'The link for the display (open it on the TV; it shows the operator board, nothing can be done from it):'), el('a', { class: 'mono', id: 'admin-token-board-url', href: r.boardUrl, target: '_blank' }, r.boardUrl)) : ''));
      say('admin-token-msg', '');
    } catch (err) { say('admin-token-msg', err.message, false); }
  });
  $('admin-token-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('admin-token-create').click(); });

  window.addEventListener('beforeunload', (e) => { if (saved && dirty()) { e.preventDefault(); e.returnValue = ''; } });
  // ---- Alerts ----
  let alertRules = [];
  let alertPlcs = [];
  let alertStatus = [];
  const seconds = (ms) => (ms ? String(ms / 1000) : '');
  function renderAlerts() {
    const box = $('admin-alerts');
    box.replaceChildren();
    if (!alertRules.length) box.append(el('p', { class: 'hint' }, 'No alerts yet.'));
    alertRules.forEach((r, i) => {
      const st = alertStatus.find((s) => s.id === r.id);
      const input = (key, props = {}) => el('input', { type: 'text', value: r[key] == null ? '' : String(r[key]), 'data-key': key, ...props, on: { input: (e) => { r[key] = e.target.value; } } });
      const check = (key, label) => el('label', { class: 'row' }, el('input', { type: 'checkbox', checked: r[key] !== false, 'data-key': key, on: { change: (e) => { r[key] = e.target.checked; } } }), label);
      const plc = el('select', { 'data-key': 'plc', on: { change: (e) => { r.plc = e.target.value; } } }, ...alertPlcs.map((p) => el('option', { value: p.id, selected: p.id === r.plc }, p.name + ' (' + p.id + ')')));
      const format = el('select', { 'data-key': 'format', on: { change: (e) => { r.format = e.target.value; } } }, ...[['teams', 'Teams'], ['slack', 'Slack'], ['json', 'JSON (any endpoint)']].map(([v, t]) => el('option', { value: v, selected: v === (r.format || 'json') }, t)));
      const stuck = el('input', { type: 'number', min: '1', step: 'any', value: seconds(r.stuckAfterMs), 'data-key': 'stuckAfterMs', on: { input: (e) => { r.stuckAfterMs = e.target.value ? Number(e.target.value) * 1000 : null; } } });
      const limits = el('input', { type: 'text', class: 'mono', 'data-key': 'stateLimits', placeholder: 'TABLEMANAGER_HOMMING=30, ...', value: Object.entries(r.stateLimits || {}).map(([k, v]) => k + '=' + v / 1000).join(', '), on: { input: (e) => {
        const out = {};
        for (const part of e.target.value.split(',')) { const [k, v] = part.split('='); if (k && k.trim() && Number(v) > 0) out[k.trim()] = Number(v) * 1000; }
        r.stateLimits = out;
      } } });
      const result = el('span', { class: 'status' }, st ? st.state + ': ' + st.message + (st.lastAlert ? ' (last: ' + st.lastAlert.kind + ' ' + st.lastAlert.machine + ' ' + new Date(st.lastAlert.at).toLocaleString() + ')' : '') : 'not saved yet');
      if (st) result.className = 'status ' + (st.state === 'watching' ? 'ok' : st.state === 'error' ? 'bad' : 'busy');
      const grid = el('table', {}, el('tbody', {},
        el('tr', {}, el('th', {}, 'Name'), el('td', {}, input('name')), el('th', {}, 'PLC'), el('td', {}, plc)),
        el('tr', {}, el('th', {}, 'Root'), el('td', {}, input('root', { class: 'mono', placeholder: 'MAIN.mainStateMachine' })), el('th', {}, 'State variable'), el('td', {}, input('stateVar', { class: 'mono', placeholder: 'machineState' }))),
        el('tr', {}, el('th', {}, 'Stuck after (s)'), el('td', {}, stuck), el('th', {}, 'Per state (s)'), el('td', {}, limits)),
        el('tr', {}, el('th', {}, 'Error states'), el('td', {}, el('div', { class: 'row nowrap' }, check('onError', 'alert'), input('errorPattern', { class: 'mono', placeholder: 'ERROR|FAULT|ALARM|E_?STOP|ABORT' }))), el('th', {}, 'Recovery'), el('td', {}, check('notifyRecovery', 'also when it recovers'))),
        el('tr', {}, el('th', {}, 'The PLC'), el('td', { colSpan: 3 }, check('onPlcStop', 'alert when it stops running (Stop, no program) or stops answering'))),
        el('tr', {}, el('th', {}, 'Webhook'), el('td', {}, input('webhook', { class: 'mono', placeholder: 'https://... (empty: the operator board and the history only)' })), el('th', {}, 'Format'), el('td', {}, format)),
        el('tr', {}, el('th', {}, 'Escalate after (min)'), el('td', {}, el('input', { type: 'number', min: '1', value: r.escalateAfterMin == null ? '' : String(r.escalateAfterMin), 'data-key': 'escalateAfterMin', placeholder: 'not acknowledged: post again', on: { input: (e) => { r.escalateAfterMin = e.target.value ? Number(e.target.value) : null; } } })), el('th', {}, 'Escalation webhook'), el('td', {}, input('escalateWebhook', { class: 'mono', placeholder: 'https://... (empty: the webhook above)' }))),
        el('tr', {}, el('th', {}, 'Quiet hours'), el('td', { colSpan: 3 }, input('quietHours', { class: 'mono', placeholder: 'no alerts then, e.g. Mon-Fri 22:00-06:00; Sat,Sun' }))),
      ));
      const test = el('button', { class: 'admin-alert-test', on: { click: async () => {
        test.disabled = true;
        try { const res = await call('alerts/test', { webhook: r.webhook, format: r.format }); say('admin-alerts-msg', res.message, res.ok); }
        catch (err) { say('admin-alerts-msg', err.message, false); }
        test.disabled = false;
      } } }, 'Send a test message');
      box.append(el('div', { class: 'token admin-alert', 'data-alert': r.id || String(i) },
        el('div', { class: 'row' }, check('enabled', 'On'), el('span', { class: 'grow' }), result, test, el('button', { class: 'danger', on: { click: () => { alertRules.splice(i, 1); renderAlerts(); } } }, 'Remove')),
        grid));
    });
  }
  const loadAlerts = async () => {
    const a = await call('alerts');
    alertRules = a.rules.map((r) => ({ ...r }));
    alertPlcs = a.plcs;
    alertStatus = a.status;
    renderAlerts();
  };
  $('admin-alert-add').addEventListener('click', () => {
    if (!alertPlcs.length) return say('admin-alerts-msg', 'Add and save a PLC first.', false);
    alertRules.push({ id: 'alert' + (Date.now() % 100000), name: 'Stuck or in error', enabled: true, plc: alertPlcs[0].id, root: 'MAIN.mainStateMachine', stateVar: 'machineState', stuckAfterMs: 300000, stateLimits: {}, onError: true, errorPattern: 'ERROR|FAULT|ALARM|E_?STOP|ABORT', notifyRecovery: true, webhook: '', format: 'teams' });
    renderAlerts();
  });
  $('admin-alerts-save').addEventListener('click', async () => {
    try {
      const a = await call('alerts', { rules: alertRules });
      alertRules = a.rules.map((r) => ({ ...r }));
      alertStatus = a.status;
      renderAlerts();
      say('admin-alerts-msg', 'Saved: the gateway follows them now.', true);
      window.setTimeout(() => loadAlerts().catch(() => {}), 2500);
    } catch (err) { say('admin-alerts-msg', err.message, false); }
  });
  loadAlerts().catch(() => {});
  window.setInterval(() => { if (!document.activeElement || !$('admin-alerts').contains(document.activeElement)) call('alerts').then((a) => { alertStatus = a.status; alertPlcs = a.plcs; for (const s of a.status) { const card = document.querySelector('.admin-alert[data-alert="' + s.id + '"] .status'); if (card) { card.textContent = s.state + ': ' + s.message + (s.lastAlert ? ' (last: ' + s.lastAlert.kind + ' ' + s.lastAlert.machine + ' ' + new Date(s.lastAlert.at).toLocaleString() + ')' : ''); card.className = 'status ' + (s.state === 'watching' ? 'ok' : s.state === 'error' ? 'bad' : 'busy'); } } }).catch(() => {}); }, 5000);

  // ---- Saved boards ----
  let boardList = [];
  let boardPlcs = [];
  function renderBoards() {
    const box = $('admin-boards');
    box.replaceChildren();
    if (!boardList.length) box.append(el('p', { class: 'hint' }, 'No saved boards: /?board shows all PLCs.'));
    boardList.forEach((b, i) => {
      const input = (key, props = {}) => el('input', { type: 'text', value: b[key] == null ? '' : String(b[key]), 'data-key': key, ...props, on: { input: (e) => { b[key] = e.target.value; } } });
      const ticks = el('div', { class: 'row' }, ...boardPlcs.map((p) => el('label', { class: 'row nowrap' }, el('input', { type: 'checkbox', checked: (b.plcs || []).includes(p.id), 'data-plc': p.id, on: { change: (e) => { b.plcs = e.target.checked ? [...(b.plcs || []), p.id] : (b.plcs || []).filter((x) => x !== p.id); } } }), p.name)));
      const link = el('a', { href: '/?board=' + encodeURIComponent(b.id || ''), target: '_blank', class: 'mono' }, '/?board=' + (b.id || ''));
      box.append(el('div', { class: 'token admin-board', 'data-board': b.id || String(i) },
        el('div', { class: 'row' }, el('span', {}, 'Open: '), link, el('span', { class: 'grow' }), el('button', { class: 'danger', on: { click: () => { boardList.splice(i, 1); renderBoards(); } } }, 'Remove')),
        el('table', {}, el('tbody', {},
          el('tr', {}, el('th', {}, 'Id'), el('td', {}, input('id', { class: 'mono', placeholder: 'line202' })), el('th', {}, 'Title'), el('td', {}, input('title', { placeholder: 'Line 202' }))),
          el('tr', {}, el('th', {}, 'PLCs'), el('td', { colSpan: 3 }, ticks)),
          el('tr', {}, el('th', {}, 'Root'), el('td', {}, input('root', { class: 'mono', placeholder: 'MAIN.mainStateMachine' })), el('th', {}, 'Stuck after (s)'), el('td', {}, el('input', { type: 'number', min: '1', value: b.stuck == null ? '' : String(b.stuck), 'data-key': 'stuck', placeholder: 'for PLCs without an alert rule', on: { input: (e) => { b.stuck = e.target.value ? Number(e.target.value) : null; } } }))),
        ))));
    });
  }
  const loadBoards = async () => {
    const a = await call('boards');
    boardList = a.boards.map((b) => ({ ...b, plcs: [...(b.plcs || [])] }));
    boardPlcs = a.plcs;
    renderBoards();
  };
  $('admin-board-add').addEventListener('click', () => {
    boardList.push({ id: 'board' + (boardList.length + 1), title: '', plcs: [], root: 'MAIN.mainStateMachine', stuck: null });
    renderBoards();
  });
  $('admin-boards-save').addEventListener('click', async () => {
    try {
      const a = await call('boards', { boards: boardList });
      boardList = a.boards.map((b) => ({ ...b, plcs: [...(b.plcs || [])] }));
      renderBoards();
      say('admin-boards-msg', 'Saved: open boards pick it up when they load again.', true);
    } catch (err) { say('admin-boards-msg', err.message, false); }
  });
  loadBoards().catch(() => {});

  // ---- Recordings ----
  let recRules = [];
  let recPlcs = [];
  let recStatus = [];
  function renderRecordings() {
    const box = $('admin-recordings');
    box.replaceChildren();
    if (!recRules.length) box.append(el('p', { class: 'hint' }, 'No recordings yet.'));
    recRules.forEach((r, i) => {
      const st = recStatus.find((s) => s.id === r.id);
      const input = (key, props = {}) => el('input', { type: 'text', value: r[key] == null ? '' : String(r[key]), 'data-key': key, ...props, on: { input: (e) => { r[key] = e.target.value; } } });
      const plc = el('select', { 'data-key': 'plc', on: { change: (e) => { r.plc = e.target.value; } } }, ...recPlcs.map((p) => el('option', { value: p.id, selected: p.id === r.plc }, p.name + ' (' + p.id + ')')));
      const status = el('span', { class: 'status ' + (st ? (st.state === 'watching' ? 'ok' : st.state === 'error' ? 'bad' : 'busy') : '') }, st ? st.state + ': ' + st.message + (st.days.length ? ' · ' + st.days.length + ' day(s) kept, from ' + st.days[0] : '') : 'not saved yet');
      box.append(el('div', { class: 'token admin-recording', 'data-recording': r.id || String(i) },
        el('div', { class: 'row' }, el('label', { class: 'row nowrap' }, el('input', { type: 'checkbox', checked: r.enabled !== false, on: { change: (e) => { r.enabled = e.target.checked; } } }), 'On'), el('span', { class: 'grow' }), status, el('button', { class: 'danger', on: { click: () => { recRules.splice(i, 1); renderRecordings(); } } }, 'Remove')),
        el('table', {}, el('tbody', {},
          el('tr', {}, el('th', {}, 'Id'), el('td', {}, input('id', { class: 'mono' })), el('th', {}, 'Name'), el('td', {}, input('name'))),
          el('tr', {}, el('th', {}, 'PLC'), el('td', {}, plc), el('th', {}, 'Keep (days)'), el('td', {}, el('input', { type: 'number', min: '1', max: '366', value: String(r.days ?? 7), 'data-key': 'days', on: { input: (e) => { r.days = Number(e.target.value); } } }))),
          el('tr', {}, el('th', {}, 'Root'), el('td', {}, input('root', { class: 'mono', placeholder: 'MAIN.mainStateMachine' })), el('th', {}, 'State variable'), el('td', {}, input('stateVar', { class: 'mono', placeholder: 'machineState' }))),
          el('tr', {}, el('th', {}, 'Variables too'), el('td', { colSpan: 3 }, el('input', { type: 'text', class: 'mono', 'data-key': 'vars', value: (r.vars || []).join(', '), placeholder: 'guard values to record, e.g. MAIN.mainStateMachine.smTable1.cmd_bHome', on: { input: (e) => { r.vars = e.target.value.split(/[\\s,;]+/).filter(Boolean); } } }))),
          el('tr', {}, el('th', {}, 'Size limit (MB)'), el('td', {}, el('input', { type: 'number', min: '1', 'data-key': 'maxMB', value: r.maxMB == null ? '' : String(r.maxMB), placeholder: 'none', on: { input: (e) => { r.maxMB = e.target.value ? Number(e.target.value) : null; } } })), el('th', {}, 'Compress past days'), el('td', {}, el('label', { class: 'row nowrap' }, el('input', { type: 'checkbox', checked: r.compress !== false, on: { change: (e) => { r.compress = e.target.checked; } } }), 'gzip'))),
          el('tr', {}, el('th', {}, 'Getting slower (%)'), el('td', {}, el('input', { type: 'number', min: '5', 'data-key': 'slowerPct', value: r.slowerPct == null ? '' : String(r.slowerPct), placeholder: 'off, e.g. 30', on: { input: (e) => { r.slowerPct = e.target.value ? Number(e.target.value) : null; } } })), el('th', {}, 'Its webhook'), el('td', {}, input('slowerWebhook', { class: 'mono', placeholder: 'https://... (empty: the board only)' }))),
        )),
        el('div', { class: 'row mt' }, el('span', { class: 'status' }, st ? 'Disk: ' + (st.bytes / 1048576).toFixed(1) + ' MB, ' + st.days.length + ' day(s) (' + st.compressedDays + ' compressed)' : ''), el('span', { class: 'grow' }), el('button', { class: 'admin-recording-check', on: { click: async () => {
          try { const c = await call('recordings/check', { id: r.id }); say('admin-recordings-msg', c.error || (c.found.length ? c.found.map((x) => x.text).join(' / ') : 'Nothing getting slower'), !c.error); }
          catch (err) { say('admin-recordings-msg', err.message, false); }
        } } }, 'Check for slowdowns now'))));
    });
  }
  const loadRecordings = async () => {
    const a = await call('recordings');
    recRules = a.rules.map((r) => ({ ...r }));
    recPlcs = a.plcs;
    recStatus = a.status;
    renderRecordings();
  };
  $('admin-recording-add').addEventListener('click', () => {
    if (!recPlcs.length) return say('admin-recordings-msg', 'Add and save a PLC first.', false);
    recRules.push({ id: 'rec' + (recRules.length + 1), name: '', enabled: true, plc: recPlcs[0].id, root: 'MAIN.mainStateMachine', stateVar: 'machineState', days: 7 });
    renderRecordings();
  });
  $('admin-recordings-save').addEventListener('click', async () => {
    try {
      const a = await call('recordings', { rules: recRules });
      recRules = a.rules.map((r) => ({ ...r }));
      recStatus = a.status;
      renderRecordings();
      say('admin-recordings-msg', 'Saved: the gateway records them now.', true);
      window.setTimeout(() => loadRecordings().catch(() => {}), 2500);
    } catch (err) { say('admin-recordings-msg', err.message, false); }
  });
  loadRecordings().catch(() => {});

  // ---- PLC projects (kept here; the PLC's copy the golden one) ----
  const projState = { 'in-sync': 'In step with the PLC', updated: 'Downloaded', restored: 'Restored from the PLC', 'no-sources': 'No sources on the PLC', error: 'Error', never: 'Not checked yet' };
  const loadProjects = async () => {
    const a = await call('projects');
    const box = $('admin-projects');
    box.replaceChildren();
    $('admin-projects-sub').textContent = a.enabled ? 'Checked every ' + a.everyMinutes + ' min, ' + a.keep + ' older versions kept, in ' + a.folder : 'Off (projectSync.enabled, allowSources or allowBrowse is false in config.json)';
    if (!a.plcs.length) return box.append(el('p', { class: 'hint' }, 'No PLCs yet.'));
    const rows = el('tbody', {});
    for (const p of a.plcs) {
      const check = el('button', { class: 'admin-project-check', on: { click: async () => {
        check.disabled = true;
        say('admin-projects-msg', p.name + ': checking…');
        try {
          const r = await call('projects/check', { id: p.id });
          say('admin-projects-msg', p.name + ': ' + (projState[r.state] || r.state) + (r.message ? ' (' + r.message + ')' : ''), r.state !== 'error' && r.state !== 'no-sources');
        } catch (err) { say('admin-projects-msg', err.message, false); }
        loadProjects().catch(() => {});
      } } }, 'Check now');
      rows.append(el('tr', { 'data-project-plc': p.id },
        el('td', {}, p.name),
        el('td', { class: 'admin-project-state' }, (p.checking ? 'Checking… ' : '') + (projState[p.state] || p.state)),
        el('td', {}, p.lastCheck ? new Date(p.lastCheck).toLocaleString() : ''),
        el('td', {}, p.downloadedAt ? new Date(p.downloadedAt).toLocaleString() + (p.files ? ' (' + p.files + ' files)' : '') : ''),
        el('td', {}, (p.stale || p.message || '') + (p.history ? ' · ' + p.history + ' older version' + (p.history === 1 ? '' : 's') : '') + (p.downloadedAt ? ' · ' + p.folder : '')),
        el('td', { class: 'right' }, check)));
    }
    box.append(el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'PLC'), el('th', {}, 'State'), el('th', {}, 'Checked'), el('th', {}, 'Its version, downloaded'), el('th', {}, ''), el('th', {}, ''))), rows)));
  };
  loadProjects().catch(() => {});

  // ---- Roles ----
  let rolesData = null;
  const ROLE_IDS = ['operator', 'technician', 'supervisor', 'engineer', 'manager'];
  const EVENT_IDS = ['error', 'stuck', 'plcStopped', 'drive', 'slower', 'plcEvent', 'clock', 'call', 'workorder', 'handover', 'parts', 'change', 'anomaly', 'cert', 'backup', 'recovered', 'escalated'];
  const roleSelect = (value, onChange, none) => {
    const s = el('select', { on: { change: (e) => onChange(e.target.value) } }, el('option', { value: '' }, none || '(the default)'), ...ROLE_IDS.map((r) => el('option', { value: r }, (rolesData.labels[r] || r))));
    s.value = value || '';
    return s;
  };
  const renderRoles = () => {
    const box = $('admin-roles');
    box.replaceChildren();
    const r = rolesData.roles;
    $('admin-roles-on').checked = !!r;
    if (!r) return box.append(el('p', { class: 'hint' }, 'Off: everyone signed in may do everything; a view-only token is a display.'));
    box.append(el('div', { class: 'row' }, 'Everyone else signed in: ', roleSelect(r.default, (v) => { r.default = v; }, '(nothing: only those named below)')));
    // Users: the tokens' names, and the company sign-ins added
    const names = [...new Set([...rolesData.users.filter((u) => !u.view).map((u) => u.name.toLowerCase()), ...Object.keys(r.users)])];
    const users = el('tbody', {});
    for (const n of names) users.append(el('tr', { 'data-role-user': n }, el('td', {}, n), el('td', {}, roleSelect(r.users[n], (v) => { if (v) r.users[n] = v; else delete r.users[n]; }))));
    const newUser = el('input', { placeholder: 'a company sign-in (ann@acme.com)', class: 'admin-role-new-user' });
    box.append(el('h3', {}, 'People'), el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'User (a token\\'s name, a company sign-in)'), el('th', {}, 'Role'))), users)),
      el('div', { class: 'row' }, newUser, el('button', { on: { click: () => { const v = newUser.value.trim().toLowerCase(); if (v) { r.users[v] = r.users[v] || 'operator'; renderRoles(); } } } }, 'Add')));
    // Groups (a company sign-in's groups or app roles)
    const groups = el('tbody', {});
    for (const g of Object.keys(r.groups)) groups.append(el('tr', {}, el('td', {}, g), el('td', {}, roleSelect(r.groups[g], (v) => { if (v) r.groups[g] = v; else delete r.groups[g]; }, '(remove)'))));
    const newGroup = el('input', { placeholder: 'a group or app role of the company sign-in' });
    box.append(el('h3', {}, 'Groups'), el('div', { class: 'scroll' }, el('table', {}, groups)), el('div', { class: 'row' }, newGroup, el('button', { on: { click: () => { const v = newGroup.value.trim(); if (v) { r.groups[v] = 'operator'; renderRoles(); } } } }, 'Add')));
    // Start pages
    const starts = el('tbody', {});
    for (const role of ROLE_IDS) {
      const s = el('select', { 'data-start-role': role, on: { change: (e) => { if (e.target.value) r.startPages[role] = e.target.value; else delete r.startPages[role]; } } }, el('option', { value: '' }, '(the whole board)'), ...rolesData.filters.map((f) => el('option', { value: f.id }, f.name + ' (' + f.audience + ')')));
      s.value = r.startPages[role] || '';
      starts.append(el('tr', {}, el('td', {}, rolesData.labels[role]), el('td', {}, s)));
    }
    box.append(el('h3', {}, 'Start pages (a saved filter of the board, as each role first sees it)'), el('div', { class: 'scroll' }, el('table', {}, starts)));
    // The board pages each role sees
    r.pages = r.pages || {};
    const pageRows = el('tbody', {}, el('tr', {}, el('th', {}, ''), ...rolesData.pages.map((p) => el('th', {}, rolesData.pageLabels[p] || p))));
    for (const role of ROLE_IDS) {
      const list = () => r.pages[role] || rolesData.pageDefaults[role] || rolesData.pages;
      pageRows.append(el('tr', { 'data-pages-role': role }, el('td', {}, rolesData.labels[role]), ...rolesData.pages.map((p) => el('td', {}, el('input', { type: 'checkbox', 'data-page': p, checked: list().includes(p), on: { change: (e) => { const cur = list(); r.pages[role] = rolesData.pages.filter((x) => (x === p ? e.target.checked : cur.includes(x))); } } })))));
    }
    box.append(el('h3', {}, 'Board pages each role sees (what it may do there is still its role)'), el('div', { class: 'scroll' }, el('table', {}, pageRows)));
    // The board language each role starts in
    r.languages = r.languages || {};
    const langRows = el('tbody', {});
    for (const role of ROLE_IDS) {
      const s = el('select', { 'data-lang-role': role, on: { change: (e) => { r.languages[role] = e.target.value; } } }, el('option', { value: 'en' }, 'English'), el('option', { value: 'es' }, 'Español'));
      s.value = r.languages[role] || (rolesData.langDefaults || {})[role] || 'en';
      langRows.append(el('tr', {}, el('td', {}, rolesData.labels[role]), el('td', {}, s)));
    }
    box.append(el('h3', {}, 'Board language each role starts in (each viewer can switch it: EN / ES in the header)'), el('div', { class: 'scroll' }, el('table', {}, langRows)));
    // Notifications
    box.append(el('h3', {}, 'Told of alerts'));
    r.notify.forEach((n, i) => {
      const events = el('span', {}, ...EVENT_IDS.map((ev) => el('label', { class: 'inline' }, el('input', { type: 'checkbox', checked: n.events.includes(ev), on: { change: (e) => { n.events = e.target.checked ? [...n.events, ev] : n.events.filter((x) => x !== ev); } } }), ' ' + ev + ' ')));
      const onCall = el('textarea', { rows: 3, placeholder: 'Who is on call, one a line: Bob; Mon-Fri; 06:00-14:00 (and, for email or SMS, his address or number: ; +15551234567)', value: n.onCall.map((o) => o.name + '; ' + (o.days || 'every day') + '; ' + o.from + '-' + o.to + (o.contact ? '; ' + o.contact : '')).join('\\n'), on: { input: (e) => {
        n.onCall = e.target.value.split('\\n').map((l) => l.split(';').map((x) => x.trim())).filter((p) => p[0]).map((p) => { const [from, to] = (p[2] || '00:00-24:00').split('-').map((x) => x.trim()); return { name: p[0], days: p[1] === 'every day' ? '' : (p[1] || ''), from: from || '00:00', to: to || '24:00', ...(p[3] ? { contact: p[3] } : {}) }; });
      } } });
      box.append(el('div', { class: 'card admin-role-notify' },
        el('div', { class: 'row' }, roleSelect(n.role, (v) => { n.role = v; }, '(choose)'),
          (() => { const ch = el('select', { class: 'admin-notify-channel', on: { change: (e) => { n.channel = e.target.value; renderRoles(); } } }, el('option', { value: 'webhook' }, 'Webhook'), el('option', { value: 'email' }, 'Email'), el('option', { value: 'sms' }, 'SMS')); ch.value = n.channel || 'webhook'; return ch; })(),
          (n.channel === 'email' || n.channel === 'sms')
            ? el('input', { class: 'mono grow admin-notify-to', placeholder: n.channel === 'email' ? 'to: maintenance@acme.com, bob@acme.com (or the on-call people below)' : 'to: +15551234567, … (or the on-call people below)', value: Array.isArray(n.to) ? n.to.join(', ') : (n.to || ''), on: { input: (e) => { n.to = e.target.value; } } })
            : el('input', { class: 'mono grow', placeholder: 'https://… (Teams, Slack or JSON webhook)', value: n.webhook || '', on: { input: (e) => { n.webhook = e.target.value.trim(); } } }),
          (n.channel === 'email' || n.channel === 'sms') ? el('span', {}) : (() => { const f = el('select', { on: { change: (e) => { n.format = e.target.value; } } }, ...['teams', 'slack', 'json'].map((x) => el('option', { value: x }, x))); f.value = n.format || 'teams'; return f; })(),
          el('button', { on: { click: () => { r.notify.splice(i, 1); renderRoles(); } } }, 'Remove')),
        el('div', { class: 'row' }, 'Of: ', events), onCall,
        el('div', { class: 'row' }, 'or the on-call person of the rotation ', el('input', { class: 'admin-notify-rotation', placeholder: 'Maintenance (a rotation below)', value: n.rotation || '', on: { input: (e) => { n.rotation = e.target.value.trim(); } } }))));
    });
    box.append(el('button', { on: { click: () => { r.notify.push({ role: 'technician', webhook: '', format: 'teams', events: ['error', 'stuck', 'plcStopped', 'drive', 'call'], onCall: [] }); renderRoles(); } } }, 'Add a channel'));
    // (on-call rotations: who takes turns, handing over each day or week; a channel above names one)
    const rotArea = el('textarea', { id: 'admin-rotations', rows: 3, class: 'grow mono', placeholder: 'One a line: Maintenance | week | 2026-10-19 07:00 | Bob +15551234567, Ann ann@acme.com' });
    const rotMsg = el('div', { class: 'msg', id: 'admin-rotations-msg' });
    const rotPlan = el('div', { class: 'hint flush', id: 'admin-rotations-plan' });
    const showPlan = (d) => { rotArea.value = (d.rotations || []).map((x) => x.name + ' | ' + x.every + ' | ' + String(x.start).replace('T', ' ') + ' | ' + x.people.map((p) => p.name + (p.contact ? ' ' + p.contact : '')).join(', ')).join(NL); rotPlan.replaceChildren(...Object.entries(d.schedule || {}).map(([name, list]) => el('div', { 'data-rotation': name }, name + ': ' + list.map((p) => p.name + ' from ' + new Date(p.from).toLocaleString()).join(', then ')))); };
    call('rotations').then(showPlan).catch(() => {});
    box.append(el('h3', {}, 'On-call rotations'), el('p', { class: 'hint flush' }, 'Who takes turns on call, handing over at its time each day or week. A channel above names its rotation: it tells the one on call now, and, escalated, the next one too. Each email or text carries a link that acknowledges the alert (the address its links use: its public address, under Exports).'), el('div', { class: 'row' }, rotArea), rotPlan,
      el('div', { class: 'row' }, el('span', { class: 'grow' }), el('button', { id: 'admin-rotations-save', on: { click: async () => { try { showPlan(await call('rotations', { lines: rotArea.value.split(NL) })); say('admin-rotations-msg', 'Saved', true); } catch (err) { say('admin-rotations-msg', err.message, false); } } } }, 'Save rotations')), rotMsg);
  };
  const loadRoles = async () => {
    rolesData = await call('roles');
    renderRoles();
  };
  $('admin-roles-on').addEventListener('change', (e) => {
    rolesData.roles = e.target.checked ? (rolesData.roles || { users: {}, groups: {}, default: 'operator', startPages: {}, notify: [] }) : null;
    renderRoles();
  });
  $('admin-roles-save').addEventListener('click', async () => {
    try {
      const r = await call('roles', { roles: rolesData.roles });
      rolesData.roles = r.roles;
      renderRoles();
      say('admin-roles-msg', r.roles ? 'Saved: every board and web app page gets its role when it signs in again' : 'Roles are off', true);
    } catch (err) { say('admin-roles-msg', err.message, false); }
  });
  loadRoles().catch(() => {});

  // ---- Monitoring ----
  const NL = String.fromCharCode(10);
  let mon = null;
  const numIn = (obj, key, attrs) => el('input', Object.assign({ type: 'number', value: obj[key] == null ? '' : String(obj[key]), 'data-key': key, class: 'num', on: { input: (e) => { obj[key] = e.target.value === '' ? '' : Number(e.target.value); } } }, attrs || {}));
  const txtIn = (obj, key, attrs) => el('input', Object.assign({ type: 'text', value: obj[key] == null ? '' : String(obj[key]), 'data-key': key, on: { input: (e) => { obj[key] = e.target.value; } } }, attrs || {}));
  const chk = (obj, key, label, dflt) => el('label', { class: 'inline' }, el('input', { type: 'checkbox', 'data-key': key, checked: obj[key] == null ? dflt !== false : !!obj[key], on: { change: (e) => { obj[key] = e.target.checked; } } }), ' ' + label);
  const area = (value, onInput, attrs) => el('textarea', Object.assign({ rows: 4, value, on: { input: (e) => onInput(e.target.value) } }, attrs || {}));
  const renderMonitoring = () => {
    const box = $('admin-monitoring');
    box.replaceChildren();
    const m = mon;
    // Which monitors on which PLC
    const KINDS = [['drives', 'Drives'], ['faults', 'Fault records'], ['fleet', 'I/O fleet'], ['projectSync', 'Project copy']];
    const on = (kind, id) => m[kind].enabled !== false && (!Array.isArray(m[kind].plcs) || !m[kind].plcs.length || m[kind].plcs.includes(id));
    const setOn = (kind, id, v) => {
      const all = m.plcs.map((p) => p.id);
      let list = Array.isArray(m[kind].plcs) && m[kind].plcs.length ? m[kind].plcs.slice() : all.slice();
      if (m[kind].enabled === false) { list = []; m[kind].enabled = true; }
      list = v ? [...new Set([...list, id])] : list.filter((x) => x !== id);
      if (!list.length) { m[kind].enabled = false; m[kind].plcs = []; } else m[kind].plcs = list.length === all.length ? [] : list;
    };
    const rows = el('tbody', {});
    for (const p of m.plcs) rows.append(el('tr', { 'data-monitor-plc': p.id }, el('td', {}, p.name), ...KINDS.map(([k]) => el('td', {}, el('input', { type: 'checkbox', 'data-monitor': k, checked: on(k, p.id), on: { change: (e) => setOn(k, p.id, e.target.checked) } })))));
    box.append(el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'PLC'), ...KINDS.map(([, l]) => el('th', {}, l)))), rows)));
    // Drives
    const d = m.drives;
    d.limits = d.limits || {};
    for (const k of ['heatsinkRise', 'currentRise', 'utilisation', 'peerHotter']) d.limits[k] = d.limits[k] || {};
    box.append(el('h3', {}, 'Drives'),
      el('div', { class: 'row' }, 'Read every ', numIn(d, 'everySeconds', { min: 5, placeholder: '30' }), ' s; hours and counters every ', numIn(d, 'slowEveryMinutes', { min: 1, placeholder: '10' }), ' min; kept ', numIn(d, 'keepDays', { min: 2, placeholder: '90' }), ' days; its settings (a change: to explain) every ', numIn(d, 'settingsEveryHours', { min: 1, placeholder: '24' }), ' h'),
      el('div', { class: 'row' }, 'Warmer than its past: watch ', numIn(d.limits.heatsinkRise, 'watch', { placeholder: '5' }), ' °C, warning ', numIn(d.limits.heatsinkRise, 'warn', { placeholder: '8' }), ' °C; more current at the same speed: watch ', numIn(d.limits.currentRise, 'watch', { placeholder: '10' }), ' %, warning ', numIn(d.limits.currentRise, 'warn', { placeholder: '20' }), ' %'),
      el('div', { class: 'row' }, 'i²t / ixt: warning ', numIn(d.limits.utilisation, 'warn', { placeholder: '80' }), ' %, alarm ', numIn(d.limits.utilisation, 'alarm', { placeholder: '95' }), ' %; hotter than its siblings: watch ', numIn(d.limits.peerHotter, 'watch', { placeholder: '6' }), ' °C, warning ', numIn(d.limits.peerHotter, 'warn', { placeholder: '10' }), ' °C'),
      (() => {
        // (each PLC's mains signal: its drives without mains then its machine powered down, one line)
        if (typeof d.mains === 'string') d.mains = Object.fromEntries(m.plcs.map((p) => [p.id, d.mains]));
        d.mains = d.mains || {};
        return el('div', { class: 'row', id: 'admin-drives-mains' }, 'Mains signal (a BOOL, TRUE: on; NOT x: TRUE off; empty: from its drives) ', ...m.plcs.map((p) => el('label', {}, p.name, ' ', txtIn(d.mains, p.id, { class: 'mono', placeholder: 'MAIN.bMainsOn', 'data-mains-plc': p.id }))));
      })(),
      el('div', { class: 'row' }, 'Its alerts also to ', txtIn(d, 'webhook', { class: 'mono grow', placeholder: 'https://… (empty: the boards only)' }), (() => { const s = el('select', { on: { change: (e) => { d.format = e.target.value; } } }, ...['teams', 'slack', 'json'].map((x) => el('option', { value: x }, x))); s.value = d.format || 'teams'; return s; })()));
    // Fault records
    const f = m.faults;
    f.signals = f.signals || {};
    box.append(el('h3', {}, 'Fault records'),
      el('div', { class: 'row' }, 'Keep ', numIn(f, 'preSeconds', { min: 5, placeholder: '60' }), ' s before and ', numIn(f, 'postSeconds', { min: 5, placeholder: '60' }), ' s after each fault, ', numIn(f, 'keepDays', { min: 1, placeholder: '30' }), ' days; the machines under ', txtIn(f, 'root', { class: 'mono', placeholder: 'the root of the alert rule, else MAIN.mainStateMachine' })),
      ...m.plcs.map((p) => el('div', { class: 'row' }, el('span', { class: 'label' }, p.name + ': its signals kept with its faults'), area((f.signals[p.id] || []).join(NL), (v) => { f.signals[p.id] = v.split(NL).map((x) => x.trim()).filter(Boolean); }, { class: 'mono grow', rows: 2, placeholder: 'MAIN.fbDoor.bClosed (one a line)', 'data-fault-signals': p.id }))));
    // I/O fleet and the Risk page
    const fl = m.fleet;
    fl.limits = fl.limits || {};
    box.append(el('h3', {}, 'I/O fleet and the Risk page'),
      el('div', { class: 'row' }, 'The EtherCAT states every ', numIn(fl, 'everySeconds', { min: 10, placeholder: '60' }), ' s; CRC errors in 7 days: watch ', numIn(fl.limits, 'crcWatch', { placeholder: '5' }), ', warning ', numIn(fl.limits, 'crcWarn', { placeholder: '50' }), '; a heatsink trend within ', numIn(fl.limits, 'etaDays', { placeholder: '90' }), ' days (a warning within ', numIn(fl.limits, 'etaWarnDays', { placeholder: '14' }), '); a machine faulting more: ', numIn(fl.limits, 'faultsWatch', { placeholder: '5' }), ' a week'));
    // Project copies
    const ps = m.projectSync;
    box.append(el('h3', {}, 'Project copies'), el('div', { class: 'row' }, 'Checked every ', numIn(ps, 'everyMinutes', { min: 1, placeholder: '10' }), ' min; ', numIn(ps, 'keep', { min: 1, placeholder: '20' }), ' older versions kept'));
    // OEE
    const o = m.oee;
    o.machines = o.machines || [];
    o.weekly = o.weekly || {};
    const mt = el('tbody', {});
    o.machines.forEach((x, i) => mt.append(el('tr', { 'data-oee-machine': String(i) },
      el('td', {}, (() => { const s = el('select', { on: { change: (e) => { x.plc = e.target.value; } } }, ...m.plcs.map((p) => el('option', { value: p.id }, p.name))); s.value = x.plc || (m.plcs[0] || {}).id || ''; x.plc = s.value; return s; })()),
      el('td', {}, txtIn(x, 'machine', { class: 'mono', placeholder: 'MAIN.mainStateMachine.smTable1' })),
      el('td', {}, txtIn(x, 'type', { class: 'mono', placeholder: 'or its type: SM_TableManager' })),
      el('td', {}, txtIn(x, 'cycleState', { class: 'mono', placeholder: 'TABLEMANAGER_DONE' })),
      el('td', {}, numIn(x, 'idealCycleSec', { min: 0.1, step: 'any', placeholder: '42' })),
      el('td', {}, txtIn(x, 'goodVar', { class: 'mono', placeholder: 'good parts (counter)' })),
      el('td', {}, txtIn(x, 'badVar', { class: 'mono', placeholder: 'bad parts (counter)' })),
      el('td', {}, el('button', { on: { click: () => { o.machines.splice(i, 1); renderMonitoring(); } } }, 'Remove')))));
    box.append(el('h3', {}, 'OEE'),
      el('div', { class: 'row' }, 'Ask Why? after a stop of ', numIn(o, 'reasonAfterMin', { min: 0, placeholder: '2' }), ' min'),
      el('div', { class: 'row' }, el('span', { class: 'label' }, 'The reasons offered (one a line)'), area((o.reasons && o.reasons.length ? o.reasons : mon.defaults.reasons).join(NL), (v) => { o.reasons = v.split(NL); }, { class: 'grow', id: 'admin-oee-reasons' })),
      el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'PLC'), el('th', {}, 'Machine'), el('th', {}, 'or its type'), el('th', {}, 'Cycle state'), el('th', {}, 'Ideal cycle (s)'), el('th', {}, 'Good count'), el('th', {}, 'Bad count'), el('th', {}, ''))), mt)),
      el('button', { id: 'admin-oee-add', on: { click: () => { o.machines.push({ plc: (m.plcs[0] || {}).id, cycleState: '', idealCycleSec: '' }); renderMonitoring(); } } }, 'Add the cycle of a machine'),
      (() => {
        // (each PLC's product, or recipe, variable: OEE per product; each product's own ideal cycle)
        o.products = o.products || {};
        const wrap = el('div', { id: 'admin-oee-products' }, el('div', { class: 'label' }, 'By product: the variable a PLC holds its product (or recipe) in, and the ideal cycle of each product (one a line: Door 36 = 40)'));
        for (const p of m.plcs) {
          const x = (o.products[p.id] = o.products[p.id] || {});
          wrap.append(el('div', { class: 'row', 'data-products-plc': p.id }, p.name, ' ', txtIn(x, 'var', { class: 'mono', placeholder: 'GVL.sRecipe' }), ' ', area(Object.entries(x.idealCycleSec || {}).map(([k, v]) => k + ' = ' + v).join(NL), (v) => { x.idealLines = v.split(NL); }, { class: 'grow mono', rows: 2, placeholder: 'Door 36 = 40' })));
        }
        return wrap;
      })(),
      el('div', { class: 'row' }, 'Weekly summary on ', txtIn(o.weekly, 'day', { placeholder: 'Mon', size: 4 }), ' at ', txtIn(o.weekly, 'at', { placeholder: '07:00', size: 5 }), ' to ', txtIn(o.weekly, 'webhook', { class: 'mono grow', placeholder: 'https://… (empty: none)' }), ' its link ', txtIn(o.weekly, 'link', { class: 'mono', placeholder: 'https://gateway:8443/?board&page=oee&window=week' })));
    // Energy meters: per PLC, one a line (Main feed = GVL.fEnergy kWh for MAIN.a, MAIN.b); its EL34xx boxes found
    m.energy = m.energy || {};
    const en = m.energy;
    if (!en.meterLines) { en.meterLines = {}; for (const p of m.plcs) en.meterLines[p.id] = (en.meters || []).filter((x) => x.plc === p.id).map((x) => x.name + " = " + x.var + " " + (x.unit || "kWh") + (x.machines && x.machines.length ? " for " + x.machines.join(", ") : "")); }
    const energyBox = el('div', { id: 'admin-energy' });
    for (const p of m.plcs) {
      const found = el('div', { class: 'hint flush' });
      const lineArea = area((en.meterLines[p.id] || []).join(NL), (v) => { en.meterLines[p.id] = v.split(NL); }, { class: 'grow mono', rows: 2, 'data-energy-plc': p.id, placeholder: 'Main feed = GVL.fEnergy kWh for MAIN.fbCell.smTable1' });
      const findBtn = el('button', { 'data-energy-find': p.id, on: { click: async () => {
        found.textContent = 'Reading its I/O ...';
        try {
          const r = await call('energy/find', { plc: p.id });
          found.replaceChildren(...(r.boxes.length ? r.boxes.map((b) => el('div', { class: 'energy-found' }, b.box + ' (' + (b.product || 'EL34xx') + '): ', ...(b.links.length ? b.links.map((l) => el('a', { href: '#', 'data-energy-var': l.variable, on: { click: (ev) => { ev.preventDefault(); lineArea.value = (lineArea.value ? lineArea.value + NL : '') + b.box + ' = ' + l.variable + ' kWh'; en.meterLines[p.id] = lineArea.value.split(NL); } } }, l.entry + ' → ' + l.variable + ' ')) : ['no PLC variable linked to it: link its energy to one in the PLC']))) : [el('span', {}, 'No EL34xx box in its I/O')]));
        } catch (err) { found.textContent = err.message; }
      } } }, 'Find its EL34xx');
      energyBox.append(el('div', { class: 'row' }, el('span', { class: 'label' }, p.name), lineArea, findBtn), found);
    }
    box.append(el('h3', {}, 'Energy per part'), el('p', { class: 'hint flush' }, 'Each meter a PLC variable: its energy (Wh, kWh, MWh: a counter) or its power (W, kW). Its energy over the parts its machines made (all of its PLC, or those after for) on the OEE page. A pick below adds a line: set its unit.'), energyBox,
      el('div', { class: 'row' }, 'Price ', numIn(en, 'price', { placeholder: '0.18', step: 'any' }), ' a kWh, in ', txtIn(en, 'currency', { placeholder: 'USD', size: 5 })));
    // Andon and work orders
    const a = m.andon;
    box.append(el('h3', {}, 'Andon and calls'),
      el('div', { class: 'row' }, el('span', { class: 'label' }, 'What to do, by state (STATE = text, one a line; Type.STATE for one type)'), area(Object.entries(a.steps || {}).map(([k, v]) => k + ' = ' + v).join(NL), (v) => { a.steps = v.split(NL); }, { class: 'mono grow', rows: 4, id: 'admin-andon-steps', placeholder: 'DOOR_DASHER_ERROR = Check the door sensor S12, then press Reset' })),
      el('div', { class: 'row' }, el('span', { class: 'label' }, 'Reasons to call maintenance (one a line)'), area((a.callReasons && a.callReasons.length ? a.callReasons : mon.defaults.callReasons).join(NL), (v) => { a.callReasons = v.split(NL); }, { class: 'grow', rows: 3 })),
      el('div', { class: 'row' }, chk(m.workorders, 'fromCalls', 'A call for maintenance makes a work order by itself', true)),
      el('div', { class: 'row' }, chk(m.workorders, 'signOff', 'Work orders done are signed off by a supervisor or an engineer (the board counts those not yet)', false)),
      el('div', { class: 'row' }, el('span', { class: 'label' }, 'Checklists for work orders (one a line: its name, a colon, its steps by semicolons)'), area((m.workorders.checklists || []).map((c) => c.name + ': ' + c.items.join('; ')).join(NL), (v) => { m.workorders.checklistLines = v.split(NL); }, { class: 'grow', rows: 3, id: 'admin-checklists', placeholder: 'Motor change: Lock out and tag out; Swap the motor; Check its rotation; Remove the lockout' })));
  };
  const loadMonitoring = async () => {
    mon = await call('monitoring');
    renderMonitoring();
  };
  $('admin-monitoring-save').addEventListener('click', async () => {
    try {
      const body = JSON.parse(JSON.stringify(mon));
      // (the steps: STATE = text lines)
      if (Array.isArray(body.andon.steps)) body.andon.steps = body.andon.steps.join(NL);
      await call('monitoring', body);
      say('admin-monitoring-msg', 'Saved: the monitors take it at once', true);
      await loadMonitoring();
    } catch (err) { say('admin-monitoring-msg', err.message, false); }
  });
  loadMonitoring().catch(() => {});

  // ---- Certificate ----
  const loadCert = async () => {
    const d = await call('cert');
    const i = d.info;
    $('admin-cert-names').placeholder = 'its names and addresses: empty, this computer: ' + (d.own || []).join(', ');
    $('admin-cert-info').textContent = !i ? 'No certificate: the gateway runs without TLS (insecure)' : i.error ? i.error : (i.subject + ' · from ' + i.issuer + (i.selfSigned ? ' (self-signed)' : '') + ' · until ' + i.validTo.slice(0, 10) + ' (' + i.daysLeft + ' days) · ' + i.names.join(', ') + (d.pending ? ' · a request waits for its certificate' : ''));
    $('admin-cert-info').className = 'hint ' + (i && !i.error && i.daysLeft <= 30 ? 'bad' : '');
  };
  const certDone = async (p, label) => {
    try { const r = await p; await loadCert(); say('admin-cert-msg', label + ': ' + r.subject + ' until ' + r.validTo.slice(0, 10) + ', taken at once', true); } catch (err) { say('admin-cert-msg', err.message, false); }
  };
  $('admin-cert-self').addEventListener('click', () => {
    if (!window.confirm('Replace the certificate with a new self-signed one?')) return;
    void certDone(call('cert/selfsigned', { names: $('admin-cert-names').value }), 'A new self-signed certificate');
  });
  $('admin-cert-csr').addEventListener('click', async () => {
    try {
      const r = await call('cert/csr', { names: $('admin-cert-names').value, organization: $('admin-cert-org').value });
      $('admin-cert-pem').value = r.csr;
      await loadCert();
      say('admin-cert-msg', 'The request for ' + r.commonName + ' (' + r.names.join(', ') + '): send it to your CA (copied above), then paste the certificate it issues there', true);
    } catch (err) { say('admin-cert-msg', err.message, false); }
  });
  $('admin-cert-install').addEventListener('click', () => void certDone(call('cert/install', { pem: $('admin-cert-pem').value }), 'Installed'));
  $('admin-cert-pfx-btn').addEventListener('click', async () => {
    const f = $('admin-cert-pfx').files[0];
    if (!f) { say('admin-cert-msg', 'Choose its PFX file', false); return; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    void certDone(call('cert/pfx', { pfx: btoa(bin), passphrase: $('admin-cert-pfx-pass').value }), 'The PFX installed');
  });
  loadCert().catch(() => {});

  // ---- Backup ----
  const loadBackups = async () => {
    const d = await call('backups');
    const rows = (d.backups || []).map((b) => el('tr', {}, el('td', { class: 'mono' }, el('a', { href: '/admin/backup/' + b.name, class: 'admin-backup-link' }, b.name)), el('td', {}, Math.round(b.size / 1024) + ' kB'), el('td', {}, new Date(b.at).toLocaleString())));
    $('admin-backups').replaceChildren(rows.length ? el('div', { class: 'scroll' }, el('table', {}, el('tbody', {}, ...rows))) : el('p', { class: 'hint' }, 'No backup yet.'));
  };
  $('admin-backup-make').addEventListener('click', async () => {
    say('admin-backup-msg', 'Making it ...');
    try {
      const r = await call('backup', { passphrase: $('admin-backup-pass').value, recordings: $('admin-backup-recordings').checked, faults: $('admin-backup-faults').checked });
      $('admin-backup-pass').value = '';
      await loadBackups();
      say('admin-backup-msg', r.name + ': ' + r.files + ' files, ' + Math.round(r.size / 1024) + ' kB (its link above: keep it with its passphrase)', true);
    } catch (err) { say('admin-backup-msg', err.message, false); }
  });
  $('admin-restore').addEventListener('click', async () => {
    const f = $('admin-restore-file').files[0];
    if (!f) { say('admin-backup-msg', 'Choose a backup (.kvalbk)', false); return; }
    if (!window.confirm('Restore ' + f.name + '? The gateway as it is now is kept first (before-restore).')) return;
    say('admin-backup-msg', 'Restoring ...');
    try {
      const r = await fetch('/admin/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Passphrase': encodeURIComponent($('admin-restore-pass').value) }, body: f });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      await loadBackups();
      say('admin-backup-msg', 'Restored: ' + d.files + ' files, PLCs ' + d.plcs.join(', ') + '. Restart the gateway to take it all (the state before: ' + d.before + ')', true);
    } catch (err) { say('admin-backup-msg', err.message, false); }
  });
  $('admin-restart').addEventListener('click', async () => {
    try { await call('restart', {}); say('admin-backup-msg', 'Restarting: back within a minute', true); } catch (err) { say('admin-backup-msg', err.message, false); }
  });
  loadBackups().catch(() => {});
  // (the scheduled backups: their settings, their passphrase set or not, their last run)
  const showSchedule = (d) => {
    const sc = d.schedule || {};
    $('admin-bsched-on').checked = !!sc.enabled;
    $('admin-bsched-every').value = sc.every || 'daily';
    $('admin-bsched-day').value = sc.day || 'sun';
    $('admin-bsched-at').value = sc.at || '';
    $('admin-bsched-share').value = sc.share || '';
    $('admin-bsched-keep').value = sc.keep || '';
    $('admin-bsched-rec').checked = !!sc.recordings;
    $('admin-bsched-faults').checked = !!sc.faults;
    $('admin-bsched-pass').placeholder = d.passphraseSet ? 'its passphrase is set (a new one replaces it)' : 'its passphrase (set once; kept here, never shown)';
    const st = d.status;
    $('admin-bsched-status').textContent = st ? 'last: ' + new Date(st.at).toLocaleString() + (st.ok ? ' · ' + st.name + (st.copied ? ', copied to ' + st.share : '') : ' · failed: ' + st.error) : 'none made yet';
  };
  call('backup/schedule').then(showSchedule).catch(() => {});
  $('admin-bsched-save').addEventListener('click', async () => {
    try {
      const d = await call('backup/schedule', { passphrase: $('admin-bsched-pass').value || undefined, schedule: { enabled: $('admin-bsched-on').checked, every: $('admin-bsched-every').value, day: $('admin-bsched-day').value, at: $('admin-bsched-at').value, share: $('admin-bsched-share').value, keep: $('admin-bsched-keep').value, recordings: $('admin-bsched-rec').checked, faults: $('admin-bsched-faults').checked } });
      $('admin-bsched-pass').value = '';
      showSchedule(d);
      say('admin-bsched-msg', d.schedule.enabled ? 'Saved: ' + (d.schedule.every === 'weekly' ? 'each ' + d.schedule.day : 'each day') + ' at ' + d.schedule.at : 'Saved (not on)', true);
    } catch (err) { say('admin-bsched-msg', err.message, false); }
  });
  $('admin-bsched-run').addEventListener('click', async () => {
    say('admin-bsched-msg', 'Making it ...');
    try {
      const st = await call('backup/schedule/run', {});
      await loadBackups();
      call('backup/schedule').then(showSchedule).catch(() => {});
      say('admin-bsched-msg', st.ok ? st.name + (st.copied ? ', copied to ' + st.share : '') : 'Failed: ' + st.error, !!st.ok);
    } catch (err) { say('admin-bsched-msg', err.message, false); }
  });

  // ---- Exports ----
  const loadExports = async () => {
    const d = await call('exports');
    $('admin-api-on').checked = d.api.enabled;
    $('admin-public-url').value = d.publicUrl || '';
    $('admin-mqtt-url').value = d.mqtt.url || '';
    $('admin-mqtt-user').value = d.mqtt.username || '';
    $('admin-mqtt-pass').placeholder = d.mqtt.hasPassword ? '(saved: unchanged)' : 'password';
    $('admin-mqtt-prefix').value = d.mqtt.prefix || '';
    $('admin-mqtt-state').textContent = d.mqtt.url ? (d.mqttReady ? 'connected' : 'not connected') : '';
    const k = d.cmms || {};
    $('admin-cmms-method').value = k.method || 'POST';
    $('admin-cmms-url').value = k.url || '';
    $('admin-cmms-id').value = k.idPath || '';
    $('admin-cmms-body').value = k.body || '';
    $('admin-cmms-done-method').value = k.doneMethod || 'POST';
    $('admin-cmms-done-url').value = k.doneUrl || '';
    $('admin-cmms-done-body').value = k.doneBody || '';
    $('admin-cmms-headers').value = k.headers ? JSON.stringify(k.headers) : '';
  };
  $('admin-exports-save').addEventListener('click', async () => {
    try {
      await call('exports', {
        api: { enabled: $('admin-api-on').checked },
        publicUrl: $('admin-public-url').value,
        mqtt: { url: $('admin-mqtt-url').value, username: $('admin-mqtt-user').value, password: $('admin-mqtt-pass').value, prefix: $('admin-mqtt-prefix').value },
        cmms: { method: $('admin-cmms-method').value, url: $('admin-cmms-url').value, idPath: $('admin-cmms-id').value, body: $('admin-cmms-body').value, doneMethod: $('admin-cmms-done-method').value, doneUrl: $('admin-cmms-done-url').value, doneBody: $('admin-cmms-done-body').value, headers: $('admin-cmms-headers').value },
      });
      $('admin-mqtt-pass').value = '';
      await loadExports();
      say('admin-exports-msg', 'Saved: taken at once', true);
    } catch (err) { say('admin-exports-msg', err.message, false); }
  });
  loadExports().catch(() => {});

  // ---- Other gateways ----
  let sitesRows = [];
  const renderSites = (status) => {
    const box = $('admin-sites');
    const rows = sitesRows.map((s, i) => {
      const st = (status || []).find((x) => x.id === s.id);
      const inp = (k, ph, extra) => el('input', Object.assign({ placeholder: ph, value: s[k] || '', on: { input: (e) => { s[k] = e.target.value; } } }, extra || {}));
      return el('tr', { 'data-site-row': String(i) },
        el('td', {}, inp('name', 'Line 4')),
        el('td', {}, inp('url', 'https://gw-line4:8443', { class: 'mono' })),
        el('td', {}, inp('token', s.hasToken ? '(saved: unchanged)' : 'a view-only token of it', { type: 'password' })),
        el('td', {}, el('label', { class: 'inline' }, el('input', { type: 'checkbox', checked: !!s.insecureTls, on: { change: (e) => { s.insecureTls = e.target.checked; } } }), ' its certificate not checked')),
        el('td', { class: 'hint' }, st ? (st.state === 'connected' ? 'Connected: ' + st.plcs.length + ' PLC(s)' : (st.message || st.state)) : ''),
        el('td', {}, el('button', { on: { click: () => { sitesRows.splice(i, 1); renderSites(status); } } }, 'Remove')));
    });
    box.replaceChildren(el('div', { class: 'scroll' }, el('table', {}, el('tbody', {}, el('tr', {}, ...['Name', 'Address', 'Token', '', 'Now', ''].map((x) => el('th', {}, x))), ...rows))));
  };
  const loadSites = async () => {
    const d = await call('sites');
    sitesRows = d.sites || [];
    renderSites(d.status);
  };
  $('admin-site-add').addEventListener('click', () => { sitesRows.push({ name: '', url: '', token: '' }); renderSites(); });
  call('plant').then((d) => {
    const p = d.plantReport || {};
    $('admin-plant-name').value = d.siteName || '';
    $('admin-plant-day').value = p.day || 'mon';
    $('admin-plant-at').value = p.at || '';
    $('admin-plant-to').value = (p.to || []).join(', ');
    $('admin-plant-webhook').value = p.webhook || '';
    $('admin-plant-link').value = p.link || '';
  }).catch(() => {});
  $('admin-plant-save').addEventListener('click', async () => {
    try {
      await call('plant', { siteName: $('admin-plant-name').value, plantReport: { day: $('admin-plant-day').value, at: $('admin-plant-at').value, to: $('admin-plant-to').value, webhook: $('admin-plant-webhook').value, link: $('admin-plant-link').value } });
      say('admin-plant-msg', 'Saved', true);
    } catch (err) { say('admin-plant-msg', err.message, false); }
  });
  $('admin-plant-send').addEventListener('click', async () => {
    say('admin-plant-msg', 'Sending ...');
    try {
      const r = await call('plant/send', {});
      say('admin-plant-msg', r.sent.length ? 'Sent (' + r.sent.join(', ') + ')' : 'Nowhere to send it: an email address or a webhook first', !!r.sent.length);
    } catch (err) { say('admin-plant-msg', err.message, false); }
  });
  $('admin-sites-save').addEventListener('click', async () => {
    try {
      await call('sites', { sites: sitesRows });
      await loadSites();
      say('admin-sites-msg', 'Saved: followed at once', true);
    } catch (err) { say('admin-sites-msg', err.message, false); }
  });
  loadSites().catch(() => {});

  // ---- Email and SMS ----
  const loadChannels = async () => {
    const d = await call('channels');
    const s = d.smtp || {};
    const m = d.sms || {};
    $('admin-smtp-host').value = s.host || '';
    $('admin-smtp-port').value = s.port || '';
    $('admin-smtp-user').value = s.user || '';
    $('admin-smtp-pass').placeholder = s.hasPass ? '(saved: unchanged)' : 'password';
    $('admin-smtp-from').value = s.from || '';
    $('admin-sms-provider').value = m.provider || '';
    $('admin-sms-sid').value = m.accountSid || '';
    $('admin-sms-token').placeholder = m.hasToken ? '(saved: unchanged)' : 'Twilio auth token';
    $('admin-sms-from').value = m.from || '';
    $('admin-sms-url').value = m.url || '';
    $('admin-sms-method').value = m.method || 'POST';
    $('admin-sms-body').value = m.body || '';
  };
  $('admin-channels-save').addEventListener('click', async () => {
    try {
      await call('channels', {
        smtp: { host: $('admin-smtp-host').value, port: $('admin-smtp-port').value, user: $('admin-smtp-user').value, pass: $('admin-smtp-pass').value, from: $('admin-smtp-from').value },
        sms: { provider: $('admin-sms-provider').value, accountSid: $('admin-sms-sid').value, authToken: $('admin-sms-token').value, from: $('admin-sms-from').value, url: $('admin-sms-url').value, method: $('admin-sms-method').value, body: $('admin-sms-body').value },
      });
      $('admin-smtp-pass').value = '';
      $('admin-sms-token').value = '';
      await loadChannels();
      say('admin-channels-msg', 'Saved', true);
    } catch (err) { say('admin-channels-msg', err.message, false); }
  });
  $('admin-test-email-btn').addEventListener('click', async () => {
    say('admin-channels-msg', 'Sending ...');
    try { await call('channelsTest', { kind: 'email', to: $('admin-test-email').value }); say('admin-channels-msg', 'Sent: check that mailbox', true); } catch (err) { say('admin-channels-msg', err.message, false); }
  });
  $('admin-test-sms-btn').addEventListener('click', async () => {
    say('admin-channels-msg', 'Sending ...');
    try { await call('channelsTest', { kind: 'sms', to: $('admin-test-sms').value }); say('admin-channels-msg', 'Sent: check that phone', true); } catch (err) { say('admin-channels-msg', err.message, false); }
  });
  loadChannels().catch(() => {});

  // ---- TwinCAT logged events ----
  const showEventStats = (d) => {
    const parts = (d.plcs || []).map((p) => { const s = (d.stats || {})[p.id]; return (p.name || p.id) + ': ' + (s && s.count ? s.count + ' events, ' + new Date(s.from).toLocaleString() + ' to ' + new Date(s.to).toLocaleString() : 'none yet'); });
    $('admin-eventlog-stats').textContent = parts.join(' · ');
  };
  call('eventlog').then((d) => {
    $('admin-eventlog-plc').replaceChildren(...(d.plcs || []).map((p) => el('option', { value: p.id }, p.name || p.id)));
    showEventStats(d);
    $('admin-eventlog-live').replaceChildren(...(d.plcs || []).map((p) => {
      const st = (d.relay || {})[p.id];
      return el('div', { class: 'row', 'data-eventlog-live': p.id }, el('span', { class: 'label' }, p.name || p.id), el('input', { type: 'text', class: 'mono', 'data-live-plc': p.id, value: (d.live || {})[p.id] || '', placeholder: 'MAIN.fbEventRelay (empty: not live)' }), el('span', { class: 'hint flush' + (st && st.error ? ' bad' : '') }, st ? (st.error ? st.error : 'read, its event ' + (st.seq || 0)) : ''));
    }));
  }).catch(() => {});
  $('admin-eventlog-live-save').addEventListener('click', async () => {
    try {
      const live = {};
      for (const i of document.querySelectorAll('[data-live-plc]')) live[i.getAttribute('data-live-plc')] = i.value;
      const r = await call('eventlog/live', { live });
      say('admin-eventlog-live-msg', Object.keys(r.live).length ? 'Saved: read every 2 s' : 'Saved (none live)', true);
    } catch (err) { say('admin-eventlog-live-msg', err.message, false); }
  });
  $('admin-eventlog-import').addEventListener('click', async () => {
    const f = $('admin-eventlog-file').files[0];
    if (!f) { say('admin-eventlog-msg', 'Choose the CSV the Logged Events window exported', false); return; }
    say('admin-eventlog-msg', 'Importing ...');
    try {
      const r = await call('eventlog', { plc: $('admin-eventlog-plc').value, csv: await f.text() });
      say('admin-eventlog-msg', r.read + ' event(s) read, ' + r.added + ' new' + (r.skipped ? ', ' + r.skipped + ' line(s) not understood' : ''), true);
      showEventStats(await call('eventlog'));
    } catch (err) { say('admin-eventlog-msg', err.message, false); }
  });

  // ---- Check a drive ----
  const hexOf = (n, w) => '0x' + Number(n).toString(16).toUpperCase().padStart(w, '0');
  const showReads = (r) => {
    const rows = (r.reads || []).map((x) => el('tr', { 'data-drive-object': Number(x.index).toString(16) + ':' + x.sub },
      el('td', { class: 'mono' }, hexOf(x.index, 4) + ':' + x.sub),
      el('td', {}, x.label + (x.verified === false ? ' (unverified)' : '')),
      el('td', { class: 'mono' }, x.error ? '' : x.hex),
      el('td', { class: 'mono' }, x.error ? x.error : Object.entries(x.as || {}).map((e) => e[0] + ' ' + e[1]).join(' · ')),
      el('td', { class: 'mono' }, x.value === null || x.value === undefined ? '' : (Math.round(x.value * 1000) / 1000) + (x.unit ? ' ' + x.unit : '') + (x.scale !== 1 ? ' (raw × ' + Number(Number(x.scale).toPrecision(4)) + ')' : ''))));
    $('admin-drive-out').replaceChildren(el('div', { class: 'scroll' }, el('table', {}, el('tbody', {}, el('tr', {}, ...['Object', 'Name', 'Bytes', 'Read as', 'As the board reads it'].map((t) => el('th', {}, t))), ...rows))));
  };
  $('admin-drive-list').addEventListener('click', async () => {
    say('admin-drive-msg', 'Reading its I/O ...');
    try {
      const r = await call('drivecheck', { plc: $('admin-drive-plc').value });
      $('admin-drive-box').replaceChildren(...r.boxes.map((b) => el('option', { value: b.path }, b.name + (b.profile ? ' (' + b.profile.name + ')' : ' (no profile)') + ' · EtherCAT ' + b.address + (b.projectAddress && b.projectAddress !== b.address ? ' (its project: ' + b.projectAddress + ')' : '') + (b.listed ? (b.onBus !== null && b.onBus !== b.address ? ' (its place on the bus: ' + b.onBus + ')' : '') : ' (the master gives no addresses)'))));
      say('admin-drive-msg', r.boxes.length + ' box(es) of other makers than Beckhoff, ' + r.boxes.filter((b) => b.profile).length + ' a profile knows', true);
    } catch (err) { say('admin-drive-msg', err.message, false); }
  });
  const readDrive = async (one) => {
    const body = { plc: $('admin-drive-plc').value, path: $('admin-drive-box').value };
    if (!body.path) { say('admin-drive-msg', 'List its drives, and choose one', false); return; }
    if (one) Object.assign(body, { index: $('admin-drive-index').value.trim(), sub: $('admin-drive-sub').value.trim() || '0', size: Number($('admin-drive-size').value) });
    if ($('admin-drive-at').value.trim()) body.address = Number($('admin-drive-at').value.trim());
    say('admin-drive-msg', 'Reading ...');
    try {
      const r = await call('drivecheck', body);
      showReads(r);
      const bad = r.reads.filter((x) => x.error).length;
      say('admin-drive-msg', r.box.name + ': ' + r.reads.length + ' object(s) read' + (bad ? ', ' + bad + ' not answered' : ''), !bad);
    } catch (err) { say('admin-drive-msg', err.message, false); }
  };
  $('admin-drive-read').addEventListener('click', () => readDrive(false));
  $('admin-drive-scan').addEventListener('click', async () => {
    say('admin-drive-msg', 'Scanning the bus (each address, its identity) ...');
    try {
      const r = await call('drivecheck', { plc: $('admin-drive-plc').value, scan: true });
      const hx = (n) => '#x' + Number(n).toString(16);
      const rows = r.scan.map((x) => el('tr', { 'data-scan-address': String(x.address) },
        el('td', { class: 'mono' }, String(x.address)),
        el('td', { class: 'mono' }, x.error ? x.error : hx(x.vendorId) + ' ' + hx(x.productCode)),
        el('td', {}, x.box ? x.box : '(no box of the project at this address)'),
        el('td', { class: x.box && !x.same && !x.error ? 'bad' : '' }, x.box ? (x.error ? '' : x.same ? 'its own' : 'not its own: expected ' + x.expected) : '')));
      $('admin-drive-out').replaceChildren(el('div', { class: 'scroll' }, el('table', {}, el('tbody', {}, el('tr', {}, ...['Address', 'Identity there (vendor, product)', 'The project box at it', ''].map((t) => el('th', {}, t))), ...rows))));
      say('admin-drive-msg', r.scan.length + ' address(es) answering. A drive of the project not at its own: its identity at another address above (Read its profile with that address)', true);
    } catch (err) { say('admin-drive-msg', err.message, false); }
  });
  $('admin-drive-one').addEventListener('click', () => readDrive(true));
  call('monitoring').then((d) => $('admin-drive-plc').replaceChildren(...(d.plcs || []).map((p) => el('option', { value: p.id }, p.name || p.id)))).catch(() => {});

  // ---- Load (this computer, the gateway, each PLC) ----
  const timeOf = (us) => (us == null ? '' : us >= 1000 ? (us / 1000).toFixed(2) + ' ms' : Math.round(us) + ' µs');
  const loadLoad = async () => {
    const a = await call('load');
    if (!a.machine) return;
    $('admin-load-sub').textContent = a.host + ' (' + a.cores + ' cores): all programs ' + a.machine.cpuPct + ' % CPU, ' + a.machine.freeMemMB + ' of ' + a.machine.totalMemMB + ' MB memory free. The gateway: ' + a.gateway.cpuPct + ' % of one core, ' + a.gateway.rssMB + ' MB, answering within ' + a.gateway.loopP99Ms + ' ms (99 %).';
    const box = $('admin-load');
    box.replaceChildren();
    const rows = el('tbody', {});
    for (const p of a.plcs) {
      const d = (a.drives || []).find((x) => x.plc === p.id);
      const tasks = (p.tasks || []).map((t) => {
        const pct = t.cycleUs && t.execUs != null ? Math.round((t.execUs / t.cycleUs) * 100) : null;
        return t.name.split('_').pop() + ': ' + timeOf(t.execUs) + ' of ' + timeOf(t.cycleUs) + (pct != null ? ' (' + pct + ' %)' : '') + ', longest ' + timeOf(t.maxExecUs) + ', ' + t.overruns + ' overrun' + (t.overruns === 1 ? '' : 's') + (t.overrunsLastHour ? ' (' + t.overrunsLastHour + ' in the last hour)' : '') + (t.rtViolations ? ', ' + t.rtViolations + ' real-time violations' : '');
      });
      rows.append(el('tr', { 'data-load-plc': p.id, class: (p.tasks || []).some((t) => t.overrunsLastHour) ? 'warn' : '' },
        el('td', {}, p.name),
        el('td', {}, p.connected ? 'connected' + (p.plcState ? ', PLC ' + p.plcState : '') : 'not connected'),
        el('td', { class: 'admin-load-shared' }, p.shared ? p.shared.notifications + ' (' + p.shared.uses + ' uses, every ' + p.shared.cycleMs + ' ms on change; ' + p.shared.samplesPerSec + ' changes/s)' : ''),
        el('td', {}, p.live.notifications ? String(p.live.notifications) : ''),
        el('td', { class: 'admin-load-monitors' }, [d ? d.drives + ' drives every ' + Math.round(d.everyMs / 1000) + ' s' : '', (a.faults || []).includes(p.id) ? 'fault records' : '', (a.fleet || []).find((x) => x.plc === p.id) ? 'I/O fleet every ' + Math.round((a.fleet || []).find((x) => x.plc === p.id).everyMs / 1000) + ' s' : '', (a.projects || []).includes(p.id) ? 'project copy' : ''].filter(Boolean).join(', ')),
        el('td', { class: 'admin-load-tasks' }, tasks.join(' · ')),
        el('td', { class: 'admin-load-clock' + (p.clock && Math.abs(p.clock.offsetMs) > 2000 ? ' bad' : '') }, p.clock ? (p.clock.offsetMs >= 0 ? '+' : '') + (p.clock.offsetMs / 1000).toFixed(2) + ' s' + (p.clock.driftMsPerDay !== null ? ', drifts ' + (p.clock.driftMsPerDay / 1000).toFixed(2) + ' s a day' : '') : '')));
    }
    box.append(el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'PLC'), el('th', {}, 'Connection'), el('th', {}, 'Notifications (shared)'), el('th', {}, 'Live diagrams'), el('th', {}, 'Monitors'), el('th', {}, 'Its tasks'), el('th', { title: 'Its clock against the gateway: its DcTaskTime, once a minute' }, 'Clock'))), rows)));
  };
  loadLoad().catch(() => {});
  // (its health: the disk, what is kept, its growth, its retention planned)
  const sizeText = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' kB');
  const loadHealth = async () => {
    const hl = await call('health');
    if (hl.error) { $('admin-health-sub').textContent = hl.error; return; }
    const d = hl.disk;
    $('admin-health-sub').textContent = (d ? 'Its disk: ' + sizeText(d.free) + ' free of ' + sizeText(d.total) + ' (' + d.freePct.toFixed(1) + ' %)' : 'Its disk: not known') + '; its recordings grow ' + sizeText(hl.growthPerDay) + ' a day' + (hl.daysLeft !== null ? ', full in about ' + Math.round(hl.daysLeft) + ' days at that' : '') + (hl.low ? '. LOW: ' + hl.low : '');
    $('admin-health-sub').className = 'grow ' + (hl.low ? 'bad' : '');
    const rows = hl.recordings.map((r) => el('tr', { 'data-health-rec': r.id }, el('td', {}, r.name), el('td', {}, sizeText(r.bytes)), el('td', {}, r.days + ' days'), el('td', {}, sizeText(r.perDay) + ' a day'), el('td', {}, r.keepDays ? 'kept ' + r.keepDays + ' days: ' + sizeText(r.atFull) : 'kept as set')));
    const sugg = hl.plan.suggestions.map((x) => el('li', { 'data-health-keep': x.id }, x.name + ': keep ' + x.keep + ' days (now ' + x.keepDays + ')'));
    $('admin-health').replaceChildren(
      el('div', { class: 'hint flush' }, 'Kept here: ' + hl.folders.map((x) => x.name + ' ' + sizeText(x.bytes)).join(', ')),
      rows.length ? el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Recording'), el('th', {}, 'Kept now'), el('th', {}, 'Days'), el('th', {}, 'Grows'), el('th', {}, 'At full retention'))), el('tbody', {}, ...rows))) : el('p', { class: 'hint' }, 'No recordings.'),
      hl.plan.fits ? el('p', { class: 'hint ok', id: 'admin-health-plan' }, 'At full retention they fit (' + sizeText(hl.plan.needed) + ' more).') : el('div', { id: 'admin-health-plan', class: 'bad' }, 'At full retention they need ' + sizeText(hl.plan.needed) + ' more: more than 80 % of what is free. To fit:', el('ul', {}, ...sugg)));
  };
  loadHealth().catch(() => {});
  $('admin-health-refresh').addEventListener('click', () => loadHealth().catch(() => {}));
  window.setInterval(() => { if (!document.hidden) loadLoad().catch(() => {}); }, 3000);

  // ---- Shift reports ----
  let shiftList = [];
  function renderShifts() {
    const box = $('admin-shifts');
    box.replaceChildren();
    if (!shiftList.length) box.append(el('p', { class: 'hint' }, 'No shifts: one report per day.'));
    shiftList.forEach((x, i) => {
      const input = (key, props = {}) => el('input', { type: 'text', value: x[key] ?? '', 'data-key': key, ...props, on: { input: (e) => { x[key] = e.target.value; } } });
      box.append(el('div', { class: 'row admin-shift' }, input('name', { placeholder: 'Early' }), input('from', { class: 'mono', placeholder: '06:00' }), input('to', { class: 'mono', placeholder: '14:00' }), el('button', { class: 'danger', on: { click: () => { shiftList.splice(i, 1); renderShifts(); } } }, 'Remove')));
    });
  }
  const loadReports = async () => {
    const r = await call('reports');
    shiftList = (r.shifts || []).map((x) => ({ ...x }));
    $('admin-report-webhook').value = (r.reports && r.reports.webhook) || '';
    $('admin-report-format').value = (r.reports && r.reports.format) || 'teams';
    const em = (r.reports && r.reports.email) || {};
    $('admin-report-email').value = (em.to || []).join(', ');
    $('admin-report-when').value = em.when || 'daily';
    $('admin-report-day').value = em.day || 'mon';
    $('admin-report-at').value = em.at || '07:00';
    renderShifts();
  };
  $('admin-shift-add').addEventListener('click', () => { shiftList.push({ name: '', from: '', to: '' }); renderShifts(); });
  $('admin-reports-save').addEventListener('click', async () => {
    try {
      await call('reports', { shifts: shiftList, reports: { webhook: $('admin-report-webhook').value.trim(), format: $('admin-report-format').value, email: { to: $('admin-report-email').value, when: $('admin-report-when').value, day: $('admin-report-day').value, at: $('admin-report-at').value.trim() } } });
      await loadReports();
      say('admin-reports-msg', 'Saved.', true);
    } catch (err) { say('admin-reports-msg', err.message, false); }
  });
  $('admin-report-preview').addEventListener('click', async () => {
    try { const r = await call('reports/preview', { which: 'last' }); say('admin-reports-msg', r.summary.text, true); }
    catch (err) { say('admin-reports-msg', err.message, false); }
  });
  $('admin-report-email-now').addEventListener('click', async () => {
    say('admin-reports-msg', 'Emailing ...');
    try { const r = await call('reports/email', { which: 'last' }); say('admin-reports-msg', r.message, true); }
    catch (err) { say('admin-reports-msg', err.message, false); }
  });
  $('admin-report-send').addEventListener('click', async () => {
    try { const r = await call('reports/send', { which: 'last' }); say('admin-reports-msg', r.message, r.ok); }
    catch (err) { say('admin-reports-msg', err.message, false); }
  });
  loadReports().catch(() => {});

  // ---- Run at startup ----
  const loadService = async () => {
    const st = await call('service');
    const box = $('admin-service-status');
    if (!st.supported) { box.textContent = st.message; box.className = 'status'; ['admin-service-install', 'admin-service-switch', 'admin-service-remove'].forEach((id) => { $(id).disabled = true; }); return; }
    box.textContent = st.installed ? 'Installed (' + (st.status || '?') + ')' : 'Not installed' + (st.elevated ? '' : ' (this gateway does not run as an administrator: it cannot install it)');
    box.className = 'status ' + (st.installed ? 'ok' : '');
    $('admin-service-install').disabled = !st.elevated;
    $('admin-service-remove').disabled = !st.installed || !st.elevated;
    $('admin-service-switch').disabled = !st.installed;
  };
  const serviceAction = (path, question) => async () => {
    if (question && !confirm(question)) return;
    try { const r = await call(path, {}); say('admin-service-msg', r.message + (r.dry ? ' [' + r.dry + ']' : ''), true); await loadService(); }
    catch (err) { say('admin-service-msg', err.message, false); }
  };
  $('admin-service-install').addEventListener('click', serviceAction('service/install'));
  $('admin-service-remove').addEventListener('click', serviceAction('service/remove', 'Remove the startup task? The gateway then only runs while started by hand.'));
  $('admin-service-switch').addEventListener('click', serviceAction('service/switch', 'Stop this gateway and start the task? The page reconnects when it is back (a few seconds).'));
  loadService().catch(() => {});

  // ---- Audit log ----
  let auditRows = [];
  const detailsOf = (e) => Object.entries(e).filter(([k]) => !['t', 'user', 'action'].includes(k)).map(([k, v]) => k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(', ');
  const searchAudit = async () => {
    try {
      const days = Number($('admin-audit-range').value);
      const r = await call('audit/search', { q: $('admin-audit-q').value, from: Date.now() - days * 86400000, to: Date.now() });
      auditRows = r.events;
      const body = $('admin-audit');
      body.replaceChildren(...auditRows.slice(0, 500).map((e) => el('tr', { class: 'admin-audit-row' }, el('td', { class: 'mono' }, new Date(e.t).toLocaleString()), el('td', {}, e.user), el('td', { class: 'mono' }, e.action), el('td', { class: 'mono' }, detailsOf(e)))));
      say('admin-audit-msg', auditRows.length + ' event(s)' + (auditRows.length > 500 ? ' (the first 500 shown; Export CSV has them all)' : ''), true);
    } catch (err) { say('admin-audit-msg', err.message, false); }
  };
  $('admin-audit-search').addEventListener('click', searchAudit);
  $('admin-audit-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchAudit(); });
  $('admin-audit-csv').addEventListener('click', () => {
    const q = (v) => { const t = v == null ? '' : String(v); return /[",;\\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const lines = ['time,user,action,details', ...auditRows.map((e) => [new Date(e.t).toISOString(), e.user, e.action, detailsOf(e)].map(q).join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\\r\\n') + '\\r\\n'], { type: 'text/csv' }));
    a.download = 'audit-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  });
  searchAudit();

  call('state').then(render, (err) => { $('admin-sub').textContent = err.message; });
})();
</script>
</body></html>`;
}

module.exports = { createAdmin, checkPlcs };
