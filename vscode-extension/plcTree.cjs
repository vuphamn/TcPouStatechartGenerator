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

module.exports = { readPlcTree, plcProjectsUnder };
