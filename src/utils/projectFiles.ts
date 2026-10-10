/**
 * The PLC project's state machine POUs and enums (for the project documentation), and saving a document, from
 * the host: the TwinCAT XAE extension or the desktop app read the loaded POU's PLC project folder; the web
 * edition asks for a folder (Chromium) instead.
 */

import type { ProjectFiles } from './projectDocumentation.ts';
import { isXaeHost, onHostMessage, postToHost, type ProjectFileVersion } from './xaeHost.ts';
import { webFindPou, type PouSource } from './sourceFileAccess.ts';
import type { DutCandidate } from './dutMatcher.ts';
import { extendsOf, hasOwnMethod, pouNameOf, type InheritedSource } from './pouInheritance.ts';
import { triggerDownload } from './diagramExport.ts';

interface DesktopProjectApi {
  projectPous: (fromPath: string) => Promise<ProjectFiles & { error?: string }>;
  saveFile: (name: string, content: string, opts?: { personal?: boolean }) => Promise<{ path?: string; error?: string; canceled?: boolean }>;
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

/**
 * Saves the document: a save dialog (XAE, desktop) or a download (web). Resolves with where it went. personal (a live
 * recording): the dialog offers the user's own folder (Documents\Kval MachineScope\Recordings), not the project's:
 * it is not for git
 */
export async function saveDocument(name: string, content: string, opts: { personal?: boolean } = {}): Promise<{ path?: string; error?: string; canceled?: boolean }> {
  if (isXaeHost()) return hostRequest<{ path?: string; error?: string; canceled?: boolean }>({ type: 'saveDocument', name, content, ...(opts.personal ? { personal: true } : {}) }, 'saveDocumentResult', 600000);
  const d = desktop();
  if (d?.saveFile) return d.saveFile(name, content, opts);
  triggerDownload(new Blob([content], { type: /\.json$/i.test(name) ? 'application/json' : /\.csv$/i.test(name) ? 'text/csv;charset=utf-8' : 'text/html;charset=utf-8' }), name);
  return { path: name };
}

// ---- A POU of the project by type name (a base the loaded POU EXTENDS: its doState() and state methods) ----

let findSeq = 0;

/**
 * A POU of the loaded POU's PLC project by type name, read only, with the .TcDUT files of its folder: from TwinCAT
 * XAE / VS Code (findPou), the desktop app, or the web edition's granted folder (askFolder: the folder may be asked
 * for, which needs a click; else { error: 'needs-folder' })
 */
export async function findProjectPou(typeName: string, fromPath: string | undefined, askFolder: boolean): Promise<PouSource | { error: string }> {
  if (isXaeHost()) {
    const requestId = ++findSeq;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        off();
        resolve({ error: 'No answer from the extension (an older version?)' });
      }, 30000);
      const off = onHostMessage((m) => {
        if (m.type !== 'findPouResult' || m.requestId !== requestId) return;
        const r = m;
        window.clearTimeout(timer);
        off();
        resolve(r.source ?? { error: r.error ?? `${typeName}.TcPOU was not found` });
      });
      postToHost({ type: 'findPou', requestId, typeName });
    });
  }
  const d = (window as unknown as { tcDesktop?: { openPouInProject?: (from: string, type: string) => Promise<PouSource | { error: string }> } }).tcDesktop;
  if (d?.openPouInProject) return fromPath ? d.openPouInProject(fromPath, typeName) : { error: 'The POU was not opened from its folder' };
  return webFindPou(typeName, askFolder);
}

/**
 * The loaded POU's project files' TwinCAT version here and in git (XAE of another build converts them when it saves):
 * XAE, VS Code, the desktop app; null where it is not known (the web edition)
 */
export async function fetchProjectVersions(pouPath: string | undefined): Promise<{ files: ProjectFileVersion[]; converted: boolean } | null> {
  if (!pouPath) return null;
  if (isXaeHost()) {
    const requestId = ++findSeq;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        off();
        resolve(null);
      }, 30000);
      const off = onHostMessage((m) => {
        if (m.type !== 'projectVersionsResult' || m.requestId !== requestId) return;
        window.clearTimeout(timer);
        off();
        resolve({ files: m.files ?? [], converted: !!m.converted });
      });
      postToHost({ type: 'projectVersions', requestId });
    });
  }
  const d = (window as unknown as { tcDesktop?: { projectVersions?: (p: string) => Promise<{ files: ProjectFileVersion[]; converted: boolean }> } }).tcDesktop;
  return d?.projectVersions ? d.projectVersions(pouPath).catch(() => null) : null;
}

export type CoverageCounts = Record<string, { n: number; last: number }>;

/** A host request answered by its type and requestId (null: no answer in time) */
function hostAsk<T>(message: Record<string, unknown> & { type: string }, replyType: string, timeoutMs = 15000): Promise<T | null> {
  const requestId = ++findSeq;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      off();
      resolve(null);
    }, timeoutMs);
    const off = onHostMessage((m) => {
      if (m.type !== replyType || (m as { requestId?: number }).requestId !== requestId) return;
      window.clearTimeout(timer);
      off();
      resolve(m as unknown as T);
    });
    postToHost({ ...message, requestId } as Parameters<typeof postToHost>[0]);
  });
}

/**
 * The enum of a type anywhere in the PLC project (State : E_ScanState → E_ScanState.TcDUT): another company's POU
 * keeps it elsewhere. XAE, VS Code, the desktop app; null where it cannot be looked for (the web edition)
 */
export async function findProjectDut(typeName: string, pouPath: string | undefined): Promise<DutCandidate | null> {
  if (!/^[A-Za-z_]\w*$/.test(typeName)) return null;
  if (isXaeHost()) return (await hostAsk<{ dut?: DutCandidate }>({ type: 'findEnumType', typeName }, 'findEnumTypeResult'))?.dut ?? null;
  const d = (window as unknown as { tcDesktop?: { findEnumType?: (p: string, t: string) => Promise<DutCandidate | { error: string }> } }).tcDesktop;
  if (!d?.findEnumType || !pouPath) return null;
  const r = await d.findEnumType(pouPath, typeName).catch(() => null);
  return r && !('error' in r) ? r : null;
}

export interface ReportSettings {
  company?: string;
  machine?: string;
  /** A data URL */
  logo?: string;
  file?: string;
  error?: string;
}

/** The sign-off report's heading for the project (MachineScope.report.json beside it): XAE, VS Code, the desktop app */
export async function fetchReportSettings(pouPath: string | undefined): Promise<ReportSettings | null> {
  if (isXaeHost()) return hostAsk<ReportSettings>({ type: 'reportSettings' }, 'reportSettingsResult');
  const d = (window as unknown as { tcDesktop?: { reportSettings?: (p: string) => Promise<ReportSettings> } }).tcDesktop;
  return d?.reportSettings && pouPath ? d.reportSettings(pouPath).catch(() => null) : null;
}

export interface MachineScopeFiles {
  dir: string | null;
  git: boolean;
  files: { name: string; path: string; state: 'tracked' | 'ignored' | 'untracked' }[];
}

/** MachineScope's files beside the PLC project (builds, coverage) and how git sees them: XAE, VS Code, the desktop app */
export async function fetchMachineScopeFiles(pouPath: string | undefined): Promise<MachineScopeFiles | null> {
  if (isXaeHost()) return hostAsk<MachineScopeFiles>({ type: 'machineScopeFiles' }, 'machineScopeFilesResult');
  const d = (window as unknown as { tcDesktop?: { machineScopeFiles?: (p: string) => Promise<MachineScopeFiles> } }).tcDesktop;
  return d?.machineScopeFiles && pouPath ? d.machineScopeFiles(pouPath).catch(() => null) : null;
}

/** The untracked ones staged (git add) or ignored (.gitignore beside them) */
export async function machineScopeFilesAct(pouPath: string | undefined, action: 'add' | 'ignore'): Promise<{ ok: boolean; message: string } | null> {
  if (isXaeHost()) return hostAsk<{ ok: boolean; message: string }>({ type: 'machineScopeFilesAct', action }, 'machineScopeFilesActResult');
  const d = (window as unknown as { tcDesktop?: { machineScopeFilesAct?: (p: string, a: string) => Promise<{ ok: boolean; message: string }> } }).tcDesktop;
  return d?.machineScopeFilesAct && pouPath ? d.machineScopeFilesAct(pouPath, action).catch(() => null) : null;
}

/**
 * The coverage counts beside the PLC project (MachineScope.coverage.json): every POU type's (XAE, VS Code, the desktop
 * app); null where there is no file access (the web edition)
 */
export async function fetchCoverageFile(pouPath: string | undefined): Promise<Record<string, CoverageCounts> | null> {
  if (isXaeHost()) return (await hostAsk<{ pous: Record<string, CoverageCounts> }>({ type: 'coverageFile' }, 'coverageFileResult'))?.pous ?? null;
  const d = (window as unknown as { tcDesktop?: { coverageFile?: (p: string) => Promise<{ pous: Record<string, CoverageCounts> }> } }).tcDesktop;
  return d?.coverageFile && pouPath ? d.coverageFile(pouPath).then((r) => r.pous).catch(() => null) : null;
}

/** This POU type's counts merged into the project's file (the highest count wins): the type's counts there now */
export async function saveCoverageFile(pouPath: string | undefined, pouType: string, counts: CoverageCounts): Promise<CoverageCounts | null> {
  if (isXaeHost()) return (await hostAsk<{ counts?: CoverageCounts }>({ type: 'coverageFileSave', pouType, counts }, 'coverageFileSaveResult'))?.counts ?? null;
  const d = (window as unknown as { tcDesktop?: { coverageFileSave?: (p: string, t: string, c: CoverageCounts) => Promise<{ counts?: CoverageCounts }> } }).tcDesktop;
  return d?.coverageFileSave && pouPath ? d.coverageFileSave(pouPath, pouType, counts).then((r) => r.counts ?? null).catch(() => null) : null;
}

/**
 * The POU's project opened in the XAE of that TwinCAT version (its committed one: "3.1.4024.59"): XAE, VS Code, the
 * desktop app; null where it cannot be (the web edition)
 */
export async function openXaeFor(pouPath: string | undefined, version: string): Promise<{ ok: boolean; message: string } | null> {
  if (isXaeHost()) {
    const requestId = ++findSeq;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        off();
        resolve(null);
      }, 30000);
      const off = onHostMessage((m) => {
        if (m.type !== 'openXaeForResult' || m.requestId !== requestId) return;
        window.clearTimeout(timer);
        off();
        resolve({ ok: m.ok, message: m.message });
      });
      postToHost({ type: 'openXaeFor', requestId, version });
    });
  }
  const d = (window as unknown as { tcDesktop?: { openXaeFor?: (p: string, v: string) => Promise<{ ok: boolean; message: string }> } }).tcDesktop;
  return d?.openXaeFor && pouPath ? d.openXaeFor(pouPath, version).catch(() => null) : null;
}

/** The PLC project's builds here (its _CompileInfo), newest first: XAE, VS Code, the desktop app; null elsewhere */
export async function fetchProjectBuilds(pouPath: string | undefined): Promise<{ id: string; at: string }[] | null> {
  if (!pouPath) return null;
  if (isXaeHost()) {
    const requestId = ++findSeq;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        off();
        resolve(null);
      }, 15000);
      const off = onHostMessage((m) => {
        if (m.type !== 'projectBuildsResult' || m.requestId !== requestId) return;
        window.clearTimeout(timer);
        off();
        resolve(m.builds ?? []);
      });
      postToHost({ type: 'projectBuilds', requestId });
    });
  }
  const d = (window as unknown as { tcDesktop?: { projectBuilds?: (p: string) => Promise<{ id: string; at: string }[]> } }).tcDesktop;
  return d?.projectBuilds ? d.projectBuilds(pouPath).catch(() => null) : null;
}

/**
 * The project's .tsproj / .plcproj restored from git (HEAD): XAE, VS Code, the desktop app; null where it cannot be
 * done (the web edition)
 */
export async function revertProjectFiles(pouPath: string | undefined, paths: string[]): Promise<{ reverted: string[]; errors: { path: string; error: string }[] } | null> {
  if (!pouPath || !paths.length) return null;
  if (isXaeHost()) {
    const requestId = ++findSeq;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        off();
        resolve(null);
      }, 30000);
      const off = onHostMessage((m) => {
        if (m.type !== 'revertProjectFilesResult' || m.requestId !== requestId) return;
        window.clearTimeout(timer);
        off();
        resolve({ reverted: m.reverted ?? [], errors: m.errors ?? [] });
      });
      postToHost({ type: 'revertProjectFiles', requestId, paths });
    });
  }
  const d = (window as unknown as { tcDesktop?: { revertProjectFiles?: (p: string, paths: string[]) => Promise<{ reverted: string[]; errors: { path: string; error: string }[] }> } }).tcDesktop;
  return d?.revertProjectFiles ? d.revertProjectFiles(pouPath, paths).catch(() => null) : null;
}

export interface InheritanceResult {
  /** The bases found, nearest first */
  bases: InheritedSource[];
  /** Their folders' .TcDUT files (the enum is often beside the base) */
  dutCandidates: DutCandidate[];
  /** The first base not found (and why), when the bases found have no doState() */
  missing?: { name: string; error: string };
}

/**
 * The bases of a POU that EXTENDS another and has no doState() of its own (SM_Head EXTENDS SM_3AxisHead): looked
 * for in the PLC project, nearest first, up to the first one not found (a library's). null: not such a POU
 */
export async function resolveInheritance(pouXml: string, fromPath: string | undefined, askFolder: boolean): Promise<InheritanceResult | null> {
  if (hasOwnMethod(pouXml, 'doState') || !extendsOf(pouXml)) return null;
  const bases: InheritedSource[] = [];
  const dutCandidates: DutCandidate[] = [];
  const seen = new Set([pouNameOf(pouXml).toLowerCase()]);
  for (let name = extendsOf(pouXml); name && !seen.has(name.toLowerCase()) && bases.length < 6; ) {
    seen.add(name.toLowerCase());
    const found = await findProjectPou(name, fromPath, askFolder && !bases.length);
    if ('error' in found) {
      const hasDoState = bases.some((b) => hasOwnMethod(b.content, 'doState'));
      return { bases, dutCandidates, ...(hasDoState ? {} : { missing: { name, error: found.error } }) };
    }
    bases.push({ name, content: found.content, path: found.path });
    dutCandidates.push(...(found.dutCandidates ?? []));
    name = extendsOf(found.content);
  }
  return { bases, dutCandidates };
}
