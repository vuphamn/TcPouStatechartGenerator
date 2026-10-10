// The sign-off report's heading for a project: MachineScope.report.json beside the PLC project (.plcproj), e.g.
// { "company": "Kval Inc.", "machine": "Line 202", "logo": "logo.png" }; the logo a file beside it (or a path
// relative to it), embedded as a data URL so the report stays one file. Read by the desktop app and the VS Code
// extension's host (the XAE extension has its own).

const fs = require('fs');
const path = require('path');

const FILE = 'MachineScope.report.json';
const LOGO_MAX = 512 * 1024;
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

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

/**
 * The report's heading: { company, machine, logo (a data URL), file } (those given), {} without a file; { error }
 * when it is there but not readable (said in the app, the report made without it)
 */
function readReportSettings(pouPath) {
  const dir = plcProjectDir(pouPath);
  if (!dir) return {};
  const file = path.join(dir, FILE);
  if (!fs.existsSync(file)) return {};
  let s;
  try {
    s = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    return { file, error: `${FILE} is not readable: ${err.message}` };
  }
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined);
  const out = { file, company: text(s?.company), machine: text(s?.machine) };
  if (typeof s?.logo === 'string' && s.logo.trim()) {
    const logo = path.resolve(dir, s.logo.trim());
    const type = TYPES[path.extname(logo).toLowerCase()];
    try {
      if (!type) out.error = `The logo must be a .png, .jpg, .gif or .svg (${s.logo})`;
      else if (fs.statSync(logo).size > LOGO_MAX) out.error = `The logo is over ${LOGO_MAX / 1024} KB (${s.logo})`;
      else out.logo = `data:${type};base64,${fs.readFileSync(logo).toString('base64')}`;
    } catch {
      out.error = `The logo is not there: ${logo}`;
    }
  }
  return out;
}

module.exports = { readReportSettings, REPORT_SETTINGS_FILE: FILE };
