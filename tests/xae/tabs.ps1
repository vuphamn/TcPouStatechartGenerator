# The experimental instance's DTE and its StateScope tabs, through UI Automation (DTE.Windows does not enumerate
# from PowerShell). Dot-sourced by the tests: $dte, Tabs, Selected <tab name>
$expPid = [int](Get-Content $XaePidFile -ErrorAction SilentlyContinue)
if (-not $expPid -or -not (Get-Process -Id $expPid -ErrorAction SilentlyContinue)) { throw 'No experimental instance: run launch.ps1 first' }
. "$PSScriptRoot\dte.ps1" -ProcessId $expPid
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$script:main = [System.Windows.Automation.AutomationElement]::FromHandle((Get-Process -Id $expPid).MainWindowHandle)
function Tabs {
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
  @($script:main.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond) | ForEach-Object { $_.Current.Name } | Where-Object { $_ -like 'StateScope:*' } | Sort-Object -Unique)
}
function Selected($name) {
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
  $el = $script:main.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
  try { $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected } catch { $null }
}
