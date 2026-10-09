<#
.SYNOPSIS
  Checks what the Kval MachineScope installer set up on this computer: read-only, nothing is changed.

.DESCRIPTION
  One line per part: the desktop app, Explorer's menu entry, the TwinCAT XAE extension in Visual Studio 2022 / 2026
  and in each TcXaeShell (TwinCAT 4026's 64-bit, 4024's 32-bit), the WebView2 Runtime the extension needs, Link and
  its shortcuts, the gateway. Each one OK, -- (not on this computer, or not chosen) or !! (chosen but missing or
  broken), with where it is. The choices are the installer's (Software\Kval\MachineScope). Exit code 1 when a part is
  !!, else 0. TwinCAT on this computer too: its drivers, routes and engineering builds; a driver missing names the
  TwinCAT package that installs it (its Windows Installer product).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File check-install.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File check-install.ps1 -Json   (the same, as JSON)
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File check-install.ps1 -Repair   (then, for each TwinCAT driver missing, asks to
  repair the package that installs it: msiexec /fa, as administrator; restart the computer afterwards)
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File check-install.ps1 -PackageOf TcNcI.sys   (which TwinCAT package installs it)
#>
param([switch]$Json, [switch]$Repair, [string]$PackageOf)
$ErrorActionPreference = 'SilentlyContinue'

# The TwinCAT package (Windows Installer product: "Beckhoff TwinCAT XAR NCI Classic") whose files include this one
# (TcNcI.sys): each XAR product's cached .msi read (its File table), nothing changed
function Find-TwinCATPackage([string]$fileName) {
  $installer = New-Object -ComObject WindowsInstaller.Installer
  $call = { param($o, $name, $kind, [object[]]$a) $o.GetType().InvokeMember($name, $kind, $null, $o, $a) }
  $products = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' |
    Where-Object { $_.PSChildName -match '^\{[0-9A-Fa-f-]{36}\}$' -and $_.DisplayName -like 'Beckhoff TwinCAT XAR*' }
  foreach ($p in $products) {
    try {
      $msi = & $call $installer 'ProductInfo' 'GetProperty' @($p.PSChildName, 'LocalPackage')
      if (-not $msi -or -not (Test-Path $msi)) { continue }
      $db = & $call $installer 'OpenDatabase' 'InvokeMethod' @($msi, 0)
      $view = & $call $db 'OpenView' 'InvokeMethod' @('SELECT `FileName` FROM `File`')
      [void](& $call $view 'Execute' 'InvokeMethod' @())
      while ($rec = & $call $view 'Fetch' 'InvokeMethod' @()) {
        $long = (& $call $rec 'StringData' 'GetProperty' @(1)) -replace '^[^|]*\|', ''
        if ($long -ieq $fileName) { [void](& $call $view 'Close' 'InvokeMethod' @()); return [pscustomobject]@{ name = $p.DisplayName; code = $p.PSChildName; version = $p.DisplayVersion } }
      }
      [void](& $call $view 'Close' 'InvokeMethod' @())
    } catch { }
  }
  return $null
}
if ($PackageOf) {
  $found = Find-TwinCATPackage $PackageOf
  if ($found) { Write-Output "$PackageOf is installed by $($found.name) $($found.version) $($found.code)"; exit 0 }
  Write-Output "$PackageOf is not in any TwinCAT XAR package installed here"; exit 1
}

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
  $products = @(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Beckhoff TwinCAT*' })
  $services = @{}
  Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Services' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -cmatch '^Tc[A-Z]' -or $_.PSChildName -eq 'tcvirtualmpbus' } | ForEach-Object { $services[$_.PSChildName] = Get-ItemProperty $_.PSPath }
  $driverProblems = 0
  # (each one missing: the package that repairs it, when found; -Repair offers it below)
  $repairs = New-Object System.Collections.Generic.List[object]
  $repairHint = {
    param($package, $driver)
    if (-not $package) { return 'repair its TwinCAT package (Package Manager > Installed), then restart' }
    if (-not ($repairs | Where-Object { $_.code -eq $package.code })) { $repairs.Add([pscustomobject]@{ name = $package.name; code = $package.code; driver = $driver }) }
    "repair $($package.name) (msiexec /fa $($package.code) /qb as administrator, or run this check with -Repair), then restart"
  }
  foreach ($name in ($services.Keys | Sort-Object)) {
    $image = $services[$name].ImagePath
    if (-not $image) {
      $package = Find-TwinCATPackage "$name.sys"
      if (-not $package) { $package = Find-TwinCATPackage "$name.exe" }
      Add "TwinCAT driver $name" '!!' "Registered but empty (no driver): $(& $repairHint $package $name)"; $driverProblems++; continue
    }
    $file = ($image -replace '^\\\?\?\\', '' -replace '^"([^"]+)".*$', '$1' -replace '^System32\\', "$env:SystemRoot\System32\" -replace '^\\SystemRoot\\', "$env:SystemRoot\")
    if (-not (Test-Path $file)) { Add "TwinCAT driver $name" '!!' "Its file is missing: $file; $(& $repairHint (Find-TwinCATPackage (Split-Path $file -Leaf)) $name)"; $driverProblems++ }
  }
  # (a package installed, its driver not registered)
  foreach ($need in @(@{ product = '*XAR NCPTP KM*'; driver = 'TcNc'; what = 'NC PTP' }, @{ product = '*XAR NCI Classic*'; driver = 'TcNcI'; what = 'NC I' })) {
    $p = $products | Where-Object { $_.DisplayName -like $need.product -and $_.PSChildName -match '^\{' } | Select-Object -First 1
    if ($p -and -not $services[$need.driver].ImagePath) {
      Add "TwinCAT driver $($need.driver)" '!!' "$($need.what) is installed, its driver is not: a configuration using it does not activate (1060); $(& $repairHint ([pscustomobject]@{ name = $p.DisplayName; code = $p.PSChildName }) $need.driver)"
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
  # License: this computer's TwinCAT license files (4026: ProgramData; 4024: the installation's Target), each one's
  # expiry and what it licenses (a 7-day trial is renewed in XAE: License > 7 Days Trial License). Only matters when
  # this computer runs a configuration itself
  $licDirs = @("$env:ProgramData\Beckhoff\TwinCAT\3.1\License", $(if ($tcDir) { Join-Path $tcDir '3.1\Target\License' }), 'C:\TwinCAT\3.1\Target\License') | Where-Object { $_ -and (Test-Path $_) }
  $licFiles = @($licDirs | ForEach-Object { Get-ChildItem $_ -Filter '*.tclrs' -File -ErrorAction SilentlyContinue })
  if (-not $licFiles.Count) { Add 'TwinCAT license' '--' 'No license on this computer (none needed to build; a configuration run here needs one: XAE > License > 7 Days Trial License)' }
  foreach ($f in $licFiles) {
    try { $info = ([xml](Get-Content $f.FullName -Raw)).TcLicenseInfo.LicenseInfo } catch { $info = $null }
    if (-not $info) { Add "TwinCAT license $($f.Name)" '!!' "Not readable: $($f.FullName)"; continue }
    $names = @($info.License | ForEach-Object { $_.Name } | Where-Object { $_ })
    $what = if ($names.Count -gt 6) { (($names | Select-Object -First 6) -join ', ') + ", +$($names.Count - 6) more" } else { $names -join ', ' }
    $kind = if ($f.Name -like 'Trial*') { 'Trial' } else { 'License' }
    if ($info.ExpireTime) {
      # (UTC in the file: IssueTime is when it was written, in UTC)
      $expires = [datetime]::SpecifyKind([datetime]$info.ExpireTime, 'Utc').ToLocalTime()
      $left = $expires - (Get-Date)
      if ($left.TotalSeconds -le 0) { Add "TwinCAT license" '!!' "$kind ran out $($expires.ToString('yyyy-MM-dd HH:mm')): a configuration run here stops (renew it in XAE: License > 7 Days Trial License, then activate). $what" }
      else {
        $soon = if ($left.TotalDays -lt 2) { ', renew it soon (XAE: License > 7 Days Trial License)' } else { '' }
        Add "TwinCAT license" 'OK' "$kind until $($expires.ToString('yyyy-MM-dd HH:mm')) ($([math]::Floor($left.TotalDays)) d $($left.Hours) h left$soon): $what"
      }
    } else { Add "TwinCAT license" 'OK' "$kind without expiry: $what" }
  }
  # Real-time Ethernet (EtherCAT): the adapters with TwinCAT's driver (TwinCAT-Intel PCI Ethernet Adapter) or its
  # RT-Ethernet protocol bound; none: a PLC runs here without I/O (TcRteInstall.exe sets an adapter up)
  $rtAdapters = @()
  $classKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e972-e325-11ce-bfc1-08002be10318}'
  $netAdapters = @(Get-NetAdapter -ErrorAction SilentlyContinue)
  Get-ChildItem $classKey -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($p.DriverDesc -match 'TwinCAT' -or $p.ProviderName -match 'Beckhoff') {
      $a = $netAdapters | Where-Object { $_.InterfaceGuid -eq $p.NetCfgInstanceId } | Select-Object -First 1
      $rtAdapters += "$(if ($a) { "$($a.Name) " })($($p.DriverDesc)$(if ($a) { ", $($a.Status)" }))"
    }
  }
  Get-NetAdapterBinding -AllBindings -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'TwinCAT|Beckhoff' -and $_.Enabled } | ForEach-Object { $rtAdapters += "$($_.Name) ($($_.DisplayName))" }
  $rtAdapters = @($rtAdapters | Select-Object -Unique)
  $rteTool = if ($tcDir) { Join-Path $tcDir '3.1\System\TcRteInstall.exe' } else { $null }
  if ($rtAdapters.Count) { Add 'TwinCAT real-time adapters' 'OK' ($rtAdapters -join '; ') }
  else { Add 'TwinCAT real-time adapters' '--' "None: a PLC runs here, but without EtherCAT I/O$(if ($rteTool -and (Test-Path $rteTool)) { " (to use an adapter for EtherCAT: $rteTool, as administrator)" })" }
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
  [pscustomobject]@{ computer = $env:COMPUTERNAME; user = $env:USERNAME; at = (Get-Date).ToString('s'); choices = $choices; items = $items; problems = $bad; repairs = $(if ($repairs) { ,$repairs.ToArray() } else { ,@() }) } | ConvertTo-Json -Depth 4
} else {
  Write-Output "Kval MachineScope on $env:COMPUTERNAME ($env:USERNAME), $((Get-Date).ToString('yyyy-MM-dd HH:mm'))"
  $w = ($items | ForEach-Object { $_.part.Length } | Measure-Object -Maximum).Maximum
  foreach ($i in $items) { Write-Output ("  [{0}] {1}  {2}" -f $i.status, $i.part.PadRight($w), $i.detail) }
  Write-Output $(if ($bad) { "$bad problem(s): see the lines marked !!" } else { 'No problems found.' })
  # -Repair: each TwinCAT package with a driver missing, repaired when you say so (Windows asks for administrator
  # rights; its files and registrations put back as installed). TcXaeShell should be closed; restart afterwards
  if ($Repair -and $repairs.Count) {
    Write-Output ''
    Write-Output 'Repair: close TcXaeShell / Visual Studio first; restart the computer afterwards (TwinCAT loads its drivers at start).'
    $done = 0
    foreach ($r in $repairs) {
      $answer = Read-Host "Repair $($r.name) (for $($r.driver))? [y/N]"
      if ($answer -notmatch '^(y|yes)$') { Write-Output "  skipped"; continue }
      $proc = Start-Process msiexec.exe -ArgumentList '/fa', $r.code, '/qb' -Verb RunAs -Wait -PassThru
      if (-not $proc) { Write-Output '  not started (administrator rights refused)'; continue }
      $code = $proc.ExitCode
      Write-Output $(if ($code -eq 0) { '  repaired' } elseif ($code -eq 3010) { '  repaired: restart the computer to finish' } else { "  msiexec ended with $code (1602: cancelled; see Windows' Application log, MsiInstaller)" })
      if ($code -eq 0 -or $code -eq 3010) { $done++ }
    }
    if ($done) { Write-Output "Restart the computer, then run this check again." }
  } elseif ($Repair) { Write-Output 'Nothing to repair: no TwinCAT package found for a driver missing.' }
}
exit $(if ($bad) { 1 } else { 0 })
