import React from 'react';
import { StickyNote, X, Trash2, Edit3, ArrowRight, Layers, ExternalLink } from 'lucide-react';
import { DiagramNotes, ContextMenuTarget } from '../types.ts';

interface NotesDrawerProps {
  isOpen: boolean;
  notes: DiagramNotes;
  onClose: () => void;
  onEditNote: (target: ContextMenuTarget) => void;
  onDeleteNote: (target: ContextMenuTarget) => void;
  onClearAllNotes: () => void;
  onSelectTarget?: (target: ContextMenuTarget) => void;
  onOpenMermaidLive?: () => void;
}

export const NotesDrawer: React.FC<NotesDrawerProps> = ({
  isOpen,
  notes,
  onClose,
  onEditNote,
  onDeleteNote,
  onClearAllNotes,
  onSelectTarget,
  onOpenMermaidLive,
}) => {
  if (!isOpen) return null;

  const nodeEntries = Object.entries(notes.nodes).filter(([, text]) => Boolean(text && text.trim()));
  const edgeEntries = Object.entries(notes.edges).filter(([, text]) => Boolean(text && text.trim()));
  const totalNotes = nodeEntries.length + edgeEntries.length;

  return (
    <div
      id="notes-drawer-overlay"
      className="fixed inset-0 z-40 flex justify-end bg-slate-950/40 backdrop-blur-[2px] animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="notes-drawer-panel"
        className="w-full max-w-sm h-full bg-slate-900 border-l border-slate-700/80 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800 bg-slate-800/40">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <StickyNote className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
                Diagram Notes
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 font-mono">
                  {totalNotes}
                </span>
              </h3>
              <p className="text-[10px] text-slate-400">
                Right-click any node or edge to attach a note
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 hover:bg-slate-800 p-1 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar text-xs">
          {totalNotes === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-slate-800 flex items-center justify-center text-slate-500 mb-3">
                <StickyNote className="w-6 h-6" />
              </div>
              <p className="text-slate-300 font-medium mb-1">No notes added yet</p>
              <p className="text-slate-500 text-[11px] leading-relaxed">
                Right-click any node or transition edge on the diagram and select{' '}
                <span className="text-amber-400 font-medium">"Add a note"</span> to annotate it.
              </p>
            </div>
          ) : (
            <>
              {/* State Node Notes */}
              {nodeEntries.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[10px] font-semibold text-sky-400 uppercase tracking-wider flex items-center gap-1">
                    <Layers className="w-3 h-3" /> State Node Notes ({nodeEntries.length})
                  </span>
                  {nodeEntries.map(([nodeId, text]) => {
                    const target: ContextMenuTarget = { type: 'node', id: nodeId, label: nodeId, note: text };
                    return (
                      <div
                        key={`node-note-${nodeId}`}
                        className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-slate-600 transition-colors group space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => onSelectTarget?.(target)}
                            className="font-mono text-[11px] font-semibold text-slate-200 hover:text-sky-300 truncate max-w-[190px] text-left"
                            title="Click to focus node"
                          >
                            {nodeId}
                          </button>
                          <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => onEditNote(target)}
                              className="p-1 text-slate-400 hover:text-amber-300 hover:bg-slate-700/60 rounded"
                              title="Edit note"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => onDeleteNote(target)}
                              className="p-1 text-slate-400 hover:text-red-400 hover:bg-slate-700/60 rounded"
                              title="Delete note"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="text-slate-300 text-[11px] whitespace-pre-wrap leading-relaxed bg-slate-900/50 p-2 rounded-lg border border-slate-800/80">
                          {text}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Edge Notes */}
              {edgeEntries.length > 0 && (
                <div className="space-y-2 pt-2">
                  <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                    <ArrowRight className="w-3 h-3" /> Transition Notes ({edgeEntries.length})
                  </span>
                  {edgeEntries.map(([edgeKey, text]) => {
                    let from = '';
                    let to = '';
                    if (edgeKey.includes('->')) {
                      const parts = edgeKey.split('->');
                      from = parts[0] || '';
                      to = (parts[1] || '').split('#')[0] || '';
                    } else {
                      const m = edgeKey.match(/^(?:flowchart-|edge-|L-)?([A-Za-z0-9_.-]+)-([A-Za-z0-9_.-]+?)(?:-\d+)?$/);
                      if (m) {
                        from = m[1];
                        to = m[2];
                      } else {
                        from = edgeKey;
                      }
                    }
                    const target: ContextMenuTarget = { type: 'edge', id: edgeKey, from, to, note: text };
                    return (
                      <div
                        key={`edge-note-${edgeKey}`}
                        className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-slate-600 transition-colors group space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => onSelectTarget?.(target)}
                            className="font-mono text-[11px] font-semibold text-slate-200 hover:text-amber-300 truncate max-w-[190px] text-left flex items-center gap-1"
                            title="Click to focus transition"
                          >
                            <span>{from}</span>
                            <ArrowRight className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                            <span>{to}</span>
                          </button>
                          <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => onEditNote(target)}
                              className="p-1 text-slate-400 hover:text-amber-300 hover:bg-slate-700/60 rounded"
                              title="Edit note"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => onDeleteNote(target)}
                              className="p-1 text-slate-400 hover:text-red-400 hover:bg-slate-700/60 rounded"
                              title="Delete note"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="text-slate-300 text-[11px] whitespace-pre-wrap leading-relaxed bg-slate-900/50 p-2 rounded-lg border border-slate-800/80">
                          {text}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        {totalNotes > 0 && (
          <div className="p-3 border-t border-slate-800 bg-slate-800/30 flex items-center justify-between">
            <button
              onClick={onClearAllNotes}
              className="text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear All Notes</span>
            </button>
            {onOpenMermaidLive && (
              <button
                onClick={onOpenMermaidLive}
                className="text-[11px] text-slate-300 hover:text-slate-100 hover:bg-slate-800 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <ExternalLink className="w-3 h-3 text-indigo-400" />
                <span>Open in Live</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
