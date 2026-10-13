# The real-PLC test on a schedule (opt in: scripts\register-nightly-real-plc.ps1 registers it, -Remove removes it).
# Runs `KSS_REAL_PLC=1 node tests/run.cjs plc` on this computer's TwinCAT runtime: it activates the test project's
# configuration (TwinCAT goes to Run) and stops its PLC at the end; this script then puts TwinCAT back in Config when it
# was in Config before. Each run's output: tests\.output\nightly\<date>.log, the result in last.json; a failure shows
# a Windows notification (and the exit code is 1, for the Task Scheduler's history).
param([switch]$NoNotify)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $repo 'tests\.output\nightly'
New-Item -ItemType Directory -Force $dir | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$log = Join-Path $dir "$stamp.log"
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  "node not found on PATH" | Out-File -Encoding utf8 $log
  exit 1
}

Push-Location $repo
try {
  $before = (& $node scripts\tc-system-mode.cjs 2>$null | Select-Object -Last 1)
  "TwinCAT before: $before" | Out-File -Encoding utf8 $log
  $env:KSS_REAL_PLC = '1'
  $started = Get-Date
  # (node's output kept as it writes it, UTF-8: Windows PowerShell's own redirection would write UTF-16)
  $outFile = Join-Path $dir "$stamp.out.tmp"
  $errFile = Join-Path $dir "$stamp.err.tmp"
  $p = Start-Process -FilePath $node -ArgumentList 'tests\run.cjs', 'plc' -WorkingDirectory $repo -NoNewWindow -Wait -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  $code = $p.ExitCode
  Get-Content -Encoding UTF8 $outFile, $errFile | Add-Content -Encoding UTF8 $log
  Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue
  Remove-Item Env:KSS_REAL_PLC -ErrorAction SilentlyContinue
  $after = (& $node scripts\tc-system-mode.cjs 2>$null | Select-Object -Last 1)
  if ($before -eq 'Config' -and $after -ne 'Config') {
    $switched = & $node scripts\tc-system-mode.cjs config 2>&1 | Out-String
    Add-Content -Encoding UTF8 $log "Back to Config: $switched"
    $after = (& $node scripts\tc-system-mode.cjs 2>$null | Select-Object -Last 1)
  }
  "TwinCAT after: $after" | Out-File -Append -Encoding utf8 $log
  $result = [ordered]@{
    when = $started.ToString('o')
    seconds = [int]((Get-Date) - $started).TotalSeconds
    passed = ($code -eq 0)
    exitCode = $code
    twinCatBefore = $before
    twinCatAfter = $after
    log = $log
  }
  $result | ConvertTo-Json | Out-File -Encoding utf8 (Join-Path $dir 'last.json')
  # Keep the last 30 logs
  Get-ChildItem $dir -Filter '*.log' | Sort-Object Name -Descending | Select-Object -Skip 30 | Remove-Item -ErrorAction SilentlyContinue
  if ($code -ne 0 -and -not $NoNotify) {
    try {
      Add-Type -AssemblyName System.Windows.Forms
      $n = New-Object System.Windows.Forms.NotifyIcon
      $n.Icon = [System.Drawing.SystemIcons]::Warning
      $n.Visible = $true
      $n.ShowBalloonTip(15000, 'Kval MachineScope: real-PLC test failed', "See $log", [System.Windows.Forms.ToolTipIcon]::Warning)
      Start-Sleep -Seconds 16
      $n.Dispose()
    } catch {}
  }
  exit $(if ($code -eq 0) { 0 } else { 1 })
} finally {
  Pop-Location
}
