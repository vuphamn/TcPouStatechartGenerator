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
  # Long paths: \\?\ prefix; read-only files (a git working copy's objects) made writable first
  $long = '\\?\' + (Resolve-Path $XaeCopy).Path
  foreach ($f in [System.IO.Directory]::EnumerateFiles($long, '*', [System.IO.SearchOption]::AllDirectories)) {
    $a = [System.IO.File]::GetAttributes($f)
    if ($a -band [System.IO.FileAttributes]::ReadOnly) { [System.IO.File]::SetAttributes($f, $a -band -bnot [System.IO.FileAttributes]::ReadOnly) }
  }
  [System.IO.Directory]::Delete($long, $true)
  "copy removed: $(-not (Test-Path $XaeCopy))"
}
