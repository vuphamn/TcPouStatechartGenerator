import React, { useState } from 'react';
import { Download, ListChecks, Trash2 } from 'lucide-react';

export type LiveEventKind = 'connect' | 'overrun' | 'hold' | 'stuck' | 'write' | 'state' | 'alert' | 'note';
export interface LiveEvent {
  /** This computer's time (ms) */
  t: number;
  kind: LiveEventKind;
  text: string;
  /** The state the PLC was in then */
  state?: string;
}
const KIND: Record<LiveEventKind, { label: string; cls: string }> = {
  connect: { label: 'live', cls: 'bg-slate-800 text-slate-300' },
  overrun: { label: 'overrun', cls: 'bg-rose-900/70 text-rose-200' },
  hold: { label: 'pause', cls: 'bg-amber-900/70 text-amber-200' },
  stuck: { label: 'stuck', cls: 'bg-orange-900/70 text-orange-200' },
  write: { label: 'write', cls: 'bg-sky-900/70 text-sky-200' },
  state: { label: 'set state', cls: 'bg-violet-900/70 text-violet-200' },
  alert: { label: 'alert', cls: 'bg-rose-800/80 text-rose-100' },
  note: { label: 'note', cls: 'bg-emerald-900/70 text-emerald-200' },
};

/** Counts of the events: by kind, by the state the PLC was in, by hour of the day, by shift (06–14, 14–22, 22–06) */
export function eventStats(events: LiveEvent[]): { total: number; from: number | null; to: number | null; byKind: [string, number][]; byState: [string, number][]; byHour: number[]; byShift: [string, number][] } {
  const count = (key: (e: LiveEvent) => string) => {
    const m = new Map<string, number>();
    for (const e of events) m.set(key(e), (m.get(key(e)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const e of events) byHour[new Date(e.t).getHours()]++;
  const shift = (e: LiveEvent) => {
    const h = new Date(e.t).getHours();
    return h >= 6 && h < 14 ? '06–14' : h >= 14 && h < 22 ? '14–22' : '22–06';
  };
  return {
    total: events.length,
    from: events.length ? Math.min(...events.map((e) => e.t)) : null,
    to: events.length ? Math.max(...events.map((e) => e.t)) : null,
    byKind: count((e) => e.kind),
    byState: count((e) => e.state ?? '(not known)'),
    byHour,
    byShift: count(shift),
  };
}

/** The statistics as CSV: section; key; count */
export const eventStatsCsv = (events: LiveEvent[]) => {
  const s = eventStats(events);
  return ['section;key;count', ...s.byKind.map(([k, n]) => `kind;${k};${n}`), ...s.byState.map(([k, n]) => `state;${k};${n}`), ...s.byShift.map(([k, n]) => `shift;${k};${n}`), ...s.byHour.map((n, h) => `hour;${String(h).padStart(2, '0')};${n}`)].join('\n');
};

/** The events as CSV: time (ISO), kind, text */
export const eventsCsv = (events: LiveEvent[]) => ['time;kind;event', ...events.map((e) => `${new Date(e.t).toISOString()};${e.kind};${e.text.replace(/\s*[;\r\n]+\s*/g, ' ')}`)].join('\n');

/**
 * The event log (the Live tab): what happened while live, newest first: connected / stopped, overruns, pauses (a state
 * or a condition), stuck alarms, values written or held, the PLC set to a state; a filter by kind; CSV; Clear
 */
export const EventLog: React.FC<{ events: LiveEvent[]; onExport: () => void; onClear: () => void; keep?: { on: boolean; onChange: (on: boolean) => void }; webhook?: { url: string; onChange: (url: string) => void; all?: boolean; onAllChange?: (on: boolean) => void; onTest?: () => void }; onPick?: (e: LiveEvent) => void; shared?: { list: (LiveEvent & { user?: string })[] | null; onLoad: () => void; onClose: () => void }; onExportStats?: () => void; valueStats?: () => { name: string; shift: string; min: number; max: number; avg: number; n: number }[]; onAddNote?: () => void }> = ({ events: own, onExport, onClear, keep, webhook, onPick, shared, onExportStats, valueStats, onAddNote }) => {
  // (the gateway's shared events of this PLC, when loaded: shown instead of this session's, with who)
  const events: (LiveEvent & { user?: string })[] = shared?.list ?? own;
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LiveEventKind | 'all'>('all');
  const [find, setFind] = useState('');
  const [stats, setStats] = useState(false);
  const shown = [...events].reverse().filter((e) => (kind === 'all' || e.kind === kind) && (!find.trim() || e.text.toLowerCase().includes(find.trim().toLowerCase())));
  return (
    <div id="live-events" className="rounded border border-slate-700/70 bg-slate-900/40 px-2 py-1 text-[11px]">
      <div className="flex items-center gap-1.5">
        <button id="live-events-toggle" type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-slate-300 font-semibold hover:text-sky-300" title="What happened while live: connections, overruns, pauses, stuck alarms, writes">
          <ListChecks className="w-3 h-3 text-sky-300" /> Events <span id="live-events-count" className="font-normal text-slate-500">{events.length}</span>
        </button>
        {open && (
          <>
            {shared && (
              <button id="live-events-shared" type="button" onClick={shared.list ? shared.onClose : shared.onLoad} className={`px-1.5 py-0.5 rounded border text-[10px] ${shared.list ? 'border-sky-600 bg-sky-900/60 text-sky-100' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`} title={shared.list ? "Back to this session's events" : "Everyone's events on this PLC, the last 24 hours (kept by the gateway)"}>
                {shared.list ? 'Shared ✓' : 'Shared'}
              </button>
            )}
            {onAddNote && (
              <button id="live-events-note" type="button" onClick={onAddNote} className="px-1.5 py-0.5 rounded border border-emerald-700 text-[10px] text-emerald-200 hover:bg-emerald-900/50" title="A note now: an event, on the timeline, saved with this session's recording">
                + note
              </button>
            )}
            <button id="live-events-stats" type="button" onClick={() => setStats((v) => !v)} className={`px-1.5 py-0.5 rounded border text-[10px] ${stats ? 'border-sky-600 bg-sky-900/60 text-sky-100' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`} title="Counts: by kind, by the PLC's state then, by shift and hour">
              Stats
            </button>
            <input id="live-events-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="find…" spellCheck={false} className="ml-auto w-24 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[11px] text-slate-200" title="Only the events with this text" />
            <select id="live-events-kind" value={kind} onChange={(e) => setKind(e.target.value as LiveEventKind | 'all')} className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[11px] text-slate-300">
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
      {open && keep && (
        <label className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400" title="When a session ends, its events are written beside the PLC project: MachineScope.events\<POU>_<date>.csv (for the next shift)">
          <input id="live-events-keep" type="checkbox" checked={keep.on} onChange={(e) => keep.onChange(e.target.checked)} />
          Keep each session's log beside the project (MachineScope.events)
        </label>
      )}
      {open && webhook && (
        <label className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400" title="Alerts also told to a webhook (Teams, Slack: a JSON { text } POSTed; https only). Empty: none">
          Alerts to
          <input
            id="live-alerts-webhook"
            defaultValue={webhook.url}
            onBlur={(e) => webhook.onChange(e.target.value.trim())}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder="https://… (a webhook)"
            spellCheck={false}
            className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-1 py-0.5 font-mono text-[10px] text-slate-200"
          />
          {webhook.onTest && (
            <button id="live-alerts-webhook-test" type="button" onClick={webhook.onTest} disabled={!webhook.url} className="px-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40" title="A test message to the webhook now">
              Test
            </button>
          )}
          {webhook.onAllChange && (
            <span className="flex items-center gap-1" title="Stuck states, task overruns and the PLC set to a state told too, not only alerts">
              <input id="live-alerts-webhook-all" type="checkbox" checked={!!webhook.all} onChange={(e) => webhook.onAllChange!(e.target.checked)} />
              + stuck, overruns, states set
            </span>
          )}
        </label>
      )}
      {open && stats && (
        <div id="live-events-stats-table" className="mt-1 grid grid-cols-3 gap-2 text-[10px] font-mono">
          {(() => {
            const s = eventStats(events);
            const list = (title: string, rows: [string, number][]) => (
              <div>
                <div className="text-slate-500 font-sans">{title}</div>
                {rows.slice(0, 8).map(([k, n]) => (
                  <div key={k} className="live-events-stat flex justify-between gap-1" data-section={title} data-key={k}>
                    <span className="truncate text-slate-300">{k}</span>
                    <span className="text-sky-300">{n}</span>
                  </div>
                ))}
              </div>
            );
            return (
              <>
                {list('kind', s.byKind)}
                {list('state', s.byState)}
                {list('shift', s.byShift)}
                {valueStats && valueStats().length > 0 && (
                  <table id="live-values-by-shift" className="col-span-3 w-full text-[10px]">
                    <thead>
                      <tr className="text-slate-500 font-sans">
                        <th className="text-left font-normal">value (this session)</th>
                        <th className="text-left font-normal">shift</th>
                        <th className="text-right font-normal">min</th>
                        <th className="text-right font-normal">avg</th>
                        <th className="text-right font-normal">max</th>
                      </tr>
                    </thead>
                    <tbody>
                      {valueStats()
                        .slice(0, 24)
                        .map((v) => (
                          <tr key={`${v.name}@${v.shift}`} className="live-value-stat" data-name={v.name} data-shift={v.shift}>
                            <td className="truncate max-w-[140px] text-slate-300" title={v.name}>{v.name}</td>
                            <td className="text-slate-500">{v.shift}</td>
                            <td className="text-right text-sky-300">{Number(v.min.toFixed(3))}</td>
                            <td className="text-right text-sky-300">{Number(v.avg.toFixed(3))}</td>
                            <td className="text-right text-sky-300">{Number(v.max.toFixed(3))}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
                {onExportStats && (
                  <button id="live-events-stats-csv" type="button" onClick={onExportStats} className="col-span-3 justify-self-start px-1.5 rounded border border-slate-700 font-sans text-slate-300 hover:bg-slate-800" title="The counts as CSV (by kind, state, shift, hour)">
                    Stats CSV
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}
      {open && (
        <div className="mt-1 max-h-40 overflow-y-auto space-y-0.5">
          {shown.length === 0 && <div className="text-slate-500">Nothing yet.</div>}
          {shown.map((e, i) => (
            <div key={`${e.t}-${i}`} className={`live-event flex items-baseline gap-1.5 ${onPick ? 'cursor-pointer hover:bg-slate-800/60 rounded' : ''}`} data-kind={e.kind} onClick={() => onPick?.(e)} title={onPick ? 'Show it on the timeline' : undefined}>
              <span className="font-mono text-slate-500 shrink-0">{new Date(e.t).toLocaleTimeString()}</span>
              <span className={`shrink-0 px-1 rounded text-[9px] ${KIND[e.kind].cls}`}>{KIND[e.kind].label}</span>
              <span className="text-slate-300 break-words min-w-0">
                {e.user ? <span className="text-sky-300">{e.user}: </span> : null}
                {e.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
