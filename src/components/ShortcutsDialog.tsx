import React, { useEffect, useState } from 'react';
import { Keyboard, X } from 'lucide-react';

/** Every keyboard shortcut of the app, by where it works (? opens it) */
export const SHORTCUTS: { area: string; keys: [string, string][] }[] = [
  {
    area: 'Everywhere',
    keys: [
      ['Ctrl+Shift+P', 'Command palette: every command, with a filter'],
      ['Ctrl+Shift+O (Ctrl+T in XAE / desktop)', 'Go to symbol: a type, a GVL variable, a method, a member, a state'],
      ['?', 'This list (not while typing)'],
      ['Ctrl+S', 'Save to the project'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo the last edit'],
    ],
  },
  {
    area: 'Canvas',
    keys: [
      ['Click / Ctrl+click', 'Select a state / add it to (or take it out of) a selection of several'],
      ['Shift+drag', 'Select the states in a box'],
      ['Esc', 'Clear the selection of several states; close a menu'],
      ['Right-click', 'The menu of a state, a transition or the canvas (type to filter it)'],
      ['F2', 'The selected transition: edit its condition on its label; else the next bookmarked state'],
      ['Shift+F2', 'The previous bookmarked state'],
      ['Delete', 'Delete the selected transition / state (asked first)'],
      ['Alt+↑ / Alt+↓', "The selected transition's priority up / down"],
      ['Ctrl+C / Ctrl+V', 'Copy the selected state / paste a copy'],
      ['Arrow keys', 'Move the selected state (Shift: further)'],
      ['Ctrl+wheel / wheel', 'Zoom (20% to 1000%)'],
      ['F / S / L / H / K', 'Find, statistics, legend, heat-map, lock the layout'],
    ],
  },
  {
    area: 'Code editors',
    keys: [
      ['Ctrl+Space', 'Completion: the names; after a dot, the members'],
      ['F2', 'Input Assistant: every name by category'],
      ['Tab', 'After a snippet key (if, case, for, ton, trans, entry, ...): the snippet; else indent'],
      ['F12', 'Go to Definition (another POU: at its member)'],
      ['Shift+F12', 'Find All References'],
      ['Shift+F2', 'Declare the name at the caret'],
      ['Shift+F6', 'Rename in place: the name at the caret (its uses highlighted)'],
      ['Ctrl+F2', 'Toggle a bookmark on the line'],
      ['Shift+Alt+F', 'Format the code (re-indent)'],
      ['Ctrl+F / F3 / Shift+F3', 'Find / next / previous'],
      ['Ctrl+wheel, Ctrl+0', 'Text size / 100%'],
    ],
  },
  {
    area: 'Dialogs',
    keys: [
      ['Enter / Esc', 'Confirm / cancel'],
      ['Ctrl+Enter', 'Confirm a dialog with several lines of code (an action)'],
      ['↑ / ↓ then Enter or Tab', 'Pick from a list of names'],
    ],
  },
];

export const ShortcutsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [q, setQ] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const filter = q.trim().toLowerCase();
  return (
    <div id="shortcuts-overlay" className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="shortcuts-dialog" role="dialog" aria-label="Keyboard shortcuts" className="w-[720px] max-w-[94vw] max-h-[84vh] flex flex-col rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
          <span className="flex items-center gap-2 font-semibold text-slate-100">
            <Keyboard className="w-4 h-4 text-sky-400" /> Keyboard shortcuts
          </span>
          <input
            id="shortcuts-filter"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter"
            className="ml-auto mr-2 w-48 bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-slate-100"
          />
          <button onClick={onClose} className="p-0.5 text-slate-400 hover:text-white rounded" title="Close (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {SHORTCUTS.map((g) => {
            const keys = g.keys.filter(([k, d]) => !filter || `${k} ${d}`.toLowerCase().includes(filter));
            if (!keys.length) return null;
            return (
              <div key={g.area}>
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{g.area}</div>
                <table className="w-full">
                  <tbody>
                    {keys.map(([k, d]) => (
                      <tr key={k} className="shortcut-row align-top">
                        <td className="py-0.5 pr-3 whitespace-nowrap">
                          <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[10px] text-slate-200">{k}</kbd>
                        </td>
                        <td className="py-0.5 text-slate-300">{d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
