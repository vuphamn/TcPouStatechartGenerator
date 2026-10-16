import React, { useEffect, useState } from 'react';
import type { GatewayConnection } from '../utils/liveGateway.ts';

/** The maintenance KPIs as the gateway sums them up (gateway/kpis.cjs) */
interface Kpis {
  window: { from: number; to: number; days: number };
  pm: { due: number; onTime: number; late: number; overdue: number; compliance: number | null };
  backlog: { open: number; byAge: { label: string; n: number }[]; byPriority: Record<string, number>; oldest: { id: string; number: number; title: string; ageMs: number } | null };
  planned: { pm: number; other: number; share: number | null };
  trend: { week: string; orders: number; mttrMs: number | null; alerts: number; alertMttrMs: number | null }[];
  parts: { plcName: string; machine: string; qty: number; parts: { number: string; qty: number }[] }[];
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)} %`);
const dur = (ms: number | null) => (ms === null ? '—' : ms < 3600000 ? `${Math.round(ms / 60000)} min` : ms < 2 * 86400000 ? `${(ms / 3600000).toFixed(1)} h` : `${(ms / 86400000).toFixed(1)} days`);
const short = (p: string, root: string) => (p.toLowerCase().startsWith(root.toLowerCase() + '.') ? p.slice(root.length + 1) : p);

const Card: React.FC<{ id: string; title: string; value: string; detail: string; tone?: 'good' | 'bad' | 'plain' }> = ({ id, title, value, detail, tone = 'plain' }) => (
  <div className="work-kpi rounded-lg border border-slate-800 bg-slate-900 px-3 py-2" data-kpi={id}>
    <div className="text-xs text-slate-400">{title}</div>
    <div className={`text-2xl font-semibold ${tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-amber-300' : 'text-slate-100'}`}>{value}</div>
    <div className="text-xs text-slate-500">{detail}</div>
  </div>
);

/**
 * The Work page's KPIs: preventive maintenance compliance, the backlog (by age, by priority, its oldest), planned
 * against unplanned work, MTTR by week (work orders, error alerts), the parts used per machine; over 7, 30, 90 or
 * 365 days
 */
export const WorkKpis: React.FC<{ conn: GatewayConnection | null; connected: boolean; root: string; onOpen: (id: string) => void }> = ({ conn, connected, root, onOpen }) => {
  const [days, setDays] = useState(30);
  const [k, setK] = useState<Kpis | null>(null);
  useEffect(() => {
    if (!connected || !conn) return;
    let live = true;
    void conn
      .request<Kpis>({ type: 'maintenanceKpis', days }, 'maintenanceKpisResult', 60000)
      .then((r) => live && r?.pm && setK(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [connected, conn, days]);
  if (!k) return <div className="text-slate-400">Summing up…</div>;
  const maxMttr = Math.max(1, ...k.trend.map((w) => Math.max(w.mttrMs ?? 0, w.alertMttrMs ?? 0)));
  return (
    <div id="work-kpis" className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        Over
        <select id="work-kpis-days" value={days} onChange={(e) => setDays(Number(e.target.value))} className="bg-slate-900 border border-slate-700 rounded px-2 py-1">
          {[7, 30, 90, 365].map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
        <Card id="pm" title="Preventive maintenance done on time" value={pct(k.pm.compliance)} detail={`${k.pm.onTime} of ${k.pm.due} due${k.pm.overdue ? ` · ${k.pm.overdue} overdue now` : ''}`} tone={k.pm.compliance === null ? 'plain' : k.pm.compliance >= 0.9 ? 'good' : 'bad'} />
        <Card id="backlog" title="Backlog: open work orders" value={String(k.backlog.open)} detail={k.backlog.oldest ? `the oldest #${k.backlog.oldest.number}, ${dur(k.backlog.oldest.ageMs)}` : 'none open'} tone={k.backlog.byAge[3]?.n ? 'bad' : 'plain'} />
        <Card id="planned" title="Planned work (preventive) of all done" value={pct(k.planned.share)} detail={`${k.planned.pm} preventive, ${k.planned.other} other`} />
        <Card id="mttr" title="MTTR this week (work orders)" value={dur(k.trend[k.trend.length - 1]?.mttrMs ?? null)} detail={`error alerts: ${dur(k.trend[k.trend.length - 1]?.alertMttrMs ?? null)} to recover`} />
      </div>
      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-1">The backlog by age</h3>
        <div className="flex flex-wrap gap-2 text-sm">
          {k.backlog.byAge.map((b) => (
            <span key={b.label} className={`work-kpi-age px-2 py-0.5 rounded border ${b.label === '> 30 days' && b.n ? 'border-amber-600 text-amber-200' : 'border-slate-700 text-slate-300'}`} data-age={b.label}>
              {b.label}: {b.n}
            </span>
          ))}
          <span className="text-slate-500">· {Object.entries(k.backlog.byPriority).filter(([, n]) => n).map(([p, n]) => `${n} ${p}`).join(', ') || 'none'}</span>
          {k.backlog.oldest && (
            <button type="button" className="underline decoration-dotted text-slate-300 hover:text-white" onClick={() => onOpen(k.backlog.oldest!.id)}>
              #{k.backlog.oldest.number} {k.backlog.oldest.title}
            </button>
          )}
        </div>
      </section>
      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-1">MTTR by week</h3>
        <table id="work-kpis-trend" className="text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pr-3">Week of</th>
              <th className="pr-3">Work orders</th>
              <th className="pr-3 w-40">MTTR</th>
              <th className="pr-3">Error alerts</th>
              <th className="w-40">To recover</th>
            </tr>
          </thead>
          <tbody>
            {k.trend.map((w) => (
              <tr key={w.week} className="work-kpi-week border-t border-slate-800" data-week={w.week}>
                <td className="pr-3 font-mono">{w.week}</td>
                <td className="pr-3">{w.orders}</td>
                <td className="pr-3">
                  <span className="inline-block h-2 rounded bg-sky-600 align-middle mr-1" style={{ width: `${((w.mttrMs ?? 0) / maxMttr) * 6}rem` }} />
                  {dur(w.mttrMs)}
                </td>
                <td className="pr-3">{w.alerts}</td>
                <td>
                  <span className="inline-block h-2 rounded bg-rose-600 align-middle mr-1" style={{ width: `${((w.alertMttrMs ?? 0) / maxMttr) * 6}rem` }} />
                  {dur(w.alertMttrMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-1">Parts used per machine (from stock, by work order)</h3>
        {!k.parts.length && <div className="text-xs text-slate-500">None taken from stock in this window.</div>}
        <table id="work-kpis-parts" className="text-xs">
          <tbody>
            {k.parts.map((p) => (
              <tr key={`${p.plcName}|${p.machine}`} className="work-kpi-parts border-t border-slate-800" data-machine={p.machine}>
                <td className="pr-3 py-0.5">{p.plcName}</td>
                <td className="pr-3">{short(p.machine, root)}</td>
                <td className="pr-3 font-semibold">{p.qty}</td>
                <td className="text-slate-400">{p.parts.map((x) => `${x.qty} × ${x.number}`).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
};
