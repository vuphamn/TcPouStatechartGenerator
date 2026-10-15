import React from 'react';
import { ChevronDown, ChevronRight, FolderTree } from 'lucide-react';
import { keysUnder, rollup, type BoardTreeNode, type Health, type TreeMachine } from '../utils/boardTree.ts';

/**
 * The operator board's tree view of a PLC's machines (utils/boardTree.ts): a row per machine or group, nested as in
 * the program. A closed branch shows what is under it (in error, stuck, how many machines), coloured by the worst;
 * Alt+click opens or closes a branch with everything under it. The board renders each machine's own row.
 */
export function BoardTree<M extends TreeMachine>({
  nodes,
  healthOf,
  renderMachine,
  collapsed,
  onCollapse,
  narrow,
}: {
  nodes: BoardTreeNode<M>[];
  healthOf: (m: M) => Health;
  renderMachine: (m: M, label: string) => React.ReactNode;
  /** The closed branches (their keys) */
  collapsed: Set<string>;
  onCollapse: (keys: string[], closed: boolean) => void;
  narrow: boolean;
}) {
  const row = (n: BoardTreeNode<M>, depth: number): React.ReactNode => {
    const closed = collapsed.has(n.key);
    const r = n.children.length ? rollup(n, healthOf) : null;
    const toggle = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onCollapse(e.altKey ? keysUnder(n) : [n.key], !closed);
    };
    const pad = { paddingLeft: `${depth * (narrow ? 0.9 : 1.4)}rem` };
    return (
      <li key={n.key} className="board-tree-node" data-tree-key={n.key} data-closed={closed ? 'true' : undefined}>
        <div className="flex items-center gap-1" style={pad}>
          {n.children.length ? (
            <button type="button" className="board-tree-toggle shrink-0 p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-800" onClick={toggle} title={closed ? 'Open (Alt+click: everything under it)' : 'Close (Alt+click: everything under it)'} aria-expanded={!closed}>
              {closed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          {n.machine ? (
            <div className="flex-1 min-w-0">{renderMachine(n.machine, n.label)}</div>
          ) : (
            <button type="button" onClick={toggle} className="board-tree-group flex items-center gap-1.5 py-0.5 text-sm text-slate-300 hover:text-white" title={n.path}>
              <FolderTree className="w-4 h-4 text-slate-500" />
              <span className="font-mono">{n.label}</span>
            </button>
          )}
          {r && (closed || !n.machine) && (
            <span className={`board-tree-rollup shrink-0 ml-1 px-2 rounded-full text-xs ${r.worst === 'error' ? 'bg-rose-700 text-white' : r.worst === 'stuck' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`} title={`${r.machines} machine${r.machines === 1 ? '' : 's'} here: ${r.error} in error, ${r.stuck} stuck`}>
              {r.error ? `${r.error} error · ` : ''}
              {r.stuck ? `${r.stuck} stuck · ` : ''}
              {r.machines}
            </span>
          )}
        </div>
        {!closed && n.children.length > 0 && <ul className="board-tree-children">{n.children.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };
  return <ul className="board-tree space-y-0.5">{nodes.map((n) => row(n, 0))}</ul>;
}
