using System;
using System.IO;

namespace KvalMachineScope.Xae
{
    /// <summary>
    /// AI assistants (Claude Code in a terminal at the solution's folder, and any that reads it) told what is selected in
    /// MachineScope's statechart, as the VS Code extension does (vscode-extension/assistantSetup.cjs: the same files): a
    /// folder set up for it has .machinescope\ (its own .gitignore: git ignores it all), where the selected state is
    /// written as Markdown (selection.md) each time it changes, and a section in CLAUDE.md (between markers, replaced on
    /// a new set-up) saying where to read it and how to document a state. A folder without .machinescope\ gets nothing.
    /// </summary>
    public static class AssistantContext
    {
        public const string DirName = ".machinescope";
        public const string SelectionName = "selection.md";
        public const string Start = @"<!-- kval-machinescope:start (written by Kval MachineScope: Set up Claude Code for this folder; it replaces this section) -->";
        public const string End = @"<!-- kval-machinescope:end -->";
        private const string NothingYet = "# MachineScope selection\n\nNo state selected yet: select one in a Kval MachineScope statechart (VS Code).\n";

        /// <summary>The CLAUDE.md section (the same text as the VS Code extension's)</summary>
        public static string ClaudeSection() => Start + "\n" + Body.Replace("\r\n", "\n") + "\n" + End + "\n";

        private const string Body = @"## TwinCAT project and Kval MachineScope

### Files
- `.TcPOU` / `.TcDUT` / `.TcGVL` are XML: the code is in the CDATA of `<Declaration>` and `<ST>`; each
  `<Method Name=""…"">` has its own. Edit only inside the CDATA; never change the XML around it or any `Id=""{GUID}""`.
- `<POU>.machinescope.json` beside a POU: Kval MachineScope's chart of it (state places, notes, colours, the states'
  documentation). `MachineScope.*.json` beside the `.plcproj`: coverage, commissioning, alerts. Data, not code.

### State machines (as Kval MachineScope draws them)
- A state machine is a `CASE <state variable> OF` in the method `doState()` (else the method with a CASE on an enum,
  else the POU's body); its states are the members of the variable's enum (a `.TcDUT`).
- A state is its CASE branch; a transition is `<state variable> := <Enum>.<STATE>;` in it, its condition the
  `IF` / `ELSIF` around it (the first true one wins: their order is their priority).

### ""The selected state(s)"", ""the canvas"", ""this state""
Read `.machinescope/selection.md` first: the state selected in the MachineScope statechart, or the states selected
together (Ctrl+Click, Shift+drag: ""Selected states (n)"", a section each), rewritten each time the selection changes:
the POU and file; per state its CASE branch (method and lines), its transitions out (in order) and in, its description,
its documentation, its problems; when live, the PLC's state. ""The selected states"" means all of them: do each one.
Its ""Updated"" time says how recent it is; when it names no state, ask which one.

### Documenting a state (when asked)
- **Its description** (one line, shown under the state): a line in the CASE of the POU's `getStateDescription()`,
  before its `ELSE` / `END_CASE`, like the others: `<Enum>.<STATE>: getStateDescription := '<text>';`. An ST string:
  write a quote as `$'` and a dollar as `$$`. The selection file gives the current one.
- **Its documentation** (Markdown, shown in MachineScope's Documentation tab and its exports): in
  `<POU>.machinescope.json`, `""notes"": { ""nodes"": { ""<STATE>"": ""<markdown>"" } }` (create `notes` / `nodes` when
  missing; keep every other key as it is, two-space indents). The selection file gives the current one: extend it
  rather than replace it, unless asked to.
- **A comment in its code**: `// …` lines at the top of its CASE branch in the state method.
- MachineScope follows these files on disk: an open chart reads them again (asking first when it has unsaved edits).";

        /// <summary>CLAUDE.md's text with the section put in (its old one replaced, else added at the end)</summary>
        public static string UpsertSection(string existing)
        {
            var section = ClaudeSection();
            var text = existing ?? "";
            var a = text.IndexOf(Start.Substring(0, 32), StringComparison.Ordinal);
            var b = text.IndexOf(End, StringComparison.Ordinal);
            if (a >= 0 && b > a) return text.Substring(0, a) + section.TrimEnd() + text.Substring(b + End.Length);
            if (text.Trim().Length == 0) return section;
            return text.TrimEnd() + "\n\n" + section;
        }

        public sealed class SetupResult
        {
            public string Dir { get; set; }
            public string Claude { get; set; }
            public bool Created { get; set; }
            public bool Updated { get; set; }
        }

        /// <summary>A folder set up: .machinescope\ (git-ignored by its own .gitignore, a first selection.md) and CLAUDE.md's section</summary>
        public static SetupResult SetupFolder(string root)
        {
            var dir = Path.Combine(root, DirName);
            Directory.CreateDirectory(dir);
            File.WriteAllText(Path.Combine(dir, ".gitignore"), "# Kval MachineScope: the statechart selection for AI assistants (not committed)\n*\n");
            var selection = Path.Combine(dir, SelectionName);
            if (!File.Exists(selection)) File.WriteAllText(selection, NothingYet.Replace("(VS Code)", "(TwinCAT XAE, Visual Studio)"));
            var claude = Path.Combine(root, "CLAUDE.md");
            var before = File.Exists(claude) ? File.ReadAllText(claude) : null;
            var after = UpsertSection(before);
            if (after != before) File.WriteAllText(claude, after, new System.Text.UTF8Encoding(false));
            return new SetupResult { Dir = dir, Claude = claude, Created = before == null, Updated = before != null && after != before };
        }

        /// <summary>Set up for it: the folder has .machinescope\</summary>
        public static bool IsSetUp(string root) => !string.IsNullOrEmpty(root) && Directory.Exists(Path.Combine(root, DirName));

        /// <summary>The selection written (only in a folder set up for it): its POU's path made relative to the folder</summary>
        public static bool WriteSelection(string root, string pouPath, string markdown)
        {
            if (!IsSetUp(root) || markdown == null) return false;
            var rel = "";
            if (!string.IsNullOrEmpty(pouPath))
            {
                var full = Path.GetFullPath(pouPath);
                var baseDir = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                rel = full.StartsWith(baseDir, StringComparison.OrdinalIgnoreCase) ? full.Substring(baseDir.Length).Replace('\\', '/') : "";
            }
            var text = markdown.Replace("%POU_PATH%", rel.Length > 0 ? rel : "(not in this folder)");
            var file = Path.Combine(root, DirName, SelectionName);
            try
            {
                if (File.Exists(file) && File.ReadAllText(file) == text) return true;
                File.WriteAllText(file, text, new System.Text.UTF8Encoding(false));
                return true;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { return false; }
        }
    }
}
