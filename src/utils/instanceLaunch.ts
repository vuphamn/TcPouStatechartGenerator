/**
 * Several StateScopes on one POU, each following another PLC instance of it (MAIN.fbLine1.smTable,
 * MAIN.fbLine2.smTable, ...). A new window / tab starts with the POU, the instance to follow, and whether to go live.
 * Where the host cannot load the POU itself (the web edition, a sample or dropped file in the desktop app), the page
 * that opens it hands the POU over through localStorage: the new page gets "?handoff=<id>" and takes the entry.
 */

import type { DutCandidate } from './dutMatcher.ts';

export interface InstanceLaunch {
  /** The PLC instance this window follows (kept per window, not in the POU's saved live settings) */
  instance?: string;
  /** Go live as soon as the POU is loaded */
  live?: boolean;
  /** The opener's PLC connection (target, port, Link / gateway): the same PLC, also for another POU */
  connection?: Record<string, string>;
}

/** The Live settings that say how to reach the PLC (not the instance) */
export const CONNECTION_KEYS = ['netId', 'port', 'ip', 'localNetId', 'gateway', 'plc', 'via', 'linkPort'] as const;

/** Only the connection keys, as short strings */
export function connectionOf(settings: object | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of CONNECTION_KEYS) {
    const v = (settings as Record<string, unknown> | null | undefined)?.[k];
    if (typeof v === 'string' && v.length <= 200) out[k] = v;
  }
  return out;
}

export interface InstanceHandoff extends InstanceLaunch {
  sampleId?: string;
  pou?: { name: string; content: string; path?: string };
  dut?: { name: string; content: string; path?: string };
  /** The .TcDUT files found with the POU (the new page picks the enum as Browse does) */
  dutCandidates?: DutCandidate[];
}

const PREFIX = 'kss.handoff.';
/** Entries older than this were never taken (the new page did not open): removed */
const MAX_AGE_MS = 60_000;

export const sameInstance = (a?: string | null, b?: string | null) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/** Stores the handoff for a new page; returns its id (null when storage is unavailable) */
export function putHandoff(handoff: InstanceHandoff): string | null {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        if (Date.now() - (JSON.parse(localStorage.getItem(key) || '{}').at ?? 0) > MAX_AGE_MS) localStorage.removeItem(key);
      } catch {
        localStorage.removeItem(key);
      }
    }
    localStorage.setItem(PREFIX + id, JSON.stringify({ ...handoff, at: Date.now() }));
    return id;
  } catch {
    return null;
  }
}

let taken: InstanceHandoff | null | undefined;

/** The handoff this page was opened with ("?handoff=<id>"), taken once (the same object on later calls) */
export function takeHandoff(): InstanceHandoff | null {
  if (taken !== undefined) return taken;
  taken = null;
  try {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('handoff');
    if (!id) return taken;
    const raw = localStorage.getItem(PREFIX + id);
    localStorage.removeItem(PREFIX + id);
    if (raw) {
      const { at: _at, ...handoff } = JSON.parse(raw) as InstanceHandoff & { at?: number };
      taken = handoff;
    }
    // A reload is an ordinary start
    params.delete('handoff');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  } catch {
    // storage unavailable: an ordinary start
  }
  return taken;
}
