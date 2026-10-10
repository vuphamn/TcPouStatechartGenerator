// The Structured Text sections of TwinCAT source files, as files of their own (the VS Code file system
// "twincat-st:"): each read from and written into its file on disk, with a time of its own, so writing one section
// does not make another one's unsaved edits look older than the file (VS Code's "the file is newer" question): a
// section's time changes only when its own text changes. No vscode here (tested on its own).
'use strict';
const fs = require('fs');
const path = require('path');
const { parseSource, writeSection } = require('./tcStSource.cjs');

const SCHEME = 'twincat-st';
const SECTION_LABEL = { decl: 'Decl', impl: 'Impl' };

/** A section's address: { file, key, section } ⇄ its path (the tab's title) and query */
function sectionAddress({ file, key, section }, members) {
  const parsed = members ?? null;
  const base = path.basename(file).replace(/\.(TcPOU|TcDUT|TcGVL|TcIO)$/i, '');
  const member = parsed?.find((m) => m.key === key);
  // (the tab's title: EFX (Decl).st, EFX.doState (Impl).st, EFX.Speed.Get (Impl).st)
  const title = key === '' ? base : (member?.label ?? `${base}.${key.replace(/^\w+:/, '')}`);
  const query = new URLSearchParams({ file, key, section }).toString();
  return { path: `/${base}/${title} (${SECTION_LABEL[section]}).st`, query };
}
function addressOf(query) {
  const q = new URLSearchParams(query);
  const section = q.get('section');
  if (!q.get('file') || (section !== 'decl' && section !== 'impl')) throw new Error(`Not a TwinCAT section: ${query}`);
  return { file: q.get('file'), key: q.get('key') ?? '', section };
}

function createSectionStore({ now = () => Date.now() } = {}) {
  // (each section's text and time, as last read or written: file|key|section → { text, mtime })
  const known = new Map();
  const id = (a) => `${path.resolve(a.file).toLowerCase()}|${a.key}|${a.section}`;
  const read = (a) => {
    const xml = fs.readFileSync(a.file, 'utf8');
    const mb = parseSource(xml).members.find((m) => m.key === a.key);
    const part = mb?.[a.section];
    if (!part) return null;
    return { xml, text: part.text };
  };
  /** The section's text and time now (its time kept while its text stays the same), or null: no such section */
  function stat(a) {
    const r = read(a);
    if (!r) return null;
    const was = known.get(id(a));
    if (was && was.text === r.text) return { text: r.text, mtime: was.mtime };
    const mtime = Math.max(now(), (was?.mtime ?? 0) + 1);
    known.set(id(a), { text: r.text, mtime });
    return { text: r.text, mtime };
  }
  /** The section written into its file (only its CDATA text); its new time */
  function write(a, text) {
    const r = read(a);
    if (!r) throw new Error(`${a.key || 'The object'} has no ${a.section === 'decl' ? 'declaration' : 'Structured Text implementation'} in ${path.basename(a.file)}`);
    if (r.text !== text) fs.writeFileSync(a.file, writeSection(r.xml, a.key, a.section, text), 'utf8');
    const was = known.get(id(a));
    const mtime = r.text === text && was ? was.mtime : Math.max(now(), (was?.mtime ?? 0) + 1);
    known.set(id(a), { text, mtime });
    return mtime;
  }
  /** The sections of this file whose text changed on disk since last read (to be told to their editors) */
  function changedIn(file) {
    const out = [];
    const prefix = `${path.resolve(file).toLowerCase()}|`;
    for (const [k, v] of known) {
      if (!k.startsWith(prefix)) continue;
      const [, key, section] = k.split('|');
      let text = null;
      try {
        text = read({ file, key, section })?.text ?? null;
      } catch {
        text = null;
      }
      if (text !== v.text) out.push({ file, key, section });
    }
    return out;
  }
  return { stat, write, changedIn };
}

module.exports = { SCHEME, sectionAddress, addressOf, createSectionStore };
