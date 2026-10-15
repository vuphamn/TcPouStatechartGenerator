import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleDashed, ListChecks, Megaphone, Pencil, X, XCircle } from 'lucide-react';
import type { GatewayConnection } from '../utils/liveGateway.ts';
import { formatDuration } from '../utils/liveView.ts';

/** A recovery guide (gateway/recovery.cjs) */
export interface RecoveryGuide {
  id: string;
  title: string;
  plc: string;
  type: string;
  machine: string;
  state: string;
  steps: { text: string; check?: { var: string; equals: string } }[];
  used?: number;
  recovered?: number;
  meanMs?: number | null;
}
/** The machine a guide is for */
export interface RecoveryTarget {
  plc: string;
  plcName: string;
  machine: string;
  type: string;
  state: string;
}

const lower = (x: string | undefined) => String(x ?? '').toLowerCase();
const shortType = (t: string | undefined) => lower(t).split('.').pop() ?? '';
/** The guide for a machine in its state: its own, its type's, the state's (as the gateway matches) */
export function guideFor(guides: RecoveryGuide[], t: RecoveryTarget): RecoveryGuide | null {
  const of = guides.filter((g) => lower(g.state) === lower(t.state) && (!g.plc || g.plc === t.plc));
  return of.find((g) => g.machine && lower(g.machine) === lower(t.machine)) ?? of.find((g) => !g.machine && g.type && shortType(g.type) === shortType(t.type)) ?? of.find((g) => !g.machine && !g.type) ?? null;
}

/** Steps as written in the editor, one a line: "text | MAIN.var = VALUE" (the check optional) */
const stepsToText = (g: RecoveryGuide | null) => (g?.steps ?? []).map((s) => (s.check ? `${s.text} | ${s.check.var} = ${s.check.equals}` : s.text)).join('\n');
const textToSteps = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [t, c] = l.split('|').map((x) => x.trim());
      const m = c ? /^([^=<>]+?)\s*(=|<=|>=|<|>)\s*(.+)$/.exec(c) : null;
      return m ? { text: t, check: { var: m[1].trim(), equals: m[2] === '=' ? m[3].trim() : `${m[2]}${m[3].trim()}` } } : { text: t };
    });

type Check = { var: string; equals: string; value: unknown; error: string | null; ok: boolean };
type Run = { id: string; steps: { i: number; skipped: boolean }[]; endedAt: number | null; outcome: string | null };

/**
 * Guided recovery for a machine stopped in an error state: its guide's steps one at a time (each check read live from
 * the PLC), then Recovered or Still down (a call for maintenance); editors write or change the guide here
 */
export function RecoveryDialog({ conn, target, guides, canRun, canEdit, canCall, onClose }: { conn: GatewayConnection | null; target: RecoveryTarget; guides: RecoveryGuide[]; canRun: boolean; canEdit: boolean; canCall: boolean; onClose: () => void }) {
  const guide = guideFor(guides, target);
  const [run, setRun] = useState<Run | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [editing, setEditing] = useState(!guide && canEdit);
  const [draft, setDraft] = useState(() => ({ title: guide?.title ?? '', scope: guide?.machine ? 'machine' : guide && !guide.type ? 'state' : 'type', steps: stepsToText(guide) }));
  const [started, setStarted] = useState(0);
  const [, setTick] = useState(0);
  const wanted = useMemo(() => (guide?.steps ?? []).filter((s) => s.check).map((s) => s.check!), [guide]);
  const wantedKey = JSON.stringify(wanted);
  // (the checks read every 2 s while it is open)
  useEffect(() => {
    if (!conn || !wanted.length || editing) return;
    let live = true;
    const read = () =>
      void conn
        .request<{ checks?: Check[]; error?: string }>({ type: 'recoveryChecks', plc: target.plc, checks: wanted }, 'recoveryChecksResult', 10000)
        .then((r) => live && setChecks(r.checks ?? []))
        .catch(() => undefined);
    read();
    const t = window.setInterval(read, 2000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, wantedKey, target.plc, editing]);
  useEffect(() => {
    if (!run || run.endedAt) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [run]);
  const checkOf = (s: RecoveryGuide['steps'][number]) => (s.check ? checks.find((c) => c.var === s.check!.var && c.equals === s.check!.equals) ?? null : null);
  const doneSet = new Set((run?.steps ?? []).map((s) => s.i));
  const current = guide ? guide.steps.findIndex((_, i) => !doneSet.has(i)) : -1;
  type R = { ok: boolean; run?: Run; error?: string; message?: string };
  const ask = async (m: Record<string, unknown>) => {
    const r: R | undefined = await conn?.request<R>(m, 'recoveryResult', 15000).catch((e: unknown): R => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!r?.ok) setMsg({ text: r?.error ?? r?.message ?? 'Not done', ok: false });
    else if (r.run) setRun(r.run);
    return r;
  };
  const begin = async () => {
    setMsg(null);
    const r = await ask({ type: 'recoveryStart', guide: guide!.id, plc: target.plc, plcName: target.plcName, machine: target.machine, state: target.state });
    if (r?.ok) setStarted(Date.now());
  };
  const step = (i: number, skipped: boolean) => {
    const c = checkOf(guide!.steps[i]);
    void ask({ type: 'recoveryStep', id: run!.id, step: i, skipped, value: c ? String(c.value) : undefined });
  };
  const end = async (outcome: 'recovered' | 'called' | 'stopped') => {
    const r = await ask({ type: 'recoveryEnd', id: run!.id, outcome, note });
    if (!r?.ok) return;
    if (outcome === 'called' && canCall) {
      const done = (run?.steps ?? []).filter((s) => !s.skipped).length;
      const c = await conn?.request<{ ok: boolean; error?: string }>({ type: 'callMaintenance', plc: target.plc, machine: target.machine, reason: 'Other', note: `${guide!.title}: ${done} of ${guide!.steps.length} steps done, still down${note ? `. ${note}` : ''}`.slice(0, 200) }, 'callMaintenanceResult', 15000).catch(() => null);
      setMsg(c?.ok ? { text: 'Maintenance called', ok: true } : { text: c?.error ?? 'Maintenance not called', ok: false });
    } else setMsg({ text: outcome === 'recovered' ? 'Recovered: kept with the guide' : 'Stopped', ok: true });
  };
  const save = async () => {
    setMsg(null);
    const g = { id: guide?.id, title: draft.title, state: target.state, plc: target.plc, type: draft.scope === 'type' ? target.type : '', machine: draft.scope === 'machine' ? target.machine : '', steps: textToSteps(draft.steps) };
    type S = { ok: boolean; error?: string; message?: string };
    const r: S | undefined = await conn?.request<S>({ type: 'recoverySave', guide: g }, 'recoveryResult', 15000).catch((e: unknown): S => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (r?.ok) {
      setEditing(false);
      setMsg({ text: 'Saved: every board offers it now', ok: true });
    } else setMsg({ text: r?.error ?? r?.message ?? 'Not saved', ok: false });
  };
  const shortType2 = target.type.split('.').pop();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="board-recovery" className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-lg border border-amber-600 bg-slate-900 p-4 space-y-3 shadow-2xl" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="flex items-center gap-2 text-lg font-semibold">
          <ListChecks className="w-5 h-5 text-amber-300" /> {guide && !editing ? guide.title : 'Recovery guide'}
          <button type="button" onClick={onClose} className="ml-auto p-1 rounded text-slate-400 hover:text-white" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="text-sm text-slate-400">
          {target.machine} <span className="text-slate-500">({target.plcName})</span> in <b className="text-amber-200">{target.state}</b>
          {guide && guide.used ? ` · used ${guide.used} time${guide.used === 1 ? '' : 's'} in 90 days, recovered ${guide.recovered}${guide.meanMs ? `, in ${formatDuration(guide.meanMs)} on average` : ''}` : ''}
        </div>
        {editing ? (
          <div id="recovery-editor" className="space-y-2 text-sm">
            <input id="recovery-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={`Title, e.g. Clear the ${target.state.toLowerCase().replace(/_/g, ' ')}`} className="w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 select-text" />
            <label className="flex items-center gap-2">
              For
              <select id="recovery-scope" value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })} className="bg-slate-950 border border-slate-700 rounded px-2 py-1">
                <option value="type">every {shortType2 || 'machine of this type'}</option>
                <option value="machine">this machine only</option>
                <option value="state">every machine in {target.state}</option>
              </select>
            </label>
            <textarea id="recovery-steps" value={draft.steps} onChange={(e) => setDraft({ ...draft, steps: e.target.value })} rows={8} placeholder={'One step a line. A step the PLC can check: its text | the variable = its value\nOpen the guard and remove the jammed part\nClose the guard | MAIN.bGuardClosed = TRUE\nPress Reset on the panel'} className="w-full rounded bg-slate-950 border border-slate-700 p-2 font-mono text-xs select-text" />
            <div className="flex items-center gap-2">
              {guide && (
                <button type="button" onClick={() => setEditing(false)} className="px-3 py-1 rounded border border-slate-600 hover:bg-slate-800">
                  Cancel
                </button>
              )}
              <button id="recovery-save" type="button" onClick={() => void save()} className="ml-auto px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white">
                Save the guide
              </button>
            </div>
          </div>
        ) : !guide ? (
          <div className="text-slate-400">No recovery guide for this state yet.</div>
        ) : (
          <ol id="recovery-steps-list" className="space-y-2">
            {guide.steps.map((s, i) => {
              const c = checkOf(s);
              const done = run?.steps.find((x) => x.i === i);
              const isNow = !!run && !run.endedAt && i === current;
              return (
                <li key={i} className={`recovery-step flex items-start gap-3 rounded border px-3 py-2 ${isNow ? 'border-amber-500 bg-amber-950/40 text-lg' : done ? 'border-slate-800 text-slate-400' : 'border-slate-800'}`} data-step={i} data-done={done ? (done.skipped ? 'skipped' : 'done') : ''}>
                  <span className="font-mono text-slate-500 w-5 text-right">{i + 1}.</span>
                  <span className="flex-1">
                    {s.text}
                    {s.check && (
                      <span className={`recovery-check ml-2 inline-flex items-center gap-1 text-xs font-mono ${!c ? 'text-slate-500' : c.ok ? 'text-emerald-300' : 'text-rose-300'}`} data-ok={c ? String(c.ok) : ''} title={`${s.check.var} should be ${s.check.equals}`}>
                        {!c ? <CircleDashed className="w-3.5 h-3.5" /> : c.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                        {s.check.var.split('.').pop()} {c ? (c.error ? c.error : String(c.value)) : '…'}
                      </span>
                    )}
                  </span>
                  {isNow && canRun && (
                    <span className="flex gap-1 shrink-0">
                      <button type="button" onClick={() => step(i, false)} className={`recovery-done px-3 py-1 rounded text-white text-sm ${c && !c.ok ? 'bg-amber-700 hover:bg-amber-600' : 'bg-emerald-700 hover:bg-emerald-600'}`} title={c && !c.ok ? 'Its check does not pass yet' : undefined}>
                        Done
                      </button>
                      <button type="button" onClick={() => step(i, true)} className="recovery-skip px-2 py-1 rounded border border-slate-600 text-sm hover:bg-slate-800">
                        Skip
                      </button>
                    </span>
                  )}
                  {done && <span className="text-xs text-slate-500">{done.skipped ? 'skipped' : '✓'}</span>}
                </li>
              );
            })}
          </ol>
        )}
        {guide && !editing && (
          <div className="flex flex-wrap items-center gap-2">
            {!run && canRun && (
              <button id="recovery-begin" type="button" onClick={() => void begin()} className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold">
                Begin
              </button>
            )}
            {run && !run.endedAt && (
              <>
                <span className="text-sm text-slate-400 font-mono">{formatDuration(Date.now() - started)}</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note (what you found)" className="flex-1 min-w-[10rem] rounded bg-slate-950 border border-slate-700 px-2 py-1 text-sm select-text" />
                <button id="recovery-recovered" type="button" disabled={current >= 0} onClick={() => void end('recovered')} className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40" title={current >= 0 ? 'Every step first' : undefined}>
                  Recovered
                </button>
                <button id="recovery-called" type="button" onClick={() => void end('called')} className="flex items-center gap-1 px-3 py-1.5 rounded bg-rose-700 hover:bg-rose-600 text-white">
                  <Megaphone className="w-4 h-4" /> Still down{canCall ? ': call maintenance' : ''}
                </button>
                <button type="button" onClick={() => void end('stopped')} className="px-3 py-1.5 rounded border border-slate-600 hover:bg-slate-800 text-sm">
                  Stop
                </button>
              </>
            )}
            {canEdit && !run && (
              <button id="recovery-edit" type="button" onClick={() => setEditing(true)} className="ml-auto flex items-center gap-1 px-2 py-1 rounded border border-slate-600 text-sm hover:bg-slate-800">
                <Pencil className="w-3.5 h-3.5" /> Edit the guide
              </button>
            )}
          </div>
        )}
        {msg && (
          <div id="recovery-msg" className={msg.ok ? 'text-emerald-300' : 'text-rose-300'}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
