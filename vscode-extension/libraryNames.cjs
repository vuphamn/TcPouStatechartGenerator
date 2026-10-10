// The names the project's libraries declare (no vscode here: tested on its own): read from XAE's library cache in
// the PLC project (_Libraries\<vendor>\<library>\<version>\*.compiled-library*: a zip whose string table holds the
// library's names), so the checks do not take a library's function block, enum member or global for a typo. Kept per
// library file (its time and size); lower case
'use strict';
const fs = require('fs');
const path = require('path');
const { unzip } = require('../shared/tcSources.cjs');

const cache = new Map();
const NAME_RX = /[A-Za-z_][A-Za-z0-9_]{1,80}/g;

/** The compiled libraries under a folder (its _Libraries), a few levels down */
function libraryFiles(dir, depth = 0, out = []) {
  if (depth > 5) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) libraryFiles(p, depth + 1, out);
    else if (/\.compiled-library/i.test(e.name) || /\.library$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** One library's names (its string tables; the whole of a small entry else) */
function namesOfLibrary(file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return new Set();
  }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.names;
  const names = new Set();
  try {
    const entries = unzip(fs.readFileSync(file));
    const tables = entries.filter((e) => /string_table|\.auxiliary$/i.test(e.path));
    for (const e of tables.length ? tables : entries) {
      for (const m of e.data.toString('latin1').matchAll(NAME_RX)) names.add(m[0].toLowerCase());
    }
  } catch {
    // (not a zip, or not readable: no names from it)
  }
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, names });
  return names;
}

/** Every name of the libraries cached in a project folder's PLC projects (their _Libraries) */
function libraryNames(projectRoot) {
  const out = new Set();
  const dirs = [];
  const find = (dir, depth) => {
    if (depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (e.name === '_Libraries') dirs.push(p);
      else if (!['.git', '.vs', '_Boot', '_CompileInfo', 'node_modules'].includes(e.name)) find(p, depth + 1);
    }
  };
  find(projectRoot, 0);
  for (const d of dirs) for (const f of libraryFiles(d)) for (const n of namesOfLibrary(f)) out.add(n);
  return out;
}

module.exports = { libraryNames, namesOfLibrary, libraryFiles };
