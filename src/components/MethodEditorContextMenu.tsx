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
  Undo2,
  Redo2,
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
  /** The POU type of the symbol (see findTypeTarget): it can be opened in MachineScope / TwinCAT's editor */
  typeTarget?: { type: string; isTypeItself: boolean; member?: string } | null;
  /** PLC Bookmarks for the line right-clicked (in its section: an implementation, a declaration, the enum) */
  bookmarks?: {
    on: boolean;
    count: number;
    /** The section its Clear clears ("this method", "the declaration", "the enum") */
    scopeLabel?: string;
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
  // The editor right-clicked (it has the focus then): its own Undo / Redo, as Ctrl+Z / Ctrl+Y in it
  const editorRef = useRef<HTMLTextAreaElement | null>(document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null);
  const editStep = (cmd: 'undo' | 'redo') => {
    const ta = editorRef.current;
    onClose();
    if (!ta) return;
    ta.focus();
    ta.ownerDocument.execCommand(cmd);
  };
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
  const menuHeight = (openType ? 320 : 220) + (extraItems?.length ?? 0) * 28 + (bookmarks ? 30 : 0) + (editorRef.current ? 64 : 0);
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
        {/* Undo / Redo: the editor's own (its typing, a snippet, a rename in place) */}
        {editorRef.current && (
          <>
            {([
              ['undo', 'Undo', 'Ctrl+Z', Undo2, "Undo the last change in this editor (its own undo: the canvas' edits are undone there)"],
              ['redo', 'Redo', 'Ctrl+Y', Redo2, 'Redo the change undone last in this editor'],
            ] as const).map(([cmd, label, keys, Icon, title]) => (
              <button
                key={cmd}
                id={`editor-menu-${cmd}`}
                type="button"
                role="menuitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editStep(cmd)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left text-slate-200 hover:text-white hover:bg-slate-800 cursor-pointer"
                title={title}
              >
                <span className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-slate-400" />
                  <span className="font-medium text-[11px]">{label}</span>
                </span>
                <span className="text-[10px] font-mono text-slate-400 px-1 py-0.5 rounded bg-slate-800/80">{keys}</span>
              </button>
            ))}
            <div className="my-1 border-t border-slate-800" />
          </>
        )}
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
                  {openType && member ? `Open ${openType}.${member} in MachineScope` : openType && typeTarget?.isTypeItself ? `Open ${openType} in MachineScope` : 'Highlight in Top Panel'}
                </span>
              )}
            </div>
          </div>
          <span className="text-[10px] font-mono text-slate-400 px-1 py-0.5 rounded bg-slate-800/80 shrink-0">
            F12
          </span>
        </button>

        {/* The symbol's POU type: open it in MachineScope, or in TwinCAT's editor */}
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
                Open <span className="font-mono">{member ? `${openType}.${member}` : openType}</span> in MachineScope
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

        {/* PLC Bookmarks: the line's toggled at once; the others in a submenu */}
        {bookmarks && (
          <>
            <div className="my-1 border-t border-slate-800" />
            <button
              id="editor-menu-bookmark-quick"
              type="button"
              role="menuitem"
              title="A bookmark on this line (Ctrl+F2): the Bookmarks list and Next / Previous go to it"
              onClick={() => {
                bookmarks.onToggle();
                onClose();
              }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Bookmark className={`w-3.5 h-3.5 shrink-0 ${bookmarks.on ? 'text-sky-300 fill-sky-400' : 'text-slate-400'}`} />
                <span className="font-medium text-[11px] leading-tight">{bookmarks.on ? 'Remove Bookmark' : 'Toggle Bookmark'}</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Ctrl+F2</span>
            </button>
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
                  <span className="font-medium text-[11px] leading-tight">Bookmarks</span>
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
                      ['editor-menu-bookmark-clear', `Clear All Bookmarks (${bookmarks.scopeLabel ?? 'this method'})`, '', bookmarks.onClearMethod, bookmarks.count === 0],
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
