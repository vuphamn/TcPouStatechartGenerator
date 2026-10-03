/**
 * A POU's layout file (<POU>.machinescope.json beside it) through the host that has the POU's folder: the desktop app
 * (IPC), the XAE extension (messages), Link (its connection: a POU of a PLC project it keeps), the web edition with
 * a folder granted that holds the POU (File System Access: its path given as web:<POU file name>). Else the layout
 * stays in this browser.
 */
import { layoutFileNameOf } from './pouLayout.ts';
import { readWebLayout, writeWebLayout } from './sourceFileAccess.ts';
import { isXaeHost, onHostMessage, postToHost } from './xaeHost.ts';

/** The web edition's POU, its folder granted: its layout file's "path" */
export const WEB_LAYOUT_PREFIX = 'web:';
const webFileOf = (pouPath: string) => layoutFileNameOf(pouPath.slice(WEB_LAYOUT_PREFIX.length));

type DesktopLayout = { readLayout?: (p: string) => Promise<{ text?: string | null; error?: string }>; writeLayout?: (p: string, t: string | null) => Promise<{ written?: boolean; error?: string }> };
const desktopLayout = (): DesktopLayout | null => {
  const d = (window as unknown as { tcDesktop?: DesktopLayout }).tcDesktop;
  return d?.readLayout && d.writeLayout ? d : null;
};

/** Link's request (the app's connection to it), when the POU came from it */
export type LinkRequest = <T>(message: Record<string, unknown>, answer: string, timeoutMs: number) => Promise<T>;

/** Where the layout file can be kept: 'desktop', 'xae', 'link', 'web', or null (this browser only) */
export function layoutHost(pouPath: string | undefined, link: LinkRequest | null): 'desktop' | 'xae' | 'link' | 'web' | null {
  if (!pouPath || !/\.TcPOU$/i.test(pouPath)) return null;
  if (pouPath.startsWith(WEB_LAYOUT_PREFIX)) return 'web';
  if (isXaeHost()) return 'xae';
  if (desktopLayout()) return 'desktop';
  if (link) return 'link';
  return null;
}

let nextRequest = 1;
function xaeLayout(message: { type: 'layoutRead' | 'layoutWrite'; path: string; text?: string | null }): Promise<{ text?: string | null; written?: boolean; error?: string }> {
  const requestId = nextRequest++;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      off();
      resolve({ error: 'No answer from the extension' });
    }, 10000);
    const off = onHostMessage((m) => {
      if (m.type !== 'layoutResult' || m.requestId !== requestId) return;
      window.clearTimeout(timer);
      off();
      resolve({ text: m.text, written: m.written, error: m.error ?? undefined });
    });
    postToHost(message.type === 'layoutRead' ? { type: 'layoutRead', path: message.path, requestId } : { type: 'layoutWrite', path: message.path, requestId, text: message.text ?? null });
  });
}

/** The layout file's text: { text } (null: none yet) or { error } */
export async function readLayoutFile(pouPath: string, link: LinkRequest | null): Promise<{ text?: string | null; error?: string }> {
  const host = layoutHost(pouPath, link);
  if (host === 'web') return readWebLayout(webFileOf(pouPath));
  if (host === 'xae') return xaeLayout({ type: 'layoutRead', path: pouPath });
  if (host === 'desktop') return desktopLayout()!.readLayout!(pouPath);
  if (host === 'link') return link!<{ text?: string | null; error?: string }>({ type: 'layoutFile', pou: pouPath }, 'layoutFileResult', 15000).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  return { error: 'No folder for it here' };
}

/** Written (null: removed): { written } or { error } */
export async function writeLayoutFile(pouPath: string, text: string | null, link: LinkRequest | null): Promise<{ written?: boolean; error?: string }> {
  const host = layoutHost(pouPath, link);
  if (host === 'web') return writeWebLayout(webFileOf(pouPath), text);
  if (host === 'xae') return xaeLayout({ type: 'layoutWrite', path: pouPath, text });
  if (host === 'desktop') return desktopLayout()!.writeLayout!(pouPath, text);
  if (host === 'link') return link!<{ written?: boolean; error?: string }>({ type: 'layoutFile', pou: pouPath, text }, 'layoutFileResult', 15000).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  return { error: 'No folder for it here' };
}
