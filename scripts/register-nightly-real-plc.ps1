# Registers the nightly real-PLC test (scripts\nightly-real-plc.ps1) in the Task Scheduler for this user, daily at
# -At (default 02:00), run only while the user is logged on (TwinCAT XAE's automation needs the desktop).
# -Remove removes it. The task: "Kval MachineScope real-PLC test".
param([string]$At = '02:00', [switch]$Remove)

$name = 'Kval MachineScope real-PLC test'
if ($Remove) {
  schtasks /Delete /TN $name /F
  exit $LASTEXITCODE
}
$script = Join-Path $PSScriptRoot 'nightly-real-plc.ps1'
$cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
schtasks /Create /TN $name /TR $cmd /SC DAILY /ST $At /IT /F
if ($LASTEXITCODE -eq 0) {
  Write-Host "Registered: daily at $At. Results: tests\.output\nightly\. Remove: scripts\register-nightly-real-plc.ps1 -Remove"
}
exit $LASTEXITCODE
