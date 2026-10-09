// What build of its PLC project a PLC runs, against the builds of the loaded POU's project copy here: the PLC keeps the
// compile ID of its program in its boot folder (Boot/Plc/Port_<port>.cid: a GUID, the name of the build's
// .compileinfo); a build here writes <GUID>.compileinfo into the PLC project's _CompileInfo. Also the TwinCAT project
// (its .tsproj) the loaded POU belongs to. Used by the desktop app and Link (shared/liveSession.cjs).

const fs = require('fs');
const path = require('path');
const { readBootFile } = require('./tcSources.cjs');

/** A GUID's 16 bytes (as Windows keeps them: the first three fields little-endian) as text, upper case */
function guidText(b) {
  if (!b || b.length < 16) return null;
  const hex = (from, to, reverse) => {
    const part = [...b.subarray(from, to)];
    return (reverse ? part.reverse() : part).map((x) => x.toString(16).padStart(2, '0')).join('');
  };
  return `${hex(0, 4, true)}-${hex(4, 6, true)}-${hex(6, 8, true)}-${hex(8, 10)}-${hex(10, 16)}`.toUpperCase();
}

/** The compile ID of the program the PLC at that ADS port runs, or null (not there, not readable) */
async function plcCompileId(client, adsPort = 851) {
  try {
    return guidText(await readBootFile(client, `Plc/Port_${adsPort}.cid`));
  } catch {
    return null;
  }
}

/** The nearest folder above the file that holds a file of that extension, or null */
function folderWith(file, ext, levels = 8) {
  let dir = path.dirname(path.resolve(file));
  for (let k = 0; k < levels; k++) {
    try {
      if (fs.readdirSync(dir).some((n) => n.toLowerCase().endsWith(ext))) return dir;
    } catch {
      return null;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

/** The builds of the POU's PLC project here (its _CompileInfo), newest first: [{ id, at }] */
function projectBuilds(pouPath) {
  const dir = pouPath ? folderWith(pouPath, '.plcproj') : null;
  if (!dir) return [];
  const info = path.join(dir, '_CompileInfo');
  let names = [];
  try {
    names = fs.readdirSync(info).filter((n) => /^[0-9a-f-]{36}\.compileinfo$/i.test(n));
  } catch {
    return [];
  }
  return names
    .map((n) => ({ id: n.slice(0, 36).toUpperCase(), at: fs.statSync(path.join(info, n)).mtime.toISOString() }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

// The builds of the PLC project seen (XAE keeps only the latest's compile info): kept beside the .plcproj, to commit
// with the project (colleagues, every edition); the newest MAX_HISTORY
const HISTORY_FILE = 'MachineScope.builds.json';
const MAX_HISTORY = 200;

/** The builds in the project's history file, newest first: [{ id, at }] ([] when there is none) */
function buildHistory(pouPath) {
  const dir = pouPath ? folderWith(pouPath, '.plcproj') : null;
  if (!dir) return [];
  try {
    const f = JSON.parse(fs.readFileSync(path.join(dir, HISTORY_FILE), 'utf8'));
    return (Array.isArray(f?.builds) ? f.builds : [])
      .filter((b) => b && /^[0-9A-Fa-f-]{36}$/.test(String(b.id)) && typeof b.at === 'string')
      .map((b) => ({ id: String(b.id).toUpperCase(), at: b.at }));
  } catch {
    return [];
  }
}

/**
 * The project's builds: its _CompileInfo now and its history file together, newest first; a build new to the history
 * written into it (the file made when there is none). → [{ id, at }]
 */
function recordProjectBuilds(pouPath) {
  const now = projectBuilds(pouPath);
  const known = buildHistory(pouPath);
  const byId = new Map(known.map((b) => [b.id, b]));
  const fresh = now.filter((b) => !byId.has(b.id));
  for (const b of fresh) byId.set(b.id, b);
  const all = [...byId.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_HISTORY);
  const dir = pouPath ? folderWith(pouPath, '.plcproj') : null;
  if (fresh.length && dir) {
    const text = `${JSON.stringify({ note: 'The builds of this PLC project seen by Kval MachineScope (XAE keeps only the latest one\'s compile info): a PLC running one of them runs an older build of this project. Commit it with the project.', builds: all }, null, 2)}\n`;
    try {
      fs.writeFileSync(path.join(dir, HISTORY_FILE), text);
    } catch {
      // (read-only folder: the app keeps its own)
    }
  }
  return all;
}

/** The TwinCAT project (its .tsproj's name) the POU belongs to, or null */
function loadedProjectOf(pouPath) {
  const dir = pouPath ? folderWith(pouPath, '.tsproj') : null;
  if (!dir) return null;
  try {
    const ts = fs.readdirSync(dir).find((n) => n.toLowerCase().endsWith('.tsproj'));
    return ts ? { name: ts.replace(/\.tsproj$/i, ''), path: path.join(dir, ts) } : null;
  } catch {
    return null;
  }
}

/**
 * The PLC's build against the project's: { plc, newest, state: 'newest' | 'older' | 'other', builtAt } (state: the PLC
 * runs this copy's newest build, an older one of it, or one not built here); null when the PLC does not say
 */
function compareBuilds(plcId, builds) {
  if (!plcId) return null;
  const newest = builds[0] ?? null;
  const match = builds.find((b) => b.id === plcId);
  return { plc: plcId, newest, state: !match ? 'other' : match === newest ? 'newest' : 'older', builtAt: match?.at ?? null };
}

module.exports = { guidText, plcCompileId, projectBuilds, buildHistory, recordProjectBuilds, loadedProjectOf, compareBuilds, HISTORY_FILE };
