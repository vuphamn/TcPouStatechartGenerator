// Assembles release/gateway: the gateway, the shared ADS helpers, the built web app (run "npm run build" first) and its
// runtime packages (node_modules: npm install --omit=dev here). Copy the folder to the gateway machine, then: node
// gateway.cjs init (see gateway/README.md); it needs only Node.js there.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'release', 'gateway');
const keep = new Set(['config.json', 'cert.pem', 'key.pem', 'node_modules']); // an existing installation's own files

fs.mkdirSync(out, { recursive: true });
for (const entry of fs.readdirSync(out)) {
  if (!keep.has(entry)) fs.rmSync(path.join(out, entry), { recursive: true, force: true });
}
// (every module of the gateway: a new one is not forgotten, as projectSync.cjs nearly was)
const modules = fs.readdirSync(path.join(root, 'gateway')).filter((f) => /\.cjs$/i.test(f));
for (const file of [...modules, 'gateway.cmd', 'package.json', 'package-lock.json', 'README.md']) fs.copyFileSync(path.join(root, 'gateway', file), path.join(out, file));
fs.cpSync(path.join(root, 'shared'), path.join(out, 'shared'), { recursive: true });
// (the PLC's function blocks it offers: FB_KvalEventRelay.st)
fs.cpSync(path.join(root, 'gateway', 'plc'), path.join(out, 'plc'), { recursive: true });
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('dist/ is missing: run "npm run build" first');
fs.cpSync(path.join(root, 'dist'), path.join(out, 'public'), { recursive: true });
// (its packages, as its package.json names them: the gateway machine needs no npm)
const npmArgs = ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'];
if (process.platform === 'win32') execFileSync('cmd.exe', ['/d', '/c', 'npm', ...npmArgs], { cwd: out, stdio: 'inherit' });
else execFileSync('npm', npmArgs, { cwd: out, stdio: 'inherit' });
for (const pkg of Object.keys(JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8')).dependencies ?? {})) {
  if (!fs.existsSync(path.join(out, 'node_modules', pkg, 'package.json'))) throw new Error(`${pkg} was not installed in ${out}`);
}
console.log(`Gateway assembled in ${out}, with its packages`);
