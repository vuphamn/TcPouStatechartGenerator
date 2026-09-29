// A granted project folder, in the page (the File System Access API's handles, in memory): window.showDirectoryPicker
// gives it; window.__fakeFs: what was written, and how often a file was read. Put in with page.evaluateOnNewDocument
// (fakeFolder, { name, files: { path: text } })
function fakeFolder(tree) {
  const now = Date.now() - 60000;
  const files = new Map(Object.entries(tree.files).map(([p, text]) => [p, { text, mtime: now }]));
  window.__fakeFs = { written: {}, reads: 0 };
  const file = (p) => ({
    kind: 'file',
    name: p.split('/').pop(),
    async getFile() {
      window.__fakeFs.reads++;
      const f = files.get(p);
      return new File([f.text], p.split('/').pop(), { lastModified: f.mtime });
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async createWritable() {
      const parts = [];
      return {
        async write(d) { parts.push(typeof d === 'string' ? d : await new Response(d).text()); },
        async close() { const text = parts.join(''); files.set(p, { text, mtime: Date.now() }); window.__fakeFs.written[p] = text; },
      };
    },
  });
  const dir = (prefix, name) => ({
    kind: 'directory',
    name,
    async *values() {
      const seen = new Set();
      for (const p of files.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length).split('/');
        if (seen.has(rest[0])) continue;
        seen.add(rest[0]);
        yield rest.length === 1 ? file(prefix + rest[0]) : dir(`${prefix}${rest[0]}/`, rest[0]);
      }
    },
    async getDirectoryHandle(n) { return dir(`${prefix}${n}/`, n); },
    async getFileHandle(n, o) {
      if (!files.has(prefix + n) && !o?.create) throw new DOMException('not found', 'NotFoundError');
      if (!files.has(prefix + n)) files.set(prefix + n, { text: '', mtime: Date.now() });
      return file(prefix + n);
    },
    async resolve() { return null; },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  });
  window.showDirectoryPicker = async () => dir('', tree.name);
}

module.exports = { fakeFolder };
