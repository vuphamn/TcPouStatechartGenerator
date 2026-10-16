import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Globe, Timer } from 'lucide-react';
import type { GatewayConnection } from '../utils/liveGateway.ts';
import { t } from '../utils/boardLang.ts';

/** Another gateway of the plant, as this one follows it (gateway/sites.cjs) */
export interface Site {
  id: string;
  name: string;
  url: string;
  state: string;
  message: string;
  plcs: { id: string; name: string; plcState: string | null; machines: number; error: number; stuck: number; message: string }[];
  alerts: number;
  at: number | null;
  /** Its own health (its disk), as it says it */
  health?: { freePct: number | null; free: number | null; daysLeft: number | null; low: string | null } | null;
  /** Away since (it stopped answering) */
  awaySince?: number | null;
}

/** The board's Sites page: the plant's other gateways, each one's PLCs, machines in error or stuck, open alerts; its board */
export const SitesBoard: React.FC<{ conn: GatewayConnection | null; connected: boolean; subscribe: (fn: (m: { type: string }) => void) => () => void; narrow: boolean }> = ({ conn, connected, subscribe, narrow }) => {
  const [sites, setSites] = useState<Site[]>([]);
  useEffect(
    () =>
      subscribe((m) => {
        if (m.type === 'sitesState') setSites((m as unknown as { sites?: Site[] }).sites ?? []);
      }),
    [subscribe]
  );
  useEffect(() => {
    if (connected && conn) conn.send({ type: 'sitesWatch' });
  }, [connected, conn]);
  const down = (s: Site) => s.plcs.reduce((a, p) => a + p.error + p.stuck, 0);
  const shown = [...sites].sort((a, b) => Number(b.state !== 'connected') - Number(a.state !== 'connected') || down(b) - down(a) || a.name.localeCompare(b.name));
  return (
    <div id="sites-board" className={`flex-1 min-h-0 overflow-y-auto ${narrow ? 'p-2' : 'p-4'}`}>
      {!sites.length && <div className="text-slate-400">{t('No other gateways: the setup page’s Other gateways adds them.')}</div>}
      <div className={`grid ${narrow ? 'gap-2' : 'gap-4 [grid-template-columns:repeat(auto-fill,minmax(24rem,1fr))]'}`}>
        {shown.map((s) => {
          const n = down(s);
          const ok = s.state === 'connected';
          return (
            <div key={s.id} className={`site-card rounded-xl border-2 px-4 py-3 bg-slate-900 ${!ok ? 'border-slate-600' : n ? 'border-rose-600' : 'border-emerald-800'}`} data-site={s.id} data-down={n}>
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-sky-400" />
                <span className="text-lg font-semibold">{s.name}</span>
                <a className="site-open ml-auto flex items-center gap-1 text-sm text-sky-300 hover:text-white" href={`${s.url}/?board`} target="_blank" rel="noreferrer" title={t('Its own board')}>
                  <ExternalLink className="w-4 h-4" /> {t('Its board')}
                </a>
              </div>
              {!ok ? (
                <div className="site-message mt-1 text-sm text-amber-300">
                  {s.message || t('Connecting…')}
                  {s.awaySince ? <span className="site-away ml-1 text-slate-400">· {t('away since {time}', { time: new Date(s.awaySince).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</span> : null}
                </div>
              ) : (
                <>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    {n ? (
                      <span className="flex items-center gap-1 px-2 rounded-full bg-rose-700 text-white"><AlertTriangle className="w-4 h-4" /> {t('{n} stopped', { n })}</span>
                    ) : (
                      <span className="flex items-center gap-1 px-2 rounded-full bg-emerald-800 text-emerald-50"><CheckCircle2 className="w-4 h-4" /> {t('Running')}</span>
                    )}
                    <span className="text-slate-400">{t('{n} open', { n: s.alerts })} · {t('Alerts').toLowerCase()}</span>
                    {s.health?.low ? (
                      <span className="site-disk ml-auto px-2 rounded-full bg-amber-600 text-slate-950 text-xs font-semibold" title={t('Its setup page: Health')}>💽 {t('disk: {why}', { why: s.health.low })}</span>
                    ) : s.health?.freePct !== null && s.health?.freePct !== undefined ? (
                      <span className="site-disk ml-auto text-xs text-slate-500">💽 {t('{n} % free', { n: Math.round(s.health.freePct) })}</span>
                    ) : null}
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {s.plcs.map((p) => (
                      <li key={p.id} className="site-plc flex items-center gap-2" data-plc={p.id}>
                        <span className="font-medium">{p.name}</span>
                        {p.plcState && p.plcState !== 'Run' && <span className="px-1.5 rounded bg-amber-700 text-xs text-white">PLC: {p.plcState}</span>}
                        <span className="ml-auto flex items-center gap-2 text-xs text-slate-400">
                          {t('{n} machines', { n: p.machines })}
                          {p.error > 0 && <span className="flex items-center gap-0.5 text-rose-300"><AlertTriangle className="w-3.5 h-3.5" /> {p.error}</span>}
                          {p.stuck > 0 && <span className="flex items-center gap-0.5 text-amber-300"><Timer className="w-3.5 h-3.5" /> {p.stuck}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
