/**
 * Web edition: the live view through a Kval MachineScope gateway (gateway/gateway.cjs) on the PLC network, or through
 * the local helper Kval MachineScope Link (link/link.cjs, ws://127.0.0.1): both speak this protocol.
 * WebSocket protocol: hello {token} -> welcome {user, plcs} | denied; then liveStart / liveStop, answered with the
 * same liveStatus / liveValues messages as the XAE extension and the desktop app.
 */

import type { LiveMessage } from './liveHost.ts';
import type { LiveWatchVar } from './xaeHost.ts';

export interface GatewayPlc {
  id: string;
  name: string;
}

export interface GatewayStartOptions {
  /** Gateway: one of its PLCs */
  plc?: string;
  stateVar: string;
  typeName?: string;
  instance?: string;
  /** Local helper (Kval MachineScope Link): the PLC's address, as in the desktop app */
  netId?: string;
  ip?: string;
  port?: number;
  localNetId?: string;
  /** Another PLC in the Machine Overview: connected for browsing and watched values only */
  monitor?: boolean;
}

/** Which code a helper (Link) runs: its code stamp and build time (built: null when run from source) */
export interface HelperBuild {
  stamp: string;
  built: string | null;
  /** old: a Link from before it said which (no build in its welcome) */
  from: 'build' | 'source' | 'old';
  /** What this Link can do beyond going live (its welcome's features: projectBuild, appInfo, openXae) */
  features?: string[];
}

type GatewayEvent =
  | LiveMessage
  | { type: 'welcome'; user: string; plcs: GatewayPlc[]; build?: HelperBuild; features?: string[] }
  | { type: 'denied'; message: string }
  | { type: 'closed'; message: string };

/** The gateway's WebSocket URL for a gateway address ("gateway:8443", "https://gateway:8443", "wss://...") */
export function gatewaySocketUrl(address: string): string {
  const a = address.trim().replace(/\/+$/, '');
  if (/^wss?:\/\//i.test(a)) return /\/live$/.test(a) ? a : `${a}/live`;
  if (/^https?:\/\//i.test(a)) return `${a.replace(/^http/i, 'ws')}/live`;
  return `wss://${a}/live`;
}

/** The local helper (Kval MachineScope Link) rather than a gateway */
const isLocalHelper = (url: string) => /^ws:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url);

/** Is this page served by a gateway? Then it is the default gateway (same origin) */
export async function detectGatewayOrigin(): Promise<string | null> {
  if (!/^https?:$/.test(location.protocol)) return null;
  try {
    const res = await fetch('gateway.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const info = (await res.json()) as { gateway?: string };
    return info.gateway === 'Kval MachineScope' ? location.origin : null;
  } catch {
    return null;
  }
}

/** Sign-in with company accounts on the gateway that serves this page: set up?, and who is signed in */
export interface GatewaySso {
  sso: boolean;
  provider: string;
  user: string | null;
  name: string | null;
  /** Access tokens are accepted too */
  tokens: boolean;
}

export async function fetchGatewaySso(origin: string): Promise<GatewaySso | null> {
  try {
    const res = await fetch(`${origin.replace(/\/+$/, '')}/auth/me`, { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return null;
    const info = (await res.json()) as GatewaySso;
    return info && typeof info.sso === 'boolean' ? info : null;
  } catch {
    return null;
  }
}

export async function gatewaySignOut(origin: string): Promise<void> {
  await fetch(`${origin.replace(/\/+$/, '')}/auth/logout`, { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
}

export class GatewayConnection {
  private ws: WebSocket | null = null;
  private welcomed: Promise<{ user: string; plcs: GatewayPlc[]; build?: HelperBuild; features: string[] }> | null = null;
  private url = '';
  private sso = false;
  // Requests answered by a message with the same requestId (Link's discover / addRoute)
  private pending = new Map<number, { type: string; resolve: (m: unknown) => void }>();
  private nextRequest = 1;

  constructor(private readonly onEvent: (event: GatewayEvent) => void) {}

  /**
   * Opens the connection and signs in (reuses an open one to the same gateway). sso: signed in with the company
   * account on the gateway (its session cookie goes with the connection), no token
   */
  connect(address: string, token: string, sso = false): Promise<{ user: string; plcs: GatewayPlc[]; build?: HelperBuild; features: string[] }> {
    const url = gatewaySocketUrl(address);
    if (this.ws && this.welcomed && this.url === url && this.sso === sso && this.ws.readyState <= WebSocket.OPEN) return this.welcomed;
    this.close();
    this.url = url;
    this.sso = sso;
    const ws = new WebSocket(url);
    this.ws = ws;
    this.welcomed = new Promise((resolve, reject) => {
      let settled = false;
      let signedIn = false;
      ws.onopen = () => ws.send(JSON.stringify(sso ? { type: 'hello', sso: true } : { type: 'hello', token }));
      ws.onmessage = (e) => {
        let m: GatewayEvent;
        try {
          m = JSON.parse(String(e.data)) as GatewayEvent;
        } catch {
          return;
        }
        const id = (m as { requestId?: number }).requestId;
        const waiting = typeof id === 'number' ? this.pending.get(id) : undefined;
        if (waiting && waiting.type === m.type) {
          this.pending.delete(id!);
          waiting.resolve(m);
          return;
        }
        if (m.type === 'welcome' && !settled) {
          settled = true;
          signedIn = true;
          resolve({ user: m.user, plcs: m.plcs, build: m.build ? { ...m.build, features: m.features ?? [] } : undefined, features: m.features ?? [] });
        } else if (m.type === 'denied' && !settled) {
          settled = true;
          reject(new Error(m.message));
        }
        this.onEvent(m);
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error(isLocalHelper(url)
            ? 'Kval MachineScope Link is not running on this computer: start it, then go live'
            : `Could not reach the gateway at ${url} (is it running? is its certificate trusted by this browser?)`));
        }
      };
      ws.onclose = (e) => {
        if (this.ws === ws) {
          this.ws = null;
          this.welcomed = null;
        }
        if (!settled) {
          settled = true;
          reject(new Error(e.code === 4401 ? (isLocalHelper(url) ? 'The pairing code does not match the one shown by Kval MachineScope Link' : 'The access token was not accepted by the gateway') : e.code === 4429 ? 'Too many failed sign-ins: wait a minute' : `The gateway closed the connection (${e.code})`));
        } else if (signedIn && e.code !== 1000) {
          this.onEvent({ type: 'closed', message: 'The connection to the gateway was closed' });
        }
      };
    });
    return this.welcomed;
  }

  start(options: GatewayStartOptions): void {
    this.ws?.send(JSON.stringify({ type: 'liveStart', ...options }));
  }

  /** Guard variables to follow in the running session */
  watch(vars: LiveWatchVar[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'liveWatch', vars }));
  }

  /** Symbol browser: a symbol's members in the PLC (answered with liveBrowseResult) */
  browse(req: { requestId: number; path: string; stateVar: string }): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: 'liveBrowse', ...req }));
    return true;
  }

  /** Sends a message as is (the operator board: boardWatch, alertsList); false when not connected */
  send(message: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  /** A request answered with replyType (same requestId); rejects when not connected or after timeoutMs */
  request<T>(message: Record<string, unknown>, replyType: string, timeoutMs = 15000): Promise<T> {
    const ws = this.ws;
    if (ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Not connected'));
    const requestId = this.nextRequest++;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('No answer'));
      }, timeoutMs);
      this.pending.set(requestId, {
        type: replyType,
        resolve: (m) => {
          window.clearTimeout(timer);
          resolve(m as T);
        },
      });
      ws.send(JSON.stringify({ ...message, requestId }));
    });
  }

  stop(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'liveStop' }));
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    this.welcomed = null;
    ws?.close(1000);
  }
}
