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

/** A PLC named by the Live tab's settings, over a connection of its own (not live) */
export interface PlcConnection {
  netId: string;
  ip?: string;
  port?: number;
  localNetId?: string;
}
export interface PlcInstancesRequest {
  requestId: number;
  connection: PlcConnection;
  typeName: string;
  stateVar: string;
}
export interface PlcInstancesResult {
  instances?: string[];
  plcState?: string;
  error?: string;
}
export interface PlcStartAtRequest {
  requestId: number;
  connection: PlcConnection;
  mode: 'plc' | 'stop' | 'restart' | 'run';
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
  /** The PLC's I/O tree (read-only) */
  ioTree?: (req: { requestId: number }) => Promise<import('../components/IoTreePanel.tsx').IoTree>;
  /** The EtherCAT masters' slave states (read-only; not yet confirmed on hardware) */
  ecatStates?: (req: { requestId: number; netIds: string[] }) => Promise<import('../components/IoNetworkView.tsx').EcatStatesResult>;
  /** A device's details (TwinCAT's device descriptions, the user's pictures of it) */
  deviceInfo?: (req: import('../components/IoBoxProperties.tsx').DeviceInfoRequest) => Promise<import('../components/IoBoxProperties.tsx').DeviceInfo>;
  openDevicesFolder?: () => Promise<{ folder: string; error?: string }>;
  /** A TwinCAT project's I/O tree on this computer (offline): the open POU's project, else a folder chosen */
  ioTreeFolder?: (req: { pouPath?: string; pick?: boolean }) => Promise<import('../components/IoTreePanel.tsx').IoTree & { canceled?: boolean; folder?: string }>;
  /** The PLC's project kept on this computer (Documents\Kval MachineScope\PLC projects, or its own folder) */
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
  /** A POU type's instances in a PLC, not live (the one to go live on chosen first) */
  instances?: (req: PlcInstancesRequest) => Promise<PlcInstancesResult>;
  /** A PLC started from Browse, not live: its PLC from Stop ('plc'), or TwinCAT from Config to Run mode ('run') */
  startAt?: (req: PlcStartAtRequest) => Promise<{ state: string | null; ok: boolean; error?: string }>;
  /** The found PLCs' states again (Browse, while open) */
  plcStates?: (req: { requestId: number; devices: { netId: string; ip: string; name?: string }[] }) => Promise<{ devices: import('./plcDiscovery.ts').FoundPlc[] }>;
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
