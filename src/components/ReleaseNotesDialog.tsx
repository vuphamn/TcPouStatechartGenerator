import React, { useEffect, useMemo, useState } from 'react';
import { History, Search, X } from 'lucide-react';
import history from 'virtual:kss-release-notes';
import { EDITION_LABEL, editionVersion, filterReleases, groupChanges, type EditionId, type ReleaseCommit } from '../utils/releaseNotes.ts';

const KIND_LABEL = { feat: 'New', fix: 'Fixed', other: 'Other' } as const;
const KIND_CLASS = { feat: 'text-emerald-300', fix: 'text-amber-300', other: 'text-slate-400' } as const;

/**
 * The release notes: each edition's releases, newest first, with what changed in each (from the git history at build
 * time); this build's changes after its last release first. This edition's tab first; a filter over the changes
 */
export const ReleaseNotesDialog: React.FC<{ edition: EditionId; onClose: () => void }> = ({ edition, onClose }) => {
  const [tab, setTab] = useState<EditionId>(edition);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const editions = ([edition, ...(['desktop', 'web', 'xae'] as EditionId[]).filter((e) => e !== edition)] as EditionId[]).filter((e) => history[e]);
  const h = history[tab];
  const shown = useMemo(() => (h ? filterReleases(h, filter) : null), [h, filter]);
  const block = (key: string, title: React.ReactNode, date: string, commits: ReleaseCommit[], current: boolean) => (
    <section key={key} className="release-notes-release py-2 border-b border-slate-800 last:border-0" data-tag={key}>
      <div className="flex items-baseline gap-2">
        <span className={`font-semibold ${current ? 'text-sky-200' : 'text-slate-100'}`}>{title}</span>
        {current && <span className="text-[10px] px-1.5 rounded-full bg-sky-900/60 text-sky-200">this version</span>}
        <span className="ml-auto text-[10px] text-slate-500 font-mono">{date}</span>
      </div>
      {groupChanges(commits).map((g) => (
        <div key={g.kind} className="mt-1">
          <div className={`text-[10px] font-semibold uppercase tracking-wide ${KIND_CLASS[g.kind]}`}>{KIND_LABEL[g.kind]}</div>
          <ul className="list-disc pl-5 space-y-0.5 text-slate-300">
            {g.items.map((c, i) => (
              <li key={i} className="release-notes-change" data-kind={c.kind}>
                {c.text.charAt(0).toUpperCase() + c.text.slice(1)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
  const version = editionVersion(tab) || h?.version || '';
  const released = !!h?.releases.some((r) => r.version === version);
  return (
    <div id="release-notes-dialog" role="dialog" aria-label="Release notes" className="fixed right-4 bottom-8 z-[70] w-[620px] max-w-[94vw] max-h-[78vh] flex flex-col rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-800">
        <span className="flex items-center gap-2 font-semibold text-slate-100">
          <History className="w-3.5 h-3.5 text-sky-300" /> Release notes
        </span>
        <button onClick={onClose} className="p-0.5 text-slate-400 hover:text-white rounded" title="Close (Esc)">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-slate-800">
        {editions.map((e) => (
          <button
            key={e}
            id={`release-notes-tab-${e}`}
            type="button"
            onClick={() => setTab(e)}
            className={`px-2 py-0.5 rounded ${tab === e ? 'bg-sky-800/70 text-sky-100' : 'text-slate-300 hover:bg-slate-800'}`}
            title={history[e]?.title}
          >
            {EDITION_LABEL[e]} {editionVersion(e) || history[e]?.version}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1 rounded border border-slate-700 px-1.5">
          <Search className="w-3 h-3 text-slate-500" />
          <input id="release-notes-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter the changes…" className="bg-transparent py-0.5 w-40 outline-none text-slate-200" />
        </span>
      </div>
      <div id="release-notes-list" className="overflow-y-auto px-3 pb-2 min-h-0">
        {history.error && <div className="py-2 text-slate-500">No release history in this build ({history.error}).</div>}
        {h && shown && (
          <>
            <div className="py-2 text-slate-400">{h.title}.</div>
            {shown.unreleased.length > 0 && block('unreleased', released ? `Since ${version} (this build)` : version, shown.unreleased[0]?.date ?? '', shown.unreleased, !released)}
            {shown.releases.map((r) => block(r.tag, r.version, r.date, r.commits, r.version === version))}
            {shown.releases.length === 0 && shown.unreleased.length === 0 && <div className="py-2 text-slate-500">{filter ? 'No change mentions that.' : 'No releases yet.'}</div>}
          </>
        )}
      </div>
    </div>
  );
};
