import React, { useEffect, useRef } from 'react';
import {
  ArrowUpRight,
  Search,
  Copy,
  Check,
  FoldVertical,
  Code2,
  FileCode2,
  ExternalLink,
  Bookmark,
  ChevronRight,
} from 'lucide-react';
import { openTypeHandlerFor } from '../utils/openType.ts';

export interface MethodEditorContextMenuProps {
  x: number;
  y: number;
  targetSymbol: string | null;
  targetMemberOf?: string;
  onGoToDefinition: (symbol: string, memberOf?: string) => void;
  onFindReferences?: (symbol: string) => void;
  onCopySymbol?: (symbol: string) => void;
  onToggleFoldCurrent?: () => void;
  /** The POU type of the symbol (see findTypeTarget): it can be opened in StateScope / TwinCAT's editor */
  typeTarget?: { type: string; isTypeItself: boolean; member?: string } | null;
  /** PLC Bookmarks for the line right-clicked (the implementation) */
  bookmarks?: {
    on: boolean;
    count: number;
    onToggle: () => void;
    onNext: () => void;
    onPrev: () => void;
    onClearMethod: () => void;
    onClearAll: () => void;
    onShowAll?: () => void;
  };
  /** More actions on the symbol (Declare…, Rename…) */
  extraItems?: { id: string; label: React.ReactNode; title?: string; onSelect: () => void }[];
  onClose: () => void;
}

export const MethodEditorContextMenu: React.FC<MethodEditorContextMenuProps> = ({
  x,
  y,
  targetSymbol,
  targetMemberOf,
  onGoToDefinition,
  onFindReferences,
  onCopySymbol,
  onToggleFoldCurrent,
  typeTarget,
  extraItems,
  bookmarks,
  onClose,
}) => {
  const [bookmarksOpen, setBookmarksOpen] = React.useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = React.useState(false);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('scroll', onClose, true);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  // Adjust coordinates to ensure menu stays fully within viewport
  const menuWidth = 260;
  const opener = openTypeHandlerFor(typeTarget?.type);
  const openType = opener && typeTarget ? typeTarget.type : null;
  const member = typeTarget?.member;
  const menuHeight = (openType ? 320 : 220) + (extraItems?.length ?? 0) * 28 + (bookmarks ? 30 : 0);
  const clampedX = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, x));
  const clampedY = Math.max(8, Math.min(window.innerHeight - menuHeight - 8, y));

  const hasSymbol = Boolean(targetSymbol && targetSymbol.trim());

  const handleGoToDef = () => {
    if (!targetSymbol) return;
    onGoToDefinition(targetSymbol, targetMemberOf);
    onClose();
  };

  const handleFind = () => {
    if (!targetSymbol) return;
    onFindReferences?.(targetSymbol);
    onClose();
  };

  const handleCopy = () => {
    if (!targetSymbol) return;
    if (onCopySymbol) {
      onCopySymbol(targetSymbol);
    } else {
      navigator.clipboard.writeText(targetSymbol).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      onClose();
    }, 400);
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Editor Context Menu"
      style={{ left: `${clampedX}px`, top: `${clampedY}px` }}
      className="fixed z-50 w-64 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-lg shadow-2xl p-1 font-sans text-xs select-none animate-in fade-in zoom-in-95 duration-100 ring-1 ring-black/50"
    >
      {/* Target Symbol Header */}
      {hasSymbol && (
        <div className="px-2.5 py-1.5 border-b border-slate-800 text-[11px] text-slate-400 flex items-center justify-between gap-1.5 font-mono">
          <div className="flex items-center gap-1.5 min-w-0">
            <Code2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="truncate font-semibold text-slate-200" title={targetSymbol!}>
              {targetMemberOf ? `${targetMemberOf}.${targetSymbol}` : targetSymbol}
            </span>
          </div>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 shrink-0">
            Symbol
          </span>
        </div>
      )}

      <div className="py-1">
        {/* Go to Definition (F12) */}
        <button
          type="button"
          role="menuitem"
          disabled={!hasSymbol}
          onClick={handleGoToDef}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left transition-colors cursor-pointer ${
            hasSymbol
              ? 'text-sky-300 hover:text-white hover:bg-sky-600/30 focus:bg-sky-600/30'
              : 'text-slate-500 cursor-not-allowed'
          }`}
          title={
            hasSymbol
              ? `Jump to definition of '${targetSymbol}' in the Top Panel (F12)`
              : 'Place cursor on or select a variable or function'
          }
        >
          <div className="flex items-center gap-2 min-w-0">
            <ArrowUpRight className={`w-4 h-4 shrink-0 ${hasSymbol ? 'text-sky-400' : 'text-slate-600'}`} />
            <div className="flex flex-col min-w-0">
              <span className="font-medium text-[11px] leading-tight">Go to Definition</span>
              {hasSymbol && (
                <span className="text-[10px] text-sky-400/80 truncate font-mono">
                  {openType && member ? `Open ${openType}.${member} in StateScope` : openType && typeTarget?.isTypeItself ? `Open ${openType} in StateScope` : 'Highlight in Top Panel'}
                </span>
              )}
            </div>
          </div>
          <span className="text-[10px] font-mono text-slate-400 px-1 py-0.5 rounded bg-slate-800/80 shrink-0">
            F12
          </span>
        </button>

        {/* The symbol's POU type: open it in StateScope, or in TwinCAT's editor */}
        {openType && opener && (
          <>
            <div className="my-1 border-t border-slate-800" />
            <button
              id="editor-menu-open-type-statescope"
              type="button"
              role="menuitem"
              onClick={() => {
                opener.open(openType, 'statescope', member);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title={`Open ${openType}.TcPOU of the PLC project here (Back returns)`}
            >
              <FileCode2 className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <span className="font-medium text-[11px] leading-tight truncate">
                Open <span className="font-mono">{member ? `${openType}.${member}` : openType}</span> in StateScope
              </span>
            </button>
            {opener.xae && (
              <button
                id="editor-menu-open-type-xae"
                type="button"
                role="menuitem"
                onClick={() => {
                  opener.open(openType, 'xae', member);
                  onClose();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer mt-0.5"
                title={`Open ${openType} in TwinCAT's editor`}
              >
                <ExternalLink className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="font-medium text-[11px] leading-tight truncate">
                  Open <span className="font-mono">{member ? `${openType}.${member}` : openType}</span> in the TwinCAT editor
                </span>
              </button>
            )}
            <div className="my-1 border-t border-slate-800" />
          </>
        )}

        {/* Declare…, Rename… */}
        {extraItems?.map((item) => (
          <button
            key={item.id}
            id={item.id}
            type="button"
            role="menuitem"
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title={item.title}
          >
            <span className="font-medium text-[11px] leading-tight truncate">{item.label}</span>
          </button>
        ))}

        {/* Find References / Search */}
        {hasSymbol && onFindReferences && (
          <button
            type="button"
            role="menuitem"
            onClick={handleFind}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer mt-0.5"
            title={`Find references to '${targetSymbol}'`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Search className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="font-medium text-[11px] leading-tight">Find References</span>
            </div>
            <span className="text-[10px] font-mono text-slate-400 px-1 py-0.5 rounded bg-slate-800/80 shrink-0">
              Ctrl+F
            </span>
          </button>
        )}

        {/* Copy Symbol Name */}
        {hasSymbol && (
          <button
            type="button"
            role="menuitem"
            onClick={handleCopy}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer mt-0.5"
            title="Copy symbol identifier to clipboard"
          >
            <div className="flex items-center gap-2 min-w-0">
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              <span className="font-medium text-[11px] leading-tight">
                {copied ? 'Copied to Clipboard!' : 'Copy Symbol Name'}
              </span>
            </div>
          </button>
        )}

        {/* PLC Bookmarks: a submenu */}
        {bookmarks && (
          <>
            <div className="my-1 border-t border-slate-800" />
            <div className="relative" onMouseEnter={() => setBookmarksOpen(true)} onMouseLeave={() => setBookmarksOpen(false)}>
              <button
                id="editor-menu-bookmarks"
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={bookmarksOpen}
                onClick={() => setBookmarksOpen(true)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Bookmark className={`w-3.5 h-3.5 shrink-0 ${bookmarks.on ? 'text-sky-300 fill-sky-400' : 'text-slate-400'}`} />
                  <span className="font-medium text-[11px] leading-tight">PLC Bookmarks</span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
              </button>
              {bookmarksOpen && (
                <div
                  id="editor-menu-bookmarks-sub"
                  role="menu"
                  className={`absolute top-0 ${clampedX + menuWidth + 250 > window.innerWidth ? 'right-full mr-1' : 'left-full ml-1'} w-60 bg-slate-900/95 border border-slate-700/80 rounded-lg shadow-2xl p-1`}
                >
                  {(
                    [
                      ['editor-menu-bookmark-toggle', bookmarks.on ? 'Remove Bookmark' : 'Toggle Bookmark', 'Ctrl+F2', bookmarks.onToggle, false],
                      ['editor-menu-bookmark-next', 'Next Bookmark', '', bookmarks.onNext, bookmarks.count === 0],
                      ['editor-menu-bookmark-prev', 'Previous Bookmark', '', bookmarks.onPrev, bookmarks.count === 0],
                      ['editor-menu-bookmark-clear', 'Clear All Bookmarks (this method)', '', bookmarks.onClearMethod, bookmarks.count === 0],
                      ['editor-menu-bookmark-clear-all', 'Clear All Bookmarks (the POU)', '', bookmarks.onClearAll, false],
                      ...(bookmarks.onShowAll ? [['editor-menu-bookmark-list', 'Show All Bookmarks…', '', bookmarks.onShowAll, false]] : []),
                    ] as [string, string, string, () => void, boolean][]
                  ).map(([id, label, keys, run, disabled]) => (
                    <button
                      key={id}
                      id={id}
                      type="button"
                      role="menuitem"
                      disabled={disabled}
                      onClick={() => {
                        run();
                        onClose();
                      }}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left text-slate-300 hover:text-white hover:bg-slate-800 disabled:text-slate-600 disabled:hover:bg-transparent transition-colors cursor-pointer"
                    >
                      <span className="font-medium text-[11px] leading-tight">{label}</span>
                      {keys && <span className="text-[10px] font-mono text-slate-400 px-1 py-0.5 rounded bg-slate-800/80 shrink-0">{keys}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Optional Fold / Unfold Block */}
        {onToggleFoldCurrent && (
          <>
            <div className="my-1 border-t border-slate-800" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onToggleFoldCurrent();
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Toggle fold state of enclosing block"
            >
              <FoldVertical className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-medium text-[11px] leading-tight">Toggle Block Fold</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
