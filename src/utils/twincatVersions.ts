/**
 * The PLC's TwinCAT build against the XAE's (the XAE edition's Live tab): the same family (4024 / 4026), or a note
 * why not. A project saved by 4026's XAE may no longer open in 4024's; 4024's XAE may not download to a 4026 runtime.
 */

/** Its family: 4026 and later, else 4024 (4022's XAE is the same Visual Studio 2017 shell) */
const familyOf = (build: number) => (build >= 4026 ? 4026 : 4024);

/** Live: the PLC's runtime and the XAE's builds; a warning when they differ in family (null: none, or not known) */
export function versionWarning(plc: number | null | undefined, xae: number | null | undefined): string | null {
  if (!plc || !xae || familyOf(plc) === familyOf(xae)) return null;
  return familyOf(xae) > familyOf(plc)
    ? `The PLC runs TwinCAT 3.1.${plc}, this XAE is TwinCAT ${xae}'s: a project saved here may no longer open in ${familyOf(plc)}'s XAE. For this PLC, TwinCAT ${familyOf(plc)}'s TcXaeShell keeps the project as it is.`
    : `The PLC runs TwinCAT 3.1.${plc}, newer than this XAE (TwinCAT ${xae}'s): it may not download to it. Use TwinCAT ${familyOf(plc)}'s XAE for this PLC.`;
}
