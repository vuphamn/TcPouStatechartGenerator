// What an online change would change on the PLC, as XAE's Online Change dialog (its Details) says before it writes:
// the project the PLC runs (its sources, read from its boot folder: shared/tcSources.cjs readPlcSources) compared with
// the local one. Pure (no vscode, no ADS): tested on its own.
//   libraries: a library added, removed or at another version (online change may not be possible, or reinitializes it)
//   tasks: a task's cycle, priority or programs changed, a task added or removed (the task configuration: a download)
//   retain: a RETAIN / PERSISTENT variable added, removed or of another type (its value is lost or reinitialized)
//   interfaces: a POU, DUT or GVL whose declaration changed (its instances move: pointers and references to them become
//   invalid until reassigned)
//   added / removed: the POUs, DUTs and GVLs added or removed
'use strict';

const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/%20/g, ' ');
const baseName = (p) => String(p).split(/[\\/]/).pop();
const lower = (s) => String(s).toLowerCase();

// ST without its comments: (* ... *), // ... and /* ... */ (strings kept)
function stripComments(st) {
  return String(st)
    .replace(/\(\*[\s\S]*?\*\)/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}
/** A declaration as compared: no comments, no pragmas, whitespace and case not counted */
const normal = (st) => lower(stripComments(st).replace(/\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim());

/** The object's own declaration: the first <Declaration> (a POU's, not its methods'), with its name */
function declarationOf(xml) {
  const name = /<(?:POU|DUT|GVL|Itf)\b[^>]*\bName="([^"]+)"/i.exec(xml)?.[1];
  const decl = /<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Declaration>/i.exec(xml)?.[1] ?? '';
  return { name: name ? unescape(name) : null, decl };
}

/** The RETAIN / PERSISTENT variables of a declaration → Map(name lower → { name, type, kind }) */
function retainVars(decl) {
  const out = new Map();
  const st = stripComments(decl);
  for (const m of st.matchAll(/\bVAR(?:_GLOBAL|_INPUT|_OUTPUT|_IN_OUT|_STAT)?\b([^\n;]*?)\n([\s\S]*?)\bEND_VAR\b/gi)) {
    const q = m[1];
    const kind = /\bPERSISTENT\b/i.test(q) ? 'PERSISTENT' : /\bRETAIN\b/i.test(q) ? 'RETAIN' : null;
    if (!kind) continue;
    for (const d of m[2].split(';')) {
      const v = /^\s*([A-Za-z_][\w,\s]*?)\s*(?:AT\s+%[\w.*]+\s*)?:\s*([^:=]+?)\s*(?::=[\s\S]*)?$/i.exec(d.replace(/\{[^}]*\}/g, ' '));
      if (!v) continue;
      const type = v[2].replace(/\s+/g, ' ').trim();
      for (const n of v[1].split(',').map((x) => x.trim()).filter(Boolean)) out.set(lower(n), { name: n, type, kind });
    }
  }
  return out;
}

/** A .plcproj's libraries → Map(name lower → { name, version }) (a placeholder at its resolution, else its default) */
function librariesOf(xml) {
  const out = new Map();
  const parse = (s) => {
    const m = /^\s*([^,]+?)\s*,\s*([^\s(]+)/.exec(unescape(s ?? ''));
    return m ? { name: m[1], version: m[2] } : null;
  };
  const resolutions = new Map();
  for (const m of xml.matchAll(/<PlaceholderResolution\s+Include="([^"]+)"[^>]*>[\s\S]*?<Resolution>([^<]*)<\/Resolution>/gi)) resolutions.set(lower(unescape(m[1])), parse(m[2]));
  for (const m of xml.matchAll(/<PlaceholderReference\s+Include="([^"]+)"[^>]*>([\s\S]*?)<\/PlaceholderReference>/gi)) {
    const r = resolutions.get(lower(unescape(m[1]))) ?? parse(/<DefaultResolution>([^<]*)<\/DefaultResolution>/i.exec(m[2])?.[1]);
    if (r) out.set(lower(r.name), r);
  }
  for (const m of xml.matchAll(/<LibraryReference\s+Include="([^"]+)"/gi)) {
    const r = parse(m[1]);
    if (r && !out.has(lower(r.name))) out.set(lower(r.name), r);
  }
  return out;
}

/** A .TcTTO's task → { name, cycle, priority, calls } */
function taskOf(xml, file) {
  return {
    name: unescape(/<Task\b[^>]*\bName="([^"]+)"/i.exec(xml)?.[1] ?? baseName(file).replace(/\.\w+$/, '')),
    cycle: /<CycleTime>([^<]*)<\/CycleTime>/i.exec(xml)?.[1]?.trim() ?? '',
    priority: /<Priority>([^<]*)<\/Priority>/i.exec(xml)?.[1]?.trim() ?? '',
    calls: [...xml.matchAll(/<PouCall>\s*<Name>([^<]*)<\/Name>/gi)].map((c) => unescape(c[1]).trim()),
  };
}

const isSource = (p) => /\.(TcPOU|TcDUT|TcGVL|TcIO)$/i.test(p);

/**
 * plc / local: [{ path, content }] (the sources, the .plcproj, the .TcTTO files) →
 * { libraries: [{ name, from, to }], tasks: [{ name, change }], retain: [{ object, name, change }],
 *   interfaces: [names], added: [names], removed: [names], files: { name lower → local path (relative) } }
 */
function onlineChangeRisks(plc, local) {
  const objects = (files) => {
    const m = new Map();
    for (const f of files.filter((x) => isSource(x.path))) {
      const d = declarationOf(f.content);
      const name = d.name ?? baseName(f.path).replace(/\.\w+$/, '');
      m.set(lower(name), { name, decl: d.decl, path: f.path });
    }
    return m;
  };
  const before = objects(plc);
  const after = objects(local);
  const interfaces = [];
  const retain = [];
  const added = [];
  const removed = [];
  for (const [k, a] of after) {
    const b = before.get(k);
    if (!b) {
      added.push(a.name);
      continue;
    }
    if (normal(a.decl) !== normal(b.decl)) interfaces.push(a.name);
    const rb = retainVars(b.decl);
    const ra = retainVars(a.decl);
    for (const [n, v] of ra) {
      const was = rb.get(n);
      if (!was) retain.push({ object: a.name, name: v.name, change: `${v.kind} added` });
      else if (lower(was.type) !== lower(v.type)) retain.push({ object: a.name, name: v.name, change: `${was.type} → ${v.type}` });
      else if (was.kind !== v.kind) retain.push({ object: a.name, name: v.name, change: `${was.kind} → ${v.kind}` });
    }
    for (const [n, v] of rb) if (!ra.has(n)) retain.push({ object: a.name, name: v.name, change: `no longer ${v.kind}` });
  }
  for (const [k, b] of before) if (!after.has(k)) removed.push(b.name);

  const proj = (files) => files.find((f) => /\.plcproj$/i.test(f.path));
  const libraries = [];
  const pp = proj(plc);
  const lp = proj(local);
  if (pp && lp) {
    const lb = librariesOf(pp.content);
    const la = librariesOf(lp.content);
    for (const [k, a] of la) {
      const b = lb.get(k);
      if (!b) libraries.push({ name: a.name, from: null, to: a.version });
      else if (b.version !== a.version) libraries.push({ name: a.name, from: b.version, to: a.version });
    }
    for (const [k, b] of lb) if (!la.has(k)) libraries.push({ name: b.name, from: b.version, to: null });
  }

  const tasksOf = (files) => new Map(files.filter((f) => /\.TcTTO$/i.test(f.path)).map((f) => taskOf(f.content, f.path)).map((t) => [lower(t.name), t]));
  const tasks = [];
  const tb = tasksOf(plc);
  const ta = tasksOf(local);
  // (only when the PLC's archive has its task objects: an older archive without them says nothing)
  if (tb.size) {
    for (const [k, a] of ta) {
      const b = tb.get(k);
      if (!b) {
        tasks.push({ name: a.name, change: 'added' });
        continue;
      }
      const what = [];
      if (a.cycle !== b.cycle) what.push(`cycle ${b.cycle} → ${a.cycle} µs`);
      if (a.priority !== b.priority) what.push(`priority ${b.priority} → ${a.priority}`);
      if (a.calls.join() !== b.calls.join()) what.push(`calls ${b.calls.join(', ') || 'nothing'} → ${a.calls.join(', ') || 'nothing'}`);
      if (what.length) tasks.push({ name: a.name, change: what.join(', ') });
    }
    for (const [k, b] of tb) if (!ta.has(k)) tasks.push({ name: b.name, change: 'removed' });
  }
  const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  // (where each object and task is here: the details open it)
  const files = {};
  for (const [k, a] of after) files[k] = a.path;
  for (const f of local.filter((x) => /\.TcTTO$/i.test(x.path))) files[lower(taskOf(f.content, f.path).name)] = f.path;
  return { libraries, tasks, retain, interfaces: interfaces.sort(byName), added: added.sort(byName), removed: removed.sort(byName), files };
}

/** The risks as lines for a confirmation's detail ([] when there is nothing to say) */
function riskLines(r, max = 6) {
  const list = (xs) => (xs.length > max ? `${xs.slice(0, max).join(', ')} and ${xs.length - max} more` : xs.join(', '));
  const lines = [];
  if (r.tasks.length) lines.push(`⚠ Tasks changed (needs a download, not an online change): ${list(r.tasks.map((t) => `${t.name} (${t.change})`))}`);
  if (r.libraries.length) lines.push(`⚠ Libraries changed (an online change may not be possible, or reinitializes them): ${list(r.libraries.map((l) => `${l.name} ${l.from ?? '(new)'} → ${l.to ?? '(removed)'}`))}`);
  if (r.retain.length) lines.push(`⚠ RETAIN / PERSISTENT variables changed (their values are lost or reinitialized): ${list(r.retain.map((v) => `${v.object}.${v.name} (${v.change})`))}`);
  if (r.interfaces.length) lines.push(`Declarations changed (their instances move: pointers and references to them are invalid until assigned again): ${list(r.interfaces)}`);
  if (r.added.length) lines.push(`Added: ${list(r.added)}`);
  if (r.removed.length) lines.push(`Removed: ${list(r.removed)}`);
  return lines;
}

/** The local PLC project's files to compare: its .plcproj, sources and task objects (its folder, a few levels down) */
function localProjectFiles(plcproj) {
  const fs = require('fs');
  const path = require('path');
  const out = [];
  const read = (file) => {
    try {
      out.push({ path: path.relative(path.dirname(plcproj), file).replace(/\\/g, '/'), content: fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') });
    } catch {
      // (gone meanwhile)
    }
  };
  read(plcproj);
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!['.git', '.vs', '_Boot', '_CompileInfo', '_Libraries', 'node_modules'].includes(e.name)) walk(p, depth + 1);
      } else if (/\.(TcPOU|TcDUT|TcGVL|TcIO|TcTTO)$/i.test(e.name)) read(p);
    }
  };
  walk(path.dirname(plcproj), 0);
  return out;
}

module.exports = { onlineChangeRisks, riskLines, retainVars, librariesOf, declarationOf, localProjectFiles };
