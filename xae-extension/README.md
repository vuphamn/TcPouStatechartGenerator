# Kval MachineScope for TwinCAT XAE (prototype)

A Visual Studio extension (VSIX) that opens a Kval `SM_*.TcPOU` state machine in Kval MachineScope, docked as a document tab inside TwinCAT XAE. The tab hosts the same web app as the browser and desktop versions, running in WebView2 (the Edge browser control).

Targets: TcXaeShell 64-bit (TwinCAT 3.1.4026+), and Visual Studio 2022 and 2026 with TwinCAT integration. It uses the same installation target as Beckhoff's own XAE extensions.

**TwinCAT 4024** (not yet tested): its 64-bit TcXaeShell is a Visual Studio 2022 shell, like 4026's (the same folder, `C:\Program Files\Beckhoff\TcXaeShell`): it takes the main build. Its 32-bit TcXaeShell is a Visual Studio 2017 shell, which cannot load that build. `KvalMachineScope.Xae.Vs2017` builds the same sources against the Visual Studio 2017 SDK, as `KvalMachineScope.Xae.Vs2017.vsix` (`build.ps1` builds both). Those IDEs have no WebView2 of their own, so it carries WebView2 (its x86 loader too; the WebView2 Runtime must be on the PC, as on any current Windows 10 / 11). `install-tcxaeshell.ps1` installs it into `C:\Program Files (x86)\Beckhoff\TcXaeShell` when that is the only TcXaeShell (or pass `-ShellRoot` and `-Vsix`). Visual Studio 2017 / 2019 take it with their VSIXInstaller. The desktop installer installs it there too (its option **TcXaeShell 32-bit, TwinCAT 4024**, on by default when that shell is found), beside the 64-bit one when both are on the PC.

## Build

Requirements: Visual Studio 2022 or 2026 (for MSBuild), Node.js 20+. The VS extension-development workload is not needed: the VSSDK build tools come from NuGet.

```powershell
cd xae-extension
.\build.ps1          # npm run build, copy dist/ into the extension, build the VSIX
```

Output: `xae-extension\KvalMachineScope.Xae\bin\Release\KvalMachineScope.Xae.vsix`

## Install

The simplest way is the Kval MachineScope **Desktop installer** (`build.cmd` at the repository root builds it). Its *Additional components* page offers Visual Studio 2022 / 2026 and TcXaeShell, and installs into those found on the computer. By hand:

- **Visual Studio 2022 / 2026:** double-click the `.vsix`, then restart Visual Studio.
- **TcXaeShell:** close it, then run:

  ```powershell
  cd xae-extension
  .\install-tcxaeshell.ps1              # asks for administrator rights (UAC)
  .\install-tcxaeshell.ps1 -Uninstall   # to remove it
  ```

  The script copies the extension into `C:\Program Files\Beckhoff\TcXaeShell\Common7\IDE\Extensions\Kval Inc\Kval MachineScope`, which is how Beckhoff installs its own XAE extensions. It then updates `Extensions\extensions.configurationchanged`, so TcXaeShell picks up the change on its next start. TcXaeShell is an isolated shell and has no `/updateconfiguration` switch.

  Don't use TcXaeShell's own `VSIXInstaller.exe`. It can fail with *"The type initializer for 'PerTypeValues`1' threw an exception"*. Its `VSIXInstaller.exe.config` loads `System.Runtime.CompilerServices.Unsafe` and three other assemblies from `Common7\IDE\net472\`, a folder TcXaeShell doesn't ship. That is a defect in the TcXaeShell installation, not in the extension.

In Visual Studio, if the commands don't appear after a restart, make it merge extension registrations once with `devenv.exe /updateconfiguration`. In TcXaeShell, run `install-tcxaeshell.ps1` again: it updates the change marker.

Uninstall from **Extensions > Manage Extensions** (Visual Studio), with `VSIXInstaller.exe /uninstall:KvalMachineScope.Xae.e0718790-a072-4c96-ba71-67161c7fdaa6` (Visual Studio's installer), or with `install-tcxaeshell.ps1 -Uninstall` (TcXaeShell).

It needs the Microsoft Edge WebView2 Runtime, which Windows 10/11 normally already have. The WebView2 .NET assemblies are not shipped: each IDE provides its own copy (the extension compiles against the oldest, TcXaeShell's 1.0.2151.40).

## Use

- **Right-click** a `.TcPOU` and choose **Open in Kval MachineScope**. The command only appears when the selection is a `.TcPOU`. It is there on the first right-click, even while another window (the editor, a MachineScope tab) is active. When the selection has no `.TcPOU` behind it, a message says so. It is on:
  - the project-item context menu;
  - the context menu of an open document's tab.
- **Tools > Kval MachineScope...** opens the selected or active `.TcPOU`. Without one, it asks for a file.
- **Command Window:** `Tools.KvalMachineScope.Open C:\Path\SM_X.TcPOU`
- **One tab per POU:** each POU opens in its own **MachineScope: <POU>** tab, so several state machines can be watched at once. Opening a POU that already has a tab brings that tab forward, without reloading it. The tabs share one WebView2 browser process. The tabs open when XAE closed come back with the POU each showed (`%LocalAppData%\KvalMachineScope\tabs.txt`).
- **A POU that EXTENDS another without a `doState()` of its own** (`SM_Head EXTENDS SM_3AxisHead`): its bases are found in the PLC project and its state machine read from them, with its overrides. Their methods are listed in the Method Editor (marked inherited); an edit of one is saved into the base's `.TcPOU` (asked once per base), and a base changed in TwinCAT or on disk is read again (merged by method with unsaved edits of it here). The **extends** chip opens the inheritance view: the chain, each level's methods, which are overridden and by whom. See the main README.
- **What the PLC runs:** while live, the Live tab compares the PLC's compile ID with the project's `_CompileInfo` (**latest build** / **older build** / **not the latest build**; an older build is known from the builds of this copy seen before: the extension lists `_CompileInfo` when asked, which the app does when the POU opens, on focus and every minute, and keeps each build in `MachineScope.builds.json` beside the `.plcproj`, shared with the other editions and, committed, with colleagues; XAE keeps only the latest's compile info). The PLC's trial license end is shown too (read from the PLC with the extension's boot-file reader). When the PLC's active project is not the POU's, **Activate <project>…** activates the POU's project on it through the Automation Interface (`ActivateConfiguration`, `StartRestartTwinCAT`; asks first, with the trial license when it ran out or runs out soon). **Compare…** opens the same POU live on another PLC in a new MachineScope tab; each tab then shows the other's PLC and state (on the chart too, in its colour), and **Differences…** compares the two sessions (**Save comparison…** keeps both in one file, through XAE's save dialog). The tabs share one WebView2 profile, so they reach each other directly (not yet tried inside XAE).
- **Save, a converted project:** the project files' TwinCAT version is compared with git's `HEAD`. When XAE has converted them, the header says so and the first Save asks. **Revert…** restores the `.tsproj` / `.plcproj` from git (asks first, with what else changed in them); XAE then asks to reload the project.
- **Machine Overview:** while live, every state machine under `MAIN.mainStateMachine` with its current state (names from the PLC's enum types), time in state and error states. Watch opens one in its own tab. Like Symbols, it has not yet run against a real PLC here.
- **PLC Symbols:** while live, the Live tab's **Symbols** browses the PLC's symbols from `MAIN.mainStateMachine` with their values; **Watch** opens another state machine of the project in its own tab, live. (Built on the same TcAdsDll calls as the live view; like guard values, not yet run against a real PLC here, because this PC's TwinCAT system is not started.)
- **One tab per PLC instance:** when the POU is declared more than once, the Live tab's **Open** follows another instance in a new tab, **MachineScope: <POU> (<instance>)**, which goes live on it. A tab already following that instance comes forward.

The `.TcDUT` enum is found as in the other editions: every `.TcDUT` in the `.TcPOU`'s folder and subfolders is ranked by how many `doState()` states its enum declares.

**Save to project** (header, next to the file name) writes the edited `.TcPOU` / `.TcDUT` back into the TwinCAT project.
- **Through XAE:** when the file belongs to a TwinCAT project open in the IDE, the change goes through Beckhoff's Automation Interface. XAE updates its project and TwinCAT writes the file, so there is no separate save in XAE.
- **Only the changed parts are written:** the declarations and ST implementations that changed, on the POU, its methods, actions and property accessors, or the DUT. That keeps the object ids, so git diffs stay clean, and an open TwinCAT editor stays open. If the structure changed (a method added or removed, non-ST code edited), the whole object is replaced. TwinCAT then assigns new ids and closes its editor, which MachineScope opens again.
- **Files outside an open TwinCAT project** are written to disk directly.
- **Backups:** a copy of each original is kept in `%LocalAppData%\KvalMachineScope\Backups`. Writes through the Automation Interface are not in XAE's undo history.
- **Refused** when XAE has unsaved changes for that file. Save or close it in XAE first.

**Staying in sync with XAE.** MachineScope watches the loaded files. When one changes in XAE or on disk (edited and saved in TwinCAT, a git pull, ...):
- **No unsaved edits of it in MachineScope:** the diagram and editors update, and a message says so.
- **Unsaved edits in MachineScope:** the header shows **Changed in XAE** with two choices:
  - **Reload** takes XAE's version and discards your edits.
  - **Keep mine** keeps your edits, and **Save to project** then overwrites the change made in XAE.
- **Not chosen yet:** **Save to project** is refused.

**Show in TwinCAT editor** opens TwinCAT's editor at the code behind a diagram element. It is offered for a POU that belongs to a TwinCAT project open in XAE.
- **State** (right-click it): selects its `CASE` label in `doState()`.
- **Transition** (right-click it, or the Transition Guard window's footer): selects the assignment that makes it, `machineState := <target>`. The assignment is looked for in the source state's branch of `doState()`, or in `preProcess()` for `[preProcess]` guards. When a branch has several, the one near the guard's text wins.
- **How it works:** the app computes the method and line from the `.TcPOU`. The extension finds the method's node in the PLC tree and opens it like a double-click. It then places the caret through the editor window's `IVsTextView`. TwinCAT's editor numbers the declaration's lines and then the implementation's, so the line is located by its text.

**Live view** (the **Live** tab) follows the POU's state variable (the `CASE` variable of `doState()`, e.g. `machineState`) in the running PLC.
- **Go live:** the extension connects over ADS with TwinCAT's own `TcAdsDll.dll`, through the local AMS router.
  - **Target:** the target system selected in XAE for the project. Enter an AMS NetId to use another, or click **Browse** and pick one:
    - the project's target, the routes of this computer's TwinCAT router (`StaticRoutes.xml`), and the TwinCAT devices found on the network (the UDP 48899 search of XAE's *Add Route* dialog; enter an address for a PLC behind a router). A route whose PLC did not answer is still listed, greyed, as **route only: not answering**;
    - each is marked **route** or **no route**: XAE goes live through its own router, so a PLC needs a route from this computer first (the target selector's *Choose Target > Search (Ethernet) > Add Route*);
    - the PLCs ticked **Remember** (they are kept in the app, for every POU). With an empty target the project's target is used, as before;
    - **Add route** on a device without a route: with the PLC's user and password, the route is added both ways through XAE's Automation Interface (the route settings item `TIRR`, `<AddRoute>`), as XAE's own Add Route dialog does. The password is passed to XAE only.
  - **Recording and replay:** **Save recording** writes the session (a save dialog), **Replay...** plays one back on the diagram; see the main README.
  - **The PLC switcher** shows which remembered PLCs answer (the extension opens a TCP connection to each one's ADS router port, nothing is sent).
- **Updates:** the app asks the extension for its version (`hostInfo`) and looks for a newer `xae-v*` release on GitHub (see *Updates* in the main README).
  - **Port:** the PLC's ADS port from the project's `.xti` (usually 851). Enter a port to use another.
- **Instance:** the extension finds where the function block is instantiated from the declarations in the PLC project, e.g. `MAIN.mainStateMachine.smTableManager`. It follows the first instance the PLC actually has. With several, the others are offered in the Instance field. You can also type a path.
- **Change notification:** the PLC sends every new value with its PLC time stamp, checked every task cycle (at most every 1 ms). A state that lasts one cycle is not missed, which polling would not guarantee.
- **What you see:**
  - the active state glows on the diagram, and the previous state and the transition taken are marked;
  - *Follow* keeps the active state in view;
  - the tab shows the current state with its time in state, and every transition with its time and dwell;
  - transitions the diagram does not have are flagged.
- **Transition History:** the history button opens the session's transitions there, with its analytics.
- **Numbers to names:** values become state names through the `.TcDUT` enum, explicit `:=` values included.
- **Stopping:** *Stop*, another POU, or closing the tab ends the session. It deletes the notification and releases the handle in the PLC.
- **Guard values:** the app asks for the variables in the conditions of the active state's transitions (`liveWatch`). The extension looks each one up (as a member of the instance, or as a global path), then follows it with a change notification checked every 10 ms (`liveWatchResult`, `liveVars`). The diagram shows TRUE / FALSE / ? and the values next to each condition; see *Live guard values* in the main README. Variables no longer asked for are released.

**Selection follows TwinCAT's caret.** When the caret in TwinCAT's editor is in the loaded POU's `doState()`, the state whose `CASE` branch contains it is selected and brought into view. Together with **Show in TwinCAT editor**, selection works both ways. The extension checks the active editor window's caption and caret line every 350 ms. Turn it off with **Follow selection** in the status bar.

**Open a referenced state machine.** When a state or guard uses another state machine's instance (e.g. `smOutfeedStopAxis : SM_KAxis`), the context menu offers *Open SM_KAxis (smOutfeedStopAxis)*. The extension looks for `SM_KAxis.TcPOU` under the POU's PLC project folder and opens it in the tab. **Back** in the status bar returns to the previous POU.

**Go to Definition on a type.** In the POU Editor and the Method Editor, right-click a variable of another POU's type (`smAxis : SM_KAxis`) or the type itself. **Open SM_KAxis in MachineScope** opens `SM_KAxis.TcPOU` of the PLC project in the tab (with Back); **Open SM_KAxis in the TwinCAT editor** opens it in TwinCAT's editor, as a double-click in the PLC tree would (a DUT or an interface of that name too). Go to Definition (F12) on the type itself opens it in MachineScope. A type that is not in the project (a library's) is reported. On a member of another POU's instance (`smAxis.bDone`), both open that POU at the member: TwinCAT's editor at the member's declaration line, or at its method.

**The PLC project's types.** For completion (members after a dot, GVL variables), the Problems tab's checks and Go to Definition, the extension sends the app the PLC project's `.TcPOU`, `.TcGVL`, `.TcDUT` and `.TcIO` files without their implementations (their declarations are read; at most 30 MB).

**Compare with git.** The **Changes** tab compares the loaded POU with the version XAE has saved, or with the committed one. For *committed (git)*, the extension runs `git show HEAD:<file>` in the file's folder; git must be on the `PATH`. It only reads files MachineScope has loaded.

**Document all state machines** (Export menu). The extension collects every POU with a `doState()` method, and every `.TcDUT`, under the PLC project folder. The app draws and documents each state machine, and a save dialog asks where to write the HTML file, which then opens.

## TwinCAT PLC tree context menu

TwinCAT's PLC tree shows POUs with its own context menu, named **PlcFile**. Its numeric id is internal to Beckhoff's package, so the extension adds **Open in Kval MachineScope** to that menu by name when it loads. It only does this once, and the IDE keeps the placement in its settings. The TwinCAT tree also shows that menu through its own command handling, which does not ask other extensions about their commands. A priority command target (`PriorityCommandTarget.cs`) makes sure the command is asked, so it can show itself for a `.TcPOU`.

To add the command to another TwinCAT context menu, find the menu's name. With TcXaeShell running, list the IDE's menus through its automation object (`DTE.CommandBars`, each with `Name` and `Controls`) and look for the menu with the entries you see. Then add it in `OpenInMachineScopeCommand.AddToTwinCATPouMenu`.

Command logging (Ctrl+Shift+right-click shows a menu's Guid and CmdID) was not reliable for the PLC tree. For a POU it reported a group of the PLC *project* node's menu. If you need it anyway:

```powershell
# TcXaeShell 64-bit keeps its user settings in the normal registry, under its own root
reg add "HKCU\Software\Beckhoff\TcXaeShell\17.0_IsoShell\General" /v EnableVSIPLogging /t REG_DWORD /d 1 /f
# ...restart TcXaeShell, Ctrl+Shift+right-click, then turn it off again:
reg delete "HKCU\Software\Beckhoff\TcXaeShell\17.0_IsoShell\General" /v EnableVSIPLogging /f
```

Visual Studio 2022 / 2026 store their settings in a private registry file instead. There, use `VsRegEdit.exe` from the IDE folder: `VsRegEdit.exe set local HKCU General EnableVSIPLogging dword 1`.

After changing `KvalMachineScopePackage.vsct`, raise the version in `[ProvideMenuResource("Menus.ctmenu", N)]`. TcXaeShell only re-merges an extension's menus when that number changes.

## Tested

- **Visual Studio 2022 (17.14) and 2026 (18.10)**, in their experimental instances with TwinCAT integration installed.
  - Tools command with a path argument, document tab, WebView2 start-up, and loading a `.TcPOU` with its `.TcDUT` found in `DUTs\`.
  - Editing, **Save to project** (file written, backup kept), and refusal after an outside change.
  - **Phase 2**, on a copy of a real TwinCAT project in VS 2022:
    - saving through the Automation Interface (parts only, object ids kept, XAE and file updated, an open editor stays open);
    - updating from changes made in XAE (diagram and Method Editor);
    - **Changed in XAE** with Reload and Keep mine, and refusal before choosing;
    - refusal while XAE has unsaved changes.
  - **Show in TwinCAT editor**, on the same copy: states and transitions from the context menu and the Transition Guard window. The target methods were closed or already open; the lines were near the top, near the end (line 496 of 508) and in `preProcess()`.
  - **Live view**, split in two because the TwinCAT system on the test PC is not started: every ADS request there, even one to the system service, is answered "port disabled" (0x12).
    - **Extension side:** a harness compiled from `LiveMonitor.cs` / `LiveTargets.cs` checked instance discovery on the real project (224 instance paths, nested and in GVLs) and the ADS port from the `.xti`. It also checked the error path against the local router and the decoding of notifications laid out as TcAdsDll delivers them.
    - **App side:** the app ran in a browser with a stand-in for the XAE bridge, fed by a scripted session that included a 5 ms state and transitions the diagram does not have.
    - **Inside VS 2022:** the Live tab, `liveStart`, and the error reported back from the router.
    - **Not yet tested:** a real PLC (connect, notifications, stop).
  - **0.6.0, on the same copy in VS 2022** (made a git repository whose commit lacked one transition):
    - selection following the caret after Show in TwinCAT editor;
    - Changes against *committed (git)*;
    - opening `SM_KAxis` from a guard's reference, and Back;
    - Document all state machines through the save dialog.
  - **Browse (PLC search):** `PlcSearch.cs`, compiled into a small test program, found the two devices of a simulated TwinCAT search (`tests/fakes/fake-discovery.cjs`) with their names, NetIds, TwinCAT and OS versions. The routes file and the whole Browse inside XAE have not been run here (this PC has no TwinCAT routes).
  - **Add route:** the app side ran with a stand-in bridge (`tests/web/plc-browse-xae.test.cjs`). The extension's `TwinCATProject.AddRoute` (the Automation Interface) compiles but has not been run against a real PLC.
  - **Guard values (0.7.0):** the app side ran in a browser, with a stand-in for the XAE bridge answering `liveWatch`. The same watching code in the desktop app, Link and the gateway ran against a simulated PLC. The extension's own ADS part (`LiveMonitor.SetVars`) compiles but was not run: this PC's TwinCAT system is not started (see Live view above).
  - **One tab per PLC instance (0.8.0), same copy:** the app's `openInstance` message (sent through WebView2's debugging port, as there is no running TwinCAT system to list instances) opened **MachineScope: SM_TableManager (MAIN.fbLine2.smTableManager)**, which asked to go live on that instance. Sending it again, with other letter case, brought that tab forward. Another POU's path or a malformed instance was ignored. The desktop app and the web edition (through Link) were tested against a simulated PLC with three instances.
  - **One tab per POU (0.8.0), on the same copy in VS 2022:** SM_TableManager then SM_KAxis gave two tabs; opening SM_TableManager again brought its tab forward, with no third tab and no reload.
- **TcXaeShell 64-bit (TwinCAT 3.1.4026)**, installed with `install-tcxaeshell.ps1`: **Open in Kval MachineScope** in the PLC tree's POU context menu (**PlcFile**), opening POUs of a real PLC project and matching their `.TcDUT` in the POU folder.
- **Two IDEs sharing the browser profile:** when the profile is still held by another IDE, or by one that just closed, the tab retries for about 9 s and then uses a session-only profile. The log records it.

## Prototype limits

- **Unsaved edits in TwinCAT's editor** are not visible to MachineScope until they are saved in XAE; saving from MachineScope is refused while they exist.
- **Live view** follows integer / enum state variables of 1, 2, 4 or 8 bytes. Instances inside arrays (`ARRAY OF SM_X`) are not found automatically: type the path, e.g. `MAIN.aTables[1]`.
- **DevTools** are enabled in the tab for diagnostics (F12). Start-up, load and save steps are logged to `%LocalAppData%\KvalMachineScope\log.txt`.

## Layout

| File | Role |
|---|---|
| `KvalMachineScopePackage.cs` | Package: loads when a solution opens; shows the tool window |
| `KvalMachineScopePackage.vsct` | Commands and menu placements |
| `OpenInMachineScopeCommand.cs` | Command handlers |
| `SelectionHelper.cs` | Finds the `.TcPOU` behind the selection / active document |
| `MachineScopeToolWindow.cs`, `MachineScopeControl.cs` | Document tab with WebView2; message bridge to the app (`src/utils/xaeHost.ts`) |
| `HostFiles.cs` | Dialogs, `.TcDUT` search, saving with backup and safety checks |
| `TwinCATProject.cs` | Automation Interface: finds a file's PLC tree item, reads / writes it (changed parts only) |
| `LiveMonitor.cs` | Live view: ADS through `TcAdsDll.dll` (P/Invoke), symbol lookup, change notification |
| `LiveTargets.cs` | Live view: instance paths of a function block from the project's declarations; the PLC's ADS port |
| `PlcSearch.cs` | The Live tab's Browse: the router's routes (`StaticRoutes.xml`) and the TwinCAT devices on the network (UDP 48899) |
| `CodeNavigation.cs` | Show in TwinCAT editor: opens a method's editor from the PLC tree and places the caret; also a POU's (Go to Definition on a type) |
| `PriorityCommandTarget.cs` | Answers for the context-menu command in menus owned by other windows (TwinCAT's PLC tree) |
| `VSPackage.resx` | Carries the compiled command table (IDE loads menus from `VSPackage.resources`) |
