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
const w = window as unknown as FsAccessWindow;

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

async function readCandidates(dir: FsDirectoryHandle): Promise<DutCandidate[]> {
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
  await walk(dir, '', 0);
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

/** Browse for a .TcPOU. Resolves null when the user cancels */
export async function browseForPou(): Promise<PouSource | null> {
  if (w.tcDesktop) return w.tcDesktop.openPou();

  if (typeof w.showOpenFilePicker === 'function') {
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
    lastPouHandle = handle;
    const file = await handle.getFile();
    const folder = await pouFolderInGrant(handle);
    return { name: file.name, content: await file.text(), dutCandidates: folder ? await readCandidates(folder) : null };
  }

  const files = await pickWithInput('.TcPOU', false);
  if (!files) return null;
  lastPouHandle = null;
  return { name: files[0].name, content: await files[0].text(), dutCandidates: null };
}

/**
 * A .TcPOU dropped on the page (no folder access: the enum is found with findDutCandidates); with its file handle
 * (Chrome / Edge) it can be written back
 */
export async function readDroppedPou(file: File, handle?: unknown): Promise<PouSource> {
  const h = handle as FsFileHandle | null | undefined;
  lastPouHandle = h && h.kind === 'file' && typeof h.getFile === 'function' ? h : null;
  return { name: file.name, content: await file.text(), dutCandidates: null };
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
