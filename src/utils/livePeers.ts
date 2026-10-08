/**
 * Live on two PLCs at once (Compare…: the same POU live in another tab / window): each live window says on a
 * BroadcastChannel which PLC it follows, its current state and its transitions; the others with the same POU type show
 * it beside their own (the Live tab) and compare the two sessions (time per state, the transitions only one took).
 * Same origin only: the desktop app's windows, the web edition's tabs, XAE's MachineScope tabs (one WebView2 profile).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveTransition } from './liveView.ts';

export interface LivePeer {
  id: string;
  /** The PLC's name (remembered) or its target */
  plc: string;
  instance?: string;
  /** Its current state and since when (this computer's clock, ms) */
  state: string | null;
  since: number | null;
  /** Its recent transitions (the last MAX_SHARED) */
  transitions: LiveTransition[];
  /** When it last said so (ms) */
  at: number;
}

export interface LiveShare {
  pou: string;
  plc: string;
  instance?: string;
  state: string | null;
  since: number | null;
  transitions: LiveTransition[];
}

const CHANNEL = 'kss-live-compare';
/** Shared every 2 s (and on a new state); a window silent for 7 s is gone */
const EVERY_MS = 2000;
const GONE_MS = 7000;
export const MAX_SHARED = 1000;

const windowId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The other windows live on the same POU type (none while this one is not live, or `share` is null) */
export function useLivePeers(share: LiveShare | null): LivePeer[] {
  const [peers, setPeers] = useState<Map<string, LivePeer>>(new Map());
  const chRef = useRef<BroadcastChannel | null>(null);
  const shareRef = useRef(share);
  shareRef.current = share;
  const pou = share?.pou ?? null;

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined' || !pou) return;
    const ch = new BroadcastChannel(CHANNEL);
    chRef.current = ch;
    ch.onmessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; id?: string; share?: LiveShare } | null;
      if (!m?.id || m.id === windowId) return;
      if (m.type === 'liveGone') {
        setPeers((prev) => {
          if (!prev.has(m.id!)) return prev;
          const next = new Map(prev);
          next.delete(m.id!);
          return next;
        });
        return;
      }
      if (m.type !== 'liveShare' || !m.share || m.share.pou !== shareRef.current?.pou) return;
      const s = m.share;
      setPeers((prev) => new Map(prev).set(m.id!, { id: m.id!, plc: s.plc, instance: s.instance, state: s.state, since: s.since, transitions: s.transitions ?? [], at: Date.now() }));
    };
    const send = () => {
      const s = shareRef.current;
      if (s) ch.postMessage({ type: 'liveShare', id: windowId, share: { ...s, transitions: s.transitions.slice(-MAX_SHARED) } });
    };
    send();
    // (closed: gone at once for the others)
    const gone = () => ch.postMessage({ type: 'liveGone', id: windowId });
    window.addEventListener('pagehide', gone);
    const timer = window.setInterval(() => {
      send();
      // (gone: silent too long)
      setPeers((prev) => {
        const now = Date.now();
        const stale = [...prev.values()].filter((p) => now - p.at > GONE_MS);
        if (!stale.length) return prev;
        const next = new Map(prev);
        for (const p of stale) next.delete(p.id);
        return next;
      });
    }, EVERY_MS);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', gone);
      gone();
      ch.close();
      chRef.current = null;
      setPeers(new Map());
    };
  }, [pou]);

  // A new state: said at once (not at the next tick)
  const state = share?.state ?? null;
  useEffect(() => {
    const s = shareRef.current;
    if (s && chRef.current) chRef.current.postMessage({ type: 'liveShare', id: windowId, share: { ...s, transitions: s.transitions.slice(-MAX_SHARED) } });
  }, [state]);

  return useMemo(() => [...peers.values()].sort((a, b) => a.plc.localeCompare(b.plc)), [peers]);
}
