// The PLC's I/O tree (read-only), as its TwinCAT project describes it (shared/ioTreeParse.mjs, the parser the page
// uses too): from CurrentConfig.tszip (the PLC's boot folder) or a project folder on this computer.
const { DOMParser } = require('@xmldom/xmldom');

const parseXml = (text) => new DOMParser({ onError: () => {} }).parseFromString(text, 'text/xml');
let core = null;
const loadCore = async () => (core ??= await import('./ioTreeParse.mjs'));

/** The devices and links of the I/O configuration's .xti files ({ path: text }): see ioTreeParse.mjs */
async function parseIoTree(files) {
  return (await loadCore()).parseIoTreeWith(files, parseXml);
}

/**
 * The I/O tree of a PLC (read: its boot folder's file by path -> Buffer): its CurrentConfig.tszip's .xti files,
 * its project's name (CurrentProjectInfo.json, or the .tsproj's). { devices, links, project } or { error }
 */
async function readIoTree(read) {
  const { unzip, projectInfoOf } = require('./tcSources.cjs');
  let zip;
  try {
    zip = await read('CurrentConfig.tszip');
  } catch {
    return { error: 'The PLC keeps no TwinCAT project in its boot folder (CurrentConfig.tszip): activate the configuration from XAE once' };
  }
  const files = {};
  for (const f of unzip(zip, (path) => /\.xti$/i.test(path))) files[f.path] = f.data.toString('utf8');
  let project = '';
  try {
    project = (await projectInfoOf(read, zip))?.project?.name ?? '';
  } catch {
    // (its name not known)
  }
  const tree = await parseIoTree(files);
  if (!tree.devices.length) return { ...tree, project, error: 'No I/O devices in the PLC\'s TwinCAT project' };
  return { ...tree, project };
}

/**
 * The I/O tree of a TwinCAT project on this computer (offline): dir, the folder of its .tsproj (or one above it, a
 * solution's: its first .tsproj two levels down at most); its _Config's .xti files. { devices, links, project, folder }
 * or { error }
 */
async function readIoFolder(dir) {
  const fs = require('fs');
  const path = require('path');
  const tsprojIn = (d) => {
    try {
      return fs.readdirSync(d).find((f) => /\.tsproj$/i.test(f)) ?? null;
    } catch {
      return null;
    }
  };
  let root = null;
  let tsproj = null;
  const look = (d, depth) => {
    if (root || depth > 2) return;
    const t = tsprojIn(d);
    if (t) {
      root = d;
      tsproj = t;
      return;
    }
    let subs = [];
    try {
      subs = fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !/^(\.|_Boot$|node_modules$)/i.test(e.name));
    } catch {
      return;
    }
    for (const e of subs) look(path.join(d, e.name), depth + 1);
  };
  look(path.resolve(String(dir || '')), 0);
  if (!root) return { error: 'No TwinCAT project (.tsproj) in that folder' };
  const files = {};
  let count = 0;
  const walk = (d, rel, depth) => {
    if (depth > 6 || count > 400) return;
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(d, e.name), `${rel}${e.name}/`, depth + 1);
      else if (/\.xti$/i.test(e.name) && count++ < 400) files[rel + e.name] = fs.readFileSync(path.join(d, e.name), 'utf8');
    }
  };
  walk(path.join(root, '_Config'), '_Config/', 0);
  const project = tsproj.replace(/\.tsproj$/i, '');
  const tree = await parseIoTree(files);
  if (!tree.devices.length) return { ...tree, project, folder: root, error: 'No I/O devices in that TwinCAT project (its _Config folder)' };
  return { ...tree, project, folder: root };
}

module.exports = { parseIoTree, readIoTree, readIoFolder };
