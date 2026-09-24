import React, { useState, useEffect, useRef } from 'react';
import { StickyNote, X, Trash2, Check, ArrowRight, Layers, Sparkles } from 'lucide-react';
import { ContextMenuTarget } from '../types.ts';

interface NoteDialogProps {
  isOpen: boolean;
  target: ContextMenuTarget | null;
  currentNote?: string;
  onClose: () => void;
  onSave: (target: ContextMenuTarget, noteText: string) => void;
  onDelete?: (target: ContextMenuTarget) => void;
}

export const NoteDialog: React.FC<NoteDialogProps> = ({
  isOpen,
  target,
  currentNote = '',
  onClose,
  onSave,
  onDelete,
}) => {
  const [noteText, setNoteText] = useState(currentNote);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setNoteText(currentNote || '');
      setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      }, 50);
    }
  }, [isOpen, currentNote]);

  // Handle keyboard shortcuts (Ctrl+Enter to save, Escape to cancel)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, noteText, target]);

  if (!isOpen || !target || target.type === 'canvas') {
    return null;
  }

  const handleSave = () => {
    if (!target) return;
    onSave(target, noteText.trim());
    onClose();
  };

  const handleDelete = () => {
    if (!target || !onDelete) return;
    onDelete(target);
    onClose();
  };

  const isEdge = target.type === 'edge';
  const hasExisting = Boolean(currentNote && currentNote.trim());

  return (
    <div
      id="note-dialog-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="note-dialog-modal"
        className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700/90 shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-800/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <StickyNote className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                {hasExisting ? 'Edit Note' : 'Add Note'}
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                    isEdge
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                      : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                  }`}
                >
                  {isEdge ? 'Transition' : 'State Node'}
                </span>
              </h3>
              <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                {isEdge ? (
                  <>
                    <ArrowRight className="w-3 h-3 text-amber-400 shrink-0" />
                    <span className="font-mono text-slate-200">
                      {target.from} → {target.to}
                    </span>
                    {target.label && <span className="text-slate-400">({target.label})</span>}
                  </>
                ) : (
                  <>
                    <Layers className="w-3 h-3 text-sky-400 shrink-0" />
                    <span className="font-mono text-slate-200">{target.label || target.id}</span>
                  </>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 hover:bg-slate-800 p-1.5 rounded-lg transition-colors"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4">
          <div>
            <label
              htmlFor="note-textarea"
              className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between"
            >
              <span>Note Content</span>
              <span className="text-[11px] text-slate-500 font-mono">
                {noteText.length} characters
              </span>
            </label>
            <textarea
              id="note-textarea"
              ref={textareaRef}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={
                isEdge
                  ? "e.g. Guard condition details, trigger signals, timeout constraints..."
                  : "e.g. Safety requirements, entry/do/exit behavior, hardware dependency..."
              }
              rows={4}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700/80 text-slate-100 placeholder-slate-500 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all resize-y min-h-[100px]"
            />
          </div>

          {/* Info Banner */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-medium text-slate-200">Mermaid & Live Export Synchronization</span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                This note will be rendered directly inside the diagram layout and will be fully preserved
                when exporting or viewing in <span className="text-amber-300 font-medium">mermaid.live</span>.
              </p>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-800 bg-slate-800/30">
          <div>
            {hasExisting && onDelete && (
              <button
                type="button"
                id="note-dialog-delete-btn"
                onClick={handleDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/15 transition-colors border border-transparent hover:border-red-500/30"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove Note</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              id="note-dialog-save-btn"
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold shadow-lg shadow-amber-500/20 transition-colors"
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Save Note</span>
              <span className="text-[10px] opacity-75 font-normal ml-0.5">Ctrl+↵</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
