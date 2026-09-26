/**
 * State names in Structured Text. An enum with {attribute 'qualified_only'} is written with its type name:
 * "E_KSupplyManager_States.DISABLED:" as a CASE label, "machineState := E_KSupplyManager_States.ERROR;" as a
 * transition. The app names states by their member ("DISABLED", "ERROR"), like the enum declares them.
 */

/** E_Type.MEMBER -> MEMBER (a plain name stays as it is) */
export function unqualifyState(name: string): string {
  const t = name.trim();
  const dot = t.lastIndexOf('.');
  return dot >= 0 ? t.slice(dot + 1).trim() : t;
}

/** One state as written: MEMBER or E_Type.MEMBER (regex source) */
export const STATE_NAME_SRC = String.raw`(?:[A-Za-z_]\w*\s*\.\s*)?[A-Za-z_]\w*`;
/** CASE labels: one or more state names separated by commas (regex source) */
export const STATE_LABELS_SRC = `${STATE_NAME_SRC}(?:\\s*,\\s*${STATE_NAME_SRC})*`;

/**
 * A line holding only CASE labels ("  STATE_A:", "E_X.A, E_X.B:  // note"), captured in group 1. Global and
 * multi-line: a new object each call, as exec() keeps its position.
 */
export function caseLabelLinePattern(): RegExp {
  return new RegExp(String.raw`^[ \t]*(${STATE_LABELS_SRC})\s*:(?!=)(?:\s*(?:\/\/[^\n]*|\(\*[\s\S]*?\*\)))?\s*$`, 'gm');
}

/** The labels of a CASE label group, unqualified */
export function splitStateLabels(labels: string): string[] {
  return labels.split(',').map(unqualifyState).filter(Boolean);
}

/**
 * The qualifier a CASE's labels use ("E_KSupplyManager_States."), or "" when they are plain: a new branch or
 * transition is written the same way (a qualified_only enum only compiles that way).
 */
export function stateQualifier(code: string, stateVar = 'machineState'): string {
  const escaped = stateVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const label = code.match(/^[ \t]*([A-Za-z_]\w*)\s*\.\s*[A-Za-z_]\w*\s*(?:,[^:\n]*)?:(?!=)/m);
  if (label) return `${label[1]}.`;
  const assign = code.match(new RegExp(String.raw`\b${escaped}\s*:=\s*([A-Za-z_]\w*)\s*\.\s*[A-Za-z_]\w*`, 'i'));
  return assign ? `${assign[1]}.` : '';
}
