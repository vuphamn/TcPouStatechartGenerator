import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Megaphone, Timer } from 'lucide-react';
import { formatDuration } from '../utils/liveView.ts';
import type { GatewayConnection } from '../utils/liveGateway.ts';

export interface AndonMachine {
  path: string;
  type: string;
  state: string | null;
  error: boolean;
  stuck: boolean;
  inState: number;
  since: number | null;
}
export interface AndonPlc {
  id: string;
  name: string;
  plcState?: string | null;
  machines: AndonMachine[];
}
export interface AndonCall {
  id: string;
  plc: string;
  machine: string;
  state: string;
  text: string;
  at: string;
  ack: { by: string; at: string; note: string } | null;
  resolvedAt: string | null;
}

const short = (p: string, root: string) => (p.toLowerCase().startsWith(root.toLowerCase() + '.') ? p.slice(root.length + 1) : p);
const ago = (iso: string) => formatDuration(Math.max(0, Date.now() - Date.parse(iso)));

/**
 * The board's Andon page, for the operators by the line: big and plain. The machines that stopped (an error state,
 * stuck) first, each with what to do (the state's description in the code, or the gateway's own steps for it,
 * config.andon.steps) and Call maintenance (a reason, a note: an alert, the chime on every board, the technicians'
 * channel naming who is on call); the others as small green or grey chips; the open calls and who took them.
 */
export const AndonBoard: React.FC<{
  conn: GatewayConnection | null;
  connected: boolean;
  plcs: AndonPlc[];
  root: string;
  calls: AndonCall[];
  canCall: boolean;
  narrow: boolean;
}> = ({ conn, connected, plcs, root, calls, canCall, narrow }) => {
  const [info, setInfo] = useState<{ docs: Record<string, Record<string, string>>; steps: Record<string, string>; reasons: string[] }>({ docs: {}, steps: {}, reasons: [] });
  const [callFor, setCallFor] = useState<{ plc: AndonPlc; machine: AndonMachine | null } | null>(null);
  const [note, setNote] = useState('');
  const [said, setSaid] = useState('');
  const typesKey = useMemo(() => plcs.map((p) => `${p.id}:${[...new Set(p.machines.map((m) => m.type))].sort().join(',')}`).join('|'), [plcs]);
  useEffect(() => {
    if (!connected || !conn || !plcs.length) return;
    let gone = false;
    void Promise.all(plcs.map((p) => conn.request<{ docs?: Record<string, Record<string, string>>; steps?: Record<string, string>; reasons?: string[] }>({ type: 'andonInfo', plc: p.id, types: [...new Set(p.machines.map((m) => m.type))] }, 'andonInfoResult', 60000).catch(() => ({}) as { docs?: Record<string, Record<string, string>>; steps?: Record<string, string>; reasons?: string[] }))).then((rs) => {
      if (gone) return;
      const docs: Record<string, Record<string, string>> = {};
      rs.forEach((r) => Object.assign(docs, r.docs ?? {}));
      setInfo({ docs, steps: rs.find((r) => r.steps)?.steps ?? {}, reasons: rs.find((r) => r.reasons?.length)?.reasons ?? ['Mechanical', 'Electrical', 'Material', 'Quality', 'Safety', 'Other'] });
    });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, conn, typesKey]);
  const todo = (m: AndonMachine) => {
    if (!m.state) return '';
    const type = m.type.split('.').pop() ?? m.type;
    return info.steps[`${type}.${m.state}`] ?? info.steps[m.state] ?? info.docs[type.toLowerCase()]?.[m.state] ?? '';
  };
  const call = async (reason: string) => {
    if (!callFor || !conn) return;
    const c = callFor;
    setCallFor(null);
    try {
      const r = await conn.request<{ ok: boolean; error?: string }>({ type: 'callMaintenance', plc: c.plc.id, machine: c.machine?.path ?? null, reason, note }, 'callMaintenanceResult');
      setSaid(r.ok ? `Maintenance called: ${reason}` : r.error ?? 'Not sent');
    } catch (e) {
      setSaid(e instanceof Error ? e.message : String(e));
    }
    window.setTimeout(() => setSaid(''), 8000);
  };
  const openCalls = calls.filter((c) => !c.resolvedAt);
  return (
    <div id="andon-board" className={`flex-1 min-h-0 overflow-y-auto ${narrow ? 'p-2 space-y-3' : 'p-4 space-y-5'}`}>
      {said && <div id="andon-said" className="px-4 py-2 rounded bg-sky-950 border border-sky-700 text-lg">{said}</div>}
      {openCalls.length > 0 && (
        <div id="andon-calls" className="flex flex-col gap-2">
          {openCalls.map((c) => (
            <div key={c.id} className={`andon-call flex flex-wrap items-center gap-3 rounded-lg border-2 px-4 py-2 text-lg ${c.ack ? 'border-sky-600 bg-sky-950/60' : 'border-amber-500 bg-amber-950/60 board-tile-flash'}`} data-call={c.id}>
              <Megaphone className="w-6 h-6 text-amber-300" />
              <span className="font-semibold">{c.text.replace(/^[^:]*:\s*/, '')}</span>
              <span className="text-base text-slate-300">{ago(c.at)} ago</span>
              <span className={`ml-auto text-base ${c.ack ? 'text-sky-200' : 'text-amber-200'}`}>{c.ack ? `${c.ack.by} is on it${c.ack.note ? `: ${c.ack.note}` : ''}` : 'Waiting for someone to take it'}</span>
            </div>
          ))}
        </div>
      )}
      {plcs.map((p) => {
        const down = p.machines.filter((m) => m.error || m.stuck);
        const up = p.machines.filter((m) => !m.error && !m.stuck);
        return (
          <section key={p.id} className="andon-plc" data-plc={p.id}>
            <h2 className="flex flex-wrap items-center gap-4 mb-3">
              <span className={`${narrow ? 'text-2xl' : 'text-4xl'} font-bold`}>{p.name}</span>
              {down.length ? (
                <span className="flex items-center gap-2 px-4 py-1 rounded-full bg-rose-700 text-2xl font-bold text-white">
                  <AlertTriangle className="w-7 h-7" /> {down.length} stopped
                </span>
              ) : (
                <span className="flex items-center gap-2 px-4 py-1 rounded-full bg-emerald-800 text-2xl font-bold text-emerald-50">
                  <CheckCircle2 className="w-7 h-7" /> Running
                </span>
              )}
              {p.plcState && p.plcState !== 'Run' && <span className="px-3 py-1 rounded-full bg-amber-600 text-xl text-white">PLC: {p.plcState}</span>}
              {canCall && (
                <button type="button" onClick={() => { setNote(''); setCallFor({ plc: p, machine: null }); }} className="andon-call-line ml-auto flex items-center gap-2 px-5 py-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-xl font-bold text-white">
                  <Megaphone className="w-6 h-6" /> Call maintenance
                </button>
              )}
            </h2>
            <div className={`grid ${narrow ? 'gap-2' : 'gap-4 [grid-template-columns:repeat(auto-fill,minmax(26rem,1fr))]'}`}>
              {down.map((m) => (
                <div key={m.path} className={`andon-down rounded-xl border-4 px-5 py-4 ${m.error ? 'border-rose-500 bg-rose-900/80' : 'border-amber-400 bg-amber-600/80 text-slate-950'}`} data-path={m.path}>
                  <div className={`${narrow ? 'text-xl' : 'text-2xl'} font-semibold opacity-90`}>{short(m.path, root)}</div>
                  <div className={`${narrow ? 'text-3xl' : 'text-5xl'} font-black leading-tight break-words`}>{m.state ?? '…'}</div>
                  <div className="mt-1 flex items-center gap-2 text-2xl font-mono">
                    {m.error ? <AlertTriangle className="w-6 h-6" /> : <Timer className="w-6 h-6" />}
                    {m.since ? formatDuration(m.inState) : ''}
                  </div>
                  {todo(m) && (
                    <div className="andon-todo mt-3 rounded-lg bg-slate-950/50 px-3 py-2 text-xl text-white">
                      <span className="text-sm uppercase tracking-wide opacity-70">What to do</span>
                      <div>{todo(m)}</div>
                    </div>
                  )}
                  {canCall && (
                    <button type="button" onClick={() => { setNote(''); setCallFor({ plc: p, machine: m }); }} className="andon-call-machine mt-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-950/70 hover:bg-slate-950 text-xl font-bold text-white">
                      <Megaphone className="w-5 h-5" /> Call maintenance
                    </button>
                  )}
                </div>
              ))}
            </div>
            {up.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {up.map((m) => (
                  <span key={m.path} className={`andon-up px-3 py-1 rounded-full text-lg ${m.state ? 'bg-emerald-900/70 text-emerald-100' : 'bg-slate-800 text-slate-400'}`} data-path={m.path} title={m.state ?? ''}>
                    {short(m.path, root)}
                  </span>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {callFor && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => e.target === e.currentTarget && setCallFor(null)}>
          <div id="andon-call-dialog" className="w-full max-w-lg rounded-xl border border-amber-600 bg-slate-900 p-5 shadow-2xl" onKeyDown={(e) => e.key === 'Escape' && setCallFor(null)}>
            <div className="text-2xl font-bold">Call maintenance</div>
            <div className="mb-4 text-lg text-slate-300">
              {callFor.plc.name}
              {callFor.machine ? ` · ${short(callFor.machine.path, root)}: ${callFor.machine.state ?? ''}` : ''}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {info.reasons.map((r) => (
                <button key={r} type="button" onClick={() => void call(r)} className="andon-reason px-4 py-3 rounded-lg border-2 border-slate-600 hover:border-amber-500 hover:bg-slate-800 text-xl font-semibold text-left">
                  {r}
                </button>
              ))}
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you see (optional)" className="mt-4 w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-lg select-text" maxLength={200} />
          </div>
        </div>
      )}
    </div>
  );
};
