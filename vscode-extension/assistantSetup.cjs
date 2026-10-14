// AI assistants (Claude Code, and any that reads the folder) told what is selected in MachineScope's statechart: the
// canvas is a webview they cannot see. A folder set up for it (Kval MachineScope: Set up Claude Code for this folder)
// has .machinescope/ (its own .gitignore: git ignores it all), where the selected state is written as Markdown
// (selection.md: its code, transitions, description, documentation, problems, live state) each time it changes, and a
// section in CLAUDE.md (between markers, replaced on a new set-up) that says where to read it and how to document a
// state. A folder without .machinescope/ gets nothing written.
const fs = require('fs');
const path = require('path');

const DIR = '.machinescope';
const SELECTION = 'selection.md';
const START = '<!-- kval-machinescope:start (written by Kval MachineScope: Set up Claude Code for this folder; it replaces this section) -->';
const END = '<!-- kval-machinescope:end -->';

const NOTHING_YET = '# MachineScope selection\n\nNo state selected yet: select one in a Kval MachineScope statechart (VS Code).\n';

/** The CLAUDE.md section: the TwinCAT files, the state machines as MachineScope draws them, the selection, documenting */
function claudeSection() {
  return `${START}
## TwinCAT project and Kval MachineScope

### Files
- \`.TcPOU\` / \`.TcDUT\` / \`.TcGVL\` are XML: the code is in the CDATA of \`<Declaration>\` and \`<ST>\`; each
  \`<Method Name="…">\` has its own. Edit only inside the CDATA; never change the XML around it or any \`Id="{GUID}"\`.
- \`<POU>.machinescope.json\` beside a POU: Kval MachineScope's chart of it (state places, notes, colours, the states'
  documentation). \`MachineScope.*.json\` beside the \`.plcproj\`: coverage, commissioning, alerts. Data, not code.

### State machines (as Kval MachineScope draws them)
- A state machine is a \`CASE <state variable> OF\` in the method \`doState()\` (else the method with a CASE on an enum,
  else the POU's body); its states are the members of the variable's enum (a \`.TcDUT\`).
- A state is its CASE branch; a transition is \`<state variable> := <Enum>.<STATE>;\` in it, its condition the
  \`IF\` / \`ELSIF\` around it (the first true one wins: their order is their priority).

### "The selected state", "the canvas", "this state"
Read \`.machinescope/selection.md\` first: the state selected in the MachineScope statechart (VS Code), rewritten each
time the selection changes: its POU and file, its CASE branch (method and lines), its transitions out (in order) and in,
its description, its documentation, its problems and, when live, the PLC's state. Its "Updated" time says how recent it
is; when it names no state, ask which one.

### Documenting a state (when asked)
- **Its description** (one line, shown under the state): a line in the CASE of the POU's \`getStateDescription()\`,
  before its \`ELSE\` / \`END_CASE\`, like the others: \`<Enum>.<STATE>: getStateDescription := '<text>';\`. An ST string:
  write a quote as \`$'\` and a dollar as \`$$\`. The selection file gives the current one.
- **Its documentation** (Markdown, shown in MachineScope's Documentation tab and its exports): in
  \`<POU>.machinescope.json\`, \`"notes": { "nodes": { "<STATE>": "<markdown>" } }\` (create \`notes\` / \`nodes\` when
  missing; keep every other key as it is, two-space indents). The selection file gives the current one: extend it
  rather than replace it, unless asked to.
- **A comment in its code**: \`// …\` lines at the top of its CASE branch in the state method.
- MachineScope follows these files on disk: an open chart reads them again (asking first when it has unsaved edits).
${END}
`;
}

/** CLAUDE.md's text with the section put in (its old one replaced, else added at the end) */
function upsertSection(existing) {
  const section = claudeSection();
  const text = existing ?? '';
  const a = text.indexOf(START.slice(0, 32));
  const b = text.indexOf(END);
  if (a >= 0 && b > a) return text.slice(0, a) + section.trimEnd() + text.slice(b + END.length);
  if (!text.trim()) return section;
  return `${text.replace(/\s*$/, '')}\n\n${section}`;
}

/** A folder set up: .machinescope/ (git-ignored by its own .gitignore, a first selection.md) and CLAUDE.md's section */
function setupFolder(root) {
  const dir = path.join(root, DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.gitignore'), '# Kval MachineScope: the statechart selection for AI assistants (not committed)\n*\n');
  if (!fs.existsSync(path.join(dir, SELECTION))) fs.writeFileSync(path.join(dir, SELECTION), NOTHING_YET);
  const claude = path.join(root, 'CLAUDE.md');
  const before = fs.existsSync(claude) ? fs.readFileSync(claude, 'utf8') : null;
  const after = upsertSection(before);
  if (after !== before) fs.writeFileSync(claude, after);
  return { dir, claude, created: before === null, updated: before !== null && after !== before };
}

/** Set up for it: the folder has .machinescope/ */
const isSetUp = (root) => !!root && fs.existsSync(path.join(root, DIR));

/** The selection written (only in a folder set up for it): its POU's path made relative to the folder */
function writeSelection(root, pouPath, markdown) {
  if (!isSetUp(root) || typeof markdown !== 'string') return false;
  const rel = pouPath ? path.relative(root, pouPath).split(path.sep).join('/') : '';
  const text = markdown.split('%POU_PATH%').join(rel || '(not in this folder)');
  const file = path.join(root, DIR, SELECTION);
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return true;
    fs.writeFileSync(file, text);
    return true;
  } catch {
    return false;
  }
}

module.exports = { claudeSection, upsertSection, setupFolder, isSetUp, writeSelection, DIR, SELECTION, START, END };
