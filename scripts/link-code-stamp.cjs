// Link's code stamp: a hash of the code Link runs (link/, shared/), line endings aside. build-link.cjs bakes it into
// Link.exe, the app build (vite.config.ts) into the page: a Link whose stamp differs from the page's is from another
// version (the page says so). Run from source, Link computes it itself.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function linkCodeStamp(root = path.resolve(__dirname, '..')) {
  const h = crypto.createHash('sha1');
  for (const dir of ['link', 'shared']) {
    const files = fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.cjs')).sort();
    for (const f of files) h.update(`${dir}/${f}\n`).update(fs.readFileSync(path.join(root, dir, f), 'utf8').replace(/\r\n/g, '\n'));
  }
  return h.digest('hex').slice(0, 12);
}

module.exports = { linkCodeStamp };
