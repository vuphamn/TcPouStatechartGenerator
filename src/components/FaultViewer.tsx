import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardList, X } from 'lucide-react';
import { BoardPlayback } from './BoardPlayback.tsx';
import { SignalTrends, type SignalSeries } from './SignalTrends.tsx';
import type { PlaybackMachine } from '../utils/boardPlayback.ts';
import type { GatewayConnection } from '../utils/liveGateway.ts';
import type { WorkDraft } from './WorkBoard.tsx';

/** A fault record as the gateway keeps it (gateway/faults.cjs) */
export interface FaultRecord {
  id: string;
  plc: string;
  plcName: string;
  machine: string;
  type: string;
  state: string;
  at: number;
  from: number;
  to: number;
  root: string;
  stateNames: Record<string, Record<string, string>>;
  machines: Record<string, { t: number; v: number }[]>;
  signals: Record<string, { t: number; v: unknown }[]>;
  complete: boolean;
  /** The PLC's TwinCAT logged events of its window (imported on the setup page) */
  events?: { t: number; severity: string; source: string; text: string; eventClass: string; eventId: string; state: string }[];
  /** The work orders made of it */
  orders?: { id: string; number: number; title: string; status: string; assignee: string | null }[];
}
export interface FaultSummary {
  id: string;
  plc: string;
  plcName: string;
  machine: string;
  type: string;
  state: string;
  at: number;
  machines: number;
  signals: number;
  complete: boolean;
}

const ERROR_STATE = /ERROR|FAULT|ALARM|E_?STOP|ABORT/i;
const clock = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const short = (p: string, root: string) => (p.toLowerCase().startsWith(root.toLowerCase() + '.') ? p.slice(root.length + 1) : p);

/**
 * One fault record: the minute before a machine went into an error state and the minute after, as the gateway kept
 * it by itself. A lane per machine (the faulted one first, then the ones that changed; the ones that did not, on
 * request), the moment of the fault marked; the cursor moves through it (play, the change before or after); the
 * signals kept with it charted over the same two minutes.
 */
export const FaultViewer: React.FC<{ conn: GatewayConnection | null; id: string; onClose: () => void; narrow: boolean; onWork?: (d: WorkDraft) => void }> = ({ conn, id, onClose, narrow, onWork }) => {
  const [rec, setRec] = useState<FaultRecord | null>(null);
  const [error, setError] = useState('');
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showAll, setShowAll] = useState(false);
  // (what changes before this kind of fault: its machine's records into the same state)
  const [corr, setCorr] = useState<{ records: number; items: { name: string; kind: string; hits: number; of: number; rate: number; usualRate: number; before: unknown }[] } | null>(null);
  useEffect(() => {
    if (!conn) return;
    let gone = false;
    void conn.request<{ records?: number; items?: { name: string; kind: string; hits: number; of: number; rate: number; usualRate: number; before: unknown }[] }>({ type: 'faultCorrelation', id }, 'faultCorrelationResult', 60000).then((r) => !gone && r.items && setCorr({ records: r.records ?? 0, items: r.items })).catch(() => {});
    return () => {
      gone = true;
    };
  }, [conn, id]);
  useEffect(() => {
    let gone = false;
    const load = () =>
      conn
        ?.request<{ fault?: FaultRecord; error?: string }>({ type: 'faultGet', id }, 'faultGetResult', 30000)
        .then((r) => {
          if (gone) return;
          if (!r.fault) return setError(r.error ?? 'No such fault record');
          setRec(r.fault);
          setT((x) => x || r.fault!.at);
          // (still taking its minute after: read again until it is complete)
          if (!r.fault.complete) window.setTimeout(load, 5000);
        })
        .catch((e: unknown) => !gone && setError(e instanceof Error ? e.message : String(e)));
    void load();
    return () => {
      gone = true;
    };
  }, [conn, id]);
  useEffect(() => {
    if (!playing || !rec) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const n = performance.now();
      const dt = n - last;
      last = n;
      setT((x) => {
        const next = Math.min(rec.to, x + dt * speed);
        if (next >= rec.to) setPlaying(false);
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing, rec, speed]);
  const machines: PlaybackMachine[] = useMemo(() => {
    if (!rec) return [];
    const all = Object.entries(rec.machines).map(([p, values]) => ({ plc: rec.plc, path: p, recording: rec.id, stateNames: rec.stateNames[p] ?? {}, values: values.map((x) => ({ t: x.t, value: x.v })) }));
    const changed = (m: PlaybackMachine) => m.values.some((x, i) => i > 0 && x.value !== m.values[i - 1].value);
    return all
      .filter((m) => showAll || m.path === rec.machine || changed(m))
      .sort((a, b) => (a.path === rec.machine ? -1 : b.path === rec.machine ? 1 : a.path.localeCompare(b.path, undefined, { numeric: true })));
  }, [rec, showAll]);
  const hidden = rec ? Object.keys(rec.machines).length - machines.length : 0;
  const signals: SignalSeries[] = rec ? Object.entries(rec.signals).map(([p, points]) => ({ key: `${rec.plc}|${p}`, plc: rec.plc, plcName: rec.plcName, path: p, points })) : [];
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="fault-viewer" className="w-full max-w-6xl max-h-[92vh] overflow-y-auto rounded-lg border border-rose-800 bg-slate-900 text-sm text-slate-200 shadow-2xl" onKeyDown={(e) => e.key === 'Escape' && onClose()} tabIndex={-1}>
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-800 bg-slate-900">
          <AlertTriangle className="w-5 h-5 text-rose-400" />
          <span className="text-base font-semibold">Fault record</span>
          {rec && (
            <span id="fault-viewer-title" className="text-slate-300">
              {short(rec.machine, rec.root)} went into <b className="text-rose-300">{rec.state}</b> · {rec.plcName} · {clock(rec.at)}
              {!rec.complete && <span className="ml-2 text-amber-300">(still keeping the minute after…)</span>}
            </span>
          )}
          {rec && onWork && (
            <button id="fault-work" type="button" onClick={() => onWork({ title: `${rec.state} at ${short(rec.machine, rec.root)}`.slice(0, 100), plc: rec.plc, plcName: rec.plcName, machine: rec.machine, priority: 'high', source: { kind: 'fault', id: rec.id, text: `fault record: ${short(rec.machine, rec.root)} ${rec.state}, ${clock(rec.at)}` } })} className="ml-auto flex items-center gap-1 px-2 py-1 rounded border border-slate-600 hover:bg-slate-800 text-xs" title="A work order made of this fault record (linked to it)">
              <ClipboardList className="w-3.5 h-3.5" /> Work order
            </button>
          )}
          <button type="button" onClick={onClose} className={`${rec && onWork ? '' : 'ml-auto '}p-1 rounded hover:bg-slate-800`} title="Close (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
        {error && <div className="px-4 py-3 text-rose-300">{error}</div>}
        {rec?.orders && rec.orders.length > 0 && (
          <div id="fault-orders" className="px-4 py-2 border-b border-slate-800 text-xs text-slate-300">
            Work orders: {rec.orders.map((o) => `#${o.number} ${o.title} (${o.status}${o.assignee ? `, ${o.assignee}` : ''})`).join(' · ')}
          </div>
        )}
        {corr && corr.records >= 2 && (
          <div id="fault-correlation" className="px-4 py-2 border-b border-slate-800 text-xs text-slate-300">
            <span className="font-semibold">Before it, most often</span> <span className="text-slate-500">(its {corr.records} fault records into this state; the 10 s before each, against any other 10 s):</span>
            {!corr.items.length && <span className="text-slate-500"> nothing changed before most of them</span>}
            <ul className="mt-0.5 space-y-0.5">
              {corr.items.map((x) => (
                <li key={`${x.kind}|${x.name}`} className="fault-corr" data-name={x.name}>
                  <span className="font-mono">{x.name}</span> {x.kind === 'machine' ? '(its state)' : ''} changed before <b>{x.hits} of {x.of}</b>, usually in {Math.round(x.usualRate * 100)} % of 10 s{x.before !== null && x.before !== undefined ? `; just before: ${String(x.before)}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!rec && !error && <div className="px-4 py-3 text-slate-400">Reading the fault record…</div>}
        {rec && (
          <>
            <BoardPlayback
              machines={machines}
              from={rec.from}
              to={rec.to}
              t={t || rec.at}
              playing={playing}
              speed={speed}
              loading=""
              isError={(n) => ERROR_STATE.test(n)}
              labelOf={(m) => short(m.path, rec.root)}
              onSeek={setT}
              onPlay={(on) => {
                if (on && t >= rec.to) setT(rec.from);
                setPlaying(on);
              }}
              onSpeed={setSpeed}
              onClose={onClose}
              narrow={narrow}
              marks={[{ t: rec.at, label: `${short(rec.machine, rec.root)}: ${rec.state}` }, ...(rec.events ?? []).slice(0, 50).map((e) => ({ t: e.t, label: `${e.severity ? `${e.severity}: ` : ''}${e.text}` }))]}
              title="Fault record"
              closeLabel="Close"
            />
            <div className="px-4 py-1 text-xs text-slate-400">
              {hidden > 0 && !showAll && (
                <button type="button" className="underline hover:text-white" onClick={() => setShowAll(true)}>
                  Show the {hidden} machine{hidden === 1 ? '' : 's'} that did not change
                </button>
              )}
              {showAll && (
                <button type="button" className="underline hover:text-white" onClick={() => setShowAll(false)}>
                  Only the ones that changed
                </button>
              )}
            </div>
            {signals.length > 0 ? (
              <SignalTrends signals={signals} history={{ from: rec.from, to: rec.to }} onHistory={() => undefined} onRemove={() => undefined} narrow={narrow} />
            ) : (
              <div className="px-4 py-2 text-xs text-slate-500">No signals kept with this PLC's faults: on the I/O page, chart the ones to keep and click Add to fault records.</div>
            )}
            {rec.events && rec.events.length > 0 ? (
              <div className="px-4 py-2">
                <div className="mb-1 font-semibold">TwinCAT logged events</div>
                <table id="fault-events" className="w-full text-xs">
                  <tbody>
                    {rec.events.map((e, i) => (
                      <tr key={i} className={`fault-event border-t border-slate-800 ${/error|critical/i.test(e.severity) ? 'text-rose-300' : /warn/i.test(e.severity) ? 'text-amber-200' : 'text-slate-300'}`}>
                        <td className="py-0.5 pr-2 font-mono whitespace-nowrap">{new Date(e.t).toLocaleTimeString()}</td>
                        <td className="pr-2">{e.severity}</td>
                        <td className="pr-2 text-slate-400">{e.source}</td>
                        <td>{e.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-2 text-xs text-slate-500">No TwinCAT logged events of this window: the setup page imports them (an export of the Logged Events window).</div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
