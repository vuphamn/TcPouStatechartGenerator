import React, { useState } from 'react';
import { ArrowRight, ChevronLeft, Redo2, Shapes, Undo2, ArrowRightToLine, Circle, CircleDot, Diamond, GitFork, MousePointer2, Square, SquareStack, StickyNote, Zap } from 'lucide-react';

/** The statechart elements that can be dropped on the canvas */
export type PaletteElement = 'pointer' | 'state' | 'initial' | 'final' | 'choice' | 'composite' | 'forkjoin' | 'transition' | 'completion' | 'exception' | 'note';

export const PALETTE_MIME = 'application/x-kss-statechart-element';

const ITEMS: { kind: PaletteElement; label: string; icon: React.ReactNode; title: string; noDrag?: boolean }[] = [
  { kind: 'pointer', label: 'Pointer', icon: <MousePointer2 className="w-4 h-4" />, title: 'Pointer: select and move (ends drawing a transition)', noDrag: true },
  { kind: 'state', label: 'State', icon: <Square className="w-4 h-4" />, title: 'State: drag it onto the canvas (into a composite to add it there). A new enum member and CASE branch in doState()' },
  { kind: 'initial', label: 'Initial', icon: <CircleDot className="w-4 h-4" />, title: 'Initial state: drag it onto a state. The state variable starts there (its initial value in the declaration, or set in initialize() when the base FB declares it)' },
  { kind: 'final', label: 'Final', icon: <Circle className="w-4 h-4 ring-2 ring-current ring-offset-1 ring-offset-slate-900 rounded-full" />, title: 'Final state: drag it onto the canvas for a new final state, or onto a state to mark it final (no transitions out)' },
  { kind: 'choice', label: 'Choice', icon: <Diamond className="w-4 h-4" />, title: 'Choice: drag it onto a state. Its conditions and targets become an IF / ELSIF / ELSE in its branch' },
  { kind: 'composite', label: 'Composite', icon: <SquareStack className="w-4 h-4" />, title: 'Composite state: drag it onto a state to put it in a new composite (a {region} in the enum), or onto the canvas for a new one with a first state' },
  { kind: 'forkjoin', label: 'Fork/Join', icon: <GitFork className="w-4 h-4" />, title: 'Fork / Join: drag it onto a state. The state starts child state machines, which run in parallel (fork), and goes on when all of them are done (join)' },
  { kind: 'transition', label: 'Transition', icon: <ArrowRight className="w-4 h-4" />, title: 'Transition: drag it onto the source state (or click it with a state selected), then click the target state' },
  { kind: 'completion', label: 'Completion', icon: <ArrowRightToLine className="w-4 h-4" />, title: 'Completion transition: drag it onto the source state, then click the target. No condition: taken once the state\'s code has run' },
  { kind: 'exception', label: 'Exception', icon: <Zap className="w-4 h-4" />, title: 'Exception transition: drag it onto a state or a composite, then click the target. Checked before everything else (a composite\'s: in preProcess(), for all its states)' },
  { kind: 'note', label: 'Note', icon: <StickyNote className="w-4 h-4" />, title: 'Note: drag it onto the canvas; it is placed where you drop it' },
];

/** The canvas' statechart palette: elements dragged onto the canvas / a state become ST */
export const StatechartPalette: React.FC<{
  onClick: (kind: PaletteElement) => void;
  disabled?: boolean;
  history?: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void };
  /** Its top, in px from the viewer's top: the canvas' top-left corner */
  top?: number;
}> = ({ onClick, disabled, history, top = 8 }) => {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('kss.paletteCollapsed') === 'true';
    } catch {
      return false;
    }
  });
  const toggle = (value: boolean) => {
    setCollapsed(value);
    try {
      localStorage.setItem('kss.paletteCollapsed', String(value));
    } catch {
      // (not remembered)
    }
  };
  if (collapsed)
    return (
      <button
        id="statechart-palette-expand"
        type="button"
        title="Statechart elements"
        onClick={() => toggle(false)}
        style={{ top }}
        className="absolute left-2 z-30 p-1.5 rounded-lg bg-slate-900/95 border border-slate-700 shadow-xl text-slate-300 hover:text-white"
      >
        <Shapes className="w-4 h-4" />
      </button>
    );
  return (
  <div
    id="statechart-palette"
    role="toolbar"
    aria-label="Statechart elements"
    style={{ top, maxHeight: `calc(100% - ${top + 8}px)` }}
    className={`absolute left-2 z-30 flex flex-col gap-0.5 p-1 rounded-lg bg-slate-900/95 border border-slate-700 shadow-xl overflow-y-auto ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
    onMouseDown={(e) => e.stopPropagation()}
    onContextMenu={(e) => e.stopPropagation()}
  >
    {history && (
      <div className="flex justify-between pb-0.5 mb-0.5 border-b border-slate-700">
        <button id="palette-undo" type="button" onClick={history.onUndo} disabled={!history.canUndo} title="Undo the last edit (Ctrl+Z)" className="p-1 rounded text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-30">
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button id="palette-redo" type="button" onClick={history.onRedo} disabled={!history.canRedo} title="Redo (Ctrl+Y)" className="p-1 rounded text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-30">
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      </div>
    )}
    {ITEMS.map((it) => (
      <button
        key={it.kind}
        id={`palette-${it.kind}`}
        type="button"
        draggable={!it.noDrag}
        title={it.title}
        onDragStart={(e) => {
          e.dataTransfer.setData(PALETTE_MIME, it.kind);
          e.dataTransfer.setData('text/plain', it.kind);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => onClick(it.kind)}
        className="flex flex-col items-center gap-0.5 w-14 py-1 rounded text-slate-300 hover:bg-slate-800 hover:text-white cursor-grab active:cursor-grabbing"
      >
        {it.icon}
        <span className="text-[9px] leading-none">{it.label}</span>
      </button>
    ))}
    <button id="statechart-palette-collapse" type="button" title="Hide the statechart elements" onClick={() => toggle(true)} className="flex justify-center py-0.5 rounded text-slate-500 hover:bg-slate-800 hover:text-white">
      <ChevronLeft className="w-3.5 h-3.5" />
    </button>
  </div>
  );
};
