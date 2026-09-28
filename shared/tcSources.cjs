// The PLC project's sources as the PLC keeps them (the project downloaded with its sources: XAE's "Open from target"
// reads the same): read over ADS from the target's boot folder (the system service, ADS port 10000; read-only: files
// opened for reading), unpacked here. Boot/CurrentProjectInfo.json names the PLC projects and their ADS ports;
// Boot/CurrentConfig/<project>.tpzip is a zip of the PLC project's folder (.TcPOU, .TcDUT, .TcGVL, ...).
// Used by the desktop app and Link (shared/liveSession.cjs) and the gateway.

const zlib = require('zlib');

const SYSTEM_SERVICE_PORT = 10000;
const FOPEN = 120;
const FCLOSE = 121;
const FREAD = 122;
const FOPEN_READ = 0x1;
const FOPEN_BINARY = 0x10;
/** E_OpenPath: the TwinCAT boot folder (paths relative to it) */
const PATH_BOOTPATH = 4;
const CHUNK = 16384;
/** Largest archive read (a PLC project with its libraries is a few MB) */
const MAX_BYTES = 64 * 1024 * 1024;

/** A file of the target's boot folder, read in full (the connection's AMS NetId, the system service port) */
async function readBootFile(client, relPath) {
  const target = { adsPort: SYSTEM_SERVICE_PORT };
  const name = Buffer.concat([Buffer.from(relPath.replace(/\\/g, '/'), 'latin1'), Buffer.from([0])]);
  const h = (await client.readWriteRaw(FOPEN, (PATH_BOOTPATH << 16) | FOPEN_READ | FOPEN_BINARY, 4, name, target)).readUInt32LE(0);
  try {
    const parts = [];
    let total = 0;
    for (;;) {
      const b = await client.readWriteRaw(FREAD, h, CHUNK, Buffer.alloc(0), target);
      if (!b.length) break;
      parts.push(b);
      total += b.length;
      if (total > MAX_BYTES) throw new Error(`${relPath} is larger than ${MAX_BYTES / 1024 / 1024} MB`);
      if (b.length < CHUNK) break;
    }
    return Buffer.concat(parts);
  } finally {
    await client.readWriteRaw(FCLOSE, h, 0, Buffer.alloc(0), target).catch(() => {});
  }
}

/** A zip's files (stored or deflated), from its central directory: [{ path, data }] (keep: which to unpack) */
function unzip(buf, keep = () => true) {
  // The end of central directory record: the last 'PK\x05\x06' (a comment of up to 64 KB may follow it)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('A damaged zip archive');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const flags = buf.readUInt16LE(p + 8);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    const path = (flags & 0x800 ? rawName.toString('utf8') : rawName.toString('latin1')).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith('/') || !keep(path)) continue;
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + size);
    if (method === 0) out.push({ path, data: Buffer.from(data) });
    else if (method === 8) out.push({ path, data: zlib.inflateRawSync(data) });
  }
  return out;
}

const SOURCE_FILE = /\.(TcPOU|TcDUT|TcGVL)$/i;
const text = (b) => b.toString('utf8').replace(/^﻿/, '');

/**
 * The PLC project's sources from the PLC: the project of this ADS port (851: the first PLC), its .TcPOU, .TcDUT and
 * .TcGVL files (their paths in the project). { error } when the PLC keeps none (downloaded without its sources).
 */
async function readPlcSources(client, adsPort = 851) {
  let info;
  try {
    info = JSON.parse(text(await readBootFile(client, 'CurrentProjectInfo.json')));
  } catch (err) {
    return { error: `The PLC has no project information in its boot folder (${err?.adsError?.errorStr ?? err?.message ?? err})` };
  }
  const subs = Array.isArray(info?.sub_projects) ? info.sub_projects : [];
  // (the one of this port: Plc/Port_851.json; else the only one)
  const sub = subs.find((s) => new RegExp(`Port_${adsPort}\\b`, 'i').test(String(s?.file ?? ''))) ?? (subs.length === 1 ? subs[0] : null);
  const name = sub?.name;
  if (!name || !/^[\w .-]+$/.test(name)) return { error: `The PLC's project information names no PLC project for ADS port ${adsPort}` };
  let zip;
  try {
    zip = await readBootFile(client, `CurrentConfig/${name}.tpzip`);
  } catch (err) {
    const code = err?.adsError?.errorCode;
    return { error: code === 0x70c || code === 1804 ? `The PLC keeps no sources of ${name} (download the project with its sources: PLC project > Settings > Source download)` : `Could not read ${name}'s sources: ${err?.adsError?.errorStr ?? err?.message ?? err}` };
  }
  const files = unzip(zip, (p) => SOURCE_FILE.test(p)).map((f) => ({ path: f.path, content: text(f.data) }));
  return { project: info?.project?.name ?? name, plcProject: name, files };
}

module.exports = { readBootFile, readPlcSources, unzip, SYSTEM_SERVICE_PORT };
