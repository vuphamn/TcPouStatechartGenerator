import React, { useEffect, useMemo, useState } from 'react';
import { AlarmHealth } from './AlarmHealth.tsx';
import { ChangesList, type PlcChange } from './ChangesList.tsx';
import { AlertTriangle, ChevronDown, ChevronRight, Download, Gauge, Cpu, ListChecks, Search, ShieldAlert, X } from 'lucide-react';
import type { GatewayConnection } from '../utils/liveGateway.ts';

/** A risk (gateway/risk.cjs) */
export interface RiskItem {
  id: string;
  kind: 'drive' | 'box' | 'machine';
  plc: string;
  plcName: string;
  name: string;
  path: string;
  where: string;
  level: 'alarm' | 'warn' | 'watch';
  reason: string;
  eta: number | null;
  trend?: number[];
}
/** The inventory: boxes by maker, type and firmware */
export interface InventoryRow {
  vendor: string;
  type: string;
  revision: string;
  productCode: string;
  count: number;
  disabled: number;
  places: { plc: string; plcName: string; path: string; name: string }[];
}
type Msg = { type: string; risks?: RiskItem[]; inventory?: InventoryRow[]; plcs?: { id: string; name: string; state: string; message: string }[]; at?: number; error?: string };

const LEVEL = {
  alarm: { text: 'Alarm', cls: 'bg-rose-700 text-white' },
  warn: { text: 'Warning', cls: 'bg-amber-500 text-slate-950' },
  watch: { text: 'Watch', cls: 'bg-sky-700 text-white' },
} as const;
const KIND = { drive: Gauge, box: Cpu, machine: AlertTriangle };

const Spark: React.FC<{ values: number[] }> = ({ values }) => {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * 70 + 1).toFixed(1)},${(15 - ((v - lo) / (hi - lo || 1)) * 14).toFixed(1)}`).join('');
  return (
    <svg width={72} height={16} className="shrink-0">
      <path d={d} fill="none" stroke="#f59e0b" strokeWidth={1.3} />
    </svg>
  );
};

/**
 * The board's Risk page, for a maintenance supervisor: across every PLC, what to look at first (a drive's findings, its
 * heatsink rising toward its threshold "in about N days", an I/O box out of OP or its CRC errors rising, a machine
 * faulting more than the week before), worst first; and the Inventory: every I/O box by maker, type and firmware
 * (how many, where; a type with several firmware versions marked), CSV.
 */
export const RiskBoard: React.FC<{ conn: GatewayConnection | null; connected: boolean; subscribe: (fn: (m: Msg) => void) => () => void; plcIds: string[]; narrow: boolean; onWork?: (r: RiskItem) => void; onBadActor?: (a: { plc: string; plcName: string; machine: string; state: string; why: string }) => void; root?: string; canExplain?: boolean; canApprove?: boolean }> = ({ conn, connected, subscribe, plcIds, narrow, onWork, onBadActor, root = '', canExplain = false, canApprove = false }) => {
  const [tab, setTab] = useState<'risk' | 'inventory' | 'alarms' | 'changes'>('risk');
  const [changes, setChanges] = useState<PlcChange[]>([]);
  useEffect(
    () =>
      subscribe((m) => {
        if ((m as { type: string }).type === 'changes') setChanges((m as unknown as { changes?: PlcChange[] }).changes ?? []);
      }),
    [subscribe]
  );
  useEffect(() => {
    if (connected && conn) conn.send({ type: 'changesWatch' });
  }, [connected, conn]);
  const openChanges = changes.filter((c) => !c.approvedBy).length;
  const [risks, setRisks] = useState<RiskItem[]>([]);
  const [inv, setInv] = useState<InventoryRow[]>([]);
  const [plcs, setPlcs] = useState<{ id: string; name: string; state: string; message: string }[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(
    () =>
      subscribe((m) => {
        if (m.type !== 'fleetState') return;
        setRisks(m.risks ?? []);
        setInv(m.inventory ?? []);
        setPlcs(m.plcs ?? []);
        setAt(m.at ?? Date.now());
        setError(m.error ?? '');
      }),
    [subscribe]
  );
  useEffect(() => {
    if (!connected || !conn) return;
    conn.send({ type: 'fleetWatch', plcs: plcIds });
    return () => {
      conn.send({ type: 'fleetStop' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, conn, plcIds.join(',')]);
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const shownRisks = risks.filter((r) => words.every((w) => `${r.name} ${r.where} ${r.reason} ${r.kind}`.toLowerCase().includes(w)));
  const shownInv = inv.filter((g) => words.every((w) => `${g.vendor} ${g.type} ${g.revision} ${g.places.map((p) => `${p.plcName} ${p.name}`).join(' ')}`.toLowerCase().includes(w)));
  // (a type in several firmware versions: by maker and product code)
  const versions = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const g of inv) {
      const k = `${g.vendor}|${g.productCode || g.type}`;
      if (!m.has(k)) m.set(k, new Set());
      m.get(k)!.add(g.revision);
    }
    return m;
  }, [inv]);
  const csv = () => {
    const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = tab === 'risk' ? ['level,kind,name,where,reason,days left', ...shownRisks.map((r) => [r.level, r.kind, q(r.name), q(r.where), q(r.reason), r.eta ?? ''].join(','))] : ['vendor,type,firmware,product code,count,disabled,where', ...shownInv.map((g) => [q(g.vendor), q(g.type), q(g.revision), q(g.productCode), g.count, g.disabled, q([...new Set(g.places.map((p) => p.plcName))].join('; '))].join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\r\n') + '\r\n'], { type: 'text/csv' }));
    a.download = `${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  const counts = (['alarm', 'warn', 'watch'] as const).map((l) => [l, risks.filter((r) => r.level === l).length] as const);
  return (
    <div id="risk-board" className="flex-1 min-h-0 flex flex-col">
      <div className={`flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/60 ${narrow ? 'px-2 py-1.5' : 'px-4 py-2'}`}>
        <span className="flex items-center rounded border border-slate-700 overflow-hidden text-sm">
          <button id="risk-tab-risk" type="button" onClick={() => setTab('risk')} className={`flex items-center gap-1 px-2 py-1 ${tab === 'risk' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
            <ShieldAlert className="w-4 h-4" /> Risk
          </button>
          <button id="risk-tab-inventory" type="button" onClick={() => setTab('inventory')} className={`flex items-center gap-1 px-2 py-1 ${tab === 'inventory' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
            <ListChecks className="w-4 h-4" /> Inventory
          </button>
          <button id="risk-tab-alarms" type="button" onClick={() => setTab('alarms')} className={`flex items-center gap-1 px-2 py-1 ${tab === 'alarms' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`} title="Alarm health: the alert history as ISA-18.2 measures an alarm system">
            <ShieldAlert className="w-4 h-4" /> Alarm health
          </button>
          <button id="risk-tab-changes" type="button" onClick={() => setTab('changes')} className={`flex items-center gap-1 px-2 py-1 ${tab === 'changes' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`} title="Changes of the PLCs' programs and the drives' settings: explained, approved">
            <ListChecks className="w-4 h-4" /> Changes{openChanges ? <span className="ml-1 px-1.5 rounded-full bg-amber-500 text-slate-950 text-xs font-semibold">{openChanges}</span> : null}
          </button>
        </span>
        <span className="relative flex items-center">
          <Search className="absolute left-2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input id="risk-filter" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setFilter('')} placeholder={tab === 'risk' ? 'Filter: name, PLC, reason…' : 'Filter: maker, type, firmware, PLC…'} className={`${narrow ? 'w-44' : 'w-72'} pl-7 pr-7 py-1 rounded bg-slate-950 border border-slate-700 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-600 select-text`} />
          {filter && (
            <button type="button" onClick={() => setFilter('')} className="absolute right-1.5 p-0.5 rounded text-slate-400 hover:text-white" title="Clear the filter">
              <X className="w-4 h-4" />
            </button>
          )}
        </span>
        {tab === 'risk' && (
          <span id="risk-counts" className="flex items-center gap-2 text-sm text-slate-400">
            {risks.length ? '' : 'Nothing to look at'}
            {counts.map(([l, n]) => (n ? <span key={l} className={`px-2 rounded-full ${LEVEL[l].cls}`}>{n} {LEVEL[l].text.toLowerCase()}</span> : null))}
          </span>
        )}
        {tab === 'inventory' && <span className="text-sm text-slate-400">{inv.reduce((a, g) => a + g.count, 0)} boxes, {inv.length} kinds</span>}
        <span className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          {at && `as of ${new Date(at).toLocaleTimeString()}`}
          <button type="button" onClick={csv} className="p-1 rounded hover:bg-slate-800" title="CSV of what is shown">
            <Download className="w-4 h-4" />
          </button>
        </span>
      </div>
      {tab === 'changes' && (
        <div className={`flex-1 min-h-0 overflow-y-auto ${narrow ? 'p-2' : 'p-4'}`}>
          <ChangesList conn={conn} changes={changes} canExplain={canExplain} canApprove={canApprove} />
        </div>
      )}
      {tab === 'alarms' && (
        <div className={`flex-1 min-h-0 overflow-y-auto ${narrow ? 'p-2' : 'p-4'}`}>
          <AlarmHealth conn={conn} connected={connected} plcIds={plcIds} root={root} onTask={onBadActor} canRationalize={canApprove} />
        </div>
      )}
      <div className={`flex-1 min-h-0 overflow-y-auto ${narrow ? 'p-2' : 'p-4'} ${tab === 'alarms' || tab === 'changes' ? 'hidden' : ''}`}>
        {error && <div className="mb-2 px-4 py-2 rounded bg-rose-950 border border-rose-800 text-rose-200">{error}</div>}
        {plcs.filter((p) => p.state === 'error' || p.message).map((p) => (
          <div key={p.id} className="mb-1 text-xs text-amber-300">
            {p.name}: {p.message || p.state}
          </div>
        ))}
        {tab === 'risk' ? (
          <ul className="space-y-1.5">
            {!shownRisks.length && <li className="text-slate-400">{risks.length ? 'Nothing matches the filter.' : 'Nothing to look at: no drive, box or machine shows a risk.'}</li>}
            {shownRisks.map((r) => {
              const Icon = KIND[r.kind];
              return (
                <li key={r.id} className="risk-item flex items-center gap-2 rounded border border-slate-800 bg-slate-900 px-3 py-2" data-risk={r.id} data-level={r.level}>
                  <span className={`shrink-0 w-16 text-center px-1.5 rounded-full text-xs font-semibold ${LEVEL[r.level].cls}`}>{LEVEL[r.level].text}</span>
                  <Icon className="w-4 h-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{r.name}</span> <span className="text-xs text-slate-500">{r.where}</span>
                    <div className="text-sm text-slate-300">{r.reason}</div>
                  </span>
                  {r.trend && <Spark values={r.trend} />}
                  {r.eta !== null && <span className="risk-eta shrink-0 px-2 rounded-full border border-amber-600 text-xs text-amber-200" title="At this rate">≈ {r.eta} days</span>}
                  {onWork && (
                    <button type="button" onClick={() => onWork(r)} className="risk-work shrink-0 px-2 py-0.5 rounded border border-slate-600 text-xs hover:bg-slate-800" title="A work order for it">
                      Work order
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <table id="risk-inventory" className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 text-xs">
                <th className="py-1">Maker</th>
                <th>Type</th>
                <th>Firmware</th>
                <th className="text-right">How many</th>
                <th className="pl-3">Where</th>
              </tr>
            </thead>
            <tbody>
              {shownInv.map((g) => {
                const k = `${g.vendor}|${g.type}|${g.revision}`;
                const several = (versions.get(`${g.vendor}|${g.productCode || g.type}`)?.size ?? 1) > 1;
                const isOpen = open.has(k);
                return (
                  <React.Fragment key={k}>
                    <tr className="inventory-row border-t border-slate-800 cursor-pointer hover:bg-slate-900" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} data-type={g.type} data-revision={g.revision}>
                      <td className="py-1">
                        {isOpen ? <ChevronDown className="inline w-3.5 h-3.5" /> : <ChevronRight className="inline w-3.5 h-3.5" />} {g.vendor}
                      </td>
                      <td>{g.type}</td>
                      <td className={several ? 'text-amber-300' : ''} title={several ? `This type runs ${versions.get(`${g.vendor}|${g.productCode || g.type}`)?.size} firmware versions across the fleet` : undefined}>
                        {g.revision || '—'}
                        {several && ' ⚑'}
                      </td>
                      <td className="text-right font-mono">{g.count}{g.disabled ? ` (${g.disabled} off)` : ''}</td>
                      <td className="pl-3 text-slate-400 truncate max-w-[24rem]">{[...new Set(g.places.map((p) => p.plcName))].join(', ')}</td>
                    </tr>
                    {isOpen &&
                      g.places.map((p) => (
                        <tr key={`${p.plc}|${p.path}`} className="text-xs text-slate-400">
                          <td />
                          <td colSpan={4} className="py-0.5 font-mono">
                            {p.plcName}: {p.path.replace(/\^/g, ' › ')}
                          </td>
                        </tr>
                      ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
