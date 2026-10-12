import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, GitFork, Loader2, X } from 'lucide-react';

export interface TypeEntry {
  name: string;
  kind: string;
  path?: string;
}
interface SubNode {
  t: TypeEntry;
  open?: boolean;
  loading?: boolean;
  children?: SubNode[];
}

/**
 * The Type Hierarchy (as VS Code's, XAE's Type Hierarchy): a type's bases (EXTENDS, up the chain), the interfaces it
 * implements (its bases' too), and the types extending or implementing it (each opened to its own); a click opens one
 */
export const TypeHierarchyDialog: React.FC<{
  target: TypeEntry;
  supers: TypeEntry[];
  interfaces: TypeEntry[];
  loadSubs: (name: string) => Promise<TypeEntry[]>;
  onOpen: (t: TypeEntry) => void;
  onClose: () => void;
  note?: string;
}> = ({ target, supers, interfaces, loadSubs, onOpen, onClose, note }) => {
  const [root, setRoot] = useState<SubNode>({ t: target, open: true, loading: true });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const update = (path: number[], fn: (n: SubNode) => void) =>
    setRoot((r) => {
      const copy = structuredClone(r);
      fn(path.reduce((n, i) => n.children![i], copy));
      return copy;
    });
  const load = (path: number[], name: string) => {
    update(path, (n) => {
      n.loading = true;
      n.open = true;
    });
    void loadSubs(name)
      .catch(() => [] as TypeEntry[])
      .then((subs) =>
        update(path, (n) => {
          n.children = subs.map((t) => ({ t }));
          n.loading = false;
        })
      );
  };
  useEffect(() => {
    setRoot({ t: target, open: true, loading: true });
    load([], target.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.name]);
  const kindBadge = (k: string) => <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-400 font-sans">{k === 'FUNCTION_BLOCK' ? 'FB' : k === 'INTERFACE' ? 'interface' : k.toLowerCase()}</span>;
  const typeRow = (t: TypeEntry, cls: string, depth = 0, extra?: React.ReactNode) => (
    <div key={`${cls}-${t.name}-${depth}`} className={`${cls} flex items-center gap-1.5 rounded hover:bg-slate-800 pr-2`} style={{ paddingLeft: depth * 14 }} data-type={t.name}>
      {extra ?? <span className="w-4" />}
      <button type="button" className="flex-1 min-w-0 text-left py-0.5 font-mono truncate text-slate-200" onClick={() => onOpen(t)} title={t.path ?? t.name}>
        {t.name}
      </button>
      {kindBadge(t.kind)}
    </div>
  );
  const subRow = (n: SubNode, path: number[], seen: string[]): React.ReactNode => {
    const k = n.t.name.toLowerCase();
    const again = seen.includes(k);
    const chevron = (
      <button type="button" className="type-hierarchy-expand p-0.5 text-slate-400 hover:text-white" onClick={() => (n.children ? update(path, (x) => void (x.open = !x.open)) : load(path, n.t.name))} title="The types extending or implementing it">
        {n.open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
    );
    return (
      <div key={`${path.join('.')}|${k}`}>
        {path.length > 0 && typeRow(n.t, 'type-hierarchy-sub', path.length - 1, again ? undefined : chevron)}
        {n.loading && <Loader2 className="w-3 h-3 animate-spin text-slate-400" style={{ marginLeft: path.length * 14 }} />}
        {n.open && !again && n.children?.map((c, i) => subRow(c, [...path, i], [...seen, k]))}
        {n.open && !n.loading && n.children?.length === 0 && path.length === 0 && <div className="text-[10px] text-slate-500 px-1">Nothing extends or implements it in the project.</div>}
      </div>
    );
  };
  return (
    <div id="type-hierarchy-dialog" role="dialog" aria-label={`Type Hierarchy: ${target.name}`} className="fixed right-4 top-20 z-[70] w-[480px] max-w-[92vw] max-h-[72vh] flex flex-col rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
        <GitFork className="w-3.5 h-3.5 text-violet-300 shrink-0" />
        <span className="font-semibold text-slate-100 truncate">
          Type Hierarchy: <span className="font-mono text-amber-200">{target.name}</span>
        </span>
        {kindBadge(target.kind)}
        <button onClick={onClose} className="ml-auto p-0.5 text-slate-400 hover:text-white rounded" title="Close (Esc)">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="overflow-y-auto p-2 space-y-2">
        <section>
          <div className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Extends</div>
          {supers.length ? supers.map((t, i) => typeRow(t, 'type-hierarchy-super', i)) : <div className="text-[10px] text-slate-500 px-1">No base type.</div>}
        </section>
        <section>
          <div className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Implements</div>
          {interfaces.length ? interfaces.map((t) => typeRow(t, 'type-hierarchy-interface')) : <div className="text-[10px] text-slate-500 px-1">No interface.</div>}
        </section>
        <section>
          <div className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Extended / implemented by</div>
          {subRow(root, [], [])}
        </section>
      </div>
      {note && <div id="type-hierarchy-note" className="px-3 py-1.5 border-t border-slate-800 text-[10px] text-slate-500">{note}</div>}
    </div>
  );
};
