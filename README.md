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
- **Code views, as in Visual Studio / TwinCAT XAE:** in the Method Editor, the POU Editor, the Enum Editor, Mermaid Markdown and the Documentation tab (whose band covers the whole line, wrapped rows included; its Preview zooms too), the line with the cursor has a highlight band and a bright line number; it is dimmer when the view is not focused. In Mermaid Markdown, which is read-only, click a line or use the arrow keys, PageUp / PageDown and Ctrl+Home / Ctrl+End to move it. **Ctrl+mouse wheel** changes the text size (50% to 300%), as do Ctrl+Shift+. and Ctrl+Shift+, ; Ctrl+0 or a click on the zoom badge in the bottom-left corner goes back to 100%. The size is the same in all of them and is remembered.
- **Panels follow the selection:** selecting a state brings its **Documentation** forward, unless you are working in Live, Problems, Paths or Changes. Turn this off with **Follow selection** in the status bar.
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
- **Move a document to a window of its own** (outside the app, e.g. to another monitor): *Move to New Window* in a MiddlePanel tab's or floating window's menu, or the window button on a floating window's title bar. It is the same tab, with its content and state, in a browser window you can move anywhere. **Back to the app**, the dock button, or closing that window brings it back. The app's shortcuts work in them (keys pressed outside text fields go to the app). The windows close with the app. When it starts again, such a tab comes back floating, with **Reopen in its own window** (a browser opens a window only on a click). Dialogs such as prompts open in the main window. In a web browser the window shows the app's address with its name (e.g. `…/window.html?POU-Editor`): browsers always show a page-opened window's address. The desktop app and XAE show none.
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
- **In-Place State Selection**: Click any node on the canvas to select it and highlight its transitions. The canvas and the layout stay as they are: no tab is opened. The Method Editor and Documentation tabs follow the selection when they are shown. In **Identified States**, clicking a state selects it the same way. **Go to State** (or the "Jump to state" picker) centers it on the canvas, and with **Follow** ticked a click does too.
- **State Style Window**: Click the selected state again (or right-click it and choose *Customize Style...*) to open the State Style window beside it: background, text and border colours plus quick presets. Click the state once more, or press Esc, to close it.
- **Transition Style**: Click a transition to select it, then double-click it to open the Transition Guard window. Its *Style* card sets the line colour, width and dash pattern, and the label's fill, text colour, font size, bold / italic / underline and border.
- **Crosshair / Jump to State**: Jump directly to any state from the sidebar, minimap, or legend with smooth centering and SVG-safe animated glowing highlight rings.
- **Interactive Minimap**: Live bird's-eye overview of the entire diagram, as an overlay on the canvas, with a draggable viewport indicator and quick-navigation clicks.
- **Interactive Diagram Legend**: A canvas overlay with a color-coded breakdown of states (initial, composite, logic, error sinks), transition priority markers, and note indicators.
- **Canvas Sticky Notes & Annotations**: Attach custom color-coded markdown notes to states or transitions directly on the canvas.
- **Transition Guard & Priority Overlay**: Double-click transition paths or priority badges to view guard conditions, trigger logic, and execution priorities.

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
| Several initial states: more than one `// @initial` in one composite (or outside the composites) | Warning | |
| Parallel region without a final state: its join never fires | Warning | |
| Region state never entered: neither where its region starts nor a target in it | Warning | |

- **Scanning:** comments, strings and nested `CASE` / `IF` blocks are skipped over, so only the state `CASE`'s own labels and `ELSE` count.
- **Lifecycle states:** the enum members up to `…_ENABLING` are driven by the base class (enable / disable), so the unreachable and dead-end rules skip them. The diagram groups states the same way.
- **Per finding:** *Show in diagram* selects the state. *Open code* opens the Method Editor, or TwinCAT's editor at the line inside XAE. The fix button edits the `.TcDUT` / `doState()` like the editors do. *Ignore* hides a finding for that POU, and the tab keeps a count of ignored findings.

### 5. Editing from the diagram
Right-click a state or the canvas:
- **Add state...** adds a member to the `.TcDUT` enum and an empty `CASE` branch to `doState()`.
- **Add new state from here…** asks for the new state's name, then the condition. It adds the state (an enum member at the end of the list, or last in the state's `{region}` composite, a `CASE` branch and a `getStateDescription()` line) and the transition to it at the end of the state's branch. The canvas then scrolls to it.
- **Add transition from here** starts a line from the state. Click the target state, then enter the condition. The transition is written at the end of the source state's branch, as `IF <condition> THEN machineState := <target>; END_IF`. `Esc` or a click on empty canvas cancels.
- **Rename state...** renames it everywhere, as a whole word: in the enum, in every method of the POU, and in its notes, styles and positions on the canvas. The name is checked against the enum and ST identifiers first.
- **Copy state** (`Ctrl+C` with the state selected), then `Ctrl+V` or **Paste a copy of …**, adds a new state named `<STATE>_COPY`. It gets a copy of the state's code: the branch in `doState()`, its actions and transitions out, placed right after the original. A `machineState := <STATE>` inside the copy goes to the copy. Its line in `getStateDescription()` is copied with " (copy)", and it becomes a new enum member at the end of the list, so no other state changes value. The name is asked for straight away.
- **Delete state…** (`Delete`) shows what goes and asks first: the transitions into it (in `doState()` and `preProcess()`), its branches, and its enum member. It also lists what still refers to it, such as a range bound in `preProcess()`, for you to change. Members after it in the enum get new values when they have none of their own, and the dialog says so.
- **Setting a state's role:** **Set as initial state** (the machine's) and **Mark as final state** do the same as the palette's Initial and Final. **Initial state of <composite>** makes it its composite's initial state. **Move to composite…** moves its enum member into another composite.

#### Initial and final states in the enum
Mark a member with a comment on its line in the `.TcDUT`. The comment is ignored by the compiler, and the canvas writes and reads it:
```
TABLEMANAGER_IDLE_FEED_OFF,     // @initial
TABLEMANAGER_RESET_DONE,        // @final
TABLEMANAGER_ERROR              (* @final  the machine stops here *)
```
- **In a composite:** its `@initial` state is where it starts. The composite gets its own start node, and transitions into that state from outside point at the composite's border. Its `@final` states are its exits: each gets an end node in the composite, and their transitions out start at the composite's border. This keeps the canvas uncluttered. Without marks, the composite's entry is the state entered most often from outside, and its exit is its last enum member, as before.
- **Outside the composites:** `@initial` is the machine's initial state, unless the declaration or `initialize()` sets one. `@final` draws the state to the chart's end node.
- `(* final *)` on a state's `CASE` label in `doState()` also marks it final (the canvas writes it when no `.TcDUT` is loaded). A final state is not reported as a dead end.

Transitions:
- **Priority:** right-click a transition for **Raise priority** / **Lower priority** / **Priority n of m…**, or press `Alt+↑` / `Alt+↓` with it selected. The priority is the order of a state's transitions in its `doState()` branch. The IF / ELSIF arms of one IF swap (the first keeps `IF`), and so do separate statements. A comment right above an arm moves with it. An `ELSE` stays last, and transitions that share a block with others are left for the Method Editor. The message says which. For `preProcess()` transitions, the same items change their order there.
- **Moving an end:** drag a selected transition's end handle onto another state (the state is marked while you drag) to change its target (`machineState := NEW`). Drag its start handle onto another state to move its code (its IF, or its IF / ELSIF arm as an IF of its own) to the end of that state's branch. Released over its own state, the end snaps onto the state's border, and the state flashes to confirm the connection. Dropped on empty canvas, the handles only reshape the line, as before.
- **Delete transition…** (`Delete` with it selected) removes its code block after showing it.
- A click selects a transition. A **double-click** opens its Transition Guard window.

The edits land in the Method Editor and Enum Editor like hand edits: in the app's copy of the POU and the enum, until they are saved (see *Saving the files*).

**Undo / Redo:** `Ctrl+Z` and `Ctrl+Y` (or `Ctrl+Shift+Z`) on the canvas, or the arrows at the top of the palette, undo and redo edits to the POU and the enum. That covers the canvas' edits and the editors' saves. Edits within a second of each other are one step, the history keeps 100 steps, and opening another file starts a new one. Inside a text editor, `Ctrl+Z` is that editor's own undo.

**Composites by dragging:** drag a state onto a `{region}` composite and hold **Alt** as you release it to move its enum member into that composite. Alt-drop it outside to move it out. Without Alt, a drop across a composite's border only reshapes the canvas and shows the hint. The layout then places it in the composite's box.

**Choices** (in the options, off by default): a state's top-level `IF / ELSIF / ELSE` with two or more of its transitions in different arms is drawn as a choice. That is a diamond the state goes to, with each arm's transition leaving it. The canvas' transition edits (priority, moving an end) work on transitions drawn from states, not from a choice.

### Statechart palette
The toolbar on the left of the canvas holds the elements of TwinCAT's UML statechart toolbox. Drag one onto the canvas, a state or a composite; clicking one uses the selected state instead. Each becomes Structured Text:

| Element | Dropped | Written to |
| --- | --- | --- |
| **Pointer** | (click) | Ends drawing a transition |
| **State** | on the canvas, or in a composite | An enum member (at the end, or last in the composite), a `CASE` branch in `doState()`, a line in `getStateDescription()`. It is placed where you dropped it, except in a composite, where the layout keeps it in the composite's box |
| **Initial** | on a state | In a composite: that composite's initial state (`// @initial` in the enum). Elsewhere: the machine's, the state variable's initial value in the declaration (`machineState : E_X := STATE;`); when the base FB declares it, it is set in `initialize()` after `SUPER^.initialize()` |
| **Final** | on the canvas / on a state | A new final state / the state marked final or not: `// @final` on its line in the enum (`(* final *)` on its `CASE` label without a `.TcDUT`). In a composite its transitions out start at the composite's border |
| **Choice** | on a state | Conditions and targets (and an optional `ELSE`) as `IF / ELSIF / ELSE` at the end of its branch |
| **Composite** | on a state / on the canvas | `{region "Name"}` … `{endregion}` around its enum member(s). Regions can be nested; TwinCAT's editor folds them. A composite's members are consecutive, as `preProcess()`'s `>= FIRST AND <= LAST` scopes expect |
| **Transition** | on the source state | Then click the target and enter the condition: `IF <condition> THEN machineState := TARGET; END_IF` at the end of its branch |
| **Completion** | on the source state | Then click the target: `machineState := TARGET;` with no condition, taken once the state's code has run |
| **Exception** | on a state / in a composite | Then click the target and enter the condition. Checked first: the state's branch becomes `IF <condition> THEN machineState := TARGET; ELSE <branch> END_IF`. From a composite it goes in `preProcess()`: `IF machineState >= FIRST AND machineState <= LAST AND (<condition>) THEN …` |
| **Fork/Join** | on a state | Parallel regions inside the state: each a state variable of the enum's type (declared in the POU, e.g. `regionA : E_X;`) and its states (new enum members, a `CASE regionA OF` in the state's branch; the last one final). On entry (`IF bFirstPass THEN`) every region starts in its first state (fork); the state goes to the target when every region is in its final state (join: `IF regionA = A_DONE AND regionB = B_DONE THEN machineState := TARGET; END_IF`). The chart draws the regions inside the state. Transitions drawn between a region's states set its variable (`regionA := …`); one into another region is refused. Live, the state glows and each region's current state is marked (the app reads the region variables too) |
| **Note** | on the canvas | A sticky note with its corner exactly where you dropped it |

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

### Saving the files
Edits (the canvas', and an editor's **Save** / `Ctrl+S`, which puts its code into the POU) change the app's copy of the `.TcPOU` and the `.TcDUT`. The header's **Save** button counts the files with unsaved edits, and so does the status bar. Saving writes them:

| Edition | Save | ▾ menu |
|---|---|---|
| **XAE** | **Save to project**: into the TwinCAT project. A file changed in XAE since it was loaded is refused unless you chose *Keep mine* | |
| **Desktop** | Back to the files they were opened from, with their BOM (as TwinCAT writes them). A sample, which has no file, is saved with Save As | **Save .TcPOU As… / Save .TcDUT As…** |
| **Web, Chrome / Edge** | Back to the file opened with **Browse** or dropped on the header, and to the enum found in the folder you granted. The browser asks for write access once | **Download .TcPOU / .TcDUT** |
| **Web, other browsers** (or a sample) | Downloaded, to replace the original with | **Download** |

- **`Ctrl+S`** saves the files (outside an editor). In an editor it first puts the editor's code into the POU, then saves the files when they can be written in place.
- **A file changed on disk since it was opened** (saved in TwinCAT or another editor): Save asks before overwriting it. Files that did not change are saved.
- **Unsaved edits are not lost silently:** opening another POU (Browse, a drop, a sample) asks first, and closing or reloading does too (the desktop app asks in a dialog). What is kept per viewer (layout, notes, styles, positions, options) is never the code.

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

### Releases (GitHub Actions)
After the **Tests** workflow passes on `master`, the **Release** workflow (`.github/workflows/release.yml`) releases each edition whose code changed since its last release. An edition with no code changes gets no new version.

| Edition | Tag | Files in the GitHub Release | Changes that count |
|---|---|---|---|
| XAE | `xae-v0.8.1` | `KvalStateScope.Xae-<version>.vsix` | the web app (`src/`, `public/`, build config, `package.json`), `xae-extension/` |
| Desktop | `desktop-v1.0.1` | `KvalStateScope-Setup-<version>.exe`, `KvalStateScope-Portable-<version>.exe` | the web app, `electron/`, `shared/`, `build/`, the installer script |
| Web | `web-v1.0.1` | `KvalStateScope-WebApp-<version>.zip` (for any web server), `KvalStateScope-Gateway-<version>.zip` (with its dependencies), `KvalStateScope-Link-<version>.exe` | the web app, `gateway/`, `link/`, `shared/`, their build scripts |

- **Version numbers:** the patch number goes up by one from the edition's last release. To raise major or minor, set it in the edition's files: `source.extension.vsixmanifest` for XAE, `package.json` for Desktop, `gateway/package.json` for Web. The next release then uses it. The workflow writes the version into the files it builds, but doesn't commit them back.
- **Not counted:** Markdown files and tests.
- **Every release:** its notes list the commits that changed that edition.
- **The desktop installer:** it carries the current XAE extension, Link and gateway, but only a desktop change makes a new desktop release.
- **`[skip release]`** in a commit message: tests only, no release.
- **By hand:** *Actions > Release > Run workflow*, with *force* (for example `xae,web`) to release editions even without changes.
- **The plan locally:** `node scripts/release-plan.cjs` shows what the next release would contain.
- **Signing:** the builds are unsigned. For a signed desktop installer, add the repository secrets `CSC_LINK` (the .pfx, base64) and `CSC_KEY_PASSWORD`.

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

**Where the current state is shown (all editions):** it glows on the canvas. In Identified States it has a green outline and a LIVE badge. In the Method Editor its CASE label line is marked green, and in the Enum Editor its member line (in the grid, its row). Nothing is scrolled or panned to it, so the views stay where you left them. Tick **Follow** to pan the canvas to each new state and bring it into view in Identified States. The checkbox is in the Live tab and, while live, in the Identified States header; both are the same setting. It is off by default and remembered.

**One-time setup:**
1. **Add an ADS route on the PLC** for the laptop. The Live tab shows exactly what to add after the first Go live: the laptop's IP and the AMS NetId it uses (the laptop's IP + `.1.1`, or `.1.2` when TwinCAT on the laptop already uses that NetId). Add it with the PLC's TwinCAT router settings (*Router > Edit Routes*) or from an XAE connected to the PLC.
2. **Network:** the laptop must reach the PLC on TCP 48898.

**Going live:**
1. Open the POU from the PLC project with *Browse*. Instance paths and the ADS port are found from the project files, the same way the XAE extension does it.
2. In the Live tab, enter the PLC's **AMS NetId**, or click **Browse** next to it and pick the PLC from the list:
   - **On the network:** the TwinCAT devices that answer the search XAE's *Add Route* dialog uses (UDP 48899), with name, AMS NetId, IP and TwinCAT version. For a PLC behind a router, which the search's broadcast doesn't reach, enter its address in the list's field. The search changes nothing on the devices.
   - **Remembered:** the PLCs you ticked **Remember** for. Remember keeps the PLC (NetId, IP, port, this PC's NetId) in the app for every POU: a POU without a target of its own starts with the last one used. The pencil renames one, *×* forgets it.
   - **Add route:** next to a PLC found on the network. Enter the PLC's user and password (often *Administrator*); the app asks the PLC for an ADS route to this computer, with this PC's AMS NetId and its IP on the PLC's network, as XAE's *Add Route* dialog does for the PLC's side. The password is only sent to the PLC, never kept.
   - **Switching PLCs:** with two or more remembered PLCs, a list next to **Go live** switches to another in one click. While live, it stops and goes live on the other PLC.

   The PLC IP defaults to the first four numbers of the NetId; enter it when it differs, or `host:port` for a forwarded port.
3. Click **Go live**. Without a route the PLC closes the connection, and the tab says which route to add.

Only reads happen, plus the release of the variable handle when the session stops. PLCs that enforce Secure ADS (TLS) are not supported yet.

When the POU is not from the project (a sample, a dropped file), its instances are looked up in the PLC's own symbol and data type tables.

## Live view in the web edition

A browser can't talk ADS itself, so the web edition goes live through a helper. In the Live tab, **Via** chooses which:

- **This computer:** *Kval StateScope Link* (`link/`), a small program on the same computer. It talks ADS straight to the PLC, like the desktop app. Build it with `npm run build:link` and start `Kval StateScope Link.exe`. It opens its page, `http://127.0.0.1:48960/`, with the pairing code to enter in the Live tab and the pages paired with it (**Open Link** in the Live tab opens it again). The PLC needs an ADS route for the computer. See [link/README.md](link/README.md).
- **Gateway:** a shared service on the PLC network, for teams that shouldn't install anything (below).

### Gateway

The **Kval StateScope gateway** (`gateway/`) is a small Node.js service on a machine in the PLC network. The gateway serves the web app over HTTPS, so people open `https://<gateway>:8443/` and install nothing, and it follows the PLCs listed in its configuration for them.

- **Access:** access tokens (only their hashes are stored), connections limited to the configured PLCs, and a log of who follows what.
- **Read-only:** one ADS connection per PLC and one change notification per variable, shared by every viewer.
- **Setup page:** `https://localhost:8443/admin` on the gateway machine searches the network for PLCs (the TwinCAT search, as in the XAE's Add Route dialog), puts them in `config.json`, tests their connections, and creates and revokes access tokens.
- **Setup:** `npm run build:gateway` assembles `release/gateway`. The rest (certificate, PLC list, ADS routes, tokens, running it as a service) is in [gateway/README.md](gateway/README.md).

In the Live tab, enter your access token (or **Sign in** with your company account, when the gateway has it set up), choose the PLC and click **Go live**. The gateway finds the POU's instances in the PLC's symbol tables.

- **Sign-in with company accounts:** OpenID Connect (Microsoft Entra ID / Microsoft 365, ADFS, Okta, Google). The gateway checks who may use it (users, e-mail domains, groups) and logs the user's name. Tokens can stay or be turned off.
- **Alerts:** the gateway follows the machines under a root by itself, with no browser open, and posts to a Teams, Slack or JSON webhook when one is stuck or in an error state, and when it recovers. Set them up on the setup page. The gateway keeps the alert history. **Acknowledge** (with a note) shows everyone who is on it and posts that to the webhook too.
- **Operator board:** `https://<gateway>:8443/?board` (or **Operator board** in the Live tab) is a full-screen view for a screen by the line. It has a tile per machine, green, amber (stuck) or red (error) with problems first, and the alerts with Acknowledge. See [gateway/README.md](gateway/README.md#operator-board).

Through Link, the Live tab's **Browse** also searches the network (Link runs the search on this computer) and offers **Add route**, as in the desktop app.

## Machine Overview

While live, the **Machine Overview** tab lists every state machine of the PLC with its current state. Open it from **Overview** in the Live tab, or from the Window menu.
- **Which machines:** every member under the root (`MAIN.mainStateMachine` by default, the same root as Symbols) that has the state variable (`machineState`). Nested machines and array elements count. Library blocks such as timers and motion blocks are not searched. **Rescan** looks again, for example after a download.
- **Per machine:** its path, type, current state, time in state, and the changes seen since the tab started following it. "≥" means it was already in that state when following began.
- **State names:** from the PLC's own enum types when it describes them. For the loaded POU's type, they come from its `.TcDUT`. Otherwise the state shows as a number.
- **Errors:** a state named like ERROR, FAULT, ALARM or E-STOP is shown in red, and the header counts them. **Errors only** hides the others.
- **Filter** by machine, type or state. **Sort** by machine, errors first, or longest in state.
- **Watch** (or a double-click) opens that machine's diagram in its own tab or window, live on it, as in Symbols.
- **Limit:** the first 80 machines are followed. Use the filter or a deeper root for the others.
- **Other PLCs:** below the POU's own PLC, **Other PLCs** adds more PLCs (the remembered ones, or the gateway's), each with its own connection and overview: several lines on one screen, even when this window is not live. Watch opens a machine live on its PLC. The chosen PLCs are kept and connect again when the tab opens. Desktop app and web edition (Link, gateway); not in XAE.

## Stuck-state alerts

A state can have a **time limit**: how long a machine may stay in it before it counts as stuck.
- **Setting one:** right-click a state on the canvas and choose **Time limit…**, for example `30 s` or `2 min`. While live, the Live tab also has a **Limit** field for the current state and a **Default** for every state that has none. Limits are kept per POU type, such as `SM_TableManager`, so they apply to all its instances, in every window and in the Machine Overview. They are stored per viewer.
- **Over the limit:** the Live tab shows **STUCK** and the time in red (with the limit, e.g. `6.01 s / 2 s`), and the state's node on the canvas pulses red. The Machine Overview marks the machine in amber with **STUCK** and counts it in the header, and **Problems only** shows stuck and error machines. A state already named as an error is not also counted as stuck.
- **Notify:** a notification each time a machine goes over, once per stay in the state (a Windows notification in the desktop app; in the web edition, after the browser asks for permission). It covers this window's machine and the Machine Overview's.

## Recording and replay

Every live session is recorded while it runs: the state variable's changes and the guard values, with the PLC's time stamps.
- **Save recording** (Live tab) writes the session so far to a `.kssrec.json` file (XAE and desktop: a save dialog; web: a download).
- **Replay...** plays a recording back on the diagram as if live: the active state glows, the trail and Transition History fill, the guard values show. **Play** / **Pause**, a speed from 1x to 600x, and a slider to any moment of the recording. **Stop** ends the replay. A replay needs no PLC, so a night's recording can be looked at on any computer.
- **Seen transitions:** the transitions the PLC took (live, not replays) are counted per POU type and kept in the app. Deleting one of them, or a state the PLC used, says so in the confirmation (how often, when last). Moving a transition's end that the PLC took shows a warning. **Save** asks first when the edit removes transitions the PLC has taken, and lists them.

## PLC symbols

The **PLC Symbols** tab, right after Machine Overview (or **Symbols** in the Live tab), shows the PLC's symbols while live. Before that, it says to go live first. It shows the PLC's variables as a tree, from a root that is `MAIN.mainStateMachine` by default; you can type another root and click **Browse**.
- **Members, one level at a time:** open a function block, a structure or an array (up to 100 elements) to read its members from the PLC's data types. Members inherited from a base function block are included.
- **Values:** numbers, booleans, strings and enums show their value live, with the same change notifications as the guard values. The first 60 values on show are followed; close members to see others. Pointers and references are listed without a value.
- **State machines:** a member that has the state variable (`machineState`) is marked. **Watch** opens its diagram in its own tab (XAE, web) or window (desktop), live on that instance, so its transitions are logged in the Live tab and can go to Transition History. XAE and the desktop app find the POU in the PLC project. Otherwise you are asked to pick its `.TcPOU`. The new window uses the same PLC connection.
- **Filter** narrows the opened members by name or type. **Refresh** reads them again, for example after a download.
- Closing the window stops reading its values. The window can be moved and resized, and remembers where it was.

## Simulation
The **Simulation** tab (RightPanel, after Live) steps through the state machine without a PLC. Pick a start and **Start**: the canvas marks the state as Live does, and the editors show its code. The tab lists its transitions in the order they are checked: `preProcess()`'s that apply to it first, since it runs first, then by priority, each with its condition's result. **Take** one, or set the values its conditions read (TRUE / FALSE / a number) and press **Step**, which takes the first that holds. **Back** undoes a step, and the steps are listed. The canvas shows each condition's result like Live does. The tab is off while Live is on.

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
