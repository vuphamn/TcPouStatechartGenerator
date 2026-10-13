import React, { useState } from 'react';
import { Download, ListChecks, Trash2 } from 'lucide-react';

export type LiveEventKind = 'connect' | 'overrun' | 'hold' | 'stuck' | 'write' | 'state';
export interface LiveEvent {
  /** This computer's time (ms) */
  t: number;
  kind: LiveEventKind;
  text: string;
}
const KIND: Record<LiveEventKind, { label: string; cls: string }> = {
  connect: { label: 'live', cls: 'bg-slate-800 text-slate-300' },
  overrun: { label: 'overrun', cls: 'bg-rose-900/70 text-rose-200' },
  hold: { label: 'pause', cls: 'bg-amber-900/70 text-amber-200' },
  stuck: { label: 'stuck', cls: 'bg-orange-900/70 text-orange-200' },
  write: { label: 'write', cls: 'bg-sky-900/70 text-sky-200' },
  state: { label: 'set state', cls: 'bg-violet-900/70 text-violet-200' },
};

/** The events as CSV: time (ISO), kind, text */
export const eventsCsv = (events: LiveEvent[]) => ['time;kind;event', ...events.map((e) => `${new Date(e.t).toISOString()};${e.kind};${e.text.replace(/\s*[;\r\n]+\s*/g, ' ')}`)].join('\n');

/**
 * The event log (the Live tab): what happened while live, newest first: connected / stopped, overruns, pauses (a state
 * or a condition), stuck alarms, values written or held, the PLC set to a state; a filter by kind; CSV; Clear
 */
export const EventLog: React.FC<{ events: LiveEvent[]; onExport: () => void; onClear: () => void }> = ({ events, onExport, onClear }) => {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LiveEventKind | 'all'>('all');
  const shown = [...events].reverse().filter((e) => kind === 'all' || e.kind === kind);
  return (
    <div id="live-events" className="rounded border border-slate-700/70 bg-slate-900/40 px-2 py-1 text-[11px]">
      <div className="flex items-center gap-1.5">
        <button id="live-events-toggle" type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-slate-300 font-semibold hover:text-sky-300" title="What happened while live: connections, overruns, pauses, stuck alarms, writes">
          <ListChecks className="w-3 h-3 text-sky-300" /> Events <span id="live-events-count" className="font-normal text-slate-500">{events.length}</span>
        </button>
        {open && (
          <>
            <select id="live-events-kind" value={kind} onChange={(e) => setKind(e.target.value as LiveEventKind | 'all')} className="ml-auto bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[11px] text-slate-300">
              <option value="all">all</option>
              {(Object.keys(KIND) as LiveEventKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND[k].label}
                </option>
              ))}
            </select>
            <button id="live-events-csv" type="button" onClick={onExport} disabled={!events.length} className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40" title="The events as CSV">
              <Download className="w-3 h-3" /> CSV
            </button>
            <button id="live-events-clear" type="button" onClick={onClear} disabled={!events.length} className="p-0.5 rounded text-slate-400 hover:text-rose-300 disabled:opacity-40" title="Clear the events">
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
      {open && (
        <div className="mt-1 max-h-40 overflow-y-auto space-y-0.5">
          {shown.length === 0 && <div className="text-slate-500">Nothing yet.</div>}
          {shown.map((e, i) => (
            <div key={`${e.t}-${i}`} className="live-event flex items-baseline gap-1.5" data-kind={e.kind}>
              <span className="font-mono text-slate-500 shrink-0">{new Date(e.t).toLocaleTimeString()}</span>
              <span className={`shrink-0 px-1 rounded text-[9px] ${KIND[e.kind].cls}`}>{KIND[e.kind].label}</span>
              <span className="text-slate-300 break-words min-w-0">{e.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
