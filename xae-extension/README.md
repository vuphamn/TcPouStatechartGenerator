# Kval StateScope for TwinCAT XAE (prototype)

A Visual Studio extension (VSIX) that opens a Kval `SM_*.TcPOU` state machine in Kval StateScope, docked as a document tab inside TwinCAT XAE. The tab hosts the same web app as the browser and desktop versions, running in WebView2 (the Edge browser control).

Targets: TcXaeShell 64-bit (TwinCAT 3.1.4026+), and Visual Studio 2022 and 2026 with TwinCAT integration. It uses the same installation target as Beckhoff's own XAE extensions. The older 32-bit TcXaeShell (VS 2017 based) is not supported.

## Build

Requirements: Visual Studio 2022 or 2026 (for MSBuild), Node.js 20+. The VS extension-development workload is not needed: the VSSDK build tools come from NuGet.

```powershell
cd xae-extension
.\build.ps1          # npm run build, copy dist/ into the extension, build the VSIX
```

Output: `xae-extension\KvalStateScope.Xae\bin\Release\KvalStateScope.Xae.vsix`

## Install

- **Visual Studio 2022 / 2026:** double-click the `.vsix`, then restart Visual Studio.
- **TcXaeShell:** run its own installer:

  ```powershell
  & 'C:\Program Files\Beckhoff\TcXaeShell\Common7\IDE\VSIXInstaller.exe' KvalStateScope.Xae.vsix
  ```

If the commands don't appear after a restart, make the IDE merge extension registrations once:

```powershell
& 'C:\Program Files\Beckhoff\TcXaeShell\Common7\IDE\TcXaeShell.exe' /updateconfiguration
# or: devenv.exe /updateconfiguration
```

Uninstall from **Extensions > Manage Extensions** (Visual Studio), or with `VSIXInstaller.exe /uninstall:KvalStateScope.Xae.e0718790-a072-4c96-ba71-67161c7fdaa6`.

It needs the Microsoft Edge WebView2 Runtime, which Windows 10/11 normally already have. The WebView2 .NET assemblies are not shipped: each IDE provides its own copy (the extension compiles against the oldest, TcXaeShell's 1.0.2151.40).

## Use

- **Right-click** a `.TcPOU` and choose **Open in Kval StateScope**. The command only appears when the selection is a `.TcPOU`. It is on:
  - the project-item context menu;
  - the context menu of an open document's tab.
- **Tools > Kval StateScope...** opens the selected or active `.TcPOU`. Without one, it asks for a file.
- **Command Window:** `Tools.KvalStateScope.Open C:\Path\SM_X.TcPOU`

The `.TcDUT` enum is found as in the other editions: every `.TcDUT` in the `.TcPOU`'s folder and subfolders is ranked by how many `doState()` states its enum declares.

**Save to project** (header, next to the file name) writes edited `.TcPOU` / `.TcDUT` files back to disk.
- A copy of each original is kept in `%LocalAppData%\KvalStateScope\Backups`.
- Saving is refused when XAE has unsaved changes for that file, or when the file changed on disk after StateScope loaded it.

## TwinCAT PLC tree context menu

TwinCAT's PLC project tree uses its own context-menu id, which is compiled into Beckhoff's package. If **Open in Kval StateScope** does not appear when you right-click a POU in the PLC tree:

1. Close XAE and turn on command logging:

   ```powershell
   # TcXaeShell 64-bit is VS 17.0-based; for Visual Studio use its own 17.0_<id> or 18.0_<id> key
   reg add "HKCU\Software\Microsoft\VisualStudio\17.0_Config\General" /v EnableVSIPLogging /t REG_DWORD /d 1 /f
   ```

2. Start XAE, hold **Ctrl+Shift** and right-click a POU in the PLC tree. A dialog shows the menu's **Guid** and **CmdID**.
3. Add a `CommandPlacement` for that Guid / id in `KvalStateScopePackage.vsct` (a commented template is there) and rebuild.

## Tested

- **Visual Studio 2022 (17.14) and 2026 (18.10)**, in their experimental instances with TwinCAT integration installed.
  - Tools command with a path argument, document tab, WebView2 start-up, and loading a `.TcPOU` with its `.TcDUT` found in `DUTs\`.
  - Editing, **Save to project** (file written, backup kept), and refusal after an outside change.
- **Not yet tested:**
  - TcXaeShell. It uses the same installation target and prerequisite as Beckhoff's own extensions.
  - The right-click placements inside a real TwinCAT PLC tree.

## Prototype limits

- **Saving writes the files directly.** XAE usually notices the change and offers to reload an open POU. If it doesn't, reopen the POU. Phase 2 moves saving to Beckhoff's Automation Interface, so XAE's in-memory project stays in sync (undo, dirty state).
- **The PLC tree menu placement needs the id from the step above.**
- **DevTools** are enabled in the tab for diagnostics (F12). Start-up, load and save steps are logged to `%LocalAppData%\KvalStateScope\log.txt`.

## Layout

| File | Role |
|---|---|
| `KvalStateScopePackage.cs` | Package: loads when a solution opens; shows the tool window |
| `KvalStateScopePackage.vsct` | Commands and menu placements |
| `OpenInStateScopeCommand.cs` | Command handlers |
| `SelectionHelper.cs` | Finds the `.TcPOU` behind the selection / active document |
| `StateScopeToolWindow.cs`, `StateScopeControl.cs` | Document tab with WebView2; message bridge to the app (`src/utils/xaeHost.ts`) |
| `HostFiles.cs` | Dialogs, `.TcDUT` search, saving with backup and safety checks |
| `VSPackage.resx` | Carries the compiled command table (IDE loads menus from `VSPackage.resources`) |
