import React, { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';

export interface DashboardTile {
  /** This PLC, or a compared one */
  label: string;
  state: string | null;
  /** Since when (this computer's clock, ms) */
  sinceMs: number | null;
  /** Over its time limit */
  stuck?: boolean;
  limitMs?: number | null;
}

const dur = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
};

/**
 * The live dashboard (a wall screen): each followed PLC's state and how long it is in it (red when over its limit),
 * the alerts now true (snoozed ones said), the last events; big, updated each second; Esc or × closes it
 */
export const LiveDashboard: React.FC<{
  title: string;
  tiles: DashboardTile[];
  alerts: { text: string; snoozedUntil?: number; snoozedIn?: string }[];
  events: { t: number; kind: string; text: string }[];
  onClose: () => void;
}> = ({ title, tiles, alerts, events, onClose }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  const now = Date.now();
  return (
    <div id="live-dashboard" role="dialog" aria-label="Live dashboard" className="fixed inset-0 z-[90] bg-slate-950 text-slate-100 flex flex-col p-6 gap-5 overflow-auto">
      <div className="flex items-center gap-3">
        <span className="text-2xl font-semibold">{title}</span>
        <span className="text-slate-500 font-mono">{new Date(now).toLocaleTimeString()}</span>
        <button type="button" id="live-dashboard-close" onClick={onClose} className="ml-auto p-1 rounded text-slate-400 hover:text-white" title="Close (Esc)">
          <X className="w-6 h-6" />
        </button>
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, tiles.length))}, minmax(0, 1fr))` }}>
        {tiles.map((t) => (
          <div key={t.label} className={`live-dashboard-tile rounded-xl border-2 p-5 ${t.stuck ? 'border-rose-500 bg-rose-950/40' : 'border-slate-700 bg-slate-900'}`} data-label={t.label} data-state={t.state ?? ''}>
            <div className="text-slate-400 text-lg truncate">{t.label}</div>
            <div className="text-4xl font-bold font-mono break-all mt-1">{t.state ?? '—'}</div>
            <div className={`text-2xl font-mono mt-2 ${t.stuck ? 'text-rose-300' : 'text-emerald-300'}`}>
              {t.sinceMs != null ? dur(now - t.sinceMs) : '—'}
              {t.limitMs ? <span className="text-base text-slate-500"> / limit {dur(t.limitMs)}</span> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 min-h-0">
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="flex items-center gap-2 text-lg text-slate-300 mb-2">
            <BellRing className="w-5 h-5 text-rose-400" /> Alerts now
          </div>
          {alerts.length === 0 && <div className="text-slate-500 text-lg">none</div>}
          {alerts.map((a) => (
            <div key={a.text} className={`live-dashboard-alert text-xl font-mono ${a.snoozedUntil || a.snoozedIn ? 'text-amber-300' : 'text-rose-300'}`}>
              {a.text}
              {a.snoozedIn ? <span className="text-sm text-slate-500"> (snoozed while in {a.snoozedIn})</span> : a.snoozedUntil ? <span className="text-sm text-slate-500"> (snoozed until {new Date(a.snoozedUntil).toLocaleTimeString()})</span> : null}
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="text-lg text-slate-300 mb-2">The last events</div>
          {events.length === 0 && <div className="text-slate-500 text-lg">none</div>}
          {[...events]
            .reverse()
            .slice(0, 8)
            .map((e, i) => (
              <div key={`${e.t}-${i}`} className="live-dashboard-event flex gap-3 text-base">
                <span className="font-mono text-slate-500 shrink-0">{new Date(e.t).toLocaleTimeString()}</span>
                <span className="text-slate-400 shrink-0">{e.kind}</span>
                <span className="text-slate-200 truncate">{e.text}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};
