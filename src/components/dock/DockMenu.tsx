import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

export interface DockMenuItem {
  id: string;
  label?: string;
  icon?: React.ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  /** Small uppercase section heading */
  heading?: boolean;
  hint?: string;
}

interface DockMenuProps {
  x: number;
  y: number;
  items: DockMenuItem[];
  onClose: () => void;
  id?: string;
}

/** Context / dropdown menu rendered at viewport coordinates, clamped to stay on screen */
export const DockMenu: React.FC<DockMenuProps> = ({ x, y, items, onClose, id = 'dock-context-menu' }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleDown, true);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', handleDown, true);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[200] min-w-[220px] max-h-[80vh] overflow-y-auto py-1 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl text-xs text-slate-200"
    >
      {items.map((item) => {
        if (item.separator) return <div key={item.id} className="h-px my-1 bg-slate-800" />;
        if (item.heading) {
          return (
            <div key={item.id} className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {item.label}
            </div>
          );
        }
        return (
          <button
            key={item.id}
            id={`dock-menu-${item.id}`}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-sky-600/80 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-200 transition-colors"
          >
            <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0 text-slate-400">
              {item.checked ? <Check className="w-3.5 h-3.5 text-sky-400" /> : item.icon}
            </span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint && <span className="text-[10px] text-slate-500 shrink-0">{item.hint}</span>}
          </button>
        );
      })}
    </div>,
    document.body
  );
};
