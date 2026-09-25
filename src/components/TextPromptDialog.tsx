import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export interface TextPromptRequest {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  hint?: string;
  submitLabel?: string;
  monospace?: boolean;
  /** Why the value cannot be used (shown under the field), or null */
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
}

/** A small modal asking for one line of text (Electron has no window.prompt) */
export const TextPromptDialog: React.FC<{ request: TextPromptRequest; onClose: () => void }> = ({ request, onClose }) => {
  const [value, setValue] = useState(request.initial ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const error = request.validate ? request.validate(value.trim()) : null;
  const submit = () => {
    if (error) return;
    request.onSubmit(value.trim());
    onClose();
  };
  return (
    <div id="text-prompt-overlay" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div id="text-prompt-dialog" role="dialog" aria-label={request.title} className="w-[440px] max-w-[92vw] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
          <span className="font-semibold text-slate-100">{request.title}</span>
          <button onClick={onClose} className="p-0.5 text-slate-400 hover:text-white rounded" title="Cancel (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-2">
          <label htmlFor="text-prompt-input" className="block text-slate-300">
            {request.label}
          </label>
          <input
            id="text-prompt-input"
            ref={inputRef}
            value={value}
            placeholder={request.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') onClose();
              e.stopPropagation();
            }}
            className={`w-full bg-slate-950 border rounded px-2 py-1.5 text-slate-100 ${request.monospace ? 'font-mono' : ''} ${error && value ? 'border-rose-600' : 'border-slate-700'}`}
          />
          {error && value ? <div id="text-prompt-error" className="text-rose-300">{error}</div> : request.hint ? <div className="text-slate-500">{request.hint}</div> : null}
        </div>
        <div className="flex justify-end gap-2 px-4 py-2.5 border-t border-slate-800">
          <button onClick={onClose} className="px-3 py-1 rounded-md text-slate-300 hover:bg-slate-800">
            Cancel
          </button>
          <button id="text-prompt-submit" onClick={submit} disabled={!!error} className="px-3 py-1 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-semibold disabled:opacity-40">
            {request.submitLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
};
