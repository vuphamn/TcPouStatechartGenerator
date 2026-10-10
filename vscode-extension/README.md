# Kval MachineScope for VS Code

TwinCAT state machines (`.TcPOU`) as statecharts, inside VS Code: the same app as the web edition and the TwinCAT XAE
extension, with full file access.

- **Open:** right-click a `.TcPOU` in the Explorer (or an editor's tab) → **Open in Kval MachineScope**, or
  **Open With… → Kval MachineScope Statechart**.
- **Its enum:** the `.TcDUT` files in the POU's folder and its subfolders are searched for the one that declares its
  states (**Find .TcDUT…** searches another folder).
- **Save:** your edits go back into the `.TcPOU` / `.TcDUT` files. A file changed on disk since it was loaded (saved in
  TwinCAT, git) is not overwritten unless you choose to keep your edits.
- **Go to code:** opens the `.TcPOU` beside the chart at that line of the method.
- **Layout:** kept in `<POU>.machinescope.json` beside the POU, as in the desktop app and XAE.
- **Not here:** live view (follow a PLC) — use the desktop app, the web edition with Link or a gateway, or TwinCAT XAE.

## Install

The desktop installer (`Kval MachineScope Setup <version>.exe`) installs it: its **VS Code edition** page, on by
default when VS Code is found. Running the setup again updates it.

## Build and install by hand

```
npm run build                     # the app (dist/)
node vscode-extension/pack.cjs    # release/kval-machinescope-vscode-<version>.vsix
```

Then in VS Code: **Extensions → … → Install from VSIX…**.
