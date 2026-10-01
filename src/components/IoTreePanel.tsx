import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronRight, Cpu, Link2, RefreshCw, Search } from 'lucide-react';

/** The PLC's I/O tree (shared/tcIoTree.cjs): devices, boxes nested as wired, their PDOs' entries and PLC links */
export interface IoEntry {
  name: string;
  type: string;
  path: string;
  /** The PLC variable linked to it (e.g. MAIN.fbCyl.di_extended) */
  link?: string;
}
export interface IoPdo {
  name: string;
  dir: 'in' | 'out';
  entries: IoEntry[];
}
export interface IoBox {
  name: string;
  product: string;
  path: string;
  boxes: IoBox[];
  pdos: IoPdo[];
}
export interface IoDevice {
  name: string;
  netId: string | null;
  boxes: IoBox[];
}
export interface IoTree {
  devices: IoDevice[];
  links: { path: string; variable: string; type: string; dir: 'in' | 'out' }[];
  /** Its project, read from the PLC (CurrentConfig.tszip) */
  project?: string;
  error?: string;
}

/** A value as shown (a boolean as TRUE / FALSE) */
const show = (v: unknown) => (v === undefined ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * The PLC's I/O, read-only: its devices (EtherCAT …), each box (coupler, terminal) where it is wired, its inputs
 * and outputs, the PLC variables linked to them and their live values (followed while they are on show). Nothing
 * is written to the PLC (no forcing)
 */
export const IoTreePanel: React.FC<{
  tree: IoTree | null;
  loading: boolean;
  connected: boolean;
  onLoad: () => void;
  /** The linked variables on show: followed live (their values by variable, lower case) */
  onVisibleVariables: (vars: string[]) => void;
  valueOf: (variable: string) => { v: unknown; changedAt?: number } | undefined;
}> = ({ tree, loading, connected, onLoad, onVisibleVariables, valueOf }) => {
  const [filter, setFilter] = useState('');
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const q = filter.trim().toLowerCase();
  // (a box shown: it, or an entry of it, or a box in it matches)
  const matches = (b: IoBox): boolean =>
    !q ||
    b.name.toLowerCase().includes(q) ||
    b.pdos.some((p) => p.entries.some((e) => e.name.toLowerCase().includes(q) || (e.link ?? '').toLowerCase().includes(q))) ||
    b.boxes.some(matches);
  const entriesOf = (b: IoBox) => b.pdos.flatMap((p) => p.entries.filter((e) => !linkedOnly || e.link).map((e) => ({ ...e, pdo: p.name, dir: p.dir })));
  // The variables on show (open boxes): followed
  const visible = useMemo(() => {
    const out: string[] = [];
    const walk = (bs: IoBox[]) => bs.forEach((b) => {
      if (!matches(b)) return;
      if (open.has(b.path) || q) for (const e of entriesOf(b)) if (e.link) out.push(e.link);
      if (open.has(b.path) || q) walk(b.boxes);
    });
    (tree?.devices ?? []).forEach((d) => (open.has(d.name) || q) && walk(d.boxes));
    return [...new Set(out)].slice(0, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, open, q, linkedOnly]);
  useEffect(() => onVisibleVariables(visible), [visible, onVisibleVariables]);
  const toggle = (k: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  const boxRow = (b: IoBox, depth: number): React.ReactNode => {
    if (!matches(b)) return null;
    const isOpen = open.has(b.path) || !!q;
    const entries = entriesOf(b);
    const linked = b.pdos.reduce((n, p) => n + p.entries.filter((e) => e.link).length, 0);
    return (
      <div key={b.path} data-io-box={b.path}>
        <button type="button" onClick={() => toggle(b.path)} className="w-full flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-slate-800 text-left" style={{ paddingLeft: 4 + depth * 14 }} title={b.path}>
          {isOpen ? <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" /> : <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />}
          {b.product && <span className="shrink-0 px-1 rounded bg-slate-800 border border-slate-700 font-mono text-[9px] text-sky-300">{b.product}</span>}
          <span className="truncate text-slate-200">{b.name.replace(/\s*\([^()]*\)\s*$/, '')}</span>
          {linked > 0 && <span className="ml-auto shrink-0 text-[9px] text-slate-500">{linked} linked</span>}
        </button>
        {isOpen && (
          <>
            {entries.map((e) => {
              const val = e.link ? valueOf(e.link) : undefined;
              const recent = !!val?.changedAt && Date.now() - val.changedAt < 1500;
              return (
                <div key={e.path} data-io-entry={e.path} className="flex items-center gap-1.5 py-0.5 text-[11px]" style={{ paddingLeft: 22 + depth * 14 }} title={`${e.pdo} / ${e.name}${e.type ? ` (${e.type})` : ''}${e.link ? `\nLinked: ${e.link}` : ''}`}>
                  {e.dir === 'in' ? <ArrowDownToLine className="w-3 h-3 text-emerald-400 shrink-0" /> : <ArrowUpFromLine className="w-3 h-3 text-amber-400 shrink-0" />}
                  <span className="shrink-0 text-slate-400">{e.pdo === '(other links)' ? '' : `${e.pdo} · `}{e.name}</span>
                  {e.link && (
                    <span className="min-w-0 flex items-center gap-1 text-slate-500 font-mono truncate">
                      <Link2 className="w-3 h-3 shrink-0" />
                      <span className="truncate">{e.link}</span>
                    </span>
                  )}
                  {e.link && (
                    <span data-io-value={e.link} className={`ml-auto shrink-0 px-1.5 rounded font-mono ${val === undefined ? 'text-slate-600' : recent ? 'bg-sky-900/70 text-sky-100' : val.v === true ? 'bg-emerald-950/70 text-emerald-300' : 'text-slate-200'}`}>
                      {val === undefined ? (connected ? '…' : '—') : show(val.v)}
                    </span>
                  )}
                </div>
              );
            })}
            {b.boxes.map((c) => boxRow(c, depth + 1))}
          </>
        )}
      </div>
    );
  };

  return (
    <div id="io-tree-panel" className="h-full flex flex-col text-xs bg-slate-950">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-slate-800">
        <Cpu className="w-3.5 h-3.5 text-sky-400" />
        <span className="font-semibold text-slate-200">I/O</span>
        <span className="text-[10px] text-slate-500 truncate">{tree?.project ? `${tree.project} · ` : ''}read-only: nothing is written to the PLC</span>
        <button id="io-tree-load" type="button" onClick={onLoad} disabled={loading} className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40" title="Read the I/O configuration from the PLC (its boot folder: CurrentConfig.tszip)">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> {tree ? 'Reload' : 'Read from the PLC'}
        </button>
      </div>
      <div className="flex items-center gap-2 px-2 py-1 border-b border-slate-800">
        <span className="flex-1 flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-800 bg-slate-900">
          <Search className="w-3 h-3 text-slate-500" />
          <input id="io-tree-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter: a terminal, a channel, a variable" className="flex-1 bg-transparent outline-none text-slate-200 text-[11px]" />
        </span>
        <label className="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer" title="Only the inputs and outputs a PLC variable is linked to">
          <input id="io-tree-linked-only" type="checkbox" checked={linkedOnly} onChange={(e) => setLinkedOnly(e.target.checked)} className="accent-sky-500 w-3 h-3" />
          Linked only
        </label>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-1 custom-scrollbar">
        {!tree && !loading && (
          <div id="io-tree-empty" className="p-4 text-center text-slate-400">
            {connected ? 'Read the I/O configuration from the PLC: its devices, couplers and terminals, and the PLC variables linked to them, with live values.' : 'Go live on a PLC (the Live tab), then read its I/O here.'}
          </div>
        )}
        {tree?.error && <div id="io-tree-error" className="p-3 text-rose-300">{tree.error}</div>}
        {tree?.devices.map((d) => (
          <div key={d.name} data-io-device={d.name}>
            <button type="button" onClick={() => toggle(d.name)} className="w-full flex items-center gap-1.5 px-1 py-1 rounded hover:bg-slate-800 text-left font-semibold text-slate-100">
              {open.has(d.name) || q ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
              <Cpu className="w-3.5 h-3.5 text-sky-400" />
              <span className="truncate">{d.name}</span>
              {d.netId && <span className="ml-auto text-[9px] font-mono font-normal text-slate-500">{d.netId}</span>}
            </button>
            {(open.has(d.name) || q) && d.boxes.map((b) => boxRow(b, 1))}
          </div>
        ))}
      </div>
    </div>
  );
};
