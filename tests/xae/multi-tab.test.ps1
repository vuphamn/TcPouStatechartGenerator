# One StateScope tab per POU: another POU opens a second tab; the same POU again brings its tab forward, no reload
# (after launch.ps1)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\tabs.ps1"
$fails = 0
function Expect($ok, $what) { if ($ok) { "ok   $what" } else { "FAIL $what"; $script:fails++ } }
$pou = Join-Path $XaeCopy $XaePou
$other = (Get-ChildItem $XaeCopy -Recurse -Filter "$XaeOtherPou.TcPOU" | Select-Object -First 1).FullName
if (-not $other) { throw "$XaeOtherPou.TcPOU is not in the project (set KSS_XAE_OTHER_POU)" }
$mark = "---- multi tab test $(Get-Date -Format o) ----"
Add-Content $XaeLog $mark
function LogSince { $t = Get-Content $XaeLog -Raw; $t.Substring($t.LastIndexOf($mark)) }

"tabs at start: $((Tabs) -join ' | ')"
$dte.ExecuteCommand('Tools.KvalStateScope.Open', $other)
for ($i = 0; $i -lt 30 -and -not ((LogSince) -match "loaded .*$XaeOtherPou"); $i++) { Start-Sleep 1 }
Start-Sleep 2
$t = Tabs
Expect ($t.Count -eq 2 -and ($t -match $XaeOtherPou) -and ($t -match $XaePouName)) "another POU opens a second tab: $($t -join ' | ')"
Expect ((Selected "StateScope: $XaeOtherPou") -eq $true) 'the new tab is active'

Add-Content $XaeLog ($mark = "---- same POU again $(Get-Date -Format o) ----")
$dte.ExecuteCommand('Tools.KvalStateScope.Open', $pou)
Start-Sleep 4
$t = Tabs
Expect ($t.Count -eq 2 -and -not ((LogSince) -match 'loaded ')) "the same POU again: no third tab, not reloaded ($($t -join ' | '))"
Expect ((Selected "StateScope: $XaePouName") -eq $true) "the $XaePouName tab is active"
"$fails failures"
if ($fails) { exit 1 }
