import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bell, BellOff, Check, LayoutGrid, Maximize2, Radio, Timer, Volume2, VolumeX, Wrench } from 'lucide-react';
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
}

export interface AlertEvent {
  id: string;
  event: 'stuck' | 'error' | 'recovered' | 'slower' | 'plcStopped';
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
    if (soundRef.current && canPlay()) playAlert(escalated ? 'escalated' : e.event === 'error' || e.event === 'plcStopped' ? 'error' : 'stuck');
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
    const useSso = !!sso?.user;
    if (!useSso && !token) {
      setStatus({ state: 'idle', message: '' });
      return;
    }
    conn.current?.close();
    const c = new GatewayConnection((m) => {
      const msg = m as unknown as { type: string; now?: number; plcs?: BoardPlc[]; events?: AlertEvent[]; event?: AlertEvent; message?: string; boards?: SavedBoard[] };
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
    c.connect(origin, token, useSso)
      .then(({ user }) => {
        setStatus({ state: 'connected', message: `Signed in as ${user}` });
        c.send({ type: 'boardList' });
        c.send({ type: 'alertsList' });
      })
      .catch((err: Error) => {
        setStatus({ state: 'error', message: err.message });
        // A wall screen: keep trying while the gateway or the network is away
        if (!/not accepted|denied|Sign in/i.test(err.message)) window.setTimeout(() => connectRef.current(), 10000);
      });
  }, [origin, sso, token]);
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
  const tiles = useMemo(
    () =>
      plcs.map((p) => ({
        ...p,
        machines: p.machines
          .map((m) => {
            const type = (m.type.split('.').pop() ?? m.type).toLowerCase();
            const limit = m.limitMs ?? limitFor(typeLimits[type] ?? {}, viewerDefault ?? stuckDefault, m.state);
            const inState = m.since ? Math.max(0, now - offset - m.since) : 0;
            const stuck = !m.error && !!limit && inState > limit;
            return { ...m, limit, inState, stuck, rank: m.error ? 0 : stuck ? 1 : m.state ? 2 : 3 };
          })
          .sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path)),
      })),
    [plcs, typeLimits, viewerDefault, stuckDefault, now, offset]
  );
  const counts = tiles.flatMap((p) => p.machines).reduce((c, m) => ({ all: c.all + 1, error: c.error + (m.error ? 1 : 0), stuck: c.stuck + (m.stuck ? 1 : 0) }), { all: 0, error: 0, stuck: 0 });
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

  const needsSignIn = status.state !== 'connected' && !sso?.user && !token;
  return (
    <div id="operator-board" className="fixed inset-0 flex flex-col bg-slate-950 text-slate-100 select-none">
      <header className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-800 bg-slate-900 ${narrow ? 'px-3 py-2' : 'px-5 py-3'} ${open.length && Object.values(flashing).some((t) => t > now) ? 'board-header-flash' : ''}`}>
        <Radio className={`${narrow ? 'w-5 h-5' : 'w-6 h-6'} text-sky-400`} />
        <h1 id="board-title" className={`${narrow ? 'text-lg' : 'text-2xl'} font-semibold tracking-wide`}>{title}</h1>
        <span id="board-counts" className={`flex items-center gap-3 ${narrow ? 'text-sm' : 'text-lg'}`}>
          <span className="text-slate-400">{counts.all} machines</span>
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
        {status.state === 'connected' && (
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
          {(!narrow || phoneView === 'machines') && (
          <main className={`flex-1 min-w-0 overflow-y-auto ${narrow ? 'p-2 space-y-3' : 'p-4 space-y-5'}`}>
            {status.state === 'error' && <div className="px-4 py-2 rounded bg-rose-950 border border-rose-800 text-rose-200">{status.message}</div>}
            {tiles.map((p) => (
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
                      <button className="board-maintenance-end ml-1 px-2 rounded bg-violet-600 hover:bg-violet-500" onClick={() => void setMaintenance(p.id, 0, '')}>
                        End
                      </button>
                    </span>
                  ) : (
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
                        <button className="board-planned-remove px-1.5 rounded hover:bg-violet-800" onClick={() => void setMaintenance(p.id, 0, '', undefined, w.id)} title="Remove this planned window">
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {maintFor === p.id && (
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
                <div className={`grid ${narrow ? 'gap-2 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]' : 'gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]'} ${p.maintenance ? 'opacity-60' : ''}`}>
                  {p.machines.map((m) => (
                    <a
                      key={m.path}
                      href={watchUrl(p, m)}
                      target="_blank"
                      rel="noreferrer"
                      title={`${m.path} (${m.type}): open its diagram, live`}
                      className={`board-tile block rounded-lg border-2 cursor-pointer hover:brightness-125 ${narrow ? 'px-2.5 py-2' : 'px-4 py-3'} ${flashOn(m.path) ? 'board-tile-flash' : ''} ${m.error ? 'bg-rose-800 border-rose-500' : m.stuck ? 'bg-amber-500 border-amber-300 text-slate-950' : m.state ? 'bg-emerald-950 border-emerald-800' : 'bg-slate-900 border-slate-800 text-slate-400'}`}
                      data-path={m.path}
                      data-kind={m.error ? 'error' : m.stuck ? 'stuck' : m.state ? 'ok' : 'unknown'}
                    >
                      <div className={`${narrow ? 'text-xs' : 'text-sm'} opacity-80 truncate`}>{short(m.path, root)}</div>
                      <div className={`board-state ${narrow ? 'text-sm' : 'text-lg'} font-bold leading-tight break-words`}>{m.state ?? '...'}</div>
                      <div className="flex items-center gap-2 text-sm font-mono opacity-90">
                        {m.since ? `${m.atLeast ? '≥ ' : ''}${formatDuration(m.inState)}` : ''}
                        {m.stuck && m.limit ? <span>/ {formatLimit(m.limit)}</span> : null}
                        {m.error ? <AlertTriangle className="w-4 h-4 ml-auto" /> : m.stuck ? <Timer className="w-4 h-4 ml-auto" /> : null}
                      </div>
                    </a>
                  ))}
                  {!p.machines.length && <div className="text-slate-500">{p.state === 'watching' ? 'No state machines under ' + root : 'Looking for the machines...'}</div>}
                </div>
              </section>
            ))}
          </main>
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
                    <div key={a.id} className={`board-alert rounded border px-3 py-2 text-sm ${a.event === 'recovered' ? 'border-emerald-900 bg-emerald-950/40' : openOne ? (a.event === 'error' || a.event === 'plcStopped' ? 'border-rose-700 bg-rose-950/60' : a.event === 'slower' ? 'border-sky-700 bg-sky-950/50' : 'border-amber-600 bg-amber-950/50') : 'border-slate-800 bg-slate-900'}`} data-alert={a.id}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-slate-400">{new Date(a.at).toLocaleString()}</span>
                        {a.escalatedAt && !a.ack && <span className="board-escalated px-1.5 rounded bg-rose-600 text-[10px] font-bold uppercase text-white">escalated</span>}
                        <span className="ml-auto text-xs uppercase tracking-wide text-slate-400">{a.event}</span>
                      </div>
                      <div className="mt-0.5">{a.text}</div>
                      {a.ack && (
                        <div className="board-ack mt-1 text-xs text-emerald-300">
                          <Check className="inline w-3 h-3" /> {a.ack.by}, {new Date(a.ack.at).toLocaleTimeString()}
                          {a.ack.note ? `: ${a.ack.note}` : ''}
                        </div>
                      )}
                      {!a.ack && a.resolvedAt && a.event !== 'recovered' && <div className="mt-1 text-xs text-slate-500">Recovered {new Date(a.resolvedAt).toLocaleTimeString()}</div>}
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
                          <button className="board-ack-btn mt-2 px-2 py-0.5 rounded border border-slate-600 hover:bg-slate-800" onClick={() => setNoteFor(a.id)}>
                            Acknowledge
                          </button>
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
    </div>
  );
};
