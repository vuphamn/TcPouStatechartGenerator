import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bell, BellOff, BellRing, Check, CheckSquare, CircleDot, Cpu, Gauge, History, LayoutGrid, ListTree, Maximize2, Radio, Search, Square, Timer, Volume2, VolumeX, Wrench, X } from 'lucide-react';
import { BoardTree } from './BoardTree.tsx';
import { BoardFiltersMenu, type BoardSavedFilter, type FilterDraft } from './BoardFiltersMenu.tsx';
import { BoardRuleDialog, type BoardRule, type BoardRules, type RuleDraft, type RuleGroup } from './BoardRuleDialog.tsx';
import { BoardPlayback } from './BoardPlayback.tsx';
import { IoBoard } from './IoBoard.tsx';
import { DrivesBoard } from './DrivesBoard.tsx';
import { covers, machineKey, machineTree, type Health } from '../utils/boardTree.ts';
import { PLAYBACK_WINDOWS, stateAt, type PlaybackMachine, type RecordedValue } from '../utils/boardPlayback.ts';
import { canPlay, playAlert, unlockSound } from '../utils/boardSound.ts';
import { useMediaQuery } from '../hooks/useMediaQuery.ts';
import { GatewayConnection, detectGatewayOrigin, fetchGatewaySso, type GatewaySso } from '../utils/liveGateway.ts';
import { formatDuration } from '../utils/liveView.ts';
import { formatLimit, limitFor, useDefaultLimit, useLimitsOfTypes } from '../utils/stateLimits.ts';
import { useStoredSecret } from '../hooks/useStoredSecret.ts';

/**
 * Operator board (the web app at ?board, served by a gateway): a full-screen, read-only view for a screen by the
 * line. One tile per state machine of the gateway's PLCs (the gateway follows them, shared by every board): green
 * normal, amber stuck (longer in a state than its limit), red error; problems first. The alerts panel lists the
 * gateway's alerts; Acknowledge (with a note) tells the others who is on it (and posts to the rule's webhook).
 * URL: ?board[=<saved board id>][&plcs=line202,line237][&root=MAIN.mainStateMachine][&title=Line%20202][&stuck=300 (s)]
 * [&gateway=host:8443]. A saved board (the gateway's setup page) gives the PLCs, title, root and limit; the address
 * overrides them. Maintenance (per PLC): its alerts are muted until a time, with who and why.
 */

interface SavedBoard {
  id: string;
  title: string;
  plcs: string[];
  root: string;
  stuck: number | null;
}

interface Maintenance {
  until: string;
  by: string;
  note: string;
}

const MAINTENANCE_MINUTES = [30, 60, 120, 240, 480];

interface BoardMachine {
  path: string;
  type: string;
  value: number | null;
  state: string | null;
  since: number | null;
  error: boolean;
  limitMs: number | null;
  /** Already in this state when the gateway began watching: the time is at least this */
  atLeast?: boolean;
}

interface BoardPlc {
  id: string;
  name: string;
  state: string;
  message: string;
  /** Its PLC's ADS state (Run, Stop, Invalid: no program …); null while the gateway is not connected to it */
  plcState?: string | null;
  machines: BoardMachine[];
  maintenance?: Maintenance | null;
  /** Planned maintenance windows (not started yet) */
  planned?: (Maintenance & { id: string; from: string })[];
  /** The notes written live on this PLC (the Live tab's + Note, through this gateway), the last 24 h, newest first */
  notes?: { t: number; user: string; text: string; pou?: string }[];
}

export interface AlertEvent {
  id: string;
  event: 'stuck' | 'error' | 'recovered' | 'slower' | 'plcStopped' | 'drive';
  /** Muted when it happened (maintenance, quiet hours): kept to be seen, never open */
  muted?: string;
  plc: string;
  plcName: string;
  machine: string;
  state: string;
  text: string;
  at: string;
  ack: { by: string; at: string; note: string } | null;
  resolvedAt: string | null;
  escalatedAt?: string | null;
}

/** The gateway's recordings as the playback needs them (recordingsList) */
interface GwRecording {
  id: string;
  plc: string;
  machines: { path: string; type: string; stateNames?: Record<string, string> }[];
}

/** An error state, as the gateway's alerts find them by default */
const ERROR_STATE = /ERROR|FAULT|ALARM|E_?STOP|ABORT/i;
const PLAYBACK_MAX = 40;

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

const short = (path: string, root: string) => (path.toLowerCase().startsWith(root.toLowerCase() + '.') ? path.slice(root.length + 1) : path.toLowerCase() === root.toLowerCase() ? '(main)' : path);

export const OperatorBoard: React.FC = () => {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  // A saved board (?board=<id>), its settings overridden by the address
  // Kiosk: &cycle=<s> rotates through the saved boards (&boards=a,b: those), one after the other
  const cycleSec = Math.max(0, Number(params.get('cycle')) || 0);
  const [kioskIdx, setKioskIdx] = useState(0);
  const boardId = params.get('board') || '';
  const [saved, setSaved] = useState<SavedBoard[]>([]);
  const kioskList = useMemo(() => {
    if (!cycleSec) return [];
    const ids = (params.get('boards') ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    return ids.length ? ids.map((id) => saved.find((b) => b.id.toLowerCase() === id)).filter((b): b is SavedBoard => !!b) : saved;
  }, [cycleSec, saved, params]);
  const board = kioskList.length ? kioskList[kioskIdx % kioskList.length] : saved.find((b) => b.id.toLowerCase() === boardId.toLowerCase()) ?? null;
  const [boardsLoaded, setBoardsLoaded] = useState(!boardId && !cycleSec);
  useEffect(() => {
    if (kioskList.length < 2) return;
    const t = window.setInterval(() => setKioskIdx((i) => (i + 1) % kioskList.length), cycleSec * 1000);
    return () => window.clearInterval(t);
  }, [kioskList.length, cycleSec]);
  const wantedParam = (params.get('plcs') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const wanted = useMemo(() => (wantedParam.length ? wantedParam : board?.plcs ?? []), [wantedParam.join(), board]);
  const root = params.get('root') || board?.root || 'MAIN.mainStateMachine';
  const title = params.get('title') || board?.title || 'Machines';
  const stuckDefault = Number(params.get('stuck')) > 0 ? Number(params.get('stuck')) * 1000 : board?.stuck ? board.stuck * 1000 : null;
  // Maintenance form: which PLC, how long, why
  const [maintFor, setMaintFor] = useState<string | null>(null);
  const [maintMinutes, setMaintMinutes] = useState(60);
  const [maintNote, setMaintNote] = useState('');
  const [maintAt, setMaintAt] = useState(''); // (empty: now; a datetime-local: planned)
  // Shift report: which one, the answer
  const [report, setReport] = useState<{ which: string; text: string; csv: string } | null>(null);
  const [origin, setOrigin] = useState<string | null>(params.get('gateway'));
  const [sso, setSso] = useState<GatewaySso | null>(null);
  const [token, setToken, remember, setRemember] = useStoredSecret('kss.gateway.token');
  // A display (a TV by the line): &view=<a view-only token> from the gateway's setup page: the board only, no actions
  const viewToken = params.get('view') || '';
  const viewOnly = !!viewToken;
  const [tokenDraft, setTokenDraft] = useState('');
  const [status, setStatus] = useState<{ state: 'idle' | 'connecting' | 'connected' | 'error'; message: string }>({ state: 'idle', message: '' });
  const [plcs, setPlcs] = useState<BoardPlc[]>([]);
  const [offset, setOffset] = useState(0); // PC clock minus gateway clock
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [showAlerts, setShowAlerts] = useState(params.get('alerts') !== '0');
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [now, setNow] = useState(Date.now());
  const conn = useRef<GatewayConnection | null>(null);
  // The board's pages and views (this viewer's, kept in this browser; the address first): the machines or the I/O;
  // the machines as a tree (nested as in the program) or flat (tiles)
  const [page, setPageState] = useState<'machines' | 'io' | 'drives'>(() => {
    const p = params.get('page') || store.get('kss.board.page');
    return p === 'io' || p === 'drives' ? p : 'machines';
  });
  const setPage = (p: 'machines' | 'io' | 'drives') => {
    setPageState(p);
    store.set('kss.board.page', p);
  };
  const [layout, setLayoutState] = useState<'flat' | 'tree'>(() => (params.get('layout') === 'tree' || (!params.get('layout') && store.get('kss.board.layout') === 'tree') ? 'tree' : 'flat'));
  const setLayout = (l: 'flat' | 'tree') => {
    setLayoutState(l);
    store.set('kss.board.layout', l);
  };
  const collapsedKey = `kss.board.collapsed|${boardId || 'all'}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(store.get(collapsedKey) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const collapse = (keys: string[], closed: boolean) =>
    setCollapsed((s) => {
      const n = new Set(s);
      for (const k of keys) {
        if (closed) n.add(k);
        else n.delete(k);
      }
      store.set(collapsedKey, JSON.stringify([...n].slice(-2000)));
      return n;
    });
  // The gateway's saved filters and the one applied (the address's &saved= first), its recordings and alarms (which
  // machines and signals each covers), and whether this user may change them (boardEditors)
  const [savedFilters, setSavedFilters] = useState<BoardSavedFilter[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [rules, setRules] = useState<BoardRules>({ alarms: [], recordings: [] });
  const savedKey = `kss.board.saved|${boardId || 'all'}`;
  const [activeFilterId, setActiveFilterId] = useState(() => params.get('saved') ?? store.get(savedKey) ?? '');
  const activeFilter = savedFilters.find((f) => f.id === activeFilterId) ?? null;
  // Machines chosen (Select): for a recording, an alarm, a playback, a saved filter ("<plc>|<path>")
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelected = (k: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  // The I/O page's charted signals ("<plc>|<variable>"), kept in this browser
  const [signals, setSignalsState] = useState<string[]>(() => {
    try {
      const v = JSON.parse(store.get('kss.board.signals') ?? '[]');
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  const setSignals = (keys: string[]) => {
    setSignalsState(keys);
    store.set('kss.board.signals', JSON.stringify(keys));
  };
  const [ruleDialog, setRuleDialog] = useState<{ kind: 'alarm' | 'recording'; groups: RuleGroup[] } | null>(null);
  // The user's role on the gateway (roles.cjs): what it may do; roles off: everything
  const [perm, setPerm] = useState<{ role: string | null; label: string | null; can: string[]; on: boolean }>({ role: null, label: null, can: [], on: false });
  const may = (cap: string) => !viewOnly && (!perm.on || perm.can.includes(cap));
  const [startFilter, setStartFilter] = useState<string | null>(null);
  // (the I/O page's messages, handed to it)
  const ioListeners = useRef(new Set<(m: { type: string }) => void>());
  const subscribeIo = useCallback((fn: (m: never) => void) => {
    const f = fn as unknown as (m: { type: string }) => void;
    ioListeners.current.add(f);
    return () => {
      ioListeners.current.delete(f);
    };
  }, []);
  // Playback: the chosen machines' recorded states over a window, the board showing them at the cursor
  const [playback, setPlayback] = useState<{ from: number; to: number; t: number; playing: boolean; speed: number; machines: PlaybackMachine[]; loading: string } | null>(null);
  // New alerts: a chime (unless off) and the machine's tile flashing until the alert is acknowledged or resolved
  const [sound, setSoundState] = useState(() => {
    if (params.get('sound') === '0') return false;
    try {
      return localStorage.getItem('kss.board.sound') !== '0';
    } catch {
      return true;
    }
  });
  const setSound = (on: boolean) => {
    setSoundState(on);
    try {
      localStorage.setItem('kss.board.sound', on ? '1' : '0');
    } catch {
      // per-viewer convenience only
    }
  };
  const [soundReady, setSoundReady] = useState(false);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  // (the alerts known when the board loaded: not announced; later ones are)
  const knownRef = useRef<Map<string, AlertEvent> | null>(null);
  const [flashing, setFlashing] = useState<Record<string, number>>({}); // machine path (lower case) -> until
  // Phones: the machines or the alerts, one at a time
  const narrow = useMediaQuery('(max-width: 760px)');
  const [phoneView, setPhoneView] = useState<'machines' | 'alerts'>('machines');
  useEffect(() => {
    // Browsers play sound only after a click or tap on the page
    const unlock = () => void unlockSound().then(setSoundReady);
    void unlockSound().then(setSoundReady);
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  const announce = (e: AlertEvent) => {
    const known = knownRef.current;
    if (!known) return;
    const was = known.get(e.id);
    known.set(e.id, e);
    const isNew = !was && e.event !== 'recovered' && !e.ack && !e.resolvedAt;
    const escalated = !!was && !was.escalatedAt && !!e.escalatedAt && !e.ack;
    if (!isNew && !escalated) return;
    setFlashing((f) => ({ ...f, [e.machine.toLowerCase()]: Date.now() + 60000 }));
    if (soundRef.current && canPlay()) playAlert(escalated ? 'escalated' : e.event === 'plcStopped' ? 'plc' : e.event === 'error' ? 'error' : 'stuck');
  };

  useEffect(() => {
    document.title = `${title} · Kval MachineScope`;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [title]);
  useEffect(() => {
    if (origin) return;
    void detectGatewayOrigin().then((o) => (o ? setOrigin(o) : setStatus({ state: 'error', message: 'This page is not served by a Kval MachineScope gateway: add &gateway=<host:port> to the address' })));
  }, [origin]);
  useEffect(() => {
    if (origin) void fetchGatewaySso(origin).then(setSso);
  }, [origin]);

  const connect = useCallback(() => {
    if (!origin) return;
    const useSso = !viewOnly && !!sso?.user;
    const useToken = viewToken || token;
    if (!useSso && !useToken) {
      setStatus({ state: 'idle', message: '' });
      return;
    }
    conn.current?.close();
    const c = new GatewayConnection((m) => {
      const msg = m as unknown as { type: string; now?: number; plcs?: BoardPlc[]; events?: AlertEvent[]; event?: AlertEvent; message?: string; boards?: SavedBoard[] };
      if (msg.type.startsWith('io') || msg.type === 'drivesState') {
        for (const fn of ioListeners.current) fn(msg);
        return;
      }
      if (msg.type === 'boardFilters') {
        const x = m as unknown as { filters?: BoardSavedFilter[]; canEdit?: boolean; startFilter?: string | null };
        setSavedFilters(x.filters ?? []);
        setCanEdit(!!x.canEdit);
        setStartFilter(x.startFilter ?? null);
        return;
      }
      if (msg.type === 'boardRules') {
        const x = m as unknown as BoardRules & { canEdit?: boolean };
        setRules({ alarms: x.alarms ?? [], recordings: x.recordings ?? [] });
        setCanEdit(!!x.canEdit);
        return;
      }
      if (msg.type === 'boardList' && msg.boards) {
        setSaved(msg.boards);
        setBoardsLoaded(true);
      } else if (msg.type === 'boardState' && msg.plcs) {
        setPlcs(msg.plcs);
        if (msg.now) setOffset(Date.now() - msg.now);
      } else if (msg.type === 'alertsList' && msg.events) {
        setAlerts(msg.events);
        knownRef.current ??= new Map(msg.events.map((e) => [e.id, e]));
      } else if (msg.type === 'alertEvent' && msg.event) {
        const e = msg.event;
        announce(e);
        setAlerts((prev) => [e, ...prev.filter((x) => x.id !== e.id)].sort((a, b) => b.at.localeCompare(a.at)));
      } else if (msg.type === 'closed') {
        setStatus({ state: 'error', message: 'The connection to the gateway was closed: connecting again...' });
        window.setTimeout(() => connectRef.current(), 5000);
      }
    });
    conn.current = c;
    setStatus({ state: 'connecting', message: 'Connecting to the gateway...' });
    c.connect(origin, useToken, useSso)
      .then((w) => {
        const { user } = w;
        const r = w as unknown as { role?: string | null; roleLabel?: string | null; can?: string[]; rolesOn?: boolean };
        setPerm({ role: r.role ?? null, label: r.roleLabel ?? null, can: r.can ?? [], on: !!r.rolesOn });
        setStatus({ state: 'connected', message: viewOnly ? `View only (${user})` : `Signed in as ${user}` });
        c.send({ type: 'boardList' });
        c.send({ type: 'alertsList' });
      })
      .catch((err: Error) => {
        setStatus({ state: 'error', message: err.message });
        // A wall screen: keep trying while the gateway or the network is away
        if (!/not accepted|denied|Sign in/i.test(err.message)) window.setTimeout(() => connectRef.current(), 10000);
      });
  }, [origin, sso, token, viewToken]);
  const connectRef = useRef(connect);
  connectRef.current = connect;
  useEffect(() => {
    connect();
    return () => conn.current?.close();
  }, [connect]);
  // The machines to watch: once the saved boards are known (their PLCs and root), and again when they change
  const watchKey = status.state === 'connected' && boardsLoaded ? `${wanted.join(',')}|${root}` : '';
  useEffect(() => {
    if (watchKey) conn.current?.send({ type: 'boardWatch', plcs: wanted, root });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey]);

  const setMaintenance = async (plc: string, minutesFor: number, why: string, at?: string, id?: string) => {
    try {
      const from = at ? new Date(at).getTime() : undefined;
      await conn.current?.request({ type: 'maintenanceSet', plc, minutes: minutesFor, note: why, ...(from ? { from } : {}), ...(id ? { id } : {}) }, 'maintenanceResult');
    } catch {
      // the board shows the state it gets
    }
    setMaintFor(null);
    setMaintNote('');
    setMaintAt('');
  };
  const showReport = async (which: string) => {
    try {
      const r = await conn.current?.request<{ summary?: { text: string }; csv?: string; error?: string }>({ type: 'report', which }, 'reportResult');
      if (r?.error || !r?.summary) throw new Error(r?.error || 'No answer');
      setReport({ which, text: r.summary.text, csv: r.csv ?? '' });
    } catch (err) {
      setReport({ which, text: err instanceof Error ? err.message : String(err), csv: '' });
    }
  };
  const downloadReport = () => {
    if (!report?.csv) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([report.csv], { type: 'text/csv' }));
    a.download = `report-${report.which}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  // Limits: the gateway's (its alert rules), else this viewer's per POU type (as the Machine Overview), else &stuck=
  const types = useMemo(() => plcs.flatMap((p) => p.machines.map((m) => m.type.split('.').pop() ?? m.type)), [plcs]);
  const typeLimits = useLimitsOfTypes(types);
  const viewerDefault = useDefaultLimit();
  // (playing back: each machine as recorded at the cursor; one not in the playback: no state shown)
  const played = useMemo(() => new Map((playback?.machines ?? []).map((pm) => [machineKey(pm.plc, pm.path).toLowerCase(), pm])), [playback?.machines]);
  const tiles = useMemo(
    () =>
      plcs.map((p) => ({
        ...p,
        machines: p.machines
          .map((m0) => {
            let m: BoardMachine & { played?: boolean } = m0;
            let at = now - offset;
            if (playback) {
              at = playback.t;
              const pm = played.get(machineKey(p.id, m0.path).toLowerCase());
              const st = pm ? stateAt(pm, playback.t) : null;
              m = st ? { ...m0, value: st.value, state: st.name, since: st.since, error: ERROR_STATE.test(st.name), atLeast: false, played: true } : { ...m0, value: null, state: null, since: null, error: false, played: false };
            }
            const type = (m.type.split('.').pop() ?? m.type).toLowerCase();
            const limit = m.limitMs ?? limitFor(typeLimits[type] ?? {}, viewerDefault ?? stuckDefault, m.state);
            const inState = m.since ? Math.max(0, at - m.since) : 0;
            const stuck = !m.error && !!limit && inState > limit;
            return { ...m, limit, inState, stuck, rank: m.error ? 0 : stuck ? 1 : m.state ? 2 : 3 };
          })
          .sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path)),
      })),
    [plcs, typeLimits, viewerDefault, stuckDefault, now, offset, playback, played]
  );
  const counts = tiles.flatMap((p) => p.machines).reduce((c, m) => ({ all: c.all + 1, error: c.error + (m.error ? 1 : 0), stuck: c.stuck + (m.stuck ? 1 : 0) }), { all: 0, error: 0, stuck: 0 });
  // The filter: the machines whose path, state, type or PLC has every word typed (lockhead axis); problems only: the
  // ones in error or stuck. From the address (&filter=, &problems=1: a wall screen's own), else this viewer's last
  const filterKey = `kss.board.filter|${boardId || params.get('plcs') || 'all'}`;
  const [filter, setFilterState] = useState(() => {
    if (params.has('filter')) return params.get('filter') ?? '';
    try {
      return localStorage.getItem(filterKey) ?? '';
    } catch {
      return '';
    }
  });
  const setFilter = (v: string) => {
    setFilterState(v);
    try {
      localStorage.setItem(filterKey, v);
    } catch {
      // (this viewer only, this time)
    }
  };
  const [problemsOnly, setProblemsOnly] = useState(() => params.get('problems') === '1');
  const filterRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    // ("/" goes to the filter, as in many tools)
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || e.ctrlKey || e.altKey || e.metaKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      filterRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  // (a saved filter applied: its PLCs and its machines only)
  const onlyPlcs = activeFilter?.plcs.length ? activeFilter.plcs : null;
  const onlyMachines = activeFilter?.machines.length ? new Set(activeFilter.machines.map((k) => k.toLowerCase())) : null;
  const filtering = words.length > 0 || problemsOnly || !!onlyPlcs || !!onlyMachines;
  const shown = filtering
    ? tiles
        .filter((p) => !onlyPlcs || onlyPlcs.includes(p.id))
        .map((p) => ({ ...p, machines: p.machines.filter((m) => (!onlyMachines || onlyMachines.has(machineKey(p.id, m.path).toLowerCase())) && (!problemsOnly || m.error || m.stuck) && words.every((w) => `${p.name} ${m.path} ${m.state ?? ''} ${m.type}`.toLowerCase().includes(w))) }))
        .filter((p) => p.machines.length || (!words.length && !problemsOnly && !onlyMachines))
    : tiles;
  // Saved filters: one applied (its view: words, problems only, tree or flat, page, alerts, signals; its PLCs and
  // machines), or none (the whole board)
  const applyFilter = (f: BoardSavedFilter | null) => {
    setActiveFilterId(f?.id ?? '');
    store.set(savedKey, f?.id ?? '');
    if (!f) {
      if (activeFilter && filter === activeFilter.text) setFilter('');
      return;
    }
    setFilter(f.text);
    setProblemsOnly(f.problemsOnly);
    setLayout(f.layout);
    setPage(f.page);
    setShowAlerts(f.alerts);
    if (f.signals.length) setSignals(f.signals);
  };
  // (the address's or the last one: applied once the gateway lists them; gone: forgotten)
  const appliedRef = useRef('');
  useEffect(() => {
    if (!startFilter || activeFilterId || params.get('saved') || params.has('filter') || params.get('page') || store.get(savedKey) !== null) return;
    setActiveFilterId(startFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startFilter]);
  useEffect(() => {
    if (!activeFilterId || appliedRef.current === activeFilterId || !savedFilters.length) return;
    appliedRef.current = activeFilterId;
    const f = savedFilters.find((x) => x.id === activeFilterId);
    if (f) applyFilter(f);
    else setActiveFilterId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilterId, savedFilters]);
  const saveFilter = async (d: FilterDraft): Promise<string | null> => {
    const old = d.id ? savedFilters.find((f) => f.id === d.id) : null;
    const f = {
      ...(d.id ? { id: d.id } : {}),
      name: d.name,
      audience: d.audience,
      note: d.note,
      text: filter,
      problemsOnly,
      layout,
      page,
      alerts: showAlerts,
      signals,
      plcs: d.withPlcs ? shown.map((p) => p.id) : [],
      machines: d.withMachines ? (selected.size ? [...selected] : old?.machines ?? []) : [],
    };
    try {
      const r = await conn.current?.request<{ ok: boolean; error?: string; filter?: BoardSavedFilter }>({ type: 'boardFilterSave', filter: f }, 'boardFilterResult');
      if (!r?.ok) return r?.error ?? 'Not saved';
      if (r.filter) {
        appliedRef.current = r.filter.id;
        setActiveFilterId(r.filter.id);
        store.set(savedKey, r.filter.id);
      }
      setSelecting(false);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };
  const deleteFilter = async (f: BoardSavedFilter): Promise<string | null> => {
    try {
      const r = await conn.current?.request<{ ok: boolean; error?: string }>({ type: 'boardFilterDelete', id: f.id }, 'boardFilterResult');
      if (!r?.ok) return r?.error ?? 'Not deleted';
      if (activeFilterId === f.id) applyFilter(null);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };
  const filterLink = (f: BoardSavedFilter) => {
    const u = new URL(window.location.href);
    u.searchParams.set('saved', f.id);
    for (const k of ['filter', 'problems', 'layout', 'page']) u.searchParams.delete(k);
    return u.toString();
  };
  // Recordings and alarms: which cover a machine; the chosen machines by PLC; saved, removed
  const recordedBy = (plc: string, path: string) => rules.recordings.filter((r) => covers(r, plc, path));
  const alarmedBy = (plc: string, path: string) => rules.alarms.filter((r) => covers(r, plc, path));
  const plcName = (id: string) => plcs.find((p) => p.id === id)?.name ?? id;
  const groupsOf = (keys: string[]): RuleGroup[] => {
    const by = new Map<string, string[]>();
    for (const k of keys) {
      const [plc, p] = k.split('|');
      by.set(plc, [...(by.get(plc) ?? []), p]);
    }
    return [...by].map(([plc, machines]) => ({ plc, plcName: plcName(plc), machines, signals: [] }));
  };
  const existingFor = (kind: 'alarm' | 'recording', groups: RuleGroup[]): BoardRule[] =>
    (kind === 'alarm' ? rules.alarms : rules.recordings).filter((r) => groups.some((g) => g.machines.some((p) => covers(r, g.plc, p)) || g.signals.some((s) => r.plc === g.plc && (r.vars ?? []).some((v) => v.toLowerCase() === s.toLowerCase()))));
  const saveRules = async (kind: 'alarm' | 'recording', drafts: RuleDraft[]): Promise<string | null> => {
    for (const d of drafts) {
      try {
        const r = await conn.current?.request<{ ok: boolean; error?: string }>({ type: 'boardRuleSave', kind, rule: { ...d, root } }, 'boardRuleResult', 20000);
        if (!r?.ok) return r?.error ?? 'Not saved';
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    }
    setSelecting(false);
    setSelected(new Set());
    return null;
  };
  const deleteRule = async (kind: 'alarm' | 'recording', r: BoardRule): Promise<string | null> => {
    try {
      const res = await conn.current?.request<{ ok: boolean; error?: string }>({ type: 'boardRuleDelete', kind, id: r.id }, 'boardRuleResult', 20000);
      return res?.ok ? null : res?.error ?? 'Not removed';
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };
  // Playback: the chosen machines (else the ones shown, the first 40) from the gateway's recordings, over a window
  const startPlayback = async (ms: number) => {
    const keys = selected.size ? [...selected] : shown.flatMap((p) => p.machines.map((m) => machineKey(p.id, m.path)));
    const to = Date.now();
    const from = to - ms;
    const wanted = keys.slice(0, PLAYBACK_MAX);
    // (Select ends: what was chosen is played back, the next Select starts afresh)
    setSelected(new Set());
    setPlayback({ from, to, t: from, playing: false, speed: 60, machines: [], loading: `Reading ${wanted.length} machine${wanted.length === 1 ? '' : 's'} from the gateway's recordings…${keys.length > PLAYBACK_MAX ? ` (the first ${PLAYBACK_MAX} of ${keys.length})` : ''}` });
    setSelecting(false);
    let recs: GwRecording[] = [];
    try {
      recs = (await conn.current?.request<{ recordings?: GwRecording[] }>({ type: 'recordingsList' }, 'recordingsList', 20000))?.recordings ?? [];
    } catch {
      recs = [];
    }
    const out: PlaybackMachine[] = [];
    for (const k of wanted) {
      const [plc, path] = k.split('|');
      const rec = recs.find((r) => r.plc === plc && r.machines.some((m) => m.path.toLowerCase() === path.toLowerCase()));
      const names = rec?.machines.find((m) => m.path.toLowerCase() === path.toLowerCase())?.stateNames ?? {};
      if (!rec) {
        out.push({ plc, path, recording: '', stateNames: {}, values: [], error: 'Not recorded: choose it and Record… first' });
        continue;
      }
      try {
        const r = await conn.current?.request<{ values?: RecordedValue[]; error?: string }>({ type: 'recordingQuery', id: rec.id, machine: path, from, to }, 'recordingData', 60000);
        out.push({ plc, path, recording: rec.id, stateNames: names, values: r?.values ?? [], ...(r?.error ? { error: r.error } : !r?.values?.length ? { error: 'Nothing recorded in this window' } : {}) });
      } catch (e) {
        out.push({ plc, path, recording: rec.id, stateNames: names, values: [], error: e instanceof Error ? e.message : String(e) });
      }
      setPlayback((pb) => (pb ? { ...pb, machines: [...out] } : pb));
    }
    setPlayback((pb) => (pb ? { ...pb, machines: out, loading: out.every((x) => x.error) ? 'None of them has recorded states in this window.' : '' } : pb));
  };
  useEffect(() => {
    if (!playback?.playing) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const n = performance.now();
      const dt = n - last;
      last = n;
      setPlayback((pb) => {
        if (!pb || !pb.playing) return pb;
        const t = Math.min(pb.to, pb.t + dt * pb.speed);
        return { ...pb, t, playing: t < pb.to };
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [playback?.playing]);
  const shownCount = shown.reduce((n, p) => n + p.machines.length, 0);
  const open = alerts.filter((a) => a.event !== 'recovered' && !a.ack && !a.resolvedAt);
  const openMachines = new Set(open.map((a) => a.machine.toLowerCase()));
  const flashOn = (path: string) => openMachines.has(path.toLowerCase()) && (flashing[path.toLowerCase()] ?? 0) > now;
  // A tile opens the machine's diagram, live on it, in a new tab (the app loads its POU: a sample of that type, or asks)
  const watchUrl = (p: BoardPlc, m: BoardMachine) => {
    const q = new URLSearchParams({ watch: m.type.split('.').pop() ?? m.type, instance: m.path, plc: p.id });
    if (params.get('gateway')) q.set('gateway', params.get('gateway')!);
    return `${window.location.pathname}?${q.toString()}`;
  };

  const acknowledge = async (a: AlertEvent) => {
    try {
      await conn.current?.request({ type: 'alertAck', id: a.id, note }, 'alertAckResult');
    } catch {
      // the list shows it when the gateway answers
    }
    setNoteFor(null);
    setNote('');
  };

  const needsSignIn = status.state !== 'connected' && !sso?.user && !token && !viewOnly;
  // A machine as a tile (flat) or a row (tree): coloured by its kind; Select: a click chooses it, else opens its
  // diagram live; its recordings and alarms as icons; playing back: one not recorded is dimmed
  type Shown = (typeof tiles)[number];
  type Tile = Shown['machines'][number];
  const healthOf = (m: Tile): Health => (m.error ? 'error' : m.stuck ? 'stuck' : m.state ? 'ok' : 'unknown');
  const colours = (m: Tile) => (m.error ? 'bg-rose-800 border-rose-500' : m.stuck ? 'bg-amber-500 border-amber-300 text-slate-950' : m.state ? 'bg-emerald-950 border-emerald-800' : 'bg-slate-900 border-slate-800 text-slate-400');
  const linkProps = (p: Shown, m: Tile) => {
    const k = machineKey(p.id, m.path);
    if (selecting) return { role: 'checkbox', 'aria-checked': selected.has(k), onClick: (e: React.MouseEvent) => { e.preventDefault(); toggleSelected(k); }, title: `${m.path} (${m.type}): click to choose it` };
    return { href: viewOnly ? undefined : watchUrl(p, m), target: '_blank', rel: 'noreferrer', title: viewOnly ? `${m.path} (${m.type})` : `${m.path} (${m.type}): open its diagram, live` };
  };
  const marks = (p: Shown, m: Tile) => {
    const rec = recordedBy(p.id, m.path);
    const al = alarmedBy(p.id, m.path);
    return (
      <>
        {rec.length > 0 && (
          <span className="board-recorded" title={`Recorded: ${rec.map((r) => r.name).join(', ')}`}>
            <CircleDot className="w-3.5 h-3.5 text-rose-300" />
          </span>
        )}
        {al.length > 0 && (
          <span className="board-alarmed" title={`Alarms: ${al.map((r) => r.name).join(', ')}`}>
            <BellRing className="w-3.5 h-3.5 text-amber-300" />
          </span>
        )}
      </>
    );
  };
  // (a PLC's closed branches: their keys without its id)
  const collapsedOf = (plc: string) => new Set([...collapsed].filter((k) => k.startsWith(plc + '|')).map((k) => k.slice(plc.length + 1)));
  const chosenMark = (p: Shown, m: Tile) => (selecting ? selected.has(machineKey(p.id, m.path)) ? <CheckSquare className="w-4 h-4 shrink-0 text-violet-200" /> : <Square className="w-4 h-4 shrink-0 opacity-60" /> : null);
  const tileOf = (p: Shown, m: Tile) => {
    const sel = selecting && selected.has(machineKey(p.id, m.path));
    return (
      <a
        key={m.path}
        {...linkProps(p, m)}
        className={`board-tile block rounded-lg border-2 ${viewOnly && !selecting ? '' : 'cursor-pointer hover:brightness-125'} ${narrow ? 'px-2.5 py-2' : 'px-4 py-3'} ${flashOn(m.path) ? 'board-tile-flash' : ''} ${colours(m)} ${sel ? 'ring-4 ring-violet-400' : ''} ${playback && m.played === false ? 'opacity-40' : ''}`}
        data-path={m.path}
        data-kind={healthOf(m) === 'ok' ? 'ok' : healthOf(m)}
        data-chosen={sel ? 'true' : undefined}
      >
        <div className={`flex items-center gap-1 ${narrow ? 'text-xs' : 'text-sm'} opacity-80`}>
          {chosenMark(p, m)}
          <span className="truncate">{short(m.path, root)}</span>
          <span className="ml-auto flex items-center gap-1 shrink-0">{marks(p, m)}</span>
        </div>
        <div className={`board-state ${narrow ? 'text-sm' : 'text-lg'} font-bold leading-tight break-words`}>{m.state ?? (playback ? '—' : '...')}</div>
        <div className="flex items-center gap-2 text-sm font-mono opacity-90">
          {m.since ? `${m.atLeast ? '≥ ' : ''}${formatDuration(m.inState)}` : ''}
          {m.stuck && m.limit ? <span>/ {formatLimit(m.limit)}</span> : null}
          {m.error ? <AlertTriangle className="w-4 h-4 ml-auto" /> : m.stuck ? <Timer className="w-4 h-4 ml-auto" /> : null}
        </div>
      </a>
    );
  };
  const rowOf = (p: Shown, m: Tile, label: string) => {
    const sel = selecting && selected.has(machineKey(p.id, m.path));
    return (
      <a
        {...linkProps(p, m)}
        className={`board-row flex items-center gap-2 rounded border px-2 py-1 ${viewOnly && !selecting ? '' : 'cursor-pointer hover:brightness-125'} ${flashOn(m.path) ? 'board-tile-flash' : ''} ${colours(m)} ${sel ? 'ring-2 ring-violet-400' : ''} ${playback && m.played === false ? 'opacity-40' : ''}`}
        data-path={m.path}
        data-kind={healthOf(m)}
        data-chosen={sel ? 'true' : undefined}
      >
        {chosenMark(p, m)}
        <span className={`font-mono ${narrow ? 'text-xs' : 'text-sm'} truncate max-w-[45%]`}>{label}</span>
        <span className={`board-state font-semibold ${narrow ? 'text-sm' : ''} truncate`}>{m.state ?? (playback ? '—' : '...')}</span>
        <span className="ml-auto flex items-center gap-2 shrink-0 text-xs font-mono opacity-90">
          {marks(p, m)}
          {m.since ? `${m.atLeast ? '≥ ' : ''}${formatDuration(m.inState)}` : ''}
          {m.stuck && m.limit ? <span>/ {formatLimit(m.limit)}</span> : null}
          {m.error ? <AlertTriangle className="w-4 h-4" /> : m.stuck ? <Timer className="w-4 h-4" /> : null}
        </span>
      </a>
    );
  };
  return (
    <div id="operator-board" className="fixed inset-0 flex flex-col bg-slate-950 text-slate-100 select-none">
      <header className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-800 bg-slate-900 ${narrow ? 'px-3 py-2' : 'px-5 py-3'} ${open.length && Object.values(flashing).some((t) => t > now) ? 'board-header-flash' : ''}`}>
        <Radio className={`${narrow ? 'w-5 h-5' : 'w-6 h-6'} text-sky-400`} />
        <h1 id="board-title" className={`${narrow ? 'text-lg' : 'text-2xl'} font-semibold tracking-wide`}>{title}</h1>
        <span id="board-counts" className={`flex items-center gap-3 ${narrow ? 'text-sm' : 'text-lg'}`}>
          <span id="board-machine-count" className="text-slate-400">{filtering ? `${shownCount} of ${counts.all} machines` : `${counts.all} machines`}</span>
          {counts.error > 0 && (
            <span className="flex items-center gap-1 px-2.5 rounded-full bg-rose-700 text-white">
              <AlertTriangle className="w-4 h-4" /> {counts.error} in error
            </span>
          )}
          {open.some((a) => a.escalatedAt) && (
            <span id="board-escalated-count" className="flex items-center gap-1 px-2.5 rounded-full bg-fuchsia-700 text-white" title="Alerts nobody acknowledged in time">
              ⏰ {open.filter((a) => a.escalatedAt).length} escalated
            </span>
          )}
          {counts.stuck > 0 && (
            <span className="flex items-center gap-1 px-2.5 rounded-full bg-amber-500 text-slate-950">
              <Timer className="w-4 h-4" /> {counts.stuck} stuck
            </span>
          )}
        </span>
        {/* (the page: the machines or the I/O) */}
        <span id="board-pages" className="flex items-center rounded border border-slate-700 overflow-hidden text-sm">
          <button id="board-page-machines" type="button" onClick={() => setPage('machines')} className={`flex items-center gap-1 px-2 py-1 ${page === 'machines' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`} aria-pressed={page === 'machines'} title="The state machines">
            <LayoutGrid className="w-4 h-4" /> Machines
          </button>
          <button id="board-page-io" type="button" onClick={() => setPage('io')} className={`flex items-center gap-1 px-2 py-1 ${page === 'io' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`} aria-pressed={page === 'io'} title="The I/O devices, their states, and signals charted live">
            <Cpu className="w-4 h-4" /> I/O
          </button>
          <button id="board-page-drives" type="button" onClick={() => setPage('drives')} className={`flex items-center gap-1 px-2 py-1 ${page === 'drives' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`} aria-pressed={page === 'drives'} title="The drives' health: read from each drive, judged against its limits, its own past and its siblings">
            <Gauge className="w-4 h-4" /> Drives
          </button>
        </span>
        <span className={`flex items-center gap-2 ${page !== 'machines' ? 'hidden' : ''}`}>
          <span className="relative flex items-center">
            <Search className="absolute left-2 w-4 h-4 text-slate-500 pointer-events-none" />
            <input
              id="board-filter"
              ref={filterRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setFilter('');
                  e.currentTarget.blur();
                }
              }}
              placeholder="Filter machines… ( / )"
              title="The machines whose path, state, type or PLC has every word typed, e.g. lockhead axis. Esc clears it"
              className={`${narrow ? 'w-40' : 'w-72'} pl-7 pr-7 py-1 rounded bg-slate-950 border border-slate-700 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-600 select-text`}
            />
            {filter && (
              <button id="board-filter-clear" type="button" onClick={() => setFilter('')} className="absolute right-1.5 p-0.5 rounded text-slate-400 hover:text-white" title="Clear the filter">
                <X className="w-4 h-4" />
              </button>
            )}
          </span>
          <button
            id="board-problems-only"
            type="button"
            onClick={() => setProblemsOnly((v) => !v)}
            className={`px-2 py-1 rounded border text-sm ${problemsOnly ? 'border-amber-500 bg-amber-500/20 text-amber-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
            title="Only the machines in error or stuck"
            aria-pressed={problemsOnly}
          >
            Problems only
          </button>
          <button id="board-layout" type="button" onClick={() => setLayout(layout === 'tree' ? 'flat' : 'tree')} className={`flex items-center gap-1 px-2 py-1 rounded border text-sm ${layout === 'tree' ? 'border-sky-600 bg-sky-900/40 text-sky-100' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`} title={layout === 'tree' ? 'Tree: nested as in the program (click: flat tiles)' : 'Flat tiles (click: a tree, nested as in the program)'} aria-pressed={layout === 'tree'}>
            {layout === 'tree' ? <ListTree className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
            {layout === 'tree' ? 'Tree' : 'Flat'}
          </button>
        </span>
        {status.state === 'connected' && (
          <BoardFiltersMenu filters={savedFilters} active={activeFilter} canEdit={canEdit} narrow={narrow} selectedCount={selected.size} shownPlcs={shown.length} onApply={applyFilter} onSave={saveFilter} onDelete={deleteFilter} linkOf={filterLink} />
        )}
        {status.state === 'connected' && !viewOnly && page === 'machines' && (
          <>
            <button
              id="board-select"
              type="button"
              onClick={() => {
                setSelecting((v) => !v);
                setSelected(new Set());
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded border text-sm ${selecting ? 'border-violet-500 bg-violet-900/50 text-violet-100' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
              title="Choose machines: record them, alarm on them, play them back, or save them as a filter"
              aria-pressed={selecting}
            >
              <CheckSquare className="w-4 h-4" /> Select
            </button>
            <select
              id="board-playback-start"
              value=""
              onChange={(e) => e.target.value && void startPlayback(Number(e.target.value))}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-300"
              title="Play back the chosen machines (else the ones shown) from the gateway's recordings"
            >
              <option value="">{playback ? 'Play back again…' : 'Play back…'}</option>
              {PLAYBACK_WINDOWS.map((w) => (
                <option key={w.ms} value={w.ms}>
                  {w.label}
                </option>
              ))}
            </select>
          </>
        )}
        {!narrow && (
          <span className="ml-auto text-sm text-slate-400" id="board-status" title={status.message}>
            {status.state === 'connected' ? status.message : status.message || ''}
          </span>
        )}
        <button
          id="board-sound"
          onClick={() => {
            setSound(!sound);
            void unlockSound().then(setSoundReady);
          }}
          className={`${narrow ? 'ml-auto' : ''} flex items-center gap-1 p-2 rounded hover:bg-slate-800 text-sm`}
          title={sound ? 'Sound on for new alerts (click: off)' : 'Sound off (click: on)'}
          aria-pressed={sound}
        >
          {sound ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5 text-slate-500" />}
          {sound && !soundReady && <span id="board-sound-hint" className="text-xs text-amber-300">tap once to enable sound</span>}
        </button>
        {saved.length > 0 && (
          <select
            id="board-switch"
            value={board?.id ?? ''}
            onChange={(e) => {
              const u = new URL(window.location.href);
              u.search = e.target.value ? `?board=${encodeURIComponent(e.target.value)}` : '?board';
              window.location.href = u.toString();
            }}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200"
            title="Saved boards"
          >
            <option value="">All PLCs</option>
            {saved.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        )}
        {!narrow && <span className="font-mono text-xl text-slate-300">{new Date(now).toLocaleTimeString()}</span>}
        {kioskList.length > 1 && (
          <span id="board-kiosk" className="text-sm text-slate-400" title={`Rotating every ${cycleSec} s`}>
            {(kioskIdx % kioskList.length) + 1} / {kioskList.length}
          </span>
        )}
        {perm.on && perm.label && !viewOnly && (
          <span id="board-role" className="px-2 py-0.5 rounded-full border border-sky-800 text-xs text-sky-200" title={`Your role on this gateway: ${perm.label}`}>
            {perm.label}
          </span>
        )}
        {viewOnly && (
          <span id="board-view-only" className="px-2 py-0.5 rounded-full border border-slate-600 text-xs text-slate-400" title="A display: this board only, nothing can be done from it (a view-only token)">
            view only
          </span>
        )}
        {status.state === 'connected' && may('reports') && (
          <select
            id="board-report"
            value=""
            onChange={(e) => e.target.value && void showReport(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-300"
            title="Shift report: the alerts, time to acknowledge and resolve, the machines with the most"
          >
            <option value="">Report...</option>
            <option value="last">the last shift</option>
            <option value="today">today</option>
            <option value="yesterday">yesterday</option>
          </select>
        )}
        <button id="board-alerts-toggle" onClick={() => setShowAlerts((s) => !s)} className="relative p-2 rounded hover:bg-slate-800" title="Alerts">
          {showAlerts ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
          {open.length > 0 && <span className="absolute -top-1 -right-1 min-w-[1.25rem] px-1 rounded-full bg-rose-600 text-xs font-bold">{open.length}</span>}
        </button>
        <button onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)} className="p-2 rounded hover:bg-slate-800" title="Full screen">
          <Maximize2 className="w-5 h-5" />
        </button>
      </header>

      {report && (
        <div id="board-report-panel" className="flex flex-wrap items-center gap-3 px-5 py-2 border-b border-sky-900 bg-sky-950/60 text-sm">
          <span className="flex-1 min-w-[16rem]">{report.text}</span>
          {report.csv && (
            <button id="board-report-csv" onClick={downloadReport} className="px-3 py-1 rounded bg-sky-700 hover:bg-sky-600">
              Download CSV
            </button>
          )}
          <button onClick={() => setReport(null)} className="px-2 py-1 rounded hover:bg-slate-800" title="Close">
            ×
          </button>
        </div>
      )}
      {needsSignIn ? (
        <div id="board-signin" className="flex-1 flex flex-col items-center justify-center gap-4 text-lg">
          <p className="text-slate-300">Sign in to the gateway to show its machines.</p>
          {sso?.sso && (
            <button id="board-sso" onClick={() => (window.location.href = `/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`)} className="px-5 py-2 rounded bg-sky-700 hover:bg-sky-600">
              Sign in with {sso.provider}
            </button>
          )}
          {(!sso || sso.tokens) && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setRemember(true);
                setToken(tokenDraft.trim());
              }}
            >
              <input id="board-token" type="password" value={tokenDraft} onChange={(e) => setTokenDraft(e.target.value)} placeholder="access token" className="w-80 bg-slate-900 border border-slate-700 rounded px-3 py-1.5" />
              <button className="px-4 py-1.5 rounded bg-slate-700 hover:bg-slate-600">Show</button>
            </form>
          )}
          {remember && token && <p className="text-sm text-slate-500">The token is kept in this browser.</p>}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
        {narrow && (
          <nav id="board-phone-tabs" className="flex border-b border-slate-800 bg-slate-900 text-sm">
            <button id="board-tab-machines" onClick={() => setPhoneView('machines')} className={`flex-1 flex items-center justify-center gap-1 py-2 ${phoneView === 'machines' ? 'text-sky-300 border-b-2 border-sky-400' : 'text-slate-400'}`}>
              <LayoutGrid className="w-4 h-4" /> Machines
            </button>
            <button id="board-tab-alerts" onClick={() => setPhoneView('alerts')} className={`flex-1 flex items-center justify-center gap-1 py-2 ${phoneView === 'alerts' ? 'text-sky-300 border-b-2 border-sky-400' : 'text-slate-400'}`}>
              <Bell className="w-4 h-4" /> Alerts {open.length > 0 && <span className="px-1.5 rounded-full bg-rose-600 text-xs font-bold text-white">{open.length}</span>}
            </button>
          </nav>
        )}
        <div className="flex-1 min-h-0 flex">
          {(!narrow || phoneView === 'machines') && page === 'drives' && (
            <div className="flex-1 min-w-0 flex flex-col">
              <DrivesBoard conn={conn.current} connected={status.state === 'connected'} subscribe={subscribeIo} plcIds={wanted} onlyPlcs={activeFilter?.plcs ?? []} narrow={narrow} />
            </div>
          )}
          {(!narrow || phoneView === 'machines') && page === 'io' && (
            <div className="flex-1 min-w-0 flex flex-col">
              <IoBoard conn={conn.current} connected={status.state === 'connected'} subscribe={subscribeIo} plcIds={wanted} onlyPlcs={activeFilter?.plcs ?? []} signals={signals} onSignals={setSignals} recordings={rules.recordings} onRecord={(groups) => setRuleDialog({ kind: 'recording', groups })} canEdit={canEdit} narrow={narrow} />
            </div>
          )}
          {(!narrow || phoneView === 'machines') && page === 'machines' && (
          <div className="flex-1 min-w-0 flex flex-col">
          {selecting && (
            <div id="board-selection" className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-violet-800 bg-violet-950/60 text-sm">
              <CheckSquare className="w-4 h-4 text-violet-300" />
              <span id="board-selected-count" className="font-semibold">{selected.size} chosen</span>
              <span className="text-violet-200/70">{narrow ? '' : 'click machines to choose them'}</span>
              <button type="button" className="px-2 py-0.5 rounded border border-violet-700 hover:bg-violet-900" onClick={() => setSelected(new Set(shown.flatMap((p) => p.machines.map((m) => machineKey(p.id, m.path)))))}>
                All shown
              </button>
              {selected.size > 0 && (
                <button type="button" className="px-2 py-0.5 rounded border border-violet-700 hover:bg-violet-900" onClick={() => setSelected(new Set())}>
                  None
                </button>
              )}
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <button id="board-sel-record" type="button" disabled={!selected.size || !may('boardEdit')} title={may('boardEdit') ? undefined : 'Your role may not add recordings'} onClick={() => setRuleDialog({ kind: 'recording', groups: groupsOf([...selected]) })} className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-800 hover:bg-rose-700 text-white disabled:opacity-40">
                  <CircleDot className="w-4 h-4" /> Record…
                </button>
                <button id="board-sel-alarm" type="button" disabled={!selected.size || !may('boardEdit')} title={may('boardEdit') ? undefined : 'Your role may not add alarms'} onClick={() => setRuleDialog({ kind: 'alarm', groups: groupsOf([...selected]) })} className="flex items-center gap-1 px-2.5 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-40">
                  <BellRing className="w-4 h-4" /> Alarm…
                </button>
                <button id="board-sel-playback" type="button" disabled={!selected.size} onClick={() => void startPlayback(PLAYBACK_WINDOWS[0].ms)} className="flex items-center gap-1 px-2.5 py-1 rounded bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-40" title="Play back the last hour (the Play back… menu: longer)">
                  <History className="w-4 h-4" /> Play back
                </button>
                <button type="button" onClick={() => { setSelecting(false); setSelected(new Set()); }} className="px-2 py-1 rounded border border-slate-600 hover:bg-slate-800">
                  Done
                </button>
              </span>
            </div>
          )}
          <main className={`flex-1 min-w-0 overflow-y-auto ${narrow ? 'p-2 space-y-3' : 'p-4 space-y-5'}`}>
            {status.state === 'error' && <div className="px-4 py-2 rounded bg-rose-950 border border-rose-800 text-rose-200">{status.message}</div>}
            {filtering && !shown.length && (
              <div id="board-filter-none" className="px-4 py-6 text-slate-400">
                No machine matches {words.length ? <b className="text-slate-200">{filter}</b> : null}{problemsOnly ? ' among the ones in error or stuck' : ''}.{' '}
                <button type="button" className="underline hover:text-white" onClick={() => { setFilter(''); setProblemsOnly(false); applyFilter(null); }}>
                  Show all
                </button>
              </div>
            )}
            {shown.map((p) => (
              <section key={p.id} className="board-plc" data-plc={p.id} data-plc-state={p.plcState ?? ''}>
                <h2 className="flex items-center gap-3 mb-2">
                  <span className="text-xl font-semibold">{p.name}</span>
                  {/* (its PLC: green when it runs; amber, and said, when it does not: the machines below are frozen) */}
                  {p.plcState && (
                    <span className={`board-plc-state px-2 py-0.5 rounded-full text-sm ${p.plcState === 'Run' ? 'bg-emerald-900/70 text-emerald-200' : 'bg-amber-700 text-amber-50'}`} title={p.plcState === 'Run' ? 'Its PLC runs' : 'Its PLC does not run: the machines below keep their last states'}>
                      {p.plcState === 'Run' ? 'PLC runs' : p.plcState === 'Invalid' ? 'PLC: no program' : `PLC: ${p.plcState}`}
                    </span>
                  )}
                  <span className={`text-sm ${p.state === 'watching' ? 'text-emerald-400' : p.state === 'error' ? 'text-rose-400' : 'text-sky-400'}`}>{p.state === 'watching' ? '' : p.message || p.state}</span>
                  {p.maintenance ? (
                    <span className="board-maintenance ml-auto flex items-center gap-2 px-3 py-0.5 rounded-full bg-violet-800 text-violet-100 text-sm">
                      <Wrench className="w-4 h-4" /> Maintenance until {new Date(p.maintenance.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({p.maintenance.by}
                      {p.maintenance.note ? `: ${p.maintenance.note}` : ''}), alerts muted
                      {may('maintenance') && (
                        <button className="board-maintenance-end ml-1 px-2 rounded bg-violet-600 hover:bg-violet-500" onClick={() => void setMaintenance(p.id, 0, '')}>
                          End
                        </button>
                      )}
                    </span>
                  ) : !may('maintenance') ? null : (
                    <button className="board-maintenance-btn ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 text-sm text-slate-300 hover:bg-slate-800" onClick={() => setMaintFor(maintFor === p.id ? null : p.id)} title="Mute this PLC's alerts during planned work">
                      <Wrench className="w-4 h-4" /> Maintenance...
                    </button>
                  )}
                </h2>
                {(p.planned ?? []).length > 0 && (
                  <div className="board-planned mb-2 flex flex-wrap gap-2 text-sm">
                    {(p.planned ?? []).map((w) => (
                      <span key={w.id} className="board-planned-item flex items-center gap-2 px-2.5 py-0.5 rounded-full border border-violet-700 text-violet-200">
                        🗓️ Planned {new Date(w.from).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} to {new Date(w.until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} ({w.by}
                        {w.note ? `: ${w.note}` : ''})
                        {may('maintenance') && (
                          <button className="board-planned-remove px-1.5 rounded hover:bg-violet-800" onClick={() => void setMaintenance(p.id, 0, '', undefined, w.id)} title="Remove this planned window">
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {(p.notes ?? []).length > 0 && (
                  <div className="board-notes mb-2 flex flex-col gap-0.5 text-sm">
                    {(p.notes ?? []).slice(0, 3).map((n, i) => (
                      <div key={`${n.t}-${i}`} className="board-note flex gap-2 text-emerald-200" title={n.pou ? `Written live on ${n.pou}` : undefined}>
                        <span className="text-slate-400 font-mono shrink-0">{new Date(n.t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="truncate">📝 {n.text}</span>
                        <span className="text-slate-400 shrink-0">— {n.user}</span>
                      </div>
                    ))}
                  </div>
                )}
                {maintFor === p.id && !viewOnly && (
                  <form
                    className="board-maintenance-form mb-3 flex flex-wrap items-center gap-2 p-2 rounded border border-violet-800 bg-violet-950/40 text-sm"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void setMaintenance(p.id, maintMinutes, maintNote, maintAt || undefined);
                    }}
                  >
                    <span>Mute {p.name}'s alerts for</span>
                    <select className="board-maintenance-minutes bg-slate-900 border border-slate-700 rounded px-2 py-1" value={maintMinutes} onChange={(e) => setMaintMinutes(Number(e.target.value))}>
                      {MAINTENANCE_MINUTES.map((m) => (
                        <option key={m} value={m}>
                          {m < 60 ? `${m} min` : `${m / 60} h`}
                        </option>
                      ))}
                    </select>
                    <input className="board-maintenance-note flex-1 min-w-[12rem] bg-slate-900 border border-slate-700 rounded px-2 py-1" placeholder="Why (e.g. changing the clamp sensor)" value={maintNote} onChange={(e) => setMaintNote(e.target.value)} />
                    <label className="flex items-center gap-1">
                      starting
                      <input type="datetime-local" className="board-maintenance-at bg-slate-900 border border-slate-700 rounded px-2 py-1" value={maintAt} onChange={(e) => setMaintAt(e.target.value)} title="Empty: now; a date and time: planned" />
                    </label>
                    <button className="board-maintenance-start px-3 py-1 rounded bg-violet-700 hover:bg-violet-600">{maintAt ? 'Plan' : 'Start now'}</button>
                  </form>
                )}
                {layout === 'tree' ? (
                  <div className={`board-tree-plc ${p.maintenance ? 'opacity-60' : ''}`}>
                    <BoardTree nodes={machineTree(p.machines, root)} healthOf={healthOf} renderMachine={(m, label) => rowOf(p, m, label)} collapsed={collapsedOf(p.id)} onCollapse={(keys, closed) => collapse(keys.map((k) => `${p.id}|${k}`), closed)} narrow={narrow} />
                  </div>
                ) : (
                  <div className={`grid ${narrow ? 'gap-2 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]' : 'gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]'} ${p.maintenance ? 'opacity-60' : ''}`}>{p.machines.map((m) => tileOf(p, m))}</div>
                )}
                {!p.machines.length && <div className="text-slate-500">{p.state === 'watching' ? 'No state machines under ' + root : 'Looking for the machines...'}</div>}
              </section>
            ))}
          </main>
          {playback && (
            <BoardPlayback
              machines={playback.machines}
              from={playback.from}
              to={playback.to}
              t={playback.t}
              playing={playback.playing}
              speed={playback.speed}
              loading={playback.loading}
              isError={(n) => ERROR_STATE.test(n)}
              labelOf={(pm) => `${plcs.length > 1 ? `${plcName(pm.plc)}: ` : ''}${short(pm.path, root)}`}
              onSeek={(t) => setPlayback((pb) => (pb ? { ...pb, t } : pb))}
              onPlay={(on) => setPlayback((pb) => (pb ? { ...pb, playing: on, t: on && pb.t >= pb.to ? pb.from : pb.t } : pb))}
              onSpeed={(x) => setPlayback((pb) => (pb ? { ...pb, speed: x } : pb))}
              onClose={() => setPlayback(null)}
              narrow={narrow}
            />
          )}
          </div>
          )}
          {(narrow ? phoneView === 'alerts' : showAlerts) && (
            <aside id="board-alerts" className={`${narrow ? 'flex-1 min-w-0' : 'w-[26rem] shrink-0 border-l border-slate-800'} bg-slate-900/70 flex flex-col`}>
              <div className="px-4 py-2 border-b border-slate-800 flex items-center gap-2">
                <Bell className="w-4 h-4 text-sky-400" />
                <span className="font-semibold">Alerts</span>
                <span className="text-sm text-slate-400">{open.length} open</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {alerts.length === 0 && <div className="p-3 text-slate-500 text-sm">No alerts. The gateway's alert rules (its setup page) decide what is reported.</div>}
                {alerts.slice(0, 200).map((a) => {
                  const openOne = a.event !== 'recovered' && !a.ack && !a.resolvedAt;
                  return (
                    <div key={a.id} data-muted={a.muted ? 'true' : undefined} className={`board-alert rounded border px-3 py-2 text-sm ${a.muted ? 'border-slate-800 bg-slate-900/60 text-slate-400' : a.event === 'recovered' ? 'border-emerald-900 bg-emerald-950/40' : openOne ? (a.event === 'error' || a.event === 'plcStopped' ? 'border-rose-700 bg-rose-950/60' : a.event === 'slower' ? 'border-sky-700 bg-sky-950/50' : 'border-amber-600 bg-amber-950/50') : 'border-slate-800 bg-slate-900'}`} data-alert={a.id}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-slate-400">{new Date(a.at).toLocaleString()}</span>
                        {a.escalatedAt && !a.ack && <span className="board-escalated px-1.5 rounded bg-rose-600 text-[10px] font-bold uppercase text-white">escalated</span>}
                        {a.muted && <span className="board-muted px-1.5 rounded bg-violet-900 text-[10px] font-bold uppercase text-violet-100" title="Nobody was called: the PLC was in maintenance, or in its rule's quiet hours">🔕 muted · {a.muted}</span>}
                        <span className="ml-auto text-xs uppercase tracking-wide text-slate-400">{a.event}</span>
                      </div>
                      <div className="mt-0.5">{a.text}</div>
                      {a.ack && (
                        <div className="board-ack mt-1 text-xs text-emerald-300">
                          <Check className="inline w-3 h-3" /> {a.ack.by}, {new Date(a.ack.at).toLocaleTimeString()}
                          {a.ack.note ? `: ${a.ack.note}` : ''}
                        </div>
                      )}
                      {!a.ack && a.resolvedAt && a.event !== 'recovered' && !a.muted && <div className="mt-1 text-xs text-slate-500">Recovered {new Date(a.resolvedAt).toLocaleTimeString()}</div>}
                      {openOne &&
                        (noteFor === a.id ? (
                          <form
                            className="mt-2 flex gap-1"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void acknowledge(a);
                            }}
                          >
                            <input autoFocus className="board-ack-note flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm" placeholder="Note (optional): e.g. on my way" value={note} onChange={(e) => setNote(e.target.value)} />
                            <button className="board-ack-send px-2 rounded bg-sky-700 hover:bg-sky-600">OK</button>
                          </form>
                        ) : (
                          may('ack') && (
                            <button className="board-ack-btn mt-2 px-2 py-0.5 rounded border border-slate-600 hover:bg-slate-800" onClick={() => setNoteFor(a.id)}>
                              Acknowledge
                            </button>
                          )
                        ))}
                    </div>
                  );
                })}
              </div>
            </aside>
          )}
        </div>
        </div>
      )}
      {ruleDialog && (
        <BoardRuleDialog
          kind={ruleDialog.kind}
          groups={ruleDialog.groups}
          root={root}
          existing={existingFor(ruleDialog.kind, ruleDialog.groups)}
          canEdit={canEdit}
          onSave={(drafts) => saveRules(ruleDialog.kind, drafts)}
          onDelete={(r) => deleteRule(ruleDialog.kind, r)}
          onClose={() => setRuleDialog(null)}
        />
      )}
    </div>
  );
};
