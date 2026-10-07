# Open in Kval MachineScope on the first right-click of a POU in the PLC tree, while another window is active (a
# MachineScope tab): the command is in the menu (the IDE's selection was still that window's when the menu was asked;
# Solution Explorer's own selection is the right-clicked POU) and opens it. A real right-click: the desktop must be
# unlocked, the mouse is moved. (after launch.ps1)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\tabs.ps1"
$fails = 0
function Expect($ok, $what) { if ($ok) { "ok   $what" } else { "FAIL $what"; $script:fails++ } }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
if (-not ('MouseH' -as [type])) {
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class MouseH {
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint f, bool i, uint a);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
  public static void RightClick(int x, int y) { SetCursorPos(x, y); mouse_event(0x0008, 0, 0, 0, UIntPtr.Zero); mouse_event(0x0010, 0, 0, 0, UIntPtr.Zero); }
  // A locked screen (or a secure desktop): no input desktop to send the click to
  public static bool Unlocked() { var d = OpenInputDesktop(0, false, 0x0100); if (d == IntPtr.Zero) return false; CloseDesktop(d); return true; }
}
'@
}
if (-not [MouseH]::Unlocked()) { 'skipped: the screen is locked (a right-click needs the desktop)'; exit 0 }
$A = [System.Windows.Automation.AutomationElement]
$S = [System.Windows.Automation.TreeScope]
function ByName($root, $name, $type) {
  $c = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, $name)),
    (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, $type)))
  $root.FindFirst($S::Descendants, $c)
}

# 1. The POU's node shown in Solution Explorer (DTE expands its folders), the solution's node selected instead
$se = $dte.ToolWindows.SolutionExplorer
function FindItem($items) {
  foreach ($i in $items) {
    if ($i.Name -like "$XaeOtherPou*") { return $i }
    $was = $i.UIHierarchyItems.Expanded
    $i.UIHierarchyItems.Expanded = $true
    $f = FindItem $i.UIHierarchyItems
    if ($f) { return $f }
    $i.UIHierarchyItems.Expanded = $was
  }
  $null
}
$item = FindItem $se.UIHierarchyItems
if (-not $item) { throw "$XaeOtherPou was not found in Solution Explorer (set KSS_XAE_OTHER_POU)" }
$nodeName = $item.Name
$se.UIHierarchyItems.Item(1).Select(1)   # (vsUISelectionTypeSelect: the solution)

# 2. A MachineScope tab active (the window the IDE's selection belongs to)
$tab = (Tabs | Select-Object -First 1)
if (-not $tab) { throw 'No MachineScope tab: run launch.ps1 first' }
(ByName $script:main $tab ([System.Windows.Automation.ControlType]::TabItem)).GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
Start-Sleep 1
Expect ((Selected $tab) -eq $true) "$tab is active"

# 3. The first right-click on the POU's node: the command is in the menu, and opens it
$mark = "---- context menu test $(Get-Date -Format o) ----"
Add-Content $XaeLog $mark
function LogSince { $t = Get-Content $XaeLog -Raw; $t.Substring($t.LastIndexOf($mark)) }
$node = ByName $script:main $nodeName ([System.Windows.Automation.ControlType]::TreeItem)
if (-not $node) { throw "$nodeName is not on screen in Solution Explorer" }
try { $node.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView() } catch {}
$r = $node.Current.BoundingRectangle
[void][MouseH]::SetForegroundWindow((Get-Process -Id $expPid).MainWindowHandle)
Start-Sleep -Milliseconds 300
[MouseH]::RightClick([int]($r.X + [Math]::Min(40, $r.Width / 2)), [int]($r.Y + $r.Height / 2))
$entry = $null
for ($k = 0; $k -lt 20 -and -not $entry; $k++) {
  Start-Sleep -Milliseconds 250
  $entry = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst($S::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, 'Open in Kval MachineScope')))
}
Expect ($null -ne $entry) 'the first right-click: Open in Kval MachineScope is in the menu'
if ($entry) {
  $entry.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  for ($i = 0; $i -lt 30 -and -not ((LogSince) -match "loaded .*$XaeOtherPou"); $i++) { Start-Sleep 1 }
  Expect ((LogSince) -match "loaded .*$XaeOtherPou") "it opens $XaeOtherPou"
} else {
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
  "log: $((LogSince) -split "`n" | Select-Object -Last 3)"
}
"$fails failures"
if ($fails) { exit 1 }
