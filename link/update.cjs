// Link's page: the installed Link (the one the Start menu starts) replaced by this one, when this one is a newer
// build. The installer's per-user folder: a copy; Program Files: the copy asks Windows for an administrator first
// (its own confirmation). KSS_SERVICE_DRYRUN=1: nothing copied, the command returned (the tests);
// KSS_INSTALLED_LINK: where the installed Link is (the tests).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const dry = () => process.env.KSS_SERVICE_DRYRUN === '1';
// (a PowerShell string: single quotes doubled)
const ps = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** The installed Link, when it is not this one: { path, modified, perUser } */
function installedLink() {
  const candidates = process.env.KSS_INSTALLED_LINK
    ? [process.env.KSS_INSTALLED_LINK]
    : [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Kval MachineScope', 'Link', 'Kval MachineScope Link.exe'), process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Kval MachineScope', 'Link', 'Kval MachineScope Link.exe')].filter(Boolean);
  for (const f of candidates) {
    try {
      if (path.resolve(f).toLowerCase() === path.resolve(process.execPath).toLowerCase()) return null;
      const perUser = !!process.env.LOCALAPPDATA && path.resolve(f).toLowerCase().startsWith(path.resolve(process.env.LOCALAPPDATA).toLowerCase());
      return { path: f, modified: fs.statSync(f).mtime.toISOString(), perUser };
    } catch {
      // not installed there
    }
  }
  return null;
}

/** This Link's own file, when it runs as a built Link (not node with its sources): its path and time */
function thisLink(build) {
  if (build?.from !== 'build' && !process.env.KSS_THIS_LINK) return null;
  const f = process.env.KSS_THIS_LINK || process.execPath;
  try {
    return { path: f, modified: fs.statSync(f).mtime.toISOString() };
  } catch {
    return null;
  }
}

/** Can this Link replace the installed one (a built one, newer)? */
function canReplace(build) {
  const inst = installedLink();
  const me = thisLink(build);
  return !!inst && !!me && Date.parse(me.modified) > Date.parse(inst.modified);
}

/** The installed Link replaced by this one: { ok, message, dry? } */
function replaceInstalled(build, log) {
  const inst = installedLink();
  const me = thisLink(build);
  if (!inst || !me) return Promise.resolve({ ok: false, message: 'No installed Link to replace, or this Link runs from its sources' });
  if (!(Date.parse(me.modified) > Date.parse(inst.modified))) return Promise.resolve({ ok: false, message: 'The installed Link is not older than this one' });
  if (inst.perUser) {
    if (dry()) return Promise.resolve({ ok: true, dry: `copy "${me.path}" "${inst.path}"`, message: 'Replaced: the Start menu now starts this Link.' });
    try {
      fs.copyFileSync(me.path, inst.path);
      log(`update: the installed Link (${inst.path}) replaced by this one`);
      return Promise.resolve({ ok: true, message: 'Replaced: the Start menu now starts this Link.' });
    } catch (err) {
      return Promise.resolve({ ok: false, message: `Could not replace it: ${err.message}` });
    }
  }
  // Program Files: an elevated copy (Windows asks for an administrator)
  const command = `Start-Process -FilePath 'cmd.exe' -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList ${ps(`/c copy /y "${me.path}" "${inst.path}"`)}`;
  if (dry()) return Promise.resolve({ ok: true, dry: `powershell.exe -NoProfile -Command ${command}`, message: 'Replaced: the Start menu now starts this Link.' });
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 120000 }, () => {
      const now = installedLink();
      const ok = !!now && Math.abs(Date.parse(now.modified) - Date.parse(me.modified)) < 2000;
      if (ok) log(`update: the installed Link (${inst.path}) replaced by this one (as administrator)`);
      resolve(ok ? { ok: true, message: 'Replaced: the Start menu now starts this Link.' } : { ok: false, message: 'Not replaced (the administrator prompt was declined, or the copy failed)' });
    });
  });
}

module.exports = { installedLink, thisLink, canReplace, replaceInstalled };
