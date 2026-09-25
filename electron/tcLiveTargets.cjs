// Where a function block lives in the running PLC (desktop live view): its instance paths ("MAIN.fbLine.smTable"),
// found from the declarations in the PLC project's files, and the PLC's ADS port (from the TwinCAT project's
// .xti / .tsproj). Same rules as the XAE extension's LiveTargets.cs.
const fs = require('fs');
const path = require('path');

const DEFAULT_PLC_PORT = 851;
const MAX_PATHS = 50;
const MAX_FILES = 5000;

function plcProjectFile(filePath) {
  let dir = path.dirname(filePath);
  for (let depth = 0; depth < 12; depth++) {
    try {
      const hit = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.plcproj'));
      if (hit) return path.join(dir, hit);
    } catch {
      return null;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

function listFiles(dir, test, out = [], depth = 0) {
  if (depth > 12 || out.length >= MAX_FILES) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && !/^_(boot|compileinfo|libraries|deployment)$/i.test(e.name)) listFiles(full, test, out, depth + 1);
    } else if (test(e.name)) out.push(full);
  }
  return out;
}

/** The ADS port of the PLC project that contains the file (851 when not found) */
function plcPort(filePath) {
  const plcproj = plcProjectFile(filePath);
  if (!plcproj) return DEFAULT_PLC_PORT;
  let dir = path.dirname(path.dirname(plcproj));
  for (let depth = 0; depth < 4; depth++) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      break;
    }
    if (names.some((n) => n.toLowerCase().endsWith('.tsproj'))) {
      const files = [
        ...names.filter((n) => n.toLowerCase().endsWith('.tsproj')).map((n) => path.join(dir, n)),
        ...listFiles(dir, (n) => n.toLowerCase().endsWith('.xti')),
      ];
      for (const file of files) {
        let text;
        try {
          text = fs.readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        for (const m of text.matchAll(/<Project\b[^>]*>/g)) {
          const prj = m[0].match(/\bPrjFilePath="([^"]+)"/);
          const port = m[0].match(/\bAmsPort="(\d+)"/);
          if (!prj || !port) continue;
          const resolved = path.resolve(path.dirname(file), prj[1].replace(/\\/g, path.sep));
          if (resolved.toLowerCase() === plcproj.toLowerCase() || path.basename(resolved).toLowerCase() === path.basename(plcproj).toLowerCase()) {
            return Number(port[1]);
          }
        }
      }
      break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return DEFAULT_PLC_PORT;
}

/** The text with (* *) (nestable), // comments and {pragmas} blanked out */
function blankComments(text) {
  const out = text.split('');
  for (let i = 0; i < out.length; i++) {
    if (text[i] === '(' && text[i + 1] === '*') {
      let depth = 0;
      let j = i;
      for (; j < text.length; j++) {
        if (text[j] === '(' && text[j + 1] === '*') {
          depth++;
          j++;
        } else if (text[j] === '*' && text[j + 1] === ')') {
          depth--;
          j++;
          if (depth === 0) break;
        }
      }
      for (let k = i; k <= Math.min(j, out.length - 1); k++) if (out[k] !== '\n') out[k] = ' ';
      i = j;
    } else if (text[i] === '/' && text[i + 1] === '/') {
      for (; i < out.length && text[i] !== '\n'; i++) out[i] = ' ';
    } else if (text[i] === '{') {
      for (; i < out.length && text[i] !== '}' && text[i] !== '\n'; i++) out[i] = ' ';
      if (text[i] === '}') out[i] = ' ';
    }
  }
  return out.join('');
}

const BLOCK = /\b(VAR_GLOBAL|VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_TEMP|VAR_STAT|VAR_INST|VAR_EXTERNAL|VAR)\b([^\r\n]*)([\s\S]*?)\bEND_VAR\b/gi;

function readType(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const isGvl = file.toLowerCase().endsWith('.tcgvl');
  const head = xml.match(isGvl ? /<GVL\b[^>]*\bName="([^"]+)"/ : /<POU\b[^>]*\bName="([^"]+)"/);
  if (!head) return null;
  // The object's own declaration (its methods' declarations come later in the file)
  const decl = xml.slice(head.index).match(/<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (!decl) return null;
  const code = blankComments(decl[1]);
  const type = { name: head[1], kind: 'GVL', extends: null, members: [] };
  if (!isGvl) {
    const kind = code.match(/^\s*(PROGRAM|FUNCTION_BLOCK|FUNCTION|INTERFACE)\b/im);
    type.kind = kind ? kind[1].toUpperCase() : 'FUNCTION_BLOCK';
    const ext = code.match(/\bEXTENDS\s+([A-Za-z_][\w.]*)/i);
    if (ext) type.extends = ext[1].split('.').pop();
  }
  if (type.kind === 'FUNCTION' || type.kind === 'INTERFACE') return null;
  for (const b of code.matchAll(BLOCK)) {
    const kind = b[1].toUpperCase();
    if (['VAR_TEMP', 'VAR_IN_OUT', 'VAR_INST', 'VAR_EXTERNAL'].includes(kind) || /\bCONSTANT\b/i.test(b[2])) continue;
    for (const statement of b[3].split(';')) {
      const m = statement.match(/^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?:AT\s+%\S+\s*)?:\s*([\s\S]+)$/);
      if (!m) continue;
      const typeText = m[2].replace(/:=[\s\S]*$/, '').trim();
      if (/^(ARRAY|POINTER|REFERENCE)\b/i.test(typeText)) continue;
      const typeName = (typeText.match(/^([A-Za-z_][\w.]*)/)?.[1] ?? '').split('.').pop();
      if (!typeName) continue;
      for (const name of m[1].split(',')) type.members.push({ name: name.trim(), type: typeName });
    }
  }
  return type;
}

/** Instance paths of the function block (or the program itself), from the PLC project's declarations */
function instancePaths(pouPath, pouName) {
  const plcproj = plcProjectFile(pouPath);
  if (!plcproj) return [];
  const types = new Map();
  for (const file of listFiles(path.dirname(plcproj), (n) => /\.(tcpou|tcgvl)$/i.test(n))) {
    try {
      const t = readType(file);
      if (t) types.set(t.name.toLowerCase(), t);
    } catch {
      // unreadable file
    }
  }
  const self = types.get(pouName.toLowerCase());
  if (self && self.kind === 'PROGRAM') return [self.name];

  const membersOf = (t, depth = 0) => {
    if (depth > 8) return [];
    const base = t.extends ? types.get(t.extends.toLowerCase()) : null;
    return [...t.members, ...(base ? membersOf(base, depth + 1) : [])];
  };
  // Who holds an instance of a type: (container, member)
  const holders = new Map();
  for (const t of types.values()) {
    for (const m of membersOf(t)) {
      const key = m.type.toLowerCase();
      if (!holders.has(key)) holders.set(key, []);
      holders.get(key).push({ container: t, member: m.name });
    }
  }
  const paths = [];
  const up = (typeName, suffix, depth, seen) => {
    if (paths.length >= MAX_PATHS || depth > 10) return;
    for (const { container, member } of holders.get(typeName.toLowerCase()) ?? []) {
      const p = member + suffix;
      if (container.kind === 'PROGRAM' || container.kind === 'GVL') paths.push(`${container.name}.${p}`);
      else if (!seen.has(container.name.toLowerCase())) {
        seen.add(container.name.toLowerCase());
        up(container.name, `.${p}`, depth + 1, seen);
        seen.delete(container.name.toLowerCase());
      }
    }
  };
  up(pouName, '', 0, new Set([pouName.toLowerCase()]));
  return [...new Map(paths.map((p) => [p.toLowerCase(), p])).values()];
}

module.exports = { plcPort, instancePaths, DEFAULT_PLC_PORT };
