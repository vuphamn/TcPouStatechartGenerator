import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { BoardPlayback } from './BoardPlayback.tsx';
import { SignalTrends, type SignalSeries } from './SignalTrends.tsx';
import type { PlaybackMachine } from '../utils/boardPlayback.ts';
import type { GatewayConnection } from '../utils/liveGateway.ts';

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
export const FaultViewer: React.FC<{ conn: GatewayConnection | null; id: string; onClose: () => void; narrow: boolean }> = ({ conn, id, onClose, narrow }) => {
  const [rec, setRec] = useState<FaultRecord | null>(null);
  const [error, setError] = useState('');
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showAll, setShowAll] = useState(false);
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
          <button type="button" onClick={onClose} className="ml-auto p-1 rounded hover:bg-slate-800" title="Close (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
        {error && <div className="px-4 py-3 text-rose-300">{error}</div>}
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
              marks={[{ t: rec.at, label: `${short(rec.machine, rec.root)}: ${rec.state}` }]}
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
          </>
        )}
      </div>
    </div>
  );
};
