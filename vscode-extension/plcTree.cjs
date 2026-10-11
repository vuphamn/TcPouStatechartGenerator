// The PLC project's tree, as XAE's Solution Explorer shows it (no vscode here: tested on its own): read from its
// .plcproj: its folders and files (Compile Include="POUs\EFX\EFX.TcPOU", Folder Include="POUs\EFX") and its
// libraries (PlaceholderReference / LibraryReference). { name, folders: [node], files: [node], references: [names] };
// node: { name, path (relative), children: [node] (a folder), file (absolute: a file) }
'use strict';
const fs = require('fs');
const path = require('path');

const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/%20/g, ' ');

function readPlcTree(plcproj) {
  const xml = fs.readFileSync(plcproj, 'utf8');
  const dir = path.dirname(plcproj);
  const root = { name: path.basename(plcproj, path.extname(plcproj)), path: '', children: [] };
  const folderAt = (rel) => {
    let at = root;
    let sofar = '';
    for (const part of rel.split(/[\\/]/).filter(Boolean)) {
      sofar = sofar ? `${sofar}\\${part}` : part;
      let next = at.children.find((c) => c.children && c.name.toLowerCase() === part.toLowerCase());
      if (!next) {
        next = { name: part, path: sofar, children: [] };
        at.children.push(next);
      }
      at = next;
    }
    return at;
  };
  for (const m of xml.matchAll(/<Folder\s+Include="([^"]+)"/gi)) folderAt(unescape(m[1]));
  for (const m of xml.matchAll(/<Compile\s+Include="([^"]+)"/gi)) {
    const rel = unescape(m[1]);
    if (!/\.(TcPOU|TcDUT|TcGVL|TcIO|TcTLEO|TcVis|TcTTO|TcIPO)$/i.test(rel)) continue;
    const parts = rel.split(/[\\/]/);
    const name = parts.pop();
    folderAt(parts.join('\\')).children.push({ name: name.replace(/\.\w+$/, ''), path: rel, file: path.join(dir, ...rel.split(/[\\/]/)), ext: path.extname(name).slice(1) });
  }
  // (folders first, then files, each by name; as XAE sorts them)
  const sort = (n) => {
    n.children.sort((a, b) => (!!b.children - !!a.children) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    for (const c of n.children) if (c.children) sort(c);
  };
  sort(root);
  const references = [...new Set([...xml.matchAll(/<(?:PlaceholderReference|LibraryReference)\s+Include="([^"]+)"/gi)].map((m) => unescape(m[1]).split(',')[0].trim()))].sort((a, b) => a.localeCompare(b));
  return { name: root.name, children: root.children, references };
}

/** The PLC projects of a project folder (their .plcproj), a few levels down */
function plcProjectsUnder(root, depth = 0, out = []) {
  if (depth > 4) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isFile() && /\.plcproj$/i.test(e.name)) out.push(p);
    else if (e.isDirectory() && !['.git', '.vs', '_Boot', '_CompileInfo', '_Libraries', 'node_modules'].includes(e.name)) plcProjectsUnder(p, depth + 1, out);
  }
  return out;
}

const num = (s) => (s === undefined || s === null || s === '' || Number.isNaN(Number(s)) ? undefined : Number(s));

/** The .TcTTO files of a PLC project's folder (a few levels down) */
function ttoFilesUnder(dir, depth = 0, out = []) {
  if (depth > 3) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && /\.tcTTO$/i.test(e.name)) out.push(p);
    else if (e.isDirectory() && !['.git', '.vs', '_Boot', '_CompileInfo', '_Libraries'].includes(e.name)) ttoFilesUnder(p, depth + 1, out);
  }
  return out;
}

/**
 * A TwinCAT project's tasks, as XAE's SYSTEM > Tasks and each PLC project's task objects show them: the .tsproj's
 * real-time tasks (cycle in 100 ns, priority, AMS port) with the PLC task objects (.TcTTO: cycle in µs, priority, the
 * programs it calls) of the same name → [{ name, cycleMs, priority, adsPort, calls: [names], plc, ttoFile, tsproj }]
 */
function readTasks(root) {
  const tasks = new Map();
  const entry = (name) => {
    const k = name.toLowerCase();
    if (!tasks.has(k)) tasks.set(k, { name, calls: [] });
    return tasks.get(k);
  };
  let tsproj = null;
  try {
    tsproj = fs.readdirSync(root).find((f) => /\.tsproj$/i.test(f)) ?? null;
  } catch {
    // (no folder)
  }
  if (tsproj) {
    const xml = fs.readFileSync(path.join(root, tsproj), 'utf8');
    const block = /<Tasks>([\s\S]*?)<\/Tasks>/i.exec(xml)?.[1] ?? '';
    for (const m of block.matchAll(/<Task\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Task>)/gi)) {
      const attr = (n) => new RegExp(`\\b${n}="([^"]*)"`, 'i').exec(m[1])?.[1];
      const name = unescape(/<Name>([^<]*)<\/Name>/i.exec(m[2] ?? '')?.[1] ?? attr('Name') ?? `Task ${attr('Id') ?? ''}`.trim());
      const t = entry(name);
      const cycle = num(attr('CycleTime'));
      if (cycle !== undefined) t.cycleMs = cycle / 10000;
      t.priority = num(attr('Priority')) ?? t.priority;
      t.adsPort = num(attr('AmsPort')) ?? t.adsPort;
      t.tsproj = path.join(root, tsproj);
    }
  }
  for (const plcproj of plcProjectsUnder(root)) {
    const plc = path.basename(plcproj, path.extname(plcproj));
    for (const file of ttoFilesUnder(path.dirname(plcproj))) {
      let xml;
      try {
        xml = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const m = /<Task\b[^>]*\bName="([^"]+)"/i.exec(xml);
      const t = entry(unescape(m?.[1] ?? path.basename(file, path.extname(file))));
      const us = num(/<CycleTime>([^<]*)<\/CycleTime>/i.exec(xml)?.[1]);
      if (t.cycleMs === undefined && us !== undefined) t.cycleMs = us / 1000;
      t.priority ??= num(/<Priority>([^<]*)<\/Priority>/i.exec(xml)?.[1]);
      t.calls = [...xml.matchAll(/<PouCall>\s*<Name>([^<]*)<\/Name>/gi)].map((c) => unescape(c[1]));
      t.plc = plc;
      t.ttoFile = file;
    }
  }
  return [...tasks.values()].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || a.name.localeCompare(b.name));
}

/** The library repositories of this computer: TwinCAT 4026's, 4024's */
const LIBRARY_REPOSITORIES = [
  path.join(process.env.ProgramData || 'C:\\ProgramData', 'Beckhoff', 'TwinCAT', 'PlcEngineering', 'Managed Libraries'),
  'C:\\TwinCAT\\3.1\\Components\\Plc\\Managed Libraries',
];
const versionsIn = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d+(\.\d+)+$/.test(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
};
const byVersion = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/**
 * The PLC project's libraries, as XAE's Library Manager shows them: each reference (a placeholder or a library) with
 * its vendor, the version asked for ("*": the newest; else pinned, a placeholder's resolution too), the versions the
 * project's cache (_Libraries) and this computer's repositories hold, the one used, and whether it is missing →
 * [{ name, vendor, version, pinned, placeholder, used, cached: [], installed: [], missing }]
 */
function readLibraries(plcproj, { repositories = LIBRARY_REPOSITORIES } = {}) {
  const xml = fs.readFileSync(plcproj, 'utf8');
  const dir = path.dirname(plcproj);
  // "Tc2_Standard, 3.3.3.0 (Beckhoff Automation GmbH)" / "Tc2_Standard, * (Beckhoff Automation GmbH)"
  const parse = (s) => {
    const m = /^\s*([^,]+?)\s*,\s*([^\s(]+)\s*(?:\(([^)]*)\))?\s*$/.exec(unescape(s ?? ''));
    return m ? { name: m[1], version: m[2], vendor: m[3] ?? '' } : null;
  };
  const resolutions = new Map();
  for (const m of xml.matchAll(/<PlaceholderResolution\s+Include="([^"]+)"[^>]*>[\s\S]*?<Resolution>([^<]*)<\/Resolution>/gi)) resolutions.set(unescape(m[1]).toLowerCase(), parse(m[2]));
  const out = [];
  for (const m of xml.matchAll(/<PlaceholderReference\s+Include="([^"]+)"[^>]*>([\s\S]*?)<\/PlaceholderReference>/gi)) {
    const include = unescape(m[1]);
    const def = parse(/<DefaultResolution>([^<]*)<\/DefaultResolution>/i.exec(m[2])?.[1]);
    const res = resolutions.get(include.toLowerCase()) ?? def;
    if (res) out.push({ name: res.name, vendor: res.vendor, version: res.version, placeholder: include });
  }
  for (const m of xml.matchAll(/<LibraryReference\s+Include="([^"]+)"/gi)) {
    const r = parse(m[1]);
    if (r && !out.some((x) => x.name.toLowerCase() === r.name.toLowerCase())) out.push({ name: r.name, vendor: r.vendor, version: r.version, placeholder: null });
  }
  return out
    .map((l) => {
      const cached = versionsIn(path.join(dir, '_Libraries', l.vendor, l.name)).sort(byVersion);
      const installed = [...new Set(repositories.flatMap((r) => versionsIn(path.join(r, l.vendor, l.name))))].sort(byVersion);
      const pinned = l.version !== '*';
      const all = [...new Set([...cached, ...installed])].sort(byVersion);
      const used = pinned ? (all.includes(l.version) ? l.version : null) : all[all.length - 1] ?? null;
      return { ...l, pinned, used, cached, installed, missing: !used };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

module.exports = { readPlcTree, plcProjectsUnder, readTasks, readLibraries, LIBRARY_REPOSITORIES };
