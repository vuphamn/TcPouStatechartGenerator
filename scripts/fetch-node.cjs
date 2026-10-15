// Node.js for the gateway, bundled by the installer (the gateway machine then needs nothing else): the official
// node.exe (win-x64) of a pinned version from nodejs.org, its SHA-256 checked against the release's SHASUMS256.txt,
// kept in release/cache between builds. → its path. Usage: node scripts/fetch-node.cjs [destination folder]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// (an LTS release; bump it here: the build checks the new one's SHA-256 as published)
const NODE_VERSION = '24.19.0';
const BASE = `https://nodejs.org/dist/v${NODE_VERSION}`;
const root = path.resolve(__dirname, '..');
const cached = path.join(root, 'release', 'cache', `node-v${NODE_VERSION}-win-x64.exe`);

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchNode() {
  const sums = (await get(`${BASE}/SHASUMS256.txt`)).toString('utf8');
  const expected = sums.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).find(([, f]) => f === 'win-x64/node.exe')?.[0];
  if (!/^[0-9a-f]{64}$/.test(expected ?? '')) throw new Error(`No SHA-256 for win-x64/node.exe in ${BASE}/SHASUMS256.txt`);
  if (fs.existsSync(cached) && sha256(fs.readFileSync(cached)) === expected) return cached;
  const exe = await get(`${BASE}/win-x64/node.exe`);
  const got = sha256(exe);
  if (got !== expected) throw new Error(`node.exe v${NODE_VERSION}: SHA-256 ${got}, nodejs.org publishes ${expected}: not used`);
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.writeFileSync(cached, exe);
  return cached;
}

module.exports = { fetchNode, NODE_VERSION };

if (require.main === module) {
  fetchNode()
    .then((p) => {
      const dest = process.argv[2];
      if (dest) {
        fs.mkdirSync(dest, { recursive: true });
        fs.copyFileSync(p, path.join(dest, 'node.exe'));
      }
      console.log(`Node.js v${NODE_VERSION} (win-x64): ${dest ? path.join(dest, 'node.exe') : p}`);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
