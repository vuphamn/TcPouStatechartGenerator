import React, { useEffect, useRef, useState } from 'react';
import { Columns2, Loader2, Save, X } from 'lucide-react';
import { generateStatechart } from '../generator.ts';
import type { ChartDiff } from '../utils/chartDiff.ts';

/**
 * Review and save: the diagram as saved and as edited, side by side, the changes marked (added states green,
 * changed amber, removed red) and listed; Save from here. (Save itself still saves at once.)
 */

interface Props {
  before: { pou: string; dut: string };
  after: { pou: string; dut: string };
  diff: ChartDiff;
  savedLabel: string;
  onSave: () => void;
  onClose: () => void;
}

/** The state's id in a node's element id (flowchart-<id>-<n>, state-<id>-<n>) */
const nodeState = (el: Element) => /^(?:flowchart|state)-(.+)-\d+$/.exec(el.id)?.[1] ?? el.getAttribute('data-id') ?? '';

async function render(code: string, mark: Record<string, string>): Promise<string> {
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict', flowchart: { useMaxWidth: true, htmlLabels: true }, state: { useMaxWidth: true } });
  const { svg } = await mermaid.render(`review-${Math.random().toString(36).slice(2, 9)}`, code);
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  for (const g of doc.querySelectorAll('g.node')) {
    const cls = mark[nodeState(g)];
    if (cls) g.setAttribute('class', `${g.getAttribute('class') ?? ''} ${cls}`);
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export const BeforeAfterDialog: React.FC<Props> = ({ before, after, diff, savedLabel, onSave, onClose }) => {
  const [svgs, setSvgs] = useState<{ before: string; after: string } | null>(null);
  const [error, setError] = useState('');
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void (async () => {
      try {
        // (a changed transition: the states at its ends marked too, so it can be found in a big diagram)
        const ends = (list: { from: string; to: string }[]) => list.flatMap((t) => [t.from, t.to]).map((s) => [s, 'review-changed'] as const);
        const markBefore = Object.fromEntries([...ends([...diff.transitionsRemoved, ...diff.guardsChanged]), ...diff.statesRemoved.map((s) => [s, 'review-removed'] as const)]);
        const markAfter = Object.fromEntries([...ends([...diff.transitionsAdded, ...diff.guardsChanged]), ...diff.statesChanged.map((s) => [s, 'review-changed'] as const), ...diff.statesAdded.map((s) => [s, 'review-added'] as const)]);
        setSvgs({ before: await render(generateStatechart(before.dut, before.pou, {}), markBefore), after: await render(generateStatechart(after.dut, after.pou, {}), markAfter) });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [before, after, diff]);

  const lines = [
    ...diff.statesAdded.map((s) => ({ cls: 'text-emerald-300', t: `+ state ${s}` })),
    ...diff.statesRemoved.map((s) => ({ cls: 'text-rose-300', t: `− state ${s}` })),
    ...diff.statesChanged.map((s) => ({ cls: 'text-amber-300', t: `~ state ${s} (its code)` })),
    ...diff.transitionsAdded.map((t) => ({ cls: 'text-emerald-300', t: `+ ${t.from} → ${t.to}${t.guard ? `  [${t.guard}]` : ''}` })),
    ...diff.transitionsRemoved.map((t) => ({ cls: 'text-rose-300', t: `− ${t.from} → ${t.to}${t.guard ? `  [${t.guard}]` : ''}` })),
    ...diff.guardsChanged.map((t) => ({ cls: 'text-amber-300', t: `~ ${t.from} → ${t.to}: ${t.before.join(' | ')}  ⟶  ${t.after.join(' | ')}` })),
  ];

  return (
    <div id="review-overlay" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="review-dialog" className="w-[92vw] h-[88vh] flex flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-xl text-xs text-slate-200">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
          <Columns2 className="w-4 h-4 text-sky-300" />
          <span className="font-semibold">Review the changes</span>
          <span className="text-slate-400">({diff.total} change{diff.total === 1 ? '' : 's'} against the version {savedLabel})</span>
          <button className="ml-auto p-1 rounded hover:bg-slate-800" onClick={onClose} title="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 grid grid-cols-2 gap-px bg-slate-800">
          {(['before', 'after'] as const).map((side) => (
            <div key={side} className="flex flex-col min-h-0 bg-slate-950">
              <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-800">{side === 'before' ? `Before (${savedLabel})` : 'After (edited)'}</div>
              <div id={`review-${side}`} className="review-svg flex-1 min-h-0 overflow-auto p-2">
                {svgs ? <div dangerouslySetInnerHTML={{ __html: svgs[side] }} /> : error ? <div className="text-rose-300">{error}</div> : <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
              </div>
            </div>
          ))}
        </div>
        <div id="review-list" className="max-h-40 overflow-y-auto px-3 py-2 border-t border-slate-800 font-mono text-[11px] space-y-0.5">
          {lines.length ? lines.map((l, i) => <div key={i} className={l.cls}>{l.t}</div>) : <div className="text-slate-500">No changes to the states or transitions (other code may have changed).</div>}
        </div>
        <div className="flex justify-end gap-2 px-3 py-2 border-t border-slate-800">
          <button className="px-3 py-1 rounded border border-slate-700 hover:bg-slate-800" onClick={onClose}>
            Keep editing
          </button>
          <button
            id="review-save"
            onClick={() => {
              onClose();
              onSave();
            }}
            className="flex items-center gap-1 px-3 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white"
          >
            <Save className="w-3.5 h-3.5" /> Save
          </button>
        </div>
      </div>
    </div>
  );
};
