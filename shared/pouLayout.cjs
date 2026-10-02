// A POU's layout file: <POU>.machinescope.json next to its .TcPOU (the states' places, the transitions' routes, the
// notes and the states' documentation, as the canvas has them), for git: shared with the other developers. The
// personal settings (theme, presets, recordings) stay in each user's own storage. Read and written by the desktop
// app and Link (shared/liveSession.cjs); the XAE extension has its own.
const fs = require('fs');
const path = require('path');

const SUFFIX = '.machinescope.json';
// (a layout file is small: more is not one)
const MAX_BYTES = 4 * 1024 * 1024;

/** The layout file of a .TcPOU (its full path), or an error when it is not a POU */
function layoutPathOf(pouPath) {
  const p = path.resolve(String(pouPath || ''));
  if (!/\.TcPOU$/i.test(p)) throw new Error('Not a POU (.TcPOU)');
  return p.replace(/\.TcPOU$/i, SUFFIX);
}

/** Its text, or null when there is none yet */
function readLayoutFile(pouPath) {
  const file = layoutPathOf(pouPath);
  if (!fs.existsSync(file)) return null;
  if (fs.statSync(file).size > MAX_BYTES) throw new Error(`${path.basename(file)} is too big to be a layout file`);
  return fs.readFileSync(file, 'utf8');
}

/**
 * Written (the POU must be there): only when it changed, through a temp file renamed over it (a reader never sees
 * half of it). text null: removed. → { written: true | false, file }
 */
function writeLayoutFile(pouPath, text) {
  const pou = path.resolve(String(pouPath || ''));
  const file = layoutPathOf(pou);
  if (!fs.existsSync(pou)) throw new Error(`${path.basename(pou)} is not there`);
  if (text === null) {
    if (!fs.existsSync(file)) return { written: false, file };
    fs.rmSync(file, { force: true });
    return { written: true, file };
  }
  const content = String(text);
  if (Buffer.byteLength(content) > MAX_BYTES) throw new Error('The layout is too big to write');
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return { written: false, file };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
  return { written: true, file };
}

module.exports = { SUFFIX, layoutPathOf, readLayoutFile, writeLayoutFile };
