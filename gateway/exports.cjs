// Exports, for other systems (read-only to the PLCs):
// - a REST/JSON API: GET /api/v1/… with "Authorization: Bearer <a token of the gateway>" (a view-only one is enough):
//   plcs, alerts (?since=, ?limit=), workorders (?status=), oee (?from=, ?to=, ?by=), drives, axes, risks, changes;
// - MQTT (config.json "mqtt": { "url": "mqtt://broker:1883" or "mqtts://…:8883", "username", "password", "prefix":
//   "kval/machinescope", "insecureTls": false }): an MQTT 3.1.1 client of its own (QoS 0): <prefix>/<plc>/alerts each
//   alert; <prefix>/<plc>/state/<machine path, dots as slashes> each recorded machine's state (retained);
//   <prefix>/workorders each work order made or changed; <prefix>/gateway/status online / offline (retained, its will);
// - a CMMS hook, SAP PM, Maximo or another (config.json "cmms": { "url", "method": "POST", "headers": { … }, "body":
//   "<a JSON template>", "doneUrl", "doneMethod", "doneBody", "idPath": "id" }): a work order made posts its body, its
//   answer's id (idPath) kept as its external id; done, its doneBody to its doneUrl. {number} {title} {plc} {plcName}
//   {machine} {priority} {status} {assignee} {due} {rootCause} {parts} {createdBy} {createdAt} {externalId} {link}
//   filled in (escaped for JSON in a body, for the URL in an address).
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { tokenFor, allowedOf } = require('./tokens.cjs');

// ---- MQTT 3.1.1 (the few packets a publisher needs) ----
const varLen = (n) => {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 128;
    out.push(b);
  } while (n > 0);
  return Buffer.from(out);
};
const str = (s) => {
  const b = Buffer.from(String(s), 'utf8');
  const l = Buffer.alloc(2);
  l.writeUInt16BE(b.length);
  return Buffer.concat([l, b]);
};
const packet = (type, flags, body) => Buffer.concat([Buffer.from([(type << 4) | flags]), varLen(body.length), body]);
function connectPacket({ clientId, username, password, keepalive = 60, will }) {
  let flags = 0x02;
  if (will) flags |= 0x04 | (will.retain ? 0x20 : 0);
  if (username) flags |= 0x80;
  if (password) flags |= 0x40;
  const ka = Buffer.alloc(2);
  ka.writeUInt16BE(keepalive);
  const parts = [str('MQTT'), Buffer.from([4, flags]), ka, str(clientId)];
  if (will) parts.push(str(will.topic), str(will.message));
  if (username) parts.push(str(username));
  if (password) parts.push(str(password));
  return packet(1, 0, Buffer.concat(parts));
}
const publishPacket = (topic, payload, retain) => packet(3, retain ? 1 : 0, Buffer.concat([str(topic), Buffer.from(payload)]));

function createMqtt({ getConf, log }) {
  let socket = null;
  let ready = false;
  let timer = null;
  let ping = null;
  let key = '';
  const queue = [];
  const prefix = () => String(getConf()?.prefix || 'kval/machinescope').replace(/\/+$/, '');
  const close = () => {
    clearTimeout(timer);
    clearInterval(ping);
    ready = false;
    if (socket) socket.destroy();
    socket = null;
  };
  const open = () => {
    const c = getConf();
    close();
    if (!c?.url) return;
    let u;
    try {
      u = new URL(c.url);
    } catch {
      log(`mqtt: "${c.url}": not an address (mqtt://broker:1883)`);
      return;
    }
    const secure = u.protocol === 'mqtts:';
    const port = Number(u.port) || (secure ? 8883 : 1883);
    const s = secure ? tls.connect({ host: u.hostname, port, servername: u.hostname, rejectUnauthorized: !c.insecureTls }) : net.connect({ host: u.hostname, port });
    socket = s;
    s.on(secure ? 'secureConnect' : 'connect', () => {
      s.write(connectPacket({ clientId: c.clientId || `kval-gw-${crypto.randomBytes(3).toString('hex')}`, username: c.username, password: c.password, will: { topic: `${prefix()}/gateway/status`, message: 'offline', retain: true } }));
    });
    let buf = Buffer.alloc(0);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        const type = buf[0] >> 4;
        const len = buf[1];
        if (buf.length < 2 + len) break;
        if (type === 2) {
          const code = buf[3];
          if (code !== 0) {
            log(`mqtt: the broker refused the connection (${['', 'its protocol', 'its client id', 'not available', 'its user or password', 'not allowed'][code] ?? code})`);
            s.destroy();
            return;
          }
          ready = true;
          log(`mqtt: connected to ${u.host}`);
          s.write(publishPacket(`${prefix()}/gateway/status`, 'online', true));
          while (queue.length) s.write(queue.shift());
          ping = setInterval(() => s.write(Buffer.from([0xc0, 0])), 30000);
        }
        buf = buf.subarray(2 + len);
      }
    });
    s.on('error', (err) => log(`mqtt: ${err.message}`));
    s.on('close', () => {
      ready = false;
      clearInterval(ping);
      if (socket === s) timer = setTimeout(open, 15000);
    });
  };
  return {
    /** The settings applied: connected again when they changed */
    apply() {
      const k = JSON.stringify(getConf() ?? null);
      if (k === key) return;
      key = k;
      open();
    },
    publish(topic, obj, retain = false) {
      if (!getConf()?.url) return;
      const p = publishPacket(`${prefix()}/${topic}`, typeof obj === 'string' ? obj : JSON.stringify(obj), retain);
      if (ready && socket) socket.write(p);
      else if (queue.length < 500) queue.push(p);
    },
    stop: close,
    ready: () => ready,
  };
}

// ---- The CMMS hook ----
const fill = (tpl, vars, esc) => String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? esc(String(vars[k] ?? '')) : m));
const jsonEsc = (s) => JSON.stringify(s).slice(1, -1);
const pick = (obj, p) => String(p ?? '').split('.').filter(Boolean).reduce((o, k) => (o == null ? o : o[/^\d+$/.test(k) ? Number(k) : k]), obj);

function createExports({ baseDir, getConfig, log, audit, sha256, data, workOrders, publicUrl }) {
  const mqtt = createMqtt({ getConf: () => getConfig().mqtt, log });
  // (work orders: the external ids the CMMS gave; the statuses seen, to know what changed)
  const idsFile = path.join(baseDir, 'cmms.json');
  let external = {};
  try {
    external = JSON.parse(fs.readFileSync(idsFile, 'utf8'));
  } catch {
    external = {};
  }
  const seen = new Map(workOrders.list().map((o) => [o.id, o.status]));
  const varsOf = (o) => ({
    number: o.number, title: o.title, plc: o.plc ?? '', plcName: o.plcName ?? '', machine: o.machine ?? '', priority: o.priority, status: o.status, assignee: o.assignee ?? '', due: o.due ?? '',
    rootCause: o.rootCause ?? '', parts: o.parts ?? '', createdBy: o.createdBy, createdAt: o.createdAt, externalId: external[o.id] ?? '', link: publicUrl() ? `${publicUrl()}/?board&page=work` : '',
  });
  async function hook(o, done) {
    const c = getConfig().cmms;
    const url = done ? c?.doneUrl : c?.url;
    if (!url) return;
    const vars = varsOf(o);
    try {
      const res = await fetch(fill(url, vars, encodeURIComponent), {
        method: (done ? c.doneMethod : c.method) || 'POST',
        headers: c.headers && typeof c.headers === 'object' ? c.headers : { 'Content-Type': 'application/json' },
        body: fill((done ? c.doneBody : c.body) ?? '{"number":"{number}","title":"{title}","priority":"{priority}"}', vars, jsonEsc),
        signal: AbortSignal.timeout(20000),
      });
      const text = await res.text();
      if (!res.ok) {
        log(`cmms: work order #${o.number}: ${res.status} ${text.slice(0, 200)}`);
        return;
      }
      if (!done && c.idPath) {
        let id = null;
        try {
          id = pick(JSON.parse(text), c.idPath);
        } catch {
          id = null;
        }
        if (id != null) {
          external[o.id] = String(id);
          fs.writeFileSync(idsFile, JSON.stringify(external));
        }
      }
      log(`cmms: work order #${o.number} ${done ? 'done' : 'made'}: sent${external[o.id] ? ` (its id there: ${external[o.id]})` : ''}`);
      audit?.add('gateway', 'cmms', { number: o.number, done: !!done, externalId: external[o.id] ?? null });
    } catch (err) {
      log(`cmms: work order #${o.number}: ${err.message}`);
    }
  }
  workOrders.subscribe(() => {
    for (const o of workOrders.list()) {
      const before = seen.get(o.id);
      if (before === o.status) continue;
      seen.set(o.id, o.status);
      mqtt.publish('workorders', { number: o.number, title: o.title, plc: o.plc, machine: o.machine, priority: o.priority, status: o.status, assignee: o.assignee, at: new Date().toISOString() });
      if (before === undefined) void hook(o, false);
      else if (o.status === 'done') void hook(o, true);
    }
  });

  // ---- REST ----
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(body));
  };
  const tokenOk = (req) => {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    if (!m) return null;
    // (an expired one refused; one rotated out let in until its grace ends)
    const hit = tokenFor(getConfig().tokens ?? [], m[1], sha256);
    return hit?.token ?? null;
  };
  const ENDPOINTS = ['plcs', 'alerts', 'workorders', 'oee', 'drives', 'axes', 'risks', 'changes'];
  function handle(req, res) {
    const url = new URL(req.url, 'https://gateway');
    if (!url.pathname.startsWith('/api/v1')) return false;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Allow-Methods': 'GET' });
      res.end();
      return true;
    }
    if (getConfig().api?.enabled === false) return json(res, 404, { error: 'The API is off on this gateway (config.json "api": { "enabled": false })' }), true;
    if (req.method !== 'GET') return json(res, 405, { error: 'Read only: GET' }), true;
    const who = tokenOk(req);
    if (!who) return json(res, 401, { error: 'A token of the gateway: Authorization: Bearer <token>' }), true;
    const what = url.pathname.replace(/^\/api\/v1\/?/, '').replace(/\/$/, '');
    // (a token of some PLCs: only theirs)
    const allowed = allowedOf(who);
    const mine = (x) => !allowed || !x || typeof x !== 'object' || !(x.plc ?? x.id) || allowed.has(String(x.plc ?? x.id));
    const q = (k) => url.searchParams.get(k);
    try {
      let body;
      if (!what) body = { gateway: 'Kval MachineScope', endpoints: ENDPOINTS.map((e) => `/api/v1/${e}`) };
      else if (what === 'plcs') body = data.plcs();
      else if (what === 'alerts') {
        const since = q('since') ? Date.parse(q('since')) : 0;
        body = data.alerts(Math.min(5000, Number(q('limit')) || 500)).filter((e) => !since || Date.parse(e.at) >= since);
      } else if (what === 'workorders') body = data.workOrders().filter((o) => !q('status') || o.status === q('status')).map((o) => ({ ...o, externalId: external[o.id] ?? null }));
      else if (what === 'oee') {
        const to = q('to') ? Date.parse(q('to')) : Date.now();
        const from = q('from') ? Date.parse(q('from')) : to - 86400000;
        if (!(from < to) || to - from > 93 * 86400000) return json(res, 400, { error: 'from < to, at most 93 days' }), true;
        body = data.oee({ from, to, by: ['shift', 'day'].includes(q('by')) ? q('by') : 'total', ...(allowed ? { plcIds: [...allowed] } : {}) });
      } else if (what === 'drives') body = data.drives();
      else if (what === 'axes') body = data.axes();
      else if (what === 'risks') body = data.risks();
      else if (what === 'changes') body = data.changes();
      else return json(res, 404, { error: `Not an endpoint: ${ENDPOINTS.join(', ')}` }), true;
      json(res, 200, Array.isArray(body) ? body.filter(mine) : body);
    } catch (err) {
      json(res, 500, { error: err.message });
    }
    return true;
  }

  return {
    handle,
    mqtt,
    apply: () => mqtt.apply(),
    /** An alert, to MQTT */
    alert(e) {
      if (e.plc) mqtt.publish(`${e.plc}/alerts`, { id: e.id, event: e.event, plc: e.plc, plcName: e.plcName, machine: e.machine, state: e.state, text: e.text, at: e.at });
    },
    /** A recorded machine's state, to MQTT (retained) */
    state(plc, machine, state, t) {
      mqtt.publish(`${plc}/state/${String(machine).replace(/\./g, '/')}`, { state, at: new Date(t).toISOString() }, true);
    },
    stop: () => mqtt.stop(),
  };
}

module.exports = { createExports, connectPacket, publishPacket, fill };
