// Reports kept beside the PLC project (MachineScope.reports/): the Live tab's test reports (HTML, and their data as
// JSON to compare two later) and the shift reports saved at each shift's end. Saved, listed and read back by the desktop
// app and the VS Code extension's host (the XAE extension does the same in C#: ReportsFolder.cs).
const fs = require('fs');
const path = require('path');

const FOLDER = 'MachineScope.reports';
const NAME_RX = /^[\w.-]{1,120}\.(html|json)$/i;
const MAX_BYTES = 4 * 1024 * 1024;

function plcprojDir(from, levels = 8) {
  if (typeof from !== 'string' || !path.isAbsolute(from)) return null;
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

const okName = (name) => typeof name === 'string' && NAME_RX.test(name) && !name.includes('..');

/** { name, content } → { ok, path } or { ok: false, error } */
function saveReportFile(pouPath, req) {
  const name = String(req?.name ?? '');
  if (!okName(name)) return { ok: false, error: 'Not a report file name (.html or .json)' };
  if (typeof req?.content !== 'string' || req.content.length > MAX_BYTES) return { ok: false, error: 'Nothing to save, or too large' };
  const dir = plcprojDir(pouPath);
  if (!dir) return { ok: false, error: 'The PLC project (.plcproj) of the POU was not found' };
  try {
    const out = path.join(dir, FOLDER);
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, name);
    fs.writeFileSync(file, req.content);
    return { ok: true, path: file };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** The reports kept: { files: [{ name, size, mtime }] } newest first (at most 200), or { files: [], error } */
function listReportFiles(pouPath) {
  const dir = plcprojDir(pouPath);
  if (!dir) return { files: [], error: 'The PLC project (.plcproj) of the POU was not found' };
  try {
    const out = path.join(dir, FOLDER);
    if (!fs.existsSync(out)) return { files: [] };
    const files = fs
      .readdirSync(out)
      .filter(okName)
      .map((name) => {
        const s = fs.statSync(path.join(out, name));
        return { name, size: s.size, mtime: s.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name))
      .slice(0, 200);
    return { files };
  } catch (err) {
    return { files: [], error: err.message };
  }
}

/** One report's text: { ok, content } or { ok: false, error } */
function readReportFile(pouPath, name) {
  if (!okName(name)) return { ok: false, error: 'Not a report file name' };
  const dir = plcprojDir(pouPath);
  if (!dir) return { ok: false, error: 'The PLC project (.plcproj) of the POU was not found' };
  try {
    const file = path.join(dir, FOLDER, name);
    if (fs.statSync(file).size > MAX_BYTES) return { ok: false, error: 'Too large' };
    return { ok: true, content: fs.readFileSync(file, 'utf8').replace(/^﻿/, '') };
  } catch (err) {
    return { ok: false, error: err.code === 'ENOENT' ? 'No such report' : err.message };
  }
}

module.exports = { saveReportFile, listReportFiles, readReportFile, FOLDER };
