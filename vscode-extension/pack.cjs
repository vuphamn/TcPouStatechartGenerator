#!/usr/bin/env node
// The VS Code extension packaged: the app's build (dist/, npm run build first) copied into the extension as app/, then
// a .vsix written (a zip: extension/…, its manifest, its content types; no vsce needed), versioned as the app is.
//   node vscode-extension/pack.cjs [--out release]      → release/kval-machinescope-vscode-<version>.vsix
// Install: VS Code → Extensions → … → Install from VSIX (or: code --install-extension <file>.vsix)
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const outDir = path.resolve(REPO, outAt >= 0 && args[outAt + 1] ? args[outAt + 1] : 'release');

const dist = path.join(REPO, 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('No app build: run npm run build first');
  process.exit(1);
}
const version = require(path.join(REPO, 'package.json')).version;
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
manifest.version = version;

// (the files: extension/package.json with the version, its code, the app)
const files = [];
const add = (name, data) => files.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data) });
add('extension/package.json', JSON.stringify(manifest, null, 2));
// (its code in one file: extension.js with its modules, the shared TwinCAT ones (../shared: XAE's Automation
// Interface, ADS) and ads-client bundled by esbuild; vscode is VS Code's own)
const bundled = require('esbuild').buildSync({
  entryPoints: [path.join(HERE, 'extension.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  write: false,
  logLevel: 'warning',
});
add('extension/extension.js', bundled.outputFiles[0].contents);
if (fs.existsSync(path.join(HERE, 'README.md'))) add('extension/README.md', fs.readFileSync(path.join(HERE, 'README.md')));
// (the Structured Text grammar and the TwinCAT view's icon)
for (const dir of ['syntaxes', 'media', 'snippets']) {
  for (const e of fs.readdirSync(path.join(HERE, dir))) add(`extension/${dir}/${e}`, fs.readFileSync(path.join(HERE, dir, e)));
}
const walk = (dir, rel) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, `${rel}${e.name}/`);
    else add(`extension/app/${rel}${e.name}`, fs.readFileSync(p));
  }
};
walk(dist, '');
const types = [...new Set(files.map((f) => path.extname(f.name).toLowerCase()).filter(Boolean))];
const mime = { '.json': 'application/json', '.js': 'application/javascript', '.cjs': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.map': 'application/json', '.txt': 'text/plain' };
add('[Content_Types].xml', `<?xml version="1.0" encoding="utf-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${[...types, '.vsixmanifest'].map((e) => `<Default Extension="${e}" ContentType="${e === '.vsixmanifest' ? 'text/xml' : mime[e] ?? 'application/octet-stream'}"/>`).join('')}</Types>`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
add('extension.vsixmanifest', `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${esc(manifest.name)}" Version="${esc(version)}" Publisher="${esc(manifest.publisher)}" />
    <DisplayName>${esc(manifest.displayName)}</DisplayName>
    <Description xml:space="preserve">${esc(manifest.description)}</Description>
    <Tags>twincat,plc,statechart,structured-text</Tags>
    <Categories>${esc(manifest.categories.join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${esc(manifest.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`);

// A zip (deflated; CRC-32 of each file)
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const parts = [];
const central = [];
let offset = 0;
for (const f of files) {
  const name = Buffer.from(f.name, 'utf8');
  const packed = zlib.deflateRawSync(f.data, { level: 9 });
  const crc = crc32(f.data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // (UTF-8 names)
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(0, 10); // time, date
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(f.data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  parts.push(local, name, packed);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0);
  c.writeUInt16LE(20, 4);
  c.writeUInt16LE(20, 6);
  c.writeUInt16LE(0x0800, 8);
  c.writeUInt16LE(8, 10);
  c.writeUInt32LE(0, 12);
  c.writeUInt32LE(crc, 16);
  c.writeUInt32LE(packed.length, 20);
  c.writeUInt32LE(f.data.length, 24);
  c.writeUInt16LE(name.length, 28);
  c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += local.length + name.length + packed.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `kval-machinescope-vscode-${version}.vsix`);
fs.writeFileSync(out, Buffer.concat([...parts, centralBuf, end]));
console.log(`${out} (${files.length} files, ${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
