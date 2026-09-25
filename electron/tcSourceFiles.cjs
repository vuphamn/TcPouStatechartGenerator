// Reads a .TcPOU and collects the .TcDUT files in its folder and subfolders (the enum is matched in the renderer)
const fs = require('fs/promises');
const path = require('path');

const MAX_DEPTH = 8;
const MAX_DUT_FILES = 500;
// Build output, VCS and library folders never hold the POU's own enum
const SKIP_DIRS = new Set(['node_modules', '_boot', '_compileinfo', '_libraries', '_deployment', 'bin', 'obj']);

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function findDutFiles(rootDir) {
  const found = [];
  async function walk(dir, depth) {
    if (depth > MAX_DEPTH || found.length >= MAX_DUT_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable folder
    }
    // Files first, so the POU's own folder wins when the limit is reached
    entries.sort((a, b) => Number(a.isDirectory()) - Number(b.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (found.length >= MAX_DUT_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.tcdut')) {
        try {
          const content = stripBom(await fs.readFile(full, 'utf8'));
          found.push({ name: entry.name, relativePath: path.relative(rootDir, full).split(path.sep).join('/'), content });
        } catch {
          // skip unreadable file
        }
      }
    }
  }
  await walk(rootDir, 0);
  return found;
}

async function readPouWithDutCandidates(pouPath) {
  const content = stripBom(await fs.readFile(pouPath, 'utf8'));
  const dutCandidates = await findDutFiles(path.dirname(pouPath));
  return { name: path.basename(pouPath), path: pouPath, content, dutCandidates };
}

module.exports = { findDutFiles, readPouWithDutCandidates };
