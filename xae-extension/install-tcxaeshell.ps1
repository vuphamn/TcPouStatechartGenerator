<#
.SYNOPSIS
  Installs (or removes) Kval StateScope in TcXaeShell 64-bit without TcXaeShell's VSIXInstaller.

.DESCRIPTION
  TcXaeShell's VSIXInstaller.exe can crash with "The type initializer for 'PerTypeValues`1' threw an exception":
  its VSIXInstaller.exe.config loads System.Runtime.CompilerServices.Unsafe and three other assemblies from
  Common7\IDE\net472\, a folder TcXaeShell does not ship.

  This script installs the extension the way Beckhoff installs its own XAE extensions: the VSIX is unpacked into
  TcXaeShell's Common7\IDE\Extensions folder (administrator rights, asked for via UAC). The folder's
  extensions.configurationchanged marker is then updated, so TcXaeShell rebuilds its configuration on the next start.
  TcXaeShell is an isolated shell: it has no /updateconfiguration switch.

.EXAMPLE
  .\install-tcxaeshell.ps1
.EXAMPLE
  .\install-tcxaeshell.ps1 -Uninstall
#>
param(
  [string]$Vsix = (Join-Path $PSScriptRoot 'KvalStateScope.Xae\bin\Release\KvalStateScope.Xae.vsix'),
  [string]$ShellRoot = 'C:\Program Files\Beckhoff\TcXaeShell',
  [switch]$Uninstall,
  # Internal: the elevated copy step
  [switch]$CopyOnly
)
# (TcXaeShell.exe is only checked for, never started: the change is picked up on its next start)
$ErrorActionPreference = 'Stop'

$shellExe = Join-Path $ShellRoot 'Common7\IDE\TcXaeShell.exe'
$target = Join-Path $ShellRoot 'Common7\IDE\Extensions\Kval Inc\Kval StateScope'
# Touched after a change: TcXaeShell compares its timestamp at start-up and then re-merges the extension registrations
$marker = Join-Path $ShellRoot 'Common7\IDE\Extensions\extensions.configurationchanged'
if (-not (Test-Path $shellExe)) { throw "TcXaeShell not found: $shellExe" }

function Test-Admin {
  ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if ($CopyOnly) {
  # Elevated part: only the files under Program Files
  try {
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    if (-not $Uninstall) {
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      New-Item -ItemType Directory -Path $target -Force | Out-Null
      [System.IO.Compression.ZipFile]::ExtractToDirectory($Vsix, $target)
      Remove-Item (Join-Path $target '[Content_Types].xml') -Force -ErrorAction SilentlyContinue
      # Machine-wide, like Beckhoff's extensions: the Extension Manager does not try to manage it per user
      $manifest = Join-Path $target 'extension.vsixmanifest'
      $xml = [System.IO.File]::ReadAllText($manifest)
      $xml = $xml -replace '<Installation>', '<Installation InstalledByMsi="true" AllUsers="true">'
      [System.IO.File]::WriteAllText($manifest, $xml, (New-Object System.Text.UTF8Encoding($true)))
    }
    if (-not (Test-Path $marker)) { New-Item -ItemType File -Path $marker | Out-Null }
    (Get-Item $marker).LastWriteTime = Get-Date
    exit 0
  } catch {
    Write-Host $_ -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
  }
}

if (Get-Process -Name TcXaeShell -ErrorAction SilentlyContinue) { throw 'Close TcXaeShell first.' }
if (-not $Uninstall) {
  if (-not (Test-Path $Vsix)) { throw "VSIX not found: $Vsix (run .\build.ps1 first)" }
  $Vsix = (Resolve-Path $Vsix).Path
}

# 1. copy (elevated)
$copyArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-CopyOnly', '-Vsix', "`"$Vsix`"", '-ShellRoot', "`"$ShellRoot`"")
if ($Uninstall) { $copyArgs += '-Uninstall' }
if (Test-Admin) {
  & powershell.exe @($copyArgs | ForEach-Object { $_.Trim('"') })
} else {
  $p = Start-Process powershell.exe -Verb RunAs -ArgumentList $copyArgs -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw 'Copying into the TcXaeShell folder failed (or the UAC prompt was declined).' }
}
if (-not $Uninstall -and -not (Test-Path (Join-Path $target 'KvalStateScope.Xae.pkgdef'))) { throw "Install failed: nothing in $target" }

if ($Uninstall) { Write-Host 'Kval StateScope removed from TcXaeShell. It is gone after the next TcXaeShell start.' }
else { Write-Host "Kval StateScope installed in TcXaeShell ($target). Start TcXaeShell and right-click a .TcPOU (or use Tools > Kval StateScope...)." }
