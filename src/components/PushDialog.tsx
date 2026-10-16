import React, { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import type { GatewayConnection } from '../utils/liveGateway.ts';
import { t } from '../utils/boardLang.ts';

const KINDS: [string, string][] = [
  ['error', 'Error states'],
  ['stuck', 'Stuck'],
  ['plcStopped', 'PLC stopped'],
  ['drive', 'Drives'],
  ['call', 'Calls for maintenance'],
  ['escalated', 'Escalated'],
  ['workorder', 'Work orders'],
  ['handover', 'Shift handover'],
  ['parts', 'Spare parts low'],
  ['change', 'PLC program changes'],
  ['anomaly', 'Anomalies (unusual stays, new transitions)'],
  ['recovered', 'Recovered'],
];
const keyOf = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
/** Push notifications possible here: a secure page (https, or this computer), a browser with them */
export const pushPossible = () => typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/**
 * Notifications on this device (gateway/push.cjs): the alerts it wants, of the board's PLCs, even with the board closed
 * (installed as an app: the browser's Install, or Add to Home Screen; on an iPhone that first)
 */
export function PushDialog({ conn, plcIds, onClose, onState }: { conn: GatewayConnection | null; plcIds: string[]; onClose: () => void; onState: (on: boolean) => void }) {
  const [info, setInfo] = useState<{ enabled: boolean; publicKey: string; sub: { events: string[]; plcs: string[] } | null } | null>(null);
  const [events, setEvents] = useState<string[]>(['error', 'stuck', 'plcStopped', 'drive', 'call', 'escalated']);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const possible = pushPossible();
  useEffect(() => {
    if (!possible || !conn) return;
    void (async () => {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.getSubscription();
      setEndpoint(sub?.endpoint ?? null);
      const r = await conn.request<{ enabled: boolean; publicKey: string; sub: { events: string[]; plcs: string[] } | null }>({ type: 'pushInfo', endpoint: sub?.endpoint ?? null }, 'pushInfoResult', 10000);
      setInfo(r);
      if (r.sub) setEvents(r.sub.events);
    })().catch((e: unknown) => setMsg({ text: e instanceof Error ? e.message : String(e), ok: false }));
  }, [conn, possible]);
  type R = { ok: boolean; error?: string; message?: string };
  const ask = async (m: Record<string, unknown>) => {
    const r: R | undefined = await conn?.request<R>(m, 'pushResult', 20000).catch((e: unknown): R => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!r?.ok) throw new Error(r?.error ?? r?.message ?? 'Not done');
  };
  const turnOn = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if ((await Notification.requestPermission()) !== 'granted') throw new Error(t('Notifications are not allowed for this page: allow them in the browser (the lock beside the address)'));
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyOf(info!.publicKey) }));
      await ask({ type: 'pushSubscribe', subscription: sub.toJSON(), events, plcs: plcIds, label: navigator.userAgent.match(/\(([^;)]+)/)?.[1] ?? '' });
      setEndpoint(sub.endpoint);
      setInfo((i) => (i ? { ...i, sub: { events, plcs: plcIds } } : i));
      onState(true);
      setMsg({ text: t('On: this device is told of them'), ok: true });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), ok: false });
    }
    setBusy(false);
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await ask({ type: 'pushUnsubscribe', endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setEndpoint(null);
      setInfo((i) => (i ? { ...i, sub: null } : i));
      onState(false);
      setMsg({ text: t('Off'), ok: true });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), ok: false });
    }
    setBusy(false);
  };
  const on = !!(endpoint && info?.sub);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="board-push-dialog" className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm space-y-3 shadow-2xl" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="flex items-center gap-2 text-base font-semibold">
          <BellRing className="w-5 h-5 text-sky-300" /> {t('Notifications on this device')}
          <button type="button" onClick={onClose} className="ml-auto p-1 rounded text-slate-400 hover:text-white" title={t('Close')}>
            <X className="w-4 h-4" />
          </button>
        </div>
        {!possible ? (
          <p id="push-impossible" className="text-amber-200">{t('Not here: notifications need the board over https (the gateway’s https address) in a browser that has them. On an iPhone or iPad, add the board to the Home Screen first and open it from there.')}</p>
        ) : info && !info.enabled ? (
          <p className="text-amber-200">{t('Push notifications are off on this gateway.')}</p>
        ) : (
          <>
            <p className="text-slate-400">{t('The alerts of the board’s PLCs, even with the board closed. Install the board as an app (the browser’s Install, or Add to Home Screen) to keep it at hand.')}</p>
            <div className="grid grid-cols-2 gap-1">
              {KINDS.map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" className="push-kind" data-kind={k} checked={events.includes(k)} onChange={(e) => setEvents((x) => (e.target.checked ? [...x, k] : x.filter((y) => y !== k)))} /> {t(label)}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button id="push-on" type="button" disabled={busy || !info || !events.length} onClick={() => void turnOn()} className="px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40">
                {on ? t('Save') : t('Turn on')}
              </button>
              {on && (
                <>
                  <button id="push-test" type="button" disabled={busy} onClick={() => void ask({ type: 'pushTest', endpoint }).then(() => setMsg({ text: t('Sent: it comes in a few seconds'), ok: true })).catch((e: Error) => setMsg({ text: e.message, ok: false }))} className="px-3 py-1.5 rounded border border-slate-600 hover:bg-slate-800">
                    {t('Send a test')}
                  </button>
                  <button id="push-off" type="button" disabled={busy} onClick={() => void turnOff()} className="px-3 py-1.5 rounded border border-slate-600 hover:bg-slate-800">
                    {t('Turn off')}
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {msg && <div id="push-msg" className={msg.ok ? 'text-emerald-300' : 'text-rose-300'}>{msg.text}</div>}
      </div>
    </div>
  );
}
