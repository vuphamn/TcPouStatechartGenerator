// A device's details for the I/O tab's properties (read-only, this computer): TwinCAT's device descriptions (the
// ESI files, Config\Io\EtherCAT\*.xml: its full name, group, vendor and web page), and the user's own pictures of it
// (Documents\Kval StateScope\Devices\<type>*.png / .jpg / .webp). Beckhoff's files are named by family
// ("Beckhoff EL1xxx.xml"): only those that can hold the type are read.
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Where TwinCAT keeps the ESI files: 4026's folder, 4024's (KSS_ESI_DIR: the tests') */
function esiDirs() {
  if (process.env.KSS_ESI_DIR) return [process.env.KSS_ESI_DIR];
  return ['C:\\Program Files (x86)\\Beckhoff\\TwinCAT\\3.1\\Config\\Io\\EtherCAT', 'C:\\TwinCAT\\3.1\\Config\\Io\\EtherCAT'].filter((d) => {
    try {
      return fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
}

const cdata = (s) => String(s ?? '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
const decode = (s) => cdata(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
/** An element's English text (LcId 1033), else its first */
const english = (xml, tag) => {
  const all = [...xml.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))];
  const en = all.find((m) => /LcId="1033"/.test(m[1] ?? '')) ?? all[0];
  return en ? decode(en[2]) : '';
};
const hexNum = (v) => {
  const m = /^#x([0-9a-f]+)$/i.exec(String(v ?? '').trim());
  return m ? parseInt(m[1], 16) >>> 0 : Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) >>> 0 : null;
};

/** The files that can describe a type: by their family pattern (x, y, z: any character), the most specific first */
function candidates(dir, type) {
  const t = String(type || '').trim().toUpperCase();
  if (!t) return [];
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => /\.xml$/i.test(f));
  } catch {
    return [];
  }
  const scored = [];
  for (const f of names) {
    const fam = f.replace(/^Beckhoff\s+/i, '').replace(/\.xml$/i, '').toUpperCase();
    if (!/^[A-Z]/.test(fam)) continue;
    const rx = new RegExp(`^${fam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[XYZ]/g, '[0-9A-Z]')}`);
    if (rx.test(t)) scored.push({ f, wild: (fam.match(/[XYZ]/g) ?? []).length, len: fam.length });
  }
  return scored.sort((a, b) => a.wild - b.wild || b.len - a.len).map((x) => path.join(dir, x.f));
}

const fileCache = new Map();
/** A file's devices of one product code: [{ revision, xml }], and its vendor's name and its groups' names */
function devicesIn(file, productCode) {
  let text;
  try {
    const st = fs.statSync(file);
    const key = `${file}|${st.mtimeMs}|${productCode}`;
    if (fileCache.has(key)) return fileCache.get(key);
    text = fs.readFileSync(file, 'latin1');
    const vendor = english(/<Vendor\b[\s\S]*?<\/Vendor>/.exec(text)?.[0] ?? '', 'Name');
    const groups = {};
    for (const g of text.matchAll(/<Group\b[^>]*>([\s\S]*?)<\/Group>/g)) {
      const type = decode(/<Type>([\s\S]*?)<\/Type>/.exec(g[1])?.[1] ?? '');
      if (type) groups[type] = english(g[1], 'Name');
    }
    const found = [];
    const code = hexNum(productCode);
    for (const m of text.matchAll(/<Type\s+ProductCode="([^"]+)"(?:\s+RevisionNo="([^"]*)")?[^>]*>/g)) {
      if (hexNum(m[1]) !== code) continue;
      const start = text.lastIndexOf('<Device', m.index);
      const end = text.indexOf('</Device>', m.index);
      if (start < 0 || end < 0) continue;
      found.push({ revision: hexNum(m[2]), xml: text.slice(start, Math.min(end, start + 200000)) });
    }
    const r = { vendor, groups, found };
    fileCache.set(key, r);
    if (fileCache.size > 200) fileCache.delete(fileCache.keys().next().value);
    return r;
  } catch {
    return { vendor: '', groups: {}, found: [] };
  }
}

/**
 * A device's description from TwinCAT's ESI files: req { productCode, revision?, type } (type: its name, e.g.
 * "EL1008", "EK1200-5000"). { type, name, group, vendor, url, revision, file } or null (not found here)
 */
function findDevice(req) {
  const type = String(req?.type || '').split(/[\s,;]+/)[0];
  const code = hexNum(req?.productCode);
  if (!type || code === null) return null;
  for (const dir of esiDirs()) {
    for (const file of candidates(dir, type)) {
      const { vendor, groups, found } = devicesIn(file, req.productCode);
      if (!found.length) continue;
      const rev = hexNum(req.revision);
      const best = found.find((d) => d.revision === rev) ?? [...found].sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0))[0];
      const groupType = decode(/<GroupType>([\s\S]*?)<\/GroupType>/.exec(best.xml)?.[1] ?? '');
      return {
        type: decode(/<Type\b[^>]*>([\s\S]*?)<\/Type>/.exec(best.xml)?.[1] ?? type),
        name: english(best.xml, 'Name'),
        group: groups[groupType] ?? groupType,
        vendor,
        url: english(best.xml, 'URL').replace(/^http:\/\//i, 'https://'),
        revision: best.revision === rev ? 'same' : 'other',
        file: path.basename(file),
      };
    }
  }
  return null;
}

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
/** The user's folder of device pictures (documents: their Documents folder) */
const devicesDirOf = (documents) => path.join(documents || path.join(os.homedir(), 'Documents'), 'Kval StateScope', 'Devices');

/**
 * The user's pictures of a type (its name at the start of the file's: "EL1008.png", "EL1008 front.jpg",
 * "EL1008-back.webp"), at most 8 of 6 MB each: [{ name, dataUrl }]
 */
function deviceImages(documents, product, folder = null) {
  const dir = folder || devicesDirOf(documents);
  const p = String(product || '').trim().toLowerCase();
  if (!p || /[\\/]/.test(p)) return [];
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const f of names.sort()) {
    if (!IMAGE.test(f)) continue;
    const stem = f.toLowerCase();
    if (!stem.startsWith(p) || !/^($|[\s._-])/.test(stem.slice(p.length))) continue;
    try {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      if (!st.isFile() || st.size > 6 * 1024 * 1024) continue;
      out.push({ name: f, dataUrl: `data:${MIME[IMAGE.exec(f)[1].toLowerCase()]};base64,${fs.readFileSync(full).toString('base64')}` });
    } catch {
      // (unreadable: left out)
    }
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * The properties' details: req { productCode, revision, type, product }, documents (the user's Documents folder; or
 * folder: the pictures' own, e.g. a gateway's) -> { esi, images, folder }
 */
function deviceInfo(req, documents, folder = null) {
  let esi = null;
  try {
    esi = findDevice(req);
  } catch {
    esi = null;
  }
  return { esi, images: deviceImages(documents, req?.product || String(req?.type || '').split(/[\s,;]+/)[0], folder), folder: folder || devicesDirOf(documents), esiDirs: esiDirs() };
}

module.exports = { deviceInfo, findDevice, deviceImages, devicesDirOf, esiDirs, candidates };
