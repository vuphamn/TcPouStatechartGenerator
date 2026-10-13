// A live session's event log kept beside the PLC project (the Live tab's Events, "Keep each session's log"): a CSV
// per session in <the PLC project's folder>/MachineScope.events/ (the desktop app and the VS Code extension; the XAE
// extension does the same in C#), for the next shift to read. → { ok, path } or { ok: false, error }
const fs = require('fs');
const path = require('path');

const FOLDER = 'MachineScope.events';

function plcprojDir(from, levels = 8) {
  let dir = path.dirname(path.resolve(from));
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

function saveEventsFile(pouPath, req) {
  if (typeof pouPath !== 'string' || !path.isAbsolute(pouPath)) return { ok: false, error: 'No PLC project loaded' };
  const name = String(req?.name ?? '');
  if (!/^[\w.-]{1,120}\.csv$/i.test(name) || name.includes('..')) return { ok: false, error: 'Not a file name' };
  if (typeof req?.csv !== 'string') return { ok: false, error: 'Nothing to save' };
  const dir = plcprojDir(pouPath);
  if (!dir) return { ok: false, error: 'The PLC project (.plcproj) of the POU was not found' };
  try {
    const out = path.join(dir, FOLDER);
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, name);
    fs.writeFileSync(file, '﻿' + req.csv);
    return { ok: true, path: file };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { saveEventsFile, FOLDER };
