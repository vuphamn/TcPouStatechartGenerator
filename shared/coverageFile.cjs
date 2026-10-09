// The transitions each state machine's PLC took, kept beside the PLC project (MachineScope.coverage.json) so the
// coverage counts what anyone saw live (commit it with the project): per POU type, each transition's count and when it
// was last taken. Merged by the highest count and the latest time (two people's sessions of the same file never add
// up twice). Read and written by the desktop app and the VS Code extension's host (the XAE extension has its own).

const fs = require('fs');
const path = require('path');

const FILE = 'MachineScope.coverage.json';

/** The folder of the POU's PLC project (its .plcproj), or null */
function plcProjectDir(pouPath, levels = 8) {
  if (typeof pouPath !== 'string' || !path.isAbsolute(pouPath)) return null;
  let dir = path.dirname(path.resolve(pouPath));
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

const clean = (counts) => {
  const out = {};
  for (const [k, v] of Object.entries(counts && typeof counts === 'object' ? counts : {})) {
    if (!/^[^>]+->[^>]+$/.test(k) || !v || !Number.isFinite(Number(v.n)) || Number(v.n) <= 0) continue;
    out[k] = { n: Math.floor(Number(v.n)), last: Number.isFinite(Number(v.last)) ? Number(v.last) : 0 };
  }
  return out;
};

/** Every POU type's counts in the project's file: { pous: { [type]: { 'FROM->TO': { n, last } } } } ({} when none) */
function readCoverageFile(pouPath) {
  const dir = plcProjectDir(pouPath);
  if (!dir) return { pous: {} };
  try {
    const f = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'));
    const pous = {};
    for (const [type, counts] of Object.entries(f?.pous ?? {})) if (/^\w+$/.test(type)) pous[type] = clean(counts);
    return { pous };
  } catch {
    return { pous: {} };
  }
}

/** Two counts merged: the highest count, the latest time, per transition */
function mergeCounts(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const w = out[k];
    out[k] = w ? { n: Math.max(w.n, v.n), last: Math.max(w.last, v.last) } : v;
  }
  return out;
}

/** The file's text: stable (types and transitions sorted, one per line), so a change is a small diff */
function fileText(pous) {
  const types = Object.keys(pous).sort();
  const body = types
    .map((t) => {
      const keys = Object.keys(pous[t]).sort();
      return `    ${JSON.stringify(t)}: {\n${keys.map((k) => `      ${JSON.stringify(k)}: { "n": ${pous[t][k].n}, "last": ${pous[t][k].last} }`).join(',\n')}\n    }`;
    })
    .join(',\n');
  return `{\n  "note": "The transitions each state machine's PLC took, seen live with Kval MachineScope (count, last time in ms): the coverage counts what anyone saw. Commit it with the project.",\n  "pous": {\n${body}\n  }\n}\n`;
}

/**
 * This POU type's counts merged into the project's file (written only when that adds something). → { counts } (the
 * type's counts in the file now), or { error } (no PLC project, a read-only folder)
 */
function mergeCoverageFile(pouPath, pouType, counts) {
  const dir = plcProjectDir(pouPath);
  if (!dir) return { error: 'No PLC project (.plcproj) above the POU' };
  if (!/^\w+$/.test(String(pouType ?? ''))) return { error: 'No POU type' };
  const { pous } = readCoverageFile(pouPath);
  const before = pous[pouType] ?? {};
  const after = mergeCounts(before, clean(counts));
  // (compared as written: sorted, so the order things were read in does not count as a change)
  if (fileText({ [pouType]: after }) !== fileText({ [pouType]: before })) {
    try {
      fs.writeFileSync(path.join(dir, FILE), fileText({ ...pous, [pouType]: after }));
    } catch (err) {
      return { counts: after, error: `Not written: ${err.message}` };
    }
  }
  return { counts: after };
}

module.exports = { readCoverageFile, mergeCoverageFile, mergeCounts, COVERAGE_FILE: FILE };
