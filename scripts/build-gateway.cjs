// Assembles release/gateway: the gateway, the shared ADS helpers and the built web app (run "npm run build" first).
// Copy the folder to the gateway machine, then: npm install --omit=dev, node gateway.cjs init (see gateway/README.md).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'release', 'gateway');
const keep = new Set(['config.json', 'cert.pem', 'key.pem', 'node_modules']); // an existing installation's own files

fs.mkdirSync(out, { recursive: true });
for (const entry of fs.readdirSync(out)) {
  if (!keep.has(entry)) fs.rmSync(path.join(out, entry), { recursive: true, force: true });
}
for (const file of ['gateway.cjs', 'package.json', 'README.md']) fs.copyFileSync(path.join(root, 'gateway', file), path.join(out, file));
fs.cpSync(path.join(root, 'shared'), path.join(out, 'shared'), { recursive: true });
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('dist/ is missing: run "npm run build" first');
fs.cpSync(path.join(root, 'dist'), path.join(out, 'public'), { recursive: true });
console.log(`Gateway assembled in ${out}`);
