import React from 'react';
import { AlertTriangle, Cog } from 'lucide-react';

/** A PLC's servo axes, as the gateway judges them (gateway/axes.cjs) */
export interface AxesPlc {
  id: string;
  name: string;
  state: string;
  message: string;
  lastRound: number | null;
  axes: {
    path: string;
    name: string;
    latest: Record<string, number | null>;
    today: { lagP95: number | null; torqueP95: number | null; n: number };
    health: { level: 'ok' | 'watch' | 'warn' | 'alarm'; findings: { level: string; key: string; text: string }[]; baseline: { lag?: number; torque?: number } } | null;
  }[];
}

const LEVEL = {
  alarm: { text: 'Alarm', cls: 'bg-rose-700 text-white', border: 'border-rose-500' },
  warn: { text: 'Warning', cls: 'bg-amber-500 text-slate-950', border: 'border-amber-400' },
  watch: { text: 'Watch', cls: 'bg-sky-700 text-white', border: 'border-sky-600' },
  ok: { text: 'Healthy', cls: 'bg-emerald-800 text-emerald-100', border: 'border-emerald-900' },
} as const;
const num = (x: number | null | undefined, d = 3) => (typeof x === 'number' ? String(+x.toPrecision(d)) : '—');

/**
 * The Drives page's servo axes (every AXIS_REF of the PLCs' programs): moving or not, its following error and torque
 * today (95 %, while moving) against its own past, an NC error; worst first
 */
export const AxesList: React.FC<{ plcs: AxesPlc[]; filter: string[]; problemsOnly: boolean; narrow: boolean }> = ({ plcs, filter, problemsOnly, narrow }) => {
  const rank = { alarm: 0, warn: 1, watch: 2, ok: 3 } as const;
  const shown = plcs
    .map((p) => ({ ...p, axes: p.axes.filter((a) => (!problemsOnly || (a.health && a.health.level !== 'ok')) && filter.every((w) => `${p.name} ${a.name} ${a.path} ${(a.health?.findings ?? []).map((f) => f.text).join(' ')}`.toLowerCase().includes(w))).sort((a, b) => rank[a.health?.level ?? 'ok'] - rank[b.health?.level ?? 'ok'] || a.name.localeCompare(b.name)) }))
    .filter((p) => p.axes.length);
  if (!shown.length) return null;
  return (
    <div id="axes-list" className="space-y-3">
      {shown.map((p) => (
        <section key={p.id}>
          <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">
            <Cog className="w-4 h-4 text-sky-400" /> {p.name}: servo axes <span className="text-sm font-normal text-slate-400">{p.axes.length}</span>
          </h2>
          <div className={`grid ${narrow ? 'gap-2 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]' : 'gap-3 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]'}`}>
            {p.axes.map((a) => {
              const L = LEVEL[a.health?.level ?? 'ok'];
              const moving = typeof a.latest.SetVelo === 'number' && Math.abs(a.latest.SetVelo) > 1e-6;
              return (
                <div key={a.path} className={`axis-card rounded-lg border-2 ${L.border} bg-slate-900 px-3 py-2`} data-axis={a.path} data-level={a.health?.level ?? 'ok'}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">{a.name}</span>
                    <span className="text-xs text-slate-400">{moving ? 'moving' : 'standing'}</span>
                    <span className={`ml-auto shrink-0 px-2 rounded-full text-xs font-semibold ${L.cls}`}>{L.text}</span>
                  </div>
                  <div className="truncate text-[11px] text-slate-500">{a.path}</div>
                  <div className="mt-1 grid grid-cols-3 gap-1 text-xs text-slate-300">
                    <span title="Its following error (PosDiff), 95 % of today's while moving; its usual">lag {num(a.today.lagP95)}{a.health?.baseline.lag ? <span className="text-slate-500"> / {num(a.health.baseline.lag)}</span> : null}</span>
                    <span title="Its torque (ActTorque), 95 % of today's while moving; its usual">torque {num(a.today.torqueP95)}{a.health?.baseline.torque ? <span className="text-slate-500"> / {num(a.health.baseline.torque)}</span> : null}</span>
                    <span title="Its actual velocity now">v {num(a.latest.ActVelo)}</span>
                  </div>
                  {(a.health?.findings ?? []).map((f, i) => (
                    <div key={i} className={`axis-finding mt-1 flex gap-1 text-xs ${f.level === 'alarm' ? 'text-rose-300' : f.level === 'warn' ? 'text-amber-200' : 'text-sky-300'}`}>
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                      <span>{f.text}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};
