// CI only (it installs the app, with its shortcuts and registry entries, and removes it again): the desktop installer
// built in release/ run the way Update now runs it quietly. A stand-in for GitHub's releases serves it; the app's own
// code (shared/desktopUpdate.cjs) finds it, downloads it, checks its SHA-256 and starts it with the quiet switches
// (/S --force-run), as electron/main.cjs does. Then: the app is installed, and started again by the installer; finally
// it is closed and uninstalled quietly. Exit code 0 when all of that holds.
//   node scripts/installer-check.cjs [--keep]   (--keep: not uninstalled)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const product = pkg.build?.productName ?? 'Kval MachineScope';
const exeName = `${product}.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

if (process.platform !== 'win32' || (!process.env.CI && !process.argv.includes('--yes'))) {
  console.error('This installs the app on this computer (shortcuts, registry entries): it runs on CI only (or with --yes)');
  process.exit(2);
}

const running = () => {
  try {
    return execFileSync('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).includes(exeName);
  } catch {
    return false;
  }
};
// (per user: %LOCALAPPDATA%\Programs; for all users: Program Files)
const installedExe = () => {
  for (const base of [path.join(process.env.LOCALAPPDATA ?? '', 'Programs'), process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
    let dirs = [];
    try {
      dirs = fs.readdirSync(base);
    } catch {
      continue;
    }
    for (const d of dirs) {
      const f = path.join(base, d, exeName);
      if (fs.existsSync(f)) return f;
    }
  }
  return null;
};

(async () => {
  const setup = fs.readdirSync(path.join(root, 'release')).find((f) => /setup.*\.exe$/i.test(f));
  if (!setup) throw new Error('No installer in release/: build it first (electron-builder --win nsis)');
  const data = fs.readFileSync(path.join(root, 'release', setup));
  const version = pkg.version;
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  console.log(`installer: ${setup} (${Math.round(data.length / 1048576)} MB), version ${version}`);
  expect(!installedExe() && !running(), 'not installed before');

  // The release, stood in for
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/files/')) {
      res.setHeader('Content-Length', data.length);
      return res.end(data);
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify([{ tag_name: `desktop-v${version}`, html_url: 'https://example.invalid', draft: false, prerelease: false, assets: [{ name: `KvalMachineScope-Setup-${version}.exe`, browser_download_url: 'http://127.0.0.1:48928/files/setup.exe', size: data.length, digest: `sha256:${sha}` }] }]));
  });
  await new Promise((r) => server.listen(48928, '127.0.0.1', r));
  process.env.KSS_DESKTOP_RELEASES = 'http://127.0.0.1:48928/releases';
  delete process.env.KSS_SERVICE_DRYRUN;

  // Update now, quietly: the app's own code; the installer started as electron/main.cjs starts it
  const { installUpdate } = require(path.join(root, 'shared', 'desktopUpdate.cjs'));
  let installer = null;
  const r = await installUpdate({ version, quiet: true, start: (file, args) => (installer = spawn(file, args, { detached: true, stdio: 'ignore' })) });
  server.closeAllConnections();
  server.close();
  expect(r.ok && JSON.stringify(r.args) === '["/S","--force-run"]', `found, downloaded, checked, started quietly: ${r.message}`);
  if (!installer) throw new Error('The installer was not started');
  const code = await new Promise((res) => installer.on('exit', res));
  expect(code === 0, `the installer ended (exit ${code})`);

  // Installed, and started again by the installer
  let exe = null;
  for (let i = 0; i < 60 && !(exe = installedExe()); i++) await sleep(1000);
  expect(!!exe, `installed: ${exe}`);
  let up = false;
  for (let i = 0; i < 60 && !(up = running()); i++) await sleep(1000);
  expect(up, 'started again by the installer (--force-run)');

  if (!process.argv.includes('--keep') && exe) {
    try {
      execFileSync('taskkill', ['/F', '/T', '/IM', exeName], { stdio: 'ignore' });
    } catch {
      // (not running)
    }
    await sleep(2000);
    const uninstaller = path.join(path.dirname(exe), `Uninstall ${product}.exe`);
    expect(fs.existsSync(uninstaller), `its uninstaller: ${uninstaller}`);
    if (fs.existsSync(uninstaller)) {
      spawn(uninstaller, ['/S'], { stdio: 'ignore' });
      let gone = false;
      for (let i = 0; i < 90 && !(gone = !fs.existsSync(exe)); i++) await sleep(1000);
      expect(gone, 'uninstalled quietly');
    }
  }
  fs.rmSync(path.join(os.tmpdir(), `KvalMachineScope-Setup-${version}.exe`), { force: true });
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
