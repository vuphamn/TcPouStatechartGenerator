import React, { useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

const SHORTCUTS: [string, string][] = [
  ['Z', 'Focus mode'],
  ['A', 'Auto-align the layout'],
  ['K', 'Lock the layout'],
  ['G', 'Snap to grid'],
  ['F', 'Keyword search'],
  ['S', 'Statistics'],
  ['H', 'Complexity heat-map'],
  ['M', 'Minimap'],
  ['L', 'Legend'],
  ['Esc', 'Close a window / cancel'],
];

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-block min-w-[1.6rem] text-center px-1 py-px rounded border border-slate-700 bg-slate-800 font-mono text-[10px] text-slate-200">
    {children}
  </kbd>
);

/** Header help: shown while the mouse is over the icon or the card (click pins it for touch and keyboard users) */
export const HelpButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  // A short delay lets the mouse travel from the icon to the card
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 200);
  };
  useEffect(() => cancelClose, []);

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setPinned(false);
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinned(false);
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [pinned]);

  const visible = open || pinned;

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        id="help-btn"
        type="button"
        aria-label="Help"
        aria-expanded={visible}
        aria-controls="help-card"
        onClick={() => {
          setPinned((p) => !p);
          setOpen(true);
        }}
        className={`p-1 sm:p-1.5 rounded-lg transition-colors ${visible ? 'text-sky-300 bg-slate-800' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
      >
        <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>

      {visible && (
        <div
          id="help-card"
          role="dialog"
          aria-label="How Kval StateScope works"
          className="absolute right-0 top-full mt-1.5 w-[360px] max-w-[calc(100vw-1rem)] max-h-[75vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-3.5 z-50 text-[11px] text-slate-400 leading-relaxed space-y-3"
        >
          <section>
            <div className="font-semibold text-slate-100 text-xs mb-1">How it works</div>
            <p>
              Parses <code className="text-sky-300">doState()</code> and <code className="text-sky-300">preProcess()</code> from the POU, matches
              enum sequences from the DUT or embedded UML composites, and emits clean Mermaid diagram markdown.
            </p>
            <p className="mt-1">
              Open your own <code className="text-sky-300">.TcPOU</code> with <b className="text-slate-300">Function Block</b> in the header; its{' '}
              <code className="text-sky-300">.TcDUT</code> enum is found in the same folder.
            </p>
          </section>

          <section>
            <div className="font-semibold text-slate-100 text-xs mb-1">On the diagram</div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Click a state to select it; click it again to style it.</li>
              <li>Click a transition to select it; click it again for its guard and style.</li>
              <li>Right-click for paths, adding states and transitions, renaming, and notes.</li>
              <li>Drag states, lines, labels and notes to tidy the layout.</li>
            </ul>
          </section>

          <section>
            <div className="font-semibold text-slate-100 text-xs mb-1">Tabs</div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li><b className="text-slate-300">Problems</b>, <b className="text-slate-300">Paths</b> and <b className="text-slate-300">Changes</b> check and compare the state machine.</li>
              <li><b className="text-slate-300">Live</b> follows the running PLC.</li>
              <li><b className="text-slate-300">PLC Transition Logger</b> loads a CSV or text log into <b className="text-slate-300">Transition History</b>.</li>
              <li>Closed tabs come back from the <b className="text-slate-300">Window</b> menu.</li>
            </ul>
          </section>

          <section>
            <div className="font-semibold text-slate-100 text-xs mb-1.5">Keyboard (on the diagram)</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {SHORTCUTS.map(([key, what]) => (
                <div key={key} className="flex items-center gap-2">
                  <Kbd>{key}</Kbd>
                  <span className="truncate">{what}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
