# The real-PLC test on a schedule (opt in: scripts\register-nightly-real-plc.ps1 registers it, -Remove removes it).
# Runs `KSS_REAL_PLC=1 node tests/run.cjs plc` on this computer's TwinCAT runtime: it activates the test project's
# configuration (TwinCAT goes to Run) and stops its PLC at the end; this script then puts TwinCAT back in Config when it
# was in Config before. Each run's output: tests\.output\nightly\<date>.log, the result in last.json; a failure shows
# a Windows notification (and the exit code is 1, for the Task Scheduler's history).
# -Full: the whole test suite too, after the real-PLC test (npm run build, then node tests/run.cjs --jobs 1): its
# result in the same log, last.json and history.json.
param([switch]$NoNotify, [switch]$Full)

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
  # (-Full: the build and the whole suite, after it)
  $fullCode = $null
  if ($Full) {
    Remove-Item Env:KSS_REAL_PLC -ErrorAction SilentlyContinue
    # (at night: the system and the display kept awake while the suite runs, one test at a time: its timing-sensitive
    # checks (a card's flash, a caret's follow) failed under the night's throttling, 2 at once, on 2026-10-13)
    if (-not ('KssAwake' -as [type])) { Add-Type -Namespace '' -Name KssAwake -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);' }
    $null = [KssAwake]::SetThreadExecutionState([uint32]'0x80000003')
    Add-Content -Encoding UTF8 $log '--- the whole suite (npm run build, node tests/run.cjs --jobs 2)'
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    $b = Start-Process -FilePath $npm -ArgumentList 'run', 'build' -WorkingDirectory $repo -NoNewWindow -Wait -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile
    Get-Content -Encoding UTF8 $outFile, $errFile | Select-Object -Last 5 | Add-Content -Encoding UTF8 $log
    if ($b.ExitCode -eq 0) {
      $f = Start-Process -FilePath $node -ArgumentList 'tests\run.cjs', '--jobs', '1' -WorkingDirectory $repo -NoNewWindow -Wait -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile
      $fullCode = $f.ExitCode
      Get-Content -Encoding UTF8 $outFile, $errFile | Add-Content -Encoding UTF8 $log
    } else { $fullCode = $b.ExitCode; Add-Content -Encoding UTF8 $log 'The build failed: the suite not run' }
    Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue
    $null = [KssAwake]::SetThreadExecutionState([uint32]'0x80000000')
  }
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
  # The tests that failed (the runs' "N/M passed; failed: a, b (logs …)" lines) and the flaky ones (passed alone)
  $logText = Get-Content -Raw -Encoding UTF8 $log
  $failedTests = @([regex]::Matches($logText, '\d+/\d+ passed; failed: ([^\r\n(]+)') | ForEach-Object { $_.Groups[1].Value -split ',\s*' } | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Sort-Object -Unique)
  $flakyTests = @([regex]::Matches($logText, '(?m)^flaky \([^)]*\): (.+)$') | ForEach-Object { $_.Groups[1].Value -split ',\s*' } | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Sort-Object -Unique)
  $result = [ordered]@{
    when = $started.ToString('o')
    seconds = [int]((Get-Date) - $started).TotalSeconds
    passed = ($code -eq 0 -and ($null -eq $fullCode -or $fullCode -eq 0))
    exitCode = $code
    full = $(if ($null -eq $fullCode) { $null } else { $fullCode -eq 0 })
    twinCatBefore = $before
    twinCatAfter = $after
    log = $log
    failed = $failedTests
    flaky = $flakyTests
  }
  $result | ConvertTo-Json | Out-File -Encoding utf8 (Join-Path $dir 'last.json')
  # The last 30 runs (history.json, oldest first): when, passed, how long, for the trend
  $historyFile = Join-Path $dir 'history.json'
  $history = @()
  if (Test-Path $historyFile) { try { $parsed = Get-Content -Raw -Encoding UTF8 $historyFile | ConvertFrom-Json; $history = @($parsed | ForEach-Object { $_ }) } catch { $history = @() } }
  # (against the run before: the failures new tonight, the ones failing again)
  $previousFailed = if ($history.Count) { @($history[-1].failed | Where-Object { $_ }) } else { @() }
  $newFailures = @($failedTests | Where-Object { $previousFailed -notcontains $_ })
  $stillFailing = @($failedTests | Where-Object { $previousFailed -contains $_ })
  $history = @($history) + @([pscustomobject]@{ when = $result.when; passed = $result.passed; seconds = $result.seconds; full = $result.full; failed = $failedTests; flaky = $flakyTests; newFailures = $newFailures })
  if ($history.Count -gt 30) { $history = $history[($history.Count - 30)..($history.Count - 1)] }
  ConvertTo-Json -InputObject @($history) | Out-File -Encoding utf8 $historyFile
  # (each test's failures and flakes over the nights kept: the worst first, to fix first)
  $worst = @{}
  foreach ($h in $history) {
    foreach ($t in @($h.failed | Where-Object { $_ })) { if (-not $worst[$t]) { $worst[$t] = @{ failed = 0; flaky = 0 } }; $worst[$t].failed++ }
    foreach ($t in @($h.flaky | Where-Object { $_ })) { if (-not $worst[$t]) { $worst[$t] = @{ failed = 0; flaky = 0 } }; $worst[$t].flaky++ }
  }
  $worstText = @($worst.GetEnumerator() | Sort-Object { -($_.Value.failed * 2 + $_.Value.flaky) } | Select-Object -First 5 | ForEach-Object { "$($_.Key) ($($_.Value.failed) failed, $($_.Value.flaky) flaky)" }) -join ', '
  if ($worstText) { Add-Content -Encoding UTF8 $log "Most often failed or flaky over $($history.Count) runs: $worstText" }
  # Keep the last 30 logs
  Get-ChildItem $dir -Filter '*.log' | Sort-Object Name -Descending | Select-Object -Skip 30 | Remove-Item -ErrorAction SilentlyContinue
  # A webhook (Teams, Slack: a JSON { text } POSTed): KSS_NIGHTLY_WEBHOOK, or scripts\nightly.config.json
  # { "webhook": "https://…", "notify": "failure" | "always" } (not in git)
  $config = $null
  $configFile = Join-Path $PSScriptRoot 'nightly.config.json'
  if (Test-Path $configFile) { try { $config = Get-Content -Raw -Encoding UTF8 $configFile | ConvertFrom-Json } catch {} }
  $webhook = if ($env:KSS_NIGHTLY_WEBHOOK) { $env:KSS_NIGHTLY_WEBHOOK } elseif ($config -and $config.webhook) { [string]$config.webhook } else { $null }
  $always = $config -and $config.notify -eq 'always'
  if ($webhook -and (-not $result.passed -or $always)) {
    # (the runs' summary lines: "N/M passed", the failures; the log as a link a chat client opens)
    $summary = (Get-Content -Encoding UTF8 $log | Where-Object { $_ -match '^\s*FAIL|\d+/\d+ passed|^flaky' } | Select-Object -First 14) -join "`n"
    $link = 'file:///' + ($log -replace '\\', '/')
    $what = if ($Full) { 'real-PLC test and the whole suite' } else { 'real-PLC test' }
    $compare = @()
    if ($newFailures.Count) { $compare += 'New since the run before: ' + ($newFailures -join ', ') }
    if ($stillFailing.Count) { $compare += 'Failing the run before too: ' + ($stillFailing -join ', ') }
    if ($flakyTests.Count) { $compare += 'Flaky (passed alone): ' + ($flakyTests -join ', ') }
    if ($worstText) { $compare += "Most often over $($history.Count) runs: $worstText" }
    if ($compare.Count) { $summary = ($compare -join "`n") + "`n" + $summary }
    $text = if ($result.passed) { "Kval MachineScope $what passed on $env:COMPUTERNAME ($($result.seconds) s)`n$summary`n[The log]($link)" } else { "Kval MachineScope $what FAILED on $env:COMPUTERNAME`n$summary`n[The log]($link) ($log)" }
    try {
      Invoke-RestMethod -Method Post -Uri $webhook -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ text = $text } | ConvertTo-Json))) -TimeoutSec 30 | Out-Null
      Add-Content -Encoding UTF8 $log 'Webhook: sent'
    } catch {
      Add-Content -Encoding UTF8 $log ('Webhook: not sent: ' + $_.Exception.Message)
    }
  }
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
  exit $(if ($result.passed) { 0 } else { 1 })
} finally {
  Pop-Location
}
