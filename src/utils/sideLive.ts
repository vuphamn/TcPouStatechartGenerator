/**
 * Another PLC in the Machine Overview: a monitor connection (browse the PLC's symbols, follow the state variables of
 * its machines; no POU is followed). Desktop: a monitor session of the main process; web: its own connection to Link
 * or the gateway. Several can run next to the POU's own live session.
 */

import { GatewayConnection } from './liveGateway.ts';
import type { LiveBrowseResult, LiveWatchVar } from './xaeHost.ts';
import type { LiveValue } from './liveGuards.ts';

export interface SidePlc {
  /** Unique in this window */
  key: string;
  name: string;
  /** Desktop / Link: the PLC's address */
  netId?: string;
  ip?: string;
  port?: string;
  localNetId?: string;
  /** Gateway: its address (empty: this page's) and PLC id */
  gateway?: string;
  plc?: string;
}

export type SideVia = { kind: 'desktop' } | { kind: 'link'; url: string; code: string } | { kind: 'gateway'; url: string; token: string; sso?: boolean };

export interface SideStatus {
  state: 'connecting' | 'connected' | 'error' | 'lost' | 'stopped';
  message?: string;
  plcState?: string;
}

type SideMessage =
  | { type: 'liveStatus'; state: SideStatus['state'] | 'plcState'; message?: string; plcState?: string }
  | { type: 'liveVars'; values: { id: string; t: number; v: LiveValue | null }[] }
  | ({ type: 'liveBrowseResult' } & LiveBrowseResult);

interface DesktopSideApi {
  start: (key: string, options: object) => Promise<void>;
  stop: (key: string) => Promise<void>;
  watch: (key: string, vars: LiveWatchVar[]) => Promise<boolean>;
  browse: (key: string, req: { requestId: number; path: string; stateVar: string }) => Promise<void>;
  onMessage: (handler: (m: { key: string; message: SideMessage }) => void) => () => void;
}

export const desktopSide = (): DesktopSideApi | null =>
  (window as unknown as { tcDesktop?: { live?: { side?: DesktopSideApi } } }).tcDesktop?.live?.side ?? null;

export class SideConnection {
  private gw: GatewayConnection | null = null;
  private offDesktop: (() => void) | null = null;
  private waiters = new Map<number, (r: LiveBrowseResult) => void>();
  private nextRequest = 1;
  private closed = false;

  constructor(
    private readonly plc: SidePlc,
    private readonly via: SideVia,
    private readonly onStatus: (s: SideStatus) => void,
    private readonly onVars: (values: { id: string; t: number; v: LiveValue | null }[]) => void
  ) {}

  private handle = (m: SideMessage) => {
    if (this.closed) return;
    if (m.type === 'liveStatus') {
      if (m.state === 'plcState') this.onStatus({ state: 'connected', plcState: m.plcState, message: `${this.plc.name} (PLC ${m.plcState})` });
      else this.onStatus({ state: m.state, message: m.message, plcState: m.plcState });
    } else if (m.type === 'liveVars') this.onVars(m.values);
    else if (m.type === 'liveBrowseResult') {
      const w = this.waiters.get(m.requestId);
      if (w) {
        this.waiters.delete(m.requestId);
        w(m);
      }
    }
  };

  start(): void {
    this.onStatus({ state: 'connecting', message: `Connecting to ${this.plc.name}...` });
    const p = this.plc;
    if (this.via.kind === 'desktop') {
      const api = desktopSide();
      if (!api) return this.onStatus({ state: 'error', message: 'Not available in this edition' });
      this.offDesktop = api.onMessage((m) => m.key === p.key && this.handle(m.message));
      void api.start(p.key, { netId: p.netId, ip: p.ip || undefined, port: parseInt(p.port ?? '', 10) || undefined, localNetId: p.localNetId || undefined });
      return;
    }
    this.gw = new GatewayConnection((m) => {
      if (m.type === 'closed') this.onStatus({ state: 'lost', message: m.message });
      else if (m.type === 'liveStatus' || m.type === 'liveVars' || m.type === 'liveBrowseResult') this.handle(m as SideMessage);
    });
    const secret = this.via.kind === 'link' ? this.via.code : this.via.token;
    this.gw
      .connect(this.via.url, secret, this.via.kind === 'gateway' && !!this.via.sso)
      .then(() =>
        this.gw?.start(
          this.via.kind === 'gateway'
            ? { plc: p.plc, stateVar: 'machineState', monitor: true }
            : { netId: p.netId, ip: p.ip || undefined, port: parseInt(p.port ?? '', 10) || undefined, localNetId: p.localNetId || undefined, stateVar: 'machineState', monitor: true }
        )
      )
      .catch((err: Error) => this.onStatus({ state: 'error', message: err.message }));
  }

  watch(vars: LiveWatchVar[]): void {
    if (this.via.kind === 'desktop') void desktopSide()?.watch(this.plc.key, vars);
    else this.gw?.watch(vars);
  }

  browse(path: string, stateVar: string): Promise<LiveBrowseResult> {
    const requestId = this.nextRequest++;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.waiters.delete(requestId);
        resolve({ requestId, path, error: 'No answer' });
      }, 15000);
      this.waiters.set(requestId, (r) => {
        window.clearTimeout(timer);
        resolve(r);
      });
      const req = { requestId, path, stateVar };
      if (this.via.kind === 'desktop') void desktopSide()?.browse(this.plc.key, req);
      else if (!this.gw?.browse(req)) {
        this.waiters.delete(requestId);
        window.clearTimeout(timer);
        resolve({ requestId, path, error: 'Not connected' });
      }
    });
  }

  close(): void {
    this.closed = true;
    this.offDesktop?.();
    if (this.via.kind === 'desktop') void desktopSide()?.stop(this.plc.key);
    this.gw?.stop();
    this.gw?.close();
    for (const w of this.waiters.values()) w({ requestId: 0, path: '', error: 'Closed' });
    this.waiters.clear();
  }
}
