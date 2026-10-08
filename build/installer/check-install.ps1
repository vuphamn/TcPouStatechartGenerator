<#
.SYNOPSIS
  Checks what the Kval MachineScope installer set up on this computer: read-only, nothing is changed.

.DESCRIPTION
  One line per part: the desktop app, Explorer's menu entry, the TwinCAT XAE extension in Visual Studio 2022 / 2026
  and in each TcXaeShell (TwinCAT 4026's 64-bit, 4024's 32-bit), the WebView2 Runtime the extension needs, Link and
  its shortcuts, the gateway. Each one OK, -- (not on this computer, or not chosen) or !! (chosen but missing or
  broken), with where it is. The choices are the installer's (Software\Kval\MachineScope). Exit code 1 when a part is
  !!, else 0.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File check-install.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File check-install.ps1 -Json   (the same, as JSON)
#>
param([switch]$Json)
$ErrorActionPreference = 'SilentlyContinue'

$vsixId = 'KvalMachineScope.Xae.e0718790-a072-4c96-ba71-67161c7fdaa6'
$items = New-Object System.Collections.Generic.List[object]
function Add([string]$part, [string]$status, [string]$detail) { $items.Add([pscustomobject]@{ part = $part; status = $status; detail = $detail }) }

# The installer's choices (this user's, else all users')
function Choice([string]$name) {
  foreach ($root in 'HKCU:', 'HKLM:') {
    $v = (Get-ItemProperty -Path "$root\Software\Kval\MachineScope" -Name $name).$name
    if ($null -ne $v) { return [int]$v }
  }
  return $null
}
$choiceNames = 'ContextMenu', 'VisualStudio', 'TcXaeShell', 'TcXaeShell4024', 'Link', 'LinkStartup', 'Gateway'
$choices = [ordered]@{}
foreach ($n in $choiceNames) { $choices[$n] = Choice $n }
$chosen = { param($n) $choices[$n] -eq 1 }

# 1. The desktop app (its uninstall entry: the new name or, an earlier install, the old one)
$app = $null
foreach ($key in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*') {
  $app = Get-ItemProperty $key | Where-Object { $_.DisplayName -match '^Kval MachineScope' } | Select-Object -First 1
  if ($app) { break }
}
$appDir = $null
if ($app) {
  $appDir = $app.InstallLocation
  if (-not $appDir -and $app.UninstallString) { $appDir = Split-Path ($app.UninstallString.Trim('"').Split('"')[0]) }
  $exe = Get-ChildItem $appDir -Filter 'Kval*Scope.exe' | Select-Object -First 1
  if ($exe) { Add 'Desktop app' 'OK' "$($app.DisplayName) ($($app.DisplayVersion)): $($exe.FullName)" }
  else { Add 'Desktop app' '!!' "$($app.DisplayName) is registered, but its exe is not in $appDir" }
} else {
  Add 'Desktop app' '!!' 'Not installed (no uninstall entry for Kval MachineScope)'
}

# 2. Explorer's menu entry for .TcPOU files
$menu = $null
foreach ($root in 'HKCU:', 'HKLM:') {
  # (-LiteralPath: the * is the key's own name, all files; as a wildcard it would walk every file type)
  $k = Get-Item -LiteralPath "$root\Software\Classes\*\shell\KvalMachineScope"
  if ($k) { $menu = @{ text = $k.GetValue(''); command = (Get-Item -LiteralPath "$root\Software\Classes\*\shell\KvalMachineScope\command").GetValue('') }; break }
}
if ($menu) {
  $target = ($menu.command -split '"')[1]
  if ($target -and (Test-Path $target)) { Add 'Explorer menu' 'OK' "$($menu.text) (.TcPOU files): $target" }
  else { Add 'Explorer menu' '!!' "$($menu.text): its program is missing ($target)" }
} elseif (& $chosen 'ContextMenu') { Add 'Explorer menu' '!!' 'Chosen, but not in the registry' }
else { Add 'Explorer menu' '--' 'Not chosen' }

# The extension's manifest in a folder (its version), or $null
function ExtensionIn([string]$dir) {
  foreach ($m in Get-ChildItem $dir -Recurse -Filter 'extension.vsixmanifest' -Depth 2) {
    $text = Get-Content $m.FullName -Raw
    if ($text -match [regex]::Escape($vsixId)) {
      $version = if ($text -match '<Identity [^>]*Version="([^"]+)"') { $Matches[1] } else { '?' }
      $name = if ($text -match '<DisplayName>([^<]+)</DisplayName>') { $Matches[1] } else { '' }
      return [pscustomobject]@{ version = $version; name = $name; dir = $m.DirectoryName }
    }
  }
  return $null
}

# 3. Visual Studio 2022 / 2026 (each instance; its experimental instance left out)
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs = @()
# (Windows PowerShell 5.1 passes a parsed JSON array on as one object: unrolled first)
if (Test-Path $vswhere) { $parsed = & $vswhere -all -prerelease -products * -version '[17.0,19.0)' -format json -utf8 | Out-String | ConvertFrom-Json; $vs = @($parsed | ForEach-Object { $_ } | Where-Object { Test-Path (Join-Path $_.installationPath 'Common7\IDE\devenv.exe') }) }
if (-not $vs.Count) {
  Add 'Visual Studio' '--' 'Visual Studio 2022 / 2026 is not on this computer'
}
foreach ($i in $vs) {
  $major = $i.installationVersion.Split('.')[0]
  $userDirs = @(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\VisualStudio') -Directory -Filter "$major.0_$($i.instanceId)")
  $found = $null
  foreach ($d in $userDirs + @(Get-Item (Join-Path $i.installationPath 'Common7\IDE\Extensions'))) {
    if (-not $d) { continue }
    $found = ExtensionIn $d.FullName
    if ($found) { break }
  }
  if ($found) { Add "Visual Studio: $($i.displayName)" 'OK' "$($found.name) $($found.version)" }
  elseif (& $chosen 'VisualStudio') { Add "Visual Studio: $($i.displayName)" '!!' 'Chosen, but the extension is not installed in it' }
  else { Add "Visual Studio: $($i.displayName)" '--' 'The extension is not installed (not chosen)' }
}

# 4. TcXaeShell: the 64-bit one (a Visual Studio 2022 shell: TwinCAT 4024's or 4026's, as this computer's TwinCAT is)
#    and 4024's 32-bit one (Visual Studio 2017)
$tcBuild = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Beckhoff\TwinCAT3\System').Build
$tc64 = if ($tcBuild -ge 4026) { 'TwinCAT 4026' } elseif ($tcBuild -ge 4024) { 'TwinCAT 4024' } else { 'TwinCAT 4024 / 4026' }
foreach ($shell in @(
    @{ part = "TcXaeShell 64-bit ($tc64)"; root = Join-Path $env:ProgramFiles 'Beckhoff\TcXaeShell'; choice = 'TcXaeShell' },
    @{ part = 'TcXaeShell 32-bit (TwinCAT 4024)'; root = Join-Path ${env:ProgramFiles(x86)} 'Beckhoff\TcXaeShell'; choice = 'TcXaeShell4024' })) {
  if (-not (Test-Path (Join-Path $shell.root 'Common7\IDE\TcXaeShell.exe'))) { Add $shell.part '--' 'Not on this computer'; continue }
  $dir = Join-Path $shell.root 'Common7\IDE\Extensions\Kval Inc\Kval MachineScope'
  $found = if (Test-Path $dir) { ExtensionIn $dir } else { $null }
  $pkgdef = Test-Path (Join-Path $dir 'KvalMachineScope.Xae.pkgdef')
  if ($found -and $pkgdef) { Add $shell.part 'OK' "$($found.name) $($found.version): $dir" }
  elseif ($found) { Add $shell.part '!!' "Its manifest is there, its package file is not: install it again ($dir)" }
  elseif (& $chosen $shell.choice) { Add $shell.part '!!' 'Chosen, but the extension is not in it' }
  else { Add $shell.part '--' 'The extension is not installed (not chosen)' }
}

# 5. The WebView2 Runtime (the XAE extension shows the app in it)
$wv = $null
foreach ($key in 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}') {
  $wv = (Get-ItemProperty $key).pv
  if ($wv -and $wv -ne '0.0.0.0') { break }
}
$anyExtension = @($items | Where-Object { $_.part -match '^(Visual Studio:|TcXaeShell)' -and $_.status -eq 'OK' }).Count -gt 0
if ($wv -and $wv -ne '0.0.0.0') { Add 'WebView2 Runtime' 'OK' $wv }
elseif ($anyExtension) { Add 'WebView2 Runtime' '!!' 'Missing: the XAE extension needs it (https://developer.microsoft.com/microsoft-edge/webview2/)' }
else { Add 'WebView2 Runtime' '--' 'Not found (only the XAE extension needs it)' }

# 6. Link: its exe, its Start menu shortcut, its start at sign-in
$programs = @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'))
$startup = [Environment]::GetFolderPath('Startup')
$linkExe = $null
if ($appDir) { $linkExe = @('Kval MachineScope Link.exe' | ForEach-Object { Join-Path $appDir "Link\$_" } | Where-Object { Test-Path $_ }) | Select-Object -First 1 }
$linkLnk = @($programs | ForEach-Object { Join-Path $_ 'Kval MachineScope Link.lnk' } | Where-Object { Test-Path $_ }) | Select-Object -First 1
if ($linkExe) { Add 'Link' ($(if ($linkLnk) { 'OK' } else { '!!' })) "$linkExe$(if (-not $linkLnk) { ' (no Start menu shortcut)' })" }
elseif (& $chosen 'Link') { Add 'Link' '!!' 'Chosen, but its exe is not installed' }
else { Add 'Link' '--' 'Not chosen' }
$atSignIn = @('Kval MachineScope Link.lnk' | ForEach-Object { Join-Path $startup $_ } | Where-Object { Test-Path $_ }) | Select-Object -First 1
if ($atSignIn) { Add 'Link at sign-in' 'OK' $atSignIn }
elseif (& $chosen 'LinkStartup') { Add 'Link at sign-in' '!!' 'Chosen, but no shortcut in the Startup folder' }
else { Add 'Link at sign-in' '--' 'Not set' }

# 7. The gateway (its folder outside the program's)
$gwDir = $null
foreach ($root in 'HKCU:', 'HKLM:') { $gwDir = (Get-ItemProperty "$root\Software\Kval\MachineScope").GatewayDir; if ($gwDir) { break } }
if ($gwDir -and (Test-Path (Join-Path $gwDir 'gateway.cjs'))) {
  $node = (& cmd.exe /c 'node --version' 2>$null)
  Add 'Gateway' ($(if ($node) { 'OK' } else { '!!' })) "$gwDir$(if ($node) { " (Node.js $node)" } else { ' (Node.js 20 or later is not installed: it does not run)' })"
} elseif (& $chosen 'Gateway') { Add 'Gateway' '!!' "Chosen, but its files are not there ($gwDir)" }
else { Add 'Gateway' '--' 'Not chosen' }

# 8. TwinCAT on this computer (read only): its build, its drivers (a package installed whose driver is not there: a
#    configuration with NC fails to activate with "Error starting TcNc server ... 1060"), its routes, the Remote
#    Manager's builds
$tcSystem = Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Beckhoff\TwinCAT3\System' -ErrorAction SilentlyContinue
if ($tcSystem.TcVersion) {
  Add 'TwinCAT' 'OK' "$($tcSystem.TcVersion)"
  $products = @(Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue | ForEach-Object { (Get-ItemProperty $_.PSPath).DisplayName } | Where-Object { $_ -like 'Beckhoff TwinCAT*' })
  $services = @{}
  Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Services' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -cmatch '^Tc[A-Z]' -or $_.PSChildName -eq 'tcvirtualmpbus' } | ForEach-Object { $services[$_.PSChildName] = Get-ItemProperty $_.PSPath }
  $driverProblems = 0
  foreach ($name in ($services.Keys | Sort-Object)) {
    $image = $services[$name].ImagePath
    if (-not $image) { Add "TwinCAT driver $name" '!!' 'Registered but empty (no driver): repair its TwinCAT package (Package Manager > Installed > Repair), then restart'; $driverProblems++; continue }
    $file = ($image -replace '^\\\?\?\\', '' -replace '^"([^"]+)".*$', '$1' -replace '^System32\\', "$env:SystemRoot\System32\" -replace '^\\SystemRoot\\', "$env:SystemRoot\")
    if (-not (Test-Path $file)) { Add "TwinCAT driver $name" '!!' "Its file is missing: $file"; $driverProblems++ }
  }
  # (a package installed, its driver not registered)
  foreach ($need in @(@{ product = '*XAR NCPTP KM*'; driver = 'TcNc'; what = 'NC PTP' }, @{ product = '*XAR NCI Classic*'; driver = 'TcNcI'; what = 'NC I' })) {
    if (($products | Where-Object { $_ -like $need.product }) -and -not $services[$need.driver].ImagePath) {
      Add "TwinCAT driver $($need.driver)" '!!' "$($need.what) is installed, its driver is not: a configuration using it does not activate (1060). Repair its package, then restart"
      $driverProblems++
    }
  }
  if (-not $driverProblems) { Add 'TwinCAT drivers' 'OK' "$(@($services.Keys).Count) registered" }
  # Routes: where this TwinCAT keeps them (4026: ProgramData; installed by the Package Manager: its installation folder)
  $tcDir = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Beckhoff\TwinCAT3' -ErrorAction SilentlyContinue).TwinCATDir
  $routeFile = @("$env:ProgramData\Beckhoff\TwinCAT\3.1\Target", $(if ($tcDir) { Join-Path $tcDir '3.1\Target' }), 'C:\TwinCAT\3.1\Target') | Where-Object { $_ } | ForEach-Object { Join-Path $_ 'StaticRoutes.xml' } | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($routeFile) {
    $names = @(([xml](Get-Content $routeFile -Raw)).SelectNodes('//Route') | ForEach-Object { $_.Name })
    Add 'TwinCAT routes' 'OK' "$($names.Count) in $routeFile$(if ($names.Count) { ': ' + ($names -join ', ') })"
  } else { Add 'TwinCAT routes' '--' 'No StaticRoutes.xml (no routes yet)' }
  # Remote Manager: the engineering builds installed beside this TwinCAT
  $builds = @(Get-ChildItem 'C:\Program Files (x86)\Beckhoff\TwinCAT\3.1\Components\Base' -Directory -Filter 'Build_*' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name -replace '^Build_', '' })
  if ($builds.Count) {
    $older = @($builds | Where-Object { $_ -like '4024.*' })
    $note = if ($older.Count -and "$($tcSystem.TcVersion)" -like '3.1.4026*') { " (4024 builds on a 4026 TwinCAT: only in 4024's 32-bit TcXaeShell, and their PLC may build with 4026's compiler: build 4024 projects on a 4024 computer)" } else { '' }
    Add 'Remote Manager builds' '--' "$($builds -join ', ')$note"
  }
} else { Add 'TwinCAT' '--' 'Not installed on this computer' }

$bad = @($items | Where-Object { $_.status -eq '!!' }).Count
if ($Json) {
  [pscustomobject]@{ computer = $env:COMPUTERNAME; user = $env:USERNAME; at = (Get-Date).ToString('s'); choices = $choices; items = $items; problems = $bad } | ConvertTo-Json -Depth 4
} else {
  Write-Output "Kval MachineScope on $env:COMPUTERNAME ($env:USERNAME), $((Get-Date).ToString('yyyy-MM-dd HH:mm'))"
  $w = ($items | ForEach-Object { $_.part.Length } | Measure-Object -Maximum).Maximum
  foreach ($i in $items) { Write-Output ("  [{0}] {1}  {2}" -f $i.status, $i.part.PadRight($w), $i.detail) }
  Write-Output $(if ($bad) { "$bad problem(s): see the lines marked !!" } else { 'No problems found.' })
}
exit $(if ($bad) { 1 } else { 0 })
