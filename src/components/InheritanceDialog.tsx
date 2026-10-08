import React, { useEffect } from 'react';
import { X } from 'lucide-react';

/** One level of a POU's EXTENDS chain: its name and its own methods */
export interface InheritanceLevel {
  name: string;
  methods: string[];
}

interface Props {
  /** The POU first, then its bases nearest first */
  levels: InheritanceLevel[];
  /** A method opened in the Method Editor (its name as listed there: a base's overridden one as "<Base>.<name>") */
  onOpenMethod?: (editorName: string) => void;
  onClose: () => void;
}

/**
 * A POU's EXTENDS chain (SM_Head → SM_3AxisHead → KvalStateMachineBase): each level's methods, which a level below
 * overrides (dimmed, with by whom) and which override a base's (marked)
 */
export const InheritanceDialog: React.FC<Props> = ({ levels, onOpenMethod, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const lower = (i: number, m: string) => levels.slice(0, i).find((l) => l.methods.some((x) => x.toLowerCase() === m.toLowerCase()))?.name;
  const upper = (i: number, m: string) => levels.slice(i + 1).find((l) => l.methods.some((x) => x.toLowerCase() === m.toLowerCase()))?.name;
  return (
    <div id="inheritance-dialog" className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[min(720px,94vw)] max-h-[86vh] flex flex-col rounded-lg border border-slate-700 bg-slate-900 text-slate-200 shadow-xl text-xs">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
          <span className="font-semibold">Inheritance</span>
          <span className="text-slate-400 font-mono truncate">{levels.map((l) => l.name).join(' → ')}</span>
          <button type="button" id="inheritance-dialog-close" onClick={onClose} className="ml-auto p-1 rounded hover:bg-slate-800" title="Close (Esc)">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {levels.map((level, i) => (
            <div key={level.name} className="inheritance-level rounded border border-slate-700" data-level={level.name}>
              <div className="px-2 py-1 border-b border-slate-800 bg-slate-950/60 flex items-center gap-2">
                <span className="font-mono font-semibold text-sky-300">{level.name}</span>
                {i === 0 ? <span className="text-slate-500">(this POU)</span> : <span className="text-slate-500">base {i}</span>}
                {i + 1 < levels.length && <span className="ml-auto text-slate-500 font-mono">EXTENDS {levels[i + 1].name}</span>}
              </div>
              <div className="p-2 flex flex-wrap gap-1">
                {level.methods.length === 0 && <span className="text-slate-500">no methods</span>}
                {level.methods.map((m) => {
                  const by = lower(i, m);
                  const overrides = upper(i, m);
                  const editorName = i === 0 ? m : by ? `${level.name}.${m}` : m;
                  return (
                    <button
                      key={m}
                      type="button"
                      className={`inheritance-method px-1.5 py-0.5 rounded border font-mono ${by ? 'border-slate-800 text-slate-500 line-through decoration-slate-600' : overrides ? 'border-amber-600/60 text-amber-200' : 'border-slate-700 text-slate-300'} hover:bg-slate-800`}
                      data-method={m}
                      data-overridden-by={by}
                      data-overrides={overrides}
                      onClick={() => onOpenMethod?.(editorName)}
                      title={by ? `Overridden by ${by}'s ${m}(): this one runs only through SUPER^ (open it)` : overrides ? `Overrides ${overrides}'s ${m}() (open it)` : `Open ${m}() in the Method Editor`}
                    >
                      {m}(){overrides && !by ? ' ↑' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="text-slate-500">
            <span className="text-amber-200 font-mono">name() ↑</span> overrides a base's; <span className="line-through font-mono">name()</span> is overridden below (it runs through SUPER^). Click one to open it.
          </div>
        </div>
      </div>
    </div>
  );
};
