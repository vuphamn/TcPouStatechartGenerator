# XAE extension tests (run by hand)

These tests drive Visual Studio 2022's **experimental instance** (`/rootsuffix Exp`) on a **copy** of a TwinCAT
project, with the extension built from this repository. They never touch your own Visual Studio or TcXaeShell
windows, and never change the project itself.

```powershell
xae-extension\build.ps1                                  # the VSIX
$env:KSS_XAE_SOURCE = 'C:\path\to\TwinCAT project'       # copied to %TEMP%\kss (read only)
tests\xae\launch.ps1                                     # copy, install into Exp, open the solution and the POU
tests\xae\multi-tab.test.ps1                             # one tab per POU
tests\xae\instance-tab.test.ps1                          # one tab per PLC instance
tests\xae\close.ps1                                      # close that Exp instance, remove the copy
```

The settings are in `config.ps1`: the solution, the POU to open (default `SM_TableManager.TcPOU`), a second POU for the
tab test (default `SM_KAxis`), the copy's folder, and Visual Studio's folder. The extension's log is
`%LocalAppData%\KvalStateScope\log.txt`. The tests read it, and it is the first place to look when one fails.

Without a TwinCAT system running on this computer, going live fails. `instance-tab` checks that the tab asks to go
live on its instance, not that it connects. Checks against a real PLC (live view, guard values, Symbols) are still
manual.

The helpers: `dte.ps1` finds the instance's automation object (DTE) by process. `tabs.ps1` lists StateScope tabs
through UI Automation. `winhelpers.ps1` dismisses Visual Studio's start-up dialogs. `post.cjs` sends a message as
the app would, through WebView2's debugging port (9444).
