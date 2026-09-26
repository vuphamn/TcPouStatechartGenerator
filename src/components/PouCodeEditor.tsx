import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Blocks, ChevronDown, ChevronUp, Copy, FileCode2, FoldVertical, RotateCcw, Save, Search, UnfoldVertical, X } from 'lucide-react';
import { StructuredTextCodeEditor, StructuredTextCodeEditorRef } from './StructuredTextCodeEditor.tsx';
import { getPouBody } from '../utils/pouBody.ts';
import { detectFoldableBlocks, getAllFoldableBlockIds } from '../utils/stCodeFolding.ts';
import { findMatchesInCode, FindMatch } from '../utils/stFindHighlight.ts';
import { findSymbolDeclarationLine, resolveSymbolFromText } from '../utils/stSymbolDefinition.ts';
import { getAllMethodsFromPou } from '../utils/pouStateEditor.ts';
import { MethodEditorContextMenu } from './MethodEditorContextMenu.tsx';

/**
 * POU Editor (MiddlePanel tab): the POU's own Structured Text, as TwinCAT XAE shows it when the POU is opened: the
 * declaration (FUNCTION_BLOCK ... EXTENDS ..., VAR_INPUT / VAR_OUTPUT / VAR ... END_VAR) on top and the body (the
 * POU's implementation) below. Both are editable; Save writes them into the .TcPOU (its methods stay as they are).
 * The editors have the caret line highlight and Ctrl+mouse wheel zoom of the other code editors.
 */

interface PouCodeEditorProps {
  pouContent: string;
  pouFileName: string;
  /** implementation null: the body is not Structured Text and stays as it is */
  onSave: (declaration: string, implementation: string | null) => { success: boolean; error?: string };
  onToast?: (message: string, type: 'success' | 'error') => void;
  /** Go to Definition on one of the POU's methods: open it in the Method Editor */
  onOpenMethod?: (methodName: string) => void;
}

const SPLIT_KEY = 'kss.pouEditor.split';

export const PouCodeEditor: React.FC<PouCodeEditorProps> = ({ pouContent, pouFileName, onSave, onToast, onOpenMethod }) => {
  // Edited with LF (a textarea has no CRLF); saved with the line ends the POU has
  const raw = useMemo(() => getPouBody(pouContent), [pouContent]);
  const crlf = /\r\n/.test(raw.declaration + raw.implementation);
  const body = useMemo(
    () => ({ ...raw, declaration: raw.declaration.replace(/\r\n/g, '\n'), implementation: raw.implementation.replace(/\r\n/g, '\n') }),
    [raw]
  );
  const [decl, setDecl] = useState(body.declaration);
  const [impl, setImpl] = useState(body.implementation);
  // The version the drafts started from (the POU may change elsewhere: Method Editor, reload from XAE)
  const baseRef = useRef({ decl: body.declaration, impl: body.implementation });
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const dirty = decl !== baseRef.current.decl || impl !== baseRef.current.impl;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const base = baseRef.current;
    if (body.declaration === base.decl && body.implementation === base.impl) return;
    if (!dirtyRef.current) {
      setDecl(body.declaration);
      setImpl(body.implementation);
      baseRef.current = { decl: body.declaration, impl: body.implementation };
      setChangedElsewhere(false);
    } else {
      setChangedElsewhere(true);
    }
  }, [body.declaration, body.implementation]);

  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const save = useCallback(() => {
    const eol = (t: string) => (crlf ? t.replace(/\r?\n/g, '\r\n') : t);
    const r = onSave(eol(decl), body.isStructuredText ? eol(impl) : null);
    if (!r.success) {
      setMessage({ text: r.error || 'Could not save', error: true });
      onToast?.(r.error || 'Could not save the POU', 'error');
      return;
    }
    baseRef.current = { decl, impl };
    setChangedElsewhere(false);
    setMessage({ text: `Saved to ${pouFileName}` });
  }, [onSave, decl, impl, body.isStructuredText, pouFileName, onToast, crlf]);
  const reset = () => {
    setDecl(body.declaration);
    setImpl(body.implementation);
    baseRef.current = { decl: body.declaration, impl: body.implementation };
    setChangedElsewhere(false);
    setMessage(null);
  };

  // Folding of the body
  const foldable = useMemo(() => detectFoldableBlocks(impl), [impl]);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggleFold = useCallback((id: string) => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Top / bottom split (kept per viewer)
  const [split, setSplit] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem(SPLIT_KEY) || '');
      return v > 0.1 && v < 0.9 ? v : 0.42;
    } catch {
      return 0.42;
    }
  });
  const bodyRef = useRef<HTMLDivElement>(null);
  const startSplit = (e: React.MouseEvent) => {
    e.preventDefault();
    const box = bodyRef.current?.getBoundingClientRect();
    if (!box) return;
    let last = split;
    const move = (ev: MouseEvent) => {
      last = Math.min(0.85, Math.max(0.12, (ev.clientY - box.top) / box.height));
      setSplit(last);
    };
    const up = () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      try {
        localStorage.setItem(SPLIT_KEY, String(last));
      } catch {
        // per-viewer convenience only
      }
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  };

  // Find in both panels
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const findOptions = useMemo(() => ({ matchCase, wholeWord }), [matchCase, wholeWord]);
  const matches = useMemo<FindMatch[]>(() => {
    if (!query.trim()) return [];
    const all = [...findMatchesInCode(decl, query, 'declaration', findOptions), ...findMatchesInCode(impl, query, 'implementation', findOptions)];
    return all.map((m, i) => ({ ...m, globalIndex: i }));
  }, [decl, impl, query, findOptions]);
  const [active, setActive] = useState(0);
  const navigatedRef = useRef(false);
  useEffect(() => {
    setActive(0);
    navigatedRef.current = false;
  }, [query, matchCase, wholeWord]);
  const declRef = useRef<StructuredTextCodeEditorRef>(null);
  const implRef = useRef<StructuredTextCodeEditorRef>(null);
  const [lastFocus, setLastFocus] = useState<'declaration' | 'implementation'>('implementation');
  const goTo = useCallback(
    (index: number) => {
      if (!matches.length) return;
      const i = ((index % matches.length) + matches.length) % matches.length;
      navigatedRef.current = true;
      setActive(i);
      const m = matches[i];
      if (m.target === 'implementation') {
        // Unfold what hides it
        const hiding = foldable.filter((b) => folded.has(b.id) && m.originalLineNumber > b.startLine && m.originalLineNumber <= b.endLine);
        if (hiding.length) setFolded((prev) => new Set([...prev].filter((id) => !hiding.some((b) => b.id === id))));
      }
      requestAnimationFrame(() => (m.target === 'declaration' ? declRef : implRef).current?.scrollToLine(m.originalLineNumber));
    },
    [matches, foldable, folded]
  );
  const activeMatch = matches[active];
  const findInputRef = useRef<HTMLInputElement>(null);

  // ---- Right-click menu (as the Method Editor's) ----
  const [menu, setMenu] = useState<{ x: number; y: number; symbol: string | null; memberOf?: string; scope: 'declaration' | 'implementation'; line: number } | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'warning'; text: string } | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const showNotice = useCallback((type: 'success' | 'warning', text: string) => {
    setNotice({ type, text });
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
  }, []);
  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);
  // The declaration line Go to Definition found (highlighted for a moment)
  const [declHighlight, setDeclHighlight] = useState<number | null>(null);
  const [declScroll, setDeclScroll] = useState<number | null>(null);
  useEffect(() => {
    if (declHighlight === null) return;
    const t = window.setTimeout(() => setDeclHighlight(null), 3000);
    return () => window.clearTimeout(t);
  }, [declHighlight]);
  const methods = useMemo(() => (/<Method\b/i.test(pouContent) ? getAllMethodsFromPou(pouContent) : []), [pouContent]);

  const goToDefinition = useCallback(
    (symbol: string, memberOf?: string) => {
      const sym = symbol.trim();
      if (!sym) return;
      const hit = findSymbolDeclarationLine(decl, sym) ?? (memberOf ? findSymbolDeclarationLine(decl, memberOf) : null);
      if (hit) {
        setDeclHighlight(hit.lineNumber);
        setDeclScroll(null);
        requestAnimationFrame(() => {
          setDeclScroll(hit.lineNumber);
          declRef.current?.scrollToLine(hit.lineNumber);
        });
        showNotice('success', `Found definition of '${sym}' at line ${hit.lineNumber} of the declaration`);
        return;
      }
      const method = methods.find((m) => m.toLowerCase() === sym.toLowerCase());
      if (method && onOpenMethod) {
        onOpenMethod(`${method}()`);
        return;
      }
      showNotice('warning', `'${sym}' is not declared in ${body.name || 'the POU'} (a base class, a GVL or a library?)`);
    },
    [decl, methods, onOpenMethod, showNotice, body.name]
  );

  const lineAt = (text: string, pos: number) => text.slice(0, pos).split('\n').length;
  // A line of the body as shown (folded blocks are one line) to its line in the code
  const toCodeLine = (viewLine: number) => {
    const top = foldable
      .filter((b) => folded.has(b.id))
      .filter((b, _i, all) => !all.some((o) => o !== b && folded.has(o.id) && o.startLine < b.startLine && b.endLine <= o.endLine))
      .sort((a, b) => a.startLine - b.startLine);
    let line = viewLine;
    for (const b of top) if (b.startLine < line) line += b.endLine - b.startLine;
    return line;
  };
  const openMenu = (scope: 'declaration' | 'implementation') => (e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const ta = e.currentTarget;
    // (the text as shown: the caret position is in it, folded or not)
    const resolved = resolveSymbolFromText(ta.value, ta.selectionStart, ta.selectionEnd);
    const viewLine = lineAt(ta.value, ta.selectionStart);
    setMenu({ x: e.clientX, y: e.clientY, symbol: resolved?.symbol ?? null, memberOf: resolved?.memberOf, scope, line: scope === 'implementation' ? toCodeLine(viewLine) : viewLine });
  };
  // The innermost block of the body that holds a line (folded placeholders count as their block's first line)
  const blockAt = (line: number) =>
    foldable
      .filter((b) => b.startLine <= line && line <= b.endLine)
      .sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];

  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (dirty) save();
    } else if (e.key === 'F3') {
      e.preventDefault();
      goTo(active + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'F12') {
      e.preventDefault();
      const ta = e.currentTarget;
      const resolved = resolveSymbolFromText(ta.value, ta.selectionStart, ta.selectionEnd);
      if (resolved?.symbol) goToDefinition(resolved.symbol, resolved.memberOf);
    }
  };

  const copy = async () => {
    const text = lastFocus === 'declaration' ? decl : impl;
    try {
      await navigator.clipboard.writeText(text);
      onToast?.(`${lastFocus === 'declaration' ? 'Declaration' : 'Implementation'} copied`, 'success');
    } catch {
      onToast?.('Could not copy to the clipboard', 'error');
    }
  };

  if (!body.found) {
    return (
      <div id="pou-editor" className="flex-1 min-h-0 w-full flex flex-col items-center justify-center gap-2 bg-slate-950 text-xs text-slate-400">
        <FileCode2 className="w-7 h-7 text-slate-600" />
        <p>{body.error || 'No POU loaded'}</p>
      </div>
    );
  }

  const panelTitle = (label: string, hint: string) => (
    <div className="flex items-center gap-2 px-3 py-1 border-b border-slate-800 bg-slate-900/80 text-[11px] shrink-0">
      <span className="font-semibold text-slate-200">{label}</span>
      <span className="text-slate-500">{hint}</span>
    </div>
  );

  return (
    <div id="pou-editor" className="flex-1 min-h-0 w-full flex flex-col bg-slate-950 text-xs">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-800 bg-slate-950/90 shrink-0">
        <Blocks className="w-4 h-4 text-sky-400 shrink-0" />
        <span className="font-semibold tracking-wide text-slate-300">POU EDITOR:</span>
        <span id="pou-editor-name" className="font-mono font-bold text-slate-100">{body.name || pouFileName.replace(/\.TcPOU$/i, '')}</span>
        {body.kind && <span className="px-1.5 rounded bg-slate-800 border border-slate-700 font-mono text-[10px] text-sky-300">{body.kind}</span>}
        {body.extendsName && (
          <span className="font-mono text-[11px] text-slate-400">
            EXTENDS <span className="text-slate-200">{body.extendsName}</span>
          </span>
        )}
        <span className="text-[10px] text-slate-500">{body.methodCount} method{body.methodCount === 1 ? '' : 's'} (Method Editor)</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={copy} className="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800" title="Copy the declaration or the implementation (the one last edited)">
            <Copy className="w-3.5 h-3.5" /> Copy
          </button>
          <button id="pou-editor-reset" onClick={reset} disabled={!dirty && !changedElsewhere} className="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40" title="Back to the POU's current code">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
          <button id="pou-editor-save" onClick={save} disabled={!dirty} className="flex items-center gap-1 px-2.5 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white font-semibold disabled:opacity-40" title="Write the declaration and the body into the .TcPOU (Ctrl+S)">
            <Save className="w-3.5 h-3.5" /> Save to POU
          </button>
        </div>
      </div>

      {/* Find */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-800 shrink-0">
        <div className="relative flex items-center flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 pointer-events-none" />
          <input
            ref={findInputRef}
            id="pou-editor-find"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'F3') {
                e.preventDefault();
                // The first Enter shows the first match, the next ones move on
                goTo(navigatedRef.current ? active + (e.shiftKey ? -1 : 1) : active);
              } else if (e.key === 'Escape') setQuery('');
            }}
            placeholder="Find in the declaration and the body (Enter / F3: next)"
            className="w-full bg-slate-900 border border-slate-700 rounded pl-7 pr-2 py-1 font-mono text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-600"
          />
        </div>
        {query.trim() && (
          <span id="pou-editor-find-count" className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${matches.length ? 'text-sky-300 border-sky-800 bg-sky-950/70' : 'text-rose-300 border-rose-800 bg-rose-950/70'}`}>
            {matches.length ? `${active + 1}/${matches.length}` : '0 found'}
          </span>
        )}
        <button onClick={() => goTo(active - 1)} disabled={!matches.length} className="p-1 rounded text-slate-400 hover:bg-slate-800 disabled:opacity-30" title="Previous (Shift+F3)">
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => goTo(active + 1)} disabled={!matches.length} className="p-1 rounded text-slate-400 hover:bg-slate-800 disabled:opacity-30" title="Next (F3)">
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => setMatchCase((v) => !v)} className={`px-1.5 py-0.5 rounded border font-mono text-[10px] ${matchCase ? 'border-sky-600 text-sky-300 bg-sky-950/60' : 'border-slate-700 text-slate-400'}`} title="Match case">
          Aa
        </button>
        <button onClick={() => setWholeWord((v) => !v)} className={`px-1.5 py-0.5 rounded border font-mono text-[10px] ${wholeWord ? 'border-sky-600 text-sky-300 bg-sky-950/60' : 'border-slate-700 text-slate-400'}`} title="Whole word">
          \b
        </button>
        {query && (
          <button onClick={() => setQuery('')} className="p-1 rounded text-slate-400 hover:bg-slate-800" title="Clear (Esc)">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {notice && (
        <div
          id="pou-editor-notice"
          className={`px-3 py-1 text-[11px] border-b shrink-0 ${notice.type === 'success' ? 'text-emerald-200 bg-emerald-950/40 border-emerald-900' : 'text-amber-200 bg-amber-950/40 border-amber-900'}`}
        >
          {notice.text}
        </div>
      )}

      {changedElsewhere && (
        <div id="pou-editor-changed" className="px-3 py-1 text-[11px] text-amber-200 bg-amber-950/50 border-b border-amber-900 shrink-0">
          The POU was changed elsewhere since you started editing here. Save keeps your version; Reset takes the POU's.
        </div>
      )}

      {/* Declaration (top) and implementation (bottom) */}
      <div ref={bodyRef} className="flex-1 min-h-0 flex flex-col">
        <div className="min-h-0 flex flex-col" style={{ height: `${split * 100}%` }}>
          {panelTitle('Declaration', body.kind ? `${body.kind} ${body.name}${body.extendsName ? ` EXTENDS ${body.extendsName}` : ''}` : '')}
          <div className="flex-1 min-h-0 flex" onFocusCapture={() => setLastFocus('declaration')}>
            <StructuredTextCodeEditor
              ref={declRef}
              id="pou-declaration-editor"
              value={decl}
              onChange={setDecl}
              onKeyDown={onEditorKeyDown}
              onContextMenu={openMenu('declaration')}
              highlightedLine={declHighlight}
              scrollToLine={declScroll}
              ariaLabel="POU declaration"
              findQuery={query}
              findOptions={findOptions}
              activeFindMatchIndex={activeMatch?.target === 'declaration' ? activeMatch.targetIndex : -1}
            />
          </div>
        </div>
        <div
          role="separator"
          aria-orientation="horizontal"
          onMouseDown={startSplit}
          className="h-1.5 shrink-0 cursor-row-resize bg-slate-800 hover:bg-sky-700/70 transition-colors"
          title="Drag to resize the declaration and the implementation"
        />
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center gap-2 px-3 py-1 border-b border-slate-800 bg-slate-900/80 text-[11px] shrink-0">
            <span className="font-semibold text-slate-200">Implementation</span>
            <span className="text-slate-500">{body.isStructuredText ? `the body of ${body.name} (${foldable.length} foldable blocks)` : ''}</span>
            {body.isStructuredText && (
              <span className="ml-auto flex items-center gap-1">
                <button onClick={() => setFolded(new Set(getAllFoldableBlockIds(foldable)))} disabled={!foldable.length} className="flex items-center gap-1 px-1.5 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800 disabled:opacity-30" title="Fold all blocks">
                  <FoldVertical className="w-3 h-3" /> Fold All
                </button>
                <button onClick={() => setFolded(new Set())} disabled={!folded.size} className="flex items-center gap-1 px-1.5 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800 disabled:opacity-30" title="Unfold all blocks">
                  <UnfoldVertical className="w-3 h-3" /> Unfold All
                </button>
              </span>
            )}
          </div>
          {body.isStructuredText ? (
            <div className="flex-1 min-h-0 flex" onFocusCapture={() => setLastFocus('implementation')}>
              <StructuredTextCodeEditor
                ref={implRef}
                id="pou-implementation-editor"
                value={impl}
                onChange={setImpl}
                onKeyDown={onEditorKeyDown}
                onContextMenu={openMenu('implementation')}
                ariaLabel="POU implementation"
                placeholder="(The POU body is empty: its logic is in the methods)"
                enableCodeFolding
                foldableBlocks={foldable}
                foldedBlockIds={folded}
                onToggleFold={toggleFold}
                findQuery={query}
                findOptions={findOptions}
                activeFindMatchIndex={activeMatch?.target === 'implementation' ? activeMatch.targetIndex : -1}
              />
            </div>
          ) : (
            <div id="pou-editor-not-st" className="flex-1 flex items-center justify-center p-4 text-center text-slate-400">
              The body of {body.name} is written in {body.language}, not Structured Text: edit it in TwinCAT XAE. The declaration can be edited here.
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-1 border-t border-slate-800 text-[10px] shrink-0">
        {dirty ? (
          <span id="pou-editor-state" className="text-amber-300">Unsaved changes (Ctrl+S to save to the POU)</span>
        ) : message ? (
          <span id="pou-editor-state" className={message.error ? 'text-rose-300' : 'text-emerald-300'}>
            {message.text}
          </span>
        ) : (
          <span id="pou-editor-state" className="text-slate-500">{pouFileName}</span>
        )}
        <span className="ml-auto text-slate-600">Right-click: Go to Definition (F12) · Ctrl+mouse wheel: text size</span>
      </div>

      {menu && (
        <MethodEditorContextMenu
          x={menu.x}
          y={menu.y}
          targetSymbol={menu.symbol}
          targetMemberOf={menu.memberOf}
          onGoToDefinition={goToDefinition}
          onFindReferences={(sym) => {
            setQuery(sym);
            requestAnimationFrame(() => {
              findInputRef.current?.focus();
              findInputRef.current?.select();
            });
          }}
          onCopySymbol={(sym) => {
            navigator.clipboard.writeText(sym).catch(() => {});
          }}
          onToggleFoldCurrent={
            menu.scope === 'implementation' && blockAt(menu.line)
              ? () => {
                  const b = blockAt(menu.line);
                  if (b) toggleFold(b.id);
                }
              : undefined
          }
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
};
