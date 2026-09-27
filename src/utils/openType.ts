/**
 * What the code editors can ask of the app (they are rendered in several places, so the app registers it here
 * instead of passing it down): open a POU type from Go to Definition, in StateScope (XAE, desktop) or in TwinCAT's
 * editor (XAE), a member of it too; the names a method's code sees (completion, the undeclared check); rename a
 * variable; declare variables in the POU.
 */
import type { SymbolScope } from './projectSymbols.ts';
import type { NewVariable } from './pouVariables.ts';

export type OpenTypeWhere = 'statescope' | 'xae';

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
  rename?: (name: string, method?: string) => void;
  /** Declare variables in the POU's declaration (written at once); false: not done (the reason was shown) */
  declare?: (vars: NewVariable[]) => boolean;
  /** Find All References: every use of a name in the POU, listed (a click opens it) */
  findReferences?: (name: string) => void;
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
