# Kval MachineScope gateway, for the desktop setup (and its Start menu shortcut):
#   -Action Stop       before an update: its startup task stopped (prints "task" when it was running) and a gateway of
#                      that folder started in a console ended, so its files (node\node.exe) can be replaced
#   -Action StartTask  after an update: the startup task started again
#   -Action Open       the gateway started in a console window of its own (unless one already listens on its port: the
#                      startup task's), then its setup page opened in the browser (through Explorer: not as administrator)
param(
  [ValidateSet('Stop', 'StartTask', 'Open')][string]$Action,
  [string]$Dir
)
$task = 'Kval MachineScope gateway'
$Dir = $Dir.TrimEnd('\')
$port = 8443
try { $p = (Get-Content -Raw -Encoding UTF8 (Join-Path $Dir 'config.json') | ConvertFrom-Json).port; if ($p) { $port = [int]$p } } catch { }
function Test-Listening { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }

switch ($Action) {
  'Stop' {
    $t = Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    if ($t -and $t.State -eq 'Running') { Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue; 'task' }
    $script = (Join-Path $Dir 'gateway.cjs').ToLower()
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($script) } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 800
  }
  'StartTask' {
    Start-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  }
  'Open' {
    if (-not (Test-Listening)) {
      $cmd = Join-Path $Dir 'gateway.cmd'
      Start-Process cmd.exe -ArgumentList '/k', "title Kval MachineScope gateway (close this window to stop it) & `"$cmd`" start" -WorkingDirectory $Dir
      for ($i = 0; $i -lt 40 -and -not (Test-Listening); $i++) { Start-Sleep -Milliseconds 500 }
    }
    if (Test-Listening) {
      Start-Process explorer.exe "https://localhost:$port/admin"
      'opened'
    } else {
      'The gateway did not start: see its console window'
      exit 1
    }
  }
}
