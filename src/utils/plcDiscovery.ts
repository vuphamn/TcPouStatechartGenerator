/**
 * The Live tab's Browse and Remember: the PLCs found on the network (the TwinCAT search of XAE's Add Route dialog,
 * run by the desktop app's main process or the XAE extension) and the PLCs remembered in this app, for any POU.
 */

import { isXaeHost, onHostMessage, postToHost } from './xaeHost.ts';

export interface FoundPlc {
  netId: string;
  ip: string;
  name: string;
  twincat?: string;
  os?: string;
  /** XAE: this computer's TwinCAT router has a route to it (XAE goes live through that router) */
  route?: boolean;
  /** XAE: "route" for a route not found on the network, "project" for the TwinCAT project's target */
  source?: 'network' | 'route' | 'project';
}

export interface PlcScanResult {
  devices: FoundPlc[];
  errors: string[];
  /** TwinCAT runs on this computer too: its router's AMS NetId (Add Route can then add the route both ways) */
  localTwinCat?: string | null;
}

export interface RememberedPlc {
  name: string;
  netId: string;
  ip: string;
  port: string;
  localNetId: string;
  /** Last used (ms): the list is newest first, and the newest fills in a POU without a target */
  used: number;
  /** What Browse last found about it: its TwinCAT and OS, and when (ms) */
  twincat?: string;
  os?: string;
  seen?: number;
}

export { refreshRemembered } from './rememberedPlcs.ts';

interface DesktopDiscoveryApi {
  discoverPlcs?: (options: { addresses: string[]; localNetId?: string }) => Promise<PlcScanResult>;
  addRoute?: (options: { plcIp: string; plcNetId?: string; plcName?: string; user: string; password: string; localNetId?: string; both?: boolean; localUser?: string; localPassword?: string }) => Promise<AddRouteResult>;
}

const desktopApi = (): DesktopDiscoveryApi | null =>
  (window as unknown as { tcDesktop?: { live?: DesktopDiscoveryApi } }).tcDesktop?.live ?? null;

/** Whether this edition can search the network (the desktop app, the XAE extension) */
export const canScanPlcs = () => isXaeHost() || typeof desktopApi()?.discoverPlcs === 'function';

let nextRequest = 1;

/** Searches the network (and asks the given addresses) for TwinCAT devices */
export function scanPlcs(addresses: string[], localNetId?: string): Promise<PlcScanResult> {
  if (isXaeHost()) {
    const requestId = nextRequest++;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        off();
        resolve({ devices: [], errors: ['XAE did not answer the search'] });
      }, 15000);
      const off = onHostMessage((m) => {
        if (m.type !== 'plcList' || m.requestId !== requestId) return;
        window.clearTimeout(timer);
        off();
        const devices = [...(m.devices ?? [])];
        // The project's target first (XAE's own choice), unless the search found it already
        if (m.projectTarget && !devices.some((d) => d.netId === m.projectTarget)) {
          devices.unshift({ netId: m.projectTarget, ip: '', name: 'The project\'s target', route: true, source: 'project' });
        }
        resolve({ devices, errors: m.errors ?? [] });
      });
      postToHost({ type: 'discoverPlcs', requestId, addresses });
    });
  }
  const api = desktopApi();
  if (!api?.discoverPlcs) return Promise.resolve({ devices: [], errors: ['Searching is not available in this edition'] });
  return api.discoverPlcs({ addresses, localNetId: localNetId || undefined }).catch((err: Error) => ({ devices: [], errors: [err.message] }));
}

export interface AddRouteRequest {
  /** The PLC: its IP (desktop, Link: the route request goes there) and AMS NetId / name (XAE: its route to it) */
  plcIp: string;
  netId: string;
  name: string;
  user: string;
  password: string;
  /** This computer's AMS NetId towards the PLC (desktop, Link; empty: the live view's default) */
  localNetId?: string;
  both?: boolean;
  localUser?: string;
  localPassword?: string;
}

export interface AddRouteResult {
  ok: boolean;
  message: string;
  /** Added (or tried) both ways: on the PLC for this computer's TwinCAT, and in its router for the PLC */
  both?: boolean;
  localTwinCat?: string;
}

/** Add Route both ways (TwinCAT on this computer too): this computer's Windows user for its own router */
export interface AddRouteBoth {
  both: boolean;
  localUser?: string;
  localPassword?: string;
}

/**
 * Add Route. Desktop: asks the PLC for a route to this computer. XAE: adds the route both ways through XAE (as its Add
 * Route dialog does: in this computer's router, and on the PLC). The password is only passed on, never kept.
 */
export function addRouteOnPlc(req: AddRouteRequest): Promise<AddRouteResult> {
  if (isXaeHost()) {
    const requestId = nextRequest++;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        off();
        resolve({ ok: false, message: 'XAE did not answer' });
      }, 30000);
      const off = onHostMessage((m) => {
        if (m.type !== 'addRouteResult' || m.requestId !== requestId) return;
        window.clearTimeout(timer);
        off();
        resolve({ ok: m.ok, message: m.message });
      });
      postToHost({ type: 'addRoute', requestId, netId: req.netId, ip: req.plcIp, name: req.name, user: req.user, password: req.password });
    });
  }
  const api = desktopApi();
  if (!api?.addRoute) return Promise.resolve({ ok: false, message: 'Adding routes is not available in this edition' });
  return api.addRoute({ plcIp: req.plcIp, plcNetId: req.netId, plcName: req.name, user: req.user, password: req.password, localNetId: req.localNetId || undefined, both: req.both, localUser: req.localUser, localPassword: req.localPassword }).catch((err: Error) => ({ ok: false, message: err.message }));
}

/** Which PLCs answer (desktop, XAE; Link: the App asks Link): [{ key, ip }] -> { key: boolean } */
export function probePlcs(targets: { key: string; ip: string }[]): Promise<Record<string, boolean>> {
  if (isXaeHost()) {
    const requestId = nextRequest++;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        off();
        resolve({});
      }, 8000);
      const off = onHostMessage((m) => {
        const msg = m as unknown as { type: string; requestId?: number; reachable?: Record<string, boolean> };
        if (msg.type !== 'probeResult' || msg.requestId !== requestId) return;
        window.clearTimeout(timer);
        off();
        resolve(msg.reachable ?? {});
      });
      postToHost({ type: 'probePlcs', requestId, targets } as unknown as Parameters<typeof postToHost>[0]);
    });
  }
  const api = desktopApi() as (DesktopDiscoveryApi & { probePlcs?: (t: { key: string; ip: string }[]) => Promise<Record<string, boolean>> }) | null;
  return api?.probePlcs ? api.probePlcs(targets).catch(() => ({})) : Promise.resolve({});
}

const KEY = 'kss.live.plcs';

export function loadRememberedPlcs(): RememberedPlc[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]') as RememberedPlc[];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.netId === 'string').sort((a, b) => (b.used || 0) - (a.used || 0)) : [];
  } catch {
    return [];
  }
}

export function saveRememberedPlcs(list: RememberedPlc[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    // per-viewer convenience only
  }
}

/** The IP to put in the PLC IP field: empty when it is the NetId's first four numbers (the default) */
export function ipFieldFor(netId: string, ip: string): string {
  return !ip || netId.split('.').slice(0, 4).join('.') === ip ? '' : ip;
}
