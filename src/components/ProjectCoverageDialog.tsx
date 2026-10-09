import React, { useEffect } from 'react';
import { ListChecks, X } from 'lucide-react';
import type { ProjectCoverage } from '../utils/projectCoverage.ts';

/**
 * The coverage of every state machine of the PLC project (commissioning sign-off): each POU's transitions taken by
 * its PLC (as seen in this app, since its coverage reset if any), the least covered first; the whole; its CSVs
 */
export const ProjectCoverageDialog: React.FC<{
  data: ProjectCoverage;
  onClose: () => void;
  onExportSummary: () => void;
  onExportTransitions: () => void;
  /** The printable sign-off report (HTML) */
  onReport?: () => void;
  /** The report printed at once (the system's print dialog) */
  onPrint?: () => void;
  /** Open that POU here (its coverage in its Live tab) */
  onOpenPou?: (name: string) => void;
}> = ({ data, onClose, onExportSummary, onExportTransitions, onOpenPou, onReport, onPrint }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const pct = (taken: number, total: number) => (total ? Math.round((taken / total) * 100) : 0);
  const rows = [...data.pous].sort((a, b) => pct(a.coverage.taken, a.coverage.total) - pct(b.coverage.taken, b.coverage.total) || a.name.localeCompare(b.name));
  return (
    <div id="project-coverage-overlay" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="project-coverage-dialog" className="w-[44rem] max-w-[95vw] rounded-lg border border-slate-700 bg-slate-900 shadow-xl text-xs text-slate-200" data-taken={data.taken} data-total={data.total}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
          <ListChecks className="w-4 h-4 text-emerald-300" />
          <span className="font-semibold">Coverage of {data.project}'s state machines</span>
          <span className="text-slate-400">
            {data.taken} / {data.total} transitions taken ({pct(data.taken, data.total)}%)
          </span>
          <button className="ml-auto p-1 rounded hover:bg-slate-800" onClick={onClose} title="Close (Esc)">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-3 space-y-2">
          <div className="text-[11px] text-slate-400">
            The transitions each PLC took while this app followed it live (or replayed a recording), since that POU's coverage reset if any. A POU never followed here shows none taken.
          </div>
          <div className="max-h-[26rem] overflow-y-auto rounded border border-slate-800">
            <table id="project-coverage-table" className="w-full text-[11px]">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="text-slate-500 text-left">
                  <th className="font-normal px-2 py-1">State machine</th>
                  <th className="font-normal text-right">Taken</th>
                  <th className="font-normal px-2 w-40">Coverage</th>
                  <th className="font-normal">Since</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const v = pct(p.coverage.taken, p.coverage.total);
                  return (
                    <tr key={p.path ?? p.name} className="project-coverage-row border-t border-slate-800" data-pou={p.name} data-taken={p.coverage.taken} data-total={p.coverage.total}>
                      <td className="px-2 py-0.5 font-mono">
                        {onOpenPou ? (
                          <button className="text-sky-300 hover:underline" onClick={() => onOpenPou(p.name)} title={`Open ${p.name} here`}>
                            {p.name}
                          </button>
                        ) : (
                          <span className="text-slate-200">{p.name}</span>
                        )}
                        {p.error && <span className="ml-1 text-rose-300" title={p.error}>(no chart)</span>}
                      </td>
                      <td className="text-right font-mono text-slate-300">
                        {p.coverage.taken} / {p.coverage.total}
                      </td>
                      <td className="px-2">
                        <div className="flex items-center gap-1.5">
                          <span className="flex-1 h-1.5 rounded bg-slate-800 overflow-hidden">
                            <span className={`block h-full ${v === 100 ? 'bg-emerald-500' : v >= 50 ? 'bg-sky-600' : 'bg-amber-600'}`} style={{ width: `${v}%` }} />
                          </span>
                          <span className="w-9 text-right font-mono text-slate-400">{v}%</span>
                        </div>
                      </td>
                      <td className="text-slate-500">{p.coverage.since ? new Date(p.coverage.since).toLocaleDateString() : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            {onReport && (
              <button id="project-coverage-report" className={`${onPrint ? '' : 'mr-auto '}px-2 py-0.5 rounded border border-emerald-700 text-emerald-200 hover:bg-slate-800`} onClick={onReport} title="A printable report for commissioning sign-off: the coverage of each state machine, the transitions never taken, lines to sign (HTML)">
                Sign-off report…
              </button>
            )}
            {onPrint && (
              <button id="project-coverage-print" className="mr-auto px-2 py-0.5 rounded border border-emerald-700 text-emerald-200 hover:bg-slate-800" onClick={onPrint} title="The sign-off report printed at once (the print dialog: a printer, or Save as PDF)">
                Print…
              </button>
            )}
            <button id="project-coverage-csv" className="px-2 py-0.5 rounded border border-slate-700 hover:bg-slate-800" onClick={onExportSummary} title="One row per state machine (CSV)">
              CSV
            </button>
            <button id="project-coverage-all-csv" className="px-2 py-0.5 rounded border border-slate-700 hover:bg-slate-800" onClick={onExportTransitions} title="Every transition of every state machine: how often and when it was taken (CSV)">
              Every transition (CSV)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
