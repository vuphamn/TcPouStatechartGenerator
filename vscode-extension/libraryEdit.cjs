// The Library Manager's edits of a PLC project's libraries, as XAE's: a library's version set (the newest, *, or one),
// one added (a placeholder on the newest), one removed; the libraries installed on this computer to add or pick a
// version from. Pure text edits of the .plcproj (no vscode: tested on its own); its line ends and indentation kept.
'use strict';
const fs = require('fs');
const path = require('path');
const { libraryRepositories } = require('./plcTree.cjs');

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const xmlText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const resolution = (name, version, vendor) => `${name}, ${version}${vendor ? ` (${vendor})` : ''}`;
const isVersion = (v) => v === '*' || /^\d+(\.\d+){1,3}$/.test(v);
/** Versions compared as numbers: 3.3.100.0 after 3.3.59.0 */
function compareVersions(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** The libraries installed in the repositories → [{ vendor, name, versions (oldest first) }] by name */
function installedLibraries(repositories = libraryRepositories()) {
  const byKey = new Map();
  const dirs = (d) => {
    try {
      return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  };
  for (const repo of repositories) {
    for (const vendor of dirs(repo)) {
      for (const name of dirs(path.join(repo, vendor))) {
        const versions = dirs(path.join(repo, vendor, name)).filter((v) => /^\d+(\.\d+)+$/.test(v));
        if (!versions.length) continue;
        const k = `${vendor}|${name}`.toLowerCase();
        const e = byKey.get(k) ?? { vendor, name, versions: [] };
        e.versions = [...new Set([...e.versions, ...versions])];
        byKey.set(k, e);
      }
    }
  }
  return [...byKey.values()].map((e) => ({ ...e, versions: e.versions.sort(compareVersions) })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * A library's version: { placeholder, name, vendor } as readLibraries gives it; version '*' (the newest) or one.
 * A placeholder: its resolution's (PlaceholderResolution) when it has one, else its default resolution ('*' drops a
 * resolution: the default then on the newest); a library referenced at a version (LibraryReference): its Include
 */
function setLibraryVersion(xml, lib, version) {
  if (!isVersion(version)) throw new Error(`Not a version: ${version}`);
  const text = resolution(lib.name, version, lib.vendor);
  if (lib.placeholder) {
    const ph = esc(xmlText(lib.placeholder));
    const resRx = new RegExp(`([ \\t]*)<PlaceholderResolution\\s+Include="${ph}"[^>]*>[\\s\\S]*?</PlaceholderResolution>[ \\t]*\\r?\\n?`, 'i');
    if (resRx.test(xml)) {
      if (version === '*') xml = xml.replace(resRx, '').replace(/[ \t]*<ItemGroup>\s*<\/ItemGroup>[ \t]*\r?\n?/g, '');
      else return xml.replace(new RegExp(`(<PlaceholderResolution\\s+Include="${ph}"[^>]*>[\\s\\S]*?<Resolution>)[^<]*(</Resolution>)`, 'i'), (_, a, b) => `${a}${xmlText(text)}${b}`);
    }
    const defRx = new RegExp(`(<PlaceholderReference\\s+Include="${ph}"[^>]*>[\\s\\S]*?<DefaultResolution>)[^<]*(</DefaultResolution>)`, 'i');
    if (!defRx.test(xml)) throw new Error(`No placeholder ${lib.placeholder} in the project`);
    return xml.replace(defRx, (_, a, b) => `${a}${xmlText(text)}${b}`);
  }
  const refRx = new RegExp(`(<LibraryReference\\s+Include=")${esc(xmlText(lib.name))}\\s*,[^"]*(")`, 'i');
  if (!refRx.test(xml)) throw new Error(`No library ${lib.name} in the project`);
  return xml.replace(refRx, (_, a, b) => `${a}${xmlText(text)}${b}`);
}

/** A library removed: its placeholder (and its resolution) or its reference; an ItemGroup left empty removed too */
function removeLibrary(xml, lib) {
  const before = xml;
  const line = (tag, include, selfClosing) =>
    new RegExp(`[ \\t]*<${tag}\\s+Include="${include}"${selfClosing ? `[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)` : `[^>]*>[\\s\\S]*?</${tag}>`}[ \\t]*\\r?\\n?`, 'i');
  if (lib.placeholder) {
    const ph = esc(xmlText(lib.placeholder));
    xml = xml.replace(line('PlaceholderReference', ph, false), '').replace(line('PlaceholderResolution', ph, false), '');
  } else {
    xml = xml.replace(line('LibraryReference', `${esc(xmlText(lib.name))}\\s*,[^"]*`, true), '');
  }
  if (xml === before) throw new Error(`No library ${lib.name} in the project`);
  return xml.replace(/[ \t]*<ItemGroup>\s*<\/ItemGroup>[ \t]*\r?\n?/g, '');
}

/** A library added as XAE adds one: a placeholder of its name on the newest (or a version), its namespace its name */
function addLibrary(xml, { name, vendor, version = '*' }) {
  if (!isVersion(version)) throw new Error(`Not a version: ${version}`);
  const n = esc(xmlText(name));
  if (new RegExp(`<(?:PlaceholderReference|LibraryReference)\\s+Include="${n}(?:"|\\s*,)`, 'i').test(xml)) throw new Error(`${name} is already referenced`);
  const nl = xml.includes('\r\n') ? '\r\n' : '\n';
  // (the indentation of the project's items: 4 spaces under an ItemGroup of 2, as XAE writes)
  const ind = /\n([ \t]*)<ItemGroup>/.exec(xml)?.[1] ?? '  ';
  const one = ind.includes('\t') ? '\t' : '  ';
  const i2 = ind + one;
  const i3 = i2 + one;
  const el = [`${i2}<PlaceholderReference Include="${xmlText(name)}">`, `${i3}<DefaultResolution>${xmlText(resolution(name, version, vendor))}</DefaultResolution>`, `${i3}<Namespace>${xmlText(name)}</Namespace>`, `${i2}</PlaceholderReference>`].join(nl);
  // (beside the other placeholders, in name order; else in a new ItemGroup before the project's end)
  const refs = [...xml.matchAll(/[ \t]*<PlaceholderReference\s+Include="([^"]+)"[^>]*>[\s\S]*?<\/PlaceholderReference>[ \t]*\r?\n?/gi)];
  if (refs.length) {
    const after = refs.filter((m) => m[1].localeCompare(name, undefined, { sensitivity: 'base' }) < 0).pop();
    const at = after ? after.index + after[0].length : refs[0].index;
    const piece = `${el}${nl}`;
    return xml.slice(0, at) + (after && !/\n$/.test(after[0]) ? nl : '') + piece + xml.slice(at);
  }
  const end = xml.search(/<\/Project>\s*$/i);
  if (end < 0) throw new Error('Not a .plcproj (no </Project>)');
  return `${xml.slice(0, end)}${ind}<ItemGroup>${nl}${el}${nl}${ind}</ItemGroup>${nl}${xml.slice(end)}`;
}

/** A .plcproj read and written keeping its BOM: edit(xml) → the new text */
function editPlcproj(plcproj, edit) {
  const raw = fs.readFileSync(plcproj, 'utf8');
  const bom = raw.charCodeAt(0) === 0xfeff ? '﻿' : '';
  const next = edit(bom ? raw.slice(1) : raw);
  fs.writeFileSync(plcproj, bom + next, 'utf8');
  return next;
}

module.exports = { installedLibraries, setLibraryVersion, removeLibrary, addLibrary, editPlcproj, compareVersions };
