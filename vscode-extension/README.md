# Kval MachineScope for VS Code

TwinCAT in VS Code: `.TcPOU`, `.TcDUT`, `.TcGVL` and `.TcIO` files as Structured Text, as TwinCAT XAE shows them (the
declaration above, the implementation below, no XML); XAE's toolbar (Build, Login, Start, Stop, Logout, the target and
the build); and state machines as statecharts: the same app as the web edition and the TwinCAT XAE extension, with full
file access.

## Structured Text, as in XAE

- **Open:** a `.TcPOU` / `.TcDUT` / `.TcGVL` / `.TcIO` opens as Structured Text (double-click, Quick Open): its
  declaration in the editor group, its implementation in a group below it, without the XML. The next one opens in the
  same two groups. **Open as XML** (the Explorer's menu, an editor tab's menu) shows the file itself; **Reopen Editor
  With…** too.
- **Methods, properties, actions:** **Go to Member…** (the editor's title, `Ctrl+Shift+O`), or the **TwinCAT** view's
  **POU** list (the activity bar): each opens as its declaration and implementation (a property's Get / Set too). A
  graphical implementation (SFC, CFC) is said to be one: edit it in XAE.
- **Highlighting:** the Structured Text language of an extension you have (`st`: *Structured Text language Support*),
  else this extension's own grammar. Setting `kvalMachineScope.structuredText.language` chooses another language id
  (`structured-text`, `iec-61131-3`, `kval-st`, …); the open sections change at once.
- **Find All References** (`Shift+F12`, the right-click menu) and **Go to Definition** (`F12`, Ctrl+click): by name
  across the project's `.TcPOU` / `.TcDUT` / `.TcGVL` / `.TcIO` sections (ignoring case, comments, strings and
  pragmas; unsaved edits of open sections included), each opening its section at the line. A definition is the nearest
  declaration: the method's own VAR, its POU's (or a base's, `EXTENDS`), then the project's types, global variables and
  enum members; after a dot (`E_State.Idle`) the one in the type named before it. By name, not a compiler's
  resolution: a local of the same name in another POU is listed too.
- **Go to code** in the statechart opens the section at that line (the method's implementation), beside the chart, or
  where that section is open already.
- **Reads and writes**, as XAE's Cross Reference List tells them: the caret on a name highlights its places in the
  section, writes (`x :=`, `x R=` / `S=`, an output bound to it: `Q => x`, a member or an index assigned) apart from
  reads. **Find All Writes** (the right-click menu): every place in the project that sets it.
- **Go to Symbol in Workspace** (`Ctrl+T`): the project's POUs, interfaces and DUTs, their methods, properties and
  actions (`FB_Axis.Move`), the global variables and the enums' members; letters in order are enough (`fbax`).
- **Folding** as in XAE: `VAR` blocks, `IF` / `CASE` / `FOR` / `WHILE` / `REPEAT`, each `CASE` branch, `STRUCT`,
  `TYPE`, `{region}` … `{endregion}`, comments over several lines.
- **Type Hierarchy** (the right-click menu): a POU's or interface's `EXTENDS` and `IMPLEMENTS`, up and down; a struct's
  `EXTENDS`. **Go to Implementations** (`Ctrl+F12`): an interface's (or a base's) function blocks, a method's
  implementations and overrides in them.
- **Call Hierarchy** (`Shift+Alt+H`): who calls a method, an action, a function, a program or a function block's body
  (`fbAxis()`), and what it calls (`fbAxis.Move()`, `SUPER^.Move()`, an inherited method), each call's line shown.
- **Rename** (`F2`): by the name's declaration, always shown in the refactor preview first: a method's own variable in
  that method; a POU's variable in the POU and the POUs that extend it, its uses after a dot elsewhere (`fbScan.State`)
  listed apart to check one by one; a global variable, an enum member or a type everywhere. A POU's, method's,
  property's or action's own name is renamed in XAE (it is in the file's XML too); a keyword, or a name already
  declared there, is refused.
- **IntelliSense:** after a dot, the members of the name's type (a project FB's inputs, outputs, methods and properties,
  its bases' too; a struct's fields; an enum's members after its type: `E_State.`); otherwise the names visible there
  (the method's own variables, the POU's and its bases', its methods, the global variable lists, the project's types).
  **Parameter hints** in a call: a method's `VAR_INPUT` / `VAR_IN_OUT` / `VAR_OUTPUT`, an FB instance's inputs.
  From the project's own declarations: a library's function blocks get no hints.
- **Checks while typing** (the Problems panel): a method's own variable (`VAR`, `VAR_TEMP`, `VAR_INST`) never used
  in it is shown faded; a plain name used in an implementation that nothing declares, neither the project nor its
  libraries (their names read from XAE's library cache, `_Libraries`), is flagged: a typo, most likely. Calls,
  names after a dot, ALL_CAPS names and a POU that extends a library's FB are not checked.
  `kvalMachineScope.structuredText.checks` switches them off.
- **Auto Declare** (`Shift+F2` as in XAE, the right-click menu, and a Quick Fix on a name declared nowhere): the name
  declared in the method's or the POU's `VAR`, `VAR_INPUT` or `VAR_OUTPUT` (a new block when there is none), its type
  guessed from its use (`:= TRUE`: BOOL, `:= 1.5`: LREAL, `T#2S`: TIME, `E_Mode.Auto`: E_Mode, `x.Q`: TON). A variable
  never used: **Remove the declaration** (a Quick Fix).
- **Format Document** (`Shift+Alt+F`): each line's indentation from its blocks (`IF`, `CASE` labels and their statements,
  the `CASE`'s `ELSE` at its level, loops, `VAR` blocks, structs, enums); only the leading white space changes, a
  comment line and a call over several lines keep their own alignment, a section's own base indentation is kept.
- **Hover:** a name's declaration (its line, with its comment) and where it is declared.
- **Compare with Committed (git HEAD)** (an editor tab's menu, the right-click menu): the section beside its committed
  version, in VS Code's diff editor.
- **Snippets** (`kval-st` and `st`): `tcsm` a state machine (`CASE` on an enum), `tcstate` / `tcstatet` a branch (with a
  timeout), `tcfb` a function block, `tcmethod`, `tcprop`, `tcton`, `tcrtrig`, `tcfor`.
- **Add POU… / Add DUT…** (the **Solution** view's title, a folder's buttons): its kind (function block, program,
  function; struct, enum, alias) and name, then the new file in that folder with new object Ids, added to the
  `.plcproj` (XAE, if it has the project open, asks to reload it). **Add Method… / Add Property…** (the **POU** view):
  into the open POU, its declaration and an empty implementation (a property's Get and Set).
- **Show in statechart** (above each state's `CASE` branch of the POU's state method: `doState()`, `Execute()`, or the
  POU's body): the POU's statechart beside, that state selected. `kvalMachineScope.structuredText.codeLens` switches the
  lenses off.
- **Outline** (the Outline view, the breadcrumbs): a declaration's object, its VAR blocks and
  variables (an enum's members); an implementation's `CASE` branches, the states (a nested `CASE`'s under its branch).
  With *Structured Text language Support*, its own outline of a declaration is used (the same blocks and variables).
- **Save:** a section's text goes back into its CDATA block only: the objects' Ids, the line ids, the file's BOM and line
  breaks stay as they were. Two sections edited and saved one after the other do not conflict. A file changed on disk
  (XAE, git) shows in its open sections; one with unsaved edits asks first, as any file.

## XAE's toolbar

For the project of the active TwinCAT file (the `.tsproj` above it, the PLC project it is in):

- **Status bar:** the **target** (click: TwinCAT's routes on this computer, or *Local*), the **build** (XAE's Remote
  Manager: click to choose one of the builds installed, or *(Default)*), and the **PLC**: *Online* / *Offline* and its
  state (*Run*, *Stop*, *Invalid*: no program; or *not reachable*), with a menu of the actions.
- **Editor title buttons** (a TwinCAT section): **Build**, **Login** / **Logout**, **Start** / **Stop**, Go to Member,
  the statechart. The **TwinCAT** view's **PLC** list shows the project, target, build, PLC, which code the PLC runs
  and the last build, with the same buttons. Keys: `Ctrl+Shift+B` Build, `Alt+F8` Login, `Ctrl+F8` Logout.
- **Build:** TwinCAT XAE builds the project through its Automation Interface: a copy of the project folder, in an XAE of
  its own (hidden; your XAE windows are not touched; kept open ten minutes for the next build). Unsaved files of the
  project are saved first. Its errors and warnings go to the **Problems** panel, on the section and line (a click opens
  it), and to the **TwinCAT** output. A message XAE shows while it loads the project (OK only, e.g. a safety project's
  missing device description) is answered and listed as a warning, and so are two questions with a known answer
  (*Open project with the loaded version instead?*: OK; the copy *has been modified outside of TwinCAT XAE … reload*:
  Yes); any other question stops the build with its text. Every
  dialog seen is kept in `%LOCALAPPDATA%\KvalMachineScope\xae-dialogs.jsonl`. A Remote Manager build that stopped XAE
  while it opened the project is remembered: the build picker marks it, and using it again asks first.
- **Login:** the PLC's code is compared with the project's latest build (its compile ID). The same: logged in. Another
  (or none): it asks first, as XAE does: **Login with online change** (the PLC keeps running) or **Login with
  download** (the application stops, takes the new code and starts again). XAE builds and writes it, and updates the
  boot project. **Logout:** offline again.
- **Live values** (logged in): each variable's value after it in the sections, as in XAE's online view: numbers,
  `TRUE` / `FALSE`, strings, enums by their names; a function block's members as `fbAxis.bDone`. Read over ADS twice a
  second, for the visible part of each section. A POU's values are its instance's on the PLC (found in its symbol table;
  with several, the status bar's instance item chooses one); a GVL's are its own. Hovering one shows its symbol and type.
  Logged out: none. The `CASE` branch of the state the PLC is in is marked (the line, a green bar, the overview ruler),
  its variable read even when its line is scrolled away (`kvalMachineScope.liveValues.activeState`).
- **Write Values** (logged in, as XAE's online view): **Prepare Value…** (`Ctrl+Shift+F7`, the right-click menu) on a
  variable whose value is shown: its new value picked (`TRUE` / `FALSE`, an enum's members) or typed (checked against
  its type: its range, `16#FF`, a string's length), then shown after the current one (`7 ⇒ 9`). **Write Values**
  (`Ctrl+F7`) writes every prepared value, after one question naming them and the PLC. **Clear Prepared Values**.
  Forcing (holding a value against the program) is XAE's.
- **Watch** (the TwinCAT view): **Add to Watch** (a variable's right-click menu while logged in, or the view's `+` with
  a full path such as `MAIN.fbTest.nCycles`): its value twice a second; **Write Value…** on one (asked first),
  **Remove**, **Clear Watch**. **Show Trend**: the watched numbers and booleans over the last ten minutes.
- **The PLC's code changed** while logged in (built anew here or in XAE, or changed on the PLC): said at once, with
  **Build and Online Change** and **Logout**, since the live values may no longer match the code.
- **Build and Online Change:** the project built and written to the PLC as an online change (it keeps running), asked
  first; logged in afterwards. Nothing is written when an online change is not possible (Login offers a download).
- **Solution** view (the TwinCAT view): the PLC project as XAE's Solution Explorer shows it (its `.plcproj`'s folders,
  POUs, DUTs, GVLs, visualizations, task, and its libraries under **References**); a click opens a source as Structured
  Text.
- **Start / Stop:** the PLC application, over ADS, while logged in. Asked first (they run or stop the machine's
  program); `kvalMachineScope.twincat.confirmStartStop` switches that off.
- Needs TwinCAT XAE on this computer for Build and Login (its Automation Interface); Start, Stop and the PLC's state need
  only a route to the PLC.

## Statecharts

- **Open:** right-click a `.TcPOU` in the Explorer (or an editor's tab) → **Open in Kval MachineScope**, or
  **Open With… → Kval MachineScope Statechart**.
- **Its enum:** the `.TcDUT` files in the POU's folder and its subfolders are searched for the one that declares its
  states (**Find .TcDUT…** searches another folder).
- **Save:** your edits go back into the `.TcPOU` / `.TcDUT` files. A file changed on disk since it was loaded (saved in
  TwinCAT, git) is not overwritten unless you choose to keep your edits.
- **Go to code:** opens the `.TcPOU` beside the chart at that line of the method.
- **Follow selection:** the caret in a state's `CASE` branch (the state method's implementation) selects that state in
  the POU's open statecharts.
- **Its state machine:** Kval's `doState()`; else a method with a `CASE` on a variable of an enum type (`Execute()`);
  else the POU's own body (`CASE State OF` in the function block's code), named by the POU.
- **The project's files:** **Document all state machines…**, **Coverage of all state machines…**, the version chip
  (the committed TwinCAT version, from git), and a rename that reaches other POUs read and write the PLC project's
  files, as in XAE.
- **Layout:** kept in `<POU>.machinescope.json` beside the POU, as in the desktop app and XAE.
- **Live view** of the statechart (the desktop app's live session): its target is the one picked in VS Code's status
  bar, unless given in the Live tab; Browse lists this computer's routes and the TwinCAT devices answering on the
  network. **Build…** is the TwinCAT view's build.

## Install

The desktop installer (`Kval MachineScope Setup <version>.exe`) installs it: its **VS Code edition** page, on by
default when VS Code is found. Running the setup again updates it.

## Build and install by hand

```
npm run build                     # the app (dist/)
node vscode-extension/pack.cjs    # release/kval-machinescope-vscode-<version>.vsix (its code bundled with esbuild)
```

Tests: `node tests/run.cjs vscode` runs this computer's VS Code with the extension (a profile of its own in
`tests/.output`; its window shows for a few seconds): Structured Text sections opened, edited, saved; a member; a
`.TcDUT`; Build's messages in the Problems panel (XAE's stand-in); the Watch view and its trend; hover; Compare with
Committed; Add POU / Method.

`KSS_REAL_PLC=1 node tests/run.cjs plc` runs against this computer's TwinCAT runtime (changes it: only on a PC that
may; it replaces the active configuration): a test project made with XAE's Automation Interface
(`tests/plc/create-project.ps1`), built, activated and downloaded; the PLC parts against it (Login's check, live
values, Write Values, Stop and Start); then the same in VS Code itself, with a watched variable; the PLC stopped at the
end.

Then in VS Code: **Extensions → … → Install from VSIX…**.
