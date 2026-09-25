/**
 * Where the live view's ADS connection lives: the TwinCAT XAE extension (xaeHost.ts messages) or the desktop app's
 * main process (electron/tcLive.cjs, through the preload bridge). Both send the same liveStatus / liveValues messages.
 */

import type { HostMessage } from './xaeHost.ts';

export type LiveMessage = Extract<HostMessage, { type: 'liveStatus' } | { type: 'liveValues' }>;

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
  onMessage: (handler: (message: LiveMessage) => void) => () => void;
}

/** The desktop app's live API, or null (web, XAE) */
export const desktopLive = (): DesktopLiveApi | null =>
  (window as unknown as { tcDesktop?: { live?: DesktopLiveApi } }).tcDesktop?.live ?? null;
