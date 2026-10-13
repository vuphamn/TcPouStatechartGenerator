/**
 * What the code editors can ask of the app (they are rendered in several places, so the app registers it here
 * instead of passing it down): open a POU type from Go to Definition, in MachineScope (XAE, desktop) or in TwinCAT's
 * editor (XAE), a member of it too; the names a method's code sees (completion, the undeclared check); rename a
 * variable; declare variables in the POU.
 */
import type { SymbolScope } from './projectSymbols.ts';
import type { NewVariable } from './pouVariables.ts';

export type OpenTypeWhere = 'machinescope' | 'xae';

/** Rename in place (Shift+F6): the field at the name in the editor; done: it closed (its highlights cleared) */
export interface InlineRename {
  anchor: { x: number; y: number; width?: number; height?: number };
  done?: () => void;
}

export interface OpenTypeHandler {
  /** Open a type (and go to its member). Absent in the web edition: it cannot open project files by name */
  open?: (type: string, where: OpenTypeWhere, member?: string) => void;
  /** TwinCAT's editor can open it (the XAE edition) */
  xae: boolean;
  /** The loaded POU's name (its own type is not offered) */
  current?: string;
  /** The names the code of a method of the loaded POU sees (method: its name; none: the POU's body) */
  scope?: (method?: string) => SymbolScope;
  /** Rename a variable of the POU everywhere (method: a method's own, in it only): asks for the name, previews */
  rename?: (name: string, method?: string, inline?: InlineRename) => void;
  /** Extract Method: lines of a method (1-based, the saved POU's) into a new method; asks for its name */
  extractMethod?: (method: string, startLine: number, endLine: number) => void;
  /** Lines into a new Action (they use only the POU's members) */
  extractAction?: (method: string, startLine: number, endLine: number) => void;
  /** An expression of one line (its columns) into a new property */
  extractProperty?: (method: string, line: number, from: number, to: number) => void;
  /** Blame: who last changed each line of a method's code (git), or why not */
  blame?: (method: string, code: string) => Promise<Map<number, import('./methodBlame.ts').BlameMark> | { error: string }>;
  /** Inline Method: the call on a line (1-based, the saved POU's) replaced by the method's code */
  inlineMethod?: (method: string, line: number) => void;
  /** The state variable, its enum type and the enum's names by value (state names for numbers); null: not known */
  stateNames?: () => { stateVar: string; enumType: string; names: Map<number, string> } | null;
  /** Rename a method / property of the POU (and where other POUs call it): asks for the name, previews */
  renameMethod?: (name: string, inline?: InlineRename) => void;
  /** Declare variables in the POU's declaration (written at once); false: not done (the reason was shown) */
  declare?: (vars: NewVariable[]) => boolean;
  /** Find All References: every use of a name in the POU, listed (a click opens it) */
  findReferences?: (name: string, opts?: { writesOnly?: boolean }) => void;
  /** Call Hierarchy (Shift+Alt+H): who calls the name at the caret (a method, an action, a POU), what it calls; no
   * callable there: the member the caret is in (method: its name; none: the POU's body). memberOf: inst.Name's inst */
  callHierarchy?: (name: string | null, ctx: { method?: string; memberOf?: string }) => void;
  /** The code that ran (live coverage shown: "On the chart"): a method's lines → what ran there; null: none shown */
  executedLines?: (method: string, code: string) => Map<number, import('./executedLines.ts').ExecutedLine> | null;
  /** Type Hierarchy: a type's bases, interfaces and the types extending it (none given: this POU's) */
  typeHierarchy?: (name?: string) => void;
  /** Find in Files (Ctrl+Shift+F): the dialog, with a text to find (the selection or the word at the caret) */
  findInFiles?: (text?: string) => void;
  /** Cross Reference List: every place of a name in the project (its other POUs too), by POU, reads and writes */
  crossReference?: (name: string) => void;
  /** Go to Implementation (Ctrl+F12): an interface's implementations, a method's overrides (one: opened at once) */
  goToImplementation?: (name: string, ctx: { method?: string; memberOf?: string }) => void;
  /** Live: whether connected, the values (by path, lower case) */
  liveValues?: () => { active: boolean; values: Record<string, boolean | number | string> };
  /** Live: the variables the shown code uses (followed while live, for the values in the code) */
  setEditorWatch?: (names: string[]) => void;
  /** Live: a variable added to (or taken off) the watched ones, listed in the Live tab */
  watchVariable?: (name: string) => void;
  isWatched?: (name: string) => boolean;
  /** The list of the POU's bookmarks */
  showBookmarks?: () => void;
  /** The Problems tab's findings (the editors underline theirs) */
  problems?: () => import('./stateMachineLint.ts').LintFinding[];
}

let handler: OpenTypeHandler | null = null;

export function setOpenTypeHandler(h: OpenTypeHandler | null): void {
  handler = h;
}

/** The app's services for the editors (null before the app set them) */
export const editorServices = (): OpenTypeHandler | null => handler;

/** The handler, when the type is one it can open (not the loaded POU itself) */
export function openTypeHandlerFor(type: string | undefined | null): (OpenTypeHandler & { open: NonNullable<OpenTypeHandler['open']> }) | null {
  if (!handler?.open || !type) return null;
  if (handler.current && handler.current.toLowerCase() === type.toLowerCase()) return null;
  return handler as OpenTypeHandler & { open: NonNullable<OpenTypeHandler['open']> };
}
