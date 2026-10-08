// The TwinCAT version the loaded POU's project files are saved in, against git's (HEAD): XAE of another TwinCAT build
// converts them when it saves (a 4024.59 project saved by 4026.27's XAE says 4026.27), which colleagues on the other
// build may not open. The .tsproj (TcVersion), the .plcproj (ProgramVersion), the .TcPOU (ProductVersion). Used by the
// desktop app and the VS Code extension's host (the XAE extension has its own, in C#).

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const VERSION = {
  tsproj: /<TcSmProject\b[^>]*\bTcVersion="([^"]+)"/,
  plcproj: /<ProgramVersion>([^<]+)</,
  pou: /<TcPlcObject\b[^>]*\bProductVersion="([^"]+)"/,
};

/** The nearest file above `from` with that extension, or null */
function nearest(from, ext, levels = 8) {
  let dir = path.dirname(path.resolve(from));
  for (let k = 0; k < levels; k++) {
    try {
      const hit = fs.readdirSync(dir).find((n) => n.toLowerCase().endsWith(ext));
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

/** git in the file's folder: { code, out } */
function git(file, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', path.dirname(file), ...args], { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 15000 }, (err, out) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(out ?? '') }));
  });
}

/** The lines changed in a file since HEAD: { added, removed }, or null (not known, binary) */
async function changedLines(file) {
  const r = await git(file, ['diff', '--numstat', 'HEAD', '--', path.basename(file)]);
  if (r.code !== 0) return null;
  const m = /^(\d+)\t(\d+)\t/.exec(r.out);
  return m ? { added: Number(m[1]), removed: Number(m[2]) } : { added: 0, removed: 0 };
}

/** The committed (git HEAD) text of a file, or null (not in git, not committed) */
function gitHead(file) {
  return new Promise((resolve) => {
    execFile('git', ['-C', path.dirname(file), 'show', `HEAD:./${path.basename(file)}`], { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 15000 }, (err, out) => resolve(err ? null : String(out)));
  });
}

/**
 * The project files' TwinCAT versions here and in git: { files: [{ kind, path, working, head }], converted } (converted:
 * one of them is saved in another version than committed)
 */
async function projectVersions(pouPath) {
  if (typeof pouPath !== 'string' || !path.isAbsolute(pouPath) || !fs.existsSync(pouPath)) return { files: [], converted: false };
  const targets = [
    { kind: 'tsproj', file: nearest(pouPath, '.tsproj') },
    { kind: 'plcproj', file: nearest(pouPath, '.plcproj') },
    { kind: 'pou', file: pouPath },
  ].filter((t) => t.file);
  const files = [];
  for (const t of targets) {
    let working = null;
    try {
      working = VERSION[t.kind].exec(fs.readFileSync(t.file, 'utf8'))?.[1] ?? null;
    } catch {
      // (unreadable)
    }
    const committed = await gitHead(t.file);
    const head = committed === null ? null : VERSION[t.kind].exec(committed)?.[1] ?? null;
    const changed = working && head && working !== head ? await changedLines(t.file) : null;
    files.push({ kind: t.kind, path: t.file, working, head, changed });
  }
  return { files, converted: files.some((f) => f.working && f.head && f.working !== f.head) };
}

/**
 * The project's .tsproj / .plcproj (only those of this POU's project) back to git's HEAD (git checkout HEAD -- file):
 * { reverted: [path], errors: [{ path, error }] }. The POU itself is not written here (the app edits its version)
 */
async function revertProjectFiles(pouPath, paths) {
  const reverted = [];
  const errors = [];
  if (typeof pouPath !== 'string' || !path.isAbsolute(pouPath) || !Array.isArray(paths)) return { reverted, errors: [{ path: '', error: 'No POU' }] };
  const allowed = [nearest(pouPath, '.tsproj'), nearest(pouPath, '.plcproj')].filter(Boolean).map((f) => path.resolve(f).toLowerCase());
  for (const p of paths) {
    if (typeof p !== 'string' || !allowed.includes(path.resolve(p).toLowerCase())) {
      errors.push({ path: String(p), error: 'Not this POU\'s project file' });
      continue;
    }
    const r = await git(p, ['checkout', 'HEAD', '--', path.basename(p)]);
    if (r.code === 0) reverted.push(p);
    else errors.push({ path: p, error: 'git checkout failed' });
  }
  return { reverted, errors };
}

module.exports = { projectVersions, revertProjectFiles };
