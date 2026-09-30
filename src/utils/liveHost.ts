/**
 * Where the live view's ADS connection lives: the TwinCAT XAE extension (xaeHost.ts messages) or the desktop app's
 * main process (electron/tcLive.cjs, through the preload bridge). Both send the same liveStatus / liveValues messages.
 */

import type { HostMessage, LiveWatchVar } from './xaeHost.ts';

export type LiveMessage = Extract<HostMessage, { type: 'liveStatus' } | { type: 'liveValues' } | { type: 'liveWatchResult' } | { type: 'liveVars' } | { type: 'liveBrowseResult' } | { type: 'plcBuildProgress' }>;

export interface DesktopLiveOptions {
  /** The .TcPOU's path: instance paths and the ADS port are found from its PLC project */
  path?: string;
  /** The function block's name: its instances are looked up in the PLC when the project files do not tell */
  typeName?: string;
  stateVar: string;
  instance?: string;
  /** The PLC's AMS NetId */
  netId: string;
  /** The PLC's IP address (default: the first 4 numbers of the NetId); "host:tcpPort" for a forwarded port */
  ip?: string;
  port?: number;
  /** This computer's AMS NetId towards the PLC (default: its IP + ".1.1") */
  localNetId?: string;
}

interface DesktopLiveApi {
  start: (options: DesktopLiveOptions) => Promise<void>;
  stop: () => Promise<void>;
  /** Guard variables to follow in the running session */
  watch?: (vars: LiveWatchVar[]) => Promise<boolean>;
  /** Symbol browser: a symbol's members (answered with liveBrowseResult) */
  browse?: (req: { requestId: number; path: string; stateVar: string }) => Promise<void>;
  /** The PLC project's sources as the PLC keeps them (read-only, its boot folder) */
  sources?: (req: { requestId: number }) => Promise<import('./plcSources.ts').PlcSources>;
  /** The PLC's project kept on this computer (Documents\Kval StateScope\PLC projects, or its own folder) */
  projectCopy?: (req: { requestId: number; folder?: string; chosen?: boolean; choice?: 'override' | 'keep'; skipProjects?: string[] }) => Promise<import('./plcSources.ts').PlcCopyResult>;
  /** A folder chosen (the dialog's title) */
  pickFolder?: (title: string) => Promise<{ path?: string; canceled?: boolean }>;
  checkConnection?: (req: import('./connectionCheck.ts').CheckRequest) => Promise<import('./connectionCheck.ts').CheckResult>;
  closeBuild?: (req: { requestId: number; key?: string }) => Promise<{ closed: boolean }>;
  projectBuild?: (req: { requestId: number; file: string; edits: { file: string; content: string }[]; write?: import('./plcBuild.ts').PlcWrite | null }) => Promise<import('./plcBuild.ts').PlcBuildResult>;
  license?: (req: { requestId: number }) => Promise<{ state: { state: 'expired' | 'soon' | 'ok'; text: string } | null }>;
  /** The PLC application's state and online change count (did an online change from XAE take?) */
  appInfo?: (req: { requestId: number }) => Promise<import('./plcBuild.ts').PlcAppInfo>;
  /** The PLC application started (after a write left it in Stop) */
  startPlc?: (req: { requestId: number }) => Promise<{ state: string | null; ok: boolean; error?: string }>;
  /** TwinCAT XAE opened for the user */
  openXae?: () => Promise<{ ok: boolean; message: string }>;
  /** The engineering project for a POU from the PLC: its folder chosen, a file saved into it */
  pickProjectFolder?: () => Promise<{ path?: string; canceled?: boolean; error?: string }>;
  saveIntoProject?: (req: { root: string; plcProject?: string; path: string; content: string }) => Promise<{ file?: string; error?: string }>;
  build?: (req: { requestId: number; edits: import('./plcBuild.ts').PlcEdit[]; plcProject?: string; write?: import('./plcBuild.ts').PlcWrite | null }) => Promise<import('./plcBuild.ts').PlcBuildResult>;
  onMessage: (handler: (message: LiveMessage) => void) => () => void;
}

/** The desktop app's live API, or null (web, XAE) */
export const desktopLive = (): DesktopLiveApi | null =>
  (window as unknown as { tcDesktop?: { live?: DesktopLiveApi } }).tcDesktop?.live ?? null;
