import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, ClipboardList, ExternalLink, Megaphone, Timer } from 'lucide-react';
import { formatDuration } from '../utils/liveView.ts';
import type { GatewayConnection } from '../utils/liveGateway.ts';
import type { WorkOrder, WorkDraft } from './WorkBoard.tsx';
import type { FaultSummary } from './FaultViewer.tsx';

export interface FocusMachine {
  path: string;
  type: string;
  state: string | null;
  error: boolean;
  stuck: boolean;
  inState: number;
  since: number | null;
}
interface FocusAlert {
  id: string;
  event: string;
  machine: string;
  text: string;
  at: string;
  ack: { by: string } | null;
  resolvedAt: string | null;
}

const short = (p: string, root: string) => (p.toLowerCase().startsWith(root.toLowerCase() + '.') ? p.slice(root.length + 1) : p);

/**
 * One machine, on a phone (a QR label scanned: ?board&focus=m:<plc>|<path>): its state big, how long, what to do;
 * its latest alerts, fault records and open work orders; Call maintenance, a work order, its diagram live; back to
 * the whole board.
 */
export const FocusView: React.FC<{
  conn: GatewayConnection | null;
  connected: boolean;
  subscribe: (fn: (m: { type: string; orders?: WorkOrder[] }) => void) => () => void;
  plc: { id: string; name: string };
  machine: FocusMachine | null;
  path: string;
  root: string;
  alerts: FocusAlert[];
  faults: FaultSummary[];
  canCall: boolean;
  canWork: boolean;
  diagramUrl: string | null;
  onWork: (d: WorkDraft) => void;
  onFault: (id: string) => void;
  onClose: () => void;
}> = ({ conn, connected, subscribe, plc, machine: m, path, root, alerts, faults, canCall, canWork, diagramUrl, onWork, onFault, onClose }) => {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [info, setInfo] = useState<{ todo: string; reasons: string[] }>({ todo: '', reasons: [] });
  const [calling, setCalling] = useState(false);
  const [said, setSaid] = useState('');
  useEffect(() => subscribe((msg) => msg.type === 'workOrders' && setOrders(msg.orders ?? [])), [subscribe]);
  useEffect(() => {
    if (!connected || !conn) return;
    if (canWork) conn.send({ type: 'workWatch' });
    return () => {
      if (canWork) conn.send({ type: 'workStop' });
    };
  }, [connected, conn, canWork]);
  const type = m?.type.split('.').pop() ?? '';
  useEffect(() => {
    if (!connected || !conn || !type) return;
    void conn
      .request<{ docs?: Record<string, Record<string, string>>; steps?: Record<string, string>; reasons?: string[] }>({ type: 'andonInfo', plc: plc.id, types: [type] }, 'andonInfoResult', 60000)
      .then((r) => {
        const s = m?.state ?? '';
        setInfo({ todo: r.steps?.[`${type}.${s}`] ?? r.steps?.[s] ?? r.docs?.[type.toLowerCase()]?.[s] ?? '', reasons: r.reasons ?? [] });
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, conn, plc.id, type, m?.state]);
  const p = path.toLowerCase();
  const mine = (x: string | null) => (x ?? '').toLowerCase() === p;
  const open = orders.filter((o) => o.plc === plc.id && mine(o.machine) && o.status !== 'done' && o.status !== 'cancelled');
  const call = async (reason: string) => {
    setCalling(false);
    const r = await conn?.request<{ ok: boolean; error?: string }>({ type: 'callMaintenance', plc: plc.id, machine: path, reason, note: '' }, 'callMaintenanceResult').catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    setSaid(r?.ok ? `Maintenance called: ${reason}` : r?.error ?? 'Not sent');
  };
  const down = !!m && (m.error || m.stuck);
  return (
    <div id="focus-view" className="fixed inset-0 z-30 overflow-y-auto bg-slate-950 text-slate-100">
      <div className="sticky top-0 flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2">
        <button id="focus-back" type="button" onClick={onClose} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-800 text-sm">
          <ArrowLeft className="w-4 h-4" /> The whole board
        </button>
        <span className="ml-auto text-sm text-slate-400">{plc.name}</span>
      </div>
      <div className="p-4 space-y-4 max-w-xl mx-auto">
        <div className={`rounded-xl border-4 px-4 py-3 ${!m ? 'border-slate-700' : m.error ? 'border-rose-500 bg-rose-900/70' : m.stuck ? 'border-amber-400 bg-amber-600/80 text-slate-950' : m.state ? 'border-emerald-700 bg-emerald-950' : 'border-slate-700'}`} data-path={path}>
          <div className="text-xl font-semibold">{short(path, root)}</div>
          <div id="focus-state" className="text-4xl font-black break-words">{m?.state ?? (m ? '…' : 'Not on this board')}</div>
          {m?.since && (
            <div className="flex items-center gap-2 text-xl font-mono">
              {m.error ? <AlertTriangle className="w-5 h-5" /> : m.stuck ? <Timer className="w-5 h-5" /> : null}
              {formatDuration(m.inState)}
            </div>
          )}
          {info.todo && (
            <div id="focus-todo" className="mt-2 rounded bg-slate-950/60 px-3 py-2 text-lg text-white">
              <div className="text-xs uppercase tracking-wide opacity-70">What to do</div>
              {info.todo}
            </div>
          )}
        </div>
        {said && <div className="rounded bg-sky-950 border border-sky-700 px-3 py-2">{said}</div>}
        <div className="flex flex-wrap gap-2">
          {canCall && (
            <button id="focus-call" type="button" onClick={() => setCalling((v) => !v)} className={`flex items-center gap-2 px-4 py-3 rounded-lg text-lg font-bold text-white ${down ? 'bg-amber-600 hover:bg-amber-500' : 'bg-slate-700 hover:bg-slate-600'}`}>
              <Megaphone className="w-5 h-5" /> Call maintenance
            </button>
          )}
          {canWork && (
            <button id="focus-work" type="button" onClick={() => onWork({ title: `${m?.state ?? 'Check'} at ${short(path, root)}`, plc: plc.id, plcName: plc.name, machine: path, priority: down ? 'high' : 'normal', source: { kind: 'qr', text: `${plc.name}: ${short(path, root)} (${m?.state ?? ''})` } })} className="flex items-center gap-2 px-4 py-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-lg font-bold">
              <ClipboardList className="w-5 h-5" /> Work order
            </button>
          )}
          {diagramUrl && (
            <a href={diagramUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-4 py-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-lg">
              <ExternalLink className="w-5 h-5" /> Its diagram, live
            </a>
          )}
        </div>
        {calling && (
          <div className="grid grid-cols-2 gap-2">
            {info.reasons.map((r) => (
              <button key={r} type="button" onClick={() => void call(r)} className="focus-reason px-3 py-3 rounded-lg border-2 border-slate-600 hover:border-amber-500 text-lg font-semibold">
                {r}
              </button>
            ))}
          </div>
        )}
        {open.length > 0 && (
          <section>
            <h3 className="mb-1 font-semibold">Open work orders</h3>
            {open.map((o) => (
              <div key={o.id} className="focus-order rounded border border-slate-800 px-3 py-2 text-sm">
                #{o.number} {o.title} · <span className="text-sky-300">{o.status}{o.assignee ? `, ${o.assignee}` : ''}</span>
              </div>
            ))}
          </section>
        )}
        {faults.length > 0 && (
          <section>
            <h3 className="mb-1 font-semibold">Fault records</h3>
            {faults.slice(0, 5).map((f) => (
              <button key={f.id} type="button" onClick={() => onFault(f.id)} className="focus-fault block w-full text-left rounded border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm hover:bg-rose-950/70">
                {new Date(f.at).toLocaleString()} · <b className="text-rose-300">{f.state}</b>
              </button>
            ))}
          </section>
        )}
        <section>
          <h3 className="mb-1 font-semibold">Latest alerts</h3>
          {!alerts.length && <div className="text-sm text-slate-500">None lately.</div>}
          {alerts.slice(0, 6).map((a) => (
            <div key={a.id} className="focus-alert border-b border-slate-800 py-1 text-sm">
              <span className="font-mono text-xs text-slate-500">{new Date(a.at).toLocaleString()}</span> {a.text.replace(/^[^:]*:\s*/, '')}
              {a.ack ? <span className="text-emerald-300"> · {a.ack.by}</span> : null}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
};
