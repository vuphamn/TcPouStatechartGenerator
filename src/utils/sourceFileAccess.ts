import { DutCandidate } from './dutMatcher.ts';

/** A loaded .TcPOU. `dutCandidates` is null when its folder could not be searched (yet) */
export interface PouSource {
  name: string;
  content: string;
  /** Full path (desktop app only) */
  path?: string;
  dutCandidates: DutCandidate[] | null;
}

// File System Access API (Chromium browsers): only the parts used here
interface FsHandle {
  kind: 'file' | 'directory';
  name: string;
}
interface FsFileHandle extends FsHandle {
  kind: 'file';
  getFile(): Promise<File>;
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

/** A .TcPOU dropped on the page (no folder access: the enum is found with findDutCandidates) */
export async function readDroppedPou(file: File): Promise<PouSource> {
  lastPouHandle = null;
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
