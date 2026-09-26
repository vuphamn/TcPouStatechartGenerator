// Stages the desktop installer's optional components in release/installer-extras (build/installer.nsh packs them):
//   KvalStateScope.Xae.vsix, vs-extension.ps1, install-tcxaeshell.ps1   the TwinCAT XAE extension (VS 2022 / 2026, TcXaeShell)
//   link/Kval StateScope Link.exe                                        the web edition's local helper
//   gateway/                                                             the gateway, with its runtime dependencies
// Run after "npm run build" (npm run build:exe does both). The VSIX is built with xae-extension/build.ps1 when missing.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'release', 'installer-extras');
const vsix = path.join(root, 'xae-extension', 'KvalStateScope.Xae', 'bin', 'Release', 'KvalStateScope.Xae.vsix');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('dist/ is missing: run "npm run build" first');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1. The XAE extension (Visual Studio's MSBuild is needed to build it)
if (!fs.existsSync(vsix)) {
  console.log('The VSIX is missing: building it with xae-extension/build.ps1 ...');
  run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'xae-extension', 'build.ps1')]);
} else {
  // A VSIX older than the extension's sources or the web app it carries is likely stale
  const newest = (dir, rx) => {
    let t = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['bin', 'obj', 'StateScopeApp'].includes(e.name)) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) t = Math.max(t, newest(f, rx));
      else if (rx.test(e.name)) t = Math.max(t, fs.statSync(f).mtimeMs);
    }
    return t;
  };
  const sources = Math.max(newest(path.join(root, 'xae-extension', 'KvalStateScope.Xae'), /\.(cs|vsct|vsixmanifest|csproj)$/i), newest(path.join(root, 'src'), /\.(tsx?|css)$/i));
  if (fs.statSync(vsix).mtimeMs < sources) {
    console.warn('WARNING: the VSIX is older than the extension or app sources. Rebuild it with xae-extension\\build.ps1 to include the latest changes.');
  }
}
fs.copyFileSync(vsix, path.join(out, 'KvalStateScope.Xae.vsix'));
fs.copyFileSync(path.join(root, 'build', 'installer', 'vs-extension.ps1'), path.join(out, 'vs-extension.ps1'));
fs.copyFileSync(path.join(root, 'xae-extension', 'install-tcxaeshell.ps1'), path.join(out, 'install-tcxaeshell.ps1'));

// 2. Kval StateScope Link (a single exe)
run(process.execPath, [path.join(root, 'scripts', 'build-link.cjs')]);
fs.mkdirSync(path.join(out, 'link'));
fs.copyFileSync(path.join(root, 'release', 'link', 'Kval StateScope Link.exe'), path.join(out, 'link', 'Kval StateScope Link.exe'));

// 3. The gateway with its dependencies (the gateway machine then needs only Node.js)
run(process.execPath, [path.join(root, 'scripts', 'build-gateway.cjs')]);
const gateway = path.join(out, 'gateway');
const ownFiles = new Set(['config.json', 'cert.pem', 'key.pem', 'node_modules']);
fs.cpSync(path.join(root, 'release', 'gateway'), gateway, { recursive: true, filter: (src) => !ownFiles.has(path.relative(path.join(root, 'release', 'gateway'), src)) });
const npmArgs = ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'];
if (process.platform === 'win32') run('cmd.exe', ['/d', '/c', 'npm', ...npmArgs], { cwd: gateway });
else run('npm', npmArgs, { cwd: gateway });

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`Installer components staged in ${out} (${Math.round(size(out) / 1048576)} MB)`);
