import React, { useState } from 'react';
import type { GatewayConnection } from '../utils/liveGateway.ts';

/** A change of a PLC's program (gateway/changes.cjs) */
export interface PlcChange {
  id: string;
  at: number;
  plc: string;
  plcName: string;
  kind: string;
  project: string;
  files: string[];
  fileCount: number;
  /** What its count counts: the files of a program, a drive's settings */
  unit?: 'file' | 'setting';
  reason: string;
  workOrder: string | null;
  explainedBy: string | null;
  explainedAt: number | null;
  approvedBy: string | null;
  approvedAt: number | null;
}

const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * The Risk page's Changes: each change of a PLC's program the gateway saw (a download, an online change, the files),
 * to explain (why, its work order: engineers) and approve (supervisors, another engineer); the ones open first
 */
export const ChangesList: React.FC<{ conn: GatewayConnection | null; changes: PlcChange[]; canExplain: boolean; canApprove: boolean }> = ({ conn, changes, canExplain, canApprove }) => {
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [order, setOrder] = useState('');
  const [error, setError] = useState('');
  type R = { ok: boolean; error?: string; message?: string };
  const ask = async (m: Record<string, unknown>) => {
    setError('');
    const r: R | undefined = await conn?.request<R>(m, 'changeResult', 15000).catch((e: unknown): R => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!r?.ok) setError(r?.error ?? r?.message ?? 'Not done');
    return !!r?.ok;
  };
  const stateOf = (c: PlcChange) => (c.approvedBy ? 'approved' : c.explainedBy ? 'to approve' : 'to explain');
  const shown = [...changes].sort((a, b) => Number(!!a.approvedBy) - Number(!!b.approvedBy) || b.at - a.at);
  return (
    <div id="plc-changes" className="space-y-1.5 text-sm">
      <p className="text-xs text-slate-400">Each change of a PLC's program the gateway saw (its project copy: Monitoring on the setup page), and of a drive's settings (read once a day): explained by an engineer (why, its work order), then approved by a supervisor or another engineer.</p>
      {error && <div className="text-rose-300">{error}</div>}
      {!changes.length && <div className="text-slate-400">No change seen yet.</div>}
      {shown.map((c) => {
        const st = stateOf(c);
        return (
          <div key={c.id} className="plc-change rounded border border-slate-800 bg-slate-900" data-state={st}>
            <button type="button" className="w-full text-left flex flex-wrap items-center gap-2 px-3 py-1.5 hover:bg-slate-800/60" onClick={() => { setOpen(open === c.id ? null : c.id); setReason(c.reason); setOrder(c.workOrder ?? ''); }}>
              <span className={`shrink-0 px-2 rounded-full text-xs font-semibold ${st === 'approved' ? 'bg-emerald-900 text-emerald-200' : st === 'to approve' ? 'bg-sky-700 text-white' : 'bg-amber-500 text-slate-950'}`}>{st}</span>
              <span className="font-semibold">{c.plcName}</span>
              <span className="text-slate-300">{c.kind}{c.unit === 'setting' && c.project ? `: ${c.project}` : ''}{c.fileCount ? `, ${c.fileCount} ${c.unit ?? 'file'}${c.fileCount === 1 ? '' : 's'}` : ''}</span>
              <span className="text-xs text-slate-500">{when(c.at)}</span>
              {c.reason && <span className="truncate text-xs text-slate-400">· {c.reason}</span>}
            </button>
            {open === c.id && (
              <div className="px-3 pb-2 space-y-2">
                {c.files.length > 0 && <pre className="max-h-40 overflow-auto rounded bg-slate-950 p-2 text-[11px] text-slate-300">{c.files.join('\n')}</pre>}
                {c.explainedBy && (
                  <div className="text-xs text-slate-400">
                    Explained by {c.explainedBy} {c.explainedAt ? when(c.explainedAt) : ''}{c.workOrder ? ` · work order #${c.workOrder}` : ''}
                    {c.approvedBy ? ` · approved by ${c.approvedBy} ${c.approvedAt ? when(c.approvedAt) : ''}` : ''}
                  </div>
                )}
                {!c.approvedBy && canExplain && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input className="change-reason flex-1 min-w-[14rem] bg-slate-950 border border-slate-700 rounded px-2 py-1 select-text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why: what was changed and why (the clamp timeout 2 s to 3 s, the jams at the infeed)" />
                    <input className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1" value={order} onChange={(e) => setOrder(e.target.value)} placeholder="work order #" />
                    <button type="button" className="change-explain px-3 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white" onClick={() => void ask({ type: 'changeExplain', id: c.id, reason, workOrder: order })}>
                      Explain
                    </button>
                  </div>
                )}
                {!c.approvedBy && c.explainedBy && canApprove && (
                  <button type="button" className="change-approve px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white" onClick={() => void ask({ type: 'changeApprove', id: c.id })}>
                    Approve
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
