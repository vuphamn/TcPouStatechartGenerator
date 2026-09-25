# Kval StateScope

Kval StateScope is an interactive viewer for the Kval Inc. TwinCAT state machines (`SM_*.TcPOU` function blocks). It parses the Beckhoff TwinCAT PLC Structured Text state machine and generates publication-quality [Mermaid](https://mermaid.js.org/) flowcharts and state diagrams (`flowchart TD` with subgraphs and `stateDiagram-v2`).

The generator extracts state logic and transitions directly from the `doState()` and `preProcess()` methods of a `SM_*.TcPOU` file together with the enum definitions in matching `E_*_States.TcDUT` files. If the POU includes a `doState_UmlSC()` method, embedded UML composite states are preserved and mapped into nested subgraphs.

---

## Workspace Layout

The workspace is organized like TwinCAT XAE / Visual Studio, in three resizable main panels separated by splitters:

| Panel | Contents |
|---|---|
| **LeftPanel** | Identified States, PLC Transition Logger, How It Works |
| **MiddlePanel** | Document tabs: Diagram Canvas, Method Editor, Enum Editor, Complexity Report, Transition Frequency, Transition History |
| **RightPanel** | Tool windows stacked vertically: Documentation, Mermaid Markdown · Keyword Search & Filter, Real-Time Stats, Complexity Heat-Map, Diagram Legend, Notes · Minimap |

The diagram toolbar (search, view and editing controls) and the diagram **Options** toolbar live inside the Diagram Canvas tab, since they only apply to the canvas.

### Loading a Function Block

The **Function Block** entry in the header toolbar (left of **Sample**) loads your own code: click **Browse** and pick a `.TcPOU` file, or drop one onto it. Only the file name is shown; the code is edited in the Method Editor and Enum Editor tabs.

The state enum is found automatically. By convention the `.TcDUT` sits in the same folder as the `.TcPOU` or in one of its subfolders, and that folder may hold several `.TcDUT` files. So after the `doState()` method is parsed, every `.TcDUT` in that folder tree is checked, and the one whose enum declares the most `doState()` CASE states is used. Build and library folders (`_Boot`, `_CompileInfo`, `_Libraries`, ...) are skipped.

- **Desktop app**: the folder is searched as soon as the `.TcPOU` is opened.
- **Web (Chrome / Edge)**: browsers do not reveal a file's folder, so the header shows **Find .TcDUT...**. It opens a folder picker at the `.TcPOU`'s folder; after you allow read access, later `.TcPOU` files inside that folder are matched without asking again.
- **Other browsers**: choose the `.TcDUT` file(s) directly; the best match among them is used.

When more than one `.TcDUT` matches, the header shows the count; click the enum name to pick another one.

### Inside TwinCAT XAE (prototype)

`xae-extension/` builds a Visual Studio extension (VSIX) for TcXaeShell 64-bit and Visual Studio 2022 / 2026. It adds **Open in Kval StateScope** to the right-click menu of `.TcPOU` files and shows the app as a document tab in XAE, with **Save to project** for edits. See [xae-extension/README.md](xae-extension/README.md).

### Working with tabs
- **Right-click a tab** for Close, Close All But This, Float, New Vertical Document Group (MiddlePanel) / New Horizontal Tab Group (RightPanel), and Move to Next / Previous Tab Group.
- **Drag a tab** onto another group's tab strip or onto the middle of a group to move it there, or onto a group's left/right (MiddlePanel) or top/bottom (RightPanel) edge to create a new group. Tabs can only be moved within their own panel.
- **Float a document**: double-click a MiddlePanel tab (or choose *Float*) to undock it into a window that can be moved and resized within the MiddlePanel. Double-click the window's title bar or use its dock button to dock it again.
- **Close a tab** with its `×` button or a middle-click.
- **Reopen closed tabs** from the **Window** menu in the header. A reopened tab returns to its original panel and tab group. The Window menu also shows/hides the Left and Right panels and resets the layout.
- **Resize** panels and tab groups by dragging the splitters; double-click a side-panel splitter to restore its default width.

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
- **Interactive Minimap**: Live bird's-eye overview of the entire diagram in the RightPanel, with a draggable viewport indicator and quick-navigation clicks.
- **Interactive Diagram Legend**: Color-coded breakdown of states (initial, composite, logic, error sinks), transition priority markers, and note indicators.
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

### 4. TwinCAT Source Editors & Inspection
- **Identified States Sidebar**: Filter states by name, logic presence in `doState()`, error sinks, or composite groups; sort alphabetically or by enum index; jump to any state with 1 click.
- **Integrated Enum Editor (`.TcDUT`)**: In-app editor for TwinCAT enum definitions with syntax checking and member management.
- **Integrated Method Editor (`.TcPOU`)**: Embedded editor for `doState()` and `preProcess()` Structured Text blocks.
- **Custom State Styling Inspector**: Customize fill colors, stroke colors, and borders for individual states with instant live preview.

### 5. Export & Tooling
- **Dual Mermaid Formats**: Switch instantaneously between `flowchart TD` (with subgraphs) and `stateDiagram-v2`.
- **Curve Algorithms**: Customize flowchart routing curves (basis, linear, cardinal, natural, step).
- **Mermaid Live Integration**: Open generated diagrams directly in [mermaid.live](https://mermaid.live) with 1 click.
- **One-Click Export**: Copy Mermaid Markdown to clipboard, download `.statechart.md`, or export diagram graphics.
- **Diagram Presets**: Save and apply combinations of layout engine, curve, theme, priority format and export settings (PNG/SVG, 1x–4x scale, dark/white/transparent background). *Export with Preset* downloads using the active preset's export settings, and the High-Res Export dialog opens with them preselected.

---

## Pre-Loaded Production Samples

Test the generator immediately with 5 real-world Beckhoff TwinCAT state machine samples:
1. **Door Dasher (`SM_DoorDasher`)**: Complex multi-level state machine with nested UML composite states (`Disabled`, `Enabling`, `Enabled`, `Stopping`).
2. **Table Manager (`SM_TableManager`)**: Indexing rotary table sequencer with error handling and interlocks.
3. **K-Motor VFD (`SM_KMotorVFDEtherCATi550`)**: EtherCAT Lenze i550 variable frequency drive velocity/position controller.
4. **K-Analog Measure (`SM_KAnalogMeasure`)**: Analog sensor sampling, calibration, and zeroing sequence.
5. **Feed Manager (`SM_234FeedManager`)**: Material feeder sequencing and fault recovery logic.

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

You can package the application as a standalone, offline Windows desktop application via Electron:

```powershell
# Build Windows Installer (.exe) and Portable standalone executable
npm run build:exe
```

Compiled executables are output to the `release/` directory:
- **`Kval StateScope Setup <version>.exe`** — Standard Windows Installer with Start menu shortcuts and auto-updater support.
- **`Kval StateScope <version>.exe`** — Portable single-file executable (no installation required, runs directly from USB or local drive).

---

## Architecture & Technology Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Workspace**: Custom docking layout (`src/utils/dockLayout.ts`, `src/components/dock/`) — tab contents are rendered into persistent host elements that move between tab groups instead of remounting
- **Diagramming Engine**: Mermaid.js, SVG DOM manipulation, dynamic SVG transform matrices
- **Icons**: Lucide React
- **Packaging**: Electron, electron-builder
- **TwinCAT Parser**: Custom regex-based AST parser for IEC 61131-3 Structured Text (`.TcPOU`, `.TcDUT`)
