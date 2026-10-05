// The desktop app's Update now: its release's installer (tag desktop-v<version>, KvalMachineScope-Setup-<version>.exe)
// downloaded, its size and SHA-256 checked, then started; the app closes so the installer can replace it. Only an
// installed app (not the portable one, not one run from its sources). Quietly: the installer without its pages (/S),
// the app started again once installed (--force-run).
//   KSS_DESKTOP_RELEASES: the release list's URL (the tests: a local stand-in); KSS_SERVICE_DRYRUN=1: downloaded and
//   checked, not started
const { latestRelease, download, releasesUrl, DEFAULT_REPO } = require('./releases.cjs');

const INSTALLER = /^KvalMachineScope-Setup-\d+\.\d+\.\d+\.exe$/i;
const AGENT = 'KvalMachineScope-Desktop';
// (the installer's own switches: silent, then the app started)
const QUIET_ARGS = ['/S', '--force-run'];

/**
 * { repo?, token? (a private repository), version? (that release; else the newest), quiet?, start(file, args) (runs
 * the installer and closes the app) } → { ok, message, version?, file?, args?, dry? }
 */
async function installUpdate({ repo = DEFAULT_REPO, token, version, quiet = false, start }) {
  try {
    if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo))) return { ok: false, message: `Not a GitHub repository: ${repo}` };
    if (version != null && !/^\d+\.\d+\.\d+$/.test(String(version))) return { ok: false, message: `Not a version: ${version}` };
    const url = process.env.KSS_DESKTOP_RELEASES || releasesUrl(repo);
    const rel = await latestRelease({ url, tagPrefix: 'desktop', asset: INSTALLER, agent: AGENT, token: token || undefined, version: version || undefined });
    if (!rel) return { ok: false, message: version ? `The release desktop-v${version} has no installer` : 'No desktop release with an installer' };
    const file = await download(rel, { agent: AGENT, token: token || undefined, name: `KvalMachineScope-Setup-${rel.version}.exe` });
    const args = quiet ? QUIET_ARGS : [];
    if (process.env.KSS_SERVICE_DRYRUN === '1') return { ok: true, dry: true, file, args, version: rel.version, message: `Downloaded and checked (dry run: not started${quiet ? ', quietly' : ''}): ${file}` };
    start(file, args);
    return { ok: true, file, args, version: rel.version, message: quiet ? `Kval MachineScope ${rel.version} is being installed: this app closes and starts again when it is done` : `The installer of Kval MachineScope ${rel.version} is starting: this app closes` };
  } catch (err) {
    return { ok: false, message: err?.message ?? String(err) };
  }
}

module.exports = { installUpdate, INSTALLER, QUIET_ARGS };
