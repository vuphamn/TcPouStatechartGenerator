/**
 * The PLC project's state machine POUs and enums (for the project documentation), and saving a document, from
 * the host: the TwinCAT XAE extension or the desktop app read the loaded POU's PLC project folder; the web
 * edition asks for a folder (Chromium) instead.
 */

import type { ProjectFiles } from './projectDocumentation.ts';
import { isVsCodeHost, isXaeHost, onHostMessage, postToHost, type CommissioningEntry, type CommissioningEntryRequest, type ProjectFileVersion } from './xaeHost.ts';
import { webFindEnumType, webFindPou, type PouSource } from './sourceFileAccess.ts';
import type { DutCandidate } from './dutMatcher.ts';
import { extendsOf, hasOwnMethod, pouNameOf, type InheritedSource } from './pouInheritance.ts';
import { triggerDownload } from './diagramExport.ts';

interface DesktopProjectApi {
  projectPous: (fromPath: string) => Promise<ProjectFiles & { error?: string }>;
  saveFile: (name: string, content: string, opts?: { personal?: boolean }) => Promise<{ path?: string; error?: string; canceled?: boolean }>;
  addPlcFiles: (pouPath: string, req: { folder: string; files: { name: string; content: string }[] }) => Promise<AddPlcFilesResult>;
  eventsSave: (pouPath: string, req: { name: string; csv: string }) => Promise<{ ok: boolean; path?: string; error?: string | null }>;
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
  // (the web edition: across the folder granted, when one is)
  if (!d?.findEnumType) return webFindEnumType(typeName);
  if (!pouPath) return null;
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

// Named watch lists beside the PLC project (MachineScope.watch.json, shared with the team); the web edition: this
// browser's (and CSV to share)
const webLists = (pouType: string): Record<string, string[]> => {
  try {
    const v = JSON.parse(localStorage.getItem(`kss.watchLists|${pouType.toLowerCase()}`) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};
/** A POU type's named watch lists, and where they are kept */
export async function fetchWatchLists(pouPath: string | undefined, pouType: string): Promise<{ lists: Record<string, string[]>; where: 'project' | 'browser' }> {
  if (isXaeHost()) {
    const r = await hostAsk<{ lists?: Record<string, string[]> }>({ type: 'watchLists', pouType }, 'watchListsResult');
    if (r) return { lists: r.lists ?? {}, where: 'project' };
  }
  const d = (window as unknown as { tcDesktop?: { watchLists?: (p: string, t: string) => Promise<{ lists: Record<string, string[]> }> } }).tcDesktop;
  if (d?.watchLists && pouPath) return { lists: (await d.watchLists(pouPath, pouType).catch(() => null))?.lists ?? {}, where: 'project' };
  return { lists: webLists(pouType), where: 'browser' };
}
/** A list saved (vars null: removed) → the lists now, or { error } */
export async function saveWatchList(pouPath: string | undefined, pouType: string, name: string, vars: string[] | null): Promise<{ lists?: Record<string, string[]>; error?: string }> {
  if (isXaeHost()) {
    const r = await hostAsk<{ lists?: Record<string, string[]>; error?: string }>({ type: 'watchListSave', pouType, name, vars }, 'watchListSaveResult');
    if (r) return r;
  }
  const d = (window as unknown as { tcDesktop?: { watchListSave?: (p: string, t: string, n: string, v: string[] | null) => Promise<{ lists?: Record<string, string[]>; error?: string }> } }).tcDesktop;
  if (d?.watchListSave && pouPath) return d.watchListSave(pouPath, pouType, name, vars).catch((e: unknown) => ({ error: String(e) }));
  const lists = webLists(pouType);
  if (vars === null) delete lists[name];
  else lists[name] = vars;
  try {
    localStorage.setItem(`kss.watchLists|${pouType.toLowerCase()}`, JSON.stringify(lists));
  } catch {
    return { error: 'Not kept (this browser keeps nothing)' };
  }
  return { lists };
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

export interface AddPlcFilesResult {
  ok: boolean;
  written?: string[];
  /** The project references TcUnit */
  tcunit?: boolean;
  folder?: string;
  error?: string | null;
  /** Added in XAE's open project (its tree, through its Automation Interface): kept with XAE's Save All */
  xae?: boolean;
}

/** New POUs can go into the loaded POU's PLC project here (XAE, VS Code, the desktop app with a POU from a folder) */
export const canAddPlcFiles = (pouPath: string | undefined) => !!pouPath && (isXaeHost() || !!desktop()?.addPlcFiles);

/** New POUs (.TcPOU) into a folder of the loaded POU's PLC project, listed in its .plcproj */
export async function addPlcFiles(pouPath: string, folder: string, files: { name: string; content: string }[]): Promise<AddPlcFilesResult> {
  const d = desktop();
  if (d?.addPlcFiles) return d.addPlcFiles(pouPath, { folder, files });
  if (!isXaeHost()) return { ok: false, error: 'Adding files to the PLC project needs TwinCAT XAE, VS Code or the desktop app' };
  const requestId = Date.now() % 1e9;
  const r = await hostRequest<AddPlcFilesResult & { requestId?: number }>({ type: 'addPlcFiles', requestId, folder, files }, 'addPlcFilesResult', 60000);
  return 'ok' in r ? r : { ok: false, error: r.error };
}

/** A live session's events can be kept beside the PLC project here (XAE, VS Code, the desktop app) */
export const canKeepEvents = (pouPath: string | undefined) => !!pouPath && (isXaeHost() || !!desktop()?.eventsSave);

/** A live session's events (CSV) into <the PLC project>/MachineScope.events/<name> */
export async function saveEventsFile(pouPath: string, name: string, csv: string): Promise<{ ok: boolean; path?: string; error?: string | null }> {
  const d = desktop();
  if (d?.eventsSave) return d.eventsSave(pouPath, { name, csv });
  if (!isXaeHost()) return { ok: false, error: 'Keeping the events beside the project needs TwinCAT XAE, VS Code or the desktop app' };
  const r = await hostRequest<{ ok: boolean; path?: string; error?: string | null }>({ type: 'eventsSave', requestId: Date.now() % 1e9, name, csv }, 'eventsSaveResult', 30000);
  return 'ok' in r ? r : { ok: false, error: r.error };
}

/** The TcUnit tests can be run from here (TwinCAT XAE: its project open there) */
export const canRunPlcTests = () => isXaeHost() && !isVsCodeHost();

/** The TcUnit tests run on the PLC: PRG_KssTests called by the PLC project's task, built, downloaded and started */
export async function runPlcTests(): Promise<{ ok: boolean; message: string }> {
  if (!canRunPlcTests()) return { ok: false, message: 'Running the tests needs TwinCAT XAE' };
  const r = await hostRequest<{ ok: boolean; message: string }>({ type: 'runPlcTests', requestId: Date.now() % 1e9 }, 'runPlcTestsResult', 15 * 60 * 1000);
  return 'ok' in r ? r : { ok: false, message: r.error };
}

export interface Commissioning {
  allowed: string[];
  log: CommissioningEntry[];
  /** Kept beside the PLC project (shared through git) or in this browser */
  where: 'project' | 'browser';
}
const webCommissioning = (pouType: string): Commissioning => {
  try {
    const raw = JSON.parse(localStorage.getItem(`kss.setStateAllowed|${pouType.toLowerCase()}`) || '[]');
    const log = JSON.parse(localStorage.getItem(`kss.setStateLog|${pouType.toLowerCase()}`) || '[]');
    return { allowed: Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [], log: Array.isArray(log) ? log : [], where: 'browser' };
  } catch {
    return { allowed: [], log: [], where: 'browser' };
  }
};

/** The POU type's commissioning: the states the PLC may be set to, who set which (the project's file, else this browser) */
export async function fetchCommissioning(pouPath: string | undefined, pouType: string): Promise<Commissioning> {
  if (isXaeHost()) {
    const r = await hostAsk<{ allowed?: string[]; log?: CommissioningEntry[] }>({ type: 'commissioning', pouType }, 'commissioningResult');
    if (r) return { allowed: r.allowed ?? [], log: r.log ?? [], where: 'project' };
  }
  const d = (window as unknown as { tcDesktop?: { commissioning?: (p: string, t: string) => Promise<{ allowed: string[]; log: CommissioningEntry[] }> } }).tcDesktop;
  if (d?.commissioning && pouPath) {
    const r = await d.commissioning(pouPath, pouType).catch(() => null);
    if (r) return { allowed: r.allowed ?? [], log: r.log ?? [], where: 'project' };
  }
  return webCommissioning(pouType);
}

/** Saved: the list (allowed) and / or a state set (entry, logged with the user) → the commissioning now, or { error } */
export async function saveCommissioning(pouPath: string | undefined, pouType: string, req: { allowed?: string[]; entry?: CommissioningEntryRequest }): Promise<Commissioning | { error: string }> {
  if (isXaeHost()) {
    const r = await hostAsk<{ allowed?: string[]; log?: CommissioningEntry[]; error?: string }>({ type: 'commissioningSave', pouType, ...req }, 'commissioningSaveResult');
    if (r) return r.error ? { error: r.error } : { allowed: r.allowed ?? [], log: r.log ?? [], where: 'project' };
  }
  const d = (window as unknown as { tcDesktop?: { commissioningSave?: (p: string, t: string, q: unknown) => Promise<{ allowed?: string[]; log?: CommissioningEntry[]; error?: string }> } }).tcDesktop;
  if (d?.commissioningSave && pouPath) {
    const r: { allowed?: string[]; log?: CommissioningEntry[]; error?: string } = await d.commissioningSave(pouPath, pouType, req).catch((e: unknown) => ({ error: String(e) }));
    return r.error ? { error: r.error } : { allowed: r.allowed ?? [], log: r.log ?? [], where: 'project' };
  }
  const cur = webCommissioning(pouType);
  if (req.allowed) cur.allowed = req.allowed;
  if (req.entry) cur.log = [...cur.log, { ...req.entry, t: new Date().toISOString(), user: '(this browser)' }].slice(-500);
  try {
    localStorage.setItem(`kss.setStateAllowed|${pouType.toLowerCase()}`, JSON.stringify(cur.allowed));
    localStorage.setItem(`kss.setStateLog|${pouType.toLowerCase()}`, JSON.stringify(cur.log));
  } catch {
    return { error: 'Not kept (this browser keeps nothing)' };
  }
  return cur;
}

/** An alert told to a webhook (Teams, Slack: { text } POSTed; https only): by the host, or the page (no answer read) */
export async function postWebhook(url: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^https:\/\//i.test(url)) return { ok: false, error: 'Only an https:// webhook' };
  if (isXaeHost()) {
    const r = await hostAsk<{ ok: boolean; error?: string }>({ type: 'webhook', url, text }, 'webhookResult', 20000);
    if (r) return r;
  }
  const d = (window as unknown as { tcDesktop?: { webhook?: (u: string, t: string) => Promise<{ ok: boolean; error?: string }> } }).tcDesktop;
  if (d?.webhook) return d.webhook(url, text).catch((e: unknown) => ({ ok: false, error: String(e) }));
  // (the web edition: sent as is, its answer not readable)
  try {
    await fetch(url, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ text }) });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
