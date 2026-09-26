# One StateScope tab per PLC instance: the app's openInstance message (as Live's Open sends it) opens a tab that
# follows that instance and goes live; the same instance again brings it forward; bad requests are ignored.
# Runs without a PLC: going live fails there, the request to go live is what is checked. (after launch.ps1)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\tabs.ps1"
$fails = 0
function Expect($ok, $what) { if ($ok) { "ok   $what" } else { "FAIL $what"; $script:fails++ } }
$pou = Join-Path $XaeCopy $XaePou
$instance = 'MAIN.fbLine2.smTest'
function Post($title, $msg) {
  # (through a file: Windows PowerShell strips the quotes of JSON passed to a native program)
  $f = Join-Path $PSScriptRoot '..\.output\xae-msg.json'
  [IO.File]::WriteAllText($f, ($msg | ConvertTo-Json -Compress))
  node "$PSScriptRoot\post.cjs" $title $f
}
$mark = "---- instance test $(Get-Date -Format o) ----"
Add-Content $XaeLog $mark
function LogSince { $t = Get-Content $XaeLog -Raw; $t.Substring($t.LastIndexOf($mark)) }

"tabs at start: $((Tabs) -join ' | ')"
Post $XaePouName @{ type = 'openInstance'; path = $pou; instance = $instance }
for ($i = 0; $i -lt 30 -and -not ((LogSince) -match "following $([regex]::Escape($instance))"); $i++) { Start-Sleep 1 }
Start-Sleep 3
$t = Tabs
$tab = "StateScope: $XaePouName ($instance)"
Expect ($t -contains $tab -and ($t -contains "StateScope: $XaePouName")) "a second $XaePouName tab for the instance: $($t -join ' | ')"
Expect ((Selected $tab) -eq $true) 'the new tab is active'
Expect ((LogSince) -match "live: start $XaePouName\.\w+ .*instance $([regex]::Escape($instance))") 'the new tab went live on its instance'

$dte.ExecuteCommand('Tools.KvalStateScope.Open', $pou)
Start-Sleep 3
Expect ((Tabs).Count -eq $t.Count) "plain Open of the POU: no new tab ($((Tabs).Count))"
Add-Content $XaeLog ($mark = "---- same instance $(Get-Date -Format o) ----")
Post $XaePouName @{ type = 'openInstance'; path = $pou; instance = $instance.ToLower() }
Start-Sleep 4
Expect ((Tabs).Count -eq $t.Count -and -not ((LogSince) -match 'loaded ')) 'the same instance again (other case): no new tab, not reloaded'
Expect ((Selected $tab) -eq $true) 'its tab is active'

Post $XaePouName @{ type = 'openInstance'; path = (Join-Path $XaeCopy 'x.TcPOU'); instance = 'MAIN.x' }
Post $XaePouName @{ type = 'openInstance'; path = $pou; instance = 'x;DROP' }
Start-Sleep 3
Expect ((Tabs).Count -eq $t.Count) "another POU's path / a bad instance: ignored"
"$fails failures"
if ($fails) { exit 1 }
