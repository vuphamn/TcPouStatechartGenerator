import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { caretAnchor } from '../utils/caretAnchor.ts';
import { usePendingSave } from '../utils/pendingSaves.ts';
import { Blocks, ChevronDown, ChevronUp, Copy, FileCode2, FoldVertical, RotateCcw, Save, Search, UnfoldVertical, X } from 'lucide-react';
import { StructuredTextCodeEditor, StructuredTextCodeEditorRef } from './StructuredTextCodeEditor.tsx';
import { getPouBody } from '../utils/pouBody.ts';
import { detectFoldableBlocks, getAllFoldableBlockIds } from '../utils/stCodeFolding.ts';
import { findMatchesInCode, FindMatch } from '../utils/stFindHighlight.ts';
import { findSymbolDeclarationLine, findTypeTarget, resolveSymbolFromText } from '../utils/stSymbolDefinition.ts';
import { getAllMethodsFromPou } from '../utils/pouStateEditor.ts';
import { MethodEditorContextMenu } from './MethodEditorContextMenu.tsx';
import { editorServices, openTypeHandlerFor } from '../utils/openType.ts';
import { declarationVariables, declareInDeclaration, guessType, undeclaredNames } from '../utils/pouVariables.ts';
import { DeclareVariableDialog } from './DeclareVariableForm.tsx';
import { markersFor } from '../utils/variableLint.ts';
import { SaveToFileButton } from './SaveToFileButton.tsx';
import { SHOW_EDITOR_DIFF_EVENT, openDiff, showFileDiff, useFileChanged } from './DiffDialog.tsx';
import { GitCompare } from 'lucide-react';
import { BODY, bookmarkedLines, clearBookmarks, declarationKey, toggleLineBookmark, useBookmarks } from '../utils/bookmarks.ts';

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
  /** Go to a symbol's declaration (a new nonce each request: Go to Definition from another POU) */
  reveal?: { symbol: string; nonce: number; line?: number; part?: 'declaration' | 'implementation' } | null;
}

const SPLIT_KEY = 'kss.pouEditor.split';

export const PouCodeEditor: React.FC<PouCodeEditorProps> = ({ pouContent, pouFileName, onSave, onToast, onOpenMethod, reveal }) => {
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
  // Its changes, line by line (its Diff button; the "*" on its tab)
  // Its Diff: opened by the app (a popup, or its dock tab beside the canvas), from this editor's parts in the pending
  // saves' registry (so it sees what is typed here meanwhile)
  const setDiffOpen = (on: boolean) => {
    if (on) openDiff({ source: 'editor', editorId: 'pou-editor', title: `${pouFileName}: the POU Editor's edits`, beforeLabel: 'in the POU', afterLabel: 'in the editor' });
  };
  // (its file changed since saved: the Diff shows that when this editor has no edits of its own)
  const fileChanged = useFileChanged('pou');
  // (its Diff, and the header's All changes)
  const diffParts = [
    { name: 'Declaration', before: baseRef.current.decl, after: decl, apply: setDecl },
    { name: 'Implementation', before: baseRef.current.impl, after: impl, apply: setImpl },
  ];
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<{ editor: string }>).detail?.editor === 'pou') setDiffOpen(true);
    };
    window.addEventListener(SHOW_EDITOR_DIFF_EVENT, on);
    return () => window.removeEventListener(SHOW_EDITOR_DIFF_EVENT, on);
  }, []);
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
  // (with the actions and properties: Rename works on them too)
  const methods = useMemo(
    () => [
      ...(/<Method\b/i.test(pouContent) ? getAllMethodsFromPou(pouContent) : []),
      ...[...pouContent.matchAll(/<(?:Action|Property)\b[^>]*\bName="([^"]+)"/gi)].map((m) => m[1]),
    ],
    [pouContent]
  );

  const goToDefinition = useCallback(
    (symbol: string, memberOf?: string) => {
      const sym = symbol.trim();
      if (!sym) return;
      // A member of another POU's instance (smAxis.bDone): that POU, at the member
      if (memberOf) {
        const tt = findTypeTarget([decl], sym, memberOf);
        const opener = tt?.member ? openTypeHandlerFor(tt.type) : null;
        if (tt?.member && opener) {
          opener.open(tt.type, 'machinescope', tt.member);
          return;
        }
      }
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
        // (a property: its Get accessor)
        const property = new RegExp(`<Property\\b[^>]*\\bName="${method}"[^>]*>[\\s\\S]*?<Get\\b`, 'i').test(pouContent);
        onOpenMethod(property ? `${method}.Get()` : `${method}()`);
        return;
      }
      // A type (another POU of the project): opened in MachineScope
      const typeTarget = findTypeTarget([decl], sym, memberOf);
      const opener = typeTarget?.isTypeItself ? openTypeHandlerFor(typeTarget.type) : null;
      if (typeTarget && opener) {
        opener.open(typeTarget.type, 'machinescope');
        return;
      }
      showNotice('warning', `'${sym}' is not declared in ${body.name || 'the POU'} (a base class, a GVL or a library?)`);
    },
    [decl, methods, onOpenMethod, showNotice, body.name]
  );

  // Go to Definition from another POU: to the member's declaration once this POU is shown
  const goToRef = useRef(goToDefinition);
  goToRef.current = goToDefinition;
  useEffect(() => {
    if (!reveal) return;
    const t = window.setTimeout(() => {
      // A line (Find All References): that line of the declaration / body
      if (reveal.line && reveal.part === 'implementation') implRef.current?.scrollToLine(reveal.line);
      else if (reveal.line) {
        setDeclHighlight(reveal.line);
        declRef.current?.scrollToLine(reveal.line);
      } else goToRef.current(reveal.symbol);
    }, 120);
    return () => window.clearTimeout(t);
  }, [reveal?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // PLC Bookmarks in the body
  const bookmarkStore = useBookmarks(pouFileName);
  const bodyBookmarks = useMemo(() => bookmarkedLines(pouFileName, BODY, impl), [bookmarkStore, pouFileName, impl]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleBodyBookmark = (line: number) => {
    const r = toggleLineBookmark(pouFileName, BODY, impl, line);
    showNotice('success', r.on ? `Bookmark set at line ${line}` : `Bookmark removed at line ${line}`);
  };
  // (and in the declaration: its own)
  const declKey = declarationKey(BODY);
  const declBookmarks = useMemo(() => bookmarkedLines(pouFileName, declKey, decl), [bookmarkStore, pouFileName, declKey, decl]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleDeclBookmark = (line: number) => {
    const r = toggleLineBookmark(pouFileName, declKey, decl, line, { labels: false });
    showNotice('success', r.on ? `Bookmark set at line ${line} of the declaration` : `Bookmark removed at line ${line} of the declaration`);
  };
  const goToDeclBookmark = (dir: 1 | -1, from: number) => {
    if (!declBookmarks.length) return;
    const target = dir > 0 ? declBookmarks.find((l) => l > from) ?? declBookmarks[0] : [...declBookmarks].reverse().find((l) => l < from) ?? declBookmarks[declBookmarks.length - 1];
    declRef.current?.scrollToLine(target);
    setDeclHighlight(target);
    showNotice('success', `Bookmark ${declBookmarks.indexOf(target) + 1} of ${declBookmarks.length} in the declaration (line ${target})`);
  };
  const goToBodyBookmark = (dir: 1 | -1, from: number) => {
    if (!bodyBookmarks.length) return;
    const target = dir > 0 ? bodyBookmarks.find((l) => l > from) ?? bodyBookmarks[0] : [...bodyBookmarks].reverse().find((l) => l < from) ?? bodyBookmarks[bodyBookmarks.length - 1];
    implRef.current?.scrollToLine(target);
    showNotice('success', `Bookmark ${bodyBookmarks.indexOf(target) + 1} of ${bodyBookmarks.length} (line ${target})`);
  };

  // Declare (a name the code uses but nobody declares) and Rename (a member of the POU)
  const [declaring, setDeclaring] = useState<string | null>(null);
  const declared = useMemo(() => declarationVariables(decl), [decl]);
  const isUndeclared = (sym: string, memberOf?: string) => {
    if (memberOf || !/^[A-Za-z_]\w*$/.test(sym)) return false;
    if (declared.some((v) => v.name.toLowerCase() === sym.toLowerCase()) || methods.some((m) => m.toLowerCase() === sym.toLowerCase())) return false;
    const scope = editorServices()?.scope?.();
    return undeclaredNames(sym, scope?.top ?? [], scope?.knownNames ?? []).length > 0;
  };
  const renameItem = (sym: string) => {
    const services = editorServices();
    if (!services?.rename || !declared.some((v) => v.name.toLowerCase() === sym.toLowerCase())) return null;
    const name = declared.find((v) => v.name.toLowerCase() === sym.toLowerCase())!.name;
    return {
      id: 'editor-menu-rename',
      label: `Rename ${name}…`,
      title: 'In the whole POU: its declaration, body, methods and the guards (a preview first)',
      onSelect: () => (dirtyRef.current ? showNotice('warning', 'Save first (Ctrl+S): the rename works on the saved POU') : services.rename!(name)),
    };
  };
  const menuExtras = (sym: string | null, memberOf?: string, scope?: 'declaration' | 'implementation') => {
    const format = { id: 'editor-menu-format', label: 'Format Document (Shift+Alt+F)', title: 'Re-indent the code by its blocks', onSelect: () => ((scope === 'declaration' ? declRef : implRef).current?.formatDocument()) };
    if (!sym) return [format];
    const items: { id: string; label: string; title?: string; onSelect: () => void }[] = [];
    if (isUndeclared(sym, memberOf)) items.push({ id: 'editor-menu-declare', label: `Declare ${sym}…`, title: 'In the declaration (Shift+F2)', onSelect: () => setDeclaring(sym) });
    const r = renameItem(sym);
    if (r) items.push(r);
    const services = editorServices();
    if (services?.findReferences && !memberOf) items.push({ id: 'editor-menu-find-all-refs', label: `Find All References to ${sym}`, title: 'Every use in the POU: its declaration, body, methods and the guards (Shift+F12)', onSelect: () => services.findReferences!(sym) });
    const asMethod = !memberOf && methods.find((m) => m.toLowerCase() === sym.toLowerCase());
    if (asMethod && services?.renameMethod)
      items.push({ id: 'editor-menu-rename-method', label: `Rename ${new RegExp(`<Action\\b[^>]*\\bName="${asMethod}"`, 'i').test(pouContent) ? 'action' : new RegExp(`<Property\\b[^>]*\\bName="${asMethod}"`, 'i').test(pouContent) ? 'property' : 'method'} ${asMethod}…`, title: 'Its declaration and every call (a preview first)', onSelect: () => (dirtyRef.current ? showNotice('warning', 'Save first (Ctrl+S): the rename works on the saved POU') : services.renameMethod!(asMethod)) });
    if (services?.watchVariable) {
      const path = memberOf ? `${memberOf}.${sym}` : sym;
      const on = services.isWatched?.(path);
      items.push({ id: 'editor-menu-watch', label: on ? `Stop watching ${path}` : `Watch ${path} in Live`, title: 'Its value, listed in the Live tab while live', onSelect: () => services.watchVariable!(path) });
    }
    items.push(format);
    return items;
  };

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

  usePendingSave('pou-editor', `the POU Editor (${pouFileName})`, dirty, () => save(), () => diffParts);

  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (dirty) save();
    } else if (e.key === 'F3') {
      e.preventDefault();
      goTo(active + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'F2' && e.ctrlKey && e.currentTarget.id === 'pou-implementation-editor') {
      e.preventDefault();
      const ta = e.currentTarget;
      toggleBodyBookmark(toCodeLine(lineAt(ta.value, ta.selectionStart)));
    } else if (e.key === 'F2' && e.ctrlKey && e.currentTarget.id === 'pou-declaration-editor') {
      e.preventDefault();
      toggleDeclBookmark(lineAt(e.currentTarget.value, e.currentTarget.selectionStart));
    } else if (e.key === 'F12' && e.shiftKey) {
      e.preventDefault();
      const ta = e.currentTarget;
      const resolved = resolveSymbolFromText(ta.value, ta.selectionStart, ta.selectionEnd);
      if (resolved?.symbol) editorServices()?.findReferences?.(resolved.symbol);
    } else if (e.key === 'F6' && e.shiftKey) {
      // Rename in place: the field at the name, its uses highlighted (the Find's whole-word match) while it is open
      e.preventDefault();
      const ta = e.currentTarget;
      const resolved = resolveSymbolFromText(ta.value, ta.selectionStart, ta.selectionEnd);
      const sym = resolved?.symbol;
      const services = editorServices();
      if (!sym || resolved?.memberOf) return;
      if (dirtyRef.current) return showNotice('warning', 'Save first (Ctrl+S): the rename works on the saved POU');
      const start = ta.value.slice(0, ta.selectionStart).search(/[A-Za-z_]\w*$/);
      const anchor = caretAnchor(ta, start >= 0 ? start : ta.selectionStart, sym.length);
      const before = { query, wholeWord, matchCase };
      setQuery(sym);
      setWholeWord(true);
      setMatchCase(false);
      const done = () => {
        setQuery(before.query);
        setWholeWord(before.wholeWord);
        setMatchCase(before.matchCase);
      };
      const v = declared.find((x) => x.name.toLowerCase() === sym.toLowerCase());
      const m = methods.find((x) => x.toLowerCase() === sym.toLowerCase());
      if (v && services?.rename) services.rename(v.name, undefined, { anchor, done });
      else if (m && services?.renameMethod) services.renameMethod(m, { anchor, done });
      else {
        done();
        showNotice('warning', `'${sym}' is no variable, method, property or action of this POU`);
      }
    } else if (e.key === 'F2' && e.shiftKey) {
      // Declare the name at the caret (as TwinCAT's Auto Declare)
      e.preventDefault();
      const ta = e.currentTarget;
      const resolved = resolveSymbolFromText(ta.value, ta.selectionStart, ta.selectionEnd);
      if (resolved?.symbol && isUndeclared(resolved.symbol, resolved.memberOf)) setDeclaring(resolved.symbol);
      else if (resolved?.symbol) showNotice('warning', `'${resolved.symbol}' is declared already (or is no variable)`);
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
    <div id="pou-editor" data-save-scope="pou-editor" className="flex-1 min-h-0 w-full flex flex-col bg-slate-950 text-xs">
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
          <button type="button" id="pou-editor-diff" onClick={() => (((dirty)) ? setDiffOpen(true) : showFileDiff('pou'))} disabled={!((dirty) || fileChanged)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition-colors disabled:opacity-40" title={((dirty)) ? "This editor's edits, line by line (against what is in the POU now)" : "The POU's changes since it was saved (the canvas' edits too); this editor has none of its own"}><GitCompare className="w-3.5 h-3.5" /><span>Diff</span></button>
          <SaveToFileButton id="pou-editor-save-file" what="the POU" />
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
              completionScope={() => editorServices()?.scope?.() ?? null}
              markers={markersFor(editorServices()?.problems?.() ?? [], decl, { declaration: true })}
              onKeyDown={onEditorKeyDown}
              onContextMenu={openMenu('declaration')}
              bookmarkLines={declBookmarks}
              onBookmarkClick={toggleDeclBookmark}
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
                completionScope={() => editorServices()?.scope?.() ?? null}
                markers={markersFor(editorServices()?.problems?.() ?? [], impl, { declaration: false })}
                bookmarkLines={bodyBookmarks}
                onBookmarkClick={toggleBodyBookmark}
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

      {declaring && (
        <DeclareVariableDialog
          initial={{ name: declaring, type: guessType(declaring), scope: 'VAR' }}
          known={declared}
          types={editorServices()?.scope?.().types ?? []}
          scopes={['VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT']}
          title={`Declare a variable in ${body.name || 'the POU'}`}
          onCancel={() => setDeclaring(null)}
          onDone={(v) => {
            setDecl((d) => declareInDeclaration(d, [v]));
            setDeclaring(null);
            showNotice('success', `Declared ${v.name} : ${v.type} in ${v.scope} (not saved yet: Ctrl+S)`);
          }}
        />
      )}

      {menu && (
        <MethodEditorContextMenu
          x={menu.x}
          y={menu.y}
          targetSymbol={menu.symbol}
          targetMemberOf={menu.memberOf}
          typeTarget={menu.symbol ? findTypeTarget([decl], menu.symbol, menu.memberOf) : null}
          extraItems={menuExtras(menu.symbol, menu.memberOf, menu.scope)}
          bookmarks={
            menu.scope === 'implementation'
              ? {
                  on: bodyBookmarks.includes(menu.line),
                  scopeLabel: 'the body',
                  count: bodyBookmarks.length,
                  onToggle: () => toggleBodyBookmark(menu.line),
                  onNext: () => goToBodyBookmark(1, menu.line),
                  onPrev: () => goToBodyBookmark(-1, menu.line),
                  onClearMethod: () => clearBookmarks(pouFileName, BODY, impl),
                  onClearAll: () => clearBookmarks(pouFileName),
                  onShowAll: editorServices()?.showBookmarks,
                }
              : {
                  on: declBookmarks.includes(menu.line),
                  scopeLabel: 'the declaration',
                  count: declBookmarks.length,
                  onToggle: () => toggleDeclBookmark(menu.line),
                  onNext: () => goToDeclBookmark(1, menu.line),
                  onPrev: () => goToDeclBookmark(-1, menu.line),
                  onClearMethod: () => clearBookmarks(pouFileName, declKey, decl),
                  onClearAll: () => clearBookmarks(pouFileName),
                  onShowAll: editorServices()?.showBookmarks,
                }
          }
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
