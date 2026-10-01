// The I/O tree of a TwinCAT project folder chosen in the browser (offline; Chrome, Edge): its .tsproj found (in the
// folder or two levels down), its _Config's .xti files read, parsed by the same module as on the desktop
import { parseIoTreeWith } from '../../shared/ioTreeParse.mjs';
import type { IoTree } from '../components/IoTreePanel.tsx';

type Entry = { kind: 'file' | 'directory'; name: string; getFile?: () => Promise<File> } & Dir;
type Dir = { name: string; values: () => AsyncIterable<Entry> };

export const canPickIoFolder = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

const SKIP = /^(\.|_Boot$|node_modules$|_CompileInfo$|_Libraries$)/i;

/** A folder chosen, its project's I/O tree ({ canceled } when the user cancels) */
export async function readIoFolderInBrowser(): Promise<IoTree & { canceled?: boolean }> {
  const picker = (window as unknown as { showDirectoryPicker?: (o: unknown) => Promise<Dir> }).showDirectoryPicker;
  if (!picker) return { devices: [], links: [], error: 'Reading a project folder needs Chrome or Edge (or the desktop app)' };
  let root: Dir;
  try {
    root = await picker({ id: 'tc-io-project', mode: 'read' });
  } catch {
    return { devices: [], links: [], canceled: true };
  }
  // (the folder with the .tsproj: this one, or one below it)
  const find = async (d: Dir, depth: number, rel: string): Promise<{ dir: Dir; tsproj: string; rel: string } | null> => {
    const subs: Entry[] = [];
    for await (const e of d.values()) {
      if (e.kind === 'file' && /\.tsproj$/i.test(e.name)) return { dir: d, tsproj: e.name, rel };
      if (e.kind === 'directory' && !SKIP.test(e.name)) subs.push(e);
    }
    if (depth >= 2) return null;
    for (const s of subs) {
      const r = await find(s, depth + 1, `${rel}${s.name}/`);
      if (r) return r;
    }
    return null;
  };
  const at = await find(root, 0, '');
  if (!at) return { devices: [], links: [], folder: root.name, error: 'No TwinCAT project (.tsproj) in that folder' };
  let config: Dir | null = null;
  for await (const e of at.dir.values()) if (e.kind === 'directory' && e.name === '_Config') config = e;
  const files: Record<string, string> = {};
  let count = 0;
  const walk = async (d: Dir, rel: string, depth: number) => {
    if (depth > 6 || count > 400) return;
    for await (const e of d.values()) {
      if (e.kind === 'directory') await walk(e, `${rel}${e.name}/`, depth + 1);
      else if (/\.xti$/i.test(e.name) && e.getFile && count++ < 400) files[rel + e.name] = await (await e.getFile()).text();
    }
  };
  if (config) await walk(config, '_Config/', 0);
  const parser = new DOMParser();
  const tree = parseIoTreeWith(files, (t) => parser.parseFromString(t, 'text/xml'));
  const project = at.tsproj.replace(/\.tsproj$/i, '');
  const folder = `${root.name}/${at.rel}`.replace(/\/$/, '');
  if (!tree.devices.length) return { ...tree, project, folder, error: 'No I/O devices in that TwinCAT project (its _Config folder)' };
  return { ...tree, project, folder };
}
