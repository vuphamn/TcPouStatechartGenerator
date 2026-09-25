# Kval StateScope: Onboarding

Kval StateScope turns Kval Inc. TwinCAT PLC state machines (`SM_*.TcPOU` function blocks plus their `E_*_States.TcDUT` enums) into interactive Mermaid diagrams. The GitHub repo is still named `TcPouStatechartGenerator`.

The same React app ships in three hosts:

| Host | What it is | Where |
|---|---|---|
| **Web edition** | Vite + React in a browser | `src/` |
| **Desktop app** | Electron on Windows; reads files and talks ADS to PLCs itself | `electron/` |
| **TwinCAT XAE extension** | C# VSIX that shows the app in a WebView2 document tab inside TcXaeShell / Visual Studio (prototype) | `xae-extension/` |

For live PLC data in the web edition there are two small Node helpers: **Kval StateScope Link** (`link/`, runs on the user's own PC) and the **gateway** (`gateway/`, one server in the PLC network that also serves the app over HTTPS).

## Quick start

Requirements: Node.js 20 or newer, npm, and Windows for the desktop and XAE builds.

```bash
git clone https://github.com/vuphamn/TcPouStatechartGenerator.git
cd TcPouStatechartGenerator
npm install
npm run dev            # web app on http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (port 3000, hot reload) |
| `npm run lint` | Type check only (`tsc --noEmit`). There is no ESLint setup |
| `npm run build` | Type check + production web build into `dist/` |
| `npm run electron:dev` | Desktop app against the running dev server (start `npm run dev` first) |
| `npm run build:exe` | Web build + Windows installer and portable exe into `release/` |
| `npm run build:gateway` | Web build + the gateway package (see `gateway/README.md`) |
| `npm run build:link` | `Kval StateScope Link.exe`, a single-file Node executable (see `link/README.md`, which also covers code signing) |
| `xae-extension\build.ps1` | Web build, copied into the VSIX, then the VSIX (needs Visual Studio's MSBuild; see `xae-extension/README.md`) |

The app opens on a bundled sample, so you can use it without any PLC files. Pick others from the **Sample** dropdown in the header. They live in `src/samples/samplesData.ts`.

**VS Code gotcha:** VS Code terminals can set `ELECTRON_RUN_AS_NODE=1`, which makes Electron start as plain Node and exit immediately. Clear the variable before `electron:dev` or before launching the built exe from that terminal.

## How it works

```
.TcPOU + .TcDUT ──► src/generator.ts ──► Mermaid markdown ──► MermaidViewer
   (XML / ST)        parse doState(),        (flowchart or        renders SVG, then
                     preProcess(), enum      stateDiagram-v2)     post-processes it in
                                                                  place (drag, styles,
                                                                  notes, highlights)
```

1. **Loading sources.** The **Function Block** entry in the header (`SourceFilesHeaderItem.tsx`) browses for a `.TcPOU`. The matching `.TcDUT` is then searched for in the `.TcPOU`'s folder and its subfolders, and every candidate is ranked by how many `doState()` CASE states its enum declares (`utils/dutMatcher.ts`).
   - Desktop: `electron/preload.cjs` and `electron/tcSourceFiles.cjs` scan the folder through IPC.
   - Web (Chrome / Edge): the File System Access API (`utils/sourceFileAccess.ts`). The user grants folder access once with **Find .TcDUT...**.
   - XAE: the extension sends the file and its candidates (`loadPou` message).
2. **Generating.** `generateStatechart(dut, pou, options)` in `src/generator.ts` is a port of the original C# tool. It produces Mermaid text. `App.tsx` re-runs it whenever the sources or options change.
3. **Rendering.** `components/MermaidViewer.tsx` renders the markdown with Mermaid 11 and the ELK (or dagre) layout. After rendering it works directly on the SVG DOM (no re-render). Effects keyed on the rendered SVG add classes for:
   - node and edge dragging (`utils/nodeDragger.ts`)
   - line and label styles (`utils/edgeStyles.ts`)
   - selection and connected-edge highlighting
   - notes (`NoteOverlaysLayer.tsx`)
   - the live state, Problems badges, the Paths highlight and the Changes colors
4. **Workspace.** A three-panel docking layout like TwinCAT XAE (`utils/dockLayout.ts`, `components/dock/`). Tab contents are portaled into persistent host nodes, so moving a tab never remounts it. The right panel is one tab group; the minimap and legend are canvas overlays. XAE keeps its own saved layout (compact by default). A status bar (`StatusBar.tsx`) replaces toasts, and focus mode (`Z`) hides everything but the diagram.

### Talking to the host

The app detects its host and uses one bridge per host. Features that need files, git or ADS go through these, so keep all three in mind when you add one:

| Host | Bridge | Notes |
|---|---|---|
| Desktop | `window.tcDesktop` from `electron/preload.cjs`, handled by `ipcMain.handle('tc:...')` in `electron/main.cjs` | Full file system and git access |
| XAE | `postMessage` over WebView2; message types in `src/utils/xaeHost.ts` (`HostMessage` / `AppMessage`), handled in `xae-extension/KvalStateScope.Xae/StateScopeControl.cs` | The extension only serves files StateScope loaded or files of the loaded POU's PLC project |
| Web | Browser APIs only (folder picker, downloads); live data via Link or the gateway (`utils/liveGateway.ts`) | No git; "open referenced POU" shows a message |

Examples of wrappers that hide the difference: `utils/projectFiles.ts` (all POUs of a project, save a document), `utils/hostGit.ts` (committed version of a file), `utils/liveHost.ts` (live sessions).

### Live view

The **Live** tab follows the POU's state variable in a running PLC over ADS and lights up the active state.
- **XAE:** `LiveMonitor.cs` uses TwinCAT's `TcAdsDll.dll` through the local AMS router; `LiveTargets.cs` finds the instance paths from the project's declarations.
- **Desktop, Link and gateway:** the shared Node code in `shared/tcAds.cjs` and `shared/liveSession.cjs` (ads-client in direct mode, no router needed). Desktop wiring is in `electron/tcLive.cjs` and `electron/tcLiveTargets.cjs`.
- **App side:** `LivePanel.tsx`, `utils/liveView.ts`.

## Where things live

| Area | Files |
|---|---|
| App shell, header, state | `src/App.tsx` |
| Diagram canvas (largest file) | `src/components/MermaidViewer.tsx` |
| Parsing and generation | `src/generator.ts`, `utils/pouStateExtractor.ts`, `utils/pouStateEditor.ts`, `utils/dutEnumEditor.ts` |
| SVG drag / reroute (ELK orthogonal) | `utils/nodeDragger.ts` |
| Canvas windows | `TransitionGuardInspector.tsx` (2nd click on an edge), `StateStylePopup.tsx` (2nd click on a state) |
| Context menu | `DiagramContextMenu.tsx`; extra items (paths, add / rename, open referenced POU) come from `diagramContextMenuItems` in `App.tsx` |
| Styles | `utils/nodeStyles.ts` (states: injected into the Mermaid code), `utils/edgeStyles.ts` (edges and labels: applied to the SVG) |
| Docking, status bar | `utils/dockLayout.ts`, `components/dock/*`, `components/StatusBar.tsx` |
| Problems (lint) | `utils/stateMachineLint.ts` (rules, fixes, line lookups such as `stateAtLine`), `ProblemsPanel.tsx` |
| Paths between states | `utils/statePaths.ts`, `PathsPanel.tsx` |
| Changes (diff) | `utils/chartDiff.ts`, `ChangesPanel.tsx`, `utils/hostGit.ts` |
| Edits from the diagram | `utils/stateEdits.ts` (add state, add transition, rename), `TextPromptDialog.tsx` |
| Referenced state machines | `utils/referencedMachines.ts` |
| Project documentation | `utils/projectDocumentation.ts`, `utils/projectFiles.ts` |
| Live view | `LivePanel.tsx`, `utils/liveView.ts`, `utils/liveHost.ts`, `utils/liveGateway.ts`, `shared/`, `link/`, `gateway/` |
| Toolbar overflow ("Hidden" menus) | `hooks/useToolbarOverflow.ts` |
| Editors | `MethodStructuredTextEditor.tsx`, `DutEnumEditor.tsx`, `utils/st*.ts` |
| Export / PDF | `utils/diagramExport.ts`, `utils/printToPdf.ts`, `ExportModal.tsx` |
| Desktop | `electron/main.cjs`, `electron/preload.cjs`, `electron/tcSourceFiles.cjs`, `electron/tcLive*.cjs` |
| TwinCAT XAE extension | `xae-extension/` (see its README for the file layout) |
| Icon | source art `public/icon.svg` (32 px and up) and `public/favicon.svg` (16–32 px); packaged `build/icon.ico`, `electron/assets/icon.ico` |

## Things that bite

- **Parallel transitions.** Two transitions can share the same source and target, for example `A->B` and `A->B#60`. Never match edges by `from->to` alone. Each label is linked to its exact path with `data-linked-path-id`, and label and badge lookups must respect that link. Match labels by the whole guard text, never by substring: guards such as `else` repeat all over a diagram. Keys such as edge styles use `FROM->TO#n`; `renameEdgeKeys` in `utils/stateEdits.ts` shows how to migrate them.
- **Mermaid ids.** Flowchart edges are `L_<from>_<to>_<n>`, and `n` is not consecutive. ELK renders edges in `g.edges.edgePath`, and the app adds the `edgePaths` class so both layouts look the same to the rest of the code.
- **Drag performance.** Drags update the DOM directly, at most once per animation frame (`requestAnimationFrame`), and commit React state on mouse-up. Window-level drag listeners use the **capture** phase, because canvas windows stop mouse events from bubbling.
- **Clicks on nodes** go through the node-drag handler, not only the canvas click handler. A new click mode (such as the add-transition connect mode) has to be handled in both.
- **TwinCAT editor line numbers.** TwinCAT's ST editor numbers a method's declaration lines first, then its implementation. Map editor lines with the declaration's line count (`declarationLineCount`), not with the editor's total line count, which can be one more than the file's.
- **Line endings.** Many files are CRLF on Windows checkouts. Keep them that way, and make scripted edits CRLF-aware.
- **Persisted UI state** lives in localStorage, for example `tc_statechart_dock_layout_v1` (and `..._xae` inside XAE), `tc_statechart_diagram_notes_metadata` and `kss.followSelection`. Saved dock layouts carry a `revision`; bump `LAYOUT_REVISION` in `dockLayout.ts` when the default layout changes, so old layouts are migrated. Clear site data when a layout looks wrong after pulling changes.
- **Vite watcher.** `vite.config.ts` ignores `release/` and `dist/`. Without that, `build:exe` fails with EPERM while the dev server is running.
- **Adding a host message** means touching three places: the type in `src/utils/xaeHost.ts`, the `switch` in `StateScopeControl.cs`, and, for desktop, `preload.cjs` plus an `ipcMain.handle` in `main.cjs`.

## Testing

There is no automated test suite yet. Before opening a PR:

1. Run `npm run lint` and `npm run build`. Both must pass.
2. Test manually in the browser with the bundled samples. **Table Manager (Line 202)** has parallel transitions and long guard labels, so it's the best stress test. Check that you can:
   - click a state to select it, and click it again for the State Style window;
   - click an edge to select it, and click it again for the Transition Guard window (Style card);
   - drag states, edges, labels and notes;
   - right-click a state for Paths, Add transition and Rename, and check the Problems, Paths and Changes tabs;
   - export.
3. For desktop changes: run `npm run build:exe` and try `release/Kval StateScope <version>.exe`.
4. For XAE changes: build with `xae-extension\build.ps1` and try it in Visual Studio's experimental instance (`/rootsuffix Exp`) on a **copy** of a TwinCAT project, never on a working project. The WebView2 tab can be debugged with F12, and the extension logs to `%LocalAppData%\KvalStateScope\log.txt`.
5. Without a PLC, the Live tab can only be tested up to the connection error. Test it against a real PLC before relying on it.

## Contributing

- Branch from `master`, then open a pull request on GitHub.
- Commit messages follow `feat: ...`, `fix: ...`, `docs: ...`.
- Keep `README.md` (and `xae-extension/README.md`, `link/README.md`, `gateway/README.md` for their parts) in sync when you change user-facing behaviour. Bump the extension version in `source.extension.vsixmanifest` and `Properties/AssemblyInfo.cs` when the VSIX changes.

## Known issues / good first tasks

- `parseDutContent` in `utils/dutEnumEditor.ts` (used by the Enum Editor) reads only 2 members from enums written with leading commas (`, STATE_X` per line), such as the Door Dasher and 234 Feed Manager samples. The generator's `readEnumOrder` handles them correctly.
- In Table Manager, the start transition (start → `TABLEMANAGER_DISABLED`) carries the wrong source/target tags on its SVG path.
- Edge line drags still re-apply offsets to the whole diagram on every mouse move. Label and node drags are already frame-batched.
- Not yet tested: Live view against a real PLC; git compare for files inside git submodules; the desktop app's save dialog for project documentation.
- The repo root has an empty, accidentally committed file `State2n` that can be deleted.
