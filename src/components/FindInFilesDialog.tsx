import React, { useEffect, useRef, useState } from 'react';
import { FileSearch, Loader2, X } from 'lucide-react';
import type { FindMatch, FindOptions } from '../utils/findInFiles.ts';

export interface FindGroup {
  pou: string;
  path?: string;
  self?: boolean;
  matches: FindMatch[];
}
export type FindScope = 'pou' | 'project';

/**
 * Find in Files (Ctrl+Shift+F): a text, a whole word or a regular expression in this POU's code or the project's,
 * the matches by POU and where in it (a click opens it); Replace all with a preview of what changes where
 */
export const FindInFilesDialog: React.FC<{
  initial?: string;
  onSearch: (o: FindOptions, scope: FindScope) => Promise<{ groups: FindGroup[]; note?: string; error?: string }>;
  onReplace: (o: FindOptions, scope: FindScope, replacement: string, groups: FindGroup[]) => Promise<string | null>;
  onOpen: (g: FindGroup, m: FindMatch) => void;
  onClose: () => void;
}> = ({ initial = '', onSearch, onReplace, onOpen, onClose }) => {
  const [query, setQuery] = useState(initial);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [scope, setScope] = useState<FindScope>('project');
  const [replacement, setReplacement] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ groups: FindGroup[]; note?: string; error?: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // (this POU replaced: searched again once its new code is here (a new onSearch))
  const rerunRef = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const opts: FindOptions = { query, matchCase, wholeWord, regex };
  const run = async () => {
    if (!query) return;
    setBusy(true);
    setConfirming(false);
    setResult(await onSearch(opts, scope));
    setBusy(false);
  };
  useEffect(() => {
    if (!rerunRef.current) return;
    rerunRef.current = false;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSearch]);
  const total = result?.groups.reduce((n, g) => n + g.matches.length, 0) ?? 0;
  const toggle = (id: string, on: boolean, set: (v: boolean) => void, label: string, title: string) => (
    <button id={id} type="button" aria-pressed={on} onClick={() => set(!on)} className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${on ? 'border-sky-600 bg-sky-900/60 text-sky-100' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`} title={title}>
      {label}
    </button>
  );
  return (
    <div id="find-files-dialog" role="dialog" aria-label="Find in Files" className="fixed right-4 top-20 z-[70] w-[640px] max-w-[92vw] max-h-[76vh] flex flex-col rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
        <FileSearch className="w-3.5 h-3.5 text-sky-300 shrink-0" />
        <span className="font-semibold text-slate-100">Find in Files</span>
        <div className="flex rounded-md border border-slate-700 overflow-hidden text-[10px]" role="radiogroup" aria-label="Where">
          <button id="find-files-scope-pou" role="radio" aria-checked={scope === 'pou'} onClick={() => setScope('pou')} className={`px-1.5 py-0.5 ${scope === 'pou' ? 'bg-sky-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
            This POU
          </button>
          <button id="find-files-scope-project" role="radio" aria-checked={scope === 'project'} onClick={() => setScope('project')} className={`px-1.5 py-0.5 ${scope === 'project' ? 'bg-sky-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
            The project
          </button>
        </div>
        <button onClick={onClose} className="ml-auto p-0.5 text-slate-400 hover:text-white rounded" title="Close (Esc)">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="px-3 py-2 space-y-1.5 border-b border-slate-800">
        <div className="flex items-center gap-1.5">
          <input id="find-files-query" ref={input} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void run()} placeholder="Find…" className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-slate-100 outline-none focus:border-sky-600" />
          {toggle('find-files-case', matchCase, setMatchCase, 'Aa', 'Match case')}
          {toggle('find-files-word', wholeWord, setWholeWord, '\\b', 'Whole word')}
          {toggle('find-files-regex', regex, setRegex, '.*', 'Regular expression')}
          <button id="find-files-run" type="button" onClick={() => void run()} disabled={!query || busy} className="px-2 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40">
            Find
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <input id="find-files-replace" value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder={regex ? 'Replace with… ($1: a group)' : 'Replace with…'} className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-slate-100 outline-none focus:border-sky-600" />
          <button id="find-files-replace-all" type="button" onClick={() => setConfirming(true)} disabled={!total || busy} className="px-2 py-1 rounded border border-amber-700 text-amber-200 hover:bg-amber-900/40 disabled:opacity-40" title="Every match found, after a look at what changes">
            Replace all…
          </button>
        </div>
        {confirming && result && (
          <div id="find-files-preview" className="rounded border border-amber-700/70 bg-amber-950/40 px-2 py-1.5 space-y-1">
            <div className="text-amber-100">
              Replace {total} match{total === 1 ? '' : 'es'} with <span className="font-mono">{replacement || '(nothing)'}</span> in {result.groups.length} POU{result.groups.length === 1 ? '' : 's'}:
            </div>
            <ul className="text-[10px] text-amber-200/90 font-mono">
              {result.groups.map((g) => (
                <li key={g.path ?? g.pou}>
                  {g.pou}: {g.matches.length}
                  {g.self ? ' (this POU: its edit, Save writes it)' : ' (written at once)'}
                </li>
              ))}
            </ul>
            <div className="flex gap-1.5">
              <button
                id="find-files-replace-confirm"
                type="button"
                onClick={async () => {
                  setBusy(true);
                  const err = await onReplace(opts, scope, replacement, result.groups);
                  setBusy(false);
                  setConfirming(false);
                  if (err) return;
                  if (result.groups.some((g) => g.self)) rerunRef.current = true;
                  else void run();
                }}
                className="px-2 py-0.5 rounded bg-amber-700 hover:bg-amber-600 text-white"
              >
                Replace
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      <div id="find-files-list" className="overflow-y-auto p-2 space-y-2 min-h-0">
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
        {result?.error && <div className="text-rose-300 px-1">{result.error}</div>}
        {result && !result.error && !busy && (
          <div id="find-files-count" className="text-[10px] text-slate-400 px-1">
            {total} match{total === 1 ? '' : 'es'} in {result.groups.length} POU{result.groups.length === 1 ? '' : 's'}
          </div>
        )}
        {result?.groups.map((g) => (
          <div key={g.path ?? g.pou} className="find-files-pou" data-pou={g.pou}>
            <div className="px-1 pb-0.5 flex items-baseline gap-2">
              <span className="font-semibold text-slate-200">{g.pou}</span>
              {g.self && <span className="text-[9px] px-1 rounded bg-sky-900/60 text-sky-200">this POU</span>}
              <span className="text-[10px] text-slate-500">{g.matches.length}</span>
            </div>
            {g.matches.map((m, i) => (
              <button key={`${m.where}-${m.line}-${m.column}-${i}`} type="button" className="find-files-row w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-slate-800 font-mono" data-pou={g.pou} data-where={m.where} data-line={m.line} onClick={() => onOpen(g, m)} title={`${g.pou} · ${m.where} line ${m.line}`}>
                <span className="w-28 truncate text-[10px] text-slate-400 font-sans shrink-0">{m.where}</span>
                <span className="w-8 text-right text-slate-500 shrink-0">{m.line}</span>
                <span className="truncate text-slate-200">
                  {m.text.slice(0, m.at)}
                  <mark className="bg-sky-500/30 text-sky-100 rounded-sm">{m.text.slice(m.at, m.at + m.length)}</mark>
                  {m.text.slice(m.at + m.length)}
                </span>
              </button>
            ))}
          </div>
        ))}
        {result?.note && <div id="find-files-note" className="text-[10px] text-slate-500 px-1">{result.note}</div>}
      </div>
    </div>
  );
};
