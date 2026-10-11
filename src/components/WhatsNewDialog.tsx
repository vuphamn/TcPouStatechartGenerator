import React, { useEffect, useMemo } from 'react';
import { History, Sparkles, X } from 'lucide-react';
import history from 'virtual:kss-release-notes';
import { EDITION_LABEL, editionVersion, type EditionId } from '../utils/releaseNotes.ts';
import { byArea, whatsNew } from '../utils/whatsNew.ts';

/**
 * What's new: the features since the build last opened here (or the latest ones), by area, each with what it does; a
 * way to the full release notes
 */
export const WhatsNewDialog: React.FC<{ edition: EditionId; seen: string | null; onClose: () => void; onOpenReleaseNotes: () => void }> = ({ edition, seen, onClose, onOpenReleaseNotes }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const h = history[edition];
  const r = useMemo(() => whatsNew(h, seen), [h, seen]);
  // (nothing new since the build seen: the latest features)
  const latest = useMemo(() => (r.items.length ? r : { ...whatsNew(h, null, 20), sinceSeen: false }), [r, h]);
  const groups = byArea(latest.items);
  const version = editionVersion(edition) || h?.version || '';
  return (
    <div id="whats-new-backdrop" className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="whats-new-dialog" role="dialog" aria-label="What's new" className="w-[760px] max-w-[94vw] max-h-[82vh] flex flex-col rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-sm">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
          <Sparkles className="w-4 h-4 text-amber-300" />
          <span className="font-semibold text-slate-100">What's new</span>
          <span className="text-xs text-slate-400">
            MachineScope {EDITION_LABEL[edition]} {version}
          </span>
          <button onClick={onClose} className="ml-auto p-0.5 text-slate-400 hover:text-white rounded" title="Close (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div id="whats-new-summary" className="px-4 pt-3 text-xs text-slate-400">
          {r.items.length
            ? `${r.items.length} new feature${r.items.length === 1 ? '' : 's'} since you last opened MachineScope here.`
            : latest.items.length
              ? 'Nothing new since you last opened MachineScope here: the latest features.'
              : history.error
                ? `No release history in this build (${history.error}).`
                : 'No features listed yet.'}
        </div>
        <div id="whats-new-list" className="overflow-y-auto px-4 pb-3 min-h-0">
          {groups.map((g) => (
            <section key={g.area} className="whats-new-area mt-3" data-area={g.area}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">{g.area}</div>
              <ul className="mt-1 space-y-2">
                {g.items.map((it) => (
                  <li key={it.hash} className="whats-new-item rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2" data-hash={it.hash}>
                    <div className="flex items-baseline gap-2">
                      <span className="whats-new-title font-medium text-slate-100">{it.title}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-slate-500 font-mono">{it.date}</span>
                    </div>
                    {it.body && <p className="whats-new-body mt-1 text-xs leading-relaxed text-slate-400">{it.body}</p>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="flex items-center gap-2 px-4 py-2 border-t border-slate-800">
          <button id="whats-new-release-notes" type="button" onClick={onOpenReleaseNotes} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-300 hover:bg-slate-800" title="Every edition's releases with all their changes">
            <History className="w-3.5 h-3.5" /> All release notes
          </button>
          <button id="whats-new-close" type="button" onClick={onClose} className="ml-auto px-3 py-1 rounded bg-sky-700 hover:bg-sky-600 text-xs text-white">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
