// A PLC's project kept on this computer (desktop app, Link): the TwinCAT project as the PLC keeps it in its boot folder
// (CurrentConfig.tszip, each PLC / safety project's .tpzip / .tfzip) unpacked into Documents\Kval StateScope\PLC
// projects\<project>, as a build's work folder is (it opens in XAE too). A manifest (.kss-plc-project.json) says what
// was downloaded (the archives' fingerprint, each file's), so going live again knows whether the PLC's project is the
// same and whether the local copy was edited:
//   none there            downloaded
//   the same as the PLC's  used as it is
//   the PLC's differs      the app asks: Override (the PLC's written over it), Save to a different location (another
//                          folder, remembered for the project), or Keep local (used as it is)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { fetchProjectArchives, writeWorkspace, archivesHash } = require('./tcBuild.cjs');

const MANIFEST = '.kss-plc-project.json';
const SAFE = (s) => String(s || 'PLC project').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || 'PLC project';
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');

/** Documents\Kval StateScope\PLC projects (documents: the host's Documents folder) */
const baseDirOf = (documents) => path.join(documents || path.join(os.homedir(), 'Documents'), 'Kval StateScope', 'PLC projects');

/** Every file under a folder (relative, / separated), the manifest left out */
function filesIn(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesIn(dir, r));
    else if (r !== MANIFEST) out.push(r);
  }
  return out;
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
  } catch {
    return null;
  }
}

/** The files edited (or added, removed) since the download: from the manifest's fingerprints */
function localChanges(dir, manifest) {
  if (!manifest?.files) return null;
  const now = new Set(filesIn(dir));
  const out = [];
  for (const [rel, h] of Object.entries(manifest.files)) {
    if (!now.has(rel)) out.push(`${rel} (removed)`);
    else if (sha1(fs.readFileSync(path.join(dir, rel))) !== h) out.push(rel);
    now.delete(rel);
  }
  for (const rel of now) out.push(`${rel} (added)`);
  return out;
}

/** The archives unpacked into dir (the files there written over), the manifest written */
function writeCopy(archives, dir, meta) {
  fs.mkdirSync(dir, { recursive: true });
  const ws = writeWorkspace(archives, [], dir);
  const files = {};
  for (const rel of filesIn(dir)) files[rel] = sha1(fs.readFileSync(path.join(dir, rel)));
  const manifest = { project: meta.project, netId: meta.netId ?? null, hash: meta.hash, downloaded: new Date().toISOString(), files };
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 1));
  return { ws, manifest };
}

/**
 * The project's source files that differ between the PLC's version (its archives, unpacked into a folder of its own
 * for the comparison) and the local copy: [{ path, plc, local }] ('' where a side has no such file), the first 60 and
 * 4 MB of them; more: how many were left out. Shown before Override / Keep local
 */
const COMPARED = /\.(TcPOU|TcDUT|TcGVL|TcIO|TcTTO|TcTLO|plcproj|tsproj|xti)$/i;
function compareWithPlc(archives, dir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-plc-compare-'));
  try {
    writeWorkspace(archives, [], tmp);
    const read = (root, rel) => {
      try {
        const t = fs.readFileSync(path.join(root, rel), 'utf8');
        return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
      } catch {
        return '';
      }
    };
    const rels = [...new Set([...filesIn(tmp), ...filesIn(dir)])].filter((r) => COMPARED.test(r)).sort();
    const compare = [];
    let size = 0;
    let more = 0;
    for (const rel of rels) {
      const plc = read(tmp, rel);
      const local = read(dir, rel);
      if (plc.replace(/\r\n/g, '\n') === local.replace(/\r\n/g, '\n')) continue;
      if (compare.length >= 60 || size + plc.length + local.length > 4_000_000) {
        more++;
        continue;
      }
      size += plc.length + local.length;
      compare.push({ path: rel, plc, local });
    }
    return { compare, compareMore: more };
  } catch (err) {
    return { compare: [], compareMore: 0, compareError: err.message };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const describe = (dir, ws) => ({ dir, tsproj: ws?.tsproj ?? null, plcProjects: (ws?.plcProjects ?? []).map((p) => ({ name: p.name, dir: p.dir, plcproj: p.plcproj })) });

/** A copy's .tsproj and PLC projects (already on disk) */
function projectOf(dir) {
  const tsproj = fs.readdirSync(dir).find((f) => /\.tsproj$/i.test(f));
  const plcProjects = [];
  for (const rel of filesIn(dir).filter((f) => /\.plcproj$/i.test(f))) {
    const plcproj = path.join(dir, rel);
    plcProjects.push({ name: path.basename(rel, path.extname(rel)), dir: path.dirname(plcproj), plcproj });
  }
  return { tsproj: tsproj ? path.join(dir, tsproj) : null, plcProjects };
}

/**
 * The PLC's project on this computer (read: relPath → Buffer, from its boot folder). opts: { documents, folder (its
 * own place, "Save to a different location"), choice: 'override' | 'keep' (the answer to "differs"), netId,
 * chosen (folder: picked by the user, its project in a folder of its own there when it holds other things),
 * skipProjects (the loaded POU's project names: the PLC runs one of them, nothing downloaded: 'same-project') }.
 * Returns { status: 'downloaded' | 'current' | 'differs' | 'overridden' | 'kept', project, dir, tsproj, plcProjects,
 * changes (the local copy's edits; null: not known, a folder not downloaded here), downloaded (when) } or { error }
 */
async function syncPlcProject(read, opts = {}) {
  const skip = (opts.skipProjects ?? []).filter(Boolean).map((x) => String(x).toLowerCase());
  if (skip.length) {
    // (its project information first: a few hundred bytes, not the archives)
    try {
      const info = await require('./tcSources.cjs').projectInfoOf(read);
      const names = [info?.project?.name, ...(info?.sub_projects ?? []).map((x) => x?.name)].filter(Boolean).map((x) => String(x).toLowerCase());
      if (names.some((n) => skip.includes(n))) return { status: 'same-project', project: info?.project?.name ?? '' };
    } catch {
      // (the archives' read says what is wrong)
    }
  }
  let archives;
  try {
    archives = await fetchProjectArchives(read);
  } catch (err) {
    return { error: err.message };
  }
  const project = archives.info?.project?.name ?? archives.nested.find((n) => n.kind === 'plc')?.name ?? 'PLC project';
  const hash = archivesHash(archives);
  let dir = path.resolve(opts.folder || path.join(baseDirOf(opts.documents), SAFE(project)));
  // (a folder chosen for it that holds other things: the project in a folder of its own there)
  if (opts.chosen && fs.existsSync(dir) && fs.readdirSync(dir).length && !readManifest(dir) && path.basename(dir).toLowerCase() !== SAFE(project).toLowerCase()) dir = path.join(dir, SAFE(project));
  const meta = { project, netId: opts.netId, hash };
  const fresh = !fs.existsSync(dir) || fs.readdirSync(dir).length === 0;
  try {
    if (fresh || opts.choice === 'override') {
      const { ws } = writeCopy(archives, dir, meta);
      return { status: fresh ? 'downloaded' : 'overridden', project, ...describe(dir, ws), changes: [] };
    }
    const manifest = readManifest(dir);
    const changes = localChanges(dir, manifest);
    const here = { project, dir, ...projectOf(dir), changes, downloaded: manifest?.downloaded ?? null };
    if (manifest?.hash === hash) return { status: 'current', ...here };
    if (opts.choice === 'keep') return { status: 'kept', ...here };
    return { status: 'differs', ...here, ...compareWithPlc(archives, dir) };
  } catch (err) {
    return { error: `${project}: could not write ${dir} (${err.message})` };
  }
}

/**
 * A POU of a copy's PLC project (plcproj: its .plcproj), as a POU opened from its folder: { name, path, content,
 * dutCandidates: the project's .TcDUT files } or { error }. Going live on an instance of it (Link: the page has no files)
 */
function readCopyPou(plcproj, typeName) {
  if (typeof plcproj !== 'string' || !/\.plcproj$/i.test(plcproj) || !fs.existsSync(plcproj)) return { error: 'Not a PLC project of the copy' };
  if (!/^[A-Za-z_]\w*$/.test(String(typeName || ''))) return { error: 'Not a POU name' };
  const root = path.dirname(path.resolve(plcproj));
  const strip = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);
  const wanted = `${typeName}.tcpou`.toLowerCase();
  let pou = null;
  const duts = [];
  for (const rel of filesIn(root)) {
    const lower = rel.toLowerCase();
    if (/(^|\/)(_boot|_compileinfo|_libraries|_deployment)\//.test(lower)) continue;
    if (!pou && path.posix.basename(lower) === wanted) pou = rel;
    else if (lower.endsWith('.tcdut') && duts.length < 500) duts.push(rel);
  }
  if (!pou) return { error: `${typeName}.TcPOU is not in ${path.basename(plcproj)}` };
  const full = path.join(root, pou);
  return {
    name: path.basename(full),
    path: full,
    content: strip(fs.readFileSync(full, 'utf8')),
    dutCandidates: duts.map((rel) => ({ name: path.posix.basename(rel), relativePath: rel, path: path.join(root, rel), content: strip(fs.readFileSync(path.join(root, rel), 'utf8')) })),
  };
}

module.exports = { syncPlcProject, baseDirOf, MANIFEST, localChanges, readManifest, readCopyPou };
