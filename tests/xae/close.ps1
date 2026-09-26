# Closes the experimental instance launch.ps1 started (only that one) and removes the project copy
. "$PSScriptRoot\config.ps1"
$expPid = [int](Get-Content $XaePidFile -ErrorAction SilentlyContinue)
$p = if ($expPid) { Get-Process -Id $expPid -ErrorAction SilentlyContinue }
if ($p -and $p.ProcessName -eq 'devenv' -and $p.MainWindowTitle -like '*Experimental Instance*') {
  try { . "$PSScriptRoot\dte.ps1" -ProcessId $expPid; $dte.Solution.Close($false); $dte.Quit() } catch {}
  if (-not $p.WaitForExit(25000)) { Stop-Process -Id $expPid -Force -Confirm:$false; 'experimental instance stopped' } else { 'experimental instance closed' }
}
if ($env:KSS_XAE_KEEP_COPY) { 'copy kept (KSS_XAE_KEEP_COPY)'; return }
if (Test-Path $XaeCopy) {
  # Long paths: \\?\ prefix
  [System.IO.Directory]::Delete('\\?\' + (Resolve-Path $XaeCopy).Path, $true)
  "copy removed: $(-not (Test-Path $XaeCopy))"
}
