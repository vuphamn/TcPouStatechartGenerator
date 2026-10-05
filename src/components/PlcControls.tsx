import React from 'react';
import { Loader2 } from 'lucide-react';
import type { FoundPlc } from '../utils/plcDiscovery.ts';

/** A PLC's state as going live would see it (TwinCAT's, its PLC's, its project), or why it did not answer */
export type PlcState = NonNullable<FoundPlc['state']>;
/** What can be done to a PLC from here, not live: start its PLC, stop it, restart it, or TwinCAT to Run mode */
export type PlcControlMode = 'plc' | 'stop' | 'restart' | 'run';
export type PlcControlResult = { state: string | null; ok: boolean; error?: string };
export const ALL_PLC_CONTROLS: PlcControlMode[] = ['plc', 'stop', 'restart', 'run'];

/** Its badge's text: Run, Config, no program, no PLC, Stop …; no route / no answer when it did not answer */
export function plcStateText(s: PlcState): string {
  if (s.error) return /route/i.test(s.error) ? 'no route' : 'no answer';
  if (s.system === 'Config') return 'Config';
  if (!s.plc || s.plc === 'none') return 'no PLC';
  if (s.plc === 'Invalid') return 'no program';
  return s.plc;
}

/**
 * Its state: green when its PLC runs, amber when it does not, grey when it did not answer; its project's name beside
 * it. changed: what it was before, and when it changed (read again: shown for a while)
 */
export const PlcStateBadge: React.FC<{ state?: PlcState | null; changed?: { from: string; at: number } | null; id?: string }> = ({ state: s, changed, id }) => {
  if (!s) return null;
  const text = plcStateText(s);
  const was = changed ? ` Was ${changed.from} until ${new Date(changed.at).toLocaleTimeString()}.` : '';
  const ring = changed ? ' ring-1 ring-sky-400 animate-pulse' : '';
  if (s.error) {
    return (
      <span id={id} className={`live-plc-state shrink-0 px-1 rounded bg-slate-800 text-slate-400 text-[10px]${ring}`} data-state="error" data-changed={changed ? 'true' : undefined} title={`Did not answer: ${s.error}. Add route gives it one for this computer.${was}`}>
        {text}
      </span>
    );
  }
  const why =
    s.system === 'Config'
      ? 'TwinCAT is in Config mode: no PLC runs'
      : s.plc === 'Invalid'
        ? 'Its PLC runs no program (not started, or its license ran out)'
        : !s.plc || s.plc === 'none'
          ? 'No PLC on ADS port 851'
          : `Its PLC is in ${s.plc}`;
  return (
    <span
      id={id}
      className={`live-plc-state shrink-0 px-1 rounded text-[10px] ${s.plc === 'Run' ? 'bg-emerald-900/60 text-emerald-300' : 'bg-amber-900/60 text-amber-300'}${ring}`}
      data-state={text}
      data-changed={changed ? 'true' : undefined}
      title={`TwinCAT ${s.system ?? '?'}; ${why}${s.project ? `; project ${s.project}` : ''}.${was}`}
    >
      {text}
      {s.project ? ` · ${s.project}` : ''}
      {changed ? <span className="live-plc-state-was ml-1 opacity-80">(was {changed.from})</span> : null}
    </span>
  );
};

/** What its state offers (of those allowed here): Config: Run mode; stopped: Start; running: Stop, Restart */
export function plcActions(s: PlcState | null | undefined, allowed: PlcControlMode[]): PlcControlMode[] {
  if (!s || s.error) return [];
  const want: PlcControlMode[] = s.system === 'Config' ? ['run'] : s.plc === 'Stop' ? ['plc'] : s.plc === 'Run' ? ['stop', 'restart'] : [];
  return want.filter((m) => allowed.includes(m));
}

export const plcActionLabel = (mode: PlcControlMode) => ({ plc: 'Start PLC', stop: 'Stop PLC', restart: 'Restart', run: 'Run mode' })[mode];

/** Asked first: what it drives may move (or stop) */
export function plcActionQuestion(mode: PlcControlMode, name: string): string {
  if (mode === 'run') return `Set TwinCAT on ${name} to Run mode? It restarts with its activated configuration, and its PLC starts as its boot project says: what it drives may move.`;
  if (mode === 'stop') return `Stop the PLC on ${name}? Its program stops where it is: what it drives stops being controlled (outputs as its configuration says).`;
  if (mode === 'restart') return `Restart the PLC on ${name}? Its variables go back to their initial values (retained ones kept) and its program runs again from the start: what it drives may move.`;
  return `Start the PLC on ${name}? Its program runs from where it stopped: what it drives may move.`;
}

/** What it answered, in words */
export function plcActionDone(mode: PlcControlMode, r: PlcControlResult, name: string): string {
  if (!r.ok) return `Not ${mode === 'stop' ? 'stopped' : mode === 'restart' ? 'restarted' : 'started'}${r.state ? ` (${r.state})` : ''}: ${r.error ?? 'no answer'}`;
  if (mode === 'run') return `TwinCAT is in Run mode on ${name}`;
  if (mode === 'stop') return `Its PLC is stopped (${r.state ?? 'Stop'})`;
  if (mode === 'restart') return `Its PLC restarted and runs (${r.state ?? 'Run'})`;
  return `Its PLC runs (${r.state ?? 'Run'})`;
}

/** The question and its buttons (ids: <idPrefix>-form, -confirm) */
export const PlcActionConfirm: React.FC<{ idPrefix: string; mode: PlcControlMode; name: string; busy: boolean; onConfirm: () => void; onCancel: () => void }> = ({ idPrefix, mode, name, busy, onConfirm, onCancel }) => (
  <div id={`${idPrefix}-form`} data-mode={mode} className="ml-2 mr-1 my-1 p-1.5 rounded border border-amber-800 bg-slate-900 space-y-1 text-[11px]">
    <div className="text-amber-200">{plcActionQuestion(mode, name)}</div>
    <div className="flex items-center gap-1">
      <button id={`${idPrefix}-confirm`} disabled={busy} onClick={onConfirm} className="px-2 py-0.5 rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white">
        {busy ? <Loader2 className="inline w-3 h-3 animate-spin" /> : mode === 'plc' ? 'Start' : mode === 'stop' ? 'Stop' : plcActionLabel(mode)}
      </button>
      <button onClick={onCancel} className="px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">
        Cancel
      </button>
    </div>
  </div>
);

/** The buttons its state offers (class: <className>, data-mode) */
export const PlcActionButtons: React.FC<{ modes: PlcControlMode[]; className: string; netId?: string; onPick: (mode: PlcControlMode) => void }> = ({ modes, className, netId, onPick }) => (
  <>
    {modes.map((mode) => (
      <button
        key={mode}
        className={`${className} shrink-0 ml-1 px-1.5 rounded border text-[10px] hover:bg-slate-800 ${mode === 'stop' ? 'border-rose-800 text-rose-300' : 'border-amber-700 text-amber-300'}`}
        data-netid={netId}
        data-mode={mode}
        onClick={() => onPick(mode)}
        title={mode === 'run' ? 'Set TwinCAT there to Run mode (it restarts; asked first)' : `${plcActionLabel(mode)} (asked first)`}
      >
        {plcActionLabel(mode)}
      </button>
    ))}
  </>
);

/** States read again: those that changed since the last read, with what they were (for their badges) */
export function stateChanges(before: Map<string, string>, after: [string, PlcState | undefined][], at: number): Record<string, { from: string; at: number }> {
  const changed: Record<string, { from: string; at: number }> = {};
  for (const [key, s] of after) {
    if (!s) continue;
    const was = before.get(key);
    const now = plcStateText(s);
    if (was && was !== now) changed[key] = { from: was, at };
  }
  return changed;
}

/**
 * A gateway's PLC chosen in the Live tab, not live: its state, read every few seconds (marked for a while when it
 * changed), and what it offers (Start PLC, Stop PLC, Restart, Run mode: asked first; a write, as the gateway allows)
 */
export const GatewayPlcState: React.FC<{ name: string; read: () => Promise<{ state?: PlcState; name?: string } | undefined>; control?: (mode: PlcControlMode) => Promise<PlcControlResult>; modes: PlcControlMode[] }> = ({ name: given, read, control, modes }) => {
  const [state, setState] = React.useState<PlcState | null>(null);
  // (its name as the gateway gives it; until then, as the Live tab knows it)
  const [name, setName] = React.useState(given);
  const [changed, setChanged] = React.useState<{ from: string; at: number } | null>(null);
  const [asking, setAsking] = React.useState<PlcControlMode | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const lastRef = React.useRef<string | null>(null);
  const readRef = React.useRef(read);
  readRef.current = read;
  const refresh = React.useCallback(() => {
    void readRef.current()
      .then((r) => {
        const s = r?.state;
        if (r?.name) setName(r.name);
        if (!s) return;
        const now = plcStateText(s);
        if (lastRef.current && lastRef.current !== now) setChanged({ from: lastRef.current, at: Date.now() });
        lastRef.current = now;
        setState(s);
      })
      .catch(() => {});
  }, []);
  React.useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);
  React.useEffect(() => {
    if (!changed) return;
    const t = setTimeout(() => setChanged(null), 30000);
    return () => clearTimeout(t);
  }, [changed]);
  const run = (mode: PlcControlMode) => {
    if (!control) return;
    setBusy(true);
    setResult(null);
    void control(mode)
      .then((r) => {
        setResult({ ok: r.ok, text: plcActionDone(mode, r, name) });
        if (r.ok) setAsking(null);
      })
      .finally(() => {
        setBusy(false);
        refresh();
      });
  };
  return (
    <div id="live-gw-plc" className="min-w-0 text-[11px]">
      <div className="flex items-center flex-wrap gap-y-1">
        {state ? <PlcStateBadge id="live-gw-plc-state" state={state} changed={changed} /> : <Loader2 className="w-3 h-3 animate-spin text-slate-500" />}
        {control && <PlcActionButtons modes={plcActions(state, modes)} className="live-gw-plc-control" onPick={(m) => { setAsking(asking === m ? null : m); setResult(null); }} />}
      </div>
      {asking && <PlcActionConfirm idPrefix="live-gw-plc-control" mode={asking} name={name} busy={busy} onConfirm={() => run(asking)} onCancel={() => setAsking(null)} />}
      {result && (
        <div id="live-gw-plc-control-result" data-ok={String(result.ok)} className={result.ok ? 'text-emerald-300' : 'text-rose-300'}>
          {result.text}
        </div>
      )}
    </div>
  );
};
