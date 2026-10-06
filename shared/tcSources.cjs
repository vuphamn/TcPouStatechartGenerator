// The PLC project's sources as the PLC keeps them (the project downloaded with its sources: XAE's "Open from target"
// reads the same): read over ADS from the target's boot folder (the system service, ADS port 10000; read-only: files
// opened for reading), unpacked here. Boot/CurrentProjectInfo.json names the PLC projects and their ADS ports;
// Boot/CurrentConfig/<project>.tpzip is a zip of the PLC project's folder (.TcPOU, .TcDUT, .TcGVL, ...).
// Used by the desktop app and Link (shared/liveSession.cjs) and the gateway.

const zlib = require('zlib');
const { dataTypeInfo } = require('./tcAds.cjs');

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

/** A file in the boot folder there or not (opened and closed, not read: a boot project is megabytes) */
async function bootFileExists(client, relPath) {
  const target = { adsPort: SYSTEM_SERVICE_PORT };
  const name = Buffer.concat([Buffer.from(relPath.replace(/\\/g, '/'), 'latin1'), Buffer.from([0])]);
  try {
    const h = (await client.readWriteRaw(FOPEN, (PATH_BOOTPATH << 16) | FOPEN_READ | FOPEN_BINARY, 4, name, target)).readUInt32LE(0);
    await client.readWriteRaw(FCLOSE, h, 0, Buffer.alloc(0), target).catch(() => {});
    return true;
  } catch {
    return false;
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
    // (a folder: its name ends with /, or only its attributes say so, as in TwinCAT's archives)
    const isDir = path.endsWith('/') || (buf.readUInt32LE(p + 38) & 0x10) !== 0;
    p += 46 + nameLen + extraLen + commentLen;
    if (isDir || !keep(path)) continue;
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

/** A type of the project as it was built (the archive's .tmc): its size and own members */
function builtTypes(tmc, names) {
  const out = new Map();
  for (const m of tmc.matchAll(/<DataType><Name[^>]*>([^<]+)<\/Name>([\s\S]*?)<\/DataType>/g)) {
    const key = m[1].toLowerCase();
    if (!names.has(key) || out.has(key)) continue;
    const bits = Number(/^\s*<BitSize>(\d+)<\/BitSize>/.exec(m[2])?.[1]);
    // (the compiler's own members, ".PT" and the like, are not the PLC's to list: left out)
    const members = [...m[2].matchAll(/<SubItem><Name>([^<]+)<\/Name>/g)].map((s) => s[1]).filter((n) => /^[A-Za-z_]\w*$/.test(n));
    out.set(key, { name: m[1], size: bits / 8, members });
  }
  return out;
}

/** The library of each library type the project uses (the .tmc's Namespace): { lower-case name: library } */
function libraryTypesOf(tmc) {
  const out = {};
  for (const m of tmc.matchAll(/<DataType><Name [^>]*?Namespace="([^"]+)"[^>]*>([^<]+)<\/Name>/g)) out[m[2].toLowerCase()] ??= m[1];
  return out;
}

/** Most function blocks compared with the PLC's own types (an ADS read each) */
const STALE_CHECKS = 80;

/**
 * Sources older than the running code (the project changed and activated since its sources were downloaded): a few
 * of its function blocks as built into the archive (its .tmc) against the PLC's own data types. The first difference,
 * or null
 */
async function staleCheck(client, tmc, sourceFiles) {
  if (!tmc || typeof client.readWriteRaw !== 'function') return null;
  const fbs = new Set();
  for (const f of sourceFiles) {
    const name = /\.TcPOU$/i.test(f.path) && /<POU\s+Name="([^"]+)"/.exec(f.content)?.[1];
    if (name && /FUNCTION_BLOCK\b/i.test(f.content)) fbs.add(name.toLowerCase());
  }
  const built = [...builtTypes(tmc, fbs).values()].slice(0, STALE_CHECKS);
  const cache = new Map();
  for (const b of built) {
    let dt;
    try {
      dt = await dataTypeInfo(client, b.name, cache);
    } catch {
      return null;
    }
    // (a type the PLC does not describe: not compared)
    if (!dt) continue;
    // (the PLC lists inherited members too, the .tmc only the type's own: a member of the sources it lacks, or
    // another size)
    const online = new Set((dt.subItems ?? []).map((s) => s.name.toLowerCase()));
    const removed = b.members.filter((x) => !online.has(x.toLowerCase()));
    if (removed.length || (Number.isFinite(b.size) && dt.size !== b.size)) {
      const what = removed.length ? `${removed.slice(0, 3).join(', ')} not in the PLC's` : `${dt.size} bytes in the PLC, ${b.size} in the sources`;
      return `The PLC's code differs from its sources (${b.name}: ${what}). The project was changed since its sources were downloaded: download them again (PLC project > Settings > Source download) to see the running code.`;
    }
  }
  return null;
}

/**
 * The boot folder's project information (read: relPath → Buffer; zip: its CurrentConfig.tszip when already read):
 * CurrentProjectInfo.json; without it (TwinCAT 4024 may keep none; NOT YET TESTED there), the same from the TwinCAT
 * project in CurrentConfig.tszip: its name (the .tsproj's), its PLC projects (_Config/PLC/*.xti: Name, AmsPort).
 * { project: { name }, sub_projects: [{ name, file: 'Plc/Port_<port>.json' }], derived? }; throws when neither is there
 */
async function projectInfoOf(read, zip = null) {
  let first;
  try {
    return JSON.parse(text(await read('CurrentProjectInfo.json')));
  } catch (err) {
    first = err;
  }
  let system = zip;
  try {
    system ??= await read('CurrentConfig.tszip');
  } catch {
    throw first;
  }
  const entries = unzip(system, (p) => /^[^/]+\.tsproj$/i.test(p) || /^_Config\/PLC\/[^/]+\.xti$/i.test(p));
  const tsproj = entries.find((f) => /\.tsproj$/i.test(f.path));
  const subs = [];
  for (const f of entries.filter((x) => /\.xti$/i.test(x.path))) {
    const tag = /<Project\b[^>]*>/.exec(text(f.data))?.[0] ?? '';
    const name = /\bName="([^"]+)"/.exec(tag)?.[1] ?? '';
    if (!name || !/\.plcproj"/i.test(tag)) continue;
    // (no AmsPort: the next of 851, 852 …)
    const port = Number(/\bAmsPort="(\d+)"/.exec(tag)?.[1]) || 851 + subs.length;
    subs.push({ name, file: `Plc/Port_${port}.json` });
  }
  if (!tsproj && !subs.length) throw first;
  return { project: { name: tsproj ? tsproj.path.replace(/\.tsproj$/i, '') : subs[0]?.name ?? '' }, sub_projects: subs, derived: true };
}

/** The PLC projects the boot folder names: [{ name, port }] */
function plcProjectsOf(info) {
  return (Array.isArray(info?.sub_projects) ? info.sub_projects : [])
    .map((s) => ({ name: String(s?.name ?? ''), port: Number(/Port_(\d+)/i.exec(String(s?.file ?? ''))?.[1]) || null }))
    .filter((s) => /^[\w .-]+$/.test(s.name));
}

/**
 * The PLC project's sources from the PLC: the project of this ADS port (851: the first PLC), or the one named
 * (options.plcProject: another PLC project on the same target), its .TcPOU, .TcDUT and .TcGVL files (their paths in
 * the project); projects: all PLC projects there; stale: when they are older than the running code. { error } when
 * the PLC keeps none (downloaded without its sources).
 */
async function readPlcSources(client, adsPort = 851, options = {}) {
  let info;
  try {
    info = await projectInfoOf((p) => readBootFile(client, p));
  } catch (err) {
    return { error: `The PLC has no project information in its boot folder (${err?.adsError?.errorStr ?? err?.message ?? err})` };
  }
  const projects = plcProjectsOf(info);
  const wanted = String(options.plcProject ?? '').trim().toLowerCase();
  // (the one asked for; else the one of this port: Plc/Port_851.json; else the only one)
  const sub = wanted
    ? projects.find((s) => s.name.toLowerCase() === wanted)
    : projects.find((s) => s.port === adsPort) ?? (projects.length === 1 ? projects[0] : null);
  const name = sub?.name;
  if (!name) return { error: wanted ? `The PLC has no PLC project ${options.plcProject}` : `The PLC's project information names no PLC project for ADS port ${adsPort}`, projects };
  let zip;
  try {
    zip = await readBootFile(client, `CurrentConfig/${name}.tpzip`);
  } catch (err) {
    const code = err?.adsError?.errorCode;
    return { error: code === 0x70c || code === 1804 ? `The PLC keeps no sources of ${name} (download the project with its sources: PLC project > Settings > Source download)` : `Could not read ${name}'s sources: ${err?.adsError?.errorStr ?? err?.message ?? err}`, projects };
  }
  const unpacked = unzip(zip, (p) => SOURCE_FILE.test(p) || /^[^/]+\.tmc$/i.test(p));
  const files = unpacked.filter((f) => SOURCE_FILE.test(f.path)).map((f) => ({ path: f.path, content: text(f.data) }));
  const tmc = unpacked.find((f) => /\.tmc$/i.test(f.path));
  // (only the port's own project runs where this connection reads types)
  const stale = sub.port === adsPort || projects.length === 1 ? await staleCheck(client, tmc ? text(tmc.data) : '', files) : null;
  const libraryTypes = tmc ? libraryTypesOf(text(tmc.data)) : {};
  return { project: info?.project?.name ?? name, plcProject: name, projects, files, libraryTypes, ...(stale ? { stale } : {}) };
}

module.exports = { readBootFile, readPlcSources, projectInfoOf, unzip, builtTypes, libraryTypesOf, SYSTEM_SERVICE_PORT, bootFileExists };
