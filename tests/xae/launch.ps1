# Test bed: a copy of the TwinCAT project in Visual Studio's experimental instance (/rootsuffix Exp) with the
# built extension, StateScope open on the test POU. WebView2's debugging port is 9444 (post.cjs uses it).
# Build the extension first: xae-extension\build.ps1
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\winhelpers.ps1"
if (-not (Test-Path $XaeVsix)) { throw "Build the extension first (xae-extension\build.ps1): $XaeVsix is missing" }

# A previous experimental instance of these tests (only that one)
$old = Get-Process -Id ([int](Get-Content $XaePidFile -ErrorAction SilentlyContinue)) -ErrorAction SilentlyContinue
if ($old -and $old.ProcessName -eq 'devenv' -and $old.MainWindowTitle -like '*Experimental Instance*') { Stop-Process -Id $old.Id -Force -Confirm:$false; "closed experimental instance $($old.Id)"; Start-Sleep 3 }

# 1. The copy (made once; the test POU's folder is reset from the original each time)
if (-not (Test-Path $XaeCopy)) {
  "copying $XaeSource to $XaeCopy ..."
  $null = robocopy $XaeSource $XaeCopy /E /XD .git _Boot .vs /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
}
$rel = Split-Path $XaePou
Get-ChildItem (Join-Path $XaeSource $rel) -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $XaeCopy (Join-Path $rel $_.Name)) -Force }
'test POU folder reset from the original'

# 2. The extension in the experimental instance
$id = 'KvalStateScope.Xae.e0718790-a072-4c96-ba71-67161c7fdaa6'
Start-Process "$XaeIde\VSIXInstaller.exe" -ArgumentList @('/quiet', '/rootSuffix:Exp', "/uninstall:$id") -Wait
Start-Process "$XaeIde\VSIXInstaller.exe" -ArgumentList @('/quiet', '/rootSuffix:Exp', "`"$XaeVsix`"") -Wait
Start-Process "$XaeIde\devenv.exe" -ArgumentList @('/rootsuffix', 'Exp', '/updateconfiguration') -Wait
'installed'

# 3. The copied solution
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9444'
$p = Start-Process "$XaeIde\devenv.exe" -ArgumentList @('/rootsuffix', 'Exp', "`"$(Join-Path $XaeCopy $XaeSolution)`"") -PassThru
Set-Content $XaePidFile $p.Id
$loaded = $false
for ($k = 0; $k -lt 90 -and -not $loaded; $k++) {
  Start-Sleep 2
  foreach ($d in [WinH]::Dialogs([uint32]$p.Id)) {
    $txt = [WinH]::Describe($d) -join ' '
    if ($txt -match 'not loaded correctly') { [void][WinH]::ClickButton($d, 'OK'); 'dismissed: projects not loaded correctly' }
    elseif ($txt -match 'Recovered') { [void][WinH]::ClickButton($d, 'Do Not Recover'); 'dismissed: file recovery' }
  }
  try { . "$PSScriptRoot\dte.ps1" -ProcessId $p.Id; if ($dte.Solution.Projects.Count -gt 0) { $loaded = $true } } catch {}
}
"solution loaded: $loaded ($($k * 2) s)"

# 4. StateScope on the test POU
Add-Content $XaeLog '---- xae test launch ----'
for ($k = 0; $k -lt 10; $k++) { try { $dte.ExecuteCommand('Tools.KvalStateScope.Open', (Join-Path $XaeCopy $XaePou)); 'StateScope command sent'; break } catch { Start-Sleep 2 } }
for ($k = 0; $k -lt 30; $k++) { Start-Sleep 2; if ((Get-Content $XaeLog -Tail 3) -match 'loaded ') { break } }
Get-Content $XaeLog -Tail 3
