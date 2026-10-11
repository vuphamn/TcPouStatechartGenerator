import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch, Layers, Loader2, X } from 'lucide-react';
import { nodeLabel, type CallNode, type CallSite } from '../utils/callHierarchy.ts';

type Dir = 'callers' | 'calls';
interface TreeNode {
  node: CallNode;
  /** The callers (or callees) once loaded */
  children?: TreeNode[];
  open?: boolean;
  loading?: boolean;
}

/**
 * The Call Hierarchy (Shift+Alt+H) as XAE's Call Tree: who calls a method, an action or a POU's body (each caller
 * opens to its own callers), what it calls (each callee to what it calls); each call's lines a click from the code.
 * Go to Implementation's choices (several implementations) in the same window
 */
export const CallHierarchyDialog: React.FC<{
  target: CallNode;
  mode: 'calls' | 'implementations';
  implementations?: CallNode[];
  load?: (node: CallNode, dir: Dir) => Promise<CallNode[]>;
  onOpen: (node: CallNode, site?: CallSite) => void;
  onClose: () => void;
  /** What the list could not see (the web edition without a project folder: this POU only) */
  note?: string;
}> = ({ target, mode, implementations = [], load, onOpen, onClose, note }) => {
  const [dir, setDir] = useState<Dir>('callers');
  const [roots, setRoots] = useState<Record<Dir, TreeNode>>({ callers: { node: target, open: true, loading: true }, calls: { node: target, open: true, loading: true } });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // (a node's children, loaded when it is opened; the root's at once)
  const loadInto = async (d: Dir, path: number[]) => {
    if (!load) return;
    const at = (root: TreeNode): TreeNode => path.reduce((n, i) => n.children![i], root);
    const node = at(roots[d]).node;
    const kids = await load(node, d).catch(() => [] as CallNode[]);
    setRoots((r) => {
      const copy = structuredClone(r);
      const n = at(copy[d]);
      n.children = kids.map((k) => ({ node: k }));
      n.loading = false;
      n.open = true;
      return copy;
    });
  };
  useEffect(() => {
    setRoots({ callers: { node: target, open: true, loading: true }, calls: { node: target, open: true, loading: true } });
    if (mode !== 'calls') return;
    void loadInto('callers', []);
    void loadInto('calls', []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.pou, target.member, mode]);
  const toggle = (path: number[]) => {
    const n = path.reduce((x, i) => x.children![i], roots[dir]);
    if (n.children) {
      setRoots((r) => {
        const copy = structuredClone(r);
        const m = path.reduce((x, i) => x.children![i], copy[dir]);
        m.open = !m.open;
        return copy;
      });
      return;
    }
    setRoots((r) => {
      const copy = structuredClone(r);
      const m = path.reduce((x, i) => x.children![i], copy[dir]);
      m.loading = true;
      m.open = true;
      return copy;
    });
    void loadInto(dir, path);
  };
  // (a node seen above it: a recursion, not opened again)
  const row = (t: TreeNode, path: number[], seen: string[], parent: CallNode | null): React.ReactNode => {
    const label = nodeLabel(t.node);
    const k = `${t.node.pou}|${t.node.member}`.toLowerCase();
    const recursive = seen.includes(k);
    const depth = path.length;
    return (
      <div key={`${path.join('.')}|${k}`}>
        <div className="call-hierarchy-row flex items-center gap-1 rounded hover:bg-slate-800 pr-2" style={{ paddingLeft: depth * 14 }} data-label={label} data-depth={depth} data-dir={dir}>
          {depth > 0 && !recursive ? (
            <button type="button" className="call-hierarchy-expand p-0.5 text-slate-400 hover:text-white" onClick={() => toggle(path)} title={dir === 'callers' ? 'Who calls this' : 'What this calls'}>
              {t.open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          ) : (
            <span className="w-4" />
          )}
          <button type="button" className="call-hierarchy-open flex-1 min-w-0 text-left py-0.5 font-mono truncate text-slate-200" onClick={() => (dir === 'callers' ? onOpen(t.node, t.node.sites[0]) : onOpen(t.node))} title={depth ? (dir === 'callers' ? 'Open the call' : 'Open it') : 'Open it'}>
            {label}
            {recursive && <span className="ml-1 text-[10px] text-slate-500 font-sans">(recursive)</span>}
            {t.node.path && depth > 0 && <span className="ml-2 text-[10px] text-slate-500 font-sans">{t.node.path.split(/[\\/]/).pop()}</span>}
          </button>
          {depth > 0 &&
            t.node.sites.slice(0, 6).map((s, i) => (
              <button
                key={`${s.line}-${i}`}
                type="button"
                className="call-hierarchy-site shrink-0 text-[10px] px-1 rounded bg-slate-800 text-slate-300 hover:bg-sky-800"
                data-line={s.line}
                // (callers: the line in the caller; calls: the line here that calls it)
                onClick={() => (dir === 'callers' || !parent ? onOpen(t.node, s) : onOpen(parent, s))}
                title={s.text}
              >
                {s.line}
              </button>
            ))}
          {t.loading && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
        </div>
        {t.open && !recursive && t.children?.map((c, i) => row(c, [...path, i], [...seen, k], t.node))}
        {t.open && !t.loading && t.children?.length === 0 && (
          <div className="call-hierarchy-none text-[10px] text-slate-500 py-0.5" style={{ paddingLeft: (depth + 1) * 14 + 16 }}>
            {dir === 'callers' ? 'No callers found' : 'Calls nothing in the project'}
          </div>
        )}
      </div>
    );
  };
  const title = mode === 'implementations' ? 'Implementations of' : 'Call Hierarchy:';
  return (
    <div id="call-hierarchy-dialog" role="dialog" aria-label={`${title} ${nodeLabel(target)}`} data-mode={mode} className="fixed right-4 top-20 z-[70] w-[600px] max-w-[92vw] max-h-[72vh] flex flex-col rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
        {mode === 'implementations' ? <Layers className="w-3.5 h-3.5 text-violet-300 shrink-0" /> : <GitBranch className="w-3.5 h-3.5 text-sky-300 shrink-0" />}
        <span className="font-semibold text-slate-100 truncate">
          {title} <span className="font-mono text-amber-200">{nodeLabel(target)}</span>
        </span>
        {mode === 'calls' && (
          <div className="ml-auto flex rounded-md border border-slate-700 overflow-hidden text-[10px] shrink-0" role="radiogroup" aria-label="Direction">
            <button id="call-hierarchy-callers" role="radio" aria-checked={dir === 'callers'} onClick={() => setDir('callers')} className={`px-1.5 py-0.5 ${dir === 'callers' ? 'bg-sky-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`} title="Who calls it">
              Callers
            </button>
            <button id="call-hierarchy-calls" role="radio" aria-checked={dir === 'calls'} onClick={() => setDir('calls')} className={`px-1.5 py-0.5 ${dir === 'calls' ? 'bg-sky-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`} title="What it calls">
              Calls
            </button>
          </div>
        )}
        <button onClick={onClose} className={`${mode === 'calls' ? '' : 'ml-auto '}p-0.5 text-slate-400 hover:text-white rounded`} title="Close (Esc)">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div id="call-hierarchy-list" className="overflow-y-auto p-2">
        {mode === 'calls' ? (
          row(roots[dir], [], [], null)
        ) : implementations.length ? (
          implementations.map((n) => (
            <button key={`${n.pou}|${n.member}`} type="button" className="call-hierarchy-row w-full text-left px-2 py-1 rounded hover:bg-slate-800 font-mono text-slate-200" data-label={nodeLabel(n)} onClick={() => onOpen(n)} title="Open it">
              {nodeLabel(n)}
              {n.path && <span className="ml-2 text-[10px] text-slate-500 font-sans">{n.path.split(/[\\/]/).pop()}</span>}
            </button>
          ))
        ) : (
          <div className="call-hierarchy-none text-slate-500 px-1">No implementation found in the project.</div>
        )}
      </div>
      {note && <div id="call-hierarchy-note" className="px-3 py-1.5 border-t border-slate-800 text-[10px] text-slate-500">{note}</div>}
    </div>
  );
};
