/**
 * Web edition: the live view through a Kval StateScope gateway (gateway/gateway.cjs) on the PLC network, or through
 * the local helper Kval StateScope Link (link/link.cjs, ws://127.0.0.1): both speak this protocol.
 * WebSocket protocol: hello {token} -> welcome {user, plcs} | denied; then liveStart / liveStop, answered with the
 * same liveStatus / liveValues messages as the XAE extension and the desktop app.
 */

import type { LiveMessage } from './liveHost.ts';

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
  /** Local helper (Kval StateScope Link): the PLC's address, as in the desktop app */
  netId?: string;
  ip?: string;
  port?: number;
  localNetId?: string;
}

type GatewayEvent =
  | LiveMessage
  | { type: 'welcome'; user: string; plcs: GatewayPlc[] }
  | { type: 'denied'; message: string }
  | { type: 'closed'; message: string };

/** The gateway's WebSocket URL for a gateway address ("gateway:8443", "https://gateway:8443", "wss://...") */
export function gatewaySocketUrl(address: string): string {
  const a = address.trim().replace(/\/+$/, '');
  if (/^wss?:\/\//i.test(a)) return /\/live$/.test(a) ? a : `${a}/live`;
  if (/^https?:\/\//i.test(a)) return `${a.replace(/^http/i, 'ws')}/live`;
  return `wss://${a}/live`;
}

/** The local helper (Kval StateScope Link) rather than a gateway */
const isLocalHelper = (url: string) => /^ws:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url);

/** Is this page served by a gateway? Then it is the default gateway (same origin) */
export async function detectGatewayOrigin(): Promise<string | null> {
  if (!/^https?:$/.test(location.protocol)) return null;
  try {
    const res = await fetch('gateway.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const info = (await res.json()) as { gateway?: string };
    return info.gateway === 'Kval StateScope' ? location.origin : null;
  } catch {
    return null;
  }
}

export class GatewayConnection {
  private ws: WebSocket | null = null;
  private welcomed: Promise<{ user: string; plcs: GatewayPlc[] }> | null = null;
  private url = '';

  constructor(private readonly onEvent: (event: GatewayEvent) => void) {}

  /** Opens the connection and signs in (reuses an open one to the same gateway) */
  connect(address: string, token: string): Promise<{ user: string; plcs: GatewayPlc[] }> {
    const url = gatewaySocketUrl(address);
    if (this.ws && this.welcomed && this.url === url && this.ws.readyState <= WebSocket.OPEN) return this.welcomed;
    this.close();
    this.url = url;
    const ws = new WebSocket(url);
    this.ws = ws;
    this.welcomed = new Promise((resolve, reject) => {
      let settled = false;
      let signedIn = false;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token }));
      ws.onmessage = (e) => {
        let m: GatewayEvent;
        try {
          m = JSON.parse(String(e.data)) as GatewayEvent;
        } catch {
          return;
        }
        if (m.type === 'welcome' && !settled) {
          settled = true;
          signedIn = true;
          resolve({ user: m.user, plcs: m.plcs });
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
            ? 'Kval StateScope Link is not running on this computer: start it, then go live'
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
          reject(new Error(e.code === 4401 ? (isLocalHelper(url) ? 'The pairing code does not match the one shown by Kval StateScope Link' : 'The access token was not accepted by the gateway') : e.code === 4429 ? 'Too many failed sign-ins: wait a minute' : `The gateway closed the connection (${e.code})`));
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
