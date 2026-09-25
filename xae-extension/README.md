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
- **TcXaeShell:** close it, then run:

  ```powershell
  cd xae-extension
  .\install-tcxaeshell.ps1              # asks for administrator rights (UAC)
  .\install-tcxaeshell.ps1 -Uninstall   # to remove it
  ```

  The script copies the extension into `C:\Program Files\Beckhoff\TcXaeShell\Common7\IDE\Extensions\Kval Inc\Kval StateScope`, which is how Beckhoff installs its own XAE extensions. It then updates `Extensions\extensions.configurationchanged`, so TcXaeShell picks up the change on its next start. TcXaeShell is an isolated shell and has no `/updateconfiguration` switch.

  Don't use TcXaeShell's own `VSIXInstaller.exe`. It can fail with *"The type initializer for 'PerTypeValues`1' threw an exception"*. Its `VSIXInstaller.exe.config` loads `System.Runtime.CompilerServices.Unsafe` and three other assemblies from `Common7\IDE\net472\`, a folder TcXaeShell doesn't ship. That is a defect in the TcXaeShell installation, not in the extension.

In Visual Studio, if the commands don't appear after a restart, make it merge extension registrations once with `devenv.exe /updateconfiguration`. In TcXaeShell, run `install-tcxaeshell.ps1` again: it updates the change marker.

Uninstall from **Extensions > Manage Extensions** (Visual Studio), with `VSIXInstaller.exe /uninstall:KvalStateScope.Xae.e0718790-a072-4c96-ba71-67161c7fdaa6` (Visual Studio's installer), or with `install-tcxaeshell.ps1 -Uninstall` (TcXaeShell).

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

TwinCAT's PLC tree shows POUs with its own context menu, named **PlcFile**. Its numeric id is internal to Beckhoff's package, so the extension adds **Open in Kval StateScope** to that menu by name when it loads. It only does this once, and the IDE keeps the placement in its settings. The TwinCAT tree also shows that menu through its own command handling, which does not ask other extensions about their commands. A priority command target (`PriorityCommandTarget.cs`) makes sure the command is asked, so it can show itself for a `.TcPOU`.

To add the command to another TwinCAT context menu, find the menu's name. With TcXaeShell running, list the IDE's menus through its automation object (`DTE.CommandBars`, each with `Name` and `Controls`) and look for the menu with the entries you see. Then add it in `OpenInStateScopeCommand.AddToTwinCATPouMenu`.

Command logging (Ctrl+Shift+right-click shows a menu's Guid and CmdID) was not reliable for the PLC tree. For a POU it reported a group of the PLC *project* node's menu. If you need it anyway:

```powershell
# TcXaeShell 64-bit keeps its user settings in the normal registry, under its own root
reg add "HKCU\Software\Beckhoff\TcXaeShell\17.0_IsoShell\General" /v EnableVSIPLogging /t REG_DWORD /d 1 /f
# ...restart TcXaeShell, Ctrl+Shift+right-click, then turn it off again:
reg delete "HKCU\Software\Beckhoff\TcXaeShell\17.0_IsoShell\General" /v EnableVSIPLogging /f
```

Visual Studio 2022 / 2026 store their settings in a private registry file instead. There, use `VsRegEdit.exe` from the IDE folder: `VsRegEdit.exe set local HKCU General EnableVSIPLogging dword 1`.

After changing `KvalStateScopePackage.vsct`, raise the version in `[ProvideMenuResource("Menus.ctmenu", N)]`. TcXaeShell only re-merges an extension's menus when that number changes.

## Tested

- **Visual Studio 2022 (17.14) and 2026 (18.10)**, in their experimental instances with TwinCAT integration installed.
  - Tools command with a path argument, document tab, WebView2 start-up, and loading a `.TcPOU` with its `.TcDUT` found in `DUTs\`.
  - Editing, **Save to project** (file written, backup kept), and refusal after an outside change.
- **TcXaeShell 64-bit (TwinCAT 3.1.4026)**, installed with `install-tcxaeshell.ps1`: **Open in Kval StateScope** in the PLC tree's POU context menu (**PlcFile**), opening POUs of a real PLC project and matching their `.TcDUT` in the POU folder.
- **Two IDEs sharing the browser profile:** when the profile is still held by another IDE, or by one that just closed, the tab retries for about 9 s and then uses a session-only profile. The log records it.

## Prototype limits

- **Saving writes the files directly.** XAE usually notices the change and offers to reload an open POU. If it doesn't, reopen the POU. Phase 2 moves saving to Beckhoff's Automation Interface, so XAE's in-memory project stays in sync (undo, dirty state).
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
