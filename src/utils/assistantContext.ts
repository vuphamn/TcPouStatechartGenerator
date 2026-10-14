/**
 * The statechart's selection for AI assistants (written by the host to .machinescope/selection.md in a folder set up
 * for it): the selected state, or the states selected together (Ctrl+Click, Shift+drag), as Markdown: each one's code
 * (its CASE branch: method, lines), transitions out (in their order) and in, description, documentation (MachineScope's,
 * in the layout file), problems; the POU and the PLC's state when live. %POU_PATH% is put in by the host (the POU's path
 * in the folder).
 */
export interface AssistantStateBlock {
  state: { id: string; description?: string; isInitial?: boolean; compositeGroup?: string };
  /** Its CASE branch: the method's line of its label (1-based) and its lines */
  branch: { line: number; code: string[] } | null;
  outgoing: { to: string; condition?: string; priority?: number }[];
  incoming: { from: string; condition?: string }[];
  documentation: string;
  problems: string[];
}

export interface AssistantContextInput {
  pou: string;
  layoutFile: string;
  method: string;
  stateVar: string;
  enumType: string;
  /** The selected states: none, one, or several selected together */
  selected: AssistantStateBlock[];
  live?: { connected: boolean; state?: string | null; sinceMs?: number | null; plc?: string } | null;
  now?: Date;
}

const cond = (c?: string) => (c && c.trim() ? `\`${c.replace(/\s+/g, ' ').trim()}\`` : 'always (no condition)');

/** One state's details: its facts, then its code, transitions, documentation, problems (headings at the level given) */
function stateBlock(o: AssistantContextInput, b: AssistantStateBlock, h: string): string[] {
  const s = b.state;
  const lines = [
    `- **State:** \`${s.id}\`${s.isInitial ? ' (the initial state)' : ''}${s.compositeGroup ? ` (in the composite ${s.compositeGroup})` : ''}; in code \`${o.enumType ? `${o.enumType}.` : ''}${s.id}\``,
    `- **Description** (its line in \`getStateDescription()\`): ${s.description ? `'${s.description}'` : 'none yet'}`,
    `- **Documentation** (MachineScope's, in \`${o.layoutFile}\` → \`notes.nodes["${s.id}"]\`): ${b.documentation.trim() ? 'below' : 'none yet'}`,
  ];
  if (o.live?.connected && o.live.state === s.id) lines.push(`- **Live:** the PLC is in it now${o.live.sinceMs != null ? ` (for ${Math.round(o.live.sinceMs / 1000)} s)` : ''}`);
  lines.push('', `${h} Its code: the CASE branch in ${o.method}()${b.branch ? `, from line ${b.branch.line} of its implementation` : ''}`, '');
  if (b.branch) lines.push('```st', ...b.branch.code, '```');
  else lines.push('No CASE branch: the state is in the enum only (nothing runs in it).');
  lines.push('', `${h} Transitions out (in their order: the first whose condition is true is taken)`, '');
  if (b.outgoing.length) b.outgoing.forEach((t, i) => lines.push(`${i + 1}. → \`${t.to}\` when ${cond(t.condition)}`));
  else lines.push('None: once in it, the state machine stays (unless reset elsewhere).');
  lines.push('', `${h} Transitions in`, '');
  if (b.incoming.length) for (const t of b.incoming) lines.push(`- \`${t.from}\` → when ${cond(t.condition)}`);
  else lines.push(s.isInitial ? 'None (the initial state).' : 'None: no other state leads to it.');
  lines.push('', `${h} Its documentation`, '', b.documentation.trim() ? b.documentation.trim() : '_None yet._');
  lines.push('', `${h} Problems on it (MachineScope)`, '');
  if (b.problems.length) for (const p of b.problems) lines.push(`- ${p.replace(/\s+/g, ' ')}`);
  else lines.push('None.');
  return lines;
}

export function assistantContextMarkdown(o: AssistantContextInput): string {
  const now = o.now ?? new Date();
  const head = ['# MachineScope selection', '', `Updated: ${now.toISOString()} (rewritten each time the selection in the statechart changes)`, ''];
  const machine = `- **State machine:** \`CASE ${o.stateVar} OF\` in \`${o.method}()\`; its enum \`${o.enumType || '?'}\``;
  const pou = `- **POU:** ${o.pou}, file \`%POU_PATH%\``;
  const live = o.live?.connected ? [`- **Live** (${o.live.plc ?? 'the PLC'}): the PLC is in \`${o.live.state ?? '?'}\`${o.live.sinceMs != null ? ` for ${Math.round(o.live.sinceMs / 1000)} s` : ''}`] : [];
  if (!o.selected.length) return [...head, pou, '', 'No state selected: select one in the statechart, or ask which state is meant.', ''].join('\n');
  if (o.selected.length === 1) {
    const [b] = o.selected;
    return [...head, `- **Selected state:** \`${b.state.id}\``, pou, machine, ...live, ...stateBlock(o, b, '##'), ''].join('\n');
  }
  // (several selected together: "the selected states" are all of them; each its own section)
  const lines = [...head, `- **Selected states (${o.selected.length}, selected together):** ${o.selected.map((b) => `\`${b.state.id}\``).join(', ')}`, pou, machine, ...live];
  for (const b of o.selected) lines.push('', `## ${b.state.id}`, '', ...stateBlock(o, b, '###'));
  lines.push('');
  return lines.join('\n');
}
