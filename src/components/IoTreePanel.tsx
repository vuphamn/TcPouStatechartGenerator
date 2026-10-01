import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronRight, Cpu, FolderOpen, GitBranch, Link2, ListTree, Network, RefreshCw, Search } from 'lucide-react';
import { IoNetworkView, allBoxes, boxStates, healthLinks, stateText, type EcatStatesResult } from './IoNetworkView.tsx';

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
  /** Its Box Id in the project */
  id?: number;
  /** Its place among the master's slaves (null: disabled) */
  slave?: number | null;
  /** Where its port A is cabled: the port (0 … 3: A … D) of the box of that Id, or the master */
  portA?: { box?: number; port: number; master?: boolean };
  disabled?: boolean;
  boxes: IoBox[];
  pdos: IoPdo[];
}
export interface IoDevice {
  name: string;
  netId: string | null;
  disabled?: boolean;
  boxes: IoBox[];
}
export interface IoTree {
  devices: IoDevice[];
  links: { path: string; variable: string; type: string; dir: 'in' | 'out' }[];
  /** Its project, read from the PLC (CurrentConfig.tszip) */
  project?: string;
  /** Read offline from this project folder (not from the PLC) */
  folder?: string;
  error?: string;
}
/** A transition whose condition reads a variable */
export interface IoGuardUse {
  from: string;
  to: string;
}

/** A value as shown (a boolean as TRUE / FALSE) */
const show = (v: unknown) => (v === undefined ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'object' ? JSON.stringify(v) : String(v));

const VIEW_KEY = 'kss.io.view';

/**
 * The PLC's I/O, read-only: its devices (EtherCAT …), each box (coupler, terminal) where it is wired, its inputs
 * and outputs, the PLC variables linked to them and their live values (followed while they are on show), each box's
 * state (the master's, or its own InfoData), and the transitions whose conditions read a linked variable. As a tree
 * or as the network it is cabled as. Nothing is written to the PLC (no forcing)
 */
export const IoTreePanel: React.FC<{
  tree: IoTree | null;
  loading: boolean;
  connected: boolean;
  onLoad: () => void;
  /** Offline: the I/O of a TwinCAT project on this computer (the open POU's, or one chosen); absent: not offered */
  onLoadFolder?: (pick: boolean) => void;
  /** The linked variables on show: followed live (their values by variable, lower case) */
  onVisibleVariables: (vars: string[]) => void;
  valueOf: (variable: string) => { v: unknown; changedAt?: number } | undefined;
  /** The EtherCAT masters' states (polled while asked for: onStatesWanted) */
  ecat?: EcatStatesResult | null;
  onStatesWanted?: (on: boolean) => void;
  /** The transitions whose conditions read a variable; one opened (its code) */
  guardsOf?: (variable: string) => IoGuardUse[];
  onOpenGuard?: (g: IoGuardUse) => void;
}> = ({ tree, loading, connected, onLoad, onLoadFolder, onVisibleVariables, valueOf, ecat = null, onStatesWanted, guardsOf, onOpenGuard }) => {
  const [filter, setFilter] = useState('');
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [guardsOpen, setGuardsOpen] = useState<string | null>(null);
  const [view, setViewState] = useState<'tree' | 'network'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'network' ? 'network' : 'tree';
    } catch {
      return 'tree';
    }
  });
  const setView = (v: 'tree' | 'network') => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // per-viewer convenience only
    }
  };
  const networkDevices = useMemo(() => (tree?.devices ?? []).filter((d) => d.boxes.length), [tree]);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const device = networkDevices.find((d) => d.name === deviceName) ?? networkDevices[0] ?? null;
  const offline = !!tree && tree.folder !== undefined;
  // The masters' states asked for while a tree from the PLC is on show
  const wantStates = !!tree && !offline && connected && (tree.devices ?? []).some((d) => d.netId && d.boxes.length);
  useEffect(() => {
    if (!wantStates || !onStatesWanted) return;
    onStatesWanted(true);
    return () => onStatesWanted(false);
  }, [wantStates, onStatesWanted]);
  const states = useMemo(() => boxStates(tree?.devices ?? [], offline ? null : ecat, valueOf), [tree, ecat, offline, valueOf]);
  const q = filter.trim().toLowerCase();
  // (a box shown: it, or an entry of it, or a box in it matches)
  const matches = (b: IoBox): boolean =>
    !q ||
    b.name.toLowerCase().includes(q) ||
    b.pdos.some((p) => p.entries.some((e) => e.name.toLowerCase().includes(q) || (e.link ?? '').toLowerCase().includes(q))) ||
    b.boxes.some(matches);
  const entriesOf = (b: IoBox) => b.pdos.flatMap((p) => p.entries.filter((e) => !linkedOnly || e.link).map((e) => ({ ...e, pdo: p.name, dir: p.dir })));
  // The variables followed: each box's health items first, then those on show (open boxes; the network's LEDs)
  const visible = useMemo(() => {
    const health: string[] = [];
    for (const d of tree?.devices ?? []) for (const b of allBoxes(d.boxes)) {
      const h = healthLinks(b);
      if (h.state) health.push(h.state);
      if (h.wc) health.push(h.wc);
    }
    const out: string[] = [];
    if (view === 'network' && device) {
      for (const b of allBoxes(device.boxes)) for (const p of b.pdos) for (const e of p.entries) if (e.link && /^(BIT|BOOL)/i.test(e.type || 'BIT')) out.push(e.link);
    } else {
      const walk = (bs: IoBox[]) => bs.forEach((b) => {
        if (!matches(b)) return;
        if (open.has(b.path) || q) for (const e of entriesOf(b)) if (e.link) out.push(e.link);
        if (open.has(b.path) || q) walk(b.boxes);
      });
      (tree?.devices ?? []).forEach((d) => (open.has(d.name) || q) && walk(d.boxes));
    }
    return [...new Set([...health.slice(0, 40), ...out])].slice(0, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, open, q, linkedOnly, view, device]);
  useEffect(() => onVisibleVariables(visible), [visible, onVisibleVariables]);
  const toggle = (k: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  // (the box a network node stands for: shown in the tree, its device and the boxes it is in opened)
  const showInTree = (path: string) => {
    const parts = path.split('^');
    setOpen((s) => {
      const n = new Set(s);
      for (let i = 1; i <= parts.length; i++) n.add(parts.slice(0, i).join('^'));
      return n;
    });
    setView('tree');
    window.setTimeout(() => document.querySelector(`[data-io-box="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'center' }), 0);
  };
  const masterNote = (() => {
    if (offline) return `Offline: the project in ${tree?.folder} (no states, no values)`;
    if (!connected) return 'Not live: no states';
    if (ecat?.error) return `States: ${ecat.error}`;
    const m = device?.netId ? ecat?.masters?.[device.netId] : undefined;
    if (!m) return device?.netId ? 'Reading the states…' : 'This device has no AmsNetId: no states';
    if (m.error) return `The master: ${m.error}`;
    return `The master at ${device?.netId}: ${m.count ?? 0} slaves`;
  })();

  const badge = (b: IoBox) => {
    const st = states.get(b.path);
    if (b.disabled) return <span data-io-health="disabled" className="shrink-0 px-1 rounded text-[9px] text-slate-500 border border-slate-700">disabled</span>;
    if (!st) return null;
    return (
      <span data-io-health={st.ok ? 'ok' : 'down'} data-io-state={st.name} title={stateText(st)} className={`shrink-0 px-1 rounded text-[9px] font-bold border ${st.ok ? 'text-emerald-300 border-emerald-800 bg-emerald-950/50' : 'text-rose-200 border-rose-700 bg-rose-950/70'}`}>
        {st.name}
        {st.flags.includes('working counter') && st.name !== 'WC' ? ' · WC' : ''}
      </span>
    );
  };

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
          <span className="ml-auto shrink-0 flex items-center gap-1.5">
            {linked > 0 && <span className="text-[9px] text-slate-500">{linked} linked</span>}
            {badge(b)}
          </span>
        </button>
        {isOpen && (
          <>
            {entries.map((e) => {
              const val = e.link ? valueOf(e.link) : undefined;
              const recent = !!val?.changedAt && Date.now() - val.changedAt < 1500;
              const uses = e.link && guardsOf ? guardsOf(e.link) : [];
              const usesOpen = guardsOpen === e.path;
              return (
                <React.Fragment key={e.path}>
                  <div data-io-entry={e.path} className="flex items-center gap-1.5 py-0.5 text-[11px]" style={{ paddingLeft: 22 + depth * 14 }} title={`${e.pdo} / ${e.name}${e.type ? ` (${e.type})` : ''}${e.link ? `\nLinked: ${e.link}` : ''}`}>
                    {e.dir === 'in' ? <ArrowDownToLine className="w-3 h-3 text-emerald-400 shrink-0" /> : <ArrowUpFromLine className="w-3 h-3 text-amber-400 shrink-0" />}
                    <span className="shrink-0 text-slate-400">{e.pdo === '(other links)' ? '' : `${e.pdo} · `}{e.name}</span>
                    {e.link && (
                      <span className="min-w-0 flex items-center gap-1 text-slate-500 font-mono truncate">
                        <Link2 className="w-3 h-3 shrink-0" />
                        <span className="truncate">{e.link}</span>
                      </span>
                    )}
                    {uses.length > 0 && (
                      <button
                        type="button"
                        data-io-guards={e.link}
                        onClick={() => (uses.length === 1 ? onOpenGuard?.(uses[0]) : setGuardsOpen(usesOpen ? null : e.path))}
                        className="shrink-0 flex items-center gap-0.5 px-1 rounded border border-violet-700/70 text-violet-300 hover:bg-violet-950/60 text-[9px]"
                        title={`Read by ${uses.length === 1 ? 'the condition' : `${uses.length} conditions`}: ${uses.map((g) => `${g.from} → ${g.to}`).join(', ')}${uses.length === 1 ? ' (open its code)' : ''}`}
                      >
                        <GitBranch className="w-2.5 h-2.5" />
                        {uses.length === 1 ? `${uses[0].from} → ${uses[0].to}` : `${uses.length} guards`}
                      </button>
                    )}
                    {e.link && (
                      <span data-io-value={e.link} className={`ml-auto shrink-0 px-1.5 rounded font-mono ${val === undefined ? 'text-slate-600' : recent ? 'bg-sky-900/70 text-sky-100' : val.v === true ? 'bg-emerald-950/70 text-emerald-300' : 'text-slate-200'}`}>
                        {val === undefined ? (connected && !offline ? '…' : '—') : show(val.v)}
                      </span>
                    )}
                  </div>
                  {usesOpen && uses.length > 1 && (
                    <div data-io-guard-list={e.link} className="flex flex-wrap gap-1 py-0.5" style={{ paddingLeft: 40 + depth * 14 }}>
                      {uses.map((g) => (
                        <button key={`${g.from}->${g.to}`} type="button" data-io-guard={`${g.from}->${g.to}`} onClick={() => onOpenGuard?.(g)} className="px-1.5 rounded border border-violet-800 text-violet-200 hover:bg-violet-950/60 text-[10px]" title="Open its code">
                          {g.from} → {g.to}
                        </button>
                      ))}
                    </div>
                  )}
                </React.Fragment>
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
        <span className="text-[10px] text-slate-500 truncate">{tree?.project ? `${tree.project} · ` : ''}{offline ? 'offline, from the project folder' : 'read-only: nothing is written to the PLC'}</span>
        <span id="io-view-toggle" className="ml-auto shrink-0 flex rounded border border-slate-700 overflow-hidden" role="group" aria-label="View">
          <button id="io-view-tree" type="button" aria-pressed={view === 'tree'} onClick={() => setView('tree')} className={`flex items-center gap-1 px-1.5 py-0.5 ${view === 'tree' ? 'bg-sky-900/60 text-sky-100' : 'text-slate-400 hover:bg-slate-800'}`} title="The I/O as a tree">
            <ListTree className="w-3 h-3" /> Tree
          </button>
          <button id="io-view-network" type="button" aria-pressed={view === 'network'} onClick={() => setView('network')} className={`flex items-center gap-1 px-1.5 py-0.5 border-l border-slate-700 ${view === 'network' ? 'bg-sky-900/60 text-sky-100' : 'text-slate-400 hover:bg-slate-800'}`} title="The EtherCAT network as it is cabled, with each box's state (not yet confirmed on hardware)">
            <Network className="w-3 h-3" /> Network
          </button>
        </span>
        {onLoadFolder && (
          <button id="io-tree-load-folder" type="button" onClick={(ev) => onLoadFolder(ev.shiftKey)} disabled={loading} className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40" title="Offline: the I/O of the TwinCAT project on this computer (the open POU's project; Shift: choose a folder)">
            <FolderOpen className="w-3 h-3" /> From project
          </button>
        )}
        <button id="io-tree-load" type="button" onClick={onLoad} disabled={loading || !connected} className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40" title="Read the I/O configuration from the PLC (its boot folder: CurrentConfig.tszip)">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> {tree && !offline ? 'Reload' : 'Read from the PLC'}
        </button>
      </div>
      {view === 'tree' && (
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
      )}
      {view === 'network' && networkDevices.length > 1 && (
        <div className="flex items-center gap-2 px-2 py-1 border-b border-slate-800 text-[10px] text-slate-400">
          <label htmlFor="io-network-device">Device</label>
          <select id="io-network-device" value={device?.name ?? ''} onChange={(e) => setDeviceName(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-slate-200">
            {networkDevices.map((d) => (
              <option key={d.name} value={d.name}>{d.name}</option>
            ))}
          </select>
        </div>
      )}
      {!tree && !loading && (
        <div id="io-tree-empty" className="p-4 text-center text-slate-400">
          {connected
            ? 'Read the I/O configuration from the PLC: its devices, couplers and terminals, and the PLC variables linked to them, with live values.'
            : `Go live on a PLC (the Live tab), then read its I/O here.${onLoadFolder ? ' Offline: From project shows the I/O of the TwinCAT project on this computer.' : ''}`}
        </div>
      )}
      {tree?.error && <div id="io-tree-error" className="p-3 text-rose-300">{tree.error}</div>}
      {view === 'network' && tree && (
        <div className="flex-1 min-h-0">
          {device ? (
            <IoNetworkView device={device} states={states} stateNote={masterNote} valueOf={valueOf} onSelectBox={showInTree} />
          ) : (
            <div id="io-network-empty" className="p-4 text-center text-slate-400">No I/O device with boxes to draw.</div>
          )}
        </div>
      )}
      {view === 'tree' && (
        <div className="flex-1 min-h-0 overflow-auto p-1 custom-scrollbar">
          {tree?.devices.map((d) => (
            <div key={d.name} data-io-device={d.name}>
              <button type="button" onClick={() => toggle(d.name)} className="w-full flex items-center gap-1.5 px-1 py-1 rounded hover:bg-slate-800 text-left font-semibold text-slate-100">
                {open.has(d.name) || q ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
                <Cpu className="w-3.5 h-3.5 text-sky-400" />
                <span className="truncate">{d.name}</span>
                {d.disabled && <span className="text-[9px] font-normal text-slate-500 border border-slate-700 rounded px-1">disabled</span>}
                {(() => {
                  const down = allBoxes(d.boxes).filter((b) => states.get(b.path)?.ok === false).length;
                  return down > 0 ? <span data-io-device-down={down} className="text-[9px] font-bold text-rose-200 bg-rose-950/70 border border-rose-700 rounded px-1">{down} not OP</span> : null;
                })()}
                {d.netId && <span className="ml-auto text-[9px] font-mono font-normal text-slate-500">{d.netId}</span>}
              </button>
              {(open.has(d.name) || q) && d.boxes.map((b) => boxRow(b, 1))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
