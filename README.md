# Kval StateScope

Kval StateScope is an interactive viewer for the Kval Inc. TwinCAT state machines (`SM_*.TcPOU` function blocks). It parses the Beckhoff TwinCAT PLC Structured Text state machine and generates publication-quality [Mermaid](https://mermaid.js.org/) flowcharts and state diagrams (`flowchart TD` with subgraphs and `stateDiagram-v2`).

The generator extracts state logic and transitions directly from the `doState()` and `preProcess()` methods of a `SM_*.TcPOU` file together with the enum definitions in matching `E_*_States.TcDUT` files. If the POU includes a `doState_UmlSC()` method, embedded UML composite states are preserved and mapped into nested subgraphs.

---

## Workspace Layout

The workspace is organized like TwinCAT XAE / Visual Studio, in three resizable main panels separated by splitters:

| Panel | Contents |
|---|---|
| **LeftPanel** | Identified States |
| **MiddlePanel** | Document tabs: Diagram Canvas, POU Editor, Method Editor, Enum Editor, Complexity Report, Transition Frequency, Transition History, PLC Transition Logger |
| **RightPanel** | One tab group of tool windows: Documentation, Problems, Live, Changes, Paths, Keyword Search & Filter, Real-Time Stats, Complexity Heat-Map, Notes, Mermaid Markdown |

The diagram toolbar (search, view and editing controls) and the diagram **Options** toolbar live inside the Diagram Canvas tab, since they only apply to the canvas. The **Minimap** and the **Legend** are overlays on the canvas, opened from the diagram toolbar.

- **Help:** hover over the `?` icon at the right end of the header for how the app works, the diagram's mouse actions, the tabs and the keyboard shortcuts. Click it to keep it open; `Esc` or a click elsewhere closes it. The book icon beside it opens this README on GitHub (in the desktop app and XAE, in your default browser).
- **PLC Transition Logger** (MiddlePanel tab, also opened from Transition History): paste, drop or pick a CSV / text log of state changes, or load a sample. **Populate Transition History** sends it to the Transition History tab.
- **Focus mode:** `Z`, or the focus button in the header, hides the side panels, the header and the status bar, so the diagram fills the window. Press `Z` or `Esc`, or use the exit button, to bring them back.
- **POU Editor:** the POU's own Structured Text, as TwinCAT XAE shows it when you open the POU. The declaration (`FUNCTION_BLOCK ... EXTENDS ...`, `VAR_INPUT` / `VAR_OUTPUT` / `VAR ... END_VAR`) is on top and the body (the POU's implementation) below; drag the bar between them to resize. Both can be edited: **Save to POU** (Ctrl+S) writes them into the `.TcPOU` and leaves its methods as they are (those are in the Method Editor). Find searches both panels (Enter / F3), the body folds like the Method Editor's, and Reset goes back to the POU's code. Right-click (as in the Method Editor): **Go to Definition** (F12) highlights the variable's line in the declaration, or opens a method of the POU in the Method Editor; **Find References** searches for it in both panels; **Copy Symbol Name**; and in the body, **Toggle Block Fold** folds the block around the cursor. A body that is not Structured Text (SFC, FBD, ...) is left as it is; its declaration can still be edited.
- **Code views, as in Visual Studio / TwinCAT XAE:** in the Method Editor, the POU Editor, the Enum Editor and Mermaid Markdown, the line with the cursor has a highlight band and a bright line number; it is dimmer when the view is not focused. In Mermaid Markdown, which is read-only, click a line or use the arrow keys, PageUp / PageDown and Ctrl+Home / Ctrl+End to move it. **Ctrl+mouse wheel** changes the text size (50% to 300%), as do Ctrl+Shift+. and Ctrl+Shift+, ; Ctrl+0 or a click on the zoom badge in the bottom-left corner goes back to 100%. The size is the same in all of them and is remembered.
- **Panels follow the selection:** selecting a state brings its **Documentation** forward, unless you are working in Live, Problems, Paths or Changes. Selecting a transition opens its Transition Guard window. Turn this off with **Follow selection** in the status bar.
- **Status bar:** messages appear in the status bar at the bottom rather than as pop-ups. It also shows the Live state, the number of changes and of problems, the state and transition counts, and the file with its unsaved / changed-in-XAE state. After opening a referenced state machine, it has a **Back** button.
- **A layout per host:** the layout inside XAE is saved separately from the browser / desktop one. It starts compact, with the LeftPanel hidden and a narrower RightPanel, to suit a document tab. Layouts saved by older versions get the new RightPanel once; your other tabs are kept.

### Loading a Function Block

The **Function Block** entry in the header toolbar (left of **Sample**) loads your own code: click **Browse** and pick a `.TcPOU` file, or drop one onto it. Only the file name is shown; the code is edited in the Method Editor and Enum Editor tabs.

The state enum is found automatically. By convention the `.TcDUT` sits in the same folder as the `.TcPOU` or in one of its subfolders, and that folder may hold several `.TcDUT` files. So after the `doState()` method is parsed, every `.TcDUT` in that folder tree is checked, and the one whose enum declares the most `doState()` CASE states is used. Build and library folders (`_Boot`, `_CompileInfo`, `_Libraries`, ...) are skipped.

- **Desktop app**: the folder is searched as soon as the `.TcPOU` is opened.
- **Web (Chrome / Edge)**: browsers do not reveal a file's folder, so the header shows **Find .TcDUT...**. It opens a folder picker at the `.TcPOU`'s folder; after you allow read access, later `.TcPOU` files inside that folder are matched without asking again.
- **Other browsers**: choose the `.TcDUT` file(s) directly; the best match among them is used.

When more than one `.TcDUT` matches, the header shows the count; click the enum name to pick another one.

### Inside TwinCAT XAE (prototype)

`xae-extension/` builds a Visual Studio extension (VSIX) for TcXaeShell 64-bit and Visual Studio 2022 / 2026. It adds **Open in Kval StateScope** to the right-click menu of `.TcPOU` files and shows the app as a document tab in XAE. Inside XAE you get **Save to project** for edits, **Show in TwinCAT editor**, and a **Live** tab. The Live tab follows the state machine in the running PLC over ADS: the active state lights up on the diagram, and a trail lists every transition with its dwell time. See [xae-extension/README.md](xae-extension/README.md). The desktop app has the same Live tab for a PLC on another computer, without XAE (see [Live view in the desktop app](#live-view-in-the-desktop-app)), and so does the web edition, through a small helper on the same computer or a shared gateway (see [Live view in the web edition](#live-view-in-the-web-edition)).

### Working with tabs
- **Right-click a tab** for Close, Close All But This, Float, New Vertical Document Group (MiddlePanel) / New Horizontal Tab Group (RightPanel), and Move to Next / Previous Tab Group.
- **Drag a tab** onto another group's tab strip or onto the middle of a group to move it there, or onto a group's left/right (MiddlePanel) or top/bottom (RightPanel) edge to create a new group. Tabs can only be moved within their own panel.
- **Float a document**: double-click a MiddlePanel tab (or choose *Float*) to undock it into a window that can be moved and resized within the MiddlePanel. Double-click the window's title bar or use its dock button to dock it again.
- **Close a tab** with its `×` button or a middle-click.
- **Reopen closed tabs** from the **Window** menu in the header. A reopened tab returns to its original panel and tab group. The Window menu also shows/hides the Left and Right panels and resets the layout.
- **Resize** panels and tab groups by dragging the splitters; double-click a side-panel splitter to restore its default width.

### Several POUs at once
Each POU can have its own StateScope, side by side:
- **XAE:** each POU opens in its own **StateScope: <POU>** tab. Opening a POU that already has a tab brings that tab forward, without reloading it.
- **Desktop:** each POU opens in its own window, from Explorer, the command line or **Window > New Window**. Opening a POU that is already open brings its window forward. Each window has its own Live session.
- **Web:** **Window > New Tab** opens another browser tab.

**Several instances of one POU.** A POU can be declared more than once in the PLC program, for example `MAIN.fbLine1.smTable` and `MAIN.fbLine2.smTable`. After you go live, the Live tab lists every instance the PLC has, and marks the one this window follows. **Open** follows another instance in its own tab (XAE, web) or window (desktop), which goes live on it straight away. **Open all** does this for every other instance. An instance that already has its tab or window brings it forward. The title shows the instance, for example **StateScope: SM_TableManager (MAIN.fbLine2.smTable)**. Each window keeps its own instance; the target and the other Live settings are shared by the POU's windows.

Notes are kept per POU, so two instances never overwrite each other's notes. Two tabs on the same POU stay in sync. Notes saved by an earlier version are moved to their POU the first time it is opened.

The layout (panel widths, tab groups, floating windows) is saved in the browser and restored on the next visit. Moving a tab never reloads its content, so the diagram keeps its zoom, pan and selection.

---

## Key Features

### 1. Interactive Diagram Canvas
- **Fluid Pan & Zoom**: Smooth gliding canvas navigation with mouse wheel zoom, fit-to-screen, 1:1 reset, and full-screen presentation mode.
- **Node Dragging & Custom Layouts**: Drag individual state nodes directly on the canvas to customize diagram positioning.
- **Auto-Align Diagram Engine**: Dedicated toolbar button and shortcut (`A`) to re-run the layout engine (ELK or Dagre) to cleanly organize all nodes according to current flowchart or stateDiagram-v2 logic while respecting the locked layout state.
- **Magnetic Snap to Grid**: Toggleable snap grid (10px, 20px, 40px) with real-time horizontal and vertical smart alignment crosshair guides.
- **Layout Locking**: Lock diagram layout to preserve custom manual positions across code edits or automatic re-layouts.
- **In-Place State Selection**: Click any node on the canvas to select it and highlight its transitions; the Method Editor and Documentation tabs follow the selection. When the Method Editor shares a tab group with the canvas, it opens in the background so the diagram stays visible.
- **State Style Window**: Click the selected state again (or right-click it and choose *Customize Style...*) to open the State Style window beside it: background, text and border colours plus quick presets. Click the state once more, or press Esc, to close it.
- **Transition Style**: Click a transition to select it, then click it again to open the Transition Guard window. Its *Style* card sets the line colour, width and dash pattern, and the label's fill, text colour, font size, bold / italic / underline and border.
- **Crosshair / Jump to State**: Jump directly to any state from the sidebar, minimap, or legend with smooth centering and SVG-safe animated glowing highlight rings.
- **Interactive Minimap**: Live bird's-eye overview of the entire diagram, as an overlay on the canvas, with a draggable viewport indicator and quick-navigation clicks.
- **Interactive Diagram Legend**: A canvas overlay with a color-coded breakdown of states (initial, composite, logic, error sinks), transition priority markers, and note indicators.
- **Canvas Sticky Notes & Annotations**: Attach custom color-coded markdown notes to states or transitions directly on the canvas.
- **Transition Guard & Priority Overlay**: Click transition paths or priority badges to view guard conditions, trigger logic, and execution priorities.

### 2. Deep TwinCAT Structured Text Parsing
- **Dual Method Analysis**: Seamlessly extracts state transitions from `CASE stateVar OF` in `doState()` and pre-emptive condition handling in `preProcess()`.
- **Composite State Derivation**: Uses UML composite definitions from `doState_UmlSC()` or infers hierarchical grouping from enum declaration orders (e.g. states following `*_ENABLING` grouped into `*Enabled`).
- **Transition Priority Badges**: Detects sequential `IF...ELSIF` evaluation order and displays priority badges (Circle, Badge, or Text format) on transition lines.
- **Error Sink Edge Collapsing**: Optional collapsing of high-density error/fault transitions to composite boundaries for cleaner, presentation-ready diagrams.
- **State Descriptions**: Automatically parses and attaches documentation comments and strings from `getStateDescription()`.

### 3. Real-Time Analytics & Complexity Heat-Map
- **State Machine Metrics**: Calculates total state counts, transition density, cyclomatic complexity index, Fan-In / Fan-Out metrics, and dead-end/unreachable state detection.
- **Visual Complexity Heat-Map**: Overlays real-time cyclomatic complexity metrics onto diagram nodes using customizable color scales (Traffic Light, Flame/Warm, Cool/Blue, Monochrome) with instant filtering for refactor candidates.
- **Interactive Metric Tooltips**: Hover over any state in heat-map mode to inspect LOC, branching factor, incoming transitions, and cyclomatic score.
- **Refactor Badges**: States above the complexity threshold show an `M=` badge on the canvas; click a badge to open the Complexity Heat-Map tab.

### 4. Problems (state machine checks)
The **Problems** tab (RightPanel) checks `doState()`, `preProcess()` and the rest of the POU against the `.TcDUT` enum and the diagram. The tab shows the number of errors and warnings, and states with an error or warning get a `!` badge on the canvas.

| Rule | Severity | Fix |
|---|---|---|
| Target not in enum: a transition assigns a state the enum does not declare | Error | Add to enum |
| CASE label not in enum | Error | Add to enum |
| Duplicate CASE label | Error | |
| No CASE branch: a state is entered but `doState()` has no branch for it | Warning (Info when an `ELSE` handles it) | Add CASE branch |
| Unreachable state: nothing in the POU leads to it | Warning | |
| Dead end: no transition out, in its branch or in `preProcess()` | Warning (Info for error-like states) | |
| Same guard, different targets: only the first can fire | Warning | |
| Self-transition, unused enum member, `CASE` without `ELSE` | Info | |

- **Scanning:** comments, strings and nested `CASE` / `IF` blocks are skipped over, so only the state `CASE`'s own labels and `ELSE` count.
- **Lifecycle states:** the enum members up to `…_ENABLING` are driven by the base class (enable / disable), so the unreachable and dead-end rules skip them. The diagram groups states the same way.
- **Per finding:** *Show in diagram* selects the state. *Open code* opens the Method Editor, or TwinCAT's editor at the line inside XAE. The fix button edits the `.TcDUT` / `doState()` like the editors do. *Ignore* hides a finding for that POU, and the tab keeps a count of ignored findings.

### 5. Editing from the diagram
Right-click a state or the canvas:
- **Add state...** adds a member to the `.TcDUT` enum and an empty `CASE` branch to `doState()`.
- **Add transition from here** starts a line from the state. Click the target state, then enter the condition. The transition is written at the end of the source state's branch, as `IF <condition> THEN machineState := <target>; END_IF`. `Esc` or a click on empty canvas cancels.
- **Rename state...** renames it everywhere, as a whole word: in the enum, in every method of the POU, and in its notes, styles and positions on the canvas. The name is checked against the enum and ST identifiers first.

The edits land in the Method Editor and Enum Editor like hand edits, so **Save** (or **Save to project** in XAE) writes them.

### 6. Paths, changes and referenced state machines
- **Paths** tab: pick two states, or right-click a state and choose *Paths from here* / *Paths to here*. It lists the paths between them, with each step's guard, shortest first, and highlights them on the diagram. Click a path to show only that one. The search stops after 25 paths.
- **Changes** tab: what changed compared with the saved file (in XAE: the version XAE has saved), or with the committed git version (desktop and XAE). It lists states added or removed, states whose code changed, and transitions added or removed or with a changed guard. *Show on the diagram* colors new states and transitions green and changed ones amber.
- **Referenced state machines:** when a state's code or a transition's guard uses another state machine (a member such as `smOutfeedStopAxis : SM_KAxis`), the context menu offers *Open SM_KAxis (smOutfeedStopAxis)*. It opens that POU from the same PLC project (desktop and XAE), and **Back** in the status bar returns to the previous one.

### 7. Documentation for a whole project
**Export > Document all state machines** makes one HTML file for every state machine (every POU with a `doState()` `CASE`) in the PLC project. Each gets its chart, a table of states (description, transitions in and out, `CASE` branch present), a table of transitions with their guards, and its Problems. A contents list links to each. The file is self-contained and prints to PDF one state machine per page.
- **Desktop and XAE:** the POUs are found in the loaded POU's PLC project, and a save dialog asks where to write the file.
- **Web:** choose the project folder; the file is downloaded.

### 8. TwinCAT Source Editors & Inspection
- **Identified States Sidebar**: Filter states by name, logic presence in `doState()`, error sinks, or composite groups; sort alphabetically or by enum index; jump to any state with 1 click.
- **Integrated Enum Editor (`.TcDUT`)**: In-app editor for TwinCAT enum definitions with syntax checking and member management.
- **Integrated Method Editor (`.TcPOU`)**: Embedded editor for `doState()` and `preProcess()` Structured Text blocks.
- **Custom State Styling Inspector**: Customize fill colors, stroke colors, and borders for individual states with instant live preview.

### 9. Export & Tooling
- **Dual Mermaid Formats**: Switch instantaneously between `flowchart TD` (with subgraphs) and `stateDiagram-v2`.
- **Curve Algorithms**: Customize flowchart routing curves (basis, linear, cardinal, natural, step).
- **Mermaid Live Integration**: Open generated diagrams directly in [mermaid.live](https://mermaid.live) with 1 click.
- **One-Click Export**: Copy Mermaid Markdown to clipboard, download `.statechart.md`, or export diagram graphics.
- **Diagram Presets**: Save and apply combinations of layout engine, curve, theme, priority format and export settings (PNG/SVG, 1x–4x scale, dark/white/transparent background). *Export with Preset* downloads using the active preset's export settings, and the High-Res Export dialog opens with them preselected.

---

## Pre-Loaded Production Samples

Test the generator immediately with 7 real-world Beckhoff TwinCAT state machine samples:
1. **Door Dasher (`SM_DoorDasher`)**: Complex multi-level state machine with nested UML composite states (`Disabled`, `Enabling`, `Enabled`, `Stopping`).
2. **Table Manager (`SM_TableManager`)**: Indexing rotary table sequencer with error handling and interlocks.
3. **K-Motor VFD (`SM_KMotorVFDEtherCATi550`)**: EtherCAT Lenze i550 variable frequency drive velocity/position controller.
4. **K-Analog Measure (`SM_KAnalogMeasure`)**: Analog sensor sampling, calibration, and zeroing sequence.
5. **Feed Manager (`SM_234FeedManager`)**: Material feeder sequencing and fault recovery logic.
6. **K-Servo Supply Manager (`SM_KServoSupplyManager`)**: Finds the servo power supplies and enables them as child state machines.
7. **K-Power Supply AX86x0 (`SM_KPowerSupplyAx86x0`)**: Beckhoff AX86x0 servo power supply enable, reset and error handling.

Samples 6 and 7 use a `{attribute 'qualified_only'}` enum, so their code names states with the enum's type: `E_KSupplyManager_States.DISABLED:` and `machineState := E_KPowerSupply_States.ERROR;`. Both forms are read everywhere: in `doState()` and `preProcess()`, the Identified States, the Method Editor and Problems. Code the app writes (a new state's CASE branch, a new transition) follows the style the POU already uses.

---

## Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)
- npm or pnpm

### Development
```bash
# Clone the repository
git clone https://github.com/vuphamn/TcPouStatechartGenerator.git
cd TcPouStatechartGenerator

# Install dependencies
npm install

# Start local development server (runs on port 3000)
npm run dev
```

### Production Build
```bash
# Compile and build web bundle
npm run build

# Preview production build locally
npm run preview
```

---

## Build Windows 11 Desktop Application (.exe)

You can package the application as a standalone, offline Windows desktop application via Electron. One script builds everything the installer ships, then the installer:

```bat
build.cmd          :: the XAE extension (VSIX), the web app, Link, the gateway, then the installer
build.cmd noxae    :: the same, keeping the existing VSIX (no Visual Studio build tools on this PC)
```

`npm run build:exe` does the same except the VSIX: it uses the one in `xae-extension\KvalStateScope.Xae\bin\Release`, building it only when it is missing. Building the extension needs Visual Studio 2022 / 2026 with the extension development workload.

Compiled executables are output to the `release/` directory:
- **`Kval StateScope Setup <version>.exe`** — the Windows installer, with Start menu shortcuts and auto-updater support.
- **`Kval StateScope <version>.exe`** — Portable single-file executable (no installation required, runs directly from USB or local drive).

### What the installer sets up

After the install folder, the installer offers **Additional components**:

| Option | What it does |
|---|---|
| **Open in Kval StateScope** (on by default) | Adds **Open in Kval StateScope** to the right-click menu of `.TcPOU` files in Windows Explorer. It works whatever program `.TcPOU` files open with. On Windows 11 it is under **Show more options** (or Shift+right-click). |
| **Visual Studio** | Installs the TwinCAT XAE extension in every Visual Studio 2022 / 2026 found (listed on the page). Close Visual Studio first; the installer asks you to. |
| **TcXaeShell 64-bit** | Installs the extension in TcXaeShell (asks for administrator rights). Close TcXaeShell first. |
| **Kval StateScope Link** | The web edition's helper for a browser on this computer, with a Start menu shortcut. |
| **Kval StateScope gateway** | The web edition's shared server, in `%LocalAppData%\KvalStateScope\Gateway` (or `C:\ProgramData\KvalStateScope\Gateway` for all users), with its dependencies. It runs on Node.js 20+; set it up with [gateway/README.md](gateway/README.md) (`node gateway.cjs init`). |

Options for software that is not on the computer are greyed out. Running the installer again shows your earlier choices; an update keeps them.

- **Opening a file:** a `.TcPOU` opened this way (or dropped on the exe) is loaded with its `.TcDUT`, found as with *Browse*. When the app is already open, the file opens in a new window, or brings forward the window that already shows it.
- **Uninstalling** removes the menu entry, the extensions and Link. It removes the gateway's program files but keeps its `config.json`, certificate and key.

### Live view in the desktop app
The desktop app's **Live** tab follows a state machine in a PLC on another computer. The Electron main process talks ADS straight to the PLC's router over TCP 48898 (`electron/tcLive.cjs`, with [ads-client](https://github.com/jisotalo/ads-client)), so TwinCAT is not needed on the laptop. The display is the same as in XAE: the active state glows on the diagram, and the tab lists every transition with its dwell and flags those that aren't in the diagram.

**One-time setup:**
1. **Add an ADS route on the PLC** for the laptop. The Live tab shows exactly what to add after the first Go live: the laptop's IP and the AMS NetId it uses (the laptop's IP + `.1.1`, or `.1.2` when TwinCAT on the laptop already uses that NetId). Add it with the PLC's TwinCAT router settings (*Router > Edit Routes*) or from an XAE connected to the PLC.
2. **Network:** the laptop must reach the PLC on TCP 48898.

**Going live:**
1. Open the POU from the PLC project with *Browse*. Instance paths and the ADS port are found from the project files, the same way the XAE extension does it.
2. In the Live tab, enter the PLC's **AMS NetId**. The PLC IP defaults to the first four numbers of the NetId; enter it when it differs, or `host:port` for a forwarded port.
3. Click **Go live**. Without a route the PLC closes the connection, and the tab says which route to add.

Only reads happen, plus the release of the variable handle when the session stops. PLCs that enforce Secure ADS (TLS) are not supported yet.

When the POU is not from the project (a sample, a dropped file), its instances are looked up in the PLC's own symbol and data type tables.

## Live view in the web edition

A browser can't talk ADS itself, so the web edition goes live through a helper. In the Live tab, **Via** chooses which:

- **This computer:** *Kval StateScope Link* (`link/`), a small program on the same computer. It talks ADS straight to the PLC, like the desktop app. Build it with `npm run build:link`, start `Kval StateScope Link.exe`, and enter the pairing code it shows. The PLC needs an ADS route for the computer. See [link/README.md](link/README.md).
- **Gateway:** a shared service on the PLC network, for teams that shouldn't install anything (below).

### Gateway

The **Kval StateScope gateway** (`gateway/`) is a small Node.js service on a machine in the PLC network. The gateway serves the web app over HTTPS, so people open `https://<gateway>:8443/` and install nothing, and it follows the PLCs listed in its configuration for them.

- **Access:** access tokens (only their hashes are stored), connections limited to the configured PLCs, and a log of who follows what.
- **Read-only:** one ADS connection per PLC and one change notification per variable, shared by every viewer.
- **Setup:** `npm run build:gateway` assembles `release/gateway`. The rest (certificate, PLC list, ADS routes, tokens, running it as a service) is in [gateway/README.md](gateway/README.md).

In the Live tab, enter your access token, choose the PLC and click **Go live**. The gateway finds the POU's instances in the PLC's symbol tables.

## PLC symbols

While live, **Symbols** in the Live tab opens the **PLC Symbols** window. It shows the PLC's variables as a tree, from a root that is `MAIN.mainStateMachine` by default; you can type another root and click **Browse**.
- **Members, one level at a time:** open a function block, a structure or an array (up to 100 elements) to read its members from the PLC's data types. Members inherited from a base function block are included.
- **Values:** numbers, booleans, strings and enums show their value live, with the same change notifications as the guard values. The first 60 values on show are followed; close members to see others. Pointers and references are listed without a value.
- **State machines:** a member that has the state variable (`machineState`) is marked. **Watch** opens its diagram in its own tab (XAE, web) or window (desktop), live on that instance, so its transitions are logged in the Live tab and can go to Transition History. XAE and the desktop app find the POU in the PLC project. Otherwise you are asked to pick its `.TcPOU`. The new window uses the same PLC connection.
- **Filter** narrows the opened members by name or type. **Refresh** reads them again, for example after a download.
- Closing the window stops reading its values. The window can be moved and resized, and remembers where it was.

## Live guard values

While live, the diagram shows why the state machine does or doesn't leave its state. Every transition out of the active state gets a badge on its condition: ✓ (TRUE), ✗ (FALSE) or ? (unknown). The values of the condition's variables are listed under it, e.g. `cmd_bHome = TRUE`, `smOutfeedStopAxis.config_fHomePosition = 12.5`. The Live tab lists the same transitions with their results. This works in every edition: XAE, the desktop app, and the web edition through Link or the gateway.

**Guard values** in the Live tab chooses what is read:
- **Active state** (default): the variables of the transitions out of the current state, plus the `preProcess()` checks that apply to it. The set changes with the state.
- **All transitions:** every condition gets a badge. Values are shown for the current state's transitions and the selected one.
- **Off:** nothing extra is read.

**How the result is worked out:**
- **The whole IF context counts:** a transition in an `ELSIF` or `ELSE` branch fires only when the earlier branches' conditions are FALSE, so those are part of its condition.
- **From the values:** the app evaluates the condition from the variables the PLC sends. `AND`, `OR`, `XOR`, `NOT`, comparisons, arithmetic, `MOD`, bit access (`nMode.3`), `T#` durations, a few functions (`ABS`, `MIN`, `MAX`, `LIMIT`, `SEL`, type conversions) and enum values are understood.
- **Unknowns:** a variable that can't be read makes its part unknown, but `FALSE AND ?` is still FALSE and `TRUE OR ?` is still TRUE.

**Where the variables come from:**
- **Lookup:** each variable is looked up as a member of the followed instance (`<instance>.cmd_bHome`). A dotted path such as `GVL.bX` or `MAIN.fbY.bZ` is also tried as a global path.
- **Enum literals** (`FEEDMODE_OFF`) come from the `.TcDUT` files: the state enum, the other `.TcDUT` files next to the POU, and, in the desktop app and XAE, all of the PLC project's.
- **Reads:** a change notification checked every 10 ms, read-only like the state variable. Values are released when the state, the setting or the session changes.

**Limits:**
- **Unreadable (shown as ?):** method and property calls (`fb.isReady()`), `VAR` / `VAR_TEMP` locals of `doState()`, array elements with a variable index, and structures. Hover over a ? to see why.
- **Timing:** values arrive after the PLC cycle and from separate notifications. A variable changed later in the same cycle, or a timer called just before the `IF`, may differ from what the `IF` saw. Use the badges to see why a state machine is stuck, not to prove a one-cycle race.

---

## Architecture & Technology Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Workspace**: Custom docking layout (`src/utils/dockLayout.ts`, `src/components/dock/`) — tab contents are rendered into persistent host elements that move between tab groups instead of remounting
- **Diagramming Engine**: Mermaid.js, SVG DOM manipulation, dynamic SVG transform matrices
- **Icons**: Lucide React
- **Packaging**: Electron, electron-builder
- **TwinCAT Parser**: Custom regex-based AST parser for IEC 61131-3 Structured Text (`.TcPOU`, `.TcDUT`)
