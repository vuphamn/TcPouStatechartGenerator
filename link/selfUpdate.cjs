// Link updates itself: the newest release on GitHub with a Link (the web edition's, web-v<version>), when it is newer
// than this Link: downloaded, checked against the SHA-256 GitHub gives for it, put in place of this Link's file (the
// old one kept as .old until the next start; in Program Files, Windows asks for an administrator first), then started
// again. By itself only when no page is live through Link (going live again after a restart is the page's to do);
// Link's page can also check and update at once. Only a built Link (not run from its sources) replaces itself.
//   KSS_LINK_RELEASES: the release list's URL (the tests: a local stand-in); KSS_SERVICE_DRYRUN=1: downloaded and
//   checked, nothing replaced or started (the tests)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const RELEASES = () => process.env.KSS_LINK_RELEASES || 'https://api.github.com/repos/vuphamn/TcPouStatechartGenerator/releases?per_page=30';
const dry = () => process.env.KSS_SERVICE_DRYRUN === '1';
// (a PowerShell string: single quotes doubled)
const ps = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** 1.2.10 against 1.2.9: > 0 when a is newer */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** The newest released Link: { version, tag, url, size, sha256, page } or null (none) */
async function latestRelease() {
  const r = await fetch(RELEASES(), { headers: { 'User-Agent': 'KvalMachineScope-Link', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const list = await r.json();
  let best = null;
  for (const rel of Array.isArray(list) ? list : []) {
    if (rel.draft || rel.prerelease) continue;
    const m = /^web-v(\d+\.\d+\.\d+)$/.exec(rel.tag_name ?? '');
    const asset = (rel.assets ?? []).find((a) => /^KvalMachineScope-Link-[\d.]+\.exe$/i.test(a.name ?? ''));
    if (!m || !asset) continue;
    if (!best || compareVersions(m[1], best.version) > 0) {
      best = { version: m[1], tag: rel.tag_name, url: asset.browser_download_url, size: asset.size, sha256: /^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? '')?.[1]?.toLowerCase() ?? null, page: rel.html_url };
    }
  }
  return best;
}

/** The release's Link downloaded to a file of its own, its size and SHA-256 checked: its path */
async function download(rel) {
  if (!rel.sha256) throw new Error('The release gives no SHA-256 for its Link: download it by hand');
  const r = await fetch(rel.url, { headers: { 'User-Agent': 'KvalMachineScope-Link' }, signal: AbortSignal.timeout(10 * 60000) });
  if (!r.ok) throw new Error(`The download answered ${r.status}`);
  const data = Buffer.from(await r.arrayBuffer());
  if (Number.isFinite(rel.size) && data.length !== rel.size) throw new Error(`The download is ${data.length} bytes, not ${rel.size}`);
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  if (sha !== rel.sha256) throw new Error('The download does not match the release\'s SHA-256: not used');
  const file = path.join(os.tmpdir(), `kss-link-${rel.version}-${process.pid}.exe`);
  fs.writeFileSync(file, data);
  return file;
}

/**
 * This Link's file replaced by the downloaded one (renamed to .old first: a running .exe can be renamed, not
 * overwritten); in Program Files, the same as an administrator. → { ok, message, dry? }
 */
function replaceSelf(target, downloaded) {
  const old = `${target}.old`;
  if (dry()) return Promise.resolve({ ok: true, dry: `move "${target}" "${old}"; copy "${downloaded}" "${target}"`, message: 'Updated (dry run: nothing replaced)' });
  try {
    fs.rmSync(old, { force: true });
    fs.renameSync(target, old);
    try {
      fs.copyFileSync(downloaded, target);
    } catch (err) {
      fs.renameSync(old, target);
      throw err;
    }
    return Promise.resolve({ ok: true, message: 'Updated' });
  } catch (err) {
    if (err.code !== 'EPERM' && err.code !== 'EACCES') return Promise.resolve({ ok: false, message: `Could not replace Link: ${err.message}` });
  }
  const command = `Start-Process -FilePath 'cmd.exe' -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList ${ps(`/c del /f /q "${old}" 2>nul & move /y "${target}" "${old}" && copy /y "${downloaded}" "${target}"`)}`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 180000 }, () => {
      let ok = false;
      try {
        ok = fs.readFileSync(target).equals(fs.readFileSync(downloaded));
      } catch {
        // not replaced
      }
      resolve(ok ? { ok: true, message: 'Updated (as administrator)' } : { ok: false, message: 'Not updated (the administrator prompt was declined, or the copy failed)' });
    });
  });
}

/**
 * The updater: check() (at start after a minute, then every 6 hours), install() (now); auto: by itself when no page
 * is live. options: { version, target (this Link's file, or null when run from source), isIdle(), restart(file), log,
 * getAuto(), setAuto(on) }
 */
function createUpdater({ version, target, isIdle, restart, log, getAuto, setAuto }) {
  const state = { latest: null, checkedAt: null, error: null, busy: false, message: '' };
  let timer = null;
  const newer = () => !!state.latest && compareVersions(state.latest.version, version) > 0;

  async function check() {
    try {
      state.latest = await latestRelease();
      state.error = null;
    } catch (err) {
      state.error = err.message;
    }
    state.checkedAt = new Date().toISOString();
    if (newer()) log(`update: Link ${state.latest.version} is available (this is ${version})`);
    return status();
  }

  async function install() {
    if (!target) return { ok: false, message: 'This Link runs from its sources: it cannot replace itself' };
    if (!newer()) return { ok: false, message: 'No newer Link' };
    if (state.busy) return { ok: false, message: 'Already updating' };
    state.busy = true;
    try {
      state.message = `Downloading Link ${state.latest.version}`;
      const file = await download(state.latest);
      const r = await replaceSelf(target, file);
      state.message = r.message;
      if (r.ok) {
        log(`update: Link ${version} -> ${state.latest.version} (${target})`);
        if (!dry()) setTimeout(() => restart(target), 300);
      }
      // (copied into place, or not used)
      fs.rm(file, { force: true }, () => {});
      return { ...r, version: state.latest.version };
    } catch (err) {
      state.message = err.message;
      return { ok: false, message: err.message };
    } finally {
      state.busy = false;
    }
  }

  // By itself: a newer Link, auto on, no page live now (else the next check, in 10 minutes)
  async function tick() {
    await check();
    let wait = 6 * 3600000;
    if (newer() && target && getAuto()) {
      if (isIdle()) await install();
      else wait = 10 * 60000;
    }
    timer = setTimeout(tick, wait);
    timer.unref?.();
  }

  function start(firstDelayMs = Number(process.env.KSS_LINK_UPDATE_DELAY_MS) || 60000) {
    // (the file the last update left)
    if (target && !dry()) setTimeout(() => fs.rm(`${target}.old`, { force: true }, () => {}), 5000).unref?.();
    timer = setTimeout(tick, firstDelayMs);
    timer.unref?.();
  }

  function status() {
    return {
      version, canUpdate: !!target, auto: getAuto(), latest: state.latest && { version: state.latest.version, page: state.latest.page }, newer: newer(),
      checkedAt: state.checkedAt, error: state.error, busy: state.busy, message: state.message,
    };
  }

  return { start, check, install, status, setAuto, stop: () => clearTimeout(timer) };
}

/** The new Link started in this one's place (with the same options), this one ended */
function restartWith(file, args, closeServer) {
  closeServer(() => {
    spawn(file, [...args.filter((a) => a !== '--updated'), '--updated'], { detached: true, stdio: 'ignore' }).unref();
    process.exit(0);
  });
}

module.exports = { createUpdater, latestRelease, compareVersions, download, replaceSelf, restartWith };
