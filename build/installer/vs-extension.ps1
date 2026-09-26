<#
.SYNOPSIS
  Kval StateScope desktop installer: installs or removes the TwinCAT XAE extension (VSIX) in Visual Studio 2022 / 2026.

.DESCRIPTION
  Finds Visual Studio 2022 and 2026 (17.x, 18.x) with vswhere, and runs the newest one's VSIXInstaller for all of
  them. Exit codes: 0 done, 1 failed, 2 Visual Studio is running (close it and retry), 3 no Visual Studio found.
  -Action Detect prints the instances' names (one line, comma separated).
#>
param(
  [ValidateSet('Detect', 'Install', 'Uninstall')][string]$Action = 'Detect',
  [string]$Vsix,
  # For tests only: the experimental instance (Exp) instead of the normal one
  [string]$RootSuffix
)
$ErrorActionPreference = 'Stop'
$extensionId = 'KvalStateScope.Xae.e0718790-a072-4c96-ba71-67161c7fdaa6'
$log = Join-Path $env:TEMP 'KvalStateScope-vsix.log'

function Get-Instances {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (-not (Test-Path $vswhere)) { return @() }
  $json = & $vswhere -all -prerelease -products * -version '[17.0,19.0)' -format json -utf8
  if (-not $json) { return @() }
  # Visual Studio itself (Build Tools have no devenv.exe)
  @(($json | Out-String | ConvertFrom-Json) | Where-Object { Test-Path (Join-Path $_.installationPath 'Common7\IDE\devenv.exe') } |
    Sort-Object { [version]($_.installationVersion) } -Descending)
}

$instances = Get-Instances
if ($instances.Count -eq 0) {
  if ($Action -eq 'Detect') { Write-Output '' }
  exit 3
}
if ($Action -eq 'Detect') {
  Write-Output (($instances | ForEach-Object { $_.displayName }) -join ', ')
  exit 0
}

# VSIXInstaller cannot change an instance that is running
$running = Get-Process devenv -ErrorAction SilentlyContinue | Where-Object {
  $p = $_.Path
  $p -and ($instances | Where-Object { $p.StartsWith($_.installationPath, [StringComparison]::OrdinalIgnoreCase) })
}
if ($running) { Write-Output 'Visual Studio is running.'; exit 2 }

$installer = Join-Path $instances[0].installationPath 'Common7\IDE\VSIXInstaller.exe'
$ids = ($instances | ForEach-Object { $_.instanceId }) -join ','
$arguments = @('/quiet', "/instanceIds:$ids", "/logFile:$log")
if ($RootSuffix) { $arguments += "/rootSuffix:$RootSuffix" }
if ($Action -eq 'Install') {
  if (-not $Vsix -or -not (Test-Path $Vsix)) { Write-Output "VSIX not found: $Vsix"; exit 1 }
  # Remove an older version first, so an update never stops at "already installed"
  Start-Process $installer -ArgumentList ($arguments + "/uninstall:$extensionId") -Wait | Out-Null
  $p = Start-Process $installer -ArgumentList ($arguments + "`"$Vsix`"") -Wait -PassThru
} else {
  $p = Start-Process $installer -ArgumentList ($arguments + "/uninstall:$extensionId") -Wait -PassThru
}
# 0: done; 1001: already installed; 2003: not installed (nothing to remove)
if ($p.ExitCode -in 0, 1001 -or ($Action -eq 'Uninstall' -and $p.ExitCode -eq 2003)) {
  Write-Output "$Action done for $(($instances | ForEach-Object { $_.displayName }) -join ', ')"
  exit 0
}
Write-Output "VSIXInstaller exit code $($p.ExitCode) (see $log)"
exit 1
