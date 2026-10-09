import React, { useMemo, useState } from 'react';
import { GitCompare, X } from 'lucide-react';
import { parseRecording } from '../utils/liveRecording.ts';
import { comparisonFileName, comparisonText, parseComparison } from '../utils/liveComparison.ts';
import { EMPTY_LIVE_SESSION, applyLiveSamples, formatDuration, type LiveTransition } from '../utils/liveView.ts';
import { stateTimes } from '../utils/stateTimes.ts';
import type { EdgeInfo } from '../types.ts';

/**
 * Compare two recordings (e.g. a good cycle and a bad one): per state the stays and the average time in A and in B,
 * and the transitions only one of them took. A: this session or a file; B: a file (saved recordings), or another PLC
 * live on the same POU (Compare…: its session as it goes)
 */

interface Side {
  label: string;
  transitions: LiveTransition[];
}

interface Props {
  onClose: () => void;
  /** This session (live or replayed), when it has transitions */
  current: Side | null;
  /** Another PLC live on the same POU: B, kept current */
  other?: Side | null;
  names: Map<number, string>;
  edges: EdgeInfo[];
  /** The POU (the saved comparison's name and contents) */
  pouName?: string;
}

export const CompareRecordingsDialog: React.FC<Props> = ({ onClose, current, other, names, edges, pouName }) => {
  // (a file chosen, else this session / the other PLC as they go)
  const [aFile, setA] = useState<Side | null>(null);
  const [bFile, setB] = useState<Side | null>(null);
  const a = aFile ?? current;
  const b = bFile ?? other ?? null;
  const [error, setError] = useState('');

  const [saved, setSaved] = useState('');
  const load = async (file: File, set: (s: Side) => void) => {
    const text = await file.text();
    // (a saved comparison: both sides)
    const cmp = parseComparison(text);
    if (cmp && 'error' in cmp) return setError(`${file.name}: ${cmp.error}`);
    if (cmp) {
      setError('');
      setA(cmp.a);
      setB(cmp.b);
      return;
    }
    const rec = parseRecording(text);
    if ('error' in rec) return setError(`${file.name}: ${rec.error}`);
    setError('');
    set({ label: file.name, transitions: applyLiveSamples(EMPTY_LIVE_SESSION, rec.values, names, edges).transitions });
  };

  const rows = useMemo(() => {
    if (!a || !b) return [];
    const ta = new Map(stateTimes(a.transitions).map((t) => [t.state, t]));
    const tb = new Map(stateTimes(b.transitions).map((t) => [t.state, t]));
    return [...new Set([...ta.keys(), ...tb.keys()])]
      .map((state) => {
        const x = ta.get(state);
        const y = tb.get(state);
        const change = x && y && x.avgMs > 0 ? (y.avgMs - x.avgMs) / x.avgMs : null;
        return { state, a: x, b: y, change };
      })
      .sort((p, q) => Math.abs(q.change ?? (q.a && q.b ? 0 : 9)) - Math.abs(p.change ?? (p.a && p.b ? 0 : 9)));
  }, [a, b]);
  const transitionDiff = useMemo(() => {
    if (!a || !b) return { onlyA: [], onlyB: [] };
    const count = (s: Side) => {
      const m = new Map<string, number>();
      for (const t of s.transitions) m.set(`${t.from} → ${t.to}`, (m.get(`${t.from} → ${t.to}`) ?? 0) + 1);
      return m;
    };
    const ca = count(a);
    const cb = count(b);
    return { onlyA: [...ca.entries()].filter(([k]) => !cb.has(k)), onlyB: [...cb.entries()].filter(([k]) => !ca.has(k)) };
  }, [a, b]);

  const picker = (id: string, set: (s: Side) => void) => (
    <input
      id={id}
      type="file"
      accept=".json,application/json"
      className="text-[11px] text-slate-400 file:mr-2 file:px-2 file:py-0.5 file:rounded file:border file:border-slate-700 file:bg-slate-900 file:text-slate-200"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) void load(f, set);
      }}
    />
  );

  return (
    <div id="compare-overlay" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="compare-dialog" className="w-[46rem] max-w-[95vw] rounded-lg border border-slate-700 bg-slate-900 shadow-xl text-xs text-slate-200">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
          <GitCompare className="w-4 h-4 text-sky-300" />
          <span className="font-semibold">{other ? 'Compare PLCs' : 'Compare recordings'}</span>
          <button className="ml-auto p-1 rounded hover:bg-slate-800" onClick={onClose} title="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-3 space-y-2">
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 items-center">
            <span className="text-slate-400">A</span>
            <div className="flex items-center gap-2 min-w-0">
              <span id="compare-a" className="truncate font-mono text-sky-300">{a ? `${a.label} (${a.transitions.length} transitions)` : '—'}</span>
              {current && aFile && (
                <button className="px-1.5 rounded border border-slate-700 hover:bg-slate-800" onClick={() => setA(null)}>
                  this session
                </button>
              )}
              {picker('compare-file-a', setA)}
            </div>
            <span className="text-slate-400">B</span>
            <div className="flex items-center gap-2 min-w-0">
              <span id="compare-b" className="truncate font-mono text-amber-300">{b ? `${b.label} (${b.transitions.length} transitions)` : 'choose a recording'}</span>
              {other && bFile && (
                <button className="px-1.5 rounded border border-slate-700 hover:bg-slate-800" onClick={() => setB(null)}>
                  {other.label}
                </button>
              )}
              {picker('compare-file-b', setB)}
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span>Open a saved comparison</span>
            {picker('compare-open-file', () => {})}
            {a && b && (
              <button
                id="compare-save"
                className="ml-auto px-2 py-0.5 rounded border border-slate-700 text-slate-200 hover:bg-slate-800"
                title="Both sides in one file (their transitions as compared now), to open again here or share"
                onClick={() => {
                  const name = comparisonFileName(a, b, pouName);
                  void import('../utils/projectFiles.ts').then(({ saveDocument }) => saveDocument(name, comparisonText(a, b, pouName))).then((r) => {
                    if (r?.error) setError(r.error);
                    else if (!r?.canceled) setSaved(r?.path ?? name);
                  });
                }}
              >
                Save comparison…
              </button>
            )}
            {saved && <span id="compare-saved" className="text-emerald-300 truncate">{saved}</span>}
          </div>
          {error && <div className="text-rose-300">{error}</div>}
          {a && b && (
            <>
              <div className="max-h-72 overflow-y-auto rounded border border-slate-800">
                <table id="compare-table" className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr className="text-slate-500 text-left">
                      <th className="font-normal px-2 py-1">State</th>
                      <th className="font-normal text-right text-sky-400">A stays</th>
                      <th className="font-normal text-right text-sky-400">A average</th>
                      <th className="font-normal text-right text-amber-400">B stays</th>
                      <th className="font-normal text-right text-amber-400">B average</th>
                      <th className="font-normal text-right px-2">B against A</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const big = r.change !== null && Math.abs(r.change) > 0.25;
                      return (
                        <tr key={r.state} className={`compare-row border-t border-slate-800 ${big ? 'bg-rose-950/30' : ''}`} data-state={r.state}>
                          <td className="px-2 py-0.5 font-mono text-slate-200">{r.state}</td>
                          <td className="text-right font-mono text-slate-400">{r.a?.n ?? '—'}</td>
                          <td className="text-right font-mono">{r.a ? formatDuration(r.a.avgMs) : '—'}</td>
                          <td className="text-right font-mono text-slate-400">{r.b?.n ?? '—'}</td>
                          <td className="text-right font-mono">{r.b ? formatDuration(r.b.avgMs) : '—'}</td>
                          <td className={`compare-change text-right font-mono px-2 ${big ? 'text-rose-300 font-bold' : 'text-slate-400'}`}>
                            {r.change === null ? (r.a ? 'only A' : 'only B') : `${r.change > 0 ? '+' : ''}${Math.round(r.change * 100)}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div id="compare-only-a" className="rounded border border-slate-800 p-2">
                  <div className="text-sky-400 mb-1">Only in A</div>
                  {transitionDiff.onlyA.length ? transitionDiff.onlyA.map(([k, n]) => <div key={k} className="font-mono">{k} ({n}×)</div>) : <div className="text-slate-500">none</div>}
                </div>
                <div id="compare-only-b" className="rounded border border-slate-800 p-2">
                  <div className="text-amber-400 mb-1">Only in B</div>
                  {transitionDiff.onlyB.length ? transitionDiff.onlyB.map(([k, n]) => <div key={k} className="font-mono">{k} ({n}×)</div>) : <div className="text-slate-500">none</div>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
