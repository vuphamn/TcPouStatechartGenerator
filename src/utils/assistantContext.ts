/**
 * The statechart's selection for AI assistants (VS Code: written by the extension to .machinescope/selection.md in a
 * folder set up for it): the selected state as Markdown: its POU and file, its CASE branch (method, lines, code), its
 * transitions out (in their order) and in, its description, its documentation (MachineScope's, in the layout file), its
 * problems, the PLC's state when live. %POU_PATH% is put in by the extension (the POU's path in the folder).
 */
export interface AssistantContextInput {
  pou: string;
  layoutFile: string;
  method: string;
  stateVar: string;
  enumType: string;
  state: { id: string; description?: string; isInitial?: boolean; compositeGroup?: string } | null;
  /** Its CASE branch: the method's line of its label (1-based) and its lines */
  branch: { line: number; code: string[] } | null;
  outgoing: { to: string; condition?: string; priority?: number }[];
  incoming: { from: string; condition?: string }[];
  documentation: string;
  problems: string[];
  live?: { connected: boolean; state?: string | null; sinceMs?: number | null; plc?: string } | null;
  now?: Date;
}

const cond = (c?: string) => (c && c.trim() ? `\`${c.replace(/\s+/g, ' ').trim()}\`` : 'always (no condition)');

export function assistantContextMarkdown(o: AssistantContextInput): string {
  const now = o.now ?? new Date();
  const head = ['# MachineScope selection', '', `Updated: ${now.toISOString()} (rewritten each time the selection in the statechart changes)`, ''];
  if (!o.state) return [...head, `POU: ${o.pou} (\`%POU_PATH%\`)`, '', 'No state selected: select one in the statechart, or ask which state is meant.', ''].join('\n');
  const s = o.state;
  const lines = [
    ...head,
    `- **Selected state:** \`${s.id}\`${s.isInitial ? ' (the initial state)' : ''}${s.compositeGroup ? ` (in the composite ${s.compositeGroup})` : ''}`,
    `- **POU:** ${o.pou}, file \`%POU_PATH%\``,
    `- **State machine:** \`CASE ${o.stateVar} OF\` in \`${o.method}()\`; its enum \`${o.enumType || '?'}\` (the state in code: \`${o.enumType ? `${o.enumType}.` : ''}${s.id}\`)`,
    `- **Description** (its line in \`getStateDescription()\`): ${s.description ? `'${s.description}'` : 'none yet'}`,
    `- **Documentation** (MachineScope's, in \`${o.layoutFile}\` → \`notes.nodes["${s.id}"]\`): ${o.documentation.trim() ? 'below' : 'none yet'}`,
  ];
  if (o.live?.connected) lines.push(`- **Live** (${o.live.plc ?? 'the PLC'}): the PLC is in \`${o.live.state ?? '?'}\`${o.live.sinceMs != null ? ` for ${Math.round(o.live.sinceMs / 1000)} s` : ''}${o.live.state === s.id ? ' (this state)' : ''}`);
  lines.push('', `## Its code: the CASE branch in ${o.method}()${o.branch ? `, from line ${o.branch.line} of its implementation` : ''}`, '');
  if (o.branch) lines.push('```st', ...o.branch.code, '```');
  else lines.push('No CASE branch: the state is in the enum only (nothing runs in it).');
  lines.push('', '## Transitions out (in their order: the first whose condition is true is taken)', '');
  if (o.outgoing.length) o.outgoing.forEach((t, i) => lines.push(`${i + 1}. → \`${t.to}\` when ${cond(t.condition)}`));
  else lines.push('None: once in it, the state machine stays (unless reset elsewhere).');
  lines.push('', '## Transitions in', '');
  if (o.incoming.length) for (const t of o.incoming) lines.push(`- \`${t.from}\` → when ${cond(t.condition)}`);
  else lines.push(s.isInitial ? 'None (the initial state).' : 'None: no other state leads to it.');
  lines.push('', '## Its documentation', '', o.documentation.trim() ? o.documentation.trim() : '_None yet._');
  lines.push('', '## Problems on it (MachineScope)', '');
  if (o.problems.length) for (const p of o.problems) lines.push(`- ${p.replace(/\s+/g, ' ')}`);
  else lines.push('None.');
  lines.push('');
  return lines.join('\n');
}
