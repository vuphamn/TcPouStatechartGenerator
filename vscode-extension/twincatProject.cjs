// The TwinCAT project of a file, read from the files only (no vscode: tested on its own): its folder and .tsproj, the
// PLC project the file is in, the target the project names; a PLC project's .plcproj by name
'use strict';
const fs = require('fs');
const path = require('path');
const { projectRootOf } = require('../shared/tcBuild.cjs');

/** The project of a file: { root, tsproj, name, plcproj, plcProject } or null (not in a TwinCAT project) */
function projectOf(file) {
  if (!file) return null;
  const root = projectRootOf(file);
  if (!root) return null;
  const tsproj = fs.readdirSync(root).find((f) => /\.tsproj$/i.test(f));
  if (!tsproj) return null;
  // (the PLC project the file is in: the nearest .plcproj above it, up to the project's folder)
  let dir = path.dirname(path.resolve(file));
  let plcproj = null;
  for (let i = 0; i < 8 && dir.toLowerCase().startsWith(root.toLowerCase()); i++) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      break;
    }
    const p = names.find((f) => /\.plcproj$/i.test(f));
    if (p) {
      plcproj = path.join(dir, p);
      break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return { root, tsproj: path.join(root, tsproj), name: tsproj.replace(/\.tsproj$/i, ''), plcproj, plcProject: plcproj ? path.basename(plcproj, '.plcproj') : '' };
}

/** The target the project names (its .tsproj's TargetNetId), or null: this computer */
function projectTarget(tsproj) {
  try {
    const head = fs.readFileSync(tsproj, 'utf8').slice(0, 20000);
    return /<Project\b[^>]*\bTargetNetId="(\d+(?:\.\d+){5})"/.exec(head)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The .plcproj of that name in a project folder (searched a few levels down), or null */
function findPlcproj(root, name, depth = 0) {
  if (depth > 4) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) if (e.isFile() && e.name.toLowerCase() === `${String(name).toLowerCase()}.plcproj`) return path.join(root, e.name);
  for (const e of entries) {
    if (!e.isDirectory() || ['.git', '.vs', '_Boot', 'node_modules'].includes(e.name)) continue;
    const hit = findPlcproj(path.join(root, e.name), name, depth + 1);
    if (hit) return hit;
  }
  return null;
}

module.exports = { projectOf, projectTarget, findPlcproj };
