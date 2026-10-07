import { DutCandidate } from './dutMatcher.ts';

/** A loaded .TcPOU. `dutCandidates` is null when its folder could not be searched (yet) */
export interface PouSource {
  name: string;
  content: string;
  /** Full path (desktop app only) */
  path?: string;
  dutCandidates: DutCandidate[] | null;
  /** From the PLC's own sources: where it is there (Build puts the edits back) */
  plc?: import('./plcBuild.ts').PlcOrigin;
}

// File System Access API (Chromium browsers): only the parts used here
interface FsHandle {
  kind: 'file' | 'directory';
  name: string;
}
interface FsFileHandle extends FsHandle {
  kind: 'file';
  getFile(): Promise<File>;
  queryPermission?(options: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?(options: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  createWritable?(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void> }>;
}
interface FsDirectoryHandle extends FsHandle {
  kind: 'directory';
  values(): AsyncIterable<FsFileHandle | FsDirectoryHandle>;
  getDirectoryHandle(name: string): Promise<FsDirectoryHandle>;
  resolve(possibleDescendant: FsHandle): Promise<string[] | null>;
}
interface FsAccessWindow {
  showOpenFilePicker?: (options: unknown) => Promise<FsFileHandle[]>;
  showDirectoryPicker?: (options: unknown) => Promise<FsDirectoryHandle>;
  tcDesktop?: { isDesktop: true; openPou: () => Promise<PouSource | null> };
}
/**
 * Shown inside another app: VS Code's built-in browser (an Electron webview, the page in a frame), another app's
 * webview: its pickers open, but reading what was picked is refused (the app grants no file access). Their file
 * access is not used there: the plain file chooser, .TcDUT files chosen, a download to save (the desktop app, an
 * Electron app of its own, has its own file access)
 */
export const isEmbeddedBrowser = (() => {
  try {
    return window.self !== window.top || /\bElectron\//.test(navigator.userAgent);
  } catch {
    // (a frame of another origin)
    return true;
  }
})();
const rawWindow = window as unknown as FsAccessWindow;
const w: FsAccessWindow = isEmbeddedBrowser && !rawWindow.tcDesktop ? { tcDesktop: rawWindow.tcDesktop } : rawWindow;

export const isDesktopApp = () => Boolean(w.tcDesktop);
/** The browser can be granted a folder to search (Chrome / Edge) */
export const canPickFolder = () => typeof w.showDirectoryPicker === 'function';

const MAX_DEPTH = 8;
const MAX_DUT_FILES = 500;
const SKIP_DIRS = new Set(['node_modules', '_boot', '_compileinfo', '_libraries', '_deployment', 'bin', 'obj']);

// Web: the last .TcPOU picked and the folder the user granted, reused while later POUs are inside it
let lastPouHandle: FsFileHandle | null = null;
let grantedFolder: FsDirectoryHandle | null = null;
/** The .TcDUT files found in the granted folder, by relative path: they can be written back */
const dutHandles = new Map<string, FsFileHandle>();

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

async function readCandidates(dir: FsDirectoryHandle, at = ''): Promise<DutCandidate[]> {
  const found: DutCandidate[] = [];
  async function walk(d: FsDirectoryHandle, prefix: string, depth: number) {
    if (depth > MAX_DEPTH || found.length >= MAX_DUT_FILES) return;
    const subDirs: FsDirectoryHandle[] = [];
    for await (const entry of d.values()) {
      if (found.length >= MAX_DUT_FILES) return;
      if (entry.kind === 'directory') {
        if (!entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name.toLowerCase())) subDirs.push(entry);
      } else if (entry.name.toLowerCase().endsWith('.tcdut')) {
        try {
          found.push({ name: entry.name, relativePath: prefix + entry.name, content: await (await entry.getFile()).text() });
          dutHandles.set(prefix + entry.name, entry);
        } catch {
          // unreadable file
        }
      }
    }
    for (const sub of subDirs.sort((a, b) => a.name.localeCompare(b.name))) {
      await walk(sub, `${prefix}${sub.name}/`, depth + 1);
    }
  }
  await walk(dir, at, 0);
  return found;
}

/** The granted folder's subfolder that holds the .TcPOU, or null when the POU is outside the granted folder */
async function pouFolderInGrant(pou: FsFileHandle): Promise<FsDirectoryHandle | null> {
  if (!grantedFolder) return null;
  try {
    const parts = await grantedFolder.resolve(pou);
    if (!parts) return null;
    let dir = grantedFolder;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return dir;
  } catch {
    return null;
  }
}

function pickWithInput(accept: string, multiple: boolean): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = (files: File[] | null) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(input.files && input.files.length ? Array.from(input.files) : null));
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

const PLAIN_PICKER_KEY = 'kss.web.plainPicker';
/** This browser refused to read a file it let the user pick: the plain file chooser is used instead (kept here) */
const usesPlainPicker = () => {
  try {
    return localStorage.getItem(PLAIN_PICKER_KEY) === '1';
  } catch {
    return false;
  }
};
/** The message when the browser refuses to read the file picked */
export const PICKED_FILE_REFUSED =
  'This browser refused to read the file you picked (its file access is blocked for this page, e.g. by a policy or a site setting). Click Browse again: the plain file chooser opens instead. Saving then downloads the file.';

/** A picked file read; the browser refusing (NotAllowedError): its read permission asked for, else the plain chooser next */
async function readPicked(handle: FsFileHandle): Promise<File> {
  try {
    return await handle.getFile();
  } catch (e) {
    if (!(e instanceof DOMException) || e.name !== 'NotAllowedError') throw e;
    const permission = await handle.requestPermission?.({ mode: 'read' }).catch(() => 'denied' as const);
    if (permission === 'granted') {
      try {
        return await handle.getFile();
      } catch {
        // (refused still)
      }
    }
    try {
      localStorage.setItem(PLAIN_PICKER_KEY, '1');
    } catch {
      // (this session: the next Browse still asks the same way)
    }
    throw new Error(PICKED_FILE_REFUSED);
  }
}

/** Browse for a .TcPOU. Resolves null when the user cancels */
export async function browseForPou(): Promise<PouSource | null> {
  if (w.tcDesktop) return w.tcDesktop.openPou();

  if (typeof w.showOpenFilePicker === 'function' && !usesPlainPicker()) {
    let handles: FsFileHandle[];
    try {
      handles = await w.showOpenFilePicker({
        id: 'tc-pou',
        multiple: false,
        types: [{ description: 'TwinCAT Function Block', accept: { 'application/xml': ['.TcPOU'] } }],
      });
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
    const handle = handles[0];
    const file = await readPicked(handle);
    lastPouHandle = handle;
    const folder = await pouFolderInGrant(handle);
    return { name: file.name, content: await file.text(), dutCandidates: folder ? await readCandidates(folder) : null };
  }

  const files = await pickWithInput('.TcPOU', false);
  if (!files) return null;
  lastPouHandle = null;
  return { name: files[0].name, content: await files[0].text(), dutCandidates: null };
}

/** What was dropped: files with their handles (asked for during the drop), maybe a folder */
export interface DroppedItem {
  file: File | null;
  handle: Promise<unknown> | null;
}

/**
 * A drop on the Function Block box: a .TcPOU (and its enum: a .TcDUT dropped with it, the folder it is in when that
 * folder was granted, dropped or picked before), or a folder (granted: searched for its .TcPOU, the only one there,
 * and its enums). Null: no .TcPOU in it; { several }: a folder with several (the user picks one: its enum found then)
 */
export async function readDrop(items: DroppedItem[]): Promise<PouSource | { several: string[] } | null> {
  // (inside another app, its handles cannot be read: the dropped files themselves only)
  const handles = isEmbeddedBrowser ? items.map(() => null) : await Promise.all(items.map((i) => (i.handle ? i.handle.catch(() => null) : Promise.resolve(null))));
  const pouAt = items.findIndex((i) => !!i.file && /\.tcpou$/i.test(i.file.name));
  const duts = items.filter((i) => i.file && /\.tcdut$/i.test(i.file.name)).map((i) => i.file!);
  const folder = handles.find((h): h is FsDirectoryHandle => !!h && (h as FsHandle).kind === 'directory') ?? null;
  if (pouAt >= 0) {
    const file = items[pouAt].file!;
    const h = handles[pouAt] as FsFileHandle | null;
    lastPouHandle = h && h.kind === 'file' && typeof h.getFile === 'function' ? h : null;
    if (folder) grantedFolder = folder;
    const content = await file.text();
    // (its enum: dropped with it; else its folder's, when granted)
    if (duts.length) return { name: file.name, content, dutCandidates: await Promise.all(duts.map(async (f) => ({ name: f.name, relativePath: f.name, content: await f.text() }))) };
    const inGrant = lastPouHandle ? await pouFolderInGrant(lastPouHandle) : null;
    return { name: file.name, content, dutCandidates: inGrant ? await readCandidates(inGrant) : null };
  }
  if (!folder) return null;
  // A folder: granted; its .TcPOU files (in it and below)
  grantedFolder = folder;
  const pous: FsFileHandle[] = [];
  async function walk(d: FsDirectoryHandle, depth: number) {
    if (depth > MAX_DEPTH || pous.length > 50) return;
    for await (const entry of d.values()) {
      if (entry.kind === 'directory') {
        if (!entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name.toLowerCase())) await walk(entry, depth + 1);
      } else if (/\.tcpou$/i.test(entry.name)) pous.push(entry);
    }
  }
  await walk(folder, 0);
  if (pous.length !== 1) return pous.length ? { several: pous.map((x) => x.name).sort() } : null;
  const file = await pous[0].getFile();
  lastPouHandle = pous[0];
  const inGrant = await pouFolderInGrant(pous[0]);
  return { name: file.name, content: await file.text(), dutCandidates: await readCandidates(inGrant ?? folder) };
}

/**
 * Web: asks for read access to the .TcPOU's folder (the picker opens there) and searches it and its subfolders.
 * Without folder access in this browser, lets the user pick .TcDUT files instead. Resolves null on cancel.
 */
export async function findDutCandidates(): Promise<DutCandidate[] | null> {
  if (typeof w.showDirectoryPicker === 'function') {
    try {
      const dir = await w.showDirectoryPicker({ id: 'tc-pou-folder', mode: 'read', startIn: lastPouHandle ?? undefined });
      grantedFolder = dir;
      // If the user picked a parent of the POU's folder, still search only the POU's folder tree
      const pouFolder = lastPouHandle ? await pouFolderInGrant(lastPouHandle) : null;
      return readCandidates(pouFolder ?? dir);
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }
  return chooseDutFiles();
}

/** Lets the user pick one or more .TcDUT files directly */
export async function chooseDutFiles(): Promise<DutCandidate[] | null> {
  const files = await pickWithInput('.TcDUT', true);
  if (!files) return null;
  return Promise.all(files.map(async (f) => ({ name: f.name, relativePath: f.name, content: await f.text() })));
}

// ---- Saving (web) ----

/** Whether this browser can write a file back (the File System Access API: Chrome / Edge) */
export const canWriteBack = () => typeof w.showOpenFilePicker === 'function';

const hasBom = async (file: File) => {
  const b = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  return b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
};

export type WebSaveResult = 'saved' | 'conflict' | 'no-handle' | 'denied';

/**
 * Writes a source back to the file it was read from: the .TcPOU picked with Browse, or a .TcDUT found in the granted
 * folder. conflict: the file changed since it was read (its baseline), unless force. The BOM it had is kept.
 */
export async function writeWebSource(kind: 'pou' | 'dut', relativePath: string | undefined, content: string, baseline: string | null, force: boolean): Promise<WebSaveResult> {
  const handle = kind === 'pou' ? lastPouHandle : relativePath ? dutHandles.get(relativePath) : undefined;
  if (!handle?.createWritable) return 'no-handle';
  let permission = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt';
  if (permission !== 'granted') permission = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
  if (permission !== 'granted') return 'denied';
  const file = await handle.getFile();
  if (!force && baseline !== null && (await file.text()) !== baseline) return 'conflict';
  const bom = file.size === 0 || (await hasBom(file));
  const writable = await handle.createWritable();
  await writable.write((bom ? '\ufeff' : '') + content);
  await writable.close();
  return 'saved';
}

/** A source downloaded (the browser cannot write it back): with a BOM, as TwinCAT writes them */
export function downloadSource(name: string, content: string) {
  const blob = new Blob(['\ufeff' + content], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---- The project's other POUs (web): a name's uses, written back (rename across POUs) ----

/** The other .TcPOU files read from the granted folder, by relative path: they can be written back */
const pouHandles = new Map<string, FsFileHandle>();

/**
 * Web: the project's other .TcPOU files that mention the name (as a word), from the granted folder (asked for once,
 * read and write). { error: 'canceled' } when the user cancels; the loaded POU itself is left out.
 */
export async function webProjectUses(name: string): Promise<{ files?: { name: string; path: string; content: string }[]; error?: string }> {
  if (typeof w.showDirectoryPicker !== 'function') return { error: 'this browser cannot open a project folder (Chrome or Edge can)' };
  if (!grantedFolder) {
    try {
      grantedFolder = await w.showDirectoryPicker({ id: 'tc-project', mode: 'readwrite', startIn: lastPouHandle ?? undefined });
    } catch (e) {
      return { error: isAbort(e) ? 'canceled' : String(e) };
    }
  }
  const word = new RegExp(`(^|[^\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'i');
  const files: { name: string; path: string; content: string }[] = [];
  const self = lastPouHandle as (FsFileHandle & { isSameEntry?: (o: FsHandle) => Promise<boolean> }) | null;
  async function walk(d: FsDirectoryHandle, prefix: string, depth: number) {
    if (depth > MAX_DEPTH || files.length >= 400) return;
    for await (const entry of d.values()) {
      if (entry.kind === 'directory') {
        if (!entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name.toLowerCase())) await walk(entry, `${prefix}${entry.name}/`, depth + 1);
      } else if (entry.name.toLowerCase().endsWith('.tcpou')) {
        try {
          if (self?.isSameEntry && (await self.isSameEntry(entry))) continue;
          const content = (await (await entry.getFile()).text()).replace(/^\ufeff/, '');
          if (!word.test(content)) continue;
          files.push({ name: entry.name, path: prefix + entry.name, content });
          pouHandles.set(prefix + entry.name, entry);
        } catch {
          // unreadable file
        }
      }
    }
  }
  await walk(grantedFolder, '', 0);
  return { files };
}

/** Web: a project folder was granted (a base POU can be looked for without asking) */
export const webHasProjectFolder = () => !!grantedFolder;

/**
 * Web: a POU of the project by type name (a base the loaded POU EXTENDS), read only, with the .TcDUT files of its
 * folder; from the granted folder (asked for when ask, which needs a click: { error: 'needs-folder' } otherwise)
 */
export async function webFindPou(typeName: string, ask: boolean): Promise<PouSource | { error: string }> {
  if (!grantedFolder) {
    if (!ask) return { error: 'needs-folder' };
    if (typeof w.showDirectoryPicker !== 'function') return { error: 'this browser cannot open a project folder (Chrome or Edge can)' };
    try {
      grantedFolder = await w.showDirectoryPicker({ id: 'tc-project', mode: 'readwrite', startIn: lastPouHandle ?? undefined });
    } catch (e) {
      return { error: isAbort(e) ? 'canceled' : String(e) };
    }
  }
  const wanted = `${typeName}.tcpou`.toLowerCase();
  async function find(d: FsDirectoryHandle, prefix: string, depth: number): Promise<{ file: FsFileHandle; dir: FsDirectoryHandle; prefix: string } | null> {
    if (depth > MAX_DEPTH) return null;
    const subDirs: FsDirectoryHandle[] = [];
    for await (const entry of d.values()) {
      if (entry.kind === 'directory') {
        if (!entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name.toLowerCase())) subDirs.push(entry);
      } else if (entry.name.toLowerCase() === wanted) return { file: entry, dir: d, prefix };
    }
    for (const sub of subDirs) {
      const hit = await find(sub, `${prefix}${sub.name}/`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const hit = await find(grantedFolder, '', 0);
  if (!hit) return { error: `${typeName}.TcPOU was not found in the folder ${grantedFolder.name}` };
  try {
    const content = (await (await hit.file.getFile()).text()).replace(/^﻿/, '');
    return { name: hit.file.name, content, dutCandidates: await readCandidates(hit.dir, hit.prefix) };
  } catch (e) {
    return { error: `${typeName}.TcPOU could not be read: ${String(e)}` };
  }
}

/** Web: the other POUs written back (each only if it did not change since it was read); what went wrong, or null */
export async function writeWebOtherPous(files: { path: string; content: string; baseline: string }[]): Promise<string | null> {
  const problems: string[] = [];
  for (const f of files) {
    const handle = pouHandles.get(f.path);
    if (!handle?.createWritable) {
      problems.push(`${f.path}: not read from the project folder`);
      continue;
    }
    let permission = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt';
    if (permission !== 'granted') permission = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
    if (permission !== 'granted') {
      problems.push(`${f.path}: not allowed to write`);
      continue;
    }
    const file = await handle.getFile();
    if ((await file.text()).replace(/^\ufeff/, '') !== f.baseline) {
      problems.push(`${f.path} changed since it was read`);
      continue;
    }
    const bom = file.size === 0 || (await hasBom(file));
    const writable = await handle.createWritable();
    await writable.write((bom ? '\ufeff' : '') + f.content);
    await writable.close();
  }
  return problems.length ? problems.join('; ') : null;
}

// ---- Build from the project (web, through Link): the TwinCAT project's folder (the one with the .tsproj) ----

interface FsWritableDirectory {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirectoryHandle & FsWritableDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>;
  queryPermission?(options: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?(options: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
}
type ProjectDir = FsDirectoryHandle & FsWritableDirectory;
/** The TwinCAT project's folder granted for builds (read and write: the new compile information goes back into it) */
let projectRoot: ProjectDir | null = null;
// (what XAE makes or keeps for itself: not sent; _CompileInfo is: the online change needs it)
const PROJECT_SKIP = new Set(['.git', '.vs', '_boot', 'node_modules']);
const PROJECT_MAX_FILES = 20000;

export interface WebProjectFile {
  path: string;
  size: number;
  mtime: number;
  read: () => Promise<ArrayBuffer>;
}

/**
 * Web: the TwinCAT project's folder (asked for once: the folder with the .tsproj, read and write), its files listed,
 * this POU and its enum found in it (the file picked from inside it, else by name). { error: 'canceled' } when the
 * user cancels
 */
export async function webProjectFolder(pouName: string, dutName?: string): Promise<{ name: string; files: WebProjectFile[]; pouPath: string | null; dutPath: string | null } | { error: string }> {
  if (typeof w.showDirectoryPicker !== 'function') return { error: 'this browser cannot open a project folder (Chrome or Edge can)' };
  if (!projectRoot) {
    try {
      const dir = (await w.showDirectoryPicker({ id: 'tc-project-root', mode: 'readwrite', startIn: lastPouHandle ?? undefined })) as ProjectDir;
      let tsproj = false;
      for await (const e of dir.values()) if (e.kind === 'file' && /\.tsproj$/i.test(e.name)) tsproj = true;
      if (!tsproj) return { error: `${dir.name} has no .tsproj: choose the TwinCAT project's folder (the one with the .tsproj, above the PLC project)` };
      projectRoot = dir;
    } catch (e) {
      return { error: isAbort(e) ? 'canceled' : String(e) };
    }
  }
  const files: WebProjectFile[] = [];
  async function walk(d: FsDirectoryHandle, prefix: string, depth: number) {
    if (depth > 12 || files.length >= PROJECT_MAX_FILES) return;
    for await (const entry of d.values()) {
      if (entry.kind === 'directory') {
        if (!PROJECT_SKIP.has(entry.name.toLowerCase())) await walk(entry, `${prefix}${entry.name}/`, depth + 1);
      } else if (!/\.kss-part$|~$/i.test(entry.name)) {
        const f = await entry.getFile();
        files.push({ path: prefix + entry.name, size: f.size, mtime: f.lastModified, read: async () => (await entry.getFile()).arrayBuffer() });
      }
    }
  }
  await walk(projectRoot, '', 0);
  const byName = (name?: string) => (name ? files.filter((f) => f.path.split('/').pop()!.toLowerCase() === name.toLowerCase()) : []);
  let pouPath: string | null = null;
  const inside = lastPouHandle ? await projectRoot.resolve(lastPouHandle).catch(() => null) : null;
  if (inside?.length) pouPath = inside.join('/');
  else pouPath = byName(pouName)[0]?.path ?? null;
  const pouDir = pouPath ? pouPath.split('/').slice(0, -1).join('/') : '';
  // (the enum: the one nearest the POU, by its name)
  const duts = byName(dutName).sort((a, b) => Number(b.path.startsWith(pouDir.split('/')[0] ?? '')) - Number(a.path.startsWith(pouDir.split('/')[0] ?? '')));
  return { name: projectRoot.name, files, pouPath, dutPath: duts[0]?.path ?? null };
}

/** Web: a file written into the granted project folder (its folders made); what went wrong, or null */
export async function writeWebProjectFile(relPath: string, data: Uint8Array<ArrayBuffer>): Promise<string | null> {
  if (!projectRoot) return 'No project folder granted';
  let permission = (await projectRoot.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt';
  if (permission !== 'granted') permission = (await projectRoot.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
  if (permission !== 'granted') return `${relPath}: not allowed to write`;
  const parts = relPath.split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p === '..' || p === '.')) return `${relPath}: not a path in the project`;
  let dir: ProjectDir = projectRoot;
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
  const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  if (!handle.createWritable) return `${relPath}: this browser cannot write files`;
  const writable = await handle.createWritable();
  await writable.write(new Blob([data]));
  await writable.close();
  return null;
}

/** Web: the project folder asked for again next time (another project) */
export function forgetWebProjectFolder() {
  projectRoot = null;
}

// ---- The POU's layout file (web): <POU>.machinescope.json in the POU's own folder, for git ----
// The folder: a granted project folder that holds the POU, else one the user picks for it (the POU's folder, or one
// above it). Only while this page is open: picked again after a reload.
let layoutFolder: { dir: ProjectDir; sub: string[] } | null = null;
type RemovableDir = ProjectDir & { removeEntry?(name: string): Promise<void> };

/** Where the POU (its file handle) is under a folder: its folders down to it, or null when it is not there */
async function pouFolderIn(dir: ProjectDir, pouName: string): Promise<string[] | null> {
  if (lastPouHandle) {
    const parts = await dir.resolve(lastPouHandle).catch(() => null);
    if (parts?.length) return parts.slice(0, -1);
  }
  // (no handle of it: by its name, right in that folder)
  for await (const e of dir.values()) if (e.kind === 'file' && e.name.toLowerCase() === pouName.toLowerCase()) return [];
  return null;
}

/** The web edition can keep the POU's layout file (a folder that holds it is granted) */
export async function webLayoutReady(pouName: string): Promise<boolean> {
  if (layoutFolder && (await pouFolderIn(layoutFolder.dir, pouName)) !== null) return true;
  if (projectRoot) {
    const sub = await pouFolderIn(projectRoot, pouName);
    if (sub) {
      layoutFolder = { dir: projectRoot, sub };
      return true;
    }
  }
  return false;
}

/** A folder picked for the POU's layout file (the POU's own, or one above it): null, or what went wrong */
export async function pickWebLayoutFolder(pouName: string): Promise<string | null> {
  if (typeof w.showDirectoryPicker !== 'function') return 'This browser cannot open a folder (Chrome or Edge can)';
  try {
    const dir = (await w.showDirectoryPicker({ id: 'kms-layout', mode: 'readwrite', startIn: lastPouHandle ?? undefined })) as ProjectDir;
    const sub = await pouFolderIn(dir, pouName);
    if (!sub) return `${pouName} is not in ${dir.name}: choose the folder it is in (or one above it)`;
    layoutFolder = { dir, sub };
    return null;
  } catch (e) {
    return isAbort(e) ? 'canceled' : String(e);
  }
}

async function layoutDir(write: boolean): Promise<RemovableDir | string> {
  if (!layoutFolder) return 'No folder for it';
  let permission = (await layoutFolder.dir.queryPermission?.({ mode: write ? 'readwrite' : 'read' })) ?? 'prompt';
  if (permission !== 'granted') permission = (await layoutFolder.dir.requestPermission?.({ mode: write ? 'readwrite' : 'read' })) ?? 'denied';
  if (permission !== 'granted') return 'Not allowed to use that folder';
  let dir: ProjectDir = layoutFolder.dir;
  for (const p of layoutFolder.sub) dir = (await dir.getDirectoryHandle(p)) as ProjectDir;
  return dir as RemovableDir;
}

/** The layout file's text: { text } (null: none yet) or { error } */
export async function readWebLayout(fileName: string): Promise<{ text?: string | null; error?: string }> {
  try {
    const dir = await layoutDir(false);
    if (typeof dir === 'string') return { error: dir };
    const handle = await dir.getFileHandle(fileName).catch(() => null);
    return { text: handle ? await (await handle.getFile()).text() : null };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Written (null: removed): { written } or { error } */
export async function writeWebLayout(fileName: string, text: string | null): Promise<{ written?: boolean; error?: string }> {
  try {
    const dir = await layoutDir(true);
    if (typeof dir === 'string') return { error: dir };
    if (text === null) {
      if (!dir.removeEntry) return { error: 'This browser cannot remove files' };
      await dir.removeEntry(fileName).catch(() => {});
      return { written: true };
    }
    const handle = await dir.getFileHandle(fileName, { create: true });
    if (!handle.createWritable) return { error: 'This browser cannot write files' };
    const old = await (await handle.getFile()).text().catch(() => null);
    if (old === text) return { written: false };
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return { written: true };
  } catch (e) {
    return { error: String(e) };
  }
}
