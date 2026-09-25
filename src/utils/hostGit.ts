/**
 * The committed (git HEAD) version of a loaded file, from the host: the TwinCAT XAE extension or the desktop app
 * run "git show HEAD:<file>" in the file's folder. The web edition has no git access.
 */

import { isXaeHost, onHostMessage, postToHost } from './xaeHost.ts';

interface DesktopGitApi {
  gitShow: (path: string) => Promise<{ content?: string; error?: string }>;
}
const desktopGit = (): DesktopGitApi | null => {
  const d = (window as unknown as { tcDesktop?: Partial<DesktopGitApi> }).tcDesktop;
  return d?.gitShow ? (d as DesktopGitApi) : null;
};

export const canReadGitVersions = () => isXaeHost() || !!desktopGit();

let nextRequest = 1;

export function fetchCommittedVersion(path: string): Promise<{ content?: string; error?: string }> {
  const desktop = desktopGit();
  if (desktop) return desktop.gitShow(path);
  if (!isXaeHost()) return Promise.resolve({ error: 'The committed version needs the desktop app or TwinCAT XAE' });
  const requestId = nextRequest++;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      off();
      resolve({ error: 'No answer from the extension' });
    }, 15000);
    const off = onHostMessage((m) => {
      if (m.type !== 'gitShowResult' || m.requestId !== requestId) return;
      window.clearTimeout(timer);
      off();
      resolve({ content: m.content ?? undefined, error: m.error ?? undefined });
    });
    postToHost({ type: 'gitShow', path, requestId });
  });
}
