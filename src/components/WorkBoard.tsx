import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Download, HeartPulse, Plus, X } from 'lucide-react';
import type { GatewayConnection } from '../utils/liveGateway.ts';

export interface WorkOrder {
  id: string;
  number: number;
  title: string;
  plc: string | null;
  plcName: string | null;
  machine: string | null;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  status: 'open' | 'assigned' | 'in progress' | 'done' | 'cancelled';
  assignee: string | null;
  due: string | null;
  source: { kind: string; id?: string; text?: string };
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  doneAt: string | null;
  rootCause: string;
  parts: string;
  log: { at: string; by: string; text: string; status?: string; assignee?: string }[];
}
interface Reliability {
  plc: string;
  plcName: string;
  machine: string;
  failures: number;
  orders: number;
  mtbfMs: number | null;
  mttrMs: number | null;
  causes: { cause: string; count: number }[];
}
interface Window {
  plc: string;
  plcName: string;
  from: string;
  until: string;
  by: string;
  note: string;
  planned: boolean;
}
type Msg = { type: string; orders?: WorkOrder[]; people?: string[] };

const PRIORITY = { urgent: 'bg-rose-700 text-white', high: 'bg-amber-500 text-slate-950', normal: 'bg-slate-700 text-slate-100', low: 'bg-slate-800 text-slate-400' } as const;
const STATUS = { open: 'text-amber-300', assigned: 'text-sky-300', 'in progress': 'text-violet-300', done: 'text-emerald-300', cancelled: 'text-slate-500' } as const;
const dur = (ms: number | null) => (ms === null ? '—' : ms < 3600000 ? `${Math.round(ms / 60000)} min` : ms < 86400000 * 2 ? `${(ms / 3600000).toFixed(1)} h` : `${(ms / 86400000).toFixed(1)} days`);
const short = (p: string | null, root: string) => (!p ? '' : p.toLowerCase().startsWith(root.toLowerCase() + '.') ? p.slice(root.length + 1) : p);
const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** What the board hands a new work order: from an alert, a call, a risk */
export interface WorkDraft {
  title: string;
  plc?: string | null;
  plcName?: string | null;
  machine?: string | null;
  priority?: WorkOrder['priority'];
  source?: { kind: string; id?: string; text?: string };
}

/**
 * The board's Work page, for technicians and maintenance supervisors (gateway/workorders.cjs): the work orders (from
 * alerts, calls, risks, or by hand), filtered (open, mine, all), each opened: its log, take it, assign it (a
 * supervisor), done with its root cause and parts; the Calendar (the maintenance windows, past and planned, and the
 * jobs due, by month); Reliability (each machine's failures, MTBF, MTTR and top root causes, 30 or 90 days).
 */
export const WorkBoard: React.FC<{
  conn: GatewayConnection | null;
  connected: boolean;
  subscribe: (fn: (m: Msg) => void) => () => void;
  user: string;
  canWork: boolean;
  canAssign: boolean;
  root: string;
  draft: WorkDraft | null;
  onDraftDone: () => void;
  narrow: boolean;
}> = ({ conn, connected, subscribe, user, canWork, canAssign, root, draft, onDraftDone, narrow }) => {
  const [tab, setTab] = useState<'orders' | 'calendar' | 'reliability'>('orders');
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [show, setShow] = useState<'open' | 'mine' | 'all'>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<WorkDraft | null>(null);
  const [error, setError] = useState('');
  useEffect(
    () =>
      subscribe((m) => {
        if (m.type !== 'workOrders') return;
        setOrders(m.orders ?? []);
        if (m.people) setPeople(m.people);
      }),
    [subscribe]
  );
  useEffect(() => {
    if (!connected || !conn) return;
    conn.send({ type: 'workWatch' });
    return () => {
      conn.send({ type: 'workStop' });
    };
  }, [connected, conn]);
  useEffect(() => {
    if (draft) {
      setTab('orders');
      setForm({ priority: 'normal', ...draft });
      onDraftDone();
    }
  }, [draft, onDraftDone]);
  const shown = orders
    .filter((o) => (show === 'all' ? true : show === 'mine' ? (o.assignee ?? '').toLowerCase() === user.toLowerCase() && o.status !== 'done' && o.status !== 'cancelled' : o.status !== 'done' && o.status !== 'cancelled'))
    .sort((a, b) => ['urgent', 'high', 'normal', 'low'].indexOf(a.priority) - ['urgent', 'high', 'normal', 'low'].indexOf(b.priority) || b.createdAt.localeCompare(a.createdAt));
  const opened = orders.find((o) => o.id === openId) ?? null;
  const create = async () => {
    if (!form || !conn) return;
    setError('');
    const r = await conn.request<{ ok: boolean; error?: string; order?: WorkOrder }>({ type: 'workCreate', order: form }, 'workResult').catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!r.ok) return setError(r.error ?? 'Not created');
    setForm(null);
    if ('order' in r && r.order) setOpenId(r.order.id);
  };
  const change = async (id: string, ch: Record<string, unknown>) => {
    if (!conn) return 'Not connected';
    const r = await conn.request<{ ok: boolean; error?: string }>({ type: 'workUpdate', id, change: ch }, 'workResult').catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return r.ok ? null : r.error ?? 'Not changed';
  };
  const csv = () => {
    const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = ['number,title,plc,machine,priority,status,assignee,created,by,started,done,root cause,parts', ...orders.map((o) => [o.number, q(o.title), q(o.plcName), q(o.machine), o.priority, o.status, q(o.assignee), o.createdAt, q(o.createdBy), o.startedAt ?? '', o.doneAt ?? '', q(o.rootCause), q(o.parts)].join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\r\n') + '\r\n'], { type: 'text/csv' }));
    a.download = `work-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  return (
    <div id="work-board" className="flex-1 min-h-0 flex flex-col">
      <div className={`flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/60 ${narrow ? 'px-2 py-1.5' : 'px-4 py-2'}`}>
        <span className="flex items-center rounded border border-slate-700 overflow-hidden text-sm">
          {(
            [
              ['orders', 'Work orders', ClipboardList],
              ['calendar', 'Calendar', CalendarDays],
              ['reliability', 'Reliability', HeartPulse],
            ] as const
          ).map(([id, label, Icon]) => (
            <button key={id} id={`work-tab-${id}`} type="button" onClick={() => setTab(id)} className={`flex items-center gap-1 px-2 py-1 ${tab === id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </span>
        {tab === 'orders' && (
          <>
            <select id="work-show" value={show} onChange={(e) => setShow(e.target.value as 'open' | 'mine' | 'all')} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm">
              <option value="open">Open</option>
              <option value="mine">Mine</option>
              <option value="all">All</option>
            </select>
            <span className="text-sm text-slate-400">{shown.length} shown</span>
            {canWork && (
              <button id="work-new" type="button" onClick={() => setForm({ title: '', priority: 'normal' })} className="flex items-center gap-1 px-2 py-1 rounded bg-sky-700 hover:bg-sky-600 text-sm text-white">
                <Plus className="w-4 h-4" /> New work order
              </button>
            )}
            <button type="button" onClick={csv} className="ml-auto p-1 rounded hover:bg-slate-800" title="CSV of every work order">
              <Download className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
      <div className={`flex-1 min-h-0 overflow-y-auto ${narrow ? 'p-2' : 'p-4'}`}>
        {tab === 'orders' && (
          <ul className="space-y-1.5">
            {!shown.length && <li className="text-slate-400">No work orders {show === 'mine' ? 'for you' : show === 'open' ? 'open' : ''}.</li>}
            {shown.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => setOpenId(o.id)} className="work-order w-full text-left flex flex-wrap items-center gap-2 rounded border border-slate-800 bg-slate-900 hover:bg-slate-800/70 px-3 py-2" data-order={o.number} data-status={o.status}>
                  <span className={`shrink-0 px-2 rounded-full text-xs font-semibold ${PRIORITY[o.priority]}`}>{o.priority}</span>
                  <span className="font-mono text-xs text-slate-500">#{o.number}</span>
                  <span className="font-semibold">{o.title}</span>
                  <span className="text-xs text-slate-400">{o.plcName}{o.machine ? ` · ${short(o.machine, root)}` : ''}</span>
                  <span className={`ml-auto text-sm ${STATUS[o.status]}`}>{o.status}{o.assignee ? ` · ${o.assignee}` : ''}</span>
                  {o.due && <span className="text-xs text-slate-400">due {when(o.due)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {tab === 'calendar' && <WorkCalendar conn={conn} connected={connected} orders={orders} onOpen={setOpenId} />}
        {tab === 'reliability' && <WorkReliability conn={conn} connected={connected} root={root} />}
      </div>
      {form && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => e.target === e.currentTarget && setForm(null)}>
          <form id="work-form" className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm space-y-2 shadow-2xl" onSubmit={(e) => { e.preventDefault(); void create(); }} onKeyDown={(e) => e.key === 'Escape' && setForm(null)}>
            <div className="text-base font-semibold">New work order</div>
            {form.source?.text && <div className="text-xs text-slate-400">From: {form.source.text}</div>}
            <input id="work-title" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What is to be done (replace the door sensor S12)" className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 select-text" maxLength={120} />
            <div className="text-xs text-slate-400">{form.plcName ?? ''}{form.machine ? ` · ${short(form.machine, root)}` : ''}</div>
            <label className="flex items-center gap-2">
              Priority
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as WorkOrder['priority'] })} className="bg-slate-950 border border-slate-700 rounded px-2 py-1">
                {['urgent', 'high', 'normal', 'low'].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            {error && <div className="text-rose-300">{error}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className="px-3 py-1 rounded border border-slate-700 hover:bg-slate-800">Cancel</button>
              <button id="work-create" className="px-3 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white">Create</button>
            </div>
          </form>
        </div>
      )}
      {opened && <WorkDetail order={opened} user={user} people={people} canWork={canWork} canAssign={canAssign} root={root} onChange={(ch) => change(opened.id, ch)} onClose={() => setOpenId(null)} />}
    </div>
  );
};

const WorkDetail: React.FC<{ order: WorkOrder; user: string; people: string[]; canWork: boolean; canAssign: boolean; root: string; onChange: (ch: Record<string, unknown>) => Promise<string | null>; onClose: () => void }> = ({ order: o, user, people, canWork, canAssign, root, onChange, onClose }) => {
  const [note, setNote] = useState('');
  const [closing, setClosing] = useState(false);
  const [rootCause, setRootCause] = useState('');
  const [parts, setParts] = useState('');
  const [error, setError] = useState('');
  const act = async (ch: Record<string, unknown>) => {
    setError('');
    const e = await onChange(ch);
    if (e) setError(e);
    else {
      setNote('');
      setClosing(false);
    }
  };
  const live = o.status !== 'done' && o.status !== 'cancelled';
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="work-detail" className="h-full w-full max-w-lg overflow-y-auto border-l border-slate-700 bg-slate-900 p-4 text-sm space-y-3" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="flex items-center gap-2">
          <span className={`px-2 rounded-full text-xs font-semibold ${PRIORITY[o.priority]}`}>{o.priority}</span>
          <span className="font-mono text-slate-500">#{o.number}</span>
          <span className={`ml-auto ${STATUS[o.status]}`}>{o.status}</span>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-800" title="Close (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="text-lg font-semibold">{o.title}</div>
        <div className="text-slate-400">{o.plcName}{o.machine ? ` · ${short(o.machine, root)}` : ''}{o.source?.text ? ` · from: ${o.source.text}` : ''}</div>
        <div className="text-xs text-slate-500">Created {when(o.createdAt)} by {o.createdBy}{o.assignee ? ` · ${o.assignee}` : ''}{o.doneAt ? ` · done ${when(o.doneAt)}` : ''}</div>
        {o.status === 'done' && (
          <div className="rounded border border-emerald-900 bg-emerald-950/40 px-3 py-2">
            <div><b>Root cause:</b> {o.rootCause}</div>
            {o.parts && <div><b>Parts:</b> {o.parts}</div>}
          </div>
        )}
        {canWork && live && (
          <div className="flex flex-wrap gap-2">
            {o.status !== 'in progress' && (
              <button id="work-take" type="button" onClick={() => void act({ status: 'in progress', assignee: o.assignee ?? user })} className="px-3 py-1 rounded bg-violet-700 hover:bg-violet-600 text-white">
                {o.assignee && o.assignee.toLowerCase() !== user.toLowerCase() ? 'Start it' : 'Take it'}
              </button>
            )}
            <button id="work-done" type="button" onClick={() => setClosing(true)} className="px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white">
              Done…
            </button>
            {canAssign && (
              <select id="work-assign" value={o.assignee ?? ''} onChange={(e) => void act({ assignee: e.target.value || null })} className="bg-slate-950 border border-slate-700 rounded px-2 py-1" title="Assign it">
                <option value="">(not assigned)</option>
                {[...new Set([...people, ...(o.assignee ? [o.assignee] : [])])].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            )}
            <select value={o.priority} onChange={(e) => void act({ priority: e.target.value })} className="bg-slate-950 border border-slate-700 rounded px-2 py-1" title="Priority">
              {['urgent', 'high', 'normal', 'low'].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <button type="button" onClick={() => void act({ status: 'cancelled', note: note || 'Cancelled' })} className="px-3 py-1 rounded border border-slate-700 hover:bg-slate-800">
              Cancel it
            </button>
          </div>
        )}
        {closing && (
          <div id="work-close" className="space-y-2 rounded border border-emerald-800 p-3">
            <input id="work-rootcause" autoFocus value={rootCause} onChange={(e) => setRootCause(e.target.value)} placeholder="Root cause: what was wrong" className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 select-text" maxLength={500} />
            <input id="work-parts" value={parts} onChange={(e) => setParts(e.target.value)} placeholder="Parts used (optional)" className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 select-text" maxLength={300} />
            <button id="work-done-save" type="button" onClick={() => void act({ status: 'done', rootCause, parts, note })} className="px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white">
              Mark it done
            </button>
          </div>
        )}
        {canWork && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) void act({ note }); }}>
            <input id="work-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done, what was found…" className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 select-text" maxLength={500} />
            <button className="px-3 py-1 rounded border border-slate-600 hover:bg-slate-800">Add</button>
          </form>
        )}
        {error && <div id="work-error" className="text-rose-300">{error}</div>}
        <ul className="space-y-1 border-t border-slate-800 pt-2">
          {[...o.log].reverse().map((l, i) => (
            <li key={i} className="work-log text-xs">
              <span className="font-mono text-slate-500">{when(l.at)}</span> <b>{l.by}</b>: {l.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

/** The month: the maintenance windows (past, planned) and the jobs due */
const WorkCalendar: React.FC<{ conn: GatewayConnection | null; connected: boolean; orders: WorkOrder[]; onOpen: (id: string) => void }> = ({ conn, connected, orders, onOpen }) => {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
  const [windows, setWindows] = useState<Window[]>([]);
  useEffect(() => {
    if (!connected || !conn) return;
    const end = new Date(new Date(month).getFullYear(), new Date(month).getMonth() + 1, 1).getTime();
    void conn.request<{ windows?: Window[] }>({ type: 'maintenanceCalendar', from: month - 7 * 86400000, to: end + 7 * 86400000 }, 'maintenanceCalendarResult').then((r) => setWindows(r.windows ?? [])).catch(() => setWindows([]));
  }, [connected, conn, month]);
  const first = new Date(month);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const on = (d: Date) => {
    const a = d.getTime();
    const b = a + 86400000;
    return {
      w: windows.filter((w) => Date.parse(w.from) < b && Date.parse(w.until) > a),
      o: orders.filter((o) => o.due && Date.parse(o.due) >= a && Date.parse(o.due) < b && o.status !== 'cancelled'),
    };
  };
  const shift = (n: number) => setMonth((m) => new Date(new Date(m).getFullYear(), new Date(m).getMonth() + n, 1).getTime());
  return (
    <div id="work-calendar">
      <div className="mb-2 flex items-center gap-2">
        <button type="button" onClick={() => shift(-1)} className="p-1 rounded hover:bg-slate-800"><ChevronLeft className="w-4 h-4" /></button>
        <span className="text-lg font-semibold">{first.toLocaleDateString([], { month: 'long', year: 'numeric' })}</span>
        <button type="button" onClick={() => shift(1)} className="p-1 rounded hover:bg-slate-800"><ChevronRight className="w-4 h-4" /></button>
        <span className="text-xs text-slate-500">Maintenance windows (planned on the Machines page, Maintenance…) and the work orders due</span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="px-1 text-slate-500">{d}</div>
        ))}
        {days.map((d) => {
          const x = on(d);
          const out = d.getMonth() !== first.getMonth();
          const today = d.toDateString() === new Date().toDateString();
          return (
            <div key={d.toISOString()} className={`calendar-day min-h-[5.5rem] rounded border p-1 ${today ? 'border-sky-500' : 'border-slate-800'} ${out ? 'opacity-40' : ''}`} data-day={d.getDate()}>
              <div className="text-slate-400">{d.getDate()}</div>
              {x.w.map((w, i) => (
                <div key={i} className={`calendar-window truncate rounded px-1 ${w.planned ? 'bg-violet-900/70 text-violet-100' : 'bg-violet-950 text-violet-300'}`} title={`${w.plcName}: ${new Date(w.from).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${new Date(w.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${w.by}${w.note ? `: ${w.note}` : ''}`}>
                  🔧 {w.plcName}
                </div>
              ))}
              {x.o.map((o) => (
                <button key={o.id} type="button" onClick={() => onOpen(o.id)} className={`calendar-order block w-full truncate text-left rounded px-1 ${o.status === 'done' ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-900/60 text-amber-100'}`}>
                  #{o.number} {o.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Each machine's failures, MTBF, MTTR, root causes */
const WorkReliability: React.FC<{ conn: GatewayConnection | null; connected: boolean; root: string }> = ({ conn, connected, root }) => {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Reliability[]>([]);
  useEffect(() => {
    if (!connected || !conn) return;
    void conn.request<{ rows?: Reliability[] }>({ type: 'reliability', days }, 'reliabilityResult').then((r) => setRows(r.rows ?? [])).catch(() => setRows([]));
  }, [connected, conn, days]);
  const max = useMemo(() => Math.max(1, ...rows.map((r) => r.failures)), [rows]);
  return (
    <div id="work-reliability">
      <div className="mb-2 flex items-center gap-2">
        {[30, 90].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} className={`px-2 py-1 rounded border text-sm ${days === d ? 'border-sky-500 bg-sky-900/60 text-sky-100' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>
            {d} days
          </button>
        ))}
        <span className="text-xs text-slate-500">MTBF: the time between failures (error states); MTTR: the time to repair (an alert's recovery, a work order's start to done)</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1">Machine</th>
            <th>Failures</th>
            <th className="text-right">MTBF</th>
            <th className="text-right">MTTR</th>
            <th className="pl-3">Root causes</th>
          </tr>
        </thead>
        <tbody>
          {!rows.length && (
            <tr>
              <td colSpan={5} className="py-2 text-slate-400">No failures in these days.</td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={`${r.plc}|${r.machine}`} className="reliability-row border-t border-slate-800" data-machine={r.machine}>
              <td className="py-1">{short(r.machine, root)} <span className="text-xs text-slate-500">{r.plcName}</span></td>
              <td>
                <span className="flex items-center gap-2">
                  <span className="h-2 rounded bg-rose-500" style={{ width: `${(r.failures / max) * 6}rem` }} /> {r.failures}
                  {r.orders ? <span className="text-xs text-slate-500">({r.orders} work orders)</span> : null}
                </span>
              </td>
              <td className="text-right font-mono">{dur(r.mtbfMs)}</td>
              <td className="text-right font-mono">{dur(r.mttrMs)}</td>
              <td className="pl-3 text-xs text-slate-400">{r.causes.map((c) => `${c.cause} (${c.count})`).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
