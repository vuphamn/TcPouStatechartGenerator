import React, { useState } from 'react';
import { BellRing, CircleDot, Trash2, X } from 'lucide-react';

/** A recording or an alarm as the board shows it (gateway: boardRules) */
export interface BoardRule {
  id: string;
  name: string;
  enabled: boolean;
  plc: string;
  root: string;
  /** Its own machines (chosen on the board); null: every one under its root */
  machines: string[] | null;
  vars?: string[];
  days?: number;
  stuckAfterMs?: number | null;
  onError?: boolean;
  webhook?: boolean;
  fromBoard: { by: string; at: string } | null;
}

export interface BoardRules {
  alarms: BoardRule[];
  recordings: BoardRule[];
}

/** The chosen machines and signals of one PLC */
export interface RuleGroup {
  plc: string;
  plcName: string;
  machines: string[];
  signals: string[];
}

/** The fields sent for one PLC (gateway: boardRuleSave) */
export type RuleDraft = Record<string, unknown> & { name: string; plc: string; root: string };

/**
 * An alarm (stuck after a time, in an error state; the gateway's alerts, the board's chime, a webhook if given) or a
 * recording (kept for some days; the board plays it back, the I/O page charts its signals) for the machines or signals
 * chosen on the board: one per PLC. The ones already covering them are listed; those made on the board can be removed
 * here (the setup page's own, there).
 */
export const BoardRuleDialog: React.FC<{
  kind: 'alarm' | 'recording';
  groups: RuleGroup[];
  root: string;
  existing: BoardRule[];
  canEdit: boolean;
  onSave: (drafts: RuleDraft[]) => Promise<string | null>;
  onDelete: (rule: BoardRule) => Promise<string | null>;
  onClose: () => void;
}> = ({ kind, groups, root, existing, canEdit, onSave, onDelete, onClose }) => {
  const machines = groups.reduce((n, g) => n + g.machines.length, 0);
  const signals = groups.reduce((n, g) => n + g.signals.length, 0);
  const what = [machines ? `${machines} machine${machines === 1 ? '' : 's'}` : '', signals ? `${signals} signal${signals === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
  const [name, setName] = useState(kind === 'alarm' ? `Alarm: ${what}` : `Recording: ${what}`);
  const [stuckSec, setStuckSec] = useState('300');
  const [onError, setOnError] = useState(true);
  const [recovery, setRecovery] = useState(true);
  const [webhook, setWebhook] = useState('');
  const [format, setFormat] = useState('teams');
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    const drafts: RuleDraft[] = groups
      .filter((g) => g.machines.length || g.signals.length)
      .map((g) => {
        const own = groups.length > 1 ? `${name.trim()} (${g.plcName})` : name.trim();
        if (kind === 'alarm') {
          const s = stuckSec.trim() ? Number(stuckSec) : null;
          return { name: own, plc: g.plc, root, machines: g.machines, stuckAfterMs: s ? Math.round(s * 1000) : null, onError, notifyRecovery: recovery, webhook: webhook.trim(), format };
        }
        return { name: own, plc: g.plc, root, machines: g.machines, vars: g.signals, days: Number(days) || 7 };
      });
    if (kind === 'alarm' && !stuckSec.trim() && !onError) return setError('Alarm on something: stuck after a time, or an error state');
    if (kind === 'alarm' && stuckSec.trim() && !(Number(stuckSec) >= 1)) return setError('"Stuck after" is at least 1 second');
    if (kind === 'alarm' && !machines) return setError('Choose the machines to alarm on');
    setBusy(true);
    const err = await onSave(drafts);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };
  const Icon = kind === 'alarm' ? BellRing : CircleDot;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        id={`board-${kind}-dialog`}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 text-sm text-slate-200 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
          <Icon className={`w-5 h-5 ${kind === 'alarm' ? 'text-amber-300' : 'text-rose-300'}`} />
          <span className="font-semibold text-base">{kind === 'alarm' ? 'Alarm' : 'Record'} {what}</span>
          <button type="button" onClick={onClose} className="ml-auto p-1 rounded hover:bg-slate-800" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div className="max-h-28 overflow-y-auto rounded border border-slate-800 bg-slate-950/60 px-2 py-1 font-mono text-xs text-slate-400">
            {groups.map((g) => (
              <div key={g.plc}>
                <span className="text-slate-200">{g.plcName}</span>: {[...g.machines, ...g.signals].join(', ')}
              </div>
            ))}
          </div>
          {canEdit ? (
            <>
              <label className="flex flex-col gap-1">
                Name
                <input id="board-rule-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={70} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 select-text" />
              </label>
              {kind === 'alarm' ? (
                <>
                  <label className="flex items-center gap-2">
                    Stuck after
                    <input id="board-rule-stuck" type="number" min="1" value={stuckSec} onChange={(e) => setStuckSec(e.target.value)} placeholder="off" className="w-24 bg-slate-950 border border-slate-700 rounded px-2 py-1" />
                    seconds in a state (empty: off)
                  </label>
                  <label className="flex items-center gap-2">
                    <input id="board-rule-error" type="checkbox" checked={onError} onChange={(e) => setOnError(e.target.checked)} /> When one goes into an error state (ERROR, FAULT, ALARM, E-STOP, ABORT in its name)
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={recovery} onChange={(e) => setRecovery(e.target.checked)} /> Say when it recovers
                  </label>
                  <label className="flex flex-col gap-1">
                    Webhook (optional: Teams, Slack or JSON; empty: the board and the alert history only)
                    <span className="flex gap-2">
                      <input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://…" className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono select-text" />
                      <select value={format} onChange={(e) => setFormat(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2 py-1">
                        <option value="teams">Teams</option>
                        <option value="slack">Slack</option>
                        <option value="json">JSON</option>
                      </select>
                    </span>
                  </label>
                </>
              ) : (
                <label className="flex items-center gap-2">
                  Keep
                  <input id="board-rule-days" type="number" min="1" max="366" value={days} onChange={(e) => setDays(e.target.value)} className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1" />
                  days (every change, recorded by the gateway all day)
                </label>
              )}
              <div className="text-xs text-slate-500">Saved on the gateway (its setup page lists it too): {kind === 'alarm' ? 'its alerts reach every board, with the chime, and its webhook.' : 'the board plays it back (Play back), the I/O page charts its signals back in time.'}</div>
            </>
          ) : (
            <div className="text-amber-200">You may not add {kind === 'alarm' ? 'alarms' : 'recordings'} from the board (the gateway's boardEditors, or a display). Ask whoever runs the gateway.</div>
          )}
          {existing.length > 0 && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Already {kind === 'alarm' ? 'alarmed' : 'recorded'} by</div>
              <ul className="space-y-1">
                {existing.map((r) => (
                  <li key={r.id} className="board-rule-existing flex items-center gap-2 rounded border border-slate-800 px-2 py-1" data-rule-id={r.id}>
                    <span className="flex-1 min-w-0 truncate">
                      {r.name}
                      <span className="text-xs text-slate-500"> · {r.machines ? `${r.machines.length} machines` : `all under ${r.root}`}{r.vars?.length ? `, ${r.vars.length} signals` : ''}{r.fromBoard ? ` · by ${r.fromBoard.by} on the board` : ' · the setup page'}{r.enabled ? '' : ' · off'}</span>
                    </span>
                    {canEdit && r.fromBoard && (
                      <button
                        type="button"
                        className="board-rule-remove p-1 rounded text-slate-400 hover:text-rose-300"
                        title="Remove it (for everyone)"
                        onClick={() => {
                          if (window.confirm(`Remove "${r.name}"?${kind === 'recording' ? ' What it recorded stays on the gateway until its days are over.' : ''}`)) void onDelete(r).then((e) => e && setError(e));
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <div id="board-rule-error-text" className="text-rose-300">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-800">
          <button type="button" onClick={onClose} className="px-3 py-1 rounded border border-slate-700 hover:bg-slate-800">
            {canEdit ? 'Cancel' : 'Close'}
          </button>
          {canEdit && (
            <button id="board-rule-save" disabled={busy} className={`px-3 py-1 rounded text-white ${kind === 'alarm' ? 'bg-amber-700 hover:bg-amber-600' : 'bg-rose-700 hover:bg-rose-600'} disabled:opacity-50`}>
              {kind === 'alarm' ? 'Add the alarm' : 'Start recording'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
