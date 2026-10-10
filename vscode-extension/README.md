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
- **Go to code** in the statechart opens the section at that line (the method's implementation), beside the chart.
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
  missing device description) is answered and listed as a warning; a question stops the build with its text.
- **Login:** the PLC's code is compared with the project's latest build (its compile ID). The same: logged in. Another
  (or none): it asks first, as XAE does: **Login with online change** (the PLC keeps running) or **Login with
  download** (the application stops, takes the new code and starts again). XAE builds and writes it, and updates the
  boot project. **Logout:** offline again.
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
- **Layout:** kept in `<POU>.machinescope.json` beside the POU, as in the desktop app and XAE.
- **Not here:** live view of the statechart (follow a PLC) — use the desktop app, the web edition with Link or a
  gateway, or TwinCAT XAE.

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
`.TcDUT`; Build's messages in the Problems panel (XAE's stand-in).

Then in VS Code: **Extensions → … → Install from VSIX…**.
