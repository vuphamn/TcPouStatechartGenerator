import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, FileDiff, GitCompare, Timer } from 'lucide-react';
import { diffHunks, diffLines } from '../utils/textDiff.ts';
import type { GatewayConnection } from '../utils/liveGateway.ts';

interface Rec {
  id: string;
  plc: string;
  plcName: string;
  machines: { path: string; type: string }[];
}
interface TimingRow {
  state: string;
  todayMs: number | null;
  todayCount: number;
  normalMs: number | null;
  days: number;
  change: number | null;
  flag: boolean;
}
interface TransRow {
  from: string;
  to: string;
  recent: number;
  before: number;
  isNew: boolean;
  rare: boolean;
}
interface WindowRes {
  machine: string;
  from: number;
  to: number;
  knownMs: number;
  states: { state: string; ms: number; share: number; count: number; avgMs: number | null }[];
  transitions: { from: string; to: string; count: number }[];
}
interface Version {
  id: string;
  at: string | null;
  project: string;
  files: number | null;
  current: boolean;
}

const dur = (ms: number | null) => (ms === null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : ms < 3600000 ? `${(ms / 60000).toFixed(1)} min` : `${(ms / 3600000).toFixed(1)} h`);
const short = (p: string, root: string) => (p.toLowerCase().startsWith(root.toLowerCase() + '.') ? p.slice(root.length + 1) : p);
const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'lastweek', label: 'The 7 days before' },
];
const rangeOf = (id: string) => {
  const midnight = new Date(new Date().toDateString()).getTime();
  const now = Date.now();
  if (id === 'yesterday') return { from: midnight - 86400000, to: midnight };
  if (id === 'week') return { from: now - 7 * 86400000, to: now };
  if (id === 'lastweek') return { from: now - 14 * 86400000, to: now - 7 * 86400000 };
  return { from: midnight, to: now };
};

/**
 * The board's Engineering page (gateway/engineering.cjs), for engineers: Timing (each state's time today against its
 * normal, the last 14 days), Transitions (the last 24 hours' against the 14 days before: new, rare), Compare (two
 * windows of a machine, or two machines, side by side), What changed (the PLC project's versions the gateway kept:
 * the files changed between two, each one's diff).
 */
export const EngBoard: React.FC<{ conn: GatewayConnection | null; connected: boolean; root: string; plcs: { id: string; name: string }[]; narrow: boolean }> = ({ conn, connected, root, plcs, narrow }) => {
  const [tab, setTab] = useState<'timing' | 'transitions' | 'compare' | 'changed'>('timing');
  const [recs, setRecs] = useState<Rec[]>([]);
  const [pick, setPick] = useState('');
  useEffect(() => {
    if (!connected || !conn) return;
    void conn.request<{ recordings?: Rec[] }>({ type: 'recordingsList' }, 'recordingsList').then((r) => {
      setRecs(r.recordings ?? []);
      const first = r.recordings?.find((x) => x.machines.length);
      if (first) setPick((p) => p || `${first.id}|${first.machines[0].path}`);
    }).catch(() => undefined);
  }, [connected, conn]);
  const options = recs.flatMap((r) => r.machines.map((m) => ({ key: `${r.id}|${m.path}`, label: `${r.plcName}: ${short(m.path, root)}` })));
  const picker = (value: string, on: (v: string) => void, id: string) => (
    <select id={id} value={value} onChange={(e) => on(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm max-w-[22rem]">
      {!options.length && <option value="">(no recorded machine: Select → Record… on the Machines page)</option>}
      {options.map((o) => (
        <option key={o.key} value={o.key}>{o.label}</option>
      ))}
    </select>
  );
  return (
    <div id="eng-board" className="flex-1 min-h-0 flex flex-col">
      <div className={`flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/60 ${narrow ? 'px-2 py-1.5' : 'px-4 py-2'}`}>
        <span className="flex items-center rounded border border-slate-700 overflow-hidden text-sm">
          {(
            [
              ['timing', 'Timing', Timer],
              ['transitions', 'Transitions', ArrowLeftRight],
              ['compare', 'Compare', GitCompare],
              ['changed', 'What changed', FileDiff],
            ] as const
          ).map(([id, label, Icon]) => (
            <button key={id} id={`eng-tab-${id}`} type="button" onClick={() => setTab(id)} className={`flex items-center gap-1 px-2 py-1 ${tab === id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </span>
        {(tab === 'timing' || tab === 'transitions') && picker(pick, setPick, 'eng-machine')}
      </div>
      <div className={`flex-1 min-h-0 overflow-y-auto ${narrow ? 'p-2' : 'p-4'}`}>
        {tab === 'timing' && <Timing conn={conn} pick={pick} />}
        {tab === 'transitions' && <Transitions conn={conn} pick={pick} />}
        {tab === 'compare' && <Compare conn={conn} options={options} picker={picker} root={root} />}
        {tab === 'changed' && <Changed conn={conn} plcs={plcs} />}
      </div>
    </div>
  );
};

const Timing: React.FC<{ conn: GatewayConnection | null; pick: string }> = ({ conn, pick }) => {
  const [rows, setRows] = useState<TimingRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!conn || !pick) return;
    const [id, machine] = pick.split('|');
    setRows(null);
    void conn.request<{ rows?: TimingRow[]; error?: string }>({ type: 'engTiming', id, machine }, 'engTimingResult', 60000).then((r) => {
      setError(r.error ?? '');
      setRows(r.rows ?? []);
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [conn, pick]);
  return (
    <div id="eng-timing">
      <p className="mb-2 text-xs text-slate-400">Each state's median time today against its normal (the median of its daily medians, the last 14 days). 30 % or more apart, with 3 stays today, is flagged.</p>
      {error && <div className="text-rose-300">{error}</div>}
      {rows && !rows.length && <div className="text-slate-400">Nothing recorded yet.</div>}
      <table className="w-full text-sm">
        <tbody>
          {rows?.map((r) => (
            <tr key={r.state} className={`eng-timing-row border-t border-slate-800 ${r.flag ? 'text-amber-200' : ''}`} data-state={r.state} data-flag={r.flag ? 'true' : undefined}>
              <td className="py-1 font-mono">{r.state}</td>
              <td className="text-right">{dur(r.todayMs)}{r.todayCount ? <span className="text-xs text-slate-500"> ({r.todayCount}×)</span> : null}</td>
              <td className="text-right text-slate-400">normal {dur(r.normalMs)}<span className="text-xs text-slate-500"> ({r.days} days)</span></td>
              <td className="w-48 pl-3">
                {r.change !== null && (
                  <span className="flex items-center gap-2">
                    <span className="relative h-2 w-28 rounded bg-slate-800">
                      <span className={`absolute top-0 h-2 rounded ${r.change > 0 ? 'left-1/2 bg-rose-500' : 'right-1/2 bg-emerald-500'}`} style={{ width: `${Math.min(50, Math.abs(r.change) * 50)}%` }} />
                    </span>
                    {r.change > 0 ? '+' : ''}
                    {Math.round(r.change * 100)} %
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Transitions: React.FC<{ conn: GatewayConnection | null; pick: string }> = ({ conn, pick }) => {
  const [rows, setRows] = useState<TransRow[] | null>(null);
  useEffect(() => {
    if (!conn || !pick) return;
    const [id, machine] = pick.split('|');
    setRows(null);
    void conn.request<{ rows?: TransRow[] }>({ type: 'engTransitions', id, machine, hours: 24 }, 'engTransitionsResult', 60000).then((r) => setRows(r.rows ?? [])).catch(() => setRows([]));
  }, [conn, pick]);
  return (
    <div id="eng-transitions">
      <p className="mb-2 text-xs text-slate-400">The last 24 hours' transitions against the 14 days before: a new one (never before) or a rare one (under 1 % of them) can be a fault path or a change in the program.</p>
      {rows && !rows.length && <div className="text-slate-400">No transitions recorded.</div>}
      <table className="w-full text-sm">
        <tbody>
          {rows?.map((r) => (
            <tr key={`${r.from}>${r.to}`} className="eng-transition border-t border-slate-800" data-new={r.isNew ? 'true' : undefined} data-rare={r.rare ? 'true' : undefined}>
              <td className="py-1 font-mono">{r.from} → {r.to}</td>
              <td className="text-right">{r.recent} in 24 h</td>
              <td className="text-right text-slate-400">{r.before} in the 14 days before</td>
              <td className="pl-3">{r.isNew ? <span className="px-2 rounded-full bg-rose-700 text-xs text-white">new</span> : r.rare ? <span className="px-2 rounded-full bg-amber-500 text-xs text-slate-950">rare</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Compare: React.FC<{ conn: GatewayConnection | null; options: { key: string; label: string }[]; picker: (v: string, on: (v: string) => void, id: string) => React.ReactNode; root: string }> = ({ conn, options, picker }) => {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [ra, setRa] = useState('today');
  const [rb, setRb] = useState('yesterday');
  const [res, setRes] = useState<{ a: WindowRes; b: WindowRes } | null>(null);
  useEffect(() => {
    if (!a && options[0]) setA(options[0].key);
    if (!b && options[0]) setB(options[0].key);
  }, [options, a, b]);
  useEffect(() => {
    if (!conn || !a || !b) return;
    const [ida, ma] = a.split('|');
    const [idb, mb] = b.split('|');
    void conn.request<{ a: WindowRes; b: WindowRes }>({ type: 'engCompare', a: { id: ida, machine: ma, ...rangeOf(ra) }, b: { id: idb, machine: mb, ...rangeOf(rb) } }, 'engCompareResult', 60000).then(setRes).catch(() => setRes(null));
  }, [conn, a, b, ra, rb]);
  const states = useMemo(() => [...new Set([...(res?.a.states ?? []).map((s) => s.state), ...(res?.b.states ?? []).map((s) => s.state)])], [res]);
  const rangeSel = (v: string, on: (x: string) => void, id: string) => (
    <select id={id} value={v} onChange={(e) => on(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm">
      {RANGES.map((r) => (
        <option key={r.id} value={r.id}>{r.label}</option>
      ))}
    </select>
  );
  return (
    <div id="eng-compare">
      <div className="mb-3 grid gap-2 md:grid-cols-2 text-sm">
        <div className="flex flex-wrap items-center gap-2"><b>A</b> {picker(a, setA, 'eng-a')} {rangeSel(ra, setRa, 'eng-ra')}</div>
        <div className="flex flex-wrap items-center gap-2"><b>B</b> {picker(b, setB, 'eng-b')} {rangeSel(rb, setRb, 'eng-rb')}</div>
      </div>
      {res && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1">State</th>
              <th className="text-right">A: share</th>
              <th className="text-right">A: average (count)</th>
              <th className="text-right">B: share</th>
              <th className="text-right">B: average (count)</th>
              <th className="text-right">Average B against A</th>
            </tr>
          </thead>
          <tbody>
            {states.map((st) => {
              const x = res.a.states.find((s) => s.state === st);
              const y = res.b.states.find((s) => s.state === st);
              const d = x?.avgMs && y?.avgMs ? y.avgMs / x.avgMs - 1 : null;
              return (
                <tr key={st} className="eng-compare-row border-t border-slate-800" data-state={st}>
                  <td className="py-1 font-mono">{st}</td>
                  <td className="text-right">{x ? `${Math.round(x.share * 100)} %` : '—'}</td>
                  <td className="text-right">{x ? `${dur(x.avgMs)} (${x.count})` : '—'}</td>
                  <td className="text-right">{y ? `${Math.round(y.share * 100)} %` : '—'}</td>
                  <td className="text-right">{y ? `${dur(y.avgMs)} (${y.count})` : '—'}</td>
                  <td className={`text-right ${d === null ? '' : d > 0.3 ? 'text-rose-300' : d < -0.3 ? 'text-emerald-300' : ''}`}>{d === null ? '' : `${d > 0 ? '+' : ''}${Math.round(d * 100)} %`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

const Changed: React.FC<{ conn: GatewayConnection | null; plcs: { id: string; name: string }[] }> = ({ conn, plcs }) => {
  const [plc, setPlc] = useState(plcs[0]?.id ?? '');
  const [vs, setVs] = useState<Version[]>([]);
  const [a, setA] = useState('');
  const [b, setB] = useState('current');
  const [files, setFiles] = useState<{ path: string; change: string }[] | null>(null);
  const [open, setOpen] = useState<{ path: string; before: string | null; after: string | null } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!plc && plcs[0]) setPlc(plcs[0].id);
  }, [plcs, plc]);
  useEffect(() => {
    if (!conn || !plc) return;
    void conn.request<{ versions?: Version[] }>({ type: 'engVersions', plc }, 'engVersionsResult').then((r) => {
      const list = r.versions ?? [];
      setVs(list);
      setB(list[0]?.id ?? 'current');
      setA(list[1]?.id ?? '');
    }).catch(() => setVs([]));
  }, [conn, plc]);
  useEffect(() => {
    if (!conn || !plc || !a || !b) return setFiles(null);
    setOpen(null);
    void conn.request<{ files?: { path: string; change: string }[]; error?: string }>({ type: 'engDiff', plc, a, b }, 'engDiffResult', 60000).then((r) => {
      setError(r.error ?? '');
      setFiles(r.files ?? []);
    });
  }, [conn, plc, a, b]);
  const show = async (path: string) => {
    const r = await conn?.request<{ path: string; before: string | null; after: string | null }>({ type: 'engDiff', plc, a, b, path }, 'engDiffResult', 60000);
    if (r) setOpen(r);
  };
  const rows = open ? diffHunks(diffLines(open.before ?? '', open.after ?? ''), 3) : [];
  const label = (v: Version) => `${v.current ? 'Now: ' : ''}${v.at ? new Date(v.at).toLocaleString() : v.id}${v.project ? ` (${v.project})` : ''}`;
  return (
    <div id="eng-changed">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <select id="eng-plc" value={plc} onChange={(e) => setPlc(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1">
          {plcs.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select id="eng-va" value={a} onChange={(e) => setA(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1">
          <option value="">(the version before)</option>
          {vs.map((v) => (
            <option key={v.id} value={v.id}>{label(v)}</option>
          ))}
        </select>
        →
        <select id="eng-vb" value={b} onChange={(e) => setB(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1">
          {vs.map((v) => (
            <option key={v.id} value={v.id}>{label(v)}</option>
          ))}
        </select>
      </div>
      {!vs.length && <div className="text-slate-400">The gateway keeps no versions of this PLC's project yet (its PLC projects, on the setup page: the PLC must keep its sources).</div>}
      {vs.length === 1 && <div className="text-slate-400">One version kept so far: the next one the PLC runs is compared with it.</div>}
      {error && <div className="text-rose-300">{error}</div>}
      {files && (
        <ul className="mb-3 space-y-0.5 text-sm">
          {!files.length && <li className="text-slate-400">No file changed.</li>}
          {files.map((f) => (
            <li key={f.path}>
              <button type="button" onClick={() => void show(f.path)} className={`eng-file text-left hover:underline ${f.change === 'added' ? 'text-emerald-300' : f.change === 'removed' ? 'text-rose-300' : 'text-sky-300'}`} data-change={f.change}>
                {f.change === 'added' ? '+' : f.change === 'removed' ? '−' : '~'} {f.path}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div id="eng-diff" className="rounded border border-slate-800 bg-slate-950 font-mono text-xs overflow-x-auto">
          <div className="sticky top-0 bg-slate-900 px-2 py-1 text-slate-300">{open.path}</div>
          {rows.map((r, i) =>
            r === null ? (
              <div key={i} className="px-2 text-slate-600">⋯</div>
            ) : (
              <div key={i} className={`eng-diff-row whitespace-pre px-2 ${r.type === 'add' ? 'bg-emerald-950 text-emerald-200' : r.type === 'del' ? 'bg-rose-950 text-rose-200' : 'text-slate-400'}`} data-type={r.type}>
                {r.type === 'add' ? '+ ' : r.type === 'del' ? '- ' : '  '}
                {r.text}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
};
