// Commissioning, kept beside the PLC project (MachineScope.commissioning.json) so a team shares it (commit it with the
// project): per POU type, the states the PLC may be set to from a state's menu, and a log of who set which state when
// (the user named by this computer, not by the page). Read and written by the desktop app and the VS Code extension's
// host (the XAE extension has its own, the same file).
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = 'MachineScope.commissioning.json';
const STATE_RX = /^[A-Za-z_][\w.]{0,120}$/;
const MAX_LOG = 500;

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

const cleanType = (v) => {
  const allowed = Array.isArray(v?.allowed) ? [...new Set(v.allowed.filter((s) => typeof s === 'string' && STATE_RX.test(s)))].slice(0, 500) : [];
  const log = Array.isArray(v?.log)
    ? v.log
        .filter((e) => e && typeof e.t === 'string' && typeof e.state === 'string')
        .map((e) => ({ t: e.t, user: String(e.user ?? ''), state: e.state, from: String(e.from ?? ''), plc: String(e.plc ?? ''), ok: e.ok !== false, ...(e.message ? { message: String(e.message).slice(0, 300) } : {}) }))
        .slice(-MAX_LOG)
    : [];
  return { allowed, log };
};

function readAll(dir) {
  try {
    const f = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8').replace(/^﻿/, ''));
    const pous = {};
    for (const [type, v] of Object.entries(f?.pous ?? {})) if (/^\w+$/.test(type)) pous[type] = cleanType(v);
    return pous;
  } catch {
    return {};
  }
}

/** A POU type's commissioning: { allowed: [states], log: [{ t, user, state, from, plc, ok }] } */
function readCommissioning(pouPath, pouType) {
  const dir = plcProjectDir(pouPath);
  if (!dir || !/^\w+$/.test(String(pouType))) return { allowed: [], log: [] };
  return readAll(dir)[pouType] ?? { allowed: [], log: [] };
}

/**
 * Saved: req { allowed?: [states] (the new list), entry?: { state, from, plc, ok, message } (a state set: logged with
 * this computer's user and the time) } → { allowed, log } as the file has them now, or { error }
 */
function saveCommissioning(pouPath, pouType, req, user = os.userInfo().username) {
  const dir = plcProjectDir(pouPath);
  if (!dir) return { error: 'No PLC project (.plcproj) above the POU' };
  if (!/^\w+$/.test(String(pouType))) return { error: 'Not a POU type' };
  const pous = readAll(dir);
  const mine = pous[pouType] ?? { allowed: [], log: [] };
  if (Array.isArray(req?.allowed)) mine.allowed = cleanType({ allowed: req.allowed }).allowed;
  const e = req?.entry;
  if (e && typeof e.state === 'string' && STATE_RX.test(e.state)) {
    mine.log = [...mine.log, { t: new Date().toISOString(), user: String(user || '?'), state: e.state, from: String(e.from ?? ''), plc: String(e.plc ?? ''), ok: e.ok !== false, ...(e.message ? { message: String(e.message).slice(0, 300) } : {}) }].slice(-MAX_LOG);
  }
  pous[pouType] = mine;
  const text = `${JSON.stringify({ note: "Commissioning of Kval MachineScope: each POU type's states the PLC may be set to from a state's menu (live), and who set which state when. Commit it with the project to share it.", pous }, null, 2)}\n`;
  try {
    fs.writeFileSync(path.join(dir, FILE), text);
  } catch (err) {
    return { error: `Not written: ${err?.message ?? err}` };
  }
  return mine;
}

module.exports = { readCommissioning, saveCommissioning, FILE };
