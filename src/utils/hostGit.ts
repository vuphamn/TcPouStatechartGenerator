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

export interface FileCommit {
  hash: string;
  date: string;
  author: string;
  subject: string;
  /** The file's path then, from the repository's root */
  file: string;
}

interface DesktopGitHistoryApi {
  gitLog: (path: string) => Promise<{ commits?: FileCommit[]; error?: string }>;
  gitShowAt: (path: string, hash: string, file: string) => Promise<{ content?: string; error?: string }>;
}
const desktopGitHistory = (): DesktopGitHistoryApi | null => {
  const d = (window as unknown as { tcDesktop?: Partial<DesktopGitHistoryApi> }).tcDesktop;
  return d?.gitLog && d.gitShowAt ? (d as DesktopGitHistoryApi) : null;
};

/** (a host request answered with the same requestId: its answer, or no answer in time) */
function askHost(post: (requestId: number) => void, answer: 'gitLogResult' | 'gitShowAtResult', timeoutMs = 20000): Promise<Record<string, unknown>> {
  const requestId = nextRequest++;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      off();
      resolve({ error: 'No answer from the extension' });
    }, timeoutMs);
    const off = onHostMessage((m) => {
      if (m.type !== answer || m.requestId !== requestId) return;
      window.clearTimeout(timer);
      off();
      resolve(m as unknown as Record<string, unknown>);
    });
    post(requestId);
  });
}

/** The commits that changed a loaded file, newest first (renames followed) */
export async function fetchFileLog(path: string): Promise<{ commits?: FileCommit[]; error?: string }> {
  const desktop = desktopGitHistory();
  if (desktop) return desktop.gitLog(path);
  if (!isXaeHost()) return { error: 'The history needs the desktop app, TwinCAT XAE or VS Code' };
  const m = await askHost((requestId) => postToHost({ type: 'gitLog', path, requestId }), 'gitLogResult');
  return { commits: (m.commits as FileCommit[] | null | undefined) ?? undefined, error: (m.error as string | null | undefined) ?? undefined };
}

/** A loaded file as it was in a commit (its path then: FileCommit.file) */
export async function fetchFileAt(path: string, hash: string, file: string): Promise<{ content?: string; error?: string }> {
  const desktop = desktopGitHistory();
  if (desktop) return desktop.gitShowAt(path, hash, file);
  if (!isXaeHost()) return { error: 'The history needs the desktop app, TwinCAT XAE or VS Code' };
  const m = await askHost((requestId) => postToHost({ type: 'gitShowAt', path, hash, file, requestId }), 'gitShowAtResult');
  return { content: (m.content as string | null | undefined) ?? undefined, error: (m.error as string | null | undefined) ?? undefined };
}
