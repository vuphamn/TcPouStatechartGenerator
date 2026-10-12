// Named watch lists, kept beside the PLC project (MachineScope.watch.json) so a team shares them (commit it with the
// project): per POU type, each list's name and its variables. Read and written by the desktop app and the VS Code
// extension's host (the XAE extension has its own, the same file).

const fs = require('fs');
const path = require('path');

const FILE = 'MachineScope.watch.json';
const NAME_RX = /^[^\\/:*?"<>|\r\n]{1,60}$/;
const VAR_RX = /^[A-Za-z_][\w.[\]^]{0,249}$/;

/** The folder of the POU's PLC project (its .plcproj), or null */
function plcProjectDir(pouPath, levels = 8) {
  if (typeof pouPath !== 'string' || !path.isAbsolute(pouPath)) return null;
  let dir = path.dirname(path.resolve(pouPath));
  for (let k = 0; k < levels; k++) {
    try {
      if (fs.readdirSync(dir).some((n) => n.toLowerCase().endsWith('.plcproj'))) return dir;
    } catch {
      return null;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

const cleanLists = (lists) => {
  const out = {};
  for (const [name, vars] of Object.entries(lists && typeof lists === 'object' ? lists : {})) {
    if (!NAME_RX.test(name) || !Array.isArray(vars)) continue;
    out[name] = [...new Set(vars.filter((v) => typeof v === 'string' && VAR_RX.test(v)))].slice(0, 200);
  }
  return out;
};

function readAll(dir) {
  try {
    const f = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'));
    const pous = {};
    for (const [type, lists] of Object.entries(f?.pous ?? {})) if (/^\w+$/.test(type)) pous[type] = cleanLists(lists);
    return pous;
  } catch {
    return {};
  }
}

/** A POU type's lists in the project's file: { lists: { name: [variables] } } ({} when none) */
function readWatchLists(pouPath, pouType) {
  const dir = plcProjectDir(pouPath);
  if (!dir || !/^\w+$/.test(String(pouType))) return { lists: {} };
  return { lists: readAll(dir)[pouType] ?? {} };
}

/** A list saved (vars null: removed) → { lists } as the file has them now, or { error } */
function saveWatchList(pouPath, pouType, name, vars) {
  const dir = plcProjectDir(pouPath);
  if (!dir) return { error: 'No PLC project (.plcproj) above the POU' };
  if (!/^\w+$/.test(String(pouType)) || !NAME_RX.test(String(name))) return { error: 'Not a list name' };
  const pous = readAll(dir);
  const lists = { ...(pous[pouType] ?? {}) };
  if (vars === null) delete lists[name];
  else lists[name] = cleanLists({ [name]: vars })[name] ?? [];
  pous[pouType] = lists;
  if (!Object.keys(lists).length) delete pous[pouType];
  const text = `${JSON.stringify({ note: "Watch lists of Kval MachineScope (the Live tab's Watched): each POU type's named lists of variables. Commit it with the project to share them.", pous }, null, 2)}\n`;
  try {
    fs.writeFileSync(path.join(dir, FILE), text);
  } catch (err) {
    return { error: `Not written: ${err?.message ?? err}` };
  }
  return { lists: pous[pouType] ?? {} };
}

module.exports = { readWatchLists, saveWatchList, FILE };
