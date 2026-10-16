// Attachments: a photo (or a PDF) on a work order, a call for maintenance, a shift handover. The board makes a
// phone's photo small first (at most 1600 px, JPEG); the gateway keeps each one as a file in attachments/ beside
// config.json (its id its name), at most 512 KB each, and what it is on (its work order, its handover) keeps its
// meta: { id, name, type, size, by, at }. Read back by id by those who see what it is on.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_BYTES = 512 * 1024;

function createAttachments({ baseDir, log, audit }) {
  const dir = path.join(baseDir, 'attachments');
  const fileOf = (id) => {
    if (!/^[0-9a-f]{16}$/.test(String(id))) return null;
    for (const ext of Object.values(TYPES)) {
      const f = path.join(dir, `${id}.${ext}`);
      if (fs.existsSync(f)) return { f, ext };
    }
    return null;
  };
  const metaOf = (id) => {
    if (!/^[0-9a-f]{16}$/.test(String(id))) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
    } catch {
      return null;
    }
  };
  return {
    TYPES,
    MAX_BYTES,
    /** One kept: { name, type, data (base64) } -> its meta (throws with why) */
    add({ name, type, data }, user, what) {
      const ext = TYPES[type];
      if (!ext) throw new Error('A photo (JPEG, PNG, WebP) or a PDF');
      const buf = Buffer.from(String(data ?? ''), 'base64');
      if (!buf.length) throw new Error('An empty file');
      if (buf.length > MAX_BYTES) throw new Error(`At most ${MAX_BYTES / 1024} KB (a photo: the board makes it smaller)`);
      // (what it says it is: its first bytes)
      const magic = { jpg: [0xff, 0xd8], png: [0x89, 0x50], webp: [0x52, 0x49], pdf: [0x25, 0x50] }[ext];
      if (buf[0] !== magic[0] || buf[1] !== magic[1]) throw new Error(`Not a ${ext.toUpperCase()} file`);
      const id = crypto.randomBytes(8).toString('hex');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${id}.${ext}`), buf);
      const meta = { id, name: String(name ?? `photo.${ext}`).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 80) || `photo.${ext}`, type, size: buf.length, by: user, at: new Date().toISOString() };
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(meta));
      audit?.add(user, 'attachment.add', { id, name: meta.name, size: meta.size, on: what });
      log?.(`attachments: ${user} added ${meta.name} (${Math.round(buf.length / 1024)} KB) to ${what}`);
      return meta;
    },
    /** One read back: { type, data (base64) }, or null */
    get(id) {
      const x = fileOf(id);
      if (!x) return null;
      const type = Object.keys(TYPES).find((k) => TYPES[k] === x.ext);
      return { type, data: fs.readFileSync(x.f).toString('base64') };
    },
    /** Its meta, as kept when it was added (null: no such one) */
    meta: metaOf,
    /** Those of these ids that are kept, their metas (at most 10; the same one once) */
    metas: (ids) => [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, 10).map(metaOf).filter(Boolean),
    /** All kept (the backup): their files */
    dir,
  };
}

module.exports = { createAttachments, TYPES, MAX_BYTES };
