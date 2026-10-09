import React, { useEffect, useState } from 'react';
import { ClipboardCheck, X } from 'lucide-react';

/**
 * The XAE extension's features checked in one sitting, inside XAE (after installing a new VSIX): each check runs what
 * it can by itself (an answer read from the extension) or says what to do, and is marked passed / failed / skipped;
 * the results kept in this browser with when, and copied as text to send back
 */
export interface XaeCheck {
  id: string;
  title: string;
  /** What to do, what to look for */
  how: string;
  /** Read by itself: ok true / false, or null (not possible now: say why) */
  run?: () => Promise<{ ok: boolean | null; detail: string }>;
  /** A button doing the thing to look at (then marked by hand) */
  action?: { label: string; run: () => void };
}

type Mark = { result: 'pass' | 'fail' | 'skip'; detail?: string; at: number };
const KEY = 'kss.xaeChecks';

const load = (): Record<string, Mark> => {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, Mark>;
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
};

export const XaeChecksDialog: React.FC<{ checks: XaeCheck[]; about: string; onClose: () => void; onCopy: (text: string) => void }> = ({ checks, about, onClose, onCopy }) => {
  const [marks, setMarks] = useState<Record<string, Mark>>(load);
  const [running, setRunning] = useState<string | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(marks));
    } catch {
      // per-viewer convenience only
    }
  }, [marks]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const mark = (id: string, result: Mark['result'], detail?: string) => setMarks((m) => ({ ...m, [id]: { result, detail: detail ?? m[id]?.detail, at: Date.now() } }));
  const run = async (c: XaeCheck) => {
    if (!c.run) return;
    setRunning(c.id);
    try {
      const r = await c.run();
      if (r.ok === null) setMarks((m) => ({ ...m, [c.id]: { result: 'skip', detail: r.detail, at: Date.now() } }));
      else mark(c.id, r.ok ? 'pass' : 'fail', r.detail);
    } catch (e) {
      mark(c.id, 'fail', e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  };
  const runAll = async () => {
    for (const c of checks) if (c.run) await run(c);
  };
  const text = () =>
    [`Kval MachineScope: XAE checks (${about}), ${new Date().toLocaleString()}`, ...checks.map((c) => `[${(marks[c.id]?.result ?? 'not run').toUpperCase()}] ${c.title}${marks[c.id]?.detail ? `: ${marks[c.id]!.detail}` : ''}`)].join('\n');
  const passed = checks.filter((c) => marks[c.id]?.result === 'pass').length;
  return (
    <div id="xae-checks-overlay" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="xae-checks-dialog" className="w-[46rem] max-w-[95vw] rounded-lg border border-slate-700 bg-slate-900 shadow-xl text-xs text-slate-200">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
          <ClipboardCheck className="w-4 h-4 text-emerald-300" />
          <span className="font-semibold">XAE checks</span>
          <span className="text-slate-400">
            {passed} / {checks.length} passed · {about}
          </span>
          <button className="ml-auto p-1 rounded hover:bg-slate-800" onClick={onClose} title="Close (Esc)">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-3 space-y-1.5 max-h-[70vh] overflow-y-auto">
          {checks.map((c) => {
            const m = marks[c.id];
            return (
              <div key={c.id} className="xae-check rounded border border-slate-800 p-2" data-check={c.id} data-result={m?.result ?? ''}>
                <div className="flex items-center gap-2">
                  <span className={`w-12 shrink-0 text-center rounded text-[10px] font-bold ${m?.result === 'pass' ? 'bg-emerald-600 text-white' : m?.result === 'fail' ? 'bg-rose-600 text-white' : m?.result === 'skip' ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                    {m?.result ? m.result.toUpperCase() : '—'}
                  </span>
                  <span className="font-semibold text-slate-100">{c.title}</span>
                  <span className="ml-auto flex items-center gap-1 shrink-0">
                    {c.run && (
                      <button className="xae-check-run px-1.5 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-40" disabled={running !== null} onClick={() => void run(c)}>
                        {running === c.id ? 'Checking…' : 'Check'}
                      </button>
                    )}
                    {c.action && (
                      <button className="xae-check-action px-1.5 rounded border border-sky-700 text-sky-200 hover:bg-slate-800" onClick={c.action.run}>
                        {c.action.label}
                      </button>
                    )}
                    <button className="xae-check-pass px-1.5 rounded border border-emerald-800 text-emerald-300 hover:bg-slate-800" onClick={() => mark(c.id, 'pass')} title="It works">
                      ✓
                    </button>
                    <button className="xae-check-fail px-1.5 rounded border border-rose-800 text-rose-300 hover:bg-slate-800" onClick={() => mark(c.id, 'fail')} title="It does not">
                      ✗
                    </button>
                  </span>
                </div>
                <div className="mt-1 text-slate-400">{c.how}</div>
                {m?.detail && <div className="xae-check-detail mt-0.5 font-mono text-[11px] text-slate-300 break-words">{m.detail}</div>}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-800">
          <button id="xae-checks-run-all" className="px-2 py-0.5 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-40" disabled={running !== null} onClick={() => void runAll()} title="Every check that reads by itself">
            Check all
          </button>
          <button id="xae-checks-reset" className="px-2 py-0.5 rounded border border-slate-700 hover:bg-slate-800" onClick={() => setMarks({})}>
            Clear
          </button>
          <button id="xae-checks-copy" className="ml-auto px-2 py-0.5 rounded border border-emerald-700 text-emerald-200 hover:bg-slate-800" onClick={() => onCopy(text())} title="The results as text (to send back)">
            Copy results
          </button>
        </div>
      </div>
    </div>
  );
};
