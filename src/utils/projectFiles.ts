/**
 * The PLC project's state machine POUs and enums (for the project documentation), and saving a document, from
 * the host: the TwinCAT XAE extension or the desktop app read the loaded POU's PLC project folder; the web
 * edition asks for a folder (Chromium) instead.
 */

import type { ProjectFiles } from './projectDocumentation.ts';
import { isXaeHost, onHostMessage, postToHost } from './xaeHost.ts';
import { triggerDownload } from './diagramExport.ts';

interface DesktopProjectApi {
  projectPous: (fromPath: string) => Promise<ProjectFiles & { error?: string }>;
  saveFile: (name: string, content: string) => Promise<{ path?: string; error?: string; canceled?: boolean }>;
}
const desktop = (): Partial<DesktopProjectApi> | null =>
  (window as unknown as { tcDesktop?: Partial<DesktopProjectApi> }).tcDesktop ?? null;

function hostRequest<T>(message: Parameters<typeof postToHost>[0], replyType: string, timeoutMs: number): Promise<T | { error: string }> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      off();
      resolve({ error: 'No answer from the extension' });
    }, timeoutMs);
    const off = onHostMessage((m) => {
      if (m.type !== replyType) return;
      window.clearTimeout(timer);
      off();
      resolve(m as unknown as T);
    });
    postToHost(message);
  });
}

type DirHandle = { name: string; values: () => AsyncIterable<{ kind: 'file' | 'directory'; name: string; getFile?: () => Promise<File> } & DirHandle> };

async function readFolder(): Promise<ProjectFiles | { error: string }> {
  const picker = (window as unknown as { showDirectoryPicker?: (o: unknown) => Promise<DirHandle> }).showDirectoryPicker;
  if (!picker) return { error: 'Choosing a project folder needs Chrome or Edge (or the desktop app / TwinCAT XAE)' };
  let root: DirHandle;
  try {
    root = await picker({ id: 'tc-project', mode: 'read' });
  } catch {
    return { error: 'canceled' };
  }
  const pous: ProjectFiles['pous'] = [];
  const duts: ProjectFiles['duts'] = [];
  const skip = /^(_boot|_compileinfo|_libraries|_deployment|node_modules|\..*)$/i;
  const walk = async (dir: DirHandle, rel: string, depth: number) => {
    if (depth > 12 || pous.length + duts.length > 5000) return;
    for await (const entry of dir.values()) {
      if (entry.kind === 'directory') {
        if (!skip.test(entry.name)) await walk(entry, `${rel}${entry.name}/`, depth + 1);
      } else if (/\.tc(pou|dut)$/i.test(entry.name) && entry.getFile) {
        const content = (await (await entry.getFile()).text()).replace(/^﻿/, '');
        if (/\.tcpou$/i.test(entry.name)) pous.push({ name: entry.name, path: rel + entry.name, content });
        else duts.push({ name: entry.name, relativePath: rel + entry.name, content });
      }
    }
  };
  await walk(root, '', 0);
  return { project: root.name, pous, duts };
}

/** The project's .TcPOU and .TcDUT files; { error: 'canceled' } when the user cancels */
export async function loadProjectFiles(pouPath?: string): Promise<ProjectFiles | { error: string }> {
  if (isXaeHost()) return hostRequest<ProjectFiles>({ type: 'projectPous' }, 'projectPous', 120000);
  const d = desktop();
  if (d?.projectPous && pouPath) return d.projectPous(pouPath);
  return readFolder();
}

/** Saves the document: a save dialog (XAE, desktop) or a download (web). Resolves with where it went */
export async function saveDocument(name: string, content: string): Promise<{ path?: string; error?: string; canceled?: boolean }> {
  if (isXaeHost()) return hostRequest<{ path?: string; error?: string; canceled?: boolean }>({ type: 'saveDocument', name, content }, 'saveDocumentResult', 600000);
  const d = desktop();
  if (d?.saveFile) return d.saveFile(name, content);
  triggerDownload(new Blob([content], { type: 'text/html;charset=utf-8' }), name);
  return { path: name };
}
