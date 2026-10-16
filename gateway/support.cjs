// The support bundle: what Kval support needs to see what happened, in one zip, shared by a link that expires.
// Made from the board (Support bundle…, engineers and supervisors): the gateway (its version, its computer, its load),
// its settings without their secrets (tokens' names only, webhooks and passwords left out), the alerts, fault records,
// drives, fleet and risks, PLC projects, work orders, recordings of the last hours, its audit log, the end of its log.
// Kept in support/<id>.zip beside config.json; served at /support/<id>.zip?key=<its key> until it expires (then
// removed). Each one made or fetched is in the audit log.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

// A zip of { name: Buffer | string } (deflated; CRC-32 computed here: no package needed)
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function zipOf(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const packed = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6);
    h.writeUInt16LE(8, 8);
    h.writeUInt16LE(dosTime, 10);
    h.writeUInt16LE(dosDate, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(packed.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    locals.push(h, nameBuf, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(dosTime, 12);
    c.writeUInt16LE(dosDate, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/**
 * config.json without its secrets: tokens by name, webhooks, passwords (the mail server's), tokens (the SMS
 * provider's) left out; the people's email addresses and phone numbers (alerts by email or SMS) too
 */
function sanitized(config) {
  const out = JSON.parse(JSON.stringify(config ?? {}));
  if (Array.isArray(out.tokens)) out.tokens = out.tokens.map((t) => ({ name: t.name, view: !!t.view }));
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      if (/webhook|secret|password|passphrase|sha256|key$|token|^pass$|^accountSid$|^headers$/i.test(k) && typeof o[k] === 'string') o[k] = o[k] ? '(set, left out)' : '';
      else if (k === 'contact' && typeof o[k] === 'string') o[k] = '(set, left out)';
      // (an address with its key in it: an SMS provider's)
      else if (k === 'url' && /[?&](key|token|api|auth|pass|secret)/i.test(String(o[k]))) o[k] = '(set, left out)';
      // (a channel's addresses or numbers; not the "to" of a time window, "14:00")
      else if (k === 'to' && (Array.isArray(o[k]) || /@|^\+?\d{6,}/.test(String(o[k])))) o[k] = '(set, left out)';
      else walk(o[k]);
    }
  };
  walk(out);
  return out;
}

function createSupport({ baseDir, log, audit }) {
  const dir = path.join(baseDir, 'support');
  const indexFile = path.join(dir, 'index.json');
  let bundles = [];
  try {
    bundles = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    if (!Array.isArray(bundles)) bundles = [];
  } catch {
    bundles = [];
  }
  const save = () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(indexFile, JSON.stringify(bundles, null, 2));
  };
  const prune = () => {
    const now = Date.now();
    const gone = bundles.filter((b) => Date.parse(b.expires) <= now);
    if (!gone.length) return;
    for (const b of gone) fs.rmSync(path.join(dir, `${b.id}.zip`), { force: true });
    bundles = bundles.filter((b) => !gone.includes(b));
    save();
  };
  const timer = setInterval(prune, 3600_000);
  timer.unref();
  prune();
  return {
    zipOf,
    sanitized,
    /** A bundle of these files, its link valid for days */
    create(files, { days = 3, hours = 24 }, user) {
      const id = crypto.randomBytes(8).toString('hex');
      const key = crypto.randomBytes(18).toString('base64url');
      const zip = zipOf(files);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${id}.zip`), zip);
      const b = { id, key, by: user, at: new Date().toISOString(), expires: new Date(Date.now() + days * 86400000).toISOString(), size: zip.length, hours, files: Object.keys(files).length };
      bundles.push(b);
      save();
      audit?.add(user, 'support.bundle', { id, hours, days, size: zip.length, files: b.files });
      log(`support: ${user} made a support bundle (${Math.round(zip.length / 1024)} KB, ${b.files} files, the last ${hours} h; its link until ${b.expires})`);
      return { id, url: `/support/${id}.zip?key=${key}`, expires: b.expires, size: zip.length, files: b.files };
    },
    list: () => bundles.map(({ key, ...b }) => b),
    /** /support/<id>.zip?key=…: the bundle, while its link is valid; false: not this route */
    serve(req, res) {
      const url = new URL(req.url, 'https://gateway');
      const m = /^\/support\/([a-f0-9]{16})\.zip$/.exec(url.pathname);
      if (!m) return false;
      prune();
      const b = bundles.find((x) => x.id === m[1]);
      const given = Buffer.from(url.searchParams.get('key') ?? '');
      const ok = b && given.length === Buffer.from(b.key).length && crypto.timingSafeEqual(given, Buffer.from(b.key));
      if (!ok) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('No such support bundle, or its link has expired');
        return true;
      }
      audit?.add('support link', 'support.fetch', { id: b.id, ip: req.socket.remoteAddress });
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="machinescope-support-${b.at.slice(0, 10)}-${b.id}.zip"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      fs.createReadStream(path.join(dir, `${b.id}.zip`)).pipe(res);
      return true;
    },
    stop: () => clearInterval(timer),
  };
}

module.exports = { createSupport, zipOf, sanitized };
