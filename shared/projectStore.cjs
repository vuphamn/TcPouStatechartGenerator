// Small per-POU-type settings kept beside the PLC project so a team shares them (commit the file with the project):
// one file per kind, { note, pous: { <POU type>: <value> } }. The desktop app and the VS Code extension's host read and
// write them (the XAE extension has its own, the same files). Kinds: alerts (MachineScope.alerts.json: the Live tab's
// alert profiles).
const fs = require('fs');
const path = require('path');

const KINDS = {
  alerts: { file: 'MachineScope.alerts.json', note: "Alert profiles of Kval MachineScope (the Live tab's Watched): each POU type's named sets of watch expressions, which alert and after how long. Commit it with the project to share them." },
};
const MAX_BYTES = 200_000;

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

function readAll(dir, kind) {
  try {
    const f = JSON.parse(fs.readFileSync(path.join(dir, KINDS[kind].file), 'utf8').replace(/^﻿/, ''));
    return f && typeof f.pous === 'object' && f.pous ? f.pous : {};
  } catch {
    return {};
  }
}

/** A POU type's value of a kind → { value } (null: none yet), or { error } */
function readStore(pouPath, kind, pouType) {
  if (!KINDS[kind]) return { error: 'Not a kind of settings' };
  const dir = plcProjectDir(pouPath);
  if (!dir || !/^\w+$/.test(String(pouType))) return { value: null };
  return { value: readAll(dir, kind)[pouType] ?? null };
}

/** A POU type's value saved (null: removed) → { value } or { error } */
function saveStore(pouPath, kind, pouType, value) {
  if (!KINDS[kind]) return { error: 'Not a kind of settings' };
  const dir = plcProjectDir(pouPath);
  if (!dir) return { error: 'No PLC project (.plcproj) above the POU' };
  if (!/^\w+$/.test(String(pouType))) return { error: 'Not a POU type' };
  if (value !== null && (typeof value !== 'object' || JSON.stringify(value).length > MAX_BYTES)) return { error: 'Not settings (an object, 200 KB at most)' };
  const pous = readAll(dir, kind);
  if (value === null) delete pous[pouType];
  else pous[pouType] = value;
  try {
    fs.writeFileSync(path.join(dir, KINDS[kind].file), `${JSON.stringify({ note: KINDS[kind].note, pous }, null, 2)}\n`);
  } catch (err) {
    return { error: `Not written: ${err?.message ?? err}` };
  }
  return { value };
}

module.exports = { readStore, saveStore, KINDS };
