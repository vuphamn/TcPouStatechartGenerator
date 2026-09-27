import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bell, BellOff, Check, Maximize2, Radio, Timer } from 'lucide-react';
import { GatewayConnection, detectGatewayOrigin, fetchGatewaySso, type GatewaySso } from '../utils/liveGateway.ts';
import { formatDuration } from '../utils/liveView.ts';
import { formatLimit, limitFor, useDefaultLimit, useLimitsOfTypes } from '../utils/stateLimits.ts';
import { useStoredSecret } from '../hooks/useStoredSecret.ts';

/**
 * Operator board (the web app at ?board, served by a gateway): a full-screen, read-only view for a screen by the
 * line. One tile per state machine of the gateway's PLCs (the gateway follows them, shared by every board): green
 * normal, amber stuck (longer in a state than its limit), red error; problems first. The alerts panel lists the
 * gateway's alerts; Acknowledge (with a note) tells the others who is on it (and posts to the rule's webhook).
 * URL: ?board[&plcs=line202,line237][&root=MAIN.mainStateMachine][&title=Line%20202][&stuck=300 (s)][&gateway=host:8443]
 */

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
  machines: BoardMachine[];
}

export interface AlertEvent {
  id: string;
  event: 'stuck' | 'error' | 'recovered';
  plc: string;
  plcName: string;
  machine: string;
  state: string;
  text: string;
  at: string;
  ack: { by: string; at: string; note: string } | null;
  resolvedAt: string | null;
}

const short = (path: string, root: string) => (path.toLowerCase().startsWith(root.toLowerCase() + '.') ? path.slice(root.length + 1) : path.toLowerCase() === root.toLowerCase() ? '(main)' : path);

export const OperatorBoard: React.FC = () => {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const wanted = useMemo(() => (params.get('plcs') ?? '').split(',').map((s) => s.trim()).filter(Boolean), [params]);
  const root = params.get('root') || 'MAIN.mainStateMachine';
  const title = params.get('title') || 'Machines';
  const stuckDefault = Number(params.get('stuck')) > 0 ? Number(params.get('stuck')) * 1000 : null;
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

  useEffect(() => {
    document.title = `${title} · Kval StateScope`;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [title]);
  useEffect(() => {
    if (origin) return;
    void detectGatewayOrigin().then((o) => (o ? setOrigin(o) : setStatus({ state: 'error', message: 'This page is not served by a Kval StateScope gateway: add &gateway=<host:port> to the address' })));
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
      const msg = m as unknown as { type: string; now?: number; plcs?: BoardPlc[]; events?: AlertEvent[]; event?: AlertEvent; message?: string };
      if (msg.type === 'boardState' && msg.plcs) {
        setPlcs(msg.plcs);
        if (msg.now) setOffset(Date.now() - msg.now);
      } else if (msg.type === 'alertsList' && msg.events) setAlerts(msg.events);
      else if (msg.type === 'alertEvent' && msg.event) {
        const e = msg.event;
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
        c.send({ type: 'boardWatch', plcs: wanted, root });
        c.send({ type: 'alertsList' });
      })
      .catch((err: Error) => {
        setStatus({ state: 'error', message: err.message });
        // A wall screen: keep trying while the gateway or the network is away
        if (!/not accepted|denied|Sign in/i.test(err.message)) window.setTimeout(() => connectRef.current(), 10000);
      });
  }, [origin, sso, token, wanted, root]);
  const connectRef = useRef(connect);
  connectRef.current = connect;
  useEffect(() => {
    connect();
    return () => conn.current?.close();
  }, [connect]);

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
      <header className="flex items-center gap-4 px-5 py-3 border-b border-slate-800 bg-slate-900">
        <Radio className="w-6 h-6 text-sky-400" />
        <h1 id="board-title" className="text-2xl font-semibold tracking-wide">{title}</h1>
        <span id="board-counts" className="flex items-center gap-3 text-lg">
          <span className="text-slate-400">{counts.all} machines</span>
          {counts.error > 0 && (
            <span className="flex items-center gap-1 px-2.5 rounded-full bg-rose-700 text-white">
              <AlertTriangle className="w-4 h-4" /> {counts.error} in error
            </span>
          )}
          {counts.stuck > 0 && (
            <span className="flex items-center gap-1 px-2.5 rounded-full bg-amber-500 text-slate-950">
              <Timer className="w-4 h-4" /> {counts.stuck} stuck
            </span>
          )}
        </span>
        <span className="ml-auto text-sm text-slate-400" id="board-status" title={status.message}>
          {status.state === 'connected' ? status.message : status.message || ''}
        </span>
        <span className="font-mono text-xl text-slate-300">{new Date(now).toLocaleTimeString()}</span>
        <button id="board-alerts-toggle" onClick={() => setShowAlerts((s) => !s)} className="relative p-2 rounded hover:bg-slate-800" title="Alerts">
          {showAlerts ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
          {open.length > 0 && <span className="absolute -top-1 -right-1 min-w-[1.25rem] px-1 rounded-full bg-rose-600 text-xs font-bold">{open.length}</span>}
        </button>
        <button onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)} className="p-2 rounded hover:bg-slate-800" title="Full screen">
          <Maximize2 className="w-5 h-5" />
        </button>
      </header>

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
        <div className="flex-1 min-h-0 flex">
          <main className="flex-1 min-w-0 overflow-y-auto p-4 space-y-5">
            {status.state === 'error' && <div className="px-4 py-2 rounded bg-rose-950 border border-rose-800 text-rose-200">{status.message}</div>}
            {tiles.map((p) => (
              <section key={p.id} className="board-plc" data-plc={p.id}>
                <h2 className="flex items-baseline gap-3 mb-2">
                  <span className="text-xl font-semibold">{p.name}</span>
                  <span className={`text-sm ${p.state === 'watching' ? 'text-emerald-400' : p.state === 'error' ? 'text-rose-400' : 'text-sky-400'}`}>{p.state === 'watching' ? '' : p.message || p.state}</span>
                </h2>
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
                  {p.machines.map((m) => (
                    <div
                      key={m.path}
                      className={`board-tile rounded-lg px-4 py-3 border-2 ${m.error ? 'bg-rose-800 border-rose-500' : m.stuck ? 'bg-amber-500 border-amber-300 text-slate-950' : m.state ? 'bg-emerald-950 border-emerald-800' : 'bg-slate-900 border-slate-800 text-slate-400'}`}
                      data-path={m.path}
                      data-kind={m.error ? 'error' : m.stuck ? 'stuck' : m.state ? 'ok' : 'unknown'}
                    >
                      <div className="text-sm opacity-80 truncate" title={`${m.path} (${m.type})`}>{short(m.path, root)}</div>
                      <div className="board-state text-lg font-bold leading-tight break-words">{m.state ?? '...'}</div>
                      <div className="flex items-center gap-2 text-sm font-mono opacity-90">
                        {m.since ? `${m.atLeast ? '≥ ' : ''}${formatDuration(m.inState)}` : ''}
                        {m.stuck && m.limit ? <span>/ {formatLimit(m.limit)}</span> : null}
                        {m.error ? <AlertTriangle className="w-4 h-4 ml-auto" /> : m.stuck ? <Timer className="w-4 h-4 ml-auto" /> : null}
                      </div>
                    </div>
                  ))}
                  {!p.machines.length && <div className="text-slate-500">{p.state === 'watching' ? 'No state machines under ' + root : 'Looking for the machines...'}</div>}
                </div>
              </section>
            ))}
          </main>
          {showAlerts && (
            <aside id="board-alerts" className="w-[26rem] shrink-0 border-l border-slate-800 bg-slate-900/70 flex flex-col">
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
                    <div key={a.id} className={`board-alert rounded border px-3 py-2 text-sm ${a.event === 'recovered' ? 'border-emerald-900 bg-emerald-950/40' : openOne ? (a.event === 'error' ? 'border-rose-700 bg-rose-950/60' : 'border-amber-600 bg-amber-950/50') : 'border-slate-800 bg-slate-900'}`} data-alert={a.id}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-slate-400">{new Date(a.at).toLocaleString()}</span>
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
      )}
    </div>
  );
};
