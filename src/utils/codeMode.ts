/**
 * The VS Code extension's code tab (Kval MachineScope Code): the app showing only its code editors for one member of a
 * .TcPOU, as XAE's editor shows it: the Method Editor (a method, a property's Get / Set, an action) or the POU Editor
 * (the POU's own declaration and body), the declaration above, the implementation below, the splitter between. The
 * extension's page sets window.__KSS_BOOT = { code: { member } } before the app starts; member: the method's name
 * (doState, Speed.Get, Reset), '' for the POU itself.
 */
export interface CodeBoot {
  member: string;
}

export function codeBoot(): CodeBoot | null {
  const b = (window as unknown as { __KSS_BOOT?: { code?: { member?: unknown } } }).__KSS_BOOT?.code;
  return b && typeof b === 'object' ? { member: typeof b.member === 'string' ? b.member : '' } : null;
}

export const isCodeMode = (): boolean => !!codeBoot();
