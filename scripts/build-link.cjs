// Builds release/link/Kval StateScope Link.exe: link/link.cjs bundled into one file (esbuild) and packed into a
// copy of node.exe (Node.js single executable application), so the laptop needs no Node.js.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'release', 'link');
const bundle = path.join(out, 'statescope-link.cjs');
const exe = path.join(out, 'Kval StateScope Link.exe');
fs.mkdirSync(out, { recursive: true });

// 1. One CommonJS file (ws's optional native add-ons are left out: it works without them)
require('esbuild').buildSync({
  entryPoints: [path.join(root, 'link', 'link.cjs')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: bundle,
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'warning',
});

// 2. Single executable: the bundle as a blob injected into a copy of this node.exe
const seaConfig = path.join(out, 'sea-config.json');
const blob = path.join(out, 'sea-prep.blob');
fs.writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });
fs.copyFileSync(process.execPath, exe);
execFileSync(process.execPath, [
  path.join(root, 'node_modules', 'postject', 'dist', 'cli.js'),
  exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite',
], { stdio: 'inherit' });
fs.rmSync(seaConfig);
fs.rmSync(blob);
console.log(`Built ${exe} (and the plain bundle ${path.basename(bundle)}, runnable with "node")`);
