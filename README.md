# TcPouStatechartGenerator (Web & Desktop Edition)

A high-performance interactive tool that parses Beckhoff TwinCAT PLC Structured Text state machines and generates publication-quality [Mermaid](https://mermaid.js.org/) flowcharts and state diagrams (`flowchart TD` with subgraphs and `stateDiagram-v2`).

The generator extracts state logic and transitions directly from the `doState()` and `preProcess()` methods of a `SM_*.TcPOU` file together with the enum definitions in matching `E_*_States.TcDUT` files. If the POU includes a `doState_UmlSC()` method, embedded UML composite states are preserved and mapped into nested subgraphs.

---

## Key Features

### 1. Interactive Diagram Canvas
- **Fluid Pan & Zoom**: Smooth gliding canvas navigation with mouse wheel zoom, fit-to-screen, 1:1 reset, and full-screen presentation mode.
- **Node Dragging & Custom Layouts**: Drag individual state nodes directly on the canvas to customize diagram positioning.
- **Auto-Align Diagram Engine**: Dedicated toolbar button and shortcut (`A`) to re-run the layout engine (ELK or Dagre) to cleanly organize all nodes according to current flowchart or stateDiagram-v2 logic while respecting the locked layout state.
- **Magnetic Snap to Grid**: Toggleable snap grid (10px, 20px, 40px) with real-time horizontal and vertical smart alignment crosshair guides.
- **Layout Locking**: Lock diagram layout to preserve custom manual positions across code edits or automatic re-layouts.
- **In-Place State Selection**: Click any node directly on the canvas to inspect its styles, incoming/outgoing transitions, and Structured Text code without unexpected viewport jumps.
- **Crosshair / Jump to State**: Jump directly to any state from the sidebar, minimap, or legend with smooth centering and SVG-safe animated glowing highlight rings.
- **Floating Interactive Minimap**: Live bird's-eye overview of the entire diagram with draggable viewport indicator and quick-navigation clicks.
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
git clone https://github.com/username/tcpoustatechartgenerator.git
cd tcpoustatechartgenerator

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
- **`TcPouStatechartGenerator Setup <version>.exe`** — Standard Windows Installer with Start menu shortcuts and auto-updater support.
- **`TcPouStatechartGenerator <version>.exe`** — Portable single-file executable (no installation required, runs directly from USB or local drive).

---

## Architecture & Technology Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS
- **Diagramming Engine**: Mermaid.js, SVG DOM manipulation, dynamic SVG transform matrices
- **Icons**: Lucide React
- **Packaging**: Electron, electron-builder
- **TwinCAT Parser**: Custom regex-based AST parser for IEC 61131-3 Structured Text (`.TcPOU`, `.TcDUT`)
