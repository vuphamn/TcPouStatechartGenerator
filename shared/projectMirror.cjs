// A web page's TwinCAT project folder, mirrored on the computer that builds it (Build from the project, through Link
// or the gateway): the page lists its files (path, size, time), the mirror answers which it needs (new or changed), the
// page sends those in pieces (a message stays under 256 KB; gzip-compressed when it saves), files the page no longer
// lists are removed. A folder per project and page, used again for the next build (only the changed files come again),
// removed when the page goes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LIMITS = { files: 20000, bytes: 1024 * 1024 * 1024, file: 256 * 1024 * 1024 };
const SAFE_NAME = /^[\w .()-]{1,100}$/;

/** A path the page sends, as a relative path in the mirror (no drive, no .., no backslash); null when not one */
function relPath(p) {
  const s = String(p ?? '');
  if (!s || s.length > 400 || /[\\:*?"<>|\x00-\x1f]/.test(s) || s.startsWith('/')) return null;
  const parts = s.split('/');
  if (parts.some((x) => !x || x === '.' || x === '..')) return null;
  return parts.join(path.sep);
}

class ProjectMirror {
  constructor() {
    /** uploadId -> { project, dir } */
    this.mirrors = new Map();
  }

  /**
   * The page's file list for its project: the mirror made (or the one it had), the files it lacks or that changed
   * (their size or time) asked for, the ones not listed removed. → { uploadId, need: [paths] } or { error }
   */
  sync(project, files) {
    if (!SAFE_NAME.test(String(project ?? ''))) return { error: 'Not a project name' };
    if (!Array.isArray(files) || files.length > LIMITS.files) return { error: `Up to ${LIMITS.files} files` };
    const list = [];
    let bytes = 0;
    for (const f of files) {
      const rel = relPath(f?.path);
      const size = Number(f?.size);
      const mtime = Number(f?.mtime);
      if (!rel || !Number.isFinite(size) || size < 0 || size > LIMITS.file || !Number.isFinite(mtime)) return { error: `Not a file of the project: ${String(f?.path).slice(0, 100)}` };
      bytes += size;
      list.push({ rel, size, mtime });
    }
    if (bytes > LIMITS.bytes) return { error: 'The project is larger than 1 GB' };
    if (!list.some((f) => !f.rel.includes(path.sep) && /\.tsproj$/i.test(f.rel))) return { error: 'No .tsproj in this folder: choose the TwinCAT project\'s folder (the one with the .tsproj)' };
    let [uploadId, m] = [...this.mirrors.entries()].find(([, x]) => x.project === project) ?? [];
    if (!m) {
      uploadId = crypto.randomBytes(8).toString('hex');
      m = { project, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'kss-link-project-')) };
      this.mirrors.set(uploadId, m);
    }
    const want = new Map(list.map((f) => [f.rel.toLowerCase(), f]));
    // (what the mirror has that the page no longer lists: removed)
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (!want.has(path.relative(m.dir, p).toLowerCase())) fs.rmSync(p, { force: true });
      }
    };
    walk(m.dir);
    const need = [];
    for (const f of list) {
      let st = null;
      try {
        st = fs.statSync(path.join(m.dir, f.rel));
      } catch {
        // not here yet
      }
      if (!st || st.size !== f.size || Math.abs(st.mtimeMs - f.mtime) > 2000) need.push(f.rel.split(path.sep).join('/'));
    }
    return { uploadId, need };
  }

  /**
   * A piece of a file (data: base64 at offset; encoding 'gzip': the pieces are the file compressed, unpacked when it is
   * complete); done: the file complete (its size, unpacked, checked, its time set). → { ok } or { error }
   */
  put(uploadId, { path: p, offset = 0, data = '', size, mtime, done, encoding }) {
    const m = this.mirrors.get(uploadId);
    const rel = relPath(p);
    if (!m || !rel) return { error: 'Not a file of the mirrored project' };
    const file = path.join(m.dir, rel);
    const part = `${file}.kss-part`;
    const buf = Buffer.from(String(data), 'base64');
    if (!Number.isInteger(offset) || offset < 0 || offset + buf.length > LIMITS.file) return { error: 'Not a piece of the file' };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (offset === 0) fs.writeFileSync(part, buf);
    else {
      if (!fs.existsSync(part) || fs.statSync(part).size !== offset) return { error: `${p}: a piece is missing` };
      fs.appendFileSync(part, buf);
    }
    if (done) {
      if (encoding === 'gzip') {
        let unpacked;
        try {
          unpacked = require('zlib').gunzipSync(fs.readFileSync(part), { maxOutputLength: LIMITS.file });
        } catch (err) {
          fs.rmSync(part, { force: true });
          return { error: `${p}: not a gzip file (${err.message})` };
        }
        fs.writeFileSync(part, unpacked);
      }
      if (Number.isFinite(size) && fs.statSync(part).size !== size) return { error: `${p}: not complete` };
      fs.renameSync(part, file);
      if (Number.isFinite(mtime)) fs.utimesSync(file, new Date(), new Date(mtime));
    }
    return { ok: true };
  }

  /** The mirror's folder, or null */
  root(uploadId) {
    return this.mirrors.get(uploadId)?.dir ?? null;
  }

  /** A path in the mirror as the page names it (relative), as a full path there; null when not in it */
  fullPath(uploadId, p) {
    const root = this.root(uploadId);
    const rel = relPath(p);
    return root && rel ? path.join(root, rel) : null;
  }

  /** The mirrors removed (the page went) */
  dispose() {
    for (const m of this.mirrors.values()) fs.rm(m.dir, { recursive: true, force: true }, () => {});
    this.mirrors.clear();
  }
}

module.exports = { ProjectMirror, relPath };
