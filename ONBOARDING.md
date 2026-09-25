# Kval StateScope: Onboarding

Kval StateScope turns Kval Inc. TwinCAT PLC state machines (`SM_*.TcPOU` function blocks plus their `E_*_States.TcDUT` enums) into interactive Mermaid diagrams. It runs as a web app (Vite + React) and as a Windows desktop app (Electron). The GitHub repo is still named `TcPouStatechartGenerator`.

## Quick start

Requirements: Node.js 20 or newer, npm, and Windows for the desktop build.

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
2. **Generating.** `generateStatechart(dut, pou, options)` in `src/generator.ts` is a port of the original C# tool. It produces Mermaid text. `App.tsx` re-runs it whenever the sources or options change.
3. **Rendering.** `components/MermaidViewer.tsx` renders the markdown with Mermaid 11 and the ELK layout. After rendering it works directly on the SVG DOM (no re-render) for:
   - node and edge dragging (`utils/nodeDragger.ts`)
   - line and label styles (`utils/edgeStyles.ts`)
   - selection and connected-edge highlighting
   - notes (`NoteOverlaysLayer.tsx`)
4. **Workspace.** A three-panel docking layout like TwinCAT XAE (`utils/dockLayout.ts`, `components/dock/`). Tab contents are portaled into persistent host nodes, so moving a tab never remounts it.

## Where things live

| Area | Files |
|---|---|
| App shell, header, state | `src/App.tsx` |
| Diagram canvas (largest file) | `src/components/MermaidViewer.tsx` |
| Parsing and generation | `src/generator.ts`, `utils/pouStateExtractor.ts`, `utils/pouStateEditor.ts`, `utils/dutEnumEditor.ts` |
| SVG drag / reroute (ELK orthogonal) | `utils/nodeDragger.ts` |
| Canvas windows | `TransitionGuardInspector.tsx` (2nd click on an edge), `StateStylePopup.tsx` (2nd click on a state) |
| Styles | `utils/nodeStyles.ts` (states: injected into the Mermaid code), `utils/edgeStyles.ts` (edges and labels: applied to the SVG) |
| Docking | `utils/dockLayout.ts`, `components/dock/*` |
| Toolbar overflow ("Hidden" menus) | `hooks/useToolbarOverflow.ts` |
| Editors | `MethodStructuredTextEditor.tsx`, `DutEnumEditor.tsx`, `utils/st*.ts` |
| Export / PDF | `utils/diagramExport.ts`, `utils/printToPdf.ts`, `ExportModal.tsx` |
| Desktop | `electron/main.cjs`, `electron/preload.cjs`, `electron/tcSourceFiles.cjs` |
| Icon | source art `public/icon.svg` (32 px and up) and `public/favicon.svg` (16–32 px); packaged `build/icon.ico`, `electron/assets/icon.ico` |

## Things that bite

- **Parallel transitions.** Two transitions can share the same source and target, for example `A->B` and `A->B#60`. Never match edges by `from->to` alone. Each label is linked to its exact path with `data-linked-path-id`, and label and badge lookups must respect that link. Match labels by the whole guard text, never by substring: guards such as `else` repeat all over a diagram.
- **Mermaid ids.** Flowchart edges are `L_<from>_<to>_<n>`, and `n` is not consecutive. ELK renders edges in `g.edges.edgePath`, and the app adds the `edgePaths` class so both layouts look the same to the rest of the code.
- **Drag performance.** Drags update the DOM directly, at most once per animation frame (`requestAnimationFrame`), and commit React state on mouse-up. Window-level drag listeners use the **capture** phase, because canvas windows stop mouse events from bubbling.
- **Line endings.** Many files are CRLF on Windows checkouts. Keep them that way, and make scripted edits CRLF-aware.
- **Persisted UI state** lives in localStorage, for example `tc_statechart_dock_layout_v1` and `tc_statechart_diagram_notes_metadata`. Clear site data when a layout looks wrong after pulling changes.
- **Vite watcher.** `vite.config.ts` ignores `release/` and `dist/`. Without that, `build:exe` fails with EPERM while the dev server is running.

## Testing

There is no automated test suite yet. Before opening a PR:

1. Run `npm run lint` and `npm run build`. Both must pass.
2. Test manually in the browser with the bundled samples. **Table Manager (Line 202)** has parallel transitions and long guard labels, so it's the best stress test. Check that you can:
   - click a state to select it, and click it again for the State Style window;
   - click an edge to select it, and click it again for the Transition Guard window (Style card);
   - drag states, edges, labels and notes;
   - export.
3. For desktop changes: run `npm run build:exe` and try `release/Kval StateScope <version>.exe`.

## Contributing

- Branch from `master`, then open a pull request on GitHub.
- Commit messages follow `feat: ...`, `fix: ...`, `docs: ...`.
- Keep `README.md` in sync when you change user-facing behaviour.

## Known issues / good first tasks

- `parseDutContent` in `utils/dutEnumEditor.ts` (used by the Enum Editor) reads only 2 members from enums written with leading commas (`, STATE_X` per line), such as the Door Dasher and 234 Feed Manager samples. The generator's `readEnumOrder` handles them correctly.
- In Table Manager, the start transition (start → `TABLEMANAGER_DISABLED`) carries the wrong source/target tags on its SVG path.
- Edge line drags still re-apply offsets to the whole diagram on every mouse move. Label and node drags are already frame-batched.
- The repo root has an empty, accidentally committed file `State2n` that can be deleted.
