<#
.SYNOPSIS
  One-time clean-up of what an install from before the rename (Kval StateScope) left on this computer.

.DESCRIPTION
  Kval MachineScope uses its own names throughout; an earlier Kval StateScope install is not taken over. This script
  finds what is left of one and removes it, asking before each step (Yes / No / Yes to all):

    1. The old desktop app (its uninstall entry "Kval StateScope ..."): its own uninstaller, run silently
    2. Old Link: its process stopped; its Startup (start at sign-in) and Start menu shortcuts deleted
    3. The old gateway's scheduled task ("Kval StateScope gateway")
    4. The old TwinCAT XAE extension in Visual Studio 2022 / 2026 (KvalStateScope.Xae...): VSIXInstaller /uninstall
    5. The old extension in each TcXaeShell (Extensions\Kval Inc\Kval StateScope): removed (administrator rights)
    6. Documents\Kval StateScope: its files moved to Documents\Kval MachineScope (none written over: those are left
       and listed), the old folder removed when empty
    7. The old registry keys: the installer's choices (Software\Kval\StateScope), Explorer's old menu entries
    8. The old settings and data folders (AppData, LocalAppData, ProgramData); the old XAE extension's backups of
       the files it saved moved to LocalAppData\KvalMachineScope\Backups first (kept)

  Nothing of Kval MachineScope is touched. Visual Studio and TcXaeShell are never closed: a step that needs them
  closed says so and is skipped.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File cleanup-statescope.ps1 -WhatIf     (only lists what it would do)
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File cleanup-statescope.ps1             (asks before each step)
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File cleanup-statescope.ps1 -Confirm:$false   (all of it, no questions)
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param()
$ErrorActionPreference = 'Stop'

$oldName = 'Kval StateScope'
$oldVsixId = 'KvalStateScope.Xae.e0718790-a072-4c96-ba71-67161c7fdaa6'
$found = 0
function Test-Admin {
  ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Step([string]$title) { Say ''; Say $title 'Cyan' }

# 1. The old desktop app
Step '1. The old desktop app'
$apps = @()
foreach ($key in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*') {
  $apps += @(Get-ItemProperty $key -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "$oldName*" })
}
if (-not $apps) { Say '   none' }
foreach ($app in $apps) {
  $found++
  $cmd = if ($app.QuietUninstallString) { $app.QuietUninstallString } else { "$($app.UninstallString) /S" }
  if ($PSCmdlet.ShouldProcess("$($app.DisplayName) $($app.DisplayVersion)", "Uninstall ($cmd)")) {
    $exe = if ($cmd.StartsWith('"')) { $cmd.Substring(1, $cmd.IndexOf('"', 1) - 1) } else { $cmd.Split(' ')[0] }
    $rest = $cmd.Substring($cmd.IndexOf($exe) + $exe.Length).Trim().TrimStart('"').Trim()
    $p = Start-Process $exe -ArgumentList $rest -Wait -PassThru
    Say "   uninstaller exit code $($p.ExitCode)"
  }
}

# 2. Old Link: its process, its shortcuts
Step '2. Old Link'
$links = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq "$oldName Link" })
$startup = [Environment]::GetFolderPath('Startup')
$programs = [Environment]::GetFolderPath('Programs')
$commonPrograms = [Environment]::GetFolderPath('CommonPrograms')
$shortcuts = @(
  (Join-Path $startup "$oldName Link.lnk"),
  (Join-Path $programs "$oldName Link.lnk"),
  (Join-Path $programs "$oldName Gateway.lnk"),
  (Join-Path $commonPrograms "$oldName Link.lnk"),
  (Join-Path $commonPrograms "$oldName Gateway.lnk")
) | Where-Object { Test-Path -LiteralPath $_ }
if (-not $links -and -not $shortcuts) { Say '   none' }
foreach ($l in $links) {
  $found++
  if ($PSCmdlet.ShouldProcess("$($l.ProcessName) (process $($l.Id))", 'Stop')) { Stop-Process -Id $l.Id -Force }
}
foreach ($s in $shortcuts) {
  $found++
  $admin = $s.StartsWith($commonPrograms) -and -not (Test-Admin)
  if ($admin) { Say "   $s : all users' Start menu, needs administrator rights (run this again as administrator)" 'Yellow'; continue }
  if ($PSCmdlet.ShouldProcess($s, 'Delete the shortcut')) { Remove-Item -LiteralPath $s -Force }
}

# 3. The old gateway's scheduled task
Step '3. The old gateway task'
$task = Get-ScheduledTask -TaskName "$oldName gateway" -ErrorAction SilentlyContinue
if (-not $task) { Say '   none' }
else {
  $found++
  if (-not (Test-Admin)) { Say "   '$oldName gateway' is registered: removing it needs administrator rights (run this again as administrator)" 'Yellow' }
  elseif ($PSCmdlet.ShouldProcess("Scheduled task '$oldName gateway'", 'Stop and unregister')) {
    Stop-ScheduledTask -TaskName "$oldName gateway" -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName "$oldName gateway" -Confirm:$false
  }
}

# 4. The old extension in Visual Studio 2022 / 2026 (installed per user, under LocalAppData)
Step '4. The old extension in Visual Studio'
$vsDirs = @(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\VisualStudio') -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^1[78]\.0_[0-9a-f]+$' })
$withOld = @()
foreach ($d in $vsDirs) {
  $manifests = Get-ChildItem (Join-Path $d.FullName 'Extensions') -Recurse -Filter 'extension.vsixmanifest' -ErrorAction SilentlyContinue
  if ($manifests | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match [regex]::Escape($oldVsixId) }) { $withOld += $d }
}
if (-not $withOld) { Say '   none' }
else {
  $found++
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  $instances = @()
  if (Test-Path $vswhere) { $instances = @((& $vswhere -all -prerelease -products * -version '[17.0,19.0)' -format json -utf8 | Out-String | ConvertFrom-Json) | ForEach-Object { $_ } | Where-Object { $withOld.Name -contains "$($_.installationVersion.Split('.')[0]).0_$($_.instanceId)" }) }
  $running = Get-Process devenv -ErrorAction SilentlyContinue | Where-Object { $p = $_.Path; $p -and ($instances | Where-Object { $p.StartsWith($_.installationPath, [StringComparison]::OrdinalIgnoreCase) }) }
  if (-not $instances) { Say "   found in $($withOld.Name -join ', '), but no Visual Studio of it (vswhere): remove it in Extensions > Manage Extensions" 'Yellow' }
  elseif ($running) { Say '   Visual Studio is running: close it and run this again (skipped)' 'Yellow' }
  elseif ($PSCmdlet.ShouldProcess("$oldVsixId in $(($instances | ForEach-Object { $_.displayName }) -join ', ')", 'Uninstall (VSIXInstaller)')) {
    $installer = Join-Path $instances[0].installationPath 'Common7\IDE\VSIXInstaller.exe'
    $log = Join-Path $env:TEMP 'KvalStateScope-cleanup-vsix.log'
    $p = Start-Process $installer -ArgumentList @('/quiet', "/instanceIds:$(($instances | ForEach-Object { $_.instanceId }) -join ',')", "/logFile:$log", "/uninstall:$oldVsixId") -Wait -PassThru
    Say "   VSIXInstaller exit code $($p.ExitCode) (0: done, 2003: not installed; see $log)"
  }
}

# 5. The old extension in each TcXaeShell
Step '5. The old extension in TcXaeShell'
$shells = @('C:\Program Files\Beckhoff\TcXaeShell', 'C:\Program Files (x86)\Beckhoff\TcXaeShell') | Where-Object { Test-Path (Join-Path $_ "Common7\IDE\Extensions\Kval Inc\$oldName") }
if (-not $shells) { Say '   none' }
foreach ($shell in $shells) {
  $found++
  $dir = Join-Path $shell "Common7\IDE\Extensions\Kval Inc\$oldName"
  if (Get-Process TcXaeShell -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($shell, [StringComparison]::OrdinalIgnoreCase) }) { Say "   $dir : TcXaeShell is running, close it and run this again (skipped)" 'Yellow'; continue }
  if ($PSCmdlet.ShouldProcess($dir, 'Remove the folder (administrator rights)')) {
    $marker = Join-Path $shell 'Common7\IDE\Extensions\extensions.configurationchanged'
    # (TcXaeShell re-reads its extensions on its next start: the marker's time)
    $script = "Remove-Item -LiteralPath '$dir' -Recurse -Force; `$k = Split-Path '$dir'; if (-not (Get-ChildItem -LiteralPath `$k)) { Remove-Item -LiteralPath `$k }; if (-not (Test-Path '$marker')) { New-Item -ItemType File -Path '$marker' | Out-Null }; (Get-Item '$marker').LastWriteTime = Get-Date"
    if (Test-Admin) { & powershell.exe -NoProfile -Command $script }
    else { $p = Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile', '-Command', $script) -Wait -PassThru; if ($p.ExitCode) { Say '   not removed (or the UAC prompt was declined)' 'Yellow' } }
  }
}
# (an empty Kval Inc folder only, the new extension not there: left, as the installer leaves it)

# 6. Documents\Kval StateScope into Documents\Kval MachineScope
Step '6. Documents\Kval StateScope'
$docs = [Environment]::GetFolderPath('MyDocuments')
$old = Join-Path $docs $oldName
$new = Join-Path $docs 'Kval MachineScope'
if (-not (Test-Path -LiteralPath $old)) { Say '   none' }
else {
  $found++
  $files = @(Get-ChildItem -LiteralPath $old -Recurse -File -Force)
  $clash = @($files | Where-Object { Test-Path -LiteralPath (Join-Path $new $_.FullName.Substring($old.Length + 1)) })
  if ($PSCmdlet.ShouldProcess("$old ($($files.Count) files$(if ($clash) { ", $($clash.Count) also in the new folder: left" }))", "Move into $new")) {
    foreach ($f in $files) {
      $rel = $f.FullName.Substring($old.Length + 1)
      $to = Join-Path $new $rel
      if (Test-Path -LiteralPath $to) { continue }
      New-Item -ItemType Directory -Path (Split-Path $to) -Force | Out-Null
      Move-Item -LiteralPath $f.FullName -Destination $to
    }
    foreach ($c in $clash) { Say "   left (also in $new): $($c.FullName.Substring($old.Length + 1))" 'Yellow' }
    # (its empty folders, deepest first; the folder itself when nothing is left)
    Get-ChildItem -LiteralPath $old -Recurse -Directory -Force | Sort-Object { $_.FullName.Length } -Descending | Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force) } | ForEach-Object { Remove-Item -LiteralPath $_.FullName }
    if (-not (Get-ChildItem -LiteralPath $old -Force)) { Remove-Item -LiteralPath $old; Say "   moved; $old removed" }
  }
}

# 7. The old registry keys
Step '7. The old registry keys'
$keys = @()
foreach ($root in 'HKCU:', 'HKLM:') {
  foreach ($k in 'Software\Kval\StateScope', 'Software\Classes\*\shell\KvalStateScope', 'Software\Classes\SystemFileAssociations\.TcPOU\shell\KvalStateScope.Open') {
    # (-LiteralPath: the * is the key's own name, all files)
    if (Test-Path -LiteralPath "$root\$k") { $keys += "$root\$k" }
  }
}
if (-not $keys) { Say '   none' }
foreach ($k in $keys) {
  $found++
  if ($k.StartsWith('HKLM:') -and -not (Test-Admin)) { Say "   $k : needs administrator rights (run this again as administrator)" 'Yellow'; continue }
  if ($PSCmdlet.ShouldProcess($k, 'Delete the registry key')) {
    Remove-Item -LiteralPath $k -Recurse -Force
    # (Software\Kval empty now: removed too)
    $parent = $k.Substring(0, $k.LastIndexOf('\'))
    if ($k -like '*\Software\Kval\StateScope' -and (Test-Path -LiteralPath $parent) -and -not (Get-ChildItem -LiteralPath $parent) -and -not (Get-Item -LiteralPath $parent).ValueCount) { Remove-Item -LiteralPath $parent }
  }
}

# 8. The old settings and data folders
Step '8. The old settings and data folders'
# (the XAE extension's backups of the files it saved: kept, moved to where Kval MachineScope keeps its own)
$oldBackups = Join-Path $env:LOCALAPPDATA 'KvalStateScope\Backups'
$newBackups = Join-Path $env:LOCALAPPDATA 'KvalMachineScope\Backups'
if (Test-Path -LiteralPath $oldBackups) {
  $sets = @(Get-ChildItem -LiteralPath $oldBackups -Directory)
  if ($sets -and $PSCmdlet.ShouldProcess("$oldBackups ($($sets.Count) backups of saved files)", "Move into $newBackups (kept)")) {
    New-Item -ItemType Directory -Path $newBackups -Force | Out-Null
    foreach ($s in $sets) {
      $to = Join-Path $newBackups $s.Name
      if (Test-Path -LiteralPath $to) { $to = "$to-StateScope" }
      Move-Item -LiteralPath $s.FullName -Destination $to
    }
  }
}
$dirs = @(
  (Join-Path $env:APPDATA $oldName),            # the desktop app's settings
  (Join-Path $env:APPDATA 'KvalStateScope'),    # Link's
  (Join-Path $env:LOCALAPPDATA 'KvalStateScope'), # the gateway's (this user)
  (Join-Path $env:LOCALAPPDATA 'kval-statescope-updater'),
  (Join-Path $env:ProgramData 'KvalStateScope') # the gateway's (all users)
) | Where-Object { Test-Path -LiteralPath $_ }
if (-not $dirs) { Say '   none' }
foreach ($d in $dirs) {
  $found++
  if ($d.StartsWith($env:ProgramData) -and -not (Test-Admin)) { Say "   $d : needs administrator rights (run this again as administrator)" 'Yellow'; continue }
  $size = (Get-ChildItem -LiteralPath $d -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  if ($PSCmdlet.ShouldProcess("$d ($([math]::Round($size / 1MB, 1)) MB)", 'Delete the folder')) { Remove-Item -LiteralPath $d -Recurse -Force }
}

Say ''
if ($found) { Say "$found old item(s) found." 'Green' } else { Say "Nothing of $oldName left on this computer." 'Green' }
