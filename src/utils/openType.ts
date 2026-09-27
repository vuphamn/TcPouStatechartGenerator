/**
 * Opening a POU type from the code editors' Go to Definition (the editors are rendered in several places, so the
 * app registers what it can do here instead of passing it down): in StateScope (XAE, desktop) or in TwinCAT's editor
 * (XAE only). Not set in the web edition (it cannot open project files by name).
 */
export type OpenTypeWhere = 'statescope' | 'xae';

export interface OpenTypeHandler {
  open: (type: string, where: OpenTypeWhere) => void;
  /** TwinCAT's editor can open it (the XAE edition) */
  xae: boolean;
  /** The loaded POU's name (its own type is not offered) */
  current?: string;
}

let handler: OpenTypeHandler | null = null;

export function setOpenTypeHandler(h: OpenTypeHandler | null): void {
  handler = h;
}

/** The handler, when the type is one it can open (not the loaded POU itself) */
export function openTypeHandlerFor(type: string | undefined | null): OpenTypeHandler | null {
  if (!handler || !type) return null;
  if (handler.current && handler.current.toLowerCase() === type.toLowerCase()) return null;
  return handler;
}
