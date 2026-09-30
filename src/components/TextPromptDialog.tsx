import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { NewVariable, PouVariable, guessType, undeclaredNames } from '../utils/pouVariables.ts';
import { SymbolScope, completionAt } from '../utils/projectSymbols.ts';
import { checkConditionSyntax } from '../utils/conditionSyntax.ts';
import { DEFAULT_SCOPES, DeclareVariableForm } from './DeclareVariableForm.tsx';
import { highlightStructuredText } from '../utils/stSyntaxHighlighter.ts';

export interface TextPromptRequest {
  /** Called when it closes (submitted or not) */
  onDismiss?: () => void;
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  hint?: string;
  submitLabel?: string;
  monospace?: boolean;
  /** Why the value cannot be used (shown under the field), or null */
  validate?: (value: string) => string | null;
  /** declarations: the variables declared in the dialog (code's), to add to the POU */
  onSubmit: (value: string, declarations?: NewVariable[]) => void;
  /** A confirmation: no text field (Enter / the button confirms) */
  confirmOnly?: boolean;
  /** Lines listed under the label (what the action changes) */
  details?: string[];
  /** The button in red (a deletion) */
  danger?: boolean;
  /**
   * Code: the names offered while typing (Ctrl+Space, the Variables button), the members after a dot (a.b.), new
   * variables declared, undeclared names pointed out
   */
  scope?: SymbolScope;
  /** The value is a condition: its ST syntax checked while typing */
  condition?: boolean;
  /** Several lines of code (an action): Enter adds a line, Ctrl+Enter confirms */
  multiline?: boolean;
  /** Opened by a spot on the screen (a transition's label) instead of in the middle */
  anchor?: { x: number; y: number; width?: number; height?: number };
  /** Right on the anchor (a label edited in place): just the field, Enter / Esc */
  inline?: boolean;
  /** Lines shown under the field for the value typed (e.g. a rename's changes) */
  preview?: (value: string) => string[];
  /** The scopes offered when declaring */
  declareScopes?: NewVariable['scope'][];
  /** Another way to go, left of the buttons (the dialog closes first) */
  altAction?: { id: string; label: string; title?: string; run: () => void };
  /** The Cancel button's label, and what closing without a choice does (Cancel, Esc, ×, a click outside) */
  cancelLabel?: string;
  onCancel?: () => void;
}

/** A name with the part matching what is typed marked */
function highlight(name: string, typed: string) {
  const at = typed ? name.toLowerCase().indexOf(typed.toLowerCase()) : -1;
  if (at < 0) return name;
  return (
    <>
      {name.slice(0, at)}
      <mark className="text-prompt-var-match bg-transparent text-sky-300 font-semibold">{name.slice(at, at + typed.length)}</mark>
      {name.slice(at + typed.length)}
    </>
  );
}

type Field = HTMLInputElement | HTMLTextAreaElement;

/** A small modal asking for one line of text or code (Electron has no window.prompt) */
export const TextPromptDialog: React.FC<{ request: TextPromptRequest; onClose: () => void }> = ({ request, onClose }) => {
  const [value, setValue] = useState(request.initial ?? '');
  const cancel = () => {
    request.onCancel?.();
    onClose();
  };
  const inputRef = useRef<Field | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (request.confirmOnly) submitRef.current?.focus();
    inputRef.current?.focus();
    if (request.multiline) inputRef.current?.setSelectionRange(0, 0);
    else inputRef.current?.select();
  }, [request.confirmOnly, request.multiline]);

  // By a spot on the screen: beside it, inside the window
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!request.anchor || !dialogRef.current) return;
    const r = dialogRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - r.width - 8, request.anchor.x - r.width / 2));
    if (request.inline) {
      // (over the label: its field where the label is)
      setPlaced({ left, top: Math.max(8, Math.min(window.innerHeight - r.height - 8, request.anchor.y - 17)) });
      return;
    }
    const below = request.anchor.y + 16;
    const top = below + r.height > window.innerHeight - 8 ? Math.max(8, request.anchor.y - r.height - 16) : below;
    setPlaced({ left, top });
  }, [request.anchor, request.inline]);

  // Names (code): the list at the caret's word, and the variables declared here
  const scope = request.confirmOnly ? undefined : request.scope;
  const picker = Boolean(scope);
  const [caret, setCaret] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<NewVariable[]>([]);
  const [declaring, setDeclaring] = useState<{ v: NewVariable; replace: { start: number; end: number } | null } | null>(null);
  const top = useMemo<PouVariable[]>(
    () => [...(scope?.top ?? []), ...pending.map((p) => ({ name: p.name, type: p.type, scope: `${p.scope} (new)`, comment: p.comment }))],
    [scope, pending]
  );
  const at = completionAt(value, caret);
  const chainKey = at.chain ? at.chain.join('.') : null;
  // After "a.b.": the members of what it is (THIS^.: the POU's own)
  const members = useMemo(() => (at.chain && at.chain.length ? scope?.members(at.chain) ?? null : null), [scope, chainKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const inChain = !!at.chain && at.chain.length > 0;
  const pool = inChain ? members ?? [] : top;
  const options = useMemo(() => {
    const w = at.word.toLowerCase();
    if (!w) return pool;
    const starts = pool.filter((v) => v.name.toLowerCase().startsWith(w));
    return [...starts, ...pool.filter((v) => !starts.includes(v) && v.name.toLowerCase().includes(w))];
  }, [pool, at.word]);
  const known = useMemo(() => [...top, ...(scope?.knownNames ?? []).map((n) => ({ name: n, type: '', scope: '' }))], [top, scope]);
  const canDeclare = !at.chain && /^[A-Za-z_]\w*$/.test(at.word) && undeclaredNames(at.word, known).length > 0;
  const rows = options.length + (canDeclare ? 1 : 0);
  const showList = picker && listOpen && !declaring && rows > 0;
  // (without the project's types, the names may be in the base class, a GVL or a library: said so)
  const undeclared = picker ? undeclaredNames(value, top, scope?.knownNames ?? []) : [];
  // (nothing highlighted when no name matches: Enter confirms the dialog, Declare is a click or an arrow away)
  useEffect(() => setActive(options.length ? 0 : -1), [at.word, listOpen, options.length]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const trackCaret = () => setCaret(inputRef.current?.selectionStart ?? 0);
  const placeCaret = (pos: number) =>
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  const insert = (name: string, range: { start: number; end: number } | null = at) => {
    if (!range) return;
    const next = value.slice(0, range.start) + name + value.slice(range.end);
    setValue(next);
    setListOpen(false);
    placeCaret(range.start + name.length);
  };
  const startDeclare = (name: string, replace: { start: number; end: number } | null) => {
    setListOpen(false);
    setDeclaring({ v: { name, type: guessType(name), scope: (request.declareScopes ?? DEFAULT_SCOPES)[0] }, replace });
  };
  const pick = (row: number) => {
    if (row >= 0 && row < options.length) insert(options[row].name);
    else if (canDeclare) startDeclare(at.word, { start: at.start, end: at.end });
  };

  const text = request.multiline ? value.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '') : value.trim();
  const syntax = request.condition ? checkConditionSyntax(text) : null;
  const error = request.confirmOnly ? null : (request.validate ? request.validate(text) : null) ?? syntax;
  const submit = () => {
    if (error || declaring) return;
    if (picker) request.onSubmit(text, pending);
    else request.onSubmit(text);
    onClose();
  };
  const preview = request.preview && !error ? request.preview(text) : [];
  const fieldClass = `w-full bg-slate-950 border rounded px-2 py-1.5 text-slate-100 ${request.monospace ? 'font-mono' : ''} ${error && value ? 'border-rose-600' : 'border-slate-700'}`;
  const onFieldKeyDown = (e: React.KeyboardEvent<Field>) => {
    e.stopPropagation();
    if (picker && e.key === ' ' && e.ctrlKey) {
      e.preventDefault();
      trackCaret();
      setListOpen(true);
      return;
    }
    if (showList) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (Math.max(a, e.key === 'ArrowDown' ? -1 : 0) + (e.key === 'ArrowDown' ? 1 : rows - 1)) % rows);
        return;
      }
      // (a name typed out already: Enter confirms / adds the line)
      const done = active < 0 || (active < options.length && options[active].name === at.word);
      if ((e.key === 'Enter' && !done && !e.ctrlKey) || (e.key === 'Tab' && active >= 0)) {
        e.preventDefault();
        pick(active);
        return;
      }
      if (e.key === 'Escape') {
        setListOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && (!request.multiline || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') cancel();
  };
  const fieldProps = {
    id: 'text-prompt-input',
    value,
    placeholder: request.placeholder,
    autoComplete: 'off',
    spellCheck: false,
    onChange: (e: React.ChangeEvent<Field>) => {
      setValue(e.target.value);
      setCaret(e.target.selectionStart ?? 0);
      // Typing a name (or a dot) lists what matches
      if (picker) setListOpen(/[\w.]$/.test(e.target.value.slice(0, e.target.selectionStart ?? 0)));
    },
    onSelect: trackCaret,
    onClick: trackCaret,
    onBlur: () =>
      setTimeout(() => {
        if (!listRef.current?.contains(document.activeElement)) setListOpen(false);
      }, 150),
    onKeyDown: onFieldKeyDown,
  };
  const chainType = inChain && at.chain ? scope?.typeOf(at.chain) : null;
  return (
    <div
      id="text-prompt-overlay"
      className={`fixed inset-0 z-[80] ${request.inline ? '' : request.anchor ? 'bg-black/20' : 'flex items-center justify-center bg-black/50'}`}
      onMouseDown={(e) => e.target === e.currentTarget && cancel()}
    >
      <div
        id="text-prompt-dialog"
        ref={dialogRef}
        role="dialog"
        aria-label={request.title}
        style={request.anchor ? { position: 'fixed', left: placed?.left ?? -9999, top: placed?.top ?? -9999 } : undefined}
        data-inline={request.inline ? 'true' : undefined}
        className={`${request.inline ? 'w-[440px] rounded-lg ring-2 ring-sky-500/70' : picker ? (request.multiline ? (request.monospace ? 'w-[860px]' : 'w-[680px]') : 'w-[580px]') : 'w-[480px]'} max-w-[92vw] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-xs`}
        onKeyDown={(e) => {
          if (!request.confirmOnly) return;
          if (e.key === 'Escape') cancel();
          e.stopPropagation();
        }}
      >
        <div className={`flex items-center justify-between px-4 py-2.5 border-b border-slate-800 ${request.inline ? 'hidden' : ''}`}>
          <span className="font-semibold text-slate-100">{request.title}</span>
          <button onClick={cancel} className="p-0.5 text-slate-400 hover:text-white rounded" title="Cancel (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className={request.inline ? 'p-1.5 space-y-1.5' : 'p-4 space-y-2'}>
          <label htmlFor="text-prompt-input" className={request.inline ? 'sr-only' : 'block text-slate-300'}>
            {request.label}
          </label>
          {request.details && request.details.length > 0 && (
            <ul id="text-prompt-details" className="max-h-48 overflow-y-auto rounded bg-slate-950 border border-slate-800 px-3 py-2 space-y-0.5 font-mono text-[11px] text-slate-300 list-disc list-inside">
              {request.details.map((d, i) => (
                <li key={i} className="break-words">
                  {d}
                </li>
              ))}
            </ul>
          )}
          {!request.confirmOnly && (
            <div className="relative flex gap-1.5 items-start">
              <div className="flex-1 min-w-0">
                {request.multiline ? (
                  request.monospace ? (
                    // Code: highlighted behind the field (its text transparent over it, the caret shown), one line on one line
                    <div className="relative rounded bg-slate-950">
                      <pre
                        ref={highlightRef}
                        id="text-prompt-highlight"
                        aria-hidden
                        className="prism-code absolute inset-0 m-0 overflow-hidden pointer-events-none rounded border border-transparent px-2 py-1.5 font-mono leading-5 whitespace-pre [tab-size:4] text-slate-100"
                        dangerouslySetInnerHTML={{ __html: `${highlightStructuredText(value)}\n` }}
                      />
                      <textarea
                        {...fieldProps}
                        ref={(el) => {
                          inputRef.current = el;
                        }}
                        rows={Math.min(24, Math.max(8, (request.initial ?? '').split('\n').length + 1))}
                        wrap="off"
                        onScroll={(e) => {
                          const h = highlightRef.current;
                          if (h) {
                            h.scrollTop = e.currentTarget.scrollTop;
                            h.scrollLeft = e.currentTarget.scrollLeft;
                          }
                        }}
                        className={`relative block w-full bg-transparent text-transparent caret-slate-100 selection:bg-sky-700/50 border rounded px-2 py-1.5 font-mono leading-5 whitespace-pre [tab-size:4] resize-y ${error && value ? 'border-rose-600' : 'border-slate-700'}`}
                      />
                    </div>
                  ) : (
                    <textarea
                      {...fieldProps}
                      ref={(el) => {
                        inputRef.current = el;
                      }}
                      rows={8}
                      className={`${fieldClass} resize-y leading-5`}
                    />
                  )
                ) : (
                  <input
                    {...fieldProps}
                    ref={(el) => {
                      inputRef.current = el;
                    }}
                    className={fieldClass}
                  />
                )}
              </div>
              {picker && (
                <button
                  id="text-prompt-vars-btn"
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    trackCaret();
                    setListOpen((o) => !o);
                    inputRef.current?.focus();
                  }}
                  className="flex items-center gap-1 px-2 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 shrink-0"
                  title="The names you can use here (Ctrl+Space); after a dot, the members"
                >
                  Variables <ChevronDown className="w-3.5 h-3.5" />
                </button>
              )}
              {showList && (
                <div
                  id="text-prompt-var-list"
                  ref={listRef}
                  role="listbox"
                  className="absolute left-0 right-0 top-full mt-1 z-10 max-h-56 overflow-y-auto rounded-md bg-slate-950 border border-slate-700 shadow-2xl py-1"
                >
                  {inChain && (
                    <div id="text-prompt-members-of" className="px-2.5 pb-1 text-[10px] text-slate-500 border-b border-slate-800">
                      Members of <span className="font-mono">{at.chain!.join('.')}</span>
                      {chainType ? (
                        <>
                          {' '}: <span className="font-mono">{chainType.name}</span>
                        </>
                      ) : null}
                    </div>
                  )}
                  {options.map((v, i) => (
                    <div
                      key={v.name + v.scope}
                      data-row={i}
                      data-name={v.name}
                      role="option"
                      aria-selected={i === active}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => setActive(i)}
                      onClick={() => pick(i)}
                      className={`text-prompt-var flex items-center gap-2 px-2.5 py-1 cursor-pointer font-mono ${i === active ? 'bg-sky-700/40 text-white' : 'text-slate-200'}`}
                      title={v.comment}
                    >
                      <span className="truncate">{highlight(v.name, at.word)}</span>
                      {v.type && <span className="text-slate-400 truncate">: {v.type}</span>}
                      <span className="ml-auto text-[10px] text-slate-500 shrink-0">{v.scope}</span>
                    </div>
                  ))}
                  {canDeclare && (
                    <div
                      id="text-prompt-declare-new"
                      data-row={options.length}
                      role="option"
                      aria-selected={active === options.length}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => setActive(options.length)}
                      onClick={() => pick(options.length)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 cursor-pointer border-t border-slate-800 ${active === options.length ? 'bg-emerald-700/30 text-white' : 'text-emerald-300'}`}
                    >
                      <Plus className="w-3.5 h-3.5" /> Declare new variable <span className="font-mono">{at.word}</span>…
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {declaring && (
            <DeclareVariableForm
              initial={declaring.v}
              known={known}
              types={scope?.types ?? []}
              scopes={request.declareScopes}
              onCancel={() => {
                setDeclaring(null);
                placeCaret(caret);
              }}
              onDone={(v) => {
                setPending((p) => [...p, v]);
                const replace = declaring.replace;
                setDeclaring(null);
                if (replace) insert(v.name, replace);
                else placeCaret(caret);
              }}
            />
          )}
          {pending.length > 0 && (
            <div id="text-prompt-new-vars" className="flex flex-wrap gap-1.5">
              {pending.map((p) => (
                <span key={p.name} className="text-prompt-new-var inline-flex items-center gap-1 rounded bg-emerald-950/50 border border-emerald-800/70 px-1.5 py-0.5 font-mono text-[11px] text-emerald-200" title="Declared in the POU when the dialog is confirmed">
                  + {p.scope} {p.name} : {p.type}
                  <button type="button" onClick={() => setPending((all) => all.filter((x) => x !== p))} className="text-emerald-400 hover:text-white" title="Do not declare it">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {error && value ? (
            <div id="text-prompt-error" className="text-rose-300">{error}</div>
          ) : undeclared.length > 0 && !declaring ? (
            <div id="text-prompt-undeclared" className="flex flex-wrap items-center gap-1.5 text-amber-300">
              Not declared in the POU:
              {undeclared.map((n) => (
                <button key={n} type="button" data-name={n} onClick={() => startDeclare(n, null)} className="text-prompt-undeclared font-mono underline decoration-dotted hover:text-amber-100" title={`Declare ${n}…`}>
                  {n}
                </button>
              ))}
              <span className="text-slate-500">{scope?.complete === false ? "(click to declare; it may be the base class's, a GVL's or a library's)" : "(click to declare; a GVL's or a library's needs none)"}</span>
            </div>
          ) : request.inline ? (
            <div className="text-[10px] text-slate-500 px-0.5">Enter: change · Esc: cancel · Ctrl+Space: the names</div>
          ) : request.hint ? (
            <div className="text-slate-500">
              {request.hint}
              {picker ? ` · Ctrl+Space: the names${request.multiline ? ' · Ctrl+Enter: done' : ''}` : ''}
            </div>
          ) : null}
          {preview.length > 0 && (
            <ul id="text-prompt-preview" className="max-h-48 overflow-y-auto rounded bg-slate-950 border border-slate-800 px-3 py-2 space-y-0.5 font-mono text-[11px] text-slate-300">
              {preview.map((d, i) => (
                <li key={i} className={`break-words whitespace-pre-wrap ${/^\+ /.test(d) ? 'text-emerald-300' : /^- /.test(d) ? 'text-rose-300' : ''}`}>
                  {d}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={`flex justify-end gap-2 px-4 py-2.5 border-t border-slate-800 ${request.inline ? 'hidden' : ''}`}>
          {request.altAction && (
            <button
              id={request.altAction.id}
              onClick={() => {
                const run = request.altAction!.run;
                onClose();
                setTimeout(run, 0);
              }}
              title={request.altAction.title}
              className="mr-auto px-3 py-1 rounded-md text-sky-300 hover:bg-slate-800"
            >
              {request.altAction.label}
            </button>
          )}
          <button id="text-prompt-cancel" onClick={cancel} className="px-3 py-1 rounded-md text-slate-300 hover:bg-slate-800">
            {request.cancelLabel ?? 'Cancel'}
          </button>
          <button
            id="text-prompt-submit"
            ref={submitRef}
            onClick={submit}
            disabled={!!error || !!declaring}
            className={`px-3 py-1 rounded-md text-white font-semibold disabled:opacity-40 ${request.danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-sky-600 hover:bg-sky-500'}`}
          >
            {request.submitLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
};
