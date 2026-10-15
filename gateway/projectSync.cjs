// The PLCs' projects kept beside the gateway (PlcProjects/<plc id>/), the PLC's own copy the golden one: what the PLC
// keeps in its boot folder, its TwinCAT configuration (CurrentConfig.tszip: the .tsproj, _Config) and its PLC project's
// sources (CurrentConfig/<plc project>.tpzip), unpacked in current/ as a TwinCAT project (the .tsproj at its root, the
// PLC project in <its name>/). Checked at start and every few minutes: the PLC's _AppInfo (AppTimestamp: its build's
// time, OnlineChangeCnt: online changes since the last download) read first, a few bytes; changed (or never seen) the
// archives are read and compared (SHA-256): another version replaces current/ (the one before kept in history/, the
// last N); the same one leaves it, local edits to current/ undone from the archives kept here (the PLC's is the golden
// copy). Sources older than the program the PLC runs (downloaded without its sources): said (stale). sync.json keeps
// each PLC's state; the setup page shows it, and Check now.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const APP_INFO = 'TwinCAT_SystemInfoVarList._AppInfo';

function createProjectSync({ baseDir, getConfig, plcList, clientFor, ads, sources, log, audit }) {
  const settings = () => {
    const c = getConfig();
    const s = c.projectSync ?? {};
    return {
      enabled: s.enabled !== false && c.allowSources !== false && c.allowBrowse !== false,
      everyMinutes: Math.max(1, Math.min(24 * 60, Number(s.everyMinutes) || 10)),
      keep: Math.max(1, Math.min(200, Number(s.keep) || 20)),
      folder: path.resolve(baseDir, String(s.folder || 'PlcProjects')),
    };
  };
  const dirOf = (plc) => path.join(settings().folder, String(plc.id).replace(/[^\w.-]/g, '_'));
  const stateFile = (plc) => path.join(dirOf(plc), 'sync.json');
  const readState = (plc) => {
    try {
      return JSON.parse(fs.readFileSync(stateFile(plc), 'utf8'));
    } catch {
      return null;
    }
  };
  const writeState = (plc, s) => {
    fs.mkdirSync(dirOf(plc), { recursive: true });
    fs.writeFileSync(stateFile(plc), JSON.stringify(s, null, 2) + '\n');
  };
  // (a check of one PLC at a time; each PLC's last result)
  const running = new Map();
  const last = new Map();

  /** _AppInfo's build time and online changes (null: not read: the PLC not running, an older runtime) */
  async function fingerprint(client) {
    const read = async (name) => {
      const info = await ads.probe(client, `${APP_INFO}.${name}`);
      if (!info) return null;
      const h = await ads.createHandle(client, `${APP_INFO}.${name}`);
      try {
        return Number(await ads.readByHandle(client, h, info.size));
      } finally {
        await ads.releaseHandle(client, h).catch(() => {});
      }
    };
    try {
      const appTimestamp = await read('AppTimestamp').catch(() => null);
      const onlineChanges = await read('OnlineChangeCnt').catch(() => null);
      return appTimestamp === null && onlineChanges === null ? null : { appTimestamp, onlineChanges };
    } catch {
      return null;
    }
  }

  /** Every file under a folder (relative paths, '/'), for the manifest */
  function walk(dir, rel = '') {
    let out = [];
    for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) out = out.concat(walk(path.join(dir, e.name), r));
      else out.push(r);
    }
    return out;
  }
  /** current/ as the archives make it: each file's hash; any file changed, missing or added: false */
  function intact(plc, manifest) {
    const cur = path.join(dirOf(plc), 'current');
    if (!manifest || !fs.existsSync(cur)) return false;
    const files = walk(cur);
    if (files.length !== Object.keys(manifest).length) return false;
    return files.every((f) => manifest[f] && sha256(fs.readFileSync(path.join(cur, f))) === manifest[f]);
  }
  /** The archives unpacked into current/ (what was there removed): the .tsproj at its root, the PLC project in <name>/ */
  function unpack(plc, tszip, tpzip, plcProject) {
    const cur = path.join(dirOf(plc), 'current');
    fs.rmSync(cur, { recursive: true, force: true });
    fs.mkdirSync(cur, { recursive: true });
    const manifest = {};
    const put = (rel, data) => {
      const clean = rel.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..').join('/');
      if (!clean) return;
      const file = path.join(cur, ...clean.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
      manifest[clean] = sha256(data);
    };
    if (tszip) for (const f of sources.unzip(tszip, () => true)) if (!f.path.endsWith('/')) put(f.path, f.data);
    if (tpzip) for (const f of sources.unzip(tpzip, () => true)) if (!f.path.endsWith('/')) put(`${plcProject}/${f.path}`, f.data);
    return manifest;
  }
  /** The archives of the version before, to history/<when>/ (the oldest past `keep` removed) */
  function keepHistory(plc, s) {
    const dir = dirOf(plc);
    const archives = ['system.tszip', 'project.tpzip'].filter((f) => fs.existsSync(path.join(dir, f)));
    if (!archives.length) return;
    const when = (s?.downloadedAt ?? new Date().toISOString()).replace(/[:.]/g, '-');
    const h = path.join(dir, 'history', when);
    fs.mkdirSync(h, { recursive: true });
    for (const f of archives) fs.copyFileSync(path.join(dir, f), path.join(h, f));
    if (s) fs.writeFileSync(path.join(h, 'sync.json'), JSON.stringify({ ...s, manifest: undefined }, null, 2) + '\n');
    const all = fs.readdirSync(path.join(dir, 'history')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - settings().keep))) fs.rmSync(path.join(dir, 'history', old), { recursive: true, force: true });
  }

  /** One PLC checked: → its state ({ state: 'in-sync' | 'updated' | 'restored' | 'no-sources' | 'error', … }) */
  async function check(plc, { force = false, by = 'gateway' } = {}) {
    if (running.has(plc.id)) return running.get(plc.id);
    const job = (async () => {
      const prev = readState(plc);
      const now = new Date().toISOString();
      let conn = null;
      const result = (s) => {
        const next = { ...prev, ...s, plc: plc.id, name: plc.name, lastCheck: now, folder: path.join(dirOf(plc), 'current') };
        try {
          writeState(plc, next);
        } catch (err) {
          next.message = `${next.message ?? ''} (sync.json not written: ${err.message})`.trim();
        }
        last.set(plc.id, next);
        return next;
      };
      try {
        conn = await clientFor(plc);
        const client = conn.client;
        const fp = await fingerprint(client);
        const same = !!fp && !!prev?.fingerprint && fp.appTimestamp === prev.fingerprint.appTimestamp && fp.onlineChanges === prev.fingerprint.onlineChanges;
        // (the PLC's build unchanged, the copy as it was: nothing read)
        if (!force && same && prev?.sha256 && intact(plc, prev.manifest)) return result({ state: 'in-sync', message: 'The same as the PLC' });
        const info = await sources.projectInfoOf((p) => sources.readBootFile(client, p));
        const port = Number(plc.port) || 851;
        const projects = sources.plcProjectsOf(info);
        const sub = projects.find((s) => s.port === port) ?? (projects.length === 1 ? projects[0] : null);
        if (!sub) return result({ state: 'error', message: `The PLC's project information names no PLC project for ADS port ${port}` });
        let tpzip = null;
        try {
          tpzip = await sources.readBootFile(client, `CurrentConfig/${sub.name}.tpzip`);
        } catch {
          tpzip = null;
        }
        let tszip = null;
        try {
          tszip = await sources.readBootFile(client, 'CurrentConfig.tszip');
        } catch {
          tszip = null;
        }
        if (!tpzip) return result({ state: 'no-sources', fingerprint: fp, message: `The PLC keeps no sources of ${sub.name}: download the project with its sources (PLC project > Settings > Source download)` });
        const hash = sha256(Buffer.concat([tszip ?? Buffer.alloc(0), tpzip]));
        // (its sources older than the program it runs: downloaded without them)
        const unpacked = sources.unzip(tpzip, (p) => /\.(TcPOU|TcDUT|TcGVL)$/i.test(p) || /^[^/]+\.tmc$/i.test(p));
        const tmc = unpacked.find((f) => /\.tmc$/i.test(f.path));
        const stale = tmc ? await sources.staleCheck(client, tmc.data.toString('utf8'), unpacked.filter((f) => !/\.tmc$/i.test(f.path)).map((f) => ({ path: f.path, content: f.data.toString('utf8') }))).catch(() => null) : null;
        const staleText = typeof stale === 'string' && stale ? stale : null;
        if (prev?.sha256 === hash) {
          if (intact(plc, prev.manifest)) return result({ state: 'in-sync', fingerprint: fp, stale: staleText, message: staleText ?? 'The same as the PLC' });
          // (the golden copy: local edits undone from the archives just read)
          const manifest = unpack(plc, tszip, tpzip, sub.name);
          log(`projects: ${plc.id}: the local copy differed from the PLC's: restored (${Object.keys(manifest).length} files)`);
          audit?.add(by, 'project.restore', { plc: plc.id });
          return result({ state: 'restored', fingerprint: fp, manifest, stale: staleText, message: staleText ?? 'Local changes undone: the PLC\'s copy restored' });
        }
        // (another version: the one before to history/, this one kept and unpacked)
        const dir = dirOf(plc);
        fs.mkdirSync(dir, { recursive: true });
        keepHistory(plc, prev);
        fs.writeFileSync(path.join(dir, 'project.tpzip'), tpzip);
        if (tszip) fs.writeFileSync(path.join(dir, 'system.tszip'), tszip);
        else fs.rmSync(path.join(dir, 'system.tszip'), { force: true });
        const manifest = unpack(plc, tszip, tpzip, sub.name);
        log(`projects: ${plc.id}: ${prev?.sha256 ? 'a new version' : 'its project'} downloaded from the PLC: ${info?.project?.name ?? sub.name}, ${Object.keys(manifest).length} files${staleText ? ` (${staleText})` : ''}`);
        audit?.add(by, 'project.download', { plc: plc.id, project: info?.project?.name ?? sub.name, files: Object.keys(manifest).length });
        return result({ state: 'updated', fingerprint: fp, sha256: hash, manifest, downloadedAt: now, project: info?.project?.name ?? sub.name, plcProject: sub.name, files: Object.keys(manifest).length, stale: staleText, message: staleText ?? (prev?.sha256 ? 'A new version from the PLC' : 'Downloaded from the PLC') });
      } catch (err) {
        return result({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (conn?.own) await conn.client.disconnect().catch(() => {});
        running.delete(plc.id);
      }
    })();
    running.set(plc.id, job);
    return job;
  }

  /** Every PLC, one after the other */
  async function checkAll(by) {
    if (!settings().enabled) return;
    for (const plc of plcList()) await check(plc, { by }).catch(() => {});
  }

  let timer = null;
  let started = null;
  const schedule = () => {
    clearInterval(timer);
    timer = setInterval(() => void checkAll('gateway'), settings().everyMinutes * 60000);
    timer.unref?.();
  };
  return {
    start() {
      started = setTimeout(() => void checkAll('gateway'), Number(process.env.KSS_PROJECT_SYNC_DELAY_MS) || 20000);
      started.unref?.();
      schedule();
    },
    stop() {
      clearTimeout(started);
      clearInterval(timer);
    },
    check: (plc, by) => check(plc, { force: true, by }),
    /** Each PLC's state, as sync.json keeps it (without its manifest) */
    list() {
      const s = settings();
      return {
        enabled: s.enabled,
        everyMinutes: s.everyMinutes,
        keep: s.keep,
        folder: s.folder,
        plcs: plcList().map((plc) => {
          const st = last.get(plc.id) ?? readState(plc);
          const history = (() => {
            try {
              return fs.readdirSync(path.join(dirOf(plc), 'history')).length;
            } catch {
              return 0;
            }
          })();
          return { id: plc.id, name: plc.name, folder: path.join(dirOf(plc), 'current'), checking: running.has(plc.id), history, ...(st ? { state: st.state, message: st.message, lastCheck: st.lastCheck, downloadedAt: st.downloadedAt, project: st.project, files: st.files, stale: st.stale ?? null } : { state: 'never' }) };
        }),
      };
    },
  };
}

module.exports = { createProjectSync };
