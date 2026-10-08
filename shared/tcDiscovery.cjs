// TwinCAT device search (UDP 48899), as the XAE's "Add Route" dialog does it: a request broadcast on every IPv4
// network of this computer (or sent to given addresses, for PLCs behind a router); each TwinCAT system answers with
// its AMS NetId, host name, TwinCAT version and OS. Read-only: nothing is changed on the devices.
const dgram = require('dgram');
const os = require('os');
const fsys = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MAGIC = 0x71146603;
const SERVICE_SEARCH = 1;
const RESPONSE = 0x80000000;
const TAG_HOSTNAME = 5;
const TAG_TCVERSION = 3;
const TAG_OSVERSION = 4;
const TAG_FINGERPRINT = 18;

const netIdBytes = (netId) => {
  const parts = String(netId).split('.').map(Number);
  return parts.length === 6 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? Buffer.from(parts) : Buffer.from([0, 0, 0, 0, 1, 1]);
};

/** The search request: header (magic, invoke id, service, sender AMS address), no tags */
function searchRequest(localNetId, invokeId = 0) {
  const b = Buffer.alloc(24);
  b.writeUInt32LE(MAGIC, 0);
  b.writeUInt32LE(invokeId, 4);
  b.writeUInt32LE(SERVICE_SEARCH, 8);
  netIdBytes(localNetId).copy(b, 12);
  b.writeUInt16LE(10000, 18);
  b.writeUInt32LE(0, 20);
  return b;
}

const cString = (buf) => {
  const end = buf.indexOf(0);
  return buf.toString('latin1', 0, end < 0 ? buf.length : end).trim();
};

function osName(data) {
  if (data.length < 20) return '';
  const major = data.readUInt32LE(4);
  const minor = data.readUInt32LE(8);
  const build = data.readUInt32LE(12);
  const platform = data.readUInt32LE(16);
  // Windows CE / Windows / TwinCAT/BSD (platform ids as TwinCAT sends them)
  const extra = data.length > 20 ? cString(data.subarray(20)).replace(/[^\x20-\x7e]/g, '') : '';
  const name = platform === 3 ? 'Windows CE' : platform === 2 ? 'Windows' : platform === 5 || platform === 6 ? 'TwinCAT/BSD' : 'OS';
  return `${name} ${major}.${minor}.${build}${extra ? ` ${extra}` : ''}`.trim();
}

/** A search reply, or null for anything else (such as our own request heard back) */
function parseReply(buf, address) {
  if (buf.length < 24 || buf.readUInt32LE(0) !== MAGIC || buf.readUInt32LE(8) !== ((RESPONSE | SERVICE_SEARCH) >>> 0)) return null;
  const device = { netId: [...buf.subarray(12, 18)].join('.'), ip: address, name: '', twincat: '', os: '', fingerprint: '' };
  const count = buf.readUInt32LE(20);
  let p = 24;
  for (let i = 0; i < count && p + 4 <= buf.length; i++) {
    const tag = buf.readUInt16LE(p);
    const len = buf.readUInt16LE(p + 2);
    const data = buf.subarray(p + 4, Math.min(buf.length, p + 4 + len));
    p += 4 + len;
    if (tag === TAG_HOSTNAME) device.name = cString(data);
    else if (tag === TAG_TCVERSION && data.length >= 4) device.twincat = `${data[0]}.${data[1]}.${data.readUInt16LE(2)}`;
    else if (tag === TAG_OSVERSION) device.os = osName(data);
    else if (tag === TAG_FINGERPRINT) device.fingerprint = cString(data);
  }
  return device;
}

/** This computer's IPv4 networks: address, broadcast address, the AMS NetId TwinCAT would give it */
function localNetworks() {
  const out = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      out.push({ iface, address: a.address, netmask: a.netmask, broadcast: ip.map((n, i) => (n | (~mask[i] & 255)) & 255).join('.'), netId: `${a.address}.1.1` });
    }
  }
  return out;
}

/**
 * Searches for TwinCAT devices: broadcast on each local network (unless broadcast is false) and a request to each of
 * `addresses`. Resolves after `timeoutMs` with the devices found, one per AMS NetId.
 */
/**
 * This computer's TwinCAT routes (StaticRoutes.xml where each TwinCAT keeps it: 4026's ProgramData, an install by
 * the Package Manager under TwinCAT3's TwinCATDir, 4024's C:\\TwinCAT): [{ name, address, netId }], [] without TwinCAT
 */
function localRoutes() {
  if (process.platform !== 'win32') return [];
  const dirs = [path.join(process.env.ProgramData || 'C:\\ProgramData', 'Beckhoff', 'TwinCAT', '3.1', 'Target')];
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\Beckhoff\\TwinCAT3', '/v', 'TwinCATDir'], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    const dir = /TwinCATDir\s+REG_\w+\s+(.+)$/m.exec(out)?.[1]?.trim();
    if (dir) dirs.push(path.join(dir, '3.1', 'Target'));
  } catch {
    // (no TwinCAT here)
  }
  dirs.push(path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Beckhoff', 'TwinCAT', '3.1', 'Target'), 'C:\\TwinCAT\\3.1\\Target');
  const routes = [];
  for (const d of [...new Set(dirs.map((x) => x.toLowerCase()))]) {
    let xml;
    try {
      xml = fsys.readFileSync(path.join(d, 'StaticRoutes.xml'), 'utf8');
    } catch {
      continue;
    }
    // (a route's tags may carry attributes: <Route Unidirectional="true">)
    for (const r of xml.matchAll(/<Route(?:\s[^>]*)?>([\s\S]*?)<\/Route>/gi)) {
      const field = (n) => new RegExp(`<${n}(?:\\s[^>]*)?>([^<]*)</${n}>`, 'i').exec(r[1])?.[1]?.trim() ?? '';
      const netId = field('NetId');
      if (/^\d+(\.\d+){5}$/.test(netId) && !routes.some((x) => x.netId === netId)) routes.push({ name: field('Name'), address: field('Address'), netId });
    }
    if (routes.length) break;
  }
  return routes;
}

/**
 * The TwinCAT devices that answer the search: broadcast on each network here, and asked one by one at addresses (and,
 * with routes (default: when broadcasting), at this computer's TwinCAT routes' addresses: a PLC on another subnet,
 * which a broadcast does not reach)
 */
async function discover({ localNetId, addresses = [], broadcast = true, routes = broadcast, timeoutMs = 2000, port = 48899 } = {}) {
  if (routes) {
    const known = new Set(addresses.map((a) => String(a).toLowerCase()));
    for (const r of localRoutes()) if (r.address && /^[A-Za-z0-9.-]{1,253}$/.test(r.address) && !known.has(r.address.toLowerCase())) {
      known.add(r.address.toLowerCase());
      addresses = [...addresses, r.address];
    }
  }
  const found = new Map();
  const request = searchRequest(localNetId);
  const targets = [];
  if (broadcast) {
    const nets = localNetworks();
    for (const n of nets) targets.push({ bind: n.address, to: n.broadcast });
    targets.push({ bind: undefined, to: '255.255.255.255' });
  }
  for (const a of addresses) targets.push({ bind: undefined, to: a });
  const sockets = [];
  const errors = [];
  await Promise.all(
    targets.map(
      (t) =>
        new Promise((resolve) => {
          const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
          sockets.push(sock);
          sock.on('error', (err) => {
            errors.push(`${t.to}: ${err.message}`);
            resolve();
          });
          sock.on('message', (msg, rinfo) => {
            const d = parseReply(msg, rinfo.address);
            if (d && !found.has(d.netId)) found.set(d.netId, d);
          });
          sock.bind({ address: t.bind, port: 0 }, () => {
            try {
              sock.setBroadcast(true);
            } catch {
              // not a broadcast socket
            }
            sock.send(request, port, t.to, (err) => {
              if (err) errors.push(`${t.to}: ${err.message}`);
              resolve();
            });
          });
        }),
    ),
  );
  await new Promise((r) => setTimeout(r, timeoutMs));
  for (const s of sockets) {
    try {
      s.close();
    } catch {
      // closed after an error
    }
  }
  return { devices: [...found.values()].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true })), errors };
}

// ---------------------------------------------------------------------------------------------------------------
// Add Route (UDP 48899, service 6): asks a TwinCAT system to add a route to this computer, with that system's user
// name and password, as XAE's Add Route dialog does for the remote side. The one thing here that changes a device:
// only on the user's request, with the credentials the user enters.

const SERVICE_ADD_ROUTE = 6;
const TAG_PASSWORD = 2;
const TAG_HOST = 5;
const TAG_NETID = 7;
const TAG_ROUTENAME = 12;
const TAG_USER = 13;
const TAG_STATUS = 1;

const stringTag = (id, text) => {
  const data = Buffer.from(`${text}\0`, 'latin1');
  const head = Buffer.alloc(4);
  head.writeUInt16LE(id, 0);
  head.writeUInt16LE(data.length, 2);
  return Buffer.concat([head, data]);
};

/** The request: a route named routeName on the PLC to the AMS NetId localNetId at hostAddress */
function addRouteRequest({ localNetId, hostAddress, routeName, user, password }) {
  const head = Buffer.alloc(24);
  head.writeUInt32LE(MAGIC, 0);
  head.writeUInt32LE(0, 4);
  head.writeUInt32LE(SERVICE_ADD_ROUTE, 8);
  netIdBytes(localNetId).copy(head, 12);
  head.writeUInt16LE(10000, 18);
  const netTag = Buffer.alloc(10);
  netTag.writeUInt16LE(TAG_NETID, 0);
  netTag.writeUInt16LE(6, 2);
  netIdBytes(localNetId).copy(netTag, 4);
  const tags = [stringTag(TAG_ROUTENAME, routeName), netTag, stringTag(TAG_USER, user), stringTag(TAG_PASSWORD, password), stringTag(TAG_HOST, hostAddress)];
  head.writeUInt32LE(tags.length, 20);
  return Buffer.concat([head, ...tags]);
}

/** The reply: { ok, code } (code: the PLC's error, 0 when the route was added) or null for something else */
function parseAddRouteReply(buf) {
  if (buf.length < 24 || buf.readUInt32LE(0) !== MAGIC || buf.readUInt32LE(8) !== ((RESPONSE | SERVICE_ADD_ROUTE) >>> 0)) return null;
  const count = buf.readUInt32LE(20);
  let p = 24;
  for (let i = 0; i < count && p + 4 <= buf.length; i++) {
    const tag = buf.readUInt16LE(p);
    const len = buf.readUInt16LE(p + 2);
    if (tag === TAG_STATUS && len >= 4 && p + 8 <= buf.length) {
      const code = buf.readUInt32LE(p + 4);
      return { ok: code === 0, code };
    }
    p += 4 + len;
  }
  return { ok: true, code: 0 };
}

const routeErrorText = (code) =>
  code === 0x704 || code === 0x705 || code === 0x719 || code === 0x71a
    ? 'the PLC refused the user name or password'
    : `the PLC answered with error 0x${code.toString(16)}`;

/**
 * Adds a route on the PLC at plcIp to this computer. Resolves { ok, message }. routeName: how the route is listed
 * on the PLC (default: this computer's name); hostAddress: this computer's address as the PLC should use it.
 */
function addRoute({ plcIp, localNetId, hostAddress, routeName = os.hostname(), user, password, timeoutMs = 5000, port = 48899 }) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        sock.close();
      } catch {
        // closed
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, message: `No answer from ${plcIp} (UDP ${port}): is it a TwinCAT system, and is UDP ${port} open?` }), timeoutMs);
    sock.on('error', (err) => finish({ ok: false, message: err.message }));
    sock.on('message', (msg) => {
      const r = parseAddRouteReply(msg);
      if (!r) return;
      finish(r.ok
        ? { ok: true, message: `Route added on ${plcIp}: "${routeName}" to ${localNetId} at ${hostAddress}` }
        : { ok: false, code: r.code, message: `Not added: ${routeErrorText(r.code)}` });
    });
    sock.bind(0, () => sock.send(addRouteRequest({ localNetId, hostAddress, routeName, user, password }), port, plcIp, (err) => err && finish({ ok: false, message: err.message })));
  });
}

/**
 * Reachable: a TCP connection to the PLC's ADS router (48898, or host:port) opens within timeoutMs; nothing is sent.
 * targets: [{ key, ip }] -> { key: true | false }
 */
async function probeAll(targets, timeoutMs = 1500) {
  const net = require('net');
  const one = ({ ip }) =>
    new Promise((resolve) => {
      const [host, port] = String(ip ?? '').split(':');
      if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) return resolve(false);
      const sock = net.connect({ host, port: Number(port) || 48898 });
      const done = (ok) => {
        sock.destroy();
        resolve(ok);
      };
      sock.setTimeout(timeoutMs, () => done(false));
      sock.once('connect', () => done(true));
      sock.once('error', () => done(false));
    });
  const out = {};
  await Promise.all(targets.map(async (t) => (out[t.key] = await one(t))));
  return out;
}

module.exports = { probeAll, discover, localRoutes, localNetworks, searchRequest, parseReply, addRoute, addRouteRequest, parseAddRouteReply, MAGIC };
