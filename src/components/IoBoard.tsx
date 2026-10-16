import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, CircleDot, Cpu, Info, ListTree, Network, Search, X } from 'lucide-react';
import { IoBoxProperties, type DeviceInfo, type DeviceInfoRequest } from './IoBoxProperties.tsx';
import type { IoBox, IoDevice, IoTree } from './IoTreePanel.tsx';
import { IoNetworkView, allBoxes, boxStates, stateText, type EcatStatesResult, type SlaveState } from './IoNetworkView.tsx';
import { SignalTrends, type SignalSeries } from './SignalTrends.tsx';
import type { BoardRule, RuleGroup } from './BoardRuleDialog.tsx';
import { machineKey } from '../utils/boardTree.ts';
import type { GatewayConnection } from '../utils/liveGateway.ts';
import { SparesFor, useSpares } from './SparesFor.tsx';

interface IoPlcState {
  id: string;
  name: string;
  state: string;
  message: string;
  plcState: string | null;
  ecat: EcatStatesResult | null;
  signals?: { path: string; error: string }[];
}

type Msg = { type: string; plc?: string; tree?: IoTree; plcs?: IoPlcState[]; history?: Record<string, { t: number; v: unknown }[]>; samples?: Record<string, { t: number; v: unknown }[]>; error?: string };

const KEEP_MS = 15 * 60_000;
const VIEW_KEY = 'kss.ioboard.view';
const FILTER_KEY = 'kss.ioboard.filter';
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // (this viewer only, this time)
    }
  },
};

/** Who made a box: its ESI's supplier, else Beckhoff (vendor 2), else its EtherCAT vendor id */
export const vendorOf = (b: IoBox) => b.info?.supplier || (b.info?.vendorId === 2 ? 'Beckhoff' : b.info?.vendorId !== undefined ? `vendor #x${b.info.vendorId.toString(16)}` : '');
const boxText = (b: IoBox) => `${b.name} ${b.product} ${b.info?.type ?? ''} ${b.info?.desc ?? ''} ${vendorOf(b)}`.toLowerCase();
const entryText = (e: { name: string; link?: string; type: string }, pdo: string) => `${pdo} ${e.name} ${e.link ?? ''} ${e.type}`.toLowerCase();

/**
 * A box's health for the colours: OP and OK, not OK, or not known (no master state, a disabled box); absent: a box of
 * a Hot Connect group not attached (its head not there: optional equipment, not a fault)
 */
const kindOf = (st: SlaveState | undefined, b: IoBox, absent?: Set<string>) => (b.disabled ? 'off' : b.hotConnect && absent?.has(b.hotConnect.key) ? 'absent' : !st ? 'unknown' : st.ok ? 'ok' : 'bad');
/** The Hot Connect groups not attached: their heads not OK */
const absentGroups = (boxes: IoBox[], st: Map<string, SlaveState>) => new Set(boxes.filter((b) => b.hotConnect?.head && kindOf(st.get(b.path), b) === 'bad').map((b) => b.hotConnect!.key));

/**
 * The operator board's I/O page: each PLC's I/O devices (EtherCAT masters …) with their boxes as cabled (couplers,
 * terminals, drives and valve terminals of any maker the project has), each box's state from its master (OP, or not:
 * red, with why), as a tree or as the network. A filter finds a box, a channel or a PLC variable (every word);
 * problems only; linked only. A linked channel's box (its PLC variable) charts it live (Signals), and Record… keeps it
 * on the gateway. A box's ⓘ (the network: right-click or Alt+click) opens its properties as on the I/O tab: its
 * pictures (front, back, wiring: the gateway's Devices folder), the maker's page, a search, the manual, its channels.
 * Read-only: nothing is written to the PLC.
 */
export const IoBoard: React.FC<{
  conn: GatewayConnection | null;
  connected: boolean;
  subscribe: (fn: (m: Msg) => void) => () => void;
  plcIds: string[];
  /** The board's PLCs shown (a saved filter's), all when empty */
  onlyPlcs: string[];
  signals: string[];
  onSignals: (keys: string[]) => void;
  recordings: BoardRule[];
  onRecord: (groups: RuleGroup[]) => void;
  canEdit: boolean;
  narrow: boolean;
  /** The charted signals kept with each PLC's fault records (absent: not this user's) */
  onFaultSignals?: (byPlc: Record<string, string[]>) => Promise<string | null>;
  /** A box to show (a QR label scanned): found, filtered to, its properties opened */
  focusPath?: { plc: string; path: string } | null;
  /** QR labels of the boxes shown */
  onQr?: (items: { plc: string; plcName: string; path: string; label: string; detail: string }[]) => void;
}> = ({ conn, connected, subscribe, plcIds, onlyPlcs, signals, onSignals, recordings, onRecord, canEdit, narrow, onFaultSignals, focusPath, onQr }) => {
  const [trees, setTrees] = useState<Record<string, IoTree>>({});
  const [states, setStates] = useState<IoPlcState[]>([]);
  const [error, setError] = useState('');
  const points = useRef<Record<string, { t: number; v: unknown }[]>>({});
  const [tick, setTick] = useState(0);
  const dirty = useRef(false);
  const [filter, setFilterState] = useState(() => store.get(FILTER_KEY) ?? '');
  const setFilter = (v: string) => {
    setFilterState(v);
    store.set(FILTER_KEY, v);
  };
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [linkedOnly, setLinkedOnly] = useState(true);
  const [views, setViews] = useState<Record<string, 'tree' | 'network'>>(() => {
    try {
      return JSON.parse(store.get(VIEW_KEY) ?? '{}');
    } catch {
      return {};
    }
  });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Record<string, string>>({}); // device -> box path (network view)
  const [history, setHistory] = useState<{ from: number; to: number; loading?: string } | null>(null);
  const [faultSaid, setFaultSaid] = useState('');
  // A box's properties (the I/O tab's panel); its details from the gateway (TwinCAT's device descriptions there, its
  // Devices folder's pictures)
  const [propsAt, setPropsAt] = useState<{ plc: string; path: string } | null>(null);
  // (the spare parts: those that fit a box, in its properties)
  const spareParts = useSpares(conn, connected, subscribe as unknown as Parameters<typeof useSpares>[2]);
  const propsOf = useMemo(() => {
    const tree = propsAt ? trees[propsAt.plc] : null;
    if (!propsAt || !tree) return null;
    for (const d of tree.devices ?? []) {
      const all = allBoxes(d.boxes);
      const box = all.find((b) => b.path === propsAt.path);
      if (box) return { box, device: d, parent: box.portA?.box !== undefined ? all.find((b) => b.id === box.portA!.box) ?? null : null };
    }
    return null;
  }, [propsAt, trees]);
  const [focusDone, setFocusDone] = useState(false);
  useEffect(() => {
    if (!focusPath || focusDone) return;
    const tree = trees[focusPath.plc];
    const box = tree?.devices.flatMap((d) => allBoxes(d.boxes)).find((b) => b.path === focusPath.path);
    if (!box) return;
    setFilterState(box.name);
    setPropsAt(focusPath);
    setFocusDone(true);
  }, [focusPath, focusDone, trees]);
  const fetchInfo = useMemo(
    () => (req: DeviceInfoRequest) => (conn ? conn.request<DeviceInfo>({ type: 'deviceInfo', productCode: req.productCode, revision: req.revision, deviceType: req.type, product: req.product }, 'deviceInfoResult', 20000) : Promise.reject(new Error('Not connected'))),
    [conn]
  );
  const historyPoints = useRef<Record<string, { t: number; v: unknown }[]>>({});

  // The gateway's I/O messages
  useEffect(
    () =>
      subscribe((m) => {
        if (m.type === 'ioBoardTree' && m.plc && m.tree) setTrees((t) => ({ ...t, [m.plc!]: m.tree! }));
        else if (m.type === 'ioBoardState') {
          setStates(m.plcs ?? []);
          setError(m.error ?? '');
        } else if (m.type === 'ioSignalHistory' && m.plc && m.history) {
          for (const [p, list] of Object.entries(m.history)) points.current[machineKey(m.plc, p)] = list.slice();
          dirty.current = true;
        } else if (m.type === 'ioSignalSamples' && m.plc && m.samples) {
          const cut = Date.now() - KEEP_MS;
          for (const [p, list] of Object.entries(m.samples)) {
            const k = machineKey(m.plc, p);
            const arr = (points.current[k] ??= []);
            arr.push(...list);
            let drop = 0;
            while (drop < arr.length - 1 && arr[drop + 1].t < cut) drop++;
            if (drop) arr.splice(0, drop);
          }
          dirty.current = true;
        }
      }),
    [subscribe]
  );
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!dirty.current) return;
      dirty.current = false;
      setTick((x) => x + 1);
    }, 500);
    return () => window.clearInterval(t);
  }, []);
  // Watched while the page is open
  const watchKey = connected ? plcIds.join(',') : '';
  useEffect(() => {
    if (!watchKey && !connected) return;
    conn?.send({ type: 'ioBoardWatch', plcs: plcIds });
    return () => {
      conn?.send({ type: 'ioBoardStop' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, connected, conn]);
  // The chosen signals, per PLC (sent again after a reconnect)
  const byPlc = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const k of signals) {
      const [plc, p] = k.split('|');
      (out[plc] ??= []).push(p);
    }
    return out;
  }, [signals]);
  const sentRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!connected || !conn) return;
    const ids = new Set([...Object.keys(byPlc), ...Object.keys(sentRef.current)]);
    for (const plc of ids) {
      const list = byPlc[plc] ?? [];
      const key = list.join('\n');
      if (sentRef.current[plc] === key) continue;
      sentRef.current[plc] = key;
      void conn.request({ type: 'ioSignals', plc, signals: list }, 'ioSignalsResult').catch(() => undefined);
    }
  }, [byPlc, connected, conn, states.length]);
  useEffect(() => {
    if (!connected) sentRef.current = {};
  }, [connected]);

  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const nameOf = (id: string) => states.find((s) => s.id === id)?.name ?? id;
  const recordingOf = (plc: string, path: string) => recordings.find((r) => r.enabled && r.plc === plc && (r.vars ?? []).some((v) => v.toLowerCase() === path.toLowerCase()))?.id ?? null;
  const toggleSignal = (plc: string, variable: string) => {
    const k = machineKey(plc, variable);
    onSignals(signals.includes(k) ? signals.filter((x) => x !== k) : [...signals, k].slice(-20));
  };
  const whereOf = useMemo(() => {
    const out = new Map<string, string>();
    for (const [plc, tree] of Object.entries(trees)) for (const l of tree.links ?? []) out.set(machineKey(plc, l.variable).toLowerCase(), l.path.replace(/\^/g, ' › '));
    return out;
  }, [trees]);
  const series: SignalSeries[] = signals.map((k) => {
    const [plc, path] = k.split('|');
    const err = states.find((s) => s.id === plc)?.signals?.find((x) => x.path.toLowerCase() === path.toLowerCase())?.error ?? null;
    return { key: k, plc, plcName: nameOf(plc), path, where: whereOf.get(k.toLowerCase()), points: (history ? historyPoints.current[k] : points.current[k]) ?? [], error: err, recording: recordingOf(plc, path) };
  });
  void tick;
  const loadHistory = async (ms: number | null) => {
    if (ms === null || !conn) return setHistory(null);
    const to = Date.now();
    const from = to - ms;
    setHistory({ from, to, loading: 'reading…' });
    historyPoints.current = {};
    const byRec = new Map<string, { plc: string; vars: string[] }>();
    for (const s of series) if (s.recording) byRec.set(s.recording, { plc: s.plc, vars: [...(byRec.get(s.recording)?.vars ?? []), s.path] });
    let note = '';
    for (const [id, r] of byRec) {
      try {
        const res = await conn.request<{ series?: Record<string, { t: number; v: unknown }[]>; truncated?: boolean; error?: string }>({ type: 'recordingVars', id, vars: r.vars, from, to }, 'recordingVarsResult', 60000);
        if (res.error) note = res.error;
        for (const [p, list] of Object.entries(res.series ?? {})) historyPoints.current[machineKey(r.plc, p)] = list;
        if (res.truncated) note = 'only the first 200 000 values';
      } catch (e) {
        note = e instanceof Error ? e.message : String(e);
      }
    }
    setHistory({ from, to, ...(note ? { loading: note } : {}) });
  };

  const shownPlcs = states.filter((s) => !onlyPlcs.length || onlyPlcs.includes(s.id));
  return (
    <div id="io-board" className="flex-1 min-h-0 flex flex-col">
      <div className={`flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/60 ${narrow ? 'px-2 py-1.5' : 'px-4 py-2'}`}>
        <span className="relative flex items-center">
          <Search className="absolute left-2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input
            id="io-board-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFilter('');
                e.currentTarget.blur();
              }
            }}
            placeholder="Filter I/O: box, channel, variable…"
            title="The boxes (name, type, maker), channels and PLC variables with every word typed, e.g. EL1008 door. Esc clears it"
            className={`${narrow ? 'w-44' : 'w-80'} pl-7 pr-7 py-1 rounded bg-slate-950 border border-slate-700 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-600 select-text`}
          />
          {filter && (
            <button type="button" onClick={() => setFilter('')} className="absolute right-1.5 p-0.5 rounded text-slate-400 hover:text-white" title="Clear the filter">
              <X className="w-4 h-4" />
            </button>
          )}
        </span>
        <button id="io-board-problems" type="button" aria-pressed={problemsOnly} onClick={() => setProblemsOnly((v) => !v)} className={`px-2 py-1 rounded border text-sm ${problemsOnly ? 'border-amber-500 bg-amber-500/20 text-amber-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`} title="Only the boxes not in OP (and where they are)">
          Problems only
        </button>
        <label className="flex items-center gap-1 text-sm text-slate-300" title="Only the channels linked to a PLC variable">
          <input type="checkbox" checked={linkedOnly} onChange={(e) => setLinkedOnly(e.target.checked)} /> Linked only
        </label>
        <span className="text-xs text-slate-500">{signals.length ? `${signals.length} signal${signals.length === 1 ? '' : 's'} charted` : 'Tick a linked channel to chart it'}</span>
        {onFaultSignals && signals.length > 0 && (
          <button
            id="io-board-fault-signals"
            type="button"
            onClick={() => void onFaultSignals(byPlc).then((err) => setFaultSaid(err ?? 'Kept with the fault records from now on'))}
            className="px-2 py-1 rounded border border-rose-800 text-sm text-rose-200 hover:bg-rose-950"
            title="Keep these signals with each fault record of their PLC (the minute before and after a fault)"
          >
            Keep with fault records
          </button>
        )}
        {faultSaid && <span id="io-board-fault-said" className="text-xs text-slate-400">{faultSaid}</span>}
        {onQr && (
          <button
            id="io-board-qr"
            type="button"
            onClick={() =>
              onQr(
                states
                  .filter((s) => !onlyPlcs.length || onlyPlcs.includes(s.id))
                  .flatMap((s) => (trees[s.id]?.devices ?? []).flatMap((d) => allBoxes(d.boxes).filter((b) => !b.disabled && words.every((w) => boxText(b).includes(w))).map((b) => ({ plc: s.id, plcName: s.name, path: b.path, label: b.name, detail: `${vendorOf(b)} ${b.info?.type ?? b.product}`.trim() }))))
                  .slice(0, 300)
              )
            }
            className="ml-auto px-2 py-1 rounded border border-slate-700 text-sm text-slate-300 hover:bg-slate-800"
            title="QR labels of the boxes the filter shows: scanned, one opens its properties on a phone"
          >
            QR labels…
          </button>
        )}
      </div>
      <div className={`flex-1 min-h-0 overflow-y-auto ${narrow ? 'p-2 space-y-3' : 'p-4 space-y-5'}`}>
        {error && <div className="px-4 py-2 rounded bg-rose-950 border border-rose-800 text-rose-200">{error}</div>}
        {!error && !shownPlcs.length && <div className="text-slate-400">Reading the PLCs' I/O…</div>}
        {shownPlcs.map((p) => {
          const tree = trees[p.id];
          const devices = (tree?.devices ?? []).filter((d) => d.boxes.length);
          const st = tree ? boxStates(devices, p.ecat, () => undefined) : new Map<string, SlaveState>();
          const boxes = devices.flatMap((d) => allBoxes(d.boxes));
          const absent = absentGroups(boxes, st);
          const bad = boxes.filter((b) => kindOf(st.get(b.path), b, absent) === 'bad').length;
          const ok = boxes.filter((b) => kindOf(st.get(b.path), b, absent) === 'ok').length;
          return (
            <section key={p.id} className="io-board-plc" data-plc={p.id}>
              <h2 className="flex flex-wrap items-center gap-3 mb-2">
                <span className="text-xl font-semibold">{p.name}</span>
                {p.plcState && <span className={`px-2 py-0.5 rounded-full text-sm ${p.plcState === 'Run' ? 'bg-emerald-900/70 text-emerald-200' : 'bg-amber-700 text-amber-50'}`}>{p.plcState === 'Run' ? 'PLC runs' : `PLC: ${p.plcState}`}</span>}
                {tree && !tree.error && (
                  <span className="io-board-counts text-sm text-slate-400">
                    {boxes.length} boxes: <span className="text-emerald-300">{ok} OP</span>
                    {bad > 0 && (
                      <>
                        , <span className="io-board-bad px-2 rounded-full bg-rose-700 text-white">{bad} not OK</span>
                      </>
                    )}
                    {absent.size > 0 && (
                      <>
                        , <span className="io-board-hc px-2 rounded-full bg-slate-700 text-slate-200" title={`Optional equipment, its Hot Connect group's head not on the bus: ${[...absent].map((k) => k.split('^').pop()).join(', ')}`}>{absent.size} Hot Connect group{absent.size === 1 ? '' : 's'} not attached</span>
                      </>
                    )}
                  </span>
                )}
                <span className={`text-sm ${p.state === 'error' ? 'text-rose-400' : 'text-sky-400'}`}>{p.state === 'watching' ? tree?.error ?? '' : p.message || p.state}</span>
              </h2>
              {devices.map((d) => (
                <DeviceView
                  key={d.name}
                  plc={p.id}
                  device={d}
                  states={st}
                  ecatError={d.netId ? p.ecat?.masters?.[d.netId]?.error : undefined}
                  view={views[`${p.id}|${d.name}`] ?? 'tree'}
                  onView={(v) => {
                    const next = { ...views, [`${p.id}|${d.name}`]: v };
                    setViews(next);
                    store.set(VIEW_KEY, JSON.stringify(next));
                  }}
                  words={words}
                  problemsOnly={problemsOnly}
                  linkedOnly={linkedOnly}
                  open={open}
                  onOpen={(k, on) =>
                    setOpen((s) => {
                      const n = new Set(s);
                      if (on) n.add(k);
                      else n.delete(k);
                      return n;
                    })
                  }
                  picked={picked[`${p.id}|${d.name}`]}
                  onPick={(path) => setPicked((x) => ({ ...x, [`${p.id}|${d.name}`]: path }))}
                  signals={signals}
                  onSignal={(v) => toggleSignal(p.id, v)}
                  valueOf={(v) => {
                    const arr = points.current[machineKey(p.id, v)];
                    return arr?.length ? arr[arr.length - 1].v : undefined;
                  }}
                  recorded={(v) => !!recordingOf(p.id, v)}
                  onProps={(path) => setPropsAt({ plc: p.id, path })}
                  propsPath={propsAt?.plc === p.id ? propsAt.path : null}
                  narrow={narrow}
                />
              ))}
              {tree && !tree.error && !devices.length && <div className="text-slate-500">No I/O devices in its project.</div>}
            </section>
          );
        })}
      </div>
      {propsOf && propsAt && (
        <div id="io-board-props" className="fixed inset-y-0 right-0 z-40 w-full max-w-[420px] overflow-y-auto border-l border-slate-700 bg-slate-900 shadow-2xl">
          <IoBoxProperties
            box={propsOf.box}
            device={propsOf.device}
            parent={propsOf.parent}
            state={boxStates([propsOf.device], states.find((s) => s.id === propsAt.plc)?.ecat ?? null, () => undefined).get(propsOf.box.path)}
            events={[]}
            valueOf={(v) => {
              const arr = points.current[machineKey(propsAt.plc, v)];
              return arr?.length ? { v: arr[arr.length - 1].v } : undefined;
            }}
            fetchInfo={fetchInfo}
            picturesWhere="gateway"
            onShowInTree={(path) => {
              const key = `${propsAt.plc}|${propsOf.device.name}`;
              const next = { ...views, [key]: 'tree' as const };
              setViews(next);
              store.set(VIEW_KEY, JSON.stringify(next));
              setOpen((s) => new Set([...s, `${key}|${path}`]));
              window.setTimeout(() => document.querySelector(`.io-board-box[data-box="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'center' }), 50);
            }}
            onClose={() => setPropsAt(null)}
          />
          <SparesFor parts={spareParts} texts={[propsOf.box.name, propsOf.box.product, propsOf.box.info?.type, propsOf.box.info?.desc]} className="px-4 pb-4" />
        </div>
      )}
      {series.length > 0 && (
        <SignalTrends
          signals={series}
          history={history}
          onHistory={(ms) => void loadHistory(ms)}
          onRemove={(k) => onSignals(signals.filter((x) => x !== k))}
          onRecord={
            canEdit
              ? () =>
                  onRecord(
                    Object.entries(byPlc).map(([plc, list]) => ({ plc, plcName: nameOf(plc), machines: [], signals: list }))
                  )
              : undefined
          }
          narrow={narrow}
        />
      )}
    </div>
  );
};

/** One I/O device: its boxes as a tree (filtered), or its network */
const DeviceView: React.FC<{
  plc: string;
  device: IoDevice;
  states: Map<string, SlaveState>;
  ecatError?: string;
  view: 'tree' | 'network';
  onView: (v: 'tree' | 'network') => void;
  words: string[];
  problemsOnly: boolean;
  linkedOnly: boolean;
  open: Set<string>;
  onOpen: (key: string, on: boolean) => void;
  picked?: string;
  onPick: (path: string) => void;
  signals: string[];
  onSignal: (variable: string) => void;
  valueOf: (variable: string) => unknown;
  recorded: (variable: string) => boolean;
  onProps: (path: string) => void;
  propsPath: string | null;
  narrow: boolean;
}> = ({ plc, device, states, ecatError, view, onView, words, problemsOnly, linkedOnly, open, onOpen, picked, onPick, signals, onSignal, valueOf, recorded, onProps, propsPath, narrow }) => {
  const dKey = `${plc}|${device.name}`;
  const devOpen = !open.has(`${dKey}|closed`);
  // What the filter keeps: a box matching it (all of its channels), or the channels matching it (with their box);
  // problems only: the boxes not OK; their parents shown too
  const filtering = words.length > 0 || problemsOnly;
  const absent = useMemo(() => absentGroups(allBoxes(device.boxes), states), [device, states]);
  const keep = useMemo(() => {
    const boxes = new Map<string, 'all' | Set<string>>();
    const visit = (b: IoBox, parents: IoBox[]) => {
      const st = states.get(b.path);
      const problem = !problemsOnly || kindOf(st, b, absent) === 'bad';
      const t = boxText(b) + ' ' + (st ? stateText(st).toLowerCase() : '');
      let hit: 'all' | Set<string> | null = null;
      if (problem && words.every((w) => t.includes(w))) hit = 'all';
      else if (problem && words.length) {
        const entries = new Set<string>();
        for (const pdo of b.pdos) for (const e of pdo.entries) if (words.every((w) => (t + ' ' + entryText(e, pdo.name)).includes(w))) entries.add(e.path);
        if (entries.size) hit = entries;
      }
      if (hit) {
        boxes.set(b.path, hit);
        for (const p of parents) if (!boxes.has(p.path)) boxes.set(p.path, new Set());
      }
      for (const c of b.boxes) visit(c, [...parents, b]);
    };
    if (filtering) for (const b of device.boxes) visit(b, []);
    return boxes;
  }, [device, states, words.join(' '), problemsOnly, filtering, absent]);
  const matches = filtering ? [...keep.entries()].filter(([, k]) => k === 'all' || k.size).length : 0;
  if (filtering && !keep.size) return null;

  const boxRow = (b: IoBox, depth: number): React.ReactNode => {
    if (filtering && !keep.has(b.path)) return null;
    const st = states.get(b.path);
    const kind = kindOf(st, b, absent);
    const k = keep.get(b.path);
    const boxOpen = filtering ? !!k && (k === 'all' ? open.has(`${dKey}|${b.path}`) : k.size > 0 || open.has(`${dKey}|${b.path}`)) : open.has(`${dKey}|${b.path}`);
    const channels = b.pdos.flatMap((pdo) => pdo.entries.map((e) => ({ e, pdo }))).filter(({ e }) => (!linkedOnly || e.link) && (!(k instanceof Set) || k.has(e.path)));
    const vendor = vendorOf(b);
    return (
      <li key={b.path} className="io-board-box" data-box={b.path} data-kind={kind}>
        <div className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: `${depth * (narrow ? 0.8 : 1.2)}rem` }}>
          <button type="button" className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30" disabled={!channels.length} onClick={() => onOpen(`${dKey}|${b.path}`, !boxOpen)} aria-expanded={boxOpen} title={channels.length ? 'Its channels' : linkedOnly ? 'No linked channels' : 'No channels'}>
            {boxOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <span className={`io-board-state shrink-0 px-1.5 rounded text-xs font-semibold ${kind === 'ok' ? 'bg-emerald-900 text-emerald-200' : kind === 'bad' ? 'bg-rose-700 text-white' : kind === 'off' ? 'bg-slate-800 text-slate-500' : 'bg-slate-800 text-slate-400'}`} title={st ? stateText(st) : b.disabled ? 'Disabled in the project' : 'State not known'}>
            {b.disabled ? 'off' : kind === 'absent' ? '—' : st ? st.name : '?'}
          </span>
          <span className={`truncate ${kind === 'absent' ? 'text-slate-500' : 'text-slate-100'}`}>{b.name}</span>
          {b.hotConnect?.head && <span className={`io-board-hc-tag shrink-0 px-1.5 rounded text-[11px] ${kind === 'absent' ? 'bg-slate-800 text-slate-400' : 'border border-slate-700 text-slate-300'}`} title="A Hot Connect group: optional equipment, attached or not">{kind === 'absent' ? `Hot Connect ${b.hotConnect.group}: not attached` : `Hot Connect ${b.hotConnect.group}`}</span>}
          {vendor && vendor !== 'Beckhoff' && <span className="io-board-vendor shrink-0 px-1.5 rounded border border-slate-700 text-[11px] text-slate-300" title={`${b.info?.type ?? ''} ${b.info?.desc ?? ''}`.trim()}>{vendor}</span>}
          {kind === 'bad' && st && <span className="truncate text-xs text-rose-300">{stateText(st)}</span>}
          <button type="button" className={`io-board-props-btn shrink-0 p-0.5 rounded ${propsPath === b.path ? 'text-sky-300' : 'text-slate-500 hover:text-white'}`} onClick={() => onProps(b.path)} title="Its properties: pictures (front, back), the maker's page, the manual, its channels">
            <Info className="w-4 h-4" />
          </button>
        </div>
        {boxOpen && channels.length > 0 && (
          <ul className="io-board-channels" style={{ paddingLeft: `${depth * (narrow ? 0.8 : 1.2) + 2.2}rem` }}>
            {channels.map(({ e, pdo }) => {
              const on = !!e.link && signals.includes(machineKey(plc, e.link));
              return (
                <li key={e.path} className="io-board-channel flex items-center gap-2 py-0.5 text-sm" data-entry={e.path}>
                  {e.link ? (
                    <input type="checkbox" className="io-board-signal" checked={on} onChange={() => onSignal(e.link!)} title={on ? 'Remove it from the chart' : 'Chart it live'} />
                  ) : (
                    <span className="w-3.5" />
                  )}
                  <span className={`text-[10px] uppercase ${pdo.dir === 'out' ? 'text-amber-400' : 'text-sky-400'}`}>{pdo.dir}</span>
                  <span className="truncate text-slate-300" title={`${pdo.name} › ${e.name} (${e.type})`}>
                    {e.name}
                  </span>
                  {e.link && <span className="truncate font-mono text-xs text-slate-400">{e.link}</span>}
                  {e.link && recorded(e.link) && <CircleDot className="w-3 h-3 shrink-0 text-rose-400" aria-label="recorded" />}
                  {on && <span className="ml-auto font-mono text-xs text-white">{String(valueOf(e.link!) ?? '')}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {b.boxes.length > 0 && <ul>{b.boxes.map((c) => boxRow(c, depth + 1))}</ul>}
      </li>
    );
  };

  const matchList = filtering && view === 'network' ? [...keep.entries()].filter(([, k]) => k === 'all' || k.size).map(([p]) => p) : [];
  return (
    <div className="io-board-device mb-3 rounded border border-slate-800 bg-slate-900/40" data-device={device.name}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-slate-800">
        <button type="button" onClick={() => onOpen(`${dKey}|closed`, devOpen)} className="p-0.5 rounded text-slate-400 hover:text-white">
          {devOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <Cpu className="w-4 h-4 text-sky-400" />
        <span className="font-semibold">{device.name}</span>
        {device.netId && <span className="font-mono text-xs text-slate-500">{device.netId}</span>}
        {ecatError && <span className="text-xs text-amber-300">{ecatError}</span>}
        {filtering && <span className="io-board-matches text-xs text-sky-300">{matches} match{matches === 1 ? '' : 'es'}</span>}
        <span className="ml-auto flex items-center rounded border border-slate-700 overflow-hidden text-xs">
          <button type="button" onClick={() => onView('tree')} className={`io-board-view-tree flex items-center gap-1 px-2 py-0.5 ${view === 'tree' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
            <ListTree className="w-3.5 h-3.5" /> Tree
          </button>
          <button type="button" onClick={() => onView('network')} className={`io-board-view-network flex items-center gap-1 px-2 py-0.5 ${view === 'network' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
            <Network className="w-3.5 h-3.5" /> Network
          </button>
        </span>
      </div>
      {devOpen &&
        (view === 'tree' ? (
          <ul className="px-2 py-1">{device.boxes.map((b) => boxRow(b, 0))}</ul>
        ) : (
          <div className="p-2">
            {matchList.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {matchList.slice(0, 40).map((p) => (
                  <button key={p} type="button" onClick={() => onPick(p)} className={`io-board-match px-2 py-0.5 rounded-full border text-xs ${picked === p ? 'border-sky-400 bg-sky-900/60 text-white' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>
                    {p.split('^').pop()}
                  </button>
                ))}
              </div>
            )}
            <IoNetworkView device={device} states={states} stateNote={ecatError ?? null} valueOf={() => undefined} selected={propsPath ?? picked ?? matchList[0]} onSelectBox={onPick} onOpenProps={onProps} />
          </div>
        ))}
    </div>
  );
};
